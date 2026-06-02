import { useState, useEffect, useCallback, useMemo } from "react";
import type { CSSProperties } from "react";
import { Copy, RefreshCw, Send, WalletCards } from "lucide-react";
import { formatSats, wallet, type UtxoInfo } from "../../api";

interface Props {
  id: string;
  onBalanceRefresh: () => Promise<void>;
  refreshToken: number;
}

function utxoPurpose(type: string): string {
  switch (type) {
    case "regular":
      return "Single-sig wallet funds";
    case "swap":
      return "Swap liquidity";
    case "contract":
      return "Active contract funds";
    case "fidelity":
      return "Bond collateral";
    default:
      return "Wallet funds";
  }
}

type UtxoFilter = "all" | "regular" | "swap" | "contract" | "fidelity";

export default function Wallet({ id, onBalanceRefresh, refreshToken }: Props) {
  const [utxos, setUtxos] = useState<UtxoInfo[] | null>(null);
  const [utxosLoading, setUtxosLoading] = useState(false);
  const [utxosError, setUtxosError] = useState<string | null>(null);

  const [newAddress, setNewAddress] = useState<string | null>(null);
  const [addrLoading, setAddrLoading] = useState(false);
  const [copiedAddress, setCopiedAddress] = useState(false);

  const [sendAddr, setSendAddr] = useState("");
  const [sendAmount, setSendAmount] = useState("");
  const [sendFeerate, setSendFeerate] = useState("1");
  const [sendLoading, setSendLoading] = useState(false);
  const [sendResult, setSendResult] = useState<{
    ok: boolean;
    msg: string;
  } | null>(null);
  const [utxoFilter, setUtxoFilter] = useState<UtxoFilter>("all");

  const fetchUtxos = useCallback(
    async (syncFirst = false) => {
      setUtxosLoading(true);
      setUtxosError(null);
      try {
        if (syncFirst) {
          await wallet.sync(id);
        }

        const results = await Promise.allSettled([
          wallet.swapUtxos(id),
          wallet.contractUtxos(id),
          wallet.fidelityUtxos(id),
          wallet.utxos(id),
        ]);

        const merged = results.flatMap((r) =>
          r.status === "fulfilled" ? r.value : [],
        );
        const rejected = results.filter((r) => r.status === "rejected");

        setUtxos(merged);

        if (rejected.length === results.length) {
          const firstError = rejected[0];
          if (firstError?.status === "rejected") {
            throw firstError.reason;
          }
        }

        if (syncFirst) {
          await onBalanceRefresh();
        }
      } catch (e) {
        setUtxosError(
          e instanceof Error ? e.message : "Failed to refresh wallet data",
        );
      } finally {
        setUtxosLoading(false);
      }
    },
    [id, onBalanceRefresh],
  );

  useEffect(() => {
    void fetchUtxos();
  }, [fetchUtxos, refreshToken]);

  async function handleGenerateAddress() {
    setAddrLoading(true);
    try {
      const addr = await wallet.newAddress(id);
      setNewAddress(addr);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to generate address");
    } finally {
      setAddrLoading(false);
    }
  }

  function copyAddress() {
    if (!newAddress) return;
    navigator.clipboard
      .writeText(newAddress)
      .then(() => {
        setCopiedAddress(true);
        setTimeout(() => setCopiedAddress(false), 1800);
      })
      .catch(() => {});
  }

  async function handleSend() {
    if (!sendAddr || !sendAmount || !sendFeerate) return;
    setSendLoading(true);
    setSendResult(null);
    try {
      const txid = await wallet.send(id, {
        address: sendAddr,
        amount: Math.round(Number(sendAmount)),
        feerate: parseFloat(sendFeerate),
      });
      setSendResult({ ok: true, msg: `Sent! TxID: ${txid}` });
      setSendAddr("");
      setSendAmount("");
      await onBalanceRefresh();
      await fetchUtxos();
    } catch (e) {
      setSendResult({
        ok: false,
        msg: e instanceof Error ? e.message : "Send failed",
      });
    } finally {
      setSendLoading(false);
    }
  }

  const utxoRows = useMemo(() => utxos ?? [], [utxos]);
  const filteredUtxos = useMemo(
    () =>
      utxoRows.filter((u) =>
        utxoFilter === "all" ? true : u.utxo_type === utxoFilter,
      ),
    [utxoFilter, utxoRows],
  );
  const utxoCounts = useMemo(() => {
    const counts: Record<UtxoFilter, number> = {
      all: utxoRows.length,
      regular: 0,
      swap: 0,
      contract: 0,
      fidelity: 0,
    };
    for (const u of utxoRows) {
      if (u.utxo_type in counts) counts[u.utxo_type as UtxoFilter] += 1;
    }
    return counts;
  }, [utxoRows]);
  const totalUtxoSats = utxoRows.reduce((sum, u) => sum + u.amount, 0);
  const confirmedUtxos = utxoRows.filter((u) => u.confirmations > 0).length;
  const filterOptions: { id: UtxoFilter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "regular", label: "Regular" },
    { id: "swap", label: "Swap" },
    { id: "contract", label: "Contract" },
    { id: "fidelity", label: "Fidelity" },
  ];

  return (
    <section className="cs-section">
      <div className="cs-section-head">
        <div>
          <h2>Wallet</h2>
          <p>Receive, send, and inspect maker wallet coins.</p>
        </div>
        <button
          onClick={() => void fetchUtxos(true)}
          disabled={utxosLoading}
          className={`cs-btn ghost sm ${utxosLoading ? "spin" : ""}`}
        >
          <RefreshCw className="h-3.5 w-3.5" />
          {utxosLoading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      <div className="grid grid-cols-1 gap-[14px] xl:grid-cols-[1fr_420px]">
        <section
          className="cs-card cs-rail"
          style={{ "--rail": "var(--cs-green)" } as CSSProperties}
        >
          <div className="cs-card-head">
            <div>
              <h2>Receive Bitcoin</h2>
              <span className="cs-card-meta">Fresh address</span>
            </div>
            <span className="cs-pill green">
              <span className="cs-dot" />
              Receive
            </span>
          </div>
          <div className="cs-card-body">
            <div className="mb-[18px] grid min-h-[220px] place-items-center rounded-[14px] border border-[var(--cs-border)] bg-[#f6f6f2] p-6 text-center text-[#17171c]">
              {newAddress ? (
                <div className="max-w-full">
                  <WalletCards className="mx-auto mb-4 h-10 w-10 text-[var(--cs-orange)]" />
                  <div className="cs-mono break-all text-[13px] leading-6 text-[#17171c]">
                    {newAddress}
                  </div>
                </div>
              ) : (
                <div>
                  <WalletCards className="mx-auto mb-4 h-10 w-10 opacity-60" />
                  <strong className="block text-sm">No address loaded</strong>
                  <span className="mt-1 block text-xs opacity-70">
                    Generate a receive address below.
                  </span>
                </div>
              )}
            </div>

            <div className="mb-4 flex items-center gap-2 rounded-[10px] border border-[var(--cs-border)] bg-[var(--cs-surface-3)] p-2">
              <span className="cs-mono min-w-0 flex-1 break-all px-2 text-xs cs-muted">
                {newAddress ?? "No address loaded"}
              </span>
              <button
                type="button"
                onClick={copyAddress}
                disabled={!newAddress}
                className="cs-btn ghost sm"
              >
                <Copy className="h-3.5 w-3.5" />
                {copiedAddress ? "Copied" : "Copy"}
              </button>
            </div>

            <button
              onClick={handleGenerateAddress}
              disabled={addrLoading}
              className="cs-btn primary block"
            >
              <RefreshCw className="h-4 w-4" />
              {addrLoading ? "Generating..." : "Generate New Address"}
            </button>
          </div>
        </section>

        <section
          className="cs-card cs-rail"
          style={{ "--rail": "var(--cs-orange)" } as CSSProperties}
        >
          <div className="cs-card-head">
            <div>
              <h2>Send Bitcoin</h2>
              <span className="cs-card-meta">Manual payment</span>
            </div>
            <span className="cs-pill orange">
              <span className="cs-dot" />
              Send
            </span>
          </div>
          <div className="cs-card-body">
            <div className="cs-field mb-4">
              <label>Recipient Address</label>
              <input
                type="text"
                value={sendAddr}
                onChange={(e) => setSendAddr(e.target.value)}
                placeholder="bc1q..."
                className="cs-input"
              />
            </div>

            <div className="cs-field mb-4">
              <div className="flex items-center justify-between gap-3">
                <label>Amount</label>
                <span className="cs-card-meta">丰</span>
              </div>
              <div className="flex min-h-[62px] items-center gap-3 rounded-[12px] border border-[var(--cs-border)] bg-[var(--cs-surface-3)] px-4">
                <input
                  type="number"
                  value={sendAmount}
                  onChange={(e) => setSendAmount(e.target.value)}
                  placeholder="10000"
                  min="0"
                  step="1"
                  className="min-w-0 flex-1 border-0 bg-transparent p-0 font-mono text-[22px] text-[var(--cs-text)] outline-none"
                />
                <span className="cs-card-meta">丰</span>
              </div>
            </div>

            <div className="cs-field mb-4">
              <label>Fee Rate</label>
              <div className="cs-input-wrap">
                <input
                  type="number"
                  value={sendFeerate}
                  onChange={(e) => setSendFeerate(e.target.value)}
                  placeholder="1"
                  min="1"
                  className="cs-input"
                />
                <span className="cs-unit">sat/vB</span>
              </div>
            </div>

            <button
              type="button"
              onClick={handleSend}
              disabled={sendLoading || !sendAddr || !sendAmount}
              className="cs-btn primary block"
            >
              <Send className="h-4 w-4" />
              {sendLoading ? "Sending..." : "Send"}
            </button>
            {sendResult && (
              <div
                className={`cs-banner mt-4 ${sendResult.ok ? "info" : "warn"}`}
              >
                {sendResult.msg}
              </div>
            )}
          </div>
        </section>
      </div>

      <section className="cs-card">
        <div className="cs-card-head">
          <div className="flex items-baseline gap-2">
            <h2>UTXOs</h2>
            <span className="cs-card-meta">{utxoRows.length} unspent</span>
          </div>
          <span className="cs-card-meta">
            Total · {formatSats(totalUtxoSats)}
          </span>
        </div>
        <div className="cs-card-body">
          <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-[10px] border border-[var(--cs-border)] bg-[var(--cs-surface-3)] p-3">
              <div className="cs-label">Total UTXOs</div>
              <div className="cs-value mt-1 text-[20px]">{utxoRows.length}</div>
            </div>
            <div className="rounded-[10px] border border-[var(--cs-border)] bg-[var(--cs-surface-3)] p-3">
              <div className="cs-label">Confirmed</div>
              <div className="cs-value mt-1 text-[20px] text-[var(--cs-green)]">
                {confirmedUtxos}
              </div>
            </div>
            <div className="rounded-[10px] border border-[var(--cs-border)] bg-[var(--cs-surface-3)] p-3">
              <div className="cs-label">Unconfirmed</div>
              <div className="cs-value mt-1 text-[20px] text-[var(--cs-amber)]">
                {utxoRows.length - confirmedUtxos}
              </div>
            </div>
          </div>

          <div className="cs-filter-row mb-4">
            {filterOptions.map((option) => (
              <button
                type="button"
                key={option.id}
                onClick={() => setUtxoFilter(option.id)}
                className={`cs-chip ${utxoFilter === option.id ? "active" : ""}`}
              >
                {option.label} <span>{utxoCounts[option.id]}</span>
              </button>
            ))}
          </div>

          {utxosError && (
            <div className="cs-banner warn mb-4">{utxosError}</div>
          )}

          {utxosLoading ? (
            <div className="animate-pulse space-y-2">
              {[...Array(3)].map((_, i) => (
                <div
                  key={i}
                  className="h-12 rounded-lg bg-[var(--cs-surface-3)]"
                />
              ))}
            </div>
          ) : filteredUtxos.length > 0 ? (
            <div className="cs-table-wrap">
              <table className="cs-table">
                <thead>
                  <tr>
                    <th>Address</th>
                    <th>Amount</th>
                    <th>Type</th>
                    <th>Confirmations</th>
                    <th>Purpose</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUtxos.map((u, i) => (
                    <tr key={`${u.addr}-${u.amount}-${i}`}>
                      <td className="max-w-[260px] truncate cs-mono text-xs">
                        {u.addr}
                      </td>
                      <td className="cs-value text-[13px] text-[var(--cs-orange)]">
                        {formatSats(u.amount)}
                      </td>
                      <td>
                        <span className="cs-pill capitalize">
                          {u.utxo_type}
                        </span>
                      </td>
                      <td className="cs-mono text-xs">
                        {u.confirmations.toLocaleString()}
                      </td>
                      <td>{utxoPurpose(u.utxo_type)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="py-8 text-center text-sm cs-muted">
              {utxoRows.length === 0
                ? "No UTXOs found"
                : "No UTXOs match this filter"}
            </p>
          )}
        </div>
      </section>
    </section>
  );
}
