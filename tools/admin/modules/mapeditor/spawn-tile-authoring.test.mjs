import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ACTOR_SPAWN_SPECIAL,
  offsetSpawnTiles,
  pruneSpawnTiles,
  removeSpawnTile,
  setSpawnTile,
  spawnTileAt,
} from './spawn-tile-authoring.js';

function mapOf(width = 4, height = 3) {
  return { terrain: { special: Array.from({ length: height }, () => Array(width).fill(0)) } };
}

test('actor spawn tile stores its allowed occupant separately from terrain special', () => {
  const map = mapOf();
  setSpawnTile(map, 2, 1, 'npc_with_partner');
  assert.equal(map.terrain.special[1][2], ACTOR_SPAWN_SPECIAL);
  assert.equal(spawnTileAt(map, 2, 1).allows, 'npc_with_partner');
  setSpawnTile(map, 2, 1, 'npc_without_pokemon');
  assert.equal(map.spawnTiles.length, 1);
  assert.equal(spawnTileAt(map, 2, 1).allows, 'npc_without_pokemon');
  assert.equal(removeSpawnTile(map, 2, 1), true);
  assert.equal(map.terrain.special[1][2], 0);
});

test('actor spawn metadata follows expansion and is pruned by resize', () => {
  const map = mapOf();
  setSpawnTile(map, 3, 2, 'pokemon_random_from_boxes');
  offsetSpawnTiles(map, 2, 1);
  assert.deepEqual(map.spawnTiles[0].tile, [5, 3]);
  pruneSpawnTiles(map, 5, 3);
  assert.deepEqual(map.spawnTiles, []);
});
