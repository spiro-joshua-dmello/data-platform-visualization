export type Bounds = [number, number, number, number];

export type DatasetType = "vector-tile";
export type LayerType = "circle" | "line" | "fill";
export type RenderType = "point" | "line" | "polygon" | "mixed";

export type Dataset = {
  id: string;
  name: string;
  type: DatasetType;
  datasetId: string;
  renderType?: RenderType;
  bounds?: Bounds | null;
};

export type LayerConfig = {
  id: string;
  datasetId: string;
  name: string;
  type: LayerType;
  visible: boolean;
  opacity: number;
  color: [number, number, number];
};

export type ViewState = {
  longitude: number;
  latitude: number;
  zoom: number;
  pitch: number;
  bearing: number;
};