export const ATLAS_PIN_COLORS = {
  blue: { label: 'Research', css: 'blue', hex: '#2f7fd4' },
  yellow: { label: 'Ideas & structure', css: 'yellow', hex: '#e8b830' },
  red: { label: 'Uncertain / TBD', css: 'red', hex: '#d24a4a' },
};

export function normalizeAtlasPins(raw) {
  const pinColors = raw?.pinColors?.length
    ? raw.pinColors
    : Object.entries(ATLAS_PIN_COLORS).map(([id, meta]) => ({ id, label: meta.label }));
  const colorIds = new Set(pinColors.map((c) => c.id));
  const pins = (raw?.pins || []).map((pin) => {
    const normalized = {
      ...pin,
      color: colorIds.has(pin.color) ? pin.color : 'yellow',
      x: clamp01(pin.x),
      y: clamp01(pin.y),
      summary: String(pin.summary || '').trim(),
    };
    const tilt = clampPinTilt(pin.tilt);
    if (tilt !== null) normalized.tilt = tilt;
    else delete normalized.tilt;
    return normalized;
  });
  const showReference = raw?.map?.showReference?.path
    ? {
      path: String(raw.map.showReference.path).trim(),
      label: String(raw.map.showReference.label || 'Show reference').trim(),
      caption: String(raw.map.showReference.caption || '').trim(),
    }
    : null;

  const carousel = (raw?.map?.carousel || [])
    .map((item, index) => {
      const src = String(item?.src || item?.path || '').trim();
      if (!src) return null;
      return {
        id: String(item?.id || `atlas-carousel-${index + 1}`).trim(),
        title: String(item?.title || '').trim(),
        src,
        caption: String(item?.caption || '').trim(),
        type: item?.type === 'video' ? 'video' : 'image',
      };
    })
    .filter(Boolean);

  return {
    map: {
      layers: raw?.map?.layers || {},
      defaultLayers: {
        buildings: raw?.map?.defaultLayers?.buildings !== false,
        paths: raw?.map?.defaultLayers?.paths !== false,
        pins: raw?.map?.defaultLayers?.pins !== false,
      },
      showReference,
      carousel,
    },
    pinColors,
    pins,
  };
}

function clamp01(value) {
  const n = Number(value);
  if (Number.isNaN(n)) return 0.5;
  return Math.min(1, Math.max(0, n));
}

export function clampPinTilt(value) {
  const n = Number(value);
  if (Number.isNaN(n)) return null;
  return Math.min(20, Math.max(-20, Math.round(n)));
}

/** Stable default tilt from pin id when no custom tilt is saved. */
export function defaultPinTilt(id = 'pin') {
  let hash = 5381;
  for (let i = 0; i < id.length; i += 1) {
    hash = ((hash << 5) + hash) ^ id.charCodeAt(i);
  }
  const h = Math.abs(hash);
  return -20 + (h % 41);
}

/** Custom pin.tilt overrides the hash-based default. */
export function resolvePinTilt(pin) {
  if (pin?.tilt !== undefined && pin?.tilt !== null && pin?.tilt !== '') {
    const clamped = clampPinTilt(pin.tilt);
    if (clamped !== null) return clamped;
  }
  return defaultPinTilt(pin?.id || 'pin');
}

/** @deprecated Use resolvePinTilt({ id }) */
export function pinVisualStyle(id) {
  const tilt = defaultPinTilt(id);
  let hash = 5381;
  for (let i = 0; i < id.length; i += 1) {
    hash = ((hash << 5) + hash) ^ id.charCodeAt(i);
  }
  const h = Math.abs(hash);
  return {
    tilt,
    needle: -10 + ((h >> 4) % 21),
  };
}

export function pinColorMeta(colorId, catalog) {
  return catalog?.pinColors?.find((c) => c.id === colorId)
    || ATLAS_PIN_COLORS[colorId]
    || ATLAS_PIN_COLORS.yellow;
}
