import assert from 'node:assert/strict';
import { chromium } from 'playwright';

// Exercise the real modifier, renderer, and save payload without writing game data.
const base = process.env.ADMIN_TEST_URL || 'http://127.0.0.1:9478';
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(base);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.evaluate(async () => {
    const editor = await import('/modules/dataeditor/editor.js');
    const payload = await fetch('/api/data-editor/file?file=cinematic/start_scene.json').then((res) => res.json());
    if (!payload.ok) throw new Error(payload.error);
    const defaults = await fetch('/api/data-editor/files').then((res) => res.json());
    payload.defaults = defaults.defaults;
    const clone = (value) => JSON.parse(JSON.stringify(value));
    window.sceneEditorState = { dataEditor: {
      booted: true, files: [], current: { ...payload, original: clone(payload.data), rawMode: false, dirty: false },
      fileSearch: '', showAdvanced: false,
    } };
    const esc = (value) => String(value ?? '').replace(/[&<>"']/g,
      (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
    const deps = {
      log: () => {},
      api: async (url, options) => {
        if (url === '/api/data-editor/save') {
          window.sceneSavedPayload = JSON.parse(options.body);
          return { ok: true, hash: 'test', backupPath: 'test-backup.json' };
        }
        return fetch(url).then((res) => res.json());
      },
      render: async () => {
        document.body.innerHTML = editor.editorHtml(window.sceneEditorState, esc);
        editor.bindEditor(window.sceneEditorState, deps);
      },
    };
    document.head.insertAdjacentHTML('beforeend', '<link rel="stylesheet" href="/admin.css"><link rel="stylesheet" href="/modules/dataeditor/editor.css">');
    await deps.render();
  });
  assert.equal(await page.locator('.data-modal h2').innerText(), 'Start Cinematic Scene');
  assert.equal(await page.locator('[data-data-field="activeVessel"] option').count(), 2);
  assert.equal(await page.locator('[data-data-field="activeShot"] option').count(), 6);
  assert.equal(await page.locator('[data-object-root="shots"]').count(), 6);
  const rainToggle = page.locator('[data-data-field="shots.5.street.rain.enabled"]');
  assert.equal(await rainToggle.getAttribute('type'), 'checkbox');
  assert.equal(await rainToggle.isChecked(), true);
  assert.equal(await page.locator('[data-data-field="shots.5.street.sign.nearestSampling"]').isChecked(), true);
  const lightningToggle = page.locator('[data-data-field="shots.5.street.rain.lightning.enabled"]');
  assert.equal(await lightningToggle.isChecked(), true);
  await lightningToggle.uncheck();
  await rainToggle.uncheck();
  await page.locator('[data-data-field="shots.5.street.sign.enabled"]').uncheck();
  assert.equal(await page.locator('[data-data-field="audio.music.selected"] option').count(), 9);
  assert.equal(await page.locator('[data-data-field="audio.music.selected"]').inputValue(), 'intro_test');
  await page.locator('[data-data-field="audio.music.selected"]').selectOption('faith_in_the_future');
  assert.equal(await page.locator('[data-object-root="audio.ambience"]').count(), 2);
  assert.equal(await page.locator('[data-data-field="audio.ambience.0.enabled"]').isChecked(), true);
  assert.equal(await page.locator('[data-data-field="activeEnvironment"] option').count(), 3);
  assert.equal(await page.locator('[data-data-field="environments.0.sky.modelId"] option').count(), 2);
  assert.equal(await page.locator('[data-data-field="actors.0.height"]').count(), 0);
  assert.equal(await page.locator('[data-data-field="sceneCenter"]').count(), 1);
  assert.equal(await page.locator('[data-object-root="environments"]').count(), 3);
  assert.equal(await page.locator('[data-object-root="actors"]').count(), 3);
  assert.equal(await page.locator('[data-data-field="shots.3.logo.enabled"]').isChecked(), true);
  assert.equal(await page.locator('[data-data-field="actors.2.arrival.rollDegrees"]').inputValue(), '-35');
  assert.equal(await page.locator('[data-data-field="camera.initialPosition"]').count(), 1);
  assert.equal(await page.locator('[data-data-field="environments.0.sky.materialSubstrings"]').count(), 0);
  const numericComponent = (path, index) => page.locator(`[data-field-row="${path}"] [data-vector-component="${index}"]`);
  await numericComponent('environments.0.sky.position', 1).fill('-6.25');
  await page.locator('[data-data-field="environments.0.sky.scale"]').fill('8.5');
  await numericComponent('actors.0.velocity', 2).fill('-1.75');
  await numericComponent('actors.0.position', 1).fill('2.25');
  await page.locator('[data-data-field="environments.0.ocean.depthMultiplier"]').fill('6');
  await page.locator('[data-data-field="fog.start"]').fill('30');
  await page.locator('input[type="number"][data-data-field="audio.ambience.0.volume"]').fill('0.8');
  await page.locator('[data-data-field="audio.ambience.1.enabled"]').uncheck();
  await numericComponent('shots.1.position', 2).fill('1.25');
  await page.locator('[data-data-field="environments.0.sky.modelId"]').selectOption('environment');
  await page.locator('#dataSave').click();
  await page.locator('.data-dirty-pill').filter({ hasText: 'Saved snapshot' }).waitFor();
  const saved = await page.evaluate(() => window.sceneSavedPayload);
  assert.equal(saved.data.shots[5].street.rain.enabled, false);
  assert.equal(saved.data.shots[5].street.rain.lightning.enabled, false);
  assert.equal(saved.data.shots[5].street.sign.nearestSampling, true);
  assert.equal(saved.data.shots[5].street.sign.enabled, false);
  assert.deepEqual(saved.data.shots[5].street.sign.position, [3, 0, 10.3]);
  assert.equal(saved.data.audio.music.selected, 'faith_in_the_future');
  assert.deepEqual(saved.data.environments[0].sky.position, [0, -6.25, 0]);
  assert.equal(saved.data.environments[0].sky.scale, 8.5);
  assert.equal(saved.data.environments[0].ocean.scale, 1);
  assert.equal(saved.data.environments[0].ocean.position[1], -0.8161758);
  assert.equal(saved.data.environments[0].sky.modelId, 'environment');
  assert.deepEqual(saved.data.actors[0].velocity, [0, 0, -1.75]);
  assert.equal(saved.createBackup, true);
  assert.equal(saved.data.actors[0].position[1], 2.25);
  assert.equal(typeof saved.data.vessels[0].position[1], 'number');
  assert.equal(saved.data.environments[0].ocean.depthMultiplier, 6);
  assert.equal(saved.data.fog.start, 30);
  assert.equal(saved.data.audio.ambience[0].volume, 0.8);
  assert.equal(saved.data.audio.ambience[1].enabled, false);
  assert.equal(saved.data.audio.ambience[0].path, 'assets/cinematic/start/audio/ferry_splashes.mp3');
  assert.equal(saved.data.shots[1].position[2], 1.25);
  assert.equal(saved.data.shots[1].vessel, 'virbank_deck');
  assert.equal(saved.data.environments[0].sky.materialSubstrings[0], 'hai01_');
  assert.deepEqual(errors, []);
  await page.locator('.data-modal-body').evaluate((element) => { element.scrollTop = 0; });
  await page.screenshot({ path: '/tmp/cinematic-admin-editor.png', fullPage: true });
  console.log('Cinematic editor: independent transforms, numeric vectors, dropdowns, and save payload passed.');
} finally {
  await browser.close();
}
