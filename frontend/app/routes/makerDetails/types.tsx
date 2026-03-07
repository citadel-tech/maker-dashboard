import type { MakerInfoDetailed, BalanceInfo, MakerStatus } from "../../api";

export type Tab = "dashboard" | "wallet" | "swaps" | "logs" | "settings";

export interface MakerCoreData {
  id: string;
  info: MakerInfoDetailed | null;
  status: MakerStatus | null;
  balances: BalanceInfo | null;
  torAddress: string | null;
  dataDir: string | null;
  loading: boolean;
  isRunning: boolean;
}

export function btcUsd(btc: string): string {
  return `$${(parseFloat(btc) * 95000).toLocaleString(undefined, {
    maximumFractionDigits: 2,
  })}`;
}

export function LoadingCard() {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 animate-pulse">
      <div className="h-4 bg-gray-700 rounded w-1/3 mb-3" />
      <div className="h-7 bg-gray-700 rounded w-1/2" />
    </div>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="bg-red-950 border border-red-800 text-red-300 rounded-xl p-4 text-sm">
      {message}
    </div>
  );
}