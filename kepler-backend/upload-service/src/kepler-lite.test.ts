/**
 * kepler-lite — Unit Tests
 *
 * Covers:
 *   - sanitizeProps        (MapView.tsx)
 *   - computeBreaks        (FeltUI.tsx)
 *   - filter-rule matching (MapView.tsx inline filter)
 *   - ScaleBar math        (FeltUI.tsx)
 *   - filter-count SQL builder helpers (server.ts)
 *
 * Run with:  bun test   (or  npx vitest run)
 */

import { describe, it, expect } from "bun:test";

// ─────────────────────────────────────────────────────────────────────────────
// Re-implementations of pure functions extracted from source files.
// In a real project these would be exported from their modules and imported here.
// ─────────────────────────────────────────────────────────────────────────────

// ── sanitizeProps ─────────────────────────────────────────────────────────────
function sanitizeProps(raw: Record<string, any>): Record<string, string> {
  const cleaned: Record<string, any> = { ...raw };
  delete cleaned._fid;
  delete cleaned.dataset_id;
  delete cleaned._sanitized;
  delete cleaned._pending;
  if (typeof cleaned.id === "string" && /^[0-9a-f-]{36}$/.test(cleaned.id)) {
    delete cleaned.id;
  }
  const entries = Object.entries(cleaned);
  if (entries.length === 0) return {};

  const isCharIndexed =
    entries.length > 2 && entries.every(([k]) => /^\d+$/.test(k));

  if (isCharIndexed) {
    const rejoined = entries
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([, v]) => v)
      .join("");
    try {
      const parsed = JSON.parse(rejoined);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return sanitizeProps(parsed);
      }
    } catch { return {}; }
  }

  if (entries.length === 1 && entries[0][0] === "props") {
    const inner = entries[0][1];
    if (typeof inner === "string") {
      try {
        const parsed = JSON.parse(inner);
        if (parsed && typeof parsed === "object") return sanitizeProps(parsed);
      } catch { /* fall through */ }
    }
    if (typeof inner === "object" && inner !== null) return sanitizeProps(inner);
  }

  const filtered = entries.filter(([k]) => !/^\d+$/.test(k));
  if (filtered.length === 0) return {};

  return Object.fromEntries(
    filtered.map(([k, v]) => [k, v === null || v === undefined ? "" : String(v)])
  );
}

// ── computeBreaks ─────────────────────────────────────────────────────────────
type ClassMethod = "equalInterval" | "quantile" | "naturalBreaks" | "stdDev";

function computeBreaks(nums: number[], n: number, method: ClassMethod): number[] {
  if (nums.length === 0 || n < 2) return [];
  const sorted = [...nums].sort((a, b) => a - b);
  const min = sorted[0], max = sorted[sorted.length - 1];

  if (method === "equalInterval") {
    const step = (max - min) / n;
    return Array.from({ length: n + 1 }, (_, i) => min + i * step);
  }

  if (method === "quantile") {
    const breaks = [min];
    for (let i = 1; i < n; i++) {
      const idx = (i / n) * (sorted.length - 1);
      const lo = Math.floor(idx), hi = Math.ceil(idx);
      breaks.push(sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo));
    }
    breaks.push(max);
    return breaks;
  }

  // naturalBreaks / stdDev fall back gracefully
  return [min, max];
}

// ── ScaleBar meter-per-pixel math ─────────────────────────────────────────────
function metersPerPixel(zoom: number, latitude: number): number {
  return (156543.03392 * Math.cos((latitude * Math.PI) / 180)) / Math.pow(2, zoom);
}

function scaleBarLabel(zoom: number, latitude: number): { val: number; unit: string } {
  const mpp = metersPerPixel(zoom, latitude);
  const raw = mpp * 100;
  let val: number; let unit: string;
  if (raw >= 1000) {
    const km = raw / 1000;
    val = km >= 100 ? Math.round(km / 50) * 50 : km >= 10 ? Math.round(km / 5) * 5 : Math.round(km);
    unit = "km";
  } else {
    val = raw >= 100 ? Math.round(raw / 50) * 50 : raw >= 10 ? Math.round(raw / 5) * 5 : Math.max(1, Math.round(raw));
    unit = "m";
  }
  return { val, unit };
}

// ── Filter-rule matching (client-side, from MapView.tsx) ─────────────────────
type FilterRule = { col: string; op: string; val: string; vals?: string[] };

function matchesRule(props: Record<string, any>, rule: FilterRule): boolean {
  const v = props[rule.col];
  if (rule.op === "=")        return (rule.vals?.length ?? 0) > 0 ? rule.vals!.includes(String(v ?? "")) : String(v ?? "") === rule.val;
  if (rule.op === "≠")        return (rule.vals?.length ?? 0) > 0 ? !rule.vals!.includes(String(v ?? "")) : String(v ?? "") !== rule.val;
  if (rule.op === ">")        return Number(v) > Number(rule.val);
  if (rule.op === "<")        return Number(v) < Number(rule.val);
  if (rule.op === "≥")        return Number(v) >= Number(rule.val);
  if (rule.op === "≤")        return Number(v) <= Number(rule.val);
  if (rule.op === "contains") return String(v ?? "").includes(rule.val);
  if (rule.op === "is empty") return !v || v === "";
  return true;
}

function matchesAllRules(props: Record<string, any>, rules: FilterRule[]): boolean {
  return rules.every((r) => matchesRule(props, r));
}

// ─────────────────────────────────────────────────────────────────────────────
// TESTS
// ─────────────────────────────────────────────────────────────────────────────

describe("sanitizeProps", () => {
  it("removes internal metadata keys", () => {
    const result = sanitizeProps({
      _fid: "abc",
      dataset_id: "xyz",
      _sanitized: {},
      _pending: true,
      name: "Park",
    });
    expect(result).toEqual({ name: "Park" });
  });

  it("strips UUID-shaped id but keeps meaningful id values", () => {
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    expect(sanitizeProps({ id: uuid, name: "A" })).toEqual({ name: "A" });
    expect(sanitizeProps({ id: "myCustomId", name: "B" })).toEqual({ id: "myCustomId", name: "B" });
  });

  it("returns empty object when no useful keys remain", () => {
    expect(sanitizeProps({ _fid: "1", dataset_id: "2" })).toEqual({});
  });

  it("coerces null and undefined values to empty string", () => {
    const result = sanitizeProps({ name: null, code: undefined, pop: 42 });
    expect(result.name).toBe("");
    expect(result.code).toBe("");
    expect(result.pop).toBe("42");
  });

  it("unwraps a single 'props' string wrapper (JSON)", () => {
    const inner = JSON.stringify({ city: "Mumbai", pop: "20000000" });
    expect(sanitizeProps({ props: inner })).toEqual({ city: "Mumbai", pop: "20000000" });
  });

  it("unwraps a single 'props' object wrapper", () => {
    expect(sanitizeProps({ props: { city: "Delhi" } })).toEqual({ city: "Delhi" });
  });

  it("handles char-indexed objects (Martin tile mangling)", () => {
    // Simulate Martin splitting '{"k":"v"}' into char-indexed keys
    const json = '{"name":"Test"}';
    const charObj: Record<string, string> = {};
    [...json].forEach((ch, i) => { charObj[String(i)] = ch; });
    expect(sanitizeProps(charObj)).toEqual({ name: "Test" });
  });

  it("filters out stray numeric-only keys mixed with named keys", () => {
    expect(sanitizeProps({ "0": "junk", name: "Valid" })).toEqual({ name: "Valid" });
  });

  it("returns empty object for fully char-indexed invalid JSON", () => {
    // Char-indexed but not valid JSON once rejoined
    const charObj: Record<string, string> = { "0": "x", "1": "y", "2": "z" };
    expect(sanitizeProps(charObj)).toEqual({});
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("computeBreaks – equalInterval", () => {
  it("returns n+1 breaks covering [min, max]", () => {
    const breaks = computeBreaks([0, 10, 20, 30, 40, 50], 5, "equalInterval");
    expect(breaks.length).toBe(6);
    expect(breaks[0]).toBe(0);
    expect(breaks[5]).toBe(50);
  });

  it("produces evenly-spaced steps", () => {
    const breaks = computeBreaks([0, 100], 4, "equalInterval");
    expect(breaks).toEqual([0, 25, 50, 75, 100]);
  });

  it("handles unsorted input", () => {
    const breaks = computeBreaks([50, 10, 30, 0, 40, 20], 5, "equalInterval");
    expect(breaks[0]).toBe(0);
    expect(breaks[5]).toBe(50);
  });

  it("returns [] for empty array", () => {
    expect(computeBreaks([], 5, "equalInterval")).toEqual([]);
  });

  it("returns [] when n < 2", () => {
    expect(computeBreaks([1, 2, 3], 1, "equalInterval")).toEqual([]);
  });
});

describe("computeBreaks – quantile", () => {
  it("returns n+1 breaks starting and ending at min/max", () => {
    const data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const breaks = computeBreaks(data, 4, "quantile");
    expect(breaks.length).toBe(5);
    expect(breaks[0]).toBe(1);
    expect(breaks[4]).toBe(10);
  });

  it("distributes data into roughly equal-count buckets", () => {
    // For 10 values split into 2 quantiles, the midpoint break should be ~5.5
    const data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const breaks = computeBreaks(data, 2, "quantile");
    expect(breaks[1]).toBeCloseTo(5.5, 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("ScaleBar math", () => {
  it("returns meters for close zoom levels", () => {
    const { unit } = scaleBarLabel(14, 19.07); // Mumbai, zoom 14
    expect(unit).toBe("m");
  });

  it("returns km for low zoom levels", () => {
    const { unit } = scaleBarLabel(5, 0);
    expect(unit).toBe("km");
  });

  it("val is always a positive integer", () => {
    for (const zoom of [3, 8, 12, 16]) {
      const { val } = scaleBarLabel(zoom, 40);
      expect(val).toBeGreaterThan(0);
      expect(Number.isInteger(val)).toBe(true);
    }
  });

  it("mpp decreases as zoom increases", () => {
    const low  = metersPerPixel(5,  0);
    const high = metersPerPixel(15, 0);
    expect(high).toBeLessThan(low);
  });

  it("mpp decreases toward poles (higher latitude = cos closer to 0)", () => {
    const equator = metersPerPixel(10, 0);
    const pole    = metersPerPixel(10, 75);
    expect(pole).toBeLessThan(equator);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("Filter-rule matching", () => {
  const props = { name: "Mumbai", pop: "20000000", area: "603", active: "" };

  describe("= operator", () => {
    it("matches exact string value", () => {
      expect(matchesRule(props, { col: "name", op: "=", val: "Mumbai" })).toBe(true);
    });
    it("does not match wrong value", () => {
      expect(matchesRule(props, { col: "name", op: "=", val: "Delhi" })).toBe(false);
    });
    it("matches when value is in vals array", () => {
      expect(matchesRule(props, { col: "name", op: "=", val: "", vals: ["Mumbai", "Delhi"] })).toBe(true);
    });
    it("does not match when value is not in vals array", () => {
      expect(matchesRule(props, { col: "name", op: "=", val: "", vals: ["Pune", "Goa"] })).toBe(false);
    });
  });

  describe("≠ operator", () => {
    it("excludes exact match", () => {
      expect(matchesRule(props, { col: "name", op: "≠", val: "Mumbai" })).toBe(false);
    });
    it("passes non-matching value", () => {
      expect(matchesRule(props, { col: "name", op: "≠", val: "Delhi" })).toBe(true);
    });
    it("excludes when value is in vals array", () => {
      expect(matchesRule(props, { col: "name", op: "≠", val: "", vals: ["Mumbai"] })).toBe(false);
    });
  });

  describe("numeric operators", () => {
    it("> passes when prop is greater", () => {
      expect(matchesRule(props, { col: "pop", op: ">", val: "1000000" })).toBe(true);
    });
    it("> fails when prop is equal", () => {
      expect(matchesRule(props, { col: "pop", op: ">", val: "20000000" })).toBe(false);
    });
    it("< passes when prop is less", () => {
      expect(matchesRule(props, { col: "area", op: "<", val: "1000" })).toBe(true);
    });
    it("≥ passes when prop equals threshold", () => {
      expect(matchesRule(props, { col: "area", op: "≥", val: "603" })).toBe(true);
    });
    it("≤ passes when prop equals threshold", () => {
      expect(matchesRule(props, { col: "area", op: "≤", val: "603" })).toBe(true);
    });
    it("≤ fails when prop exceeds threshold", () => {
      expect(matchesRule(props, { col: "area", op: "≤", val: "100" })).toBe(false);
    });
  });

  describe("contains operator", () => {
    it("matches substring", () => {
      expect(matchesRule(props, { col: "name", op: "contains", val: "bai" })).toBe(true);
    });
    it("does not match absent substring", () => {
      expect(matchesRule(props, { col: "name", op: "contains", val: "Delhi" })).toBe(false);
    });
  });

  describe("is empty operator", () => {
    it("matches empty string", () => {
      expect(matchesRule(props, { col: "active", op: "is empty", val: "" })).toBe(true);
    });
    it("does not match non-empty value", () => {
      expect(matchesRule(props, { col: "name", op: "is empty", val: "" })).toBe(false);
    });
    it("matches missing (undefined) property", () => {
      expect(matchesRule(props, { col: "nonexistent", op: "is empty", val: "" })).toBe(true);
    });
  });

  describe("matchesAllRules (AND logic)", () => {
    it("passes when all rules match", () => {
      const rules: FilterRule[] = [
        { col: "name", op: "=", val: "Mumbai" },
        { col: "pop", op: ">", val: "1000000" },
      ];
      expect(matchesAllRules(props, rules)).toBe(true);
    });

    it("fails when any rule fails", () => {
      const rules: FilterRule[] = [
        { col: "name", op: "=", val: "Mumbai" },
        { col: "pop", op: "<", val: "100" },        // fails
      ];
      expect(matchesAllRules(props, rules)).toBe(false);
    });

    it("passes trivially for empty rule set", () => {
      expect(matchesAllRules(props, [])).toBe(true);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("filter-count SQL builder – operator mapping", () => {
  // Extracted logic from server.ts: maps UI operators to Postgres operators
  function pgOp(op: string): string {
    if (op === "≥") return ">=";
    if (op === "≤") return "<=";
    if (op === ">") return ">";
    if (op === "<") return "<";
    return op; // passthrough for plain operators
  }

  function pgEqOp(op: string): string {
    return op === "≠" ? "!=" : "=";
  }

  it("maps ≥ to >=", () => expect(pgOp("≥")).toBe(">="));
  it("maps ≤ to <=", () => expect(pgOp("≤")).toBe("<="));
  it("passes through > and <", () => {
    expect(pgOp(">")).toBe(">");
    expect(pgOp("<")).toBe("<");
  });
  it("maps ≠ to !=", () => expect(pgEqOp("≠")).toBe("!="));
  it("maps = to =",  () => expect(pgEqOp("=")).toBe("="));

  it("contains rule wraps value in ILIKE wildcards", () => {
    const val = "test";
    const likeVal = `%${val}%`;
    expect(likeVal).toBe("%test%");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// NEW SUITES — server.ts pure helpers
// ─────────────────────────────────────────────────────────────────────────────

// ── Re-implementations ────────────────────────────────────────────────────────

function stripUtf8Bom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

function pickCsvSuggestions(fields: string[]) {
  const lower = fields.map((f) => f.toLowerCase().trim());
  const latColumn = fields.find((_, i) => ["lat", "latitude", "y"].includes(lower[i])) ?? null;
  const lngColumn = fields.find((_, i) => ["lng", "lon", "long", "longitude", "x"].includes(lower[i])) ?? null;
  const wktColumn = fields.find((_, i) => ["wkt", "geometry", "geom", "shape", "the_geom", "geo"].includes(lower[i])) ?? null;
  return { latColumn, lngColumn, wktColumn, h3Column: null as string | null };
}

function isH3Index(val: string): boolean {
  if (typeof val !== "string") return false;
  const v = val.trim();
  return /^8[0-9a-f]{14,15}$/i.test(v);
}

function pickH3Column(fields: string[], sampleRows: any[]): string | null {
  const H3_NAME_HINTS = ["h3", "h3index", "h3_index", "hex", "cell", "hexid", "grid_id"];
  for (const field of fields) {
    const sample = sampleRows.slice(0, 10).map((r: any) => String(r[field] ?? ""));
    const matchCount = sample.filter((v) => isH3Index(v)).length;
    if (matchCount >= Math.min(3, sample.length)) return field;
    if (H3_NAME_HINTS.includes(field.toLowerCase().trim()) && matchCount >= 1) return field;
  }
  return null;
}

function normalizeGeoJSONTopLevel(json: any): { features: any[]; noteType: string } {
  if (!json || typeof json !== "object") return { features: [], noteType: "non-object" };
  if (Array.isArray(json)) {
    const isFeatures = json.every((x) => x?.type === "Feature");
    return { features: isFeatures ? json : [], noteType: "array" };
  }
  const t = json.type;
  if (t === "FeatureCollection") return { features: Array.isArray(json.features) ? json.features : [], noteType: "FeatureCollection" };
  if (t === "Feature") return { features: [json], noteType: "Feature" };
  if (["Point","MultiPoint","LineString","MultiLineString","Polygon","MultiPolygon"].includes(t)) {
    return { features: [{ type: "Feature", geometry: json, properties: {} }], noteType: `Geometry:${t}` };
  }
  if (Array.isArray((json as any).features)) return { features: (json as any).features, noteType: `features-without-type:${String(t)}` };
  return { features: [], noteType: `unknown:${String(t)}` };
}

function inferSuggestedLayerTypeFromGeomTypes(geomTypes: string[]): "circle" | "line" | "fill" {
  const hasPolygon = geomTypes.some((t) => t === "Polygon" || t === "MultiPolygon");
  const hasLine    = geomTypes.some((t) => t === "LineString" || t === "MultiLineString");
  const hasPoint   = geomTypes.some((t) => t === "Point" || t === "MultiPoint");
  if (hasPolygon) return "fill";
  if (hasLine)    return "line";
  if (hasPoint)   return "circle";
  return "fill";
}

function inferDatasetRenderType(geomTypes: string[]): "point" | "line" | "polygon" | "mixed" {
  const hasPolygon = geomTypes.some((t) => t === "Polygon" || t === "MultiPolygon");
  const hasLine    = geomTypes.some((t) => t === "LineString" || t === "MultiLineString");
  const hasPoint   = geomTypes.some((t) => t === "Point" || t === "MultiPoint");
  const count = Number(hasPolygon) + Number(hasLine) + Number(hasPoint);
  if (count > 1)   return "mixed";
  if (hasPolygon)  return "polygon";
  if (hasLine)     return "line";
  if (hasPoint)    return "point";
  return "mixed";
}

function getTargetTable(type: string): string | null {
  if (type === "Point"      || type === "MultiPoint")      return "points";
  if (type === "LineString" || type === "MultiLineString") return "lines";
  if (type === "Polygon"    || type === "MultiPolygon")    return "polygons";
  return null;
}

function badRequest(code: string, error: string, extra: Record<string, unknown> = {}) {
  return { ok: false, code, error, ...extra };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("stripUtf8Bom", () => {
  it("strips BOM from BOM-prefixed string", () => {
    const withBom = "\uFEFFhello";
    expect(stripUtf8Bom(withBom)).toBe("hello");
  });
  it("leaves normal string untouched", () => {
    expect(stripUtf8Bom("hello")).toBe("hello");
  });
  it("leaves empty string untouched", () => {
    expect(stripUtf8Bom("")).toBe("");
  });
  it("strips BOM from a real CSV-like string", () => {
    const csv = "\uFEFFname,lat,lng\nMumbai,19.07,72.87";
    expect(stripUtf8Bom(csv).startsWith("name")).toBe(true);
  });
});

describe("pickCsvSuggestions", () => {
  it("detects canonical lat/lng column names", () => {
    const r = pickCsvSuggestions(["name", "lat", "lng"]);
    expect(r.latColumn).toBe("lat");
    expect(r.lngColumn).toBe("lng");
  });
  it("detects latitude/longitude variants", () => {
    const r = pickCsvSuggestions(["latitude", "longitude", "city"]);
    expect(r.latColumn).toBe("latitude");
    expect(r.lngColumn).toBe("longitude");
  });
  it("detects x/y as lng/lat", () => {
    const r = pickCsvSuggestions(["x", "y", "pop"]);
    expect(r.latColumn).toBe("y");
    expect(r.lngColumn).toBe("x");
  });
  it("detects lon and long as longitude", () => {
    expect(pickCsvSuggestions(["lat", "lon"]).lngColumn).toBe("lon");
    expect(pickCsvSuggestions(["lat", "long"]).lngColumn).toBe("long");
  });
  it("detects WKT geometry column", () => {
    const r = pickCsvSuggestions(["name", "wkt"]);
    expect(r.wktColumn).toBe("wkt");
  });
  it("detects geom/geometry/shape aliases for WKT", () => {
    expect(pickCsvSuggestions(["geometry", "name"]).wktColumn).toBe("geometry");
    expect(pickCsvSuggestions(["the_geom", "name"]).wktColumn).toBe("the_geom");
    expect(pickCsvSuggestions(["shape", "name"]).wktColumn).toBe("shape");
  });
  it("returns null for all fields when no matches", () => {
    const r = pickCsvSuggestions(["city", "population", "area"]);
    expect(r.latColumn).toBeNull();
    expect(r.lngColumn).toBeNull();
    expect(r.wktColumn).toBeNull();
  });
  it("is case-insensitive", () => {
    const r = pickCsvSuggestions(["LAT", "LNG"]);
    expect(r.latColumn).toBe("LAT");
    expect(r.lngColumn).toBe("LNG");
  });
  it("always returns h3Column as null (set later by pickH3Column)", () => {
    expect(pickCsvSuggestions(["h3", "lat"]).h3Column).toBeNull();
  });
});

describe("isH3Index", () => {
  // Valid H3 index at resolution 7 (15 hex chars starting with 8)
  const validH3 = "87283472bffffff";
  it("accepts a valid H3 index", () => {
    expect(isH3Index(validH3)).toBe(true);
  });
  it("accepts uppercase H3 index", () => {
    expect(isH3Index(validH3.toUpperCase())).toBe(true);
  });
  it("rejects a string that doesn't start with 8", () => {
    expect(isH3Index("97283472bffffff")).toBe(false);
  });
  it("rejects a string that is too short", () => {
    expect(isH3Index("87283472bffff")).toBe(false);
  });
  it("rejects a string that is too long", () => {
    expect(isH3Index("87283472bffffffff")).toBe(false);
  });
  it("rejects non-hex characters", () => {
    expect(isH3Index("87283472bffffzz")).toBe(false);
  });
  it("rejects empty string", () => {
    expect(isH3Index("")).toBe(false);
  });
  it("handles leading/trailing whitespace", () => {
    expect(isH3Index(`  ${validH3}  `)).toBe(true);
  });
});

describe("pickH3Column", () => {
  const validH3s = ["87283472bffffff", "872834729ffffff", "87283472dffffff",
                    "87283472effffff", "87283472fffffff", "872834720ffffff",
                    "872834721ffffff", "872834722ffffff", "872834723ffffff", "872834724ffffff"];

  it("detects column with 3+ valid H3 values in sample", () => {
    const rows = validH3s.map((v) => ({ cell: v, name: "x" }));
    expect(pickH3Column(["cell", "name"], rows)).toBe("cell");
  });
  it("returns null when no column has enough H3 matches", () => {
    const rows = [{ cell: "notanh3", name: "x" }];
    expect(pickH3Column(["cell", "name"], rows)).toBeNull();
  });
  it("detects by hint name with at least 1 matching value", () => {
    const rows = [{ h3: validH3s[0], name: "x" }];
    expect(pickH3Column(["h3", "name"], rows)).toBe("h3");
  });
  it("recognises all hint aliases", () => {
    const hints = ["h3index", "h3_index", "hex", "cell", "hexid", "grid_id"];
    for (const hint of hints) {
      const rows = [{ [hint]: validH3s[0], other: "x" }];
      expect(pickH3Column([hint, "other"], rows)).toBe(hint);
    }
  });
  it("returns null for empty fields list", () => {
    expect(pickH3Column([], [])).toBeNull();
  });
});

describe("normalizeGeoJSONTopLevel", () => {
  it("handles FeatureCollection", () => {
    const fc = { type: "FeatureCollection", features: [{ type: "Feature", geometry: null, properties: {} }] };
    const r = normalizeGeoJSONTopLevel(fc);
    expect(r.noteType).toBe("FeatureCollection");
    expect(r.features.length).toBe(1);
  });
  it("handles single Feature", () => {
    const f = { type: "Feature", geometry: { type: "Point", coordinates: [0, 0] }, properties: {} };
    const r = normalizeGeoJSONTopLevel(f);
    expect(r.noteType).toBe("Feature");
    expect(r.features).toEqual([f]);
  });
  it("wraps bare Point geometry in a Feature", () => {
    const g = { type: "Point", coordinates: [72.87, 19.07] };
    const r = normalizeGeoJSONTopLevel(g);
    expect(r.noteType).toBe("Geometry:Point");
    expect(r.features[0].type).toBe("Feature");
    expect(r.features[0].geometry).toEqual(g);
  });
  it("wraps bare Polygon geometry in a Feature", () => {
    const g = { type: "Polygon", coordinates: [[[0,0],[1,0],[1,1],[0,1],[0,0]]] };
    const r = normalizeGeoJSONTopLevel(g);
    expect(r.noteType).toBe("Geometry:Polygon");
    expect(r.features[0].geometry).toEqual(g);
  });
  it("handles array of Features", () => {
    const arr = [
      { type: "Feature", geometry: null, properties: {} },
      { type: "Feature", geometry: null, properties: {} },
    ];
    const r = normalizeGeoJSONTopLevel(arr);
    expect(r.features.length).toBe(2);
    expect(r.noteType).toBe("array");
  });
  it("returns empty features for non-Feature array", () => {
    const r = normalizeGeoJSONTopLevel([{ type: "Point" }, { type: "Point" }]);
    expect(r.features).toEqual([]);
  });
  it("returns empty features for null input", () => {
    expect(normalizeGeoJSONTopLevel(null).features).toEqual([]);
  });
  it("returns empty features for unknown type", () => {
    const r = normalizeGeoJSONTopLevel({ type: "WeirdType" });
    expect(r.features).toEqual([]);
    expect(r.noteType).toContain("unknown");
  });
  it("handles FeatureCollection with missing features array", () => {
    const r = normalizeGeoJSONTopLevel({ type: "FeatureCollection" });
    expect(r.features).toEqual([]);
  });
  it("falls back to .features array even without type field", () => {
    const r = normalizeGeoJSONTopLevel({ features: [{ type: "Feature" }] });
    expect(r.features.length).toBe(1);
  });
});

describe("inferSuggestedLayerTypeFromGeomTypes", () => {
  it("returns fill for Polygon", () => expect(inferSuggestedLayerTypeFromGeomTypes(["Polygon"])).toBe("fill"));
  it("returns fill for MultiPolygon", () => expect(inferSuggestedLayerTypeFromGeomTypes(["MultiPolygon"])).toBe("fill"));
  it("returns line for LineString", () => expect(inferSuggestedLayerTypeFromGeomTypes(["LineString"])).toBe("line"));
  it("returns line for MultiLineString", () => expect(inferSuggestedLayerTypeFromGeomTypes(["MultiLineString"])).toBe("line"));
  it("returns circle for Point", () => expect(inferSuggestedLayerTypeFromGeomTypes(["Point"])).toBe("circle"));
  it("returns circle for MultiPoint", () => expect(inferSuggestedLayerTypeFromGeomTypes(["MultiPoint"])).toBe("circle"));
  it("polygon wins over line in mixed dataset", () => expect(inferSuggestedLayerTypeFromGeomTypes(["LineString","Polygon"])).toBe("fill"));
  it("polygon wins over point in mixed dataset", () => expect(inferSuggestedLayerTypeFromGeomTypes(["Point","MultiPolygon"])).toBe("fill"));
  it("line wins over point in mixed dataset", () => expect(inferSuggestedLayerTypeFromGeomTypes(["Point","LineString"])).toBe("line"));
});

describe("inferDatasetRenderType", () => {
  it("returns polygon for Polygon", () => expect(inferDatasetRenderType(["Polygon"])).toBe("polygon"));
  it("returns polygon for MultiPolygon", () => expect(inferDatasetRenderType(["MultiPolygon"])).toBe("polygon"));
  it("returns line for LineString", () => expect(inferDatasetRenderType(["LineString"])).toBe("line"));
  it("returns line for MultiLineString", () => expect(inferDatasetRenderType(["MultiLineString"])).toBe("line"));
  it("returns point for Point", () => expect(inferDatasetRenderType(["Point"])).toBe("point"));
  it("returns point for MultiPoint", () => expect(inferDatasetRenderType(["MultiPoint"])).toBe("point"));
  it("returns mixed for Point + Polygon", () => expect(inferDatasetRenderType(["Point","Polygon"])).toBe("mixed"));
  it("returns mixed for all three types", () => expect(inferDatasetRenderType(["Point","LineString","Polygon"])).toBe("mixed"));
  it("returns mixed for empty array (no known types)", () => expect(inferDatasetRenderType([])).toBe("mixed"));
});

describe("getTargetTable", () => {
  it("routes Point to points", () => expect(getTargetTable("Point")).toBe("points"));
  it("routes MultiPoint to points", () => expect(getTargetTable("MultiPoint")).toBe("points"));
  it("routes LineString to lines", () => expect(getTargetTable("LineString")).toBe("lines"));
  it("routes MultiLineString to lines", () => expect(getTargetTable("MultiLineString")).toBe("lines"));
  it("routes Polygon to polygons", () => expect(getTargetTable("Polygon")).toBe("polygons"));
  it("routes MultiPolygon to polygons", () => expect(getTargetTable("MultiPolygon")).toBe("polygons"));
  it("returns null for unknown geometry type", () => expect(getTargetTable("GeometryCollection")).toBeNull());
  it("returns null for empty string", () => expect(getTargetTable("")).toBeNull());
});

describe("badRequest", () => {
  it("returns ok: false with code and error", () => {
    const r = badRequest("FILE_TOO_LARGE", "File exceeds limit");
    expect(r.ok).toBe(false);
    expect(r.code).toBe("FILE_TOO_LARGE");
    expect(r.error).toBe("File exceeds limit");
  });
  it("merges extra fields into the response", () => {
    const r = badRequest("INVALID_GEOJSON", "Bad file", { detected: "Feature", topLevelType: null });
    expect(r.detected).toBe("Feature");
    expect(r.topLevelType).toBeNull();
  });
  it("works with no extra fields (default empty object)", () => {
    const r = badRequest("NOT_FOUND", "Missing");
    expect(Object.keys(r)).toEqual(["ok", "code", "error"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ADDITIONAL SUITES — frontend pure helpers
// ─────────────────────────────────────────────────────────────────────────────

// ── Re-implementations ────────────────────────────────────────────────────────

function hexToRgba(hex: string, opacity: number): string {
  if (hex.startsWith("rgb")) {
    const m = hex.match(/[\d.]+/g);
    if (m) return `rgba(${m[0]},${m[1]},${m[2]},${opacity})`;
  }
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  if (isNaN(r) || isNaN(g) || isNaN(b)) return `rgba(255,255,255,${opacity})`;
  return `rgba(${r},${g},${b},${opacity})`;
}

function rgbToHex([r, g, b]: [number, number, number]): string {
  const h = (n: number) => n.toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return [r, g, b];
}

function prettyError(err: unknown): string {
  const e = err as { error?: string } | undefined;
  return e?.error ?? "Something went wrong.";
}

function fallbackLayerType(renderType?: string): string {
  if (renderType === "point")   return "circle";
  if (renderType === "line")    return "line";
  return "fill";
}

function boundsToZoom(bounds: [number, number, number, number]): { longitude: number; latitude: number; zoom: number } {
  const [minLng, minLat, maxLng, maxLat] = bounds;
  const longitude = (minLng + maxLng) / 2;
  const latitude  = (minLat + maxLat) / 2;
  const maxDiff   = Math.max(Math.abs(maxLng - minLng), Math.abs(maxLat - minLat), 0.0001);
  const zoom =
    maxDiff > 60    ? 2  :
    maxDiff > 30    ? 3  :
    maxDiff > 15    ? 4  :
    maxDiff > 8     ? 5  :
    maxDiff > 4     ? 6  :
    maxDiff > 2     ? 7  :
    maxDiff > 1     ? 8  :
    maxDiff > 0.5   ? 9  :
    maxDiff > 0.25  ? 10 :
    maxDiff > 0.12  ? 11 :
    maxDiff > 0.06  ? 12 :
    maxDiff > 0.03  ? 13 :
    maxDiff > 0.015 ? 14 : 15;
  return { longitude, latitude, zoom };
}

type FilterRule2 = { col: string; op: string; val: string; vals?: string[] };
function buildMapFilter(datasetId: string, rules: FilterRule2[]): any {
  const dsFilter: any = ["==", ["get", "dataset_id"], datasetId];
  if (!rules || rules.length === 0) return dsFilter;
  const conditions: any[] = ["all", dsFilter];
  for (const rule of rules) {
    if (!rule.val && rule.op !== "is empty") continue;
    const getter = ["get", rule.col];
    if (rule.op === "=")             conditions.push(["==", getter, rule.val]);
    else if (rule.op === "≠")        conditions.push(["!=", getter, rule.val]);
    else if (rule.op === ">")        conditions.push([">",  getter, Number(rule.val)]);
    else if (rule.op === "<")        conditions.push(["<",  getter, Number(rule.val)]);
    else if (rule.op === "≥")        conditions.push([">=", getter, Number(rule.val)]);
    else if (rule.op === "≤")        conditions.push(["<=", getter, Number(rule.val)]);
    else if (rule.op === "contains") conditions.push(["in", rule.val, getter]);
    else if (rule.op === "is empty") conditions.push(["!", ["has", rule.col]]);
  }
  return conditions.length === 2 ? dsFilter : conditions;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("hexToRgba", () => {
  it("converts hex color to rgba with opacity", () => {
    expect(hexToRgba("#ff0000", 1)).toBe("rgba(255,0,0,1)");
  });
  it("handles partial opacity", () => {
    expect(hexToRgba("#0080ff", 0.5)).toBe("rgba(0,128,255,0.5)");
  });
  it("handles shorthand-less 6-digit hex without #", () => {
    expect(hexToRgba("00ff00", 1)).toBe("rgba(0,255,0,1)");
  });
  it("falls back to white for invalid hex", () => {
    expect(hexToRgba("#zzzzzz", 0.8)).toBe("rgba(255,255,255,0.8)");
  });
  it("passes through rgb() strings directly", () => {
    expect(hexToRgba("rgb(10,20,30)", 0.5)).toBe("rgba(10,20,30,0.5)");
  });
  it("passes through rgba() strings directly", () => {
    expect(hexToRgba("rgba(10,20,30,1)", 0.5)).toBe("rgba(10,20,30,0.5)");
  });
  it("handles opacity 0 (fully transparent)", () => {
    expect(hexToRgba("#ffffff", 0)).toBe("rgba(255,255,255,0)");
  });
  it("handles black #000000", () => {
    expect(hexToRgba("#000000", 1)).toBe("rgba(0,0,0,1)");
  });
});

describe("rgbToHex / hexToRgb round-trip", () => {
  it("converts rgb tuple to hex string", () => {
    expect(rgbToHex([255, 128, 0])).toBe("#ff8000");
  });
  it("pads single-digit hex values", () => {
    expect(rgbToHex([0, 0, 0])).toBe("#000000");
    expect(rgbToHex([1, 2, 3])).toBe("#010203");
  });
  it("converts hex back to rgb tuple", () => {
    expect(hexToRgb("#ff8000")).toEqual([255, 128, 0]);
  });
  it("round-trips rgb → hex → rgb", () => {
    const original: [number, number, number] = [100, 150, 200];
    expect(hexToRgb(rgbToHex(original))).toEqual(original);
  });
  it("round-trips hex → rgb → hex", () => {
    const hex = "#1a2b3c";
    expect(rgbToHex(hexToRgb(hex))).toBe(hex);
  });
  it("handles white", () => {
    expect(rgbToHex([255, 255, 255])).toBe("#ffffff");
    expect(hexToRgb("#ffffff")).toEqual([255, 255, 255]);
  });
});

describe("prettyError", () => {
  it("extracts .error from an ApiError object", () => {
    expect(prettyError({ ok: false, error: "File too large" })).toBe("File too large");
  });
  it("returns fallback for undefined", () => {
    expect(prettyError(undefined)).toBe("Something went wrong.");
  });
  it("returns fallback for null", () => {
    expect(prettyError(null)).toBe("Something went wrong.");
  });
  it("returns fallback for plain string (no .error property)", () => {
    expect(prettyError("raw error")).toBe("Something went wrong.");
  });
  it("returns fallback for empty object", () => {
    expect(prettyError({})).toBe("Something went wrong.");
  });
});

describe("fallbackLayerType", () => {
  it("returns circle for point", () => expect(fallbackLayerType("point")).toBe("circle"));
  it("returns line for line", () => expect(fallbackLayerType("line")).toBe("line"));
  it("returns fill for polygon", () => expect(fallbackLayerType("polygon")).toBe("fill"));
  it("returns fill for mixed", () => expect(fallbackLayerType("mixed")).toBe("fill"));
  it("returns fill for undefined", () => expect(fallbackLayerType(undefined)).toBe("fill"));
  it("returns fill for unknown value", () => expect(fallbackLayerType("raster")).toBe("fill"));
});

describe("boundsToZoom", () => {
  it("centers longitude correctly", () => {
    const { longitude } = boundsToZoom([10, 0, 20, 10]);
    expect(longitude).toBe(15);
  });
  it("centers latitude correctly", () => {
    const { latitude } = boundsToZoom([0, 10, 10, 30]);
    expect(latitude).toBe(20);
  });
  it("returns low zoom for world-spanning bounds", () => {
    const { zoom } = boundsToZoom([-180, -90, 180, 90]);
    expect(zoom).toBeLessThanOrEqual(3);
  });
  it("returns high zoom for tiny bounds (city block)", () => {
    const { zoom } = boundsToZoom([72.87, 19.07, 72.872, 19.072]);
    expect(zoom).toBeGreaterThanOrEqual(13);
  });
  it("returns zoom 15 for point-like bounds (maxDiff ≤ 0.015)", () => {
    const { zoom } = boundsToZoom([0, 0, 0.001, 0.001]);
    expect(zoom).toBe(15);
  });
  it("handles India-scale bounds (diff ~30 degrees)", () => {
    const { zoom } = boundsToZoom([68, 8, 97, 37]);
    expect(zoom).toBeGreaterThanOrEqual(3);
    expect(zoom).toBeLessThanOrEqual(5);
  });
  it("zoom is always an integer", () => {
    const cases: [number,number,number,number][] = [
      [0,0,0.001,0.001], [0,0,0.1,0.1], [0,0,1,1],
      [0,0,10,10], [0,0,50,50], [-180,-90,180,90],
    ];
    for (const b of cases) {
      expect(Number.isInteger(boundsToZoom(b).zoom)).toBe(true);
    }
  });
});

describe("buildMapFilter", () => {
  const dsId = "dataset-abc";

  it("returns simple dataset_id equality filter when no rules", () => {
    const f = buildMapFilter(dsId, []);
    expect(f).toEqual(["==", ["get", "dataset_id"], dsId]);
  });

  it("returns simple dataset_id filter when rules have empty val (non-is-empty op)", () => {
    // rule with empty val and non 'is empty' op should be skipped
    const f = buildMapFilter(dsId, [{ col: "name", op: "=", val: "" }]);
    expect(f).toEqual(["==", ["get", "dataset_id"], dsId]);
  });

  it("builds 'all' filter with = rule", () => {
    const f = buildMapFilter(dsId, [{ col: "name", op: "=", val: "Mumbai" }]);
    expect(f[0]).toBe("all");
    expect(f).toContainEqual(["==", ["get", "name"], "Mumbai"]);
  });

  it("builds ≠ rule as !=", () => {
    const f = buildMapFilter(dsId, [{ col: "name", op: "≠", val: "Delhi" }]);
    expect(f).toContainEqual(["!=", ["get", "name"], "Delhi"]);
  });

  it("builds > rule with numeric coercion", () => {
    const f = buildMapFilter(dsId, [{ col: "pop", op: ">", val: "1000000" }]);
    expect(f).toContainEqual([">", ["get", "pop"], 1000000]);
  });

  it("builds < rule", () => {
    const f = buildMapFilter(dsId, [{ col: "area", op: "<", val: "500" }]);
    expect(f).toContainEqual(["<", ["get", "area"], 500]);
  });

  it("builds ≥ rule as >=", () => {
    const f = buildMapFilter(dsId, [{ col: "area", op: "≥", val: "100" }]);
    expect(f).toContainEqual([">=", ["get", "area"], 100]);
  });

  it("builds ≤ rule as <=", () => {
    const f = buildMapFilter(dsId, [{ col: "area", op: "≤", val: "100" }]);
    expect(f).toContainEqual(["<=", ["get", "area"], 100]);
  });

  it("builds contains rule using 'in'", () => {
    const f = buildMapFilter(dsId, [{ col: "name", op: "contains", val: "bay" }]);
    expect(f).toContainEqual(["in", "bay", ["get", "name"]]);
  });

  it("builds is empty rule even when val is empty string", () => {
    const f = buildMapFilter(dsId, [{ col: "name", op: "is empty", val: "" }]);
    expect(f).toContainEqual(["!", ["has", "name"]]);
  });

  it("includes dataset_id filter in all-rules expression", () => {
    const f = buildMapFilter(dsId, [{ col: "name", op: "=", val: "X" }]);
    expect(f[1]).toEqual(["==", ["get", "dataset_id"], dsId]);
  });

  it("stacks multiple rules correctly", () => {
    const f = buildMapFilter(dsId, [
      { col: "name", op: "=", val: "Mumbai" },
      { col: "pop",  op: ">", val: "1000000" },
    ]);
    expect(f[0]).toBe("all");
    expect(f.length).toBe(4); // "all" + dsFilter + 2 rules
  });
});
