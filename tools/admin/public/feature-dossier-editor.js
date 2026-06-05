import { featureHasDossierContent as sharedFeatureHasDossier, isValidHref, normalizeHrefForSave } from './dossier-shared.js';
import { isSafeDossierAssetPath, sanitizeDossierHtml } from './sanitize-html.js';
import { bindDiagramEditorButtons, defaultDiagramSource, registerDiagramMountHandlers, renderAllDiagramPreviews } from './diagram-editor-modal.js';

/** @typedef {{ esc: Function, $: Function, adminAssetUrl: Function, imageAssetOptions: Function, filterImageAssets: Function, getPois: Function, getMilestones: Function }} DossierDeps */

const sectionUndoState = { timer: 0, payload: null };

/** Keep in sync with src/dossier/registry.js + src/components/dossier/blockViews.jsx */
const BLOCK_TYPES = [
  ['text', 'Text note'],
  ['figure', 'Text + image'],
  ['image', 'Image'],
  ['video', 'Video'],
  ['compare', 'Side-by-side compare'],
  ['carousel', 'Carousel'],
  ['gallery', 'Image gallery (grid)'],
  ['links', 'Links'],
  ['html', 'Custom HTML'],
  ['diagram', 'UML diagram'],
  ['code', 'Linked code'],
  ['tabs', 'Tabbed section'],
];

/** Button label for “Add …” — stays in sync with the section dropdown */
const BLOCK_ADD_VERBS = {
  text: 'Add text note',
  figure: 'Add text + image',
  image: 'Add image',
  video: 'Add video',
  compare: 'Add side-by-side',
  carousel: 'Add carousel',
  gallery: 'Add image gallery',
  links: 'Add links',
  html: 'Add custom HTML',
  diagram: 'Add UML diagram',
  code: 'Add linked code',
  tabs: 'Add tabbed section',
};

const CODE_REPOS = ['pokemon-resort', 'pokemon-resort-page', 'spmk', 'island-dreamforge'];

function syncAddBlockButton(select) {
  if (!select) return;
  const btn = select.closest('.dossier-section-actions')?.querySelector('[data-dossier-add-block]');
  if (!btn) return;
  const type = select.value || 'text';
  btn.textContent = BLOCK_ADD_VERBS[type] || 'Add block';
  btn.dataset.addBlockType = type;
}

function initSectionAddBlockButtons(root) {
  if (!root) return;
  root.querySelectorAll('[data-add-block-type]').forEach((select) => syncAddBlockButton(select));
}

function initDossierEditorMount(mount) {
  initSectionAddBlockButtons(mount);
  renderAllDiagramPreviews(mount);
}

const DEFAULT_COMPARE_ITEMS = () => [
  { path: '', label: 'Left' },
  { path: '', label: 'Right' },
];

/** Strict normalization for public site / “has content” checks */
function normalizeBlock(block) {
  if (!block || typeof block !== 'object') return null;
  const type = String(block.type || '').trim();
  if (type === 'text') {
    const body = String(block.body || block.text || '').trim();
    return body ? { type, body } : null;
  }
  if (type === 'image' || type === 'video') {
    const path = String(block.path || '').trim();
    if (!path) return null;
    return { type, path, caption: String(block.caption || '').trim(), poster: String(block.poster || '').trim() };
  }
  if (type === 'compare') {
    const items = (Array.isArray(block.items) ? block.items : [])
      .map((item) => ({ path: String(item?.path || '').trim(), label: String(item?.label || '').trim(), caption: String(item?.caption || '').trim() }))
      .filter((item) => item.path);
    if (items.length < 2) return null;
    const variant = block.variant === 'fixed' ? 'fixed' : 'fluid';
    return { type, variant, caption: String(block.caption || '').trim(), items };
  }
  if (type === 'carousel') {
    const images = (Array.isArray(block.images) ? block.images : [])
      .map((item) => (typeof item === 'string' ? { path: item.trim(), caption: '' } : { path: String(item?.path || '').trim(), caption: String(item?.caption || '').trim() }))
      .filter((item) => item.path);
    return images.length >= 2 ? { type, caption: String(block.caption || '').trim(), images } : null;
  }
  if (type === 'gallery') {
    const images = (Array.isArray(block.images) ? block.images : [])
      .map((item) => (typeof item === 'string' ? { path: item.trim(), caption: '' } : { path: String(item?.path || '').trim(), caption: String(item?.caption || '').trim() }))
      .filter((item) => item.path);
    return images.length ? { type, caption: String(block.caption || '').trim(), images } : null;
  }
  if (type === 'links') {
    const items = (Array.isArray(block.items) ? block.items : [])
      .map((item) => ({ label: String(item?.label || '').trim(), href: String(item?.href || item?.url || '').trim() }))
      .filter((item) => item.label && item.href);
    return items.length ? { type, items } : null;
  }
  if (type === 'figure') {
    const path = String(block.path || '').trim();
    const body = String(block.body || block.text || '').trim();
    const caption = String(block.caption || '').trim();
    const layout = block.layout === 'side' ? 'side' : 'stacked';
    if (!path || !isSafeDossierAssetPath(path) || (!body && !caption)) return null;
    return { type, path, body, caption, layout };
  }
  if (type === 'html') {
    const html = sanitizeDossierHtml(block.html || block.content || '');
    return html ? { type, html } : null;
  }
  if (type === 'diagram') {
    const source = String(block.source || block.mermaid || '').trim();
    if (!source || source.length > 32000) return null;
    return {
      type,
      source,
      title: String(block.title || '').trim(),
      caption: String(block.caption || '').trim(),
    };
  }
  if (type === 'code') {
    const repo = String(block.repo || '').trim();
    const path = String(block.path || '').trim();
    const body = String(block.body || block.code || '').trim();
    if (!repo || !CODE_REPOS.includes(repo) || !path || !body) return null;
    return {
      type,
      repo,
      path,
      lines: String(block.lines || block.lineRange || '').trim(),
      language: String(block.language || block.lang || '').trim(),
      caption: String(block.caption || '').trim(),
      body,
    };
  }
  if (type === 'tabs') {
    const tabs = (Array.isArray(block.tabs) ? block.tabs : [])
      .map((tab, index) => {
        const id = String(tab?.id || `tab-${index + 1}`).trim();
        const label = String(tab?.label || tab?.title || '').trim() || `Tab ${index + 1}`;
        const blocks = (Array.isArray(tab?.blocks) ? tab.blocks : []).map(normalizeBlock).filter(Boolean);
        if (!blocks.length) return null;
        return { id, label, blocks };
      })
      .filter(Boolean);
    return tabs.length >= 2 ? { type, caption: String(block.caption || '').trim(), tabs } : null;
  }
  return null;
}

/** Editor keeps incomplete blocks so add/remove/side-by-side feel immediate */
function normalizeBlockDraft(block) {
  if (!block || typeof block !== 'object') return { type: 'text', body: '' };
  const type = String(block.type || 'text').trim() || 'text';
  if (type === 'text') {
    return { type, body: String(block.body || block.text || '') };
  }
  if (type === 'image' || type === 'video') {
    return {
      type,
      path: String(block.path || ''),
      caption: String(block.caption || ''),
      poster: type === 'video' ? String(block.poster || '') : undefined,
    };
  }
  if (type === 'compare') {
    let items = (Array.isArray(block.items) ? block.items : []).map((item) => ({
      path: String(item?.path || ''),
      label: String(item?.label || ''),
      caption: String(item?.caption || ''),
    }));
    if (items.length < 2) items = DEFAULT_COMPARE_ITEMS();
    return {
      type,
      variant: block.variant === 'fixed' ? 'fixed' : 'fluid',
      caption: String(block.caption || ''),
      items,
    };
  }
  if (type === 'carousel') {
    let images = (Array.isArray(block.images) ? block.images : []).map((item) => (
      typeof item === 'string'
        ? { path: item, caption: '' }
        : { path: String(item?.path || ''), caption: String(item?.caption || '') }
    ));
    if (images.length < 2) images = [{ path: '', caption: '' }, { path: '', caption: '' }];
    return { type, caption: String(block.caption || ''), images };
  }
  if (type === 'gallery') {
    const images = (Array.isArray(block.images) ? block.images : []).map((item) => (
      typeof item === 'string'
        ? { path: item, caption: '' }
        : { path: String(item?.path || ''), caption: String(item?.caption || '') }
    ));
    return { type, caption: String(block.caption || ''), images: images.length ? images : [{ path: '', caption: '' }] };
  }
  if (type === 'links') {
    const items = (Array.isArray(block.items) ? block.items : []).map((item) => ({
      label: String(item?.label || ''),
      href: String(item?.href || item?.url || ''),
    }));
    return { type, items: items.length ? items : [{ label: '', href: '' }] };
  }
  if (type === 'figure') {
    return {
      type,
      path: String(block.path || ''),
      body: String(block.body || block.text || ''),
      caption: String(block.caption || ''),
      layout: block.layout === 'side' ? 'side' : 'stacked',
    };
  }
  if (type === 'html') {
    return { type, html: String(block.html || block.content || '') };
  }
  if (type === 'diagram') {
    return {
      type,
      source: String(block.source || block.mermaid || defaultDiagramSource()),
      title: String(block.title || ''),
      caption: String(block.caption || ''),
    };
  }
  return { type: 'text', body: '' };
}

export function normalizeFeatureDossierRaw(feature, options = {}) {
  const forEditor = options.forEditor === true;
  const normalizeOne = forEditor ? normalizeBlockDraft : normalizeBlock;
  const raw = feature?.dossier && typeof feature.dossier === 'object' ? feature.dossier : {};
  let sections = (Array.isArray(raw.sections) ? raw.sections : [])
    .map((section, index) => ({
      id: String(section?.id || `section-${index + 1}`).trim(),
      title: String(section?.title || '').trim() || (forEditor ? `Section ${index + 1}` : ''),
      summary: String(section?.summary || '').trim(),
      blocks: (Array.isArray(section?.blocks) ? section.blocks : []).map(normalizeOne).filter((block) => forEditor || block),
    }))
    .filter((section) => forEditor || section.title || section.summary || section.blocks.length);

  const legacy = (Array.isArray(feature?.images) ? feature.images : [])
    .map((item) => (typeof item === 'string' ? { path: item.trim(), caption: '' } : { path: String(item?.path || '').trim(), caption: String(item?.caption || '').trim() }))
    .filter((item) => item.path);

  if (!sections.length && legacy.length && !forEditor) {
    sections = [{ id: 'evidence', title: 'Evidence', summary: '', blocks: [{ type: 'gallery', caption: '', images: legacy }] }];
  }

  const map = raw.map && typeof raw.map === 'object' ? raw.map : {};
  const position = Array.isArray(map.position) ? map.position : [];

  return {
    overview: String(raw.overview || ''),
    map: {
      pinId: String(map.pinId || map.poiId || '').trim(),
      label: String(map.label || '').trim(),
      note: String(map.note || '').trim(),
      position: position.length ? position.map((n) => String(n)) : ['', '', ''],
    },
    researchMilestones: (Array.isArray(raw.researchMilestones) ? raw.researchMilestones : [])
      .map((item) => ({ label: String(item?.label || '').trim(), done: Boolean(item?.done) }))
      .filter((item) => forEditor || item.label),
    sections,
  };
}

export function featureHasDossierContent(feature) {
  return sharedFeatureHasDossier(feature, normalizeFeatureDossierRaw);
}

function dossierPathPreview(path, deps) {
  const { esc, adminAssetUrl } = deps;
  const trimmed = String(path || '').trim();
  if (!trimmed) {
    return '<div class="dossier-path-preview dossier-path-preview--empty" data-dossier-preview><span>No preview</span></div>';
  }
  return `<div class="dossier-path-preview" data-dossier-preview><img src="${esc(adminAssetUrl(trimmed))}" alt="" loading="lazy" data-dossier-preview-img /></div>`;
}

function linkRowHtml(item, idx, esc) {
  const href = String(item.href || item.url || '');
  const invalid = href.trim() && !isValidHref(href);
  return `<div class="dossier-link-row${invalid ? ' dossier-link-row--invalid' : ''}" data-link-row="${idx}">
    <label>Label<input data-link-label value="${esc(item.label || '')}"></label>
    <label>URL<input data-link-href value="${esc(href)}" placeholder="https://…" spellcheck="false">
    ${invalid ? '<span class="hint link-invalid-hint">Invalid URL — use https://… or mailto:name@example.com</span>' : ''}</label>
    <button type="button" class="btn ghost small" data-link-remove>×</button>
  </div>`;
}

const DOSSIER_PATH_INPUT_SELECTOR = '[data-block-path], [data-compare-path], [data-carousel-path], [data-gallery-path], [data-block-poster]';

function resolveDossierUploadTarget(deps) {
  const folder = deps.getUploadFolder?.() || deps.uploadFolder || 'media/uploads';
  const subdir = deps.getUploadSubdir?.() || deps.uploadSubdir || '';
  return { folder, subdir };
}

function pathFieldRow(label, path, inputAttrString, deps) {
  const { esc } = deps;
  return `<div class="dossier-path-with-preview">
    <label class="dossier-path-label">${label}
      <span class="dossier-path-input-row">
        <input ${inputAttrString} list="dossierAssets" value="${esc(path || '')}">
        <button type="button" class="btn small dossier-path-upload" data-dossier-path-upload>Upload</button>
      </span>
    </label>
    ${dossierPathPreview(path, deps)}
  </div>`;
}

function markPathInputTarget(input, mount) {
  if (!input || !mount) return;
  mount.querySelectorAll('[data-dossier-last-path-target]').forEach((el) => el.removeAttribute('data-dossier-last-path-target'));
  input.setAttribute('data-dossier-last-path-target', '1');
}

function runDossierUpload(deps, mount, persist, input) {
  if (typeof deps.openAssetUploadModal !== 'function') return;
  if (input) markPathInputTarget(input, mount);
  const { folder, subdir } = resolveDossierUploadTarget(deps);
  deps.openAssetUploadModal({
    folder,
    subdir,
    title: 'Upload image or clip',
    onSuccess: (path) => {
      const target = mount.querySelector('[data-dossier-last-path-target]')
        || input
        || mount.querySelector(DOSSIER_PATH_INPUT_SELECTOR);
      if (target && path) {
        target.value = path;
        updatePathPreviewForInput(target, deps);
      }
      const picker = mount.querySelector('.dossier-asset-picker');
      if (picker) {
        const q = mount.querySelector('#dossierAssetSearch')?.value || '';
        picker.outerHTML = renderDossierAssetPicker(deps, q);
      }
      persist?.();
    },
  });
}

function renderDossierAssetPicker(deps, query = '') {
  const { esc, adminAssetUrl, filterImageAssets, imageAssetOptions } = deps;
  const assets = typeof filterImageAssets === 'function'
    ? filterImageAssets(query, 80)
    : imageAssetOptions().slice(0, 80);
  const total = imageAssetOptions().length;
  const { folder, subdir } = resolveDossierUploadTarget(deps);
  const targetLabel = subdir ? `${folder}/${subdir}` : folder;
  return `<details class="dossier-asset-picker" open>
    <summary>Images &amp; media (<span id="dossierAssetCount">${total}</span> in project · showing ${assets.length})</summary>
    <div class="dossier-asset-upload-row">
      <button type="button" class="btn small" data-dossier-upload-asset>Upload from computer</button>
      <span class="hint">→ <code>public/${esc(targetLabel)}/</code></span>
    </div>
    <label class="dossier-asset-search">Filter existing assets<input type="search" id="dossierAssetSearch" value="${esc(query)}" placeholder="Filter by path…" autocomplete="off"></label>
    <div class="dossier-asset-grid" id="dossierAssetGrid">${assets.length
    ? assets.map((p) => `<button type="button" class="dossier-asset-pick" data-pick-asset-path="${esc(p)}" title="${esc(p)}"><img src="${esc(adminAssetUrl(p))}" alt="" loading="lazy" /></button>`).join('')
    : '<p class="hint">No assets match this filter — upload one above.</p>'}</div>
  </details>`;
}

function clearSectionUndo(mount) {
  window.clearTimeout(sectionUndoState.timer);
  sectionUndoState.timer = 0;
  sectionUndoState.payload = null;
  mount?.querySelector('[data-dossier-undo-bar]')?.classList.add('hidden');
}

function showSectionUndo(record, section, index, mount) {
  clearSectionUndo(mount);
  sectionUndoState.payload = { record, section, index };
  const bar = mount?.querySelector('[data-dossier-undo-bar]');
  if (bar) {
    bar.classList.remove('hidden');
    const titleEl = bar.querySelector('[data-undo-section-title]');
    if (titleEl) titleEl.textContent = section.title || 'Untitled';
  }
  sectionUndoState.timer = window.setTimeout(clearSectionUndo, 12000);
}

function blockTypeLabel(type) {
  return BLOCK_TYPES.find(([v]) => v === type)?.[1] || type;
}

function wrapDossierBlockEditor(type, sectionIndex, blockIndex, extraClass, bodyHtml) {
  const label = blockTypeLabel(type);
  const extra = extraClass ? ` ${extraClass}` : '';
  return `<details class="dossier-block-editor-details dossier-block-editor${extra}" data-dossier-block data-section="${sectionIndex}" data-block="${blockIndex}" open>
    <summary class="dossier-block-summary"><span class="dossier-block-type-pill">${label}</span></summary>
    <div class="dossier-block-editor-body">${bodyHtml}</div>
  </details>`;
}

function dossierMilestoneRows(items, esc) {
  return items.map((item, i) => `<div class="check-row" data-dossier-milestone="${i}">
    <input type="checkbox" ${item.done ? 'checked' : ''} data-dossier-milestone-done>
    <input value="${esc(item.label)}" data-dossier-milestone-label placeholder="Research milestone">
    <button type="button" class="btn ghost small" data-dossier-milestone-remove>Remove</button>
  </div>`).join('');
}

function dossierBlockHtml(block, sectionIndex, blockIndex, deps) {
  const { esc } = deps;
  const type = block?.type || 'text';
  const commonCaption = esc(block?.caption || '');
  if (type === 'text') {
    return wrapDossierBlockEditor(type, sectionIndex, blockIndex, '', `
      <div class="dossier-block-toolbar"><select data-block-type>${BLOCK_TYPES.map(([v, l]) => `<option value="${v}" ${v === type ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <button type="button" class="btn ghost small" data-dossier-block-remove>Remove block</button></div>
      <label>Text<textarea rows="4" data-block-body>${esc(block?.body || block?.text || '')}</textarea></label>`);
  }
  if (type === 'image' || type === 'video') {
    const path = block?.path || '';
    return wrapDossierBlockEditor(type, sectionIndex, blockIndex, '', `
      <div class="dossier-block-toolbar"><select data-block-type>${BLOCK_TYPES.map(([v, l]) => `<option value="${v}" ${v === type ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <button type="button" class="btn ghost small" data-dossier-block-remove>Remove block</button></div>
      ${pathFieldRow('File path', path, 'data-block-path placeholder="media/… or assets/…"', deps)}
      <label>Caption<input data-block-caption value="${commonCaption}"></label>
      ${type === 'video' ? pathFieldRow('Poster (optional)', block?.poster || '', 'data-block-poster', deps) : ''}`);
  }
  if (type === 'compare') {
    const items = block?.items?.length >= 2 ? block.items : DEFAULT_COMPARE_ITEMS();
    const variant = block?.variant === 'fixed' ? 'fixed' : 'fluid';
    return wrapDossierBlockEditor(type, sectionIndex, blockIndex, 'dossier-block-compare', `
      <div class="dossier-block-toolbar"><select data-block-type>${BLOCK_TYPES.map(([v, l]) => `<option value="${v}" ${v === type ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <button type="button" class="btn ghost small" data-dossier-block-remove>Remove block</button></div>
      <p class="hint dossier-block-hint">Add image paths for each panel. Fixed layout keeps panels side-by-side on wide screens.</p>
      <label>Layout<select data-compare-variant><option value="fluid" ${variant === 'fluid' ? 'selected' : ''}>Fluid (responsive)</option><option value="fixed" ${variant === 'fixed' ? 'selected' : ''}>Fixed (side by side)</option></select></label>
      <label>Caption<input data-block-caption value="${commonCaption}"></label>
      <div class="dossier-compare-items" data-compare-items>${items.map((item, idx) => `<div class="dossier-compare-row" data-compare-row="${idx}">
        <label>Label<input data-compare-label value="${esc(item.label || '')}"></label>
        ${pathFieldRow('Path', item.path || '', 'data-compare-path placeholder="assets/…"', deps)}
        <button type="button" class="btn ghost small" data-compare-remove ${items.length <= 2 ? 'disabled' : ''} title="Need at least 2 panels">×</button>
      </div>`).join('')}</div>
      <button type="button" class="btn ghost small" data-compare-add>Add panel</button>`);
  }
  if (type === 'carousel') {
    const images = Array.isArray(block?.images) && block.images.length >= 2 ? block.images : [{ path: '', caption: '' }, { path: '', caption: '' }];
    return wrapDossierBlockEditor(type, sectionIndex, blockIndex, '', `
      <div class="dossier-block-toolbar"><select data-block-type>${BLOCK_TYPES.map(([v, l]) => `<option value="${v}" ${v === type ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <button type="button" class="btn ghost small" data-dossier-block-remove>Remove block</button></div>
      <label>Carousel caption<input data-block-caption value="${commonCaption}"></label>
      <div class="dossier-gallery-items" data-carousel-items>${images.map((img, idx) => {
        const path = typeof img === 'string' ? img : img?.path;
        const caption = typeof img === 'string' ? '' : img?.caption;
        return `<div class="dossier-gallery-row" data-carousel-row="${idx}">
          ${pathFieldRow('Path', path || '', 'data-carousel-path', deps)}
          <label>Caption<input data-carousel-caption value="${esc(caption || '')}"></label>
          <button type="button" class="btn ghost small" data-carousel-remove ${images.length <= 2 ? 'disabled' : ''}>×</button>
        </div>`;
      }).join('')}</div>
      <button type="button" class="btn ghost small" data-carousel-add>Add slide</button>`);
  }
  if (type === 'gallery') {
    const images = Array.isArray(block?.images) && block.images.length ? block.images : [{ path: '', caption: '' }];
    return wrapDossierBlockEditor(type, sectionIndex, blockIndex, '', `
      <div class="dossier-block-toolbar"><select data-block-type>${BLOCK_TYPES.map(([v, l]) => `<option value="${v}" ${v === type ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <button type="button" class="btn ghost small" data-dossier-block-remove>Remove block</button></div>
      <label>Gallery caption<input data-block-caption value="${commonCaption}"></label>
      <div class="dossier-gallery-items" data-gallery-items>${images.map((img, idx) => {
        const path = typeof img === 'string' ? img : img?.path;
        const caption = typeof img === 'string' ? '' : img?.caption;
        return `<div class="dossier-gallery-row" data-gallery-row="${idx}">
          ${pathFieldRow('Path', path || '', 'data-gallery-path', deps)}
          <label>Caption<input data-gallery-caption value="${esc(caption || '')}"></label>
          <button type="button" class="btn ghost small" data-gallery-remove>×</button>
        </div>`;
      }).join('')}</div>
      <button type="button" class="btn ghost small" data-gallery-add>Add image</button>`);
  }
  if (type === 'links') {
    const items = Array.isArray(block?.items) && block.items.length ? block.items : [{ label: '', href: '' }];
    return wrapDossierBlockEditor(type, sectionIndex, blockIndex, '', `
      <div class="dossier-block-toolbar"><select data-block-type>${BLOCK_TYPES.map(([v, l]) => `<option value="${v}" ${v === type ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <button type="button" class="btn ghost small" data-dossier-block-remove>Remove block</button></div>
      <div data-link-items>${items.map((item, idx) => linkRowHtml(item, idx, esc)).join('')}</div>
      <button type="button" class="btn ghost small" data-link-add>Add link</button>`);
  }
  if (type === 'figure') {
    const path = block?.path || '';
    const layout = block?.layout === 'side' ? 'side' : 'stacked';
    return wrapDossierBlockEditor(type, sectionIndex, blockIndex, 'dossier-block-figure-editor', `
      <div class="dossier-block-toolbar"><select data-block-type>${BLOCK_TYPES.map(([v, l]) => `<option value="${v}" ${v === type ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <button type="button" class="btn ghost small" data-dossier-block-remove>Remove block</button></div>
      <p class="hint dossier-block-hint">Paragraph beside an image. Needs body or caption text plus a valid asset path.</p>
      <label>Body text<textarea rows="4" data-block-body>${esc(block?.body || block?.text || '')}</textarea></label>
      ${pathFieldRow('Image path', path, 'data-block-path placeholder="media/… or assets/…"', deps)}
      <label>Caption (optional)<input data-block-caption value="${commonCaption}"></label>
      <label>Layout<select data-figure-layout><option value="stacked" ${layout === 'stacked' ? 'selected' : ''}>Stacked (text above image)</option><option value="side" ${layout === 'side' ? 'selected' : ''}>Side by side</option></select></label>`);
  }
  if (type === 'html') {
    return wrapDossierBlockEditor(type, sectionIndex, blockIndex, 'dossier-block-html-editor', `
      <div class="dossier-block-toolbar"><select data-block-type>${BLOCK_TYPES.map(([v, l]) => `<option value="${v}" ${v === type ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <button type="button" class="btn ghost small" data-dossier-block-remove>Remove block</button></div>
      <p class="hint dossier-block-hint">Safe subset of HTML only. Scripts, inline styles, and remote images are stripped on save. Use <code>assets/</code> or <code>media/</code> paths for images.</p>
      <label>HTML<textarea rows="10" data-block-html spellcheck="false" placeholder="<p>…</p>">${esc(block?.html || block?.content || '')}</textarea></label>
      <button type="button" class="btn ghost small" data-html-preview-btn>Preview HTML</button>
      <div class="dossier-html-preview-wrap is-hidden" data-html-preview-wrap hidden>
        <span class="hint">Preview (sanitized)</span>
        <div class="dossier-html-preview" data-dossier-html-preview></div>
      </div>`);
  }
  if (type === 'diagram') {
    const source = block?.source || block?.mermaid || defaultDiagramSource();
    return `<details class="dossier-block-editor-details dossier-block-editor dossier-block-diagram-editor" data-dossier-block data-block-kind="diagram" data-section="${sectionIndex}" data-block="${blockIndex}" open>
      <summary class="dossier-block-summary"><span class="dossier-block-type-pill">UML diagram</span></summary>
      <div class="dossier-block-editor-body">
        <div class="dossier-block-toolbar"><select data-block-type>${BLOCK_TYPES.map(([v, l]) => `<option value="${v}" ${v === type ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <button type="button" class="btn ghost small" data-dossier-block-remove>Remove block</button></div>
        <p class="hint dossier-block-hint">Text-based UML via Mermaid — class, state, sequence, and flowchart diagrams. Use the editor modal for the source.</p>
        <label>Title (optional)<input data-block-diagram-title value="${esc(block?.title || '')}" placeholder="Pokémon follower AI"></label>
        <label>Caption (optional)<input data-block-diagram-caption value="${esc(block?.caption || '')}" placeholder="High-level behaviour overview"></label>
        <textarea hidden data-block-diagram-source>${esc(source)}</textarea>
        <div class="dossier-diagram-inline-preview" data-diagram-inline-preview><p class="hint">Rendering…</p></div>
        <button type="button" class="btn primary" data-diagram-edit-btn>Edit diagram…</button>
      </div>
    </details>`;
  }
  if (type === 'code') {
    const repo = block?.repo || 'pokemon-resort';
    return wrapDossierBlockEditor(type, sectionIndex, blockIndex, 'dossier-block-code-editor', `
      <div class="dossier-block-toolbar"><select data-block-type>${BLOCK_TYPES.map(([v, l]) => `<option value="${v}" ${v === type ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <button type="button" class="btn ghost small" data-dossier-block-remove>Remove block</button></div>
      <p class="hint dossier-block-hint">Paths are relative to the app root in this monorepo (e.g. pokemon-resort/src/…). Paste the snippet into <strong>body</strong>; keep it in sync with the linked file.</p>
      <div class="row"><label>Repo root<select data-code-repo>${CODE_REPOS.map((r) => `<option value="${r}" ${r === repo ? 'selected' : ''}>${r}</option>`).join('')}</select></label>
      <label>File path<input data-code-path value="${esc(block?.path || '')}" placeholder="src/gameplay/…"></label>
      <label>Lines (optional)<input data-code-lines value="${esc(block?.lines || block?.lineRange || '')}" placeholder="42-68"></label></div>
      <div class="row"><label>Language<input data-code-language value="${esc(block?.language || block?.lang || '')}" placeholder="cpp, mjs, json"></label>
      <label>Caption<input data-block-caption value="${commonCaption}"></label></div>
      <label>Code body<textarea rows="12" data-code-body spellcheck="false">${esc(block?.body || block?.code || '')}</textarea></label>`);
  }
  if (type === 'tabs') {
    const tabs = block?.tabs?.length >= 2 ? block.tabs : [
      { id: 'writing', label: 'Writing', blocks: [{ type: 'text', body: '' }] },
      { id: 'reading', label: 'Reading', blocks: [{ type: 'text', body: '' }] },
    ];
    return wrapDossierBlockEditor(type, sectionIndex, blockIndex, 'dossier-block-tabs-editor', `
      <div class="dossier-block-toolbar"><select data-block-type>${BLOCK_TYPES.map(([v, l]) => `<option value="${v}" ${v === type ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <button type="button" class="btn ghost small" data-dossier-block-remove>Remove block</button></div>
      <p class="hint dossier-block-hint">Two or more tabs; each tab holds nested blocks as JSON (text, code, diagram, …). LLMs often edit tabs directly in the article JSON file.</p>
      <label>Caption (optional)<input data-block-caption value="${commonCaption}"></label>
      <div data-tab-editors>${tabs.map((tab, tabIndex) => `<fieldset class="dossier-tab-editor" data-tab-editor="${tabIndex}">
        <legend>Tab ${tabIndex + 1}</legend>
        <div class="row"><label>ID<input data-tab-id value="${esc(tab.id || '')}"></label><label>Label<input data-tab-label value="${esc(tab.label || '')}"></label></div>
        <label>Blocks JSON<textarea rows="10" data-tab-blocks-json spellcheck="false">${esc(JSON.stringify(tab.blocks || [], null, 2))}</textarea></label>
      </fieldset>`).join('')}</div>
      <button type="button" class="btn ghost small" data-tab-add>Add tab</button>`);
  }
  return dossierBlockHtml({ type: 'text', body: '' }, sectionIndex, blockIndex, deps);
}

function dossierSectionHtml(section, sectionIndex, deps) {
  const { esc } = deps;
  const blocks = section.blocks?.length ? section.blocks : [];
  return `<details class="dossier-section-editor" data-dossier-section="${sectionIndex}" open>
    <summary><strong>Section:</strong> <span data-section-title-preview>${esc(section.title || 'Untitled')}</span></summary>
    <div class="dossier-section-fields">
      <div class="row"><label>Title<input data-section-title value="${esc(section.title || '')}"></label>
      <label>ID<input data-section-id value="${esc(section.id || '')}" placeholder="section-slug"></label></div>
      <label>Section summary<textarea rows="2" data-section-summary>${esc(section.summary || '')}</textarea></label>
      <div class="dossier-blocks-host" data-dossier-blocks>${blocks.length
    ? blocks.map((block, blockIndex) => dossierBlockHtml(block, sectionIndex, blockIndex, deps)).join('')
    : '<p class="hint dossier-blocks-empty">No blocks in this section yet.</p>'}</div>
      <div class="dossier-section-actions">
        <label class="dossier-add-block-picker">Block type
          <select data-add-block-type>${BLOCK_TYPES.map(([v, l]) => `<option value="${v}" ${v === 'compare' ? 'selected' : ''}>${l}</option>`).join('')}</select>
        </label>
        <button type="button" class="btn small" data-dossier-add-block>${BLOCK_ADD_VERBS.compare}</button>
        <button type="button" class="btn danger ghost small" data-dossier-section-remove>Remove section</button>
      </div>
    </div>
  </details>`;
}

export function dossierEditorHtml(record, deps, config = {}) {
  const { esc, getPins = () => [], getPois = () => [] } = deps;
  const {
    title = 'Rich content',
    hint = 'Sections and blocks appear in the public modal. Collapse blocks while editing to reduce clutter.',
    showMap = false,
    showResearchMilestones = false,
    uploadFolder = deps.uploadFolder,
    uploadSubdir = deps.uploadSubdir,
    open = true,
  } = config;
  const editorDeps = { ...deps, uploadFolder, uploadSubdir };
  const dossier = normalizeFeatureDossierRaw(record, { forEditor: true });
  const assets = deps.imageAssetOptions().slice(0, 300);
  const pinList = getPins().length ? getPins() : getPois();
  const [px, py, pz] = dossier.map.position;
  const mapBlock = showMap ? `<details class="dossier-map-editor"><summary>Map &amp; location <span class="hint">(optional)</span></summary>
      <div class="row"><label>Atlas pin id<input data-dossier-map-poi list="dossierPinList" value="${esc(dossier.map.pinId || dossier.map.poiId)}" placeholder="ferry-dock"></label>
      <label>Label<input data-dossier-map-label value="${esc(dossier.map.label)}"></label></div>
      <label>Note<textarea data-dossier-map-note rows="2">${esc(dossier.map.note)}</textarea></label>
      <div class="row three"><label>X<input data-dossier-map-x value="${esc(px)}"></label><label>Y<input data-dossier-map-y value="${esc(py)}"></label><label>Z<input data-dossier-map-z value="${esc(pz)}"></label></div>
      <datalist id="dossierPinList">${pinList.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</datalist>
    </details>` : '';
  const milestoneBlock = showResearchMilestones ? `<h4>Research milestones</h4>
    <div data-dossier-milestones class="check-editor">${dossierMilestoneRows(dossier.researchMilestones, esc) || '<p class="hint">Optional checkpoints for research (separate from card tasks).</p>'}</div>
    <button type="button" class="btn ghost small" data-add-dossier-milestone>Add milestone</button>` : '';
  return `<details class="dossier-editor-fold" data-dossier-host ${open ? 'open' : ''}>
    <summary class="dossier-editor-fold-summary"><strong>${title}</strong> <span class="hint">— click to collapse</span></summary>
    <section class="dossier-editor dossier-editor-fold-body">
      <p class="hint">${hint}</p>
      <label>Overview<textarea data-dossier-overview rows="4" placeholder="Long-form intro…">${esc(dossier.overview)}</textarea></label>
      ${mapBlock}
      ${milestoneBlock}
      <h4>Sections</h4>
      <div data-dossier-sections>${dossier.sections.map((section, index) => dossierSectionHtml(section, index, editorDeps)).join('') || '<p class="hint">No sections yet — add one below.</p>'}</div>
      <button type="button" class="btn ghost small" data-add-dossier-section>Add section</button>
      <datalist id="dossierAssets">${assets.map((p) => `<option value="${esc(p)}">`).join('')}</datalist>
      ${renderDossierAssetPicker(editorDeps)}
      <div data-dossier-undo-bar class="dossier-undo-bar hidden" role="status">
        <span>Removed section “<strong data-undo-section-title>Untitled</strong>”.</span>
        <button type="button" class="btn small" data-dossier-undo-section>Undo</button>
        <button type="button" class="btn ghost small" data-dossier-dismiss-undo>Dismiss</button>
      </div>
    </section>
  </details>`;
}

export function featureDossierEditorHtml(feature, deps) {
  return dossierEditorHtml(feature, deps, {
    title: 'Research dossier',
    hint: 'Build notes, media, comparisons, galleries, and custom HTML. Map pin is optional — expand only when linking to a POI on the atlas.',
    showMap: true,
    showResearchMilestones: true,
    uploadFolder: 'media/features',
    open: true,
  });
}

function readBlockFromEl(el, { keepDrafts = false } = {}) {
  const type = el.querySelector('[data-block-type]')?.value || 'text';
  if (type === 'text') {
    const body = el.querySelector('[data-block-body]')?.value?.trim() || '';
    return keepDrafts || body ? { type, body: el.querySelector('[data-block-body]')?.value || '' } : null;
  }
  if (type === 'image' || type === 'video') {
    const path = el.querySelector('[data-block-path]')?.value?.trim() || '';
    if (!path && !keepDrafts) return null;
    const block = { type, path, caption: el.querySelector('[data-block-caption]')?.value?.trim() || '' };
    if (type === 'video') block.poster = el.querySelector('[data-block-poster]')?.value?.trim() || '';
    return block;
  }
  if (type === 'compare') {
    const items = [...el.querySelectorAll('[data-compare-row]')].map((row) => ({
      label: row.querySelector('[data-compare-label]')?.value?.trim() || '',
      path: row.querySelector('[data-compare-path]')?.value?.trim() || '',
    }));
    const padded = items.length >= 2 ? items : DEFAULT_COMPARE_ITEMS();
    if (!keepDrafts) {
      const withPaths = padded.filter((item) => item.path);
      if (withPaths.length < 2) return null;
      const variant = el.querySelector('[data-compare-variant]')?.value === 'fixed' ? 'fixed' : 'fluid';
      return { type, variant, caption: el.querySelector('[data-block-caption]')?.value?.trim() || '', items: withPaths };
    }
    const variant = el.querySelector('[data-compare-variant]')?.value === 'fixed' ? 'fixed' : 'fluid';
    return { type, variant, caption: el.querySelector('[data-block-caption]')?.value?.trim() || '', items: padded };
  }
  if (type === 'carousel') {
    const images = [...el.querySelectorAll('[data-carousel-row]')].map((row) => ({
      path: row.querySelector('[data-carousel-path]')?.value?.trim() || '',
      caption: row.querySelector('[data-carousel-caption]')?.value?.trim() || '',
    }));
    if (keepDrafts) {
      return { type, caption: el.querySelector('[data-block-caption]')?.value?.trim() || '', images: images.length >= 2 ? images : [{ path: '', caption: '' }, { path: '', caption: '' }] };
    }
    const filled = images.filter((item) => item.path);
    return filled.length >= 2 ? { type, caption: el.querySelector('[data-block-caption]')?.value?.trim() || '', images: filled } : null;
  }
  if (type === 'gallery') {
    const images = [...el.querySelectorAll('[data-gallery-row]')].map((row) => ({
      path: row.querySelector('[data-gallery-path]')?.value?.trim() || '',
      caption: row.querySelector('[data-gallery-caption]')?.value?.trim() || '',
    }));
    if (keepDrafts) {
      return { type, caption: el.querySelector('[data-block-caption]')?.value?.trim() || '', images: images.length ? images : [{ path: '', caption: '' }] };
    }
    const filled = images.filter((item) => item.path);
    return filled.length ? { type, caption: el.querySelector('[data-block-caption]')?.value?.trim() || '', images: filled } : null;
  }
  if (type === 'links') {
    const items = [...el.querySelectorAll('[data-link-row]')].map((row) => ({
      label: row.querySelector('[data-link-label]')?.value?.trim() || '',
      href: row.querySelector('[data-link-href]')?.value?.trim() || '',
    }));
    if (keepDrafts) return { type, items: items.length ? items : [{ label: '', href: '' }] };
    const filled = items
      .map((item) => ({ label: item.label, href: normalizeHrefForSave(item.href) }))
      .filter((item) => item.label && isValidHref(item.href));
    return filled.length ? { type, items: filled } : null;
  }
  if (type === 'figure') {
    const path = el.querySelector('[data-block-path]')?.value?.trim() || '';
    const body = el.querySelector('[data-block-body]')?.value?.trim() || '';
    const caption = el.querySelector('[data-block-caption]')?.value?.trim() || '';
    const layout = el.querySelector('[data-figure-layout]')?.value === 'side' ? 'side' : 'stacked';
    if (keepDrafts) {
      return { type, path: el.querySelector('[data-block-path]')?.value || '', body: el.querySelector('[data-block-body]')?.value || '', caption: el.querySelector('[data-block-caption]')?.value || '', layout };
    }
    if (!path || !isSafeDossierAssetPath(path) || (!body && !caption)) return null;
    return { type, path, body, caption, layout };
  }
  if (type === 'html') {
    const raw = el.querySelector('[data-block-html]')?.value || '';
    if (keepDrafts) return { type, html: raw };
    const html = sanitizeDossierHtml(raw);
    return html ? { type, html } : null;
  }
  if (type === 'diagram') {
    const source = el.querySelector('[data-block-diagram-source]')?.value || '';
    const title = el.querySelector('[data-block-diagram-title]')?.value?.trim() || '';
    const caption = el.querySelector('[data-block-diagram-caption]')?.value?.trim() || '';
    if (keepDrafts) return { type, source, title, caption };
    const trimmed = source.trim();
    return trimmed && trimmed.length <= 32000 ? { type, source: trimmed, title, caption } : null;
  }
  if (type === 'code') {
    const repo = el.querySelector('[data-code-repo]')?.value?.trim() || '';
    const path = el.querySelector('[data-code-path]')?.value?.trim() || '';
    const lines = el.querySelector('[data-code-lines]')?.value?.trim() || '';
    const language = el.querySelector('[data-code-language]')?.value?.trim() || '';
    const caption = el.querySelector('[data-block-caption]')?.value?.trim() || '';
    const body = el.querySelector('[data-code-body]')?.value || '';
    if (keepDrafts) return { type, repo, path, lines, language, caption, body };
    const trimmed = body.trim();
    if (!repo || !CODE_REPOS.includes(repo) || !path || !trimmed) return null;
    return { type, repo, path, lines, language, caption, body: trimmed };
  }
  if (type === 'tabs') {
    const caption = el.querySelector('[data-block-caption]')?.value?.trim() || '';
    const tabs = [...el.querySelectorAll('[data-tab-editor]')].map((row, index) => {
      const id = row.querySelector('[data-tab-id]')?.value?.trim() || `tab-${index + 1}`;
      const label = row.querySelector('[data-tab-label]')?.value?.trim() || `Tab ${index + 1}`;
      const raw = row.querySelector('[data-tab-blocks-json]')?.value || '[]';
      let blocks = [];
      try { blocks = JSON.parse(raw); } catch { blocks = []; }
      if (!Array.isArray(blocks)) blocks = [];
      if (keepDrafts) return { id, label, blocks };
      return { id, label, blocks: blocks.map(normalizeBlock).filter(Boolean) };
    }).filter((tab) => keepDrafts || tab.blocks.length);
    if (keepDrafts) {
      return {
        type,
        caption,
        tabs: tabs.length >= 2 ? tabs : [
          { id: 'writing', label: 'Writing', blocks: [] },
          { id: 'reading', label: 'Reading', blocks: [] },
        ],
      };
    }
    return tabs.length >= 2 ? { type, caption, tabs } : null;
  }
  return null;
}

export function readDossierFromDom($, options = {}) {
  const keepDrafts = options.keepDrafts !== false;
  const mountSelector = options.mountSelector || '#featureDossierMount';
  const mount = document.querySelector(mountSelector);
  const host = mount?.querySelector('[data-dossier-host]');
  if (!host) return null;
  const overview = host.querySelector('[data-dossier-overview]')?.value?.trim() || '';
  const mapPoi = host.querySelector('[data-dossier-map-poi]')?.value?.trim() || '';
  const mapLabel = host.querySelector('[data-dossier-map-label]')?.value?.trim() || '';
  const mapNote = host.querySelector('[data-dossier-map-note]')?.value?.trim() || '';
  const position = ['x', 'y', 'z'].map((axis) => Number(host.querySelector(`[data-dossier-map-${axis}]`)?.value));
  const hasMap = Boolean(host.querySelector('[data-dossier-map-poi]')) && (mapPoi || mapLabel || mapNote || position.some((n) => Number.isFinite(n)));
  const researchMilestones = [...host.querySelectorAll('[data-dossier-milestone]')].map((row) => ({
    label: row.querySelector('[data-dossier-milestone-label]')?.value?.trim() || '',
    done: Boolean(row.querySelector('[data-dossier-milestone-done]')?.checked),
  })).filter((item) => keepDrafts || item.label);
  const sections = [...host.querySelectorAll('[data-dossier-section]')].map((sectionEl, index) => {
    const title = sectionEl.querySelector('[data-section-title]')?.value?.trim() || `Section ${index + 1}`;
    const id = sectionEl.querySelector('[data-section-id]')?.value?.trim() || `section-${index + 1}`;
    const summary = sectionEl.querySelector('[data-section-summary]')?.value?.trim() || '';
    const blocks = [...sectionEl.querySelectorAll('[data-dossier-block]')].map((blockEl) => readBlockFromEl(blockEl, { keepDrafts })).filter((block) => keepDrafts || block);
    return { id, title, summary, blocks };
  }).filter((section) => keepDrafts || section.title || section.summary || section.blocks.length);

  const dossier = { overview, researchMilestones, sections };
  if (hasMap) {
    dossier.map = {
      pinId: mapPoi,
      poiId: undefined,
      label: mapLabel,
      note: mapNote,
      position: position.every((n) => Number.isFinite(n)) ? position : undefined,
    };
  }
  return dossier;
}

export const readFeatureDossierFromDom = readDossierFromDom;

function updatePathPreviewForInput(input, deps) {
  const wrap = input?.closest('.dossier-path-with-preview');
  const preview = wrap?.querySelector('[data-dossier-preview]');
  if (!preview) return;
  const path = input.value.trim();
  if (!path) {
    preview.className = 'dossier-path-preview dossier-path-preview--empty';
    preview.innerHTML = '<span>No preview</span>';
    return;
  }
  preview.className = 'dossier-path-preview';
  preview.innerHTML = `<img src="${deps.esc(deps.adminAssetUrl(path))}" alt="" loading="lazy" data-dossier-preview-img onerror="this.closest('[data-dossier-preview]').className='dossier-path-preview dossier-path-preview--broken';this.remove()" />`;
}

function createBlock(type) {
  if (type === 'compare') {
    return { type: 'compare', variant: 'fixed', caption: '', items: DEFAULT_COMPARE_ITEMS() };
  }
  if (type === 'text') return { type: 'text', body: '' };
  if (type === 'gallery') return { type: 'gallery', caption: '', images: [{ path: '', caption: '' }] };
  if (type === 'carousel') return { type: 'carousel', caption: '', images: [{ path: '', caption: '' }, { path: '', caption: '' }] };
  if (type === 'links') return { type: 'links', items: [{ label: '', href: '' }] };
  if (type === 'figure') return { type: 'figure', path: '', body: '', caption: '', layout: 'stacked' };
  if (type === 'html') return { type: 'html', html: '<p></p>' };
  if (type === 'diagram') return { type: 'diagram', title: '', caption: '', source: defaultDiagramSource() };
  if (type === 'code') return { type: 'code', repo: 'pokemon-resort', path: '', lines: '', language: '', caption: '', body: '' };
  if (type === 'tabs') {
    return {
      type: 'tabs',
      caption: '',
      tabs: [
        { id: 'writing', label: 'Writing', blocks: [{ type: 'text', body: '' }] },
        { id: 'reading', label: 'Reading', blocks: [{ type: 'text', body: '' }] },
      ],
    };
  }
  if (type === 'image' || type === 'video') return { type, path: '', caption: '' };
  return { type: 'text', body: '' };
}

function showDossierHtmlPreview(previewBtn, deps) {
  const blockEl = previewBtn.closest('[data-dossier-block]');
  const wrap = blockEl?.querySelector('[data-html-preview-wrap]');
  const preview = blockEl?.querySelector('[data-dossier-html-preview]');
  const raw = blockEl?.querySelector('[data-block-html]')?.value || '';
  if (!wrap || !preview) return;
  let html = '';
  try {
    html = sanitizeDossierHtml(raw);
  } catch {
    html = '';
  }
  wrap.hidden = false;
  wrap.classList.remove('is-hidden');
  if (html) {
    preview.innerHTML = html;
    preview.querySelectorAll('img[src]').forEach((img) => {
      const src = img.getAttribute('src')?.trim();
      if (src && deps?.adminAssetUrl) img.src = deps.adminAssetUrl(src);
    });
  } else {
    preview.innerHTML = '<p class="hint">Nothing to preview — use allowed tags (e.g. &lt;p&gt;, &lt;ul&gt;, &lt;img src=\"media/…\"&gt;) and site asset paths for images.</p>';
  }
}

function handleDossierMountClick(event, deps) {
  const { $, getRecord, onDirty, mountSelector = '#featureDossierMount' } = deps;
  const mount = document.querySelector(mountSelector);
  const host = mount?.querySelector('[data-dossier-host]');
  if (!mount || !host) return;

  const previewBtn = event.target.closest('[data-html-preview-btn]');
  if (previewBtn && mount.contains(previewBtn)) {
    event.preventDefault();
    showDossierHtmlPreview(previewBtn, deps);
    return;
  }

  const btn = event.target.closest('button');
  if (!btn || !mount.contains(btn)) return;

  const persist = () => {
    if (typeof getRecord !== 'function') return;
    const record = getRecord();
    if (!record) return;
    record.dossier = readDossierFromDom($, { keepDrafts: true, mountSelector });
    onDirty?.();
  };

  /** Re-render dossier UI from in-memory record (do not read DOM — would drop pending edits). */
  const refresh = () => {
    if (typeof getRecord !== 'function') return;
    const record = getRecord();
    if (!record || !mount) return;
    mount.innerHTML = deps.renderEditorHtml(record, deps);
    initDossierEditorMount(mount);
    onDirty();
  };

  if (btn.matches('[data-add-dossier-milestone]')) {
    event.preventDefault();
    const box = host.querySelector('[data-dossier-milestones]');
    if (!box) return;
    const hint = box.querySelector('.hint');
    hint?.remove();
    const index = box.querySelectorAll('[data-dossier-milestone]').length;
    box.insertAdjacentHTML('beforeend', `<div class="check-row" data-dossier-milestone="${index}">
      <input type="checkbox" data-dossier-milestone-done>
      <input value="" data-dossier-milestone-label placeholder="Research milestone">
      <button type="button" class="btn ghost small" data-dossier-milestone-remove>Remove</button>
    </div>`);
    persist();
    return;
  }

  if (btn.matches('[data-dossier-milestone-remove]')) {
    event.preventDefault();
    btn.closest('[data-dossier-milestone]')?.remove();
    persist();
    return;
  }

  if (btn.matches('[data-add-dossier-section]')) {
    event.preventDefault();
    persist();
    const record = getRecord();
    if (!record) return;
    if (!record.dossier) record.dossier = {};
    if (!Array.isArray(record.dossier.sections)) record.dossier.sections = [];
    record.dossier.sections.push({
      id: `section-${Date.now().toString().slice(-5)}`,
      title: 'New section',
      summary: '',
      blocks: [],
    });
    refresh();
    return;
  }

  if (btn.matches('[data-dossier-undo-section]')) {
    event.preventDefault();
    const payload = sectionUndoState.payload;
    if (!payload?.record?.dossier?.sections) return;
    payload.record.dossier.sections.splice(payload.index, 0, payload.section);
    clearSectionUndo();
    refresh();
    return;
  }

  if (btn.matches('[data-dossier-dismiss-undo]')) {
    event.preventDefault();
    clearSectionUndo();
    return;
  }

  if (btn.matches('[data-pick-asset-path]')) {
    event.preventDefault();
    const path = btn.dataset.pickAssetPath;
    const target = mount.querySelector('[data-dossier-last-path-target]')
      || mount.querySelector('[data-block-path], [data-compare-path], [data-carousel-path], [data-gallery-path], [data-block-poster]');
    if (target && path) {
      target.value = path;
      updatePathPreviewForInput(target, deps);
      persist();
    }
    return;
  }

  if (btn.matches('[data-dossier-upload-asset], [data-dossier-path-upload]')) {
    event.preventDefault();
    const input = btn.matches('[data-dossier-path-upload]')
      ? btn.closest('.dossier-path-with-preview')?.querySelector(DOSSIER_PATH_INPUT_SELECTOR)
      : null;
    runDossierUpload(deps, mount, persist, input);
    return;
  }

  if (btn.matches('[data-dossier-section-remove]')) {
    event.preventDefault();
    persist();
    const record = getRecord();
    const sectionEl = btn.closest('[data-dossier-section]');
    if (!record || !sectionEl) return;
    const sections = [...host.querySelectorAll('[data-dossier-section]')];
    const index = sections.indexOf(sectionEl);
    if (index < 0 || !record.dossier?.sections?.[index]) return;
    const title = record.dossier.sections[index].title || 'this section';
    if (!window.confirm(`Remove section “${title}”?`)) return;
    const removed = record.dossier.sections.splice(index, 1)[0];
    showSectionUndo(record, removed, index, mount);
    refresh();
    return;
  }

  if (btn.matches('[data-dossier-block-remove]')) {
    event.preventDefault();
    btn.closest('[data-dossier-block]')?.remove();
    persist();
    return;
  }

  const addBlock = (type) => {
    persist();
    const record = getRecord();
    const sectionEl = btn.closest('[data-dossier-section]');
    if (!record || !sectionEl) return;
    const sections = [...host.querySelectorAll('[data-dossier-section]')];
    const index = sections.indexOf(sectionEl);
    if (index < 0) return;
    if (!record.dossier) record.dossier = {};
    if (!Array.isArray(record.dossier.sections)) record.dossier.sections = [];
    while (record.dossier.sections.length <= index) {
      record.dossier.sections.push({ id: `section-${record.dossier.sections.length + 1}`, title: 'New section', summary: '', blocks: [] });
    }
    const blocks = record.dossier.sections[index].blocks || (record.dossier.sections[index].blocks = []);
    blocks.push(createBlock(type));
    refresh();
  };

  if (btn.matches('[data-dossier-add-block]')) {
    event.preventDefault();
    const type = btn.closest('[data-dossier-section]')?.querySelector('[data-add-block-type]')?.value
      || btn.dataset.addBlockType
      || 'text';
    addBlock(type);
    return;
  }

  if (btn.matches('[data-compare-add]')) {
    event.preventDefault();
    persist();
    const record = getRecord();
    const blockEl = btn.closest('[data-dossier-block]');
    const sectionEl = btn.closest('[data-dossier-section]');
    if (!record || !blockEl || !sectionEl) return;
    const sectionIndex = [...host.querySelectorAll('[data-dossier-section]')].indexOf(sectionEl);
    const blockIndex = [...sectionEl.querySelectorAll('[data-dossier-block]')].indexOf(blockEl);
    const block = record.dossier?.sections?.[sectionIndex]?.blocks?.[blockIndex];
    if (block?.type !== 'compare') return;
    block.items = block.items || DEFAULT_COMPARE_ITEMS();
    block.items.push({ path: '', label: '' });
    refresh();
    return;
  }

  if (btn.matches('[data-gallery-add]')) {
    event.preventDefault();
    persist();
    const record = getRecord();
    const blockEl = btn.closest('[data-dossier-block]');
    const sectionEl = btn.closest('[data-dossier-section]');
    if (!record || !blockEl || !sectionEl) return;
    const sectionIndex = [...host.querySelectorAll('[data-dossier-section]')].indexOf(sectionEl);
    const blockIndex = [...sectionEl.querySelectorAll('[data-dossier-block]')].indexOf(blockEl);
    const block = record.dossier?.sections?.[sectionIndex]?.blocks?.[blockIndex];
    if (block?.type !== 'gallery') return;
    block.images = block.images || [];
    block.images.push({ path: '', caption: '' });
    refresh();
    return;
  }

  if (btn.matches('[data-carousel-add]')) {
    event.preventDefault();
    persist();
    const record = getRecord();
    const blockEl = btn.closest('[data-dossier-block]');
    const sectionEl = btn.closest('[data-dossier-section]');
    if (!record || !blockEl || !sectionEl) return;
    const sectionIndex = [...host.querySelectorAll('[data-dossier-section]')].indexOf(sectionEl);
    const blockIndex = [...sectionEl.querySelectorAll('[data-dossier-block]')].indexOf(blockEl);
    const block = record.dossier?.sections?.[sectionIndex]?.blocks?.[blockIndex];
    if (block?.type !== 'carousel') return;
    block.images = block.images || [];
    block.images.push({ path: '', caption: '' });
    refresh();
    return;
  }

  if (btn.matches('[data-link-add]')) {
    event.preventDefault();
    persist();
    const record = getRecord();
    const blockEl = btn.closest('[data-dossier-block]');
    const sectionEl = btn.closest('[data-dossier-section]');
    if (!record || !blockEl || !sectionEl) return;
    const sectionIndex = [...host.querySelectorAll('[data-dossier-section]')].indexOf(sectionEl);
    const blockIndex = [...sectionEl.querySelectorAll('[data-dossier-block]')].indexOf(blockEl);
    const block = record.dossier?.sections?.[sectionIndex]?.blocks?.[blockIndex];
    if (block?.type !== 'links') return;
    block.items = block.items || [];
    block.items.push({ label: '', href: '' });
    refresh();
    return;
  }

  if (btn.matches('[data-compare-remove], [data-gallery-remove], [data-carousel-remove], [data-link-remove]')) {
    event.preventDefault();
    if (btn.disabled) return;
    btn.closest('[data-compare-row], [data-gallery-row], [data-carousel-row], [data-link-row]')?.remove();
    persist();
    return;
  }

}

function handleDossierMountChange(event, deps) {
  const { $, getRecord, onDirty, mountSelector = '#featureDossierMount' } = deps;
  const mount = document.querySelector(mountSelector);
  const host = mount?.querySelector('[data-dossier-host]');
  if (!mount || !host || !mount.contains(event.target)) return;

  const persist = () => {
    if (typeof getRecord !== 'function') return;
    const record = getRecord();
    if (!record) return;
    record.dossier = readDossierFromDom($, { keepDrafts: true, mountSelector });
    onDirty?.();
  };

  if (event.target.matches('[data-add-block-type]')) {
    syncAddBlockButton(event.target);
    return;
  }

  if (event.target.matches('[data-block-type]')) {
    persist();
    const record = getRecord();
    const blockEl = event.target.closest('[data-dossier-block]');
    const sectionEl = event.target.closest('[data-dossier-section]');
    if (!record || !blockEl || !sectionEl) return;
    const sectionIndex = [...host.querySelectorAll('[data-dossier-section]')].indexOf(sectionEl);
    const blockIndex = [...sectionEl.querySelectorAll('[data-dossier-block]')].indexOf(blockEl);
    const block = record.dossier?.sections?.[sectionIndex]?.blocks?.[blockIndex];
    if (!block) return;
    const next = createBlock(event.target.value);
    record.dossier.sections[sectionIndex].blocks[blockIndex] = next;
    if (mount && record) {
      mount.innerHTML = deps.renderEditorHtml(record, deps);
      initSectionAddBlockButtons(mount);
      onDirty();
    }
    return;
  }

  if (event.target.matches('[data-section-title]')) {
    const preview = event.target.closest('[data-dossier-section]')?.querySelector('[data-section-title-preview]');
    if (preview) preview.textContent = event.target.value.trim() || 'Untitled';
  }

  persist();
}

export function bindDossierEditor(deps) {
  const { $, mountSelector = '#featureDossierMount', renderEditorHtml = featureDossierEditorHtml } = deps;
  if (typeof $ !== 'function') return;
  const mount = document.querySelector(mountSelector);
  if (!mount) return;
  const editorDeps = { ...deps, mountSelector, renderEditorHtml, readDossierFromDom };

  initDossierEditorMount(mount);
  registerDiagramMountHandlers(mountSelector, editorDeps);
  bindDiagramEditorButtons();

  if (mount.dataset.dossierBound !== '1') {
    mount.dataset.dossierBound = '1';
    let dossierInputTimer = 0;
    let assetSearchTimer = 0;
    mount.addEventListener('click', (event) => handleDossierMountClick(event, editorDeps));
    mount.addEventListener('change', (event) => handleDossierMountChange(event, editorDeps));
    mount.addEventListener('focusin', (event) => {
      if (!event.target.matches('[data-block-path], [data-compare-path], [data-carousel-path], [data-gallery-path], [data-block-poster]')) return;
      mount.querySelectorAll('[data-dossier-last-path-target]').forEach((el) => el.removeAttribute('data-dossier-last-path-target'));
      event.target.setAttribute('data-dossier-last-path-target', '1');
    });
    mount.addEventListener('input', (event) => {
      if (!event.target.closest('[data-dossier-host]')) return;
      if (event.target.matches('[data-section-title]')) {
        const preview = event.target.closest('[data-dossier-section]')?.querySelector('[data-section-title-preview]');
        if (preview) preview.textContent = event.target.value.trim() || 'Untitled';
      }
      if (event.target.id === 'dossierAssetSearch') {
        window.clearTimeout(assetSearchTimer);
        assetSearchTimer = window.setTimeout(() => {
          const picker = mount.querySelector('.dossier-asset-picker');
          if (picker) {
            const q = event.target.value;
            const next = renderDossierAssetPicker(deps, q);
            picker.outerHTML = next;
          }
        }, 200);
        return;
      }
      if (event.target.matches('[data-link-href]')) {
        const row = event.target.closest('[data-link-row]');
        const href = event.target.value.trim();
        const invalid = href && !isValidHref(href);
        row?.classList.toggle('dossier-link-row--invalid', Boolean(invalid));
        const hint = row?.querySelector('.link-invalid-hint');
        if (invalid && !hint) {
          event.target.insertAdjacentHTML('afterend', '<span class="hint link-invalid-hint">Invalid URL — use https://… or mailto:name@example.com</span>');
        } else if (!invalid) hint?.remove();
      }
      if (event.target.matches('[data-block-path], [data-compare-path], [data-carousel-path], [data-gallery-path], [data-block-poster]')) {
        updatePathPreviewForInput(event.target, deps);
      }
      window.clearTimeout(dossierInputTimer);
      dossierInputTimer = window.setTimeout(() => {
        const record = deps.getRecord?.();
        if (!record) return;
        record.dossier = readDossierFromDom(deps.$, { keepDrafts: true, mountSelector });
        deps.onDirty?.();
      }, 280);
    });
  }
}

export const bindFeatureDossierEditor = bindDossierEditor;
