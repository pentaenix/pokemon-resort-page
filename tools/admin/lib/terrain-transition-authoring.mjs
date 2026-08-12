import { transformEditableTilePack } from './tile-pack-authoring.mjs';
import { transitionMasks } from '../modules/mapeditor/terrain-transitions.js';

const FAMILY = 'sand-grass';
const BODY_MASK = 255;
const MICRO_SIZE = 16;

function jsonBytes(value) {
  return new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);
}

function nextId(values) {
  return values.reduce((max, value) => Math.max(max, Number(value) || 0), -1) + 1;
}

function edgeInset(index, salt) {
  const waves = [3, 3, 2, 2, 3, 2, 2, 3, 3, 2, 3, 2, 2, 3, 2, 3];
  return waves[(index + salt) % waves.length];
}

function grassMicrocell(mask, column, row) {
  const north = (mask & 1) !== 0;
  const east = (mask & 2) !== 0;
  const south = (mask & 4) !== 0;
  const west = (mask & 8) !== 0;
  if (!north && row < edgeInset(column, 0)) return false;
  if (!east && column >= MICRO_SIZE - edgeInset(row, 5)) return false;
  if (!south && row >= MICRO_SIZE - edgeInset(column, 9)) return false;
  if (!west && column < edgeInset(row, 13)) return false;
  if (north && west && !(mask & 16) && column + row < 5) return false;
  if (north && east && !(mask & 32) && (MICRO_SIZE - 1 - column) + row < 5) return false;
  if (south && east && !(mask & 64) && (MICRO_SIZE - 1 - column) + (MICRO_SIZE - 1 - row) < 5) return false;
  if (south && west && !(mask & 128) && column + (MICRO_SIZE - 1 - row) < 5) return false;
  return true;
}

function pushQuad(mesh, x0, z0, x1, z1, height, materialId, uvForPoint) {
  const quadStart = mesh.quads.length / 12;
  mesh.quads.push(x0, z1, height, x0, z0, height, x1, z0, height, x1, z1, height);
  for (const [x, z] of [[x0, z1], [x0, z0], [x1, z0], [x1, z1]]) {
    mesh.texCoordsQuad.push(...uvForPoint(x, z));
    mesh.normalCoordsQuad.push(0, 0, 1);
    mesh.colorsQuad.push(1, 1, 1);
  }
  mesh.materialRanges.push({ materialId, triStart: 0, triCount: 0, quadStart, quadCount: 1 });
}

function mergeMaterialRanges(ranges) {
  const merged = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (previous?.materialId === range.materialId && previous.quadStart + previous.quadCount === range.quadStart) {
      previous.quadCount += range.quadCount;
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

export function buildSandGrassTransitionMesh(mask, sandMaterialId, grassMaterialId) {
  const mesh = {
    width: 1,
    height: 1,
    xOffset: 0,
    yOffset: 0,
    triangles: [],
    quads: [],
    texCoordsTri: [],
    texCoordsQuad: [],
    normalCoordsTri: [],
    normalCoordsQuad: [],
    colorsTri: [],
    colorsQuad: [],
    textureIds: [sandMaterialId, grassMaterialId],
    materialRanges: [],
  };
  for (let row = 0; row < MICRO_SIZE; row += 1) {
    let start = 0;
    let previousFilled = null;
    for (let column = 0; column <= MICRO_SIZE; column += 1) {
      // RTPKS mesh Y runs opposite map Z: source Y=1 is the north edge of a
      // placed tile and source Y=0 is its south edge. Build the mask in map
      // coordinates so north/south transition bits do not render inverted.
      const mapRow = MICRO_SIZE - 1 - row;
      const filled = column < MICRO_SIZE && grassMicrocell(mask, column, mapRow);
      if (previousFilled == null) previousFilled = filled;
      if (column === MICRO_SIZE || filled !== previousFilled) {
        const x0 = start / MICRO_SIZE;
        const x1 = column / MICRO_SIZE;
        const z0 = row / MICRO_SIZE;
        const z1 = (row + 1) / MICRO_SIZE;
        if (previousFilled) {
          pushQuad(mesh, x0, z0, x1, z1, 0, grassMaterialId, (x, z) => [x * 0.25, 1.25 - (z * 0.25)]);
        } else {
          pushQuad(mesh, x0, z0, x1, z1, 0, sandMaterialId, (x, z) => [x, z]);
        }
        start = column;
        previousFilled = filled;
      }
    }
  }
  mesh.materialRanges = mergeMaterialRanges(mesh.materialRanges);
  return mesh;
}

function transitionProperties(mask, sandTileId, grassTileId) {
  return {
    'source.platform': 'nds',
    'source.game': 'pokemon-black-2',
    'transition.family': FAMILY,
    'transition.mask': mask,
    'transition.baseTileId': sandTileId,
    'transition.overlayTileId': grassTileId,
  };
}

function authoredTile({ id, localIndex, mask, tabId, sandTileId, grassTileId }) {
  const suffix = mask.toString(16).padStart(2, '0');
  return {
    resortTileId: id,
    localIndex,
    key: `sand_grass_transition_${suffix}`,
    name: `Sand + Grass Transition ${suffix.toUpperCase()}`,
    tabId,
    width: 1,
    height: 1,
    xOffset: 0,
    yOffset: 0,
    xTileable: false,
    yTileable: false,
    uTileable: false,
    vTileable: false,
    globalTexMapping: false,
    globalTexScale: 1,
    tags: ['surface.grass', 'terrain.ground', 'terrain.transition', 'traversal.walk'],
    properties: transitionProperties(mask, sandTileId, grassTileId),
    animation: { type: 'none' },
    collision: { mode: 'none', autoApply: false, clearOnErase: false, mask: [[false]] },
  };
}

function runtimeTile(authored, mesh) {
  return {
    resortTileId: authored.resortTileId,
    localIndex: authored.localIndex,
    width: 1,
    height: 1,
    materialCount: 2,
    vertexCount: mesh.quads.length / 3,
    triangleCount: mesh.quads.length / 6,
    name: authored.name,
    tags: authored.tags,
    properties: authored.properties,
    animation: authored.animation,
    collision: authored.collision,
  };
}

function requireTile(pack, id, label) {
  const tile = pack.runtime.tiles.find((item) => Number(item.resortTileId) === Number(id));
  if (!tile) throw new Error(`${label} tile ${id} was not found in the RTPKS.`);
  return tile;
}

function soleMaterialId(pack, tileId, label) {
  const bytes = pack.entries[`runtime/meshes/tile_${tileId}.json`];
  if (!bytes) throw new Error(`${label} tile ${tileId} has no runtime mesh.`);
  const mesh = JSON.parse(Buffer.from(bytes).toString('utf8'));
  const ids = [...new Set((mesh.materialRanges || []).map((range) => Number(range.materialId)))];
  if (ids.length !== 1) throw new Error(`${label} tile ${tileId} must use exactly one material.`);
  return ids[0];
}

export function installSandGrassTransitions(packBuffer, metaBuffer, options = {}) {
  const sandTileId = Number(options.sandTileId ?? 103);
  const grassTileId = Number(options.grassTileId ?? 3322);
  const tabId = String(options.tabId || 'grass_transitions');
  return transformEditableTilePack(packBuffer, metaBuffer, (pack) => {
    requireTile(pack, sandTileId, 'Sand');
    const grassRuntime = requireTile(pack, grassTileId, 'Grass');
    const grassEditor = pack.editorMeta.tiles.find((tile) => Number(tile.resortTileId) === grassTileId);
    const grassDocument = pack.document.tiles.find((tile) => Number(tile.resortTileId) === grassTileId);
    if (!grassEditor || !grassDocument) throw new Error(`Grass tile ${grassTileId} has no editor metadata.`);
    const sandMaterialId = soleMaterialId(pack, sandTileId, 'Sand');
    const grassMaterialId = soleMaterialId(pack, grassTileId, 'Grass');
    const grassMaterial = pack.runtime.materials.find((material) => Number(material.materialId) === grassMaterialId);
    if (!grassMaterial) throw new Error(`Grass material ${grassMaterialId} was not found in the RTPKS.`);
    if (options.grassTextureBytes) {
      const textureName = String(grassMaterial.textureName || '');
      const texturePath = `runtime/textures/${textureName}`;
      if (!textureName || !pack.entries[texturePath]) {
        throw new Error(`Grass material ${grassMaterialId} has no embedded runtime texture.`);
      }
      pack.entries[texturePath] = new Uint8Array(options.grassTextureBytes);
    }
    // The extracted 64 px grass texture contains a 4x4 world-space pattern.
    // Continue its quarter-texture UVs across cells instead of restarting the
    // same quadrant on every tile. This matches the working water surface.
    grassMaterial.uvMapping = {
      mode: 'world',
      uPerTile: [0.25, 0],
      vPerTile: [0, 0.25],
    };
    const brushProperties = {
      ...grassEditor.properties,
      'transition.family': FAMILY,
      'transition.mask': BODY_MASK,
      'transition.brushFamily': FAMILY,
      'transition.baseTileId': sandTileId,
      'transition.overlayTileId': grassTileId,
    };
    for (const tile of [grassRuntime, grassEditor, grassDocument]) tile.properties = { ...brushProperties };

    let tab = pack.document.tabs.find((item) => item.id === tabId);
    if (!tab) {
      tab = { id: tabId, name: 'Grass Transitions', order: pack.document.tabs.length, tileIds: [] };
      pack.document.tabs.push(tab);
    }
    const existingByMask = new Map(pack.editorMeta.tiles
      .filter((tile) => tile.properties?.['transition.family'] === FAMILY && Number(tile.resortTileId) !== grassTileId)
      .map((tile) => [Number(tile.properties['transition.mask']), tile]));
    let nextResortId = nextId(pack.tileIndex.entries.map((entry) => entry.resortTileId));
    let nextLocalIndex = nextId(pack.tileIndex.entries.map((entry) => entry.localIndex));
    const installed = [];

    for (const mask of transitionMasks().filter((value) => value !== BODY_MASK)) {
      const existing = existingByMask.get(mask);
      const id = existing ? Number(existing.resortTileId) : nextResortId++;
      const localIndex = existing ? Number(existing.localIndex) : nextLocalIndex++;
      const authored = authoredTile({ id, localIndex, mask, tabId, sandTileId, grassTileId });
      const mesh = buildSandGrassTransitionMesh(mask, sandMaterialId, grassMaterialId);
      const replaceById = (items, value) => {
        const index = items.findIndex((item) => Number(item.resortTileId) === id);
        if (index >= 0) items[index] = value;
        else items.push(value);
      };
      replaceById(pack.editorMeta.tiles, authored);
      replaceById(pack.document.tiles, authored);
      replaceById(pack.runtime.tiles, runtimeTile(authored, mesh));
      const indexEntry = pack.tileIndex.entries.find((entry) => Number(entry.resortTileId) === id);
      if (indexEntry) Object.assign(indexEntry, { localIndex, resortTileId: id, key: authored.key, status: 'active' });
      else pack.tileIndex.entries.push({ localIndex, resortTileId: id, key: authored.key, status: 'active' });
      pack.entries[`runtime/meshes/tile_${id}.json`] = jsonBytes(mesh);
      installed.push({ mask, resortTileId: id });
    }
    tab.tileIds = installed.map((item) => item.resortTileId);
    return { family: FAMILY, sandTileId, grassTileId, sandMaterialId, grassMaterialId, installed };
  });
}
