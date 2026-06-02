/** Shared rich-content (dossier) normalization for features, POIs, ideas, milestones. */
export {
  normalizeFeatureDossier as normalizeRichContent,
  featureHasDossier as recordHasRichContent,
  collectDossierGalleryImages as collectRichContentImages,
} from './featureDossier.js';
