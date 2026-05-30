/** @typedef {{ esc: Function, $: Function, adminAssetUrl: Function, imageAssetOptions: Function, getPois: Function, getMilestones: Function }} DossierDeps */

/** Keep in sync with src/dossier/registry.js + src/components/dossier/blockViews.jsx */
const BLOCK_TYPES = [
  ['text', 'Text note'],
  ['image', 'Image'],
  ['video', 'Video'],
  ['compare', 'Side-by-side compare'],
  ['carousel', 'Carousel'],
  ['gallery', 'Image gallery (grid)'],
  ['links', 'Links'],
];

/** Button label for “Add …” — stays in sync with the section dropdown */
const BLOCK_ADD_VERBS = {
  text: 'Add text note',
  image: 'Add image',
  video: 'Add video',
  compare: 'Add side-by-side',
  carousel: 'Add carousel',
  gallery: 'Add image gallery',
  links: 'Add links',
};

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
      poiId: String(map.poiId || '').trim(),
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
  const dossier = normalizeFeatureDossierRaw(feature);
  return Boolean(dossier.overview.trim() || dossier.sections.length || dossier.researchMilestones.length
    || dossier.map.poiId || dossier.map.label || dossier.map.note);
}

function dossierMilestoneRows(items, esc) {
  return items.map((item, i) => `<div class="check-row" data-dossier-milestone="${i}">
    <input type="checkbox" ${item.done ? 'checked' : ''} data-dossier-milestone-done>
    <input value="${esc(item.label)}" data-dossier-milestone-label placeholder="Research milestone">
    <button type="button" class="btn ghost small" data-dossier-milestone-remove>Remove</button>
  </div>`).join('');
}

function dossierBlockHtml(block, sectionIndex, blockIndex, esc) {
  const type = block?.type || 'text';
  const commonCaption = esc(block?.caption || '');
  if (type === 'text') {
    return `<div class="dossier-block-editor" data-dossier-block data-section="${sectionIndex}" data-block="${blockIndex}">
      <div class="dossier-block-toolbar"><select data-block-type>${BLOCK_TYPES.map(([v, l]) => `<option value="${v}" ${v === type ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <button type="button" class="btn ghost small" data-dossier-block-remove>Remove block</button></div>
      <label>Text<textarea rows="4" data-block-body>${esc(block?.body || block?.text || '')}</textarea></label>
    </div>`;
  }
  if (type === 'image' || type === 'video') {
    return `<div class="dossier-block-editor" data-dossier-block data-section="${sectionIndex}" data-block="${blockIndex}">
      <div class="dossier-block-toolbar"><select data-block-type>${BLOCK_TYPES.map(([v, l]) => `<option value="${v}" ${v === type ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <button type="button" class="btn ghost small" data-dossier-block-remove>Remove block</button></div>
      <div class="row"><label>File path<input data-block-path list="dossierAssets" value="${esc(block?.path || '')}" placeholder="media/… or assets/…"></label>
      <label>Caption<input data-block-caption value="${commonCaption}"></label></div>
      ${type === 'video' ? `<label>Poster (optional)<input data-block-poster value="${esc(block?.poster || '')}" list="dossierAssets"></label>` : ''}
    </div>`;
  }
  if (type === 'compare') {
    const items = block?.items?.length >= 2 ? block.items : DEFAULT_COMPARE_ITEMS();
    const variant = block?.variant === 'fixed' ? 'fixed' : 'fluid';
    return `<div class="dossier-block-editor dossier-block-compare" data-dossier-block data-section="${sectionIndex}" data-block="${blockIndex}">
      <div class="dossier-block-toolbar"><select data-block-type>${BLOCK_TYPES.map(([v, l]) => `<option value="${v}" ${v === type ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <button type="button" class="btn ghost small" data-dossier-block-remove>Remove block</button></div>
      <p class="hint dossier-block-hint">Add image paths for each panel. Fixed layout keeps panels side-by-side on wide screens.</p>
      <label>Layout<select data-compare-variant><option value="fluid" ${variant === 'fluid' ? 'selected' : ''}>Fluid (responsive)</option><option value="fixed" ${variant === 'fixed' ? 'selected' : ''}>Fixed (side by side)</option></select></label>
      <label>Caption<input data-block-caption value="${commonCaption}"></label>
      <div class="dossier-compare-items" data-compare-items>${items.map((item, idx) => `<div class="dossier-compare-row" data-compare-row="${idx}">
        <label>Label<input data-compare-label value="${esc(item.label || '')}"></label>
        <label>Path<input data-compare-path list="dossierAssets" value="${esc(item.path || '')}" placeholder="assets/…"></label>
        <button type="button" class="btn ghost small" data-compare-remove ${items.length <= 2 ? 'disabled' : ''} title="Need at least 2 panels">×</button>
      </div>`).join('')}</div>
      <button type="button" class="btn ghost small" data-compare-add>Add panel</button>
    </div>`;
  }
  if (type === 'carousel') {
    const images = Array.isArray(block?.images) && block.images.length >= 2 ? block.images : [{ path: '', caption: '' }, { path: '', caption: '' }];
    return `<div class="dossier-block-editor" data-dossier-block data-section="${sectionIndex}" data-block="${blockIndex}">
      <div class="dossier-block-toolbar"><select data-block-type>${BLOCK_TYPES.map(([v, l]) => `<option value="${v}" ${v === type ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <button type="button" class="btn ghost small" data-dossier-block-remove>Remove block</button></div>
      <label>Carousel caption<input data-block-caption value="${commonCaption}"></label>
      <div class="dossier-gallery-items" data-carousel-items>${images.map((img, idx) => {
        const path = typeof img === 'string' ? img : img?.path;
        const caption = typeof img === 'string' ? '' : img?.caption;
        return `<div class="dossier-gallery-row" data-carousel-row="${idx}">
          <label>Path<input data-carousel-path list="dossierAssets" value="${esc(path || '')}"></label>
          <label>Caption<input data-carousel-caption value="${esc(caption || '')}"></label>
          <button type="button" class="btn ghost small" data-carousel-remove ${images.length <= 2 ? 'disabled' : ''}>×</button>
        </div>`;
      }).join('')}</div>
      <button type="button" class="btn ghost small" data-carousel-add>Add slide</button>
    </div>`;
  }
  if (type === 'gallery') {
    const images = Array.isArray(block?.images) && block.images.length ? block.images : [{ path: '', caption: '' }];
    return `<div class="dossier-block-editor" data-dossier-block data-section="${sectionIndex}" data-block="${blockIndex}">
      <div class="dossier-block-toolbar"><select data-block-type>${BLOCK_TYPES.map(([v, l]) => `<option value="${v}" ${v === type ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <button type="button" class="btn ghost small" data-dossier-block-remove>Remove block</button></div>
      <label>Gallery caption<input data-block-caption value="${commonCaption}"></label>
      <div class="dossier-gallery-items" data-gallery-items>${images.map((img, idx) => {
        const path = typeof img === 'string' ? img : img?.path;
        const caption = typeof img === 'string' ? '' : img?.caption;
        return `<div class="dossier-gallery-row" data-gallery-row="${idx}">
          <label>Path<input data-gallery-path list="dossierAssets" value="${esc(path || '')}"></label>
          <label>Caption<input data-gallery-caption value="${esc(caption || '')}"></label>
          <button type="button" class="btn ghost small" data-gallery-remove>×</button>
        </div>`;
      }).join('')}</div>
      <button type="button" class="btn ghost small" data-gallery-add>Add image</button>
    </div>`;
  }
  if (type === 'links') {
    const items = Array.isArray(block?.items) && block.items.length ? block.items : [{ label: '', href: '' }];
    return `<div class="dossier-block-editor" data-dossier-block data-section="${sectionIndex}" data-block="${blockIndex}">
      <div class="dossier-block-toolbar"><select data-block-type>${BLOCK_TYPES.map(([v, l]) => `<option value="${v}" ${v === type ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <button type="button" class="btn ghost small" data-dossier-block-remove>Remove block</button></div>
      <div data-link-items>${items.map((item, idx) => `<div class="dossier-link-row" data-link-row="${idx}">
        <label>Label<input data-link-label value="${esc(item.label || '')}"></label>
        <label>URL<input data-link-href value="${esc(item.href || item.url || '')}"></label>
        <button type="button" class="btn ghost small" data-link-remove>×</button>
      </div>`).join('')}</div>
      <button type="button" class="btn ghost small" data-link-add>Add link</button>
    </div>`;
  }
  return dossierBlockHtml({ type: 'text', body: '' }, sectionIndex, blockIndex, esc);
}

function dossierSectionHtml(section, sectionIndex, esc) {
  const blocks = section.blocks?.length ? section.blocks : [];
  return `<details class="dossier-section-editor" data-dossier-section="${sectionIndex}" open>
    <summary><strong>Section:</strong> <span data-section-title-preview>${esc(section.title || 'Untitled')}</span></summary>
    <div class="dossier-section-fields">
      <div class="row"><label>Title<input data-section-title value="${esc(section.title || '')}"></label>
      <label>ID<input data-section-id value="${esc(section.id || '')}" placeholder="section-slug"></label></div>
      <label>Section summary<textarea rows="2" data-section-summary>${esc(section.summary || '')}</textarea></label>
      <div class="dossier-blocks-host" data-dossier-blocks>${blocks.length
    ? blocks.map((block, blockIndex) => dossierBlockHtml(block, sectionIndex, blockIndex, esc)).join('')
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

export function featureDossierEditorHtml(feature, deps) {
  const { esc, getPois } = deps;
  const dossier = normalizeFeatureDossierRaw(feature, { forEditor: true });
  const assets = deps.imageAssetOptions();
  const pois = getPois();
  const [px, py, pz] = dossier.map.position;
  return `<section class="dossier-editor" id="featureDossierHost">
    <h3>Research dossier <span class="hint">rich modal on the public board</span></h3>
    <p class="hint">Build per-generation notes, side-by-side comparisons, videos, galleries, map pins, and milestones. Incomplete blocks stay visible until paths are filled in.</p>
    <label>Overview<textarea id="dossierOverview" rows="4" placeholder="Long-form intro: goals, scope, what visitors should understand…">${esc(dossier.overview)}</textarea></label>
    <details class="dossier-map-editor"><summary>Map &amp; location</summary>
      <div class="row"><label>POI id<input id="dossierMapPoi" list="dossierPoiList" value="${esc(dossier.map.poiId)}" placeholder="poi-…"></label>
      <label>Label<input id="dossierMapLabel" value="${esc(dossier.map.label)}"></label></div>
      <label>Note<textarea id="dossierMapNote" rows="2">${esc(dossier.map.note)}</textarea></label>
      <div class="row three"><label>X<input id="dossierMapX" value="${esc(px)}"></label><label>Y<input id="dossierMapY" value="${esc(py)}"></label><label>Z<input id="dossierMapZ" value="${esc(pz)}"></label></div>
      <datalist id="dossierPoiList">${pois.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</datalist>
    </details>
    <h4>Research milestones</h4>
    <div id="dossierMilestones" class="check-editor">${dossierMilestoneRows(dossier.researchMilestones, esc) || '<p class="hint">Optional checkpoints for research (separate from card tasks).</p>'}</div>
    <button type="button" class="btn ghost small" id="addDossierMilestone">Add milestone</button>
    <h4>Sections</h4>
    <div id="dossierSections">${dossier.sections.map((section, index) => dossierSectionHtml(section, index, esc)).join('') || '<p class="hint">No sections yet — add one below (e.g. “Gen III”, “UI mocks”).</p>'}</div>
    <button type="button" class="btn ghost small" id="addDossierSection">Add section</button>
    <datalist id="dossierAssets">${assets.map((p) => `<option value="${esc(p)}">`).join('')}</datalist>
  </section>`;
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
    const filled = items.filter((item) => item.label && item.href);
    return filled.length ? { type, items: filled } : null;
  }
  return null;
}

export function readFeatureDossierFromDom($, options = {}) {
  const keepDrafts = options.keepDrafts !== false;
  const host = $('#featureDossierHost');
  if (!host) return null;
  const overview = $('#dossierOverview')?.value?.trim() || '';
  const mapPoi = $('#dossierMapPoi')?.value?.trim() || '';
  const mapLabel = $('#dossierMapLabel')?.value?.trim() || '';
  const mapNote = $('#dossierMapNote')?.value?.trim() || '';
  const position = ['dossierMapX', 'dossierMapY', 'dossierMapZ'].map((id) => Number($(`#${id}`)?.value));
  const hasMap = mapPoi || mapLabel || mapNote || position.some((n) => Number.isFinite(n));
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
      poiId: mapPoi,
      label: mapLabel,
      note: mapNote,
      position: position.every((n) => Number.isFinite(n)) ? position : undefined,
    };
  }
  return dossier;
}

function createBlock(type) {
  if (type === 'compare') {
    return { type: 'compare', variant: 'fixed', caption: '', items: DEFAULT_COMPARE_ITEMS() };
  }
  if (type === 'text') return { type: 'text', body: '' };
  if (type === 'gallery') return { type: 'gallery', caption: '', images: [{ path: '', caption: '' }] };
  if (type === 'carousel') return { type: 'carousel', caption: '', images: [{ path: '', caption: '' }, { path: '', caption: '' }] };
  if (type === 'links') return { type: 'links', items: [{ label: '', href: '' }] };
  if (type === 'image' || type === 'video') return { type, path: '', caption: '' };
  return { type: 'text', body: '' };
}

function handleDossierMountClick(event, deps) {
  const { $, getRecord, onDirty } = deps;
  const mount = $('#featureDossierMount');
  const host = $('#featureDossierHost');
  if (!mount || !host) return;

  const btn = event.target.closest('button');
  if (!btn || !mount.contains(btn)) return;

  const persist = () => {
    const record = getRecord();
    if (!record) return;
    record.dossier = readFeatureDossierFromDom($, { keepDrafts: true });
    onDirty();
  };

  /** Re-render dossier UI from in-memory record (do not read DOM — would drop pending edits). */
  const refresh = () => {
    const record = getRecord();
    if (!record || !mount) return;
    mount.innerHTML = featureDossierEditorHtml(record, deps);
    initSectionAddBlockButtons(mount);
    onDirty();
  };

  if (btn.id === 'addDossierMilestone') {
    event.preventDefault();
    const box = $('#dossierMilestones');
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

  if (btn.id === 'addDossierSection') {
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

  if (btn.matches('[data-dossier-section-remove]')) {
    event.preventDefault();
    const sectionEl = btn.closest('[data-dossier-section]');
    if (!sectionEl) return;
    const title = sectionEl.querySelector('[data-section-title]')?.value?.trim() || 'this section';
    if (!window.confirm(`Remove section “${title}”?`)) return;
    sectionEl.remove();
    persist();
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
  const { $, getRecord, onDirty } = deps;
  const mount = $('#featureDossierMount');
  const host = $('#featureDossierHost');
  if (!mount || !host || !mount.contains(event.target)) return;

  const persist = () => {
    const record = getRecord();
    if (!record) return;
    record.dossier = readFeatureDossierFromDom($, { keepDrafts: true });
    onDirty();
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
    const mountEl = $('#featureDossierMount');
    if (mountEl && record) {
      mountEl.innerHTML = featureDossierEditorHtml(record, deps);
      initSectionAddBlockButtons(mountEl);
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

export function bindFeatureDossierEditor(deps) {
  const { $ } = deps;
  if (typeof $ !== 'function') return;
  const mount = $('#featureDossierMount');
  if (!mount) return;

  initSectionAddBlockButtons(mount);

  if (mount.dataset.dossierBound !== '1') {
    mount.dataset.dossierBound = '1';
    mount.addEventListener('click', (event) => handleDossierMountClick(event, deps));
    mount.addEventListener('change', (event) => handleDossierMountChange(event, deps));
    mount.addEventListener('input', (event) => {
      if (event.target.matches('[data-section-title]')) {
        const preview = event.target.closest('[data-dossier-section]')?.querySelector('[data-section-title-preview]');
        if (preview) preview.textContent = event.target.value.trim() || 'Untitled';
      }
    });
  }
}
