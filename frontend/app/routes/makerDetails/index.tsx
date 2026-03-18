import { useState, useEffect, useCallback } from "react";
import { useParams } from "react-router-dom";
import Nav from "../../components/Nav";
import {
  makers,
  wallet,
  monitoring,
  type MakerInfoDetailed,
  type BalanceInfo,
  type MakerStatus,
} from "../../api";
import { type Tab } from "./types";
import { ErrorBanner } from "./components";
import Dashboard from "./dashboard";
import Wallet from "./wallet";
import Swaps from "./history";
import Logs from "./log";
import Settings from "./settings";

const TABS: { id: Tab; label: string }[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "wallet", label: "Wallet" },
  { id: "swaps", label: "Swap History" },
  { id: "logs", label: "Logs" },
  { id: "settings", label: "Settings" },
];

export default function MakerDetails() {
  const { makerId } = useParams<{ makerId: string }>();
  const id = makerId ?? "";

  const [activeTab, setActiveTab] = useState<Tab>("dashboard");

  const [info, setInfo] = useState<MakerInfoDetailed | null>(null);
  const [status, setStatus] = useState<MakerStatus | null>(null);
  const [balances, setBalances] = useState<BalanceInfo | null>(null);
  const [torAddress, setTorAddress] = useState<string | null>(null);
  const [dataDir, setDataDir] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  const loadCore = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const [infoData, statusData, balanceData] = await Promise.allSettled([
        makers.get(id),
        monitoring.status(id),
        wallet.balance(id),
      ]);
      if (infoData.status === "fulfilled") setInfo(infoData.value);
      if (statusData.status === "fulfilled") setStatus(statusData.value);
      if (balanceData.status === "fulfilled") setBalances(balanceData.value);

      monitoring
        .torAddress(id)
        .then(setTorAddress)
        .catch(() => {});
      monitoring
        .dataDir(id)
        .then(setDataDir)
        .catch(() => {});
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load maker data");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadCore();
  }, [loadCore]);

  const isRunning = status?.is_server_running ?? info?.state === "running";

  async function handleStartStop() {
    setActionLoading(true);
    try {
      await (isRunning ? makers.stop(id) : makers.start(id));
      await loadCore();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Action failed");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleSync() {
    setSyncLoading(true);
    setSyncMsg(null);
    try {
      const msg = await wallet.sync(id);
      setSyncMsg(msg);
      wallet
        .balance(id)
        .then(setBalances)
        .catch(() => {});
    } catch (e) {
      setSyncMsg(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncLoading(false);
    }
  }

  const core = {
    id,
    info,
    status,
    balances,
    torAddress,
    dataDir,
    loading,
    isRunning,
  };

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <Nav />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8 animate-slide-in-up">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6 gap-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => window.history.back()}
              className="p-2 hover:bg-gray-800 rounded-lg transition-all duration-150 hover:-translate-x-0.5"
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
            <div className="flex items-center gap-3">
              <span
                className={`w-3 h-3 rounded-full flex-shrink-0 ${
                  isRunning
                    ? "bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.5)] animate-pulse"
                    : "bg-gray-600"
                }`}
              />
              <div>
                <h1 className="text-2xl sm:text-3xl font-bold">{id}</h1>
                {info?.rpc && (
                  <p className="text-sm text-gray-400">RPC: {info.rpc}</p>
                )}
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleSync}
              disabled={syncLoading}
              className="px-4 py-2 bg-gray-800 rounded-lg hover:bg-gray-700 active:scale-[0.97] transition-all duration-150 text-sm disabled:opacity-50"
            >
              {syncLoading ? "Syncing…" : "Sync Wallet"}
            </button>
            <button
              onClick={handleStartStop}
              disabled={actionLoading || loading}
              className="px-4 py-2 border border-gray-700 rounded-lg hover:bg-gray-800 hover:border-orange-500 active:scale-[0.97] transition-all duration-150 text-sm disabled:opacity-50"
            >
              {actionLoading ? "…" : isRunning ? "Stop" : "Start"}
            </button>
          </div>
        </div>

        {syncMsg && (
          <div className="mb-4 text-sm text-gray-300 bg-gray-800 px-4 py-2 rounded-lg">
            {syncMsg}
          </div>
        )}

        {error && (
          <div className="mb-6">
            <ErrorBanner message={error} />
          </div>
        )}

        {/* Status Banner */}
        <div
          className={`bg-gradient-to-r ${
            isRunning
              ? "from-orange-600 to-orange-500"
              : "from-gray-700 to-gray-600"
          } rounded-xl p-4 sm:p-6 mb-6 sm:mb-8 animate-fade-in`}
        >
          <div className="flex flex-col sm:flex-row justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-white/20 rounded-full flex items-center justify-center text-2xl">
                {isRunning ? "⚡" : "💤"}
              </div>
              <div>
                <div className="text-sm text-orange-100 mb-1">Status</div>
                <div className="text-xl sm:text-2xl font-bold text-white">
                  {loading ? "Loading…" : isRunning ? "Running" : "Stopped"}
                </div>
              </div>
            </div>
            <div>
              <div className="text-sm text-orange-100 mb-1">
                Another Section
              </div>
              <div className="text-xl sm:text-2xl font-bold text-white">
                Have to think
              </div>
            </div>
            <div className="sm:max-w-xs">
              <div className="text-sm text-orange-100 mb-1">Tor Address</div>
              <div className="text-xs sm:text-sm font-mono text-white bg-white/10 px-3 py-2 rounded-lg truncate">
                {torAddress ?? "—"}
              </div>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="border-b border-gray-800 mb-6 sm:mb-8 overflow-x-auto">
          <div className="flex gap-1 min-w-max">
            {TABS.map(({ id: tabId, label }) => (
              <button
                key={tabId}
                onClick={() => setActiveTab(tabId)}
                className={`px-4 sm:px-6 py-3 font-medium transition-all duration-150 rounded-t-md ${
                  activeTab === tabId
                    ? "text-orange-500 border-b-2 border-orange-500"
                    : "text-gray-400 hover:text-gray-100 hover:bg-gray-800/50"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Tab Content */}
        {activeTab === "dashboard" && <Dashboard core={core} />}
        {activeTab === "wallet" && (
          <Wallet id={id} onBalanceRefresh={loadCore} />
        )}
        {activeTab === "swaps" && <Swaps />}
        {activeTab === "logs" && <Logs id={id} />}
        {activeTab === "settings" && (
          <Settings id={id} onSaved={() => setActiveTab("dashboard")} />
        )}
      </main>
    </div>
  );
}
