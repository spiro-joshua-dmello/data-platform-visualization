import type { Bounds, RenderType, LayerType } from "./types";

const UPLOAD_BASE = "http://localhost:8787";
const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB per chunk
const CHUNKED_THRESHOLD = 50 * 1024 * 1024; // use chunked for files > 50MB

export type InspectResponse =
  | {
      ok: true;
      fileType: "csv";
      columns: string[];
      sampleRows: Record<string, unknown>[];
      suggestions: {
        latColumn: string | null;
        lngColumn: string | null;
      };
      suggestedLayerType?: "circle";
    }
  | {
      ok: true;
      fileType: "geojson";
      detected: string;
      featureCount: number;
      topLevelType: string | null;
      geometryTypes?: string[];
      suggestedLayerType?: LayerType;
      renderType?: RenderType;
    };

export type UploadResponse = {
  ok: true;
  datasetId: string;
  inserted: number;
  skipped?: number;
  bounds?: Bounds | null;
  geometryTypes?: string[];
  suggestedLayerType?: LayerType;
  renderType?: RenderType;
  processingMs?: number;
  detected?: string;
  tiles: {
    points?: string;
    lines?: string;
    polygons?: string;
  };
};

export type ApiError = {
  ok: false;
  code?: string;
  error: string;
  [key: string]: unknown;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

async function readJsonSafe(res: Response) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return {
      ok: false,
      code: "BAD_JSON_RESPONSE",
      error: text || `Server returned HTTP ${res.status}`,
    } satisfies ApiError;
  }
}

// ── Inspect ───────────────────────────────────────────────────────────────────

export async function inspectDataset(file: File): Promise<InspectResponse> {
  const form = new FormData();
  form.append("file", file);

  let res: Response;

  try {
    res = await fetch(`${UPLOAD_BASE}/datasets/inspect`, {
      method: "POST",
      body: form,
    });
  } catch (err: any) {
    throw {
      ok: false,
      code: "NETWORK_ERROR",
      error:
        "Could not reach upload service at http://localhost:8787. Check that the backend is running.",
      details: String(err),
    } satisfies ApiError;
  }

  const data = await readJsonSafe(res);
  if (!res.ok) throw data;
  return data as InspectResponse;
}

// ── Standard upload (small files ≤50MB) ──────────────────────────────────────

export function uploadDatasetWithProgress(opts: {
  file: File;
  latColumn?: string;
  lngColumn?: string;
  onProgress?: (pct: number) => void;
}): Promise<UploadResponse> {
  const { file, latColumn, lngColumn, onProgress } = opts;

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${UPLOAD_BASE}/datasets/upload`);

    xhr.upload.onprogress = (evt) => {
      if (evt.lengthComputable && onProgress) {
        const pct = Math.round((evt.loaded / evt.total) * 100);
        onProgress(pct);
      }
    };

    xhr.onload = () => {
      try {
        const json = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(json as UploadResponse);
        } else {
          reject(json);
        }
      } catch {
        reject({
          ok: false,
          code: "BAD_RESPONSE",
          error: xhr.responseText || `Server returned HTTP ${xhr.status}`,
        } satisfies ApiError);
      }
    };

    xhr.onerror = () => {
      reject({
        ok: false,
        code: "NETWORK_ERROR",
        error: "Upload service unreachable.",
      } satisfies ApiError);
    };

    const form = new FormData();
    form.append("file", file);
    if (latColumn) form.append("latColumn", latColumn);
    if (lngColumn) form.append("lngColumn", lngColumn);

    xhr.send(form);
  });
}

// ── Chunked upload internals ──────────────────────────────────────────────────

async function initChunkedUpload(opts: {
  fileName: string;
  fileSize: number;
  totalChunks: number;
  latColumn?: string;
  lngColumn?: string;
}): Promise<{ ok: true; uploadId: string }> {
  const res = await fetch(`${UPLOAD_BASE}/datasets/upload/init`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts),
  });
  const data = await readJsonSafe(res);
  if (!res.ok) throw data;
  return data;
}

function uploadChunk(opts: {
  uploadId: string;
  chunkIndex: number;
  totalChunks: number;
  chunk: Blob;
  onProgress?: (pct: number) => void;
}): Promise<{ ok: true }> {
  const { uploadId, chunkIndex, totalChunks, chunk, onProgress } = opts;

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${UPLOAD_BASE}/datasets/upload/chunk`);

    xhr.upload.onprogress = (evt) => {
      if (evt.lengthComputable && onProgress) {
        onProgress(Math.round((evt.loaded / evt.total) * 100));
      }
    };

    xhr.onload = () => {
      try {
        const json = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) resolve(json);
        else reject(json);
      } catch {
        reject({
          ok: false,
          code: "BAD_RESPONSE",
          error: xhr.responseText || `Server returned HTTP ${xhr.status}`,
        } satisfies ApiError);
      }
    };

    xhr.onerror = () =>
      reject({
        ok: false,
        code: "NETWORK_ERROR",
        error: "Upload service unreachable.",
      } satisfies ApiError);

    const form = new FormData();
    form.append("uploadId", uploadId);
    form.append("chunkIndex", String(chunkIndex));
    form.append("totalChunks", String(totalChunks));
    form.append("chunk", chunk);
    xhr.send(form);
  });
}

async function finalizeChunkedUpload(opts: {
  uploadId: string;
}): Promise<UploadResponse> {
  const res = await fetch(`${UPLOAD_BASE}/datasets/upload/finalize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts),
  });
  const data = await readJsonSafe(res);
  if (!res.ok) throw data;
  return data;
}

// ── Chunked upload (large files >50MB) ───────────────────────────────────────

export async function uploadDatasetChunked(opts: {
  file: File;
  latColumn?: string;
  lngColumn?: string;
  onProgress?: (pct: number) => void;
}): Promise<UploadResponse> {
  const { file, latColumn, lngColumn, onProgress } = opts;
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

  // Step 1: init session (0%)
  const { uploadId } = await initChunkedUpload({
    fileName: file.name,
    fileSize: file.size,
    totalChunks,
    latColumn,
    lngColumn,
  });

  // Step 2: upload chunks (0% → 80%)
  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK_SIZE;
    const chunk = file.slice(start, start + CHUNK_SIZE);

    await uploadChunk({
      uploadId,
      chunkIndex: i,
      totalChunks,
      chunk,
      onProgress: (pct) => {
        const overall = Math.round(((i + pct / 100) / totalChunks) * 80);
        onProgress?.(overall);
      },
    });
  }

  onProgress?.(80);

  // Step 3: finalize + process (80% → 100%)
  const result = await finalizeChunkedUpload({ uploadId });
  onProgress?.(100);
  return result;
}

// ── Smart upload: picks strategy based on file size ───────────────────────────

export async function uploadDataset(opts: {
  file: File;
  latColumn?: string;
  lngColumn?: string;
  onProgress?: (pct: number) => void;
}): Promise<UploadResponse> {
  if (opts.file.size > CHUNKED_THRESHOLD) {
    return uploadDatasetChunked(opts);
  }
  return uploadDatasetWithProgress(opts);
}
