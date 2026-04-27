// correct order
import React, { useMemo, useState } from "react";
import { inspectDataset, uploadDataset, type ApiError, type UploadResponse } from "../api";
import { useAppStore } from "../store";
import type { Dataset, LayerConfig, RenderType, LayerType } from "../types";

const MAX_MB = 2048;

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
  const [selectedWkt, setSelectedWkt] = useState("");
  const [hasWkt, setHasWkt] = useState(false);
  const [selectedH3, setSelectedH3] = useState("");
  const [hasH3, setHasH3] = useState(false);
  const [suggestedLayerType, setSuggestedLayerType] = useState<LayerType>("fill");
  const [renderType, setRenderType] = useState<RenderType | undefined>(undefined);
  const [inspecting, setInspecting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const canUpload = useMemo(() => {
    if (!file || uploading || inspecting) return false;
    if (fileType === "csv") return hasH3 ? Boolean(selectedH3) : hasWkt ? true : Boolean(selectedLat && selectedLng);
    return true;
  }, [file, fileType, selectedLat, selectedLng, hasWkt, hasH3, selectedH3, uploading, inspecting]);

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
        setSelectedWkt(result.suggestions?.wktColumn ?? "");
        setHasH3(!!(result as any).hasH3Column);
        setSelectedH3((result.suggestions as any)?.h3Column ?? "");
        if ((result as any).hasH3Column) {
          setSuggestedLayerType("fill");
          setRenderType("polygon");
          setInfo(`CSV with H3 indexes detected — ${result.columns.length} column(s).`);
        } else {
          setHasWkt(!!result.hasWktColumn);
          setSuggestedLayerType(result.hasWktColumn ? "line" : "circle");
          setRenderType(result.hasWktColumn ? "line" : "point");
          setInfo(`CSV detected with ${result.columns.length} column(s).`);
        }
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
    console.log("handleUpload state:", { hasH3, selectedH3, hasWkt, fileType });
    if (fileType === "csv" && !hasH3 && !hasWkt && (!selectedLat || !selectedLng)) {
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
        latColumn: fileType === "csv" && !hasWkt && !hasH3 ? selectedLat : undefined,
        lngColumn: fileType === "csv" && !hasWkt && !hasH3 ? selectedLng : undefined,
        wktColumn: fileType === "csv" && hasWkt ? selectedWkt : undefined,
        h3Column:  fileType === "csv" && hasH3  ? selectedH3  : undefined,
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
    setSelectedH3("");
    setHasH3(false);
    setSuggestedLayerType("fill");
    setRenderType(undefined);
    setProgress(0);
    setError("");
    setInfo("");
  }

  return (
    <div style={{
      padding: 16,
      display: "grid",
      gap: 12,
      background: "var(--panel-2)",
      border: "1px solid var(--border)",
      borderRadius: 8,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ margin: 0, color: "var(--text)", fontSize: 14, fontWeight: 700 }}>Upload dataset</h3>
        <button onClick={() => setUploadOpen(false)} disabled={uploading}>Close</button>
      </div>

      <div style={{ fontSize: 12, color: "var(--muted)" }}>
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
        style={{ color: "var(--muted)", fontSize: 12 }}
      />

      {file && (
        <div style={{ fontSize: 12, color: "var(--muted)", display: "grid", gap: 3 }}>
          <div><span style={{ color: "var(--text)", fontWeight: 600 }}>File:</span> {file.name}</div>
          <div><span style={{ color: "var(--text)", fontWeight: 600 }}>Size:</span> {(file.size / (1024 * 1024)).toFixed(2)} MB</div>
          {fileType && <div><span style={{ color: "var(--text)", fontWeight: 600 }}>Type:</span> {fileType}</div>}
          <div><span style={{ color: "var(--text)", fontWeight: 600 }}>Render as:</span> {suggestedLayerType}</div>
          {renderType && <div><span style={{ color: "var(--text)", fontWeight: 600 }}>Geometry kind:</span> {renderType}</div>}
        </div>
      )}

      {inspecting && <div style={{ fontSize: 12, color: "var(--muted)" }}>Inspecting file…</div>}

      {fileType === "csv" && columns.length > 0 && (
        <div style={{ display: "grid", gap: 10 }}>
          {/* Geometry type selector — always visible for CSV */}
          <label style={{ display: "grid", gap: 4, fontSize: 13, color: "var(--text)" }}>
            <span>Geometry type</span>
            <select
              value={hasH3 ? "h3" : hasWkt ? "wkt" : "latlon"}
              onChange={(e) => {
                const v = e.target.value;
                setHasH3(v === "h3");
                setHasWkt(v === "wkt");
                if (v === "h3") { setSuggestedLayerType("fill"); setRenderType("polygon"); }
                if (v === "wkt") { setSuggestedLayerType("line"); setRenderType("line"); }
                if (v === "latlon") { setSuggestedLayerType("circle"); setRenderType("point"); }
              }}
            >
              <option value="latlon">Lat / Lon columns</option>
              <option value="wkt">WKT geometry column</option>
              <option value="h3">H3 index column</option>
            </select>
          </label>

          {hasH3 ? (
            <label style={{ display: "grid", gap: 4, fontSize: 13, color: "var(--text)" }}>
              <span>H3 index column</span>
              <select value={selectedH3} onChange={(e) => setSelectedH3(e.target.value)}>
                <option value="">Select H3 column</option>
                {columns.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <span style={{ fontSize: 11, color: "var(--muted)" }}>
                Hexagon cells will be converted to polygon geometries
              </span>
            </label>
          ) : hasWkt ? (
            <label style={{ display: "grid", gap: 4, fontSize: 13, color: "var(--text)" }}>
              <span>WKT geometry column</span>
              <select value={selectedWkt} onChange={(e) => setSelectedWkt(e.target.value)}>
                {columns.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
          ) : (
            <>
              <label style={{ display: "grid", gap: 4, fontSize: 13, color: "var(--text)" }}>
                <span>Latitude column</span>
                <select value={selectedLat} onChange={(e) => setSelectedLat(e.target.value)}>
                  <option value="">Select latitude column</option>
                  {columns.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
              <label style={{ display: "grid", gap: 4, fontSize: 13, color: "var(--text)" }}>
                <span>Longitude column</span>
                <select value={selectedLng} onChange={(e) => setSelectedLng(e.target.value)}>
                  <option value="">Select longitude column</option>
                  {columns.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
            </>
          )}
        </div>
      )}

      {uploading && (
        <div style={{ display: "grid", gap: 6 }}>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>
            {progress < 80
              ? `Uploading… ${progress}%`
              : progress < 100
              ? `Processing on server… this may take several minutes for large files`
              : `Finalizing…`}
          </div>
          <div style={{ width: "100%", height: 6, background: "var(--border)", borderRadius: 999, overflow: "hidden" }}>
            <div style={{
              width: `${Math.max(progress, 2)}%`,
              height: "100%",
              background: progress >= 80 ? "#f59e0b" : "#3b82f6",
              transition: "width 120ms ease",
            }} />
          </div>
        </div>
      )}

      {info && (
        <div style={{
          color: "#22c55e",
          background: "#0a1f0e",
          border: "1px solid #166534",
          padding: "8px 10px",
          borderRadius: 6,
          fontSize: 12,
        }}>
          {info}
        </div>
      )}

      {error && (
        <div style={{
          color: "#f87171",
          background: "#1f1315",
          border: "1px solid #7f1d1d",
          padding: "8px 10px",
          borderRadius: 6,
          fontSize: 12,
          whiteSpace: "pre-wrap",
        }}>
          {error}
        </div>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={() => void handleUpload()} disabled={!canUpload}>Upload</button>
        <button onClick={handleReset} disabled={uploading}>Reset</button>
      </div>
    </div>
  );
}
