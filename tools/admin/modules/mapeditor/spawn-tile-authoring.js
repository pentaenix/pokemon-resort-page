export const ACTOR_SPAWN_SPECIAL = 14;

export const SPAWN_TILE_USES = Object.freeze([
  { id: 'pokemon_random_from_boxes', label: 'Random Pokémon from boxes' },
  { id: 'npc_with_partner', label: 'NPC with partner Pokémon' },
  { id: 'npc_without_pokemon', label: 'NPC without Pokémon' },
]);

export const DEFAULT_SPAWN_TILE_USE = SPAWN_TILE_USES[0].id;

export function validSpawnTileUse(value) {
  return SPAWN_TILE_USES.some((option) => option.id === value);
}

export function spawnTileAt(map, x, y) {
  return (map?.spawnTiles || []).find((entry) => entry?.tile?.[0] === x && entry?.tile?.[1] === y) || null;
}

export function setSpawnTile(map, x, y, allows = DEFAULT_SPAWN_TILE_USE) {
  if (!map?.terrain?.special?.[y]) return null;
  const normalizedUse = validSpawnTileUse(allows) ? allows : DEFAULT_SPAWN_TILE_USE;
  map.spawnTiles = Array.isArray(map.spawnTiles) ? map.spawnTiles : [];
  let entry = spawnTileAt(map, x, y);
  if (!entry) {
    entry = { id: `actor_spawn_${x}_${y}`, tile: [x, y], allows: normalizedUse };
    map.spawnTiles.push(entry);
  } else {
    entry.allows = normalizedUse;
  }
  map.terrain.special[y][x] = ACTOR_SPAWN_SPECIAL;
  return entry;
}

export function removeSpawnTile(map, x, y, { clearSpecial = true } = {}) {
  if (!map) return false;
  const before = Array.isArray(map.spawnTiles) ? map.spawnTiles.length : 0;
  map.spawnTiles = (map.spawnTiles || []).filter((entry) => entry?.tile?.[0] !== x || entry?.tile?.[1] !== y);
  if (clearSpecial && map.terrain?.special?.[y]?.[x] === ACTOR_SPAWN_SPECIAL) {
    map.terrain.special[y][x] = 0;
  }
  return map.spawnTiles.length !== before;
}

export function pruneSpawnTiles(map, width, height) {
  if (!map) return;
  map.spawnTiles = (map.spawnTiles || []).filter((entry) => {
    const [x, y] = entry?.tile || [];
    return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < width && y < height;
  });
}

export function offsetSpawnTiles(map, offsetX, offsetY) {
  for (const entry of map?.spawnTiles || []) {
    if (!Array.isArray(entry.tile)) continue;
    entry.tile = [entry.tile[0] + offsetX, entry.tile[1] + offsetY];
  }
}
