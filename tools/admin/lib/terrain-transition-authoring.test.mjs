import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { buildSandGrassTransitionMesh, installSandGrassTransitions } from './terrain-transition-authoring.mjs';
import { transitionMasks } from '../modules/mapeditor/terrain-transitions.js';

const directory = path.dirname(fileURLToPath(import.meta.url));
const packPath = path.resolve(directory, '../../../../pokemon-resort/assets/overworld/tilepacks/maptiles.rtpks');

function readJson(entries, name) {
  return JSON.parse(Buffer.from(entries[name]).toString('utf8'));
}

test('generated transition mesh keeps a hard irregular boundary over the original materials', () => {
  const isolated = buildSandGrassTransitionMesh(0, 8, 507);
  const connected = buildSandGrassTransitionMesh(255, 8, 507);
  const materialArea = (mesh, materialId) => {
    let area = 0;
    for (const range of mesh.materialRanges.filter((item) => item.materialId === materialId)) {
      for (let quad = range.quadStart; quad < range.quadStart + range.quadCount; quad += 1) {
        const offset = quad * 12;
        area += (mesh.quads[offset + 6] - mesh.quads[offset]) * (mesh.quads[offset + 1] - mesh.quads[offset + 4]);
      }
    }
    return area;
  };
  assert.deepEqual(isolated.textureIds, [8, 507]);
  assert.ok(isolated.materialRanges.length > 2, 'sand and grass runs alternate without overlapping surfaces');
  assert.ok(isolated.quads.length > 24, 'isolated grass includes a non-rectangular stepped silhouette');
  assert.ok(materialArea(isolated, 507) < 0.7, 'isolated grass leaves a visible irregular sand border');
  assert.equal(materialArea(connected, 507), 1, 'fully connected grass reaches every tile edge');
  assert.equal(materialArea(isolated, 8) + materialArea(isolated, 507), 1, 'sand and grass partition the cell exactly');
  assert.ok(isolated.quads.filter((_, index) => index % 3 === 2).every((height) => height === 0), 'transition surfaces are coplanar but never overlap');
  for (const mask of transitionMasks()) {
    const mesh = buildSandGrassTransitionMesh(mask, 8, 507);
    assert.equal(materialArea(mesh, 8) + materialArea(mesh, 507), 1, `mask ${mask} covers one cell without stacked geometry`);
  }
});

test('north and south transition masks follow map coordinates', () => {
  const grassSourceRows = (mesh) => {
    const rows = [];
    for (const range of mesh.materialRanges.filter((item) => item.materialId === 507)) {
      for (let quad = range.quadStart; quad < range.quadStart + range.quadCount; quad += 1) {
        const offset = quad * 12;
        rows.push(mesh.quads[offset + 1], mesh.quads[offset + 4], mesh.quads[offset + 7], mesh.quads[offset + 10]);
      }
    }
    return rows;
  };
  const north = grassSourceRows(buildSandGrassTransitionMesh(1, 8, 507));
  const south = grassSourceRows(buildSandGrassTransitionMesh(4, 8, 507));
  assert.ok(north.includes(1), 'north-connected grass reaches source Y=1, the map north edge');
  assert.ok(!north.includes(0), 'north-connected grass leaves sand at the map south edge');
  assert.ok(south.includes(0), 'south-connected grass reaches source Y=0, the map south edge');
  assert.ok(!south.includes(1), 'south-connected grass leaves sand at the map north edge');
});

test('transition install is idempotent and adds no duplicate materials or textures', () => {
  const sourcePack = fs.readFileSync(packPath);
  const sourceMeta = fs.readFileSync(`${packPath}.meta`);
  const beforeRuntime = readJson(unzipSync(sourcePack), 'runtime/manifest.json');
  const first = installSandGrassTransitions(sourcePack, sourceMeta);
  const firstEntries = unzipSync(first.packBytes);
  const firstRuntime = readJson(firstEntries, 'runtime/manifest.json');
  assert.equal(first.result.installed.length, 46);
  assert.equal(firstRuntime.materials.length, beforeRuntime.materials.length);
  assert.equal(firstRuntime.textures.length, beforeRuntime.textures.length);
  const grassMaterial = firstRuntime.materials.find((material) => material.materialId === first.result.grassMaterialId);
  assert.deepEqual(grassMaterial.uvMapping, {
    mode: 'world',
    uPerTile: [0.25, 0],
    vPerTile: [0, 0.25],
  });

  const replacement = Buffer.from('black-2-grass-texture');
  const replaced = installSandGrassTransitions(sourcePack, sourceMeta, { grassTextureBytes: replacement });
  const replacedEntries = unzipSync(replaced.packBytes);
  assert.deepEqual(
    Buffer.from(replacedEntries[`runtime/textures/${grassMaterial.textureName}`]),
    replacement,
  );

  const metaManifest = readJson(unzipSync(first.metaBytes), 'manifest.json');
  assert.equal(metaManifest.sourceSha256, createHash('sha256').update(first.packBytes).digest('hex'));

  const second = installSandGrassTransitions(first.packBytes, first.metaBytes);
  assert.deepEqual(
    second.result.installed.map((item) => item.resortTileId),
    first.result.installed.map((item) => item.resortTileId),
  );
  const secondRuntime = readJson(unzipSync(second.packBytes), 'runtime/manifest.json');
  assert.equal(secondRuntime.tiles.length, firstRuntime.tiles.length);
  assert.equal(secondRuntime.materials.length, firstRuntime.materials.length);
  assert.equal(secondRuntime.textures.length, firstRuntime.textures.length);
});
