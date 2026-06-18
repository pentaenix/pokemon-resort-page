/* Export wizard layout — v13 */
function renderExport(){
  title('Export');
  toolbar(`<button class="btn" onclick="location.href='/api/export/project'">Download backup</button>`);
  const chars=state.project.characters||[];
  state.exportMode=state.exportMode||'single';
  const c=selectedCharacter()||chars[0];
  const behaviors=behaviorActions();
  const sprites=(c?.sprites||[]).filter(s=>!(s.label||'').startsWith('base_') || true);
  const modes=[['single','Single sprite'],['animation','Animation frames'],['behavior','Behavior sheet'],['character','Character sheet'],['backup','Project backup']];
  const mode=state.exportMode;
  const step=(n, title, body, active)=>`<div class="export-step card sidecard ${active?'active':''}"><div class="export-step-num">${n}</div><h3>${esc(title)}</h3>${body}</div>`;
  const modeBody=`<div class="export-modes">${modes.map(([id,label])=>`<button type="button" class="btn ${mode===id?'primary':''}" data-emode="${id}">${esc(label)}</button>`).join('')}</div>`;
  let sourceBody='', layoutBody='', previewBody='';
  if(mode==='single'){
    sourceBody=`<div class="field"><label>Character</label><select class="select" id="exportChar">${chars.map(ch=>`<option value="${ch.id}" ${ch.id===c?.id?'selected':''}>${esc(ch.name)}</option>`).join('')}</select></div><div class="field"><label>Sprite</label><select class="select" id="exportSprite">${(c?.sprites||[]).map(s=>`<option value="${s.id}">${esc(s.label||s.name)}</option>`).join('')}</select></div>`;
    layoutBody=`<div class="field"><label>Scale</label><select class="select" id="exportScale"><option value="1">1×</option><option value="2">2×</option><option value="3">3×</option><option value="4">4×</option></select></div><div class="field"><label>Background</label><select class="select" id="exportBg"><option value="transparent">Transparent</option><option value="light">Light</option><option value="dark">Dark</option></select></div>`;
    previewBody=`<canvas id="exportPreviewCanvas" width="192" height="192" class="editor-bg-darkchecker export-preview-canvas"></canvas><p class="tiny" id="exportOutMeta">Output: PNG · 1×</p><button class="btn primary" id="exportSingleBtn">Export PNG</button>`;
  } else if(mode==='behavior'){
    sourceBody=`<div class="field"><label>Character</label><select class="select" id="exportChar">${chars.map(ch=>`<option value="${ch.id}" ${ch.id===c?.id?'selected':''}>${esc(ch.name)}</option>`).join('')}</select></div><div class="field"><label>Behavior</label><select class="select" id="exportBehaviorSel">${behaviors.map(b=>`<option value="${b.label}">${esc(b.name||b.label)}</option>`).join('')}</select></div>`;
    layoutBody=`<div class="field"><label>Layout</label><select class="select" id="exportLayout"><option value="behavior">Match behavior layout</option></select></div><div class="field"><label>Scale</label><select class="select" id="exportScale"><option value="1">1×</option><option value="2">2×</option><option value="3">3×</option><option value="4">4×</option></select></div><div class="field"><label>Background</label><select class="select" id="exportBg"><option value="transparent">Transparent</option></select></div><p class="tiny">Cell size follows behavior frame size.</p>`;
    previewBody=`<canvas id="exportPreviewCanvas" width="256" height="256" class="editor-bg-darkchecker export-preview-canvas"></canvas><p class="tiny" id="exportOutMeta">Output: behavior sheet PNG</p><button class="btn primary" id="downloadBehavior">Export PNG</button>`;
  } else if(mode==='backup'){
    sourceBody=`<p class="tiny">Download a zip of metadata, assets, learned overlays, and generated sprites.</p>`;
    layoutBody=`<p class="tiny">No layout options for project backup.</p>`;
    previewBody=`<button class="btn primary full" onclick="location.href='/api/export/project'">Export .zip</button>`;
  } else {
    sourceBody=`<p class="tiny">${mode==='animation'?'Export animation frame sequences.':'Export full character sprite sheets.'} Use behavior or single modes for focused exports.</p>`;
    layoutBody=`<div class="field"><label>Scale</label><select class="select" id="exportScale"><option value="1">1×</option></select></div>`;
    previewBody=`<p class="tiny">Coming soon — use behavior sheet or single sprite export.</p>`;
  }
  $('#view').innerHTML=`<div class="export-wizard">${step(1,'Output type',modeBody,true)}${step(2,'Source',sourceBody, true)}${step(3,'Layout and scale',layoutBody, true)}${step(4,'Preview',`<div class="export-preview-wrap">${previewBody}</div>`, true)}</div>`;
  right(`<div class="sidecard card"><h3>Export</h3><p>Each step uses consistent card spacing. Preview stays near the export button.</p></div>`);
  $$('[data-emode]').forEach(b=>b.onclick=()=>{ state.exportMode=b.dataset.emode; renderExport(); });
  const exportChar=$('#exportChar'); if(exportChar) exportChar.addEventListener('change', e=>{ state.selectedCharacter=e.target.value; renderExport(); });
  const updateSinglePreview=()=>{
    const spriteSel=$('#exportSprite'), scaleSel=$('#exportScale'), meta=$('#exportOutMeta'), canvas=$('#exportPreviewCanvas');
    const sp=(c?.sprites||[]).find(s=>s.id===(spriteSel?spriteSel.value:''));
    if(sp && canvas) drawPreviewCanvas(canvas, sp.url, 'editor-bg-darkchecker');
    const sc=(scaleSel&&scaleSel.value)||1;
    if(meta) meta.textContent=`Output: ${(sp?.width||32)*sc}×${(sp?.height||32)*sc} PNG · ${sc}×`;
  };
  const exportSprite=$('#exportSprite'); if(exportSprite) exportSprite.addEventListener('change', updateSinglePreview);
  const exportScale=$('#exportScale'); if(exportScale) exportScale.addEventListener('change', updateSinglePreview);
  if(mode==='single') updateSinglePreview();
  const exportSingleBtn=$('#exportSingleBtn'); if(exportSingleBtn) exportSingleBtn.addEventListener('click',()=>{
    const sp=(c?.sprites||[]).find(s=>s.id===$('#exportSprite').value);
    if(sp&&sp.url) location.href=sp.url;
    else toast('Choose a sprite');
  });
  const downloadBehavior=$('#downloadBehavior'); if(downloadBehavior) downloadBehavior.onclick=()=>{
    const charEl=$('#exportChar'), behEl=$('#exportBehaviorSel'), scaleEl=$('#exportScale');
    const cid=(charEl&&charEl.value)||c?.id, bl=behEl&&behEl.value, sc=(scaleEl&&scaleEl.value)||1;
    if(!cid||!bl){ toast('Choose character and behavior'); return; }
    location.href=`/api/export/behavior-sheet/${cid}/${encodeURIComponent(bl)}?scale=${sc}`;
  };
}
