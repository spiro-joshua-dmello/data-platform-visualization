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

        // Get fresh store state at the moment the fetch resolves, not at mount
        const { datasets, layers, addDataset, addLayer } = useAppStore.getState();

        for (const row of data.datasets) {
          // Skip if already in store from a previous upload this session
          if (datasets.some((d) => d.id === row.id)) continue;

          const { dataset, layer } = dbRowToStoreEntries(row);
          addDataset(dataset);

          if (!layers.some((l) => l.datasetId === row.id)) {
            addLayer(layer);
          }
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
