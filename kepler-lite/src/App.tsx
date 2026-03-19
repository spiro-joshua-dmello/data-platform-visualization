import React, { useState } from "react";
import { MapView } from "./MapView";
import { UploadPanel } from "./panels/UploadPanel";
import { DatasetPanel } from "./panels/DatasetPanel";
import { LayerPanel } from "./panels/LayerPanel";
import { CatalogPanel } from "./panels/CatalogPanel";
import { EditPanel } from "./panels/EditPanel";
import { useAppStore } from "./store";

type Tab = "layers" | "datasets" | "edit";

export default function App() {
  const { uploadOpen, setUploadOpen, activeDatasetId } = useAppStore();
  const [tab, setTab] = useState<Tab>("layers");

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
          display: "grid",
          gridTemplateRows: "auto auto auto auto 1fr",
          gap: 12,
        }}
      >
        {/* Header */}
        <div>
          <div style={{ fontSize: 16, fontWeight: 800 }}>Kepler-lite</div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
            Upload GeoJSON / CSV, generate vector tiles, style and edit layers.
          </div>
        </div>

        {/* Upload button */}
        <button onClick={() => setUploadOpen(!uploadOpen)}>
          {uploadOpen ? "Hide upload" : "Upload dataset"}
        </button>

        {/* Upload panel */}
        {uploadOpen && (
          <>
            <UploadPanel />
            <hr style={{ margin: 0 }} />
          </>
        )}

        {/* Tab bar */}
        <div style={{
          display: "flex",
          borderBottom: "1px solid var(--border)",
          gap: 0,
        }}>
          {(["layers", "datasets", "edit"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                flex: 1,
                padding: "8px 4px",
                fontSize: 12,
                fontWeight: tab === t ? 700 : 400,
                background: "none",
                border: "none",
                borderBottom: `2px solid ${tab === t ? "#3b82f6" : "transparent"}`,
                color: tab === t ? "#e7eaf0" : "#a5adbb",
                cursor: "pointer",
                textTransform: "capitalize",
                transition: "color 0.15s, border-color 0.15s",
              }}
            >
              {t === "layers"   && "🗂 Layers"}
              {t === "datasets" && "🗃 Datasets"}
              {t === "edit"     && (
                <span style={{ position: "relative" }}>
                  ✏️ Edit
                  {activeDatasetId && (
                    <span style={{
                      position: "absolute", top: -3, right: -6,
                      width: 7, height: 7, borderRadius: "50%",
                      background: "#22c55e",
                      boxShadow: "0 0 4px #22c55e",
                    }} />
                  )}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div style={{ overflow: "auto", minHeight: 0 }}>
          {tab === "layers" && (
            <div style={{ display: "grid", gap: 12 }}>
              <DatasetPanel />
              <hr />
              <LayerPanel />
            </div>
          )}

          {tab === "datasets" && <CatalogPanel />}

          {tab === "edit" && <EditPanel />}
        </div>
      </aside>

      {/* MAP */}
      <main style={{ position: "relative", width: "100%", height: "100%" }}>
        <MapView />
      </main>
    </div>
  );
}
