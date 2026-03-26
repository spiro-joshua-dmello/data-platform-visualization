import React, { useState, useEffect, useRef } from "react";
import { Marker } from "react-map-gl/maplibre";
import { useAppStore, type MapPin } from "./store";

function haversineKm(a: [number, number], b: [number, number]) {
  const R = 6371;
  const dLat = ((b[1] - a[1]) * Math.PI) / 180;
  const dLng = ((b[0] - a[0]) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((a[1] * Math.PI) / 180) * Math.cos((b[1] * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}
function fmtDist(km: number) {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(2)} km`;
}

function PinMarker({ pin, onRemove, onLabelChange }: { pin: MapPin; onRemove: () => void; onLabelChange: (l: string) => void }) {
  const [editing, setEditing] = useState(!pin.label);
  const [draft, setDraft] = useState(pin.label);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (editing) setTimeout(() => inputRef.current?.focus(), 50); }, [editing]);
  return (
    <Marker longitude={pin.lng} latitude={pin.lat} anchor="bottom">
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", cursor: "default" }}>
        {editing ? (
          <div style={{ background: "white", borderRadius: 10, padding: "6px 10px", boxShadow: "0 4px 16px rgba(0,0,0,0.18)", border: "1.5px solid rgba(0,0,0,0.1)", marginBottom: 4, display: "flex", gap: 5, alignItems: "center" }}>
            <input ref={inputRef} value={draft} onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { onLabelChange(draft); setEditing(false); } if (e.key === "Escape") setEditing(false); }}
              placeholder="Add label…" style={{ border: "none", outline: "none", fontSize: 12, fontFamily: "'Inter', system-ui, sans-serif", width: 120, color: "#111827" }} />
            <button onClick={() => { onLabelChange(draft); setEditing(false); }} style={{ background: pin.color, border: "none", borderRadius: 5, color: "white", fontSize: 10, fontWeight: 700, padding: "2px 7px", cursor: "pointer" }}>✓</button>
          </div>
        ) : pin.label ? (
          <div onClick={() => setEditing(true)} style={{ background: "white", borderRadius: 8, padding: "4px 9px", boxShadow: "0 2px 10px rgba(0,0,0,0.15)", border: "1.5px solid rgba(0,0,0,0.08)", marginBottom: 4, fontSize: 12, fontWeight: 500, color: "#111827", fontFamily: "'Inter', system-ui, sans-serif", cursor: "text", whiteSpace: "nowrap", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis" }}>{pin.label}</div>
        ) : (
          <div onClick={() => setEditing(true)} style={{ background: "rgba(255,255,255,0.9)", borderRadius: 8, padding: "3px 8px", marginBottom: 4, fontSize: 11, color: "#9ca3af", cursor: "text", fontFamily: "'Inter', system-ui, sans-serif", border: "1px dashed #d1d5db" }}>click to label</div>
        )}
        <div style={{ position: "relative" }}>
          <div onClick={onRemove} title="Remove pin" style={{ width: 28, height: 28, borderRadius: "50% 50% 50% 0", background: pin.color, border: "2.5px solid white", transform: "rotate(-45deg)", boxShadow: "0 3px 12px rgba(0,0,0,0.25)", cursor: "pointer" }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.transform = "rotate(-45deg) scale(1.15)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.transform = "rotate(-45deg) scale(1)"; }} />
          <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", width: 8, height: 8, borderRadius: "50%", background: "white", pointerEvents: "none" }} />
        </div>
      </div>
    </Marker>
  );
}

export function MeasureOverlay({ points }: { points: [number, number][]; onAddPoint: (pt: [number, number]) => void; mousePos: [number, number] | null }) {
  const totalKm = points.slice(1).reduce((acc, pt, i) => acc + haversineKm(points[i], pt), 0);
  return (
    <>
      {points.slice(1).map((pt, i) => {
        const prev = points[i];
        return (
          <Marker key={i} longitude={(prev[0] + pt[0]) / 2} latitude={(prev[1] + pt[1]) / 2} anchor="center">
            <div style={{ background: "rgba(17,24,39,0.85)", color: "white", borderRadius: 6, padding: "2px 7px", fontSize: 11, fontFamily: "'Inter', system-ui, sans-serif", fontWeight: 600, whiteSpace: "nowrap", pointerEvents: "none" }}>
              {fmtDist(haversineKm(prev, pt))}
            </div>
          </Marker>
        );
      })}
      {points.map((pt, i) => (
        <Marker key={i} longitude={pt[0]} latitude={pt[1]} anchor="center">
          <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#f59e0b", border: "2px solid white", boxShadow: "0 1px 4px rgba(0,0,0,0.3)" }} />
        </Marker>
      ))}
      {points.length >= 2 && (
        <div style={{ position: "absolute", bottom: 56, left: "50%", transform: "translateX(-50%)", background: "rgba(17,24,39,0.92)", color: "white", borderRadius: 10, padding: "6px 16px", fontSize: 13, fontWeight: 600, fontFamily: "'Inter', system-ui, sans-serif", boxShadow: "0 4px 16px rgba(0,0,0,0.3)", pointerEvents: "none", zIndex: 50, display: "flex", alignItems: "center", gap: 8 }}>
          Total: {fmtDist(totalKm)}
          <span style={{ fontSize: 10, opacity: 0.6, fontWeight: 400 }}>click to add pts · ESC to clear</span>
        </div>
      )}
    </>
  );
}

export function MapPinsLayer() {
  const { mapPins, updateMapPin, removeMapPin } = useAppStore();
  return (
    <>
      {mapPins.map((pin) => (
        <PinMarker key={pin.id} pin={pin} onRemove={() => removeMapPin(pin.id)} onLabelChange={(label) => updateMapPin(pin.id, { label })} />
      ))}
    </>
  );
}

export function useMapToolHandler() {
  const { activeTool, addMapPin, mapPins } = useAppStore();
  const [measurePoints, setMeasurePoints] = useState<[number, number][]>([]);
  const [mousePos, setMousePos] = useState<[number, number] | null>(null);

  useEffect(() => { if (activeTool !== "measure") setMeasurePoints([]); }, [activeTool]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setMeasurePoints([]); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  function handleMapClick(info: any) {
    if (!info.coordinate) return;
    const [lng, lat] = info.coordinate as [number, number];
    if (activeTool === "annotate") {
      const colors = ["#f97316","#3b82f6","#22c55e","#a855f7","#ef4444","#eab308"];
      addMapPin({ id: "pin-" + Date.now(), lng, lat, label: "", color: colors[mapPins.length % colors.length], createdAt: Date.now() });
    }
    if (activeTool === "measure") setMeasurePoints((pts) => [...pts, [lng, lat]]);
  }

  const cursorStyle = activeTool === "annotate" ? "crosshair" : activeTool === "measure" ? "crosshair" : activeTool === "pan" ? "grab" : "default";
  return { handleMapClick, measurePoints, mousePos, setMousePos, cursorStyle };
}