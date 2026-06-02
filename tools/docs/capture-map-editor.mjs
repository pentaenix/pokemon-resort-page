#!/usr/bin/env node
/**
 * Capture Operations Desk Map Editor screenshots for Resort Docs.
 * Requires admin on http://127.0.0.1:9477 (npm run admin).
 */
import { execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const OUT_DIR = join(ROOT, 'public/media/docs/map-editor');
const ADMIN_BASE = process.env.MAP_CAPTURE_ADMIN_URL || 'http://127.0.0.1:9477';

async function toWebp(pngPath, webpPath) {
  try {
    await exec('cwebp', ['-q', '88', pngPath, '-o', webpPath]);
    return webpPath;
  } catch {
    if (process.platform === 'darwin') {
      await exec('sips', ['-s', 'format', 'webp', pngPath, '--out', webpPath]);
      return webpPath;
    }
    return pngPath;
  }
}

async function openMapEditor(page) {
  await page.goto(ADMIN_BASE, { waitUntil: 'networkidle', timeout: 60_000 });
  await page.waitForFunction(
    () => !document.querySelector('#app')?.textContent?.includes('Loading resort data'),
    { timeout: 60_000 },
  );
  await page.waitForSelector('#tabs button[data-tab="Map Editor"]', { timeout: 30_000 });
  await page.click('#tabs button[data-tab="Map Editor"]');
  await page.waitForSelector('.map-editor-page', { timeout: 30_000 });
}

async function loadTestingMap(page) {
  const fileBtn = page.locator('button[data-map-file="testing.owmap"]');
  if (await fileBtn.count()) {
    await fileBtn.click();
  } else {
    const anyMap = page.locator('button[data-map-file]').first();
    if (await anyMap.count()) await anyMap.click();
    else {
      await page.click('#mapNew');
      await page.waitForTimeout(400);
    }
  }
  await page.waitForSelector('#mapPaintGrid', { timeout: 20_000 });
}

async function capture(page, name, setup) {
  await openMapEditor(page);
  if (setup) await setup(page);
  await page.waitForTimeout(1000);
  await mkdir(OUT_DIR, { recursive: true });
  const pngPath = join(OUT_DIR, `${name}.png`);
  await page.screenshot({ path: pngPath, fullPage: false });
  const webpPath = join(OUT_DIR, `${name}.webp`);
  await toWebp(pngPath, webpPath);
  console.log(`saved media/docs/map-editor/${name}.webp`);
}

async function main() {
  const playwright = await import('playwright');
  const browser = await playwright.chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });

  try {
    await capture(page, 'map-editor-overview', async (p) => {
      await loadTestingMap(p);
    });

    await capture(page, 'map-editor-collision', async (p) => {
      await loadTestingMap(p);
      const collisionBtn = p.locator('.map-brush-group button[data-brush="collision"]');
      if (await collisionBtn.count()) await collisionBtn.click();
      await p.waitForTimeout(300);
    });

    await capture(page, 'map-editor-ramp', async (p) => {
      await loadTestingMap(p);
      const rampBtn = p.locator('.map-brush-group button[data-brush="ramp"]');
      if (await rampBtn.count()) await rampBtn.click();
      await p.waitForTimeout(300);
    });

    await capture(page, 'map-editor-3d-preview', async (p) => {
      await loadTestingMap(p);
      await p.click('#mapTogglePreview');
      await p.waitForSelector('#mapPreviewModal', { timeout: 15_000 });
      await p.waitForTimeout(1500);
    });
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
