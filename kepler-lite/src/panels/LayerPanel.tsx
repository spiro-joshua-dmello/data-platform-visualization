import React, { useState } from "react";
import { useAppStore } from "../store";
import { clamp } from "../utils";

const API = "http://localhost:8787";

function rgbToHex([r, g, b]: [number, number, number]) {
  const h = (n: number) => n.toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return [r, g, b];
}

function boundsToZoom(bounds: [number, number, number, number]): { longitude: number; latitude: number; zoom: number } {
  const [minLng, minLat, maxLng, maxLat] = bounds;
  const longitude = (minLng + maxLng) / 2;
  const latitude  = (minLat + maxLat) / 2;
  const maxDiff   = Math.max(Math.abs(maxLng - minLng), Math.abs(maxLat - minLat), 0.0001);
  const zoom =
    maxDiff > 60   ? 2  :
    maxDiff > 30   ? 3  :
    maxDiff > 15   ? 4  :
    maxDiff > 8    ? 5  :
    maxDiff > 4    ? 6  :
    maxDiff > 2    ? 7  :
    maxDiff > 1    ? 8  :
    maxDiff > 0.5  ? 9  :
    maxDiff > 0.25 ? 10 :
    maxDiff > 0.12 ? 11 :
    maxDiff > 0.06 ? 12 :
    maxDiff > 0.03 ? 13 :
    maxDiff > 0.015 ? 14 : 15;
  return { longitude, latitude, zoom };
}

export function LayerPanel() {
  const { layers, datasets, updateLayer, removeLayer, setZoomTarget } = useAppStore();
  const [zoomingId, setZoomingId] = useState<string | null>(null);

  async function handleZoom(layerId: string) {
    const layer = layers.find((l) => l.id === layerId);
    if (!layer) return;

    const dataset = datasets.find((d) => d.id === layer.datasetId);
    if (!dataset) return;

    setZoomingId(layerId);
    try {
      // Dedicated bounds endpoint — avoids the duplicate GET /datasets route bug
      const res = await fetch(`${API}/datasets/${dataset.datasetId}/bounds`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      const bounds: [number, number, number, number] | null = data.bounds ?? null;

      if (
        !bounds ||
        !Array.isArray(bounds) ||
        bounds.length !== 4 ||
        !bounds.every((v) => typeof v === "number" && isFinite(v))
      ) {
        alert("No bounds available for this layer. The dataset may have no features.");
        return;
      }

      setZoomTarget(boundsToZoom(bounds));
    } catch (e) {
      console.error("[zoom] Failed to fetch bounds", e);
      alert("Could not fetch layer bounds.");
    } finally {
      setZoomingId(null);
    }
  }

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h4 style={{ margin: 0 }}>Layers</h4>
        <div style={{ fontSize: 12, color: "#a5adbb" }}>{layers.length}</div>
      </div>

      {layers.length === 0 ? (
        <div style={{ fontSize: 12, color: "#a5adbb" }}>No layers yet.</div>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {layers.map((l) => {
            const ds = datasets.find((d) => d.id === l.datasetId);

            const allowedLayerTypes =
              ds?.renderType === "point"
                ? ["circle"]
                : ds?.renderType === "line"
                ? ["line"]
                : ds?.renderType === "polygon"
                ? ["fill", "line"]
                : ["circle", "line", "fill"];

            const isZooming = zoomingId === l.id;

            return (
              <div
                key={l.id}
                style={{
                  border: "1px solid var(--border)",
                  background: "var(--panel-2)",
                  borderRadius: 10,
                  padding: 10,
                  display: "grid",
                  gap: 10,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        fontWeight: 650,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                      title={l.name}
                    >
                      {l.name}
                    </div>

                    <div style={{ fontSize: 12, color: "#a5adbb" }}>
                      {l.type} · {ds?.name ?? "unknown dataset"}
                    </div>

                    {ds?.renderType && (
                      <div style={{ fontSize: 12, color: "#a5adbb" }}>
                        render type: {ds.renderType}
                      </div>
                    )}
                  </div>

                  <div style={{ display: "flex", gap: 6, alignItems: "start" }}>
                    <button
                      onClick={() => void handleZoom(l.id)}
                      disabled={isZooming}
                      style={{ opacity: isZooming ? 0.6 : 1, cursor: isZooming ? "wait" : "pointer" }}
                    >
                      {isZooming ? "…" : "Zoom"}
                    </button>
                    <button onClick={() => removeLayer(l.id)}>Delete</button>
                  </div>
                </div>

                <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input
                    type="checkbox"
                    checked={l.visible}
                    onChange={(e) => updateLayer(l.id, { visible: e.target.checked })}
                  />
                  Visible
                </label>

                <label style={{ display: "grid", gap: 6 }}>
                  <div style={{ fontSize: 12, color: "#a5adbb" }}>Layer type</div>
                  <select
                    value={l.type}
                    onChange={(e) =>
                      updateLayer(l.id, {
                        type: e.target.value as "circle" | "line" | "fill",
                      })
                    }
                  >
                    {allowedLayerTypes.includes("circle") && <option value="circle">circle</option>}
                    {allowedLayerTypes.includes("line") && <option value="line">line</option>}
                    {allowedLayerTypes.includes("fill") && <option value="fill">fill</option>}
                  </select>
                </label>

                <label style={{ display: "grid", gap: 6 }}>
                  <div style={{ fontSize: 12, color: "#a5adbb" }}>Color</div>
                  <input
                    type="color"
                    value={rgbToHex(l.color)}
                    onChange={(e) => updateLayer(l.id, { color: hexToRgb(e.target.value) })}
                  />
                </label>

                <label style={{ display: "grid", gap: 6 }}>
                  <div style={{ fontSize: 12, color: "#a5adbb" }}>
                    Opacity: {l.opacity.toFixed(2)}
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={l.opacity}
                    onChange={(e) =>
                      updateLayer(l.id, { opacity: clamp(Number(e.target.value), 0, 1) })
                    }
                  />
                </label>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
