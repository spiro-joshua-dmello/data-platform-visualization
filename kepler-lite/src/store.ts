import { create } from "zustand";
import type { Dataset, LayerConfig, ViewState, Bounds } from "./types";
import { boundsToViewState } from "./utils";

type ZoomTarget = {
  longitude: number;
  latitude: number;
  zoom: number;
  id: number; // monotonically increasing, so MapView can detect new targets
};

type AppState = {
  datasets: Dataset[];
  layers: LayerConfig[];
  viewState: ViewState;

  // Separate from viewState so MapView can react to it without a feedback loop
  zoomTarget: ZoomTarget | null;

  uploadOpen: boolean;
  setUploadOpen: (open: boolean) => void;

  // Track datasets the user explicitly removed from the map this session.
  removedFromMapIds: Set<string>;

  activeDatasetId: string | null;
  setActiveDatasetId: (id: string | null) => void;

  addDataset: (d: Dataset) => void;
  removeDataset: (id: string) => void;

  addLayer: (l: LayerConfig) => void;
  updateLayer: (id: string, patch: Partial<LayerConfig>) => void;
  removeLayer: (id: string) => void;

  setViewState: (patch: Partial<ViewState>) => void;

  zoomToLayer: (layerId: string) => void;
};

let _zoomTargetId = 0;

export const useAppStore = create<AppState>((set) => ({
  datasets: [],
  layers: [],

  viewState: {
    longitude: 77.5946,
    latitude: 12.9716,
    zoom: 10,
    pitch: 0,
    bearing: 0,
  },

  zoomTarget: null,

  uploadOpen: true,
  setUploadOpen: (open) => set({ uploadOpen: open }),

  removedFromMapIds: new Set<string>(),

  activeDatasetId: null,
  setActiveDatasetId: (id) => set({ activeDatasetId: id }),

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

  zoomToLayer: (layerId) =>
    set((state) => {
      const layer = state.layers.find((l) => l.id === layerId);
      if (!layer) return state;

      const dataset = state.datasets.find((d) => d.id === layer.datasetId);
      if (!dataset) return state;

      const bounds: Bounds | null = dataset.bounds ?? null;
      if (!bounds) {
        console.warn("zoomToLayer: dataset has no bounds", dataset);
        return state;
      }

      const view = boundsToViewState(bounds);

      return {
        zoomTarget: {
          longitude: view.longitude,
          latitude:  view.latitude,
          zoom:      view.zoom,
          id:        ++_zoomTargetId,
        },
      };
    }),
}));
