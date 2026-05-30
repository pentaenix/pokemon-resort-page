/** Side-effect: registers all built-in dossier block types. */
import './registry.js';

export {
  registerDossierBlock,
  getDossierBlock,
  getDossierBlockTypes,
  normalizeDossierBlock,
  collectImagesFromBlock,
} from './registry.js';
