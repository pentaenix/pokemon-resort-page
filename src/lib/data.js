export const DATA_FILES = {
  site: 'data/site.json',
  homepage: 'data/homepage.json',
  theme: 'data/theme.json',
  research: 'data/research.json',
  atlasPins: 'data/atlas-pins.json',
  compatibility: 'data/compatibility.json',
  features: 'data/features.json',
  bugs: 'data/bugs.json',
  gallery: 'data/gallery.json',
  models: 'data/models.json',
  characters: 'data/characters.json',
  roadmap: 'data/roadmap.json',
  ideas: 'data/ideas.json',
  docs: 'data/docs.json',
};

export async function loadSiteData() {
  const base = import.meta.env.BASE_URL || './';
  const cacheBust = import.meta.env.DEV ? `?v=${Date.now()}` : '';
  const entries = await Promise.all(
    Object.entries(DATA_FILES).map(async ([key, file]) => {
      const response = await fetch(`${base}${file}${cacheBust}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`Unable to load ${file}`);
      return [key, await response.json()];
    })
  );
  return Object.fromEntries(entries);
}

export function assetUrl(path = '') {
  const base = import.meta.env.BASE_URL || './';
  if (!path) return '';
  if (/^https?:\/\//.test(path)) return path;
  return `${base}${path}`.replace(/([^:]\/)\/+/g, '$1');
}

export function getHashRoute() {
  const raw = window.location.hash || '#/';
  const [pathPart, queryPart = ''] = raw.replace(/^#/, '').split('?');
  return {
    path: pathPart || '/',
    query: Object.fromEntries(new URLSearchParams(queryPart)),
  };
}

export function routeHref(path, query = {}) {
  const qs = new URLSearchParams(query).toString();
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `#${normalized}${qs ? `?${qs}` : ''}`;
}

/** Scroll to an in-page section (works with hash-router query `?section=id`). */
export function scrollToSection(sectionId) {
  const el = document.getElementById(sectionId);
  if (!el) return false;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return true;
}

export function boardSectionHref(sectionId) {
  return routeHref('/board', { section: sectionId });
}

export function atlasSectionHref(sectionId) {
  return routeHref('/atlas', { section: sectionId });
}

export const statusClass = (status) => String(status || '').toLowerCase().replace(/\s+/g, '-');
