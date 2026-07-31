import { createHash } from 'node:crypto';
import { unzipSync, zipSync, strToU8 } from 'fflate';
import { parseGlb, buildMeshFromGltf, materialSamplerRecords } from './glb-compile.mjs';

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

function legacyNdsMotionSemantics(material) {
  return ({
    sea_zanami2: { renderOrder: 20, layerRole: 'shoreline-underlay' },
    sea_simi_1: { renderOrder: 21, layerRole: 'shoreline-wet-sand' },
    sea_zanami: { renderOrder: 22, layerRole: 'shoreline-crest' },
    sea_mizu1: { renderOrder: 10, layerRole: 'water-lower' },
    sea_mizu1_1: { renderOrder: 11, layerRole: 'water-upper' },
  })[String(material || '').toLowerCase()] || { renderOrder: 0, layerRole: 'surface' };
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
  const parsedGlb = parseGlb(glb);
  const glbDocument = parsedGlb.json;
  const materialSamplers = materialSamplerRecords(glbDocument);
  const animations = (manifest.materials?.animations || []).map((raw, index) => {
    const material = String(raw?.material || '').trim();
    if (!material) throw new Error(`Tile bundle animation ${index + 1} has no material name.`);
    const type = raw?.type === 'materialMotion' ? 'materialMotion' : 'frames';
    if (type === 'materialMotion') {
      const legacySemantics = legacyNdsMotionSemantics(material);
      const offsets = (raw.offsets || []).map((value) => [Number(value?.[0]), Number(value?.[1])])
        .filter((value) => value.every(Number.isFinite));
      const imageKeyframes = (raw.imageKeyframes || []).map((keyframe, keyframeIndex) => {
        const path = safeBundlePath(keyframe?.path, 'material image keyframe');
        const bytes = entries[path];
        if (!bytes?.length) throw new Error(`Tile bundle is missing material image keyframe ${path}.`);
        return { frame: finiteInt(keyframe?.frame, keyframeIndex, 0, 100000), path, bytes };
      }).sort((a, b) => a.frame - b.frame);
      const frameCount = finiteInt(raw.frameCount, Math.max(offsets.length, Number(raw.imageFrameCount) || 0), 1, 100000);
      if (frameCount < 2 || (offsets.length < 2 && imageKeyframes.length < 2)) {
        throw new Error(`Tile bundle material motion for ${material} needs at least two timeline samples.`);
      }
      return {
        material,
        type,
        offsets,
        imageKeyframes,
        imageFrameCount: finiteInt(raw.imageFrameCount, frameCount, 1, 100000),
        frameCount,
        frameDurationMs: finiteInt(raw.frameDurationMs, 150, 16, 10000),
        timebaseHz: finiteNumber(raw.timebaseHz, Math.round(1000 / finiteInt(raw.frameDurationMs, 150, 16, 10000)), 0.001, 1000),
        sourceTimebaseHz: finiteNumber(raw.sourceTimebaseHz, finiteNumber(raw.timebaseHz, Math.round(1000 / finiteInt(raw.frameDurationMs, 150, 16, 10000)), 0.001, 1000), 0.001, 1000),
        interpolation: raw.interpolation === 'linear' ? 'linear' : 'step',
        renderOrder: finiteInt(raw.renderOrder, legacySemantics.renderOrder, -10000, 10000),
        layerRole: String(raw.layerRole || legacySemantics.layerRole),
        loop: raw.loop !== false,
        phase: ['global', 'position', 'random'].includes(raw.phase) ? raw.phase : 'global',
        state: String(raw.state || 'play'),
      };
    }
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
  const explicitUvTextures = new Set((manifest.materials?.uvTextures || [])
    .filter((item) => item?.coordinateSpace === 'world')
    .map((item) => String(item?.material || '').toLowerCase()).filter(Boolean));
  const motionUvTextures = new Set(animations
    .filter((animation) => animation.type === 'materialMotion' && animation.offsets.length > 1)
    .map((animation) => String(animation.material || '').toLowerCase()));
  const compiledForUv = buildMeshFromGltf(manifest.name || 'tile', glbDocument, parsedGlb.bin);
  const materialUvMappings = compiledForUv.materials
    .filter((material) => material.uvMapping && (
      explicitUvTextures.has(String(material.name || '').toLowerCase())
      || motionUvTextures.has(String(material.name || '').toLowerCase())
    ))
    .map((material) => ({ material: material.name, ...material.uvMapping }));
  let preview = null;
  if (manifest.preview?.path) {
    const path = safeBundlePath(manifest.preview.path, 'preview');
    const bytes = entries[path];
    if (!bytes?.length) throw new Error(`Tile bundle is missing preview image ${path}.`);
    if (bytes.length < 8 || Buffer.from(bytes.subarray(0, 8)).toString('hex') !== '89504e470d0a1a0a') {
      throw new Error('Tile bundle preview must be a PNG image.');
    }
    preview = {
      path,
      bytes,
      projection: manifest.preview.projection === 'orthographic' ? 'orthographic' : String(manifest.preview.projection || ''),
      view: manifest.preview.view === 'top-down' ? 'top-down' : String(manifest.preview.view || ''),
      width: finiteInt(manifest.preview.width, 192, 1, 4096),
      height: finiteInt(manifest.preview.height, 192, 1, 4096),
    };
  }
  return { entries, manifest, glb, animations, materialSamplers, materialUvMappings, preview };
}

export function inspectTileBundle(bundleBuffer) {
  const bundle = decodeTileBundle(bundleBuffer);
  const { json, bin } = parseGlb(bundle.glb);
  const compiled = buildMeshFromGltf(bundle.manifest.name || 'tile', json, bin);
  const defaults = bundle.manifest.defaults || {};
  const animatedMaterials = bundle.animations.map((animation) => ({
    material: animation.material,
    type: animation.type,
    frameCount: animation.frameCount || animation.frames?.length || animation.offsets?.length || 0,
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
    preview: bundle.preview ? {
      available: true,
      projection: bundle.preview.projection,
      view: bundle.preview.view,
      width: bundle.preview.width,
      height: bundle.preview.height,
    } : { available: false },
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

function finiteNumber(value, fallback, min = -Infinity, max = Infinity) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function runtimeMaterialAlpha(renderMode, opacity = 1) {
  if (renderMode !== 'blend') return 31;
  const value = Number(opacity);
  const normalized = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 1;
  return Math.max(0, Math.min(31, Math.round(normalized * 31)));
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
      phase: ['global', 'position', 'random', 'trigger'].includes(animation.phase) ? animation.phase : 'global',
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
      if (materialIds.includes(Number(material.materialId)) && ['frames', 'materialMotion'].includes(material.animation?.type)) {
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

function runtimeTextureIndex(pack) {
  const index = new Map();
  for (const texture of pack.runtime.textures || []) {
    const path = String(texture.path || `runtime/textures/${texture.name || ''}`);
    const bytes = pack.entries[path];
    if (!bytes?.length) continue;
    const hash = createHash('sha256').update(bytes).digest('hex');
    if (!index.has(hash)) index.set(hash, String(texture.name || path.split('/').pop()));
  }
  return index;
}

function storeRuntimeTexture(pack, textureRecords, preferredName, bytes, contentIndex) {
  const payload = new Uint8Array(bytes);
  const hash = createHash('sha256').update(payload).digest('hex');
  const existing = contentIndex.get(hash);
  if (existing) return existing;
  const name = String(preferredName);
  const path = `runtime/textures/${name}`;
  pack.entries[path] = payload;
  textureRecords.push({ name, path });
  contentIndex.set(hash, name);
  return name;
}

function deactivateTabTiles(pack, tabId) {
  const tab = pack.document.tabs.find((item) => item.id === tabId);
  if (!tab) return [];
  const removedIds = new Set(tab.tileIds.map(Number).filter(Number.isFinite));
  if (!removedIds.size) return [];
  const removedMaterials = new Set();
  for (const id of removedIds) {
    const meshPath = `runtime/meshes/tile_${id}.json`;
    const bytes = pack.entries[meshPath];
    if (bytes) {
      const mesh = JSON.parse(Buffer.from(bytes).toString('utf8'));
      for (const materialId of mesh.textureIds || []) removedMaterials.add(Number(materialId));
      for (const range of mesh.materialRanges || []) removedMaterials.add(Number(range.materialId));
      delete pack.entries[meshPath];
    }
  }
  for (const tile of pack.editorMeta.tiles || []) {
    if (!removedIds.has(Number(tile.resortTileId))) continue;
    const previewPath = String(tile.preview?.image || '');
    if (previewPath.startsWith('editor/previews/')) delete pack.metaEntries[previewPath];
  }
  for (const entry of pack.tileIndex.entries || []) {
    if (removedIds.has(Number(entry.resortTileId))) entry.status = 'inactive';
  }
  pack.runtime.tiles = (pack.runtime.tiles || []).filter((tile) => !removedIds.has(Number(tile.resortTileId)));
  // Canonical tabs may contain aliases of geometry from another tab. Those
  // aliases intentionally share immutable runtime materials, so only discard
  // a material when no remaining tile mesh still references it.
  const referencedMaterials = new Set();
  for (const tile of pack.runtime.tiles || []) {
    const meshBytes = pack.entries[`runtime/meshes/tile_${Number(tile.resortTileId)}.json`];
    if (!meshBytes) continue;
    const mesh = JSON.parse(Buffer.from(meshBytes).toString('utf8'));
    for (const materialId of mesh.textureIds || []) referencedMaterials.add(Number(materialId));
    for (const range of mesh.materialRanges || []) referencedMaterials.add(Number(range.materialId));
  }
  const disposableMaterials = new Set(
    [...removedMaterials].filter((materialId) => !referencedMaterials.has(Number(materialId))),
  );
  pack.runtime.materials = (pack.runtime.materials || [])
    .filter((material) => !disposableMaterials.has(Number(material.materialId)));
  pack.editorMeta.tiles = (pack.editorMeta.tiles || []).filter((tile) => !removedIds.has(Number(tile.resortTileId)));
  pack.document.tiles = (pack.document.tiles || []).filter((tile) => !removedIds.has(Number(tile.resortTileId)));
  tab.tileIds = [];
  for (const set of pack.document.smartSets || []) {
    set.grid = (set.grid || []).map((column) => (column || []).map((id) => removedIds.has(Number(id)) ? -1 : id));
  }

  const referencedTextures = new Set();
  for (const material of pack.runtime.materials || []) {
    if (material.textureName) referencedTextures.add(String(material.textureName));
    for (const frame of material.animation?.frames || []) referencedTextures.add(String(frame));
    for (const keyframe of material.animation?.imageKeyframes || []) referencedTextures.add(String(keyframe?.textureName || ''));
  }
  const removedTextureNames = new Set(
    (pack.runtime.textures || [])
      .map((texture) => String(texture.name || ''))
      .filter((name) => name && !referencedTextures.has(name)),
  );
  pack.runtime.textures = (pack.runtime.textures || []).filter((texture) => !removedTextureNames.has(String(texture.name || '')));
  for (const textureName of removedTextureNames) delete pack.entries[`runtime/textures/${textureName}`];
  return [...removedIds];
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

function glbMeshPayload(compiled, materialIds, authoredWidth, authoredHeight, restClipName = '') {
  const groups = materialIds.map(() => []);
  for (let tri = 0; tri < compiled.triangleCount; tri += 1) {
    const material = compiled.triangleMaterials[tri] || 0;
    groups[Math.min(groups.length - 1, material)].push(tri);
  }
  const triangles = [];
  const uvs = [];
  const colors = [];
  const ranges = [];
  const vertexAnimations = (compiled.vertexAnimations || []).map((clip) => ({
    name: clip.name,
    frameDurationMs: clip.frameDurationMs,
    frames: clip.frames.map(() => []),
  }));
  let triStart = 0;
  const restClip = (compiled.vertexAnimations || []).find((clip) => clip.name === restClipName);
  const restPositions = restClip?.frames?.[0];
  for (let slot = 0; slot < groups.length; slot += 1) {
    for (const tri of groups[slot]) {
      for (let corner = 0; corner < 3; corner += 1) {
        const vertexIndex = compiled.indices[tri * 3 + corner];
        const vi = vertexIndex * 8;
        const restIndex = vertexIndex * 3;
        const px = restPositions?.[restIndex] ?? compiled.vertices[vi];
        const py = restPositions?.[restIndex + 1] ?? compiled.vertices[vi + 1];
        const pz = restPositions?.[restIndex + 2] ?? compiled.vertices[vi + 2];
        const preserveSurface = compiled.tileSurfaceOrigin === true;
        const x = preserveSurface
          ? (px / TILE_SIZE) + (authoredWidth / 2)
          : (px - compiled.aabb.min[0]) / TILE_SIZE;
        const z = preserveSurface
          ? (authoredHeight / 2) - (pz / TILE_SIZE)
          : compiled.footprint.d - ((pz - compiled.aabb.min[2]) / TILE_SIZE);
        const y = preserveSurface
          ? py / TILE_SIZE
          : (py - compiled.aabb.min[1]) / TILE_SIZE;
        triangles.push(x, z, y);
        for (let clipIndex = 0; clipIndex < vertexAnimations.length; clipIndex += 1) {
          const clip = compiled.vertexAnimations[clipIndex];
          for (let frameIndex = 0; frameIndex < clip.frames.length; frameIndex += 1) {
            const frame = clip.frames[frameIndex];
            const source = compiled.indices[tri * 3 + corner] * 3;
            const frameX = preserveSurface
              ? (frame[source] / TILE_SIZE) + (authoredWidth / 2)
              : (frame[source] - compiled.aabb.min[0]) / TILE_SIZE;
            const frameZ = preserveSurface
              ? (authoredHeight / 2) - (frame[source + 2] / TILE_SIZE)
              : compiled.footprint.d - ((frame[source + 2] - compiled.aabb.min[2]) / TILE_SIZE);
            const frameY = preserveSurface
              ? frame[source + 1] / TILE_SIZE
              : (frame[source + 1] - compiled.aabb.min[1]) / TILE_SIZE;
            vertexAnimations[clipIndex].frames[frameIndex].push(frameX, frameZ, frameY);
          }
        }
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
    ...(vertexAnimations.length ? { vertexAnimations } : {}),
  };
}

function addTileToEditablePack(pack, definition, assets, contentIndex = runtimeTextureIndex(pack), identity = {}) {
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
    ? {
        ...assets,
        glb: bundle.glb,
        materialAnimations: bundle.animations,
        materialUvMappings: bundle.materialUvMappings,
        preview: assets.preview || bundle.preview,
      }
    : assets;
  const reusableEntry = Number.isFinite(Number(identity.resortTileId))
    ? (pack.tileIndex.entries || []).find((entry) => Number(entry.resortTileId) === Number(identity.resortTileId))
    : null;
  const resortTileId = reusableEntry
    ? Number(reusableEntry.resortTileId)
    : nextId((pack.tileIndex.entries || []).map((entry) => entry.resortTileId));
  const localIndex = reusableEntry
    ? Number(reusableEntry.localIndex)
    : nextId((pack.tileIndex.entries || []).map((entry) => entry.localIndex));
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
    mesh = glbMeshPayload(
      compiled,
      materialIds,
      width,
      height,
      String(tileInput.properties?.['door.animation.open'] || ''),
    );
    // RAE door bundles may carry an opening track followed by its exact closing
    // reverse for the same material. RTPKS stores one triggerable material
    // timeline and the placed-door runtime reverses it for close, so retain the
    // first (opening) track instead of Map's usual last-value-wins behavior.
    const animationByMaterial = new Map();
    for (const item of tileAssets.materialAnimations || []) {
      const materialName = String(item.material).toLowerCase();
      if (!animationByMaterial.has(materialName)) animationByMaterial.set(materialName, item);
    }
    const uvMappingByMaterial = new Map((tileAssets.materialUvMappings || []).map(({ material, ...mapping }) => [String(material).toLowerCase(), mapping]));
    const compiledMaterialNames = new Set(compiled.materials.map((item) => String(item.name || '').toLowerCase()));
    const missingAnimationMaterials = [...animationByMaterial.keys()].filter((name) => !compiledMaterialNames.has(name));
    if (missingAnimationMaterials.length) {
      throw new Error(`Tile bundle animation material was not found in the GLB: ${missingAnimationMaterials.join(', ')}.`);
    }
    compiled.materials.forEach((source, index) => {
      const materialAnimation = animationByMaterial.get(String(source.name || '').toLowerCase());
      const materialUvMapping = uvMappingByMaterial.get(String(source.name || '').toLowerCase());
      if (materialAnimation?.type === 'frames') {
        const frameNames = materialAnimation.frames.map((frame, frameIndex) => {
          const sourceExt = String(frame.path || '').toLowerCase().match(/\.(png|jpe?g)$/)?.[1] || 'png';
          const ext = sourceExt === 'jpeg' ? 'jpg' : sourceExt;
          const textureName = `${key}_${resortTileId}_mat${index}_frame_${String(frameIndex).padStart(3, '0')}.${ext}`;
          return storeRuntimeTexture(pack, textureRecords, textureName, frame.bytes, contentIndex);
        });
        materials.push({
          materialId: materialIds[index],
          name: source.name || `${key}_mat${index}`,
          textureName: frameNames[0],
          alpha: runtimeMaterialAlpha(tileInput.renderMode, source.opacity),
          sampler: source.sampler,
          ...(materialUvMapping ? { uvMapping: materialUvMapping } : {}),
          animation: {
            type: 'frames',
            frameDurationMs: materialAnimation.frameDurationMs,
            phase: materialAnimation.phase,
            loop: materialAnimation.loop,
            frames: frameNames,
          },
        });
        return;
      }
      const texture = compiled.textures[source.textureIndex] || compiled.textures[0];
      const ext = texture.format === 'jpeg' ? 'jpg' : 'png';
      const textureName = `${key}_${resortTileId}_mat${index}.${ext}`;
      const storedTextureName = storeRuntimeTexture(pack, textureRecords, textureName, texture.bytes, contentIndex);
      if (materialAnimation?.type === 'materialMotion') {
        const imageKeyframes = materialAnimation.imageKeyframes.map((keyframe, keyframeIndex) => {
          const sourceExt = String(keyframe.path || '').toLowerCase().match(/\.(png|jpe?g)$/)?.[1] || 'png';
          const keyframeExt = sourceExt === 'jpeg' ? 'jpg' : sourceExt;
          const keyframeName = `${key}_${resortTileId}_mat${index}_keyframe_${String(keyframeIndex).padStart(3, '0')}.${keyframeExt}`;
          return {
            frame: keyframe.frame,
            textureName: storeRuntimeTexture(pack, textureRecords, keyframeName, keyframe.bytes, contentIndex),
          };
        });
        materials.push({
          materialId: materialIds[index],
          name: source.name || `${key}_mat${index}`,
          textureName: storedTextureName,
          alpha: runtimeMaterialAlpha(tileInput.renderMode, source.opacity),
          sampler: source.sampler,
          renderOrder: materialAnimation.renderOrder,
          layerRole: materialAnimation.layerRole,
          ...(materialUvMapping ? { uvMapping: materialUvMapping } : {}),
          animation: {
            type: 'materialMotion',
            frameDurationMs: materialAnimation.frameDurationMs,
            timebaseHz: materialAnimation.timebaseHz,
            sourceTimebaseHz: materialAnimation.sourceTimebaseHz,
            interpolation: materialAnimation.interpolation,
            frameCount: materialAnimation.frameCount,
            phase: materialAnimation.phase,
            loop: materialAnimation.loop,
            offsets: materialAnimation.offsets,
            imageFrameCount: materialAnimation.imageFrameCount,
            imageKeyframes,
          },
        });
        return;
      }
      materials.push({
        materialId: materialIds[index],
        name: source.name || `${key}_mat${index}`,
        textureName: storedTextureName,
        alpha: runtimeMaterialAlpha(tileInput.renderMode, source.opacity),
        sampler: source.sampler,
        ...(materialUvMapping ? { uvMapping: materialUvMapping } : {}),
      });
    });
    const bundleAnimations = tileAssets.materialAnimations || [];
    if (bundleAnimations.length) {
      const primary = bundleAnimations[0];
      animation = normalizeAnimation({
        type: 'frames',
        frameDurationMs: primary.frameDurationMs,
        frameCount: Math.max(...bundleAnimations.map((item) => item.frameCount || item.frames?.length || item.offsets?.length || 1)),
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
      return storeRuntimeTexture(pack, textureRecords, textureName, bytes, contentIndex);
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
    const storedTextureName = storeRuntimeTexture(pack, textureRecords, textureName, tileAssets.texture, contentIndex);
    materials.push({ materialId, name: key, textureName: storedTextureName, alpha: tileInput.renderMode === 'blend' ? 24 : 31 });
    mesh = planeMesh(width, height, materialId, animation);
  } else {
    throw new Error('Choose a PNG/JPG spritesheet or a textured GLB tile.');
  }

  mesh.width = width;
  mesh.height = height;

  const collision = normalizeCollision(tileInput.collision, width, height);
  let preview = null;
  if (tileAssets.preview?.bytes?.length) {
    const previewPath = `editor/previews/tile_${resortTileId}.png`;
    pack.metaEntries[previewPath] = new Uint8Array(tileAssets.preview.bytes);
    preview = {
      image: previewPath,
      projection: tileAssets.preview.projection || 'orthographic',
      view: tileAssets.preview.view || 'top-down',
      width: finiteInt(tileAssets.preview.width, 192, 1, 4096),
      height: finiteInt(tileAssets.preview.height, 192, 1, 4096),
    };
  }
  const authored = tileDefinition({
    resortTileId, localIndex, key, name: tileInput.name || key, tabId, width, height,
    xOffset: 0, yOffset: 0, xTileable: false, yTileable: false, uTileable: false, vTileable: false,
    globalTexMapping: false, globalTexScale: 1, tags: tileInput.tags, properties: tileInput.properties || {},
    animation, collision, ...(preview ? { preview } : {}),
  });
  if (reusableEntry) Object.assign(reusableEntry, { localIndex, resortTileId, key, status: 'active' });
  else pack.tileIndex.entries.push({ localIndex, resortTileId, key, status: 'active' });
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
  return resortTileId;
}

export function addTileToPack(packBuffer, metaBuffer, definition, assets) {
  const pack = loadEditableTilePack(packBuffer, metaBuffer);
  const resortTileId = addTileToEditablePack(pack, definition, assets);
  return { ...writePack(pack), resortTileId };
}

export function addTilesToPack(packBuffer, metaBuffer, definitionsAndAssets, options = {}) {
  const pack = loadEditableTilePack(packBuffer, metaBuffer);
  const items = Array.isArray(definitionsAndAssets) ? definitionsAndAssets : [];
  if (!items.length) throw new Error('Choose at least one .tile bundle.');
  if (items.length > 128) throw new Error('A tile batch can contain at most 128 bundles.');
  const tabId = String(options.tabId || items[0]?.definition?.tabId || '');
  const deactivatedTileIds = options.replaceTab === true ? deactivateTabTiles(pack, tabId) : [];
  const contentIndex = runtimeTextureIndex(pack);
  const resortTileIds = [];
  for (const [index, item] of items.entries()) {
    const reusableId = options.preserveTileIds === false ? undefined : deactivatedTileIds[index];
    resortTileIds.push(addTileToEditablePack(
      pack,
      item.definition || {},
      item.assets || {},
      contentIndex,
      { resortTileId: reusableId },
    ));
  }
  syncDefinitions(pack, pack.document);
  return { ...writePack(pack), resortTileIds, deactivatedTileIds };
}

function installBundleMaterialAnimations(pack, bundleBuffers, contentIndex, materialIds = null) {
  const animationByName = new Map();
  const samplerByName = new Map();
  const uvMappingByName = new Map();
  for (const buffer of bundleBuffers || []) {
    const bundle = decodeTileBundle(buffer);
    for (const sampler of bundle.materialSamplers || []) {
      const key = String(sampler.material || '').toLowerCase();
      if (key && !samplerByName.has(key)) samplerByName.set(key, sampler);
    }
    for (const mapping of bundle.materialUvMappings || []) {
      const key = String(mapping.material || '').toLowerCase();
      if (key && !uvMappingByName.has(key)) uvMappingByName.set(key, mapping);
    }
    for (const animation of bundle.animations) {
      const key = String(animation.material || '').toLowerCase();
      if (key && !animationByName.has(key)) animationByName.set(key, animation);
    }
  }
  const textureRecords = [];
  for (const material of pack.runtime.materials || []) {
    if (materialIds && !materialIds.has(Number(material.materialId))) continue;
    const key = String(material.name || '').toLowerCase();
    const sampler = samplerByName.get(key);
    if (sampler) material.sampler = {
      wrapS: sampler.wrapS,
      wrapT: sampler.wrapT,
      magFilter: sampler.magFilter,
      minFilter: sampler.minFilter,
    };
    const source = animationByName.get(key);
    const uvMapping = uvMappingByName.get(key);
    if (uvMapping) material.uvMapping = {
      mode: 'world',
      uPerTile: uvMapping.uPerTile,
      vPerTile: uvMapping.vPerTile,
    };
    else if (source?.type === 'materialMotion') delete material.uvMapping;
    if (!source) continue;
    if (source.type === 'materialMotion') {
      const imageKeyframes = source.imageKeyframes.map((keyframe, index) => ({
        frame: keyframe.frame,
        textureName: storeRuntimeTexture(
          pack,
          textureRecords,
          `ocean_${safeId(material.name, 'material')}_keyframe_${String(index).padStart(3, '0')}.png`,
          keyframe.bytes,
          contentIndex,
        ),
      }));
      material.animation = {
        type: 'materialMotion',
        frameDurationMs: source.frameDurationMs,
        timebaseHz: source.timebaseHz,
        sourceTimebaseHz: source.sourceTimebaseHz,
        interpolation: source.interpolation,
        frameCount: source.frameCount,
        phase: source.phase,
        loop: source.loop,
        offsets: source.offsets,
        imageFrameCount: source.imageFrameCount,
        imageKeyframes,
      };
      material.renderOrder = source.renderOrder;
      material.layerRole = source.layerRole;
      continue;
    }
    const frames = source.frames.map((frame, index) => storeRuntimeTexture(
      pack,
      textureRecords,
      `ocean_${safeId(material.name, 'material')}_frame_${String(index).padStart(3, '0')}.png`,
      frame.bytes,
      contentIndex,
    ));
    material.animation = {
      type: 'frames',
      frameDurationMs: source.frameDurationMs,
      phase: source.phase,
      loop: source.loop,
      frames,
    };
  }
  pack.runtime.textures = [...(pack.runtime.textures || []), ...textureRecords];
}

function applyRuntimeMaterialOverrides(pack, overrides = {}) {
  for (const material of pack.runtime.materials || []) {
    const override = overrides[String(material.name || '')] || overrides[String(material.name || '').toLowerCase()];
    if (!override) continue;
    if (override.sampler) material.sampler = { ...(material.sampler || {}), ...override.sampler };
    if (override.uvMapping) material.uvMapping = structuredClone(override.uvMapping);
    if (override.animation && material.animation?.type && material.animation.type !== 'none') {
      material.animation = { ...material.animation, ...structuredClone(override.animation) };
    }
  }
}

function restoreRuntimeMaterialBaselines(pack, baselines = {}) {
  const byId = new Map((pack.runtime.materials || []).map((material) => [Number(material.materialId), material]));
  for (const [rawId, baseline] of Object.entries(baselines || {})) {
    const materialId = Number(rawId);
    if (!Number.isFinite(materialId) || !baseline || typeof baseline !== 'object') continue;
    const current = byId.get(materialId);
    if (!current) continue;
    const restored = { materialId, ...structuredClone(baseline) };
    Object.keys(current).forEach((key) => delete current[key]);
    Object.assign(current, restored);
  }
}

/**
 * Replace one editor tab with independent aliases of known-good pack tiles.
 *
 * This is used for canonical tile grammars where the original pack already
 * contains exact DS-authored geometry (corner/edge orientation and UVs), while
 * RAE bundles supply the independently decoded material timelines. The cloned
 * runtime records have stable ids and do not depend on PDSMS at edit/runtime.
 */
export function replaceTabWithClonedTiles(
  packBuffer,
  metaBuffer,
  cloneSpecs,
  {
    tabId,
    animationBundles = [],
    preserveTileIds = true,
    materialOverrides = {},
    materialBaselines = {},
  } = {},
) {
  const pack = loadEditableTilePack(packBuffer, metaBuffer);
  const targetTab = pack.document.tabs.find((tab) => tab.id === tabId);
  if (!targetTab) throw new Error(`Tile tab ${tabId} was not found.`);
  const specs = Array.isArray(cloneSpecs) ? cloneSpecs : [];
  if (!specs.length) throw new Error('Choose at least one source tile to clone.');

  // Recover any ocean-profile entries left detached by an interrupted or older
  // mixed import. loadEditableTilePack otherwise assigns active unreferenced ids
  // to the first tab, which would leave invisible duplicate runtime meshes.
  const generatedOceanIds = new Set(
    (pack.runtime.tiles || [])
      .filter((tile) => tile.properties?.['source.profile'] === 'gen5_ocean')
      .map((tile) => Number(tile.resortTileId))
      .filter(Number.isFinite),
  );
  if (generatedOceanIds.size) {
    const recoveredIds = new Set([...targetTab.tileIds, ...generatedOceanIds]);
    for (const tab of pack.document.tabs) {
      tab.tileIds = tab.id === tabId
        ? [...recoveredIds].sort((a, b) => a - b)
        : tab.tileIds.filter((id) => !generatedOceanIds.has(Number(id)));
    }
  }

  const runtimeById = new Map((pack.runtime.tiles || []).map((tile) => [Number(tile.resortTileId), structuredClone(tile)]));
  const editorById = new Map((pack.editorMeta.tiles || []).map((tile) => [Number(tile.resortTileId), structuredClone(tile)]));
  const snapshots = specs.map((spec) => {
    if (spec.tileBundle?.length) {
      const previewSourceId = Number(spec.previewSourceTileId);
      const previewEditor = editorById.get(previewSourceId);
      const previewPath = String(previewEditor?.preview?.image || '');
      return {
        spec,
        tileBundle: Buffer.from(spec.tileBundle),
        previewEditor,
        preview: previewPath && pack.metaEntries[previewPath]
          ? new Uint8Array(pack.metaEntries[previewPath])
          : null,
      };
    }
    const sourceId = Number(spec.sourceTileId);
    const runtime = runtimeById.get(sourceId);
    const editor = editorById.get(sourceId);
    const mesh = pack.entries[`runtime/meshes/tile_${sourceId}.json`];
    if (!runtime || !editor || !mesh) throw new Error(`Source tile ${sourceId} is unavailable.`);
    const previewPath = String(editor.preview?.image || '');
    return {
      spec,
      runtime,
      editor,
      mesh: new Uint8Array(mesh),
      preview: previewPath && pack.metaEntries[previewPath]
        ? new Uint8Array(pack.metaEntries[previewPath])
        : null,
    };
  });

  const deactivatedTileIds = deactivateTabTiles(pack, tabId);
  const contentIndex = runtimeTextureIndex(pack);
  // Older ocean rebuilds installed motion by material name globally. Restore
  // the original shared Default-tab records before making isolated animated
  // copies for the Water tab.
  restoreRuntimeMaterialBaselines(pack, materialBaselines);

  const sourceMaterialIds = new Set();
  for (const snapshot of snapshots) {
    if (!snapshot.mesh) continue;
    const mesh = JSON.parse(Buffer.from(snapshot.mesh).toString('utf8'));
    for (const range of mesh.materialRanges || []) sourceMaterialIds.add(Number(range.materialId));
    for (const materialId of mesh.textureIds || []) sourceMaterialIds.add(Number(materialId));
  }
  const materialById = new Map((pack.runtime.materials || []).map((material) => [Number(material.materialId), material]));
  const isolatedMaterialIds = new Map();
  let nextMaterialId = nextId((pack.runtime.materials || []).map((material) => material.materialId));
  for (const sourceMaterialId of sourceMaterialIds) {
    const source = materialById.get(sourceMaterialId);
    if (!source) continue;
    const materialId = nextMaterialId++;
    isolatedMaterialIds.set(sourceMaterialId, materialId);
    pack.runtime.materials.push({ ...structuredClone(source), materialId });
  }
  installBundleMaterialAnimations(
    pack,
    animationBundles,
    contentIndex,
    new Set(isolatedMaterialIds.values()),
  );
  applyRuntimeMaterialOverrides(pack, materialOverrides);
  const resortTileIds = [];

  for (const [index, snapshot] of snapshots.entries()) {
    const reusableId = preserveTileIds !== false ? deactivatedTileIds[index] : undefined;
    const existingEntry = Number.isFinite(Number(reusableId))
      ? (pack.tileIndex.entries || []).find((entry) => Number(entry.resortTileId) === Number(reusableId))
      : null;
    const resortTileId = existingEntry
      ? Number(existingEntry.resortTileId)
      : nextId((pack.tileIndex.entries || []).map((entry) => entry.resortTileId));
    const localIndex = existingEntry
      ? Number(existingEntry.localIndex)
      : nextId((pack.tileIndex.entries || []).map((entry) => entry.localIndex));
    const name = String(snapshot.spec.name || snapshot.editor?.name || `Ocean tile ${index + 1}`);
    if (snapshot.tileBundle) {
      const importedId = addTileToEditablePack(
        pack,
        {
          ...snapshot.spec,
          name,
          tabId,
          properties: {
            ...(snapshot.spec.properties || {}),
            'source.platform': 'nds',
            'source.profile': 'gen5_ocean',
          },
        },
        {
          tileBundle: snapshot.tileBundle,
          ...(snapshot.preview ? {
            preview: {
              bytes: snapshot.preview,
              projection: snapshot.previewEditor?.preview?.projection || 'orthographic',
              view: snapshot.previewEditor?.preview?.view || 'top-down',
              width: snapshot.previewEditor?.preview?.width || 16,
              height: snapshot.previewEditor?.preview?.height || 16,
            },
          } : {}),
        },
        contentIndex,
        { resortTileId },
      );
      resortTileIds.push(importedId);
      continue;
    }
    const key = safeId(snapshot.spec.key || name, `tile_${resortTileId}`);
    const mesh = JSON.parse(Buffer.from(snapshot.mesh).toString('utf8'));
    for (const range of mesh.materialRanges || []) {
      range.materialId = isolatedMaterialIds.get(Number(range.materialId)) ?? range.materialId;
    }
    mesh.textureIds = (mesh.textureIds || []).map((materialId) => (
      isolatedMaterialIds.get(Number(materialId)) ?? materialId
    ));
    const materialIds = new Set((mesh.materialRanges || []).map((range) => Number(range.materialId)));
    const animations = (pack.runtime.materials || [])
      .filter((material) => materialIds.has(Number(material.materialId)) && material.animation)
      .map((material) => material.animation);
    const primary = animations[0];
    const animation = primary ? {
      type: 'frames',
      frameDurationMs: primary.frameDurationMs,
      columns: 1,
      rows: 1,
      frameCount: Math.max(...animations.map((item) => item.frameCount || item.frames?.length || item.offsets?.length || 1)),
      phase: primary.phase || 'global',
      loop: primary.loop !== false,
    } : { type: 'none' };
    const tags = normalizeTags(snapshot.spec.tags || ['surface.water']);
    const properties = {
      ...(snapshot.editor.properties || {}),
      ...(snapshot.spec.properties || {}),
      'source.platform': 'nds',
      'source.profile': 'gen5_ocean',
    };
    const width = finiteInt(snapshot.spec.width, snapshot.runtime.width || snapshot.editor.width, 1, 32);
    const height = finiteInt(snapshot.spec.height, snapshot.runtime.height || snapshot.editor.height, 1, 32);
    const collision = normalizeCollision(snapshot.spec.collision || { mode: 'none' }, width, height);
    const previewPath = snapshot.preview ? `editor/previews/tile_${resortTileId}.png` : '';
    if (snapshot.preview) pack.metaEntries[previewPath] = snapshot.preview;
    const authored = tileDefinition({
      ...snapshot.editor,
      resortTileId,
      localIndex,
      key,
      name,
      tabId,
      width,
      height,
      tags,
      properties,
      animation,
      collision,
      ...(previewPath ? { preview: { ...snapshot.editor.preview, image: previewPath } } : {}),
    });
    const runtime = {
      ...snapshot.runtime,
      resortTileId,
      localIndex,
      width,
      height,
      name,
      tags,
      properties,
      animation,
      collision,
    };
    mesh.width = width;
    mesh.height = height;
    pack.entries[`runtime/meshes/tile_${resortTileId}.json`] = jsonBytes(mesh);
    if (existingEntry) Object.assign(existingEntry, { localIndex, resortTileId, key, status: 'active' });
    else pack.tileIndex.entries.push({ localIndex, resortTileId, key, status: 'active' });
    pack.runtime.tiles.push(runtime);
    pack.editorMeta.tiles.push(authored);
    pack.document.tiles.push(authored);
    // Adding a bundled tile synchronizes/rebuilds the editable document. Always
    // reacquire the tab instead of retaining an object reference across mixed
    // cloned and bundled items.
    pack.document.tabs.find((tab) => tab.id === tabId).tileIds.push(resortTileId);
    resortTileIds.push(resortTileId);
  }
  applyRuntimeMaterialOverrides(pack, materialOverrides);
  syncDefinitions(pack, pack.document);
  return { ...writePack(pack), resortTileIds, deactivatedTileIds };
}
