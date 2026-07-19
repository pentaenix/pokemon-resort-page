export function normalizeRtpksSampler(sampler = {}) {
  const wrap = (value) => ['repeat', 'clamp', 'mirror'].includes(value) ? value : 'repeat';
  const filter = (value) => value === 'linear' ? 'linear' : 'nearest';
  return {
    wrapS: wrap(sampler.wrapS),
    wrapT: wrap(sampler.wrapT),
    magFilter: filter(sampler.magFilter),
    minFilter: filter(sampler.minFilter),
  };
}

function wrappedDelta(a, b, wrapMode) {
  let delta = b - a;
  const period = wrapMode === 'repeat' ? 1 : wrapMode === 'mirror' ? 2 : 0;
  if (period > 0) delta -= Math.round(delta / period) * period;
  return delta;
}

function interpolateOffset(a, b, amount, sampler) {
  const start = Array.isArray(a) ? a : [0, 0];
  const end = Array.isArray(b) ? b : start;
  return [
    (Number(start[0]) || 0) + wrappedDelta(Number(start[0]) || 0, Number(end[0]) || 0, sampler.wrapS) * amount,
    (Number(start[1]) || 0) + wrappedDelta(Number(start[1]) || 0, Number(end[1]) || 0, sampler.wrapT) * amount,
  ];
}

export function sampleRtpksMaterialMotion(animation, elapsedMs, samplerInput = {}) {
  const sampler = normalizeRtpksSampler(samplerInput);
  const offsets = Array.isArray(animation?.offsets) ? animation.offsets : [];
  const frameCount = Math.max(1, Number(animation?.frameCount) || offsets.length || Number(animation?.imageFrameCount) || 1);
  const frameDurationMs = Math.max(16, Number(animation?.frameDurationMs) || 100);
  const timebaseHz = Number(animation?.timebaseHz);
  const loop = animation?.loop !== false;
  const rawSample = Number.isFinite(timebaseHz) && timebaseHz > 0
    ? Math.max(0, Number(elapsedMs) || 0) * timebaseHz / 1000
    : Math.max(0, Number(elapsedMs) || 0) / frameDurationMs;
  const sample = loop ? rawSample % frameCount : Math.min(rawSample, frameCount - 1);
  const frame = Math.min(frameCount - 1, Math.floor(sample));
  const nextFrame = loop ? (frame + 1) % frameCount : Math.min(frameCount - 1, frame + 1);
  const amount = animation?.interpolation === 'linear' && (loop || frame < frameCount - 1)
    ? sample - frame
    : 0;
  const offset = offsets.length
    ? interpolateOffset(offsets[frame % offsets.length], offsets[nextFrame % offsets.length], amount, sampler)
    : [0, 0];
  const imageFrameCount = Math.max(1, Number(animation?.imageFrameCount) || frameCount);
  return { frame, nextFrame, amount, offset, imageFrame: frame % imageFrameCount };
}

export function rtpksMaterialAppearance(meta = {}) {
  const nitroAlpha = Math.max(0, Math.min(31, Number(meta.alpha ?? 31)));
  const uniformOpacity = nitroAlpha / 31;
  const shadowLike = /shadow|kage|shade/i.test(`${meta.name || ''} ${meta.textureName || ''}`);
  const textureAlpha = ['opaque', 'cutout', 'blend'].includes(meta.textureAlpha) ? meta.textureAlpha : 'opaque';
  const blended = shadowLike || uniformOpacity < 0.999 || textureAlpha === 'blend';
  const cutout = !blended && textureAlpha === 'cutout';
  return {
    opacity: shadowLike && nitroAlpha >= 31 ? 0.45 : uniformOpacity,
    transparent: blended,
    alphaTest: cutout ? 0.5 : 0,
    depthWrite: !blended,
    polygonOffset: shadowLike,
  };
}
