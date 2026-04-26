import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { auth, ApiError } from "@/api";

export default function Login() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
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

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="password"
                className="block text-xs text-gray-400 mb-1.5"
              >
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoFocus
                required
                disabled={loading}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                placeholder="••••••••"
              />
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
