import { createHash } from 'node:crypto';
import { unzipSync, zipSync, strToU8 } from 'fflate';
import { parseGlb, buildMeshFromGltf } from './glb-compile.mjs';

const TILE_SIZE = 16;
const TILE_BUNDLE_FORMAT = 'pokemon_resort.tile';
const TILE_BUNDLE_VERSION = 1;

function jsonBytes(value) {
  return strToU8(`${JSON.stringify(value, null, 2)}\n`);
}

function readJson(entries, path) {
  const bytes = entries[path];
  if (!bytes) throw new Error(`Tile pack is missing ${path}.`);
  return JSON.parse(Buffer.from(bytes).toString('utf8'));
}

function safeBundlePath(value, label) {
  const path = String(value || '').replace(/\\/g, '/').replace(/^\.\//, '');
  if (!path || path.startsWith('/') || path.split('/').includes('..')) {
    throw new Error(`Tile bundle has an unsafe ${label} path.`);
  }
  return path;
}

function decodeTileBundle(bundleBuffer) {
  const entries = unzipSync(new Uint8Array(bundleBuffer));
  const paths = Object.keys(entries);
  if (paths.length > 4096) throw new Error('Tile bundle contains too many files.');
  const expandedBytes = paths.reduce((total, path) => total + entries[path].byteLength, 0);
  if (expandedBytes > 320_000_000) throw new Error('Tile bundle expands beyond the 320 MB limit.');
  const manifest = readJson(entries, 'manifest.json');
  if (manifest.format !== TILE_BUNDLE_FORMAT || Number(manifest.version) !== TILE_BUNDLE_VERSION) {
    throw new Error(`Unsupported tile bundle. Expected ${TILE_BUNDLE_FORMAT} v${TILE_BUNDLE_VERSION}.`);
  }
  const modelPath = safeBundlePath(manifest.model?.path, 'model');
  const glb = entries[modelPath];
  if (!glb?.length || !/\.glb$/i.test(modelPath)) throw new Error('Tile bundle model must point to an embedded GLB file.');
  const animations = (manifest.materials?.animations || []).map((raw, index) => {
    const material = String(raw?.material || '').trim();
    if (!material) throw new Error(`Tile bundle animation ${index + 1} has no material name.`);
    const framePaths = (raw.frames || []).map((path) => safeBundlePath(path, 'animation frame'));
    if (framePaths.length < 2) throw new Error(`Tile bundle animation for ${material} needs at least two frames.`);
    const frames = framePaths.map((path) => {
      const bytes = entries[path];
      if (!bytes?.length) throw new Error(`Tile bundle is missing animation frame ${path}.`);
      return { path, bytes };
    });
    return {
      material,
      type: 'frames',
      frames,
      frameDurationMs: finiteInt(raw.frameDurationMs, 150, 16, 10000),
      loop: raw.loop !== false,
      phase: ['global', 'position', 'random'].includes(raw.phase) ? raw.phase : 'global',
      state: String(raw.state || 'play'),
    };
  });
  return { entries, manifest, glb, animations };
}

export function inspectTileBundle(bundleBuffer) {
  const bundle = decodeTileBundle(bundleBuffer);
  const { json, bin } = parseGlb(bundle.glb);
  const compiled = buildMeshFromGltf(bundle.manifest.name || 'tile', json, bin);
  const defaults = bundle.manifest.defaults || {};
  const animatedMaterials = bundle.animations.map((animation) => ({
    material: animation.material,
    frameCount: animation.frames.length,
    frameDurationMs: animation.frameDurationMs,
    loop: animation.loop,
  }));
  return {
    format: bundle.manifest.format,
    version: bundle.manifest.version,
    name: String(bundle.manifest.name || 'Imported tile'),
    source: bundle.manifest.source || {},
    width: finiteInt(defaults.width, compiled.footprint.w, 1, 32),
    height: finiteInt(defaults.height, compiled.footprint.d, 1, 32),
    renderMode: ['opaque', 'cutout', 'blend'].includes(defaults.renderMode) ? defaults.renderMode : 'cutout',
    tags: normalizeTags(defaults.tags),
    properties: defaults.properties && typeof defaults.properties === 'object' ? defaults.properties : {},
    collision: defaults.collision || { mode: 'none', autoApply: false },
    materialCount: compiled.materials.length,
    animatedMaterials,
    glbAnimationClips: Array.isArray(json.animations) ? json.animations.map((animation) => String(animation?.name || 'Animation')) : [],
  };
}

function safeId(value, fallback = 'item') {
  return String(value || fallback).trim().toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || fallback;
}

function finiteInt(value, fallback, min = 0, max = 4096) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.round(parsed))) : fallback;
}

function normalizeTags(tags) {
  const values = Array.isArray(tags) ? tags : String(tags || '').split(',');
  return [...new Set(values.map((tag) => String(tag).trim().toLowerCase()).filter(Boolean))];
}

function normalizeAnimation(animation) {
  const type = ['none', 'frames', 'uvScroll', 'sway'].includes(animation?.type) ? animation.type : 'none';
  if (type === 'none') return { type: 'none' };
  if (type === 'frames') {
    return {
      type,
      frameDurationMs: finiteInt(animation.frameDurationMs, 180, 16, 10000),
      columns: finiteInt(animation.columns, 1, 1, 64),
      rows: finiteInt(animation.rows, 1, 1, 64),
      frameCount: finiteInt(animation.frameCount, 1, 1, 4096),
      phase: ['global', 'position', 'random'].includes(animation.phase) ? animation.phase : 'global',
      loop: animation.loop !== false,
    };
  }
  if (type === 'uvScroll') {
    return { type, speedU: Number(animation.speedU) || 0, speedV: Number(animation.speedV) || 0 };
  }
  return {
    type,
    amplitude: Math.max(0, Number(animation.amplitude) || 0.04),
    frequency: Math.max(0.01, Number(animation.frequency) || 1.2),
    phase: ['global', 'position', 'random'].includes(animation.phase) ? animation.phase : 'position',
  };
}

function normalizeCollision(collision, width, height) {
  const mode = ['none', 'footprint', 'mask'].includes(collision?.mode) ? collision.mode : 'none';
  let mask = Array.isArray(collision?.mask) ? collision.mask : [];
  mask = Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => Boolean(mask?.[y]?.[x])));
  return {
    mode,
    autoApply: collision?.autoApply !== false && mode !== 'none',
    clearOnErase: collision?.clearOnErase === true,
    mask,
  };
}

function normalizeTabs(tabs, tileIds = []) {
  const used = new Set();
  const out = (Array.isArray(tabs) ? tabs : []).map((tab, index) => {
    let id = safeId(tab.id || tab.name, `tab_${index + 1}`);
    while (used.has(id)) id = `${id}_${index + 1}`;
    used.add(id);
    return {
      id,
      name: String(tab.name || id).trim() || id,
      order: index,
      tileIds: [...new Set((tab.tileIds || []).map(Number).filter(Number.isFinite))],
    };
  });
  if (!out.length) out.push({ id: 'default', name: 'Default', order: 0, tileIds: [] });
  const assigned = new Set(out.flatMap((tab) => tab.tileIds));
  for (const id of tileIds) if (!assigned.has(id)) out[0].tileIds.push(id);
  return out;
}

function normalizeSmartSets(sets) {
  return (Array.isArray(sets) ? sets : []).map((set, index) => {
    const width = finiteInt(set.width, 5, 1, 12);
    const height = finiteInt(set.height, 3, 1, 12);
    const source = Array.isArray(set.grid) ? set.grid : [];
    return {
      id: safeId(set.id || set.name, `path_${index + 1}`),
      name: String(set.name || `Path ${index + 1}`).trim(),
      width,
      height,
      grid: Array.from({ length: width }, (_, x) => Array.from({ length: height }, (_, y) => {
        const id = Number(source?.[x]?.[y]);
        return Number.isFinite(id) && id >= 0 ? id : -1;
      })),
    };
  });
}

function tileDefinition(metaTile, runtimeTile = {}) {
  const width = finiteInt(metaTile.width ?? runtimeTile.width, 1, 1, 32);
  const height = finiteInt(metaTile.height ?? runtimeTile.height, 1, 1, 32);
  return {
    ...metaTile,
    resortTileId: Number(metaTile.resortTileId),
    name: String(metaTile.name || metaTile.key || `Tile ${metaTile.resortTileId}`),
    width,
    height,
    tags: normalizeTags(metaTile.tags || runtimeTile.tags),
    properties: metaTile.properties && typeof metaTile.properties === 'object' ? metaTile.properties : (runtimeTile.properties || {}),
    animation: normalizeAnimation(metaTile.animation || runtimeTile.animation),
    collision: normalizeCollision(metaTile.collision || runtimeTile.collision, width, height),
  };
}

export function loadEditableTilePack(packBuffer, metaBuffer) {
  const entries = unzipSync(new Uint8Array(packBuffer));
  const metaEntries = unzipSync(new Uint8Array(metaBuffer));
  const manifest = readJson(entries, 'manifest.json');
  const tileIndex = readJson(entries, manifest.tileIndex || 'index/tile_index.json');
  const tileTabs = readJson(entries, manifest.tileTabs || 'index/tile_tabs.json');
  const runtime = readJson(entries, 'runtime/manifest.json');
  const metaManifest = readJson(metaEntries, 'manifest.json');
  const editorMeta = readJson(metaEntries, metaManifest.tileMetadata || 'editor/tile_metadata.json');
  const runtimeById = new Map((runtime.tiles || []).map((tile) => [Number(tile.resortTileId), tile]));
  const activeIds = (tileIndex.entries || []).filter((entry) => !entry.status || entry.status === 'active').map((entry) => Number(entry.resortTileId));
  const tiles = (editorMeta.tiles || []).filter((tile) => activeIds.includes(Number(tile.resortTileId)))
    .map((tile) => tileDefinition(tile, runtimeById.get(Number(tile.resortTileId))));
  return {
    entries,
    metaEntries,
    manifest,
    tileIndex,
    tileTabs,
    runtime,
    metaManifest,
    editorMeta,
    document: {
      packId: manifest.packId || runtime.packId || editorMeta.packId || 'tile_pack',
      name: manifest.name || editorMeta.name || manifest.packId || 'Tile Pack',
      tabs: normalizeTabs(editorMeta.tabs || tileTabs.tabs, activeIds),
      tiles,
      smartSets: normalizeSmartSets(editorMeta.smartSets),
    },
  };
}

function syncDefinitions(pack, document) {
  const ids = (pack.tileIndex.entries || []).filter((entry) => !entry.status || entry.status === 'active').map((entry) => Number(entry.resortTileId));
  document.tabs = normalizeTabs(document.tabs, ids);
  document.smartSets = normalizeSmartSets(document.smartSets);
  const inputById = new Map((document.tiles || []).map((tile) => [Number(tile.resortTileId), tile]));
  const runtimeById = new Map((pack.runtime.tiles || []).map((tile) => [Number(tile.resortTileId), tile]));
  pack.editorMeta.tiles = (pack.editorMeta.tiles || []).map((old) => {
    const update = inputById.get(Number(old.resortTileId));
    if (!update) return old;
    const next = tileDefinition({ ...old, ...update }, runtimeById.get(Number(old.resortTileId)));
    next.tabId = document.tabs.find((tab) => tab.tileIds.includes(next.resortTileId))?.id || document.tabs[0].id;
    return next;
  });
  pack.runtime.tiles = (pack.runtime.tiles || []).map((old) => {
    const authored = inputById.get(Number(old.resortTileId));
    if (!authored) return old;
    const normalized = tileDefinition(authored, old);
    return { ...old, name: normalized.name, tags: normalized.tags, properties: normalized.properties, animation: normalized.animation, collision: normalized.collision };
  });
  for (const authored of document.tiles || []) {
    const animation = normalizeAnimation(authored.animation);
    if (animation.type !== 'frames') continue;
    const meshBytes = pack.entries[`runtime/meshes/tile_${Number(authored.resortTileId)}.json`];
    if (!meshBytes) continue;
    const mesh = JSON.parse(Buffer.from(meshBytes).toString('utf8'));
    const materialIds = [...new Set((mesh.materialRanges || []).map((range) => Number(range.materialId)).filter(Number.isFinite))];
    for (const material of pack.runtime.materials || []) {
      if (materialIds.includes(Number(material.materialId)) && material.animation?.type === 'frames') {
        material.animation.frameDurationMs = animation.frameDurationMs;
        material.animation.phase = animation.phase;
        material.animation.loop = animation.loop;
      }
    }
  }
  pack.tileTabs.tabs = document.tabs;
  pack.editorMeta.tabs = document.tabs;
  pack.editorMeta.smartSets = document.smartSets;
  pack.manifest.name = String(document.name || pack.manifest.name || document.packId).trim();
  pack.editorMeta.name = pack.manifest.name;
}

function writePack(pack) {
  pack.entries['manifest.json'] = jsonBytes(pack.manifest);
  pack.entries[pack.manifest.tileIndex || 'index/tile_index.json'] = jsonBytes(pack.tileIndex);
  pack.entries[pack.manifest.tileTabs || 'index/tile_tabs.json'] = jsonBytes(pack.tileTabs);
  pack.entries['runtime/manifest.json'] = jsonBytes(pack.runtime);
  const packBytes = Buffer.from(zipSync(pack.entries, { level: 6 }));
  pack.metaManifest.sourceSha256 = createHash('sha256').update(packBytes).digest('hex');
  pack.metaEntries['manifest.json'] = jsonBytes(pack.metaManifest);
  pack.metaEntries[pack.metaManifest.tileMetadata || 'editor/tile_metadata.json'] = jsonBytes(pack.editorMeta);
  const metaBytes = Buffer.from(zipSync(pack.metaEntries, { level: 6 }));
  return { packBytes, metaBytes };
}

export function saveTilePackDocument(packBuffer, metaBuffer, document) {
  const pack = loadEditableTilePack(packBuffer, metaBuffer);
  syncDefinitions(pack, structuredClone(document));
  return writePack(pack);
}

function nextId(values) {
  return values.reduce((max, value) => Math.max(max, Number(value) || 0), -1) + 1;
}

function planeMesh(width, height, materialId, animation) {
  const cols = animation?.type === 'frames' ? Math.max(1, animation.columns) : 1;
  const rows = animation?.type === 'frames' ? Math.max(1, animation.rows) : 1;
  const umax = 1 / cols;
  const vmin = 1 - (1 / rows);
  return {
    width, height, xOffset: 0, yOffset: 0,
    triangles: [],
    quads: [0, height, 0, width, height, 0, width, 0, 0, 0, 0, 0],
    texCoordsTri: [],
    texCoordsQuad: [0, vmin, umax, vmin, umax, 1, 0, 1],
    colorsTri: [], colorsQuad: Array(12).fill(1), textureIds: [materialId],
    materialRanges: [{ materialId, triStart: 0, triCount: 0, quadStart: 0, quadCount: 1 }],
  };
}

function glbMeshPayload(compiled, materialIds) {
  const groups = materialIds.map(() => []);
  for (let tri = 0; tri < compiled.triangleCount; tri += 1) {
    const material = compiled.triangleMaterials[tri] || 0;
    groups[Math.min(groups.length - 1, material)].push(tri);
  }
  const triangles = [];
  const uvs = [];
  const colors = [];
  const ranges = [];
  let triStart = 0;
  for (let slot = 0; slot < groups.length; slot += 1) {
    for (const tri of groups[slot]) {
      for (let corner = 0; corner < 3; corner += 1) {
        const vi = compiled.indices[tri * 3 + corner] * 8;
        const x = (compiled.vertices[vi] - compiled.aabb.min[0]) / TILE_SIZE;
        const z = (compiled.vertices[vi + 2] - compiled.aabb.min[2]) / TILE_SIZE;
        const y = (compiled.vertices[vi + 1] - compiled.aabb.min[1]) / TILE_SIZE;
        triangles.push(x, compiled.footprint.d - z, y);
        uvs.push(compiled.vertices[vi + 6], compiled.vertices[vi + 7]);
        colors.push(1, 1, 1);
      }
    }
    if (groups[slot].length) {
      ranges.push({ materialId: materialIds[slot], triStart, triCount: groups[slot].length, quadStart: 0, quadCount: 0 });
      triStart += groups[slot].length;
    }
  }
  return {
    width: compiled.footprint.w, height: compiled.footprint.d, xOffset: 0, yOffset: 0,
    triangles, quads: [], texCoordsTri: uvs, texCoordsQuad: [], colorsTri: colors, colorsQuad: [],
    textureIds: materialIds, materialRanges: ranges,
  };
}

export function addTileToPack(packBuffer, metaBuffer, definition, assets) {
  const pack = loadEditableTilePack(packBuffer, metaBuffer);
  const bundle = assets.tileBundle?.length ? decodeTileBundle(assets.tileBundle) : null;
  const bundleDefaults = bundle?.manifest?.defaults || {};
  const definitionInput = definition || {};
  const tileInput = {
    ...bundleDefaults,
    ...definitionInput,
    name: definitionInput.name || bundle?.manifest?.name || bundleDefaults.name,
    tags: definitionInput.tags?.length ? definitionInput.tags : bundleDefaults.tags,
    properties: { ...(bundleDefaults.properties || {}), ...(definitionInput.properties || {}) },
    collision: definitionInput.collision || bundleDefaults.collision,
  };
  const tileAssets = bundle
    ? { ...assets, glb: bundle.glb, materialAnimations: bundle.animations }
    : assets;
  const resortTileId = nextId((pack.tileIndex.entries || []).map((entry) => entry.resortTileId));
  const localIndex = nextId((pack.tileIndex.entries || []).map((entry) => entry.localIndex));
  const tabId = pack.document.tabs.some((tab) => tab.id === tileInput.tabId) ? tileInput.tabId : pack.document.tabs[0].id;
  const key = safeId(tileInput.key || tileInput.name, `tile_${String(resortTileId).padStart(4, '0')}`);
  let animation = normalizeAnimation(tileInput.animation);
  let width = finiteInt(tileInput.width, 1, 1, 32);
  let height = finiteInt(tileInput.height, 1, 1, 32);
  let mesh;
  const materials = [];
  const textureRecords = [];
  const nextMaterial = nextId((pack.runtime.materials || []).map((mat) => mat.materialId));

  if (tileAssets.glb?.length) {
    const { json, bin } = parseGlb(tileAssets.glb);
    const compiled = buildMeshFromGltf(key, json, bin);
    width = finiteInt(tileInput.width, compiled.footprint.w, 1, 32);
    height = finiteInt(tileInput.height, compiled.footprint.d, 1, 32);
    const materialIds = compiled.materials.map((_, index) => nextMaterial + index);
    mesh = glbMeshPayload(compiled, materialIds);
    const animationByMaterial = new Map((tileAssets.materialAnimations || []).map((item) => [String(item.material).toLowerCase(), item]));
    const compiledMaterialNames = new Set(compiled.materials.map((item) => String(item.name || '').toLowerCase()));
    const missingAnimationMaterials = [...animationByMaterial.keys()].filter((name) => !compiledMaterialNames.has(name));
    if (missingAnimationMaterials.length) {
      throw new Error(`Tile bundle animation material was not found in the GLB: ${missingAnimationMaterials.join(', ')}.`);
    }
    compiled.materials.forEach((source, index) => {
      const frameAnimation = animationByMaterial.get(String(source.name || '').toLowerCase());
      if (frameAnimation) {
        const frameNames = frameAnimation.frames.map((frame, frameIndex) => {
          const sourceExt = String(frame.path || '').toLowerCase().match(/\.(png|jpe?g)$/)?.[1] || 'png';
          const ext = sourceExt === 'jpeg' ? 'jpg' : sourceExt;
          const textureName = `${key}_${resortTileId}_mat${index}_frame_${String(frameIndex).padStart(3, '0')}.${ext}`;
          pack.entries[`runtime/textures/${textureName}`] = new Uint8Array(frame.bytes);
          textureRecords.push({ name: textureName, path: `runtime/textures/${textureName}` });
          return textureName;
        });
        materials.push({
          materialId: materialIds[index],
          name: source.name || `${key}_mat${index}`,
          textureName: frameNames[0],
          alpha: tileInput.renderMode === 'blend' ? 24 : 31,
          animation: {
            type: 'frames',
            frameDurationMs: frameAnimation.frameDurationMs,
            phase: frameAnimation.phase,
            loop: frameAnimation.loop,
            frames: frameNames,
          },
        });
        return;
      }
      const texture = compiled.textures[source.textureIndex] || compiled.textures[0];
      const ext = texture.format === 'jpeg' ? 'jpg' : 'png';
      const textureName = `${key}_${resortTileId}_mat${index}.${ext}`;
      pack.entries[`runtime/textures/${textureName}`] = new Uint8Array(texture.bytes);
      materials.push({ materialId: materialIds[index], name: source.name || `${key}_mat${index}`, textureName, alpha: tileInput.renderMode === 'blend' ? 24 : 31 });
      textureRecords.push({ name: textureName, path: `runtime/textures/${textureName}` });
    });
    const bundleAnimations = tileAssets.materialAnimations || [];
    if (bundleAnimations.length) {
      const primary = bundleAnimations[0];
      animation = normalizeAnimation({
        type: 'frames',
        frameDurationMs: primary.frameDurationMs,
        frameCount: Math.max(...bundleAnimations.map((item) => item.frames.length)),
        columns: 1,
        rows: 1,
        phase: primary.phase,
        loop: primary.loop,
      });
    }
  } else if (tileAssets.frames?.length) {
    const materialId = nextMaterial;
    const frameNames = tileAssets.frames.map((bytes, index) => {
      const textureName = `${key}_${resortTileId}_frame_${String(index).padStart(3, '0')}.png`;
      pack.entries[`runtime/textures/${textureName}`] = new Uint8Array(bytes);
      textureRecords.push({ name: textureName, path: `runtime/textures/${textureName}` });
      return textureName;
    });
    materials.push({
      materialId, name: key, textureName: frameNames[0], alpha: tileInput.renderMode === 'blend' ? 24 : 31,
      animation: { type: 'frames', frameDurationMs: animation.frameDurationMs, phase: animation.phase, loop: animation.loop, frames: frameNames },
    });
    mesh = planeMesh(width, height, materialId, { type: 'none' });
    animation.frameCount = frameNames.length;
    animation.columns = 1;
    animation.rows = 1;
  } else if (tileAssets.texture?.length) {
    const materialId = nextMaterial;
    const extension = String(tileAssets.textureName || '').toLowerCase().endsWith('.jpg') ? 'jpg' : 'png';
    const textureName = `${key}_${resortTileId}.${extension}`;
    pack.entries[`runtime/textures/${textureName}`] = new Uint8Array(tileAssets.texture);
    materials.push({ materialId, name: key, textureName, alpha: tileInput.renderMode === 'blend' ? 24 : 31 });
    textureRecords.push({ name: textureName, path: `runtime/textures/${textureName}` });
    mesh = planeMesh(width, height, materialId, animation);
  } else {
    throw new Error('Choose a PNG/JPG spritesheet or a textured GLB tile.');
  }

  mesh.width = width;
  mesh.height = height;

  const collision = normalizeCollision(tileInput.collision, width, height);
  const authored = tileDefinition({
    resortTileId, localIndex, key, name: tileInput.name || key, tabId, width, height,
    xOffset: 0, yOffset: 0, xTileable: false, yTileable: false, uTileable: false, vTileable: false,
    globalTexMapping: false, globalTexScale: 1, tags: tileInput.tags, properties: tileInput.properties || {},
    animation, collision,
  });
  pack.tileIndex.entries.push({ localIndex, resortTileId, key, status: 'active' });
  pack.runtime.materials.push(...materials);
  pack.runtime.textures = [...(pack.runtime.textures || []), ...textureRecords];
  pack.runtime.tiles.push({
    resortTileId, localIndex, width, height, materialCount: materials.length,
    vertexCount: (mesh.triangles.length / 3) + (mesh.quads.length / 3),
    triangleCount: (mesh.triangles.length / 9) + (mesh.quads.length / 6),
    name: authored.name, tags: authored.tags, properties: authored.properties, animation: authored.animation, collision,
  });
  pack.entries[`runtime/meshes/tile_${resortTileId}.json`] = jsonBytes(mesh);
  pack.editorMeta.tiles.push(authored);
  const tab = pack.document.tabs.find((item) => item.id === tabId);
  tab.tileIds.push(resortTileId);
  pack.document.tiles.push(authored);
  syncDefinitions(pack, pack.document);
  return { ...writePack(pack), resortTileId };
}
