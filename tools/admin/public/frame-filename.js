/** Keep in sync with src/lib/frameFilename.js */

function splitCamelCase(text) {
  return String(text || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .trim();
}

function basename(path) {
  const raw = String(path || '').replace(/\\/g, '/');
  return raw.split('/').pop() || raw;
}

function stripVendorPrefix(stem) {
  return stem
    .replace(/^VS-+Netflix-+/i, '')
    .replace(/^VS-+Amazon-+/i, '')
    .replace(/^VS-+HBO-+/i, '')
    .replace(/^Netflix-+/i, '')
    .replace(/^Amazon-+/i, '')
    .replace(/^HBO-+/i, '');
}

function extractTimestamp(stem) {
  const apostropheMatch = stem.match(/-(\d{1,2})[''′](\d{1,2})"?$/);
  if (apostropheMatch) {
    return {
      timestamp: `${apostropheMatch[1]}:${apostropheMatch[2].padStart(2, '0')}`,
      stem: stem.slice(0, apostropheMatch.index),
    };
  }
  const dashMatch = stem.match(/-(\d{1,2})-(\d{1,2})$/);
  if (dashMatch) {
    return {
      timestamp: `${dashMatch[1]}:${dashMatch[2].padStart(2, '0')}`,
      stem: stem.slice(0, dashMatch.index),
    };
  }
  return { timestamp: '', stem };
}

export function parseFrameFilename(pathOrName) {
  const base = basename(pathOrName).replace(/\.[^.]+$/i, '');
  let stem = stripVendorPrefix(base);

  const { timestamp, stem: withoutTime } = extractTimestamp(stem);
  stem = withoutTime;

  let episode = null;
  const epMatch = stem.match(/E(\d{1,2})/i);
  if (epMatch) episode = Number(epMatch[1]);

  let show = '';
  if (/concierge/i.test(stem)) show = 'Pokémon Concierge';
  else if (/pokemon/i.test(stem)) show = 'Pokémon';

  let sceneSlug = '';
  const sceneMatch = stem.match(/E\d{1,2}(.+)$/i);
  if (sceneMatch) sceneSlug = sceneMatch[1];
  else {
    const showMatch = stem.match(/(?:Pok[eé]?mon)?Concierge(.+)$/i);
    if (showMatch) sceneSlug = showMatch[1];
  }

  const sceneTitle = splitCamelCase(sceneSlug);

  const episodeLine = episode ? `Episode ${episode}` : '';
  const timeLine = timestamp ? timestamp : '';
  const metaParts = [episodeLine, timeLine].filter(Boolean);
  const metaLine = metaParts.join(' · ');

  const descriptionParts = [];
  if (show && episode) descriptionParts.push(`Frame from ${show}, episode ${episode}`);
  else if (show) descriptionParts.push(`Frame from ${show}`);
  if (timestamp) descriptionParts.push(`at ${timestamp}`);
  const frameDescription = descriptionParts.join(' ').replace(/\s+,/g, ',');

  return {
    show,
    episode,
    timestamp,
    episodeLine,
    timeLine,
    sceneTitle,
    metaLine,
    frameDescription,
  };
}

export function resolveCarouselSlideDisplay(item = {}) {
  const src = String(item.src || item.path || '').trim();
  const parsed = src ? parseFrameFilename(src) : {};
  const title = String(item.title || '').trim() || parsed.sceneTitle || '';
  const caption = String(item.caption || '').trim();
  const episodeLine = parsed.episodeLine || (parsed.episode ? `Episode ${parsed.episode}` : '');
  const timeLine = parsed.timeLine || parsed.timestamp || '';
  const metaLine = [episodeLine, timeLine].filter(Boolean).join(' · ');

  const description = caption || parsed.frameDescription || '';

  return {
    episodeLine,
    timeLine,
    metaLine,
    title,
    description,
  };
}
