import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import "@/app.css";

import Home from "./routes/home";
import Maker from "./routes/maker";
import MakerDetails from "./routes/makerDetails";
import AddMaker from "./routes/addMaker";
import MakerSetup from "./routes/makersetup";

createRoot(document.getElementById("root")!).render(
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/maker" element={<Maker />} />
        <Route path="/makerDetails/:makerId" element={<MakerDetails />} />
        <Route path="/addMaker" element={<AddMaker />} />
        <Route path="/makers/:makerId/setup" element={<MakerSetup />} />{" "}
      </Routes>
    </BrowserRouter>
);
