import * as THREE from 'three';

export function rampProgressColor(baseColor, progress, options = {}) {
  const t = Math.min(1, Math.max(0, progress));
  if (options.enabled === false) return baseColor.clone();
  const lowShade = Math.min(4, Math.max(0, Number(options.lowShade ?? 0.88)));
  const highShade = Math.min(4, Math.max(0, Number(options.highShade ?? 1.10)));
  const bandCount = Math.min(64, Math.max(0, Number(options.bandCount ?? 5)));
  const bandStrength = Math.min(1, Math.max(0, Number(options.bandStrength ?? 0.12)));
  const bandSoftness = Math.min(0.49, Math.max(0.03, Number(options.bandSoftness ?? 0.32)));
  const x = Math.abs((t * bandCount) - Math.floor((t * bandCount) + 0.5));
  const edge0 = bandSoftness;
  const edge1 = 0.02;
  const s = Math.min(1, Math.max(0, (x - edge1) / (edge0 - edge1)));
  const softBand = s * s * (3 - (2 * s));
  const gradient = lowShade + (t * (highShade - lowShade));
  const band = bandCount <= 0.001 ? 1 : 1 - (softBand * bandStrength);
  return baseColor.clone().multiplyScalar(gradient * band);
}

export function cardinalRampProgress(specials, tx, ty, u, v) {
  const special = specials?.[ty]?.[tx] ?? 0;
  if (special < 2 || special > 5) return null;

  let dx = 0;
  let dy = 0;
  if (special === 2) dy = -1;
  else if (special === 3) dx = 1;
  else if (special === 4) dy = 1;
  else if (special === 5) dx = -1;

  let startX = tx;
  let startY = ty;
  let index = 0;
  while ((specials?.[startY - dy]?.[startX - dx] ?? 0) === special) {
    startX -= dx;
    startY -= dy;
    index += 1;
  }

  let endX = startX;
  let endY = startY;
  let count = 1;
  while ((specials?.[endY + dy]?.[endX + dx] ?? 0) === special) {
    endX += dx;
    endY += dy;
    count += 1;
  }

  let local = 0;
  if (special === 2) local = 1 - v;
  else if (special === 3) local = u;
  else if (special === 4) local = v;
  else if (special === 5) local = 1 - u;
  return Math.min(1, Math.max(0, (index + Math.min(1, Math.max(0, local))) / Math.max(1, count)));
}
