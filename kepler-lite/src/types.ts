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

export type Symbology =
  | { mode: "single" }
  | { mode: "categorized"; col: string; palette: string; colors: string[]; values: string[] }
  | { mode: "graduated"; col: string; palette: string; colors: string[] };

export type LayerConfig = {
  id: string;
  datasetId: string;
  name: string;
  type: LayerType;
  visible: boolean;
  opacity: number;
  color: [number, number, number];
  symbology?: Symbology;
};

export type ViewState = {
  longitude: number;
  latitude: number;
  zoom: number;
  pitch: number;
  bearing: number;
  // Optional — used when programmatically flying to a location
  transitionDuration?: number;
};

// ── Editing ──────────────────────────────────────────────────────────────────

export type EditMode =
  | { type: "none" }
  | { type: "select"; datasetId: string; table: string }
  | { type: "draw"; datasetId: string; table: string; geomKind: "point" | "line" | "polygon" }
  | { type: "editGeom"; datasetId: string; table: string; featureId: string };

export type GeoFeature = {
  id: string;
  type: "Feature";
  geometry: any;
  properties: Record<string, any>;
};

// Dataset catalog entry (from DB)
export type CatalogDataset = {
  id: string;
  name: string;
  kind: string;
  table_name: string;
  created_at: string;
  feature_count: number;
};
