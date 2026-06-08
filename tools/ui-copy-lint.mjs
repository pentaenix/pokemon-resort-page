/**
 * Lint user-facing copy for em dashes and common LLM-slop phrases.
 * Called from tools/validate-data.mjs.
 */

import { join } from 'node:path';

const EM_DASH = '\u2014';
const BANNED_PHRASES = [
  /\bcurated\b/i,
  /\bscannable\b/i,
  /\bcollectible-feeling\b/i,
  /\bcozy\b/i,
  /\bmeaningful project\b/i,
  /\barrival ritual\b/i,
  /\bwhere .+ become(s)? the path\b/i,
  /\beverything we learn about\b/i,
];

const issues = [];

function report(file, path, text, reason) {
  const preview = String(text).replace(/\s+/g, ' ').slice(0, 72);
  issues.push(`${file}${path ? ` (${path})` : ''}: ${reason}: "${preview}"`);
}

function checkString(file, path, text, { banPhrases = true } = {}) {
  if (typeof text !== 'string' || !text.trim()) return;
  if (text.includes(EM_DASH)) {
    report(file, path, text, 'contains em dash (use comma, period, or parentheses)');
  }
  if (banPhrases) {
    for (const pattern of BANNED_PHRASES) {
      if (pattern.test(text)) {
        report(file, path, text, `matches banned phrase ${pattern}`);
      }
    }
  }
}

function walkStrings(file, value, path = '', options = {}) {
  if (typeof value === 'string') {
    checkString(file, path, value, options);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkStrings(file, item, `${path}[${index}]`, options));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      const childPath = path ? `${path}.${key}` : key;
      walkStrings(file, child, childPath, options);
    }
  }
}

export function lintHomepage(data) {
  walkStrings('homepage.json', data);
}

export function lintIdeas(data) {
  for (const idea of data.items || []) {
    checkString('ideas.json', `${idea.id}.title`, idea.title);
    checkString('ideas.json', `${idea.id}.summary`, idea.summary);
  }
}

export function lintFeatureSummaries(data) {
  for (const feature of data.features || []) {
    checkString('features.json', `${feature.id}.summary`, feature.summary);
  }
}

export function lintResearchSummaries(data) {
  for (const entry of data.entries || []) {
    checkString('research.json', `${entry.id}.summary`, entry.summary);
  }
}

export function lintRoadmapSummaries(data) {
  for (const item of data.milestones || []) {
    checkString('roadmap.json', `${item.id}.summary`, item.summary);
  }
}

export function lintCompatibilityBlurbs(data) {
  for (const [key, status] of Object.entries(data.statuses || {})) {
    checkString('compatibility.json', `statuses.${key}.description`, status.description, { banPhrases: false });
  }
  for (const gen of data.generations || []) {
    checkString('compatibility.json', `${gen.id}.summary`, gen.summary, { banPhrases: false });
    if (typeof gen.summary === 'string' && /untested in the public ontology until a round-trip checklist is recorded/i.test(gen.summary)) {
      report('compatibility.json', `${gen.id}.summary`, gen.summary, 'uses deprecated generation summary template');
    }
  }
}

export function lintAtlasPinBlurbs(data) {
  for (const color of data.pinColors || []) {
    checkString('atlas-pins.json', `pinColors.${color.id}.hint`, color.hint);
  }
  if (data.map?.showReference?.caption) {
    checkString('atlas-pins.json', 'map.showReference.caption', data.map.showReference.caption, { banPhrases: false });
  }
  for (const pin of data.pins || []) {
    checkString('atlas-pins.json', `pins.${pin.id}.summary`, pin.summary);
  }
}

export function lintDocsHubBlurbs(data) {
  for (const cat of data.categories || []) {
    checkString('docs.json', `categories.${cat.id}.description`, cat.description);
  }
  for (const article of data.articles || []) {
    checkString('docs.json', `articles.${article.id}.summary`, article.summary);
  }
}

export function lintSiteChrome(data) {
  checkString('site.json', 'projectName', data.projectName, { banPhrases: false });
  checkString('site.json', 'legalShort', data.legalShort, { banPhrases: false });
}

export function lintJsxUiCopy(file, source) {
  const stringPattern = /(['"`])((?:\\.|(?!\1).)*)\1/g;
  let match;
  while ((match = stringPattern.exec(source)) !== null) {
    const text = match[2];
    if (!text.includes(EM_DASH)) continue;
    if (text.length < 8) continue;
    if (/^[a-z0-9-]+$/i.test(text)) continue;
    if (text.includes('d="') || text.includes('stroke')) continue;
    checkString(file, 'string literal', text, { banPhrases: false });
  }
}

const JSX_UI_FILES = [
  'src/pages/Home.jsx',
  'src/pages/Atlas.jsx',
  'src/pages/Plan.jsx',
  'src/pages/Board.jsx',
  'src/pages/ConciergeResearch.jsx',
  'src/pages/Legal.jsx',
  'src/pages/Milestones.jsx',
  'src/pages/SourceGuide.jsx',
  'src/pages/Docs.jsx',
  'src/pages/Ideas.jsx',
  'src/components/Layout.jsx',
  'src/main.jsx',
  'src/lib/resortSpotlight.js',
  'src/lib/milestoneEras.js',
];

export async function lintJsxUiFiles(root, readFile) {
  for (const rel of JSX_UI_FILES) {
    const source = await readFile(join(root, rel), 'utf8');
    lintJsxUiCopy(rel, source);
  }
}

/** @returns {number} warning count */
export function reportUiCopyWarnings() {
  if (!issues.length) return 0;
  console.warn('UI copy lint warnings (see docs/UI-COPY.md):');
  for (const line of issues) {
    console.warn(`  • ${line}`);
  }
  return issues.length;
}

export function resetUiCopyLint() {
  issues.length = 0;
}
