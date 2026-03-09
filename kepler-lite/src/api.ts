const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8787";

export async function uploadDataset(file: File) {
  const form = new FormData();
  form.append("file", file);

  const res = await fetch(`${API_BASE}/datasets/upload`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function listDatasets() {
  const res = await fetch(`${API_BASE}/datasets`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getDataset(id: string) {
  const res = await fetch(`${API_BASE}/datasets/${id}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
