import React, { useEffect } from "react";
import { MapView } from "./MapView";
import { FeltUI } from "./FeltUI";
import { useAppStore } from "./store";
import { dbRowToStoreEntries } from "./panels/CatalogPanel";

const API = "http://localhost:8787";

export default function App() {
  useEffect(() => {
    // Read store state directly via getState() to avoid stale closure —
    // the hook variables (datasets, layers) are always [] at mount time.
    fetch(`${API}/datasets`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        if (!data.ok) return;

        const { datasets, layers, addDataset, addLayer, setZoomTarget } = useAppStore.getState();

        const allBounds: [number, number, number, number][] = [];

        for (const row of data.datasets) {
          if (datasets.some((d) => d.id === row.id)) continue;

          const { dataset, layer } = dbRowToStoreEntries(row);
          addDataset(dataset);

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

        // Pan to the union of all layer bounds
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
        // Backend not running — silently ignore, user can upload later
        console.warn("[startup sync] Could not reach backend:", err.message);
      });
  }, []); // run exactly once on mount

  return (
    <div style={{ position: "relative", width: "100vw", height: "100vh", overflow: "hidden" }}>
      <main style={{ position: "absolute", inset: 0 }}>
        <MapView />
      </main>
      <FeltUI />
    </div>
  );
}
