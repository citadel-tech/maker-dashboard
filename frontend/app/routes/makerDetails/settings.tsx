import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { makers, type MakerInfoDetailed } from "../../api";

interface Props {
  id: string;
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

function ComingSoonBadge() {
  return (
    <span className="text-xs bg-gray-700 text-gray-400 px-2 py-0.5 rounded">
      Coming soon
    </span>
  );
}

export default function Settings({ id }: Props) {
  const [loadError, setLoadError] = useState<string | null>(null);

  // ── Form fields ───────────────────────────────────────────────────────────
  const [rpc, setRpc] = useState("");
  const [zmq, setZmq] = useState("");
  const [rpcUser, setRpcUser] = useState("");
  const [rpcPassword, setRpcPassword] = useState("");
  const [torAuth, setTorAuth] = useState("");
  const [walletName, setWalletName] = useState("");
  const [taproot, setTaproot] = useState(false);
  const [dataDir, setDataDir] = useState("");

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
  const navigate = useNavigate();

  // ── Load ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    makers
      .get(id)
      .then((info: MakerInfoDetailed) => {
        setRpc(info.rpc ?? "");
        setZmq(info.zmq ?? "");
        setWalletName(info.wallet_name ?? "");
        setTaproot(info.taproot ?? false);
        setDataDir(info.data_directory ?? "");
        // rpc_user / rpc_password / tor_auth are write-only — not returned by the API
      })
      .catch((e: Error) => setLoadError(e.message));
  }, [id]);

  // ── Save ──────────────────────────────────────────────────────────────────
  async function handleSave() {
    setSaving(true);
    setSaveResult(null);
    try {
      await makers.updateConfig(id, {
        rpc: rpc || undefined,
        zmq: zmq || undefined,
        rpc_user: rpcUser || undefined,
        rpc_password: rpcPassword || undefined,
        tor_auth: torAuth || undefined,
        wallet_name: walletName || undefined,
        taproot,
        data_directory: dataDir || undefined,
      });
      setSaveResult({ ok: true, msg: "Config saved. Maker is restarting…" });
      setRpcPassword("");
      setTorAuth("");
    } catch (e) {
      setSaveResult({
        ok: false,
        msg: e instanceof Error ? e.message : "Save failed",
      });
    } finally {
      setSaving(false);
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
              placeholder="127.0.0.1:38332"
              className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg focus:border-orange-500 focus:outline-none text-gray-100 font-mono text-sm"
            />
            <p className="text-xs text-gray-500 mt-1">
              host:port — 8332 mainnet · 18332 testnet · 18443 regtest · 38332
              signet
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
              className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg focus:border-orange-500 focus:outline-none text-gray-100"
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
                className="w-full px-4 py-2.5 pr-12 bg-gray-800 border border-gray-700 rounded-lg focus:border-orange-500 focus:outline-none text-gray-100"
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
              Wallet Name
            </label>
            <input
              type="text"
              value={walletName}
              onChange={(e) => setWalletName(e.target.value)}
              placeholder="Optional"
              className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg focus:border-orange-500 focus:outline-none text-gray-100"
            />
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
              className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg focus:border-orange-500 focus:outline-none text-gray-100 font-mono text-sm"
            />
          </div>

          <div className="sm:col-span-2">
            <div className="flex items-center justify-between bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 max-w-xs">
              <div>
                <div className="text-sm text-gray-200">Taproot</div>
                <div className="text-xs text-gray-500">
                  Use taproot wallet type
                </div>
              </div>
              <button
                type="button"
                onClick={() => setTaproot(!taproot)}
                className={`relative w-11 h-6 rounded-full transition-colors ml-6 ${
                  taproot ? "bg-orange-500" : "bg-gray-600"
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                    taproot ? "translate-x-5" : "translate-x-0"
                  }`}
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
          <ComingSoonBadge />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
            <div className="flex justify-between items-center mb-4">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-gray-600" />
                <span className="text-sm text-gray-400">Connection Status</span>
              </div>
              <span className="text-sm font-semibold text-gray-500">
                Unknown
              </span>
            </div>
            <div className="space-y-2 text-xs">
              {[
                ["Bitcoin Version", "--"],
                ["Network", "--"],
                ["Block Height", "--"],
                ["Sync Progress", "--"],
              ].map(([label, val]) => (
                <div key={label} className="flex justify-between">
                  <span className="text-gray-500">{label}</span>
                  <span className="text-gray-600">{val}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-col justify-center gap-3">
            <p className="text-sm text-gray-400">
              Tests connectivity to the configured Bitcoin Core RPC endpoint and
              returns node info.
            </p>
            <div title="Requires GET /makers/{id}/rpc-status — not yet implemented in the backend">
              <button
                type="button"
                disabled
                className="w-full py-3 bg-gray-800 border border-dashed border-gray-600 text-gray-500 font-semibold rounded-lg cursor-not-allowed"
              >
                Test Connection — not yet available
              </button>
            </div>
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
                className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg focus:border-orange-500 focus:outline-none text-gray-100 font-mono text-sm"
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
                className="w-full px-4 py-2.5 pr-12 bg-gray-800 border border-gray-700 rounded-lg focus:border-orange-500 focus:outline-none text-gray-100"
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

          <div className="opacity-50">
            <div className="flex items-center gap-2 mb-2">
              <label className="block text-sm text-gray-400">SOCKS Port</label>
              <ComingSoonBadge />
            </div>
            <input
              type="number"
              defaultValue="9050"
              disabled
              className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 cursor-not-allowed"
            />
            <p className="text-xs text-gray-500 mt-1">
              SOCKS5 proxy port for Tor
            </p>
          </div>

          <div className="opacity-50">
            <div className="flex items-center gap-2 mb-2">
              <label className="block text-sm text-gray-400">
                Control Port
              </label>
              <ComingSoonBadge />
            </div>
            <input
              type="number"
              defaultValue="9051"
              disabled
              className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 cursor-not-allowed"
            />
            <p className="text-xs text-gray-500 mt-1">
              Control port for Tor interface
            </p>
          </div>
        </div>
      </div>

      {/* ── Swap & Fidelity ───────────────────────────────────────────────── */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 sm:p-6 opacity-60">
        <div className="flex items-center gap-3 mb-6">
          <h3 className="text-lg font-semibold">
            Swap & Fidelity Configuration
          </h3>
          <ComingSoonBadge />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[
            ["Minimum Swap Amount (sats)", "10000"],
            ["Base Fee (sats)", "100"],
            ["Amount Relative Fee (%)", "0.1"],
            ["Fidelity Amount (sats)", "50000"],
            ["Fidelity Timelock (blocks)", "13104"],
          ].map(([label, val]) => (
            <div key={label}>
              <label className="block text-sm text-gray-400 mb-2">
                {label}
              </label>
              <input
                type="number"
                defaultValue={val}
                disabled
                className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 cursor-not-allowed"
              />
            </div>
          ))}
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
          className="flex-1 px-6 py-3 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-all font-semibold disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save & Restart Maker"}
        </button>
      </div>

      <div className="bg-blue-900/20 border border-blue-800/30 rounded-lg p-4">
        <p className="text-xs text-blue-400">
          <strong>Note:</strong> Saving will update the config and restart this
          maker. Password fields are write-only — leave blank to keep the
          current value.
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
          className="px-6 py-2.5 bg-transparent border border-red-700 text-red-400 rounded-lg hover:bg-red-900/20 transition-all text-sm font-semibold"
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
              <div className="flex gap-3 bg-gray-800 rounded-lg p-3">
                <span className="text-green-400 mt-0.5">✓</span>
                <p className="text-sm text-gray-300">
                  Removes <strong className="text-white">{id}</strong> from this
                  dashboard
                </p>
              </div>
              <div className="flex gap-3 bg-gray-800 rounded-lg p-3">
                <span className="text-green-400 mt-0.5">✓</span>
                <p className="text-sm text-gray-300">
                  Stops the maker process if it is currently running
                </p>
              </div>
              <div className="flex gap-3 bg-gray-800 rounded-lg p-3">
                <span className="text-red-400 mt-0.5">✗</span>
                <p className="text-sm text-gray-300">
                  Does <strong className="text-white">not</strong> delete your
                  wallet or funds — those remain in the data directory
                </p>
              </div>
              <div className="flex gap-3 bg-gray-800 rounded-lg p-3">
                <span className="text-red-400 mt-0.5">✗</span>
                <p className="text-sm text-gray-300">
                  Does <strong className="text-white">not</strong> affect any
                  on-chain state, fidelity bonds, or coinswap history
                </p>
              </div>
              <div className="flex gap-3 bg-gray-800 rounded-lg p-3">
                <span className="text-red-400 mt-0.5">✗</span>
                <p className="text-sm text-gray-300">
                  Cannot undo blockchain transactions — nothing on-chain is ever
                  "deleted"
                </p>
              </div>
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
                className="flex-1 px-4 py-2.5 bg-gray-800 hover:bg-gray-700 text-gray-100 rounded-lg transition-all text-sm font-semibold disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleRemove}
                disabled={removing}
                className="flex-1 px-4 py-2.5 bg-red-700 hover:bg-red-600 text-white rounded-lg transition-all text-sm font-semibold disabled:opacity-50"
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
