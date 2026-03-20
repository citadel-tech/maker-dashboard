import { useState, useEffect } from "react";
import { monitoring, satsToBtc, type UtxoInfo } from "../../api";
import { LoadingCard, ErrorBanner } from "./components";

interface Props {
  id: string;
}

function swapKey(utxo: UtxoInfo) {
  return [utxo.addr, utxo.amount, utxo.confirmations, utxo.utxo_type].join(":");
}

function SwapTable({
  utxos,
  status,
}: {
  utxos: UtxoInfo[];
  status: "active" | "completed";
}) {
  if (utxos.length === 0) {
    return (
      <p className="text-gray-400 text-sm">
        {status === "active" ? "No active swaps" : "No completed swaps yet"}
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-gray-400 text-left border-b border-gray-800">
            <th className="pb-2 pr-4">Address</th>
            <th className="pb-2 pr-4">Amount</th>
            <th className="pb-2 pr-4">Confirmations</th>
            <th className="pb-2">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-800">
          {utxos.map((u) => (
            <tr
              key={swapKey(u)}
              className="transition-colors duration-150 hover:bg-gray-800/50"
            >
              <td className="py-2 pr-4 font-mono text-xs truncate max-w-xs">
                {u.addr}
              </td>
              <td className="py-2 pr-4 text-orange-400">
                {satsToBtc(u.amount)} BTC
              </td>
              <td className="py-2 pr-4 text-gray-300">{u.confirmations}</td>
              <td className="py-2">
                {status === "active" ? (
                  <span className="text-xs bg-yellow-900/60 text-yellow-300 px-2 py-0.5 rounded">
                    In Progress
                  </span>
                ) : (
                  <span className="text-xs bg-green-900/60 text-green-300 px-2 py-0.5 rounded">
                    Completed
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Swaps({ id }: Props) {
  const [active, setActive] = useState<UtxoInfo[] | null>(null);
  const [completed, setCompleted] = useState<UtxoInfo[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    monitoring
      .swaps(id)
      .then((data) => {
        setActive(data.active);
        setCompleted(data.completed);
      })
      .catch((e) =>
        setError(
          e instanceof Error ? e.message : "Failed to load swap history",
        ),
      )
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <LoadingCard />;
  if (error) return <ErrorBanner message={error} />;

  return (
    <div className="space-y-6">
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 sm:p-6">
        <h3 className="text-lg font-semibold mb-4">Active Swaps</h3>
        <SwapTable utxos={active ?? []} status="active" />
      </div>
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 sm:p-6">
        <h3 className="text-lg font-semibold mb-4">Completed Swaps</h3>
        <SwapTable utxos={completed ?? []} status="completed" />
      </div>
    </div>
  );
}
