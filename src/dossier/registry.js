import { normalizeImages } from '../lib/images.js';
import { isValidPublicHref, normalizePublicHref } from '../lib/linkUtils.js';
import { extractImagePathsFromHtml, isSafeDossierAssetPath, sanitizeDossierHtml } from '../lib/sanitizeHtml.js';

/** @typedef {{ type: string, label: string, normalize: (block: object) => object | null, collectImages?: (block: object) => Array<{path:string,caption?:string}> }} DossierBlockDef */

const CODE_REPOS = new Set([
  'pokemon-resort',
  'pokemon-resort-page',
  'spmk',
  'island-dreamforge',
  'pokemon-ds-map-studio',
]);

function isSafeRepoPath(path) {
  const p = String(path || '').trim();
  if (!p || p.startsWith('/') || p.includes('..')) return false;
  return /^[\w./-]+$/.test(p);
}

export function normalizeDossierBlocks(blocks) {
  return (Array.isArray(blocks) ? blocks : [])
    .map(normalizeDossierBlock)
    .filter(Boolean);
}

const registry = new Map();

/**
 * Register a dossier block type. To add a custom block:
 * 1. Call registerDossierBlock({ type, label, normalize, collectImages? })
 * 2. Add a React view in src/components/dossier/blockViews.jsx
 * 3. Add admin editor HTML in tools/admin/public/feature-dossier-editor.js
 */
export function registerDossierBlock(def) {
  if (!def?.type || !def.normalize) throw new Error('Dossier block requires type and normalize');
  registry.set(def.type, { collectImages: () => [], ...def });
}

export function getDossierBlock(type) {
  return registry.get(type);
}

export function getDossierBlockTypes() {
  return [...registry.values()];
}

export function normalizeDossierBlock(block) {
  const type = String(block?.type || '').trim();
  const def = registry.get(type);
  return def ? def.normalize(block) : null;
}

export function collectImagesFromBlock(block) {
  const def = registry.get(block?.type);
  return def?.collectImages?.(block) || [];
}

function normalizeCompareItems(items) {
  return (Array.isArray(items) ? items : [])
    .map((item) => ({
      path: String(item?.path || '').trim(),
      label: String(item?.label || '').trim(),
      caption: String(item?.caption || '').trim(),
    }))
    .filter((item) => item.path);
}

registerDossierBlock({
  type: 'text',
  label: 'Text note',
  normalize(block) {
    const body = String(block.body || block.text || '').trim();
    return body ? { type: 'text', body } : null;
  },
});

registerDossierBlock({
  type: 'image',
  label: 'Image',
  normalize(block) {
    const path = String(block.path || '').trim();
    if (!path) return null;
    return { type: 'image', path, caption: String(block.caption || '').trim() };
  },
  collectImages(block) {
    return [{ path: block.path, caption: block.caption }];
  },
});

registerDossierBlock({
  type: 'video',
  label: 'Video',
  normalize(block) {
    const path = String(block.path || '').trim();
    if (!path) return null;
    return {
      type: 'video',
      path,
      caption: String(block.caption || '').trim(),
      poster: String(block.poster || '').trim() || undefined,
    };
  },
});

registerDossierBlock({
  type: 'compare',
  label: 'Side-by-side compare',
  normalize(block) {
    const items = normalizeCompareItems(block.items);
    if (items.length < 2) return null;
    const variant = block.variant === 'fixed' ? 'fixed' : 'fluid';
    return {
      type: 'compare',
      variant,
      caption: String(block.caption || '').trim(),
      items,
    };
  },
  collectImages(block) {
    return block.items.map((item) => ({ path: item.path, caption: item.caption || item.label }));
  },
});

registerDossierBlock({
  type: 'carousel',
  label: 'Carousel',
  normalize(block) {
    const images = normalizeImages(block.images);
    if (images.length < 2) return null;
    return {
      type: 'carousel',
      caption: String(block.caption || '').trim(),
      images,
    };
  },
  collectImages(block) {
    return block.images;
  },
});

registerDossierBlock({
  type: 'gallery',
  label: 'Image gallery (grid)',
  normalize(block) {
    const images = normalizeImages(block.images);
    if (!images.length) return null;
    return { type: 'gallery', caption: String(block.caption || '').trim(), images };
  },
  collectImages(block) {
    return block.images;
  },
});

registerDossierBlock({
  type: 'links',
  label: 'Links',
  normalize(block) {
    const items = (Array.isArray(block.items) ? block.items : [])
      .map((item) => ({
        label: String(item?.label || '').trim(),
        href: normalizePublicHref(item?.href || item?.url || ''),
      }))
      .filter((item) => item.label && isValidPublicHref(item.href));
    return items.length ? { type: 'links', items } : null;
  },
});

registerDossierBlock({
  type: 'figure',
  label: 'Text + image',
  normalize(block) {
    const path = String(block.path || '').trim();
    if (!path || !isSafeDossierAssetPath(path)) return null;
    const body = String(block.body || block.text || '').trim();
    const caption = String(block.caption || '').trim();
    const layout = block.layout === 'side' ? 'side' : 'stacked';
    if (!body && !caption) return null;
    return { type: 'figure', path, body, caption, layout };
  },
  collectImages(block) {
    return [{ path: block.path, caption: block.caption || block.body }];
  },
});

registerDossierBlock({
  type: 'html',
  label: 'Custom HTML',
  normalize(block) {
    const html = sanitizeDossierHtml(block.html || block.content || '');
    return html ? { type: 'html', html } : null;
  },
  collectImages(block) {
    return extractImagePathsFromHtml(block.html).map((path) => ({ path, caption: '' }));
  },
});

registerDossierBlock({
  type: 'diagram',
  label: 'UML diagram',
  normalize(block) {
    const source = String(block.source || block.mermaid || '').trim();
    if (!source || source.length > 32000) return null;
    const title = String(block.title || '').trim();
    const caption = String(block.caption || '').trim();
    return { type: 'diagram', source, title, caption };
  },
});

registerDossierBlock({
  type: 'code',
  label: 'Linked code',
  normalize(block) {
    const repo = String(block.repo || '').trim();
    const path = String(block.path || '').trim();
    const body = String(block.body || block.code || '').trim();
    if (!repo || !CODE_REPOS.has(repo) || !isSafeRepoPath(path) || !body) return null;
    const lines = String(block.lines || block.lineRange || '').trim();
    const language = String(block.language || block.lang || '').trim();
    const caption = String(block.caption || '').trim();
    return {
      type: 'code',
      repo,
      path,
      lines: lines || undefined,
      language: language || undefined,
      caption: caption || undefined,
      body,
    };
  },
});

registerDossierBlock({
  type: 'tabs',
  label: 'Tabbed section',
  normalize(block) {
    const tabs = (Array.isArray(block.tabs) ? block.tabs : [])
      .map((tab, index) => {
        const id = String(tab?.id || `tab-${index + 1}`).trim();
        const label = String(tab?.label || tab?.title || '').trim() || `Tab ${index + 1}`;
        const blocks = normalizeDossierBlocks(tab?.blocks);
        if (!blocks.length) return null;
        return { id, label, blocks };
      })
      .filter(Boolean);
    if (tabs.length < 2) return null;
    return {
      type: 'tabs',
      caption: String(block.caption || '').trim() || undefined,
      tabs,
    };
  },
  collectImages(block) {
    return block.tabs.flatMap((tab) => tab.blocks.flatMap((nested) => collectImagesFromBlock(nested)));
  },
});
