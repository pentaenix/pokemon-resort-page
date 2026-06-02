/**
 * Minimal multipart/form-data parser for folder uploads.
 */
export async function readRawBody(req, maxBytes = 80_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new Error('Upload too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export function parseMultipart(buffer, contentType) {
  const match = (contentType || '').match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!match) throw new Error('Missing multipart boundary');
  const boundary = Buffer.from(`--${(match[1] || match[2]).trim()}`);
  const parts = [];

  let start = buffer.indexOf(boundary);
  if (start < 0) throw new Error('Invalid multipart body');
  start += boundary.length;

  while (start < buffer.length) {
    if (buffer[start] === 0x2d && buffer[start + 1] === 0x2d) break;
    if (buffer[start] === 0x0d) start += 2;
    else if (buffer[start] === 0x0a) start += 1;

    const headEnd = buffer.indexOf('\r\n\r\n', start);
    if (headEnd < 0) break;
    const headerText = buffer.toString('utf8', start, headEnd);
    const bodyStart = headEnd + 4;
    let bodyEnd = buffer.indexOf(boundary, bodyStart);
    if (bodyEnd < 0) bodyEnd = buffer.length;
    if (bodyEnd >= 2 && buffer[bodyEnd - 2] === 0x0d && buffer[bodyEnd - 1] === 0x0a) bodyEnd -= 2;

    const disp = headerText.match(/content-disposition:[^\r\n]+/i)?.[0] || '';
    const nameMatch = disp.match(/name="([^"]+)"/i);
    const filenameMatch = disp.match(/filename="([^"]+)"/i);
    const name = nameMatch?.[1] || '';
    const filename = filenameMatch?.[1] || '';
    const bytes = buffer.subarray(bodyStart, bodyEnd);

    parts.push({ name, filename, bytes });
    start = bodyEnd + boundary.length;
  }

  return parts;
}

export function groupFolderUpload(parts) {
  const files = [];
  let modelId = '';
  let archive = null;
  let glb = null;
  let glbName = '';

  for (const part of parts) {
    if (part.name === 'modelId' && part.bytes.length) {
      modelId = part.bytes.toString('utf8').trim();
      continue;
    }
    if (part.name === 'archive' || (part.filename && /\.zip$/i.test(part.filename))) {
      archive = Buffer.from(part.bytes);
      continue;
    }
    if (part.name === 'glb' || (part.filename && /\.glb$/i.test(part.filename))) {
      glb = Buffer.from(part.bytes);
      glbName = part.filename || 'model.glb';
      continue;
    }
    if (part.name !== 'files' && part.name !== 'file') continue;
    const relativePath = (part.filename || '').replace(/\\/g, '/');
    if (!relativePath) continue;
    files.push({ relativePath, name: relativePath, bytes: Buffer.from(part.bytes) });
  }

  return { modelId, files, archive, glb, glbName };
}
