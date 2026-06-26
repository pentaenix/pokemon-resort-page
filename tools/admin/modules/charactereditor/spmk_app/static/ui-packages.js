/* .charbin characters — expands legacy renderLibraryDetail layout */
const PKG_POKEMON_SPRITES_KEY = 'spmk.pkg.pokemonShowSprites';
const PKG_POKEMON_LIB_UI_KEY = 'spmk.pkg.pokemonLibUi';

let pkgState = {
  settings: null,
  profiles: null,
  draft: null,
  assetIds: [],
  panel: 'list',
  selectedPath: null,
  selectedSheetId: null,
  variantSheetBehavior: null,
  preserveDetailVariant: null,
  pokemonLibUi: null,
  sheetMismatches: [],
  animStops: [],
  pokemonShowSprites: null,
};

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

function loadPokemonLibUi() {
  if (pkgState.pokemonLibUi) return pkgState.pokemonLibUi;
  try {
    const raw = localStorage.getItem(PKG_POKEMON_LIB_UI_KEY);
    pkgState.pokemonLibUi = raw ? JSON.parse(raw) : {};
  } catch {
    pkgState.pokemonLibUi = {};
  }
  return pkgState.pokemonLibUi;
}

function savePokemonLibUi(patch = {}) {
  const prev = loadPokemonLibUi();
  const ui = { ...prev, ...patch };
  if (patch.openGens) ui.openGens = [...new Set(patch.openGens.map(Number))];
  pkgState.pokemonLibUi = ui;
  try {
    localStorage.setItem(PKG_POKEMON_LIB_UI_KEY, JSON.stringify(ui));
  } catch { /* ignore */ }
  return ui;
}

function pokemonGenForEntryPath(list, path) {
  const entry = (list || []).find((x) => x.path === path);
  if (!entry) return null;
  const dex = pokemonDexNumber(entry);
  return dex == null ? 0 : pokemonGenerationGroup(dex).gen;
}

function capturePokemonLibraryUiFromDom(path) {
  const view = $('#view');
  const root = $('.pkg-lib-pokemon');
  const patch = {
    scrollY: view?.scrollTop || 0,
    lastPath: path || pkgState.selectedPath || loadPokemonLibUi().lastPath || null,
  };
  if (root) {
    patch.pokemonOpen = root.open;
    patch.openGens = [];
    $$('.pkg-lib-gen[data-gen]', root).forEach((details) => {
      if (details.open) patch.openGens.push(Number(details.dataset.gen));
    });
  }
  if (path) {
    const list = pkgState.settings?.scannedPackages || [];
    const gen = pokemonGenForEntryPath(list, path);
    if (gen != null) {
      const gens = new Set([...(patch.openGens || []), ...(loadPokemonLibUi().openGens || []), gen]);
      patch.openGens = [...gens];
      patch.pokemonOpen = true;
    }
  }
  savePokemonLibUi(patch);
}

function capturePokemonDetailVariant() {
  if (!pkgState.selectedPath) return;
  pkgState.preserveDetailVariant = {
    path: pkgState.selectedPath,
    sheetId: pkgState.selectedSheetId,
    sheetBehavior: pkgState.variantSheetBehavior || $('#pkgVarBehavior')?.value || null,
  };
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
  const m = id.match(/^(pause|idle|idle_swim|idle_eating|walk|swim|sleep|eating)(?:_(.+))?$/);
  if (!m) return [2, id, 0];
  const suffix = m[2] || '';
  const kind = { pause: 0, idle: 1, walk: 2, swim: 3, sleep: 4, eating: 5 }[m[1]] ?? 9;
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

function libraryTypeTag(entry) {
  const t = normalizeCharType(entry.characterType);
  if (t === 'player') return '<span class="tag">player</span>';
  if (t === 'pokemon') {
    const dex = entry.pokemonId != null ? `#${entry.pokemonId}` : '';
    const sheets = Number(entry.sheetCount) || 0;
    const sheetTag = sheets > 1
      ? `<span class="tag good">${sheets} sheets</span>`
      : '<span class="tag">base only</span>';
    return `<span class="tag">pokémon</span>${dex ? `<span class="tag">${esc(dex)}</span>` : ''}${sheetTag}`;
  }
  if (t === 'object') return '<span class="tag">object</span>';
  return '<span class="tag">npc</span>';
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
  const lib = await api('/api/packages/library');
  pkgState.settings = {
    packageDirectory: lib.packageDirectory,
    scannedPackages: lib.packages,
  };
  pkgState.profiles = await api('/api/packages/profiles');
  const d = await api('/api/packages/draft');
  pkgState.draft = d.package;
  pkgState.assetIds = d.assetIds || [];
  pkgState.sheetMismatches = d.sheetMismatches || [];
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

function pkgInferPokemonLayout(w, h) {
  const longest = Math.max(w, h);
  const cell = Math.max(w, h) / 4;
  if (longest >= 384 || cell >= 96) {
    return { profile: 'pokemon_large', cell: 64, overrides: null };
  }
  if (longest >= 224 || cell >= 52) {
    return { profile: 'pokemon_large', cell: 64, overrides: null };
  }
  if (longest >= 144 || cell >= 36) {
    return { profile: 'pokemon_small', cell: 40, overrides: { frameWidth: 40, frameHeight: 40 } };
  }
  return { profile: 'pokemon_small', cell: 32, overrides: null };
}

function pkgApplySheetCellFix(sheet, width, height) {
  const p = pkg();
  const prof = sheet?.profile || p?.baseProfile || 'character';
  const next = { ...sheet };
  if (prof === 'pokemon_small' || prof === 'pokemon_large') {
    const layout = pkgInferPokemonLayout(width, height);
    next.profile = layout.profile;
    if (layout.overrides) next.profileOverrides = { ...layout.overrides };
    else delete next.profileOverrides;
    return next;
  }
  const merged = pkgMergedProf(sheet);
  const cols = merged.columns || 4;
  const expected = Math.round(width / cols);
  const defaultCell = pkgDefaultCellSize(sheet);
  const overrides = { ...(next.profileOverrides || {}) };
  if (expected === defaultCell) {
    delete overrides.frameWidth;
    delete overrides.frameHeight;
  } else {
    overrides.frameWidth = expected;
    overrides.frameHeight = expected;
  }
  if (Object.keys(overrides).length) next.profileOverrides = overrides;
  else delete next.profileOverrides;
  return next;
}

function pkgExpectedCellForSheet(sheet, width, height) {
  const p = pkg();
  const prof = sheet?.profile || p?.baseProfile || 'character';
  if (prof === 'pokemon_small' || prof === 'pokemon_large') {
    return pkgInferPokemonLayout(width, height).cell;
  }
  const merged = pkgMergedProf(sheet);
  return Math.round(width / (merged.columns || 4));
}

function loadSheetImageSize(sheet) {
  return new Promise((resolve, reject) => {
    if (!sheet?.assetId) {
      reject(new Error('no asset'));
      return;
    }
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error('load failed'));
    img.src = `${sheetAssetUrl(sheet)}?t=${Date.now()}`;
  });
}

async function pkgProbeSheetMismatches() {
  const p = pkg();
  if (!p) return [];
  const sheets = (p.spriteSheets || []).filter((s) => s.assetId);
  const mismatches = [];
  await Promise.all(sheets.map(async (sheet) => {
    try {
      const { width, height } = await loadSheetImageSize(sheet);
      const configured = pkgEffectiveCellSize(sheet);
      const expected = pkgExpectedCellForSheet(sheet, width, height);
      if (configured !== expected) {
        mismatches.push({
          sheetId: sheet.id,
          sheetName: sheet.name || sheet.id,
          width,
          height,
          configuredCell: configured,
          expectedCell: expected,
        });
      }
    } catch (_) { /* skip unreadable sheets */ }
  }));
  return mismatches.sort((a, b) => String(a.sheetId).localeCompare(String(b.sheetId)));
}

function renderPkgSheetMismatchBanner(mismatches) {
  if (!mismatches?.length) return '';
  const items = mismatches.map((m) =>
    `<li><b>${esc(m.sheetName || m.sheetId)}</b> — PNG ${m.width}×${m.height}px needs ${m.expectedCell}px cells; currently ${m.configuredCell}px</li>`,
  ).join('');
  return `<div class="pkg-sheet-mismatch-banner" id="pkgSheetMismatchBanner" role="alert">
    <div>
      <p><b>Sheet cell size mismatch</b> — grid slicing may be wrong for ${mismatches.length} sheet${mismatches.length === 1 ? '' : 's'}.</p>
      <ul class="tiny pkg-sheet-mismatch-list">${items}</ul>
    </div>
    <button type="button" class="btn good" id="pkgSheetMismatchFix">Auto-fix all</button>
  </div>`;
}

function bindPkgSheetMismatchFix() {
  const btn = $('#pkgSheetMismatchFix');
  if (!btn || btn.dataset.bound) return;
  btn.dataset.bound = '1';
  btn.onclick = async () => {
    const p = pkg();
    const mismatches = pkgState.sheetMismatches || [];
    if (!p || !mismatches.length) return;
    const byId = new Map(mismatches.map((m) => [m.sheetId, m]));
    const nextSheets = (p.spriteSheets || []).map((sheet) => {
      const m = byId.get(sheet.id);
      if (!m) return sheet;
      return pkgApplySheetCellFix(sheet, m.width, m.height);
    });
    try {
      await saveDraft({ spriteSheets: nextSheets });
      toast('Sheet cell sizes updated');
      renderCharDetail();
    } catch (err) {
      toast(String(err.message || err));
    }
  };
}

function mountPkgSheetMismatchBanner(mismatches) {
  $('#pkgSheetMismatchBanner')?.remove();
  const html = renderPkgSheetMismatchBanner(mismatches);
  const header = $('.character-header', $('#view'));
  if (!html || !header) return;
  header.insertAdjacentHTML('afterend', html);
  bindPkgSheetMismatchFix();
}

let _pkgMismatchProbe = 0;
async function refreshPkgSheetMismatchBanner() {
  const token = ++_pkgMismatchProbe;
  mountPkgSheetMismatchBanner(pkgState.sheetMismatches || []);
  const probed = await pkgProbeSheetMismatches();
  if (token !== _pkgMismatchProbe || pkgState.panel !== 'detail') return;
  const changed = JSON.stringify(probed) !== JSON.stringify(pkgState.sheetMismatches || []);
  pkgState.sheetMismatches = probed;
  if (changed) mountPkgSheetMismatchBanner(probed);
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
  pkgState.sheetMismatches = res.sheetMismatches || [];
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
  const pokemon = partitionLibrary(list).pokemon;
  const groups = groupPokemonByGeneration(pokemon);
  const show = pokemonLibraryShowSprites();
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

function mountPokemonGenBody(details, list, rerender) {
  const host = $('.pkg-lib-gen-body', details);
  if (!host || host.dataset.rendered) return;
  const pokemon = partitionLibrary(list).pokemon;
  const groups = groupPokemonByGeneration(pokemon);
  const gen = Number(details.dataset.gen);
  const g = groups.find((x) => x.gen === gen);
  if (!g?.entries?.length) return;
  host.innerHTML = buildPokemonGenGrid(g.entries, isSelectMode('charbins'), pokemonLibraryShowSprites());
  host.dataset.rendered = '1';
  bindCharbinLibraryCards(host, list, rerender);
}

function restorePokemonLibraryUiAfterRender(list, rerender) {
  const ui = loadPokemonLibUi();
  const root = $('.pkg-lib-pokemon');
  if (!root) return;
  $$('.pkg-lib-gen[data-gen]', root).forEach((details) => {
    if (details.open) mountPokemonGenBody(details, list, rerender);
  });
  requestAnimationFrame(() => {
    const view = $('#view');
    if (!view) return;
    if (ui.lastPath) {
      const card = $$(`.character[data-path]`, view).find((el) => el.dataset.path === ui.lastPath);
      if (card) {
        card.scrollIntoView({ block: 'nearest' });
        return;
      }
    }
    if (ui.scrollY) view.scrollTop = ui.scrollY;
  });
}

function bindPokemonLibraryLazy(list, rerender) {
  const root = $('.pkg-lib-pokemon');
  if (!root) return;
  const pokemon = partitionLibrary(list).pokemon;
  if (!root.dataset.libUiBound) {
    root.dataset.libUiBound = '1';
    root.addEventListener('toggle', () => {
      const openGens = [];
      $$('.pkg-lib-gen[data-gen]', root).forEach((d) => {
        if (d.open) openGens.push(Number(d.dataset.gen));
      });
      savePokemonLibUi({ pokemonOpen: root.open, openGens });
    });
  }
  $$('.pkg-lib-gen[data-gen]', root).forEach((details) => {
    if (details.dataset.lazyBound) return;
    details.dataset.lazyBound = '1';
    details.addEventListener('toggle', () => {
      const openGens = [];
      $$('.pkg-lib-gen[data-gen]', root).forEach((d) => {
        if (d.open) openGens.push(Number(d.dataset.gen));
      });
      savePokemonLibUi({ pokemonOpen: root.open, openGens });
      if (!details.open) return;
      mountPokemonGenBody(details, list, rerender);
    });
    if (details.open) mountPokemonGenBody(details, list, rerender);
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
  const groups = groupPokemonByGeneration(entries);
  const ui = loadPokemonLibUi();
  const openGens = new Set((ui.openGens || []).map(Number));
  const genHtml = groups.map((g, idx) => {
    const rule = idx > 0 ? '<div class="pkg-lib-gen-rule" role="separator"></div>' : '';
    const genOpen = openGens.has(g.gen) ? ' open' : '';
    return `${rule}<details class="pkg-lib-gen" data-gen="${g.gen}"${genOpen}>
      <summary class="pkg-lib-gen-summary"><span>${esc(g.label)}</span><span class="pkg-lib-gen-count">${g.entries.length}</span></summary>
      <div class="pkg-lib-gen-body" data-lazy-gen="1"></div>
    </details>`;
  }).join('');
  const spritesOn = pokemonLibraryShowSprites();
  const pokemonOpen = ui.pokemonOpen ? ' open' : '';
  return `<details class="pkg-lib-collapse pkg-lib-pokemon"${pokemonOpen}>
    <summary class="pkg-lib-collapse-summary"><span class="section-title inline">Pokémon</span><span class="pkg-lib-gen-count">${entries.length}</span></summary>
    <div class="pkg-lib-pokemon-body">
      <label class="check pkg-lib-poke-sprite-toggle" title="Loads preview sprites for expanded generations only">
        <input type="checkbox" id="pkgPokemonShowSprites"${spritesOn ? ' checked' : ''}>
        Show sprites (visible rows)
      </label>
      ${genHtml}
    </div>
  </details>`;
}

const PKG_BATCH_FOLDER_BEHAVIORS = {
  base: 'walk', default: 'walk', walk: 'walk',
  sleep: 'sleep', sleeping: 'sleep',
  swim: 'swim', swimming: 'swim',
  eating: 'eating', eat: 'eating',
};
const PKG_BATCH_APPEARANCE = new Set(['shiny']);

function pkgBatchUploadPath(file) {
  return String(file.webkitRelativePath || file.name || 'sprite.png').replace(/\\/g, '/');
}

function pkgBatchLooksLikeVariantFolder(name) {
  const head = String(name || '').toLowerCase().split('_').filter(Boolean)[0];
  return !!head && head in PKG_BATCH_FOLDER_BEHAVIORS;
}

function pkgBatchSplitUploadPath(path) {
  const parts = String(path || '').replace(/\\/g, '/').split('/').filter(Boolean);
  const stem = (parts[parts.length - 1] || '').replace(/\.[^.]+$/, '');
  let speciesHint = null;
  let variantFolder = null;
  if (parts.length >= 3) {
    speciesHint = parts[parts.length - 3].toLowerCase();
    variantFolder = parts[parts.length - 2];
  } else if (parts.length === 2) {
    const parent = parts[0];
    if (pkgBatchLooksLikeVariantFolder(parent)) variantFolder = parent;
    else speciesHint = parent.toLowerCase();
  }
  return { path, stem, speciesHint, variantFolder };
}

function pkgBatchParseVariantFolder(folderName) {
  const tokens = String(folderName || '').toLowerCase().split('_').filter(Boolean);
  if (!tokens.length) return { behavior: 'walk', modifiers: [] };
  const behavior = PKG_BATCH_FOLDER_BEHAVIORS[tokens[0]] || tokens[0];
  const modifiers = tokens.slice(1).filter((t) => PKG_BATCH_APPEARANCE.has(t));
  return { behavior, modifiers };
}

function pkgBatchIsFormOnlyStem(stem, speciesHint) {
  if (!speciesHint) return false;
  const token = String(stem || '').toLowerCase().split('_').filter(Boolean);
  if (token.length !== 1) return false;
  const t = token[0];
  if (t === speciesHint) return false;
  if (t === 'female' || t === 'male' || t === 'f' || t === 'm' || /^\d+$/.test(t)) return true;
  return t.length === 1 && /^[a-z0-9]$/.test(t);
}

function pkgBatchPreviewParse(path, animationVariant, importBehavior) {
  const { stem, speciesHint, variantFolder } = pkgBatchSplitUploadPath(path);
  let behavior = importBehavior || 'walk';
  let modifiers = [];
  if (variantFolder) {
    const folder = pkgBatchParseVariantFolder(variantFolder);
    if (!importBehavior) behavior = folder.behavior;
    modifiers = [...folder.modifiers];
  }
  if (animationVariant) {
    animationVariant.toLowerCase().split(/[\s,+/]+/).forEach((t) => {
      t.split('_').forEach((p) => { if (PKG_BATCH_APPEARANCE.has(p)) modifiers.push(p); });
    });
  }
  modifiers = [...new Set(modifiers)];
  let species = speciesHint || stem;
  let form = '';
  if (speciesHint && pkgBatchIsFormOnlyStem(stem, speciesHint)) {
    species = speciesHint;
    form = stem.toLowerCase();
  } else {
    const tokens = stem.toLowerCase().split('_').filter(Boolean);
    if (tokens.length > 1) {
      const last = tokens[tokens.length - 1];
      if (last === 'female' || last === 'male' || /^\d+$/.test(last) || (last.length === 1 && /^[a-z0-9]$/.test(last))) {
        species = tokens.slice(0, -1).join('_');
        form = last === 'f' ? 'female' : last === 'm' ? 'male' : last;
      } else {
        species = tokens.join('_');
      }
    } else {
      species = tokens[0] || stem;
    }
  }
  const suffixParts = [];
  if (form && form !== 'default') suffixParts.push(form);
  suffixParts.push(...modifiers);
  const walkSid = suffixParts.length ? `walk_${suffixParts.join('_')}` : 'walk';
  const sheetId = behavior === 'walk' ? walkSid : (suffixParts.length ? `${behavior}_${suffixParts.join('_')}` : behavior);
  return { path, species, form, behavior, modifiers, sheetId, variantFolder };
}

function pkgBatchFileNeedsSpeciesRoot(file) {
  const { stem, variantFolder, speciesHint } = pkgBatchSplitUploadPath(pkgBatchUploadPath(file));
  if (speciesHint || !variantFolder) return false;
  const tokens = String(stem || '').toLowerCase().split('_').filter(Boolean);
  if (tokens.length !== 1) return false;
  const t = tokens[0];
  if (t === 'female' || t === 'male' || t === 'f' || t === 'm' || /^\d+$/.test(t)) return true;
  return t.length === 1 && /^[a-z0-9]$/.test(t);
}

function pkgBatchNeedsSpeciesRoot(files) {
  return files.some((f) => pkgBatchFileNeedsSpeciesRoot(f));
}

function pkgBatchIsDirectVariantTree(files) {
  if (!files.length) return false;
  return files.every((f) => {
    const parts = pkgBatchUploadPath(f).split('/').filter(Boolean);
    return parts.length === 2 && pkgBatchLooksLikeVariantFolder(parts[0]);
  });
}

function pkgBatchGuessSpeciesRoot(files) {
  for (const f of files) {
    const { stem } = pkgBatchSplitUploadPath(pkgBatchUploadPath(f));
    const tokens = stem.toLowerCase().split('_').filter(Boolean);
    if (!tokens.length) continue;
    if (tokens.length === 1) {
      if (!pkgBatchIsFormOnlyStem(stem, 'species')) return tokens[0];
      continue;
    }
    const last = tokens[tokens.length - 1];
    if (last === 'female' || last === 'male' || last === 'f' || last === 'm' || /^\d+$/.test(last)) {
      return tokens.slice(0, -1).join('_');
    }
    return tokens.join('_');
  }
  return '';
}

function pkgBatchEffectivePath(file, speciesRoot) {
  const rel = pkgBatchUploadPath(file);
  if (!speciesRoot || !pkgBatchFileNeedsSpeciesRoot(file)) return rel;
  const parts = rel.split('/').filter(Boolean);
  if (parts.length === 2 && pkgBatchLooksLikeVariantFolder(parts[0])) {
    return `${speciesRoot.toLowerCase()}/${rel}`;
  }
  return rel;
}

function pkgBatchUsesFolderLayout(files) {
  return files.some((f) => pkgBatchUploadPath(f).includes('/'));
}

function renderPkgBatchSummary(files, speciesRoot) {
  if (!files.length) return '';
  const species = new Set();
  const folders = new Set();
  files.forEach((f) => {
    const path = pkgBatchEffectivePath(f, speciesRoot);
    const p = pkgBatchPreviewParse(path, '', '');
    species.add(p.species);
    if (p.variantFolder) folders.add(p.variantFolder);
  });
  const folderLine = folders.size
    ? `Folders: ${[...folders].sort().join(', ')}`
    : 'Loose PNG files (names carry form / shiny / swim)';
  const samples = files.slice(0, 3).map((f) => pkgBatchEffectivePath(f, speciesRoot)).join(', ');
  const more = files.length > 3 ? ` … +${files.length - 3} more` : '';
  return `<div class="card sidecard pkg-batch-preview"><p class="tiny"><b>${files.length}</b> file${files.length === 1 ? '' : 's'} · <b>${species.size}</b> species<br>${esc(folderLine)}<br><span class="faint">${esc(samples)}${esc(more)}</span></p></div>`;
}

function openPkgBatchImportModal() {
  const types = [
    ['pokemon', 'Pokémon'],
    ['object', 'Object'],
    ['npc', 'NPC'],
    ['player', 'Player'],
  ];
  const html = `<div class="modal card big">${modalHead('Batch import sprites')}
    <div class="modal-section">
      <p class="tiny">Turn PNG sprites into <code>.charbin</code> packages. Pokémon sprites with the same name merge into one species file.</p>
      <div class="field"><label>Character type</label>
        <select class="select" id="pkgBatchType">${types.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}</select>
      </div>
      <div id="pkgBatchPokemonHint" class="card sidecard">
        <p class="tiny"><b>Pokémon sprite pack</b> — choose the folder that contains <code>base/</code>, <code>base_shiny/</code>, <code>swimming/</code>, and <code>swimming_shiny/</code>. Each subfolder holds every species as a PNG (<code>base/psyduck.png</code>, <code>base/garchomp_female.png</code>).</p>
      </div>
      <label class="dropzone pkg-batch-folder-pick">Choose sprite pack folder<input id="pkgBatchFolder" type="file" accept="image/png,image/webp" webkitdirectory directory multiple hidden></label>
      <p class="tiny pkg-batch-or">or pick individual PNG files</p>
      <label class="dropzone">Choose PNG files<input id="pkgBatchFiles" type="file" accept="image/png,image/webp" multiple hidden></label>
      <div id="pkgBatchFileList" class="tiny">Nothing selected yet.</div>
      <div id="pkgBatchPreview"></div>
      <div class="progress spaced"><div class="bar" id="pkgBatchBar"></div></div>
      <pre class="terminal compact" id="pkgBatchLog">Ready.</pre>
    </div>
    ${modalFoot('<button type="button" class="btn" id="pkgBatchClose">Close</button>', '<button type="button" class="btn primary" id="pkgRunBatch">Import</button>')}</div>`;
  const m = mountModal(html, { backdropClose: true });
  const logEl = $('#pkgBatchLog', m.root);
  const barEl = $('#pkgBatchBar', m.root);
  const pokeHint = $('#pkgBatchPokemonHint', m.root);
  const syncBatchTypeUi = () => {
    pokeHint.hidden = $('#pkgBatchType', m.root).value !== 'pokemon';
  };
  $('#pkgBatchType', m.root).onchange = syncBatchTypeUi;
  syncBatchTypeUi();
  $('#pkgBatchClose', m.root).onclick = () => m.close();
  let files = [];
  let source = '';
  let speciesRoot = '';
  const appendLog = (line) => { logEl.textContent += line; logEl.scrollTop = logEl.scrollHeight; };
  const setProgress = (pct, status) => {
    barEl.style.width = `${Math.min(100, Math.max(0, pct))}%`;
    if (status) appendLog(`${status}\n`);
  };
  const readBatchOpts = () => {
    const characterType = $('#pkgBatchType', m.root).value;
    const folderLayout = characterType === 'pokemon' && pkgBatchUsesFolderLayout(files);
    return {
      characterType,
      formKind: 'default',
      importBehavior: '',
      animationVariant: '',
      importMode: folderLayout || characterType === 'pokemon' ? 'add' : 'create',
      folderLayout,
      speciesRoot,
    };
  };
  const syncBatchFileUi = () => {
    const listEl = $('#pkgBatchFileList', m.root);
    const previewEl = $('#pkgBatchPreview', m.root);
    if (!files.length) {
      listEl.textContent = 'Nothing selected yet.';
      previewEl.innerHTML = '';
      return;
    }
    const species = new Set();
    files.forEach((f) => {
      species.add(pkgBatchPreviewParse(pkgBatchEffectivePath(f, speciesRoot), '', '').species);
    });
    listEl.textContent = source === 'files'
      ? `${files.length} PNG${files.length === 1 ? '' : 's'} · ${species.size} species`
      : `Sprite pack · ${files.length} PNGs · ${species.size} species`;
    previewEl.innerHTML = $('#pkgBatchType', m.root).value === 'pokemon'
      ? renderPkgBatchSummary(files, speciesRoot)
      : '';
  };
  const setBatchFiles = (nextFiles, nextSource, clearOtherInput) => {
    files = nextFiles.filter((f) => /\.(png|webp)$/i.test(f.name));
    source = nextSource;
    speciesRoot = '';
    if (clearOtherInput) clearOtherInput.value = '';
    syncBatchFileUi();
  };
  $('#pkgBatchFiles', m.root).onchange = (e) => {
    setBatchFiles([...(e.target.files || [])], 'files', $('#pkgBatchFolder', m.root));
  };
  $('#pkgBatchFolder', m.root).onchange = (e) => {
    const picked = [...(e.target.files || [])];
    setBatchFiles(picked, 'folder', $('#pkgBatchFiles', m.root));
  };
  const logBatchResult = (label, r) => {
    const form = r.form ? ` form ${r.form}` : '';
    const mods = (r.modifiers || []).length ? ` [${r.modifiers.join('+')}]` : '';
    const beh = r.behavior && r.behavior !== 'walk' ? ` ${r.behavior}` : '';
    const merged = r.merged ? ' (merged)' : '';
    const api = r.pokeapi?.found === false || r.itemApi?.found === false
      ? ' (no API match)'
      : (r.pokeapi?.corrected ? ` (dex: ${r.pokeapiSlug || r.pokeapi?.suggestion})` : '');
    const size = r.pokemonSize ? ` · ${r.pokemonSize}` : '';
    const sheet = r.sheetId ? ` → ${r.sheetId}` : '';
    appendLog(`✓ ${label} → ${r.id}${form}${mods}${beh}${sheet}${size}${merged}${api}\n`);
  };
  $('#pkgRunBatch', m.root).onclick = async () => {
    if (!files.length) {
      toast('Choose a folder or PNG files first');
      return;
    }
    let opts = readBatchOpts();
    let { characterType, formKind, importBehavior, animationVariant, importMode, speciesRoot: root } = opts;
    if (pkgBatchNeedsSpeciesRoot(files) && !root) {
      const guessed = pkgBatchGuessSpeciesRoot(files);
      const answer = prompt(
        'Some files are form-only (e.g. base/female.png).\nEnter the species name for this folder:',
        guessed || '',
      );
      if (!answer?.trim()) {
        toast('Species name required for these files');
        return;
      }
      speciesRoot = answer.trim().toLowerCase();
      opts = readBatchOpts();
      ({ characterType, formKind, importBehavior, animationVariant, importMode } = opts);
      root = speciesRoot;
      syncBatchFileUi();
    }
    const runBtn = $('#pkgRunBatch', m.root);
    runBtn.disabled = true;
    logEl.textContent = '';
    setProgress(0, `Importing ${files.length} file(s)…`);
    setSave('saving');
    let imported = 0;
    let failed = 0;
    const failedFiles = [];
    const CHUNK = 8;
    try {
      for (let i = 0; i < files.length; i += CHUNK) {
        const chunk = files.slice(i, i + CHUNK);
        const pctBase = (i / files.length) * 100;
        setProgress(pctBase + 2, `[${i + 1}-${Math.min(i + chunk.length, files.length)}/${files.length}] Uploading…`);
        const fd = new FormData();
        chunk.forEach((f) => {
          fd.append('files', f, pkgBatchEffectivePath(f, root));
        });
        fd.append('characterType', characterType);
        if (characterType === 'pokemon') {
          fd.append('animationVariant', animationVariant);
          fd.append('importMode', importMode);
          fd.append('importBehavior', importBehavior);
          fd.append('formKind', formKind);
        }
        let out = await fetch('/api/packages/batch/import-sprites', { method: 'POST', body: fd });
        let text = await out.text();
        if (!out.ok && out.status === 503) {
          appendLog('…editor busy, retrying chunk…\n');
          await new Promise((r) => setTimeout(r, 2000));
          out = await fetch('/api/packages/batch/import-sprites', { method: 'POST', body: fd });
          text = await out.text();
        }
        if (!out.ok) {
          const errText = text || out.statusText;
          chunk.forEach((f) => {
            failed += 1;
            const label = pkgBatchUploadPath(f);
            failedFiles.push({ name: label, error: errText });
            appendLog(`✗ ${label}: ${errText}\n`);
          });
          continue;
        }
        const res = JSON.parse(text);
        const resultByFile = new Map((res.results || []).map((r) => [r.file || r.uploadPath || '', r]));
        const errorByFile = new Map((res.errors || []).map((e) => [e.file || '', e]));
        chunk.forEach((f) => {
          const label = pkgBatchEffectivePath(f, root);
          const err = errorByFile.get(label) || errorByFile.get(f.name);
          const r = resultByFile.get(label) || resultByFile.get(f.name);
          if (err) {
            failed += 1;
            failedFiles.push({ name: label, error: err.error });
            appendLog(`✗ ${label}: ${err.error}\n`);
          } else if (r) {
            imported += 1;
            logBatchResult(label, r);
          }
        });
        setProgress(((i + chunk.length) / files.length) * 100, `[${Math.min(i + chunk.length, files.length)}/${files.length}] Chunk done`);
      }
      setProgress(100, `Finished: ${imported} saved, ${failed} failed`);
      if (failedFiles.length) {
        appendLog(`\n── Failed files (${failedFiles.length}) ──\n`);
        failedFiles.forEach(({ name, error }) => {
          const msg = (error || 'unknown error').split('\n')[0].slice(0, 200);
          appendLog(`  ✗ ${name}${msg ? ` — ${msg}` : ''}\n`);
        });
      }
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
  const list = pkgState.settings?.scannedPackages || [];
  const { playable, characters, pokemon, objects } = partitionLibrary(list);
  const sel = isSelectMode('charbins');
  toolbar(`<button class="btn good" id="pkgQuickAnim" data-open-quick-anim>Quick anim</button><button class="btn" id="pkgBodyMarkers" data-open-body-markers>Body markers</button><span class="tag">batch .charbin</span><button class="btn primary" id="pkgNewPlayer">＋ Player</button><button class="btn" id="pkgNewNpc">＋ NPC</button><button class="btn" id="pkgNewPokemon">＋ Pokémon</button><button class="btn" id="pkgNewObject">＋ Object</button><button class="btn" id="pkgBatchImport">Batch import…</button><label class="btn">Import .charbin<input id="pkgImport" type="file" accept=".charbin" hidden></label>`);
  const sections = [
    renderLibrarySection('Playable', playable, sel),
    renderLibrarySection('Characters', characters, sel),
    renderPokemonLibrarySection(pokemon, sel),
    renderLibrarySection('Objects', objects, sel),
  ].filter(Boolean).join('');
  const body = sections || `<div class="empty"><strong>No packages yet.</strong><br/>Create a package or import a .charbin file.</div>`;
  $('#view').innerHTML = `${bulkBar('charbins')}${sectionHead('Library', 'charbins')}${body}`;
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

  $('#pkgChangeDir').onclick = () => changePackageDirectory();
  $('#pkgResetDir').onclick = () => resetPackageDirectory();
  $('#pkgNewPlayer').onclick = () => createPackageQuick('player');
  $('#pkgNewNpc').onclick = () => createPackageQuick('npc');
  $('#pkgNewPokemon').onclick = () => createPackageQuick('pokemon');
  $('#pkgNewObject').onclick = () => createPackageQuick('object');
  $('#pkgBatchImport').onclick = openPkgBatchImportModal;
  if (typeof bindQuickAnimEntrypoints === 'function') bindQuickAnimEntrypoints($('#view'));
  $('#pkgImport')?.addEventListener('change', async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const fd = new FormData();
    fd.append('file', f);
    const res = await api('/api/packages/draft/import', { method: 'POST', body: fd });
    pkgState.selectedPath = res.path;
    pkgState.panel = 'detail';
    await loadPackageContext();
    renderPackages();
    e.target.value = '';
  });
  bindSelectMode('charbins', renderPackages, bulkDeleteCharbins);
  bindCharbinLibraryCards($('#view'), list, renderPackages);
  bindPokemonLibraryLazy(list, renderPackages);
  bindPokemonSpriteToggle(list, renderPackages);
  restorePokemonLibraryUiAfterRender(list, renderPackages);
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
    pkgState.selectedPath = (pkgState.settings?.scannedPackages || []).find((x) => x.id === id)?.path || null;
    pkgState.panel = 'detail';
    renderPackages();
    try { await fetchPokemonData(); } catch (_) { /* optional autofill */ }
  } else if (characterType === 'object') {
    pkgState.selectedPath = (pkgState.settings?.scannedPackages || []).find((x) => x.id === id)?.path || null;
    pkgState.panel = 'detail';
    renderPackages();
  } else {
    pkgState.panel = 'list';
    renderPackages();
  }
}

async function openCharacter(path) {
  if (pkgState.panel === 'list') capturePokemonLibraryUiFromDom(path);
  await api('/api/packages/draft/open-path', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  });
  const preserved = pkgState.preserveDetailVariant;
  const restoreVariant = preserved?.path === path;
  pkgState.selectedPath = path;
  pkgState.panel = 'detail';
  await loadPackageContext();
  const p = pkg();
  if (restoreVariant && preserved.sheetId) {
    pkgState.selectedSheetId = preserved.sheetId;
    pkgState.variantSheetBehavior = preserved.sheetBehavior || null;
  } else if (isPokemonCharType(p?.metadata?.characterType)) {
    pkgState.selectedSheetId = defaultPokemonWalkSheetId(p);
    pkgState.variantSheetBehavior = null;
  } else {
    pkgState.selectedSheetId = p?.spriteSheets?.[0]?.id || null;
    pkgState.variantSheetBehavior = null;
  }
  pkgState.preserveDetailVariant = null;
  savePokemonLibUi({ lastPath: path });
  renderPackages();
}

function pkgSheetTile(sheet) {
  const active = sheet.id === pkgState.selectedSheetId ? ' primary' : '';
  const cell = pkgEffectiveCellSize(sheet);
  const v = isPokemonCharType(pkg()?.metadata?.characterType) ? syncSheetVariantFields(sheet) : null;
  const sub = v
    ? pokemonVariantLabel(v.formId, v.modifiers, v.behavior)
    : profileLabel(sheet.profile || pkg()?.baseProfile || 'character');
  const thumb = sheet.assetId
    ? `<div class="thumb wide" style="margin-bottom:8px"><img src="${sheetAssetUrl(sheet)}?t=${Date.now()}"/></div>`
    : '<div class="thumb wide" style="margin-bottom:8px"><span class="tiny">no png</span></div>';
  return `<div class="card sidecard sheet-tile pkg-sheet-tile selectable-card${active}" data-sheet="${esc(sheet.id)}" role="button" tabindex="0" title="Open sheet inspector">
    ${thumb}<h3 class="truncate">${esc(sheet.name || sheet.id)}</h3>
    <p>${esc(sub)}</p>
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
  selectPkgSheet(sheetId);

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

function pkgActionDisplayName(action) {
  if (!action) return '';
  const sheetBeh = actionSheetBehavior(action);
  const isStance = !action.movementDriven || action.type === 'idle' || (action.behavior || '') === 'idle';
  if (isStance) return `idle (${sheetBeh})`;
  return String(action.animationName || action.id || sheetBeh);
}

function pkgAnimGroupHeader(action) {
  const name = pkgActionDisplayName(action);
  const sheetBeh = actionSheetBehavior(action);
  const pokemonMode = isPokemonCharType(pkg()?.metadata?.characterType);
  const isStance = !action.movementDriven || action.type === 'idle' || (action.behavior || '') === 'idle';
  let hint;
  if (pokemonMode && isStance && ['walk', 'swim', 'eating'].includes(sheetBeh)) {
    hint = `same ${sheetBeh} animation`;
  } else if (action.movementDriven) {
    hint = `loops on ${sheetBeh} sheet`;
  } else {
    hint = `frame 0 on ${sheetBeh} sheet`;
  }
  return `<div class="pkg-anim-group-head">
    <span class="section-title inline">${esc(name)}</span>
    <button type="button" class="pkg-action-info-btn" data-pkg-action-info="${esc(action.id)}" title="Animation metadata" aria-label="Edit animation metadata for ${esc(name)}">i</button>
    <span class="tiny pkg-anim-group-hint">${esc(hint)}</span>
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
        <p class="tiny">Phase ids map to <code>{ animationName, loop? }</code> on the sheet.</p>
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
  syncTypeUi();
}

function bindPkgActionInfoButtons(root) {
  (root || document).querySelectorAll('[data-pkg-action-info]').forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      openPkgActionMetaModal(btn.dataset.pkgActionInfo);
    };
  });
}

function pkgSpriteSlot(label, hasSheet) {
  const thumb = hasSheet
    ? `<canvas class="anim-card-canvas checker pkg-base-canvas" data-base-label="${esc(label)}" width="64" height="64"></canvas>`
    : '<div class="thumb"><span class="tiny">empty</span></div>';
  return `<div class="card sidecard sprite-slot">${thumb}<h3>${esc(label)}</h3><p>${hasSheet ? 'from walk sheet' : 'Missing'}</p></div>`;
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

function inferPokemonSheetBehavior(sheetId) {
  const id = sheetId || '';
  if (isPokemonWalkSheetId(id)) return 'walk';
  if (isPokemonSleepSheetId(id)) return 'sleep';
  if (id === 'swim' || id.startsWith('swim_')) return 'swim';
  if (id === 'eating' || id.startsWith('eating_')) return 'eating';
  return 'walk';
}

function parseLegacyVariantSuffix(suffix) {
  if (!suffix) return { formId: 'default', modifiers: [] };
  const tokens = suffix.split('_').filter(Boolean);
  const modifiers = [];
  const formParts = [];
  for (const t of tokens) {
    const low = t.toLowerCase();
    if (low === 'shiny' || low === 'female' || low === 'male') modifiers.push(low);
    else formParts.push(t);
  }
  const formId = formParts.length ? formParts.join('_') : 'default';
  return { formId, modifiers };
}

function syncActionVariantFields(action) {
  if (!action) return { formId: 'default', modifiers: [], behavior: 'walk', sheetBehavior: 'walk' };
  if (action.formId != null && action.behavior) {
    return {
      formId: action.formId || 'default',
      modifiers: action.modifiers || [],
      behavior: action.behavior,
      sheetBehavior: action.sheetBehavior || inferActionSheetBehaviorFromId(action),
    };
  }
  const aid = action.id || '';
  if (aid === 'idle' || aid === 'walk' || aid === 'pause') {
    const behavior = aid === 'pause' ? 'idle' : aid;
    return { formId: 'default', modifiers: [], behavior, sheetBehavior: 'walk' };
  }
  for (const sheetBeh of ['swim', 'eating']) {
    const solo = `idle_${sheetBeh}`;
    if (aid === solo) {
      return { formId: 'default', modifiers: [], behavior: 'idle', sheetBehavior: sheetBeh };
    }
    const prefix = `${solo}_`;
    if (aid.startsWith(prefix)) {
      const parsed = parseLegacyVariantSuffix(aid.slice(prefix.length));
      return { ...parsed, behavior: 'idle', sheetBehavior: sheetBeh };
    }
  }
  for (const [prefix, behavior] of [
    ['idle_', 'idle'], ['walk_', 'walk'], ['pause_', 'idle'],
    ['sleep_', 'sleep'], ['swim_', 'swim'], ['eating_', 'eating'],
  ]) {
    if (aid.startsWith(prefix)) {
      const parsed = parseLegacyVariantSuffix(aid.slice(prefix.length));
      const sheetBehavior = ['idle', 'walk'].includes(behavior) ? 'walk' : behavior;
      return { ...parsed, behavior, sheetBehavior };
    }
  }
  if (aid === 'swim' || aid === 'sleep' || aid === 'eating') {
    return { formId: 'default', modifiers: [], behavior: aid, sheetBehavior: aid };
  }
  return { formId: 'default', modifiers: [], behavior: 'walk', sheetBehavior: 'walk' };
}

function currentVariantSheetBehavior(fallback = 'walk') {
  return pkgState.variantSheetBehavior || $('#pkgVarBehavior')?.value || fallback;
}

function setVariantSheetBehavior(behavior) {
  pkgState.variantSheetBehavior = behavior || 'walk';
}

function inferActionSheetBehaviorFromId(action) {
  if (action?.sheetBehavior) return action.sheetBehavior;
  const aid = String(action?.id || '');
  if (aid === 'swim' || aid.startsWith('swim_')) return 'swim';
  if (aid === 'eating' || aid.startsWith('eating_')) return 'eating';
  if (aid === 'sleep' || aid.startsWith('sleep_')) return 'sleep';
  const stanceSwim = aid.match(/^idle_(swim|eating)(?:_|$)/);
  if (stanceSwim) return stanceSwim[1];
  return 'walk';
}

function actionSheetBehavior(action) {
  if (action?.sheetBehavior) return action.sheetBehavior;
  const inferred = inferActionSheetBehaviorFromId(action);
  if (inferred !== 'walk') return inferred;
  const aid = String(action?.id || '');
  if (aid === 'idle' || aid.startsWith('idle_') || aid === 'walk' || aid.startsWith('walk_') || aid === 'pause' || aid.startsWith('pause_')) {
    return 'walk';
  }
  const av = syncActionVariantFields(action);
  if (av.behavior === 'idle') return av.sheetBehavior || 'walk';
  return av.behavior || 'walk';
}

function pkgPreviewAnimName(action, sheet, profileName) {
  let anim = action?.animationName || action?.id || 'walk';
  const prof = pkgMergedProf(sheet, profileName);
  if (pkgAnimSpec(sheet, prof, anim)) return anim;
  if (anim !== 'walk' && pkgAnimSpec(sheet, prof, 'walk')) return 'walk';
  return anim;
}

function resolveActionPreviewSheet(action, p) {
  const sheets = (p?.spriteSheets || []).filter((s) => s.assetId);
  const byId = (id) => sheets.find((s) => s.id === id);
  const direct = byId(action?.sheetId);
  if (direct) return direct;

  const av = syncActionVariantFields(action);
  const formId = action?.formId || av.formId || 'default';
  const modsKey = (action?.modifiers || av.modifiers || []).join(',');
  const sheetBehavior = actionSheetBehavior(action);
  const variantSheets = pokemonVariantSheetsFromPackage(p);
  const match = findVariantSheet(variantSheets, formId, modsKey, sheetBehavior);
  return match ? byId(match.id) : null;
}

function pkgActionsWithResolvablePreview(p) {
  const actions = p?.actions || [];
  if (!isPokemonCharType(p?.metadata?.characterType)) {
    const sheets = p?.spriteSheets || [];
    return actions.filter((a) => sheets.some((s) => s.id === a.sheetId && s.assetId));
  }
  return actions.filter((a) => a?.id && resolveActionPreviewSheet(a, p));
}

function actionMatchesVariantSheetBehavior(action, sheetBehavior) {
  return actionSheetBehavior(action) === sheetBehavior;
}

function syncSheetVariantFields(sheet) {
  if (!sheet) return { formId: 'default', modifiers: [], behavior: 'walk' };
  if (sheet.formId && sheet.behavior) {
    return {
      formId: sheet.formId || 'default',
      modifiers: sheet.modifiers || [],
      behavior: sheet.behavior,
    };
  }
  const sid = sheet.id || '';
  if (sid === 'walk') return { formId: 'default', modifiers: [], behavior: 'walk' };
  if (sid.startsWith('walk_')) {
    const parsed = parseLegacyVariantSuffix(sid.slice(5));
    return { ...parsed, behavior: 'walk' };
  }
  if (sid === 'sleep') return { formId: 'default', modifiers: [], behavior: 'sleep' };
  if (sid.startsWith('sleep_')) {
    const parsed = parseLegacyVariantSuffix(sid.slice(6));
    return { ...parsed, behavior: 'sleep' };
  }
  const parts = sid.split('_').filter(Boolean);
  if (parts.length >= 1 && ['swim', 'eating', 'sleep'].includes(parts[0])) {
    const head = parts[0];
    const parsed = parseLegacyVariantSuffix(parts.slice(1).join('_'));
    return { ...parsed, behavior: head };
  }
  return { formId: 'default', modifiers: [], behavior: inferPokemonSheetBehavior(sid) };
}

function pokemonVariantSheetsFromPackage(p) {
  return (p?.spriteSheets || [])
    .filter((s) => s.assetId)
    .map((s) => {
      const v = syncSheetVariantFields(s);
      return { ...s, ...v };
    })
    .sort((a, b) => {
      const fa = a.formId === 'default' ? '' : a.formId;
      const fb = b.formId === 'default' ? '' : b.formId;
      if (fa !== fb) return fa.localeCompare(fb, undefined, { numeric: true });
      const ma = (a.modifiers || []).join(',');
      const mb = (b.modifiers || []).join(',');
      if (ma !== mb) return ma.localeCompare(mb);
      const order = { walk: 0, sleep: 1, swim: 2, eating: 3 };
      return (order[a.behavior] ?? 9) - (order[b.behavior] ?? 9);
    });
}

function pokemonVariantLabel(formId, modifiers, behavior) {
  const parts = [];
  if (formId && formId !== 'default') parts.push(formId);
  if (modifiers?.length) parts.push(...modifiers);
  if (behavior && behavior !== 'walk') parts.push(behavior);
  return parts.length ? parts.join(' · ') : 'Default walk';
}

function summarizePokemonVariantMatrix(p) {
  const sheets = pokemonVariantSheetsFromPackage(p);
  const forms = new Set();
  const combos = new Set();
  const behaviors = new Set();
  for (const s of sheets) {
    forms.add(s.formId);
    combos.add(`${s.formId}|${(s.modifiers || []).join(',')}`);
    behaviors.add(s.behavior);
  }
  return {
    formCount: forms.size,
    variantCombos: combos.size,
    behaviors: [...behaviors].sort(),
    sheetCount: sheets.length,
  };
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
  const variantSheets = pokemonVariantSheetsFromPackage(p);
  if (!variantSheets.length) return;
  const ids = variantSheets.map((s) => s.id);
  if (!ids.includes(pkgState.selectedSheetId)) {
    const baseWalk = variantSheets.find(
      (s) => s.behavior === 'walk' && s.formId === 'default' && !(s.modifiers || []).length,
    );
    pkgState.selectedSheetId = baseWalk?.id || variantSheets[0].id;
  }
}

function pkgVariantFocusFromSelection(variantSheets) {
  const sheet = variantSheets.find((s) => s.id === pkgState.selectedSheetId) || variantSheets[0];
  const behavior = currentVariantSheetBehavior(sheet?.behavior || 'walk');
  return {
    formId: sheet?.formId || 'default',
    modifiersKey: (sheet?.modifiers || []).join(','),
    behavior,
  };
}

function uniqueFormIds(variantSheets) {
  return [...new Set(variantSheets.map((s) => s.formId || 'default'))].sort((a, b) => {
    if (a === 'default') return -1;
    if (b === 'default') return 1;
    return a.localeCompare(b, undefined, { numeric: true });
  });
}

function uniqueModifierChoices(variantSheets, formId) {
  const seen = new Set();
  const out = [];
  for (const s of variantSheets) {
    if ((s.formId || 'default') !== formId) continue;
    const key = (s.modifiers || []).join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    const label = key ? key.split(',').join(' + ') : 'Normal';
    out.push({ key, label });
  }
  return out;
}

function uniqueBehaviorChoices(variantSheets, formId, modifiersKey) {
  const behaviors = variantSheets
    .filter((s) => (s.formId || 'default') === formId && (s.modifiers || []).join(',') === modifiersKey)
    .map((s) => s.behavior);
  return [...new Set(behaviors)].sort((a, b) => {
    const order = { walk: 0, sleep: 1, swim: 2, eating: 3 };
    return (order[a] ?? 9) - (order[b] ?? 9);
  });
}

function findVariantSheet(variantSheets, formId, modifiersKey, behavior) {
  return variantSheets.find(
    (s) => (s.formId || 'default') === formId
      && (s.modifiers || []).join(',') === modifiersKey
      && s.behavior === behavior,
  );
}

function renderPokemonVariantPicker(variantSheets) {
  if (variantSheets.length <= 1) return '';
  const focus = pkgVariantFocusFromSelection(variantSheets);
  const forms = uniqueFormIds(variantSheets);
  const mods = uniqueModifierChoices(variantSheets, focus.formId);
  const behaviors = uniqueBehaviorChoices(variantSheets, focus.formId, focus.modifiersKey);
  const formOpts = forms.map((id) => {
    const sel = id === focus.formId ? ' selected' : '';
    const label = id === 'default' ? 'Default' : id;
    return `<option value="${esc(id)}"${sel}>${esc(label)}</option>`;
  }).join('');
  const modOpts = mods.map(({ key, label }) => {
    const sel = key === focus.modifiersKey ? ' selected' : '';
    return `<option value="${esc(key)}"${sel}>${esc(label)}</option>`;
  }).join('');
  const behOpts = behaviors.map((b) => {
    const sel = b === focus.behavior ? ' selected' : '';
    const label = b.charAt(0).toUpperCase() + b.slice(1);
    return `<option value="${esc(b)}"${sel}>${esc(label)}</option>`;
  }).join('');
  return `<div class="pkg-sprite-variant-picker" data-pokemon-only>
    <div class="grid cols3">
      <div class="field"><label>Form</label><select class="select" id="pkgVarForm">${formOpts}</select></div>
      <div class="field"><label>Look</label><select class="select" id="pkgVarMod">${modOpts}</select></div>
      <div class="field"><label>Animation</label><select class="select" id="pkgVarBehavior">${behOpts}</select></div>
    </div>
    <p class="tiny">Preview sprites for this form, look, and animation.</p>
  </div>`;
}

function refreshPkgVariantPreview() {
  const p = pkg();
  if (!p) return;
  const actionsAll = pkgActionsWithResolvablePreview(p);
  const actions = filterActionsForPreview(p, actionsAll);
  const grid = $('#pkgAnimGrid');
  if (grid) grid.innerHTML = renderPkgAnimationsHtml(actions);
  hydratePkgVisuals();
  bindPkgActionInfoButtons($('#view'));
}

function syncPkgVariantPickerFromSheet(variantSheets) {
  if (variantSheets.length <= 1) return;
  const formEl = $('#pkgVarForm');
  const modEl = $('#pkgVarMod');
  const behEl = $('#pkgVarBehavior');
  if (!formEl || !modEl || !behEl) return;
  const focus = pkgVariantFocusFromSelection(variantSheets);
  formEl.value = focus.formId;
  const mods = uniqueModifierChoices(variantSheets, focus.formId);
  modEl.innerHTML = mods.map(({ key, label }) =>
    `<option value="${esc(key)}">${esc(label)}</option>`).join('');
  modEl.value = focus.modifiersKey;
  const behaviors = uniqueBehaviorChoices(variantSheets, focus.formId, focus.modifiersKey);
  behEl.innerHTML = behaviors.map((b) =>
    `<option value="${esc(b)}">${esc(b.charAt(0).toUpperCase() + b.slice(1))}</option>`).join('');
  behEl.value = focus.behavior;
  setVariantSheetBehavior(focus.behavior);
}

function bindPkgVariantPicker(variantSheets) {
  if (variantSheets.length <= 1) return;
  const formEl = $('#pkgVarForm');
  const modEl = $('#pkgVarMod');
  const behEl = $('#pkgVarBehavior');
  if (!formEl || !modEl || !behEl) return;

  const syncModifierOptions = () => {
    const formId = formEl.value;
    const mods = uniqueModifierChoices(variantSheets, formId);
    const prev = modEl.value;
    modEl.innerHTML = mods.map(({ key, label }) =>
      `<option value="${esc(key)}">${esc(label)}</option>`).join('');
    modEl.value = mods.some((m) => m.key === prev) ? prev : (mods[0]?.key || '');
  };

  const syncBehaviorOptions = (keepBehavior) => {
    const behaviors = uniqueBehaviorChoices(variantSheets, formEl.value, modEl.value);
    const prev = keepBehavior || currentVariantSheetBehavior();
    behEl.innerHTML = behaviors.map((b) =>
      `<option value="${esc(b)}">${esc(b.charAt(0).toUpperCase() + b.slice(1))}</option>`).join('');
    behEl.value = behaviors.includes(prev) ? prev : (behaviors[0] || 'walk');
    setVariantSheetBehavior(behEl.value);
  };

  const apply = () => {
    setVariantSheetBehavior(behEl.value);
    const sheet = findVariantSheet(variantSheets, formEl.value, modEl.value, behEl.value);
    if (sheet) selectPkgSheet(sheet.id);
    refreshPkgVariantPreview();
  };

  formEl.onchange = () => {
    const keepBehavior = currentVariantSheetBehavior();
    syncModifierOptions();
    syncBehaviorOptions(keepBehavior);
    apply();
  };
  modEl.onchange = () => {
    const keepBehavior = currentVariantSheetBehavior();
    syncBehaviorOptions(keepBehavior);
    apply();
  };
  behEl.onchange = () => {
    setVariantSheetBehavior(behEl.value);
    apply();
  };
}

/** Limit animation preview to the selected form, look, and sheet type (walk / swim / …). */
function filterActionsForPreview(p, actions) {
  if (!isPokemonCharType(p?.metadata?.characterType)) return actions;
  const variantSheets = pokemonVariantSheetsFromPackage(p);
  if (variantSheets.length <= 1) return actions;
  const focusSheet = variantSheets.find((s) => s.id === pkgState.selectedSheetId) || variantSheets[0];
  const formId = focusSheet.formId;
  const modsKey = (focusSheet.modifiers || []).join(',');
  const sheetBehavior = currentVariantSheetBehavior(focusSheet.behavior || 'walk');
  return actions.filter((a) => {
    const av = syncActionVariantFields(a);
    const aForm = a.formId || av.formId || 'default';
    const aMods = (a.modifiers || av.modifiers || []).join(',');
    if (aForm !== formId || aMods !== modsKey) return false;
    return actionMatchesVariantSheetBehavior(a, sheetBehavior);
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

function playPkgAnimOnCanvas(canvas, sheet, profileName, animName, direction = 'south', opts = {}) {
  if (!canvas || !sheet?.assetId) return () => {};
  const prof = pkgMergedProf(sheet, profileName);
  const anim = pkgAnimSpec(sheet, prof, animName);
  const objectGrid = (sheet.profile || profileName) === 'object' || isObjectCharType(pkg()?.metadata?.characterType);
  const dir = prof.directions?.[direction];
  if (!anim || (!objectGrid && dir == null)) return () => {};
  const dirRow = Number(dir?.row) || 0;
  const frameCols = anim.frames || [0];
  const delay = Math.max(1, Number(anim.frameTimeMs) || 140);
  const holdFrame = !!opts.holdFrame;
  const continuous = !holdFrame && anim.loop !== false;
  const cols = Number(prof.columns) || 4;
  const ctx = canvas.getContext('2d');
  let frameIndex = 0;
  let stopped = false;
  const img = new Image();
  img.onload = () => {
    const drawFrame = () => {
      if (stopped) return;
      const fi = frameCols[Math.min(holdFrame ? 0 : frameIndex, frameCols.length - 1)];
      if (objectGrid) {
        const r = Math.floor(fi / cols);
        const c = fi % cols;
        drawSheetCell(ctx, canvas, img, r, c, prof);
      } else {
        drawSheetCell(ctx, canvas, img, dirRow, fi, prof);
      }
      if (holdFrame) return;
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

/** Pokémon idle uses the same looping clip as walk/swim; NPC idle holds frame 0. */
function pkgPreviewHoldFrame(action, p) {
  if (isPokemonCharType(p?.metadata?.characterType)) return false;
  return !action?.movementDriven;
}

function hydratePkgVisuals() {
  stopPkgAnims();
  const p = pkg();
  const profileName = p?.baseProfile || 'character';
  const sheet = selectedPkgSheet();

  if (sheet?.assetId) {
    const prof = pkgMergedProf(sheet, profileName);
    const img = new Image();
    img.onload = () => {
      const objectMode = isObjectCharType(p?.metadata?.characterType);
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
  }

  $$('.pkg-dir-anim').forEach((card) => {
    const action = (p?.actions || []).find((a) => a.id === card.dataset.pkgAnim);
    if (!action) return;
    const sheetForAnim = resolveActionPreviewSheet(action, p);
    if (!sheetForAnim?.assetId) return;
    const canvas = $('canvas', card);
    const animName = pkgPreviewAnimName(action, sheetForAnim, profileName);
    const dirKey = card.dataset.dir || 'south';
    const holdFrame = pkgPreviewHoldFrame(action, p);
    if (canvas) {
      const stop = playPkgAnimOnCanvas(canvas, sheetForAnim, profileName, animName, dirKey, { holdFrame });
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
  const actionsAll = pkgActionsWithResolvablePreview(p);
  const objectMode = isObjectCharType(m.characterType);
  const pokemonMode = isPokemonCharType(m.characterType);
  const variantSheets = pokemonMode ? pokemonVariantSheetsFromPackage(p) : [];
  const walkSheets = pokemonMode ? pokemonWalkSheetsFromPackage(p) : [];
  if (pokemonMode) ensurePokemonSheetSelection(p);
  const sheet = selectedPkgSheet();
  const actions = filterActionsForPreview(p, actionsAll);
  const hasSheet = !!(sheet?.assetId);
  const variantPickerHtml = pokemonMode ? renderPokemonVariantPicker(variantSheets) : '';
  const variantSummary = pokemonMode ? summarizePokemonVariantMatrix(p) : null;

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
      <p>${sheets.length} sheet${sheets.length === 1 ? '' : 's'} · ${actionsAll.length} action${actionsAll.length === 1 ? '' : 's'}${variantSummary ? ` · ${variantSummary.formCount} form${variantSummary.formCount === 1 ? '' : 's'} · ${variantSummary.variantCombos} combo${variantSummary.variantCombos === 1 ? '' : 's'}` : ''} · .charbin${objectMode ? ' · object' : ''}</p>
    </div><button class="btn" id="pkgRename">Rename</button></div>
    ${infoHtml}
    <div class="section-title">Attached sheets</div>
    <div class="grid cols3" id="pkgSheetGrid">${sheetsHtml}</div>
    ${baseSection}
    <div class="section-title">Animations</div>
    ${pokemonMode && variantSheets.length <= 1 ? `<div class="card sidecard pkg-form-hint"><p class="tiny"><b>One variant in this file.</b> Use <b>Batch import</b> to add forms, shiny, swim, sleep, or eating sheets. Each walk import creates <code>idle</code> + <code>walk</code> actions (no auto <code>pause</code>).</p></div>` : ''}
    ${variantPickerHtml}
    <div id="pkgAnimGrid">${animsHtml}</div>`;

  right(`<div class="sidecard card"><h3>Package detail</h3>
    <p class="tiny"><b>Object</b>: non-moving map prop; <b>static</b> (frame 0) or <b>animate</b> (row 0). <b>Player/NPC</b>: 4-dir walk. <b>Pokémon</b>: walk cycle + pause.</p></div>`);

  $('#pkgBack').onclick = () => {
    if (isPokemonCharType(m.characterType)) {
      capturePokemonDetailVariant();
      capturePokemonLibraryUiFromDom(pkgState.selectedPath);
    }
    pkgState.panel = 'list';
    renderPackages();
  };
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
    el.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open();
      }
    };
  });
  bindPkgVariantPicker(variantSheets);
  hydratePkgVisuals();
  bindPkgActionInfoButtons($('#view'));
  void refreshPkgSheetMismatchBanner();
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
  else renderCharList();
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
