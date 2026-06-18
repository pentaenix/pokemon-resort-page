/* Generate with persistent preview + preview modal — v13 */
function genSettingsKey(mode, parts){ return mode+'|'+parts.join('|'); }
function markGeneratePreviewStale(){
  if(state.generatePreview && !state.generatePreview.stale){
    state.generatePreview={...state.generatePreview, stale:true};
  }
}
function clearGeneratePreview(){ state.generatePreview=null; }
function navigateToGenerate(opts={}){
  const mode=opts.mode||'single';
  if(opts.characterId) state.selectedCharacter=opts.characterId;
  if(!state.selectedCharacter && state.project.characters?.[0]) state.selectedCharacter=state.project.characters[0].id;
  state.generateMode=mode;
  if(opts.actionLabel) state.selectedAction=opts.actionLabel;
  if(opts.behaviorLabel) state.selectedBehavior=opts.behaviorLabel;
  state.view='generate';
  renderNav();
  renderGenerate();
}
function staleBanner(){
  if(!state.generatePreview?.stale) return '';
  return `<div class="stale-banner card sidecard"><p>Preview is from previous settings.</p><button class="btn small" id="discardStalePreview">Discard preview</button></div>`;
}
function previewBgSelect(id, val='darkchecker'){
  const opts=[['darkchecker','Dark checker'],['lightchecker','Light checker'],['checker','Checker'],['light','Light'],['dark','Dark'],['clear','Clear']];
  return `<select class="select" id="${id}">${opts.map(([v,n])=>`<option value="${v}" ${v===val?'selected':''}>${esc(n)}</option>`).join('')}</select>`;
}
function openSinglePreviewModal(c, a, preview){
  const bg='darkchecker';
  const html=`<div class="modal card big preview-modal">${modalHead('Generated preview')}
    <p class="tiny">Target: ${esc(c?.name||'character')} · Action: ${esc(a?.label||'')}</p>
    <div class="field"><label>Background</label>${previewBgSelect('prevBg', bg)}</div>
    <canvas id="bigPrevCanvas" width="320" height="320" class="editor-bg-darkchecker preview-canvas-lg"></canvas>
    ${modalFoot('', `<button class="btn" id="prevDiscard">Discard</button><button class="btn good" id="prevSaveEdit">Save + Edit</button><button class="btn primary" id="prevSave">Save</button>`)}</div>`;
  const m=mountModal(html,{backdropClose:true});
  const draw=()=>drawPreviewCanvas($('#bigPrevCanvas', m.root), preview.url, 'editor-bg-'+($('#prevBg', m.root).value||bg));
  draw(); $('#prevBg', m.root).onchange=draw;
  $('#prevDiscard', m.root).onclick=()=>{ clearGeneratePreview(); m.close(); renderGenerate(); };
  $('#prevSave', m.root).onclick=async()=>{ await saveGeneratedSingle(c, a, preview.id, false); m.close(); };
  $('#prevSaveEdit', m.root).onclick=async()=>{ await saveGeneratedSingle(c, a, preview.id, true); m.close(); };
}
async function saveGeneratedSingle(c, a, generatedId, openEditor){
  if(!generatedId) return;
  const sp=await api(`/api/generated/${generatedId}/save-to-character`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({characterId:c.id,label:a.targetLabel||a.label,replaceExisting:true})});
  toast('Saved'); clearGeneratePreview(); await refresh();
  if(openEditor){ state.selectedCharacter=c.id; state.selectedSprite=sp.id; state.view='editor'; renderNav(); renderEditor(); }
  else renderGenerate();
}
function openBehaviorPreviewModal(c, b, previewData){
  const dirs=Object.keys(previewData?.previews||{});
  let selDir=dirs[0]||'down';
  const html=`<div class="modal card big preview-modal">${modalHead('Generated behavior preview')}
    <p class="tiny">${esc(b?.name||b?.label)} for ${esc(c?.name)}</p>
    <div class="field"><label>Animation</label><select class="select" id="behPrevDir">${dirs.map(d=>`<option value="${d}">${esc(b.prefix||b.label)}_${esc(d)}</option>`).join('')}</select></div>
    <div class="field"><label>Background</label>${previewBgSelect('behPrevBg')}</div>
    <canvas id="behBigCanvas" width="320" height="320" class="editor-bg-darkchecker preview-canvas-lg"></canvas>
    <div id="behFrameGrid" class="frame-grid"></div>
    ${modalFoot(`<button class="btn" id="behExportSheet">Export sheet</button>`, `<button class="btn" id="behPrevDiscard">Discard</button><button class="btn good" id="behPrevSaveEdit">Save + Edit behavior</button><button class="btn primary" id="behPrevSave">Save behavior</button>`)}</div>`;
  const m=mountModal(html,{backdropClose:true});
  const renderAnim=()=>{
    selDir=$('#behPrevDir', m.root).value;
    const frames=previewData.previews[selDir]||[];
    const idx=0, url=frames[idx]?.url||v12FrameUrl(frames[idx]);
    drawPreviewCanvas($('#behBigCanvas', m.root), url, 'editor-bg-'+($('#behPrevBg', m.root).value||'darkchecker'));
    $('#behFrameGrid', m.root).innerHTML=frames.map((f,i)=>`<button type="button" class="btn small" data-i="${i}">${selDir}_${i}</button>`).join('');
    $$('#behFrameGrid button', m.root).forEach(btn=>btn.onclick=()=>drawPreviewCanvas($('#behBigCanvas', m.root), v12FrameUrl(frames[btn.dataset.i]), 'editor-bg-'+($('#behPrevBg', m.root).value||'darkchecker')));
  };
  $('#behPrevDir', m.root).onchange=renderAnim; $('#behPrevBg', m.root).onchange=renderAnim; renderAnim();
  $('#behPrevDiscard', m.root).onclick=()=>{ clearGeneratePreview(); m.close(); renderGenerate(); };
  $('#behExportSheet', m.root).onclick=()=>{ if(c&&b) location.href=`/api/export/behavior-sheet/${c.id}/${encodeURIComponent(b.label)}?scale=1`; };
  $('#behPrevSave', m.root).onclick=async()=>{ await saveGeneratedBehavior(c, b, false); m.close(); };
  $('#behPrevSaveEdit', m.root).onclick=async()=>{ await saveGeneratedBehavior(c, b, true); m.close(); };
}
async function saveGeneratedBehavior(c, b, openEditor){
  if((c.generatedBehaviors||[]).some(r=>r.behavior===b.label)&&!confirm('This behavior already exists for this character. Retry and overwrite it?')) return;
  const out=await api('/api/behaviors/'+encodeURIComponent(b.label)+'/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({characterId:c.id,replaceExisting:true})});
  toast('Behavior saved'); clearGeneratePreview(); await refresh();
  if(openEditor){ state.view='editor'; state.selectedCharacter=c.id; state.selectedAnimation=out.animations?.[0]?.id; renderNav(); renderEditor(); }
  else renderGenerate();
}
function renderGeneratePreviewPanel(preview, onClick){
  if(!preview) return '<div class="empty">Generate to see preview.</div>';
  const stale=preview.stale?'<p class="tiny stale-text">Stale — settings changed</p>':'';
  if(preview.mode==='single'){
    return `<div class="gen-preview-box clickable" id="genPreviewBox">${stale}<div class="thumb wide">${img(preview.url)}</div><p class="tiny">${esc(preview.label||'output')}</p><p class="tiny">Click to enlarge</p></div>`;
  }
  const dirs=Object.keys(preview.previews||{});
  return `<div class="gen-preview-box clickable" id="genPreviewBox">${stale}${dirs.map(d=>`<div class="card sidecard stack"><h3>${esc(d)}</h3>${v12AnimationStrip(preview.previews[d])}</div>`).join('')||'<div class="empty">No frames</div>'}<p class="tiny">Click to enlarge</p></div>`;
}
function bindClick(sel, fn, root=document){ const el=$(sel, root); if(el) el.addEventListener('click', fn); }
function bindGeneratePreviewActions(c, a, b){
  const p=state.generatePreview;
  if(!p || p.stale) return;
  bindClick('#genPreviewBox', ()=>{
    if(p.mode==='single') openSinglePreviewModal(c, a, p);
    else openBehaviorPreviewModal(c, b, p);
  });
  bindClick('#discardPreview', ()=>{ clearGeneratePreview(); renderGenerate(); });
  bindClick('#saveGenChar', ()=>saveGeneratedSingle(c, a, p.id, false));
  bindClick('#saveEditGen', ()=>saveGeneratedSingle(c, a, p.id, true));
  bindClick('#genBehavior', ()=>saveGeneratedBehavior(c, b, false));
  bindClick('#genEditBehavior', ()=>saveGeneratedBehavior(c, b, true));
  bindClick('#discardBehPreview', ()=>{ clearGeneratePreview(); renderGenerate(); });
}
function renderGenerate(){
  title('Generate'); const mode=state.generateMode||'single';
  toolbar(`<button class="btn ${mode==='single'?'primary':''}" id="singleMode">Single action</button><button class="btn ${mode==='behavior'?'primary':''}" id="behaviorMode">Behavior</button>`);
  if(mode==='behavior') return renderGenerateBehavior();
  const chars=state.project.characters||[]; state.selectedCharacter=state.selectedCharacter||chars[0]?.id;
  const c=selectedCharacter(); const learned=singleActions().filter(a=>a.learned);
  const a=learned.find(x=>x.label===state.selectedAction)||learned[0]; if(a) state.selectedAction=a.label;
  const sprites=spritesForCharacter(c?.id); const compatible=sprites.filter(s=>s.label===(a?.inputLabel||inferBaseLabel(a?.label||'')));
  const target=compatible.find(s=>s.id===state.selectedSprite)||compatible[0]||sprites[0];
  const key=genSettingsKey('single',[c?.id,a?.label,target?.id]);
  if(state.generatePreview && state.generatePreview.settingsKey!==key) markGeneratePreviewStale();
  const src=a?findTrainingSources(a):{ready:[]};
  const hasPreview=state.generatePreview && state.generatePreview.mode==='single' && !state.generatePreview.stale;
  $('#view').innerHTML=`${staleBanner()}<div class="grid cols2"><div class="card sidecard stack"><h3>Single action recipe</h3>
    <div class="field"><label>Target character</label><select class="select" id="genChar">${chars.map(ch=>`<option value="${ch.id}" ${ch.id===c?.id?'selected':''}>${esc(ch.name)}</option>`).join('')}</select></div>
    <div class="field"><label>Learned action</label><select class="select" id="actionLabel">${learned.map(x=>`<option value="${x.label}" ${x.label===a?.label?'selected':''}>${esc(x.label)}</option>`).join('')}</select></div>
    <div class="field"><label>Compatible input sprite</label><select class="select" id="targetSprite">${(compatible.length?compatible:sprites).map(s=>`<option value="${s.id}" ${s.id===target?.id?'selected':''}>${esc(s.label||s.name)}</option>`).join('')}</select></div>
    <div class="progress spaced"><div class="bar" id="genBar"></div></div><pre class="terminal compact" id="genLog">Ready to generate.</pre>
    <div class="row"><button class="btn primary" id="genBtn">Generate</button></div></div>
    <div class="card sidecard stack"><h3>Preview</h3><div class="row"><div><div class="thumb">${img(target?.url)}</div><p class="tiny">${esc(target?.label||'input')}</p></div><span>→</span><div id="outPreview">${hasPreview?renderGeneratePreviewPanel(state.generatePreview):'<div class="thumb empty-thumb"></div>'}</div></div>
    ${hasPreview?`<div class="row gen-action-row"><button class="btn primary" id="saveGenChar">Save</button><button class="btn good" id="saveEditGen">Save + Edit</button><button class="btn" id="discardPreview">Discard</button></div>`:''}</div></div>`;
  right(`<div class="sidecard card"><h3>Generate</h3><p>Preview persists until you discard it or change settings.</p></div>`);
  $('#singleMode').onclick=()=>{ state.generateMode='single'; renderGenerate(); };
  $('#behaviorMode').onclick=()=>{ state.generateMode='behavior'; renderGenerate(); };
  $('#genChar').onchange=e=>{ state.selectedCharacter=e.target.value; state.selectedSprite=null; markGeneratePreviewStale(); renderGenerate(); };
  $('#actionLabel').onchange=e=>{ state.selectedAction=e.target.value; state.selectedSprite=null; markGeneratePreviewStale(); renderGenerate(); };
  $('#targetSprite').onchange=e=>{ state.selectedSprite=e.target.value; markGeneratePreviewStale(); renderGenerate(); };
  const staleBtn=$('#discardStalePreview'); if(staleBtn) staleBtn.onclick=()=>{ clearGeneratePreview(); renderGenerate(); };
  $('#genBtn').onclick=async()=>{
    if(!target||!a){ toast('Choose a trained action and compatible sprite'); return; }
    $('#genBar').style.width='35%';
    const g=await api('/api/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({targetId:target.id,label:a.label,name:`${c?.name||'character'}_${a.targetLabel||a.label}`})});
    $('#genBar').style.width='100%';
    state.generatePreview={mode:'single', id:g.id, url:g.url, label:a.targetLabel||a.label, settingsKey:key, stale:false};
    renderGenerate();
  };
  bindGeneratePreviewActions(c, a, null);
}
async function renderGenerateBehavior(){
  const chars=state.project.characters||[]; state.selectedCharacter=state.selectedCharacter||chars[0]?.id;
  const c=selectedCharacter(); const behaviors=behaviorActions().filter(b=>b.learnedFrames&&Object.keys(b.learnedFrames).length);
  const b=behaviors.find(x=>x.label===state.selectedBehavior)||behaviors[0]; if(b) state.selectedBehavior=b.label;
  const dirs=b?.directions||['down','left','right','up'];
  const src=b?await api('/api/behaviors/'+encodeURIComponent(b.label)+'/sources').catch(()=>({ready:[],excludedGenerated:[]})):{ready:[]};
  const key=genSettingsKey('behavior',[c?.id,b?.label]);
  if(state.generatePreview && state.generatePreview.settingsKey!==key) markGeneratePreviewStale();
  const hasPreview=state.generatePreview && state.generatePreview.mode==='behavior' && !state.generatePreview.stale;
  const baseStatus=dirs.map(d=>({d,sp:v11Sprite(c,`base_${d}`)}));
  $('#view').innerHTML=`${staleBanner()}<div class="grid cols2"><div class="card sidecard stack"><h3>Behavior recipe</h3>
    <div class="field"><label>Target character</label><select class="select" id="behChar">${chars.map(ch=>`<option value="${ch.id}" ${ch.id===c?.id?'selected':''}>${esc(ch.name)}</option>`).join('')}</select></div>
    <div class="field"><label>Trained behavior</label><select class="select" id="behSelect">${behaviors.map(x=>`<option value="${x.label}" ${x.label===b?.label?'selected':''}>${esc(x.name||x.label)}</option>`).join('')}</select></div>
    <div class="section-title">Target bases</div><div class="sprite-strip">${baseStatus.map(x=>`<div class="mini ${x.sp?'':'missing'}">${x.sp?img(x.sp.url):'!'}</div>`).join('')}</div>
    ${statCards([['Training sources',src.ready?.length||0],['Excluded generated',src.excludedGenerated?.length||0]])}
    <div class="progress spaced"><div class="bar" id="behBar"></div></div><pre class="terminal compact" id="behLog">Preview before saving.</pre>
    <div class="row"><button class="btn primary" id="previewBehavior">Preview</button></div></div>
    <div class="card sidecard stack"><h3>Generated preview</h3><div id="behResult">${hasPreview?renderGeneratePreviewPanel(state.generatePreview):'<div class="empty">Click Preview to render temporary behavior frames.</div>'}</div>
    ${hasPreview?`<div class="row gen-action-row"><button class="btn primary" id="genBehavior">Save behavior</button><button class="btn good" id="genEditBehavior">Save + Edit behavior</button><button class="btn" id="discardBehPreview">Discard</button><button class="btn" id="exportBehavior">Export sheet</button></div>`:''}</div></div>`;
  right(`<div class="sidecard card"><h3>Behavior quality</h3><p>Preview persists until discarded or settings change.</p></div>`);
  $('#singleMode').onclick=()=>{ state.generateMode='single'; renderGenerate(); };
  $('#behaviorMode').onclick=()=>{ state.generateMode='behavior'; renderGenerate(); };
  $('#behChar').onchange=e=>{ state.selectedCharacter=e.target.value; markGeneratePreviewStale(); renderGenerate(); };
  $('#behSelect').onchange=e=>{ state.selectedBehavior=e.target.value; markGeneratePreviewStale(); renderGenerate(); };
  const staleBtn2=$('#discardStalePreview'); if(staleBtn2) staleBtn2.onclick=()=>{ clearGeneratePreview(); renderGenerate(); };
  $('#previewBehavior').onclick=async()=>{
    if(!b){ toast('Train a behavior first'); return; }
    $('#behBar').style.width='35%';
    const out=await api('/api/behaviors/'+encodeURIComponent(b.label)+'/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({characterId:c.id})});
    $('#behBar').style.width='100%';
    state.generatePreview={mode:'behavior', previews:out.previews||{}, settingsKey:key, stale:false, behaviorLabel:b.label};
    renderGenerate();
  };
  const exportBeh=$('#exportBehavior'); if(exportBeh) exportBeh.onclick=()=>{ if(b&&c) location.href=`/api/export/behavior-sheet/${c.id}/${encodeURIComponent(b.label)}?scale=1`; };
  bindGeneratePreviewActions(c, null, b);
}
