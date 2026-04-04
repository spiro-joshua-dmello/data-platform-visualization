import React, { useState, useEffect, useRef } from "react";
import { Marker, Source, Layer } from "react-map-gl/maplibre";
import { useAppStore, type MapPin } from "./store";

// ── Geo helpers ────────────────────────────────────────────────────────────────

function haversineKm(a: [number, number], b: [number, number]) {
  const R = 6371;
  const dLat = ((b[1] - a[1]) * Math.PI) / 180;
  const dLng = ((b[0] - a[0]) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a[1] * Math.PI) / 180) *
      Math.cos((b[1] * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

function fmtDist(km: number) {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(2)} km`;
}

/** Shoelace formula for approximate area in km² (only valid for small polygons) */
function approxAreaKm2(pts: [number, number][]): number {
  if (pts.length < 3) return 0;
  const R = 6371;
  let area = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const xi = (pts[i][0] * Math.PI) / 180;
    const yi = (pts[i][1] * Math.PI) / 180;
    const xj = (pts[j][0] * Math.PI) / 180;
    const yj = (pts[j][1] * Math.PI) / 180;
    area += xi * Math.sin(yj) - xj * Math.sin(yi);
  }
  return Math.abs(area / 2) * R * R;
}

function fmtArea(km2: number) {
  if (km2 < 0.001) return `${Math.round(km2 * 1_000_000)} m²`;
  if (km2 < 1) return `${(km2 * 100).toFixed(2)} ha`;
  return `${km2.toFixed(3)} km²`;
}

// ── Pin marker ────────────────────────────────────────────────────────────────

function PinMarker({ pin, onRemove, onLabelChange }: { pin: MapPin; onRemove: () => void; onLabelChange: (l: string) => void }) {
  const [editing, setEditing] = useState(!pin.label);
  const [draft, setDraft] = useState(pin.label);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (editing) setTimeout(() => inputRef.current?.focus(), 50); }, [editing]);
  // Sync draft when store label changes (e.g. after save reflects back)
  useEffect(() => { if (!editing) setDraft(pin.label); }, [pin.label, editing]);

  return (
    <Marker longitude={pin.lng} latitude={pin.lat} anchor="bottom">
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          cursor: "default",
        }}
      >
        {editing ? (
          <div
            style={{
              background: "white",
              borderRadius: 10,
              padding: "6px 10px",
              boxShadow: "0 4px 16px rgba(0,0,0,0.18)",
              border: "1.5px solid rgba(0,0,0,0.1)",
              marginBottom: 4,
              display: "flex",
              gap: 5,
              alignItems: "center",
            }}
          >
            <input ref={inputRef} value={draft} onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { onLabelChange(draft); setEditing(false); } if (e.key === "Escape") setEditing(false); }}
              placeholder="Add label…" style={{ border: "none", outline: "none", fontSize: 12, fontFamily: "'Inter', system-ui, sans-serif", width: 120, color: "#111827" }} />
            <button
              onMouseDown={(e) => { e.preventDefault(); onLabelChange(draft); setEditing(false); }}
              style={{ background: pin.color, border: "none", borderRadius: 5, color: "white", fontSize: 10, fontWeight: 700, padding: "2px 7px", cursor: "pointer" }}>✓</button>
          </div>
        ) : pin.label ? (
          <div
            onClick={() => setEditing(true)}
            style={{
              background: "white",
              borderRadius: 8,
              padding: "4px 9px",
              boxShadow: "0 2px 10px rgba(0,0,0,0.15)",
              border: "1.5px solid rgba(0,0,0,0.08)",
              marginBottom: 4,
              fontSize: 12,
              fontWeight: 500,
              color: "#111827",
              fontFamily: "'Inter', system-ui, sans-serif",
              cursor: "text",
              whiteSpace: "nowrap",
              maxWidth: 180,
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {pin.label}
          </div>
        ) : (
          <div
            onClick={() => setEditing(true)}
            style={{
              background: "rgba(255,255,255,0.9)",
              borderRadius: 8,
              padding: "3px 8px",
              marginBottom: 4,
              fontSize: 11,
              color: "#9ca3af",
              cursor: "text",
              fontFamily: "'Inter', system-ui, sans-serif",
              border: "1px dashed #d1d5db",
            }}
          >
            click to label
          </div>
        )}
        <div style={{ position: "relative" }}>
          <div
            onClick={onRemove}
            title="Remove pin"
            style={{
              width: 28,
              height: 28,
              borderRadius: "50% 50% 50% 0",
              background: pin.color,
              border: "2.5px solid white",
              transform: "rotate(-45deg)",
              boxShadow: "0 3px 12px rgba(0,0,0,0.25)",
              cursor: "pointer",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.transform =
                "rotate(-45deg) scale(1.15)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.transform =
                "rotate(-45deg) scale(1)";
            }}
          />
          <div
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "white",
              pointerEvents: "none",
            }}
          />
        </div>
      </div>
    </Marker>
  );
}

// ── Measure Overlay ───────────────────────────────────────────────────────────

// Bright colours that are clearly visible on a dark basemap
const LINE_COLOR   = "#00e5ff";   // cyan
const POLY_COLOR   = "#69ff47";   // lime-green
const DOT_FILL     = "#ffffff";
const LABEL_BG     = "rgba(0,0,0,0.82)";
const LABEL_BORDER = "rgba(255,255,255,0.15)";

export function MeasureOverlay({
  points,
  mode,
  onAddPoint,
  mousePos,
}: {
  points: [number, number][];
  mode: "line" | "polygon";
  onAddPoint: (pt: [number, number]) => void;
  mousePos: [number, number] | null;
}) {
  // Build GeoJSON for the line/polygon stroke
  const strokeGeoJSON = React.useMemo(() => {
    if (points.length < 2) return null;

    if (mode === "line") {
      return {
        type: "Feature" as const,
        geometry: { type: "LineString", coordinates: points },
        properties: {},
      };
    } else {
      // Close the polygon visually
      const ring = [...points, points[0]];
      return {
        type: "Feature" as const,
        geometry: { type: "LineString", coordinates: ring },
        properties: {},
      };
    }
  }, [points, mode]);

  // Fill GeoJSON for polygon shading
  const fillGeoJSON = React.useMemo(() => {
    if (mode !== "polygon" || points.length < 3) return null;
    return {
      type: "Feature" as const,
      geometry: { type: "Polygon", coordinates: [[...points, points[0]]] },
      properties: {},
    };
  }, [points, mode]);

  const totalKm = React.useMemo(
    () =>
      points.slice(1).reduce((acc, pt, i) => acc + haversineKm(points[i], pt), 0),
    [points]
  );

  const areakm2 = React.useMemo(
    () => (mode === "polygon" ? approxAreaKm2(points) : 0),
    [points, mode]
  );

  const color = mode === "line" ? LINE_COLOR : POLY_COLOR;

  return (
    <>
      {/* ── Stroke layer ── */}
      {strokeGeoJSON && (
        <>
          <Source id="measure-stroke" type="geojson" data={strokeGeoJSON as any}>
            {/* glow / halo */}
            <Layer
              id="measure-stroke-glow"
              type="line"
              paint={{
                "line-color": color,
                "line-width": 8,
                "line-opacity": 0.18,
                "line-blur": 4,
              }}
              layout={{ "line-cap": "round", "line-join": "round" }}
            />
            {/* main stroke */}
            <Layer
              id="measure-stroke-main"
              type="line"
              paint={{
                "line-color": color,
                "line-width": 2.5,
                "line-opacity": 1,
                "line-dasharray": mode === "line" ? [1] : [5, 3],
              }}
              layout={{ "line-cap": "round", "line-join": "round" }}
            />
          </Source>
        </>
      )}

      {/* ── Fill layer (polygon only) ── */}
      {fillGeoJSON && (
        <Source id="measure-fill" type="geojson" data={fillGeoJSON as any}>
          <Layer
            id="measure-fill-layer"
            type="fill"
            paint={{
              "fill-color": color,
              "fill-opacity": 0.12,
            }}
          />
        </Source>
      )}

      {/* ── Per-segment distance labels ── */}
      {points.slice(1).map((pt, i) => {
        const prev = points[i];
        const midLng = (prev[0] + pt[0]) / 2;
        const midLat = (prev[1] + pt[1]) / 2;
        return (
          <Marker key={`seg-${i}`} longitude={midLng} latitude={midLat} anchor="center">
            <div
              style={{
                background: LABEL_BG,
                color: color,
                border: `1px solid ${LABEL_BORDER}`,
                borderRadius: 6,
                padding: "2px 7px",
                fontSize: 11,
                fontFamily: "'Inter', system-ui, sans-serif",
                fontWeight: 700,
                whiteSpace: "nowrap",
                pointerEvents: "none",
                letterSpacing: "0.02em",
              }}
            >
              {fmtDist(haversineKm(prev, pt))}
            </div>
          </Marker>
        );
      })}

      {/* ── Vertex dots ── */}
      {points.map((pt, i) => (
        <Marker key={`dot-${i}`} longitude={pt[0]} latitude={pt[1]} anchor="center">
          <div
            style={{
              width: i === 0 ? 14 : 10,
              height: i === 0 ? 14 : 10,
              borderRadius: "50%",
              background: i === 0 ? color : DOT_FILL,
              border: `2.5px solid ${color}`,
              boxShadow: `0 0 6px ${color}88, 0 1px 4px rgba(0,0,0,0.5)`,
              pointerEvents: "none",
            }}
          />
        </Marker>
      ))}

      {/* ── Summary chip ── */}
      {points.length >= 2 && (
        <div
          style={{
            position: "absolute",
            bottom: 56,
            left: "50%",
            transform: "translateX(-50%)",
            background: LABEL_BG,
            color: color,
            border: `1.5px solid ${color}55`,
            borderRadius: 10,
            padding: "6px 16px",
            fontSize: 13,
            fontWeight: 700,
            fontFamily: "'Inter', system-ui, sans-serif",
            boxShadow: `0 4px 16px rgba(0,0,0,0.5), 0 0 12px ${color}33`,
            pointerEvents: "none",
            zIndex: 50,
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          {mode === "line" ? (
            <>
              <span style={{ opacity: 0.6, fontWeight: 400, fontSize: 11 }}>
                📏 Length
              </span>
              {fmtDist(totalKm)}
            </>
          ) : (
            <>
              <span style={{ opacity: 0.6, fontWeight: 400, fontSize: 11 }}>
                ⬡ Area
              </span>
              {points.length >= 3 ? fmtArea(areakm2) : "—"}
              {points.length >= 3 && (
                <>
                  <span
                    style={{
                      width: 1,
                      height: 14,
                      background: `${color}44`,
                      display: "inline-block",
                    }}
                  />
                  <span style={{ opacity: 0.6, fontWeight: 400, fontSize: 11 }}>
                    Perimeter
                  </span>
                  {fmtDist(totalKm)}
                </>
              )}
            </>
          )}
          <span
            style={{
              fontSize: 10,
              opacity: 0.5,
              fontWeight: 400,
              marginLeft: 4,
            }}
          >
            ESC to clear
          </span>
        </div>
      )}
    </>
  );
}

// ── Map pins layer ────────────────────────────────────────────────────────────

export function MapPinsLayer() {
  const { mapPins, updateMapPin, removeMapPin } = useAppStore();
  return (
    <>
      {mapPins.map((pin) => (
        <PinMarker
          key={pin.id}
          pin={pin}
          onRemove={() => removeMapPin(pin.id)}
          onLabelChange={(label) => updateMapPin(pin.id, { label })}
        />
      ))}
    </>
  );
}

// ── Map tool handler hook ─────────────────────────────────────────────────────

export function useMapToolHandler() {
  const {
    activeTool,
    addMapPin,
    mapPins,
    measurePoints,
    setMeasurePoints,
  } = useAppStore();
  const [mousePos, setMousePos] = useState<[number, number] | null>(null);

  useEffect(() => {
    if (activeTool !== "measure") setMeasurePoints([]);
  }, [activeTool]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMeasurePoints([]);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  function handleMapClick(info: any) {
    if (!info.coordinate) return;
    const [lng, lat] = info.coordinate as [number, number];
    if (activeTool === "annotate") {
      const colors = [
        "#f97316",
        "#3b82f6",
        "#22c55e",
        "#a855f7",
        "#ef4444",
        "#eab308",
      ];
      addMapPin({
        id: "pin-" + Date.now(),
        lng,
        lat,
        label: "",
        color: colors[mapPins.length % colors.length],
        createdAt: Date.now(),
      });
    }
    if (activeTool === "measure") {
      setMeasurePoints([...measurePoints, [lng, lat]]);
    }
  }

  const cursorStyle =
    activeTool === "annotate"
      ? "crosshair"
      : activeTool === "measure"
      ? "crosshair"
      : activeTool === "pan"
      ? "grab"
      : "default";

  return {
    handleMapClick,
    mousePos,
    setMousePos,
    cursorStyle,
  };
}
