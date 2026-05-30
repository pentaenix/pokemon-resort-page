const DEFAULT_BASE = 'https://thumbnails.libretro.com';

export const LIBRETRO_BASE = (process.env.LIBRETRO_THUMBNAILS_BASE || DEFAULT_BASE).replace(/\/$/, '');

export const PLATFORM_FOLDERS = {
  'Game Boy': 'Nintendo - Game Boy',
  'Game Boy Color': 'Nintendo - Game Boy Color',
  'Game Boy Advance': 'Nintendo - Game Boy Advance',
  'Nintendo DS': 'Nintendo - Nintendo DS',
  'Nintendo 3DS': 'Nintendo - Nintendo 3DS',
  'Nintendo Switch': null,
};

/** Per-game matchers for Libretro "No-Intro" style ROM names in Named_Boxarts. */
export const GAME_MATCHERS = {
  red: { includes: ['Red Version'], excludes: ['Blue', 'Yellow', 'Green', 'Kiosk', 'Hack', 'Demo', 'Distribution', 'Brown'] },
  blue: { includes: ['Blue Version'], excludes: ['Red', 'Yellow', 'Green', 'Kiosk', 'Hack', 'Demo', 'Distribution', 'Brown'] },
  yellow: { includes: ['Yellow Version', 'Pikachu Edition'], excludes: ['Red Version', 'Blue Version', 'Kiosk', 'Hack', 'Demo', 'Distribution'] },
  gold: { includes: ['Gold Version'], excludes: ['HeartGold', 'SoulSilver', 'Kiosk', 'Hack', 'Demo', 'Distribution'] },
  silver: { includes: ['Silver Version'], excludes: ['HeartGold', 'SoulSilver', 'Kiosk', 'Hack', 'Demo', 'Distribution'] },
  crystal: { includes: ['Crystal Version'], excludes: ['Kiosk', 'Hack', 'Demo', 'Distribution'] },
  ruby: { includes: ['Ruby Version'], excludes: ['Omega', 'Kiosk', 'Hack', 'Demo', 'Distribution', 'Box)'] },
  sapphire: { includes: ['Sapphire Version'], excludes: ['Alpha', 'Kiosk', 'Hack', 'Demo', 'Distribution', 'Box)'] },
  emerald: { includes: ['Emerald Version'], excludes: ['Kiosk', 'Hack', 'Demo', 'Distribution'] },
  'fire-red': { includes: ['FireRed Version'], excludes: ['LeafGreen', 'Kiosk', 'Hack', 'Demo', 'Distribution'] },
  'leaf-green': { includes: ['LeafGreen Version'], excludes: ['FireRed', 'Kiosk', 'Hack', 'Demo', 'Distribution'] },
  diamond: { includes: ['Diamond Version'], excludes: ['Pearl', 'Platinum', 'Kiosk', 'Hack', 'Demo', 'Distribution', '+'] },
  pearl: { includes: ['Pearl Version'], excludes: ['Diamond', 'Platinum', 'Kiosk', 'Hack', 'Demo', 'Distribution', '+'] },
  platinum: { includes: ['Platinum Version'], excludes: ['Kiosk', 'Hack', 'Demo', 'Distribution', '+'] },
  heartgold: { includes: ['HeartGold Version'], excludes: ['SoulSilver', 'Kiosk', 'Hack', 'Demo', 'Distribution'] },
  soulsilver: { includes: ['SoulSilver Version'], excludes: ['HeartGold', 'Kiosk', 'Hack', 'Demo', 'Distribution'] },
  black: { includes: ['Black Version'], excludes: ['Black Version 2', 'White', 'Kiosk', 'Hack', 'Demo', 'Distribution'] },
  white: { includes: ['White Version'], excludes: ['White Version 2', 'Black', 'Kiosk', 'Hack', 'Demo', 'Distribution'] },
  'black-2': { includes: ['Black Version 2'], excludes: ['Kiosk', 'Hack', 'Demo', 'Distribution'] },
  'white-2': { includes: ['White Version 2'], excludes: ['Kiosk', 'Hack', 'Demo', 'Distribution'] },
  x: { includes: ['Pokemon X (USA'], excludes: ['Picross', 'Rumble', 'Mystery', 'Kiosk', 'Hack', 'Demo', 'Distribution', 'Art Academy'] },
  y: { includes: ['Pokemon Y (USA'], excludes: ['Picross', 'Rumble', 'Mystery', 'Kiosk', 'Hack', 'Demo', 'Distribution', 'Art Academy'] },
  'omega-ruby': { includes: ['Omega Ruby (USA'], excludes: ['Kiosk', 'Hack', 'Demo', 'Distribution'] },
  'alpha-sapphire': { includes: ['Alpha Sapphire (USA'], excludes: ['Kiosk', 'Hack', 'Demo', 'Distribution'] },
  sun: { includes: ['Pokemon Sun (USA'], excludes: ['Ultra', 'Mystery', 'Kiosk', 'Hack', 'Demo', 'Distribution'] },
  moon: { includes: ['Pokemon Moon (USA'], excludes: ['Ultra', 'Mystery', 'Kiosk', 'Hack', 'Demo', 'Distribution'] },
  'ultra-sun': { includes: ['Ultra Sun (USA'], excludes: ['Kiosk', 'Hack', 'Demo', 'Distribution'] },
  'ultra-moon': { includes: ['Ultra Moon (USA'], excludes: ['Kiosk', 'Hack', 'Demo', 'Distribution'] },
  'lets-go-pikachu': { unsupported: 'Libretro Thumbnails has no Nintendo Switch art yet.' },
  'lets-go-eevee': { unsupported: 'Libretro Thumbnails has no Nintendo Switch art yet.' },
  sword: { unsupported: 'Libretro Thumbnails has no Nintendo Switch art yet.' },
  shield: { unsupported: 'Libretro Thumbnails has no Nintendo Switch art yet.' },
  'brilliant-diamond': { unsupported: 'Libretro Thumbnails has no Nintendo Switch art yet.' },
  'shining-pearl': { unsupported: 'Libretro Thumbnails has no Nintendo Switch art yet.' },
  'legends-arceus': { unsupported: 'Libretro Thumbnails has no Nintendo Switch art yet.' },
  scarlet: { unsupported: 'Libretro Thumbnails has no Nintendo Switch art yet.' },
  violet: { unsupported: 'Libretro Thumbnails has no Nintendo Switch art yet.' },
  'legends-za': { unsupported: 'Libretro Thumbnails has no Nintendo Switch art yet.' },
};

const listingCache = new Map();

function encodePathSegment(segment) {
  return encodeURIComponent(segment).replace(/%2F/g, '/');
}

export function boxartListingUrl(systemFolder) {
  return `${LIBRETRO_BASE}/${encodePathSegment(systemFolder)}/Named_Boxarts/`;
}

/** Decode Apache href segment; keep literal + (e.g. CGB+SGB) — do not treat + as space. */
function decodeListingHref(hrefPath) {
  return decodeURIComponent(hrefPath);
}

export function boxartImageUrl(systemFolder, filenameOrHrefPath) {
  const segment = filenameOrHrefPath.includes('%')
    ? filenameOrHrefPath
    : encodePathSegment(filenameOrHrefPath);
  return `${boxartListingUrl(systemFolder)}${segment}`;
}

export async function fetchListing(systemFolder) {
  if (listingCache.has(systemFolder)) return listingCache.get(systemFolder);
  const url = boxartListingUrl(systemFolder);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Libretro listing failed (HTTP ${response.status}) for ${systemFolder}`);
  const html = await response.text();
  const files = [...html.matchAll(/href="([^"?]+\.png)"/gi)]
    .map((match) => {
      const hrefPath = match[1];
      return { filename: decodeListingHref(hrefPath), hrefPath };
    })
    .filter((entry) => !entry.hrefPath.includes('/') && /pokemon|pocket monsters/i.test(entry.filename));
  listingCache.set(systemFolder, files);
  return files;
}

function regionScore(filename) {
  if (/\(USA,\s*Europe\)/i.test(filename)) return 120;
  if (/\(USA\)/i.test(filename)) return 110;
  if (/\(Europe\)/i.test(filename)) return 70;
  if (/\(World\)/i.test(filename)) return 60;
  return 20;
}

function gameScore(filename, matcher) {
  if (matcher.unsupported) return -1;
  const upper = filename.toUpperCase();
  for (const bad of matcher.excludes || []) {
    if (upper.includes(bad.toUpperCase())) return -1;
  }
  const includes = matcher.includes || [];
  if (!includes.some((term) => upper.includes(term.toUpperCase()))) return -1;
  let score = regionScore(filename);
  if (!/\(Rev|\(v\d|\(Alternate|\(Beta/i.test(filename)) score += 8;
  if (/\(Kiosk\)|\(Demo\)|\[Hack|Distribution/i.test(filename)) score -= 200;
  return score;
}

export function matchCandidates(files, gameId, matcher) {
  if (matcher.unsupported) return [];
  return files
    .map((entry) => {
      const filename = typeof entry === 'string' ? entry : entry.filename;
      const hrefPath = typeof entry === 'string' ? encodePathSegment(entry) : entry.hrefPath;
      return {
        id: filename,
        name: filename.replace(/\.png$/i, ''),
        filename,
        hrefPath,
        score: gameScore(filename, matcher),
        regionLabel: regionLabelFromFilename(filename),
        recommended: false,
      };
    })
    .filter((item) => item.score >= 0)
    .sort((a, b) => b.score - a.score)
    .map((item, index) => ({ ...item, recommended: index === 0 }));
}

function regionLabelFromFilename(filename) {
  if (/\(USA,\s*Europe\)/i.test(filename)) return 'USA / Europe';
  if (/\(USA\)/i.test(filename)) return 'North America (USA)';
  if (/\(Europe\)/i.test(filename)) return 'Europe';
  if (/\(Japan\)/i.test(filename)) return 'Japan';
  return 'Other region';
}

export function getMatcher(gameId) {
  return GAME_MATCHERS[gameId] || { includes: ['Pokemon'], excludes: ['Kiosk', 'Hack', 'Demo', 'Distribution', 'Video'] };
}

export function clearListingCache() {
  listingCache.clear();
}
