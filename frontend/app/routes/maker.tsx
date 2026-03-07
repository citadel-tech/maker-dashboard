import Nav from "../components/Nav";
import { Link } from "react-router-dom";

// Types
interface Maker {
  id: number;
  name: string;
  port: number;
  status: "online" | "offline";
  balance: string;
  activeSwaps: number;
  earnings: string;
  uptime: string;
  dataDir: string;
  bitcoinRpc: string;
  torAddress: string;
}

// Mock data - same as dashboard
const mockMakers: Maker[] = [
  {
    id: 1,
    name: "Maker 1",
    port: 6103,
    status: "online",
    balance: "0.85",
    activeSwaps: 2,
    earnings: "0.0089",
    uptime: "24h 15m",
    dataDir: "~/.coinswap/maker1",
    bitcoinRpc: "127.0.0.1:18443",
    torAddress: "abcd1234...xyz.onion:6102",
  },
  {
    id: 2,
    name: "Maker 2",
    port: 6104,
    status: "online",
    balance: "1.32",
    activeSwaps: 3,
    earnings: "0.0145",
    uptime: "72h 43m",
    dataDir: "~/.coinswap/maker2",
    bitcoinRpc: "127.0.0.1:18443",
    torAddress: "efgh5678...abc.onion:6102",
  },
  {
    id: 3,
    name: "Maker 3",
    port: 6105,
    status: "online",
    balance: "0.30",
    activeSwaps: 0,
    earnings: "0.0000",
    uptime: "2h 12m",
    dataDir: "~/.coinswap/maker3",
    bitcoinRpc: "127.0.0.1:18443",
    torAddress: "ijkl9012...def.onion:6102",
  },
];

export default function Maker() {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <Nav />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6 sm:mb-8 gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold mb-2">Makers</h1>
            <p className="text-sm sm:text-base text-gray-400">
              Manage and monitor all your maker instances
            </p>
          </div>
          <Link
            to="/addMaker"
            className="px-4 sm:px-5 py-2 sm:py-2.5 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-all font-semibold text-sm w-full sm:w-auto text-center"
          >
            + Add New Maker
          </Link>
        </div>

        {/* Makers List */}
        <div className="space-y-4 sm:space-y-5">
          {mockMakers.map((maker) => (
            <div
              key={maker.id}
              className="bg-gray-900 border border-gray-800 rounded-xl p-4 sm:p-6 hover:border-orange-500 transition-colors"
            >
              {/* Maker Header */}
              <div className="flex flex-col sm:flex-row sm:items-start justify-between mb-4 sm:mb-6 gap-3">
                <div className="flex items-center gap-3">
                  <span
                    className={`w-3 h-3 rounded-full flex-shrink-0 ${
                      maker.status === "online"
                        ? "bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.5)]"
                        : "bg-gray-600"
                    }`}
                  />
                  <div>
                    <h2 className="text-lg sm:text-xl font-semibold">
                      {maker.name}
                    </h2>
                    <p className="text-xs sm:text-sm text-gray-400">
                      Port: {maker.port}
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Link
                    to={`/makerDetails/${maker.id}`}
                    className="px-3 sm:px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-all text-sm font-semibold"
                  >
                    Manage
                  </Link>
                  <button className="px-3 sm:px-4 py-2 border border-gray-700 rounded-lg hover:bg-gray-800 hover:border-orange-500 transition-all text-sm">
                    {maker.status === "online" ? "Stop" : "Start"}
                  </button>
                </div>
              </div>

              {/* Stats Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4 mb-4 sm:mb-6">
                <div className="bg-gray-800 p-3 rounded-lg">
                  <div className="text-xs text-gray-400 mb-1">Balance</div>
                  <div className="text-sm sm:text-base font-semibold text-orange-500">
                    {maker.balance} BTC
                  </div>
                </div>
                <div className="bg-gray-800 p-3 rounded-lg">
                  <div className="text-xs text-gray-400 mb-1">Active Swaps</div>
                  <div className="text-sm sm:text-base font-semibold text-blue-500">
                    {maker.activeSwaps}
                  </div>
                </div>
                <div className="bg-gray-800 p-3 rounded-lg">
                  <div className="text-xs text-gray-400 mb-1">Earnings</div>
                  <div className="text-sm sm:text-base font-semibold text-emerald-500">
                    {maker.earnings} BTC
                  </div>
                </div>
                <div className="bg-gray-800 p-3 rounded-lg">
                  <div className="text-xs text-gray-400 mb-1">Uptime</div>
                  <div className="text-sm sm:text-base font-semibold">
                    {maker.uptime}
                  </div>
                </div>
                <div className="bg-gray-800 p-3 rounded-lg col-span-2">
                  <div className="text-xs text-gray-400 mb-1">
                    Data Directory
                  </div>
                  <div className="text-xs sm:text-sm font-mono text-gray-300 truncate">
                    {maker.dataDir}
                  </div>
                </div>
              </div>

              {/* Additional Info */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 pt-4 border-t border-gray-800">
                <div>
                  <div className="text-xs text-gray-400 mb-1">Bitcoin RPC</div>
                  <div className="text-xs sm:text-sm font-mono text-gray-300">
                    {maker.bitcoinRpc}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-400 mb-1">Tor Address</div>
                  <div className="text-xs sm:text-sm font-mono text-gray-300 truncate">
                    {maker.torAddress}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Empty State (show when no makers) */}
        {mockMakers.length === 0 && (
          <div className="bg-gray-0 border border-gray-800 rounded-xl p-12 text-center">
            <div className="text-6xl mb-4">📦</div>
            <h3 className="text-xl font-semibold mb-2">No Makers Yet</h3>
            <p className="text-gray-400 mb-6">
              Get started by adding your first maker instance
            </p>
            <button className="px-6 py-3 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-all font-semibold">
              + Add Your First Maker
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
