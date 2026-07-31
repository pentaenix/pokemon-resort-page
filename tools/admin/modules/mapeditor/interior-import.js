const DIRECTIONS = new Set(['north', 'east', 'south', 'west']);

export function validateRaeInteriorMetadata(metadata) {
  if (!metadata || metadata.format !== 'rae.gen5Interior' || Number(metadata.version) !== 1) {
    throw new Error('Select a RAE Gen 5 interior metadata file (rae.gen5Interior version 1).');
  }
  const [width, height] = metadata.gridSize || [];
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 128 || height > 128) {
    throw new Error('Interior gridSize must contain integer dimensions from 1 to 128.');
  }
  if (Number(metadata.tileSize) !== 16) {
    throw new Error(`Pokemon Resort currently requires 16-unit interior tiles (received ${metadata.tileSize}).`);
  }
  const entrance = metadata.entrance || {};
  if (!DIRECTIONS.has(entrance.edge) || !Array.isArray(entrance.arrivalTile) || !Array.isArray(entrance.returnTriggerTile)) {
    throw new Error('Interior metadata is missing a directional entrance and its arrival/return tiles.');
  }
  return metadata;
}

function denseGrid(width, height, value) {
  return Array.from({ length: height }, () => Array.from({ length: width }, () => value));
}

function normalizedMask(mask, width, height, fallback) {
  return Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => (
    Number(mask?.[y]?.[x] ?? fallback) ? 1 : 0
  )));
}

function normalizedHeightMask(mask, width, height) {
  return Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => (
    Math.max(0, Math.min(255, Math.round(Number(mask?.[y]?.[x]) || 0)))
  )));
}

function entranceOpening(entrance) {
  const along = entrance.edge === 'north' || entrance.edge === 'south'
    ? Number(entrance.tile?.[0]) || 0
    : Number(entrance.tile?.[1]) || 0;
  return { edge: entrance.edge, from: along, to: along };
}

export function createMapFromRaeInterior(baseMap, metadata, {
  mapId,
  modelId,
  modelGlbPath,
  displayName,
} = {}) {
  validateRaeInteriorMetadata(metadata);
  const [width, height] = metadata.gridSize;
  const [originX, originZ] = metadata.gridOrigin || [0, 0];
  const floorDatum = Number(metadata.floorDatum) || 0;
  const heightStep = Math.max(1, Number(metadata.heightStep) || 16);
  const heightMask = normalizedHeightMask(metadata.heightMask, width, height);
  const entrance = metadata.entrance;
  const id = String(mapId || `interior_${metadata.source?.mapFileIndex || 'map'}`);
  const shellId = String(modelId || `${id}_shell`);
  const arrivalFacing = DIRECTIONS.has(entrance.arrivalFacing) ? entrance.arrivalFacing : 'north';
  const exitDirection = DIRECTIONS.has(entrance.exitDirection) ? entrance.exitDirection : entrance.edge;
  return {
    ...baseMap,
    id,
    name: displayName || `Interior ${metadata.source?.mapFileIndex || ''}`.trim(),
    type: 'interior',
    environment: {
      space: `interior:${id}`,
      clearColor: [0, 0, 0, 255],
      renderOtherSpaces: false,
    },
    interior: {
      shellModelId: shellId,
      floorDatum,
      primaryFloorDatum: Number(metadata.primaryFloorDatum ?? floorDatum),
      gridOrigin: [Number(originX) || 0, Number(originZ) || 0],
      openings: [entranceOpening(entrance)],
      source: metadata.source || {},
      materialRoles: metadata.materialRoles || {},
      surfaceHeightMask: metadata.surfaceHeightMask || [],
      ambiguousFloorCells: metadata.ambiguousFloorCells || [],
    },
    grid: { ...(baseMap.grid || {}), enabled: true, tileSize: 16, width, height },
    player: {
      ...(baseMap.player || {}),
      spawnTile: [...entrance.tile],
      spawnHeight: (heightMask?.[entrance.tile?.[1]]?.[entrance.tile?.[0]] || 0) * heightStep,
      facing: arrivalFacing,
    },
    terrainVisual: {
      ...(baseMap.terrainVisual || {}),
      floorHeightScale: heightStep,
    },
    terrain: {
      height: heightMask,
      special: denseGrid(width, height, 0),
      collision: normalizedMask(metadata.blockedMask, width, height, 1),
    },
    models: [{
      id: shellId,
      glb: modelGlbPath,
      position: [-(Number(originX) || 0), -floorDatum, -(Number(originZ) || 0)],
      yawDeg: 0,
      scale: 1,
    }],
    anchors: [{ id: 'inside_entry', tile: [...entrance.returnTriggerTile], facing: arrivalFacing }],
    links: [{ id: 'return_outside', destinationMapId: '', destinationAnchorId: '' }],
    doorTriggers: [{
      id: 'interior_exit',
      kind: 'door',
      tile: [...entrance.returnTriggerTile],
      activation: 'move_toward',
      allowedDirections: [exitDirection],
      visual: null,
      linkId: 'return_outside',
      scriptId: 'door_exit_default',
    }],
    characters: [],
    tilePackage: null,
    tileLayers: {
      version: 1,
      activeLayer: 0,
      layers: [{ id: 'base', name: 'Base tiles', visible: true, cells: denseGrid(width, height, null) }],
    },
    pathLayer: { version: 1, activeSetId: '', cells: denseGrid(width, height, 0) },
  };
}
