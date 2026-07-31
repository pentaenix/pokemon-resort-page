const DIRECTIONS = ['north', 'east', 'south', 'west'];

function safeId(value, fallback) {
  return String(value || fallback).trim().toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || fallback;
}

function numberPair(value, fallback = [0, 0]) {
  return [Number(value?.[0] ?? fallback[0]) || 0, Number(value?.[1] ?? fallback[1]) || 0];
}

export function ensureDoorAuthoring(map) {
  if (!map) return null;
  map.anchors = Array.isArray(map.anchors) ? map.anchors : [];
  map.links = Array.isArray(map.links) ? map.links : [];
  map.doorTriggers = Array.isArray(map.doorTriggers) ? map.doorTriggers : [];
  map.anchors = map.anchors.map((anchor, index) => ({
    id: safeId(anchor.id, `anchor_${index + 1}`),
    tile: numberPair(anchor.tile),
    facing: DIRECTIONS.includes(anchor.facing) ? anchor.facing : 'south',
  }));
  map.links = map.links.map((link, index) => ({
    id: safeId(link.id, `link_${index + 1}`),
    destinationMapId: safeId(link.destinationMapId, ''),
    destinationAnchorId: safeId(link.destinationAnchorId, ''),
  }));
  map.doorTriggers = map.doorTriggers.map((trigger, index) => ({
    id: safeId(trigger.id, `door_${index + 1}`),
    kind: 'door',
    tile: numberPair(trigger.tile),
    activation: 'move_toward',
    allowedDirections: (Array.isArray(trigger.allowedDirections) ? trigger.allowedDirections : [trigger.allowedDirection])
      .filter((direction) => DIRECTIONS.includes(direction)),
    visual: trigger.visual && typeof trigger.visual === 'object' ? {
      mapId: String(trigger.visual.mapId || ''),
      layerId: String(trigger.visual.layerId || ''),
      tile: numberPair(trigger.visual.tile, trigger.tile),
    } : null,
    linkId: safeId(trigger.linkId, ''),
    scriptId: safeId(trigger.scriptId, 'door_enter_default'),
  }));
  for (const trigger of map.doorTriggers) {
    if (!trigger.allowedDirections.length) trigger.allowedDirections = ['north'];
  }
  return map;
}

export function isDoorTile(tile) {
  return tile?.properties?.['interaction.kind'] === 'door' || (tile?.tags || []).includes('interaction.door');
}

export function selectedDoorTrigger(editor) {
  ensureDoorAuthoring(editor?.map);
  return editor?.map?.doorTriggers?.find((trigger) => trigger.id === editor.selectedDoorTriggerId) || null;
}

export function addDoorTrigger(editor, tile = null) {
  if (!editor?.map) return null;
  ensureDoorAuthoring(editor.map);
  const used = new Set(editor.map.doorTriggers.map((trigger) => trigger.id));
  let suffix = editor.map.doorTriggers.length + 1;
  while (used.has(`door_${suffix}`)) suffix += 1;
  const point = numberPair(tile, editor.map.player?.spawnTile || [0, 0]);
  const trigger = {
    id: `door_${suffix}`,
    kind: 'door',
    tile: point,
    activation: 'move_toward',
    allowedDirections: ['north'],
    visual: null,
    linkId: '',
    scriptId: 'door_enter_default',
  };
  editor.map.doorTriggers.push(trigger);
  editor.selectedDoorTriggerId = trigger.id;
  editor.dirty = true;
  return trigger;
}

export function placeSelectedDoorTrigger(editor, x, y) {
  const trigger = selectedDoorTrigger(editor) || addDoorTrigger(editor, [x, y]);
  if (!trigger) return false;
  trigger.tile = [Number(x), Number(y)];
  if (editor.doorAttachVisual === true) {
    const layer = editor.map.tileLayers?.layers?.[editor.map.tileLayers.activeLayer || 0];
    trigger.visual = { mapId: '', layerId: String(layer?.id || ''), tile: [Number(x), Number(y)] };
  }
  editor.dirty = true;
  return true;
}

function doorTileKey(x, y) {
  return `${Number(x)},${Number(y)}`;
}

export function buildDoorTriggerIndex(map) {
  const index = new Map();
  for (const trigger of (Array.isArray(map?.doorTriggers) ? map.doorTriggers : [])) {
    if (!Array.isArray(trigger?.tile) || trigger.tile.length < 2) continue;
    const key = doorTileKey(trigger.tile[0], trigger.tile[1]);
    if (!index.has(key)) index.set(key, trigger);
  }
  return index;
}

export function doorTriggerAt(map, x, y, index = null) {
  const lookup = index || buildDoorTriggerIndex(map);
  return lookup.get(doorTileKey(x, y)) || null;
}

export function offsetDoorAuthoring(map, dx, dy) {
  ensureDoorAuthoring(map);
  const shift = (point) => { point[0] += dx; point[1] += dy; };
  for (const anchor of map.anchors) shift(anchor.tile);
  for (const trigger of map.doorTriggers) {
    shift(trigger.tile);
    if (trigger.visual?.tile && !trigger.visual.mapId) shift(trigger.visual.tile);
  }
}

function directionOptions(selected) {
  return DIRECTIONS.map((direction) => `<option value="${direction}" ${selected === direction ? 'selected' : ''}>${direction}</option>`).join('');
}

export function doorAuthoringHtml(editor, esc) {
  if (!editor.map) return '<p class="hint">Load a map to author doors.</p>';
  ensureDoorAuthoring(editor.map);
  const selected = selectedDoorTrigger(editor) || editor.map.doorTriggers[0] || null;
  if (selected && !editor.selectedDoorTriggerId) editor.selectedDoorTriggerId = selected.id;
  const link = selected ? editor.map.links.find((item) => item.id === selected.linkId) : null;
  const list = editor.map.doorTriggers.map((trigger) => `<button type="button" class="map-door-row ${trigger.id === selected?.id ? 'active' : ''}" data-door-select="${esc(trigger.id)}"><strong>${esc(trigger.id)}</strong><span>${trigger.tile[0]}, ${trigger.tile[1]} · ${trigger.visual ? 'visible' : 'invisible'}</span></button>`).join('');
  if (!selected) return `<div class="map-door-panel"><p class="hint">Door triggers activate when the player attempts to move toward their tile.</p><button type="button" class="btn small" data-door-add>Add door trigger</button></div>`;
  const direction = selected.allowedDirections[0] || 'north';
  return `<div class="map-door-panel">
    <div class="map-door-actions"><button type="button" class="btn small" data-door-add>Add</button><button type="button" class="btn small danger" data-door-delete>Delete</button></div>
    <div class="map-door-list">${list}</div>
    <label>Trigger id<input data-door-field="id" value="${esc(selected.id)}"></label>
    <div class="map-door-coordinates"><label>Tile X<input type="number" data-door-x value="${selected.tile[0]}"></label><label>Tile Y<input type="number" data-door-y value="${selected.tile[1]}"></label></div>
    <button type="button" class="btn small ${editor.doorTool === 'place' ? 'primary' : ''}" data-door-place>${editor.doorTool === 'place' ? 'Click a map cell…' : 'Place on map'}</button>
    <label>Approach direction<select data-door-direction>${directionOptions(direction)}</select></label>
    <label class="map-door-check"><input type="checkbox" data-door-visible ${selected.visual ? 'checked' : ''}> Control the RTPKS tile at this cell</label>
    ${selected.visual ? `<fieldset><legend>Animated tile reference</legend>
      <label>Map id <span class="hint">blank = this map</span><input data-door-visual-field="mapId" value="${esc(selected.visual.mapId || '')}"></label>
      <label>Layer id<input data-door-visual-field="layerId" value="${esc(selected.visual.layerId || '')}"></label>
      <div class="map-door-coordinates"><label>Tile X<input type="number" data-door-visual-x value="${selected.visual.tile[0]}"></label><label>Tile Y<input type="number" data-door-visual-y value="${selected.visual.tile[1]}"></label></div>
    </fieldset>` : ''}
    <label>Script id<input data-door-field="scriptId" value="${esc(selected.scriptId)}" list="mapDoorScripts"></label>
    <label>Link id<input data-door-field="linkId" value="${esc(selected.linkId)}"></label>
    <fieldset><legend>Link destination</legend>
      <label>Map id<input data-door-link-field="destinationMapId" value="${esc(link?.destinationMapId || '')}"></label>
      <label>Anchor id<input data-door-link-field="destinationAnchorId" value="${esc(link?.destinationAnchorId || '')}"></label>
    </fieldset>
    <p class="hint">Coordinates may be one cell outside the map, such as Y = -1. Use the numeric fields for an exterior halo trigger.</p>
    <details><summary>Destination anchors on this map</summary><div class="map-door-anchor-list">${editor.map.anchors.map((anchor, index) => `<div class="map-door-anchor" data-door-anchor-row="${index}">
      <label>Id<input data-door-anchor-field="id" value="${esc(anchor.id)}"></label>
      <label>X<input type="number" data-door-anchor-field="x" value="${anchor.tile[0]}"></label>
      <label>Y<input type="number" data-door-anchor-field="y" value="${anchor.tile[1]}"></label>
      <label>Facing<select data-door-anchor-field="facing">${directionOptions(anchor.facing)}</select></label>
      <button type="button" class="btn small danger" data-door-anchor-delete="${index}">Delete</button>
    </div>`).join('') || '<p class="hint">No anchors yet.</p>'}</div><button type="button" class="btn small" data-door-anchor-add>Add anchor at spawn</button></details>
  </div>`;
}

function ensureLink(map, trigger) {
  let linkId = safeId(trigger.linkId, `${trigger.id}_link`);
  trigger.linkId = linkId;
  let link = map.links.find((item) => item.id === linkId);
  if (!link) {
    link = { id: linkId, destinationMapId: '', destinationAnchorId: '' };
    map.links.push(link);
  }
  return link;
}

export function bindDoorAuthoring(editor, { render, log } = {}) {
  if (!editor?.map) return;
  ensureDoorAuthoring(editor.map);
  document.querySelectorAll('[data-door-select]').forEach((button) => button.onclick = () => {
    editor.selectedDoorTriggerId = button.dataset.doorSelect;
    editor.doorTool = 'select';
    render?.();
  });
  document.querySelector('[data-door-add]')?.addEventListener('click', () => { addDoorTrigger(editor); editor.doorTool = 'place'; render?.(); });
  document.querySelector('[data-door-delete]')?.addEventListener('click', () => {
    const index = editor.map.doorTriggers.findIndex((trigger) => trigger.id === editor.selectedDoorTriggerId);
    if (index < 0) return;
    editor.map.doorTriggers.splice(index, 1);
    editor.selectedDoorTriggerId = editor.map.doorTriggers[0]?.id || '';
    editor.dirty = true;
    render?.();
  });
  document.querySelector('[data-door-place]')?.addEventListener('click', () => { editor.doorTool = editor.doorTool === 'place' ? 'select' : 'place'; render?.(); });
  const update = () => {
    const trigger = selectedDoorTrigger(editor);
    if (!trigger) return;
    trigger.tile = [Number(document.querySelector('[data-door-x]')?.value) || 0, Number(document.querySelector('[data-door-y]')?.value) || 0];
    trigger.allowedDirections = [document.querySelector('[data-door-direction]')?.value || 'north'];
    trigger.scriptId = safeId(document.querySelector('[data-door-field="scriptId"]')?.value, 'door_enter_default');
    trigger.linkId = safeId(document.querySelector('[data-door-field="linkId"]')?.value, `${trigger.id}_link`);
    const visible = document.querySelector('[data-door-visible]')?.checked === true;
    const layer = editor.map.tileLayers?.layers?.[editor.map.tileLayers.activeLayer || 0];
    trigger.visual = visible ? {
      mapId: String(document.querySelector('[data-door-visual-field="mapId"]')?.value || trigger.visual?.mapId || ''),
      layerId: String(document.querySelector('[data-door-visual-field="layerId"]')?.value || trigger.visual?.layerId || layer?.id || ''),
      tile: [
        Number(document.querySelector('[data-door-visual-x]')?.value ?? trigger.visual?.tile?.[0] ?? trigger.tile[0]) || 0,
        Number(document.querySelector('[data-door-visual-y]')?.value ?? trigger.visual?.tile?.[1] ?? trigger.tile[1]) || 0,
      ],
    } : null;
    const link = ensureLink(editor.map, trigger);
    link.destinationMapId = safeId(document.querySelector('[data-door-link-field="destinationMapId"]')?.value, '');
    link.destinationAnchorId = safeId(document.querySelector('[data-door-link-field="destinationAnchorId"]')?.value, '');
    editor.dirty = true;
  };
  document.querySelectorAll('[data-door-x],[data-door-y],[data-door-direction],[data-door-visible],[data-door-field],[data-door-link-field],[data-door-visual-field],[data-door-visual-x],[data-door-visual-y]').forEach((input) => {
    input.onchange = () => {
      const trigger = selectedDoorTrigger(editor);
      const oldId = trigger?.id;
      update();
      if (trigger && input.dataset.doorField === 'id') {
        trigger.id = safeId(input.value, oldId);
        editor.selectedDoorTriggerId = trigger.id;
      }
      render?.();
    };
  });
  document.querySelector('[data-door-anchor-add]')?.addEventListener('click', () => {
    const used = new Set(editor.map.anchors.map((anchor) => anchor.id));
    let index = editor.map.anchors.length + 1;
    while (used.has(`anchor_${index}`)) index += 1;
    editor.map.anchors.push({ id: `anchor_${index}`, tile: numberPair(editor.map.player?.spawnTile), facing: editor.map.player?.facing || 'south' });
    editor.dirty = true;
    log?.(`Added anchor_${index} at the player spawn.`, 'ok');
    render?.();
  });
  document.querySelectorAll('[data-door-anchor-row]').forEach((row) => {
    const index = Number(row.dataset.doorAnchorRow);
    row.querySelectorAll('[data-door-anchor-field]').forEach((input) => {
      input.onchange = () => {
        const anchor = editor.map.anchors[index];
        if (!anchor) return;
        const field = input.dataset.doorAnchorField;
        if (field === 'id') anchor.id = safeId(input.value, anchor.id);
        else if (field === 'x') anchor.tile[0] = Number(input.value) || 0;
        else if (field === 'y') anchor.tile[1] = Number(input.value) || 0;
        else if (field === 'facing') anchor.facing = DIRECTIONS.includes(input.value) ? input.value : 'south';
        editor.dirty = true;
        render?.();
      };
    });
  });
  document.querySelectorAll('[data-door-anchor-delete]').forEach((button) => {
    button.onclick = () => {
      editor.map.anchors.splice(Number(button.dataset.doorAnchorDelete), 1);
      editor.dirty = true;
      render?.();
    };
  });
}
