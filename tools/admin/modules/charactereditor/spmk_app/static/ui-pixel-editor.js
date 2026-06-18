/* Minimal pixel editor for single-frame PNG editing (quick anim mode). */
const PX_TOOL_LABELS = {
  pencil: 'Pencil',
  eraser: 'Eraser',
  picker: 'Pick color',
  fill: 'Fill bucket',
  select: 'Select / move',
};

const PX_PICKER_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><path d="M4 3l13 13-2 2-5-5-6 6-3-3 3-3z" fill="#e0f2fe" stroke="#38bdf8" stroke-width="1.2"/></svg>',
)}") 2 22, crosshair`;

const PX_TOOL_CURSORS = {
  pencil: 'crosshair',
  eraser: 'cell',
  picker: PX_PICKER_CURSOR,
  fill: 'copy',
  select: 'default',
};

function pxColorCss(c) {
  const a = (c[3] ?? 255) / 255;
  return `rgba(${c[0]},${c[1]},${c[2]},${a})`;
}

function mountPixelEditor(opts) {
  const canvas = opts.canvas;
  if (!canvas) return null;
  const ctx = canvas.getContext('2d');
  const paletteEl = opts.paletteEl || null;
  const previewEl = opts.previewEl || null;
  const toolStatusEl = opts.toolStatusEl || null;
  const colorPreviewEl = opts.colorPreviewEl || null;
  const colorLabelEl = opts.colorLabelEl || null;
  const toolsRoot = opts.toolsRoot || null;
  const onStatus = typeof opts.onStatus === 'function' ? opts.onStatus : () => {};
  let zoom = opts.zoom || 14;
  let tool = 'pencil';
  let color = [0, 0, 0, 255];
  let grid = true;
  let undo = [];
  let redo = [];
  let off = null;
  let ox = null;
  let down = false;
  let keyHandler = null;

  let selection = null;
  let selBuffer = null;
  let dragMode = null;
  let marqueeStart = null;
  let movePos = null;
  let grabOffset = { x: 0, y: 0 };

  function syncColorUi() {
    const css = pxColorCss(color);
    if (colorPreviewEl) {
      colorPreviewEl.style.background = css;
      colorPreviewEl.title = css;
    }
    if (colorLabelEl) colorLabelEl.textContent = css;
  }

  function updateCanvasCursor(e) {
    if (!canvas || !off) return;
    if (tool === 'select' && selection && e) {
      const p = pos(e);
      if (pointInSelection(p.x, p.y)) {
        canvas.style.cursor = dragMode === 'move' ? 'grabbing' : 'move';
        return;
      }
      if (dragMode === 'marquee') {
        canvas.style.cursor = 'crosshair';
        return;
      }
    }
    if (dragMode === 'move') {
      canvas.style.cursor = 'grabbing';
      return;
    }
    canvas.style.cursor = PX_TOOL_CURSORS[tool] || 'default';
  }

  function syncToolUi() {
    const label = PX_TOOL_LABELS[tool] || tool;
    if (toolStatusEl) toolStatusEl.textContent = `Tool: ${label}`;
    if (toolsRoot) {
      toolsRoot.querySelectorAll('[data-px-tool]').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.pxTool === tool);
      });
    }
    syncColorUi();
    updateCanvasCursor();
    opts.onTool?.(tool);
  }

  function setupHiDpi(cssW, cssH) {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(cssW * dpr));
    canvas.height = Math.max(1, Math.floor(cssH * dpr));
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
  }

  function normalizeSel(x0, y0, x1, y1) {
    const x = Math.min(x0, x1);
    const y = Math.min(y0, y1);
    const x2 = Math.max(x0, x1);
    const y2 = Math.max(y0, y1);
    return {
      x,
      y,
      w: Math.max(1, x2 - x + 1),
      h: Math.max(1, y2 - y + 1),
    };
  }

  function clampSel(s) {
    if (!off || !s) return s;
    const w = Math.min(s.w, off.width);
    const h = Math.min(s.h, off.height);
    return {
      x: Math.max(0, Math.min(s.x, off.width - w)),
      y: Math.max(0, Math.min(s.y, off.height - h)),
      w,
      h,
    };
  }

  function pointInSelection(px, py) {
    if (!selection) return false;
    return px >= selection.x && px < selection.x + selection.w
      && py >= selection.y && py < selection.y + selection.h;
  }

  function clearSelection() {
    selection = null;
    selBuffer = null;
    movePos = null;
    dragMode = null;
    marqueeStart = null;
  }

  function clearRectPixels(rect) {
    const img = ox.getImageData(0, 0, off.width, off.height);
    const data = img.data;
    const w = off.width;
    for (let y = rect.y; y < rect.y + rect.h; y++) {
      for (let x = rect.x; x < rect.x + rect.w; x++) {
        const i = (y * w + x) * 4;
        data[i + 3] = 0;
      }
    }
    ox.putImageData(img, 0, 0);
  }

  function pasteBufferAt(buf, x, y) {
    const rect = clampSel({ x, y, w: buf.width, h: buf.height });
    ox.putImageData(buf, rect.x, rect.y);
    return rect;
  }

  function drawSelectionOverlay(rect, style = 'active') {
    if (!rect) return;
    const x = rect.x * zoom;
    const y = rect.y * zoom;
    const w = rect.w * zoom;
    const h = rect.h * zoom;
    ctx.save();
    ctx.fillStyle = style === 'move' ? 'rgba(125,211,252,.2)' : 'rgba(125,211,252,.14)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#7dd3fc';
    ctx.lineWidth = 2;
    ctx.setLineDash(style === 'move' ? [2, 2] : [5, 3]);
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.restore();
  }

  function drawFloatingBuffer() {
    if (!selBuffer || !movePos) return;
    const tmp = document.createElement('canvas');
    tmp.width = selBuffer.width;
    tmp.height = selBuffer.height;
    tmp.getContext('2d').putImageData(selBuffer, 0, 0);
    ctx.drawImage(
      tmp,
      movePos.x * zoom,
      movePos.y * zoom,
      selBuffer.width * zoom,
      selBuffer.height * zoom,
    );
    drawSelectionOverlay(
      { x: movePos.x, y: movePos.y, w: selBuffer.width, h: selBuffer.height },
      'move',
    );
  }

  function draw() {
    if (!off) return;
    const cssW = off.width * zoom;
    const cssH = off.height * zoom;
    setupHiDpi(cssW, cssH);
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.drawImage(off, 0, 0, cssW, cssH);
    if (grid && zoom >= 8) {
      ctx.strokeStyle = 'rgba(255,255,255,.16)';
      ctx.lineWidth = 1;
      for (let x = 0; x <= off.width; x++) {
        ctx.beginPath();
        ctx.moveTo(x * zoom + 0.5, 0);
        ctx.lineTo(x * zoom + 0.5, cssH);
        ctx.stroke();
      }
      for (let y = 0; y <= off.height; y++) {
        ctx.beginPath();
        ctx.moveTo(0, y * zoom + 0.5);
        ctx.lineTo(cssW, y * zoom + 0.5);
        ctx.stroke();
      }
    }
    if (dragMode === 'move') drawFloatingBuffer();
    else if (selection) drawSelectionOverlay(selection);
    drawPreview();
    const selHint = selection
      ? ` · selection ${selection.w}×${selection.h}`
      : '';
    onStatus(`Zoom ${zoom}× · ${off.width}×${off.height}px${selHint}`);
    opts.onUndoRedo?.(undo.length > 0, redo.length > 0);
  }

  function drawPreview() {
    if (!previewEl || !off) return;
    const pc = previewEl.getContext('2d');
    pc.imageSmoothingEnabled = false;
    pc.clearRect(0, 0, previewEl.width, previewEl.height);
    const sc = Math.max(1, Math.floor(Math.min(previewEl.width / off.width, previewEl.height / off.height)));
    pc.drawImage(
      off,
      Math.floor((previewEl.width - off.width * sc) / 2),
      Math.floor((previewEl.height - off.height * sc) / 2),
      off.width * sc,
      off.height * sc,
    );
  }

  function ensureBuffer(w, h) {
    if (off && off.width === w && off.height === h) return;
    off = document.createElement('canvas');
    off.width = w;
    off.height = h;
    ox = off.getContext('2d', { willReadFrequently: true });
    ox.imageSmoothingEnabled = false;
    undo = [];
    redo = [];
    clearSelection();
  }

  function markActiveSwatch() {
    if (!paletteEl) return;
    const key = color.join(',');
    let matched = false;
    paletteEl.querySelectorAll('.swatch').forEach((s) => {
      const on = s.dataset.c === key;
      s.classList.toggle('active', on);
      if (on) matched = true;
    });
    return matched;
  }

  function buildPalette(opts = {}) {
    if (!paletteEl || !ox) return;
    const keepColor = opts.keepColor === true;
    const data = ox.getImageData(0, 0, off.width, off.height).data;
    const map = new Map();
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 0) continue;
      const key = [data[i], data[i + 1], data[i + 2], data[i + 3]].join(',');
      map.set(key, (map.get(key) || 0) + 1);
    }
    const arr = [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 32);
    const activeKey = color.join(',');
    paletteEl.innerHTML = arr.map(([k]) => {
      const [r, g, b, a] = k.split(',').map(Number);
      const on = k === activeKey ? ' active' : '';
      return `<button type="button" class="swatch${on}" data-c="${k}" title="rgba(${r},${g},${b},${a})" style="background:rgba(${r},${g},${b},${a / 255})"></button>`;
    }).join('');
    if (!keepColor && arr[0]) color = arr[0][0].split(',').map(Number);
    paletteEl.querySelectorAll('.swatch').forEach((s) => {
      s.onclick = () => {
        color = s.dataset.c.split(',').map(Number);
        markActiveSwatch();
        syncColorUi();
        syncToolUi();
      };
    });
    markActiveSwatch();
    syncColorUi();
  }

  function snapshot() {
    if (!ox) return;
    undo.push(ox.getImageData(0, 0, off.width, off.height));
    if (undo.length > 50) undo.shift();
    redo = [];
    opts.onUndoRedo?.(undo.length > 0, redo.length > 0);
  }

  function restore(from, to) {
    if (!from.length) return;
    to.push(ox.getImageData(0, 0, off.width, off.height));
    ox.putImageData(from.pop(), 0, 0);
    clearSelection();
    draw();
    buildPalette();
  }

  function pos(e) {
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height || !off) return { x: 0, y: 0 };
    const x = (e.clientX - r.left) * (off.width / r.width);
    const y = (e.clientY - r.top) * (off.height / r.height);
    return {
      x: Math.floor(Math.max(0, Math.min(off.width - 1, x))),
      y: Math.floor(Math.max(0, Math.min(off.height - 1, y))),
    };
  }

  function put(x, y, c) {
    if (x < 0 || y < 0 || x >= off.width || y >= off.height) return;
    const d = ox.createImageData(1, 1);
    d.data.set(c);
    ox.putImageData(d, x, y);
  }

  function flood(x, y, c) {
    const w = off.width;
    const h = off.height;
    const img = ox.getImageData(0, 0, w, h);
    const data = img.data;
    const idx = (a, b) => (b * w + a) * 4;
    const start = [...data.slice(idx(x, y), idx(x, y) + 4)];
    if (start.every((v, i) => v === c[i])) return;
    const q = [[x, y]];
    const seen = new Set();
    while (q.length) {
      const [a, b] = q.pop();
      const key = `${a},${b}`;
      if (seen.has(key) || a < 0 || b < 0 || a >= w || b >= h) continue;
      const k = idx(a, b);
      if (!start.every((v, i) => data[k + i] === v)) continue;
      seen.add(key);
      c.forEach((v, i) => { data[k + i] = v; });
      q.push([a + 1, b], [a - 1, b], [a, b + 1], [a, b - 1]);
    }
    ox.putImageData(img, 0, 0);
  }

  function pickColorAt(e) {
    const p = pos(e);
    const d = ox.getImageData(p.x, p.y, 1, 1).data;
    color = [d[0], d[1], d[2], d[3]];
    buildPalette({ keepColor: true });
    syncToolUi();
    onStatus(`Picked ${pxColorCss(color)} at ${p.x},${p.y}`);
  }

  function paintStroke(e) {
    const p = pos(e);
    if (tool === 'eraser') put(p.x, p.y, [0, 0, 0, 0]);
    else if (tool === 'pencil') put(p.x, p.y, color);
    else if (tool === 'fill') flood(p.x, p.y, color);
    draw();
  }

  function onMouseDown(e) {
    const p = pos(e);
    if (tool === 'picker') {
      pickColorAt(e);
      return;
    }
    if (tool === 'select') {
      if (selection && pointInSelection(p.x, p.y)) {
        snapshot();
        selBuffer = ox.getImageData(selection.x, selection.y, selection.w, selection.h);
        clearRectPixels(selection);
        grabOffset = { x: p.x - selection.x, y: p.y - selection.y };
        movePos = { x: selection.x, y: selection.y };
        dragMode = 'move';
        down = true;
        draw();
        return;
      }
      clearSelection();
      dragMode = 'marquee';
      marqueeStart = p;
      selection = normalizeSel(p.x, p.y, p.x, p.y);
      down = true;
      draw();
      return;
    }
    if (selection && !pointInSelection(p.x, p.y)) clearSelection();
    down = true;
    snapshot();
    paintStroke(e);
  }

  function onMouseMove(e) {
    updateCanvasCursor(e);
    const p = pos(e);
    if (dragMode === 'marquee' && marqueeStart) {
      selection = clampSel(normalizeSel(marqueeStart.x, marqueeStart.y, p.x, p.y));
      draw();
      return;
    }
    if (dragMode === 'move' && selBuffer) {
      movePos = clampSel({
        x: p.x - grabOffset.x,
        y: p.y - grabOffset.y,
        w: selBuffer.width,
        h: selBuffer.height,
      });
      draw();
      return;
    }
    if (down) paintStroke(e);
  }

  function onMouseUp() {
    if (dragMode === 'marquee') {
      dragMode = null;
      marqueeStart = null;
      if (selection && (selection.w < 1 || selection.h < 1)) clearSelection();
      draw();
      down = false;
      return;
    }
    if (dragMode === 'move' && selBuffer && movePos) {
      selection = pasteBufferAt(selBuffer, movePos.x, movePos.y);
      selBuffer = null;
      movePos = null;
      dragMode = null;
      buildPalette();
      draw();
      down = false;
      return;
    }
    down = false;
  }

  canvas.onmousedown = onMouseDown;
  canvas.onmousemove = onMouseMove;
  canvas.onmouseleave = () => updateCanvasCursor();
  window.addEventListener('mouseup', onMouseUp);

  function loadFromImage(img) {
    ensureBuffer(img.width, img.height);
    ox.clearRect(0, 0, off.width, off.height);
    ox.drawImage(img, 0, 0);
    clearSelection();
    draw();
    buildPalette();
  }

  function loadBlobUrl(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => { loadFromImage(img); resolve(); };
      img.onerror = reject;
      img.src = url;
    });
  }

  function loadImageData(data) {
    ensureBuffer(data.width, data.height);
    ox.putImageData(data, 0, 0);
    clearSelection();
    draw();
    buildPalette();
  }

  function getImageData() {
    if (!ox) return null;
    return ox.getImageData(0, 0, off.width, off.height);
  }

  function getPNGBlob() {
    return new Promise((resolve) => {
      off.toBlob((b) => resolve(b), 'image/png');
    });
  }

  function setTool(t) {
    tool = t;
    if (t !== 'select') {
      dragMode = null;
      selBuffer = null;
      movePos = null;
    }
    syncToolUi();
    draw();
  }

  function setZoom(z) {
    zoom = Math.max(2, Math.min(40, z));
    draw();
  }

  function bindTools(root) {
    if (!root) return;
    root.querySelectorAll('[data-px-tool]').forEach((b) => {
      b.onclick = () => setTool(b.dataset.pxTool);
    });
    root.querySelector('#qaZoomIn')?.addEventListener('click', () => setZoom(zoom + 2));
    root.querySelector('#qaZoomOut')?.addEventListener('click', () => setZoom(zoom - 2));
    root.querySelector('#qaToggleGrid')?.addEventListener('click', () => { grid = !grid; draw(); });
    root.querySelector('#qaUndo')?.addEventListener('click', () => restore(undo, redo));
    root.querySelector('#qaRedo')?.addEventListener('click', () => restore(redo, undo));
    root.querySelector('#qaClearSel')?.addEventListener('click', () => {
      clearSelection();
      draw();
    });
    syncToolUi();
  }

  if (opts.activeKey) {
    keyHandler = (e) => {
      if (!opts.isActive?.()) return;
      if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      if (e.key === '1') opts.onFrameShortcut?.(0);
      if (e.key === '2') opts.onFrameShortcut?.(1);
      if (e.key === '3') opts.onFrameShortcut?.(2);
      if (e.key === '4') opts.onFrameShortcut?.(3);
      const k = e.key.toLowerCase();
      if (k === 'b') setTool('pencil');
      if (k === 'e') setTool('eraser');
      if (k === 'i') setTool('picker');
      if (k === 'g' || k === 'f') setTool('fill');
      if (k === 's' || k === 'm') setTool('select');
      if (k === 'escape') {
        clearSelection();
        draw();
      }
      if (selection && ['arrowleft', 'arrowright', 'arrowup', 'arrowdown'].includes(k)) {
        e.preventDefault();
        const step = e.shiftKey ? 4 : 1;
        snapshot();
        selBuffer = ox.getImageData(selection.x, selection.y, selection.w, selection.h);
        clearRectPixels(selection);
        let nx = selection.x;
        let ny = selection.y;
        if (k === 'arrowleft') nx -= step;
        if (k === 'arrowright') nx += step;
        if (k === 'arrowup') ny -= step;
        if (k === 'arrowdown') ny += step;
        selection = pasteBufferAt(selBuffer, nx, ny);
        selBuffer = null;
        draw();
        buildPalette();
      }
      if ((e.ctrlKey || e.metaKey) && k === 'z') {
        e.preventDefault();
        if (e.shiftKey) restore(redo, undo);
        else restore(undo, redo);
      }
    };
    window.addEventListener('keydown', keyHandler);
  }

  function destroy() {
    window.removeEventListener('mouseup', onMouseUp);
    if (keyHandler) window.removeEventListener('keydown', keyHandler);
    canvas.onmousedown = null;
    canvas.onmousemove = null;
  }

  syncToolUi();

  return {
    loadBlobUrl,
    loadImageData,
    getImageData,
    getPNGBlob,
    setTool,
    setZoom,
    bindTools,
    draw,
    destroy,
    clearSelection,
    get size() { return off ? { width: off.width, height: off.height } : null; },
    get currentTool() { return tool; },
  };
}
