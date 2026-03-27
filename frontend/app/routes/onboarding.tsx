import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Check,
  Coins,
  Globe,
  LoaderCircle,
  ShieldCheck,
  X,
  Zap,
} from "lucide-react";
import Nav from "../components/Nav";
import {
  ApiError,
  makers,
  onboarding,
  type CreateMakerRequest,
  type StartupCheckKind,
} from "../api.ts";

// ─── Types ────────────────────────────────────────────────────────────────────

type OnboardStep = "welcome" | "prereqs" | "create";
type CheckState = {
  status: "idle" | "loading" | "success" | "error";
  message?: string;
  detail?: string;
};

type OnboardingConnectionConfig = {
  rpc: string;
  rpcUser: string;
  rpcPass: string;
  zmq: string;
  socksPort: string;
  controlPort: string;
};

const DEFAULT_ONBOARDING_CONFIG = {
  rpc: "127.0.0.1:38332",
  rpcUser: "user",
  rpcPass: "password",
  zmq: "tcp://127.0.0.1:28332",
  socksPort: "9050",
  controlPort: "9051",
} as const;

// ─── Step indicator ───────────────────────────────────────────────────────────

function StepIndicator({ current }: { current: OnboardStep }) {
  const steps: { key: OnboardStep; label: string }[] = [
    { key: "welcome", label: "Welcome" },
    { key: "prereqs", label: "Prerequisites" },
    { key: "create", label: "Create Maker" },
  ];
  const idx = steps.findIndex((s) => s.key === current);
  return (
    <div className="flex items-center justify-center gap-0 mb-10">
      {steps.map((s, i) => (
        <div key={s.key} className="flex items-center">
          <div className="flex flex-col items-center">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-colors ${
                i < idx
                  ? "bg-orange-600 text-white"
                  : i === idx
                    ? "bg-orange-500 text-white ring-4 ring-orange-500/30"
                    : "bg-gray-800 text-gray-500"
              }`}
            >
              {i < idx ? <Check className="w-4 h-4" /> : i + 1}
            </div>
            <span
              className={`text-xs mt-1.5 font-medium ${i === idx ? "text-orange-400" : "text-gray-500"}`}
            >
              {s.label}
            </span>
          </div>
          {i < steps.length - 1 && (
            <div
              className={`w-16 sm:w-24 h-px mx-2 mb-5 transition-colors ${i < idx ? "bg-orange-600" : "bg-gray-700"}`}
            />
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Step 1: Welcome ──────────────────────────────────────────────────────────

function WelcomeStep({ onNext }: { onNext: () => void }) {
  return (
    <div className="max-w-2xl mx-auto text-center">
      <div className="mb-6">
        <Zap className="w-14 h-14 text-orange-500" />
      </div>
      <h2 className="text-3xl font-bold mb-3">Welcome to Coinswap Maker</h2>
      <p className="text-gray-400 mb-8 text-lg leading-relaxed">
        A <strong className="text-gray-200">maker</strong> is a node that
        provides liquidity for coinswap transactions, earning fees while helping
        users achieve on-chain privacy.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-10 text-left">
        {[
          {
            icon: <ShieldCheck className="w-6 h-6 text-orange-400" />,
            title: "Privacy-first",
            desc: "Coinswap breaks the transaction graph without requiring a trusted third party.",
          },
          {
            icon: <Coins className="w-6 h-6 text-orange-400" />,
            title: "Earn fees",
            desc: "You earn a base fee + a percentage of each swap amount for providing liquidity.",
          },
          {
            icon: <Globe className="w-6 h-6 text-orange-400" />,
            title: "Tor native",
            desc: "Makers advertise over Tor — it's how takers find you and how all swap communication works.",
          },
        ].map((f) => (
          <div
            key={f.title}
            className="bg-gray-800 rounded-xl p-4 border border-gray-700"
          >
            <div className="mb-2">{f.icon}</div>
            <div className="font-semibold text-gray-100 mb-1">{f.title}</div>
            <div className="text-sm text-gray-400">{f.desc}</div>
          </div>
        ))}
      </div>

      <button
        onClick={onNext}
        className="px-8 py-3 bg-orange-600 hover:bg-orange-700 text-white font-semibold rounded-xl transition-all text-lg"
      >
        Get started →
      </button>
    </div>
  );
}

// ─── Step 2: Prerequisites ────────────────────────────────────────────────────

function PrereqsStep({
  config,
  onConfigChange,
  onNext,
  onBack,
}: {
  config: OnboardingConnectionConfig;
  onConfigChange: (
    key: keyof OnboardingConnectionConfig,
    value: string,
  ) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const [checks, setChecks] = useState<Record<string, CheckState>>({});

  const prereqs = [
    {
      id: "bitcoin" as StartupCheckKind,
      title: "Bitcoin Core is running and fully synced",
      desc: "The maker needs a fully synced Bitcoin node to operate. Testnet, regtest, or signet work for testing.",
      code: "bitcoin-cli getblockchaininfo",
    },
    {
      id: "rpc" as StartupCheckKind,
      title: "Bitcoin Core RPC is enabled",
      desc: "Add rpcuser and rpcpassword to your bitcoin.conf and restart Bitcoin Core.",
      code: "rpcuser=youruser\nrpcpassword=yourpassword\nserver=1",
    },
    {
      id: "rest" as StartupCheckKind,
      title: "Bitcoin Core REST is enabled",
      desc: "The dashboard checks `/rest/chaininfo.json` on your Bitcoin Core port, so `rest=1` should be enabled in bitcoin.conf.",
      code: "rest=1",
    },
    {
      id: "zmq" as StartupCheckKind,
      title: "ZMQ notifications are configured",
      desc: "ZMQ allows the maker to receive real-time block and transaction updates.",
      code: "zmqpubrawblock=tcp://127.0.0.1:28332\nzmqpubrawtx=tcp://127.0.0.1:28332",
    },
    {
      id: "tor" as StartupCheckKind,
      title: "Tor is running",
      desc: "Tor is required — it's how takers discover your maker, how fidelity bonds are tied to your address, and how all swap requests are routed. Without Tor, your maker cannot participate in the network.",
      code: "tor --version",
    },
  ];

  const allChecked = prereqs.every((p) => checks[p.id]?.status === "success");

  async function runCheck(check: StartupCheckKind) {
    setChecks((prev) => ({
      ...prev,
      [check]: { status: "loading", message: "Running startup check..." },
    }));

    try {
      const result = await onboarding.startupCheck({
        check,
        rpc: config.rpc,
        rpc_user: config.rpcUser,
        rpc_password: config.rpcPass,
        zmq: config.zmq,
        socks_port: config.socksPort
          ? parseInt(config.socksPort, 10)
          : undefined,
        control_port: config.controlPort
          ? parseInt(config.controlPort, 10)
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
    } catch (error) {
      setChecks((prev) => ({
        ...prev,
        [check]: {
          status: "error",
          message:
            error instanceof Error ? error.message : "Startup check failed",
        },
      }));
    }
  }

  function updateConfig(key: keyof OnboardingConnectionConfig, value: string) {
    setChecks({});
    onConfigChange(key, value);
  }

  return (
    <div className="max-w-2xl mx-auto">
      <h2 className="text-2xl font-bold mb-2 text-center">Before you begin</h2>
      <p className="text-gray-400 text-center mb-8">
        Click each item to run a live check against your local Bitcoin Core and
        Tor setup.
      </p>

      <div className="mb-8 rounded-xl border border-gray-800 bg-gray-900 p-5">
        <div className="mb-4">
          <h3 className="font-semibold text-gray-100">Checker settings</h3>
          <p className="text-sm text-gray-500 mt-1">
            Default values are filled in for a typical setup, but you can adjust
            them here before running the checks.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className="block text-sm text-gray-400 mb-2">
              RPC Endpoint
            </label>
            <input
              type="text"
              value={config.rpc}
              onChange={(e) => updateConfig("rpc", e.target.value)}
              placeholder="127.0.0.1:18443"
              className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg focus:border-orange-500 focus:outline-none text-gray-100 font-mono text-sm"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-2">
              RPC Username
            </label>
            <input
              type="text"
              value={config.rpcUser}
              onChange={(e) => updateConfig("rpcUser", e.target.value)}
              placeholder="user"
              className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg focus:border-orange-500 focus:outline-none text-gray-100 font-mono text-sm"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-2">
              RPC Password
            </label>
            <input
              type="password"
              value={config.rpcPass}
              onChange={(e) => updateConfig("rpcPass", e.target.value)}
              placeholder="password"
              className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg focus:border-orange-500 focus:outline-none text-gray-100 font-mono text-sm"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-sm text-gray-400 mb-2">
              ZMQ Endpoint
            </label>
            <input
              type="text"
              value={config.zmq}
              onChange={(e) => updateConfig("zmq", e.target.value)}
              placeholder="tcp://127.0.0.1:28332"
              className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg focus:border-orange-500 focus:outline-none text-gray-100 font-mono text-sm"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-2">
              SOCKS Port
            </label>
            <input
              type="number"
              value={config.socksPort}
              onChange={(e) => updateConfig("socksPort", e.target.value)}
              placeholder="9050"
              className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg focus:border-orange-500 focus:outline-none text-gray-100 font-mono text-sm"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-2">
              Control Port
            </label>
            <input
              type="number"
              value={config.controlPort}
              onChange={(e) => updateConfig("controlPort", e.target.value)}
              placeholder="9051"
              className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg focus:border-orange-500 focus:outline-none text-gray-100 font-mono text-sm"
            />
          </div>
        </div>
      </div>

      <div className="space-y-4 mb-8">
        {prereqs.map((p) => {
          const state = checks[p.id] ?? { status: "idle" as const };
          const isLoading = state.status === "loading";
          const isSuccess = state.status === "success";
          const isError = state.status === "error";

          return (
            <button
              key={p.id}
              type="button"
              onClick={() => void runCheck(p.id)}
              disabled={isLoading}
              className={`w-full rounded-xl border p-4 text-left transition-all ${
                isSuccess
                  ? "border-orange-500/60 bg-orange-950/20"
                  : isError
                    ? "border-red-700/70 bg-red-950/20"
                    : "border-gray-700 bg-gray-900 hover:border-gray-600"
              } ${isLoading ? "cursor-wait" : "cursor-pointer"}`}
            >
              <div className="flex items-start gap-4">
                <div
                  className={`mt-0.5 w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 transition-all ${
                    isSuccess
                      ? "border-orange-500 bg-orange-500"
                      : isError
                        ? "border-red-500 bg-red-500/20"
                        : isLoading
                          ? "border-orange-400 text-orange-400"
                          : "border-gray-600"
                  }`}
                >
                  {isLoading ? (
                    <LoaderCircle className="w-3.5 h-3.5 animate-spin" />
                  ) : isSuccess ? (
                    <Check className="w-3.5 h-3.5 text-white" />
                  ) : isError ? (
                    <X className="w-3.5 h-3.5 text-red-400" />
                  ) : null}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
                    <div className="font-semibold text-gray-100">{p.title}</div>
                    <span className="text-xs font-medium text-gray-500">
                      {isLoading
                        ? "Checking..."
                        : isSuccess
                          ? "Passed"
                          : isError
                            ? "Failed"
                            : "Click to test"}
                    </span>
                  </div>
                  <p className="text-sm text-gray-400 mb-2">{p.desc}</p>
                  <div className="bg-black rounded-lg px-3 py-2 font-mono text-xs text-gray-300 whitespace-pre">
                    {p.code}
                  </div>
                  {state.message && (
                    <p
                      className={`mt-3 text-sm ${
                        isSuccess
                          ? "text-orange-300"
                          : isError
                            ? "text-red-300"
                            : "text-gray-400"
                      }`}
                    >
                      {state.message}
                    </p>
                  )}
                  {state.detail && (
                    <p className="mt-1 text-xs text-gray-500 break-words">
                      {state.detail}
                    </p>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <div className="flex gap-3">
        <button
          onClick={onBack}
          className="px-6 py-3 border border-gray-700 rounded-xl hover:bg-gray-800 transition-all font-semibold text-sm"
        >
          ← Back
        </button>
        <button
          onClick={onNext}
          disabled={!allChecked}
          className="flex-1 px-6 py-3 bg-orange-600 hover:bg-orange-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-all"
        >
          {allChecked ? "Continue →" : "Pass all checks to continue"}
        </button>
      </div>
    </div>
  );
}

// ─── Step 3: Create maker ─────────────────────────────────────────────────────

function CreateStep({
  config,
  onConfigChange,
  onBack,
}: {
  config: OnboardingConnectionConfig;
  onConfigChange: (
    key: keyof OnboardingConnectionConfig,
    value: string,
  ) => void;
  onBack: () => void;
}) {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    id: "",

    rpc: config.rpc,
    rpcUser: config.rpcUser,
    rpcPass: config.rpcPass,
    zmq: config.zmq,
    dataDir: "",
    taproot: true,
    password: "",
    torAuth: "",
    socksPort: config.socksPort,
    controlPort: config.controlPort,
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPass, setShowPass] = useState(false);
  const [showRpcPass, setShowRpcPass] = useState(false);
  const [showTorPass, setShowTorPass] = useState(false);

  function set(key: string, val: string | boolean) {
    setForm((prev) => ({ ...prev, [key]: val }));
  }

  function setConnectionField(
    key: keyof OnboardingConnectionConfig,
    value: string,
  ) {
    onConfigChange(key, value);

    const formKeyMap: Record<keyof OnboardingConnectionConfig, string> = {
      rpc: "rpc",
      rpcUser: "rpcUser",
      rpcPass: "rpcPass",
      zmq: "zmq",
      socksPort: "socksPort",
      controlPort: "controlPort",
    };

    set(formKeyMap[key], value);
  }

  async function handleCreate() {
    setError(null);
    setSubmitting(true);
    const body: CreateMakerRequest = {
      id: form.id,
      rpc: form.rpc,
      zmq: form.zmq,
      rpc_user: form.rpcUser,
      rpc_password: form.rpcPass,
      wallet_name: form.id || undefined,
      taproot: form.taproot,
      data_directory: form.dataDir || undefined,
      password: form.password || undefined,
      tor_auth: form.torAuth || undefined,
      socks_port: form.socksPort ? parseInt(form.socksPort) : undefined,
      control_port: form.controlPort ? parseInt(form.controlPort) : undefined,
    };
    try {
      await makers.create(body);
      try {
        await makers.start(form.id);
      } catch (startErr) {
        if (!(startErr instanceof ApiError && startErr.status === 409)) {
          throw startErr;
        }
      }
      navigate(`/makers/${form.id}/setup`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError(`A maker with the ID "${form.id}" already exists.`);
      } else {
        setError(err instanceof Error ? err.message : "Failed to create maker");
      }
      setSubmitting(false);
    }
  }

  const canSubmit =
    form.id && form.rpc && form.rpcUser && form.rpcPass && form.zmq;

  return (
    <div className="max-w-2xl mx-auto">
      <h2 className="text-2xl font-bold mb-2 text-center">Create your maker</h2>
      <p className="text-gray-400 text-center mb-8">
        Configure the connection details for your first maker node.
      </p>

      {error && (
        <div className="mb-6 px-4 py-3 bg-red-900/40 border border-red-700 rounded-lg text-sm text-red-300 flex justify-between">
          <span>{error}</span>
          <button
            onClick={() => setError(null)}
            className="ml-4 text-red-400 font-bold"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <div className="space-y-5">
        {/* Identity */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h3 className="font-semibold mb-4 text-gray-200">Identity</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-sm text-gray-400 mb-2">
                Maker ID <span className="text-orange-400">*</span>
              </label>
              <input
                type="text"
                value={form.id}
                onChange={(e) => set("id", e.target.value)}
                placeholder="e.g. maker1"
                className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg focus:border-orange-500 focus:outline-none text-gray-100 font-mono text-sm"
              />
              <p className="text-xs text-gray-500 mt-1">
                Unique, permanent identifier — cannot be changed later.
              </p>
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-2">
                Data Directory
              </label>
              <input
                type="text"
                value={form.dataDir}
                onChange={(e) => set("dataDir", e.target.value)}
                placeholder="~/.coinswap/maker1"
                className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg focus:border-orange-500 focus:outline-none text-gray-100 font-mono text-sm"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-2">
                Wallet Password
              </label>
              <div className="relative">
                <input
                  type={showPass ? "text" : "password"}
                  value={form.password}
                  onChange={(e) => set("password", e.target.value)}
                  placeholder="Optional"
                  className="w-full px-4 py-2.5 pr-12 bg-gray-800 border border-gray-700 rounded-lg focus:border-orange-500 focus:outline-none text-gray-100"
                />
                <button
                  type="button"
                  onClick={() => setShowPass(!showPass)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-100"
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
                      d={
                        showPass
                          ? "M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
                          : "M15 12a3 3 0 11-6 0 3 3 0 016 0zM2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                      }
                    />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Bitcoin Core */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h3 className="font-semibold mb-4 text-gray-200">Bitcoin Core</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-sm text-gray-400 mb-2">
                RPC Endpoint <span className="text-orange-400">*</span>
              </label>
              <input
                type="text"
                value={form.rpc}
                onChange={(e) => setConnectionField("rpc", e.target.value)}
                placeholder="127.0.0.1:18443"
                className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg focus:border-orange-500 focus:outline-none text-gray-100 font-mono text-sm"
              />
              <p className="text-xs text-gray-500 mt-1">
                8332 mainnet · 18332 testnet · 18443 regtest · 38332 signet
              </p>
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-2">
                RPC Username <span className="text-orange-400">*</span>
              </label>
              <input
                type="text"
                value={form.rpcUser}
                onChange={(e) => setConnectionField("rpcUser", e.target.value)}
                placeholder="user"
                className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg focus:border-orange-500 focus:outline-none text-gray-100 font-mono text-sm"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-2">
                RPC Password <span className="text-orange-400">*</span>
              </label>
              <div className="relative">
                <input
                  type={showRpcPass ? "text" : "password"}
                  value={form.rpcPass}
                  onChange={(e) =>
                    setConnectionField("rpcPass", e.target.value)
                  }
                  placeholder="password"
                  className="w-full px-4 py-2.5 pr-12 bg-gray-800 border border-gray-700 rounded-lg focus:border-orange-500 focus:outline-none text-gray-100 font-mono text-sm"
                />
                <button
                  type="button"
                  onClick={() => setShowRpcPass(!showRpcPass)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-100"
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
                      d={
                        showRpcPass
                          ? "M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
                          : "M15 12a3 3 0 11-6 0 3 3 0 016 0zM2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                      }
                    />
                  </svg>
                </button>
              </div>
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm text-gray-400 mb-2">
                ZMQ Endpoint <span className="text-orange-400">*</span>
              </label>
              <input
                type="text"
                value={form.zmq}
                onChange={(e) => setConnectionField("zmq", e.target.value)}
                placeholder="tcp://127.0.0.1:28332"
                className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg focus:border-orange-500 focus:outline-none text-gray-100 font-mono text-sm"
              />
            </div>
          </div>
        </div>

        {/* Tor */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h3 className="font-semibold mb-1 text-gray-200">Tor</h3>
          <p className="text-xs text-gray-500 mb-4">
            Defaults work if system Tor is running on standard ports. Set an
            auth password if your Tor control port requires one.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-2">
                SOCKS Port
              </label>
              <input
                type="number"
                value={form.socksPort}
                onChange={(e) =>
                  setConnectionField("socksPort", e.target.value)
                }
                placeholder="9050"
                className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg focus:border-orange-500 focus:outline-none text-gray-100 font-mono text-sm"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-2">
                Control Port
              </label>
              <input
                type="number"
                value={form.controlPort}
                onChange={(e) =>
                  setConnectionField("controlPort", e.target.value)
                }
                placeholder="9051"
                className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg focus:border-orange-500 focus:outline-none text-gray-100 font-mono text-sm"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm text-gray-400 mb-2">
                Auth Password
              </label>
              <div className="relative">
                <input
                  type={showTorPass ? "text" : "password"}
                  value={form.torAuth}
                  onChange={(e) => set("torAuth", e.target.value)}
                  placeholder="Leave blank if no auth configured"
                  className="w-full px-4 py-2.5 pr-12 bg-gray-800 border border-gray-700 rounded-lg focus:border-orange-500 focus:outline-none text-gray-100"
                />
                <button
                  type="button"
                  onClick={() => setShowTorPass(!showTorPass)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-100"
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
                      d={
                        showTorPass
                          ? "M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
                          : "M15 12a3 3 0 11-6 0 3 3 0 016 0zM2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                      }
                    />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Taproot */}
        <div
          className="bg-gray-900 border border-gray-800 rounded-xl p-5 flex items-center justify-between cursor-pointer"
          onClick={() => set("taproot", !form.taproot)}
        >
          <div>
            <div className="font-semibold text-gray-100">Enable Taproot</div>
            <div className="text-sm text-gray-500">
              Use Taproot addresses for better privacy and lower fees
            </div>
          </div>
          <div
            className={`relative w-11 h-6 rounded-full transition-colors ml-4 shrink-0 ${form.taproot ? "bg-orange-500" : "bg-gray-600"}`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${form.taproot ? "translate-x-5" : "translate-x-0"}`}
            />
          </div>
        </div>
      </div>

      <div className="flex gap-3 mt-6">
        <button
          onClick={onBack}
          className="px-6 py-3 border border-gray-700 rounded-xl hover:bg-gray-800 transition-all font-semibold text-sm"
        >
          ← Back
        </button>
        <button
          onClick={handleCreate}
          disabled={!canSubmit || submitting}
          className="flex-1 px-6 py-3 bg-orange-600 hover:bg-orange-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-all"
        >
          {submitting ? "Creating…" : "Create maker →"}
        </button>
      </div>
    </div>
  );
}

// ─── Wizard ───────────────────────────────────────────────────────────────────

export default function OnboardingWizard() {
  const [step, setStep] = useState<OnboardStep>("welcome");
  const [config, setConfig] = useState<OnboardingConnectionConfig>(
    DEFAULT_ONBOARDING_CONFIG,
  );

  function updateConfig(key: keyof OnboardingConnectionConfig, value: string) {
    setConfig((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <Nav />
      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-10 sm:py-16">
        <StepIndicator current={step} />
        {step === "welcome" && (
          <WelcomeStep onNext={() => setStep("prereqs")} />
        )}
        {step === "prereqs" && (
          <PrereqsStep
            config={config}
            onConfigChange={updateConfig}
            onNext={() => setStep("create")}
            onBack={() => setStep("welcome")}
          />
        )}
        {step === "create" && (
          <CreateStep
            config={config}
            onConfigChange={updateConfig}
            onBack={() => setStep("prereqs")}
          />
        )}
      </main>
    </div>
  );
}
