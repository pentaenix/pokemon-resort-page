// View-only 3D workspace for the map editor.
//
// Builds a real three.js scene of the map being edited: a height-shaded terrain mesh from the
// editor's height/special grids plus every placed prop loaded as its actual GLB (reusing the
// same loader/material tuning as the prop previewer), under an orbit camera. This is a preview,
// not an editor surface: painting still happens on the 2D grid. The controller exposes only
// dispose(); the caller re-mounts after a render when the workspace is in 3D mode.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { loadGlbScene } from '/shared/model-glb-viewer.js';
import { tuneGltfTexture } from '/shared/model-texture-alpha.js';
import { cornerHeightsForTile, SPECIAL } from '/shared/ramp-specials.js';
import { cardinalRampProgress, rampProgressColor } from './ramp-visual-hints.js';
import {
  normalizeRtpksSampler,
  rtpksMaterialAppearance,
  sampleRtpksMaterialMotion,
} from './rtpks-material-motion.js';

const TOP_A = [116, 156, 190];
const TOP_B = [125, 166, 200];
const rtpksPackageCache = new Map();
const rtpksMeshCache = new Map();
const rtpksTextureCache = new Map();
const rtpksThumbnailCache = new Map();
const DECORATION_LAYER_Y_EPSILON = 0.004;

function tileColor(level, special, blocked, parity, visual = {}) {
  const base = parity ? TOP_A : TOP_B;
  if (visual.rampRecolorEnabled !== false && special >= SPECIAL.RAMP_N && special <= SPECIAL.CONCAVE_NW) {
    return new THREE.Color(visual.rampColor || '#f4d03f');
  }
  if (visual.floorRecolorEnabled !== false && level > 0) {
    const color = visual.floorColors?.[level] || visual.floorColors?.[1];
    if (color) return new THREE.Color(color);
  }
  const shade = Math.min(70, Math.max(0, level) * 12);
  let r = Math.min(255, base[0] + shade);
  let g = Math.min(255, base[1] + shade);
  let b = Math.min(255, base[2] + shade);
  // Ramp/slope specials read amber so slopes stand out from flat tiles.
  if (special >= SPECIAL.RAMP_N && special <= SPECIAL.CONCAVE_NW) { r = (r + 251) / 2; g = (g + 191) / 2; b = (b + 60) / 2; }
  if (blocked) { r = (r + 220) / 2; g = (g + 90) / 2; b = (b + 90) / 2; }
  return new THREE.Color(r / 255, g / 255, b / 255);
}

function tileFootprintLookup(packageInfo) {
  const lookup = new Map();
  for (const tile of (packageInfo?.tiles || [])) {
    lookup.set(Number(tile.resortTileId), {
      w: Math.max(1, Number(tile.width || tile.footprint?.w || 1)),
      h: Math.max(1, Number(tile.height || tile.footprint?.h || tile.footprint?.d || 1)),
    });
  }
  return lookup;
}

function buildTerrain(map, tileSize, packageInfo = null) {
  const w = map.grid.width;
  const h = map.grid.height;
  const heights = map.terrain?.height || [];
  const specials = map.terrain?.special || [];
  const collision = map.terrain?.collision || [];
  const visual = map.terrainVisual || {};
  const floorHeight = Number(visual.floorHeightScale) || tileSize;
  const tileLayers = visibleTileLayers(map);
  const footprints = tileFootprintLookup(packageInfo);
  const positions = [];
  const colors = [];
  const sideShade = 0.72;

  const pushVertex = (x, y, z, color, shade = 1) => {
    positions.push(x, y, z);
    colors.push(color.r * shade, color.g * shade, color.b * shade);
  };

  const pushQuad = (pts, color, shade = 1) => {
    pushVertex(...pts[0], color, shade);
    pushVertex(...pts[1], color, shade);
    pushVertex(...pts[2], color, shade);
    pushVertex(...pts[0], color, shade);
    pushVertex(...pts[2], color, shade);
    pushVertex(...pts[3], color, shade);
  };
  const cornersAt = (x, z) => {
    if (x < 0 || z < 0 || x >= w || z >= h) return [0, 0, 0, 0];
    return cornerHeightsForTile(specials?.[z]?.[x] ?? 0, heights, w, h, x, z, floorHeight, specials, collision);
  };

  const hasVisibleTile = (x, z) => {
    if (!tileLayers?.length) return false;
    return tileLayers.some(({ layer }) => {
      for (let ay = 0; ay <= z; ay += 1) {
        for (let ax = 0; ax <= x; ax += 1) {
          const id = layer.cells?.[ay]?.[ax];
          if (id == null || id === '') continue;
          const fp = footprints.get(Number(id)) || { w: 1, h: 1 };
          if (x >= ax && x < ax + fp.w && z >= ay && z < ay + fp.h) return true;
        }
      }
      return false;
    });
  };

  const edgeAbove = (a0, a1, b0, b1) => Math.max(a0 - b0, a1 - b1) > 0.001;

  for (let z = 0; z < h; z += 1) {
    for (let x = 0; x < w; x += 1) {
      const level = Math.max(0, heights?.[z]?.[x] ?? 0);
      const special = specials?.[z]?.[x] ?? 0;
      const color = tileColor(level, special, Boolean(collision?.[z]?.[x]), ((x + z) & 1) === 0, visual);
      const c = cornersAt(x, z); // NW, NE, SE, SW, matching the C++ terrain renderer.
      const nw = [x * tileSize, c[0], z * tileSize];
      const ne = [(x + 1) * tileSize, c[1], z * tileSize];
      const se = [(x + 1) * tileSize, c[2], (z + 1) * tileSize];
      const sw = [x * tileSize, c[3], (z + 1) * tileSize];

      // RTPKS mesh tiles are the visible top surface for painted cells. Keeping the
      // fallback terrain top under them causes z-fighting in the editor preview.
      if (!hasVisibleTile(x, z)) {
        pushQuad([sw, se, ne, nw], color, 1);
      }

      const n = cornersAt(x, z - 1);
      if (edgeAbove(c[0], c[1], n[3], n[2])) {
        pushQuad([nw, ne, [(x + 1) * tileSize, n[2], z * tileSize], [x * tileSize, n[3], z * tileSize]], color, sideShade);
      }
      const e = cornersAt(x + 1, z);
      if (edgeAbove(c[1], c[2], e[0], e[3])) {
        pushQuad([ne, se, [(x + 1) * tileSize, e[3], (z + 1) * tileSize], [(x + 1) * tileSize, e[0], z * tileSize]], color, sideShade);
      }
      const s = cornersAt(x, z + 1);
      if (edgeAbove(c[2], c[3], s[1], s[0])) {
        pushQuad([se, sw, [x * tileSize, s[0], (z + 1) * tileSize], [(x + 1) * tileSize, s[1], (z + 1) * tileSize]], color, sideShade);
      }
      const west = cornersAt(x - 1, z);
      if (edgeAbove(c[3], c[0], west[2], west[1])) {
        pushQuad([sw, nw, [x * tileSize, west[1], z * tileSize], [x * tileSize, west[2], (z + 1) * tileSize]], color, sideShade);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0.0, vertexColors: true, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geometry, mat);
  mesh.receiveShadow = false;
  return mesh;
}

function visibleTileLayers(map) {
  const layers = map?.tileLayers?.layers;
  if (!Array.isArray(layers) || !layers.length) return null;
  return layers
    .map((layer, index) => ({ layer, index }))
    .filter((item) => item.layer?.visible !== false);
}

async function fetchJson(path) {
  const res = await fetch(path);
  const payload = await res.json().catch(() => null);
  if (!res.ok || !payload) throw new Error(payload?.error || `Request failed (${res.status})`);
  return payload;
}

async function loadRtpksPackage(fileName) {
  if (!fileName) return null;
  if (!rtpksPackageCache.has(fileName)) {
    rtpksPackageCache.set(fileName, fetchJson(`/api/tile-packages/package?file=${encodeURIComponent(fileName)}`)
      .then((payload) => payload.package));
  }
  return rtpksPackageCache.get(fileName);
}

async function loadRtpksMesh(fileName, resortTileId) {
  const key = `${fileName}|${resortTileId}`;
  if (!rtpksMeshCache.has(key)) {
    rtpksMeshCache.set(key, fetchJson(`/api/tile-packages/mesh?file=${encodeURIComponent(fileName)}&tileId=${encodeURIComponent(resortTileId)}`));
  }
  return rtpksMeshCache.get(key);
}

function loadRtpksTexture(fileName, textureName) {
  if (!fileName || !textureName) return null;
  const key = `${fileName}|${textureName}`;
  if (!rtpksTextureCache.has(key)) {
    const loader = new THREE.TextureLoader();
    const url = `/api/tile-packages/texture?file=${encodeURIComponent(fileName)}&texture=${encodeURIComponent(textureName)}`;
    rtpksTextureCache.set(key, loader.load(url, (texture) => {
      tuneGltfTexture(texture);
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.magFilter = THREE.NearestFilter;
      texture.minFilter = THREE.NearestFilter;
      texture.generateMipmaps = false;
      texture.needsUpdate = true;
    }));
  }
  return rtpksTextureCache.get(key);
}

function threeWrapMode(mode) {
  if (mode === 'clamp') return THREE.ClampToEdgeWrapping;
  if (mode === 'mirror') return THREE.MirroredRepeatWrapping;
  return THREE.RepeatWrapping;
}

function configureRtpksTexture(texture, sampler) {
  if (!texture) return null;
  tuneGltfTexture(texture);
  texture.wrapS = threeWrapMode(sampler.wrapS);
  texture.wrapT = threeWrapMode(sampler.wrapT);
  texture.magFilter = sampler.magFilter === 'linear' ? THREE.LinearFilter : THREE.NearestFilter;
  texture.minFilter = sampler.minFilter === 'linear' ? THREE.LinearFilter : THREE.NearestFilter;
  texture.generateMipmaps = false;
  // TextureLoader returns immediately, before its image exists. Marking a clone
  // dirty at that point produces a WebGL upload warning for every water
  // material; the loader callback will flag the shared source once it is ready.
  if (texture.image) texture.needsUpdate = true;
  return texture;
}

function materialForRtpks(fileName, packageInfo, materialId) {
  const meta = (packageInfo.materials || []).find((mat) => Number(mat.materialId) === Number(materialId));
  const animation = meta?.animation;
  const motion = animation?.type === 'materialMotion';
  const sampler = normalizeRtpksSampler(meta?.sampler);
  const appearance = rtpksMaterialAppearance(meta);
  const ownedTextures = [];
  const cloneMaterialTexture = (source) => {
    if (!source) return null;
    const clone = configureRtpksTexture(source.clone(), sampler);
    ownedTextures.push(clone);
    return clone;
  };
  const sourceTexture = meta?.textureName ? loadRtpksTexture(fileName, meta.textureName) : null;
  const texture = cloneMaterialTexture(sourceTexture);
  const shadowLike = /shadow|kage|shade/i.test(`${meta?.name || ''} ${meta?.textureName || ''}`);
  const material = new THREE.MeshStandardMaterial({
    map: texture || null,
    color: texture ? 0xffffff : 0xd9f99d,
    roughness: 0.95,
    metalness: 0,
    vertexColors: true,
    side: THREE.DoubleSide,
    alphaTest: appearance.alphaTest,
    transparent: appearance.transparent,
    opacity: appearance.opacity,
    depthWrite: appearance.depthWrite,
    polygonOffset: appearance.polygonOffset,
    polygonOffsetFactor: shadowLike ? -1 : 0,
    polygonOffsetUnits: shadowLike ? -1 : 0,
  });
  if (animation?.type === 'frames' && Array.isArray(animation.frames) && animation.frames.length) {
    const frames = animation.frames.map((name) => cloneMaterialTexture(loadRtpksTexture(fileName, name)));
    const frameTime = Math.max(16, Number(animation.frameDurationMs) || 180);
    material.onBeforeRender = () => {
      const elapsed = Math.max(0, performance.now());
      const rawFrame = Math.floor(elapsed / frameTime);
      const frame = animation.loop === false ? Math.min(frames.length - 1, rawFrame) : rawFrame % frames.length;
      const next = frames[frame];
      if (next && material.map !== next) {
        material.map = next;
        material.needsUpdate = true;
      }
    };
  } else if (motion) {
    const offsets = Array.isArray(animation.offsets) ? animation.offsets : [];
    const keyframes = (animation.imageKeyframes || []).map((keyframe) => ({
      frame: Math.max(0, Number(keyframe.frame) || 0),
      texture: cloneMaterialTexture(loadRtpksTexture(fileName, keyframe.textureName)),
    })).sort((a, b) => a.frame - b.frame);
    material.onBeforeRender = () => {
      const sample = sampleRtpksMaterialMotion(animation, performance.now(), sampler);
      let next = texture;
      if (keyframes.length) {
        next = keyframes[0].texture;
        for (const keyframe of keyframes) {
          if (keyframe.frame > sample.imageFrame) break;
          next = keyframe.texture;
        }
      }
      if (next && material.map !== next) {
        material.map = next;
        material.needsUpdate = true;
      }
      if (material.map && offsets.length) material.map.offset.set(sample.offset[0], sample.offset[1]);
    };
  }
  material.userData.rtpksOwnedTextures = ownedTextures;
  material.userData.rtpksRenderOrder = Number(meta?.renderOrder) || 0;
  material.userData.rtpksLayerRole = String(meta?.layerRole || 'surface');
  return material;
}

function disposeRtpksObject(root) {
  root.traverse((obj) => {
    obj.geometry?.dispose?.();
    const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const material of materials) {
      for (const texture of material?.userData?.rtpksOwnedTextures || []) texture.dispose?.();
      material?.dispose?.();
    }
  });
}

function meshVerticalRange(mesh) {
  let minZ = Infinity;
  let maxZ = -Infinity;
  const scan = (values = []) => {
    for (let i = 2; i < values.length; i += 3) {
      minZ = Math.min(minZ, Number(values[i]) || 0);
      maxZ = Math.max(maxZ, Number(values[i]) || 0);
    }
  };
  scan(mesh.triangles);
  scan(mesh.quads);
  return Number.isFinite(minZ) ? maxZ - minZ : 0;
}

function terrainHeightAtWorld(map, worldX, worldZ, tileSize, sampleTx = null, sampleTy = null) {
  const heights = map.terrain?.height || [];
  const specials = map.terrain?.special || [];
  const collision = map.terrain?.collision || [];
  const floorHeight = Number(map.terrainVisual?.floorHeightScale) || tileSize;
  const w = map.grid?.width || 1;
  const h = map.grid?.height || 1;
  const tx = Math.min(w - 1, Math.max(0, Number.isFinite(sampleTx) ? sampleTx : Math.floor(worldX / tileSize)));
  const ty = Math.min(h - 1, Math.max(0, Number.isFinite(sampleTy) ? sampleTy : Math.floor(worldZ / tileSize)));
  const u = Math.min(1, Math.max(0, (worldX - tx * tileSize) / tileSize));
  const v = Math.min(1, Math.max(0, (worldZ - ty * tileSize) / tileSize));
  const c = cornerHeightsForTile(specials?.[ty]?.[tx] ?? 0, heights, w, h, tx, ty, floorHeight, specials, collision);
  const north = c[0] + (c[1] - c[0]) * u;
  const south = c[3] + (c[2] - c[3]) * u;
  return north + (south - north) * v;
}

function terrainFloorBaseAtTile(map, tx, ty, tileSize) {
  const heights = map.terrain?.height || [];
  const specials = map.terrain?.special || [];
  const collision = map.terrain?.collision || [];
  const floorHeight = Number(map.terrainVisual?.floorHeightScale) || tileSize;
  const w = map.grid?.width || 1;
  const h = map.grid?.height || 1;
  const c = cornerHeightsForTile(specials?.[ty]?.[tx] ?? 0, heights, w, h, tx, ty, floorHeight, specials, collision);
  return Math.min(c[0], c[1], c[2], c[3]);
}

function appendVertex(out, mesh, source, uvSource, colorSource, vertexIndex, tileSize, placement = null, uvMapping = null) {
  const vi = vertexIndex * 3;
  const ui = vertexIndex * 2;
  const localX = ((source[vi] || 0) + (mesh.xOffset || mesh.x_offset || 0)) * tileSize;
  const localY = (((mesh.height || 1) - ((source[vi + 1] || 0) + (mesh.yOffset || mesh.y_offset || 0)))) * tileSize;
  const localZ = (source[vi + 2] || 0) * tileSize;
  let worldX = localX;
  let worldZ = localY;
  if (placement) {
    worldX = placement.x * tileSize + localX;
    worldZ = placement.z * tileSize + localY;
    const sampleTx = placement.x + Math.min(
      Math.max(0, Math.floor(localX / tileSize)),
      Math.max(0, (mesh.width || 1) - 1),
    );
    const sampleTy = placement.z + Math.min(
      Math.max(0, Math.floor(localY / tileSize)),
      Math.max(0, (mesh.height || 1) - 1),
    );
    const worldY = placement.conformToTerrain
      ? terrainHeightAtWorld(placement.map, worldX, worldZ, tileSize, sampleTx, sampleTy) + localZ + placement.layerLift
      : placement.baseY + localZ + placement.layerLift;
    out.positions.push(worldX, worldY, worldZ);
  } else {
    out.positions.push(localX, localZ, localY);
  }
  let textureU = uvSource?.[ui] ?? 0;
  let textureV = uvSource?.[ui + 1] ?? 0;
  if (placement && uvMapping?.mode === 'world') {
    textureU += placement.x * Number(uvMapping.uPerTile?.[0] || 0)
      + placement.z * Number(uvMapping.uPerTile?.[1] || 0);
    textureV += placement.x * Number(uvMapping.vPerTile?.[0] || 0)
      + placement.z * Number(uvMapping.vPerTile?.[1] || 0);
  }
  out.uvs.push(textureU, textureV);
  let color = new THREE.Color(
    colorSource?.[vi] ?? 1,
    colorSource?.[vi + 1] ?? 1,
    colorSource?.[vi + 2] ?? 1,
  );
  if (placement?.conformToTerrain) {
    const sampleTx = placement.x + Math.min(
      Math.max(0, Math.floor(localX / tileSize)),
      Math.max(0, (mesh.width || 1) - 1),
    );
    const sampleTy = placement.z + Math.min(
      Math.max(0, Math.floor(localY / tileSize)),
      Math.max(0, (mesh.height || 1) - 1),
    );
    const u = Math.min(1, Math.max(0, (worldX - sampleTx * tileSize) / tileSize));
    const v = Math.min(1, Math.max(0, (worldZ - sampleTy * tileSize) / tileSize));
    const progress = cardinalRampProgress(placement.map.terrain?.special || [], sampleTx, sampleTy, u, v);
    if (progress != null) color = rampProgressColor(color, progress, placement.map.terrainVisual?.rampReadability || {});
  }
  out.colors.push(color.r, color.g, color.b);
}

export async function renderRtpksTileThumbnail(fileName, packageInfo, resortTileId, options = {}) {
  const size = Math.max(48, Number(options.size || 88));
  const key = `${fileName}|${resortTileId}|${size}`;
  if (rtpksThumbnailCache.has(key)) return rtpksThumbnailCache.get(key);
  const promise = (async () => {
    const tile = (packageInfo?.tiles || []).find((entry) => Number(entry.resortTileId) === Number(resortTileId));
    const tileSize = 32;
    const root = await buildRtpksTileTemplate(fileName, packageInfo, resortTileId, tileSize);
    await waitForObjectTextures(root);
    const scene = new THREE.Scene();
    scene.background = null;
    scene.add(root);
    scene.add(new THREE.AmbientLight(0xffffff, 1.8));
    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(2, 5, 3);
    scene.add(sun);
    const w = Math.max(1, Number(tile?.width || 1)) * tileSize;
    const h = Math.max(1, Number(tile?.height || 1)) * tileSize;
    const center = new THREE.Vector3(w * 0.5, 0, h * 0.5);
    const extent = Math.max(w, h, tileSize);
    const camera = new THREE.OrthographicCamera(-extent * 0.58, extent * 0.58, extent * 0.58, -extent * 0.58, 0.1, extent * 8);
    camera.position.set(center.x, extent * 3, center.z);
    camera.up.set(0, 0, -1);
    camera.lookAt(center.x, 0, center.z);
    const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, preserveDrawingBuffer: true });
    renderer.setSize(size, size, false);
    renderer.setPixelRatio(1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.render(scene, camera);
    const url = renderer.domElement.toDataURL('image/png');
    renderer.dispose();
    disposeRtpksObject(root);
    return url;
  })();
  rtpksThumbnailCache.set(key, promise);
  return promise;
}

function lightingPresetConfig(visual = {}) {
  const preset = visual.lightPreset || 'day';
  const presets = {
    day: { hemi: 0.95, key: 1.25, fill: 0.35, bg: 0x0b2a3a, color: 0xffffff, ground: 0x3a4a3a, yaw: 38, pitch: 58 },
    sunset: { hemi: 0.68, key: 1.05, fill: 0.22, bg: 0x16263f, color: 0xffc07a, ground: 0x4a3448, yaw: -42, pitch: 26 },
    night: { hemi: 0.38, key: 0.42, fill: 0.12, bg: 0x071426, color: 0x9fc6ff, ground: 0x111827, yaw: 25, pitch: 48 },
  };
  return presets[preset] || presets.day;
}

function appendTri(out, mesh, triIndex, tileSize, placement = null, uvMapping = null) {
  const base = triIndex * 3;
  appendVertex(out, mesh, mesh.triangles, mesh.texCoordsTri, mesh.colorsTri, base, tileSize, placement, uvMapping);
  appendVertex(out, mesh, mesh.triangles, mesh.texCoordsTri, mesh.colorsTri, base + 1, tileSize, placement, uvMapping);
  appendVertex(out, mesh, mesh.triangles, mesh.texCoordsTri, mesh.colorsTri, base + 2, tileSize, placement, uvMapping);
}

function appendQuad(out, mesh, quadIndex, tileSize, placement = null, uvMapping = null) {
  const base = quadIndex * 4;
  appendVertex(out, mesh, mesh.quads, mesh.texCoordsQuad, mesh.colorsQuad, base, tileSize, placement, uvMapping);
  appendVertex(out, mesh, mesh.quads, mesh.texCoordsQuad, mesh.colorsQuad, base + 1, tileSize, placement, uvMapping);
  appendVertex(out, mesh, mesh.quads, mesh.texCoordsQuad, mesh.colorsQuad, base + 2, tileSize, placement, uvMapping);
  appendVertex(out, mesh, mesh.quads, mesh.texCoordsQuad, mesh.colorsQuad, base, tileSize, placement, uvMapping);
  appendVertex(out, mesh, mesh.quads, mesh.texCoordsQuad, mesh.colorsQuad, base + 2, tileSize, placement, uvMapping);
  appendVertex(out, mesh, mesh.quads, mesh.texCoordsQuad, mesh.colorsQuad, base + 3, tileSize, placement, uvMapping);
}

function buildRangeGeometry(mesh, range, tileSize, placement = null, uvMapping = null) {
  const out = { positions: [], uvs: [], colors: [] };
  for (let i = 0; i < (range.triCount || 0); i += 1) appendTri(out, mesh, (range.triStart || 0) + i, tileSize, placement, uvMapping);
  for (let i = 0; i < (range.quadCount || 0); i += 1) appendQuad(out, mesh, (range.quadStart || 0) + i, tileSize, placement, uvMapping);
  if (!out.positions.length) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(out.positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(out.uvs, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(out.colors, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

async function buildRtpksTileTemplate(fileName, packageInfo, resortTileId, tileSize, placement = null) {
  const meshPayload = await loadRtpksMesh(fileName, resortTileId);
  const effectivePlacement = placement
    ? {
        ...placement,
        conformToTerrain: meshVerticalRange(meshPayload) <= 0.02,
        baseY: terrainFloorBaseAtTile(placement.map, placement.x, placement.z, tileSize),
      }
    : null;
  const group = new THREE.Group();
  group.name = `rtpks_tile_${resortTileId}`;
  const ranges = Array.isArray(meshPayload.materialRanges) && meshPayload.materialRanges.length
    ? meshPayload.materialRanges
    : [{ materialId: meshPayload.textureIds?.[0] ?? 0, triStart: 0, triCount: (meshPayload.triangles || []).length / 9, quadStart: 0, quadCount: (meshPayload.quads || []).length / 12 }];
  for (const range of ranges) {
    const materialMeta = (packageInfo.materials || []).find((mat) => Number(mat.materialId) === Number(range.materialId));
    const geometry = buildRangeGeometry(meshPayload, range, tileSize, effectivePlacement, materialMeta?.uvMapping);
    if (!geometry) continue;
    const mat = materialForRtpks(fileName, packageInfo, range.materialId);
    const part = new THREE.Mesh(geometry, mat);
    part.renderOrder = Number(materialMeta?.renderOrder) || 0;
    part.castShadow = false;
    part.receiveShadow = false;
    group.add(part);
  }
  return group;
}

export async function mountRtpksTilePreview(host, fileName, packageInfo, resortTileId, options = {}) {
  if (!host || !fileName || resortTileId == null) return { dispose() {} };
  let disposed = false;
  let raf = 0;
  let resizeObserver = null;
  let intersectionObserver = null;
  let previewVisible = true;
  let lastAnimatedRender = 0;

  const tileSize = Math.max(8, Number(options.tileSize || 32));
  const viewW = Math.max(180, Math.round(host.clientWidth || 260));
  const viewH = Math.max(140, Math.round(host.clientHeight || 180));
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x18212a);

  const root = await buildRtpksTileTemplate(fileName, packageInfo, resortTileId, tileSize);
  if (disposed || (typeof options.isCurrent === 'function' && !options.isCurrent())) {
    disposeRtpksObject(root);
    return { dispose() {} };
  }
  scene.add(root);

  const box = new THREE.Box3().setFromObject(root);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z, tileSize);
  const pivot = new THREE.Group();
  pivot.add(root);
  root.position.sub(center);
  scene.add(pivot);

  const ambient = new THREE.AmbientLight(0xffffff, 1.25);
  const key = new THREE.DirectionalLight(0xffffff, 1.1);
  key.position.set(maxDim * 0.75, maxDim * 1.6, maxDim * 1.1);
  const fill = new THREE.DirectionalLight(0x9fc6ff, 0.35);
  fill.position.set(-maxDim, maxDim * 0.6, -maxDim * 0.8);
  scene.add(ambient, key, fill);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(dpr);
  renderer.setSize(viewW, viewH, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.domElement.className = 'map-selected-preview-canvas';
  host.replaceChildren(renderer.domElement);

  const aspect = viewW / Math.max(1, viewH);
  const topDownHalfHeight = (nextAspect) => Math.max(
    tileSize * 0.55,
    size.z * 0.55,
    (size.x * 0.55) / Math.max(0.01, nextAspect),
  );
  const halfH = topDownHalfHeight(aspect);
  const camera = new THREE.OrthographicCamera(-halfH * aspect, halfH * aspect, halfH, -halfH, 0.1, maxDim * 16);
  camera.position.set(0, maxDim * 4, 0);
  camera.up.set(0, 0, -1);
  camera.lookAt(0, 0, 0);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enableRotate = false;
  controls.enablePan = false;
  controls.minZoom = 0.35;
  controls.maxZoom = 6;
  controls.target.set(0, 0, 0);
  controls.update();

  const renderFrame = () => {
    if (disposed) return;
    controls.update();
    renderer.render(scene, camera);
  };

  const tick = (now) => {
    if (disposed) return;
    if (previewVisible && now - lastAnimatedRender >= 1000 / 30) {
      lastAnimatedRender = now;
      renderFrame();
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  const onResize = () => {
    if (disposed) return;
    const w = Math.max(180, Math.round(host.clientWidth || viewW));
    const h = Math.max(140, Math.round(host.clientHeight || viewH));
    const nextAspect = w / Math.max(1, h);
    const nextHalfH = topDownHalfHeight(nextAspect);
    camera.left = -nextHalfH * nextAspect;
    camera.right = nextHalfH * nextAspect;
    camera.top = nextHalfH;
    camera.bottom = -nextHalfH;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);
    renderFrame();
  };

  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(onResize);
    resizeObserver.observe(host);
  } else {
    window.addEventListener('resize', onResize);
  }
  if (typeof IntersectionObserver !== 'undefined') {
    intersectionObserver = new IntersectionObserver((entries) => {
      previewVisible = entries.some((entry) => entry.isIntersecting);
    });
    intersectionObserver.observe(host);
  }

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(raf);
    controls.dispose();
    if (resizeObserver) resizeObserver.disconnect();
    else window.removeEventListener('resize', onResize);
    intersectionObserver?.disconnect();
    renderer.dispose();
    disposeRtpksObject(root);
    if (host.isConnected) host.replaceChildren();
  };

  return { dispose, refresh: renderFrame };
}

function collectMaterialTextures(root) {
  const textures = new Set();
  root.traverse((obj) => {
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const mat of mats) {
      if (mat?.map) textures.add(mat.map);
    }
  });
  return [...textures];
}

function waitForTexture(texture, timeoutMs = 8000) {
  if (!texture) return Promise.resolve();
  if (texture.image?.complete && texture.image.naturalWidth > 0) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => resolve();
    const timer = setTimeout(done, timeoutMs);
    const onUpdate = () => {
      if (texture.image?.complete && texture.image.naturalWidth > 0) {
        clearTimeout(timer);
        texture.removeEventListener?.('update', onUpdate);
        done();
      }
    };
    texture.addEventListener?.('update', onUpdate);
    onUpdate();
  });
}

async function waitForObjectTextures(root) {
  await Promise.all(collectMaterialTextures(root).map((tex) => waitForTexture(tex)));
}

function disposeExportObject3D(root) {
  root.traverse((obj) => {
    obj.geometry?.dispose?.();
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const mat of mats) {
      if (mat) mat.map = null;
      mat?.dispose?.();
    }
  });
}

/**
 * Build and download a GLB for one RTPKS tile (same geometry/materials as the sidebar preview).
 * @returns {Promise<string>} suggested download filename
 */
export async function downloadRtpksTileGlb(fileName, packageInfo, resortTileId, options = {}) {
  if (!fileName || resortTileId == null) throw new Error('Tile package and id are required.');
  const tileSize = Math.max(8, Number(options.tileSize || 32));
  const root = await buildRtpksTileTemplate(fileName, packageInfo, resortTileId, tileSize);
  try {
    await waitForObjectTextures(root);
    const exporter = new GLTFExporter();
    const buffer = await new Promise((resolve, reject) => {
      exporter.parse(
        root,
        (result) => {
          if (result instanceof ArrayBuffer) resolve(result);
          else reject(new Error('GLB export produced JSON instead of binary.'));
        },
        (err) => reject(err || new Error('GLB export failed.')),
        { binary: true },
      );
    });
    const packBase = String(fileName).replace(/\.rtpks$/i, '').replace(/^.*[/\\]/, '') || 'tilepack';
    const downloadName = `${packBase}_tile_${Number(resortTileId)}.glb`;
    const blob = new Blob([buffer], { type: 'model/gltf-binary' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = downloadName;
    anchor.click();
    URL.revokeObjectURL(url);
    return downloadName;
  } finally {
    disposeExportObject3D(root);
  }
}

async function addRtpksTiles(scene, map, tileSize, packageInfo, fileName, disposedRef) {
  const layers = visibleTileLayers(map);
  if (!layers?.length) return;

  // A map commonly places the same handful of tiles hundreds of times. Resolve
  // each distinct mesh once up front so the placement loop stays synchronous;
  // awaiting the cache once per cell made large animated-water maps feel hung.
  const tileIds = new Set();
  for (const { layer } of layers) {
    for (const row of (layer?.cells || [])) {
      for (const id of (row || [])) {
        if (id == null || id === '') continue;
        const resortTileId = Number(id);
        if (Number.isFinite(resortTileId)) tileIds.add(resortTileId);
      }
    }
  }
  const meshEntries = await Promise.all([...tileIds].map(async (resortTileId) => (
    [resortTileId, await loadRtpksMesh(fileName, resortTileId)]
  )));
  if (disposedRef.disposed) return;
  const meshesByTileId = new Map(meshEntries);

  // Start the small set of texture downloads before assembling the combined
  // geometry. This lets image decoding overlap the CPU work and avoids showing
  // a black ocean while the final batches are being created.
  const usedMaterialIds = new Set();
  for (const meshPayload of meshesByTileId.values()) {
    const ranges = Array.isArray(meshPayload.materialRanges) && meshPayload.materialRanges.length
      ? meshPayload.materialRanges
      : [{ materialId: meshPayload.textureIds?.[0] ?? 0 }];
    for (const range of ranges) usedMaterialIds.add(Number(range.materialId));
  }
  const materialsById = new Map([...usedMaterialIds].map((materialId) => (
    [materialId, materialForRtpks(fileName, packageInfo, materialId)]
  )));

  const group = new THREE.Group();
  group.name = 'rtpks_tile_layer';
  scene.add(group);
  const batches = new Map();
  for (const { layer, index } of layers) {
    if (!layer?.cells?.length) continue;
    for (let z = 0; z < map.grid.height; z += 1) {
      for (let x = 0; x < map.grid.width; x += 1) {
        const id = layer.cells?.[z]?.[x];
        if (id == null || id === '') continue;
        const resortTileId = Number(id);
        if (!Number.isFinite(resortTileId)) continue;
        const meshPayload = meshesByTileId.get(resortTileId);
        if (!meshPayload) continue;
        const placement = {
          map,
          x,
          z,
          layerLift: index * DECORATION_LAYER_Y_EPSILON,
          conformToTerrain: meshVerticalRange(meshPayload) <= 0.02,
          baseY: terrainFloorBaseAtTile(map, x, z, tileSize),
        };
        const ranges = Array.isArray(meshPayload.materialRanges) && meshPayload.materialRanges.length
          ? meshPayload.materialRanges
          : [{ materialId: meshPayload.textureIds?.[0] ?? 0, triStart: 0, triCount: (meshPayload.triangles || []).length / 9, quadStart: 0, quadCount: (meshPayload.quads || []).length / 12 }];
        for (const range of ranges) {
          const materialMeta = (packageInfo.materials || []).find((mat) => Number(mat.materialId) === Number(range.materialId));
          const geometry = buildRangeGeometry(meshPayload, range, tileSize, placement, materialMeta?.uvMapping);
          if (!geometry) continue;
          const batch = batches.get(Number(range.materialId)) || { positions: [], uvs: [], colors: [] };
          for (const value of geometry.getAttribute('position').array) batch.positions.push(value);
          for (const value of geometry.getAttribute('uv').array) batch.uvs.push(value);
          for (const value of geometry.getAttribute('color').array) batch.colors.push(value);
          batches.set(Number(range.materialId), batch);
          geometry.dispose();
        }
      }
    }
  }
  for (const [materialId, batch] of batches) {
    if (!batch.positions.length) continue;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(batch.positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(batch.uvs, 2));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(batch.colors, 3));
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, materialsById.get(materialId));
    const materialMeta = (packageInfo.materials || []).find((mat) => Number(mat.materialId) === Number(materialId));
    mesh.renderOrder = Number(materialMeta?.renderOrder) || 0;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    group.add(mesh);
  }
}

/**
 * Mount a view-only 3D scene of the current map into `host`.
 * @param {HTMLElement} host
 * @param {object} map editor map (grid + terrain + models)
 * @param {Array} catalog model catalog (for footprint/hash → asset url)
 * @param {object} opts { modelUrl(id, meta) }
 * @returns {{ dispose():void }}
 */
export function mountMap3DView(host, map, catalog = [], opts = {}) {
  if (!host || !map) return { dispose() {} };
  host.innerHTML = '';
  let disposed = false;
  const disposedRef = { disposed: false };
  let raf = 0;

  const tileSize = map.grid?.tileSize || 16;
  const w = map.grid.width;
  const h = map.grid.height;
  const cx = (w * tileSize) / 2;
  const cz = (h * tileSize) / 2;
  const span = Math.max(w, h) * tileSize;

  const viewW = Math.max(320, Math.round(host.clientWidth || 640));
  const viewH = Math.max(320, Math.round(host.clientHeight || 520));
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(dpr);
  renderer.setSize(viewW, viewH);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const lightCfg = lightingPresetConfig(map.terrainVisual || {});
  scene.background = new THREE.Color(lightCfg.bg);

  const camera = new THREE.PerspectiveCamera(45, viewW / viewH, 0.1, span * 12);
  camera.position.set(cx + span * 0.7, span * 0.85, cz + span * 0.9);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.target.set(cx, tileSize, cz);
  controls.maxPolarAngle = Math.PI * 0.49; // keep above the horizon
  controls.minDistance = tileSize * 2;
  controls.maxDistance = span * 6;
  controls.update();

  scene.add(new THREE.HemisphereLight(0xffffff, lightCfg.ground, lightCfg.hemi));
  const key = new THREE.DirectionalLight(lightCfg.color, lightCfg.key);
  const customYaw = Number(map.terrainVisual?.lightYawDeg);
  const customPitch = Number(map.terrainVisual?.lightPitchDeg);
  const yaw = (Number.isFinite(customYaw) ? customYaw : lightCfg.yaw) * Math.PI / 180;
  const pitch = (Number.isFinite(customPitch) ? customPitch : lightCfg.pitch) * Math.PI / 180;
  const lightDist = span * 1.6;
  key.position.set(
    Math.sin(yaw) * Math.cos(pitch) * lightDist,
    Math.sin(pitch) * lightDist,
    Math.cos(yaw) * Math.cos(pitch) * lightDist,
  );
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xfff0e0, lightCfg.fill);
  fill.position.set(-span * 0.6, span * 0.8, -span);
  scene.add(fill);

  scene.add(buildTerrain(map, tileSize, opts.tilePackage || null));

  const tilePackageFile = map.tilePackage?.file || opts.tilePackage?.fileName;
  if (tilePackageFile) {
    loadRtpksPackage(tilePackageFile)
      .then((packageInfo) => addRtpksTiles(scene, map, tileSize, packageInfo, tilePackageFile, disposedRef))
      .catch(() => { /* RTPKS preview is optional; bad packages should not kill the 3D view */ });
  }

  const modelUrl = opts.modelUrl || ((id) => `/api/overworld-models/glb?id=${encodeURIComponent(id)}`);
  const props = new THREE.Group();
  scene.add(props);
  for (const mdl of (map.models || [])) {
    const meta = (catalog || []).find((c) => c.id === mdl.id);
    const url = modelUrl(mdl.id, meta);
    loadGlbScene(url)
      .then((obj) => {
        if (disposed) return;
        const g = new THREE.Group();
        g.add(obj);
        g.position.set(mdl.position?.[0] ?? 0, mdl.position?.[1] ?? 0, mdl.position?.[2] ?? 0);
        g.rotation.y = ((mdl.yawDeg || 0) * Math.PI) / 180;
        const s = mdl.scale || 1;
        g.scale.set(s, s, s);
        props.add(g);
      })
      .catch(() => { /* a missing/broken asset just doesn't appear; not fatal for preview */ });
  }

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    disposedRef.disposed = true;
    cancelAnimationFrame(raf);
    ro.disconnect();
    controls.dispose();
    renderer.dispose();
    if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
  };

  const tick = () => {
    if (disposed) return;
    // If the host canvas was detached (tab switch / re-render) stop the loop and free GL.
    if (!renderer.domElement.isConnected) { dispose(); return; }
    controls.update();
    renderer.render(scene, camera);
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  const onResize = () => {
    if (disposed) return;
    const nw = Math.max(320, Math.round(host.clientWidth || viewW));
    const nh = Math.max(320, Math.round(host.clientHeight || viewH));
    renderer.setSize(nw, nh);
    camera.aspect = nw / nh;
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(onResize);
  ro.observe(host);

  return { dispose };
}
