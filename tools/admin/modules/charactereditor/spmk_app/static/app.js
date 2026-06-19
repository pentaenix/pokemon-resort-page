const $ = (q, el=document)=>el.querySelector(q);
const $$ = (q, el=document)=>[...el.querySelectorAll(q)];
const EMBED = new URLSearchParams(location.search).get('embed') === '1';
if (EMBED) document.body.classList.add('embed');
const api = async (url, opts={}) => {
  const method=(opts.method||'GET').toUpperCase();
  const loud=method!=='GET';
  if(loud) termLog(`${method} ${url}`);
  const r = await fetch(url, opts);
  if(!r.ok){
    const errText=await r.text();
    termLog(`HTTP ${r.status}: ${errText.slice(0,240)}`,'error');
    throw new Error(errText);
  }
  const out=r.headers.get('content-type')?.includes('application/json') ? await r.json() : await r.text();
  if(loud) termLog(`HTTP ${r.status} OK`,'ok');
  return out;
};
let state = {project:null, view:'packages', libraryPanel:'list', sheetPanel:'families', sheetFamilyId:null, selectedCharacter:null, selectedSheet:null, selectedSprite:null, selectedGenerated:null, sheetZoom:1, sheetFit:true};
let lastProjectUpdatedAt=null, projectSyncTimer=null;
const navItems = [['packages','◈','Characters'], ['sheets','▦','Sheets'], ['actions','✦','Actions'], ['generate','⧉','Generate'], ['editor','✎','Editor'], ['export','⇩','Export'], ['library','◇','Sprite workspace']];
function toast(msg){const t=$('#toast');t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2600); termLog(String(msg).replace(/\n/g,' | '));}
function termLog(message, tone=''){
  if(EMBED && window.parent !== window){
    try{window.parent.postMessage({type:'spmk-log',message,tone}, window.location.origin);}catch{/* ignore */}
  }
  const el=$('#spmkTerminal');
  if(!el)return;
  const prefix=tone==='error'?'✗':tone==='ok'?'✓':tone==='warn'?'!':'·';
  el.textContent+=`[${new Date().toLocaleTimeString()}] ${prefix} ${message}\n`;
  el.scrollTop=el.scrollHeight;
}
function setStatus(msg){const fs=$('#footerStatus');if(fs)fs.textContent=msg;}
function setSave(s){const el=$('#saveState');if(el)el.textContent=s;}
function initSpmkTerminal(){
  const btn=$('#toggleSpmkTerminal');
  const collapsed=()=>document.body.classList.contains('spmk-terminal-collapsed');
  const apply=(hide)=>{
    document.body.classList.toggle('spmk-terminal-collapsed',hide);
    if(btn){
      btn.textContent=hide?'▲':'▼';
      btn.setAttribute('aria-expanded',String(!hide));
      btn.title=hide?'Show activity log':'Hide activity log';
    }
    try{localStorage.setItem('spmkTerminalCollapsed',hide?'1':'0');}catch{/* ignore */}
  };
  let startCollapsed=false;
  try{startCollapsed=localStorage.getItem('spmkTerminalCollapsed')==='1';}catch{/* ignore */}
  apply(startCollapsed);
  if(btn)btn.onclick=()=>apply(!collapsed());
}
function esc(s=''){return String(s).replace(/[&<>"']/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
function img(src, attrs){
  if(!src) return '';
  const extra = attrs && typeof attrs === 'object'
    ? Object.entries(attrs).map(([k, v]) => `${k}="${esc(String(v))}"`).join(' ')
    : '';
  return extra ? `<img src="${src}" ${extra}/>` : `<img src="${src}"/>`;
}
function fmtTime(ms){ if(!ms) return 'never'; return new Date(ms).toLocaleString(); }
async function load(){
  state.view='packages';
  state.project=await api('/api/project');
  if(EMBED) termLog('Character editor ready.');
  lastProjectUpdatedAt=state.project.updatedAt||null;
  if ($('#projectName')) $('#projectName').textContent=state.project.projectName;
  renderNav();
  await renderPackagesView();
  if(typeof bindQuickAnimEntrypoints==='function') bindQuickAnimEntrypoints(document);
  startProjectSync();
}
async function refresh(){ const keep={...state}; state.project=await api('/api/project'); lastProjectUpdatedAt=state.project.updatedAt||null; Object.assign(state, keep, {project:state.project}); renderNav(); syncView(); }
async function syncView(){
  if(state.view==='packages'){ await renderPackagesView(); return; }
  if(state.view==='library' && state.libraryPanel==='detail' && state.selectedCharacter) return renderLibraryDetail();
  if(state.view==='sheets' && state.sheetPanel==='mapper') return renderSheetMapper();
  if(state.view==='sheets' && state.sheetPanel==='versions' && state.sheetFamilyId) return openSheetFamily(state.sheetFamilyId);
  render();
}
async function reloadProjectOnly(){ const keep={...state}; state.project=await api('/api/project'); lastProjectUpdatedAt=state.project.updatedAt||null; Object.assign(state, keep, {project:state.project}); $('#projectName').textContent=state.project.projectName; renderNav(); syncView(); }
async function syncProjectFromServer(opts={}){
  const keep={...state}; const p=await api('/api/project'); const changed=lastProjectUpdatedAt!==null && p.updatedAt!==lastProjectUpdatedAt;
  lastProjectUpdatedAt=p.updatedAt||null; state.project=p; Object.assign(state, keep, {project:p}); $('#projectName').textContent=p.projectName; renderNav();
  /* Characters (.charbin) must not re-render on background sync — that steals input focus */
  if(state.view!=='packages') await syncView();
  if(changed && opts.toast) toast('Project updated');
}
function startProjectSync(){
  if(projectSyncTimer) clearInterval(projectSyncTimer);
  projectSyncTimer=setInterval(()=>{ if(document.visibilityState!=='visible') return; syncProjectFromServer().catch(()=>{}); }, 2500);
  // packages view uses charbin library only — project sync must not redraw legacy library
}
function renderNav(){ $('#nav').innerHTML=navItems.map(([id,ico,name])=>`<button class="${state.view===id?'active':''}" data-view="${id}"><span class="ico">${ico}</span><span>${name}</span></button>`).join(''); $$('#nav button').forEach(b=>b.onclick=async()=>{state.view=b.dataset.view;renderNav(); if(state.view==='packages') await renderPackagesView(); else render();}); }
function toolbar(html=''){ $('#toolbarControls').innerHTML=html; }
function title(t){ $('#viewTitle').textContent=t; }
function right(html=''){ $('#rightbar').innerHTML=html; }
function selectedCharacter(){ return state.project.characters.find(c=>c.id===state.selectedCharacter) || state.project.characters[0]; }
function selectedSheet(){ return state.project.sheets.find(s=>s.id===state.selectedSheet) || state.project.sheets[0]; }
function allSprites(){ return state.project.characters.flatMap(c=>(c.sprites||[]).map(s=>({...s, characterName:c.name, characterId:c.id}))).concat(state.project.generated.map(g=>({...g, characterName:'Generated'}))); }
function render(){
  if(state.view==='packages'){ renderPackagesView(); return; }
  if(state.view==='library') renderLibrary();
  if(state.view==='sheets') renderSheets();
  if(state.view==='actions') renderActions();
  if(state.view==='generate') renderGenerate();
  if(state.view==='editor') renderEditor();
  if(state.view==='export') renderExport();
}

function cardCharacter(c, opts={}){const del=cardDeleteBtn(`Delete character ${c.name}`,'data-del-char',c.id); const sel=opts.selectScope?selectCheckbox(opts.selectScope,c.id):''; const cls=`character card selectable-card${opts.selected?' selected':''}`; return `<div class="${cls}" data-id="${c.id}">${del}${sel}<div class="thumb">${img(firstThumb(c))}</div><div><h3>${esc(c.name)}</h3><div class="tiny">${(c.sprites||[]).length} sprites · ${(c.sheetIds||[]).length} sheets</div><div class="tags"><span class="tag">local</span>${(c.tags||[]).slice(0,2).map(t=>`<span class="tag">${esc(t)}</span>`).join('')}</div><div class="sprite-strip">${['base_down','base_left','base_right','base_up'].map(l=>{let s=(c.sprites||[]).find(x=>x.label===l);return `<div class="mini">${s?img(s.url):`<span>${l.split('_')[1]?.[0]||'·'}</span>`}</div>`}).join('')}</div></div></div>`}
function firstThumb(c){ return (c?.sprites||[])[0]?.url || (state.project.sheets.find(s=>(c?.sheetIds||[]).includes(s.id))?.url) || ''; }
function spriteTile(s, opts={}){const del=opts.deletable!==false?cardDeleteBtn(`Delete sprite ${s.label||s.name}`,'data-delete-sprite',s.id):''; const sel=opts.selectScope?selectCheckbox(opts.selectScope,s.id):''; const cls=`card sidecard sprite-tile selectable-card${opts.selected?' selected':''}`; return `<div class="${cls}" data-id="${s.id}">${del}${sel}<div class="thumb" style="margin-bottom:8px">${img(s.url)}</div><h3 class="truncate">${esc(s.label||s.name)}</h3><p>${s.width||'?'}×${s.height||'?'} · ${esc(s.direction||'any')}</p></div>`}
function sheetTile(s){let c=state.project.characters.find(x=>x.id===s.characterId);return `<div class="card sidecard sheet-tile" data-id="${s.id}"><div class="thumb wide" style="margin-bottom:8px">${img(s.url)}</div><h3 class="truncate">${esc(s.name||'Sprite sheet')}</h3><p>${s.width}×${s.height} · ${c?esc(c.name):'unassigned'}</p></div>`}
function animationCard(a, opts={}){const del=opts.deletable!==false?cardDeleteBtn(`Delete animation ${a.name}`,'data-delete-anim',a.id):''; const sel=opts.selectScope?selectCheckbox(opts.selectScope,a.id):''; const cls=`card sidecard animation-card selectable-card${opts.selected?' selected':''}`; return `<div class="${cls}" data-aid="${a.id}">${del}${sel}<canvas class="anim-card-canvas checker" width="96" height="96"></canvas><h3 class="truncate">${esc(a.name)}</h3><p>${(a.frames||[]).length} frames · loop</p><button class="btn small" data-playanim="${a.id}" data-stop-prop="1">▶ Play</button></div>`}
async function uploadSpriteFlow(file, charId){ if(!file)return; let cId=charId || state.selectedCharacter || state.project.characters[0]?.id; if(!cId){toast('Create a character first'); return;} let label=prompt('Sprite label (base_right, fishing_right, cast_right_01)', 'base_right'); if(!label)return; let direction=(label.split('_').pop()||''); let fd=new FormData(); fd.append('file',file); fd.append('characterId',cId); fd.append('label',label); fd.append('direction',direction); setSave('uploading'); await api('/api/upload/sprite',{method:'POST',body:fd}); setSave('ready'); toast('Sprite imported'); await refresh(); }
async function uploadSheetFlow(file, charId){ if(!file)return; let cId=charId || state.selectedCharacter || state.project.characters[0]?.id || ''; let fd=new FormData(); fd.append('file',file); fd.append('characterId',cId); fd.append('templateId','tpl_generic_32'); setSave('uploading'); let sheet=await api('/api/upload/sheet',{method:'POST',body:fd}); state.selectedSheet=sheet.id; state.view='sheets'; setSave('ready'); toast('Sheet imported'); await refresh(); }

function readMapInputs(){ let o={}; ['frameWidth','frameHeight','marginX','marginY','spacingX','spacingY'].forEach(k=>{o[k]=Number($(`[data-k="${k}"]`)?.value || 0)}); return o; }
let selectedCell={row:0,col:0}, timeline=[], animTimer=null, animIndex=0;
function directionForRow(row){ return ['down','left','right','up'][Number(row)] || 'any'; }
function templateSteps(t){
  const steps=t.steps&&t.steps.length?t.steps:[t.description||'Apply this template to label the sheet.'];
  return `<ul class="template-steps">${steps.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`;
}
function sheetInfo(sheet){
  const original=sheet.preparedFromSheetId?state.project.sheets.find(s=>s.id===sheet.preparedFromSheetId):null;
  const s=sheetSettings();
  return `<div class="info-grid"><span>Current sheet</span><b>${sheet.width||'?'}×${sheet.height||'?'}</b><span>Cell size</span><b>${s.frameWidth||'?'}×${s.frameHeight||'?'}</b><span>Original</span><b>${original?`${original.width}×${original.height}`:'untouched'}</b><span>Status</span><b>${sheet.templateId?'template applied':'not prepared'}</b></div>`;
}
function drawSheet(){ const sheet=selectedSheet(), can=$('#sheetCanvas'); if(!sheet||!can)return; const stage=$('#sheetStage'); const settings=readMapInputs(); const fw=settings.frameWidth||32, fh=settings.frameHeight||32, mx=settings.marginX||0, my=settings.marginY||0, sx=settings.spacingX||0, sy=settings.spacingY||0; const image=new Image(); image.onload=()=>{let z=state.sheetZoom||1; if(state.sheetFit){const pad=42; z=Math.min((stage.clientWidth-pad)/image.width,(stage.clientHeight-pad)/image.height); z=Math.max(.08, Math.min(4, z)); state.sheetZoom=z;} const cssW=Math.ceil(image.width*z), cssH=Math.ceil(image.height*z); const dpr=window.devicePixelRatio||1; can.width=Math.ceil(cssW*dpr); can.height=Math.ceil(cssH*dpr); can.style.width=cssW+'px'; can.style.height=cssH+'px'; const ctx=can.getContext('2d'); ctx.setTransform(dpr,0,0,dpr,0,0); ctx.imageSmoothingEnabled=false; ctx.clearRect(0,0,cssW,cssH); ctx.drawImage(image,0,0,cssW,cssH); ctx.strokeStyle='rgba(125,211,252,.65)'; ctx.lineWidth=1; let cols=Math.floor((image.width-mx+sx)/(fw+sx)), rows=Math.floor((image.height-my+sy)/(fh+sy)); for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){let x=(mx+c*(fw+sx))*z,y=(my+r*(fh+sy))*z,w=fw*z,h=fh*z; ctx.strokeRect(Math.round(x)+.5,Math.round(y)+.5,Math.round(w),Math.round(h));} ctx.strokeStyle='#ffd166'; ctx.lineWidth=2; ctx.strokeRect((mx+selectedCell.col*(fw+sx))*z+1,(my+selectedCell.row*(fh+sy))*z+1,fw*z-2,fh*z-2); can.onclick=e=>{const r=can.getBoundingClientRect(); const px=(e.clientX-r.left)/z, py=(e.clientY-r.top)/z; selectedCell={col:Math.max(0,Math.floor((px-mx)/(fw+sx))), row:Math.max(0,Math.floor((py-my)/(fh+sy)))}; $('#cellReadout').textContent=`row ${selectedCell.row}, col ${selectedCell.col}`; suggestLabel(); drawSheet();}; $('#cellReadout').textContent=`row ${selectedCell.row}, col ${selectedCell.col}`; drawCellPreview(image, settings); setStatus(`Sheet zoom ${Math.round(z*100)}% · ${image.width}×${image.height}`); }; image.src=sheet.url; }
function drawCellPreview(image, settings){ const p=$('#cellPreview'); if(!p)return; const ctx=p.getContext('2d'); ctx.imageSmoothingEnabled=false; ctx.clearRect(0,0,p.width,p.height); const fw=settings.frameWidth||32, fh=settings.frameHeight||32, x=(settings.marginX||0)+selectedCell.col*(fw+(settings.spacingX||0)), y=(settings.marginY||0)+selectedCell.row*(fh+(settings.spacingY||0)); const sc=Math.max(1, Math.floor(Math.min(p.width/fw, p.height/fh))); ctx.drawImage(image,x,y,fw,fh,(p.width-fw*sc)/2,(p.height-fh*sc)/2,fw*sc,fh*sc); }
function suggestLabel(){ const t=currentTemplate(); for(const [dir,cell] of Object.entries(t.baseCells||{})){ if(Number(cell.row)===selectedCell.row && Number(cell.col)===selectedCell.col){$('#cellLabel').value='base_'+dir; $('#cellDirection').value=dir; return;} } const dir=directionForRow(selectedCell.row); $('#cellDirection').value=['down','left','right','up'].includes(dir)?dir:''; $('#cellLabel').value=`walk_${dir}_${String(selectedCell.col).padStart(2,'0')}`; }

async function extractSelectedCell(){ const sheet=selectedSheet(); if(!sheet)return; const label=$('#cellLabel').value.trim(); if(!label){toast('Add a frame label first');return;} const characterId=$('#sheetCharacter').value; if(!characterId){toast('Create/select a character first');return;} setSave('extracting'); const sprite=await api(`/api/sheet/${sheet.id}/extract-cell`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({row:selectedCell.row,col:selectedCell.col,label,direction:$('#cellDirection').value,characterId,settings:readMapInputs(),scale:{factor:1},replaceExisting:false})}); setSave('ready'); state.selectedCharacter=characterId; toast(`Extracted ${sprite.label}`); await refresh(); state.view='sheets'; renderNav(); renderSheets(); }
function renderTemplateManager(){
  const box=$('#templateManager'); if(!box)return; box.classList.toggle('hidden');
  if(box.classList.contains('hidden')) return;
  box.innerHTML=`<div class="template-list">${state.project.templates.map(t=>`<button class="template-row" data-tid="${t.id}"><b>${esc(t.name)}</b><span>${t.frameWidth||'?'}×${t.frameHeight||'?'} cells</span></button>`).join('')}</div><div class="template-edit"><input class="input" id="newTplName" placeholder="New template name"><button class="btn" id="dupTemplate">Duplicate selected</button></div><pre class="terminal compact">Template editing stays here so the main mapper stays clean. For now, duplicate an existing template and let agents/API refine it.</pre>`;
  let selected=currentTemplate().id;
  $$('.template-row',box).forEach(b=>b.onclick=()=>{selected=b.dataset.tid; $$('.template-row',box).forEach(x=>x.classList.toggle('active',x===b));});
  $('#dupTemplate').onclick=async()=>{const base=state.project.templates.find(t=>t.id===selected)||currentTemplate(); const name=$('#newTplName').value.trim()||base.name+' copy'; const copy={...JSON.parse(JSON.stringify(base)), id:'tpl_'+Date.now(), name}; await api('/api/template',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(copy)}); toast('Template duplicated'); await refresh(); renderSheets();};
}
async function scaleAsset(sourceId){ const mode=$('#scaleMode')?.value||'up', factor=Number($('#scaleFactor')?.value||2); if(factor<2){toast('Use an integer of 2 or greater');return;} setSave('scaling'); let out=await api('/api/scale',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sourceId,mode,factor})}); setSave('ready'); toast(`Scaled ${mode==='up'?'up':'down'} by ${factor}`); if(out.templateId!==undefined) state.selectedSheet=out.id; else state.selectedGenerated=out.id; await refresh(); }

async function addPairDialog(sprites){ if(sprites.length<2){toast('Need at least two sprites');return;} const base=prompt('Base sprite label contains:', 'base_right'); if(base===null)return; const action=prompt('Action sprite label contains:', 'fishing_right'); if(action===null)return; const b=sprites.find(s=>(s.label||'').includes(base)); const a=sprites.find(s=>(s.label||'').includes(action)); if(!b||!a){toast('Could not find matching sprites');return;} const label=prompt('Training action label', action) || action; await api('/api/training-pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({baseId:b.id,actionId:a.id,label})}); toast('Training pair added'); await refresh(); }

function characterById(id){return state.project.characters.find(c=>c.id===id)}
function animationsForCharacter(cid){return (state.project.animations||[]).filter(a=>a.characterId===cid)}
function spritesForCharacter(cid){return (characterById(cid)?.sprites||[]).map(s=>({...s, characterName:characterById(cid)?.name, characterId:cid}))}
function sourceLabel(s){const src=s?.source||{}; if(src.sheetId){const sh=state.project.sheets.find(x=>x.id===src.sheetId);return sh?`From ${sh.name||'sheet'} · r${src.row} c${src.col}`:''} return s?.source?.type==='generated'?'From generated output':''}
function sheetFamilyId(s){return s.familyId || s.preparedFromSheetId || s.id}
function versionName(s){return s.versionName || (s.versionRole==='prepared'?'Prepared':'Original')}
function spriteSlot(c,l,opts={}){let s=(c.sprites||[]).find(x=>x.label===l); const del=s?cardDeleteBtn(`Delete sprite ${l}`,'data-delete-sprite',s.id):''; const sel=opts.selectScope&&s?selectCheckbox(opts.selectScope,s.id):''; const cls=`card sidecard sprite-slot sprite-tile selectable-card${opts.selected?' selected':''}`; return `<div class="${cls}" data-id="${s?.id||''}">${del}${sel}<div class="thumb">${s?img(s.url):`<span class="tiny">empty</span>`}</div><h3>${esc(l)}</h3><p>${s?`${s.width}×${s.height}`:'Missing'}</p></div>`}
function groupSprites(c){const sprites=c?.sprites||[];return {bases:sprites.filter(s=>(s.label||'').startsWith('base_')), extras:sprites.filter(s=>!(s.label||'').startsWith('base_'))}}

function openAnimationModal(characterId){
  const c=characterById(characterId); const sprites=c?.sprites||[]; if(!sprites.length){toast('Add sprites before making an animation');return}
  const html=`<div class="modal-backdrop"><div class="modal card"><div class="modal-head"><h3>Create animation</h3><button class="btn small" id="closeModal">×</button></div><div class="field"><label>Name</label><input class="input" id="animName" placeholder="walk_down"></div><div class="field"><label>Filter sprites</label><input class="input" id="animFilter" placeholder="walk_down, base, fishing…"></div><div class="section-title">Pick frames from ${esc(c.name)}</div><div class="sprite-picker" id="animSpritePicker"></div><div class="section-title">Timeline</div><div class="timeline-build" id="animBuild"></div><div class="row"><label class="check"><input type="checkbox" id="animLoop" checked> Loop</label><button class="btn primary" id="saveAnim">Save animation</button></div></div></div>`;
  document.body.insertAdjacentHTML('beforeend',html); let picked=[]; const renderPicker=()=>{const q=($('#animFilter').value||'').toLowerCase(); $('#animSpritePicker').innerHTML=sprites.filter(s=>(s.label||s.name||'').toLowerCase().includes(q)).map(s=>`<button class="sprite-pick" data-id="${s.id}"><span class="mini">${img(s.url)}</span><span>${esc(s.label||s.name)}</span></button>`).join(''); $$('.sprite-pick').forEach(b=>b.onclick=()=>{const sp=sprites.find(s=>s.id===b.dataset.id); picked.push({spriteId:sp.id,label:sp.label,duration:120,url:sp.url}); renderBuild();});};
  const renderBuild=()=>{$('#animBuild').innerHTML=picked.length?picked.map((f,i)=>`<div class="frame-build"><span class="mini">${img(f.url)}</span><b>${esc(f.label)}</b><input class="input" data-dur="${i}" value="${f.duration}"><button class="btn small bad" data-rm="${i}">×</button></div>`).join(''):'<div class="empty">Click sprites above to add frames.</div>'; $$('[data-rm]').forEach(b=>b.onclick=()=>{picked.splice(+b.dataset.rm,1);renderBuild();}); $$('[data-dur]').forEach(inp=>inp.onchange=()=>{picked[+inp.dataset.dur].duration=Number(inp.value||120);});};
  $('#closeModal').onclick=()=>$('.modal-backdrop').remove(); $('#animFilter').oninput=renderPicker; $('#saveAnim').onclick=async()=>{const name=$('#animName').value.trim(); if(!name||!picked.length){toast('Name the animation and add frames');return} await api(`/api/character/${characterId}/animation`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,loop:$('#animLoop').checked,frames:picked})}); $('.modal-backdrop').remove(); toast('Animation saved'); await refresh(); renderLibraryDetail();}; renderPicker(); renderBuild();
}

function inferBaseLabel(label){const d=(label||'').split('_').pop();return ['up','down','left','right'].includes(d)?`base_${d}`:'base_right'}
function findTrainingSources(a){const input=a.inputLabel||inferBaseLabel(a.label), target=a.targetLabel||a.label; const ready=[],incomplete=[]; for(const c of state.project.characters||[]){const base=(c.sprites||[]).find(s=>s.label===input); const out=(c.sprites||[]).find(s=>s.label===target); (base&&out?ready:incomplete).push({character:c,base,out});} return {ready,incomplete,input,target}}
function renderActionInspector(a){ if(!a){right(`<div class="sidecard card"><h3>Actions</h3><p>Actions are learned transformations trained from every character that has the matching input and target labels.</p></div>`); return;} const src=findTrainingSources(a); const ex=src.ready[0]; right(`<div class="sidecard card"><h3>${esc(a.label)}</h3><p>${esc(src.input)} → ${esc(src.target)}</p></div><div class="sidecard card"><h3>Example</h3>${ex?`<div class="row"><div class="thumb">${img(ex.base.url)}</div><span>→</span><div class="thumb">${img(ex.out.url)}</div></div><p>${esc(ex.character.name)}</p>`:'<p>No ready examples yet.</p>'}</div><div class="sidecard card"><h3>Training sources</h3>${src.ready.map(x=>`<p>✓ ${esc(x.character.name)}</p>`).join('')||'<p>No ready sources.</p>'}<button class="btn small full" id="showIncomplete">Show incomplete</button></div><div class="sidecard card"><h3>Change map</h3>${a.learned?.diffUrl?`<div class="thumb wide">${img(a.learned.diffUrl)}</div>`:'<p>Train this action to see a ghost map of common changed pixels.</p>'}</div>`); $('#showIncomplete')?.addEventListener('click',()=>alert(src.incomplete.map(x=>`${x.character.name}: ${x.base?'has base':'missing base'}, ${x.out?'has target':'missing target'}`).join('\n')||'No incomplete sources.')); }
async function ensurePairsForAction(a){const src=findTrainingSources(a); const existing=new Set((state.project.trainingPairs||[]).filter(p=>p.label===a.label).map(p=>p.baseId+':'+p.actionId)); for(const x of src.ready){const key=x.base.id+':'+x.out.id; if(!existing.has(key)){await api('/api/training-pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({label:a.label,baseId:x.base.id,actionId:x.out.id})});}}}
function setupEditor(sprite){
  if(!sprite)return;
  const can=$('#pixCanvas'), ctx=can.getContext('2d');
  let image=new Image(), zoom=14, tool='pencil', color=[0,0,0,255], grid=true, undo=[], redo=[];
  image.onload=()=>{const off=document.createElement('canvas');off.width=image.width;off.height=image.height;const ox=off.getContext('2d',{willReadFrequently:true});ox.imageSmoothingEnabled=false;ox.drawImage(image,0,0);state.editor={off,ox,sprite};draw();buildPalette(ox.getImageData(0,0,off.width,off.height).data);updateButtons();};
  image.src=sprite.url;
  function setupHiDpiCanvas(cssW, cssH){const dpr=window.devicePixelRatio||1;can.width=Math.max(1,Math.floor(cssW*dpr));can.height=Math.max(1,Math.floor(cssH*dpr));can.style.width=cssW+'px';can.style.height=cssH+'px';ctx.setTransform(dpr,0,0,dpr,0,0);ctx.imageSmoothingEnabled=false;}
  function draw(){const off=state.editor.off;if(!off)return;const cssW=off.width*zoom,cssH=off.height*zoom;setupHiDpiCanvas(cssW,cssH);ctx.clearRect(0,0,cssW,cssH);ctx.drawImage(off,0,0,cssW,cssH);if(grid&&zoom>=8){ctx.strokeStyle='rgba(255,255,255,.16)';ctx.lineWidth=1;for(let x=0;x<=off.width;x++){ctx.beginPath();ctx.moveTo(x*zoom+.5,0);ctx.lineTo(x*zoom+.5,cssH);ctx.stroke()}for(let y=0;y<=off.height;y++){ctx.beginPath();ctx.moveTo(0,y*zoom+.5);ctx.lineTo(cssW,y*zoom+.5);ctx.stroke()}}drawPreview();setStatus(`Editor zoom ${zoom}× · ${off.width}×${off.height} px · ${sprite.characterName||'sprite'} / ${sprite.label||sprite.name}`);updateButtons();}
  function updateButtons(){const u=$('#undoBtn'),r=$('#redoBtn');if(u)u.disabled=!undo.length;if(r)r.disabled=!redo.length;}
  function snapshot(){if(!state.editor?.off)return;undo.push(state.editor.ox.getImageData(0,0,state.editor.off.width,state.editor.off.height));if(undo.length>50)undo.shift();redo=[];updateButtons();}
  function restore(stackFrom,stackTo){if(!stackFrom.length)return;stackTo.push(state.editor.ox.getImageData(0,0,state.editor.off.width,state.editor.off.height));state.editor.ox.putImageData(stackFrom.pop(),0,0);draw();}
  function pos(e){const r=can.getBoundingClientRect();return{x:Math.floor((e.clientX-r.left)/zoom),y:Math.floor((e.clientY-r.top)/zoom)}}
  function put(x,y,c){if(x<0||y<0||x>=state.editor.off.width||y>=state.editor.off.height)return;const d=state.editor.ox.createImageData(1,1);d.data.set(c);state.editor.ox.putImageData(d,x,y)}
  function flood(x,y,c){const ox=state.editor.ox,w=state.editor.off.width,h=state.editor.off.height,img=ox.getImageData(0,0,w,h),data=img.data,idx=(x,y)=>(y*w+x)*4,start=[...data.slice(idx(x,y),idx(x,y)+4)];if(start.every((v,i)=>v===c[i]))return;let q=[[x,y]],seen=new Set;while(q.length){let[a,b]=q.pop(),key=a+','+b;if(seen.has(key)||a<0||b<0||a>=w||b>=h)continue;let k=idx(a,b);if(!start.every((v,i)=>data[k+i]===v))continue;seen.add(key);c.forEach((v,i)=>data[k+i]=v);q.push([a+1,b],[a-1,b],[a,b+1],[a,b-1])}ox.putImageData(img,0,0)}
  let down=false;can.onmousedown=e=>{down=true;snapshot();paint(e)};can.onmousemove=e=>{if(down)paint(e)};window.onmouseup=()=>down=false;
  function paint(e){const p=pos(e);if(tool==='picker'){const d=state.editor.ox.getImageData(p.x,p.y,1,1).data;color=[d[0],d[1],d[2],d[3]];markSwatch();return}if(tool==='eraser')put(p.x,p.y,[0,0,0,0]);else if(tool==='pencil')put(p.x,p.y,color);else if(tool==='fill')flood(p.x,p.y,color);draw()}
  function buildPalette(data){const map=new Map;for(let i=0;i<data.length;i+=4){if(data[i+3]===0)continue;const key=[data[i],data[i+1],data[i+2],data[i+3]].join(',');map.set(key,(map.get(key)||0)+1)}const arr=[...map.entries()].sort((a,b)=>b[1]-a[1]).slice(0,32);$('#palette').innerHTML=arr.map(([k],i)=>{let[r,g,b,a]=k.split(',').map(Number);return `<button class="swatch ${i===0?'active':''}" data-c="${k}" title="rgba(${r},${g},${b},${a})" style="background:rgba(${r},${g},${b},${a/255})"></button>`}).join('');if(arr[0])color=arr[0][0].split(',').map(Number);$$('.swatch').forEach(s=>s.onclick=()=>{color=s.dataset.c.split(',').map(Number);markSwatch()})}
  function markSwatch(){$$('.swatch').forEach(s=>s.classList.toggle('active',s.dataset.c===color.join(',')))}
  function drawPreview(){const p=$('#animPreview');if(!p||!state.editor.off)return;const pc=p.getContext('2d');pc.imageSmoothingEnabled=false;pc.clearRect(0,0,p.width,p.height);const sc=Math.max(1,Math.floor(Math.min(p.width/state.editor.off.width,p.height/state.editor.off.height)));pc.drawImage(state.editor.off,Math.floor((p.width-state.editor.off.width*sc)/2),Math.floor((p.height-state.editor.off.height*sc)/2),state.editor.off.width*sc,state.editor.off.height*sc)}
  $$('.tool').forEach(b=>b.onclick=()=>{tool=b.dataset.tool;$$('.tool').forEach(x=>x.classList.toggle('active',x===b))});
  $('#zoomIn').onclick=()=>{zoom=Math.min(40,zoom+2);draw()};$('#zoomOut').onclick=()=>{zoom=Math.max(2,zoom-2);draw()};$('#toggleGrid').onclick=()=>{grid=!grid;draw()};$('#undoBtn').onclick=()=>restore(undo,redo);$('#redoBtn').onclick=()=>restore(redo,undo);
  window.onkeydown=e=>{if(state.view!=='editor')return;if(e.key.toLowerCase()==='b')tool='pencil';if(e.key.toLowerCase()==='e')tool='eraser';if(e.key.toLowerCase()==='i')tool='picker';if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();if(e.shiftKey)restore(redo,undo);else restore(undo,redo)}};
  $('#saveEdit').onclick=async()=>{const name=prompt('Save as',(sprite.label||sprite.name||'edited')+'_edited');if(!name)return;const data=state.editor.off.toDataURL('image/png');await api('/api/save-edited',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({dataUrl:data,name,label:'edited',sourceId:sprite.id})});toast('Edited PNG saved');await refresh();state.view='editor';renderNav();renderEditor()};
}

/* ------------------------------
   v7 template/options + no-typing actions/generate polish
-------------------------------- */
function allLabels(){
  const labels=[];
  for(const c of state.project.characters||[]) for(const s of c.sprites||[]) if(s.label) labels.push(s.label);
  for(const g of state.project.generated||[]) if(g.label) labels.push(g.label);
  return [...new Set(labels)].sort();
}
function nonBaseLabels(){return allLabels().filter(l=>!l.startsWith('base_'));}
function labelUsage(label){
  return (state.project.characters||[]).map(c=>({character:c,sprite:(c.sprites||[]).find(s=>s.label===label)})).filter(x=>x.sprite);
}
function v7TemplateOptions(){
  const t=currentTemplate(); const d=t.defaultOptions||{};
  return {
    prefix: ($('#tplPrefix')?.value || d.prefix || 'walk').trim() || 'walk',
    columnZeroRole: $('#tplZeroRole')?.value || d.columnZeroRole || 'base_and_frame',
    scale: $('#tplScale')?.value || d.scale || 'none',
    duration: Number($('#tplDuration')?.value || d.duration || 120)
  };
}
function v7TemplateOptionHtml(t){
  const d=t.defaultOptions||{};
  return `<details class="advanced-box v7-options"><summary>Advanced template options</summary>
    <div class="field"><label>Animation name</label><input class="input" id="tplPrefix" value="${esc(d.prefix||'walk')}" placeholder="walk, run, swim"></div>
    <div class="field"><label>Column 0 role</label><select class="select" id="tplZeroRole">
      ${[['base_and_frame','Base sprite + animation frame'],['animation_only','Animation frame only'],['training_only','Training sprite only']].map(([v,n])=>`<option value="${v}" ${v===(d.columnZeroRole||'base_and_frame')?'selected':''}>${n}</option>`).join('')}
    </select></div>
    <div class="field"><label>Scale before slicing</label><select class="select" id="tplScale">
      ${[['none','None'],['down2','50% / down by 2'],['up2','200% / up by 2']].map(([v,n])=>`<option value="${v}" ${v===(d.scale||'none')?'selected':''}>${n}</option>`).join('')}
    </select></div>
    <div class="field"><label>Frame duration</label><input class="input" id="tplDuration" type="number" min="16" value="${Number(d.duration||120)}"></div>
    <p class="tiny">Frame labels use <b>prefix_direction_index</b>, for example <b>run_left_0</b>.</p>
  </details>`;
}
function v7TemplateSummary(t){
  return `<div class="template-explain" id="templateExplain"><strong>${esc(t.name)}</strong><ul class="template-steps">${(t.steps||[t.description||'Apply template']).map(x=>`<li>${esc(x)}</li>`).join('')}</ul></div>`;
}
function currentTemplate(){ const ui=$('#tplSelect')?.value; const sheet=selectedSheet(); return state.project.templates.find(t=>t.id===(ui||sheet?.templateId)) || state.project.templates[0] || {}; }
async function postPlan(templateId, sheetId, options){return api(`/api/templates/${templateId}/plan`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sheetId,options})});}
function openActionModal(){
  const labels=allLabels(); if(!labels.length){toast('Import sprites first so labels exist');return}
  const modal=document.createElement('div'); modal.className='modal-backdrop';
  const baseDefault=labels.find(l=>l==='base_right')||labels.find(l=>l.startsWith('base_'))||labels[0]; const targetDefault=nonBaseLabels()[0]||labels[0];
  modal.innerHTML=`<div class="modal card"><div class="modal-head"><h3>Create action from existing labels</h3>${modalCloseBtn('closeModal')}</div><div class="grid cols2"><div class="field"><label>Input/base label</label><select class="select" id="modalInputLabel">${labels.map(l=>`<option ${l===baseDefault?'selected':''}>${esc(l)}</option>`).join('')}</select></div><div class="field"><label>Target/action label</label><select class="select" id="modalTargetLabel">${labels.map(l=>`<option ${l===targetDefault?'selected':''}>${esc(l)}</option>`).join('')}</select></div></div><div class="section-title">Preview</div><div id="actionPreviewBox" class="card sidecard"></div><div class="row"><button class="btn primary" id="createActionNow">Create action</button><button class="btn" id="refreshActionPreview">Refresh preview</button></div></div>`;
  document.body.appendChild(modal); const close=()=>modal.remove(); $('#closeModal',modal).onclick=close;
  const renderPreview=()=>{const input=$('#modalInputLabel',modal).value,target=$('#modalTargetLabel',modal).value; const ready=[]; const incomplete=[]; for(const c of state.project.characters||[]){const b=(c.sprites||[]).find(s=>s.label===input),t=(c.sprites||[]).find(s=>s.label===target);(b&&t?ready:incomplete).push({c,b,t});} const ex=ready[0]; $('#actionPreviewBox',modal).innerHTML=`<p><b>${esc(input)}</b> → <b>${esc(target)}</b></p>${ex?`<div class="row"><div class="thumb">${img(ex.b.url)}</div><span>→</span><div class="thumb">${img(ex.t.url)}</div><span>${esc(ex.c.name)}</span></div>`:'<p class="tiny">No complete example yet.</p>'}<div class="tags"><span class="tag">${ready.length} ready</span><span class="tag">${incomplete.length} incomplete</span></div><div class="section-title">Characters with target label</div>${labelUsage(target).map(x=>`<span class="tag">${esc(x.character.name)}</span>`).join('')||'<p class="tiny">None yet.</p>'}`;};
  $('#modalInputLabel',modal).onchange=renderPreview; $('#modalTargetLabel',modal).onchange=renderPreview; $('#refreshActionPreview',modal).onclick=renderPreview; renderPreview();
  $('#createActionNow',modal).onclick=async()=>{const input=$('#modalInputLabel',modal).value,target=$('#modalTargetLabel',modal).value; await api('/api/actions/define',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({label:target,targetLabel:target,inputLabel:input})}); toast('Action created'); close(); await refresh(); state.selectedAction=target; renderActions();};
}
function templateDefaults(t){ return Object.assign({prefix:'walk', columnZeroRole:'base_and_frame', scale:'none', duration:120}, t?.defaultOptions||{}); }
function selectedMapperTemplate(sheet=selectedSheet()){
  const id = state.mapperTemplateId || sheet?.templateId || state.project.templates?.[0]?.id;
  return state.project.templates.find(t=>t.id===id) || state.project.templates[0] || {};
}
function v8TemplateOptions(){
  const t = selectedMapperTemplate();
  const d = templateDefaults(t);
  return {
    prefix: ($('#tplPrefix')?.value || d.prefix || 'walk').trim() || d.prefix || 'walk',
    columnZeroRole: $('#tplZeroRole')?.value || d.columnZeroRole || 'base_and_frame',
    scale: $('#tplScale')?.value || d.scale || 'none',
    duration: Number($('#tplDuration')?.value || d.duration || 120)
  };
}
function sheetFamilyCurrent(f){
  return f.versions.find(v=>v.isCurrentVersion) || f.versions.find(v=>v.id===f.versions[0]?.currentVersionId) || f.versions.find(v=>v.versionRole==='prepared') || f.versions[0];
}
function sheetFamilies(){
  const map=new Map();
  for(const s of state.project.sheets||[]){
    const fid=s.familyId||s.id;
    if(!map.has(fid))map.set(fid,{id:fid,name:(s.name||'Sheet').replace(/ \(.+\)$/,''),versions:[],characterIds:new Set()});
    const f=map.get(fid); f.versions.push(s); if(s.characterId)f.characterIds.add(s.characterId);
  }
  return [...map.values()].map(f=>({...f, versions:f.versions.sort((a,b)=>(b.updatedAt||b.createdAt||0)-(a.updatedAt||a.createdAt||0)), characterIds:[...f.characterIds]}));
}
function renderSheets(){
  state.sheetPanel='families'; state.sheetFamilyId=null;
  title('Sheets');
  toolbar(`<label class="btn primary">Import sheet<input id="sheetFileMain" type="file" accept="image/png" hidden></label><select class="select" id="sheetGroup"><option>Group by character</option><option>Group by family</option></select>`);
  const fams=sheetFamilies(); const byChar=new Map(); const un=[];
  fams.forEach(f=>{ if(f.characterIds.length){f.characterIds.forEach(cid=>{if(!byChar.has(cid))byChar.set(cid,[]); byChar.get(cid).push(f);});} else un.push(f); });
  const familyCard=f=>{const cur=sheetFamilyCurrent(f); const chars=f.characterIds.map(id=>characterById(id)?.name).filter(Boolean).join(', ')||'Unassigned'; const sel=isSelectMode('sheets'); const del=cardDeleteBtn(`Delete sheet ${f.name}`,'data-del-sheet',f.id); const chk=sel?selectCheckbox('sheets',f.id):''; return `<div class="card sidecard sheet-family v8-family selectable-card ${isSelected('sheets',f.id)?'selected':''}" data-family="${f.id}" data-current="${cur?.id||''}">${del}${chk}
    <div class="thumb wide">${img(cur?.url)}</div><div class="row spread"><h3 class="truncate">${esc(f.name)}</h3><span class="tag">${f.versions.length} version${f.versions.length===1?'':'s'}</span></div>
    <p>Current: ${esc(versionName(cur)||'Original')}</p><p>Used by: ${esc(chars)}</p>
    <div class="row"><button type="button" class="btn small" data-stop-prop="1" data-versions="${f.id}">Versions</button></div>
  </div>`};
  let html=bulkBar('sheets','sheets')+sectionHead('Sheets','sheets');
  if(byChar.size){for(const [cid,list] of byChar){html+=`<div class="section-title">${esc(characterById(cid)?.name||'Character')}</div><div class="grid cols3">${list.map(familyCard).join('')}</div>`;}}
  if(un.length){html+=`<div class="section-title">Unassigned sheets</div><div class="grid cols3">${un.map(familyCard).join('')}</div>`;}
  if(!fams.length) html+='<div class="empty"><strong>No sheets yet.</strong><br/>Import a sheet, then apply a template and populate a character.</div>';
  $('#view').innerHTML=html;
  right(`<div class="sidecard card"><h3>Fast sheet workflow</h3><p>Click a sheet card to open the current version. Use Versions for version manager. × deletes the whole sheet family.</p></div>`);
  $('#sheetFileMain').onchange=e=>uploadSheetFlow(e.target.files[0]);
  bindSelectMode('sheets', renderSheets, bulkDeleteSheets);
  $$('[data-versions]').forEach(b=>b.onclick=e=>{ e.stopPropagation(); openSheetFamily(b.dataset.versions); });
  $$('[data-del-sheet]').forEach(b=>b.onclick=async e=>{ e.stopPropagation(); if(confirm('Delete this sheet and all its versions?\n\nExtracted character sprites will remain.')){ await api('/api/sheet-family/'+b.dataset.delSheet,{method:'DELETE'}); toast('Sheet deleted'); await refresh(); renderSheets(); }});
  $$('.sheet-family').forEach(el=>{
    bindCardOpen(el, ()=>{ state.selectedSheet=el.dataset.current; state.mapperTemplateId=null; renderSheetMapper(); }, 'sheets', el.dataset.family, renderSheets);
    el.ondblclick=()=>{ state.selectedSheet=el.dataset.current; state.mapperTemplateId=null; renderSheetMapper(); };
  });
}
function sheetSettings(){ const sheet=selectedSheet(); const t=selectedMapperTemplate(sheet); return Object.assign({frameWidth:t.outputFrameWidth||t.frameWidth||32,frameHeight:t.outputFrameHeight||t.frameHeight||32,marginX:t.marginX||0,marginY:t.marginY||0,spacingX:t.spacingX||0,spacingY:t.spacingY||0}, sheet?.settings||{}); }
async function saveAssignmentOnly(){
  const sheet=selectedSheet(); if(!sheet)return; const characterId=$('#sheetCharacter')?.value; if(!characterId){toast('Choose a character');return;}
  setSave('saving'); await api('/api/sheet/'+sheet.id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({characterId})});
  state.selectedCharacter=characterId; setSave('ready'); toast('Assignment saved'); await reloadProjectOnly(); renderSheetMapper();
}
function openTemplateManager(){
  const modal=document.createElement('div'); modal.className='modal-backdrop';
  const builtin=new Set(['tpl_walk_cycle','tpl_general_row_cycle']);
  modal.innerHTML=`<div class="modal card template-modal"><div class="modal-head"><h3>Manage templates</h3><button class="btn small" id="closeTplMgr">Close</button></div><div class="grid cols2"><div class="card sidecard"><h3>Templates</h3><div id="tplMgrList">${(state.project.templates||[]).map(t=>`<button class="version-row" data-tpl="${t.id}"><span><b>${esc(t.name)}</b><small>${builtin.has(t.id)?'Built-in · duplicate to edit':'Custom template'}</small></span></button>`).join('')}</div><div class="row"><button class="btn primary" id="newTplBtn">New</button><button class="btn" id="dupTplBtn">Duplicate</button><button class="btn bad" id="delTplBtn">Delete</button></div></div><div class="card sidecard"><h3>Edit selected</h3><div class="field"><label>Name</label><input class="input" id="tplEditName"></div><div class="field"><label>Description</label><textarea class="input" id="tplEditDesc" rows="4"></textarea></div><div class="grid cols2"><div class="field"><label>Frame width</label><input class="input" id="tplEditFw" type="number"></div><div class="field"><label>Frame height</label><input class="input" id="tplEditFh" type="number"></div></div><div class="grid cols2"><div class="field"><label>Default prefix</label><input class="input" id="tplEditPrefix"></div><div class="field"><label>Default scale</label><select class="select" id="tplEditScale"><option value="none">None</option><option value="down2">50%</option><option value="up2">200%</option></select></div></div><div class="field"><label>Column 0 role</label><select class="select" id="tplEditRole"><option value="base_and_frame">Base + frame</option><option value="animation_only">Animation only</option><option value="training_only">Training only</option></select></div><button class="btn good full" id="saveTplBtn">Save custom template</button></div></div></div>`;
  document.body.appendChild(modal); let selected=(state.project.templates||[])[0]?.id;
  const loadTpl=()=>{const t=state.project.templates.find(x=>x.id===selected)||{}; $('#tplEditName',modal).value=t.name||''; $('#tplEditDesc',modal).value=t.description||''; $('#tplEditFw',modal).value=t.frameWidth||32; $('#tplEditFh',modal).value=t.frameHeight||32; $('#tplEditPrefix',modal).value=(t.defaultOptions||{}).prefix||'action'; $('#tplEditScale',modal).value=(t.defaultOptions||{}).scale||'none'; $('#tplEditRole',modal).value=(t.defaultOptions||{}).columnZeroRole||'animation_only'; $$('.version-row',modal).forEach(b=>b.classList.toggle('active',b.dataset.tpl===selected));};
  $$('.version-row',modal).forEach(b=>b.onclick=()=>{selected=b.dataset.tpl; loadTpl();}); loadTpl(); $('#closeTplMgr',modal).onclick=()=>modal.remove();
  const templateFromForm=(base={})=>Object.assign({}, base, {id:base.id||('tpl_'+Date.now()), name:$('#tplEditName',modal).value.trim()||'Custom template', description:$('#tplEditDesc',modal).value.trim(), templateKind:'row_cycle', directions:['down','left','right','up'], frameWidth:Number($('#tplEditFw',modal).value||32), frameHeight:Number($('#tplEditFh',modal).value||32), outputFrameWidth:Number($('#tplEditFw',modal).value||32), outputFrameHeight:Number($('#tplEditFh',modal).value||32), marginX:0, marginY:0, spacingX:0, spacingY:0, steps:['Use rows 0-3 as down, left, right, up','Use columns as animation frames','Name frames with the selected prefix'], defaultOptions:{prefix:$('#tplEditPrefix',modal).value.trim()||'action', columnZeroRole:$('#tplEditRole',modal).value, scale:$('#tplEditScale',modal).value, duration:120}});
  $('#newTplBtn',modal).onclick=()=>{selected=''; $('#tplEditName',modal).value='Custom Row Cycle'; $('#tplEditDesc',modal).value='Custom row-cycle template.'; $('#tplEditFw',modal).value=32; $('#tplEditFh',modal).value=32; $('#tplEditPrefix',modal).value='action'; $('#tplEditScale',modal).value='none'; $('#tplEditRole',modal).value='animation_only';};
  $('#dupTplBtn',modal).onclick=async()=>{const base=state.project.templates.find(x=>x.id===selected)||selectedMapperTemplate(); const t=templateFromForm(JSON.parse(JSON.stringify(base))); t.id='tpl_'+Date.now(); t.name=(base.name||'Template')+' copy'; await api('/api/template',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(t)}); toast('Template duplicated'); await reloadProjectOnly(); modal.remove(); renderSheetMapper();};
  $('#saveTplBtn',modal).onclick=async()=>{const base=state.project.templates.find(x=>x.id===selected); if(base&&builtin.has(base.id)){toast('Duplicate built-ins before editing'); return;} const t=templateFromForm(base||{}); await api('/api/template',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(t)}); toast('Template saved'); await reloadProjectOnly(); state.mapperTemplateId=t.id; modal.remove(); renderSheetMapper();};
  $('#delTplBtn',modal).onclick=async()=>{const t=state.project.templates.find(x=>x.id===selected); if(!t)return; if(builtin.has(t.id)){toast('Built-in templates cannot be deleted');return;} if(confirm('Delete this custom template?')){await api('/api/template/'+t.id,{method:'DELETE'}); toast('Template deleted'); await reloadProjectOnly(); modal.remove(); renderSheetMapper();}};
}

/* --------------------------------------------------------------------------
   v9 stability/control overrides: template state, mapper undo, sheet deletes,
   action workspace, generate polish, transparent editor grid.
   -------------------------------------------------------------------------- */
function v9TemplateDefaults(t){ return Object.assign({prefix:'walk', columnZeroRole:'base_and_frame', scale:'none', duration:120}, t?.defaultOptions||{}); }
function v9DraftKey(sheet=selectedSheet(), templateId){ return `${sheet?.id||'none'}:${templateId||selectedMapperTemplate(sheet)?.id||'none'}`; }
function v9SaveDraft(){ const sheet=selectedSheet(); const t=selectedMapperTemplate(sheet); if(!sheet||!t)return; state.mapperDrafts=state.mapperDrafts||{}; state.mapperDrafts[v9DraftKey(sheet,t.id)] = v9ReadTemplateOptions(); }
function v9OptionsFor(t, sheet){
  const key=v9DraftKey(sheet,t.id); const saved=state.mapperDrafts?.[key]; if(saved) return Object.assign(v9TemplateDefaults(t), saved);
  if(sheet?.templateId===t.id && sheet?.templateOptions) return Object.assign(v9TemplateDefaults(t), sheet.templateOptions);
  return v9TemplateDefaults(t);
}
function pushMapperHistory(label='change'){
  const sheet=selectedSheet(); if(!sheet)return; state.mapperUndo=state.mapperUndo||[]; state.mapperRedo=[];
  state.mapperUndo.push({label, selectedSheet:sheet.id, mapperTemplateId:state.mapperTemplateId||sheet.templateId, options:v9ReadTemplateOptions(), settings:readMapInputs(), selectedCharacter:state.selectedCharacter});
  if(state.mapperUndo.length>30) state.mapperUndo.shift();
}
function restoreMapperSnapshot(snap){ if(!snap)return; state.selectedSheet=snap.selectedSheet; state.mapperTemplateId=snap.mapperTemplateId; state.selectedCharacter=snap.selectedCharacter; state.mapperDrafts=state.mapperDrafts||{}; state.mapperDrafts[v9DraftKey({id:snap.selectedSheet}, snap.mapperTemplateId)] = snap.options; renderSheetMapper(); }
function undoMapper(){ const u=state.mapperUndo||[]; if(!u.length){toast('Nothing to undo');return;} const cur={label:'redo',selectedSheet:selectedSheet()?.id,mapperTemplateId:$('#tplSelect')?.value||state.mapperTemplateId,options:v9ReadTemplateOptions(),settings:readMapInputs(),selectedCharacter:state.selectedCharacter}; state.mapperRedo=state.mapperRedo||[]; state.mapperRedo.push(cur); restoreMapperSnapshot(u.pop()); toast('Mapper undo'); }
function redoMapper(){ const r=state.mapperRedo||[]; if(!r.length){toast('Nothing to redo');return;} pushMapperHistory('undo'); restoreMapperSnapshot(r.pop()); toast('Mapper redo'); }
function versionDeleteButton(v){return `<button class="btn small bad delete-version" data-id="${v.id}">Delete</button>`}
function openSheetFamily(fid){
  state.sheetPanel='versions'; state.sheetFamilyId=fid;
  const f=sheetFamilies().find(x=>x.id===fid); if(!f)return; const cur=sheetFamilyCurrent(f); state.selectedSheet=(state.selectedSheet&&f.versions.some(v=>v.id===state.selectedSheet))?state.selectedSheet:cur?.id;
  title(`Sheet versions: ${f.name}`); toolbar(`<button class="btn" id="backSheets">← Sheets</button><button class="btn primary" id="openMapper">Open</button><button class="btn" id="renameVersion">Rename</button><button class="btn bad" id="deleteFamily">Delete sheet</button>`);
  $('#view').innerHTML=`<div class="grid cols2"><div class="card sidecard"><h3>Versions</h3>${f.versions.map(v=>`<button class="version-row ${state.selectedSheet===v.id?'active':''}" data-id="${v.id}"><span class="mini">${img(v.url)}</span><span><b>${esc(versionName(v))}</b><small>${v.width}×${v.height} · ${esc(v.templateId||'no template')}</small></span>${v.isCurrentVersion?'<span class="tag">current</span>':''}</button>`).join('')}</div><div class="card sidecard stack"><h3>Selected version</h3><div class="thumb wide">${img(selectedSheet()?.url)}</div><p>${esc(selectedSheet()?.name||'')}</p><p>${selectedSheet()?.width}×${selectedSheet()?.height}</p><div class="row"><button class="btn primary" id="openMapper2">Open</button><button class="btn bad" id="deleteVersion">Delete version</button></div></div></div>`;
  right(`<div class="sidecard card"><h3>Version cleanup</h3><p>You can delete prepared versions, originals, or the entire sheet family. Extracted character sprites remain safe.</p></div>`);
  $('#backSheets').onclick=()=>renderSheets(); $('#openMapper').onclick=$('#openMapper2').onclick=()=>{state.mapperTemplateId=null; renderSheetMapper();};
  $('#renameVersion').onclick=async()=>{const s=selectedSheet(); const n=prompt('Version name', versionName(s)); if(!n)return; await api('/api/sheet/'+s.id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({versionName:n})}); toast('Version renamed'); await reloadProjectOnly(); openSheetFamily(fid);};
  $('#deleteVersion').onclick=async()=>{const s=selectedSheet(); if(!s)return; if(confirm(`Delete version "${versionName(s)}"? Character sprites already extracted from it will remain.`)){await api('/api/sheet-version/'+s.id,{method:'DELETE'}); toast('Version deleted'); await reloadProjectOnly(); const nf=sheetFamilies().find(x=>x.id===fid); if(nf) openSheetFamily(fid); else renderSheets();}};
  $('#deleteFamily').onclick=async()=>{if(confirm(`Delete sheet "${f.name}" and all ${f.versions.length} versions? Extracted character sprites will remain.`)){await api('/api/sheet-family/'+f.id,{method:'DELETE'}); toast('Sheet deleted'); await reloadProjectOnly(); renderSheets();}};
  $$('.version-row').forEach(b=>{b.onclick=()=>{state.selectedSheet=b.dataset.id; openSheetFamily(fid)}; b.ondblclick=()=>{state.selectedSheet=b.dataset.id; renderSheetMapper();};});
}
async function applySelectedTemplate(){
  const sheet=selectedSheet(); if(!sheet)return; const templateId=$('#tplSelect').value; const options=v9ReadTemplateOptions(); v9SaveDraft(); pushMapperHistory('Apply template');
  if(sheet.preparedFromSheetId && options.scale && options.scale!=='none' && !confirm('This looks like an already-prepared version. Applying scale again may shrink/enlarge it again. Continue?')) return;
  setSave('preparing'); $('#prepareBar').style.width='25%'; $('#prepareLog').textContent=`Applying ${currentTemplate().name}…\n`;
  const out=await api(`/api/templates/${templateId}/apply`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sheetId:sheet.id,options})});
  $('#prepareBar').style.width='100%'; const s=out.sheet; state.selectedSheet=s.id; state.mapperTemplateId=templateId; state.mapperDrafts=state.mapperDrafts||{}; state.mapperDrafts[v9DraftKey({id:s.id}, templateId)] = options; state.sheetFit=true; setSave('ready');
  $('#prepareLog').textContent+=`${out.plan?.preparesCopy?'Prepared version created':'Template settings saved'}\nSheet: ${s.name}\nVersion: ${s.versionName||'Prepared'}\nSize: ${s.width}×${s.height}\nCells: ${out.plan?.frameWidth||'?'}×${out.plan?.frameHeight||'?'}\nSprites: ${out.plan?.spriteCount||0}\nAnimations: ${out.plan?.animationCount||0}\nReady to save.`;
  toast('Template applied'); await reloadProjectOnly(); renderSheetMapper();
}
async function saveSheetMapping(){
  const sheet=selectedSheet(); if(!sheet)return; setSave('saving'); v9SaveDraft();
  const payload={templateId:$('#tplSelect')?.value||sheet.templateId||selectedMapperTemplate(sheet).id, templateOptions:v9ReadTemplateOptions(), settings:readMapInputs(), animations:sheet.animations||[], mappings:sheet.mappings||[]};
  await api('/api/sheet/'+sheet.id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}); setSave('ready'); toast('Sheet saved'); await reloadProjectOnly();
}
async function populateFromTemplate(mode='block'){
  const sheet=selectedSheet(), charId=$('#sheetCharacter').value; if(!charId){toast('Choose a character');return}
  setSave('populating'); $('#populateBar').style.width='18%'; $('#populateLog').textContent='Saving sheet and checking duplicates…\n'; await saveSheetMapping();
  $('#populateBar').style.width='55%'; $('#populateLog').textContent+='Creating sprites and animations…\n';
  try{const out=await api(`/api/sheet/${state.selectedSheet||sheet.id}/extract-template`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({characterId:charId,templateId:$('#tplSelect').value,settings:readMapInputs(),includeBases:true,includeAnimations:true,duplicateMode:mode})}); $('#populateBar').style.width='100%'; $('#populateLog').textContent+=`Created ${out.count} sprites and ${out.animations.length} animations.\nDone. Use Open character when ready.`; state.selectedCharacter=charId; toast('Character populated'); await reloadProjectOnly(); renderSheetMapper();}
  catch(e){$('#populateBar').style.width='100%'; $('#populateLog').textContent+=`Stopped: ${e.message}\n`; toast('Duplicate protected'); setSave('ready');}
}
function setEditorBg(mode){const st=$('#editorStage'); if(!st)return; ['editor-bg-darkchecker','editor-bg-lightchecker','editor-bg-clear','editor-bg-light','editor-bg-dark','checker'].forEach(c=>st.classList.remove(c)); st.classList.add('editor-bg-'+mode); const prev=$('#animPreview'); if(prev){['checker','editor-bg-darkchecker','editor-bg-lightchecker','editor-bg-clear','editor-bg-light','editor-bg-dark'].forEach(c=>prev.classList.remove(c)); prev.classList.add('editor-bg-'+mode);}}
function v10FrameCountForSheet(sheet, t){
  const fw=Number(t?.frameWidth||64); return Math.max(1, Math.floor((sheet?.width||fw)/fw));
}
function v10TemplateDefaults(t, sheet){
  const base=v9TemplateDefaults(t); return Object.assign({namingMode:'automatic', frameCount:v10FrameCountForSheet(sheet,t)}, base);
}
function v9ReadTemplateOptions(){
  const t=selectedMapperTemplate(); const d=v10TemplateDefaults(t, selectedSheet());
  return {prefix:($('#tplPrefix')?.value||d.prefix||'walk').trim()||d.prefix||'walk', columnZeroRole:$('#tplZeroRole')?.value||d.columnZeroRole||'base_and_frame', scale:$('#tplScale')?.value||d.scale||'none', duration:Number($('#tplDuration')?.value||d.duration||120), namingMode:$('#tplNamingMode')?.value||d.namingMode||'automatic'};
}
function v8TemplateOptionHtml(t, sheet){
  const d=v9OptionsFor(t, sheet);
  return `<details class="advanced-box v7-options" ${state.templateOptionsOpen?'open':''}><summary>Advanced template options</summary>
    <div class="field"><label>Move type / prefix</label><input class="input" id="tplPrefix" value="${esc(d.prefix||'walk')}" placeholder="walk, run, swim, bike"></div>
    <div class="field"><label>Naming mode</label><select class="select" id="tplNamingMode"><option value="automatic" ${(d.namingMode||'automatic')==='automatic'?'selected':''}>Automatic: prefix_direction_index</option><option value="manual" ${(d.namingMode||'automatic')==='manual'?'selected':''}>Manual per cell later</option></select></div>
    <div class="field"><label>Column 0 role</label><select class="select" id="tplZeroRole">
      ${[['base_and_frame','Base sprite + animation frame'],['animation_only','Animation frame only'],['training_only','Training sprite only']].map(([v,n])=>`<option value="${v}" ${v===(d.columnZeroRole||'base_and_frame')?'selected':''}>${n}</option>`).join('')}
    </select></div>
    <div class="field"><label>Scale before slicing</label><select class="select" id="tplScale">
      ${[['none','None'],['down2','50% / down by 2'],['up2','200% / up by 2']].map(([v,n])=>`<option value="${v}" ${v===(d.scale||'none')?'selected':''}>${n}</option>`).join('')}
    </select></div>
    <div class="field"><label>Frame duration</label><input class="input" id="tplDuration" type="number" min="16" value="${Number(d.duration||120)}"></div>
    <div class="row"><button class="btn small" id="manageTemplates" type="button">Manage templates</button><button class="btn small" id="resetTplDefaults" type="button">Reset defaults</button></div>
    <p class="tiny">Automatic naming creates labels such as <b>${esc(d.prefix||'move')}_left_0</b>. Use manual mode for unusual sheets.</p>
  </details>`;
}
async function previewTemplatePlan(){
  v9SaveDraft(); const sheet=selectedSheet(); const templateId=$('#tplSelect')?.value; if(!sheet||!templateId)return; const options=v9ReadTemplateOptions(); const plan=await postPlan(templateId, sheet.id, options);
  const log=$('#prepareLog'); if(log) log.textContent=`Template plan: ${plan.templateName}\nMove type: ${plan.options.prefix}\nNaming: ${plan.options.namingMode||'automatic'}\nColumn 0: ${plan.options.columnZeroRole}\nOutput: ${plan.outputSize.width||'?'}×${plan.outputSize.height||'?'}\nCell: ${plan.frameWidth}×${plan.frameHeight}\nSprites: ${plan.spriteCount}\nAnimations: ${plan.animationCount}\n\nAnimations:\n${(plan.animations||[]).map(a=>`- ${a.name}: ${a.frameCount} frames`).join('\n')}`;
  return plan;
}
async function openTemplatePreviewModal(){
  const plan=await previewTemplatePlan(); if(!plan)return; const html=`<div class="modal-backdrop"><div class="modal card big"><div class="modal-head"><h3>Template preview</h3><button class="btn small" id="closeTplPreview">Close</button></div>
    <p class="tiny">This is what the template will create before you commit it.</p>
    <div class="section-title">Resulting animation grid</div>
    <div class="template-grid-preview">${(plan.animations||[]).map(a=>`<div class="template-row-preview"><b>${esc(a.name)}</b>${(a.frames||[]).map(f=>`<span class="tag">${esc(f.label||`${a.name}_${f.col}`)}</span>`).join('')}</div>`).join('')}</div>
    <div class="section-title">Playable animations to create</div>
    <div class="grid cols4">${(plan.animations||[]).map(a=>`<div class="card sidecard"><h3>${esc(a.name)}</h3><p>${a.frameCount} frames · ${plan.frameWidth}×${plan.frameHeight}</p><button class="btn small" disabled>Preview after Apply</button></div>`).join('')}</div>
  </div></div>`; document.body.insertAdjacentHTML('beforeend',html); $('#closeTplPreview').onclick=()=>$('.modal-backdrop').remove();
}
function renderSheetMapper(){
  state.view='sheets'; state.sheetPanel='mapper';
  title('Sprite Sheet Mapper'); toolbar(`<button class="btn" id="backSheetFamilies">← Sheets</button><label class="btn primary">Import sheet<input id="sheetImport" type="file" accept="image/png" hidden></label><button class="btn good" id="saveSheet">Save</button><button class="btn" id="undoMapper">Undo</button><button class="btn" id="redoMapper">Redo</button><button class="btn" id="fitSheet">Fit</button><button class="btn" id="zoomOutSheet">−</button><button class="btn" id="zoomInSheet">＋</button><button class="btn" id="actualSheet">100%</button>`);
  const sheet=selectedSheet(); const sheets=state.project.sheets||[]; if(!sheet){renderSheets();return}
  const settings=sheetSettings(); const chars=state.project.characters||[]; const charId=sheet.characterId||state.selectedCharacter||chars[0]?.id||''; const tpl=selectedMapperTemplate(sheet); const existingImport=charId?((chars.find(c=>c.id===charId)?.sheetImports||[]).find(i=>i.sheetId===sheet.id && i.templateId===(sheet.templateId||tpl.id))):null;
  $('#view').innerHTML=`<div class="sheet-work clean-sheet-work v5-sheet-work">
    <div class="card canvas-panel checker" id="sheetStage"><canvas id="sheetCanvas" class="sheet-canvas"></canvas></div>
    <div class="card inspector sheet-inspector compact-inspector stack">
      <h3>Sheet workflow</h3>
      <div class="field"><label>Sheet version</label><select class="select" id="sheetSelect">${sheets.map(s=>`<option value="${s.id}" ${s.id===sheet.id?'selected':''}>${esc(s.name||s.id)} · ${esc(versionName(s))}</option>`).join('')}</select></div>
      <div class="step-card"><div class="step-label">Step 1</div><h4>Choose template</h4>
        <div class="field"><label>Template</label><select class="select" id="tplSelect">${(state.project.templates||[]).map(t=>`<option value="${t.id}" ${t.id===tpl.id?'selected':''}>${esc(t.name)}</option>`).join('')}</select></div>
        ${v7TemplateSummary(tpl)}${v8TemplateOptionHtml(tpl,sheet)}
        <div class="row"><button class="btn primary full" id="applyTemplate">Apply template</button><button class="btn" id="templatePreview">Preview</button></div>
        <div class="progress"><div class="bar" id="prepareBar"></div></div><pre class="terminal compact" id="prepareLog">Ready. Automatic naming uses the move type prefix. Manual naming remains available for odd sheets.</pre></div>
      <div class="step-card"><div class="step-label">Step 2</div><h4>Save sheet</h4>${sheetInfo(sheet)}<div class="numgrid slim">${['frameWidth','frameHeight','marginX','marginY','spacingX','spacingY'].map(k=>`<div class="field"><label>${k.replace('frame','frame ')}</label><input class="input mapnum" data-k="${k}" type="number" min="0" value="${settings[k]||0}"></div>`).join('')}</div><button class="btn good full" id="saveSheetLocal">Save sheet</button></div>
      <div class="step-card ${existingImport?'warn':''}"><div class="step-label">Step 3</div><h4>Populate character</h4><div class="field"><label>Character</label><select class="select" id="sheetCharacter">${chars.map(c=>`<option value="${c.id}" ${c.id===charId?'selected':''}>${esc(c.name)}</option>`).join('')}</select></div><p class="tiny" id="duplicateNote">${existingImport?'This sheet/template already populated this character. Use Replace only when rebuilding.':'Populate saves the sheet, then creates sprites and animations.'}</p><div class="row"><button class="btn good" id="attachSheet">Assign</button><button class="btn" id="openCharacter">Open character</button></div><div class="row"><button class="btn primary full" id="populateTemplate">Populate</button><button class="btn bad" id="replacePopulate">Replace</button></div><div class="progress"><div class="bar" id="populateBar"></div></div><pre class="terminal compact" id="populateLog">Waiting for assignment.</pre></div>
      <details class="advanced-box"><summary>Advanced manual tools</summary><div class="selected-cell-card"><canvas id="cellPreview" class="preview-canvas checker" width="96" height="96"></canvas><div><strong id="cellReadout">row 0, col 0</strong><p class="tiny">Optional one-off extraction.</p></div></div><div class="field"><label>Frame label</label><input class="input" id="cellLabel" placeholder="base_right or fishing_right" value="base_down"></div><div class="field"><label>Direction</label><select class="select" id="cellDirection">${['down','left','right','up','none'].map(d=>`<option value="${d==='none'?'':d}">${d}</option>`).join('')}</select></div><button class="btn full" id="extractCell">Extract selected cell only</button></details>
    </div></div>`;
  right(`<div class="sidecard card"><h3>Template naming</h3><p>Set the move type once, like bike or swim. Automatic mode creates labels like bike_down_0 and animations like bike_down.</p></div>`);
  $('#backSheetFamilies').onclick=()=>renderSheets(); $('#sheetImport').onchange=e=>uploadSheetFlow(e.target.files[0]); $('#sheetSelect').onchange=e=>{state.selectedSheet=e.target.value; state.mapperTemplateId=null; selectedCell={row:0,col:0}; state.sheetFit=true; renderSheetMapper();};
  $('#tplSelect').onchange=e=>{state.mapperTemplateId=e.target.value; renderSheetMapper();}; $$('.v7-options input,.v7-options select').forEach(el=>el.oninput=()=>{state.templateOptionsOpen=true; v9SaveDraft(); previewTemplatePlan().catch(()=>{});}); $('.v7-options')?.addEventListener('toggle',e=>{state.templateOptionsOpen=e.target.open}); $('#resetTplDefaults')?.addEventListener('click',()=>{const key=v9DraftKey(sheet,tpl.id); if(state.mapperDrafts) delete state.mapperDrafts[key]; renderSheetMapper();}); $$('.mapnum').forEach(i=>i.oninput=()=>{state.sheetFit=true;drawSheet();});
  $('#fitSheet').onclick=()=>{state.sheetFit=true;drawSheet()}; $('#actualSheet').onclick=()=>{state.sheetFit=false;state.sheetZoom=1;drawSheet()}; $('#zoomInSheet').onclick=()=>{state.sheetFit=false;state.sheetZoom=Math.min(8,state.sheetZoom*1.25);drawSheet()}; $('#zoomOutSheet').onclick=()=>{state.sheetFit=false;state.sheetZoom=Math.max(.1,state.sheetZoom/1.25);drawSheet()};
  $('#undoMapper').onclick=undoMapper; $('#redoMapper').onclick=redoMapper; $('#saveSheet').onclick=saveSheetMapping; $('#saveSheetLocal').onclick=saveSheetMapping; $('#attachSheet').onclick=saveAssignmentOnly; $('#openCharacter').onclick=()=>{state.selectedCharacter=$('#sheetCharacter').value;renderLibraryDetail();}; $('#applyTemplate').onclick=applySelectedTemplate; $('#templatePreview').onclick=openTemplatePreviewModal; $('#populateTemplate').onclick=()=>populateFromTemplate('block'); $('#replacePopulate').onclick=()=>{if(confirm('Replace existing sprites and animations from this sheet/template?'))populateFromTemplate('replace')}; $('#extractCell').onclick=extractSelectedCell; $('#manageTemplates')?.addEventListener('click',openTemplateManager);
  drawSheet(); previewTemplatePlan().catch(()=>{});
}

function openBehaviorModal(){
  const html=`<div class="modal-backdrop"><div class="modal card"><div class="modal-head"><h3>Create behavior action</h3>${modalCloseBtn('closeBeh')}</div><div class="field"><label>Name</label><input class="input" id="behName" value="Bike"></div><div class="field"><label>Move type / output prefix</label><input class="input" id="behPrefix" value="bike"></div><div class="field"><label>Frames per direction</label><input class="input" id="behFrames" type="number" min="1" value="4"></div><p class="tiny">Creates one behavior that trains base_down/base_left/base_right/base_up into prefix_direction_0..N.</p><button class="btn primary full" id="saveBeh">Create behavior</button></div></div>`;
  document.body.insertAdjacentHTML('beforeend',html); $('#closeBeh').onclick=()=>$('.modal-backdrop').remove(); $('#saveBeh').onclick=async()=>{const name=$('#behName').value.trim()||'Behavior'; const prefix=$('#behPrefix').value.trim()||name.toLowerCase(); await api('/api/behaviors/define',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,prefix,label:prefix,framesPerDirection:Number($('#behFrames').value||4)})}); $('.modal-backdrop').remove(); toast('Behavior created'); await refresh(); renderActions();};
}
function renderEditor(){
  title('Editor'); const chars=state.project.characters||[]; state.selectedCharacter=state.selectedCharacter||chars[0]?.id; const c=selectedCharacter(); const anims=animationsForCharacter(c?.id); const charSprites=spritesForCharacter(c?.id); const selectedAnim=anims.find(a=>a.id===state.selectedAnimation); const generated=state.project.generated.map(g=>({...g,characterName:'Generated'})); const pool=[...charSprites,...generated]; let sprite=pool.find(s=>s.id===state.selectedSprite)||charSprites[0]||generated[0]; if(selectedAnim&&selectedAnim.frames?.length){const fid=state.selectedAnimationFrame||selectedAnim.frames[0].spriteId; sprite=pool.find(s=>s.id===fid)||sprite; state.selectedSprite=sprite?.id;}
  toolbar(`<button class="btn good" id="editorQuickAnim" data-open-quick-anim>Quick anim</button><button class="btn primary" id="saveEdit">Save edited PNG</button><button class="btn" id="undoBtn">Undo</button><button class="btn" id="redoBtn">Redo</button><button class="btn" id="zoomOut">−</button><button class="btn" id="zoomIn">＋</button><button class="btn" id="toggleGrid">Grid</button><select class="select" id="bgMode"><option value="darkchecker">Dark checker</option><option value="lightchecker">Light checker</option><option value="clear">Clear</option><option value="light">Light</option><option value="dark">Dark</option></select>`);
  const assetOptions=[...charSprites.map(s=>`<option value="sprite:${s.id}" ${!selectedAnim&&sprite?.id===s.id?'selected':''}>Sprite — ${esc(s.label||s.name)}</option>`),...anims.map(a=>`<option value="anim:${a.id}" ${selectedAnim?.id===a.id?'selected':''}>Animation — ${esc(a.name)}</option>`),...generated.map(g=>`<option value="sprite:${g.id}" ${!selectedAnim&&sprite?.id===g.id?'selected':''}>Generated — ${esc(g.label||g.name)}</option>`)].join('');
  $('#view').innerHTML=`<div class="editor-layout"><div class="card tools">${[['pencil','✎','Pencil'],['eraser','⌫','Eraser'],['picker','⌖','Picker'],['fill','▰','Bucket']].map(([id,ic,txt])=>`<button class="tool ${id==='pencil'?'active':''}" title="${txt}" data-tool="${id}"><span class="tool-ico">${ic}</span><small>${txt}</small></button>`).join('')}</div><div class="card stage editor-bg-darkchecker" id="editorStage"><canvas id="pixCanvas" class="pix-canvas transparent-canvas"></canvas></div><div class="card inspector"><h3>Asset</h3><div class="field"><label>Character</label><select class="select" id="editChar">${chars.map(ch=>`<option value="${ch.id}" ${ch.id===c?.id?'selected':''}>${esc(ch.name)}</option>`).join('')}</select></div><div class="field"><label>Asset</label><select class="select" id="editAsset">${assetOptions}</select></div>${selectedAnim?animationEditorPanel(selectedAnim, c):''}<p class="tiny">${esc(sourceLabel(sprite))}</p><div class="section-title">Palette</div><div class="palette" id="palette"></div><div class="section-title">Preview</div><canvas id="animPreview" class="preview-canvas editor-bg-darkchecker" width="160" height="160"></canvas></div></div>`;
  right(`<div class="sidecard card"><h3>Animation editor</h3><p>Select an animation as the asset to reorder, remove, add, and edit individual frames.</p></div>
    <div class="sidecard card"><h3>Quick anim (.charbin)</h3><p>Batch-paint animations like <b>sleep</b> across all Pokémon in the library — frame 1, frame 2, save &amp; next.</p>
    <button type="button" class="btn good full" data-open-quick-anim>Open Quick anim</button></div>`);
  setupEditor(sprite);
  if (typeof bindQuickAnimEntrypoints === 'function') bindQuickAnimEntrypoints(document); $('#editChar').onchange=e=>{state.selectedCharacter=e.target.value;state.selectedSprite=null;state.selectedAnimation=null;renderEditor()}; $('#editAsset').onchange=e=>{const [kind,id]=e.target.value.split(':'); if(kind==='anim'){state.selectedAnimation=id; state.selectedAnimationFrame=null;} else {state.selectedAnimation=null; state.selectedSprite=id;} renderEditor()}; $('#bgMode').onchange=e=>setEditorBg(e.target.value); bindAnimationEditor(selectedAnim,c);
}
function animationEditorPanel(a,c){return `<div class="section-title">Animation timeline</div><div class="timeline-build">${(a.frames||[]).map((f,i)=>{const sp=(c.sprites||[]).find(s=>s.id===f.spriteId); return `<div class="frame-build ${state.selectedAnimationFrame===f.spriteId?'active':''}" data-frame="${i}"><span class="mini">${img(sp?.url)}</span><b>${esc(f.label||sp?.label||'frame')}</b><input class="input" data-dur="${i}" value="${f.duration||120}"><button class="btn small" data-left="${i}">←</button><button class="btn small" data-right="${i}">→</button><button class="btn small bad" data-rm="${i}">×</button></div>`}).join('')}</div><div class="field"><label>Add frame</label><select class="select" id="addFrameSelect">${(c.sprites||[]).map(s=>`<option value="${s.id}">${esc(s.label||s.name)}</option>`).join('')}</select></div><div class="row"><button class="btn" id="addFrameBtn">Add frame</button><button class="btn good" id="saveAnimEdit">Save animation</button></div>`}
function bindAnimationEditor(a,c){if(!a)return; let frames=JSON.parse(JSON.stringify(a.frames||[])); const rerender=()=>renderEditor(); $$('.frame-build').forEach(el=>el.onclick=e=>{if(e.target.tagName==='BUTTON'||e.target.tagName==='INPUT')return; const i=Number(el.dataset.frame); state.selectedAnimationFrame=frames[i].spriteId; rerender();}); $$('[data-dur]').forEach(inp=>inp.onchange=()=>{frames[Number(inp.dataset.dur)].duration=Number(inp.value||120); a.frames=frames;}); $$('[data-left]').forEach(b=>b.onclick=()=>{const i=Number(b.dataset.left); if(i>0){[frames[i-1],frames[i]]=[frames[i],frames[i-1]]; a.frames=frames; rerender();}}); $$('[data-right]').forEach(b=>b.onclick=()=>{const i=Number(b.dataset.right); if(i<frames.length-1){[frames[i+1],frames[i]]=[frames[i],frames[i+1]]; a.frames=frames; rerender();}}); $$('[data-rm]').forEach(b=>b.onclick=()=>{frames.splice(Number(b.dataset.rm),1); a.frames=frames; rerender();}); $('#addFrameBtn')?.addEventListener('click',()=>{const sid=$('#addFrameSelect').value; const sp=(c.sprites||[]).find(s=>s.id===sid); frames.push({spriteId:sid,label:sp?.label,duration:120}); a.frames=frames; rerender();}); $('#saveAnimEdit')?.addEventListener('click',async()=>{await api('/api/animation/'+a.id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({frames,name:a.name,loop:a.loop})}); toast('Animation saved'); await refresh(); renderEditor();});}

/* ---- v11 scale + behavior quality overrides ---- */
function v11Labels(){ return [...new Set((state.project.characters||[]).flatMap(c=>(c.sprites||[]).map(s=>s.label).filter(Boolean)))].sort(); }
function v11BehaviorPreviewFrame(b,d,i){ return (b.learnedFrames?.[d]||[])[i]; }
function v11CharacterById(id){ return (state.project.characters||[]).find(c=>c.id===id); }
function v11Sprite(c,label){ return (c?.sprites||[]).find(s=>s.label===label); }
function v11BehaviorLabels(b){ const dirs=b?.directions||['down','left','right','up']; const n=Number(b?.framesPerDirection||4); const prefix=b?.prefix||b?.label||'behavior'; return Object.fromEntries(dirs.map(d=>[d,Array.from({length:n},(_,i)=>`${prefix}_${d}_${i}`)])); }

function renderLibrary(){
  initSelectState();
  state.libraryPanel='list';
  title('Sprite workspace (legacy)');
  toolbar(`<span class="tag">workspace sprites — not .charbin</span><button class="btn" id="goCharbins">→ .charbin Characters</button><button class="btn primary" id="newChar">＋ New character</button><button class="btn good" id="batchCreate">Batch create</button><label class="btn">Import sprite<input id="spriteFile" type="file" accept="image/png" hidden></label><label class="btn">Import sheet<input id="sheetFile" type="file" accept="image/png" hidden></label>`);
  const chars=state.project.characters;
  const sel=isSelectMode('library');
  const list=chars.length?`<div class="grid cols3">${chars.map(c=>cardCharacter(c,{selectScope:sel?'library':null,selected:isSelected('library',c.id)})).join('')}</div>`:`<div class="empty"><strong>No characters yet.</strong><br/>Create one character, or batch-create many characters from walk sheets.</div>`;
  $('#view').innerHTML=`${bulkBar('library','characters')}${sectionHead('Characters','library')}${list}`;
  right(`<div class="sidecard card"><h3>Character library</h3><p>Click a card to open. × deletes. Select mode enables bulk delete.</p></div><div class="sidecard card"><h3>Project health</h3><p>${chars.length} characters<br>${state.project.sheets.length} sheets<br>${behaviorActions().length} behaviors</p></div>`);
  $('#newChar').onclick=async()=>{let name=prompt('Character name','CustomHero'); if(!name)return; await api('/api/character',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name})}); toast('Character created'); await refresh();};
  $('#batchCreate').onclick=openBatchCreateModal;
  $('#spriteFile').onchange=e=>uploadSpriteFlow(e.target.files[0]);
  $('#sheetFile').onchange=e=>uploadSheetFlow(e.target.files[0]);
  bindSelectMode('library', renderLibrary, bulkDeleteCharacters);
  $('#goCharbins')?.addEventListener('click', async()=>{ state.view='packages'; renderNav(); await renderPackagesView(); });
  $$('.character').forEach(el=>bindCardOpen(el, ()=>{ state.selectedCharacter=el.dataset.id; renderLibraryDetail(); }, 'library', el.dataset.id, renderLibrary));
  $$('[data-del-char]').forEach(b=>b.onclick=async e=>{ e.stopPropagation(); const ch=characterById(b.dataset.delChar); if(confirm(`Delete character "${ch?.name||'character'}"?`)){ await api('/api/character/'+b.dataset.delChar,{method:'DELETE'}); if(state.selectedCharacter===b.dataset.delChar) state.selectedCharacter=null; await refresh(); renderLibrary(); }});
}

function openBatchCreateModal(){
  const templates=state.project.templates||[];
  const html=`<div class="modal-backdrop"><div class="modal card big"><div class="modal-head"><h3>Batch create characters</h3>${modalCloseBtn('closeBatch')}</div>
    <div class="grid cols2"><div class="card sidecard stack"><h3>1. Sheets</h3><label class="dropzone">Drop/select walk sheets<input id="batchFiles" type="file" accept="image/png" multiple hidden></label><div id="batchFileList" class="tiny">No files selected.</div><h3>2. Template</h3><select class="select" id="batchTemplate">${templates.map(t=>`<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select><details><summary>Advanced options</summary><div class="field"><label>Move type / prefix</label><input class="input" id="batchPrefix" value="walk"></div><div class="field"><label>Column 0 role</label><select class="select" id="batchCol0"><option value="base_and_frame">Base + frame</option><option value="animation_only">Animation only</option><option value="training_only">Training only</option></select></div><div class="field"><label>Scale</label><select class="select" id="batchScale"><option value="down2">50% / 64→32</option><option value="none">None</option><option value="up2">200%</option></select></div></details></div>
    <div class="card sidecard stack"><h3>3. Naming preview</h3><p class="tiny">Default names use the sheet filename. After import, use the rename table below.</p><div id="batchPreview" class="rename-table tiny">Select files to preview names.</div><div class="progress spaced"><div class="bar" id="batchBar"></div></div><pre class="terminal compact" id="batchLog">Ready.</pre><button class="btn primary" id="runBatch">Create characters</button></div></div>
    <div class="section-title">Rename after import</div><div id="renameAfter" class="rename-table"></div>
  </div></div>`;
  document.body.insertAdjacentHTML('beforeend',html);
  let files=[];
  $('#closeBatch').onclick=()=>$('.modal-backdrop').remove();
  $('#batchFiles').onchange=e=>{files=[...e.target.files]; $('#batchFileList').textContent=`${files.length} files selected`; $('#batchPreview').innerHTML=files.slice(0,20).map(f=>`<div class="row"><span>${esc(f.name)}</span><span>→</span><b>${esc(f.name.replace(/\.[^.]+$/,''))}</b></div>`).join('')+(files.length>20?`<p>…and ${files.length-20} more</p>`:'');};
  $('#runBatch').onclick=async()=>{ if(!files.length){toast('Choose sheets first');return;} const fd=new FormData(); files.forEach(f=>fd.append('files',f)); fd.append('templateId',$('#batchTemplate').value); fd.append('nameMode','filename'); fd.append('optionsJson',JSON.stringify({prefix:$('#batchPrefix').value,columnZeroRole:$('#batchCol0').value,scale:$('#batchScale').value})); $('#batchBar').style.width='20%'; $('#batchLog').textContent=`Uploading and processing ${files.length} sheets…\n`; const out=await api('/api/batch/create-characters',{method:'POST',body:fd}); $('#batchBar').style.width='100%'; $('#batchLog').textContent+=`Created ${out.count} characters.\n`; $('#renameAfter').innerHTML=out.results.map(r=>`<div class="row rename-row" data-id="${r.characterId}"><span>${esc(r.characterName)}</span><input class="input" value="${esc(r.characterName)}"><span class="tag">${r.spriteCount} sprites</span></div>`).join('')+`<button class="btn good" id="saveBatchNames">Save names</button>`; $('#saveBatchNames').onclick=async()=>{const changes=$$('.rename-row').map(r=>({id:r.dataset.id,name:$('input',r).value})); await api('/api/batch/rename-characters',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({changes})}); toast('Names saved'); await refresh();}; await refresh(); };
}

function renderLibraryDetail(){
  initSelectState();
  state.libraryPanel='detail';
  const c=selectedCharacter(); if(!c){renderLibrary();return}
  title(c.name);
  toolbar(`<button class="btn" id="backLib">← Characters</button><label class="btn primary">Add sprite<input id="spriteFile2" type="file" accept="image/png" hidden></label><label class="btn">Add sheet<input id="sheetFile2" type="file" accept="image/png" hidden></label><button class="btn" id="openSheets">Map sheets</button><button class="btn bad" id="deleteChar">Delete</button>`);
  const sheets=state.project.sheets.filter(s=>(c.sheetIds||[]).includes(s.id) || s.characterId===c.id);
  const anims=(state.project.animations||[]).filter(a=>a.characterId===c.id);
  const extras=(c.sprites||[]).filter(s=>!(s.label||'').startsWith('base_'));
  const genBeh=c.generatedBehaviors||[];
  const sprSel=isSelectMode('charSprites'), animSel=isSelectMode('charAnims'), genSel=isSelectMode('charGenBeh');
  const genBehHtml=genBeh.map(r=>{
    const del=cardDeleteBtn(`Delete behavior ${r.behaviorName||r.behavior}`,'data-rmbeh',r.behavior);
    const chk=genSel?selectCheckbox('charGenBeh',r.behavior):'';
    return `<div class="card sidecard gen-beh-card selectable-card ${isSelected('charGenBeh',r.behavior)?'selected':''}" data-beh="${esc(r.behavior)}">${del}${chk}<h3>${esc(r.behaviorName||r.behavior)}</h3><p>${r.createdSpriteIds?.length||0} sprites · ${r.createdAnimationIds?.length||0} animations</p></div>`;
  }).join('');
  $('#view').innerHTML=`<div class="character-header card sidecard"><div><h3>${esc(c.name)}</h3><p>${(c.sprites||[]).length} sprites · ${anims.length} animations · ${sheets.length} sheets · ${genBeh.length} generated behaviors</p></div><button class="btn" id="renameChar">Rename</button></div>
    ${bulkBar('charSprites','sprites')}${bulkBar('charAnims','animations')}${bulkBar('charGenBeh','behaviors')}
    ${sectionHead('Generated behaviors','charGenBeh')}
    <div class="grid cols3">${genBehHtml||'<div class="empty">Generated behaviors appear here after Generate → Behavior.</div>'}</div>
    ${sectionHead('Base sprites','charSprites')}
    <div class="grid cols4">${['base_down','base_left','base_right','base_up'].map(l=>{const s=(c.sprites||[]).find(x=>x.label===l); return spriteSlot(c,l,{selectScope:sprSel&&s?'charSprites':null,selected:s&&isSelected('charSprites',s.id)});}).join('')}</div>
    ${sectionHead('Animations','charAnims')}
    <div class="grid cols4">${anims.map(a=>animationCard(a,{selectScope:animSel?'charAnims':null,selected:isSelected('charAnims',a.id)})).join('')||'<div class="empty">No animations yet.</div>'}</div>
    ${sectionHead('Extra frames','charSprites')}
    <div class="grid cols4">${extras.map(s=>spriteTile(s,{selectScope:sprSel?'charSprites':null,selected:isSelected('charSprites',s.id)})).join('')||'<div class="empty">No extra frames yet.</div>'}</div>
    <div class="section-title">Attached sheets</div><div class="grid cols3">${sheets.map(sheetTile).join('')||'<div class="empty">No sheets attached yet.</div>'}</div>`;
  right(`<div class="sidecard card"><h3>Character detail</h3><p>Click sprites/animations to edit. × deletes. Select mode enables bulk delete.</p></div>`);
  $('#backLib').onclick=()=>renderLibrary();
  $('#openSheets').onclick=()=>{state.view='sheets';renderNav();renderSheets();};
  $('#spriteFile2').onchange=e=>uploadSpriteFlow(e.target.files[0], c.id);
  $('#sheetFile2').onchange=e=>uploadSheetFlow(e.target.files[0], c.id);
  $('#renameChar').onclick=async()=>{const name=prompt('New character name',c.name); if(name){await api('/api/character/'+c.id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({name})}).catch(async()=>{c.name=name; await api('/api/project',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(state.project)});}); await refresh(); renderLibraryDetail();}};
  $('#deleteChar').onclick=async()=>{if(confirm('Delete this character record?')){await api('/api/character/'+c.id,{method:'DELETE'});state.selectedCharacter=null;await refresh();}};
  bindSelectMode('charSprites', renderLibraryDetail, ids=>bulkDeleteSprites(c.id, ids));
  bindSelectMode('charAnims', renderLibraryDetail, bulkDeleteAnimations);
  bindSelectMode('charGenBeh', renderLibraryDetail, ids=>bulkDeleteGenBehaviors(c.id, ids));
  $$('[data-delete-sprite]').forEach(b=>b.onclick=async e=>{ e.stopPropagation(); const sp=(c.sprites||[]).find(s=>s.id===b.dataset.deleteSprite); await deleteCharacterSprite(c.id, sp); renderLibraryDetail(); });
  $$('[data-delete-anim]').forEach(b=>b.onclick=async e=>{ e.stopPropagation(); const a=anims.find(x=>x.id===b.dataset.deleteAnim); await deleteCharacterAnimation(a); renderLibraryDetail(); });
  $$('[data-rmbeh]').forEach(b=>b.onclick=async e=>{ e.stopPropagation(); if(confirm('Remove this generated behavior, including its sprites and animations?')){await api(`/api/character/${c.id}/behaviors/${encodeURIComponent(b.dataset.rmbeh)}`,{method:'DELETE'}); toast('Behavior removed'); await refresh(); renderLibraryDetail();}});
  $$('.sprite-tile').forEach(t=>{
    if(!t.dataset.id) return;
    bindCardOpen(t, ()=>{ state.selectedSprite=t.dataset.id; state.view='editor'; renderNav(); renderEditor(); }, 'charSprites', t.dataset.id, renderLibraryDetail);
  });
  $$('.gen-beh-card').forEach(el=>{
    bindCardOpen(el, ()=>openGeneratedBehaviorModal(c, el.dataset.beh), 'charGenBeh', el.dataset.beh, renderLibraryDetail);
  });
  $$('.animation-card').forEach(el=>{
    bindCardOpen(el, ()=>{ state.selectedCharacter=c.id; state.selectedAnimation=el.dataset.aid; state.view='editor'; renderNav(); renderEditor(); }, 'charAnims', el.dataset.aid, renderLibraryDetail);
  });
  hydrateAnimationCards();
}

function openGeneratedBehaviorModal(c,label){
  const record=(c.generatedBehaviors||[]).find(r=>r.behavior===label)||{}; const sprites=(c.sprites||[]).filter(s=>(record.createdSpriteIds||[]).includes(s.id)); const anims=(state.project.animations||[]).filter(a=>(record.createdAnimationIds||[]).includes(a.id));
  const html=`<div class="modal-backdrop"><div class="modal card big"><div class="modal-head"><h3>${esc(label)} for ${esc(c.name)}</h3>${modalCloseBtn('closeGenBeh')}</div><div class="stats-grid"><div><b>${sprites.length}</b><span>sprites</span></div><div><b>${anims.length}</b><span>animations</span></div><div><b>${fmtTime(record.createdAt)}</b><span>generated</span></div></div><div class="grid cols4">${sprites.slice(0,32).map(s=>`<div class="mini">${img(s.url)}</div>`).join('')}</div><div class="row modal-actions"><button class="btn" id="retryBeh">Retry in Generate</button><button class="btn good" id="exportBeh">Export sheet</button><button class="btn bad" id="removeBeh">Remove behavior</button></div></div></div>`;
  document.body.insertAdjacentHTML('beforeend',html); $('#closeGenBeh').onclick=()=>$('.modal-backdrop').remove(); $('#retryBeh').onclick=()=>{state.view='generate';state.generateMode='behavior';state.selectedCharacter=c.id;state.selectedBehavior=label;$('.modal-backdrop').remove();renderNav();renderGenerate();}; $('#exportBeh').onclick=()=>{location.href=`/api/export/behavior-sheet/${c.id}/${encodeURIComponent(label)}?scale=1`;}; $('#removeBeh').onclick=async()=>{if(confirm('Remove sprites and animations for this behavior?')){await api(`/api/character/${c.id}/behaviors/${encodeURIComponent(label)}`,{method:'DELETE'}); $('.modal-backdrop').remove(); toast('Removed'); await refresh(); renderLibraryDetail();}};
}

function behaviorActions(){return (state.project.actions||[]).filter(a=>a.type==='behavior')}
function singleActions(){
  const behaviors=behaviorActions(); const owned=new Set();
  behaviors.forEach(b=>{ const labs=v11BehaviorLabels(b); Object.values(labs).flat().forEach(l=>owned.add(l)); });
  return (state.project.actions||[]).filter(a=>a.type!=='behavior' && !a.ownerBehaviorId && !owned.has(a.label));
}
function v12EligibleSources(src){
  return {ready:src.ready||[], incomplete:src.incomplete||[], excludedGenerated:src.excludedGenerated||[]};
}
function v12StatRows(rows){
  return `<div class="stat-rows">${rows.map(([k,v])=>`<div><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}</div>`;
}

/* --- v12.5 focused animation preview repair --- */
function v125SpritePool(){
  const chars = state.project?.characters || [];
  const generated = state.project?.generated || [];
  return chars.flatMap(c => (c.sprites || []).map(s => ({...s, characterId:c.id, characterName:c.name})))
    .concat(generated.map(g => ({...g, characterId:g.characterId || 'generated', characterName:g.characterName || 'Generated'})));
}
function v125FindSpriteForFrame(animation, frame, index=0){
  const pool = v125SpritePool();
  if(!frame) return null;
  if(frame.spriteId){
    const byId = pool.find(s => s.id === frame.spriteId);
    if(byId) return byId;
  }
  const characterId = animation?.characterId || frame.characterId;
  if(frame.label){
    const byLabelSameChar = pool.find(s => s.characterId === characterId && s.label === frame.label);
    if(byLabelSameChar) return byLabelSameChar;
    const byLabelAny = pool.find(s => s.label === frame.label);
    if(byLabelAny) return byLabelAny;
  }
  if(frame.url || frame.dataUrl) return {url: frame.url || frame.dataUrl, label: frame.label || `frame ${index}`};
  if(animation?.name && characterId){
    const candidates = [
      `${animation.name}_${index}`,
      `${animation.name}_${String(index).padStart(2,'0')}`,
      `${animation.name}_${index+1}`,
      `${animation.name}_${String(index+1).padStart(2,'0')}`,
    ];
    return pool.find(s => s.characterId === characterId && candidates.includes(s.label)) || null;
  }
  return null;
}
function v125FrameUrl(animation, frame, index=0){
  if(!frame) return '';
  if(typeof frame === 'string') return frame.startsWith('/asset/') || frame.startsWith('data:') ? frame : '';
  if(frame.url || frame.dataUrl) return frame.url || frame.dataUrl;
  const sp = v125FindSpriteForFrame(animation, frame, index);
  return sp?.url || '';
}
function v12FrameUrl(ref){
  if(!ref) return '';
  if(typeof ref === 'string') return ref.startsWith('/asset/') || ref.startsWith('data:') ? ref : '';
  if(ref.url || ref.dataUrl) return ref.url || ref.dataUrl;
  if(ref.spriteId || ref.label) return v125FrameUrl({characterId:ref.characterId}, ref, 0);
  return '';
}
function playAnimationOnCanvas(animation, canvas){
  if(!animation || !canvas) return () => {};
  const frames = (animation.frames || []).filter(Boolean);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  let frameIndex = 0;
  let stopped = false;
  let token = 0;
  canvas.dataset.animating = animation.id || animation.name || 'animation';
  const clearAndMessage = (message) => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.font = '11px system-ui, -apple-system, Segoe UI, sans-serif';
    ctx.fillStyle = 'rgba(226,235,255,.82)';
    ctx.textAlign = 'center';
    ctx.fillText(message, canvas.width / 2, canvas.height / 2);
    ctx.restore();
  };
  const drawFrame = () => {
    if(stopped) return;
    if(!frames.length){ clearAndMessage('no frames'); return; }
    const currentToken = ++token;
    const f = frames[frameIndex % frames.length];
    const url = v125FrameUrl(animation, f, frameIndex % frames.length);
    frameIndex = (frameIndex + 1) % frames.length;
    const delay = Number(f.duration || animation.duration || 140);
    if(!url){
      clearAndMessage('missing frame');
      setTimeout(drawFrame, delay);
      return;
    }
    const im = new Image();
    im.onload = () => {
      if(stopped || currentToken !== token) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingEnabled = false;
      const scale = Math.max(1, Math.floor(Math.min(canvas.width / im.width, canvas.height / im.height)));
      const w = im.width * scale;
      const h = im.height * scale;
      ctx.drawImage(im, Math.floor((canvas.width - w) / 2), Math.floor((canvas.height - h) / 2), w, h);
      setTimeout(drawFrame, delay);
    };
    im.onerror = () => { if(!stopped){ clearAndMessage('bad image'); setTimeout(drawFrame, delay); } };
    im.src = url;
  };
  drawFrame();
  return () => { stopped = true; };
}
function hydrateAnimationCards(){
  $$('.animation-card').forEach(card => {
    const animation = (state.project?.animations || []).find(a => a.id === card.dataset.aid);
    const canvas = $('canvas', card);
    if(canvas) playAnimationOnCanvas(animation, canvas);
  });
  $$('[data-playanim]').forEach(b => b.onclick = (event) => {
    event.stopPropagation();
    state.selectedAnimation = b.dataset.playanim;
    state.view = 'editor';
    renderNav();
    renderEditor();
  });
}
function v12AnimationStrip(frames=[], opts={}){
  const title = opts.title ? `<h3>${esc(opts.title)}</h3>` : '';
  const animation = {characterId: opts.characterId, name: opts.title || '', frames};
  const cells = (frames || []).map((f,i) => {
    const url = v125FrameUrl(animation, f, i) || v12FrameUrl(f);
    return `<div class="anim-frame-cell ${url ? '' : 'missing'}">${url ? img(url) : 'missing'}<span>${esc(f.label || String(i))}</span></div>`;
  }).join('');
  return `<div class="v12-anim-preview">${title}<div class="sprite-strip anim-strip">${cells || '<div class="empty tiny">No frames</div>'}</div></div>`;
}

initSpmkTerminal();
load();
