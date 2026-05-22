import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Eye, EyeOff } from "lucide-react";
import { auth, ApiError } from "@/api";

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const passwordChanged =
    (location.state as { passwordChanged?: boolean } | null)?.passwordChanged ??
    false;
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await auth.login(password);
      navigate("/");
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError("Invalid password");
      } else {
        setError("Login failed. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex items-center justify-center px-4">
      <div className="w-full max-w-sm animate-slide-in-up">
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 shadow-xl shadow-black/40">
          <div className="mb-8 text-center">
            <h1 className="text-2xl font-bold text-orange-500 tracking-tight">
              Maker Dashboard
            </h1>
            <p className="mt-2 text-sm text-gray-400">
              Enter your password to continue
            </p>
          </div>

          {passwordChanged && (
            <div className="mb-6 px-3 py-3 bg-yellow-900/40 border border-yellow-700 rounded-lg text-sm text-yellow-300 leading-relaxed">
              <p className="font-medium mb-1">Action required before restart</p>
              <p>
                Update your{" "}
                <code className="font-mono bg-yellow-900/60 px-1 rounded">
                  DASHBOARD_PASSWORD
                </code>{" "}
                environment variable (or password file) to your new password
                before restarting the dashboard.
              </p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="password"
                className="block text-xs text-gray-400 mb-1.5"
              >
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoFocus
                  required
                  disabled={loading}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 pr-10 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  disabled={loading}
                  className="absolute inset-y-0 right-0 flex items-center px-3 text-gray-400 hover:text-gray-200 disabled:opacity-50"
                  tabIndex={-1}
                >
                  {showPassword ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            {error && (
              <div className="px-3 py-2 bg-red-900/40 border border-red-700 rounded-lg text-sm text-red-300 animate-fade-in">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || password.length === 0}
              className="w-full py-2.5 bg-orange-600 hover:bg-orange-700 active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-semibold text-sm transition-all duration-150"
            >
              {loading ? "Signing in..." : "Sign in"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
