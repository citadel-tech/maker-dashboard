import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Download, ExternalLink, Home } from "lucide-react";
import { formatSats, monitoring, type SwapReportDto } from "../../api";
import { ErrorBanner, LoadingCard } from "./components";

function formatDate(timestamp: number) {
  return new Date(timestamp * 1000).toLocaleString();
}

function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "-";
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  return `${minutes}m ${secs}s`;
}

function shortId(value: string, start = 12, end = 8) {
  if (value.length <= start + end + 1) return value;
  return `${value.slice(0, start)}...${value.slice(-end)}`;
}

function feeLabel(report: SwapReportDto) {
  return report.fee_paid_or_earned >= 0
    ? `+${formatSats(report.fee_paid_or_earned)}`
    : formatSats(report.fee_paid_or_earned);
}

function fundingTxids(report: SwapReportDto) {
  return report.funding_txids.flatMap((group) => group);
}

const MEMPOOL_TX_BASE_URL = "http://170.75.166.88:8080/tx";

function mempoolTxUrl(txid?: string | null) {
  if (!txid) return undefined;
  return `${MEMPOOL_TX_BASE_URL}/${txid}`;
}



function earnedSpread(report: SwapReportDto) {
  return Number(report.incoming_amount) - Number(report.outgoing_amount);
}

function downloadReport(report: SwapReportDto) {
  const blob = new Blob([JSON.stringify(report, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `coinswap-maker-report-${report.swap_id}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function Metric({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "orange" | "green" | "red" | "blue";
}) {
  return (
    <div className={`cs-maker-report-metric ${accent ?? ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Artifact({
  label,
  value,
  accent,
  href,
}: {
  label: string;
  value?: string | null;
  accent?: "orange" | "blue" | "green";
  href?: string;
}) {
  if (!value) return null;

  const content = (
    <>
      <h4>
        <span>{label}</span>
        {href && <ExternalLink size={15} aria-hidden="true" />}
      </h4>
      <code>{value}</code>
    </>
  );

  return href ? (
    <a
      className={`cs-maker-report-artifact ${accent ?? ""}`}
      href={href}
      target="_blank"
      rel="noreferrer"
      title={`Open ${label} in Mempool`}
    >
      {content}
    </a>
  ) : (
    <div className={`cs-maker-report-artifact ${accent ?? ""}`}>{content}</div>
  );
}

function MakerSwapReportPageContent({
  makerId,
  report,
}: {
  makerId: string;
  report: SwapReportDto;
}) {
  const recoveryTxids = report.recovery_txids ?? [];
  const txids = fundingTxids(report);
  const spread = earnedSpread(report);
  const feeRate =
    report.incoming_amount > 0 ? (spread / report.incoming_amount) * 100 : 0;

  return (
    <section className="cs-maker-report-page">
      <header className="cs-maker-report-head">
        <div className="cs-maker-report-title-row">
          <Link
            to={`/makerDetails/${encodeURIComponent(makerId)}`}
            className="cs-maker-report-back"
            aria-label="Back to maker details"
          >
            <ArrowLeft size={19} />
          </Link>
          <div>
            <h2>
              Maker Swap <span>{report.status}</span>
            </h2>
            <p>
              {report.network} · {formatDate(report.end_timestamp)}
            </p>
          </div>
        </div>
        <Link
          to="/"
          className="cs-maker-report-home"
          aria-label="Go to main dashboard"
          title="Main dashboard"
        >
          <Home size={18} />
        </Link>
      </header>

      <div className="cs-maker-report-layout">
        <main className="cs-maker-report-main">
          <h3>Maker Summary</h3>
          <div className="cs-maker-report-hero">
            <span>Fee earned</span>
            <strong
              className={
                report.fee_paid_or_earned >= 0 ? "positive" : "negative"
              }
            >
              {feeLabel(report)}
            </strong>
            <p>Swap {shortId(report.swap_id, 18, 12)}</p>
            <b>{formatDuration(report.swap_duration_seconds)} total duration</b>
          </div>

          {report.error_message && (
            <div className="cs-banner warn">{report.error_message}</div>
          )}

          <section className="cs-maker-report-block">
            <div className="cs-maker-report-block-head">
              <span>Transaction artifacts</span>
              <strong>
                {
                  [
                    report.incoming_contract_txid,
                    report.outgoing_contract_txid,
                    ...recoveryTxids,
                    ...txids,
                  ].filter(Boolean).length
                }{" "}
                tx
              </strong>
            </div>
            <div className="cs-maker-report-artifacts">
              <Artifact
                label="Incoming contract tx"
                value={report.incoming_contract_txid}
                href={mempoolTxUrl(report.incoming_contract_txid)}
                accent="blue"
              />
              <Artifact
                label="Outgoing contract tx"
                value={report.outgoing_contract_txid}
                href={mempoolTxUrl(report.outgoing_contract_txid)}
                accent="orange"
              />
              {recoveryTxids.map((txid, index) => (
                <Artifact
                  key={`recovery-${txid}`}
                  label={`Recovery tx ${index + 1}`}
                  value={txid}
                  accent="green"
                />
              ))}
              {txids.map((txid, index) => (
                <Artifact
                  key={`funding-${index}-${txid}`}
                  label={`Funding tx ${index + 1}`}
                  value={txid}
                />
              ))}
            </div>
          </section>

          <section className="cs-maker-report-block">
            <div className="cs-maker-report-block-head">
              <span>Maker flow</span>
              <strong>received {"->"} forwarded</strong>
            </div>
            <div className="cs-maker-report-flow">
              <Metric
                label="Incoming contract amount"
                value={formatSats(report.incoming_amount)}
                accent="blue"
              />
              <Metric
                label="Outgoing contract amount"
                value={formatSats(report.outgoing_amount)}
                accent="orange"
              />
              <Metric
                label="Earned spread"
                value={formatSats(spread)}
                accent={spread >= 0 ? "green" : "red"}
              />
            </div>
          </section>

          <div className="cs-maker-report-export">
            <button type="button" onClick={() => downloadReport(report)}>
              <Download size={17} />
              Export report
            </button>
          </div>
        </main>

        <aside className="cs-maker-report-side">
          <section className="cs-maker-report-fees">
            <h3>Maker Settlement</h3>
            <div className="cs-maker-report-fee-lines">
              <Metric
                label="Fee earned"
                value={feeLabel(report)}
                accent={report.fee_paid_or_earned >= 0 ? "green" : "red"}
              />
              <Metric
                label="Incoming"
                value={formatSats(report.incoming_amount)}
                accent="blue"
              />
              <Metric
                label="Outgoing"
                value={formatSats(report.outgoing_amount)}
                accent="orange"
              />
              <Metric
                label="Timelock"
                value={`${report.timelock.toLocaleString()} blocks`}
              />
              <Metric
                label="Duration"
                value={formatDuration(report.swap_duration_seconds)}
              />
              <Metric label="Fee rate" value={`${feeRate.toFixed(3)}%`} />
              <Metric
                label="Completed"
                value={formatDate(report.end_timestamp)}
              />
            </div>

            <div className="cs-maker-report-total">
              <span>This maker</span>
              <strong
                className={
                  report.fee_paid_or_earned >= 0 ? "positive" : "negative"
                }
              >
                {feeLabel(report)}
              </strong>
            </div>
          </section>
        </aside>
      </div>
    </section>
  );
}

export default function MakerSwapReportPage() {
  const { makerId = "", swapId = "" } = useParams<{
    makerId: string;
    swapId: string;
  }>();
  const decodedMakerId = decodeURIComponent(makerId);
  const decodedSwapId = decodeURIComponent(swapId);
  const [reports, setReports] = useState<SwapReportDto[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0 });
  }, [decodedMakerId, decodedSwapId]);

  useEffect(() => {
    if (!decodedMakerId) return;
    setLoading(true);
    setError(null);
    monitoring
      .swapReports(decodedMakerId)
      .then(setReports)
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Failed to load swap report"),
      )
      .finally(() => setLoading(false));
  }, [decodedMakerId]);

  const report = useMemo(
    () => reports?.find((row) => row.swap_id === decodedSwapId) ?? null,
    [reports, decodedSwapId],
  );

  return (
    <div className="cs-page">
      <main className="cs-main animate-slide-in-up">
        <div className="cs-shell">
          <div className="cs-content">
            {loading ? (
              <LoadingCard />
            ) : error ? (
              <ErrorBanner message={error} />
            ) : report ? (
              <MakerSwapReportPageContent
                makerId={decodedMakerId}
                report={report}
              />
            ) : (
              <ErrorBanner message={`Swap report ${decodedSwapId} not found`} />
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
