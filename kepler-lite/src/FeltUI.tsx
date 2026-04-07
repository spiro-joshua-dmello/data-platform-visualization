import React, { useState, useCallback, useEffect } from "react";
import { useAppStore, type Annotation, type ActiveTool } from "./store";
import { UploadPanel } from "./panels/UploadPanel";

const API = "http://localhost:8787";

// ─── Design tokens ────────────────────────────────────────────────────────────
const T = {
  card:      "rgba(255,255,255,0.96)",
  border:    "rgba(0,0,0,0.08)",
  shadow:    "0 4px 24px rgba(0,0,0,0.12), 0 1px 4px rgba(0,0,0,0.08)",
  text:      "#111827",
  textMuted: "#6b7280",
  textLight: "#9ca3af",
  hover:     "rgba(0,0,0,0.04)",
  hoverRed:  "rgba(239,68,68,0.1)",
  accent:    "#2563eb",
  green:     "#10b981",
  red:       "#ef4444",
  orange:    "#f97316",
  radius:    "16px",
  radiusSm:  "10px",
  radiusXs:  "6px",
  font:      "'Inter', -apple-system, system-ui, sans-serif",
};

// ─── Colour palettes ──────────────────────────────────────────────────────────
const DISCRETE_PALETTES: Record<string, string[]> = {
  "Tableau":  ["#4e79a7","#f28e2b","#e15759","#76b7b2","#59a14f","#edc948","#b07aa1","#ff9da7","#9c755f","#bab0ac"],
  "Pastel":   ["#aec6cf","#ffb347","#b5ead7","#c7ceea","#ffdac1","#e2f0cb","#ff9aa2","#f8d9d9","#c4faf8","#b5ead7"],
  "Bold":     ["#e41a1c","#377eb8","#4daf4a","#984ea3","#ff7f00","#a65628","#f781bf","#999999","#66c2a5","#fc8d62"],
  "Earthy":   ["#a0522d","#6b8e23","#4682b4","#d2691e","#708090","#556b2f","#8b4513","#2e8b57","#800000","#4169e1"],
};

const CONTINUOUS_PALETTES: Record<string, [string, string]> = {
  "Blue":    ["#dbeafe", "#1d4ed8"],
  "Green":   ["#dcfce7", "#15803d"],
  "Orange":  ["#fff7ed", "#c2410c"],
  "Purple":  ["#f5f3ff", "#6d28d9"],
  "Red":     ["#fef2f2", "#b91c1c"],
  "Viridis": ["#fde725", "#440154"],
  "Plasma":  ["#f0f921", "#0d0887"],
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function rgbToHex([r, g, b]: [number, number, number]) {
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}
function hexToRgb(hex: string): [number, number, number] {
  const c = hex.replace("#", "");
  return [parseInt(c.slice(0,2),16), parseInt(c.slice(2,4),16), parseInt(c.slice(4,6),16)];
}
function uid() { return Math.random().toString(36).slice(2, 10); }
const ANNO_COLORS = ["#f97316","#3b82f6","#22c55e","#a855f7","#ef4444","#eab308"];

// ─── Symbology swatch ─────────────────────────────────────────────────────────
function LayerSwatch({ type, color, size = 16 }: { type: string; color: string; size?: number }) {
  if (type === "circle") return (
    <svg width={size} height={size} viewBox="0 0 16 16" style={{ flexShrink: 0 }}>
      <circle cx="8" cy="8" r="5.5" fill={color} stroke="white" strokeWidth="1.5"/>
    </svg>
  );
  if (type === "line") return (
    <svg width={size} height={size} viewBox="0 0 16 16" style={{ flexShrink: 0 }}>
      <path d="M2 12 Q5 4 8 8 Q11 12 14 4" stroke={color} strokeWidth="2.5" fill="none" strokeLinecap="round"/>
    </svg>
  );
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" style={{ flexShrink: 0 }}>
      <rect x="2" y="2" width="12" height="12" rx="2" fill={color} fillOpacity="0.65" stroke={color} strokeWidth="1.5"/>
    </svg>
  );
}

// ─── Icon button ──────────────────────────────────────────────────────────────
function IconBtn({ onClick, title, children, danger = false, active = false }: {
  onClick: () => void; title?: string; children: React.ReactNode;
  danger?: boolean; active?: boolean;
}) {
  const [hov, setHov] = useState(false);
  return (
    <button onClick={onClick} title={title}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{
        width: 26, height: 26, display: "flex", alignItems: "center", justifyContent: "center",
        borderRadius: T.radiusXs, border: "none", cursor: "pointer", padding: 0,
        background: active ? T.accent : hov ? (danger ? T.hoverRed : T.hover) : "transparent",
        color: active ? "white" : hov ? (danger ? T.red : T.text) : T.textLight,
        transition: "background 0.12s, color 0.12s",
      }}>
      {children}
    </button>
  );
}

// ─── Toggle switch ────────────────────────────────────────────────────────────
function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!checked)} style={{
      width: 36, height: 20, borderRadius: 999, border: "none", cursor: "pointer",
      background: checked ? T.accent : "#d1d5db", position: "relative",
      transition: "background 0.2s", padding: 0, flexShrink: 0,
    }}>
      <div style={{
        position: "absolute", top: 2, width: 16, height: 16, borderRadius: "50%",
        background: "white", boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
        left: checked ? 18 : 2, transition: "left 0.2s",
      }}/>
    </button>
  );
}

// ─── Card ─────────────────────────────────────────────────────────────────────
function Card({ children, style = {} }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      background: T.card, backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
      borderRadius: T.radius, border: `1px solid ${T.border}`,
      boxShadow: T.shadow, fontFamily: T.font, overflow: "hidden", ...style,
    }}>
      {children}
    </div>
  );
}

function ToolButton({ t, isActive, onClick }: {
  t: { id: string; label: string; icon: React.ReactNode; tip: string };
  isActive: boolean;
  onClick: () => void;
}) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      title={t.tip}
      style={{
        display: "flex", alignItems: "center", gap: 5,
        padding: "5px 10px", borderRadius: 10, border: "none", cursor: "pointer",
        fontFamily: T.font, fontSize: 12, fontWeight: 600,
        background: isActive ? T.text : hov ? T.hover : "transparent",
        color: isActive ? "white" : T.textMuted,
        transition: "background 0.12s, color 0.12s",
      }}
    >
      {t.icon}
      {t.label}
    </button>
  );
}

// ─── Top Toolbar ──────────────────────────────────────────────────────────────
function MapToolbar() {
  const { activeTool, setActiveTool, measurePoints, measureMode, setMeasureMode, setMeasurePoints } = useAppStore() as any;
  const tool = activeTool as ActiveTool;

  const tools: { id: ActiveTool; label: string; icon: React.ReactNode; tip: string }[] = [
    {
      id: "pointer",
      tip: "Select (V)",
      label: "Select",
      icon: (
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
          <path d="M3 2l10 6-5 1-2 5L3 2z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" fill={tool === "pointer" ? "white" : "none"}/>
        </svg>
      ),
    },
    {
      id: "pan",
      tip: "Pan (H)",
      label: "Pan",
      icon: (
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
          <path d="M8 2v2M8 12v2M2 8h2M12 8h2M4.5 4.5l1.5 1.5M10 10l1.5 1.5M4.5 11.5L6 10M10 6l1.5-1.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
          <circle cx="8" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.5"/>
        </svg>
      ),
    },
    {
      id: "annotate",
      tip: "Pin annotation (A)",
      label: "Annotate",
      icon: (
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
          <path d="M8 2C5.8 2 4 3.8 4 6c0 3 4 8 4 8s4-5 4-8c0-2.2-1.8-4-4-4z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" fill={tool === "annotate" ? "white" : "none"}/>
          <circle cx="8" cy="6" r="1.5" fill="currentColor"/>
        </svg>
      ),
    },
    {
      id: "measure",
      tip: "Measure distance (M)",
      label: "Measure",
      icon: (
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
          <path d="M2 11L11 2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
          <path d="M2 11l2-2M5 8l2-2M8 5l2-2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity="0.5"/>
          <circle cx="2" cy="11" r="1.5" fill="currentColor"/>
          <circle cx="11" cy="2" r="1.5" fill="currentColor"/>
        </svg>
      ),
    },
    {
      id: "upload",
      tip: "Upload file (U)",
      label: "Upload",
      icon: (
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
          <path d="M8 2v9M5 5l3-3 3 3M2 13h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      ),
    },
  ];

  // Keyboard shortcuts
  React.useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === "INPUT" || (e.target as HTMLElement).tagName === "TEXTAREA") return;
      if (e.key === "v" || e.key === "V") setActiveTool("pointer");
      if (e.key === "h" || e.key === "H") setActiveTool("pan");
      if (e.key === "a" || e.key === "A") setActiveTool("annotate");
      if (e.key === "m" || e.key === "M") setActiveTool("measure");
      if (e.key === "u" || e.key === "U") setActiveTool("upload");
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [setActiveTool]);

  return (
    <div style={{ position: "relative" }}>
      <Card style={{ display: "flex", alignItems: "center", gap: 2, padding: "5px 6px", borderRadius: 14 }}>
        {tools.map((t, i) => (
          <React.Fragment key={t.id}>
            {(i === 2 || i === 4) && (
              <div style={{ width: 1, height: 20, background: T.border, margin: "0 3px" }}/>
            )}
            <ToolButton t={t} isActive={tool === t.id} onClick={() => setActiveTool(t.id)} />
          </React.Fragment>
        ))}

        {/* Inline hints */}
        {tool === "measure" && (
          <>
              <div style={{ width: 1, height: 20, background: T.border, margin: "0 3px" }}/>

              {/* Line / Polygon mode toggle */}
              {(["line", "polygon"] as const).map((m) => {
              const isActive = measureMode === m;
              const accent   = m === "line" ? "#00e5ff" : "#69ff47";
              return (
                  <button
                  key={m}
                  onClick={() => { setMeasureMode(m); setMeasurePoints([]); }}
                  style={{
                      padding: "3px 9px", borderRadius: 7, border: "none", cursor: "pointer",
                      fontSize: 11, fontWeight: 600, fontFamily: T.font,
                      background: isActive ? `${accent}18` : "transparent",
                      color:      isActive ? accent : T.textMuted,
                      outline:    isActive ? `1.5px solid ${accent}55` : "none",
                      transition: "all 0.12s",
                  }}
                  >
                  {m === "line" ? "📏 Line" : "⬡ Area"}
                  </button>
              );
              })}

              <div style={{ width: 1, height: 20, background: T.border, margin: "0 3px" }}/>
              <div style={{ fontSize: 11, color: T.textMuted, padding: "0 6px", whiteSpace: "nowrap" }}>
              {(measurePoints?.length ?? 0) === 0
                  ? "Click to start"
                  : `${measurePoints.length} pts · ESC to clear`}
              </div>
          </>
        )}
        {tool === "annotate" && (
          <>
            <div style={{ width: 1, height: 20, background: T.border, margin: "0 3px" }}/>
            <div style={{ fontSize: 11, color: T.orange, padding: "0 6px", fontWeight: 600, whiteSpace: "nowrap" }}>
              Click map to place pin
            </div>
          </>
        )}
      </Card>

      {/* Upload dropdown — appears below toolbar when upload tool is active */}
      {tool === "upload" && (
        <div style={{
          position: "absolute", top: "calc(100% + 10px)", left: "50%",
          transform: "translateX(-50%)",
          width: 300, zIndex: 200,
          background: T.card, backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
          borderRadius: T.radius, border: `1px solid ${T.border}`,
          boxShadow: "0 8px 32px rgba(0,0,0,0.14)", overflow: "hidden",
        }}>
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "10px 14px", borderBottom: `1px solid ${T.border}`,
          }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: T.text, fontFamily: T.font }}>Upload file</span>
            <IconBtn onClick={() => setActiveTool("pointer")}>
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </IconBtn>
          </div>
          <div style={{ padding: 14 }}>
            <UploadPanel />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Legend Panel ─────────────────────────────────────────────────────────────
function LegendPanel({ onStyleLayer, onShowAttrTable, editMode }: {
  onStyleLayer: (id: string) => void;
  onShowAttrTable: (id: string) => void;
  editMode: boolean;
}) {
  const { layers, datasets, updateLayer, removeLayer, removeDataset, setZoomTarget } = useAppStore();
  const [minimized, setMinimized] = useState(false);
  const [tab, setTab] = useState<"layers"|"notes">("layers");

  return (
    <Card style={{ width: 280, maxHeight: "calc(100vh - 160px)", display: "flex", flexDirection: "column" }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "10px 14px", borderBottom: `1px solid ${T.border}`, flexShrink: 0,
      }}>
        <div style={{ display: "flex", gap: 4 }}>
          {(["layers","notes"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: "4px 12px", borderRadius: 8, border: "none", cursor: "pointer",
              fontSize: 12, fontWeight: 600, fontFamily: T.font,
              background: tab === t ? T.text : "transparent",
              color: tab === t ? "white" : T.textMuted,
              transition: "background 0.15s, color 0.15s",
            }}>
              {t === "layers" ? "Layers" : "Notes"}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 2 }}>
          <IconBtn onClick={() => setMinimized(!minimized)} title={minimized ? "Expand" : "Minimise"}>
            {minimized
              ? <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              : <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M4 10l4-4 4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            }
          </IconBtn>
        </div>
      </div>

      {!minimized && (
        <div style={{ overflowY: "auto", flex: 1 }}>
          {tab === "layers"
            ? <LayersTab
                layers={layers} datasets={datasets}
                updateLayer={updateLayer} removeLayer={removeLayer} removeDataset={removeDataset}
                onStyleLayer={onStyleLayer} onShowAttrTable={onShowAttrTable}
                editMode={editMode} setZoomTarget={setZoomTarget}
              />
            : <NotesTab />
          }
        </div>
      )}
    </Card>
  );
}

// ─── Layers Tab ───────────────────────────────────────────────────────────────
function LayersTab({ layers, datasets, updateLayer, removeLayer, removeDataset, onStyleLayer, onShowAttrTable, editMode, setZoomTarget }: any) {
  const [hovId, setHovId] = useState<string|null>(null);
  const [deleting, setDeleting] = useState<string|null>(null);

  if (layers.length === 0) return (
    <div style={{ padding: "32px 16px", textAlign: "center", color: T.textLight, fontSize: 13, fontFamily: T.font }}>
      <div style={{ fontSize: 28, marginBottom: 8 }}>🗺️</div>
      No layers yet — upload a dataset to begin
    </div>
  );

  async function handleDelete(layer: any) {
    const datasetId = layer.datasetId;
    setDeleting(layer.id);
    try {
      const res = await fetch(`${API}/datasets/${datasetId}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      console.error("Delete failed:", e);
    } finally {
      removeLayer(layer.id);
      removeDataset(datasetId);
      setDeleting(null);
    }
  }

  return (
    <div style={{ padding: "6px 0" }}>
      {layers.map((layer: any) => {
        const ds = datasets.find((d: any) => d.id === layer.datasetId);
        const hex = rgbToHex(layer.color);
        const isHov = hovId === layer.id;
        const isDeleting = deleting === layer.id;
        return (
          <div key={layer.id}
            onMouseEnter={() => setHovId(layer.id)}
            onMouseLeave={() => setHovId(null)}
            style={{
              padding: "8px 14px",
              background: isHov ? T.hover : "transparent",
              transition: "background 0.1s",
              opacity: isDeleting ? 0.4 : 1,
            }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button onClick={() => updateLayer(layer.id, { visible: !layer.visible })}
                style={{ background: "none", border: "none", cursor: "pointer", padding: 0, lineHeight: 0, flexShrink: 0 }}
                title={layer.visible ? "Hide layer" : "Show layer"}>
                {layer.visible ? (
                  <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
                    <ellipse cx="8" cy="8" rx="6" ry="4" stroke={hex} strokeWidth="1.5"/>
                    <circle cx="8" cy="8" r="2" fill={hex}/>
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
                    <path d="M2 2l12 12" stroke="#d1d5db" strokeWidth="1.5" strokeLinecap="round"/>
                    <ellipse cx="8" cy="8" rx="6" ry="4" stroke="#d1d5db" strokeWidth="1.5"/>
                  </svg>
                )}
              </button>
              <span style={{
                fontSize: 13, fontWeight: 500, flex: 1, overflow: "hidden",
                textOverflow: "ellipsis", whiteSpace: "nowrap",
                color: layer.visible ? T.text : T.textLight, fontFamily: T.font,
              }} title={layer.name}>{layer.name}</span>
              <div style={{ display: "flex", gap: 1, opacity: isHov ? 1 : 0, transition: "opacity 0.15s" }}>
                {/* Zoom to layer */}
                <IconBtn onClick={() => {
                  if (ds?.bounds) {
                    const [minLng, minLat, maxLng, maxLat] = ds.bounds;
                    const lng = (minLng + maxLng) / 2;
                    const lat = (minLat + maxLat) / 2;
                    const diff = Math.max(Math.abs(maxLng - minLng), Math.abs(maxLat - minLat), 0.001);
                    const zoom = diff > 60 ? 2 : diff > 30 ? 3 : diff > 15 ? 4 : diff > 8 ? 5 : diff > 4 ? 6 : diff > 2 ? 7 : diff > 1 ? 8 : diff > 0.5 ? 9 : diff > 0.25 ? 10 : diff > 0.12 ? 11 : diff > 0.06 ? 12 : diff > 0.03 ? 13 : 14;
                    setZoomTarget({ longitude: lng, latitude: lat, zoom });
                  }
                }} title="Zoom to layer">
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                    <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5"/>
                    <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                    <path d="M7 5v4M5 7h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                  </svg>
                </IconBtn>
                {/* Style */}
                <IconBtn onClick={() => onStyleLayer(layer.id)} title="Style layer">
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                    <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.8"/>
                    <path d="M8 1v2M8 13v2M1 8h2M13 8h2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                  </svg>
                </IconBtn>
                {/* Attribute table */}
                <IconBtn onClick={() => onShowAttrTable(layer.id)} title="Attribute table">
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                    <rect x="1.5" y="3" width="13" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
                    <path d="M1.5 7h13M5.5 7v6" stroke="currentColor" strokeWidth="1.5"/>
                  </svg>
                </IconBtn>
                {/* Delete — always visible, calls backend */}
                <IconBtn
                  onClick={() => { if (!isDeleting) void handleDelete(layer); }}
                  title="Delete layer"
                  danger
                >
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                    <path d="M2 4h12M5 4V2.5A.5.5 0 0 1 5.5 2h5a.5.5 0 0 1 .5.5V4M6 7v5M10 7v5M3 4l1 9.5A.5.5 0 0 0 4.5 14h7a.5.5 0 0 0 .5-.5L13 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </IconBtn>
              </div>
            </div>
            {ds && (
              <div style={{ marginLeft: 28, marginTop: 2, fontSize: 11, color: T.textLight, fontFamily: T.font }}>
                {ds.renderType ?? layer.type} · {ds.name}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Notes Tab ────────────────────────────────────────────────────────────────
function NotesTab() {
  const { annotations, mapPins, addAnnotation, updateAnnotation, removeAnnotation, removeMapPin } = useAppStore();
  const [text, setText] = useState("");
  const [color, setColor] = useState(ANNO_COLORS[0]);
  const [editId, setEditId] = useState<string|null>(null);
  const [editText, setEditText] = useState("");
  const [hovId, setHovId] = useState<string|null>(null);
  const [tab, setTab] = useState<"text"|"pins">("text");

  return (
    <div>
      <div style={{ display: "flex", borderBottom: `1px solid ${T.border}`, padding: "0 14px" }}>
        {(["text","pins"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: "8px 12px", background: "none", border: "none", cursor: "pointer",
            fontSize: 12, fontWeight: 600, fontFamily: T.font,
            color: tab === t ? T.text : T.textMuted,
            borderBottom: `2px solid ${tab === t ? T.text : "transparent"}`,
            marginBottom: -1, transition: "color 0.15s",
          }}>
            {t === "text" ? "✍ Text notes" : "📍 Map pins"}
            {t === "pins" && mapPins.length > 0 && (
              <span style={{ marginLeft: 5, background: T.orange, color: "white", borderRadius: 999, padding: "0 5px", fontSize: 10 }}>
                {mapPins.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === "text" && (
        <>
          <div style={{ padding: "12px 14px", borderBottom: `1px solid ${T.border}` }}>
            <textarea value={text} onChange={(e) => setText(e.target.value)}
              placeholder="Add a note…" rows={2}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (text.trim()) { addAnnotation({ id: uid(), text: text.trim(), color, createdAt: Date.now() }); setText(""); } } }}
              style={{
                width: "100%", fontSize: 13, fontFamily: T.font,
                border: `1.5px solid ${T.border}`, borderRadius: T.radiusSm,
                padding: "8px 10px", resize: "none", outline: "none",
                background: "rgba(0,0,0,0.02)", color: T.text, boxSizing: "border-box",
              }}
            />
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
              <div style={{ display: "flex", gap: 5, flex: 1 }}>
                {ANNO_COLORS.map((c) => (
                  <button key={c} onClick={() => setColor(c)} style={{
                    width: 18, height: 18, borderRadius: "50%", border: "none", cursor: "pointer",
                    background: c, padding: 0,
                    outline: color === c ? `2.5px solid ${c}` : "none", outlineOffset: 2,
                    transform: color === c ? "scale(1.2)" : "scale(1)", transition: "transform 0.12s",
                  }}/>
                ))}
              </div>
              <button onClick={() => { if (text.trim()) { addAnnotation({ id: uid(), text: text.trim(), color, createdAt: Date.now() }); setText(""); } }}
                disabled={!text.trim()}
                style={{
                  padding: "5px 14px", borderRadius: 8, border: "none",
                  cursor: text.trim() ? "pointer" : "not-allowed",
                  fontSize: 12, fontWeight: 600, fontFamily: T.font,
                  background: text.trim() ? T.text : "#e5e7eb",
                  color: text.trim() ? "white" : T.textLight,
                }}>Add</button>
            </div>
          </div>
          {annotations.length === 0
            ? <div style={{ padding: "20px 16px", textAlign: "center", color: T.textLight, fontSize: 13, fontFamily: T.font }}>No notes yet</div>
            : annotations.map((a: Annotation) => (
              <div key={a.id}
                onMouseEnter={() => setHovId(a.id)}
                onMouseLeave={() => setHovId(null)}
                style={{ padding: "10px 14px", background: hovId === a.id ? T.hover : "transparent", transition: "background 0.1s" }}>
                <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: a.color, marginTop: 5, flexShrink: 0 }}/>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {editId === a.id ? (
                      <div>
                        <textarea value={editText} onChange={(e) => setEditText(e.target.value)} rows={2} autoFocus
                          style={{ width: "100%", fontSize: 13, fontFamily: T.font, border: `1.5px solid ${T.accent}`, borderRadius: T.radiusXs, padding: "6px 8px", resize: "none", outline: "none", boxSizing: "border-box" }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (editText.trim()) { updateAnnotation(a.id, { text: editText.trim() }); setEditId(null); } }
                            if (e.key === "Escape") setEditId(null);
                          }}
                        />
                        <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                          <button onClick={() => { if (editText.trim()) { updateAnnotation(a.id, { text: editText.trim() }); setEditId(null); } }} style={{ fontSize: 11, fontWeight: 600, color: T.accent, background: "none", border: "none", cursor: "pointer", padding: 0, fontFamily: T.font }}>Save</button>
                          <button onClick={() => setEditId(null)} style={{ fontSize: 11, color: T.textMuted, background: "none", border: "none", cursor: "pointer", padding: 0, fontFamily: T.font }}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <p style={{ margin: 0, fontSize: 13, color: T.text, lineHeight: 1.45, wordBreak: "break-word", fontFamily: T.font }}>{a.text}</p>
                    )}
                    <div style={{ fontSize: 11, color: T.textLight, marginTop: 3, fontFamily: T.font }}>
                      {new Date(a.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 2, alignItems: "center" }}>
                    {/* Edit — only on hover */}
                    <div style={{ opacity: hovId === a.id ? 1 : 0, transition: "opacity 0.15s" }}>
                      <IconBtn onClick={() => { setEditId(a.id); setEditText(a.text); }} title="Edit">
                        <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
                          <path d="M11 2l3 3-9 9H2v-3L11 2z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
                        </svg>
                      </IconBtn>
                    </div>
                    {/* Delete — ALWAYS visible */}
                    <IconBtn onClick={() => removeAnnotation(a.id)} title="Delete" danger>
                      <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
                        <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                      </svg>
                    </IconBtn>
                  </div>
                  {/* <div style={{ display: "flex", gap: 1, opacity: hovId === a.id ? 1 : 0, transition: "opacity 0.15s" }}>
                    <IconBtn onClick={() => { setEditId(a.id); setEditText(a.text); }} title="Edit">
                      <svg width="11" height="11" viewBox="0 0 16 16" fill="none"><path d="M11 2l3 3-9 9H2v-3L11 2z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/></svg>
                    </IconBtn>
                    <IconBtn onClick={() => removeAnnotation(a.id)} title="Delete" danger>
                      <svg width="11" height="11" viewBox="0 0 16 16" fill="none"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
                    </IconBtn>
                  </div> */}
                </div>
              </div>
            ))
          }
        </>
      )}

      {tab === "pins" && (
        <div>
          {mapPins.length === 0 ? (
            <div style={{ padding: "24px 16px", textAlign: "center", color: T.textLight, fontSize: 13, fontFamily: T.font }}>
              <div style={{ fontSize: 22, marginBottom: 6 }}>📍</div>
              Select the <strong style={{ color: T.orange }}>Annotate</strong> tool and click the map to place pins
            </div>
          ) : (
            mapPins.map((pin: any) => (
              <div key={pin.id}
                onMouseEnter={() => setHovId(pin.id)}
                onMouseLeave={() => setHovId(null)}
                style={{ padding: "9px 14px", background: hovId === pin.id ? T.hover : "transparent", transition: "background 0.1s", display: "flex", alignItems: "center", gap: 10 }}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
                  <path d="M8 2C5.8 2 4 3.8 4 6c0 3 4 8 4 8s4-5 4-8c0-2.2-1.8-4-4-4z" fill={pin.color} stroke="white" strokeWidth="1"/>
                  <circle cx="8" cy="6" r="1.5" fill="white"/>
                </svg>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: T.text, fontFamily: T.font, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {pin.label || <span style={{ color: T.textLight, fontStyle: "italic" }}>Unlabelled pin</span>}
                  </div>
                  <div style={{ fontSize: 11, color: T.textLight, fontFamily: T.font }}>
                    {pin.lat.toFixed(4)}, {pin.lng.toFixed(4)}
                  </div>
                </div>
                <div style={{ opacity: hovId === pin.id ? 1 : 0, transition: "opacity 0.15s" }}>
                  <IconBtn onClick={() => removeMapPin(pin.id)} title="Remove pin" danger>
                    <svg width="11" height="11" viewBox="0 0 16 16" fill="none"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
                  </IconBtn>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ─── Style Dialog ─────────────────────────────────────────────────────────────
function StyleDialog({ layerId, onClose }: { layerId: string; onClose: () => void }) {
  const { layers, datasets, updateLayer } = useAppStore();
  const [minimized, setMinimized] = useState(false);
  const [tab, setTab] = useState<"style"|"symbology"|"filter">("style");
  const layer = layers.find((l) => l.id === layerId);
  if (!layer) return null;

  const ds = datasets.find((d) => d.id === layer.datasetId);
  const hex = rgbToHex(layer.color);
  const allowedTypes =
    ds?.renderType === "point"   ? ["circle"] :
    ds?.renderType === "line"    ? ["line"] :
    ds?.renderType === "polygon" ? ["fill","line"] : ["circle","line","fill"];
  const SWATCHES = ["#ef4444","#f97316","#eab308","#22c55e","#3b82f6","#8b5cf6","#ec4899","#14b8a6"];

  return (
    <Card style={{ width: 288 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderBottom: `1px solid ${T.border}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <LayerSwatch type={layer.type} color={hex} size={16}/>
          <span style={{ fontSize: 13, fontWeight: 600, color: T.text, fontFamily: T.font, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{layer.name}</span>
        </div>
        <div style={{ display: "flex", gap: 2, flexShrink: 0 }}>
          <IconBtn onClick={() => setMinimized(!minimized)}>
            {minimized
              ? <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              : <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M4 10l4-4 4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            }
          </IconBtn>
          <IconBtn onClick={onClose}>
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
          </IconBtn>
        </div>
      </div>

      {!minimized && (
        <>
          <div style={{ display: "flex", borderBottom: `1px solid ${T.border}` }}>
            {(["style","symbology","filter"] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)} style={{
                flex: 1, padding: "8px 0", background: "none", border: "none", cursor: "pointer",
                fontSize: 11, fontWeight: 600, fontFamily: T.font, textTransform: "capitalize",
                color: tab === t ? T.text : T.textMuted,
                borderBottom: `2px solid ${tab === t ? T.text : "transparent"}`,
                marginBottom: -1, transition: "color 0.15s",
              }}>{t}</button>
            ))}
          </div>

          {tab === "style" && (
            <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 12, fontWeight: 500, color: T.textMuted, fontFamily: T.font }}>Visible</span>
                <Toggle checked={layer.visible} onChange={(v) => updateLayer(layer.id, { visible: v })}/>
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 500, color: T.textMuted, fontFamily: T.font, marginBottom: 8 }}>Geometry type</div>
                <div style={{ display: "flex", gap: 4 }}>
                  {allowedTypes.map((t) => (
                    <button key={t} onClick={() => updateLayer(layer.id, { type: t as any })} style={{
                      flex: 1, padding: "6px 0", borderRadius: 8, border: "none", cursor: "pointer",
                      fontSize: 12, fontWeight: 600, fontFamily: T.font, textTransform: "capitalize",
                      background: layer.type === t ? T.text : "rgba(0,0,0,0.05)",
                      color: layer.type === t ? "white" : T.textMuted,
                    }}>{t}</button>
                  ))}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 500, color: T.textMuted, fontFamily: T.font, marginBottom: 8 }}>Colour</div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <input type="color" value={hex}
                    onChange={(e) => updateLayer(layer.id, { color: hexToRgb(e.target.value) })}
                    style={{ width: 38, height: 38, borderRadius: 8, border: `2px solid ${T.border}`, cursor: "pointer", padding: 2 }}
                  />
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                    {SWATCHES.map((c) => (
                      <button key={c} onClick={() => updateLayer(layer.id, { color: hexToRgb(c) })} style={{
                        width: 20, height: 20, borderRadius: "50%", border: "2.5px solid white",
                        background: c, cursor: "pointer", padding: 0,
                        boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                        transform: hex === c ? "scale(1.2)" : "scale(1)", transition: "transform 0.12s",
                      }}/>
                    ))}
                  </div>
                </div>
              </div>
              <div> 
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 500, color: T.textMuted, fontFamily: T.font }}>Opacity</span>
                  <span style={{ fontSize: 12, color: T.textMuted, fontFamily: T.font }}>{Math.round(layer.opacity * 100)}%</span>
                </div>
                <input type="range" min={0} max={1} step={0.01} value={layer.opacity}
                  onChange={(e) => updateLayer(layer.id, { opacity: Number(e.target.value) })}
                  style={{ width: "100%", accentColor: T.text }}
                />
              </div>
              <div style={{ borderTop: `1px solid ${T.border}`, paddingTop: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 500, color: T.textMuted, fontFamily: T.font, marginBottom: 8 }}>Preview</div>
                <div style={{ display: "flex", alignItems: "center", gap: 12, padding: 12, background: "rgba(0,0,0,0.03)", borderRadius: T.radiusSm }}>
                  <LayerSwatch type={layer.type} color={hex} size={24}/>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: T.text, fontFamily: T.font }}>{layer.name}</div>
                    <div style={{ fontSize: 11, color: T.textLight, fontFamily: T.font, textTransform: "capitalize" }}>{layer.type} · {Math.round(layer.opacity * 100)}% opacity</div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {tab === "symbology" && <SymbologyTab layer={layer} updateLayer={updateLayer}/>}
          {tab === "filter"    && <FilterTab layer={layer} updateLayer={updateLayer}/>}
        </>
      )}
    </Card>
  );
}

// ─── Symbology Tab ────────────────────────────────────────────────────────────
const MOCK_COLUMNS = ["status", "category", "value", "type", "name"];
const MOCK_VALUES: Record<string, string[]> = {
  status:   ["active", "inactive", "pending"],
  category: ["A", "B", "C", "D"],
  value:    [],
  type:     ["primary", "secondary", "tertiary"],
  name:     [],
};

function SymbologyTab({ layer, updateLayer }: { layer: any; updateLayer: any }) {
  const [mode, setMode]           = useState<"single"|"discrete"|"continuous">("single");
  const [attrCol, setAttrCol]     = useState(MOCK_COLUMNS[0]);
  const [discPalette, setDiscPalette] = useState("Tableau");
  const [contPalette, setContPalette] = useState("Blue");
  const isNumeric = (MOCK_VALUES[attrCol]?.length ?? 0) === 0;
  const discreteColors = DISCRETE_PALETTES[discPalette];
  const [contFrom, contTo] = CONTINUOUS_PALETTES[contPalette];
  const catValues = MOCK_VALUES[attrCol] ?? [];

  return (
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <div style={{ fontSize: 12, fontWeight: 500, color: T.textMuted, fontFamily: T.font, marginBottom: 8 }}>Colour by</div>
        <div style={{ display: "flex", gap: 4 }}>
          {(["single","discrete","continuous"] as const).map((m) => (
            <button key={m} onClick={() => setMode(m)} style={{
              flex: 1, padding: "5px 0", borderRadius: 8, border: "none", cursor: "pointer",
              fontSize: 11, fontWeight: 600, fontFamily: T.font, textTransform: "capitalize",
              background: mode === m ? T.text : "rgba(0,0,0,0.05)",
              color: mode === m ? "white" : T.textMuted,
            }}>{m}</button>
          ))}
        </div>
      </div>
      {mode !== "single" && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 500, color: T.textMuted, fontFamily: T.font, marginBottom: 6 }}>Attribute column</div>
          <select value={attrCol} onChange={(e) => setAttrCol(e.target.value)} style={{ width: "100%", padding: "6px 10px", borderRadius: 8, border: `1.5px solid ${T.border}`, fontSize: 13, fontFamily: T.font, background: "white", color: T.text, outline: "none", cursor: "pointer" }}>
            {MOCK_COLUMNS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      )}
      {mode === "single" && <div style={{ fontSize: 12, color: T.textMuted, fontFamily: T.font, padding: "8px 0" }}>Use the <strong>Style</strong> tab to set a single uniform colour.</div>}
      {mode === "discrete" && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 500, color: T.textMuted, fontFamily: T.font, marginBottom: 8 }}>Palette</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {Object.entries(DISCRETE_PALETTES).map(([name, colors]) => (
              <button key={name} onClick={() => setDiscPalette(name)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", borderRadius: 8, border: `2px solid ${discPalette === name ? T.accent : T.border}`, background: discPalette === name ? "rgba(37,99,235,0.06)" : "white", cursor: "pointer" }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: T.text, fontFamily: T.font, width: 50, textAlign: "left" }}>{name}</span>
                <div style={{ display: "flex", gap: 2, flex: 1 }}>
                  {colors.slice(0, 8).map((c, i) => <div key={i} style={{ width: 14, height: 14, borderRadius: 3, background: c, flexShrink: 0 }}/>)}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
      {mode === "continuous" && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 500, color: T.textMuted, fontFamily: T.font, marginBottom: 8 }}>Colour ramp</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {Object.entries(CONTINUOUS_PALETTES).map(([name, [from, to]]) => (
              <button key={name} onClick={() => setContPalette(name)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", borderRadius: 8, border: `2px solid ${contPalette === name ? T.accent : T.border}`, background: contPalette === name ? "rgba(37,99,235,0.06)" : "white", cursor: "pointer" }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: T.text, fontFamily: T.font, width: 50, textAlign: "left" }}>{name}</span>
                <div style={{ flex: 1, height: 14, borderRadius: 4, background: `linear-gradient(to right, ${from}, ${to})` }}/>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Filter Tab ───────────────────────────────────────────────────────────────
type FilterRule = { col: string; op: string; val: string };

function FilterTab({ layer, updateLayer }: { layer: any; updateLayer: any }) {
  const [rules, setRules] = useState<FilterRule[]>([]);
  const OPS = ["=", "≠", ">", "<", "≥", "≤", "contains", "is empty"];

  function addRule() { setRules((r) => [...r, { col: MOCK_COLUMNS[0], op: "=", val: "" }]); }
  function updateRule(i: number, patch: Partial<FilterRule>) { setRules((r) => r.map((rule, idx) => idx === i ? { ...rule, ...patch } : rule)); }
  function removeRule(i: number) { setRules((r) => r.filter((_, idx) => idx !== i)); }
  const activeCount = rules.filter((r) => r.val.trim() || r.op === "is empty").length;

  return (
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: T.text, fontFamily: T.font }}>Filter features</div>
          <div style={{ fontSize: 11, color: T.textLight, fontFamily: T.font, marginTop: 2 }}>Show only features matching all rules</div>
        </div>
        {activeCount > 0 && <span style={{ background: T.accent, color: "white", borderRadius: 999, padding: "2px 8px", fontSize: 11, fontWeight: 700, fontFamily: T.font }}>{activeCount} active</span>}
      </div>
      {rules.length === 0
        ? <div style={{ padding: "16px 0", textAlign: "center", color: T.textLight, fontSize: 13, fontFamily: T.font }}>No filters — all features shown</div>
        : <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {rules.map((rule, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr auto", gap: 5, alignItems: "center", padding: "8px 10px", background: "rgba(0,0,0,0.03)", borderRadius: T.radiusSm, border: `1px solid ${T.border}` }}>
              <select value={rule.col} onChange={(e) => updateRule(i, { col: e.target.value })} style={{ border: "none", background: "white", borderRadius: 6, padding: "4px 6px", fontSize: 12, fontFamily: T.font, color: T.text, outline: "none", cursor: "pointer", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>{MOCK_COLUMNS.map((c) => <option key={c} value={c}>{c}</option>)}</select>
              <select value={rule.op} onChange={(e) => updateRule(i, { op: e.target.value })} style={{ border: "none", background: T.text, color: "white", borderRadius: 6, padding: "4px 5px", fontSize: 12, fontFamily: T.font, outline: "none", cursor: "pointer" }}>{OPS.map((op) => <option key={op} value={op}>{op}</option>)}</select>
              {rule.op !== "is empty" ? <input value={rule.val} onChange={(e) => updateRule(i, { val: e.target.value })} placeholder="value…" style={{ border: "none", background: "white", borderRadius: 6, padding: "4px 8px", fontSize: 12, fontFamily: T.font, color: T.text, outline: "none", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}/> : <div/>}
              <IconBtn onClick={() => removeRule(i)} danger><svg width="11" height="11" viewBox="0 0 16 16" fill="none"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg></IconBtn>
            </div>
          ))}
        </div>
      }
      <button onClick={addRule} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "8px 0", borderRadius: 10, border: `1.5px dashed ${T.border}`, background: "transparent", cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: T.font, color: T.textMuted }}>
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
        Add filter rule
      </button>
      {rules.length > 0 && (
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => setRules([])} style={{ flex: 1, padding: "7px 0", borderRadius: 8, border: `1px solid ${T.border}`, background: "none", cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: T.font, color: T.textMuted }}>Clear all</button>
          <button style={{ flex: 2, padding: "7px 0", borderRadius: 8, border: "none", background: T.accent, cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: T.font, color: "white" }}>Apply filters</button>
        </div>
      )}
    </div>
  );
}


// ─── Attribute Table ──────────────────────────────────────────────────────────
const API_BASE = "http://localhost:8787";

function AttributeTable({ layerId, onClose, editMode }: {
  layerId: string;
  onClose: () => void;
  editMode: boolean;
}) {
  const { layers, datasets } = useAppStore();
  const [minimized, setMinimized]     = useState(false);
  const [rows, setRows]               = useState<Record<string, string>[]>([]);
  const [cols, setCols]               = useState<string[]>([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);
  const [editingCell, setEditingCell] = useState<{ fid: string; col: string } | null>(null);
  const [editingVal, setEditingVal]   = useState("");
  const [savingCell, setSavingCell]   = useState<{ fid: string; col: string } | null>(null);

  const layer   = layers.find((l) => l.id === layerId);
  const dataset = datasets.find((d) => d.id === layer?.datasetId);
  const table   = dataset?.renderType === "point" ? "points" : dataset?.renderType === "line" ? "lines" : "polygons";

  const loadRows = useCallback(() => {
    if (!dataset) return;
    setLoading(true);
    setError(null);
    fetch(`${API_BASE}/datasets/${dataset.id}/features?table=${table}`)
      .then((r) => r.json())
      .then((fc) => {
        const features = fc.features ?? [];
        const keySet = new Set<string>();
        features.forEach((f: any) => {
          Object.keys(f.properties ?? {}).forEach((k) => {
            if (!["_fid", "dataset_id", "_sanitized", "_pending", "_table", "_datasetId"].includes(k)) {
              keySet.add(k);
            }
          });
        });
        const allCols = Array.from(keySet);
        setCols(allCols);
        setRows(features.map((f: any) => {
          const row: Record<string, string> = { __fid: f.id ?? f.properties?._fid ?? "" };
          allCols.forEach((k) => { row[k] = String(f.properties?.[k] ?? ""); });
          return row;
        }));
      })
      .catch((e) => setError("Failed to load: " + (e?.message ?? "unknown")))
      .finally(() => setLoading(false));
  }, [dataset?.id, table]);

  useEffect(() => { loadRows(); }, [loadRows]);

  async function commitEdit(fid: string, col: string, val: string) {
    setSavingCell({ fid, col });
    try {
      // Get current props for this row so we do a full props merge
      const row = rows.find((r) => r.__fid === fid);
      if (!row) return;
      const props: Record<string, string> = {};
      cols.forEach((c) => { props[c] = c === col ? val : (row[c] ?? ""); });

      const res = await fetch(`${API_BASE}/features/${table}/${fid}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ properties: props }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      // Update local state immediately
      setRows((prev) => prev.map((r) => r.__fid === fid ? { ...r, [col]: val } : r));
    } catch (e: any) {
      setError("Save failed: " + (e?.message ?? "unknown"));
    } finally {
      setSavingCell(null);
      setEditingCell(null);
    }
  }

  function startEdit(fid: string, col: string, currentVal: string) {
    if (!editMode) return;
    setEditingCell({ fid, col });
    setEditingVal(currentVal);
  }

  if (!layer) return null;
  if (!dataset) return (
    <div style={{ background: T.card, borderTop: `1px solid ${T.border}`, padding: "14px 20px", fontFamily: T.font, fontSize: 13, color: T.red, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <span>⚠️ Dataset not found for this layer.</span>
      <IconBtn onClick={onClose}><svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg></IconBtn>
    </div>
  );

  return (
    <div style={{ background: T.card, backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)", borderTop: `1px solid ${T.border}`, boxShadow: "0 -4px 24px rgba(0,0,0,0.08)", fontFamily: T.font, height: minimized ? 44 : 260, transition: "height 0.25s ease", overflow: "hidden", display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 20px", height: 44, borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{layer.name}</span>
          <span style={{ fontSize: 11, color: T.textMuted, background: "rgba(0,0,0,0.06)", padding: "2px 8px", borderRadius: 999, fontWeight: 500 }}>
            {loading ? "…" : `${rows.length} features`}
          </span>
          {editMode && (
            <span style={{ fontSize: 11, color: T.green, background: "rgba(16,185,129,0.1)", padding: "2px 8px", borderRadius: 999, fontWeight: 600 }}>
              ✏️ Editing — click any cell to edit
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: 2 }}>
          <IconBtn onClick={() => loadRows()} title="Refresh">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M13 8A5 5 0 1 1 8 3a5 5 0 0 1 3.5 1.5L13 6V2m0 4H9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </IconBtn>
          <IconBtn onClick={() => setMinimized(!minimized)} title={minimized ? "Expand" : "Minimise"}>
            {minimized
              ? <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M4 10l4-4 4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              : <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            }
          </IconBtn>
          <IconBtn onClick={onClose}><svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg></IconBtn>
        </div>
      </div>

      {/* Body */}
      {!minimized && (
        <div style={{ overflowX: "auto", overflowY: "auto", flex: 1 }}>
          {loading ? (
            <div style={{ padding: "20px", textAlign: "center", color: T.textLight, fontSize: 12 }}>Loading…</div>
          ) : error ? (
            <div style={{ padding: "20px", textAlign: "center", color: T.red, fontSize: 12 }}>{error}</div>
          ) : rows.length === 0 ? (
            <div style={{ padding: "20px", textAlign: "center", color: T.textLight, fontSize: 12 }}>No features found</div>
          ) : (
            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12, fontFamily: T.font }}>
              <thead>
                <tr>
                  <th style={{ padding: "6px 16px", textAlign: "left", color: T.textLight, fontWeight: 600, whiteSpace: "nowrap", background: T.card, borderBottom: `1px solid ${T.border}`, position: "sticky", top: 0 }}>fid</th>
                  {cols.map((col) => (
                    <th key={col} style={{ padding: "6px 16px", textAlign: "left", color: T.textLight, fontWeight: 600, whiteSpace: "nowrap", background: T.card, borderBottom: `1px solid ${T.border}`, position: "sticky", top: 0 }}>{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={row.__fid}
                    style={{ background: i % 2 === 1 ? "rgba(0,0,0,0.015)" : "transparent" }}
                  >
                    <td style={{ padding: "6px 16px", color: T.textLight, borderBottom: `1px solid ${T.border}`, whiteSpace: "nowrap", fontFamily: "monospace", fontSize: 11 }}>
                      {row.__fid?.slice(0, 8)}…
                    </td>
                    {cols.map((col) => {
                      const isEditingThis = editingCell?.fid === row.__fid && editingCell?.col === col;
                      const isSaving = savingCell?.fid === row.__fid && savingCell?.col === col;
                      return (
                        <td key={col}
                          onClick={() => !isEditingThis && startEdit(row.__fid, col, row[col] ?? "")}
                          style={{
                            padding: "0",
                            borderBottom: `1px solid ${T.border}`,
                            whiteSpace: "nowrap",
                            cursor: editMode ? "text" : "default",
                            background: isEditingThis ? "rgba(37,99,235,0.06)" : "transparent",
                            minWidth: 100,
                          }}
                        >
                          {isEditingThis ? (
                            <input
                              autoFocus
                              value={editingVal}
                              onChange={(e) => setEditingVal(e.target.value)}
                              onBlur={() => commitEdit(row.__fid, col, editingVal)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") commitEdit(row.__fid, col, editingVal);
                                if (e.key === "Escape") setEditingCell(null);
                              }}
                              style={{
                                width: "100%", padding: "6px 16px", border: "none",
                                outline: `2px solid ${T.accent}`, background: "white",
                                fontSize: 12, fontFamily: T.font, color: T.text,
                                boxSizing: "border-box",
                              }}
                            />
                          ) : (
                            <div style={{ padding: "6px 16px", color: isSaving ? T.textLight : T.text, minHeight: 30 }}>
                              {isSaving ? "Saving…" : (row[col] || <span style={{ color: T.textLight, fontStyle: "italic" }}>empty</span>)}
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Scale Bar ────────────────────────────────────────────────────────────────
function ScaleBar({ zoom, latitude }: { zoom: number; latitude: number }) {
  const mpp = (156543.03392 * Math.cos((latitude * Math.PI) / 180)) / Math.pow(2, zoom);
  const raw = mpp * 100;
  let val: number; let unit: string;
  if (raw >= 1000) {
    const km = raw / 1000;
    val = km >= 100 ? Math.round(km/50)*50 : km >= 10 ? Math.round(km/5)*5 : Math.round(km);
    unit = "km";
  } else {
    val = raw >= 100 ? Math.round(raw/50)*50 : raw >= 10 ? Math.round(raw/5)*5 : Math.max(1, Math.round(raw));
    unit = "m";
  }
  const barW = Math.round((unit === "km" ? val * 1000 : val) / mpp);
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", fontFamily: T.font }}>
      <div style={{ width: barW }}>
        <div style={{ height: 2, background: "#374151", width: "100%", borderRadius: 1 }}/>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <div style={{ width: 1.5, height: 6, background: "#374151" }}/><div style={{ width: 1.5, height: 6, background: "#374151" }}/>
        </div>
      </div>
      <div style={{ fontSize: 11, fontWeight: 600, color: "#374151", marginTop: 2 }}>{val} {unit}</div>
    </div>
  );
}

// ─── Edit Mode Panel ──────────────────────────────────────────────────────────
function EditModePanel() {
  const { datasets, activeDatasetId, setActiveDatasetId } = useAppStore();
  const [open, setOpen] = useState(false);
  const [hov, setHov]   = useState(false);
  const isEditing = activeDatasetId !== null;
  const editableDatasets = datasets.filter((d) => d.renderType && d.renderType !== "mixed");

  function handleSelect(id: string) {
    setActiveDatasetId(activeDatasetId === id ? null : id);
    setOpen(false);
  }

  if (isEditing) {
    return (
      <button onClick={() => setActiveDatasetId(null)}
        onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
        style={{ display: "flex", alignItems: "center", gap: 7, padding: "8px 18px", borderRadius: 12, border: "none", cursor: "pointer", fontFamily: T.font, fontSize: 13, fontWeight: 600, background: hov ? "#059669" : T.green, color: "white", boxShadow: "0 4px 16px rgba(16,185,129,0.35)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)", transition: "background 0.15s" }}>
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M2 8l4 4 8-8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
        Done editing
      </button>
    );
  }

  return (
    <div style={{ position: "relative" }}>
      <button onClick={() => setOpen((o) => !o)}
        onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
        style={{ display: "flex", alignItems: "center", gap: 7, padding: "8px 16px", borderRadius: 12, border: `1px solid ${T.border}`, cursor: "pointer", fontFamily: T.font, fontSize: 13, fontWeight: 600, background: open ? T.text : hov ? "rgba(255,255,255,1)" : T.card, color: open ? "white" : T.text, boxShadow: T.shadow, backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)", transition: "background 0.15s" }}>
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M11 2l3 3-9 9H2v-3L11 2z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/></svg>
        Edit
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" style={{ marginLeft: 2, transition: "transform 0.2s", transform: open ? "rotate(180deg)" : "rotate(0deg)" }}><path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
      </button>
      {open && (
        <div style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, width: 260, zIndex: 100, background: T.card, backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)", borderRadius: T.radius, border: `1px solid ${T.border}`, boxShadow: "0 8px 32px rgba(0,0,0,0.14)", fontFamily: T.font, overflow: "hidden" }}>
          <div style={{ padding: "10px 14px", borderBottom: `1px solid ${T.border}` }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: T.text }}>Edit a layer</div>
            <div style={{ fontSize: 11, color: T.textLight, marginTop: 2 }}>Select a dataset to add, move, reshape, or delete features</div>
          </div>
          {editableDatasets.length === 0 ? (
            <div style={{ padding: "20px 14px", textAlign: "center", color: T.textLight, fontSize: 13 }}>
              <div style={{ fontSize: 20, marginBottom: 6 }}>✏️</div>
              No editable layers on map yet.
            </div>
          ) : (
            <div style={{ padding: "6px 0" }}>
              {editableDatasets.map((ds) => {
                const isActive = activeDatasetId === ds.id;
                return (
                  <button key={ds.id} onClick={() => handleSelect(ds.id)}
                    style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: isActive ? "rgba(37,99,235,0.08)" : "transparent", border: "none", cursor: "pointer", textAlign: "left", transition: "background 0.1s" }}
                    onMouseEnter={(e) => { if (!isActive) (e.currentTarget as HTMLElement).style.background = T.hover; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = isActive ? "rgba(37,99,235,0.08)" : "transparent"; }}>
                    <div style={{ width: 28, height: 28, borderRadius: 8, flexShrink: 0, background: ds.renderType === "polygon" ? "rgba(16,185,129,0.1)" : ds.renderType === "line" ? "rgba(245,158,11,0.1)" : "rgba(59,130,246,0.1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {ds.renderType === "polygon" && <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M8 2L14 6v4L8 14 2 10V6z" fill="#10b981" stroke="white" strokeWidth="1.2"/></svg>}
                      {ds.renderType === "line"    && <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M2 13L7 4l3 5 2-3 2 5" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                      {ds.renderType === "point"   && <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="5" fill="#3b82f6" stroke="white" strokeWidth="1.5"/></svg>}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ds.name}</div>
                      <div style={{ fontSize: 11, color: T.textLight, marginTop: 1 }}>{ds.renderType} layer</div>
                    </div>
                    {isActive && <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 8l4 4 8-8" stroke={T.accent} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Root FeltUI overlay ──────────────────────────────────────────────────────
export function FeltUI() {
  const { viewState, activeDatasetId, datasets } = useAppStore();
  const [styleLayerId, setStyleLayerId] = useState<string|null>(null);
  const [attrLayerId, setAttrLayerId]   = useState<string|null>(null);

  const handleStyle = useCallback((id: string) => setStyleLayerId((p) => p === id ? null : id), []);
  const handleAttr  = useCallback((id: string) => setAttrLayerId((p) => p === id ? null : id), []);

  const isEditing = activeDatasetId !== null;
  const activeDs  = datasets.find((d) => d.id === activeDatasetId);
  const attrH     = attrLayerId ? 220 : 0;

  return (
    <>
      {/* Attribute table — docked to bottom */}
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, zIndex: 30 }}>
        {attrLayerId && <AttributeTable layerId={attrLayerId} onClose={() => setAttrLayerId(null)} editMode={isEditing}/>}
      </div>

      {/* Scale bar — bottom left */}
      <div style={{ position: "absolute", bottom: attrH + 12, left: 16, zIndex: 20, transition: "bottom 0.25s ease" }}>
        <div style={{ background: "rgba(255,255,255,0.88)", backdropFilter: "blur(8px)", padding: "6px 12px", borderRadius: 10, boxShadow: "0 1px 6px rgba(0,0,0,0.1)", border: `1px solid ${T.border}` }}>
          <ScaleBar zoom={viewState.zoom} latitude={viewState.latitude}/>
        </div>
      </div>

      {/* Legend panel — bottom left, above scale bar */}
      <div style={{ position: "absolute", bottom: attrH + 72, left: 16, zIndex: 20, transition: "bottom 0.25s ease" }}>
        <LegendPanel onStyleLayer={handleStyle} onShowAttrTable={handleAttr} editMode={isEditing}/>
      </div>

      {/* Style dialog — right side */}
      {styleLayerId && (
        <div style={{ position: "absolute", top: 64, right: 16, zIndex: 20 }}>
          <StyleDialog layerId={styleLayerId} onClose={() => setStyleLayerId(null)}/>
        </div>
      )}

      {/* Toolbar — top centre */}
      <div style={{ position: "absolute", top: 16, left: "50%", transform: "translateX(-50%)", zIndex: 25, pointerEvents: "auto" }}>
        <MapToolbar />
      </div>

      {/* Edit panel — top right */}
      <div style={{ position: "absolute", top: 16, right: 16, zIndex: 25 }}>
        <EditModePanel />
      </div>

      {/* Active edit banner */}
      {isEditing && activeDs && (
        <div style={{ position: "absolute", top: 60, left: "50%", transform: "translateX(-50%)", zIndex: 20, background: T.green, color: "white", padding: "7px 18px", borderRadius: 12, fontSize: 12, fontWeight: 600, fontFamily: T.font, display: "flex", alignItems: "center", gap: 8, boxShadow: "0 4px 16px rgba(16,185,129,0.35)", whiteSpace: "nowrap" }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "white", flexShrink: 0, animation: "felt-pulse 1.5s infinite" }}/>
          Editing: <strong style={{ marginLeft: 2 }}>{activeDs.name}</strong>
          <span style={{ opacity: 0.75, fontWeight: 400, fontSize: 11 }}>· Load → add / click to select → edit attrs or delete</span>
        </div>
      )}

      <style>{`@keyframes felt-pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.5;transform:scale(0.8)} }`}</style>
    </>
  );
}
