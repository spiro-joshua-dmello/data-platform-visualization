export type DatasetType = "geojson" | "csv-points";

export type Dataset = {
  id: string;
  name: string;
  type: DatasetType;
  // geojson: FeatureCollection, csv-points: rows [{lat,lng,...}]
  data: any;
  createdAt: string;
};

export type LayerKind = "geojson" | "points" | "heatmap" | "hex";

export type LayerConfig = {
  id: string;
  datasetId: string;
  name: string;
  kind: LayerKind;
  visible: boolean;

  // style
  opacity: number; // 0..1
  color: [number, number, number]; // rgb
  radius: number; // meters (for points)
  lineWidth: number; // pixels (for geojson strokes)
};
