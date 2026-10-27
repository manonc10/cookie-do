/* Cookie Do 4 : chargé en dernier.
   - Plats / Desserts / Sauces en haut du catalogue (les sauces ne vont ni dans le tirage ni dans le menu)
   - rangées « à découvrir » pour sortir des mêmes recettes : jamais faites, nouvelles, de saison, rapides
   - catalogue en grille de deux colonnes (ou grandes photos, au choix)
   - fiche d'un plat : les sauces qui vont avec ; fiche d'une sauce : les plats qui vont avec */

/* ================= SAUCES ================= */
function isSauce(r){ return !!r && (r.tags||[]).includes('sauce'); }
function isSide(r){ return !!r && (r.tags||[]).includes('accompagnement'); }
/* sauce ou accompagnement : se sert à côté d'un plat, n'occupe pas de repas */
function isExtra(r){ return isSauce(r)||isSide(r); }
const NEW_DAYS=60;
function isNewRecipe(r){ if(!r||!r.added) return false; const [y,m,d]=r.added.split('-').map(Number); return (Date.now()-new Date(y,m-1,d))/86400000<=NEW_DAYS; }
/* plat -> sauces, à partir du champ « pairs » des sauces */
let SAUCES_FOR=null;
function saucesFor(id){
  if(!SAUCES_FOR){ SAUCES_FOR={}; allRecipes.filter(isExtra).forEach(s=>(s.pairs||[]).forEach(p=>{ (SAUCES_FOR[p]=SAUCES_FOR[p]||[]).push(s.id); })); }
  return (SAUCES_FOR[id]||[]).map(byId).filter(Boolean);
}
const _rebuildV4=rebuild;
rebuild=function(){ SAUCES_FOR=null; _rebuildV4(); };

/* le segment remplace « Type de plat » : il est toujours visible, il ne compte pas comme un filtre */
COURSES.splice(0,COURSES.length,['main','Plats'],['side','Garnitures'],['sauce','Sauces'],['dessert','Desserts']);
courseFilter='main';
const _recipeMatchesV4=recipeMatches;
recipeMatches=function(r){
  const cf=courseFilter;
  // une recherche cherche partout, quel que soit le segment
  if(searchTerm) courseFilter='all';
  else if(cf==='sauce'){ courseFilter='all'; if(!isSauce(r)) { courseFilter=cf; return false; } }
  else if(cf==='side'){ courseFilter='all'; if(!isSide(r)) { courseFilter=cf; return false; } }
  else if(cf==='main'){ courseFilter='main'; if(isExtra(r)) { courseFilter=cf; return false; } }
  else if(cf==='dessert'){ if(isExtra(r)) return false; }
  const ok=_recipeMatchesV4(r); courseFilter=cf; return ok;
};
activeFilterCount=function(){ return (dietFilter?1:0)+(quickFilter?1:0)+(activeTag?1:0)+(sortMode!=='default'?1:0); };
const _filterLabelsV4=filterLabels;
filterLabels=function(){ return _filterLabelsV4().filter(x=>x[0]!=='course'); };
const _quickIsOnV4=quickIsOn, _quickToggleV4=quickToggle;
quickIsOn=function(k){ if(k==='all'){ const c=courseFilter; courseFilter='all'; const v=_quickIsOnV4('all'); courseFilter=c; return v; } return _quickIsOnV4(k); };
quickToggle=function(k){ const c=courseFilter; _quickToggleV4(k); if(k==='all'){ courseFilter=c; renderChips(); renderRecipes(); } };
{ const i=QUICK.findIndex(q=>q[0]==='dessert'); if(i>=0) QUICK.splice(i,1); }

function renderCourseSeg(){
  const c=$('#courseSeg'); if(!c) return;
  const n=k=>allRecipes.filter(r=>k==='sauce'?isSauce(r):k==='side'?isSide(r):k==='dessert'?isDessert(r)&&!isExtra(r):!isDessert(r)&&!isExtra(r)).length;
  c.innerHTML=COURSES.map(([k,l])=>`<button type="button" class="${courseFilter===k?'on':''}" data-k="${k}">${l}<span>${n(k)}</span></button>`).join('');
  c.querySelectorAll('button').forEach(b=>b.onclick=()=>{ courseFilter=b.dataset.k; if(courseFilter!=='main') dietFilter=null; renderCourseSeg(); renderChips(); renderRecipes(); window.scrollTo({top:0,behavior:'smooth'}); });
}

/* ================= CARTES ================= */
/* 330 min -> « 5 h 30 » (desserts qui passent au frais) */
function fmtTime(m){ if(!m) return ''; if(m<60) return m+' min'; const h=Math.floor(m/60), r=m%60; return h+' h'+(r?' '+String(r).padStart(2,'0'):''); }
function cardMeta(r,small){
  if(isSauce(r)) return `${fmtTime(r.time)} · ${r.yield||mealsLabel(r.portions)}`;
  if(small) return `${fmtTime(r.time)} · ${mealsLabel(r.portions)}`;
  return `${fmtTime(r.time)} · ${mealsLabel(r.portions)}${protOf(r.id)&&!isDessert(r)?' · '+protOf(r.id)+' g prot.':''}`;
}
function cardTags(r){
  const made=lastMade(r.id), ds=daysSince(made);
  const out=[];
  if(made&&ds<=10) out.push(`<span class="tg warn">${ds===0?"Fait aujourd'hui":ds===1?'Fait hier':'Fait il y a '+ds+' j'}</span>`);
  else if(isNewRecipe(r)) out.push('<span class="tg new">Nouveau</span>');
  if((r.tags||[]).includes('végé')&&!isDessert(r)&&!isExtra(r)) out.push('<span class="tg veg">Végé</span>');
  if(typeof isSeasonal==='function'&&isSeasonal(r)&&!isDessert(r)&&!isExtra(r)&&out.length<2) out.push('<span class="tg sea">De saison</span>');
  return out.slice(0,2).join('');
}
function plusSvg(){ return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 5v14M5 12h14" stroke-linecap="round"/></svg>'; }
function gridCard(r,small){
  const el=document.createElement('div'); el.className='gcard'+(small?' sm':'')+(selection.has(r.id)?' picked':'');
  el.innerHTML=`<div class="ph-wrap">${photoOrEmoji(r.id,'',true)}<div class="tgs">${cardTags(r)}</div>
      <button class="fav ${isFav(r.id)?'on':''}" data-fav aria-label="Favori">${heartSvg()}</button>
      <button class="pick" data-pick aria-label="${selection.has(r.id)?'Retirer de la semaine':'Ajouter à la semaine'}">${selection.has(r.id)?checkSvg():plusSvg()}</button></div>
    <div class="gb"><div class="gt">${r.title}</div><div class="gm">${cardMeta(r,small)}</div></div>`;
  el.onclick=()=>openRecipeDetail(r.id);
  const pk=el.querySelector('[data-pick]'); if(pk) pk.onclick=e=>{ e.stopPropagation(); toggleSelect(r.id); };
  const fv=el.querySelector('[data-fav]'); fv.onclick=e=>{ e.stopPropagation(); toggleFav(r.id); fv.classList.toggle('on',isFav(r.id)); if(showFavOnly) renderRecipes(); };
  return el;
}

/* ================= RANGÉES « À DÉCOUVRIR » ================= */
/* mélange stable sur la journée : les rangées changent chaque jour, pas à chaque rendu */
function dayShuffle(list,salt){
  const seed=localDay()+salt; let h=2166136261; for(const ch of seed){ h^=ch.charCodeAt(0); h=Math.imul(h,16777619); }
  const rnd=()=>{ h^=h<<13; h^=h>>>17; h^=h<<5; return ((h>>>0)%100000)/100000; };
  const a=list.slice(); for(let i=a.length-1;i>0;i--){ const j=Math.floor(rnd()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a;
}
function railsData(){
  const mains=allRecipes.filter(r=>!isDessert(r)&&!isExtra(r));
  const made=new Set(history.map(h=>h.id));
  const rails=[];
  const nw=allRecipes.filter(isNewRecipe).filter(r=>courseFilter==='main'?!isDessert(r)&&!isExtra(r):true);
  if(nw.length) rails.push(['new','Nouvelles recettes',dayShuffle(nw,'n').slice(0,12)]);
  const never=mains.filter(r=>!made.has(r.id)&&!isNewRecipe(r));
  if(never.length) rails.push(['never','Jamais essayées',dayShuffle(never,'j').slice(0,12)]);
  const old=mains.filter(r=>made.has(r.id)&&daysSince(lastMade(r.id))>=45).sort((a,b)=>(getRating(b.id)-getRating(a.id))||(daysSince(lastMade(b.id))-daysSince(lastMade(a.id))));
  if(old.length>=3) rails.push(['old','À refaire, pas faites depuis longtemps',old.slice(0,12)]);
  const sea=mains.filter(r=>typeof isSeasonal==='function'&&isSeasonal(r));
  if(sea.length>=3) rails.push(['sea','De saison en ce moment',dayShuffle(sea,'s').slice(0,12)]);
  rails.push(['quick','Prêt en 25 minutes',dayShuffle(mains.filter(r=>r.time<=25),'q').slice(0,12)]);
  return rails;
}
function renderRails(){
  const box=$('#rails'); if(!box) return;
  const show=courseFilter==='main'&&!searchTerm&&quickIsOn('all')&&sortMode==='default';
  box.hidden=!show; box.innerHTML=''; if(!show) return;
  railsData().forEach(([k,title,list])=>{
    if(!list.length) return;
    const sec=document.createElement('div'); sec.className='rail';
    sec.innerHTML=`<div class="rail-h"><span>${title}</span></div><div class="rail-s"></div>`;
    const s=sec.querySelector('.rail-s'); list.forEach(r=>s.appendChild(gridCard(r,true)));
    box.appendChild(sec);
  });
}

/* ================= CATALOGUE ================= */
const _renderRecipesV4=renderRecipes;
renderRecipes=function(){
  _renderRecipesV4();                                   // compte, message « aucun résultat », sous-titre
  const grid=$('#recipeGrid'); grid.innerHTML='';
  const list=sortRecipes(allRecipes.filter(recipeMatches));
  const big=settings.cardView==='big';
  grid.className=big?'rlist':'ggrid';
  list.forEach(r=>grid.appendChild(big?recipeCard(r):gridCard(r)));
  const lbl=courseFilter==='sauce'?'sauce':courseFilter==='side'?'garniture':courseFilter==='dessert'?'dessert':'recette';
  $('#recipeCount').textContent=(searchTerm||!quickIsOn('all')?'':'Toutes les ')+(list.length+' '+lbl+(list.length>1?'s':'')).replace(/^(\d+) /,'$1 ');
  renderRails(); renderCourseSeg();
  const vt=$('#viewToggle'); if(vt){ vt.innerHTML=big?uiGridIcon():uiBigIcon(); vt.setAttribute('aria-label',big?'Afficher en grille':'Afficher en grandes photos'); }
};
function uiGridIcon(){ return '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/></svg>'; }
function uiBigIcon(){ return '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="7" rx="1.5"/><rect x="4" y="13" width="16" height="7" rx="1.5"/></svg>'; }
{ const vt=$('#viewToggle'); if(vt) vt.onclick=()=>{ settings.cardView=settings.cardView==='big'?'grid':'big'; saveSettings(); renderRecipes(); }; }

/* ================= TIRAGE, MENU, ÉQUILIBRE : sans les sauces ================= */
const _randomWeekV4=randomWeek;
randomWeek=function(){
  const all=allRecipes; allRecipes=all.filter(r=>!isExtra(r));          // le tirage ne pioche que des plats
  try{ _randomWeekV4(); } finally { allRecipes=all; }
  refreshSelUI(); renderRecipes(); renderWeek(); };
{ const src=randomWeek; $('#weekRandomBtn').onclick=src; }
const _autoPlanV4=autoPlan;
autoPlan=function(all){ const saved={}; [...selection].forEach(id=>{ if(isExtra(byId(id))){ saved[id]=1; selection.delete(id); } });
  _autoPlanV4(all); Object.keys(saved).forEach(id=>{ selection.add(id); delete plan[id]; }); save('cd_plan',plan); };
const _balanceLineV4=balanceLine;
balanceLine=function(ids){ return _balanceLineV4(ids.filter(id=>!isExtra(byId(id)))); };
const _renderWeekV4=renderWeek;
renderWeek=function(){
  _renderWeekV4();
  // le décompte des repas ne compte que les plats, pas les sauces ni les garnitures
  { const ids=[...selection].filter(id=>byId(id)&&!isExtra(byId(id))); const sub=$('#weekSub');
    if(sub&&ids.length){ let p=0; ids.forEach(id=>{ p+=servingsFor(byId(id)); }); sub.textContent=`${ids.length} plat${ids.length>1?'s':''} · ${mealsLabel(p)} pour ${settings.persons} pers.`; } }
  // une sauce n'occupe pas de repas : on remplace « Choisir les repas » par ce qu'elle accompagne
  $$('#weekList .rw').forEach(row=>{ const t=row.querySelector('.t'); if(!t) return; const r=allRecipes.find(x=>x.title===t.textContent); if(!isExtra(r)) return;
    const w=row.querySelector('.when'); if(!w) return; const with_=[...selection].map(byId).filter(x=>x&&!isExtra(x)&&(r.pairs||[]).includes(x.id)); const lbl=isSide(r)?'Accompagnement':'Sauce';
    const m=row.querySelector('.m'); if(m) m.innerHTML=m.innerHTML.replace(/\d+(,\d)? repas/,r.yield||(servingsFor(r)+' parts'));
    w.textContent=with_.length?lbl+' pour '+with_.map(x=>x.title).join(', '):lbl; w.classList.remove('empty'); w.onclick=e=>{ e.stopPropagation(); openRecipeDetail(r.id); }; });
};

/* ================= FICHE : sauces et accords ================= */
const _openRecipeDetailV4=openRecipeDetail;
openRecipeDetail=function(id){
  _openRecipeDetailV4(id);
  const r=byId(id); if(!r) return;
  const sh=$('#sheet'); const anchor=sh.querySelector('#rdProt'); if(!anchor) return;
  if(isSide(r)){ const k=sh.querySelector('.rd .kic'); if(k) k.innerHTML='Accompagnement · '+fmtTime(r.time); }
  if(isSauce(r)){ const k=sh.querySelector('.rd .kic'); if(k) k.innerHTML='Sauce'+((r.tags||[]).includes('dessert')?' sucrée':'')+' · '+fmtTime(r.time); }
  const kic=sh.querySelector('.rd .kic'); if(kic&&r.time>=60) kic.innerHTML=kic.innerHTML.replace(r.time+' min',fmtTime(r.time));
  let html='';
  if(isExtra(r)){
    const dishes=(r.pairs||[]).map(byId).filter(Boolean);
    if(r.yield){ const m=sh.querySelector('#rdMeals'); if(m) m.textContent=r.yield; }
    if(dishes.length) html=`<div class="sec" style="padding-left:0;padding-right:0"><span>Va bien avec</span></div><div class="pair-s">${dishes.map(d=>pairChip(d)).join('')}</div>`;
  } else {
    const all=saucesFor(id), sides=all.filter(isSide), ss=all.filter(isSauce);
    const row=(t,l)=>l.length?`<div class="sec" style="padding-left:0;padding-right:0"><span>${t}</span></div><div class="pair-s">${l.map(x=>pairChip(x,true)).join('')}</div>`:'';
    html=row('Un accompagnement',sides)+row('Une sauce pour aller avec',ss);
  }
  if(!html) return;
  anchor.insertAdjacentHTML('beforebegin',`<div class="pairs">${html}</div>`);
  sh.querySelectorAll('.pair-c').forEach(b=>{
    b.onclick=e=>{ if(e.target.closest('[data-add]')) return; openRecipeDetail(b.dataset.id); };
    const a=b.querySelector('[data-add]'); if(a) a.onclick=e=>{ e.stopPropagation(); toggleSelect(b.dataset.id); const on=selection.has(b.dataset.id); a.classList.toggle('on',on); a.innerHTML=on?checkSvg():plusSvg(); const w=isSide(byId(b.dataset.id))?'Accompagnement':'Sauce'; toast(on?w+' ajouté'+(w==='Sauce'?'e':'')+' : ses ingrédients sont dans les courses':w+' retiré'+(w==='Sauce'?'e':'')+' de la semaine'); };
  });
};
function pairChip(r,addable){
  const on=selection.has(r.id);
  return `<div class="pair-c" data-id="${r.id}" role="button" tabindex="0">${hasPhoto(r.id)?`<img src="${photoThumb(r.id)}" alt="" loading="lazy" onerror="${thumbFallback(r.id)}">`:`<div class="noph">${recipeEmoji(r)}</div>`}<div class="pb"><b>${r.title}</b><small>${fmtTime(r.time)}</small></div>${addable?`<button class="pa${on?' on':''}" data-add aria-label="Ajouter à la semaine">${on?checkSvg():plusSvg()}</button>`:''}</div>`;
}

/* premier rendu : la vue Recettes n'est peinte qu'une fois le segment et les rails en place (pas de saut de page) */
renderCourseSeg(); renderChips(); renderRecipes(); renderWeek();
document.body.classList.remove('boot');
