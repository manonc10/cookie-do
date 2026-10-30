/* Cookie Do 5 : cuisiner une étape à la fois, ce qu'il faut prévoir dans la semaine.
   Les cases cochées d'une étape vivent dans cookState[id].steps, la position dans cookState[id].cur
   (-1 = préparer, 0... = étapes). « Voir toute la recette » ramène à la liste de l'ancien mode. */

/* une seule fois : les étapes ont changé de nombre, l'avancement enregistré n'a plus de sens */
if(!localStorage.getItem('cd_v5')){
  Object.values(cookState).forEach(cs=>{ if(cs){ cs.steps={}; delete cs.cur; } });
  save(LS.cookState,cookState); localStorage.setItem('cd_v5','1');
}

const _renderCookList=renderCookBody;
renderCookBody=function(){
  const r=byId(currentCook), cs=cookState[currentCook];
  if(cs.list){ _renderCookList(); addStepModeBtn(); return; }
  if(cs.cur==null||cs.cur>=r.steps.length) cs.cur=-1;
  const factor=scaleFactor(r), n=r.steps.length, i=cs.cur;
  $('#cookMeta').textContent=i<0?`${fmtTime(r.time)} · ${mealsLabel(cs.servings)}`:`Étape ${i+1} sur ${n}`;
  const bar=`<div class="ck-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${n}" aria-valuenow="${i+1}"><i style="width:${(i+1)/n*100}%"></i></div>`;
  const qtyOf=([q,u,item,aisle])=>{ const sc=niceQty(q,u,factor,aisle); return (sc!=null?`<b>${fmtQty(sc)}${u?' '+unitLabel(u,sc):''}</b> `:'')+itemFor(item,sc,u); };
  let body;
  if(i<0){
    body=`<div class="ck-head"><h3>Préparer</h3><div class="stepper"><button id="pMinus" aria-label="Moins">−</button><span>${cs.servings} portion${cs.servings>1?'s':''}</span><button id="pPlus" aria-label="Plus">+</button></div></div>
      ${r.advance?`<div class="advance"><b>À prévoir</b>${r.advance}</div>`:''}
      ${r.tools&&r.tools.length?`<div class="ck-lab">Ustensiles</div><div class="tools">${r.tools.join(' · ')}</div>`:''}
      <div class="ck-lab">Ingrédients</div>
      <div class="grp">${r.ingredients.map((g,ix)=>`<div class="ing-row ing-chk${ingChecked(currentCook,ix)?' on':''}" data-ix="${ix}" role="checkbox" aria-checked="${ingChecked(currentCook,ix)}" tabindex="0"><span class="box" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5" stroke-linecap="round" stroke-linejoin="round"/></svg></span><span class="tile">${pantryEmo(g[2])}</span><span class="n">${qtyOf(g)}</span></div>`).join('')}</div>`;
  } else {
    const m=stepMeta(r,i), secs=stepSecs(r,i), ings=(m.ing||[]).map(x=>r.ingredients[x]).filter(Boolean);
    const st=cs.steps[i]||{};
    body=`<div class="ck-txt">${stepText(r,r.steps[i],factor)}</div>
      ${ings.length?`<div class="ck-ings">${ings.map(g=>`<span>${qtyOf(g)}</span>`).join('')}</div>`:''}
      ${m.mark?`<div class="ck-mark">${m.mark}</div>`:''}
      ${secs?`<button class="ck-timer" id="ckTimer" type="button"><b>${fmtSecs(secs)}</b>Lancer le minuteur</button>`:''}
      ${m.why?`<details class="stp-why ck-why"><summary>Pourquoi ?</summary><div>${m.why}</div></details>`:''}
      ${st.assign?`<span class="mine ${st.assign==='b'?'b':''}">${st.assign==='a'?'Moi':'L’autre'}</span>`:''}
      ${i===n-1&&r.tip?`<div class="note tip"><div><b>Astuce</b>${r.tip}</div></div>`:''}`;
  }
  const last=i===n-1;
  $('#cookInner').innerHTML=`${bar}<div class="ck-body">${body}</div>
    <button class="ck-all" id="ckAll" type="button">Voir toute la recette</button>
    <div class="ck-nav">${i>=0?'<button class="btn" id="ckPrev" type="button">Précédente</button>':'<span></span>'}<button class="btn pri" id="ckNext" type="button">${i<0?'Commencer':last?'Marquer comme cuisiné':'Étape suivante'}</button></div>`;
  $('#cookModal .modal-body').scrollTop=0;
  const go=d=>{ cs.cur=i+d; save(LS.cookState,cookState); touch(); renderCookBody(); };
  if(i<0){
    $('#pMinus').onclick=()=>{ cs.servings=Math.max(1,cs.servings-1); save(LS.cookState,cookState); touch(); renderCookBody(); };
    $('#pPlus').onclick=()=>{ cs.servings++; save(LS.cookState,cookState); touch(); renderCookBody(); };
    $$('#cookInner .ing-chk').forEach(el=>{ const t=()=>{ toggleIng(currentCook,+el.dataset.ix); const on=ingChecked(currentCook,+el.dataset.ix); el.classList.toggle('on',on); el.setAttribute('aria-checked',on); }; el.onclick=t; el.onkeydown=e=>{ if(e.key===' '||e.key==='Enter'){ e.preventDefault(); t(); } }; });
  }
  const tb=$('#ckTimer'); if(tb) tb.onclick=()=>startTimer(stepSecs(r,i),'Étape '+(i+1));
  const pv=$('#ckPrev'); if(pv) pv.onclick=()=>go(-1);
  $('#ckAll').onclick=()=>{ cs.list=true; save(LS.cookState,cookState); renderCookBody(); $('#cookModal .modal-body').scrollTop=0; };
  $('#ckNext').onclick=()=>{
    if(i>=0){ cs.steps[i]=cs.steps[i]||{}; cs.steps[i].done=true; }
    if(last){ cs.cur=-1; markDone(currentCook); return; }
    go(1);
  };
};
function addStepModeBtn(){
  const tools=$('#cookInner .cook-tools'); if(!tools||$('#ckSteps')) return;
  tools.insertAdjacentHTML('beforeend','<button class="tbtn" id="ckSteps" type="button">Pas à pas</button>');
  $('#ckSteps').onclick=()=>{ const cs=cookState[currentCook]; delete cs.list; save(LS.cookState,cookState); renderCookBody(); };
}

/* semaine : ce qu'il faut anticiper se voit avant le jour J */
const _renderWeekV5=renderWeek;
renderWeek=function(){
  _renderWeekV5();
  const adv=(r,cls)=>`<div class="${cls}">À prévoir : ${r.advance}</div>`;
  const tn=$('#weekTonight .tn-t');
  if(tn){ const r=allRecipes.find(x=>x.title===tn.textContent); const m=$('#weekTonight .tn-m'); if(r&&r.advance&&m) m.insertAdjacentHTML('afterend',adv(r,'wk-adv')); }
  $$('#weekList .rw').forEach(row=>{ const t=row.querySelector('.t'); const r=t&&allRecipes.find(x=>x.title===t.textContent); const m=row.querySelector('.m'); if(r&&r.advance&&m) m.insertAdjacentHTML('afterend',adv(r,'wk-adv')); });
};
if(document.readyState!=='loading') renderWeek();
