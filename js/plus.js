/* Cookie Do : fonctionnalités ajoutées en 3.5 (chargé après app.js).
   Menu jour par jour, saison NZ, équilibre du tirage, « avec ce qu'il me reste »,
   produits à utiliser vite, ordre des rayons, produits de base, photos perso,
   import d'une recette collée, fonctionnement hors ligne. */

/* ================= SAISON (Nouvelle-Zélande, hémisphère sud) ================= */
const SEASON={ // mois 1..12 -> mots-clés normalisés (sans accents)
  1:['tomate','courgette','poivron','aubergine','concombre','mais','haricot vert','fraise','framboise','cerise','peche','abricot','nectarine','basilic','salade','avocat','myrtille','prune'],
  2:['tomate','courgette','poivron','aubergine','concombre','mais','haricot vert','peche','nectarine','prune','basilic','salade','pomme','poire','myrtille'],
  3:['tomate','courgette','poivron','aubergine','mais','pomme','poire','raisin','courge','butternut','potiron','champignon','prune','salade'],
  4:['courge','butternut','potiron','patate douce','pomme','poire','raisin','champignon','brocoli','chou-fleur','poireau','epinard','feijoa','aubergine','poivron'],
  5:['courge','butternut','potiron','patate douce','pomme','poire','kiwi','brocoli','chou-fleur','chou','poireau','epinard','champignon','carotte','feijoa','mandarine'],
  6:['courge','potiron','patate douce','chou','chou-fleur','brocoli','poireau','carotte','panais','celeri','epinard','kiwi','orange','mandarine','citron','betterave','pomme'],
  7:['chou','chou-fleur','brocoli','poireau','carotte','panais','celeri','epinard','kiwi','orange','mandarine','citron','betterave','patate douce'],
  8:['chou','chou-fleur','brocoli','poireau','carotte','panais','celeri','epinard','kiwi','orange','citron','betterave','asperge'],
  9:['asperge','epinard','brocoli','chou-fleur','poireau','salade','citron','orange','avocat','radis','petits pois','carotte'],
  10:['asperge','petits pois','epinard','salade','brocoli','avocat','radis','citron','artichaut','fraise'],
  11:['asperge','petits pois','fraise','courgette','salade','avocat','radis','haricot vert','epinard','concombre','cerise'],
  12:['tomate','courgette','fraise','cerise','framboise','petits pois','haricot vert','concombre','salade','avocat','basilic','peche','abricot','mais']
};
/* légumes frais qui comptent contre la saison quand ils sont très loin de leur mois */
const SEASON_WATCH=['tomate','courgette','poivron','aubergine','concombre','mais','haricot vert','fraise','framboise','cerise','peche','abricot','asperge','courge','butternut','potiron','chou','poireau','panais','kiwi','feijoa','petits pois','artichaut'];
const NOT_PRODUCE=/oignon|ail|citron vert|gingembre|persil|coriandre|menthe|ciboulette|aneth|thym|sauge|laurier|echalote/;
function seasonInfo(r,month){
  month=month||(new Date().getMonth()+1);
  const now=SEASON[month]||[];
  let inS=0,outS=0,names=[];
  r.ingredients.forEach(([q,u,item,aisle])=>{
    if(aisle!=='Légumes & fruits') return;
    const n=norm(item); if(NOT_PRODUCE.test(n)) return;
    const hit=now.find(k=>n.includes(k));
    if(hit){ inS++; if(!names.includes(hit)) names.push(hit); return; }
    if(SEASON_WATCH.some(k=>n.includes(k))) outS++;
  });
  return {inS,outS,names,ok:inS>=1&&outS===0};
}
function isSeasonal(r){ if(r._season==null||r._seasonM!==new Date().getMonth()) { r._season=seasonInfo(r).ok; r._seasonM=new Date().getMonth(); } return r._season; }

/* ================= FILTRES SUPPLÉMENTAIRES ================= */
let seasonFilter=false, haveFilter=[]; // haveFilter : ingrédients choisis (« avec ce qu'il me reste »)
const _recipeMatches=recipeMatches;
recipeMatches=function(r){
  if(!_recipeMatches(r)) return false;
  if(seasonFilter && !isSeasonal(r)) return false;
  if(haveFilter.length){
    const ings=r.ingredients.map(i=>baseIngredientName(i[2]));
    if(!haveFilter.every(h=>ings.some(x=>sameIngredient(x,h)))) return false;
  }
  return true;
};
QUICK.splice(1,0,['have','Avec ce que j’ai…'],['saison','De saison']);
const _quickIsOn=quickIsOn, _quickToggle=quickToggle;
quickIsOn=function(k){
  if(k==='saison') return seasonFilter;
  if(k==='have') return haveFilter.length>0;
  if(k==='all') return _quickIsOn('all')&&!seasonFilter&&!haveFilter.length;
  return _quickIsOn(k);
};
quickToggle=function(k){
  if(k==='saison'){ seasonFilter=!seasonFilter; renderChips(); renderRecipes(); return; }
  if(k==='have'){ openHaveSheet(); return; }
  if(k==='all'){ seasonFilter=false; haveFilter=[]; }
  _quickToggle(k);
};
const _renderChips=renderChips;
renderChips=function(){
  _renderChips();
  const b=[...document.querySelectorAll('#quickChips .chip')].find(x=>x.textContent.startsWith('Avec ce'));
  if(b&&haveFilter.length) b.textContent='Avec '+haveFilter.join(', ');
};
function openHaveSheet(){
  const sh=$('#sheet');
  // suggestions : le stock d'abord (ce qui va se perdre en tête), puis les ingrédients frais les plus courants
  const stock=pantry.slice().sort((a,b)=>(isStale(b)?1:0)-(isStale(a)?1:0)).map(p=>p.name);
  const freq={}; allRecipes.forEach(r=>r.ingredients.forEach(([q,u,item,aisle])=>{ if(aisle==='Légumes & fruits'||aisle==='Frais & crémerie'||aisle==='Viandes & poissons'){ const b=baseIngredientName(item); if(b&&!isStaple(b)) freq[b]=(freq[b]||0)+1; } }));
  const common=Object.keys(freq).sort((a,b)=>freq[b]-freq[a]).filter(n=>!stock.some(s=>sameIngredient(s,n))).slice(0,30);
  let picked=haveFilter.slice();
  const chip=n=>`<button class="fopt${picked.some(p=>sameIngredient(p,n))?' on':''}" data-n="${escapeHtml(n)}">${pantryEmo(n)} ${escapeHtml(n)}</button>`;
  sh.innerHTML=`<div class="grab"></div>
    <div class="sh-head"><h3>Avec ce que j’ai</h3><button class="sh-x" id="hvClose" aria-label="Fermer">${xSvg()}</button></div>
    <div class="sh-sub">Choisis un, deux ou trois ingrédients à finir : seules les recettes qui les utilisent tous restent.</div>
    <div class="search" style="margin:0 16px 8px"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" stroke-linecap="round"/></svg><input id="hvInput" type="text" placeholder="Autre ingrédient…" autocomplete="off" enterkeyhint="done"></div>
    ${stock.length?`<div class="fgroup"><div class="fgroup-t">Dans ton stock</div><div class="fopts" id="hvStock">${stock.map(chip).join('')}</div></div>`:''}
    <div class="fgroup"><div class="fgroup-t">Souvent utilisés</div><div class="fopts">${common.map(chip).join('')}</div></div>
    <div class="fs-foot"><button class="btn" id="hvClear">Effacer</button><button class="btn pri" id="hvApply"></button></div>`;
  openSheet();
  const refresh=()=>{ sh.querySelectorAll('.fopt').forEach(b=>b.classList.toggle('on',picked.some(p=>sameIngredient(p,b.dataset.n))));
    const save_=haveFilter; haveFilter=picked; const n=allRecipes.filter(recipeMatches).length; haveFilter=save_;
    $('#hvApply').textContent=picked.length?'Voir '+n+' recette'+(n>1?'s':''):'Fermer'; };
  sh.querySelectorAll('.fopt').forEach(b=>b.onclick=()=>{ const n=b.dataset.n; const i=picked.findIndex(p=>sameIngredient(p,n)); if(i>=0) picked.splice(i,1); else picked.push(n); refresh(); });
  $('#hvInput').addEventListener('keydown',e=>{ if(e.key==='Enter'){ const v=e.target.value.trim(); if(v&&!picked.some(p=>sameIngredient(p,v))) picked.push(v); e.target.value=''; refresh(); } });
  $('#hvClear').onclick=()=>{ picked=[]; refresh(); };
  $('#hvApply').onclick=()=>{ haveFilter=picked; closeSheet(); switchView('recipes'); renderChips(); renderRecipes(); };
  $('#hvClose').onclick=closeSheet;
  refresh();
}

/* ================= CARTES : badge de saison ================= */
const _recipeCard=recipeCard;
recipeCard=function(r){
  const card=_recipeCard(r);
  if(isSeasonal(r)&&!isDessert(r)){ const t=card.querySelector('.tags'); if(t) t.insertAdjacentHTML('beforeend','<span class="tag season">De saison</span>'); }
  return card;
};

/* ================= STOCK : produits à utiliser vite ================= */
/* un produit frais rangé depuis plus de N jours est signalé (le stock ne connaît pas les dates de péremption) */
const STALE_DAYS={'Légumes & fruits':5,'Frais & crémerie':6,'Viandes & poissons':2,'Œufs':18};
function isStale(p){
  if(!p||!p.at) return false;
  const a=guessAisle(p.name); const d=STALE_DAYS[a]; if(!d) return false;
  if(/viande|poulet|boeuf|bœuf|porc|saumon|poisson|crevette|hache|jambon|lardon/i.test(p.name)) return (Date.now()-p.at)/86400000>=STALE_DAYS['Viandes & poissons'];
  return (Date.now()-p.at)/86400000>=d;
}
const _renderFridge=renderFridge;
renderFridge=function(){
  _renderFridge();
  const stale=pantry.filter(isStale); const h=$('#pantryH'); if(!h) return;
  const c=$('#pantryCount');
  if(stale.length){ c.innerHTML='<button type="button" id="staleGo">Finir '+escapeHtml(stale[0].name)+'</button>';
    $('#staleGo').onclick=()=>{ haveFilter=[stale[0].name]; switchView('recipes'); renderChips(); renderRecipes(); }; }
};

/* ================= TIRAGE AU SORT ÉQUILIBRÉ ================= */
function dietOf(r){ const t=r.tags||[]; if(t.includes('végé')) return 'vege'; if(t.includes('poisson')) return 'poisson'; return 'viande'; }
randomWeek=function(){
  const N=6;
  const weight=r=>{ let w=Math.min(daysSince(lastMade(r.id)),60)/60; w=Math.pow(w,1.5)+0.03; const rt=getRating(r.id); if(rt) w*=(1+rt*0.25); if(isFav(r.id)) w*=1.4; if(isSeasonal(r)) w*=1.5; return w; };
  const pool=allRecipes.filter(r=>!isDessert(r));
  const pick=(cands,n,chosen)=>{ const avail=cands.filter(r=>!chosen.has(r.id)).map(r=>({id:r.id,w:weight(r)}));
    while(n>0&&avail.length){ const tot=avail.reduce((s,p)=>s+p.w,0); let x=Math.random()*tot,i=0; for(;i<avail.length;i++){ x-=avail[i].w; if(x<=0) break; } i=Math.min(i,avail.length-1); chosen.add(avail[i].id); avail.splice(i,1); n--; } };
  const chosen=new Set();
  pick(pool.filter(r=>dietOf(r)==='vege'),Math.min(settings.vegTarget||0,N),chosen);
  pick(pool.filter(r=>dietOf(r)==='poisson'),Math.min(settings.fishTarget||0,N-chosen.size),chosen);
  pick(pool,N-chosen.size,chosen);
  selection=new Set(chosen); save(LS.selection,[...selection]);
  plan={}; save('cd_plan',plan);
  clearAcquired(); shopChecked.clear(); save(LS.shopChecked,[]);
  autoPlan(true);
  touch(); refreshSelUI(); renderRecipes(); renderWeek(); toast('Menu tiré au sort : '+selection.size+' recettes, réparties sur la semaine');
};

/* ================= MENU JOUR PAR JOUR ================= */
const DAY_NAMES=['dim.','lun.','mar.','mer.','jeu.','ven.','sam.'];
const DAY_FULL=['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi'];
function weekDays(){ const now=new Date(); const out=[]; for(let i=0;i<7;i++){ const d=new Date(now); d.setDate(now.getDate()+i); out.push(d); } return out; } // sept jours à partir d'aujourd'hui
function slotLabel(key){ const [iso,slot]=key.split('|'); const [y,m,d]=iso.split('-').map(Number); const dt=new Date(y,m-1,d); const t=localDay(); const tm=new Date(); tm.setDate(tm.getDate()+1);
  const day=iso===t?"aujourd'hui":iso===localDay(tm)?'demain':DAY_NAMES[dt.getDay()]+' '+d; return day+' '+slot; }
function mealsNeeded(r){ return Math.max(1,Math.round(servingsFor(r)/Math.max(1,settings.persons||2))); }
function cleanPlan(){ Object.keys(plan).forEach(id=>{ if(!selection.has(id)) delete plan[id]; else plan[id]=(plan[id]||[]).filter(k=>k.split('|')[0]>=localDay()); }); }
function takenSlots(except){ const t=new Set(); Object.keys(plan).forEach(id=>{ if(id!==except) (plan[id]||[]).forEach(k=>t.add(k)); }); return t; }
/* place chaque recette le soir du premier jour libre, et ses restes au repas suivant */
function autoPlan(all){
  cleanPlan();
  const slots=[]; weekDays().forEach((d,i)=>{ const iso=localDay(d); if(i>0||new Date().getHours()<13) slots.push(iso+'|midi'); slots.push(iso+'|soir'); });
  [...selection].forEach(id=>{ const r=byId(id); if(!r) return; if(!all&&plan[id]&&plan[id].length) return;
    const taken=takenSlots(id); const need=mealsNeeded(r);
    const start=slots.findIndex(k=>k.endsWith('soir')&&!taken.has(k));
    const got=[]; for(let i=Math.max(0,start);i<slots.length&&got.length<need;i++){ if(!taken.has(slots[i])) got.push(slots[i]); }
    plan[id]=got; });
  save('cd_plan',plan);
}
function openDayPicker(id){
  const r=byId(id); const sh=$('#sheet'); const taken=takenSlots(id); let mine=new Set(plan[id]||[]);
  const rows=weekDays().map(d=>{ const iso=localDay(d); const cell=slot=>{ const k=iso+'|'+slot; const other=taken.has(k)&&!mine.has(k);
      return `<button class="slot${mine.has(k)?' on':''}${other?' busy':''}" data-k="${k}">${slot}</button>`; };
    return `<div class="rw"><div class="b"><div class="t" style="font-weight:500;text-transform:capitalize">${iso===localDay()?"aujourd'hui":DAY_FULL[d.getDay()]+' '+d.getDate()}</div></div>${cell('midi')}${cell('soir')}</div>`; }).join('');
  sh.innerHTML=`<div class="grab"></div>
    <div class="sh-head"><h3>Quels repas ?</h3><button class="sh-x" id="dpClose" aria-label="Fermer">${xSvg()}</button></div>
    <div class="sh-sub">« ${r.title} » fait ${mealsLabel(servingsFor(r))} pour ${settings.persons} pers. Les cases grisées sont déjà prises par une autre recette.</div>
    <div class="grp" style="margin:0 16px">${rows}</div>
    <div class="stack"><button class="btn pri wide" id="dpSave">Enregistrer</button></div>`;
  openSheet();
  sh.querySelectorAll('.slot').forEach(b=>b.onclick=()=>{ const k=b.dataset.k; if(mine.has(k)) mine.delete(k); else mine.add(k); b.classList.toggle('on',mine.has(k)); });
  $('#dpSave').onclick=()=>{ plan[id]=[...mine].sort(); save('cd_plan',plan); touch(); closeSheet(); renderWeek(); };
  $('#dpClose').onclick=closeSheet;
}
function openDaySheet(iso){
  const meals=[]; Object.keys(plan).forEach(id=>(plan[id]||[]).forEach(k=>{ if(k.startsWith(iso+'|')) meals.push({id,slot:k.split('|')[1],first:plan[id][0]===k}); }));
  meals.sort((a,b)=>a.slot==='midi'?-1:1);
  const [y,m,d]=iso.split('-').map(Number); const dt=new Date(y,m-1,d);
  const sh=$('#sheet');
  sh.innerHTML=`<div class="grab"></div>
    <div class="sh-head"><h3 style="text-transform:capitalize">${DAY_FULL[dt.getDay()]} ${d}</h3><button class="sh-x" id="dsClose" aria-label="Fermer">${xSvg()}</button></div>
    ${meals.length?`<div class="grp" style="margin:8px 16px 0">${meals.map(x=>{ const r=byId(x.id); return `<div class="rw thumb" data-id="${x.id}">${hasPhoto(x.id)?`<img class="th" src="${photoSrc(x.id)}" alt="">`:`<div class="noph">${recipeEmoji(r)}</div>`}<div class="b"><div class="t">${r.title}</div><div class="m">${x.slot}${x.first?'':' · restes'}</div></div><span class="chev">›</span></div>`; }).join('')}</div>`:'<div class="sh-sub">Rien de prévu ce jour-là. Touche « Choisir les repas » sous une recette de la semaine pour la placer ici.</div>'}`;
  openSheet(); $('#dsClose').onclick=closeSheet;
  sh.querySelectorAll('[data-id]').forEach(el=>el.onclick=()=>{ closeSheet(); openRecipeDetail(el.dataset.id); });
}
renderDays=function(){
  const c=$('#days'); if(!c) return; c.innerHTML='';
  const count={}; Object.values(plan).forEach(ks=>(ks||[]).forEach(k=>{ const iso=k.split('|')[0]; count[iso]=(count[iso]||0)+1; }));
  const done=new Set(history.map(h=>h.date));
  weekDays().forEach((d,i)=>{ const iso=localDay(d); const el=document.createElement('button'); el.type='button';
    el.className=(i===0?'today':'')+(count[iso]?' has':'')+(done.has(iso)?' done':'');
    el.innerHTML=`${i===0?'auj.':DAY_NAMES[d.getDay()].replace('.','')}<b>${d.getDate()}</b><i>${count[iso]?count[iso]+' repas':''}</i>`;
    el.onclick=()=>openDaySheet(iso); c.appendChild(el); });
};
function balanceLine(ids){
  const c={vege:0,poisson:0,viande:0}; let prot=0,np=0;
  ids.forEach(id=>{ const r=byId(id); if(!r||isDessert(r)) return; c[dietOf(r)]++; const p=protOf(id); if(p){ prot+=p; np++; } });
  const parts=[]; if(c.vege) parts.push(c.vege+' végé'); if(c.poisson) parts.push(c.poisson+' poisson'); if(c.viande) parts.push(c.viande+' viande');
  return parts.join(' · ')+(np?' · ≈ '+Math.round(prot/np)+' g de protéines par portion':'');
}
renderWeek=function(){
  cleanPlan(); renderDays();
  const cont=$('#weekList'); cont.innerHTML=''; const ids=[...selection].filter(id=>byId(id));
  ids.sort((a,b)=>((plan[a]||[])[0]||'z').localeCompare((plan[b]||[])[0]||'z'));
  $('#weekEmpty').hidden=!!ids.length; $('#weekH').hidden=!ids.length; cont.classList.toggle('hide',!ids.length);
  const bal=$('#weekBalance'); if(bal){ bal.hidden=!ids.length; bal.textContent=balanceLine(ids); }
  let portions=0; ids.forEach(id=>{ portions+=servingsFor(byId(id)); });
  const sub=$('#weekSub'); if(sub) sub.textContent=ids.length?`${ids.length} recette${ids.length>1?'s':''} · ${mealsLabel(portions)} pour ${settings.persons} pers.`:'Le menu de la semaine et ce que tu as déjà cuisiné.';
  const unplanned=ids.filter(id=>!(plan[id]||[]).length).length;
  const pb=$('#planBtn'); if(pb){ pb.hidden=!ids.length; pb.textContent=unplanned?'Répartir sur la semaine':'Répartir à nouveau'; }
  ids.forEach(id=>{ const r=byId(id);
    const cs=cookState[id],stepsDone=cs?Object.values(cs.steps||{}).filter(s=>s&&s.done).length:0;
    const total=r.steps.length,pct=total?Math.round(stepsDone/total*100):0;
    const miss=pantry.length?missingFor(r):null;
    const ks=plan[id]||[];
    const when=ks.length?ks.map(slotLabel).join(' · '):'Choisir les repas';
    const row=document.createElement('div'); row.className='rw thumb';
    const state=pct>0?`<span style="color:var(--accT);font-weight:600">${pct} % fait</span>`:(miss?(miss.length?`<span style="color:var(--warn)">${miss.length} manque${miss.length>1?'nt':''}</span>`:'<span style="color:var(--ok)">tout en stock</span>'):mealsLabel(servingsFor(r)));
    row.innerHTML=`${hasPhoto(id)?`<img class="th" src="${photoSrc(id)}" alt="" loading="lazy">`:`<div class="noph">${recipeEmoji(r)}</div>`}
      <div class="b"><div class="t">${r.title}</div><div class="m">${r.time} min · ${state}</div><button type="button" class="when${ks.length?'':' empty'}">${when}</button></div>
      <button class="go" data-cook>Cuisiner</button>`;
    row.querySelector('[data-cook]').onclick=e=>{e.stopPropagation();openCook(id);};
    row.querySelector('.when').onclick=e=>{ e.stopPropagation(); openDayPicker(id); };
    row.querySelector('.t').onclick=()=>openRecipeDetail(id);
    row.querySelector('.th,.noph').onclick=()=>openRecipeDetail(id);
    cont.appendChild(row);
  });
  renderHistory();
};
/* une recette ajoutée à la semaine prend toute seule sa place */
const _toggleSelect=toggleSelect;
toggleSelect=function(id){ _toggleSelect(id); if(selection.has(id)) autoPlan(false); else { delete plan[id]; save('cd_plan',plan); } };

/* ================= RÉGLAGES : rayons, produits de base, équilibre ================= */
const _renderSettingsSheet=renderSettingsSheet;
renderSettingsSheet=function(){
  _renderSettingsSheet();
  const sec=[...document.querySelectorAll('#sheet .sec')].find(x=>x.textContent.trim()==='Compte');
  const g=document.createElement('div');
  g.innerHTML=`<div class="sec"><span>Courses et menu</span></div>
    <div class="grp" style="margin:0 16px">
      <div class="rw" id="rowAisles" style="cursor:pointer"><span class="ico" style="background:#2F6FD6"><svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h10M4 18h6" stroke-linecap="round"/></svg></span><span>Ordre des rayons</span><span class="chev">›</span></div>
      <div class="rw" id="rowStaples" style="cursor:pointer"><span class="ico" style="background:#C77800"><svg viewBox="0 0 24 24"><path d="M5 12l4 4 10-10" stroke-linecap="round" stroke-linejoin="round"/></svg></span><span>Produits de base</span><span class="val">${(settings.staples||[]).length||''} ›</span></div>
      <div class="rw"><span class="ico" style="background:#3F9B6A">V</span><span>Tirage : végé au minimum</span><div class="stepper" style="margin-left:auto"><button id="vgM" aria-label="Moins">−</button><span id="vgV">${settings.vegTarget}</span><button id="vgP" aria-label="Plus">+</button></div></div>
      <div class="rw"><span class="ico" style="background:#32ADE6">P</span><span>Tirage : poisson au minimum</span><div class="stepper" style="margin-left:auto"><button id="fsM" aria-label="Moins">−</button><span id="fsV">${settings.fishTarget}</span><button id="fsP" aria-label="Plus">+</button></div></div>
    </div>`;
  sec.parentNode.insertBefore(g,sec);
  $('#rowAisles').onclick=openAislesSheet; $('#rowStaples').onclick=openStaplesSheet;
  const st=(k,el,lbl,d)=>{ settings[k]=Math.max(0,Math.min(6,(settings[k]||0)+d)); saveSettings(); touch(); $(el).textContent=settings[k]; };
  $('#vgM').onclick=()=>st('vegTarget','#vgV','végé',-1); $('#vgP').onclick=()=>st('vegTarget','#vgV','végé',1);
  $('#fsM').onclick=()=>st('fishTarget','#fsV','poisson',-1); $('#fsP').onclick=()=>st('fishTarget','#fsV','poisson',1);
};
function openAislesSheet(){
  let order=aisleOrder().slice(); const sh=$('#sheet');
  const draw=()=>{ sh.innerHTML=`<div class="grab"></div>
    <div class="sh-head"><h3>Ordre des rayons</h3><button class="sh-x" id="alClose" aria-label="Fermer">${xSvg()}</button></div>
    <div class="sh-sub">Range les rayons dans l’ordre où tu traverses ton supermarché : la liste de courses suivra ton trajet.</div>
    <div class="grp" style="margin:0 16px">${order.map((a,i)=>`<div class="rw"><span class="tile">${i+1}</span><span class="b">${a}</span><button class="x" data-u="${i}" aria-label="Monter" ${i===0?'disabled style="opacity:.3"':''}><svg viewBox="0 0 24 24"><path d="M6 15l6-6 6 6" stroke-linecap="round" stroke-linejoin="round"/></svg></button><button class="x" data-d="${i}" aria-label="Descendre" ${i===order.length-1?'disabled style="opacity:.3"':''}><svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" stroke-linecap="round" stroke-linejoin="round"/></svg></button></div>`).join('')}</div>
    <div class="stack"><button class="btn wide" id="alReset">Ordre d’origine</button></div>`;
    sh.querySelectorAll('[data-u]').forEach(b=>b.onclick=()=>{ const i=+b.dataset.u; [order[i-1],order[i]]=[order[i],order[i-1]]; commit(); });
    sh.querySelectorAll('[data-d]').forEach(b=>b.onclick=()=>{ const i=+b.dataset.d; [order[i+1],order[i]]=[order[i],order[i+1]]; commit(); });
    $('#alReset').onclick=()=>{ order=AISLE_ORDER.slice(); commit(); };
    $('#alClose').onclick=()=>{ renderSettingsSheet(); }; };
  const commit=()=>{ settings.aisles=order.slice(); saveSettings(); touch(); renderShop(); draw(); };
  draw(); openSheet();
}
function openStaplesSheet(){
  const sh=$('#sheet');
  const draw=()=>{ const list=settings.staples||[];
    sh.innerHTML=`<div class="grab"></div>
    <div class="sh-head"><h3>Produits de base</h3><button class="sh-x" id="spClose" aria-label="Fermer">${xSvg()}</button></div>
    <div class="sh-sub">Ce que tu rachètes presque chaque semaine. Un geste dans Courses les ajoute tous à la liste.</div>
    <div class="search" style="margin:0 16px 10px"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" stroke-linecap="round"/></svg><input id="spInput" type="text" placeholder="Lait, pain, café…" autocomplete="off" enterkeyhint="done"></div>
    ${list.length?`<div class="grp" style="margin:0 16px">${list.map((n,i)=>`<div class="rw"><span class="tile">${pantryEmo(n)}</span><span class="b">${escapeHtml(n)}</span><button class="x" data-i="${i}" aria-label="Retirer"><svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12" stroke-linecap="round"/></svg></button></div>`).join('')}</div>`:'<div class="sh-sub">Aucun pour l’instant.</div>'}
    <div class="sec" style="padding-top:10px"><span>Idées</span></div>
    <div class="fopts" style="padding:0 16px">${['lait','pain','café','œufs','beurre','yaourts','bananes','pommes','fromage râpé','papier toilette','liquide vaisselle'].filter(x=>!list.some(l=>norm(l)===norm(x))).map(x=>`<button class="fopt" data-add="${x}">+ ${x}</button>`).join('')}</div>`;
    const add=v=>{ v=v.trim(); if(!v) return; if(!(settings.staples||[]).some(l=>norm(l)===norm(v))){ settings.staples=[...(settings.staples||[]),v]; saveSettings(); touch(); } draw(); setTimeout(()=>{ const i=$('#spInput'); if(i) i.focus(); },30); };
    $('#spInput').addEventListener('keydown',e=>{ if(e.key==='Enter') add(e.target.value); });
    sh.querySelectorAll('[data-add]').forEach(b=>b.onclick=()=>add(b.dataset.add));
    sh.querySelectorAll('[data-i]').forEach(b=>b.onclick=()=>{ settings.staples.splice(+b.dataset.i,1); saveSettings(); touch(); draw(); });
    $('#spClose').onclick=()=>{ renderSettingsSheet(); renderShop(); }; };
  draw(); openSheet();
}
function addStaples(){
  const list=settings.staples||[]; let n=0;
  list.forEach(v=>{ if(!freeItems.some(f=>norm(f.name)===norm(v))){ freeItems.push({name:v}); n++; } });
  save(LS.freeShop,freeItems); touch(); renderShop(); toast(n?n+' produit'+(n>1?'s':'')+' de base ajouté'+(n>1?'s':''):'Déjà dans la liste');
}
/* courses : un bandeau pour les produits de base */
const _renderShop=renderShop;
renderShop=function(){
  _renderShop();
  const list=settings.staples||[]; const old=$('#staplesBar'); if(old) old.remove();
  const missing=list.filter(v=>!freeItems.some(f=>norm(f.name)===norm(v)));
  const bar=document.createElement('div'); bar.id='staplesBar'; bar.className='sec'; bar.style.textTransform='none';
  if(!list.length) bar.innerHTML=`<span></span><button type="button" id="stpSet">Définir mes produits de base</button>`;
  else if(missing.length) bar.innerHTML=`<span>${missing.slice(0,3).join(', ')}${missing.length>3?'…':''}</span><button type="button" id="stpAdd">+ Produits de base</button>`;
  else return;
  const fa=$('#freeAdd'); fa.parentNode.insertBefore(bar,fa.nextSibling);
  const a=$('#stpAdd'); if(a) a.onclick=addStaples; const s=$('#stpSet'); if(s) s.onclick=openStaplesSheet;
};

/* ================= PHOTOS PERSO ================= */
function resizeToDataURL(file,maxW,maxH,q){
  return new Promise((res,rej)=>{ const img=new Image(); const url=URL.createObjectURL(file);
    img.onload=()=>{ const r=Math.max(maxW/img.width,maxH/img.height); const w=img.width*r,h=img.height*r;
      const c=document.createElement('canvas'); c.width=maxW; c.height=maxH; const x=c.getContext('2d');
      x.drawImage(img,(maxW-w)/2,(maxH-h)/2,w,h); URL.revokeObjectURL(url); res(c.toDataURL('image/jpeg',q)); };
    img.onerror=()=>{ URL.revokeObjectURL(url); rej(new Error('image illisible')); }; img.src=url; });
}
function saveUserPhotos(){ try{ localStorage.setItem('cd_userPhotos',JSON.stringify(userPhotos)); return true; }catch(e){ toast('Plus de place sur l’appareil pour une nouvelle photo'); return false; } }
const _openRecipeDetail=openRecipeDetail;
openRecipeDetail=function(id){
  _openRecipeDetail(id);
  const hero=document.querySelector('#sheet .rd-hero'); if(!hero) return;
  const own=!!userPhotos[id];
  hero.insertAdjacentHTML('beforeend',`<label class="cb photo" title="Ma photo"><input type="file" accept="image/*" capture="environment" id="rdPhoto" hidden><svg viewBox="0 0 24 24"><path d="M4 8h3l2-3h6l2 3h3v11H4z" stroke-linejoin="round"/><circle cx="12" cy="13" r="3.5"/></svg><span>${own?'Changer':'Ma photo'}</span></label>${own?'<button class="cb photo2" id="rdPhotoDel" title="Revenir à la photo du catalogue">Photo d’origine</button>':''}`);
  const r=byId(id);
  const kic=document.querySelector('#sheet .rd .kic'); if(kic&&r&&isSeasonal(r)&&!isDessert(r)) kic.insertAdjacentHTML('beforeend',' · <span style="color:var(--ok)">de saison</span>');
  $('#rdPhoto').onchange=async e=>{ const f=e.target.files[0]; if(!f) return;
    try{ userPhotos[id]=await resizeToDataURL(f,640,480,.72); if(saveUserPhotos()){ touch(); toast('Photo enregistrée'); rebuildPhotos(); openRecipeDetail(id); } }catch(err){ toast('Cette image ne peut pas être lue'); } };
  const d=$('#rdPhotoDel'); if(d) d.onclick=()=>{ delete userPhotos[id]; saveUserPhotos(); touch(); rebuildPhotos(); openRecipeDetail(id); };
};
function rebuildPhotos(){ renderRecipes(); renderWeek(); renderFridge(); }

/* ================= IMPORT : coller une recette ================= */
function parsePastedRecipe(text){
  const lines=text.replace(/\r/g,'').split('\n').map(l=>l.replace(/^[\s•\-–\*·▢☐]+/,'').trim());
  let title='',portions=4,time=30,ings=[],steps=[],mode=null;
  const isIngHead=l=>/^(ingr[ée]dients?|il vous faut|pour \d+ ?(personnes|pers|portions))\b/i.test(l);
  const isStepHead=l=>/^(pr[ée]paration|[ée]tapes?|instructions?|recette|m[ée]thode|d[ée]roul[ée])\b/i.test(l);
  const qtyLine=/^(\d+[.,\/]?\d*|½|¼|¾|un|une|deux|trois|quatre)\s*(g|kg|ml|cl|l|c\.? ?à ?(soupe|café)|cuill[eè]res?( à (soupe|café))?|cs|cc|tasses?|bo[iî]tes?|gousses?|pinc[ée]es?|tranches?|sachets?|brins?|feuilles?|poign[ée]es?)?\b/i;
  lines.forEach(l=>{
    if(!l) return;
    const pm=l.match(/(\d+)\s*(personnes|pers\.?|portions|parts)/i); if(pm&&!steps.length) portions=+pm[1];
    const tm=l.match(/(\d+)\s*(min|minutes)\b/i); if(tm&&!steps.length&&/(temps|pr[ée]paration|cuisson|total)/i.test(l)) time=+tm[1];
    if(isIngHead(l)){ mode='i'; return; } if(isStepHead(l)&&l.length<40){ mode='s'; return; }
    if(!title){ title=l.replace(/\s*[:|].*$/,''); return; }
    if(/^(temps|cuisson|pr[ée]paration|portions|difficult[ée]|co[uû]t|repos)[^:]{0,30}:/i.test(l)) return;
    const numbered=l.match(/^(\d+)[.)]\s+(.+)/);
    if(mode==='s'||numbered||(l.length>70&&mode!=='i')){ steps.push(numbered?numbered[2]:l); mode=mode||'s'; return; }
    if(mode==='i'||qtyLine.test(l)||l.length<45){ const p=parseIngLine(l.replace(/^(un|une)\s/i,'1 ').replace(/^½/,'0.5 ').replace(/^¼/,'0.25 ')); if(p) ings.push(p); return; }
    steps.push(l);
  });
  return {title,portions,time,ingredients:ings,steps};
}
const _openRecipeForm=openRecipeForm;
openRecipeForm=function(existing){
  _openRecipeForm(existing);
  if(existing) return;
  const body=document.querySelector('#sheet .sh-body'); if(!body) return;
  body.insertAdjacentHTML('afterbegin',`<div class="frow"><label>Coller une recette (facultatif)</label><textarea id="rfPaste" placeholder="Copie une recette depuis un site, un message ou une note, colle-la ici : les champs se remplissent tout seuls."></textarea><button type="button" class="btn sub wide" id="rfParse" style="margin-top:8px">Remplir à partir du texte</button></div>`);
  $('#rfParse').onclick=()=>{ const t=$('#rfPaste').value.trim(); if(!t){ toast('Colle d’abord un texte'); return; }
    const r=parsePastedRecipe(t);
    if(r.title) $('#rfTitle').value=r.title; $('#rfPortions').value=r.portions; $('#rfTime').value=r.time;
    $('#rfIng').value=r.ingredients.map(fmtIngLine).join('\n'); $('#rfSteps').value=r.steps.join('\n');
    toast(r.ingredients.length+' ingrédients et '+r.steps.length+' étapes trouvés, vérifie avant d’enregistrer'); };
};

/* ================= HORS LIGNE ================= */
if('serviceWorker' in navigator && location.protocol==='https:'){
  window.addEventListener('load',()=>{ navigator.serviceWorker.register('sw.js').catch(()=>{}); });
}

/* liaisons faites par app.js avant que ces fonctions soient remplacées */
$('#weekRandomBtn').onclick=randomWeek;
const pb=$('#planBtn'); if(pb) pb.onclick=()=>{ autoPlan(true); touch(); renderWeek(); toast('Recettes réparties sur les sept prochains jours'); };
/* premier rendu avec les nouvelles fonctions */
(function(){ if(document.getElementById('days')){ autoPlan(false); renderChips(); renderRecipes(); renderWeek(); renderShop(); renderFridge(); } })();
