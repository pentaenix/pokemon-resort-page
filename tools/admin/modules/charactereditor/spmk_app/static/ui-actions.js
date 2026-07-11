/* Actions — sheet behavior training (charbin) + legacy sprite workspace */
const SHEET_OUTPUT_BEHAVIORS = ['swim', 'sleep', 'eating'];
const SHEET_BEHAVIOR_META = {
  swim: { label: 'Swim', blurb: 'Full 4×4 walk → swim sheet from library pairs.' },
  sleep: { label: 'Sleep', blurb: 'South row × 2 frames — one sleep strip per walk form.' },
  eating: { label: 'Eating', blurb: 'Full 4×4 walk → eating sheet from library pairs.' },
};

function sheetBehaviorCardClass(trained) {
  return trained ? 'good' : 'warn';
}

function fmtTrainTime(ms) {
  if (!ms) return '—';
  try { return new Date(ms).toLocaleString(); } catch { return '—'; }
}

async function trainCharbinSheetBehavior(outputBehavior, onTick) {
  const steps = ['Scanning charbin library…', 'Learning per-frame masks…', 'Saving model…'];
  onTick?.({ training: true, pct: 8, text: steps[0], error: '' });
  let i = 0;
  const timer = setInterval(() => {
    i = Math.min(i + 1, steps.length - 1);
    onTick?.({ training: true, pct: 20 + i * 25, text: steps[i], error: '' });
  }, 450);
  try {
    const res = await api('/api/packages/generate/train', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ outputBehavior }),
    });
    clearInterval(timer);
    onTick?.({ training: true, pct: 100, text: 'Training complete', error: '' });
    toast(`Trained ${outputBehavior} · ${res.trainedFrameCount} frames · ${res.trainingSourceCount} Pokémon`);
    return res;
  } catch (e) {
    clearInterval(timer);
    onTick?.({ training: false, pct: 0, text: '', error: e.message || String(e) });
    toast('Training failed');
    throw e;
  }
}

function sheetBehaviorQualityHtml(quality, directions, fpd) {
  if (!quality || !directions?.length) {
    return '<p class="tiny">Train to see per-frame quality.</p>';
  }
  const rows = [];
  for (const dir of directions) {
    const qlist = quality[dir] || [];
    for (let fi = 0; fi < fpd; fi++) {
      const q = qlist.find((x) => Number(x.frame) === fi) || qlist[fi];
      const ex = q?.examples ?? 0;
      const cons = q?.consistency || (ex ? '—' : 'missing');
      const tag = cons === 'missing' ? 'bad' : cons === 'high' ? 'good' : '';
      rows.push(`<tr><td><code>${esc(dir)}</code></td><td>${fi}</td><td>${ex}</td><td>${tag ? `<span class="tag short ${tag}">${esc(cons)}</span>` : esc(cons)}</td></tr>`);
    }
  }
  return `<table class="tiny sheet-quality-table"><thead><tr><th>Dir</th><th>Frame</th><th>Examples</th><th>Quality</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
}

async function openSheetBehaviorDetail(row) {
  if (!row) return;
  const id = row.outputBehavior;
  const meta = SHEET_BEHAVIOR_META[id] || { label: id, blurb: '' };
  let training = false;
  let trainPct = 0;
  let trainText = '';
  let trainError = '';
  let detail = row;

  const loadDetail = async () => {
    detail = await api(`/api/packages/generate/model?outputBehavior=${encodeURIComponent(id)}&detail=true`);
    detail.missing = row.missing;
    detail.librarySources = row.librarySources ?? detail.librarySources;
    return detail;
  };
  await loadDetail();

  const renderBody = () => {
    const model = detail;
    const trained = !!model.trained;
    const dirs = model.directions || row.directions || [];
    const fpd = model.framesPerDirection || row.framesPerDirection || 4;
    const frameGrid = dirs.map((dr) => {
      const keys = model.learnedFrameKeys?.[dr] || [];
      return `<div class="frame-row">${Array.from({ length: fpd }, (_, i) => {
        const ok = keys.includes(i);
        return `<span class="tag short ${ok ? 'good' : ''}">${esc(dr)}_${i}</span>`;
      }).join('')}</div>`;
    }).join('');
    const err = trainError ? `<div class="modal-error card sidecard"><h4>Training failed</h4><p class="tiny">${esc(trainError)}</p></div>` : '';
    const footLeft = '';
    const footRight = `<button type="button" class="btn good" data-action="train" ${training ? 'disabled' : ''}>Train from library</button><button type="button" class="btn primary" data-action="open-generate" ${training ? 'disabled' : ''}>Open Generate</button>`;
    return `<div class="action-summary">
      <div class="action-summary-top"><strong>${esc(meta.label)}</strong>
        <span class="tag short ${sheetBehaviorCardClass(trained)}">${trained ? 'trained' : 'not trained'}</span>
        <span class="tag short">Sheet behavior</span></div>
      <p class="tiny">${esc(meta.blurb)}</p>
      <p class="tiny">Walk column 0 → output frames · overlay model in <code>workspace/generate_models/${esc(id)}.json</code></p>
    </div>
    ${trainingProgressHtml(training, trainPct, trainText)}${err}
    <div class="modal-section"><h4>Library training</h4>
      ${statCards([
        ['Charbin sources', detail.librarySources ?? '—'],
        ['Missing slots', detail.missing ?? row.missing ?? '—'],
        ['Trained frames', model.trainedFrameCount ?? 0],
        ['Last trained', trained ? fmtTrainTime(model.trainedAt) : '—'],
      ])}
      <p class="tiny">Sources are Pokémon with both <b>walk</b> and <b>${esc(id)}</b> sheets in the library. Training learns conservative masks per direction/frame.</p>
    </div>
    <div class="modal-section"><h4>Frame coverage</h4><div class="frame-grid sheet-frame-grid">${frameGrid || '<p class="tiny">No frames yet.</p>'}</div></div>
    <div class="modal-section"><h4>Per-frame quality</h4>${sheetBehaviorQualityHtml(model.quality, dirs, fpd)}</div>
    ${modalFoot(footLeft, footRight)}`;
  };

  const mount = () => {
    if (state._sheetBehModal?.backdrop) state._sheetBehModal.backdrop.remove();
    const html = `<div class="modal card action-modal big">${modalHead(`${meta.label} sheet model`)}
      <div id="sheetBehModalBody">${renderBody()}</div></div>`;
    const m = mountModal(html, { backdropClose: true });
    state._sheetBehModal = m;
    bindModalActions(m.root, {
      train: async () => {
        try {
          await trainCharbinSheetBehavior(id, (s) => {
            training = s.training;
            trainPct = s.pct;
            trainText = s.text;
            trainError = s.error || '';
            $('#sheetBehModalBody', m.root).innerHTML = renderBody();
          });
          await loadDetail();
        } catch { /* toast shown */ }
        training = false;
        $('#sheetBehModalBody', m.root).innerHTML = renderBody();
      },
      'open-generate': () => {
        m.close();
        if (typeof navigateToGenerate === 'function') {
          navigateToGenerate({ backend: 'charbin', outputBehavior: id });
        }
      },
    });
  };
  mount();
}

function sheetBehaviorCard(row) {
  const id = row.outputBehavior;
  const meta = SHEET_BEHAVIOR_META[id] || { label: id, blurb: '' };
  const model = row.model || {};
  const trained = !!model.trained;
  const dirs = row.directions?.length || 0;
  const fpd = row.framesPerDirection || 4;
  return `<div class="card sidecard action-card sheet-behavior-card" data-sheet-behavior="${esc(id)}">
    <div class="sheet-beh-head"><h3>${esc(meta.label)}</h3>
      <span class="tag short ${sheetBehaviorCardClass(trained)}">${trained ? 'trained' : 'needs train'}</span></div>
    <p class="tiny">${dirs} dir${dirs === 1 ? '' : 's'} × ${fpd} frames · <b>${row.librarySources ?? '—'}</b> library sources</p>
    <p class="tiny"><b>${row.missing ?? '?'}</b> missing in library · ${model.trainedFrameCount || 0} learned frames</p>
    <p class="tiny sheet-beh-blurb">${esc(meta.blurb)}</p>
    <div class="row sheet-beh-actions">
      <button type="button" class="btn good small" data-sheet-train="${esc(id)}">Train</button>
      <button type="button" class="btn primary small" data-sheet-generate="${esc(id)}">Generate</button>
    </div>
  </div>`;
}

async function renderActions() {
  initSelectState();
  title('Actions');
  toolbar(`<button class="btn good" id="actTrainAll">Train all sheet models</button><button class="btn" id="actOpenGenerate">Open Generate</button>`);

  let overview = { behaviors: [] };
  let overviewError = '';
  try {
    overview = await api('/api/packages/generate/overview');
  } catch (e) {
    overviewError = String(e.message || e);
  }

  const sheetRows = overview.behaviors?.length
    ? overview.behaviors
    : SHEET_OUTPUT_BEHAVIORS.map((id) => ({
      outputBehavior: id,
      directions: id === 'sleep' ? ['south'] : ['south', 'west', 'east', 'north'],
      framesPerDirection: id === 'sleep' ? 2 : 4,
      missing: '?',
      librarySources: '?',
      model: { trained: false },
    }));

  const singles = singleActions();
  const behaviors = behaviorActions();
  const sel = isSelectMode('actions');
  const cardCls = (lb) => `card sidecard action-card selectable-card ${isSelected('actions', lb) ? 'selected' : ''}`;
  const singleCard = (a) => {
    const src = findTrainingSources(a);
    const del = cardDeleteBtn(`Delete action ${a.label}`, 'data-del-single', a.label);
    const chk = sel ? selectCheckbox('actions', a.label) : '';
    return `<div class="${cardCls(a.label)}" data-label="${esc(a.label)}" data-kind="single">${del}${chk}<h3>${esc(a.label)}</h3><p>${esc(a.inputLabel || inferBaseLabel(a.label))} → ${esc(a.targetLabel || a.label)}</p>${actionCardPreview(a)}<p class="tiny">${src.ready.length} ready source${src.ready.length === 1 ? '' : 's'} · legacy</p></div>`;
  };
  const behCard = (b) => {
    const del = cardDeleteBtn(`Delete behavior ${b.name || b.label}`, 'data-del-beh', b.label);
    const chk = sel ? selectCheckbox('actions', b.label) : '';
    const charbin = SHEET_OUTPUT_BEHAVIORS.includes(b.prefix || b.label);
    return `<div class="${cardCls(b.label)}" data-label="${esc(b.label)}" data-kind="behavior">${del}${chk}<h3>${esc(b.name || b.label)}</h3><p>${esc(b.prefix)} · ${(b.directions || []).length || 4} directions × ${b.framesPerDirection || 4} frames</p>${behaviorCardPreview(b)}<p class="tiny">${b.trainingSourceCount || 0} sources · legacy${charbin ? ' · use sheet card above' : ''}</p></div>`;
  };

  const workflow = `<div class="card sidecard actions-workflow">
    <div class="section-title inline">Sheet generation pipeline</div>
    <ol class="actions-steps tiny">
      <li><b>Train</b> models here from charbins that already have walk + output sheets.</li>
      <li><b>Generate</b> missing sheets for Pokémon that only have walk.</li>
      <li><b>Save</b> proposals into <code>.charbin</code> with variant actions.</li>
    </ol>
    ${overviewError ? `<p class="tiny stale-text">${esc(overviewError)}</p>` : ''}
  </div>`;

  $('#view').innerHTML = `${workflow}
    <div class="section-head"><span class="section-title inline">Sheet behaviors</span><span class="tag">charbin library</span></div>
    <div class="grid cols3 sheet-beh-grid">${sheetRows.map(sheetBehaviorCard).join('')}</div>
    <details class="pkg-lib-collapse actions-legacy">
      <summary class="pkg-lib-collapse-summary"><span class="section-title inline">Legacy sprite workspace</span><span class="tag">project.json</span></summary>
      <div class="actions-legacy-body">
        <div class="row actions-legacy-toolbar">
          <button type="button" class="btn small" id="newAction">＋ Single action</button>
          <button type="button" class="btn small" id="newBehavior">＋ Behavior</button>
        </div>
        ${bulkBar('actions', 'actions')}
        ${sectionHead('Behavior actions', 'actions')}
        ${behaviors.length ? `<div class="grid cols3">${behaviors.map(behCard).join('')}</div>` : '<div class="empty">No legacy behavior actions.</div>'}
        ${sectionHead('Single-frame actions', 'actions')}
        <div class="grid cols3">${singles.map(singleCard).join('') || '<div class="empty">No single actions.</div>'}</div>
      </div>
    </details>`;

  right(`<div class="sidecard card"><h3>Sheet behaviors</h3>
    <p>Train <b>swim</b>, <b>sleep</b>, and <b>eating</b> from your Pokémon library. Each model learns overlay masks from existing walk→output sheet pairs.</p>
    <p class="tiny">Models: <code>workspace/generate_models/</code></p>
    <button type="button" class="btn good full" id="actOpenGenerateSide">Open Generate</button>
  </div>
  <div class="sidecard card"><h3>Legacy actions</h3>
    <p>Single poses and custom behaviors for the old sprite workspace — not used for .charbin batch generate.</p></div>`);

  const openGen = () => {
    if (typeof navigateToGenerate === 'function') navigateToGenerate({ backend: 'charbin' });
  };
  $('#actOpenGenerate').onclick = openGen;
  $('#actOpenGenerateSide').onclick = openGen;

  $('#actTrainAll').onclick = async () => {
    const btn = $('#actTrainAll');
    if (btn) btn.disabled = true;
    try {
      for (const row of sheetRows) {
        try {
          await trainCharbinSheetBehavior(row.outputBehavior);
        } catch { /* continue */ }
      }
      await renderActions();
    } finally {
      if (btn) btn.disabled = false;
    }
  };

  $$('[data-sheet-behavior]').forEach((el) => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-sheet-train],[data-sheet-generate]')) return;
      const id = el.dataset.sheetBehavior;
      const row = sheetRows.find((r) => r.outputBehavior === id);
      if (row) openSheetBehaviorDetail(row);
    });
  });
  $$('[data-sheet-train]').forEach((btn) => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      btn.disabled = true;
      try {
        await trainCharbinSheetBehavior(btn.dataset.sheetTrain);
        await renderActions();
      } finally {
        btn.disabled = false;
      }
    };
  });
  $$('[data-sheet-generate]').forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      navigateToGenerate({ backend: 'charbin', outputBehavior: btn.dataset.sheetGenerate });
    };
  });

  const newAct = $('#newAction');
  if (newAct) newAct.onclick = openActionModal;
  const newBeh = $('#newBehavior');
  if (newBeh) newBeh.onclick = openBehaviorModal;
  bindSelectMode('actions', renderActions, bulkDeleteActions);
  $$('.action-card.selectable-card').forEach((el) => {
    const lb = el.dataset.label;
    const kind = el.dataset.kind;
    if (!lb) return;
    bindCardOpen(el, () => {
      const beh = behaviors.find((x) => x.label === lb);
      if (kind === 'behavior' || beh) openBehaviorDetail(beh || behaviors.find((x) => x.label === lb));
      else openActionDetail(singles.find((x) => x.label === lb));
    }, 'actions', lb, renderActions);
  });
  $$('[data-del-single]').forEach((b) => b.onclick = (e) => { e.stopPropagation(); deleteSingleAction(b.dataset.delSingle); });
  $$('[data-del-beh]').forEach((b) => b.onclick = (e) => { e.stopPropagation(); deleteBehaviorAction(behaviors.find((x) => x.label === b.dataset.delBeh)); });
}

async function deleteSingleAction(label) {
  if (!confirm(`Delete action "${label}"?\n\nThis removes the learned action and learned data.\nIt does not delete any character sprites.`)) return;
  await api('/api/actions/' + encodeURIComponent(label), { method: 'DELETE' });
  toast('Action deleted'); await refresh(); renderActions();
}
async function deleteBehaviorAction(b) {
  const name = b?.name || b?.label || 'behavior';
  if (!confirm(`Delete behavior "${name}"?\n\nThis removes the behavior definition, its internal frame transforms, and learned behavior data.\nIt does not delete source training sprites.`)) return;
  await api('/api/actions/' + encodeURIComponent(b.label), { method: 'DELETE' });
  toast('Behavior deleted'); await refresh(); renderActions();
}
function actionCardPreview(a) {
  const src = findTrainingSources(a);
  const ex = src.ready[0];
  if (a.learned?.diffUrl) return `<div class="action-card-preview change-map compact">${img(a.learned.diffUrl)}</div>`;
  if (ex?.base?.url && ex?.out?.url) return `<div class="action-card-preview row"><div class="mini">${img(ex.base.url)}</div><span>→</span><div class="mini">${img(ex.out.url)}</div></div>`;
  return `<p class="tiny preview-placeholder">${a.learned ? 'Preview unavailable' : 'Train to preview'}</p>`;
}
function behaviorCardPreview(b) {
  const dirs = b.directions || ['down', 'left', 'right', 'up'];
  const prefix = b.prefix || b.label || 'behavior';
  const fpd = b.framesPerDirection || 4;
  const lf = (b.learnedFrames?.[dirs[0]] || [])[0];
  if (lf?.diffUrl) return `<div class="action-card-preview change-map compact">${img(lf.diffUrl)}</div>`;
  const c = (state.project.characters || []).find((ch) => (ch.sprites || []).some((s) => (s.label || '').startsWith(`${prefix}_${dirs[0]}_`)));
  if (c) {
    const frames = Array.from({ length: Math.min(fpd, 4) }, (_, i) => v11Sprite(c, `${prefix}_${dirs[0]}_${i}`)).filter(Boolean);
    if (frames.length) return `<div class="action-card-preview row mini-strip">${frames.map((s) => `<div class="mini">${img(s.url)}</div>`).join('')}</div>`;
  }
  return `<p class="tiny preview-placeholder">${Object.keys(b.learnedFrames || {}).length ? 'No trained preview yet' : 'Train to preview'}</p>`;
}
function behaviorSourceRowsHtml(rows) {
  return trainingSourceRowsHtml(rows);
}
function trainingSourceRowsHtml(rows, actionLabel) {
  if (!rows?.length) return '<p class="tiny">No characters in project.</p>';
  return `<div class="source-rows">${rows.map((r) => {
    const btn = r.status === 'included' ? `<button type="button" class="btn small" data-action="exclude-source" data-cid="${esc(r.characterId)}">Exclude</button>`
      : r.status === 'excluded' && r.provenance === 'generated' ? `<button type="button" class="btn small" data-action="include-source" data-cid="${esc(r.characterId)}">Include</button>`
        : r.status === 'excluded' ? `<button type="button" class="btn small" data-action="include-source" data-cid="${esc(r.characterId)}">Include</button>`
          : `<button type="button" class="btn small" data-action="source-details" data-cid="${esc(r.characterId)}">Details</button>`;
    return `<div class="source-row"><div class="source-row-main"><b>${esc(r.characterName)}</b><span class="tag short">${esc(r.status)}</span><span class="tiny">${esc(r.provenance || '')}</span>${r.missingReason ? `<span class="tiny missing-reason">${esc(r.missingReason)}</span>` : ''}</div>${btn}</div>`;
  }).join('')}</div>`;
}

function charbinOutputBehaviorForLegacy(b) {
  const prefix = (b?.prefix || b?.label || '').toLowerCase();
  return SHEET_OUTPUT_BEHAVIORS.includes(prefix) ? prefix : null;
}

async function openActionDetail(action) {
  if (!action) return;
  let editMode = false; let training = false; let trainError = ''; let trainPct = 0; let trainText = ''; let refs = (action.referenceLabels || []).slice();
  let sourceRows = []; let labels = allLabels();
  const loadSources = async () => {
    const out = await api('/api/actions/' + encodeURIComponent(action.label) + '/sources');
    sourceRows = out.rows || [];
    action = out.action || action;
    return out;
  };
  await loadSources();
  const freshAction = () => (state.project.actions || []).find((x) => x.label === action.label) || action;
  const renderBody = () => {
    action = freshAction();
    const src = findTrainingSources(action);
    const ready = sourceRows.filter((r) => r.status === 'included');
    const consistency = trainingConsistency(ready.length, sourceRows.filter((r) => r.status === 'missing' || r.status === 'incomplete').length);
    const ex = ready[0] || src.ready[0];
    const summary = `<div class="action-summary"><div class="action-summary-top"><strong>${esc(action.label)}</strong><span class="tag short">${action.learned ? 'trained' : 'untrained'}</span><span class="tag short">Legacy single</span></div><p class="tiny">${esc(action.inputLabel || src.input)} → ${esc(action.targetLabel || action.label)}</p><p class="tiny">${esc(action.description || 'Adds/learns the ' + action.label + ' pose.')}</p></div>`;
    const overview = editMode ? '' : `<div class="modal-section"><h4>Overview</h4><dl class="def-list"><dt>Input label</dt><dd>${esc(action.inputLabel || src.input)}</dd><dt>Target label</dt><dd>${esc(action.targetLabel || action.label)}</dd><dt>References</dt><dd>${(action.referenceLabels || []).length ? (action.referenceLabels || []).map((l) => `<span class="tag short">${esc(l)}</span>`).join(' ') : '—'}</dd></dl>${ex ? `<div class="section-title">Example source</div><div class="row example-pair"><div class="mini">${img(ex.base?.url || ex.target?.url)}</div><span>→</span><div class="mini">${img(ex.target?.url || ex.out?.url)}</div></div>` : ''}</div>`;
    const trainingSec = `<div class="modal-section"><h4>Training stats</h4>${statCards([['Ready sources', ready.length], ['Incomplete', sourceRows.filter((r) => r.status === 'missing' || r.status === 'incomplete').length], ['Generated excluded', sourceRows.filter((r) => r.status === 'excluded' && r.provenance === 'generated').length], ['Consistency', consistency]])}
      <div class="section-title">Training sources</div>${trainingSourceRowsHtml(sourceRows, action.label)}</div>`;
    const learned = `<div class="modal-section"><h4>Learned data</h4>${action.learned?.diffUrl ? `<div class="change-map">${img(action.learned.diffUrl)}</div>` : '<div class="change-map ghost-note">Train to create change map</div>'}
      <button type="button" class="btn" data-action="fine-tune">Fine-tune learned data</button></div>`;
    const settings = editMode ? `<div class="modal-section"><h4>Edit</h4><div class="field"><label>Name</label><input class="input" id="actName" value="${esc(action.label || '')}"></div><div class="field"><label>Description</label><textarea class="input act-desc" id="actDesc">${esc(action.description || '')}</textarea></div><div class="field"><label>Input label</label><select class="select" id="actInput">${labels.map((l) => `<option ${l === (action.inputLabel || src.input) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div><div class="field"><label>Target label</label><select class="select" id="actTarget">${labels.map((l) => `<option ${l === (action.targetLabel || action.label) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div><div class="field"><label>Reference labels</label><div class="chip-field" id="refChipField">${refChipHtml(refs)}</div></div></div>` : '';
    const err = trainError ? `<div class="modal-error card sidecard"><h4>Training failed</h4><p class="tiny">${esc(trainError)}</p></div>` : '';
    const footLeft = `<button type="button" class="btn bad" data-action="delete">Delete action</button>`;
    const footRight = editMode ? `<button type="button" class="btn" data-action="cancel-edit">Cancel</button><button type="button" class="btn good" data-action="save" ${training ? 'disabled' : ''}>Save changes</button>`
      : `<button type="button" class="btn" data-action="edit" ${training ? 'disabled' : ''}>Edit</button><button type="button" class="btn" data-action="train" ${training ? 'disabled' : ''}>Train / Refresh</button><button type="button" class="btn primary" data-action="use-generate" ${training ? 'disabled' : ''}>Legacy Generate</button>`;
    return `${summary}${trainingProgressHtml(training, trainPct, trainText)}${err}${overview}${trainingSec}${learned}${settings}${modalFoot(footLeft, footRight)}`;
  };
  const mount = () => {
    if (state._actionModal?.backdrop) state._actionModal.backdrop.remove();
    const html = `<div class="modal card action-modal big">${modalHead('Legacy action')}<div id="actionModalBody">${renderBody()}</div></div>`;
    const m = mountModal(html, { warnDirty: editMode });
    state._actionModal = m;
    const body = $('#actionModalBody', m.root);
    if (editMode) bindRefChipPicker(m.root, refs, labels, (v) => { refs = v; m.markDirty(); });
    bindModalActions(m.root, {
      edit: () => { editMode = true; m.setDirty(false); mount(); },
      'cancel-edit': () => { editMode = false; refs = (freshAction().referenceLabels || []).slice(); m.setDirty(false); mount(); },
      save: async () => {
        const newLabel = $('#actName', m.root)?.value.trim() || action.label;
        await api('/api/actions/' + encodeURIComponent(action.label), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label: newLabel, description: ($('#actDesc', m.root)?.value || '').trim(), inputLabel: $('#actInput', m.root).value, targetLabel: $('#actTarget', m.root).value, referenceLabels: refs }) });
        toast('Action saved'); action.label = newLabel; editMode = false; m.setDirty(false); await refresh(); mount();
      },
      delete: async () => { m.close(); await deleteSingleAction(action.label); },
      train: async () => { await runActionTraining(m, action.label, (s) => { training = s.training; trainPct = s.pct; trainText = s.text; trainError = s.error || ''; body.innerHTML = renderBody(); if (editMode) bindRefChipPicker(m.root, refs, labels, (v) => { refs = v; m.markDirty(); }); }); await refresh(); action = freshAction(); await loadSources(); training = false; mount(); },
      'use-generate': () => { m.close(); navigateToGenerate({ backend: 'legacy', mode: 'single', actionLabel: action.label }); },
      'fine-tune': () => { m.close(); openLearnedPatternEditor(action.learned?.id || action.label, action); },
      'include-source': async (e, btn) => { await api(`/api/actions/${encodeURIComponent(action.label)}/training-source/${btn.dataset.cid}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ included: true }) }); await refresh(); action = freshAction(); await loadSources(); mount(); },
      'exclude-source': async (e, btn) => { await api(`/api/actions/${encodeURIComponent(action.label)}/training-source/${btn.dataset.cid}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ included: false }) }); await refresh(); action = freshAction(); await loadSources(); mount(); },
      'source-details': (e, btn) => { const r = sourceRows.find((x) => x.characterId === btn.dataset.cid); alert(r?.missingReason || 'No details.'); },
    });
  };
  mount();
}
async function runActionTraining(m, label, onTick) {
  const steps = ['Finding sources…', 'Building learned masks…', 'Saving learned data…'];
  onTick({ training: true, pct: 5, text: steps[0], error: '' });
  let i = 0; const timer = setInterval(() => { i = Math.min(i + 1, steps.length - 1); onTick({ training: true, pct: 20 + i * 25, text: steps[i], error: '' }); }, 400);
  try {
    await api('/api/train/' + encodeURIComponent(label), { method: 'POST' });
    clearInterval(timer); onTick({ training: true, pct: 100, text: 'Training complete', error: '' });
    toast('Action trained');
  } catch (e) {
    clearInterval(timer); onTick({ training: false, pct: 0, text: '', error: e.message || String(e) });
    toast('Training failed');
  }
}
function openBehaviorDetail(b) {
  if (!b) return;
  const charbinBeh = charbinOutputBehaviorForLegacy(b);
  if (charbinBeh && !state._forceLegacyBehaviorModal) {
    api('/api/packages/generate/overview').then((overview) => {
      const row = (overview.behaviors || []).find((x) => x.outputBehavior === charbinBeh);
      if (row) openSheetBehaviorDetail(row);
      else openBehaviorDetailLegacy(b);
    }).catch(() => openBehaviorDetailLegacy(b));
    return;
  }
  openBehaviorDetailLegacy(b);
}
function openBehaviorDetailLegacy(b) {
  let editMode = false; let training = false; let trainError = ''; let trainPct = 0; let trainText = '';
  let sourceRows = []; let srcData = null;
  const loadSources = async () => {
    srcData = await api('/api/behaviors/' + encodeURIComponent(b.label) + '/sources');
    sourceRows = srcData.rows || [];
    b = srcData.behavior || b;
    return srcData;
  };
  loadSources().then(() => {
    const freshBeh = () => (behaviorActions().find((x) => x.label === b.label) || b);
    const dirs = () => freshBeh().directions || ['down', 'left', 'right', 'up'];
    const fpd = () => freshBeh().framesPerDirection || 4;
    const renderBody = () => {
      b = freshBeh();
      const d = dirs(); const n = fpd();
      const ready = sourceRows.filter((r) => r.status === 'included');
      const frameGrid = d.map((dr) => `<div class="frame-row">${Array.from({ length: n }, (_, i) => { const lf = (b.learnedFrames?.[dr] || [])[i]; return `<button type="button" class="btn small" data-action="frame-pick" data-lid="${lf?.id || ''}">${esc(dr)}_${i}</button>`; }).join('')}</div>`).join('');
      const overview = editMode ? '' : `<div class="modal-section"><h4>Overview</h4><dl class="def-list"><dt>Prefix</dt><dd>${esc(b.prefix || b.label)}</dd><dt>Directions</dt><dd>${d.map((x) => esc(x)).join(', ')}</dd><dt>Frames/dir</dt><dd>${n}</dd><dt>Input mode</dt><dd>base directions</dd></dl></div>`;
      const settings = editMode ? `<div class="modal-section"><h4>Edit</h4><div class="field"><label>Name</label><input class="input" id="behName" value="${esc(b.name || b.label || '')}"></div><div class="field"><label>Description</label><textarea class="input act-desc" id="behDesc">${esc(b.description || '')}</textarea></div><div class="field"><label>Prefix</label><input class="input" id="behPrefix" value="${esc(b.prefix || b.label || '')}"></div><div class="field"><label>Frames per direction</label><input class="input" id="behFpd" type="number" min="1" max="32" value="${n}"></div><p class="tiny">Directions: down, left, right, up</p></div>` : '';
      const err = trainError ? `<div class="modal-error card sidecard"><h4>Training failed</h4><p class="tiny">${esc(trainError)}</p></div>` : '';
      const footLeft = `<button type="button" class="btn bad" data-action="delete">Delete behavior</button>`;
      const charbinBeh = charbinOutputBehaviorForLegacy(b);
      const genBtn = charbinBeh
        ? `<button type="button" class="btn primary" data-action="open-charbin-generate" ${training ? 'disabled' : ''}>Open charbin Generate</button>`
        : `<button type="button" class="btn primary" data-action="use-generate" ${training ? 'disabled' : ''}>Legacy Generate</button>`;
      const footRight = editMode ? `<button type="button" class="btn" data-action="cancel-edit">Cancel</button><button type="button" class="btn good" data-action="save" ${training ? 'disabled' : ''}>Save changes</button>`
        : `<button type="button" class="btn" data-action="edit" ${training ? 'disabled' : ''}>Edit</button><button type="button" class="btn" data-action="train" ${training ? 'disabled' : ''}>Train / Refresh</button>${genBtn}`;
      return `<div class="action-summary"><div class="action-summary-top"><strong>${esc(b.name || b.label)}</strong><span class="tag short">Legacy behavior</span></div><p class="tiny">${d.length} directions × ${n} frames</p><p class="tiny">base directions → ${esc(b.prefix || b.label)} animations</p></div>
        ${trainingProgressHtml(training, trainPct, trainText)}${err}${overview}
        <div class="modal-section"><h4>Training stats</h4>${statCards([['Complete sources', ready.length], ['Incomplete', sourceRows.filter((r) => r.status === 'missing' || r.status === 'incomplete').length], ['Directions', d.length], ['Frames / dir', n]])}
          <div class="section-title">Training sources</div>${behaviorSourceRowsHtml(sourceRows)}</div>
        <div class="modal-section"><h4>Learned data</h4><div class="frame-grid">${frameGrid}</div>
          <button type="button" class="btn" data-action="fine-tune">Fine-tune learned data</button></div>${settings}${modalFoot(footLeft, footRight)}`;
    };
    const mount = () => {
      if (state._behModal?.backdrop) state._behModal.backdrop.remove();
      const html = `<div class="modal card action-modal big">${modalHead('Legacy behavior')}<div id="behModalBody">${renderBody()}</div></div>`;
      const m = mountModal(html, { warnDirty: editMode });
      state._behModal = m;
      bindModalActions(m.root, {
        edit: () => { editMode = true; m.setDirty(false); mount(); },
        'cancel-edit': () => { editMode = false; m.setDirty(false); mount(); },
        save: async () => {
          const nb = freshBeh();
          await api('/api/behaviors/define', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label: nb.label, name: $('#behName', m.root).value.trim() || nb.label, description: ($('#behDesc', m.root).value || '').trim(), prefix: $('#behPrefix', m.root).value.trim() || nb.prefix, framesPerDirection: Number($('#behFpd', m.root).value || 4) }) });
          toast('Behavior saved'); editMode = false; m.setDirty(false); await refresh(); b = freshBeh(); await loadSources(); mount();
        },
        delete: async () => { m.close(); await deleteBehaviorAction(b); },
        train: async () => { await runBehaviorTraining(b.label, (s) => { training = s.training; trainPct = s.pct; trainText = s.text; trainError = s.error || ''; $('#behModalBody', m.root).innerHTML = renderBody(); }); await refresh(); b = freshBeh(); await loadSources(); training = false; mount(); },
        'use-generate': () => { m.close(); navigateToGenerate({ backend: 'legacy', mode: 'behavior', behaviorLabel: b.label }); },
        'open-charbin-generate': () => { m.close(); navigateToGenerate({ backend: 'charbin', outputBehavior: charbinOutputBehaviorForLegacy(b) }); },
        'fine-tune': () => { m.close(); openLearnedPatternEditor(null, b); },
        'frame-pick': (e, btn) => { if (btn.dataset.lid) { m.close(); openLearnedPatternEditor(btn.dataset.lid, b); } else toast('Train this frame first'); },
        'include-source': async (e, btn) => { await api(`/api/behaviors/${encodeURIComponent(b.label)}/training-source/${btn.dataset.cid}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ included: true }) }); await refresh(); b = freshBeh(); await loadSources(); mount(); },
        'exclude-source': async (e, btn) => { await api(`/api/behaviors/${encodeURIComponent(b.label)}/training-source/${btn.dataset.cid}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ included: false }) }); await refresh(); b = freshBeh(); await loadSources(); mount(); },
        'source-details': (e, btn) => { const r = sourceRows.find((x) => x.characterId === btn.dataset.cid); alert(r?.missingReason || 'No details.'); },
      });
    };
    mount();
  });
}
async function runBehaviorTraining(label, onTick) {
  const beh = (behaviorActions().find((x) => x.label === label) || {});
  const dirs = beh.directions || ['down', 'left', 'right', 'up'];
  const fpd = beh.framesPerDirection || 4;
  const total = dirs.length * fpd;
  let step = 0;
  onTick({ training: true, pct: 5, text: `Training ${beh.name || label}…`, error: '' });
  const timer = setInterval(() => {
    step = Math.min(step + 1, total);
    const di = Math.floor((step - 1) / fpd);
    const fi = (step - 1) % fpd;
    const dir = dirs[di] || 'down';
    const pct = Math.round((step / total) * 90);
    onTick({ training: true, pct, text: `Direction: ${dir} · Frame ${fi + 1} / ${fpd}`, error: '' });
  }, 350);
  try {
    await api('/api/behaviors/' + encodeURIComponent(label) + '/train', { method: 'POST' });
    clearInterval(timer);
    onTick({ training: true, pct: 100, text: 'Training complete', error: '' });
    toast('Behavior trained');
  } catch (e) {
    clearInterval(timer);
    onTick({ training: false, pct: 0, text: '', error: e.message || String(e) });
    toast('Training failed');
  }
}
function openLearnedPatternEditor(learnedId, actionCtx) {
  const html = `<div class="modal card wide">${modalHead('Fine-tune learned data')}
    <div class="field"><label>Layer</label><select class="select" id="learnLayer"><option value="overlay">Overlay additions</option><option value="remove">Removal mask</option><option value="protect">Protected regions</option></select></div>
    <div class="grid cols2 rect-fields"><div class="field"><label>X</label><input class="input" id="eraseX" type="number" value="0"></div><div class="field"><label>Y</label><input class="input" id="eraseY" type="number" value="0"></div><div class="field"><label>Width</label><input class="input" id="eraseW" type="number" value="8"></div><div class="field"><label>Height</label><input class="input" id="eraseH" type="number" value="8"></div></div>
    ${actionCtx?.learned?.diffUrl ? `<div class="change-map">${img(actionCtx.learned.diffUrl)}</div>` : ''}
    ${modalFoot('', `<button type="button" class="btn bad" data-action="apply-edit">Apply region edit</button><button type="button" class="btn primary" data-action="done">Done</button>`)}</div>`;
  const m = mountModal(html, { backdropClose: true });
  bindModalActions(m.root, {
    done: () => m.close(),
    'apply-edit': async () => {
      if (!learnedId) { toast('Select a trained frame first'); return; }
      await api('/api/learned/' + learnedId + '/edit-rect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ layer: $('#learnLayer', m.root).value, x: Number($('#eraseX', m.root).value), y: Number($('#eraseY', m.root).value), w: Number($('#eraseW', m.root).value), h: Number($('#eraseH', m.root).value) }) });
      toast('Learned data updated'); m.close(); await refresh();
    },
  });
}
