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

export function buildDoorVisualIndex(map) {
  const index = new Map();
  for (const trigger of (Array.isArray(map?.doorTriggers) ? map.doorTriggers : [])) {
    const visual = trigger?.visual;
    if (!visual?.tile || (visual.mapId && visual.mapId !== map?.id)) continue;
    index.set(doorTileKey(visual.tile[0], visual.tile[1]), trigger);
  }
  return index;
}

export function doorVisualAt(map, x, y, index = null) {
  return (index || buildDoorVisualIndex(map)).get(doorTileKey(x, y)) || null;
}

export function selectDoorAt(editor, x, y) {
  if (!editor?.map) return null;
  const trigger = doorTriggerAt(editor.map, x, y) || doorVisualAt(editor.map, x, y);
  if (!trigger) return null;
  editor.selectedDoorTriggerId = trigger.id;
  editor.doorTool = 'select';
  return trigger;
}

export function moveSelectedDoorVisual(editor, x, y) {
  const trigger = selectedDoorTrigger(editor);
  if (!trigger) return false;
  const layer = editor.map.tileLayers?.layers?.[editor.map.tileLayers.activeLayer || 0];
  trigger.visual = {
    mapId: '',
    layerId: String(trigger.visual?.layerId || layer?.id || ''),
    tile: [Number(x), Number(y)],
  };
  editor.dirty = true;
  return true;
}

export function removeDoorTriggerById(map, triggerId) {
  ensureDoorAuthoring(map);
  const removed = map.doorTriggers.filter((trigger) => trigger.id === triggerId);
  if (!removed.length) return [];
  for (const trigger of removed) {
    const visual = trigger.visual;
    if (!visual?.tile || (visual.mapId && visual.mapId !== map.id)) continue;
    const layer = map.tileLayers?.layers?.find((item) => item.id === visual.layerId);
    const [x, y] = visual.tile;
    if (layer?.cells?.[y]) layer.cells[y][x] = null;
  }
  map.doorTriggers = map.doorTriggers.filter((trigger) => trigger.id !== triggerId);
  const removedLinkIds = new Set(removed.map((trigger) => trigger.linkId).filter(Boolean));
  map.links = map.links.filter((link) => (
    !removedLinkIds.has(link.id) || map.doorTriggers.some((trigger) => trigger.linkId === link.id)
  ));
  return removed;
}

export function removeDoorsAt(map, x, y) {
  ensureDoorAuthoring(map);
  const matches = map.doorTriggers.filter((trigger) => {
    const onTrigger = trigger.tile?.[0] === x && trigger.tile?.[1] === y;
    const visual = trigger.visual;
    const onLocalVisual = visual && (!visual.mapId || visual.mapId === map.id)
      && visual.tile?.[0] === x && visual.tile?.[1] === y;
    return onTrigger || onLocalVisual;
  });
  for (const trigger of matches) removeDoorTriggerById(map, trigger.id);
  return matches;
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

function destinationMapOptions(editor, selected, esc) {
  const maps = editor.project?.maps || [];
  const known = new Set(maps.map((map) => map.id));
  const extra = selected && !known.has(selected)
    ? `<option value="${esc(selected)}" selected>${esc(selected)} (not in project)</option>`
    : '';
  return `<option value="">Choose a map</option>${maps.map((map) => `<option value="${esc(map.id)}" ${map.id === selected ? 'selected' : ''}>${esc(map.name || map.id)}</option>`).join('')}${extra}`;
}

function doorModeHint(mode) {
  if (mode === 'move-trigger' || mode === 'place') return 'Click the cell the player walks toward.';
  if (mode === 'move-visual') return 'Click the cell containing the animated door tile.';
  return 'Click a D or V marker to select a door.';
}

export function doorAuthoringHtml(editor, esc) {
  if (!editor.map) return '<p class="hint">Load a map to author doors.</p>';
  ensureDoorAuthoring(editor.map);
  const selected = selectedDoorTrigger(editor) || editor.map.doorTriggers[0] || null;
  if (selected && !editor.selectedDoorTriggerId) editor.selectedDoorTriggerId = selected.id;
  const link = selected ? editor.map.links.find((item) => item.id === selected.linkId) : null;
  const section = ['position', 'destination', 'anchors'].includes(editor.doorPanelSection) ? editor.doorPanelSection : 'position';
  const list = editor.map.doorTriggers.map((trigger) => {
    const destination = editor.map.links.find((item) => item.id === trigger.linkId);
    const status = destination?.destinationMapId
      ? `to ${destination.destinationMapId}${destination.destinationAnchorId ? ` / ${destination.destinationAnchorId}` : ''}`
      : 'not linked';
    return `<button type="button" class="map-door-row ${trigger.id === selected?.id ? 'active' : ''}" data-door-select="${esc(trigger.id)}"><strong>${esc(trigger.id)}</strong><span>Trigger ${trigger.tile[0]}, ${trigger.tile[1]} · ${esc(status)}</span></button>`;
  }).join('');
  if (!selected) return `<div class="map-door-panel"><p class="hint">Door triggers activate when the player attempts to move toward their tile.</p><button type="button" class="btn small" data-door-add>Add door trigger</button></div>`;
  const direction = selected.allowedDirections[0] || 'north';
  const visualText = selected.visual ? `${selected.visual.tile[0]}, ${selected.visual.tile[1]} on ${selected.visual.layerId || 'active layer'}` : 'No animated tile';
  const destinationText = link?.destinationMapId
    ? `${link.destinationMapId}${link.destinationAnchorId ? ` / ${link.destinationAnchorId}` : ''}`
    : 'Not linked';
  const destinationMap = (editor.project?.maps || []).find((map) => map.id === link?.destinationMapId);
  const anchorSuggestions = destinationMap?.anchors
    || (link?.destinationMapId === editor.map.id || !link?.destinationMapId ? editor.map.anchors : []);
  return `<div class="map-door-panel">
    <div class="map-door-actions"><button type="button" class="btn small" data-door-add>Add door</button><button type="button" class="btn small danger" data-door-delete>Delete</button></div>
    <div class="map-door-list">${list}</div>
    <div class="map-door-summary"><strong>${esc(selected.id)}</strong><span>Trigger ${selected.tile[0]}, ${selected.tile[1]}</span><span>Tile ${esc(visualText)}</span><span>${esc(destinationText)}</span></div>
    <div class="map-door-modebar" role="group" aria-label="Door map tool">
      <button type="button" class="${editor.doorTool === 'select' ? 'active' : ''}" data-door-mode="select">Select</button>
      <button type="button" class="${['move-trigger', 'place'].includes(editor.doorTool) ? 'active' : ''}" data-door-mode="move-trigger">Move trigger</button>
      <button type="button" class="${editor.doorTool === 'move-visual' ? 'active' : ''}" data-door-mode="move-visual">Move door tile</button>
    </div>
    <p class="map-door-mode-hint">${esc(doorModeHint(editor.doorTool))}</p>
    <div class="map-door-sections" role="tablist">
      <button type="button" class="${section === 'position' ? 'active' : ''}" data-door-section="position">Position</button>
      <button type="button" class="${section === 'destination' ? 'active' : ''}" data-door-section="destination">Destination</button>
      <button type="button" class="${section === 'anchors' ? 'active' : ''}" data-door-section="anchors">Anchors</button>
    </div>
    ${section === 'position' ? `<div class="map-door-section">
      <label>Door id<input data-door-field="id" value="${esc(selected.id)}"></label>
      <fieldset><legend>Walk trigger</legend>
        <div class="map-door-coordinates"><label>Tile X<input type="number" data-door-x value="${selected.tile[0]}"></label><label>Tile Y<input type="number" data-door-y value="${selected.tile[1]}"></label></div>
        <label>Approach direction<select data-door-direction>${directionOptions(direction)}</select></label>
        <button type="button" class="btn small" data-door-mode="move-trigger">Move trigger on map</button>
      </fieldset>
      <fieldset><legend>Animated door tile</legend>
        ${selected.visual ? `<label>Decoration layer<input data-door-visual-field="layerId" value="${esc(selected.visual.layerId || '')}"></label>
        <div class="map-door-coordinates"><label>Tile X<input type="number" data-door-visual-x value="${selected.visual.tile[0]}"></label><label>Tile Y<input type="number" data-door-visual-y value="${selected.visual.tile[1]}"></label></div>` : '<p class="hint">This door is an invisible trigger until a tile position is assigned.</p>'}
        <div class="map-door-inline-actions"><button type="button" class="btn small" data-door-mode="move-visual">${selected.visual ? 'Move tile on map' : 'Assign tile on map'}</button>${selected.visual ? '<button type="button" class="btn small" data-door-align-visual>Align with trigger</button><button type="button" class="btn small danger" data-door-clear-visual>Remove tile reference</button>' : ''}</div>
      </fieldset>
      <p class="hint">A trigger may sit one cell outside the map. Use the numeric fields for coordinates such as Y = -1.</p>
    </div>` : ''}
    ${section === 'destination' ? `<div class="map-door-section">
      <label>Destination map<select data-door-link-field="destinationMapId">${destinationMapOptions(editor, link?.destinationMapId || '', esc)}</select></label>
      <label>Destination anchor<input data-door-link-field="destinationAnchorId" value="${esc(link?.destinationAnchorId || '')}" list="mapDoorAnchorSuggestions"></label>
      <datalist id="mapDoorAnchorSuggestions">${anchorSuggestions.map((anchor) => `<option value="${esc(anchor.id)}"></option>`).join('')}</datalist>
      <label>Transition script<input data-door-field="scriptId" value="${esc(selected.scriptId)}" list="mapDoorScripts"></label>
      <button type="button" class="btn small danger" data-door-clear-link>Clear destination</button>
      <details><summary>Advanced link data</summary><label>Link id<input data-door-field="linkId" value="${esc(selected.linkId)}"></label></details>
      <p class="hint">Choose a project map, then enter an anchor defined on that destination map.</p>
    </div>` : ''}
    ${section === 'anchors' ? `<div class="map-door-section"><p class="hint">Anchors are arrival positions on this map. Other doors can link to these ids.</p><div class="map-door-anchor-list">${editor.map.anchors.map((anchor, index) => `<div class="map-door-anchor" data-door-anchor-row="${index}">
      <label>Id<input data-door-anchor-field="id" value="${esc(anchor.id)}"></label>
      <label>X<input type="number" data-door-anchor-field="x" value="${anchor.tile[0]}"></label>
      <label>Y<input type="number" data-door-anchor-field="y" value="${anchor.tile[1]}"></label>
      <label>Facing<select data-door-anchor-field="facing">${directionOptions(anchor.facing)}</select></label>
      <button type="button" class="btn small danger" data-door-anchor-delete="${index}">Delete</button>
    </div>`).join('') || '<p class="hint">No anchors yet.</p>'}</div><button type="button" class="btn small" data-door-anchor-add>Add anchor at spawn</button></div>` : ''}
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
    render?.('selection');
  });
  document.querySelector('[data-door-add]')?.addEventListener('click', () => { addDoorTrigger(editor); editor.doorAttachVisual = false; editor.doorTool = 'move-trigger'; editor.doorPanelSection = 'position'; render?.('geometry'); });
  document.querySelector('[data-door-delete]')?.addEventListener('click', () => {
    const removed = removeDoorTriggerById(editor.map, editor.selectedDoorTriggerId);
    if (!removed.length) return;
    editor.selectedDoorTriggerId = editor.map.doorTriggers[0]?.id || '';
    editor.dirty = true;
    render?.('geometry');
  });
  document.querySelectorAll('[data-door-mode]').forEach((button) => button.addEventListener('click', () => {
    editor.doorTool = button.dataset.doorMode;
    if (editor.doorTool === 'move-trigger') editor.doorAttachVisual = false;
    render?.('mode');
  }));
  document.querySelectorAll('[data-door-section]').forEach((button) => button.addEventListener('click', () => {
    editor.doorPanelSection = button.dataset.doorSection;
    render?.('panel');
  }));
  document.querySelector('[data-door-align-visual]')?.addEventListener('click', () => {
    const trigger = selectedDoorTrigger(editor);
    if (!trigger?.visual) return;
    trigger.visual.tile = [...trigger.tile];
    trigger.visual.mapId = '';
    editor.dirty = true;
    render?.('geometry');
  });
  document.querySelector('[data-door-clear-visual]')?.addEventListener('click', () => {
    const trigger = selectedDoorTrigger(editor);
    if (!trigger) return;
    trigger.visual = null;
    editor.dirty = true;
    render?.('geometry');
  });
  document.querySelector('[data-door-clear-link]')?.addEventListener('click', () => {
    const trigger = selectedDoorTrigger(editor);
    if (!trigger) return;
    const linkId = trigger.linkId;
    trigger.linkId = '';
    if (linkId && !editor.map.doorTriggers.some((item) => item !== trigger && item.linkId === linkId)) {
      editor.map.links = editor.map.links.filter((item) => item.id !== linkId);
    }
    editor.dirty = true;
    render?.('panel');
  });
  const update = () => {
    const trigger = selectedDoorTrigger(editor);
    if (!trigger) return;
    const triggerX = document.querySelector('[data-door-x]');
    const triggerY = document.querySelector('[data-door-y]');
    const direction = document.querySelector('[data-door-direction]');
    const scriptId = document.querySelector('[data-door-field="scriptId"]');
    const linkId = document.querySelector('[data-door-field="linkId"]');
    trigger.tile = [
      Number(triggerX?.value ?? trigger.tile[0]) || 0,
      Number(triggerY?.value ?? trigger.tile[1]) || 0,
    ];
    if (direction) trigger.allowedDirections = [direction.value || 'north'];
    if (scriptId) trigger.scriptId = safeId(scriptId.value, 'door_enter_default');
    if (linkId) trigger.linkId = safeId(linkId.value, `${trigger.id}_link`);
    const visibleControl = document.querySelector('[data-door-visible]');
    const visible = visibleControl ? visibleControl.checked === true : Boolean(trigger.visual);
    const layer = editor.map.tileLayers?.layers?.[editor.map.tileLayers.activeLayer || 0];
    trigger.visual = visible ? {
      mapId: String(document.querySelector('[data-door-visual-field="mapId"]')?.value || trigger.visual?.mapId || ''),
      layerId: String(document.querySelector('[data-door-visual-field="layerId"]')?.value || trigger.visual?.layerId || layer?.id || ''),
      tile: [
        Number(document.querySelector('[data-door-visual-x]')?.value ?? trigger.visual?.tile?.[0] ?? trigger.tile[0]) || 0,
        Number(document.querySelector('[data-door-visual-y]')?.value ?? trigger.visual?.tile?.[1] ?? trigger.tile[1]) || 0,
      ],
    } : null;
    const destinationMapId = document.querySelector('[data-door-link-field="destinationMapId"]');
    const destinationAnchorId = document.querySelector('[data-door-link-field="destinationAnchorId"]');
    if (destinationMapId || destinationAnchorId) {
      const link = ensureLink(editor.map, trigger);
      if (destinationMapId) link.destinationMapId = safeId(destinationMapId.value, '');
      if (destinationAnchorId) link.destinationAnchorId = safeId(destinationAnchorId.value, '');
    }
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
      render?.('geometry');
    };
  });
  document.querySelector('[data-door-anchor-add]')?.addEventListener('click', () => {
    const used = new Set(editor.map.anchors.map((anchor) => anchor.id));
    let index = editor.map.anchors.length + 1;
    while (used.has(`anchor_${index}`)) index += 1;
    editor.map.anchors.push({ id: `anchor_${index}`, tile: numberPair(editor.map.player?.spawnTile), facing: editor.map.player?.facing || 'south' });
    editor.dirty = true;
    log?.(`Added anchor_${index} at the player spawn.`, 'ok');
    render?.('panel');
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
        render?.('panel');
      };
    });
  });
  document.querySelectorAll('[data-door-anchor-delete]').forEach((button) => {
    button.onclick = () => {
      editor.map.anchors.splice(Number(button.dataset.doorAnchorDelete), 1);
      editor.dirty = true;
      render?.('panel');
    };
  });
}
