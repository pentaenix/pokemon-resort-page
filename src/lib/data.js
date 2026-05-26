const BASE = import.meta.env.BASE_URL || '/';

export function assetUrl(path = '') {
  if (!path) return '';
  if (/^https?:\/\//.test(path)) return path;
  return `${BASE}${path}`.replace(/\/\/{2,}/g, '/');
}

async function loadJSON(name) {
  const response = await fetch(`${BASE}data/${name}.json`);
  if (!response.ok) {
    throw new Error(`Could not load data/${name}.json (${response.status})`);
  }
  return response.json();
}

export async function loadResortData() {
  const [site, homepage, theme, atlas, compatibility, features, bugs] = await Promise.all([
    loadJSON('site'),
    loadJSON('homepage'),
    loadJSON('theme'),
    loadJSON('research-pois'),
    loadJSON('compatibility'),
    loadJSON('features'),
    loadJSON('bugs')
  ]);

  return { site, homepage, theme, atlas, compatibility, features, bugs };
}

export const statusText = {
  broken: 'Not working',
  edge: 'Edge cases failing',
  testing: 'Needs more tests',
  working: 'Fully working',
  open: 'Open',
  'on-flight': 'On-flight',
  blocked: 'Blocked',
  fixed: 'Fixed',
  archived: 'Archived',
  boarding: 'Boarding Soon',
  landed: 'Landed'
};
