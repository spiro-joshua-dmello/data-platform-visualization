import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Dataset, LayerConfig, ViewState, Bounds } from "./types";

export type ActiveTool = "pointer" | "annotate" | "measure" | "pan" | "upload";

export type Annotation = {
  id: string;
  text: string;
  color: string;
  createdAt: number;
};

export type MapPin = {
  id: string;
  lng: number;
  lat: number;
  label: string;
  color: string;
  createdAt: number;
};

type ZoomTarget = {
  longitude: number;
  latitude: number;
  zoom: number;
  id: number;
};

export type FilterRule = { col: string; op: string; val: string; vals?: string[] };

export type MapProject = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  datasets: Dataset[];
  layers: LayerConfig[];
  viewState: ViewState;
  annotations: Annotation[];
  mapPins: MapPin[];
  filterRules: Record<string, { rules: FilterRule[]; matchMode: "AND"|"OR"; uiRules: FilterRule[] }>;
};

type AppState = {
  datasets: Dataset[];
  layers: LayerConfig[];
  viewState: ViewState;
  annotations: Annotation[];
  mapPins: MapPin[];
  activeTool: ActiveTool;
  mapContextMenu: { x: number; y: number; lat: number; lng: number } | null;
  setMapContextMenu: (m: { x: number; y: number; lat: number; lng: number } | null) => void;

  zoomTarget: ZoomTarget | null;
  setZoomTarget: (target: { longitude: number; latitude: number; zoom: number }) => void;

  uploadOpen: boolean;
  setUploadOpen: (open: boolean) => void;

  removedFromMapIds: Set<string>;

  activeDatasetId: string | null;
  setActiveDatasetId: (id: string | null) => void;

  addDataset: (d: Dataset) => void;
  removeDataset: (id: string) => void;

  addLayer: (l: LayerConfig) => void;
  updateLayer: (id: string, patch: Partial<LayerConfig>) => void;
  removeLayer: (id: string) => void;

  setViewState: (patch: Partial<ViewState>) => void;
  setActiveTool: (t: ActiveTool) => void;

  addAnnotation: (a: Annotation) => void;
  updateAnnotation: (id: string, patch: Partial<Annotation>) => void;
  removeAnnotation: (id: string) => void;

  addMapPin: (p: MapPin) => void;
  updateMapPin: (id: string, patch: Partial<MapPin>) => void;
  removeMapPin: (id: string) => void;

  // ── Measure tool ──────────────────────────────────────────────────────────
  measureMode: "line" | "polygon";
  setMeasureMode: (m: "line" | "polygon") => void;
  measurePoints: [number, number][];
  setMeasurePoints: (pts: [number, number][]) => void;

  // ── Filter rules ──────────────────────────────────────────────────────────
  filterRules: Record<string, { rules: FilterRule[]; matchMode: "AND"|"OR"; uiRules: FilterRule[] }>;
  setFilterRules: (datasetId: string, rules: FilterRule[], matchMode?: "AND"|"OR") => void;
  setUiRules: (datasetId: string, uiRules: FilterRule[]) => void;
  basemap: string;
  setBasemap: (b: string) => void;

  // ── Projects ──────────────────────────────────────────────────────────────
  projects: MapProject[];
  activeProjectId: string | null;
  createProject: (name: string) => void;
  switchProject: (id: string) => void;
  saveCurrentProject: () => void;
  deleteProject: (id: string) => void;
  renameProject: (id: string, name: string) => void;
};

let _zoomTargetId = 0;

function uid() { return Math.random().toString(36).slice(2, 10); }

export const useAppStore = create<AppState>()(persist((set) => ({
  datasets: [],
  layers: [],
  annotations: [],
  mapPins: [],
  activeTool: "pointer",
  mapContextMenu: null,
  setMapContextMenu: (m) => set({ mapContextMenu: m }),
  viewState: {
    longitude: 77.5946,
    latitude: 12.9716,
    zoom: 10,
    pitch: 0,
    bearing: 0,
  },

  zoomTarget: null,
  setZoomTarget: (target) =>
    set({
      zoomTarget: {
        longitude: target.longitude,
        latitude: target.latitude,
        zoom: target.zoom,
        id: ++_zoomTargetId,
      },
    }),
  
  uploadOpen: false,
  setUploadOpen: (open) => set({ uploadOpen: open }),

  removedFromMapIds: new Set<string>(),

  activeDatasetId: null,
  setActiveDatasetId: (id) => set({ activeDatasetId: id }),
  setActiveTool: (t) => set({ activeTool: t }),

  addDataset: (d) =>
    set((s) => ({
      datasets: [d, ...s.datasets.filter((existing) => existing.id !== d.id)],
      removedFromMapIds: (() => {
        const next = new Set(s.removedFromMapIds);
        next.delete(d.id);
        return next;
      })(),
    })),

  removeDataset: (id) =>
    set((s) => {
      const next = new Set(s.removedFromMapIds);
      next.add(id);
      return {
        datasets: s.datasets.filter((d) => d.id !== id),
        layers: s.layers.filter((l) => l.datasetId !== id),
        activeDatasetId: s.activeDatasetId === id ? null : s.activeDatasetId,
        removedFromMapIds: next,
      };
    }),

  addLayer: (l) =>
    set((s) => ({
      layers: [l, ...s.layers.filter((existing) => existing.id !== l.id)],
    })),

  updateLayer: (id, patch) =>
    set((s) => ({
      layers: s.layers.map((l) => (l.id === id ? { ...l, ...patch } : l)),
    })),

  removeLayer: (id) =>
    set((s) => ({
      layers: s.layers.filter((l) => l.id !== id),
    })),

  setViewState: (patch) =>
    set((s) => ({
      viewState: { ...s.viewState, ...patch },
    })),

  addAnnotation: (a) =>
    set((s) => ({ annotations: [...s.annotations, a] })),

  updateAnnotation: (id, patch) =>
    set((s) => ({
      annotations: s.annotations.map((a) => (a.id === id ? { ...a, ...patch } : a)),
    })),

  removeAnnotation: (id) =>
    set((s) => ({
      annotations: s.annotations.filter((a) => a.id !== id),
    })),

  addMapPin: (p) =>
    set((s) => ({ mapPins: [...s.mapPins, p] })),

  updateMapPin: (id, patch) =>
    set((s) => ({
      mapPins: s.mapPins.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    })),

  removeMapPin: (id) =>
    set((s) => ({
      mapPins: s.mapPins.filter((p) => p.id !== id),
    })),

  // ── Measure ───────────────────────────────────────────────────────────────
  measureMode: "line",
  setMeasureMode: (m) => set({ measureMode: m }),
  measurePoints: [],
  setMeasurePoints: (pts) => set({ measurePoints: pts }),

  // ── Filter rules ─────────────────────────────────────────────────────────
  filterRules: {},
  setFilterRules: (datasetId, rules, matchMode = "AND") => {
    set((s) => {
      const updated = { ...s.filterRules };
      if (rules.length === 0) {
        delete updated[datasetId];
      } else {
        updated[datasetId] = { rules, matchMode, uiRules: rules };
      }
      return { filterRules: updated };
    });
  },
  setUiRules: (datasetId, uiRules) =>
    set((s) => ({ filterRules: { ...s.filterRules, [datasetId]: { ...(s.filterRules[datasetId] ?? { rules: [], matchMode: "AND" }), uiRules } }})),
  basemap: "dark",
  setBasemap: (b) => set({ basemap: b }),
  // ── Projects ──────────────────────────────────────────────────────────────
  projects: [],
  activeProjectId: null,

  createProject: (name) =>
    set((s) => {
      const id = uid();
      const now = Date.now();
      const project: MapProject = {
        id,
        name,
        createdAt: now,
        updatedAt: now,
        datasets:    s.datasets,
        layers:      s.layers,
        viewState:   s.viewState,
        annotations: s.annotations,
        mapPins:     s.mapPins,
        filterRules: s.filterRules,
      };
      return {
        projects: [...s.projects, project],
        activeProjectId: id,
      };
    }),

  switchProject: (id) =>
    set((s) => {
      const p = s.projects.find((p) => p.id === id);
      if (!p) return s;
      return {
        activeProjectId: id,
        datasets:        p.datasets,
        layers:          p.layers,
        viewState:       p.viewState,
        annotations:     p.annotations,
        mapPins:         p.mapPins,
        filterRules:     p.filterRules,
        removedFromMapIds: new Set<string>(),
      };
    }),

  saveCurrentProject: () =>
    set((s) => {
      if (!s.activeProjectId) return s;
      return {
        projects: s.projects.map((p) =>
          p.id === s.activeProjectId
            ? {
                ...p,
                updatedAt:   Date.now(),
                datasets:    s.datasets,
                layers:      s.layers,
                viewState:   s.viewState,
                annotations: s.annotations,
                mapPins:     s.mapPins,
                filterRules: s.filterRules,
              }
            : p
        ),
      };
    }),

  deleteProject: (id) =>
    set((s) => {
      const remaining = s.projects.filter((p) => p.id !== id);
      const wasActive = s.activeProjectId === id;
      return {
        projects: remaining,
        activeProjectId: wasActive ? (remaining[0]?.id ?? null) : s.activeProjectId,
      };
    }),

  renameProject: (id, name) =>
    set((s) => ({
      projects: s.projects.map((p) =>
        p.id === id ? { ...p, name, updatedAt: Date.now() } : p
      ),
    })),

}), {
  name: "kepler-lite-store",
  partialize: (state) => ({
    layers:          state.layers,
    viewState:       state.viewState,
    annotations:     state.annotations,
    mapPins:         state.mapPins,
    filterRules:     state.filterRules,
    projects:        state.projects,
    activeProjectId: state.activeProjectId,
    basemap:         state.basemap,
  }),
}));