import { useState, useEffect, useCallback } from "react";
import { wallet, satsToBtc, btcToSats, type UtxoInfo } from "../../api";

interface Props {
  id: string;
  onBalanceRefresh: () => void;
}

export default function Wallet({ id, onBalanceRefresh }: Props) {
  const [utxos, setUtxos] = useState<UtxoInfo[] | null>(null);
  const [utxosLoading, setUtxosLoading] = useState(false);

  const [newAddress, setNewAddress] = useState<string | null>(null);
  const [addrLoading, setAddrLoading] = useState(false);

  const [sendAddr, setSendAddr] = useState("");
  const [sendAmount, setSendAmount] = useState("");
  const [sendFeerate, setSendFeerate] = useState("1");
  const [sendLoading, setSendLoading] = useState(false);
  const [sendResult, setSendResult] = useState<{
    ok: boolean;
    msg: string;
  } | null>(null);

  const fetchUtxos = useCallback(() => {
    setUtxosLoading(true);
    Promise.allSettled([
      wallet.swapUtxos(id),
      wallet.contractUtxos(id),
      wallet.fidelityUtxos(id),
      wallet.utxos(id),
    ])
      .then((results) => {
        const merged = results.flatMap((r) =>
          r.status === "fulfilled" ? r.value : []
        );
        setUtxos(merged);
      })
      .finally(() => setUtxosLoading(false));
  }, [id]);

  useEffect(() => {
    fetchUtxos();
  }, [fetchUtxos]);

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

  async function handleSend() {
    if (!sendAddr || !sendAmount || !sendFeerate) return;
    setSendLoading(true);
    setSendResult(null);
    try {
      const txid = await wallet.send(id, {
        address: sendAddr,
        amount: btcToSats(sendAmount),
        feerate: parseFloat(sendFeerate),
      });
      setSendResult({ ok: true, msg: `Sent! TxID: ${txid}` });
      setSendAddr("");
      setSendAmount("");
      onBalanceRefresh();
    } catch (e) {
      setSendResult({
        ok: false,
        msg: e instanceof Error ? e.message : "Send failed",
      });
    } finally {
      setSendLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Receive */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 sm:p-6">
          <h3 className="text-lg font-semibold mb-4">Receive Bitcoin</h3>
          <button
            onClick={handleGenerateAddress}
            disabled={addrLoading}
            className="w-full py-3 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-all font-semibold disabled:opacity-50"
          >
            {addrLoading ? "Generating…" : "Generate New Address"}
          </button>
          {newAddress && (
            <div className="mt-4 p-4 bg-gray-800 rounded-lg">
              <div className="text-xs text-gray-400 mb-2">New Address</div>
              <div className="font-mono text-sm break-all select-all">
                {newAddress}
              </div>
            </div>
          )}
        </div>

        {/* Send */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 sm:p-6">
          <h3 className="text-lg font-semibold mb-4">Send Bitcoin</h3>
          <div className="space-y-3">
            <div>
              <label className="text-sm text-gray-400 mb-1 block">
                Address
              </label>
              <input
                type="text"
                value={sendAddr}
                onChange={(e) => setSendAddr(e.target.value)}
                placeholder="bc1q..."
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg focus:border-orange-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="text-sm text-gray-400 mb-1 block">
                Amount (BTC)
              </label>
              <input
                type="number"
                value={sendAmount}
                onChange={(e) => setSendAmount(e.target.value)}
                placeholder="0.00"
                min="0"
                step="0.00000001"
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg focus:border-orange-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="text-sm text-gray-400 mb-1 block">
                Fee Rate (sat/vB)
              </label>
              <input
                type="number"
                value={sendFeerate}
                onChange={(e) => setSendFeerate(e.target.value)}
                placeholder="1"
                min="1"
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg focus:border-orange-500 focus:outline-none"
              />
            </div>
            <button
              onClick={handleSend}
              disabled={sendLoading || !sendAddr || !sendAmount}
              className="w-full py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-all font-semibold disabled:opacity-50"
            >
              {sendLoading ? "Sending…" : "Send"}
            </button>
            {sendResult && (
              <div
                className={`text-xs rounded-lg px-3 py-2 break-all ${
                  sendResult.ok
                    ? "bg-green-950 text-green-300"
                    : "bg-red-950 text-red-300"
                }`}
              >
                {sendResult.msg}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* UTXOs */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 sm:p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">UTXOs</h3>
          <button
            onClick={fetchUtxos}
            disabled={utxosLoading}
            className="text-xs px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-lg transition-all disabled:opacity-50"
          >
            {utxosLoading ? "Refreshing…" : "↻ Refresh"}
          </button>
        </div>

        {utxosLoading ? (
          <div className="animate-pulse space-y-2">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-10 bg-gray-800 rounded-lg" />
            ))}
          </div>
        ) : utxos && utxos.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-400 text-left border-b border-gray-800">
                  <th className="pb-2 pr-4">Address</th>
                  <th className="pb-2 pr-4">Amount</th>
                  <th className="pb-2 pr-4">Confirmations</th>
                  <th className="pb-2">Type</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {utxos.map((u, i) => (
                  <tr key={i}>
                    <td className="py-2 pr-4 font-mono text-xs truncate max-w-[180px]">
                      {u.addr}
                    </td>
                    <td className="py-2 pr-4 text-orange-400">
                      {satsToBtc(u.amount)} BTC
                    </td>
                    <td className="py-2 pr-4 text-gray-300">
                      {u.confirmations}
                    </td>
                    <td className="py-2">
                      <span className="text-xs bg-gray-800 px-2 py-0.5 rounded capitalize">
                        {u.utxo_type}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-gray-400 text-sm">No UTXOs found</p>
        )}
      </div>
    </div>
  );
}