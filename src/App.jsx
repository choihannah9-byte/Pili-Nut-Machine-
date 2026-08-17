import React, { useState } from "react";
import PiliAssemblyModelRevC from "./PiliAssemblyModelRevC.jsx";
import PiliNipSimulator from "./PiliNipSimulator.jsx";
import PiliAssemblyModelRevB from "./PiliAssemblyModelRevB.jsx";

// Model switcher. Each model owns the full viewport; the bar floats on top.
const MODELS = {
  revc: { label: "Rev C Assembly (current)", C: PiliAssemblyModelRevC },
  nip: { label: "Nip Simulator", C: PiliNipSimulator },
  revb: { label: "Rev B Assembly (superseded)", C: PiliAssemblyModelRevB },
};

export default function App() {
  const [which, setWhich] = useState("revc");
  const Model = MODELS[which].C;
  return (
    <div style={{ height: "100vh", position: "relative" }}>
      {/* key forces a clean remount (each model manages its own three.js scene) */}
      <Model key={which} />
      <div style={{
        position: "fixed", top: 8, left: "50%", transform: "translateX(-50%)",
        zIndex: 50, display: "flex", gap: 6,
        background: "rgba(14,19,25,0.9)", padding: "6px 8px", borderRadius: 8,
        border: "1px solid #2c3844",
        fontFamily: "ui-monospace, Menlo, Consolas, monospace",
      }}>
        {Object.entries(MODELS).map(([k, v]) => (
          <button key={k} onClick={() => setWhich(k)} style={{
            padding: "6px 10px", fontFamily: "inherit", fontSize: 11, cursor: "pointer",
            background: which === k ? "#f2913d" : "transparent",
            color: which === k ? "#141a21" : "#8fa1b3",
            border: `1px solid ${which === k ? "#f2913d" : "#2c3844"}`, borderRadius: 4,
          }}>{v.label}</button>
        ))}
      </div>
    </div>
  );
}
