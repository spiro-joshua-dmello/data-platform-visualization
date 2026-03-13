import type { Bounds, RenderType, LayerType } from "./types";

const UPLOAD_BASE = "http://localhost:8787";

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