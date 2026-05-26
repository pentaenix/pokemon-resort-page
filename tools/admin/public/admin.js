const files = ['bugs', 'features', 'compatibility', 'research-pois', 'homepage', 'theme', 'site'];
let activeFile = 'bugs';
let state = null;
let dashboardData = {};

const $ = (selector) => document.querySelector(selector);
const editor = $('#editor');
const editorTools = $('#editorTools');
const editorTitle = $('#editorTitle');
const logEl = $('#log');

function log(message, type = '') {
  const prefix = type ? `[${type.toUpperCase()}] ` : '';
  logEl.textContent = `${new Date().toLocaleTimeString()} ${prefix}${message}\n${logEl.textContent}`;
}

function titleCase(value) {
  return value.replace(/-/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function uid(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function getByPath(obj, path) {
  return path.split('.').reduce((acc, key) => acc?.[key], obj);
}

function setByPath(obj, path, value) {
  const parts = path.split('.');
  let current = obj;
  parts.slice(0, -1).forEach((part) => {
    current = current[part];
  });
  const key = parts.at(-1);
  current[key] = value;
}

function field(path, label, type = 'text', extra = '') {
  const value = getByPath(state, path) ?? '';
  if (type === 'textarea') {
    return `<label>${label}<textarea data-path="${path}">${escapeHtml(value)}</textarea></label>`;
  }
  return `<label>${label}<input ${extra} type="${type}" value="${escapeHtml(value)}" data-path="${path}" /></label>`;
}

function select(path, label, options) {
  const value = getByPath(state, path) ?? '';
  return `<label>${label}<select data-path="${path}">${options.map((option) => `<option value="${escapeHtml(option)}" ${option === value ? 'selected' : ''}>${escapeHtml(titleCase(option))}</option>`).join('')}</select></label>`;
}

function addTool(label, handler, kind = '') {
  const button = document.createElement('button');
  button.textContent = label;
  button.className = kind;
  button.addEventListener('click', handler);
  editorTools.appendChild(button);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || payload.errors?.join('\n') || payload.error || JSON.stringify(payload));
  return payload;
}

async function loadData(name = activeFile) {
  activeFile = name;
  const payload = await api(`/api/data/${name}`);
  state = payload.data;
  editorTitle.textContent = `${titleCase(name)} Data`;
  renderTabs();
  renderEditor();
  await refreshDashboard();
}

function renderTabs() {
  const tabs = $('#fileTabs');
  tabs.innerHTML = files.map((file) => `<button class="${file === activeFile ? 'active' : ''}" data-file="${file}">${titleCase(file)}</button>`).join('');
}

async function refreshDashboard() {
  try {
    const [bugs, features, compat, atlas] = await Promise.all([
      api('/api/data/bugs'),
      api('/api/data/features'),
      api('/api/data/compatibility'),
      api('/api/data/research-pois')
    ]);
    dashboardData = { bugs: bugs.data, features: features.data, compatibility: compat.data, atlas: atlas.data };
    const openBugs = dashboardData.bugs.items.filter((bug) => ['open', 'blocked'].includes(bug.status)).length;
    const onFlight = dashboardData.features.items.filter((feature) => feature.stage === 'on-flight').length;
    const routesNeedingTests = dashboardData.compatibility.routes.filter((route) => route.status === 'testing').length;
    const brokenRoutes = dashboardData.compatibility.routes.filter((route) => route.status === 'broken').length;
    const speculativePois = dashboardData.atlas.pois.filter((poi) => ['Possible', 'Speculative'].includes(poi.confidence)).length;
    $('#dashboard').innerHTML = `
      <article class="stat"><span>Open/blocked bugs</span><strong>${openBugs}</strong><p>Issue Desk tickets needing attention.</p></article>
      <article class="stat"><span>On-flight features</span><strong>${onFlight}</strong><p>Active work in the production board.</p></article>
      <article class="stat"><span>Routes to test</span><strong>${routesNeedingTests}</strong><p>Compatibility paths marked blue.</p></article>
      <article class="stat"><span>Broken routes</span><strong>${brokenRoutes}</strong><p>Round trips marked red.</p></article>
      <article class="stat"><span>POIs to prove</span><strong>${speculativePois}</strong><p>Possible or speculative atlas points.</p></article>
    `;
  } catch (error) {
    log(`Dashboard refresh failed: ${error.message}`, 'warn');
  }
}

function renderEditor() {
  editorTools.innerHTML = '';
  if (activeFile === 'bugs') return renderBugs();
  if (activeFile === 'features') return renderFeatures();
  if (activeFile === 'compatibility') return renderCompatibility();
  if (activeFile === 'research-pois') return renderPois();
  renderJsonEditor();
}

function renderJsonEditor() {
  addTool('Format JSON', () => renderJsonEditor());
  editor.innerHTML = `<textarea class="json-editor" id="jsonText">${escapeHtml(JSON.stringify(state, null, 2))}</textarea>`;
  $('#jsonText').addEventListener('input', (event) => {
    try {
      state = JSON.parse(event.target.value);
      event.target.style.borderColor = 'rgba(6,182,212,.5)';
    } catch {
      event.target.style.borderColor = '#e5484d';
    }
  });
}

function renderBugs() {
  addTool('Add Bug', () => {
    state.items.unshift({
      id: `BUG-${uid('LOCAL')}`,
      title: 'New issue',
      status: 'open',
      severity: 'minor',
      area: 'General',
      summary: 'Describe the issue here.',
      linkedFeature: '',
      linkedRoutes: [],
      checklist: [{ label: 'Reproduce the issue', done: false }],
      lastUpdated: new Date().toISOString().slice(0, 10)
    });
    renderBugs();
  }, 'primary');

  editor.innerHTML = `<div class="grid two">${state.items.map((bug, i) => `
    <article class="data-card">
      <div class="card-top">
        <h3>${escapeHtml(bug.id)}</h3>
        <button class="small ghost" data-action="delete-bug" data-index="${i}">Delete</button>
      </div>
      <div class="grid two">
        ${field(`items.${i}.id`, 'Bug ID')}
        ${field(`items.${i}.title`, 'Title')}
        ${select(`items.${i}.status`, 'Status', state.statuses)}
        ${select(`items.${i}.severity`, 'Severity', state.severities)}
        ${field(`items.${i}.area`, 'Area')}
        ${field(`items.${i}.lastUpdated`, 'Last Updated', 'date')}
      </div>
      <div class="grid">${field(`items.${i}.summary`, 'Summary', 'textarea')}</div>
      <h4>Checklist</h4>
      <div class="inline-list">
        ${bug.checklist.map((item, j) => `
          <div class="check-row">
            <input type="checkbox" data-path="items.${i}.checklist.${j}.done" ${item.done ? 'checked' : ''} />
            <input type="text" data-path="items.${i}.checklist.${j}.label" value="${escapeHtml(item.label)}" />
            <button class="small ghost" data-action="delete-bug-check" data-index="${i}" data-subindex="${j}">×</button>
          </div>
        `).join('')}
      </div>
      <p><button class="small" data-action="add-bug-check" data-index="${i}">Add checklist item</button></p>
      <div class="grid two">
        ${field(`items.${i}.linkedFeature`, 'Linked Feature ID')}
        ${field(`items.${i}.linkedRoutes`, 'Linked Route IDs, comma-separated')}
      </div>
    </article>
  `).join('')}</div>`;
}

function renderFeatures() {
  addTool('Add Feature', () => {
    state.items.unshift({
      id: uid('FEATURE').toLowerCase(),
      title: 'New feature',
      category: 'General',
      stage: 'boarding',
      priority: 'medium',
      progress: 0,
      summary: 'Describe the feature here.',
      linkedBugs: [],
      linkedResearch: [],
      tasks: [{ id: uid('task').toLowerCase(), label: 'First task', done: false }]
    });
    renderFeatures();
  }, 'primary');
  const stages = state.stages.map((stage) => stage.id);
  editor.innerHTML = `<div class="grid two">${state.items.map((feature, i) => `
    <article class="data-card">
      <div class="card-top"><h3>${escapeHtml(feature.title)}</h3><button class="small ghost" data-action="delete-feature" data-index="${i}">Delete</button></div>
      <div class="grid two">
        ${field(`items.${i}.id`, 'Feature ID')}
        ${field(`items.${i}.title`, 'Title')}
        ${field(`items.${i}.category`, 'Category')}
        ${select(`items.${i}.stage`, 'Stage', stages)}
        ${select(`items.${i}.priority`, 'Priority', ['low', 'medium', 'high'])}
        ${field(`items.${i}.progress`, 'Progress', 'number', 'min="0" max="100"')}
      </div>
      <div class="grid">${field(`items.${i}.summary`, 'Summary', 'textarea')}</div>
      <h4>Tasks</h4>
      <div class="inline-list">
        ${feature.tasks.map((task, j) => `
          <div class="check-row">
            <input type="checkbox" data-path="items.${i}.tasks.${j}.done" ${task.done ? 'checked' : ''} />
            <input type="text" data-path="items.${i}.tasks.${j}.label" value="${escapeHtml(task.label)}" />
            <button class="small ghost" data-action="delete-feature-task" data-index="${i}" data-subindex="${j}">×</button>
          </div>
        `).join('')}
      </div>
      <p><button class="small" data-action="add-feature-task" data-index="${i}">Add task</button></p>
      <div class="grid two">
        ${field(`items.${i}.linkedBugs`, 'Linked Bug IDs, comma-separated')}
        ${field(`items.${i}.linkedResearch`, 'Linked POI IDs, comma-separated')}
      </div>
    </article>
  `).join('')}</div>`;
}

function renderCompatibility() {
  addTool('Add Route', () => {
    state.routes.unshift({
      id: uid('route').toLowerCase(),
      from: 'gen1',
      to: 'resort',
      status: 'testing',
      roundTrip: true,
      summary: 'Describe this route.',
      knownIssues: [],
      testCoverage: 'More tests needed',
      relatedBugs: [],
      lastUpdated: new Date().toISOString().slice(0, 10)
    });
    renderCompatibility();
  }, 'primary');
  addTool('Edit Raw Game Nodes', renderJsonEditor);
  const gameIds = state.games.map((game) => game.id);
  const statuses = state.legend.map((item) => item.status);
  editor.innerHTML = `<div class="grid two">${state.routes.map((route, i) => `
    <article class="data-card">
      <div class="card-top"><h3>${escapeHtml(route.id)}</h3><button class="small ghost" data-action="delete-route" data-index="${i}">Delete</button></div>
      <div class="grid two">
        ${field(`routes.${i}.id`, 'Route ID')}
        ${select(`routes.${i}.from`, 'From', gameIds)}
        ${select(`routes.${i}.to`, 'To', gameIds)}
        ${select(`routes.${i}.status`, 'Status', statuses)}
        ${field(`routes.${i}.testCoverage`, 'Test Coverage')}
        ${field(`routes.${i}.lastUpdated`, 'Last Updated', 'date')}
      </div>
      <label><span>Round Trip</span><input type="checkbox" data-path="routes.${i}.roundTrip" ${route.roundTrip ? 'checked' : ''} /></label>
      <div class="grid">${field(`routes.${i}.summary`, 'Summary', 'textarea')}</div>
      <div class="grid two">
        ${field(`routes.${i}.knownIssues`, 'Known Issues, comma-separated')}
        ${field(`routes.${i}.relatedBugs`, 'Related Bug IDs, comma-separated')}
      </div>
    </article>
  `).join('')}</div>`;
}

function renderPois() {
  addTool('Add POI', () => {
    state.pois.unshift({
      id: uid('poi').toLowerCase(),
      name: 'New point of interest',
      type: 'Research',
      confidence: 'Speculative',
      position: [0, 0.5, 0],
      summary: 'Describe this location.',
      gameDevStatus: 'Not started',
      canonStatus: 'Original for gameplay until evidence is added',
      evidence: [{ label: 'Research note', image: '', note: 'Add evidence notes.' }],
      assetNeeds: [],
      relatedFeatures: [],
      relatedBugs: []
    });
    renderPois();
  }, 'primary');
  editor.innerHTML = `<div class="grid two">${state.pois.map((poi, i) => `
    <article class="data-card">
      <div class="card-top"><h3>${escapeHtml(poi.name)}</h3><button class="small ghost" data-action="delete-poi" data-index="${i}">Delete</button></div>
      <div class="grid two">
        ${field(`pois.${i}.id`, 'POI ID')}
        ${field(`pois.${i}.name`, 'Name')}
        ${field(`pois.${i}.type`, 'Type')}
        ${select(`pois.${i}.confidence`, 'Confidence', state.confidenceLevels)}
        ${field(`pois.${i}.position.0`, 'X', 'number', 'step="0.01"')}
        ${field(`pois.${i}.position.1`, 'Y', 'number', 'step="0.01"')}
        ${field(`pois.${i}.position.2`, 'Z', 'number', 'step="0.01"')}
        ${field(`pois.${i}.gameDevStatus`, 'Game Dev Status')}
      </div>
      <div class="grid">
        ${field(`pois.${i}.summary`, 'Summary', 'textarea')}
        ${field(`pois.${i}.canonStatus`, 'Canon Status')}
      </div>
      <div class="grid three">
        ${field(`pois.${i}.assetNeeds`, 'Asset Needs, comma-separated')}
        ${field(`pois.${i}.relatedFeatures`, 'Related Feature IDs, comma-separated')}
        ${field(`pois.${i}.relatedBugs`, 'Related Bug IDs, comma-separated')}
      </div>
      <h4>Evidence</h4>
      <div class="inline-list">
        ${poi.evidence.map((item, j) => `
          <div class="data-card">
            <div class="grid three">
              ${field(`pois.${i}.evidence.${j}.label`, 'Label')}
              ${field(`pois.${i}.evidence.${j}.image`, 'Image path')}
              <label>Remove<button class="small ghost" data-action="delete-evidence" data-index="${i}" data-subindex="${j}">Delete evidence</button></label>
            </div>
            ${field(`pois.${i}.evidence.${j}.note`, 'Note', 'textarea')}
          </div>
        `).join('')}
      </div>
      <p><button class="small" data-action="add-evidence" data-index="${i}">Add evidence</button></p>
    </article>
  `).join('')}</div>`;
}

function coerceValue(path, value, input) {
  const current = getByPath(state, path);
  if (input.type === 'checkbox') return input.checked;
  if (input.type === 'number') return Number(value);
  if (Array.isArray(current)) {
    if (path.endsWith('position')) return value.split(',').map(Number);
    return value.split(',').map((part) => part.trim()).filter(Boolean);
  }
  return value;
}

editor.addEventListener('input', (event) => {
  const path = event.target.dataset.path;
  if (!path || !state) return;
  setByPath(state, path, coerceValue(path, event.target.value, event.target));
});

editor.addEventListener('change', (event) => {
  const path = event.target.dataset.path;
  if (!path || !state) return;
  setByPath(state, path, coerceValue(path, event.target.value, event.target));
});

editor.addEventListener('click', (event) => {
  const action = event.target.dataset.action;
  if (!action) return;
  const i = Number(event.target.dataset.index);
  const j = Number(event.target.dataset.subindex);
  if (action === 'delete-bug') state.items.splice(i, 1), renderBugs();
  if (action === 'add-bug-check') state.items[i].checklist.push({ label: 'New checklist item', done: false }), renderBugs();
  if (action === 'delete-bug-check') state.items[i].checklist.splice(j, 1), renderBugs();
  if (action === 'delete-feature') state.items.splice(i, 1), renderFeatures();
  if (action === 'add-feature-task') state.items[i].tasks.push({ id: uid('task').toLowerCase(), label: 'New task', done: false }), renderFeatures();
  if (action === 'delete-feature-task') state.items[i].tasks.splice(j, 1), renderFeatures();
  if (action === 'delete-route') state.routes.splice(i, 1), renderCompatibility();
  if (action === 'delete-poi') state.pois.splice(i, 1), renderPois();
  if (action === 'add-evidence') state.pois[i].evidence.push({ label: 'Evidence', image: '', note: '' }), renderPois();
  if (action === 'delete-evidence') state.pois[i].evidence.splice(j, 1), renderPois();
});

$('#fileTabs').addEventListener('click', (event) => {
  const file = event.target.dataset.file;
  if (file) loadData(file).catch((error) => log(error.message, 'bad'));
});

$('#refreshBtn').addEventListener('click', () => loadData(activeFile));
$('#clearLogBtn').addEventListener('click', () => { logEl.textContent = ''; });

$('#saveBtn').addEventListener('click', async () => {
  try {
    await api(`/api/data/${activeFile}`, { method: 'POST', body: JSON.stringify(state) });
    log(`Saved public/data/${activeFile}.json`, 'good');
    await refreshDashboard();
  } catch (error) {
    log(`Save failed: ${error.message}`, 'bad');
  }
});

$('#validateBtn').addEventListener('click', async () => {
  try {
    await api(`/api/data/${activeFile}`, { method: 'POST', body: JSON.stringify(state) });
    const result = await api('/api/validate', { method: 'POST', body: '{}' });
    log(`Validation passed. Warnings: ${result.warnings?.length || 0}`, 'good');
    (result.warnings || []).forEach((warning) => log(warning, 'warn'));
  } catch (error) {
    log(`Validation failed: ${error.message}`, 'bad');
  }
});

$('#publishBtn').addEventListener('click', async () => {
  const message = prompt('Commit message', 'Resort update: data changes');
  if (!message) return;
  try {
    await api(`/api/data/${activeFile}`, { method: 'POST', body: JSON.stringify(state) });
    const status = await api('/api/status');
    log(`Git status before publish:\n${status.status || 'No changes listed yet.'}`);
    const result = await api('/api/publish', { method: 'POST', body: JSON.stringify({ message }) });
    log(`Publish result: ${result.step}\n${result.output || ''}`, 'good');
  } catch (error) {
    log(`Publish failed: ${error.message}`, 'bad');
  }
});

loadData(activeFile).catch((error) => log(error.message, 'bad'));
