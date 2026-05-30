import { normalizeImages } from './images.js';
import { collectImagesFromBlock, normalizeDossierBlock } from '../dossier/index.js';

function normalizeSection(section, index) {
  const title = String(section?.title || '').trim() || `Section ${index + 1}`;
  const blocks = (Array.isArray(section?.blocks) ? section.blocks : [])
    .map(normalizeDossierBlock)
    .filter(Boolean);
  return {
    id: String(section?.id || `section-${index + 1}`).trim(),
    title,
    summary: String(section?.summary || '').trim(),
    blocks,
  };
}

function normalizeMap(map) {
  if (!map || typeof map !== 'object') return null;
  const poiId = String(map.poiId || '').trim();
  const label = String(map.label || '').trim();
  const note = String(map.note || '').trim();
  const position = Array.isArray(map.position)
    ? map.position.map((n) => Number(n)).filter((n) => Number.isFinite(n))
    : [];
  if (!poiId && !label && !note && position.length < 2) return null;
  return {
    poiId,
    label,
    note,
    position: position.length >= 2 ? position.slice(0, 3) : undefined,
  };
}

function normalizeMilestones(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => ({
      label: String(item?.label || '').trim(),
      done: Boolean(item?.done),
    }))
    .filter((item) => item.label);
}

export function normalizeFeatureDossier(feature) {
  const raw = feature?.dossier && typeof feature.dossier === 'object' ? feature.dossier : {};
  let sections = (Array.isArray(raw.sections) ? raw.sections : [])
    .map(normalizeSection)
    .filter((section) => section.title || section.summary || section.blocks.length);

  const legacyImages = normalizeImages(feature?.images);
  if (!sections.length && legacyImages.length) {
    sections = [{
      id: 'evidence',
      title: 'Evidence',
      summary: '',
      blocks: [{ type: 'gallery', caption: '', images: legacyImages }],
    }];
  }

  return {
    overview: String(raw.overview || '').trim(),
    map: normalizeMap(raw.map),
    researchMilestones: normalizeMilestones(raw.researchMilestones),
    sections,
  };
}

export function featureHasDossier(feature) {
  const dossier = normalizeFeatureDossier(feature);
  return Boolean(
    dossier.overview
    || dossier.map
    || dossier.researchMilestones.length
    || dossier.sections.length,
  );
}

export function collectDossierGalleryImages(dossier) {
  const images = [];
  for (const section of dossier.sections) {
    for (const block of section.blocks) {
      images.push(...collectImagesFromBlock(block));
    }
  }
  const seen = new Set();
  return images.filter((img) => {
    if (seen.has(img.path)) return false;
    seen.add(img.path);
    return true;
  });
}
