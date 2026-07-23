import { mountRtpksTilePreview } from './map-3d-view.js';

const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);

const SURFACE_TAG_OPTIONS = [
  ['surface.rock', 'Rock / mountain'],
  ['surface.grass', 'Grass'],
  ['surface.sand', 'Sand'],
  ['surface.beach', 'Beach / shoreline'],
  ['surface.water', 'Water'],
  ['surface.dry_grass', 'Dry grass'],
  ['surface.dirt', 'Dirt'],
  ['surface.stone', 'Stone'],
  ['surface.wood', 'Wood'],
  ['surface.snow', 'Snow'],
  ['surface.ice', 'Ice'],
  ['surface.mud', 'Mud / marsh'],
];

function normalizeTag(tag) {
  return String(tag || '').trim().toLowerCase().replace(/\s+/g, '_');
}

function addTileTag(tile, rawTag, { replaceSurface = false } = {}) {
  const tag = normalizeTag(rawTag);
  if (!tag) return false;
  const tags = Array.isArray(tile.tags) ? tile.tags.map(normalizeTag).filter(Boolean) : [];
  const next = replaceSurface ? tags.filter((item) => !item.startsWith('surface.')) : tags;
  if (!next.includes(tag)) next.push(tag);
  tile.tags = next;
  return true;
}

function tileTagsEditor(tile) {
  const currentSurface = tile.tags.find((tag) => tag.startsWith('surface.')) || '';
  return `<div class="wide tpe-tags-field">
    <span class="tpe-field-label">Gameplay tags</span>
    <div class="tpe-tag-chips">${tile.tags.length ? tile.tags.map((tag) => `<span class="tpe-tag-chip">${esc(tag)}<button type="button" data-tpe-remove-tag="${esc(tag)}" aria-label="Remove ${esc(tag)}">×</button></span>`).join('') : '<span class="tpe-tag-empty">No tags yet</span>'}</div>
    <div class="tpe-tag-controls">
      <select data-tpe-surface-tag aria-label="Surface type"><option value="">Choose surface…</option>${SURFACE_TAG_OPTIONS.map(([tag, label]) => `<option value="${tag}" ${currentSurface === tag ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select>
      <div class="tpe-custom-tag"><input autocomplete="off" data-tpe-custom-tag placeholder="custom tag, e.g. effect.flowers"><button type="button" class="btn tiny" data-tpe-add-custom-tag aria-label="Add custom tag">＋</button></div>
    </div>
    <small>Surface is the tile type used by gameplay. Extra tags can describe traversal, effects, audio, or custom rules.</small>
  </div>`;
}

async function api(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new Error(payload.error || `Request failed (${response.status})`);
  return payload;
}

function uniqueId(base, existing) {
  const clean = String(base || 'tab').toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_|_$/g, '') || 'tab';
  let id = clean;
  let suffix = 2;
  while (existing.has(id)) id = `${clean}_${suffix++}`;
  return id;
}

function normalizeTile(tile) {
  tile.tags = Array.isArray(tile.tags) ? tile.tags : [];
  tile.properties = tile.properties && typeof tile.properties === 'object' ? tile.properties : {};
  tile.animation ||= { type: 'none' };
  tile.collision ||= { mode: 'none', autoApply: false, clearOnErase: false, mask: [] };
  return tile;
}

function tileOption(tile, selected = false) {
  return `<option value="${tile.resortTileId}" ${selected ? 'selected' : ''}>#${tile.resortTileId} · ${esc(tile.name || tile.key)}</option>`;
}

function tabsPanel(state) {
  return `<section class="tpe-panel">
    <div class="tpe-section-head"><div><h3>Palette tabs</h3><p>These are the tabs shown above the tile palette.</p></div><button class="btn small" data-tpe-add-tab>Add tab</button></div>
    <div class="tpe-tab-list">${state.document.tabs.map((tab, index) => `<div class="tpe-tab-row" data-tab-index="${index}">
      <span class="tpe-drag">${index + 1}</span>
      <input data-tpe-tab-name value="${esc(tab.name)}" aria-label="Tab name">
      <code>${esc(tab.id)}</code><span>${tab.tileIds.length} tiles</span>
      <button class="btn tiny" data-tpe-tab-up ${index === 0 ? 'disabled' : ''}>↑</button>
      <button class="btn tiny" data-tpe-tab-down ${index === state.document.tabs.length - 1 ? 'disabled' : ''}>↓</button>
      <button class="btn tiny danger" data-tpe-tab-delete ${state.document.tabs.length === 1 ? 'disabled' : ''}>Remove</button>
    </div>`).join('')}</div>
    <p class="tpe-help">Removing a tab moves its tiles to the first remaining tab. Stable tile IDs never change.</p>
  </section>`;
}

function collisionMask(tile) {
  const width = Math.max(1, Number(tile.width) || 1);
  const height = Math.max(1, Number(tile.height) || 1);
  return `<div class="tpe-mask" style="grid-template-columns:repeat(${width},32px)">${Array.from({ length: width * height }, (_, index) => {
    const y = Math.floor(index / width); const x = index % width;
    return `<button type="button" class="${tile.collision?.mask?.[y]?.[x] ? 'active' : ''}" data-tpe-mask="${x},${y}" title="Collision cell ${x + 1}, ${y + 1}"></button>`;
  }).join('')}</div>`;
}

function tilePanel(state) {
  const tile = normalizeTile(state.document.tiles.find((item) => Number(item.resortTileId) === Number(state.selectedTileId)) || state.document.tiles[0]);
  if (!tile) return '<section class="tpe-panel"><p>This pack has no tiles yet. Use Add tile.</p></section>';
  state.selectedTileId = tile.resortTileId;
  const selectedTab = state.document.tabs.find((tab) => tab.tileIds.includes(tile.resortTileId))?.id || state.document.tabs[0]?.id;
  const matches = state.document.tiles.filter((item) => !state.search || `${item.name} ${item.key} ${item.resortTileId}`.toLowerCase().includes(state.search.toLowerCase()));
  const visibleTiles = matches.slice(0, 200);
  const animated = tile.animation?.type !== 'none';
  return `<section class="tpe-tile-layout">
    <aside class="tpe-tile-list"><input data-tpe-tile-search placeholder="Search tiles" value="${esc(state.search)}"><small>${matches.length > visibleTiles.length ? `Showing ${visibleTiles.length} of ${matches.length}. Search to narrow the list.` : `${matches.length} tiles`}</small><div>${visibleTiles.map((item) => `<button class="${item.resortTileId === tile.resortTileId ? 'active' : ''}" data-tpe-select-tile="${item.resortTileId}"><img src="/api/tile-packages/preview?file=${encodeURIComponent(state.fileName)}&tileId=${item.resortTileId}&v=${state.previewVersion}" alt="" loading="lazy" onerror="this.style.visibility='hidden'"><strong>${esc(item.name || item.key)}</strong><span>#${item.resortTileId}</span></button>`).join('')}</div></aside>
    <div class="tpe-panel tpe-inspector">
      <div class="tpe-section-head"><div class="tpe-tile-summary"><img src="/api/tile-packages/preview?file=${encodeURIComponent(state.fileName)}&tileId=${tile.resortTileId}&v=${state.previewVersion}" alt="" onerror="this.style.display='none'"><div><h3>${esc(tile.name)}</h3><p>Stable ID #${tile.resortTileId} · ${tile.width}×${tile.height} footprint</p></div></div><div class="tpe-preview-actions"><span class="tpe-status">${animated ? 'Animated' : 'Static'}</span>${animated ? `<button type="button" class="btn tiny tpe-animation-play" data-tpe-animation-play aria-pressed="${state.previewing ? 'true' : 'false'}">${state.previewing ? '■ Stop preview' : '▶ Play animation'}</button>` : ''}</div></div>
      ${animated && state.previewing ? '<div class="tpe-animation-preview" data-tpe-animation-preview aria-label="Animated tile preview"></div>' : ''}
      <div class="tpe-form-grid">
        <label>Name<input data-tpe-tile-name value="${esc(tile.name)}"></label>
        <label>Palette tab<select data-tpe-tile-tab>${state.document.tabs.map((tab) => `<option value="${esc(tab.id)}" ${tab.id === selectedTab ? 'selected' : ''}>${esc(tab.name)}</option>`).join('')}</select></label>
        ${tileTagsEditor(tile)}
        <label>Animation behavior<select data-tpe-animation-type><option value="none" ${tile.animation.type === 'none' ? 'selected' : ''}>None</option><option value="frames" ${tile.animation.type === 'frames' ? 'selected' : ''} ${tile.animation.type !== 'frames' ? 'disabled' : ''}>Frame animation</option><option value="uvScroll" ${tile.animation.type === 'uvScroll' ? 'selected' : ''}>UV scroll metadata</option><option value="sway" ${tile.animation.type === 'sway' ? 'selected' : ''}>Foliage sway metadata</option></select></label>
        <label>Frame time (ms)<input type="number" min="16" data-tpe-frame-ms value="${esc(tile.animation.frameDurationMs || 180)}" ${tile.animation.type === 'frames' ? '' : 'disabled'}></label>
        <label>Automatic collision<select data-tpe-collision-mode><option value="none" ${tile.collision.mode === 'none' ? 'selected' : ''}>None</option><option value="footprint" ${tile.collision.mode === 'footprint' ? 'selected' : ''}>Entire footprint</option><option value="mask" ${tile.collision.mode === 'mask' ? 'selected' : ''}>Custom mask</option></select></label>
        <label class="tpe-check"><input type="checkbox" data-tpe-collision-auto ${tile.collision.autoApply ? 'checked' : ''}> Apply when painting</label>
        <label class="tpe-check"><input type="checkbox" data-tpe-collision-clear ${tile.collision.clearOnErase ? 'checked' : ''}> Clear when erasing</label>
      </div>
      <div data-tpe-mask-wrap class="${tile.collision.mode === 'mask' ? '' : 'hidden'}"><strong>Collision mask</strong>${collisionMask(tile)}</div>
      <details><summary>Typed gameplay properties</summary><textarea data-tpe-properties rows="6" spellcheck="false">${esc(JSON.stringify(tile.properties, null, 2))}</textarea></details>
    </div>
  </section>`;
}

function pathsPanel(state) {
  const set = state.document.smartSets[state.selectedPath] || state.document.smartSets[0];
  if (!set) return `<section class="tpe-panel"><div class="tpe-section-head"><div><h3>Smart paths</h3><p>Paint paths and let the editor select connected variants.</p></div><button class="btn small" data-tpe-add-path>Create path set</button></div><div class="tpe-empty">No smart paths in this pack yet.</div></section>`;
  state.selectedPath = state.document.smartSets.indexOf(set);
  return `<section class="tpe-panel">
    <div class="tpe-section-head"><div><h3>Smart paths</h3><p>Assign a tile to each connectivity slot. Empty slots fall back to the closest match.</p></div><div><button class="btn small" data-tpe-add-path>New set</button> <button class="btn small danger" data-tpe-delete-path>Delete</button></div></div>
    <div class="tpe-path-tabs">${state.document.smartSets.map((item, index) => `<button class="${index === state.selectedPath ? 'active' : ''}" data-tpe-path="${index}">${esc(item.name)}</button>`).join('')}</div>
    <div class="tpe-form-grid"><label>Path name<input data-tpe-path-name value="${esc(set.name)}"></label><label>Grid width<input type="number" min="1" max="12" data-tpe-path-width value="${set.width}"></label><label>Grid height<input type="number" min="1" max="12" data-tpe-path-height value="${set.height}"></label></div>
    <div class="tpe-path-grid" style="grid-template-columns:repeat(${set.width},minmax(118px,1fr))">${Array.from({ length: set.width * set.height }, (_, index) => { const x = index % set.width; const y = Math.floor(index / set.width); const id = Number(set.grid?.[x]?.[y]); return `<label><span>${x + 1}, ${y + 1}</span><select data-tpe-path-cell="${x},${y}"><option value="-1">Empty</option>${state.document.tiles.map((tile) => tileOption(tile, tile.resortTileId === id)).join('')}</select></label>`; }).join('')}</div>
  </section>`;
}

function addPanel(state) {
  const bundle = state.bundleInfo;
  const assetCount = state.assets?.length || (state.asset ? 1 : 0);
  const batch = assetCount > 1;
  const animated = bundle?.animatedMaterials?.length > 0;
  const name = bundle?.name || '';
  const width = bundle?.width || 1;
  const height = bundle?.height || 1;
  const renderMode = bundle?.renderMode || 'cutout';
  const tags = bundle?.tags?.join(', ') || '';
  const collisionMode = bundle?.collision?.mode || 'none';
  const frameMs = bundle?.animatedMaterials?.[0]?.frameDurationMs || 180;
  const bundleSummary = bundle ? `<div class="tpe-bundle-summary"><strong>${batch ? `${assetCount} tile bundles selected` : esc(bundle.name)}</strong><span>${batch ? `First bundle: ${esc(bundle.name)} · ` : ''}${bundle.materialCount} material${bundle.materialCount === 1 ? '' : 's'} · ${bundle.animatedMaterials.length} animated</span>${bundle.preview?.available ? '<small>Top-down orthographic preview included.</small>' : '<small>The editor will generate a top-down preview after import.</small>'}${bundle.animatedMaterials.map((item) => `<small>${esc(item.material)}: ${item.frameCount} frames at ${item.frameDurationMs} ms</small>`).join('')}${bundle.glbAnimationClips?.length ? `<small>${bundle.glbAnimationClips.length} GLB motion clip${bundle.glbAnimationClips.length === 1 ? '' : 's'} will import at bind pose.</small>` : ''}</div>` : '';
  return `<section class="tpe-panel"><div class="tpe-section-head"><div><h3>Add tile</h3><p>Import one asset or select a complete batch of Pokemon Resort .tile bundles.</p></div></div>
    <div class="tpe-drop"><input type="file" multiple data-tpe-asset accept=".tile,.glb,.png,.jpg,.jpeg,application/zip,image/png,image/jpeg,model/gltf-binary"><strong>Choose tile asset${batch ? 's' : ''}</strong><span data-tpe-file-label>${batch ? `${assetCount} .tile bundles` : state.asset ? esc(state.asset.name) : '.tile, GLB, PNG, JPG, or spritesheet'}</span></div>
    ${bundleSummary}
    <div class="tpe-form-grid">
      <label>Name<input autocomplete="off" data-tpe-add-name value="${esc(name)}" placeholder="Water ripple"></label><label>Palette tab<select data-tpe-add-tab>${state.document.tabs.map((tab) => `<option value="${esc(tab.id)}">${esc(tab.name)}</option>`).join('')}</select></label>
      <label>Footprint width<input type="number" min="1" max="32" value="${width}" data-tpe-add-width></label><label>Footprint height<input type="number" min="1" max="32" value="${height}" data-tpe-add-height></label>
      <label>Render mode<select data-tpe-add-render><option value="cutout" ${renderMode === 'cutout' ? 'selected' : ''}>Cutout</option><option value="opaque" ${renderMode === 'opaque' ? 'selected' : ''}>Opaque</option><option value="blend" ${renderMode === 'blend' ? 'selected' : ''}>Transparent blend</option></select></label>
      <label>Animation<select data-tpe-add-animation ${bundle ? 'disabled' : ''}><option value="none" ${!animated ? 'selected' : ''}>Static</option><option value="frames" ${animated ? 'selected' : ''}>${bundle ? 'Bundle material frames' : 'Spritesheet frames'}</option><option value="uvScroll">UV scroll metadata</option><option value="sway">Foliage sway metadata</option></select></label>
      <label>Spritesheet columns<input type="number" min="1" max="64" value="1" data-tpe-add-cols></label><label>Spritesheet rows<input type="number" min="1" max="64" value="1" data-tpe-add-rows></label>
      <label>Frame count<input type="number" min="1" max="4096" value="${bundle?.animatedMaterials?.[0]?.frameCount || 1}" data-tpe-add-count></label><label>Frame time (ms)<input type="number" min="16" value="${frameMs}" data-tpe-add-ms></label>
      <label class="wide">Gameplay tags<input autocomplete="off" data-tpe-add-tags value="${esc(tags)}" placeholder="surface.water, effect.water_ripple"></label>
      <label>Automatic collision<select data-tpe-add-collision><option value="none" ${collisionMode === 'none' ? 'selected' : ''}>None</option><option value="footprint" ${collisionMode === 'footprint' ? 'selected' : ''}>Entire footprint</option><option value="mask" ${collisionMode === 'mask' ? 'selected' : ''}>Custom mask later</option></select></label>
      ${batch ? `<label class="tpe-check wide"><input type="checkbox" data-tpe-replace-tab ${state.replaceTab ? 'checked' : ''}> Replace the tiles currently in this palette tab</label>` : ''}
    </div><div class="tpe-actions"><button class="btn primary" data-tpe-import>${batch ? `Add ${assetCount} tiles to pack` : 'Add to pack'}</button></div>
    <p class="tpe-help">Each .tile bundle keeps its GLB mesh, layered materials, and frame sequences together. Batch import preserves each bundle name and footprint and stores identical animation frames only once.</p>
  </section>`;
}

async function sliceFrames(file, columns, rows, count) {
  const image = await createImageBitmap(file);
  const width = Math.floor(image.width / columns); const height = Math.floor(image.height / rows);
  if (width < 1 || height < 1) throw new Error('Spritesheet cells are too small.');
  const frames = [];
  for (let index = 0; index < Math.min(count, columns * rows); index += 1) {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    canvas.getContext('2d', { alpha: true }).drawImage(image, (index % columns) * width, Math.floor(index / columns) * height, width, height, 0, 0, width, height);
    frames.push(await new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Could not slice spritesheet.')), 'image/png')));
  }
  image.close();
  return frames;
}

function syncInspector(root, state) {
  const tile = state.document.tiles.find((item) => Number(item.resortTileId) === Number(state.selectedTileId));
  if (!tile) return;
  tile.name = root.querySelector('[data-tpe-tile-name]')?.value.trim() || tile.name;
  tile.animation = { ...tile.animation, type: root.querySelector('[data-tpe-animation-type]')?.value || 'none', frameDurationMs: Number(root.querySelector('[data-tpe-frame-ms]')?.value) || 180 };
  tile.collision = { ...tile.collision, mode: root.querySelector('[data-tpe-collision-mode]')?.value || 'none', autoApply: root.querySelector('[data-tpe-collision-auto]')?.checked === true, clearOnErase: root.querySelector('[data-tpe-collision-clear]')?.checked === true };
  const nextTab = root.querySelector('[data-tpe-tile-tab]')?.value;
  if (nextTab) { for (const tab of state.document.tabs) tab.tileIds = tab.tileIds.filter((id) => id !== tile.resortTileId); state.document.tabs.find((tab) => tab.id === nextTab)?.tileIds.push(tile.resortTileId); }
  const props = root.querySelector('[data-tpe-properties]')?.value;
  if (props != null) tile.properties = JSON.parse(props || '{}');
}

export async function openTilePackEditor(editor, { onSaved, log } = {}) {
  if (!editor?.tilePackage?.fileName) throw new Error('Select a tile package first.');
  const payload = await api(`/api/tile-packages/authoring?file=${encodeURIComponent(editor.tilePackage.fileName)}`);
  const state = { fileName: editor.tilePackage.fileName, document: payload.document, view: 'tiles', selectedTileId: payload.document.tiles[0]?.resortTileId, selectedPath: 0, search: '', asset: null, assets: [], bundleInfo: null, replaceTab: false, busy: false, previewing: false, previewHandle: null, previewVersion: Date.now() };
  const overlay = document.createElement('div'); overlay.className = 'tpe-overlay'; document.body.appendChild(overlay);

  const render = () => {
    state.previewHandle?.dispose?.();
    state.previewHandle = null;
    const content = state.view === 'tabs' ? tabsPanel(state) : state.view === 'paths' ? pathsPanel(state) : state.view === 'add' ? addPanel(state) : tilePanel(state);
    overlay.innerHTML = `<div class="tpe-modal" role="dialog" aria-modal="true" aria-label="Tile Pack Editor"><header><div><span class="tpe-kicker">RTPKS authoring</span><h2>${esc(state.document.name)}</h2><p>${esc(editor.tilePackage.fileName)} · ${state.document.tiles.length} tiles</p></div><button class="tpe-close" aria-label="Close">×</button></header><nav>${[['tiles','Tiles'],['tabs','Palette tabs'],['paths','Smart paths'],['add','Add tile']].map(([id,label]) => `<button class="${state.view === id ? 'active' : ''}" data-tpe-view="${id}">${label}</button>`).join('')}</nav><main>${content}</main><footer><span data-tpe-message>Stable IDs are preserved.</span><div><button class="btn" data-tpe-cancel>Close</button><button class="btn primary" data-tpe-save ${state.busy ? 'disabled' : ''}>Save pack</button></div></footer></div>`;
    bind();
    const previewHost = overlay.querySelector('[data-tpe-animation-preview]');
    if (previewHost) {
      const tileId = Number(state.selectedTileId);
      mountRtpksTilePreview(previewHost, state.fileName, editor.tilePackage, tileId, {
        isCurrent: () => previewHost.isConnected && state.previewing && Number(state.selectedTileId) === tileId,
      }).then((handle) => {
        if (previewHost.isConnected && state.previewing && Number(state.selectedTileId) === tileId) state.previewHandle = handle;
        else handle.dispose?.();
      }).catch((error) => message(error.message, 'error'));
    }
  };

  const message = (text, type = '') => { const node = overlay.querySelector('[data-tpe-message]'); if (node) { node.textContent = text; node.dataset.type = type; } };
  const close = () => { state.previewHandle?.dispose?.(); overlay.remove(); };
  const save = async () => {
    try {
      if (state.view === 'tiles') syncInspector(overlay, state);
      state.busy = true; message('Saving tile pack…');
      const result = await api(`/api/tile-packages/authoring?file=${encodeURIComponent(editor.tilePackage.fileName)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ document: state.document }) });
      editor.tilePackage = result.package; state.previewVersion = Date.now(); state.busy = false; message('Tile pack saved.', 'ok'); onSaved?.(result.package); log?.('Tile pack updated.', 'ok'); render();
    } catch (error) { state.busy = false; message(error.message, 'error'); }
  };

  const importTile = async () => {
    const files = state.assets?.length ? state.assets : (state.asset ? [state.asset] : []);
    const file = files[0]; if (!file) return message('Choose an asset first.', 'error');
    try {
      const q = (selector) => overlay.querySelector(selector);
      const batch = files.length > 1;
      if (batch && files.some((item) => !/\.tile$/i.test(item.name))) throw new Error('Batch import accepts only .tile bundles.');
      const animationType = state.bundleInfo?.animatedMaterials?.length ? 'frames' : q('[data-tpe-add-animation]').value;
      const tile = { tabId: q('[data-tpe-add-tab]').value, renderMode: q('[data-tpe-add-render]').value, tags: q('[data-tpe-add-tags]').value.split(',').map((tag) => tag.trim()).filter(Boolean), collision: { mode: q('[data-tpe-add-collision]').value, autoApply: q('[data-tpe-add-collision]').value !== 'none' }, animation: { type: animationType, columns: Number(q('[data-tpe-add-cols]').value), rows: Number(q('[data-tpe-add-rows]').value), frameCount: Number(q('[data-tpe-add-count]').value), frameDurationMs: Number(q('[data-tpe-add-ms]').value), phase: 'global', loop: true } };
      if (!batch) Object.assign(tile, { name: q('[data-tpe-add-name]').value.trim() || file.name.replace(/\.[^.]+$/, ''), width: Number(q('[data-tpe-add-width]').value), height: Number(q('[data-tpe-add-height]').value), properties: state.bundleInfo?.properties || {} });
      const form = new FormData(); form.append('metadata', new Blob([JSON.stringify({ fileName: editor.tilePackage.fileName, tile, replaceTab: batch && q('[data-tpe-replace-tab]')?.checked === true })], { type: 'application/json' }));
      if (batch) files.forEach((item) => form.append('tileBundle', item, item.name));
      else if (/\.tile$/i.test(file.name)) form.append('tileBundle', file, file.name);
      else if (/\.glb$/i.test(file.name)) form.append('glb', file, file.name);
      else if (animationType === 'frames') { const frames = await sliceFrames(file, tile.animation.columns, tile.animation.rows, tile.animation.frameCount); frames.forEach((frame, index) => form.append('frame', frame, `frame_${index}.png`)); }
      else form.append('texture', file, file.name);
      message(batch ? `Adding ${files.length} tiles and rebuilding the pack…` : 'Adding tile and rebuilding the pack…');
      const result = await api(batch ? '/api/tile-packages/tiles/batch' : '/api/tile-packages/tiles', { method: 'POST', body: form });
      const addedIds = result.resortTileIds || [result.resortTileId];
      editor.tilePackage = result.package; onSaved?.(result.package); log?.(batch ? `Added ${addedIds.length} tiles.` : `Added tile #${result.resortTileId}.`, 'ok');
      const refreshed = await api(`/api/tile-packages/authoring?file=${encodeURIComponent(editor.tilePackage.fileName)}`); state.document = refreshed.document; state.previewVersion = Date.now(); state.selectedTileId = addedIds[0]; state.view = 'tiles'; render();
    } catch (error) { message(error.message, 'error'); }
  };

  const bind = () => {
    overlay.querySelector('.tpe-close').onclick = close; overlay.querySelector('[data-tpe-cancel]').onclick = close; overlay.querySelector('[data-tpe-save]').onclick = save;
    overlay.querySelectorAll('[data-tpe-view]').forEach((button) => button.onclick = () => { if (state.view === 'tiles') { try { syncInspector(overlay, state); } catch (error) { return message(error.message, 'error'); } } state.view = button.dataset.tpeView; render(); });
    overlay.querySelectorAll('[data-tpe-select-tile]').forEach((button) => button.onclick = () => { try { syncInspector(overlay, state); state.selectedTileId = Number(button.dataset.tpeSelectTile); state.previewing = false; render(); } catch (error) { message(error.message, 'error'); } });
    overlay.querySelector('[data-tpe-animation-play]')?.addEventListener('click', () => { state.previewing = !state.previewing; render(); });
    overlay.querySelector('[data-tpe-surface-tag]')?.addEventListener('change', (event) => {
      try { syncInspector(overlay, state); } catch (error) { return message(error.message, 'error'); }
      const tile = normalizeTile(state.document.tiles.find((item) => Number(item.resortTileId) === Number(state.selectedTileId)));
      if (event.target.value && addTileTag(tile, event.target.value, { replaceSurface: true })) render();
    });
    overlay.querySelectorAll('[data-tpe-remove-tag]').forEach((button) => button.addEventListener('click', () => {
      try { syncInspector(overlay, state); } catch (error) { return message(error.message, 'error'); }
      const tile = normalizeTile(state.document.tiles.find((item) => Number(item.resortTileId) === Number(state.selectedTileId)));
      tile.tags = tile.tags.filter((tag) => tag !== button.dataset.tpeRemoveTag);
      render();
    }));
    const addCustomTag = () => {
      try { syncInspector(overlay, state); } catch (error) { return message(error.message, 'error'); }
      const input = overlay.querySelector('[data-tpe-custom-tag]');
      const tile = normalizeTile(state.document.tiles.find((item) => Number(item.resortTileId) === Number(state.selectedTileId)));
      if (input && addTileTag(tile, input.value)) render();
    };
    overlay.querySelector('[data-tpe-add-custom-tag]')?.addEventListener('click', addCustomTag);
    overlay.querySelector('[data-tpe-custom-tag]')?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { event.preventDefault(); addCustomTag(); }
    });
    const search = overlay.querySelector('[data-tpe-tile-search]'); if (search) search.oninput = () => { state.search = search.value; render(); };
    overlay.querySelector('[data-tpe-collision-mode]')?.addEventListener('change', (event) => overlay.querySelector('[data-tpe-mask-wrap]')?.classList.toggle('hidden', event.target.value !== 'mask'));
    overlay.querySelectorAll('[data-tpe-mask]').forEach((button) => button.onclick = () => { const tile = normalizeTile(state.document.tiles.find((item) => item.resortTileId === state.selectedTileId)); const [x,y] = button.dataset.tpeMask.split(',').map(Number); tile.collision.mask[y] ||= []; tile.collision.mask[y][x] = !tile.collision.mask[y][x]; button.classList.toggle('active', tile.collision.mask[y][x]); });
    overlay.querySelector('[data-tpe-add-tab]')?.addEventListener('click', () => { const ids = new Set(state.document.tabs.map((tab) => tab.id)); state.document.tabs.push({ id: uniqueId('new_tab', ids), name: 'New tab', order: state.document.tabs.length, tileIds: [] }); render(); });
    overlay.querySelectorAll('[data-tab-index]').forEach((row) => { const index = Number(row.dataset.tabIndex); row.querySelector('[data-tpe-tab-name]').onchange = (event) => { state.document.tabs[index].name = event.target.value.trim() || state.document.tabs[index].name; }; row.querySelector('[data-tpe-tab-up]').onclick = () => { [state.document.tabs[index - 1], state.document.tabs[index]] = [state.document.tabs[index], state.document.tabs[index - 1]]; render(); }; row.querySelector('[data-tpe-tab-down]').onclick = () => { [state.document.tabs[index + 1], state.document.tabs[index]] = [state.document.tabs[index], state.document.tabs[index + 1]]; render(); }; row.querySelector('[data-tpe-tab-delete]').onclick = () => { const [removed] = state.document.tabs.splice(index, 1); state.document.tabs[0].tileIds.push(...removed.tileIds.filter((id) => !state.document.tabs[0].tileIds.includes(id))); render(); }; });
    overlay.querySelector('[data-tpe-add-path]')?.addEventListener('click', () => { const ids = new Set(state.document.smartSets.map((set) => set.id)); state.document.smartSets.push({ id: uniqueId('path', ids), name: 'New path', width: 5, height: 3, grid: Array.from({ length: 5 }, () => Array(3).fill(-1)) }); state.selectedPath = state.document.smartSets.length - 1; render(); });
    overlay.querySelector('[data-tpe-delete-path]')?.addEventListener('click', () => { state.document.smartSets.splice(state.selectedPath, 1); state.selectedPath = 0; render(); });
    overlay.querySelectorAll('[data-tpe-path]').forEach((button) => button.onclick = () => { state.selectedPath = Number(button.dataset.tpePath); render(); });
    const path = state.document.smartSets[state.selectedPath]; const pathName = overlay.querySelector('[data-tpe-path-name]'); if (path && pathName) { pathName.onchange = (e) => { path.name = e.target.value.trim() || path.name; }; overlay.querySelectorAll('[data-tpe-path-cell]').forEach((select) => select.onchange = () => { const [x,y] = select.dataset.tpePathCell.split(',').map(Number); path.grid[x][y] = Number(select.value); }); const resize = () => { const w = Number(overlay.querySelector('[data-tpe-path-width]').value); const h = Number(overlay.querySelector('[data-tpe-path-height]').value); path.grid = Array.from({ length: w }, (_, x) => Array.from({ length: h }, (_, y) => path.grid?.[x]?.[y] ?? -1)); path.width = w; path.height = h; render(); }; overlay.querySelector('[data-tpe-path-width]').onchange = resize; overlay.querySelector('[data-tpe-path-height]').onchange = resize; }
    const asset = overlay.querySelector('[data-tpe-asset]'); if (asset) asset.onchange = async () => {
      state.assets = Array.from(asset.files || []); state.asset = state.assets[0] || null; state.bundleInfo = null; state.replaceTab = false;
      const label = overlay.querySelector('[data-tpe-file-label]'); if (label && state.asset) label.textContent = state.assets.length > 1 ? `${state.assets.length} .tile bundles` : state.asset.name;
      if (state.assets.length > 1 && state.assets.some((item) => !/\.tile$/i.test(item.name))) { state.assets = []; state.asset = null; return message('Select only .tile bundles for a batch.', 'error'); }
      if (!state.asset || !/\.tile$/i.test(state.asset.name)) return;
      try {
        message('Reading tile bundle…');
        const form = new FormData(); form.append('tileBundle', state.asset, state.asset.name);
        const inspected = await api('/api/tile-packages/tile-bundles/inspect', { method: 'POST', body: form });
        state.bundleInfo = inspected.bundle; render(); message(state.assets.length > 1 ? `${state.assets.length} tile bundles ready.` : 'Tile bundle ready.', 'ok');
      } catch (error) { state.bundleInfo = null; message(error.message, 'error'); }
    }; overlay.querySelector('[data-tpe-import]')?.addEventListener('click', importTile);
  };
  overlay.addEventListener('mousedown', (event) => { if (event.target === overlay) close(); });
  document.addEventListener('keydown', function escapeClose(event) { if (event.key === 'Escape' && overlay.isConnected) { close(); document.removeEventListener('keydown', escapeClose); } });
  render();
}
