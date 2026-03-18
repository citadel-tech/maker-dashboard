import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  makers,
  monitoring,
  type MakerInfoDetailed,
  type RpcStatusInfo,
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
  const [taproot, setTaproot] = useState(false);
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
  const [baseFee, setBaseFee] = useState(100);
  const [amountRelativeFeePct, setAmountRelativeFeePct] = useState(0.1);
  const [fidelityAmount, setFidelityAmount] = useState(50000);
  const [fidelityTimelock, setFidelityTimelock] = useState(13104);

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

  // ── Load ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    makers
      .get(id)
      .then((info: MakerInfoDetailed) => {
        setRpc(info.rpc ?? "");
        setZmq(info.zmq ?? "");
        setTaproot(info.taproot ?? false);
        setDataDir(info.data_directory ?? "");
        setNetworkPort(info.network_port ?? 6102);
        setRpcPort(info.rpc_port ?? 6103);
        setSocksPort(info.socks_port ?? 9050);
        setControlPort(info.control_port ?? 9051);
        setMinSwapAmount(info.min_swap_amount ?? 10000);
        setBaseFee(info.base_fee ?? 100);
        setAmountRelativeFeePct(info.amount_relative_fee_pct ?? 0.1);
        setFidelityAmount(info.fidelity_amount ?? 50000);
        setFidelityTimelock(info.fidelity_timelock ?? 13104);
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
        taproot,
        data_directory: dataDir || undefined,
        network_port: networkPort,
        rpc_port: rpcPort,
        socks_port: socksPort,
        control_port: controlPort,
        min_swap_amount: minSwapAmount,
        fidelity_amount: fidelityAmount,
        fidelity_timelock: fidelityTimelock,
        base_fee: baseFee,
        amount_relative_fee_pct: amountRelativeFeePct,
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
    <div className="space-y-6">
      {loadError && (
        <div className="bg-red-950 border border-red-800 text-red-300 rounded-xl p-4 text-sm">
          Failed to load config: {loadError}
        </div>
      )}

      {/* ── Bitcoin Core RPC ──────────────────────────────────────────────── */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 sm:p-6">
        <h3 className="text-lg font-semibold mb-6">Bitcoin Core RPC</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className="block text-sm text-gray-400 mb-2">
              RPC Endpoint
            </label>
            <input
              type="text"
              value={rpc}
              onChange={(e) => setRpc(e.target.value)}
              placeholder="127.0.0.1:18443"
              className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg focus:border-orange-500 focus:outline-none focus:shadow-[0_0_0_3px_rgba(249,115,22,0.15)] transition-shadow duration-200 text-gray-100 font-mono text-sm"
            />
            <p className="text-xs text-gray-500 mt-1">
              8332 mainnet · 18332 testnet · 18443 regtest · 38332 signet
            </p>
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-2">
              RPC Username
            </label>
            <input
              type="text"
              value={rpcUser}
              onChange={(e) => setRpcUser(e.target.value)}
              placeholder="Leave blank to keep current"
              className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg focus:border-orange-500 focus:outline-none focus:shadow-[0_0_0_3px_rgba(249,115,22,0.15)] transition-shadow duration-200 text-gray-100"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-2">
              RPC Password
            </label>
            <div className="relative">
              <input
                type={showRpcPassword ? "text" : "password"}
                value={rpcPassword}
                onChange={(e) => setRpcPassword(e.target.value)}
                placeholder="Leave blank to keep current"
                className="w-full px-4 py-2.5 pr-12 bg-gray-800 border border-gray-700 rounded-lg focus:border-orange-500 focus:outline-none focus:shadow-[0_0_0_3px_rgba(249,115,22,0.15)] transition-shadow duration-200 text-gray-100"
              />
              <button
                type="button"
                onClick={() => setShowRpcPassword(!showRpcPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-100 transition-colors"
              >
                <EyeIcon open={showRpcPassword} />
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Username and password must be provided together
            </p>
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-2">
              Data Directory
            </label>
            <input
              type="text"
              value={dataDir}
              onChange={(e) => setDataDir(e.target.value)}
              placeholder="~/.coinswap/maker"
              className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg focus:border-orange-500 focus:outline-none focus:shadow-[0_0_0_3px_rgba(249,115,22,0.15)] transition-shadow duration-200 text-gray-100 font-mono text-sm"
            />
          </div>
          <div className="flex items-end">
            <div className="flex items-center justify-between bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 w-full">
              <div>
                <div className="text-sm text-gray-200">Taproot</div>
                <div className="text-xs text-gray-500">
                  Use taproot wallet type
                </div>
              </div>
              <button
                type="button"
                onClick={() => setTaproot(!taproot)}
                className={`relative w-11 h-6 rounded-full transition-colors duration-200 ml-4 shrink-0 ${taproot ? "bg-orange-500" : "bg-gray-600"}`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${taproot ? "translate-x-5" : "translate-x-0"}`}
                />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Test Connection ───────────────────────────────────────────────── */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 sm:p-6">
        <div className="flex items-center gap-3 mb-6">
          <h3 className="text-lg font-semibold">Test Connection</h3>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
            <div className="flex justify-between items-center mb-4">
              <div className="flex items-center gap-2">
                <div
                  className={`w-3 h-3 rounded-full ${
                    rpcStatus === null
                      ? "bg-gray-600"
                      : rpcStatus.connected
                        ? "bg-green-500"
                        : "bg-red-500"
                  }`}
                />
                <span className="text-sm text-gray-400">Connection Status</span>
              </div>
              <span
                className={`text-sm font-semibold ${
                  rpcStatus === null
                    ? "text-gray-500"
                    : rpcStatus.connected
                      ? "text-green-400"
                      : "text-red-400"
                }`}
              >
                {rpcStatus === null
                  ? "Unknown"
                  : rpcStatus.connected
                    ? "Connected"
                    : "Disconnected"}
              </span>
            </div>
            <div className="space-y-2 text-xs">
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
                <div key={label} className="flex justify-between">
                  <span className="text-gray-500">{label}</span>
                  <span
                    className={val === "--" ? "text-gray-600" : "text-gray-300"}
                  >
                    {val}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className="flex flex-col justify-center gap-3">
            <p className="text-sm text-gray-400">
              Tests connectivity to the configured Bitcoin Core RPC endpoint and
              returns node info.
            </p>
            {rpcTestError && (
              <p className="text-xs text-red-400">{rpcTestError}</p>
            )}
            <button
              type="button"
              onClick={handleTestConnection}
              disabled={rpcTesting}
              className="w-full py-3 bg-orange-600 hover:bg-orange-500 active:scale-[0.98] disabled:bg-gray-800 disabled:border disabled:border-dashed disabled:border-gray-600 disabled:text-gray-500 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-all duration-150"
            >
              {rpcTesting ? "Testing…" : "Test Connection"}
            </button>
          </div>
        </div>
      </div>

      {/* ── ZMQ ──────────────────────────────────────────────────────────── */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 sm:p-6">
        <h3 className="text-lg font-semibold mb-6">ZMQ Configuration</h3>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="space-y-4">
            <div>
              <label className="block text-sm text-gray-400 mb-2">
                ZMQ Endpoint
              </label>
              <input
                type="text"
                value={zmq}
                onChange={(e) => setZmq(e.target.value)}
                placeholder="tcp://127.0.0.1:28332"
                className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg focus:border-orange-500 focus:outline-none focus:shadow-[0_0_0_3px_rgba(249,115,22,0.15)] transition-shadow duration-200 text-gray-100 font-mono text-sm"
              />
              <p className="text-xs text-gray-500 mt-1">
                Used for both zmqpubrawblock and zmqpubrawtx
              </p>
            </div>
            <div className="bg-yellow-900/20 border border-yellow-800/30 rounded-lg p-3">
              <p className="text-xs text-yellow-400">
                <strong>Note:</strong> Both zmqpubrawblock and zmqpubrawtx must
                use the same endpoint.
              </p>
            </div>
          </div>
          <div className="space-y-3">
            <h4 className="text-sm font-medium text-gray-300">
              bitcoin.conf snippet
            </h4>
            <div className="bg-gray-800 rounded-lg p-4 font-mono text-xs text-gray-300">
              zmqpubrawblock={zmq || "tcp://127.0.0.1:28332"}
              <br />
              zmqpubrawtx={zmq || "tcp://127.0.0.1:28332"}
            </div>
            <button
              type="button"
              onClick={copyZmqConfig}
              className="w-full bg-gray-800 hover:bg-gray-700 text-white py-2 rounded-lg text-sm transition-all"
            >
              {copied ? "Copied!" : "Copy ZMQ Config"}
            </button>
          </div>
        </div>
      </div>

      {/* ── Network Ports ─────────────────────────────────────────────────── */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 sm:p-6">
        <h3 className="text-lg font-semibold mb-2">Network Ports</h3>
        <p className="text-sm text-gray-400 mb-6">
          Each maker must use unique ports to avoid clashes when running
          multiple makers on the same machine.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label
              htmlFor="networkPort"
              className="block text-sm text-gray-400 mb-2"
            >
              Network Port
            </label>
            <input
              type="number"
              value={networkPort}
              min={1}
              max={65535}
              onChange={(e) => setNetworkPort(Number(e.target.value))}
              className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg focus:border-orange-500 focus:outline-none focus:shadow-[0_0_0_3px_rgba(249,115,22,0.15)] transition-shadow duration-200 text-gray-100 font-mono"
            />
            <p className="text-xs text-gray-500 mt-1">
              Port for coinswap client connections (default 6102)
            </p>
          </div>
          <div>
            <label
              htmlFor="rpcPort"
              className="block text-sm text-gray-400 mb-2"
            >
              RPC Port
            </label>
            <input
              type="number"
              value={rpcPort}
              min={1}
              max={65535}
              onChange={(e) => setRpcPort(Number(e.target.value))}
              className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg focus:border-orange-500 focus:outline-none focus:shadow-[0_0_0_3px_rgba(249,115,22,0.15)] transition-shadow duration-200 text-gray-100 font-mono"
            />
            <p className="text-xs text-gray-500 mt-1">
              Port for maker-cli operations (default 6103)
            </p>
          </div>
        </div>
      </div>

      {/* ── Tor ──────────────────────────────────────────────────────────── */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 sm:p-6">
        <h3 className="text-lg font-semibold mb-6">Tor Configuration</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm text-gray-400 mb-2">
              Tor Auth Password
            </label>
            <div className="relative">
              <input
                type={showTorAuth ? "text" : "password"}
                value={torAuth}
                onChange={(e) => setTorAuth(e.target.value)}
                placeholder="Leave blank to keep current"
                className="w-full px-4 py-2.5 pr-12 bg-gray-800 border border-gray-700 rounded-lg focus:border-orange-500 focus:outline-none focus:shadow-[0_0_0_3px_rgba(249,115,22,0.15)] transition-shadow duration-200 text-gray-100"
              />
              <button
                type="button"
                onClick={() => setShowTorAuth(!showTorAuth)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-100 transition-colors"
              >
                <EyeIcon open={showTorAuth} />
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Authentication password for Tor control port
            </p>
          </div>
          <div>
            <label
              htmlFor="socksPort"
              className="block text-sm text-gray-400 mb-2"
            >
              SOCKS Port
            </label>
            <input
              type="number"
              value={socksPort}
              min={1}
              max={65535}
              onChange={(e) => setSocksPort(Number(e.target.value))}
              className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg focus:border-orange-500 focus:outline-none focus:shadow-[0_0_0_3px_rgba(249,115,22,0.15)] transition-shadow duration-200 text-gray-100 font-mono"
            />
            <p className="text-xs text-gray-500 mt-1">
              SOCKS5 proxy port for Tor (default 9050)
            </p>
          </div>
          <div>
            <label
              htmlFor="controlPort"
              className="block text-sm text-gray-400 mb-2"
            >
              Control Port
            </label>
            <input
              type="number"
              min={1}
              max={65535}
              value={controlPort}
              onChange={(e) => setControlPort(Number(e.target.value))}
              className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg focus:border-orange-500 focus:outline-none focus:shadow-[0_0_0_3px_rgba(249,115,22,0.15)] transition-shadow duration-200 text-gray-100 font-mono"
            />
            <p className="text-xs text-gray-500 mt-1">
              Control port for Tor interface (default 9051)
            </p>
          </div>
        </div>
      </div>

      {/* ── Swap & Fidelity ───────────────────────────────────────────────── */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 sm:p-6">
        <h3 className="text-lg font-semibold mb-6">
          Swap & Fidelity Configuration
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label
              htmlFor="minSwapAmount"
              className="block text-sm text-gray-400 mb-2"
            >
              Minimum Swap Amount (sats)
            </label>
            <input
              type="number"
              min={1}
              value={minSwapAmount}
              onChange={(e) => setMinSwapAmount(Number(e.target.value))}
              className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg focus:border-orange-500 focus:outline-none focus:shadow-[0_0_0_3px_rgba(249,115,22,0.15)] transition-shadow duration-200 text-gray-100 font-mono"
            />
          </div>
          <div>
            <label
              htmlFor="baseFee"
              className="block text-sm text-gray-400 mb-2"
            >
              Base Fee (sats)
            </label>
            <input
              type="number"
              min={0}
              value={baseFee}
              onChange={(e) => setBaseFee(Number(e.target.value))}
              className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg focus:border-orange-500 focus:outline-none focus:shadow-[0_0_0_3px_rgba(249,115,22,0.15)] transition-shadow duration-200 text-gray-100 font-mono"
            />
          </div>
          <div>
            <label
              htmlFor="amountRelativeFeePct"
              className="block text-sm text-gray-400 mb-2"
            >
              Amount Relative Fee (%)
            </label>
            <input
              type="number"
              min={0}
              max={100}
              step="0.01"
              value={amountRelativeFeePct}
              onChange={(e) => setAmountRelativeFeePct(Number(e.target.value))}
              className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg focus:border-orange-500 focus:outline-none focus:shadow-[0_0_0_3px_rgba(249,115,22,0.15)] transition-shadow duration-200 text-gray-100 font-mono"
            />
          </div>
          <div>
            <label
              htmlFor="fidelityAmount"
              className="block text-sm text-gray-400 mb-2"
            >
              Fidelity Amount (sats)
            </label>
            <input
              type="number"
              min={1}
              value={fidelityAmount}
              onChange={(e) => setFidelityAmount(Number(e.target.value))}
              className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg focus:border-orange-500 focus:outline-none focus:shadow-[0_0_0_3px_rgba(249,115,22,0.15)] transition-shadow duration-200 text-gray-100 font-mono"
            />
          </div>
          <div>
            <label
              htmlFor="fidelityTimelock"
              className="block text-sm text-gray-400 mb-2"
            >
              Fidelity Timelock (blocks)
            </label>
            <input
              type="number"
              min={12960}
              max={25920}
              value={fidelityTimelock}
              onChange={(e) => setFidelityTimelock(Number(e.target.value))}
              className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg focus:border-orange-500 focus:outline-none focus:shadow-[0_0_0_3px_rgba(249,115,22,0.15)] transition-shadow duration-200 text-gray-100 font-mono"
            />
            <p className="text-xs text-gray-500 mt-1">
              Must be between 12960 and 25920 blocks
            </p>
          </div>
        </div>
      </div>

      {/* ── Save ─────────────────────────────────────────────────────────── */}
      {saveResult && (
        <div
          className={`rounded-xl px-4 py-3 text-sm ${
            saveResult.ok
              ? "bg-green-950 border border-green-800 text-green-300"
              : "bg-red-950 border border-red-800 text-red-300"
          }`}
        >
          {saveResult.msg}
        </div>
      )}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="flex-1 px-6 py-3 bg-orange-600 text-white rounded-lg hover:bg-orange-700 active:scale-[0.98] transition-all duration-150 font-semibold disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save & Restart Maker"}
        </button>
      </div>

      <div className="bg-blue-900/20 border border-blue-800/30 rounded-lg p-4">
        <p className="text-xs text-blue-400">
          <strong>Note:</strong> Saving stops the maker, writes the new config
          to <code className="bg-blue-900/30 px-1 rounded">config.toml</code>,
          then restarts it automatically. Password fields are write-only — leave
          blank to keep the current value. Make sure each maker uses unique
          network and RPC ports.
        </p>
      </div>

      {/* ── Danger Zone ──────────────────────────────────────────────────── */}
      <div className="bg-gray-900 border border-red-900/40 rounded-xl p-4 sm:p-6">
        <h3 className="text-lg font-semibold text-red-400 mb-2">Danger Zone</h3>
        <p className="text-sm text-gray-400 mb-4">
          Remove this maker from the dashboard. This does not affect your funds
          or on-chain state.
        </p>
        <button
          type="button"
          onClick={() => setShowRemoveModal(true)}
          className="px-6 py-2.5 bg-transparent border border-red-700 text-red-400 rounded-lg hover:bg-red-900/20 hover:shadow-md hover:shadow-red-500/20 active:scale-[0.97] transition-all duration-150 text-sm font-semibold"
        >
          Remove Maker
        </button>
      </div>

      {/* ── Remove Modal ─────────────────────────────────────────────────── */}
      {showRemoveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 max-w-md w-full shadow-2xl">
            <h2 className="text-xl font-bold mb-1">Remove Maker</h2>
            <p className="text-sm text-gray-400 mb-6">
              Before you continue, please understand what this does and doesn't
              do.
            </p>
            <div className="space-y-3 mb-6">
              {[
                {
                  icon: "✓",
                  color: "text-green-400",
                  text: (
                    <>
                      Removes <strong className="text-white">{id}</strong> from
                      this dashboard
                    </>
                  ),
                },
                {
                  icon: "✓",
                  color: "text-green-400",
                  text: "Stops the maker process if it is currently running",
                },
                {
                  icon: "✗",
                  color: "text-red-400",
                  text: (
                    <>
                      <strong className="text-white">Does not</strong> delete
                      your wallet or funds — those remain in the data directory
                    </>
                  ),
                },
                {
                  icon: "✗",
                  color: "text-red-400",
                  text: (
                    <>
                      <strong className="text-white">Does not</strong> affect
                      any on-chain state, fidelity bonds, or coinswap history
                    </>
                  ),
                },
                {
                  icon: "✗",
                  color: "text-red-400",
                  text: 'Cannot undo blockchain transactions — nothing on-chain is ever "deleted"',
                },
              ].map((item, i) => (
                <div key={i} className="flex gap-3 bg-gray-800 rounded-lg p-3">
                  <span className={`${item.color} mt-0.5`}>{item.icon}</span>
                  <p className="text-sm text-gray-300">{item.text}</p>
                </div>
              ))}
            </div>
            <p className="text-xs text-gray-500 mb-6">
              You can re-add this maker at any time by pointing to the same data
              directory.
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setShowRemoveModal(false)}
                disabled={removing}
                className="flex-1 px-4 py-2.5 bg-gray-800 hover:bg-gray-700 active:scale-[0.97] text-gray-100 rounded-lg transition-all duration-150 text-sm font-semibold disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleRemove}
                disabled={removing}
                className="flex-1 px-4 py-2.5 bg-red-700 hover:bg-red-600 active:scale-[0.97] text-white rounded-lg transition-all duration-150 text-sm font-semibold disabled:opacity-50"
              >
                {removing ? "Removing…" : "Yes, Remove Maker"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
