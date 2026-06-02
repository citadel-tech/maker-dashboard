import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  Routes,
  Route,
  Outlet,
  Navigate,
} from "react-router-dom";
import { StrictMode, useEffect, useState } from "react";
import "@/app.css";

import Home from "./routes/home";
import MakerDetails from "./routes/makerDetails";
import MakerSwapReportPage from "./routes/makerDetails/swapReport";
import AddMaker from "./routes/addMaker";
import MakerSetup from "./routes/makersetup";
import Login from "./routes/login";
import Setup from "./routes/setup";
import { Toast } from "./components/Toast";
import { auth, monitoring } from "@/api";

interface AuthState {
  passwordExists: boolean | null;
  authenticated: boolean;
}

function useAuthStatus(): { checking: boolean; state: AuthState } {
  const [checking, setChecking] = useState(true);
  const [state, setState] = useState<AuthState>({
    passwordExists: null,
    authenticated: false,
  });

  useEffect(() => {
    auth
      .status()
      .then(({ password_exists, authenticated }) => {
        setState({ passwordExists: password_exists, authenticated });
        setChecking(false);
      })
      .catch(() => {
        setState({ passwordExists: null, authenticated: false });
        setChecking(false);
      });
  }, []);

  return { checking, state };
}

function AuthLayout() {
  const { checking, state } = useAuthStatus();

  if (checking || state.passwordExists === null) return null;
  if (!state.passwordExists) return <Navigate to="/setup" replace />;
  if (!state.authenticated) return <Navigate to="/login" replace />;
  return <Outlet />;
}

function GuestLayout() {
  const { checking, state } = useAuthStatus();

  if (checking || state.passwordExists === null) return null;
  if (!state.passwordExists) return <Navigate to="/setup" replace />;
  if (state.authenticated) return <Navigate to="/" replace />;
  return <Outlet />;
}

function SetupLayout() {
  const { checking, state } = useAuthStatus();

  if (checking || state.passwordExists === null) return null;
  if (state.passwordExists) return <Navigate to="/login" replace />;
  return <Outlet />;
}

function TorStartupToast() {
  const [torToast, setTorToast] = useState<string | null>(null);

  useEffect(() => {
    if (
      sessionStorage.getItem("tor-toast-shown") ||
      sessionStorage.getItem("tor-toast-checked")
    ) {
      return;
    }

    auth
      .status()
      .then(({ authenticated }) => {
        if (!authenticated) return null;
        sessionStorage.setItem("tor-toast-checked", "1");
        return monitoring.getTorStatus();
      })
      .then((status) => {
        if (!status) return;
        const { managed, source } = status;
        if (managed) {
          const label = source === "embedded" ? "embedded Tor" : "host binary";
          setTorToast(`Tor started via ${label}`);
          sessionStorage.setItem("tor-toast-shown", "1");
        }
      })
      .catch(() => {});
  }, []);

  if (!torToast) return null;
  return <Toast message={torToast} onDismiss={() => setTorToast(null)} />;
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<SetupLayout />}>
          <Route path="/setup" element={<Setup />} />
        </Route>
        <Route element={<GuestLayout />}>
          <Route path="/login" element={<Login />} />
        </Route>
        <Route element={<AuthLayout />}>
          <Route path="/" element={<Home />} />
          <Route path="/makerDetails/:makerId" element={<MakerDetails />} />
          <Route
            path="/makerDetails/:makerId/swapReports/:swapId"
            element={<MakerSwapReportPage />}
          />
          <Route path="/addMaker" element={<AddMaker />} />
          <Route path="/makers/:makerId/setup" element={<MakerSetup />} />
        </Route>
      </Routes>
      <TorStartupToast />
    </BrowserRouter>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
