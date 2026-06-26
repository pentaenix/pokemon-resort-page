function ensureDataEditorState(state) {
  if (!state.dataEditor) {
    state.dataEditor = {
      booted: false,
      loading: false,
      error: '',
      settings: null,
      resolvedPath: '',
      files: [],
      query: '',
      selectedFile: '',
      current: null,
      fileSearch: '',
      showAdvanced: false,
      settingsOpen: false,
      collapsedFolders: {},
      utilityModal: null,
      utilityState: {},
      returnScroll: null,
    };
  }
  return state.dataEditor;
}

const clone = (v) => JSON.parse(JSON.stringify(v));
const stable = (v) => JSON.stringify(v);
const pathParts = (p) => String(p || '').split('.').filter(Boolean);

function getAtPath(root, path, fallback = undefined) {
  if (!path) return fallback;
  let cur = root;
  for (const part of pathParts(path)) {
    if (cur == null || !Object.prototype.hasOwnProperty.call(cur, part)) return fallback;
    cur = cur[part];
  }
  return cur;
}

function numberAt(root, path, fallback = 0) {
  const value = getAtPath(root, path, fallback);
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeHexColor(value, fallback = '#ffffff') {
  const raw = String(value ?? '').trim();
  if (/^#[0-9a-f]{6}$/i.test(raw)) return raw;
  if (/^#[0-9a-f]{3}$/i.test(raw)) return `#${raw[1]}${raw[1]}${raw[2]}${raw[2]}${raw[3]}${raw[3]}`;
  return fallback;
}


function clamp01(n) { return Math.max(0, Math.min(1, Number(n) || 0)); }
function clamp255(n) { return Math.max(0, Math.min(255, Math.round(Number(n) || 0))); }
function hexToRgb(hex) {
  const full = normalizeHexColor(hex, '#ffffff').slice(1);
  return { r: parseInt(full.slice(0, 2), 16), g: parseInt(full.slice(2, 4), 16), b: parseInt(full.slice(4, 6), 16) };
}
function rgbToHex({ r, g, b }) {
  return `#${[r, g, b].map((v) => clamp255(v).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}
function rgbToHsl({ r, g, b }) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  const d = max - min;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return { h: h * 360, s, l };
}
function hslToRgb({ h, s, l }) {
  h = (((Number(h) || 0) % 360) + 360) % 360 / 360;
  s = clamp01(s); l = clamp01(l);
  if (s === 0) {
    const v = clamp255(l * 255);
    return { r: v, g: v, b: v };
  }
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return {
    r: clamp255(hue2rgb(p, q, h + 1 / 3) * 255),
    g: clamp255(hue2rgb(p, q, h) * 255),
    b: clamp255(hue2rgb(p, q, h - 1 / 3) * 255),
  };
}
function rotateHex(hex, degrees = 0) {
  const hsl = rgbToHsl(hexToRgb(hex));
  return rgbToHex(hslToRgb({ ...hsl, h: hsl.h + degrees }));
}
function adjustLightness(hex, amount = 0) {
  const hsl = rgbToHsl(hexToRgb(hex));
  return rgbToHex(hslToRgb({ ...hsl, l: clamp01(hsl.l + amount) }));
}
function extractHexColors(value, prefix = '') {
  const out = [];
  if (typeof value === 'string') {
    const matches = value.match(/#[0-9a-f]{3,8}\b/gi) || [];
    matches.forEach((hex) => out.push({ path: prefix, value: normalizeHexColor(hex) }));
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => out.push(...extractHexColors(item, `${prefix}.${index}`.replace(/^\./, ''))));
    return out;
  }
  if (value && typeof value === 'object') {
    Object.entries(value).forEach(([key, item]) => {
      if (!isCommentMetaKey(key)) out.push(...extractHexColors(item, prefix ? `${prefix}.${key}` : key));
    });
  }
  return out;
}
function uniqueHexEntries(entries = []) {
  const byKey = new Map();
  for (const item of entries) {
    const key = `${item.value}|${item.path}`;
    if (!byKey.has(key)) byKey.set(key, item);
  }
  return [...byKey.values()];
}

function setAtPath(root, path, value) {
  const parts = pathParts(path);
  let cur = root;
  for (let i = 0; i < parts.length - 1; i += 1) cur = cur[parts[i]];
  cur[parts[parts.length - 1]] = value;
}

function flattenLeaves(value, prefix = '') {
  if (Array.isArray(value)) {
    return [{
      path: prefix,
      value,
      kind: value.every((x) => x == null || ['string', 'number', 'boolean'].includes(typeof x)) ? 'array' : 'json',
    }];
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value);
    if (!keys.length) return [{ path: prefix, value, kind: 'json' }];
    return keys
      .filter((k) => !isCommentMetaKey(k))
      .flatMap((k) => flattenLeaves(value[k], prefix ? `${prefix}.${k}` : k));
  }
  return [{ path: prefix, value, kind: typeof value }];
}

function titleCaseWords(value = '') {
  return String(value)
    .replace(/\.json$/i, '')
    .split(/[._\-/\s]+/)
    .filter(Boolean)
    .map((part) => part ? part[0].toUpperCase() + part.slice(1) : part)
    .join(' ');
}
function prettyLabel(key = '') { return titleCaseWords(String(key).split('.').pop()); }
function prettyFileName(path = '') { return titleCaseWords(String(path).split('/').pop()); }
function prettyFolderName(folder = '') { return folder ? folder.split('/').map(titleCaseWords).join(' / ') : 'Root Configs'; }

function captureDataEditorScroll() {
  const panel = document.querySelector('.workbench-panel');
  const page = document.querySelector('.data-editor-page');
  const modalBody = document.querySelector('.data-modal-body');
  const modalTools = document.querySelector('.data-modal-tools');
  return {
    windowX: window.scrollX || 0,
    windowY: window.scrollY || 0,
    panelTop: panel?.scrollTop || 0,
    pageTop: page?.scrollTop || 0,
    modalBodyTop: modalBody?.scrollTop || 0,
    modalToolsTop: modalTools?.scrollTop || 0,
  };
}

function restoreDataEditorScroll(snapshot) {
  if (!snapshot) return;
  const apply = () => {
    const panel = document.querySelector('.workbench-panel');
    const page = document.querySelector('.data-editor-page');
    const modalBody = document.querySelector('.data-modal-body');
    const modalTools = document.querySelector('.data-modal-tools');
    if (panel) panel.scrollTop = snapshot.panelTop || 0;
    if (page) page.scrollTop = snapshot.pageTop || 0;
    if (modalBody) modalBody.scrollTop = snapshot.modalBodyTop || 0;
    if (modalTools) modalTools.scrollTop = snapshot.modalToolsTop || 0;
    if (snapshot.windowX || snapshot.windowY) window.scrollTo(snapshot.windowX || 0, snapshot.windowY || 0);
  };
  requestAnimationFrame(() => {
    apply();
    requestAnimationFrame(apply);
  });
}

async function renderPreservingDataEditorScroll(deps) {
  const snapshot = captureDataEditorScroll();
  await deps.render();
  restoreDataEditorScroll(snapshot);
}
function bytes(n = 0) { return n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`; }


function normalizeCommentName(value = '') {
  return String(value).replace(/[^a-z0-9]/gi, '').toLowerCase();
}
function isCommentMetaKey(key = '') {
  const text = String(key || '');
  if (!text.startsWith('_')) return false;
  return /^_(comment|comments|description|descriptions|note|notes)$/i.test(text)
    || /_?(comment|comments|description|descriptions|note|notes)$/i.test(text);
}
function commentTargetFromKey(key = '') {
  return String(key || '')
    .replace(/^_+/, '')
    .replace(/_?(comment|comments|description|descriptions|note|notes)$/i, '');
}
function commentValueToText(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return value.map(commentValueToText).filter(Boolean).join('\n');
  if (typeof value === 'object') {
    return Object.entries(value)
      .map(([key, val]) => `${titleCaseWords(key)}: ${commentValueToText(val)}`.trim())
      .filter(Boolean)
      .join('\n');
  }
  return String(value).trim();
}
function uniqueNotes(notes = []) {
  const seen = new Set();
  return notes
    .map((note) => String(note || '').trim())
    .filter((note) => {
      if (!note || seen.has(note)) return false;
      seen.add(note);
      return true;
    });
}
function objectLevelComment(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return '';
  for (const key of ['_comment', '_comments', '_description', '_descriptions', '_note', '_notes']) {
    if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
    const value = obj[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) continue;
    return commentValueToText(value);
  }
  return '';
}
function commentsBlockForPath(obj, key, fullPath, completePath = fullPath) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return [];
  const out = [];
  for (const blockKey of ['_comments', '_comment', '_descriptions', '_description', '_notes', '_note']) {
    const block = obj[blockKey];
    if (!block || typeof block !== 'object' || Array.isArray(block)) continue;
    for (const candidate of [completePath, fullPath, key]) {
      if (Object.prototype.hasOwnProperty.call(block, candidate)) out.push(commentValueToText(block[candidate]));
    }
  }
  return out;
}
function siblingCommentsForPath(obj, key, fullPath, completePath = fullPath) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return [];
  const out = commentsBlockForPath(obj, key, fullPath, completePath);
  const targetName = normalizeCommentName(key);
  const fullName = normalizeCommentName(fullPath);
  for (const [commentKey, commentValue] of Object.entries(obj)) {
    if (!isCommentMetaKey(commentKey)) continue;
    const target = commentTargetFromKey(commentKey);
    if (!target) continue;
    const normalizedTarget = normalizeCommentName(target);
    if (normalizedTarget === targetName || normalizedTarget === fullName) out.push(commentValueToText(commentValue));
  }
  return uniqueNotes(out);
}
function commentDescriptionForPath(root, path) {
  const parts = pathParts(path);
  let cur = root;
  const notes = [];
  for (let i = 0; i < parts.length; i += 1) {
    if (!cur || typeof cur !== 'object' || Array.isArray(cur)) break;
    const key = parts[i];
    const fullPath = parts.slice(0, i + 1).join('.');
    notes.push(...siblingCommentsForPath(cur, key, fullPath, path));
    cur = cur[key];
    if (i < parts.length - 1) {
      const objectNote = objectLevelComment(cur);
      if (objectNote) notes.push(objectNote);
    }
  }
  return uniqueNotes(notes).join('\n');
}
function rootCommentDescription(root) {
  return objectLevelComment(root);
}

function globToRegex(glob) {
  return new RegExp(`^${String(glob).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
}
function patternMatches(pattern, fieldPath) {
  if (pattern === fieldPath) return true;
  try { return globToRegex(pattern).test(fieldPath); } catch { return false; }
}
function modifierForField(current, fieldPath) {
  const defaults = current?.defaults || {};
  const fileMod = current?.modifier || {};
  let mod = {};
  for (const src of [defaults, fileMod]) {
    for (const [pattern, rule] of Object.entries(src.patterns || {})) {
      if (patternMatches(pattern, fieldPath)) mod = { ...mod, ...rule };
    }
  }
  if (defaults.fields?.[fieldPath]) mod = { ...mod, ...defaults.fields[fieldPath] };
  if (fileMod.fields?.[fieldPath]) mod = { ...mod, ...fileMod.fields[fieldPath] };
  return { ...mod, __path: fieldPath };
}
function groupMeta(current, id) {
  const groups = [...(current?.defaults?.groups || []), ...(current?.modifier?.groups || [])];
  return groups.find((g) => g.id === id) || { id, label: prettyLabel(id), order: 50 };
}
function inferWidget(value, mod = {}) {
  if (mod.widget) return mod.widget;
  const path = String(mod.__path || '').toLowerCase();
  const text = String(value ?? '').trim();
  if (typeof value === 'string' && (/^#[0-9a-f]{3,8}$/i.test(text) || /(^|[._-])(color|colour|tint|hex)$/i.test(path))) return 'color';
  if (Array.isArray(value)) return 'list';
  if (typeof value === 'boolean') return 'checkbox';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'string' && value.length > 90) return 'textarea';
  if (value && typeof value === 'object') return 'json';
  return 'text';
}
function valueTypeFor(value, mod = {}) {
  if (mod.valueType) return mod.valueType;
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (value && typeof value === 'object') return 'json';
  return 'string';
}
function optionHtml(options = [], selected, esc) {
  return options.map((o) => {
    const value = typeof o === 'object' ? o.value : o;
    const label = typeof o === 'object' ? (o.label ?? o.value) : o;
    return `<option value="${esc(value)}" ${String(value) === String(selected) ? 'selected' : ''}>${esc(label)}</option>`;
  }).join('');
}

function decodeModifierScalar(value, fallback) {
  if (value === undefined) return fallback;
  return value;
}
function maskScalarAttr(value, esc) {
  return esc(JSON.stringify(value));
}
function maskCellIsOn(cell, mod = {}, onValue = 1, offValue = 0) {
  if (typeof cell === 'string') {
    const onChar = String(mod.onChar ?? '#');
    const offChar = String(mod.offChar ?? '.');
    if (cell === onChar) return true;
    if (cell === offChar) return false;
    return !['', '0', '.', '_', '-', ' ', 'false', 'False'].includes(cell);
  }
  if (cell === onValue) return true;
  if (cell === offValue) return false;
  return Boolean(cell);
}
function maskGridConfig(value, mod = {}) {
  const format = mod.format || (Array.isArray(value) && value.every((row) => typeof row === 'string') ? 'strings' : Array.isArray(value) ? 'matrix' : 'strings');
  const onValue = decodeModifierScalar(mod.onValue, 1);
  const offValue = decodeModifierScalar(mod.offValue, 0);
  const onChar = String(mod.onChar ?? '#').slice(0, 1) || '#';
  const offChar = String(mod.offChar ?? '.').slice(0, 1) || '.';
  let rawRows = [];
  if (Array.isArray(value) && value.every((row) => typeof row === 'string')) rawRows = value.map((row) => [...row]);
  else if (Array.isArray(value) && value.every((row) => Array.isArray(row))) rawRows = value;
  else if (typeof value === 'string') rawRows = value.split(/\r?\n/).filter(Boolean).map((row) => [...row]);
  const inferredRows = rawRows.length || 8;
  const inferredCols = Math.max(1, ...rawRows.map((row) => row.length), 8);
  const rows = Math.max(1, Number(mod.rows ?? mod.height ?? inferredRows) || inferredRows);
  const columns = Math.max(1, Number(mod.columns ?? mod.cols ?? mod.width ?? inferredCols) || inferredCols);
  const cells = Array.from({ length: rows }, (_, r) => Array.from({ length: columns }, (_, c) => maskCellIsOn(rawRows[r]?.[c], mod, onValue, offValue)));
  return { rows, columns, cells, format, onValue, offValue, onChar, offChar };
}
function maskGridInputHtml(field, mod, common, esc) {
  const cfg = maskGridConfig(field.value, mod);
  const maxVisible = Number(mod.maxVisibleCells ?? 1024);
  const tooLarge = cfg.rows * cfg.columns > maxVisible;
  const cellsHtml = tooLarge
    ? `<p class="hint">This mask is ${cfg.columns}×${cfg.rows}, which is too large for the grid safety limit. Raise <code>maxVisibleCells</code> in the modifier to edit it visually.</p>`
    : `<div class="data-mask-grid" style="--mask-cols:${cfg.columns}">${cfg.cells.map((row, r) => row.map((on, c) => `<button type="button" class="data-mask-cell${on ? ' is-on' : ''}" data-mask-cell data-row="${r}" data-col="${c}" aria-pressed="${on ? 'true' : 'false'}" title="${r}, ${c}"></button>`).join('')).join('')}</div>`;
  return `<div class="data-mask-grid-wrap" data-mask-grid-wrap data-mask-target="${esc(field.path)}"><div class="data-mask-grid-head"><span>${cfg.columns} × ${cfg.rows}</span><small>${esc(mod.legend || 'Click cells to toggle black/white mask values.')}</small></div>${cellsHtml}<input type="hidden" ${common} data-mask-grid data-mask-format="${esc(cfg.format)}" data-mask-on-value="${maskScalarAttr(cfg.onValue, esc)}" data-mask-off-value="${maskScalarAttr(cfg.offValue, esc)}" data-mask-on-char="${esc(cfg.onChar)}" data-mask-off-char="${esc(cfg.offChar)}" value="${esc(JSON.stringify(cfg.cells))}"></div>`;
}
function serializeMaskGrid(field) {
  const cells = JSON.parse(field.value || '[]');
  const format = field.dataset.maskFormat || 'matrix';
  const onValue = JSON.parse(field.dataset.maskOnValue || '1');
  const offValue = JSON.parse(field.dataset.maskOffValue || '0');
  const onChar = field.dataset.maskOnChar || '#';
  const offChar = field.dataset.maskOffChar || '.';
  if (format === 'strings') return cells.map((row) => row.map((on) => on ? onChar : offChar).join(''));
  if (format === 'booleans') return cells.map((row) => row.map(Boolean));
  return cells.map((row) => row.map((on) => on ? onValue : offValue));
}

function fieldInputHtml(field, current, esc) {
  const { path, value } = field;
  const mod = modifierForField(current, path);
  const widget = inferWidget(value, mod);
  const valueType = valueTypeFor(value, mod);
  const disabled = mod.readonly ? ' disabled' : '';
  const common = `data-data-field="${esc(path)}" data-value-type="${esc(valueType)}"${disabled}`;
  const placeholder = mod.placeholder ? ` placeholder="${esc(mod.placeholder)}"` : '';
  if (widget === 'hidden' || mod.hidden) return '';
  if (['mask-grid', 'pixel-grid', 'bitmap', 'boolean-grid'].includes(widget)) return maskGridInputHtml(field, mod, common, esc);
  if (widget === 'select' || widget === 'dropdown') return `<select ${common}>${optionHtml(mod.options || [], value, esc)}</select>`;
  if (widget === 'radio') {
    return `<div class="data-radio-row">${(mod.options || []).map((o) => {
      const v = typeof o === 'object' ? o.value : o;
      const label = typeof o === 'object' ? (o.label ?? o.value) : o;
      return `<label><input type="radio" name="data-${esc(path)}" value="${esc(v)}" ${String(v) === String(value) ? 'checked' : ''} ${common}>${esc(label)}</label>`;
    }).join('')}</div>`;
  }
  if (widget === 'checkbox') return `<label class="data-switch"><input type="checkbox" ${common} ${value ? 'checked' : ''}><span></span></label>`;
  if (widget === 'slider' || widget === 'range') {
    const min = mod.min ?? 0, max = mod.max ?? 100, step = mod.step ?? 1;
    return `<div class="data-range-wrap"><input type="range" min="${esc(min)}" max="${esc(max)}" step="${esc(step)}" value="${esc(value)}" ${common}><input class="data-range-number" type="number" min="${esc(min)}" max="${esc(max)}" step="${esc(step)}" value="${esc(value)}" ${common}>${mod.unit ? `<span>${esc(mod.unit)}</span>` : ''}</div>`;
  }
  if (widget === 'knob') {
    const min = mod.min ?? 0, max = mod.max ?? 10, step = mod.step ?? 1;
    return `<div class="data-knob-wrap"><input class="data-knob" type="range" min="${esc(min)}" max="${esc(max)}" step="${esc(step)}" value="${esc(value)}" ${common}><strong>${esc(value)}${mod.unit ? esc(mod.unit) : ''}</strong></div>`;
  }
  if (widget === 'textarea') return `<textarea rows="${mod.rows || 4}" ${common}${placeholder}>${esc(value ?? '')}</textarea>`;
  if (['list', 'tags', 'key-list', 'keybind-list'].includes(widget)) {
    const text = Array.isArray(value) ? value.join('\n') : String(value ?? '');
    return `<textarea rows="${mod.rows || Math.min(8, Math.max(2, Array.isArray(value) ? value.length : 2))}" ${common} data-list-mode="${esc(widget)}"${placeholder}>${esc(text)}</textarea>`;
  }
  if (widget === 'json') return `<textarea rows="${mod.rows || 8}" ${common} data-json-editor>${esc(JSON.stringify(value, null, 2))}</textarea>`;
  if (['color', 'color-wheel', 'colour', 'colour-wheel'].includes(widget)) {
    const colorValue = normalizeHexColor(value);
    return `<div class="data-color-row"><input class="data-color-picker" type="color" value="${esc(colorValue)}" ${common} data-color-picker><input class="data-color-text" value="${esc(value ?? colorValue)}" ${common} data-color-text placeholder="#RRGGBB"><span class="data-color-swatch" style="background:${esc(colorValue)}"></span></div>`;
  }
  if (widget === 'asset' || widget === 'path') return `<div class="data-path-row"><input value="${esc(value ?? '')}" ${common}${placeholder}><button type="button" class="btn ghost small" data-copy-value="${esc(value ?? '')}">Copy</button></div>`;
  if (widget === 'number') {
    const min = mod.min != null ? ` min="${esc(mod.min)}"` : '';
    const max = mod.max != null ? ` max="${esc(mod.max)}"` : '';
    const step = mod.step != null ? ` step="${esc(mod.step)}"` : '';
    return `<input type="number" value="${esc(value ?? 0)}" ${common}${min}${max}${step}${placeholder}>`;
  }
  return `<input value="${esc(value ?? '')}" ${common}${placeholder}>`;
}
function fieldHtml(field, current, esc) {
  const mod = modifierForField(current, field.path);
  if (mod.hidden || mod.widget === 'hidden') return '';
  const label = mod.label || prettyLabel(field.path);
  const autoDescription = field.comment || commentDescriptionForPath(current?.data, field.path);
  const descriptions = uniqueNotes([autoDescription, mod.description]);
  const descriptionHtml = descriptions.length ? `<small class="data-field-description">${descriptions.map((d) => esc(d)).join('<br>')}</small>` : '';
  return `<label class="data-field${mod.advanced ? ' is-advanced' : ''}${mod.danger ? ' is-danger' : ''}" data-field-row="${esc(field.path)}"><span class="data-field-label"><strong>${esc(label)}</strong><code title="${esc(field.path)}">${esc(field.path)}</code></span>${descriptionHtml}${fieldInputHtml(field, current, esc)}${mod.warning ? `<em class="data-warning">${esc(mod.warning)}</em>` : ''}</label>`;
}
function diffPaths(a, b, prefix = '') {
  if (stable(a) === stable(b)) return [];
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) || Array.isArray(b)) return [prefix || '(root)'];
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
  return keys.flatMap((k) => diffPaths(a[k], b[k], prefix ? `${prefix}.${k}` : k));
}

function collectLayoutElements(value, prefix = '', out = []) {
  if (!value || typeof value !== 'object') return out;
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectLayoutElements(item, prefix ? `${prefix}.${index}` : String(index), out));
    return out;
  }
  const keys = Object.keys(value);
  const hasX = keys.includes('x') || keys.includes('left');
  const hasY = keys.includes('y') || keys.includes('top');
  const hasW = keys.includes('width') || keys.includes('w');
  const hasH = keys.includes('height') || keys.includes('h');
  if (hasX && hasY && (hasW || hasH)) {
    const base = prefix;
    out.push({
      label: titleCaseWords(base.split('.').pop() || 'Element'),
      x: `${base}.${keys.includes('x') ? 'x' : 'left'}`,
      y: `${base}.${keys.includes('y') ? 'y' : 'top'}`,
      width: hasW ? `${base}.${keys.includes('width') ? 'width' : 'w'}` : '',
      height: hasH ? `${base}.${keys.includes('height') ? 'height' : 'h'}` : '',
    });
  }
  for (const key of keys) collectLayoutElements(value[key], prefix ? `${prefix}.${key}` : key, out);
  return out;
}

function previewConfig(current) {
  const mod = current?.modifier || {};
  const preview = mod.preview || {};
  if (!preview.type && !preview.enabled) return null;
  const data = current.data || {};
  const width = numberAt(data, preview.widthPath, numberAt(data, 'window.virtual_width', numberAt(data, 'screen.width', numberAt(data, 'width', preview.defaultWidth || 1280))));
  const height = numberAt(data, preview.heightPath, numberAt(data, 'window.virtual_height', numberAt(data, 'screen.height', numberAt(data, 'height', preview.defaultHeight || 720))));
  const inferred = collectLayoutElements(data).slice(0, preview.maxElements || 16);
  const elements = (preview.elements?.length ? preview.elements : inferred).slice(0, preview.maxElements || 16);
  if (!elements.length) return null;
  return { ...preview, width: Math.max(1, width), height: Math.max(1, height), elements };
}

function previewMetric(data, spec, fallback = 0) {
  if (spec === undefined || spec === null || spec === '') return fallback;
  if (typeof spec === 'number') return Number.isFinite(spec) ? spec : fallback;
  const raw = getAtPath(data, spec, undefined);
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function previewElementStyle(data, cfg, el) {
  const w = Math.max(1, previewMetric(data, el.width ?? el.widthPath, el.defaultWidth || 120));
  const h = Math.max(1, previewMetric(data, el.height ?? el.heightPath, el.defaultHeight || 48));
  let x = previewMetric(data, el.x ?? el.leftPath, 0);
  let y = previewMetric(data, el.y ?? el.topPath, 0);

  if (el.xRatio !== undefined) x = previewMetric(data, el.xRatio, 0) * cfg.width;
  if (el.yRatio !== undefined) y = previewMetric(data, el.yRatio, 0) * cfg.height;
  if (el.centerXRatio !== undefined) x = previewMetric(data, el.centerXRatio, 0.5) * cfg.width - (w / 2);
  if (el.centerYRatio !== undefined) y = previewMetric(data, el.centerYRatio, 0.5) * cfg.height - (h / 2);
  if (el.centerX !== undefined || el.centerXPath !== undefined) x = previewMetric(data, el.centerX ?? el.centerXPath, cfg.width / 2) - (w / 2);
  if (el.centerY !== undefined || el.centerYPath !== undefined) y = previewMetric(data, el.centerY ?? el.centerYPath, cfg.height / 2) - (h / 2);
  if (el.bottomOffset !== undefined || el.bottomOffsetPath !== undefined) y = cfg.height - previewMetric(data, el.bottomOffset ?? el.bottomOffsetPath, 0) - h;

  const anchor = String(el.anchor || '').toLowerCase();
  if (anchor.includes('center') && el.centerX === undefined && el.centerXPath === undefined && el.centerXRatio === undefined) x -= w / 2;
  if ((anchor.includes('middle') || anchor === 'center') && el.centerY === undefined && el.centerYPath === undefined && el.centerYRatio === undefined) y -= h / 2;
  if (anchor.includes('right')) x -= w;
  if (anchor.includes('bottom') && el.bottomOffset === undefined && el.bottomOffsetPath === undefined) y -= h;

  const left = Math.max(0, Math.min(100, (x / cfg.width) * 100));
  const top = Math.max(0, Math.min(100, (y / cfg.height) * 100));
  const width = Math.max(2, Math.min(100, (w / cfg.width) * 100));
  const height = Math.max(2, Math.min(100, (h / cfg.height) * 100));
  return `left:${left}%;top:${top}%;width:${width}%;height:${height}%;`;
}

function previewHtml(current, esc) {
  const cfg = previewConfig(current);
  if (!cfg) return '';
  const data = current.data || {};
  return `<section class="data-preview-card" data-data-preview><div class="data-preview-copy"><strong>${esc(cfg.title || 'UI layout preview')}</strong><span>${esc(cfg.description || 'Live mockup for position, width, and height values. Save only when it looks right.')}</span></div><div class="data-preview-stage" style="aspect-ratio:${cfg.width}/${cfg.height}"><div class="data-preview-safe-area"></div>${cfg.elements.map((el, index) => `<div class="data-preview-el" data-preview-element="${index}" style="${previewElementStyle(data, cfg, el)}"><span>${esc(el.label || `Element ${index + 1}`)}</span></div>`).join('')}</div><div class="data-preview-ruler">${Math.round(cfg.width)} × ${Math.round(cfg.height)}</div></section>`;
}

function refreshDataPreview(current) {
  const host = document.querySelector('[data-data-preview]');
  const cfg = previewConfig(current);
  if (!host || !cfg) return;
  cfg.elements.forEach((el, index) => {
    const node = host.querySelector(`[data-preview-element="${index}"]`);
    if (node) node.style.cssText = previewElementStyle(current.data || {}, cfg, el);
  });
  const ruler = host.querySelector('.data-preview-ruler');
  if (ruler) ruler.textContent = `${Math.round(cfg.width)} × ${Math.round(cfg.height)}`;
}


function utilitiesForGroup(current, groupId) {
  const utilities = [...(current?.defaults?.utilities || []), ...(current?.modifier?.utilities || []), ...(current?.utilities || [])];
  const seen = new Set();
  return utilities
    .filter((utility) => utility && (utility.afterGroup === groupId || utility.placement?.afterGroup === groupId || utility.group === groupId))
    .filter((utility) => {
      const key = utility.id || utility.utility || utility.type || JSON.stringify(utility);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
}
function harmonyModeOffsets(mode = 'complementary') {
  const modes = {
    complementary: [0, 180],
    analogous: [0, -32, 32],
    split: [0, 150, 210],
    triad: [0, 120, 240],
    tetradic: [0, 90, 180, 270],
    monochrome: [0],
  };
  return modes[mode] || modes.complementary;
}
function harmonyModeLabel(mode = '') {
  return ({ complementary: 'Complementary', analogous: 'Analogous', split: 'Split Complement', triad: 'Triad', tetradic: 'Tetradic', monochrome: 'Monochrome', custom: 'Custom' })[mode] || titleCaseWords(mode || 'Complementary');
}
function angleToWheelPoint(angle) {
  // Keep the knob math aligned with the CSS conic-gradient. The rendered wheel
  // starts red on the left, then moves through yellow/green at the top,
  // cyan/blue on the right, and purple/magenta near the bottom/left. HSL hue 0
  // is red, so hue 0 must map to the left edge, not the top edge.
  const rad = (((Number(angle) || 0) + 180) % 360) * Math.PI / 180;
  const radius = 46;
  return { x: 50 + Math.cos(rad) * radius, y: 50 + Math.sin(rad) * radius };
}
function hueFromWheelEvent(event, wheel) {
  const rect = wheel.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const dx = event.clientX - cx;
  const dy = event.clientY - cy;
  const angleFromRight = Math.atan2(dy, dx) * 180 / Math.PI;
  // Inverse of angleToWheelPoint: left edge -> red / hue 0.
  return ((angleFromRight - 180) % 360 + 360) % 360;
}
function colorToolState(de, utility, current) {
  const id = utility.id || utility.utility || utility.type || 'color-harmony';
  const colors = uniqueHexEntries(extractHexColors(current.data || {}));
  const stored = de.utilityState?.[id] || {};
  const fallback = utility.defaultColor || colors[0]?.value || '#6D5DFC';
  const base = normalizeHexColor(stored.baseColor || fallback, '#6D5DFC');
  const baseHsl = rgbToHsl(hexToRgb(base));
  const mode = stored.mode || utility.mode || 'complementary';
  const selected = Number.isInteger(stored.selectedKnob) ? stored.selectedKnob : 0;
  const sat = typeof stored.saturation === 'number' ? clamp01(stored.saturation) : baseHsl.s;
  const light = typeof stored.lightness === 'number' ? clamp01(stored.lightness) : baseHsl.l;
  let hues = Array.isArray(stored.customHues) && stored.customHues.length
    ? stored.customHues.map((h) => ((Number(h) || 0) % 360 + 360) % 360)
    : harmonyModeOffsets(mode).map((offset) => (baseHsl.h + offset + 360) % 360);
  if (mode === 'monochrome') hues = [baseHsl.h, baseHsl.h, baseHsl.h, baseHsl.h];
  const items = hues.map((h, index) => {
    let s = sat;
    let l = light;
    if (mode === 'monochrome') {
      l = clamp01([light - 0.24, light - 0.08, light + 0.1, light + 0.24][index] ?? light);
    }
    const label = index === 0 ? 'Base' : mode === 'custom' ? `Knob ${index + 1}` : `${harmonyModeLabel(mode)} ${index}`;
    return { label, hue: h, saturation: s, lightness: l, value: rgbToHex(hslToRgb({ h, s, l })) };
  });
  const safeSelected = Math.max(0, Math.min(items.length - 1, selected));
  return { id, colors, base, baseHsl, mode, selected: safeSelected, sat, light, items };
}
function colorHarmonyToolHtml(utility, current, esc) {
  const de = window.__dataEditorRenderState || {};
  const state = colorToolState(de, utility, current);
  const selected = state.items[state.selected] || state.items[0];
  const modeButtons = ['complementary', 'analogous', 'split', 'triad', 'tetradic', 'monochrome']
    .map((mode) => `<button type="button" class="${state.mode === mode ? 'active' : ''}" data-color-harmony-mode="${esc(mode)}" data-utility-id="${esc(state.id)}">${esc(harmonyModeLabel(mode))}</button>`)
    .join('');
  const knobs = state.items.map((item, index) => {
    const pt = angleToWheelPoint(item.hue);
    const active = index === state.selected ? ' active' : '';
    return `<button type="button" class="data-color-wheel-knob${active}" data-color-wheel-knob="${index}" data-utility-id="${esc(state.id)}" style="--x:${pt.x.toFixed(3)}%;--y:${pt.y.toFixed(3)}%;--knob-color:${esc(item.value)}" title="${esc(`${item.label}: ${item.value}`)}"><span>${index + 1}</span></button>`;
  }).join('');
  const selectedRows = state.items.map((item, index) => colorSwatchButtonHtml({ ...item, label: `${index + 1}. ${item.label}` }, esc, index === state.selected ? 'is-featured' : '')).join('');
  const configRows = state.colors.slice(0, 80).map((item) => colorSwatchButtonHtml(item, esc)).join('') || '<p class="hint">No literal hex colors found in this config yet. Use the wheel to choose colors, then paste copied hex values into real fields.</p>';
  return `<section class="data-inline-tool data-color-harmony-tool" data-color-tool="${esc(state.id)}">
    <div class="data-inline-tool-head"><div><strong>${esc(utility.title || 'Color Harmony Tool')}</strong><p>${esc(utility.description || 'Pick a base color, move harmony knobs around the wheel, and copy exact hex values into any field you want.')}</p></div><span>Inline tool</span></div>
    <div class="data-color-harmony-layout">
      <div class="data-color-wheel-panel">
        <div class="data-color-wheel" data-color-wheel="${esc(state.id)}" role="application" aria-label="Color harmony wheel">${knobs}<div class="data-color-wheel-center"><b>${esc(selected?.value || state.base)}</b><small>${esc(selected?.label || 'Selected')}</small></div></div>
        <div class="data-harmony-modes" role="group" aria-label="Color harmony modes">${modeButtons}</div>
        <p class="hint">Drag the base knob to rotate the whole harmony. Drag any other knob to make a custom harmony.</p>
      </div>
      <div class="data-color-harmony-side">
        <div class="data-selected-color-card">
          <span class="data-selected-color-chip" role="button" tabindex="0" data-copy-value="${esc(selected?.value || state.base)}" title="Copy ${esc(selected?.value || state.base)}" style="background:${esc(selected?.value || state.base)}"></span>
          <div><strong>${esc(selected?.label || 'Selected color')}</strong><code id="dataSelectedHarmonyHex">${esc(selected?.value || state.base)}</code></div>
          <button type="button" class="btn ghost small data-selected-copy-btn" data-copy-value="${esc(selected?.value || state.base)}" title="Copy selected hex">Copy hex</button>
        </div>
        <div class="data-color-base"><label><span>Selected color</span><input type="color" data-color-selected-picker="${esc(state.id)}" value="${esc(selected?.value || state.base)}"></label><label><span>Hex</span><input data-color-selected-hex="${esc(state.id)}" value="${esc(selected?.value || state.base)}" spellcheck="false"></label></div>
        <div class="data-harmony-sliders"><label>Saturation <input type="range" min="0" max="100" value="${Math.round(state.sat * 100)}" data-color-harmony-sat="${esc(state.id)}"><b>${Math.round(state.sat * 100)}%</b></label><label>Lightness <input type="range" min="0" max="100" value="${Math.round(state.light * 100)}" data-color-harmony-light="${esc(state.id)}"><b>${Math.round(state.light * 100)}%</b></label></div>
      </div>
    </div>
    <details class="data-harmony-results" open><summary>Harmony colors</summary><div class="data-color-copy-grid">${selectedRows}</div></details>
    <details class="data-harmony-results"><summary>Existing hex values in this config</summary><div class="data-color-copy-grid">${configRows}</div></details>
  </section>`;
}
function utilityBlockHtml(utility, current, esc) {
  const type = utility.type || utility.kind || utility.utility || '';
  if (['color-tools', 'color-modal', 'color-workshop', 'color-harmony', 'color-wheel'].includes(type)) {
    return colorHarmonyToolHtml(utility, current, esc);
  }
  return `<section class="data-inline-tool"><div class="data-inline-tool-head"><div><strong>${esc(utility.title || 'Tool')}</strong><p>${esc(utility.description || 'Custom inline tool block.')}</p></div><span>Inline tool</span></div></section>`;
}
function utilityBlocksAfterGroupHtml(current, groupId, esc) {
  return utilitiesForGroup(current, groupId).map((utility) => utilityBlockHtml(utility, current, esc)).join('');
}
function utilityById(current, id) {
  const utilities = [...(current?.defaults?.utilities || []), ...(current?.modifier?.utilities || []), ...(current?.utilities || [])];
  return utilities.find((utility) => String(utility.id || utility.utility || utility.type) === String(id));
}
function colorSwatchButtonHtml(item, esc, extraClass = '') {
  const label = item.label || item.name || item.path || item.value;
  const value = normalizeHexColor(item.value, item.value);
  return `<button type="button" class="data-color-copy ${esc(extraClass)}" data-copy-value="${esc(value)}" title="Copy ${esc(value)}"><span class="data-color-copy-swatch" style="background:${esc(value)}"></span><b>${esc(label)}</b><code>${esc(value)}</code><em aria-hidden="true">Copy</em></button>`;
}

function formHtml(de, esc) {
  const current = de.current;
  if (!current) return '';
  window.__dataEditorRenderState = de;
  if (current.rawMode) return `<div class="data-raw-editor"><textarea id="dataRawText" spellcheck="false">${esc(current.draftRaw ?? current.rawText ?? JSON.stringify(current.data, null, 2))}</textarea></div>`;
  const q = (de.fileSearch || '').trim().toLowerCase();
  const leaves = flattenLeaves(current.data)
    .map((f) => ({ ...f, mod: modifierForField(current, f.path), comment: commentDescriptionForPath(current.data, f.path) }))
    .filter((f) => !f.mod.hidden && f.mod.widget !== 'hidden')
    .filter((f) => de.showAdvanced || !f.mod.advanced)
    .filter((f) => !q || `${f.path} ${f.mod.label || ''} ${f.mod.description || ''} ${f.comment || ''}`.toLowerCase().includes(q));
  const buckets = new Map();
  for (const f of leaves) {
    const id = f.mod.group || f.path.split('.')[0] || 'root';
    if (!buckets.has(id)) buckets.set(id, []);
    buckets.get(id).push(f);
  }
  const utilityGroups = new Set();
  for (const utility of [...(current?.defaults?.utilities || []), ...(current?.modifier?.utilities || []), ...(current?.utilities || [])]) {
    const id = utility?.afterGroup || utility?.placement?.afterGroup || utility?.group;
    if (id) utilityGroups.add(id);
  }
  for (const id of utilityGroups) {
    if (!buckets.has(id) && (!q || String(id).toLowerCase().includes(q))) buckets.set(id, []);
  }
  const sections = [...buckets.entries()]
    .map(([id, fields]) => ({ meta: groupMeta(current, id), fields }))
    .sort((a, b) => (a.meta.order ?? 50) - (b.meta.order ?? 50) || a.meta.label.localeCompare(b.meta.label));
  if (!sections.length) return '<p class="hint">No visible fields match this filter. Turn on advanced fields or clear search.</p>';
  const preview = previewHtml(current, esc);
  const rootComment = rootCommentDescription(current.data);
  const rootNote = rootComment ? `<section class="data-comment-note"><strong>Config note</strong><p>${esc(rootComment)}</p></section>` : '';
  return preview + rootNote + sections.map(({ meta, fields }) => {
    fields.sort((a, b) => (a.mod.order ?? 1000) - (b.mod.order ?? 1000) || a.path.localeCompare(b.path));
    const sectionHtml = `<details class="data-section" open><summary><span><strong>${esc(meta.label || meta.id)}</strong>${meta.description ? `<small>${esc(meta.description)}</small>` : ''}</span><b>${fields.length}</b></summary><div class="data-field-grid">${fields.map((f) => fieldHtml(f, current, esc)).join('')}</div></details>`;
    return sectionHtml + utilityBlocksAfterGroupHtml(current, meta.id, esc);
  }).join('');
}

function modalHtml(de, esc) {
  const c = de.current;
  if (!c) return '';
  const mod = c.modifier || {};
  const title = mod.title || prettyFileName(c.file);
  const changed = diffPaths(c.original, c.data);
  return `<div class="data-modal-backdrop" data-data-close></div><section class="data-modal" role="dialog" aria-modal="true" aria-label="${esc(title)}"><header class="data-modal-head"><div><button type="button" class="data-modal-back" data-data-close>← Back to configs</button><h2>${esc(title)}</h2><p>${esc(mod.description || prettyFileName(c.file))}</p></div><div class="data-modal-actions"><button type="button" class="btn ghost" id="dataFormatRaw" ${c.rawMode ? '' : 'hidden'}>Format JSON</button><button type="button" class="btn ghost" id="dataRevert" ${c.dirty ? '' : 'disabled'}>Revert</button><button type="button" class="btn" id="dataSave">Save</button></div></header><div class="data-modal-tools"><label class="data-search-field"><span>Find field</span><input id="dataFieldSearch" value="${esc(de.fileSearch || '')}" placeholder="title, transfer, color…"></label><label class="data-checkline"><input type="checkbox" id="dataAdvanced" ${de.showAdvanced ? 'checked' : ''}> Show advanced fields</label><div class="data-view-tabs"><button type="button" data-data-mode="guided" class="${!c.rawMode ? 'active' : ''}">Editor</button><button type="button" data-data-mode="raw" class="${c.rawMode ? 'active' : ''}">JSON Text</button></div><span class="data-dirty-pill${c.dirty ? ' is-dirty' : ''}">${c.dirty ? `${changed.length} changed` : 'Saved snapshot'}</span></div><main class="data-modal-body">${formHtml(de, esc)}</main><footer class="data-modal-foot"><span>${esc(c.file)} · ${bytes(c.stats?.size || 0)}</span><span id="dataSaveStatus">${c.lastSaveMessage ? esc(c.lastSaveMessage) : ''}</span></footer></section>`;
}

function fileCardHtml(file, de, esc) {
  const active = de.selectedFile === file.path ? ' active' : '';
  const errored = file.parseError ? ' has-error' : '';
  const title = file.title || prettyFileName(file.path);
  const status = file.hasModifier ? 'Customized' : 'Standard';
  const subtitle = file.description || 'JSON config';
  const modifierTitle = file.modifierSource ? ` title="Modifier: ${esc(file.modifierSource)}"` : '';
  return `<button type="button" class="data-card${active}${errored}" data-data-file="${esc(file.path)}" title="${esc(file.path)}"><span class="data-card-top"><b${modifierTitle}>${status}</b>${file.parseError ? '<em>Invalid JSON</em>' : '<em>Editable JSON</em>'}</span><strong>${esc(title)}</strong><small>${esc(subtitle)}</small><span class="data-card-meta"><span>${file.fieldCount || 0} fields</span><span>${bytes(file.size)}</span></span>${file.tags?.length ? `<span class="data-tags">${file.tags.slice(0, 3).map((tag) => `<i>${esc(tag)}</i>`).join('')}</span>` : ''}</button>`;
}

function isFolderCollapsed(de, folder) {
  return Boolean(de.collapsedFolders?.[folder]);
}
function countFolderFiles(node) {
  let count = node.files.length;
  for (const child of node.children.values()) count += countFolderFiles(child);
  return count;
}
function buildFolderTree(files) {
  const root = { name: '', path: '', files: [], children: new Map() };
  for (const file of files) {
    const parts = String(file.folder || '').split('/').filter(Boolean);
    let node = root;
    let path = '';
    for (const part of parts) {
      path = path ? `${path}/${part}` : part;
      if (!node.children.has(part)) node.children.set(part, { name: part, path, files: [], children: new Map() });
      node = node.children.get(part);
    }
    node.files.push(file);
  }
  return root;
}
function folderNodeHtml(node, de, esc, depth = 0) {
  const children = [...node.children.values()].sort((a, b) => prettyFolderName(a.name).localeCompare(prettyFolderName(b.name)));
  const files = [...node.files].sort((a, b) => (a.title || prettyFileName(a.path)).localeCompare(b.title || prettyFileName(b.path)));
  const filesHtml = files.length ? `<div class="data-card-grid">${files.map((f) => fileCardHtml(f, de, esc)).join('')}</div>` : '';
  const childrenHtml = children.map((child) => folderNodeHtml(child, de, esc, depth + 1)).join('');
  if (!node.path) return `${filesHtml}${childrenHtml}`;
  const collapsed = isFolderCollapsed(de, node.path);
  const count = countFolderFiles(node);
  return `<section class="data-folder-section" data-folder-path="${esc(node.path)}" style="--data-folder-depth:${depth}"><button type="button" class="data-folder-head" data-data-folder-toggle="${esc(node.path)}" aria-expanded="${collapsed ? 'false' : 'true'}"><span class="data-folder-title"><i>${collapsed ? '▸' : '▾'}</i><strong>${esc(titleCaseWords(node.name))}</strong></span><span>${count} file${count === 1 ? '' : 's'}</span></button>${collapsed ? '' : `<div class="data-folder-content">${filesHtml}${childrenHtml}</div>`}</section>`;
}
function folderSectionsHtml(files, de, esc) {
  const tree = buildFolderTree(files);
  const html = folderNodeHtml(tree, de, esc, 0);
  return html || '<p class="hint">No JSON files found in the configured folder.</p>';
}

export async function initEditorTab(state, api) {
  const de = ensureDataEditorState(state);
  if (de.booted || de.loading) return;
  de.loading = true;
  de.error = '';
  try {
    const settings = await api('/api/data-editor/settings');
    const listing = await api('/api/data-editor/files');
    de.settings = settings.settings;
    de.resolvedPath = listing.resolvedPath || settings.resolvedPath || '';
    de.files = listing.files || [];
    de.booted = true;
  } catch (e) { de.error = e.message; }
  finally { de.loading = false; }
}

export function editorHtml(state, esc) {
  const de = ensureDataEditorState(state);
  const q = (de.query || '').trim().toLowerCase();
  const files = (de.files || []).filter((f) => !q || `${f.path} ${f.title || ''} ${f.description || ''} ${(f.tags || []).join(' ')}`.toLowerCase().includes(q));
  return `<section class="data-editor-page"><section class="toolbar data-editor-commandbar"><div class="data-editor-brand"><button type="button" class="workbench-menu-btn" id="workbenchExit">← Game Engine</button><span class="data-editor-title">Data Editor</span><span class="data-dir-chip" title="${esc(de.resolvedPath || '')}">${esc(de.settings?.configDirectory || 'pokemon-resort/config')}</span></div><div class="actions"><button type="button" class="btn ghost" id="dataSettingsToggle">Settings</button><button type="button" class="btn ghost" id="dataRefresh">Refresh</button></div></section>${de.error ? `<section class="panel data-error"><h2>Could not load configs</h2><p>${esc(de.error)}</p></section>` : ''}${de.settingsOpen ? `<section class="panel data-settings-panel"><h3>Config source</h3><p class="hint">Relative paths resolve from the parent workspace that contains both repos.</p><div class="row"><label>Config directory<input id="dataConfigDirectory" value="${esc(de.settings?.configDirectory || 'pokemon-resort/config')}"></label><label>Backup directory<input id="dataBackupDirectory" value="${esc(de.settings?.backupDirectory || 'tools/admin/modules/dataeditor/backups')}"></label></div><label class="data-checkline"><input type="checkbox" id="dataCreateBackups" ${de.settings?.createBackups !== false ? 'checked' : ''}> Create backup before save</label><button type="button" class="btn" id="dataSaveSettings">Save settings</button></section>` : ''}<section class="panel data-browser"><div class="data-browser-head"><div><h2>Game configs</h2><p class="hint">Search, open, tune, validate, and save real local game configuration files. Folder structure is preserved and modifiers only target existing fields.</p></div><label class="data-search-field"><span>Search configs</span><input id="dataSearch" value="${esc(de.query || '')}" placeholder="app, title, transfer…"></label></div>${de.loading ? '<p class="loading">Loading configs…</p>' : folderSectionsHtml(files, de, esc)}</section>${modalHtml(de, esc)}</section>`;
}

async function refreshFiles(state, deps) {
  const de = ensureDataEditorState(state);
  const listing = await deps.api('/api/data-editor/files');
  de.resolvedPath = listing.resolvedPath || de.resolvedPath;
  de.settings = listing.settings || de.settings;
  de.files = listing.files || [];
}
async function openFile(state, deps, file) {
  const de = ensureDataEditorState(state);
  de.returnScroll = captureDataEditorScroll();
  de.selectedFile = file;
  de.fileSearch = '';
  de.showAdvanced = false;
  de.utilityModal = null;
  const payload = await deps.api(`/api/data-editor/file?file=${encodeURIComponent(file)}`);
  de.current = { ...payload, original: clone(payload.data), draftRaw: payload.rawText, rawMode: false, dirty: false, lastSaveMessage: '' };
  await deps.render();
}
function parseFieldValue(field) {
  const type = field.dataset.valueType || 'string';
  if (field.type === 'checkbox') return field.checked;
  if (field.dataset.maskGrid != null) return serializeMaskGrid(field);
  if (field.dataset.jsonEditor != null || type === 'json') return JSON.parse(field.value || 'null');
  if (type === 'number') return Number(field.value || 0);
  if (type === 'boolean') return String(field.value) === 'true' || field.checked;
  if (type === 'array') return String(field.value || '').split(/[\n,]/).map((x) => x.trim()).filter(Boolean);
  return field.value;
}
function bindFieldInputs(state) {
  const de = ensureDataEditorState(state);
  const c = de.current;
  if (!c || c.rawMode) return;
  document.querySelectorAll('[data-data-field]').forEach((field) => {
    field.oninput = () => {
      try {
        const value = parseFieldValue(field);
        setAtPath(c.data, field.dataset.dataField, value);
        c.dirty = stable(c.data) !== stable(c.original);
        document.querySelectorAll(`[data-data-field="${CSS.escape(field.dataset.dataField)}"]`).forEach((peer) => {
          if (peer !== field && (peer.type === 'range' || peer.type === 'number' || peer.tagName === 'INPUT')) peer.value = field.value;
        });
        if (field.dataset.colorPicker != null) {
          document.querySelectorAll(`[data-data-field="${CSS.escape(field.dataset.dataField)}"][data-color-text]`).forEach((peer) => { if (peer !== field) peer.value = field.value; });
        }
        if (field.dataset.colorText != null) {
          const hex = normalizeHexColor(field.value, '');
          if (hex) document.querySelectorAll(`[data-data-field="${CSS.escape(field.dataset.dataField)}"][data-color-picker]`).forEach((peer) => { if (peer !== field) peer.value = hex; });
        }
        document.querySelectorAll(`[data-data-field="${CSS.escape(field.dataset.dataField)}"]`).forEach((peer) => {
          const swatch = peer.closest('.data-color-row')?.querySelector('.data-color-swatch');
          if (swatch) swatch.style.background = normalizeHexColor(field.value);
        });
        refreshDataPreview(c);
        const rev = document.getElementById('dataRevert');
        if (rev) rev.disabled = !c.dirty;
        const pill = document.querySelector('.data-dirty-pill');
        if (pill) {
          const changed = diffPaths(c.original, c.data).length;
          pill.textContent = c.dirty ? `${changed} changed` : 'Saved snapshot';
          pill.classList.toggle('is-dirty', c.dirty);
        }
      } catch (e) {
        const status = document.getElementById('dataSaveStatus');
        if (status) status.textContent = e.message;
      }
    };
    field.onchange = field.oninput;
  });
}

export function bindEditor(state, deps) {
  const de = ensureDataEditorState(state);
  const back = document.getElementById('workbenchExit');
  if (back) back.onclick = () => deps.navigateToTab('Game Engine');
  const refresh = document.getElementById('dataRefresh');
  if (refresh) refresh.onclick = async () => { await refreshFiles(state, deps); await renderPreservingDataEditorScroll(deps); };
  const settingsToggle = document.getElementById('dataSettingsToggle');
  if (settingsToggle) settingsToggle.onclick = async () => { de.settingsOpen = !de.settingsOpen; await renderPreservingDataEditorScroll(deps); };
  const search = document.getElementById('dataSearch');
  if (search) search.oninput = async () => { de.query = search.value; await renderPreservingDataEditorScroll(deps); };
  const saveSettings = document.getElementById('dataSaveSettings');
  if (saveSettings) saveSettings.onclick = async () => {
    const payload = {
      configDirectory: document.getElementById('dataConfigDirectory')?.value || de.settings?.configDirectory,
      backupDirectory: document.getElementById('dataBackupDirectory')?.value || de.settings?.backupDirectory,
      createBackups: Boolean(document.getElementById('dataCreateBackups')?.checked),
    };
    const res = await deps.api('/api/data-editor/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    de.settings = res.settings;
    await refreshFiles(state, deps);
    await deps.render();
  };
  document.querySelectorAll('[data-data-folder-toggle]').forEach((btn) => {
    btn.onclick = async () => {
      de.collapsedFolders = de.collapsedFolders || {};
      const folder = btn.dataset.dataFolderToggle || '';
      de.collapsedFolders[folder] = !de.collapsedFolders[folder];
      await renderPreservingDataEditorScroll(deps);
    };
  });
  document.querySelectorAll('[data-data-file]').forEach((card) => { card.onclick = () => openFile(state, deps, card.dataset.dataFile).catch((e) => deps.log(e.message, 'error')); });
  document.querySelectorAll('[data-data-close]').forEach((btn) => { btn.onclick = async () => {
    const snapshot = de.returnScroll || captureDataEditorScroll();
    de.selectedFile = '';
    de.current = null;
    de.utilityModal = null;
    await deps.render();
    restoreDataEditorScroll(snapshot);
    de.returnScroll = null;
  }; });
  const fs = document.getElementById('dataFieldSearch');
  if (fs) fs.oninput = async () => { de.fileSearch = fs.value; await renderPreservingDataEditorScroll(deps); };
  const adv = document.getElementById('dataAdvanced');
  if (adv) adv.onchange = async () => { de.showAdvanced = adv.checked; await renderPreservingDataEditorScroll(deps); };
  document.querySelectorAll('[data-data-mode]').forEach((btn) => {
    btn.onclick = async () => { if (!de.current) return; de.current.rawMode = btn.dataset.dataMode === 'raw'; if (de.current.rawMode) de.current.draftRaw = JSON.stringify(de.current.data, null, 2); await renderPreservingDataEditorScroll(deps); };
  });
  const currentUtilityForId = (id) => de.current ? (utilityById(de.current, id) || { id, type: 'color-harmony' }) : { id, type: 'color-harmony' };
  const writeColorToolState = (id, patch) => {
    if (!id) return null;
    de.utilityState = de.utilityState || {};
    de.utilityState[id] = { ...(de.utilityState[id] || {}), ...patch };
    return de.utilityState[id];
  };
  const setColorToolState = async (id, patch, { preserveScroll = true, render = true, live = false } = {}) => {
    if (!id) return;
    writeColorToolState(id, patch);
    if (live) updateColorHarmonyToolDom(id);
    if (!render) return;
    if (preserveScroll) await renderPreservingDataEditorScroll(deps);
    else await deps.render();
  };
  const colorPatchForHue = (stateForTool, index, hue) => {
    const safeHue = ((Number(hue) || 0) % 360 + 360) % 360;
    const startBaseHue = stateForTool.items[0]?.hue ?? stateForTool.baseHsl.h;
    const startHues = stateForTool.items.map((item) => item.hue);
    if (index === 0 && stateForTool.mode !== 'custom') {
      return {
        selectedKnob: 0,
        baseColor: rgbToHex(hslToRgb({ h: safeHue, s: stateForTool.sat, l: stateForTool.light })),
        customHues: null,
      };
    }
    if (index === 0) {
      const delta = safeHue - startBaseHue;
      const custom = startHues.map((h) => (h + delta + 360) % 360);
      return {
        mode: 'custom',
        selectedKnob: 0,
        customHues: custom,
        baseColor: rgbToHex(hslToRgb({ h: custom[0] ?? safeHue, s: stateForTool.sat, l: stateForTool.light })),
      };
    }
    const custom = startHues.slice();
    custom[index] = safeHue;
    return {
      mode: 'custom',
      selectedKnob: index,
      customHues: custom,
      baseColor: rgbToHex(hslToRgb({ h: custom[0] ?? startBaseHue, s: stateForTool.sat, l: stateForTool.light })),
    };
  };
  const updateColorHarmonyToolDom = (id) => {
    if (!id || !de.current) return;
    const utility = currentUtilityForId(id);
    const stateForTool = colorToolState(de, utility, de.current);
    const selected = stateForTool.items[stateForTool.selected] || stateForTool.items[0];
    const root = document.querySelector(`[data-color-tool="${CSS.escape(id)}"]`);
    if (!root) return;
    root.querySelectorAll('[data-color-wheel-knob]').forEach((knob) => {
      const index = Number(knob.dataset.colorWheelKnob) || 0;
      const item = stateForTool.items[index];
      if (!item) return;
      const pt = angleToWheelPoint(item.hue);
      knob.style.setProperty('--x', `${pt.x.toFixed(3)}%`);
      knob.style.setProperty('--y', `${pt.y.toFixed(3)}%`);
      knob.style.setProperty('--knob-color', item.value);
      knob.classList.toggle('active', index === stateForTool.selected);
      knob.title = `${item.label}: ${item.value}`;
    });
    const centerHex = root.querySelector('.data-color-wheel-center b');
    if (centerHex) centerHex.textContent = selected?.value || stateForTool.base;
    const centerLabel = root.querySelector('.data-color-wheel-center small');
    if (centerLabel) centerLabel.textContent = selected?.label || 'Selected';
    const selectedValue = selected?.value || stateForTool.base;
    const selectedSwatch = root.querySelector('.data-selected-color-card > span');
    if (selectedSwatch) {
      selectedSwatch.style.background = selectedValue;
      selectedSwatch.dataset.copyValue = selectedValue;
      selectedSwatch.title = `Copy ${selectedValue}`;
    }
    const selectedTitle = root.querySelector('.data-selected-color-card strong');
    if (selectedTitle) selectedTitle.textContent = selected?.label || 'Selected color';
    const selectedCode = root.querySelector('.data-selected-color-card code');
    if (selectedCode) selectedCode.textContent = selectedValue;
    root.querySelectorAll('.data-selected-color-card [data-copy-value]').forEach((copy) => {
      copy.dataset.copyValue = selectedValue;
      copy.title = `Copy ${selectedValue}`;
    });
    const picker = root.querySelector('[data-color-selected-picker]');
    if (picker && picker.value.toLowerCase() !== String(selected?.value || stateForTool.base).toLowerCase()) picker.value = selected?.value || stateForTool.base;
    const hexInput = root.querySelector('[data-color-selected-hex]');
    if (hexInput && document.activeElement !== hexInput) hexInput.value = selected?.value || stateForTool.base;
    root.querySelectorAll('[data-color-harmony-mode]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.colorHarmonyMode === stateForTool.mode);
    });
  };
  document.querySelectorAll('[data-color-harmony-mode]').forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.dataset.utilityId;
      const mode = btn.dataset.colorHarmonyMode || 'complementary';
      const utility = currentUtilityForId(id);
      const stateForTool = colorToolState(de, utility, de.current);
      await setColorToolState(id, {
        mode,
        customHues: null,
        selectedKnob: 0,
        baseColor: stateForTool.items[0]?.value || stateForTool.base,
      });
    };
  });
  document.querySelectorAll('[data-color-wheel-knob]').forEach((knob) => {
    knob.onclick = (event) => {
      if (knob.__dragged) { knob.__dragged = false; return; }
      event.preventDefault();
      event.stopPropagation();
      setColorToolState(knob.dataset.utilityId, { selectedKnob: Number(knob.dataset.colorWheelKnob) || 0 }, { render: false, live: true });
    };
    knob.onpointerdown = (event) => {
      const id = knob.dataset.utilityId;
      const index = Number(knob.dataset.colorWheelKnob) || 0;
      const wheel = knob.closest('[data-color-wheel]');
      if (!wheel || !id) return;
      event.preventDefault();
      event.stopPropagation();
      knob.setPointerCapture?.(event.pointerId);
      document.body.classList.add('data-color-dragging');
      const utility = currentUtilityForId(id);
      let moved = false;
      let raf = 0;
      let latestEvent = event;
      const applyHueLive = (eventLike) => {
        const currentState = colorToolState(de, utility, de.current);
        const hue = hueFromWheelEvent(eventLike, wheel);
        writeColorToolState(id, colorPatchForHue(currentState, index, hue));
        updateColorHarmonyToolDom(id);
      };
      const onMove = (moveEvent) => {
        moveEvent.preventDefault();
        moveEvent.stopPropagation();
        moved = true;
        latestEvent = moveEvent;
        knob.__dragged = true;
        if (raf) return;
        raf = requestAnimationFrame(() => {
          raf = 0;
          applyHueLive(latestEvent);
        });
      };
      const onUp = (upEvent) => {
        upEvent.preventDefault();
        upEvent.stopPropagation();
        document.removeEventListener('pointermove', onMove, true);
        document.removeEventListener('pointerup', onUp, true);
        document.body.classList.remove('data-color-dragging');
        if (raf) cancelAnimationFrame(raf);
        if (moved) {
          applyHueLive(upEvent);
          void renderPreservingDataEditorScroll(deps);
        }
      };
      document.addEventListener('pointermove', onMove, true);
      document.addEventListener('pointerup', onUp, { once: true, capture: true });
    };
  });
  const updateSelectedColor = (id, value) => {
    const hex = normalizeHexColor(value, '');
    if (!id || !hex) return;
    const utility = currentUtilityForId(id);
    const stateForTool = colorToolState(de, utility, de.current);
    const next = rgbToHsl(hexToRgb(hex));
    const hues = stateForTool.items.map((item) => item.hue);
    let patch;
    if (stateForTool.selected === 0 && stateForTool.mode !== 'custom') {
      patch = {
        mode: stateForTool.mode,
        selectedKnob: 0,
        customHues: null,
        baseColor: hex,
        saturation: next.s,
        lightness: next.l,
      };
    } else if (stateForTool.selected === 0) {
      const delta = next.h - (hues[0] ?? stateForTool.baseHsl.h);
      patch = {
        mode: 'custom',
        selectedKnob: 0,
        customHues: hues.map((h) => (h + delta + 360) % 360),
        baseColor: hex,
        saturation: next.s,
        lightness: next.l,
      };
    } else {
      hues[stateForTool.selected] = next.h;
      patch = {
        mode: 'custom',
        selectedKnob: stateForTool.selected,
        customHues: hues,
        baseColor: stateForTool.base,
        saturation: next.s,
        lightness: next.l,
      };
    }
    setColorToolState(id, patch, { render: false, live: true });
  };
  document.querySelectorAll('[data-color-selected-picker]').forEach((input) => {
    input.oninput = () => updateSelectedColor(input.dataset.colorSelectedPicker, input.value);
    input.onchange = () => updateSelectedColor(input.dataset.colorSelectedPicker, input.value);
  });
  document.querySelectorAll('[data-color-selected-hex]').forEach((input) => {
    input.oninput = () => updateSelectedColor(input.dataset.colorSelectedHex, input.value);
    input.onpaste = () => setTimeout(() => updateSelectedColor(input.dataset.colorSelectedHex, input.value), 0);
    input.onchange = () => updateSelectedColor(input.dataset.colorSelectedHex, input.value);
  });
  document.querySelectorAll('[data-color-harmony-sat]').forEach((input) => {
    input.oninput = () => setColorToolState(input.dataset.colorHarmonySat, { saturation: clamp01(Number(input.value) / 100) }, { render: false, live: true });
    input.onchange = async () => renderPreservingDataEditorScroll(deps);
  });
  document.querySelectorAll('[data-color-harmony-light]').forEach((input) => {
    input.oninput = () => setColorToolState(input.dataset.colorHarmonyLight, { lightness: clamp01(Number(input.value) / 100) }, { render: false, live: true });
    input.onchange = async () => renderPreservingDataEditorScroll(deps);
  });
  const raw = document.getElementById('dataRawText');
  if (raw && de.current) raw.oninput = () => { de.current.draftRaw = raw.value; de.current.dirty = true; };
  const fmt = document.getElementById('dataFormatRaw');
  if (fmt) fmt.onclick = async () => { try { de.current.draftRaw = JSON.stringify(JSON.parse(document.getElementById('dataRawText')?.value || '{}'), null, 2); await renderPreservingDataEditorScroll(deps); } catch (e) { deps.log(e.message, 'error'); } };
  const rev = document.getElementById('dataRevert');
  if (rev) rev.onclick = async () => { if (!de.current) return; de.current.data = clone(de.current.original); de.current.draftRaw = JSON.stringify(de.current.data, null, 2); de.current.dirty = false; de.current.lastSaveMessage = 'Reverted local edits.'; await renderPreservingDataEditorScroll(deps); };
  const save = document.getElementById('dataSave');
  if (save) save.onclick = async () => {
    if (!de.current) return;
    save.disabled = true;
    try {
      let body;
      if (de.current.rawMode) {
        const parsed = JSON.parse(document.getElementById('dataRawText')?.value || '{}');
        body = { file: de.current.file, rawText: JSON.stringify(parsed, null, 2), createBackup: true };
        de.current.data = parsed;
      } else body = { file: de.current.file, data: de.current.data, createBackup: true };
      const changed = diffPaths(de.current.original, de.current.data);
      const res = await deps.api('/api/data-editor/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      de.current.original = clone(de.current.data);
      de.current.rawText = `${JSON.stringify(de.current.data, null, 2)}\n`;
      de.current.draftRaw = de.current.rawText;
      de.current.dirty = false;
      de.current.hash = res.hash;
      de.current.lastSaveMessage = `Saved ${changed.length} change${changed.length === 1 ? '' : 's'}${res.backupPath ? ` · backup: ${res.backupPath}` : ''}`;
      deps.log(`Saved ${de.current.file}.`, 'ok');
      await refreshFiles(state, deps);
      await renderPreservingDataEditorScroll(deps);
    } catch (e) {
      deps.log(e.message, 'error');
      const status = document.getElementById('dataSaveStatus');
      if (status) status.textContent = e.message;
      save.disabled = false;
    }
  };
  const markCopied = (el, value) => {
    const isColor = /^#[0-9a-f]{6}$/i.test(String(value || ''));
    const message = isColor ? 'Color copied' : 'Value copied';
    el.classList.add('is-copied');
    el.dataset.copyFeedback = message;
    if (el.tagName === 'BUTTON') {
      if (!el.dataset.copyLabel) el.dataset.copyLabel = el.textContent || '';
      if (el.classList.contains('data-selected-copy-btn')) el.textContent = message;
    }
    clearTimeout(el.__dataCopyTimer);
    el.__dataCopyTimer = setTimeout(() => {
      el.classList.remove('is-copied');
      delete el.dataset.copyFeedback;
      if (el.classList.contains('data-selected-copy-btn') && el.dataset.copyLabel) el.textContent = el.dataset.copyLabel;
    }, 1150);
    deps.log(`${message}: ${value}`, 'ok');
  };
  const copyValue = async (el) => {
    const value = el.dataset.copyValue || '';
    try {
      await navigator.clipboard.writeText(value);
      markCopied(el, value);
    } catch {
      deps.log(value, '');
    }
  };
  document.querySelectorAll('[data-copy-value]').forEach((btn) => {
    btn.onclick = async (event) => {
      event.preventDefault();
      event.stopPropagation();
      await copyValue(btn);
    };
    btn.onkeydown = async (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      event.stopPropagation();
      await copyValue(btn);
    };
  });
  document.querySelectorAll('[data-mask-grid-wrap]').forEach((wrap) => {
    const input = wrap.querySelector('[data-mask-grid]');
    const sync = () => {
      const rows = [];
      wrap.querySelectorAll('[data-mask-cell]').forEach((cell) => {
        const r = Number(cell.dataset.row || 0);
        const c = Number(cell.dataset.col || 0);
        if (!rows[r]) rows[r] = [];
        rows[r][c] = cell.classList.contains('is-on');
      });
      if (input) {
        input.value = JSON.stringify(rows.map((row) => row.map(Boolean)));
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    };
    wrap.querySelectorAll('[data-mask-cell]').forEach((cell) => {
      cell.onclick = () => {
        const next = !cell.classList.contains('is-on');
        cell.classList.toggle('is-on', next);
        cell.setAttribute('aria-pressed', next ? 'true' : 'false');
        sync();
      };
    });
  });
  bindFieldInputs(state);
}
