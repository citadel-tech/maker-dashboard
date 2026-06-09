import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Eye, EyeOff, LockKeyhole, ShieldCheck } from "lucide-react";
import { auth, ApiError } from "@/api";

function PasswordInput({
  value,
  onChange,
  placeholder,
  disabled,
  id,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  autoFocus?: boolean;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="cs-input-wrap">
      <input
        id={id}
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required
        autoFocus={autoFocus}
        disabled={disabled}
        className="cs-input"
        placeholder={placeholder ?? "••••••••"}
      />
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        disabled={disabled}
        className="cs-eye"
        aria-label={show ? "Hide password" : "Show password"}
        tabIndex={-1}
      >
        {show ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
}

export default function Setup() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }

    setLoading(true);
    try {
      await auth.setup(password);
      navigate("/");
    } catch (err) {
      if (err instanceof ApiError) {
        switch (err.status) {
          case 409:
            if (err.message.includes("already initialized")) {
              setError(
                "Dashboard is already initialized. Use the login page instead.",
              );
              setTimeout(() => navigate("/login"), 1500);
            } else {
              setError(err.message);
            }
            break;
          case 400:
            setError(err.message);
            break;
          default:
            setError("Setup failed. Please try again.");
        }
      } else {
        setError("Setup failed. Please try again.");
      }
      setLoading(false);
    }
  }

  return (
    <div className="cs-page">
      <main className="cs-auth-page">
        <section className="cs-auth-card cs-card">
          <div className="cs-auth-head">
            <span className="cs-auth-mark">
              <LockKeyhole size={22} />
            </span>
            <span className="cs-network-badge cs-auth-badge">
              <span className="cs-dot" />
              First run
            </span>
            <h1>Coinswap Maker</h1>
            <p>Choose a dashboard password before creating makers.</p>
          </div>

          <form onSubmit={handleSubmit} className="cs-auth-form">
            <div className="cs-field">
              <label htmlFor="new-password">New password</label>
              <PasswordInput
                id="new-password"
                value={password}
                onChange={setPassword}
                disabled={loading}
                autoFocus
              />
            </div>

            <div className="cs-field">
              <label htmlFor="confirm-password">Confirm password</label>
              <PasswordInput
                id="confirm-password"
                value={confirm}
                onChange={setConfirm}
                disabled={loading}
              />
            </div>

            {error && <div className="cs-banner error">{error}</div>}

            <button
              type="submit"
              disabled={
                loading || password.length === 0 || confirm.length === 0
              }
              className="cs-btn primary block"
            >
              {loading ? "Initializing..." : "Initialize dashboard"}
            </button>
          </form>

          <div className="cs-auth-note">
            <ShieldCheck size={16} />
            <span>
              This password protects dashboard access and encrypts saved maker
              configuration.
            </span>
          </div>
        </section>
      </main>
    </div>
  );
}
