import { Hono } from "hono";
import { serve } from "@hono/node-server";
import postgres from "postgres";
import Papa from "papaparse";

const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES ?? 50 * 1024 * 1024); // 50 MB
const MAX_FEATURES = Number(process.env.MAX_FEATURES ?? 200000);
const MAX_CSV_ROWS = Number(process.env.MAX_CSV_ROWS ?? 500000);

const PORT = Number(process.env.PORT ?? 8787);
const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/kepler";
const MARTIN_BASE = process.env.MARTIN_BASE ?? "http://localhost:3000";

const sql = postgres(DATABASE_URL, {
  idle_timeout: 20,
  max: 10,
});

const app = new Hono();

app.onError((err, c) => {
  console.error("Unhandled:", err);
  return c.json({ ok: false, error: err?.message ?? String(err) }, 500);
});

app.get("/", (c) =>
  c.text("Upload service OK. Try GET /health or POST /datasets/upload")
);
app.get("/health", (c) => c.json({ ok: true }));

console.log("DATABASE_URL =", DATABASE_URL);
console.log("SERVER FILE =", import.meta.url);

// -----------------------------
// PostGIS + table helpers
// -----------------------------
function tableName(id: string) {
  return `ds_${id.replace(/-/g, "")}`;
}

let postgisEnsured = false;
async function ensurePostGISOnce() {
  if (postgisEnsured) return;
  try {
    await sql.unsafe(`CREATE EXTENSION IF NOT EXISTS postgis;`);
  } finally {
    postgisEnsured = true;
  }
}

async function createTable(name: string) {
  await ensurePostGISOnce();

  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS "${name}" (
      id serial PRIMARY KEY,
      geom geometry(Geometry, 4326),
      props jsonb
    );
  `);

  await sql.unsafe(
    `CREATE INDEX IF NOT EXISTS "${name}_gix" ON "${name}" USING GIST (geom);`
  );
}

// -----------------------------
// File / GeoJSON helpers
// -----------------------------
function stripUtf8Bom(s: string) {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

const VALID_GEOM_TYPES = new Set([
  "Point",
  "MultiPoint",
  "LineString",
  "MultiLineString",
  "Polygon",
  "MultiPolygon",
  "GeometryCollection",
]);

function summarizeBadGeom(g: any) {
  try {
    return {
      type: g?.type,
      keys: g && typeof g === "object" ? Object.keys(g).slice(0, 12) : null,
      sample: JSON.stringify(g)?.slice(0, 400),
    };
  } catch {
    return { type: g?.type, keys: null, sample: String(g).slice(0, 400) };
  }
}

function normalizeGeoJSONTopLevel(json: any): {
  features: any[];
  noteType: string;
} {
  if (!json || typeof json !== "object") {
    return { features: [], noteType: "non-object" };
  }

  // Array of features?
  if (Array.isArray(json)) {
    const isFeatures = json.every((x) => x?.type === "Feature");
    return { features: isFeatures ? json : [], noteType: "array" };
  }

  const t = json.type;

  if (t === "FeatureCollection") {
    const feats = Array.isArray(json.features) ? json.features : [];
    return { features: feats, noteType: "FeatureCollection" };
  }

  if (t === "Feature") {
    return { features: [json], noteType: "Feature" };
  }

  // Raw geometry object (wrap into a Feature)
  if (typeof t === "string" && VALID_GEOM_TYPES.has(t)) {
    return {
      features: [{ type: "Feature", geometry: json, properties: {} }],
      noteType: `Geometry:${t}`,
    };
  }

  // Some exporters omit "type" but include "features"
  if (Array.isArray((json as any).features)) {
    return {
      features: (json as any).features,
      noteType: `features-without-type:${String(t)}`,
    };
  }

  return { features: [], noteType: `unknown:${String(t)}` };
}

/**
 * Strong validation to prevent PostGIS ST_GeomFromGeoJSON from crashing:
 * - Ensure type is one of the GeoJSON geometry types PostGIS understands
 * - Ensure correct shape: coordinates array for normal geometries; geometries[] for collections
 * - Reject TopoJSON/ESRI-ish structures early (arcs/rings/paths)
 */
function validateGeometryOrReason(g: any): { ok: true } | { ok: false; reason: string } {
  if (!g || typeof g !== "object") return { ok: false, reason: "geometry not an object" };

  const t = g.type;
  if (!VALID_GEOM_TYPES.has(t)) return { ok: false, reason: `unsupported geometry.type="${t}"` };

  // Reject common non-GeoJSON structures
  if ("arcs" in g) return { ok: false, reason: 'looks like TopoJSON (has "arcs")' };
  if ("rings" in g) return { ok: false, reason: 'looks like Esri JSON (has "rings")' };
  if ("paths" in g) return { ok: false, reason: 'looks like Esri JSON (has "paths")' };

  if (t === "GeometryCollection") {
    if (!Array.isArray(g.geometries)) return { ok: false, reason: "GeometryCollection missing geometries[]" };
    // Validate nested geometries lightly
    for (const gg of g.geometries) {
      const v = validateGeometryOrReason(gg);
      if (!v.ok) return { ok: false, reason: `GeometryCollection member invalid: ${v.reason}` };
    }
    return { ok: true };
  }

  // Non-collection must have coordinates array
  if (!("coordinates" in g)) return { ok: false, reason: "missing coordinates" };
  if (!Array.isArray(g.coordinates)) return { ok: false, reason: "coordinates is not an array" };

  return { ok: true };
}

// -----------------------------
// Routes
// -----------------------------
app.post("/datasets/upload", async (c) => {
  const body = await c.req.parseBody();
  const file = body["file"];

  if (!(file instanceof File)) {
    return c.json({ ok: false, error: "file required (multipart field name must be 'file')" }, 400);
  }

  if (file.size > MAX_UPLOAD_BYTES) {
  return c.json(
    {
      ok: false,
      code: "FILE_TOO_LARGE",
      error: `File too large. Maximum allowed size is ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))} MB.`,
      maxBytes: MAX_UPLOAD_BYTES,
      fileSize: file.size,
    },
    413
    );
  }

  const id = crypto.randomUUID();
  const name = tableName(id);
  const lower = file.name.toLowerCase();

  await createTable(name);

  // Read as text (best for JSON/CSV) + strip BOM
  const fileText = stripUtf8Bom(await file.text());

  // -----------------------------
  // GEOJSON
  // -----------------------------
  if (lower.endsWith(".geojson") || lower.endsWith(".json")) {
    let json: any;
    try {
      json = JSON.parse(fileText);
    } catch (e: any) {
      return c.json({ ok: false, error: `invalid json: ${e?.message ?? e}` }, 400);
    }

    // Remove CRS (non-RFC7946)
    if (json && typeof json === "object" && "crs" in json) delete json.crs;

    const { features, noteType } = normalizeGeoJSONTopLevel(json);

    if (!features.length) {
      return c.json(
        {
          ok: false,
          error: "No features found (or unsupported GeoJSON top-level)",
          detected: noteType,
          topLevelType: json?.type,
        },
        400
      );
    }

    let inserted = 0;
    let skippedNull = 0;
    let skippedUnsupported = 0;
    let skippedInvalid = 0;

    const debugBadSamples: any[] = [];

    await sql.begin(async (tx) => {
      for (const f of features) {
        const geom = f?.geometry;

        if (!geom) {
          skippedNull++;
          continue;
        }

        // Validate BEFORE PostGIS to avoid hard errors
        const v = validateGeometryOrReason(geom);
        if (!v.ok) {
          skippedUnsupported++;
          if (debugBadSamples.length < 8) {
            debugBadSamples.push({
              reason: v.reason,
              geom: summarizeBadGeom(geom),
            });
          }
          continue;
        }

        try {
          // ST_GeomFromGeoJSON expects TEXT of a GeoJSON geometry object
          await tx.unsafe(
            `INSERT INTO "${name}" (geom, props)
             VALUES (
               ST_SetSRID(ST_GeomFromGeoJSON($1), 4326),
               $2::jsonb
             )`,
            [JSON.stringify(geom), JSON.stringify(f?.properties ?? {})]
          );
          inserted++;
        } catch (e: any) {
          // PostGIS still couldn’t parse coords, etc.
          skippedInvalid++;
          if (debugBadSamples.length < 8) {
            debugBadSamples.push({
              reason: `postgis: ${e?.message ?? String(e)}`,
              geom: summarizeBadGeom(geom),
            });
          }
        }
      }
    });

    return c.json({
      ok: true,
      detected: noteType,
      sourceId: name,
      inserted,
      skippedNull,
      skippedUnsupported,
      skippedInvalid,
      debugBadSamples,
      tiles: `${MARTIN_BASE}/${name}/{z}/{x}/{y}`,
      tilejson: `${MARTIN_BASE}/${name}`,
      sourceLayer: name,
    });
  }

  // -----------------------------
  // CSV POINTS
  // -----------------------------
  if (lower.endsWith(".csv")) {
    const parsed = Papa.parse(fileText, {
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true,
    });

    let inserted = 0;
    let skipped = 0;

    await sql.begin(async (tx) => {
      for (const r of parsed.data as any[]) {
        const lat = Number(r.lat ?? r.latitude ?? r.location_latitude);
        const lng = Number(r.lng ?? r.lon ?? r.longitude ?? r.location_longitude);

        if (!isFinite(lat) || !isFinite(lng)) {
          skipped++;
          continue;
        }

        await tx.unsafe(
          `INSERT INTO "${name}" (geom, props)
           VALUES (
             ST_SetSRID(ST_MakePoint($1,$2),4326),
             $3::jsonb
           )`,
          [lng, lat, JSON.stringify(r)]
        );
        inserted++;
      }
    });

    return c.json({
      ok: true,
      sourceId: name,
      inserted,
      skipped,
      tiles: `${MARTIN_BASE}/${name}/{z}/{x}/{y}`,
      tilejson: `${MARTIN_BASE}/${name}`,
      sourceLayer: name,
    });
  }

  return c.json({ ok: false, error: "Unsupported file" }, 400);
});

serve({ fetch: app.fetch, port: PORT });
console.log("Upload service running → http://localhost:" + PORT);