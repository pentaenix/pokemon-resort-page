const identity = () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

function multiply(a, b) {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c += 1) for (let r = 0; r < 4; r += 1) {
    out[c * 4 + r] = a[r] * b[c * 4]
      + a[4 + r] * b[c * 4 + 1]
      + a[8 + r] * b[c * 4 + 2]
      + a[12 + r] * b[c * 4 + 3];
  }
  return out;
}

function fromTrs(translation, rotation, scale) {
  const [x, y, z, w] = rotation;
  const x2 = x + x; const y2 = y + y; const z2 = z + z;
  const xx = x * x2; const xy = x * y2; const xz = x * z2;
  const yy = y * y2; const yz = y * z2; const zz = z * z2;
  const wx = w * x2; const wy = w * y2; const wz = w * z2;
  const out = identity();
  out[0] = (1 - yy - zz) * scale[0]; out[1] = (xy + wz) * scale[0]; out[2] = (xz - wy) * scale[0];
  out[4] = (xy - wz) * scale[1]; out[5] = (1 - xx - zz) * scale[1]; out[6] = (yz + wx) * scale[1];
  out[8] = (xz + wy) * scale[2]; out[9] = (yz - wx) * scale[2]; out[10] = (1 - xx - yy) * scale[2];
  out[12] = translation[0]; out[13] = translation[1]; out[14] = translation[2];
  return out;
}

function point(m, p) {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ];
}

function slerp(a, b, amount) {
  let target = b;
  let dot = a.reduce((sum, value, index) => sum + value * b[index], 0);
  if (dot < 0) { dot = -dot; target = b.map((value) => -value); }
  if (dot > 0.9995) {
    const out = a.map((value, index) => value + (target[index] - value) * amount);
    const length = Math.hypot(...out) || 1;
    return out.map((value) => value / length);
  }
  const theta = Math.acos(Math.max(-1, Math.min(1, dot)));
  const sinTheta = Math.sin(theta) || 1;
  const left = Math.sin((1 - amount) * theta) / sinTheta;
  const right = Math.sin(amount * theta) / sinTheta;
  return a.map((value, index) => value * left + target[index] * right);
}

function sampleTrack(times, values, time, interpolation, path) {
  if (!times.length || !values.length) return null;
  let next = times.findIndex((value) => value >= time);
  if (next < 0) next = times.length - 1;
  if (next === 0 || interpolation === 'STEP') return values[next];
  const previous = next - 1;
  const span = times[next] - times[previous];
  const amount = span > 0 ? (time - times[previous]) / span : 0;
  if (path === 'rotation') return slerp(values[previous], values[next], amount);
  return values[previous].map((value, index) => value + (values[next][index] - value) * amount);
}

function animationTimes(animation, readAccessor) {
  const values = new Set();
  for (const sampler of animation.samplers || []) {
    for (const tuple of readAccessor(sampler.input)) values.add(Number(tuple[0]));
  }
  const sorted = [...values].filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length <= 60) return sorted;
  const first = sorted[0]; const last = sorted.at(-1);
  return Array.from({ length: 60 }, (_, index) => first + (last - first) * index / 59);
}

function sampledWorldMatrices(gltf, animation, time, readAccessor) {
  const sampled = (gltf.nodes || []).map((node) => ({
    translation: [...(node.translation || [0, 0, 0])],
    rotation: [...(node.rotation || [0, 0, 0, 1])],
    scale: [...(node.scale || [1, 1, 1])],
    matrix: node.matrix ? new Float32Array(node.matrix) : null,
  }));
  for (const channel of animation.channels || []) {
    const nodeIndex = Number(channel.target?.node);
    const path = channel.target?.path;
    if (!Number.isInteger(nodeIndex) || !['translation', 'rotation', 'scale'].includes(path)) continue;
    const sampler = animation.samplers?.[channel.sampler];
    if (!sampler) continue;
    const times = readAccessor(sampler.input).map((tuple) => tuple[0]);
    let values = readAccessor(sampler.output);
    if (sampler.interpolation === 'CUBICSPLINE') values = values.filter((_, index) => index % 3 === 1);
    const value = sampleTrack(times, values, time, sampler.interpolation || 'LINEAR', path);
    if (value) { sampled[nodeIndex][path] = [...value]; sampled[nodeIndex].matrix = null; }
  }
  const parents = new Array(sampled.length).fill(-1);
  for (let index = 0; index < (gltf.nodes || []).length; index += 1) {
    for (const child of gltf.nodes[index].children || []) parents[child] = index;
  }
  const cache = new Array(sampled.length);
  const world = (index) => {
    if (cache[index]) return cache[index];
    const value = sampled[index];
    const local = value.matrix || fromTrs(value.translation, value.rotation, value.scale);
    cache[index] = parents[index] >= 0 ? multiply(world(parents[index]), local) : local;
    return cache[index];
  };
  return sampled.map((_, index) => world(index));
}

function animatedPosition(binding, worlds, skins, readAccessor) {
  if (binding.skinIndex === undefined || !binding.joints?.length || !binding.weights?.length) {
    return point(worlds[binding.nodeIndex] || identity(), binding.position);
  }
  const skin = skins[binding.skinIndex];
  if (!skin) return point(worlds[binding.nodeIndex] || identity(), binding.position);
  const inverseBinds = skin.inverseBindMatrices === undefined
    ? (skin.joints || []).map(() => identity())
    : readAccessor(skin.inverseBindMatrices).map((tuple) => new Float32Array(tuple));
  const result = [0, 0, 0];
  let total = 0;
  for (let index = 0; index < Math.min(4, binding.joints.length); index += 1) {
    const weight = Number(binding.weights[index]) || 0;
    const jointNode = skin.joints?.[binding.joints[index]];
    if (!weight || jointNode === undefined) continue;
    const transformed = point(multiply(worlds[jointNode], inverseBinds[binding.joints[index]] || identity()), binding.position);
    for (let axis = 0; axis < 3; axis += 1) result[axis] += transformed[axis] * weight;
    total += weight;
  }
  if (total <= 0) return point(worlds[binding.nodeIndex] || identity(), binding.position);
  return result.map((value) => value / total);
}

export function buildVertexAnimationClips(gltf, bindings, readAccessor) {
  if (!bindings.length || !(gltf.animations || []).length) return [];
  const clips = [];
  for (const animation of gltf.animations) {
    const supportedChannels = (animation.channels || []).filter((channel) =>
      Number.isInteger(Number(channel.target?.node))
      && ['translation', 'rotation', 'scale'].includes(channel.target?.path));
    if (!supportedChannels.length) continue;
    const times = animationTimes(animation, readAccessor);
    if (!times.length) continue;
    const frames = times.map((time) => {
      const worlds = sampledWorldMatrices(gltf, animation, time, readAccessor);
      return bindings.flatMap((binding) => animatedPosition(binding, worlds, gltf.skins || [], readAccessor));
    });
    const durationMs = Math.max(16, Math.round((times.at(-1) - times[0]) * 1000));
    clips.push({
      name: String(animation.name || `animation_${clips.length + 1}`),
      frameDurationMs: times.length > 1 ? Math.max(16, Math.round(durationMs / (times.length - 1))) : durationMs,
      frames,
    });
  }
  return clips;
}
