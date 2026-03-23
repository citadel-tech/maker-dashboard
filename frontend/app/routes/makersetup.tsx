import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Bitcoin, Check, X } from "lucide-react";
import Nav from "../components/Nav";
import { makers, monitoring, wallet, streamLogs, ApiError } from "../api";

// ─── Types ────────────────────────────────────────────────────────────────────

type SetupStage =
  | "starting" // calling start, waiting for server to init
  | "awaiting_funds" // server running, waiting for deposit
  | "creating_bond" // funds detected, bond tx in mempool
  | "live" // bond confirmed, maker is on the network
  | "error"; // something went wrong

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Parse the minimum BTC amount from a log line like:
 *  "Send at least 0.00050324 BTC to bcrt1p..."
 */
function parseMinAmount(logs: string[]): string | null {
  for (const line of [...logs].reverse()) {
    const match = line.match(/Send at least ([\d.]+) BTC/);
    if (match) return match[1];
  }
  return null;
}

/** Parse the deposit address from the same log line */
function parseDepositAddress(logs: string[]): string | null {
  for (const line of [...logs].reverse()) {
    const match = line.match(/Send at least [\d.]+ BTC to (\S+)/);
    if (match) return match[1];
  }
  return null;
}

/** Check if logs indicate the fidelity bond was successfully created */
function bondCreated(logs: string[]): boolean {
  return logs.some((l) => l.includes("Successfully created fidelity bond"));
}

/** Check if logs indicate the maker is fully live */
function makerLive(logs: string[]): boolean {
  return logs.some(
    (l) =>
      l.includes("Taproot maker server listening on port") ||
      l.includes("maker server listening on port"),
  );
}

/** Check if logs indicate funds were found */
function fundsDetected(logs: string[]): boolean {
  return logs.some(
    (l) =>
      l.includes("Transaction seen in mempool") ||
      l.includes("Selected 1 regular UTXOs") ||
      l.includes("Coinselection"),
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function MakerSetup() {
  const { makerId } = useParams<{ makerId: string }>();
  const navigate = useNavigate();

  const [stage, setStage] = useState<SetupStage>("starting");
  const [logs, setLogs] = useState<string[]>([]);
  const [depositAddress, setDepositAddress] = useState<string | null>(null);
  const [minAmount, setMinAmount] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const logsEndRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const id = makerId!;

  // ─── Auto-scroll logs ─────────────────────────────────────────────────────

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  // ─── Start maker + stream logs ────────────────────────────────────────────

  useEffect(() => {
    let stopStream: (() => void) | null = null;

    async function boot() {
      try {
        const status = await monitoring.status(id);
        if (status.is_server_running) {
          setStage("live");
          stopStream = streamLogs(id, (line) =>
            setLogs((prev) => [...prev, line]),
          );

          return;
        }
      } catch {
        // not running, continue with normal boot
      }

      try {
        await makers.start(id);
      } catch (err) {
        if (!(err instanceof ApiError && err.status === 409)) {
          setErrorMsg(
            err instanceof Error ? err.message : "Failed to start maker",
          );
          setStage("error");
          return;
        }
      }

      setStage("awaiting_funds");

      // Stream logs in real time
      stopStream = streamLogs(
        id,
        (line) => {
          setLogs((prev) => {
            const next = [...prev, line];

            // Parse deposit address and min amount from logs
            const addr = parseDepositAddress(next);
            const amt = parseMinAmount(next);
            if (addr) setDepositAddress(addr);
            if (amt) setMinAmount(amt);

            // Advance stage based on log content
            if (fundsDetected(next)) setStage("creating_bond");
            if (bondCreated(next) || makerLive(next)) setStage("live");

            return next;
          });
        },
        () => {
          // SSE error — fall back to polling logs
        },
      );
    }

    boot();

    return () => {
      stopStream?.();
    };
  }, [id]);

  // ─── Poll balance as fallback fund detection ───────────────────────────────

  useEffect(() => {
    if (stage !== "awaiting_funds") return;

    pollRef.current = setInterval(async () => {
      try {
        const balance = await wallet.balance(id);
        if (balance.regular > 0 || balance.spendable > 0) {
          setStage("creating_bond");
        }
      } catch {
        // ignore poll errors
      }
    }, 10_000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [stage, id]);

  // ─── Poll status for bond confirmation ────────────────────────────────────

  useEffect(() => {
    if (stage !== "creating_bond") return;

    pollRef.current = setInterval(async () => {
      try {
        const status = await monitoring.status(id);
        if (status.is_server_running) {
          setStage("live");
        }
      } catch {
        // ignore
      }
    }, 8_000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [stage, id]);

  // ─── Copy address ─────────────────────────────────────────────────────────

  function copyAddress() {
    if (!depositAddress) return;
    navigator.clipboard.writeText(depositAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // ─── Stage metadata ───────────────────────────────────────────────────────

  const stageConfig = {
    starting: {
      icon: (
        <div className="w-16 h-16 rounded-full bg-gray-800 border-2 border-orange-500 flex items-center justify-center">
          <svg
            className="w-7 h-7 text-orange-500 animate-spin"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8v8z"
            />
          </svg>
        </div>
      ),
      title: "Starting Maker",
      subtitle: "Initializing wallet and connecting to Bitcoin Core…",
      color: "orange",
    },
    awaiting_funds: {
      icon: (
        <div className="w-16 h-16 rounded-full bg-orange-500/10 border-2 border-orange-500 flex items-center justify-center">
          <Bitcoin className="w-8 h-8 text-orange-500" />
        </div>
      ),
      title: "Deposit Required",
      subtitle: "Send Bitcoin to this address to create your fidelity bond",
      color: "orange",
    },
    creating_bond: {
      icon: (
        <div className="w-16 h-16 rounded-full bg-blue-500/10 border-2 border-blue-500 flex items-center justify-center">
          <svg
            className="w-7 h-7 text-blue-400 animate-spin"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8v8z"
            />
          </svg>
        </div>
      ),
      title: "Creating Fidelity Bond",
      subtitle: "Funds detected — waiting for confirmation and bond creation…",
      color: "blue",
    },
    live: {
      icon: (
        <div className="w-16 h-16 rounded-full bg-emerald-500/10 border-2 border-emerald-500 flex items-center justify-center">
          <Check className="w-8 h-8 text-emerald-500" />
        </div>
      ),
      title: "Maker is Live!",
      subtitle: "Your maker is active on the coinswap network",
      color: "emerald",
    },
    error: {
      icon: (
        <div className="w-16 h-16 rounded-full bg-red-500/10 border-2 border-red-500 flex items-center justify-center">
          <X className="w-8 h-8 text-red-500" />
        </div>
      ),
      title: "Setup Failed",
      subtitle: errorMsg ?? "Something went wrong during setup",
      color: "red",
    },
  };

  const current = stageConfig[stage];

  // ─── Step indicators ──────────────────────────────────────────────────────

  const steps = [
    { key: "starting", label: "Start" },
    { key: "awaiting_funds", label: "Fund" },
    { key: "creating_bond", label: "Bond" },
    { key: "live", label: "Live" },
  ] as const;

  const stageOrder = ["starting", "awaiting_funds", "creating_bond", "live"];
  const currentIndex = stageOrder.indexOf(stage);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <Nav />

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <button
            onClick={() => navigate("/")}
            className="p-2 hover:bg-gray-800 rounded-lg transition-all"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 19l-7-7 7-7"
              />
            </svg>
          </button>
          <div>
            <h1 className="text-2xl font-bold">Setting Up Maker</h1>
            <p className="text-sm text-gray-400 font-mono">{id}</p>
          </div>
        </div>

        {/* Step progress */}
        <div className="flex items-center justify-between mb-10 px-2">
          {steps.map((step, i) => {
            const isDone = stageOrder.indexOf(step.key) < currentIndex;
            const isActive = step.key === stage;
            return (
              <div
                key={step.key}
                className="flex items-center flex-1 last:flex-none"
              >
                <div className="flex flex-col items-center gap-1">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-all ${
                      isDone
                        ? "bg-emerald-600 text-white"
                        : isActive
                          ? "bg-orange-600 text-white"
                          : "bg-gray-800 text-gray-500"
                    }`}
                  >
                    {isDone ? <Check className="w-4 h-4" /> : i + 1}
                  </div>
                  <span
                    className={`text-xs ${isActive ? "text-orange-400" : isDone ? "text-emerald-400" : "text-gray-500"}`}
                  >
                    {step.label}
                  </span>
                </div>
                {i < steps.length - 1 && (
                  <div
                    className={`flex-1 h-0.5 mx-2 mb-5 transition-all ${
                      stageOrder.indexOf(step.key) < currentIndex
                        ? "bg-emerald-600"
                        : "bg-gray-800"
                    }`}
                  />
                )}
              </div>
            );
          })}
        </div>

        {/* Main card */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 sm:p-8 mb-6">
          {/* Stage icon + title */}
          <div className="flex flex-col items-center text-center mb-8">
            {current.icon}
            <h2 className="text-xl font-bold mt-4">{current.title}</h2>
            <p className="text-gray-400 text-sm mt-1 max-w-sm">
              {current.subtitle}
            </p>
          </div>

          {/* ── Awaiting funds: show deposit address ── */}
          {stage === "awaiting_funds" && (
            <div className="space-y-5">
              <div className="bg-gray-800 border border-gray-700 rounded-xl p-5">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm text-gray-400">Deposit Address</span>
                  {depositAddress && (
                    <button
                      onClick={copyAddress}
                      className="text-xs px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded-lg transition-all flex items-center gap-1.5"
                    >
                      {copied ? (
                        <>
                          <svg
                            className="w-3.5 h-3.5 text-emerald-400"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M5 13l4 4L19 7"
                            />
                          </svg>
                          Copied!
                        </>
                      ) : (
                        <>
                          <svg
                            className="w-3.5 h-3.5"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                            />
                          </svg>
                          Copy
                        </>
                      )}
                    </button>
                  )}
                </div>
                {depositAddress ? (
                  <div
                    onClick={copyAddress}
                    className="font-mono text-sm text-orange-300 break-all cursor-pointer hover:text-orange-200 transition-colors"
                  >
                    {depositAddress}
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-gray-500 text-sm">
                    <svg
                      className="w-4 h-4 animate-spin"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8v8z"
                      />
                    </svg>
                    Waiting for server to generate address…
                  </div>
                )}
              </div>

              {minAmount && (
                <div className="flex items-center gap-3 bg-orange-500/10 border border-orange-500/30 rounded-xl p-4">
                  <svg
                    className="w-5 h-5 text-orange-400 flex-shrink-0"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  <div className="text-sm">
                    <span className="text-gray-300">Send at least </span>
                    <span className="font-bold text-orange-400">
                      {minAmount} BTC
                    </span>
                    <span className="text-gray-300">
                      {" "}
                      to create your fidelity bond. Any extra goes to your
                      wallet balance.
                    </span>
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2 text-xs text-gray-500">
                <svg
                  className="w-3.5 h-3.5 animate-spin flex-shrink-0"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8v8z"
                  />
                </svg>
                Watching for incoming funds — this page will update
                automatically
              </div>
            </div>
          )}

          {/* ── Creating bond: progress indicator ── */}
          {stage === "creating_bond" && (
            <div className="space-y-4">
              <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-4 flex items-center gap-3">
                <svg
                  className="w-5 h-5 text-blue-400 flex-shrink-0"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                <span className="text-sm text-blue-200">
                  Funds detected — creating fidelity bond transaction
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <svg
                  className="w-3.5 h-3.5 animate-spin flex-shrink-0"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8v8z"
                  />
                </svg>
                Waiting for block confirmation…
              </div>
            </div>
          )}

          {/* ── Live: success ── */}
          {stage === "live" && (
            <div className="space-y-4">
              <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4 flex items-center gap-3">
                <svg
                  className="w-5 h-5 text-emerald-400 flex-shrink-0"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                <span className="text-sm text-emerald-200">
                  Fidelity bond confirmed. Your maker is live on the coinswap
                  network and accepting swaps.
                </span>
              </div>
              <button
                onClick={() => navigate("/")}
                className="w-full py-3 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-all font-semibold"
              >
                Go to Dashboard
              </button>
            </div>
          )}

          {/* ── Error ── */}
          {stage === "error" && (
            <div className="space-y-4">
              <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-sm text-red-300">
                {errorMsg}
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => navigate("/addMaker")}
                  className="flex-1 py-3 border border-gray-700 rounded-lg hover:bg-gray-800 transition-all font-semibold text-sm"
                >
                  Back
                </button>
                <button
                  onClick={() => window.location.reload()}
                  className="flex-1 py-3 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-all font-semibold text-sm"
                >
                  Retry
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Live log tail */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
            <span className="text-sm font-medium text-gray-300">Logs</span>
            <div className="flex items-center gap-1.5 text-xs text-gray-500">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Live
            </div>
          </div>
          <div className="bg-black p-4 font-mono text-xs h-48 overflow-y-auto">
            {logs.length === 0 ? (
              <span className="text-gray-600">Waiting for logs…</span>
            ) : (
              logs.map((line, i) => (
                <div
                  key={i}
                  className={`leading-5 ${
                    line.includes("ERROR")
                      ? "text-red-400"
                      : line.includes("WARN")
                        ? "text-yellow-400"
                        : line.includes("Successfully") ||
                            line.includes("listening on port")
                          ? "text-emerald-400"
                          : line.includes("Send at least")
                            ? "text-orange-300"
                            : "text-gray-400"
                  }`}
                >
                  {line}
                </div>
              ))
            )}
            <div ref={logsEndRef} />
          </div>
        </div>
      </main>
    </div>
  );
}
