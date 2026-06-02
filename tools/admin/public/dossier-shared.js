/** Shared dossier helpers for admin (keep in sync with src/lib/featureDossier.js). */

export function isValidHref(href) {
  const raw = String(href || '').trim();
  if (!raw) return false;
  if (/^mailto:/i.test(raw)) return /^mailto:[^@\s]+@[^@\s]+\.[^@\s]+/i.test(raw);
  if (raw.startsWith('#')) return raw.length > 1;
  try {
    const url = new URL(raw.includes('://') ? raw : `https://${raw}`);
    return url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'mailto:';
  } catch {
    return false;
  }
}

export function normalizeHrefForSave(href) {
  const raw = String(href || '').trim();
  if (!raw) return '';
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith('#')) return raw;
  return `https://${raw}`;
}

/** Strict “has public dossier content” (matches src/lib/featureDossier.js). */
export function featureHasDossierContent(feature, normalizeFeatureDossierRaw) {
  const dossier = normalizeFeatureDossierRaw(feature, { forEditor: false });
  const map = dossier.map || {};
  const position = Array.isArray(map.position) ? map.position : [];
  const hasMap = Boolean(
    map.pinId || map.poiId || map.label || map.note
    || position.filter((n) => Number.isFinite(Number(n))).length >= 2,
  );
  const hasSections = dossier.sections.some((section) => section.summary || section.blocks.length);
  return Boolean(
    dossier.overview.trim()
    || hasMap
    || dossier.researchMilestones.length
    || hasSections,
  );
}
