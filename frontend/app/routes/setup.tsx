import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Eye, EyeOff } from "lucide-react";
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
    <div className="relative">
      <input
        id={id}
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required
        autoFocus={autoFocus}
        disabled={disabled}
        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 pr-10 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        placeholder={placeholder ?? "••••••••"}
      />
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        disabled={disabled}
        className="absolute inset-y-0 right-0 flex items-center px-3 text-gray-400 hover:text-gray-200 disabled:opacity-50"
        tabIndex={-1}
      >
        {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
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
            setError(
              "Dashboard is already initialized. Use the login page instead.",
            );
            setTimeout(() => navigate("/login"), 1500);
            break;
          case 400:
            setError("Password must not be empty.");
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
    <div className="min-h-screen bg-gray-950 text-gray-100 flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm animate-slide-in-up">
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 shadow-xl shadow-black/40">
          <div className="mb-6 text-center">
            <h1 className="text-2xl font-bold text-orange-500 tracking-tight">
              First-run setup
            </h1>
            <p className="mt-2 text-sm text-gray-400 leading-relaxed">
              Choose a password to initialize your dashboard.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="new-password"
                className="block text-xs text-gray-400 mb-1.5"
              >
                New password
              </label>
              <PasswordInput
                id="new-password"
                value={password}
                onChange={setPassword}
                disabled={loading}
                autoFocus
              />
            </div>

            <div>
              <label
                htmlFor="confirm-password"
                className="block text-xs text-gray-400 mb-1.5"
              >
                Confirm password
              </label>
              <PasswordInput
                id="confirm-password"
                value={confirm}
                onChange={setConfirm}
                disabled={loading}
              />
            </div>

            {error && (
              <div className="px-3 py-2 bg-red-900/40 border border-red-700 rounded-lg text-sm text-red-300 animate-fade-in">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={
                loading || password.length === 0 || confirm.length === 0
              }
              className="w-full py-2.5 bg-orange-600 hover:bg-orange-700 active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-semibold text-sm transition-all duration-150"
            >
              {loading ? "Initializing..." : "Initialize dashboard"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
