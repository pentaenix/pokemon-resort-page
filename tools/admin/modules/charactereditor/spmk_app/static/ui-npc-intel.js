/* NPC intel import + editor — LLM JSON → charbin fields for human NPCs */

const NPC_IDENTITY_TYPES = [
  ['unique_character', 'Unique character'],
  ['trainer_class', 'Trainer class'],
  ['generic_npc', 'Generic NPC'],
  ['unknown', 'Unknown'],
];

const NPC_POKEMON_ASSOCIATIONS = [
  ['partner', 'Partner'],
  ['signature', 'Signature'],
  ['starter', 'Starter'],
  ['companion', 'Companion'],
  ['major_team_member', 'Major team member'],
  ['recurring_team_member', 'Recurring team member'],
];

const NPC_CONTINUITY = [
  ['game', 'Game'],
  ['anime', 'Anime'],
  ['manga', 'Manga'],
];

function emptyNpcIntel() {
  return {
    id: null,
    display_name: null,
    names: [],
    identity_type: 'unknown',
    role: null,
    confidence: 0,
    custom_or_edited: false,
    source_game: null,
    region: null,
    guest_book_description: null,
    availability: [],
    pokemon: [],
    relationships: [],
    canon: [],
    dialogue: [],
    uncertainties: [],
  };
}

function npcIntelFromPackage(p) {
  const m = p?.metadata || {};
  const stored = m?.custom?.npcIntel;
  if (stored && typeof stored === 'object') return structuredClone(stored);
  return emptyNpcIntel();
}

function escAttr(v) {
  return esc(String(v ?? ''));
}

function npcIntelTextRow(label, id, value, opts = {}) {
  const type = opts.type || 'text';
  const rows = opts.rows ? ` rows="${opts.rows}"` : '';
  const ph = opts.placeholder ? ` placeholder="${escAttr(opts.placeholder)}"` : '';
  return `<div class="field"><label>${esc(label)}</label>
    <input class="input" id="${id}" type="${type}" value="${escAttr(value)}"${ph}${rows}></div>`;
}

function npcIntelSelectRow(label, id, options, value) {
  return `<div class="field"><label>${esc(label)}</label><select class="select" id="${id}">
    ${options.map(([val, lab]) =>
    `<option value="${esc(val)}" ${val === value ? 'selected' : ''}>${esc(lab)}</option>`).join('')}
  </select></div>`;
}

function npcListEditorHtml(listId, rowsHtml, addLabel) {
  return `<div class="npc-intel-list" id="${listId}">${rowsHtml}</div>
    <button type="button" class="btn small" data-npc-add="${listId}">+ ${esc(addLabel)}</button>`;
}

function availabilityRow(row, idx) {
  const r = row || {};
  return `<div class="npc-intel-row card sidecard" data-npc-row="availability" data-idx="${idx}">
    <div class="npc-intel-row-head"><span>Availability ${idx + 1}</span>
      <button type="button" class="btn small bad" data-npc-rm>Remove</button></div>
    <div class="pkg-char-grid">
      <div class="field"><label>Game</label><input class="input" data-npc-field="game" value="${escAttr(r.game)}"></div>
      <div class="field"><label>Badge #</label><input class="input" data-npc-field="badge_number" type="number" value="${escAttr(r.badge_number ?? 0)}"></div>
      <div class="field"><label>Location</label><input class="input" data-npc-field="location" value="${escAttr(r.location)}"></div>
      <div class="field"><label>Notes</label><input class="input" data-npc-field="notes" value="${escAttr(r.notes)}"></div>
    </div></div>`;
}

function pokemonRow(row, idx) {
  const r = row || {};
  return `<div class="npc-intel-row card sidecard" data-npc-row="pokemon" data-idx="${idx}">
    <div class="npc-intel-row-head"><span>Pokémon ${idx + 1}</span>
      <button type="button" class="btn small bad" data-npc-rm>Remove</button></div>
    <div class="pkg-char-grid">
      <div class="field"><label>Name</label><input class="input" data-npc-field="name" value="${escAttr(r.name)}"></div>
      <label class="check"><input type="checkbox" data-npc-field="primary" ${r.primary ? 'checked' : ''}> Primary association</label>
      <div class="field"><label>Association</label><select class="select" data-npc-field="association">
        ${NPC_POKEMON_ASSOCIATIONS.map(([val, lab]) =>
    `<option value="${esc(val)}" ${val === (r.association || 'companion') ? 'selected' : ''}>${esc(lab)}</option>`).join('')}
      </select></div>
      <div class="field"><label>Continuity</label><select class="select" data-npc-field="continuity">
        ${NPC_CONTINUITY.map(([val, lab]) =>
    `<option value="${esc(val)}" ${val === (r.continuity || 'game') ? 'selected' : ''}>${esc(lab)}</option>`).join('')}
      </select></div>
      <div class="field"><label>Source</label><input class="input" data-npc-field="source" value="${escAttr(r.source)}"></div>
      <div class="field"><label>Notes</label><input class="input" data-npc-field="notes" value="${escAttr(r.notes)}"></div>
    </div></div>`;
}

function relationshipRow(row, idx) {
  const r = row || {};
  return `<div class="npc-intel-row card sidecard" data-npc-row="relationships" data-idx="${idx}">
    <div class="npc-intel-row-head"><span>Relationship ${idx + 1}</span>
      <button type="button" class="btn small bad" data-npc-rm>Remove</button></div>
    <div class="pkg-char-grid">
      <div class="field"><label>Id</label><input class="input" data-npc-field="id" value="${escAttr(r.id)}"></div>
      <div class="field"><label>Type</label><input class="input" data-npc-field="type" value="${escAttr(r.type)}"></div>
      <div class="field"><label>Continuity</label><select class="select" data-npc-field="continuity">
        ${NPC_CONTINUITY.map(([val, lab]) =>
    `<option value="${esc(val)}" ${val === (r.continuity || 'game') ? 'selected' : ''}>${esc(lab)}</option>`).join('')}
      </select></div>
      <div class="field"><label>Source</label><input class="input" data-npc-field="source" value="${escAttr(r.source)}"></div>
      <div class="field"><label>Notes</label><input class="input" data-npc-field="notes" value="${escAttr(r.notes)}"></div>
    </div></div>`;
}

function canonRow(row, idx) {
  const r = row || {};
  const facts = (r.facts || []).join('\n');
  return `<div class="npc-intel-row card sidecard" data-npc-row="canon" data-idx="${idx}">
    <div class="npc-intel-row-head"><span>Canon ${idx + 1}</span>
      <button type="button" class="btn small bad" data-npc-rm>Remove</button></div>
    <div class="pkg-char-grid">
      <div class="field"><label>Continuity</label><select class="select" data-npc-field="continuity">
        ${NPC_CONTINUITY.map(([val, lab]) =>
    `<option value="${esc(val)}" ${val === (r.continuity || 'game') ? 'selected' : ''}>${esc(lab)}</option>`).join('')}
      </select></div>
      <div class="field"><label>Source</label><input class="input" data-npc-field="source" value="${escAttr(r.source)}"></div>
    </div>
    <div class="field"><label>Facts (one per line)</label>
      <textarea class="input pkg-desc-area" data-npc-field="facts" rows="3">${esc(facts)}</textarea></div>
  </div>`;
}

function dialogueRow(row, idx) {
  const r = row || {};
  return `<div class="npc-intel-row card sidecard" data-npc-row="dialogue" data-idx="${idx}">
    <div class="npc-intel-row-head"><span>Line ${idx + 1}</span>
      <button type="button" class="btn small bad" data-npc-rm>Remove</button></div>
    <div class="pkg-char-grid">
      <div class="field"><label>Context</label><input class="input" data-npc-field="context" value="${escAttr(r.context)}" placeholder="greeting, idle, …"></div>
    </div>
    <div class="field"><label>Line</label>
      <textarea class="input pkg-desc-area" data-npc-field="line" rows="2">${esc(r.line || '')}</textarea></div>
  </div>`;
}

function renderNpcIntelPanel(p) {
  const intel = npcIntelFromPackage(p);
  const generatedProfile = p?.metadata?.custom?.characterProfile;
  const main = (intel.pokemon || []).find((row) => row.primary) || (intel.pokemon || [])[0] || {};
  const additional = (intel.pokemon || []).filter((row) => row !== main).map((row) => row.name).filter(Boolean);
  const relationships = (intel.relationships || []).map((row) => row.id).filter(Boolean);
  const badgeRequirement = (intel.availability || [])[0]?.badge_number ?? 0;
  const reasoning = p?.metadata?.custom?.generationReasoning || null;
  const roles = [...new Set(['ambient', 'mom', 'story', 'grunt', 'team_leader', 'gym_leader', 'gym_assistant', 'elite_four', 'champion', 'rival', 'professor', 'team_admin', 'researcher', 'caretaker', 'unknown', intel.role].filter(Boolean))];
  const additionalProfileFields = generatedProfile && typeof generatedProfile === 'object'
    ? Object.fromEntries(Object.entries(generatedProfile).filter(([key]) => !['character_name', 'description', 'role', 'main_pokemon', 'additional_pokemon', 'source_game', 'source_region', 'badge_requirement', 'relationships', 'dialogue'].includes(key)))
    : {};
  return `<section class="card sidecard pkg-npc-intel pkg-npc-only" id="pkgNpcIntel" data-npc-only>
    <div class="section-title">Character profile</div>
    <div class="pkg-npc-intel-body">
      <div class="btn-row" style="margin-bottom:10px"><button type="button" class="btn" id="npcIntelValidate">Validate profile</button></div>
      <p class="tiny" id="npcIntelStatus"></p>
      <div id="npcIntelCompact">
      <input id="npcIntelId" type="hidden" value="${escAttr(intel.id || slugFromName(intel.display_name))}">
      <div class="pkg-char-grid">
        ${npcIntelTextRow('Character name', 'npcIntelDisplayName', intel.display_name)}
        <div class="field"><label>Role</label><select class="select" id="npcIntelRole">${roles.map((role) => `<option value="${role}"${intel.role === role ? ' selected' : ''}>${role.replaceAll('_', ' ')}</option>`).join('')}</select></div>
        ${npcIntelTextRow('Source game', 'npcIntelSourceGame', intel.source_game)}
        ${npcIntelTextRow('Source region', 'npcIntelRegion', intel.region)}
        ${npcIntelTextRow('Appears after badge', 'npcIntelBadgeRequirement', badgeRequirement, { type: 'number' })}
        ${npcIntelTextRow('Main Pokemon', 'npcIntelMainPokemon', main.name)}
      </div>
      <div class="field"><label>Description</label>
        <textarea class="input pkg-desc-area" id="npcIntelGuestBook" rows="3">${esc(intel.guest_book_description || '')}</textarea></div>
      <div class="field"><label>Additional Pokemon (one per line, up to 2)</label>
        <textarea class="input pkg-desc-area" id="npcIntelAdditionalPokemon" rows="2">${esc(additional.join('\n'))}</textarea></div>
      <div class="field"><label>Relationships (one name per line, up to 3)</label>
        <textarea class="input pkg-desc-area" id="npcIntelRelationshipsSimple" rows="3">${esc(relationships.join('\n'))}</textarea></div>
      <div class="section-title">Dialogue</div>
      <div class="field"><label>Resort lines (one per line, 10 to 15)</label>
        <textarea class="input pkg-desc-area" id="npcIntelDialogueSimple" rows="12">${esc((intel.dialogue || []).map((row) => row.line).filter(Boolean).join('\n'))}</textarea></div>
      </div>
      ${Object.keys(additionalProfileFields).length ? `<details class="pkg-npc-reasoning"><summary>Additional profile fields</summary><textarea class="input pkg-desc-area" rows="8" readonly>${esc(JSON.stringify(additionalProfileFields, null, 2))}</textarea></details>` : ''}
      <details class="pkg-npc-reasoning"><summary>Reasoning</summary><textarea class="input pkg-desc-area" rows="14" readonly>${esc(reasoning ? JSON.stringify(reasoning, null, 2) : 'No generation record is stored for this character.')}</textarea></details>
    </div>
  </section>`;
}

function npcRowField(row, name) {
  const el = row.querySelector(`[data-npc-field="${name}"]`);
  if (!el) return null;
  return el.value?.trim?.() ?? el.value;
}

function collectNpcIntelFromDom() {
  if ($('#npcIntelCompact')) {
    const displayName = $('#npcIntelDisplayName')?.value?.trim() || null;
    const mainPokemon = $('#npcIntelMainPokemon')?.value?.trim() || null;
    const additionalPokemon = parseLines($('#npcIntelAdditionalPokemon')?.value).slice(0, 2);
    const relationships = parseLines($('#npcIntelRelationshipsSimple')?.value).slice(0, 3);
    const dialogue = parseLines($('#npcIntelDialogueSimple')?.value).map((line) => ({ context: 'resort', line }));
    return {
      id: slugFromName(displayName || $('#npcIntelId')?.value || 'character'), display_name: displayName,
      names: [], identity_type: 'unknown', role: $('#npcIntelRole')?.value || 'unknown', confidence: 0,
      custom_or_edited: false, source_game: $('#npcIntelSourceGame')?.value?.trim() || null,
      region: $('#npcIntelRegion')?.value?.trim() || null,
      guest_book_description: $('#npcIntelGuestBook')?.value?.trim() || null,
      availability: [{ game: $('#npcIntelSourceGame')?.value?.trim() || null, badge_number: Number($('#npcIntelBadgeRequirement')?.value) || 0, location: null, notes: null }],
      pokemon: [
        ...(mainPokemon ? [{ name: mainPokemon, primary: true, association: 'partner', continuity: 'game', source: null, notes: null }] : []),
        ...additionalPokemon.map((name) => ({ name, primary: false, association: 'companion', continuity: 'game', source: null, notes: null })),
      ],
      relationships: relationships.map((id) => ({ id, type: null, continuity: 'game', source: null, notes: null })),
      canon: [], dialogue, uncertainties: [],
    };
  }
  const availability = [];
  $$('[data-npc-row="availability"]', $('#pkgNpcIntel')).forEach((row) => {
    availability.push({
      game: npcRowField(row, 'game') || null,
      badge_number: Number(npcRowField(row, 'badge_number')) || 0,
      location: npcRowField(row, 'location') || null,
      notes: npcRowField(row, 'notes') || null,
    });
  });
  const pokemon = [];
  $$('[data-npc-row="pokemon"]', $('#pkgNpcIntel')).forEach((row) => {
    pokemon.push({
      name: npcRowField(row, 'name') || null,
      primary: !!row.querySelector('[data-npc-field="primary"]')?.checked,
      association: npcRowField(row, 'association') || 'companion',
      continuity: npcRowField(row, 'continuity') || 'game',
      source: npcRowField(row, 'source') || null,
      notes: npcRowField(row, 'notes') || null,
    });
  });
  const relationships = [];
  $$('[data-npc-row="relationships"]', $('#pkgNpcIntel')).forEach((row) => {
    relationships.push({
      id: npcRowField(row, 'id') || null,
      type: npcRowField(row, 'type') || null,
      continuity: npcRowField(row, 'continuity') || 'game',
      source: npcRowField(row, 'source') || null,
      notes: npcRowField(row, 'notes') || null,
    });
  });
  const canon = [];
  $$('[data-npc-row="canon"]', $('#pkgNpcIntel')).forEach((row) => {
    canon.push({
      continuity: npcRowField(row, 'continuity') || 'game',
      source: npcRowField(row, 'source') || null,
      facts: parseLines(npcRowField(row, 'facts')),
    });
  });
  const dialogue = [];
  $$('[data-npc-row="dialogue"]', $('#pkgNpcIntel')).forEach((row) => {
    const line = npcRowField(row, 'line');
    if (!line) return;
    dialogue.push({
      context: npcRowField(row, 'context') || null,
      line,
    });
  });
  return {
    id: $('#npcIntelId')?.value?.trim() || null,
    display_name: $('#npcIntelDisplayName')?.value?.trim() || null,
    names: parseList($('#npcIntelNames')?.value),
    identity_type: $('#npcIntelIdentity')?.value || 'unknown',
    role: $('#npcIntelRole')?.value?.trim() || null,
    confidence: Number($('#npcIntelConfidence')?.value) || 0,
    custom_or_edited: !!$('#npcIntelCustomEdited')?.checked,
    source_game: $('#npcIntelSourceGame')?.value?.trim() || null,
    region: $('#npcIntelRegion')?.value?.trim() || null,
    guest_book_description: $('#npcIntelGuestBook')?.value?.trim() || null,
    availability,
    pokemon,
    relationships,
    canon,
    dialogue,
    uncertainties: parseLines($('#npcIntelUncertainties')?.value),
  };
}

function collectNpcIntelDraftPatch() {
  if (!$('#pkgNpcIntel')) return {};
  const intel = collectNpcIntelFromDom();
  const lines = intel.dialogue.map((d) => d.line).filter(Boolean);
  const partnerRow = intel.pokemon.find((p) => p.primary) || intel.pokemon.find((p) =>
    ['partner', 'signature', 'starter', 'companion'].includes(p.association));
  let partnerPokemon = null;
  const extras = [];
  const rankedPokemon = [...intel.pokemon].sort((a, b) => Number(!!b.primary) - Number(!!a.primary));
  for (const row of rankedPokemon) {
    const name = (row.name || '').trim();
    if (!name) continue;
    const slug = slugFromName(name);
    const entry = {
      pokemonId: slug,
      formId: 'default',
      nickname: row.notes || null,
      relationship: row.association,
    };
    if (!partnerPokemon && (row.primary || ['partner', 'signature', 'starter', 'companion'].includes(row.association))) {
      entry.relationship = 'main_partner';
      partnerPokemon = entry;
    } else {
      extras.push(entry);
    }
  }
  if (partnerRow && !partnerPokemon) {
    partnerPokemon = {
      pokemonId: slugFromName(partnerRow.name),
      formId: 'default',
      nickname: partnerRow.notes || null,
      relationship: 'main_partner',
    };
  }
  const patch = {
    displayName: intel.display_name || undefined,
    metadata: {
      description: intel.guest_book_description || '',
      originGame: intel.source_game || '',
      region: intel.region,
      role: intel.role,
      identityType: intel.identity_type,
      intelConfidence: intel.confidence,
      intelCustomOrEdited: intel.custom_or_edited,
      partnerPokemon,
      extraPartnerPokemon: extras,
      custom: { npcIntel: intel },
    },
    dialogue: { lines },
    relationships: intel.relationships,
  };
  if (intel.id) {
    patch.id = slugFromName(intel.id);
    patch.internalName = patch.id;
  }
  return patch;
}

function refreshNpcIntelList(listId, rowAttr, rows, builder) {
  const list = $(`#${listId}`);
  if (!list) return;
  list.innerHTML = (rows || []).map((row, idx) => builder(row, idx)).join('');
  bindNpcIntelRowHandlers($('#pkgNpcIntel'));
}

function bindNpcIntelRowHandlers(root = document) {
  $$('[data-npc-rm]', root).forEach((btn) => {
    btn.onclick = () => {
      const row = btn.closest('[data-npc-row]');
      const attr = row?.dataset.npcRow;
      const idx = Number(row?.dataset.idx);
      const intel = collectNpcIntelFromDom();
      const keyMap = {
        availability: ['npcIntelAvailability', availabilityRow],
        pokemon: ['npcIntelPokemon', pokemonRow],
        relationships: ['npcIntelRelationships', relationshipRow],
        canon: ['npcIntelCanon', canonRow],
        dialogue: ['npcIntelDialogue', dialogueRow],
      };
      const spec = keyMap[attr];
      if (!spec || !Number.isFinite(idx)) return;
      const [listId, builder] = spec;
      const rows = intel[attr] || [];
      rows.splice(idx, 1);
      refreshNpcIntelList(listId, attr, rows, builder);
    };
  });
  $$('[data-npc-add]', root).forEach((btn) => {
    btn.onclick = () => {
      const listId = btn.dataset.npcAdd;
      const map = {
        npcIntelAvailability: ['availability', availabilityRow],
        npcIntelPokemon: ['pokemon', pokemonRow],
        npcIntelRelationships: ['relationships', relationshipRow],
        npcIntelCanon: ['canon', canonRow],
        npcIntelDialogue: ['dialogue', dialogueRow],
      };
      const spec = map[listId];
      if (!spec) return;
      const [attr, builder] = spec;
      const intel = collectNpcIntelFromDom();
      const rows = intel[attr] || [];
      rows.push({});
      refreshNpcIntelList(listId, attr, rows, builder);
    };
  });
}

function setNpcIntelStatus(msg, kind = '') {
  const el = $('#npcIntelStatus');
  if (!el) return;
  el.textContent = msg || '';
  el.className = `tiny${kind ? ` ${kind}` : ''}`;
}

async function validateNpcIntelDom() {
  const intel = collectNpcIntelFromDom();
  const report = await api('/api/packages/draft/npc-intel/validate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ intel }),
  });
  const warns = (report.warnings || []).join(' · ');
  setNpcIntelStatus(
    report.ok
      ? `Valid${warns ? ` — ${warns}` : ''}`
      : (report.errors || []).join(' · ') || 'Invalid',
    report.ok ? 'good' : 'bad',
  );
  return report;
}

function openNpcIntelImportModal() {
  const m = mountModal(`<div class="modal wide">
    ${modalHead('Import NPC intel JSON')}
    <p class="tiny">Paste JSON from your LLM pipeline. Fields map into this charbin and the intel editor below.</p>
    <textarea class="input pkg-desc-area" id="npcIntelJsonPaste" rows="14" placeholder='{"display_name":"Cynthia",...}'></textarea>
  ${modalFoot(
    '<button type="button" class="btn" id="npcIntelImportCancel">Cancel</button>',
    '<button type="button" class="btn" id="npcIntelImportPreview">Validate</button><button type="button" class="btn primary" id="npcIntelImportApply">Apply to package</button>',
  )}</div>`, { backdropClose: true });
  $('#npcIntelImportCancel', m.root).onclick = m.close;
  $('#npcIntelImportPreview', m.root).onclick = async () => {
    try {
      const raw = JSON.parse($('#npcIntelJsonPaste', m.root).value || '{}');
      const report = await api('/api/packages/draft/npc-intel/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intel: raw }),
      });
      const w = (report.warnings || []).join('\n');
      toast(report.ok ? `Valid${w ? `: ${w}` : ''}` : (report.errors || []).join(', ') || 'Invalid');
    } catch (err) {
      toast(`JSON error: ${err.message || err}`);
    }
  };
  $('#npcIntelImportApply', m.root).onclick = async () => {
    try {
      const raw = JSON.parse($('#npcIntelJsonPaste', m.root).value || '{}');
      const replaceId = confirm('Replace charbin id from intel id/display name?\n\nOK = yes, Cancel = keep current id');
      const res = await api('/api/packages/draft/npc-intel/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intel: raw, replaceId }),
      });
      pkgState.draft = res.package;
      m.close();
      renderCharDetail();
      const w = (res.validation?.warnings || []).join(' · ');
      toast(`Intel applied${w ? ` — ${w}` : ''}`);
    } catch (err) {
      toast(String(err.message || err));
    }
  };
}

function bindNpcIntelPanel() {
  bindNpcIntelRowHandlers($('#pkgNpcIntel'));
  $('#npcIntelImport')?.addEventListener('click', openNpcIntelImportModal);
  $('#npcIntelGenerateName')?.addEventListener('click', openNameIntelModal);
  $('#npcIntelValidate')?.addEventListener('click', () => { void validateNpcIntelDom(); });
}

async function openNpcIntelQuickCreate() {
  const m = mountModal(`<div class="modal wide">
    ${modalHead('New NPC from intel JSON')}
    <p class="tiny">Creates a new NPC charbin draft from LLM JSON.</p>
    <textarea class="input pkg-desc-area" id="npcIntelJsonPaste" rows="14"></textarea>
  ${modalFoot(
    '<button type="button" class="btn" id="npcIntelCreateCancel">Cancel</button>',
    '<button type="button" class="btn primary" id="npcIntelCreateApply">Create NPC</button>',
  )}</div>`, { backdropClose: true });
  $('#npcIntelCreateCancel', m.root).onclick = m.close;
  $('#npcIntelCreateApply', m.root).onclick = async () => {
    try {
      const raw = JSON.parse($('#npcIntelJsonPaste', m.root).value || '{}');
      const id = slugFromName(raw.id || raw.display_name || 'new_npc');
      await api('/api/packages/draft/new', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, displayName: raw.display_name || id, characterType: 'npc' }),
      });
      const res = await api('/api/packages/draft/npc-intel/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intel: raw, replaceId: true }),
      });
      pkgState.draft = res.package;
      pkgState.panel = 'detail';
      m.close();
      renderCharDetail();
      toast('NPC created from intel');
    } catch (err) {
      toast(String(err.message || err));
    }
  };
}

function openLlmSettingsModal() {
  const m = mountModal(`<div class="modal wide">
    ${modalHead('Character model settings')}
    <div class="pkg-char-grid">
      <div class="field"><label>OpenAI-compatible endpoint</label><input class="input" id="llmEndpoint"></div>
      <div class="field"><label>Model</label><input class="input" id="llmModel"></div>
      <div class="field"><label>Profile output budget</label><input class="input" id="llmMaxTokens" type="number" min="2000" max="128000" step="1000"></div>
      <div class="field"><label>API key</label><input class="input" id="llmKey" type="password" autocomplete="off" placeholder="Leave blank to keep the saved key"></div>
    </div>
  ${modalFoot('<button type="button" class="btn" id="llmSettingsCancel">Cancel</button>', '<button type="button" class="btn primary" id="llmSettingsSave">Save settings</button>')}</div>`, { backdropClose: true });
  $('#llmSettingsCancel', m.root).onclick = m.close;
  api('/api/packages/llm/settings').then((settings) => {
    $('#llmEndpoint', m.root).value = settings.endpoint || '';
    $('#llmModel', m.root).value = settings.model || '';
    $('#llmMaxTokens', m.root).value = settings.maxTokens || 8000;
    $('#llmKey', m.root).placeholder = settings.configured ? 'Saved key is configured. Leave blank to keep it.' : 'API key';
  }).catch((err) => toast(String(err.message || err)));
  $('#llmSettingsSave', m.root).onclick = async () => {
    try {
      await api('/api/packages/llm/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: $('#llmEndpoint', m.root).value, model: $('#llmModel', m.root).value, maxTokens: $('#llmMaxTokens', m.root).value, apiKey: $('#llmKey', m.root).value }) });
      m.close(); toast('Character model settings saved');
    } catch (err) { toast(String(err.message || err)); }
  };
}

async function applyGeneratedIntel(intel, replaceId = true, reasoning = null, profile = null) {
  const res = await api('/api/packages/draft/npc-intel/apply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ intel, replaceId, reasoning, profile }) });
  pkgState.draft = res.package;
  return res;
}

function logModelTrace(report) {
  for (const entry of report?.trace || []) termLog(`Character model: ${entry}`, 'ok');
  for (const warning of report?.warnings || []) termLog(`Character model: ${warning}`, 'warn');
}

function openNameIntelModal() {
  const m = mountModal(`<div class="modal wide">
    ${modalHead('Generate character intel')}
    <div class="field"><label>Character name</label><input class="input" id="llmCharacterName" value="${escAttr(pkg()?.displayName || '')}"></div>
  ${modalFoot('<button type="button" class="btn" id="llmNameCancel">Cancel</button><button type="button" class="btn" id="llmNameSettings">Settings</button>', '<button type="button" class="btn primary" id="llmNameGenerate">Generate and apply</button>')}</div>`, { backdropClose: true });
  $('#llmNameCancel', m.root).onclick = m.close;
  $('#llmNameSettings', m.root).onclick = () => openLlmSettingsModal();
  $('#llmNameGenerate', m.root).onclick = async () => {
    try {
      const report = await api('/api/packages/llm/intel/from-name', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: $('#llmCharacterName', m.root).value }) });
      logModelTrace(report); await applyGeneratedIntel(report.intel, true); m.close(); renderCharDetail(); toast('Character intel generated');
    } catch (err) { toast(String(err.message || err)); }
  };
}

function openSpriteCharacterModal() {
  const m = mountModal(`<div class="modal wide">
    ${modalHead('Sprite sheet to character')}
    <div class="field"><label>Sprite sheet</label><input class="input" id="llmSpriteSheet" type="file" accept="image/png,image/webp"></div>
    <div class="field"><label>Known character name (optional)</label><input class="input" id="llmSpriteKnownName"></div>
    <section id="llmSpritePreview" hidden><div class="section-title">Generated profile</div><div id="llmSpriteStats"></div><textarea class="input pkg-desc-area" id="llmSpriteJson" rows="14" aria-label="Generated character profile"></textarea></section>
  ${modalFoot('<button type="button" class="btn" id="llmSpriteCancel">Cancel</button><button type="button" class="btn" id="llmSpriteSettings">Settings</button>', '<button type="button" class="btn" id="llmSpriteAnalyze">Analyze image</button><button type="button" class="btn primary" id="llmSpriteCreate" disabled>Create draft</button>')}</div>`, { backdropClose: true });
  $('#llmSpriteCancel', m.root).onclick = m.tryClose;
  $('#llmSpriteSettings', m.root).onclick = () => openLlmSettingsModal();
  $('#llmSpriteAnalyze', m.root).onclick = async () => {
    const file = $('#llmSpriteSheet', m.root).files?.[0];
    if (!file) { toast('Choose a sprite sheet first'); return; }
    try {
      const fd = new FormData(); fd.append('file', file); fd.append('knownName', $('#llmSpriteKnownName', m.root).value);
      const report = await api('/api/packages/llm/intel/from-sprite', { method: 'POST', body: fd });
      logModelTrace(report);
      $('#llmSpriteStats', m.root).innerHTML = statCards([['Name', report.intel.display_name || 'Unknown'], ['Confidence', report.intel.confidence ?? 0], ['Dialogue lines', report.intel.dialogue?.length || 0], ['Uncertainties', report.intel.uncertainties?.length || 0]]);
      $('#llmSpriteJson', m.root).value = JSON.stringify(report.intel, null, 2);
      $('#llmSpritePreview', m.root).hidden = false;
      $('#llmSpriteCreate', m.root).disabled = false;
      m.markDirty();
      toast('Profile analyzed. Review before creating the draft.');
    } catch (err) { toast(String(err.message || err)); }
  };
  $('#llmSpriteCreate', m.root).onclick = async () => {
    const file = $('#llmSpriteSheet', m.root).files?.[0];
    if (!file) { toast('Choose a sprite sheet first'); return; }
    try {
      const intel = JSON.parse($('#llmSpriteJson', m.root).value || '{}');
      const id = slugFromName(intel.id || intel.display_name || 'new_npc');
      await api('/api/packages/draft/new', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, displayName: intel.display_name || id, characterType: 'npc' }) });
      await applyGeneratedIntel(intel, true);
      const sheet = new FormData(); sheet.append('file', file); sheet.append('mode', 'primary'); sheet.append('walkSheetId', 'walk');
      const sheetResult = await api('/api/packages/draft/add-sheet', { method: 'POST', body: sheet });
      pkgState.draft = sheetResult.package; pkgState.assetIds = sheetResult.assetIds || []; pkgState.selectedSheetId = sheetResult.sheetId || null; pkgState.panel = 'detail';
      m.close(); await loadPackageContext(); renderPackages(); toast('Character draft generated from sprite sheet');
    } catch (err) { toast(String(err.message || err)); }
  };
}
