#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { replaceTabWithClonedTiles } from '../lib/tile-pack-authoring.mjs';

const [packPath, metaPath, oceanExportDir, featureExportDir] = process.argv.slice(2);
if (![packPath, metaPath, oceanExportDir, featureExportDir].every(Boolean)) {
  console.error('Usage: node rebuild-ocean-water-tab.mjs <pack.rtpks> <pack.rtpks.meta> <ocean-export-dir> <feature-export-dir>');
  process.exit(2);
}

const bundle = (directory, name) => fs.readFileSync(path.join(directory, name));
const cornerProperties = (family, shape, direction) => ({
  'ocean.family': family,
  'ocean.shape': shape,
  'ocean.direction': direction,
});
const edgeProperties = (family, direction) => ({
  'ocean.family': family,
  'ocean.shape': 'straight',
  'ocean.direction': direction,
});
const beachTags = ['surface.water', 'terrain.beach', 'transition.coast'];
const rockTags = ['surface.water', 'terrain.rock', 'transition.coast'];

// The Default shoreline grammar (117-130) is the proven post-import runtime
// geometry: correct 3x3/3x1 footprints, directions, UV islands, heights, and
// exact 16 px-per-tile previews. Clone that geometry into independent Water-tab
// materials, then attach RAE's decoded DS motion timelines by material name.
const specs = [
  { sourceTileId: 130, name: 'Ocean Beach Convex Corner NW', tags: beachTags, properties: cornerProperties('beach', 'convex-corner', 'north-west') },
  { sourceTileId: 129, name: 'Ocean Beach Convex Corner NE', tags: beachTags, properties: cornerProperties('beach', 'convex-corner', 'north-east') },
  { sourceTileId: 128, name: 'Ocean Beach Convex Corner SW', tags: beachTags, properties: cornerProperties('beach', 'convex-corner', 'south-west') },
  { sourceTileId: 127, name: 'Ocean Beach Convex Corner SE', tags: beachTags, properties: cornerProperties('beach', 'convex-corner', 'south-east') },
  { sourceTileId: 124, name: 'Ocean Beach Concave Corner NW', tags: beachTags, properties: cornerProperties('beach', 'concave-corner', 'north-west') },
  { sourceTileId: 126, name: 'Ocean Beach Concave Corner NE', tags: beachTags, properties: cornerProperties('beach', 'concave-corner', 'north-east') },
  { sourceTileId: 117, name: 'Ocean Beach Concave Corner SW', tags: beachTags, properties: cornerProperties('beach', 'concave-corner', 'south-west') },
  { sourceTileId: 119, name: 'Ocean Beach Concave Corner SE', tags: beachTags, properties: cornerProperties('beach', 'concave-corner', 'south-east') },
  { sourceTileId: 125, name: 'Ocean Beach Straight North', tags: beachTags, properties: edgeProperties('beach', 'north') },
  { sourceTileId: 120, name: 'Ocean Beach Straight West', tags: beachTags, properties: edgeProperties('beach', 'west') },
  { sourceTileId: 122, name: 'Ocean Beach Straight East', tags: beachTags, properties: edgeProperties('beach', 'east') },
  { sourceTileId: 118, name: 'Ocean Beach Straight South', tags: beachTags, properties: edgeProperties('beach', 'south') },
  {
    tileBundle: bundle(oceanExportDir, 'ocean_water_body.tile'),
    previewSourceTileId: 121,
    name: 'Open Ocean Water Body',
    width: 1,
    height: 1,
    renderMode: 'blend',
    tags: ['surface.water', 'terrain.ocean', 'traversal.swim'],
    properties: { 'ocean.family': 'body', 'ocean.shape': 'body' },
  },
  { sourceTileId: 1517, name: 'Ocean Rock Inner Corner NW', tags: rockTags, properties: cornerProperties('rock', 'inner-corner', 'north-west') },
  { sourceTileId: 1519, name: 'Ocean Rock Inner Corner NE', tags: rockTags, properties: cornerProperties('rock', 'inner-corner', 'north-east') },
  { sourceTileId: 1533, name: 'Ocean Rock Inner Corner SW', tags: rockTags, properties: cornerProperties('rock', 'inner-corner', 'south-west') },
  { sourceTileId: 1535, name: 'Ocean Rock Inner Corner SE', tags: rockTags, properties: cornerProperties('rock', 'inner-corner', 'south-east') },
  { sourceTileId: 1518, name: 'Ocean Rock Straight North', tags: rockTags, properties: edgeProperties('rock', 'north') },
  { sourceTileId: 1525, name: 'Ocean Rock Straight West', tags: rockTags, properties: edgeProperties('rock', 'west') },
  { sourceTileId: 1527, name: 'Ocean Rock Straight East', tags: rockTags, properties: edgeProperties('rock', 'east') },
  { sourceTileId: 1534, name: 'Ocean Rock Straight South', tags: rockTags, properties: edgeProperties('rock', 'south') },
  { sourceTileId: 1541, name: 'Ocean Rock Outer Corner SW', tags: rockTags, properties: cornerProperties('rock', 'outer-corner', 'south-west') },
  { sourceTileId: 1542, name: 'Ocean Rock Outer Corner SE', tags: rockTags, properties: cornerProperties('rock', 'outer-corner', 'south-east') },
  { sourceTileId: 1543, name: 'Ocean Rock Outer Corner NW', tags: rockTags, properties: cornerProperties('rock', 'outer-corner', 'north-west') },
  { sourceTileId: 1544, name: 'Ocean Rock Outer Corner NE', tags: rockTags, properties: cornerProperties('rock', 'outer-corner', 'north-east') },
  {
    sourceTileId: 1505,
    name: 'Ocean Shallow Water',
    tags: ['surface.water', 'terrain.shallow-water', 'traversal.surf'],
    properties: { 'ocean.family': 'shallow', 'ocean.shape': 'body' },
  },
  {
    tileBundle: bundle(featureExportDir, 'ocean_dive_spot.tile'),
    name: 'Ocean Dive Spot Field',
    width: 4,
    height: 4,
    renderMode: 'blend',
    tags: ['surface.water', 'terrain.ocean', 'interaction.dive-spot'],
    properties: { 'ocean.family': 'dive', 'ocean.shape': 'field' },
  },
];

const animationBundles = [
  bundle(oceanExportDir, 'ocean_beach_outer_corner_000.tile'),
  bundle(oceanExportDir, 'ocean_water_body.tile'),
  bundle(featureExportDir, 'ocean_rock_edge_source.tile'),
  bundle(featureExportDir, 'ocean_shallow_water.tile'),
];

const result = replaceTabWithClonedTiles(
  fs.readFileSync(packPath),
  fs.readFileSync(metaPath),
  specs,
  {
    tabId: 'water',
    animationBundles,
    // The Default/PDSMS runtime mesh uses negative V islands (-1..0). RAE's
    // GLB uses the equivalent flipped 0..1 convention, where clamp is valid.
    // Pairing its clamp sampler with the Default geometry collapses the whole
    // island to one edge texel (flat sand and blue stripes), so retain repeat
    // for these cloned runtime UVs.
    materialOverrides: {
      sea_zanami2: {
        sampler: { wrapS: 'repeat', wrapT: 'repeat', magFilter: 'nearest', minFilter: 'nearest' },
        animation: { frameDurationMs: 67, timebaseHz: 15, sourceTimebaseHz: 30, interpolation: 'step' },
      },
      sea_simi_1: {
        sampler: { wrapS: 'repeat', wrapT: 'repeat', magFilter: 'nearest', minFilter: 'nearest' },
        animation: { frameDurationMs: 67, timebaseHz: 15, sourceTimebaseHz: 30, interpolation: 'step' },
      },
      sea_zanami: {
        sampler: { wrapS: 'repeat', wrapT: 'repeat', magFilter: 'nearest', minFilter: 'nearest' },
        animation: { frameDurationMs: 67, timebaseHz: 15, sourceTimebaseHz: 30, interpolation: 'step' },
      },
      sea_mizu1: {
        animation: { frameDurationMs: 67, timebaseHz: 15, sourceTimebaseHz: 30, interpolation: 'step' },
      },
      sea_mizu1_1: {
        animation: { frameDurationMs: 67, timebaseHz: 15, sourceTimebaseHz: 30, interpolation: 'step' },
      },
    },
    materialBaselines: {
      35: { name: 'sea_mizu1_1', textureName: 'sea_mizu1_1.png', alpha: 15 },
      36: { name: 'sea_mizu1', textureName: 'sea_mizu1.png', alpha: 31 },
      37: { name: 'sea_zanami2', textureName: 'sea_zanami2.png', alpha: 31 },
      38: { name: 'sea_zanami', textureName: 'sea_zanami.png', alpha: 31 },
      39: { name: 'sea_simi_1', textureName: 'sea_simi_1.png', alpha: 31 },
      253: { name: 'sea_asase02', textureName: 'sea_asase02.png', alpha: 31 },
      255: { name: 'sea_gake02', textureName: 'sea_gake02.png', alpha: 31 },
    },
  },
);

const writeAtomic = (target, bytes) => {
  const temporary = `${target}.ocean-tmp`;
  fs.writeFileSync(temporary, bytes);
  fs.renameSync(temporary, target);
};
writeAtomic(packPath, result.packBytes);
writeAtomic(metaPath, result.metaBytes);

console.log(JSON.stringify({
  tabId: 'water',
  tileCount: result.resortTileIds.length,
  resortTileIds: result.resortTileIds,
  reusedTileIds: result.deactivatedTileIds,
}, null, 2));
