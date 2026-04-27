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
        <div style={{ fontSize: 12, color: "#a5adbb" }}>No datasets uploaded yet.</div>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {datasets.map((ds) => (
            <div
              key={ds.id}
              style={{
                border: "1px solid var(--border)",
                background: "var(--panel-2)",
                borderRadius: 10,
                padding: 10,
                display: "grid",
                gap: 8,
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
                    title={ds.name}
                  >
                    {ds.name}
                  </div>

                  <div style={{ fontSize: 12, color: "#a5adbb" }}>
                    type: {ds.type}
                  </div>

                  {ds.renderType && (
                    <div style={{ fontSize: 12, color: "#a5adbb" }}>
                      render type: {ds.renderType}
                    </div>
                  )}

                  {"datasetId" in ds && ds.datasetId && (
                    <div style={{ fontSize: 12, color: "#a5adbb", wordBreak: "break-all" }}>
                      dataset_id: {ds.datasetId}
                    </div>
                  )}
                </div>

                <div>
                  <button onClick={() => removeDataset(ds.id)}>Delete</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}