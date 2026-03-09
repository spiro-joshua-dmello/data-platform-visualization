import React from "react";
import { MapView } from "./MapView";
import { UploadPanel } from "./panels/UploadPanel";
import { DatasetPanel } from "./panels/DatasetPanel";
import { LayerPanel } from "./panels/LayerPanel";

export default function App() {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "380px 1fr", height: "100vh" }}>
      <aside
        style={{
          borderRight: "1px solid var(--border)",
          background: "var(--panel)",
          padding: 12,
          overflow: "auto",
        }}
      >
        <div style={{ display: "grid", gap: 12 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800 }}>Kepler-lite</div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>
              Local demo: upload GeoJSON / CSV, create layers, style + inspect.
            </div>
          </div>

          <UploadPanel />
          <hr />
          <DatasetPanel />
          <hr />
          <LayerPanel />
        </div>
      </aside>

      <main style={{ position: "relative" }}>
        <MapView />
      </main>
    </div>
  );
}
