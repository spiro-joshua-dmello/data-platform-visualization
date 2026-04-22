import React, { useEffect } from "react";
import { MapView } from "./MapView";
import { FeltUI } from "./FeltUI";
import { useAppStore } from "./store";
import { dbRowToStoreEntries } from "./panels/CatalogPanel";
import { ProjectsPanel } from "./panels/ProjectsPanel";

const API = "http://localhost:8787";

const T = { font: "'Inter', -apple-system, system-ui, sans-serif" };

export default function App() {
  const { activeProjectId } = useAppStore();

  useEffect(() => {
    if (!activeProjectId) return;

    const projectId = activeProjectId;

    fetch(`${API}/datasets`, {
      headers: { "X-Project-Id": projectId },
    })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        if (!data.ok) return;

        const {
          datasets, layers,
          addDataset, addLayer, updateLayer, setZoomTarget,
        } = useAppStore.getState();

        const allBounds: [number, number, number, number][] = [];

        for (const row of data.datasets) {
          const { dataset, layer } = dbRowToStoreEntries(row);

          // Always upsert the dataset so bounds stay fresh
          addDataset(dataset);

          // Add layer only if it doesn't exist yet
          if (!layers.some((l) => l.datasetId === row.id)) {
            addLayer(layer);
          }

          if (
            Array.isArray(row.bounds) &&
            row.bounds.length === 4 &&
            row.bounds.every((v: any) => typeof v === "number" && isFinite(v))
          ) {
            allBounds.push(row.bounds);
          }
        }

        // Remove store datasets that no longer exist in the backend
        // (e.g. deleted while on a different project)
        const backendIds = new Set(data.datasets.map((r: any) => r.id));
        for (const ds of datasets) {
          if (!backendIds.has(ds.id)) {
            useAppStore.getState().removeDataset(ds.id);
          }
        }

        // Zoom to union of all layer bounds on load
        if (allBounds.length > 0) {
          const minLng = Math.min(...allBounds.map(b => b[0]));
          const minLat = Math.min(...allBounds.map(b => b[1]));
          const maxLng = Math.max(...allBounds.map(b => b[2]));
          const maxLat = Math.max(...allBounds.map(b => b[3]));
          const longitude = (minLng + maxLng) / 2;
          const latitude  = (minLat + maxLat) / 2;
          const diff = Math.max(Math.abs(maxLng - minLng), Math.abs(maxLat - minLat), 0.001);
          const zoom =
            diff > 60 ? 2 : diff > 30 ? 3 : diff > 15 ? 4 : diff > 8 ? 5 :
            diff > 4 ? 6 : diff > 2 ? 7 : diff > 1 ? 8 : diff > 0.5 ? 9 :
            diff > 0.25 ? 10 : diff > 0.12 ? 11 : diff > 0.06 ? 12 : diff > 0.03 ? 13 : 14;
          setZoomTarget({ longitude, latitude, zoom });
        }
      })
      .catch((err) => {
        console.warn("[startup sync] Could not reach backend:", err.message);
      });
  }, [activeProjectId]); // re-run when project switches

  // ── No active project → full-screen project picker ───────────────────────
  if (!activeProjectId) {
    return (
      <div style={{
        width: "100vw", height: "100vh",
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        background: "linear-gradient(135deg, #f0f4ff 0%, #f9fafb 60%, #f0fdf4 100%)",
        fontFamily: T.font,
      }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{
            width: 56, height: 56, borderRadius: 16, background: "#2563eb",
            display: "flex", alignItems: "center", justifyContent: "center",
            margin: "0 auto 16px", boxShadow: "0 8px 24px rgba(37,99,235,0.3)",
          }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
              <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" fill="white" opacity="0.9"/>
              <circle cx="12" cy="9" r="2.5" fill="#2563eb"/>
            </svg>
          </div>
          <div style={{ fontSize: 26, fontWeight: 800, color: "#111827", letterSpacing: "-0.02em" }}>
            Kepler-lite
          </div>
          <div style={{ fontSize: 14, color: "#6b7280", marginTop: 6, maxWidth: 280, lineHeight: 1.5 }}>
            Create a project to start uploading datasets, styling layers, and building maps.
          </div>
        </div>
        <div style={{ width: 360 }}>
          <ProjectsPanel />
        </div>
      </div>
    );
  }

  // ── Active project → map view ─────────────────────────────────────────────
  return (
    <div style={{ position: "relative", width: "100vw", height: "100vh", overflow: "hidden" }}>
      <main style={{ position: "absolute", inset: 0 }}>
        <MapView />
      </main>
      <FeltUI />
    </div>
  );
}
