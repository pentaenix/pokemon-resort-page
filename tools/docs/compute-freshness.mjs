/**
 * Scan doc articles for code block refs and compare file mtimes to article updatedAt.
 * Writes public/data/docs-freshness.json for the Docs hub staleness badges.
 */

import { readFile, writeFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { docArticleRelativePath } from './article-path.mjs';

const PAGE_ROOT = resolve(new URL('../..', import.meta.url).pathname);
const WORKSPACE_ROOT = resolve(PAGE_ROOT, '..');
const DATA_ROOT = join(PAGE_ROOT, 'public/data');
const ARTICLES_ROOT = join(PAGE_ROOT, 'public/docs/articles');
const OUT_PATH = join(DATA_ROOT, 'docs-freshness.json');

const REPO_ROOTS = {
  'pokemon-resort-page': PAGE_ROOT,
  'pokemon-resort': join(WORKSPACE_ROOT, 'pokemon-resort'),
  spmk: join(WORKSPACE_ROOT, 'spmk'),
  'pokemon-ds-map-studio': join(WORKSPACE_ROOT, 'Pokemon-DS-Map-Studio'),
  'island-dreamforge': join(WORKSPACE_ROOT, 'island-dreamforge'),
};

function parseDay(value) {
  if (!value) return null;
  const d = new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function walkBlocks(blocks, visit) {
  for (const block of blocks || []) {
    visit(block);
    if (block?.type === 'tabs') {
      for (const tab of block.tabs || []) walkBlocks(tab.blocks, visit);
    }
  }
}

function extractCodeRefs(dossier) {
  const refs = [];
  const seen = new Set();
  const add = (repo, path) => {
    const key = `${repo}:${path}`;
    if (!repo || !path || seen.has(key)) return;
    seen.add(key);
    refs.push({ repo, path });
  };

  for (const section of dossier?.sections || []) {
    walkBlocks(section.blocks, (block) => {
      if (block?.type === 'code') add(block.repo, block.path);
    });
  }
  return refs;
}

async function refMeta(ref) {
  const root = REPO_ROOTS[ref.repo];
  if (!root) return { ...ref, exists: false, modifiedAt: null };
  const full = join(root, ref.path);
  if (!existsSync(full)) return { ...ref, exists: false, modifiedAt: null };
  const { mtime } = await stat(full);
  return {
    ...ref,
    exists: true,
    modifiedAt: mtime.toISOString().slice(0, 10),
  };
}

function computeStatus(articleUpdatedAt, refs) {
  if (!refs.length) return 'current';
  const articleDay = parseDay(articleUpdatedAt);
  if (!articleDay) return 'unknown';
  let hasMissing = false;
  for (const ref of refs) {
    if (!ref.exists) {
      hasMissing = true;
      continue;
    }
    const codeDay = parseDay(ref.modifiedAt);
    if (codeDay && codeDay > articleDay) return 'stale';
  }
  return hasMissing ? 'unknown' : 'current';
}

export async function computeDocsFreshness() {
  const manifest = JSON.parse(await readFile(join(DATA_ROOT, 'docs.json'), 'utf8'));
  const articles = {};

  for (const card of manifest.articles || []) {
    const rel = docArticleRelativePath(card);
    const articlePath = join(ARTICLES_ROOT, rel);
    const body = JSON.parse(await readFile(articlePath, 'utf8'));
    const codeRefs = extractCodeRefs(body.dossier);
    const refs = await Promise.all(codeRefs.map(refMeta));
    const appsFromRefs = [...new Set(refs.map((r) => r.repo).filter(Boolean))];
    const apps = [...new Set([...(card.apps || []), ...appsFromRefs])];
    const status = computeStatus(card.updatedAt || card.publishedAt, refs);
    const newestCodeChange = refs
      .filter((r) => r.modifiedAt)
      .map((r) => r.modifiedAt)
      .sort()
      .pop() || null;

    articles[card.slug] = {
      status,
      articleUpdatedAt: card.updatedAt || card.publishedAt || null,
      newestCodeChange,
      apps,
      refs,
    };
  }

  return {
    computedAt: new Date().toISOString(),
    articles,
  };
}

async function main() {
  const payload = await computeDocsFreshness();
  await writeFile(OUT_PATH, `${JSON.stringify(payload, null, 2)}\n`);
  const stale = Object.values(payload.articles).filter((a) => a.status === 'stale').length;
  console.log(`Docs freshness written to public/data/docs-freshness.json (${stale} stale).`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}
