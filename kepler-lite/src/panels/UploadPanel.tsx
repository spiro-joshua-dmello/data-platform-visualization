import React from "react";
import Papa from "papaparse";
import { useAppStore } from "../store";
import { uid } from "../utils";
import type { Dataset } from "../types";

function niceName(fileName: string) {
  return fileName.replace(/\.[^.]+$/, "");
}

export function UploadPanel() {
  const { addDataset, addLayer } = useAppStore();

  async function handleGeoJSON(file: File) {
    const text = await file.text();
    const json = JSON.parse(text);

    const ds: Dataset = {
      id: uid(),
      name: niceName(file.name),
      type: "geojson",
      data: json,
      createdAt: new Date().toISOString(),
    };

    addDataset(ds);

    addLayer({
      id: uid(),
      datasetId: ds.id,
      name: `${ds.name} (geojson)`,
      kind: "geojson",
      visible: true,
      opacity: 0.65,
      color: [80, 160, 255],
      radius: 30,
      lineWidth: 2,
    });
  }

  async function handleCSV(file: File) {
    const text = await file.text();
    const parsed = Papa.parse(text, { header: true, dynamicTyping: true, skipEmptyLines: true });

    const rows = (parsed.data as any[])
      .map((r) => {
        const lat = Number(r.lat ?? r.latitude ?? r.location_latitude);
        const lng = Number(r.lng ?? r.lon ?? r.longitude ?? r.location_longitude);
        return { ...r, lat, lng };
      })
      .filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lng));

    const ds: Dataset = {
      id: uid(),
      name: niceName(file.name),
      type: "csv-points",
      data: rows,
      createdAt: new Date().toISOString(),
    };

    addDataset(ds);

    addLayer({
      id: uid(),
      datasetId: ds.id,
      name: `${ds.name} (points)`,
      kind: "points",
      visible: true,
      opacity: 0.8,
      color: [0, 220, 160],
      radius: 25,
      lineWidth: 2,
    });
  }

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ fontSize: 12, color: "#a5adbb" }}>
        Upload GeoJSON or CSV with <code>lat/lng</code> (or <code>latitude/longitude</code>).
      </div>

      <label style={{ display: "grid", gap: 6 }}>
        <div style={{ fontWeight: 600 }}>GeoJSON</div>
        <input
          type="file"
          accept=".geojson,.json,application/geo+json"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleGeoJSON(f);
            e.currentTarget.value = "";
          }}
        />
      </label>

      <label style={{ display: "grid", gap: 6 }}>
        <div style={{ fontWeight: 600 }}>CSV points</div>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleCSV(f);
            e.currentTarget.value = "";
          }}
        />
      </label>
    </div>
  );
}
