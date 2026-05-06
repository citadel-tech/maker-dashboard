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
  initialized: boolean;
  authenticated: boolean;
}

function useAuthStatus(): { checking: boolean; state: AuthState } {
  const [checking, setChecking] = useState(true);
  const [state, setState] = useState<AuthState>({
    initialized: true,
    authenticated: false,
  });

  useEffect(() => {
    auth
      .status()
      .then(({ initialized, authenticated }) => {
        setState({ initialized, authenticated });
        setChecking(false);
      })
      .catch(() => {
        setState({ initialized: true, authenticated: false });
        setChecking(false);
      });
  }, []);

  return { checking, state };
}

// AuthLayout: wraps authenticated routes.
// - uninitialized => /setup
// - initialized + not authed => /login
// - initialized + authed => render
function AuthLayout() {
  const { checking, state } = useAuthStatus();

  if (checking) return null;
  if (!state.initialized) return <Navigate to="/setup" replace />;
  if (!state.authenticated) return <Navigate to="/login" replace />;
  return <Outlet />;
}

// GuestLayout: wraps /login.
// - uninitialized => /setup
// - initialized + authed => /
// - initialized + not authed => render
function GuestLayout() {
  const { checking, state } = useAuthStatus();

  if (checking) return null;
  if (!state.initialized) return <Navigate to="/setup" replace />;
  if (state.authenticated) return <Navigate to="/" replace />;
  return <Outlet />;
}

// SetupLayout: wraps /setup.
// - initialized => /login
// - uninitialized => render
function SetupLayout() {
  const { checking, state } = useAuthStatus();

  if (checking) return null;
  if (state.initialized) return <Navigate to="/login" replace />;
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
