// src/util.ts

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
 * Compute bounds from CSV point rows
 */
export function computeLonLatBoundsPoints(
  rows: any[]
): [number, number, number, number] | null {
  let minLng = Infinity,
    minLat = Infinity,
    maxLng = -Infinity,
    maxLat = -Infinity;

  let count = 0;

  for (const r of rows) {
    const lat = Number(r.lat);
    const lng = Number(r.lng);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

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
 * Compute bounds from GeoJSON
 */
export function computeBoundsGeoJSON(
  geojson: any
): [number, number, number, number] | null {
  if (!geojson) return null;

  let minLng = Infinity,
    minLat = Infinity,
    maxLng = -Infinity,
    maxLat = -Infinity;

  const scan = (coords: any) => {
    if (typeof coords[0] === "number") {
      const [lng, lat] = coords;
      minLng = Math.min(minLng, lng);
      minLat = Math.min(minLat, lat);
      maxLng = Math.max(maxLng, lng);
      maxLat = Math.max(maxLat, lat);
    } else {
      coords.forEach(scan);
    }
  };

  try {
    if (geojson.type === "FeatureCollection") {
      geojson.features.forEach((f: any) => scan(f.geometry.coordinates));
    } else if (geojson.type === "Feature") {
      scan(geojson.geometry.coordinates);
    } else {
      scan(geojson.coordinates);
    }
  } catch {
    return null;
  }

  if (!isFinite(minLng)) return null;

  return [minLng, minLat, maxLng, maxLat];
}

/**
 * Convert bounds → view state
 */
export function boundsToViewState(
  bounds: [number, number, number, number]
) {
  const [minLng, minLat, maxLng, maxLat] = bounds;

  const longitude = (minLng + maxLng) / 2;
  const latitude = (minLat + maxLat) / 2;

  const lngDiff = Math.abs(maxLng - minLng);
  const latDiff = Math.abs(maxLat - minLat);
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
    14;

  return { longitude, latitude, zoom };
}