import { normalizeImages } from '../lib/images.js';

/** @typedef {{ type: string, label: string, normalize: (block: object) => object | null, collectImages?: (block: object) => Array<{path:string,caption?:string}> }} DossierBlockDef */

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
        href: String(item?.href || item?.url || '').trim(),
      }))
      .filter((item) => item.label && item.href);
    return items.length ? { type: 'links', items } : null;
  },
});
