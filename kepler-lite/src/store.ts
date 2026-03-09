import { create } from "zustand";
import type { Dataset, LayerConfig } from "./types";

import {
  computeLonLatBoundsPoints,
  computeBoundsGeoJSON,
  boundsToViewState,
} from "./utils.ts";

type ViewState = {
  longitude: number;
  latitude: number;
  zoom: number;
  pitch: number;
  bearing: number;
};

type AppState = {
  datasets: Dataset[];
  layers: LayerConfig[];
  viewState: ViewState;

  addDataset: (d: Dataset) => void;
  removeDataset: (id: string) => void;

  addLayer: (l: LayerConfig) => void;
  updateLayer: (id: string, patch: Partial<LayerConfig>) => void;
  removeLayer: (id: string) => void;

  setViewState: (patch: Partial<ViewState>) => void;

  zoomToLayer: (layerId: string) => void; // ✅ NEW
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

  addDataset: (d) =>
    set((s) => ({ datasets: [d, ...s.datasets] })),

  removeDataset: (id) =>
    set((s) => ({
      datasets: s.datasets.filter((d) => d.id !== id),
      layers: s.layers.filter((l) => l.datasetId !== id),
    })),

  addLayer: (l) =>
    set((s) => ({ layers: [l, ...s.layers] })),

  updateLayer: (id, patch) =>
    set((s) => ({
      layers: s.layers.map((l) =>
        l.id === id ? { ...l, ...patch } : l
      ),
    })),

  removeLayer: (id) =>
    set((s) => ({
      layers: s.layers.filter((l) => l.id !== id),
    })),

  setViewState: (patch) =>
    set((s) => ({
      viewState: { ...s.viewState, ...patch },
    })),

  /**
   * 🔍 Zoom map to layer extent
   */
  zoomToLayer: (layerId) =>
    set((state) => {
      const layer = state.layers.find(l => l.id === layerId);
      if (!layer) return state;

      const dataset = state.datasets.find(d => d.id === layer.datasetId);
      if (!dataset) return state;

      let bounds: [number, number, number, number] | null = null;

      if (dataset.type === "geojson") {
        bounds = computeBoundsGeoJSON(dataset.data);
      }

      if (dataset.type === "csv-points") {
        bounds = computeLonLatBoundsPoints(dataset.data);
      }

      if (!bounds) return state;

      const view = boundsToViewState(bounds);

      return {
        viewState: { ...state.viewState, ...view },
      };
    }),
}));