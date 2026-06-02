/**
 * Overworld map (.owmap) binary format v1 — matches pokemon-resort terrain arrays.
 *
 * Layout (little-endian):
 *   magic "OWM1" (4)
 *   version u16 = 1
 *   width u16, height u16
 *   tileSize f32
 *   metaLen u32
 *   metaJson UTF-8 (map metadata without terrain grids)
 *   height[W*H] u8 row-major (y, then x)
 *   special[W*H] u8
 *   collision ceil(W*H/8) bytes, bit0 = cell (x,y) at y*W+x
 */

const MAGIC = 0x4f574d31; // 'OWM1'
const VERSION = 1;

export function emptyMap(width = 16, height = 16) {
  const h = createGrid(height, width, 0);
  const s = createGrid(height, width, 0);
  const c = createGrid(height, width, 0);
  return {
    id: 'new_map',
    name: 'New Map',
    type: 'exterior',
    visual: { mesh: '', format: 'none', material: '', textureDirectory: '', origin: [0, 0, 0], scale: 1 },
    grid: { enabled: true, tileSize: 16, width, height },
    player: { character: 'assets/overworld/characters/watanabe.character.json', spawnTile: [Math.floor(width / 2), Math.floor(height / 2)], spawnHeight: 0, facing: 'south' },
    camera: { preset: 'gen4_platinum_default_exterior' },
    lighting: { preset: 'gen4_default_exterior', brightness: 0.95, tint: [1, 1, 1] },
    collision: { enabled: false },
    terrain: { height: h, special: s, collision: c },
    characters: [],
    models: [],
  };
}

export function createGrid(rows, cols, fill = 0) {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => fill));
}

export function resizeMap(map, width, height) {
  const next = emptyMap(width, height);
  const copyLayer = (src, fill = 0) => {
    const out = createGrid(height, width, fill);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        out[y][x] = src?.[y]?.[x] ?? fill;
      }
    }
    return out;
  };
  next.id = map.id;
  next.name = map.name;
  next.type = map.type;
  next.visual = { ...map.visual };
  next.grid = { ...map.grid, width, height };
  next.player = { ...map.player, spawnTile: [...(map.player?.spawnTile || [0, 0])] };
  next.camera = { ...map.camera };
  next.lighting = { ...map.lighting };
  next.collision = { ...map.collision };
  next.characters = [...(map.characters || [])];
  next.models = [...(map.models || [])];
  next.terrain.height = copyLayer(map.terrain?.height, 0);
  next.terrain.special = copyLayer(map.terrain?.special, 0);
  next.terrain.collision = copyLayer(map.terrain?.collision, 0);
  const sx = Math.min(width - 1, Math.max(0, next.player.spawnTile[0]));
  const sy = Math.min(height - 1, Math.max(0, next.player.spawnTile[1]));
  next.player.spawnTile = [sx, sy];
  return next;
}

function stripTerrainForMeta(map) {
  const { terrain, ...rest } = map;
  return rest;
}

function packU8Grid(grid, width, height) {
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      out[y * width + x] = clampU8(grid?.[y]?.[x] ?? 0);
    }
  }
  return out;
}

function unpackU8Grid(bytes, width, height) {
  const grid = createGrid(height, width, 0);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      grid[y][x] = bytes[y * width + x] ?? 0;
    }
  }
  return grid;
}

function packCollisionBits(grid, width, height) {
  const byteLen = Math.ceil((width * height) / 8);
  const out = new Uint8Array(byteLen);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (grid?.[y]?.[x]) {
        const i = y * width + x;
        out[i >> 3] |= 1 << (i & 7);
      }
    }
  }
  return out;
}

function unpackCollisionBits(bytes, width, height) {
  const grid = createGrid(height, width, 0);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      grid[y][x] = (bytes[i >> 3] >> (i & 7)) & 1;
    }
  }
  return grid;
}

function clampU8(v) {
  const n = Number(v) || 0;
  return Math.max(0, Math.min(255, Math.round(n)));
}

export function encodeOwmap(map) {
  const width = map.grid?.width || map.terrain?.height?.[0]?.length || 16;
  const height = map.grid?.height || map.terrain?.height?.length || 16;
  const tileSize = Number(map.grid?.tileSize) || 16;
  const metaJson = JSON.stringify(stripTerrainForMeta(map));
  const metaBytes = new TextEncoder().encode(metaJson);
  const heightBytes = packU8Grid(map.terrain.height, width, height);
  const specialBytes = packU8Grid(map.terrain.special, width, height);
  const collisionBytes = packCollisionBits(map.terrain.collision, width, height);
  const header = 4 + 2 + 2 + 2 + 4 + 4;
  const total = header + metaBytes.length + heightBytes.length + specialBytes.length + collisionBytes.length;
  const buf = new ArrayBuffer(total);
  const view = new DataView(buf);
  let o = 0;
  view.setUint32(o, MAGIC, true); o += 4;
  view.setUint16(o, VERSION, true); o += 2;
  view.setUint16(o, width, true); o += 2;
  view.setUint16(o, height, true); o += 2;
  view.setFloat32(o, tileSize, true); o += 4;
  view.setUint32(o, metaBytes.length, true); o += 4;
  const bytes = new Uint8Array(buf);
  bytes.set(metaBytes, o); o += metaBytes.length;
  bytes.set(heightBytes, o); o += heightBytes.length;
  bytes.set(specialBytes, o); o += specialBytes.length;
  bytes.set(collisionBytes, o);
  return buf;
}

export function decodeOwmap(buffer) {
  const view = new DataView(buffer);
  if (view.byteLength < 18) throw new Error('File too small for .owmap');
  if (view.getUint32(0, true) !== MAGIC) throw new Error('Not an .owmap file (bad magic)');
  const version = view.getUint16(4, true);
  if (version !== VERSION) throw new Error(`Unsupported .owmap version ${version}`);
  const width = view.getUint16(6, true);
  const height = view.getUint16(8, true);
  const tileSize = view.getFloat32(10, true);
  const metaLen = view.getUint32(14, true);
  let o = 18;
  if (o + metaLen > view.byteLength) throw new Error('Corrupt .owmap metadata');
  const metaJson = new TextDecoder().decode(new Uint8Array(buffer, o, metaLen));
  o += metaLen;
  const cells = width * height;
  if (o + cells * 2 + Math.ceil(cells / 8) > view.byteLength) throw new Error('Corrupt .owmap terrain payload');
  const heightBytes = new Uint8Array(buffer, o, cells); o += cells;
  const specialBytes = new Uint8Array(buffer, o, cells); o += cells;
  const collisionBytes = new Uint8Array(buffer, o, Math.ceil(cells / 8));
  const meta = JSON.parse(metaJson);
  return {
    ...meta,
    grid: { ...(meta.grid || {}), enabled: meta.grid?.enabled !== false, tileSize, width, height },
    terrain: {
      height: unpackU8Grid(heightBytes, width, height),
      special: unpackU8Grid(specialBytes, width, height),
      collision: unpackCollisionBits(collisionBytes, width, height),
    },
  };
}

/** Import legacy JSON map (flat_bootstrap.map.json shape). */
export function mapFromJson(json) {
  const map = typeof json === 'string' ? JSON.parse(json) : json;
  const width = map.grid?.width || map.terrain?.height?.[0]?.length || 16;
  const height = map.grid?.height || map.terrain?.height?.length || 16;
  const norm = (grid, fill = 0) => {
    const rows = createGrid(height, width, fill);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        rows[y][x] = clampU8(grid?.[y]?.[x] ?? fill);
      }
    }
    return rows;
  };
  return {
    ...emptyMap(width, height),
    ...map,
    grid: { enabled: true, tileSize: Number(map.grid?.tileSize) || 16, width, height },
    terrain: {
      height: norm(map.terrain?.height, 0),
      special: norm(map.terrain?.special, 0),
      collision: norm(map.terrain?.collision, 0),
    },
  };
}

export function mapToJson(map) {
  return JSON.stringify(map, null, 2);
}
