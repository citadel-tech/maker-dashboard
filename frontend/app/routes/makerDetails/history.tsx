import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ExternalLink, FileText } from "lucide-react";
import { monitoring, type SwapReportDto } from "../../api";
import { LoadingCard, ErrorBanner } from "./components";
import { SatsAmount } from "../../components/SatsAmount";

interface Props {
  id: string;
}

type Filter = "all" | "success" | "other";

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
  return (
    <SatsAmount
      sats={report.fee_paid_or_earned}
      showPlus={report.fee_paid_or_earned >= 0}
    />
  );
}

function statusClass(report: SwapReportDto) {
  return report.status === "Success" ? "success" : "other";
}

function Metric({
  label,
  value,
  accent,
}: {
  label: string;
  value: ReactNode;
  accent?: "orange" | "green" | "red" | "blue";
}) {
  return (
    <div className={`cs-maker-report-metric ${accent ?? ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ReportRow({
  makerId,
  report,
}: {
  makerId: string;
  report: SwapReportDto;
}) {
  return (
    <Link
      to={`/makerDetails/${encodeURIComponent(makerId)}/swapReports/${encodeURIComponent(report.swap_id)}`}
      className="cs-maker-report-row"
    >
      <div className="cs-maker-report-row-main">
        <span className={`cs-maker-report-row-icon ${statusClass(report)}`}>
          <FileText size={18} />
        </span>
        <div>
          <strong>Swap {shortId(report.swap_id, 10, 6)}</strong>
          <p>
            {formatDate(report.end_timestamp)} ·{" "}
            {formatDuration(report.swap_duration_seconds)}
          </p>
        </div>
      </div>

      <div className="cs-maker-report-row-badges">
        <span className={statusClass(report)}>{report.status}</span>
        <span>{report.role}</span>
        <span>{report.network}</span>
      </div>

      <div className="cs-maker-report-row-details">
        <div>
          <span>Revenue</span>
          <strong
            className={
              report.fee_paid_or_earned >= 0 ? "text-[var(--cs-green)]" : ""
            }
          >
            {feeLabel(report)}
          </strong>
        </div>
        <div>
          <span>Incoming</span>
          <strong>
            <SatsAmount sats={report.incoming_amount} />
          </strong>
        </div>
        <div>
          <span>Outgoing</span>
          <strong>
            <SatsAmount sats={report.outgoing_amount} />
          </strong>
        </div>
        <div>
          <span>Duration</span>
          <strong>{formatDuration(report.swap_duration_seconds)}</strong>
        </div>
      </div>

      <ExternalLink size={16} />
    </Link>
  );
}

export default function Swaps({ id }: Props) {
  const [reports, setReports] = useState<SwapReportDto[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    setLoading(true);
    setError(null);
    monitoring
      .swapReports(id)
      .then(setReports)
      .catch((e) =>
        setError(
          e instanceof Error ? e.message : "Failed to load swap reports",
        ),
      )
      .finally(() => setLoading(false));
  }, [id]);

  const visibleReports = useMemo(() => {
    const rows = reports ?? [];
    if (filter === "success") return rows.filter((r) => r.status === "Success");
    if (filter === "other") return rows.filter((r) => r.status !== "Success");
    return rows;
  }, [filter, reports]);

  const stats = useMemo(() => {
    const rows = reports ?? [];
    const success = rows.filter((r) => r.status === "Success").length;
    const earned = rows.reduce((sum, r) => sum + r.fee_paid_or_earned, 0);
    const avgDuration =
      rows.length > 0
        ? rows.reduce((sum, r) => sum + r.swap_duration_seconds, 0) /
          rows.length
        : 0;
    return {
      total: rows.length,
      success,
      other: rows.length - success,
      earned,
      avgDuration,
    };
  }, [reports]);

  if (loading) return <LoadingCard />;
  if (error) return <ErrorBanner message={error} />;

  return (
    <section className="cs-maker-reports-page">
      <header className="cs-maker-reports-head">
        <div>
          <h2>Swap Reports</h2>
          <p>Maker-side revenue, contracts, and transaction details.</p>
        </div>
        <div className="cs-card-meta">
          {visibleReports.length} report{visibleReports.length === 1 ? "" : "s"}
        </div>
      </header>

      <section className="cs-maker-reports-stats">
        <Metric label="Total reports" value={String(stats.total)} />
        <Metric label="Success" value={String(stats.success)} accent="green" />
        <Metric
          label="Net maker revenue"
          value={
            <SatsAmount sats={stats.earned} showPlus={stats.earned >= 0} />
          }
          accent={stats.earned >= 0 ? "green" : "red"}
        />
        <Metric
          label="Avg duration"
          value={formatDuration(stats.avgDuration)}
          accent="blue"
        />
      </section>

      <div className="cs-filter-row">
        <button
          className={`cs-chip ${filter === "all" ? "active" : ""}`}
          onClick={() => setFilter("all")}
        >
          All <span>{stats.total}</span>
        </button>
        <button
          className={`cs-chip ${filter === "success" ? "active" : ""}`}
          onClick={() => setFilter("success")}
        >
          Success <span>{stats.success}</span>
        </button>
        <button
          className={`cs-chip ${filter === "other" ? "active" : ""}`}
          onClick={() => setFilter("other")}
        >
          Other <span>{stats.other}</span>
        </button>
      </div>

      <section className="cs-maker-reports-panel">
        {visibleReports.length > 0 ? (
          <div className="cs-maker-reports-list">
            {visibleReports.map((report) => (
              <ReportRow key={report.swap_id} makerId={id} report={report} />
            ))}
          </div>
        ) : (
          <div className="cs-maker-reports-empty">
            <FileText size={42} />
            <h3>No swap reports</h3>
            <p>No maker-side reports match this filter.</p>
          </div>
        )}
      </section>
    </section>
  );
}
