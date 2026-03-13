import React from "react";
import { MapView } from "./MapView";
import { UploadPanel } from "./panels/UploadPanel";
import { DatasetPanel } from "./panels/DatasetPanel";
import { LayerPanel } from "./panels/LayerPanel";
import { useAppStore } from "./store";

export default function App() {
  const { uploadOpen, setUploadOpen } = useAppStore();

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "380px 1fr",
        height: "100vh",
        width: "100vw",
        overflow: "hidden",
      }}
    >
      {/* LEFT PANEL */}
      <aside
        style={{
          borderRight: "1px solid var(--border)",
          background: "var(--panel)",
          padding: 12,
          overflow: "auto",
        }}
      >
        <div style={{ display: "grid", gap: 12 }}>
          {/* HEADER */}
          <div>
            <div style={{ fontSize: 16, fontWeight: 800 }}>Kepler-lite</div>

            <div
              style={{
                fontSize: 12,
                color: "var(--muted)",
                marginTop: 4,
              }}
            >
              Upload GeoJSON / CSV, generate vector tiles, style layers.
            </div>
          </div>

          {/* UPLOAD BUTTON */}
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setUploadOpen(!uploadOpen)}>
              {uploadOpen ? "Hide upload" : "Upload dataset"}
            </button>
          </div>

          {/* UPLOAD PANEL */}
          {uploadOpen && (
            <>
              <UploadPanel />
              <hr />
            </>
          )}

          {/* DATASETS */}
          <DatasetPanel />

          <hr />

          {/* LAYERS */}
          <LayerPanel />
        </div>
      </aside>

      {/* MAP */}
      <main
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
        }}
      >
        <MapView />
      </main>
    </div>
  );
}