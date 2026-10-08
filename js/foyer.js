/* Cookie Do : foyer partagé (3.6).
   Deux comptes (ou plus) partagent le menu de la semaine, le plan des repas, la liste de courses
   et le stock, via la table Supabase shared_lists. Chacun garde ses favoris, notes et photos.
   Fusion à trois voies : ce que j'ai changé depuis la dernière synchro s'applique par-dessus
   ce que l'autre a changé, champ par champ et article par article, pour que deux personnes
   qui cochent en même temps au supermarché ne s'écrasent pas. */

const FOYER_KEY='cd_foyer';            // {id, code}
const FOYER_BASE='cd_foyer_base';      // dernier état commun connu
let foyer=load(FOYER_KEY,null);
let foyerBase=load(FOYER_BASE,null);
let foyerBusy=false, foyerTimer=null, foyerPoll=null, foyerErr='';

/* ---- les champs partagés et leur forme ---- */
function foyerLocal(){
  return JSON.parse(JSON.stringify({selection:[...selection], shopChecked:[...shopChecked], removedShop:[...removedShopItems], freeShop:freeItems, pantry, plan, acquired:acquiredItems, history}));
}
function foyerApplyLocal(d){
  d=JSON.parse(JSON.stringify(d)); // jamais le même objet que la base commune
  if(Array.isArray(d.selection)) selection=new Set(d.selection);
  if(Array.isArray(d.shopChecked)) shopChecked=new Set(d.shopChecked);
  if(Array.isArray(d.removedShop)) removedShopItems=new Set(d.removedShop);
  if(Array.isArray(d.freeShop)) freeItems=d.freeShop;
  if(Array.isArray(d.pantry)) pantry=d.pantry;
  if(d.plan&&typeof d.plan==='object') plan=d.plan;
  if(d.acquired&&typeof d.acquired==='object') acquiredItems=d.acquired;
  if(Array.isArray(d.history)) history=d.history;
  save(LS.selection,[...selection]); save(LS.shopChecked,[...shopChecked]); save(LS.removedShop,[...removedShopItems]);
  save(LS.freeShop,freeItems); save(LS.pantry,pantry); save('cd_plan',plan); save('mm_acquired',acquiredItems); save(LS.history,history);
}
const keyOf={freeShop:x=>norm(x.name), pantry:x=>norm(x.name)+'|'+(x.unit||''), history:x=>x.id+'|'+x.date};
/* fusion d'un ensemble : remote + (ajouts locaux) - (retraits locaux) */
function mergeSet(base,loc,rem){ const B=new Set(base||[]),L=new Set(loc||[]),out=new Set(rem||[]);
  L.forEach(x=>{ if(!B.has(x)) out.add(x); }); B.forEach(x=>{ if(!L.has(x)) out.delete(x); }); return [...out]; }
/* fusion d'une liste d'objets identifiés par une clé : l'objet modifié localement gagne */
function mergeList(base,loc,rem,kf){ const m=a=>{ const o=new Map(); (a||[]).forEach(x=>o.set(kf(x),x)); return o; };
  const B=m(base),L=m(loc),R=m(rem);
  L.forEach((v,k)=>{ if(!B.has(k)||JSON.stringify(B.get(k))!==JSON.stringify(v)) R.set(k,v); });
  B.forEach((v,k)=>{ if(!L.has(k)) R.delete(k); });
  return [...R.values()]; }
function mergeObj(base,loc,rem){ base=base||{}; loc=loc||{}; const out=Object.assign({},rem||{});
  new Set([...Object.keys(base),...Object.keys(loc)]).forEach(k=>{ const b=JSON.stringify(base[k]),l=JSON.stringify(loc[k]);
    if(b!==l){ if(loc[k]===undefined) delete out[k]; else out[k]=loc[k]; } });
  return out; }
function foyerMerge(base,loc,rem){
  base=base||{}; rem=rem||{};
  return {
    selection:mergeSet(base.selection,loc.selection,rem.selection),
    shopChecked:mergeSet(base.shopChecked,loc.shopChecked,rem.shopChecked),
    removedShop:mergeSet(base.removedShop,loc.removedShop,rem.removedShop),
    freeShop:mergeList(base.freeShop,loc.freeShop,rem.freeShop,keyOf.freeShop),
    pantry:mergeList(base.pantry,loc.pantry,rem.pantry,keyOf.pantry),
    history:mergeList(base.history,loc.history,rem.history,keyOf.history),
    plan:mergeObj(base.plan,loc.plan,rem.plan),
    acquired:mergeObj(base.acquired,loc.acquired,rem.acquired)
  };
}

/* ---- accès Supabase ---- */
async function foyerApi(path,opts={}){
  if(!Sync.session) throw new Error('Connecte-toi d’abord à ton compte');
  try{ await Sync.refreshIfNeeded(); }catch(e){}
  const h={'apikey':SUPA_KEY,'Authorization':'Bearer '+Sync.session.access_token,'Content-Type':'application/json'};
  if(opts.prefer) h['Prefer']=opts.prefer;
  const r=await fetch(SUPA_URL+path,{method:opts.method||'GET',headers:h,body:opts.body?JSON.stringify(opts.body):undefined});
  const txt=await r.text(); let j=null; try{ j=txt?JSON.parse(txt):null; }catch(e){}
  if(!r.ok){ const msg=(j&&(j.message||j.hint))||('erreur '+r.status);
    if(/permission denied/i.test(msg)) throw new Error('La base refuse l’accès au foyer : il manque la ligne « grant » dans Supabase.');
    throw new Error(msg); }
  return j;
}
function newCode(){ const A='ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s=''; for(let i=0;i<6;i++) s+=A[Math.floor(Math.random()*A.length)]; return s; }
function setFoyer(f){ foyer=f; if(f) save(FOYER_KEY,f); else { try{localStorage.removeItem(FOYER_KEY);localStorage.removeItem(FOYER_BASE);}catch(e){} foyerBase=null; } foyerStartPoll(); }
async function foyerCreate(){
  const data=foyerLocal(); let row=null;
  for(let i=0;i<4&&!row;i++){
    try{ const r=await foyerApi('/rest/v1/shared_lists',{method:'POST',prefer:'return=representation',body:{code:newCode(),data}}); row=r&&r[0]; }
    catch(e){ if(!/duplicate|unique/i.test(e.message)) throw e; }
  }
  if(!row) throw new Error('Création impossible, réessaie');
  foyerBase=JSON.parse(JSON.stringify(data)); save(FOYER_BASE,foyerBase); setFoyer({id:row.id,code:row.code});
  return row.code;
}
async function foyerJoin(code){
  code=String(code||'').trim().toUpperCase().replace(/[^A-Z0-9]/g,'');
  if(code.length!==6) throw new Error('Le code fait six caractères');
  const id=await foyerApi('/rest/v1/rpc/join_shared_list',{method:'POST',body:{p_code:code}});
  if(!id||typeof id!=='string') throw new Error('Aucun foyer avec ce code');
  setFoyer({id,code}); foyerBase=null;
  /* en rejoignant, on garde ce qu'on avait de son côté et on le fusionne avec le foyer */
  foyerBase={}; await foyerSync(); rebuild();
}
function foyerLeave(){ setFoyer(null); toast('Tu as quitté le foyer. Tes données restent sur ce téléphone.'); }

/* lire, fusionner, écrire : une seule synchro à la fois. L'écriture ne passe que si la ligne
   n'a pas changé depuis la lecture (updated_at), sinon on relit et on refusionne. */
async function foyerSync(){
  if(!foyer||!Sync.session||foyerBusy) return;
  foyerBusy=true;
  try{
    for(let attempt=0;attempt<4;attempt++){
      const rows=await foyerApi('/rest/v1/shared_lists?select=data,updated_at&id=eq.'+foyer.id);
      if(!rows||!rows.length){ foyerErr='Ce foyer n’existe plus'; return; }
      const rem=rows[0].data||{}, rev=rows[0].updated_at; const loc=foyerLocal();
      const merged=foyerMerge(foyerBase,loc,rem);
      if(JSON.stringify(merged)!==JSON.stringify(rem)){
        const w=await foyerApi('/rest/v1/shared_lists?id=eq.'+foyer.id+'&updated_at=eq.'+encodeURIComponent(rev),{method:'PATCH',prefer:'return=representation',body:{data:merged,updated_at:new Date().toISOString()}});
        if(!w||!w.length){ await new Promise(r=>setTimeout(r,150+Math.random()*300)); continue; } // quelqu'un a écrit entre-temps
      }
      foyerBase=JSON.parse(JSON.stringify(merged)); save(FOYER_BASE,foyerBase);
      if(JSON.stringify(merged)!==JSON.stringify(loc)){ foyerApplyLocal(merged); foyerRerender(); }
      foyerErr=''; return;
    }
    foyerErr='Synchro du foyer en attente, nouvel essai bientôt';
  }catch(e){ foyerErr=e.message; }
  finally{ foyerBusy=false; }
}
function foyerRerender(){ refreshSelUI(); renderRecipes(); renderShop(); renderWeek(); renderFridge(); }
function foyerSchedule(){ if(!foyer) return; clearTimeout(foyerTimer); foyerTimer=setTimeout(foyerSync,900); }
function foyerStartPoll(){ clearInterval(foyerPoll); if(!foyer) return;
  foyerPoll=setInterval(()=>{ if(document.visibilityState==='visible') foyerSync(); }, currentView==='shop'?4000:10000); }
document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='visible') foyerSync(); });
window.addEventListener('online',()=>foyerSync());

/* chaque modification locale part vers le foyer */
const _touch=touch;
touch=function(){ _touch(); foyerSchedule(); };
/* au supermarché, on rafraîchit plus souvent */
const _switchView=switchView;
switchView=function(v){ _switchView(v); foyerStartPoll(); if(v==='shop') foyerSync(); };
$$('.tab').forEach(t=>t.onclick=()=>{ if(currentView===t.dataset.view) window.scrollTo({top:0,behavior:'smooth'}); else switchView(t.dataset.view); });

/* ---- Réglages : rubrique Foyer ---- */
const _renderSettingsSheet2=renderSettingsSheet;
renderSettingsSheet=function(){
  _renderSettingsSheet2();
  const sec=[...document.querySelectorAll('#sheet .sec')].find(x=>x.textContent.trim()==='Compte');
  const g=document.createElement('div'); g.id='foyerBox';
  sec.parentNode.insertBefore(g,sec);
  drawFoyerBox();
};
function drawFoyerBox(){
  const g=$('#foyerBox'); if(!g) return;
  const logged=Sync.enabled&&Sync.session;
  let inner;
  if(!logged) inner=`<div class="rw"><span class="ico" style="background:#FF6B6B"><svg viewBox="0 0 24 24"><path d="M3 11l9-7 9 7v9H3z" stroke-linejoin="round"/></svg></span><div class="b"><div class="t" style="font-weight:500">Foyer partagé</div><div class="m">Connecte-toi à ton compte (plus bas) pour partager le menu, les courses et le stock avec quelqu’un.</div></div></div>`;
  else if(!foyer) inner=`<div class="rw"><span class="ico" style="background:#FF6B6B"><svg viewBox="0 0 24 24"><path d="M3 11l9-7 9 7v9H3z" stroke-linejoin="round"/></svg></span><div class="b"><div class="t" style="font-weight:500">Foyer partagé</div><div class="m">Le même menu, les mêmes courses et le même stock sur deux téléphones, cochés en direct.</div></div></div>
      <div class="rw" id="fyCreate" style="color:var(--accT);font-weight:600;cursor:pointer">Créer un foyer</div>
      <div class="rw" style="gap:8px"><input id="fyCode" placeholder="Code reçu (6 lettres)" maxlength="7" autocapitalize="characters" autocomplete="off" style="flex:1;border:1px solid var(--ln);border-radius:9px;padding:8px 10px;background:var(--sur2);font-size:16px;text-transform:uppercase;min-width:0"><button class="go" id="fyJoin">Rejoindre</button></div>`;
  else inner=`<div class="rw"><span class="ico" style="background:#FF6B6B"><svg viewBox="0 0 24 24"><path d="M3 11l9-7 9 7v9H3z" stroke-linejoin="round"/></svg></span><div class="b"><div class="t" style="font-weight:500">Foyer partagé</div><div class="m ${foyerErr?'warn':'ok'}">${foyerErr?escapeHtml(foyerErr):'Menu, courses et stock partagés'}</div></div></div>
      <div class="rw"><div class="b"><div class="m">Code à donner à l’autre personne</div><div class="t mono" style="font-size:22px;letter-spacing:.18em">${foyer.code}</div></div><button class="go" id="fyCopy">Copier</button></div>
      <div class="rw" id="fyLeave" style="color:var(--red);cursor:pointer">Quitter le foyer</div>`;
  g.innerHTML=`<div class="sec"><span>Foyer</span></div><div class="grp" style="margin:0 16px">${inner}</div>`;
  const c=$('#fyCreate'); if(c) c.onclick=async()=>{ c.textContent='Création…'; try{ const code=await foyerCreate(); toast('Foyer créé, code '+code); }catch(e){ toast(e.message); } drawFoyerBox(); };
  const j=$('#fyJoin'); if(j) j.onclick=async()=>{ j.textContent='…'; try{ await foyerJoin($('#fyCode').value); toast('Foyer rejoint'); }catch(e){ toast(e.message); } drawFoyerBox(); };
  const cp=$('#fyCopy'); if(cp) cp.onclick=()=>{ copy('Rejoins mon foyer sur Cookie Do (Réglages, Foyer) avec le code '+foyer.code+' : https://cookie-do.netlify.app'); toast('Code copié'); };
  const l=$('#fyLeave'); if(l) l.onclick=()=>{ if(confirm('Quitter le foyer ? Le menu et la liste ne seront plus partagés.')){ foyerLeave(); drawFoyerBox(); } };
}
/* courses : rappeler que la liste est partagée */
const _renderShop2=renderShop;
renderShop=function(){ _renderShop2(); if(foyer){ const s=$('#shopSub'); if(s&&!s.querySelector('.fy')) s.insertAdjacentHTML('beforeend',' <span class="fy" style="color:var(--accT)">· partagée</span>'); } };
/* déconnexion : on quitte aussi le foyer sur cet appareil */
const _doSignOut=doSignOut;
doSignOut=async function(){ setFoyer(null); return _doSignOut(); };

foyerStartPoll(); if(foyer) foyerSync();
