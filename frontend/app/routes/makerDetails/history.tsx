import { useState, useEffect } from "react";
import { monitoring, satsToBtc, type SwapReportDto } from "../../api";
import { LoadingCard, ErrorBanner } from "./components";

interface Props {
  id: string;
}

function formatDate(timestamp: number) {
  return new Date(timestamp * 1000).toLocaleString();
}

function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  return `${minutes}m ${secs}s`;
}

function TxRow({ label, txid }: { label: string; txid?: string | null }) {
  if (!txid) return null;
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-wide text-gray-500">
        {label}
      </span>
      <code className="text-xs text-gray-300 break-all">{txid}</code>
    </div>
  );
}

function SwapCard({ report }: { report: SwapReportDto }) {
  const feeLabel =
    report.fee_paid_or_earned >= 0
      ? `+${satsToBtc(report.fee_paid_or_earned)} BTC`
      : `${satsToBtc(report.fee_paid_or_earned)} BTC`;

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 sm:p-6">
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4 mb-4">
        <div>
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <span
              className={`text-xs px-2 py-0.5 rounded ${
                report.status === "Success"
                  ? "bg-green-900/60 text-green-300"
                  : "bg-red-900/60 text-red-300"
              }`}
            >
              {report.status}
            </span>
            <span className="text-xs px-2 py-0.5 rounded bg-gray-800 text-gray-300">
              {report.role}
            </span>
            <span className="text-xs px-2 py-0.5 rounded bg-gray-800 text-gray-300">
              {report.network}
            </span>
          </div>
          <h3 className="text-lg font-semibold mb-1">Swap {report.swap_id}</h3>
          <p className="text-sm text-gray-400">
            Completed {formatDate(report.end_timestamp)}
          </p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 min-w-0">
          <div>
            <div className="text-xs text-gray-500 mb-1">Incoming</div>
            <div className="text-sm font-semibold text-orange-400">
              {satsToBtc(report.incoming_amount)} BTC
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-500 mb-1">Outgoing</div>
            <div className="text-sm font-semibold text-orange-400">
              {satsToBtc(report.outgoing_amount)} BTC
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-500 mb-1">Fee</div>
            <div
              className={`text-sm font-semibold ${
                report.fee_paid_or_earned >= 0
                  ? "text-emerald-400"
                  : "text-red-300"
              }`}
            >
              {feeLabel}
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-500 mb-1">Duration</div>
            <div className="text-sm font-semibold text-gray-200">
              {formatDuration(report.swap_duration_seconds)}
            </div>
          </div>
        </div>
      </div>

      {report.error_message && (
        <div className="mb-4 text-sm text-red-300 bg-red-950/40 border border-red-900 rounded-lg px-3 py-2">
          {report.error_message}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-3">
          <TxRow
            label="Incoming Contract Tx"
            txid={report.incoming_contract_txid}
          />
          <TxRow
            label="Outgoing Contract Tx"
            txid={report.outgoing_contract_txid}
          />
          <TxRow label="Recovery Tx" txid={report.recovery_txid} />
        </div>

        <div className="space-y-3">
          <div>
            <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">
              Timelock
            </div>
            <div className="text-sm text-gray-200">
              {report.timelock} blocks
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">
              Started
            </div>
            <div className="text-sm text-gray-200">
              {formatDate(report.start_timestamp)}
            </div>
          </div>
          {report.maker_addresses.length > 0 && (
            <div>
              <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">
                Maker Route
              </div>
              <div className="space-y-1">
                {report.maker_addresses.map((address) => (
                  <code
                    key={address}
                    className="block text-xs text-gray-300 break-all"
                  >
                    {address}
                  </code>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function Swaps({ id }: Props) {
  const [reports, setReports] = useState<SwapReportDto[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  if (loading) return <LoadingCard />;
  if (error) return <ErrorBanner message={error} />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Swap Reports</h3>
          <p className="text-sm text-gray-400 mt-1">
            Detailed maker-side reports for completed or recovered swaps
          </p>
        </div>
        <div className="text-sm text-gray-500">
          {reports?.length ?? 0} report{reports?.length === 1 ? "" : "s"}
        </div>
      </div>

      {reports && reports.length > 0 ? (
        reports.map((report) => (
          <SwapCard key={report.swap_id} report={report} />
        ))
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 sm:p-6">
          <p className="text-gray-400 text-sm">No swap reports yet</p>
        </div>
      )}
    </div>
  );
}
