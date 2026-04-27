import React, { useState } from "react";
import { updateFeature } from "../api";

type Props = {
  featureId: string;
  table: string;
  properties: Record<string, any>;
  onClose: () => void;
  onSaved: () => void;
};

export function FeatureEditor({ featureId, table, properties, onClose, onSaved }: Props) {
  const [props, setProps] = useState({ ...properties });
  const [saving, setSaving] = useState(false);

  // Filter out internal keys
  const keys = Object.keys(props).filter((k) => !k.startsWith("_") && k !== "dataset_id");

  async function handleSave() {
    setSaving(true);
    try {
      await updateFeature(table, featureId, { properties: props });
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999,
    }}>
      <div style={{
        background: "var(--panel)", border: "1px solid var(--border)",
        borderRadius: 12, padding: 20, width: 400, maxHeight: "80vh",
        overflow: "auto", display: "grid", gap: 12,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <h4 style={{ margin: 0 }}>Edit Attributes</h4>
          <button onClick={onClose}>✕</button>
        </div>
        <div style={{ fontSize: 11, color: "var(--muted)" }}>ID: {featureId}</div>

        {keys.map((k) => (
          <label key={k} style={{ display: "grid", gap: 4, fontSize: 13 }}>
            <span style={{ color: "var(--muted)" }}>{k}</span>
            <input
              value={String(props[k] ?? "")}
              onChange={(e) => setProps({ ...props, [k]: e.target.value })}
              style={{ padding: "6px 8px", background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text)" }}
            />
          </label>
        ))}

        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button onClick={handleSave} disabled={saving} style={{ flex: 1 }}>
            {saving ? "Saving…" : "Save"}
          </button>
          <button onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}