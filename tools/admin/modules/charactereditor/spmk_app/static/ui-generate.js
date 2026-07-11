/* Generate — charbin library (primary) + legacy sprite workspace */
const GEN_CHARBIN_PREFS_KEY = 'spmk.generate.charbinPrefs';
const GEN_OUTPUT_BEHAVIORS = typeof SHEET_OUTPUT_BEHAVIORS !== 'undefined' ? SHEET_OUTPUT_BEHAVIORS : ['swim', 'sleep', 'eating'];

function goToActionsTrain(outputBehavior) {
  state.view = 'actions';
  renderNav();
  renderActions();
  if (outputBehavior) {
    api('/api/packages/generate/overview').then((overview) => {
      const row = (overview.behaviors || []).find((b) => b.outputBehavior === outputBehavior);
      if (row && typeof openSheetBehaviorDetail === 'function') openSheetBehaviorDetail(row);
    }).catch(() => {});
  }
}

function genWorkflowBanner(modelTrained, outputBehavior) {
  const step1 = modelTrained ? 'done' : 'current';
  const step2 = modelTrained ? 'current' : '';
  return `<div class="card sidecard gen-workflow">
    <ol class="gen-steps">
      <li class="${step1}"><span>1</span> Train <code>${esc(outputBehavior)}</code> in <button type="button" class="btn linkish tiny" id="genGoActions">Actions</button></li>
      <li class="${step2}"><span>2</span> Pick Pokémon &amp; Generate</li>
      <li><span>3</span> Save to <code>.charbin</code></li>
    </ol>
  </div>`;
}

function genSettingsKey(mode, parts) { return `${mode}|${parts.join('|')}`; }

function loadGenCharbinPrefs() {
  try {
    const raw = localStorage.getItem(GEN_CHARBIN_PREFS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveGenCharbinPrefs(patch) {
  const next = { ...loadGenCharbinPrefs(), ...patch };
  try {
    localStorage.setItem(GEN_CHARBIN_PREFS_KEY, JSON.stringify(next));
  } catch { /* ignore */ }
  return next;
}

function ensureGenCharbinState() {
  if (!state.generateCharbin) {
    const prefs = loadGenCharbinPrefs();
    state.generateCharbin = {
      outputBehavior: prefs.outputBehavior || 'swim',
      missingOnly: prefs.missingOnly !== false,
      targetPath: prefs.targetPath || null,
      walkSheetId: prefs.walkSheetId || 'walk',
      slot: null,
      targets: [],
      loading: false,
    };
  }
  return state.generateCharbin;
}

function markGeneratePreviewStale() {
  if (state.generatePreview && !state.generatePreview.stale) {
    state.generatePreview = { ...state.generatePreview, stale: true };
  }
}

function clearGeneratePreview() { state.generatePreview = null; }

function navigateToGenerate(opts = {}) {
  state.generatePickMode = false;
  if (opts.backend) state.generateBackend = opts.backend;
  else if (!state.generateBackend) state.generateBackend = 'charbin';
  const mode = opts.mode || 'single';
  if (opts.characterId) state.selectedCharacter = opts.characterId;
  if (!state.selectedCharacter && state.project.characters?.[0]) {
    state.selectedCharacter = state.project.characters[0].id;
  }
  state.generateMode = mode;
  if (opts.actionLabel) state.selectedAction = opts.actionLabel;
  if (opts.behaviorLabel) state.selectedBehavior = opts.behaviorLabel;
  if (opts.outputBehavior) {
    ensureGenCharbinState().outputBehavior = opts.outputBehavior;
  }
  if (opts.targetPath) {
    const g = ensureGenCharbinState();
    g.targetPath = opts.targetPath;
    if (opts.walkSheetId) g.walkSheetId = opts.walkSheetId;
  }
  state.view = 'generate';
  renderNav();
  renderGenerate();
}

function staleBanner() {
  if (!state.generatePreview?.stale) return '';
  return `<div class="stale-banner card sidecard"><p>Preview is from previous settings.</p><button class="btn small" id="discardStalePreview">Discard preview</button></div>`;
}

function previewBgSelect(id, val = 'darkchecker') {
  const opts = [['darkchecker', 'Dark checker'], ['lightchecker', 'Light checker'], ['checker', 'Checker'], ['light', 'Light'], ['dark', 'Dark'], ['clear', 'Clear']];
  return `<select class="select" id="${id}">${opts.map(([v, n]) => `<option value="${v}" ${v === val ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>`;
}

function genCharbinCharacterLabel(ch) {
  if (!ch) return '—';
  const dex = ch.pokemonId != null ? `#${String(ch.pokemonId).padStart(3, '0')} ` : '';
  return `${dex}${ch.displayName || ch.packageId || 'Pokémon'}`;
}

function genCharbinUniqueCharacters(targets) {
  const byPath = new Map();
  for (const t of targets || []) {
    if (!byPath.has(t.path)) {
      byPath.set(t.path, {
        path: t.path,
        packageId: t.packageId,
        displayName: t.displayName,
        pokemonId: t.pokemonId,
      });
    }
  }
  return [...byPath.values()].sort((a, b) => {
    const da = a.pokemonId ?? 99999;
    const db = b.pokemonId ?? 99999;
    if (da !== db) return da - db;
    return String(a.displayName || a.packageId || '').localeCompare(
      String(b.displayName || b.packageId || ''),
    );
  });
}

function genCharbinSlotsForPath(targets, path) {
  return (targets || []).filter((t) => t.path === path);
}

function genCharbinSettingsKey(g) {
  return [g?.outputBehavior, g?.targetPath, g?.walkSheetId].join('|');
}

function markGenCharbinPreviewStale() {
  const g = state.generateCharbinProposal;
  if (!g || g.stale) return;
  const cur = ensureGenCharbinState();
  if (g.settingsKey !== genCharbinSettingsKey(cur)) {
    state.generateCharbinProposal = { ...g, stale: true };
  }
}

function renderGenCharbinSheetPreview(proposal) {
  if (!proposal?.sheetDataUrl) {
    return '<div class="empty">Generate to see the full sheet preview.</div>';
  }
  const stale = proposal.stale ? '<p class="tiny stale-text">Stale — settings changed</p>' : '';
  return `<div class="gen-preview-box clickable" id="genCbPreviewBox">${stale}
    <div class="thumb wide checker">${img(proposal.sheetDataUrl)}</div>
    <p class="tiny"><code>${esc(proposal.outputSheetId || '')}</code> · 4×4 sheet</p>
    <p class="tiny">Click to enlarge</p></div>`;
}

function syncGenCharbinSelection(g) {
  const characters = genCharbinUniqueCharacters(g.targets);
  if (!characters.length) {
    g.targetPath = null;
    g.walkSheetId = 'walk';
    return;
  }
  if (!g.targetPath || !characters.some((c) => c.path === g.targetPath)) {
    g.targetPath = characters[0].path;
  }
  const slots = genCharbinSlotsForPath(g.targets, g.targetPath);
  if (!slots.some((s) => s.walkSheetId === g.walkSheetId)) {
    g.walkSheetId = slots[0]?.walkSheetId || 'walk';
  }
}

async function loadGenCharbinTargets() {
  const g = ensureGenCharbinState();
  g.loading = true;
  try {
    const q = new URLSearchParams({
      outputBehavior: g.outputBehavior,
      missingOnly: g.missingOnly ? 'true' : 'false',
    });
    const res = await api(`/api/packages/generate/targets?${q}`);
    g.targets = res.targets || [];
    syncGenCharbinSelection(g);
    saveGenCharbinPrefs({
      outputBehavior: g.outputBehavior,
      missingOnly: g.missingOnly,
      targetPath: g.targetPath,
      walkSheetId: g.walkSheetId,
    });
    return g.targets;
  } finally {
    g.loading = false;
  }
}

async function loadGenCharbinSlot() {
  const g = ensureGenCharbinState();
  if (!g.targetPath) {
    g.slot = null;
    return null;
  }
  const q = new URLSearchParams({
    path: g.targetPath,
    walkSheet: g.walkSheetId || 'walk',
    outputBehavior: g.outputBehavior,
  });
  g.slot = await api(`/api/packages/generate/slot?${q}`);
  if (g.slot?.walkSheetId) g.walkSheetId = g.slot.walkSheetId;
  saveGenCharbinPrefs({
    targetPath: g.targetPath,
    walkSheetId: g.walkSheetId,
    outputBehavior: g.outputBehavior,
    missingOnly: g.missingOnly,
  });
  return g.slot;
}

const GEN_DIR_LABELS = { south: 'Down', west: 'Left', east: 'Right', north: 'Up' };

function genCharbinProposalMatches(g, proposal) {
  if (!proposal || proposal.stale || !g?.targetPath) return false;
  return proposal.settingsKey === genCharbinSettingsKey(g);
}

function genCharbinTargetLabel(slot) {
  if (!slot) return '—';
  const variant = slot.variantLabel && slot.variantLabel !== 'Default walk' ? ` · ${slot.variantLabel}` : '';
  return `${genCharbinCharacterLabel(slot)}${variant}`;
}

function genCharbinDirectionStrip(direction, frames) {
  if (!frames?.length) return '';
  return `<div class="card sidecard stack gen-dir-strip">
    <div class="section-title inline">${esc(GEN_DIR_LABELS[direction] || direction)}</div>
    <div class="row mini-strip">${frames.map((f) => `<div class="mini checker">${img(f.dataUrl)}</div>`).join('')}</div>
  </div>`;
}

function openCharbinProposalModal(proposal) {
  const dirs = Object.keys(proposal.previews || {});
  const html = `<div class="modal card big preview-modal">${modalHead('Generated proposal')}
    <p class="tiny">${esc(proposal.outputBehavior)} sheet <code>${esc(proposal.outputSheetId)}</code> · trained from library pairs</p>
    <div class="field"><label>Full sheet</label>
      <div class="thumb wide checker gen-sheet-preview">${img(proposal.sheetDataUrl)}</div></div>
    <div class="grid cols2">${dirs.map((d) => genCharbinDirectionStrip(d, proposal.previews[d])).join('')}</div>
    ${modalFoot('', `<button class="btn" id="genCbDiscard">Discard</button><button class="btn" id="genCbSaveNext">Save &amp; next</button><button class="btn primary" id="genCbSave">Save to .charbin</button>`)}</div>`;
  const m = mountModal(html, { backdropClose: true });
  $('#genCbDiscard', m.root).onclick = () => {
    state.generateCharbinProposal = null;
    m.close();
    renderGenerate();
  };
  $('#genCbSave', m.root).onclick = async () => {
    await genApplyProposal(proposal, false);
    m.close();
  };
  $('#genCbSaveNext', m.root).onclick = async () => {
    await genApplyProposal(proposal, true);
    m.close();
  };
}

async function genTrainFromLibrary() {
  const g = ensureGenCharbinState();
  const btn = $('#genCbTrain');
  const sideBtn = $('#genCbTrainSide');
  if (btn) btn.disabled = true;
  if (sideBtn) sideBtn.disabled = true;
  try {
    setSave?.('working');
    if (typeof trainCharbinSheetBehavior === 'function') {
      await trainCharbinSheetBehavior(g.outputBehavior);
    } else {
      const res = await api('/api/packages/generate/train', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outputBehavior: g.outputBehavior }),
      });
      toast(`Trained ${res.trainedFrameCount} frames from ${res.trainingSourceCount} Pokémon`);
    }
    state.generateCharbinProposal = null;
    await renderGenerateCharbin();
  } catch (e) {
    toast(String(e.message || e));
  } finally {
    if (btn) btn.disabled = false;
    if (sideBtn) sideBtn.disabled = false;
    setSave?.('ready');
  }
}

async function genRunGenerate() {
  const g = ensureGenCharbinState();
  if (!g.targetPath) { toast('Choose a Pokémon'); return; }
  const log = $('#genCbLog');
  const bar = $('#genCbBar');
  const btn = $('#genCbGenerate');
  if (btn) btn.disabled = true;
  if (log) log.textContent = 'Generating sheet from training data…';
  if (bar) bar.style.width = '35%';
  try {
    setSave?.('working');
    const proposal = await api('/api/packages/generate/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: g.targetPath,
        walkSheet: g.walkSheetId,
        outputBehavior: g.outputBehavior,
      }),
    });
    proposal.settingsKey = genCharbinSettingsKey(g);
    proposal.stale = false;
    state.generateCharbinProposal = proposal;
    if (bar) bar.style.width = '100%';
    if (log) log.textContent = `Generated ${proposal.outputSheetId} sheet — review and save.`;
    await renderGenerateCharbin();
  } catch (e) {
    if (log) log.textContent = String(e.message || e);
    toast(String(e.message || e));
  } finally {
    if (btn) btn.disabled = false;
    setSave?.('ready');
  }
}

async function genApplyProposal(proposal, advanceNext) {
  const g = ensureGenCharbinState();
  try {
    setSave?.('saving');
    await api('/api/packages/generate/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: proposal.path,
        walkSheet: proposal.walkSheetId,
        outputBehavior: proposal.outputBehavior,
      }),
    });
    toast(`Saved ${proposal.outputSheetId}`);
    state.generateCharbinProposal = null;
    if (advanceNext) {
      const res = await api(
        `/api/packages/generate/next?outputBehavior=${encodeURIComponent(proposal.outputBehavior)}&after=${encodeURIComponent(proposal.path)}&afterWalkSheet=${encodeURIComponent(proposal.walkSheetId)}`,
      );
      if (!res.done && res.entry) {
        g.targetPath = res.entry.path;
        g.walkSheetId = res.entry.walkSheetId;
      }
    }
    if (typeof loadPackageContext === 'function') await loadPackageContext();
    await renderGenerateCharbin();
  } catch (e) {
    toast(String(e.message || e));
  } finally {
    setSave?.('ready');
  }
}

async function openCharbinFromGenerate(path) {
  if (!path || typeof openCharacter !== 'function') return;
  state.view = 'packages';
  renderNav();
  await openCharacter(path);
}

async function openGeneratePickList() {
  await loadGenCharbinTargets();
  state.generatePickMode = true;
  state.view = 'packages';
  pkgState.panel = 'list';
  renderNav();
  if (typeof renderPackagesView === 'function') await renderPackagesView();
}

async function selectGenerateCharacter(path) {
  if (!path) return;
  state.generatePickMode = false;
  const g = ensureGenCharbinState();
  g.targetPath = path;
  await loadGenCharbinTargets();
  const slots = genCharbinSlotsForPath(g.targets, path);
  const first = slots.find((s) => s.missingOutput) || slots[0];
  g.walkSheetId = first?.walkSheetId || 'walk';
  markGenCharbinPreviewStale();
  saveGenCharbinPrefs({ targetPath: g.targetPath, walkSheetId: g.walkSheetId });
  state.view = 'generate';
  renderNav();
  await renderGenerate();
}

function genCharbinSelectedCharacter(g, characters) {
  if (!g?.targetPath) return null;
  return characters.find((c) => c.path === g.targetPath) || { path: g.targetPath };
}

function genCharbinLibraryEntry(path) {
  const list = pkgState?.settings?.scannedPackages || [];
  return list.find((e) => e.path === path) || null;
}

function renderGenCharbinTargetPick(g, selected, slot) {
  const entry = selected?.path ? genCharbinLibraryEntry(selected.path) : null;
  const thumbUrl = slot?.thumbnailUrl || (entry && typeof charbinThumbUrl === 'function' ? charbinThumbUrl(entry) : '');
  const thumb = thumbUrl
    ? `<div class="thumb checker">${img(thumbUrl)}</div>`
    : '<div class="thumb empty-thumb"></div>';
  const label = selected ? genCharbinCharacterLabel(selected) : 'No Pokémon selected';
  const missingTag = slot?.missingOutput ? ' · <span class="tag warn">missing</span>' : '';
  const sub = selected
    ? `<p class="tiny">${esc(slot?.displayName || selected.displayName || selected.packageId || '')}${missingTag}</p>`
    : '<p class="tiny">Browse the library and click a Pokémon.</p>';
  return `<div class="gen-target-pick card sidecard stack">
    <div class="row gen-target-row">${thumb}<div><strong>${esc(label)}</strong>${sub}</div></div>
    <button type="button" class="btn ${g.targetPath ? '' : 'primary'} full" id="genCbPickChar">${g.targetPath ? 'Change Pokémon' : 'Choose from library'}</button>
  </div>`;
}

async function renderGenerateCharbin() {
  const g = ensureGenCharbinState();
  let stats = { missing: '…' };
  try {
    stats = await api(`/api/packages/generate/stats?outputBehavior=${encodeURIComponent(g.outputBehavior)}`);
  } catch (e) {
    stats = { missing: '?', error: String(e.message || e) };
  }
  await loadGenCharbinTargets();
  await loadGenCharbinSlot();
  const slot = g.slot;
  const characters = genCharbinUniqueCharacters(g.targets);
  const selected = genCharbinSelectedCharacter(g, characters);
  const walkSlots = genCharbinSlotsForPath(g.targets, g.targetPath);
  const walkOpts = walkSlots.map((t) => {
    const sel = t.walkSheetId === g.walkSheetId ? ' selected' : '';
    const tag = t.missingOutput ? ' · missing' : '';
    const label = t.variantLabel && t.variantLabel !== 'Default walk' ? t.variantLabel : t.walkSheetId;
    return `<option value="${esc(t.walkSheetId)}"${sel}>${esc(label)}${esc(tag)}</option>`;
  }).join('');
  const outOpts = GEN_OUTPUT_BEHAVIORS.map((b) => {
    const sel = b === g.outputBehavior ? ' selected' : '';
    return `<option value="${esc(b)}"${sel}>${esc(b)}</option>`;
  }).join('');
  const sourceUrl = slot?.baseFrameUrl ? `${slot.baseFrameUrl}&t=${Date.now()}` : '';
  const model = stats.model || {};
  const modelTrained = !!model.trained;
  const trainingSources = model.trainingSourceCount ?? stats.trainingSources ?? '—';
  const missingCount = stats.missing ?? '?';
  markGenCharbinPreviewStale();
  const proposal = state.generateCharbinProposal;
  const hasPreview = !!proposal?.sheetDataUrl;
  const canSave = hasPreview && !proposal.stale;
  const genDisabled = !g.targetPath || !modelTrained ? ' disabled' : '';
  const modelLine = modelTrained
    ? `Trained · ${model.trainedFrameCount} frames · ${model.trainingSourceCount} Pokémon`
    : 'Not trained — use Train in sidebar';

  toolbar(`<button class="btn primary" id="genCharbinMode">Charbin library</button>
    <button class="btn" id="genLegacyMode">Legacy workspace</button>
    <span class="tag">${missingCount} missing ${esc(g.outputBehavior)}</span>
    <button class="btn small" id="genGoActionsToolbar">Actions</button>
    <button class="btn small" id="genCbPrevMissing">← Prev</button>
    <button class="btn small" id="genCbNextMissing">Next →</button>
    <button class="btn good small" id="genCbTrain">Train model</button>
    <button class="btn small" id="genCbOpenChar">Open character</button>`);

  $('#genCharbinMode').onclick = () => { state.generateBackend = 'charbin'; renderGenerate(); };
  $('#genLegacyMode').onclick = () => { state.generateBackend = 'legacy'; renderGenerate(); };

  $('#view').innerHTML = `${genWorkflowBanner(modelTrained, g.outputBehavior)}
  <div class="grid cols2">
    <div class="card sidecard stack">
      <h3>Sheet recipe</h3>
      <p class="tiny">Pick a Pokémon missing a sheet, then generate from library training pairs.</p>
      <div class="field"><label>Target Pokémon</label>
        ${renderGenCharbinTargetPick(g, selected, slot)}
      </div>
      <div class="field"><label>Walk form</label>
        <select class="select" id="genCbWalkSheet"${walkOpts ? '' : ' disabled'}>
          ${walkOpts || '<option value="walk">walk</option>'}
        </select>
        <p class="tiny">Source walk sheet used as input</p></div>
      <div class="field"><label>Sheet to generate</label>
        <select class="select" id="genCbOutput">${outOpts}</select></div>
      <label class="check"><input type="checkbox" id="genCbMissingOnly" ${g.missingOnly ? 'checked' : ''}> Only missing slots</label>
      <div class="section-title">Walk source</div>
      <div class="thumb wide checker">${sourceUrl ? img(sourceUrl) : '<span class="tiny">No walk source</span>'}</div>
      <p class="tiny"><code>${esc(slot?.sourceActionId || 'walk')}</code> · south frame 0 · ${esc(slot?.outputSheetId || g.outputBehavior)} target</p>
      ${statCards([['Missing slots', missingCount], ['Training sources', trainingSources]])}
      <div class="progress spaced"><div class="bar" id="genCbBar"></div></div>
      <pre class="terminal compact" id="genCbLog">${modelTrained ? 'Ready to generate.' : 'Train the model first.'}</pre>
      <div class="row"><button type="button" class="btn primary" id="genCbGenerate"${genDisabled}>Generate</button></div>
    </div>
    <div class="card sidecard stack">
      <h3>Generated preview</h3>
      <div class="row gen-preview-row">
        <div>
          <div class="section-title inline">Walk input</div>
          <div class="thumb checker">${sourceUrl ? img(sourceUrl) : '<span class="tiny">—</span>'}</div>
        </div>
        <span class="gen-arrow">→</span>
        <div id="genCbOutPreview">
          ${hasPreview ? renderGenCharbinSheetPreview(proposal) : '<div class="thumb wide empty-thumb"></div>'}
        </div>
      </div>
      ${canSave ? `<div class="row gen-action-row">
        <button type="button" class="btn primary" id="genCbSave">Save to .charbin</button>
        <button type="button" class="btn good" id="genCbSaveNext">Save &amp; next</button>
        <button type="button" class="btn" id="genCbDiscard">Discard</button>
      </div>` : hasPreview ? `<div class="row gen-action-row">
        <button type="button" class="btn" id="genCbDiscard">Discard</button>
        <p class="tiny stale-text">Settings changed — generate again to save.</p>
      </div>` : `<p class="tiny gen-charbin-hint">${esc(modelLine)}. Full 4×4 sheet with variant actions on save.</p>`}
    </div>
  </div>`;

  right(`<div class="sidecard card stack">
    <h3>Training</h3>
    <p>Train overlay models in <b>Actions</b> from Pokémon that already have walk + output sheets.</p>
    ${statCards([['Missing', missingCount], ['Sources', trainingSources]])}
    <button type="button" class="btn full" id="genGoActionsSide">Open Actions</button>
    <button type="button" class="btn good full" id="genCbTrainSide">Train ${esc(g.outputBehavior)} here</button>
    <p class="tiny">${esc(modelLine)}</p>
    <button type="button" class="btn small full" id="genCbQuickAnim">Quick anim (manual)</button>
  </div>`);

  const rerender = () => renderGenerateCharbin();

  $('#genCbOutput').onchange = async (e) => {
    g.outputBehavior = e.target.value;
    markGenCharbinPreviewStale();
    saveGenCharbinPrefs({ outputBehavior: g.outputBehavior });
    await rerender();
  };
  $('#genCbMissingOnly').onchange = async (e) => {
    g.missingOnly = !!e.target.checked;
    markGenCharbinPreviewStale();
    saveGenCharbinPrefs({ missingOnly: g.missingOnly });
    await rerender();
  };
  $('#genCbPickChar').onclick = () => openGeneratePickList();
  $('#genCbWalkSheet').onchange = async (e) => {
    g.walkSheetId = e.target.value || 'walk';
    markGenCharbinPreviewStale();
    saveGenCharbinPrefs({ walkSheetId: g.walkSheetId });
    await rerender();
  };
  const goActions = () => goToActionsTrain(g.outputBehavior);
  $('#genGoActions')?.addEventListener('click', goActions);
  $('#genGoActionsToolbar')?.addEventListener('click', goActions);
  $('#genGoActionsSide')?.addEventListener('click', goActions);
  const trainFn = () => genTrainFromLibrary();
  $('#genCbTrain').onclick = trainFn;
  $('#genCbTrainSide').onclick = trainFn;
  $('#genCbGenerate').onclick = () => genRunGenerate();
  $('#genCbOpenChar').onclick = () => { if (g.targetPath) openCharbinFromGenerate(g.targetPath); };
  $('#genCbQuickAnim').onclick = () => {
    if (typeof goToPackageQuickAnim === 'function') {
      try { localStorage.setItem('spmk.pkg.quickAnimName', g.outputBehavior); } catch { /* ignore */ }
      goToPackageQuickAnim();
    }
  };
  $('#genCbPreviewBox')?.addEventListener('click', () => {
    if (hasPreview && proposal) openCharbinProposalModal(proposal);
  });
  $('#genCbSave')?.addEventListener('click', () => { if (canSave && proposal) genApplyProposal(proposal, false); });
  $('#genCbSaveNext')?.addEventListener('click', () => { if (canSave && proposal) genApplyProposal(proposal, true); });
  $('#genCbDiscard')?.addEventListener('click', () => {
    state.generateCharbinProposal = null;
    rerender();
  });
  const goMissing = async (dir) => {
    const all = await api(`/api/packages/generate/targets?outputBehavior=${encodeURIComponent(g.outputBehavior)}&missingOnly=true`);
    const list = all.targets || [];
    if (!list.length) { toast(`No missing ${g.outputBehavior}`); return; }
    const idx = list.findIndex((t) => t.path === g.targetPath && t.walkSheetId === g.walkSheetId);
    let next;
    if (dir > 0) {
      const res = await api(
        `/api/packages/generate/next?outputBehavior=${encodeURIComponent(g.outputBehavior)}&after=${encodeURIComponent(g.targetPath || '')}&afterWalkSheet=${encodeURIComponent(g.walkSheetId || '')}`,
      );
      if (res.done) { toast(`No more missing ${g.outputBehavior}`); return; }
      next = res.entry;
    } else {
      next = idx > 0 ? list[idx - 1] : list[list.length - 1];
    }
    if (!next) return;
    g.targetPath = next.path;
    g.walkSheetId = next.walkSheetId;
    state.generateCharbinProposal = null;
    await rerender();
  };
  $('#genCbNextMissing').onclick = () => goMissing(1);
  $('#genCbPrevMissing').onclick = () => goMissing(-1);
}

function openSinglePreviewModal(c, a, preview) {
  const bg = 'darkchecker';
  const html = `<div class="modal card big preview-modal">${modalHead('Generated preview')}
    <p class="tiny">Target: ${esc(c?.name || 'character')} · Action: ${esc(a?.label || '')}</p>
    <div class="field"><label>Background</label>${previewBgSelect('prevBg', bg)}</div>
    <canvas id="bigPrevCanvas" width="320" height="320" class="editor-bg-darkchecker preview-canvas-lg"></canvas>
    ${modalFoot('', `<button class="btn" id="prevDiscard">Discard</button><button class="btn good" id="prevSaveEdit">Save + Edit</button><button class="btn primary" id="prevSave">Save</button>`)}</div>`;
  const m = mountModal(html, { backdropClose: true });
  const draw = () => drawPreviewCanvas($('#bigPrevCanvas', m.root), preview.url, `editor-bg-${$('#prevBg', m.root).value || bg}`);
  draw();
  $('#prevBg', m.root).onchange = draw;
  $('#prevDiscard', m.root).onclick = () => { clearGeneratePreview(); m.close(); renderGenerate(); };
  $('#prevSave', m.root).onclick = async () => { await saveGeneratedSingle(c, a, preview.id, false); m.close(); };
  $('#prevSaveEdit', m.root).onclick = async () => { await saveGeneratedSingle(c, a, preview.id, true); m.close(); };
}

async function saveGeneratedSingle(c, a, generatedId, openEditor) {
  if (!generatedId) return;
  const sp = await api(`/api/generated/${generatedId}/save-to-character`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ characterId: c.id, label: a.targetLabel || a.label, replaceExisting: true }),
  });
  toast('Saved');
  clearGeneratePreview();
  await refresh();
  if (openEditor) {
    state.selectedCharacter = c.id;
    state.selectedSprite = sp.id;
    state.view = 'editor';
    renderNav();
    renderEditor();
  } else {
    renderGenerate();
  }
}

function openBehaviorPreviewModal(c, b, previewData) {
  const dirs = Object.keys(previewData?.previews || {});
  let selDir = dirs[0] || 'down';
  const html = `<div class="modal card big preview-modal">${modalHead('Generated behavior preview')}
    <p class="tiny">${esc(b?.name || b?.label)} for ${esc(c?.name)}</p>
    <div class="field"><label>Animation</label><select class="select" id="behPrevDir">${dirs.map((d) => `<option value="${d}">${esc(b.prefix || b.label)}_${esc(d)}</option>`).join('')}</select></div>
    <div class="field"><label>Background</label>${previewBgSelect('behPrevBg')}</div>
    <canvas id="behBigCanvas" width="320" height="320" class="editor-bg-darkchecker preview-canvas-lg"></canvas>
    <div id="behFrameGrid" class="frame-grid"></div>
    ${modalFoot(`<button class="btn" id="behExportSheet">Export sheet</button>`, `<button class="btn" id="behPrevDiscard">Discard</button><button class="btn good" id="behPrevSaveEdit">Save + Edit behavior</button><button class="btn primary" id="behPrevSave">Save behavior</button>`)}</div>`;
  const m = mountModal(html, { backdropClose: true });
  const renderAnim = () => {
    selDir = $('#behPrevDir', m.root).value;
    const frames = previewData.previews[selDir] || [];
    const url = frames[0]?.url || v12FrameUrl(frames[0]);
    drawPreviewCanvas($('#behBigCanvas', m.root), url, `editor-bg-${$('#behPrevBg', m.root).value || 'darkchecker'}`);
    $('#behFrameGrid', m.root).innerHTML = frames.map((f, i) => `<button type="button" class="btn small" data-i="${i}">${selDir}_${i}</button>`).join('');
    $$('#behFrameGrid button', m.root).forEach((btn) => {
      btn.onclick = () => drawPreviewCanvas($('#behBigCanvas', m.root), v12FrameUrl(frames[btn.dataset.i]), `editor-bg-${$('#behPrevBg', m.root).value || 'darkchecker'}`);
    });
  };
  $('#behPrevDir', m.root).onchange = renderAnim;
  $('#behPrevBg', m.root).onchange = renderAnim;
  renderAnim();
  $('#behPrevDiscard', m.root).onclick = () => { clearGeneratePreview(); m.close(); renderGenerate(); };
  $('#behExportSheet', m.root).onclick = () => { if (c && b) location.href = `/api/export/behavior-sheet/${c.id}/${encodeURIComponent(b.label)}?scale=1`; };
  $('#behPrevSave', m.root).onclick = async () => { await saveGeneratedBehavior(c, b, false); m.close(); };
  $('#behPrevSaveEdit', m.root).onclick = async () => { await saveGeneratedBehavior(c, b, true); m.close(); };
}

async function saveGeneratedBehavior(c, b, openEditor) {
  if ((c.generatedBehaviors || []).some((r) => r.behavior === b.label) && !confirm('This behavior already exists for this character. Retry and overwrite it?')) return;
  const out = await api(`/api/behaviors/${encodeURIComponent(b.label)}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ characterId: c.id, replaceExisting: true }),
  });
  toast('Behavior saved');
  clearGeneratePreview();
  await refresh();
  if (openEditor) {
    state.view = 'editor';
    state.selectedCharacter = c.id;
    state.selectedAnimation = out.animations?.[0]?.id;
    renderNav();
    renderEditor();
  } else {
    renderGenerate();
  }
}

function renderGeneratePreviewPanel(preview, onClick) {
  if (!preview) return '<div class="empty">Generate to see preview.</div>';
  const stale = preview.stale ? '<p class="tiny stale-text">Stale — settings changed</p>' : '';
  if (preview.mode === 'single') {
    return `<div class="gen-preview-box clickable" id="genPreviewBox">${stale}<div class="thumb wide">${img(preview.url)}</div><p class="tiny">${esc(preview.label || 'output')}</p><p class="tiny">Click to enlarge</p></div>`;
  }
  const dirs = Object.keys(preview.previews || {});
  return `<div class="gen-preview-box clickable" id="genPreviewBox">${stale}${dirs.map((d) => `<div class="card sidecard stack"><h3>${esc(d)}</h3>${v12AnimationStrip(preview.previews[d])}</div>`).join('') || '<div class="empty">No frames</div>'}<p class="tiny">Click to enlarge</p></div>`;
}

function bindClick(sel, fn, root = document) { const el = $(sel, root); if (el) el.addEventListener('click', fn); }

function bindGeneratePreviewActions(c, a, b) {
  const p = state.generatePreview;
  if (!p || p.stale) return;
  bindClick('#genPreviewBox', () => {
    if (p.mode === 'single') openSinglePreviewModal(c, a, p);
    else openBehaviorPreviewModal(c, b, p);
  });
  bindClick('#discardPreview', () => { clearGeneratePreview(); renderGenerate(); });
  bindClick('#saveGenChar', () => saveGeneratedSingle(c, a, p.id, false));
  bindClick('#saveEditGen', () => saveGeneratedSingle(c, a, p.id, true));
  bindClick('#genBehavior', () => saveGeneratedBehavior(c, b, false));
  bindClick('#genEditBehavior', () => saveGeneratedBehavior(c, b, true));
  bindClick('#discardBehPreview', () => { clearGeneratePreview(); renderGenerate(); });
}

function renderGenerateLegacyToolbar(mode) {
  return `<button class="btn" id="genCharbinMode">Charbin library</button>
    <button class="btn ${mode === 'single' ? 'primary' : ''}" id="singleMode">Legacy · single</button>
    <button class="btn ${mode === 'behavior' ? 'primary' : ''}" id="behaviorMode">Legacy · behavior</button>`;
}

function renderGenerate() {
  title('Generate');
  if (!state.generateBackend) state.generateBackend = 'charbin';
  const mode = state.generateMode || 'single';
  toolbar(`<button class="btn ${state.generateBackend === 'charbin' ? 'primary' : ''}" id="genCharbinMode">Charbin library</button>
    <button class="btn ${state.generateBackend === 'legacy' ? 'primary' : ''}" id="genLegacyMode">Legacy workspace</button>`);

  $('#genCharbinMode').onclick = () => { state.generateBackend = 'charbin'; renderGenerate(); };
  $('#genLegacyMode').onclick = () => { state.generateBackend = 'legacy'; renderGenerate(); };

  if (state.generateBackend === 'charbin') {
    void renderGenerateCharbin();
    return;
  }

  toolbar(renderGenerateLegacyToolbar(mode));
  if (mode === 'behavior') return renderGenerateBehavior();
  const chars = state.project.characters || [];
  state.selectedCharacter = state.selectedCharacter || chars[0]?.id;
  const c = selectedCharacter();
  const learned = singleActions().filter((a) => a.learned);
  const a = learned.find((x) => x.label === state.selectedAction) || learned[0];
  if (a) state.selectedAction = a.label;
  const sprites = spritesForCharacter(c?.id);
  const compatible = sprites.filter((s) => s.label === (a?.inputLabel || inferBaseLabel(a?.label || '')));
  const target = compatible.find((s) => s.id === state.selectedSprite) || compatible[0] || sprites[0];
  const key = genSettingsKey('single', [c?.id, a?.label, target?.id]);
  if (state.generatePreview && state.generatePreview.settingsKey !== key) markGeneratePreviewStale();
  const hasPreview = state.generatePreview && state.generatePreview.mode === 'single' && !state.generatePreview.stale;
  $('#view').innerHTML = `${staleBanner()}<div class="grid cols2"><div class="card sidecard stack"><h3>Legacy single action</h3>
    <p class="tiny">Uses <code>workspace/project.json</code> characters and trained Actions — not .charbin.</p>
    <div class="field"><label>Target character</label><select class="select" id="genChar">${chars.map((ch) => `<option value="${ch.id}" ${ch.id === c?.id ? 'selected' : ''}>${esc(ch.name)}</option>`).join('')}</select></div>
    <div class="field"><label>Learned action</label><select class="select" id="actionLabel">${learned.map((x) => `<option value="${x.label}" ${x.label === a?.label ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}</select></div>
    <div class="field"><label>Compatible input sprite</label><select class="select" id="targetSprite">${(compatible.length ? compatible : sprites).map((s) => `<option value="${s.id}" ${s.id === target?.id ? 'selected' : ''}>${esc(s.label || s.name)}</option>`).join('')}</select></div>
    <div class="progress spaced"><div class="bar" id="genBar"></div></div><pre class="terminal compact" id="genLog">Ready to generate.</pre>
    <div class="row"><button class="btn primary" id="genBtn">Generate</button></div></div>
    <div class="card sidecard stack"><h3>Preview</h3><div class="row"><div><div class="thumb">${img(target?.url)}</div><p class="tiny">${esc(target?.label || 'input')}</p></div><span>→</span><div id="outPreview">${hasPreview ? renderGeneratePreviewPanel(state.generatePreview) : '<div class="thumb empty-thumb"></div>'}</div></div>
    ${hasPreview ? `<div class="row gen-action-row"><button class="btn primary" id="saveGenChar">Save</button><button class="btn good" id="saveEditGen">Save + Edit</button><button class="btn" id="discardPreview">Discard</button></div>` : ''}</div></div>`;
  right(`<div class="sidecard card"><h3>Legacy generate</h3><p>Train actions in the Actions tab first. For .charbin Pokémon, use <b>Charbin library</b> mode.</p></div>`);
  $('#singleMode').onclick = () => { state.generateMode = 'single'; renderGenerate(); };
  $('#behaviorMode').onclick = () => { state.generateMode = 'behavior'; renderGenerate(); };
  $('#genChar').onchange = (e) => { state.selectedCharacter = e.target.value; state.selectedSprite = null; markGeneratePreviewStale(); renderGenerate(); };
  $('#actionLabel').onchange = (e) => { state.selectedAction = e.target.value; state.selectedSprite = null; markGeneratePreviewStale(); renderGenerate(); };
  $('#targetSprite').onchange = (e) => { state.selectedSprite = e.target.value; markGeneratePreviewStale(); renderGenerate(); };
  const staleBtn = $('#discardStalePreview');
  if (staleBtn) staleBtn.onclick = () => { clearGeneratePreview(); renderGenerate(); };
  $('#genBtn').onclick = async () => {
    if (!target || !a) { toast('Choose a trained action and compatible sprite'); return; }
    $('#genBar').style.width = '35%';
    const g = await api('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetId: target.id, label: a.label, name: `${c?.name || 'character'}_${a.targetLabel || a.label}` }),
    });
    $('#genBar').style.width = '100%';
    state.generatePreview = { mode: 'single', id: g.id, url: g.url, label: a.targetLabel || a.label, settingsKey: key, stale: false };
    renderGenerate();
  };
  bindGeneratePreviewActions(c, a, null);
}

async function renderGenerateBehavior() {
  const chars = state.project.characters || [];
  state.selectedCharacter = state.selectedCharacter || chars[0]?.id;
  const c = selectedCharacter();
  const behaviors = behaviorActions().filter((b) => b.learnedFrames && Object.keys(b.learnedFrames).length);
  const b = behaviors.find((x) => x.label === state.selectedBehavior) || behaviors[0];
  if (b) state.selectedBehavior = b.label;
  const dirs = b?.directions || ['down', 'left', 'right', 'up'];
  const src = b ? await api(`/api/behaviors/${encodeURIComponent(b.label)}/sources`).catch(() => ({ ready: [], excludedGenerated: [] })) : { ready: [] };
  const key = genSettingsKey('behavior', [c?.id, b?.label]);
  if (state.generatePreview && state.generatePreview.settingsKey !== key) markGeneratePreviewStale();
  const hasPreview = state.generatePreview && state.generatePreview.mode === 'behavior' && !state.generatePreview.stale;
  const baseStatus = dirs.map((d) => ({ d, sp: v11Sprite(c, `base_${d}`) }));
  $('#view').innerHTML = `${staleBanner()}<div class="grid cols2"><div class="card sidecard stack"><h3>Legacy behavior recipe</h3>
    <div class="field"><label>Target character</label><select class="select" id="behChar">${chars.map((ch) => `<option value="${ch.id}" ${ch.id === c?.id ? 'selected' : ''}>${esc(ch.name)}</option>`).join('')}</select></div>
    <div class="field"><label>Trained behavior</label><select class="select" id="behSelect">${behaviors.map((x) => `<option value="${x.label}" ${x.label === b?.label ? 'selected' : ''}>${esc(x.name || x.label)}</option>`).join('')}</select></div>
    <div class="section-title">Target bases</div><div class="sprite-strip">${baseStatus.map((x) => `<div class="mini ${x.sp ? '' : 'missing'}">${x.sp ? img(x.sp.url) : '!'}</div>`).join('')}</div>
    ${statCards([['Training sources', src.ready?.length || 0], ['Excluded generated', src.excludedGenerated?.length || 0]])}
    <div class="progress spaced"><div class="bar" id="behBar"></div></div><pre class="terminal compact" id="behLog">Preview before saving.</pre>
    <div class="row"><button class="btn primary" id="previewBehavior">Preview</button></div></div>
    <div class="card sidecard stack"><h3>Generated preview</h3><div id="behResult">${hasPreview ? renderGeneratePreviewPanel(state.generatePreview) : '<div class="empty">Click Preview to render temporary behavior frames.</div>'}</div>
    ${hasPreview ? `<div class="row gen-action-row"><button class="btn primary" id="genBehavior">Save behavior</button><button class="btn good" id="genEditBehavior">Save + Edit behavior</button><button class="btn" id="discardBehPreview">Discard</button><button class="btn" id="exportBehavior">Export sheet</button></div>` : ''}</div></div>`;
  right(`<div class="sidecard card"><h3>Behavior quality</h3><p>Preview persists until discarded or settings change.</p></div>`);
  $('#singleMode').onclick = () => { state.generateMode = 'single'; renderGenerate(); };
  $('#behaviorMode').onclick = () => { state.generateMode = 'behavior'; renderGenerate(); };
  const staleBtn2 = $('#discardStalePreview');
  if (staleBtn2) staleBtn2.onclick = () => { clearGeneratePreview(); renderGenerate(); };
  $('#behChar').onchange = (e) => { state.selectedCharacter = e.target.value; markGeneratePreviewStale(); renderGenerate(); };
  $('#behSelect').onchange = (e) => { state.selectedBehavior = e.target.value; markGeneratePreviewStale(); renderGenerate(); };
  $('#previewBehavior').onclick = async () => {
    if (!b) { toast('Train a behavior first'); return; }
    $('#behBar').style.width = '35%';
    const out = await api(`/api/behaviors/${encodeURIComponent(b.label)}/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ characterId: c.id }),
    });
    $('#behBar').style.width = '100%';
    state.generatePreview = { mode: 'behavior', previews: out.previews || {}, settingsKey: key, stale: false, behaviorLabel: b.label };
    renderGenerate();
  };
  const exportBeh = $('#exportBehavior');
  if (exportBeh) exportBeh.onclick = () => { if (b && c) location.href = `/api/export/behavior-sheet/${c.id}/${encodeURIComponent(b.label)}?scale=1`; };
  bindGeneratePreviewActions(c, null, b);
}
