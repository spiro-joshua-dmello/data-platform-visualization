import React, { useState, useRef, useEffect } from "react";
import { useAppStore } from "../store";
import type { MapProject } from "../store";

// ─── Design tokens ────────────────────────────────────────────────────────────
const T = {
  card:      "rgba(255,255,255,0.96)",
  border:    "rgba(0,0,0,0.08)",
  shadow:    "0 4px 24px rgba(0,0,0,0.12), 0 1px 4px rgba(0,0,0,0.08)",
  text:      "#111827",
  textMuted: "#6b7280",
  textLight: "#9ca3af",
  hover:     "rgba(0,0,0,0.04)",
  hoverRed:  "rgba(239,68,68,0.08)",
  accent:    "#2563eb",
  green:     "#10b981",
  red:       "#ef4444",
  orange:    "#f97316",
  radius:    "16px",
  radiusSm:  "10px",
  radiusXs:  "6px",
  font:      "'Inter', -apple-system, system-ui, sans-serif",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  const m = Math.floor(diff / 60000);
  const h = Math.floor(diff / 3600000);
  const d = Math.floor(diff / 86400000);
  if (m < 1)  return "just now";
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  return `${d}d ago`;
}

// ─── Save-before-leave dialog ─────────────────────────────────────────────────
function SaveDialog({
  projectName,
  onSaveAndLeave,
  onLeaveWithout,
  onCancel,
}: {
  projectName: string;
  onSaveAndLeave: () => void;
  onLeaveWithout: () => void;
  onCancel: () => void;
}) {
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9999,
      background: "rgba(0,0,0,0.4)",
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div style={{
        background: T.card, borderRadius: T.radius,
        border: `1px solid ${T.border}`,
        boxShadow: "0 24px 64px rgba(0,0,0,0.2)",
        padding: 24, width: 340, fontFamily: T.font,
      }}>
        <div style={{
          width: 44, height: 44, borderRadius: 12,
          background: "rgba(245,158,11,0.1)",
          display: "flex", alignItems: "center", justifyContent: "center",
          marginBottom: 16,
        }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
              stroke={T.orange} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>

        <div style={{ fontSize: 16, fontWeight: 700, color: T.text, marginBottom: 8 }}>
          Unsaved changes
        </div>
        <div style={{ fontSize: 13, color: T.textMuted, lineHeight: 1.5, marginBottom: 24 }}>
          <strong style={{ color: T.text }}>{projectName}</strong> has unsaved changes.
          Do you want to save before leaving?
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <button onClick={onSaveAndLeave} style={{
            padding: "10px 0", borderRadius: T.radiusSm, border: "none",
            background: T.accent, color: "white", cursor: "pointer",
            fontSize: 13, fontWeight: 600, fontFamily: T.font,
          }}>
            Save and continue
          </button>
          <button onClick={onLeaveWithout} style={{
            padding: "10px 0", borderRadius: T.radiusSm,
            border: `1px solid ${T.border}`,
            background: "none", color: T.text, cursor: "pointer",
            fontSize: 13, fontWeight: 500, fontFamily: T.font,
          }}>
            Leave without saving
          </button>
          <button onClick={onCancel} style={{
            padding: "8px 0", borderRadius: T.radiusSm, border: "none",
            background: "none", color: T.textMuted, cursor: "pointer",
            fontSize: 13, fontFamily: T.font,
          }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Icon button ──────────────────────────────────────────────────────────────
function IconBtn({
  onClick, title, children, danger = false,
}: {
  onClick: (e: React.MouseEvent) => void;
  title?: string;
  children: React.ReactNode;
  danger?: boolean;
}) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={onClick}
      title={title}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        width: 24, height: 24, display: "flex", alignItems: "center",
        justifyContent: "center", borderRadius: T.radiusXs, border: "none",
        cursor: "pointer", padding: 0, flexShrink: 0,
        background: hov ? (danger ? T.hoverRed : T.hover) : "transparent",
        color: hov ? (danger ? T.red : T.text) : T.textMuted,
        transition: "background 0.12s, color 0.12s",
      }}
    >
      {children}
    </button>
  );
}

// ─── Inline rename input ──────────────────────────────────────────────────────
function RenameInput({
  initial, onCommit, onCancel,
}: {
  initial: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const [val, setVal] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.select(); }, []);

  return (
    <input
      ref={ref}
      value={val}
      onChange={(e) => setVal(e.target.value)}
      onBlur={() => onCommit(val.trim() || initial)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onCommit(val.trim() || initial);
        if (e.key === "Escape") onCancel();
        e.stopPropagation();
      }}
      onClick={(e) => e.stopPropagation()}
      style={{
        flex: 1, fontSize: 13, fontWeight: 500, fontFamily: T.font,
        color: T.text, background: "white", border: `1.5px solid ${T.accent}`,
        borderRadius: 6, padding: "2px 6px", outline: "none", minWidth: 0,
      }}
    />
  );
}

// ─── Single project row ───────────────────────────────────────────────────────
function ProjectRow({
  project, isActive, onRequestSwitch,
}: {
  project: MapProject;
  isActive: boolean;
  onRequestSwitch: (id: string) => void;
}) {
  const { saveCurrentProject, deleteProject, renameProject } = useAppStore();
  const [hov,        setHov]        = useState(false);
  const [renaming,   setRenaming]   = useState(false);
  const [saved,      setSaved]      = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);

  function handleSave(e: React.MouseEvent) {
    e.stopPropagation();
    saveCurrentProject();
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  }

  function handleDelete(e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirmDel) { setConfirmDel(true); return; }
    deleteProject(project.id);
  }

  function handleRename(name: string) {
    renameProject(project.id, name);
    setRenaming(false);
  }

  return (
    <div
      onClick={() => !isActive && onRequestSwitch(project.id)}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => { setHov(false); setConfirmDel(false); }}
      style={{
        display: "flex", flexDirection: "column", gap: 4,
        padding: "10px 12px", borderRadius: T.radiusSm,
        cursor: isActive ? "default" : "pointer",
        background: isActive ? "rgba(37,99,235,0.06)" : hov ? T.hover : "transparent",
        border: `1.5px solid ${isActive ? "rgba(37,99,235,0.25)" : "transparent"}`,
        transition: "background 0.12s, border-color 0.12s",
        userSelect: "none",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <div style={{
          width: 7, height: 7, borderRadius: "50%", flexShrink: 0,
          background: isActive ? T.accent : "transparent",
          border: `1.5px solid ${isActive ? T.accent : T.textLight}`,
          transition: "background 0.15s, border-color 0.15s",
        }} />

        {renaming ? (
          <RenameInput
            initial={project.name}
            onCommit={handleRename}
            onCancel={() => setRenaming(false)}
          />
        ) : (
          <span
            onDoubleClick={(e) => { e.stopPropagation(); setRenaming(true); }}
            style={{
              flex: 1, fontSize: 13, fontWeight: isActive ? 600 : 500,
              fontFamily: T.font, color: isActive ? T.accent : T.text,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}
            title="Double-click to rename"
          >
            {project.name}
          </span>
        )}

        {(hov || isActive) && !renaming && (
          <div style={{ display: "flex", gap: 2, flexShrink: 0 }}>
            {isActive && (
              <IconBtn onClick={handleSave} title="Save current state to this project">
                {saved ? (
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                    <path d="M2 8l4 4 8-8" stroke={T.green} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                ) : (
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                    <rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.5"/>
                    <rect x="5" y="2" width="6" height="4" rx="0.5" fill="currentColor" opacity="0.3"/>
                    <rect x="4" y="9" width="8" height="4" rx="1" fill="currentColor" opacity="0.3"/>
                  </svg>
                )}
              </IconBtn>
            )}
            <IconBtn onClick={(e) => { e.stopPropagation(); setRenaming(true); }} title="Rename">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                <path d="M11 2l3 3-8 8H3v-3l8-8z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
              </svg>
            </IconBtn>
            <IconBtn onClick={handleDelete} title={confirmDel ? "Click again to confirm" : "Delete project"} danger>
              {confirmDel ? (
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                  <path d="M8 3v5m0 3v1" stroke={T.red} strokeWidth="2" strokeLinecap="round"/>
                </svg>
              ) : (
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                  <path d="M3 5h10M6 5V3h4v2M6 8v5M10 8v5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
            </IconBtn>
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 10, paddingLeft: 13 }}>
        <span style={{ fontSize: 11, color: T.textLight, fontFamily: T.font }}>
          {project.layers.length} {project.layers.length === 1 ? "layer" : "layers"}
        </span>
        <span style={{ fontSize: 11, color: T.textLight, fontFamily: T.font }}>·</span>
        <span style={{ fontSize: 11, color: T.textLight, fontFamily: T.font }}>
          {project.datasets.length} {project.datasets.length === 1 ? "dataset" : "datasets"}
        </span>
        <span style={{ fontSize: 11, color: T.textLight, fontFamily: T.font }}>·</span>
        <span style={{ fontSize: 11, color: T.textLight, fontFamily: T.font }}>
          saved {timeAgo(project.updatedAt)}
        </span>
      </div>
    </div>
  );
}

// ─── New project row ──────────────────────────────────────────────────────────
function NewProjectRow({ onCreate }: { onCreate: (name: string) => void }) {
  const [creating, setCreating] = useState(false);
  const [name,     setName]     = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function open() { setCreating(true); setName(""); }
  useEffect(() => { if (creating) inputRef.current?.focus(); }, [creating]);

  function commit() {
    const trimmed = name.trim();
    if (trimmed) onCreate(trimmed);
    setCreating(false);
    setName("");
  }

  if (creating) {
    return (
      <div style={{ display: "flex", gap: 6, alignItems: "center", padding: "6px 12px" }}>
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
          <path d="M8 3v10M3 8h10" stroke={T.accent} strokeWidth="2" strokeLinecap="round"/>
        </svg>
        <input
          ref={inputRef}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Project name…"
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") { setCreating(false); setName(""); }
          }}
          onBlur={commit}
          style={{
            flex: 1, fontSize: 13, fontFamily: T.font, color: T.text,
            background: "white", border: `1.5px solid ${T.accent}`,
            borderRadius: 6, padding: "3px 8px", outline: "none",
          }}
        />
      </div>
    );
  }

  return (
    <button
      onClick={open}
      style={{
        display: "flex", alignItems: "center", gap: 8,
        width: "100%", padding: "8px 12px", background: "none",
        border: `1.5px dashed ${T.border}`, borderRadius: T.radiusSm,
        cursor: "pointer", fontFamily: T.font, fontSize: 13, color: T.textMuted,
        transition: "border-color 0.12s, color 0.12s",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.borderColor = T.accent;
        (e.currentTarget as HTMLElement).style.color = T.accent;
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.borderColor = T.border;
        (e.currentTarget as HTMLElement).style.color = T.textMuted;
      }}
    >
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
        <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
      </svg>
      New project
    </button>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────
export function ProjectsPanel() {
  const {
    projects, activeProjectId,
    createProject, switchProject, saveCurrentProject,
  } = useAppStore();

  const [collapsed, setCollapsed] = useState(false);

  type PendingAction =
    | { type: "switch"; id: string }
    | { type: "create"; name: string };

  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);

  const activeProject = projects.find((p) => p.id === activeProjectId);

  function hasUnsavedChanges(): boolean {
    if (!activeProjectId || !activeProject) return false;
    const s = useAppStore.getState();
    const storedLayerSig = JSON.stringify(activeProject.layers);
    const liveLayerSig   = JSON.stringify(s.layers);
    const storedDsIds    = activeProject.datasets.map((d) => d.id).sort().join(",");
    const liveDsIds      = s.datasets.map((d) => d.id).sort().join(",");
    return storedLayerSig !== liveLayerSig || storedDsIds !== liveDsIds;
  }

  function requestSwitch(id: string) {
    if (id === activeProjectId) return;
    if (hasUnsavedChanges()) {
      setPendingAction({ type: "switch", id });
    } else {
      switchProject(id);
    }
  }

  function requestCreate(name: string) {
    if (hasUnsavedChanges()) {
      setPendingAction({ type: "create", name });
    } else {
      doCreate(name);
    }
  }

  function doCreate(name: string) {
    // Wipe live state so the new project starts completely blank
    useAppStore.setState({
      datasets:    [],
      layers:      [],
      annotations: [],
      mapPins:     [],
      filterRules: {},
    });
    createProject(name);
  }

  function handleSaveAndContinue() {
    saveCurrentProject();
    executePending();
  }

  function executePending() {
    if (!pendingAction) return;
    if (pendingAction.type === "switch") {
      switchProject(pendingAction.id);
    } else {
      doCreate(pendingAction.name);
    }
    setPendingAction(null);
  }

  return (
    <>
      {pendingAction && activeProject && (
        <SaveDialog
          projectName={activeProject.name}
          onSaveAndLeave={handleSaveAndContinue}
          onLeaveWithout={() => { executePending(); }}
          onCancel={() => setPendingAction(null)}
        />
      )}

      <div style={{
        background: T.card, borderRadius: T.radius,
        border: `1px solid ${T.border}`, boxShadow: T.shadow, overflow: "hidden",
      }}>
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "10px 14px",
          borderBottom: collapsed ? "none" : `1px solid ${T.border}`,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <rect x="1" y="4" width="14" height="10" rx="2" stroke={T.textMuted} strokeWidth="1.5"/>
              <path d="M1 7h14" stroke={T.textMuted} strokeWidth="1.2"/>
              <path d="M5 4V2.5A1.5 1.5 0 016.5 1h3A1.5 1.5 0 0111 2.5V4" stroke={T.textMuted} strokeWidth="1.3"/>
            </svg>
            <span style={{ fontSize: 12, fontWeight: 700, color: T.text, fontFamily: T.font, letterSpacing: "0.02em" }}>
              PROJECTS
            </span>
            {projects.length > 0 && (
              <span style={{
                fontSize: 10, fontWeight: 600, fontFamily: T.font,
                background: "rgba(0,0,0,0.06)", color: T.textMuted,
                borderRadius: 999, padding: "1px 6px",
              }}>
                {projects.length}
              </span>
            )}
          </div>
          <IconBtn
            onClick={(e) => { e.stopPropagation(); setCollapsed(!collapsed); }}
            title={collapsed ? "Expand" : "Collapse"}
          >
            {collapsed
              ? <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              : <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M4 10l4-4 4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            }
          </IconBtn>
        </div>

        {/* Body */}
        {!collapsed && (
          <div style={{ padding: "8px 8px 10px" }}>
            {projects.length === 0 ? (
              <div style={{
                padding: "18px 8px", textAlign: "center",
                color: T.textLight, fontSize: 12, fontFamily: T.font,
              }}>
                <div style={{ fontSize: 24, marginBottom: 6 }}>🗂️</div>
                No projects yet.<br/>Create one to save your map state.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 2, marginBottom: 8 }}>
                {projects.map((p) => (
                  <ProjectRow
                    key={p.id}
                    project={p}
                    isActive={p.id === activeProjectId}
                    onRequestSwitch={requestSwitch}
                  />
                ))}
              </div>
            )}
            <NewProjectRow onCreate={requestCreate} />
          </div>
        )}
      </div>
    </>
  );
}
