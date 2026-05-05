import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { StrictMode, useEffect, useState } from "react";
import "@/app.css";

import Home from "./routes/home";
import MakerDetails from "./routes/makerDetails";
import AddMaker from "./routes/addMaker";
import MakerSetup from "./routes/makersetup";
import { Toast } from "./components/Toast";
import { monitoring } from "./api";

function App() {
  const [torToast, setTorToast] = useState<string | null>(null);

  useEffect(() => {
    if (sessionStorage.getItem("tor-toast-shown")) return;
    monitoring
      .getTorStatus()
      .then(({ managed, source }) => {
        if (managed) {
          const label = source === "docker" ? "Docker" : "host binary";
          setTorToast(`Tor started via ${label}`);
          sessionStorage.setItem("tor-toast-shown", "1");
        }
      })
      .catch(() => {});
  }, []);

  return (
    <>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/makerDetails/:makerId" element={<MakerDetails />} />
          <Route path="/addMaker" element={<AddMaker />} />
          <Route path="/makers/:makerId/setup" element={<MakerSetup />} />
        </Routes>
      </BrowserRouter>
      {torToast && (
        <Toast message={torToast} onDismiss={() => setTorToast(null)} />
      )}
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
