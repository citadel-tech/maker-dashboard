import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Eye, EyeOff } from "lucide-react";
import BitcoindWidget from "./BitcoindWidget.tsx";
import { auth, ApiError } from "@/api";

function PasswordInput({
  value,
  onChange,
  placeholder,
  autoFocus,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  disabled?: boolean;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
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

function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirm) {
      setError("New passwords do not match");
      return;
    }
    setLoading(true);
    try {
      await auth.rotatePassword(oldPassword, newPassword);
      navigate("/login", { state: { passwordChanged: true } });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError("Current password is incorrect");
      } else if (err instanceof ApiError && err.status === 400) {
        setError("New password must differ from the current password");
      } else {
        setError("Failed to change password. Please try again.");
      }
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-sm bg-gray-900 border border-gray-800 rounded-2xl p-8 shadow-xl shadow-black/40 animate-slide-in-up">
        <h2 className="text-lg font-semibold text-gray-100 mb-6">
          Change Password
        </h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">
              Current password
            </label>
            <PasswordInput
              value={oldPassword}
              onChange={setOldPassword}
              autoFocus
              disabled={loading}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">
              New password
            </label>
            <PasswordInput
              value={newPassword}
              onChange={setNewPassword}
              disabled={loading}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">
              Confirm new password
            </label>
            <PasswordInput
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

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="flex-1 py-2.5 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-gray-300 rounded-lg text-sm font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !oldPassword || !newPassword || !confirm}
              className="flex-1 py-2.5 bg-orange-600 hover:bg-orange-700 active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-semibold text-sm transition-all duration-150"
            >
              {loading ? "Changing..." : "Change password"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function Nav() {
  const [showChangePassword, setShowChangePassword] = useState(false);

  return (
    <>
      <header className="border-b border-gray-800 bg-gray-950 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-between h-16">
            <Link
              to="/"
              className="text-xl lg:text-3xl font-bold text-orange-500"
            >
              Coinswap Maker Dashboard
            </Link>
            <div className="flex items-center gap-3">
              <BitcoindWidget />
              <button
                onClick={() => setShowChangePassword(true)}
                className="text-xs text-gray-400 hover:text-gray-200 transition-colors px-2 py-1 rounded hover:bg-gray-800"
              >
                Change password
              </button>
            </div>
          </div>
        </div>
      </header>
      {showChangePassword && (
        <ChangePasswordModal onClose={() => setShowChangePassword(false)} />
      )}
    </>
  );
}
