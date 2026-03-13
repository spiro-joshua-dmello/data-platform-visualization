import { Hono } from "hono";
import { serve } from "@hono/node-server";
import postgres from "postgres";
import Papa from "papaparse";
import { cors } from "hono/cors";

const PORT = Number(process.env.PORT ?? 8787);

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgres://postgres:postgres@localhost:55433/kepler";

const MARTIN_BASE = process.env.MARTIN_BASE ?? "http://localhost:3000";

const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES ?? 50 * 1024 * 1024);
const MAX_FEATURES = Number(process.env.MAX_FEATURES ?? 200000);
const MAX_CSV_ROWS = Number(process.env.MAX_CSV_ROWS ?? 500000);

const sql = postgres(DATABASE_URL, {
  idle_timeout: 20,
  max: 10,
  onnotice: () => {},
});

const app = new Hono();

app.use(
  "*",
  cors({
    origin: [
      "http://localhost:5173",
      "http://localhost:5174",
      "http://localhost:5175",
    ],
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type"],
  })
);

app.onError((err, c) => {
  console.error("Unhandled error:", err);
  return c.json(
    {
      ok: false,
      code: "INTERNAL_ERROR",
      error: err?.message ?? String(err),
    },
    500
  );
});

app.get("/", (c) => c.text("Upload service OK. Try GET /health or POST /datasets/upload"));

app.get("/health", async (c) => {
  let dbOk = false;
  let postgisOk = false;

  try {
    await sql`SELECT 1`;
    dbOk = true;

    const rows = await sql`
      SELECT EXISTS (
        SELECT 1
        FROM pg_extension
        WHERE extname = 'postgis'
      ) AS exists
    `;

    postgisOk = Boolean(rows?.[0]?.exists);
  } catch (err) {
    console.error("Health check error:", err);
  }

  return c.json({
    ok: true,
    dbOk,
    postgisOk,
    martinBase: MARTIN_BASE,
    maxUploadBytes: MAX_UPLOAD_BYTES,
    maxUploadMB: Math.round(MAX_UPLOAD_BYTES / (1024 * 1024)),
    maxFeatures: MAX_FEATURES,
    maxCsvRows: MAX_CSV_ROWS,
  });
});

console.log("DATABASE_URL =", DATABASE_URL);
console.log("SERVER FILE =", import.meta.url);

function stripUtf8Bom(s: string) {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

function pickCsvSuggestions(fields: string[]) {
  const findMatch = (candidates: string[]) =>
    fields.find((f) => candidates.includes(f.toLowerCase())) ?? null;

  const latColumn = findMatch([
    "lat",
    "latitude",
    "location_latitude",
    "y",
  ]);

  const lngColumn = findMatch([
    "lng",
    "lon",
    "longitude",
    "location_longitude",
    "x",
  ]);

  return { latColumn, lngColumn };
}

function normalizeGeoJSONTopLevel(json: any): {
  features: any[];
  noteType: string;
} {
  if (!json || typeof json !== "object") {
    return { features: [], noteType: "non-object" };
  }

  if (Array.isArray(json)) {
    const isFeatures = json.every((x) => x?.type === "Feature");
    return { features: isFeatures ? json : [], noteType: "array" };
  }

  const t = json.type;

  if (t === "FeatureCollection") {
    return {
      features: Array.isArray(json.features) ? json.features : [],
      noteType: "FeatureCollection",
    };
  }

  if (t === "Feature") {
    return { features: [json], noteType: "Feature" };
  }

  if (
    t === "Point" ||
    t === "MultiPoint" ||
    t === "LineString" ||
    t === "MultiLineString" ||
    t === "Polygon" ||
    t === "MultiPolygon"
  ) {
    return {
      features: [{ type: "Feature", geometry: json, properties: {} }],
      noteType: `Geometry:${t}`,
    };
  }

  if (Array.isArray((json as any).features)) {
    return {
      features: (json as any).features,
      noteType: `features-without-type:${String(t)}`,
    };
  }

  return { features: [], noteType: `unknown:${String(t)}` };
}

function inferSuggestedLayerTypeFromGeomTypes(
  geomTypes: string[]
): "circle" | "line" | "fill" {
  const hasPolygon = geomTypes.some((t) => t === "Polygon" || t === "MultiPolygon");
  const hasLine = geomTypes.some((t) => t === "LineString" || t === "MultiLineString");
  const hasPoint = geomTypes.some((t) => t === "Point" || t === "MultiPoint");

  if (hasPolygon) return "fill";
  if (hasLine) return "line";
  if (hasPoint) return "circle";
  return "fill";
}

function inferDatasetRenderType(
  geomTypes: string[]
): "point" | "line" | "polygon" | "mixed" {
  const hasPolygon = geomTypes.some((t) => t === "Polygon" || t === "MultiPolygon");
  const hasLine = geomTypes.some((t) => t === "LineString" || t === "MultiLineString");
  const hasPoint = geomTypes.some((t) => t === "Point" || t === "MultiPoint");

  const count = Number(hasPolygon) + Number(hasLine) + Number(hasPoint);

  if (count > 1) return "mixed";
  if (hasPolygon) return "polygon";
  if (hasLine) return "line";
  if (hasPoint) return "point";
  return "mixed";
}

function getTargetTable(type: string) {
  if (type === "Point" || type === "MultiPoint") return "points";
  if (type === "LineString" || type === "MultiLineString") return "lines";
  if (type === "Polygon" || type === "MultiPolygon") return "polygons";
  return null;
}

function badRequest(code: string, error: string, extra: Record<string, unknown> = {}) {
  return {
    ok: false,
    code,
    error,
    ...extra,
  };
}

async function getDatasetBounds(datasetId: string): Promise<[number, number, number, number] | null> {
  const rows = await sql.unsafe(
    `
    SELECT
      ST_XMin(ext) AS minx,
      ST_YMin(ext) AS miny,
      ST_XMax(ext) AS maxx,
      ST_YMax(ext) AS maxy
    FROM (
      SELECT ST_Extent(geom) AS ext
      FROM (
        SELECT geom FROM points WHERE dataset_id = $1
        UNION ALL
        SELECT geom FROM lines WHERE dataset_id = $1
        UNION ALL
        SELECT geom FROM polygons WHERE dataset_id = $1
      ) q
    ) s
    `,
    [datasetId]
  );

  const row = rows?.[0];
  if (!row || row.minx == null || row.miny == null || row.maxx == null || row.maxy == null) {
    return null;
  }

  return [
    Number(row.minx),
    Number(row.miny),
    Number(row.maxx),
    Number(row.maxy),
  ];
}

// -----------------------------
// Inspect route
// -----------------------------
app.post("/datasets/inspect", async (c) => {
  const body = await c.req.parseBody();
  const file = body["file"];

  if (!(file instanceof File)) {
    return c.json(badRequest("FILE_REQUIRED", "file required"), 400);
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return c.json(
      badRequest(
        "FILE_TOO_LARGE",
        `File too large. Maximum allowed size is ${Math.round(
          MAX_UPLOAD_BYTES / (1024 * 1024)
        )} MB.`,
        {
          maxBytes: MAX_UPLOAD_BYTES,
          fileSize: file.size,
        }
      ),
      413
    );
  }

  const lower = file.name.toLowerCase();
  const text = stripUtf8Bom(await file.text());

  if (lower.endsWith(".csv")) {
    const parsed = Papa.parse(text, {
      header: true,
      preview: 20,
      skipEmptyLines: true,
      dynamicTyping: false,
    });

    if (parsed.errors?.length) {
      return c.json(
        badRequest("INVALID_CSV", "CSV could not be parsed.", {
          details: parsed.errors.slice(0, 10),
        }),
        400
      );
    }

    const fields = parsed.meta.fields ?? [];
    const rows = Array.isArray(parsed.data) ? parsed.data.slice(0, 5) : [];
    const suggestions = pickCsvSuggestions(fields);

    return c.json({
      ok: true,
      fileType: "csv",
      columns: fields,
      sampleRows: rows,
      suggestions,
      suggestedLayerType: "circle",
    });
  }

  if (lower.endsWith(".geojson") || lower.endsWith(".json")) {
    try {
      const json = JSON.parse(text);
      const { features, noteType } = normalizeGeoJSONTopLevel(json);

      if (!features.length) {
        return c.json(
          badRequest("INVALID_GEOJSON", "No features found or unsupported GeoJSON top-level.", {
            detected: noteType,
            topLevelType: json?.type ?? null,
          }),
          400
        );
      }

      const geomTypes = new Set<string>();

      for (const f of features.slice(0, 200)) {
        const g = f?.geometry;
        if (g?.type) geomTypes.add(g.type);
      }

      const geometryTypes = [...geomTypes];
      const suggestedLayerType = inferSuggestedLayerTypeFromGeomTypes(geometryTypes);
      const renderType = inferDatasetRenderType(geometryTypes);

      return c.json({
        ok: true,
        fileType: "geojson",
        detected: noteType,
        featureCount: features.length,
        topLevelType: json?.type ?? null,
        geometryTypes,
        suggestedLayerType,
        renderType,
      });
    } catch (e: any) {
      return c.json(
        badRequest("INVALID_JSON", `Invalid JSON: ${e?.message ?? String(e)}`),
        400
      );
    }
  }

  return c.json(
    badRequest("UNSUPPORTED_FILE", "Only .csv, .geojson, and .json files are supported."),
    400
  );
});

// -----------------------------
// Upload route
// -----------------------------
app.post("/datasets/upload", async (c) => {
  const startedAt = Date.now();
  const body = await c.req.parseBody();
  const file = body["file"];

  if (!(file instanceof File)) {
    return c.json(
      badRequest("FILE_REQUIRED", "file required (multipart field name must be 'file')"),
      400
    );
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return c.json(
      badRequest("FILE_TOO_LARGE", "File too large."),
      413
    );
  }

  const latColumnInput = typeof body["latColumn"] === "string" ? body["latColumn"] : null;
  const lngColumnInput = typeof body["lngColumn"] === "string" ? body["lngColumn"] : null;

  const datasetId = crypto.randomUUID();
  const lower = file.name.toLowerCase();
  const text = stripUtf8Bom(await file.text());

  if (lower.endsWith(".geojson") || lower.endsWith(".json")) {
    let json: any;

    try {
      json = JSON.parse(text);
    } catch {
      return c.json(
        badRequest("INVALID_JSON", "Invalid JSON"),
        400
      );
    }

    const { features, noteType } = normalizeGeoJSONTopLevel(json);

    if (!features.length) {
      return c.json(
        badRequest("INVALID_GEOJSON", "No features found"),
        400
      );
    }

    if (features.length > MAX_FEATURES) {
      return c.json(
        badRequest("TOO_MANY_FEATURES", "Too many features"),
        413
      );
    }

    let inserted = 0;
    const geomTypes = new Set<string>();

    await sql.begin(async (tx) => {
      for (const f of features) {
        const geom = f?.geometry;
        if (!geom?.type) continue;

        const table = getTargetTable(geom.type);
        if (!table) continue;

        geomTypes.add(geom.type);

        const props = {
          ...(f.properties ?? {}),
          dataset_id: datasetId,
        };

        await tx.unsafe(
          `
          INSERT INTO ${table} (dataset_id, geom, props)
          VALUES (
            $1,
            ST_SetSRID(ST_GeomFromGeoJSON($2), 4326),
            $3::jsonb
          )
          `,
          [datasetId, JSON.stringify(geom), JSON.stringify(props)]
        );

        inserted++;
      }
    });

    if (inserted === 0) {
      return c.json(
        badRequest("NO_VALID_FEATURES", "No valid features could be inserted."),
        400
      );
    }

    const geometryTypes = [...geomTypes];
    const suggestedLayerType = inferSuggestedLayerTypeFromGeomTypes(geometryTypes);
    const renderType = inferDatasetRenderType(geometryTypes);
    const bounds = await getDatasetBounds(datasetId);

    return c.json({
      ok: true,
      datasetId,
      inserted,
      bounds,
      geometryTypes,
      suggestedLayerType,
      renderType,
      tiles: {
        points: `${MARTIN_BASE}/table.public.points.geom/{z}/{x}/{y}`,
        lines: `${MARTIN_BASE}/table.public.lines.geom/{z}/{x}/{y}`,
        polygons: `${MARTIN_BASE}/table.public.polygons.geom/{z}/{x}/{y}`,
      },
      processingMs: Date.now() - startedAt,
      detected: noteType,
    });
  }

  if (lower.endsWith(".csv")) {
    const parsed = Papa.parse(text, {
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true,
    });

    if (parsed.errors?.length) {
      return c.json(
        badRequest("INVALID_CSV", "CSV could not be parsed.", {
          details: parsed.errors.slice(0, 10),
        }),
        400
      );
    }

    const rows = parsed.data as any[];
    const fields = parsed.meta.fields ?? [];

    if (!rows.length) {
      return c.json(
        badRequest("EMPTY_CSV", "Empty CSV"),
        400
      );
    }

    if (rows.length > MAX_CSV_ROWS) {
      return c.json(
        badRequest("CSV_TOO_LARGE", "CSV too large"),
        413
      );
    }

    const suggestions = pickCsvSuggestions(fields);
    const latColumn = latColumnInput ?? suggestions.latColumn;
    const lngColumn = lngColumnInput ?? suggestions.lngColumn;

    if (!latColumn || !lngColumn) {
      return c.json(
        badRequest("CSV_COLUMNS_REQUIRED", "Latitude/Longitude columns not found"),
        400
      );
    }

    let inserted = 0;
    let skipped = 0;

    await sql.begin(async (tx) => {
      for (const r of rows) {
        const lat = Number(r[latColumn]);
        const lng = Number(r[lngColumn]);

        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
          skipped++;
          continue;
        }

        if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
          skipped++;
          continue;
        }

        const props = {
          ...r,
          dataset_id: datasetId,
        };

        await tx.unsafe(
          `
          INSERT INTO points (dataset_id, geom, props)
          VALUES (
            $1,
            ST_SetSRID(ST_MakePoint($2, $3), 4326),
            $4::jsonb
          )
          `,
          [datasetId, lng, lat, JSON.stringify(props)]
        );

        inserted++;
      }
    });

    if (inserted === 0) {
      return c.json(
        badRequest("NO_VALID_COORDINATES", "No valid coordinate rows found."),
        400
      );
    }

    const bounds = await getDatasetBounds(datasetId);

    return c.json({
      ok: true,
      datasetId,
      inserted,
      skipped,
      bounds,
      geometryTypes: ["Point"],
      suggestedLayerType: "circle",
      renderType: "point",
      tiles: {
        points: `${MARTIN_BASE}/table.public.points.geom/{z}/{x}/{y}`,
      },
      processingMs: Date.now() - startedAt,
    });
  }

  return c.json(
    badRequest("UNSUPPORTED_FILE", "Unsupported file type"),
    400
  );
});

serve({
  fetch: app.fetch,
  port: PORT,
});

console.log("Upload service running → http://localhost:" + PORT);