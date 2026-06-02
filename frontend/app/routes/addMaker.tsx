import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Check,
  Eye,
  EyeOff,
  LoaderCircle,
  Plus,
  RefreshCw,
  X,
} from "lucide-react";
import {
  ApiError,
  makers,
  onboarding,
  type CreateMakerRequest,
  type StartupCheckKind,
} from "../api";

type CheckId = "bitcoin" | "rpc" | "rest" | "zmq" | "tor";

type CheckState = {
  status: "idle" | "loading" | "success" | "error";
  message?: string;
  detail?: string;
};

type PasswordField = "password" | "bitcoinPassword" | "torAuth";

const CHECKS: Array<{
  id: CheckId;
  title: string;
  desc: string;
}> = [
  {
    id: "bitcoin",
    title: "Bitcoin Core is running and fully synced",
    desc: "Fully synced node - testnet, regtest, or signet work for testing.",
  },
  {
    id: "rpc",
    title: "Bitcoin Core RPC is enabled",
    desc: "rpcuser, rpcpassword, and server=1 set in bitcoin.conf.",
  },
  {
    id: "rest",
    title: "Bitcoin Core REST is enabled",
    desc: "Dashboard checks /rest/chaininfo.json - needs rest=1 in bitcoin.conf.",
  },
  {
    id: "zmq",
    title: "ZMQ notifications are configured",
    desc: "zmqpubrawblock and zmqpubrawtx endpoints reachable on the configured port.",
  },
  {
    id: "tor",
    title: "Tor is running",
    desc: "Required for taker discovery, fidelity bonds, and routing all swap requests.",
  },
];

const EMPTY_CHECKS: Record<CheckId, CheckState> = {
  bitcoin: { status: "idle" },
  rpc: { status: "idle" },
  rest: { status: "idle" },
  zmq: { status: "idle" },
  tor: { status: "idle" },
};

function Field({
  label,
  required,
  optional,
  hint,
  className,
  children,
}: {
  label: string;
  required?: boolean;
  optional?: boolean;
  hint?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`cs-field ${className ?? ""}`}>
      <div className="cs-field-label-row">
        <label>
          {label}
          {required && <span className="cs-required"> *</span>}
        </label>
        {optional && <span>Optional</span>}
      </div>
      {children}
      {hint && <p className="cs-hint">{hint}</p>}
    </div>
  );
}

function CheckRow({
  row,
  state,
  onRun,
}: {
  row: (typeof CHECKS)[number];
  state: CheckState;
  onRun: () => void;
}) {
  const isLoading = state.status === "loading";
  const isSuccess = state.status === "success";
  const isError = state.status === "error";

  return (
    <div
      className={`cs-add-check ${
        isSuccess ? "success" : isError ? "error" : ""
      }`}
    >
      <span className="cs-add-check-dot" aria-hidden="true">
        {isLoading && <LoaderCircle size={14} className="cs-spin" />}
        {isSuccess && <Check size={14} />}
        {isError && <X size={14} />}
      </span>
      <div className="cs-add-check-body">
        <strong>{row.title}</strong>
        <p>{row.desc}</p>
        {state.message && (
          <span className={isError ? "cs-add-result error" : "cs-add-result"}>
            {state.message}
          </span>
        )}
        {state.detail && <span className="cs-add-detail">{state.detail}</span>}
      </div>
      <button
        type="button"
        className="cs-add-check-action"
        disabled={isLoading}
        onClick={onRun}
      >
        {isLoading
          ? "Testing..."
          : isSuccess
            ? "Passed"
            : isError
              ? "Retry"
              : "Click to test"}
      </button>
    </div>
  );
}

export default function AddMaker() {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    id: "",
    bitcoinRpc: "127.0.0.1:38332",
    bitcoinUser: "user",
    bitcoinPassword: "password",
    zmq: "tcp://127.0.0.1:28332",
    dataDir: "",
    password: "",
    torAuth: "",
    socksPort: "9050",
    controlPort: "9051",
    networkPort: "",
    makerRpcPort: "",
    requiredConfirms: "1",
  });
  const [submitting, setSubmitting] = useState(false);
  const [loadingPorts, setLoadingPorts] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [checks, setChecks] =
    useState<Record<CheckId, CheckState>>(EMPTY_CHECKS);
  const [showPassword, setShowPassword] = useState<
    Record<PasswordField, boolean>
  >({
    password: false,
    bitcoinPassword: false,
    torAuth: false,
  });

  useEffect(() => {
    let cancelled = false;

    makers
      .suggestedPorts()
      .then((ports) => {
        if (cancelled) return;
        setFormData((prev) => ({
          ...prev,
          networkPort: String(ports.network_port),
          makerRpcPort: String(ports.rpc_port),
        }));
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setError(err.message || "Failed to load maker ports");
      })
      .finally(() => {
        if (cancelled) return;
        setLoadingPorts(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const passedCount = useMemo(
    () => Object.values(checks).filter((c) => c.status === "success").length,
    [checks],
  );

  const isRunningAll = Object.values(checks).some(
    (c) => c.status === "loading",
  );
  const allPassed = CHECKS.every((row) => checks[row.id].status === "success");

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const { name, value } = e.target;

    if (
      ["bitcoinRpc", "bitcoinUser", "bitcoinPassword", "zmq"].includes(name)
    ) {
      setChecks((prev) => ({
        ...prev,
        bitcoin: { status: "idle" },
        rpc: { status: "idle" },
        rest: { status: "idle" },
        zmq: { status: "idle" },
      }));
    }
    if (["socksPort", "controlPort"].includes(name)) {
      setChecks((prev) => ({ ...prev, tor: { status: "idle" } }));
    }

    setFormData((prev) => ({ ...prev, [name]: value }));
  }

  function togglePassword(field: PasswordField) {
    setShowPassword((prev) => ({ ...prev, [field]: !prev[field] }));
  }

  async function runAllChecks() {
    await Promise.all(CHECKS.map((row) => runCheck(row.id)));
  }

  async function runCheck(check: CheckId) {
    setChecks((prev) => ({
      ...prev,
      [check]: { status: "loading", message: "Running check..." },
    }));

    try {
      const result = await onboarding.startupCheck({
        check: check as StartupCheckKind,
        rpc: formData.bitcoinRpc,
        rpc_user: formData.bitcoinUser,
        rpc_password: formData.bitcoinPassword,
        zmq: formData.zmq,
        socks_port: formData.socksPort
          ? parseInt(formData.socksPort, 10)
          : undefined,
        control_port: formData.controlPort
          ? parseInt(formData.controlPort, 10)
          : undefined,
      });

      setChecks((prev) => ({
        ...prev,
        [check]: {
          status: result.success ? "success" : "error",
          message: result.message,
          detail: result.detail,
        },
      }));
    } catch (err) {
      setChecks((prev) => ({
        ...prev,
        [check]: {
          status: "error",
          message: err instanceof Error ? err.message : "Check failed",
        },
      }));
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!allPassed) {
      setError("Run and pass all pre-checks before adding a maker.");
      return;
    }

    if (!formData.networkPort || !formData.makerRpcPort) {
      setError(
        "Waiting for maker ports to be assigned. Try again in a moment.",
      );
      return;
    }

    setSubmitting(true);

    const body: CreateMakerRequest = {
      id: formData.id,
      rpc: formData.bitcoinRpc,
      zmq: formData.zmq,
      rpc_user: formData.bitcoinUser,
      rpc_password: formData.bitcoinPassword,
      wallet_name: formData.id || undefined,
      data_directory: formData.dataDir || undefined,
      password: formData.password || undefined,
      tor_auth: formData.torAuth || undefined,
      socks_port: formData.socksPort ? parseInt(formData.socksPort) : undefined,
      control_port: formData.controlPort
        ? parseInt(formData.controlPort)
        : undefined,
      network_port: formData.networkPort
        ? parseInt(formData.networkPort)
        : undefined,
      rpc_port: formData.makerRpcPort
        ? parseInt(formData.makerRpcPort)
        : undefined,
      required_confirms: formData.requiredConfirms
        ? parseInt(formData.requiredConfirms)
        : undefined,
    };

    try {
      await makers.create(body);
      try {
        await makers.start(formData.id);
      } catch (startErr) {
        if (!(startErr instanceof ApiError && startErr.status === 409)) {
          throw startErr;
        }
      }
      navigate(`/makers/${formData.id}/setup`);
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status === 409) {
        setError(`A maker with the ID "${formData.id}" already exists.`);
      } else {
        setError(err instanceof Error ? err.message : "Failed to create maker");
      }
    } finally {
      setSubmitting(false);
    }
  }

  const passwordType = (field: PasswordField) =>
    showPassword[field] ? "text" : "password";

  return (
    <div className="cs-page">
      <main className="cs-add-page">
        <header className="cs-add-head">
          <div>
            <Link
              to="/"
              className="cs-add-back"
            >
              <ArrowLeft size={14} />
              Back to dashboard
            </Link>
            <h1>Add New Maker</h1>
            <p>Configure a new maker instance.</p>
          </div>
          <div className="cs-network-badge cs-add-network">
            <span className="cs-dot" />
            Signet · v0.4.2
          </div>
        </header>

        {error && (
          <div className="cs-banner error">
            <span>{error}</span>
            <button
              type="button"
              className="cs-home-icon"
              onClick={() => setError(null)}
              aria-label="Dismiss error"
            >
              <X size={15} />
            </button>
          </div>
        )}

        <form className="cs-add-layout" onSubmit={handleSubmit}>
          <section className="cs-card cs-add-basic">
            <div className="cs-card-head">
              <div>
                <h2>Basic information</h2>
                <p>
                  Identifies this maker across logs, RPC calls, and dashboards.
                </p>
              </div>
            </div>
            <div className="cs-card-body cs-field-grid">
              <Field
                label="Maker ID"
                required
                hint="Unique identifier - used in all API calls. Cannot be changed later."
                className="cs-span-2"
              >
                <input
                  className="cs-input"
                  name="id"
                  value={formData.id}
                  onChange={handleChange}
                  placeholder="e.g. maker-1"
                  required
                />
              </Field>

              <Field
                label="Data directory"
                optional
                hint={
                  <>
                    Where maker data is stored. Defaults to{" "}
                    <code>~/.coinswap/&lt;id&gt;</code>
                  </>
                }
                className="cs-span-2"
              >
                <input
                  className="cs-input"
                  name="dataDir"
                  value={formData.dataDir}
                  onChange={handleChange}
                  placeholder="e.g. ~/.coinswap/maker-1 (leave blank for default)"
                />
              </Field>

              <Field
                label="Maker password"
                optional
                hint="Encrypts the maker's wallet on disk."
                className="cs-span-2"
              >
                <div className="cs-input-wrap">
                  <input
                    className="cs-input"
                    type={passwordType("password")}
                    name="password"
                    value={formData.password}
                    onChange={handleChange}
                    placeholder="Optional"
                  />
                  <button
                    type="button"
                    className="cs-eye"
                    onClick={() => togglePassword("password")}
                    aria-label="Toggle maker password visibility"
                  >
                    {showPassword.password ? (
                      <EyeOff size={16} />
                    ) : (
                      <Eye size={16} />
                    )}
                  </button>
                </div>
              </Field>
            </div>
          </section>

          <section className="cs-card cs-add-bitcoin">
            <div className="cs-card-head">
              <div>
                <h2>Bitcoin connection</h2>
                <p>Bitcoin Core RPC + ZMQ for chain state and notifications.</p>
              </div>
            </div>
            <div className="cs-card-body cs-field-grid">
              <Field
                label="Bitcoin RPC endpoint"
                required
                hint="Format: host:port"
                className="cs-span-2"
              >
                <input
                  className="cs-input"
                  name="bitcoinRpc"
                  value={formData.bitcoinRpc}
                  onChange={handleChange}
                  placeholder="127.0.0.1:38332"
                  required
                />
              </Field>

              <Field label="RPC username" required>
                <input
                  className="cs-input"
                  name="bitcoinUser"
                  value={formData.bitcoinUser}
                  onChange={handleChange}
                  placeholder="user"
                  required
                />
              </Field>

              <Field label="RPC password" required>
                <div className="cs-input-wrap">
                  <input
                    className="cs-input"
                    type={passwordType("bitcoinPassword")}
                    name="bitcoinPassword"
                    value={formData.bitcoinPassword}
                    onChange={handleChange}
                    placeholder="password"
                    required
                  />
                  <button
                    type="button"
                    className="cs-eye"
                    onClick={() => togglePassword("bitcoinPassword")}
                    aria-label="Toggle RPC password visibility"
                  >
                    {showPassword.bitcoinPassword ? (
                      <EyeOff size={16} />
                    ) : (
                      <Eye size={16} />
                    )}
                  </button>
                </div>
              </Field>

              <Field
                label="ZMQ endpoint"
                required
                hint="Subscribe to rawblock + rawtx notifications."
                className="cs-span-2"
              >
                <input
                  className="cs-input"
                  name="zmq"
                  value={formData.zmq}
                  onChange={handleChange}
                  placeholder="tcp://127.0.0.1:28332"
                  required
                />
              </Field>
            </div>
          </section>

          <section className="cs-card cs-add-tor">
            <div className="cs-card-head">
              <div>
                <h2>Tor configuration</h2>
                <p>
                  Ports must match your Tor instance. Auth password is required
                  if your control port uses <code>HashedControlPassword</code>.
                </p>
              </div>
            </div>
            <div className="cs-card-body cs-field-grid">
              <Field label="SOCKS port" required>
                <input
                  className="cs-input"
                  type="number"
                  name="socksPort"
                  value={formData.socksPort}
                  onChange={handleChange}
                  placeholder="9050"
                />
              </Field>

              <Field label="Control port" required>
                <input
                  className="cs-input"
                  type="number"
                  name="controlPort"
                  value={formData.controlPort}
                  onChange={handleChange}
                  placeholder="9051"
                />
              </Field>

              <Field
                label="Tor auth password"
                optional
                hint="Leave blank if no auth configured."
                className="cs-span-2"
              >
                <div className="cs-input-wrap">
                  <input
                    className="cs-input"
                    type={passwordType("torAuth")}
                    name="torAuth"
                    value={formData.torAuth}
                    onChange={handleChange}
                    placeholder="Optional"
                  />
                  <button
                    type="button"
                    className="cs-eye"
                    onClick={() => togglePassword("torAuth")}
                    aria-label="Toggle Tor auth visibility"
                  >
                    {showPassword.torAuth ? (
                      <EyeOff size={16} />
                    ) : (
                      <Eye size={16} />
                    )}
                  </button>
                </div>
              </Field>
            </div>
          </section>

          <section className="cs-card cs-add-ports">
            <div className="cs-card-head">
              <div>
                <h2>Maker network ports</h2>
                <p>
                  Ports this maker listens on. Must be unique across all makers
                  running locally.
                </p>
              </div>
            </div>
            <div className="cs-card-body cs-field-grid">
              <Field
                label="Network port"
                required
                hint={
                  loadingPorts
                    ? "Finding an available port."
                    : "Used by takers to connect."
                }
              >
                <input
                  className="cs-input"
                  name="networkPort"
                  value={formData.networkPort}
                  readOnly
                  placeholder={
                    loadingPorts ? "Loading..." : "Assigned automatically"
                  }
                />
              </Field>

              <Field
                label="RPC port"
                required
                hint={
                  loadingPorts
                    ? "Finding an available port."
                    : "Used by maker-cli."
                }
              >
                <input
                  className="cs-input"
                  name="makerRpcPort"
                  value={formData.makerRpcPort}
                  readOnly
                  placeholder={
                    loadingPorts ? "Loading..." : "Assigned automatically"
                  }
                />
              </Field>

              <Field
                label="Required confirmations"
                required
                hint="Funding confirmations required before swaps continue."
                className="cs-span-2"
              >
                <input
                  className="cs-input"
                  type="number"
                  min="0"
                  name="requiredConfirms"
                  value={formData.requiredConfirms}
                  onChange={handleChange}
                />
              </Field>
            </div>
          </section>

          <section className="cs-card cs-add-prechecks">
            <div className="cs-card-head">
              <div>
                <h2>Pre-checks</h2>
                <p>
                  Run a live check against your current Bitcoin Core and Tor
                  settings before adding the maker.
                </p>
              </div>
            </div>
            <div className="cs-card-body">
              <div className="cs-add-checks">
                {CHECKS.map((row) => (
                  <CheckRow
                    key={row.id}
                    row={row}
                    state={checks[row.id]}
                    onRun={() => void runCheck(row.id)}
                  />
                ))}
              </div>
            </div>
            <div className="cs-add-check-footer">
              <span>
                {CHECKS.length} checks ·{" "}
                {passedCount > 0 ? `${passedCount} passed` : "not run"}
              </span>
              <button
                type="button"
                className={`cs-btn primary ${isRunningAll ? "spin" : ""}`}
                disabled={isRunningAll}
                onClick={() => void runAllChecks()}
              >
                <RefreshCw size={15} />
                {isRunningAll ? "Testing..." : "Test all"}
              </button>
            </div>
          </section>

          <div className="cs-add-actions">
            <Link
              to="/"
              className="cs-btn ghost"
            >
              Cancel
            </Link>
            <button
              type="submit"
              className="cs-btn primary"
              disabled={submitting || loadingPorts}
            >
              <Plus size={18} />
              {submitting
                ? "Adding maker..."
                : loadingPorts
                  ? "Assigning ports..."
                  : "Add maker"}
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}
