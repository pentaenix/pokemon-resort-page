import * as THREE from 'three';

const alphaCache = new WeakMap();

/** @param {Uint8Array|ArrayBuffer} bytes */
export function pngBytesHaveAlpha(bytes) {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (buf.length < 26) return false;
  if (buf[0] !== 0x89 || buf[1] !== 0x50) return false;
  return buf[25] === 4 || buf[25] === 6;
}

/** @param {HTMLImageElement|ImageBitmap} img */
export function imageElementHasAlpha(img) {
  if (!img || !img.width || !img.height) return false;
  if (alphaCache.has(img)) return alphaCache.get(img);

  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return false;
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let hasAlpha = false;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 250) {
      hasAlpha = true;
      break;
    }
  }
  alphaCache.set(img, hasAlpha);
  return hasAlpha;
}

/** @param {THREE.Texture | null} map */
export function textureMapHasAlpha(map) {
  if (!map?.image) return false;
  const img = map.image;
  if (img.width) return imageElementHasAlpha(img);
  return false;
}

/** @param {THREE.Material | null} mat */
export function materialNeedsAlpha(mat) {
  if (!mat) return false;
  if (mat.transparent) return true;
  if (mat.alphaTest > 0) return true;
  if (mat.opacity < 0.999) return true;
  if (mat.alphaMode === 'BLEND' || mat.alphaMode === 'MASK') return true;
  return textureMapHasAlpha(mat.map);
}

/**
 * Pixel-art + repeat sampling on an existing GLTF-loaded texture (preserve flipY).
 * @param {THREE.Texture} texture
 */
export function tuneGltfTexture(texture) {
  if (!texture) return;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  if ('colorSpace' in texture) texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
}

/**
 * Keep GLTFLoader materials/maps; only tune sampling. Alpha handling is taken verbatim
 * from the GLB material (alphaMode → transparent/alphaTest set by GLTFLoader). We do NOT
 * re-derive transparency from the texture's alpha channel: DS-ripped PNGs often carry an
 * unreliable alpha channel, and forcing cutout from it punches holes in opaque surfaces.
 * @param {THREE.Object3D} root
 */
export function tuneGltfMaterials(root) {
  root.traverse((obj) => {
    if (!obj.isMesh) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const mat of mats) {
      if (!mat) continue;
      mat.side = THREE.DoubleSide;
      mat.depthWrite = true;
      if (mat.map) tuneGltfTexture(mat.map);
    }
  });
}
