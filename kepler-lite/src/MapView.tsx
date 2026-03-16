import React from "react";
import DeckGL from "@deck.gl/react";
import Map, { Source, Layer } from "react-map-gl/maplibre";
import { useAppStore } from "./store";

const BASEMAP =
  "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";

const POINTS_TILES = "http://localhost:3000/points/{z}/{x}/{y}";
const LINES_TILES = "http://localhost:3000/lines/{z}/{x}/{y}";
const POLYGONS_TILES = "http://localhost:3000/polygons/{z}/{x}/{y}";

function rgbToCss([r, g, b]: [number, number, number]) {
  return `rgb(${r}, ${g}, ${b})`;
}

export function MapView() {
  const { datasets, layers, viewState, setViewState } = useAppStore();

  const vectorDatasets = datasets.filter((d) => d.type === "vector-tile");

  return (
    <>
      {/* Zoom level debug overlay */}
      <div
        style={{
          position: "absolute",
          bottom: 12,
          right: 12,
          zIndex: 999,
          background: "rgba(0,0,0,0.65)",
          color: "#fff",
          fontFamily: "monospace",
          fontSize: 13,
          padding: "4px 10px",
          borderRadius: 6,
          pointerEvents: "none",
        }}
      >
        z: {(viewState as any).zoom?.toFixed(2) ?? "—"}
      </div>

      <DeckGL
        viewState={viewState as any}
        controller={true}
        onViewStateChange={({ viewState: vs }: any) => setViewState(vs)}
      >
        <Map
          reuseMaps={false}
          mapStyle={BASEMAP}
          onLoad={() => console.log("Map loaded")}
          onError={(e) => console.error("MapLibre error:", e)}
        >
          <Source id="points-source" type="vector" tiles={[POINTS_TILES]} />
          <Source id="lines-source" type="vector" tiles={[LINES_TILES]} />
          <Source id="polygons-source" type="vector" tiles={[POLYGONS_TILES]} />

          {vectorDatasets.flatMap((dataset) => {
            const linkedLayers = layers.filter(
              (l) => l.visible && l.datasetId === dataset.id
            );

            return linkedLayers.flatMap((layer) => {
              const color = rgbToCss(layer.color);
              console.log("dataset keys:", dataset);
              const datasetFilter = [
                "==",
                ["get", "dataset_id"],
                dataset.datasetId,
              ] as any;

              if (layer.type === "circle") {
                return [
                  <Layer
                    key={layer.id}
                    id={layer.id}
                    type="circle"
                    source="points-source"
                    source-layer="points"
                    filter={datasetFilter}
                    minzoom={0}
                    maxzoom={24}
                    layout={{
                      visibility: layer.visible ? "visible" : "none",
                    }}
                    paint={{
                      "circle-color": color,
                      "circle-opacity": layer.opacity,
                      "circle-radius": [
                        "interpolate",
                        ["linear"],
                        ["zoom"],
                        0, 5,
                        4, 6,
                        8, 7,
                        12, 8,
                        16, 10,
                      ],
                      "circle-stroke-width": 1,
                      "circle-stroke-color": "#ffffff",
                    }}
                  />,
                ];
              }

              if (layer.type === "line") {
                return [
                  <Layer
                    key={layer.id}
                    id={layer.id}
                    type="line"
                    source="lines-source"
                    source-layer="lines"
                    filter={datasetFilter}
                    minzoom={0}
                    maxzoom={24}
                    layout={{
                      visibility: layer.visible ? "visible" : "none",
                      "line-cap": "round",
                      "line-join": "round",
                    }}
                    paint={{
                      "line-color": color,
                      "line-opacity": layer.opacity,
                      "line-width": [
                        "interpolate",
                        ["linear"],
                        ["zoom"],
                        0, 1,
                        4, 1.5,
                        6, 2,
                        8, 2.5,
                        12, 4,
                        16, 6,
                      ],
                    }}
                  />,
                ];
              }

              if (layer.type === "fill") {
                return [
                  <Layer
                    key={`${layer.id}-fill`}
                    id={`${layer.id}-fill`}
                    type="fill"
                    source="polygons-source"
                    source-layer="polygons"
                    filter={datasetFilter}
                    minzoom={0}
                    maxzoom={24}
                    layout={{
                      visibility: layer.visible ? "visible" : "none",
                    }}
                    paint={{
                      "fill-color": color,
                      "fill-opacity": [
                        "interpolate",
                        ["linear"],
                        ["zoom"],
                        0, Math.min(layer.opacity, 0.15),
                        4, Math.min(layer.opacity, 0.2),
                        6, Math.min(layer.opacity, 0.25),
                        10, Math.min(layer.opacity, 0.4),
                        14, layer.opacity,
                      ],
                    }}
                  />,
                  <Layer
                    key={`${layer.id}-outline`}
                    id={`${layer.id}-outline`}
                    type="line"
                    source="polygons-source"
                    source-layer="polygons"
                    filter={datasetFilter}
                    minzoom={0}
                    maxzoom={24}
                    layout={{
                      visibility: layer.visible ? "visible" : "none",
                      "line-cap": "round",
                      "line-join": "round",
                    }}
                    paint={{
                      "line-color": color,
                      "line-opacity": 1,
                      "line-width": [
                        "interpolate",
                        ["linear"],
                        ["zoom"],
                        0, 0.5,
                        4, 1,
                        6, 1.5,
                        8, 2,
                        12, 3,
                        16, 4,
                      ],
                    }}
                  />,
                ];
              }

              return [];
            });
          })}
        </Map>
      </DeckGL>
    </>
  );
}
