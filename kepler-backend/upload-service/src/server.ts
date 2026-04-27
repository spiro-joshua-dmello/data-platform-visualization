import { Hono } from "hono";
import { serve } from "@hono/node-server";
import postgres from "postgres";
import Papa from "papaparse";
import { cors } from "hono/cors";
import { createReadStream, existsSync } from "fs";
import { mkdir, readFile, open } from "fs/promises";
import { join } from "path";

const { chain } = require("stream-chain");
const { parser } = require("stream-json");
const { pick } = require("stream-json/filters/Pick");
const { streamArray } = require("stream-json/streamers/StreamArray");

const PORT = Number(process.env.PORT ?? 8787);

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgres://postgres:postgres@localhost:15432/kepler";

const MARTIN_BASE = process.env.MARTIN_BASE ?? "http://localhost:3000";

const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES ?? 50 * 1024 * 1024);
const MAX_FEATURES = Number(process.env.MAX_FEATURES ?? 200000);
const MAX_CSV_ROWS = Number(process.env.MAX_CSV_ROWS ?? 500000);
const TEMP_DIR = process.env.TEMP_DIR ?? "/tmp/kepler-uploads";

const sql = postgres(DATABASE_URL, {
  idle_timeout: 20,
  max: 10,
  onnotice: () => {},
});



await mkdir(TEMP_DIR, { recursive: true });

const app = new Hono();

app.use(
  "*",
  cors({
    origin: [
      "http://localhost:5173",
      "http://localhost:5174",
      "http://localhost:5175",
    ],
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "X-Project-Id"],
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

app.get("/", (c) =>
  c.text("Upload service OK. Try GET /health or POST /datasets/upload")
);

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

// ── Helpers ──────────────────────────────────────────────────────────────────

function stripUtf8Bom(s: string) {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

function pickCsvSuggestions(fields: string[]) {
  const lower = fields.map((f) => f.toLowerCase().trim());

  const latColumn = fields.find((_, i) =>
    ["lat", "latitude", "y"].includes(lower[i])
  ) ?? null;

  const lngColumn = fields.find((_, i) =>
    ["lng", "lon", "long", "longitude", "x"].includes(lower[i])
  ) ?? null;

  const wktColumn = fields.find((_, i) =>
    ["wkt", "geometry", "geom", "shape", "the_geom", "geo"].includes(lower[i])
  ) ?? null;

  return { latColumn, lngColumn, wktColumn, h3Column: null as string | null };
}

// ── H3 helpers ────────────────────────────────────────────────────────────────

// H3 indexes are 15-char hex strings starting with '8'
function isH3Index(val: string): boolean {
  if (typeof val !== "string") return false;
  const v = val.trim();
  // H3 indexes are 15 hex chars at res 0, up to 16 at higher resolutions.
  // All valid H3 indexes start with '8' and are 15–16 hex chars.
  return /^8[0-9a-f]{14,15}$/i.test(v);
}

// AFTER — also check column name as a hint
function pickH3Column(fields: string[], sampleRows: any[]): string | null {
  const H3_NAME_HINTS = ["h3", "h3index", "h3_index", "hex", "cell", "hexid", "grid_id"];
  for (const field of fields) {
    const sample = sampleRows.slice(0, 10).map((r) => String(r[field] ?? ""));
    const matchCount = sample.filter((v) => isH3Index(v)).length;
    if (matchCount >= Math.min(3, sample.length)) return field;
    // fallback: name-based hint with at least 1 matching value
    if (H3_NAME_HINTS.includes(field.toLowerCase().trim()) && matchCount >= 1) return field;
  }
  return null;
}

// Convert H3 index to a WKT polygon using pure math (no library needed).
// H3 cell boundary decoded from the index itself.
function h3ToPolygonWKT(h3Index: string): string | null {
  try {
    // Use h3-js if available, otherwise fall back to centroid point
    // We'll use dynamic require so it's optional
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const h3 = require("h3-js");
    const boundary = h3.cellToBoundary(h3Index); // [[lat,lng], ...]
    if (!boundary || boundary.length === 0) return null;
    const coords = [...boundary, boundary[0]]
      .map(([lat, lng]: [number, number]) => `${lng} ${lat}`)
      .join(", ");
    return `POLYGON((${coords}))`;
  } catch {
    return null;
  }
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

function badRequest(
  code: string,
  error: string,
  extra: Record<string, unknown> = {}
) {
  return { ok: false, code, error, ...extra };
}

function getProjectId(c: any): string {
  return c.req.header("X-Project-Id") ?? "default";
}

async function getDatasetBounds(
  datasetId: string
): Promise<[number, number, number, number] | null> {
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
  if (
    !row ||
    row.minx == null ||
    row.miny == null ||
    row.maxx == null ||
    row.maxy == null
  ) {
    return null;
  }

  return [Number(row.minx), Number(row.miny), Number(row.maxx), Number(row.maxy)];
}

async function registerDataset(
  datasetId: string,
  name: string,
  renderType: string,
  projectId: string
) {
  const tableName =
    renderType === "point" ? "points" :
    renderType === "line"  ? "lines"  : "polygons";
 
  await sql`
    INSERT INTO datasets (id, name, kind, table_name, created_at, project_id)
    VALUES (
      ${datasetId}::uuid,
      ${name},
      ${renderType},
      ${tableName},
      now(),
      ${projectId}
    )
    ON CONFLICT (id) DO UPDATE
      SET name       = EXCLUDED.name,
          kind       = EXCLUDED.kind,
          table_name = EXCLUDED.table_name,
          project_id = EXCLUDED.project_id
  `;
}

// ── Streaming GeoJSON → Postgres ─────────────────────────────────────────────

async function streamGeoJSONIntoDB(
  filePath: string,
  datasetId: string,
  projectId: string
): Promise<{ inserted: number; geomTypes: Set<string> }> {
  const geomTypes = new Set<string>();
  let inserted = 0;
  let totalFlushed = 0;
  const BATCH_SIZE = 500;
  let batch: { table: string; geom: any; props: any }[] = [];

  const flushBatch = async (tx: any) => {
    for (const { table, geom, props } of batch) {
      await tx.unsafe(
        `INSERT INTO ${table} (dataset_id, project_id, geom, props)
          VALUES (
            $1, $2,
            ST_SetSRID(
              CASE
                WHEN $5 IN ('Polygon', 'MultiPolygon') THEN ST_Multi(ST_GeomFromGeoJSON($3))
                ELSE ST_GeomFromGeoJSON($3)
              END,
              4326
            ),
            to_json($4::text)::jsonb
          )`,
        [datasetId, projectId, JSON.stringify(geom), sql.json(props), geom.type]
      );
      inserted++;
    }
    totalFlushed += batch.length;
    if (totalFlushed % 5000 === 0) {
      console.log(`[chunked] inserted ${totalFlushed} features so far...`);
    }
    batch = [];
  };

  const headBuf = Buffer.alloc(300);
  const peekFd = await open(filePath, "r");
  await peekFd.read(headBuf, 0, 300, 0);
  await peekFd.close();
  const head = headBuf.toString("utf8");
  const isFeatureCollection = /"type"\s*:\s*"FeatureCollection"/.test(head);

  await sql.begin(async (tx) => {
    await new Promise<void>((resolve, reject) => {
      const streamPipeline = isFeatureCollection
        ? chain([
            createReadStream(filePath, { encoding: "utf8" }),
            parser(),
            pick({ filter: "features" }),
            streamArray(),
          ])
        : chain([
            createReadStream(filePath, { encoding: "utf8" }),
            parser(),
            streamArray(),
          ]);

      streamPipeline.on("data", async ({ value: feature }: any) => {
        streamPipeline.pause();
        try {
          const geom =
            feature?.geometry ??
            (feature?.type && feature?.coordinates ? feature : null);

          if (!geom?.type) { streamPipeline.resume(); return; }

          const table = getTargetTable(geom.type);
          if (!table) { streamPipeline.resume(); return; }

          geomTypes.add(geom.type);
          const props = { ...(feature.properties ?? {}), dataset_id: datasetId };
          batch.push({ table, geom, props });

          if (batch.length >= BATCH_SIZE) await flushBatch(tx);
        } catch (err) {
          reject(err);
          return;
        }
        streamPipeline.resume();
      });

      streamPipeline.on("end", async () => {
        try {
          if (batch.length > 0) await flushBatch(tx);
          resolve();
        } catch (err) {
          reject(err);
        }
      });

      streamPipeline.on("error", reject);
    });
  });

  return { inserted, geomTypes };
}

// ── Streaming CSV → Postgres ──────────────────────────────────────────────────

async function streamCSVIntoDB(
  filePath: string,
  datasetId: string,
  projectId: string,
  latColumn: string,
  lngColumn: string
): Promise<{ inserted: number; skipped: number }> {
  let inserted = 0;
  let skipped = 0;

  const text = stripUtf8Bom(await readFile(filePath, "utf8"));
  const parsed = Papa.parse(text, {
    header: true,
    dynamicTyping: true,
    skipEmptyLines: true,
  });

  const rows = parsed.data as any[];

  await sql.begin(async (tx) => {
    for (const r of rows) {
      const lat = Number(r[latColumn]);
      const lng = Number(r[lngColumn]);

      if (
        !Number.isFinite(lat) ||
        !Number.isFinite(lng) ||
        lat < -90 ||
        lat > 90 ||
        lng < -180 ||
        lng > 180
      ) {
        skipped++;
        continue;
      }

      await tx.unsafe(
        `INSERT INTO points (dataset_id, project_id, geom, props)
         VALUES ($1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326), $5::jsonb)`,
        [datasetId, projectId, lng, lat, JSON.stringify({ ...r, dataset_id: datasetId })]
      );
      inserted++;
    }
  });

  return { inserted, skipped };
}

// ── Streaming H3 CSV → Postgres ───────────────────────────────────────────────

async function streamH3CSVIntoDB(
  filePath: string,
  datasetId: string,
  projectId: string,
  h3Column: string
): Promise<{ inserted: number; skipped: number }> {
  let inserted = 0;
  let skipped = 0;

  const text = stripUtf8Bom(await readFile(filePath, "utf8"));
  const parsed = Papa.parse(text, {
    header: true,
    dynamicTyping: false,
    skipEmptyLines: true,
  });

  const rows = parsed.data as any[];

  await sql.begin(async (tx) => {
    for (const r of rows) {
      const h3idx = String(r[h3Column] ?? "").trim();
      // console.log(`[H3 debug] column="${h3Column}" raw="${r[h3Column]}" trimmed="${h3idx}" len=${h3idx.length} valid=${isH3Index(h3idx)}`);
      if (!isH3Index(h3idx)) { skipped++; continue; }

      const wkt = h3ToPolygonWKT(h3idx);
      if (!wkt) { skipped++; continue; }

      const props = { ...r, dataset_id: datasetId, h3index: h3idx };

      await tx.unsafe(
        `INSERT INTO polygons (dataset_id, project_id, geom, props)
         VALUES ($1, $2, ST_SetSRID(ST_GeomFromText($3), 4326), $4::jsonb)`,
        [datasetId, projectId, wkt, JSON.stringify(props)]
      );
      inserted++;
    }
  });

  return { inserted, skipped };
}

// ── Inspect route ─────────────────────────────────────────────────────────────

app.post("/datasets/inspect", async (c) => {
  const body = await c.req.parseBody();
  const file = body["file"];

  if (!(file instanceof File)) {
    return c.json(badRequest("FILE_REQUIRED", "file required"), 400);
  }

  const INSPECT_SAMPLE_BYTES = 2 * 1024 * 1024;
  const sample = file.size > INSPECT_SAMPLE_BYTES
    ? file.slice(0, INSPECT_SAMPLE_BYTES)
    : file;

  const datasetId = crypto.randomUUID();
  const projectId = getProjectId(c);
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
    const rows = Array.isArray(parsed.data) ? parsed.data.slice(0, 10) : [];
    const suggestions = pickCsvSuggestions(fields);
    const h3Column = pickH3Column(fields, rows);
    if (h3Column) (suggestions as any).h3Column = h3Column;

    const hasWkt = !!suggestions.wktColumn;
    const hasH3 = !!h3Column;
    return c.json({
      ok: true,
      fileType: "csv",
      columns: fields,
      sampleRows: rows,
      suggestions,
      suggestedLayerType: hasH3 ? "fill" : hasWkt ? "line" : "circle",
      hasWktColumn: hasWkt,
      hasH3Column: hasH3,
    });
  }

  if (lower.endsWith(".geojson") || lower.endsWith(".json")) {
    try {
      let json: any = null;
      let noteType = "FeatureCollection";
      let featureCount = 0;
      const geomTypes = new Set<string>();

      if (file.size <= INSPECT_SAMPLE_BYTES) {
        json = JSON.parse(text);
        const normalized = normalizeGeoJSONTopLevel(json);
        noteType = normalized.noteType;
        featureCount = normalized.features.length;
        for (const f of normalized.features.slice(0, 200)) {
          const g = f?.geometry;
          if (g?.type) geomTypes.add(g.type);
        }
      } else {
        const geomTypePattern = /"type"\s*:\s*"(Point|MultiPoint|LineString|MultiLineString|Polygon|MultiPolygon)"/g;
        let match;
        while ((match = geomTypePattern.exec(text)) !== null) {
          geomTypes.add(match[1]);
        }
        featureCount = -1;
        noteType = "FeatureCollection";
      }

      if (geomTypes.size === 0) {
        return c.json(
          badRequest(
            "INVALID_GEOJSON",
            "No geometry types found. File may be empty or unsupported.",
            { detected: noteType, topLevelType: json?.type ?? null }
          ),
          400
        );
      }

      const geometryTypes = [...geomTypes];
      const suggestedLayerType = inferSuggestedLayerTypeFromGeomTypes(geometryTypes);
      const renderType = inferDatasetRenderType(geometryTypes);

      return c.json({
        ok: true,
        fileType: "geojson",
        detected: noteType,
        featureCount,
        topLevelType: json?.type ?? "FeatureCollection",
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

// ── Upload route (small files ≤50MB) ─────────────────────────────────────────

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
    return c.json(badRequest("FILE_TOO_LARGE", "File too large."), 413);
  }

  const latColumnInput =
    typeof body["latColumn"] === "string" ? body["latColumn"] : null;
  const lngColumnInput =
    typeof body["lngColumn"] === "string" ? body["lngColumn"] : null;
  const h3ColumnInput =
    typeof body["h3Column"] === "string" ? body["h3Column"] : null;

  const datasetId = crypto.randomUUID();
  const projectId = getProjectId(c);
  const lower = file.name.toLowerCase();
  const text = stripUtf8Bom(await file.text());

  if (lower.endsWith(".geojson") || lower.endsWith(".json")) {
    let json: any;

    try {
      json = JSON.parse(text);
    } catch {
      return c.json(badRequest("INVALID_JSON", "Invalid JSON"), 400);
    }

    const { features, noteType } = normalizeGeoJSONTopLevel(json);

    if (!features.length) {
      return c.json(badRequest("INVALID_GEOJSON", "No features found"), 400);
    }

    if (features.length > MAX_FEATURES) {
      return c.json(badRequest("TOO_MANY_FEATURES", "Too many features"), 413);
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

        const props = { ...(f.properties ?? {}), dataset_id: datasetId };

        await tx.unsafe(
          `INSERT INTO ${table} (dataset_id, project_id, geom, props)
           VALUES (
             $1, $2,
             ST_SetSRID(
               CASE
                 WHEN $5 IN ('Polygon', 'MultiPolygon') THEN ST_Multi(ST_GeomFromGeoJSON($3))
                 ELSE ST_GeomFromGeoJSON($3)
               END,
               4326
             ),
             to_json($4::text)::jsonb
           )`,
          [datasetId, projectId, JSON.stringify(geom), sql.json(props), geom.type]
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
    await registerDataset(datasetId, file.name, renderType, projectId);
    return c.json({
      ok: true,
      datasetId,
      inserted,
      bounds,
      geometryTypes,
      suggestedLayerType,
      renderType,
      tiles: {
        points: `${MARTIN_BASE}/points/{z}/{x}/{y}`,
        lines: `${MARTIN_BASE}/lines/{z}/{x}/{y}`,
        polygons: `${MARTIN_BASE}/polygons/{z}/{x}/{y}`,
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
      return c.json(badRequest("EMPTY_CSV", "Empty CSV"), 400);
    }

    if (rows.length > MAX_CSV_ROWS) {
      return c.json(badRequest("CSV_TOO_LARGE", "CSV too large"), 413);
    }

    const suggestions = pickCsvSuggestions(fields);
    const latColumn = latColumnInput ?? suggestions.latColumn;
    const lngColumn = lngColumnInput ?? suggestions.lngColumn;
    const wktColumnInput = typeof body["wktColumn"] === "string" ? body["wktColumn"] : null;
    const wktColumn = wktColumnInput ?? suggestions.wktColumn;

    // H3 mode
    if (h3ColumnInput) {
      const tmpPath = `/tmp/${datasetId}.csv`;
      await Bun.write(tmpPath, text);
      const result = await streamH3CSVIntoDB(tmpPath, datasetId, projectId, h3ColumnInput);
      if (result.inserted === 0) {
        return c.json(badRequest("NO_VALID_H3", "No valid H3 indexes found."), 400);
      }
      const bounds = await getDatasetBounds(datasetId);
      await registerDataset(datasetId, file.name, "polygon", projectId);
      return c.json({
        ok: true,
        datasetId,
        inserted: result.inserted,
        skipped: result.skipped,
        bounds,
        geometryTypes: ["Polygon"],
        suggestedLayerType: "fill",
        renderType: "polygon",
        tiles: { polygons: `${MARTIN_BASE}/polygons/{z}/{x}/{y}` },
        processingMs: Date.now() - startedAt,
      });
    }

    // WKT mode — supports points, lines, polygons from a geometry column
    if (wktColumn) {
      let inserted = 0;
      let skipped = 0;
      const geomTypes = new Set<string>();

      await sql.begin(async (tx) => {
        for (const r of rows) {
          const wkt = r[wktColumn];
          if (!wkt || typeof wkt !== "string") { skipped++; continue; }
          const props = { ...r, dataset_id: datasetId };
          try {
            // Detect type from WKT prefix
            const upper = wkt.trim().toUpperCase();
            let table = "points";
            if (upper.startsWith("LINESTRING") || upper.startsWith("MULTILINESTRING")) {
              table = "lines";
              geomTypes.add(upper.startsWith("MULTI") ? "MultiLineString" : "LineString");
            } else if (upper.startsWith("POLYGON") || upper.startsWith("MULTIPOLYGON")) {
              table = "polygons";
              geomTypes.add(upper.startsWith("MULTI") ? "MultiPolygon" : "Polygon");
            } else {
              geomTypes.add(upper.startsWith("MULTI") ? "MultiPoint" : "Point");
            }
            await tx.unsafe(
              `INSERT INTO ${table} (dataset_id, project_id, geom, props)
               VALUES ($1, $2, ST_SetSRID(ST_GeomFromText($3), 4326), $4::jsonb)`,
              [datasetId, projectId, wkt, JSON.stringify(props)]
            );
            inserted++;
          } catch { skipped++; }
        }
      });

      if (inserted === 0) {
        return c.json(badRequest("NO_VALID_WKT", "No valid WKT geometries found."), 400);
      }

      const geometryTypes = [...geomTypes];
      const suggestedLayerType = inferSuggestedLayerTypeFromGeomTypes(geometryTypes);
      const renderType = inferDatasetRenderType(geometryTypes);
      const bounds = await getDatasetBounds(datasetId);
      await registerDataset(datasetId, file.name, renderType, projectId);
      return c.json({
        ok: true, datasetId, inserted, bounds, geometryTypes,
        suggestedLayerType, renderType,
        tiles: { points: `${MARTIN_BASE}/points/{z}/{x}/{y}`, lines: `${MARTIN_BASE}/lines/{z}/{x}/{y}`, polygons: `${MARTIN_BASE}/polygons/{z}/{x}/{y}` },
        processingMs: Date.now() - startedAt,
      });
    }
    
    if (!latColumn || !lngColumn) {
      return c.json(
        badRequest("CSV_COLUMNS_REQUIRED", "Latitude/Longitude columns not found. For line/polygon data, use a GeoJSON file or a CSV with a WKT geometry column named 'wkt', 'geometry', or 'geom'."),
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

        const props = { ...r, dataset_id: datasetId };

        await tx.unsafe(
          `INSERT INTO points (dataset_id, project_id, geom, props)
           VALUES ($1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326), $5::jsonb)`,
          [datasetId, projectId, lng, lat, JSON.stringify(props)]
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
    await registerDataset(datasetId, file.name, "point", projectId);
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
        points: `${MARTIN_BASE}/points/{z}/{x}/{y}`,
      },
      processingMs: Date.now() - startedAt,
    });
  }

  return c.json(badRequest("UNSUPPORTED_FILE", "Unsupported file type"), 400);
});

// ── Chunked upload: init ──────────────────────────────────────────────────────

app.post("/datasets/upload/init", async (c) => {
  const body = await c.req.json();
  const { fileName, fileSize, totalChunks, latColumn, lngColumn, h3Column } = body;

  if (!fileName || !totalChunks) {
    return c.json(
      badRequest("INVALID_INIT", "fileName and totalChunks required"),
      400
    );
  }

  const uploadId = crypto.randomUUID();
  const uploadDir = join(TEMP_DIR, uploadId);
  await mkdir(uploadDir, { recursive: true });

  await Bun.write(
    join(uploadDir, "meta.json"),
    JSON.stringify({ fileName, fileSize, totalChunks, latColumn, lngColumn, h3Column })
  );

  console.log(`[chunked] init uploadId=${uploadId} file=${fileName} chunks=${totalChunks}`);

  return c.json({ ok: true, uploadId });
});

// ── Chunked upload: receive chunk ─────────────────────────────────────────────

app.post("/datasets/upload/chunk", async (c) => {
  const body = await c.req.parseBody();
  console.log("UPLOAD BODY KEYS:", Object.keys(body));
  console.log("h3Column value:", body["h3Column"]);
  const uploadId = body["uploadId"] as string;
  const chunkIndex = Number(body["chunkIndex"]);
  const chunk = body["chunk"];

  if (!uploadId || isNaN(chunkIndex) || !(chunk instanceof File)) {
    return c.json(
      badRequest("INVALID_CHUNK", "uploadId, chunkIndex, and chunk required"),
      400
    );
  }

  const uploadDir = join(TEMP_DIR, uploadId);
  if (!existsSync(uploadDir)) {
    return c.json(badRequest("UNKNOWN_UPLOAD", "Upload session not found"), 404);
  }

  const chunkPath = join(uploadDir, `chunk_${String(chunkIndex).padStart(6, "0")}`);
  await Bun.write(chunkPath, await chunk.arrayBuffer());

  console.log(`[chunked] received chunk ${chunkIndex} for uploadId=${uploadId}`);

  return c.json({ ok: true, chunkIndex });
});

// ── Chunked upload: finalize ──────────────────────────────────────────────────

app.post("/datasets/upload/finalize", async (c) => {
  const startedAt = Date.now();
  const { uploadId } = await c.req.json();

  if (!uploadId) {
    return c.json(badRequest("INVALID_FINALIZE", "uploadId required"), 400);
  }

  const uploadDir = join(TEMP_DIR, uploadId);
  if (!existsSync(uploadDir)) {
    return c.json(badRequest("UNKNOWN_UPLOAD", "Upload session not found"), 404);
  }

  const meta = JSON.parse(await Bun.file(join(uploadDir, "meta.json")).text());
  const { fileName, totalChunks, latColumn, lngColumn } = meta;

  console.log(`[chunked] finalizing uploadId=${uploadId} file=${fileName} chunks=${totalChunks}`);

  const assembledPath = join(uploadDir, "assembled");
  const outFd = await open(assembledPath, "w");

  try {
    for (let i = 0; i < totalChunks; i++) {
      const chunkPath = join(uploadDir, `chunk_${String(i).padStart(6, "0")}`);
      const chunkData = await Bun.file(chunkPath).arrayBuffer();
      await outFd.write(new Uint8Array(chunkData));
    }
  } finally {
    await outFd.close();
  }

  console.log(`[chunked] assembled ${fileName} at ${assembledPath}`);

  const datasetId = crypto.randomUUID();
  const projectId = getProjectId(c);
  const lower = fileName.toLowerCase();

  try {
    if (lower.endsWith(".geojson") || lower.endsWith(".json")) {
      const result = await streamGeoJSONIntoDB(assembledPath, datasetId, projectId);

      if (result.inserted === 0) {
        return c.json(
          badRequest("NO_VALID_FEATURES", "No valid features could be inserted."),
          400
        );
      }

      const geometryTypes = [...result.geomTypes];
      const suggestedLayerType = inferSuggestedLayerTypeFromGeomTypes(geometryTypes);
      const renderType = inferDatasetRenderType(geometryTypes);
      const bounds = await getDatasetBounds(datasetId);
      await registerDataset(datasetId, fileName, renderType, projectId);
      return c.json({
        ok: true,
        datasetId,
        inserted: result.inserted,
        bounds,
        geometryTypes,
        suggestedLayerType,
        renderType,
        tiles: {
          points: `${MARTIN_BASE}/points/{z}/{x}/{y}`,
          lines: `${MARTIN_BASE}/lines/{z}/{x}/{y}`,
          polygons: `${MARTIN_BASE}/polygons/{z}/{x}/{y}`,
        },
        processingMs: Date.now() - startedAt,
      });
    }

    if (lower.endsWith(".csv")) {
      const h3Column = meta.h3Column ?? null;

      if (h3Column) {
        const result = await streamH3CSVIntoDB(assembledPath, datasetId, projectId, h3Column);
        if (result.inserted === 0) {
          return c.json(badRequest("NO_VALID_H3", "No valid H3 indexes found."), 400);
        }
        const bounds = await getDatasetBounds(datasetId);
        await registerDataset(datasetId, fileName, "polygon", projectId);
        return c.json({
          ok: true,
          datasetId,
          inserted: result.inserted,
          skipped: result.skipped,
          bounds,
          geometryTypes: ["Polygon"],
          suggestedLayerType: "fill",
          renderType: "polygon",
          tiles: { polygons: `${MARTIN_BASE}/polygons/{z}/{x}/{y}` },
          processingMs: Date.now() - startedAt,
        });
      }

      if (!latColumn || !lngColumn) {
        return c.json(
          badRequest("CSV_COLUMNS_REQUIRED", "Latitude/Longitude columns not found. For line/polygon data, use a GeoJSON file or a CSV with a WKT geometry column named 'wkt', 'geometry', or 'geom'."),
          400
        );
      }

      const result = await streamCSVIntoDB(assembledPath, datasetId, projectId, latColumn, lngColumn);
      if (result.inserted === 0) {
        return c.json(
          badRequest("NO_VALID_COORDINATES", "No valid coordinate rows found."),
          400
        );
      }

      const bounds = await getDatasetBounds(datasetId);
      await registerDataset(datasetId, fileName, "point", projectId);
      return c.json({
        ok: true,
        datasetId,
        inserted: result.inserted,
        skipped: result.skipped,
        bounds,
        geometryTypes: ["Point"],
        suggestedLayerType: "circle",
        renderType: "point",
        tiles: {
          points: `${MARTIN_BASE}/points/{z}/{x}/{y}`,
        },
        processingMs: Date.now() - startedAt,
      });
    }

    return c.json(badRequest("UNSUPPORTED_FILE", "Unsupported file type"), 400);
  } finally {
    Bun.spawn(["rm", "-rf", uploadDir]);
  }
});

// ── Dataset catalog ───────────────────────────────────────────────────────────

// GET /datasets — full catalog with feature counts + bounds
app.get("/datasets", async (c) => {
  const projectId = getProjectId(c);
  const rows = await sql`
    SELECT
      d.id,
      d.name,
      d.kind,
      d.table_name,
      d.created_at,
      COALESCE(p.cnt, 0) + COALESCE(l.cnt, 0) + COALESCE(pg.cnt, 0) AS feature_count,
      ST_XMin(ext.b) AS minx,
      ST_YMin(ext.b) AS miny,
      ST_XMax(ext.b) AS maxx,
      ST_YMax(ext.b) AS maxy
    FROM datasets d
    LEFT JOIN (
      SELECT dataset_id, COUNT(*)::int cnt FROM points GROUP BY dataset_id
    ) p ON p.dataset_id = d.id
    LEFT JOIN (
      SELECT dataset_id, COUNT(*)::int cnt FROM lines GROUP BY dataset_id
    ) l ON l.dataset_id = d.id
    LEFT JOIN (
      SELECT dataset_id, COUNT(*)::int cnt FROM polygons pg GROUP BY dataset_id
    ) pg ON pg.dataset_id = d.id
    LEFT JOIN LATERAL (
      SELECT ST_Extent(geom) AS b FROM (
        SELECT geom FROM points   WHERE dataset_id = d.id
        UNION ALL
        SELECT geom FROM lines    WHERE dataset_id = d.id
        UNION ALL
        SELECT geom FROM polygons WHERE dataset_id = d.id
      ) q
    ) ext ON true
    WHERE d.project_id = ${projectId}
    ORDER BY d.created_at DESC
  `;

  const datasets = rows.map((r: any) => ({
    id:            String(r.id),
    name:          r.name,
    kind:          r.kind,
    table_name:    r.table_name,
    created_at:    r.created_at,
    feature_count: Number(r.feature_count ?? 0),
    bounds:
      r.minx != null
        ? [Number(r.minx), Number(r.miny), Number(r.maxx), Number(r.maxy)]
        : null,
  }));

  return c.json({ ok: true, datasets });
});

// DELETE /datasets/:datasetId — wipe all features + catalog row
app.delete("/datasets/:datasetId", async (c) => {
  const { datasetId } = c.req.param();
  await sql.begin(async (tx) => {
    await tx.unsafe(`DELETE FROM points   WHERE dataset_id = $1::uuid`, [datasetId]);
    await tx.unsafe(`DELETE FROM lines    WHERE dataset_id = $1::uuid`, [datasetId]);
    await tx.unsafe(`DELETE FROM polygons WHERE dataset_id = $1::uuid`, [datasetId]);
    await tx.unsafe(`DELETE FROM datasets WHERE id          = $1::uuid`, [datasetId]);
  });
  return c.json({ ok: true });
});

// GET /datasets/:datasetId/features — full GeoJSON for a dataset
app.get("/datasets/:datasetId/features", async (c) => {
  const { datasetId } = c.req.param();
  const table = c.req.query("table") ?? "points";

  if (!["points", "lines", "polygons"].includes(table)) {
    return c.json(badRequest("BAD_TABLE", "Invalid table"), 400);
  }

  const noGeom = c.req.query("nogeom") === "true";

  const rows = await sql.unsafe(
    `SELECT id::text,
            props
            ${noGeom ? "" : ", ST_AsGeoJSON(geom)::json AS geometry"}
     FROM ${table}
     WHERE dataset_id = $1::uuid`,
    [datasetId]
  );

  const features = rows.map((r: any) => {
    let rawProps = r.props ?? {};
    if (typeof rawProps === "string") {
      try { rawProps = JSON.parse(rawProps); } catch { rawProps = {}; }
    }
    return {
      type:     "Feature",
      id:       r.id,
      geometry: noGeom ? null : r.geometry,
      properties: { ...rawProps, _fid: r.id },
    };
  });
  return c.json({ type: "FeatureCollection", features });
});


// GET /datasets/:datasetId/column-stats/:column — min, max, mean of a numeric column
app.get("/datasets/:datasetId/column-stats/:column", async (c) => {
  const { datasetId, column } = c.req.param();
  const tables = ["points", "lines", "polygons"];
  let table = "points";

  for (const tbl of tables) {
    const rows = await sql.unsafe(
      `SELECT COUNT(*)::int AS cnt FROM ${tbl} WHERE dataset_id = $1::uuid`,
      [datasetId]
    ) as any[];
    if (Number(rows[0]?.cnt) > 0) { table = tbl; break; }
  }

  const rows = await sql.unsafe(
    `SELECT
       MIN((CASE jsonb_typeof(props)
         WHEN 'object' THEN props->>$2
         WHEN 'string' THEN (props #>> '{}')::jsonb->>$2
       END)::numeric) AS min,
       MAX((CASE jsonb_typeof(props)
         WHEN 'object' THEN props->>$2
         WHEN 'string' THEN (props #>> '{}')::jsonb->>$2
       END)::numeric) AS max,
       AVG((CASE jsonb_typeof(props)
         WHEN 'object' THEN props->>$2
         WHEN 'string' THEN (props #>> '{}')::jsonb->>$2
       END)::numeric) AS mean
     FROM ${table}
     WHERE dataset_id = $1::uuid`,
    [datasetId, column]
  ) as any[];

  const row = rows[0];
  return c.json({
    ok: true,
    min: row?.min != null ? Number(row.min) : null,
    max: row?.max != null ? Number(row.max) : null,
    mean: row?.mean != null ? Number(row.mean) : null,
  });
});

// GET /datasets/:datasetId/rows — props only, paginated (for attribute table)
app.get("/datasets/:datasetId/rows", async (c) => {
  const { datasetId } = c.req.param();
  const table  = c.req.query("table") ?? "points";
  const limit  = Math.min(Number(c.req.query("limit")  ?? 500), 2000);
  const offset = Number(c.req.query("offset") ?? 0);

  if (!["points", "lines", "polygons"].includes(table)) {
    return c.json(badRequest("BAD_TABLE", "Invalid table"), 400);
  }

  const rows = await sql.unsafe(
    `SELECT id::text, props
     FROM ${table}
     WHERE dataset_id = $1::uuid
     ORDER BY id
     LIMIT $2 OFFSET $3`,
    [datasetId, limit, offset]
  ) as any[];

  const features = rows.map((r: any) => {
    let rawProps = r.props ?? {};
    if (typeof rawProps === "string") {
      try { rawProps = JSON.parse(rawProps); } catch { rawProps = {}; }
    }
    return { id: r.id, properties: { ...rawProps, _fid: r.id } };
  });

  return c.json({ ok: true, features });
});



// GET /datasets/:datasetId/columns
app.get("/datasets/:datasetId/columns", async (c) => {
  const { datasetId } = c.req.param();
  const tables = ["points", "lines", "polygons"];

  for (const tbl of tables) {
    const countRows = await sql.unsafe(
      `SELECT COUNT(*)::int AS cnt FROM ${tbl} WHERE dataset_id = $1::uuid`,
      [datasetId]
    ) as any[];
    if (Number(countRows[0]?.cnt) === 0) continue;

    // Handle both object and double-encoded string props
    const keyRows = await sql.unsafe(
      `SELECT DISTINCT k
       FROM ${tbl},
       LATERAL jsonb_object_keys(
         CASE jsonb_typeof(props)
           WHEN 'object' THEN props
           WHEN 'string' THEN (props #>> '{}')::jsonb
           ELSE NULL
         END
       ) AS k
       WHERE dataset_id = $1::uuid`,
      [datasetId]
    ) as any[];

    const columns = keyRows
      .map((r: any) => String(r.k))
      .filter((k: string) => !["dataset_id", "_fid"].includes(k));

    return c.json({ ok: true, columns });
  }

  return c.json({ ok: true, columns: [] });
});

// GET /datasets/:datasetId/column-values/:column
app.get("/datasets/:datasetId/column-values/:column", async (c) => {
  const { datasetId, column } = c.req.param();
  const tables = ["points", "lines", "polygons"];
  let table = "points";

  for (const tbl of tables) {
    const rows = await sql.unsafe(
      `SELECT COUNT(*)::int AS cnt FROM ${tbl} WHERE dataset_id = $1::uuid`,
      [datasetId]
    ) as any[];
    if (Number(rows[0]?.cnt) > 0) { table = tbl; break; }
  }

  // Unwrap double-encoded props if needed
  const totalRows = await sql.unsafe(
    `SELECT COUNT(DISTINCT
       CASE jsonb_typeof(props)
         WHEN 'object' THEN props->>$2
         WHEN 'string' THEN (props #>> '{}')::jsonb->>$2
       END
     )::int AS total
     FROM ${table}
     WHERE dataset_id = $1::uuid`,
    [datasetId, column]
  ) as any[];
  const total = Number(totalRows[0]?.total ?? 0);
  const limit = Math.min(total, 10);

  if (limit === 0) return c.json({ ok: true, values: [], totalDistinct: 0 });

  const valueRows = await sql.unsafe(
    `SELECT
       CASE jsonb_typeof(props)
         WHEN 'object' THEN props->>$2
         WHEN 'string' THEN (props #>> '{}')::jsonb->>$2
       END AS val,
       COUNT(*)::int AS cnt
     FROM ${table}
     WHERE dataset_id = $1::uuid
     GROUP BY val
     ORDER BY cnt DESC
     LIMIT $3`,
    [datasetId, column, limit]
  ) as any[];

  const values = valueRows
    .filter((r: any) => r.val != null)
    .map((r: any) => ({ value: String(r.val), count: Number(r.cnt) }));

  return c.json({ ok: true, values, totalDistinct: total });
});

// POST /datasets/:datasetId/filter-count
app.post("/datasets/:datasetId/filter-count", async (c) => {
  const { datasetId } = c.req.param();
  const { rules } = await c.req.json() as { rules: { col: string; op: string; val: string }[] };
  const tables = ["points", "lines", "polygons"];
  let table = "points";
  let totalCount = 0;

  for (const tbl of tables) {
    const rows = await sql.unsafe(
      `SELECT COUNT(*)::int AS cnt FROM ${tbl} WHERE dataset_id = $1::uuid`,
      [datasetId]
    ) as any[];
    if (Number(rows[0]?.cnt) > 0) { table = tbl; totalCount = Number(rows[0].cnt); break; }
  }

  if (!rules || rules.length === 0) {
    return c.json({ ok: true, count: totalCount, total: totalCount });
  }

  // Helper expression to unwrap props regardless of encoding
  const propVal = (col: string, paramIdx: number) =>
    `CASE jsonb_typeof(props) WHEN 'object' THEN props->>$${paramIdx} WHEN 'string' THEN (props #>> '{}')::jsonb->>$${paramIdx} END`;

  const params: any[] = [datasetId];
  const conditions: string[] = [`dataset_id = $1::uuid`];

  for (const rule of rules) {
    const colIdx = params.length + 1;
    params.push(rule.col);
    const pv = propVal(rule.col, colIdx);

    if (rule.op === "is empty") {
      conditions.push(`(${pv} IS NULL OR ${pv} = '')`);
    } else if (rule.op === "contains") {
      const valIdx = params.length + 1;
      params.push(`%${rule.val}%`);
      conditions.push(`${pv} ILIKE $${valIdx}`);
    } else if ([">", "<", "≥", "≤"].includes(rule.op)) {
      const valIdx = params.length + 1;
      params.push(rule.val);
      const pgOp = rule.op === "≥" ? ">=" : rule.op === "≤" ? "<=" : rule.op;
      conditions.push(`(${pv})::numeric ${pgOp} ($${valIdx})::numeric`);
    } else {
      const valIdx = params.length + 1;
      params.push(rule.val);
      const pgOp = rule.op === "≠" ? "!=" : "=";
      conditions.push(`${pv} ${pgOp} $${valIdx}`);
    }
  }

  const rows = await sql.unsafe(
    `SELECT COUNT(*)::int AS cnt FROM ${table} WHERE ${conditions.join(" AND ")}`,
    params
  ) as any[];

  return c.json({ ok: true, count: Number(rows[0]?.cnt ?? 0), total: totalCount });
});

// POST /datasets/:datasetId/features — add a single feature
app.post("/datasets/:datasetId/features", async (c) => {
  const { datasetId } = c.req.param();
  const body        = await c.req.json();
  const { geometry, properties, table } = body as any;

  const targetTable: string | null = table ?? getTargetTable(geometry?.type);
  if (!targetTable) return c.json(badRequest("BAD_GEOM", "Unknown geometry type"), 400);

  const projectId = getProjectId(c);
  const [row] = await sql.unsafe(
    `INSERT INTO ${targetTable} (dataset_id, project_id, geom, props)
     VALUES ($1::uuid, $2, ST_SetSRID(ST_GeomFromGeoJSON($3), 4326), to_json($4::text)::jsonb)
     RETURNING id::text`,
    [datasetId, projectId, JSON.stringify(geometry), sql.json({ ...(properties ?? {}), dataset_id: datasetId })]
  );

  return c.json({ ok: true, id: (row as any).id });
});

// GET /features/:table/:featureId — fetch single feature's full properties
app.get("/features/:table/:featureId", async (c) => {
  const { table, featureId } = c.req.param();
  if (!["points", "lines", "polygons"].includes(table)) {
    return c.json(badRequest("BAD_TABLE", "Invalid table"), 400);
  }
  const rows = await sql.unsafe(
    `SELECT id::text, props, ST_AsGeoJSON(geom)::json AS geometry
     FROM ${table} WHERE id = $1::uuid`,
    [featureId]
  );
  if (!rows.length) return c.json({ ok: false, error: "Not found" }, 404);
  const r = rows[0] as any;
  // props may be stored as a JSON string inside the jsonb column — parse if needed
  let rawProps = r.props ?? {};
  if (typeof rawProps === "string") {
    try { rawProps = JSON.parse(rawProps); } catch { rawProps = {}; }
  }
  const props = { ...rawProps };
  delete props.dataset_id;
  return c.json({
    ok: true,
    properties: { ...props, _fid: r.id },
    geometry: r.geometry,
  });
});

// PATCH /features/:table/:featureId — update geometry and/or props
app.patch("/features/:table/:featureId", async (c) => {
  const { table, featureId } = c.req.param();
  const body = await c.req.json() as any;
  const { geometry, properties } = body;

  if (!["points", "lines", "polygons"].includes(table)) {
    return c.json(badRequest("BAD_TABLE", "Invalid table"), 400);
  }

  if (geometry && properties) {
    await sql.unsafe(
      `UPDATE ${table}
       SET geom  = ST_SetSRID(ST_GeomFromGeoJSON($1), 4326),
           props = to_json($2::text)::jsonb
       WHERE id = $3::uuid`,
      [JSON.stringify(geometry), JSON.stringify(properties), featureId]
    );
  } else if (geometry) {
    await sql.unsafe(
      `UPDATE ${table} SET geom = ST_SetSRID(ST_GeomFromGeoJSON($1), 4326) WHERE id = $2::uuid`,
      [JSON.stringify(geometry), featureId]
    );
  } else if (properties) {
    await sql.unsafe(
      `UPDATE ${table} SET props = to_json($1::text)::jsonb WHERE id = $2::uuid`,
      [JSON.stringify(properties), featureId]
    );
  }

  return c.json({ ok: true });
});

// DELETE /features/:table/:featureId
app.delete("/features/:table/:featureId", async (c) => {
  const { table, featureId } = c.req.param();
  if (!["points", "lines", "polygons"].includes(table)) {
    return c.json(badRequest("BAD_TABLE", "Invalid table"), 400);
  }
  await sql.unsafe(`DELETE FROM ${table} WHERE id = $1::uuid`, [featureId]);
  return c.json({ ok: true });
});

// GET /datasets/:datasetId/bounds — dedicated bounds endpoint
app.get("/datasets/:datasetId/bounds", async (c) => {
  const { datasetId } = c.req.param();
  const bounds = await getDatasetBounds(datasetId);
  return c.json({ ok: true, bounds });
});

// ── Start server ──────────────────────────────────────────────────────────────

serve({
  fetch: app.fetch,
  port: PORT,
});

console.log("Upload service running → http://localhost:" + PORT);
