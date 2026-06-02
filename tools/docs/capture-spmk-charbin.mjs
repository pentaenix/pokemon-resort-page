#!/usr/bin/env node
/**
 * Capture SPMK Characters (.charbin) UI for Resort Docs.
 * Requires SPMK at http://127.0.0.1:8788 (./spmk run).
 */
import { execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const OUT_DIR = join(ROOT, 'public/media/docs/spmk');
const BASE = process.env.SPMK_CAPTURE_URL || 'http://127.0.0.1:8788';

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

async function capture(page, name, setup) {
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 60_000 });
  await page.waitForSelector('#viewTitle', { timeout: 30_000 });
  if (setup) await setup(page);
  await page.waitForTimeout(1200);
  await mkdir(OUT_DIR, { recursive: true });
  const pngPath = join(OUT_DIR, `${name}.png`);
  await page.screenshot({ path: pngPath, fullPage: false });
  const webpPath = join(OUT_DIR, `${name}.webp`);
  await toWebp(pngPath, webpPath);
  console.log(`saved media/docs/spmk/${name}.webp`);
}

async function main() {
  const playwright = await import('playwright');
  const browser = await playwright.chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });

  try {
    await capture(page, 'charbin-library', async (p) => {
      await p.waitForSelector('.pkg-lib-pokemon', { timeout: 45_000 });
      await p.locator('.pkg-lib-pokemon').evaluate((el) => { el.open = true; });
      await p.evaluate(() => {
        localStorage.setItem('spmk.pkg.pokemonShowSprites', '1');
      });
      await p.reload({ waitUntil: 'networkidle' });
      await p.waitForSelector('.pkg-lib-pokemon', { timeout: 45_000 });
      await p.locator('.pkg-lib-pokemon').evaluate((el) => { el.open = true; });
      const firstGen = p.locator('.pkg-lib-gen').first();
      if (await firstGen.count()) {
        await firstGen.evaluate((el) => { el.open = true; });
      }
      await p.waitForSelector('.pkg-lib-poke-thumb img', { timeout: 30_000 });
    });

    await capture(page, 'charbin-detail', async (p) => {
      await p.waitForSelector('.character.card[data-path]', { timeout: 45_000 });
      const card = p.locator('.character.card[data-path]').first();
      await card.click();
      await p.waitForSelector('.pkg-dir-anim canvas', { timeout: 30_000 });
      await p.waitForTimeout(800);
    });

    await capture(page, 'charbin-sheet-preview', async (p) => {
      await p.waitForSelector('.character.card[data-path]', { timeout: 45_000 });
      await p.locator('.character.card[data-path]').first().click();
      await p.waitForSelector('.pkg-sheet-tile img', { timeout: 30_000 });
      await p.locator('.pkg-dir-anim canvas').first().scrollIntoViewIfNeeded();
    });

    await capture(page, 'charbin-batch-import', async (p) => {
      await p.waitForSelector('#pkgBatchImport', { timeout: 30_000 });
      await p.click('#pkgBatchImport');
      await p.waitForSelector('.modal.card.big', { timeout: 15_000 });
    });
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
