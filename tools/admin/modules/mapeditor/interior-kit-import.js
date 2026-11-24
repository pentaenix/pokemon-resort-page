import { strFromU8, unzipSync } from 'fflate';

export function validateRaeInteriorKitManifest(manifest) {
  if (!manifest || manifest.format !== 'rae.gen5InteriorKit' || Number(manifest.version) !== 1) {
    throw new Error('Select a RAE Gen 5 interior kit archive (rae.gen5InteriorKit version 1).');
  }
  if (!Array.isArray(manifest.parts) || !manifest.parts.length) {
    throw new Error('The interior kit manifest contains no reusable parts.');
  }
  for (const part of manifest.parts) {
    if (!part?.id || !part?.glb || !part?.role) throw new Error('An interior kit part is missing id, role, or GLB path.');
  }
  return manifest;
}

export function validateRaeInteriorTileKitManifest(manifest) {
  if (!manifest || manifest.format !== 'rae.gen5InteriorTileKit' || Number(manifest.version) !== 1) {
    throw new Error('Select a RAE Gen 5 interior tile kit archive (rae.gen5InteriorTileKit version 1).');
  }
  if (!Array.isArray(manifest.tiles) || !manifest.tiles.length) {
    throw new Error('The interior tile kit manifest contains no tiles.');
  }
  for (const tile of manifest.tiles) {
    if (!tile?.id || !tile?.bundle || !tile?.role) {
      throw new Error('An interior tile is missing id, role, or .tile bundle path.');
    }
  }
  return manifest;
}

const DEFAULT_INTERIOR_TABS = Object.freeze({
  floor: { id: 'interior_floors', name: 'Interior Floors' },
  wall: { id: 'interior_walls', name: 'Interior Walls' },
  window: { id: 'interior_walls', name: 'Interior Walls' },
  entrance: { id: 'interior_entrances', name: 'Interior Entrances' },
  stairs: { id: 'interior_stairs', name: 'Interior Stairs' },
  shadow: { id: 'interior_shadows', name: 'Interior Shadows' },
});

export function interiorTileTab(tile) {
  const suggested = tile?.suggestedTab;
  if (suggested?.id && suggested?.name) return { id: String(suggested.id), name: String(suggested.name) };
  return DEFAULT_INTERIOR_TABS[tile?.role] || { id: 'interior_details', name: 'Interior Details' };
}

export function groupInteriorTilesByTab(tiles) {
  const groups = new Map();
  for (const tile of tiles || []) {
    const tab = interiorTileTab(tile);
    if (!groups.has(tab.id)) groups.set(tab.id, { ...tab, tiles: [] });
    groups.get(tab.id).tiles.push(tile);
  }
  return [...groups.values()];
}

export function ensureInteriorTileTabs(document, groups) {
  if (!document || !Array.isArray(document.tabs)) throw new Error('The RTPKS authoring document has no tabs.');
  let changed = false;
  for (const group of groups || []) {
    if (document.tabs.some((tab) => tab.id === group.id)) continue;
    document.tabs.push({ id: group.id, name: group.name, order: document.tabs.length, tileIds: [] });
    changed = true;
  }
  return changed;
}

export function chunkInteriorTiles(tiles, maximum = 128) {
  const size = Math.max(1, Number(maximum) || 128);
  const chunks = [];
  for (let index = 0; index < (tiles || []).length; index += size) {
    chunks.push(tiles.slice(index, index + size));
  }
  return chunks;
}

export function interiorKitModelId(manifest, part) {
  const source = String(manifest.source?.mapFileIndex || 'map');
  const suffix = String(part.id || 'part').toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
  return `interior_${source}_${suffix}`;
}

export function parseRaeInteriorKitArchive(buffer) {
  const entries = unzipSync(new Uint8Array(buffer));
  const tileManifestEntry = entries['interior-tile-kit.json'];
  if (tileManifestEntry) {
    const manifest = validateRaeInteriorTileKitManifest(JSON.parse(strFromU8(tileManifestEntry)));
    const tiles = manifest.tiles.map((tile) => {
      const bytes = entries[tile.bundle] || entries[`tiles/${String(tile.bundle).split('/').pop()}`];
      if (!bytes) throw new Error(`The archive is missing ${tile.bundle}.`);
      return { ...tile, bytes };
    });
    return { kind: 'tiles', manifest, tiles };
  }
  const manifestEntry = entries['interior-kit.json'];
  if (!manifestEntry) throw new Error('The archive is missing interior-kit.json.');
  const manifest = validateRaeInteriorKitManifest(JSON.parse(strFromU8(manifestEntry)));
  const parts = manifest.parts.map((part) => {
    const bytes = entries[part.glb] || entries[`parts/${String(part.glb).split('/').pop()}`];
    if (!bytes) throw new Error(`The archive is missing ${part.glb}.`);
    return { ...part, bytes, modelId: interiorKitModelId(manifest, part) };
  });
  return { kind: 'models', manifest, parts };
}
