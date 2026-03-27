import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { X } from "lucide-react";
import Nav from "../components/Nav";
import { makers, type CreateMakerRequest, ApiError } from "../api";

export default function AddMaker() {
  const navigate = useNavigate();

  const [formData, setFormData] = useState({
    id: "",
    rpcHost: "127.0.0.1",
    rpcPort: "38332",
    bitcoinRpc: "127.0.0.1:38332",
    bitcoinUser: "user",
    bitcoinPassword: "password",
    zmq: "tcp://127.0.0.1:28332",
    dataDir: "",
    taproot: true,
    password: "",
    torAuth: "",
    socksPort: "9050",
    controlPort: "9051",
    networkPort: "6102",
    makerRpcPort: "6103",
  });

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState({
    password: false,
    bitcoinPassword: false,
    torAuth: false,
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type, checked } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? checked : value,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    const body: CreateMakerRequest = {
      id: formData.id,
      rpc: formData.bitcoinRpc,
      zmq: formData.zmq,
      rpc_user: formData.bitcoinUser,
      rpc_password: formData.bitcoinPassword,
      wallet_name: formData.id || undefined,
      taproot: formData.taproot,
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
  };

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <Nav />

      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-8 animate-slide-in-up">
        {/* Header */}
        <div className="mb-6 sm:mb-8">
          <div className="flex items-center gap-3 mb-2">
            <button
              onClick={() => window.history.back()}
              className="p-2 hover:bg-gray-800 rounded-lg transition-all duration-150 hover:-translate-x-0.5"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 19l-7-7 7-7"
                />
              </svg>
            </button>
            <h1 className="text-2xl sm:text-3xl font-bold">Add New Maker</h1>
          </div>
          <p className="text-sm sm:text-base text-gray-400 ml-14">
            Configure a new maker instance
          </p>
        </div>

        {/* Error banner */}
        {error && (
          <div className="mb-6 px-4 py-3 bg-red-900/40 border border-red-700 rounded-lg text-sm text-red-300 flex justify-between items-center">
            <span>{error}</span>
            <button
              onClick={() => setError(null)}
              className="ml-4 text-red-400 hover:text-red-200 font-bold"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Basic Info */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 sm:p-6">
            <h3 className="text-lg font-semibold mb-4">Basic Information</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-2">
                  Maker ID *
                </label>
                <input
                  type="text"
                  name="id"
                  value={formData.id}
                  onChange={handleChange}
                  placeholder="e.g., maker-1"
                  required
                  className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg focus:border-orange-500 focus:outline-none focus:shadow-[0_0_0_3px_rgba(249,115,22,0.15)] transition-shadow duration-200 text-gray-100 placeholder-gray-500 font-mono text-sm"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Unique identifier for this maker. Used in all API calls —
                  cannot be changed later.
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-400 mb-2">
                  Data Directory
                </label>
                <input
                  type="text"
                  name="dataDir"
                  value={formData.dataDir}
                  onChange={handleChange}
                  placeholder="e.g., ~/.coinswap/maker1 (leave blank for default)"
                  className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg focus:border-orange-500 focus:outline-none focus:shadow-[0_0_0_3px_rgba(249,115,22,0.15)] transition-shadow duration-200 text-gray-100 placeholder-gray-500 font-mono text-sm"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Directory where maker data will be stored. Defaults to{" "}
                  <code className="bg-gray-800 px-1 rounded">
                    ~/.coinswap/{"<id>"}
                  </code>
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-400 mb-2">
                  Maker Password
                </label>
                <div className="relative">
                  <input
                    type={showPassword.password ? "text" : "password"}
                    name="password"
                    value={formData.password}
                    onChange={handleChange}
                    placeholder="Optional"
                    className="w-full px-4 py-2.5 pr-10 bg-gray-800 border border-gray-700 rounded-lg focus:border-orange-500 focus:outline-none focus:shadow-[0_0_0_3px_rgba(249,115,22,0.15)] transition-shadow duration-200 text-gray-100 placeholder-gray-500"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setShowPassword((p) => ({ ...p, password: !p.password }))
                    }
                    className="absolute inset-y-0 right-0 px-3 flex items-center text-gray-400 hover:text-gray-200"
                    tabIndex={-1}
                  >
                    {showPassword.password ? (
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
                        />
                      </svg>
                    ) : (
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                        />
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                        />
                      </svg>
                    )}
                  </button>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  Password to protect the maker's wallet
                </p>
              </div>
            </div>
          </div>

          {/* Bitcoin Connection */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 sm:p-6">
            <h3 className="text-lg font-semibold mb-4">Bitcoin Connection</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-2">
                  Bitcoin RPC Endpoint *
                </label>
                <input
                  type="text"
                  name="bitcoinRpc"
                  value={formData.bitcoinRpc}
                  onChange={handleChange}
                  placeholder="127.0.0.1:18443"
                  required
                  className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg focus:border-orange-500 focus:outline-none focus:shadow-[0_0_0_3px_rgba(249,115,22,0.15)] transition-shadow duration-200 text-gray-100 placeholder-gray-500 font-mono text-sm"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Bitcoin Core RPC endpoint (host:port)
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-2">
                    RPC Username *
                  </label>
                  <input
                    type="text"
                    name="bitcoinUser"
                    value={formData.bitcoinUser}
                    onChange={handleChange}
                    placeholder="e.g., user"
                    required
                    className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg focus:border-orange-500 focus:outline-none focus:shadow-[0_0_0_3px_rgba(249,115,22,0.15)] transition-shadow duration-200 text-gray-100 placeholder-gray-500 font-mono text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-2">
                    RPC Password *
                  </label>
                  <div className="relative">
                    <input
                      type={showPassword.bitcoinPassword ? "text" : "password"}
                      name="bitcoinPassword"
                      value={formData.bitcoinPassword}
                      onChange={handleChange}
                      placeholder="e.g., password"
                      required
                      className="w-full px-4 py-2.5 pr-10 bg-gray-800 border border-gray-700 rounded-lg focus:border-orange-500 focus:outline-none focus:shadow-[0_0_0_3px_rgba(249,115,22,0.15)] transition-shadow duration-200 text-gray-100 placeholder-gray-500 font-mono text-sm"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setShowPassword((p) => ({
                          ...p,
                          bitcoinPassword: !p.bitcoinPassword,
                        }))
                      }
                      className="absolute inset-y-0 right-0 px-3 flex items-center text-gray-400 hover:text-gray-200"
                      tabIndex={-1}
                    >
                      {showPassword.bitcoinPassword ? (
                        <svg
                          className="w-4 h-4"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
                          />
                        </svg>
                      ) : (
                        <svg
                          className="w-4 h-4"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                          />
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                          />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-400 mb-2">
                  ZMQ Endpoint *
                </label>
                <input
                  type="text"
                  name="zmq"
                  value={formData.zmq}
                  onChange={handleChange}
                  placeholder="tcp://127.0.0.1:28332"
                  required
                  className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg focus:border-orange-500 focus:outline-none focus:shadow-[0_0_0_3px_rgba(249,115,22,0.15)] transition-shadow duration-200 text-gray-100 placeholder-gray-500 font-mono text-sm"
                />
                <p className="text-xs text-gray-500 mt-1">
                  ZeroMQ endpoint for blockchain notifications
                </p>
              </div>
            </div>
          </div>

          {/* Tor Configuration */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 sm:p-6">
            <h3 className="text-lg font-semibold mb-1">Tor Configuration</h3>
            <p className="text-xs text-gray-500 mb-4">
              Ports must match your Tor instance. Auth password is required if
              your Tor control port uses{" "}
              <code className="bg-gray-800 px-1 rounded">
                HashedControlPassword
              </code>
              .
            </p>
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-2">
                    SOCKS Port
                  </label>
                  <input
                    type="number"
                    name="socksPort"
                    value={formData.socksPort}
                    onChange={handleChange}
                    placeholder="9050"
                    className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg focus:border-orange-500 focus:outline-none focus:shadow-[0_0_0_3px_rgba(249,115,22,0.15)] transition-shadow duration-200 text-gray-100 placeholder-gray-500 font-mono text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-2">
                    Control Port
                  </label>
                  <input
                    type="number"
                    name="controlPort"
                    value={formData.controlPort}
                    onChange={handleChange}
                    placeholder="9051"
                    className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg focus:border-orange-500 focus:outline-none focus:shadow-[0_0_0_3px_rgba(249,115,22,0.15)] transition-shadow duration-200 text-gray-100 placeholder-gray-500 font-mono text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-2">
                  Tor Auth Password
                </label>
                <div className="relative">
                  <input
                    type={showPassword.torAuth ? "text" : "password"}
                    name="torAuth"
                    value={formData.torAuth}
                    onChange={handleChange}
                    placeholder="Leave blank if no auth configured"
                    className="w-full px-4 py-2.5 pr-10 bg-gray-800 border border-gray-700 rounded-lg focus:border-orange-500 focus:outline-none focus:shadow-[0_0_0_3px_rgba(249,115,22,0.15)] transition-shadow duration-200 text-gray-100 placeholder-gray-500"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setShowPassword((p) => ({ ...p, torAuth: !p.torAuth }))
                    }
                    className="absolute inset-y-0 right-0 px-3 flex items-center text-gray-400 hover:text-gray-200"
                    tabIndex={-1}
                  >
                    {showPassword.torAuth ? (
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
                        />
                      </svg>
                    ) : (
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                        />
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                        />
                      </svg>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Network Ports */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 sm:p-6">
            <h3 className="text-lg font-semibold mb-1">Maker Network Ports</h3>
            <p className="text-xs text-gray-500 mb-4">
              Ports this maker listens on. Must be unique across all makers.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-2">
                  Network Port
                </label>
                <input
                  type="number"
                  name="networkPort"
                  value={formData.networkPort}
                  onChange={handleChange}
                  placeholder="6102"
                  className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg focus:border-orange-500 focus:outline-none focus:shadow-[0_0_0_3px_rgba(249,115,22,0.15)] transition-shadow duration-200 text-gray-100 placeholder-gray-500 font-mono text-sm"
                />
                <p className="text-xs text-gray-500 mt-1">
                  For client connections
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-2">
                  RPC Port
                </label>
                <input
                  type="number"
                  name="makerRpcPort"
                  value={formData.makerRpcPort}
                  onChange={handleChange}
                  placeholder="6103"
                  className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg focus:border-orange-500 focus:outline-none focus:shadow-[0_0_0_3px_rgba(249,115,22,0.15)] transition-shadow duration-200 text-gray-100 placeholder-gray-500 font-mono text-sm"
                />
                <p className="text-xs text-gray-500 mt-1">
                  For maker-cli operations
                </p>
              </div>
            </div>
          </div>

          {/* Advanced Options */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 sm:p-6">
            <h3 className="text-lg font-semibold mb-4">Advanced Options</h3>
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                name="taproot"
                checked={formData.taproot}
                onChange={handleChange}
                className="mt-1 w-4 h-4 bg-gray-800 border-gray-700 rounded focus:ring-orange-500 focus:ring-2"
              />
              <div>
                <div className="font-medium text-gray-100">Enable Taproot</div>
                <div className="text-sm text-gray-500">
                  Use Taproot addresses for improved privacy and lower fees
                </div>
              </div>
            </label>
          </div>

          {/* Actions */}
          <div className="flex flex-col sm:flex-row gap-3">
            <button
              type="button"
              onClick={() => window.history.back()}
              className="flex-1 px-6 py-3 border border-gray-700 rounded-lg hover:bg-gray-800 hover:border-orange-500 active:scale-[0.97] transition-all duration-150 font-semibold"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 px-6 py-3 bg-orange-600 text-white rounded-lg hover:bg-orange-700 active:scale-[0.98] transition-all duration-150 font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? "Adding…" : "Add Maker"}
            </button>
          </div>
        </form>

        {/* Help Text */}
        <div className="mt-6 bg-blue-900/20 border border-blue-800/30 rounded-lg p-4">
          <div className="flex gap-3">
            <svg
              className="w-5 h-5 text-blue-400 shrink-0 mt-0.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <div className="text-sm text-blue-200">
              <p className="font-semibold mb-1">Before adding a maker:</p>
              <ul className="list-disc list-inside space-y-1 text-blue-300">
                <li>Ensure Bitcoin Core is running and synced</li>
                <li>The Maker ID must be unique and cannot be changed later</li>
                <li>Both RPC username and password are required</li>
                <li>
                  ZMQ endpoint should match your Bitcoin Core configuration
                </li>
              </ul>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
