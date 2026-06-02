/** Sanitize a model folder id (must match server ingest + on-disk folder names). */
export function sanitizeModelId(raw) {
  const id = String(raw || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  return id;
}

export function isValidModelId(id) {
  return Boolean(id) && id.length <= 64 && /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(id);
}
