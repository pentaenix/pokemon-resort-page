import assert from 'node:assert/strict';
import test from 'node:test';
import { zipSync, strToU8, unzipSync } from 'fflate';
import { addTileToPack, inspectTileBundle, loadEditableTilePack, saveTilePackDocument } from './tile-pack-authoring.mjs';
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
    'editor/tile_metadata.json': json({ format: 'pokemon_resort.rtpks.editor_metadata', version: 1, packId: 'test', tabs: [{ id: 'ground', name: 'Ground', order: 0, tileIds: [7] }], tiles: [{ resortTileId: 7, localIndex: 0, key: 'ground', tabId: 'ground', width: 1, height: 1 }], smartSets: [] }),
  });
  return { pack: Buffer.from(pack), meta: Buffer.from(meta) };
}

function animatedMeshBundle() {
  const glb = writeGlbFromMesh({
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
  return Buffer.from(zipSync({
    'manifest.json': json({
      format: 'pokemon_resort.tile', version: 1, name: 'Black Water',
      source: { tool: 'RAE', platform: 'nds', virtualPath: 'a/1/2/3/water.nsbmd' },
      model: { path: 'model.glb', format: 'glb' },
      materials: { animations: [{ material: 'water_mat', type: 'frames', frames: ['textures/water/0.png', 'textures/water/1.png'], frameDurationMs: 125, loop: true }] },
      defaults: { tags: ['surface.water'], properties: { source: 'pokemon-black' }, renderMode: 'blend', collision: { mode: 'none' } },
    }),
    'model.glb': glb,
    'textures/water/0.png': PNG_1X1,
    'textures/water/1.png': PNG_1X1,
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
  const bundle = animatedMeshBundle();
  const summary = inspectTileBundle(bundle);
  assert.equal(summary.name, 'Black Water');
  assert.equal(summary.width, 1);
  assert.equal(summary.animatedMaterials[0].frameCount, 2);

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
  assert.equal(tile.animation.type, 'frames');
  assert.deepEqual(tile.tags, ['surface.water']);
  assert.equal(tile.properties.source, 'pokemon-black');
});
