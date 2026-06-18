/* Shared modal shell, stat cards, chip pickers — v13 UI polish */
function modalCloseBtn(id='modalClose'){
  return `<button type="button" class="btn small modal-close" id="${id}" title="Close" aria-label="Close">×</button>`;
}
function modalHead(title){
  return `<div class="modal-head"><h3>${title}</h3>${modalCloseBtn()}</div>`;
}
function modalFoot(left='', right=''){
  return `<div class="modal-foot"><div class="modal-foot-left">${left}</div><div class="modal-foot-right">${right}</div></div>`;
}
function statCards(rows){
  return `<div class="stat-cards">${(rows||[]).map(([k,v])=>`<div class="stat-card"><span class="stat-card-label">${esc(k)}</span><b class="stat-card-value">${esc(String(v))}</b></div>`).join('')}</div>`;
}
function mountModal(html, opts={}){
  const backdrop=document.createElement('div');
  backdrop.className='modal-backdrop';
  backdrop.innerHTML=html;
  document.body.appendChild(backdrop);
  const root=$('.modal', backdrop);
  let dirty=!!opts.dirty;
  const close=()=>{ backdrop.remove(); document.removeEventListener('keydown', onKey); };
  const tryClose=()=>{
    if(dirty && opts.warnDirty!==false && !confirm('Discard unsaved changes?')) return;
    close();
  };
  const onKey=(e)=>{ if(e.key==='Escape') tryClose(); };
  document.addEventListener('keydown', onKey);
  const closeBtn=$('.modal-close', backdrop);
  if(closeBtn) closeBtn.onclick=tryClose;
  if(opts.backdropClose) backdrop.onclick=(e)=>{ if(e.target===backdrop) tryClose(); };
  root?.querySelectorAll('input,textarea,select').forEach(el=>{
    el.addEventListener('input', ()=>{ dirty=true; });
    el.addEventListener('change', ()=>{ dirty=true; });
  });
  return {backdrop, root, close, tryClose, markDirty:()=>{ dirty=true; }, setDirty:(v)=>{ dirty=!!v; }};
}
function refChipHtml(selected=[]){
  return (selected||[]).map(l=>`<span class="label-chip" data-label="${esc(l)}">${esc(l)}<button type="button" class="chip-rm" data-rm="${esc(l)}">×</button></span>`).join('')+`<button type="button" class="btn small" id="addRefChip">+ Add reference</button>`;
}
function bindRefChipPicker(root, selected, allLabels, onChange){
  const field=$('#refChipField', root);
  if(!field) return {getSelected:()=>selected.slice(), setSelected:(v)=>{ selected=v.slice(); }};
  const render=()=>{ field.innerHTML=refChipHtml(selected); bind(); };
  const bind=()=>{
    $$('.chip-rm', field).forEach(b=>b.onclick=(e)=>{ e.stopPropagation(); selected=selected.filter(x=>x!==b.dataset.rm); onChange(selected); render(); });
    const addBtn=$('#addRefChip', field);
    if(addBtn) addBtn.onclick=()=>openLabelPickerModal(allLabels, selected, picks=>{ selected=picks; onChange(selected); render(); });
  };
  bind();
  return {getSelected:()=>selected.slice(), setSelected:(v)=>{ selected=v.slice(); render(); }};
}
function bindModalActions(root, handlers){
  if(!root) return;
  root.addEventListener('click', e=>{
    const btn=e.target.closest('[data-action]');
    if(!btn || !root.contains(btn)) return;
    const fn=handlers[btn.dataset.action];
    if(fn) fn(e, btn);
  });
}
function trainingProgressHtml(visible, pct=0, text=''){
  if(!visible) return '';
  return `<div class="training-progress modal-section"><h4>Training progress</h4><div class="progress spaced"><div class="bar" style="width:${pct}%"></div></div><p class="tiny progress-text">${esc(text||'Working…')}</p></div>`;
}
function openLabelPickerModal(allLabels, current, onDone){
  const avail=allLabels.filter(l=>!current.includes(l));
  const html=`<div class="modal card"><div class="modal-head"><h3>Select reference labels</h3>${modalCloseBtn()}</div><div class="label-picker-list">${avail.map(l=>`<label class="label-pick-row"><input type="checkbox" value="${esc(l)}"> ${esc(l)}</label>`).join('')||'<p class="tiny">All labels already selected.</p>'}</div>${modalFoot('', `<button class="btn" id="pickCancel">Cancel</button><button class="btn primary" id="pickAdd">Add selected</button>`)}</div>`;
  const m=mountModal(html,{backdropClose:true});
  $('#pickCancel', m.root).onclick=m.close;
  $('.modal-close', m.root).onclick=m.close;
  $('#pickAdd', m.root).onclick=()=>{
    const add=$$('input[type=checkbox]:checked', m.root).map(x=>x.value);
    onDone([...current, ...add]);
    m.close();
  };
}
function trainingConsistency(ready, incomplete){
  if(ready>=5 && incomplete<=1) return 'High';
  if(ready>=2) return 'Medium';
  return 'Low';
}
function drawPreviewCanvas(canvas, url, bgClass='editor-bg-darkchecker'){
  if(!canvas||!url) return;
  canvas.classList.remove('checker','editor-bg-darkchecker','editor-bg-lightchecker','editor-bg-clear','editor-bg-light','editor-bg-dark');
  canvas.classList.add(bgClass);
  const ctx=canvas.getContext('2d');
  ctx.imageSmoothingEnabled=false;
  const im=new Image();
  im.onload=()=>{
    ctx.clearRect(0,0,canvas.width,canvas.height);
    const sc=Math.max(1, Math.floor(Math.min(canvas.width/im.width, canvas.height/im.height)));
    const w=im.width*sc, h=im.height*sc;
    ctx.drawImage(im, Math.floor((canvas.width-w)/2), Math.floor((canvas.height-h)/2), w, h);
  };
  im.src=url;
}
