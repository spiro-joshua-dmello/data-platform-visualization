import React, { useEffect, useState, useCallback } from "react";
import { useAppStore } from "../store";
import type { Dataset, LayerConfig, LayerType, RenderType } from "../types";

const API = "http://localhost:8787";

type DBDataset = {
  id: string;
  name: string;
  kind: string;           // "point" | "line" | "polygon" | "mixed"
  table_name: string;
  created_at: string;
  feature_count: number;
  bounds: [number, number, number, number] | null;
};

const KIND_COLOR: Record<string, string> = {
  point:   "#3b82f6",
  line:    "#f59e0b",
  polygon: "#10b981",
  mixed:   "#8b5cf6",
};

const KIND_ICON: Record<string, string> = {
  point:   "⬤",
  line:    "╌",
  polygon: "⬡",
  mixed:   "◈",
};

function layerTypeFromKind(kind: string): LayerType {
  if (kind === "point") return "circle";
  if (kind === "line")  return "line";
  return "fill";
}

function renderTypeFromKind(kind: string): RenderType {
  if (kind === "point")   return "point";
  if (kind === "line")    return "line";
  if (kind === "polygon") return "polygon";
  return "mixed";
}

/** Reconstruct a Dataset + LayerConfig from a DB row */
function dbRowToStoreEntries(row: DBDataset): { dataset: Dataset; layer: LayerConfig } {
  const dataset: Dataset = {
    id:         row.id,
    name:       row.name,
    type:       "vector-tile",
    datasetId:  row.id,
    renderType: renderTypeFromKind(row.kind),
    bounds:     row.bounds ?? null,
  };

  const layer: LayerConfig = {
    id:        `${row.id}-layer`,
    datasetId: row.id,
    name:      row.name,
    type:      layerTypeFromKind(row.kind),
    visible:   true,
    opacity:   1,
    color:     [0, 128, 255],
  };

  return { dataset, layer };
}

export function CatalogPanel() {
  const { datasets, layers, addDataset, addLayer, removeDataset, removeLayer } = useAppStore();

  const [catalog, setCatalog] = useState<DBDataset[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);

  // ── Fetch catalog from DB ────────────────────────────────────────────────
  const fetchCatalog = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API}/datasets`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { ok: boolean; datasets: DBDataset[] };
      if (!data.ok) throw new Error("API returned ok=false");
      setCatalog(data.datasets);
      return data.datasets;
    } catch (e: any) {
      setError(e.message ?? "Failed to load catalog");
      return [] as DBDataset[];
    } finally {
      setLoading(false);
    }
  }, []);

  // ── On mount: load catalog AND sync Zustand (handles page refresh) ───────
  useEffect(() => {
    fetchCatalog().then((rows) => {
      // For each DB dataset, ensure it exists in Zustand store.
      // This restores state after a page refresh without overwriting
      // any layer styling the user has already applied this session.
      rows.forEach((row) => {
        const alreadyInStore = datasets.some((d) => d.id === row.id);
        if (!alreadyInStore) {
          const { dataset, layer } = dbRowToStoreEntries(row);
          addDataset(dataset);
          // Only add a layer if one doesn't already exist for this dataset
          const layerExists = layers.some((l) => l.datasetId === row.id);
          if (!layerExists) addLayer(layer);
        }
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // run once on mount

  // ── Delete a dataset ─────────────────────────────────────────────────────
  async function handleDelete(row: DBDataset) {
    if (!window.confirm(`Delete "${row.name}" and all its ${row.feature_count.toLocaleString()} features?\n\nThis cannot be undone.`)) return;

    setDeleting(row.id);
    try {
      const res = await fetch(`${API}/datasets/${row.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      // Remove from Zustand
      removeDataset(row.id);
      removeLayer(`${row.id}-layer`);

      // Remove from local catalog state
      setCatalog((prev) => prev.filter((d) => d.id !== row.id));
    } catch (e: any) {
      alert(`Delete failed: ${e.message}`);
    } finally {
      setDeleting(null);
    }
  }

  // ── Add to map (if not already there) ────────────────────────────────────
  function handleAddToMap(row: DBDataset) {
    const { dataset, layer } = dbRowToStoreEntries(row);
    addDataset(dataset);
    const layerExists = layers.some((l) => l.datasetId === row.id);
    if (!layerExists) addLayer(layer);
  }

  const isOnMap = (id: string) => datasets.some((d) => d.id === id);

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: "grid", gap: 12 }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h4 style={{ margin: 0, fontSize: 13, fontWeight: 700 }}>
          Dataset Catalog
          {catalog.length > 0 && (
            <span style={{ marginLeft: 8, color: "#a5adbb", fontWeight: 400 }}>
              ({catalog.length})
            </span>
          )}
        </h4>
        <button
          onClick={() => fetchCatalog()}
          disabled={loading}
          style={{
            fontSize: 12,
            padding: "4px 10px",
            background: "none",
            border: "1px solid #232832",
            borderRadius: 6,
            color: "#a5adbb",
            cursor: loading ? "wait" : "pointer",
          }}
        >
          {loading ? "…" : "↻ Refresh"}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div style={{ fontSize: 12, color: "#f87171", padding: "8px 10px", background: "#1f1315", borderRadius: 6 }}>
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && !error && (
        <div style={{ fontSize: 12, color: "#a5adbb" }}>Loading datasets…</div>
      )}

      {/* Empty state */}
      {!loading && !error && catalog.length === 0 && (
        <div style={{
          fontSize: 12, color: "#a5adbb", padding: "20px 0", textAlign: "center",
          borderRadius: 8, border: "1px dashed #232832",
        }}>
          No datasets in the database yet.
          <br />Upload a GeoJSON or CSV to get started.
        </div>
      )}

      {/* Dataset cards */}
      {catalog.map((row) => {
        const onMap = isOnMap(row.id);
        const isBeingDeleted = deleting === row.id;

        return (
          <div
            key={row.id}
            style={{
              border: `1px solid ${onMap ? "#2a3a52" : "#232832"}`,
              background: onMap ? "#0f1a2e" : "#15181d",
              borderRadius: 10,
              padding: 10,
              display: "grid",
              gap: 8,
              opacity: isBeingDeleted ? 0.5 : 1,
              transition: "opacity 0.2s",
            }}
          >
            {/* Name + kind badge */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{
                  fontWeight: 650,
                  fontSize: 13,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  color: "#e7eaf0",
                }}
                  title={row.name}
                >
                  {row.name}
                </div>
                <div style={{ marginTop: 4, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                  {/* Kind badge */}
                  <span style={{
                    background: KIND_COLOR[row.kind] ?? "#555",
                    color: "#fff",
                    borderRadius: 4,
                    padding: "1px 7px",
                    fontSize: 11,
                    fontWeight: 600,
                  }}>
                    {KIND_ICON[row.kind]} {row.kind}
                  </span>
                  {/* Feature count */}
                  <span style={{ fontSize: 11, color: "#a5adbb" }}>
                    {row.feature_count.toLocaleString()} features
                  </span>
                  {/* On-map indicator */}
                  {onMap && (
                    <span style={{ fontSize: 11, color: "#22c55e" }}>● on map</span>
                  )}
                </div>
              </div>
            </div>

            {/* Date */}
            <div style={{ fontSize: 11, color: "#5a6275" }}>
              {new Date(row.created_at).toLocaleString()}
            </div>

            {/* ID (truncated) */}
            <div style={{ fontSize: 10, color: "#3a4255", fontFamily: "monospace", wordBreak: "break-all" }}>
              {row.id}
            </div>

            {/* Actions */}
            <div style={{ display: "flex", gap: 6 }}>
              {!onMap && (
                <button
                  onClick={() => handleAddToMap(row)}
                  style={{
                    flex: 1,
                    padding: "6px 0",
                    background: "#1e3a5f",
                    border: "1px solid #2a5298",
                    borderRadius: 6,
                    color: "#60a5fa",
                    fontSize: 12,
                    cursor: "pointer",
                    fontWeight: 600,
                  }}
                >
                  + Add to map
                </button>
              )}
              {onMap && (
                <button
                  onClick={() => { removeDataset(row.id); removeLayer(`${row.id}-layer`); }}
                  style={{
                    flex: 1,
                    padding: "6px 0",
                    background: "none",
                    border: "1px solid #232832",
                    borderRadius: 6,
                    color: "#a5adbb",
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                >
                  Remove from map
                </button>
              )}
              <button
                onClick={() => handleDelete(row)}
                disabled={isBeingDeleted}
                style={{
                  padding: "6px 12px",
                  background: "none",
                  border: "1px solid #3f1515",
                  borderRadius: 6,
                  color: "#f87171",
                  fontSize: 12,
                  cursor: isBeingDeleted ? "wait" : "pointer",
                }}
                title="Delete from database"
              >
                {isBeingDeleted ? "…" : "🗑"}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
