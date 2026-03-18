// correct order
import React, { useMemo, useState } from "react";
import { inspectDataset, uploadDataset, type ApiError, type UploadResponse } from "../api";
import { useAppStore } from "../store";
import type { Dataset, LayerConfig, RenderType, LayerType } from "../types";

const MAX_MB = 2048;
// remove CHUNKED_THRESHOLD from here entirely — it lives in api.ts

function prettyError(err: unknown): string {
  const e = err as ApiError | undefined;
  return e?.error ?? "Something went wrong.";
}

function fallbackLayerType(renderType?: RenderType): LayerType {
  if (renderType === "point") return "circle";
  if (renderType === "line") return "line";
  return "fill";
}

export function UploadPanel() {
  const { addDataset, addLayer, setUploadOpen, setViewState } = useAppStore();

  const [file, setFile] = useState<File | null>(null);
  const [fileType, setFileType] = useState<"csv" | "geojson" | null>(null);
  const [columns, setColumns] = useState<string[]>([]);
  const [selectedLat, setSelectedLat] = useState("");
  const [selectedLng, setSelectedLng] = useState("");
  const [suggestedLayerType, setSuggestedLayerType] = useState<LayerType>("fill");
  const [renderType, setRenderType] = useState<RenderType | undefined>(undefined);
  const [inspecting, setInspecting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const canUpload = useMemo(() => {
    if (!file || uploading || inspecting) return false;
    if (fileType === "csv") return Boolean(selectedLat && selectedLng);
    return true;
  }, [file, fileType, selectedLat, selectedLng, uploading, inspecting]);

  async function handlePickFile(nextFile: File) {
    setError("");
    setInfo("");
    setProgress(0);
    setFile(nextFile);
    setColumns([]);
    setSelectedLat("");
    setSelectedLng("");
    setFileType(null);
    setSuggestedLayerType("fill");
    setRenderType(undefined);

    const sizeMb = nextFile.size / (1024 * 1024);
    if (sizeMb > MAX_MB) {
      setError(`File is too large. Maximum supported size is ${MAX_MB} MB.`);
      return;
    }

    setInspecting(true);

    try {
      const result = await inspectDataset(nextFile);

      if (result.fileType === "csv") {
        setFileType("csv");
        setColumns(result.columns ?? []);
        setSelectedLat(result.suggestions?.latColumn ?? "");
        setSelectedLng(result.suggestions?.lngColumn ?? "");
        setSuggestedLayerType("circle");
        setRenderType("point");
        setInfo(`CSV detected with ${result.columns.length} column(s).`);
      } else {
        setFileType("geojson");
        const nextRenderType = result.renderType;
        const nextLayerType = result.suggestedLayerType ?? fallbackLayerType(nextRenderType);

        setSuggestedLayerType(nextLayerType);
        setRenderType(nextRenderType);

        setInfo(
          result.featureCount === -1
            ? `Large GeoJSON detected. Render as ${nextLayerType}.`
            : `GeoJSON detected with ${result.featureCount} feature(s). Render as ${nextLayerType}.`
        );
      }
    } catch (err) {
      console.error("Inspect failed:", err);
      setError(prettyError(err));
    } finally {
      setInspecting(false);
    }
  }

  function addUploadedDatasetAndLayer(resp: UploadResponse, originalFileName: string) {
    const datasetId = resp.datasetId;
    const layerId = `${datasetId}-layer`;

    const datasetEntry: Dataset = {
      id: datasetId,
      name: originalFileName,
      type: "vector-tile",
      datasetId,
      renderType: resp.renderType ?? renderType,
      bounds: resp.bounds ?? null,
    };

    const layerEntry: LayerConfig = {
      id: layerId,
      datasetId,
      name: originalFileName,
      type: (resp.suggestedLayerType ?? suggestedLayerType) as LayerType,
      visible: true,
      opacity: 1,
      color: [0, 128, 255],
    };

    addDataset(datasetEntry);
    addLayer(layerEntry);

    if (resp.bounds) {
      const [minLng, minLat, maxLng, maxLat] = resp.bounds;
      setViewState({
        longitude: (minLng + maxLng) / 2,
        latitude: (minLat + maxLat) / 2,
        zoom: 10,
        pitch: 0,
        bearing: 0,
      });
    }
  }

  async function handleUpload() {
    if (!file) return;

    if (fileType === "csv" && (!selectedLat || !selectedLng)) {
      setError("Please select latitude and longitude columns.");
      return;
    }

    setError("");
    setInfo("");
    setUploading(true);
    setProgress(0);

    try {
      const result = await uploadDataset({
        file,
        latColumn: fileType === "csv" ? selectedLat : undefined,
        lngColumn: fileType === "csv" ? selectedLng : undefined,
        onProgress: (pct) => setProgress(pct),
      });


      console.log("Upload result:", result);

      addUploadedDatasetAndLayer(result, file.name);
      setInfo(`Loaded successfully. Inserted ${result.inserted} record(s).`);

      setTimeout(() => {
        setUploadOpen(false);
      }, 300);
    } catch (err) {
      console.error("Upload failed:", err);
      setError(prettyError(err));
    } finally {
      setUploading(false);
    }
  }

  function handleReset() {
    setFile(null);
    setFileType(null);
    setColumns([]);
    setSelectedLat("");
    setSelectedLng("");
    setSuggestedLayerType("fill");
    setRenderType(undefined);
    setProgress(0);
    setError("");
    setInfo("");
  }

  return (
    <div
      style={{
        padding: 16,
        display: "grid",
        gap: 12,
        background: "#fff",
        border: "1px solid #ddd",
        borderRadius: 8,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ margin: 0 }}>Upload dataset</h3>
        <button onClick={() => setUploadOpen(false)} disabled={uploading}>
          Close
        </button>
      </div>

      <div style={{ fontSize: 13, color: "#555" }}>
        Supported: CSV, GeoJSON, JSON. Max file size: {MAX_MB} MB.
      </div>

      <input
        type="file"
        accept=".csv,.geojson,.json"
        onChange={(e) => {
          const nextFile = e.target.files?.[0];
          if (nextFile) void handlePickFile(nextFile);
        }}
        disabled={uploading || inspecting}
      />

      {file && (
        <div style={{ fontSize: 13, color: "#333", display: "grid", gap: 4 }}>
          <div>
            <b>File:</b> {file.name}
          </div>
          <div>
            <b>Size:</b> {(file.size / (1024 * 1024)).toFixed(2)} MB
          </div>
          {fileType && (
            <div>
              <b>Type:</b> {fileType}
            </div>
          )}
          <div>
            <b>Render as:</b> {suggestedLayerType}
          </div>
          {renderType && (
            <div>
              <b>Geometry kind:</b> {renderType}
            </div>
          )}
        </div>
      )}

      {inspecting && <div>Inspecting file…</div>}

      {fileType === "csv" && columns.length > 0 && (
        <div style={{ display: "grid", gap: 10 }}>
          <label style={{ display: "grid", gap: 4 }}>
            <span>Latitude column</span>
            <select value={selectedLat} onChange={(e) => setSelectedLat(e.target.value)}>
              <option value="">Select latitude column</option>
              {columns.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>

          <label style={{ display: "grid", gap: 4 }}>
            <span>Longitude column</span>
            <select value={selectedLng} onChange={(e) => setSelectedLng(e.target.value)}>
              <option value="">Select longitude column</option>
              {columns.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      
      {uploading && (
        <div style={{ display: "grid", gap: 6 }}>
          <div style={{ fontSize: 13 }}>
            {progress < 80
              ? `Uploading… ${progress}%`
              : progress < 100
              ? `Processing on server… this may take several minutes for large files`
              : `Finalizing…`}
          </div>
          <div style={{ width: "100%", height: 10, background: "#eee", borderRadius: 999, overflow: "hidden" }}>
            <div
              style={{
                width: `${Math.max(progress, 2)}%`,
                height: "100%",
                background: progress >= 80 ? "#f59e0b" : "#2f80ed",
                transition: "width 120ms ease",
              }}
            />
          </div>
        </div>
      )}

      {info && (
        <div
          style={{
            color: "#0f5132",
            background: "#d1e7dd",
            border: "1px solid #badbcc",
            padding: 10,
            borderRadius: 6,
            fontSize: 13,
          }}
        >
          {info}
        </div>
      )}

      {error && (
        <div
          style={{
            color: "#842029",
            background: "#f8d7da",
            border: "1px solid #f5c2c7",
            padding: 10,
            borderRadius: 6,
            fontSize: 13,
            whiteSpace: "pre-wrap",
          }}
        >
          {error}
        </div>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={() => void handleUpload()} disabled={!canUpload}>
          Upload
        </button>
        <button onClick={handleReset} disabled={uploading}>
          Reset
        </button>
      </div>
    </div>
  );
}