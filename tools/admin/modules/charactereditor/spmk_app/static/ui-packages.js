/* .charbin characters — expands legacy renderLibraryDetail layout */
/* Library search/filters: docs/LIBRARY_FILTERS.md — do not remove (see docs/AGENTS.md). */
const PKG_POKEMON_SPRITES_KEY = 'spmk.pkg.pokemonShowSprites';
const PKG_POKEMON_LIB_UI_KEY = 'spmk.pkg.pokemonLibUi';
const PKG_OBJECT_LIB_UI_KEY = 'spmk.pkg.objectLibUi';
const PKG_LIB_FILTERS_KEY = 'spmk.pkg.libFilters';

function defaultPkgLibFilters() {
  return { query: '', types: [], gens: [], cellSizes: [], sheetSizes: [], pokemonTypes: [], tags: [] };
}

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

let pkgLibFilters = loadPkgLibFilters();
let pkgLibFilterTimer = null;

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
  objectLibUi: null,
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

function loadObjectLibUi() {
  if (pkgState.objectLibUi) return pkgState.objectLibUi;
  try {
    const raw = localStorage.getItem(PKG_OBJECT_LIB_UI_KEY);
    pkgState.objectLibUi = raw ? JSON.parse(raw) : {};
  } catch {
    pkgState.objectLibUi = {};
  }
  return pkgState.objectLibUi;
}

function saveObjectLibUi(patch = {}) {
  const prev = loadObjectLibUi();
  const ui = { ...prev, ...patch };
  if (patch.openCats) ui.openCats = [...new Set(patch.openCats.map((x) => String(x)))];
  pkgState.objectLibUi = ui;
  try {
    localStorage.setItem(PKG_OBJECT_LIB_UI_KEY, JSON.stringify(ui));
  } catch { /* ignore */ }
  return ui;
}

function objectCatForEntryPath(list, path) {
  const entry = (list || []).find((x) => x.path === path);
  return entry ? objectCategoryId(entry) : null;
}

function captureObjectLibraryUiFromDom(path) {
  const view = $('#view');
  const root = $('.pkg-lib-objects');
  const patch = {
    scrollY: view?.scrollTop || 0,
    lastPath: path || pkgState.selectedPath || loadObjectLibUi().lastPath || null,
  };
  if (root) {
    patch.objectsOpen = root.open;
    patch.openCats = [];
    $$('.pkg-lib-obj-cat[data-cat]', root).forEach((details) => {
      if (details.open) patch.openCats.push(String(details.dataset.cat));
    });
  }
  if (path) {
    const list = pkgState.settings?.scannedPackages || [];
    const cat = objectCatForEntryPath(list, path);
    if (cat != null) {
      const cats = new Set([...(patch.openCats || []), ...(loadObjectLibUi().openCats || []), cat]);
      patch.openCats = [...cats];
      patch.objectsOpen = true;
    }
  }
  saveObjectLibUi(patch);
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
  if (pkgNeedsAddSheetModal(p)) {
    const cfg = await openAddSheetModal(p);
    if (!cfg) return;
    pkgPendingSheetAdd = cfg;
  } else if (isObjectCharType(p?.metadata?.characterType)) {
    pkgPendingSheetAdd = {
      mode: pkgHasPrimarySheet(p) ? 'replace_primary' : 'primary',
      label: '',
    };
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
  if (!p) return false;
  if (isObjectCharType(p?.metadata?.characterType)) return pkgHasPrimarySheet(p);
  return pkgHasAnySheetAsset(p);
}

function normalizeObjectModifiers(mods) {
  const raw = Array.isArray(mods) ? mods : (mods ? [mods] : []);
  const seen = new Set();
  const ordered = [];
  for (const m of raw) {
    const key = String(m || '').trim().toLowerCase().replace(/\s+/g, '_');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    ordered.push(key);
  }
  const known = ['shiny'].filter((k) => seen.has(k));
  const rest = ordered.filter((k) => !known.includes(k));
  return [...known, ...rest];
}

function objectSheetIdForModifiers(mods) {
  const m = normalizeObjectModifiers(mods);
  if (!m.length) return 'sheet';
  return `sheet_${m.join('_')}`;
}

function objectAppearanceLabel(mods) {
  const m = normalizeObjectModifiers(mods);
  if (!m.length) return 'Default';
  return m.map((x) => x.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())).join(', ');
}

function objectAppearanceDisplayName(sheet) {
  if (!sheet) return 'Default';
  const synced = syncObjectSheetFields(sheet);
  const custom = String(sheet.name || '').trim();
  if (custom) return custom;
  return objectAppearanceLabel(synced.modifiers);
}

function objectActionId(animationName, mods) {
  const anim = String(animationName || 'static').trim();
  const m = normalizeObjectModifiers(mods);
  if (!m.length) return anim;
  return `${anim}_${m.join('_')}`;
}

function normalizeClipName(raw) {
  const slug = slugFromName(raw);
  return slug === 'character' && !String(raw || '').trim() ? '' : slug;
}

function objectClipNameFromAction(action) {
  if (action?.animationName) return String(action.animationName).trim();
  const id = String(action?.id || '').trim();
  const mods = normalizeObjectModifiers(action?.modifiers || []);
  if (!mods.length) return id;
  const suffix = `_${mods.join('_')}`;
  if (id.endsWith(suffix)) return id.slice(0, -suffix.length) || id;
  return id;
}

function renameObjectSheetClip(sheet, oldAnimName, newAnimName) {
  if (!sheet || !oldAnimName || oldAnimName === newAnimName) return sheet;
  const out = { ...sheet, animations: { ...(sheet.animations || {}) } };
  if (out.animations[oldAnimName]) {
    out.animations[newAnimName] = out.animations[oldAnimName];
    delete out.animations[oldAnimName];
  }
  const suppressed = [...(out.suppressedAnimations || [])];
  const si = suppressed.indexOf(oldAnimName);
  if (si >= 0) {
    suppressed[si] = newAnimName;
    out.suppressedAnimations = suppressed;
  } else if (out.suppressedAnimations) {
    out.suppressedAnimations = suppressed;
  }
  if (!Object.keys(out.animations || {}).length) delete out.animations;
  return out;
}

function syncObjectSheetFields(sheet) {
  if (!sheet) return sheet;
  const mods = normalizeObjectModifiers(sheet.modifiers || []);
  const id = objectSheetIdForModifiers(mods);
  return {
    ...sheet,
    modifiers: mods,
    id: sheet.id && !String(sheet.id).startsWith('sheet') ? sheet.id : id,
    name: sheet.name || objectAppearanceLabel(mods),
  };
}

function objectSheetsFromPackage(p) {
  return (p?.spriteSheets || [])
    .filter((s) => s.assetId)
    .map((s) => syncObjectSheetFields(s));
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
  if (objectMode) {
    if (!hasPrimary) {
      return [['primary', 'Add sprite sheet', 'First 4×4 PNG for this object.']];
    }
    return [
      ['replace_primary', 'Replace sprite', 'Upload a new PNG for the default appearance.'],
      ['object_appearance', 'Add appearance', 'Another look for the same object — upload a separate sheet PNG.'],
    ];
  }
  if (!hasPrimary) return PKG_ADD_SHEET_MODES;
  const replaceLabel = 'Replace walk sheet';
  const replaceHint = 'Upload a corrected walk cycle — replaces the <code>walk</code> PNG and resets idle/walk actions. Other sheets are kept.';
  return [
    [PKG_ADD_SHEET_MODES[1][0], replaceLabel, replaceHint],
    PKG_ADD_SHEET_MODES[0],
  ];
}

function openAddSheetModal(p) {
  const modes = addSheetModalModes(p);
  const objectMode = isObjectCharType(p?.metadata?.characterType);
  const defaultMode = objectMode
    ? 'replace_primary'
    : (pkgHasOnlyPrimarySheet(p) ? 'replace_primary' : 'custom_anim');
  const modeRadios = modes.map(([val, title, hint]) => `
    <label class="check pkg-add-sheet-mode">
      <input type="radio" name="pkgAddSheetMode" value="${esc(val)}" ${val === defaultMode ? 'checked' : ''}>
      <span><b>${esc(title)}</b><br><span class="tiny">${hint}</span></span>
    </label>`).join('');
  const html = `<div class="modal card">${modalHead('Add or replace sheet')}
    <p class="tiny">Adds a charbin sheet with embedded PNG, per-sheet animation timing, and action records — same schema for player, NPC, and Pokémon.</p>
    <div class="pkg-add-sheet-modes">${modeRadios}</div>
    <div class="field" id="pkgAddSheetLabelRow">
      <label id="pkgAddSheetLabelCaption">Animation name</label>
      <input class="input" id="pkgAddSheetLabel" placeholder="run · bike · wave · sleep">
      <p class="tiny" id="pkgAddSheetLabelHint">Becomes sheet id and action id (e.g. <code>run</code> → sheet <code>run</code>).</p>
    </div>
    <div id="pkgAddSheetCustomOpts" class="pkg-add-sheet-custom" hidden>
      <div class="field"><label>Sheet layout</label>
        <select class="select" id="pkgAddSheetAnimKind">
          <option value="movement">Movement — 4 directions (one row per facing)</option>
          <option value="session">Session — enter / stay / exit (4 directions)</option>
          <option value="idle">Idle / emote — hold pose on each row</option>
          <option value="south_only">South row only — single-facing loop</option>
        </select>
      </div>
      <div id="pkgAddSheetLoopOpts">
        <label class="check" id="pkgAddSheetIdleRow"><input type="checkbox" id="pkgAddSheetIncludeIdle"> Include idle on this sheet (frame 0 stand)</label>
        <div class="grid cols2">
          <div class="field"><label>Frames (columns)</label><input class="input" id="pkgAddSheetFrames" type="number" min="1" max="4" value="4"></div>
          <div class="field"><label>Frame time (ms)</label><input class="input" id="pkgAddSheetFrameMs" type="number" min="50" value="120"></div>
        </div>
      </div>
      <div id="pkgAddSheetSessionOpts" class="pkg-add-sheet-session" hidden>
        <p class="tiny">One row per facing. Enter plays forward, stay holds, exit plays backward.</p>
        <div class="grid cols3">
          <div class="field"><label>Enter columns</label><input class="input" id="pkgAddSheetEnterFrames" value="0, 1, 2, 3" placeholder="0, 1, 2, 3"></div>
          <div class="field"><label>Stay column</label><input class="input" id="pkgAddSheetStayFrames" value="3" placeholder="3"></div>
          <div class="field"><label>Exit columns</label><input class="input" id="pkgAddSheetExitFrames" value="3, 2, 1, 0" placeholder="3, 2, 1, 0"></div>
        </div>
        <div class="field"><label>Frame time (ms)</label><input class="input" id="pkgAddSheetSessionMs" type="number" min="50" value="120"></div>
      </div>
    </div>
    ${modalFoot('<button type="button" class="btn" id="pkgAddSheetCancel">Cancel</button>', '<button type="button" class="btn primary" id="pkgAddSheetOk">Next: choose PNG</button>')}
  </div>`;
  const m = mountModal(html, { backdropClose: true });
  const labelRow = $('#pkgAddSheetLabelRow', m.root);
  const customRow = $('#pkgAddSheetCustomOpts', m.root);
  const idleRow = $('#pkgAddSheetIdleRow', m.root);
  const loopRow = $('#pkgAddSheetLoopOpts', m.root);
  const sessionRow = $('#pkgAddSheetSessionOpts', m.root);
  const animKindSel = $('#pkgAddSheetAnimKind', m.root);
  const syncCustomKind = () => {
    const kind = animKindSel?.value || 'movement';
    const isSession = kind === 'session';
    if (idleRow) idleRow.style.display = kind === 'movement' ? '' : 'none';
    if (loopRow) loopRow.hidden = isSession;
    if (sessionRow) sessionRow.hidden = !isSession;
  };
  const syncMode = () => {
    const mode = $('input[name="pkgAddSheetMode"]:checked', m.root)?.value || 'custom_anim';
    const isAnim = mode === 'custom_anim';
    const isAppearance = mode === 'object_appearance';
    labelRow.style.display = mode === 'replace_primary' ? 'none' : '';
    if (customRow) customRow.hidden = !isAnim;
    const cap = $('#pkgAddSheetLabelCaption', m.root);
    const hint = $('#pkgAddSheetLabelHint', m.root);
    const labelInput = $('#pkgAddSheetLabel', m.root);
    if (isAppearance) {
      if (cap) cap.textContent = 'Appearance id';
      if (hint) hint.innerHTML = 'Modifier id for this look (e.g. <code>shiny</code>).';
      if (labelInput) labelInput.placeholder = 'shiny';
    } else if (!isAnim) {
      if (cap) cap.textContent = 'Animation name';
      if (hint) hint.innerHTML = 'Becomes sheet id and action id.';
    } else {
      if (cap) cap.textContent = 'Animation name';
      if (hint) hint.innerHTML = 'Becomes sheet id and action id (e.g. <code>run</code> → sheet <code>run</code>).';
      if (labelInput) labelInput.placeholder = 'run · bike · wave · sleep';
    }
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
      if (mode !== 'replace_primary' && mode !== 'primary' && !label) {
        toast(mode === 'object_appearance' ? 'Enter an appearance id' : 'Enter an animation name');
        return;
      }
      const animKind = $('#pkgAddSheetAnimKind', m.root)?.value || 'movement';
      const isSession = animKind === 'session';
      finish({
        mode,
        label,
        animKind,
        includeIdle: !!$('#pkgAddSheetIncludeIdle', m.root)?.checked,
        frameCount: Math.max(1, Math.min(4, Number($('#pkgAddSheetFrames', m.root)?.value) || 4)),
        frameTimeMs: Math.max(50, Number(
          isSession ? $('#pkgAddSheetSessionMs', m.root)?.value : $('#pkgAddSheetFrameMs', m.root)?.value,
        ) || 120),
        sessionEnterFrames: ($('#pkgAddSheetEnterFrames', m.root)?.value || '').trim(),
        sessionStayFrames: ($('#pkgAddSheetStayFrames', m.root)?.value || '').trim(),
        sessionExitFrames: ($('#pkgAddSheetExitFrames', m.root)?.value || '').trim(),
      });
    };
  });
}

function addSheetToast(mode, sheetId, scaled, animKind) {
  const scaleNote = scaled ? ' (scaled 64px→32px cells)' : '';
  if (mode === 'object_appearance') return `Appearance sheet added: ${sheetId}${scaleNote}`;
  if (animKind === 'session') return `Session activity added: ${sheetId}${scaleNote}`;
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
    sessionEnterFrames: '',
    sessionStayFrames: '',
    sessionExitFrames: '',
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
    if (opts.animKind === 'session') {
      fd.append('sessionEnterFrames', opts.sessionEnterFrames || '0,1,2,3');
      fd.append('sessionStayFrames', opts.sessionStayFrames || '3');
      fd.append('sessionExitFrames', opts.sessionExitFrames || '3,2,1,0');
    }
  } else if (opts.mode === 'object_appearance') {
    fd.append('label', opts.label || '');
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
    toast(addSheetToast(opts.mode, body.sheetId || '', scaled, opts.animKind));
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

const POKEMON_SIZE_OPTIONS = [
  ['small', 'Small', '32px'],
  ['human', 'Human', '32px trainer scale'],
  ['medium', 'Medium', '40px'],
  ['large', 'Large', '64px'],
];

function normalizePokemonSize(size) {
  const s = String(size || 'small').toLowerCase();
  if (s === 'large' || s === 'medium' || s === 'human') return s;
  return 'small';
}

function readPokemonSize(p, m) {
  if (m?.pokemonSize) return normalizePokemonSize(m.pokemonSize);
  const prof = p?.baseProfile || '';
  if (prof === 'pokemon_large') return 'large';
  if (prof === 'character') return 'human';
  const sheet = (p?.spriteSheets || []).find((s) => s.assetId);
  if (sheet) {
    const cell = pkgEffectiveCellSize(sheet);
    if (cell >= 64) return 'large';
    if (cell >= 36) return 'medium';
  }
  return 'small';
}

function pokemonSizeProfileLabel(size) {
  const hit = POKEMON_SIZE_OPTIONS.find(([v]) => v === size);
  return hit ? `${hit[1]} · ${hit[2]}` : size;
}

function pokemonSizeToProfile(size) {
  const s = normalizePokemonSize(size);
  if (s === 'large') return 'pokemon_large';
  if (s === 'human') return 'character';
  return 'pokemon_small';
}

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
  if (pokemon) {
    $$('[data-pokemon-hide-profile]').forEach((el) => el.classList.add('pkg-field-hidden'));
  }
  if (object && $('#pkgProfile')?.value === 'character') {
    $('#pkgProfile').value = 'object';
  }
}

async function loadPackageContext() {
  let lib = await api('/api/packages/library');
  const needsWalkMeta = (lib.packages || []).some((e) => !e.error && e.hasThumb && e.walkCellWidth == null);
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
  return pkgDefaultFrameSize(sheet).fw;
}

function pkgDefaultFrameSize(sheet) {
  const prof = profileDef(sheet?.profile || pkg()?.baseProfile);
  const fw = Number(prof.frameWidth) || 32;
  const fh = Number(prof.frameHeight) || fw;
  return { fw, fh };
}

function pkgEffectiveFrameSize(sheet) {
  const merged = pkgMergedProf(sheet);
  return { fw: merged.frameWidth, fh: merged.frameHeight };
}

function pkgEffectiveCellSize(sheet) {
  return pkgEffectiveFrameSize(sheet).fw;
}

function pkgFrameSizeLabel(sheet) {
  const { fw, fh } = pkgEffectiveFrameSize(sheet);
  return `${fw}×${fh}px`;
}

function pkgSheetHasCustomFrameSize(sheet) {
  const o = sheet?.profileOverrides || {};
  if (o.frameWidth != null || o.frameHeight != null) return true;
  const { fw, fh } = pkgEffectiveFrameSize(sheet);
  const def = pkgDefaultFrameSize(sheet);
  return fw !== def.fw || fh !== def.fh;
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
  }
  const { fw, fh } = pkgExpectedFrameSizeForSheet(next, width, height);
  const def = pkgDefaultFrameSize(next);
  const overrides = { ...(next.profileOverrides || {}) };
  if (fw === def.fw && fh === def.fh) {
    delete overrides.frameWidth;
    delete overrides.frameHeight;
  } else {
    overrides.frameWidth = fw;
    overrides.frameHeight = fh;
  }
  if (Object.keys(overrides).length) next.profileOverrides = overrides;
  else delete next.profileOverrides;
  return next;
}

function pkgExpectedFrameSizeForSheet(sheet, width, height) {
  const p = pkg();
  const prof = sheet?.profile || p?.baseProfile || 'character';
  const merged = pkgMergedProf(sheet);
  const cols = merged.columns || 4;
  const rows = merged.rows || 4;
  const fw = Math.round(width / cols);
  const fh = Math.round(height / rows);
  if (prof === 'pokemon_small' || prof === 'pokemon_large') {
    const layout = pkgInferPokemonLayout(width, height);
    if (fw === fh) return { fw: layout.cell, fh: layout.cell };
  }
  return { fw, fh };
}

function pkgExpectedCellForSheet(sheet, width, height) {
  return pkgExpectedFrameSizeForSheet(sheet, width, height).fw;
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
      const configured = pkgEffectiveFrameSize(sheet);
      const expected = pkgExpectedFrameSizeForSheet(sheet, width, height);
      if (configured.fw !== expected.fw || configured.fh !== expected.fh) {
        mismatches.push({
          sheetId: sheet.id,
          sheetName: sheet.name || sheet.id,
          width,
          height,
          configuredFw: configured.fw,
          configuredFh: configured.fh,
          expectedFw: expected.fw,
          expectedFh: expected.fh,
          configuredCell: configured.fw,
          expectedCell: expected.fw,
        });
      }
    } catch (_) { /* skip unreadable sheets */ }
  }));
  return mismatches.sort((a, b) => String(a.sheetId).localeCompare(String(b.sheetId)));
}

function renderPkgSheetMismatchBanner(mismatches) {
  if (!mismatches?.length) return '';
  const items = mismatches.map((m) => {
    const exp = m.expectedFw != null && m.expectedFh != null
      ? `${m.expectedFw}×${m.expectedFh}px`
      : `${m.expectedCell}px`;
    const cur = m.configuredFw != null && m.configuredFh != null
      ? `${m.configuredFw}×${m.configuredFh}px`
      : `${m.configuredCell}px`;
    return `<li><b>${esc(m.sheetName || m.sheetId)}</b> — PNG ${m.width}×${m.height}px needs ${exp} cells; currently ${cur}</li>`;
  }).join('');
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

function deepMergePatch(base, patch) {
  const out = { ...base };
  for (const [key, val] of Object.entries(patch || {})) {
    if (val && typeof val === 'object' && !Array.isArray(val) && typeof out[key] === 'object' && out[key] && !Array.isArray(out[key])) {
      out[key] = deepMergePatch(out[key], val);
    } else if (val !== undefined) {
      out[key] = val;
    }
  }
  return out;
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
    baseProfile: pokemon
      ? pokemonSizeToProfile($('#pkgPokemonSize')?.value || readPokemonSize(p, m))
      : ($('#pkgProfile')?.value || (object ? 'object' : 'character')),
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
      objectCategory: object ? ($('#pkgObjectCategory')?.value || DEFAULT_OBJECT_CATEGORY) : '',
      pokemonId: pokemon ? (Number($('#pkgNationalId')?.value) || null) : null,
      speciesName: pokemon ? ($('#pkgSpeciesName')?.value || '').trim() : '',
      forms: pokemon ? forms : [],
      selectedFormId: pokemon ? ($('#pkgFormId')?.value || 'default') : 'default',
      originGame: pokemon ? ($('#pkgOriginGame')?.value || '').trim() : (m.originGame || ''),
      pokedexEntry: pokemon ? ($('#pkgPokedex')?.value || '').trim() : '',
      pokemonTypes: pokemon ? parseList($('#pkgPokemonTypes')?.value) : [],
      pokemonSize: pokemon ? normalizePokemonSize($('#pkgPokemonSize')?.value || readPokemonSize(p, m)) : undefined,
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
  const form = collectDetailForm();
  const intelPatch = typeof collectNpcIntelDraftPatch === 'function' ? collectNpcIntelDraftPatch() : {};
  await saveDraft(deepMergePatch(form, intelPatch));
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
  const show = pokemonLibraryShowSprites();
  const pokemon = partitionLibrary(applyPkgLibFilters(list)).pokemon;
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
    bindCardOpen(el, () => {
      if (state.generatePickMode && typeof selectGenerateCharacter === 'function') {
        selectGenerateCharacter(el.dataset.path);
        return;
      }
      openCharacter(el.dataset.path);
    }, 'charbins', el.dataset.path, rerender);
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
  const pokemon = partitionLibrary(applyPkgLibFilters(list)).pokemon;
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
  if (!root || $('.pkg-lib-pokemon-flat', root)) return;
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

const OBJECT_CATEGORIES = [
  { id: 'interactables', label: 'Interactables' },
  { id: 'animations', label: 'Animations' },
  { id: 'ui', label: 'UI' },
  { id: 'others', label: 'Others' },
];
const DEFAULT_OBJECT_CATEGORY = 'others';

function objectCategoryId(entry) {
  const raw = String(entry?.objectCategory ?? '').trim().toLowerCase();
  return OBJECT_CATEGORIES.some((c) => c.id === raw) ? raw : DEFAULT_OBJECT_CATEGORY;
}

function objectCategoryLabel(id) {
  return OBJECT_CATEGORIES.find((c) => c.id === objectCategoryId({ objectCategory: id }))?.label || 'Others';
}

function groupObjectsByCategory(entries) {
  const buckets = new Map();
  for (const e of entries) {
    const cid = objectCategoryId(e);
    if (!buckets.has(cid)) buckets.set(cid, { id: cid, label: objectCategoryLabel(cid), entries: [] });
    buckets.get(cid).entries.push(e);
  }
  return OBJECT_CATEGORIES.map((row) => buckets.get(row.id)).filter((g) => g?.entries?.length);
}

function buildObjectCatGrid(entries, sel) {
  return `<div class="grid cols3">${entries.map((e) => charbinCard(e, { selectScope: sel ? 'charbins' : null, selected: isSelected('charbins', e.path) })).join('')}</div>`;
}

function mountObjectCatBody(details, list, rerender) {
  const host = $('.pkg-lib-obj-cat-body', details);
  if (!host || host.dataset.rendered) return;
  const objects = partitionLibrary(list).objects;
  const groups = groupObjectsByCategory(objects);
  const cat = String(details.dataset.cat);
  const g = groups.find((x) => x.id === cat);
  if (!g?.entries?.length) return;
  host.innerHTML = buildObjectCatGrid(g.entries, isSelectMode('charbins'));
  host.dataset.rendered = '1';
  bindCharbinLibraryCards(host, list, rerender);
}

function restoreObjectLibraryUiAfterRender(list, rerender) {
  const ui = loadObjectLibUi();
  const root = $('.pkg-lib-objects');
  if (!root) return;
  $$('.pkg-lib-obj-cat[data-cat]', root).forEach((details) => {
    if (details.open) mountObjectCatBody(details, list, rerender);
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

function bindObjectLibraryLazy(list, rerender) {
  const root = $('.pkg-lib-objects');
  if (!root) return;
  if (!root.dataset.libUiBound) {
    root.dataset.libUiBound = '1';
    root.addEventListener('toggle', () => {
      const openCats = [];
      $$('.pkg-lib-obj-cat[data-cat]', root).forEach((d) => {
        if (d.open) openCats.push(String(d.dataset.cat));
      });
      saveObjectLibUi({ objectsOpen: root.open, openCats });
    });
  }
  $$('.pkg-lib-obj-cat[data-cat]', root).forEach((details) => {
    if (details.dataset.lazyBound) return;
    details.dataset.lazyBound = '1';
    details.addEventListener('toggle', () => {
      const openCats = [];
      $$('.pkg-lib-obj-cat[data-cat]', root).forEach((d) => {
        if (d.open) openCats.push(String(d.dataset.cat));
      });
      saveObjectLibUi({ objectsOpen: root.open, openCats });
      if (!details.open) return;
      mountObjectCatBody(details, list, rerender);
    });
  });
}

function renderObjectLibrarySection(entries, sel) {
  if (!entries.length) return '';
  const groups = groupObjectsByCategory(entries);
  const ui = loadObjectLibUi();
  const openCats = new Set((ui.openCats || []).map(String));
  const catHtml = groups.map((g, idx) => {
    const rule = idx > 0 ? '<div class="pkg-lib-gen-rule" role="separator"></div>' : '';
    const catOpen = openCats.has(g.id) ? ' open' : '';
    return `${rule}<details class="pkg-lib-gen pkg-lib-obj-cat" data-cat="${esc(g.id)}"${catOpen}>
      <summary class="pkg-lib-gen-summary"><span>${esc(g.label)}</span><span class="pkg-lib-gen-count">${g.entries.length}</span></summary>
      <div class="pkg-lib-obj-cat-body" data-lazy-cat="1"></div>
    </details>`;
  }).join('');
  const objectsOpen = ui.objectsOpen ? ' open' : '';
  return `<details class="pkg-lib-collapse pkg-lib-objects"${objectsOpen}>
    <summary class="pkg-lib-collapse-summary"><span class="section-title inline">Objects</span><span class="pkg-lib-gen-count">${entries.length}</span></summary>
    <div class="pkg-lib-objects-body">${catHtml}</div>
  </details>`;
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
  if (f.gens.length) {
    if (pkgLibEntryTypeKey(entry) === 'pokemon'
      && !f.gens.includes(String(pkgLibEntryGeneration(entry)))) return false;
  }
  if (f.cellSizes.length) {
    const bucket = pkgLibCellSizeBucket(entry);
    if (bucket === 'unknown' || !f.cellSizes.includes(bucket)) return false;
  }
  if (f.sheetSizes.length) {
    const buckets = (entry.sheetSizeBuckets || []).map(String);
    if (!f.sheetSizes.some((b) => buckets.includes(b))) return false;
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

function togglePkgLibFilter(kind, value) {
  const arr = pkgLibFilters[kind];
  if (!Array.isArray(arr)) return;
  const i = arr.indexOf(value);
  if (i >= 0) arr.splice(i, 1);
  else arr.push(value);
}

function bindPkgLibFilterModalChips(modalRoot) {
  $$('.pkg-lib-filter-chip', modalRoot).forEach((btn) => {
    btn.onclick = () => {
      togglePkgLibFilter(btn.dataset.filterKind, btn.dataset.filterValue);
      const active = (pkgLibFilters[btn.dataset.filterKind] || []).includes(btn.dataset.filterValue);
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', String(active));
      const countEl = $('#pkgLibModalActiveCount', modalRoot);
      if (countEl) countEl.textContent = String(pkgLibActiveFilterCount());
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
      bindPkgLibFilterModalChips(m.root);
    }
    const countEl = $('#pkgLibModalActiveCount', m.root);
    if (countEl) countEl.textContent = String(pkgLibActiveFilterCount());
  };
  bindPkgLibFilterModalChips(m.root);
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
    <input class="input pkg-lib-search" id="pkgLibSearch" type="search" placeholder="Search name, dex #, tags, cell size, sheet dimensions…" value="${esc(f.query)}" autocomplete="off" spellcheck="false"/>
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

function renderPokemonLibrarySection(entries, sel) {
  if (!entries.length) return '';
  const flat = pkgLibPokemonFlatMode();
  const ui = loadPokemonLibUi();
  const openGens = new Set((ui.openGens || []).map(Number));
  const spritesOn = pokemonLibraryShowSprites();
  const spriteToggle = `<label class="check pkg-lib-poke-sprite-toggle" title="Loads preview sprites for visible rows">
    <input type="checkbox" id="pkgPokemonShowSprites"${spritesOn ? ' checked' : ''}>
    Show sprites${flat ? '' : ' (visible rows)'}
  </label>`;
  let inner;
  if (flat) {
    inner = `<div class="pkg-lib-pokemon-toolbar">${spriteToggle}</div>
      <div class="pkg-lib-pokemon-flat">${buildPokemonGenGrid(entries, sel, spritesOn)}</div>`;
  } else {
    const groups = groupPokemonByGeneration(entries);
    const genHtml = groups.map((g, idx) => {
      const rule = idx > 0 ? '<div class="pkg-lib-gen-rule" role="separator"></div>' : '';
      const genOpen = openGens.has(g.gen) ? ' open' : '';
      return `${rule}<details class="pkg-lib-gen" data-gen="${g.gen}"${genOpen}>
        <summary class="pkg-lib-gen-summary"><span>${esc(g.label)}</span><span class="pkg-lib-gen-count">${g.entries.length}</span></summary>
        <div class="pkg-lib-gen-body" data-lazy-gen="1"></div>
      </details>`;
    }).join('');
    inner = `<div class="pkg-lib-pokemon-toolbar">${spriteToggle}</div>${genHtml}`;
  }
  const flatHint = flat ? ' <span class="tag">filtered view</span>' : '';
  const pokemonOpen = flat || ui.pokemonOpen ? ' open' : '';
  return `<details class="pkg-lib-collapse pkg-lib-pokemon"${pokemonOpen}>
    <summary class="pkg-lib-collapse-summary"><span class="section-title inline">Pokémon</span><span class="pkg-lib-gen-count">${entries.length}</span>${flatHint}</summary>
    <div class="pkg-lib-pokemon-body">${inner}</div>
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

function highlightGeneratePickTarget(path) {
  if (!path || !state.generatePickMode) return;
  requestAnimationFrame(() => {
    $$('.character[data-path]').forEach((el) => {
      el.classList.toggle('gen-pick-active', el.dataset.path === path);
    });
    const card = $$(`.character[data-path]`).find((el) => el.dataset.path === path);
    card?.scrollIntoView({ block: 'nearest' });
  });
}

function renderCharList() {
  initSelectState();
  pkgState.panel = 'list';
  stopPkgAnims();
  const fullList = pkgState.settings?.scannedPackages || [];
  const pickGen = !!state.generatePickMode;
  const genPick = pickGen && typeof ensureGenCharbinState === 'function' ? ensureGenCharbinState() : null;
  const { pokemon: allPokemon } = partitionLibrary(fullList);
  let pokemonEntries = allPokemon;
  if (pickGen && genPick?.missingOnly && genPick.targets?.length) {
    const paths = new Set(genPick.targets.map((t) => t.path));
    pokemonEntries = allPokemon.filter((e) => paths.has(e.path));
  }
  const sel = pickGen ? false : isSelectMode('charbins');
  if (pickGen) {
    title('Choose Pokémon');
    const beh = genPick?.outputBehavior || 'swim';
    const filterNote = genPick?.missingOnly ? ' · missing only' : '';
    toolbar(`<button class="btn" id="genPickBack">← Back to Generate</button><span class="tag">Generate ${esc(beh)}${esc(filterNote)}</span>`);
    const pickBanner = `<div class="card sidecard gen-pick-banner"><p class="tiny">Click a Pokémon in the library to generate its <b>${esc(beh)}</b> sheet.</p></div>`;
    const body = pokemonEntries.length
      ? `<div class="gen-pick-mode">${renderPokemonLibrarySection(pokemonEntries, false)}</div>`
      : `<div class="empty"><strong>No matching Pokémon.</strong><br/>Try turning off “Only missing slots” on Generate, or train the model first.</div>`;
    $('#view').innerHTML = `${pickBanner}<div class="section-head"><span class="section-title inline">Pokémon</span></div>${body}`;
    right(`<div class="sidecard card"><h3>Generate pick</h3>
      <p>Same library as Characters — click a card to return to Generate with that Pokémon selected.</p>
      ${genPick ? `<p class="tiny">Sheet: <code>${esc(beh)}</code><br/>${genPick.missingOnly ? 'Filtered to missing slots.' : 'All Pokémon shown.'}</p>` : ''}
      <button type="button" class="btn full" id="genPickBackSide">← Back to Generate</button></div>`);
    const back = () => {
      state.generatePickMode = false;
      state.view = 'generate';
      renderNav();
      if (typeof renderGenerate === 'function') renderGenerate();
    };
    $('#genPickBack').onclick = back;
    $('#genPickBackSide').onclick = back;
    bindCharbinLibraryCards($('#view'), fullList, renderPackages);
    bindPokemonLibraryLazy(fullList, renderPackages);
    bindPokemonSpriteToggle(fullList, renderPackages);
    restorePokemonLibraryUiAfterRender(fullList, renderPackages);
    highlightGeneratePickTarget(genPick?.targetPath);
    return;
  }
  title('Characters');
  toolbar('<button class="btn primary" id="pkgCreateCharacter">Create character</button><button class="btn" id="pkgImportCharacter">Import</button>');
  const list = applyPkgLibFilters(fullList);
  const { playable, characters, pokemon, objects } = partitionLibrary(list);
  const filterBar = renderPkgLibSearchBar(fullList, list);
  const sections = [
    renderLibrarySection('Playable', playable, sel),
    renderLibrarySection('Characters', characters, sel),
    renderPokemonLibrarySection(pokemon, sel),
    renderObjectLibrarySection(objects, sel),
  ].filter(Boolean).join('');
  const body = sections || (fullList.length
    ? '<div class="empty"><strong>No matches.</strong><br/>Try clearing filters or broadening your search.</div>'
    : '<div class="empty"><strong>No packages yet.</strong><br/>Create a package or import a .charbin file.</div>');
  $('#view').innerHTML = `${filterBar}${bulkBar('charbins')}${sectionHead('Library', 'charbins')}${body}`;
  right(`<div class="sidecard card pkg-library-settings"><h3>Library</h3><p>Saved under <code>playable/</code>, <code>npc/</code>, <code>pokemon/</code>, <code>objects/</code>.</p>
    <p class="tiny pkg-lib-path">${esc(pkgState.settings?.packageDirectory || '')}</p>
    <div class="btn-row" style="margin-top:8px">
      <button type="button" class="btn small" id="pkgChangeDir">Change folder…</button>
      <button type="button" class="btn small" id="pkgResetDir">Reset default</button>
    </div>
    <p class="tiny">Schema: <code>CHARBIN_SCHEMA.md</code> is copied into the library folder for C++.</p></div>`);

  $('#pkgChangeDir').onclick = () => changePackageDirectory();
  $('#pkgResetDir').onclick = () => resetPackageDirectory();
  $('#pkgCreateCharacter').onclick = openCharacterCreateModal;
  $('#pkgImportCharacter').onclick = openPkgImportMenu;
  bindSelectMode('charbins', renderPackages, bulkDeleteCharbins);
  bindPkgLibSearchBar(fullList);
  bindCharbinLibraryCards($('#view'), fullList, renderPackages);
  bindPokemonLibraryLazy(fullList, renderPackages);
  bindPokemonSpriteToggle(fullList, renderPackages);
  bindObjectLibraryLazy(fullList, renderPackages);
  restorePokemonLibraryUiAfterRender(fullList, renderPackages);
  restoreObjectLibraryUiAfterRender(fullList, renderPackages);
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
    objectCategory: characterType === 'object' ? DEFAULT_OBJECT_CATEGORY : undefined,
    objectAnimated: characterType === 'object' ? false : undefined,
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

function openCharacterCreateModal() {
  const choices = [['player', 'Player'], ['npc', 'NPC'], ['pokemon', 'Pokemon'], ['object', 'Object']];
  const m = mountModal(`<div class="modal wide pkg-create-modal">
    ${modalHead('Create character')}
    <div class="pkg-create-type"><span>Character type</span><select class="select" id="pkgCreateKind">${choices.map(([id, label]) => `<option value="${id}"${id === 'npc' ? ' selected' : ''}>${label}</option>`).join('')}</select></div>
    <section class="pkg-create-section"><div class="pkg-create-section-head"><span class="pkg-create-step">1</span><div><h4>Overworld sheet</h4><p>Start with the sprite sheet you want to turn into a character.</p></div></div><label class="pkg-create-sheet" for="pkgCreateImage"><input id="pkgCreateImage" type="file" accept="image/png,image/webp"><span id="pkgCreateSheetPrompt">Choose a PNG or WebP sheet</span><img id="pkgCreateSheetPreview" alt="" hidden></label><p class="tiny" id="pkgCreateSheetMeta">A preview appears here before anything is sent.</p><div class="field" id="pkgCreateProfileInput"><label>Character profile JSON (optional)</label><textarea class="input pkg-desc-area" id="pkgCreateProfileJson" rows="7" placeholder='Paste a compact profile with character_name, role, dialogue, and the other configured fields.'></textarea><p class="tiny">A pasted profile is validated and loaded directly. It does not call the character model.</p></div></section>
    <section class="pkg-create-section" id="pkgCreateIdentity"></section>
    <section class="pkg-create-section pkg-create-generation" id="pkgCreateGeneration" hidden><div class="pkg-create-section-head"><span class="pkg-create-step">3</span><div><h4>Generation details</h4><p>Provider-visible summary and validation status for this request.</p></div></div><textarea class="input pkg-create-log" id="pkgCreateGenerationLog" rows="4" readonly></textarea></section>
    <section class="pkg-create-section" id="pkgCreatePreview" hidden><div class="pkg-create-section-head"><span class="pkg-create-step">4</span><div><h4 id="pkgCreatePreviewTitle">Proposed character</h4><p>Review this profile before making a draft.</p></div></div><div id="pkgCreateStats"></div><div id="pkgCreateReview"></div><details class="pkg-create-raw"><summary>Raw profile JSON</summary><textarea class="input pkg-desc-area" id="pkgCreateJson" rows="12" readonly></textarea></details></section>
    <section class="pkg-create-section pkg-create-error" id="pkgCreateError" hidden><div class="pkg-create-section-head"><span class="pkg-create-step">!</span><div><h4>Generation could not be used</h4><p id="pkgCreateErrorMessage"></p></div></div><details open><summary>Provider response and diagnostics</summary><textarea class="input pkg-desc-area" id="pkgCreateErrorRaw" rows="10" readonly></textarea></details></section>
  ${modalFoot('<button type="button" class="btn" id="pkgCreateCancel">Cancel</button>', '<button type="button" class="btn" id="pkgCreateFetch">Generate character</button><button type="button" class="btn primary" id="pkgCreateDraft" disabled>Create character</button>')}</div>`, { backdropClose: true, warnDirty: true });
  let guardActive = true;
  let allowHistoryLeave = false;
  const cleanupNavigationGuard = () => {
    if (!guardActive) return;
    guardActive = false;
    window.removeEventListener('beforeunload', onBeforeUnload);
    window.removeEventListener('popstate', onHistoryBack);
  };
  const onBeforeUnload = (event) => {
    if (!guardActive) return undefined;
    event.preventDefault();
    event.returnValue = '';
    return '';
  };
  const onHistoryBack = () => {
    if (!guardActive || allowHistoryLeave) return;
    if (window.confirm('Discard this character creation session and leave this page?')) {
      allowHistoryLeave = true;
      cleanupNavigationGuard();
      window.history.back();
      return;
    }
    window.history.pushState({ pkgCreateGuard: true }, '', window.location.href);
  };
  window.history.pushState({ pkgCreateGuard: true }, '', window.location.href);
  window.addEventListener('beforeunload', onBeforeUnload);
  window.addEventListener('popstate', onHistoryBack);
  const closeCreateModal = () => {
    if (!window.confirm('Discard this character creation session?')) return;
    cleanupNavigationGuard();
    m.close();
  };
  $('.modal-close', m.root).onclick = closeCreateModal;
  m.backdrop.onclick = (event) => { if (event.target === m.backdrop) closeCreateModal(); };
  const kind = $('#pkgCreateKind', m.root); let profile = null; let legacyIntel = null; let profileDiagnostics = null; let pokemon = null; let existingPackage = null;
  const fileStem = (file) => String(file?.name || '').replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
  const setLog = (lines) => { $('#pkgCreateGeneration', m.root).hidden = false; $('#pkgCreateGenerationLog', m.root).value = lines.filter(Boolean).join('\n'); };
  const reviewField = (label, value, wide = false) => `<div class="field${wide ? ' pkg-review-wide' : ''}"><label>${esc(label)}</label><input class="input" value="${escAttr(String(value ?? ''))}" readonly></div>`;
  const renderProfileReview = (data) => {
    const labelFor = (key) => key.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
    const valueField = (key, value) => {
      if (key === 'dialogue') return '';
      if (Array.isArray(value) || (value && typeof value === 'object') || key === 'description') return `<div class="field pkg-review-wide"><label>${esc(labelFor(key))}</label><textarea class="input pkg-desc-area" readonly>${esc(Array.isArray(value) ? value.join('\n') : (value && typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value ?? '')))}</textarea></div>`;
      return reviewField(labelFor(key), value == null ? 'None' : value);
    };
    const coreOrder = ['character_name', 'description', 'role', 'main_pokemon', 'additional_pokemon', 'source_game', 'source_region', 'badge_requirement', 'relationships'];
    const orderedKeys = [...coreOrder.filter((key) => Object.hasOwn(data, key)), ...Object.keys(data).filter((key) => !coreOrder.includes(key) && key !== 'dialogue')];
    const overview = `<div class="pkg-review-fields">${orderedKeys.map((key) => valueField(key, data[key])).join('')}</div>`;
    const dialogue = `<div class="pkg-review-dialogue">${(data.dialogue || []).map((line, i) => `<div class="pkg-review-dialogue-row"><span>${i + 1}</span><input class="input" value="${escAttr(line)}" readonly></div>`).join('')}</div>`;
    const tabs = [['overview', 'Profile'], ['dialogue', 'Dialogue']];
    $('#pkgCreateReview', m.root).innerHTML = `<div class="pkg-review-tabs" role="tablist">${tabs.map(([id, label], i) => `<button type="button" class="btn small${i ? '' : ' active'}" data-review-tab="${id}">${label}</button>`).join('')}</div>${tabs.map(([id]) => `<div class="pkg-review-panel" data-review-panel="${id}"${id === 'overview' ? '' : ' hidden'}>${id === 'overview' ? overview : dialogue}</div>`).join('')}`;
    $$('[data-review-tab]', m.root).forEach((button) => button.onclick = () => { $$('[data-review-tab]', m.root).forEach((item) => item.classList.toggle('active', item === button)); $$('[data-review-panel]', m.root).forEach((panel) => { panel.hidden = panel.dataset.reviewPanel !== button.dataset.reviewTab; }); });
  };
  const syncProfileSource = () => {
    const isNpc = kind.value === 'npc';
    const hasPastedProfile = !!$('#pkgCreateProfileJson', m.root)?.value?.trim();
    $('#pkgCreateProfileInput', m.root).hidden = !isNpc;
    $('#pkgCreateFetch', m.root).textContent = isNpc ? (hasPastedProfile ? 'Load profile' : 'Generate character') : (kind.value === 'pokemon' ? 'Fetch Pokemon info' : 'Prepare character');
  };
  const applyNpcProfile = (rawProfile, adaptedIntel, diagnostics = {}) => {
    if (!rawProfile?.character_name) throw new Error('Pasted profiles must use the compact character profile schema and include character_name.');
    profile = rawProfile; legacyIntel = adaptedIntel; profileDiagnostics = diagnostics;
    const nameInput = $('#pkgCreateName', m.root);
    nameInput.value = profile.character_name || nameInput.value;
    existingPackage = (pkgState.settings?.scannedPackages || []).find((entry) => entry.id === slugFromName(profile.character_name) && entry.characterType === 'npc') || null;
    $('#pkgCreateGeneratedId', m.root).textContent = `Generated id: ${slugFromName(profile.character_name)}`; $('#pkgCreateGeneratedId', m.root).hidden = false;
    $('#pkgCreateStats', m.root).innerHTML = statCards([['Name', profile.character_name || 'Unknown'], ['Role', profile.role || 'Unknown'], ['Main Pokemon', profile.main_pokemon || 'None'], ['Dialogue', profile.dialogue?.length || 0]]);
    renderProfileReview(profile); $('#pkgCreateJson', m.root).value = JSON.stringify(profile, null, 2); $('#pkgCreatePreviewTitle', m.root).textContent = existingPackage ? 'Replace existing character' : 'Proposed character'; $('#pkgCreatePreview', m.root).hidden = false; $('#pkgCreateDraft', m.root).disabled = false; $('#pkgCreateDraft', m.root).textContent = existingPackage ? 'Replace NPC' : 'Create NPC';
  };
  const resetResult = () => { profile = null; legacyIntel = null; profileDiagnostics = null; pokemon = null; existingPackage = null; $('#pkgCreatePreview', m.root).hidden = true; $('#pkgCreateError', m.root).hidden = true; $('#pkgCreateGeneration', m.root).hidden = true; $('#pkgCreateDraft', m.root).disabled = true; };
  const showFailure = (err) => {
    const detail = err?.detail || {}; const diagnostics = detail.diagnostics || {};
    $('#pkgCreateErrorMessage', m.root).textContent = detail.message || err.message || 'The provider did not return a usable profile.';
    $('#pkgCreateErrorRaw', m.root).value = [
      diagnostics.rawOutput && `Raw output:\n${diagnostics.rawOutput}`,
      diagnostics.reasoningSummary && `Provider summary:\n${diagnostics.reasoningSummary}`,
      diagnostics.responseId && `Response id: ${diagnostics.responseId}`,
      diagnostics.status && `Status: ${diagnostics.status}`,
      diagnostics.incompleteReason && `Incomplete reason: ${diagnostics.incompleteReason}`,
      diagnostics.requestedMaxOutputTokens && `Requested output budget: ${diagnostics.requestedMaxOutputTokens} tokens`,
      diagnostics.httpStatus && `HTTP status: ${diagnostics.httpStatus}`,
      (diagnostics.validationErrors || []).length && `Validation: ${(diagnostics.validationErrors || []).join('; ')}`,
    ].filter(Boolean).join('\n\n') || 'No provider payload was returned.';
    $('#pkgCreateError', m.root).hidden = false;
    setLog([`Status: ${diagnostics.status || 'failed'}`, diagnostics.incompleteReason && `Incomplete reason: ${diagnostics.incompleteReason}`, diagnostics.responseId && `Response: ${diagnostics.responseId}`, diagnostics.reasoningSummary ? 'Provider reasoning summary received.' : 'No provider reasoning summary was returned.']);
  };
  const refreshSheetPreview = () => {
    const file = $('#pkgCreateImage', m.root)?.files?.[0]; const preview = $('#pkgCreateSheetPreview', m.root);
    if (!file) { preview.hidden = true; $('#pkgCreateSheetPrompt', m.root).hidden = false; $('#pkgCreateSheetMeta', m.root).textContent = 'A preview appears here before anything is sent.'; return; }
    const url = URL.createObjectURL(file); preview.onload = () => { $('#pkgCreateSheetMeta', m.root).textContent = `${file.name} · ${preview.naturalWidth}×${preview.naturalHeight}px`; URL.revokeObjectURL(url); }; preview.src = url; preview.hidden = false; $('#pkgCreateSheetPrompt', m.root).hidden = true; m.markDirty();
  };
  const renderFields = () => {
    resetResult();
    const mode = kind.value;
    const label = mode === 'pokemon' ? 'Pokemon name' : (mode === 'player' ? 'Player name' : mode === 'object' ? 'Object name' : 'Known name');
    const hint = mode === 'npc' ? 'Optional. It helps identify a canonical NPC; the sheet remains the primary source.' : mode === 'pokemon' ? 'Optional when the sheet filename already matches the species.' : 'Required before creating the draft.';
    $('#pkgCreateIdentity', m.root).innerHTML = `<div class="pkg-create-section-head"><span class="pkg-create-step">2</span><div><h4>Identity</h4><p>${esc(hint)}</p></div></div><div class="field"><label>${label}</label><input class="input" id="pkgCreateName" placeholder="${mode === 'pokemon' ? 'Pikachu' : mode === 'object' ? 'Sign' : ''}"></div><p class="tiny" id="pkgCreateGeneratedId" hidden></p>`;
    $('#pkgCreateDraft', m.root).textContent = `Create ${choices.find(([id]) => id === mode)?.[1] || 'character'}`;
    syncProfileSource();
  };
  renderFields(); kind.onchange = renderFields; $('#pkgCreateImage', m.root).onchange = refreshSheetPreview; $('#pkgCreateProfileJson', m.root).oninput = syncProfileSource;
  $('#pkgCreateCancel', m.root).onclick = closeCreateModal;
  $('#pkgCreateFetch', m.root).onclick = async () => {
    const value = kind.value; const file = $('#pkgCreateImage', m.root)?.files?.[0]; const nameInput = $('#pkgCreateName', m.root);
    resetResult();
    if (!file) { toast('Choose an overworld sheet first'); return; }
    try {
      if (value === 'npc') {
        const pasted = $('#pkgCreateProfileJson', m.root).value.trim();
        if (pasted) {
          $('#pkgCreateFetch', m.root).disabled = true; setLog(['Validating pasted character profile…']);
          let parsed;
          try { parsed = JSON.parse(pasted); } catch (_) { throw new Error('Character profile JSON is not valid JSON.'); }
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Character profile JSON must be one object.');
          const validation = await api('/api/packages/draft/npc-intel/validate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ intel: parsed }) });
          if (!validation.ok) throw new Error((validation.errors || ['Character profile failed validation.']).join(' '));
          applyNpcProfile(parsed, validation.intel, { provider: 'pasted_json', status: 'loaded' });
          setLog(['Status: loaded', 'Validated pasted character profile.']);
          m.markDirty();
          return;
        }
        const stage = 'profile';
        $('#pkgCreateFetch', m.root).disabled = true; $('#pkgCreateFetch', m.root).textContent = 'Generating…'; setLog(['Preparing sheet…', 'Researching and generating character profile…']);
        const fd = new FormData(); fd.append('file', file); fd.append('knownName', nameInput.value || ''); fd.append('stage', stage);
        const report = await api('/api/packages/llm/intel/from-sprite', { method: 'POST', body: fd });
        logModelTrace(report); const d = report.diagnostics || {};
        if (!report.profile?.character_name) { const error = new Error('The provider returned a retired character profile. Review the diagnostics and try again.'); error.detail = { message: error.message, diagnostics: report.diagnostics || { rawOutput: JSON.stringify(report, null, 2) } }; throw error; }
        applyNpcProfile(report.profile, report.intel, d);
        const cost = d.estimatedTokenCostUsd != null ? `Estimated model-token cost: $${Number(d.estimatedTokenCostUsd).toFixed(4)} (web-search charges excluded)` : '';
        setLog([`Status: ${d.status || 'completed'}`, d.responseId && `Response: ${d.responseId}`, d.model && `Model: ${d.model}`, d.webSearches?.length ? `Web research: ${d.webSearches.join(' | ')}` : 'Web research: no query reported.', d.usage?.inputTokens != null && `Tokens: ${d.usage.inputTokens} in · ${d.usage.outputTokens || 0} out`, cost, d.reasoningSummary ? `Provider reasoning summary:\n${d.reasoningSummary}` : 'No provider reasoning summary was returned.']);
      } else if (value === 'pokemon') {
        const query = nameInput.value.trim() || fileStem(file); if (!query) { toast('Enter a Pokemon name or use a named sheet'); return; }
        const result = await api(`/api/packages/pokemon/lookup?q=${encodeURIComponent(query)}`); if (!result.found) { toast(result.suggestion ? `Not found. Try ${result.suggestion}.` : 'Pokemon not found in PokéAPI'); return; }
        pokemon = result.data; nameInput.value = pokemon.displayName || query; $('#pkgCreateStats', m.root).innerHTML = statCards([['Name', pokemon.displayName], ['Dex', pokemon.pokemonId], ['Types', (pokemon.types || []).join(', ')], ['Forms', pokemon.forms?.length || 0]]); $('#pkgCreatePreviewTitle', m.root).textContent = 'Pokemon profile'; $('#pkgCreatePreview', m.root).hidden = false; $('#pkgCreateDraft', m.root).disabled = false;
      } else {
        if (!nameInput.value.trim()) { toast('Enter a name first'); return; } $('#pkgCreateDraft', m.root).disabled = false; setLog(['Ready to create a local draft.']);
      }
      m.markDirty();
    } catch (err) { showFailure(err); toast(err.message || 'Generation failed'); }
    finally { $('#pkgCreateFetch', m.root).disabled = false; syncProfileSource(); }
  };
  $('#pkgCreateDraft', m.root).onclick = async () => {
    const value = kind.value;
    const file = $('#pkgCreateImage', m.root)?.files?.[0];
    try {
      const name = (value === 'npc' && profile ? (profile.character_name || profile.display_name) : $('#pkgCreateName', m.root)?.value)?.trim();
      if (value === 'pokemon' && !pokemon) { toast('Fetch Pokemon info before creating this draft'); return; }
      if (!name) { toast(value === 'npc' ? 'Enter a name or fetch NPC info from the sheet' : 'Enter a name first'); return; }
      const id = slugFromName(value === 'pokemon' ? pokemon.id : name);
      const existing = existingPackage || (pkgState.settings?.scannedPackages || []).find((entry) => entry.id === id && entry.characterType === value) || null;
      if (existing && !window.confirm(`Replace the existing ${existing.displayName || id} character when this new draft is saved?`)) return;
      await api('/api/packages/draft/new', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, displayName: value === 'pokemon' ? pokemon.displayName : name, characterType: value, baseProfile: value === 'pokemon' ? 'pokemon_small' : (value === 'object' ? 'object' : 'character'), replaceExisting: Boolean(existing) }) });
      await loadPackageContext();
      if (value === 'npc' && legacyIntel) await applyGeneratedIntel(legacyIntel, true, profileDiagnostics, profile);
      else if (value === 'pokemon') await applyPokemonLookup(pokemon);
      else await saveDraft({ id, displayName: name, internalName: id, metadata: { ...(pkg()?.metadata || {}), characterType: value, ...(value === 'object' ? { objectCategory: DEFAULT_OBJECT_CATEGORY, objectAnimated: false } : {}) } });
      if (file) { const sheet = new FormData(); sheet.append('file', file); sheet.append('mode', 'primary'); sheet.append('walkSheetId', 'walk'); await api('/api/packages/draft/add-sheet', { method: 'POST', body: sheet }); }
      pkgState.panel = 'detail'; cleanupNavigationGuard(); m.close(); await loadPackageContext(); renderPackages(); toast(`${value === 'pokemon' ? 'Pokemon' : 'Character'} draft created`);
    } catch (err) { toast(String(err.message || err)); }
  };
}

function openPkgCharbinImportModal() {
  const m = mountModal(`<div class="modal">
    ${modalHead('Import charbin')}
    <div class="field"><label>Charbin file</label><input class="input" id="pkgCharbinImportFile" type="file" accept=".charbin"></div>
    <p class="tiny">Imports an existing character package into the active workspace.</p>
  ${modalFoot('<button type="button" class="btn" id="pkgCharbinImportCancel">Cancel</button>', '<button type="button" class="btn primary" id="pkgCharbinImportSubmit">Import</button>')}</div>`, { backdropClose: true, warnDirty: true });
  $('#pkgCharbinImportCancel', m.root).onclick = m.tryClose;
  $('#pkgCharbinImportSubmit', m.root).onclick = async () => {
    const file = $('#pkgCharbinImportFile', m.root)?.files?.[0];
    if (!file) { toast('Choose a charbin file first'); return; }
    try {
      const fd = new FormData(); fd.append('file', file);
      const result = await api('/api/packages/draft/import', { method: 'POST', body: fd });
      pkgState.selectedPath = result.path; pkgState.panel = 'detail';
      await loadPackageContext(); m.close(); renderPackages(); toast('Charbin imported');
    } catch (err) { toast(String(err.message || err)); }
  };
}

function openPkgImportMenu() {
  const m = mountModal(`<div class="modal">
    ${modalHead('Import character data')}
    <div class="modal-section"><h4>Existing charbin</h4><p class="tiny">Bring an existing character package into this workspace.</p><button type="button" class="btn" id="pkgImportExistingCharbin">Import charbin</button></div>
    <div class="modal-section"><h4>Character intel JSON</h4><p class="tiny">Create an NPC draft from an existing reviewed profile.</p><button type="button" class="btn" id="pkgImportExistingIntel">Import character intel JSON</button></div>
    <div class="modal-section"><h4>Multiple sheets</h4><p class="tiny">Create several packages from a batch of sheets.</p><button type="button" class="btn" id="pkgImportExistingBatch">Batch import</button></div>
  ${modalFoot('<button type="button" class="btn" id="pkgImportMenuCancel">Cancel</button>')}</div>`, { backdropClose: true });
  $('#pkgImportMenuCancel', m.root).onclick = m.close;
  $('#pkgImportExistingCharbin', m.root).onclick = () => { m.close(); openPkgCharbinImportModal(); };
  $('#pkgImportExistingIntel', m.root).onclick = () => { m.close(); openNpcIntelImportModal(); };
  $('#pkgImportExistingBatch', m.root).onclick = () => { m.close(); openPkgBatchImportModal(); };
}

function openPokemonCreateModal() {
  let lookup = null;
  const m = mountModal(`<div class="modal wide">
    ${modalHead('Pokemon from PokéAPI')}
    <div class="field"><label>Pokemon name</label><input class="input" id="pkgPokemonLookupName" placeholder="Pikachu"></div>
    <div class="field"><label>Sprite sheet (optional)</label><input class="input" id="pkgPokemonSheet" type="file" accept="image/png,image/webp"></div>
    <section id="pkgPokemonPreview" hidden><div id="pkgPokemonStats"></div></section>
  ${modalFoot('<button type="button" class="btn" id="pkgPokemonCancel">Cancel</button>', '<button type="button" class="btn" id="pkgPokemonLookup">Look up PokéAPI</button><button type="button" class="btn primary" id="pkgPokemonCreate" disabled>Create draft</button>')}</div>`, { backdropClose: true });
  $('#pkgPokemonCancel', m.root).onclick = m.tryClose;
  $('#pkgPokemonLookup', m.root).onclick = async () => {
    const name = $('#pkgPokemonLookupName', m.root).value.trim();
    if (!name) { toast('Enter a Pokemon name first'); return; }
    try {
      const result = await api(`/api/packages/pokemon/lookup?q=${encodeURIComponent(name)}`);
      if (!result.found) { toast(result.suggestion ? `Not found. Try ${result.suggestion}.` : 'Pokemon not found in PokéAPI'); return; }
      lookup = result.data;
      $('#pkgPokemonStats', m.root).innerHTML = statCards([['Name', lookup.displayName], ['Dex', lookup.pokemonId], ['Types', (lookup.types || []).join(', ')], ['Forms', lookup.forms?.length || 0]]);
      $('#pkgPokemonPreview', m.root).hidden = false; $('#pkgPokemonCreate', m.root).disabled = false; m.markDirty();
      toast('PokéAPI profile loaded. Review before creating the draft.');
    } catch (err) { toast(String(err.message || err)); }
  };
  $('#pkgPokemonCreate', m.root).onclick = async () => {
    if (!lookup) return;
    try {
      await api('/api/packages/draft/new', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: lookup.id, displayName: lookup.displayName, characterType: 'pokemon', baseProfile: 'pokemon_small' }) });
      await loadPackageContext();
      await applyPokemonLookup(lookup);
      const file = $('#pkgPokemonSheet', m.root).files?.[0];
      if (file) { const sheet = new FormData(); sheet.append('file', file); sheet.append('mode', 'primary'); sheet.append('walkSheetId', 'walk'); await api('/api/packages/draft/add-sheet', { method: 'POST', body: sheet }); }
      pkgState.panel = 'detail'; m.close(); await loadPackageContext(); renderPackages(); toast('Pokemon draft created from PokéAPI');
    } catch (err) { toast(String(err.message || err)); }
  };
}

function renderCharacterSettings() {
  title('Settings');
  toolbar('');
  $('#view').innerHTML = `<div class="card sidecard pkg-settings-card"><div class="pkg-info-tabs"><button type="button" class="btn small active" data-settings-tab="model">Model</button><button type="button" class="btn small" data-settings-tab="prompts">Prompt &amp; schema</button></div><section id="settingsModelPanel"><h3>Character model</h3><div class="field"><label>Vendor</label><select class="select" id="settingsVendor"><option value="openai">OpenAI</option></select></div><div class="field"><label>Model</label><select class="select" id="settingsModel"><option value="gpt-5.6-luna">GPT-5.6 Luna</option></select><button type="button" class="btn small" id="settingsRefreshModels">Refresh available models</button><p class="tiny" id="settingsModelNote"></p></div><div class="field"><label>API key</label><input class="input" id="settingsApiKey" type="password" autocomplete="off" placeholder="Leave blank to keep the saved key"></div><label class="check"><input id="settingsReasoningEnabled" type="checkbox"> Enable reasoning</label><div class="field"><label>Reasoning effort</label><select class="select" id="settingsReasoningEffort"><option value="minimal">Minimal</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></div><div class="field"><label>Temperature <span id="settingsTemperatureValue"></span></label><input id="settingsTemperature" type="range" min="0" max="1" step="0.05"></div><div class="field"><label>Profile output budget</label><input class="input" id="settingsMaxTokens" type="number" min="2000" max="128000" step="1000"></div></section><section id="settingsPromptsPanel" hidden><h3>Character profile</h3><p class="tiny">One researched request uses this prompt and editable schema.</p><div class="field"><label>Prompt</label><textarea class="input pkg-desc-area" id="settingsPromptProfile" rows="22"></textarea></div><details class="pkg-settings-schema" open><summary>Output schema</summary><textarea class="input pkg-desc-area" id="settingsSchemaProfile" rows="26"></textarea></details></section><div class="btn-row"><button type="button" class="btn primary" id="settingsSaveModel">Save settings</button></div></div>`;
  right(`<div class="sidecard card"><h3>Workspace</h3><button type="button" class="btn full" id="settingsBackup">Export backup</button><button type="button" class="btn full" id="settingsQuickAnim" style="margin-top:8px">Quick anim</button><button type="button" class="btn full" id="settingsBodyMarkers" style="margin-top:8px">Body markers</button></div>`);
  const setTemperature = () => { $('#settingsTemperatureValue').textContent = Number($('#settingsTemperature').value || 0).toFixed(2); };
  const refreshModels = async (selected = '') => { const result = await api('/api/packages/llm/models'); const models = result.models || []; if (models.length) $('#settingsModel').innerHTML = models.map((model) => `<option value="${esc(model)}">${esc(model)}</option>`).join(''); if (selected && models.includes(selected)) $('#settingsModel').value = selected; $('#settingsModelNote').textContent = result.warning || (models.length ? `${models.length} models available to this API key` : 'Save an API key, then refresh the model list.'); };
  const autoGrow = (el) => { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; };
  api('/api/packages/llm/settings').then(async (settings) => { $('#settingsReasoningEnabled').checked = !!settings.reasoningEnabled; $('#settingsReasoningEffort').value = settings.reasoningEffort || 'low'; $('#settingsTemperature').value = settings.temperature ?? 0.15; $('#settingsMaxTokens').value = settings.maxTokens || 8000; $('#settingsPromptProfile').value = settings.prompts?.profile || ''; $('#settingsSchemaProfile').value = JSON.stringify(settings.schemas?.profile || {}, null, 2); autoGrow($('#settingsPromptProfile')); autoGrow($('#settingsSchemaProfile')); setTemperature(); $('#settingsApiKey').placeholder = settings.configured ? 'Saved key is configured. Leave blank to keep it.' : 'API key'; await refreshModels(settings.model); }).catch((err) => toast(String(err.message || err)));
  $('#settingsRefreshModels').onclick = () => refreshModels($('#settingsModel').value).catch((err) => toast(String(err.message || err)));
  $('#settingsTemperature').oninput = setTemperature;
  $$('[data-settings-tab]').forEach((button) => button.onclick = () => { const prompts = button.dataset.settingsTab === 'prompts'; $('#settingsModelPanel').hidden = prompts; $('#settingsPromptsPanel').hidden = !prompts; $$('[data-settings-tab]').forEach((item) => item.classList.toggle('active', item === button)); });
  $('#settingsPromptProfile').oninput = () => autoGrow($('#settingsPromptProfile'));
  $('#settingsSchemaProfile').oninput = () => autoGrow($('#settingsSchemaProfile'));
  $('#settingsSaveModel').onclick = async () => { try { const profileSchema = JSON.parse($('#settingsSchemaProfile').value); const saved = await api('/api/packages/llm/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ vendor: $('#settingsVendor').value, endpoint: 'https://api.openai.com/v1/responses', model: $('#settingsModel').value, apiKey: $('#settingsApiKey').value, reasoningEnabled: $('#settingsReasoningEnabled').checked, reasoningEffort: $('#settingsReasoningEffort').value, temperature: $('#settingsTemperature').value, maxTokens: $('#settingsMaxTokens').value, prompts: { profile: $('#settingsPromptProfile').value }, profileSchema }) }); toast(saved.cacheInvalidated ? 'Settings saved and profile cache cleared' : 'Settings saved'); } catch (err) { toast(`Settings were not saved: ${err.message || err}`); } };
  $('#settingsBackup').onclick = () => { location.href = '/api/export/project'; };
  $('#settingsQuickAnim').onclick = () => { if (typeof openQuickAnimMode === 'function') openQuickAnimMode(); };
  $('#settingsBodyMarkers').onclick = () => { if (typeof openBodyMarkers === 'function') void openBodyMarkers(null, ''); };
}

async function openCharacter(path) {
  if (pkgState.panel === 'list') {
    capturePokemonLibraryUiFromDom(path);
    captureObjectLibraryUiFromDom(path);
  }
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
  } else if (isObjectCharType(p?.metadata?.characterType)) {
    pkgState.selectedSheetId = p.spriteSheets?.find((s) => s.id === 'sheet')?.id
      || p.spriteSheets?.find((s) => s.assetId)?.id
      || null;
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
  const active = sheet.id === pkgState.selectedSheetId ? ' selected' : '';
  const frameLabel = pkgFrameSizeLabel(sheet);
  const objectMode = isObjectCharType(pkg()?.metadata?.characterType);
  const synced = objectMode ? syncObjectSheetFields(sheet) : sheet;
  const v = isPokemonCharType(pkg()?.metadata?.characterType) ? syncSheetVariantFields(sheet) : null;
  const sub = objectMode
    ? ((synced.modifiers || []).length
      ? `id: ${synced.modifiers.join(', ')}`
      : 'default appearance')
    : (v
      ? pokemonVariantLabel(v.formId, v.modifiers, v.behavior)
      : profileLabel(sheet.profile || pkg()?.baseProfile || 'character'));
  const thumb = sheet.assetId
    ? `<div class="thumb wide" style="margin-bottom:8px"><img src="${sheetAssetUrl(sheet)}?t=${Date.now()}"/></div>`
    : '<div class="thumb wide" style="margin-bottom:8px"><span class="tiny">no png</span></div>';
  return `<div class="card sidecard sheet-tile pkg-sheet-tile selectable-card${active}" data-sheet="${esc(sheet.id)}" role="button" tabindex="0" title="Select appearance">
    ${thumb}<h3 class="truncate">${esc(objectMode ? objectAppearanceDisplayName(sheet) : (synced.name || sheet.name || sheet.id))}</h3>
    <p>${esc(sub)}</p>
    <p class="tiny">${esc(frameLabel)} · <button type="button" class="btn linkish tiny pkg-sheet-inspect" data-sheet-inspect="${esc(sheet.id)}">Inspect grid</button>${objectMode ? ` · <button type="button" class="btn linkish tiny pkg-sheet-rename" data-sheet-rename="${esc(sheet.id)}">Rename</button>` : ''}</p>
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
  const def = pkgDefaultFrameSize(sheet);
  const { fw, fh } = pkgEffectiveFrameSize(sheet);
  const separate = fw !== fh;
  const hasOverride = pkgSheetHasCustomFrameSize(sheet);

  const html = `<div class="modal card pkg-sheet-modal">
    ${modalHead(`Sheet · ${esc(sheet.name || sheet.id)}`)}
    <p class="tiny">Embedded PNG and how it is sliced for animations. Frame size applies to this sheet only.</p>
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
        <p class="tiny" id="pkgSheetModalGridHint">${merged.columns}×${merged.rows} · ${fw}×${fh}px</p>
      </div>
    </div>
    <div class="field pkg-sheet-cell-field">
      <label class="check"><input type="checkbox" id="pkgSheetModalSeparate"${separate ? ' checked' : ''}> Separate width &amp; height (non-square cells)</label>
      <div class="pkg-sheet-frame-size-row row wrap" style="align-items:center;gap:10px;margin-top:8px">
        <div class="pkg-sheet-frame-square">
          <label>Cell size (px)</label>
          <input class="input" id="pkgSheetModalCell" type="number" min="8" max="256" step="1" value="${fw}" style="max-width:6rem"${separate ? ' disabled' : ''}>
        </div>
        <div class="pkg-sheet-frame-rect" style="display:${separate ? 'flex' : 'none'};gap:10px;flex-wrap:wrap">
          <div><label>Width (px)</label><input class="input" id="pkgSheetModalWidth" type="number" min="8" max="256" step="1" value="${fw}" style="max-width:6rem"></div>
          <div><label>Height (px)</label><input class="input" id="pkgSheetModalHeight" type="number" min="8" max="256" step="1" value="${fh}" style="max-width:6rem"></div>
        </div>
        <button type="button" class="btn small" id="pkgSheetModalDetect" disabled>Use detected</button>
      </div>
      <p class="tiny">Profile default is <b>${def.fw}×${def.fh}px</b>. <span id="pkgSheetDetected"></span></p>
      ${hasOverride ? '<label class="check"><input type="checkbox" id="pkgSheetModalResetCell"> Use profile default</label>' : ''}
    </div>
    ${modalFoot('<button type="button" class="btn" id="pkgSheetModalCancel">Cancel</button>', '<button type="button" class="btn primary" id="pkgSheetModalSave">Apply</button>')}
  </div>`;

  const m = mountModal(html, { backdropClose: true, warnDirty: true });
  const rawImg = $('#pkgSheetModalRaw', m.root);
  const gridCan = $('#pkgSheetModalGrid', m.root);
  const cellInput = $('#pkgSheetModalCell', m.root);
  const widthInput = $('#pkgSheetModalWidth', m.root);
  const heightInput = $('#pkgSheetModalHeight', m.root);
  const separateChk = $('#pkgSheetModalSeparate', m.root);
  const squareWrap = $('.pkg-sheet-frame-square', m.root);
  const rectWrap = $('.pkg-sheet-frame-rect', m.root);
  const detectBtn = $('#pkgSheetModalDetect', m.root);
  const gridHint = $('#pkgSheetModalGridHint', m.root);
  const dimsEl = $('#pkgSheetModalDims', m.root);
  const detectedEl = $('#pkgSheetDetected', m.root);
  const resetChk = $('#pkgSheetModalResetCell', m.root);

  let loadedImg = null;
  let detected = null;

  const isSeparate = () => !!separateChk?.checked;

  const syncSeparateUi = () => {
    const on = isSeparate();
    if (squareWrap) squareWrap.style.display = on ? 'none' : '';
    if (rectWrap) rectWrap.style.display = on ? 'flex' : 'none';
    if (cellInput) cellInput.disabled = on || !!resetChk?.checked;
    if (widthInput) widthInput.disabled = !!resetChk?.checked;
    if (heightInput) heightInput.disabled = !!resetChk?.checked;
    if (!on && cellInput && widthInput && heightInput) {
      const cell = Math.max(8, Number(cellInput.value) || def.fw);
      widthInput.value = String(cell);
      heightInput.value = String(cell);
    }
    refreshGrid();
  };

  const previewFrameSize = () => {
    if (resetChk?.checked) return { fw: def.fw, fh: def.fh };
    if (isSeparate()) {
      return {
        fw: Math.max(8, Math.round(Number(widthInput?.value) || def.fw)),
        fh: Math.max(8, Math.round(Number(heightInput?.value) || def.fh)),
      };
    }
    const cell = Math.max(8, Math.round(Number(cellInput?.value) || def.fw));
    return { fw: cell, fh: cell };
  };

  const refreshGrid = () => {
    if (!loadedImg) return;
    const { fw, fh } = previewFrameSize();
    const profPreview = { ...merged, frameWidth: fw, frameHeight: fh };
    drawPkgSheetGridCanvas(gridCan, loadedImg, profPreview);
    if (gridHint) {
      gridHint.textContent = `${profPreview.columns}×${profPreview.rows} grid · ${fw}×${fh}px cells`;
    }
  };

  if (separateChk) separateChk.onchange = syncSeparateUi;

  if (resetChk) {
    resetChk.onchange = () => {
      const on = resetChk.checked;
      if (cellInput) {
        if (!isSeparate()) {
          cellInput.disabled = on;
          if (on) cellInput.value = String(def.fw);
        }
      }
      if (widthInput) {
        widthInput.disabled = on;
        if (on) widthInput.value = String(def.fw);
      }
      if (heightInput) {
        heightInput.disabled = on;
        if (on) heightInput.value = String(def.fh);
      }
      refreshGrid();
    };
  }

  cellInput?.addEventListener('input', refreshGrid);
  widthInput?.addEventListener('input', refreshGrid);
  heightInput?.addEventListener('input', refreshGrid);

  if (detectBtn) {
    detectBtn.onclick = () => {
      if (!detected) return;
      if (separateChk) separateChk.checked = detected.fw !== detected.fh;
      syncSeparateUi();
      if (isSeparate()) {
        if (widthInput) widthInput.value = String(detected.fw);
        if (heightInput) heightInput.value = String(detected.fh);
      } else if (cellInput) {
        cellInput.value = String(detected.fw);
      }
      refreshGrid();
      m.markDirty();
    };
  }

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
      const rows = merged.rows || 4;
      const detFw = Math.round(img.width / cols);
      const detFh = Math.round(img.height / rows);
      detected = { fw: detFw, fh: detFh };
      if (dimsEl) dimsEl.textContent = `${img.width}×${img.height}px`;
      if (detectedEl) {
        const parts = [];
        if (detFw !== def.fw || detFh !== def.fh) {
          parts.push(`Detected: ${detFw}×${detFh}px (${cols}×${rows} grid).`);
        }
        detectedEl.textContent = parts.join(' ');
      }
      if (detectBtn) detectBtn.disabled = false;
      refreshGrid();
    };
    img.src = `${sheetAssetUrl(sheet)}?t=${Date.now()}`;
  }

  $('#pkgSheetModalCancel', m.root).onclick = m.tryClose;
  $('#pkgSheetModalSave', m.root).onclick = async () => {
    const useDefault = !!resetChk?.checked;
    const { fw, fh } = useDefault ? def : previewFrameSize();
    const nextSheets = (p.spriteSheets || []).map((s) => {
      if (s.id !== sheetId) return s;
      const overrides = { ...(s.profileOverrides || {}) };
      if (useDefault || (fw === def.fw && fh === def.fh)) {
        delete overrides.frameWidth;
        delete overrides.frameHeight;
      } else {
        overrides.frameWidth = fw;
        overrides.frameHeight = fh;
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
  if (isObjectCharType(pkg()?.metadata?.characterType)) {
    return action.id || action.animationName || '';
  }
  if (action.type === 'activity') {
    return action.id || 'activity';
  }
  const sheetBeh = actionSheetBehavior(action);
  const isStance = !action.movementDriven || action.type === 'idle' || (action.behavior || '') === 'idle';
  if (isStance) return `idle (${sheetBeh})`;
  return String(action.animationName || action.id || sheetBeh);
}

function pkgAnimGroupHeader(action) {
  const name = pkgActionDisplayName(action);
  const sheetBeh = actionSheetBehavior(action);
  const pokemonMode = isPokemonCharType(pkg()?.metadata?.characterType);
  const objectMode = isObjectCharType(pkg()?.metadata?.characterType);
  const isStance = !action.movementDriven || action.type === 'idle' || (action.behavior || '') === 'idle';
  let hint;
  if (objectMode) {
    const sheet = (pkg()?.spriteSheets || []).find((s) => s.id === action.sheetId);
    const spec = sheet ? pkgEffectiveAnimSpec(sheet, action.animationName || action.id) : {};
    const frames = (spec.frames || []).join(', ') || '0';
    const loop = spec.loop === false ? 'plays once' : 'loops';
    hint = `cells [${frames}] · ${Number(spec.frameTimeMs) || 0} ms · ${loop}`;
  } else if (action.type === 'activity') {
    if (action.activityKind === 'session') {
      const sheet = (pkg()?.spriteSheets || []).find((s) => s.id === action.sheetId);
      const enter = sheet ? pkgEffectiveAnimSpec(sheet, 'enter').frames : null;
      const stay = sheet ? pkgEffectiveAnimSpec(sheet, 'stay').frames : null;
      const exit = sheet ? pkgEffectiveAnimSpec(sheet, 'exit').frames : null;
      const fmt = (f) => (f?.length ? f.join('→') : '—');
      hint = `session · enter [${fmt(enter)}] · stay [${fmt(stay)}] · exit [${fmt(exit)}]`;
    } else {
      hint = 'activity · single play · 4-dir';
    }
  } else if (pokemonMode && isStance && ['walk', 'swim', 'eating'].includes(sheetBeh)) {
    hint = `same ${sheetBeh} animation`;
  } else if (action.movementDriven) {
    hint = `loops on ${sheetBeh} sheet`;
  } else {
    hint = `frame 0 on ${sheetBeh} sheet`;
  }
  return `<div class="pkg-anim-group-head">
    <span class="section-title inline">${esc(action.id || name)}</span>
    <button type="button" class="pkg-action-info-btn" data-pkg-action-info="${esc(action.id)}" title="Edit animation" aria-label="Edit animation ${esc(action.id || name)}">i</button>
    ${objectMode ? `<button type="button" class="pkg-action-del-btn" data-pkg-action-del="${esc(action.id)}" title="Remove animation" aria-label="Remove animation ${esc(action.id || name)}">×</button>` : ''}
    <span class="tiny pkg-anim-group-hint">${esc(hint)}</span>
  </div>`;
}

function pkgSheetAnimNames(sheet) {
  const prof = profileDef(sheet?.profile || pkg()?.baseProfile);
  const suppressed = new Set(sheet?.suppressedAnimations || []);
  const keys = new Set([
    ...Object.keys(prof.animations || {}),
    ...Object.keys(sheet?.animations || {}),
  ]);
  return [...keys].filter((k) => !suppressed.has(k)).sort();
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

async function removeObjectAnimation(actionId) {
  const p = pkg();
  if (!p || !isObjectCharType(p?.metadata?.characterType)) return;
  const action = (p.actions || []).find((a) => a.id === actionId);
  if (!action) return;
  const animName = (action.animationName || action.id || '').trim();
  const sheetId = action.sheetId;
  const label = action.id || animName;
  if (!confirm(`Remove animation "${label}" from this appearance?`)) return;
  const nextActions = (p.actions || []).filter((a) => a.id !== actionId);
  const nextSheets = (p.spriteSheets || []).map((s) => {
    if (s.id !== sheetId) return { ...s };
    const out = { ...s };
    const suppressed = [...(out.suppressedAnimations || [])];
    if (animName && !suppressed.includes(animName)) suppressed.push(animName);
    out.suppressedAnimations = suppressed;
    if (out.animations) {
      const anims = { ...out.animations };
      delete anims[animName];
      if (Object.keys(anims).length) out.animations = anims;
      else delete out.animations;
    }
    return out;
  });
  try {
    await saveDraft({ actions: nextActions, spriteSheets: nextSheets });
    toast(`Removed ${label}`);
    renderCharDetail();
  } catch (err) {
    toast(String(err.message || err));
  }
}

function pkgActivityTimingClipNames(action) {
  if (action?.activityKind === 'session') return ['enter', 'stay', 'exit'];
  const phases = action?.phases || {};
  return [phases.play?.animationName || 'play'];
}

function pkgEffectiveFrameMs(sheet, animName) {
  const spec = sheet ? pkgEffectiveAnimSpec(sheet, animName) : {};
  return Math.max(1, Number(spec.frameTimeMs) || 120);
}

function pkgActivityEffectiveFrameMs(sheet, action) {
  const clips = pkgActivityTimingClipNames(action);
  for (const clip of clips) {
    if (sheet && pkgEffectiveAnimSpec(sheet, clip).frameTimeMs != null) {
      return pkgEffectiveFrameMs(sheet, clip);
    }
  }
  return clips.length ? pkgEffectiveFrameMs(sheet, clips[0]) : 120;
}

function buildPkgActionTimingHtml({ sheet, animName, animSpec, hasOverride, objectMode, isActivity, action }) {
  if (!sheet) return '';
  const effectiveMs = isActivity
    ? pkgActivityEffectiveFrameMs(sheet, action)
    : pkgEffectiveFrameMs(sheet, animName);
  const defaultFrames = (animSpec.frames || []).join(', ');
  if (isActivity) {
    const clipNote = action.activityKind === 'session'
      ? 'Applies to <code>enter</code>, <code>stay</code>, and <code>exit</code> on this sheet.'
      : `Applies to the <code>${esc(pkgActivityTimingClipNames(action)[0])}</code> clip.`;
    return `<div class="modal-section pkg-action-timing">
      <h4>Timing</h4>
      <p class="tiny">${clipNote} Lower = faster.</p>
      <div class="field"><label>Frame time (ms)</label>
        <input class="input" id="pkgActFrameMs" type="number" min="1" step="1" value="${effectiveMs}">
      </div>
    </div>`;
  }
  return `<div class="modal-section pkg-action-timing">
    <h4>Sheet timing${hasOverride ? ' <span class="tag short">override</span>' : ''}</h4>
    <p class="tiny">Per-sheet override for <code>${esc(animName)}</code>. Profile default: frames <b>${esc(defaultFrames || '—')}</b>, ${effectiveMs} ms${animSpec.loop === false ? ', no loop' : ''}.</p>
    <div class="grid cols2">
      <div class="field"><label>${objectMode ? 'Frame cells' : 'Frame columns'}</label>
        <input class="input" id="pkgActFrames" value="${esc(defaultFrames)}" placeholder="0, 1, 2, 3">
      </div>
      <div class="field"><label>Frame time (ms)</label>
        <input class="input" id="pkgActFrameMs" type="number" min="1" step="1" value="${effectiveMs}">
        <p class="tiny">Milliseconds per frame. Lower = faster.</p>
      </div>
    </div>
    <label class="check"><input type="checkbox" id="pkgActLoop" ${animSpec.loop === false ? '' : 'checked'}> Loop animation</label>
    <label class="check"><input type="checkbox" id="pkgActClearOverride" ${hasOverride ? '' : 'disabled'}> Clear sheet override (use profile defaults)</label>
  </div>`;
}

function applyPkgSheetAnimTiming(sh, animName, { frames, frameMs, loopChecked, clearOverride }) {
  const anims = { ...(sh.animations || {}) };
  if (clearOverride) {
    delete anims[animName];
  } else {
    const spec = { ...(anims[animName] || {}) };
    if (frames?.length) spec.frames = frames;
    if (frameMs != null) spec.frameTimeMs = frameMs;
    if (loopChecked) delete spec.loop;
    else spec.loop = false;
    anims[animName] = spec;
  }
  sh.animations = Object.keys(anims).length ? anims : undefined;
  if (!sh.animations) delete sh.animations;
  return sh;
}

function openPkgActionMetaModal(actionId) {
  const p = pkg();
  if (!p) return;
  const objectMode = isObjectCharType(p?.metadata?.characterType);
  const actions = [...(p.actions || [])];
  const idx = actions.findIndex((a) => a.id === actionId);
  if (idx < 0) return;
  const action = { ...actions[idx] };
  const sheets = (p.spriteSheets || []).filter((s) => s.assetId);
  const sheet = sheets.find((s) => s.id === action.sheetId) || sheets[0];
  const animName = action.animationName || action.id;
  const objectClipName = objectClipNameFromAction(action);
  const animSpec = sheet ? pkgEffectiveAnimSpec(sheet, animName) : {};
  const hasOverride = sheet ? pkgSheetHasAnimOverride(sheet, animName) : false;
  const defaultFrames = (animSpec.frames || []).join(', ');
  const sheetOpts = sheets.map((s) =>
    `<option value="${esc(s.id)}" ${s.id === action.sheetId ? 'selected' : ''}>${esc(s.name || s.id)}</option>`).join('');
  const animOpts = (sheet ? pkgSheetAnimNames(sheet) : [animName]).map((n) =>
    `<option value="${esc(n)}" ${n === animName ? 'selected' : ''}>${esc(n)}</option>`).join('');
  const isActivity = action.type === 'activity';
  const timingFields = buildPkgActionTimingHtml({
    sheet, animName, animSpec, hasOverride, objectMode, isActivity, action,
  });
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
      ${action.activityKind === 'session' && sheet ? '<p class="tiny">Clips on this sheet: <code>enter</code>, <code>stay</code>, <code>exit</code>. Frame columns are edited per clip in sheet overrides; speed is below.</p>' : ''}
      <div class="field"><label>Phases (JSON)</label>
        <textarea class="input pkg-desc-area" id="pkgActPhases" rows="6" spellcheck="false">${esc(phasesJson)}</textarea>
        <p class="tiny">Phase ids map to <code>{ animationName, loop? }</code> on the sheet.</p>
      </div>
    </div>`;
  const standardFields = objectMode ? `
    <div class="pkg-action-standard-only" ${isActivity ? 'hidden' : ''}>
      <div class="field"><label>Clip name</label>
        <input class="input" id="pkgObjActClipName" value="${esc(objectClipName)}" placeholder="open">
        <p class="tiny" id="pkgObjActIdHint">Action id: <code>${esc(action.id)}</code></p>
      </div>
    </div>` : `
    <div class="pkg-action-standard-only" ${isActivity ? 'hidden' : ''}>
      <div class="field"><label>Animation name</label>
        <select class="select" id="pkgActAnimName">${animOpts}</select>
        <p class="tiny">Profile animation key used when playing this action.</p>
      </div>
    </div>`;
  const html = `<div class="modal card pkg-action-meta-modal">
    ${modalHead(`Animation · ${esc(action.id)}`)}
    <p class="tiny">Edits the <code>actions[]</code> record saved in this .charbin. Save the character to write to disk.</p>
    <div class="grid cols2">
      ${objectMode ? '' : `<div class="field"><label>Action id</label><input class="input" id="pkgActId" value="${esc(action.id)}"></div>`}
      <div class="field"><label>Type</label>
        <select class="select" id="pkgActType">
          <option value="idle" ${action.type === 'idle' ? 'selected' : ''}>idle</option>
          ${objectMode ? '' : `<option value="movement" ${action.type === 'movement' ? 'selected' : ''}>movement</option>
          <option value="walk" ${action.type === 'walk' ? 'selected' : ''}>walk (legacy)</option>`}
          <option value="activity" ${action.type === 'activity' ? 'selected' : ''}>activity</option>
        </select>
      </div>
      <div class="field"><label>Sheet</label>
        <select class="select" id="pkgActSheet">${sheetOpts || '<option value="">—</option>'}</select>
      </div>
      <div class="field pkg-action-move-row" ${isActivity || objectMode ? 'hidden' : ''}>
        <label class="check" style="margin-top:28px"><input type="checkbox" id="pkgActMovementDriven" ${action.movementDriven ? 'checked' : ''}> Movement driven</label>
      </div>
    </div>
    ${standardFields}
    ${activityFields}
    ${timingFields}
    ${modalFoot(`${objectMode ? '<button type="button" class="btn bad" id="pkgActDelete">Delete</button>' : ''}<button type="button" class="btn" id="pkgActCancel">Cancel</button>`, '<button type="button" class="btn primary" id="pkgActSave">Apply</button>')}
  </div>`;

  const m = mountModal(html, { backdropClose: true, warnDirty: true });
  const syncObjectClipIdHint = () => {
    if (!objectMode) return;
    const clip = normalizeClipName($('#pkgObjActClipName', m.root)?.value || '');
    const hint = $('#pkgObjActIdHint', m.root);
    if (!hint) return;
    const nextId = clip ? objectActionId(clip, action.modifiers || []) : '—';
    hint.innerHTML = `Action id: <code>${esc(nextId)}</code>`;
  };
  $('#pkgObjActClipName', m.root)?.addEventListener('input', syncObjectClipIdHint);
  const syncTypeUi = () => {
    const t = $('#pkgActType', m.root)?.value;
    const activity = t === 'activity';
    $('.pkg-action-activity-only', m.root)?.toggleAttribute('hidden', !activity);
    $('.pkg-action-standard-only', m.root)?.toggleAttribute('hidden', activity);
    $('.pkg-action-move-row', m.root)?.toggleAttribute('hidden', activity || objectMode);
    $('.pkg-action-timing', m.root)?.toggleAttribute('hidden', !sheet);
    const move = $('#pkgActMovementDriven', m.root);
    if (move && !activity) {
      if (t === 'movement' || t === 'walk') move.checked = true;
      if (t === 'idle') move.checked = false;
    }
  };
  $('#pkgActType', m.root)?.addEventListener('change', syncTypeUi);
  $('#pkgActSheet', m.root)?.addEventListener('change', () => {
    if (objectMode) return;
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
  if (objectMode) {
    $('#pkgActDelete', m.root).onclick = async () => {
      m.close();
      await removeObjectAnimation(actionId);
    };
  }
  $('#pkgActSave', m.root).onclick = async () => {
    const actType = $('#pkgActType', m.root)?.value || 'idle';
    const sheetId = $('#pkgActSheet', m.root)?.value || action.sheetId;
    let newId;
    let clipName = animName;
    if (objectMode && actType !== 'activity') {
      clipName = normalizeClipName($('#pkgObjActClipName', m.root)?.value || '');
      if (!clipName) {
        toast('Clip name is required');
        return;
      }
      if (!/^[a-z][a-z0-9_]*$/.test(clipName)) {
        toast('Clip name must start with a letter and use only a-z, 0-9, _');
        return;
      }
      newId = objectActionId(clipName, action.modifiers || []);
    } else {
      newId = ($('#pkgActId', m.root)?.value || '').trim();
      if (!newId) {
        toast('Action id is required');
        return;
      }
    }
    if (actions.some((a, i) => i !== idx && a.id === newId)) {
      toast(`Another action already uses id "${newId}"`);
      return;
    }
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
      updated.animationName = objectMode
        ? clipName
        : ($('#pkgActAnimName', m.root)?.value || action.animationName || newId).trim();
      updated.movementDriven = objectMode ? false : !!$('#pkgActMovementDriven', m.root)?.checked;
      if (objectMode) updated.type = 'idle';
      delete updated.activityKind;
      delete updated.facingMode;
      delete updated.phases;
    }
    const nextActions = actions.map((a, i) => (i === idx ? updated : a));
    let nextSheets = (p.spriteSheets || []).map((s) => ({ ...s, animations: { ...(s.animations || {}) } }));
    const frameMs = Math.max(1, Number($('#pkgActFrameMs', m.root)?.value) || 120);
    if (sheet && actType === 'activity') {
      const si = nextSheets.findIndex((s) => s.id === sheetId);
      if (si >= 0) {
        const sh = { ...nextSheets[si] };
        const anims = { ...(sh.animations || {}) };
        for (const clip of pkgActivityTimingClipNames(updated)) {
          anims[clip] = { ...(anims[clip] || {}), frameTimeMs: frameMs };
        }
        sh.animations = anims;
        nextSheets[si] = sh;
      }
    } else if (sheet && actType !== 'activity') {
      const oldAnimName = animName;
      const targetAnim = updated.animationName;
      const si = nextSheets.findIndex((s) => s.id === sheetId);
      if (si >= 0) {
        let sh = nextSheets[si];
        if (objectMode && oldAnimName !== targetAnim) {
          sh = renameObjectSheetClip(sh, oldAnimName, targetAnim);
        }
        const prof = profileDef(sh.profile || p.baseProfile);
        const profDefault = prof.animations?.[targetAnim] || {};
        const clearOverride = !!$('#pkgActClearOverride', m.root)?.checked;
        const framesRaw = ($('#pkgActFrames', m.root)?.value || '').trim();
        const loopChecked = !!$('#pkgActLoop', m.root)?.checked;
        const frames = framesRaw ? parseFrameList(framesRaw) : [];
        sh = applyPkgSheetAnimTiming(sh, targetAnim, {
          frames: frames.length ? frames : null,
          frameMs: clearOverride ? null : frameMs,
          loopChecked,
          clearOverride,
        });
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
  (root || document).querySelectorAll('[data-pkg-action-del]').forEach((btn) => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      await removeObjectAnimation(btn.dataset.pkgActionDel);
    };
  });
}

function renderObjectAppearancePicker(sheets) {
  if (!sheets.length) return '';
  const opts = sheets.map((s) => {
    const sel = s.id === pkgState.selectedSheetId ? ' selected' : '';
    return `<option value="${esc(s.id)}"${sel}>${esc(objectAppearanceDisplayName(s))}</option>`;
  }).join('');
  return `<div class="card sidecard pkg-object-appearance" data-object-only>
    <div class="field"><label>Appearance</label>
      <div class="row wrap" style="gap:8px;align-items:center">
        <select class="select" id="pkgObjectAppearance" style="flex:1;min-width:140px">${opts}</select>
        <button type="button" class="btn small" id="pkgObjectAppearanceRename">Rename</button>
      </div>
      <p class="tiny">Display names are editable; sheet ids stay fixed for the game.</p>
    </div>
  </div>`;
}

function openObjectRenameAppearanceModal(sheetId) {
  const p = pkg();
  if (!p || !isObjectCharType(p?.metadata?.characterType)) return;
  const sid = sheetId || pkgState.selectedSheetId || selectedPkgSheet()?.id;
  const sheet = (p.spriteSheets || []).find((s) => s.id === sid);
  if (!sheet) return;
  const synced = syncObjectSheetFields(sheet);
  const defaultLabel = objectAppearanceLabel(synced.modifiers);
  const currentCustom = String(sheet.name || '').trim();
  const html = `<div class="modal card">
    ${modalHead('Rename appearance')}
    <p class="tiny">Sheet <code>${esc(sheet.id)}</code>${(synced.modifiers || []).length ? ` · modifier <code>${esc(synced.modifiers.join('_'))}</code>` : ''}</p>
    <div class="field"><label>Display name</label>
      <input class="input" id="pkgObjAppearName" value="${esc(currentCustom || defaultLabel)}" placeholder="${esc(defaultLabel)}">
      <p class="tiny">Shown in the editor and picker. Does not change sheet id or action ids.</p>
    </div>
    ${modalFoot('<button type="button" class="btn" id="pkgObjAppearCancel">Cancel</button>', '<button type="button" class="btn primary" id="pkgObjAppearSave">Save</button>')}
  </div>`;
  const m = mountModal(html, { backdropClose: true });
  $('#pkgObjAppearCancel', m.root).onclick = () => m.close();
  $('#pkgObjAppearSave', m.root).onclick = async () => {
    const raw = ($('#pkgObjAppearName', m.root)?.value || '').trim();
    const nextName = raw && raw !== defaultLabel ? raw : '';
    const nextSheets = (p.spriteSheets || []).map((s) => {
      if (s.id !== sid) return s;
      const out = { ...s };
      if (nextName) out.name = nextName;
      else delete out.name;
      return out;
    });
    try {
      await saveDraft({ spriteSheets: nextSheets });
      toast(nextName ? `Renamed to ${nextName}` : 'Reset to default name');
      m.close();
      renderCharDetail();
    } catch (err) {
      toast(String(err.message || err));
    }
  };
}

function refreshObjectSheetPreview() {
  const p = pkg();
  if (!p || !isObjectCharType(p?.metadata?.characterType)) return;
  const actionsAll = pkgActionsWithResolvablePreview(p);
  const actions = filterActionsForPreview(p, actionsAll);
  const grid = $('#pkgAnimGrid');
  if (grid) grid.innerHTML = renderPkgAnimationsHtml(actions);
  hydratePkgVisuals();
  bindPkgActionInfoButtons($('#view'));
}

function openObjectAddAnimationModal() {
  const p = pkg();
  if (!p) return;
  const sheet = selectedPkgSheet();
  if (!sheet?.assetId) {
    toast('Add a sprite sheet first');
    return;
  }
  const synced = syncObjectSheetFields(sheet);
  const mods = synced.modifiers || [];
  const html = `<div class="modal card">
    ${modalHead('Add animation')}
    <p class="tiny">Named clip on <b>${esc(synced.name || synced.id)}</b>. Saved as a game action on this appearance.</p>
    <div class="field"><label>Name</label>
      <input class="input" id="pkgObjAnimName" placeholder="open"></div>
    <div class="grid cols2">
      <div class="field"><label>Frame cells</label>
        <input class="input" id="pkgObjAnimFrames" value="0" placeholder="0, 1, 2, 3">
        <p class="tiny">Comma-separated cell indices on the sheet grid.</p></div>
      <div class="field"><label>ms / frame</label>
        <input class="input" id="pkgObjAnimMs" type="number" min="0" value="120"></div>
    </div>
    <label class="check"><input type="checkbox" id="pkgObjAnimLoop" checked> Loop</label>
    ${modalFoot('<button type="button" class="btn" id="pkgObjAnimCancel">Cancel</button>', '<button type="button" class="btn primary" id="pkgObjAnimSave">Add</button>')}
  </div>`;
  const m = mountModal(html, { backdropClose: true });
  $('#pkgObjAnimCancel', m.root).onclick = () => m.close();
  $('#pkgObjAnimSave', m.root).onclick = async () => {
    const animName = ($('#pkgObjAnimName', m.root)?.value || '').trim().toLowerCase().replace(/\s+/g, '_');
    if (!animName) {
      toast('Enter an animation name');
      return;
    }
    if (!/^[a-z][a-z0-9_]*$/.test(animName)) {
      toast('Name must start with a letter and use only a-z, 0-9, _');
      return;
    }
    const frames = parseFrameList($('#pkgObjAnimFrames', m.root)?.value || '0');
    if (!frames.length) {
      toast('Enter at least one frame cell');
      return;
    }
    const frameTimeMs = Math.max(0, Number($('#pkgObjAnimMs', m.root)?.value) || 0);
    const loop = !!$('#pkgObjAnimLoop', m.root)?.checked;
    const sheetId = synced.id;
    const actions = [...(p.actions || [])];
    const actionId = objectActionId(animName, mods);
    if (actions.some((a) => a.id === actionId)) {
      toast(`Action "${actionId}" already exists`);
      return;
    }
    const nextSheets = (p.spriteSheets || []).map((s) => {
      if (s.id !== sheetId) return { ...s, animations: { ...(s.animations || {}) } };
      const anims = { ...(s.animations || {}) };
      anims[animName] = { frames, frameTimeMs, ...(loop ? {} : { loop: false }) };
      const suppressed = (s.suppressedAnimations || []).filter((x) => x !== animName);
      const out = { ...s, animations: anims };
      if (suppressed.length) out.suppressedAnimations = suppressed;
      else delete out.suppressedAnimations;
      return out;
    });
    const newAction = {
      id: actionId,
      type: 'idle',
      sheetId,
      animationName: animName,
      movementDriven: false,
      modifiers: [...mods],
    };
    try {
      await saveDraft({ spriteSheets: nextSheets, actions: [...actions, newAction] });
      toast(`Added ${actionId}`);
      m.close();
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
  if (action?.type === 'activity') {
    return action.sheetId || action.id || 'activity';
  }
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
  if (action?.type === 'activity') {
    const phases = action.phases || {};
    if (action.activityKind === 'session') {
      return phases.stay?.animationName || phases.enter?.animationName || 'stay';
    }
    return phases.play?.animationName || action.id || 'play';
  }
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
  if (isObjectCharType(p?.metadata?.characterType)) {
    const sid = pkgState.selectedSheetId || selectedPkgSheet()?.id;
    if (!sid) return actions;
    return actions.filter((a) => a.sheetId === sid);
  }
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
      ? '<div class="empty">No animations on this appearance. Use <b>+ Add animation</b>.</div>'
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
  const pokemonSize = readPokemonSize(p, m);
  const pokemonSizeHidden = pokemon ? '' : ' pkg-field-hidden';
  const profileHidden = pokemon ? ' pkg-field-hidden' : '';
  const npcProfile = isNpcCharType(charType) && typeof renderNpcIntelPanel === 'function' ? renderNpcIntelPanel(p) : '';
  return `<details class="card sidecard pkg-char-info" id="pkgCharInfo">
    <summary>Information</summary>
    ${npcProfile ? '<div class="pkg-info-tabs"><button type="button" class="btn small active" data-info-tab="basics">Basics</button><button type="button" class="btn small" data-info-tab="profile">Profile</button></div>' : ''}
    <div class="pkg-char-info-body" id="pkgInfoBasics">
      <div class="pkg-char-grid">
        <div class="field"><label>Name</label><input class="input" id="pkgName" value="${esc(p.displayName || '')}"></div>
        <div class="field${profileHidden}" data-pokemon-hide-profile><label>Sprite template</label><select class="select" id="pkgProfile">${profNames.map((n) =>
    `<option value="${n}" ${n === (p.baseProfile || 'character') ? 'selected' : ''}>${esc(profileLabel(n))}</option>`
  ).join('')}</select></div>
        <div class="field data-pokemon-only${pokemonSizeHidden}" data-pokemon-only>
          <label>Overworld size</label>
          <select class="select" id="pkgPokemonSize">
            ${POKEMON_SIZE_OPTIONS.map(([val, label, hint]) =>
    `<option value="${esc(val)}" ${val === pokemonSize ? 'selected' : ''}>${esc(label)} · ${esc(hint)}</option>`).join('')}
          </select>
          <p class="tiny">Small / medium / large set cell size on sheets. Human uses trainer-scale 32px profile.</p>
        </div>
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
      <div class="field ${(pokemon || isNpcCharType(charType)) ? 'pkg-field-hidden' : ''}"><label>Description</label><textarea class="input pkg-desc-area" id="pkgDesc" rows="3" placeholder="Sign text, inspect blurb, etc.">${esc(m.description || '')}</textarea></div>
      <div class="data-object-only${objectHidden}" data-object-only>
        <div class="field"><label>Category</label>
          <select class="select" id="pkgObjectCategory">
            ${OBJECT_CATEGORIES.map((c) =>
    `<option value="${esc(c.id)}" ${c.id === objectCategoryId({ objectCategory: m.objectCategory }) ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}
          </select>
          <p class="tiny">Groups this object in the library, like Pokémon generations.</p>
        </div>
        <label class="check"><input type="checkbox" id="pkgObjectAnimated" ${m.objectAnimated ? 'checked' : ''}> Animated sprite (row 0 cycle)</label>
        <p class="tiny">Off = use <b>static</b> only (frame 0). On = game may use <b>animate</b> when the sheet has multiple frames.</p>
      </div>
      <div class="pkg-meta-block data-object-only${objectHidden}" data-object-only>
        <div class="field"><label>Tags</label></div>
        <div class="chip-field pkg-chip-field" id="pkgObjectTagsChips"></div>
      </div>
      <div class="pkg-npc-only pkg-partner-block${npcHidden} pkg-legacy-npc-meta" data-npc-only>
        <p class="tiny">Pokemon links and dialogue are edited in the profile section below.</p>
      </div>
      <div class="pkg-meta-block pkg-npc-only${npcHidden}" data-npc-only>
        <div class="field"><label>Personality</label></div>
        <div class="chip-field pkg-chip-field" id="pkgPersonalityChips"></div>
      </div>
      <div class="pkg-meta-block pkg-npc-only${npcHidden}" data-npc-only>
        <div class="field"><label>Likes</label></div>
        <div class="chip-field pkg-chip-field" id="pkgLikesChips"></div>
      </div>
      <div class="pkg-meta-block pkg-npc-only${npcHidden} pkg-legacy-npc-meta" data-npc-only>
        <div class="field"><label>Tags</label></div>
        <div class="chip-field pkg-chip-field" id="pkgTagsChips"></div>
      </div>
    </div>
    ${npcProfile ? `<div id="pkgInfoProfile" hidden>${npcProfile}</div>` : ''}
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
/** How many times the stay phase holds before exit in session-activity preview. */
const PKG_SESSION_STAY_LOOPS = 4;

function playSessionActivityOnCanvas(canvas, sheet, profileName, action, direction = 'south') {
  if (!canvas || !sheet?.assetId || action?.activityKind !== 'session') return () => {};
  const prof = pkgMergedProf(sheet, profileName);
  const dir = prof.directions?.[direction];
  if (!dir) return () => {};
  const dirRow = Number(dir.row) || 0;
  const phases = action.phases || {};
  const clip = (phase) => pkgAnimSpec(sheet, prof, phases[phase]?.animationName || phase);
  const enterSpec = clip('enter');
  const staySpec = clip('stay');
  const exitSpec = clip('exit');
  if (!enterSpec || !staySpec || !exitSpec) return () => {};

  let stopped = false;
  const img = new Image();
  img.onload = () => {
    const ctx = canvas.getContext('2d');
    const drawCol = (col) => drawSheetCell(ctx, canvas, img, dirRow, col, prof);

    const playClip = (spec, repeat, done) => {
      const frames = spec.frames || [0];
      const delay = Math.max(1, Number(spec.frameTimeMs) || 120);
      let repsLeft = Math.max(1, repeat);
      let fi = 0;
      const step = () => {
        if (stopped) return;
        drawCol(frames[Math.min(fi, frames.length - 1)]);
        if (fi < frames.length - 1) {
          fi += 1;
          setTimeout(step, delay);
          return;
        }
        repsLeft -= 1;
        if (repsLeft > 0) {
          fi = 0;
          setTimeout(step, delay);
          return;
        }
        done();
      };
      step();
    };

    const runCycle = () => {
      if (stopped) return;
      playClip(enterSpec, 1, () => {
        playClip(staySpec, PKG_SESSION_STAY_LOOPS, () => {
          playClip(exitSpec, 1, () => {
            if (stopped) return;
            setTimeout(runCycle, PKG_PREVIEW_CYCLE_GAP_MS);
          });
        });
      });
    };
    runCycle();
  };
  img.onerror = () => {};
  img.src = `${sheetAssetUrl(sheet)}?t=${Date.now()}`;
  return () => { stopped = true; };
}

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
  if (isObjectCharType(p?.metadata?.characterType)) return false;
  if (action?.type === 'activity') return false;
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
      const stop = action.type === 'activity' && action.activityKind === 'session'
        ? playSessionActivityOnCanvas(canvas, sheetForAnim, profileName, action, dirKey)
        : playPkgAnimOnCanvas(canvas, sheetForAnim, profileName, animName, dirKey, { holdFrame });
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

  const objectSheets = objectMode ? objectSheetsFromPackage(p) : [];
  const objectAppearanceHtml = objectMode ? renderObjectAppearancePicker(objectSheets) : '';
  const objectAnimToolbar = objectMode
    ? `<div class="row object-anim-toolbar"><button type="button" class="btn good" id="pkgObjectAddAnim">+ Add animation</button></div>`
    : '';

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
    ? `<div class="section-title">${esc(objectAppearanceDisplayName(selectedPkgSheet()))}</div><div class="grid cols2">${pkgSpriteSlot('view', hasSheet)}</div>`
    : `<div class="section-title" data-walk-character-only>Base sprites</div><div class="grid cols4" data-walk-character-only>${baseHtml}</div>`;

  $('#view').innerHTML = `
    <div class="character-header card sidecard"><div>
      <h3>${esc(p.displayName || p.id)}</h3>
      <p>${sheets.length} sheet${sheets.length === 1 ? '' : 's'} · ${actionsAll.length} action${actionsAll.length === 1 ? '' : 's'}${variantSummary ? ` · ${variantSummary.formCount} form${variantSummary.formCount === 1 ? '' : 's'} · ${variantSummary.variantCombos} combo${variantSummary.variantCombos === 1 ? '' : 's'}` : ''} · .charbin${objectMode ? ' · object' : ''}</p>
    </div><button class="btn" id="pkgRename">Rename</button></div>
    ${infoHtml}
    <div class="section-title">${objectMode ? 'Appearances' : 'Attached sheets'}</div>
    <div class="grid cols3" id="pkgSheetGrid">${sheetsHtml}</div>
    ${objectAppearanceHtml}
    ${baseSection}
    <div class="section-title">Game animations</div>
    ${objectMode ? '<div class="card sidecard pkg-form-hint"><p class="tiny">Each clip is a named action on the selected appearance. Pick frame cells from the sheet; enable <b>Loop</b> for repeating cycles.</p></div>' : ''}
    ${pokemonMode && variantSheets.length <= 1 ? `<div class="card sidecard pkg-form-hint"><p class="tiny"><b>One variant in this file.</b> Use <b>Batch import</b> to add forms, shiny, swim, sleep, or eating sheets. Each walk import creates <code>idle</code> + <code>walk</code> actions (no auto <code>pause</code>).</p></div>` : ''}
    ${variantPickerHtml}
    ${objectAnimToolbar}
    <div id="pkgAnimGrid">${animsHtml}</div>`;

  right(`<div class="sidecard card"><h3>Package detail</h3>
    <p class="tiny">${objectMode
    ? '<b>Object</b>: appearances + named animation clips.'
    : '<b>Player/NPC</b>: 4-dir walk. <b>Pokémon</b>: variant sheets.'}</p></div>`);

  $('#pkgBack').onclick = () => {
    if (isPokemonCharType(m.characterType)) {
      capturePokemonDetailVariant();
      capturePokemonLibraryUiFromDom(pkgState.selectedPath);
    }
    if (isObjectCharType(m.characterType)) {
      captureObjectLibraryUiFromDom(pkgState.selectedPath);
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
  $('#pkgPokemonSize')?.addEventListener('change', async () => {
    const size = normalizePokemonSize($('#pkgPokemonSize')?.value);
    await saveDraft({
      baseProfile: pokemonSizeToProfile(size),
      metadata: { pokemonSize: size },
    });
    hydratePkgVisuals();
    toast(`Size → ${pokemonSizeProfileLabel(size)}`);
  });
  if (typeof bindNpcIntelPanel === 'function') bindNpcIntelPanel();
  $$('[data-info-tab]').forEach((button) => button.onclick = () => {
    const profileTab = button.dataset.infoTab === 'profile';
    $('#pkgInfoBasics').hidden = profileTab;
    $('#pkgInfoProfile').hidden = !profileTab;
    $$('[data-info-tab]').forEach((item) => item.classList.toggle('active', item === button));
  });
  updatePkgFieldVisibility();
  $('#pkgObjectAddAnim')?.addEventListener('click', () => openObjectAddAnimationModal());
  $('#pkgObjectAppearance')?.addEventListener('change', (e) => {
    selectPkgSheet(e.target.value);
    refreshObjectSheetPreview();
  });
  $('#pkgObjectAppearanceRename')?.addEventListener('click', () => openObjectRenameAppearanceModal());
  $$('.pkg-sheet-tile').forEach((el) => {
    el.onclick = (e) => {
      if (e.target.closest('.pkg-sheet-inspect') || e.target.closest('.pkg-sheet-rename')) return;
      selectPkgSheet(el.dataset.sheet);
      const appear = $('#pkgObjectAppearance');
      if (appear) appear.value = el.dataset.sheet;
      refreshObjectSheetPreview();
    };
    el.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        selectPkgSheet(el.dataset.sheet);
        refreshObjectSheetPreview();
      }
    };
  });
  $$('[data-sheet-inspect]').forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      openPkgSheetModal(btn.dataset.sheetInspect);
    };
  });
  $$('[data-sheet-rename]').forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      openObjectRenameAppearanceModal(btn.dataset.sheetRename);
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
