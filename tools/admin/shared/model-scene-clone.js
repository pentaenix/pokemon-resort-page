import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';

/**
 * Clone a loaded glTF scene without leaving SkinnedMesh skeletons bound to the
 * cached source scene. Object3D.clone(true) copies the mesh hierarchy but not
 * the bone references held by each Skeleton, which makes translated instances
 * render from the source scene's origin.
 */
export function cloneGlbScene(source) {
  return cloneSkeleton(source);
}
