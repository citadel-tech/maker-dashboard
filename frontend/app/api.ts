// api.ts — place this at frontend/app/api.ts

// ─── Response envelope ────────────────────────────────────────────────────────

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

// ─── Domain types ─────────────────────────────────────────────────────────────

export interface MakerInfo {
  id: string;
}

export type MakerState = "running" | "stopped";

export interface MakerInfoDetailed {
  id: string;
  state: MakerState;
  rpc: string;
  zmq: string;
  wallet_name?: string;
  taproot: boolean;
  data_directory?: string;
  network_port: number;
  rpc_port: number;
  socks_port: number;
  control_port: number;
  min_swap_amount: number;
  fidelity_amount: number;
  fidelity_timelock: number;
  base_fee: number;
  amount_relative_fee_pct: number;
}

export interface BalanceInfo {
  /** satoshis */
  regular: number;
  swap: number;
  contract: number;
  fidelity: number;
  spendable: number;
}

export interface UtxoInfo {
  addr: string;
  /** satoshis */
  amount: number;
  confirmations: number;
  utxo_type: string;
}

export interface MakerStatus {
  id: string;
  alive: boolean;
  is_server_running: boolean;
}

export interface HealthResponse {
  status: string;
  makers: MakerStatus[];
}

export interface RpcStatusInfo {
  connected: boolean;
  version?: number;
  network?: string;
  block_height?: number;
  sync_progress?: number;
}

// ─── Request bodies ───────────────────────────────────────────────────────────

export interface CreateMakerRequest {
  id: string;
  rpc?: string;
  zmq?: string;
  rpc_user?: string;
  rpc_password?: string;
  tor_auth?: string;
  wallet_name?: string;
  taproot?: boolean;
  password?: string;
  data_directory?: string;
  network_port?: number;
  rpc_port?: number;
  socks_port?: number;
  control_port?: number;
  min_swap_amount?: number;
  fidelity_amount?: number;
  fidelity_timelock?: number;
  base_fee?: number;
  amount_relative_fee_pct?: number;
}

export interface UpdateMakerConfigRequest {
  rpc?: string;
  zmq?: string;
  rpc_user?: string;
  rpc_password?: string;
  tor_auth?: string;
  wallet_name?: string;
  taproot?: boolean;
  password?: string;
  data_directory?: string;
  network_port?: number;
  rpc_port?: number;
  socks_port?: number;
  control_port?: number;
  min_swap_amount?: number;
  fidelity_amount?: number;
  fidelity_timelock?: number;
  base_fee?: number;
  amount_relative_fee_pct?: number;
}
export interface SendToAddressRequest {
  address: string;
  /** satoshis */
  amount: number;
  feerate: number;
}

// ─── Error class ──────────────────────────────────────────────────────────────

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// ─── Fetch helpers ────────────────────────────────────────────────────────────

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json", ...options.headers },
    ...options,
  });

  let body: ApiResponse<T>;
  try {
    body = await res.json();
  } catch {
    throw new ApiError(res.status, "Invalid JSON response");
  }

  if (!body.success || !res.ok) {
    throw new ApiError(res.status, body.error ?? "Unknown error");
  }

  return body.data as T;
}

function get<T>(path: string): Promise<T> {
  return request<T>(path, { method: "GET" });
}

function post<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: "POST",
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

function put<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, { method: "PUT", body: JSON.stringify(body) });
}

function del<T>(path: string): Promise<T> {
  return request<T>(path, { method: "DELETE" });
}

// ─── SSE helper ───────────────────────────────────────────────────────────────

/**
 * Opens a Server-Sent Events stream for real-time log tailing.
 * Calls `onLine` for each log line received.
 * Returns a cleanup function — call it to close the stream.
 *
 * Usage:
 *   const stop = streamLogs("maker10", line => console.log(line));
 *   // later:
 *   stop();
 */
export function streamLogs(
  id: string,
  onLine: (line: string) => void,
  onError?: (err: Event) => void,
): () => void {
  const es = new EventSource(`/api/makers/${id}/logs/stream`);
  es.onmessage = (e) => onLine(e.data as string);
  if (onError) es.onerror = onError;
  return () => es.close();
}

// ─── Makers ───────────────────────────────────────────────────────────────────

export const makers = {
  list: (): Promise<MakerInfo[]> => get("/makers"),
  count: (): Promise<number> => get("/makers/count"),
  get: (id: string): Promise<MakerInfoDetailed> => get(`/makers/${id}`),
  info: (id: string): Promise<MakerInfoDetailed> => get(`/makers/${id}/info`),
  create: (body: CreateMakerRequest): Promise<MakerInfo> =>
    post("/makers", body),
  delete: (id: string): Promise<string> => del(`/makers/${id}`),
  updateConfig: (id: string, body: UpdateMakerConfigRequest): Promise<string> =>
    put(`/makers/${id}/config`, body),
  start: (id: string): Promise<string> => post(`/makers/${id}/start`),
  stop: (id: string): Promise<string> => post(`/makers/${id}/stop`),
  restart: (id: string): Promise<string> => post(`/makers/${id}/restart`),
};

// ─── Wallet ───────────────────────────────────────────────────────────────────

export const wallet = {
  balance: (id: string): Promise<BalanceInfo> => get(`/makers/${id}/balance`),
  utxos: (id: string): Promise<UtxoInfo[]> => get(`/makers/${id}/utxos`),
  swapUtxos: (id: string): Promise<UtxoInfo[]> =>
    get(`/makers/${id}/utxos/swap`),
  contractUtxos: (id: string): Promise<UtxoInfo[]> =>
    get(`/makers/${id}/utxos/contract`),
  fidelityUtxos: (id: string): Promise<UtxoInfo[]> =>
    get(`/makers/${id}/utxos/fidelity`),
  newAddress: (id: string): Promise<string> => get(`/makers/${id}/address`),
  send: (id: string, body: SendToAddressRequest): Promise<string> =>
    post(`/makers/${id}/send`, body),
  sync: (id: string): Promise<string> => post(`/makers/${id}/sync`),
};

// ─── Fidelity ─────────────────────────────────────────────────────────────────

export const fidelity = {
  /** Returns a formatted display string of all fidelity bonds for a maker */
  list: (id: string): Promise<string> => get(`/makers/${id}/fidelity`),
};

// ─── Monitoring ───────────────────────────────────────────────────────────────

export const monitoring = {
  status: (id: string): Promise<MakerStatus> => get(`/makers/${id}/status`),
  torAddress: (id: string): Promise<string> => get(`/makers/${id}/tor-address`),
  dataDir: (id: string): Promise<string> => get(`/makers/${id}/data-dir`),
  /** NOTE: Returns 501 Not Implemented — swap history tracking is not yet in the backend */
  swaps: (id: string): Promise<string[]> => get(`/makers/${id}/swaps`),
  /** Fetches the last N log lines for a maker (default: 100) */
  logs: (id: string, lines?: number): Promise<string[]> =>
    get(`/makers/${id}/logs${lines !== undefined ? `?lines=${lines}` : ""}`),
  /** Tests connectivity to the maker's configured Bitcoin Core RPC endpoint */
  rpcStatus: (id: string): Promise<RpcStatusInfo> =>
    get(`/makers/${id}/rpc-status`),
};

// ─── Health ───────────────────────────────────────────────────────────────────

export const health = {
  check: (): Promise<HealthResponse> => get("/health"),
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Convert satoshis to a BTC string (8 decimal places) */
export function satsToBtc(sats: number): string {
  return (sats / 1e8).toFixed(8);
}

/** Convert BTC amount to satoshis */
export function btcToSats(btc: number | string): number {
  return Math.round(Number(btc) * 1e8);
}
