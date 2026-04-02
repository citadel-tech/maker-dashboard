import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { X } from "lucide-react";
import Nav from "../components/Nav";
import OnboardingWizard from "./onboarding";
import {
  makers,
  wallet,
  monitoring,
  streamLogs,
  satsToBtc,
  type MakerInfoDetailed,
  type BalanceInfo,
  type MakerState,
  type SwapReportDto,
  type UtxoInfo,
} from "../api.ts";

// ─── Types ────────────────────────────────────────────────────────────────────

interface MakerRow {
  id: string;
  state: MakerState;
  alive: boolean;
  balance: BalanceInfo | null;
  torAddress: string | null;
  dataDir: string | null;
  earningsSats: number | null;
  swapReportCount: number | null;
  swapActive: UtxoInfo[];
  swapCompleted: UtxoInfo[];
}

const SWAP_HISTORY_REFRESH_MS = 60_000;
const TRANSIENT_SWAP_SIGNAL_MS = 30_000;
type MakerFilter = "all" | "running";

function swapKey(
  utxo: Pick<UtxoInfo, "addr" | "amount" | "utxo_type">,
  makerId?: string,
) {
  return [makerId, utxo.addr, utxo.amount, utxo.utxo_type]
    .filter(Boolean)
    .join(":");
}

function truncateMiddle(value: string, start = 18, end = 14) {
  if (value.length <= start + end + 1) return value;
  return `${value.slice(0, start)}...${value.slice(-end)}`;
}

const SWAP_LOG_KEYWORDS = ["new connection from"];

function isSwapLogLine(line: string): boolean {
  const lower = line.toLowerCase();
  return SWAP_LOG_KEYWORDS.some((kw) => lower.includes(kw));
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Home() {
  const [makerRows, setMakerRows] = useState<MakerRow[]>([]);
  const [makerFilter, setMakerFilter] = useState<MakerFilter>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [logSwapSeenAt, setLogSwapSeenAt] = useState<Record<string, number>>(
    {},
  );
  const [swapBannerDismissed, setSwapBannerDismissed] = useState(false);
  const swapHistoryCache = useRef<Record<string, UtxoInfo[]>>({});
  const swapReportCache = useRef<Record<string, SwapReportDto[]>>({});
  const lastSwapRefreshAt = useRef(0);

  async function loadMakers(forceSwapRefresh = false) {
    try {
      setError(null);
      const list = await makers.list();
      const includeSwaps =
        forceSwapRefresh ||
        lastSwapRefreshAt.current === 0 ||
        Date.now() - lastSwapRefreshAt.current >= SWAP_HISTORY_REFRESH_MS;
      const rows = await Promise.all(
        list.map(async ({ id }): Promise<MakerRow> => {
          const requests = [
            makers.get(id),
            wallet.balance(id),
            monitoring.status(id),
            monitoring.torAddress(id),
            includeSwaps
              ? monitoring.swapReports(id)
              : Promise.resolve(swapReportCache.current[id] ?? []),
            includeSwaps
              ? monitoring.swaps(id)
              : Promise.resolve({
                  active: [],
                  completed: swapHistoryCache.current[id] ?? [],
                }),
          ] as const;
          const [detail, bal, status, tor, reports, swaps] =
            await Promise.allSettled(requests);
          const info: MakerInfoDetailed | null =
            detail.status === "fulfilled" ? detail.value : null;
          const balData: BalanceInfo | null =
            bal.status === "fulfilled" ? bal.value : null;
          const alive =
            status.status === "fulfilled" ? status.value.alive : false;
          const torAddress = tor.status === "fulfilled" ? tor.value : null;
          const dataDir =
            info?.data_directory && info.data_directory.length > 0
              ? info.data_directory
              : null;
          const swapReports =
            reports.status === "fulfilled" ? reports.value : null;
          const swapActive =
            swaps.status === "fulfilled" ? swaps.value.active : [];
          const swapCompleted =
            swaps.status === "fulfilled" ? swaps.value.completed : [];
          const earningsSats =
            swapReports !== null
              ? swapReports.reduce((sum, r) => sum + r.fee_paid_or_earned, 0)
              : null;
          const swapReportCount =
            swapReports !== null ? swapReports.length : null;
          if (includeSwaps && reports.status === "fulfilled") {
            swapReportCache.current[id] = reports.value;
          }
          if (includeSwaps && swaps.status === "fulfilled") {
            swapHistoryCache.current[id] = swaps.value.completed;
          }
          return {
            id,
            state: info?.state ?? "stopped",
            alive,
            balance: balData,
            torAddress,
            dataDir,
            earningsSats,
            swapReportCount,
            swapActive,
            swapCompleted,
          };
        }),
      );
      if (includeSwaps) {
        lastSwapRefreshAt.current = Date.now();
      }
      setMakerRows(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load makers");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadMakers(true);
    const interval = setInterval(() => {
      void loadMakers();
    }, 15_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const runningIds = new Set(
      makerRows
        .filter((maker) => maker.state === "running")
        .map((maker) => maker.id),
    );

    setLogSwapSeenAt((prev) => {
      const next = Object.fromEntries(
        Object.entries(prev).filter(([id]) => runningIds.has(id)),
      );
      return Object.keys(next).length === Object.keys(prev).length
        ? prev
        : next;
    });

    const stops = Array.from(runningIds).map((id) =>
      streamLogs(id, (line) => {
        if (!isSwapLogLine(line)) return;
        setSwapBannerDismissed(false);
        setLogSwapSeenAt((prev) => {
          return { ...prev, [id]: Date.now() };
        });
      }),
    );

    const pruneInterval = setInterval(() => {
      setLogSwapSeenAt((prev) => {
        const cutoff = Date.now() - TRANSIENT_SWAP_SIGNAL_MS;
        const next = Object.fromEntries(
          Object.entries(prev).filter(
            ([id, seenAt]) => runningIds.has(id) && seenAt >= cutoff,
          ),
        );
        return Object.keys(next).length === Object.keys(prev).length
          ? prev
          : next;
      });
    }, 5_000);

    return () => {
      clearInterval(pruneInterval);
      for (const stop of stops) stop();
    };
  }, [makerRows]);

  async function toggleMaker(id: string, currentState: MakerState) {
    setPending((prev) => new Set(prev).add(id));
    try {
      if (currentState === "running") await makers.stop(id);
      else await makers.start(id);
      await loadMakers(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setPending((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 text-gray-100">
        <Nav />
        <div className="flex items-center justify-center h-64">
          <div className="text-gray-400 animate-pulse">Loading makers…</div>
        </div>
      </div>
    );
  }

  // No makers — show guided onboarding instead of empty dashboard
  if (makerRows.length === 0) {
    return <OnboardingWizard />;
  }

  const totalSpendableSats = makerRows.reduce(
    (sum, m) => sum + (m.balance?.spendable ?? 0),
    0,
  );
  const reportsPartial = makerRows.some((m) => m.earningsSats === null);
  const totalEarningsSats = makerRows.reduce(
    (sum, m) => sum + (m.earningsSats ?? 0),
    0,
  );
  const totalEarningsBtc = satsToBtc(totalEarningsSats);
  const totalSwaps = makerRows.reduce(
    (sum, m) => sum + (m.swapReportCount ?? 0),
    0,
  );
  const onlineCount = makerRows.filter((m) => m.alive).length;
  const runningCount = makerRows.filter((m) => m.state === "running").length;
  const visibleMakerRows =
    makerFilter === "running"
      ? makerRows.filter((m) => m.state === "running")
      : makerRows;
  const swapSignalCutoff = Date.now() - TRANSIENT_SWAP_SIGNAL_MS;

  const anySwapping = makerRows.some(
    (m) =>
      m.swapActive.length > 0 ||
      (m.state === "running" && (logSwapSeenAt[m.id] ?? 0) >= swapSignalCutoff),
  );
  const showSwapBanner = anySwapping && !swapBannerDismissed;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <Nav />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8 animate-slide-in-up">
        {showSwapBanner && (
          <div className="mb-6 px-4 py-3 bg-orange-950/60 border border-orange-500 rounded-lg text-sm text-orange-200 flex justify-between items-center gap-3 sticky top-4 z-10 backdrop-blur-sm shadow-lg shadow-orange-500/10">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-orange-400 animate-pulse shrink-0" />
              <span>
                <strong>
                  One or more makers are currently in an active swap.
                </strong>{" "}
                Do not reload the page or remove a maker until the swap
                completes.
              </span>
            </div>
            <button
              onClick={() => setSwapBannerDismissed(true)}
              className="shrink-0 text-orange-400 hover:text-orange-200 transition-colors"
              aria-label="Dismiss swap warning"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
        {error && (
          <div className="mb-6 px-4 py-3 bg-red-900/40 border border-red-700 rounded-lg text-sm text-red-300 flex justify-between items-center">
            <span>{error}</span>
            <button
              onClick={() => setError(null)}
              className="ml-4 text-red-400 hover:text-red-200 font-bold"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5 mb-6 sm:mb-8">
          <div className="bg-gray-900 p-4 sm:p-5 rounded-xl border border-gray-800 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md hover:shadow-orange-500/5">
            <div className="text-sm text-gray-400 mb-2">Total Spendable</div>
            <div className="text-2xl sm:text-3xl font-bold text-orange-500">
              {satsToBtc(totalSpendableSats)} BTC
            </div>
            <div className="text-xs text-gray-500 mt-1">
              Across {makerRows.length} maker{makerRows.length !== 1 ? "s" : ""}
            </div>
          </div>
          <div className="bg-gray-900 p-4 sm:p-5 rounded-xl border border-gray-800 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md hover:shadow-orange-500/5">
            <div className="text-sm text-gray-400 mb-2">System Health</div>
            <div className="text-2xl sm:text-3xl font-bold text-purple-500">
              {onlineCount}/{makerRows.length}
            </div>
            <div className="text-xs text-gray-500 mt-1">Makers online</div>
          </div>
          <div className="bg-gray-900 p-4 sm:p-5 rounded-xl border border-gray-800 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md hover:shadow-orange-500/5">
            <div className="text-sm text-gray-400 mb-2">Running</div>
            <div className="text-2xl sm:text-3xl font-bold text-emerald-500">
              {runningCount}
            </div>
            <div className="text-xs text-gray-500 mt-1">
              {makerRows.length - runningCount} stopped
            </div>
          </div>
          <div className="bg-gray-900 p-4 sm:p-5 rounded-xl border border-gray-800 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md hover:shadow-orange-500/5">
            <div className="text-sm text-gray-400 mb-2">Net Earnings</div>
            <div
              className={`text-2xl sm:text-3xl font-bold ${
                totalEarningsSats >= 0 ? "text-emerald-500" : "text-red-300"
              }`}
            >
              {totalEarningsBtc} BTC
            </div>
            <div className="text-xs text-gray-500 mt-1">
              {`$${(parseFloat(totalEarningsBtc) * 95000).toLocaleString(
                undefined,
                { maximumFractionDigits: 2 },
              )}`}
            </div>
            <div className="text-xs text-gray-500 mt-1">
              Across {totalSwaps} swap{totalSwaps === 1 ? "" : "s"}
            </div>
            {reportsPartial && (
              <div className="text-xs text-yellow-500 mt-1">
                Partial data — some reports unavailable
              </div>
            )}
          </div>
        </div>

        {/* Makers list */}
        <div className="mb-6 sm:mb-8">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-4 sm:mb-5 gap-3">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
              <h2 className="text-lg sm:text-xl font-semibold">Your Makers</h2>
              <div className="inline-flex w-full sm:w-auto rounded-lg border border-gray-800 bg-gray-900 p-1">
                <button
                  type="button"
                  onClick={() => setMakerFilter("all")}
                  className={`flex-1 sm:flex-none rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    makerFilter === "all"
                      ? "bg-orange-600 text-white"
                      : "text-gray-400 hover:text-gray-200"
                  }`}
                >
                  All ({makerRows.length})
                </button>
                <button
                  type="button"
                  onClick={() => setMakerFilter("running")}
                  className={`flex-1 sm:flex-none rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    makerFilter === "running"
                      ? "bg-emerald-600 text-white"
                      : "text-gray-400 hover:text-gray-200"
                  }`}
                >
                  Running ({runningCount})
                </button>
              </div>
            </div>
            <Link
              to="/addMaker"
              className="px-4 sm:px-5 py-2 sm:py-2.5 bg-orange-600 text-white rounded-lg hover:bg-orange-700 active:scale-[0.97] transition-all duration-150 font-semibold text-sm w-full sm:w-auto text-center"
            >
              + Add New Maker
            </Link>
          </div>

          {visibleMakerRows.length === 0 ? (
            <div className="rounded-xl border border-gray-800 bg-gray-900 px-4 py-8 text-center text-sm text-gray-400">
              No running makers right now. Switch back to All to see stopped
              makers.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-5">
              {visibleMakerRows.map((maker) => {
                const isRunning = maker.state === "running";
                const isPending = pending.has(maker.id);
                const isSwapping =
                  maker.swapActive.length > 0 ||
                  (maker.state === "running" &&
                    (logSwapSeenAt[maker.id] ?? 0) >= swapSignalCutoff);
                return (
                  <div
                    key={maker.id}
                    className={`group bg-gray-900 border rounded-xl p-4 sm:p-5 hover:-translate-y-0.5 transition-all duration-200 ${
                      isSwapping
                        ? "border-orange-500 animate-swap-glow hover:shadow-xl hover:shadow-orange-500/20"
                        : "border-gray-800 hover:border-orange-500 hover:shadow-lg hover:shadow-orange-500/10"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-3 sm:mb-4">
                      <div className="flex items-center gap-2">
                        <span
                          className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                            maker.alive
                              ? "bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.5)] animate-pulse"
                              : "bg-gray-600"
                          }`}
                        />
                        <h3 className="text-base sm:text-lg font-semibold truncate">
                          {maker.id}
                        </h3>
                      </div>
                      <div className="flex items-center gap-2">
                        {isSwapping && (
                          <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium bg-orange-900/50 text-orange-400 animate-pulse">
                            <span className="w-1.5 h-1.5 rounded-full bg-orange-400" />
                            Swap Active
                          </span>
                        )}
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                            isRunning
                              ? "bg-emerald-900/50 text-emerald-400"
                              : "bg-gray-800 text-gray-500"
                          }`}
                        >
                          {isRunning ? "Running" : "Stopped"}
                        </span>
                      </div>
                    </div>

                    {maker.torAddress && (
                      <div className="mb-3 px-3 py-2 bg-gray-800 rounded-lg">
                        <div className="text-xs text-gray-400 mb-1">
                          Tor Address
                        </div>
                        <div
                          className="font-mono text-xs text-orange-300 break-all"
                          title={maker.torAddress}
                        >
                          {truncateMiddle(maker.torAddress)}
                        </div>
                      </div>
                    )}

                    {maker.dataDir && (
                      <div className="mb-3 px-3 py-2 bg-gray-800 rounded-lg">
                        <div className="text-xs text-gray-400 mb-1">
                          Data Directory
                        </div>
                        <div
                          className="font-mono text-xs text-gray-200 break-all"
                          title={maker.dataDir}
                        >
                          {truncateMiddle(maker.dataDir, 20, 16)}
                        </div>
                      </div>
                    )}

                    {maker.balance ? (
                      <div className="grid grid-cols-2 gap-3 mb-3 sm:mb-4">
                        <div>
                          <div className="text-xs text-gray-400 mb-1">
                            Spendable
                          </div>
                          <div className="text-sm font-semibold text-emerald-400">
                            {satsToBtc(maker.balance.spendable)} BTC
                          </div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-400 mb-1">
                            Regular
                          </div>
                          <div className="text-sm font-semibold">
                            {satsToBtc(maker.balance.regular)} BTC
                          </div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-400 mb-1">Swap</div>
                          <div className="text-sm font-semibold">
                            {satsToBtc(maker.balance.swap)} BTC
                          </div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-400 mb-1">
                            Fidelity
                          </div>
                          <div className="text-sm font-semibold">
                            {satsToBtc(maker.balance.fidelity)} BTC
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="text-xs text-gray-500 mb-4 italic">
                        {isRunning ? "Balance unavailable" : "Maker is stopped"}
                      </div>
                    )}

                    <div className="flex gap-2">
                      <Link
                        to={`/makerDetails/${maker.id}`}
                        className="flex-1 text-center py-2 px-3 sm:px-4 bg-orange-600 text-white rounded-lg hover:bg-orange-700 active:scale-[0.97] transition-all duration-150 text-sm font-semibold"
                      >
                        Manage
                      </Link>
                      <button
                        disabled={isPending}
                        onClick={() => toggleMaker(maker.id, maker.state)}
                        className={`py-2 px-3 sm:px-4 rounded-lg border transition-all duration-150 text-sm active:scale-[0.97] ${
                          isPending
                            ? "border-gray-700 text-gray-600 cursor-not-allowed"
                            : isRunning
                              ? "border-gray-700 hover:bg-gray-800 hover:border-orange-500"
                              : "border-emerald-700 text-emerald-400 hover:bg-emerald-900/30"
                        }`}
                      >
                        {isPending ? "…" : isRunning ? "Stop" : "Start"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Recent Activity */}
        <div>
          <h2 className="text-lg sm:text-xl font-semibold mb-4 sm:mb-5">
            Recent Activity
          </h2>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 sm:p-6">
            {(() => {
              const recentSwaps = makerRows
                .flatMap((r) =>
                  r.swapCompleted.map((u) => ({ ...u, makerId: r.id })),
                )
                .slice(0, 10);

              if (recentSwaps.length === 0) {
                return (
                  <p className="text-sm text-gray-500 text-center">
                    No completed swaps yet
                  </p>
                );
              }

              return (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-gray-400 text-left border-b border-gray-800">
                        <th className="pb-2 pr-4">Maker</th>
                        <th className="pb-2 pr-4">Amount</th>
                        <th className="pb-2">Type</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800">
                      {recentSwaps.map((s) => (
                        <tr
                          key={swapKey(s, s.makerId)}
                          className="transition-colors duration-150 hover:bg-gray-800/50"
                        >
                          <td className="py-2 pr-4">
                            <span className="font-mono text-xs bg-gray-800 px-2 py-0.5 rounded">
                              {s.makerId}
                            </span>
                          </td>
                          <td className="py-2 pr-4 text-orange-400 font-medium">
                            {satsToBtc(s.amount)} BTC
                          </td>
                          <td className="py-2 text-gray-300">
                            <span className="font-mono text-xs bg-gray-800 px-2 py-0.5 rounded capitalize">
                              {s.utxo_type}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })()}
          </div>
        </div>
      </main>
    </div>
  );
}
