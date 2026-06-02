import {
  bindGlbWebGLViewport,
  loadGlbScene,
  closeGlbViewport,
  clearGlbSceneCache,
  renderGlbThumbnail,
} from './model-glb-viewer.js';

export {
  bindGlbWebGLViewport,
  loadGlbScene,
  closeGlbViewport,
  clearGlbSceneCache,
  renderGlbThumbnail,
};

export function clearModelCache() {
  clearGlbSceneCache();
  closeGlbViewport();
}

export function closeModelViewport() {
  closeGlbViewport();
}
