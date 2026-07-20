#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {
  addTilesToPack,
  loadEditableTilePack,
  saveTilePackDocument,
} from '../lib/tile-pack-authoring.mjs';

const [packPath, metaPath, exportDirectory] = process.argv.slice(2);
if (![packPath, metaPath, exportDirectory].every(Boolean)) {
  console.error('Usage: node import-grass-tile-tab.mjs <pack.rtpks> <pack.rtpks.meta> <RAE grass export directory>');
  process.exit(2);
}

const bundlePaths = fs.readdirSync(exportDirectory)
  .filter((name) => name.toLowerCase().endsWith('.tile'))
  .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
if (!bundlePaths.length) throw new Error(`No .tile bundles found in ${exportDirectory}.`);

let packBytes = fs.readFileSync(packPath);
let metaBytes = fs.readFileSync(metaPath);
const editable = loadEditableTilePack(packBytes, metaBytes);
if (!editable.document.tabs.some((tab) => tab.id === 'grass')) {
  editable.document.tabs.push({
    id: 'grass',
    name: 'Grass',
    order: editable.document.tabs.length,
    tileIds: [],
  });
  const created = saveTilePackDocument(packBytes, metaBytes, editable.document);
  packBytes = created.packBytes;
  metaBytes = created.metaBytes;
}

const items = bundlePaths.map((filename) => {
  const key = filename.toLowerCase();
  const ramp = key.includes('ramp');
  const wind = key.includes('wind_grass');
  const direction = key.match(/_(north|south|east|west|nw|ne|sw|se)(?:_|\.)/)?.[1];
  return {
    definition: {
      tabId: 'grass',
      tags: ramp
        ? ['surface.grass', 'terrain.ramp', 'traversal.walk']
        : wind
          ? ['surface.grass', 'terrain.tall-grass', 'effect.wind']
          : ['surface.grass', 'terrain.ground', 'traversal.walk'],
      properties: {
        'grass.family': ramp ? 'ramp' : wind ? 'wind' : 'ground',
        ...(ramp ? { 'grass.shape': key.includes('corner') ? 'corner' : 'straight' } : {}),
        ...(direction ? { 'grass.direction': direction } : {}),
      },
    },
    assets: { tileBundle: fs.readFileSync(path.join(exportDirectory, filename)) },
  };
});

const result = addTilesToPack(packBytes, metaBytes, items, {
  tabId: 'grass',
  replaceTab: true,
  preserveTileIds: true,
});

const writeAtomic = (target, bytes) => {
  const temporary = `${target}.grass-tmp`;
  fs.writeFileSync(temporary, bytes);
  fs.renameSync(temporary, target);
};
writeAtomic(packPath, result.packBytes);
writeAtomic(metaPath, result.metaBytes);

console.log(JSON.stringify({
  tabId: 'grass',
  tileCount: result.resortTileIds.length,
  resortTileIds: result.resortTileIds,
  replacedTileIds: result.deactivatedTileIds,
  bundles: bundlePaths,
}, null, 2));
