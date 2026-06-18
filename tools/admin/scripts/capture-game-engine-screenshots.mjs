#!/usr/bin/env node
/**
 * Capture real UI screenshots for Game Engine hub cards.
 * Usage: node tools/admin/scripts/capture-game-engine-screenshots.mjs
 * Requires: admin on :9477, playwright, character editor started (script starts it).
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const outDir = join(root, 'public/media/game_engine');
const base = process.env.ADMIN_URL || 'http://127.0.0.1:9477';
const card = { width: 640, height: 400 };

async function ensureCharacterEditor() {
  const res = await fetch(`${base}/api/character-editor/start`, { method: 'POST' });
  if (!res.ok) throw new Error(`character-editor start failed: ${res.status}`);
  const body = await res.json();
  if (!body.healthy) throw new Error('character-editor not healthy');
}

async function main() {
  await mkdir(outDir, { recursive: true });
  await ensureCharacterEditor();

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  // Map Studio — workbench tool surface (below command bars)
  await page.goto(`${base}/#/game-engine/maps`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('body.workbench-open', { timeout: 60000 });
  await page.waitForSelector('.map-editor-workbench', { timeout: 60000 });
  await page.waitForTimeout(3500);
  const mapSurface = page.locator('.map-editor-workbench');
  await mapSurface.screenshot({ path: join(outDir, 'maps.png'), type: 'png' });
  const { spawnSync } = await import('node:child_process');
  spawnSync('sips', ['-z', String(card.height), String(card.width), join(outDir, 'maps.png'), '--out', join(outDir, 'maps.png')], { stdio: 'inherit' });

  // Character Editor — embedded SPMK UI (actual tool, not admin chrome)
  await page.goto(`${base}/character-editor/?embed=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('.app .main', { timeout: 60000 });
  await page.waitForTimeout(4000);
  await page.locator('.app').screenshot({ path: join(outDir, 'characters.png'), type: 'png' });
  spawnSync('sips', ['-z', String(card.height), String(card.width), join(outDir, 'characters.png'), '--out', join(outDir, 'characters.png')], { stdio: 'inherit' });

  await browser.close();
  console.log('Wrote', join(outDir, 'maps.png'));
  console.log('Wrote', join(outDir, 'characters.png'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
