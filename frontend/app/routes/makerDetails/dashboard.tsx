import { LoadingCard } from "./components";
import type { MakerCoreData } from "./types";
import type { CSSProperties } from "react";
import { SatsAmount } from "../../components/SatsAmount";
interface Props {
  core: MakerCoreData;
}

function plural(value: number, word: string) {
  return `${value} ${word}${value === 1 ? "" : "s"}`;
}

function formatBalancePct(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0%";
  if (value < 1) return "<1%";
  return `${Math.round(value)}%`;
}

export default function Dashboard({ core }: Props) {
  const { info, balances, dataDir, loading, earningsSats, swapReportCount } =
    core;
  const liveHtlcLabel =
    core.contractUtxoCount === null ? "—" : core.contractUtxoCount;

  const totalSats = balances
    ? balances.regular + balances.swap + balances.contract + balances.fidelity
    : 0;

  if (loading) {
    return (
      <div className="cs-grid-dashboard">
        {[...Array(4)].map((_, i) => (
          <LoadingCard key={i} />
        ))}
      </div>
    );
  }

  const regularPct = totalSats > 0 ? (balances!.regular / totalSats) * 100 : 0;
  const swapPct = totalSats > 0 ? (balances!.swap / totalSats) * 100 : 0;
  const fidelityPct =
    totalSats > 0 ? (balances!.fidelity / totalSats) * 100 : 0;
  return (
    <div className="space-y-[22px]">
      <section className="cs-grid-dashboard">
        <article className="cs-card cs-rail cs-balance-hero">
          <div className="cs-balance-top">
            <div className="flex flex-wrap items-center gap-2">
              <span className="cs-label">Total Balance</span>
              {balances && balances.fidelity > 0 && (
                <span className="cs-pill amber">
                  <span className="cs-dot" />
                  <SatsAmount sats={balances.fidelity} /> locked
                </span>
              )}
            </div>
            <div className="cs-value mt-2">
              {balances ? <SatsAmount sats={totalSats} /> : "—"}
            </div>
            <div className="mt-1 text-[13px] cs-muted">
              {balances
                ? "Regular + swap + contract + fidelity"
                : "Balance data unavailable"}
            </div>
            <div className="cs-share-bar" aria-hidden="true">
              <span
                style={{
                  width: `${regularPct}%`,
                  background: "var(--cs-orange)",
                }}
              />
              <span
                style={{ width: `${swapPct}%`, background: "var(--cs-blue)" }}
              />
              <span
                style={{
                  width: `${fidelityPct}%`,
                  background: "var(--cs-amber)",
                }}
              />
            </div>
            <div className="cs-balance-breakdown">
              <span>
                <b>Regular</b>
                {formatBalancePct(regularPct)}
              </span>
              <span>
                <b>Swap</b>
                {formatBalancePct(swapPct)}
              </span>
              <span>
                <b>Fidelity</b>
                {formatBalancePct(fidelityPct)}
              </span>
            </div>
          </div>
          <div className="cs-balance-bottom">
            <div className="cs-metric">
              <span className="cs-label">Swap Liquidity</span>
              <span className="cs-value text-[var(--cs-blue)]">
                {balances ? <SatsAmount sats={balances.swap} /> : "—"}
              </span>
              <span className="text-[13px] cs-muted">
                {balances ? "Max Between Regular and Swap" : "—"}
              </span>
            </div>
            <div className="cs-balance-swap-split" aria-label="Swap liquidity">
              <div>
                <span className="cs-label">Regular</span>
                <strong>
                  {balances ? <SatsAmount sats={balances.regular} /> : "—"}
                </strong>
              </div>
              <div>
                <span className="cs-label">Swap</span>
                <strong>
                  {balances ? <SatsAmount sats={balances.swap} /> : "—"}
                </strong>
              </div>
            </div>
          </div>
        </article>

        <article
          className="cs-card cs-rail cs-stat-card"
          style={{ "--rail": "var(--cs-green)" } as CSSProperties}
        >
          <div className="cs-stat-label">
            <span className="cs-label">Net Earning</span>
            <span className="cs-pill green">{swapReportCount} swaps</span>
          </div>
          <div
            className={`cs-value ${earningsSats >= 0 ? "text-[var(--cs-green)]" : "text-[var(--cs-red)]"}`}
          >
            <SatsAmount sats={earningsSats} showPlus />
          </div>
          <div className="text-[13px] cs-muted">
            {`Across ${plural(swapReportCount, "successful swap")}`}
          </div>
        </article>

        <article
          className="cs-card cs-rail cs-stat-card"
          style={{ "--rail": "var(--cs-text)" } as CSSProperties}
        >
          <div className="cs-stat-label">
            <span className="cs-label">Fidelity Bond</span>
            <span className="cs-pill amber">Locked</span>
          </div>
          <div className="cs-value">
            {balances ? <SatsAmount sats={balances.fidelity} /> : "—"}
          </div>
          <div className="text-[13px] cs-muted">
            {info
              ? `Timelock ${info.fidelity_timelock.toLocaleString()} blocks`
              : "Reputation stake"}
          </div>
        </article>

        <article
          className="cs-card cs-rail cs-stat-card"
          style={{ "--rail": "var(--cs-orange)" } as CSSProperties}
        >
          <div className="cs-stat-label">
            <span className="cs-label">Spendable</span>
            <span className="cs-pill orange">Regular + Swap</span>
          </div>
          <div className="cs-value text-[var(--cs-orange)]">
            {balances ? <SatsAmount sats={balances.spendable} /> : "—"}
          </div>
          <div className="text-[13px] cs-muted">
            {balances
              ? "Amounts that can be directly spent"
              : "Spendable balance unavailable"}
          </div>
          <div className="cs-stat-meta">
            <span>Regular + swap coins</span>
          </div>
        </article>

        <article
          className="cs-card cs-rail cs-stat-card"
          style={{ "--rail": "var(--cs-amber)" } as CSSProperties}
        >
          <div className="cs-stat-label">
            <span className="cs-label">Contract</span>
            <span className="cs-pill">Idle</span>
          </div>
          <div className="cs-value text-[var(--cs-amber)]">
            {balances ? <SatsAmount sats={balances.contract} /> : "—"}
          </div>
          <div className="text-[13px] cs-muted">
            {balances && balances.contract > 0
              ? "Amount Locked in Timelock"
              : "Amount Locked in Timelock"}
          </div>
          <div className="cs-stat-meta">
            <span>Live HTLCs · {liveHtlcLabel}</span>
          </div>
        </article>
      </section>

      <section className="cs-section">
        <div className="cs-card">
          <div className="cs-card-head">
            <h2>Configuration</h2>
            <span className="cs-card-meta">Runtime paths</span>
          </div>
          <div className="cs-card-body">
            <div className="cs-field-grid cols-3">
              <div className="cs-card p-4">
                <div className="cs-label mb-2">Data Directory</div>
                <div className="cs-tx">
                  {dataDir ?? info?.data_directory ?? "—"}
                </div>
              </div>
              <div className="cs-card p-4">
                <div className="cs-label mb-2">Bitcoin RPC</div>
                <div className="cs-tx">{info?.rpc ?? "—"}</div>
              </div>
              <div className="cs-card p-4">
                <div className="cs-label mb-2">ZMQ</div>
                <div className="cs-tx">{info?.zmq ?? "—"}</div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
