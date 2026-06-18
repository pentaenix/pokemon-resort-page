/* Batch animation painter — Pokémon charbins, frame-by-frame, save & next. */
const QA_ANIM_KEY = 'spmk.pkg.quickAnimName';
const QA_FRAMES_KEY = 'spmk.pkg.quickAnimFrames';

const qaState = {
  animName: 'sleep',
  frameCount: 2,
  frameTimeMs: 400,
  activeFrame: 0,
  frameData: [],
  path: null,
  entry: null,
  walkSheetId: 'walk',
  missing: 0,
  editor: null,
  baseUrl: null,
  busy: false,
};

function qaPersistPrefs() {
  try {
    localStorage.setItem(QA_ANIM_KEY, qaState.animName);
    localStorage.setItem(QA_FRAMES_KEY, String(qaState.frameCount));
  } catch { /* ignore */ }
}

function qaLoadPrefs() {
  try {
    const n = localStorage.getItem(QA_ANIM_KEY);
    if (n) qaState.animName = n;
    const fc = Number(localStorage.getItem(QA_FRAMES_KEY));
    if (fc >= 1 && fc <= 4) qaState.frameCount = fc;
  } catch { /* ignore */ }
}

function openQuickAnimMode() {
  qaLoadPrefs();
  pkgState.panel = 'quickAnim';
  renderQuickAnim();
}

/** Open from Editor nav, sidebar, or anywhere outside the library list. */
async function goToPackageQuickAnim() {
  if (typeof state !== 'undefined') state.view = 'packages';
  if (typeof renderNav === 'function') renderNav();
  pkgState.panel = 'quickAnim';
  qaLoadPrefs();
  if (typeof renderPackagesView === 'function') await renderPackagesView();
  else openQuickAnimMode();
}

function bindQuickAnimEntrypoints(root = document) {
  root.querySelectorAll('[data-open-quick-anim]').forEach((btn) => {
    if (btn.dataset.qaBound) return;
    btn.dataset.qaBound = '1';
    btn.onclick = (e) => {
      e.preventDefault();
      goToPackageQuickAnim();
    };
  });
}

async function qaRefreshStats() {
  try {
    const stats = await api(`/api/packages/quick-anim/stats?anim=${encodeURIComponent(qaState.animName)}`);
    qaState.missing = stats.missing ?? 0;
    return stats;
  } catch (e) {
    toast(String(e.message || e));
    return null;
  }
}

function qaSaveActiveFrame() {
  if (!qaState.editor) return;
  const data = qaState.editor.getImageData();
  if (!data) return;
  while (qaState.frameData.length < qaState.frameCount) qaState.frameData.push(null);
  qaState.frameData[qaState.activeFrame] = data;
}

async function qaLoadFrame(index) {
  qaSaveActiveFrame();
  qaState.activeFrame = index;
  const stored = qaState.frameData[index];
  if (stored) {
    qaState.editor.loadImageData(stored);
    qaUpdateFrameTabs();
    return;
  }
  if (index === 0 && qaState.baseUrl) {
    await qaState.editor.loadBlobUrl(`${qaState.baseUrl}&t=${Date.now()}`);
    qaUpdateFrameTabs();
    return;
  }
  const prev = qaState.frameData[index - 1] || (index === 1 ? qaState.frameData[0] : null);
  if (prev) {
    qaState.editor.loadImageData(prev);
  } else if (qaState.baseUrl) {
    await qaState.editor.loadBlobUrl(`${qaState.baseUrl}&t=${Date.now()}`);
  }
  qaUpdateFrameTabs();
}

function qaUpdateFrameTabs() {
  $$('.qa-frame-tab').forEach((btn) => {
    const i = Number(btn.dataset.frame);
    btn.classList.toggle('primary', i === qaState.activeFrame);
    btn.classList.toggle('has-data', !!qaState.frameData[i]);
  });
  const label = $('#qaFrameLabel');
  if (label) label.textContent = `Frame ${qaState.activeFrame + 1} of ${qaState.frameCount}`;
}

async function qaLoadPokemon(entry) {
  if (!entry?.path) return;
  qaState.path = entry.path;
  qaState.entry = entry;
  qaState.walkSheetId = entry.walkSheetId || 'walk';
  qaState.frameData = [];
  qaState.activeFrame = 0;
  const walkQ = `walkSheet=${encodeURIComponent(qaState.walkSheetId)}`;
  qaState.baseUrl = `/api/packages/quick-anim/base-frame?path=${encodeURIComponent(entry.path)}&${walkQ}`;
  const title = $('#qaPokemonTitle');
  const sub = $('#qaPokemonSub');
  if (title) {
    const dex = entry.pokemonId != null ? `#${String(entry.pokemonId).padStart(3, '0')} ` : '';
    const form = entry.variantLabel && entry.variantLabel !== 'Default'
      ? ` · ${entry.variantLabel}`
      : '';
    title.textContent = `${dex}${entry.displayName || entry.id}${form}`;
  }
  if (sub) {
    const rem = entry.remaining ?? qaState.missing;
    const unit = rem === 1 ? 'slot' : 'slots';
    sub.textContent = `${rem} form ${unit} still need “${qaState.animName}” (down/south row only)`;
  }
  if (qaState.editor) {
    await qaState.editor.loadBlobUrl(`${qaState.baseUrl}&t=${Date.now()}`);
    qaUpdateFrameTabs();
  }
  setStatus(`Quick anim · ${entry.displayName || entry.id}`);
}

async function qaFetchNext(afterPath = '', afterWalkSheet = '') {
  const res = await api(
    `/api/packages/quick-anim/next?anim=${encodeURIComponent(qaState.animName)}&after=${encodeURIComponent(afterPath)}&afterWalkSheet=${encodeURIComponent(afterWalkSheet)}`,
  );
  if (res.done) {
    toast(`All Pokémon have “${qaState.animName}”`);
    qaState.path = null;
    qaState.entry = null;
    const title = $('#qaPokemonTitle');
    if (title) title.textContent = 'Done';
    $('#qaPokemonSub')?.replaceChildren();
    return null;
  }
  await qaLoadPokemon(res.entry);
  return res.entry;
}

async function qaStartOrResume() {
  qaState.animName = ($('#qaAnimName')?.value || 'sleep').trim().toLowerCase().replace(/\s+/g, '_');
  qaState.frameCount = Math.max(1, Math.min(4, Number($('#qaFrameCount')?.value) || 2));
  qaState.frameTimeMs = Math.max(50, Number($('#qaFrameTime')?.value) || 400);
  qaPersistPrefs();
  qaRenderFrameTabs();
  await qaRefreshStats();
  const entry = await qaFetchNext('');
  const work = $('#qaWork');
  const empty = $('#qaEmpty');
  if (entry) {
    work?.removeAttribute('hidden');
    empty?.setAttribute('hidden', '');
    const prevBtn = $('#qaOpenCharDetail');
    if (prevBtn) prevBtn.hidden = false;
  } else {
    work?.setAttribute('hidden', '');
    empty?.removeAttribute('hidden');
  }
}

async function qaApply(saveAndNext) {
  if (qaState.busy || !qaState.path) return;
  qaSaveActiveFrame();
  const blobs = [];
  for (let i = 0; i < qaState.frameCount; i++) {
    if (i === qaState.activeFrame && qaState.editor) {
      blobs.push(await qaState.editor.getPNGBlob());
    } else if (qaState.frameData[i]) {
      const c = document.createElement('canvas');
      c.width = qaState.frameData[i].width;
      c.height = qaState.frameData[i].height;
      c.getContext('2d').putImageData(qaState.frameData[i], 0, 0);
      blobs.push(await new Promise((r) => c.toBlob(r, 'image/png')));
    } else if (i === 0 && qaState.baseUrl) {
      const r = await fetch(`${qaState.baseUrl}&t=${Date.now()}`);
      blobs.push(await r.blob());
    } else {
      toast(`Frame ${i + 1} is empty`);
      return;
    }
  }
  qaState.busy = true;
  setSave('saving');
  try {
    const fd = new FormData();
    fd.append('path', qaState.path);
    fd.append('anim', qaState.animName);
    fd.append('walkSheet', qaState.walkSheetId || 'walk');
    fd.append('frameTimeMs', String(qaState.frameTimeMs));
    blobs.forEach((blob, i) => {
      if (blob) fd.append(`frame${i}`, blob, `frame${i}.png`);
    });
    const res = await fetch('/api/packages/quick-anim/apply', { method: 'POST', body: fd });
    if (!res.ok) throw new Error(await res.text());
    toast(`Saved ${qaState.animName} → ${qaState.entry?.displayName || 'Pokémon'}`);
    await loadPackageContext();
    if (saveAndNext) {
      const path = qaState.path;
      const walkSheet = qaState.walkSheetId;
      await qaRefreshStats();
      await qaFetchNext(path, walkSheet);
    }
  } catch (e) {
    toast(`Save failed: ${e.message || e}`);
  } finally {
    qaState.busy = false;
    setSave('ready');
  }
}

function qaRightPanelHtml() {
  return `<div class="sidecard card qa-help-card"><h3>Quick anim</h3>
    <p class="tiny">Fast pass over the whole Pokédex: edit frame 1, frame 2, then <b>Save &amp; next</b>. Each <b>walk form</b> gets its own sleep sheet (<code>sleep_42</code>, etc.).</p>
    <p class="tiny"><kbd>Ctrl</kbd>+<kbd>S</kbd> save · <kbd>Ctrl</kbd>+<kbd>Enter</kbd> save &amp; next · <kbd>N</kbd> skip</p>
    <button type="button" class="btn small full" id="qaOpenCharDetail" style="margin-top:8px" hidden>Preview in character view</button>
  </div>
  <div class="sidecard card qa-help-card"><h3>Active tool</h3>
    <p class="qa-tool-status" id="qaActiveTool">Tool: Pencil</p>
    <div class="qa-color-row">
      <span class="qa-color-swatch checker" id="qaColorPreview" title="Current color"></span>
      <span class="tiny" id="qaColorLabel">rgba(0,0,0,1)</span>
    </div>
  </div>
  <div class="sidecard card qa-help-card"><h3>Tools</h3>
    <dl class="qa-hotkey-list tiny">
      <dt><kbd>B</kbd></dt><dd>Pencil</dd>
      <dt><kbd>E</kbd></dt><dd>Eraser</dd>
      <dt><kbd>I</kbd></dt><dd>Pick color (eyedropper)</dd>
      <dt><kbd>G</kbd></dt><dd>Fill bucket</dd>
      <dt><kbd>S</kbd> / <kbd>M</kbd></dt><dd>Select — drag a box; drag inside to move pixels</dd>
    </dl>
    <p class="tiny qa-sel-hint">Click outside the selection to clear it.</p>
  </div>
  <div class="sidecard card qa-help-card"><h3>Editor hotkeys</h3>
    <dl class="qa-hotkey-list tiny">
      <dt><kbd>Esc</kbd></dt><dd>Clear selection</dd>
      <dt><kbd>↑↓←→</kbd></dt><dd>Nudge selection (<kbd>Shift</kbd> 4px)</dd>
      <dt><kbd>1</kbd>–<kbd>4</kbd></dt><dd>Switch frame</dd>
      <dt><kbd>Ctrl</kbd>+<kbd>Z</kbd></dt><dd>Undo · <kbd>Shift</kbd> redo</dd>
    </dl>
  </div>`;
}

function renderQuickAnim() {
  stopPkgAnims();
  title('Quick anim');
  toolbar(`<button class="btn" id="qaBack">← Library</button>`);

  $('#view').innerHTML = `
    <div class="qa-layout card">
      <div class="qa-setup row wrap">
        <div class="field"><label>Animation id</label>
          <input class="input" id="qaAnimName" value="${esc(qaState.animName)}" placeholder="sleep"></div>
        <div class="field"><label>Frames</label>
          <select class="select" id="qaFrameCount">
            ${[1, 2, 3, 4].map((n) => `<option value="${n}" ${n === qaState.frameCount ? 'selected' : ''}>${n}</option>`).join('')}
          </select></div>
        <div class="field"><label>ms / frame</label>
          <input class="input" id="qaFrameTime" type="number" min="50" max="2000" step="10" value="${qaState.frameTimeMs}"></div>
        <div class="field qa-setup-actions">
          <label>&nbsp;</label>
          <button type="button" class="btn primary" id="qaStart">${qaState.path ? 'Refresh queue' : 'Start queue'}</button>
        </div>
        <p class="tiny qa-setup-hint">Uses the <b>down (south)</b> pose from each <b>walk form</b>. Sleep is one row only. Queue visits every form (e.g. all Alcremie decorations). <kbd>1</kbd>/<kbd>2</kbd> switch frames.</p>
      </div>
      <div class="qa-work" id="qaWork" ${qaState.path ? '' : 'hidden'}>
        <div class="qa-head">
          <div><h3 id="qaPokemonTitle">—</h3><p class="tiny" id="qaPokemonSub"></p></div>
          <div class="qa-frame-tabs" id="qaFrameTabs"></div>
        </div>
        <div class="qa-main">
          <div class="card tools qa-tools" id="qaTools">
            ${[
    ['pencil', '✎', 'Pencil', 'B'],
    ['eraser', '⌫', 'Eraser', 'E'],
    ['picker', '⌖', 'Pick color', 'I'],
    ['fill', '▰', 'Fill', 'G'],
    ['select', '⧉', 'Select / move', 'S'],
  ].map(([id, ic, name, key]) =>
    `<button type="button" class="tool ${id === 'pencil' ? 'active' : ''}" data-px-tool="${id}" title="${name} (${key})"><span class="tool-ico">${ic}</span></button>`,
  ).join('')}
            <button type="button" class="btn small" id="qaUndo" title="Undo">↶</button>
            <button type="button" class="btn small" id="qaRedo" title="Redo">↷</button>
            <button type="button" class="btn small" id="qaClearSel" title="Clear selection">✕ sel</button>
            <button type="button" class="btn small" id="qaZoomOut">−</button>
            <button type="button" class="btn small" id="qaZoomIn">+</button>
            <button type="button" class="btn small" id="qaToggleGrid">Grid</button>
          </div>
          <div class="card stage editor-bg-darkchecker qa-stage">
            <canvas id="qaPixCanvas" class="pix-canvas transparent-canvas"></canvas>
          </div>
          <div class="card qa-side">
            <p class="tiny" id="qaFrameLabel">Frame 1</p>
            <canvas id="qaAnimPreview" class="preview-canvas checker editor-bg-darkchecker" width="96" height="96"></canvas>
            <div class="section-title">Palette</div>
            <div class="palette" id="qaPalette"></div>
            <div class="qa-actions col">
              <button type="button" class="btn good full" id="qaSaveNext">Save &amp; next ↵</button>
              <button type="button" class="btn primary full" id="qaSave">Save</button>
              <button type="button" class="btn full" id="qaSkip">Skip →</button>
              <button type="button" class="btn full" id="qaCopyBase">Reset frame from base</button>
            </div>
          </div>
        </div>
      </div>
      <div class="empty qa-empty" id="qaEmpty"${qaState.path ? ' hidden' : ''}>
        <strong>Quick anim batch</strong><br/>
        Enter an animation id (e.g. <code>sleep</code>), then <b>Start queue</b> to open the first Pokémon that does not have it yet.
        <span id="qaMissingHint"></span>
      </div>
    </div>`;

  right(qaRightPanelHtml());

  qaRenderFrameTabs();
  qaBindQuickAnim();
  bindQuickAnimEntrypoints();

  if (qaState.path && qaState.entry) {
    qaLoadPokemon(qaState.entry);
    const prevBtn = $('#qaOpenCharDetail');
    if (prevBtn) prevBtn.hidden = false;
  } else {
    qaRefreshStats().then(() => {
      const hint = $('#qaMissingHint');
      if (hint && qaState.missing) hint.textContent = ` (${qaState.missing} missing)`;
    });
  }
}

function qaRenderFrameTabs() {
  const host = $('#qaFrameTabs');
  if (!host) return;
  host.innerHTML = Array.from({ length: qaState.frameCount }, (_, i) =>
    `<button type="button" class="btn small qa-frame-tab${i === qaState.activeFrame ? ' primary' : ''}" data-frame="${i}">Frame ${i + 1}</button>`,
  ).join('');
  host.querySelectorAll('.qa-frame-tab').forEach((btn) => {
    btn.onclick = () => qaLoadFrame(Number(btn.dataset.frame));
  });
}

function qaBindQuickAnim() {
  $('#qaBack').onclick = () => {
    qaState.editor?.destroy();
    qaState.editor = null;
    pkgState.panel = 'list';
    renderPackages();
  };
  $('#qaStart').onclick = () => qaStartOrResume();
  $('#qaSave').onclick = () => qaApply(false);
  $('#qaSaveNext').onclick = () => qaApply(true);
  $('#qaSkip').onclick = async () => {
    if (!qaState.path) return;
    await qaFetchNext(qaState.path, qaState.walkSheetId);
  };
  $('#qaOpenCharDetail')?.addEventListener('click', async () => {
    if (!qaState.path) return;
    await api('/api/packages/draft/open-path', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: qaState.path }),
    });
    pkgState.selectedPath = qaState.path;
    pkgState.panel = 'detail';
    await loadPackageContext();
    const p = pkg();
    if (p && typeof pokemonSleepSheetIdForWalk === 'function') {
      pkgState.selectedSheetId = qaState.walkSheetId || 'walk';
    }
    renderPackages();
  });
  $('#qaCopyBase').onclick = async () => {
    if (!qaState.baseUrl) return;
    await qaState.editor?.loadBlobUrl(`${qaState.baseUrl}&t=${Date.now()}`);
    qaSaveActiveFrame();
  };

  if (qaState.editor) qaState.editor.destroy();
  qaState.editor = mountPixelEditor({
    canvas: $('#qaPixCanvas'),
    paletteEl: $('#qaPalette'),
    previewEl: $('#qaAnimPreview'),
    toolStatusEl: $('#qaActiveTool'),
    colorPreviewEl: $('#qaColorPreview'),
    colorLabelEl: $('#qaColorLabel'),
    toolsRoot: $('#qaTools'),
    zoom: 16,
    activeKey: true,
    isActive: () => pkgState.panel === 'quickAnim',
    onFrameShortcut: (i) => { if (i < qaState.frameCount) qaLoadFrame(i); },
    onUndoRedo: (canUndo, canRedo) => {
      const u = $('#qaUndo');
      const r = $('#qaRedo');
      if (u) u.disabled = !canUndo;
      if (r) r.disabled = !canRedo;
    },
  });
  qaState.editor.bindTools($('#qaTools'));

  if (!qaState._keysBound) {
    qaState._keysBound = true;
    window.addEventListener('keydown', (e) => {
      if (pkgState.panel !== 'quickAnim') return;
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        qaApply(true);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        qaApply(false);
      } else if (!e.ctrlKey && !e.metaKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        $('#qaSkip')?.click();
      }
    });
  }

  $('#qaFrameCount')?.addEventListener('change', (e) => {
    qaState.frameCount = Math.max(1, Math.min(4, Number(e.target.value) || 2));
    qaRenderFrameTabs();
    qaUpdateFrameTabs();
  });
}
