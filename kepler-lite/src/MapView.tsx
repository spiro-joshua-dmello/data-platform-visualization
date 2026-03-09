import React, { useMemo } from "react";
import DeckGL from "@deck.gl/react";
import Map from "react-map-gl/maplibre";
import { GeoJsonLayer, ScatterplotLayer } from "deck.gl";
import { useAppStore } from "./store";
import { rgba } from "./utils";

const BASEMAP = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";

export function MapView() {
  const { datasets, layers, viewState, setViewState } = useAppStore();

  const deckLayers = useMemo(() => {
    return layers
      .filter((l) => l.visible)
      .map((l) => {
        const ds = datasets.find((d) => d.id === l.datasetId);
        if (!ds) return null;

        const fill = rgba(l.color, l.opacity);

        if (l.kind === "geojson" && ds.type === "geojson") {
          return new GeoJsonLayer({
            id: l.id,
            data: ds.data,
            pickable: true,
            filled: true,
            stroked: true,
            getFillColor: fill,
            getLineColor: fill,
            lineWidthMinPixels: l.lineWidth,
            autoHighlight: true,
          });
        }

        if (l.kind === "points" && ds.type === "csv-points") {
          return new ScatterplotLayer({
            id: l.id,
            data: ds.data,
            pickable: true,
            getPosition: (d: any) => [Number(d.lng), Number(d.lat)],
            getFillColor: fill,
            radiusUnits: "meters",
            getRadius: () => l.radius,
            autoHighlight: true,
          });
        }

        return null;
      })
      .filter(Boolean);
  }, [datasets, layers]);

  return (
    <DeckGL
      viewState={viewState as any}
      controller={true}
      layers={deckLayers as any}
      onViewStateChange={({ viewState: vs }: any) => setViewState(vs)}
      getTooltip={({ object }: any) =>
        object
          ? {
              text: typeof object === "object" ? JSON.stringify(object, null, 2) : String(object),
            }
          : null
      }
    >
      <Map mapStyle={BASEMAP} />
    </DeckGL>
  );
}
