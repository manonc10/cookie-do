/* Cookie Do 5.1 : plusieurs minuteurs, restes d'ingrédients, mes quantités, import par lien. */

/* ---- minuteurs : chacun a son échéance, ils continuent même si le téléphone met l'onglet en veille ---- */
let timers=[], timerSeq=0, timerTick=null;
function ringTimer(){
  try{ const ac=new(window.AudioContext||window.webkitAudioContext)(); [0,.5,1].forEach(t=>{ const o=ac.createOscillator(),g=ac.createGain(); o.connect(g); g.connect(ac.destination); o.frequency.value=880; g.gain.setValueAtTime(.001,ac.currentTime+t); g.gain.exponentialRampToValueAtTime(.3,ac.currentTime+t+.05); g.gain.exponentialRampToValueAtTime(.001,ac.currentTime+t+.4); o.start(ac.currentTime+t); o.stop(ac.currentTime+t+.45); }); }catch(e){}
  if(navigator.vibrate) navigator.vibrate([200,100,200,100,200]);
}
function timerLeft(t){ return t.running?Math.max(0,Math.ceil((t.end-Date.now())/1000)):t.left; }
function fmtClock(s){ const h=Math.floor(s/3600),m=Math.floor(s%3600/60),x=s%60; return (h?h+':'+String(m).padStart(2,'0'):String(m).padStart(2,'0'))+':'+String(x).padStart(2,'0'); }
function renderTimers(){
  const box=$('#timerPop');
  box.classList.toggle('open',timers.length>0);
  document.body.classList.toggle('has-timers',timers.length>0);
  box.innerHTML=timers.map(t=>`<div class="tp-one${t.done?' done':''}" data-t="${t.id}"><div class="tp-info"><div class="tp-lbl">${t.done?'Terminé · ':''}${t.label}</div><div class="tp-time">${fmtClock(t.done?0:timerLeft(t))}</div></div>
    <div class="tp-row">${t.done?'':`<button data-a="toggle" type="button">${t.running?'Pause':'Reprendre'}</button>`}<button data-a="stop" type="button">${t.done?'OK':'Arrêter'}</button></div></div>`).join('');
}
function tickTimers(){
  let changed=false;
  timers.forEach(t=>{ if(t.running&&timerLeft(t)<=0){ t.running=false; t.done=true; t.left=0; changed=true; toast('⏰ '+t.label+' : c’est prêt !'); ringTimer(); } });
  if(changed) renderTimers();
  timers.forEach(t=>{ const el=document.querySelector(`.tp-one[data-t="${t.id}"] .tp-time`); if(el&&!t.done) el.textContent=fmtClock(timerLeft(t)); });
  if(!timers.some(t=>t.running)){ clearInterval(timerTick); timerTick=null; }
}
function timerRecipeName(){
  if(currentCook) return byId(currentCook).title;
  const h=$('#sheetBg').classList.contains('open')&&document.querySelector('#sheet .rd h2'); return h?h.textContent:'';
}
startTimer=function(secs,label){
  const name=timerRecipeName(), full=(label||'Minuteur')+(name?' · '+name:'');
  timers=timers.filter(t=>t.label!==full);
  timers.push({id:++timerSeq,label:full,left:secs,end:Date.now()+secs*1000,running:true,done:false});
  renderTimers(); if(!timerTick) timerTick=setInterval(tickTimers,1000);
  toast('Minuteur lancé : '+fmtSecs(secs));
};
$('#timerPop').onclick=e=>{
  const b=e.target.closest('button'); if(!b) return;
  const t=timers.find(x=>x.id===+b.closest('.tp-one').dataset.t); if(!t) return;
  if(b.dataset.a==='stop') timers=timers.filter(x=>x!==t);
  else if(t.running){ t.left=timerLeft(t); t.running=false; }
  else { t.end=Date.now()+t.left*1000; t.running=true; if(!timerTick) timerTick=setInterval(tickTimers,1000); }
  renderTimers();
};
document.addEventListener('visibilitychange',()=>{ if(!document.hidden&&timers.length) tickTimers(); });
renderTimers();

/* ---- restes : une boîte ou un sachet entamé, et les recettes qui le finissent ---- */
const LEFT_UNITS=new Set(['boîte','sachet']);
function leftovers(entries){
  const sum={};
  entries.forEach(([r,f])=>r.ingredients.forEach(([q,u,item])=>{
    if(q==null||!LEFT_UNITS.has(canonUnit(u))) return;
    const base=baseIngredientName(item)||item, k=norm(base);
    (sum[k]=sum[k]||{name:base,unit:canonUnit(u),qty:0}).qty+=q*f;
  }));
  return Object.values(sum).map(x=>({...x,left:Math.ceil(x.qty-0.01)-x.qty})).filter(x=>x.left>=0.25);
}
function recipesUsing(name,skip){
  return allRecipes.filter(r=>!skip.has(r.id)&&r.ingredients.some(i=>sameIngredient(baseIngredientName(i[2])||i[2],name)));
}
function leftHtml(list,skip){
  return list.map(x=>{ const n=recipesUsing(x.name,skip).length, q=Math.round(x.left*4)/4;
    return `<div class="left-r"><span>Il te restera <b>${fmtQty(q)} ${x.unit}</b> de ${x.name}.</span>${n?`<button type="button" data-left="${escapeHtml(x.name)}">${n} recette${n>1?'s':''} pour finir</button>`:''}</div>`; }).join('');
}
function bindLeft(root){
  root.querySelectorAll('[data-left]').forEach(b=>b.onclick=()=>{ closeSheet(); haveFilter=[b.dataset.left]; switchView('recipes'); renderChips(); renderRecipes(); });
}
const _renderShopV51=renderShop;
renderShop=function(){
  _renderShopV51();
  const anchor=$('#view-shop .hdr')||$('#shopSub'); if(!anchor) return;
  let box=$('#shopLeft'); if(!box){ box=document.createElement('div'); box.id='shopLeft'; box.className='left-box shop-left'; anchor.after(box); }
  const ids=[...selection].filter(id=>byId(id));
  const list=leftovers(ids.map(id=>{ const r=byId(id); return [r,scaleFactor(r)]; }));
  box.innerHTML=leftHtml(list,new Set(ids)); box.hidden=!list.length; bindLeft(box);
};

/* ---- fiche : reste de la recette et « Mes quantités » ---- */
const _openRecipeDetailV51=openRecipeDetail;
openRecipeDetail=function(id){
  _openRecipeDetailV51(id);
  const r=byId(id), ingList=$('#rdIngList'); if(!r||!ingList) return;
  ingList.insertAdjacentHTML('afterend','<div class="left-box" id="rdLeft"></div>');
  const box=$('#rdLeft');
  const up=()=>{ const list=leftovers([[r,scaleFactor(r)]]); box.innerHTML=leftHtml(list,new Set([id])); box.hidden=!list.length; bindLeft(box); };
  up(); new MutationObserver(up).observe(ingList,{childList:true});
  const edit=$('#rdEdit'); if(edit){ edit.insertAdjacentHTML('beforebegin','<button class="btn" id="rdMine" type="button">Mes quantités</button>'); $('#rdMine').onclick=()=>openMyQuantities(id); }
};
function openMyQuantities(id){
  const r=byId(id), sh=$('#sheet');
  const rows=r.ingredients.map(([q,u,item],i)=>q==null?'':`<div class="rw mq-r"><label for="mq${i}">${item}</label><span class="mq-in"><input id="mq${i}" data-i="${i}" type="number" inputmode="decimal" min="0" step="any" value="${q}"><span>${u||'pièce'}</span></span></div>`).join('');
  sh.innerHTML=`<div class="grab"></div><div class="sh-head"><h3>Mes quantités</h3><button class="sh-x" id="mqClose" aria-label="Fermer">${xSvg()}</button></div>
    <div class="sh-sub">Pour ${r.portions} portions. Les étapes et les courses suivront tes quantités.</div>
    <div class="grp" style="margin:0 16px">${rows}</div>
    <div class="stack"><button class="btn pri wide" id="mqSave" type="button">Enregistrer ma version</button></div>`;
  openSheet(); $('#mqClose').onclick=()=>openRecipeDetail(id);
  $('#mqSave').onclick=()=>{
    const ingredients=r.ingredients.map(x=>[...x]);
    sh.querySelectorAll('.mq-in input').forEach(el=>{ const v=parseFloat(String(el.value).replace(',','.')); if(!isNaN(v)&&v>0) ingredients[+el.dataset.i][0]=v; });
    const upd={...r,ingredients,custom:true}, ix=customRecipes.findIndex(x=>x.id===id);
    if(ix>=0) customRecipes[ix]=upd; else customRecipes.push(upd);
    save(LS.custom,customRecipes); touch(); rebuild(); closeSheet(); openRecipeDetail(id); toast('Ta version est enregistrée');
  };
}

/* ---- importer par lien, dans le formulaire de nouvelle recette ---- */
const _openRecipeFormV51=openRecipeForm;
openRecipeForm=function(existing){
  _openRecipeFormV51(existing);
  const paste=$('#rfPaste'), btn=$('#rfParse'); if(existing||!paste||!btn) return;
  const lab=paste.closest('.frow').querySelector('label'); if(lab) lab.textContent='Coller un lien ou une recette (facultatif)';
  paste.placeholder='Un lien Marmiton ou d’un autre site, ou le texte d’une recette.';
  const fromText=btn.onclick;
  btn.onclick=async()=>{
    const t=paste.value.trim();
    if(!/^https?:\/\/\S+$/i.test(t)) return fromText();
    btn.disabled=true;
    try{
      const res=await fetch('/.netlify/functions/recipe?url='+encodeURIComponent(t)); const r=await res.json();
      if(!res.ok) throw new Error(r.error||'');
      $('#rfTitle').value=r.title||''; $('#rfPortions').value=r.portions||4; if(r.time) $('#rfTime').value=r.time;
      $('#rfIng').value=r.ingredients.join('\n'); $('#rfSteps').value=r.steps.join('\n');
      toast(r.ingredients.length+' ingrédients et '+r.steps.length+' étapes trouvés, vérifie avant d’enregistrer');
    }catch(e){ toast(e.message&&!/JSON|fetch/i.test(e.message)?e.message:'Impossible de lire ce lien. Colle plutôt le texte de la recette.'); }
    btn.disabled=false;
  };
};
