import React from "react";
import { useAppStore } from "../store";

const KIND_ICON: Record<string, string> = {
  point:   "⬤",
  line:    "╌",
  polygon: "⬡",
  mixed:   "◈",
};

const KIND_COLOR: Record<string, string> = {
  point:   "#3b82f6",
  line:    "#f59e0b",
  polygon: "#10b981",
  mixed:   "#8b5cf6",
};

export function EditPanel() {
  const { datasets, activeDatasetId, setActiveDatasetId } = useAppStore();

  const activeDataset = datasets.find((d) => d.id === activeDatasetId) ?? null;

  // Only datasets that are on the map (in store) can be edited
  const editableDatasets = datasets.filter((d) => d.renderType);

  function handleActivate(id: string) {
    // If already active, deactivate
    if (activeDatasetId === id) {
      setActiveDatasetId(null);
    } else {
      setActiveDatasetId(id);
    }
  }

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div>
        <h4 style={{ margin: "0 0 4px", fontSize: 13, fontWeight: 700 }}>Edit Features</h4>
        <p style={{ margin: 0, fontSize: 12, color: "#a5adbb", lineHeight: 1.5 }}>
          Select a dataset below to activate edit mode. A toolbar will appear on the map.
        </p>
      </div>

      {editableDatasets.length === 0 && (
        <div style={{
          fontSize: 12, color: "#a5adbb", padding: "20px 0", textAlign: "center",
          border: "1px dashed #232832", borderRadius: 8,
        }}>
          No datasets on map yet.
          <br />Upload or add a dataset first.
        </div>
      )}

      <div style={{ display: "grid", gap: 8 }}>
        {editableDatasets.map((ds) => {
          const isActive = activeDatasetId === ds.id;
          const kind = ds.renderType ?? "mixed";

          return (
            <div
              key={ds.id}
              style={{
                border: `1px solid ${isActive ? "#3b82f6" : "#232832"}`,
                background: isActive ? "#0d1f3c" : "#15181d",
                borderRadius: 10,
                padding: "10px 12px",
                display: "grid",
                gap: 10,
                transition: "all 0.15s",
              }}
            >
              {/* Dataset name + kind */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{
                    fontWeight: 650, fontSize: 13,
                    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                  }}
                    title={ds.name}
                  >
                    {ds.name}
                  </div>
                  <div style={{ marginTop: 3, display: "flex", gap: 6, alignItems: "center" }}>
                    <span style={{
                      background: KIND_COLOR[kind] ?? "#555",
                      color: "#fff", borderRadius: 4,
                      padding: "1px 6px", fontSize: 11, fontWeight: 600,
                    }}>
                      {KIND_ICON[kind]} {kind}
                    </span>
                  </div>
                </div>

                <button
                  onClick={() => handleActivate(ds.id)}
                  style={{
                    padding: "7px 14px",
                    background: isActive ? "#ef4444" : "#3b82f6",
                    border: "none",
                    borderRadius: 7,
                    color: "#fff",
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                    flexShrink: 0,
                  }}
                >
                  {isActive ? "⏹ Exit edit" : "✏️ Edit"}
                </button>
              </div>

              {/* When active: show instructions */}
              {isActive && (
                <div style={{
                  background: "#0a1628",
                  border: "1px solid #1e3a5f",
                  borderRadius: 7,
                  padding: "10px 12px",
                  display: "grid",
                  gap: 6,
                }}>
                  <div style={{ fontSize: 12, color: "#60a5fa", fontWeight: 600 }}>
                    ✅ Edit mode active
                  </div>
                  <div style={{ fontSize: 11, color: "#a5adbb", lineHeight: 1.6 }}>
                    A toolbar has appeared at the top of the map.
                    <br />
                    {kind === "point" && <>
                      <strong style={{ color: "#e7eaf0" }}>↖ Select</strong> — click a point to edit its attributes or delete it<br />
                      <strong style={{ color: "#e7eaf0" }}>⟳ Load</strong> — load points as draggable markers to move them<br />
                      <strong style={{ color: "#e7eaf0" }}>+ Point</strong> — click anywhere on the map to add a new point
                    </>}
                    {kind === "line" && <>
                      <strong style={{ color: "#e7eaf0" }}>↖ Select</strong> — click a line to edit its attributes or delete it<br />
                      <strong style={{ color: "#e7eaf0" }}>⟳ Load</strong> — load vertices as draggable handles to reshape lines<br />
                      <strong style={{ color: "#e7eaf0" }}>✏ Line</strong> — click to draw a new line, then confirm
                    </>}
                    {kind === "polygon" && <>
                      <strong style={{ color: "#e7eaf0" }}>↖ Select</strong> — click a polygon to edit its attributes or delete it<br />
                      <strong style={{ color: "#e7eaf0" }}>⟳ Load</strong> — load vertices as draggable handles to reshape polygons<br />
                      <strong style={{ color: "#e7eaf0" }}>⬡ Polygon</strong> — click to draw a new polygon, then confirm
                    </>}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
