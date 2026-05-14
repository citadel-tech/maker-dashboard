import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  Routes,
  Route,
  Outlet,
  Navigate,
} from "react-router-dom";
import { useEffect, useState, StrictMode } from "react";
import "@/app.css";

import Home from "./routes/home";
import MakerDetails from "./routes/makerDetails";
import AddMaker from "./routes/addMaker";
import MakerSetup from "./routes/makersetup";
import Login from "./routes/login";
import Setup from "./routes/setup";
import { auth } from "@/api";

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

// AuthLayout: wraps authenticated routes.
// - no password => /setup
// - password exists + not authed => /login
// - password exists + authed => render
function AuthLayout() {
  const { checking, state } = useAuthStatus();

  if (checking || state.passwordExists === null) return null;
  if (!state.passwordExists) return <Navigate to="/setup" replace />;
  if (!state.authenticated) return <Navigate to="/login" replace />;
  return <Outlet />;
}

// GuestLayout: wraps /login.
// - no password => /setup
// - password exists + authed => /
// - password exists + not authed => render
function GuestLayout() {
  const { checking, state } = useAuthStatus();

  if (checking || state.passwordExists === null) return null;
  if (!state.passwordExists) return <Navigate to="/setup" replace />;
  if (state.authenticated) return <Navigate to="/" replace />;
  return <Outlet />;
}

// SetupLayout: wraps /setup.
// - password exists => /login
// - no password => render
function SetupLayout() {
  const { checking, state } = useAuthStatus();

  if (checking || state.passwordExists === null) return null;
  if (state.passwordExists) return <Navigate to="/login" replace />;
  return <Outlet />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
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
          <Route path="/addMaker" element={<AddMaker />} />
          <Route path="/makers/:makerId/setup" element={<MakerSetup />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
