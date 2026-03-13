export function uid() {
  return crypto.randomUUID();
}

export function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export function rgba(
  color: [number, number, number],
  opacity: number
): [number, number, number, number] {
  const [r, g, b] = color;
  return [r, g, b, Math.round(clamp(opacity, 0, 1) * 255)];
}

/**
 * Compute bounds from CSV point rows.
 * Tries common latitude/longitude field names.
 */
export function computeLonLatBoundsPoints(
  rows: any[]
): [number, number, number, number] | null {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;

  let count = 0;

  for (const r of rows ?? []) {
    const lat = Number(
      r?.lat ??
        r?.latitude ??
        r?.y ??
        r?.location_latitude
    );

    const lng = Number(
      r?.lng ??
        r?.lon ??
        r?.longitude ??
        r?.x ??
        r?.location_longitude
    );

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;

    count++;
    minLng = Math.min(minLng, lng);
    minLat = Math.min(minLat, lat);
    maxLng = Math.max(maxLng, lng);
    maxLat = Math.max(maxLat, lat);
  }

  if (!count) return null;

  return [minLng, minLat, maxLng, maxLat];
}

/**
 * Compute bounds from GeoJSON.
 * Handles FeatureCollection, Feature, Geometry, and GeometryCollection.
 */
export function computeBoundsGeoJSON(
  geojson: any
): [number, number, number, number] | null {
  if (!geojson) return null;

  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;

  const visitCoords = (coords: any) => {
    if (!Array.isArray(coords)) return;

    if (
      coords.length >= 2 &&
      typeof coords[0] === "number" &&
      typeof coords[1] === "number"
    ) {
      const lng = Number(coords[0]);
      const lat = Number(coords[1]);

      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return;

      minLng = Math.min(minLng, lng);
      minLat = Math.min(minLat, lat);
      maxLng = Math.max(maxLng, lng);
      maxLat = Math.max(maxLat, lat);
      return;
    }

    for (const item of coords) {
      visitCoords(item);
    }
  };

  const visitGeometry = (geometry: any) => {
    if (!geometry || typeof geometry !== "object") return;

    if (geometry.type === "GeometryCollection") {
      for (const g of geometry.geometries ?? []) {
        visitGeometry(g);
      }
      return;
    }

    visitCoords(geometry.coordinates);
  };

  try {
    if (geojson.type === "FeatureCollection") {
      for (const feature of geojson.features ?? []) {
        visitGeometry(feature?.geometry);
      }
    } else if (geojson.type === "Feature") {
      visitGeometry(geojson.geometry);
    } else {
      visitGeometry(geojson);
    }
  } catch {
    return null;
  }

  if (!Number.isFinite(minLng) || !Number.isFinite(minLat)) {
    return null;
  }

  return [minLng, minLat, maxLng, maxLat];
}

/**
 * Convert bounds to a simple view state.
 */
export function boundsToViewState(
  bounds: [number, number, number, number]
) {
  const [minLng, minLat, maxLng, maxLat] = bounds;

  const longitude = (minLng + maxLng) / 2;
  const latitude = (minLat + maxLat) / 2;

  const lngDiff = Math.max(Math.abs(maxLng - minLng), 0.0001);
  const latDiff = Math.max(Math.abs(maxLat - minLat), 0.0001);
  const maxDiff = Math.max(lngDiff, latDiff);

  const zoom =
    maxDiff > 60 ? 2 :
    maxDiff > 30 ? 3 :
    maxDiff > 15 ? 4 :
    maxDiff > 8 ? 5 :
    maxDiff > 4 ? 6 :
    maxDiff > 2 ? 7 :
    maxDiff > 1 ? 8 :
    maxDiff > 0.5 ? 9 :
    maxDiff > 0.25 ? 10 :
    maxDiff > 0.12 ? 11 :
    maxDiff > 0.06 ? 12 :
    maxDiff > 0.03 ? 13 :
    maxDiff > 0.015 ? 14 :
    15;

  return {
    longitude,
    latitude,
    zoom,
  };
}