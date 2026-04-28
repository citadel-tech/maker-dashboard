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
import { auth } from "@/api";

// AuthLayout: checks auth status on mount, shows Outlet if authenticated
function AuthLayout() {
  const [checking, setChecking] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);

  useEffect(() => {
    auth
      .status()
      .then(({ authenticated }) => {
        setAuthenticated(authenticated);
        setChecking(false);
      })
      .catch(() => {
        setAuthenticated(false);
        setChecking(false);
      });
  }, []);

  if (checking) return null;
  if (!authenticated) return <Navigate to="/login" replace />;
  return <Outlet />;
}

// GuestLayout: shows Outlet if unauthenticated, redirects to "/" otherwise.
// Used to keep already-authenticated users out of /login.
function GuestLayout() {
  const [checking, setChecking] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);

  useEffect(() => {
    auth
      .status()
      .then(({ authenticated }) => {
        setAuthenticated(authenticated);
        setChecking(false);
      })
      .catch(() => {
        setAuthenticated(false);
        setChecking(false);
      });
  }, []);

  if (checking) return null;
  if (authenticated) return <Navigate to="/" replace />;
  return <Outlet />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
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
