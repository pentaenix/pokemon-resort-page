/* .charbin characters — expands legacy renderLibraryDetail layout */
const PKG_POKEMON_SPRITES_KEY = 'spmk.pkg.pokemonShowSprites';

let pkgState = {
  settings: null,
  profiles: null,
  draft: null,
  assetIds: [],
  panel: 'list',
  selectedPath: null,
  selectedSheetId: null,
  animStops: [],
  pokemonShowSprites: null,
  listSnapshot: null,
  listSnapshotStale: false,
};

function pkgInvalidateListSnapshot() {
  pkgState.listSnapshotStale = true;
}

function pkgCaptureListSnapshot() {
  if (pkgState.panel !== 'list') return false;
  const view = $('#view');
  if (!view) return false;
  if (!view.querySelector('.pkg-lib-searchbar, .character[data-path], .pkg-lib-pokemon, .empty')) return false;
  pkgState.listSnapshot = {
    toolbarHtml: $('#toolbarControls')?.innerHTML || '',
    viewTitle: $('#viewTitle')?.textContent || 'Characters',
    scrollTop: view.scrollTop,
    openDetails: $$('details[open]', view).map((d) => {
      if (d.classList.contains('pkg-lib-pokemon')) return 'pokemon';
      if (d.classList.contains('pkg-lib-gen')) return `gen:${d.dataset.gen}`;
      return null;
    }).filter(Boolean),
    filters: { ...pkgLibFilters },
  };
  pkgState.listSnapshotStale = false;
  return true;
}

function pkgLeaveListPanel() {
  if (pkgState.panel === 'list') pkgCaptureListSnapshot();
}

function pkgRestoreListSnapshot() {
  const snap = pkgState.listSnapshot;
  if (!snap || pkgState.listSnapshotStale) return false;
  pkgState.panel = 'list';
  if (snap.filters) pkgLibFilters = { ...defaultPkgLibFilters(), ...snap.filters };
  stopPkgAnims();
  title(snap.viewTitle || 'Characters');
  if (snap.toolbarHtml) $('#toolbarControls').innerHTML = snap.toolbarHtml;
  renderCharList();
  const view = $('#view');
  if (!view) return true;
  (snap.openDetails || []).forEach((key) => {
    if (key === 'pokemon') {
      const d = $('.pkg-lib-pokemon', view);
      if (d) d.open = true;
    } else if (key.startsWith('gen:')) {
      const d = $(`.pkg-lib-gen[data-gen="${key.slice(4)}"]`, view);
      if (d) d.open = true;
    }
  });
  if (snap.scrollTop != null) view.scrollTop = snap.scrollTop;
  return true;
}

function pkgBackToList() {
  pkgState.panel = 'list';
  if (pkgRestoreListSnapshot()) return;
  renderCharList();
}

function pokemonLibraryShowSprites() {
  if (pkgState.pokemonShowSprites != null) return !!pkgState.pokemonShowSprites;
  try {
    return localStorage.getItem(PKG_POKEMON_SPRITES_KEY) === '1';
  } catch {
    return false;
  }
}

function setPokemonLibraryShowSprites(on) {
  pkgState.pokemonShowSprites = !!on;
  try {
    localStorage.setItem(PKG_POKEMON_SPRITES_KEY, on ? '1' : '0');
  } catch { /* ignore */ }
}

const PKG_BASE_SLOTS = [
  ['base_down', 'south'],
  ['base_left', 'west'],
  ['base_right', 'east'],
  ['base_up', 'north'],
];

const PKG_DIR_DISPLAY = [
  ['south', 'Down'],
  ['west', 'Left'],
  ['east', 'Right'],
  ['north', 'Up'],
];

const PKG_ACTION_ORDER_CHARACTER = ['idle', 'walk'];
const PKG_ACTION_ORDER_POKEMON = ['pause', 'idle', 'walk'];
const PKG_ACTION_ORDER_OBJECT = ['play'];

function pkgActionOrder(p) {
  const ct = p?.metadata?.characterType;
  if (isObjectCharType(ct)) return PKG_ACTION_ORDER_OBJECT;
  if (isPokemonCharType(ct)) return null;
  return PKG_ACTION_ORDER_CHARACTER;
}

function pkgPokemonActionSortKey(action) {
  const id = action?.id || '';
  const anim = (action?.animationName || '').toLowerCase();
  if (anim === 'sleep' || id === 'sleep' || id.startsWith('sleep_')) return [999999, 0, 0];
  const m = id.match(/^(pause|idle|walk)(?:_(.+))?$/);
  if (!m) return [2, id, 0];
  const suffix = m[2] || '';
  const kind = { pause: 0, idle: 1, walk: 2 }[m[1]] ?? 9;
  const formMatch = suffix.match(/^(\d+)(?:_|$)/);
  const formSort = formMatch ? Number(formMatch[1]) : suffix ? 999998 : -1;
  const modPart = formMatch ? suffix.slice(formMatch[0].length) : suffix;
  return [formSort, modPart, kind];
}

let pkgPendingSheetAdd = null;

async function startPkgSheetUpload() {
  const p = pkg();
  if (!p) return;
  if (isObjectCharType(p?.metadata?.characterType)) {
    pkgPendingSheetAdd = {
      mode: pkgHasPrimarySheet(p) ? 'replace_primary' : 'primary',
      label: '',
    };
  } else if (pkgNeedsAddSheetModal(p)) {
    const cfg = await openAddSheetModal(p);
    if (!cfg) return;
    pkgPendingSheetAdd = cfg;
  } else {
    pkgPendingSheetAdd = { mode: 'primary', label: '' };
  }
  $('#pkgSheetUpload')?.click();
}

function pkgHasAnySheetAsset(p) {
  return (p?.spriteSheets || []).some((s) => s.assetId);
}

function pkgHasPrimarySheet(p) {
  const objectMode = isObjectCharType(p?.metadata?.characterType);
  const primaryId = objectMode ? 'sheet' : 'walk';
  return (p?.spriteSheets || []).some((s) => s.id === primaryId && s.assetId);
}

function pkgNeedsAddSheetModal(p) {
  if (!p || isObjectCharType(p?.metadata?.characterType)) return false;
  return pkgHasAnySheetAsset(p);
}

function pkgHasOnlyPrimarySheet(p) {
  const objectMode = isObjectCharType(p?.metadata?.characterType);
  const primaryId = objectMode ? 'sheet' : 'walk';
  const withAsset = (p?.spriteSheets || []).filter((s) => s.assetId);
  return withAsset.length === 1 && withAsset[0].id === primaryId;
}

const PKG_ADD_SHEET_MODES = [
  ['custom_anim', 'New animation sheet', 'Extra movement or emote — e.g. <code>run</code>, <code>bike</code>, <code>wave</code>. Writes sheet <code>animations</code> + <code>actions</code>.'],
  ['replace_primary', 'Replace walk sheet', 'Upload a corrected walk cycle — replaces the <code>walk</code> PNG and resets idle/walk actions. Other sheets (run, etc.) are kept.'],
];

function addSheetModalModes(p) {
  const objectMode = isObjectCharType(p?.metadata?.characterType);
  const hasPrimary = pkgHasPrimarySheet(p);
  if (!hasPrimary) return PKG_ADD_SHEET_MODES;
  const replaceLabel = objectMode ? 'Replace sprite sheet' : 'Replace walk sheet';
  const replaceHint = objectMode
    ? 'Upload a new PNG for the main sprite (replaces default play/static actions).'
    : 'Upload a corrected walk cycle — replaces the <code>walk</code> PNG and resets idle/walk actions. Other sheets are kept.';
  return [
    [PKG_ADD_SHEET_MODES[1][0], replaceLabel, replaceHint],
    PKG_ADD_SHEET_MODES[0],
  ];
}

function openAddSheetModal(p) {
  const modes = addSheetModalModes(p);
  const defaultMode = pkgHasOnlyPrimarySheet(p) ? 'replace_primary' : 'custom_anim';
  const modeRadios = modes.map(([val, title, hint]) => `
    <label class="check pkg-add-sheet-mode">
      <input type="radio" name="pkgAddSheetMode" value="${esc(val)}" ${val === defaultMode ? 'checked' : ''}>
      <span><b>${esc(title)}</b><br><span class="tiny">${hint}</span></span>
    </label>`).join('');
  const html = `<div class="modal card">${modalHead('Add or replace sheet')}
    <p class="tiny">Adds a charbin sheet with embedded PNG, per-sheet animation timing, and action records — same schema for player, NPC, and Pokémon.</p>
    <div class="pkg-add-sheet-modes">${modeRadios}</div>
    <div class="field" id="pkgAddSheetLabelRow">
      <label>Animation name</label>
      <input class="input" id="pkgAddSheetLabel" placeholder="run · bike · wave · sleep">
      <p class="tiny">Becomes sheet id and action id (e.g. <code>run</code> → sheet <code>run</code>).</p>
    </div>
    <div id="pkgAddSheetCustomOpts" class="pkg-add-sheet-custom" hidden>
      <div class="field"><label>Sheet layout</label>
        <select class="select" id="pkgAddSheetAnimKind">
          <option value="movement">Movement — 4 directions (one row per facing)</option>
          <option value="idle">Idle / emote — hold pose on each row</option>
          <option value="south_only">South row only — single-facing loop</option>
        </select>
      </div>
      <label class="check" id="pkgAddSheetIdleRow"><input type="checkbox" id="pkgAddSheetIncludeIdle"> Include idle on this sheet (frame 0 stand)</label>
      <div class="grid cols2">
        <div class="field"><label>Frames (columns)</label><input class="input" id="pkgAddSheetFrames" type="number" min="1" max="4" value="4"></div>
        <div class="field"><label>Frame time (ms)</label><input class="input" id="pkgAddSheetFrameMs" type="number" min="50" value="120"></div>
      </div>
    </div>
    ${modalFoot('<button type="button" class="btn" id="pkgAddSheetCancel">Cancel</button>', '<button type="button" class="btn primary" id="pkgAddSheetOk">Next: choose PNG</button>')}
  </div>`;
  const m = mountModal(html, { backdropClose: true });
  const labelRow = $('#pkgAddSheetLabelRow', m.root);
  const customRow = $('#pkgAddSheetCustomOpts', m.root);
  const idleRow = $('#pkgAddSheetIdleRow', m.root);
  const animKindSel = $('#pkgAddSheetAnimKind', m.root);
  const syncCustomKind = () => {
    const kind = animKindSel?.value || 'movement';
    if (idleRow) idleRow.style.display = kind === 'movement' ? '' : 'none';
  };
  const syncMode = () => {
    const mode = $('input[name="pkgAddSheetMode"]:checked', m.root)?.value || 'custom_anim';
    const isAnim = mode === 'custom_anim';
    labelRow.style.display = mode === 'replace_primary' ? 'none' : '';
    if (customRow) customRow.hidden = !isAnim;
    if (isAnim) syncCustomKind();
  };
  animKindSel?.addEventListener('change', syncCustomKind);
  $$('input[name="pkgAddSheetMode"]', m.root).forEach((el) => { el.onchange = syncMode; });
  syncMode();
  return new Promise((resolve) => {
    const finish = (val) => { m.close(); resolve(val); };
    $('#pkgAddSheetCancel', m.root).onclick = () => finish(null);
    $('.modal-close', m.root).onclick = () => finish(null);
    $('#pkgAddSheetOk', m.root).onclick = () => {
      const mode = $('input[name="pkgAddSheetMode"]:checked', m.root)?.value || 'custom_anim';
      const label = ($('#pkgAddSheetLabel', m.root)?.value || '').trim();
      if (mode !== 'replace_primary' && !label) {
        toast('Enter an animation name');
        return;
      }
      const animKind = $('#pkgAddSheetAnimKind', m.root)?.value || 'movement';
      finish({
        mode,
        label,
        animKind,
        includeIdle: !!$('#pkgAddSheetIncludeIdle', m.root)?.checked,
        frameCount: Math.max(1, Math.min(4, Number($('#pkgAddSheetFrames', m.root)?.value) || 4)),
        frameTimeMs: Math.max(50, Number($('#pkgAddSheetFrameMs', m.root)?.value) || 120),
      });
    };
  });
}

function addSheetToast(mode, sheetId, scaled) {
  const scaleNote = scaled ? ' (scaled 64px→32px cells)' : '';
  if (mode === 'custom_anim') return `Animation sheet added: ${sheetId}${scaleNote}`;
  if (mode === 'replace_primary') return `Walk sheet replaced${scaleNote}`;
  return `Sheet added${scaleNote}`;
}

async function onPkgSheetFileSelected(e) {
  const f = e.target.files?.[0];
  e.target.value = '';
  if (!f || !pkg()) return;
  const pending = pkgPendingSheetAdd;
  pkgPendingSheetAdd = null;
  const p = pkg();
  const defaults = {
    mode: 'primary',
    label: '',
    animKind: 'movement',
    includeIdle: false,
    frameCount: 4,
    frameTimeMs: 120,
  };
  let opts = { ...defaults };
  if (pending) {
    opts = { ...defaults, ...pending };
  } else if (isObjectCharType(p?.metadata?.characterType)) {
    opts.mode = pkgHasPrimarySheet(p) ? 'replace_primary' : 'primary';
  }
  const fd = new FormData();
  fd.append('file', f);
  fd.append('mode', opts.mode);
  fd.append('label', opts.label || '');
  fd.append('walkSheetId', 'walk');
  if (opts.mode === 'custom_anim') {
    fd.append('animKind', opts.animKind || 'movement');
    fd.append('includeIdle', opts.includeIdle ? '1' : '0');
    fd.append('frameCount', String(opts.frameCount));
    fd.append('frameTimeMs', String(opts.frameTimeMs));
  }
  setSave('uploading');
  try {
    const res = await fetch('/api/packages/draft/add-sheet', { method: 'POST', body: fd });
    if (!res.ok) {
      const err = await res.text().catch(() => '');
      toast(err ? `Sheet upload failed: ${err}` : 'Sheet upload failed');
      return;
    }
    const body = await res.json();
    pkgState.draft = body.package;
    pkgState.assetIds = body.assetIds || [];
    pkgState.selectedSheetId = body.sheetId || pkgState.selectedSheetId;
    renderPackages();
    const scaled = !!(body.prepare && body.prepare.scaled);
    toast(addSheetToast(opts.mode, body.sheetId || '', scaled));
  } finally {
    setSave('ready');
  }
}

const PKG_CHAR_TYPES = [
  ['player', 'Player'],
  ['npc', 'NPC'],
  ['pokemon', 'Pokémon'],
  ['object', 'Object'],
];

function normalizeCharType(type) {
  const t = String(type || 'npc').toLowerCase();
  if (t === 'playable' || t === 'player') return 'player';
  if (t === 'pokemon') return 'pokemon';
  if (t === 'object') return 'object';
  return 'npc';
}

function isPlayerCharType(type) {
  return normalizeCharType(type) === 'player';
}

function isPokemonCharType(type) {
  return normalizeCharType(type) === 'pokemon';
}

function isNpcCharType(type) {
  return normalizeCharType(type) === 'npc';
}

function isObjectCharType(type) {
  return normalizeCharType(type) === 'object';
}

function currentCharType() {
  return normalizeCharType($('#pkgType')?.value || pkg()?.metadata?.characterType || 'npc');
}

function partitionLibrary(list) {
  const playable = [];
  const characters = [];
  const pokemon = [];
  const objects = [];
  for (const e of list) {
    const t = normalizeCharType(e.characterType);
    if (t === 'player') playable.push(e);
    else if (t === 'pokemon') pokemon.push(e);
    else if (t === 'object') objects.push(e);
    else characters.push(e);
  }
  pokemon.sort((a, b) => {
    const da = Number(a.pokemonId);
    const db = Number(b.pokemonId);
    const aOk = Number.isFinite(da) && da > 0;
    const bOk = Number.isFinite(db) && db > 0;
    if (!aOk && !bOk) return String(a.id || '').localeCompare(String(b.id || ''));
    if (!aOk) return -1;
    if (!bOk) return 1;
    if (da !== db) return da - db;
    return String(a.id || '').localeCompare(String(b.id || ''));
  });
  objects.sort((a, b) => String(a.id || '').localeCompare(String(b.id || '')));
  return { playable, characters, pokemon, objects };
}

const PKG_LIB_FILTERS_KEY = 'spmk.pkg.libFilters';
const PKG_LIB_TYPE_FILTERS = [
  ['player', 'Player'],
  ['character', 'NPC'],
  ['pokemon', 'Pokémon'],
  ['object', 'Object'],
];
const PKG_LIB_CELL_FILTERS = [
  ['small', 'Small', '32px'],
  ['medium', 'Medium', '40px'],
  ['large', 'Large', '64px+'],
  ['other', 'Other', 'odd cells'],
];
const PKG_LIB_SHEET_FILTERS = [
  ['128', '128px'],
  ['160', '160px'],
  ['256', '256px'],
  ['other', 'Other'],
];

function defaultPkgLibFilters() {
  return { query: '', types: [], gens: [], cellSizes: [], sheetSizes: [], pokemonTypes: [], tags: [] };
}

let pkgLibFilters = defaultPkgLibFilters();
let pkgLibFilterTimer = null;

function loadPkgLibFilters() {
  try {
    const raw = localStorage.getItem(PKG_LIB_FILTERS_KEY);
    if (!raw) return defaultPkgLibFilters();
    return { ...defaultPkgLibFilters(), ...JSON.parse(raw) };
  } catch {
    return defaultPkgLibFilters();
  }
}

function savePkgLibFilters() {
  try { localStorage.setItem(PKG_LIB_FILTERS_KEY, JSON.stringify(pkgLibFilters)); } catch { /* ignore */ }
}

pkgLibFilters = loadPkgLibFilters();

function pkgLibEntryTypeKey(entry) {
  const t = normalizeCharType(entry?.characterType);
  if (t === 'player') return 'player';
  if (t === 'pokemon') return 'pokemon';
  if (t === 'object') return 'object';
  return 'character';
}

function pkgLibCellSizeBucket(entry) {
  const w = Number(entry?.walkCellWidth);
  if (!Number.isFinite(w)) return 'unknown';
  if (w === 32) return 'small';
  if (w === 40) return 'medium';
  if (w >= 64) return 'large';
  return 'other';
}

function pkgLibEntryGeneration(entry) {
  const dex = pokemonDexNumber(entry);
  if (dex == null) return 0;
  return pokemonGenerationGroup(dex).gen;
}

function pkgLibSearchHaystack(entry) {
  const w = entry.walkCellWidth;
  const h = entry.walkCellHeight;
  const sw = entry.walkSheetWidth;
  const sh = entry.walkSheetHeight;
  const sheetBits = (entry.sheetDimensions || []).map((s) =>
    `${s.width}x${s.height} ${s.width}×${s.height} ${s.id || ''}`,
  );
  return [
    entry.displayName,
    entry.id,
    entry.internalName,
    entry.fileName,
    entry.baseProfile,
    entry.walkSheetId,
    entry.pokemonId != null ? String(entry.pokemonId) : '',
    entry.pokemonId != null ? `#${entry.pokemonId}` : '',
    ...(entry.pokemonTypes || []),
    ...(entry.tags || []),
    ...(entry.sheetSizeBuckets || []),
    w != null && h != null ? `${w}x${h}` : '',
    w != null && h != null ? `${w}×${h}` : '',
    sw != null && sh != null ? `${sw}x${sh}` : '',
    sw != null && sh != null ? `sheet ${sw}×${sh}` : '',
    ...sheetBits,
  ].filter(Boolean).join(' ').toLowerCase();
}

function pkgLibActiveFilterCount() {
  const f = pkgLibFilters;
  return f.types.length + f.gens.length + f.cellSizes.length + f.sheetSizes.length
    + f.pokemonTypes.length + f.tags.length;
}

function pkgLibFiltersActive() {
  return pkgLibActiveFilterCount() > 0 || Boolean(pkgLibFilters.query.trim());
}

function pkgLibPokemonFlatMode() {
  return pkgLibFiltersActive();
}

function matchesPkgLibFilters(entry) {
  const f = pkgLibFilters;
  if (f.query.trim()) {
    const q = f.query.trim().toLowerCase();
    if (!pkgLibSearchHaystack(entry).includes(q)) return false;
  }
  if (f.types.length && !f.types.includes(pkgLibEntryTypeKey(entry))) return false;
  if (f.gens.length && pkgLibEntryTypeKey(entry) === 'pokemon') {
    if (!f.gens.includes(String(pkgLibEntryGeneration(entry)))) return false;
  }
  if (f.cellSizes.length) {
    const bucket = pkgLibCellSizeBucket(entry);
    if (bucket === 'unknown' || !f.cellSizes.includes(bucket)) return false;
  }
  if (f.sheetSizes.length) {
    const buckets = entry.sheetSizeBuckets || [];
    if (!f.sheetSizes.some((s) => buckets.includes(s))) return false;
  }
  if (f.pokemonTypes.length) {
    const types = (entry.pokemonTypes || []).map((t) => String(t).toLowerCase());
    if (!f.pokemonTypes.some((t) => types.includes(t))) return false;
  }
  if (f.tags.length) {
    const tags = (entry.tags || []).map((t) => String(t).toLowerCase());
    if (!f.tags.some((t) => tags.includes(t))) return false;
  }
  return true;
}

function applyPkgLibFilters(list) {
  return (list || []).filter(matchesPkgLibFilters);
}

function collectPkgLibPokemonTypes(list) {
  const out = new Set();
  for (const e of list || []) {
    if (pkgLibEntryTypeKey(e) !== 'pokemon') continue;
    for (const t of e.pokemonTypes || []) {
      const s = String(t).trim().toLowerCase();
      if (s) out.add(s);
    }
  }
  return [...out].sort();
}

function collectPkgLibTags(list) {
  const out = new Set();
  for (const e of list || []) {
    for (const t of e.tags || []) {
      const s = String(t).trim().toLowerCase();
      if (s) out.add(s);
    }
  }
  return [...out].sort();
}

function pkgLibFilterChip(kind, value, label, active) {
  return `<button type="button" class="pkg-lib-filter-chip${active ? ' active' : ''}" data-filter-kind="${esc(kind)}" data-filter-value="${esc(value)}" aria-pressed="${active ? 'true' : 'false'}">${esc(label)}</button>`;
}

function pkgLibFilterModalSection(label, chipsHtml) {
  return `<div class="pkg-lib-filter-group">
    <span class="pkg-lib-filter-label">${esc(label)}</span>
    <div class="pkg-lib-filter-chips pkg-lib-filter-chips-wrap">${chipsHtml}</div>
  </div>`;
}

function renderPkgLibFilterModalBody(fullList) {
  const f = pkgLibFilters;
  const typeChips = PKG_LIB_TYPE_FILTERS.map(([val, label]) =>
    pkgLibFilterChip('types', val, label, f.types.includes(val)),
  ).join('');
  const genChips = [
    pkgLibFilterChip('gens', '0', 'No dex', f.gens.includes('0')),
    ...POKEMON_GEN_RANGES.map((row) =>
      pkgLibFilterChip('gens', String(row.gen), `Gen ${row.gen}`, f.gens.includes(String(row.gen))),
    ),
  ].join('');
  const cellChips = PKG_LIB_CELL_FILTERS.map(([val, label, hint]) =>
    pkgLibFilterChip('cellSizes', val, `${label} · ${hint}`, f.cellSizes.includes(val)),
  ).join('');
  const sheetChips = PKG_LIB_SHEET_FILTERS.map(([val, label]) =>
    pkgLibFilterChip('sheetSizes', val, label, f.sheetSizes.includes(val)),
  ).join('');
  const pokeTypes = collectPkgLibPokemonTypes(fullList);
  const pokeTypeChips = pokeTypes.length
    ? pokeTypes.map((t) => pkgLibFilterChip('pokemonTypes', t, t, f.pokemonTypes.includes(t))).join('')
    : '<span class="tiny pkg-lib-filter-empty">No types in library yet</span>';
  const tagList = collectPkgLibTags(fullList);
  const tagChips = tagList.length
    ? tagList.map((t) => pkgLibFilterChip('tags', t, t, f.tags.includes(t))).join('')
    : '<span class="tiny pkg-lib-filter-empty">Tags appear when added to charbins</span>';
  return `
    ${pkgLibFilterModalSection('Type', typeChips)}
    ${pkgLibFilterModalSection('Generation', genChips)}
    ${pkgLibFilterModalSection('Walk cell size', cellChips)}
    ${pkgLibFilterModalSection('Sprite sheet size (any sheet)', sheetChips)}
    ${pkgLibFilterModalSection('Pokémon types', pokeTypeChips)}
    ${pkgLibFilterModalSection('Tags', tagChips)}
    <p class="tiny pkg-lib-filter-modal-hint">Sprite sheet size checks <b>every</b> embedded PNG on the character. A species with both 128px and 160px sheets appears in both filters. When any filter is active, Pokémon results show in one flat list.</p>`;
}

function bindPkgLibFilterModalChips(modalRoot, fullList, onChange) {
  $$('.pkg-lib-filter-chip', modalRoot).forEach((btn) => {
    btn.onclick = () => {
      const kind = btn.dataset.filterKind;
      const value = btn.dataset.filterValue;
      togglePkgLibFilter(kind, value);
      const active = (pkgLibFilters[kind] || []).includes(value);
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', String(active));
      const countEl = $('#pkgLibModalActiveCount', modalRoot);
      if (countEl) countEl.textContent = String(pkgLibActiveFilterCount());
      onChange?.();
    };
  });
}

function openPkgLibFilterModal(fullList) {
  const active = pkgLibActiveFilterCount();
  const html = `<div class="modal card pkg-lib-filter-modal big">
    ${modalHead('Library filters')}
    <div class="pkg-lib-filter-modal-summary">
      <span id="pkgLibModalActiveCount" class="tag">${active} active</span>
      <span class="tiny">Toggle chips to narrow the library. Search text stays in the bar above the list.</span>
    </div>
    <div class="pkg-lib-filter-grid" id="pkgLibModalBody">${renderPkgLibFilterModalBody(fullList)}</div>
    ${modalFoot(
    '<button type="button" class="btn" id="pkgLibModalClear">Clear all</button>',
    '<button type="button" class="btn primary" id="pkgLibModalDone">Apply</button>',
  )}
  </div>`;
  const m = mountModal(html, { backdropClose: true });
  const refreshModal = () => {
    const body = $('#pkgLibModalBody', m.root);
    if (body) {
      body.innerHTML = renderPkgLibFilterModalBody(fullList);
      bindPkgLibFilterModalChips(m.root, fullList);
    }
    const countEl = $('#pkgLibModalActiveCount', m.root);
    if (countEl) countEl.textContent = String(pkgLibActiveFilterCount());
  };
  bindPkgLibFilterModalChips(m.root, fullList);
  $('#pkgLibModalClear', m.root).onclick = () => {
    const q = pkgLibFilters.query;
    pkgLibFilters = defaultPkgLibFilters();
    pkgLibFilters.query = q;
    savePkgLibFilters();
    refreshModal();
  };
  $('#pkgLibModalDone', m.root).onclick = () => {
    savePkgLibFilters();
    m.close();
    renderCharList();
  };
}

function renderPkgLibSearchBar(fullList, filteredList) {
  const f = pkgLibFilters;
  const total = fullList.length;
  const shown = filteredList.length;
  const chipCount = pkgLibActiveFilterCount();
  const badge = chipCount ? `<span class="pkg-lib-filter-badge">${chipCount}</span>` : '';
  return `<div class="pkg-lib-searchbar card sidecard">
    <input class="input pkg-lib-search" id="pkgLibSearch" type="search" placeholder="Search characters…" value="${esc(f.query)}" autocomplete="off" spellcheck="false"/>
    <button type="button" class="btn small pkg-lib-filters-btn" id="pkgLibOpenFilters">Filters${badge}</button>
    ${pkgLibFiltersActive() ? '<button type="button" class="btn small ghost" id="pkgLibClearFilters">Clear</button>' : ''}
    <span class="pkg-lib-result-count" id="pkgLibResultCount">${shown === total ? `${total} characters` : `${shown} of ${total}`}</span>
  </div>`;
}

function clearPkgLibFilters() {
  pkgLibFilters = defaultPkgLibFilters();
  savePkgLibFilters();
  renderCharList();
}

function togglePkgLibFilter(kind, value) {
  const arr = pkgLibFilters[kind];
  if (!Array.isArray(arr)) return;
  const i = arr.indexOf(value);
  if (i >= 0) arr.splice(i, 1);
  else arr.push(value);
}

function bindPkgLibSearchBar(fullList) {
  const search = $('#pkgLibSearch');
  if (search) {
    search.oninput = () => {
      pkgLibFilters.query = search.value;
      clearTimeout(pkgLibFilterTimer);
      pkgLibFilterTimer = setTimeout(() => {
        savePkgLibFilters();
        renderCharList();
      }, 180);
    };
    search.onkeydown = (e) => {
      if (e.key === 'Escape') {
        pkgLibFilters.query = '';
        search.value = '';
        savePkgLibFilters();
        renderCharList();
      }
    };
  }
  const openBtn = $('#pkgLibOpenFilters');
  if (openBtn) openBtn.onclick = () => openPkgLibFilterModal(fullList);
  const clearBtn = $('#pkgLibClearFilters');
  if (clearBtn) clearBtn.onclick = () => clearPkgLibFilters();
}

function libraryCellSizeTag(entry) {
  const w = Number(entry?.walkCellWidth);
  if (!Number.isFinite(w)) return '';
  const h = Number(entry?.walkCellHeight) || w;
  if (w === 32 && h === 32) return '';
  const bucket = pkgLibCellSizeBucket(entry);
  const cls = bucket === 'other' ? 'tag warn' : 'tag';
  const sheet = entry.walkSheetWidth && entry.walkSheetHeight
    ? ` · sheet ${entry.walkSheetWidth}×${entry.walkSheetHeight}`
    : '';
  return `<span class="${cls}">${w}×${h}${sheet}</span>`;
}

function libraryTypeTag(entry) {
  const t = normalizeCharType(entry.characterType);
  if (t === 'player') return `<span class="tag">player</span>${libraryCellSizeTag(entry)}`;
  if (t === 'pokemon') {
    const dex = entry.pokemonId != null ? `#${entry.pokemonId}` : '';
    const sheets = Number(entry.sheetCount) || 0;
    const sheetTag = sheets > 1
      ? `<span class="tag good">${sheets} sheets</span>`
      : '<span class="tag">base only</span>';
    const types = (entry.pokemonTypes || []).slice(0, 2).map((pt) =>
      `<span class="tag">${esc(String(pt))}</span>`).join('');
    return `<span class="tag">pokémon</span>${dex ? `<span class="tag">${esc(dex)}</span>` : ''}${types}${sheetTag}${libraryCellSizeTag(entry)}`;
  }
  if (t === 'object') return `<span class="tag">object</span>${libraryCellSizeTag(entry)}`;
  return `<span class="tag">npc</span>${libraryCellSizeTag(entry)}`;
}

function metadataStringList(m, key) {
  const v = m?.[key];
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  if (typeof v === 'string' && v.trim()) return [v.trim()];
  return [];
}

function bindPkgChipList(fieldId, initialItems, placeholder) {
  let items = [...(initialItems || [])];
  const field = $(`#${fieldId}`);
  if (!field) return { get: () => items.slice() };
  const render = () => {
    field.innerHTML = `
      <div class="pkg-chip-wrap">${items.map((text, i) =>
    `<span class="label-chip" data-idx="${i}">${esc(text)}<button type="button" class="chip-rm" data-idx="${i}" aria-label="Remove">×</button></span>`
  ).join('') || '<span class="pkg-chip-empty">None yet</span>'}</div>
      <div class="pkg-chip-add-row">
        <input class="input pkg-chip-input" type="text" placeholder="${esc(placeholder)}" autocomplete="off"/>
        <button type="button" class="btn small primary pkg-chip-add-btn">+</button>
      </div>`;
    $$('.chip-rm', field).forEach((b) => {
      b.onclick = (e) => {
        e.stopPropagation();
        items.splice(Number(b.dataset.idx), 1);
        render();
      };
    });
    const inp = $('.pkg-chip-input', field);
    const add = () => {
      const t = (inp?.value || '').trim();
      if (!t) return;
      if (!items.includes(t)) items.push(t);
      if (inp) inp.value = '';
      render();
    };
    $('.pkg-chip-add-btn', field)?.addEventListener('click', add);
    inp?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); add(); }
    });
  };
  render();
  return { get: () => items.slice() };
}

function setupPkgCharInfoFields(m) {
  const t = normalizeCharType(m?.characterType);
  if (isObjectCharType(t)) {
    pkgState.chipPickers = {
      tags: bindPkgChipList('pkgObjectTagsChips', metadataStringList(m, 'tags'), 'Add tag…'),
    };
    return;
  }
  if (isPokemonCharType(t) || isPlayerCharType(t)) {
    pkgState.chipPickers = {};
    return;
  }
  pkgState.chipPickers = {
    personality: bindPkgChipList('pkgPersonalityChips', metadataStringList(m, 'personality'), 'Add trait…'),
    likes: bindPkgChipList('pkgLikesChips', metadataStringList(m, 'likes'), 'Add like…'),
    tags: bindPkgChipList('pkgTagsChips', metadataStringList(m, 'tags'), 'Add tag…'),
  };
}

function updatePkgFieldVisibility() {
  const t = currentCharType();
  const player = isPlayerCharType(t);
  const pokemon = isPokemonCharType(t);
  const object = isObjectCharType(t);
  $$('[data-npc-only]').forEach((el) => el.classList.toggle('pkg-field-hidden', player || pokemon || object));
  $$('[data-pokemon-only]').forEach((el) => el.classList.toggle('pkg-field-hidden', !pokemon));
  $$('[data-object-only]').forEach((el) => el.classList.toggle('pkg-field-hidden', !object));
  $$('[data-player-npc-only]').forEach((el) => el.classList.toggle('pkg-field-hidden', pokemon || object));
  $$('[data-walk-character-only]').forEach((el) => el.classList.toggle('pkg-field-hidden', object));
  if ((player || pokemon || object) && $('#pkgHasPartner')) {
    $('#pkgHasPartner').checked = false;
    if ($('#pkgPartnerRow')) $('#pkgPartnerRow').style.display = 'none';
  }
  if (pokemon && $('#pkgProfile')?.value === 'character') {
    $('#pkgProfile').value = 'pokemon_small';
  }
  if (object && $('#pkgProfile')?.value === 'character') {
    $('#pkgProfile').value = 'object';
  }
}

async function loadPackageContext() {
  let lib = await api('/api/packages/library');
  const needsWalkMeta = (lib.packages || []).some((e) =>
    !e.error && e.hasThumb && (e.walkCellWidth == null || !Array.isArray(e.sheetSizeBuckets)),
  );
  if (needsWalkMeta) {
    const scanned = await api('/api/packages/scan', { method: 'POST' });
    lib = { ...lib, packages: scanned.packages || lib.packages };
  }
  pkgState.settings = {
    packageDirectory: lib.packageDirectory,
    scannedPackages: lib.packages,
  };
  pkgState.profiles = await api('/api/packages/profiles');
  const d = await api('/api/packages/draft');
  pkgState.draft = d.package;
  pkgState.assetIds = d.assetIds || [];
  if (d.meta?.sourcePath) pkgState.selectedPath = d.meta.sourcePath;
}

function pkg() { return pkgState.draft; }

function profileDef(name) {
  return pkgState.profiles?.profiles?.[name || 'character'] || {};
}

/** Profile + per-sheet overrides (cell size, grid). */
function pkgMergedProf(sheet, baseProfile) {
  const prof = profileDef(sheet?.profile || baseProfile || pkg()?.baseProfile);
  const o = sheet?.profileOverrides || {};
  const fw = Number(o.frameWidth ?? prof.frameWidth) || 32;
  const fh = Number(o.frameHeight ?? prof.frameHeight) || fw;
  return {
    ...prof,
    frameWidth: fw,
    frameHeight: fh,
    columns: Number(o.columns ?? prof.columns) || 4,
    rows: Number(o.rows ?? prof.rows) || 4,
  };
}

function pkgDefaultCellSize(sheet) {
  const prof = profileDef(sheet?.profile || pkg()?.baseProfile);
  return Number(prof.frameWidth) || 32;
}

function pkgEffectiveCellSize(sheet) {
  const o = sheet?.profileOverrides;
  if (o?.frameWidth) return Number(o.frameWidth);
  return pkgDefaultCellSize(sheet);
}

function pkgPokeapiSummaryHtml(api) {
  if (!api || typeof api !== 'object') {
    return '<p class="tiny pkg-pokeapi-empty">Fetch from PokéAPI to store species data in this .charbin (no images).</p>';
  }
  const stats = api.baseStats || {};
  const statLine = ['hp', 'attack', 'defense', 'special-attack', 'special-defense', 'speed']
    .filter((k) => stats[k] != null)
    .map((k) => `${k.replace('special-', 'sp. ')} ${stats[k]}`)
    .join(' · ');
  const abilities = (api.abilities || [])
    .map((a) => `${a.name || a.id}${a.isHidden ? ' (H)' : ''}`)
    .join(', ');
  const flags = [
    api.isLegendary ? 'Legendary' : '',
    api.isMythical ? 'Mythical' : '',
    api.isBaby ? 'Baby' : '',
  ].filter(Boolean).join(', ');
  const rows = [
    ['Generation', api.generation],
    ['Color / shape', [api.color, api.shape].filter(Boolean).join(' · ')],
    ['Habitat', api.habitat],
    ['Egg groups', (api.eggGroups || []).join(', ')],
    ['Growth', api.growthRate],
    ['Capture / happiness', `${api.captureRate ?? '—'} / ${api.baseHappiness ?? '—'}`],
    ['Gender rate', api.genderRate],
    ['Height / weight', `${api.height ?? '—'} dm / ${api.weight ?? '—'} hg`],
    ['Base exp', api.baseExperience],
    ['Base stats', statLine],
    ['Abilities', abilities],
    ['Evolution chain', api.evolutionChainId != null ? `#${api.evolutionChainId}` : ''],
    ['Flags', flags],
    ['Fetched', api.fetchedAt ? new Date(api.fetchedAt).toLocaleString() : ''],
  ].filter(([, v]) => v != null && String(v).trim() !== '');
  return `<div class="pkg-pokeapi-summary">${rows.map(([k, v]) =>
    `<div class="pkg-pokeapi-row"><span class="pkg-pokeapi-k">${esc(k)}</span><span>${esc(String(v))}</span></div>`).join('')}</div>`;
}

function profileLabel(name) {
  const p = profileDef(name);
  const c = p.columns ?? '?';
  const r = p.rows ?? '?';
  const w = p.frameWidth ?? '?';
  const h = p.frameHeight ?? '?';
  const titles = {
    character: 'Trainer / NPC',
    pokemon_small: 'Small Pokémon',
    pokemon_large: 'Large Pokémon',
    object: 'Map object',
  };
  return `${titles[name] || name} · ${c}×${r} · ${w}×${h}px`;
}

function slugFromName(name) {
  return String(name || 'character').toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_|_$/g, '') || 'character';
}

function parseList(s) { return String(s || '').split(',').map((x) => x.trim()).filter(Boolean); }
function parseLines(s) { return String(s || '').split('\n').map((x) => x.trim()).filter(Boolean); }

function defaultPokemonWalkSheetId(p) {
  const walkSheets = pokemonWalkSheetsFromPackage(p);
  if (!walkSheets.length) return null;
  const base = walkSheets.find((s) => s.id === 'walk');
  return base ? base.id : walkSheets[0].id;
}

function selectedPkgSheet() {
  const p = pkg();
  const sheets = p?.spriteSheets || [];
  if (!sheets.length) return null;
  const hit = sheets.find((s) => s.id === pkgState.selectedSheetId);
  if (hit) return hit;
  if (isPokemonCharType(p?.metadata?.characterType)) {
    const walkSheets = pokemonWalkSheetsFromPackage(p);
    return walkSheets[0] || sheets[0];
  }
  return sheets[0];
}

function sheetAssetUrl(sheet) {
  if (!sheet?.assetId) return '';
  return `/api/packages/draft/asset/${encodeURIComponent(sheet.assetId)}`;
}

function stopPkgAnims() {
  (pkgState.animStops || []).forEach((stop) => { try { stop(); } catch (_) { /* ignore */ } });
  pkgState.animStops = [];
}

async function saveDraft(patch) {
  setSave('saving');
  const res = await api('/api/packages/draft', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  pkgState.draft = res.package;
  pkgState.assetIds = res.assetIds || [];
  setSave('ready');
}

function collectDetailForm() {
  const p = pkg() || {};
  const m = p.metadata || {};
  const charType = normalizeCharType($('#pkgType')?.value || 'npc');
  const player = isPlayerCharType(charType);
  const pokemon = isPokemonCharType(charType);
  const object = isObjectCharType(charType);
  const hasPartner = isNpcCharType(charType) && $('#pkgHasPartner')?.checked;
  const chips = pkgState.chipPickers || {};
  let partnerPokemon = null;
  if (hasPartner && $('#pkgPartnerId')?.value?.trim()) {
    partnerPokemon = {
      pokemonId: $('#pkgPartnerId').value.trim(),
      formId: $('#pkgPartnerForm')?.value?.trim() || 'default',
      nickname: $('#pkgPartnerNick')?.value?.trim() || null,
      relationship: 'main_partner',
    };
  }
  const formsRaw = ($('#pkgForms')?.value || '').trim();
  const forms = formsRaw
    ? formsRaw.split(',').map((x) => x.trim()).filter(Boolean).map((name, i) => ({
      id: slugFromName(name) || `form_${i}`,
      name,
    }))
    : (m.forms || []);
  return {
    displayName: ($('#pkgName')?.value || '').trim(),
    internalName: ($('#pkgInternal')?.value || '').trim() || p.id,
    baseProfile: $('#pkgProfile')?.value || (pokemon ? 'pokemon_small' : (object ? 'object' : 'character')),
    metadata: {
      ...m,
      characterType: charType,
      description: pokemon ? '' : ($('#pkgDesc')?.value || '').trim(),
      personality: (player || pokemon || object) ? [] : (chips.personality?.get() || []),
      partnerPokemon: (player || pokemon || object) ? null : partnerPokemon,
      likes: (player || pokemon || object) ? [] : (chips.likes?.get() || []),
      tags: isObjectCharType(charType)
        ? (pkgState.chipPickers?.tags?.get() || [])
        : ((player || pokemon) ? [] : (chips.tags?.get() || [])),
      objectAnimated: object ? !!$('#pkgObjectAnimated')?.checked : false,
      pokemonId: pokemon ? (Number($('#pkgNationalId')?.value) || null) : null,
      speciesName: pokemon ? ($('#pkgSpeciesName')?.value || '').trim() : '',
      forms: pokemon ? forms : [],
      selectedFormId: pokemon ? ($('#pkgFormId')?.value || 'default') : 'default',
      originGame: pokemon ? ($('#pkgOriginGame')?.value || '').trim() : (m.originGame || ''),
      pokedexEntry: pokemon ? ($('#pkgPokedex')?.value || '').trim() : '',
      pokemonTypes: pokemon ? parseList($('#pkgPokemonTypes')?.value) : [],
      pokeapi: pokemon ? (m.pokeapi || null) : null,
    },
    dialogue: (player || pokemon || object)
      ? { ...(p.dialogue || {}), lines: [] }
      : { ...(p.dialogue || {}), lines: parseLines($('#pkgLines')?.value) },
  };
}

async function applyPokemonLookup(data) {
  if (!data) return;
  if ($('#pkgName')) $('#pkgName').value = data.displayName || data.speciesName || '';
  if ($('#pkgInternal')) $('#pkgInternal').value = data.internalName || data.id || '';
  if ($('#pkgNationalId')) $('#pkgNationalId').value = data.pokemonId ?? '';
  if ($('#pkgSpeciesName')) $('#pkgSpeciesName').value = data.speciesName || '';
  if ($('#pkgOriginGame')) $('#pkgOriginGame').value = data.originGame || '';
  if ($('#pkgPokedex')) $('#pkgPokedex').value = data.pokedexEntry || '';
  if ($('#pkgPokemonTypes')) $('#pkgPokemonTypes').value = (data.types || []).join(', ');
  if ($('#pkgForms')) {
    $('#pkgForms').value = (data.forms || []).map((f) => f.name || f.id).filter(Boolean).join(', ');
  }
  if ($('#pkgFormId') && data.forms?.length) {
    const opts = data.forms.map((f) => `<option value="${esc(f.id)}">${esc(f.name || f.id)}</option>`).join('');
    $('#pkgFormId').innerHTML = opts;
    $('#pkgFormId').value = data.selectedFormId || data.forms[0].id;
  }
  if ($('#pkgType')) $('#pkgType').value = 'pokemon';
  updatePkgFieldVisibility();
  const cur = pkg()?.metadata || {};
  await saveDraft({
    id: data.id || pkg()?.id,
    displayName: data.displayName || data.speciesName,
    internalName: data.internalName || data.id,
    metadata: {
      ...cur,
      characterType: 'pokemon',
      pokemonId: data.pokemonId ?? cur.pokemonId,
      speciesName: data.speciesName || '',
      forms: data.forms || cur.forms || [],
      selectedFormId: data.selectedFormId || cur.selectedFormId || 'default',
      originGame: data.originGame || '',
      pokedexEntry: data.pokedexEntry || '',
      pokemonTypes: data.types || [],
      pokeapi: data.pokeapi || null,
    },
  });
}

async function changePackageDirectory() {
  const cur = pkgState.settings?.packageDirectory || '';
  const next = window.prompt('Folder for .charbin library (absolute path):', cur);
  if (!next || next.trim() === cur) return;
  setSave('saving');
  try {
    const res = await api('/api/packages/settings/directory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ packageDirectory: next.trim() }),
    });
    pkgState.settings.packageDirectory = res.packageDirectory;
    pkgInvalidateListSnapshot();
    await loadPackageContext();
    renderPackages();
    toast('Library folder updated');
  } catch (err) {
    toast(String(err.message || err));
  } finally {
    setSave('ready');
  }
}

async function resetPackageDirectory() {
  setSave('saving');
  try {
    const res = await api('/api/packages/settings/reset-directory', { method: 'POST' });
    pkgState.settings.packageDirectory = res.packageDirectory;
    pkgInvalidateListSnapshot();
    await loadPackageContext();
    renderPackages();
    toast('Library folder reset to default');
  } catch (err) {
    toast(String(err.message || err));
  } finally {
    setSave('ready');
  }
}

async function fetchPokemonData() {
  const name = ($('#pkgName')?.value || '').trim();
  if (!name) {
    toast('Enter a Pokémon name first');
    return;
  }
  setSave('saving');
  try {
    const res = await api(`/api/packages/pokemon/lookup?q=${encodeURIComponent(name)}`);
    if (!res.found) {
      if (res.suggestion) {
        const pretty = res.suggestion.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
        if (confirm(`"${name}" was not found.\n\nDid you mean ${pretty}?`)) {
          $('#pkgName').value = pretty;
          $('#pkgInternal').value = res.suggestion;
          await fetchPokemonData();
          return;
        }
      }
      toast('Pokémon not found in PokéAPI');
      return;
    }
    await applyPokemonLookup(res.data);
    toast('PokéAPI data saved to package (stats, abilities, evolution — no images)');
    if (pkgState.panel === 'detail') renderPackages();
  } catch (err) {
    toast(String(err.message || err));
  } finally {
    setSave('ready');
  }
}

async function saveCharacter() {
  if (!pkg()) return;
  await saveDraft(collectDetailForm());
  const r = await api('/api/packages/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
  pkgState.selectedPath = r.path;
  const lib = await api('/api/packages/library');
  pkgState.settings.scannedPackages = lib.packages;
  title(pkg()?.displayName || pkg()?.id || 'Character');
  toast('Saved');
}

async function deleteCharbinById(packageId, displayName, opts = {}) {
  if (opts.confirm !== false && !confirm(`Delete character "${displayName || 'character'}"?\n\nRemoves the .charbin file from disk.`)) return;
  await api(`/api/packages/delete/${encodeURIComponent(packageId)}`, { method: 'POST' });
  const entry = (pkgState.settings?.scannedPackages || []).find((x) => x.id === packageId);
  if (entry && pkgState.selectedPath === entry.path) {
    pkgState.selectedPath = null;
    pkgState.panel = 'list';
  }
  pkgInvalidateListSnapshot();
  await loadPackageContext();
  toast('Character deleted');
}

async function bulkDeleteCharbins(paths) {
  if (!paths.length) return;
  if (!confirm(`Delete ${paths.length} character file${paths.length === 1 ? '' : 's'}?`)) return;
  const list = pkgState.settings?.scannedPackages || [];
  for (const path of paths) {
    const entry = list.find((x) => x.path === path);
    if (entry?.id) await deleteCharbinById(entry.id, entry.displayName, { confirm: false });
  }
  pkgState.selectedPath = null;
  pkgState.panel = 'list';
  clearSelection('charbins');
  pkgInvalidateListSnapshot();
  await loadPackageContext();
  toast(`Deleted ${paths.length} character${paths.length === 1 ? '' : 's'}`);
}

function charbinThumbUrl(entry) {
  const id = entry?.id;
  if (!id || entry.error || entry.hasThumb === false) return '';
  if (entry.hasThumb !== true && !(entry.sheetCount > 0)) return '';
  return `/api/packages/library-thumb/${encodeURIComponent(id)}`;
}

function charbinCard(entry, opts = {}) {
  const name = entry.displayName || entry.id || entry.fileName || 'character';
  const del = cardDeleteBtn(`Delete character ${name}`, 'data-del-charbin-id', entry.id || '');
  const sel = opts.selectScope ? selectCheckbox(opts.selectScope, entry.path) : '';
  const cls = `character card selectable-card${opts.selected ? ' selected' : ''}`;
  const sheets = entry.sheetCount ?? 0;
  const thumbSrc = opts.compact ? '' : charbinThumbUrl(entry);
  const thumbInner = entry.error
    ? '<span class="tag bad">broken</span>'
    : (thumbSrc ? img(thumbSrc, { loading: 'lazy', decoding: 'async' }) : '');
  return `<div class="${cls}" data-path="${esc(entry.path)}">${del}${sel}
    <div class="thumb">${thumbInner}</div>
    <div><h3>${esc(name)}</h3>
    <div class="tiny">${sheets} sheet${sheets === 1 ? '' : 's'}</div>
    <div class="tags">${libraryTypeTag(entry)}<span class="tag">.charbin</span></div>
  </div></div>`;
}

function charbinPokemonCard(entry, opts = {}) {
  const name = entry.displayName || entry.id || entry.fileName || 'character';
  const del = cardDeleteBtn(`Delete character ${name}`, 'data-del-charbin-id', entry.id || '');
  const sel = opts.selectScope ? selectCheckbox(opts.selectScope, entry.path) : '';
  const showSprites = !!opts.showSprites;
  const cls = `character card selectable-card pkg-lib-poke-card${showSprites ? ' pkg-lib-poke-card--sprites' : ''}${opts.selected ? ' selected' : ''}`;
  const dex = pokemonDexNumber(entry);
  const dexLabel = dex != null ? `#${String(dex).padStart(3, '0')}` : '—';
  const sheets = entry.sheetCount ?? 0;
  const sheetLine = sheets <= 1 ? 'base only' : `${sheets} sheets`;
  const err = entry.error ? '<span class="tag bad">broken</span>' : '';
  let thumbBlock = '';
  if (showSprites) {
    const thumbSrc = charbinThumbUrl(entry);
    const thumbInner = entry.error
      ? '<span class="tag bad">broken</span>'
      : (thumbSrc ? img(thumbSrc, { loading: 'lazy', decoding: 'async' }) : '');
    thumbBlock = `<div class="thumb pkg-lib-poke-thumb">${thumbInner}</div>`;
  }
  return `<div class="${cls}" data-path="${esc(entry.path)}">${del}${sel}${thumbBlock}
    <div class="pkg-lib-poke-dex">${esc(dexLabel)}</div>
    <div class="pkg-lib-poke-main"><h3>${esc(name)}</h3>
    <div class="tiny">${esc(sheetLine)}</div>${err}</div>
  </div>`;
}

function buildPokemonGenGrid(entries, sel, showSprites) {
  const scope = sel ? 'charbins' : null;
  const show = showSprites ?? pokemonLibraryShowSprites();
  const gridCls = `grid cols3 pkg-lib-poke-grid${show ? ' pkg-lib-poke-sprites' : ''}`;
  return `<div class="${gridCls}">${entries.map((e) =>
    charbinPokemonCard(e, { selectScope: scope, selected: isSelected('charbins', e.path), showSprites: show }),
  ).join('')}</div>`;
}

function refreshVisiblePokemonGrids(list, rerender) {
  const root = $('.pkg-lib-pokemon');
  if (!root) return;
  const show = pokemonLibraryShowSprites();
  const filtered = applyPkgLibFilters(list);
  const pokemon = partitionLibrary(filtered).pokemon;
  const flatHost = $('.pkg-lib-pokemon-flat', root);
  if (flatHost) {
    flatHost.innerHTML = buildPokemonGenGrid(pokemon, isSelectMode('charbins'), show);
    bindCharbinLibraryCards(flatHost, list, rerender);
    return;
  }
  const groups = groupPokemonByGeneration(pokemon);
  $$('.pkg-lib-gen[data-gen]', root).forEach((details) => {
    const host = $('.pkg-lib-gen-body', details);
    if (!host?.dataset.rendered) return;
    const gen = Number(details.dataset.gen);
    const g = groups.find((x) => x.gen === gen);
    if (!g?.entries?.length) return;
    host.innerHTML = buildPokemonGenGrid(g.entries, isSelectMode('charbins'), show);
    bindCharbinLibraryCards(host, list, rerender);
  });
}

function bindCharbinLibraryCards(root, list, rerender) {
  const scope = root || document;
  $$(`.character[data-path]`, scope).forEach((el) => {
    bindCardOpen(el, () => openCharacter(el.dataset.path), 'charbins', el.dataset.path, rerender);
  });
  $$('[data-del-charbin-id]', scope).forEach((b) => {
    b.onclick = async (e) => {
      e.stopPropagation();
      const entry = list.find((x) => x.id === b.dataset.delCharbinId);
      if (!entry?.id) return;
      await deleteCharbinById(entry.id, entry.displayName);
      rerender();
    };
  });
}

function bindPokemonLibraryLazy(list, rerender) {
  const root = $('.pkg-lib-pokemon');
  if (!root || $('.pkg-lib-pokemon-flat', root)) return;
  const pokemon = partitionLibrary(applyPkgLibFilters(list)).pokemon;
  const groups = groupPokemonByGeneration(pokemon);
  $$('.pkg-lib-gen[data-gen]', root).forEach((details) => {
    if (details.dataset.lazyBound) return;
    details.dataset.lazyBound = '1';
    details.addEventListener('toggle', () => {
      if (!details.open) return;
      const host = $('.pkg-lib-gen-body', details);
      if (!host || host.dataset.rendered) return;
      const gen = Number(details.dataset.gen);
      const g = groups.find((x) => x.gen === gen);
      if (!g?.entries?.length) return;
      host.innerHTML = buildPokemonGenGrid(g.entries, isSelectMode('charbins'), pokemonLibraryShowSprites());
      host.dataset.rendered = '1';
      bindCharbinLibraryCards(host, list, rerender);
    });
  });
}

function bindPokemonSpriteToggle(list, rerender) {
  const input = $('#pkgPokemonShowSprites');
  if (!input) return;
  input.checked = pokemonLibraryShowSprites();
  input.onchange = () => {
    setPokemonLibraryShowSprites(input.checked);
    refreshVisiblePokemonGrids(list, rerender);
  };
}

function renderLibrarySection(title, entries, sel) {
  if (!entries.length) return '';
  const grid = `<div class="grid cols3">${entries.map((e) => charbinCard(e, { selectScope: sel ? 'charbins' : null, selected: isSelected('charbins', e.path) })).join('')}</div>`;
  return `<div class="section-title">${esc(title)}</div>${grid}`;
}

/** National dex generation ranges (inclusive). */
const POKEMON_GEN_RANGES = [
  { gen: 1, label: 'Generation I', min: 1, max: 151 },
  { gen: 2, label: 'Generation II', min: 152, max: 251 },
  { gen: 3, label: 'Generation III', min: 252, max: 386 },
  { gen: 4, label: 'Generation IV', min: 387, max: 493 },
  { gen: 5, label: 'Generation V', min: 494, max: 649 },
  { gen: 6, label: 'Generation VI', min: 650, max: 721 },
  { gen: 7, label: 'Generation VII', min: 722, max: 809 },
  { gen: 8, label: 'Generation VIII', min: 810, max: 905 },
  { gen: 9, label: 'Generation IX', min: 906, max: 99999 },
];

function pokemonDexNumber(entry) {
  const d = Number(entry?.pokemonId);
  return Number.isFinite(d) && d > 0 ? d : null;
}

function pokemonGenerationGroup(dex) {
  if (dex == null) return { gen: 0, label: 'No dex number' };
  for (const row of POKEMON_GEN_RANGES) {
    if (dex >= row.min && dex <= row.max) return row;
  }
  return { gen: 9, label: 'Generation IX' };
}

function groupPokemonByGeneration(entries) {
  const buckets = new Map();
  const unknown = [];
  for (const e of entries) {
    const dex = pokemonDexNumber(e);
    if (dex == null) {
      unknown.push(e);
      continue;
    }
    const g = pokemonGenerationGroup(dex);
    if (!buckets.has(g.gen)) buckets.set(g.gen, { ...g, entries: [] });
    buckets.get(g.gen).entries.push(e);
  }
  const out = [];
  if (unknown.length) out.push({ gen: 0, label: 'No dex number', entries: unknown });
  for (const row of POKEMON_GEN_RANGES) {
    const hit = buckets.get(row.gen);
    if (hit?.entries?.length) out.push(hit);
  }
  return out;
}

function renderPokemonLibrarySection(entries, sel) {
  if (!entries.length) return '';
  const flat = pkgLibPokemonFlatMode();
  const spritesOn = pokemonLibraryShowSprites();
  const spriteToggle = `<label class="check pkg-lib-poke-sprite-toggle" title="Loads preview sprites for visible rows">
    <input type="checkbox" id="pkgPokemonShowSprites"${spritesOn ? ' checked' : ''}>
    Show sprites
  </label>`;
  let inner;
  if (flat) {
    inner = `<div class="pkg-lib-pokemon-toolbar">${spriteToggle}</div>
      <div class="pkg-lib-pokemon-flat">${buildPokemonGenGrid(entries, sel, spritesOn)}</div>`;
  } else {
    const groups = groupPokemonByGeneration(entries);
    const genHtml = groups.map((g, idx) => {
      const rule = idx > 0 ? '<div class="pkg-lib-gen-rule" role="separator"></div>' : '';
      return `${rule}<details class="pkg-lib-gen" data-gen="${g.gen}">
        <summary class="pkg-lib-gen-summary"><span>${esc(g.label)}</span><span class="pkg-lib-gen-count">${g.entries.length}</span></summary>
        <div class="pkg-lib-gen-body" data-lazy-gen="1"></div>
      </details>`;
    }).join('');
    inner = `<div class="pkg-lib-pokemon-toolbar">
        ${spriteToggle}
        <button type="button" class="btn small pkg-lib-collapse-all-gens">Collapse all</button>
      </div>
      ${genHtml}`;
  }
  const flatHint = flat ? ' <span class="tag">filtered view</span>' : '';
  return `<details class="pkg-lib-collapse pkg-lib-pokemon" open>
    <summary class="pkg-lib-collapse-summary"><span class="section-title inline">Pokémon</span><span class="pkg-lib-gen-count">${entries.length}</span>${flatHint}</summary>
    <div class="pkg-lib-pokemon-body">${inner}</div>
  </details>`;
}

function collapseAllPokemonGens(root) {
  const scope = root || $('.pkg-lib-pokemon');
  if (!scope) return;
  $$('.pkg-lib-gen[data-gen]', scope).forEach((d) => { d.open = false; });
}

function bindPokemonLibraryCollapse() {
  const root = $('.pkg-lib-pokemon');
  if (!root) return;
  root.ontoggle = () => {
    if (!root.open) collapseAllPokemonGens(root);
  };
  const btn = $('.pkg-lib-collapse-all-gens', root);
  if (btn) btn.onclick = (e) => { e.preventDefault(); collapseAllPokemonGens(root); };
}

function openPkgBatchImportModal() {
  const types = [
    ['pokemon', 'Pokémon — filename → PokéAPI (e.g. psyduck.png)'],
    ['object', 'Objects — filename → item API (e.g. master_ball.png)'],
    ['npc', 'NPCs — filename → display name only'],
    ['player', 'Playable — filename → display name only'],
  ];
  const html = `<div class="modal card big">${modalHead('Batch import .charbin')}
    <div class="modal-section">
      <p class="tiny">Import <b>one type per batch</b>. One <code>.charbin</code> per species. Forms stay on that file: <code>GARCHOMP_female</code>, <code>ARCEUS_1</code>, <code>ALCREMIE_42</code>. Animation layers combine: <code>shiny</code>, <code>swim</code>, <code>eating</code> (filename and/or field).</p>
      <div class="field"><label>Package type</label>
        <select class="select" id="pkgBatchType">${types.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}</select>
      </div>
      <div id="pkgBatchPokemonOpts" class="pkg-batch-pokemon-opts" hidden>
        <div class="grid cols2">
          <div class="field"><label>Animation (optional)</label>
            <input class="input" id="pkgBatchVariant" placeholder="shiny · swim · shiny swim eating">
          </div>
          <div class="field"><label>Import mode</label>
            <select class="select" id="pkgBatchMode">
              <option value="create">Create / replace base</option>
              <option value="add">Add to existing (base walk only)</option>
            </select>
          </div>
        </div>
        <p class="tiny">Forms and animation layers merge into the same species file (e.g. 64 Alcremie decorations × shiny × swim). Only plain <code>SPECIES.png</code> + Create replaces the whole package. <code>ALCREMIE_12_shiny_swim.png</code> or <code>ALCREMIE_12</code> + Animation <code>shiny swim</code> both work.</p>
      </div>
      <label class="dropzone">Sprite files<input id="pkgBatchFiles" type="file" accept="image/png,image/webp" multiple hidden></label>
      <div id="pkgBatchFileList" class="tiny">No files selected.</div>
      <div class="progress spaced"><div class="bar" id="pkgBatchBar"></div></div>
      <pre class="terminal compact" id="pkgBatchLog">Ready.</pre>
    </div>
    ${modalFoot('<button type="button" class="btn" id="pkgBatchClose">Close</button>', '<button type="button" class="btn primary" id="pkgRunBatch">Import</button>')}</div>`;
  const m = mountModal(html, { backdropClose: true });
  const logEl = $('#pkgBatchLog', m.root);
  const barEl = $('#pkgBatchBar', m.root);
  const pokeOpts = $('#pkgBatchPokemonOpts', m.root);
  const syncBatchTypeUi = () => {
    const isPokemon = $('#pkgBatchType', m.root).value === 'pokemon';
    pokeOpts.hidden = !isPokemon;
  };
  $('#pkgBatchType', m.root).onchange = syncBatchTypeUi;
  syncBatchTypeUi();
  $('#pkgBatchClose', m.root).onclick = () => m.close();
  let files = [];
  const appendLog = (line) => { logEl.textContent += line; logEl.scrollTop = logEl.scrollHeight; };
  const setProgress = (pct, status) => {
    barEl.style.width = `${Math.min(100, Math.max(0, pct))}%`;
    if (status) appendLog(`${status}\n`);
  };
  $('#pkgBatchFiles', m.root).onchange = (e) => {
    files = [...(e.target.files || [])];
    $('#pkgBatchFileList', m.root).textContent = files.length
      ? `${files.length} file${files.length === 1 ? '' : 's'}: ${files.slice(0, 8).map((f) => f.name).join(', ')}${files.length > 8 ? '…' : ''}`
      : 'No files selected.';
  };
  $('#pkgRunBatch', m.root).onclick = async () => {
    if (!files.length) {
      toast('Choose sprite files first');
      return;
    }
    const characterType = $('#pkgBatchType', m.root).value;
    const animationVariant = characterType === 'pokemon' ? ($('#pkgBatchVariant', m.root).value || '').trim() : '';
    const importMode = characterType === 'pokemon' ? $('#pkgBatchMode', m.root).value : 'create';
    const runBtn = $('#pkgRunBatch', m.root);
    runBtn.disabled = true;
    logEl.textContent = '';
    setProgress(0, `Starting batch: ${files.length} file(s), type=${characterType}${animationVariant ? `, animation=${animationVariant}` : ''}`);
    setSave('saving');
    let imported = 0;
    let failed = 0;
    const failedFiles = [];
    try {
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const pctBase = (i / files.length) * 100;
        setProgress(pctBase + 2, `[${i + 1}/${files.length}] Uploading ${f.name}…`);
        const fd = new FormData();
        fd.append('files', f);
        fd.append('characterType', characterType);
        if (characterType === 'pokemon') {
          fd.append('animationVariant', animationVariant);
          fd.append('importMode', importMode);
        }
        const out = await fetch('/api/packages/batch/import-sprites', { method: 'POST', body: fd });
        const text = await out.text();
        if (!out.ok) {
          failed += 1;
          failedFiles.push({ name: f.name, error: text || out.statusText });
          appendLog(`✗ ${f.name}: ${text || out.statusText}\n`);
          setProgress(((i + 1) / files.length) * 100, `[${i + 1}/${files.length}] Failed ${f.name}`);
          continue;
        }
        const res = JSON.parse(text);
        const r = (res.results || [])[0];
        const err = (res.errors || [])[0];
        if (err) {
          failed += 1;
          failedFiles.push({ name: f.name, error: err.error });
          appendLog(`✗ ${f.name}: ${err.error}\n`);
        } else if (r) {
          imported += 1;
          const form = r.form ? ` form ${r.form}` : '';
          const mods = (r.modifiers || []).length ? ` [${r.modifiers.join('+')}]` : (r.sheetSuffix && !r.form ? ` [${r.sheetSuffix}]` : '');
          const merged = r.merged ? ' (merged)' : '';
          const api = r.pokeapi?.found === false || r.itemApi?.found === false
            ? ' (no API match)'
            : (r.pokeapi?.corrected ? ` (dex: ${r.pokeapiSlug || r.pokeapi?.suggestion})` : '');
          const size = r.pokemonSize ? ` · ${r.pokemonSize}` : '';
          appendLog(`✓ ${f.name} → ${r.id}${form}${mods}${size}${merged}${api}\n`);
        }
        setProgress(((i + 1) / files.length) * 100, `[${i + 1}/${files.length}] Done ${f.name}`);
      }
      setProgress(100, `Finished: ${imported} saved, ${failed} failed`);
      if (failedFiles.length) {
        appendLog(`\n── Failed files (${failedFiles.length}) ──\n`);
        failedFiles.forEach(({ name, error }) => {
          const msg = (error || 'unknown error').split('\n')[0].slice(0, 200);
          appendLog(`  ✗ ${name}${msg ? ` — ${msg}` : ''}\n`);
        });
      }
      pkgInvalidateListSnapshot();
      await loadPackageContext();
      const failList = failedFiles.map((x) => x.name).join(', ');
      toast(
        failed
          ? `Batch import: ${imported} saved, ${failed} failed${failList ? ` (${failList})` : ''}`
          : `Batch import: ${imported} saved`,
      );
      if (failed === 0) m.close();
      renderPackages();
    } catch (err) {
      appendLog(`\nError: ${err.message || err}\n`);
      toast(String(err.message || err));
    } finally {
      runBtn.disabled = false;
      setSave('ready');
    }
  };
}

function renderCharList() {
  initSelectState();
  pkgState.panel = 'list';
  stopPkgAnims();
  title('Characters');
  const fullList = pkgState.settings?.scannedPackages || [];
  const list = applyPkgLibFilters(fullList);
  const { playable, characters, pokemon, objects } = partitionLibrary(list);
  const sel = isSelectMode('charbins');
  toolbar(`<button class="btn good" id="pkgQuickAnim" data-open-quick-anim>Quick anim</button><button class="btn" id="pkgBodyMarkers" data-open-body-markers>Body markers</button><span class="tag">batch .charbin</span><button class="btn primary" id="pkgNewPlayer">＋ Player</button><button class="btn" id="pkgNewNpc">＋ NPC</button><button class="btn" id="pkgNewPokemon">＋ Pokémon</button><button class="btn" id="pkgNewObject">＋ Object</button><button class="btn" id="pkgBatchImport">Batch import…</button><label class="btn">Import .charbin<input id="pkgImport" type="file" accept=".charbin" hidden></label>`);
  const filterBar = renderPkgLibSearchBar(fullList, list);
  const sections = [
    renderLibrarySection('Playable', playable, sel),
    renderLibrarySection('Characters', characters, sel),
    renderPokemonLibrarySection(pokemon, sel),
    renderLibrarySection('Objects', objects, sel),
  ].filter(Boolean).join('');
  const body = sections || (fullList.length
    ? '<div class="empty"><strong>No matches.</strong><br/>Try clearing filters or broadening your search.</div>'
    : '<div class="empty"><strong>No packages yet.</strong><br/>Create a package or import a .charbin file.</div>');
  $('#view').innerHTML = `${filterBar}${bulkBar('charbins')}${sectionHead('Library', 'charbins')}${body}`;
  right(`<div class="sidecard card"><h3>Quick anim</h3><p>Paint <b>sleep</b> (or any id) on every Pokémon missing it — save &amp; next through the dex.</p>
    <button type="button" class="btn good full" data-open-quick-anim>Open Quick anim</button></div>
    <div class="sidecard card"><h3>Body markers</h3><p>Head, eye, and hand boxes per facing on the base walk sheet — for accessories and auto sleep.</p>
    <button type="button" class="btn full" data-open-body-markers>Open body markers</button></div>
    <div class="sidecard card pkg-library-settings"><h3>Library</h3><p>Saved under <code>playable/</code>, <code>npc/</code>, <code>pokemon/</code>, <code>objects/</code>.</p>
    <p class="tiny pkg-lib-path">${esc(pkgState.settings?.packageDirectory || '')}</p>
    <div class="btn-row" style="margin-top:8px">
      <button type="button" class="btn small" id="pkgChangeDir">Change folder…</button>
      <button type="button" class="btn small" id="pkgResetDir">Reset default</button>
    </div>
    <p class="tiny">Schema: <code>CHARBIN_SCHEMA.md</code> is copied into the library folder for C++.</p></div>`);
  bindCharListHandlers(fullList, list);
}

function bindCharListHandlers(fullList, filteredList) {
  const list = filteredList || applyPkgLibFilters(fullList || pkgState.settings?.scannedPackages || []);
  const all = fullList || pkgState.settings?.scannedPackages || [];
  bindPkgLibSearchBar(all);
  $('#pkgChangeDir').onclick = () => changePackageDirectory();
  $('#pkgResetDir').onclick = () => resetPackageDirectory();
  $('#pkgNewPlayer').onclick = () => createPackageQuick('player');
  $('#pkgNewNpc').onclick = () => createPackageQuick('npc');
  $('#pkgNewPokemon').onclick = () => createPackageQuick('pokemon');
  $('#pkgNewObject').onclick = () => createPackageQuick('object');
  $('#pkgBatchImport').onclick = openPkgBatchImportModal;
  if (typeof bindQuickAnimEntrypoints === 'function') bindQuickAnimEntrypoints($('#view'));
  const importInput = $('#pkgImport');
  if (importInput) {
    importInput.onchange = async (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      const fd = new FormData();
      fd.append('file', f);
      pkgLeaveListPanel();
      const res = await api('/api/packages/draft/import', { method: 'POST', body: fd });
      pkgState.selectedPath = res.path;
      pkgState.panel = 'detail';
      await loadPackageContext();
      renderPackages();
      e.target.value = '';
    };
  }
  bindSelectMode('charbins', renderPackages, bulkDeleteCharbins);
  bindCharbinLibraryCards($('#view'), all, renderPackages);
  bindPokemonLibraryLazy(all, renderPackages);
  bindPokemonLibraryCollapse();
  bindPokemonSpriteToggle(all, renderPackages);
}

async function createPackageQuick(characterType) {
  const defaults = { player: 'Player', npc: 'CustomHero', pokemon: 'Garchomp', object: 'Sign' };
  const name = prompt('Name', defaults[characterType] || 'Character');
  if (!name) return;
  const id = slugFromName(name);
  const baseProfile = characterType === 'pokemon'
    ? 'pokemon_small'
    : (characterType === 'object' ? 'object' : 'character');
  await api('/api/packages/draft/new', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, displayName: name, characterType, baseProfile }),
  });
  const meta = {
    partnerPokemon: null,
    characterType,
    personality: [],
    likes: [],
    tags: [],
    speciesName: characterType === 'pokemon' ? name : '',
    forms: [],
    selectedFormId: 'default',
    pokedexEntry: '',
    pokemonTypes: [],
    pokemonId: null,
  };
  await saveDraft({
    id,
    displayName: name,
    internalName: id,
    baseProfile,
    metadata: meta,
    actions: [],
    spriteSheets: [],
  });
  await api('/api/packages/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
  await loadPackageContext();
  toast('Package created');
  if (characterType === 'pokemon') {
    pkgLeaveListPanel();
    pkgState.selectedPath = (pkgState.settings?.scannedPackages || []).find((x) => x.id === id)?.path || null;
    pkgState.panel = 'detail';
    renderPackages();
    try { await fetchPokemonData(); } catch (_) { /* optional autofill */ }
  } else if (characterType === 'object') {
    pkgLeaveListPanel();
    pkgState.selectedPath = (pkgState.settings?.scannedPackages || []).find((x) => x.id === id)?.path || null;
    pkgState.panel = 'detail';
    renderPackages();
  } else {
    pkgInvalidateListSnapshot();
    pkgState.panel = 'list';
    renderPackages();
  }
}

async function openCharacter(path) {
  pkgLeaveListPanel();
  await api('/api/packages/draft/open-path', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  });
  pkgState.selectedPath = path;
  pkgState.panel = 'detail';
  await loadPackageContext();
  const p = pkg();
  pkgState.selectedSheetId = isPokemonCharType(p?.metadata?.characterType)
    ? defaultPokemonWalkSheetId(p)
    : (p?.spriteSheets?.[0]?.id || null);
  renderPackages();
}

function pkgSheetTile(sheet) {
  const active = sheet.id === pkgState.selectedSheetId ? ' primary' : '';
  const cell = pkgEffectiveCellSize(sheet);
  const thumb = sheet.assetId
    ? `<div class="thumb wide" style="margin-bottom:8px"><img src="${sheetAssetUrl(sheet)}?t=${Date.now()}"/></div>`
    : '<div class="thumb wide" style="margin-bottom:8px"><span class="tiny">no png</span></div>';
  return `<div class="card sidecard sheet-tile pkg-sheet-tile selectable-card${active}" data-sheet="${esc(sheet.id)}" role="button" tabindex="0" title="Open sheet inspector">
    ${thumb}<h3 class="truncate">${esc(sheet.name || sheet.id)}</h3>
    <p>${esc(profileLabel(sheet.profile || pkg()?.baseProfile || 'character'))}</p>
    <p class="tiny">${cell}×${cell}px cells · click to inspect</p>
  </div>`;
}

function drawPkgSheetGridCanvas(canvas, img, prof) {
  if (!canvas || !img?.width) return;
  const cols = Number(prof.columns) || 4;
  const rows = Number(prof.rows) || 4;
  const fw = Number(prof.frameWidth) || 32;
  const fh = Number(prof.frameHeight) || 32;
  const cssW = Math.min(320, Math.max(160, img.width));
  const sc = cssW / img.width;
  const cssH = Math.ceil(img.height * sc);
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.ceil(cssW * dpr);
  canvas.height = Math.ceil(cssH * dpr);
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, cssW, cssH);
  ctx.drawImage(img, 0, 0, cssW, cssH);
  ctx.strokeStyle = 'rgba(125,211,252,.85)';
  ctx.lineWidth = 1;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      ctx.strokeRect(c * fw * sc + 0.5, r * fh * sc + 0.5, fw * sc - 1, fh * sc - 1);
    }
  }
}

function openPkgSheetModal(sheetId) {
  const p = pkg();
  const sheet = (p?.spriteSheets || []).find((s) => s.id === sheetId);
  if (!sheet) return;
  pkgState.selectedSheetId = sheetId;

  const baseProf = profileDef(sheet.profile || p.baseProfile);
  const merged = pkgMergedProf(sheet);
  const defaultCell = pkgDefaultCellSize(sheet);
  const cellSize = pkgEffectiveCellSize(sheet);
  const hasOverride = Boolean(sheet.profileOverrides?.frameWidth);

  const html = `<div class="modal card pkg-sheet-modal">
    ${modalHead(`Sheet · ${esc(sheet.name || sheet.id)}`)}
    <p class="tiny">Embedded PNG and how it is sliced for animations. Cell size applies to this sheet only.</p>
    <div class="pkg-sheet-modal-previews">
      <div class="pkg-sheet-modal-pane">
        <div class="section-title inline">Raw sheet</div>
        <div class="pkg-sheet-modal-img-wrap checker">
          <img id="pkgSheetModalRaw" alt="" class="pkg-sheet-modal-img"/>
        </div>
        <p class="tiny" id="pkgSheetModalDims">—</p>
      </div>
      <div class="pkg-sheet-modal-pane">
        <div class="section-title inline">Grid</div>
        <canvas id="pkgSheetModalGrid" class="pkg-sheet-modal-grid checker"></canvas>
        <p class="tiny" id="pkgSheetModalGridHint">${merged.columns}×${merged.rows} · ${cellSize}×${cellSize}px</p>
      </div>
    </div>
    <div class="field pkg-sheet-cell-field">
      <label>Cell size (px)</label>
      <div class="row wrap" style="align-items:center;gap:10px">
        <input class="input" id="pkgSheetModalCell" type="number" min="8" max="256" step="1" value="${cellSize}" style="max-width:6rem">
        <span class="tiny">Square cells — profile default is <b>${defaultCell}px</b>. <span id="pkgSheetDetected"></span></span>
      </div>
      ${hasOverride ? '<label class="check"><input type="checkbox" id="pkgSheetModalResetCell"> Use profile default</label>' : ''}
    </div>
    ${modalFoot('<button type="button" class="btn" id="pkgSheetModalCancel">Cancel</button>', '<button type="button" class="btn primary" id="pkgSheetModalSave">Apply</button>')}
  </div>`;

  const m = mountModal(html, { backdropClose: true, warnDirty: true });
  const rawImg = $('#pkgSheetModalRaw', m.root);
  const gridCan = $('#pkgSheetModalGrid', m.root);
  const cellInput = $('#pkgSheetModalCell', m.root);
  const gridHint = $('#pkgSheetModalGridHint', m.root);
  const dimsEl = $('#pkgSheetModalDims', m.root);
  const detectedEl = $('#pkgSheetDetected', m.root);
  const resetChk = $('#pkgSheetModalResetCell', m.root);

  let loadedImg = null;

  const previewCell = () => {
    if (resetChk?.checked) return defaultCell;
    return Math.max(8, Number(cellInput?.value) || defaultCell);
  };

  const refreshGrid = () => {
    if (!loadedImg) return;
    const cell = previewCell();
    const profPreview = { ...merged, frameWidth: cell, frameHeight: cell };
    drawPkgSheetGridCanvas(gridCan, loadedImg, profPreview);
    if (gridHint) {
      gridHint.textContent = `${profPreview.columns}×${profPreview.rows} grid · ${cell}×${cell}px cells`;
    }
  };

  if (resetChk) {
    resetChk.onchange = () => {
      const on = resetChk.checked;
      if (cellInput) {
        cellInput.disabled = on;
        if (on) cellInput.value = String(defaultCell);
      }
      refreshGrid();
    };
  }
  cellInput?.addEventListener('input', refreshGrid);

  if (!sheet.assetId) {
    if (dimsEl) dimsEl.textContent = 'No PNG embedded on this sheet yet.';
    $('#pkgSheetModalSave', m.root).disabled = true;
  } else {
    const img = new Image();
    img.onload = () => {
      loadedImg = img;
      if (rawImg) {
        rawImg.src = img.src;
        rawImg.style.width = `${Math.min(320, img.width)}px`;
      }
      const cols = merged.columns || 4;
      const detected = Math.round(img.width / cols);
      if (dimsEl) dimsEl.textContent = `${img.width}×${img.height}px`;
      if (detectedEl) {
        detectedEl.textContent = detected !== defaultCell
          ? `Image width ÷ ${cols} columns ≈ ${detected}px.`
          : '';
      }
      refreshGrid();
    };
    img.src = `${sheetAssetUrl(sheet)}?t=${Date.now()}`;
  }

  $('#pkgSheetModalCancel', m.root).onclick = m.tryClose;
  $('#pkgSheetModalSave', m.root).onclick = async () => {
    const useDefault = !!resetChk?.checked;
    const cell = Math.max(8, Math.round(Number(cellInput?.value) || defaultCell));
    const nextSheets = (p.spriteSheets || []).map((s) => {
      if (s.id !== sheetId) return s;
      const overrides = { ...(s.profileOverrides || {}) };
      if (useDefault || cell === defaultCell) {
        delete overrides.frameWidth;
        delete overrides.frameHeight;
      } else {
        overrides.frameWidth = cell;
        overrides.frameHeight = cell;
      }
      const next = { ...s };
      if (Object.keys(overrides).length) next.profileOverrides = overrides;
      else delete next.profileOverrides;
      return next;
    });
    try {
      await saveDraft({ spriteSheets: nextSheets });
      m.close();
      toast('Sheet settings updated');
      renderCharDetail();
    } catch (err) {
      toast(String(err.message || err));
    }
  };
}

function pkgSpriteSlot(label, hasSheet) {
  const thumb = hasSheet
    ? `<canvas class="anim-card-canvas checker pkg-base-canvas" data-base-label="${esc(label)}" width="64" height="64"></canvas>`
    : '<div class="thumb"><span class="tiny">empty</span></div>';
  return `<div class="card sidecard sprite-slot">${thumb}<h3>${esc(label)}</h3><p>${hasSheet ? 'from walk sheet' : 'Missing'}</p></div>`;
}

function pkgActionDisplayName(action) {
  if (!action) return '';
  const id = String(action.id || '');
  const std = id.match(/^(idle|pause|walk|sleep)(?:_|$)/);
  if (std) return std[1];
  if (action.type === 'idle' && !action.movementDriven) {
    const anim = String(action.animationName || '');
    return anim === 'walk' ? 'idle' : (anim || id);
  }
  if (action.type === 'movement' || action.type === 'walk' || action.movementDriven) {
    return String(action.animationName || id || 'walk');
  }
  return String(action.animationName || id);
}

function pkgAnimGroupHeader(action) {
  const name = pkgActionDisplayName(action);
  return `<div class="pkg-anim-group-head">
    <span class="section-title inline">${esc(name)}</span>
    <button type="button" class="pkg-action-info-btn" data-pkg-action-info="${esc(action.id)}" title="Animation metadata" aria-label="Edit animation metadata for ${esc(name)}">i</button>
  </div>`;
}

function pkgSheetAnimNames(sheet) {
  const prof = profileDef(sheet?.profile || pkg()?.baseProfile);
  const keys = new Set([
    ...Object.keys(prof.animations || {}),
    ...Object.keys(sheet?.animations || {}),
  ]);
  return [...keys].sort();
}

function pkgEffectiveAnimSpec(sheet, animName) {
  const prof = profileDef(sheet?.profile || pkg()?.baseProfile);
  const base = prof.animations?.[animName] || {};
  const custom = sheet?.animations?.[animName];
  return custom ? { ...base, ...custom } : { ...base };
}

function pkgSheetHasAnimOverride(sheet, animName) {
  return Boolean(sheet?.animations?.[animName]);
}

function parseFrameList(raw) {
  return String(raw || '')
    .split(/[,;\s]+/)
    .map((x) => x.trim())
    .filter((x) => x !== '')
    .map((x) => Number(x))
    .filter((n) => Number.isInteger(n) && n >= 0);
}

function openPkgActionMetaModal(actionId) {
  const p = pkg();
  if (!p) return;
  const actions = [...(p.actions || [])];
  const idx = actions.findIndex((a) => a.id === actionId);
  if (idx < 0) return;
  const action = { ...actions[idx] };
  const sheets = (p.spriteSheets || []).filter((s) => s.assetId);
  const sheet = sheets.find((s) => s.id === action.sheetId) || sheets[0];
  const animName = action.animationName || action.id;
  const animSpec = sheet ? pkgEffectiveAnimSpec(sheet, animName) : {};
  const hasOverride = sheet ? pkgSheetHasAnimOverride(sheet, animName) : false;
  const defaultFrames = (animSpec.frames || []).join(', ');
  const sheetOpts = sheets.map((s) =>
    `<option value="${esc(s.id)}" ${s.id === action.sheetId ? 'selected' : ''}>${esc(s.name || s.id)}</option>`).join('');
  const animOpts = (sheet ? pkgSheetAnimNames(sheet) : [animName]).map((n) =>
    `<option value="${esc(n)}" ${n === animName ? 'selected' : ''}>${esc(n)}</option>`).join('');
  const isActivity = action.type === 'activity';
  const phasesJson = JSON.stringify(action.phases || {}, null, 2);
  const activityFields = `
    <div class="pkg-action-activity-only" ${isActivity ? '' : 'hidden'}>
      <div class="grid cols2">
        <div class="field"><label>Activity kind</label>
          <select class="select" id="pkgActActivityKind">
            <option value="single" ${action.activityKind === 'single' ? 'selected' : ''}>single (one play phase)</option>
            <option value="session" ${action.activityKind === 'session' ? 'selected' : ''}>session (enter / stay / exit)</option>
          </select>
        </div>
        <div class="field"><label>Facing mode</label>
          <select class="select" id="pkgActFacingMode">
            <option value="four_direction" ${(action.facingMode || 'four_direction') === 'four_direction' ? 'selected' : ''}>four_direction</option>
            <option value="south_only" ${action.facingMode === 'south_only' ? 'selected' : ''}>south_only</option>
          </select>
        </div>
      </div>
      <div class="field"><label>Phases (JSON)</label>
        <textarea class="input pkg-desc-area" id="pkgActPhases" rows="6" spellcheck="false">${esc(phasesJson)}</textarea>
        <p class="tiny">Phase ids map to <code>{ animationName, loop? }</code> on the sheet. See CHARBIN_SCHEMA.md.</p>
      </div>
    </div>`;
  const standardFields = `
    <div class="pkg-action-standard-only" ${isActivity ? 'hidden' : ''}>
      <div class="field"><label>Animation name</label>
        <select class="select" id="pkgActAnimName">${animOpts}</select>
        <p class="tiny">Profile animation key used when playing this action.</p>
      </div>
    </div>`;
  const timingFields = sheet ? `
    <div class="modal-section">
      <h4>Sheet timing${hasOverride ? ' <span class="tag short">override</span>' : ''}</h4>
      <p class="tiny">Per-sheet override for <code>${esc(animName)}</code>. Profile default: frames <b>${esc(defaultFrames || '—')}</b>, ${Number(animSpec.frameTimeMs) || '—'} ms${animSpec.loop === false ? ', no loop' : ''}.</p>
      <div class="grid cols2">
        <div class="field"><label>Frame columns</label>
          <input class="input" id="pkgActFrames" value="${esc(hasOverride ? (animSpec.frames || []).join(', ') : '')}" placeholder="${esc(defaultFrames || '0, 1, 2, 3')}">
        </div>
        <div class="field"><label>Frame time (ms)</label>
          <input class="input" id="pkgActFrameMs" type="number" min="1" value="${hasOverride && animSpec.frameTimeMs != null ? Number(animSpec.frameTimeMs) : ''}" placeholder="${Number(animSpec.frameTimeMs) || 120}">
        </div>
      </div>
      <label class="check"><input type="checkbox" id="pkgActLoop" ${animSpec.loop === false ? '' : 'checked'}> Loop animation</label>
      <label class="check"><input type="checkbox" id="pkgActClearOverride" ${hasOverride ? '' : 'disabled'}> Clear sheet override (use profile defaults)</label>
    </div>` : '';

  const html = `<div class="modal card pkg-action-meta-modal">
    ${modalHead(`Animation · ${esc(action.id)}`)}
    <p class="tiny">Edits the <code>actions[]</code> record saved in this .charbin. Save the character to write to disk.</p>
    <div class="grid cols2">
      <div class="field"><label>Action id</label><input class="input" id="pkgActId" value="${esc(action.id)}"></div>
      <div class="field"><label>Type</label>
        <select class="select" id="pkgActType">
          <option value="idle" ${action.type === 'idle' ? 'selected' : ''}>idle</option>
          <option value="movement" ${action.type === 'movement' ? 'selected' : ''}>movement</option>
          <option value="walk" ${action.type === 'walk' ? 'selected' : ''}>walk (legacy)</option>
          <option value="activity" ${action.type === 'activity' ? 'selected' : ''}>activity</option>
        </select>
      </div>
      <div class="field"><label>Sheet</label>
        <select class="select" id="pkgActSheet">${sheetOpts || '<option value="">—</option>'}</select>
      </div>
      <div class="field pkg-action-move-row" ${isActivity ? 'hidden' : ''}>
        <label class="check" style="margin-top:28px"><input type="checkbox" id="pkgActMovementDriven" ${action.movementDriven ? 'checked' : ''}> Movement driven</label>
      </div>
    </div>
    ${standardFields}
    ${activityFields}
    ${timingFields}
    ${modalFoot('<button type="button" class="btn" id="pkgActCancel">Cancel</button>', '<button type="button" class="btn primary" id="pkgActSave">Apply</button>')}
  </div>`;

  const m = mountModal(html, { backdropClose: true, warnDirty: true });
  const syncTypeUi = () => {
    const t = $('#pkgActType', m.root)?.value;
    const activity = t === 'activity';
    $('.pkg-action-activity-only', m.root)?.toggleAttribute('hidden', !activity);
    $('.pkg-action-standard-only', m.root)?.toggleAttribute('hidden', activity);
    $('.pkg-action-move-row', m.root)?.toggleAttribute('hidden', activity);
    const move = $('#pkgActMovementDriven', m.root);
    if (move && !activity) {
      if (t === 'movement' || t === 'walk') move.checked = true;
      if (t === 'idle') move.checked = false;
    }
  };
  $('#pkgActType', m.root)?.addEventListener('change', syncTypeUi);
  $('#pkgActSheet', m.root)?.addEventListener('change', () => {
    const sid = $('#pkgActSheet', m.root)?.value;
    const sh = sheets.find((s) => s.id === sid);
    const sel = $('#pkgActAnimName', m.root);
    if (!sel || !sh) return;
    const names = pkgSheetAnimNames(sh);
    const cur = sel.value;
    sel.innerHTML = names.map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
    if (names.includes(cur)) sel.value = cur;
    else if (names.length) sel.value = names[0];
  });
  $('#pkgActCancel', m.root).onclick = m.tryClose;
  syncTypeUi();
  $('#pkgActSave', m.root).onclick = async () => {
    const newId = ($('#pkgActId', m.root)?.value || '').trim();
    if (!newId) {
      toast('Action id is required');
      return;
    }
    if (actions.some((a, i) => i !== idx && a.id === newId)) {
      toast(`Another action already uses id "${newId}"`);
      return;
    }
    const actType = $('#pkgActType', m.root)?.value || 'idle';
    const sheetId = $('#pkgActSheet', m.root)?.value || action.sheetId;
    const updated = { ...action, id: newId, type: actType, sheetId };
    if (actType === 'activity') {
      updated.movementDriven = false;
      updated.activityKind = $('#pkgActActivityKind', m.root)?.value || 'single';
      updated.facingMode = $('#pkgActFacingMode', m.root)?.value || 'four_direction';
      try {
        updated.phases = JSON.parse($('#pkgActPhases', m.root)?.value || '{}');
      } catch {
        toast('Phases must be valid JSON');
        return;
      }
      delete updated.animationName;
    } else {
      updated.animationName = ($('#pkgActAnimName', m.root)?.value || action.animationName || newId).trim();
      updated.movementDriven = !!$('#pkgActMovementDriven', m.root)?.checked;
      delete updated.activityKind;
      delete updated.facingMode;
      delete updated.phases;
    }
    const nextActions = actions.map((a, i) => (i === idx ? updated : a));
    let nextSheets = (p.spriteSheets || []).map((s) => ({ ...s, animations: { ...(s.animations || {}) } }));
    if (sheet && actType !== 'activity') {
      const targetAnim = updated.animationName;
      const si = nextSheets.findIndex((s) => s.id === sheetId);
      if (si >= 0) {
        const sh = nextSheets[si];
        const prof = profileDef(sh.profile || p.baseProfile);
        const profDefault = prof.animations?.[targetAnim] || {};
        const clearOverride = !!$('#pkgActClearOverride', m.root)?.checked;
        const framesRaw = ($('#pkgActFrames', m.root)?.value || '').trim();
        const frameMsRaw = ($('#pkgActFrameMs', m.root)?.value || '').trim();
        const loopChecked = !!$('#pkgActLoop', m.root)?.checked;
        const frames = framesRaw ? parseFrameList(framesRaw) : null;
        const frameMs = frameMsRaw ? Math.max(1, Number(frameMsRaw)) : null;
        const anims = { ...(sh.animations || {}) };
        if (clearOverride) {
          delete anims[targetAnim];
        } else if (frames || frameMs != null || loopChecked !== (profDefault.loop !== false)) {
          const spec = { ...(anims[targetAnim] || {}) };
          if (frames?.length) spec.frames = frames;
          else if (!framesRaw && anims[targetAnim]) delete spec.frames;
          if (frameMs != null) spec.frameTimeMs = frameMs;
          else if (!frameMsRaw && anims[targetAnim]) delete spec.frameTimeMs;
          if (loopChecked) delete spec.loop;
          else spec.loop = false;
          anims[targetAnim] = spec;
        }
        sh.animations = Object.keys(anims).length ? anims : undefined;
        if (!sh.animations) delete sh.animations;
        nextSheets[si] = sh;
      }
    }
    try {
      await saveDraft({ actions: nextActions, spriteSheets: nextSheets });
      m.close();
      toast('Animation updated');
      renderCharDetail();
    } catch (err) {
      toast(String(err.message || err));
    }
  };
}

function pkgDirectionAnimCard(action, dirKey, dirTitle) {
  const animKey = action.animationName || action.id;
  const name = pkgActionDisplayName(action);
  return `<div class="card sidecard animation-card pkg-dir-anim" data-pkg-anim="${esc(action.id)}" data-anim-name="${esc(animKey)}" data-dir="${esc(dirKey)}">
    <canvas class="anim-card-canvas checker" width="96" height="96"></canvas>
    <h3 class="truncate">${esc(name)} · ${esc(dirTitle)}</h3>
    <p class="tiny">${esc(dirTitle)} · ${action.movementDriven ? 'movement' : 'idle'}</p>
  </div>`;
}

function isPokemonWalkSheetId(sheetId) {
  const id = sheetId || '';
  return id === 'walk' || id.startsWith('walk_');
}

function isPokemonSleepSheetId(sheetId) {
  const id = sheetId || '';
  return id === 'sleep' || id.startsWith('sleep_');
}

function pokemonSleepSheetIdForWalk(walkSheetId) {
  const suffix = pokemonWalkSheetSuffix(walkSheetId);
  return suffix ? `sleep_${suffix}` : 'sleep';
}

function pokemonWalkSheetSuffix(sheetId) {
  if (!sheetId || sheetId === 'walk') return '';
  return sheetId.startsWith('walk_') ? sheetId.slice(5) : sheetId;
}

function pokemonWalkSheetsFromPackage(p) {
  return (p?.spriteSheets || [])
    .filter((s) => s.assetId && isPokemonWalkSheetId(s.id))
    .sort((a, b) => {
      const sa = pokemonWalkSheetSuffix(a.id);
      const sb = pokemonWalkSheetSuffix(b.id);
      if (!sa && sb) return -1;
      if (sa && !sb) return 1;
      return sa.localeCompare(sb, undefined, { numeric: true });
    });
}

function pokemonSheetVariantLabel(sheetId) {
  if (!sheetId || sheetId === 'walk') return 'Default';
  const suffix = sheetId.startsWith('walk_') ? sheetId.slice(5) : sheetId;
  return suffix.replace(/_/g, ' · ') || 'Default';
}

function ensurePokemonSheetSelection(p) {
  const walkSheets = pokemonWalkSheetsFromPackage(p);
  if (!walkSheets.length) return;
  const ids = walkSheets.map((s) => s.id);
  if (!ids.includes(pkgState.selectedSheetId)) {
    pkgState.selectedSheetId = defaultPokemonWalkSheetId(p);
  }
}

function renderPokemonVariantPicker(walkSheets) {
  if (walkSheets.length <= 1) return '';
  const opts = walkSheets.map((s) => {
    const sel = s.id === pkgState.selectedSheetId ? ' selected' : '';
    return `<option value="${esc(s.id)}"${sel}>${esc(pokemonSheetVariantLabel(s.id))}</option>`;
  }).join('');
  return `<div class="field pkg-sprite-variant-picker" data-pokemon-only>
    <label>Sprite variant</label>
    <select class="select" id="pkgSpriteVariant">${opts}</select>
    <p class="tiny">Preview idle, pause, walk, and sleep for this form (${walkSheets.length} walk variants).</p>
  </div>`;
}

/** When a Pokémon file has multiple walk_* sheets, limit walk/pause preview to the selected variant. */
function filterActionsForPreview(p, actions) {
  if (!isPokemonCharType(p?.metadata?.characterType)) return actions;
  const walkSheets = pokemonWalkSheetsFromPackage(p);
  if (walkSheets.length <= 1) return actions;
  const walkIds = new Set(walkSheets.map((s) => s.id));
  const focusWalk = walkIds.has(pkgState.selectedSheetId)
    ? pkgState.selectedSheetId
    : defaultPokemonWalkSheetId(p);
  const sleepId = pokemonSleepSheetIdForWalk(focusWalk);
  return actions.filter((a) => {
    const sid = a.sheetId || '';
    if (!walkIds.has(sid)) return true;
    return sid === focusWalk || sid === sleepId;
  });
}

function pkgAnimDirectionsForAction(action) {
  const anim = (action?.animationName || '').toLowerCase();
  const aid = (action?.id || '').toLowerCase();
  if (anim === 'sleep' || aid === 'sleep' || aid.startsWith('sleep_')) {
    return [['south', 'Down']];
  }
  return PKG_DIR_DISPLAY;
}

function renderPkgAnimationsHtml(actions) {
  const objectMode = isObjectCharType(pkg()?.metadata?.characterType);
  if (!actions.length) {
    return objectMode
      ? '<div class="empty">Add a sprite sheet to preview play (row-major; preview loops with a short pause between plays).</div>'
      : '<div class="empty">Import a walk sheet, or use <b>Add sheet</b> for more animations or to replace walk.</div>';
  }
  const order = pkgActionOrder(pkg());
  const sorted = [...actions].sort((a, b) => {
    if (!order) {
      const ka = pkgPokemonActionSortKey(a);
      const kb = pkgPokemonActionSortKey(b);
      for (let i = 0; i < 3; i++) {
        if (ka[i] !== kb[i]) return ka[i] < kb[i] ? -1 : 1;
      }
      return 0;
    }
    const ai = order.indexOf(a.id || a.animationName);
    const bi = order.indexOf(b.id || b.animationName);
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
  });
  return sorted.map((action) => {
    const dirs = objectMode ? [['south', 'Sprite']] : pkgAnimDirectionsForAction(action);
    const cols = dirs.length <= 1 ? 'cols2' : (objectMode ? 'cols2' : 'cols4');
    return `<div class="pkg-anim-group">
      ${pkgAnimGroupHeader(action)}
      <div class="grid ${cols}">${dirs.map(([dirKey, title]) => pkgDirectionAnimCard(action, dirKey, title)).join('')}</div>
    </div>`;
  }).join('');
}

function pkgCharInfoPanel(p, m, profNames, hasPartner) {
  const partner = m.partnerPokemon;
  const charType = normalizeCharType(m.characterType || 'npc');
  const player = isPlayerCharType(charType);
  const pokemon = isPokemonCharType(charType);
  const object = isObjectCharType(charType);
  const npcHidden = player || pokemon || object ? ' pkg-field-hidden' : '';
  const pokemonHidden = pokemon ? '' : ' pkg-field-hidden';
  const objectHidden = object ? '' : ' pkg-field-hidden';
  const playerNpcHidden = pokemon || object ? ' pkg-field-hidden' : '';
  const forms = m.forms || [];
  const formOpts = (forms.length ? forms : [{ id: 'default', name: 'Default' }])
    .map((f) => `<option value="${esc(f.id)}" ${f.id === (m.selectedFormId || 'default') ? 'selected' : ''}>${esc(f.name || f.id)}</option>`)
    .join('');
  return `<details class="card sidecard pkg-char-info" id="pkgCharInfo">
    <summary>Character info</summary>
    <div class="pkg-char-info-body">
      <div class="pkg-char-grid">
        <div class="field"><label>Name</label><input class="input" id="pkgName" value="${esc(p.displayName || '')}"></div>
        <div class="field"><label>Sprite template</label><select class="select" id="pkgProfile">${profNames.map((n) =>
    `<option value="${n}" ${n === (p.baseProfile || 'character') ? 'selected' : ''}>${esc(profileLabel(n))}</option>`
  ).join('')}</select></div>
        <div class="field"><label>Type</label><select class="select" id="pkgType">
          ${PKG_CHAR_TYPES.map(([val, label]) =>
    `<option value="${val}" ${val === charType ? 'selected' : ''}>${esc(label)}</option>`).join('')}
        </select></div>
        <div class="field"><label>Internal id</label><input class="input" id="pkgInternal" value="${esc(p.internalName || p.id)}"></div>
      </div>
      <div class="pkg-pokemon-fetch data-pokemon-only${pokemonHidden}" data-pokemon-only>
        <button type="button" class="btn primary" id="pkgFetchPokemon">Fetch from PokéAPI</button>
        <p class="tiny">Uses the name above. Suggests close spellings if not found.</p>
      </div>
      <div class="pkg-char-grid data-pokemon-only${pokemonHidden}" data-pokemon-only>
        <div class="field"><label>National dex #</label><input class="input" id="pkgNationalId" type="number" min="1" value="${esc(m.pokemonId ?? '')}"></div>
        <div class="field"><label>Species name</label><input class="input" id="pkgSpeciesName" value="${esc(m.speciesName || '')}"></div>
        <div class="field"><label>Types</label><input class="input" id="pkgPokemonTypes" value="${esc((m.pokemonTypes || []).join(', '))}" placeholder="dragon, ground"></div>
        <div class="field"><label>Origin / genus</label><input class="input" id="pkgOriginGame" value="${esc(m.originGame || '')}"></div>
      </div>
      <div class="field data-pokemon-only${pokemonHidden}" data-pokemon-only><label>Forms (comma-separated)</label><input class="input" id="pkgForms" value="${esc(forms.map((f) => f.name || f.id).join(', '))}" placeholder="default, mega, alola"></div>
      <div class="field data-pokemon-only${pokemonHidden}" data-pokemon-only><label>Active form</label><select class="select" id="pkgFormId">${formOpts}</select></div>
      <div class="field data-pokemon-only${pokemonHidden}" data-pokemon-only><label>Pokédex entry</label><textarea class="input pkg-desc-area" id="pkgPokedex" rows="4">${esc(m.pokedexEntry || '')}</textarea></div>
      <details class="data-pokemon-only${pokemonHidden} pkg-pokeapi-block" data-pokemon-only>
        <summary>PokéAPI data (saved in .charbin)</summary>
        ${pkgPokeapiSummaryHtml(m.pokeapi)}
      </details>
      <div class="field ${pokemon ? 'pkg-field-hidden' : ''}"><label>Description</label><textarea class="input pkg-desc-area" id="pkgDesc" rows="3" placeholder="Sign text, inspect blurb, etc.">${esc(m.description || '')}</textarea></div>
      <div class="data-object-only${objectHidden}" data-object-only>
        <label class="check"><input type="checkbox" id="pkgObjectAnimated" ${m.objectAnimated ? 'checked' : ''}> Animated sprite (row 0 cycle)</label>
        <p class="tiny">Off = use <b>static</b> only (frame 0). On = game may use <b>animate</b> when the sheet has multiple frames.</p>
      </div>
      <div class="pkg-meta-block data-object-only${objectHidden}" data-object-only>
        <div class="field"><label>Tags</label></div>
        <div class="chip-field pkg-chip-field" id="pkgObjectTagsChips"></div>
      </div>
      <div class="pkg-npc-only pkg-partner-block${npcHidden}" data-npc-only>
        <label class="check pkg-partner-check"><input type="checkbox" id="pkgHasPartner" ${hasPartner ? 'checked' : ''}> Partner Pokémon</label>
        <div class="pkg-partner-row" id="pkgPartnerRow" style="${hasPartner ? '' : 'display:none'}">
          <div class="field"><label>Species</label><input class="input" id="pkgPartnerId" value="${esc(partner?.pokemonId || '')}" placeholder="garchomp"></div>
          <div class="field"><label>Form</label><input class="input" id="pkgPartnerForm" value="${esc(partner?.formId || 'default')}"></div>
          <div class="field"><label>Nickname</label><input class="input" id="pkgPartnerNick" value="${esc(partner?.nickname || '')}"></div>
        </div>
      </div>
      <div class="pkg-meta-block pkg-npc-only${npcHidden}" data-npc-only>
        <div class="field"><label>Personality</label></div>
        <div class="chip-field pkg-chip-field" id="pkgPersonalityChips"></div>
      </div>
      <div class="pkg-meta-block pkg-npc-only${npcHidden}" data-npc-only>
        <div class="field"><label>Likes</label></div>
        <div class="chip-field pkg-chip-field" id="pkgLikesChips"></div>
      </div>
      <div class="pkg-meta-block pkg-npc-only${npcHidden}" data-npc-only>
        <div class="field"><label>Tags</label></div>
        <div class="chip-field pkg-chip-field" id="pkgTagsChips"></div>
      </div>
      <div class="field pkg-npc-only${npcHidden}" data-npc-only><label>Dialogue</label><textarea class="input pkg-desc-area" id="pkgLines" rows="3" placeholder="One line per row">${esc((p.dialogue?.lines || []).join('\n'))}</textarea></div>
    </div>
  </details>`;
}

function drawSheetCell(ctx, canvas, img, row, col, prof) {
  const fw = Number(prof.frameWidth) || 32;
  const fh = Number(prof.frameHeight) || 32;
  const sx = col * fw;
  const sy = row * fh;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = false;
  const scale = Math.max(1, Math.floor(Math.min(canvas.width / fw, canvas.height / fh)));
  const w = fw * scale;
  const h = fh * scale;
  ctx.drawImage(img, sx, sy, fw, fh, Math.floor((canvas.width - w) / 2), Math.floor((canvas.height - h) / 2), w, h);
}

function pkgAnimSpec(sheet, prof, animName) {
  const custom = sheet?.animations?.[animName];
  if (custom) return custom;
  return prof.animations?.[animName];
}

/** Pause before restarting a one-shot anim in the editor preview (game uses loop: false). */
const PKG_PREVIEW_CYCLE_GAP_MS = 480;

function playPkgAnimOnCanvas(canvas, sheet, profileName, animName, direction = 'south') {
  if (!canvas || !sheet?.assetId) return () => {};
  const prof = pkgMergedProf(sheet, profileName);
  const anim = pkgAnimSpec(sheet, prof, animName);
  const objectGrid = (sheet.profile || profileName) === 'object' || isObjectCharType(pkg()?.metadata?.characterType);
  const dir = prof.directions?.[direction];
  if (!anim || (!objectGrid && dir == null)) return () => {};
  const dirRow = Number(dir?.row) || 0;
  const frameCols = anim.frames || [0];
  const delay = Math.max(1, Number(anim.frameTimeMs) || 140);
  const continuous = anim.loop !== false;
  const cols = Number(prof.columns) || 4;
  const ctx = canvas.getContext('2d');
  let frameIndex = 0;
  let stopped = false;
  const img = new Image();
  img.onload = () => {
    const drawFrame = () => {
      if (stopped) return;
      const fi = frameCols[Math.min(frameIndex, frameCols.length - 1)];
      if (objectGrid) {
        const r = Math.floor(fi / cols);
        const c = fi % cols;
        drawSheetCell(ctx, canvas, img, r, c, prof);
      } else {
        drawSheetCell(ctx, canvas, img, dirRow, fi, prof);
      }
      if (continuous || frameCols.length <= 1) {
        frameIndex = (frameIndex + 1) % frameCols.length;
        setTimeout(drawFrame, delay);
        return;
      }
      if (frameIndex < frameCols.length - 1) {
        frameIndex += 1;
        setTimeout(drawFrame, delay);
        return;
      }
      frameIndex = 0;
      setTimeout(drawFrame, PKG_PREVIEW_CYCLE_GAP_MS);
    };
    drawFrame();
  };
  img.onerror = () => {};
  img.src = `${sheetAssetUrl(sheet)}?t=${Date.now()}`;
  return () => { stopped = true; };
}

function hydratePkgVisuals() {
  stopPkgAnims();
  const sheet = selectedPkgSheet();
  const profileName = pkg()?.baseProfile || 'character';
  if (!sheet?.assetId) return;

  const prof = pkgMergedProf(sheet, profileName);
  const img = new Image();
  img.onload = () => {
    const objectMode = isObjectCharType(pkg()?.metadata?.characterType);
    $$('.pkg-base-canvas').forEach((canvas) => {
      const label = canvas.dataset.baseLabel;
      let dirKey = 'south';
      let col = 0;
      if (objectMode && label === 'view') {
        dirKey = 'south';
        col = 0;
      } else {
        const pair = PKG_BASE_SLOTS.find(([l]) => l === label);
        dirKey = pair?.[1] || 'south';
      }
      const row = Number(prof.directions?.[dirKey]?.row) || 0;
      drawSheetCell(canvas.getContext('2d'), canvas, img, row, col, prof);
    });
  };
  img.src = `${sheetAssetUrl(sheet)}?t=${Date.now()}`;

  $$('.pkg-dir-anim').forEach((card) => {
    const action = (pkg()?.actions || []).find((a) => a.id === card.dataset.pkgAnim);
    if (!action?.sheetId) return;
    const sheetForAnim = (pkg()?.spriteSheets || []).find((s) => s.id === action.sheetId);
    if (!sheetForAnim?.assetId) return;
    const canvas = $('canvas', card);
    const animName = card.dataset.animName || action.animationName || action.id;
    const dirKey = card.dataset.dir || 'south';
    if (canvas) {
      const stop = playPkgAnimOnCanvas(canvas, sheetForAnim, profileName, animName, dirKey);
      pkgState.animStops.push(stop);
    }
  });
}

function selectPkgSheet(sheetId) {
  pkgState.selectedSheetId = sheetId;
  $$('.pkg-sheet-tile').forEach((el) => {
    el.classList.toggle('selected', el.dataset.sheet === sheetId);
    el.classList.toggle('primary', el.dataset.sheet === sheetId);
  });
  const variantSel = $('#pkgSpriteVariant');
  if (variantSel && variantSel.value !== sheetId) variantSel.value = sheetId;
  hydratePkgVisuals();
}

function renderCharDetail() {
  const p = pkg();
  if (!p) {
    pkgState.panel = 'list';
    return renderPackages();
  }
  const m = p.metadata || {};
  const partner = m.partnerPokemon;
  const hasPartner = !!(partner && partner.pokemonId);
  const sheets = p.spriteSheets || [];
  const profNames = Object.keys(pkgState.profiles?.profiles || {});
  const actionsAll = (p.actions || []).filter((a) => sheets.some((s) => s.id === a.sheetId && s.assetId));
  const objectMode = isObjectCharType(m.characterType);
  const pokemonMode = isPokemonCharType(m.characterType);
  const walkSheets = pokemonMode ? pokemonWalkSheetsFromPackage(p) : [];
  if (pokemonMode) ensurePokemonSheetSelection(p);
  const sheet = selectedPkgSheet();
  const actions = filterActionsForPreview(p, actionsAll);
  const hasSheet = !!(sheet?.assetId);
  const variantPickerHtml = pokemonMode ? renderPokemonVariantPicker(walkSheets) : '';

  title(p.displayName || p.id);
  const quickAnimBtn = pokemonMode
    ? '<button type="button" class="btn good" id="pkgQuickAnimDetail" data-open-quick-anim>Quick anim</button>'
    : '';
  const bodyMarkersBtn = pokemonMode
    ? `<button type="button" class="btn" id="pkgBodyMarkersDetail" data-open-body-markers data-charbin-path="${esc(pkgState.selectedPath || '')}" data-charbin-name="${esc(p.displayName || p.id)}">Body markers</button>`
    : '';
  toolbar(`<button class="btn" id="pkgBack">← Characters</button>
    ${quickAnimBtn}
    ${bodyMarkersBtn}
    <button type="button" class="btn primary" id="pkgSheetUploadBtn">${objectMode ? 'Add sprite' : 'Add sheet'}</button>
    <input id="pkgSheetUpload" type="file" accept="image/png,image/webp" hidden>
    <button class="btn primary" id="pkgSave">Save</button>
    <button class="btn bad" id="pkgDelete">Delete</button>`);

  const animsHtml = renderPkgAnimationsHtml(actions);
  const baseHtml = PKG_BASE_SLOTS.map(([label]) => pkgSpriteSlot(label, hasSheet)).join('');
  const sheetsHtml = sheets.length
    ? sheets.map(pkgSheetTile).join('')
    : `<div class="empty">No sheets yet — use <b>${objectMode ? 'Add sprite' : 'Add sheet'}</b> in the toolbar.</div>`;
  const infoHtml = pkgCharInfoPanel(p, m, profNames, hasPartner);
  const baseSection = objectMode
    ? `<div class="section-title">Sprite</div><div class="grid cols2">${pkgSpriteSlot('view', hasSheet)}</div>`
    : `<div class="section-title" data-walk-character-only>Base sprites</div><div class="grid cols4" data-walk-character-only>${baseHtml}</div>`;

  $('#view').innerHTML = `
    <div class="character-header card sidecard"><div>
      <h3>${esc(p.displayName || p.id)}</h3>
      <p>${sheets.length} sheet${sheets.length === 1 ? '' : 's'} · ${actionsAll.length} action${actionsAll.length === 1 ? '' : 's'}${pokemonMode && walkSheets.length > 1 ? ` · ${walkSheets.length} variants` : ''} · .charbin${objectMode ? ' · object' : ''}</p>
    </div><button class="btn" id="pkgRename">Rename</button></div>
    ${infoHtml}
    <div class="section-title">Attached sheets</div>
    <div class="grid cols3" id="pkgSheetGrid">${sheetsHtml}</div>
    ${baseSection}
    <div class="section-title">Animations</div>
    ${pokemonMode && walkSheets.length <= 1 ? `<div class="card sidecard pkg-form-hint"><p class="tiny"><b>One walk variant in this file.</b> Use <b>Add sheet</b> to replace walk or add animations (<code>run</code>, etc.). Extra Pokémon forms use <b>Batch import</b>.</p></div>` : ''}
    ${variantPickerHtml}
    <div id="pkgAnimGrid">${animsHtml}</div>`;

  right(`<div class="sidecard card"><h3>Package detail</h3>
    <p class="tiny"><b>Object</b>: non-moving map prop; <b>static</b> (frame 0) or <b>animate</b> (row 0). <b>Player/NPC</b>: 4-dir walk. <b>Pokémon</b>: walk cycle + pause.</p></div>`);

  $('#pkgBack').onclick = () => pkgBackToList();
  $('#pkgSave').onclick = saveCharacter;
  $('#pkgRename').onclick = async () => {
    const name = prompt('New character name', p.displayName || p.id);
    if (!name) return;
    $('#pkgName').value = name;
    await saveCharacter();
  };
  $('#pkgDelete').onclick = async () => {
    if (!p.id) return;
    await deleteCharbinById(p.id, p.displayName || p.id);
    renderPackages();
  };
  const sheetInput = $('#pkgSheetUpload');
  if (sheetInput) sheetInput.onchange = onPkgSheetFileSelected;
  const sheetBtn = $('#pkgSheetUploadBtn');
  if (sheetBtn) sheetBtn.onclick = () => { startPkgSheetUpload(); };
  $('#pkgHasPartner')?.addEventListener('change', (e) => {
    $('#pkgPartnerRow').style.display = e.target.checked ? '' : 'none';
  });
  setupPkgCharInfoFields(m);
  $('#pkgFetchPokemon')?.addEventListener('click', () => fetchPokemonData());
  $('#pkgType')?.addEventListener('change', () => updatePkgFieldVisibility());
  $('#pkgProfile')?.addEventListener('change', () => hydratePkgVisuals());
  updatePkgFieldVisibility();
  $$('.pkg-sheet-tile').forEach((el) => {
    const open = () => openPkgSheetModal(el.dataset.sheet);
    el.onclick = open;
    el.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } };
  });
  $('#pkgSpriteVariant')?.addEventListener('change', (e) => {
    selectPkgSheet(e.target.value);
    renderCharDetail();
  });
  hydratePkgVisuals();
  $$('[data-pkg-action-info]').forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      openPkgActionMetaModal(btn.dataset.pkgActionInfo);
    };
  });
  if (typeof bindQuickAnimEntrypoints === 'function') bindQuickAnimEntrypoints($('#view'));
  if (typeof bindBodyMarkersEntrypoints === 'function') bindBodyMarkersEntrypoints($('#view'));
}

function renderPackages() {
  if (pkgState.panel === 'bodyMarkers' && typeof renderBodyMarkers === 'function') {
    renderBodyMarkers();
    return;
  }
  if (pkgState.panel === 'quickAnim' && typeof renderQuickAnim === 'function') {
    renderQuickAnim();
    return;
  }
  if (pkgState.panel === 'detail') renderCharDetail();
  else if (!pkgRestoreListSnapshot()) renderCharList();
}

async function renderPackagesView() {
  await loadPackageContext();
  if (pkgState.panel === 'detail' && pkgState.selectedPath && !pkg()) {
    await openCharacter(pkgState.selectedPath);
    return;
  }
  renderPackages();
  if (typeof bindQuickAnimEntrypoints === 'function') {
    bindQuickAnimEntrypoints(document);
  }
  if (typeof bindBodyMarkersEntrypoints === 'function') {
    bindBodyMarkersEntrypoints(document);
  }
}
