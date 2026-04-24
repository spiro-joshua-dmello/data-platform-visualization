import React, { useEffect, useRef, useState, useMemo } from "react";
import DeckGL from "@deck.gl/react";
import { FlyToInterpolator } from "@deck.gl/core";
import Map, { Source, Layer, Marker } from "react-map-gl/maplibre";
import { useAppStore } from "./store";
import { MapPinsLayer, MeasureOverlay, useMapToolHandler } from "./MapOverlay";
import type { FilterRule } from "./store";
const BASEMAP = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";
const MARTIN_BASE    = "http://localhost:3000";
const POINTS_TILES   = `${MARTIN_BASE}/points/{z}/{x}/{y}`;
const LINES_TILES    = `${MARTIN_BASE}/lines/{z}/{x}/{y}`;
const POLYGONS_TILES = `${MARTIN_BASE}/polygons/{z}/{x}/{y}`;
const API = "http://localhost:8787";

function rgbToCss([r, g, b]: [number, number, number]) {
  return `rgb(${r}, ${g}, ${b})`;
}
// ── Types ─────────────────────────────────────────────────────────────────────

type GeoFeature = {
  id: string;
  type: "Feature";
  geometry: any;
  properties: Record<string, any>;
};

type PendingChange =
  | { kind: "add";    feature: GeoFeature; table: string }
  | { kind: "edit";   feature: GeoFeature; table: string }
  | { kind: "delete"; featureId: string;   table: string };

type EditMode = "none" | "select" | "add-point" | "draw-line" | "draw-polygon" | "move-feature";


export const BASEMAPS = {
  "dark": "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
  "light": "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
  "google": {
    version: 8, name: "Google (Raster)",
    sources: { "google-maps-raster": { type: "raster", tiles: [
      "https://mt0.google.com/vt/lyrs=m&x={x}&y={y}&z={z}&scale=2",
      "https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}&scale=2",
      "https://mt2.google.com/vt/lyrs=m&x={x}&y={y}&z={z}&scale=2",
      "https://mt3.google.com/vt/lyrs=m&x={x}&y={y}&z={z}&scale=2",
    ], tileSize: 256 } },                    // ← closes sources value + sources object
    layers: [{ id: "default", type: "raster", source: "google-maps-raster", minzoom: 0, maxzoom: 22 }],
  },                                          // ← closes "google" object
  "google-hybrid": {
    version: 8, name: "Google (Hybrid)",
    sources: { "google-maps-raster": { type: "raster", tiles: [
      "https://mt0.google.com/vt/lyrs=y&hl=en&x={x}&y={y}&z={z}&scale=2",
      "https://mt1.google.com/vt/lyrs=y&hl=en&x={x}&y={y}&z={z}&scale=2",
      "https://mt2.google.com/vt/lyrs=y&hl=en&x={x}&y={y}&z={z}&scale=2",
      "https://mt3.google.com/vt/lyrs=y&hl=en&x={x}&y={y}&z={z}&scale=2",
    ], tileSize: 256 } },
    layers: [{ id: "default", type: "raster", source: "google-maps-raster", minzoom: 0, maxzoom: 22 }],
  },
  "google-no-labels": {
    version: 8, name: "Google (No Labels)",
    sources: { "google-maps-raster": { type: "raster", tiles: [
      "https://mt0.google.com/vt/lyrs=m&hl=en&x={x}&y={y}&z={z}&apistyle=s.t:2|s.e:l|p.v:off",
      "https://mt1.google.com/vt/lyrs=m&hl=en&x={x}&y={y}&z={z}&apistyle=s.t:2|s.e:l|p.v:off",
      "https://mt2.google.com/vt/lyrs=m&hl=en&x={x}&y={y}&z={z}&apistyle=s.t:2|s.e:l|p.v:off",
      "https://mt3.google.com/vt/lyrs=m&hl=en&x={x}&y={y}&z={z}&apistyle=s.t:2|s.e:l|p.v:off",
    ], tileSize: 256 } },
    layers: [{ id: "default", type: "raster", source: "google-maps-raster", minzoom: 0, maxzoom: 22 }],
  },
  "osm": {
    version: 8, name: "OpenStreetMap",
    sources: { "openstreetmap-raster": { type: "raster", tiles: [
      "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    ], tileSize: 256 } },
    layers: [{ id: "default", type: "raster", source: "openstreetmap-raster", minzoom: 0, maxzoom: 22 }],
  },
} as const;          

export type BasemapId = keyof typeof BASEMAPS;

// ── sanitizeProps ─────────────────────────────────────────────────────────────

function sanitizeProps(raw: Record<string, any>): Record<string, string> {
  const cleaned: Record<string, any> = { ...raw };
  delete cleaned._fid;
  delete cleaned.dataset_id;
  delete cleaned._sanitized;
  delete cleaned._pending;
  // strip id only if it looks like a UUID (not a user-defined id field with meaningful data)
  if (typeof cleaned.id === "string" && /^[0-9a-f-]{36}$/.test(cleaned.id)) {
    delete cleaned.id;
  }
  const entries = Object.entries(cleaned);
  if (entries.length === 0) return {};

  // Detect char-indexed object (Martin mangling nested props)
  const isCharIndexed =
    entries.length > 2 && entries.every(([k]) => /^\d+$/.test(k));

  if (isCharIndexed) {
    const rejoined = entries
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([, v]) => v)
      .join("");
    try {
      const parsed = JSON.parse(rejoined);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return sanitizeProps(parsed);
      }
    } catch { return {}; }
  }

  // Single "props" wrapper key
  if (entries.length === 1 && entries[0][0] === "props") {
    const inner = entries[0][1];
    if (typeof inner === "string") {
      try {
        const parsed = JSON.parse(inner);
        if (parsed && typeof parsed === "object") return sanitizeProps(parsed);
      } catch { /* fall through */ }
    }
    if (typeof inner === "object" && inner !== null) return sanitizeProps(inner);
  }

  // Filter out any remaining numeric-only keys (stray char indexes)
  const filtered = entries.filter(([k]) => !/^\d+$/.test(k));
  if (filtered.length === 0) return {};

  return Object.fromEntries(
    filtered.map(([k, v]) => [k, v === null || v === undefined ? "" : String(v)])
  );
}

// ── AttributeModal ────────────────────────────────────────────────────────────

function AttributeModal({
  title, feature, table, isNew, schemaKeys, onClose, onSaved,
}: {
  title: string;
  feature: GeoFeature;
  table: string;
  isNew?: boolean;
  schemaKeys?: string[];
  onClose: () => void;
  onSaved: (updated: GeoFeature) => void;
}) {
  const buildInitial = (): Record<string, string> => {
    if (isNew && schemaKeys && schemaKeys.length > 0) {
      return Object.fromEntries(schemaKeys.map((k) => [k, ""]));
    }
    if (feature.properties._sanitized && typeof feature.properties._sanitized === "object") {
      return { ...(feature.properties._sanitized as Record<string, string>) };
    }
    return sanitizeProps(feature.properties);
  };

  const [props, setProps]   = useState<Record<string, string>>(buildInitial);
  const [newKey, setNewKey] = useState("");
  const [newVal, setNewVal] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState("");

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      if (isNew) {
        // New feature: POST directly to backend, bypass pending bar entirely
        const correctTable = (feature.properties._table as string) ?? table;
        const geomType = feature.geometry?.type;
        const safeTable =
          (geomType === "Polygon"    || geomType === "MultiPolygon")    ? "polygons" :
          (geomType === "LineString" || geomType === "MultiLineString") ? "lines"    :
          (geomType === "Point"      || geomType === "MultiPoint")      ? "points"   :
          correctTable;
        const res = await fetch(`${API}/datasets/${(feature.properties as any)._datasetId ?? ""}/features`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ geometry: feature.geometry, properties: props, table: safeTable }),
        });
        if (!res.ok) throw new Error(await res.text());
      } else {
        const res = await fetch(`${API}/features/${table}/${feature.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ properties: props }),
        });
        if (!res.ok) throw new Error(await res.text());
      }
      onSaved({ ...feature, properties: { ...feature.properties, ...props, _sanitized: props } });
    } catch (e: any) {
      setError(e.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  }

  function addNewKey() {
    if (!newKey.trim()) return;
    setProps((p) => ({ ...p, [newKey.trim()]: newVal }));
    setNewKey(""); setNewVal("");
  }

  const keys = Object.keys(props);
  const hasSchemaKeys = (schemaKeys?.length ?? 0) > 0;

  return (
    <div
      style={{
        position: "fixed", top: 0, right: 0, bottom: 0, width: 340,
        background: "#111316",
        borderLeft: "1px solid #232832",
        boxShadow: "-4px 0 24px rgba(0,0,0,0.5)",
        zIndex: 9999, display: "flex", flexDirection: "column",
        animation: "slideInRight 0.2s ease",
      }}
    >
      <div style={{
        flex: 1, overflow: "auto",
        padding: 20, display: "grid", gap: 14, alignContent: "start",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, color: "#e7eaf0" }}>{title}</div>
            <div style={{ fontSize: 11, color: "#a5adbb", marginTop: 3, fontFamily: "monospace" }}>
              {feature.id.startsWith("pending-")
                ? <span style={{ color: "#22c55e" }}>● New — staged for saving</span>
                : feature.id}
            </div>
          </div>
          <button onClick={onClose} style={{
            background: "#1e2230", border: "1px solid #232832",
            borderRadius: 7, width: 28, height: 28, padding: 0,
            cursor: "pointer", fontSize: 14, color: "#a5adbb",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>✕</button>
        </div>

        {isNew && hasSchemaKeys && (
          <div style={{
            background: "#0a1628", border: "1px solid #1e3a5f",
            borderRadius: 8, padding: "8px 12px", fontSize: 12, color: "#60a5fa",
          }}>
            Fill in values for this new feature. Columns match the existing dataset schema.
          </div>
        )}

        {isNew && !hasSchemaKeys && (
          <div style={{
            background: "#1a1206", border: "1px solid #4a3500",
            borderRadius: 8, padding: "8px 12px", fontSize: 12, color: "#c0a030",
          }}>
            No existing columns found. Use the fields below to add attributes.
          </div>
        )}

        {keys.length > 0 && (
          <div style={{ display: "grid", gap: 10 }}>
            {keys.map((k) => (
              <label key={k} style={{ display: "grid", gap: 5, fontSize: 13 }}>
                <span style={{ color: "#a5adbb", fontWeight: 600, fontSize: 12 }}>{k}</span>
                <input
                  value={props[k]}
                  placeholder={isNew ? `Enter ${k}…` : ""}
                  onChange={(e) => setProps({ ...props, [k]: e.target.value })}
                  style={{
                    padding: "8px 10px", background: "#15181d",
                    border: "1px solid #232832",
                    borderRadius: 7, color: "#e7eaf0", fontSize: 13, outline: "none",
                  }}
                />
              </label>
            ))}
          </div>
        )}

        {keys.length === 0 && !isNew && (
          <div style={{ fontSize: 13, color: "#a5adbb" }}>No editable attributes.</div>
        )}

        <div style={{
          border: "1px dashed #3a4255", borderRadius: 8, padding: 12, display: "grid", gap: 8,
        }}>
          <div style={{ fontSize: 12, color: "#5a6275", fontWeight: 600 }}>
            {isNew ? "Add extra attribute column" : "Add new attribute"}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <input placeholder="Field name" value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addNewKey()}
              style={{
                flex: 1, padding: "6px 10px", background: "#15181d",
                border: "1px solid #232832", borderRadius: 7,
                color: "#e7eaf0", fontSize: 12, outline: "none",
              }}
            />
            <input placeholder="Value" value={newVal}
              onChange={(e) => setNewVal(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addNewKey()}
              style={{
                flex: 2, padding: "6px 10px", background: "#15181d",
                border: "1px solid #232832", borderRadius: 7,
                color: "#e7eaf0", fontSize: 12, outline: "none",
              }}
            />
            <button onClick={addNewKey} style={{
              padding: "6px 12px", background: "#1e3a5f",
              border: "1px solid #2a5298", borderRadius: 7,
              color: "#60a5fa", fontSize: 12, cursor: "pointer",
            }}>Add</button>
          </div>
        </div>

        {error && (
          <div style={{ color: "#f87171", fontSize: 12, padding: "6px 10px", background: "#1f1315", borderRadius: 6 }}>
            {error}
          </div>
        )}
      </div>

      

      {/* Sticky footer */}
      <div style={{
        padding: "12px 20px",
        borderTop: "1px solid #232832",
        display: "flex", gap: 8,
        background: "#111316",
      }}>
        <button onClick={handleSave} disabled={saving} style={{
          flex: 1, padding: "9px 0", background: "#3b82f6", border: "none",
          borderRadius: 8, color: "#fff", fontWeight: 700,
          cursor: saving ? "wait" : "pointer", fontSize: 13,
        }}>
          {saving ? "Saving…" : isNew ? "✓ Save to dataset" : "✓ Save changes"}
        </button>
        <button onClick={onClose} style={{
          padding: "9px 16px", background: "none",
          border: "1px solid #3a4255", borderRadius: 8,
          color: "#a5adbb", cursor: "pointer", fontSize: 13,
        }}>Cancel</button>
      </div>
    </div>
  );
}

// ── PendingBar ────────────────────────────────────────────────────────────────

function PendingBar({ pending, onSaveToLayer, onSaveToDataset, onDiscard, saving }: {
  pending: PendingChange[];
  onSaveToLayer: () => void;
  onSaveToDataset: () => void;
  onDiscard: () => void;
  saving: boolean;
}) {
  if (pending.length === 0) return null;
  const adds    = pending.filter((p) => p.kind === "add").length;
  const edits   = pending.filter((p) => p.kind === "edit").length;
  const deletes = pending.filter((p) => p.kind === "delete").length;
  const parts: string[] = [];
  if (adds)    parts.push(`${adds} new`);
  if (edits)   parts.push(`${edits} edited`);
  if (deletes) parts.push(`${deletes} deleted`);

  return (
    <div style={{
      position: "absolute", bottom: 50, left: "50%", transform: "translateX(-50%)",
      zIndex: 850, background: "#111316", border: "1px solid #f59e0b",
      borderRadius: 12, padding: "10px 16px",
      display: "flex", alignItems: "center", gap: 10,
      boxShadow: "0 8px 32px rgba(0,0,0,0.6)", whiteSpace: "nowrap",
    }}>
      <span style={{ fontSize: 13, color: "#f59e0b", fontWeight: 600 }}>
        ● {parts.join(", ")} unsaved
      </span>
      <button onClick={onSaveToLayer} disabled={saving} style={{
        padding: "6px 14px", background: "#1e3a5f",
        border: "1px solid #2a5298",
        borderRadius: 7, color: "#60a5fa", fontWeight: 600,
        cursor: saving ? "not-allowed" : "pointer", fontSize: 12,
      }}>
        🗺 Save to layer
      </button>
      <button onClick={onSaveToDataset} disabled={saving} style={{
        padding: "6px 14px", background: "#22c55e", border: "none",
        borderRadius: 7, color: "#fff", fontWeight: 700,
        cursor: saving ? "wait" : "pointer", fontSize: 12,
      }}>
        {saving ? "Saving…" : "💾 Save to dataset"}
      </button>
      <button onClick={onDiscard} disabled={saving} style={{
        padding: "6px 10px", background: "none", border: "1px solid #3a4255",
        borderRadius: 7, color: "#a5adbb", cursor: "pointer", fontSize: 12,
      }}>Discard</button>
    </div>
  );
}

// ── ConfirmBar ────────────────────────────────────────────────────────────────

function ConfirmBar({ label, onConfirm, onCancel }: {
  label: string; onConfirm: () => void; onCancel: () => void;
}) {
  return (
    <div style={{
      position: "absolute", bottom: 100, left: "50%", transform: "translateX(-50%)",
      zIndex: 800, background: "#111316", border: "1px solid #3a4255",
      borderRadius: 12, padding: "10px 16px",
      display: "flex", alignItems: "center", gap: 12,
      boxShadow: "0 8px 32px rgba(0,0,0,0.5)", whiteSpace: "nowrap",
    }}>
      <span style={{ fontSize: 13, color: "#e7eaf0" }}>{label}</span>
      <button onClick={onConfirm} style={{
        padding: "6px 14px", background: "#22c55e", border: "none",
        borderRadius: 7, color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: 12,
      }}>✓ Confirm</button>
      <button onClick={onCancel} style={{
        padding: "6px 14px", background: "none", border: "1px solid #3a4255",
        borderRadius: 7, color: "#a5adbb", cursor: "pointer", fontSize: 12,
      }}>Cancel</button>
    </div>
  );
}

// ── EditToolbar ───────────────────────────────────────────────────────────────

function EditToolbar({
  editMode, setEditMode, activeDataset, loadedCount,
  onExitEdit, onLoadFeatures, onMoveMode,
}: {
  editMode: EditMode;
  setEditMode: (m: EditMode) => void;
  activeDataset: any;
  loadedCount: number;
  onExitEdit: () => void;
  onLoadFeatures: () => void;
  onMoveMode: () => void;
}) {
  if (!activeDataset) return null;

  const btn = (active: boolean, danger = false) => ({
    padding: "7px 13px",
    background: active ? "#3b82f6" : "none",
    border: `1px solid ${active ? "#3b82f6" : danger ? "#f87171" : "#3a4255"}`,
    borderRadius: 7,
    color: active ? "#fff" : danger ? "#f87171" : "#e7eaf0",
    cursor: "pointer", fontSize: 12,
    fontWeight: active ? 700 : 400,
    whiteSpace: "nowrap" as const,
    transition: "all 0.12s",
  });

  return (
    <div style={{
      position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)",
      zIndex: 800, background: "#0d1117", border: "1px solid #3a4255",
      borderRadius: 12, padding: "8px 12px",
      display: "flex", alignItems: "center", gap: 8,
      boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
    }}>
      <div style={{ fontSize: 12, color: "#a5adbb", paddingRight: 8, borderRight: "1px solid #3a4255" }}>
        ✏️ <strong style={{ color: "#e7eaf0" }}>{activeDataset.name}</strong>
        {loadedCount > 0 && <span style={{ marginLeft: 6 }}>({loadedCount})</span>}
      </div>
      <button onClick={onLoadFeatures} style={btn(false)}>⟳ Load</button>
      <button onClick={() => setEditMode("select")} style={btn(editMode === "select")}>↖ Select</button>
      <button onClick={onMoveMode} style={btn(editMode === "move-feature")}>✥ Move</button>
      {activeDataset.renderType === "point" && (
        <button onClick={() => setEditMode("add-point")} style={btn(editMode === "add-point")}>+ Point</button>
      )}
      {activeDataset.renderType === "line" && (
        <button onClick={() => setEditMode("draw-line")} style={btn(editMode === "draw-line")}>＋ Line</button>
      )}
      {(activeDataset.renderType === "polygon" || activeDataset.renderType === "mixed") && (
        <button onClick={() => setEditMode("draw-polygon")} style={btn(editMode === "draw-polygon")}>＋ Polygon</button>
      )}
      <button onClick={onExitEdit} style={btn(false, true)}>⏹ Exit</button>
    </div>
  );
}

// Add this helper near the top of MapView.tsx (or alongside rgbToCss)
function hexToRgba(hex: string, opacity: number): string {
  if (hex.startsWith("rgb")) {
    const m = hex.match(/[\d.]+/g);
    if (m) return `rgba(${m[0]},${m[1]},${m[2]},${opacity})`;
  }
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  if (isNaN(r) || isNaN(g) || isNaN(b)) return `rgba(255,255,255,${opacity})`;
  return `rgba(${r},${g},${b},${opacity})`;
}

// ── FeaturePopup ──────────────────────────────────────────────────────────────

function FeaturePopup({
  feature, isEditMode, selectionCount,
  onEditAttrs, onDelete, onClose,
}: {
  feature: GeoFeature;
  isEditMode: boolean;
  selectionCount: number;
  onEditAttrs: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const sanitized = (feature.properties._sanitized as Record<string, string> | undefined)
    ?? sanitizeProps(feature.properties);
  const attrKeys = Object.keys(sanitized).slice(0, 8);

  return (
    <div style={{
      position: "absolute", bottom: 60, right: 16, zIndex: 800,
      background: "#111316", border: "1px solid #232832", borderRadius: 12,
      padding: "12px 16px", display: "grid", gap: 8,
      width: 280, maxHeight: "50vh", overflow: "auto",
      boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#e7eaf0" }}>
          {feature.id.startsWith("pending-") ? "New feature" : "Feature info"}
          {selectionCount > 1 && (
            <span style={{
              marginLeft: 8, background: "#3b82f6", color: "#fff",
              borderRadius: 10, padding: "1px 8px", fontSize: 11,
            }}>
              {selectionCount} selected
            </span>
          )}
        </div>
        <button onClick={onClose} style={{
          background: "none", border: "none", color: "#a5adbb",
          cursor: "pointer", fontSize: 16, padding: "0 4px", lineHeight: 1,
        }}>✕</button>
      </div>

      <div style={{ fontSize: 10, color: "#3a4255", fontFamily: "monospace", wordBreak: "break-all" }}>
        {feature.id.startsWith("pending-") ? "Unsaved — staged for commit" : feature.id}
      </div>

      {attrKeys.length > 0 ? (
        <div style={{ display: "grid", gap: 4 }}>
          {attrKeys.map((k) => (
            <div key={k} style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 8, alignItems: "baseline" }}>
              <span style={{ fontSize: 11, color: "#5a6780", fontWeight: 600, whiteSpace: "nowrap" }}>{k}</span>
              <span style={{
                fontSize: 12, color: "#c9d1e0",
                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
              }}>
                {sanitized[k] === "" ? <em style={{ color: "#3a4255" }}>empty</em> : sanitized[k]}
              </span>
            </div>
          ))}
          {Object.keys(sanitized).length > 8 && (
            <div style={{ fontSize: 11, color: "#3a4255" }}>
              +{Object.keys(sanitized).length - 8} more…
            </div>
          )}
        </div>
      ) : (
        <div style={{ fontSize: 12, color: "#3a4255" }}>No attributes</div>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 4, borderTop: "1px solid #1a1f2a", paddingTop: 8 }}>
        <button onClick={onEditAttrs} style={{
          flex: 1, padding: "6px 0",
          background: isEditMode ? "#3b82f6" : "#1e3a5f",
          border: `1px solid ${isEditMode ? "#3b82f6" : "#2a5298"}`,
          borderRadius: 6, color: isEditMode ? "#fff" : "#60a5fa",
          fontSize: 12, cursor: "pointer", fontWeight: 600,
        }}>
          {isEditMode ? "✏️ Edit attrs" : "👁 View all"}
        </button>
        {isEditMode && (
          <button onClick={onDelete} style={{
            padding: "6px 12px", background: "none",
            border: "1px solid #f87171", borderRadius: 6,
            color: "#f87171", fontSize: 12, cursor: "pointer",
          }}>🗑</button>
        )}
      </div>
    </div>
  );
}

// ── ExitDialog ────────────────────────────────────────────────────────────────

function ExitDialog({ onSaveAndExit, onExitWithout, onCancel, saving }: {
  onSaveAndExit: () => void;
  onExitWithout: () => void;
  onCancel: () => void;
  saving: boolean;
}) {
  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10000,
    }}>
      <div style={{
        background: "#111316", border: "1px solid #232832", borderRadius: 14,
        padding: 24, width: 340, display: "grid", gap: 16,
        boxShadow: "0 24px 60px rgba(0,0,0,0.7)",
      }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15, color: "#e7eaf0" }}>Unsaved changes</div>
          <div style={{ fontSize: 13, color: "#a5adbb", marginTop: 6 }}>
            You have unsaved edits. What would you like to do?
          </div>
        </div>
        <div style={{ display: "grid", gap: 8 }}>
          <button onClick={onSaveAndExit} disabled={saving} style={{
            padding: "10px 0", background: "#22c55e", border: "none",
            borderRadius: 8, color: "#fff", fontWeight: 700,
            cursor: saving ? "wait" : "pointer", fontSize: 13,
          }}>
            {saving ? "Saving…" : "💾 Save & exit"}
          </button>
          <button onClick={onExitWithout} disabled={saving} style={{
            padding: "10px 0", background: "none",
            border: "1px solid #f87171", borderRadius: 8,
            color: "#f87171", fontWeight: 600,
            cursor: saving ? "not-allowed" : "pointer", fontSize: 13,
          }}>
            Exit without saving
          </button>
          <button onClick={onCancel} disabled={saving} style={{
            padding: "10px 0", background: "none",
            border: "1px solid #3a4255", borderRadius: 8,
            color: "#a5adbb", cursor: "pointer", fontSize: 13,
          }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}


function buildMapFilter(datasetId: string, rules: FilterRule[]): any {
  // For vector tiles from Martin, dataset_id is a top-level promoted property
  const dsFilter: any = ["==", ["get", "dataset_id"], datasetId];
  if (!rules || rules.length === 0) return dsFilter;

  const conditions: any[] = ["all", dsFilter];
  for (const rule of rules) {
    if (!rule.val && rule.op !== "is empty") continue;
    const getter = ["get", rule.col];
    if (rule.op === "=")             conditions.push(["==", getter, rule.val]);
    else if (rule.op === "≠")        conditions.push(["!=", getter, rule.val]);
    else if (rule.op === ">")        conditions.push([">",  getter, Number(rule.val)]);
    else if (rule.op === "<")        conditions.push(["<",  getter, Number(rule.val)]);
    else if (rule.op === "≥")        conditions.push([">=", getter, Number(rule.val)]);
    else if (rule.op === "≤")        conditions.push(["<=", getter, Number(rule.val)]);
    else if (rule.op === "contains") conditions.push(["in", rule.val, getter]);
    else if (rule.op === "is empty") conditions.push(["!", ["has", rule.col]]);
  }
  return conditions.length === 2 ? dsFilter : conditions;
}

// ── MapView ───────────────────────────────────────────────────────────────────

export function MapView() {
  const {
    datasets, layers, viewState, setViewState,
    activeDatasetId, setActiveDatasetId,
    zoomTarget, filterRules,
    setMapContextMenu,
    basemap,
  } = useAppStore();
  // ADD this line immediately after the useAppStore destructure:
  const mapStyle = BASEMAPS[(basemap ?? "dark") as keyof typeof BASEMAPS];
  
  // Controlled view state — DeckGL reads this every render
  const [deckViewState, setDeckViewState] = useState<any>({
    longitude: viewState.longitude,
    latitude:  viewState.latitude,
    zoom:      viewState.zoom,
    pitch:     viewState.pitch ?? 0,
    bearing:   viewState.bearing ?? 0,
  });

  // Refs must be inside the component
  const mapRef = useRef<any>(null);
  const lastZoomTargetId = useRef<number>(-1);
  const dragStartRef = useRef<Record<string, { lng: number; lat: number }>>({});
  const editFeaturesRef = useRef<GeoFeature[]>([]);
  const moveDragRef = useRef<{
    feature: GeoFeature;
    startLng: number;
    startLat: number;
    origGeom: any;
  } | null>(null);

  
  // ── Zoom to layer via DeckGL FlyToInterpolator ───────────────────────────
  useEffect(() => {
    if (!zoomTarget) return;
    if (zoomTarget.id === lastZoomTargetId.current) return;
    lastZoomTargetId.current = zoomTarget.id;

    const { longitude, latitude, zoom } = zoomTarget;

    if (
      !Number.isFinite(latitude)  || !Number.isFinite(longitude) || !Number.isFinite(zoom) ||
      latitude < -90 || latitude > 90 ||
      longitude < -180 || longitude > 180
    ) {
      console.warn("Skipping invalid zoomTarget:", zoomTarget);
      return;
    }

    setDeckViewState((prev: any) => ({
      ...prev,
      longitude,
      latitude,
      zoom,
      pitch: 0,
      bearing: 0,
      transitionDuration: 1200,
      transitionInterpolator: new FlyToInterpolator({ speed: 1.5 }),
    }));
  }, [zoomTarget]);

  const [editFeatures, setEditFeatures]       = useState<GeoFeature[]>([]);
  const [localEditMode, setLocalEditMode]     = useState<EditMode>("none");
  useEffect(() => { editFeaturesRef.current = editFeatures; }, [editFeatures]);
  const [selectedFeature, setSelectedFeature] = useState<GeoFeature | null>(null);
  const [selectionCount, setSelectionCount]   = useState(0);
  const [showAttrModal, setShowAttrModal]     = useState(false);
  const [attrModalIsNew, setAttrModalIsNew]   = useState(false);
  const [drawVertices, setDrawVertices]       = useState<[number, number][]>([]);
  const [pendingChanges, setPendingChanges]   = useState<PendingChange[]>([]);
  const [savingAll, setSavingAll]             = useState(false);
  const [tileKey, setTileKey]                 = useState(0);
  const [serverSchema, setServerSchema]       = useState<string[]>([]);
  const [showExitDialog, setShowExitDialog]   = useState(false);
  // ── Derived data — must be before useEffects ──────────────────────────────
  const vectorDatasets = datasets.filter((d) => d.type === "vector-tile");
  const activeDataset  = datasets.find((d) => d.id === activeDatasetId) ?? null;
  const activeTable    =
    activeDataset?.renderType === "point" ? "points" :
    activeDataset?.renderType === "line"  ? "lines"  : "polygons";

  
  // ── Move-feature mouse drag (raw DOM) ────────────────────────────────────
  // ── Move-feature mouse drag ───────────────────────────────────────────────
  useEffect(() => {
    console.log("🟣 move useEffect ran, mode=", localEditMode);
    if (localEditMode !== "move-feature") return;
    console.log("🔵 attaching move handlers");

    function onDown(e: PointerEvent) {
      if (e.button !== 0) return;
      console.log("🔴 onDown fired");
      const map = mapRef.current?.getMap?.();
      if (!map) return;
      const canvas = map.getCanvas();
      const rect = canvas.getBoundingClientRect();
      const ll = map.unproject([e.clientX - rect.left, e.clientY - rect.top]);
      const lng = ll.lng, lat = ll.lat;

      const features = editFeaturesRef.current;
      console.log("🔴 features count", features.length);
      const pt = map.project([lng, lat]);
      let best: GeoFeature | null = null;
      let bestDist = 80;
      for (const f of features) {
        if (!f.geometry) continue;
        let coords: [number, number][] = [];
        if (f.geometry.type === "Point") coords = [f.geometry.coordinates];
        else if (f.geometry.type === "Polygon") coords = f.geometry.coordinates[0];
        else if (f.geometry.type === "LineString") coords = f.geometry.coordinates;
        if (!coords.length) continue;
        const cLng = coords.reduce((s, c) => s + c[0], 0) / coords.length;
        const cLat = coords.reduce((s, c) => s + c[1], 0) / coords.length;
        const cp = map.project([cLng, cLat]);
        const d = Math.hypot(cp.x - pt.x, cp.y - pt.y);
        if (d < bestDist) { bestDist = d; best = f; }
      }
      console.log("🔴 nearest", best?.id ?? "NONE", "dist", bestDist);
      if (!best) return;

      moveDragRef.current = {
        feature: best,
        startLng: lng,
        startLat: lat,
        origGeom: JSON.parse(JSON.stringify(best.geometry)),
      };
      setSelectedFeature(best);
    }

    function onMove(e: PointerEvent) {
      const drag = moveDragRef.current;
      if (!drag) return;
      const map = mapRef.current?.getMap?.();
      if (!map) return;
      const canvas = map.getCanvas();
      const rect = canvas.getBoundingClientRect();
      const ll = map.unproject([e.clientX - rect.left, e.clientY - rect.top]);
      const dLng = ll.lng - drag.startLng;
      const dLat = ll.lat - drag.startLat;
      const g = JSON.parse(JSON.stringify(drag.origGeom));
      const sc = (c: [number,number][]): [number,number][] => c.map(([x,y]) => [x+dLng, y+dLat]);
      if (g.type === "Point") g.coordinates = [g.coordinates[0]+dLng, g.coordinates[1]+dLat];
      else if (g.type === "Polygon") g.coordinates = g.coordinates.map(sc);
      else if (g.type === "LineString") g.coordinates = sc(g.coordinates);
      const updated = { ...drag.feature, geometry: g };
      setEditFeatures(fs => fs.map(f => f.id === drag.feature.id ? updated : f));
      setSelectedFeature(updated);
    }

    function onUp(e: PointerEvent) {
      const drag = moveDragRef.current;
      if (!drag) return;
      const map = mapRef.current?.getMap?.();
      if (!map) return;
      const canvas = map.getCanvas();
      const rect = canvas.getBoundingClientRect();
      const ll = map.unproject([e.clientX - rect.left, e.clientY - rect.top]);
      const dLng = ll.lng - drag.startLng;
      const dLat = ll.lat - drag.startLat;
      const g = JSON.parse(JSON.stringify(drag.origGeom));
      const sc = (c: [number,number][]): [number,number][] => c.map(([x,y]) => [x+dLng, y+dLat]);
      if (g.type === "Point") g.coordinates = [g.coordinates[0]+dLng, g.coordinates[1]+dLat];
      else if (g.type === "Polygon") g.coordinates = g.coordinates.map(sc);
      else if (g.type === "LineString") g.coordinates = sc(g.coordinates);
      const updated = { ...drag.feature, geometry: g };
      const table = g.type === "Polygon" ? "polygons" : g.type === "LineString" ? "lines" : "points";
      setEditFeatures(fs => fs.map(f => f.id === drag.feature.id ? updated : f));
      setSelectedFeature(updated);
      stageChange({ kind: drag.feature.id.startsWith("pending-") ? "add" : "edit", feature: updated, table });
      moveDragRef.current = null;
    }

    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("pointermove", onMove, true);
    document.addEventListener("pointerup",   onUp,   true);

    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("pointermove", onMove, true);
      document.removeEventListener("pointerup",   onUp,   true);
      moveDragRef.current = null;
    };
  }, [localEditMode]);

  // GeoJSON for all datasets — bypasses Martin tiling entirely
  const [polygonGeoJSON, setPolygonGeoJSON] = useState<Record<string, any>>({});
  useEffect(() => {
    vectorDatasets.forEach(async (ds) => {
      const table =
        ds.renderType === "point"   ? "points"   :
        ds.renderType === "line"    ? "lines"     : "polygons";
      try {
        const res = await fetch(`${API}/datasets/${ds.id}/features?table=${table}`);
        const fc  = await res.json();
        setPolygonGeoJSON((prev) => ({ ...prev, [ds.id]: fc }));
      } catch (e) {
        console.warn("Failed to fetch GeoJSON for", ds.id, e);
      }
    });
  }, [tileKey, datasets]);


  useEffect(() => {
    if (activeDatasetId === null) {
      setLocalEditMode("none");
      setEditFeatures([]);
      setSelectedFeature(null);
      setDrawVertices([]);
      setPendingChanges([]);
      setServerSchema([]);
    }
  }, [activeDatasetId]);

  useEffect(() => {
    if (!activeDatasetId) { setServerSchema([]); return; }

    const activeDataset = datasets.find((d) => d.id === activeDatasetId);
    if (!activeDataset) return;

    const table =
      activeDataset.renderType === "point" ? "points" :
      activeDataset.renderType === "line"  ? "lines"  : "polygons";

    fetch(`${API}/datasets/${activeDatasetId}/features?table=${table}`)
      .then((r) => r.json())
      .then((fc) => {
        const features = fc.features ?? [];
        if (features.length === 0) { setServerSchema([]); return; }
        const seen = new Set<string>();
        const keys: string[] = [];
        for (const f of features.slice(0, 5)) {
          // f.properties from the API has props nested under the actual keys
          // Use sanitizeProps which handles char-indexed unwrapping
          const raw = f.properties ?? {};
          // strip internal keys before schema detection
          const cleaned: Record<string, any> = { ...raw };
          delete cleaned._fid;
          delete cleaned.dataset_id;
          const s = sanitizeProps(cleaned);
          for (const k of Object.keys(s)) {
            if (!seen.has(k)) { seen.add(k); keys.push(k); }
          }
        }
        setServerSchema(keys);
      })
      .catch(() => setServerSchema([]));
  }, [activeDatasetId, datasets]);


  const localSchema: string[] = useMemo(() => {
    const seen = new Set<string>();
    const keys: string[] = [];
    for (const f of editFeatures) {
      if (f.id.startsWith("pending-")) continue;
      const s = (f.properties._sanitized as Record<string, string> | undefined) ?? {};
      for (const k of Object.keys(s)) {
        if (!seen.has(k)) { seen.add(k); keys.push(k); }
      }
      if (keys.length >= 50) break;
    }
    return keys;
  }, [editFeatures]);

  const activeSchema = localSchema.length > 0 ? localSchema : serverSchema;

  // ── DeckGL onClick ────────────────────────────────────────────────────────
  const handleDeckClick = (info: any, _event: any) => {
    if (showAttrModal) return;

    const pixelX: number = info.x;
    const pixelY: number = info.y;

    if (localEditMode === "add-point" && activeDatasetId) {
      if (!info.coordinate) return;
      const [lng, lat] = info.coordinate as [number, number];
      const tmpId = "pending-" + Date.now();
      const tmpFeat: GeoFeature = {
        id: tmpId, type: "Feature",
        geometry:   { type: "Point", coordinates: [lng, lat] },
        properties: { _pending: true, _sanitized: {} },
      };
      setEditFeatures((fs) => [...fs, tmpFeat]);
      stageChange({ kind: "add", feature: tmpFeat, table: "points" });
      setSelectedFeature(tmpFeat);
      setAttrModalIsNew(true);
      setShowAttrModal(true);
      return;
    }

    if ((localEditMode === "draw-line" || localEditMode === "draw-polygon") && activeDatasetId) {
      if (!info.coordinate) return;
      const [lng, lat] = info.coordinate as [number, number];
      setDrawVertices((v) => [...v, [lng, lat]]);
      return;
    }

    const map = mapRef.current?.getMap?.();
    if (!map) return;

    const RADIUS = 14;
    const bbox: [[number, number], [number, number]] = [
      [pixelX - RADIUS, pixelY - RADIUS],
      [pixelX + RADIUS, pixelY + RADIUS],
    ];

    const queryLayerIds: string[] = layers.flatMap((l) => {
      if (!l.visible) return [];
      if (l.type === "fill") return [`${l.id}-fill`, `${l.id}-outline`];
      return [l.id];
    });

    let hits: any[] = [];
    try {
      hits = map.queryRenderedFeatures(
        bbox,
        queryLayerIds.length > 0 ? { layers: queryLayerIds } : {}
      ) ?? [];
    } catch (err) {
      console.warn("queryRenderedFeatures error:", err);
    }

    if (hits.length === 0) {
      setSelectedFeature(null);
      setSelectionCount(0);
      return;
    }

    const count = hits.length;
    const hit   = hits[0];
    const fid   = String(hit.id ?? hit.properties?.id ?? hit.properties?._fid ?? "");

    const inEdits = editFeatures.find((f) => f.id === fid);
    if (inEdits) {
      setSelectedFeature(inEdits);
      setSelectionCount(count);
      setAttrModalIsNew(false);
      return;
    }

    const tileProps = { ...(hit.properties ?? {}) };
    const tempId = fid || `hit-${Date.now()}`;

    // Set immediately with tile props + geometry from the tile hit
    setSelectedFeature({
      id:         tempId,
      type:       "Feature",
      geometry:   hit.geometry ?? null,
      properties: { ...tileProps, _sanitized: sanitizeProps(tileProps) },
    });
    setSelectionCount(count);
    setAttrModalIsNew(false);

    // Then fetch full properties from API in the background
    if (fid && activeDatasetId) {
      fetch(`${API}/features/${activeTable}/${fid}`)
        .then((r) => r.ok ? r.json() : null)
        .then((data) => {
          if (!data) return;
          const fullProps = data.properties ?? data;
          const sanitized = sanitizeProps(fullProps);
          setSelectedFeature((prev) => {
            if (!prev || prev.id !== tempId) return prev;
            return {
              ...prev,
              properties: { ...fullProps, _sanitized: sanitized },
            };
          });
        })
        .catch(() => { /* silently keep tile props */ });
    }
  };

  // ── Load features ─────────────────────────────────────────────────────────
  async function loadFeatures(dsId: string, table: string) {
    try {
      const res  = await fetch(`${API}/datasets/${dsId}/features?table=${table}`);
      const fc   = await res.json();
      const features: GeoFeature[] = (fc.features ?? []).map((f: any) => ({
        ...f,
        id: String(f.properties?._fid ?? f.id ?? Math.random()),
        properties: { ...f.properties, _sanitized: sanitizeProps(f.properties) },
      }));
      setEditFeatures(features);
      // Only switch to select if we're in "none" — preserve move-feature etc.
      setLocalEditMode((m) => m === "none" ? "select" : m);
    } catch (e) { console.error("Failed to load features", e); }
  }

  // ── Exit edit ─────────────────────────────────────────────────────────────
  function handleExitEdit() {
    if (pendingChanges.length > 0) {
      setShowExitDialog(true);
      return;
    }
    doExit();
  }

  function doExit() {
    setShowExitDialog(false);
    setLocalEditMode("none");
    setEditFeatures([]);
    setSelectedFeature(null);
    setDrawVertices([]);
    setPendingChanges([]);
    setActiveDatasetId(null);
    setTileKey((k) => k + 1);
  }

  async function handleSaveAndExit() {
    await saveAllPending();
    doExit();
  }

  // ── Stage change ─────────────────────────────────────────────────────────
  function stageChange(change: PendingChange) {
    setPendingChanges((prev) => {
      const next = [...prev];
      if (change.kind === "add") {
        const idx = next.findIndex((c) => c.kind === "add" && (c as any).feature?.id === change.feature.id);
        if (idx >= 0) next[idx] = change; else next.push(change);
      } else if (change.kind === "edit") {
        const addIdx = next.findIndex((c) => c.kind === "add" && (c as any).feature?.id === change.feature.id);
        if (addIdx >= 0) {
          (next[addIdx] as any).feature = change.feature;
        } else {
          const editIdx = next.findIndex((c) => c.kind === "edit" && (c as any).feature?.id === change.feature.id);
          if (editIdx >= 0) next[editIdx] = change; else next.push(change);
        }
      } else {
        const filtered = next.filter((c) =>
          !(("feature" in c) && (c as any).feature?.id === (change as any).featureId)
        );
        filtered.push(change);
        return filtered;
      }
      return next;
    });
  }

  // ── Save all ─────────────────────────────────────────────────────────────

  // Extract the user-entered properties correctly:
  // attributes are stored in _sanitized after the modal saves them
  function propsForSave(feature: GeoFeature): Record<string, string> {
    const sanitized = feature.properties._sanitized;
    if (sanitized && typeof sanitized === "object" && !Array.isArray(sanitized)) {
      return sanitized as Record<string, string>;
    }
    return sanitizeProps(feature.properties);
  }

  // "Save to dataset" — persists all pending changes to the DB, refreshes tiles
  async function saveAllPending() {
    if (pendingChanges.length === 0) return;
    setSavingAll(true);
    let failed = 0;
    for (const change of pendingChanges) {
      try {
        if (change.kind === "add") {
          // Derive table from geometry type as a safety net in case the staged table is wrong
          const geomType = change.feature.geometry?.type;
          const safeTable =
            geomType === "Polygon"    || geomType === "MultiPolygon"    ? "polygons" :
            geomType === "LineString" || geomType === "MultiLineString" ? "lines"    :
            geomType === "Point"      || geomType === "MultiPoint"      ? "points"   :
            change.table;
          const res = await fetch(`${API}/datasets/${activeDatasetId}/features`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              geometry:   change.feature.geometry,
              properties: propsForSave(change.feature),
              table:      safeTable,
            }),
          });
          if (!res.ok) throw new Error(await res.text());
        } else if (change.kind === "edit") {
          const res = await fetch(`${API}/features/${change.table}/${change.feature.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              geometry:   change.feature.geometry,
              properties: propsForSave(change.feature),
            }),
          });
          if (!res.ok) throw new Error(await res.text());
        } else if (change.kind === "delete") {
          const res = await fetch(`${API}/features/${change.table}/${change.featureId}`, { method: "DELETE" });
          if (!res.ok) throw new Error(await res.text());
        }
      } catch (e) { console.error("Save failed:", change, e); failed++; }
    }
    setSavingAll(false);
    setPendingChanges([]);
    setTileKey((k) => k + 1);
    // Reload features from DB so pending- ids are replaced with real DB ids
    if (activeDatasetId) await loadFeatures(activeDatasetId, activeTable);
    if (failed > 0) alert(`${failed} change(s) failed to save.`);
  }

  // "Save to layer" — only refreshes the tile layer visually, does NOT persist to DB
  function saveToLayerOnly() {
    // Pending features render as markers via editFeatures — just ensure select mode so they're visible
    setLocalEditMode((m) => m === "none" ? "select" : m);
  }

  function discardPending() {
    setPendingChanges([]);
    if (activeDatasetId) loadFeatures(activeDatasetId, activeTable);
  }

  function confirmDrawGeometry() {
    if (!activeDatasetId || drawVertices.length < 2) return;
    const isLine   = localEditMode === "draw-line";
    const geometry = isLine
      ? { type: "LineString", coordinates: drawVertices }
      : { type: "Polygon",   coordinates: [[...drawVertices, drawVertices[0]]] };
    const table = isLine ? "lines" : "polygons";
    const tmpId = "pending-" + Date.now();
    const newFeat: GeoFeature = {
      id: tmpId, type: "Feature", geometry,
      properties: { _pending: true, _sanitized: {}, _table: table, _datasetId: activeDatasetId },
    };
    setEditFeatures((fs) => [...fs, newFeat]);
    setDrawVertices([]);
    setLocalEditMode("select");
    setSelectedFeature(newFeat);
    setAttrModalIsNew(true);
    setShowAttrModal(true);
  }

  function handleAttrSaved(updated: GeoFeature) {
    if (attrModalIsNew) {
      // Feature was already saved directly to DB inside AttributeModal.handleSave
      // Just clean up: remove from editFeatures, refresh the GeoJSON source
      setEditFeatures((fs) => fs.filter((f) => f.id !== updated.id));
      setSelectedFeature(null);
      setShowAttrModal(false);
      setLocalEditMode("select");
      setTileKey((k) => k + 1);
    } else {
      // Existing feature edit — stage the change as before
      setEditFeatures((fs) => {
        const existing = fs.find((f) => f.id === updated.id);
        const merged = { ...updated, geometry: updated.geometry ?? existing?.geometry ?? null };
        stageChange({ kind: "edit", feature: merged, table: activeTable });
        return fs.map((f) => f.id === merged.id ? merged : f);
      });
      setSelectedFeature(updated);
      setShowAttrModal(false);
    }
  }

  async function handleDelete(feature: GeoFeature) {
    if (!window.confirm("Delete this feature?")) return;

    // Remove from local edit features immediately
    setEditFeatures((fs) => fs.filter((f) => f.id !== feature.id));
    setSelectedFeature(null);

    if (feature.id.startsWith("pending-")) {
      // Never saved — just remove from pending changes
      setPendingChanges((p) =>
        p.filter((c) => !(("feature" in c) && (c as any).feature?.id === feature.id))
      );
      return;
    }

    // Derive the correct table from the feature's geometry type if available,
    // otherwise fall back to activeTable
    const geomType = feature.geometry?.type;
    const table =
      (geomType === "Polygon"    || geomType === "MultiPolygon")    ? "polygons" :
      (geomType === "LineString" || geomType === "MultiLineString") ? "lines"    :
      (geomType === "Point"      || geomType === "MultiPoint")      ? "points"   :
      activeTable;

    // Use _fid if available (tile properties sometimes expose it as _fid)
    const fid = feature.properties?._fid ?? feature.id;

    try {
      const res = await fetch(`${API}/features/${table}/${fid}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());
      // Refresh GeoJSON source
      setTileKey((k) => k + 1);
    } catch (e) {
      console.error("Delete failed:", e);
      alert("Failed to delete feature.");
    }
  }

  function handlePointDragEnd(feature: GeoFeature, e: { lngLat: { lng: number; lat: number } }) {
    const updated = { ...feature, geometry: { type: "Point", coordinates: [e.lngLat.lng, e.lngLat.lat] } };
    setEditFeatures((fs) => fs.map((f) => f.id === feature.id ? updated : f));
    stageChange({ kind: feature.id.startsWith("pending-") ? "add" : "edit", feature: updated, table: "points" });
  }

  function handleVertexDragEnd(feature: GeoFeature, vi: number, ri: number, e: { lngLat: { lng: number; lat: number } }) {
    const table   = feature.geometry.type === "LineString" ? "lines" : "polygons";
    const newGeom = JSON.parse(JSON.stringify(feature.geometry));
    if (newGeom.type === "LineString") {
      newGeom.coordinates[vi] = [e.lngLat.lng, e.lngLat.lat];
    } else {
      newGeom.coordinates[ri][vi] = [e.lngLat.lng, e.lngLat.lat];
      if (vi === 0) newGeom.coordinates[ri][newGeom.coordinates[ri].length - 1] = [e.lngLat.lng, e.lngLat.lat];
    }
    const updated = { ...feature, geometry: newGeom };
    setEditFeatures((fs) => fs.map((f) => f.id === feature.id ? updated : f));
    stageChange({ kind: feature.id.startsWith("pending-") ? "add" : "edit", feature: updated, table });
  }

  const drawPreviewGeoJSON = useMemo(() => {
    if (drawVertices.length === 0) return null;
    const features: any[] = [];
    if (drawVertices.length >= 2) {
      features.push({
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: localEditMode === "draw-polygon"
            ? [...drawVertices, drawVertices[0]] : drawVertices,
        },
        properties: {},
      });
    }
    drawVertices.forEach((c) =>
      features.push({ type: "Feature", geometry: { type: "Point", coordinates: c }, properties: {} })
    );
    return { type: "FeatureCollection", features };
  }, [drawVertices, localEditMode]);

  const isDrawing       = localEditMode === "draw-line" || localEditMode === "draw-polygon";
  const showConfirmDraw = isDrawing && drawVertices.length >= 2;
  const { handleMapClick, mousePos, setMousePos, cursorStyle  } = useMapToolHandler();
  const { measurePoints, measureMode } = useAppStore();
  
  return (
    <div                                          
      style={{ position: "absolute", inset: 0 }}
      onContextMenu={(e) => {
        e.preventDefault();
        const map = mapRef.current?.getMap?.();
        if (!map) return;
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const lngLat = map.unproject([e.clientX - rect.left, e.clientY - rect.top]);
        setMapContextMenu({ x: e.clientX, y: e.clientY, lat: lngLat.lat, lng: lngLat.lng });
      }}
    >
      {activeDatasetId !== null && activeDataset !== null && (
        <EditToolbar
          editMode={localEditMode}
          setEditMode={(m) => { setLocalEditMode(m); setDrawVertices([]); }}
          activeDataset={activeDataset}
          loadedCount={editFeatures.length}
          onExitEdit={handleExitEdit}
          onLoadFeatures={() => activeDatasetId && loadFeatures(activeDatasetId, activeTable)}
          onMoveMode={async () => {
            if (editFeatures.length === 0 && activeDatasetId) {
              const res = await fetch(`${API}/datasets/${activeDatasetId}/features?table=${activeTable}`);
              const fc = await res.json();
              const features: GeoFeature[] = (fc.features ?? []).map((f: any) => ({
                ...f,
                id: String(f.properties?._fid ?? f.id ?? Math.random()),
                properties: { ...f.properties, _sanitized: sanitizeProps(f.properties) },
              }));
              editFeaturesRef.current = features;
              setEditFeatures(features);
            }
            setLocalEditMode("move-feature");
          }}
        />
      )}

      <PendingBar pending={pendingChanges} onSaveToLayer={saveToLayerOnly} onSaveToDataset={saveAllPending} onDiscard={discardPending} saving={savingAll} />

      {showExitDialog && (
        <ExitDialog
          onSaveAndExit={handleSaveAndExit}
          onExitWithout={doExit}
          onCancel={() => setShowExitDialog(false)}
          saving={savingAll}
        />
      )}

      {showConfirmDraw && (
        <ConfirmBar
          label={`Save ${localEditMode === "draw-line" ? "line" : "polygon"} — ${drawVertices.length} points`}
          onConfirm={confirmDrawGeometry}
          onCancel={() => setDrawVertices([])}
        />
      )}

      {showAttrModal && selectedFeature && (
        <AttributeModal
          title={attrModalIsNew ? "New Feature — Fill Attributes" : "Edit Attributes"}
          feature={selectedFeature}
          table={activeTable}
          isNew={attrModalIsNew}
          schemaKeys={attrModalIsNew ? activeSchema : undefined}
          onClose={() => {
            if (attrModalIsNew) {
              setEditFeatures((fs) => fs.filter((f) => f.id !== selectedFeature.id));
              setPendingChanges((p) =>
                p.filter((c) => !(("feature" in c) && (c as any).feature?.id === selectedFeature.id))
              );
              setSelectedFeature(null);
            }
            setShowAttrModal(false);
          }}
          onSaved={handleAttrSaved}
        />
      )}

      {selectedFeature && !showAttrModal && (
        <FeaturePopup
          feature={selectedFeature}
          isEditMode={activeDatasetId !== null}
          selectionCount={selectionCount}
          onEditAttrs={() => { setAttrModalIsNew(false); setShowAttrModal(true); }}
          onDelete={() => handleDelete(selectedFeature)}
          onClose={() => { setSelectedFeature(null); setSelectionCount(0); }}
        />
      )}

      {isDrawing && (
        <div style={{
          position: "absolute", top: 60, left: "50%", transform: "translateX(-50%)",
          zIndex: 700, background: "rgba(0,0,0,0.75)", borderRadius: 8,
          padding: "6px 14px", fontSize: 12, color: "#e7eaf0", pointerEvents: "none",
        }}>
          {drawVertices.length === 0 ? "Click on map to start" : `${drawVertices.length} pts — Confirm when done`}
        </div>
      )}

      <div style={{
        position: "absolute", bottom: 12, right: 12, zIndex: 999,
        background: "rgba(0,0,0,0.65)", color: "#fff",
        fontFamily: "monospace", fontSize: 13,
        padding: "4px 10px", borderRadius: 6, pointerEvents: "none",
      }}>
        z: {deckViewState.zoom?.toFixed(2) ?? "—"}
        {activeDatasetId && <span style={{ marginLeft: 10, color: "#f59e0b" }}>✏️ {localEditMode}</span>}
      </div>

      <DeckGL
        style={{ position: "absolute", inset: 0, cursor: cursorStyle }}
        viewState={deckViewState}
        controller={{ dragPan: localEditMode !== "move-feature", scrollZoom: true, doubleClickZoom: false, dragRotate: localEditMode !== "move-feature" }}
        onViewStateChange={({ viewState: vs, interactionState }: any) => {
          setDeckViewState(vs);
        }}
        onClick={(info, event) => {
          handleMapClick(info);        // ← add this
          handleDeckClick(info, event); // ← existing
        }}
      >
        <Map
          ref={mapRef}
          reuseMaps={false}
          mapStyle={mapStyle as any}
          onLoad={() => console.log("Map loaded")}
          onError={(e: any) => console.error("MapLibre error:", e)}
        >
          <Source key={`pts-${tileKey}`} id="points-source" type="vector"
            tiles={[`${POINTS_TILES}?v=${tileKey}`]} minzoom={0} maxzoom={24} promoteId="id"
          />
          <Source key={`lns-${tileKey}`} id="lines-source" type="vector"
            tiles={[`${LINES_TILES}?v=${tileKey}`]} minzoom={0} maxzoom={24} promoteId="id"
          />
          {vectorDatasets.map((ds) => {
            const rawGeoJSON = polygonGeoJSON[ds.id] ?? { type: "FeatureCollection", features: [] };
            if (ds.renderType === "point") console.log("point sample props:", rawGeoJSON.features?.[0]?.properties);
            const { rules: activeRules = [], matchMode = "AND" } = filterRules[ds.id] ?? {};
            if (ds.renderType === "point") console.log("point activeRules:", JSON.stringify(activeRules));
            const filteredGeoJSON = activeRules.length === 0 ? rawGeoJSON : {
              ...rawGeoJSON,
                features: (rawGeoJSON.features ?? []).filter((f: any) =>
                (matchMode === "AND" ? activeRules.every : activeRules.some).call(activeRules, (rule: any) => {
                  const props = f.properties ?? {};
                  const v = props[rule.col];
                  if (rule.op === "=")        return (rule.vals?.length ?? 0) > 0 ? (rule.vals!).includes(String(v ?? "")) : String(v ?? "") === rule.val;
                  if (rule.op === "≠")        return (rule.vals?.length ?? 0) > 0 ? !(rule.vals!).includes(String(v ?? "")) : String(v ?? "") !== rule.val;
                  if (rule.op === ">")        return Number(v) > Number(rule.val);
                  if (rule.op === "<")        return Number(v) < Number(rule.val);
                  if (rule.op === "≥")        return Number(v) >= Number(rule.val);
                  if (rule.op === "≤")        return Number(v) <= Number(rule.val);
                  if (rule.op === "contains") return String(v ?? "").includes(rule.val);
                  if (rule.op === "is empty") return !v || v === "";
                  return true;
                })
              ),
            };
            if (ds.renderType === "point") console.log("filteredGeoJSON count:", filteredGeoJSON.features?.length);
            // Build a stable cache-bust key from the active rules
            
            const rulesKey = activeRules.map((r: any) => `${r.col}${r.op}${r.val}`).join("|");
            return (
              <Source
                key={`pgs-geojson-${ds.id}-${tileKey}-${rulesKey}`}
                id={`polygons-geojson-${ds.id}`}
                type="geojson"
                data={filteredGeoJSON}
              />
            );
          })}

          {vectorDatasets.flatMap((dataset) =>
            layers
              .filter((l) => l.visible && l.datasetId === dataset.id)
              .flatMap((layer) => {

                const color = rgbToCss(layer.color);
                const sym = (layer as any).symbology;

                // Build MapLibre paint expression for categorized/graduated
                function buildColorExpr(fallback: string): any {
                  if (!sym || sym.mode === "single") return fallback;
                  if (sym.mode === "categorized" && sym.values?.length) {
                    const stops: any[] = ["match", ["get", sym.col]];
                    sym.values.forEach((v: string, i: number) => {
                      stops.push(v, sym.colors[i % sym.colors.length]);
                    });
                    stops.push(fallback);
                    return stops;
                  }
                  if (sym.mode === "graduated" && sym.colors?.length) {
                    const colors = sym.colors;
                    // Use class breaks if available (step expression = discrete classes)
                    if (sym.breaks && sym.breaks.length === colors.length + 1) {
                      const expr: any[] = ["step", ["to-number", ["get", sym.col], sym.breaks[0]], colors[0]];
                      for (let i = 1; i < colors.length; i++) {
                        expr.push(sym.breaks[i], colors[i]);
                      }
                      return expr;
                    }
                    // Fallback: interpolate between min/max
                    const min = sym.min ?? 0, max = sym.max ?? 100;
                    const stops: any[] = ["interpolate", ["linear"], ["to-number", ["get", sym.col], min]];
                    colors.forEach((c: string, idx: number) => {
                      const t = colors.length === 1 ? 0 : idx / (colors.length - 1);
                      stops.push(min + t * (max - min), c);
                    });
                    return stops;
                  }
                  return fallback;
                }
                const colorExpr = buildColorExpr(color);



                const { rules: activeRules = [], matchMode = "AND" } = filterRules[dataset.id] ?? {};
                const dsFilter = buildMapFilter(dataset.datasetId, activeRules);

                if (layer.type === "circle") return [
                  <Layer key={layer.id} id={layer.id}
                    type="circle" source={`polygons-geojson-${dataset.id}`}
                    minzoom={0} maxzoom={24}
                    paint={{
                      "circle-color":        colorExpr,
                      "circle-opacity":      layer.opacity,
                      "circle-radius": (() => {
                        const rc = (layer as any).radiusChannel;
                        if (rc?.field) {
                          // Data-driven radius: interpolate field value → pixel size
                          const [rMin, rMax] = rc.range ?? [2, 20];
                          if (rc.scale === "sqrt") {
                            return ["interpolate", ["linear"],
                              ["sqrt", ["max", ["to-number", ["get", rc.field], 0], 0]],
                              0, rMin,
                              ["sqrt", numRange[1] || 100], rMax,  // numRange not available here — use a constant or store max on the layer
                            ];
                          }
                          // linear fallback
                          return ["interpolate", ["linear"],
                            ["to-number", ["get", rc.field], 0],
                            0, rMin, 1e6, rMax,
                          ];
                        }
                        // Zoom-based constant radius (existing behaviour)
                        return ["interpolate", ["linear"], ["zoom"], 0,4, 6,6, 10,7, 14,8, 18,10];
                      })(),
                      "circle-stroke-width": 1.5,
                      "circle-stroke-color": "#fff",
                    }}
                  />,
                ];

                if (layer.type === "line") return [
                  <Layer key={layer.id} id={layer.id}
                    type="line" source={`polygons-geojson-${dataset.id}`}
                    minzoom={0} maxzoom={24}
                    layout={{ "line-cap": "round", "line-join": "round" }}
                    paint={{
                      "line-color":   colorExpr,
                      "line-opacity": (layer as any).strokeOpacity ?? layer.opacity,
                      "line-width":   (layer as any).strokeWidth ?? 2,
                    }}
                  />,
                ];

                
                if (layer.type === "fill") return [
                  <Layer key={`${layer.id}-fill`} id={`${layer.id}-fill`}
                    type="fill" source={`polygons-geojson-${dataset.id}`}
                    minzoom={0} maxzoom={24}
                    paint={{
                      "fill-color":         colorExpr,
                      "fill-opacity":       (layer as any).fillEnabled === false ? 0 : layer.opacity * 0.7,
                      "fill-outline-color": "transparent",
                    }}
                  />,
                  ...((layer as any).strokeEnabled === false ? [] : [
                    <Layer key={`${layer.id}-outline`} id={`${layer.id}-outline`}
                      type="line" source={`polygons-geojson-${dataset.id}`}
                      minzoom={0} maxzoom={24}
                      layout={{ "line-cap": "round", "line-join": "round" }}
                      paint={{
                        "line-color":   hexToRgba(
                          (layer as any).strokeColor ?? color,
                          (layer as any).strokeOpacity ?? 1
                        ),
                        "line-opacity": 1,
                        "line-width":   (layer as any).strokeWidth ?? 1.5,
                      }}
                    />
                  ]),
                ];
                return [];
              })
          )}

          {/* ── Selection highlight ── */}
          {selectedFeature && selectedFeature.geometry && (
            <>
              <Source
                id="selection-highlight"
                type="geojson"
                data={{
                  type: "FeatureCollection",
                  features: [{ type: "Feature", geometry: selectedFeature.geometry, properties: {} }],
                }}
              />
              {/* Fill flash for polygons */}
              <Layer
                id="selection-fill"
                type="fill"
                source="selection-highlight"
                filter={["==", ["geometry-type"], "Polygon"]}
                paint={{
                  "fill-color":   "#f59e0b",
                  "fill-opacity": 0.35,
                }}
              />
              {/* Outline for polygons + lines */}
              <Layer
                id="selection-outline"
                type="line"
                source="selection-highlight"
                layout={{ "line-cap": "round", "line-join": "round" }}
                paint={{
                  "line-color":   "#f59e0b",
                  "line-width":   3,
                  "line-opacity": 1,
                }}
              />
              {/* Halo for points */}
              <Layer
                id="selection-point"
                type="circle"
                source="selection-highlight"
                filter={["==", ["geometry-type"], "Point"]}
                paint={{
                  "circle-radius":       14,
                  "circle-color":        "#f59e0b",
                  "circle-opacity":      0.3,
                  "circle-stroke-color": "#f59e0b",
                  "circle-stroke-width": 2.5,
                }}
              />
            </>
          )}

          {drawPreviewGeoJSON && (
            <>
              <Source id="draw-preview" type="geojson" data={drawPreviewGeoJSON as any} />
              <Layer id="draw-preview-line" type="line" source="draw-preview"
                filter={["==", ["geometry-type"], "LineString"]}
                paint={{ "line-color": "#f59e0b", "line-width": 2.5, "line-dasharray": [4, 2] }}
              />
              <Layer id="draw-preview-dots" type="circle" source="draw-preview"
                filter={["==", ["geometry-type"], "Point"]}
                paint={{ "circle-radius": 5, "circle-color": "#f59e0b", "circle-stroke-color": "#fff", "circle-stroke-width": 2 }}
              />
            </>
          )}

          {localEditMode !== "none" &&
            editFeatures.filter((f) => f.geometry?.type === "Point").map((f) => {
              const [lng, lat] = f.geometry.coordinates;
              const isSel  = selectedFeature?.id === f.id;
              const isPend = f.id.startsWith("pending-");
              return (
                <Marker key={f.id} longitude={lng} latitude={lat}
                  draggable={localEditMode === "select" || localEditMode === "move-feature"}
                  onDragEnd={(e) => handlePointDragEnd(f, e)}
                  onClick={(e) => { e.originalEvent?.stopPropagation?.(); setSelectedFeature(f); setAttrModalIsNew(false); }}
                >
                  <div style={{
                    width: isSel ? 16 : 12, height: isSel ? 16 : 12, borderRadius: "50%",
                    background: isPend ? "#22c55e" : isSel ? "#f59e0b" : "#3b82f6",
                    border: "2px solid #fff", cursor: localEditMode === "select" ? "grab" : "pointer",
                    boxShadow: isSel ? "0 0 0 3px rgba(245,158,11,0.4)" : "0 1px 4px rgba(0,0,0,0.4)",
                    transition: "all 0.15s",
                  }} />
                </Marker>
              );
            })}

          
          {localEditMode !== "none" &&
            editFeatures
              .filter((f) => f.geometry?.type === "LineString" || f.geometry?.type === "Polygon")
              .flatMap((f) => {
                const isLine = f.geometry.type === "LineString";
                const rings: [number, number][][] = isLine ? [f.geometry.coordinates] : f.geometry.coordinates;
                return rings.flatMap((ring: [number, number][], ri: number) =>
                  ring.slice(0, isLine ? ring.length : ring.length - 1)
                    .map((coord: [number, number], vi: number) => (
                      <Marker key={`${f.id}-${ri}-${vi}`} longitude={coord[0]} latitude={coord[1]}
                        draggable={localEditMode === "select"}
                        onDragEnd={(e) => handleVertexDragEnd(f, vi, ri, e)}
                        onClick={(e) => { e.originalEvent?.stopPropagation?.(); setSelectedFeature(f); setAttrModalIsNew(false); }}
                      >
                        <div style={{
                          width: 10, height: 10, borderRadius: 2,
                          background: selectedFeature?.id === f.id ? "#f59e0b" : "#8b5cf6",
                          border: "2px solid #fff", cursor: "grab",
                          boxShadow: "0 1px 4px rgba(0,0,0,0.4)",
                        }} />
                      </Marker>
                    ))
                );
              })}
          

          
          

          {/* Midpoint ghost handles — drag to insert a new vertex */}
          {localEditMode === "select" &&
            editFeatures
              .filter((f) => f.geometry?.type === "LineString" || f.geometry?.type === "Polygon")
              .flatMap((f) => {
                const isLine = f.geometry.type === "LineString";
                const rings: [number, number][][] = isLine ? [f.geometry.coordinates] : f.geometry.coordinates;
                return rings.flatMap((ring: [number, number][], ri: number) => {
                  const verts = ring.slice(0, isLine ? ring.length : ring.length - 1);
                  return verts.map((coord: [number, number], vi: number) => {
                    const nextVi = (vi + 1) % (isLine ? ring.length : verts.length);
                    if (isLine && vi === verts.length - 1) return null; // no wrap for lines
                    const next = ring[nextVi];
                    const midLng = (coord[0] + next[0]) / 2;
                    const midLat = (coord[1] + next[1]) / 2;
                    return (
                      <Marker
                        key={`${f.id}-${ri}-mid-${vi}`}
                        longitude={midLng}
                        latitude={midLat}
                        draggable
                        onDragEnd={(e) => {
                          // Insert a new vertex between vi and vi+1
                          const table = isLine ? "lines" : "polygons";
                          const newGeom = JSON.parse(JSON.stringify(f.geometry));
                          const insertIdx = vi + 1;
                          if (isLine) {
                            newGeom.coordinates.splice(insertIdx, 0, [e.lngLat.lng, e.lngLat.lat]);
                          } else {
                            newGeom.coordinates[ri].splice(insertIdx, 0, [e.lngLat.lng, e.lngLat.lat]);
                          }
                          const updated = { ...f, geometry: newGeom };
                          setEditFeatures((fs) => fs.map((feat) => feat.id === f.id ? updated : feat));
                          stageChange({ kind: f.id.startsWith("pending-") ? "add" : "edit", feature: updated, table });
                        }}
                      >
                        <div style={{
                          width: 8, height: 8, borderRadius: "50%",
                          background: "rgba(139,92,246,0.4)",
                          border: "1.5px dashed #8b5cf6",
                          cursor: "grab",
                          boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
                        }} />
                      </Marker>
                    );
                  }).filter(Boolean);
                });
              })}
            <MapPinsLayer />
            {measurePoints.length > 0 && (
              <MeasureOverlay
                points={measurePoints}
                mode={measureMode}
                onAddPoint={() => {}}
                mousePos={null}
              />
            )}
        </Map>
      </DeckGL>
    </div>
  );
}
