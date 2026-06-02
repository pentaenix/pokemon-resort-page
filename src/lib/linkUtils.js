/** Whether a href is safe to render as a public link. */
export function isValidPublicHref(href) {
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

export function normalizePublicHref(href) {
  const raw = String(href || '').trim();
  if (!raw) return '';
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith('#')) return raw;
  return `https://${raw}`;
}
