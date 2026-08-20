import { useState } from "react";
import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Eye, EyeOff, LoaderCircle, Play, X } from "lucide-react";
import { ApiError, makers, type CreateMakerRequest } from "../api";

/** Default values set by openswap core (MakerServerConfig::default / MIN_FEE_RATE).
 * Relative fees are shown as plain percentages (0.25 = 0.25%); the value sent
 * to the API is the entered number divided by 100. */
const CORE_DEFAULTS = {
  fidelityAmount: "10000",
  fidelityTimelock: "15000",
  feeRate: "2",
  baseFee: "500",
  amountRelativeFeePct: "0.25",
  timeRelativeFeePct: "0.01",
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

export default function AddMaker({ firstRun = false }: { firstRun?: boolean }) {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [fidelityAmount, setFidelityAmount] = useState(
    CORE_DEFAULTS.fidelityAmount,
  );
  const [fidelityTimelock, setFidelityTimelock] = useState(
    CORE_DEFAULTS.fidelityTimelock,
  );
  const [feeRate, setFeeRate] = useState(CORE_DEFAULTS.feeRate);
  const [baseFee, setBaseFee] = useState(CORE_DEFAULTS.baseFee);
  const [amountRelativeFeePct, setAmountRelativeFeePct] = useState(
    CORE_DEFAULTS.amountRelativeFeePct,
  );
  const [timeRelativeFeePct, setTimeRelativeFeePct] = useState(
    CORE_DEFAULTS.timeRelativeFeePct,
  );
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (starting) return;

    const id = name.trim();
    if (!id) {
      setError("Maker name cannot be empty.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Wallet passwords do not match.");
      return;
    }

    const parsed = {
      fidelityAmount: Number(fidelityAmount),
      fidelityTimelock: Number(fidelityTimelock),
      feeRate: Number(feeRate),
      baseFee: Number(baseFee),
      amountRelativeFeePct: Number(amountRelativeFeePct),
      timeRelativeFeePct: Number(timeRelativeFeePct),
    };
    if (
      !Number.isInteger(parsed.fidelityAmount) ||
      parsed.fidelityAmount <= 0
    ) {
      setError("Fidelity amount must be a positive whole number of sats.");
      return;
    }
    if (
      !Number.isInteger(parsed.fidelityTimelock) ||
      parsed.fidelityTimelock < 12960 ||
      parsed.fidelityTimelock > 25920
    ) {
      setError("Fidelity timelock must be between 12960 and 25920 blocks.");
      return;
    }
    if (!Number.isFinite(parsed.feeRate) || parsed.feeRate <= 0) {
      setError("Fee rate must be a positive number (sat/vB).");
      return;
    }
    if (!Number.isInteger(parsed.baseFee) || parsed.baseFee < 0) {
      setError("Absolute fee must be a whole number of sats.");
      return;
    }
    if (
      !Number.isFinite(parsed.amountRelativeFeePct) ||
      parsed.amountRelativeFeePct < 0 ||
      !Number.isFinite(parsed.timeRelativeFeePct) ||
      parsed.timeRelativeFeePct < 0
    ) {
      setError("Relative fees must be non-negative numbers.");
      return;
    }

    setError(null);
    setStarting(true);

    const body: CreateMakerRequest = {
      id,
      wallet_name: id,
      password: password || undefined,
      fidelity_amount: parsed.fidelityAmount,
      fidelity_timelock: parsed.fidelityTimelock,
      fidelity_feerate: parsed.feeRate,
      base_fee: parsed.baseFee,
      amount_relative_fee_pct: parsed.amountRelativeFeePct / 100,
      time_relative_fee_pct: parsed.timeRelativeFeePct / 100,
    };

    try {
      await makers.create(body);
      try {
        await makers.start(id);
      } catch (startErr) {
        if (!(startErr instanceof ApiError && startErr.status === 409)) {
          throw startErr;
        }
      }
      navigate(`/makers/${id}/setup`);
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status === 409) {
        setError(`A maker named "${id}" already exists.`);
      } else {
        setError(err instanceof Error ? err.message : "Failed to create maker");
      }
      setStarting(false);
    }
  }

  return (
    <div className="cs-page">
      <main className="cs-add-page">
        <header className="cs-add-head">
          <div>
            {!firstRun && (
              <Link to="/" className="cs-add-back">
                <ArrowLeft size={14} />
                Back to dashboard
              </Link>
            )}
            <h1>{firstRun ? "Create First Maker" : "Add New Maker"}</h1>
            <p>Name your maker — everything else is configured for you.</p>
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
                <h2>Maker</h2>
                <p>
                  Identifies this maker across logs, RPC calls, and dashboards.
                </p>
              </div>
            </div>
            <div className="cs-card-body cs-field-grid">
              <Field
                label="Maker name"
                required
                hint={
                  <>
                    Unique identifier. Data is stored at{" "}
                    <code>~/.openswap/&lt;name&gt;</code> automatically.
                  </>
                }
                className="cs-span-2"
              >
                <input
                  className="cs-input"
                  name="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. maker-1"
                  disabled={starting}
                  required
                />
              </Field>

              <Field
                label="Wallet password"
                hint="Encrypts the wallet. Never stored; you will be asked for it on each start."
                className="cs-span-2"
              >
                <div className="cs-input-wrap">
                  <input
                    className="cs-input"
                    type={showPassword ? "text" : "password"}
                    name="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Leave blank for an unencrypted wallet"
                    disabled={starting}
                  />
                  <button
                    type="button"
                    className="cs-eye"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label="Toggle wallet password visibility"
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </Field>

              <Field
                label="Confirm wallet password"
                hint="Must match the wallet password above."
                className="cs-span-2"
              >
                <div className="cs-input-wrap">
                  <input
                    className="cs-input"
                    type={showPassword ? "text" : "password"}
                    name="confirmPassword"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Repeat password"
                    disabled={starting}
                  />
                  <button
                    type="button"
                    className="cs-eye"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label="Toggle confirm password visibility"
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </Field>
              {confirmPassword !== "" && password !== confirmPassword && (
                <p className="cs-span-2" role="alert">
                  Wallet passwords do not match.
                </p>
              )}
            </div>
          </section>

          <section className="cs-card">
            <div className="cs-card-head">
              <div>
                <h2>Fidelity bond</h2>
                <p>
                  Locks up funds to prove this maker's commitment to the
                  network. Defaults match openswap core.
                </p>
              </div>
            </div>
            <div className="cs-card-body cs-field-grid">
              <Field
                label="Bond amount"
                required
                hint="Satoshis locked in the fidelity bond."
              >
                <input
                  className="cs-input"
                  name="fidelityAmount"
                  type="number"
                  min={1}
                  step={1}
                  value={fidelityAmount}
                  onChange={(e) => setFidelityAmount(e.target.value)}
                  disabled={starting}
                  required
                />
              </Field>

              <Field
                label="Timelock"
                required
                hint="Blocks until the bond can be reclaimed (12960–25920)."
              >
                <input
                  className="cs-input"
                  name="fidelityTimelock"
                  type="number"
                  min={12960}
                  max={25920}
                  step={1}
                  value={fidelityTimelock}
                  onChange={(e) => setFidelityTimelock(e.target.value)}
                  disabled={starting}
                  required
                />
              </Field>

              <Field
                label="Fidelity fee rate (sat/vB)"
                required
                hint="sat/vB for the bond transaction. Saved with the maker config."
                className="cs-span-2"
              >
                <input
                  className="cs-input"
                  name="feeRate"
                  type="number"
                  min={0}
                  step="any"
                  value={feeRate}
                  onChange={(e) => setFeeRate(e.target.value)}
                  disabled={starting}
                  required
                />
              </Field>
            </div>
          </section>

          <section className="cs-card">
            <div className="cs-card-head">
              <div>
                <h2>Maker fees</h2>
                <p>
                  What this maker charges takers per swap. Defaults match
                  openswap core.
                </p>
              </div>
            </div>
            <div className="cs-card-body cs-field-grid">
              <Field
                label="Absolute fee"
                required
                hint="Fixed fee per swap, in satoshis."
              >
                <input
                  className="cs-input"
                  name="baseFee"
                  type="number"
                  min={0}
                  step={1}
                  value={baseFee}
                  onChange={(e) => setBaseFee(e.target.value)}
                  disabled={starting}
                  required
                />
              </Field>

              <Field
                label="Amount-relative fee (%)"
                required
                hint="Percentage of the swap amount (e.g. 0.25 = 0.25%)."
              >
                <input
                  className="cs-input"
                  name="amountRelativeFeePct"
                  type="number"
                  min={0}
                  step="any"
                  value={amountRelativeFeePct}
                  onChange={(e) => setAmountRelativeFeePct(e.target.value)}
                  disabled={starting}
                  required
                />
              </Field>

              <Field
                label="Time-relative fee (%)"
                required
                hint="Percentage per unit of timelock duration (e.g. 0.01 = 0.01%)."
                className="cs-span-2"
              >
                <input
                  className="cs-input"
                  name="timeRelativeFeePct"
                  type="number"
                  min={0}
                  step="any"
                  value={timeRelativeFeePct}
                  onChange={(e) => setTimeRelativeFeePct(e.target.value)}
                  disabled={starting}
                  required
                />
              </Field>
            </div>
          </section>

          <div className="cs-add-actions">
            <Link to="/" className="cs-btn ghost">
              Cancel
            </Link>
            <button
              type="submit"
              className="cs-btn primary"
              disabled={starting}
            >
              {starting ? (
                <LoaderCircle size={18} className="cs-spin" />
              ) : (
                <Play size={18} />
              )}
              {starting ? "Starting maker..." : "Start maker"}
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}
