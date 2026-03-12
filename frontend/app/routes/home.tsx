import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Nav from "../components/Nav";
import OnboardingWizard from "./onboarding";
import {
  makers,
  wallet,
  monitoring,
  satsToBtc,
  type MakerInfoDetailed,
  type BalanceInfo,
  type MakerState,
} from "../api.ts";

// ─── Types ────────────────────────────────────────────────────────────────────

interface MakerRow {
  id: string;
  state: MakerState;
  alive: boolean;
  balance: BalanceInfo | null;
  torAddress: string | null;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Home() {
  const [makerRows, setMakerRows] = useState<MakerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Set<string>>(new Set());

  async function loadMakers() {
    try {
      setError(null);
      const list = await makers.list();
      const rows = await Promise.all(
        list.map(async ({ id }): Promise<MakerRow> => {
          const [detail, bal, status, tor] = await Promise.allSettled([
            makers.get(id),
            wallet.balance(id),
            monitoring.status(id),
            monitoring.torAddress(id),
          ]);
          const info: MakerInfoDetailed | null =
            detail.status === "fulfilled" ? detail.value : null;
          const balData: BalanceInfo | null =
            bal.status === "fulfilled" ? bal.value : null;
          const alive =
            status.status === "fulfilled" ? status.value.alive : false;
          const torAddress = tor.status === "fulfilled" ? tor.value : null;
          return {
            id,
            state: info?.state ?? "stopped",
            alive,
            balance: balData,
            torAddress,
          };
        }),
      );
      setMakerRows(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load makers");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadMakers();
    const interval = setInterval(loadMakers, 15_000);
    return () => clearInterval(interval);
  }, []);

  async function toggleMaker(id: string, currentState: MakerState) {
    setPending((prev) => new Set(prev).add(id));
    try {
      if (currentState === "running") await makers.stop(id);
      else await makers.start(id);
      await loadMakers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setPending((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 text-gray-100">
        <Nav />
        <div className="flex items-center justify-center h-64">
          <div className="text-gray-400 animate-pulse">Loading makers…</div>
        </div>
      </div>
    );
  }

  // No makers — show guided onboarding instead of empty dashboard
  if (makerRows.length === 0) {
    return <OnboardingWizard />;
  }

  const totalSpendableSats = makerRows.reduce(
    (sum, m) => sum + (m.balance?.spendable ?? 0),
    0,
  );
  const onlineCount = makerRows.filter((m) => m.alive).length;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <Nav />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {error && (
          <div className="mb-6 px-4 py-3 bg-red-900/40 border border-red-700 rounded-lg text-sm text-red-300 flex justify-between items-center">
            <span>{error}</span>
            <button
              onClick={() => setError(null)}
              className="ml-4 text-red-400 hover:text-red-200 font-bold"
            >
              ✕
            </button>
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5 mb-6 sm:mb-8">
          <div className="bg-gray-900 p-4 sm:p-5 rounded-xl border border-gray-800">
            <div className="text-sm text-gray-400 mb-2">Total Spendable</div>
            <div className="text-2xl sm:text-3xl font-bold text-orange-500">
              {satsToBtc(totalSpendableSats)} BTC
            </div>
            <div className="text-xs text-gray-500 mt-1">
              Across {makerRows.length} maker{makerRows.length !== 1 ? "s" : ""}
            </div>
          </div>
          <div className="bg-gray-900 p-4 sm:p-5 rounded-xl border border-gray-800">
            <div className="text-sm text-gray-400 mb-2">System Health</div>
            <div className="text-2xl sm:text-3xl font-bold text-purple-500">
              {onlineCount}/{makerRows.length}
            </div>
            <div className="text-xs text-gray-500 mt-1">Makers online</div>
          </div>
          <div className="bg-gray-900 p-4 sm:p-5 rounded-xl border border-gray-800">
            <div className="text-sm text-gray-400 mb-2">Running</div>
            <div className="text-2xl sm:text-3xl font-bold text-emerald-500">
              {makerRows.filter((m) => m.state === "running").length}
            </div>
            <div className="text-xs text-gray-500 mt-1">
              {makerRows.filter((m) => m.state === "stopped").length} stopped
            </div>
          </div>
        </div>

        {/* Makers list */}
        <div className="mb-6 sm:mb-8">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-4 sm:mb-5 gap-3">
            <h2 className="text-lg sm:text-xl font-semibold">Your Makers</h2>
            <Link
              to="/addMaker"
              className="px-4 sm:px-5 py-2 sm:py-2.5 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-all font-semibold text-sm w-full sm:w-auto text-center"
            >
              + Add New Maker
            </Link>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-5">
            {makerRows.map((maker) => {
              const isRunning = maker.state === "running";
              const isPending = pending.has(maker.id);
              return (
                <div
                  key={maker.id}
                  className="bg-gray-900 border border-gray-800 rounded-xl p-4 sm:p-5 hover:border-orange-500 transition-colors"
                >
                  <div className="flex items-center justify-between mb-3 sm:mb-4">
                    <div className="flex items-center gap-2">
                      <span
                        className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                          maker.alive
                            ? "bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.5)]"
                            : "bg-gray-600"
                        }`}
                      />
                      <h3 className="text-base sm:text-lg font-semibold truncate">
                        {maker.id}
                      </h3>
                    </div>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        isRunning
                          ? "bg-emerald-900/50 text-emerald-400"
                          : "bg-gray-800 text-gray-500"
                      }`}
                    >
                      {isRunning ? "Running" : "Stopped"}
                    </span>
                  </div>

                  {maker.torAddress && (
                    <div className="mb-3 px-3 py-2 bg-gray-800 rounded-lg">
                      <div className="text-xs text-gray-400 mb-1">
                        Tor Address
                      </div>
                      <div className="font-mono text-xs text-orange-300 truncate">
                        {maker.torAddress}
                      </div>
                    </div>
                  )}

                  {maker.balance ? (
                    <div className="grid grid-cols-2 gap-3 mb-3 sm:mb-4">
                      <div>
                        <div className="text-xs text-gray-400 mb-1">
                          Spendable
                        </div>
                        <div className="text-sm font-semibold text-emerald-400">
                          {satsToBtc(maker.balance.spendable)} BTC
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-gray-400 mb-1">
                          Regular
                        </div>
                        <div className="text-sm font-semibold">
                          {satsToBtc(maker.balance.regular)} BTC
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-gray-400 mb-1">Swap</div>
                        <div className="text-sm font-semibold">
                          {satsToBtc(maker.balance.swap)} BTC
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-gray-400 mb-1">
                          Fidelity
                        </div>
                        <div className="text-sm font-semibold">
                          {satsToBtc(maker.balance.fidelity)} BTC
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs text-gray-500 mb-4 italic">
                      {isRunning ? "Balance unavailable" : "Maker is stopped"}
                    </div>
                  )}

                  <div className="flex gap-2">
                    <Link
                      to={`/makerDetails/${maker.id}`}
                      className="flex-1 text-center py-2 px-3 sm:px-4 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-all text-sm font-semibold"
                    >
                      Manage
                    </Link>
                    <button
                      disabled={isPending}
                      onClick={() => toggleMaker(maker.id, maker.state)}
                      className={`py-2 px-3 sm:px-4 rounded-lg border transition-all text-sm ${
                        isPending
                          ? "border-gray-700 text-gray-600 cursor-not-allowed"
                          : isRunning
                            ? "border-gray-700 hover:bg-gray-800 hover:border-orange-500"
                            : "border-emerald-700 text-emerald-400 hover:bg-emerald-900/30"
                      }`}
                    >
                      {isPending ? "…" : isRunning ? "Stop" : "Start"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Recent Activity */}
        <div>
          <h2 className="text-lg sm:text-xl font-semibold mb-4 sm:mb-5">
            Recent Activity
          </h2>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 text-center">
            <p className="text-sm text-gray-500">Swap history coming soon</p>
          </div>
        </div>
      </main>
    </div>
  );
}
