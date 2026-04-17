import React, { useState, useCallback, useEffect } from "react";
import { useAppStore, type Annotation, type ActiveTool } from "./store";
import { UploadPanel } from "./panels/UploadPanel";
import { createPortal } from "react-dom";

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
const CAT_PALETTES: Record<string, string[]> = {
  "Felt":    ["#e63946","#f4a261","#2a9d8f","#457b9d","#8338ec","#fb5607","#3a86ff","#06d6a0","#ffbe0b","#ff006e"],
  "Tableau": ["#4e79a7","#f28e2b","#e15759","#76b7b2","#59a14f","#edc948","#b07aa1","#ff9da7","#9c755f","#bab0ac"],
  "QGIS":   ["#1f78b4","#33a02c","#e31a1c","#ff7f00","#6a3d9a","#b15928","#a6cee3","#b2df8a","#fb9a99","#fdbf6f"],
  "Pastel":  ["#aec6cf","#ffb347","#b5ead7","#c7ceea","#ffdac1","#e2f0cb","#ff9aa2","#f8d9d9","#c4faf8","#dcd3ff"],
  "Bold":    ["#e41a1c","#377eb8","#4daf4a","#984ea3","#ff7f00","#a65628","#f781bf","#999999","#66c2a5","#fc8d62"],
};

const RAMP_PALETTES: Record<string, string[]> = {
  "Blues":    ["#f7fbff","#c6dbef","#6baed6","#2171b5","#084594"],
  "Greens":   ["#f7fcf5","#c7e9c0","#74c476","#238b45","#00441b"],
  "Greys":    ["#ffffff","#d9d9d9","#969696","#525252","#000000"],
  "Reds":     ["#fff5f0","#fcbba1","#fb6a4a","#cb181d","#67000d"],
  "Viridis":  ["#fde725","#7ad151","#22a884","#2a788e","#414487","#440154"],
  "Magma":    ["#fcfdbf","#feca8d","#fd9668","#de4968","#9b179e","#000004"],
  "Inferno":  ["#fcffa4","#f7d13d","#fb9b06","#d44842","#8d0a6d","#000004"],
  "Plasma":   ["#f0f921","#fca636","#e16462","#b12a90","#6a00a8","#0d0887"],
  "Cividis":  ["#fde737","#9fda3a","#4ac16d","#1fa187","#277f8e","#365c8d","#46327e","#440154"],
  "Spectral": ["#d53e4f","#f46d43","#fdae61","#ffffbf","#abdda4","#66c2a5","#3288bd"],
  "RdYlGn":  ["#d73027","#f46d43","#fee08b","#d9ef8b","#66bd63","#1a9850"],
  "Turbo":    ["#23171b","#4a58dd","#2af5b0","#a8fc3b","#fca50a","#bf3d1e"],
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

// ─── Layer Legend (symbology summary in layer list) ───────────────────────────
function LayerLegend({ layer, ds }: { layer: any; ds: any }) {
  const sym = layer.symbology;
  const hex = rgbToHex(layer.color);

  if (!sym || sym.mode === "single") {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 5, paddingLeft: 28 }}>
        <LayerSwatch type={layer.type} color={hex} size={11} />
        <span style={{ fontSize: 11, color: T.textMuted, fontFamily: T.font }}>Single symbol</span>
      </div>
    );
  }

  if (sym.mode === "categorized" && sym.values?.length) {
    return (
      <div style={{ marginTop: 5, paddingLeft: 28, display: "flex", flexDirection: "column", gap: 3, maxHeight: 110, overflowY: "auto", scrollbarWidth: "thin" }}>
        {(sym.values as string[]).map((val: string, i: number) => (
          <div key={val} style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
            <LayerSwatch type={layer.type} color={sym.colors[i % sym.colors.length]} size={11} />
            <span style={{
              fontSize: 11, color: T.textMuted, fontFamily: T.font,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 160,
            }}>
              {val || "No Data"}
            </span>
          </div>
        ))}
      </div>
    );
  }

  if (sym.mode === "graduated" && sym.colors?.length) {
    return (
      <div style={{ marginTop: 5, paddingLeft: 28 }}>
        <div style={{
          height: 8, borderRadius: 4, width: "80%", maxWidth: 160,
          background: `linear-gradient(to right, ${sym.colors.join(", ")})`,
        }} />
        <div style={{ display: "flex", justifyContent: "space-between", maxWidth: 160, marginTop: 2 }}>
          <span style={{ fontSize: 10, color: T.textLight, fontFamily: T.font }}>{sym.min ?? 0}</span>
          <span style={{ fontSize: 10, color: T.textLight, fontFamily: T.font }}>{sym.max ?? 100}</span>
        </div>
      </div>
    );
  }

  return null;
}

// ─── Layer Context Menu ───────────────────────────────────────────────────────
function LayerContextMenu({
  x, y, layer, ds, editMode,
  onClose, onZoom, onStyle, onAttrTable, onDelete,
}: {
  x: number; y: number; layer: any; ds: any; editMode: boolean;
  onClose: () => void; onZoom: () => void; onStyle: () => void;
  onAttrTable: () => void; onDelete: () => void;
}) {
  useEffect(() => {
    const close = () => onClose();
    const id = setTimeout(() => {
      window.addEventListener("click", close);
      window.addEventListener("contextmenu", close);
    }, 10);
    return () => {
      clearTimeout(id);
      window.removeEventListener("click", close);
      window.removeEventListener("contextmenu", close);
    };
  }, [onClose]);

  async function handleExport() {
    if (!ds) return;
    const table = ds.renderType === "point" ? "points" : ds.renderType === "line" ? "lines" : "polygons";
    try {
      const res = await fetch(`${API}/datasets/${ds.datasetId}/features?table=${table}`);
      const fc = await res.json();
      const blob = new Blob([JSON.stringify(fc, null, 2)], { type: "application/geo+json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `${ds.name.replace(/\.[^.]+$/, "")}.geojson`; a.click();
      URL.revokeObjectURL(url);
    } catch (e) { console.error("Export failed:", e); }
    onClose();
  }

  type MenuItem = { label: string; icon: React.ReactNode; onClick: () => void; danger?: boolean };

  const items: MenuItem[] = [
    {
      label: "Zoom to layer",
      icon: <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5"/><path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/><path d="M7 5v4M5 7h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>,
      onClick: () => { onZoom(); onClose(); },
    },
    {
      label: "Style layer",
      icon: <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="12" height="3" rx="1" fill="currentColor" opacity="0.9"/><rect x="2" y="6.5" width="12" height="3" rx="1" fill="currentColor" opacity="0.6"/><rect x="2" y="11" width="12" height="3" rx="1" fill="currentColor" opacity="0.3"/></svg>,
      onClick: () => { onStyle(); onClose(); },
    },
    {
      label: "Attribute table",
      icon: <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><rect x="1.5" y="3" width="13" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.5"/><path d="M1.5 7h13M5.5 7v6" stroke="currentColor" strokeWidth="1.5"/></svg>,
      onClick: () => { onAttrTable(); onClose(); },
    },
    ...(!editMode ? [{
      label: "Export as GeoJSON",
      icon: <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M8 2v8M5 7l3 3 3-3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/><path d="M3 11v2h10v-2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>,
      onClick: handleExport,
    }] : []),
    {
      label: "Delete layer",
      icon: <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M2 4h12M5 4V2.5A.5.5 0 0 1 5.5 2h5a.5.5 0 0 1 .5.5V4M6 7v5M10 7v5M3 4l1 9.5A.5.5 0 0 0 4.5 14h7a.5.5 0 0 0 .5-.5L13 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>,
      onClick: () => { onDelete(); onClose(); },
      danger: true,
    },
  ];

  return createPortal(
    <div
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        position: "fixed",
        top: y,
        left: Math.max(8, Math.min(x, window.innerWidth - 195)),
        zIndex: 9999,
        background: "rgba(255,255,255,0.97)", backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)", borderRadius: 10,
        border: "1px solid rgba(0,0,0,0.08)",
        boxShadow: "0 8px 32px rgba(0,0,0,0.14)", minWidth: 185, overflow: "hidden",
        fontFamily: T.font,
      }}
    >
      <div style={{
        padding: "6px 12px", borderBottom: "1px solid rgba(0,0,0,0.06)",
        fontSize: 11, fontWeight: 600, color: T.textLight,
        textTransform: "uppercase", letterSpacing: "0.04em",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>
        {layer.name}
      </div>
      {items.map((item) => (
        <button key={item.label} onClick={item.onClick}
          style={{
            display: "flex", alignItems: "center", gap: 9,
            width: "100%", padding: "8px 12px",
            background: "none", border: "none", cursor: "pointer",
            fontSize: 13, fontFamily: T.font, textAlign: "left",
            color: item.danger ? T.red : T.text,
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = item.danger ? "rgba(239,68,68,0.06)" : T.hover; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "none"; }}
        >
          <span style={{ color: item.danger ? T.red : T.textMuted, lineHeight: 0 }}>{item.icon}</span>
          {item.label}
        </button>
      ))}
    </div>,
    document.body
  );
}

// ─── Map Context Menu ─────────────────────────────────────────────────────────
function MapContextMenu({
  x, y, lat, lng, onClose, onAddAnnotation,
}: {
  x: number; y: number; lat: number; lng: number;
  onClose: () => void;
  onAddAnnotation: (lat: number, lng: number, label?: string) => void; 
}) {
  useEffect(() => {
    const close = () => onClose();
    const id = setTimeout(() => {
      window.addEventListener("click", close);
      window.addEventListener("contextmenu", close);
    }, 50);
    return () => {
      clearTimeout(id);
      window.removeEventListener("click", close);
      window.removeEventListener("contextmenu", close);
    };
  }, [onClose]);

  const coordStr = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;

  async function handlePaste() {
    try {
      const text = await navigator.clipboard.readText();
      if (text.trim()) {
        onAddAnnotation(lat, lng, text.trim());
      }
    } catch {
      console.warn("Clipboard read denied");
    }
    onClose();
  }

  type Section = { label: string; icon: React.ReactNode; onClick: () => void; meta?: string }[];

  const sections: Section[] = [
    [
      {
        label: coordStr,
        icon: <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="7" r="5" stroke="currentColor" strokeWidth="1.4"/><path d="M8 4v3l2 2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>,
        onClick: () => { navigator.clipboard.writeText(coordStr).catch(() => {}); onClose(); },
        meta: "Copy",
      },
    ],
    [
      {
        label: "Add comment / annotation",
        icon: <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M8 2C5.8 2 4 3.8 4 6c0 3 4 8 4 8s4-5 4-8c0-2.2-1.8-4-4-4z" fill="#f97316"/><circle cx="8" cy="6" r="1.5" fill="white"/></svg>,
        onClick: () => { onAddAnnotation(lat, lng); onClose(); },
      },
      {
        label: "Paste here",
        icon: <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><rect x="4" y="2" width="8" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.4"/><path d="M6 2v2h4V2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>,
        onClick: handlePaste,
        meta: "⌘V",
      },
    ],
    [
      {
        label: "Open in Google Maps",
        icon: <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M8 1.5C5.5 1.5 3.5 3.5 3.5 6c0 3.7 4.5 8.5 4.5 8.5S12.5 9.7 12.5 6c0-2.5-2-4.5-4.5-4.5z" stroke="#4285f4" strokeWidth="1.3" fill="#4285f415"/><circle cx="8" cy="6" r="1.8" fill="#4285f4"/></svg>,
        onClick: () => { window.open(`https://www.google.com/maps?q=${lat},${lng}`, "_blank"); onClose(); },
      },
      {
        label: "Google Street View",
        icon: <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="5" r="2.5" stroke="#0f9d58" strokeWidth="1.3" fill="#0f9d5815"/><path d="M4 14c0-3 1.8-5 4-5s4 2 4 5" stroke="#0f9d58" strokeWidth="1.3" strokeLinecap="round"/></svg>,
        onClick: () => { window.open(`https://www.google.com/maps?layer=c&cbll=${lat},${lng}`, "_blank"); onClose(); },
      },
      {
        label: "OpenStreetMap",
        icon: <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="12" height="12" rx="2" stroke="#7ebc6f" strokeWidth="1.3" fill="#7ebc6f15"/><path d="M5 11l2-6 2 4 1-2 2 4" stroke="#7ebc6f" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>,
        onClick: () => { window.open(`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=15/${lat}/${lng}`, "_blank"); onClose(); },
      },
    ],
  ];

  // Clamp so menu doesn't overflow viewport
  const menuW = 230, menuH = 220;
  const cx = Math.min(x, window.innerWidth - menuW - 8);
  const cy = y + menuH > window.innerHeight - 8
    ? y - menuH          // ← flip upward if it would overflow bottom
    : y;
  return (
    <div
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        position: "fixed", top: cy, left: cx, zIndex: 9999,
        background: "rgba(255,255,255,0.97)", backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)", borderRadius: 12,
        border: "1px solid rgba(0,0,0,0.08)",
        boxShadow: "0 8px 32px rgba(0,0,0,0.14), 0 1px 4px rgba(0,0,0,0.08)",
        minWidth: menuW, overflow: "hidden", fontFamily: T.font,
      }}
    >
      {sections.map((group, gi) => (
        <React.Fragment key={gi}>
          {gi > 0 && <div style={{ height: 1, background: "rgba(0,0,0,0.06)" }} />}
          {group.map((item) => (
            <button key={item.label} onClick={item.onClick}
              style={{
                display: "flex", alignItems: "center", gap: 9,
                width: "100%", padding: "8px 14px",
                background: "none", border: "none", cursor: "pointer",
                fontSize: gi === 0 ? 11 : 13, fontFamily: T.font, textAlign: "left",
                color: gi === 0 ? T.textMuted : T.text,
                fontVariantNumeric: "tabular-nums",
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = T.hover; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "none"; }}
            >
              <span style={{ lineHeight: 0, flexShrink: 0 }}>{item.icon}</span>
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {item.label}
              </span>
              {item.meta && (
                <span style={{ fontSize: 10, color: T.textLight, flexShrink: 0 }}>{item.meta}</span>
              )}
            </button>
          ))}
        </React.Fragment>
      ))}
    </div>
  );
}

// ─── Icon button ──────────────────────────────────────────────────────────────
function IconBtn({ onClick, title, children, danger = false, active = false }: {
  onClick: () => void; title?: string; children: React.ReactNode;
  danger?: boolean; active?: boolean;
}) {
  const [hov, setHov] = useState(false);
  return (
    <div style={{ position: "relative", display: "inline-flex" }}>
      <button onClick={onClick}
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
      {hov && title && (
        <div style={{
          position: "absolute",
          bottom: "calc(100% + 6px)",
          left: "50%",
          transform: "translateX(-50%)",
          background: "rgba(17,19,22,0.95)",
          color: "#e7eaf0",
          fontSize: 11,
          fontWeight: 500,
          fontFamily: T.font,
          padding: "4px 8px",
          borderRadius: 6,
          whiteSpace: "nowrap",
          pointerEvents: "none",
          zIndex: 9999,
          boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
          border: "1px solid rgba(255,255,255,0.08)",
        }}>
          {title}
          <div style={{
            position: "absolute",
            top: "100%", left: "50%",
            transform: "translateX(-50%)",
            width: 0, height: 0,
            borderLeft: "4px solid transparent",
            borderRight: "4px solid transparent",
            borderTop: "4px solid rgba(17,19,22,0.95)",
          }}/>
        </div>
      )}
    </div>
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
  const [ctxMenu, setCtxMenu] = useState<{ layerId: string; x: number; y: number } | null>(null);

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
    } catch (e) { console.error("Delete failed:", e); }
    finally { removeLayer(layer.id); removeDataset(datasetId); setDeleting(null); }
  }

  function handleZoom(layer: any, ds: any) {
    if (!ds?.bounds) return;
    const [minLng, minLat, maxLng, maxLat] = ds.bounds;
    const lng = (minLng + maxLng) / 2, lat = (minLat + maxLat) / 2;
    const diff = Math.max(Math.abs(maxLng - minLng), Math.abs(maxLat - minLat), 0.001);
    const zoom = diff > 60 ? 2 : diff > 30 ? 3 : diff > 15 ? 4 : diff > 8 ? 5 : diff > 4 ? 6 : diff > 2 ? 7 : diff > 1 ? 8 : diff > 0.5 ? 9 : diff > 0.25 ? 10 : diff > 0.12 ? 11 : diff > 0.06 ? 12 : diff > 0.03 ? 13 : 14;
    setZoomTarget({ longitude: lng, latitude: lat, zoom });
  }

  const ctxLayer = ctxMenu ? layers.find((l: any) => l.id === ctxMenu.layerId) : null;
  const ctxDs = ctxLayer ? datasets.find((d: any) => d.id === ctxLayer.datasetId) : null;

  return (
    <div style={{ padding: "6px 0" }}>
      {ctxMenu && ctxLayer && (
        <LayerContextMenu
          x={ctxMenu.x} y={ctxMenu.y}
          layer={ctxLayer} ds={ctxDs} editMode={editMode}
          onClose={() => setCtxMenu(null)}
          onZoom={() => handleZoom(ctxLayer, ctxDs)}
          onStyle={() => onStyleLayer(ctxLayer.id)}
          onAttrTable={() => onShowAttrTable(ctxLayer.id)}
          onDelete={() => handleDelete(ctxLayer)}
        />
      )}

      {layers.map((layer: any) => {
        const ds = datasets.find((d: any) => d.id === layer.datasetId);
        const hex = rgbToHex(layer.color);
        const isHov = hovId === layer.id;
        const isDeleting = deleting === layer.id;

        return (
          <div key={layer.id}
            onMouseEnter={() => setHovId(layer.id)}
            onMouseLeave={() => setHovId(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              const menuHeight = 36 + (editMode ? 4 : 5) * 37;
              const y = e.clientY + menuHeight > window.innerHeight - 8
                ? e.clientY - menuHeight   // flip up
                : e.clientY;               // open down
              setCtxMenu({ layerId: layer.id, x: e.clientX, y });
            }}
            style={{
              padding: "8px 14px 10px",
              background: isHov ? T.hover : "transparent",
              transition: "background 0.1s",
              opacity: isDeleting ? 0.4 : 1,
              borderBottom: `1px solid ${T.border}`,
            }}
          >
            {/* Row: eye toggle + name + ⋯ button */}
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button
                onClick={() => updateLayer(layer.id, { visible: !layer.visible })}
                style={{ background: "none", border: "none", cursor: "pointer", padding: 0, lineHeight: 0, flexShrink: 0 }}
                title={layer.visible ? "Hide layer" : "Show layer"}
              >
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
                fontSize: 13, fontWeight: 500, flex: 1,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                color: layer.visible ? T.text : T.textLight, fontFamily: T.font,
              }} title={layer.name}>
                {layer.name}
              </span>

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  const menuHeight = 36 + (editMode ? 4 : 5) * 37;
                  setCtxMenu({
                    layerId: layer.id,
                    x: rect.right + 4,
                    y: rect.bottom - menuHeight,  // bottom of menu aligns with button
                  });
                }}
                style={{
                  opacity: isHov ? 1 : 0,
                  transition: "opacity 0.15s",
                  background: "none", border: "none", cursor: "pointer",
                  padding: 4, borderRadius: 6, color: "#6b7280", flexShrink: 0,
                  display: "flex", alignItems: "center",
                }}
                title="Layer options"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <circle cx="3" cy="8" r="1.5" fill="currentColor"/>
                  <circle cx="8" cy="8" r="1.5" fill="currentColor"/>
                  <circle cx="13" cy="8" r="1.5" fill="currentColor"/>
                </svg>
              </button>
            </div>

            {/* Symbology legend */}
            <LayerLegend layer={layer} ds={ds} />
          </div>
        );
      })}
    </div>
  );
}

// ─── Notes Tab ────────────────────────────────────────────────────────────────
function NotesTab() {
  const { annotations, mapPins, addAnnotation, updateAnnotation, removeAnnotation, removeMapPin, updateMapPin } = useAppStore();
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
                  {editId === pin.id ? (
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <input
                        autoFocus
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") { updateMapPin(pin.id, { label: editText }); setEditId(null); }
                          if (e.key === "Escape") setEditId(null);
                        }}
                        style={{
                          flex: 1, fontSize: 13, fontFamily: T.font,
                          border: `1.5px solid ${T.accent}`, borderRadius: 6,
                          padding: "3px 8px", outline: "none", color: T.text,
                        }}
                      />
                      <button onClick={() => { updateMapPin(pin.id, { label: editText }); setEditId(null); }}
                        style={{ background: T.accent, border: "none", borderRadius: 5, color: "white", fontSize: 11, fontWeight: 700, padding: "3px 8px", cursor: "pointer" }}>✓</button>
                      <button onClick={() => setEditId(null)}
                        style={{ background: "none", border: "none", color: T.textMuted, cursor: "pointer", fontSize: 13 }}>✕</button>
                    </div>
                  ) : (
                    <div
                      onClick={() => { setEditId(pin.id); setEditText(pin.label); }}
                      style={{ fontSize: 13, color: pin.label ? T.text : T.textLight, fontFamily: T.font, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: "text", fontStyle: pin.label ? "normal" : "italic" }}>
                      {pin.label || "Click to add label…"}
                    </div>
                  )}
                  <div style={{ fontSize: 11, color: T.textLight, fontFamily: T.font, marginTop: 2 }}>
                    {pin.lat.toFixed(4)}, {pin.lng.toFixed(4)}
                  </div>
                </div>
                <button
                  onClick={() => removeMapPin(pin.id)}
                  style={{
                    opacity: hovId === pin.id ? 1 : 0, transition: "opacity 0.15s",
                    background: "rgba(239,68,68,0.1)", border: "none", cursor: "pointer",
                    borderRadius: 6, padding: 6, display: "flex", alignItems: "center",
                    color: T.red, flexShrink: 0,
                  }}
                >
                  <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
                    <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  </svg>
                </button>
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
  const { layers, datasets, updateLayer, setFilterRules } = useAppStore();
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
              {/* Geometry type */}
              {allowedTypes.length > 1 && (
                <div>
                  <div style={{ fontSize: 12, fontWeight: 500, color: T.textMuted, fontFamily: T.font, marginBottom: 8 }}>Geometry type</div>
                  <div style={{ display: "flex", gap: 4 }}>
                    {(["fill","line"] as const).filter(t => allowedTypes.includes(t)).map((t) => (
                      <button key={t} onClick={() => updateLayer(layer.id, { type: t })} style={{
                        flex: 1, padding: "5px 0", borderRadius: 8, border: "none", cursor: "pointer",
                        fontSize: 11, fontWeight: 600, fontFamily: T.font, textTransform: "capitalize",
                        background: layer.type === t ? T.text : "rgba(0,0,0,0.05)",
                        color: layer.type === t ? "white" : T.textMuted,
                      }}>{t === "fill" ? "Fill" : "Line"}</button>
                    ))}
                  </div>
                </div>
              )}
              {/* Stroke width — only for line or fill-with-outline */}
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 500, color: T.textMuted, fontFamily: T.font }}>
                    {layer.type === "line" ? "Line width" : "Outline width"}
                  </span>
                  <span style={{ fontSize: 12, color: T.textMuted, fontFamily: T.font }}>
                    {(layer as any).strokeWidth ?? 1.5}px
                  </span>
                </div>
                <input type="range" min={0.5} max={8} step={0.5}
                  value={(layer as any).strokeWidth ?? 1.5}
                  onChange={(e) => updateLayer(layer.id, { strokeWidth: Number(e.target.value) } as any)}
                  style={{ width: "100%", accentColor: T.text }}
                />
              </div>
              {/* Opacity */}
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
              {/* Preview */}
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
const DISCRETE_PALETTES_V2: Record<string, string[]> = {
  "Felt":      ["#e63946","#f4a261","#2a9d8f","#457b9d","#8338ec","#fb5607","#3a86ff","#06d6a0","#ffbe0b","#ff006e"],
  "Tableau":   ["#4e79a7","#f28e2b","#e15759","#76b7b2","#59a14f","#edc948","#b07aa1","#ff9da7","#9c755f","#bab0ac"],
  "QGIS":      ["#1f78b4","#33a02c","#e31a1c","#ff7f00","#6a3d9a","#b15928","#a6cee3","#b2df8a","#fb9a99","#fdbf6f"],
  "Pastel":    ["#aec6cf","#ffb347","#b5ead7","#c7ceea","#ffdac1","#e2f0cb","#ff9aa2","#f8d9d9","#c4faf8","#dcd3ff"],
  "Bold":      ["#e41a1c","#377eb8","#4daf4a","#984ea3","#ff7f00","#a65628","#f781bf","#999999","#66c2a5","#fc8d62"],
  "Earthy":    ["#a0522d","#6b8e23","#4682b4","#d2691e","#708090","#556b2f","#8b4513","#2e8b57","#800000","#4169e1"],
};

const CONTINUOUS_PALETTES_V2: Record<string, string[]> = {
  "Blues":     ["#dbeafe","#93c5fd","#3b82f6","#1d4ed8","#1e3a8a"],
  "Greens":    ["#dcfce7","#86efac","#22c55e","#15803d","#14532d"],
  "Oranges":   ["#fff7ed","#fed7aa","#fb923c","#ea580c","#7c2d12"],
  "Purples":   ["#f5f3ff","#c4b5fd","#8b5cf6","#6d28d9","#3b0764"],
  "Reds":      ["#fef2f2","#fca5a5","#ef4444","#b91c1c","#450a0a"],
  "Viridis":   ["#fde725","#7ad151","#22a884","#2a788e","#414487","#440154"],
  "Plasma":    ["#f0f921","#fca636","#e16462","#b12a90","#6a00a8","#0d0887"],
  "Magma":     ["#fcfdbf","#feca8d","#fd9668","#de4968","#9b179e","#000004"],
  "Inferno":   ["#fcffa4","#f7d13d","#fb9b06","#d44842","#8d0a6d","#000004"],
  "RdYlGn":    ["#d73027","#f46d43","#fee08b","#d9ef8b","#66bd63","#1a9850"],
};


// ─── Classification methods ───────────────────────────────────────────────────
type ClassMethod = "equalInterval" | "quantile" | "naturalBreaks" | "stdDev";

function computeBreaks(nums: number[], n: number, method: ClassMethod): number[] {
  if (nums.length === 0 || n < 2) return [];
  const sorted = [...nums].sort((a, b) => a - b);
  const min = sorted[0], max = sorted[sorted.length - 1];

  if (method === "equalInterval") {
    const step = (max - min) / n;
    return Array.from({ length: n + 1 }, (_, i) => min + i * step);
  }

  if (method === "quantile") {
    const breaks = [min];
    for (let i = 1; i < n; i++) {
      const idx = (i / n) * (sorted.length - 1);
      const lo = Math.floor(idx), hi = Math.ceil(idx);
      breaks.push(sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo));
    }
    breaks.push(max);
    return breaks;
  }

  if (method === "naturalBreaks") {
    // Jenks natural breaks
    const mat1: number[][] = Array.from({ length: sorted.length + 1 }, () => new Array(n + 1).fill(0));
    const mat2: number[][] = Array.from({ length: sorted.length + 1 }, () => new Array(n + 1).fill(Infinity));
    for (let i = 1; i <= n; i++) { mat1[1][i] = 1; mat2[1][i] = 0; }
    for (let j = 2; j <= sorted.length; j++) mat2[j][1] = Infinity;

    for (let j = 2; j <= sorted.length; j++) {
      let s1 = 0, s2 = 0, w = 0;
      for (let m = 1; m <= j; m++) {
        const i3 = j - m + 1;
        const val = sorted[i3 - 1];
        s2 += val * val; s1 += val; w++;
        const v = s2 - (s1 * s1) / w;
        if (i3 !== 1) {
          for (let k = 2; k <= n; k++) {
            if (mat2[j][k] >= v + mat2[i3 - 1][k - 1]) {
              mat1[j][k] = i3; mat2[j][k] = v + mat2[i3 - 1][k - 1];
            }
          }
        }
      }
      mat1[j][1] = 1; mat2[j][1] = s2 - (s1 * s1) / w;
    }

    const kclass: number[] = new Array(n + 1).fill(0);
    kclass[n] = sorted.length;
    kclass[1] = 1;
    for (let k = n; k >= 2; k--) kclass[k - 1] = mat1[kclass[k]][k] - 1;
    return [min, ...kclass.slice(2).map(i => sorted[i - 1]), max];
  }

  if (method === "stdDev") {
    const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
    const std = Math.sqrt(nums.reduce((a, b) => a + (b - mean) ** 2, 0) / nums.length);
    const breaks = [min];
    for (let i = -(n / 2 - 0.5); i <= n / 2; i++) {
      const v = mean + i * std;
      if (v > min && v < max) breaks.push(v);
    }
    breaks.push(max);
    // Ensure exactly n+1 breaks
    while (breaks.length < n + 1) breaks.splice(breaks.length - 1, 0, (breaks[breaks.length - 2] + max) / 2);
    return breaks.slice(0, n + 1);
  }

  return [];
}

// ─── Symbology Tab ────────────────────────────────────────────────────────────
function SymbologyTab({ layer, updateLayer }: { layer: any; updateLayer: any }) {
  const { datasets } = useAppStore();
  const dataset = datasets.find((d) => d.id === layer.datasetId);
  const isPoint = dataset?.renderType === "point";

  const existing = layer.symbology;
  const [mode, setMode]               = useState<"single"|"categorized"|"graduated">(existing?.mode ?? "single");
  const [attrCol, setAttrCol]         = useState(existing?.col ?? "");
  const [catPalette, setCatPalette]   = useState(existing?.palette ?? "Felt");
  const [rampPalette, setRampPalette] = useState(existing?.palette ?? "Viridis");
  const [columns, setColumns]         = useState<string[]>([]);
  const [colValues, setColValues]     = useState<string[]>([]);
  
  // per-item colour overrides for categorized; key = value string, value = hex colour
  const [catColorOverrides, setCatColorOverrides] = useState<Record<string,string>>({});
  const [colLoading, setColLoading]   = useState(false);
  const [applied, setApplied]         = useState(false);
  const [numClasses, setNumClasses]   = useState(5);
  const [classMethod, setClassMethod] = useState<ClassMethod>("equalInterval");
  // customBreaks: array of n+1 boundary values, editable by user; null = auto-computed
  const [customBreaks, setCustomBreaks] = useState<number[] | null>(null);
  

  // true when every non-empty value in the column parses as a finite number
  const isNumericCol = colValues.length > 0 && colValues
    .filter(v => v !== "" && v !== "No Data")
    .every(v => Number.isFinite(Number(v)));
  // numeric range for graduated
  const [numRange, setNumRange]       = useState<[number,number]>([0, 100]);

  // Numeric values for break computation
  const numericVals = colValues.map(Number).filter(Number.isFinite);
  const autoBreaks = numericVals.length >= 2
    ? computeBreaks(numericVals, numClasses, classMethod)
    : [];
  const activeBreaks = customBreaks ?? autoBreaks;
  useEffect(() => {
    if (!dataset?.id) return;
    setColLoading(true);
    fetch(`${API}/datasets/${dataset.id}/columns`)
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) {
          const cols = (data.columns as string[]).filter((c) => c !== "dataset_id" && c !== "_fid");
          setColumns(cols);
          if (!attrCol && cols.length > 0) setAttrCol(cols[0]);
        }
      })
      .catch(() => {})
      .finally(() => setColLoading(false));
  }, [dataset?.id]);

  // AFTER — remove the mode === "single" guard so values load eagerly
  useEffect(() => {
    if (!dataset?.id || !attrCol) return;
    fetch(`${API}/datasets/${dataset.id}/column-values/${encodeURIComponent(attrCol)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) {
          const vals = (data.values ?? []).map((v: any) => {
            const s = v.value === null || v.value === undefined ? "" : String(v.value);
            return s;
          });
          setColValues(vals);
          const nums = vals.map(Number).filter(Number.isFinite);
          if (nums.length) setNumRange([Math.min(...nums), Math.max(...nums)]);
        }
      })
      .catch(() => setColValues([]));
  }, [dataset?.id, attrCol]); // removed `mode` from deps

  // Auto-switch away from graduated if column is non-numeric
  useEffect(() => {
    if (mode === "graduated" && colValues.length > 0) {
      const numeric = colValues.filter(v => v !== "" && v !== "No Data").every(v => Number.isFinite(Number(v)));
      if (!numeric) setMode("categorized");
    }
  }, [colValues, mode]);
        

  function applySymbology() {
    if (mode === "single") {
      updateLayer(layer.id, { symbology: { mode: "single" } });
    } else if (mode === "categorized") {
      // merge palette defaults with any per-item overrides
      const basePalette = CAT_PALETTES[catPalette];
      const finalColors = colValues.map((val, i) =>
        catColorOverrides[val] ?? basePalette[i % basePalette.length]
      );
      updateLayer(layer.id, { symbology: { mode: "categorized", col: attrCol, palette: catPalette, colors: finalColors, values: colValues } });
    } else if (mode === "graduated") {
      const breaks = activeBreaks.length >= 2 ? activeBreaks : [numRange[0], numRange[1]];
      const classColors = Array.from({ length: breaks.length - 1 }, (_, i) => {
        const t = (breaks.length - 1) === 1 ? 0 : i / (breaks.length - 2);
        return rampColors[Math.round(t * (rampColors.length - 1))];
      });
      updateLayer(layer.id, { symbology: {
        mode: "graduated", col: attrCol, palette: rampPalette,
        colors: classColors, breaks, min: breaks[0], max: breaks[breaks.length - 1],
      }});
    }
    setApplied(true);
    setTimeout(() => setApplied(false), 1500);
  }

  const catColors = CAT_PALETTES[catPalette];
  const rampColors = RAMP_PALETTES[rampPalette];

  return (
    <div style={{ display: "flex", flexDirection: "column", maxHeight: "calc(100vh - 180px)" }}>
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14, overflowY: "auto", flex: 1 }}>
      <div>
        <div style={{ fontSize: 12, fontWeight: 500, color: T.textMuted, fontFamily: T.font, marginBottom: 8 }}>Symbol type</div>
        <div style={{ display: "flex", gap: 4 }}>
          {(["single","categorized","graduated"] as const).filter(m => {
            if (m === "graduated" && isPoint) return false;
            if (m === "graduated" && !isNumericCol) return false;
            return true;
          }).map((m) => (
            <button key={m} onClick={() => setMode(m)} style={{
              flex: 1, padding: "5px 0", borderRadius: 8, border: "none", cursor: "pointer",
              fontSize: 11, fontWeight: 600, fontFamily: T.font, textTransform: "capitalize",
              background: mode === m ? T.text : "rgba(0,0,0,0.05)",
              color: mode === m ? "white" : T.textMuted,
            }}>{m === "single" ? "Single" : m === "categorized" ? "Categorized" : "Graduated"}</button>
          ))}
        </div>
      </div>

      {mode === "single" && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 500, color: T.textMuted, fontFamily: T.font, marginBottom: 8 }}>Colour</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {["#ef4444","#f97316","#eab308","#22c55e","#3b82f6","#8b5cf6","#ec4899","#14b8a6","#f59e0b","#64748b"].map((c) => (
              <button key={c} onClick={() => updateLayer(layer.id, { color: hexToRgb(c) })} style={{
                width: 26, height: 26, borderRadius: "50%", border: "none", cursor: "pointer",
                background: c, padding: 0,
                outline: rgbToHex(layer.color) === c ? `3px solid ${c}` : "2px solid transparent",
                outlineOffset: 2, transition: "transform 0.1s",
                transform: rgbToHex(layer.color) === c ? "scale(1.2)" : "scale(1)",
              }}/>
            ))}
            <label style={{ width: 26, height: 26, borderRadius: "50%", border: "2px dashed #ccc", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, color: "#aaa", flexShrink: 0 }}
              title="Custom colour">
              +
              <input type="color" value={rgbToHex(layer.color)}
                onChange={(e) => updateLayer(layer.id, { color: hexToRgb(e.target.value) })}
                style={{ position: "absolute", opacity: 0, width: 0, height: 0 }}/>
            </label>
          </div>
        </div>
      )}

      {mode !== "single" && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 500, color: T.textMuted, fontFamily: T.font, marginBottom: 6 }}>Value column</div>
          {colLoading
            ? <div style={{ fontSize: 12, color: T.textLight, fontFamily: T.font }}>Loading…</div>
            : <select value={attrCol} onChange={(e) => setAttrCol(e.target.value)} style={{ width: "100%", padding: "6px 10px", borderRadius: 8, border: `1.5px solid ${T.border}`, fontSize: 13, fontFamily: T.font, background: "white", color: T.text, outline: "none", cursor: "pointer" }}>
                {columns.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
          }
        </div>
      )}

      {mode === "categorized" && (
        <>
          <div>
            <div style={{ fontSize: 12, fontWeight: 500, color: T.textMuted, fontFamily: T.font, marginBottom: 6 }}>Colour palette</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {Object.entries(CAT_PALETTES).map(([name, colors]) => (
                <button key={name} onClick={() => setCatPalette(name)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", borderRadius: 8, border: `2px solid ${catPalette === name ? T.accent : T.border}`, background: catPalette === name ? "rgba(37,99,235,0.06)" : "white", cursor: "pointer" }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: T.text, fontFamily: T.font, width: 52, textAlign: "left" }}>{name}</span>
                  <div style={{ display: "flex", gap: 2 }}>
                    {colors.map((c, i) => <div key={i} style={{ width: 13, height: 13, borderRadius: 3, background: c }}/>)}
                  </div>
                </button>
              ))}
            </div>
          </div>
          {colValues.length > 0 && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 500, color: T.textMuted, fontFamily: T.font, marginBottom: 6 }}>Legend preview <span style={{ fontSize: 10, color: T.textLight }}>(click swatch to edit colour)</span></div>
              <div style={{ maxHeight: 180, overflowY: "auto", scrollbarWidth: "thin", display: "flex", flexDirection: "column", gap: 4 }}>
                {colValues.map((val, i) => {
                  const displayLabel = val === "" || val === null ? "No Data" : val;
                  const currentColor = catColorOverrides[val] ?? catColors[i % catColors.length];
                  return (
                    <div key={val} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <label style={{ position: "relative", width: 18, height: 18, borderRadius: 4, background: currentColor, flexShrink: 0, cursor: "pointer", border: "1.5px solid rgba(0,0,0,0.15)", display: "block" }}>
                        <input type="color" value={currentColor} onChange={(e) => setCatColorOverrides(prev => ({ ...prev, [val]: e.target.value }))}
                          style={{ position: "absolute", opacity: 0, width: "100%", height: "100%", cursor: "pointer", top: 0, left: 0 }}
                        />
                      </label>
                      <span style={{ fontSize: 11, color: val === "" ? T.textLight : T.text, fontFamily: T.font, fontStyle: val === "" ? "italic" : "normal" }}>
                        {displayLabel}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {mode === "graduated" && (
        <>
          {/* Colour ramp */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 500, color: T.textMuted, fontFamily: T.font, marginBottom: 6 }}>Colour ramp</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {Object.entries(RAMP_PALETTES).map(([name, colors]) => (
                <button key={name} onClick={() => setRampPalette(name)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", borderRadius: 8, border: `2px solid ${rampPalette === name ? T.accent : T.border}`, background: rampPalette === name ? "rgba(37,99,235,0.06)" : "white", cursor: "pointer" }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: T.text, fontFamily: T.font, width: 52, textAlign: "left" }}>{name}</span>
                  <div style={{ flex: 1, height: 14, borderRadius: 4, background: `linear-gradient(to right, ${colors[0]}, ${colors[Math.floor(colors.length/2)]}, ${colors[colors.length-1]})` }}/>
                </button>
              ))}
            </div>
          </div>

          {/* Classification method */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 500, color: T.textMuted, fontFamily: T.font, marginBottom: 6 }}>Classification method</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {([
                ["equalInterval", "Equal Interval"],
                ["quantile",      "Quantile"],
                ["naturalBreaks", "Natural Breaks (Jenks)"],
                ["stdDev",        "Standard Deviation"],
              ] as [ClassMethod, string][]).map(([val, label]) => (
                <button key={val} onClick={() => { setClassMethod(val); setCustomBreaks(null); }}
                  style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", borderRadius: 8, border: `2px solid ${classMethod === val ? T.accent : T.border}`, background: classMethod === val ? "rgba(37,99,235,0.06)" : "white", cursor: "pointer", textAlign: "left" }}>
                  <div style={{ width: 12, height: 12, borderRadius: "50%", border: `2px solid ${classMethod === val ? T.accent : T.border}`, background: classMethod === val ? T.accent : "white", flexShrink: 0 }}/>
                  <span style={{ fontSize: 11, fontWeight: classMethod === val ? 600 : 400, color: T.text, fontFamily: T.font }}>{label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Classes slider */}
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 500, color: T.textMuted, fontFamily: T.font }}>Classes</span>
              <span style={{ fontSize: 12, color: T.textMuted, fontFamily: T.font }}>{numClasses}</span>
            </div>
            <input type="range" min={2} max={9} step={1}
              value={numClasses}
              onChange={(e) => { setNumClasses(Number(e.target.value)); setCustomBreaks(null); }}
              style={{ width: "100%", accentColor: T.text }}
            />
          </div>

          {/* Legend preview with editable breaks */}
          {activeBreaks.length >= 2 && (
            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 500, color: T.textMuted, fontFamily: T.font }}>Legend preview</span>
                <span style={{ fontSize: 10, color: T.textLight, fontFamily: T.font }}>(edit boundaries)</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                {Array.from({ length: activeBreaks.length - 1 }, (_, i) => {
                  const lo = activeBreaks[i];
                  const hi = activeBreaks[i + 1];
                  const colorIdx = Math.round((i / (activeBreaks.length - 2 || 1)) * (rampColors.length - 1));
                  const swatchColor = rampColors[colorIdx];
                  return (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <div style={{ width: 18, height: 18, borderRadius: 3, background: swatchColor, flexShrink: 0, border: "1px solid rgba(0,0,0,0.1)" }} />
                      {/* Lower bound — editable for all rows except first */}
                      {i === 0 ? (
                        <span style={{ fontSize: 11, color: T.textLight, fontFamily: T.font, width: 60, textAlign: "right" }}>{lo.toFixed(1)}</span>
                      ) : (
                        <input
                          type="text"
                          key={`break-${i}-${(customBreaks ?? autoBreaks)[i]}`}
                          defaultValue={String((customBreaks ?? autoBreaks)[i].toFixed(1))}
                          onBlur={(e) => {
                            const val = Number(e.target.value.replace(/[^0-9.\-]/g, ""));
                            if (!Number.isFinite(val)) return;
                            const next = [...(customBreaks ?? autoBreaks)];
                            next[i] = val;
                            setCustomBreaks(next);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          }}
                          style={{ width: 64, fontSize: 11, fontFamily: T.font, border: `1px solid ${T.border}`, borderRadius: 4, padding: "2px 6px", textAlign: "right", color: T.text, outline: "none", background: "white" }}
                        />
                      )}
                      <span style={{ fontSize: 11, color: T.textLight, fontFamily: T.font }}>–</span>
                      <span style={{ fontSize: 11, color: T.text, fontFamily: T.font }}>{hi.toFixed(1)}</span>
                    </div>
                  );
                })}
              </div>
              {customBreaks && (
                <button onClick={() => setCustomBreaks(null)}
                  style={{ marginTop: 6, fontSize: 10, color: T.accent, background: "none", border: "none", cursor: "pointer", padding: 0, fontFamily: T.font, textDecoration: "underline" }}>
                  Reset to {classMethod === "equalInterval" ? "equal interval" : classMethod === "quantile" ? "quantile" : classMethod === "naturalBreaks" ? "natural breaks" : "std dev"} breaks
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
    <div style={{ padding: "12px 16px", borderTop: `1px solid ${T.border}`, flexShrink: 0 }}>
      <button onClick={applySymbology} style={{
        width: "100%", padding: "8px 0", borderRadius: 8, border: "none", cursor: "pointer",
        fontSize: 12, fontWeight: 600, fontFamily: T.font,
        background: applied ? T.green : T.accent, color: "white",
      }}>
        {applied ? "✓ Applied" : "Apply symbology"}
      </button>
    </div>
    </div>
  );
}
// ─── Filter Tab ───────────────────────────────────────────────────────────────
type FilterRule = { col: string; op: string; val: string };
const OPS = ["=", "≠", ">", "<", "≥", "≤", "contains", "is empty"];
const FILTER_API = "http://localhost:8787";


function MultiSelectDropdown({ vals, valsLoading, selected, onChange }: {
  vals: { value: string }[];
  valsLoading: boolean;
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  if (valsLoading) return <div style={{ fontSize: 12, color: T.textLight, fontFamily: T.font, padding: "8px 4px" }}>Loading values…</div>;
  if (vals.length === 0) return (
    <input
      value={selected[0] ?? ""}
      onChange={(e) => onChange(e.target.value ? [e.target.value] : [])}
      placeholder="Type a value…"
      style={{ border: `1px solid ${T.border}`, background: "white", borderRadius: 6, padding: "5px 8px", fontSize: 12, fontFamily: T.font, color: T.text, outline: "none", width: "100%", boxSizing: "border-box" as const }}
    />
  );

  return (
    <div ref={ref} style={{ position: "relative" }}>
      {/* Trigger box */}
      <div
        onClick={() => setOpen((o) => !o)}
        style={{ border: `1px solid ${T.border}`, borderRadius: 8, padding: "6px 10px", background: "white", cursor: "pointer", display: "flex", alignItems: "center", flexWrap: "wrap", gap: 5, minHeight: 34 }}
      >
        {selected.length === 0 ? (
          <span style={{ fontSize: 12, color: T.textLight, fontFamily: T.font }}>Select values…</span>
        ) : (
          selected.map((v) => (
            <span key={v} style={{ display: "flex", alignItems: "center", gap: 4, background: "rgba(37,99,235,0.1)", color: T.accent, borderRadius: 999, padding: "2px 8px", fontSize: 11, fontWeight: 600, fontFamily: T.font }}>
              {v === "" ? "No Data" : v}
              <span
                onClick={(e) => { e.stopPropagation(); onChange(selected.filter((s) => s !== v)); }}
                style={{ cursor: "pointer", fontWeight: 700, fontSize: 13, lineHeight: 1 }}
              >×</span>
            </span>
          ))
        )}
        <svg style={{ marginLeft: "auto", flexShrink: 0, transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} width="12" height="12" viewBox="0 0 16 16" fill="none">
          <path d="M4 6l4 4 4-4" stroke={T.textMuted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>

      {/* Dropdown list */}
      {open && (
        <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 999, background: "white", border: `1px solid ${T.border}`, borderRadius: 8, boxShadow: T.shadow, maxHeight: 220, overflowY: "auto" }}>
          {vals.map(({ value }) => {
            const strVal = String(value);
            const checked = selected.includes(strVal);
            return (
              <label key={strVal || "__empty__"} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", cursor: "pointer", borderBottom: `1px solid ${T.border}`, background: checked ? "rgba(37,99,235,0.05)" : "white" }}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => {
                    const next = e.target.checked
                      ? [...selected, strVal]
                      : selected.filter((v) => v !== strVal);
                    onChange(next);
                  }}
                  style={{ accentColor: T.accent, width: 14, height: 14, flexShrink: 0 }}
                />
                {checked && <svg style={{ flexShrink: 0, marginLeft: -2 }} width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M3 8l4 4 6-6" stroke={T.accent} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                <span style={{ fontSize: 13, fontFamily: T.font, color: strVal === "" ? T.textLight : T.text, fontStyle: strVal === "" ? "italic" : "normal" }}>
                  {strVal === "" ? "No Data" : strVal}
                </span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

function FilterTab({ layer, updateLayer }: { layer: any; updateLayer: any }) {
  const { datasets, setFilterRules, setUiRules, filterRules } = useAppStore();
  const dataset = datasets.find((d) => d.id === layer.datasetId);
  
  const stored = filterRules[dataset?.id ?? ""];
  const [rules, setRulesLocal] = useState<FilterRule[]>(stored?.uiRules ?? []);
  const [matchMode, setMatchMode] = useState<"AND"|"OR">(stored?.matchMode ?? "AND");

  function setRules(r: FilterRule[] | ((prev: FilterRule[]) => FilterRule[])) {
    setRulesLocal((prev) => {
      const next = typeof r === "function" ? r(prev) : r;
      if (dataset?.id) setUiRules(dataset.id, next);
      return next;
    });
  }
  const [columns, setColumns]         = useState<string[]>([]);
  const [colsLoading, setColsLoading] = useState(false);
  
  const [ruleValues, setRuleValues]   = useState<Record<number, { value: string; count: number }[]>>({});
  const [ruleValLoading, setRuleValLoading] = useState<Record<number, boolean>>({});
  const [filteredCount, setFilteredCount]   = useState<number | null>(null);
  const [totalCount, setTotalCount]         = useState<number | null>(null);
  const [applying, setApplying]             = useState(false);

  // Load column names once
  useEffect(() => {
    if (!dataset?.id) return;
    setColsLoading(true);
    
    fetch(`${FILTER_API}/datasets/${dataset.id}/columns`)
      .then((r) => r.json())
      .then((data) => {
        
        if (data.ok) setColumns(data.columns ?? []);
      })
      .catch((err) => {
        console.error("[filter] columns fetch failed:", err);
      })
      .finally(() => setColsLoading(false));
  }, [dataset?.id]);


  // Reload values for existing rules when tab remounts
  useEffect(() => {
    if (!dataset?.id || rules.length === 0) return;
    rules.forEach((rule, i) => {
      if (rule.col) loadValuesForRule(i, rule.col, dataset.id);
    });
  }, [dataset?.id]);

  async function loadValuesForRule(index: number, col: string, dsId: string) {
    if (!dsId || !col) return;
    setRuleValLoading((prev) => ({ ...prev, [index]: true }));
    try {
      const res  = await fetch(`${FILTER_API}/datasets/${dsId}/column-values/${encodeURIComponent(col)}`);
      const data = await res.json();
      if (data.ok) setRuleValues((prev) => ({ ...prev, [index]: data.values ?? [] }));
    } catch {}
    setRuleValLoading((prev) => ({ ...prev, [index]: false }));
  }
  

  function clearAll() {
    setRulesLocal([]);
    setRuleValues({});
    setFilteredCount(null);
    setTotalCount(null);
    if (dataset?.id) setFilterRules(dataset.id, [], matchMode);
  }



  function addRule() {
    if (!dataset?.id || columns.length === 0) return;
    const firstCol = columns[0];
    const newIndex = rules.length;
    setRules((r) => [...r, { col: firstCol, op: "=", val: "" }]);
    loadValuesForRule(newIndex, firstCol, dataset.id);
  }

  function updateRule(i: number, patch: Partial<FilterRule>) {
    setRules((r) => r.map((rule, idx) => idx === i ? { ...rule, ...patch } : rule));
    if (patch.col && dataset?.id) {
      setRuleValues((prev) => { const n = { ...prev }; delete n[i]; return n; });
      loadValuesForRule(i, patch.col, dataset.id);
    }
    setFilteredCount(null);
  }

  function removeRule(i: number) {
    setRules((r) => r.filter((_, idx) => idx !== i));
    setRuleValues((prev) => {
      const n: typeof prev = {};
      Object.entries(prev).forEach(([k, v]) => {
        const ki = Number(k);
        if (ki < i) n[ki] = v;
        else if (ki > i) n[ki - 1] = v;
      });
      return n;
    });
    setFilteredCount(null);
  }


  async function applyFilters() {
    if (!dataset?.id) return;
    setApplying(true);
    setFilteredCount(null);
    setFilterRules(dataset.id, rules, matchMode);
    try {
      const res = await fetch(`${FILTER_API}/datasets/${dataset.id}/filter-count`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rules }),
      });
      const data = await res.json();
      if (data.ok) { setFilteredCount(data.count); setTotalCount(data.total); }
    } catch {}
    setApplying(false);
  }
  
  const activeCount = rules.filter((r) => (r.vals?.length ?? 0) > 0 || r.val.trim() || r.op === "is empty").length;

  return (
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: T.text, fontFamily: T.font }}>Filter features</div>
          <div style={{ fontSize: 11, color: T.textLight, fontFamily: T.font, marginTop: 2 }}>Show only features matching all rules</div>
        </div>
        {activeCount > 0 && <span style={{ background: T.accent, color: "white", borderRadius: 999, padding: "2px 8px", fontSize: 11, fontWeight: 700, fontFamily: T.font }}>{activeCount} active</span>}
      </div>

      {/* Match count result */}
      {filteredCount !== null && totalCount !== null && (
        <div style={{ background: "rgba(37,99,235,0.07)", border: `1px solid rgba(37,99,235,0.2)`, borderRadius: 8, padding: "8px 12px", display: "flex", alignItems: "center", gap: 8 }}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 4h12M5 8h6M7 12h2" stroke={T.accent} strokeWidth="2" strokeLinecap="round"/></svg>
          <span style={{ fontSize: 12, fontFamily: T.font }}>
            <strong style={{ color: T.accent }}>{filteredCount.toLocaleString()}</strong>
            <span style={{ color: T.textMuted }}> / {totalCount.toLocaleString()} features match</span>
          </span>
        </div>
      )}

      {/* Rules */}
      {colsLoading ? (
        <div style={{ fontSize: 12, color: T.textLight, fontFamily: T.font, textAlign: "center", padding: "12px 0" }}>Loading columns…</div>
      ) : rules.length === 0 ? (
        <div style={{ padding: "16px 0", textAlign: "center", color: T.textLight, fontSize: 13, fontFamily: T.font }}>No filters — all features shown</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {rules.map((rule, i) => {
            const vals = ruleValues[i] ?? [];
            const valsLoading = ruleValLoading[i] ?? false;
            return (
              <div key={i} style={{ display: "flex", flexDirection: "column", gap: 6, padding: "10px", background: "rgba(0,0,0,0.03)", borderRadius: T.radiusSm, border: `1px solid ${T.border}` }}>
                {/* Row 1: column selector + op selector + remove */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 5, alignItems: "center" }}>
                  <select value={rule.col} onChange={(e) => updateRule(i, { col: e.target.value })}
                    style={{ border: "none", background: "white", borderRadius: 6, padding: "4px 6px", fontSize: 12, fontFamily: T.font, color: T.text, outline: "none", cursor: "pointer", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
                    {columns.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <select value={rule.op} onChange={(e) => updateRule(i, { op: e.target.value })}
                    style={{ border: "none", background: T.text, color: "white", borderRadius: 6, padding: "4px 5px", fontSize: 12, fontFamily: T.font, outline: "none", cursor: "pointer" }}>
                    {OPS.map((op) => <option key={op} value={op}>{op}</option>)}
                  </select>
                  <IconBtn onClick={() => removeRule(i)} danger>
                    <svg width="11" height="11" viewBox="0 0 16 16" fill="none"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
                  </IconBtn>
                </div>

                {rule.op !== "is empty" && (
                  <MultiSelectDropdown
                    vals={vals}
                    valsLoading={valsLoading}
                    selected={rule.vals ?? (rule.val ? [rule.val] : [])}
                    onChange={(next) => updateRule(i, { vals: next, val: next[0] ?? "" })}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
      
      
      {rules.length > 1 && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 0" }}>
          <span style={{ fontSize: 11, color: T.textMuted, fontFamily: T.font }}>Match</span>
          {(["AND","OR"] as const).map((m) => (
            <button key={m} onClick={() => setMatchMode(m)} style={{
              padding: "2px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600,
              fontFamily: T.font, cursor: "pointer",
              background: matchMode === m ? T.accent : "transparent",
              color: matchMode === m ? "white" : T.textMuted,
              border: `1px solid ${matchMode === m ? T.accent : T.border}`,
            }}>{m}</button>
          ))}
          <span style={{ fontSize: 11, color: T.textMuted, fontFamily: T.font }}>rules</span>
        </div>
      )}

      {/* Add rule button */}
      <button onClick={addRule} disabled={columns.length === 0}
        style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "8px 0", borderRadius: 10, border: `1.5px dashed ${T.border}`, background: "transparent", cursor: columns.length === 0 ? "not-allowed" : "pointer", fontSize: 12, fontWeight: 600, fontFamily: T.font, color: T.textMuted, opacity: columns.length === 0 ? 0.5 : 1 }}>
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
        Add filter rule
      </button>

      {/* Clear / Apply */}
      {rules.length > 0 && (
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={clearAll} style={{ flex: 1, padding: "7px 0", borderRadius: 8, border: `1px solid ${T.border}`, background: "none", cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: T.font, color: T.textMuted }}>Clear all</button>
          <button onClick={applyFilters} disabled={applying} style={{ flex: 2, padding: "7px 0", borderRadius: 8, border: "none", background: applying ? T.border : T.accent, cursor: applying ? "not-allowed" : "pointer", fontSize: 12, fontWeight: 600, fontFamily: T.font, color: "white" }}>
            {applying ? "Applying…" : "Apply filters"}
          </button>
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
  const { viewState, activeDatasetId, datasets, addMapPin, setActiveTool,mapPins, mapContextMenu, setMapContextMenu } = useAppStore();
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
      
      {/* ↓ ADD THIS BLOCK before the closing </> */}
      {mapContextMenu && (
        <MapContextMenu
          x={mapContextMenu.x} y={mapContextMenu.y}
          lat={mapContextMenu.lat} lng={mapContextMenu.lng}
          onClose={() => setMapContextMenu(null)}
          onAddAnnotation={(lat, lng, label) => {
            const colors = ["#f97316","#3b82f6","#22c55e","#a855f7","#ef4444","#eab308"];
            addMapPin({ 
              id: "pin-" + Date.now(), 
              lat, 
              lng, 
              label: label ?? "",
              color: colors[mapPins.length % colors.length], 
              createdAt: Date.now() 
            });
          }}
        />
      )}
      <style>{`@keyframes felt-pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.5;transform:scale(0.8)} }`}</style>
    </>
  );
}
