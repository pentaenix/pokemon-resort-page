import { renderCompatGraphHtml, bindCompatGraph } from './ontology-picker.js';
import { featureHasDossierContent } from './dossier-shared.js';
import {
  bindGameEngineHub,
  gameEngineHubHtml,
  gameEngineToolById,
  loadGameEngineTools,
  workbenchTitleForTool,
} from './game-engine.js';
import {
  initEditorWorkbench,
  editorWorkbenchHtml,
  bindEditorWorkbench,
  applyEditorBodyClasses,
} from './editor-host.js';
import { atlasMapEditorHtml, bindAtlasMapEditor, initAtlasMapEditorTab } from './atlas-map-editor.js';
import {
  bindDossierEditor,
  bindFeatureDossierEditor,
  dossierEditorHtml,
  featureDossierEditorHtml,
  normalizeFeatureDossierRaw,
  readDossierFromDom,
  readFeatureDossierFromDom,
} from './feature-dossier-editor.js';
import { openAssetUploadModal } from './asset-upload.js';
import { openAssetPickerModal } from './asset-picker-modal.js';

const state = {
  data: null,
  assets: [],
  tab: 'Dashboard',
  selected: { compatFromGen: null, compatToGen: null, doc: null },
  dirty: new Set(),
  boxart: null,
  boxartPicker: { candidates: [], options: [], selectedCandidateId: null, searchQuery: '' },
  bugFilter: 'active',
  bugSearch: '',
  github: { status: null, issues: [], state: 'open', loading: false, error: '' },
  featureFilter: 'active',
  featureSearch: '',
  workshopTab: 'milestones',
  libraryTab: 'games',
  deskReturnTab: 'Dashboard',
  lastDeskKey: '',
  docArticles: {},
  ideaArticles: {},
  gameEngineTools: [],
  gameEngineTool: null,
};
const files = { compatibility:'compatibility.json', bugs:'bugs.json', features:'features.json', research:'research.json', atlasPins:'atlas-pins.json', theme:'theme.json', homepage:'homepage.json', gallery:'gallery.json', models:'models.json', characters:'characters.json', roadmap:'roadmap.json', ideas:'ideas.json', docs:'docs.json' };
const tabs = ['Dashboard','Compatibility','Workshop','Island Atlas','Game Engine','Library','Publish'];
const WORKSHOP_SECTIONS = [
  { id: 'milestones', label: 'Milestones', hint: 'Public roadmap timeline', fileKey: 'roadmap' },
  { id: 'docs', label: 'Docs', hint: 'Technical & design articles', fileKey: 'docs' },
  { id: 'features', label: 'Features', hint: 'On-flight board cards + dossiers', fileKey: 'features' },
  { id: 'bugs', label: 'Bugs', hint: 'Internal bugs + GitHub issues', fileKey: 'bugs' },
  { id: 'ideas', label: 'Ideas', hint: 'Extended sparks for #/ideas', fileKey: 'ideas' },
];
const WORKSHOP_TABS = WORKSHOP_SECTIONS.map((s) => s.id);
const DEFAULT_WORKSHOP_TAB = WORKSHOP_TABS[0];
const LIBRARY_SECTIONS = [
  { id: 'games', label: 'Games', hint: 'Metadata, paths, and box art', fileKey: 'compatibility' },
  { id: 'characters', label: 'Characters', hint: 'Staff, visitors, and sprite registry', fileKey: 'characters' },
  { id: 'media', label: 'Media', hint: 'Gallery records and detected assets', fileKey: 'gallery' },
  { id: 'models', label: 'Models', hint: 'Island GLB stack and submodels', fileKey: 'models' },
];
const LIBRARY_TABS = LIBRARY_SECTIONS.map((s) => s.id);
const DEFAULT_LIBRARY_TAB = LIBRARY_TABS[0];
const RESEARCH_CATEGORIES = ['Location', 'Character', 'Pokémon', 'Species', 'Mechanic', 'Region', 'Timeline', 'Asset', 'Other'];
const TAB_SLUG_ALIASES = {
  'box-art': 'Library',
  'game-library': 'Library',
  'media-library': 'Library',
  'map-editor': 'Game Engine',
  'character-editor': 'Game Engine',
};
const $ = (sel) => document.querySelector(sel);
const esc = (value='') => String(value).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const clone = (x) => JSON.parse(JSON.stringify(x));

function tabToSlug(tab) {
  return String(tab || '').trim().toLowerCase().replace(/\s+/g, '-');
}

function slugToTab(slug) {
  const key = String(slug || '').trim().toLowerCase();
  if (!key || key === '/') return null;
  if (TAB_SLUG_ALIASES[key]) return TAB_SLUG_ALIASES[key];
  return tabs.find((tab) => tabToSlug(tab) === key) || null;
}

function normalizeTabName(tab) {
  if (tab === 'Box Art') return 'Library';
  if (['Milestones', 'Docs', 'Features', 'Bugs', 'Community Issues', 'Ideas'].includes(tab)) return 'Workshop';
  if (['Game Library', 'Media Library', 'Models', 'Characters'].includes(tab)) return 'Library';
  if (tab === 'Map Editor' || tab === 'Character Editor') return 'Game Engine';
  return tab;
}

function legacyGameEngineToolId(tab) {
  if (tab === 'Map Editor') return 'maps';
  if (tab === 'Character Editor') return 'characters';
  return null;
}

function isGameEngineWorkbenchOpen() {
  return state.tab === 'Game Engine' && Boolean(state.gameEngineTool);
}

function normalizeGameEngineToolId(toolId) {
  const key = String(toolId || '').trim().toLowerCase();
  if (!key) return null;
  for (const t of state.gameEngineTools || []) {
    if (t.id === key) return t.id;
    if ((t.legacyRoutes || []).some((route) => String(route).toLowerCase() === key)) return t.id;
  }
  return null;
}

function workshopSectionForTab(tab) {
  const map = {
    Milestones: 'milestones',
    Docs: 'docs',
    Features: 'features',
    Bugs: 'bugs',
    'Community Issues': 'bugs',
    Ideas: 'ideas',
  };
  return map[tab] || null;
}

function librarySectionForTab(tab) {
  const map = {
    'Game Library': 'games',
    'Box Art': 'games',
    'Media Library': 'media',
    Models: 'models',
    Characters: 'characters',
  };
  return map[tab] || null;
}

function librarySectionCount(sectionId) {
  switch (sectionId) {
    case 'games': return (state.data?.['compatibility.json']?.games || []).length;
    case 'media': return (state.data?.['gallery.json']?.items || []).length;
    case 'models': return (state.data?.['models.json']?.submodels || []).length + 1;
    case 'characters': {
      const data = state.data?.['characters.json'] || {};
      return (data.seriesCharacters || []).length + (data.plannedVisitors || []).length + (data.spriteRequirements || []).length;
    }
    default: return 0;
  }
}

function librarySectionFile(sectionId) {
  const key = LIBRARY_SECTIONS.find((s) => s.id === sectionId)?.fileKey;
  return key ? files[key] : null;
}

function workshopSectionCount(sectionId) {
  switch (sectionId) {
    case 'milestones': return (state.data?.['roadmap.json']?.milestones || []).length;
    case 'docs': return (state.data?.['docs.json']?.articles || []).length;
    case 'features': return (state.data?.['features.json']?.features || []).length;
    case 'bugs': return (state.data?.['bugs.json']?.bugs || []).length;
    case 'ideas': return (state.data?.['ideas.json']?.items || []).length;
    default: return 0;
  }
}

function workshopSectionFile(sectionId) {
  const key = WORKSHOP_SECTIONS.find((s) => s.id === sectionId)?.fileKey;
  return key ? files[key] : null;
}

function parseAdminRoute() {
  const raw = window.location.hash.replace(/^#/, '').trim();
  if (!raw) return { tab: null, workshopTab: DEFAULT_WORKSHOP_TAB, libraryTab: DEFAULT_LIBRARY_TAB, gameEngineTool: null };
  const pathPart = (raw.startsWith('/') ? raw.slice(1) : raw).split('?')[0];
  const segments = pathPart.split('/').filter(Boolean).map((part) => decodeURIComponent(part).toLowerCase());
  const first = segments[0] || '';

  if (first === 'workshop') {
    const section = segments[1] || DEFAULT_WORKSHOP_TAB;
    return {
      tab: 'Workshop',
      workshopTab: WORKSHOP_TABS.includes(section) ? section : DEFAULT_WORKSHOP_TAB,
      libraryTab: DEFAULT_LIBRARY_TAB,
      gameEngineTool: null,
    };
  }
  if (first === 'library') {
    const section = segments[1] || DEFAULT_LIBRARY_TAB;
    return {
      tab: 'Library',
      libraryTab: LIBRARY_TABS.includes(section) ? section : DEFAULT_LIBRARY_TAB,
      workshopTab: DEFAULT_WORKSHOP_TAB,
      gameEngineTool: null,
    };
  }
  const legacyWorkshop = {
    milestones: 'milestones',
    roadmap: 'milestones',
    docs: 'docs',
    features: 'features',
    research: 'milestones',
    bugs: 'bugs',
    'community-issues': 'bugs',
    ideas: 'ideas',
  };
  if (legacyWorkshop[first]) {
    return { tab: 'Workshop', workshopTab: legacyWorkshop[first], libraryTab: DEFAULT_LIBRARY_TAB, gameEngineTool: null };
  }
  const legacyLibrary = {
    'game-library': 'games',
    games: 'games',
    'box-art': 'games',
    'media-library': 'media',
    media: 'media',
    models: 'models',
    characters: 'characters',
  };
  if (legacyLibrary[first]) {
    return { tab: 'Library', libraryTab: legacyLibrary[first], workshopTab: DEFAULT_WORKSHOP_TAB, gameEngineTool: null };
  }
  if (first === 'design-lab') {
    return { tab: 'Dashboard', workshopTab: DEFAULT_WORKSHOP_TAB, libraryTab: DEFAULT_LIBRARY_TAB, gameEngineTool: null };
  }
  if (first === 'game-engine' || first === 'game_engine') {
    return {
      tab: 'Game Engine',
      gameEngineTool: segments[1] || null,
      workshopTab: DEFAULT_WORKSHOP_TAB,
      libraryTab: DEFAULT_LIBRARY_TAB,
    };
  }
  if (first === 'map-editor') {
    return { tab: 'Game Engine', gameEngineTool: 'maps', workshopTab: DEFAULT_WORKSHOP_TAB, libraryTab: DEFAULT_LIBRARY_TAB };
  }
  if (first === 'character-editor') {
    return { tab: 'Game Engine', gameEngineTool: 'characters', workshopTab: DEFAULT_WORKSHOP_TAB, libraryTab: DEFAULT_LIBRARY_TAB };
  }

  return { tab: slugToTab(first), workshopTab: DEFAULT_WORKSHOP_TAB, libraryTab: DEFAULT_LIBRARY_TAB, gameEngineTool: null };
}

function readTabFromLocation() {
  return parseAdminRoute().tab;
}

function tabHref(tab, { workshopTab = state.workshopTab, libraryTab = state.libraryTab, gameEngineTool = state.gameEngineTool } = {}) {
  if (tab === 'Workshop') {
    const section = WORKSHOP_TABS.includes(workshopTab) ? workshopTab : DEFAULT_WORKSHOP_TAB;
    return `#/workshop/${section}`;
  }
  if (tab === 'Library') {
    const section = LIBRARY_TABS.includes(libraryTab) ? libraryTab : DEFAULT_LIBRARY_TAB;
    return `#/library/${section}`;
  }
  if (tab === 'Game Engine') {
    const tool = normalizeGameEngineToolId(gameEngineTool);
    return tool ? `#/game-engine/${tool}` : '#/game-engine';
  }
  return `#/${tabToSlug(tab)}`;
}

function syncUrlToTab(tab, { replace = false, workshopTab = state.workshopTab, libraryTab = state.libraryTab, gameEngineTool = state.gameEngineTool } = {}) {
  const href = tabHref(tab, { workshopTab, libraryTab, gameEngineTool });
  if (window.location.hash === href) return;
  const fn = replace ? 'replaceState' : 'pushState';
  history[fn](null, '', href);
}

function waitForAdminTransition() {
  const viewport = $('#adminViewport');
  if (!viewport) return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      viewport.removeEventListener('transitionend', onEnd);
      resolve();
    };
    const onEnd = (event) => {
      if (event.target === viewport && (event.propertyName === 'margin-left' || event.propertyName === 'transform')) finish();
    };
    viewport.addEventListener('transitionend', onEnd);
    setTimeout(finish, 520);
  });
}

function deskContentTab() {
  if (state.tab === 'Game Engine') return 'Game Engine';
  return state.tab;
}

function workbenchBackLabel() {
  return state.tab === 'Game Engine' ? 'Back to Game Engine' : 'Back to Admin';
}

function workbenchLoadingShell(title) {
  const label = workbenchBackLabel();
  return `<section class="workbench-page">
    <section class="toolbar workbench-commandbar">
      <div class="workbench-brand">
        <button type="button" class="workbench-menu-btn" id="workbenchExit">${esc(label)}</button>
        <span class="workbench-menu-title">${esc(title)}</span>
      </div>
    </section>
    <div class="workbench-loading">Loading…</div>
  </section>`;
}

function bindWorkbenchEscape() {
  for (const id of ['workbenchExit', 'mapExitWorkbench', 'characterExitWorkbench']) {
    const btn = document.getElementById(id);
    if (btn) {
      btn.onclick = () => {
        if (isGameEngineWorkbenchOpen()) void closeGameEngineWorkbench();
        else navigateToTab(state.deskReturnTab || 'Dashboard');
      };
    }
  }
  const panic = $('#workbenchPanicBack');
  if (panic) {
    panic.onclick = () => {
      if (isGameEngineWorkbenchOpen()) void closeGameEngineWorkbench();
      else navigateToTab(state.deskReturnTab || 'Dashboard');
    };
    const hasBar = document.getElementById('workbenchExit')
      || document.getElementById('mapExitWorkbench')
      || document.getElementById('characterExitWorkbench');
    panic.hidden = !document.body.classList.contains('workbench-open') || Boolean(hasBar);
  }
}

function initWorkbenchEscapeKey() {
  if (window.__deskWorkbenchEscapeBound) return;
  window.__deskWorkbenchEscapeBound = true;
  window.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    if (!document.body.classList.contains('workbench-open')) return;
    event.preventDefault();
    if (isGameEngineWorkbenchOpen()) void closeGameEngineWorkbench();
    else navigateToTab(state.deskReturnTab || 'Dashboard');
  });
  window.addEventListener('pageshow', (event) => {
    if (!event.persisted) return;
    document.body.classList.remove('workbench-open');
    void render();
  });
}

async function openGameEngineTool(toolId, { replace = false } = {}) {
  const id = normalizeGameEngineToolId(toolId);
  if (!id) return;
  if (state.tab !== 'Game Engine') {
    state.deskReturnTab = deskContentTab();
    state.tab = 'Game Engine';
  }
  state.gameEngineTool = id;
  syncUrlToTab('Game Engine', { replace });
  renderTabs();
  await render();
}

async function closeGameEngineWorkbench({ replace = false } = {}) {
  if (!isGameEngineWorkbenchOpen()) return;
  state.gameEngineTool = null;
  document.body.classList.remove('workbench-open');
  await waitForAdminTransition();
  syncUrlToTab('Game Engine', { replace });
  renderTabs();
  await render();
}

async function leaveGameEngineWorkbenchForTab(targetTab, { replace = false } = {}) {
  if (!isGameEngineWorkbenchOpen()) return;
  state.gameEngineTool = null;
  document.body.classList.remove('workbench-open');
  await waitForAdminTransition();
  const normalized = normalizeTabName(targetTab);
  state.tab = tabs.includes(normalized) ? normalized : (state.deskReturnTab || 'Dashboard');
  syncUrlToTab(state.tab, { replace, workshopTab: state.workshopTab, libraryTab: state.libraryTab });
  renderTabs();
  await render();
}

function deskRenderKey(tab) {
  if (tab === 'Workshop') return `${tab}|${state.workshopTab}`;
  if (tab === 'Library') return `${tab}|${state.libraryTab}`;
  return tab;
}

async function navigateToTab(tab, { replace = false } = {}) {
  const legacyTool = legacyGameEngineToolId(tab);
  const workshopSection = workshopSectionForTab(tab);
  if (workshopSection) {
    if (isGameEngineWorkbenchOpen()) {
      await leaveGameEngineWorkbenchForTab('Workshop', { replace });
      setWorkshopTab(workshopSection, { replace });
      return;
    }
    setWorkshopTab(workshopSection, { replace });
    return;
  }
  const librarySection = librarySectionForTab(tab);
  if (librarySection) {
    if (isGameEngineWorkbenchOpen()) {
      await leaveGameEngineWorkbenchForTab('Library', { replace });
      setLibraryTab(librarySection, { replace });
      return;
    }
    setLibraryTab(librarySection, { replace });
    return;
  }
  const normalized = normalizeTabName(tab);
  if (legacyTool) {
    await openGameEngineTool(legacyTool, { replace });
    return;
  }
  if (!tabs.includes(normalized)) return;
  if (normalized === 'Game Engine') {
    if (isGameEngineWorkbenchOpen()) {
      await closeGameEngineWorkbench({ replace });
      return;
    }
    if (state.tab === 'Game Engine') return;
    state.gameEngineTool = null;
    state.tab = 'Game Engine';
    syncUrlToTab(state.tab, { replace });
    renderTabs();
    await render();
    return;
  }
  if (isGameEngineWorkbenchOpen()) {
    await leaveGameEngineWorkbenchForTab(normalized, { replace });
    return;
  }
  if (state.tab === 'Workshop' && normalized !== 'Workshop') persistWorkshopTabDraft(state.workshopTab);
  if (state.tab === 'Library' && normalized !== 'Library') persistLibraryTabDraft(state.libraryTab);
  state.tab = normalized;
  syncUrlToTab(state.tab, { replace });
  renderTabs();
  await render();
}

function setWorkshopTab(tabKey, { replace = false } = {}) {
  if (!WORKSHOP_TABS.includes(tabKey)) return;
  if (state.tab === 'Workshop' && state.workshopTab === tabKey) return;
  if (state.tab === 'Workshop') persistWorkshopTabDraft(state.workshopTab);
  if (state.tab === 'Library') persistLibraryTabDraft(state.libraryTab);
  state.workshopTab = tabKey;
  if (state.tab !== 'Workshop') state.tab = 'Workshop';
  syncUrlToTab('Workshop', { replace, workshopTab: tabKey });
  renderTabs();
  render();
}

function setLibraryTab(tabKey, { replace = false } = {}) {
  if (!LIBRARY_TABS.includes(tabKey)) return;
  if (state.tab === 'Library' && state.libraryTab === tabKey) return;
  if (state.tab === 'Library') persistLibraryTabDraft(state.libraryTab);
  if (state.tab === 'Workshop') persistWorkshopTabDraft(state.workshopTab);
  state.libraryTab = tabKey;
  if (state.tab !== 'Library') state.tab = 'Library';
  syncUrlToTab('Library', { replace, libraryTab: tabKey });
  renderTabs();
  render();
}

function stamp() {
  return new Date().toLocaleTimeString();
}
function setLogStatus(text, tone = '') {
  const el = $('#logStatus');
  if (!el) return;
  el.textContent = text;
  el.className = `log-status${tone ? ` ${tone}` : ''}`;
}
function log(message, tone = '') {
  const el = $('#deskLog');
  if (!el) return;
  const prefix = tone === 'error' ? '✗' : tone === 'ok' ? '✓' : tone === 'warn' ? '!' : '·';
  el.textContent += `[${stamp()}] ${prefix} ${message}\n`;
  el.scrollTop = el.scrollHeight;
  if (tone === 'error') setLogStatus('Error', 'error');
  else if (tone === 'ok') setLogStatus('Done', 'ok');
}
function toast(text) {
  log(text.replace(/\n/g, ' | '));
}
function proxyImage(url) {
  return `/api/boxart/proxy?url=${encodeURIComponent(url)}`;
}

async function api(path, options) {
  const method = options?.method || 'GET';
  log(`${method} ${path}`);
  setLogStatus('Working…', 'busy');
  let response;
  try {
    response = await fetch(path, options);
  } catch (error) {
    log(`Network error: ${error.message}`, 'error');
    throw error;
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    log(`Invalid JSON from ${path} (HTTP ${response.status})`, 'error');
    throw new Error(`Invalid JSON from ${path}`);
  }
  if (!response.ok) {
    const detail = payload.error || payload.output || payload.validation || JSON.stringify(payload).slice(0, 240);
    log(`HTTP ${response.status}: ${detail}`, 'error');
    throw new Error(detail);
  }
  log(`HTTP ${response.status} OK`, 'ok');
  return payload;
}
function setLogDockCollapsed(collapsed) {
  const dock = $('#logDock');
  const btn = $('#toggleLogDock');
  document.body.classList.toggle('log-dock-collapsed', collapsed);
  dock?.classList.toggle('is-collapsed', collapsed);
  if (btn) {
    btn.textContent = collapsed ? '▲' : '▼';
    btn.setAttribute('aria-expanded', String(!collapsed));
    btn.title = collapsed ? 'Show activity log' : 'Hide activity log';
  }
  try { localStorage.setItem('deskLogCollapsed', collapsed ? '1' : '0'); } catch { /* ignore */ }
}
function initLogDockToggle() {
  let collapsed = false;
  try { collapsed = localStorage.getItem('deskLogCollapsed') === '1'; } catch { /* ignore */ }
  setLogDockCollapsed(collapsed);
  const btn = $('#toggleLogDock');
  if (btn) btn.onclick = () => setLogDockCollapsed(!document.body.classList.contains('log-dock-collapsed'));
}
async function boot() {
  document.body.classList.remove('workbench-open');
  initWorkbenchEscapeKey();
  initLogDockToggle();
  const route = parseAdminRoute();
  if (route.tab) state.tab = normalizeTabName(route.tab);
  if (route.workshopTab) state.workshopTab = route.workshopTab;
  if (route.libraryTab) state.libraryTab = route.libraryTab;
  if (route.tab === 'Game Engine' && !route.gameEngineTool) state.deskReturnTab = 'Dashboard';
  state.gameEngineTools = await loadGameEngineTools(api);
  if (route.gameEngineTool) {
    state.gameEngineTool = normalizeGameEngineToolId(route.gameEngineTool);
  }
  window.addEventListener('hashchange', async () => {
    const nextRoute = parseAdminRoute();
    if (!nextRoute.tab) return;
    const normalized = normalizeTabName(nextRoute.tab);
    if (!tabs.includes(normalized)) return;
    const toolChanged = normalized === 'Game Engine'
      && normalizeGameEngineToolId(nextRoute.gameEngineTool) !== state.gameEngineTool;
    const tabChanged = normalized !== state.tab;
    const workshopChanged = normalized === 'Workshop' && nextRoute.workshopTab !== state.workshopTab;
    const libraryChanged = normalized === 'Library' && nextRoute.libraryTab !== state.libraryTab;
    if (!tabChanged && !workshopChanged && !libraryChanged && !toolChanged) return;
    if (isGameEngineWorkbenchOpen() && normalized !== 'Game Engine') {
      document.body.classList.remove('workbench-open');
      await waitForAdminTransition();
    }
    if (state.tab === 'Workshop' && (tabChanged || workshopChanged)) {
      persistWorkshopTabDraft(state.workshopTab);
    }
    if (state.tab === 'Library' && (tabChanged || libraryChanged)) {
      persistLibraryTabDraft(state.libraryTab);
    }
    if (normalized === 'Game Engine' && !isGameEngineWorkbenchOpen() && state.tab !== 'Game Engine') {
      state.deskReturnTab = deskContentTab();
    }
    state.tab = normalized;
    if (normalized === 'Workshop') state.workshopTab = nextRoute.workshopTab;
    if (normalized === 'Library') state.libraryTab = nextRoute.libraryTab;
    if (normalized === 'Game Engine') {
      state.gameEngineTool = normalizeGameEngineToolId(nextRoute.gameEngineTool);
    } else {
      state.gameEngineTool = null;
    }
    renderTabs();
    await render();
  });
  const payload = await api('/api/data');
  state.data = payload.files || payload;
  state.docArticles = payload.docArticles || {};
  state.ideaArticles = payload.ideaArticles || {};
  state.assets = (await api('/api/assets')).assets;
  renderTabs();
  syncUrlToTab(state.tab, { replace: true });
  try {
    await render();
  } catch (error) {
    document.body.classList.remove('workbench-open');
    state.gameEngineTool = null;
    state.tab = 'Dashboard';
    syncUrlToTab('Dashboard', { replace: true });
    renderTabs();
    log(`Desk failed to load: ${error.message}`, 'error');
    await render();
  }
}
function renderTabs() {
  $('#tabs').innerHTML = tabs.map(tab => `<button class="${state.tab===tab?'active':''}" data-tab="${tab}">${tab}</button>`).join('');
  $('#tabs').onclick = (event) => {
    const btn = event.target.closest('button[data-tab]');
    if (!btn) return;
    navigateToTab(btn.dataset.tab);
  };
}
function markDirty(file) { state.dirty.add(file); }
function readFormFields(root) {
  if (!root) return {};
  const data = {};
  root.querySelectorAll('input, select, textarea').forEach((field) => {
    if (!field.name || field.type === 'checkbox') return;
    data[field.name] = field.value;
  });
  return data;
}
function formData(root) {
  const el = typeof root === 'string' ? document.querySelector(root) : (root || document.querySelector('.form'));
  if (!el) return {};
  if (el instanceof HTMLFormElement) return Object.fromEntries(new FormData(el).entries());
  return readFormFields(el);
}
function flashEl(el, className, ms = 900) {
  if (!el) return;
  el.classList.add(className);
  setTimeout(() => el.classList.remove(className), ms);
}
async function saveCompatibilityToDisk() {
  const advanced = document.querySelector('.compat-advanced');
  if (advanced?.open && document.querySelector('[data-form="route"]')) updateRouteFromForm();
  if (!state.dirty.has(files.compatibility)) {
    log('No compatibility changes to save.', 'warn');
    return;
  }
  await saveFile(files.compatibility, state.data['compatibility.json']);
  log('Written to public/data/compatibility.json. Switch to the Ontology browser tab (or hard-refresh) to see it.', 'ok');
  render();
}
function bindSaveCompatibilityButtons() {
  const dirty = state.dirty.has(files.compatibility);
  document.querySelectorAll('.js-save-compatibility').forEach((btn) => {
    btn.disabled = !dirty;
    btn.onclick = async (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (btn.disabled) return;
      btn.classList.add('btn-busy');
      btn.disabled = true;
      setLogStatus('Saving…', 'busy');
      try {
        await saveCompatibilityToDisk();
        flashEl(btn, 'btn-flash-ok');
        flashEl(document.querySelector('.compat-preview'), 'compat-flash-ok');
      } catch (e) {
        log(e.message, 'error');
        flashEl(btn, 'btn-flash-error');
      } finally {
        btn.classList.remove('btn-busy');
        bindSaveCompatibilityButtons();
      }
    };
  });
}
function logValidationWarnings(result, label) {
  if (result?.validationOk !== false) return;
  log(result.validationWarning || `${label}: validation warnings`, 'warn');
  if (result.validation) log(result.validation, 'warn');
}
async function saveFile(file, data) {
  const result = await api('/api/save', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ file, data }) });
  state.dirty.delete(file);
  logValidationWarnings(result, `Saved ${file}`);
  toast(result.validationOk === false ? `Saved ${file}. Validation warnings (see log).` : `Saved ${file}. Validated.`);
}
function dashboard() {
  const routes = state.data['compatibility.json'].routes;
  const bugs = state.data['bugs.json'].bugs;
  const features = state.data['features.json'].features;
  const pins = state.data['atlas-pins.json']?.pins || [];
  const cards = [
    ['Open/blocked bugs', bugs.filter(b => ['Open','Blocked'].includes(b.status)).length],
    ['Untested routes', routes.filter(r => r.status === 'gray').length],
    ['Known failing routes', routes.filter(r => r.status === 'red').length],
    ['On-flight features', features.filter(f => ['On-Flight','Testing'].includes(f.stage)).length],
    ['Atlas cork pins', pins.length],
  ];
  return `<section class="grid dashboard">${cards.map(([label,val]) => `<article class="card"><span>${label}</span><strong>${val}</strong></article>`).join('')}</section>
  <section class="panel" style="margin-top:16px"><h2>Needs attention</h2><div class="grid">${attentionItems().map(item => `<p><span class="badge">${item.type}</span> ${item.text}</p>`).join('')}</div></section>
  <section class="panel" style="margin-top:16px"><h2>Quick actions</h2><div class="actions"><button class="btn" data-go="Compatibility">Update Compatibility</button><button class="btn" data-go="Bugs">Add Bug</button><button class="btn" data-go="Workshop">Open Workshop</button><button class="btn ghost" data-game-engine-launch="maps">Map editor</button><button class="btn ghost" data-go="Game Engine">Game Engine</button><button class="btn ghost" data-go="Library">Library & box art</button><button class="btn ghost" data-go="Publish">Preview / Publish</button></div></section>`;
}
function attentionItems() {
  const data = state.data;
  const games = data['compatibility.json'].games;
  const routes = data['compatibility.json'].routes;
  const bugs = data['bugs.json'].bugs;
  const pins = data['atlas-pins.json']?.pins || [];
  const items = [];
  games.filter(g => !g.boxArt || !state.assets.includes(g.boxArt)).slice(0,6).forEach(g => items.push({ type:'Library', text:`${g.title} needs local box art at ${g.boxArt}.` }));
  routes.filter(r => r.status === 'red' && !r.relatedBugs?.length).slice(0,4).forEach(r => items.push({ type:'Compatibility', text:`${r.title} is red but has no linked bug.` }));
  bugs.filter(b => b.status === 'Fixed' && b.linkedRoutes?.length).slice(0,3).forEach(b => items.push({ type:'Issue Desk', text:`${b.id} is fixed; verify linked routes are updated.` }));
  pins.filter(p => !p.summary?.trim()).slice(0,3).forEach(p => items.push({ type:'Island Atlas', text:`Cork pin ${p.name} has no hover summary yet.` }));
  return items.length ? items : [{ type:'Resort', text:'Everything has the minimum data needed. Nice.' }];
}
function list(items, selectedId, labelFn) {
  return `<div class="list">${items.map(item => `<button class="${selectedId===item.id?'active':''}" data-id="${item.id}"><strong>${esc(labelFn(item))}</strong><span>${esc(item.id)}</span></button>`).join('')}</div>`;
}
function workshopPickerList(kind, items, selectedId, labelFn, metaFn) {
  return `<div class="list feature-list workshop-picker-list">${items.length ? items.map((item) => {
    const meta = metaFn ? metaFn(item) : item.id;
    return `<button type="button" class="workshop-picker-item${selectedId === item.id ? ' active' : ''}" data-workshop-kind="${kind}" data-id="${esc(item.id)}">
      <strong>${esc(labelFn(item))}</strong>
      <span class="feature-list-meta">${esc(meta)}</span>
    </button>`;
  }).join('') : '<p class="hint feature-list-empty">Nothing here yet.</p>'}</div>`;
}
function persistWorkshopTabDraft(tabKey) {
  if (tabKey === 'milestones') applyMilestoneFromForm({ persistOnly: true });
  else if (tabKey === 'docs') applyDocFromForm({ persistOnly: true });
  else if (tabKey === 'features') applyFeatureFromForm({ persistOnly: true });
  else if (tabKey === 'bugs') applyBugFromForm({ persistOnly: true });
  else if (tabKey === 'ideas') applyIdeaFromForm({ persistOnly: true });
}

function workshopTabBarHtml() {
  const active = state.workshopTab || DEFAULT_WORKSHOP_TAB;
  const items = WORKSHOP_SECTIONS.map((section) => {
    const file = workshopSectionFile(section.id);
    const count = workshopSectionCount(section.id);
    return {
      ...section,
      count,
      dirty: file ? state.dirty.has(file) : false,
    };
  });
  return `<div class="workshop-tabs" role="tablist" aria-label="Workshop sections">
    ${items.map((item) => `<button type="button" class="workshop-tab ${active === item.id ? 'active' : ''}" data-workshop-tab="${item.id}" role="tab" aria-selected="${active === item.id ? 'true' : 'false'}">
      <span class="workshop-tab-label">${esc(item.label)} <span class="workshop-tab-count">${item.count}</span></span>
      <span class="workshop-tab-hint">${esc(item.hint)}</span>
      ${item.dirty ? '<span class="workshop-tab-badge">Unsaved</span>' : ''}
    </button>`).join('')}
  </div>`;
}

function updateWorkshopSaveHints() {
  WORKSHOP_SECTIONS.forEach((section) => {
    const file = workshopSectionFile(section.id);
    if (!file) return;
    const dirty = state.dirty.has(file);
    const hint = document.querySelector(`[data-workshop-tab-panel="${section.id}"] .feature-save-hint`);
    if (hint) {
      hint.textContent = dirty ? 'Unsaved' : 'Saved';
      hint.classList.toggle('is-dirty', dirty);
    }
    const tabBtn = document.querySelector(`[data-workshop-tab="${section.id}"]`);
    if (!tabBtn) return;
    let badge = tabBtn.querySelector('.workshop-tab-badge');
    if (dirty && !badge) {
      badge = document.createElement('span');
      badge.className = 'workshop-tab-badge';
      badge.textContent = 'Unsaved';
      tabBtn.appendChild(badge);
    } else if (!dirty && badge) {
      badge.remove();
    }
  });
  const dirtyNote = WORKSHOP_SECTIONS
    .map((section) => state.dirty.has(workshopSectionFile(section.id)) && section.id)
    .filter(Boolean);
  const toolbarHint = document.querySelector('.workshop-toolbar .feature-unsaved, .workshop-toolbar .feature-disk-ok');
  if (toolbarHint) {
    toolbarHint.outerHTML = dirtyNote.length
      ? `<p class="hint feature-unsaved"><strong>Unsaved:</strong> ${dirtyNote.join(', ')}</p>`
      : '<p class="hint feature-disk-ok">All workshop files in sync with disk.</p>';
  }
}

function persistLibraryJsonDraft(file) {
  const el = $('#jsonEditor');
  if (!el) return;
  try {
    const next = JSON.parse(el.value);
    const before = clone(state.data[file]);
    state.data[file] = next;
    if (JSON.stringify(before) !== JSON.stringify(next)) markDirty(file);
  } catch { /* keep prior in-memory draft when JSON is invalid */ }
}

function persistGameFromForm() {
  const form = document.querySelector('[data-form="game"]');
  if (!form || !state.selected.game) return;
  const d = readFormFields(form);
  const game = state.data['compatibility.json'].games.find((g) => g.id === state.selected.game);
  if (!game) return;
  const before = clone(game);
  const nextId = (d.id || game.id).trim();
  Object.assign(game, {
    id: nextId,
    title: d.title ?? game.title,
    generation: d.generation ?? game.generation,
    shortTitle: d.shortTitle ?? game.shortTitle,
    platform: d.platform ?? game.platform,
    releaseYear: Number(d.releaseYear ?? game.releaseYear) || game.releaseYear,
    family: d.family ?? game.family,
    boxArt: d.boxArt ?? game.boxArt,
  });
  state.selected.game = nextId;
  if (recordChanged(before, game)) markDirty(files.compatibility);
}

function persistModelsFromForm() {
  const form = document.querySelector('[data-form="models"]');
  if (!form) return;
  const d = readFormFields(form);
  const models = state.data['models.json'];
  const before = clone(models.mainModel);
  Object.assign(models.mainModel, {
    name: d.mainName ?? models.mainModel.name,
    status: d.mainStatus ?? models.mainModel.status,
    file: d.mainFile ?? models.mainModel.file,
    preview: d.mainPreview ?? models.mainModel.preview,
    summary: d.mainSummary ?? models.mainModel.summary,
    displaySize: Math.min(120, Math.max(0.5, Number(d.mainDisplaySize) || models.mainModel.displaySize || 6.2)),
  });
  if (recordChanged(before, models.mainModel)) markDirty(files.models);
}

function persistLibraryTabDraft(tabKey) {
  if (tabKey === 'games') persistGameFromForm();
  else if (tabKey === 'models') persistModelsFromForm();
  else if (tabKey === 'media') persistLibraryJsonDraft(files.gallery);
  else if (tabKey === 'characters') persistLibraryJsonDraft(files.characters);
}

function libraryTabBarHtml() {
  const active = state.libraryTab || DEFAULT_LIBRARY_TAB;
  const items = LIBRARY_SECTIONS.map((section) => {
    const file = librarySectionFile(section.id);
    const count = librarySectionCount(section.id);
    return {
      ...section,
      count,
      dirty: file ? state.dirty.has(file) : false,
    };
  });
  return `<div class="workshop-tabs library-tabs" role="tablist" aria-label="Library sections">
    ${items.map((item) => `<button type="button" class="workshop-tab library-tab ${active === item.id ? 'active' : ''}" data-library-tab="${item.id}" role="tab" aria-selected="${active === item.id ? 'true' : 'false'}">
      <span class="workshop-tab-label">${esc(item.label)} <span class="workshop-tab-count">${item.count}</span></span>
      <span class="workshop-tab-hint">${esc(item.hint)}</span>
      ${item.dirty ? '<span class="workshop-tab-badge">Unsaved</span>' : ''}
    </button>`).join('')}
  </div>`;
}

function updateLibrarySaveHints() {
  LIBRARY_SECTIONS.forEach((section) => {
    const file = librarySectionFile(section.id);
    if (!file) return;
    const dirty = state.dirty.has(file);
    const hint = document.querySelector(`[data-library-tab-panel="${section.id}"] .feature-save-hint`);
    if (hint) {
      hint.textContent = dirty ? 'Unsaved' : 'Saved';
      hint.classList.toggle('is-dirty', dirty);
    }
    const tabBtn = document.querySelector(`[data-library-tab="${section.id}"]`);
    if (!tabBtn) return;
    let badge = tabBtn.querySelector('.workshop-tab-badge');
    if (dirty && !badge) {
      badge = document.createElement('span');
      badge.className = 'workshop-tab-badge';
      badge.textContent = 'Unsaved';
      tabBtn.appendChild(badge);
    } else if (!dirty && badge) {
      badge.remove();
    }
  });
  const dirtyNote = LIBRARY_SECTIONS
    .map((section) => state.dirty.has(librarySectionFile(section.id)) && section.id)
    .filter(Boolean);
  const toolbarHint = document.querySelector('.library-toolbar .feature-unsaved, .library-toolbar .feature-disk-ok');
  if (toolbarHint) {
    toolbarHint.outerHTML = dirtyNote.length
      ? `<p class="hint feature-unsaved"><strong>Unsaved:</strong> ${dirtyNote.join(', ')}</p>`
      : '<p class="hint feature-disk-ok">All library files in sync with disk.</p>';
  }
}

function bindLibraryDesk() {
  document.querySelectorAll('[data-library-tab]').forEach((btn) => {
    btn.onclick = () => setLibraryTab(btn.dataset.libraryTab);
  });
}

function genLabel(data, genId) {
  return data.generations.find((g) => g.id === genId)?.label || genId.replace('gen', 'Gen ');
}
function findRouteForGens(data, fromGen, toGen) {
  if (!fromGen || !toGen) return { fromGen, toGen, route: null };
  const route = data.routes.find((r) => r.id === `${fromGen}-${toGen}`);
  return { fromGen, toGen, route };
}
function gamesInGeneration(data, genId) {
  return (data.games || []).filter((g) => g.generation === genId).map((g) => g.shortTitle).join(', ');
}
function coverageForStatus(status) {
  return ({ gray: 'Untested', blue: 'Needs more tests', yellow: 'Edge cases failing', green: 'Working', red: 'Known failure' })[status] || 'Untested';
}
function buildRouteTitle(data, fromGen, toGen) {
  if (fromGen === toGen) return `${genLabel(data, fromGen)} → Resort → ${genLabel(data, fromGen)}`;
  return `${genLabel(data, fromGen)} → ${genLabel(data, toGen)} → ${genLabel(data, fromGen)}`;
}
function buildRouteSummary(data, fromGen, toGen, status) {
  const statusLabel = data.statuses[status]?.label || status;
  const fromName = genLabel(data, fromGen);
  const toName = genLabel(data, toGen);
  if (fromGen === toGen) {
    if (status === 'green') return `${fromName} self round-trip is documented as working.`;
    if (status === 'red') return `${fromName} self round-trip is currently marked as not working.`;
    if (status === 'yellow') return `${fromName} self round-trip has partial success with known edge-case failures.`;
    if (status === 'blue') return `${fromName} self round-trip needs more test coverage (${statusLabel}).`;
    return `${fromName} self round-trip has not been tested yet.`;
  }
  if (status === 'green') return `Round trip ${fromName} → ${toName} → ${fromName} is documented as working.`;
  if (status === 'red') return `Round trip ${fromName} → ${toName} → ${fromName} is currently marked as not working.`;
  if (status === 'yellow') return `Round trip ${fromName} → ${toName} → ${fromName} has partial success with known edge-case failures.`;
  if (status === 'blue') return `Round trip ${fromName} → ${toName} → ${fromName} needs more test coverage (${statusLabel}).`;
  return `Directional route ${fromName} → ${toName} → ${fromName} is untested. Status will update after round-trip evidence is recorded.`;
}
function applyCompatibilityRoute(fromGen, toGen, status) {
  const data = state.data['compatibility.json'];
  const { route } = findRouteForGens(data, fromGen, toGen);
  if (!fromGen || !toGen) throw new Error('Pick both generations first.');
  if (!route) throw new Error(`No route record for ${fromGen}-${toGen}.`);
  const statusChanged = route.status !== status;
  Object.assign(route, {
    from: fromGen,
    to: toGen,
    status,
    title: buildRouteTitle(data, fromGen, toGen),
    summary: buildRouteSummary(data, fromGen, toGen, status),
    coverage: coverageForStatus(status),
    ...(statusChanged ? { lastUpdated: new Date().toISOString().slice(0, 10) } : {}),
  });
  if (statusChanged) markDirty(files.compatibility);
  state.selected.route = route.id;
  state.selected.compatFromGen = fromGen;
  state.selected.compatToGen = toGen;
  return route;
}
function generationOptions(generations, selectedId) {
  return generations.map((g) => `<option value="${esc(g.id)}" ${g.id === selectedId ? 'selected' : ''}>${esc(g.label)}</option>`).join('');
}
function statusOptions(data, selected) {
  return Object.entries(data.statuses).map(([key, val]) => `<option value="${key}" ${key === selected ? 'selected' : ''}>${esc(val.label)}</option>`).join('');
}
function compatPreviewHtml(data, fromGen, toGen, route) {
  if (!route) return '<p class="hint">Could not find a route for this generation pair.</p>';
  const fromGames = gamesInGeneration(data, fromGen);
  const toGames = gamesInGeneration(data, toGen);
  return `<div class="compat-preview">
    <div class="compat-preview-head"><span class="badge">${esc(route.id)}</span><span class="badge compat-status-${esc(route.status)}">${esc(data.statuses[route.status]?.label || route.status)}</span><span class="hint">Draft in memory: save when ready</span></div>
    <h3>${esc(route.title)}</h3>
    <p>${esc(route.summary)}</p>
    <p class="hint">Coverage: <strong>${esc(route.coverage)}</strong> · Last updated: <strong>${esc(route.lastUpdated)}</strong>${fromGames ? ` · ${esc(genLabel(data, fromGen))} games: ${esc(fromGames)}` : ''}${toGen !== fromGen && toGames ? ` · ${esc(genLabel(data, toGen))} games: ${esc(toGames)}` : ''}</p>
  </div>`;
}
function updateCompatDirtyHint() {
  const dirty = state.dirty.has(files.compatibility);
  document.querySelectorAll('.compat-save-hint').forEach((el) => {
    el.textContent = dirty ? 'Unsaved draft: click Save' : 'Saved to disk';
    el.classList.toggle('is-dirty', dirty);
  });
  const toolbar = document.querySelector('.compat-toolbar > div');
  if (!toolbar) return;
  const unsaved = toolbar.querySelector('.compat-unsaved');
  const ok = toolbar.querySelector('.compat-disk-ok');
  if (dirty) {
    ok?.remove();
    if (!unsaved) toolbar.insertAdjacentHTML('beforeend', '<p class="hint compat-unsaved"><strong>Not on disk yet</strong>: save, then refresh Ontology.</p>');
  } else {
    unsaved?.remove();
    if (!ok) toolbar.insertAdjacentHTML('beforeend', '<p class="hint compat-disk-ok">In sync with disk.</p>');
  }
}
function updateCompatGraph(data, selectedRouteId) {
  const host = $('#compatGraphHost');
  if (!host) return;
  host.innerHTML = renderCompatGraphHtml(data, selectedRouteId);
  bindCompatGraph(host, data, {
    onSelectRoute: (route) => {
      state.selected.compatFromGen = route.from;
      state.selected.compatToGen = route.to;
      state.selected.route = route.id;
      syncCompatUIFromState();
    },
  });
}
function refreshCompatAdvanced(route, data) {
  const details = document.querySelector('.compat-advanced');
  if (!details) return;
  const wasOpen = details.open;
  const summaryHtml = '<summary>Fine-tune this route (bugs, checklist, manual text)</summary>';
  details.innerHTML = summaryHtml + (route ? routeForm(route, data) : '<p>Select a valid generation pair above.</p>');
  details.open = wasOpen;
  const compatApplyManual = $('#compatApplyManual');
  if (compatApplyManual) compatApplyManual.onclick = () => {
    try { updateRouteFromForm(); log('Manual route edits applied in memory.', 'ok'); syncCompatUIFromState(); }
    catch (e) { log(e.message, 'error'); }
  };
  const addRouteTest = $('#addRouteTest');
  if (addRouteTest) addRouteTest.onclick = () => addCheck('RouteTest');
  document.querySelectorAll('#routeTests [data-remove]').forEach((btn) => {
    btn.onclick = () => btn.closest('.check-row')?.remove();
  });
}
function applyCompatStatusFromPicker() {
  const statusSel = $('#compatStatus');
  const status = statusSel?.value || 'gray';
  const route = applyCompatibilityRoute(state.selected.compatFromGen, state.selected.compatToGen, status);
  syncCompatUIFromState();
  flashEl(document.querySelector('.compat-preview'), 'compat-flash-ok');
  return route;
}
function syncCompatUIFromState() {
  const data = state.data['compatibility.json'];
  const fromGen = state.selected.compatFromGen;
  const toGen = state.selected.compatToGen;
  const { route } = findRouteForGens(data, fromGen, toGen);
  if (route) state.selected.route = route.id;
  const fromSel = $('#compatFromGen');
  const toSel = $('#compatToGen');
  const statusSel = $('#compatStatus');
  if (fromSel && fromGen && fromSel.value !== fromGen) fromSel.value = fromGen;
  if (toSel && toGen && toSel.value !== toGen) toSel.value = toGen;
  if (statusSel && route && statusSel.value !== route.status) statusSel.value = route.status;
  const previewHost = $('#compatPreviewHost');
  if (previewHost) previewHost.innerHTML = compatPreviewHtml(data, fromGen, toGen, route);
  updateCompatGraph(data, route?.id);
  updateCompatDirtyHint();
  bindSaveCompatibilityButtons();
  document.querySelectorAll('.compat-browse .list button[data-id]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.id === state.selected.route);
  });
  if (document.querySelector('.compat-advanced')?.open) refreshCompatAdvanced(route, data);
}
function compatibility() {
  const data = state.data['compatibility.json'];
  const gens = data.generations;
  const fromGen = state.selected.compatFromGen || gens[0]?.id;
  const toGen = state.selected.compatToGen || gens[1]?.id || gens[0]?.id;
  state.selected.compatFromGen = fromGen;
  state.selected.compatToGen = toGen;
  const { route } = findRouteForGens(data, fromGen, toGen);
  const routeStatus = route?.status || 'gray';
  const dirty = state.dirty.has(files.compatibility);
  return `<section class="toolbar compat-toolbar">
    <div><h2>Compatibility</h2><p>Pick a route on the graph or with the generation dropdowns. Changing <strong>status</strong> updates the draft immediately: click <strong>Save compatibility</strong> when you want it on disk.</p>${dirty ? '<p class="hint compat-unsaved"><strong>Not on disk yet</strong>: save, then refresh Ontology.</p>' : '<p class="hint compat-disk-ok">In sync with disk.</p>'}</div>
  </section>
  <section class="panel compat-quick">
    <div class="compat-action-bar">
      <div class="compat-action-buttons">
        <button type="button" class="btn js-save-compatibility">Save compatibility</button>
      </div>
      <span class="compat-save-hint${dirty ? ' is-dirty' : ''}">${dirty ? 'Unsaved draft: click Save' : 'Saved to disk'}</span>
    </div>
    <div class="compat-route-layout">
      <div class="compat-graph-panel">
        <p class="hint compat-graph-hint">Click any arrow to select that route (main 9×9 view).</p>
        <div id="compatGraphHost" class="compat-graph-host" aria-live="polite"></div>
      </div>
      <div class="compat-controls">
        <div class="compat-picker">
          <label>From generation<select id="compatFromGen">${generationOptions(gens, fromGen)}</select></label>
          <button type="button" class="btn ghost small" id="compatSwapGens" title="Swap generations">⇄</button>
          <label>To generation<select id="compatToGen">${generationOptions(gens, toGen)}</select></label>
          <label>Route status<select id="compatStatus">${statusOptions(data, routeStatus)}</select></label>
        </div>
        <div id="compatPreviewHost">${compatPreviewHtml(data, fromGen, toGen, route)}</div>
      </div>
    </div>
    <details class="compat-advanced"><summary>Fine-tune this route (bugs, checklist, manual text)</summary>
      ${route ? routeForm(route, data) : '<p>Select a valid generation pair above.</p>'}
    </details>
  </section>
  <details class="compat-browse"><summary>Browse all ${data.routes.length} routes</summary>
  <section class="editor-grid" style="margin-top:12px"><aside class="panel">${list(data.routes, state.selected.route || route?.id, (r) => `${r.title} · ${data.statuses[r.status]?.label || r.status}`)}</aside><article class="panel"><p class="hint">Selecting a route here syncs the generation pickers above.</p></article></section>
  </details>`;
}
function routeForm(route, data) {
  return `<div class="form" data-form="route">
    <input type="hidden" name="from" value="${esc(route.from)}">
    <input type="hidden" name="to" value="${esc(route.to)}">
    <label>Title<input name="title" value="${esc(route.title)}"></label>
    <label>Summary<textarea name="summary">${esc(route.summary)}</textarea></label>
    <div class="row three"><label>Coverage<input name="coverage" value="${esc(route.coverage)}"></label><label>Last updated<input name="lastUpdated" value="${esc(route.lastUpdated)}"></label><label>Status<select name="status">${Object.entries(data.statuses).map(([key,val]) => `<option value="${key}" ${route.status===key?'selected':''}>${val.label}</option>`).join('')}</select></label></div>
    <label>Related bugs, comma separated<input name="relatedBugs" value="${esc((route.relatedBugs || []).join(', '))}"></label>
    <h3>Tests</h3><div class="check-editor" id="routeTests">${checkRows(route.tests)}</div><button class="btn ghost small" id="addRouteTest" type="button">Add test item</button>
    <button type="button" class="btn ghost" id="compatApplyManual">Apply manual edits to this route</button>
  </div>`;
}
function checkRows(items=[]) { return items.map((item,i) => `<div class="check-row"><input type="checkbox" data-index="${i}" ${item.done?'checked':''}><input value="${esc(item.label)}" data-index="${i}"><button class="btn ghost small" data-remove="${i}">Remove</button></div>`).join(''); }
function todayIso() { return new Date().toISOString().slice(0, 10); }
function adminAssetUrl(path) {
  if (!path) return '';
  return `/${String(path).replace(/^\//, '')}`;
}
function normalizeRecordImages(images) {
  if (!Array.isArray(images)) return [];
  return images
    .map((item) => (typeof item === 'string'
      ? { path: item.trim(), caption: '' }
      : { path: String(item?.path || '').trim(), caption: String(item?.caption || '').trim() }))
    .filter((item) => item.path);
}
const MEDIA_ASSET_RE = /\.(png|jpe?g|webp|gif|svg|mp4|webm)$/i;
function imageAssetOptions() {
  return (state.assets || []).filter((p) => MEDIA_ASSET_RE.test(p));
}
function filterImageAssets(query = '', limit = 80) {
  const q = String(query || '').trim().toLowerCase();
  let list = imageAssetOptions();
  if (q) list = list.filter((p) => p.toLowerCase().includes(q));
  return list.slice(0, limit);
}
function refreshAssetList(assets) {
  if (Array.isArray(assets)) state.assets = assets;
}
function openPickerForInput(input, { uploadFolder = 'media/uploads', uploadSubdir = '', title = 'Choose image', defaultFolder, onSelect } = {}) {
  const folder = uploadFolder || 'media/uploads';
  const subdir = uploadSubdir || '';
  openAssetPickerModal({
    esc,
    log,
    adminAssetUrl,
    getAssets: imageAssetOptions,
    refreshAssets: refreshAssetList,
    title,
    defaultFolder: defaultFolder || (subdir ? `${folder}/${subdir}` : folder),
    uploadFolder: folder,
    uploadSubdir: subdir,
    onSelect: onSelect || ((path) => {
      if (!input) return;
      input.value = path;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }),
  });
}
function assetUploadDeps(extra = {}) {
  return {
    esc,
    log,
    adminAssetUrl,
    refreshAssets: refreshAssetList,
    openAssetUploadModal: (opts) => openAssetUploadModal({
      esc,
      log,
      refreshAssets: refreshAssetList,
      ...opts,
    }),
    openAssetPickerModal: (opts) => openAssetPickerModal({
      esc,
      log,
      adminAssetUrl,
      getAssets: imageAssetOptions,
      refreshAssets: refreshAssetList,
      ...opts,
    }),
    openPickerForInput,
    ...extra,
  };
}
function pathInputWithUploadHtml({ label, inputHtml, uploadFolder, uploadSubdir = '', browseFolder }) {
  const pickFolder = browseFolder || uploadFolder;
  return `<label class="path-input-with-upload">${label}
    <span class="dossier-path-input-row">
      ${inputHtml}
      <button type="button" class="btn ghost small" data-standalone-browse data-browse-folder="${esc(pickFolder)}" data-upload-folder="${esc(uploadFolder)}" data-upload-subdir="${esc(uploadSubdir)}">Browse</button>
      <button type="button" class="btn small" data-standalone-upload data-upload-folder="${esc(uploadFolder)}" data-upload-subdir="${esc(uploadSubdir)}">Upload</button>
    </span>
  </label>`;
}
function bindStandaloneAssetButtons(root) {
  root?.querySelectorAll('[data-standalone-browse]').forEach((btn) => {
    btn.onclick = () => {
      const input = btn.parentElement?.querySelector('input');
      openPickerForInput(input, {
        uploadFolder: btn.dataset.uploadFolder || 'media/uploads',
        uploadSubdir: btn.dataset.uploadSubdir || '',
        defaultFolder: btn.dataset.browseFolder || btn.dataset.uploadFolder || 'media',
      });
    };
  });
  root?.querySelectorAll('[data-standalone-upload]').forEach((btn) => {
    btn.onclick = () => {
      const input = btn.parentElement?.querySelector('input');
      if (!input) return;
      openAssetUploadModal({
        esc,
        log,
        folder: btn.dataset.uploadFolder || 'media/uploads',
        subdir: btn.dataset.uploadSubdir || '',
        title: 'Upload image',
        refreshAssets: refreshAssetList,
        onSuccess: (path) => {
          input.value = path;
          input.dispatchEvent(new Event('change', { bubbles: true }));
          input.dispatchEvent(new Event('input', { bubbles: true }));
        },
      });
    };
  });
}
function featureDossierDeps() {
  return assetUploadDeps({
    $,
    adminAssetUrl,
    imageAssetOptions,
    filterImageAssets,
    getPins: () => (state.data['atlas-pins.json']?.pins || []).map((pin) => ({ id: pin.id, name: pin.name })),
    getMilestones: () => (state.data['roadmap.json']?.milestones || []),
  });
}
function pruneRecordDossier(record) {
  if (!record?.dossier) return;
  const pruned = normalizeFeatureDossierRaw(record);
  if (featureHasDossierContent({ ...record, dossier: pruned }, normalizeFeatureDossierRaw)) {
    record.dossier = pruned;
  } else {
    delete record.dossier;
  }
}
function getSelectedPoi() {
  const pois = state.data['pois.json']?.pois || [];
  return pois.find((p) => p.id === state.selected.poi) || null;
}
function getSelectedResearch() {
  const entries = state.data['research.json']?.entries || [];
  return entries.find((e) => e.id === state.selected.research) || null;
}
function researchDossierConfig() {
  return {
    title: 'Research brief',
    hint: 'Rich sections for Concierge Research: characters, Pokémon, locations, mechanics, and more.',
    showMap: false,
    showResearchMilestones: false,
    uploadFolder: 'media/research',
    open: true,
  };
}
function getSelectedIdeaMeta() {
  const items = state.data['ideas.json']?.items || [];
  const slug = state.selected.idea || items[0]?.slug || items[0]?.id;
  state.selected.idea = slug;
  return items.find((i) => i.slug === slug || i.id === slug) || items[0];
}
function getIdeaEditorRecord(meta) {
  if (!meta) return null;
  const slug = meta.slug || meta.id;
  const stored = state.ideaArticles[slug] || { dossier: { overview: '', sections: [] } };
  return { ...meta, dossier: clone(stored.dossier || { overview: '', sections: [] }) };
}
function getSelectedMilestone() {
  const milestones = state.data['roadmap.json']?.milestones || [];
  return milestones.find((m) => m.id === state.selected.milestone) || null;
}
function poiDossierConfig() {
  return {
    title: 'Atlas POI brief',
    hint: 'Optional rich notes shown when visitors inspect this map pin (atlas panel).',
    showMap: false,
    showResearchMilestones: false,
    uploadFolder: 'media/atlas',
    open: true,
  };
}
function ideaDossierConfig() {
  const meta = getSelectedIdeaMeta();
  return {
    title: 'Idea body',
    hint: 'Rich sections for the public Ideas page. Saved to public/ideas/articles/{slug}.json. Use a tabs-primary section for top-level tabs.',
    showMap: false,
    showResearchMilestones: false,
    uploadFolder: 'media/ideas',
    uploadSubdir: meta?.slug || meta?.id || '',
    open: true,
  };
}
function milestoneDossierConfig() {
  return {
    title: 'Milestone brief',
    hint: 'Extra context visitors see when opening a milestone on the public plan page.',
    showMap: false,
    showResearchMilestones: false,
    uploadFolder: 'media/milestones',
    open: true,
  };
}
function docDossierConfig() {
  const meta = getSelectedDocMeta();
  return {
    title: 'Article body',
    hint: 'Rich blocks for the public Docs article. Saved to public/docs/articles/{category}/{slug}.json.',
    showMap: false,
    showResearchMilestones: false,
    uploadFolder: 'media/docs',
    uploadSubdir: meta?.slug || '',
    open: true,
  };
}
function getSelectedDocMeta() {
  const articles = state.data['docs.json']?.articles || [];
  const slug = state.selected.doc || articles[0]?.slug;
  state.selected.doc = slug;
  return articles.find((a) => a.slug === slug) || articles[0];
}
function getDocEditorRecord(meta) {
  if (!meta) return null;
  const stored = state.docArticles[meta.slug] || { dossier: { overview: '', sections: [] } };
  return { ...meta, dossier: clone(stored.dossier || { overview: '', sections: [] }) };
}
function docListHtml(articles, selectedSlug) {
  return `<div class="list feature-list">${articles.length ? articles.map((a) => `<button type="button" class="${selectedSlug === a.slug ? 'active' : ''}" data-doc-slug="${esc(a.slug)}"><strong>${esc(a.title)}</strong><span class="feature-list-meta">${esc(a.category)} · ${esc(a.slug)}</span></button>`).join('') : '<p class="hint feature-list-empty">No articles yet.</p>'}</div>`;
}
function applyDocFromForm({ persistOnly = false } = {}) {
  const meta = getSelectedDocMeta();
  if (!meta) return null;
  const d = formData('[data-form="doc"]');
  const categories = state.data['docs.json'].categories || [];
  const before = clone(meta);
  Object.assign(meta, {
    id: (d.id || meta.id).trim(),
    slug: (d.slug || meta.slug).trim(),
    title: d.title ?? meta.title,
    category: categories.some((c) => c.id === d.category) ? d.category : meta.category,
    summary: d.summary ?? meta.summary,
    author: d.author ?? meta.author,
    publishedAt: d.publishedAt ?? meta.publishedAt,
    updatedAt: d.updatedAt ?? meta.updatedAt,
    featured: d.featured === 'yes',
    tags: csv(d.tags),
    heroImage: {
      path: (d.heroPath || meta.heroImage?.path || '').trim(),
      caption: (d.heroCaption || meta.heroImage?.caption || '').trim(),
    },
  });
  if (!persistOnly) {
    const dossier = readDossierFromDom($, { mountSelector: '#docDossierMount' });
    if (dossier !== null) state.docArticles[meta.slug] = { dossier: dossier || { overview: '', sections: [] } };
  }
  if (recordChanged(before, meta)) markDirty(files.docs);
  return meta;
}
function readRecordImagesFromDom(idPrefix) {
  const grid = $(`#${idPrefix}ImagesGrid`);
  if (!grid) return null;
  return [...grid.querySelectorAll('.record-image-thumb')].map((fig) => ({
    path: fig.dataset.imagePath,
    caption: fig.querySelector('[data-image-caption]')?.value?.trim() || '',
  })).filter((item) => item.path);
}
const RECORD_IMAGE_FOLDERS = { bug: 'media/bugs', feature: 'media/features' };
function recordImagesSectionHtml(images, idPrefix) {
  const normalized = normalizeRecordImages(images);
  const uploadFolder = RECORD_IMAGE_FOLDERS[idPrefix] || 'media/uploads';
  return `<section class="record-images-section">
    <h3>Evidence images <span class="hint">${normalized.length}</span></h3>
    <p class="hint">Paths under <code>public/</code> (e.g. <code>${esc(uploadFolder)}/screenshot.webp</code>). Shown on the Operations page with a gallery modal.</p>
    <div class="record-images-grid" id="${idPrefix}ImagesGrid">${normalized.length ? normalized.map((img, idx) => `<figure class="record-image-thumb" data-image-path="${esc(img.path)}">
        <img src="${adminAssetUrl(img.path)}" alt="" loading="lazy" />
        <label>Caption<input data-image-caption value="${esc(img.caption)}" placeholder="What does this show?" /></label>
        <button type="button" class="btn ghost small" data-remove-image="${idx}">Remove</button>
      </figure>`).join('') : '<p class="hint record-images-empty">No images yet: use Browse or Upload below.</p>'}</div>
    <div class="record-images-add row">
      ${pathInputWithUploadHtml({
    label: 'Image path',
    inputHtml: `<input id="${idPrefix}ImagePath" placeholder="media/…" />`,
    uploadFolder,
  })}
      <label>Caption<input id="${idPrefix}ImageCaption" placeholder="Optional" /></label>
      <button type="button" class="btn ghost small" id="${idPrefix}AddImagePath">Add image</button>
    </div>
    <p class="hint">Use <strong>Browse</strong> to pick from folders, or <strong>Upload</strong> to add a new file.</p>
  </section>`;
}
function recordImageCount(record) {
  return normalizeRecordImages(record?.images).length;
}
function recordListPhotosBadge(count) {
  if (!count) return '';
  return `<span class="record-list-photos" title="${count} evidence image${count === 1 ? '' : 's'}" aria-label="${count} evidence image${count === 1 ? '' : 's'}"><svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><rect x="3" y="5" width="14" height="14" rx="2" stroke="currentColor" stroke-width="1.6" fill="none"/><path d="M7 14l3-3 2 2 4-4" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/></svg><span>${count}</span></span>`;
}
function updateDetailPhotosBadge(getRecord, idPrefix) {
  const record = getRecord();
  const head = document.querySelector(idPrefix === 'bug' ? '.bug-detail-badges' : '.feature-detail-badges');
  if (!head || !record) return;
  const count = recordImageCount(record);
  const existing = head.querySelector('.record-detail-photos');
  if (!count) {
    existing?.remove();
    return;
  }
  const html = `<span class="badge record-detail-photos" title="Evidence images in draft">${count} image${count === 1 ? '' : 's'}</span>`;
  if (existing) existing.outerHTML = html;
  else {
    const hint = head.querySelector('.hint');
    if (hint) hint.insertAdjacentHTML('beforebegin', html);
    else head.insertAdjacentHTML('beforeend', html);
  }
}
function syncRecordImagesDraftUI(fileKey) {
  if (fileKey === files.bugs) {
    updateBugDirtyHint();
    bindSaveBugsButtons();
    const listHost = $('#bugListHost');
    if (listHost) {
      listHost.innerHTML = bugListItemsHtml(state.data['bugs.json'].bugs);
      bindBugList();
    }
    return;
  }
  if (fileKey === files.features) {
    touchFeatureDraft();
    const listHost = $('#featureListHost');
    if (listHost) {
      listHost.innerHTML = featureListItemsHtml(state.data['features.json'].features);
      bindFeatureList();
    }
  }
}
function bindRecordImagesEditor(getRecord, idPrefix, fileKey) {
  const touchDraft = () => {
    markDirty(fileKey);
    syncRecordImagesDraftUI(fileKey);
    updateDetailPhotosBadge(getRecord, idPrefix);
  };
  const persist = () => {
    const record = getRecord();
    if (!record) return;
    const fromDom = readRecordImagesFromDom(idPrefix);
    if (fromDom !== null) record.images = fromDom;
    touchDraft();
  };
  const addImage = (path, caption = '') => {
    const record = getRecord();
    if (!record || !path) return;
    if (!record.images) record.images = [];
    const normalized = normalizeRecordImages(record.images);
    if (normalized.some((img) => img.path === path)) {
      log('That image path is already attached.', 'warn');
      return;
    }
    normalized.push({ path, caption });
    record.images = normalized;
    touchDraft();
    log(`Added image ${path}`, 'ok');
  };
  const refresh = () => {
    const record = getRecord();
    const host = $(`#${idPrefix}ImagesHost`);
    if (host && record) {
      host.innerHTML = recordImagesSectionHtml(record.images, idPrefix);
      bindRecordImagesEditor(getRecord, idPrefix, fileKey);
      updateDetailPhotosBadge(getRecord, idPrefix);
    }
  };
  $(`#${idPrefix}AddImagePath`)?.addEventListener('click', () => {
    const path = $(`#${idPrefix}ImagePath`)?.value?.trim();
    const caption = $(`#${idPrefix}ImageCaption`)?.value?.trim() || '';
    if (!path) { log('Enter an image path first.', 'warn'); return; }
    addImage(path, caption);
    refresh();
  });
  const host = $(`#${idPrefix}ImagesHost`);
  if (!host) return;
  host.querySelectorAll('[data-standalone-upload]').forEach((btn) => {
    btn.onclick = () => {
      openAssetUploadModal({
        esc,
        log,
        folder: btn.dataset.uploadFolder || RECORD_IMAGE_FOLDERS[idPrefix] || 'media/uploads',
        title: 'Upload evidence image',
        refreshAssets: refreshAssetList,
        onSuccess: (path) => {
          const pathInput = $(`#${idPrefix}ImagePath`);
          if (pathInput) pathInput.value = path;
          addImage(path, $(`#${idPrefix}ImageCaption`)?.value?.trim() || '');
          refresh();
        },
      });
    };
  });
  host.querySelectorAll('[data-standalone-browse]').forEach((btn) => {
    btn.onclick = () => {
      openPickerForInput($(`#${idPrefix}ImagePath`), {
        uploadFolder: btn.dataset.uploadFolder || RECORD_IMAGE_FOLDERS[idPrefix] || 'media/uploads',
        title: 'Choose evidence image',
        onSelect: (path) => {
          addImage(path, $(`#${idPrefix}ImageCaption`)?.value?.trim() || '');
          refresh();
        },
      });
    };
  });
  host.querySelectorAll('[data-remove-image]').forEach((btn) => {
    btn.onclick = () => {
      const record = getRecord();
      if (!record) return;
      const idx = Number(btn.dataset.removeImage);
      record.images = normalizeRecordImages(record.images);
      record.images.splice(idx, 1);
      touchDraft();
      refresh();
    };
  });
  host.querySelectorAll('[data-image-caption]').forEach((input) => {
    input.onchange = persist;
  });
  host.querySelectorAll('[data-pick-path]').forEach((btn) => {
    btn.onclick = () => {
      addImage(btn.dataset.pickPath);
      refresh();
    };
  });
}
function getSelectedBug() {
  return state.data['bugs.json'].bugs.find((b) => b.id === state.selected.bug);
}
function bugStatusSlug(status) {
  return String(status || '').toLowerCase();
}
function filteredBugs(bugs, { filter = 'all', query = '' } = {}) {
  let list = bugs;
  if (filter === 'active') list = list.filter((b) => ['Open', 'Blocked', 'Testing'].includes(b.status));
  else if (filter === 'closed') list = list.filter((b) => ['Fixed', 'Archived'].includes(b.status));
  else if (filter !== 'all') list = list.filter((b) => b.status === filter);
  const q = String(query || '').trim().toLowerCase();
  if (q) {
    list = list.filter((b) => [b.id, b.title, b.area, b.summary, b.status, b.severity].join(' ').toLowerCase().includes(q));
  }
  return list;
}
function bugFilterCounts(bugs) {
  return {
    all: bugs.length,
    active: bugs.filter((b) => ['Open', 'Blocked', 'Testing'].includes(b.status)).length,
    closed: bugs.filter((b) => ['Fixed', 'Archived'].includes(b.status)).length,
    Open: bugs.filter((b) => b.status === 'Open').length,
    Blocked: bugs.filter((b) => b.status === 'Blocked').length,
    Testing: bugs.filter((b) => b.status === 'Testing').length,
    Fixed: bugs.filter((b) => b.status === 'Fixed').length,
    Archived: bugs.filter((b) => b.status === 'Archived').length,
  };
}
function patchSelectedBug(fields) {
  const bug = getSelectedBug();
  if (!bug) return null;
  const statusChanged = fields.status && fields.status !== bug.status;
  Object.assign(bug, fields);
  if (statusChanged) bug.lastUpdated = todayIso();
  markDirty(files.bugs);
  return bug;
}
function deleteSelectedBug() {
  const bug = getSelectedBug();
  if (!bug) return;
  if (!confirm(`Delete ${bug.id}: “${bug.title}”?\n\nRemoved from the draft immediately. Click Save bugs to update bugs.json on disk.`)) return;
  const deletedId = bug.id;
  const bugs = state.data['bugs.json'].bugs;
  const index = bugs.findIndex((item) => item.id === deletedId);
  if (index < 0) return;
  bugs.splice(index, 1);
  (state.data['bugs.json'].communityIssues || []).forEach((issue) => {
    if (issue.linkedBug === deletedId) issue.linkedBug = '';
  });
  const visible = filteredBugs(bugs, { filter: state.bugFilter, query: state.bugSearch });
  state.selected.bug = visible[0]?.id || bugs[0]?.id || null;
  markDirty(files.bugs);
  syncBugUIFromState();
  syncCommunityPanel({ pickerOnly: true });
  log(`Deleted ${deletedId} from draft. Save bugs when ready.`, 'ok');
}
function applyBugFromForm({ persistOnly = false } = {}) {
  const form = document.querySelector('[data-form="bug"]');
  if (!form) return getSelectedBug();
  const bug = getSelectedBug();
  if (!bug) return null;
  const before = clone(bug);
  const d = readFormFields(form);
  const nextId = (d.id || bug.id).trim();
  const statusChanged = d.status && d.status !== bug.status;
  const updates = {
    id: nextId,
    title: d.title ?? bug.title,
    status: d.status ?? bug.status,
    severity: d.severity ?? bug.severity,
    area: d.area ?? bug.area,
    summary: d.summary ?? bug.summary,
    linkedFeature: d.linkedFeature ?? bug.linkedFeature,
    linkedRoutes: csv(d.linkedRoutes),
    lastUpdated: statusChanged ? todayIso() : (d.lastUpdated || bug.lastUpdated),
    checklist: readChecks('bugChecks'),
  };
  if (!persistOnly) {
    const images = readRecordImagesFromDom('bug');
    if (images !== null) updates.images = images;
  }
  Object.assign(bug, updates);
  state.selected.bug = nextId;
  if (recordChanged(before, bug)) markDirty(files.bugs);
  return bug;
}
function applyBugChecklistFromDom() {
  const bug = getSelectedBug();
  if (!bug) return null;
  bug.checklist = readChecks('bugChecks');
  markDirty(files.bugs);
  return bug;
}
function bugFiltersHtml(bugs) {
  const counts = bugFilterCounts(bugs);
  const filters = [
    ['active', 'Active', counts.active],
    ['all', 'All', counts.all],
    ['Open', 'Open', counts.Open],
    ['Blocked', 'Blocked', counts.Blocked],
    ['Testing', 'Testing', counts.Testing],
    ['Fixed', 'Fixed', counts.Fixed],
    ['Archived', 'Archived', counts.Archived],
    ['closed', 'Closed', counts.closed],
  ];
  return `<div class="bug-filters">${filters.map(([key, label, count]) => `<button type="button" class="bug-filter-btn${state.bugFilter === key ? ' active' : ''}" data-bug-filter="${esc(key)}">${esc(label)} <span>${count}</span></button>`).join('')}</div>
    <label class="bug-search"><span>Search</span><input id="bugSearch" type="search" value="${esc(state.bugSearch)}" placeholder="ID, title, area…" /></label>`;
}
function bugListItemsHtml(bugs) {
  const visible = filteredBugs(bugs, { filter: state.bugFilter, query: state.bugSearch });
  const selectedId = state.selected.bug;
  return `<div class="list bug-list">${visible.length ? visible.map((bug) => {
    const photos = recordImageCount(bug);
    return `<button type="button" class="bug-list-item bug-status-${bugStatusSlug(bug.status)}${selectedId === bug.id ? ' active' : ''}" data-bug-id="${esc(bug.id)}">
      <span class="bug-list-pill">${esc(bug.status)}</span>
      <strong>${esc(bug.title)}</strong>
      <span class="bug-list-meta">${recordListPhotosBadge(photos)}${esc(bug.id)} · ${esc(bug.severity)} · ${esc(bug.area)}</span>
    </button>`;
  }).join('') : '<p class="hint bug-list-empty">No bugs match this filter.</p>'}</div>`;
}
function bugDetailHtml(bug, data) {
  if (!bug) return '<p class="hint">Select a bug from the list or create a new one.</p>';
  const checklistDone = (bug.checklist || []).filter((item) => item.done).length;
  const checklistTotal = (bug.checklist || []).length;
  const quickStatuses = [
    ['Open', 'Open'],
    ['Blocked', 'Block'],
    ['Testing', 'Testing'],
    ['Fixed', 'Close (fixed)'],
    ['Archived', 'Archive'],
  ];
  return `<div class="bug-detail">
    <div class="bug-detail-head">
      <div class="bug-detail-badges">
        <span class="badge bug-badge-id">${esc(bug.id)}</span>
        <span class="badge bug-status-badge bug-status-${bugStatusSlug(bug.status)}">${esc(bug.status)}</span>
        <span class="badge bug-severity-${esc(bug.severity.toLowerCase())}">${esc(bug.severity)}</span>
        ${recordImageCount(bug) ? `<span class="badge record-detail-photos" title="Evidence images in draft">${recordImageCount(bug)} image${recordImageCount(bug) === 1 ? '' : 's'}</span>` : ''}
        <span class="hint">Draft in memory: save when ready</span>
      </div>
      <div class="bug-quick-actions" role="group" aria-label="Quick status">
        ${quickStatuses.map(([status, label]) => `<button type="button" class="bug-quick-btn bug-status-${bugStatusSlug(status)}${bug.status === status ? ' is-current' : ''}" data-bug-status="${esc(status)}">${esc(label)}</button>`).join('')}
      </div>
    </div>
    <div class="form" data-form="bug">
      <label class="bug-title-field">Title<input name="title" value="${esc(bug.title)}" placeholder="What broke or needs tracking?" /></label>
      <div class="row three">
        <label>Status<select name="status">${data.statuses.map((s) => `<option value="${esc(s)}" ${bug.status === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></label>
        <label>Severity<select name="severity">${data.severities.map((s) => `<option value="${esc(s)}" ${bug.severity === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></label>
        <label>Area<input name="area" value="${esc(bug.area)}" placeholder="Compatibility, UI…" /></label>
      </div>
      <label>Summary<textarea name="summary" rows="4">${esc(bug.summary)}</textarea></label>
      <div id="bugImagesHost">${recordImagesSectionHtml(bug.images, 'bug')}</div>
      <h3>Checklist <span class="hint">${checklistDone}/${checklistTotal} done</span></h3>
      <div class="check-editor" id="bugChecks">${checkRows(bug.checklist)}</div>
      <button class="btn ghost small" id="addBugCheck" type="button">Add checklist item</button>
      <details class="bug-advanced"><summary>IDs, links, and dates</summary>
        <div class="row"><label>ID<input name="id" value="${esc(bug.id)}"></label><label>Last updated<input name="lastUpdated" value="${esc(bug.lastUpdated)}"></label></div>
        <div class="row"><label>Linked feature<input name="linkedFeature" value="${esc(bug.linkedFeature || '')}"></label><label>Linked routes<input name="linkedRoutes" value="${esc((bug.linkedRoutes || []).join(', '))}" placeholder="gen2-gen2, gen7-gen7"></label></div>
        <div class="bug-advanced-footer">
          <button type="button" class="btn ghost small bug-delete-btn" id="deleteBug" title="Remove this bug from the tracker">Delete bug</button>
        </div>
      </details>
    </div>
  </div>`;
}
function updateBugDirtyHint() {
  const dirty = state.dirty.has(files.bugs);
  document.querySelectorAll('.bug-save-hint').forEach((el) => {
    el.textContent = dirty ? 'Unsaved' : 'Saved';
    el.classList.toggle('is-dirty', dirty);
  });
  updateWorkshopSaveHints();
}
function bindSaveBugsButtons() {
  const dirty = state.dirty.has(files.bugs);
  document.querySelectorAll('.js-save-bugs').forEach((btn) => {
    btn.disabled = !dirty;
    btn.onclick = async (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (btn.disabled) return;
      btn.classList.add('btn-busy');
      btn.disabled = true;
      setLogStatus('Saving bugs…', 'busy');
      try {
        await saveBugsToDisk();
        flashEl(btn, 'btn-flash-ok');
        flashEl(document.querySelector('.bug-detail'), 'bug-flash-ok');
      } catch (e) {
        log(e.message, 'error');
        flashEl(btn, 'btn-flash-error');
      } finally {
        btn.classList.remove('btn-busy');
        bindSaveBugsButtons();
      }
    };
  });
}
function curatedCommunityIds() {
  return new Set((state.data['bugs.json'].communityIssues || []).map((issue) => issue.id));
}
function applyCommunityIssuesFromEditor() {
  const advanced = document.querySelector('.bug-community-advanced');
  const el = $('#communityIssuesEditor');
  if (!advanced?.open || !el) return;
  try {
    state.data['bugs.json'].communityIssues = JSON.parse(el.value || '[]');
  } catch (e) {
    throw new Error(`Community issues JSON is invalid: ${e.message}`);
  }
}
function applyCuratedCommunityFromDom() {
  const cards = [...document.querySelectorAll('.community-curated-card')];
  if (!cards.length) return;
  const byId = new Map((state.data['bugs.json'].communityIssues || []).map((issue) => [issue.id, issue]));
  state.data['bugs.json'].communityIssues = cards.map((card) => {
    const base = byId.get(card.dataset.communityId) || {};
    return {
      ...base,
      id: card.dataset.communityId,
      summary: card.querySelector('[data-community-field="summary"]')?.value?.trim() || base.summary || '',
      linkedBug: card.querySelector('[data-community-field="linkedBug"]')?.value?.trim() || base.linkedBug || '',
    };
  });
}
function addCommunityIssue(record) {
  const issues = state.data['bugs.json'].communityIssues;
  if (issues.some((item) => item.id === record.id)) {
    log(`${record.id} is already on the Operations page list.`, 'warn');
    return;
  }
  issues.push({ ...record });
  markDirty(files.bugs);
  syncCommunityPanel();
  log(`Added GitHub #${record.number} to draft. Save bugs when ready.`, 'ok');
}
function removeCommunityIssue(id) {
  const issues = state.data['bugs.json'].communityIssues;
  const index = issues.findIndex((item) => item.id === id);
  if (index < 0) return;
  issues.splice(index, 1);
  markDirty(files.bugs);
  syncCommunityPanel();
  log(`Removed ${id} from draft.`, 'ok');
}
function githubStatusHtml() {
  const status = state.github.status;
  if (!status) return '<p class="hint github-status-loading">Checking GitHub connection…</p>';
  if (!status.configured) {
    return `<p class="hint github-status-warn"><strong>GitHub not connected.</strong> Add <code>GITHUB_TOKEN</code> to <code>.env.local</code> at the repo root, set <code>GITHUB_REPO=owner/repo</code> or fix <code>site.json</code> <code>repoUrl</code>, then restart <code>npm run admin</code>.</p>`;
  }
  if (status.error) {
    return `<p class="hint github-status-warn"><strong>GitHub setup incomplete.</strong> ${esc(status.error)}</p>`;
  }
  return `<p class="hint github-status-ok"><strong>Connected</strong> · ${esc(status.repo)} · ${esc(status.hint)}</p>`;
}
function communityCuratedHtml(issues) {
  if (!issues.length) {
    return '<p class="hint community-curated-empty">Nothing on the Operations page yet. Refresh from GitHub below and click <strong>Add to site</strong>.</p>';
  }
  return `<div class="community-curated-list">${issues.map((issue) => `<article class="community-curated-card" data-community-id="${esc(issue.id)}">
    <div class="community-curated-head">
      <div><strong>#${issue.number} ${esc(issue.title)}</strong><span class="community-curated-state">${esc(issue.state || 'open')}</span></div>
      <div class="community-curated-actions">
        ${issue.url ? `<a class="btn ghost small" href="${esc(issue.url)}" target="_blank" rel="noreferrer">GitHub</a>` : ''}
        <button type="button" class="btn ghost small" data-remove-community="${esc(issue.id)}">Remove</button>
      </div>
    </div>
    ${issue.labels?.length ? `<div class="community-labels">${issue.labels.map((label) => `<span>${esc(label)}</span>`).join('')}</div>` : ''}
    <label>Summary (shown on Operations page)<textarea rows="2" data-community-field="summary">${esc(issue.summary || '')}</textarea></label>
    <label>Linked internal bug<input data-community-field="linkedBug" value="${esc(issue.linkedBug || '')}" placeholder="BUG-…" list="communityBugSuggestions"></label>
  </article>`).join('')}</div>
  <datalist id="communityBugSuggestions">${state.data['bugs.json'].bugs.map((bug) => `<option value="${esc(bug.id)}">`).join('')}</datalist>`;
}
function githubPickerHtml() {
  const { issues, loading, error, state: ghState } = state.github;
  const onSite = curatedCommunityIds();
  if (loading) return '<p class="hint">Loading GitHub issues…</p>';
  if (error) return `<p class="hint github-status-warn">${esc(error)}</p>`;
  if (!issues.length) return `<p class="hint">No ${esc(ghState)} issues returned. Try another filter or open an issue on GitHub first.</p>`;
  return `<div class="github-pick-list">${issues.map((issue) => {
    const added = onSite.has(issue.id);
    return `<article class="github-pick-card${added ? ' is-on-site' : ''}">
      <div class="github-pick-head"><strong>#${issue.number} ${esc(issue.title)}</strong><span>${esc(issue.state)}</span></div>
      ${issue.labels?.length ? `<div class="community-labels">${issue.labels.map((label) => `<span>${esc(label)}</span>`).join('')}</div>` : ''}
      <p class="hint github-pick-summary">${esc((issue.summary || '').slice(0, 140))}${(issue.summary || '').length > 140 ? '…' : ''}</p>
      <button type="button" class="btn ghost small" data-add-community="${esc(issue.id)}" ${added ? 'disabled' : ''}>${added ? 'On site' : 'Add to site'}</button>
    </article>`;
  }).join('')}</div>`;
}
function communityIssuesPanelHtml() {
  const issues = state.data['bugs.json'].communityIssues || [];
  return `<details class="bug-community" open>
    <summary>Community GitHub issues <span class="bug-community-count">${issues.length} on site</span></summary>
    <div id="githubCommunityStatus">${githubStatusHtml()}</div>
    <section class="community-curated-section">
      <h3>On the Operations page</h3>
      <div id="communityCuratedHost">${communityCuratedHtml(issues)}</div>
    </section>
    <section class="github-import-section">
      <h3>Import from GitHub</h3>
      <div class="github-import-toolbar">
        <label>Show<select id="githubIssueState">
          <option value="open" ${state.github.state === 'open' ? 'selected' : ''}>Open</option>
          <option value="closed" ${state.github.state === 'closed' ? 'selected' : ''}>Closed</option>
          <option value="all" ${state.github.state === 'all' ? 'selected' : ''}>All</option>
        </select></label>
        <button type="button" class="btn ghost" id="refreshGithubIssues">Refresh from GitHub</button>
      </div>
      <div id="githubIssuePickerHost">${githubPickerHtml()}</div>
    </section>
    <details class="bug-community-advanced">
      <summary>Advanced JSON</summary>
      <p class="hint">Power-user fallback. Prefer the buttons above unless you need bulk edits.</p>
      <textarea id="communityIssuesEditor" spellcheck="false">${esc(JSON.stringify(issues, null, 2))}</textarea>
    </details>
  </details>`;
}
async function refreshGithubStatus() {
  try {
    state.github.status = await api('/api/github/status');
  } catch (e) {
    state.github.status = { configured: false, error: e.message };
  }
}
async function loadGithubIssues() {
  const stateSel = $('#githubIssueState');
  state.github.state = stateSel?.value || state.github.state || 'open';
  state.github.loading = true;
  state.github.error = '';
  syncCommunityPanel({ pickerOnly: true });
  try {
    const result = await api(`/api/github/issues?state=${encodeURIComponent(state.github.state)}&limit=40`);
    state.github.issues = result.issues || [];
    log(`Loaded ${state.github.issues.length} GitHub issue(s) from ${result.repo}.`, 'ok');
  } catch (e) {
    state.github.error = e.message;
    state.github.issues = [];
    log(e.message, 'error');
  } finally {
    state.github.loading = false;
    syncCommunityPanel({ pickerOnly: true });
  }
}
function syncCommunityPanel({ pickerOnly = false } = {}) {
  const host = $('#communityPanelHost');
  if (!host) return;
  if (pickerOnly) {
    const statusHost = $('#githubCommunityStatus');
    const pickerHost = $('#githubIssuePickerHost');
    const count = host.querySelector('.bug-community-count');
    if (statusHost) statusHost.innerHTML = githubStatusHtml();
    if (pickerHost) pickerHost.innerHTML = githubPickerHtml();
    if (count) count.textContent = `${(state.data['bugs.json'].communityIssues || []).length} on site`;
    bindCommunityPanel();
    return;
  }
  host.innerHTML = communityIssuesPanelHtml();
  bindCommunityPanel();
}
function bindCommunityPanel() {
  const stateSel = $('#githubIssueState');
  if (stateSel) stateSel.onchange = () => { state.github.state = stateSel.value; };
  const refresh = $('#refreshGithubIssues');
  if (refresh) refresh.onclick = () => loadGithubIssues();
  document.querySelectorAll('[data-add-community]').forEach((btn) => {
    btn.onclick = () => {
      const record = state.github.issues.find((issue) => issue.id === btn.dataset.addCommunity);
      if (record) addCommunityIssue({ ...record });
    };
  });
  document.querySelectorAll('[data-remove-community]').forEach((btn) => {
    btn.onclick = () => removeCommunityIssue(btn.dataset.removeCommunity);
  });
  document.querySelectorAll('[data-community-field]').forEach((field) => {
    field.onchange = () => markDirty(files.bugs);
  });
  const jsonEditor = $('#communityIssuesEditor');
  if (jsonEditor) jsonEditor.oninput = () => markDirty(files.bugs);
}
async function saveBugsToDisk() {
  applyBugFromForm();
  applyCuratedCommunityFromDom();
  applyCommunityIssuesFromEditor();
  if (!state.dirty.has(files.bugs)) {
    log('No bug changes to save.', 'warn');
    return;
  }
  await saveFile(files.bugs, state.data['bugs.json']);
  log('Written to public/data/bugs.json.', 'ok');
  syncBugUIFromState();
}
function bindBugFilters() {
  document.querySelectorAll('[data-bug-filter]').forEach((btn) => {
    btn.onclick = () => {
      state.bugFilter = btn.dataset.bugFilter;
      syncBugUIFromState();
    };
  });
  const search = $('#bugSearch');
  if (search) {
    search.oninput = () => {
      state.bugSearch = search.value;
      const listHost = $('#bugListHost');
      if (listHost) {
        listHost.innerHTML = bugListItemsHtml(state.data['bugs.json'].bugs);
        bindBugList();
      }
    };
  }
}
function bindBugDesk() {
  bindBugFilters();
  bindBugList();
  bindBugDetail();
  bindSaveBugsButtons();
  refreshGithubStatus().then(() => syncCommunityPanel());
  const newBug = $('#newBug');
  if (newBug) newBug.onclick = () => {
    const bug = {
      id: `BUG-NEW-${Date.now().toString().slice(-5)}`,
      title: 'New issue',
      status: 'Open',
      severity: 'Major',
      area: 'General',
      summary: 'Describe the issue.',
      linkedFeature: '',
      linkedRoutes: [],
      lastUpdated: todayIso(),
      checklist: [],
    };
    state.data['bugs.json'].bugs.unshift(bug);
    state.selected.bug = bug.id;
    state.bugFilter = 'active';
    markDirty(files.bugs);
    syncBugUIFromState();
    log(`Created ${bug.id}. Save bugs when ready.`, 'ok');
  };
}
function bindBugList() {
  document.querySelectorAll('[data-bug-id]').forEach((btn) => {
    btn.onclick = () => {
      applyBugFromForm();
      state.selected.bug = btn.dataset.bugId;
      syncBugUIFromState();
    };
  });
}
function bindBugDetail() {
  document.querySelectorAll('[data-bug-status]').forEach((btn) => {
    btn.onclick = () => {
      const status = btn.dataset.bugStatus;
      patchSelectedBug({ status });
      syncBugUIFromState();
      log(`Draft: ${state.selected.bug} → ${status}. Save bugs when ready.`, 'ok');
      flashEl(document.querySelector('.bug-detail'), 'bug-flash-ok');
    };
  });
  const form = document.querySelector('[data-form="bug"]');
  if (!form) return;
  const onFieldChange = () => {
    applyBugFromForm();
    syncBugUIFromState({ detailOnly: true });
  };
  form.querySelectorAll('input, select, textarea').forEach((field) => {
    field.onchange = onFieldChange;
  });
  const checks = $('#bugChecks');
  if (checks) {
    checks.onchange = () => {
      applyBugChecklistFromDom();
      syncBugUIFromState({ detailOnly: true });
    };
    checks.oninput = (event) => {
      if (event.target.matches('.check-row input:not([type="checkbox"])')) {
        applyBugChecklistFromDom();
      }
    };
  }
  const addBugCheck = $('#addBugCheck');
  if (addBugCheck) addBugCheck.onclick = () => {
    addCheck('BugCheck');
    applyBugChecklistFromDom();
    syncBugUIFromState({ detailOnly: true });
  };
  const deleteBug = $('#deleteBug');
  if (deleteBug) deleteBug.onclick = () => deleteSelectedBug();
  bindRecordImagesEditor(getSelectedBug, 'bug', files.bugs);
  document.querySelectorAll('#bugChecks [data-remove]').forEach((btn) => {
    btn.onclick = () => {
      btn.closest('.check-row')?.remove();
      applyBugChecklistFromDom();
      syncBugUIFromState({ detailOnly: true });
    };
  });
}
function syncBugUIFromState({ detailOnly = false } = {}) {
  const data = state.data['bugs.json'];
  const bugs = data.bugs;
  if (!state.selected.bug || !bugs.find((b) => b.id === state.selected.bug)) {
    state.selected.bug = filteredBugs(bugs, { filter: state.bugFilter, query: state.bugSearch })[0]?.id || bugs[0]?.id;
  }
  const bug = getSelectedBug();
  const listHost = $('#bugListHost');
  if (listHost) {
    listHost.innerHTML = bugListItemsHtml(bugs);
    bindBugList();
  }
  if (!detailOnly) {
    const filtersHost = $('#bugFiltersHost');
    if (filtersHost) {
      filtersHost.innerHTML = bugFiltersHtml(bugs);
      bindBugFilters();
    }
  }
  const detailHost = $('#bugDetailHost');
  if (detailHost) {
    detailHost.innerHTML = bugDetailHtml(bug, data);
    bindBugDetail();
  }
  updateBugDirtyHint();
  bindSaveBugsButtons();
}
function workshopBugsPane() {
  const data = state.data['bugs.json'];
  const bugs = data.bugs;
  if (!state.selected.bug) state.selected.bug = filteredBugs(bugs, { filter: state.bugFilter })[0]?.id || bugs[0]?.id;
  const dirty = state.dirty.has(files.bugs);
  return `<div class="workshop-pane-inner bug-desk">
    <div class="bug-action-bar workshop-action-bar">
      <div class="bug-action-buttons">
        <button type="button" class="btn js-save-bugs">Save bugs</button>
        <button type="button" class="btn ghost" id="newBug">New bug</button>
      </div>
      <span class="bug-save-hint feature-save-hint${dirty ? ' is-dirty' : ''}">${dirty ? 'Unsaved' : 'Saved'}</span>
    </div>
    <p class="hint workshop-bugs-intro">Track internal bugs below. With <code>GITHUB_TOKEN</code> in <code>.env.local</code>, pull GitHub issues and add them to the Operations page, then <strong>Save bugs</strong>.</p>
    <div class="bug-layout workshop-layout">
      <aside class="panel bug-sidebar workshop-sidebar">
        <div id="bugFiltersHost">${bugFiltersHtml(bugs)}</div>
        <div id="bugListHost">${bugListItemsHtml(bugs)}</div>
      </aside>
      <article class="panel bug-main workshop-main" id="bugDetailHost">${bugDetailHtml(getSelectedBug(), data)}</article>
    </div>
    <section class="panel bug-community-panel" id="communityPanelHost">${communityIssuesPanelHtml()}</section>
  </div>`;
}

const FEATURE_ACTIVE_STAGES = ['Boarding Soon', 'On-Flight', 'Testing'];
function featureStageSlug(stage) {
  return String(stage || '').toLowerCase().replace(/\s+/g, '-');
}
function getSelectedFeature() {
  return state.data['features.json'].features.find((f) => f.id === state.selected.feature);
}
function filteredFeatures(features, { filter = 'all', query = '' } = {}) {
  let list = features;
  if (filter === 'active') list = list.filter((f) => FEATURE_ACTIVE_STAGES.includes(f.stage));
  else if (filter === 'done') list = list.filter((f) => f.stage === 'Landed');
  else if (filter === 'blocked') list = list.filter((f) => f.stage === 'Blocked');
  else if (filter !== 'all') list = list.filter((f) => f.stage === filter);
  const q = String(query || '').trim().toLowerCase();
  if (q) {
    list = list.filter((f) => [f.id, f.title, f.area, f.summary, f.stage, f.priority].join(' ').toLowerCase().includes(q));
  }
  return list;
}
function featureFilterCounts(features, stages) {
  const counts = { all: features.length, active: 0, done: 0, blocked: 0 };
  stages.forEach((stage) => { counts[stage] = 0; });
  features.forEach((f) => {
    if (FEATURE_ACTIVE_STAGES.includes(f.stage)) counts.active += 1;
    if (f.stage === 'Landed') counts.done += 1;
    if (f.stage === 'Blocked') counts.blocked += 1;
    if (counts[f.stage] !== undefined) counts[f.stage] += 1;
  });
  return counts;
}
function normalizeRecordForCompare(record) {
  const copy = clone(record);
  for (const key of ['linkedBugs', 'linkedRoutes', 'tags', 'linkedPins', 'linkedFeatures', 'relatedBugs', 'tasks', 'evidence', 'images', 'checklist']) {
    if (!Array.isArray(copy[key])) copy[key] = [];
  }
  if (!copy.image) delete copy.image;
  if (copy.dossier === undefined) delete copy.dossier;
  if (copy.dossier && !featureHasDossierContent({ dossier: copy.dossier }, normalizeFeatureDossierRaw)) delete copy.dossier;
  if (copy.linkedPois === undefined) delete copy.linkedPois;
  if (copy.heroImage) {
    const path = String(copy.heroImage.path || '').trim();
    const caption = String(copy.heroImage.caption || '').trim();
    const extras = { ...copy.heroImage };
    delete extras.path;
    delete extras.caption;
    const hasExtras = Object.values(extras).some((value) => value !== undefined && value !== '');
    if (!path && !caption && !hasExtras) delete copy.heroImage;
    else copy.heroImage = { ...extras, path, caption };
  }
  return copy;
}

function recordChanged(before, after) {
  return JSON.stringify(normalizeRecordForCompare(before)) !== JSON.stringify(normalizeRecordForCompare(after));
}

function applyFeatureFromForm({ persistOnly = false } = {}) {
  const form = document.querySelector('[data-form="feature"]');
  if (!form) return getSelectedFeature();
  const d = readFormFields(form);
  const feature = getSelectedFeature();
  if (!feature) return null;
  const before = clone(feature);
  const nextId = (d.id || feature.id).trim();
  const updates = {
    id: nextId,
    title: d.title ?? feature.title,
    stage: d.stage ?? feature.stage,
    area: d.area ?? feature.area,
    priority: d.priority ?? feature.priority,
    progress: Math.min(100, Math.max(0, Number(d.progress ?? feature.progress) || 0)),
    summary: d.summary ?? feature.summary,
    linkedBugs: csv(d.linkedBugs),
    linkedRoutes: csv(d.linkedRoutes),
    tasks: readChecks('featureTasks'),
  };
  if (!persistOnly) {
    const images = readRecordImagesFromDom('feature');
    const dossier = readFeatureDossierFromDom($, { mountSelector: '#featureDossierMount' });
    if (images !== null) updates.images = images;
    if (dossier !== null) updates.dossier = dossier;
  }
  Object.assign(feature, updates);
  state.selected.feature = nextId;
  if (recordChanged(before, feature)) touchFeatureDraft();
  return feature;
}
function applyFeatureTasksFromDom() {
  const feature = getSelectedFeature();
  if (!feature) return null;
  feature.tasks = readChecks('featureTasks');
  touchFeatureDraft();
  return feature;
}
function patchSelectedFeature(fields) {
  const feature = getSelectedFeature();
  if (!feature) return null;
  Object.assign(feature, fields);
  if (fields.progress !== undefined) {
    feature.progress = Math.min(100, Math.max(0, Number(fields.progress) || 0));
  }
  touchFeatureDraft();
  return feature;
}
function deleteSelectedFeature() {
  const feature = getSelectedFeature();
  if (!feature) return;
  if (!confirm(`Delete ${feature.id}: “${feature.title}”?\n\nRemoved from the draft immediately. Click Save features to update features.json on disk.`)) return;
  const deletedId = feature.id;
  const features = state.data['features.json'].features;
  const index = features.findIndex((item) => item.id === deletedId);
  if (index < 0) return;
  features.splice(index, 1);
  (state.data['bugs.json'].bugs || []).forEach((bug) => {
    if (bug.linkedFeature === deletedId) bug.linkedFeature = '';
  });
  const visible = filteredFeatures(features, { filter: state.featureFilter, query: state.featureSearch });
  state.selected.feature = visible[0]?.id || features[0]?.id || null;
  touchFeatureDraft();
  syncFeatureUIFromState();
  log(`Deleted ${deletedId} from draft. Save features when ready.`, 'ok');
}
function featureFiltersHtml(features, stages) {
  const counts = featureFilterCounts(features, stages);
  const filters = [
    ['active', 'Active', counts.active],
    ['all', 'All', counts.all],
    ...stages.map((stage) => [stage, stage, counts[stage] || 0]),
    ['done', 'Landed', counts.done],
    ['blocked', 'Blocked', counts.blocked],
  ];
  return `<div class="feature-filters">${filters.map(([key, label, count]) => `<button type="button" class="feature-filter-btn${state.featureFilter === key ? ' active' : ''}" data-feature-filter="${esc(key)}">${esc(label)} <span>${count}</span></button>`).join('')}</div>
    <label class="feature-search"><span>Search</span><input id="featureSearch" type="search" value="${esc(state.featureSearch)}" placeholder="Title, area, ID…" /></label>`;
}
function featureListItemsHtml(features) {
  const visible = filteredFeatures(features, { filter: state.featureFilter, query: state.featureSearch });
  const selectedId = state.selected.feature;
  return `<div class="list feature-list">${visible.length ? visible.map((feature) => {
    const photos = recordImageCount(feature);
    const dossier = featureHasDossierContent(feature, normalizeFeatureDossierRaw);
    return `<button type="button" class="feature-list-item feature-stage-${featureStageSlug(feature.stage)}${selectedId === feature.id ? ' active' : ''}" data-feature-id="${esc(feature.id)}">
      <span class="feature-list-pill">${esc(feature.stage)}</span>
      <strong>${esc(feature.title)}</strong>
      <span class="feature-list-meta">${dossier ? '<span class="record-list-dossier" title="Research dossier">◇</span>' : ''}${recordListPhotosBadge(photos)}${esc(feature.id)} · ${feature.progress}% · ${esc(feature.priority)}</span>
    </button>`;
  }).join('') : '<p class="hint feature-list-empty">No features match this filter.</p>'}</div>`;
}
function featureDetailHtml(feature, data) {
  if (!feature) return '<p class="hint">Select a feature from the list or create a new one.</p>';
  const tasksDone = (feature.tasks || []).filter((t) => t.done).length;
  const tasksTotal = (feature.tasks || []).length;
  return `<div class="feature-detail">
    <div class="feature-detail-head">
      <div class="feature-detail-badges">
        <span class="badge feature-badge-id">${esc(feature.id)}</span>
        <span class="badge feature-stage-badge feature-stage-${featureStageSlug(feature.stage)}">${esc(feature.stage)}</span>
        <span class="badge feature-priority-${esc(String(feature.priority).toLowerCase())}">${esc(feature.priority)}</span>
        ${featureHasDossierContent(feature, normalizeFeatureDossierRaw) ? '<span class="badge record-detail-dossier" title="Research dossier">Dossier</span>' : ''}
        ${recordImageCount(feature) ? `<span class="badge record-detail-photos" title="Legacy quick images">${recordImageCount(feature)} img</span>` : ''}
        <span class="hint">Draft in memory: save when ready</span>
      </div>
      <div class="feature-quick-actions" role="group" aria-label="Quick stage">
        ${data.stages.map((stage) => `<button type="button" class="feature-quick-btn feature-stage-${featureStageSlug(stage)}${feature.stage === stage ? ' is-current' : ''}" data-feature-stage="${esc(stage)}">${esc(stage)}</button>`).join('')}
      </div>
    </div>
    <div class="form" data-form="feature">
      <label class="feature-title-field">Title<input name="title" value="${esc(feature.title)}" placeholder="What is this feature?" /></label>
      <div class="row three">
        <label>Stage<select name="stage">${data.stages.map((s) => `<option value="${esc(s)}" ${feature.stage === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></label>
        <label>Area<input name="area" value="${esc(feature.area)}" placeholder="Compatibility, Media…" /></label>
        <label>Priority<input name="priority" value="${esc(feature.priority)}" placeholder="High, Medium…" /></label>
      </div>
      <label>Progress <span class="hint feature-progress-label">${feature.progress}%</span>
        <div class="feature-progress-row">
          <input type="range" min="0" max="100" step="1" value="${feature.progress}" class="feature-progress-range" aria-label="Progress slider" />
          <input name="progress" type="number" min="0" max="100" value="${feature.progress}" class="feature-progress-num" />
        </div>
      </label>
      <label>Summary<textarea name="summary" rows="4">${esc(feature.summary)}</textarea></label>
      <div id="featureDossierMount">${featureDossierEditorHtml(feature, featureDossierDeps())}</div>
      <h3>Card tasks <span class="hint">${tasksDone}/${tasksTotal} done · shown when card expands on site</span></h3>
      <div class="check-editor" id="featureTasks">${checkRows(feature.tasks)}</div>
      <button class="btn ghost small" id="addFeatureTask" type="button">Add task</button>
      <details class="feature-advanced"><summary>IDs, links, legacy images</summary>
        <div id="featureImagesHost">${recordImagesSectionHtml(feature.images, 'feature')}</div>
        <div class="row"><label>ID<input name="id" value="${esc(feature.id)}"></label></div>
        <div class="row"><label>Linked bugs<input name="linkedBugs" value="${esc((feature.linkedBugs || []).join(', '))}" placeholder="BUG-…" list="featureBugSuggestions"></label><label>Linked routes<input name="linkedRoutes" value="${esc((feature.linkedRoutes || []).join(', '))}" placeholder="gen2-gen3"></label></div>
        <datalist id="featureBugSuggestions">${(state.data['bugs.json'].bugs || []).map((b) => `<option value="${esc(b.id)}">`).join('')}</datalist>
        <div class="feature-advanced-footer">
          <button type="button" class="btn ghost small feature-delete-btn" id="deleteFeature" title="Remove this feature from the board">Delete feature</button>
        </div>
      </details>
    </div>
  </div>`;
}
function refreshFeatureListChrome(feature) {
  if (!feature) return;
  const btn = document.querySelector(`[data-feature-id="${CSS.escape(feature.id)}"]`);
  if (!btn) return;
  const meta = btn.querySelector('.feature-list-meta');
  if (!meta) return;
  const dossier = featureHasDossierContent(feature, normalizeFeatureDossierRaw);
  const photos = recordImageCount(feature);
  const dossierMark = dossier ? '<span class="record-list-dossier" title="Research dossier">◇</span>' : '';
  meta.innerHTML = `${dossierMark}${recordListPhotosBadge(photos)}${esc(feature.id)} · ${feature.progress}% · ${esc(feature.priority)}`;
}
function touchFeatureDraft() {
  markDirty(files.features);
  updateFeatureDirtyHint();
  bindSaveFeaturesButtons();
  refreshFeatureListChrome(getSelectedFeature());
  refreshFeatureDetailChrome(getSelectedFeature());
}
function refreshFeatureDetailChrome(feature) {
  if (!feature) return;
  const stageBadge = document.querySelector('.feature-detail .feature-stage-badge');
  if (stageBadge) {
    stageBadge.className = `badge feature-stage-badge feature-stage-${featureStageSlug(feature.stage)}`;
    stageBadge.textContent = feature.stage;
  }
  document.querySelectorAll('.feature-detail [data-feature-stage]').forEach((btn) => {
    btn.classList.toggle('is-current', btn.dataset.featureStage === feature.stage);
  });
  const stageSelect = document.querySelector('[data-form="feature"] select[name="stage"]');
  if (stageSelect) stageSelect.value = feature.stage;
  const progressLabel = document.querySelector('.feature-progress-label');
  const progressRange = document.querySelector('.feature-progress-range');
  const progressNum = document.querySelector('.feature-progress-num');
  if (progressLabel) progressLabel.textContent = `${feature.progress}%`;
  if (progressRange) progressRange.value = feature.progress;
  if (progressNum) progressNum.value = feature.progress;
  const dossierBadge = document.querySelector('.feature-detail-badges .record-detail-dossier');
  const hasDossier = featureHasDossierContent(feature, normalizeFeatureDossierRaw);
  if (hasDossier && !dossierBadge) {
    document.querySelector('.feature-detail-badges')?.insertAdjacentHTML(
      'beforeend',
      '<span class="badge record-detail-dossier" title="Research dossier">Dossier</span>',
    );
  }
  if (!hasDossier) dossierBadge?.remove();
}
function updateFeatureDirtyHint() {
  const dirty = state.dirty.has(files.features);
  document.querySelectorAll('.feature-save-hint').forEach((el) => {
    el.textContent = dirty ? 'Unsaved draft: click Save' : 'Saved to disk';
    el.classList.toggle('is-dirty', dirty);
  });
  const toolbar = document.querySelector('.feature-toolbar > div');
  if (!toolbar) return;
  const unsaved = toolbar.querySelector('.feature-unsaved');
  const ok = toolbar.querySelector('.feature-disk-ok');
  if (dirty) {
    ok?.remove();
    if (!unsaved) toolbar.insertAdjacentHTML('beforeend', '<p class="hint feature-unsaved"><strong>Not on disk yet</strong>: save when you are done editing.</p>');
  } else {
    unsaved?.remove();
    if (!ok) toolbar.insertAdjacentHTML('beforeend', '<p class="hint feature-disk-ok">In sync with disk.</p>');
  }
}
function bindSaveFeaturesButtons() {
  const dirty = state.dirty.has(files.features);
  document.querySelectorAll('.js-save-features').forEach((btn) => {
    btn.disabled = !dirty;
    btn.onclick = async (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (btn.disabled) return;
      btn.classList.add('btn-busy');
      btn.disabled = true;
      setLogStatus('Saving features…', 'busy');
      try {
        await saveFeaturesToDisk();
        flashEl(btn, 'btn-flash-ok');
        flashEl(document.querySelector('.feature-detail'), 'feature-flash-ok');
      } catch (e) {
        log(e.message, 'error');
        flashEl(btn, 'btn-flash-error');
      } finally {
        btn.classList.remove('btn-busy');
        bindSaveFeaturesButtons();
      }
    };
  });
}
async function saveFeaturesToDisk() {
  applyFeatureFromForm();
  (state.data['features.json'].features || []).forEach((feature) => {
    if (!feature.dossier) return;
    const pruned = normalizeFeatureDossierRaw(feature);
    if (featureHasDossierContent({ ...feature, dossier: pruned }, normalizeFeatureDossierRaw)) {
      feature.dossier = pruned;
    } else {
      delete feature.dossier;
    }
  });
  if (!state.dirty.has(files.features)) {
    log('No feature changes to save.', 'warn');
    return;
  }
  await saveFile(files.features, state.data['features.json']);
  log('Written to public/data/features.json.', 'ok');
  syncFeatureUIFromState();
}
function bindFeatureFilters() {
  document.querySelectorAll('[data-feature-filter]').forEach((btn) => {
    btn.onclick = () => {
      state.featureFilter = btn.dataset.featureFilter;
      syncFeatureUIFromState();
    };
  });
  const search = $('#featureSearch');
  if (search) {
    search.oninput = () => {
      state.featureSearch = search.value;
      const listHost = $('#featureListHost');
      if (listHost) {
        listHost.innerHTML = featureListItemsHtml(state.data['features.json'].features);
        bindFeatureList();
      }
    };
  }
}
function bindFeatureList() {
  const root = document.querySelector('[data-workshop-tab-panel="features"]');
  if (!root) return;
  root.querySelectorAll('[data-feature-id]').forEach((btn) => {
    btn.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      applyFeatureFromForm();
      state.selected.feature = btn.dataset.featureId;
      syncFeatureUIFromState();
    };
  });
}
function bindFeatureDetail() {
  document.querySelectorAll('[data-feature-stage]').forEach((btn) => {
    btn.onclick = () => {
      applyFeatureFromForm();
      patchSelectedFeature({ stage: btn.dataset.featureStage });
      refreshFeatureDetailChrome(getSelectedFeature());
      syncFeatureUIFromState({ detailOnly: true });
      log(`Draft: ${state.selected.feature} → ${btn.dataset.featureStage}. Save features when ready.`, 'ok');
      flashEl(document.querySelector('.feature-detail'), 'feature-flash-ok');
    };
  });
  const form = document.querySelector('[data-form="feature"]');
  if (!form) return;
  const onFieldChange = () => {
    applyFeatureFromForm();
    syncFeatureUIFromState({ detailOnly: true });
  };
  form.querySelectorAll('input, select, textarea').forEach((field) => {
    if (field.classList.contains('feature-progress-range')) {
      field.oninput = () => {
        applyFeatureFromForm();
        const num = form.querySelector('.feature-progress-num');
        if (num) num.value = field.value;
        patchSelectedFeature({ progress: Number(field.value) });
        refreshFeatureDetailChrome(getSelectedFeature());
        syncFeatureUIFromState({ detailOnly: true });
      };
      return;
    }
    if (field.classList.contains('feature-progress-num')) {
      field.onchange = onFieldChange;
      return;
    }
    field.onchange = onFieldChange;
  });
  const tasks = $('#featureTasks');
  if (tasks) {
    tasks.onchange = () => { applyFeatureTasksFromDom(); syncFeatureUIFromState({ detailOnly: true }); };
    tasks.oninput = (event) => {
      if (event.target.matches('.check-row input:not([type="checkbox"])')) applyFeatureTasksFromDom();
    };
  }
  const addTask = $('#addFeatureTask');
  if (addTask) addTask.onclick = () => {
    addCheck('FeatureTask');
    applyFeatureTasksFromDom();
    syncFeatureUIFromState({ detailOnly: true });
  };
  document.querySelectorAll('#featureTasks [data-remove]').forEach((btn) => {
    btn.onclick = () => {
      btn.closest('.check-row')?.remove();
      applyFeatureTasksFromDom();
      syncFeatureUIFromState({ detailOnly: true });
    };
  });
  const deleteFeature = $('#deleteFeature');
  if (deleteFeature) deleteFeature.onclick = () => deleteSelectedFeature();
  bindRecordImagesEditor(getSelectedFeature, 'feature', files.features);
  bindFeatureDossierEditor({
    ...featureDossierDeps(),
    renderEditorHtml: featureDossierEditorHtml,
    getRecord: getSelectedFeature,
    onDirty: touchFeatureDraft,
    rerender: () => syncFeatureUIFromState({ detailOnly: true }),
  });
}
function applyResearchFromForm({ persistOnly = false } = {}) {
  const entry = getSelectedResearch();
  if (!entry) return null;
  const form = document.querySelector('[data-form="research"]');
  if (!form) return entry;
  const before = clone(entry);
  const d = formData('[data-form="research"]');
  const categories = state.data['research.json'].categories || RESEARCH_CATEGORIES;
  const linkedPins = csv(d.linkedPins || d.linkedPois);
  const updates = {
    id: (d.id || entry.id).trim(),
    title: d.title ?? entry.title,
    category: categories.includes(d.category) ? d.category : (entry.category || 'Other'),
    subject: d.subject ?? entry.subject ?? '',
    confidence: d.confidence ?? entry.confidence,
    devStatus: d.devStatus ?? entry.devStatus,
    canonStatus: d.canonStatus ?? entry.canonStatus,
    summary: d.summary ?? entry.summary,
    tags: csv(d.tags),
    linkedPins,
    linkedFeatures: csv(d.linkedFeatures),
    relatedBugs: csv(d.relatedBugs),
  };
  if (!persistOnly) {
    const dossier = readDossierFromDom($, { mountSelector: '#researchDossierMount' });
    if (dossier !== null) updates.dossier = dossier;
    const evidenceImage = d.evidenceImage?.trim() || '';
    const evidenceNote = d.evidenceNote?.trim() || '';
    updates.evidence = evidenceImage
      ? [{ label: 'Curated evidence', image: evidenceImage, note: evidenceNote }]
      : (entry.evidence || []);
  } else {
    const evidenceImage = d.evidenceImage?.trim() || '';
    const evidenceNote = d.evidenceNote?.trim() || '';
    if (evidenceImage) {
      updates.evidence = [{ label: 'Curated evidence', image: evidenceImage, note: evidenceNote }];
    }
  }
  Object.assign(entry, updates);
  if (!persistOnly && Object.prototype.hasOwnProperty.call(entry, 'linkedPois')) delete entry.linkedPois;
  state.selected.research = entry.id;
  if (recordChanged(before, entry)) {
    markDirty(files.research);
    updateWorkshopSaveHints();
  }
  return entry;
}
function bindResearchDetail() {
  const form = document.querySelector('[data-form="research"]');
  if (!form) return;
  const onFieldChange = () => {
    applyResearchFromForm();
    updateWorkshopSaveHints();
  };
  form.querySelectorAll('input, select, textarea').forEach((field) => {
    field.onchange = onFieldChange;
  });
  const mount = document.querySelector('#researchDossierMount');
  if (mount) {
    delete mount.dataset.dossierBound;
    bindDossierEditor({
      ...featureDossierDeps(),
      mountSelector: '#researchDossierMount',
      renderEditorHtml: (record, deps) => dossierEditorHtml(record, deps, researchDossierConfig()),
      getRecord: getSelectedResearch,
      onDirty: () => {
        markDirty(files.research);
        updateWorkshopSaveHints();
      },
    });
  }
}
function syncWorkshopResearchUI({ detailOnly = false } = {}) {
  const entries = state.data['research.json'].entries || [];
  if (!state.selected.research || !entries.find((e) => e.id === state.selected.research)) {
    state.selected.research = entries[0]?.id || null;
  }
  const entry = getSelectedResearch();
  const listHost = $('#researchListHost');
  if (listHost) {
    listHost.innerHTML = workshopPickerList('research', entries, state.selected.research, (e) => e.title, (e) => `${e.category} · ${e.confidence}`);
    bindWorkshopResearchList();
  }
  const detailHost = $('#researchDetailHost');
  if (detailHost && !detailOnly) {
    detailHost.innerHTML = entry ? researchDetailHtml(entry) : '<p class="hint">Select a research entry.</p>';
    bindResearchDetail();
  }
  updateWorkshopSaveHints();
}
function bindResearchDesk() {
  const saveBtn = $('#saveResearch');
  if (saveBtn) saveBtn.onclick = async () => {
    applyResearchFromForm();
    (state.data['research.json'].entries || []).forEach(pruneRecordDossier);
    await saveFile(files.research, state.data['research.json']);
    log('Written to public/data/research.json.', 'ok');
    updateWorkshopSaveHints();
  };
  const newBtn = $('#newResearch');
  if (newBtn) newBtn.onclick = () => {
    applyResearchFromForm();
    const research = state.data['research.json'];
    if (!research.entries) research.entries = [];
    const entry = {
      id: `research-${Date.now().toString().slice(-5)}`,
      title: 'New research topic',
      category: 'Other',
      subject: '',
      confidence: 'Possible',
      canonStatus: '',
      devStatus: 'Needed',
      summary: '',
      tags: [],
      linkedPins: [],
      linkedFeatures: [],
      relatedBugs: [],
      evidence: [],
    };
    research.entries.unshift(entry);
    state.selected.research = entry.id;
    markDirty(files.research);
    setWorkshopTab('research');
    syncWorkshopResearchUI();
    log(`Created ${entry.id}. Save research when ready.`, 'ok');
  };
}
function applyPoiFromForm() {
  const poi = getSelectedPoi();
  if (!poi) return null;
  const d = formData('[data-form="poi"]');
  const dossier = readDossierFromDom($, { mountSelector: '#poiDossierMount' });
  Object.assign(poi, {
    id: (d.id || poi.id).trim(),
    name: d.name ?? poi.name,
    type: d.type ?? poi.type,
    confidence: d.confidence ?? poi.confidence,
    devStatus: d.devStatus ?? poi.devStatus,
    canonStatus: d.canonStatus ?? poi.canonStatus,
    summary: d.summary ?? poi.summary,
    position: [Number(d.x), Number(d.y), Number(d.z)],
    assetNeeds: csv(d.assetNeeds),
    linkedFeatures: csv(d.linkedFeatures),
    relatedBugs: csv(d.relatedBugs),
    evidence: d.evidenceImage ? [{ label: 'Curated evidence', image: d.evidenceImage, note: d.evidenceNote || '' }] : [],
    ...(dossier !== null ? { dossier } : {}),
  });
  state.selected.poi = poi.id;
  markDirty(files.pois);
  return poi;
}
function bindPoiDetail() {
  const form = document.querySelector('[data-form="poi"]');
  if (!form) return;
  const onFieldChange = () => {
    applyPoiFromForm();
    updateAtlasPoiDirtyHint();
  };
  form.querySelectorAll('input, select, textarea').forEach((field) => {
    field.onchange = onFieldChange;
  });
  const mount = document.querySelector('#poiDossierMount');
  if (mount) {
    delete mount.dataset.dossierBound;
    bindDossierEditor({
      ...featureDossierDeps(),
      mountSelector: '#poiDossierMount',
      renderEditorHtml: (record, deps) => dossierEditorHtml(record, deps, poiDossierConfig()),
      getRecord: getSelectedPoi,
      onDirty: () => {
        markDirty(files.pois);
        updateAtlasPoiDirtyHint();
      },
    });
  }
}
function updateAtlasPoiDirtyHint() {
  const dirty = state.dirty.has(files.pois);
  const hint = document.querySelector('.atlas-poi-save-hint');
  if (hint) {
    hint.textContent = dirty ? 'Unsaved' : 'Saved';
    hint.classList.toggle('is-dirty', dirty);
  }
  const toolbarNote = document.querySelector('.atlas-poi-toolbar .feature-unsaved, .atlas-poi-toolbar .feature-disk-ok');
  if (toolbarNote) {
    toolbarNote.outerHTML = dirty
      ? '<p class="hint feature-unsaved"><strong>Not on disk yet</strong></p>'
      : '<p class="hint feature-disk-ok">In sync with disk.</p>';
  }
}
function syncAtlasPoisUI({ detailOnly = false } = {}) {
  const pois = state.data['pois.json'].pois || [];
  if (!state.selected.poi || !pois.find((p) => p.id === state.selected.poi)) {
    state.selected.poi = pois[0]?.id || null;
  }
  const poi = getSelectedPoi();
  const listHost = $('#atlasPoiListHost');
  if (listHost) {
    listHost.innerHTML = workshopPickerList('atlas-poi', pois, state.selected.poi, (p) => p.name, (p) => `${p.type} · ${p.confidence}`);
    bindAtlasPoiList();
  }
  const detailHost = $('#atlasPoiDetailHost');
  if (detailHost && !detailOnly) {
    detailHost.innerHTML = poi ? poiDetailHtml(poi) : '<p class="hint">Select an atlas POI.</p>';
    bindPoiDetail();
  }
  updateAtlasPoiDirtyHint();
}
function bindAtlasPoiList() {
  const root = document.querySelector('.atlas-poi-desk');
  if (!root) return;
  root.querySelectorAll('[data-workshop-kind="atlas-poi"]').forEach((btn) => {
    btn.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      applyPoiFromForm();
      state.selected.poi = btn.dataset.id;
      syncAtlasPoisUI();
    };
  });
}
function bindAtlasPoisDesk() {
  const saveBtn = $('#savePois');
  if (saveBtn) saveBtn.onclick = async () => {
    applyPoiFromForm();
    (state.data['pois.json'].pois || []).forEach(pruneRecordDossier);
    await saveFile(files.pois, state.data['pois.json']);
    log('Written to public/data/pois.json.', 'ok');
    updateAtlasPoiDirtyHint();
  };
  bindAtlasPoiList();
  bindPoiDetail();
}
function ideaListHtml(items, selectedSlug) {
  return `<div class="list feature-list">${items.length ? items.map((item) => {
    const slug = item.slug || item.id;
    return `<button type="button" class="${selectedSlug === slug ? 'active' : ''}" data-idea-slug="${esc(slug)}"><strong>${esc(item.title)}</strong><span class="feature-list-meta">${esc(item.status)} · ${esc(slug)}</span></button>`;
  }).join('') : '<p class="hint feature-list-empty">No ideas yet.</p>'}</div>`;
}
function applyIdeaFromForm({ persistOnly = false } = {}) {
  const meta = getSelectedIdeaMeta();
  if (!meta) return null;
  const form = document.querySelector('[data-form="idea"]');
  if (!form) return meta;
  const d = readFormFields(form);
  const slug = (d.slug || meta.slug || meta.id).trim();
  const before = clone(meta);
  const heroPath = (d.heroPath ?? meta.heroImage?.path ?? '').trim();
  const heroCaption = (d.heroCaption ?? meta.heroImage?.caption ?? '').trim();
  const updates = {
    id: (d.id || meta.id).trim(),
    slug,
    title: d.title ?? meta.title,
    status: d.status ?? meta.status,
    summary: d.summary ?? meta.summary,
    tags: csv(d.tags),
    updatedAt: d.updatedAt ?? meta.updatedAt,
  };
  if (meta.heroImage || heroPath || heroCaption) {
    updates.heroImage = { ...(meta.heroImage || {}), path: heroPath, caption: heroCaption };
  }
  Object.assign(meta, updates);
  if (!persistOnly) {
    const dossier = readDossierFromDom($, { mountSelector: '#ideaDossierMount' });
    if (dossier !== null) state.ideaArticles[slug] = { dossier: dossier || { overview: '', sections: [] } };
  }
  state.selected.idea = slug;
  if (recordChanged(before, meta)) markDirty(files.ideas);
  return meta;
}
function ideaDetailHtml(record) {
  const hasDossier = featureHasDossierContent(record, normalizeFeatureDossierRaw);
  const hero = record.heroImage || {};
  return `<div class="feature-detail">
    <div class="feature-detail-badges">
      <span class="badge">${esc(record.slug || record.id)}</span>
      <span class="badge">${esc(record.status)}</span>
      ${hasDossier ? '<span class="badge record-detail-dossier">Body</span>' : ''}
    </div>
    <div class="form" data-form="idea">
      <label class="feature-title-field">Title<input name="title" value="${esc(record.title)}"></label>
      <div class="row"><label>ID<input name="id" value="${esc(record.id)}"></label><label>Slug<input name="slug" value="${esc(record.slug || record.id)}"></label></div>
      <div class="row"><label>Status<input name="status" value="${esc(record.status)}" placeholder="spark, promising, …"></label><label>Updated<input name="updatedAt" value="${esc(record.updatedAt || '')}" placeholder="2026-05-27"></label></div>
      <label>Tags<input name="tags" value="${esc((record.tags || []).join(', '))}"></label>
      <label>Card summary<textarea name="summary" rows="3">${esc(record.summary)}</textarea></label>
      <div class="row">${pathInputWithUploadHtml({ label: 'Hero image path', inputHtml: `<input name="heroPath" value="${esc(hero.path || '')}">`, uploadFolder: 'media/ideas', uploadSubdir: record.slug || record.id || '' })}<label>Hero caption<input name="heroCaption" value="${esc(hero.caption || '')}"></label></div>
      <p class="hint">Public URL: <code>#/ideas?idea=${esc(record.slug || record.id)}</code></p>
      <div id="ideaDossierMount">${dossierEditorHtml(record, featureDossierDeps(), ideaDossierConfig())}</div>
    </div>
  </div>`;
}
function syncIdeasUI({ detailOnly = false } = {}) {
  const items = state.data['ideas.json']?.items || [];
  const meta = getSelectedIdeaMeta();
  const record = getIdeaEditorRecord(meta);
  const listHost = $('#ideaListHost');
  if (listHost) {
    listHost.innerHTML = ideaListHtml(items, meta?.slug || meta?.id);
    bindIdeaList();
  }
  const detailHost = $('#ideaDetailHost');
  if (detailHost && !detailOnly) {
    detailHost.innerHTML = record ? ideaDetailHtml(record) : '<p class="hint">Select or create an idea.</p>';
    bindIdeaDetail();
  }
}
function bindIdeaList() {
  $('#ideaListHost')?.querySelectorAll('[data-idea-slug]').forEach((btn) => {
    btn.onclick = () => {
      applyIdeaFromForm();
      state.selected.idea = btn.dataset.ideaSlug;
      syncIdeasUI();
    };
  });
}
function bindIdeaDetail() {
  const mount = $('#ideaDossierMount');
  if (mount) {
    delete mount.dataset.dossierBound;
    bindDossierEditor({
      ...featureDossierDeps(),
      mountSelector: '#ideaDossierMount',
      renderEditorHtml: (record, deps) => dossierEditorHtml(record, deps, ideaDossierConfig()),
      getRecord: () => getIdeaEditorRecord(getSelectedIdeaMeta()),
      onDirty: () => {
        markDirty(files.ideas);
        updateWorkshopSaveHints();
      },
    });
  }
}
async function saveIdeasToDisk() {
  applyIdeaFromForm();
  const items = state.data['ideas.json']?.items || [];
  for (const item of items) {
    const slug = item.slug || item.id;
    const body = state.ideaArticles[slug];
    if (!body) continue;
    const articleResult = await api('/api/ideas/save-article', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug, data: body }),
    });
    logValidationWarnings(articleResult, `Idea article ${slug}`);
  }
  await saveFile(files.ideas, state.data['ideas.json']);
  log('Written ideas.json and article files.', 'ok');
  syncIdeasUI({ detailOnly: true });
  updateWorkshopSaveHints();
}
function bindIdeasDesk() {
  bindIdeaList();
  bindIdeaDetail();
  const saveBtn = $('#saveIdeas');
  if (saveBtn) saveBtn.onclick = () => saveIdeasToDisk().catch((e) => log(e.message, 'error'));
  const newBtn = $('#newIdea');
  if (newBtn) newBtn.onclick = () => {
    applyIdeaFromForm();
    const slug = `idea-${Date.now().toString().slice(-5)}`;
    const today = new Date().toISOString().slice(0, 10);
    const item = {
      id: slug,
      slug,
      title: 'New idea',
      status: 'spark',
      summary: 'One-line summary for the ideas hub card.',
      tags: [],
      updatedAt: today,
    };
    state.data['ideas.json'].items.unshift(item);
    state.ideaArticles[slug] = { dossier: { overview: '', sections: [] } };
    state.selected.idea = slug;
    markDirty(files.ideas);
    syncIdeasUI();
    log(`Created ${slug}. Save ideas when ready.`, 'ok');
  };
}
function workshopIdeasPane() {
  const manifest = state.data['ideas.json'] || { items: [] };
  const items = manifest.items || [];
  const meta = getSelectedIdeaMeta();
  const record = getIdeaEditorRecord(meta);
  const dirty = state.dirty.has(files.ideas);
  return `<div class="workshop-pane-inner feature-desk">
    <div class="feature-action-bar workshop-action-bar">
      <div class="feature-action-buttons">
        <button type="button" class="btn" id="saveIdeas">Save ideas</button>
        <button type="button" class="btn ghost" id="newIdea">New idea</button>
      </div>
      <span class="feature-save-hint${dirty ? ' is-dirty' : ''}">${dirty ? 'Unsaved' : 'Saved'}</span>
    </div>
    <p class="hint workshop-section-intro">Extended sparks for <strong>#/ideas</strong>. Index in <code>ideas.json</code>; bodies in <code>public/ideas/articles/{slug}.json</code>.</p>
    <div class="feature-layout workshop-layout">
      <aside class="panel feature-sidebar workshop-sidebar"><div id="ideaListHost">${ideaListHtml(items, meta?.slug || meta?.id)}</div></aside>
      <article class="panel feature-main workshop-main" id="ideaDetailHost">${record ? ideaDetailHtml(record) : '<p class="hint">Select or create an idea.</p>'}</article>
    </div>
  </div>`;
}
function resolveSelectedMilestoneId(milestones, data) {
  if (state.selected.milestone && milestones.find((m) => m.id === state.selected.milestone)) {
    return state.selected.milestone;
  }
  if (data.currentMilestoneId && milestones.find((m) => m.id === data.currentMilestoneId)) {
    return data.currentMilestoneId;
  }
  return milestones[0]?.id || null;
}
function applyMilestoneFromForm({ persistOnly = false } = {}) {
  const item = getSelectedMilestone();
  if (!item) return null;
  const form = document.querySelector('[data-form="milestone"]');
  if (!form) return item;
  const d = readFormFields(form);
  const roadmap = state.data['roadmap.json'];
  const before = clone(item);
  const beforeCurrent = roadmap.currentMilestoneId;
  const nextId = (d.id || item.id).trim();
  const image = (d.image ?? item.image ?? '').trim();
  const updates = {
    id: nextId,
    title: d.title ?? item.title,
    status: d.status ?? item.status,
    summary: d.summary ?? item.summary,
    image,
  };
  if (!persistOnly) {
    const dossier = readDossierFromDom($, { mountSelector: '#milestoneDossierMount' });
    if (dossier !== null && (item.dossier || featureHasDossierContent({ dossier }, normalizeFeatureDossierRaw))) {
      updates.dossier = dossier;
    }
  }
  Object.assign(item, updates);
  if (d.current === 'yes') roadmap.currentMilestoneId = nextId;
  else if (d.current === 'no' && roadmap.currentMilestoneId === item.id) roadmap.currentMilestoneId = null;
  else if (d.status === 'current' && d.current !== 'no') roadmap.currentMilestoneId = nextId;
  state.selected.milestone = nextId;
  if (recordChanged(before, item) || beforeCurrent !== roadmap.currentMilestoneId) markDirty(files.roadmap);
  return item;
}
const MILESTONE_ERA_ORDER = [
  { id: 'present', label: 'Now', statuses: ['current', 'next'], collapsible: false },
  { id: 'past', label: 'Past', statuses: ['past'], collapsible: true, defaultOpen: false },
  { id: 'future', label: 'Ahead', statuses: ['future', 'paused'], collapsible: true, defaultOpen: false },
];
function milestoneEraItems(milestones, statuses) {
  const set = new Set(statuses);
  const items = milestones.filter((m) => set.has(m.status));
  const other = milestones.filter((m) => !MILESTONE_ERA_ORDER.some((e) => e.statuses.includes(m.status)));
  if (statuses.includes('future') && other.length) items.push(...other);
  return items;
}
function milestoneListButton(m, selectedId) {
  return `<button type="button" class="milestone-list-item feature-list-item${selectedId === m.id ? ' active' : ''}" data-milestone-id="${esc(m.id)}">
      <strong>${esc(m.title)}</strong>
      <span class="feature-list-meta">${esc(m.status)} · ${esc(m.id)}</span>
    </button>`;
}
function milestoneListItemsHtml(milestones, selectedId) {
  if (!milestones.length) return '<p class="hint feature-list-empty">No milestones yet.</p>';
  const blocks = MILESTONE_ERA_ORDER.map((era) => {
    const items = milestoneEraItems(milestones, era.statuses);
    if (!items.length) return '';
    const list = `<div class="milestone-era-list">${items.map((m) => milestoneListButton(m, selectedId)).join('')}</div>`;
    if (!era.collapsible) {
      return `<section class="milestone-era milestone-era--${era.id}">
        <header class="milestone-era-head"><strong>${era.label}</strong><span class="milestone-era-count">${items.length}</span></header>
        ${list}
      </section>`;
    }
    return `<details class="milestone-era milestone-era--${era.id}"${era.defaultOpen ? ' open' : ''}>
      <summary class="milestone-era-summary"><strong>${era.label}</strong><span class="milestone-era-count">${items.length}</span></summary>
      ${list}
    </details>`;
  }).filter(Boolean);
  return `<div class="milestone-era-groups">${blocks.join('')}</div>`;
}
function updateMilestoneDirtyHint() {
  updateWorkshopSaveHints();
}
function syncMilestonesUI({ detailOnly = false } = {}) {
  const data = state.data['roadmap.json'];
  const milestones = data.milestones || [];
  const id = resolveSelectedMilestoneId(milestones, data);
  state.selected.milestone = id;
  const item = getSelectedMilestone();
  const listHost = $('#milestoneListHost');
  if (listHost) {
    listHost.innerHTML = milestoneListItemsHtml(milestones, id);
    bindMilestoneList();
  }
  const detailHost = $('#milestoneDetailHost');
  if (detailHost && !detailOnly) {
    detailHost.innerHTML = item ? milestoneDetailHtml(item, data) : '<p class="hint">Select a milestone.</p>';
    bindMilestoneDetail();
  }
  updateMilestoneDirtyHint();
}
function bindMilestoneList() {
  const root = document.querySelector('[data-workshop-tab-panel="milestones"]') || document.querySelector('.milestone-desk');
  if (!root) return;
  root.querySelectorAll('[data-milestone-id]').forEach((btn) => {
    btn.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      applyMilestoneFromForm();
      state.selected.milestone = btn.dataset.milestoneId;
      syncMilestonesUI();
    };
  });
}
function bindMilestoneDetail() {
  const form = document.querySelector('[data-form="milestone"]');
  if (!form) return;
  const onFieldChange = () => {
    applyMilestoneFromForm();
    syncMilestonesUI({ detailOnly: true });
  };
  form.querySelectorAll('input, select, textarea').forEach((field) => {
    field.onchange = onFieldChange;
  });
  const mount = document.querySelector('#milestoneDossierMount');
  if (mount) {
    delete mount.dataset.dossierBound;
    bindDossierEditor({
      ...featureDossierDeps(),
      mountSelector: '#milestoneDossierMount',
      renderEditorHtml: (record, deps) => dossierEditorHtml(record, deps, milestoneDossierConfig()),
      getRecord: getSelectedMilestone,
      onDirty: () => {
        markDirty(files.roadmap);
        updateMilestoneDirtyHint();
      },
    });
  }
}
function syncDocsUI({ detailOnly = false } = {}) {
  const articles = state.data['docs.json']?.articles || [];
  const meta = getSelectedDocMeta();
  const record = getDocEditorRecord(meta);
  const listHost = $('#docListHost');
  if (listHost) {
    listHost.innerHTML = docListHtml(articles, meta?.slug);
    bindDocList();
  }
  const detailHost = $('#docDetailHost');
  if (detailHost && !detailOnly) {
    const categories = state.data['docs.json']?.categories || [];
    detailHost.innerHTML = record ? docDetailHtml(record, categories) : '<p class="hint">Select or create an article.</p>';
    bindDocDetail();
  }
}
function bindDocList() {
  $('#docListHost')?.querySelectorAll('[data-doc-slug]').forEach((btn) => {
    btn.onclick = () => {
      applyDocFromForm();
      state.selected.doc = btn.dataset.docSlug;
      syncDocsUI();
    };
  });
}
function bindDocDetail() {
  const mount = $('#docDossierMount');
  if (mount) {
    delete mount.dataset.dossierBound;
    bindDossierEditor({
      ...featureDossierDeps(),
      mountSelector: '#docDossierMount',
      renderEditorHtml: (record, deps) => dossierEditorHtml(record, deps, docDossierConfig()),
      getRecord: () => getDocEditorRecord(getSelectedDocMeta()),
      onDirty: () => {
        markDirty(files.docs);
        updateWorkshopSaveHints();
      },
    });
  }
}
async function saveDocsToDisk() {
  applyDocFromForm();
  const articles = state.data['docs.json']?.articles || [];
  for (const article of articles) {
    const body = state.docArticles[article.slug];
    if (!body) continue;
    const articleResult = await api('/api/docs/save-article', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: article.slug, data: body }),
    });
    logValidationWarnings(articleResult, `Doc article ${article.slug}`);
  }
  await saveFile(files.docs, state.data['docs.json']);
  log('Written docs.json and article files.', 'ok');
  syncDocsUI({ detailOnly: true });
  updateWorkshopSaveHints();
}
function bindDocsDesk() {
  bindDocList();
  bindDocDetail();
  const saveBtn = $('#saveDocs');
  if (saveBtn) saveBtn.onclick = () => saveDocsToDisk().catch((e) => log(e.message, 'error'));
  const newBtn = $('#newDoc');
  if (newBtn) newBtn.onclick = () => {
    applyDocFromForm();
    const slug = `doc-${Date.now().toString().slice(-5)}`;
    const today = new Date().toISOString().slice(0, 10);
    const article = {
      id: slug,
      slug,
      title: 'New documentation article',
      category: (state.data['docs.json'].categories || [])[0]?.id || 'formats',
      tags: [],
      summary: 'One-line summary for the docs hub card.',
      publishedAt: today,
      updatedAt: today,
      featured: false,
      author: 'Resort Operations',
      heroImage: { path: 'assets/docs/article-placeholder.svg', caption: 'Replace with hero art.' },
    };
    state.data['docs.json'].articles.unshift(article);
    state.docArticles[slug] = { dossier: { overview: '', sections: [] } };
    state.selected.doc = slug;
    markDirty(files.docs);
    syncDocsUI();
    log(`Created ${slug}. Save docs when ready.`, 'ok');
  };
}
function openWorkshopPane(paneKey) {
  setWorkshopTab(paneKey);
}
function bindWorkshopResearchList() {
  const root = document.querySelector('[data-workshop-tab-panel="research"]');
  if (!root) return;
  root.querySelectorAll('[data-workshop-kind="research"]').forEach((btn) => {
    btn.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      applyResearchFromForm();
      state.selected.research = btn.dataset.id;
      if (state.workshopTab !== 'research') setWorkshopTab('research', { replace: true });
      syncWorkshopResearchUI();
      document.querySelector('[data-workshop-tab-panel="research"]')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    };
  });
}
function bindWorkshopPaneSection(paneKey) {
  if (paneKey === 'milestones') bindMilestonesDesk();
  else if (paneKey === 'docs') bindDocsDesk();
  else if (paneKey === 'features') bindFeatureDesk();
  else if (paneKey === 'bugs') bindBugDesk();
  else if (paneKey === 'ideas') bindIdeasDesk();
}
function bindWorkshopDesk() {
  document.querySelectorAll('[data-workshop-tab]').forEach((btn) => {
    btn.onclick = () => setWorkshopTab(btn.dataset.workshopTab);
  });
  bindWorkshopPaneSection(state.workshopTab || DEFAULT_WORKSHOP_TAB);
}
function bindMilestonesDesk() {
  const saveBtn = $('#saveRoadmap');
  if (saveBtn) saveBtn.onclick = async () => {
    applyMilestoneFromForm();
    (state.data['roadmap.json'].milestones || []).forEach(pruneRecordDossier);
    await saveFile(files.roadmap, state.data['roadmap.json']);
    log('Written to public/data/roadmap.json.', 'ok');
    updateMilestoneDirtyHint();
  };
  const newBtn = $('#newMilestone');
  if (newBtn) newBtn.onclick = () => {
    applyMilestoneFromForm();
    const item = { id: `milestone-${Date.now().toString().slice(-5)}`, title: 'New milestone', status: 'future', summary: 'Describe the milestone.' };
    state.data['roadmap.json'].milestones.push(item);
    state.selected.milestone = item.id;
    markDirty(files.roadmap);
    syncMilestonesUI();
    log(`Created ${item.id}. Save milestones when ready.`, 'ok');
  };
  bindMilestoneList();
  bindMilestoneDetail();
}
function syncFeatureUIFromState({ detailOnly = false } = {}) {
  const data = state.data['features.json'];
  const features = data.features;
  const stages = data.stages;
  if (!state.selected.feature || !features.find((f) => f.id === state.selected.feature)) {
    state.selected.feature = filteredFeatures(features, { filter: state.featureFilter, query: state.featureSearch })[0]?.id || features[0]?.id;
  }
  const feature = getSelectedFeature();
  const listHost = $('#featureListHost');
  if (listHost) {
    listHost.innerHTML = featureListItemsHtml(features);
    bindFeatureList();
  }
  if (!detailOnly) {
    const filtersHost = $('#featureFiltersHost');
    if (filtersHost) {
      filtersHost.innerHTML = featureFiltersHtml(features, stages);
      bindFeatureFilters();
    }
  }
  const detailHost = $('#featureDetailHost');
  if (detailHost && !detailOnly) {
    detailHost.innerHTML = featureDetailHtml(feature, data);
    bindFeatureDetail();
  }
  updateFeatureDirtyHint();
  bindSaveFeaturesButtons();
}
function bindFeatureDesk() {
  bindFeatureFilters();
  bindFeatureList();
  bindFeatureDetail();
  bindSaveFeaturesButtons();
  const newFeature = $('#newFeature');
  if (newFeature) newFeature.onclick = () => {
    const item = {
      id: `FEAT-NEW-${Date.now().toString().slice(-5)}`,
      title: 'New feature',
      area: 'General',
      stage: 'Boarding Soon',
      priority: 'Medium',
      progress: 0,
      summary: 'Describe the feature.',
      linkedBugs: [],
      linkedRoutes: [],
      tasks: [],
    };
    state.data['features.json'].features.unshift(item);
    state.selected.feature = item.id;
    state.featureFilter = 'active';
    touchFeatureDraft();
    syncFeatureUIFromState();
    log(`Created ${item.id}. Save features when ready.`, 'ok');
  };
}
function workshopFeaturesPane() {
  const data = state.data['features.json'];
  const features = data.features;
  if (!state.selected.feature) {
    state.selected.feature = filteredFeatures(features, { filter: state.featureFilter })[0]?.id || features[0]?.id;
  }
  const dirty = state.dirty.has(files.features);
  return `<div class="workshop-pane-inner feature-desk">
    <div class="feature-action-bar workshop-action-bar">
      <div class="feature-action-buttons">
        <button type="button" class="btn js-save-features">Save features</button>
        <button type="button" class="btn ghost" id="newFeature">New feature</button>
      </div>
      <span class="feature-save-hint${dirty ? ' is-dirty' : ''}">${dirty ? 'Unsaved' : 'Saved'}</span>
    </div>
    <div class="feature-layout workshop-layout">
      <aside class="panel feature-sidebar workshop-sidebar">
        <div id="featureFiltersHost">${featureFiltersHtml(features, data.stages)}</div>
        <div id="featureListHost">${featureListItemsHtml(features)}</div>
      </aside>
      <article class="panel feature-main workshop-main" id="featureDetailHost">${featureDetailHtml(getSelectedFeature(), data)}</article>
    </div>
  </div>`;
}
function researchDetailHtml(entry) {
  const data = state.data['research.json'];
  const categories = data.categories || RESEARCH_CATEGORIES;
  const legend = data.confidenceLegend || ['Confirmed', 'Likely', 'Possible', 'Speculative', 'Original for gameplay'];
  const hasDossier = featureHasDossierContent(entry, normalizeFeatureDossierRaw);
  const pinOptions = (state.data['atlas-pins.json']?.pins || []).map((p) => p.id).join(', ');
  return `<div class="feature-detail">
    <div class="feature-detail-head">
      <div class="feature-detail-badges">
        <span class="badge">${esc(entry.id)}</span>
        <span class="badge">${esc(entry.category)}</span>
        <span class="badge">${esc(entry.confidence)}</span>
        ${hasDossier ? '<span class="badge record-detail-dossier" title="Research brief">Brief</span>' : ''}
      </div>
    </div>
    <div class="form" data-form="research">
      <label class="feature-title-field">Title<input name="title" value="${esc(entry.title)}"></label>
      <div class="row"><label>ID<input name="id" value="${esc(entry.id)}"></label><label>Category<select name="category">${categories.map((c) => `<option ${entry.category === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label></div>
      <label>Subject / focus<input name="subject" value="${esc(entry.subject || '')}" placeholder="e.g. Nurse Joy, Pikachu line, Route 101…"></label>
      <div class="row three"><label>Confidence<select name="confidence">${legend.map((s) => `<option ${entry.confidence === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label><label>Dev status<input name="devStatus" value="${esc(entry.devStatus)}"></label><label>Canon status<input name="canonStatus" value="${esc(entry.canonStatus)}"></label></div>
      <label>Card summary<textarea name="summary" rows="3">${esc(entry.summary)}</textarea></label>
      <label>Tags<input name="tags" value="${esc((entry.tags || []).join(', '))}" placeholder="comma-separated"></label>
      <details class="feature-advanced"><summary>Links &amp; evidence</summary>
        <label>Linked atlas pin ids<input name="linkedPins" value="${esc((entry.linkedPins || entry.linkedPois || []).join(', '))}" placeholder="${esc(pinOptions || 'ferry-dock')}"></label>
        <p class="hint">Optional cork pins: edit under <strong>Island Atlas</strong> tab.</p>
        <label>Linked features<input name="linkedFeatures" value="${esc((entry.linkedFeatures || []).join(', '))}"></label>
        <label>Related bugs<input name="relatedBugs" value="${esc((entry.relatedBugs || []).join(', '))}"></label>
        ${pathInputWithUploadHtml({
    label: 'Legacy evidence image',
    inputHtml: `<input name="evidenceImage" value="${esc(entry.evidence?.[0]?.image || '')}">`,
    uploadFolder: 'media/research',
  })}
        <label>Evidence note<textarea name="evidenceNote" rows="2">${esc(entry.evidence?.[0]?.note || '')}</textarea></label>
      </details>
      <div id="researchDossierMount">${dossierEditorHtml(entry, featureDossierDeps(), researchDossierConfig())}</div>
    </div>
  </div>`;
}
function workshopResearchPane() {
  const entries = state.data['research.json'].entries || [];
  const id = state.selected.research || entries[0]?.id;
  state.selected.research = id;
  const entry = entries.find((e) => e.id === id);
  const dirty = state.dirty.has(files.research);
  return `<div class="workshop-pane-inner feature-desk">
    <div class="feature-action-bar workshop-action-bar">
      <div class="feature-action-buttons">
        <button type="button" class="btn" id="saveResearch">Save research</button>
        <button type="button" class="btn ghost" id="newResearch">New entry</button>
      </div>
      <span class="feature-save-hint${dirty ? ' is-dirty' : ''}">${dirty ? 'Unsaved' : 'Saved'}</span>
    </div>
    <div class="feature-layout workshop-layout">
      <aside class="panel feature-sidebar workshop-sidebar"><div id="researchListHost">${workshopPickerList('research', entries, id, (e) => e.title, (e) => `${e.category} · ${e.confidence}`)}</div></aside>
      <article class="panel feature-main workshop-main" id="researchDetailHost">${entry ? researchDetailHtml(entry) : '<p class="hint">Select a research entry.</p>'}</article>
    </div>
  </div>`;
}
function atlasPoisEditor() {
  const pois = state.data['pois.json'].pois || [];
  const id = state.selected.poi || pois[0]?.id;
  state.selected.poi = id;
  const poi = pois.find((p) => p.id === id);
  const dirty = state.dirty.has(files.pois);
  return `<section class="toolbar feature-toolbar atlas-poi-toolbar">
    <div><h2>Atlas POIs</h2><p>3D island map markers only. Attach dossiers and lore directly on each POI.</p>${dirty ? '<p class="hint feature-unsaved"><strong>Not on disk yet</strong></p>' : '<p class="hint feature-disk-ok">In sync with disk.</p>'}</div>
  </section>
  <section class="panel atlas-poi-desk">
    <div class="feature-action-bar milestone-action-bar">
      <div class="feature-action-buttons">
        <button type="button" class="btn" id="savePois">Save atlas POIs</button>
        <button type="button" class="btn ghost" id="newAtlasPoi">New map POI</button>
      </div>
      <span class="feature-save-hint atlas-poi-save-hint${dirty ? ' is-dirty' : ''}">${dirty ? 'Unsaved' : 'Saved'}</span>
    </div>
    <div class="feature-layout milestone-layout">
      <aside class="panel feature-sidebar milestone-sidebar"><div id="atlasPoiListHost">${workshopPickerList('atlas-poi', pois, id, (p) => p.name, (p) => `${p.type} · ${p.confidence}`)}</div></aside>
      <article class="panel feature-main milestone-main" id="atlasPoiDetailHost">${poi ? poiDetailHtml(poi) : '<p class="hint">Select a map POI.</p>'}</article>
    </div>
  </section><pre id="output" class="output" style="margin-top:16px"></pre>`;
}
function workshop() {
  const active = state.workshopTab || DEFAULT_WORKSHOP_TAB;
  const panes = {
    milestones: workshopMilestonesPane,
    docs: workshopDocsPane,
    features: workshopFeaturesPane,
    bugs: workshopBugsPane,
    ideas: workshopIdeasPane,
  };
  const panelHtml = (panes[active] || workshopMilestonesPane)();
  const dirtyNote = WORKSHOP_SECTIONS
    .map((section) => state.dirty.has(workshopSectionFile(section.id)) && section.id)
    .filter(Boolean);
  return `<section class="toolbar feature-toolbar workshop-toolbar">
    <div><h2>Workshop</h2><p>Milestones, docs, features, bugs, and ideas. Cork map pins live under <strong>Island Atlas</strong>.</p>
    ${dirtyNote.length ? `<p class="hint feature-unsaved"><strong>Unsaved:</strong> ${dirtyNote.join(', ')}</p>` : '<p class="hint feature-disk-ok">All workshop files in sync with disk.</p>'}</div>
  </section>
  <section class="panel workshop-page">
    ${workshopTabBarHtml()}
    <div class="workshop-tab-panel" data-workshop-tab-panel="${active}" role="tabpanel">
      ${panelHtml}
    </div>
  </section>`;
}
function poiDetailHtml(poi) {
  const hasDossier = featureHasDossierContent(poi, normalizeFeatureDossierRaw);
  return `<div class="feature-detail">
    <div class="feature-detail-head">
      <div class="feature-detail-badges">
        <span class="badge">${esc(poi.id)}</span>
        <span class="badge">${esc(poi.confidence)}</span>
        ${hasDossier ? '<span class="badge record-detail-dossier" title="Research brief">Brief</span>' : ''}
      </div>
    </div>
    <div class="form" data-form="poi">
      <label class="feature-title-field">Name<input name="name" value="${esc(poi.name)}"></label>
      <div class="row"><label>ID<input name="id" value="${esc(poi.id)}"></label><label>Type<input name="type" value="${esc(poi.type)}"></label></div>
      <div class="row three"><label>Confidence<select name="confidence">${['Confirmed','Likely','Possible','Speculative','Original for gameplay'].map((s) => `<option ${poi.confidence === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label><label>Dev status<input name="devStatus" value="${esc(poi.devStatus)}"></label><label>Canon status<input name="canonStatus" value="${esc(poi.canonStatus)}"></label></div>
      <label>Card summary<textarea name="summary" rows="3">${esc(poi.summary)}</textarea></label>
      <details class="feature-advanced"><summary>Atlas map position <span class="hint">(optional)</span></summary>
        <p class="hint">Only needed when this POI should appear on the 3D island map. Leave at 0,0,0 if unsure.</p>
        <div class="row three"><label>X<input name="x" type="number" step="0.05" value="${poi.position[0]}"></label><label>Y<input name="y" type="number" step="0.05" value="${poi.position[1]}"></label><label>Z<input name="z" type="number" step="0.05" value="${poi.position[2]}"></label></div>
      </details>
      <details class="feature-advanced"><summary>Links &amp; legacy evidence</summary>
        <label>Asset needs<input name="assetNeeds" value="${esc((poi.assetNeeds || []).join(', '))}"></label>
        <label>Linked features<input name="linkedFeatures" value="${esc((poi.linkedFeatures || []).join(', '))}"></label>
        <label>Related bugs<input name="relatedBugs" value="${esc((poi.relatedBugs || []).join(', '))}"></label>
        ${pathInputWithUploadHtml({
    label: 'Legacy evidence image',
    inputHtml: `<input name="evidenceImage" value="${esc(poi.evidence?.[0]?.image || '')}">`,
    uploadFolder: 'media/atlas',
  })}
        <label>Evidence note<textarea name="evidenceNote" rows="2">${esc(poi.evidence?.[0]?.note || '')}</textarea></label>
      </details>
      <div id="poiDossierMount">${dossierEditorHtml(poi, featureDossierDeps(), poiDossierConfig())}</div>
    </div>
  </div>`;
}
function boxartStatusLine() {
  const status = state.boxart;
  if (!status) return '<p class="hint">Loading box art status…</p>';
  return `<p class="hint"><strong>Libretro:</strong> <a href="https://thumbnails.libretro.com/" target="_blank" rel="noopener">thumbnails.libretro.com</a> · ${status.missingCount} missing on disk · USA / USA+Europe preferred · Switch titles: add files manually.</p>`;
}
async function refreshBoxartStatus() {
  state.boxart = await api('/api/boxart/status');
  return state.boxart;
}
function resetBoxartPicker() {
  state.boxartPicker = { candidates: [], options: [], selectedCandidateId: null, searchQuery: '', loading: false };
}
function renderCoverCards(candidates) {
  if (!candidates.length) return '<p class="hint">Click <strong>Find covers</strong> for Libretro matches. Switch titles are not on Libretro: add files manually at the path above.</p>';
  return `<div class="cover-grid">${candidates.map((c, i) => `
    <article class="cover-card">
      <img src="${proxyImage(c.url)}" alt="${esc(c.regionLabel)}" loading="lazy">
      <strong>${esc(c.regionLabel)}</strong>
      <span>${esc(c.name)}</span>
      ${c.recommended ? '<span class="tag recommended">Recommended</span>' : '<span class="tag">Alternate</span>'}
      <div class="actions"><button type="button" class="btn small" data-apply-cover="${i}" data-image-url="${esc(c.url)}">Use this cover</button></div>
    </article>`).join('')}</div>`;
}
function gameBoxArtPanel(game) {
  const picker = state.boxartPicker;
  const hasFile = game?.boxArt && state.assets.includes(game.boxArt);
  const isMissing = state.boxart?.missing?.some((m) => m.id === game.id);
  return `<section class="boxart-panel">
    <div class="boxart-panel-head">
      <div><h3>Box art</h3><p class="hint">${hasFile ? 'File on disk.' : isMissing ? 'Missing on disk: fetch below or drop a file at the path.' : 'Path set; refresh status if you just added a file.'} · <strong>${esc(game.platform)}</strong></p></div>
      <div class="actions"><button type="button" class="btn ghost small" id="searchBoxart">Find covers</button><button type="button" class="btn ghost small" id="autoPickBoxart">Auto-pick recommended</button></div>
    </div>
    <div class="game-preview-large"><img src="${game?.boxArt ? `/${esc(game.boxArt)}?t=${Date.now()}` : ''}" alt="" onerror="this.style.display='none'"></div>
    <div class="boxart-step">
      ${picker.loading ? '<p class="hint">Searching Libretro Thumbnails…</p>' : renderCoverCards(picker.candidates)}
    </div>
  </section>`;
}
function libraryGamesPane() {
  const data = state.data['compatibility.json'];
  const games = data.games;
  const id = state.selected.game || games[0]?.id;
  state.selected.game = id;
  const game = games.find((g) => g.id === id);
  const missing = state.boxart?.missingCount ?? 0;
  const dirty = state.dirty.has(files.compatibility);
  return `<div class="workshop-pane-inner library-games-desk">
    <div class="feature-action-bar workshop-action-bar">
      <div class="feature-action-buttons">
        <button class="btn" id="saveGames">Save library</button>
        <button type="button" class="btn ghost" id="refreshBoxartStatus">Refresh status</button>
        <button type="button" class="btn" id="fetchAllRecommended"${missing ? '' : ' disabled'}>Accept all recommended (${missing})</button>
        <button type="button" class="btn ghost" id="refetchAllBoxart">Refetch all</button>
      </div>
      <span class="feature-save-hint${dirty ? ' is-dirty' : ''}">${dirty ? 'Unsaved' : 'Saved'}</span>
    </div>
    <div class="hint workshop-section-intro">${boxartStatusLine()}</div>
    <section class="editor-grid workshop-layout">
      <aside class="panel">${list(games, id, (g) => `${g.shortTitle}${state.boxart?.missing?.some((m) => m.id === g.id) ? ' · needs art' : ''}`)}</aside>
      <article class="panel game-library-main">${game ? `${gameForm(game, data)}${gameBoxArtPanel(game)}` : '<p class="hint">Select a game.</p>'}</article>
    </section>
  </div>`;
}
function libraryMediaPane() {
  const dirty = state.dirty.has(files.gallery);
  return `<div class="workshop-pane-inner library-media-desk">
    <div class="feature-action-bar workshop-action-bar">
      <div class="feature-action-buttons">
        <button class="btn" id="saveJsonEditor">Save gallery JSON</button>
      </div>
      <span class="feature-save-hint${dirty ? ' is-dirty' : ''}">${dirty ? 'Unsaved' : 'Saved'}</span>
    </div>
    <p class="hint workshop-section-intro">Add files to <code>public/media</code>, then create gallery records that point to them.</p>
    <section class="editor-grid workshop-layout">
      <aside class="panel"><h2>Detected assets</h2><div class="list">${state.assets.slice(0, 80).map((asset) => `<button type="button"><strong>${esc(asset.split('/').pop())}</strong><span>${esc(asset)}</span></button>`).join('')}</div></aside>
      <article class="panel">${jsonEditorInner(files.gallery)}</article>
    </section>
  </div>`;
}
function libraryModelsPane() {
  const data = state.data['models.json'];
  const dirty = state.dirty.has(files.models);
  return `<div class="workshop-pane-inner library-models-desk">
    <div class="feature-action-bar workshop-action-bar">
      <div class="feature-action-buttons">
        <button type="button" class="btn ghost" id="saveJsonEditor">Save full JSON</button>
        <button type="button" class="btn" id="saveModels">Save main model fields</button>
      </div>
      <span class="feature-save-hint${dirty ? ' is-dirty' : ''}">${dirty ? 'Unsaved' : 'Saved'}</span>
    </div>
    <p class="hint workshop-section-intro">Edit the master island model and submodel records used inside the Atlas page.</p>
    <section class="panel"><div class="form" data-form="models"><h3>Main island model</h3><p class="hint">Upload and size the island on the <strong>Island Atlas</strong> tab. Fields here are advanced overrides.</p><div class="row three"><label>Name<input name="mainName" value="${esc(data.mainModel.name)}"></label><label>Status<input name="mainStatus" value="${esc(data.mainModel.status)}"></label><label>Display size<input name="mainDisplaySize" type="number" min="0.5" max="120" step="0.5" value="${esc(data.mainModel.displaySize ?? 6.2)}"></label></div><div class="row two"><label>File path<input name="mainFile" value="${esc(data.mainModel.file)}"></label><label>Preview path<input name="mainPreview" value="${esc(data.mainModel.preview)}"></label></div><label>Summary<textarea name="mainSummary">${esc(data.mainModel.summary)}</textarea></label></div></section>
    <section class="panel" style="margin-top:16px"><h2>Submodels</h2><p class="hint">Use the JSON area for detailed submodel arrays while keeping the main model fields easy to edit.</p>${jsonEditorInner(files.models)}</section>
  </div>`;
}
function libraryCharactersPane() {
  const data = state.data['characters.json'];
  const dirty = state.dirty.has(files.characters);
  return `<div class="workshop-pane-inner library-characters-desk">
    <div class="feature-action-bar workshop-action-bar">
      <div class="feature-action-buttons">
        <button class="btn" id="saveJsonEditor">Save character JSON</button>
      </div>
      <span class="feature-save-hint${dirty ? ' is-dirty' : ''}">${dirty ? 'Unsaved' : 'Saved'}</span>
    </div>
    <p class="hint workshop-section-intro">Edit the characters and visitor sprite registry used by the Atlas page.</p>
    <section class="editor-grid workshop-layout">
      <aside class="panel"><h2>Sprite requirements</h2><div class="list">${data.spriteRequirements.map((req) => `<button type="button"><strong>${esc(req.label)}</strong><span>${esc(req.path)}</span></button>`).join('')}</div></aside>
      <article class="panel">${jsonEditorInner(files.characters)}</article>
    </section>
  </div>`;
}
function gameEngine() {
  return gameEngineHubHtml(state.gameEngineTools, esc);
}
function library() {
  const active = state.libraryTab || DEFAULT_LIBRARY_TAB;
  const panes = {
    games: libraryGamesPane,
    media: libraryMediaPane,
    models: libraryModelsPane,
    characters: libraryCharactersPane,
  };
  const panelHtml = (panes[active] || libraryGamesPane)();
  const dirtyNote = LIBRARY_SECTIONS
    .map((section) => state.dirty.has(librarySectionFile(section.id)) && section.id)
    .filter(Boolean);
  return `<section class="toolbar feature-toolbar library-toolbar">
    <div><h2>Library</h2><p>Games, characters, media gallery, and 3D model stack.</p>
    ${dirtyNote.length ? `<p class="hint feature-unsaved"><strong>Unsaved:</strong> ${dirtyNote.join(', ')}</p>` : '<p class="hint feature-disk-ok">All library files in sync with disk.</p>'}</div>
  </section>
  <section class="panel workshop-page library-page">
    ${libraryTabBarHtml()}
    <div class="workshop-tab-panel library-tab-panel" data-library-tab-panel="${active}" role="tabpanel">
      ${panelHtml}
    </div>
  </section>`;
}
function gameForm(game, data) {
  return `<h2>${esc(game.title)}</h2><div class="form" data-form="game">
    <div class="row"><label>ID<input name="id" value="${esc(game.id)}"></label><label>Title<input name="title" value="${esc(game.title)}"></label></div>
    <div class="row three"><label>Generation<select name="generation">${data.generations.map(g => `<option value="${g.id}" ${game.generation===g.id?'selected':''}>${g.label}</option>`).join('')}</select></label><label>Short title<input name="shortTitle" value="${esc(game.shortTitle)}"></label><label>Platform<input name="platform" value="${esc(game.platform)}"></label></div>
    <div class="row"><label>Release year<input name="releaseYear" type="number" value="${game.releaseYear}"></label><label>Family<input name="family" value="${esc(game.family)}"></label></div>
    ${pathInputWithUploadHtml({ label: 'Box art path', inputHtml: `<input name="boxArt" value="${esc(game.boxArt)}">`, uploadFolder: 'media/games/box-art', browseFolder: 'media/games/box-art' })}
  </div>`;
}

function jsonEditorInner(file) { return `<textarea id="jsonEditor" style="min-height:420px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace">${esc(JSON.stringify(state.data[file], null, 2))}</textarea>`; }
function workshopMilestonesPane() {
  const data = state.data['roadmap.json'];
  const milestones = data.milestones || [];
  const id = resolveSelectedMilestoneId(milestones, data);
  state.selected.milestone = id;
  const item = getSelectedMilestone();
  const dirty = state.dirty.has(files.roadmap);
  return `<div class="workshop-pane-inner milestone-desk">
    <div class="feature-action-bar milestone-action-bar workshop-action-bar">
      <div class="feature-action-buttons">
        <button type="button" class="btn" id="saveRoadmap">Save milestones</button>
        <button type="button" class="btn ghost" id="newMilestone">New milestone</button>
      </div>
      <span class="feature-save-hint milestone-save-hint${dirty ? ' is-dirty' : ''}">${dirty ? 'Unsaved' : 'Saved'}</span>
    </div>
    <p class="hint workshop-section-intro">Timeline for the public <strong>Ideas &amp; Milestones</strong> tab. Mark one item as current.</p>
    <div class="feature-layout milestone-layout workshop-layout">
      <aside class="panel feature-sidebar milestone-sidebar workshop-sidebar"><div id="milestoneListHost">${milestoneListItemsHtml(milestones, id)}</div></aside>
      <article class="panel feature-main milestone-main workshop-main" id="milestoneDetailHost">${item ? milestoneDetailHtml(item, data) : '<p class="hint">Select a milestone.</p>'}</article>
    </div>
  </div>`;
}
function milestoneDetailHtml(item, data) {
  const hasDossier = featureHasDossierContent(item, normalizeFeatureDossierRaw);
  return `<div class="feature-detail">
    <div class="feature-detail-badges">
      <span class="badge">${esc(item.id)}</span>
      <span class="badge">${esc(item.status)}</span>
      ${hasDossier ? '<span class="badge record-detail-dossier">Brief</span>' : ''}
    </div>
    <div class="form" data-form="milestone">
      <label class="feature-title-field">Title<input name="title" value="${esc(item.title)}"></label>
      <div class="row"><label>ID<input name="id" value="${esc(item.id)}"></label><label>Status<select name="status">${['past', 'current', 'next', 'future', 'paused'].map((s) => `<option ${item.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label></div>
      <div class="row"><label>Current milestone<select name="current">${['no', 'yes'].map((v) => `<option ${((data.currentMilestoneId === item.id && v === 'yes') || (data.currentMilestoneId !== item.id && v === 'no')) ? 'selected' : ''}>${v}</option>`).join('')}</select></label>${pathInputWithUploadHtml({ label: 'Hero image path', inputHtml: `<input name="image" value="${esc(item.image || '')}">`, uploadFolder: 'media/milestones' })}</div>
      <label>Card summary<textarea name="summary" rows="3">${esc(item.summary)}</textarea></label>
      <div id="milestoneDossierMount">${dossierEditorHtml(item, featureDossierDeps(), milestoneDossierConfig())}</div>
    </div>
  </div>`;
}
function workshopDocsPane() {
  const manifest = state.data['docs.json'] || { categories: [], articles: [] };
  const articles = manifest.articles || [];
  const meta = getSelectedDocMeta();
  const record = getDocEditorRecord(meta);
  const dirty = state.dirty.has(files.docs);
  const categories = manifest.categories || [];
  return `<div class="workshop-pane-inner feature-desk">
    <div class="feature-action-bar workshop-action-bar">
      <div class="feature-action-buttons">
        <button type="button" class="btn" id="saveDocs">Save docs</button>
        <button type="button" class="btn ghost" id="newDoc">New article</button>
      </div>
      <span class="feature-save-hint${dirty ? ' is-dirty' : ''}">${dirty ? 'Unsaved' : 'Saved'}</span>
    </div>
    <p class="hint workshop-section-intro">Technical &amp; design articles for <strong>#/docs</strong>. Index in <code>docs.json</code>; bodies in <code>public/docs/articles/{category}/</code>.</p>
    <div class="feature-layout workshop-layout">
      <aside class="panel feature-sidebar workshop-sidebar"><div id="docListHost">${docListHtml(articles, meta?.slug)}</div></aside>
      <article class="panel feature-main workshop-main" id="docDetailHost">${record ? docDetailHtml(record, categories) : '<p class="hint">Select or create an article.</p>'}</article>
    </div>
  </div>`;
}
function docDetailHtml(record, categories) {
  const hasDossier = featureHasDossierContent(record, normalizeFeatureDossierRaw);
  const hero = record.heroImage || {};
  return `<div class="feature-detail">
    <div class="feature-detail-badges">
      <span class="badge">${esc(record.slug)}</span>
      <span class="badge">${esc(record.category)}</span>
      ${record.featured ? '<span class="badge">Featured</span>' : ''}
      ${hasDossier ? '<span class="badge record-detail-dossier">Body</span>' : ''}
    </div>
    <div class="form" data-form="doc">
      <label class="feature-title-field">Title<input name="title" value="${esc(record.title)}"></label>
      <div class="row"><label>ID<input name="id" value="${esc(record.id)}"></label><label>Slug<input name="slug" value="${esc(record.slug)}"></label></div>
      <div class="row"><label>Category<select name="category">${categories.map((c) => `<option value="${esc(c.id)}" ${record.category === c.id ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}</select></label><label>Featured<select name="featured"><option value="no" ${record.featured ? '' : 'selected'}>No</option><option value="yes" ${record.featured ? 'selected' : ''}>Yes</option></select></label></div>
      <label>Tags<input name="tags" value="${esc((record.tags || []).join(', '))}"></label>
      <label>Card summary<textarea name="summary" rows="3">${esc(record.summary)}</textarea></label>
      <div class="row"><label>Author<input name="author" value="${esc(record.author || '')}"></label><label>Published<input name="publishedAt" value="${esc(record.publishedAt || '')}" placeholder="2026-05-27"></label><label>Updated<input name="updatedAt" value="${esc(record.updatedAt || '')}"></label></div>
      <div class="row">${pathInputWithUploadHtml({ label: 'Hero image path', inputHtml: `<input name="heroPath" value="${esc(hero.path || '')}">`, uploadFolder: 'media/docs', uploadSubdir: record.slug || '' })}<label>Hero caption<input name="heroCaption" value="${esc(hero.caption || '')}"></label></div>
      <p class="hint">Public URL: <code>#/docs?article=${esc(record.slug)}</code></p>
      <div id="docDossierMount">${dossierEditorHtml(record, featureDossierDeps(), docDossierConfig())}</div>
    </div>
  </div>`;
}
function publish() {
  return `<section class="panel"><h2>Preview and publish</h2><p>Validate data, review Git status, then commit and push through your local Git credentials. No tokens are stored in the public repo.</p><div class="actions"><button class="btn ghost" id="gitStatus">Refresh Git status</button><button class="btn ghost" id="validateOnly">Validate data</button><button class="btn" id="publishNow">Commit & push</button></div><label style="margin-top:16px">Commit message<input id="commitMessage" value="Resort update: data and tracker changes"></label></section><pre id="output" class="output" style="margin-top:16px">Dirty files in this session: ${[...state.dirty].join(', ') || 'none'}</pre>`;
}
async function render() {
  const app = $('#app');
  const workbenchPanel = $('#workbenchPanel');
  const workbenchOpen = isGameEngineWorkbenchOpen();
  if (state.tab === 'Box Art') state.tab = 'Library';
  if (['Milestones', 'Docs', 'Features', 'Bugs', 'Community Issues', 'Ideas'].includes(state.tab)) {
    state.workshopTab = {
      Milestones: 'milestones',
      Docs: 'docs',
      Features: 'features',
      Bugs: 'bugs',
      'Community Issues': 'bugs',
      Ideas: 'ideas',
    }[state.tab] || state.workshopTab;
    state.tab = 'Workshop';
  }
  if (['Game Library', 'Media Library', 'Models', 'Characters'].includes(state.tab)) {
    state.libraryTab = {
      'Game Library': 'games',
      'Media Library': 'media',
      Models: 'models',
      Characters: 'characters',
    }[state.tab] || state.libraryTab;
    state.tab = 'Library';
  }
  if (state.tab === 'Design Lab') state.tab = 'Dashboard';
  const contentTab = deskContentTab();
  syncUrlToTab(state.tab, { replace: true, workshopTab: state.workshopTab, libraryTab: state.libraryTab });
  if (contentTab === 'Library' && state.libraryTab === 'games' && !state.boxart) {
    try { await refreshBoxartStatus(); } catch (e) {
      state.boxart = { configured: false, missingCount: 0, missing: [], error: e.message };
      log(`Box art status failed: ${e.message}`, 'error');
    }
  }
  if (workbenchOpen) {
    document.body.classList.remove('atlas-map-active');
  } else if (contentTab === 'Island Atlas') {
    document.body.classList.add('atlas-map-active');
    document.body.classList.remove('workbench-open');
  } else {
    document.body.classList.remove('map-editor-active');
    document.body.classList.remove('atlas-map-active');
    document.body.classList.remove('workbench-open');
  }
  const deskKey = deskRenderKey(contentTab);
  const deskRenderers = {
    Dashboard: dashboard,
    Compatibility: compatibility,
    Workshop: workshop,
    Library: library,
    'Island Atlas': () => atlasMapEditorHtml(state, esc, featureDossierDeps()),
    'Game Engine': gameEngine,
    Publish: publish,
  };
  if (state.lastDeskKey !== deskKey) {
    if (contentTab === 'Island Atlas') {
      document.body.classList.add('atlas-map-active');
      document.body.classList.remove('map-editor-active');
    } else if (!workbenchOpen) {
      document.body.classList.remove('map-editor-active');
      document.body.classList.remove('atlas-map-active');
    }
    app.innerHTML = (deskRenderers[contentTab] || dashboard)();
    state.lastDeskKey = deskKey;
    state.atlasEditorToolbarBound = false;
  }
  if (workbenchOpen) {
    document.body.classList.remove('workbench-open');
    workbenchPanel.setAttribute('aria-hidden', 'false');
    const activeTool = gameEngineToolById(state.gameEngineTools, state.gameEngineTool);
    const title = workbenchTitleForTool(state.gameEngineTools, state.gameEngineTool);
    workbenchPanel.innerHTML = workbenchLoadingShell(title);
    bindWorkbenchEscape();
    applyEditorBodyClasses(state.gameEngineTools, activeTool);
    if (activeTool) {
      try {
        await initEditorWorkbench(state, api, activeTool);
        workbenchPanel.innerHTML = await editorWorkbenchHtml(state, esc, activeTool);
      } catch (e) {
        log(`Editor init failed: ${e.message}`, 'error');
      }
    }
    bindWorkbenchEscape();
    requestAnimationFrame(() => {
      document.body.classList.add('workbench-open');
      bindWorkbenchEscape();
    });
  } else {
    applyEditorBodyClasses(state.gameEngineTools, null);
    workbenchPanel.innerHTML = '';
    workbenchPanel.setAttribute('aria-hidden', 'true');
  }
  bind();
  bindWorkbenchEscape();
}
async function runBatchBoxartFetch({ force = false, label = 'Batch fetch' } = {}) {
  const buttons = ['#fetchAllRecommended', '#refetchAllBoxart', '#searchBoxart', '#autoPickBoxart'];
  buttons.forEach((sel) => { const el = $(sel); if (el) el.disabled = true; });
  setLogStatus('Batch box art…', 'busy');
  log(`${label}… (uses top recommended cover per game)`);
  try {
    const summary = await api('/api/boxart/fetch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force }),
    });
    if (summary.assets) state.assets = summary.assets;
    await refreshBoxartStatus();
    for (const item of summary.results || []) {
      if (item.ok) log(`✓ ${item.title} → ${item.path} (${item.region || 'recommended'})`, 'ok');
      else log(`✗ ${item.title}: ${item.error}`, 'error');
    }
    log(`${label} done: ${summary.fetched} saved, ${summary.failed} failed, ${summary.skipped} skipped.`, summary.failed ? 'warn' : 'ok');
    render();
  } catch (e) {
    log(e.message, 'error');
  } finally {
    buttons.forEach((sel) => { const el = $(sel); if (el) el.disabled = false; });
  }
}
async function applyCoverByUrl(imageUrl, label = '') {
  const gameId = state.selected.game;
  log(`Saving ${label || 'cover'} → disk…`);
  const result = await api('/api/boxart/apply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId, imageUrl }),
  });
  if (result.assets) state.assets = result.assets;
  await refreshBoxartStatus();
  log(`Saved ${result.path} (${result.bytes} bytes)`, 'ok');
  render();
}
function bind() {
  document.querySelectorAll('[data-go]').forEach(btn => btn.onclick = () => navigateToTab(btn.dataset.go));
  document.querySelectorAll('[data-game-engine-launch]').forEach((btn) => {
    btn.onclick = () => openGameEngineTool(btn.dataset.gameEngineLaunch);
  });
  document.querySelectorAll('.list button[data-id]:not([data-workshop-kind]):not([data-milestone-id])').forEach(btn => btn.onclick = () => {
    const deskTab = deskContentTab();
    const keyMap = { Compatibility:'route' };
    const key = keyMap[deskTab] || (deskTab === 'Library' && state.libraryTab === 'games' ? 'game' : null);
    if (!key) return;
    state.selected[key] = btn.dataset.id;
    if (deskTab === 'Compatibility') {
      const route = state.data['compatibility.json'].routes.find((r) => r.id === btn.dataset.id);
      if (route) {
        state.selected.compatFromGen = route.from;
        state.selected.compatToGen = route.to;
        state.selected.route = route.id;
        syncCompatUIFromState();
        return;
      }
    }
    if (state.tab === 'Workshop' && state.workshopTab === 'bugs' && btn.dataset.id) {
      applyBugFromForm();
      state.selected.bug = btn.dataset.id;
      syncBugUIFromState();
      return;
    }
    if (deskTab === 'Library' && state.libraryTab === 'games') resetBoxartPicker();
    render();
  });
  bindSaveCompatibilityButtons();
  const compatFromGen = $('#compatFromGen');
  const compatToGen = $('#compatToGen');
  const compatStatus = $('#compatStatus');
  const onCompatGenChange = () => {
    if (compatFromGen) state.selected.compatFromGen = compatFromGen.value;
    if (compatToGen) state.selected.compatToGen = compatToGen.value;
    syncCompatUIFromState();
  };
  if (compatFromGen) compatFromGen.onchange = onCompatGenChange;
  if (compatToGen) compatToGen.onchange = onCompatGenChange;
  if (compatStatus) compatStatus.onchange = () => {
    try {
      const route = applyCompatStatusFromPicker();
      const label = state.data['compatibility.json'].statuses[route.status]?.label || route.status;
      log(`Draft: ${route.id} → ${label}. Save compatibility when ready.`, 'ok');
    } catch (e) { log(e.message, 'error'); }
  };
  const compatSwap = $('#compatSwapGens');
  if (compatSwap) compatSwap.onclick = () => {
    const from = state.selected.compatFromGen;
    state.selected.compatFromGen = state.selected.compatToGen;
    state.selected.compatToGen = from;
    syncCompatUIFromState();
  };
  const compatApplyManual = $('#compatApplyManual');
  if (compatApplyManual) compatApplyManual.onclick = () => {
    try { updateRouteFromForm(); log('Manual route edits applied in memory.', 'ok'); syncCompatUIFromState(); }
    catch (e) { log(e.message, 'error'); }
  };
  bindStandaloneAssetButtons($('#app'));
  if (state.tab === 'Compatibility') syncCompatUIFromState();
  if (state.tab === 'Workshop') bindWorkshopDesk();
  if (state.tab === 'Library') bindLibraryDesk();
  if (state.tab === 'Island Atlas') {
    initAtlasMapEditorTab(state, {
      ...featureDossierDeps(),
      markDirty,
      saveFile,
      log,
    });
  }
  if (state.tab === 'Game Engine') {
    bindGameEngineHub(state, { openGameEngineTool });
  }
  const activeWorkbench = gameEngineToolById(state.gameEngineTools, state.gameEngineTool);
  if (isGameEngineWorkbenchOpen() && activeWorkbench) {
    bindEditorWorkbench(state, { api, log, esc, render, navigateToTab }, activeWorkbench);
  }
  const saveGames = $('#saveGames'); if (saveGames) saveGames.onclick = () => { persistGameFromForm(); saveFile(files.compatibility, state.data['compatibility.json']).then(() => updateLibrarySaveHints()); };
  const saveJsonEditor = $('#saveJsonEditor');
  if (saveJsonEditor) {
    saveJsonEditor.onclick = () => {
      const fileMap = { media: files.gallery, models: files.models, characters: files.characters };
      const file = state.tab === 'Library' ? fileMap[state.libraryTab] : null;
      if (!file) return;
      try {
        state.data[file] = JSON.parse($('#jsonEditor').value);
        if (state.tab === 'Library' && state.libraryTab === 'models') persistModelsFromForm();
        markDirty(file);
        saveFile(file, state.data[file]).then(() => updateLibrarySaveHints());
      } catch (e) { toast('Invalid JSON: ' + e.message); }
    };
  }
  const saveModels = $('#saveModels'); if (saveModels) saveModels.onclick = () => { persistModelsFromForm(); saveFile(files.models, state.data['models.json']).then(() => updateLibrarySaveHints()); };
  ['RouteTest','BugCheck','FeatureTask'].forEach(kind => { const btn = $(`#add${kind}`); if (btn) btn.onclick = () => addCheck(kind); });
  document.querySelectorAll('[data-remove]').forEach(btn => btn.onclick = () => btn.closest('.check-row')?.remove());
  const gitStatus = $('#gitStatus'); if (gitStatus) gitStatus.onclick = async () => { const res = await api('/api/status'); toast(res.output || 'Clean working tree'); };
  const validateOnly = $('#validateOnly'); if (validateOnly) validateOnly.onclick = async () => { try { await saveAllDirty(); toast('Validation passed.'); } catch(e) { toast(e.message); } };
  const publishNow = $('#publishNow'); if (publishNow) publishNow.onclick = async () => { try { await saveAllDirty(); const res = await api('/api/publish', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ message: $('#commitMessage').value }) }); toast(JSON.stringify(res, null, 2)); } catch(e) { toast(e.message); } };
  const clearLog = $('#clearLog'); if (clearLog) clearLog.onclick = () => { $('#deskLog').textContent = ''; setLogStatus('Ready'); };
  const refreshBoxart = $('#refreshBoxartStatus'); if (refreshBoxart) refreshBoxart.onclick = async () => { try { await refreshBoxartStatus(); log(`Missing on disk: ${state.boxart.missingCount}`, 'ok'); render(); } catch (e) { log(e.message, 'error'); } };
  const fetchAllRecommended = $('#fetchAllRecommended'); if (fetchAllRecommended) fetchAllRecommended.onclick = () => runBatchBoxartFetch({ force: false, label: 'Accept all recommended' });
  const refetchAllBoxart = $('#refetchAllBoxart'); if (refetchAllBoxart) refetchAllBoxart.onclick = async () => {
    if (!confirm('Re-download box art for every Libretro-supported game? Existing files will be overwritten.')) return;
    runBatchBoxartFetch({ force: true, label: 'Refetch all' });
  };
  const searchBoxart = $('#searchBoxart'); if (searchBoxart) searchBoxart.onclick = async () => {
    const gameId = state.selected.game;
    state.boxartPicker.loading = true;
    render();
    try {
      const result = await api(`/api/boxart/search?gameId=${encodeURIComponent(gameId)}`);
      state.boxartPicker.candidates = result.candidates || [];
      log(result.hint || `Found ${state.boxartPicker.candidates.length} option(s).`, state.boxartPicker.candidates.length ? 'ok' : 'warn');
    } catch (e) { log(e.message, 'error'); }
    finally { state.boxartPicker.loading = false; render(); }
  };
  document.querySelectorAll('[data-apply-cover]').forEach((btn) => {
    btn.onclick = async () => {
      try { await applyCoverByUrl(btn.dataset.imageUrl, btn.closest('.cover-card')?.querySelector('strong')?.textContent); }
      catch (e) { log(e.message, 'error'); }
    };
  });
  const autoPick = $('#autoPickBoxart'); if (autoPick) autoPick.onclick = async () => {
    const gameId = state.selected.game;
    try {
      const search = await api(`/api/boxart/search?gameId=${encodeURIComponent(gameId)}`);
      const top = search.candidates?.find((c) => c.recommended) || search.candidates?.[0];
      if (!top) { log(search.hint || 'No Libretro match for auto-pick.', 'warn'); return; }
      log(`Auto-pick: ${top.name}${top.recommended ? ' (recommended)' : ''}`);
      await applyCoverByUrl(top.url, top.regionLabel);
    } catch (e) { log(e.message, 'error'); }
  };
}
function csv(value) { return String(value || '').split(',').map(x => x.trim()).filter(Boolean); }
function readChecks(containerId) { return [...document.querySelectorAll(`#${containerId} .check-row`)].map(row => ({ done: row.querySelector('input[type="checkbox"]').checked, label: row.querySelector('input:not([type="checkbox"])').value.trim() })).filter(item => item.label); }
function addCheck(kind) {
  const map = { RouteTest:['routeTests','route','tests'], BugCheck:['bugChecks','bug','checklist'], FeatureTask:['featureTasks','feature','tasks'] };
  const [id, type, field] = map[kind];
  const div = document.createElement('div'); div.className='check-row'; div.innerHTML='<input type="checkbox"><input value="New checklist item"><button class="btn ghost small" type="button">Remove</button>'; div.querySelector('button').onclick=()=>div.remove(); document.getElementById(id).append(div);
}
function updateRouteFromForm() {
  const d = formData('[data-form="route"]');
  const data = state.data['compatibility.json'];
  const route = data.routes.find((r) => r.id === state.selected.route);
  if (!route) throw new Error('No route selected for manual edit.');
  Object.assign(route, {
    from: d.from,
    to: d.to,
    status: d.status,
    title: d.title || buildRouteTitle(data, d.from, d.to),
    summary: d.summary,
    coverage: d.coverage,
    lastUpdated: d.lastUpdated,
    relatedBugs: csv(d.relatedBugs),
    tests: readChecks('routeTests'),
  });
  markDirty(files.compatibility);
}
function updatePoi() { applyPoiFromForm(); }
function updateGame() { persistGameFromForm(); }

function updateModels() { persistModelsFromForm(); }
function updateMilestone() { applyMilestoneFromForm(); }
function updateIdea() { applyIdeaFromForm(); }
async function saveAllDirty() {
  const jobs = [...state.dirty].map(file => saveFile(file, state.data[file]));
  await Promise.all(jobs);
}
boot().catch((err) => {
  log(`Boot failed: ${err.message}`, 'error');
  $('#app').innerHTML = `<section class="panel"><h2>Could not start</h2><p>${esc(err.message)}</p></section>`;
});
