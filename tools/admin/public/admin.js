import { renderCompatGraphHtml, bindCompatGraph } from './ontology-picker.js';
import { featureHasDossierContent } from './dossier-shared.js';
import { mapEditorHtml, bindMapEditor, initMapEditorTab } from './map-editor.js';
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
  workshopPanes: { features: true, research: false, ideas: false },
  docArticles: {},
};
const files = { compatibility:'compatibility.json', bugs:'bugs.json', features:'features.json', research:'research.json', atlasPins:'atlas-pins.json', theme:'theme.json', homepage:'homepage.json', gallery:'gallery.json', models:'models.json', characters:'characters.json', roadmap:'roadmap.json', ideas:'ideas.json', docs:'docs.json' };
const tabs = ['Dashboard','Compatibility','Bugs','Workshop','Island Atlas','Map Editor','Milestones','Docs','Game Library','Media Library','Models','Characters','Design Lab','Publish'];
const RESEARCH_CATEGORIES = ['Location', 'Character', 'Pokémon', 'Species', 'Mechanic', 'Region', 'Timeline', 'Asset', 'Other'];
const $ = (sel) => document.querySelector(sel);
const esc = (value='') => String(value).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const clone = (x) => JSON.parse(JSON.stringify(x));

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
  initLogDockToggle();
  const payload = await api('/api/data');
  state.data = payload.files || payload;
  state.docArticles = payload.docArticles || {};
  state.assets = (await api('/api/assets')).assets;
  renderTabs();
  render();
}
function renderTabs() {
  $('#tabs').innerHTML = tabs.map(tab => `<button class="${state.tab===tab?'active':''}" data-tab="${tab}">${tab}</button>`).join('');
  $('#tabs').onclick = (event) => {
    const btn = event.target.closest('button[data-tab]');
    if (!btn) return;
    state.tab = btn.dataset.tab;
    renderTabs(); render();
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
async function saveFile(file, data) {
  const result = await api('/api/save', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ file, data }) });
  state.dirty.delete(file);
  toast(`Saved ${file} — ${(result.validation || 'validated').replace(/\n/g, ' ')}`);
}
function dashboard() {
  const routes = state.data['compatibility.json'].routes;
  const bugs = state.data['bugs.json'].bugs;
  const features = state.data['features.json'].features;
  const pins = state.data['atlas-pins.json']?.pins || [];
  const researchEntries = state.data['research.json'].entries || [];
  const cards = [
    ['Open/blocked bugs', bugs.filter(b => ['Open','Blocked'].includes(b.status)).length],
    ['Untested routes', routes.filter(r => r.status === 'gray').length],
    ['Known failing routes', routes.filter(r => r.status === 'red').length],
    ['On-flight features', features.filter(f => ['On-Flight','Testing'].includes(f.stage)).length],
    ['Research entries', researchEntries.length],
    ['Atlas cork pins', pins.length],
  ];
  return `<section class="grid dashboard">${cards.map(([label,val]) => `<article class="card"><span>${label}</span><strong>${val}</strong></article>`).join('')}</section>
  <section class="panel" style="margin-top:16px"><h2>Needs attention</h2><div class="grid">${attentionItems().map(item => `<p><span class="badge">${item.type}</span> ${item.text}</p>`).join('')}</div></section>
  <section class="panel" style="margin-top:16px"><h2>Quick actions</h2><div class="actions"><button class="btn" data-go="Compatibility">Update Compatibility</button><button class="btn" data-go="Bugs">Add Bug</button><button class="btn" data-go="Workshop">Open Workshop</button><button class="btn ghost" data-go="Map Editor">Map editor</button><button class="btn ghost" data-go="Game Library">Game library & box art</button><button class="btn ghost" data-go="Publish">Preview / Publish</button></div></section>`;
}
function attentionItems() {
  const data = state.data;
  const games = data['compatibility.json'].games;
  const routes = data['compatibility.json'].routes;
  const bugs = data['bugs.json'].bugs;
  const pins = data['atlas-pins.json']?.pins || [];
  const researchEntries = data['research.json'].entries || [];
  const items = [];
  games.filter(g => !g.boxArt || !state.assets.includes(g.boxArt)).slice(0,6).forEach(g => items.push({ type:'Game Library', text:`${g.title} needs local box art at ${g.boxArt}.` }));
  routes.filter(r => r.status === 'red' && !r.relatedBugs?.length).slice(0,4).forEach(r => items.push({ type:'Compatibility', text:`${r.title} is red but has no linked bug.` }));
  bugs.filter(b => b.status === 'Fixed' && b.linkedRoutes?.length).slice(0,3).forEach(b => items.push({ type:'Issue Desk', text:`${b.id} is fixed; verify linked routes are updated.` }));
  pins.filter(p => !p.summary?.trim()).slice(0,3).forEach(p => items.push({ type:'Island Atlas', text:`Cork pin ${p.name} has no hover summary yet.` }));
  researchEntries.filter((e) => !e.summary?.trim()).slice(0,3).forEach((e) => items.push({ type:'Research', text:`${e.title || e.id} needs a card summary.` }));
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
function captureWorkshopPaneState() {
  document.querySelectorAll('[data-workshop-pane]').forEach((el) => {
    const key = el.dataset.workshopPane;
    if (key && state.workshopPanes) state.workshopPanes[key] = el.open;
  });
}
function workshopPaneBodyHtml(paneKey) {
  if (paneKey === 'features') return workshopFeaturesPane();
  if (paneKey === 'research') return workshopResearchPane();
  if (paneKey === 'ideas') return workshopIdeasPane();
  return '';
}
function renderWorkshopPaneBody(paneKey) {
  const pane = document.querySelector(`[data-workshop-pane="${paneKey}"]`);
  if (!pane) return;
  let body = pane.querySelector('.workshop-pane-body');
  if (!body) {
    body = document.createElement('div');
    body.className = 'workshop-pane-body';
    pane.appendChild(body);
  }
  body.innerHTML = workshopPaneBodyHtml(paneKey);
  bindWorkshopPaneSection(paneKey);
}
function unmountWorkshopPaneBody(paneKey) {
  document.querySelector(`[data-workshop-pane="${paneKey}"]`)?.querySelector('.workshop-pane-body')?.remove();
}
function persistWorkshopPaneDraft(paneKey) {
  if (paneKey === 'features') applyFeatureFromForm();
  else if (paneKey === 'research') applyResearchFromForm();
  else if (paneKey === 'ideas') applyIdeaFromForm();
}
function workshopPane(title, hint, bodyHtml, paneKey) {
  const open = Boolean(state.workshopPanes?.[paneKey]);
  return `<details class="workshop-pane" data-workshop-pane="${paneKey}"${open ? ' open' : ''}>
    <summary class="workshop-pane-summary"><strong>${title}</strong>${hint ? `<span class="hint workshop-pane-hint">${hint}</span>` : ''}</summary>
    ${open ? `<div class="workshop-pane-body">${bodyHtml}</div>` : ''}
  </details>`;
}
function updateWorkshopSaveHints() {
  const map = [
    ['features', files.features, 'Save features'],
    ['research', files.research, 'Save research'],
    ['ideas', files.ideas, 'Save ideas'],
  ];
  map.forEach(([key, file, label]) => {
    const pane = document.querySelector(`[data-workshop-pane="${key}"]`);
    const hint = pane?.querySelector('.feature-save-hint');
    if (!hint) return;
    const dirty = state.dirty.has(file);
    hint.textContent = dirty ? 'Unsaved' : 'Saved';
    hint.classList.toggle('is-dirty', dirty);
  });
  const dirtyNote = [
    state.dirty.has(files.features) && 'features',
    state.dirty.has(files.research) && 'research',
    state.dirty.has(files.ideas) && 'ideas',
  ].filter(Boolean);
  const toolbarHint = document.querySelector('.workshop-toolbar .feature-unsaved, .workshop-toolbar .feature-disk-ok');
  if (toolbarHint) {
    toolbarHint.outerHTML = dirtyNote.length
      ? `<p class="hint feature-unsaved"><strong>Unsaved:</strong> ${dirtyNote.join(', ')}</p>`
      : '<p class="hint feature-disk-ok">All workshop files in sync with disk.</p>';
  }
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
    <div class="compat-preview-head"><span class="badge">${esc(route.id)}</span><span class="badge compat-status-${esc(route.status)}">${esc(data.statuses[route.status]?.label || route.status)}</span><span class="hint">Draft in memory — save when ready</span></div>
    <h3>${esc(route.title)}</h3>
    <p>${esc(route.summary)}</p>
    <p class="hint">Coverage: <strong>${esc(route.coverage)}</strong> · Last updated: <strong>${esc(route.lastUpdated)}</strong>${fromGames ? ` · ${esc(genLabel(data, fromGen))} games: ${esc(fromGames)}` : ''}${toGen !== fromGen && toGames ? ` · ${esc(genLabel(data, toGen))} games: ${esc(toGames)}` : ''}</p>
  </div>`;
}
function updateCompatDirtyHint() {
  const dirty = state.dirty.has(files.compatibility);
  document.querySelectorAll('.compat-save-hint').forEach((el) => {
    el.textContent = dirty ? 'Unsaved draft — click Save' : 'Saved to disk';
    el.classList.toggle('is-dirty', dirty);
  });
  const toolbar = document.querySelector('.compat-toolbar > div');
  if (!toolbar) return;
  const unsaved = toolbar.querySelector('.compat-unsaved');
  const ok = toolbar.querySelector('.compat-disk-ok');
  if (dirty) {
    ok?.remove();
    if (!unsaved) toolbar.insertAdjacentHTML('beforeend', '<p class="hint compat-unsaved"><strong>Not on disk yet</strong> — save, then refresh Ontology.</p>');
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
    <div><h2>Compatibility</h2><p>Pick a route on the graph or with the generation dropdowns. Changing <strong>status</strong> updates the draft immediately — click <strong>Save compatibility</strong> when you want it on disk.</p>${dirty ? '<p class="hint compat-unsaved"><strong>Not on disk yet</strong> — save, then refresh Ontology.</p>' : '<p class="hint compat-disk-ok">In sync with disk.</p>'}</div>
  </section>
  <section class="panel compat-quick">
    <div class="compat-action-bar">
      <div class="compat-action-buttons">
        <button type="button" class="btn js-save-compatibility">Save compatibility</button>
      </div>
      <span class="compat-save-hint${dirty ? ' is-dirty' : ''}">${dirty ? 'Unsaved draft — click Save' : 'Saved to disk'}</span>
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
function featureDossierDeps() {
  return {
    esc,
    $,
    adminAssetUrl,
    imageAssetOptions,
    filterImageAssets,
    getPins: () => (state.data['atlas-pins.json']?.pins || []).map((pin) => ({ id: pin.id, name: pin.name })),
    getMilestones: () => (state.data['roadmap.json']?.milestones || []),
  };
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
    hint: 'Rich sections for Concierge Research — characters, Pokémon, locations, mechanics, and more.',
    showMap: false,
    showResearchMilestones: false,
    open: true,
  };
}
function getSelectedIdea() {
  const items = state.data['ideas.json']?.items || [];
  return items.find((i) => i.id === state.selected.idea) || null;
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
    open: true,
  };
}
function ideaDossierConfig() {
  return {
    title: 'Idea brief',
    hint: 'Extended write-up for the public Ideas section (Ideas & Milestones tab).',
    showMap: false,
    showResearchMilestones: false,
    open: true,
  };
}
function milestoneDossierConfig() {
  return {
    title: 'Milestone brief',
    hint: 'Extra context visitors see when opening a milestone on the public plan page.',
    showMap: false,
    showResearchMilestones: false,
    open: true,
  };
}
function docDossierConfig() {
  return {
    title: 'Article body',
    hint: 'Rich blocks for the public Docs article. Saved to public/docs/articles/{category}/{slug}.json.',
    showMap: false,
    showResearchMilestones: false,
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
function applyDocFromForm() {
  const meta = getSelectedDocMeta();
  if (!meta) return null;
  const d = formData('[data-form="doc"]');
  const categories = state.data['docs.json'].categories || [];
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
  const dossier = readDossierFromDom($, { mountSelector: '#docDossierMount' });
  state.docArticles[meta.slug] = { dossier: dossier || { overview: '', sections: [] } };
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
function recordImagesSectionHtml(images, idPrefix) {
  const normalized = normalizeRecordImages(images);
  const assets = imageAssetOptions();
  return `<section class="record-images-section">
    <h3>Evidence images <span class="hint">${normalized.length}</span></h3>
    <p class="hint">Paths under <code>public/</code> (e.g. <code>media/bugs/screenshot.webp</code>). Shown on the Operations page with a gallery modal.</p>
    <div class="record-images-grid" id="${idPrefix}ImagesGrid">${normalized.length ? normalized.map((img, idx) => `<figure class="record-image-thumb" data-image-path="${esc(img.path)}">
        <img src="${adminAssetUrl(img.path)}" alt="" loading="lazy" />
        <label>Caption<input data-image-caption value="${esc(img.caption)}" placeholder="What does this show?" /></label>
        <button type="button" class="btn ghost small" data-remove-image="${idx}">Remove</button>
      </figure>`).join('') : '<p class="hint record-images-empty">No images yet — add a path or pick from assets below.</p>'}</div>
    <div class="record-images-add row">
      <label>Image path<input id="${idPrefix}ImagePath" list="${idPrefix}AssetList" placeholder="media/…" /></label>
      <label>Caption<input id="${idPrefix}ImageCaption" placeholder="Optional" /></label>
      <button type="button" class="btn ghost small" id="${idPrefix}AddImagePath">Add image</button>
    </div>
    <datalist id="${idPrefix}AssetList">${assets.map((p) => `<option value="${esc(p)}">`).join('')}</datalist>
    <details class="record-images-pick"><summary>Pick from project assets (${assets.length})</summary>
      <div class="record-images-asset-grid">${assets.length ? assets.map((p) => `<button type="button" class="record-asset-pick" data-pick-path="${esc(p)}" title="${esc(p)}"><img src="${adminAssetUrl(p)}" alt="" loading="lazy" /></button>`).join('') : '<p class="hint">No images found under public/. Add files to public/media first.</p>'}
      </div>
    </details>
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
  if (!confirm(`Delete ${bug.id} — “${bug.title}”?\n\nRemoved from the draft immediately. Click Save bugs to update bugs.json on disk.`)) return;
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
function applyBugFromForm() {
  const form = document.querySelector('[data-form="bug"]');
  if (!form) return getSelectedBug();
  const d = readFormFields(form);
  const bug = getSelectedBug();
  if (!bug) return null;
  const statusChanged = d.status && d.status !== bug.status;
  const nextId = (d.id || bug.id).trim();
  const images = readRecordImagesFromDom('bug');
  Object.assign(bug, {
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
    ...(images !== null ? { images } : {}),
  });
  state.selected.bug = nextId;
  markDirty(files.bugs);
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
        <span class="hint">Draft in memory — save when ready</span>
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
    el.textContent = dirty ? 'Unsaved draft — click Save' : 'Saved to disk';
    el.classList.toggle('is-dirty', dirty);
  });
  const toolbar = document.querySelector('.bug-toolbar > div');
  if (!toolbar) return;
  const unsaved = toolbar.querySelector('.bug-unsaved');
  const ok = toolbar.querySelector('.bug-disk-ok');
  if (dirty) {
    ok?.remove();
    if (!unsaved) toolbar.insertAdjacentHTML('beforeend', '<p class="hint bug-unsaved"><strong>Not on disk yet</strong> — save when you are done editing.</p>');
  } else {
    unsaved?.remove();
    if (!ok) toolbar.insertAdjacentHTML('beforeend', '<p class="hint bug-disk-ok">In sync with disk.</p>');
  }
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
function bugsEditor() {
  const data = state.data['bugs.json'];
  const bugs = data.bugs;
  if (!state.selected.bug) state.selected.bug = filteredBugs(bugs, { filter: state.bugFilter })[0]?.id || bugs[0]?.id;
  const dirty = state.dirty.has(files.bugs);
  return `<section class="toolbar bug-toolbar">
    <div><h2>Bugs &amp; community issues</h2><p>Track internal bugs above. With <code>GITHUB_TOKEN</code> in <code>.env.local</code>, pull GitHub issues and add them to the Operations page in one click — then <strong>Save bugs</strong>.</p>${dirty ? '<p class="hint bug-unsaved"><strong>Not on disk yet</strong> — save when you are done editing.</p>' : '<p class="hint bug-disk-ok">In sync with disk.</p>'}</div>
  </section>
  <section class="panel bug-desk">
    <div class="bug-action-bar">
      <div class="bug-action-buttons">
        <button type="button" class="btn js-save-bugs">Save bugs</button>
        <button type="button" class="btn ghost" id="newBug">New bug</button>
      </div>
      <span class="bug-save-hint${dirty ? ' is-dirty' : ''}">${dirty ? 'Unsaved draft — click Save' : 'Saved to disk'}</span>
    </div>
    <div class="bug-layout">
      <aside class="panel bug-sidebar">
        <div id="bugFiltersHost">${bugFiltersHtml(bugs)}</div>
        <div id="bugListHost">${bugListItemsHtml(bugs)}</div>
      </aside>
      <article class="panel bug-main" id="bugDetailHost">${bugDetailHtml(getSelectedBug(), data)}</article>
    </div>
    <section class="panel bug-community-panel" id="communityPanelHost">${communityIssuesPanelHtml()}</section>
  </section>`;
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
function applyFeatureFromForm() {
  const form = document.querySelector('[data-form="feature"]');
  if (!form) return getSelectedFeature();
  const d = readFormFields(form);
  const feature = getSelectedFeature();
  if (!feature) return null;
  const nextId = (d.id || feature.id).trim();
  const images = readRecordImagesFromDom('feature');
  const dossier = readFeatureDossierFromDom($);
  Object.assign(feature, {
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
    ...(images !== null ? { images } : {}),
    ...(dossier !== null ? { dossier } : {}),
  });
  state.selected.feature = nextId;
  touchFeatureDraft();
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
  if (!confirm(`Delete ${feature.id} — “${feature.title}”?\n\nRemoved from the draft immediately. Click Save features to update features.json on disk.`)) return;
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
        <span class="hint">Draft in memory — save when ready</span>
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
    el.textContent = dirty ? 'Unsaved draft — click Save' : 'Saved to disk';
    el.classList.toggle('is-dirty', dirty);
  });
  const toolbar = document.querySelector('.feature-toolbar > div');
  if (!toolbar) return;
  const unsaved = toolbar.querySelector('.feature-unsaved');
  const ok = toolbar.querySelector('.feature-disk-ok');
  if (dirty) {
    ok?.remove();
    if (!unsaved) toolbar.insertAdjacentHTML('beforeend', '<p class="hint feature-unsaved"><strong>Not on disk yet</strong> — save when you are done editing.</p>');
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
  const root = document.querySelector('[data-workshop-pane="features"]');
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
function applyResearchFromForm() {
  const entry = getSelectedResearch();
  if (!entry) return null;
  const d = formData('[data-form="research"]');
  const dossier = readDossierFromDom($, { mountSelector: '#researchDossierMount' });
  const categories = state.data['research.json'].categories || RESEARCH_CATEGORIES;
  Object.assign(entry, {
    id: (d.id || entry.id).trim(),
    title: d.title ?? entry.title,
    category: categories.includes(d.category) ? d.category : (entry.category || 'Other'),
    subject: d.subject ?? entry.subject ?? '',
    confidence: d.confidence ?? entry.confidence,
    devStatus: d.devStatus ?? entry.devStatus,
    canonStatus: d.canonStatus ?? entry.canonStatus,
    summary: d.summary ?? entry.summary,
    tags: csv(d.tags),
    linkedPins: csv(d.linkedPins || d.linkedPois),
    linkedPois: undefined,
    linkedFeatures: csv(d.linkedFeatures),
    relatedBugs: csv(d.relatedBugs),
    evidence: d.evidenceImage ? [{ label: 'Curated evidence', image: d.evidenceImage, note: d.evidenceNote || '' }] : [],
    ...(dossier !== null ? { dossier } : {}),
  });
  state.selected.research = entry.id;
  markDirty(files.research);
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
    state.workshopPanes.research = true;
    markDirty(files.research);
    openWorkshopPane('research');
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
function applyIdeaFromForm() {
  const idea = getSelectedIdea();
  if (!idea) return null;
  const d = formData('[data-form="idea"]');
  const dossier = readDossierFromDom($, { mountSelector: '#ideaDossierMount' });
  Object.assign(idea, {
    id: (d.id || idea.id).trim(),
    title: d.title ?? idea.title,
    status: d.status ?? idea.status,
    summary: d.summary ?? idea.summary,
    tags: csv(d.tags),
    ...(dossier !== null ? { dossier } : {}),
  });
  state.selected.idea = idea.id;
  markDirty(files.ideas);
  return idea;
}
function bindIdeaDetail() {
  const form = document.querySelector('[data-form="idea"]');
  if (!form) return;
  const onFieldChange = () => {
    applyIdeaFromForm();
    updateWorkshopSaveHints();
  };
  form.querySelectorAll('input, select, textarea').forEach((field) => {
    field.onchange = onFieldChange;
  });
  const mount = document.querySelector('#ideaDossierMount');
  if (mount) {
    delete mount.dataset.dossierBound;
    bindDossierEditor({
      ...featureDossierDeps(),
      mountSelector: '#ideaDossierMount',
      renderEditorHtml: (record, deps) => dossierEditorHtml(record, deps, ideaDossierConfig()),
      getRecord: getSelectedIdea,
      onDirty: () => {
        markDirty(files.ideas);
        updateWorkshopSaveHints();
      },
    });
  }
}
function syncWorkshopIdeasUI({ detailOnly = false } = {}) {
  const items = state.data['ideas.json'].items || [];
  if (!state.selected.idea || !items.find((i) => i.id === state.selected.idea)) {
    state.selected.idea = items[0]?.id || null;
  }
  const idea = getSelectedIdea();
  const listHost = $('#ideaListHost');
  if (listHost) {
    listHost.innerHTML = workshopPickerList('idea', items, state.selected.idea, (i) => i.title, (i) => `${i.status} · ${i.id}`);
    bindWorkshopIdeaList();
  }
  const detailHost = $('#ideaDetailHost');
  if (detailHost && !detailOnly) {
    detailHost.innerHTML = idea ? ideaDetailHtml(idea) : '<p class="hint">Select an idea.</p>';
    bindIdeaDetail();
  }
  updateWorkshopSaveHints();
}
function bindIdeasDesk() {
  const saveBtn = $('#saveIdeas');
  if (saveBtn) saveBtn.onclick = async () => {
    applyIdeaFromForm();
    (state.data['ideas.json'].items || []).forEach(pruneRecordDossier);
    await saveFile(files.ideas, state.data['ideas.json']);
    log('Written to public/data/ideas.json.', 'ok');
    updateWorkshopSaveHints();
  };
  const newBtn = $('#newIdea');
  if (newBtn) newBtn.onclick = () => {
    applyIdeaFromForm();
    const ideas = state.data['ideas.json'];
    if (!ideas.items) ideas.items = [];
    const item = {
      id: `idea-${Date.now().toString().slice(-5)}`,
      title: 'New idea',
      status: 'spark',
      summary: 'Describe the idea.',
      tags: [],
    };
    ideas.items.unshift(item);
    state.selected.idea = item.id;
    state.workshopPanes.ideas = true;
    markDirty(files.ideas);
    openWorkshopPane('ideas');
    syncWorkshopIdeasUI();
    log(`Created ${item.id}. Save ideas when ready.`, 'ok');
  };
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
function applyMilestoneFromForm() {
  const item = getSelectedMilestone();
  if (!item) return null;
  const d = formData('[data-form="milestone"]');
  const dossier = readDossierFromDom($, { mountSelector: '#milestoneDossierMount' });
  const roadmap = state.data['roadmap.json'];
  const nextId = (d.id || item.id).trim();
  Object.assign(item, {
    id: nextId,
    title: d.title ?? item.title,
    status: d.status ?? item.status,
    summary: d.summary ?? item.summary,
    image: d.image || '',
    ...(dossier !== null ? { dossier } : {}),
  });
  if (d.current === 'yes' || d.status === 'current') roadmap.currentMilestoneId = nextId;
  else if (roadmap.currentMilestoneId === item.id && d.current === 'no') roadmap.currentMilestoneId = null;
  state.selected.milestone = nextId;
  markDirty(files.roadmap);
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
  const dirty = state.dirty.has(files.roadmap);
  const hint = document.querySelector('.milestone-save-hint');
  if (hint) {
    hint.textContent = dirty ? 'Unsaved' : 'Saved';
    hint.classList.toggle('is-dirty', dirty);
  }
  const toolbarNote = document.querySelector('.milestone-toolbar .feature-unsaved, .milestone-toolbar .feature-disk-ok');
  if (toolbarNote) {
    toolbarNote.outerHTML = dirty
      ? '<p class="hint feature-unsaved"><strong>Not on disk yet</strong></p>'
      : '<p class="hint feature-disk-ok">In sync with disk.</p>';
  }
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
  const root = document.querySelector('.milestone-desk');
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
      onDirty: () => markDirty(files.docs),
    });
  }
}
async function saveDocsToDisk() {
  applyDocFromForm();
  const articles = state.data['docs.json']?.articles || [];
  for (const article of articles) {
    const body = state.docArticles[article.slug];
    if (!body) continue;
    await api('/api/docs/save-article', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: article.slug, data: body }),
    });
  }
  await saveFile(files.docs, state.data['docs.json']);
  log('Written docs.json and article files.', 'ok');
  syncDocsUI({ detailOnly: true });
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
  state.workshopPanes[paneKey] = true;
  const pane = document.querySelector(`[data-workshop-pane="${paneKey}"]`);
  if (!pane) return;
  pane.open = true;
  if (!pane.querySelector('.workshop-pane-body')) renderWorkshopPaneBody(paneKey);
}
function bindWorkshopResearchList() {
  const root = document.querySelector('[data-workshop-pane="research"]');
  if (!root) return;
  root.querySelectorAll('[data-workshop-kind="research"]').forEach((btn) => {
    btn.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      applyResearchFromForm();
      state.selected.research = btn.dataset.id;
      openWorkshopPane('research');
      syncWorkshopResearchUI();
      document.querySelector('[data-workshop-pane="research"]')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    };
  });
}
function bindWorkshopIdeaList() {
  const root = document.querySelector('[data-workshop-pane="ideas"]');
  if (!root) return;
  root.querySelectorAll('[data-workshop-kind="idea"]').forEach((btn) => {
    btn.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      applyIdeaFromForm();
      state.selected.idea = btn.dataset.id;
      openWorkshopPane('ideas');
      syncWorkshopIdeasUI();
      document.querySelector('[data-workshop-pane="ideas"]')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    };
  });
}
function bindWorkshopPaneToggles() {
  document.querySelectorAll('[data-workshop-pane]').forEach((el) => {
    if (el.dataset.workshopPaneBound === '1') return;
    el.dataset.workshopPaneBound = '1';
    el.addEventListener('toggle', () => {
      const key = el.dataset.workshopPane;
      if (!key) return;
      if (!el.open) {
        persistWorkshopPaneDraft(key);
        state.workshopPanes[key] = false;
        unmountWorkshopPaneBody(key);
        return;
      }
      state.workshopPanes[key] = true;
      if (!el.querySelector('.workshop-pane-body')) renderWorkshopPaneBody(key);
    });
  });
}
function bindWorkshopPaneSection(paneKey) {
  if (paneKey === 'features') bindFeatureDesk();
  else if (paneKey === 'research') {
    bindResearchDesk();
    bindResearchDetail();
    bindWorkshopResearchList();
  } else if (paneKey === 'ideas') {
    bindIdeasDesk();
    bindIdeaDetail();
    bindWorkshopIdeaList();
  }
}
function bindWorkshopDesk() {
  bindWorkshopPaneToggles();
  ['features', 'research', 'ideas'].forEach((paneKey) => {
    const pane = document.querySelector(`[data-workshop-pane="${paneKey}"]`);
    if (pane?.open && pane.querySelector('.workshop-pane-body')) bindWorkshopPaneSection(paneKey);
  });
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
        <p class="hint">Optional cork pins — edit under <strong>Island Atlas</strong> tab.</p>
        <label>Linked features<input name="linkedFeatures" value="${esc((entry.linkedFeatures || []).join(', '))}"></label>
        <label>Related bugs<input name="relatedBugs" value="${esc((entry.relatedBugs || []).join(', '))}"></label>
        <label>Legacy evidence image<input name="evidenceImage" list="researchAssets" value="${esc(entry.evidence?.[0]?.image || '')}"></label>
        <label>Evidence note<textarea name="evidenceNote" rows="2">${esc(entry.evidence?.[0]?.note || '')}</textarea></label>
        <datalist id="researchAssets">${state.assets.slice(0, 300).map((a) => `<option value="${esc(a)}">`).join('')}</datalist>
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
    <div><h2>Atlas POIs</h2><p>3D island map markers only — characters, Pokémon, and lore live under Workshop → Research.</p>${dirty ? '<p class="hint feature-unsaved"><strong>Not on disk yet</strong></p>' : '<p class="hint feature-disk-ok">In sync with disk.</p>'}</div>
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
  const featuresDirty = state.dirty.has(files.features);
  const researchDirty = state.dirty.has(files.research);
  const ideasDirty = state.dirty.has(files.ideas);
  const dirtyNote = [featuresDirty && 'features', researchDirty && 'research', ideasDirty && 'ideas'].filter(Boolean);
  return `<section class="toolbar feature-toolbar workshop-toolbar">
    <div><h2>Workshop</h2><p>Features, concierge research entries (any topic), and ideas. Cork map pins are edited under <strong>Island Atlas</strong>.</p>
    ${dirtyNote.length ? `<p class="hint feature-unsaved"><strong>Unsaved:</strong> ${dirtyNote.join(', ')}</p>` : '<p class="hint feature-disk-ok">All workshop files in sync with disk.</p>'}</div>
  </section>
  <section class="panel workshop-page">
    ${workshopPane('Features', 'On-flight board cards + dossier modals', workshopFeaturesPane(), 'features')}
    ${workshopPane('Research', 'Characters, Pokémon, locations, mechanics — Concierge Research', workshopResearchPane(), 'research')}
    ${workshopPane('Ideas', 'Sparks for Ideas &amp; Milestones on the public site', workshopIdeasPane(), 'ideas')}
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
        <label>Legacy evidence image<input name="evidenceImage" list="poiAssets" value="${esc(poi.evidence?.[0]?.image || '')}"></label>
        <label>Evidence note<textarea name="evidenceNote" rows="2">${esc(poi.evidence?.[0]?.note || '')}</textarea></label>
        <datalist id="poiAssets">${state.assets.slice(0, 300).map((a) => `<option value="${esc(a)}">`).join('')}</datalist>
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
  if (!candidates.length) return '<p class="hint">Click <strong>Find covers</strong> for Libretro matches. Switch titles are not on Libretro — add files manually at the path above.</p>';
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
      <div><h3>Box art</h3><p class="hint">${hasFile ? 'File on disk.' : isMissing ? 'Missing on disk — fetch below or drop a file at the path.' : 'Path set; refresh status if you just added a file.'} · <strong>${esc(game.platform)}</strong></p></div>
      <div class="actions"><button type="button" class="btn ghost small" id="searchBoxart">Find covers</button><button type="button" class="btn ghost small" id="autoPickBoxart">Auto-pick recommended</button></div>
    </div>
    <div class="game-preview-large"><img src="${game?.boxArt ? `/${esc(game.boxArt)}?t=${Date.now()}` : ''}" alt="" onerror="this.style.display='none'"></div>
    <div class="boxart-step">
      ${picker.loading ? '<p class="hint">Searching Libretro Thumbnails…</p>' : renderCoverCards(picker.candidates)}
    </div>
  </section>`;
}
function gameLibrary() {
  const data = state.data['compatibility.json'];
  const games = data.games;
  const id = state.selected.game || games[0]?.id;
  state.selected.game = id;
  const game = games.find((g) => g.id === id);
  const missing = state.boxart?.missingCount ?? 0;
  return `<section class="toolbar"><div><h2>Game Library</h2><p>Edit metadata, paths, and box art for each title.</p>${boxartStatusLine()}</div><div class="actions"><button type="button" class="btn ghost" id="refreshBoxartStatus">Refresh status</button><button type="button" class="btn" id="fetchAllRecommended"${missing ? '' : ' disabled'}>Accept all recommended (${missing})</button><button type="button" class="btn ghost" id="refetchAllBoxart">Refetch all</button><button class="btn" id="saveGames">Save library</button></div></section>
  <section class="editor-grid"><aside class="panel">${list(games, id, (g) => `${g.shortTitle}${state.boxart?.missing?.some((m) => m.id === g.id) ? ' · needs art' : ''}`)}</aside><article class="panel game-library-main">${gameForm(game, data)}${game ? gameBoxArtPanel(game) : ''}</article></section>`;
}
function gameForm(game, data) {
  return `<h2>${esc(game.title)}</h2><div class="form" data-form="game">
    <div class="row"><label>ID<input name="id" value="${esc(game.id)}"></label><label>Title<input name="title" value="${esc(game.title)}"></label></div>
    <div class="row three"><label>Generation<select name="generation">${data.generations.map(g => `<option value="${g.id}" ${game.generation===g.id?'selected':''}>${g.label}</option>`).join('')}</select></label><label>Short title<input name="shortTitle" value="${esc(game.shortTitle)}"></label><label>Platform<input name="platform" value="${esc(game.platform)}"></label></div>
    <div class="row"><label>Release year<input name="releaseYear" type="number" value="${game.releaseYear}"></label><label>Family<input name="family" value="${esc(game.family)}"></label></div>
    <label>Box art path<input name="boxArt" list="assets" value="${esc(game.boxArt)}"></label><datalist id="assets">${state.assets.map(a => `<option value="${esc(a)}"></option>`).join('')}</datalist>
  </div>`;
}

function jsonEditor(title, file, description) {
  return `<section class="toolbar"><div><h2>${title}</h2><p>${description}</p></div><div class="actions"><button class="btn" id="saveJsonEditor">Save ${file}</button></div></section>
  <section class="panel"><label>JSON data<textarea id="jsonEditor" spellcheck="false" style="min-height:560px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace">${esc(JSON.stringify(state.data[file], null, 2))}</textarea></label></section><pre id="output" class="output" style="margin-top:16px"></pre>`;
}
function mediaLibrary() {
  const gallery = state.data['gallery.json'];
  return `<section class="toolbar"><div><h2>Media Library</h2><p>Add files to public/media, then create gallery records that point to them.</p></div><div class="actions"><button class="btn" id="saveJsonEditor">Save gallery JSON</button></div></section>
  <section class="editor-grid"><aside class="panel"><h2>Detected assets</h2><div class="list">${state.assets.slice(0,80).map(asset => `<button type="button"><strong>${esc(asset.split('/').pop())}</strong><span>${esc(asset)}</span></button>`).join('')}</div></aside><article class="panel">${jsonEditorInner(files.gallery)}</article></section><pre id="output" class="output" style="margin-top:16px"></pre>`;
}
function modelsEditor() {
  const data = state.data['models.json'];
  return `<section class="toolbar"><div><h2>3D Model Stack</h2><p>Edit the master island model and submodel records used inside the Atlas page.</p></div><div class="actions"><button class="btn ghost" id="saveJsonEditor">Save full JSON</button><button class="btn" id="saveModels">Save main model fields</button></div></section>
  <section class="panel"><div class="form" data-form="models"><h3>Main island model</h3><div class="row three"><label>Name<input name="mainName" value="${esc(data.mainModel.name)}"></label><label>Status<input name="mainStatus" value="${esc(data.mainModel.status)}"></label><label>File path<input name="mainFile" value="${esc(data.mainModel.file)}"></label></div><label>Preview path<input name="mainPreview" value="${esc(data.mainModel.preview)}"></label><label>Summary<textarea name="mainSummary">${esc(data.mainModel.summary)}</textarea></label></div></section>
  <section class="panel" style="margin-top:16px"><h2>Submodels</h2><p>Use the JSON area for detailed submodel arrays while keeping the main model fields easy to edit.</p>${jsonEditorInner(files.models)}</section><pre id="output" class="output" style="margin-top:16px"></pre>`;
}
function charactersEditor() {
  const data = state.data['characters.json'];
  return `<section class="toolbar"><div><h2>Characters & Visitors</h2><p>Edit the characters and visitor sprite registry used by the Atlas page.</p></div><div class="actions"><button class="btn" id="saveJsonEditor">Save character JSON</button></div></section>
  <section class="editor-grid"><aside class="panel"><h2>Sprite requirements</h2><div class="list">${data.spriteRequirements.map(req => `<button type="button"><strong>${esc(req.label)}</strong><span>${esc(req.path)}</span></button>`).join('')}</div></aside><article class="panel">${jsonEditorInner(files.characters)}</article></section><pre id="output" class="output" style="margin-top:16px"></pre>`;
}
function milestonesEditor() {
  const data = state.data['roadmap.json'];
  const milestones = data.milestones || [];
  const id = resolveSelectedMilestoneId(milestones, data);
  state.selected.milestone = id;
  const item = getSelectedMilestone();
  const dirty = state.dirty.has(files.roadmap);
  return `<section class="toolbar feature-toolbar milestone-toolbar">
    <div><h2>Milestones</h2><p>Timeline for the public <strong>Ideas &amp; Milestones</strong> tab. Mark one item as current.</p>${dirty ? '<p class="hint feature-unsaved"><strong>Not on disk yet</strong></p>' : '<p class="hint feature-disk-ok">In sync with disk.</p>'}</div>
  </section>
  <section class="panel milestone-desk">
    <div class="feature-action-bar milestone-action-bar">
      <div class="feature-action-buttons">
        <button type="button" class="btn" id="saveRoadmap">Save milestones</button>
        <button type="button" class="btn ghost" id="newMilestone">New milestone</button>
      </div>
      <span class="feature-save-hint milestone-save-hint${dirty ? ' is-dirty' : ''}">${dirty ? 'Unsaved' : 'Saved'}</span>
    </div>
    <div class="feature-layout milestone-layout">
      <aside class="panel feature-sidebar milestone-sidebar"><div id="milestoneListHost">${milestoneListItemsHtml(milestones, id)}</div></aside>
      <article class="panel feature-main milestone-main" id="milestoneDetailHost">${item ? milestoneDetailHtml(item, data) : '<p class="hint">Select a milestone.</p>'}</article>
    </div>
  </section><pre id="output" class="output" style="margin-top:16px"></pre>`;
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
      <div class="row"><label>Current milestone<select name="current">${['no', 'yes'].map((v) => `<option ${((data.currentMilestoneId === item.id && v === 'yes') || (data.currentMilestoneId !== item.id && v === 'no')) ? 'selected' : ''}>${v}</option>`).join('')}</select></label><label>Hero image path<input name="image" value="${esc(item.image || '')}" list="milestoneAssets"></label></div>
      <label>Card summary<textarea name="summary" rows="3">${esc(item.summary)}</textarea></label>
      <datalist id="milestoneAssets">${state.assets.slice(0, 300).map((a) => `<option value="${esc(a)}">`).join('')}</datalist>
      <div id="milestoneDossierMount">${dossierEditorHtml(item, featureDossierDeps(), milestoneDossierConfig())}</div>
    </div>
  </div>`;
}
function workshopIdeasPane() {
  const items = state.data['ideas.json'].items || [];
  const id = state.selected.idea || items[0]?.id;
  state.selected.idea = id;
  const item = items.find((i) => i.id === id) || items[0];
  const dirty = state.dirty.has(files.ideas);
  return `<div class="workshop-pane-inner feature-desk">
    <div class="feature-action-bar workshop-action-bar">
      <div class="feature-action-buttons">
        <button type="button" class="btn" id="saveIdeas">Save ideas</button>
        <button type="button" class="btn ghost" id="newIdea">New idea</button>
      </div>
      <span class="feature-save-hint${dirty ? ' is-dirty' : ''}">${dirty ? 'Unsaved' : 'Saved'}</span>
    </div>
    <div class="feature-layout workshop-layout">
      <aside class="panel feature-sidebar workshop-sidebar"><div id="ideaListHost">${workshopPickerList('idea', items, id, (i) => i.title, (i) => `${i.status} · ${i.id}`)}</div></aside>
      <article class="panel feature-main workshop-main" id="ideaDetailHost">${item ? ideaDetailHtml(item) : '<p class="hint">Select an idea.</p>'}</article>
    </div>
  </div>`;
}
function ideaDetailHtml(item) {
  const hasDossier = featureHasDossierContent(item, normalizeFeatureDossierRaw);
  return `<div class="feature-detail">
    <div class="feature-detail-badges">
      <span class="badge">${esc(item.id)}</span>
      <span class="badge">${esc(item.status)}</span>
      ${hasDossier ? '<span class="badge record-detail-dossier">Brief</span>' : ''}
    </div>
    <div class="form" data-form="idea">
      <label class="feature-title-field">Title<input name="title" value="${esc(item.title)}"></label>
      <div class="row"><label>ID<input name="id" value="${esc(item.id)}"></label><label>Status<input name="status" value="${esc(item.status)}"></label></div>
      <label>Tags<input name="tags" value="${esc((item.tags || []).join(', '))}"></label>
      <label>Card summary<textarea name="summary" rows="3">${esc(item.summary)}</textarea></label>
      <div id="ideaDossierMount">${dossierEditorHtml(item, featureDossierDeps(), ideaDossierConfig())}</div>
    </div>
  </div>`;
}
function docsEditor() {
  const manifest = state.data['docs.json'] || { categories: [], articles: [] };
  const articles = manifest.articles || [];
  const meta = getSelectedDocMeta();
  const record = getDocEditorRecord(meta);
  const dirty = state.dirty.has(files.docs);
  const categories = manifest.categories || [];
  return `<section class="toolbar feature-toolbar">
    <div><h2>Docs</h2><p>Technical &amp; design articles for <strong>#/docs</strong>. Index in <code>docs.json</code>; bodies in <code>public/docs/articles/{category}/</code>. See <code>docs/AUTHORING.md</code>.</p>${dirty ? '<p class="hint feature-unsaved"><strong>Not on disk yet</strong></p>' : '<p class="hint feature-disk-ok">In sync with disk.</p>'}</div>
  </section>
  <section class="panel feature-desk">
    <div class="feature-action-bar">
      <div class="feature-action-buttons">
        <button type="button" class="btn" id="saveDocs">Save docs</button>
        <button type="button" class="btn ghost" id="newDoc">New article</button>
      </div>
      <span class="feature-save-hint${dirty ? ' is-dirty' : ''}">${dirty ? 'Unsaved' : 'Saved'}</span>
    </div>
    <div class="feature-layout">
      <aside class="panel feature-sidebar"><div id="docListHost">${docListHtml(articles, meta?.slug)}</div></aside>
      <article class="panel feature-main" id="docDetailHost">${record ? docDetailHtml(record, categories) : '<p class="hint">Select or create an article.</p>'}</article>
    </div>
  </section><pre id="output" class="output" style="margin-top:16px"></pre>`;
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
      <div class="row"><label>Hero image path<input name="heroPath" value="${esc(hero.path || '')}" list="docAssets"></label><label>Hero caption<input name="heroCaption" value="${esc(hero.caption || '')}"></label></div>
      <datalist id="docAssets">${state.assets.slice(0, 300).map((a) => `<option value="${esc(a)}">`).join('')}</datalist>
      <p class="hint">Public URL: <code>#/docs?article=${esc(record.slug)}</code></p>
      <div id="docDossierMount">${dossierEditorHtml(record, featureDossierDeps(), docDossierConfig())}</div>
    </div>
  </div>`;
}
function jsonEditorInner(file) { return `<textarea id="jsonEditor" style="min-height:420px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace">${esc(JSON.stringify(state.data[file], null, 2))}</textarea>`; }
function designLab() {
  const theme = state.data['theme.json'];
  const homepage = state.data['homepage.json'];
  return `<section class="toolbar"><div><h2>Design Lab</h2><p>Fine-tune the public site with safe config controls instead of hunting CSS.</p></div><div class="actions"><button class="btn" id="saveDesign">Save design config</button></div></section>
  <section class="panel"><div class="form" data-form="design">
    <div class="row three"><label>Motion<select name="motion">${['off','gentle','full'].map(v => `<option ${theme.motion===v?'selected':''}>${v}</option>`).join('')}</select></label><label>Hero style<select name="heroStyle">${['cinematic','clean','compact'].map(v => `<option ${theme.heroStyle===v?'selected':''}>${v}</option>`).join('')}</select></label><label>Card density<select name="cardDensity">${['cozy','comfortable','dense'].map(v => `<option ${theme.cardDensity===v?'selected':''}>${v}</option>`).join('')}</select></label></div>
    <div class="row three"><label>Ontology density<select name="ontologyDensity">${['calm','detailed','dense'].map(v => `<option ${theme.ontologyDensity===v?'selected':''}>${v}</option>`).join('')}</select></label><label>Graph line style<select name="graphLineStyle">${['hairline','ribbon','glow'].map(v => `<option ${theme.graphLineStyle===v?'selected':''}>${v}</option>`).join('')}</select></label><label>Legal banner<select name="legalBannerStyle">${['slim','standard','prominent'].map(v => `<option ${theme.legalBannerStyle===v?'selected':''}>${v}</option>`).join('')}</select></label></div>
    <label>Homepage headline<textarea name="headline">${esc(homepage.hero.headline)}</textarea></label>
    <label>Homepage subheadline<textarea name="subheadline">${esc(homepage.hero.subheadline)}</textarea></label>
    <label>Homepage carousel JSON <textarea name="homeCarousel" spellcheck="false" style="min-height:260px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace">${esc(JSON.stringify(homepage.carousel || [], null, 2))}</textarea></label>
    <p class="hint">This carousel is only for the Home page. The Island Atlas carousel still lives in gallery.json, so both can use different images.</p>
  </div></section><pre id="output" class="output" style="margin-top:16px"></pre>`;
}
function publish() {
  return `<section class="panel"><h2>Preview and publish</h2><p>Validate data, review Git status, then commit and push through your local Git credentials. No tokens are stored in the public repo.</p><div class="actions"><button class="btn ghost" id="gitStatus">Refresh Git status</button><button class="btn ghost" id="validateOnly">Validate data</button><button class="btn" id="publishNow">Commit & push</button></div><label style="margin-top:16px">Commit message<input id="commitMessage" value="Resort update: data and tracker changes"></label></section><pre id="output" class="output" style="margin-top:16px">Dirty files in this session: ${[...state.dirty].join(', ') || 'none'}</pre>`;
}
async function render() {
  const app = $('#app');
  if (state.tab === 'Box Art') state.tab = 'Game Library';
  if (state.tab === 'Community Issues') state.tab = 'Bugs';
  if (['Features', 'Research', 'Ideas'].includes(state.tab)) state.tab = 'Workshop';
  if (document.querySelector('[data-workshop-pane]')) captureWorkshopPaneState();
  if (state.tab === 'Game Library' && !state.boxart) {
    try { await refreshBoxartStatus(); } catch (e) {
      state.boxart = { configured: false, missingCount: 0, missing: [], error: e.message };
      log(`Box art status failed: ${e.message}`, 'error');
    }
  }
  if (state.tab === 'Map Editor') {
    document.body.classList.add('map-editor-active');
    document.body.classList.remove('atlas-map-active');
    try { await initMapEditorTab(state, api); } catch (e) {
      log(`Map editor init failed: ${e.message}`, 'error');
    }
  } else if (state.tab === 'Island Atlas') {
    document.body.classList.add('atlas-map-active');
    document.body.classList.remove('map-editor-active');
  } else {
    document.body.classList.remove('map-editor-active');
    document.body.classList.remove('atlas-map-active');
  }
  app.innerHTML = ({ Dashboard:dashboard, Compatibility:compatibility, Bugs:bugsEditor, Workshop:workshop, 'Island Atlas':() => atlasMapEditorHtml(state, esc, featureDossierDeps()), 'Map Editor':() => mapEditorHtml(state, esc), Milestones:milestonesEditor, Docs:docsEditor, 'Game Library':gameLibrary, 'Media Library':mediaLibrary, Models:modelsEditor, Characters:charactersEditor, 'Design Lab':designLab, Publish:publish }[state.tab] || dashboard)();
  bind();
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
  document.querySelectorAll('[data-go]').forEach(btn => btn.onclick = () => { state.tab = btn.dataset.go; renderTabs(); render(); });
  document.querySelectorAll('.list button[data-id]:not([data-workshop-kind]):not([data-milestone-id])').forEach(btn => btn.onclick = () => {
    const keyMap = { Compatibility:'route', Bugs:'bug', 'Game Library':'game' };
    const key = keyMap[state.tab] || 'game';
    state.selected[key] = btn.dataset.id;
    if (state.tab === 'Compatibility') {
      const route = state.data['compatibility.json'].routes.find((r) => r.id === btn.dataset.id);
      if (route) {
        state.selected.compatFromGen = route.from;
        state.selected.compatToGen = route.to;
        state.selected.route = route.id;
        syncCompatUIFromState();
        return;
      }
    }
    if (state.tab === 'Bugs' && btn.dataset.id) {
      applyBugFromForm();
      state.selected.bug = btn.dataset.id;
      syncBugUIFromState();
      return;
    }
    if (state.tab === 'Game Library') resetBoxartPicker();
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
  if (state.tab === 'Compatibility') syncCompatUIFromState();
  if (state.tab === 'Bugs') bindBugDesk();
  if (state.tab === 'Workshop') bindWorkshopDesk();
  if (state.tab === 'Island Atlas') {
    initAtlasMapEditorTab(state, {
      ...featureDossierDeps(),
      markDirty: (file) => markDirty(files.atlasPins),
      saveFile,
      log,
    });
  }
  if (state.tab === 'Map Editor') bindMapEditor(state, { api, log, esc, render });
  if (state.tab === 'Milestones') bindMilestonesDesk();
  if (state.tab === 'Docs') bindDocsDesk();
  const saveGames = $('#saveGames'); if (saveGames) saveGames.onclick = () => { updateGame(); saveFile(files.compatibility, state.data['compatibility.json']); };
  const saveDesign = $('#saveDesign'); if (saveDesign) saveDesign.onclick = () => { updateDesign(); Promise.all([saveFile(files.theme, state.data['theme.json']), saveFile(files.homepage, state.data['homepage.json'])]); };
  const saveJsonEditor = $('#saveJsonEditor'); if (saveJsonEditor) saveJsonEditor.onclick = () => { const fileMap = { 'Media Library':files.gallery, Models:files.models, Characters:files.characters, Milestones:files.roadmap, Ideas:files.ideas }; const file = fileMap[state.tab]; try { state.data[file] = JSON.parse($('#jsonEditor').value); markDirty(file); saveFile(file, state.data[file]); } catch(e) { toast('Invalid JSON: ' + e.message); } };
  const saveModels = $('#saveModels'); if (saveModels) saveModels.onclick = () => { updateModels(); saveFile(files.models, state.data['models.json']); };
  const newMilestone = $('#newMilestone'); if (newMilestone) newMilestone.onclick = () => {
    applyMilestoneFromForm();
    const item = { id:`milestone-${Date.now().toString().slice(-5)}`, title:'New milestone', status:'future', summary:'Describe the milestone.' };
    state.data['roadmap.json'].milestones.push(item);
    state.selected.milestone = item.id;
    markDirty(files.roadmap);
    syncMilestonesUI();
    log(`Created ${item.id}. Save milestones when ready.`, 'ok');
  };
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
function updateGame() { const d = formData(); const game = state.data['compatibility.json'].games.find(g => g.id === state.selected.game); Object.assign(game, { id:d.id, title:d.title, generation:d.generation, shortTitle:d.shortTitle, platform:d.platform, releaseYear:Number(d.releaseYear), family:d.family, boxArt:d.boxArt }); state.selected.game=d.id; markDirty(files.compatibility); }

function updateModels() { const d = formData(); const models = state.data['models.json']; Object.assign(models.mainModel, { name:d.mainName, status:d.mainStatus, file:d.mainFile, preview:d.mainPreview, summary:d.mainSummary }); markDirty(files.models); }
function updateMilestone() { applyMilestoneFromForm(); }
function updateIdea() { applyIdeaFromForm(); }
function updateDesign() { const d = formData(); Object.assign(state.data['theme.json'], { motion:d.motion, heroStyle:d.heroStyle, cardDensity:d.cardDensity, ontologyDensity:d.ontologyDensity, graphLineStyle:d.graphLineStyle, legalBannerStyle:d.legalBannerStyle }); state.data['homepage.json'].hero.headline = d.headline; state.data['homepage.json'].hero.subheadline = d.subheadline; try { state.data['homepage.json'].carousel = JSON.parse(d.homeCarousel || '[]'); } catch(e) { throw new Error('Homepage carousel JSON is invalid: ' + e.message); } markDirty(files.theme); markDirty(files.homepage); }
async function saveAllDirty() {
  const jobs = [...state.dirty].map(file => saveFile(file, state.data[file]));
  await Promise.all(jobs);
}
boot().catch((err) => {
  log(`Boot failed: ${err.message}`, 'error');
  $('#app').innerHTML = `<section class="panel"><h2>Could not start</h2><p>${esc(err.message)}</p></section>`;
});
