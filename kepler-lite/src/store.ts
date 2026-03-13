import { create } from "zustand";
import type { Dataset, LayerConfig, ViewState, Bounds } from "./types";
import { boundsToViewState } from "./utils";

type AppState = {
  datasets: Dataset[];
  layers: LayerConfig[];
  viewState: ViewState;

  uploadOpen: boolean;
  setUploadOpen: (open: boolean) => void;

  addDataset: (d: Dataset) => void;
  removeDataset: (id: string) => void;

  addLayer: (l: LayerConfig) => void;
  updateLayer: (id: string, patch: Partial<LayerConfig>) => void;
  removeLayer: (id: string) => void;

  setViewState: (patch: Partial<ViewState>) => void;

  zoomToLayer: (layerId: string) => void;
};

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

  uploadOpen: true,
  setUploadOpen: (open) => set({ uploadOpen: open }),

  addDataset: (d) =>
    set((s) => ({
      datasets: [d, ...s.datasets.filter((existing) => existing.id !== d.id)],
    })),

  removeDataset: (id) =>
    set((s) => ({
      datasets: s.datasets.filter((d) => d.id !== id),
      layers: s.layers.filter((l) => l.datasetId !== id),
    })),

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
      if (!bounds) return state;

      const view = boundsToViewState(bounds);

      return {
        viewState: {
          ...state.viewState,
          ...view,
          pitch: 0,
          bearing: 0,
        },
      };
    }),
}));