/**
 * Sanitize HTML for dossier "html" blocks (browser DOMParser).
 * Admin mirror: tools/admin/public/sanitize-html.js — keep in sync.
 */

import { isValidPublicHref } from './linkUtils.js';

const MAX_HTML_LENGTH = 48_000;

const ALLOWED_TAGS = new Set([
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'blockquote', 'pre', 'code', 'hr', 'br',
  'strong', 'em', 'b', 'i', 'u', 's', 'small', 'sub', 'sup',
  'a', 'img',
  'div', 'span', 'section', 'article', 'header', 'footer', 'aside',
  'table', 'thead', 'tbody', 'tr', 'th', 'td', 'caption',
  'figure', 'figcaption',
]);

const GLOBAL_ATTRS = new Set(['class', 'title', 'aria-label', 'role']);

const TAG_ATTRS = {
  a: ['href', 'target', 'rel'],
  img: ['src', 'alt', 'title', 'loading', 'width', 'height'],
  th: ['colspan', 'rowspan'],
  td: ['colspan', 'rowspan'],
};

const SAFE_CLASS = /^[\w\s\-./:]+$/;

/** Site-relative asset paths only (no remote or data URLs). */
export function isSafeDossierAssetPath(path) {
  const raw = String(path || '').trim();
  if (!raw || raw.includes('..')) return false;
  if (/^(javascript|vbscript|file|data):/i.test(raw)) return false;
  if (/^https?:\/\//i.test(raw)) return false;
  return /^[a-zA-Z0-9][a-zA-Z0-9_./-]*$/.test(raw);
}

function sanitizeClass(value) {
  const raw = String(value || '').trim();
  if (!raw || !SAFE_CLASS.test(raw)) return null;
  return raw;
}

function allowedAttrNames(tag) {
  const set = new Set(GLOBAL_ATTRS);
  for (const name of TAG_ATTRS[tag] || []) set.add(name);
  return set;
}

function sanitizeAttr(tag, name, value) {
  const key = String(name || '').toLowerCase();
  if (!key || key.startsWith('on') || key === 'style' || key === 'srcset' || key === 'id') return null;
  if (!allowedAttrNames(tag).has(key)) return null;

  if (key === 'class') {
    const cls = sanitizeClass(value);
    return cls ? ['class', cls] : null;
  }
  if (key === 'href') {
    const href = String(value || '').trim();
    return isValidPublicHref(href) ? ['href', href] : null;
  }
  if (key === 'src') {
    const src = String(value || '').trim();
    return isSafeDossierAssetPath(src) ? ['src', src] : null;
  }
  if (key === 'target') {
    const t = String(value || '').trim().toLowerCase();
    return t === '_blank' ? ['target', '_blank'] : null;
  }
  if (key === 'rel') {
    const rel = String(value || '').trim().toLowerCase();
    return rel === 'noreferrer noopener' || rel === 'noopener noreferrer' ? ['rel', 'noreferrer noopener'] : null;
  }
  if (key === 'loading') {
    const loading = String(value || '').trim().toLowerCase();
    return loading === 'lazy' || loading === 'eager' ? ['loading', loading] : null;
  }
  if (key === 'colspan' || key === 'rowspan') {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 1 || n > 12) return null;
    return [key, String(Math.floor(n))];
  }
  if (key === 'width' || key === 'height') {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 1 || n > 4096) return null;
    return [key, String(Math.floor(n))];
  }
  const text = String(value || '').trim();
  return text ? [key, text] : null;
}

function unwrapNode(node) {
  const parent = node.parentNode;
  if (!parent) return;
  while (node.firstChild) parent.insertBefore(node.firstChild, node);
  parent.removeChild(node);
}

function sanitizeElement(el) {
  let child = el.firstElementChild;
  while (child) {
    const tag = child.tagName.toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) {
      unwrapNode(child);
      child = el.firstElementChild;
      continue;
    }
    [...child.attributes].forEach((attr) => {
      const safe = sanitizeAttr(tag, attr.name, attr.value);
      if (!safe) child.removeAttribute(attr.name);
      else child.setAttribute(safe[0], safe[1]);
    });
    if (tag === 'a' && child.getAttribute('target') === '_blank' && !child.getAttribute('rel')) {
      child.setAttribute('rel', 'noreferrer noopener');
    }
    sanitizeElement(child);
    child = child.nextElementSibling;
  }
}

/**
 * @param {string} html
 * @returns {string} sanitized fragment (may be empty)
 */
export function sanitizeDossierHtml(html) {
  const raw = String(html || '').trim();
  if (!raw) return '';
  const clipped = raw.length > MAX_HTML_LENGTH ? raw.slice(0, MAX_HTML_LENGTH) : raw;
  if (typeof DOMParser === 'undefined') return '';

  const doc = new DOMParser().parseFromString(clipped, 'text/html');
  doc.querySelectorAll('script, style, iframe, object, embed, form, input, button, textarea, select, link, meta, base, template, svg, math').forEach((el) => el.remove());
  sanitizeElement(doc.body);
  const out = doc.body.innerHTML.trim();
  const textOnly = doc.body.textContent?.replace(/\s+/g, '').trim();
  const hasMedia = doc.body.querySelector('img, table, ul, ol, blockquote, pre, h1, h2, h3, h4, h5, h6');
  return out && (textOnly || hasMedia) ? out : '';
}

/**
 * Collect site-relative image paths from HTML (run on sanitized or raw HTML).
 * @param {string} html
 * @returns {string[]}
 */
export function extractImagePathsFromHtml(html) {
  if (!html || typeof DOMParser === 'undefined') return [];
  const doc = new DOMParser().parseFromString(String(html), 'text/html');
  const paths = [];
  doc.querySelectorAll('img[src]').forEach((img) => {
    const src = img.getAttribute('src')?.trim();
    if (isSafeDossierAssetPath(src)) paths.push(src);
  });
  return paths;
}
