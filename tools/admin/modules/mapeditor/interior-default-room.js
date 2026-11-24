const DEFAULT_STYLE = Object.freeze({
  wallHeightTiles: 2,
  frontWallHeightTiles: 0.35,
  trimHeightTiles: 0.125,
  floorA: [72, 80, 94],
  floorB: [80, 89, 104],
  wallNS: [58, 64, 78],
  wallEW: [52, 58, 72],
  trim: [96, 104, 122],
  baseboard: [42, 47, 58],
});

function rgb(value, fallback) {
  if (!Array.isArray(value) || value.length < 3) return [...fallback];
  return value.slice(0, 3).map((component, index) => {
    const number = Number(component);
    return Number.isFinite(number) ? Math.max(0, Math.min(255, number)) : fallback[index];
  });
}

export function defaultInteriorRoomStyle(map) {
  if (map?.type !== 'interior' || map?.interior?.shellModelId) return null;
  const room = map?.interior?.defaultRoom;
  if (room?.enabled === false) return null;
  const floor = room?.floorColors || {};
  const walls = room?.wallColors || {};
  return {
    wallHeightTiles: Math.max(0, Number(room?.wallHeightTiles ?? DEFAULT_STYLE.wallHeightTiles)),
    frontWallHeightTiles: Math.max(0, Number(room?.frontWallHeightTiles ?? DEFAULT_STYLE.frontWallHeightTiles)),
    trimHeightTiles: Math.max(0, Number(room?.trimHeightTiles ?? DEFAULT_STYLE.trimHeightTiles)),
    floorA: rgb(floor.checkerA, DEFAULT_STYLE.floorA),
    floorB: rgb(floor.checkerB, DEFAULT_STYLE.floorB),
    wallNS: rgb(walls.northSouth, DEFAULT_STYLE.wallNS),
    wallEW: rgb(walls.eastWest, DEFAULT_STYLE.wallEW),
    trim: rgb(walls.trim, DEFAULT_STYLE.trim),
    baseboard: rgb(walls.baseboard, DEFAULT_STYLE.baseboard),
  };
}

export function interiorOpeningCovers(map, edge, along) {
  return (map?.interior?.openings || []).some((opening) => (
    opening?.edge === edge && along >= Number(opening.from ?? 0) &&
    along <= Number(opening.to ?? opening.from ?? 0)
  ));
}

export function createBlankInteriorMap(baseMap, {
  id = 'new_interior',
  name = 'New Interior',
} = {}) {
  return {
    ...baseMap,
    id,
    name,
    type: 'interior',
    environment: {
      space: `interior:${id}`,
      clearColor: [0, 0, 0, 255],
      renderOtherSpaces: false,
    },
    interior: {
      shellModelId: '',
      floorDatum: 0,
      gridOrigin: [0, 0],
      openings: [],
      defaultRoom: {
        enabled: true,
        wallHeightTiles: DEFAULT_STYLE.wallHeightTiles,
        frontWallHeightTiles: DEFAULT_STYLE.frontWallHeightTiles,
        trimHeightTiles: DEFAULT_STYLE.trimHeightTiles,
      },
    },
  };
}
