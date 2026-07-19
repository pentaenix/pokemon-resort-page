import assert from 'node:assert/strict';
import test from 'node:test';
import { zipSync, strToU8, unzipSync } from 'fflate';
import {
  addTileToPack,
  addTilesToPack,
  inspectTileBundle,
  loadEditableTilePack,
  replaceTabWithClonedTiles,
  saveTilePackDocument,
} from './tile-pack-authoring.mjs';
import { parseGlb } from './glb-compile.mjs';
import { writeGlbFromMesh } from './write-glb.mjs';

const json = (value) => strToU8(JSON.stringify(value));
const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgQIAhS5Z5QAAAABJRU5ErkJggg==', 'base64');

function fixture() {
  const pack = zipSync({
    'manifest.json': json({ format: 'pokemon_resort.rtpks', version: 2, packId: 'test', name: 'Test', tileIndex: 'index/tile_index.json', tileTabs: 'index/tile_tabs.json' }),
    'index/tile_index.json': json({ format: 'pokemon_resort.tile_index', version: 1, entries: [{ localIndex: 0, resortTileId: 7, key: 'ground', status: 'active' }] }),
    'index/tile_tabs.json': json({ format: 'pokemon_resort.rtpks.tile_tabs', tabs: [{ id: 'ground', name: 'Ground', order: 0, tileIds: [7] }] }),
    'runtime/manifest.json': json({ format: 'pokemon_resort.rpak', packId: 'test', materials: [{ materialId: 3, name: 'ground', textureName: 'ground.png', alpha: 31 }], textures: [{ name: 'ground.png' }], tiles: [{ resortTileId: 7, localIndex: 0, width: 1, height: 1 }] }),
    'runtime/meshes/tile_7.json': json({ width: 1, height: 1, triangles: [], quads: [0,1,0,1,1,0,1,0,0,0,0,0], textureIds: [3], materialRanges: [{ materialId: 3, quadStart: 0, quadCount: 1 }] }),
    'runtime/textures/ground.png': PNG_1X1,
  });
  // sourceSha256 is optional for the in-memory authoring fixture.
  const meta = zipSync({
    'manifest.json': json({ format: 'pokemon_resort.rtpks.meta', tileMetadata: 'editor/tile_metadata.json' }),
    'editor/tile_metadata.json': json({ format: 'pokemon_resort.rtpks.editor_metadata', version: 1, packId: 'test', tabs: [{ id: 'ground', name: 'Ground', order: 0, tileIds: [7] }], tiles: [{ resortTileId: 7, localIndex: 0, key: 'ground', tabId: 'ground', width: 1, height: 1, preview: { image: 'editor/previews/tile_7.png', projection: 'orthographic', view: 'top-down' } }], smartSets: [] }),
    'editor/previews/tile_7.png': PNG_1X1,
  });
  return { pack: Buffer.from(pack), meta: Buffer.from(meta) };
}

function rewriteGlbJson(glb, mutate) {
  const parsed = parseGlb(glb);
  mutate(parsed.json);
  const rawJson = Buffer.from(JSON.stringify(parsed.json));
  const jsonPadding = (4 - (rawJson.length % 4)) % 4;
  const jsonChunk = Buffer.concat([rawJson, Buffer.alloc(jsonPadding, 0x20)]);
  const binPadding = (4 - (parsed.bin.length % 4)) % 4;
  const binChunk = Buffer.concat([parsed.bin, Buffer.alloc(binPadding)]);
  const output = Buffer.alloc(12 + 8 + jsonChunk.length + 8 + binChunk.length);
  output.writeUInt32LE(0x46546c67, 0);
  output.writeUInt32LE(2, 4);
  output.writeUInt32LE(output.length, 8);
  output.writeUInt32LE(jsonChunk.length, 12);
  output.writeUInt32LE(0x4e4f534a, 16);
  jsonChunk.copy(output, 20);
  const binHeader = 20 + jsonChunk.length;
  output.writeUInt32LE(binChunk.length, binHeader);
  output.writeUInt32LE(0x004e4942, binHeader + 4);
  binChunk.copy(output, binHeader + 8);
  return output;
}

function animatedMeshBundle({ opacity = 1 } = {}) {
  let glb = writeGlbFromMesh({
    id: 'water_mesh',
    aabb: { min: [0, 0, 0], max: [16, 0, 16] },
    vertices: new Float32Array([
      0, 0, 0, 0, 1, 0, 0, 0,
      16, 0, 0, 0, 1, 0, 1, 0,
      0, 0, 16, 0, 1, 0, 0, 1,
    ]),
    indices: new Uint32Array([0, 1, 2]),
    materials: [{ name: 'water_mat', textureIndex: 0 }],
    triangleMaterials: new Uint8Array([0]),
    textures: [{ format: 'png', width: 1, height: 1, bytes: PNG_1X1 }],
  });
  if (opacity !== 1) {
    glb = rewriteGlbJson(glb, (gltf) => {
      gltf.materials[0].pbrMetallicRoughness.baseColorFactor = [1, 1, 1, opacity];
      gltf.materials[0].alphaMode = 'BLEND';
    });
  }
  return Buffer.from(zipSync({
    'manifest.json': json({
      format: 'pokemon_resort.tile', version: 1, name: 'Black Water',
      source: { tool: 'RAE', platform: 'nds', virtualPath: 'a/1/2/3/water.nsbmd' },
      model: { path: 'model.glb', format: 'glb' },
      preview: { path: 'preview.png', format: 'png', projection: 'orthographic', view: 'top-down', width: 192, height: 192 },
      materials: { animations: [{ material: 'water_mat', type: 'frames', frames: ['textures/water/0.png', 'textures/water/1.png'], frameDurationMs: 125, loop: true }] },
      defaults: { tags: ['surface.water'], properties: { source: 'pokemon-black' }, renderMode: 'blend', collision: { mode: 'none' } },
    }),
    'model.glb': glb,
    'preview.png': PNG_1X1,
    'textures/water/0.png': PNG_1X1,
    'textures/water/1.png': PNG_1X1,
  }));
}

function materialMotionMeshBundle() {
  const entries = unzipSync(new Uint8Array(animatedMeshBundle()));
  entries['model.glb'] = rewriteGlbJson(Buffer.from(entries['model.glb']), (gltf) => {
    const texture = gltf.textures[0];
    const samplerIndex = Number.isInteger(texture.sampler) ? texture.sampler : 0;
    texture.sampler = samplerIndex;
    gltf.samplers = gltf.samplers || [];
    gltf.samplers[samplerIndex] = {
      ...(gltf.samplers[samplerIndex] || {}),
      wrapS: 10497,
      wrapT: 33071,
      magFilter: 9728,
      minFilter: 9728,
    };
  });
  const manifest = JSON.parse(Buffer.from(entries['manifest.json']).toString('utf8'));
  manifest.materials.animations = [{
    material: 'water_mat', type: 'materialMotion', frameCount: 4,
    offsets: [[0, 0], [0.125, 0], [0.25, 0], [0.375, 0]],
    imageKeyframes: [{ frame: 0, path: 'textures/water/0.png' }, { frame: 2, path: 'textures/water/1.png' }],
    imageFrameCount: 4, frameDurationMs: 100, loop: true,
  }];
  entries['manifest.json'] = json(manifest);
  return Buffer.from(zipSync(entries));
}

function nonAffineMaterialMotionMeshBundle() {
  const entries = unzipSync(new Uint8Array(materialMotionMeshBundle()));
  entries['model.glb'] = writeGlbFromMesh({
    id: 'shore_mesh',
    aabb: { min: [0, 0, 0], max: [16, 0, 16] },
    vertices: new Float32Array([
      0, 0, 0, 0, 1, 0, 0, 0,
      16, 0, 0, 0, 1, 0, 1, 0,
      0, 0, 16, 0, 1, 0, 0, 1,
      16, 0, 16, 0, 1, 0, 2, 2,
    ]),
    indices: new Uint32Array([0, 1, 2, 1, 3, 2]),
    materials: [{ name: 'water_mat', textureIndex: 0 }],
    triangleMaterials: new Uint8Array([0, 0]),
    textures: [{ format: 'png', width: 1, height: 1, bytes: PNG_1X1 }],
  });
  return Buffer.from(zipSync(entries));
}

function layeredSurfaceOriginBundle() {
  let glb = writeGlbFromMesh({
    id: 'layered_ocean',
    aabb: { min: [-8, -24, -8], max: [8, 0, 8] },
    vertices: new Float32Array([
      -8, -24, -8, 0, 1, 0, 0, 0,
      8, -24, -8, 0, 1, 0, 1, 0,
      -8, 0, 8, 0, 1, 0, 0, 1,
    ]),
    indices: new Uint32Array([0, 1, 2]),
    materials: [{ name: 'ocean', textureIndex: 0 }],
    triangleMaterials: new Uint8Array([0]),
    textures: [{ format: 'png', width: 1, height: 1, bytes: PNG_1X1 }],
  });
  glb = rewriteGlbJson(glb, (gltf) => {
    gltf.extras = { rae: { tileBounds: { originY: -80 } } };
  });
  return Buffer.from(zipSync({
    'manifest.json': json({
      format: 'pokemon_resort.tile', version: 1, name: 'Layered Ocean',
      model: { path: 'model.glb', format: 'glb' },
      materials: { animations: [] },
      defaults: { width: 1, height: 1, renderMode: 'blend' },
    }),
    'model.glb': glb,
  }));
}

test('renames and reorders tabs without changing stable tile ids', () => {
  const input = fixture();
  const editable = loadEditableTilePack(input.pack, input.meta);
  editable.document.tabs.unshift({ id: 'water', name: 'Water', order: 0, tileIds: [] });
  editable.document.tabs[1].name = 'Terrain';
  const saved = saveTilePackDocument(input.pack, input.meta, editable.document);
  const result = loadEditableTilePack(saved.packBytes, saved.metaBytes);
  assert.deepEqual(result.document.tabs.map((tab) => tab.name), ['Water', 'Terrain']);
  assert.equal(result.document.tiles[0].resortTileId, 7);
});

test('adds an animated tile with a new stable id and runtime frames', () => {
  const input = fixture();
  const added = addTileToPack(input.pack, input.meta, {
    name: 'Animated Water', tabId: 'ground', width: 1, height: 1,
    tags: ['surface.water'], collision: { mode: 'none' },
    animation: { type: 'frames', frameDurationMs: 120, phase: 'global', loop: true },
  }, { frames: [PNG_1X1, PNG_1X1] });
  assert.equal(added.resortTileId, 8);
  const result = loadEditableTilePack(added.packBytes, added.metaBytes);
  assert.equal(result.document.tiles.at(-1).animation.frameCount, 2);
  assert.deepEqual(result.document.tiles.at(-1).tags, ['surface.water']);
  const entries = unzipSync(new Uint8Array(added.packBytes));
  const runtime = JSON.parse(Buffer.from(entries['runtime/manifest.json']).toString('utf8'));
  const material = runtime.materials.at(-1);
  assert.equal(material.animation.frames.length, 2);
  assert.equal(material.animation.frameDurationMs, 120);
  result.document.tiles.at(-1).animation.frameDurationMs = 240;
  const retimed = saveTilePackDocument(added.packBytes, added.metaBytes, result.document);
  const retimedEntries = unzipSync(new Uint8Array(retimed.packBytes));
  const retimedRuntime = JSON.parse(Buffer.from(retimedEntries['runtime/manifest.json']).toString('utf8'));
  assert.equal(retimedRuntime.materials.at(-1).animation.frameDurationMs, 240);
});

test('inspects and imports a mesh tile bundle with material animation', () => {
  const bundle = animatedMeshBundle({ opacity: 12 / 31 });
  const summary = inspectTileBundle(bundle);
  assert.equal(summary.name, 'Black Water');
  assert.equal(summary.width, 1);
  assert.equal(summary.animatedMaterials[0].frameCount, 2);
  assert.deepEqual(summary.preview, { available: true, projection: 'orthographic', view: 'top-down', width: 192, height: 192 });

  const input = fixture();
  const added = addTileToPack(input.pack, input.meta, {
    tabId: 'ground', name: 'Imported Water', width: 1, height: 1,
  }, { tileBundle: bundle });
  const entries = unzipSync(new Uint8Array(added.packBytes));
  const runtime = JSON.parse(Buffer.from(entries['runtime/manifest.json']).toString('utf8'));
  const material = runtime.materials.at(-1);
  const tile = runtime.tiles.at(-1);
  assert.equal(material.name, 'water_mat');
  assert.equal(material.animation.frames.length, 2);
  assert.equal(material.animation.frameDurationMs, 125);
  assert.equal(material.alpha, 12);
  assert.equal(tile.animation.type, 'frames');
  assert.deepEqual(tile.tags, ['surface.water']);
  assert.equal(tile.properties.source, 'pokemon-black');
  const metaEntries = unzipSync(new Uint8Array(added.metaBytes));
  assert.deepEqual(Buffer.from(metaEntries['editor/previews/tile_8.png']), PNG_1X1);
  const metadata = JSON.parse(Buffer.from(metaEntries['editor/tile_metadata.json']).toString('utf8'));
  assert.equal(metadata.tiles.at(-1).preview.image, 'editor/previews/tile_8.png');
});

test('preserves exact material UV motion and sparse image keyframes', () => {
  const bundle = materialMotionMeshBundle();
  const summary = inspectTileBundle(bundle);
  assert.equal(summary.animatedMaterials[0].type, 'materialMotion');
  assert.equal(summary.animatedMaterials[0].frameCount, 4);

  const input = fixture();
  const added = addTileToPack(input.pack, input.meta, { tabId: 'ground' }, { tileBundle: bundle });
  const entries = unzipSync(new Uint8Array(added.packBytes));
  const runtime = JSON.parse(Buffer.from(entries['runtime/manifest.json']).toString('utf8'));
  const animation = runtime.materials.at(-1).animation;
  assert.deepEqual(runtime.materials.at(-1).sampler, {
    wrapS: 'repeat', wrapT: 'clamp', magFilter: 'nearest', minFilter: 'nearest',
  });
  assert.deepEqual(runtime.materials.at(-1).uvMapping, {
    mode: 'world', uPerTile: [1, 0], vPerTile: [0, 1],
  });
  assert.equal(animation.type, 'materialMotion');
  assert.deepEqual(animation.offsets, [[0, 0], [0.125, 0], [0.25, 0], [0.375, 0]]);
  assert.deepEqual(animation.imageKeyframes.map((item) => item.frame), [0, 2]);
  assert.equal(animation.imageFrameCount, 4);
  assert.equal(runtime.tiles.at(-1).animation.frameCount, 4);
});

test('keeps non-affine shoreline motion on authored mesh UV islands', () => {
  const input = fixture();
  const added = addTileToPack(
    input.pack,
    input.meta,
    { tabId: 'ground' },
    { tileBundle: nonAffineMaterialMotionMeshBundle() },
  );
  const entries = unzipSync(new Uint8Array(added.packBytes));
  const runtime = JSON.parse(Buffer.from(entries['runtime/manifest.json']).toString('utf8'));
  const material = runtime.materials.at(-1);
  assert.equal(material.animation.type, 'materialMotion');
  assert.equal(material.uvMapping, undefined);
});

test('preserves RAE land-surface origin when importing layered ocean geometry', () => {
  const input = fixture();
  const added = addTileToPack(
    input.pack,
    input.meta,
    { tabId: 'ground' },
    { tileBundle: layeredSurfaceOriginBundle() },
  );
  const entries = unzipSync(new Uint8Array(added.packBytes));
  const mesh = JSON.parse(Buffer.from(entries['runtime/meshes/tile_8.json']).toString('utf8'));
  const heights = mesh.triangles.filter((_value, index) => index % 3 === 2);

  assert.equal(Math.max(...heights), 0);
  assert.equal(Math.min(...heights), -1.5);
  assert.equal(Math.min(...mesh.triangles.filter((_value, index) => index % 3 === 0)), 0);
  assert.equal(Math.max(...mesh.triangles.filter((_value, index) => index % 3 === 0)), 1);
});

test('batch replaces one tab while preserving available ids and deduplicating animation textures', () => {
  const input = fixture();
  const bundle = animatedMeshBundle();
  const added = addTilesToPack(input.pack, input.meta, [
    { definition: { tabId: 'ground' }, assets: { tileBundle: bundle } },
    { definition: { tabId: 'ground' }, assets: { tileBundle: bundle } },
  ], { tabId: 'ground', replaceTab: true });

  assert.deepEqual(added.deactivatedTileIds, [7]);
  assert.deepEqual(added.resortTileIds, [7, 8]);
  const editable = loadEditableTilePack(added.packBytes, added.metaBytes);
  assert.deepEqual(editable.document.tabs[0].tileIds, [7, 8]);
  assert.deepEqual(editable.document.tiles.map((tile) => tile.resortTileId), [7, 8]);

  const entries = unzipSync(new Uint8Array(added.packBytes));
  const index = JSON.parse(Buffer.from(entries['index/tile_index.json']).toString('utf8'));
  const runtime = JSON.parse(Buffer.from(entries['runtime/manifest.json']).toString('utf8'));
  assert.equal(index.entries.find((entry) => entry.resortTileId === 7).status, 'active');
  assert.notEqual(entries['runtime/meshes/tile_7.json'], undefined);
  assert.equal(runtime.tiles.length, 2);
  assert.equal(runtime.materials.length, 2);
  assert.equal(runtime.textures.length, 1);
  assert.equal(runtime.materials[0].animation.frames[0], runtime.materials[1].animation.frames[0]);
  const metaEntries = unzipSync(new Uint8Array(added.metaBytes));
  assert.deepEqual(Buffer.from(metaEntries['editor/previews/tile_7.png']), PNG_1X1);
  assert.deepEqual(Buffer.from(metaEntries['editor/previews/tile_8.png']), PNG_1X1);
});

test('clones canonical geometry into another tab without changing the source tile', () => {
  const input = fixture();
  const editable = loadEditableTilePack(input.pack, input.meta);
  editable.document.tabs.push({ id: 'water', name: 'Water', order: 1, tileIds: [] });
  const withTab = saveTilePackDocument(input.pack, input.meta, editable.document);
  const cloned = replaceTabWithClonedTiles(
    withTab.packBytes,
    withTab.metaBytes,
    [{ sourceTileId: 7, name: 'Ocean Ground Reference' }],
    { tabId: 'water' },
  );

  assert.deepEqual(cloned.resortTileIds, [8]);
  const result = loadEditableTilePack(cloned.packBytes, cloned.metaBytes);
  assert.deepEqual(result.document.tabs.find((tab) => tab.id === 'ground').tileIds, [7]);
  assert.deepEqual(result.document.tabs.find((tab) => tab.id === 'water').tileIds, [8]);
  const entries = unzipSync(new Uint8Array(cloned.packBytes));
  assert.deepEqual(
    JSON.parse(Buffer.from(entries['runtime/meshes/tile_8.json']).toString('utf8')).quads,
    JSON.parse(Buffer.from(entries['runtime/meshes/tile_7.json']).toString('utf8')).quads,
  );

  const replacedAgain = replaceTabWithClonedTiles(
    cloned.packBytes,
    cloned.metaBytes,
    [
      { sourceTileId: 7, name: 'Ocean Ground Reference' },
      { tileBundle: layeredSurfaceOriginBundle(), name: 'Ocean Body' },
      { sourceTileId: 7, name: 'Ocean Ground After Bundle' },
    ],
    { tabId: 'water' },
  );
  assert.deepEqual(replacedAgain.resortTileIds, [8, 9, 10]);
  const replacedDocument = loadEditableTilePack(replacedAgain.packBytes, replacedAgain.metaBytes).document;
  assert.deepEqual(replacedDocument.tabs.find((tab) => tab.id === 'water').tileIds, [8, 9, 10]);
  const repeatedEntries = unzipSync(new Uint8Array(replacedAgain.packBytes));
  const repeatedRuntime = JSON.parse(Buffer.from(repeatedEntries['runtime/manifest.json']).toString('utf8'));
  assert.notEqual(
    repeatedRuntime.materials.find((material) => material.materialId === 3),
    undefined,
    'replacing an alias tab must retain materials referenced by its source tile',
  );
  const bodyMesh = JSON.parse(Buffer.from(repeatedEntries['runtime/meshes/tile_9.json']).toString('utf8'));
  const bodyHeights = bodyMesh.triangles.filter((_value, index) => index % 3 === 2);
  assert.equal(Math.min(...bodyHeights), -1.5);
  assert.equal(Math.max(...bodyHeights), 0);
  const transitionMesh = JSON.parse(Buffer.from(repeatedEntries['runtime/meshes/tile_8.json']).toString('utf8'));
  assert.equal(transitionMesh.materialRanges.length, 1, 'canonical transition remains independent from the body tile');
});
