import { renderCompatGraphHtml, bindCompatGraph } from './ontology-picker.js';
import {
  bindFeatureDossierEditor,
  featureDossierEditorHtml,
  featureHasDossierContent,
  normalizeFeatureDossierRaw,
  readFeatureDossierFromDom,
} from './feature-dossier-editor.js';

const state = {
  data: null,
  assets: [],
  tab: 'Dashboard',
  selected: { compatFromGen: null, compatToGen: null },
  dirty: new Set(),
  boxart: null,
  boxartPicker: { candidates: [], options: [], selectedCandidateId: null, searchQuery: '' },
  bugFilter: 'active',
  bugSearch: '',
  github: { status: null, issues: [], state: 'open', loading: false, error: '' },
  featureFilter: 'active',
  featureSearch: '',
};
const files = { compatibility:'compatibility.json', bugs:'bugs.json', features:'features.json', research:'research-pois.json', theme:'theme.json', homepage:'homepage.json', gallery:'gallery.json', models:'models.json', characters:'characters.json', roadmap:'roadmap.json', ideas:'ideas.json' };
const tabs = ['Dashboard','Compatibility','Bugs','Features','Research','Game Library','Media Library','Models','Characters','Milestones','Ideas','Design Lab','Publish'];
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
  state.data = await api('/api/data');
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
  const pois = state.data['research-pois.json'].pois;
  const cards = [
    ['Open/blocked bugs', bugs.filter(b => ['Open','Blocked'].includes(b.status)).length],
    ['Untested routes', routes.filter(r => r.status === 'gray').length],
    ['Known failing routes', routes.filter(r => r.status === 'red').length],
    ['On-flight features', features.filter(f => ['On-Flight','Testing'].includes(f.stage)).length],
    ['POIs missing evidence', pois.filter(p => !p.evidence?.length).length],
  ];
  return `<section class="grid dashboard">${cards.map(([label,val]) => `<article class="card"><span>${label}</span><strong>${val}</strong></article>`).join('')}</section>
  <section class="panel" style="margin-top:16px"><h2>Needs attention</h2><div class="grid">${attentionItems().map(item => `<p><span class="badge">${item.type}</span> ${item.text}</p>`).join('')}</div></section>
  <section class="panel" style="margin-top:16px"><h2>Quick actions</h2><div class="actions"><button class="btn" data-go="Compatibility">Update Compatibility</button><button class="btn" data-go="Bugs">Add Bug</button><button class="btn" data-go="Features">Update Feature</button><button class="btn" data-go="Research">Add Research POI</button><button class="btn ghost" data-go="Game Library">Game library & box art</button><button class="btn ghost" data-go="Publish">Preview / Publish</button></div></section>`;
}
function attentionItems() {
  const data = state.data;
  const games = data['compatibility.json'].games;
  const routes = data['compatibility.json'].routes;
  const bugs = data['bugs.json'].bugs;
  const pois = data['research-pois.json'].pois;
  const items = [];
  games.filter(g => !g.boxArt || !state.assets.includes(g.boxArt)).slice(0,6).forEach(g => items.push({ type:'Game Library', text:`${g.title} needs local box art at ${g.boxArt}.` }));
  routes.filter(r => r.status === 'red' && !r.relatedBugs?.length).slice(0,4).forEach(r => items.push({ type:'Compatibility', text:`${r.title} is red but has no linked bug.` }));
  bugs.filter(b => b.status === 'Fixed' && b.linkedRoutes?.length).slice(0,3).forEach(b => items.push({ type:'Issue Desk', text:`${b.id} is fixed; verify linked routes are updated.` }));
  pois.filter(p => !p.evidence?.length).slice(0,5).forEach(p => items.push({ type:'Research', text:`${p.name} has no curated evidence images.` }));
  return items.length ? items : [{ type:'Resort', text:'Everything has the minimum data needed. Nice.' }];
}
function list(items, selectedId, labelFn) {
  return `<div class="list">${items.map(item => `<button class="${selectedId===item.id?'active':''}" data-id="${item.id}"><strong>${esc(labelFn(item))}</strong><span>${esc(item.id)}</span></button>`).join('')}</div>`;
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
function imageAssetOptions() {
  return (state.assets || []).filter((p) => /\.(png|jpe?g|webp|gif|svg|mp4|webm)$/i.test(p)).slice(0, 120);
}
function featureDossierDeps() {
  return {
    esc,
    $,
    adminAssetUrl,
    imageAssetOptions,
    getPois: () => (state.data['research-pois.json']?.pois || []).map((poi) => ({ id: poi.id, name: poi.name })),
    getMilestones: () => (state.data['roadmap.json']?.milestones || []),
  };
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
    const dossier = featureHasDossierContent(feature);
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
        ${featureHasDossierContent(feature) ? '<span class="badge record-detail-dossier" title="Research dossier">Dossier</span>' : ''}
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
function touchFeatureDraft() {
  markDirty(files.features);
  updateFeatureDirtyHint();
  bindSaveFeaturesButtons();
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
    if (featureHasDossierContent({ ...feature, dossier: pruned })) {
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
  document.querySelectorAll('[data-feature-id]').forEach((btn) => {
    btn.onclick = () => {
      applyFeatureFromForm();
      state.selected.feature = btn.dataset.featureId;
      syncFeatureUIFromState();
    };
  });
}
function bindFeatureDetail() {
  document.querySelectorAll('[data-feature-stage]').forEach((btn) => {
    btn.onclick = () => {
      patchSelectedFeature({ stage: btn.dataset.featureStage });
      syncFeatureUIFromState();
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
        const num = form.querySelector('.feature-progress-num');
        if (num) num.value = field.value;
        patchSelectedFeature({ progress: Number(field.value) });
        const label = form.querySelector('.feature-progress-label');
        if (label) label.textContent = `${field.value}%`;
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
    getRecord: getSelectedFeature,
    onDirty: touchFeatureDraft,
    rerender: () => syncFeatureUIFromState({ detailOnly: true }),
  });
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
  if (detailHost) {
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
function features() {
  const data = state.data['features.json'];
  const features = data.features;
  if (!state.selected.feature) {
    state.selected.feature = filteredFeatures(features, { filter: state.featureFilter })[0]?.id || features[0]?.id;
  }
  const dirty = state.dirty.has(files.features);
  return `<section class="toolbar feature-toolbar">
    <div><h2>On-Flight Board</h2><p>Pick a feature, use quick stage buttons, and edit tasks. Changes stay in memory until you click <strong>Save features</strong>.</p>${dirty ? '<p class="hint feature-unsaved"><strong>Not on disk yet</strong> — save when you are done editing.</p>' : '<p class="hint feature-disk-ok">In sync with disk.</p>'}</div>
  </section>
  <section class="panel feature-desk">
    <div class="feature-action-bar">
      <div class="feature-action-buttons">
        <button type="button" class="btn js-save-features">Save features</button>
        <button type="button" class="btn ghost" id="newFeature">New feature</button>
      </div>
      <span class="feature-save-hint${dirty ? ' is-dirty' : ''}">${dirty ? 'Unsaved draft — click Save' : 'Saved to disk'}</span>
    </div>
    <div class="feature-layout">
      <aside class="panel feature-sidebar">
        <div id="featureFiltersHost">${featureFiltersHtml(features, data.stages)}</div>
        <div id="featureListHost">${featureListItemsHtml(features)}</div>
      </aside>
      <article class="panel feature-main" id="featureDetailHost">${featureDetailHtml(getSelectedFeature(), data)}</article>
    </div>
  </section>`;
}
function research() {
  const data = state.data['research-pois.json'];
  const pois = data.pois;
  const id = state.selected.poi || pois[0]?.id;
  state.selected.poi = id;
  const poi = pois.find(p => p.id === id);
  return `<section class="toolbar"><div><h2>Research POIs</h2><p>Edit 3D island markers, evidence, asset needs, and linked work.</p></div><div class="actions"><button class="btn ghost" id="newPoi">New POI</button><button class="btn" id="saveResearch">Save research</button></div></section>
  <section class="editor-grid"><aside class="panel">${list(pois, id, p => `${p.name} · ${p.confidence}`)}</aside><article class="panel">${poiForm(poi)}</article></section><pre id="output" class="output" style="margin-top:16px"></pre>`;
}
function poiForm(poi) {
  return `<h2>${esc(poi.name)}</h2><div class="form" data-form="poi">
    <div class="row"><label>ID<input name="id" value="${esc(poi.id)}"></label><label>Name<input name="name" value="${esc(poi.name)}"></label></div>
    <div class="row three"><label>Type<input name="type" value="${esc(poi.type)}"></label><label>Confidence<select name="confidence">${['Confirmed','Likely','Possible','Speculative','Original for gameplay'].map(s => `<option ${poi.confidence===s?'selected':''}>${s}</option>`).join('')}</select></label><label>Dev status<input name="devStatus" value="${esc(poi.devStatus)}"></label></div>
    <label>Canon status<input name="canonStatus" value="${esc(poi.canonStatus)}"></label>
    <label>Summary<textarea name="summary">${esc(poi.summary)}</textarea></label>
    <div class="row three"><label>X<input name="x" type="number" step="0.05" value="${poi.position[0]}"></label><label>Y<input name="y" type="number" step="0.05" value="${poi.position[1]}"></label><label>Z<input name="z" type="number" step="0.05" value="${poi.position[2]}"></label></div>
    <label>Asset needs, comma separated<input name="assetNeeds" value="${esc((poi.assetNeeds||[]).join(', '))}"></label>
    <label>Linked features<input name="linkedFeatures" value="${esc((poi.linkedFeatures||[]).join(', '))}"></label>
    <label>Related bugs<input name="relatedBugs" value="${esc((poi.relatedBugs||[]).join(', '))}"></label>
    <label>Evidence image path<input name="evidenceImage" list="assets" value="${esc(poi.evidence?.[0]?.image || '')}"></label><datalist id="assets">${state.assets.map(a => `<option value="${esc(a)}"></option>`).join('')}</datalist>
    <label>Evidence note<textarea name="evidenceNote">${esc(poi.evidence?.[0]?.note || '')}</textarea></label>
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
  const id = state.selected.milestone || data.currentMilestoneId || milestones[0]?.id;
  state.selected.milestone = id;
  const item = milestones.find(m => m.id === id) || milestones[0];
  return `<section class="toolbar"><div><h2>Milestone Timeline</h2><p>Edit the dedicated vertical Milestones page. Mark one item as current; no dates required.</p></div><div class="actions"><button class="btn ghost" id="newMilestone">New milestone</button><button class="btn" id="saveRoadmap">Save milestones</button></div></section>
  <section class="editor-grid"><aside class="panel">${list(milestones, id, m => `${m.title} · ${m.status}`)}</aside><article class="panel">${item ? milestoneForm(item, data) : '<p>No milestone selected.</p>'}</article></section><pre id="output" class="output" style="margin-top:16px"></pre>`;
}
function milestoneForm(item, data) {
  return `<h2>${esc(item.title)}</h2><div class="form" data-form="milestone"><div class="row"><label>ID<input name="id" value="${esc(item.id)}"></label><label>Title<input name="title" value="${esc(item.title)}"></label></div><div class="row three"><label>Status<select name="status">${['past','current','next','future','paused'].map(s => `<option ${item.status===s?'selected':''}>${s}</option>`).join('')}</select></label><label>Current milestone<select name="current">${['no','yes'].map(v => `<option ${((data.currentMilestoneId===item.id && v==='yes') || (data.currentMilestoneId!==item.id && v==='no'))?'selected':''}>${v}</option>`).join('')}</select></label><label>Image path<input name="image" value="${esc(item.image || '')}"></label></div><label>Summary<textarea name="summary">${esc(item.summary)}</textarea></label></div>`;
}
function ideasEditor() {
  const data = state.data['ideas.json'];
  const items = data.items || [];
  const id = state.selected.idea || items[0]?.id;
  state.selected.idea = id;
  const item = items.find(i => i.id === id) || items[0];
  return `<section class="toolbar"><div><h2>Idea Board</h2><p>Keep sparks visible until they graduate into features, POIs, or roadmap milestones.</p></div><div class="actions"><button class="btn ghost" id="newIdea">New idea</button><button class="btn" id="saveIdeas">Save ideas</button></div></section>
  <section class="editor-grid"><aside class="panel">${list(items, id, i => `${i.title} · ${i.status}`)}</aside><article class="panel">${item ? ideaForm(item) : '<p>No idea selected.</p>'}</article></section><pre id="output" class="output" style="margin-top:16px"></pre>`;
}
function ideaForm(item) {
  return `<h2>${esc(item.title)}</h2><div class="form" data-form="idea"><div class="row"><label>ID<input name="id" value="${esc(item.id)}"></label><label>Title<input name="title" value="${esc(item.title)}"></label></div><div class="row"><label>Status<input name="status" value="${esc(item.status)}"></label><label>Tags, comma separated<input name="tags" value="${esc((item.tags||[]).join(', '))}"></label></div><label>Summary<textarea name="summary">${esc(item.summary)}</textarea></label></div>`;
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
  if (state.tab === 'Game Library' && !state.boxart) {
    try { await refreshBoxartStatus(); } catch (e) {
      state.boxart = { configured: false, missingCount: 0, missing: [], error: e.message };
      log(`Box art status failed: ${e.message}`, 'error');
    }
  }
  app.innerHTML = ({ Dashboard:dashboard, Compatibility:compatibility, Bugs:bugsEditor, Features:features, Research:research, 'Game Library':gameLibrary, 'Media Library':mediaLibrary, Models:modelsEditor, Characters:charactersEditor, Milestones:milestonesEditor, Ideas:ideasEditor, 'Design Lab':designLab, Publish:publish }[state.tab] || dashboard)();
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
  document.querySelectorAll('.list button[data-id]').forEach(btn => btn.onclick = () => {
    const keyMap = { Compatibility:'route', Bugs:'bug', Features:'feature', Research:'poi', 'Game Library':'game', Milestones:'milestone', Ideas:'idea' };
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
    if (state.tab === 'Features' && btn.dataset.id) {
      applyFeatureFromForm();
      state.selected.feature = btn.dataset.id;
      syncFeatureUIFromState();
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
  if (state.tab === 'Features') bindFeatureDesk();
  const saveResearch = $('#saveResearch'); if (saveResearch) saveResearch.onclick = () => { updatePoi(); saveFile(files.research, state.data['research-pois.json']); };
  const saveGames = $('#saveGames'); if (saveGames) saveGames.onclick = () => { updateGame(); saveFile(files.compatibility, state.data['compatibility.json']); };
  const saveDesign = $('#saveDesign'); if (saveDesign) saveDesign.onclick = () => { updateDesign(); Promise.all([saveFile(files.theme, state.data['theme.json']), saveFile(files.homepage, state.data['homepage.json'])]); };
  const saveJsonEditor = $('#saveJsonEditor'); if (saveJsonEditor) saveJsonEditor.onclick = () => { const fileMap = { 'Media Library':files.gallery, Models:files.models, Characters:files.characters, Milestones:files.roadmap, Ideas:files.ideas }; const file = fileMap[state.tab]; try { state.data[file] = JSON.parse($('#jsonEditor').value); markDirty(file); saveFile(file, state.data[file]); } catch(e) { toast('Invalid JSON: ' + e.message); } };
  const saveModels = $('#saveModels'); if (saveModels) saveModels.onclick = () => { updateModels(); saveFile(files.models, state.data['models.json']); };
  const saveRoadmap = $('#saveRoadmap'); if (saveRoadmap) saveRoadmap.onclick = () => { updateMilestone(); saveFile(files.roadmap, state.data['roadmap.json']); };
  const saveIdeas = $('#saveIdeas'); if (saveIdeas) saveIdeas.onclick = () => { updateIdea(); saveFile(files.ideas, state.data['ideas.json']); };
  const newPoi = $('#newPoi'); if (newPoi) newPoi.onclick = () => { const poi = { id:`poi-${Date.now().toString().slice(-5)}`, name:'New POI', type:'Research', confidence:'Possible', canonStatus:'Speculative', devStatus:'Needed', position:[0,.25,0], summary:'Describe the location.', evidence:[], assetNeeds:[], linkedFeatures:[], relatedBugs:[] }; state.data['research-pois.json'].pois.unshift(poi); state.selected.poi=poi.id; markDirty(files.research); render(); };
  const newMilestone = $('#newMilestone'); if (newMilestone) newMilestone.onclick = () => { const item = { id:`milestone-${Date.now().toString().slice(-5)}`, title:'New milestone', status:'future', summary:'Describe the milestone.' }; state.data['roadmap.json'].milestones.push(item); state.selected.milestone=item.id; markDirty(files.roadmap); render(); };
  const newIdea = $('#newIdea'); if (newIdea) newIdea.onclick = () => { const item = { id:`idea-${Date.now().toString().slice(-5)}`, title:'New idea', status:'spark', summary:'Describe the idea.', tags:[] }; state.data['ideas.json'].items.unshift(item); state.selected.idea=item.id; markDirty(files.ideas); render(); };
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
function updatePoi() { const d = formData(); const poi = state.data['research-pois.json'].pois.find(p => p.id === state.selected.poi); Object.assign(poi, { id:d.id, name:d.name, type:d.type, confidence:d.confidence, devStatus:d.devStatus, canonStatus:d.canonStatus, summary:d.summary, position:[Number(d.x),Number(d.y),Number(d.z)], assetNeeds:csv(d.assetNeeds), linkedFeatures:csv(d.linkedFeatures), relatedBugs:csv(d.relatedBugs), evidence:d.evidenceImage ? [{ label:'Curated evidence', image:d.evidenceImage, note:d.evidenceNote || '' }] : [] }); state.selected.poi=d.id; markDirty(files.research); }
function updateGame() { const d = formData(); const game = state.data['compatibility.json'].games.find(g => g.id === state.selected.game); Object.assign(game, { id:d.id, title:d.title, generation:d.generation, shortTitle:d.shortTitle, platform:d.platform, releaseYear:Number(d.releaseYear), family:d.family, boxArt:d.boxArt }); state.selected.game=d.id; markDirty(files.compatibility); }

function updateModels() { const d = formData(); const models = state.data['models.json']; Object.assign(models.mainModel, { name:d.mainName, status:d.mainStatus, file:d.mainFile, preview:d.mainPreview, summary:d.mainSummary }); markDirty(files.models); }
function updateMilestone() { const d = formData(); const roadmap = state.data['roadmap.json']; const item = (roadmap.milestones || []).find(m => m.id === state.selected.milestone); if (!item) return; Object.assign(item, { id:d.id, title:d.title, status:d.status, summary:d.summary, image:d.image || '' }); if (d.current === 'yes' || d.status === 'current') roadmap.currentMilestoneId = d.id; state.selected.milestone = d.id; markDirty(files.roadmap); }
function updateIdea() { const d = formData(); const idea = state.data['ideas.json'].items.find(i => i.id === state.selected.idea); if (!idea) return; Object.assign(idea, { id:d.id, title:d.title, status:d.status, summary:d.summary, tags:csv(d.tags) }); state.selected.idea = d.id; markDirty(files.ideas); }
function updateDesign() { const d = formData(); Object.assign(state.data['theme.json'], { motion:d.motion, heroStyle:d.heroStyle, cardDensity:d.cardDensity, ontologyDensity:d.ontologyDensity, graphLineStyle:d.graphLineStyle, legalBannerStyle:d.legalBannerStyle }); state.data['homepage.json'].hero.headline = d.headline; state.data['homepage.json'].hero.subheadline = d.subheadline; try { state.data['homepage.json'].carousel = JSON.parse(d.homeCarousel || '[]'); } catch(e) { throw new Error('Homepage carousel JSON is invalid: ' + e.message); } markDirty(files.theme); markDirty(files.homepage); }
async function saveAllDirty() {
  const jobs = [...state.dirty].map(file => saveFile(file, state.data[file]));
  await Promise.all(jobs);
}
boot().catch((err) => {
  log(`Boot failed: ${err.message}`, 'error');
  $('#app').innerHTML = `<section class="panel"><h2>Could not start</h2><p>${esc(err.message)}</p></section>`;
});
