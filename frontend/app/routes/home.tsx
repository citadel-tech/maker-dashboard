import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowDown,
  Check,
  Coins,
  Copy,
  Globe,
  Plus,
  ShieldCheck,
  X,
  Zap,
} from "lucide-react";
import AddMaker from "./addMaker";
import BitcoindWidget from "../components/BitcoindWidget";
import { ChangePasswordModal } from "../components/Nav";
import {
  makers,
  wallet,
  monitoring,
  type MakerInfoDetailed,
  type BalanceInfo,
  type MakerState,
  type SwapReportDto,
  type UtxoInfo,
} from "../api.ts";
import { SatsAmount } from "../components/SatsAmount";

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
type MakerFilter = "all" | "running" | "stopped";

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

function torHostOnly(value: string) {
  const marker = ".onion";
  const idx = value.indexOf(marker);
  if (idx === -1) return value;
  return value.slice(0, idx + marker.length);
}

function FirstRunWelcome({ onStart }: { onStart: () => void }) {
  const features = [
    {
      icon: ShieldCheck,
      title: "Privacy-first",
      desc: "Coinswap breaks transaction graph links without requiring a trusted coordinator.",
    },
    {
      icon: Coins,
      title: "Earn fees",
      desc: "Provide maker liquidity and earn configured fees from successful swaps.",
    },
    {
      icon: Globe,
      title: "Tor native",
      desc: "Makers advertise and communicate over Tor for taker discovery and swap traffic.",
    },
  ];

  return (
    <div className="cs-page">
      <main className="cs-home-page cs-first-run-page">
        <header className="cs-home-top">
          <div className="cs-home-brand">
            <span className="cs-network-badge cs-home-network">
              <span className="cs-dot" />
              Signet
            </span>
            <div className="cs-home-title-row">
              <span className="cs-home-mark">C</span>
              <h1>Coinswap Maker</h1>
            </div>
            <p>Set up your first maker and start operating liquidity.</p>
          </div>
        </header>

        <section className="cs-first-run-hero">
          <div>
            <span className="cs-label">First maker setup</span>
            <h2>Before you create a maker, run the live checks.</h2>
            <p>
              The next screen uses the same Add Maker flow as the dashboard:
              Bitcoin Core details, Tor settings, pre-checks, and maker
              configuration in one place.
            </p>
          </div>
          <button type="button" className="cs-btn primary" onClick={onStart}>
            <Plus size={17} />
            Create first maker
          </button>
        </section>

        <section className="cs-first-run-grid">
          {features.map(({ icon: Icon, title, desc }) => (
            <article key={title} className="cs-home-maker cs-first-run-card">
              <Icon size={24} />
              <h3>{title}</h3>
              <p>{desc}</p>
            </article>
          ))}
        </section>
      </main>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Home() {
  const [makerRows, setMakerRows] = useState<MakerRow[]>([]);
  const [makerFilter, setMakerFilter] = useState<MakerFilter>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoStartMakers, setAutoStartMakers] = useState(true);
  const [autoStartSaving, setAutoStartSaving] = useState(false);
  const [copiedTor, setCopiedTor] = useState<string | null>(null);
  const [swapBannerDismissed, setSwapBannerDismissed] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [firstRunStarted, setFirstRunStarted] = useState(false);
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
    makers
      .autoStartSettings()
      .then((settings) => setAutoStartMakers(settings.enabled))
      .catch((err) =>
        setError(
          err instanceof Error
            ? err.message
            : "Failed to load maker startup setting",
        ),
      );
    const interval = setInterval(() => {
      void loadMakers();
    }, 15_000);
    return () => clearInterval(interval);
  }, []);

  async function toggleAutoStartMakers(enabled: boolean) {
    setAutoStartSaving(true);
    setAutoStartMakers(enabled);
    try {
      const settings = await makers.updateAutoStartSettings(enabled);
      setAutoStartMakers(settings.enabled);
    } catch (err) {
      setAutoStartMakers(!enabled);
      setError(
        err instanceof Error
          ? err.message
          : "Failed to save maker startup setting",
      );
    } finally {
      setAutoStartSaving(false);
    }
  }

  function copyTor(id: string, torAddress: string) {
    const text = torHostOnly(torAddress);
    navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopiedTor(id);
        setTimeout(() => setCopiedTor(null), 1400);
      })
      .catch(() => {});
  }

  if (loading) {
    return (
      <div className="cs-page">
        <div className="cs-home-page">
          <div className="cs-home-loading">Loading makers...</div>
        </div>
      </div>
    );
  }

  if (makerRows.length === 0) {
    return firstRunStarted ? (
      <AddMaker firstRun />
    ) : (
      <FirstRunWelcome onStart={() => setFirstRunStarted(true)} />
    );
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
  const totalSwaps = makerRows.reduce(
    (sum, m) => sum + (m.swapReportCount ?? 0),
    0,
  );
  const runningCount = makerRows.filter((m) => m.state === "running").length;
  const stoppedCount = makerRows.length - runningCount;
  const visibleMakerRows =
    makerFilter === "running"
      ? makerRows.filter((m) => m.state === "running")
      : makerFilter === "stopped"
        ? makerRows.filter((m) => m.state !== "running")
        : makerRows;

  const anySwapping = makerRows.some((m) => m.swapActive.length > 0);
  const showSwapBanner = anySwapping && !swapBannerDismissed;

  return (
    <div className="cs-page">
      <main className="cs-home-page">
        <header className="cs-home-top">
          <div className="cs-home-brand">
            <span className="cs-network-badge cs-home-network">
              <span className="cs-dot" />
              Signet
            </span>
            <div className="cs-home-title-row">
              <span className="cs-home-mark">C</span>
              <h1>Coinswap Maker</h1>
            </div>
            <p>Operate maker instances · earn fees from Coinswap takers</p>
          </div>
          <div className="cs-home-metrics" aria-label="Dashboard summary">
            <article className="cs-home-metric orange">
              <span className="cs-home-rail" />
              <span className="cs-label">Spendable</span>
              <strong>
                <SatsAmount sats={totalSpendableSats} />
              </strong>
              <span>
                {makerRows.length} maker{makerRows.length !== 1 ? "s" : ""}
              </span>
            </article>
            <article className="cs-home-metric green">
              <span className="cs-home-rail" />
              <span className="cs-label">Net earnings</span>
              <strong>
                <SatsAmount sats={totalEarningsSats} showPlus />
              </strong>
              <span>
                {totalSwaps} swap report{totalSwaps === 1 ? "" : "s"}
                {reportsPartial ? " · partial" : ""}
              </span>
            </article>
            <BitcoindWidget onStatusChange={() => void loadMakers(true)} />
          </div>
        </header>

        {showSwapBanner && (
          <div className="cs-banner warn cs-home-banner">
            <div>
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
              className="cs-home-icon"
              aria-label="Dismiss swap warning"
            >
              <X size={15} />
            </button>
          </div>
        )}
        {error && (
          <div className="cs-banner error cs-home-banner">
            <span>{error}</span>
            <button
              onClick={() => setError(null)}
              className="cs-home-icon"
              aria-label="Dismiss error"
            >
              <X size={15} />
            </button>
          </div>
        )}

        <section className="cs-home-section">
          <div className="cs-home-section-head">
            <div>
              <h2>Makers</h2>
              <div
                className="cs-home-tabs"
                role="tablist"
                aria-label="Filter makers"
              >
                <button
                  type="button"
                  className={makerFilter === "all" ? "active" : ""}
                  onClick={() => setMakerFilter("all")}
                >
                  All <span>{makerRows.length}</span>
                </button>
                <button
                  type="button"
                  className={makerFilter === "running" ? "active" : ""}
                  onClick={() => setMakerFilter("running")}
                >
                  Running <span>{runningCount}</span>
                </button>
                <button
                  type="button"
                  className={makerFilter === "stopped" ? "active" : ""}
                  onClick={() => setMakerFilter("stopped")}
                >
                  Stopped <span>{stoppedCount}</span>
                </button>
              </div>
            </div>
            <div className="cs-actions">
              <label className="cs-toggle">
                <span>Auto-start makers</span>
                <input
                  type="checkbox"
                  checked={autoStartMakers}
                  disabled={autoStartSaving}
                  onChange={(event) =>
                    void toggleAutoStartMakers(event.target.checked)
                  }
                  aria-label="Auto-start makers on startup"
                />
              </label>
              <button
                type="button"
                onClick={() => setShowChangePassword(true)}
                className="cs-btn primary"
              >
                Change password
              </button>
              <Link to="/addMaker" className="cs-btn primary">
                <Plus size={15} />
                Add new maker
              </Link>
            </div>
          </div>

          {visibleMakerRows.length === 0 ? (
            <div className="cs-home-empty">
              <Zap size={22} />
              <strong>No makers in this view</strong>
              <span>Switch tabs or add a new maker to get started.</span>
            </div>
          ) : (
            <div className="cs-home-makers">
              {visibleMakerRows.map((maker) => {
                const isRunning = maker.state === "running";
                const isSwapping = maker.swapActive.length > 0;
                return (
                  <article
                    key={maker.id}
                    className={`cs-home-maker ${isSwapping ? "swapping" : ""}`}
                  >
                    <div className="cs-home-maker-head">
                      <div>
                        <span
                          className={`cs-home-status ${
                            isRunning ? "running" : "stopped"
                          }`}
                        />
                        <h3>{maker.id}</h3>
                      </div>
                      <div className="cs-home-maker-pills">
                        {isSwapping && (
                          <span className="cs-pill orange">Swap Active</span>
                        )}
                      </div>
                    </div>

                    {maker.torAddress && (
                      <div className="cs-home-tor">
                        <span>Tor</span>
                        <code title={torHostOnly(maker.torAddress)}>
                          {truncateMiddle(torHostOnly(maker.torAddress))}
                        </code>
                        <button
                          type="button"
                          className="cs-home-icon"
                          onClick={() => copyTor(maker.id, maker.torAddress!)}
                          aria-label="Copy Tor address"
                        >
                          {copiedTor === maker.id ? (
                            <Check size={14} />
                          ) : (
                            <Copy size={14} />
                          )}
                        </button>
                      </div>
                    )}

                    {maker.balance ? (
                      <div className="cs-home-balances">
                        <div className="spend">
                          <span>Spendable</span>
                          <strong>
                            <SatsAmount sats={maker.balance.spendable} />
                          </strong>
                        </div>
                        <div>
                          <span>Regular</span>
                          <strong>
                            <SatsAmount sats={maker.balance.regular} />
                          </strong>
                        </div>
                        <div className="swap">
                          <span>Swap</span>
                          <strong>
                            <SatsAmount sats={maker.balance.swap} />
                          </strong>
                        </div>
                        <div className="fidelity">
                          <span>Fidelity</span>
                          <strong>
                            <SatsAmount sats={maker.balance.fidelity} />
                          </strong>
                        </div>
                      </div>
                    ) : (
                      <div className="cs-home-balance-empty">
                        {isRunning ? "Balance unavailable" : "Maker is stopped"}
                      </div>
                    )}

                    <div className="cs-home-maker-actions">
                      <span className="cs-home-uptime">
                        Status · {isRunning ? "Running" : "Stopped"}
                      </span>
                      <Link
                        to={`/makerDetails/${maker.id}`}
                        className="cs-btn primary"
                      >
                        Manage
                      </Link>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <section className="cs-home-activity">
          <div className="cs-card-head">
            <h2>
              Recent Activity
              <span className="cs-card-meta">
                {totalSwaps} event{totalSwaps === 1 ? "" : "s"}
              </span>
            </h2>
          </div>
          <div>
            {(() => {
              const recentSwaps = makerRows
                .flatMap((r) =>
                  r.swapCompleted.map((u) => ({ ...u, makerId: r.id })),
                )
                .slice(0, 10);

              if (recentSwaps.length === 0) {
                return (
                  <div className="cs-home-empty">
                    <ArrowDown size={22} />
                    <strong>No swaps yet</strong>
                    <span>
                      Completed swaps will show here with maker IDs and coin
                      types.
                    </span>
                  </div>
                );
              }

              return (
                <div className="cs-home-activity-list">
                  {recentSwaps.map((s, index) => (
                    <div
                      className="cs-home-activity-row"
                      key={swapKey(s, s.makerId)}
                    >
                      <span className="cs-home-activity-time">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <span className="cs-home-activity-icon">
                        <ArrowDown size={14} />
                      </span>
                      <div>
                        <strong>{s.makerId}</strong>
                        <span>{s.utxo_type}</span>
                      </div>
                      <code title={s.addr}>{truncateMiddle(s.addr)}</code>
                      <strong className="cs-home-activity-amount">
                        <SatsAmount sats={s.amount} showPlus />
                      </strong>
                      <span className="cs-pill green">Swap</span>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
        </section>
      </main>
      {showChangePassword && (
        <ChangePasswordModal onClose={() => setShowChangePassword(false)} />
      )}
    </div>
  );
}
