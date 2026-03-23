import React, { useEffect, useRef, useState, useMemo } from "react";
import DeckGL from "@deck.gl/react";
import { FlyToInterpolator } from "@deck.gl/core";
import Map, { Source, Layer, Marker } from "react-map-gl/maplibre";
import { useAppStore } from "./store";

const BASEMAP = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
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

type EditMode = "none" | "select" | "add-point" | "draw-line" | "draw-polygon";

// ── sanitizeProps ─────────────────────────────────────────────────────────────

function sanitizeProps(raw: Record<string, any>): Record<string, string> {
  const cleaned: Record<string, any> = { ...raw };
  delete cleaned._fid;
  delete cleaned.dataset_id;
  delete cleaned._sanitized;
  delete cleaned._pending;

  const entries = Object.entries(cleaned);
  if (entries.length === 0) return {};

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

  return Object.fromEntries(
    entries.map(([k, v]) => [k, v === null || v === undefined ? "" : String(v)])
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
      const isPending = feature.id.startsWith("pending-");
      if (!isPending) {
        const res = await fetch(`${API}/features/${table}/${feature.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ properties: props }),
        });
        if (!res.ok) throw new Error(await res.text());
      }
      onSaved({ ...feature, properties: { ...feature.properties, ...props, _sanitized: props } });
      onClose();
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
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)",
        display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999,
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div style={{
        background: "#111316", border: "1px solid #232832", borderRadius: 14,
        padding: 24, width: 460, maxHeight: "85vh", overflow: "auto",
        display: "grid", gap: 14, boxShadow: "0 24px 60px rgba(0,0,0,0.7)",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>{title}</div>
            <div style={{ fontSize: 11, color: "#a5adbb", marginTop: 3, fontFamily: "monospace" }}>
              {feature.id.startsWith("pending-")
                ? <span style={{ color: "#22c55e" }}>● New — staged for saving</span>
                : feature.id}
            </div>
          </div>
          <button onClick={onClose} style={{
            background: "none", border: "1px solid #232832", borderRadius: 6,
            color: "#a5adbb", cursor: "pointer", padding: "4px 10px", fontSize: 14,
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

        <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
          <button onClick={handleSave} disabled={saving} style={{
            flex: 1, padding: "9px 0", background: "#3b82f6", border: "none",
            borderRadius: 8, color: "#fff", fontWeight: 700,
            cursor: saving ? "wait" : "pointer", fontSize: 13,
          }}>
            {saving ? "Saving…" : isNew ? "✓ Add feature" : "✓ Save changes"}
          </button>
          <button onClick={onClose} style={{
            padding: "9px 16px", background: "none",
            border: "1px solid #232832", borderRadius: 8,
            color: "#a5adbb", cursor: "pointer", fontSize: 13,
          }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ── PendingBar ────────────────────────────────────────────────────────────────

function PendingBar({ pending, onSaveAll, onDiscard, saving }: {
  pending: PendingChange[];
  onSaveAll: () => void;
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
      display: "flex", alignItems: "center", gap: 12,
      boxShadow: "0 8px 32px rgba(0,0,0,0.6)", whiteSpace: "nowrap",
    }}>
      <span style={{ fontSize: 13, color: "#f59e0b", fontWeight: 600 }}>
        ● {parts.join(", ")} unsaved
      </span>
      <button onClick={onSaveAll} disabled={saving} style={{
        padding: "6px 16px", background: "#22c55e", border: "none",
        borderRadius: 7, color: "#fff", fontWeight: 700,
        cursor: saving ? "wait" : "pointer", fontSize: 12,
      }}>
        {saving ? "Saving…" : "💾 Save all"}
      </button>
      <button onClick={onDiscard} disabled={saving} style={{
        padding: "6px 12px", background: "none", border: "1px solid #232832",
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
      zIndex: 800, background: "#111316", border: "1px solid #232832",
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
        padding: "6px 14px", background: "none", border: "1px solid #232832",
        borderRadius: 7, color: "#a5adbb", cursor: "pointer", fontSize: 12,
      }}>Cancel</button>
    </div>
  );
}

// ── EditToolbar ───────────────────────────────────────────────────────────────

function EditToolbar({
  editMode, setEditMode, activeDataset, loadedCount,
  onExitEdit, onLoadFeatures,
}: {
  editMode: EditMode;
  setEditMode: (m: EditMode) => void;
  activeDataset: any;
  loadedCount: number;
  onExitEdit: () => void;
  onLoadFeatures: () => void;
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
      {activeDataset.renderType === "point" && (
        <button onClick={() => setEditMode("add-point")} style={btn(editMode === "add-point")}>+ Point</button>
      )}
      {activeDataset.renderType === "line" && (
        <button onClick={() => setEditMode("draw-line")} style={btn(editMode === "draw-line")}>✏ Line</button>
      )}
      {(activeDataset.renderType === "polygon" || activeDataset.renderType === "mixed") && (
        <button onClick={() => setEditMode("draw-polygon")} style={btn(editMode === "draw-polygon")}>⬡ Polygon</button>
      )}
      <button onClick={onExitEdit} style={btn(false, true)}>⏹ Exit</button>
    </div>
  );
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

// ── MapView ───────────────────────────────────────────────────────────────────

export function MapView() {
  const {
    datasets, layers, viewState, setViewState,
    activeDatasetId, setActiveDatasetId,
    zoomTarget,
  } = useAppStore();

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

  // ── Zoom to layer via DeckGL FlyToInterpolator ───────────────────────────
  useEffect(() => {
    if (!zoomTarget) return;
    if (zoomTarget.id === lastZoomTargetId.current) return;
    lastZoomTargetId.current = zoomTarget.id;

    setDeckViewState((prev: any) => ({
      ...prev,
      longitude:              zoomTarget.longitude,
      latitude:               zoomTarget.latitude,
      zoom:                   zoomTarget.zoom,
      pitch:                  0,
      bearing:                0,
      transitionDuration:     1200,
      transitionInterpolator: new FlyToInterpolator({ speed: 1.5 }),
    }));
  }, [zoomTarget]);

  const [editFeatures, setEditFeatures]       = useState<GeoFeature[]>([]);
  const [localEditMode, setLocalEditMode]     = useState<EditMode>("none");
  const [selectedFeature, setSelectedFeature] = useState<GeoFeature | null>(null);
  const [selectionCount, setSelectionCount]   = useState(0);
  const [showAttrModal, setShowAttrModal]     = useState(false);
  const [attrModalIsNew, setAttrModalIsNew]   = useState(false);
  const [drawVertices, setDrawVertices]       = useState<[number, number][]>([]);
  const [pendingChanges, setPendingChanges]   = useState<PendingChange[]>([]);
  const [savingAll, setSavingAll]             = useState(false);
  const [tileKey, setTileKey]                 = useState(0);
  const [serverSchema, setServerSchema]       = useState<string[]>([]);

  // When activeDatasetId changes, reset edit state
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

  // Fetch schema for active dataset
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
          const s = sanitizeProps(f.properties ?? {});
          for (const k of Object.keys(s)) {
            if (!seen.has(k)) { seen.add(k); keys.push(k); }
          }
        }
        setServerSchema(keys);
      })
      .catch(() => setServerSchema([]));
  }, [activeDatasetId, datasets]);

  const vectorDatasets = datasets.filter((d) => d.type === "vector-tile");
  const activeDataset  = datasets.find((d) => d.id === activeDatasetId) ?? null;
  const activeTable    =
    activeDataset?.renderType === "point" ? "points" :
    activeDataset?.renderType === "line"  ? "lines"  : "polygons";

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
    setSelectedFeature({
      id:         fid || `hit-${Date.now()}`,
      type:       "Feature",
      geometry:   null,
      properties: { ...tileProps, _sanitized: sanitizeProps(tileProps) },
    });
    setSelectionCount(count);
    setAttrModalIsNew(false);
  };

  // ── Load features ─────────────────────────────────────────────────────────
  async function loadFeatures(dsId: string, table: string) {
    try {
      const res  = await fetch(`${API}/datasets/${dsId}/features?table=${table}`);
      const fc   = await res.json();
      const features: GeoFeature[] = (fc.features ?? []).map((f: any) => ({
        ...f,
        id: String(f.id ?? f.properties?._fid ?? Math.random()),
        properties: { ...f.properties, _sanitized: sanitizeProps(f.properties) },
      }));
      setEditFeatures(features);
      setLocalEditMode("select");
    } catch (e) { console.error("Failed to load features", e); }
  }

  // ── Exit edit ─────────────────────────────────────────────────────────────
  function handleExitEdit() {
    if (pendingChanges.length > 0 && !window.confirm("You have unsaved changes. Exit anyway?")) return;
    setLocalEditMode("none");
    setEditFeatures([]);
    setSelectedFeature(null);
    setDrawVertices([]);
    setPendingChanges([]);
    setActiveDatasetId(null);
    setTileKey((k) => k + 1);
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
  async function saveAllPending() {
    if (pendingChanges.length === 0) return;
    setSavingAll(true);
    let failed = 0;
    for (const change of pendingChanges) {
      try {
        if (change.kind === "add") {
          await fetch(`${API}/datasets/${activeDatasetId}/features`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              geometry:   change.feature.geometry,
              properties: sanitizeProps(change.feature.properties),
              table:      change.table,
            }),
          });
        } else if (change.kind === "edit") {
          await fetch(`${API}/features/${change.table}/${change.feature.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              geometry:   change.feature.geometry,
              properties: sanitizeProps(change.feature.properties),
            }),
          });
        } else if (change.kind === "delete") {
          await fetch(`${API}/features/${change.table}/${change.featureId}`, { method: "DELETE" });
        }
      } catch (e) { console.error("Save failed:", change, e); failed++; }
    }
    setSavingAll(false);
    setPendingChanges([]);
    setTileKey((k) => k + 1);
    if (failed > 0) alert(`${failed} change(s) failed to save.`);
  }

  function discardPending() {
    if (!window.confirm("Discard all unsaved changes?")) return;
    setPendingChanges([]);
    if (activeDatasetId) loadFeatures(activeDatasetId, activeTable);
  }

  function confirmDrawGeometry() {
    if (!activeDatasetId || drawVertices.length < 2) return;
    const isLine   = localEditMode === "draw-line";
    const geometry = isLine
      ? { type: "LineString", coordinates: drawVertices }
      : { type: "Polygon",   coordinates: [[...drawVertices, drawVertices[0]]] };
    const table  = isLine ? "lines" : "polygons";
    const tmpId  = "pending-" + Date.now();
    const newFeat: GeoFeature = {
      id: tmpId, type: "Feature", geometry,
      properties: { _pending: true, _sanitized: {} },
    };
    setEditFeatures((fs) => [...fs, newFeat]);
    stageChange({ kind: "add", feature: newFeat, table });
    setDrawVertices([]);
    setLocalEditMode("select");
    setSelectedFeature(newFeat);
    setAttrModalIsNew(true);
    setShowAttrModal(true);
  }

  function handleAttrSaved(updated: GeoFeature) {
    setEditFeatures((fs) => fs.map((f) => f.id === updated.id ? updated : f));
    stageChange({ kind: attrModalIsNew ? "add" : "edit", feature: updated, table: activeTable });
    setSelectedFeature(updated);
    setShowAttrModal(false);
  }

  function handleDelete(feature: GeoFeature) {
    if (!window.confirm("Delete this feature?")) return;
    setEditFeatures((fs) => fs.filter((f) => f.id !== feature.id));
    if (feature.id.startsWith("pending-")) {
      setPendingChanges((p) =>
        p.filter((c) => !(("feature" in c) && (c as any).feature?.id === feature.id))
      );
    } else {
      stageChange({ kind: "delete", featureId: feature.id, table: activeTable });
    }
    setSelectedFeature(null);
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
  const cursorStyle     = localEditMode === "add-point" || isDrawing ? "crosshair" : "default";

  return (
    <>
      {activeDatasetId !== null && activeDataset !== null && (
        <EditToolbar
          editMode={localEditMode}
          setEditMode={(m) => { setLocalEditMode(m); setDrawVertices([]); }}
          activeDataset={activeDataset}
          loadedCount={editFeatures.length}
          onExitEdit={handleExitEdit}
          onLoadFeatures={() => activeDatasetId && loadFeatures(activeDatasetId, activeTable)}
        />
      )}

      <PendingBar pending={pendingChanges} onSaveAll={saveAllPending} onDiscard={discardPending} saving={savingAll} />

      {showConfirmDraw && (
        <ConfirmBar
          label={`Finish ${localEditMode === "draw-line" ? "line" : "polygon"} (${drawVertices.length} pts)?`}
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
        controller={{ dragPan: true, scrollZoom: true, doubleClickZoom: false, dragRotate: true }}
        onViewStateChange={({ viewState: vs, interactionState }: any) => {
          // During a programmatic transition, DeckGL emits intermediate states.
          // We must pass those back AS-IS (with transitionInterpolator intact)
          // so the animation isn't cancelled. Strip transition props only for zustand.
          setDeckViewState(vs);
          const { transitionInterpolator: _ti, transitionDuration: _td, ...rest } = vs;
          setViewState(rest);
        }}
        onClick={handleDeckClick}
      >
        <Map
          ref={mapRef}
          reuseMaps={false}
          mapStyle={BASEMAP}
          onLoad={() => console.log("Map loaded")}
          onError={(e: any) => console.error("MapLibre error:", e)}
        >
          <Source key={`pts-${tileKey}`} id="points-source" type="vector"
            tiles={[`${POINTS_TILES}?v=${tileKey}`]} minzoom={0} maxzoom={22} promoteId="id"
          />
          <Source key={`lns-${tileKey}`} id="lines-source" type="vector"
            tiles={[`${LINES_TILES}?v=${tileKey}`]} minzoom={0} maxzoom={22} promoteId="id"
          />
          <Source key={`pgs-${tileKey}`} id="polygons-source" type="vector"
            tiles={[`${POLYGONS_TILES}?v=${tileKey}`]} minzoom={0} maxzoom={22} promoteId="id"
          />

          {vectorDatasets.flatMap((dataset) =>
            layers
              .filter((l) => l.visible && l.datasetId === dataset.id)
              .flatMap((layer) => {
                const color     = rgbToCss(layer.color);
                const dsFilter: any = ["==", ["get", "dataset_id"], dataset.datasetId];

                if (layer.type === "circle") return [
                  <Layer key={layer.id} id={layer.id}
                    type="circle" source="points-source" source-layer="points"
                    filter={dsFilter} minzoom={0} maxzoom={24}
                    paint={{
                      "circle-color":        color,
                      "circle-opacity":      layer.opacity,
                      "circle-radius":       ["interpolate", ["linear"], ["zoom"], 0,4, 6,6, 10,7, 14,8, 18,10],
                      "circle-stroke-width": 1.5,
                      "circle-stroke-color": "#fff",
                    }}
                  />,
                ];

                if (layer.type === "line") return [
                  <Layer key={layer.id} id={layer.id}
                    type="line" source="lines-source" source-layer="lines"
                    filter={dsFilter} minzoom={0} maxzoom={24}
                    layout={{ "line-cap": "round", "line-join": "round" }}
                    paint={{
                      "line-color":   color,
                      "line-opacity": layer.opacity,
                      "line-width":   ["interpolate", ["linear"], ["zoom"], 0,1, 6,2, 12,3, 16,5],
                    }}
                  />,
                ];

                if (layer.type === "fill") return [
                  <Layer key={`${layer.id}-fill`} id={`${layer.id}-fill`}
                    type="fill" source="polygons-source" source-layer="polygons"
                    filter={dsFilter} minzoom={0} maxzoom={24}
                    paint={{ "fill-color": color, "fill-opacity": layer.opacity * 0.5 }}
                  />,
                  <Layer key={`${layer.id}-outline`} id={`${layer.id}-outline`}
                    type="line" source="polygons-source" source-layer="polygons"
                    filter={dsFilter} minzoom={0} maxzoom={24}
                    layout={{ "line-cap": "round", "line-join": "round" }}
                    paint={{
                      "line-color":   color,
                      "line-opacity": layer.opacity,
                      "line-width":   ["interpolate", ["linear"], ["zoom"], 0,0.5, 6,1.5, 10,2, 14,3],
                    }}
                  />,
                ];

                return [];
              })
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
                  draggable={localEditMode === "select"}
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
        </Map>
      </DeckGL>
    </>
  );
}
