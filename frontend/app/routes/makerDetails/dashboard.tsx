import { satsToBtc } from "../../api";
import { LoadingCard } from "./components";
import { btcUsd, type MakerCoreData } from "./types";
interface Props {
  core: MakerCoreData;
}

export default function Dashboard({ core }: Props) {
  const { info, balances, dataDir, loading } = core;

  const totalBtc = balances
    ? satsToBtc(
        balances.regular +
          balances.swap +
          balances.contract +
          balances.fidelity,
      )
    : null;

  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <LoadingCard key={i} />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Quick Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="bg-gray-900 p-4 sm:p-5 rounded-xl border border-gray-800 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md hover:shadow-orange-500/5">
          <div className="text-sm text-gray-400 mb-2">Spendable Balance</div>
          <div className="text-2xl font-bold text-orange-500">
            {balances ? satsToBtc(balances.spendable) : "—"} BTC
          </div>
          {balances && (
            <div className="text-xs text-gray-500 mt-1">
              {btcUsd(satsToBtc(balances.spendable))}
            </div>
          )}
        </div>

        <div className="bg-gray-900 p-4 sm:p-5 rounded-xl border border-gray-800 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md hover:shadow-orange-500/5">
          <div className="text-sm text-gray-400 mb-2">Total Balance</div>
          <div className="text-2xl font-bold text-blue-500">
            {totalBtc ?? "—"} BTC
          </div>
          {totalBtc && (
            <div className="text-xs text-gray-500 mt-1">{btcUsd(totalBtc)}</div>
          )}
        </div>

        <div className="bg-gray-900 p-4 sm:p-5 rounded-xl border border-gray-800 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md hover:shadow-orange-500/5">
          <div className="text-sm text-gray-400 mb-2">Taproot</div>
          <div className="text-2xl font-bold text-purple-500">
            {info ? (info.taproot ? "Enabled" : "Disabled") : "—"}
          </div>
          <div className="text-xs text-gray-500 mt-1">Wallet type</div>
        </div>
      </div>

      {/* Wallet Balances */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 sm:p-6">
        <h3 className="text-lg font-semibold mb-4">Wallet Balances</h3>
        {balances ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {(
              ["regular", "swap", "contract", "fidelity", "spendable"] as const
            ).map((type) => (
              <div
                key={type}
                className="bg-gray-800 p-4 rounded-lg border border-gray-700 transition-all duration-200 hover:border-gray-600 hover:shadow-sm hover:shadow-orange-500/5"
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="font-medium capitalize text-gray-100">
                    {type}
                  </div>
                  {type === "spendable" && (
                    <span className="text-xs bg-emerald-600 text-white px-2 py-0.5 rounded">
                      Available
                    </span>
                  )}
                </div>
                <div
                  className={`text-xl font-bold mb-1 ${
                    type === "spendable"
                      ? "text-emerald-500"
                      : "text-orange-500"
                  }`}
                >
                  {satsToBtc(balances[type])} BTC
                </div>
                <div className="text-xs text-gray-400 mb-2">
                  {btcUsd(satsToBtc(balances[type]))}
                </div>
                <div className="text-xs text-gray-500 leading-relaxed">
                  {type === "regular" && "Single signature wallet coins"}
                  {type === "swap" && "2of2 multisig coins from swaps"}
                  {type === "contract" && "Live contract transactions"}
                  {type === "fidelity" && "Locked in fidelity bonds"}
                  {type === "spendable" && "Available to spend"}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-gray-400 text-sm">Balance data unavailable</p>
        )}
      </div>

      {/* Configuration */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 sm:p-6">
        <h3 className="text-lg font-semibold mb-4">Configuration</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="bg-gray-800 p-4 rounded-lg border border-gray-700">
            <div className="text-xs text-gray-400 mb-2">Data Directory</div>
            <div className="font-mono text-sm text-gray-100 break-all">
              {dataDir ?? info?.data_directory ?? "—"}
            </div>
          </div>
          <div className="bg-gray-800 p-4 rounded-lg border border-gray-700">
            <div className="text-xs text-gray-400 mb-2">Bitcoin RPC</div>
            <div className="font-mono text-sm text-gray-100">
              {info?.rpc ?? "—"}
            </div>
          </div>
          <div className="bg-gray-800 p-4 rounded-lg border border-gray-700">
            <div className="text-xs text-gray-400 mb-2">ZMQ</div>
            <div className="font-mono text-sm text-gray-100">
              {info?.zmq ?? "—"}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
