import React from "react";
import { useAppStore } from "../store";

export function DatasetPanel() {
  const { datasets, removeDataset } = useAppStore();

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h4 style={{ margin: 0 }}>Datasets</h4>
        <div style={{ fontSize: 12, color: "#a5adbb" }}>{datasets.length}</div>
      </div>

      {datasets.length === 0 ? (
        <div style={{ fontSize: 12, color: "#a5adbb" }}>No datasets yet.</div>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {datasets.map((d) => (
            <div
              key={d.id}
              style={{
                border: "1px solid var(--border)",
                background: "var(--panel-2)",
                borderRadius: 10,
                padding: 10,
                display: "grid",
                gap: 6,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <div style={{ fontWeight: 650 }}>{d.name}</div>
                <button onClick={() => removeDataset(d.id)}>Delete</button>
              </div>
              <div style={{ fontSize: 12, color: "#a5adbb" }}>
                {d.type} · {new Date(d.createdAt).toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
