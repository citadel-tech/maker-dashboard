import { useCallback, useEffect, useState } from "react";
import {
  bitcoind,
  onboarding,
  type BitcoindStatusInfo,
  type StartupCheckKind,
} from "../api.ts";

const NETWORK_DEFAULTS: Record<
  "regtest" | "signet",
  { rpc: string; zmq: string }
> = {
  regtest: {
    rpc: "127.0.0.1:18443",
    zmq: "tcp://127.0.0.1:28332",
  },
  signet: {
    rpc: "127.0.0.1:38332",
    zmq: "tcp://127.0.0.1:28332",
  },
};

export default function BitcoindWidget() {
  const [status, setStatus] = useState<BitcoindStatusInfo>({
    running: false,
    managed: false,
  });
  const [network, setNetwork] = useState<"regtest" | "signet">("regtest");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function probeExternalBitcoind(): Promise<BitcoindStatusInfo | null> {
    const networks: Array<"regtest" | "signet"> = ["regtest", "signet"];
    for (const targetNetwork of networks) {
      const defaults = NETWORK_DEFAULTS[targetNetwork];
      const checks: StartupCheckKind[] = ["rest", "bitcoin", "rpc"];
      for (const check of checks) {
        try {
          const result = await onboarding.startupCheck({
            check,
            rpc: defaults.rpc,
            rpc_user: "user",
            rpc_password: "password",
            zmq: defaults.zmq,
          });
          if (result.success) {
            return { running: true, managed: false, network: targetNetwork };
          }
        } catch {
          // Ignore and try the next detection method.
        }
      }
    }
    return null;
  }

  const fetchStatus = useCallback(async () => {
    try {
      const s = await bitcoind.status();
      if (s.running) {
        setStatus(s);
        if (s.network === "regtest" || s.network === "signet") {
          setNetwork(s.network);
        }
        return;
      }
      const external = await probeExternalBitcoind();
      if (external?.network === "regtest" || external?.network === "signet") {
        setNetwork(external.network);
      }
      setStatus(external ?? s);
    } catch {
      // silently ignore poll failures
    }
  }, []);

  useEffect(() => {
    void fetchStatus();
    const interval = setInterval(fetchStatus, 5_000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  async function toggle() {
    setPending(true);
    setError(null);
    try {
      if (status.running) {
        const s = await bitcoind.stop();
        setStatus(s);
      } else {
        const s = await bitcoind.start({ network });
        setStatus(s);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setPending(false);
    }
  }

  const statusLabel = status.running
    ? `${status.network ?? network} ${status.managed ? "managed" : "detected"}`
    : "not detected";
  const canStop = status.running && status.managed;
  const stopTitle =
    status.running && !status.managed
      ? "This Bitcoin Core was detected externally. Stop it from the process that started it."
      : undefined;

  return (
    <div className="cs-bitcoind-widget">
      <div className="cs-bitcoind-copy">
        <div className="cs-bitcoind-head">
          <span className="cs-label">Bitcoin Core</span>
        </div>
        <div className="cs-bitcoind-main">
          <span
            className={`cs-bitcoind-dot ${status.running ? "running" : ""}`}
            aria-hidden="true"
          />
          <div>
            <strong>{status.running ? "Running" : "Stopped"}</strong>
            <p>{statusLabel}</p>
          </div>
        </div>
      </div>

      <div className="cs-bitcoind-controls">
        {!status.running && (
          <select
            value={network}
            onChange={(e) => setNetwork(e.target.value as "regtest" | "signet")}
            disabled={pending}
            aria-label="Bitcoin Core network"
          >
            <option value="regtest">regtest</option>
            <option value="signet">signet</option>
          </select>
        )}
        <button
          type="button"
          disabled={pending || (status.running && !canStop)}
          onClick={toggle}
          className={status.running ? "danger" : "primary"}
          title={stopTitle}
        >
          {pending ? "..." : status.running ? "Stop" : "Start"}
        </button>
      </div>

      {error && (
        <span className="cs-bitcoind-error" title={error}>
          {error}
        </span>
      )}
    </div>
  );
}
