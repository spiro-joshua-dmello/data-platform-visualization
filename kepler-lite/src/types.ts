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

export type ScaleType = "quantile" | "quantize" | "equalInterval" | "naturalBreaks" | "log" | "sqrt";

export type Symbology =
  | { mode: "single" }
  | {
      mode: "categorized";
      col: string;
      palette: string;
      colors: string[];
      values: string[];
      scale?: "ordinal";          // always ordinal for categorical — kept for parity
    }
  | {
      mode: "graduated";
      col: string;
      palette: string;
      colors: string[];
      min: number;
      max: number;
      breaks?: number[];
      scale?: ScaleType;          // ← NEW
      inverted?: boolean;         // ← NEW
    };

export type LayerConfig = {
  id: string;
  datasetId: string;
  name: string;
  type: LayerType;
  visible: boolean;
  opacity: number;
  color: [number, number, number];
  strokeWidth?: number;
  strokeColor?: string;           // ← add if not already there
  symbology?: Symbology;
  // Kepler-style size channel (points only)
  radiusChannel?: {
    field: string | null;
    scale: "linear" | "sqrt" | "log";
    range: [number, number];      // [minRadius, maxRadius] in px
    fieldMax?: number;            // ← actual data maximum, used to calibrate interpolation
  };
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


export type MapProject = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  // snapshot of map state
  datasets: Dataset[];
  layers: LayerConfig[];
  viewState: ViewState;
  annotations: any[];     // Annotation[]
  mapPins: any[];          // MapPin[]
  filterRules: Record<string, any>;
};
