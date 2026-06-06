import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { Check, X as XIcon } from "lucide-react";
import {
  makers,
  monitoring,
  onboarding,
  type MakerInfoDetailed,
  type RpcStatusInfo,
  type StartupCheckResponse,
} from "../../api";

interface Props {
  id: string;
  onSaved?: () => void;
}

function EyeIcon({ open }: { open: boolean }) {
  return open ? (
    <svg
      className="w-5 h-5"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
      />
    </svg>
  ) : (
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
        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
      />
    </svg>
  );
}

export default function Settings({ id, onSaved }: Props) {
  const navigate = useNavigate();
  const [loadError, setLoadError] = useState<string | null>(null);

  // ── Bitcoin Core RPC ──────────────────────────────────────────────────────
  const [rpc, setRpc] = useState("");
  const [zmq, setZmq] = useState("");
  const [rpcUser, setRpcUser] = useState("");
  const [rpcPassword, setRpcPassword] = useState("");
  const [dataDir, setDataDir] = useState("");

  // ── Tor ───────────────────────────────────────────────────────────────────
  const [torAuth, setTorAuth] = useState("");
  const [socksPort, setSocksPort] = useState(9050);
  const [controlPort, setControlPort] = useState(9051);

  // ── Network ports ─────────────────────────────────────────────────────────
  const [networkPort, setNetworkPort] = useState(6102);
  const [rpcPort, setRpcPort] = useState(6103);

  // ── Swap & Fidelity ───────────────────────────────────────────────────────
  const [minSwapAmount, setMinSwapAmount] = useState(10000);
  const [requiredConfirms, setRequiredConfirms] = useState(1);
  const [baseFee, setBaseFee] = useState(1000);
  const [amountRelativeFeePct, setAmountRelativeFeePct] = useState(0.025);
  const [timeRelativeFeePct, setTimeRelativeFeePct] = useState(0.001);
  const [fidelityAmount, setFidelityAmount] = useState(10000);
  const [fidelityTimelock, setFidelityTimelock] = useState(15000);

  // ── UI state ──────────────────────────────────────────────────────────────
  const [showRpcPassword, setShowRpcPassword] = useState(false);
  const [showTorAuth, setShowTorAuth] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<{
    ok: boolean;
    msg: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const [showRemoveModal, setShowRemoveModal] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [rpcStatus, setRpcStatus] = useState<RpcStatusInfo | null>(null);
  const [rpcTesting, setRpcTesting] = useState(false);
  const [rpcTestError, setRpcTestError] = useState<string | null>(null);
  const [torStatus, setTorStatus] = useState<StartupCheckResponse | null>(null);
  const [torTesting, setTorTesting] = useState(false);
  const [torTestError, setTorTestError] = useState<string | null>(null);

  // ── Load ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    makers
      .get(id)
      .then((info: MakerInfoDetailed) => {
        setRpc(info.rpc ?? "");
        setZmq(info.zmq ?? "");
        setDataDir(info.data_directory ?? "");
        setNetworkPort(info.network_port ?? 6102);
        setRpcPort(info.rpc_port ?? 6103);
        setSocksPort(info.socks_port ?? 9050);
        setControlPort(info.control_port ?? 9051);
        setMinSwapAmount(info.min_swap_amount ?? 10000);
        setRequiredConfirms(info.required_confirms ?? 1);
        setBaseFee(info.base_fee ?? 1000);
        setAmountRelativeFeePct(info.amount_relative_fee_pct ?? 0.025);
        setTimeRelativeFeePct(info.time_relative_fee_pct ?? 0.001);
        setFidelityAmount(info.fidelity_amount ?? 10000);
        setFidelityTimelock(info.fidelity_timelock ?? 15000);
        // passwords / ports not returned by API — keep defaults
      })
      .catch((e: Error) => setLoadError(e.message));
  }, [id]);

  function validate(): string | null {
    if (
      networkPort === 0 ||
      rpcPort === 0 ||
      socksPort === 0 ||
      controlPort === 0
    )
      return "Port values must be between 1 and 65535";
    if (new Set([networkPort, rpcPort]).size !== 2)
      return "Network Port and RPC Port must be different";
    if (fidelityTimelock < 12960 || fidelityTimelock > 25920)
      return "Fidelity timelock must be between 12960 and 25920 blocks";
    if (minSwapAmount === 0)
      return "Minimum swap amount must be greater than 0";
    if (!Number.isInteger(requiredConfirms) || requiredConfirms < 0)
      return "Required confirmations must be an integer 0 or greater";
    if (fidelityAmount === 0) return "Fidelity amount must be greater than 0";
    return null;
  }

  // ── Save ──────────────────────────────────────────────────────────────────
  async function handleSave() {
    const validationError = validate();
    if (validationError) {
      setSaveResult({ ok: false, msg: validationError });
      return;
    }
    setSaving(true);
    setSaveResult(null);
    try {
      await makers.updateConfig(id, {
        rpc: rpc || undefined,
        zmq: zmq || undefined,
        rpc_user: rpcUser || undefined,
        rpc_password: rpcPassword || undefined,
        tor_auth: torAuth || undefined,
        data_directory: dataDir || undefined,
        network_port: networkPort,
        rpc_port: rpcPort,
        socks_port: socksPort,
        control_port: controlPort,
        min_swap_amount: minSwapAmount,
        fidelity_amount: fidelityAmount,
        fidelity_timelock: fidelityTimelock,
        required_confirms: requiredConfirms,
        base_fee: baseFee,
        amount_relative_fee_pct: amountRelativeFeePct,
        time_relative_fee_pct: timeRelativeFeePct,
      });

      setSaveResult({
        ok: true,
        msg: "Config saved — maker is stopping, rewriting config.toml, and restarting…",
      });
      setRpcPassword("");
      setTorAuth("");
      setTimeout(() => onSaved?.(), 2000);
    } catch (e) {
      setSaveResult({
        ok: false,
        msg: e instanceof Error ? e.message : "Save failed",
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleTestConnection() {
    setRpcTesting(true);
    setRpcTestError(null);
    setRpcStatus(null);
    try {
      const status = await monitoring.rpcStatus(id);
      setRpcStatus(status);
    } catch (e: unknown) {
      setRpcTestError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setRpcTesting(false);
    }
  }

  async function handleTestTor() {
    setTorTesting(true);
    setTorTestError(null);
    setTorStatus(null);
    try {
      const status = await onboarding.startupCheck({
        check: "tor",
        socks_port: socksPort,
        control_port: controlPort,
      });
      setTorStatus(status);
    } catch (e: unknown) {
      setTorTestError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setTorTesting(false);
    }
  }

  function copyZmqConfig() {
    navigator.clipboard
      .writeText(`zmqpubrawblock=${zmq}\nzmqpubrawtx=${zmq}`)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {});
  }

  async function handleRemove() {
    setRemoving(true);
    try {
      await makers.delete(id);
      navigate("/");
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to remove maker");
      setRemoving(false);
      setShowRemoveModal(false);
    }
  }

  return (
    <div className="cs-section">
      <div className="cs-label">Settings · maker instance config</div>

      {loadError && (
        <div className="cs-banner warn">Failed to load config: {loadError}</div>
      )}

      <section className="cs-card">
        <div className="cs-card-head">
          <h2>Bitcoin Core RPC, ZMQ &amp; Tor Configuration</h2>
          <span className="cs-card-meta">Edit · runtime config</span>
        </div>

        <div className="cs-subsection">
          <div className="cs-subtitle text-[var(--cs-orange)]">
            <span className="cs-pip" />
            Bitcoin Core RPC
          </div>
          <div className="cs-field-grid">
            <div className="cs-field">
              <label>RPC Endpoint</label>
              <input
                type="text"
                value={rpc}
                onChange={(e) => setRpc(e.target.value)}
                placeholder="127.0.0.1:38332"
                className="cs-input"
              />
              <p className="cs-hint">
                Default ports — <code>8332</code> mainnet · <code>18332</code>{" "}
                testnet · <code>38332</code> signet
              </p>
            </div>

            <div className="cs-field">
              <label>Data Directory</label>
              <input
                type="text"
                value={dataDir}
                onChange={(e) => setDataDir(e.target.value)}
                placeholder="~/.coinswap/maker"
                className="cs-input"
              />
              <p className="cs-hint">
                Defaults to <code>~/.coinswap/&lt;id&gt;</code>
              </p>
            </div>

            <div className="cs-field">
              <label>RPC Username</label>
              <input
                type="text"
                value={rpcUser}
                onChange={(e) => setRpcUser(e.target.value)}
                placeholder="Leave blank to keep current"
                className="cs-input"
              />
              <p className="cs-hint">
                Username and password must be provided together
              </p>
            </div>

            <div className="cs-field">
              <label>RPC Password</label>
              <div className="cs-input-wrap">
                <input
                  type={showRpcPassword ? "text" : "password"}
                  value={rpcPassword}
                  onChange={(e) => setRpcPassword(e.target.value)}
                  placeholder="Leave blank to keep current"
                  className="cs-input"
                />
                <button
                  type="button"
                  onClick={() => setShowRpcPassword(!showRpcPassword)}
                  className="cs-eye"
                  aria-label={
                    showRpcPassword ? "Hide RPC password" : "Show RPC password"
                  }
                >
                  <EyeIcon open={showRpcPassword} />
                </button>
              </div>
              <p className="cs-hint">Write-only field · current value hidden</p>
            </div>
          </div>
        </div>

        <div className="cs-subsection">
          <div className="cs-subtitle text-[var(--cs-blue)]">
            <span className="cs-pip" />
            ZMQ Configuration
          </div>
          <div className="cs-field-grid">
            <div className="cs-field">
              <label>ZMQ Endpoint</label>
              <input
                type="text"
                value={zmq}
                onChange={(e) => setZmq(e.target.value)}
                placeholder="tcp://127.0.0.1:28332"
                className="cs-input"
              />
              <p className="cs-hint">
                Used for both <code>zmqpubrawblock</code> and{" "}
                <code>zmqpubrawtx</code>
              </p>
            </div>

            <div className="cs-field">
              <label>
                bitcoin.conf snippet{" "}
                <span className="cs-card-meta ml-2">Read-only</span>
              </label>
              <pre className="cs-code">{`zmqpubrawblock=${zmq || "tcp://127.0.0.1:28332"}
zmqpubrawtx=${zmq || "tcp://127.0.0.1:28332"}`}</pre>
            </div>

            <div className="cs-span-2">
              <div className="cs-banner warn">
                <span>
                  <strong>Note:</strong> Both <code>zmqpubrawblock</code> and{" "}
                  <code>zmqpubrawtx</code> must use the same endpoint.
                </span>
              </div>
            </div>

            <div className="cs-span-2 flex flex-wrap items-center justify-between gap-3">
              <p className="cs-hint">
                Copy these lines into your <code>bitcoin.conf</code> and restart
                Bitcoin Core.
              </p>
              <button
                type="button"
                onClick={copyZmqConfig}
                className="cs-btn ghost sm"
              >
                {copied ? "Copied" : "Copy ZMQ Config"}
              </button>
            </div>
          </div>
        </div>

        <div className="cs-subsection">
          <div className="cs-subtitle text-[var(--cs-purple)]">
            <span className="cs-pip" />
            Tor Configuration
          </div>
          <div className="cs-field-grid cols-3">
            <div className="cs-field">
              <label>Tor Auth Password</label>
              <div className="cs-input-wrap">
                <input
                  type={showTorAuth ? "text" : "password"}
                  value={torAuth}
                  onChange={(e) => setTorAuth(e.target.value)}
                  placeholder="Leave blank if no auth configured"
                  className="cs-input"
                />
                <button
                  type="button"
                  onClick={() => setShowTorAuth(!showTorAuth)}
                  className="cs-eye"
                  aria-label={
                    showTorAuth ? "Hide Tor password" : "Show Tor password"
                  }
                >
                  <EyeIcon open={showTorAuth} />
                </button>
              </div>
              <p className="cs-hint">
                Required if Tor uses <code>HashedControlPassword</code>
              </p>
            </div>

            <div className="cs-field">
              <label>SOCKS Port</label>
              <input
                type="number"
                value={socksPort}
                min={1}
                max={65535}
                onChange={(e) => setSocksPort(Number(e.target.value))}
                className="cs-input"
              />
              <p className="cs-hint">
                SOCKS proxy port — default <code>9050</code>
              </p>
            </div>

            <div className="cs-field">
              <label>Control Port</label>
              <input
                type="number"
                min={1}
                max={65535}
                value={controlPort}
                onChange={(e) => setControlPort(Number(e.target.value))}
                className="cs-input"
              />
              <p className="cs-hint">
                Tor control interface — default <code>9051</code>
              </p>
            </div>
          </div>

          <div className="mt-[18px] flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-[260px] flex-1 rounded-[10px] border border-[var(--cs-border)] bg-[var(--cs-surface-3)] p-4">
              <div className="mb-3 grid gap-3 border-b border-dashed border-[var(--cs-border)] pb-3 md:grid-cols-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="cs-label flex items-center gap-2">
                    <span
                      className={`cs-dot ${
                        rpcStatus === null
                          ? "text-[var(--cs-text-3)]"
                          : rpcStatus.connected
                            ? "text-[var(--cs-green)]"
                            : "text-[var(--cs-red)]"
                      }`}
                    />
                    Bitcoin
                  </span>
                  <span
                    className={`cs-card-meta ${
                      rpcStatus === null
                        ? ""
                        : rpcStatus.connected
                          ? "text-[var(--cs-green)]"
                          : "text-[var(--cs-red)]"
                    }`}
                  >
                    {rpcStatus === null
                      ? "Unknown"
                      : rpcStatus.connected
                        ? "Connected"
                        : "Disconnected"}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-3">
                  <span className="cs-label flex items-center gap-2">
                    <span
                      className={`cs-dot ${
                        torStatus === null
                          ? "text-[var(--cs-text-3)]"
                          : torStatus.success
                            ? "text-[var(--cs-green)]"
                            : "text-[var(--cs-red)]"
                      }`}
                    />
                    Tor
                  </span>
                  <span
                    className={`cs-card-meta ${
                      torStatus === null
                        ? ""
                        : torStatus.success
                          ? "text-[var(--cs-green)]"
                          : "text-[var(--cs-red)]"
                    }`}
                  >
                    {torStatus === null
                      ? "Unknown"
                      : torStatus.success
                        ? "Reachable"
                        : "Failed"}
                  </span>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-2 text-[11px] sm:grid-cols-2">
                {(
                  [
                    [
                      "Bitcoin Version",
                      rpcStatus?.version !== undefined
                        ? String(rpcStatus.version)
                        : "--",
                    ],
                    ["Network", rpcStatus?.network ?? "--"],
                    [
                      "Block Height",
                      rpcStatus?.block_height !== undefined
                        ? rpcStatus.block_height.toLocaleString()
                        : "--",
                    ],
                    [
                      "Sync Progress",
                      rpcStatus?.sync_progress !== undefined
                        ? `${(rpcStatus.sync_progress * 100).toFixed(2)}%`
                        : "--",
                    ],
                  ] as [string, string][]
                ).map(([label, val]) => (
                  <div key={label} className="flex justify-between gap-3">
                    <span className="cs-dim">{label}</span>
                    <span className="cs-mono cs-muted">{val}</span>
                  </div>
                ))}
              </div>
              {torStatus && (
                <div className="cs-diagnostic mt-3 rounded-md border border-[var(--cs-border)] bg-[rgba(255,255,255,0.03)] px-3 py-2">
                  <div className="cs-label mb-1">Tor Result</div>
                  <p className="m-0 cs-muted">{torStatus.message}</p>
                  {torStatus.detail && (
                    <p className="m-0 mt-1 cs-dim">{torStatus.detail}</p>
                  )}
                </div>
              )}
              {rpcTestError && (
                <p className="mt-3 text-xs text-[var(--cs-red)]">
                  {rpcTestError}
                </p>
              )}
              {torTestError && (
                <p className="mt-3 text-xs text-[var(--cs-red)]">
                  {torTestError}
                </p>
              )}
            </div>

            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                onClick={handleTestConnection}
                disabled={rpcTesting}
                className="cs-btn primary sm"
              >
                {rpcTesting ? "Testing..." : "Test Bitcoin"}
              </button>
              <button
                type="button"
                onClick={handleTestTor}
                disabled={torTesting}
                className="cs-btn primary sm"
              >
                {torTesting ? "Testing..." : "Test Tor"}
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="cs-card">
        <div className="cs-card-head">
          <h2>Network Ports</h2>
          <span className="cs-card-meta">Unique per maker</span>
        </div>
        <div className="cs-card-body">
          <p className="mb-4 text-[12.5px] cs-muted">
            Each maker must use unique ports to avoid clashes when running
            multiple makers on the same machine.
          </p>
          <div className="cs-field-grid">
            <div className="cs-field">
              <label htmlFor="networkPort">Network Port</label>
              <input
                id="networkPort"
                type="number"
                value={networkPort}
                min={1}
                max={65535}
                onChange={(e) => setNetworkPort(Number(e.target.value))}
                className="cs-input"
              />
              <p className="cs-hint">
                For coinswap client connections (default <code>6102</code>)
              </p>
            </div>
            <div className="cs-field">
              <label htmlFor="rpcPort">RPC Port</label>
              <input
                id="rpcPort"
                type="number"
                value={rpcPort}
                min={1}
                max={65535}
                onChange={(e) => setRpcPort(Number(e.target.value))}
                className="cs-input"
              />
              <p className="cs-hint">
                For maker-cli operations (default <code>6103</code>)
              </p>
            </div>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-[14px] xl:grid-cols-2">
        <section className="cs-card">
          <div className="cs-card-head">
            <h2>Swap Settings</h2>
            <span className="cs-card-meta">Pricing &amp; thresholds</span>
          </div>
          <div className="cs-card-body">
            <div className="cs-field-grid">
              <div className="cs-field">
                <label htmlFor="minSwapAmount">Minimum Swap Amount</label>
                <div className="cs-input-wrap">
                  <input
                    id="minSwapAmount"
                    type="number"
                    min={1}
                    value={minSwapAmount}
                    onChange={(e) => setMinSwapAmount(Number(e.target.value))}
                    className="cs-input pr-16"
                  />
                  <span className="cs-unit">丰</span>
                </div>
                <p className="cs-hint">Smallest swap this maker will accept</p>
              </div>

              <div className="cs-field">
                <label htmlFor="requiredConfirms">Required Confirmations</label>
                <input
                  id="requiredConfirms"
                  type="number"
                  min={0}
                  step={1}
                  value={requiredConfirms}
                  onChange={(e) => setRequiredConfirms(Number(e.target.value))}
                  className="cs-input"
                />
                <p className="cs-hint">
                  Funding confirmations before progressing a swap
                </p>
              </div>

              <div className="cs-field">
                <label htmlFor="baseFee">Base Fee</label>
                <div className="cs-input-wrap">
                  <input
                    id="baseFee"
                    type="number"
                    min={0}
                    value={baseFee}
                    placeholder="1000"
                    onChange={(e) => setBaseFee(Number(e.target.value))}
                    className="cs-input pr-16"
                  />
                  <span className="cs-unit">丰</span>
                </div>
                <p className="cs-hint">Flat fee charged per swap</p>
              </div>

              <div className="cs-field">
                <label htmlFor="amountRelativeFeePct">
                  Amount Relative Fee
                </label>
                <input
                  id="amountRelativeFeePct"
                  type="number"
                  min={0}
                  max={1}
                  step="0.001"
                  value={amountRelativeFeePct}
                  placeholder="0.025"
                  onChange={(e) =>
                    setAmountRelativeFeePct(Number(e.target.value))
                  }
                  className="cs-input"
                />
                <p className="cs-hint">
                  Decimal 0–1 · <code>0.025</code> = 2.5%
                </p>
              </div>

              <div className="cs-field cs-span-2">
                <label htmlFor="timeRelativeFeePct">Time Relative Fee</label>
                <input
                  id="timeRelativeFeePct"
                  type="number"
                  min={0}
                  max={1}
                  step="0.001"
                  value={timeRelativeFeePct}
                  placeholder="0.001"
                  onChange={(e) =>
                    setTimeRelativeFeePct(Number(e.target.value))
                  }
                  className="cs-input"
                />
                <p className="cs-hint">
                  Decimal 0–1 · <code>0.001</code> = 0.1% per block
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="cs-card">
          <div className="cs-card-head">
            <h2>Fidelity Bond</h2>
            <span className="cs-card-meta">Reputation stake</span>
          </div>
          <div className="cs-card-body">
            <div className="cs-field-grid">
              <div className="cs-field cs-span-2">
                <label htmlFor="fidelityAmount">Fidelity Amount</label>
                <div className="cs-input-wrap">
                  <input
                    id="fidelityAmount"
                    type="number"
                    min={1}
                    value={fidelityAmount}
                    placeholder="10000"
                    onChange={(e) => setFidelityAmount(Number(e.target.value))}
                    className="cs-input pr-16"
                  />
                  <span className="cs-unit">丰</span>
                </div>
                <p className="cs-hint">
                  Locked stake — higher amount → higher trust score
                </p>
              </div>

              <div className="cs-field cs-span-2">
                <label htmlFor="fidelityTimelock">Fidelity Timelock</label>
                <div className="cs-input-wrap">
                  <input
                    id="fidelityTimelock"
                    type="number"
                    min={12960}
                    max={25920}
                    value={fidelityTimelock}
                    placeholder="15000"
                    onChange={(e) =>
                      setFidelityTimelock(Number(e.target.value))
                    }
                    className="cs-input pr-20"
                  />
                  <span className="cs-unit">BLOCKS</span>
                </div>
                <p className="cs-hint">
                  Must be between <code>12960</code> and <code>25920</code>{" "}
                  blocks (~90 d – 180 d)
                </p>
              </div>
            </div>
          </div>
        </section>
      </div>

      {saveResult && (
        <div className={`cs-banner ${saveResult.ok ? "info" : "warn"}`}>
          {saveResult.msg}
        </div>
      )}

      <div className="cs-save-bar">
        <p className="cs-hint max-w-3xl">
          Saving stops the maker, writes the new config to{" "}
          <code>config.toml</code>, then restarts it automatically. Password
          fields are write-only — leave blank to keep the current value.
        </p>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="cs-btn primary sm"
        >
          {saving ? "Saving..." : "Save & Restart Maker"}
        </button>
      </div>

      <section className="cs-danger-zone cs-rail">
        <div>
          <h2 className="m-0 text-[13px] font-semibold text-[var(--cs-red)]">
            Danger Zone
          </h2>
          <p className="m-0 mt-1 text-[12.5px] cs-muted">
            Remove this maker from the dashboard. Does not affect your funds or
            on-chain state.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowRemoveModal(true)}
          className="cs-btn danger sm"
        >
          Remove Maker
        </button>
      </section>

      {/* ── Remove Modal ─────────────────────────────────────────────────── */}
      {showRemoveModal &&
        createPortal(
          <div className="cs-modal-backdrop">
            <div className="cs-modal">
              <h2 className="mb-1 text-xl font-bold">Remove Maker</h2>
              <p className="mb-6 text-sm cs-muted">
                Before you continue, please understand what this does and
                doesn't do.
              </p>
              <div className="space-y-3 mb-6">
                {[
                  {
                    icon: <Check className="w-4 h-4" />,
                    color: "text-green-400",
                    text: (
                      <>
                        Removes <strong className="text-white">{id}</strong>{" "}
                        from this dashboard
                      </>
                    ),
                  },
                  {
                    icon: <Check className="w-4 h-4" />,
                    color: "text-green-400",
                    text: "Stops the maker process if it is currently running",
                  },
                  {
                    icon: <XIcon className="w-4 h-4" />,
                    color: "text-red-400",
                    text: (
                      <>
                        <strong className="text-white">Does not</strong> delete
                        your wallet or funds — those remain in the data
                        directory
                      </>
                    ),
                  },
                  {
                    icon: <XIcon className="w-4 h-4" />,
                    color: "text-red-400",
                    text: (
                      <>
                        <strong className="text-white">Does not</strong> affect
                        any on-chain state, fidelity bonds, or coinswap history
                      </>
                    ),
                  },
                  {
                    icon: <XIcon className="w-4 h-4" />,
                    color: "text-red-400",
                    text: 'Cannot undo blockchain transactions — nothing on-chain is ever "deleted"',
                  },
                ].map((item, i) => (
                  <div
                    key={i}
                    className="flex gap-3 rounded-lg border border-[var(--cs-border)] bg-[var(--cs-surface-3)] p-3"
                  >
                    <span className={`${item.color} mt-0.5`}>{item.icon}</span>
                    <p className="text-sm cs-muted">{item.text}</p>
                  </div>
                ))}
              </div>
              <p className="mb-6 text-xs cs-dim">
                You can re-add this maker at any time by pointing to the same
                data directory.
              </p>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowRemoveModal(false)}
                  disabled={removing}
                  className="cs-btn ghost flex-1"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleRemove}
                  disabled={removing}
                  className="cs-btn danger flex-1"
                >
                  {removing ? "Removing..." : "Yes, Remove Maker"}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
