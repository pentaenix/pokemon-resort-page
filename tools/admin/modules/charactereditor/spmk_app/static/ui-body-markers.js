/* Body marker editor — head / eyes / hands boxes per facing (base walk sheet). */
const BM_DIRECTIONS = [
  ['south', 'Down'],
  ['west', 'Left'],
  ['east', 'Right'],
  ['north', 'Up'],
];

const bmState = {
  path: null,
  displayName: '',
  direction: 'south',
  markers: null,
  layout: { eyes: 2, hands: 2 },
  frameWidth: 32,
  frameHeight: 32,
  scale: 12,
  boxes: [],
  selectedId: null,
  busy: false,
  drag: null,
};

function bmNewId(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

function bmBoxesFromDirection(dm) {
  const out = [];
  if (dm?.head) out.push({ id: 'head', kind: 'head', ...dm.head });
  (dm?.eyes || []).forEach((r, i) => {
    out.push({ id: `eye-${i}`, kind: 'eye', ...r });
  });
  (dm?.hands || []).forEach((r, i) => {
    out.push({ id: `hand-${i}`, kind: 'hand', ...r });
  });
  return out;
}

function bmDirectionFromBoxes(boxes) {
  const headBox = boxes.find((b) => b.kind === 'head');
  return {
    head: headBox ? { x: headBox.x, y: headBox.y, w: headBox.w, h: headBox.h } : null,
    eyes: boxes.filter((b) => b.kind === 'eye').map(({ x, y, w, h }) => ({ x, y, w, h })),
    hands: boxes.filter((b) => b.kind === 'hand').map(({ x, y, w, h }) => ({ x, y, w, h })),
  };
}

function bmSyncBoxesToMarkers() {
  if (!bmState.markers) return;
  bmState.markers.directions[bmState.direction] = bmDirectionFromBoxes(bmState.boxes);
}

function bmCountKind(kind) {
  return bmState.boxes.filter((b) => b.kind === kind).length;
}

function bmCanAdd(kind) {
  if (kind === 'head') return bmCountKind('head') < 1;
  if (kind === 'eye') return bmCountKind('eye') < (bmState.layout?.eyes ?? 2);
  if (kind === 'hand') return bmCountKind('hand') < (bmState.layout?.hands ?? 2);
  return false;
}

function bmDefaultRect(kind) {
  const fw = bmState.frameWidth;
  const fh = bmState.frameHeight;
  if (kind === 'head') return { x: 6, y: 2, w: fw - 12, h: Math.max(6, Math.floor(fh * 0.4)) };
  if (kind === 'eye') {
    const n = bmCountKind('eye');
    const w = 4;
    const h = 3;
    const y = 6;
    if (n === 0) return { x: 8, y, w, h };
    return { x: fw - 8 - w, y, w, h };
  }
  const n = bmCountKind('hand');
  const w = 5;
  const h = 5;
  const y = fh - h - 2;
  if (n === 0) return { x: 2, y, w, h };
  return { x: fw - w - 2, y, w, h };
}

function bmAddBox(kind) {
  if (!bmCanAdd(kind)) {
    toast(`Limit reached for ${kind}`);
    return;
  }
  const r = bmDefaultRect(kind);
  const id = kind === 'head' ? 'head' : bmNewId(kind);
  if (kind === 'head') {
    bmState.boxes = bmState.boxes.filter((b) => b.kind !== 'head');
  }
  bmState.boxes.push({ id, kind, ...r });
  bmState.selectedId = id;
  bmSyncBoxesToMarkers();
  bmRenderOverlay();
  bmUpdateAddButtons();
}

function bmDeleteSelected() {
  if (!bmState.selectedId) return;
  if (bmState.selectedId === 'head') {
    bmState.boxes = bmState.boxes.filter((b) => b.kind !== 'head');
  } else {
    bmState.boxes = bmState.boxes.filter((b) => b.id !== bmState.selectedId);
  }
  bmState.selectedId = null;
  bmSyncBoxesToMarkers();
  bmRenderOverlay();
  bmUpdateAddButtons();
}

function bmApplyDirectionMarkers(dm) {
  bmState.boxes = bmBoxesFromDirection(dm || { head: null, eyes: [], hands: [] });
  bmState.selectedId = null;
  bmSyncBoxesToMarkers();
  bmRenderOverlay();
  bmUpdateAddButtons();
}

async function openBodyMarkers(path, displayName) {
  if (typeof state !== 'undefined') state.view = 'packages';
  if (typeof renderNav === 'function') renderNav();
  pkgLeaveListPanel();
  pkgState.panel = 'bodyMarkers';
  bmState.path = path || pkgState.selectedPath || null;
  bmState.displayName = displayName || '';
  bmState.direction = 'south';
  if (typeof renderPackagesView === 'function') await renderPackagesView();
  else renderBodyMarkers();
}

async function goToBodyMarkers() {
  await openBodyMarkers(null, '');
}

function bindBodyMarkersEntrypoints(root = document) {
  root.querySelectorAll('[data-open-body-markers]').forEach((btn) => {
    if (btn.dataset.bmBound) return;
    btn.dataset.bmBound = '1';
    btn.onclick = async (e) => {
      e.preventDefault();
      const path = btn.dataset.charbinPath || pkgState.selectedPath;
      const name = btn.dataset.charbinName || '';
      await openBodyMarkers(path, name);
    };
  });
}

function bmFrameUrl() {
  return `/api/packages/body-markers/frame?path=${encodeURIComponent(bmState.path)}&direction=${encodeURIComponent(bmState.direction)}&t=${Date.now()}`;
}

async function bmLoadDirection(dir) {
  if (!bmState.path) return;
  bmState.direction = dir;
  bmState.busy = true;
  try {
    const data = await api(
      `/api/packages/body-markers/load?path=${encodeURIComponent(bmState.path)}&direction=${encodeURIComponent(dir)}`,
    );
    bmState.markers = data.markers;
    bmState.layout = data.layout || { eyes: 2, hands: 2 };
    bmState.frameWidth = data.frameWidth || 32;
    bmState.frameHeight = data.frameHeight || 32;
    bmState.displayName = bmState.displayName || data.path?.split('/').pop()?.replace('.charbin', '') || '';
    let dm = data.markers?.directions?.[dir];
    if (!dm?.head && data.suggested) dm = data.suggested;
    bmApplyDirectionMarkers(dm);
    const img = $('#bmSprite');
    if (img) img.src = bmFrameUrl();
    $$('.bm-dir-tab').forEach((b) => b.classList.toggle('primary', b.dataset.dir === dir));
    const sub = $('#bmSub');
    if (sub) sub.textContent = `${data.directionLabel || dir} · pause frame · ${data.walkSheetId || 'walk'}`;
  } catch (e) {
    toast(String(e.message || e));
  } finally {
    bmState.busy = false;
  }
}

async function bmGuess() {
  if (!bmState.path) return;
  try {
    const data = await api('/api/packages/body-markers/guess', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: bmState.path, direction: bmState.direction }),
    });
    bmApplyDirectionMarkers(data.directionMarkers);
    toast('Applied auto-guess');
  } catch (e) {
    toast(String(e.message || e));
  }
}

async function bmSave() {
  if (!bmState.path || !bmState.markers) return;
  bmSyncBoxesToMarkers();
  bmState.busy = true;
  setSave('saving');
  try {
    await api('/api/packages/body-markers/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: bmState.path, markers: bmState.markers }),
    });
    toast('Body markers saved');
    await loadPackageContext();
  } catch (e) {
    toast(`Save failed: ${e.message || e}`);
  } finally {
    bmState.busy = false;
    setSave('ready');
  }
}

function bmStageMetrics() {
  const stage = $('#bmStageInner');
  if (!stage) return null;
  const rect = stage.getBoundingClientRect();
  const sc = bmState.scale;
  return { rect, sc, fw: bmState.frameWidth, fh: bmState.frameHeight };
}

function bmClientToCell(clientX, clientY) {
  const m = bmStageMetrics();
  if (!m) return { x: 0, y: 0 };
  const lx = clientX - m.rect.left;
  const ly = clientY - m.rect.top;
  return {
    x: Math.max(0, Math.min(m.fw - 1, Math.floor(lx / m.sc))),
    y: Math.max(0, Math.min(m.fh - 1, Math.floor(ly / m.sc))),
  };
}

function bmRenderOverlay() {
  const host = $('#bmOverlay');
  if (!host) return;
  const sc = bmState.scale;
  const kindClass = { head: 'bm-box-head', eye: 'bm-box-eye', hand: 'bm-box-hand' };
  const kindLabel = { head: 'Head', eye: 'Eye', hand: 'Hand' };
  host.innerHTML = bmState.boxes
    .map((b) => {
      const sel = b.id === bmState.selectedId ? ' selected' : '';
      return `<div class="bm-box ${kindClass[b.kind] || ''}${sel}" data-id="${esc(b.id)}" data-kind="${esc(b.kind)}"
        style="left:${b.x * sc}px;top:${b.y * sc}px;width:${b.w * sc}px;height:${b.h * sc}px">
        <span class="bm-box-label">${kindLabel[b.kind] || b.kind}</span>
        <span class="bm-resize-handle" data-resize="1"></span>
      </div>`;
    })
    .join('');
  host.querySelectorAll('.bm-box').forEach((el) => {
    el.onmousedown = (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const id = el.dataset.id;
      bmState.selectedId = id;
      const box = bmState.boxes.find((x) => x.id === id);
      if (!box) return;
      const cell = bmClientToCell(e.clientX, e.clientY);
      if (e.target.dataset.resize) {
        bmState.drag = { mode: 'resize', id, startX: cell.x, startY: cell.y, orig: { ...box } };
      } else {
        bmState.drag = { mode: 'move', id, offX: cell.x - box.x, offY: cell.y - box.y, orig: { ...box } };
      }
      bmRenderOverlay();
    };
  });
}

function bmOnPointerMove(e) {
  if (!bmState.drag) return;
  const box = bmState.boxes.find((b) => b.id === bmState.drag.id);
  if (!box) return;
  const cell = bmClientToCell(e.clientX, e.clientY);
  const fw = bmState.frameWidth;
  const fh = bmState.frameHeight;
  if (bmState.drag.mode === 'move') {
    const nx = Math.max(0, Math.min(fw - box.w, cell.x - bmState.drag.offX));
    const ny = Math.max(0, Math.min(fh - box.h, cell.y - bmState.drag.offY));
    box.x = nx;
    box.y = ny;
  } else {
    const ox = bmState.drag.orig.x;
    const oy = bmState.drag.orig.y;
    box.w = Math.max(1, Math.min(fw - ox, cell.x - ox + 1));
    box.h = Math.max(1, Math.min(fh - oy, cell.y - oy + 1));
  }
  bmSyncBoxesToMarkers();
  bmRenderOverlay();
}

function bmEndDrag() {
  bmState.drag = null;
}

function bmUpdateAddButtons() {
  ['head', 'eye', 'hand'].forEach((k) => {
    const btn = $(`#bmAdd${k.charAt(0).toUpperCase() + k.slice(1)}`);
    if (btn) btn.disabled = !bmCanAdd(k);
  });
  const del = $('#bmDelete');
  if (del) del.disabled = !bmState.selectedId;
}

function bmBindStage() {
  const stage = $('#bmStageInner');
  if (!stage || stage.dataset.bmBound) return;
  stage.dataset.bmBound = '1';
  stage.onmousedown = (e) => {
    if (e.target.closest('.bm-box')) return;
    bmState.selectedId = null;
    bmRenderOverlay();
    bmUpdateAddButtons();
  };
  window.addEventListener('mousemove', bmOnPointerMove);
  window.addEventListener('mouseup', bmEndDrag);
}

function bmRightPanelHtml() {
  const layout = bmState.layout || {};
  return `<div class="sidecard card bm-help-card"><h3>Body markers</h3>
    <p class="tiny">Rectangle anchors on the <b>base walk</b> sheet (pause frame per facing). Used later for accessories and auto sleep generation — not pixel painting here.</p>
    <p class="tiny">This facing: up to <b>1</b> head, <b>${layout.eyes ?? 0}</b> eye(s), <b>${layout.hands ?? 0}</b> hand(s).</p>
  </div>
  <div class="sidecard card bm-help-card"><h3>Kinds</h3>
    <ul class="tiny bm-legend">
      <li><span class="bm-swatch bm-swatch-head"></span> Head</li>
      <li><span class="bm-swatch bm-swatch-eye"></span> Eye</li>
      <li><span class="bm-swatch bm-swatch-hand"></span> Hand</li>
    </ul>
    <p class="tiny">Drag a box to move; drag the corner handle to resize. <kbd>Del</kbd> removes the selected box.</p>
  </div>`;
}

function renderBodyMarkers() {
  stopPkgAnims();
  title('Body markers');
  const hasPath = !!bmState.path;
  toolbar(`<button class="btn" id="bmBack">← Characters</button>
    ${hasPath ? '<button class="btn primary" id="bmSave">Save markers</button>' : ''}`);

  const dirTabs = BM_DIRECTIONS.map(
    ([k, label]) =>
      `<button type="button" class="btn small bm-dir-tab${k === bmState.direction ? ' primary' : ''}" data-dir="${k}">${label}</button>`,
  ).join('');

  const fw = bmState.frameWidth;
  const fh = bmState.frameHeight;
  const sc = bmState.scale;
  const stageW = fw * sc;
  const stageH = fh * sc;

  $('#view').innerHTML = `
    <div class="bm-layout card">
      <div class="bm-head row wrap">
        <div><h3 id="bmTitle">${hasPath ? esc(bmState.displayName || 'Pokémon') : 'Pick a Pokémon'}</h3>
          <p class="tiny" id="bmSub">${hasPath ? 'Loading…' : 'Open from a character or choose below.'}</p></div>
        <div class="bm-dir-tabs">${dirTabs}</div>
      </div>
      <div class="bm-work row wrap" ${hasPath ? '' : 'hidden'} id="bmWork">
        <div class="card bm-tools">
          <button type="button" class="btn small full" id="bmAddHead">+ Head</button>
          <button type="button" class="btn small full" id="bmAddEye">+ Eye</button>
          <button type="button" class="btn small full" id="bmAddHand">+ Hand</button>
          <button type="button" class="btn small full" id="bmGuess">Auto-guess</button>
          <button type="button" class="btn small bad full" id="bmDelete" disabled>Delete selected</button>
        </div>
        <div class="card stage editor-bg-darkchecker bm-stage-wrap">
          <div class="bm-stage" id="bmStageInner" style="width:${stageW}px;height:${stageH}px">
            <img id="bmSprite" class="bm-sprite" width="${stageW}" height="${stageH}" alt="" draggable="false"/>
            <div class="bm-overlay" id="bmOverlay"></div>
          </div>
        </div>
      </div>
      <div class="empty bm-empty" id="bmEmpty"${hasPath ? ' hidden' : ''}>
        <strong>Body markers</strong><br/>
        Mark head, eyes, and hands on each facing so accessories and generated sleep anims can attach correctly.
        <div class="bm-pick-list" id="bmPickList"></div>
      </div>
    </div>`;

  right(bmRightPanelHtml());

  $('#bmBack').onclick = () => pkgBackToList();
  $('#bmSave')?.addEventListener('click', () => bmSave());
  $('#bmAddHead')?.addEventListener('click', () => bmAddBox('head'));
  $('#bmAddEye')?.addEventListener('click', () => bmAddBox('eye'));
  $('#bmAddHand')?.addEventListener('click', () => bmAddBox('hand'));
  $('#bmGuess')?.addEventListener('click', () => bmGuess());
  $('#bmDelete')?.addEventListener('click', () => bmDeleteSelected());

  $$('.bm-dir-tab').forEach((btn) => {
    btn.onclick = () => bmLoadDirection(btn.dataset.dir);
  });

  if (!window._bmKeyBound) {
    window._bmKeyBound = true;
    document.addEventListener('keydown', (e) => {
      if (pkgState.panel !== 'bodyMarkers') return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (document.activeElement?.matches('input,textarea,select')) return;
        e.preventDefault();
        bmDeleteSelected();
      }
    });
  }

  bmBindStage();
  bindBodyMarkersEntrypoints();

  if (hasPath) {
    bmLoadDirection(bmState.direction);
  } else {
    bmRenderPickList();
  }
  bmUpdateAddButtons();
}

async function bmRenderPickList() {
  const host = $('#bmPickList');
  if (!host) return;
  await loadPackageContext();
  const entries = (pkgState.settings?.scannedPackages || [])
    .filter((e) => e.characterType === 'pokemon' && e.path && !e.error)
    .sort((a, b) => String(a.displayName || a.id).localeCompare(String(b.displayName || b.id)));
  if (!entries.length) {
    host.innerHTML = '<p class="tiny">No Pokémon charbins in the library path.</p>';
    return;
  }
  host.innerHTML = `<div class="bm-pick-grid">${entries
    .map(
      (e) =>
        `<button type="button" class="btn bm-pick-btn" data-path="${esc(e.path)}" data-name="${esc(e.displayName || e.id)}">${esc(e.displayName || e.id)}</button>`,
    )
    .join('')}</div>`;
  host.querySelectorAll('.bm-pick-btn').forEach((btn) => {
    btn.onclick = async () => {
      bmState.path = btn.dataset.path;
      bmState.displayName = btn.dataset.name;
      pkgState.selectedPath = bmState.path;
      renderBodyMarkers();
    };
  });
}
