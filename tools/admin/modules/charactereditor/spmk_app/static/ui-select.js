/* Select mode + bulk delete + card delete affordances — v14 */
function initSelectState(){
  state.selectMode=state.selectMode||{};
  state.selections=state.selections||{};
}
function isSelectMode(scope){ initSelectState(); return !!state.selectMode[scope]; }
function toggleSelectMode(scope){ initSelectState(); state.selectMode[scope]=!state.selectMode[scope]; if(!state.selectMode[scope]) clearSelection(scope); }
function clearSelection(scope){ initSelectState(); state.selections[scope]=new Set(); }
function selectedCount(scope){ initSelectState(); return (state.selections[scope]||new Set()).size; }
function selectionIds(scope){ return [...(state.selections[scope]||new Set())]; }
function isSelected(scope, id){ initSelectState(); return (state.selections[scope]||new Set()).has(id); }
function toggleSelected(scope, id){
  initSelectState();
  if(!state.selections[scope]) state.selections[scope]=new Set();
  const s=state.selections[scope];
  if(s.has(id)) s.delete(id); else s.add(id);
  return s.size;
}
function cardDeleteBtn(ariaLabel, dataAttr, dataValue){
  return `<button type="button" class="card-delete" ${dataAttr}="${esc(dataValue)}" aria-label="${esc(ariaLabel)}" title="Delete">×</button>`;
}
function selectCheckbox(scope, id){
  const on=isSelected(scope, id);
  return `<label class="card-select"><input type="checkbox" data-select-scope="${esc(scope)}" data-select-id="${esc(id)}" ${on?'checked':''} aria-label="Select"></label>`;
}
function sectionHead(title, scope, extra=''){
  const sel=isSelectMode(scope);
  return `<div class="section-head"><span class="section-title inline">${esc(title)}</span>${extra}<button type="button" class="btn small ${sel?'primary':''}" data-toggle-select="${esc(scope)}">${sel?'Done':'Select'}</button></div>`;
}
function bulkBar(scope){
  if(!isSelectMode(scope) && !selectedCount(scope)) return '';
  const n=selectedCount(scope);
  const hint=n?'':`<span class="tiny bulk-hint">Click cards to select</span>`;
  return `<div class="bulk-bar card sidecard" data-scope="${esc(scope)}"><span class="bulk-count">${n} selected</span>${hint}<div class="row"><button type="button" class="btn bad" data-bulk-delete="${esc(scope)}" ${n?'':'disabled'}>Delete selected</button><button type="button" class="btn" data-bulk-cancel="${esc(scope)}">Cancel</button></div></div>`;
}
function bindSelectMode(scope, rerender, onBulkDelete){
  initSelectState();
  $$(`[data-toggle-select="${scope}"]`).forEach(btn=>{
    btn.onclick=(e)=>{ e.stopPropagation(); toggleSelectMode(scope); rerender(); };
  });
  $$(`input[data-select-scope="${scope}"]`).forEach(cb=>{
    cb.onchange=(e)=>{ e.stopPropagation(); toggleSelected(scope, cb.dataset.selectId); rerender(); };
    cb.onclick=(e)=> e.stopPropagation();
  });
  $$(`[data-bulk-cancel="${scope}"]`).forEach(btn=>{
    btn.onclick=async(e)=>{ e.stopPropagation(); clearSelection(scope); toggleSelectMode(scope); rerender(); };
  });
  $$(`[data-bulk-delete="${scope}"]`).forEach(btn=>{
    btn.onclick=async(e)=>{
      e.stopPropagation();
      const ids=selectionIds(scope);
      if(!ids.length) return;
      if(onBulkDelete) await onBulkDelete(ids);
      rerender();
    };
  });
  $$(`label.card-select`).forEach(lbl=>{
    lbl.onclick=(e)=> e.stopPropagation();
  });
}
function animationsUsingSprite(cid, spriteId){
  return (state.project.animations||[]).filter(a=>a.characterId===cid && (a.frames||[]).some(f=>f.spriteId===spriteId));
}
async function deleteCharacterSprite(cid, sprite){
  if(!sprite) return;
  const used=animationsUsingSprite(cid, sprite.id);
  let msg=`Delete sprite "${sprite.label||sprite.name}"?`;
  if(used.length) msg+=`\n\nThis sprite is used by:\n${used.map(a=>'- '+a.name).join('\n')}`;
  if(!confirm(msg)) return;
  await api(`/api/character/${cid}/sprite/${sprite.id}`,{method:'DELETE'});
  toast('Sprite deleted'); await refresh();
}
async function deleteCharacterAnimation(anim){
  if(!anim) return;
  if(!confirm(`Delete animation "${anim.name}"?\n\nThis removes the animation record only.\nThe sprites remain.`)) return;
  await api(`/api/animation/${anim.id}`,{method:'DELETE'});
  toast('Animation deleted'); await refresh();
}
async function bulkDeleteSprites(cid, ids){
  const c=characterById(cid); if(!c||!ids.length) return;
  const sprites=(c.sprites||[]).filter(s=>ids.includes(s.id));
  const used=sprites.filter(s=>animationsUsingSprite(cid, s.id).length);
  let msg=`Delete ${sprites.length} sprite${sprites.length===1?'':'s'}?\n\nThis removes the selected sprites from this character.`;
  if(used.length) msg+=`\n\n${used.length} selected sprite${used.length===1?' is':'s are'} used by animations.\nDeleting them may leave missing frames.`;
  if(!confirm(msg+`\n\nDelete anyway?`)) return;
  for(const s of sprites) await api(`/api/character/${cid}/sprite/${s.id}`,{method:'DELETE'});
  toast(`Deleted ${sprites.length} sprites`); clearSelection('charSprites'); await refresh();
}
async function bulkDeleteAnimations(ids){
  if(!ids.length) return;
  if(!confirm(`Delete ${ids.length} animation${ids.length===1?'':'s'}?\n\nThis removes animation records only.\nThe sprites used by those animations remain.`)) return;
  for(const id of ids) await api(`/api/animation/${id}`,{method:'DELETE'});
  toast(`Deleted ${ids.length} animations`); clearSelection('charAnims'); await refresh();
}
async function bulkDeleteActions(labels){
  if(!labels.length) return;
  if(!confirm(`Delete ${labels.length} action${labels.length===1?'':'s'}?\n\nThis removes learned actions and learned data.\nCharacter sprites are not deleted.`)) return;
  for(const lb of labels) await api('/api/actions/'+encodeURIComponent(lb),{method:'DELETE'});
  toast(`Deleted ${labels.length} actions`); clearSelection('actions'); await refresh();
}
async function bulkDeleteSheets(familyIds){
  if(!familyIds.length) return;
  if(!confirm(`Delete ${familyIds.length} sheet${familyIds.length===1?'':'s'} and all their versions?\n\nExtracted character sprites will remain.`)) return;
  for(const fid of familyIds) await api('/api/sheet-family/'+fid,{method:'DELETE'});
  toast(`Deleted ${familyIds.length} sheets`); clearSelection('sheets'); await refresh();
}
async function bulkDeleteCharacters(ids){
  if(!ids.length) return;
  if(!confirm(`Delete ${ids.length} character${ids.length===1?'':'s'}?\n\nCharacter records and their sprite links will be removed.`)) return;
  for(const id of ids) await api('/api/character/'+id,{method:'DELETE'});
  if(ids.includes(state.selectedCharacter)) state.selectedCharacter=null;
  toast(`Deleted ${ids.length} characters`); clearSelection('library'); await refresh();
}
async function bulkDeleteGenBehaviors(cid, labels){
  if(!labels.length) return;
  if(!confirm(`Remove ${labels.length} generated behavior${labels.length===1?'':'s'}?\n\nThis deletes their generated sprites and animations.`)) return;
  for(const lb of labels) await api(`/api/character/${cid}/behaviors/${encodeURIComponent(lb)}`,{method:'DELETE'});
  toast(`Removed ${labels.length} behaviors`); clearSelection('charGenBeh'); await refresh();
}
function bindCardOpen(card, openFn, scope, selectId, rerender){
  card.addEventListener('click', e=>{
    if(e.target.closest('.card-delete')||e.target.closest('.card-select')||e.target.closest('[data-stop-prop]')) return;
    if(isSelectMode(scope)){ toggleSelected(scope, selectId); rerender(); return; }
    openFn();
  });
}
