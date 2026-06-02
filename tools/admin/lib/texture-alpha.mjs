import zlib from 'node:zlib';

/** PNG IHDR color type: 4 = grayscale+alpha, 6 = RGBA */
export function pngBufferHasAlpha(bytes) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (buf.length < 26) return false;
  if (buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) return false;
  return buf[25] === 4 || buf[25] === 6;
}

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function isPng(buf) {
  for (let i = 0; i < 8; i += 1) if (buf[i] !== PNG_SIG[i]) return false;
  return true;
}

/**
 * Decode a baseline (non-interlaced, 8-bit) PNG far enough to recover the alpha
 * channel. DS-ripped overworld textures are always 8-bit RGBA/GA, which is all we
 * need to reason about transparency. Returns null when we can't safely decode.
 */
function decodePngAlpha(buf) {
  let off = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat = [];
  let trnsPresent = false;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const dataStart = off + 8;
    if (type === 'IHDR') {
      width = buf.readUInt32BE(dataStart);
      height = buf.readUInt32BE(dataStart + 4);
      bitDepth = buf[dataStart + 8];
      colorType = buf[dataStart + 9];
      interlace = buf[dataStart + 12];
    } else if (type === 'tRNS') {
      trnsPresent = true;
    } else if (type === 'IDAT') {
      idat.push(buf.slice(dataStart, dataStart + len));
    } else if (type === 'IEND') {
      break;
    }
    off = dataStart + len + 4; // skip data + CRC
  }
  // Color types without a built-in alpha channel: transparency only via tRNS.
  const hasAlphaChannel = colorType === 4 || colorType === 6;
  if (!hasAlphaChannel) {
    return { width, height, alpha: null, trnsPresent };
  }
  if (bitDepth !== 8 || interlace !== 0 || !idat.length) return null;
  const channels = colorType === 6 ? 4 : 2; // RGBA or GrayAlpha
  const stride = width * channels;
  let raw;
  try {
    raw = zlib.inflateSync(Buffer.concat(idat));
  } catch {
    return null;
  }
  if (raw.length < (stride + 1) * height) return null;
  const out = Buffer.alloc(height * stride);
  let prev = Buffer.alloc(stride);
  let p = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[p];
    p += 1;
    const cur = Buffer.alloc(stride);
    for (let x = 0; x < stride; x += 1) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let v = raw[p + x];
      if (filter === 1) v = (v + a) & 0xff;
      else if (filter === 2) v = (v + b) & 0xff;
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) {
        const pp = a + b - c;
        const pa = Math.abs(pp - a);
        const pb = Math.abs(pp - b);
        const pc = Math.abs(pp - c);
        v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
      }
      cur[x] = v;
    }
    cur.copy(out, y * stride);
    prev = cur;
    p += stride;
  }
  const alpha = Buffer.alloc(width * height);
  const alphaOffset = channels - 1;
  for (let i = 0; i < width * height; i += 1) {
    alpha[i] = out[i * channels + alphaOffset];
  }
  return { width, height, alpha, trnsPresent };
}

/**
 * Decide whether a texture carries *meaningful* transparency, by actually decoding
 * the alpha channel and measuring how much of it is below the cutoff. DS rips often
 * ship an RGBA PNG whose alpha is fully opaque — those must stay OPAQUE so we don't
 * punch holes in roofs/walls. Genuine cutout art (banners, signs, glass, lights) has
 * a sizeable fraction of transparent texels and should become a MASK material.
 *
 * @param {Buffer} bytes raw PNG bytes
 * @param {{ cutoff?: number, minFraction?: number }} [opts]
 */
export function pngHasMeaningfulTransparency(bytes, opts = {}) {
  const cutoff = Math.round((opts.cutoff ?? 0.5) * 255);
  const minFraction = opts.minFraction ?? 0.005;
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (buf.length < 26 || !isPng(buf)) return false;
  const decoded = decodePngAlpha(buf);
  if (!decoded) {
    // Couldn't fully decode (unusual bit depth/interlace). Fall back to the
    // conservative channel check so we still honour declared alpha.
    return pngBufferHasAlpha(buf);
  }
  if (!decoded.alpha) {
    // No alpha channel; palette/truecolor tRNS implies a transparent colour key.
    return decoded.trnsPresent;
  }
  const total = decoded.alpha.length || 1;
  let transparent = 0;
  for (let i = 0; i < decoded.alpha.length; i += 1) {
    if (decoded.alpha[i] < cutoff) transparent += 1;
  }
  return transparent / total >= minFraction;
}

/**
 * @param {{ format?: string, bytes?: Buffer } | null} tex
 * @returns {boolean} true when the texture should be exported as a MASK material.
 */
export function textureHasAlpha(tex) {
  if (!tex?.bytes?.length) return false;
  if (tex.format === 'jpeg') return false;
  return pngHasMeaningfulTransparency(tex.bytes);
}
