import { useState, useEffect, useCallback } from "react";
import { Link, useParams } from "react-router-dom";
import { ChevronLeft, Play, RefreshCw, Square } from "lucide-react";
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
  { id: "logs", label: "Logs" },
  { id: "settings", label: "Settings" },
];

function truncateMiddle(value: string, start = 24, end = 18) {
  if (value.length <= start + end + 1) return value;
  return `${value.slice(0, start)}...${value.slice(-end)}`;
}

function torHostOnly(value: string) {
  const onionEnd = value.indexOf(".onion");
  if (onionEnd === -1) return value;
  return value.slice(0, onionEnd + ".onion".length);
}

export default function MakerDetails() {
  const { makerId } = useParams<{ makerId: string }>();
  const id = makerId ?? "";

  const [activeTab, setActiveTab] = useState<Tab>("dashboard");

  const [info, setInfo] = useState<MakerInfoDetailed | null>(null);
  const [status, setStatus] = useState<MakerStatus | null>(null);
  const [balances, setBalances] = useState<BalanceInfo | null>(null);
  const [earningsSats, setEarningsSats] = useState(0);
  const [swapReportCount, setSwapReportCount] = useState(0);
  const [torAddress, setTorAddress] = useState<string | null>(null);
  const [dataDir, setDataDir] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [walletRefreshToken, setWalletRefreshToken] = useState(0);

  function copyTorAddress() {
    if (!torAddress) return;
    navigator.clipboard.writeText(torHostOnly(torAddress)).catch(() => {});
  }

  const loadCore = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const [infoData, statusData, balanceData, reportsData] =
        await Promise.allSettled([
          makers.get(id),
          monitoring.status(id),
          wallet.balance(id),
          monitoring.swapReports(id),
        ]);
      if (infoData.status === "fulfilled") setInfo(infoData.value);
      if (statusData.status === "fulfilled") setStatus(statusData.value);
      if (balanceData.status === "fulfilled") setBalances(balanceData.value);
      if (reportsData.status === "fulfilled") {
        setSwapReportCount(reportsData.value.length);
        setEarningsSats(
          reportsData.value.reduce(
            (sum, report) => sum + report.fee_paid_or_earned,
            0,
          ),
        );
      } else {
        setSwapReportCount(0);
        setEarningsSats(0);
      }

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
      await loadCore();
      setWalletRefreshToken((value) => value + 1);
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
    earningsSats,
    swapReportCount,
    torAddress,
    dataDir,
    loading,
    isRunning,
  };

  const torHostname = torAddress ? torHostOnly(torAddress) : null;
  return (
    <div className="cs-page">
      <main className="cs-main animate-slide-in-up">
        <div className="cs-shell">
          <div className="cs-content">
            <div className="cs-page-head">
              <Link
                to="/"
                className="cs-back"
                aria-label="Back to main dashboard"
              >
                <ChevronLeft className="h-4 w-4" />
              </Link>
              <div className="cs-heading">
                <h1>{id}</h1>
                <div
                  className={`cs-subaddr ${torHostname ? "copyable" : ""}`}
                  onClick={copyTorAddress}
                  title={torHostname ?? info?.rpc ?? undefined}
                >
                  {torHostname
                    ? truncateMiddle(torHostname)
                    : info?.rpc
                      ? `RPC ${info.rpc}`
                      : "Maker instance"}
                </div>
              </div>
              <div className="cs-actions">
                <button
                  onClick={handleSync}
                  disabled={syncLoading}
                  className={`cs-btn ghost ${syncLoading ? "spin" : ""}`}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  {syncLoading ? "Syncing..." : "Sync Wallet"}
                </button>
                <button
                  onClick={handleStartStop}
                  disabled={actionLoading || loading}
                  className={`cs-btn ${isRunning ? "danger" : "start"}`}
                >
                  {isRunning ? (
                    <Square className="h-3.5 w-3.5" fill="currentColor" />
                  ) : (
                    <Play className="h-3.5 w-3.5" fill="currentColor" />
                  )}
                  {actionLoading ? "..." : isRunning ? "Stop" : "Start"}
                </button>
              </div>
            </div>

            {syncMsg && <div className="cs-banner info">{syncMsg}</div>}

            {error && <ErrorBanner message={error} />}

            <nav className="cs-tabs" role="tablist" aria-label="Maker sections">
              {TABS.map(({ id: tabId, label }) => (
                <button
                  key={tabId}
                  onClick={() => setActiveTab(tabId)}
                  className={`cs-tab ${activeTab === tabId ? "active" : ""}`}
                  role="tab"
                  aria-selected={activeTab === tabId}
                >
                  {label}
                </button>
              ))}
            </nav>

            {/* Tab Content */}
            {activeTab === "dashboard" && (
              <>
                <Dashboard core={core} />
                <Swaps id={id} />
              </>
            )}
            {activeTab === "wallet" && (
              <Wallet
                id={id}
                onBalanceRefresh={loadCore}
                refreshToken={walletRefreshToken}
              />
            )}
            {activeTab === "logs" && <Logs id={id} />}
            {activeTab === "settings" && (
              <Settings id={id} onSaved={() => setActiveTab("dashboard")} />
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
