import React, { useCallback, useEffect, useRef, useState } from "react";
import DeckGL from "@deck.gl/react";
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
  /** true when this is a brand-new feature being created */
  isNew?: boolean;
  /** column names inferred from existing features in the dataset */
  schemaKeys?: string[];
  onClose: () => void;
  onSaved: (updated: GeoFeature) => void;
}) {
  // For new features: start with schema keys as empty strings.
  // For existing features: start with their current sanitized props.
  const buildInitial = (): Record<string, string> => {
    if (isNew && schemaKeys && schemaKeys.length > 0) {
      // Pre-populate all schema columns with empty strings
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

  // Whether to show the freeform "add new key" section:
  // only show it when creating a new feature AND the dataset has no schema yet
  const hasSchema = schemaKeys && schemaKeys.length > 0;
  const showAddKey = isNew;   // always allow adding extra keys on new features

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      const isPending = feature.id.startsWith("pending-");
      if (!isPending) {
        // Existing feature — PATCH immediately
        const res = await fetch(`${API}/features/${table}/${feature.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ properties: props }),
        });
        if (!res.ok) throw new Error(await res.text());
      }
      // Always pass updated props back to parent (which stages the change)
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
        {/* Header */}
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

        {/* Schema-based fields (new feature with known columns) */}
        {isNew && hasSchema && (
          <div style={{
            background: "#0a1628", border: "1px solid #1e3a5f",
            borderRadius: 8, padding: "8px 12px",
            fontSize: 12, color: "#60a5fa",
          }}>
            Fill in the values for this new feature. Fields match existing dataset columns.
          </div>
        )}

        {/* No schema and no keys yet */}
        {keys.length === 0 && !showAddKey && (
          <div style={{ fontSize: 13, color: "#a5adbb" }}>No editable attributes.</div>
        )}

        {/* Attribute fields */}
        {keys.map((k) => (
          <label key={k} style={{ display: "grid", gap: 5, fontSize: 13 }}>
            <span style={{ color: "#a5adbb", fontWeight: 600, fontSize: 12 }}>{k}</span>
            <input
              autoFocus={keys.indexOf(k) === 0}
              value={props[k]}
              placeholder={isNew ? `Enter ${k}…` : ""}
              onChange={(e) => setProps({ ...props, [k]: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  // Move to next field or save if last
                  const idx = keys.indexOf(k);
                  if (idx === keys.length - 1 && !showAddKey) handleSave();
                }
              }}
              style={{
                padding: "8px 10px", background: "#15181d",
                border: `1px solid ${isNew && props[k] === "" ? "#3a4255" : "#232832"}`,
                borderRadius: 7, color: "#e7eaf0", fontSize: 13, outline: "none",
              }}
            />
          </label>
        ))}

        {/* Freeform add-key section for new features (or when schema is empty) */}
        {showAddKey && (
          <div style={{
            border: "1px dashed #3a4255", borderRadius: 8, padding: 12, display: "grid", gap: 8,
          }}>
            <div style={{ fontSize: 12, color: "#5a6275", fontWeight: 600 }}>
              {hasSchema ? "Add extra attribute" : "Add attribute"}
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
        )}

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

      <button onClick={onLoadFeatures} style={btn(false)} title="Load features for vertex/drag editing">
        ⟳ Load
      </button>
      <button onClick={() => setEditMode("select")} style={btn(editMode === "select")}>
        ↖ Select
      </button>

      {activeDataset.renderType === "point" && (
        <button onClick={() => setEditMode("add-point")} style={btn(editMode === "add-point")}>
          + Point
        </button>
      )}
      {activeDataset.renderType === "line" && (
        <button onClick={() => setEditMode("draw-line")} style={btn(editMode === "draw-line")}>
          ✏ Line
        </button>
      )}
      {(activeDataset.renderType === "polygon" || activeDataset.renderType === "mixed") && (
        <button onClick={() => setEditMode("draw-polygon")} style={btn(editMode === "draw-polygon")}>
          ⬡ Polygon
        </button>
      )}

      <button onClick={onExitEdit} style={btn(false, true)}>⏹ Exit</button>
    </div>
  );
}

// ── FeaturePopup ──────────────────────────────────────────────────────────────
// Used in both inspect mode (read-only) and edit mode

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
  const attrKeys = Object.keys(sanitized).slice(0, 8); // show up to 8 in popup

  return (
    <div style={{
      position: "absolute", bottom: 60, right: 16, zIndex: 800,
      background: "#111316", border: "1px solid #232832", borderRadius: 12,
      padding: "12px 16px", display: "grid", gap: 8,
      width: 280, maxHeight: "50vh", overflow: "auto",
      boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
    }}>
      {/* Header */}
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

      {/* ID */}
      <div style={{ fontSize: 10, color: "#3a4255", fontFamily: "monospace", wordBreak: "break-all" }}>
        {feature.id.startsWith("pending-") ? "Unsaved — staged for commit" : feature.id}
      </div>

      {/* Attribute preview */}
      {attrKeys.length > 0 && (
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
      )}
      {attrKeys.length === 0 && (
        <div style={{ fontSize: 12, color: "#3a4255" }}>No attributes</div>
      )}

      {/* Actions */}
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
  } = useAppStore();

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
  const mapRef  = useRef<any>(null);
  const deckRef = useRef<any>(null);

  // ── Attach native click listener to DeckGL's canvas ───────────────────────
  // DeckGL swallows pointer events — its canvas never lets Map.onClick fire.
  // Attaching a native listener directly to the canvas is the only reliable
  // way to intercept clicks while still letting DeckGL handle pan/zoom.
  useEffect(() => {
    // DeckGL renders into a canvas; find it in the deckRef container
    const container = deckRef.current;
    if (!container) return;

    const canvas = container.querySelector?.("canvas") as HTMLCanvasElement | null;
    if (!canvas) return;

    const onClick = (e: MouseEvent) => {
      if (showAttrModal) return;
      const map = mapRef.current?.getMap?.();
      if (!map) return;

      // Get pixel coords relative to the canvas
      const rect = canvas.getBoundingClientRect();
      const x    = e.clientX - rect.left;
      const y    = e.clientY - rect.top;

      // add-point mode
      if (localEditMode === "add-point" && activeDatasetId) {
        const lngLat = map.unproject([x, y]);
        const tmpId  = "pending-" + Date.now();
        const tmpFeat: GeoFeature = {
          id: tmpId, type: "Feature",
          geometry:   { type: "Point", coordinates: [lngLat.lng, lngLat.lat] },
          properties: { _pending: true, _sanitized: {} },
        };
        setEditFeatures((fs) => [...fs, tmpFeat]);
        setSelectedFeature(tmpFeat);
        setAttrModalIsNew(true);
        setShowAttrModal(true);
        return;
      }

      // draw-line / draw-polygon
      if ((localEditMode === "draw-line" || localEditMode === "draw-polygon") && activeDatasetId) {
        const lngLat = map.unproject([x, y]);
        setDrawVertices((v) => [...v, [lngLat.lng, lngLat.lat]]);
        return;
      }

      // inspect / select — query rendered features at click point
      const bbox: any = [[x - 12, y - 12], [x + 12, y + 12]];
      const allLayerIds = layers.flatMap((l) =>
        l.type === "fill" ? [`${l.id}-fill`, `${l.id}-outline`] : [l.id]
      );

      let hits: any[] = [];
      try {
        hits = map.queryRenderedFeatures(bbox,
          allLayerIds.length > 0 ? { layers: allLayerIds } : {}
        ) ?? [];
      } catch (_) { /* map not ready */ }

      if (hits.length === 0) {
        setSelectedFeature(null);
        setSelectionCount(0);
        return;
      }

      setSelectionCount(hits.length);
      const hit = hits[0];
      const fid = String(hit.id ?? hit.properties?.id ?? hit.properties?._fid ?? "");

      // Prefer a loaded editFeature (has sanitized props + full geometry)
      const inEdits = editFeatures.find((f) => f.id === fid);
      if (inEdits) {
        setSelectedFeature(inEdits);
        setAttrModalIsNew(false);
        return;
      }

      // Synthetic feature from tile properties
      const tileProps = { ...(hit.properties ?? {}) };
      setSelectedFeature({
        id:         fid || `hit-${Date.now()}`,
        type:       "Feature",
        geometry:   null,
        properties: { ...tileProps, _sanitized: sanitizeProps(tileProps) },
      });
      setAttrModalIsNew(false);
    };

    // Use capture:false so DeckGL's own handlers still fire first
    canvas.addEventListener("click", onClick);
    return () => canvas.removeEventListener("click", onClick);
  }, [
    // Re-attach when anything the handler references changes
    localEditMode, activeDatasetId, layers, editFeatures, showAttrModal,
  ]);

  const vectorDatasets = datasets.filter((d) => d.type === "vector-tile");
  const activeDataset  = datasets.find((d) => d.id === activeDatasetId) ?? null;
  const activeTable    =
    activeDataset?.renderType === "point"  ? "points" :
    activeDataset?.renderType === "line"   ? "lines"  : "polygons";

  // Infer dataset schema from loaded features — collect all unique attribute keys
  // across all non-pending features, in order of first appearance
  const datasetSchema: string[] = React.useMemo(() => {
    const seen = new Set<string>();
    const keys: string[] = [];
    for (const f of editFeatures) {
      if (f.id.startsWith("pending-")) continue;
      const sanitized = (f.properties._sanitized as Record<string, string> | undefined) ?? {};
      for (const k of Object.keys(sanitized)) {
        if (!seen.has(k)) { seen.add(k); keys.push(k); }
      }
      if (keys.length >= 50) break; // cap at 50 columns
    }
    return keys;
  }, [editFeatures]);

  // Sync: when store clears activeDatasetId, reset everything
  useEffect(() => {
    if (activeDatasetId === null) {
      setLocalEditMode("none");
      setEditFeatures([]);
      setSelectedFeature(null);
      setDrawVertices([]);
      setPendingChanges([]);
    }
  }, [activeDatasetId]);

  // ── Load features from backend ─────────────────────────────────────────────
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

  // ── Stage a change ─────────────────────────────────────────────────────────
  function stageChange(change: PendingChange) {
    setPendingChanges((prev) => {
      const next = [...prev];
      if (change.kind === "add") {
        const idx = next.findIndex((c) => c.kind === "add" && (c as any).feature?.id === change.feature.id);
        if (idx >= 0) next[idx] = change; else next.push(change);
      } else if (change.kind === "edit") {
        // If there's a staged add for this id, update its properties instead
        const addIdx = next.findIndex((c) => c.kind === "add" && (c as any).feature?.id === change.feature.id);
        if (addIdx >= 0) {
          (next[addIdx] as any).feature = change.feature;
        } else {
          const editIdx = next.findIndex((c) => c.kind === "edit" && (c as any).feature?.id === change.feature.id);
          if (editIdx >= 0) next[editIdx] = change; else next.push(change);
        }
      } else {
        // delete — remove any staged add/edit for this feature, then add delete
        const filtered = next.filter((c) =>
          !(("feature" in c) && (c as any).feature?.id === (change as any).featureId)
        );
        filtered.push(change);
        return filtered;
      }
      return next;
    });
  }

  // ── Save all pending ───────────────────────────────────────────────────────
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
          await fetch(`${API}/features/${change.table}/${change.featureId}`, {
            method: "DELETE",
          });
        }
      } catch (e) { console.error("Save failed:", change, e); failed++; }
    }

    setSavingAll(false);
    setPendingChanges([]);
    setTileKey((k) => k + 1);
    if (failed > 0) alert(`${failed} change(s) failed to save.`);
  }

  // ── Discard pending ────────────────────────────────────────────────────────
  function discardPending() {
    if (!window.confirm("Discard all unsaved changes?")) return;
    setPendingChanges([]);
    if (activeDatasetId) loadFeatures(activeDatasetId, activeTable);
  }

  // ── Confirm draw ───────────────────────────────────────────────────────────
  function confirmDrawGeometry() {
    if (!activeDatasetId || drawVertices.length < 2) return;
    const isLine  = localEditMode === "draw-line";
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
    // Open attr modal
    setSelectedFeature(newFeat);
    setAttrModalIsNew(true);
    setShowAttrModal(true);
  }

  // ── Handle attr modal save ─────────────────────────────────────────────────
  function handleAttrSaved(updated: GeoFeature) {
    setEditFeatures((fs) => fs.map((f) => f.id === updated.id ? updated : f));
    stageChange({
      kind:    attrModalIsNew ? "add" : "edit",
      feature: updated,
      table:   activeTable,
    });
    setSelectedFeature(updated);
    setShowAttrModal(false);
  }

  // ── Delete feature ─────────────────────────────────────────────────────────
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

  // ── Drag handlers ──────────────────────────────────────────────────────────
  function handlePointDragEnd(feature: GeoFeature, e: { lngLat: { lng: number; lat: number } }) {
    const newGeom = { type: "Point", coordinates: [e.lngLat.lng, e.lngLat.lat] };
    const updated = { ...feature, geometry: newGeom };
    setEditFeatures((fs) => fs.map((f) => f.id === feature.id ? updated : f));
    stageChange({ kind: feature.id.startsWith("pending-") ? "add" : "edit", feature: updated, table: "points" });
  }

  function handleVertexDragEnd(
    feature: GeoFeature, vi: number, ri: number,
    e: { lngLat: { lng: number; lat: number } }
  ) {
    const table   = feature.geometry.type === "LineString" ? "lines" : "polygons";
    const newGeom = JSON.parse(JSON.stringify(feature.geometry));
    if (newGeom.type === "LineString") {
      newGeom.coordinates[vi] = [e.lngLat.lng, e.lngLat.lat];
    } else {
      newGeom.coordinates[ri][vi] = [e.lngLat.lng, e.lngLat.lat];
      if (vi === 0)
        newGeom.coordinates[ri][newGeom.coordinates[ri].length - 1] = [e.lngLat.lng, e.lngLat.lat];
    }
    const updated = { ...feature, geometry: newGeom };
    setEditFeatures((fs) => fs.map((f) => f.id === feature.id ? updated : f));
    stageChange({ kind: feature.id.startsWith("pending-") ? "add" : "edit", feature: updated, table });
  }

  // ── Draw preview ───────────────────────────────────────────────────────────
  const drawPreviewGeoJSON = React.useMemo(() => {
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

  const cursorStyle =
    localEditMode === "add-point" || localEditMode === "draw-line" || localEditMode === "draw-polygon"
      ? "crosshair"
      : localEditMode === "select" ? "pointer" : "grab";
  const isDrawing       = localEditMode === "draw-line" || localEditMode === "draw-polygon";
  const showConfirmDraw = isDrawing && drawVertices.length >= 2;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      {/* Edit toolbar */}
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

      {/* Pending changes bar */}
      <PendingBar
        pending={pendingChanges}
        onSaveAll={saveAllPending}
        onDiscard={discardPending}
        saving={savingAll}
      />

      {/* Draw confirm */}
      {showConfirmDraw && (
        <ConfirmBar
          label={`Finish ${localEditMode === "draw-line" ? "line" : "polygon"} (${drawVertices.length} pts)?`}
          onConfirm={confirmDrawGeometry}
          onCancel={() => setDrawVertices([])}
        />
      )}

      {/* Attribute modal */}
      {showAttrModal && selectedFeature && (
        <AttributeModal
          title={attrModalIsNew ? "New Feature — Fill Attributes" : "Edit Attributes"}
          feature={selectedFeature}
          table={activeTable}
          isNew={attrModalIsNew}
          schemaKeys={attrModalIsNew ? datasetSchema : undefined}
          onClose={() => {
            // Cancel new-feature: remove the green dot we already placed
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

      {/* Feature popup */}
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

      {/* Draw hint */}
      {isDrawing && (
        <div style={{
          position: "absolute", top: 60, left: "50%", transform: "translateX(-50%)",
          zIndex: 700, background: "rgba(0,0,0,0.75)", borderRadius: 8,
          padding: "6px 14px", fontSize: 12, color: "#e7eaf0", pointerEvents: "none",
        }}>
          {drawVertices.length === 0 ? "Click on map to start" : `${drawVertices.length} pts — Confirm when done`}
        </div>
      )}

      {/* Zoom + mode */}
      <div style={{
        position: "absolute", bottom: 12, right: 12, zIndex: 999,
        background: "rgba(0,0,0,0.65)", color: "#fff",
        fontFamily: "monospace", fontSize: 13,
        padding: "4px 10px", borderRadius: 6, pointerEvents: "none",
      }}>
        z: {(viewState as any).zoom?.toFixed(2) ?? "—"}
        {activeDatasetId && <span style={{ marginLeft: 10, color: "#f59e0b" }}>✏️ {localEditMode}</span>}
      </div>

      {/* ── DeckGL + Map ───────────────────────────────────────────────────── */}
      {/* ref div so we can querySelector("canvas") for the native click listener */}
      <div ref={deckRef} style={{ position: "absolute", inset: 0 }}>
      <DeckGL
        viewState={viewState as any}
        controller={
          localEditMode === "none"
            ? true
            : { dragPan: true, scrollZoom: true, doubleClickZoom: false, dragRotate: false }
        }
        onViewStateChange={({ viewState: vs }: any) => setViewState(vs)}
        style={{
          cursor:
            localEditMode === "add-point" || localEditMode === "draw-line" || localEditMode === "draw-polygon"
              ? "crosshair"
              : "pointer",
        } as any}
      >
        <Map
          ref={mapRef}
          reuseMaps={false}
          mapStyle={BASEMAP}
          style={{
            cursor: localEditMode === "add-point" || localEditMode === "draw-line" || localEditMode === "draw-polygon"
              ? "crosshair"
              : "pointer",
          }}
          onLoad={() => console.log("Map loaded")}
          onError={(e: any) => console.error("MapLibre error:", e)}
        >
          {/*
            ── Vector tile sources ──────────────────────────────────────────
            FIX for "features disappear at zoom 4–10":
            • minzoom=0 / maxzoom=22 — force tile requests at every zoom
            • promoteId="id" — lift PK into feature.id for queryRenderedFeatures
            • ?v= cache-bust — fresh tiles after edits
            Martin derives the source-layer name from the table name ("points",
            "lines", "polygons") — make sure source-layer matches exactly.
          */}
          <Source key={`pts-${tileKey}`}  id="points-source"   type="vector"
            tiles={[`${POINTS_TILES}?v=${tileKey}`]}   minzoom={0} maxzoom={22} promoteId="id"
          />
          <Source key={`lns-${tileKey}`}  id="lines-source"    type="vector"
            tiles={[`${LINES_TILES}?v=${tileKey}`]}    minzoom={0} maxzoom={22} promoteId="id"
          />
          <Source key={`pgs-${tileKey}`}  id="polygons-source" type="vector"
            tiles={[`${POLYGONS_TILES}?v=${tileKey}`]} minzoom={0} maxzoom={22} promoteId="id"
          />

          {/* Dataset layers */}
          {vectorDatasets.flatMap((dataset) =>
            layers
              .filter((l) => l.visible && l.datasetId === dataset.id)
              .flatMap((layer) => {
                const color: string        = rgbToCss(layer.color);
                const dsFilter: any = ["==", ["get", "dataset_id"], dataset.datasetId];

                if (layer.type === "circle") return [
                  <Layer key={layer.id} id={layer.id}
                    type="circle" source="points-source" source-layer="points"
                    filter={dsFilter} minzoom={0} maxzoom={24}
                    layout={{ visibility: "visible" }}
                    paint={{
                      "circle-color":        color,
                      "circle-opacity":      layer.opacity,
                      "circle-radius":       ["interpolate", ["linear"], ["zoom"], 0,4, 6,6, 10,7, 14,8, 18,10],
                      "circle-stroke-width": 1,
                      "circle-stroke-color": "#fff",
                    }}
                  />,
                ];

                if (layer.type === "line") return [
                  <Layer key={layer.id} id={layer.id}
                    type="line" source="lines-source" source-layer="lines"
                    filter={dsFilter} minzoom={0} maxzoom={24}
                    layout={{ visibility: "visible", "line-cap": "round", "line-join": "round" }}
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
                    layout={{ visibility: "visible" }}
                    paint={{ "fill-color": color, "fill-opacity": layer.opacity * 0.5 }}
                  />,
                  <Layer key={`${layer.id}-outline`} id={`${layer.id}-outline`}
                    type="line" source="polygons-source" source-layer="polygons"
                    filter={dsFilter} minzoom={0} maxzoom={24}
                    layout={{ visibility: "visible", "line-cap": "round", "line-join": "round" }}
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

          {/* Draw preview */}
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

          {/* Editable point markers */}
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

          {/* Vertex markers for lines/polygons */}
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
      </div>

      {/* ── Click capture ─────────────────────────────────────────────────────
           The native click listener on the canvas (attached in useEffect above)
           handles all interactions — no overlay div needed.                    */}
    </>
  );
}
