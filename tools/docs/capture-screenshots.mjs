#!/usr/bin/env node
/**
 * Headed/headless browser screenshots for Resort Docs.
 *
 * Loads the real Vite site (and optionally admin), waits for UI, writes PNG/WebP
 * under public/media/docs/.
 *
 * Usage:
 *   npm run docs:screenshots
 *   npm run docs:screenshots -- --headed
 *   npm run docs:screenshots -- --only docs-hub,writing-docs
 *   node tools/docs/capture-screenshots.mjs --start-dev --start-admin
 */

import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const OUT_DIR = join(ROOT, 'public/media/docs');

const PUBLIC_PORT = Number(process.env.DOCS_CAPTURE_PUBLIC_PORT || 5174);
const ADMIN_PORT = Number(process.env.DOCS_CAPTURE_ADMIN_PORT || 9477);
const PUBLIC_BASE = process.env.DOCS_CAPTURE_PUBLIC_URL || `http://127.0.0.1:${PUBLIC_PORT}`;
const ADMIN_BASE = process.env.DOCS_CAPTURE_ADMIN_URL || `http://127.0.0.1:${ADMIN_PORT}`;

const TARGETS = {
  'docs-hub': {
    url: `${PUBLIC_BASE}/#/docs`,
    waitFor: '.docs-grid .doc-card',
    filename: 'docs-hub',
    fullPage: true,
  },
  'writing-docs': {
    url: `${PUBLIC_BASE}/#/docs?article=writing-docs`,
    waitFor: '.docs-article-body .feature-dossier-section',
    filename: 'writing-docs-article',
    fullPage: true,
  },
  'admin-docs': {
    url: `${ADMIN_BASE}/`,
    waitFor: '#docDetailHost [data-form="doc"]',
    filename: 'admin-docs-tab',
    fullPage: false,
    setup: async (page) => {
      await page.waitForFunction(
        () => !document.querySelector('#app')?.textContent?.includes('Loading resort data'),
        { timeout: 60_000 },
      );
      await page.waitForSelector('#tabs button[data-tab="Docs"]', { timeout: 30_000 });
      await page.click('#tabs button[data-tab="Docs"]');
      await page.waitForSelector('#docListHost button[data-doc-slug]', { timeout: 30_000 });
      const slugBtn = page.locator('#docListHost button[data-doc-slug="writing-docs"]');
      if (await slugBtn.count()) {
        await slugBtn.click();
      } else {
        await page.locator('#docListHost button[data-doc-slug]').first().click();
      }
    },
  },
};

function parseArgs(argv) {
  const args = {
    headed: false,
    startDev: false,
    startAdmin: false,
    only: null,
    format: 'png',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--headed') args.headed = true;
    else if (a === '--start-dev') args.startDev = true;
    else if (a === '--start-admin') args.startAdmin = true;
    else if (a === '--format' && argv[i + 1]) {
      args.format = argv[++i];
    } else if (a === '--only' && argv[i + 1]) {
      args.only = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    }
  }
  return args;
}

async function waitForHttp(url, timeoutMs = 45_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (res.ok) return;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`Server did not respond at ${url} within ${timeoutMs}ms`);
}

async function adminPayload(base) {
  try {
    const res = await fetch(`${base}/api/data`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

async function adminHasDocs(base) {
  const payload = await adminPayload(base);
  if (!payload) return false;
  const files = payload.files || payload;
  return Boolean(files['docs.json']?.articles?.length);
}

async function resolveAdminBase(args) {
  if (await adminHasDocs(ADMIN_BASE)) return { base: ADMIN_BASE, child: null };

  const fallbackPort = ADMIN_PORT === 9477 ? 9478 : ADMIN_PORT + 1;
  const fallbackBase = `http://127.0.0.1:${fallbackPort}`;

  if (await adminHasDocs(fallbackBase)) {
    console.warn(`Admin on ${ADMIN_BASE} is stale; using ${fallbackBase} (restart npm run admin).`);
    return { base: fallbackBase, child: null };
  }

  if (!args.startAdmin) {
    throw new Error(
      `Admin at ${ADMIN_BASE} does not expose docs.json (restart: npm run admin). Or pass --start-admin to spawn a fresh desk.`,
    );
  }

  console.log(`Starting admin on ${fallbackBase}…`);
  const child = startProcess('admin', 'npm', ['run', 'admin'], ROOT, { PORT: String(fallbackPort) });
  await waitForHttp(`${fallbackBase}/`);
  if (!(await adminHasDocs(fallbackBase))) {
    child.kill('SIGTERM');
    throw new Error('Started admin but docs.json still missing.');
  }
  return { base: fallbackBase, child };
}

function startProcess(label, command, args, cwd, env = {}) {
  const child = spawn(command, args, {
    cwd,
    stdio: 'pipe',
    env: { ...process.env, ...env },
  });
  child.stdout?.on('data', (d) => process.stdout.write(`[${label}] ${d}`));
  child.stderr?.on('data', (d) => process.stderr.write(`[${label}] ${d}`));
  return child;
}

async function maybeStartServers(args, needsAdmin) {
  const children = [];
  const publicUp = await fetch(`${PUBLIC_BASE}/`, { signal: AbortSignal.timeout(2000) })
    .then((r) => r.ok)
    .catch(() => false);

  if (!publicUp && args.startDev) {
    console.log(`Starting public dev server on ${PUBLIC_BASE}…`);
    children.push(startProcess('dev', 'npm', ['run', 'dev'], ROOT));
    await waitForHttp(`${PUBLIC_BASE}/`);
  } else if (!publicUp) {
    throw new Error(`Public site not running at ${PUBLIC_BASE}. Run: npm run dev  (or pass --start-dev)`);
  }

  let adminBase = ADMIN_BASE;
  if (needsAdmin) {
    const resolved = await resolveAdminBase(args);
    adminBase = resolved.base;
    if (resolved.child) children.push(resolved.child);
    TARGETS['admin-docs'].url = `${adminBase}/`;
  }

  return { children, adminBase };
}

async function pngToWebp(pngPath, webpPath) {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const exec = promisify(execFile);
  if (await new Promise((resolve) => {
    exec('which', ['cwebp']).then(() => resolve(true)).catch(() => resolve(false));
  })) {
    await exec('cwebp', ['-q', '88', pngPath, '-o', webpPath]);
    return webpPath;
  }
  if (process.platform === 'darwin') {
    await exec('sips', ['-s', 'format', 'webp', pngPath, '--out', webpPath]);
    return webpPath;
  }
  return pngPath;
}

async function captureTarget(page, target, format) {
  const { url, waitFor, filename, fullPage, setup } = target;
  console.log(`→ ${filename}: ${url}`);
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 });
  if (setup) await setup(page);
  await page.waitForSelector(waitFor, { timeout: 45_000 });
  // Let fonts, images, and mermaid settle.
  await page.waitForTimeout(800);

  await mkdir(OUT_DIR, { recursive: true });
  const pngPath = join(OUT_DIR, `${filename}.png`);
  await page.screenshot({ path: pngPath, fullPage: Boolean(fullPage) });

  let outRel = `media/docs/${filename}.png`;
  if (format === 'webp') {
    const webpPath = join(OUT_DIR, `${filename}.webp`);
    await pngToWebp(pngPath, webpPath);
    outRel = `media/docs/${filename}.webp`;
    console.log(`  saved ${outRel}`);
  } else {
    console.log(`  saved ${outRel}`);
  }
  return outRel;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let playwright;
  try {
    playwright = await import('playwright');
  } catch {
    console.error('Playwright is not installed. Run: npm install && npx playwright install chromium');
    process.exit(1);
  }

  const keys = args.only?.length
    ? args.only.filter((k) => TARGETS[k])
    : Object.keys(TARGETS);

  if (!keys.length) {
    console.error(`No targets. Available: ${Object.keys(TARGETS).join(', ')}`);
    process.exit(1);
  }

  const needsAdmin = keys.includes('admin-docs');
  const { children } = await maybeStartServers(args, needsAdmin);

  const browser = await playwright.chromium.launch({ headless: !args.headed });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();

  const written = [];
  try {
    for (const key of keys) {
      written.push(await captureTarget(page, TARGETS[key], args.format));
    }
  } finally {
    await browser.close();
    for (const child of children) child.kill('SIGTERM');
  }

  console.log('\nDone. Reference in JSON, e.g.:');
  for (const rel of written) {
    console.log(`  "path": "${rel}"`);
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
