/* ============ Supabase sync (email login + one JSON row per user) ============ */
const Sync = (()=> {
  const enabled = SUPA_URL && SUPA_URL.indexOf('http')===0 && SUPA_KEY && SUPA_KEY.length>20;
  let session = load('mm_session', null);   // {access_token,refresh_token,user:{id,email},expires_at}
  let status = 'off';                        // off | on | syncing | err
  let onChange = ()=>{};
  let pushTimer = null;
  let lastError=null, lastStatus=0;
  let lastServerUpdated = load('mm_serverUpdated', 0);

  function setStatus(s){ status=s; onChange(status, session&&session.user); }
  function headers(auth){
    const h={'apikey':SUPA_KEY,'Content-Type':'application/json'};
    if(auth && session) h['Authorization']='Bearer '+session.access_token;
    else h['Authorization']='Bearer '+SUPA_KEY;
    return h;
  }
  async function api(path, opts={}){
    const res = await fetch(SUPA_URL+path, opts);
    let body=null; try{ body=await res.json(); }catch(e){}
    return {ok:res.ok, status:res.status, body};
  }

  // ---- auth ----
  async function signUp(email,password){
    const r=await api('/auth/v1/signup',{method:'POST',headers:headers(false),body:JSON.stringify({email,password})});
    if(!r.ok) throw new Error(r.body&&(r.body.msg||r.body.error_description||r.body.message)||'Inscription impossible');
    // if email confirmation is off, session comes back directly
    if(r.body.access_token){ setSession(r.body); return {confirmed:true}; }
    return {confirmed:false};
  }
  async function signIn(email,password){
    const r=await api('/auth/v1/token?grant_type=password',{method:'POST',headers:headers(false),body:JSON.stringify({email,password})});
    if(!r.ok) throw new Error(r.body&&(r.body.error_description||r.body.msg||r.body.message)||'Connexion impossible');
    setSession(r.body); return true;
  }
  async function resetPassword(email){
    const r=await api('/auth/v1/recover',{method:'POST',headers:headers(false),body:JSON.stringify({email})});
    if(!r.ok) throw new Error('Envoi impossible'); return true;
  }
  function setSession(s){
    session={access_token:s.access_token,refresh_token:s.refresh_token,user:s.user,expires_at:Date.now()+((s.expires_in||3600)*1000)};
    save('mm_session',session); setStatus('on');
  }
  function signOut(){ session=null; save('mm_session',null); setStatus('off'); }
  async function refreshIfNeeded(){
    if(!session) return false;
    if(Date.now() < session.expires_at-60000) return true;
    const r=await api('/auth/v1/token?grant_type=refresh_token',{method:'POST',headers:headers(false),body:JSON.stringify({refresh_token:session.refresh_token})});
    if(r.ok && r.body.access_token){ setSession(r.body); return true; }
    signOut(); return false;
  }

  // ---- data row: table app_state (user_id uuid pk, data jsonb, updated_at) ----
  async function pull(){
    if(!enabled||!session) return null;
    if(!(await refreshIfNeeded())) return null;
    setStatus('syncing');
    const r=await api('/rest/v1/app_state?select=data,updated_at&user_id=eq.'+session.user.id,{headers:headers(true)});
    if(r.ok){
      setStatus('on'); lastError=null;
      if(Array.isArray(r.body) && r.body.length){
        lastServerUpdated=new Date(r.body[0].updated_at).getTime();
        save('mm_serverUpdated',lastServerUpdated);
        return r.body[0].data;
      }
      return null;
    }
    // error
    setStatus('err');
    lastError = describeError(r);
    lastStatus = r.status;
    return null;
  }
  async function push(data){
    if(!enabled||!session) return false;
    if(!(await refreshIfNeeded())) return false;
    setStatus('syncing');
    const row={user_id:session.user.id, data, updated_at:new Date().toISOString()};
    const r=await api('/rest/v1/app_state?on_conflict=user_id',{
      method:'POST',
      headers:{...headers(true),'Prefer':'resolution=merge-duplicates,return=minimal'},
      body:JSON.stringify(row)
    });
    setStatus(r.ok?'on':'err');
    if(r.ok){ lastServerUpdated=Date.now(); save('mm_serverUpdated',lastServerUpdated); lastError=null; lastStatus=200; }
    else { lastError = describeError(r); lastStatus = r.status; }
    return r.ok;
  }
  function describeError(r){
    const b=r.body||{};
    const parts=[];
    if(b.message) parts.push(b.message);
    if(b.hint) parts.push('('+b.hint+')');
    if(b.details) parts.push(b.details);
    if(b.code) parts.push('code '+b.code);
    if(!parts.length) parts.push('HTTP '+r.status+(r.status===0?' (réseau/proxy)':''));
    return parts.join(' ');
  }
  function schedulePush(getData){
    if(!enabled||!session) return;
    clearTimeout(pushTimer);
    pushTimer=setTimeout(()=>{ push(getData()); }, 1200);
  }

  return {
    get enabled(){return enabled}, get status(){return status}, get session(){return session},
    get user(){return session&&session.user},
    set onChange(fn){onChange=fn}, setStatus, get lastError(){return lastError}, get lastStatus(){return lastStatus},
    signUp,signIn,signOut,resetPassword,pull,push,schedulePush,refreshIfNeeded
  };
})();


/* ============ Cookie Do · app logic ============ */
const LS = {
  custom:'mm_custom', selection:'mm_selection', shopChecked:'mm_shopChecked',
  history:'mm_history', cookState:'mm_cookState', fridge:'mm_fridge', pantry:'mm_pantry',
  favorites:'mm_favorites', ratings:'mm_ratings', prices:'mm_prices', removedShop:'mm_removedShop', freeShop:'mm_freeShop', notes:'mm_notes'
};
function load(k,d){ try{const v=localStorage.getItem(k);return v!=null?JSON.parse(v):d}catch(e){return d} }
function save(k,v){ try{localStorage.setItem(k,JSON.stringify(v))}catch(e){} }

/* ---- state ---- */
let customRecipes = load(LS.custom, []);
let allRecipes = [];
let selection = new Set(load(LS.selection, []));
let history = load(LS.history, []);
let shopChecked = new Set(load(LS.shopChecked, []));
let cookState = load(LS.cookState, {});
let favorites = new Set(load(LS.favorites, []));      // recipe ids
let ratings = load(LS.ratings, {});                    // {id: 1..5}
let prices = load(LS.prices, {});                      // {normalisedIngredientName: {price, qty, unit}} -> prix de référence
let removedShopItems = new Set(load(LS.removedShop, []));
/* Articles déjà rangés, avec leur date : {clé: timestamp}.
   Ils sont masqués de la liste en cours, mais PAS indéfiniment, ils
   expirent au bout d'une semaine et sont remis à zéro dès que la
   sélection de recettes change (nouvelle sélection = nouvelles courses). */
const ACQUIRED_TTL = 7*24*3600*1000;
let acquiredItems = migrateAcquired(load('mm_acquired', {}));
function migrateAcquired(raw){
  const now=Date.now(), out={};
  if(Array.isArray(raw)) raw.forEach(k=>{ out[k]=now; });          // ancien format
  else if(raw&&typeof raw==='object') Object.keys(raw).forEach(k=>{ if(now-raw[k]<ACQUIRED_TTL) out[k]=raw[k]; });
  return out;
}
function isAcquired(k){ return Object.prototype.hasOwnProperty.call(acquiredItems,k); }
function acquiredKeys(){ return Object.keys(acquiredItems); }
let freeItems = load(LS.freeShop, []);
let notes = load(LS.notes, {}); // clés d'articles retirés manuellement de la liste
/* pantry = inventaire : [{name, qty, unit, from:'manuel'|'courses', at}] */
let pantry = load(LS.pantry, null);
if(pantry==null){ // migrate old plain-name fridge list, if any
  const old=load(LS.fridge, []);
  pantry = Array.isArray(old) ? old.map(n=>({name:String(n), qty:1, unit:'', from:'manuel', at:Date.now()})) : [];
  save(LS.pantry, pantry);
}
function pantryNames(){ return pantry.map(p=>p.name); }

let searchTerm='', activeTag=null, showFavOnly=false, courseFilter='all', quickFilter=null, dietFilter=null, sortMode='default';

/* ---- réglages (sur l'appareil) ---- */
const SETTINGS_KEY='cd_settings';
let settings=Object.assign({theme:'system',persons:2,nz:true,hidePantry:false,bigText:false,aisles:null,staples:[],vegTarget:3,fishTarget:1},load(SETTINGS_KEY,{}));
/* menu jour par jour : {recetteId: ['2026-10-08|soir', ...]} */
let plan=load('cd_plan',{});
function saveSettings(){ save(SETTINGS_KEY,settings); try{localStorage.setItem('cd_theme',settings.theme);}catch(e){} applyTheme(); }
function applyTheme(){
  document.documentElement.setAttribute('data-theme',settings.theme||'system');
  document.body.classList.toggle('big',!!settings.bigText);
  const m=document.querySelector('meta[name="theme-color"]:not([media])');
  const dark=settings.theme==='dark'||(settings.theme==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);
  if(m) m.content=dark?'#000000':'#F2F2F7';
}
/* « 4 portions » lu en repas pour le foyer : 2 pers. × 2 repas */
function mealsLabel(portions){
  const n=Math.max(1,settings.persons||2);
  const meals=portions/n;
  const m=Math.round(meals*2)/2;
  if(m<1) return portions+' portion'+(portions>1?'s':'');
  return (Number.isInteger(m)?m:m.toFixed(1).replace('.',','))+' repas';
}

const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];

/* ---- cloud snapshot: gather + apply ---- */
function snapshot(){
  return {v:4, custom:customRecipes, selection:[...selection], shopChecked:[...shopChecked],
    history, cookState, pantry, favorites:[...favorites], ratings, prices, removedShop:[...removedShopItems], acquired:acquiredItems, freeShop:freeItems, notes, plan, userPhotos, prefs:{persons:settings.persons,aisles:settings.aisles,staples:settings.staples,vegTarget:settings.vegTarget,fishTarget:settings.fishTarget,nz:settings.nz,hidePantry:settings.hidePantry}, savedAt:Date.now()};
}
function applySnapshot(s){
  if(!s||typeof s!=='object') return;
  if(Array.isArray(s.custom)) customRecipes=s.custom;
  if(Array.isArray(s.selection)) selection=new Set(s.selection);
  if(Array.isArray(s.shopChecked)) shopChecked=new Set(s.shopChecked);
  if(Array.isArray(s.history)) history=s.history;
  if(s.cookState&&typeof s.cookState==='object') cookState=s.cookState;
  if(Array.isArray(s.pantry)) pantry=s.pantry;
  else if(Array.isArray(s.fridge)) pantry=s.fridge.map(n=>({name:String(n),qty:1,unit:'',from:'manuel',at:Date.now()}));
  if(Array.isArray(s.favorites)) favorites=new Set(s.favorites);
  if(s.ratings&&typeof s.ratings==='object') ratings=s.ratings;
  if(s.prices&&typeof s.prices==='object') prices=s.prices;
  if(Array.isArray(s.removedShop)) removedShopItems=new Set(s.removedShop);
  if(s.acquired) acquiredItems=migrateAcquired(s.acquired);
  if(Array.isArray(s.freeShop)) freeItems=s.freeShop;
  if(s.notes&&typeof s.notes==='object') notes=s.notes;
  if(s.plan&&typeof s.plan==='object') plan=s.plan;
  if(s.userPhotos&&typeof s.userPhotos==='object') userPhotos=Object.assign({},s.userPhotos,userPhotos);
  if(s.prefs&&typeof s.prefs==='object'){ Object.assign(settings,s.prefs); save(SETTINGS_KEY,settings); }
  save('cd_plan',plan); try{localStorage.setItem('cd_userPhotos',JSON.stringify(userPhotos));}catch(e){}
  save(LS.custom,customRecipes); save(LS.selection,[...selection]); save(LS.shopChecked,[...shopChecked]);
  save(LS.history,history); save(LS.cookState,cookState); save(LS.pantry,pantry);
  save(LS.favorites,[...favorites]); save(LS.ratings,ratings); save(LS.prices,prices); save(LS.removedShop,[...removedShopItems]); save('mm_acquired',acquiredItems); save(LS.freeShop,freeItems); save(LS.notes,notes);
  rebuild();
}
/* called after any local mutation -> persist + schedule cloud push */
function touch(){ if(Sync.enabled && Sync.session) Sync.schedulePush(snapshot); updateSyncDot(); }
/* favorites + ratings helpers */
function isFav(id){ return favorites.has(id); }
function toggleFav(id){ if(favorites.has(id))favorites.delete(id); else favorites.add(id); save(LS.favorites,[...favorites]); touch(); }
function getRating(id){ return ratings[id]||0; }
function setRating(id,n){ if(n===ratings[id]) n=0; /* tap same star clears */ if(n)ratings[id]=n; else delete ratings[id]; save(LS.ratings,ratings); touch(); }

/* ===== Protéines : estimation par portion et complément suggéré ===== */
const PROT_CIBLE=30;                     /* repère par repas principal */
const COMPLEMENTS=[
 {n:'un yaourt grec ou un skyr (150 g)',p:16},
 {n:'un pot de fromage blanc (150 g)',p:13},
 {n:'du cottage cheese (150 g)',p:18},
 {n:'deux œufs durs',p:13},
 {n:'une poignée d\'edamame (100 g)',p:11},
 {n:'un verre de lait (250 ml)',p:8},
 {n:'30 g de fromage',p:8},
 {n:'30 g d\'amandes',p:6},
 {n:'deux cuillères de beurre de cacahuète',p:8}
];
function protOf(id){return PROT[id]||0}
function protComplement(id){
  const p=protOf(id), manque=PROT_CIBLE-p;
  if(PROT_DESSERT[id]||manque<=3)return null;
  /* on cherche le complément unique le plus proche du manque */
  let best=null;
  COMPLEMENTS.forEach(c=>{const ecart=Math.abs(c.p-manque);
    if(!best||ecart<best.e)best={c,e:ecart}});
  const liste=COMPLEMENTS.filter(c=>Math.abs(c.p-manque)<=Math.max(5,best.e+2))
    .sort((a,b)=>Math.abs(a.p-manque)-Math.abs(b.p-manque)).slice(0,3);
  return {manque,total:p+best.c.p,choix:liste};
}
function protBadge(id){const p=protOf(id);if(!p)return '';
  return `<span class="prot-badge">${p} g prot.</span>`}

function starsHtml(id,{size='sm',interactive=false}={}){
  const cur=getRating(id);
  let h=`<span class="stars ${size} ${interactive?'interactive':''}" data-rate="${id}">`;
  for(let i=1;i<=5;i++) h+=`<span class="st star ${i<=cur?'on':''}" data-star="${i}"><svg viewBox="0 0 24 24"><path d="M12 2.5l2.9 6.2 6.8.8-5 4.7 1.3 6.8L12 17.7 5.9 21l1.3-6.8-5-4.7 6.8-.8z"/></svg></span>`;
  h+=`</span>`;
  return h;
}
function bindStars(root){
  (root||document).querySelectorAll('.stars.interactive').forEach(el=>{
    const id=el.dataset.rate;
    el.querySelectorAll('.star').forEach(s=>{
      s.onclick=(e)=>{
        e.stopPropagation(); e.preventDefault();
        setRating(id, +s.dataset.star);
        // update THIS group immediately so it works in any container (sheets, cards, prompt)
        const cur=getRating(id);
        el.querySelectorAll('.star').forEach(st=>st.classList.toggle('on', (+st.dataset.star)<=cur));
        rebuildAfterRating();
      };
    });
  });
}
function rebuildAfterRating(){ renderRecipes(); renderWeek(); renderHistory(); if(currentCook)renderCookBody(); }

/* ---- helpers ---- */
const byId=id=>allRecipes.find(r=>r.id===id);
function localDay(d=new Date()){ return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function daysSince(iso){ if(!iso)return 9999; const [y,m,dd]=iso.split('-').map(Number); const then=new Date(y,m-1,dd); return Math.floor((new Date()-then)/86400000); }
function lastMade(id){ const rows=history.filter(h=>h.id===id).map(h=>h.date).sort(); return rows.length?rows[rows.length-1]:null; }
function toast(msg){ const t=$('#toast'); t.textContent=msg; t.classList.add('show'); clearTimeout(t._t); t._t=setTimeout(()=>t.classList.remove('show'),2200); }
function checkSvg(){ return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M20 6 9 17l-5-5" stroke-linecap="round" stroke-linejoin="round"/></svg>'; }
/* icones d interface au trait, meme graphisme que les dessins de recettes */
function UI(path,sw){ return '<svg class="uic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="'+(sw||1.5)+'" stroke-linecap="round" stroke-linejoin="round">'+path+'</svg>'; }
const UI_ICONS={
  legumes:'<path d="M20.5 3.5c0 8.5-3.7 14.5-10.3 14.5-2.3 0-4-1.1-4-1.1S5.4 3.5 20.5 3.5z"/><path d="M4 20.5C7.5 14 11.5 10.6 16 8.6"/>',
  viande:'<path d="M7.8 4.2c3.8 0 6.9 3.1 6.9 6.9 0 2.1 1 2.6 2.4 3.3 1.6.8 2.6 2 2.6 3.6 0 2.2-1.8 3.8-4 3.8-5.9 0-15.5-4.7-15.5-11.1 0-3.8 3.8-6.5 7.6-6.5z"/><circle cx="8.4" cy="9.6" r="1.9"/>',
  frais:'<path d="M3.6 16.6v-5.4l16.8-3v8.4z"/><path d="M3.6 11.2 20.4 8.2"/><circle cx="9" cy="13.8" r="1.1"/><circle cx="15" cy="12.6" r="1.1"/>',
  oeufs:'<path d="M12 3.2c3.4 0 6.2 4.5 6.2 8.6A6.2 6.2 0 0 1 5.8 11.8c0-4.1 2.8-8.6 6.2-8.6z"/>',
  feculents:'<path d="M2.8 10.8h18.4c0 5.1-4.1 9.2-9.2 9.2s-9.2-4.1-9.2-9.2z"/><ellipse cx="8.2" cy="7.6" rx="1.6" ry="1"/><ellipse cx="12" cy="5.6" rx="1.6" ry="1"/><ellipse cx="15.8" cy="7.6" rx="1.6" ry="1"/>',
  conserves:'<ellipse cx="12" cy="6.2" rx="7" ry="2.6"/><path d="M5 6.2v11.6c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6V6.2"/><path d="M5 11.4c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6"/>',
  autres:'<path d="M9.4 3.6h5.2l1.2 4.2H8.2z"/><path d="M8.2 7.8 6.6 20.4h10.8L15.8 7.8"/><circle cx="10.6" cy="12.6" r=".8" fill="currentColor" stroke="none"/><circle cx="13.6" cy="15.4" r=".8" fill="currentColor" stroke="none"/>',
  frigo:'<path d="M6 2.8h12a1.2 1.2 0 0 1 1.2 1.2v16a1.2 1.2 0 0 1-1.2 1.2H6A1.2 1.2 0 0 1 4.8 20V4A1.2 1.2 0 0 1 6 2.8z"/><path d="M4.8 9.6h14.4M8.2 6v1.4M8.2 12.4v2.4"/>',
  oeil:'<path d="M2.4 12S5.9 5.6 12 5.6 21.6 12 21.6 12 18.1 18.4 12 18.4 2.4 12 2.4 12z"/><circle cx="12" cy="12" r="2.9"/>',
  loupe:'<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  panier:'<path d="M6.4 8.4h11.2l1.6 10.2a1.8 1.8 0 0 1-1.8 2.1H6.6a1.8 1.8 0 0 1-1.8-2.1z"/><path d="M9 8.4V6.2a3 3 0 0 1 6 0v2.2"/>',
  chariot:'<path d="M2.6 3.6h2.6l2.6 11.2h9.6l2-7.6H6.2"/><circle cx="9.4" cy="19.4" r="1.5"/><circle cx="17" cy="19.4" r="1.5"/>',
  assiette:'<circle cx="12" cy="12" r="8.6"/><circle cx="12" cy="12" r="5.4"/>',
  calendrier:'<rect x="3.4" y="5" width="17.2" height="15.6" rx="2.2"/><path d="M3.4 10h17.2M8.2 3v3.6M15.8 3v3.6"/>',
  coeur:'<path d="M12 20.6s-7-4.3-9.3-8.7C1.3 8.6 2.7 5.4 5.8 5.4c1.9 0 3.1 1.1 3.9 2.3.8-1.2 2-2.3 3.9-2.3 3.1 0 4.5 3.2 3.1 6.5-2.3 4.4-6.7 8.7-6.7 8.7z"/>',
  piece:'<circle cx="12" cy="12" r="8.4"/><path d="M14.6 9.2c-.6-.8-1.6-1.3-2.6-1.3-1.6 0-2.6.9-2.6 2s.9 1.7 2.6 2 2.6.9 2.6 2-1 2-2.6 2c-1 0-2-.5-2.6-1.3M12 6.4v11.2"/>',
  ampoule:'<path d="M9.4 17.6h5.2M10.2 20.6h3.6"/><path d="M12 3.4a5.8 5.8 0 0 1 3.6 10.3c-.6.5-.9 1.1-.9 1.8H9.3c0-.7-.3-1.3-.9-1.8A5.8 5.8 0 0 1 12 3.4z"/>',
  lait:'<path d="M9 2.8h6v2.6l2.2 3.4v10a1.8 1.8 0 0 1-1.8 1.8H7.6a1.8 1.8 0 0 1-1.8-1.8v-10L8 5.4V2.8z"/><path d="M5.8 12.2h12.4"/>'
};
function uiIcon(k,sw){ return UI(UI_ICONS[k]||'',sw); }
/* photos des plats : fichiers du dossier photos/, repli sur le dessin au trait */
/* photos perso (prises sur le téléphone) : id -> dataURL jpeg, prioritaires sur le catalogue */
let userPhotos=load('cd_userPhotos',{});
function photoSrc(id){ return userPhotos[id]||('photos/'+id+'.jpg'); }
function hasPhoto(id){ return !!userPhotos[id]||PHOTOS.has(id); }
function photoHtml(id,cls){ return hasPhoto(id)?`<img class="ph ${cls||''}" src="${photoSrc(id)}" alt="" loading="lazy" decoding="async" onerror="this.remove()">`:''; }
function photoOrEmoji(id,cls){ const r=byId(id); return hasPhoto(id)?photoHtml(id,cls):`<div class="noph">${r?recipeEmoji(r):''}</div>`; }
function kicker(r){
  const t=r.tags||[]; const parts=[];
  if(t.includes('végé')) parts.push('Végé'); else if(t.includes('poisson')) parts.push('Poisson'); else if(t.includes('poulet')) parts.push('Poulet'); else if(t.includes('porc')) parts.push('Porc'); else if(t.includes('viande')||t.includes('boeuf')) parts.push('Viande');
  if(isDessert(r)) parts.push('Dessert');
  if(t.includes('four')) parts.push('four'); else if(t.includes('une poêle')) parts.push('une poêle'); else if(t.includes('sans cuisson')) parts.push('sans cuisson');
  return parts.join(' · ');
}
function xSvg(){ return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M18 6 6 18M6 6l12 12" stroke-linecap="round"/></svg>'; }
function fmtQty(n){
  if(n==null)return '';
  const r=Math.round(n*100)/100;
  if(Math.abs(r-Math.round(r))<0.02)return String(Math.round(r));
  const frac={0.25:'¼',0.33:'⅓',0.5:'½',0.66:'⅔',0.75:'¾'};
  const whole=Math.floor(r),rem=Math.round((r-whole)*100)/100;
  for(const[k,v]of Object.entries(frac)){if(Math.abs(rem-Number(k))<0.04)return(whole?whole:'')+v;}
  return String(r);
}
function norm(s){ return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim(); }

/* ---- servings scaling + cost ---- */
/* effective servings for a recipe (user override or its base) */
function servingsFor(r){ const cs=cookState[r.id]; return (cs&&cs.servings)||r.portions; }
function scaleFactor(r){ return servingsFor(r)/r.portions; }
/* scaled quantity of an ingredient for current servings */
function scaledQty(r, q){ if(q==null)return null; return q*scaleFactor(r); }
/* price reference key for an ingredient name */
function priceKey(item){ return norm(baseIngredientName(item)); }
/* estimated cost of one ingredient line at given quantity, using stored reference prices.
   prices[key] = {price, qty, unit} meaning "price for qty unit". Cost = price * (needed/qty). */
function ingredientCost(item, qty, unit){
  const p=prices[priceKey(item)];
  if(!p||!p.price)return null;
  if(qty==null||!p.qty){ return p.price; } // flat price (e.g. per unit/bunch)
  // same-unit ratio; if units differ we still ratio the numbers (best effort)
  return p.price*(qty/p.qty);
}
/* total estimated cost of a recipe at current servings; returns {total, perServing, known, unknown} */
function recipeCost(r){
  let total=0, known=0, unknown=0;
  r.ingredients.forEach(([q,u,item])=>{
    if(isStaple(item)){ return; } // staples (sel, poivre, huile...) ignorés
    const c=ingredientCost(item, scaledQty(r,q), u);
    if(c==null){ unknown++; } else { total+=c; known++; }
  });
  const s=servingsFor(r);
  return {total, perServing: s?total/s:0, known, unknown};
}
function fmtPrice(n){ return '$'+(Math.round(n*100)/100).toFixed(2); }
/* playful: emoji + colour category per recipe */
function recipeEmoji(r){
  const t=norm(r.title);
  const G=p=>'<svg class="glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round">'+p+'</svg>';
  /* desserts d'abord, comme avant */
  if(/cookie|biscuit|sable/.test(t))return G('<circle cx="12" cy="12" r="8.6"/><circle cx="9.4" cy="10" r="1.1" fill="currentColor" stroke="none"/><circle cx="14.4" cy="9.6" r="1.1" fill="currentColor" stroke="none"/><circle cx="12.4" cy="14.8" r="1.1" fill="currentColor" stroke="none"/>');
  if(/crepe|pancake/.test(t))return G('<ellipse cx="12" cy="7.4" rx="7.6" ry="2.8"/><path d="M4.4 7.4v3c0 1.5 3.4 2.8 7.6 2.8s7.6-1.3 7.6-2.8v-3"/><path d="M4.4 12.4v3c0 1.5 3.4 2.8 7.6 2.8s7.6-1.3 7.6-2.8v-3"/>');
  if(/brownie|chocolat|fondant/.test(t))return G('<rect x="3.6" y="5.6" width="16.8" height="12.8" rx="2.2"/><path d="M9.2 5.6v12.8M14.8 5.6v12.8M3.6 12h16.8"/>');
  if(/tarte au citron|citron/.test(t))return G('<path d="M5.6 18.4c-2.5-2.5-1.3-7.4 2.6-11.3S17 2.6 19.5 5.1s1.3 7.4-2.6 11.3-8.8 4.5-11.3 2z"/><path d="M8.4 15.6 15.6 8.4"/>');
  if(/tarte|crumble|pomme/.test(t))return G('<path d="M3 11.6h18"/><path d="M4.2 11.6a7.8 7.8 0 0 1 15.6 0"/><path d="M3 11.6v2.2a4.6 4.6 0 0 0 4.6 4.6h8.8a4.6 4.6 0 0 0 4.6-4.6v-2.2"/><path d="M8.6 11.6 11 7.6M15.4 11.6 13 7.6"/>');
  if(/banana|banane/.test(t))return G('<path d="M4.4 7.6c0 6.8 5.6 12.4 12.4 12.4 2.2 0 3.8-1.8 3.8-3.9 0-5.2-4.2-9.4-9.4-9.4"/><path d="M4.4 7.6 3 5.2"/>');
  if(/gateau|gâteau|marbre|cake|clafoutis|yaourt/.test(t))return G('<path d="M4.4 19.8v-6.4h15.2v6.4z"/><path d="M4.4 13.4c0-1.7 3.4-3 7.6-3s7.6 1.3 7.6 3"/><path d="M12 10.4V7"/><circle cx="12" cy="5.4" r="1.2"/>');
  if(/brioche|pain/.test(t))return G('<path d="M4.2 10.6c0-2.7 3.5-4.6 7.8-4.6s7.8 1.9 7.8 4.6c0 1.2-1 2.1-2.2 2.1H6.4c-1.2 0-2.2-.9-2.2-2.1z"/><path d="M5.6 12.7 6.6 19h10.8l1-6.3"/>');
  if(/glace|sorbet/.test(t))return G('<path d="M7.4 9.8h9.2L12 20.6z"/><path d="M7.4 9.8a4.6 4.6 0 0 1 9.2 0"/><path d="M9.5 6a3.4 3.4 0 0 1 5 0"/>');
  if(/mousse|creme|crème/.test(t))return G('<path d="M6.2 10.6h11.6l-1.2 8a2 2 0 0 1-2 1.7H9.4a2 2 0 0 1-2-1.7z"/><path d="M8.6 10.6c0-1.9 1.5-3.4 3.4-3.4s3.4 1.5 3.4 3.4"/><circle cx="12" cy="5.2" r="1"/>');
  /* plats */
  if(/curry|dahl|dhal/.test(t))return G('<path d="M2.8 10.8h18.4c0 5.1-4.1 9.2-9.2 9.2s-9.2-4.1-9.2-9.2z"/><path d="M9 3.4c0 1.3 1.1 1.3 1.1 2.6S9 7.3 9 8.6M14.4 3.4c0 1.3 1.1 1.3 1.1 2.6s-1.1 1.3-1.1 2.6"/>');
  if(/pate|spaghetti|lasagne/.test(t))return G('<circle cx="12" cy="12" r="8.4"/><path d="M12 12a1.6 1.6 0 0 1 0-3.2 2.4 2.4 0 0 0 0 4.8 3.2 3.2 0 0 1 0-6.4 4 4 0 0 0 0 8"/>');
  if(/salade/.test(t))return G('<path d="M20.5 3.5c0 8.5-3.7 14.5-10.3 14.5-2.3 0-4-1.1-4-1.1S5.4 3.5 20.5 3.5z"/><path d="M4 20.5C7.5 14 11.5 10.6 16 8.6"/>');
  if(/soupe|veloute/.test(t))return G('<path d="M2.8 11.2h16.4c0 4.9-3.7 8.8-8.2 8.8S2.8 16.1 2.8 11.2z"/><path d="M15.6 8.4c1.2-1.4 3.1-1.4 4.3 0s1.2 3.5 0 4.9"/>');
  if(/frittata|omelette|oeuf/.test(t))return G('<ellipse cx="12" cy="13" rx="8.6" ry="6.6"/><circle cx="12" cy="12.4" r="2.9"/>');
  if(/risotto|riz/.test(t))return G('<path d="M2.8 10.8h18.4c0 5.1-4.1 9.2-9.2 9.2s-9.2-4.1-9.2-9.2z"/><ellipse cx="8.2" cy="7.6" rx="1.6" ry="1"/><ellipse cx="12" cy="5.6" rx="1.6" ry="1"/><ellipse cx="15.8" cy="7.6" rx="1.6" ry="1"/>');
  if(/gratin|patate|pomme de terre/.test(t))return G('<path d="M3.6 12.8h16.8v2.6a4 4 0 0 1-4 4H7.6a4 4 0 0 1-4-4z"/><path d="M3.6 12.8a8.4 8.4 0 0 1 16.8 0"/><path d="M2 15.4h1.6M20.4 15.4H22"/>');
  if(/chili|piment/.test(t))return G('<path d="M13.4 6.8c3.3 0 5.8 2.7 5.8 6 0 3.8-3.3 7.2-7.4 7.2-3.9 0-7.4-2.6-7.4-5.4 0-1.2 1-2.1 2.1-2.1 1.3 0 2 1 2 2.2"/><path d="M13.4 6.8V5c0-.9.8-1.7 1.7-1.7h1.7"/>');
  if(/gnocchi|tomate/.test(t))return G('<circle cx="12" cy="14.2" r="6.6"/><path d="M12 7.6V5.6"/><path d="M8.4 5.8c1.2 0 2.3.7 2.9 1.8M15.6 5.8c-1.2 0-2.3.7-2.9 1.8"/>');
  if(/fromage|halloumi|feta|mozza/.test(t))return G('<path d="M3.6 16.6v-5.4l16.8-3v8.4z"/><path d="M3.6 11.2 20.4 8.2"/><circle cx="9" cy="13.8" r="1.1"/><circle cx="15" cy="12.6" r="1.1"/>');
  if(/pizza/.test(t))return G('<path d="M12 3.8 20.8 20.2H3.2z"/><path d="M5.8 15.4c4-1.5 8.4-1.5 12.4 0"/><circle cx="12" cy="11" r="1.1" fill="currentColor" stroke="none"/><circle cx="9.6" cy="17.4" r="1" fill="currentColor" stroke="none"/><circle cx="14.4" cy="17.4" r="1" fill="currentColor" stroke="none"/>');
  if(/burger|sandwich/.test(t))return G('<path d="M3.6 8.6 12 4.6l8.4 4L12 12.6z"/><path d="M3.6 12.6 12 16.6l8.4-4M3.6 8.6v4M20.4 8.6v4"/>');
  if(/wok|saute|nouille/.test(t))return G('<path d="M3 10.8h14.6c0 4.4-3.3 8-7.3 8s-7.3-3.6-7.3-8z"/><path d="M17.6 10.8H21l-2.5 4.4"/><path d="M7.8 7.2c0 1.2 1 1.2 1 2.4M12.2 6.4c0 1.2 1 1.2 1 2.4"/>');
  return G('<path d="M4 9.5h16v6.1a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z"/><path d="M4 11.8H2M20 11.8h2M6.5 6.4h11M12 3.8v2.6"/>');
}

function isDessert(r){ return !!r.dessert || (r.tags||[]).includes('dessert'); }
function recipeCat(r){
  if(isDessert(r))return 'cat-sweet';
  const t=norm(r.title);
  if(/velout|soupe|veloute|miso/.test(t))return 'cat-soup';
  if(/pad thai/.test(t))return 'cat-pasta';
  if(/curry|dahl|dhal|chili|thai|mafe|tajine/.test(t))return 'cat-curry';
  if(/pate|lasagne|gnocchi|nouille|wok|pizza|boulette/.test(t))return 'cat-pasta';
  if(/salade|brocoli|epinard|buddha|bowl|quinoa/.test(t))return 'cat-green';
  if(/frittata|oeuf|omelette|shakshuka|tortilla|quiche/.test(t))return 'cat-egg';
  if(/gratin|tarte|crumble|parmigiana|aubergine/.test(t))return 'cat-bake';
  if(/riz|risotto|sushi/.test(t))return 'cat-rice';
  if(/galette|legume|falafel|wrap|burrito/.test(t))return 'cat-green';
  return 'cat-default';
}
/* Les \b de JavaScript ne connaissent pas les lettres accentuées : « mozzarella râpée »
   donnait « mozzarella e ». On délimite donc les mots à la main (début/fin ou non-lettre). */
const DESCRIPTORS=/(^|[^\p{L}])(égouttés?|égouttées?|râpés?|râpées?|frais|fraîches?|moyens?|moyennes?|surgelés?|surgelées?|coupés?|coupées?|entiers?|entières?|petits?|petites?|grands?|grandes?|gros|grosses?|bio)(?=$|[^\p{L}])/giu;
/* produits dont le « descripteur » fait partie du nom */
const KEEP_WHOLE=/^(fromage frais|oignons? frais|petits? pois|gros sel|crème fraîche|haricots? verts?)$/i;
function baseIngredientName(item){
  const s=item.replace(/\(.*?\)/g,'').replace(/\s+/g,' ').trim();
  if(KEEP_WHOLE.test(s)) return s;
  return s.replace(DESCRIPTORS,'$1').replace(/\s+/g,' ').replace(/^[\s,]+|[\s,]+$/g,'').trim();
}
/* Singulier d'un nom d'ingrédient normalisé (sans accents), mot par mot, pour que
   « 2 carottes » et « 1 carotte » tombent dans la même ligne de courses. */
const SINGULAR_KEEP=new Set(['frais','gros','bruxelles','sous','pois','radis','cassis','anis','mais','ananas','jus','brebis','couscous','bras','pas','fois','tasse','epices','herbes','lentilles','pates','nouilles','gnocchis','epinards','cereales','flocons','pepites','dattes','noix','choux','oeufs']);
function singularWord(w){
  if(w.length<4||SINGULAR_KEEP.has(w)) return w;
  if(/aux$/.test(w)) return w.slice(0,-3)+'al';
  if(/(eaux|eux|oux)$/.test(w)) return w.slice(0,-1);
  if(/ss$/.test(w)) return w;
  if(/s$/.test(w)) return w.slice(0,-1);
  return w;
}
function singular(name){ return norm(name).split(/\s+/).map(singularWord).join(' '); }
/* « sel, poivre » = deux articles, pas un ; chaque morceau garde sa quantité éventuelle */
function splitIngredient(item){
  if(!/,/.test(item) || /\(/.test(item)) return [item];
  return item.split(',').map(s=>s.trim()).filter(Boolean);
}
/* unités au pluriel dans la liste : « 2 boîtes », pas « 2 boîte » */
const UNIT_PLURAL={'boîte':'boîtes','feuille':'feuilles','tranche':'tranches','poignée':'poignées','sachet':'sachets','paquet':'paquets','verre':'verres','tasse':'tasses','gousse':'gousses','morceau':'morceaux','boule':'boules','branche':'branches','brin':'brins','cube':'cubes','pot':'pots','bouquet':'bouquets'};
/* pluriel d'affichage d'un nom : les mots avant « de / à / au » prennent un s,
   ceux d'après restent (« pommes de terre », « citrons verts ») */
const NO_PLURAL=new Set(['basilic','persil','menthe','coriandre','aneth','ciboulette','sauge','thym','romarin','roquette','estragon','laurier','ail','pain','riz','sel','poivre','huile','beurre','lait','sucre','farine','miel','moutarde','vinaigre','passata','parmesan','cheddar','gruyere','maïs','cumin','curry','paprika','curcuma','chapelure','houmous','pesto','miso']);
function pluralName(name){
  if(NO_PLURAL.has(norm(name).split(' ')[0])) return name;
  const words=name.split(' '); const out=[]; let stop=false;
  for(const w of words){
    if(stop||/^(de|du|des|d'|d’|à|au|aux|en|et|sans)$/i.test(w)){ stop=true; out.push(w); continue; }
    out.push(/(s|x|z)$/i.test(w)?w:(/(eau|au|eu)$/i.test(w)?w+'x':(/al$/i.test(w)?w.slice(0,-2)+'aux':w+'s')));
  }
  return out.join(' ');
}
function unitLabel(u,q){ if(!u) return ''; if(q!=null&&q>1&&UNIT_PLURAL[u]) return UNIT_PLURAL[u]; return u; }
/* Nom générique / anglais qu'on trouve en rayon à New World ou Woolworths (NZ).
   Clé = nom normalisé (sans accents, minuscule). Aide à repérer le produit en magasin. */
function nzName(item){
  const n=norm(baseIngredientName(item));
  if(NZ_NAMES[n])return NZ_NAMES[n];
  // try partial (e.g. "pâte brisée bio" -> pate brisee)
  for(const k in NZ_NAMES){ if(n.includes(k))return NZ_NAMES[k]; }
  return '';
}

/* ---------- ingredient / tag universe ---------- */
function tagUniverse(){ const s=new Set(); allRecipes.forEach(r=>(r.tags||[]).forEach(t=>s.add(t))); return [...s].sort(); }

/* ---------- STAPLES (assumed on hand, not counted as "missing") ---------- */
const STAPLES=[/sel/,/poivre/,/huile/,/eau/,/ail/,/oignon/,/épice/,/paprika/,/curry/,/cumin/,/curcuma/,/muscade/,/bouillon/,/farine/,/sucre/,/basilic/,/menthe/,/persil/];
function isStaple(name){ const n=norm(name); return STAPLES.some(re=>re.test(n)); }

/* ---------- filter chips ---------- */
const DIETS=[['vege','Végé'],['poulet','Poulet'],['poisson','Poisson'],['viande','Viande']];
const ENVIES=[['rapide','Rapide'],['sansfour','Sans four'],['cheap','Économique'],['sanscuisson','Sans cuisson'],['leger','Léger'],['prot','Riche en protéines']];
const COURSES=[['all','Tout'],['main','Plats'],['dessert','Desserts']];
const TRIS=[['default','Par défaut'],['rating','Mieux notées'],['fav','Favoris d\'abord'],['time','Plus rapides'],['recent','Pas fait récemment'],['protdesc','Plus de protéines'],['protasc','Moins de protéines']];
/* tags deja proposes par les deux rangees du dessus : inutile de les repeter */
const TAGS_DEJA_COUVERTS=new Set(['végé','poulet','poisson','viande','boeuf','rapide','léger','sans four','sans cuisson','dessert']);
function activeFilterCount(){
  return (courseFilter!=='all'?1:0)+(dietFilter?1:0)+(quickFilter?1:0)+(activeTag?1:0)+(sortMode!=='default'?1:0);
}
function filterLabels(){
  const out=[];
  if(courseFilter!=='all') out.push(['course',(COURSES.find(c=>c[0]===courseFilter)||[])[1]]);
  if(dietFilter) out.push(['diet',(DIETS.find(c=>c[0]===dietFilter)||[])[1]]);
  if(quickFilter) out.push(['qf',(ENVIES.find(c=>c[0]===quickFilter)||[])[1]]);
  if(activeTag) out.push(['tag','#'+activeTag]);
  if(sortMode!=='default') out.push(['tri',(TRIS.find(c=>c[0]===sortMode)||[])[1]]);
  return out;
}
function clearFilter(kind){
  if(kind==='course')courseFilter='all'; else if(kind==='diet')dietFilter=null;
  else if(kind==='qf')quickFilter=null; else if(kind==='tag')activeTag=null;
  else if(kind==='tri')sortMode='default';
}
const QUICK=[['all','Tout'],['vege','Végé'],['rapide','Rapide'],['poulet','Poulet'],['poisson','Poisson'],['viande','Viande'],['soupe','Soupes'],['asiatique','Asiatique'],['mexicain','Mexicain'],['méditerranéen','Méditerranéen'],['dessert','Dessert'],['leger','Léger'],['fav','Favoris']];
const QUICK_TAGS=new Set(['soupe','asiatique','mexicain','méditerranéen']);
function quickIsOn(k){
  if(k==='all') return courseFilter==='all'&&!dietFilter&&!quickFilter&&!showFavOnly&&!activeTag;
  if(k==='dessert') return courseFilter==='dessert';
  if(k==='fav') return showFavOnly;
  if(k==='rapide'||k==='leger') return quickFilter===k;
  if(QUICK_TAGS.has(k)) return activeTag===k;
  return dietFilter===k;
}
function quickToggle(k){
  if(k==='all'){ courseFilter='all'; dietFilter=null; quickFilter=null; showFavOnly=false; activeTag=null; }
  else if(k==='dessert'){ courseFilter=courseFilter==='dessert'?'all':'dessert'; }
  else if(k==='fav'){ showFavOnly=!showFavOnly; }
  else if(k==='rapide'||k==='leger'){ quickFilter=quickFilter===k?null:k; }
  else if(QUICK_TAGS.has(k)){ activeTag=activeTag===k?null:k; }
  else { dietFilter=dietFilter===k?null:k; if(dietFilter&&courseFilter==='dessert') courseFilter='all'; }
  renderChips(); renderRecipes();
}
function renderChips(){
  const c=$('#quickChips'); if(!c) return; c.innerHTML='';
  QUICK.forEach(([k,l])=>{ const b=document.createElement('button'); b.type='button'; b.className='chip'+(quickIsOn(k)?' on':''); b.textContent=l; b.onclick=()=>quickToggle(k); c.appendChild(b); });
  const n=activeFilterCount()-(dietFilter?1:0)-(quickFilter==='rapide'||quickFilter==='leger'?1:0)-(courseFilter==='dessert'?1:0);
  const of_=$('#openFilters'); if(of_) of_.textContent=n>0?'Filtres · '+n:'Filtres';
}
/* remplace au moment de la construction du dossier : id -> {t,a,l,u} */
function openPhotoCredits(){
  const sh=$('#sheet');
  const rows=Object.keys(PHOTO_CREDITS).sort((a,b)=>{
    const ra=byId(a),rb=byId(b); return (ra?ra.title:a).localeCompare(rb?rb.title:b);
  }).map(id=>{
    const c=PHOTO_CREDITS[id], r=byId(id);
    const who=c.a?escapeHtml(c.a):'auteur non précisé';
    return `<div><b>${r?escapeHtml(r.title):id}</b><br>${escapeHtml(c.t||'')} · ${who} · ${escapeHtml(c.l||'')}<br><a href="${c.u}" target="_blank" rel="noopener">voir la source</a></div>`;
  }).join('');
  sh.innerHTML=`<div class="grab"></div>
    <div class="sh-head"><h3>Crédits photos</h3><button class="sh-x" id="pcClose" aria-label="Fermer">${xSvg()}</button></div>
    <div class="sh-sub" style="margin-bottom:14px">Les photos des plats viennent de Wikimedia Commons et d'Openverse. Elles sont publiées sous licence libre (CC0, CC BY ou CC BY-SA) et réutilisables, chacune est créditée ci-dessous.</div>
    <div class="sh-body" style="font-size:13px;color:var(--mut);display:flex;flex-direction:column;gap:10px">${rows||'<div>Aucune photo.</div>'}</div>`;
  $('#pcClose').onclick=closeSheet; openSheet();
}
function openFilterSheet(){
  const sh=$('#sheet');
  const group=(title,items,cur,kind)=>`<div class="fgroup"><div class="fgroup-t">${title}</div><div class="fopts">`+
    items.map(([v,l])=>`<button class="fopt${cur===v?' on':''}" data-kind="${kind}" data-v="${v}">${l}</button>`).join('')+'</div></div>';
  sh.innerHTML=`<div class="grab"></div>
    <div class="sh-head"><h3>Filtrer et trier</h3><button class="sh-x" id="fsClose" aria-label="Fermer">${xSvg()}</button></div>
    ${group('Type de plat',COURSES,courseFilter,'course')}
    ${group('Ingrédient principal',DIETS,dietFilter,'diet')}
    ${group('Envie du jour',ENVIES,quickFilter,'qf')}
    ${group('Tags',tagUniverse().filter(t=>!TAGS_DEJA_COUVERTS.has(t)).map(t=>[t,'#'+t]),activeTag,'tag')}
    ${group('Trier par',TRIS,sortMode,'tri')}
    <div class="fs-foot">
      <button class="btn" id="fsClear">Tout effacer</button>
      <button class="btn pri" id="fsApply"><span id="fsCount"></span></button>
    </div>`;
  const refresh=()=>{
    sh.querySelectorAll('.fopt').forEach(b=>{
      const k=b.dataset.kind,v=b.dataset.v;
      const cur=k==='course'?courseFilter:k==='diet'?dietFilter:k==='qf'?quickFilter:k==='tri'?sortMode:activeTag;
      b.classList.toggle('on',cur===v);
    });
    const n=allRecipes.filter(recipeMatches).length;
    $('#fsCount').textContent='Voir '+n+' recette'+(n>1?'s':'');
  };
  sh.querySelectorAll('.fopt').forEach(b=>b.onclick=()=>{
    const k=b.dataset.kind,v=b.dataset.v;
    if(k==='course') courseFilter=v;
    else if(k==='diet') dietFilter=dietFilter===v?null:v;
    else if(k==='qf') quickFilter=quickFilter===v?null:v;
    else if(k==='tri') sortMode=v;
    else activeTag=activeTag===v?null:v;
    refresh(); renderChips(); renderRecipes();
  });
  $('#fsClear').onclick=()=>{ courseFilter='all'; dietFilter=null; quickFilter=null; activeTag=null; sortMode='default'; refresh(); renderChips(); renderRecipes(); };
  $('#fsApply').onclick=closeSheet;
  $('#fsClose').onclick=closeSheet;
  refresh(); openSheet();
}

/* ---------- recipe grid ---------- */
function recipeMatches(r){
  if(courseFilter==='dessert' && !isDessert(r))return false;
  if(courseFilter==='main' && isDessert(r))return false;
  if(dietFilter){
    const t=r.tags||[];
    if(dietFilter==='vege' && !t.includes('végé'))return false;
    if(dietFilter==='poulet' && !t.includes('poulet'))return false;
    if(dietFilter==='poisson' && !t.includes('poisson'))return false;
    if(dietFilter==='viande' && !(t.includes('viande')||t.includes('boeuf')))return false;
  }
  if(showFavOnly && !isFav(r.id))return false;
  if(quickFilter==='rapide' && r.time>25)return false;
  if(quickFilter==='sansfour' && !((r.tags||[]).includes('sans four')||(r.tags||[]).includes('sans cuisson')||(r.tags||[]).includes('une poêle')))return false;
  if(quickFilter==='sanscuisson' && !(r.tags||[]).includes('sans cuisson'))return false;
  if(quickFilter==='leger' && !(r.tags||[]).includes('léger'))return false;
  if(quickFilter==='prot' && !(protOf(r.id)>=25 && !PROT_DESSERT[r.id]))return false;
  if(quickFilter==='cheap'){ const c=recipeCost(r); if(!(c.known>0 && c.unknown===0 && c.perServing<=3))return false; }
  if(searchTerm){ const hay=norm(r.title+' '+r.ingredients.map(i=>i[2]).join(' ')+' '+(r.tags||[]).join(' ')); if(!hay.includes(norm(searchTerm)))return false; }
  if(activeTag&&!(r.tags||[]).includes(activeTag))return false;
  return true;
}
function heartSvg(){ return '<svg viewBox="0 0 24 24"><path d="M12 21s-7.5-4.6-10-9.3C.5 8.5 2 5 5.3 5c2 0 3.3 1.2 4.2 2.5C10.4 6.2 11.7 5 13.7 5 17 5 18.5 8.5 17 11.7 14.5 16.4 12 21 12 21z" stroke-linejoin="round"/></svg>'; }
function recipeCard(r){
  const made=lastMade(r.id),dsince=daysSince(made),recent=made&&dsince<=10;
  const card=document.createElement('div'); card.className='rcard'+(selection.has(r.id)?' picked':'');
  const t=r.tags||[];
  const tag=t.includes('végé')&&!isDessert(r)?'<span class="tag">Végé</span>':'';
  const warn=recent?`<span class="tag warn">Fait ${dsince===0?"aujourd'hui":dsince===1?'hier':'il y a '+dsince+' j'}</span>`:'';
  card.innerHTML=`${photoOrEmoji(r.id)}<div class="ov"></div>
    <div class="tags">${tag}${warn}</div>
    <button class="tap" data-open="${r.id}" aria-label="${r.title}"></button>
    <button class="fav ${isFav(r.id)?'on':''}" data-fav aria-label="Favori">${heartSvg()}</button>
    <div class="t">${r.title}<small>${r.time} min · ${mealsLabel(r.portions)}${protOf(r.id)&&!isDessert(r)?' · '+protOf(r.id)+' g prot.':''}</small></div>
    <button class="pick" data-pick aria-label="${selection.has(r.id)?'Retirer de la semaine':'Ajouter à la semaine'}">${selection.has(r.id)?checkSvg():'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 5v14M5 12h14" stroke-linecap="round"/></svg>'}</button>`;
  card.querySelector('[data-open]').onclick=()=>openRecipeDetail(r.id);
  card.querySelector('[data-pick]').onclick=(e)=>{e.stopPropagation();toggleSelect(r.id);};
  const fav=card.querySelector('[data-fav]');
  fav.onclick=(e)=>{ e.stopPropagation(); toggleFav(r.id); fav.classList.toggle('on',isFav(r.id)); if(showFavOnly) renderRecipes(); };
  return card;
}
function sortRecipes(list){
  const arr=[...list];
  if(sortMode==='rating') arr.sort((a,b)=>getRating(b.id)-getRating(a.id) || a.title.localeCompare(b.title));
  else if(sortMode==='fav') arr.sort((a,b)=>(isFav(b.id)?1:0)-(isFav(a.id)?1:0) || getRating(b.id)-getRating(a.id));
  else if(sortMode==='time') arr.sort((a,b)=>a.time-b.time);
  else if(sortMode==='recent') arr.sort((a,b)=>daysSince(lastMade(b.id))-daysSince(lastMade(a.id)));
  else if(sortMode==='protdesc') arr.sort((a,b)=>protOf(b.id)-protOf(a.id) || a.title.localeCompare(b.title));
  else if(sortMode==='protasc') arr.sort((a,b)=>protOf(a.id)-protOf(b.id) || a.title.localeCompare(b.title));
  return arr;
}
function renderRecipes(){
  const grid=$('#recipeGrid'); grid.innerHTML='';
  const list=sortRecipes(allRecipes.filter(recipeMatches));
  $('#recipeCount').textContent=list.length+' recette'+(list.length>1?'s':'');
  const nr=$('#noResults');
  nr.hidden=!!list.length;
  const setIll=k=>{};
  const sub=$('#recipesSub'); if(sub){ const n=selection.size; sub.textContent=n?n+' recette'+(n>1?'s':'')+' dans la semaine':'Touche + pour composer la semaine'; }
  if(!list.length){
    if(showFavOnly && favorites.size===0){
      setIll('coeur');
      nr.querySelector('h3').textContent='Aucun favori pour l\u2019instant';
      nr.querySelector('p').textContent='Touche le c\u0153ur sur une recette pour l\u2019ajouter ici.';
    } else if(quickFilter==='cheap' && Object.keys(prices).length===0){
      setIll('piece');
      nr.querySelector('h3').textContent='Renseigne d\u2019abord des prix';
      nr.querySelector('p').textContent='Ouvre une recette et touche « Estimer le coût » pour saisir tes prix. Le filtre Économique s\u2019appuie dessus.';
    } else {
      setIll('loupe');
      nr.querySelector('h3').textContent='Aucune recette trouvée';
      nr.querySelector('p').textContent='Enlève un filtre ou change les mots de recherche pour voir plus de résultats.';
    }
  }
  list.forEach(r=>grid.appendChild(recipeCard(r)));
}
function toggleSelect(id){
  if(selection.has(id))selection.delete(id); else selection.add(id);
  // la sélection change => c'est une nouvelle liste de courses : on ne garde
  // pas les "déjà rangé" d'une session précédente, sinon des ingrédients
  // manquent silencieusement (c'est ce qui faisait disparaître la crème).
  if(acquiredKeys().length) clearAcquired();
  save(LS.selection,[...selection]); touch(); refreshSelUI(); renderRecipes(); renderFridge();
}
function refreshSelUI(){
  const n=selection.size;
  const wb=$('#weekBadge'); wb.classList.toggle('hide',!n); wb.textContent=n;
  const sub=$('#recipesSub'); if(sub) sub.textContent=n?n+' recette'+(n>1?'s':'')+' dans la semaine':'Touche + pour composer la semaine';
  updateShopBadge();
}

/* ---------- random week ---------- */
function randomWeek(){
  const N=6;
  const pool=allRecipes.filter(r=>!isDessert(r)).map(r=>{
    let w=Math.min(daysSince(lastMade(r.id)),60)/60;   // 0..1, higher = longer since cooked
    w=Math.pow(w,1.5)+0.03;
    const rt=getRating(r.id); if(rt) w*=(1+rt*0.25);    // liked recipes come up a bit more
    if(isFav(r.id)) w*=1.4;                              // favourites get a boost
    return {id:r.id,w};
  });
  const chosen=new Set(),avail=[...pool];
  while(chosen.size<Math.min(N,avail.length)&&avail.length){
    const total=avail.reduce((s,p)=>s+p.w,0); let x=Math.random()*total,idx=0;
    for(let i=0;i<avail.length;i++){x-=avail[i].w;if(x<=0){idx=i;break;}}
    chosen.add(avail[idx].id); avail.splice(idx,1);
  }
  selection=new Set(chosen); save(LS.selection,[...selection]);
  clearAcquired(); shopChecked.clear(); save(LS.shopChecked,[]);  // fresh shopping trip
  touch();
  refreshSelUI(); renderRecipes(); toast('Menu tiré au sort : '+selection.size+' recettes');
}

/* ---------- PANTRY / INVENTORY ---------- */
/* Ordered most-specific first: e.g. "lait de coco" -> 🥥 BEFORE "lait" -> 🥛 */
const PANTRY_EMO=[
  [/lait de coco|noix de coco|\bcoco\b/,'🥥'],
  [/pois chiche|lentille|haricot|\bfeve|flageolet/,'🫘'],
  [/tomate/,'🍅'], [/courgette|concombre/,'🥒'], [/carotte/,'🥕'],
  [/poivron|piment/,'🫑'], [/aubergine/,'🍆'], [/brocoli|chou/,'🥦'],
  [/champignon/,'🍄'], [/pomme de terre|patate/,'🥔'], [/oignon/,'🧅'], [/\bail\b/,'🧄'],
  [/epinard|salade|roquette|mache|basilic|menthe|persil|herbe|coriandre/,'🥬'],
  [/citron|lime/,'🍋'], [/avocat/,'🥑'], [/banane/,'🍌'], [/\bpomme\b/,'🍎'],
  [/gingembre/,'🫚'], [/mais/,'🌽'],
  [/oeuf|œuf/,'🥚'],
  [/\blait\b|creme|yaourt|beurre/,'🥛'],
  [/feta|mozzarella|parmesan|cheddar|ricotta|fromage|halloumi|gruyere/,'🧀'],
  [/pates|spaghetti|penne|nouille|lasagne|gnocchi/,'🍝'],
  [/riz|risotto/,'🍚'], [/couscous|semoule|boulgour|quinoa/,'🌾'],
  [/pain|baguette/,'🍞'], [/farine/,'🌾'],
  [/conserve|concentre|\bboite/,'🥫'],
  [/soja|tofu/,'🫛'], [/bouillon|soupe/,'🍲'],
  [/curry|paprika|cumin|curcuma|epice|cannelle|muscade/,'🌶️'],
  [/huile/,'🫗'], [/olive/,'🫒'],
  [/sel|poivre/,'🧂'], [/sucre|miel/,'🍯'],
  [/poulet|volaille|dinde/,'🍗'], [/boeuf|bœuf|steak|hache|veau|agneau|porc|lardon|jambon|saucisse|chorizo|echine/,'🥩'],
  [/saumon|cabillaud|thon|poisson|hoki|sardine|maquereau|anchois/,'🐟'], [/crevette|gambas/,'🦐'],
  [/chocolat|cacao|pepite/,'🍫'], [/vanille|levure|bicarbonate/,'🧁'], [/amande|noisette|noix|cacahuete|pistache|sesame/,'🥜'],
  [/poire/,'🍐'], [/fraise|framboise|myrtille|fruit rouge/,'🍓'], [/orange|clementine|mandarine/,'🍊'], [/raisin|datte|abricot sec|pruneau/,'🍇'], [/peche|abricot|nectarine/,'🍑'], [/cerise/,'🍒'], [/mangue|ananas/,'🥭'],
  [/potiron|potimarron|courge|butternut/,'🎃'], [/poireau|celeri|fenouil|asperge/,'🥬'], [/petit pois|edamame|haricot vert/,'🫛'], [/radis|betterave|navet/,'🥕'],
  [/tortilla|wrap|pita|burger|brioche/,'🫓'], [/pizza|pate brisee|pate feuilletee|pate a pizza/,'🥧'],
  [/vin|biere|cidre/,'🍷'], [/eau/,'💧'], [/the|cafe/,'☕'], [/sauce|ketchup|moutarde|mayonnaise|vinaigre|nuoc|tamari|teriyaki/,'🫙'], [/lait de coco|creme de coco/,'🥥'],
  [/nori|sushi|wasabi/,'🍣'], [/cornichon|capre/,'🥒'], [/lentille corail|dahl|dal/,'🫘'], [/flocon|avoine|granola|cereale/,'🥣'],
];
function pantryEmo(name){ const n=norm(name); for(const[re,e]of PANTRY_EMO)if(re.test(n))return e; return '🛒'; }
function wordInText(word, text){
  // vrai si `word` apparaît comme mot entier dans `text`
  return text.split(/[^a-z0-9]+/).filter(Boolean).includes(word);
}
function sameIngredient(a,b){
  const x=singular(a), y=singular(b);
  if(!x||!y) return false;
  if(x===y) return true;
  // correspondance par mot entier seulement, et le terme le plus court doit
  // faire au moins 4 lettres : sans ça "riz" trouvait "chorizo".
  const shorter=x.length<=y.length?x:y, longer=x.length<=y.length?y:x;
  if(shorter.length<4) return false;
  return wordInText(shorter, longer);
}
function matchInPantry(base){ return pantry.find(p=>sameIngredient(p.name, base)); }
function pantryIndexFor(base){ return pantry.findIndex(p=>sameIngredient(p.name, base)); }
function missingFor(r){
  const miss=[];
  r.ingredients.forEach(([q,u,item])=>{
    const base=baseIngredientName(item); if(!base)return;
    if(isStaple(base))return;
    if(!matchInPantry(base)) miss.push(base);
  });
  return miss;
}
/* add to pantry; merges by name (sums qty when same unit) */
function pantryAdd(name,qty,unit,from){
  name=String(name).trim(); if(!name)return;
  unit=canonUnit(unit);
  // on ne fusionne que des quantités réellement comparables : additionner
  // "800 g de pommes de terre" et "4 pommes de terre" donnait 804 g.
  const ex=pantry.find(p=>norm(p.name)===norm(name) && unitFamily(p.unit)===unitFamily(unit));
  if(ex){
    const tot=toBaseUnit(ex.qty||0,ex.unit)+toBaseUnit(qty!=null?qty:1,unit);
    const [q2,u2]=fromBaseUnit(tot,unitFamily(unit));
    ex.qty=q2; ex.unit=u2; ex.at=Date.now();
    if(from==='courses')ex.from='courses';
  }
  else pantry.push({name,qty:qty!=null?qty:1,unit:unit||'',from:from||'manuel',at:Date.now()});
}
function pantryRemove(idx){ pantry.splice(idx,1); save(LS.pantry,pantry); touch(); renderFridge(); }
function pantryStep(unit){
  const u=canonUnit(unit);
  if(u==='g'||u==='ml') return 50;
  if(u==='kg'||u==='l') return 0.5;
  if(u==='cl') return 5;
  return 1;                                   // unités comptables et cuillères
}
function pantrySetQty(idx,dir){
  const p=pantry[idx];
  const step=pantryStep(p.unit);
  p.qty=Math.round(((p.qty||1)+dir*step)*100)/100;   // évite les 0.30000000000004
  if(p.qty<=0){ pantry.splice(idx,1); }
  save(LS.pantry,pantry); touch(); renderFridge();
}
/* parse a free-typed line like "500 g riz" or "courgette" */
function addFridge(raw){
  raw=String(raw).trim(); if(!raw)return;
  const parsed=parseIngLine(raw); // [qty, unit, name, aisle]
  if(parsed){ pantryAdd(parsed[2].toLowerCase(), parsed[0], parsed[1], 'manuel'); }
  save(LS.pantry,pantry); touch(); $('#fridgeInput').value=''; renderFridge();
}
function fmtPantryQty(p){
  if(p.qty==null) return '';
  if(p.unit) return fmtQty(p.qty)+' '+p.unit;
  if(p.qty===1) return '';           // single countable, no need to show "1"
  return '×'+fmtQty(p.qty);
}
function renderPantry(){
  const list=$('#pantryList'); list.innerHTML='';
  const has=pantry.length>0;
  $('#pantryH').hidden=!has; list.classList.toggle('hide',!has);
  if(!has)return;
  $('#pantryCount').textContent=pantry.length+' article'+(pantry.length>1?'s':'');
  const stale_=p=>typeof isStale==='function'&&isStale(p);
  const order=pantry.map((p,i)=>({p,i})).sort((a,b)=>(stale_(b.p)?1:0)-(stale_(a.p)?1:0)||(b.p.at||0)-(a.p.at||0));
  order.forEach(({p,i})=>{
    const wrap=document.createElement('div'); wrap.className='swrow';
    const row=document.createElement('div'); row.className='rw';
    const qtyStr=fmtPantryQty(p);
    row.innerHTML=`<span class="tile">${pantryEmo(p.name)}</span><div class="b"><div class="t" style="font-weight:500">${p.name}</div><div class="m${stale_(p)?' warn':''}">${stale_(p)?'à utiliser vite · ':''}${p.from==='courses'?'des courses':'ajouté'}${p.at?' · '+relDay(p.at):''}</div></div>
      <div class="pm"><button data-m aria-label="Moins">−</button><span class="qty">${qtyStr||'1'}</span><button data-p aria-label="Plus">+</button></div>`;
    row.querySelector('[data-m]').onclick=()=>pantrySetQty(i,-1);
    row.querySelector('[data-p]').onclick=()=>pantrySetQty(i,+1);
    const del=document.createElement('button'); del.className='del'; del.textContent='Retirer'; del.onclick=()=>pantryRemove(i);
    wrap.appendChild(del); wrap.appendChild(row); bindSwipe(wrap);
    list.appendChild(wrap);
  });
}
/* glisser une ligne vers la gauche découvre « Retirer » (comme Rappels ou Mail) */
let openSwipe=null;
function bindSwipe(wrap){
  const row=wrap.querySelector('.rw'); const W=84; let x0=0,y0=0,dx=0,drag=false,cancel=false;
  const setX=v=>{ row.style.transform=v?`translateX(${v}px)`:''; };
  wrap.addEventListener('touchstart',e=>{ const t=e.touches[0]; x0=t.clientX; y0=t.clientY; dx=0; drag=false; cancel=false; row.style.transition='none'; },{passive:true});
  wrap.addEventListener('touchmove',e=>{ const t=e.touches[0]; const mx=t.clientX-x0, my=t.clientY-y0; if(cancel) return; if(!drag){ if(Math.abs(my)>8&&Math.abs(my)>Math.abs(mx)){ cancel=true; return; } if(Math.abs(mx)>8) drag=true; else return; } dx=Math.max(-W-20,Math.min(0,mx+(wrap.classList.contains('open')?-W:0))); setX(dx); },{passive:true});
  wrap.addEventListener('touchend',()=>{ row.style.transition=''; if(!drag) return; const open=dx<-W/2; wrap.classList.toggle('open',open); setX(open?-W:0); if(open){ if(openSwipe&&openSwipe!==wrap){ openSwipe.classList.remove('open'); openSwipe.querySelector('.rw').style.transform=''; } openSwipe=wrap; } row.dataset.swiped=drag?'1':''; setTimeout(()=>{ row.dataset.swiped=''; },50); });
  row.addEventListener('click',e=>{ if(row.dataset.swiped){ e.stopImmediatePropagation(); return; } if(wrap.classList.contains('open')){ wrap.classList.remove('open'); setX(0); e.stopImmediatePropagation(); } },true);
}
function relDay(ts){ const d=Math.floor((Date.now()-ts)/86400000); return d<=0?"aujourd'hui":d===1?'hier':'il y a '+d+' j'; }
function renderFridge(){
  renderPantry();
  const grid=$('#fridgeGrid'); grid.innerHTML='';
  const has=pantry.length>0;
  $('#fridgeEmpty').hidden=has;
  $('#fridgeResultsH').hidden=!has; grid.classList.toggle('hide',!has);
  if(!has)return;
  // on ne propose que des recettes qui utilisent le stock, ce qui doit partir vite compte double
  const uses=r=>{ let n=0; pantry.forEach(p=>{ if(r.ingredients.some(i=>sameIngredient(baseIngredientName(i[2]),p.name))) n+=(typeof isStale==='function'&&isStale(p))?2:1; }); return n; };
  const ranked=allRecipes.filter(r=>!isDessert(r)).map(r=>({r,miss:missingFor(r),use:uses(r)}))
    .filter(x=>x.use>0&&x.miss.length<=6)
    .sort((a,b)=> b.use-a.use || a.miss.length-b.miss.length || a.r.time-b.r.time).slice(0,12);
  $('#fridgeCount').textContent=ranked.length+' recette'+(ranked.length>1?'s':'');
  ranked.forEach(({r,miss})=>{
    const row=document.createElement('div'); row.className='rw thumb';
    row.innerHTML=`${hasPhoto(r.id)?`<img class="th" src="${photoSrc(r.id)}" alt="" loading="lazy">`:`<div class="noph">${recipeEmoji(r)}</div>`}
      <div class="b"><div class="t">${r.title}</div><div class="m ${miss.length?'warn':'ok'}">${r.time} min · ${miss.length?'il manque '+miss.join(', '):'tout est en stock'}</div></div>
      <button class="go" data-pick>${selection.has(r.id)?'✓':'+'}</button>`;
    row.querySelector('.b').onclick=()=>openRecipeDetail(r.id);
    row.querySelector('[data-pick]').onclick=(e)=>{e.stopPropagation();toggleSelect(r.id);};
    grid.appendChild(row);
  });
}
$('#fridgeAdd').onclick=()=>addFridge($('#fridgeInput').value);
$('#fridgeInput').addEventListener('keydown',e=>{ if(e.key==='Enter')addFridge($('#fridgeInput').value); });
$('#clearPantry').onclick=()=>{ if(pantry.length&&confirm('Vider tout le stock ?')){ pantry=[]; save(LS.pantry,pantry); touch(); renderFridge(); toast('Stock vidé'); } };

/* ---------- SHOPPING ---------- */
const AISLE_ORDER=["Légumes & fruits","Viandes & poissons","Frais & crémerie","Œufs","Pâtes, riz & féculents","Conserves & épicerie","Autres"];
const AISLE_ICON={"Légumes & fruits":"legumes","Viandes & poissons":"viande","Frais & crémerie":"frais","Œufs":"oeufs","Pâtes, riz & féculents":"feculents","Conserves & épicerie":"conserves","Autres":"autres"};
const AISLE_CLASS={"Légumes & fruits":"ai-veg","Viandes & poissons":"ai-meat","Frais & crémerie":"ai-dairy","Œufs":"ai-egg","Pâtes, riz & féculents":"ai-carb","Conserves & épicerie":"ai-can","Autres":"ai-misc"};
function shopKey(u,item){ return singular(baseIngredientName(item)); }
/* map any aisle to a known one; unknown aisles fall back to "Autres" so nothing ever disappears */
function aisleOrder(){ const a=settings.aisles; return (Array.isArray(a)&&a.length===AISLE_ORDER.length&&AISLE_ORDER.every(x=>a.includes(x)))?a:AISLE_ORDER; }
function safeAisle(a){ return AISLE_ORDER.includes(a) ? a : 'Autres'; }
/* unités équivalentes : évite "2 boîte + 1 boîtes" ou "1 l + 1 L" dans la liste */
const UNIT_ALIAS={'boîtes':'boîte','boite':'boîte','boites':'boîte','gousse':'gousses','L':'l','mL':'ml','cuillère':'c. à soupe'};
function canonUnit(u){ return UNIT_ALIAS[u]||u||''; }
/* familles d'unités convertibles : 3 c. à café = 1 c. à soupe, 1 kg = 1000 g, etc.
   Sans ça, une même épice comptée en cuillère à café dans une recette et en cuillère
   à soupe dans une autre s'affichait "4 c. à café + 4 c. à soupe" dans les courses. */
const UNIT_FAMILY={
  'g':['poids',1], 'kg':['poids',1000],
  'ml':['volume',1], 'cl':['volume',10], 'l':['volume',1000],
  'c. à café':['cuillère',1], 'c. à soupe':['cuillère',3], 'pincée':['cuillère',0.25]
};
function unitFamily(u){ const f=UNIT_FAMILY[canonUnit(u)]; return f?f[0]:('u:'+canonUnit(u)); }
/* unités « à la louche », qui s'effacent devant une pesée ou un nombre de pièces */
const VAGUE_FAMILIES=new Set(['u:feuilles','u:feuille','u:poignées','u:poignée','u:brins','u:brin','u:branches','u:branche','cuillère']);
function toBaseUnit(q,u){ const f=UNIT_FAMILY[canonUnit(u)]; return f?q*f[1]:q; }
function fromBaseUnit(v,fam){
  if(fam==='poids')    return v>=1000 ? [v/1000,'kg'] : [v,'g'];
  if(fam==='volume')   return v>=1000 ? [v/1000,'l'] : (v>=10 ? [v/10,'cl'] : [v,'ml']);
  if(fam==='cuillère') return v>=3 ? [v/3,'c. à soupe'] : [v,'c. à café'];
  return [v, fam.startsWith('u:') ? fam.slice(2) : ''];
}
/* ingrédients qu'on n'achète pas (eau du robinet, glaçons...) */
function isNotPurchasable(item){ return /^(eau|glaçons?)\b/i.test(item.trim()); }
function buildShopping(){
  const map={};
  selection.forEach(id=>{ const r=byId(id); if(!r)return;
    const f=scaleFactor(r);
    r.ingredients.forEach(([q,u,item0,aisle])=>{
      splitIngredient(item0).forEach((item,idx)=>{
        if(isNotPurchasable(item)) return;
        u=canonUnit(u);
        const k=shopKey(u,item);
        const base=baseIngredientName(item)||item;
        if(!map[k])map[k]={qty:0,hasQty:false,unit:u,item:base,names:{},aisle:safeAisle(aisle),units:{},from:new Set()};
        // on retient chaque forme vue (carotte / carottes) pour choisir l'affichage à la fin
        map[k].names[base]=(map[k].names[base]||0)+1;
        // « sel, poivre » : la quantité ne vaut que pour le premier morceau
        if(q!=null && idx===0){
          const uu=u||'';
          map[k].units[uu]=(map[k].units[uu]||0)+q*f;
          map[k].hasQty=true;
        }
        map[k].from.add(r.title);
      });
    });
  });
  freeItems.forEach(f=>{
    const k='libre|'+norm(f.name);
    if(!map[k])map[k]={qty:0,hasQty:false,unit:'',item:f.name,aisle:guessAisle(f.name),units:{},from:new Set(['Ajout manuel'])};
  });
  // resolve display qty/unit: if a single unit, show summed qty; if mixed units, show them combined
  Object.values(map).forEach(e=>{
    // on regroupe d'abord par famille (poids, volume, cuillères...), puis on convertit
    const fams={};
    Object.keys(e.units).forEach(u=>{ const f=unitFamily(u); fams[f]=(fams[f]||0)+toBaseUnit(e.units[u],u); });
    // « 4 feuilles + 1 basilic », « 2 poignées + 500 g épinards » : quand une mesure
    // précise existe, les mesures vagues ne changent rien à ce qu'on achète
    const famKeys=Object.keys(fams);
    if(famKeys.length>1){
      const precise=famKeys.filter(f=>!VAGUE_FAMILIES.has(f));
      if(precise.length) famKeys.filter(f=>VAGUE_FAMILIES.has(f)).forEach(f=>{ delete fams[f]; });
    }
    const parts=Object.keys(fams).map(f=>fromBaseUnit(fams[f],f));
    if(parts.length===1){ e.qty=parts[0][0]; e.unit=parts[0][1]; }
    else if(parts.length>1){ e.qty=null; e.unit=''; e.mixed=parts.map(([q,u])=>fmtQty(q)+(u?' '+unitLabel(u,q):'')).join(' + '); }
    // nom affiché : la forme au pluriel si on en achète plusieurs, sinon la plus fréquente
    if(e.names){
      const forms=Object.keys(e.names);
      if(forms.length>1){
        const plural=forms.find(n=>/s$/i.test(n)), sing=forms.find(n=>!/s$/i.test(n));
        const many=e.hasQty && e.qty!=null && e.qty>1 && !e.unit;
        e.item=(many?(plural||sing):(sing||plural))||e.item;
      } else if(e.hasQty && e.qty!=null && e.qty>1 && !e.unit){
        e.item=pluralName(e.item);   // « 5 oignon » -> « 5 oignons »
      }
    }
  });
  return map;
}
function acquiredSet(){ return new Set(acquiredKeys()); }
function clearAcquired(){ acquiredItems={}; save('mm_acquired',{}); }
function syncHidePantryBtn(hidden){}
function inPantryByName(itemName){
  return !!matchInPantry(baseIngredientName(itemName)||itemName);
}
function renderShop(){
  const cont=$('#shopList'); cont.innerHTML='';
  const map=buildShopping();
  let keys=Object.keys(map).filter(k=>!removedShopItems.has(k)&&!isAcquired(k));
  let hiddenByPantry=0;
  if(settings.hidePantry){ const before=keys.length; keys=keys.filter(k=>!inPantryByName(map[k].item)); hiddenByPantry=before-keys.length; }
  syncHidePantryBtn(hiddenByPantry);
  const acquiredInMap=Object.keys(map).filter(k=>isAcquired(k));
  const has=keys.length>0;
  const nRec=[...selection].filter(id=>byId(id)).length;
  const sub=$('#shopSub');
  const inStock=Object.keys(map).filter(k=>!removedShopItems.has(k)&&!isAcquired(k)&&inPantryByName(map[k].item)).length;
  sub.innerHTML=has||hiddenByPantry?`${nRec} recette${nRec>1?'s':''} · ${keys.length+hiddenByPantry} article${keys.length+hiddenByPantry>1?'s':''}${inStock?` · <span style="color:var(--ok);font-weight:600">${inStock} déjà en stock${settings.hidePantry?' (masqués)':''}</span>`:''}`:'Rayon par rayon, avec le nom anglais pour New World.';
  $('#shopEmpty').hidden=has||hiddenByPantry;
  $('#freeAdd').classList.remove('hide');
  $('#shareShop').classList.toggle('hide',!has); $('#shopMore').classList.toggle('hide',!has&&!hiddenByPantry);
  if(!has){
    $('#validateBar').classList.add('hide');
    if(acquiredInMap.length){ $('#shopEmpty').hidden=true; cont.appendChild(acquiredNote(acquiredInMap)); }
    updateShopBadge(); return;
  }
  const byAisle={}; keys.forEach(k=>{(byAisle[map[k].aisle]=byAisle[map[k].aisle]||[]).push(k);});
  aisleOrder().forEach(aisle=>{
    const list=byAisle[aisle]; if(!list)return;
    list.sort((a,b)=>map[a].item.localeCompare(map[b].item));
    const done=list.filter(k=>shopChecked.has(k)).length;
    const h=document.createElement('div'); h.className='sec'; h.innerHTML=`<span>${aisle}</span><span class="mono">${done}/${list.length}</span>`; cont.appendChild(h);
    const sec=document.createElement('div'); sec.className='grp';
    list.forEach(k=>{
      const e=map[k],isDone=shopChecked.has(k);
      const qtyStr=e.mixed?e.mixed:(e.hasQty?fmtQty(e.qty)+(e.unit?' '+unitLabel(e.unit,e.qty):''):'');
      const fromArr=[...e.from];
      const nz=settings.nz?nzName(e.item):'';
      const stock=!settings.hidePantry&&inPantryByName(e.item);
      const wrap=document.createElement('div'); wrap.className='swrow';
      const row=document.createElement('div'); row.className='rw'+(isDone?' d':'');
      row.innerHTML=`<div class="chk">${checkSvg()}</div><span class="tile">${pantryEmo(e.item)}</span>`
        +`<div class="n">${e.item}<small>${nz?nz+' · ':''}${stock?'<span style="color:var(--ok)">en stock</span> · ':''}${fromArr.length>1?fromArr.length+' recettes':fromArr[0]}</small></div>`
        +`<span class="qty">${qtyStr}</span>`;
      const tog=()=>{ if(shopChecked.has(k))shopChecked.delete(k);else shopChecked.add(k); save(LS.shopChecked,[...shopChecked]); touch(); renderShop(); };
      row.onclick=tog;
      const del=document.createElement('button'); del.className='del'; del.textContent='Retirer';
      del.onclick=(ev)=>{ ev.stopPropagation(); if(k.startsWith('libre|')){ freeItems=freeItems.filter(f=>'libre|'+norm(f.name)!==k); save(LS.freeShop,freeItems); } else { removedShopItems.add(k); save(LS.removedShop,[...removedShopItems]); } touch(); toast('Retiré de la liste'); renderShop(); };
      wrap.appendChild(del); wrap.appendChild(row); bindSwipe(wrap);
      sec.appendChild(wrap);
    });
    cont.appendChild(sec);
  });
  if(acquiredInMap.length) cont.appendChild(acquiredNote(acquiredInMap));
  const removedInMap=Object.keys(map).filter(k=>removedShopItems.has(k));
  if(removedInMap.length){
    const rn=document.createElement('div'); rn.className='sec'; rn.style.justifyContent='center';
    rn.innerHTML=`<button type="button">Réafficher ${removedInMap.length} article${removedInMap.length>1?'s':''} retiré${removedInMap.length>1?'s':''}</button>`;
    rn.querySelector('button').onclick=()=>{ removedInMap.forEach(k=>removedShopItems.delete(k)); save(LS.removedShop,[...removedShopItems]); touch(); renderShop(); };
    cont.appendChild(rn);
  }
  const checkedCount=keys.filter(k=>shopChecked.has(k)).length;
  const vb=$('#validateBar');
  vb.classList.toggle('hide',checkedCount===0); $('#vbCount').textContent=checkedCount+' article'+(checkedCount>1?'s cochés':' coché');
  cont.style.paddingBottom=checkedCount?'84px':'';
  updateShopBadge();
}
function acquiredNote(keys){
  const wrap=document.createElement('div'); wrap.className='sec'; wrap.style.justifyContent='center'; wrap.style.textTransform='none';
  wrap.innerHTML=`<span>${keys.length} article${keys.length>1?'s':''} déjà rangé${keys.length>1?'s':''} au stock · <button type="button">remettre dans la liste</button></span>`;
  wrap.querySelector('button').onclick=()=>{ keys.forEach(k=>{ delete acquiredItems[k]; }); save('mm_acquired',acquiredItems); touch(); renderShop(); toast('Articles remis dans la liste'); };
  return wrap;
}
function updateShopBadge(){
  const map=buildShopping();
  const todo=Object.keys(map).filter(k=>!removedShopItems.has(k)&&!isAcquired(k));
  const remaining=todo.filter(k=>!shopChecked.has(k)).length;
  const b=$('#shopBadge'); b.classList.toggle('hide',!todo.length||!remaining); b.textContent=remaining;
}
/* validate shopping -> checked items go into pantry, then clear them from the list */
function validateShopping(){
  const map=buildShopping();
  const checkedKeys=Object.keys(map).filter(k=>shopChecked.has(k));
  if(!checkedKeys.length){ toast('Coche d\u2019abord les articles achetés'); return; }
  let n=0;
  checkedKeys.forEach(k=>{ const e=map[k]; if(k.startsWith('libre|')){ freeItems=freeItems.filter(f=>'libre|'+norm(f.name)!==k); n++; return; } pantryAdd(e.item.toLowerCase(), e.hasQty?e.qty:1, e.unit||'', 'courses'); n++; });
  save(LS.freeShop,freeItems);
  save(LS.pantry,pantry);
  // une fois rangés, ils sortent de la liste à acheter (sinon ils réapparaissaient
  // à chaque rendu, puisque la liste est reconstruite depuis les recettes choisies)
  const now=Date.now();
  checkedKeys.forEach(k=>{ shopChecked.delete(k); if(!k.startsWith('libre|')) acquiredItems[k]=now; });
  save(LS.shopChecked,[...shopChecked]); save('mm_acquired',acquiredItems);
  touch();
  toast(n+' article'+(n>1?'s':'')+' rangé'+(n>1?'s':'')+' au stock');
  renderShop(); renderFridge();
}

/* ---------- WEEK ---------- */
function renderDays(){
  const c=$('#days'); if(!c) return; c.innerHTML='';
  const now=new Date(); const dow=(now.getDay()+6)%7; const mon=new Date(now); mon.setDate(now.getDate()-dow);
  const hasDay=new Set(history.map(h=>h.date));
  ['L','M','M','J','V','S','D'].forEach((l,i)=>{ const d=new Date(mon); d.setDate(mon.getDate()+i); const iso=localDay(d); const el=document.createElement('div'); el.className=(iso===localDay(now)?'today':'')+(hasDay.has(iso)?' has':''); el.innerHTML=`${l}<b>${d.getDate()}</b>`; c.appendChild(el); });
}
function renderWeek(){
  renderDays();
  const cont=$('#weekList'); cont.innerHTML=''; const ids=[...selection].filter(id=>byId(id));
  $('#weekEmpty').hidden=!!ids.length; $('#weekH').hidden=!ids.length; cont.classList.toggle('hide',!ids.length);
  let portions=0; ids.forEach(id=>{ portions+=servingsFor(byId(id)); });
  const sub=$('#weekSub'); if(sub) sub.textContent=ids.length?`${ids.length} recette${ids.length>1?'s':''} · ${portions} portions · ${mealsLabel(portions)} pour ${settings.persons} pers.`:'Le menu de la semaine et ce que tu as déjà cuisiné.';
  ids.forEach(id=>{ const r=byId(id);
    const cs=cookState[id],stepsDone=cs?Object.values(cs.steps||{}).filter(s=>s&&s.done).length:0;
    const total=r.steps.length,pct=total?Math.round(stepsDone/total*100):0;
    const miss=pantry.length?missingFor(r):null;
    const row=document.createElement('div'); row.className='rw thumb';
    const state=pct>0?`<span style="color:var(--accT);font-weight:600">${pct} % fait</span>`:(miss?(miss.length?`<span class="warn" style="color:var(--warn)">${miss.length} article${miss.length>1?'s':''} manque${miss.length>1?'nt':''}</span>`:'<span style="color:var(--ok)">tout est en stock</span>'):mealsLabel(servingsFor(r)));
    row.innerHTML=`${hasPhoto(id)?`<img class="th" src="${photoSrc(id)}" alt="" loading="lazy">`:`<div class="noph">${recipeEmoji(r)}</div>`}
      <div class="b"><div class="t">${r.title}</div><div class="m">${r.time} min · ${state}</div></div>
      <button class="go" data-cook>Cuisiner</button>`;
    row.querySelector('[data-cook]').onclick=e=>{e.stopPropagation();openCook(id);};
    row.querySelector('.b').onclick=()=>openRecipeDetail(id);
    row.querySelector('.th,.noph').onclick=()=>openRecipeDetail(id);
    cont.appendChild(row);
  });
  renderHistory();
}

/* ---------- COOK ---------- */
let currentCook=null;
/* ---- recipe preview / detail sheet ---- */
function openRecipeDetail(id){
  const r=byId(id); if(!r)return;
  const inWeek=selection.has(id), made=lastMade(id);
  const sh=$('#sheet');
  const stepRows=r.steps.map((s,i)=>{ const secs=extractMinutes(s); return `<div class="stp"><b class="mono">${String(i+1).padStart(2,'0')}</b><div>${s}${secs?`<div><button class="tm" data-timer="${secs}" data-label="Étape ${i+1}"><svg viewBox="0 0 24 24"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M9 2h6" stroke-linecap="round"/></svg>${Math.round(secs/60)} min</button></div>`:''}</div></div>`; }).join('');
  sh.innerHTML=`<div class="rd-hero">${photoOrEmoji(id)}<div class="ov"></div><span class="grab hero"></span>
      <button class="cb l" id="rdClose" aria-label="Fermer"><svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12" stroke-linecap="round"/></svg></button>
      <button class="cb r ${isFav(id)?'on':''}" id="rdFav" aria-label="Favori">${heartSvg()}</button>
    </div>
    <div class="rd">
      <div class="kic">${kicker(r)}${r.time?' · '+r.time+' min':''}${r.custom?' · modifiée':''}</div>
      <h2>${r.title}</h2>
      <div class="rate">${starsHtml(id,{size:'sm',interactive:true})}<span id="rdRateLbl">${getRating(id)?'Ta note':'Note cette recette'}</span>${made?`<span style="margin-left:auto;color:var(--ok);font-weight:600">Fait ${daysSince(made)===0?"aujourd'hui":daysSince(made)===1?'hier':'il y a '+daysSince(made)+' j'}</span>`:''}</div>
      <div class="meta"><div class="stepper"><button id="rdMinus" aria-label="Moins">−</button><span id="rdServ"></span><button id="rdPlus" aria-label="Plus">+</button></div><span id="rdMeals"></span></div>
      <div class="btns"><button class="btn ${inWeek?'sub':'pri'}" id="rdToggle">${inWeek?'✓ Dans la semaine':'+ Dans la semaine'}</button><button class="btn" id="rdCook"><svg viewBox="0 0 24 24"><path d="M12 2a7 7 0 0 0-7 7c0 3 2 4 2 7h10c0-3 2-4 2-7a7 7 0 0 0-7-7zM7 20h10M9 22h6" stroke-linecap="round" stroke-linejoin="round"/></svg>Cuisiner</button></div>
      <div class="sec" style="padding-left:0;padding-right:0"><span>Ingrédients</span><span id="rdMiss"></span></div>
      <div class="grp" id="rdIngList"></div>
      <div id="rdCost" style="font-size:13px;color:var(--mut);padding:8px 2px 0"></div>
      <div class="sec" style="padding-left:0;padding-right:0"><span>Préparation</span><span>${r.steps.length} étapes</span></div>
      <div class="grp" style="padding:2px 12px">${stepRows}</div>
      <div id="rdProt" style="margin-top:12px"></div>
      ${r.tip?`<div class="note tip" style="margin-top:10px"><div><b>Astuce</b>${r.tip}</div></div>`:''}
      ${r.light?`<div class="note light" style="margin-top:10px"><div><b>Version légère</b>${r.light}</div></div>`:''}
      <div class="sec" style="padding-left:0;padding-right:0"><span>Ma note</span></div>
      <textarea id="rdNote" placeholder="Ce que tu as changé, ce qui a plu…">${notes[r.id]?escapeHtml(notes[r.id]):''}</textarea>
      <div class="btns" style="margin-top:12px"><button class="btn" id="rdDidIt">Déjà fait un autre jour</button><button class="btn" id="rdEdit">Modifier</button></div>
      ${r.custom&&RECIPES_SEED.some(x=>x.id===id)?'<button class="btn wide" id="rdReset" style="margin-top:8px;color:var(--mut)">Revenir à la version d’origine</button>':''}
      ${r.custom&&!RECIPES_SEED.some(x=>x.id===id)?'<button class="btn wide danger" id="rdDelete" style="margin-top:8px">Supprimer cette recette</button>':''}
    </div>`;
  openSheet(); bindStars(sh);
  function renderIng(){
    const miss=missingFor(r); const missSet=new Set(miss.map(m=>singular(m)));
    const rows=r.ingredients.map(([q,u,item])=>{ const sq=scaledQty(r,q); const qs=sq!=null?fmtQty(sq)+(u?' '+unitLabel(u,sq):''):(u||''); const base=baseIngredientName(item); const st=base&&!isStaple(base)?(missSet.has(singular(base))?'<span class="miss">manque</span>':(pantry.length?'<span class="have">en stock</span>':'')):''; const nz=settings.nz?nzName(item):''; return `<div class="ing-row"><span class="tile">${pantryEmo(item)}</span><span class="n">${qs?`<b class="q">${qs}</b> `:''}${item}${nz?`<small>${nz}</small>`:''}</span>${st}</div>`; }).join('');
    $('#rdIngList').innerHTML=rows;
    $('#rdServ').textContent=servingsFor(r)+' portion'+(servingsFor(r)>1?'s':'');
    $('#rdMeals').textContent=mealsLabel(servingsFor(r))+' pour '+settings.persons+' pers.';
    $('#rdMiss').textContent=pantry.length?(miss.length?miss.length+' manque'+(miss.length>1?'nt':''):'tout est en stock'):'';
    (function(){
      const box=$('#rdProt'); if(!box)return;
      const p=protOf(r.id), c=protComplement(r.id);
      if(!p){box.innerHTML='';return}
      box.innerHTML=`<div class="note prot"><div><b>Protéines</b>≈ ${p} g par portion. ${c?`Pour approcher ${PROT_CIBLE} g sur ce repas, il manque environ <strong>${c.manque} g</strong> : ${c.choix.map(x=>x.n+' (+'+x.p+' g)').join(', ')}.`:(PROT_DESSERT[r.id]?'Un dessert, on ne compte pas dessus.':'Ce plat couvre bien un repas principal.')}</div></div>`;
    })();
    const c=recipeCost(r);
    if(c.known>0){ $('#rdCost').innerHTML=`≈ ${fmtPrice(c.perServing)} par portion · ${fmtPrice(c.total)} au total${c.unknown?` · ${c.unknown} sans prix`:''} · <button style="color:var(--accT);font-weight:600" id="rdAddPrices">modifier les prix</button>`; }
    else { $('#rdCost').innerHTML=`<button style="color:var(--accT);font-weight:600" id="rdAddPrices">Estimer le coût (saisir les prix)</button>`; }
    const b=$('#rdAddPrices'); if(b)b.onclick=()=>openPriceSheet(id);
  }
  renderIng();
  $('#rdClose').onclick=closeSheet;
  sh.querySelectorAll('.tm').forEach(b=>b.onclick=()=>startTimer(+b.dataset.timer,b.dataset.label));
  const nt=$('#rdNote'); if(nt){ let ntT; nt.oninput=()=>{ clearTimeout(ntT); ntT=setTimeout(()=>{ const v=nt.value.trim(); if(v)notes[r.id]=v; else delete notes[r.id]; save(LS.notes,notes); touch(); },500); }; }
  $('#rdMinus').onclick=()=>{ const cs=ensureCookState(id); cs.servings=Math.max(1,servingsFor(r)-1); save(LS.cookState,cookState); touch(); renderIng(); renderShop(); };
  $('#rdPlus').onclick=()=>{ const cs=ensureCookState(id); cs.servings=servingsFor(r)+1; save(LS.cookState,cookState); touch(); renderIng(); renderShop(); };
  const fav=$('#rdFav'); fav.onclick=()=>{ toggleFav(id); fav.classList.toggle('on',isFav(id)); renderRecipes(); };
  $('#rdToggle').onclick=()=>{ toggleSelect(id); const on=selection.has(id); $('#rdToggle').className='btn '+(on?'sub':'pri'); $('#rdToggle').textContent=on?'✓ Dans la semaine':'+ Dans la semaine'; toast(on?'Ajouté à la semaine':'Retiré de la semaine'); };
  $('#rdCook').onclick=()=>{ closeSheet(); if(!selection.has(id)){selection.add(id);save(LS.selection,[...selection]);touch();refreshSelUI();renderRecipes();} openCook(id); };
  $('#rdDidIt').onclick=()=>openDidItSheet(id);
  $('#rdEdit').onclick=()=>openRecipeForm(r);
  const rr=$('#rdReset'); if(rr) rr.onclick=()=>{ if(confirm('Revenir à la version d’origine de cette recette ? Tes modifications seront perdues.')) resetRecipe(id); };
  const rd=$('#rdDelete'); if(rd) rd.onclick=()=>{ if(confirm('Supprimer cette recette ?')) deleteRecipe(id); };
}
function resetRecipe(id){
  if(RECIPES_SEED.some(s=>s.id===id)){ customRecipes=customRecipes.filter(r=>r.id!==id); save(LS.custom,customRecipes); touch(); rebuild(); closeSheet(); toast('Recette réinitialisée'); }
}
/* ---- price entry sheet: set a reference price per ingredient ---- */
function openPriceSheet(id){
  const r=byId(id),sh=$('#sheet');
  const items=r.ingredients.filter(([q,u,item])=>!isStaple(item));
  const rows=items.map(([q,u,item])=>{
    const key=priceKey(item); const p=prices[key]||{};
    const refQty=p.qty!=null?p.qty:(q!=null?fmtQty(q):''); const refUnit=p.unit!=null?p.unit:(u||'');
    return `<div class="rw price-row" data-key="${key}" style="flex-wrap:wrap">
      <div style="width:100%;font-weight:500">${item}</div>
      <div style="display:flex;gap:6px;align-items:center;width:100%;font-size:14px;color:var(--mut)">$<input type="number" step="0.01" min="0" inputmode="decimal" class="pr-price" placeholder="prix" value="${p.price!=null?p.price:''}" style="width:72px;border:1px solid var(--ln);border-radius:8px;padding:6px 8px;background:var(--sur2)">pour<input type="number" step="0.1" min="0" inputmode="decimal" class="pr-qty" placeholder="qté" value="${refQty}" style="width:64px;border:1px solid var(--ln);border-radius:8px;padding:6px 8px;background:var(--sur2)"><input type="text" class="pr-unit" placeholder="unité" value="${refUnit}" style="width:70px;border:1px solid var(--ln);border-radius:8px;padding:6px 8px;background:var(--sur2)"></div>
    </div>`;
  }).join('');
  sh.innerHTML=`<div class="grab"></div>
    <div class="sh-head"><h3>Prix des ingrédients</h3><button class="sh-x" id="psClose" aria-label="Fermer">${xSvg()}</button></div>
    <div class="sh-sub">Le prix payé et la quantité correspondante (3,50 $ pour 500 g). L’app calcule le coût par portion, pour toutes les recettes qui utilisent le même ingrédient.</div>
    <div class="grp" style="margin:0 16px">${rows}</div>
    <div class="stack"><button class="btn pri wide" id="psSave">Enregistrer les prix</button></div>`;
  openSheet(); $('#psClose').onclick=closeSheet;
  $('#psSave').onclick=()=>{
    sh.querySelectorAll('.price-row').forEach(row=>{
      const key=row.dataset.key;
      const price=parseFloat(row.querySelector('.pr-price').value);
      const qty=parseFloat(row.querySelector('.pr-qty').value);
      const unit=row.querySelector('.pr-unit').value.trim();
      if(!isNaN(price)&&price>0){ prices[key]={price, qty:isNaN(qty)?null:qty, unit}; }
      else { delete prices[key]; }
    });
    save(LS.prices,prices); touch(); closeSheet(); toast('Prix enregistrés'); openRecipeDetail(id);
  };
}
function ensureCookState(id){ const r=byId(id); if(!cookState[id])cookState[id]={servings:r.portions,steps:{}}; const cs=cookState[id]; if(cs.servings==null)cs.servings=cs.portions||r.portions; delete cs.portions; return cs; }
function extractMinutes(t){ let m=t.match(/(\d+)\s*(?:à|-)\s*(\d+)\s*min/); if(m)return(+m[2])*60; m=t.match(/(\d+)\s*min/); if(m)return(+m[1])*60; m=t.match(/(\d+)\s*h/); if(m)return(+m[1])*3600; return null; }
/* l'écran reste allumé pendant qu'on cuisine (iOS 16.4+, Android) */
let wakeLock=null;
async function keepAwake(on){ try{ if(on&&'wakeLock' in navigator){ wakeLock=await navigator.wakeLock.request('screen'); } else if(!on&&wakeLock){ await wakeLock.release(); wakeLock=null; } }catch(e){} }
document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='visible'&&currentCook) keepAwake(true); });
function openCook(id){ keepAwake(true); currentCook=id; ensureCookState(id); $('#cookTitle').textContent=byId(id).title; renderCookBody(); $('#cookModal').classList.add('open'); document.body.style.overflow='hidden'; $('#cookModal .modal-body').scrollTop=0; }
function closeCook(){ keepAwake(false); $('#cookModal').classList.remove('open'); document.body.style.overflow=''; currentCook=null; window._splitMode=false; }
function renderCookBody(){
  const r=byId(currentCook),cs=cookState[currentCook],factor=cs.servings/r.portions;
  $('#cookMeta').textContent=r.time+' min · '+cs.servings+' portions · '+mealsLabel(cs.servings);
  const anyAssigned=Object.values(cs.steps).some(s=>s&&s.assign);
  const doneCount=Object.values(cs.steps).filter(s=>s&&s.done).length,allDone=doneCount===r.steps.length;
  let html=`<div class="cook-tools">
    <div class="stepper"><button id="pMinus" aria-label="Moins">−</button><span>${cs.servings} portion${cs.servings>1?'s':''}</span><button id="pPlus" aria-label="Plus">+</button></div>
    <button class="tbtn" id="splitBtn"><svg viewBox="0 0 24 24"><path d="M7 7h10M7 12h10M7 17h6" stroke-linecap="round"/><circle cx="19" cy="17" r="2"/></svg>À deux</button>
    <button class="tbtn" id="shareBtn"><svg viewBox="0 0 24 24"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13" stroke-linecap="round" stroke-linejoin="round"/></svg>Partager</button>
  </div>`;
  html+=`<div class="sec" style="padding-left:0;padding-right:0"><span>Ingrédients</span></div><div class="grp">`;
  r.ingredients.forEach(([q,u,item])=>{ const sc=q!=null?q*factor:null; const qs=sc!=null?fmtQty(sc)+(u?' '+unitLabel(u,sc):''):(u||''); html+=`<div class="ing-row"><span class="tile">${pantryEmo(item)}</span><span class="n">${qs?`<b class="q">${qs}</b> `:''}${item}</span></div>`; });
  html+=`</div>`;
  if(anyAssigned) html+=`<div class="legend" style="margin-top:10px"><span><span class="sw" style="background:var(--acc)"></span>Moi</span><span><span class="sw" style="background:var(--warn)"></span>L’autre</span></div>`;
  html+=`<div class="sec" style="padding-left:0;padding-right:0"><span>Préparation</span><span class="mono">${doneCount}/${r.steps.length}</span></div>`;
  r.steps.forEach((s,i)=>{
    const st=cs.steps[i]||{},secs=extractMinutes(s);
    const badge=st.assign?`<span class="mine ${st.assign==='b'?'b':''}">${st.assign==='a'?'Moi':'L’autre'}</span>`:'';
    html+=`<div class="step ${st.done?'done':''}" data-step="${i}"><div class="num">${i+1}</div>
      <div class="step-body"><div class="step-txt">${s}</div>${badge}
      ${secs?`<div><button class="tm" style="display:inline-flex;align-items:center;gap:4px;font-size:12px;color:var(--accT);font-weight:600;background:var(--accW);padding:4px 9px;border-radius:999px;margin-top:6px" data-timer="${secs}" data-label="Étape ${i+1}"><svg viewBox="0 0 24 24" style="width:13px;height:13px;stroke:currentColor;fill:none;stroke-width:2"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M9 2h6" stroke-linecap="round"/></svg>${Math.round(secs/60)} min</button></div>`:''}</div>
      <div class="cbtn"><div class="chk ${st.done?'d':''}" style="${st.done?'background:var(--ok);border-color:var(--ok)':''}"><svg viewBox="0 0 24 24" style="${st.done?'opacity:1':''}"><path d="M20 6 9 17l-5-5" stroke-linecap="round" stroke-linejoin="round"/></svg></div></div></div>`;
  });
  html+=`${r.tip?`<div class="note tip" style="margin-top:10px"><div><b>Astuce</b>${r.tip}</div></div>`:''}${r.light?`<div class="note light" style="margin-top:10px"><div><b>Version légère</b>${r.light}</div></div>`:''}
    <div style="height:70px"></div>
    <div class="finish"><button class="btn pri wide" id="finishBtn">${allDone?'✓ Terminé, c’est cuisiné':'Marquer comme cuisiné'}</button></div>`;
  $('#cookInner').innerHTML=html;
  $('#pMinus').onclick=()=>{cs.servings=Math.max(1,cs.servings-1);save(LS.cookState,cookState);touch();renderCookBody();};
  $('#pPlus').onclick=()=>{cs.servings++;save(LS.cookState,cookState);touch();renderCookBody();};
  $('#splitBtn').onclick=toggleSplitMode; $('#shareBtn').onclick=openShareSheet; $('#finishBtn').onclick=()=>markDone(currentCook);
  $$('#cookInner .step').forEach(el=>{ const i=+el.dataset.step;
    const tog=()=>{cs.steps[i]=cs.steps[i]||{};cs.steps[i].done=!cs.steps[i].done;save(LS.cookState,cookState);touch();renderCookBody();};
    el.querySelector('.cbtn').onclick=e=>{e.stopPropagation();tog();}; el.querySelector('.step-txt').onclick=tog;
  });
  $$('#cookInner .tm').forEach(b=>b.onclick=e=>{e.stopPropagation();startTimer(+b.dataset.timer,b.dataset.label);});
  if(window._splitMode)applySplitClickHandlers();
}
function toggleSplitMode(){ window._splitMode=!window._splitMode; if(window._splitMode)toast('Sous chaque étape : Moi ou L’autre'); applySplitClickHandlers(); }
function applySplitClickHandlers(){
  const cs=cookState[currentCook];
  $$('#cookInner .step').forEach(el=>{ const i=+el.dataset.step; let ctrl=el.querySelector('.assign-row');
    if(window._splitMode&&!ctrl){ ctrl=document.createElement('div'); ctrl.className='assign-row'; const cur=(cs.steps[i]||{}).assign;
      ctrl.innerHTML=`<button class="${cur==='a'?'a':''}" data-a>Moi</button><button class="${cur==='b'?'b':''}" data-b>L’autre</button>`;
      el.querySelector('.step-body').appendChild(ctrl);
      ctrl.querySelector('[data-a]').onclick=e=>{e.stopPropagation();cs.steps[i]=cs.steps[i]||{};cs.steps[i].assign=cs.steps[i].assign==='a'?null:'a';save(LS.cookState,cookState);touch();renderCookBody();window._splitMode=true;applySplitClickHandlers();};
      ctrl.querySelector('[data-b]').onclick=e=>{e.stopPropagation();cs.steps[i]=cs.steps[i]||{};cs.steps[i].assign=cs.steps[i].assign==='b'?null:'b';save(LS.cookState,cookState);touch();renderCookBody();window._splitMode=true;applySplitClickHandlers();};
    } else if(!window._splitMode&&ctrl)ctrl.remove();
  });
}

/* ---- share ---- */
function openShareSheet(){
  const r=byId(currentCook),cs=cookState[currentCook];
  const assigned=r.steps.map((s,i)=>({s,i,a:(cs.steps[i]||{}).assign})).filter(x=>x.a==='b');
  const forOther=assigned.length?assigned:r.steps.map((s,i)=>({s,i}));
  const payload={t:r.title,p:cs.servings,steps:forOther.map(x=>x.s)};
  const link=buildShareLink(payload);
  const plain=`${r.title} : mes étapes\n\n`+forOther.map((x,k)=>`${k+1}. ${x.s}`).join('\n');
  const sh=$('#sheet');
  sh.innerHTML=`<div class="grab"></div>
    <div class="sh-head"><h3>Partager les étapes</h3><button class="sh-x" id="shClose" aria-label="Fermer"><svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12" stroke-linecap="round"/></svg></button></div>
    <div class="sh-sub">${assigned.length?'Les étapes attribuées à « l’autre » ('+assigned.length+')':'Toutes les étapes'}, à ouvrir sur l’autre téléphone.</div>
    <div class="qr-wrap"><div id="qrBox"></div><div class="qr-cap">Scanne ce code avec l’autre téléphone : les étapes s’ouvrent en plein écran, sans rien installer.</div></div>
    <div class="stack">
      <button class="btn pri wide" id="shShare">Envoyer le lien</button>
      <button class="btn wide" id="shCopyLink">Copier le lien</button>
      <button class="btn wide" id="shCopyText">Copier les étapes en texte</button></div>`;
  openSheet();
  $('#shClose').onclick=closeSheet;
  try{renderQR($('#qrBox'),link);}catch(e){$('#qrBox').innerHTML='<div class="sh-sub">QR indisponible, utilise le lien.</div>';}
  $('#shShare').onclick=async()=>{ if(navigator.share){try{await navigator.share({title:r.title,text:'Mes étapes : '+r.title,url:link});}catch(e){}}else{copy(link);toast('Lien copié');} };
  $('#shCopyLink').onclick=()=>{copy(link);toast('Lien copié');};
  $('#shCopyText').onclick=()=>{copy(plain);toast('Étapes copiées');};
}
function buildShareLink(p){ const b64=btoa(unescape(encodeURIComponent(JSON.stringify(p)))); return location.href.split('#')[0]+'#cook='+b64; }
function copy(t){ if(navigator.clipboard)navigator.clipboard.writeText(t).catch(()=>fbCopy(t)); else fbCopy(t); }
function fbCopy(t){ const a=document.createElement('textarea'); a.value=t; document.body.appendChild(a); a.select(); try{document.execCommand('copy')}catch(e){} a.remove(); }

/* consume pantry items used by a recipe; returns array of consumed names */
function consumePantryFor(r, portions){
  const factor = portions && r.portions ? portions/r.portions : 1;
  const used=[];
  r.ingredients.forEach(([q,u,item])=>{
    const base=baseIngredientName(item); if(!base||isStaple(base))return;
    const idx=pantryIndexFor(base);
    if(idx<0)return;
    const p=pantry[idx];
    if(q!=null && u && p.unit && unitFamily(u)===unitFamily(p.unit)){
      const reste=toBaseUnit(p.qty||0,p.unit)-toBaseUnit(q*factor,u);
      if(reste<=0.001){ pantry.splice(idx,1); }   // entièrement utilisé
      else { const [q2,u2]=fromBaseUnit(reste,unitFamily(p.unit)); p.qty=q2; p.unit=u2; }
    } else {
      // countable or unit mismatch: use one unit
      p.qty=(p.qty||1)-1;
      if(p.qty<=0){ pantry.splice(idx,1); }
    }
    used.push(base);
  });
  if(used.length) save(LS.pantry,pantry);
  return used;
}
/* ---- mark done ---- */
function markDone(id){
  const r=byId(id),day=localDay();
  if(!history.some(h=>h.id===id&&h.date===day)) history.push({id,title:r.title,date:day});
  save(LS.history,history);
  const portions=cookState[id]&&cookState[id].servings;
  const used=consumePantryFor(r, portions);
  // remove from the week and reset its cook progress
  selection.delete(id); save(LS.selection,[...selection]);
  if(cookState[id])cookState[id].steps={}; save(LS.cookState,cookState);
  // its bought items are consumed: clear from shopping tracking
  touch();
  closeCook();
  refreshSelUI(); renderWeek(); renderRecipes(); renderHistory(); renderFridge(); renderShop();
  // celebrate + invite a rating
  openRatePrompt(r, used.length);
}
function openRatePrompt(r, usedCount){
  const sh=$('#sheet');
  sh.innerHTML=`<div class="grab"></div>
    <div style="text-align:center;padding:18px 16px 8px">
      <div style="font-size:44px;line-height:1;margin-bottom:8px">🎉</div>
      <h3 style="margin:0 0 4px;font-size:22px">Bon appétit !</h3>
      <div class="sh-sub" style="padding:0">« ${r.title} » est dans ton historique.${usedCount?' '+usedCount+' ingrédient'+(usedCount>1?'s retirés':' retiré')+' du stock.':''}</div>
      <div style="font-size:13px;color:var(--mut);margin:16px 0 8px">Tu as aimé ? Note la recette</div>
      <div style="display:flex;justify-content:center;margin-bottom:18px">${starsHtml(r.id,{size:'lg',interactive:true})}</div>
    </div>
    <div class="stack"><button class="btn pri wide" id="rateDone">Terminer</button></div>`;
  openSheet(); bindStars(sh);
  $('#rateDone').onclick=()=>{ closeSheet(); };
}
function openDidItSheet(id){
  const r=byId(id),sh=$('#sheet');
  const today=localDay();
  sh.innerHTML=`<div class="grab"></div>
    <div class="sh-head"><h3>Déjà fait ?</h3><button class="sh-x" id="diClose" aria-label="Fermer"><svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12" stroke-linecap="round"/></svg></button></div>
    <div class="sh-sub">« ${r.title} » sera ajouté à ton historique et au calendrier.</div>
    <div class="sh-body">
      <div class="chips" style="padding:4px 0 12px"><button class="chip" data-q="0">Aujourd'hui</button><button class="chip" data-q="1">Hier</button><button class="chip" data-q="2">Avant-hier</button></div>
      <div class="frow"><label>Quel jour ?</label><input id="diDate" type="date" value="${today}" max="${today}"></div>
      <div class="grp"><div class="rw"><span>Retirer aussi les ingrédients du stock</span><button class="tog" id="diConsume" role="switch" aria-checked="false"></button></div></div>
      <div class="stack" style="padding:12px 0 0"><button class="btn pri wide" id="diSave">Ajouter à l’historique</button></div>
    </div>`;
  openSheet();
  $('#diClose').onclick=closeSheet;
  sh.querySelectorAll('.chip').forEach(b=>b.onclick=()=>{ const d=new Date(); d.setDate(d.getDate()-(+b.dataset.q)); $('#diDate').value=localDay(d); sh.querySelectorAll('.chip').forEach(x=>x.classList.toggle('on',x===b)); });
  const tg=$('#diConsume'); tg.onclick=()=>{ tg.classList.toggle('on'); tg.setAttribute('aria-checked',tg.classList.contains('on')); };
  $('#diSave').onclick=()=>{
    const date=$('#diDate').value||today;
    const consumed=logMade(id,date,tg.classList.contains('on'));
    closeSheet();
    toast(consumed?'Ajouté à l’historique, '+consumed+' ingrédient'+(consumed>1?'s retirés':' retiré')+' du stock':'Ajouté à l’historique');
  };
}
function logMade(id,date,consume){
  const r=byId(id);
  if(!history.some(h=>h.id===id&&h.date===date)) history.push({id,title:r.title,date});
  save(LS.history,history);
  let consumed=0;
  if(consume) consumed=consumePantryFor(r, cookState[id]&&cookState[id].servings).length;
  // if it was in the week, remove it (it's now done)
  if(selection.has(id)){ selection.delete(id); save(LS.selection,[...selection]); }
  touch();
  refreshSelUI(); renderWeek(); renderRecipes(); renderHistory(); renderFridge(); renderShop();
  return consumed;
}

/* ---------- HISTORY (list + calendar) ---------- */
const MONTHS=['janv','févr','mars','avr','mai','juin','juil','août','sept','oct','nov','déc'];
const MONTHS_FULL=['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
let histMode='list', calYear, calMonth;
let histAll=false;
function renderHistory(){
  const rows=[...history].sort((a,b)=>b.date.localeCompare(a.date));
  const sr=$('#statRow');
  const has=rows.length>0;
  $('#histEmpty').hidden=has; $('#histH').hidden=!has; sr.classList.toggle('hide',!has);
  if(has){
    const last30=rows.filter(h=>daysSince(h.date)<=30).length,uniq=new Set(rows.map(h=>h.id)).size;
    sr.innerHTML=`<div class="stat"><div class="v">${rows.length}</div><div class="k">plats cuisinés</div></div>
      <div class="stat"><div class="v">${last30}</div><div class="k">ces 30 jours</div></div>
      <div class="stat"><div class="v">${uniq}</div><div class="k">recettes différentes</div></div>`;
  }
  $('#histToggleBtn').textContent=histMode==='list'?'Calendrier':'Liste';
  $('#histList').classList.toggle('hide',!(histMode==='list'&&has));
  $('#calWrap').hidden=!(histMode==='cal'&&has);
  if(histMode==='list') renderHistList(rows); else renderCalendar();
}
function renderHistList(rows){
  const cont=$('#histList'); cont.innerHTML='';
  const shown=histAll?rows:rows.slice(0,5);
  shown.forEach(h=>{ const [y,m,d]=h.date.split('-').map(Number); const rr=byId(h.id);
    const item=document.createElement('div'); item.className='rw thumb';
    item.innerHTML=`${rr&&hasPhoto(h.id)?`<img class="th" src="${photoSrc(h.id)}" alt="" loading="lazy">`:`<div class="noph">${rr?recipeEmoji(rr):'🍽'}</div>`}
      <div class="b"><div class="t">${h.title}</div><div class="m">${d} ${MONTHS[m-1]} · ${daysSince(h.date)===0?"aujourd'hui":daysSince(h.date)===1?'hier':'il y a '+daysSince(h.date)+' jours'}${rr&&getRating(h.id)?' · '+'★'.repeat(getRating(h.id)):''}</div></div>
      ${rr?`<button class="go" data-again>Refaire</button>`:''}`;
    if(rr){ item.querySelector('[data-again]').onclick=(e)=>{ e.stopPropagation(); if(!selection.has(h.id)){toggleSelect(h.id); toast('Ajouté à la semaine');} else toast('Déjà dans la semaine'); };
      item.querySelector('.b').onclick=()=>openRecipeDetail(h.id); }
    cont.appendChild(item);
  });
  if(rows.length>5){
    const more=document.createElement('div'); more.className='rw'; more.style.justifyContent='center';
    more.innerHTML=`<button type="button" style="color:var(--accT);font-weight:600">${histAll?'Réduire':'Tout voir ('+rows.length+')'}</button>`;
    more.querySelector('button').onclick=()=>{ histAll=!histAll; renderHistList(rows); };
    cont.appendChild(more);
  }
}
function renderCalendar(){
  if(calYear==null){ const n=new Date(); calYear=n.getFullYear(); calMonth=n.getMonth(); }
  $('#calMonth').textContent=MONTHS_FULL[calMonth]+' '+calYear;
  const grid=$('#calGrid'); grid.innerHTML='';
  ['L','M','M','J','V','S','D'].forEach(d=>{ const el=document.createElement('div'); el.className='cal-dow'; el.textContent=d; grid.appendChild(el); });
  const first=new Date(calYear,calMonth,1); let startDow=(first.getDay()+6)%7;
  const days=new Date(calYear,calMonth+1,0).getDate();
  const byDay={}; history.forEach(h=>{ const [y,m,d]=h.date.split('-').map(Number); if(y===calYear&&m-1===calMonth)(byDay[d]=byDay[d]||[]).push(h); });
  for(let i=0;i<startDow;i++){ const e=document.createElement('div'); e.className='cal-cell empty-cell'; grid.appendChild(e); }
  const todayStr=localDay();
  for(let d=1;d<=days;d++){
    const iso=calYear+'-'+String(calMonth+1).padStart(2,'0')+'-'+String(d).padStart(2,'0');
    const meals=byDay[d]; const cell=document.createElement('div');
    cell.className='cal-cell'+(meals?' has':'')+(iso===todayStr?' today':'');
    cell.textContent=d;
    if(meals)cell.onclick=()=>showDayMeals(iso,meals);
    grid.appendChild(cell);
  }
}
function showDayMeals(iso,meals){
  const [y,m,d]=iso.split('-').map(Number);
  const sh=$('#sheet');
  sh.innerHTML=`<div class="grab"></div>
    <div class="sh-head"><h3>${d} ${MONTHS_FULL[m-1]} ${y}</h3><button class="sh-x" id="dmClose" aria-label="Fermer"><svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12" stroke-linecap="round"/></svg></button></div>
    <div class="sh-sub">${meals.length} plat${meals.length>1?'s':''} cuisiné${meals.length>1?'s':''} ce jour-là.</div>
    <div class="grp" id="dmList" style="margin:0 16px"></div>`;
  openSheet(); $('#dmClose').onclick=closeSheet;
  const list=$('#dmList');
  meals.forEach(h=>{ const rr=byId(h.id);
    const item=document.createElement('div'); item.className='rw thumb';
    item.innerHTML=`${rr&&hasPhoto(h.id)?`<img class="th" src="${photoSrc(h.id)}" alt="">`:`<div class="noph">${rr?recipeEmoji(rr):'🍽'}</div>`}
      <div class="b"><div class="t">${h.title}</div><div class="m">${rr?'dans ton catalogue':'recette supprimée'}</div></div>${rr?'<span class="chev">›</span>':''}`;
    if(rr)item.onclick=()=>{ closeSheet(); openRecipeDetail(h.id); };
    list.appendChild(item);
  });
}
$('#histToggleBtn').onclick=()=>{ histMode=histMode==='list'?'cal':'list'; renderHistory(); };
$('#calPrev').onclick=()=>{ calMonth--; if(calMonth<0){calMonth=11;calYear--;} renderCalendar(); };
$('#calNext').onclick=()=>{ calMonth++; if(calMonth>11){calMonth=0;calYear++;} renderCalendar(); };
$('#calToday').onclick=()=>{ const n=new Date(); calYear=n.getFullYear(); calMonth=n.getMonth(); renderCalendar(); };
$('#logMealBtn').onclick=openLogMealPicker;
function openLogMealPicker(){
  const sh=$('#sheet');
  const item=r=>`<button class="pick-recipe" data-r="${r.id}"><span class="th">${hasPhoto(r.id)?`<img src="${photoSrc(r.id)}" alt="" loading="lazy">`:recipeEmoji(r)}</span><span class="b"><span class="t">${r.title}</span><span class="m">${r.time} min · ${kicker(r)}</span></span></button>`;
  sh.innerHTML=`<div class="grab"></div>
    <div class="sh-head"><h3>Quel plat as-tu fait ?</h3><button class="sh-x" id="lpClose" aria-label="Fermer"><svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12" stroke-linecap="round"/></svg></button></div>
    <div class="sh-sub">Choisis une recette, tu indiqueras le jour ensuite.</div>
    <div class="search" style="margin-bottom:10px"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3" stroke-linecap="round"/></svg><input id="lpSearch" type="search" placeholder="Chercher" autocomplete="off"></div>
    <div class="pick-list" id="lpList">${allRecipes.map(item).join('')}</div>`;
  openSheet(); $('#lpClose').onclick=closeSheet;
  const bind=()=>sh.querySelectorAll('.pick-recipe').forEach(b=>b.onclick=()=>openDidItSheet(b.dataset.r));
  bind();
  $('#lpSearch').oninput=e=>{ const q=norm(e.target.value); $('#lpList').innerHTML=allRecipes.filter(r=>norm(r.title).includes(q)).map(item).join(''); bind(); };
}

/* ---------- ADD / EDIT ---------- */
const AISLE_HINTS=[
  [/poulet|boeuf|bœuf|porc|chorizo|lardon|jambon|saucisse|saumon|poisson|cabillaud|crevette|agneau|steak|viande|haché|hache|dinde|moules|filet/i,'Viandes & poissons'],
  [/caf[ée]|(^|\s)th[ée](s|$|\s)|chocolat|biscuit|c[ée]r[ée]ales|confiture|vinaigre|moutarde|ketchup|mayonnaise/i,'Conserves & épicerie'],
  [/oignon|ail|carotte|courgette|poivron|tomate|épinard|salade|concombre|pomme de terre|brocoli|chou|champignon|citron|gingembre|basilic|menthe|persil|patate|aubergine|poireau|céleri|fruit|banane|pomme|avocat/i,'Légumes & fruits'],
  [/feta|mozzarella|parmesan|cheddar|ricotta|crème|lait|beurre|yaourt|fromage|halloumi/i,'Frais & crémerie'],
  [/œuf|oeuf/i,'Œufs'],
  [/\briz\b|pâtes|\bpates?\b|gnocchi|couscous|lasagne|pain|semoule|quinoa|boulgour|farine|nouille/i,'Pâtes, riz & féculents'],
  [/pois chiche|lentille|haricot|maïs|mais|tomates concassées|lait de coco|bouillon|sauce soja|concentré|huile|curry|paprika|cumin|curcuma|épice|conserve|sucre/i,'Conserves & épicerie'],
];
function guessAisle(item){ for(const[re,a]of AISLE_HINTS)if(re.test(item))return a; return 'Autres'; }
function parseIngLine(line){
  line=line.trim(); if(!line)return null;
  const units='g|kg|mg|ml|mL|cl|l|L|c\\. à café|c\\. à soupe|cuillères?|boîtes?|boite|gousses?|gousse|poignées?|poignée|morceau|boule|feuilles?|tranche|pincée|verre|sachet|tasse|paquet';
  let m=line.match(new RegExp('^(\\d+(?:[.,]\\d+)?)\\s*('+units+')\\s+(?:de\\s+|d\'|d\u2019)?(.+)$','i'));
  if(m)return[parseFloat(m[1].replace(',','.')),m[2].replace('boite','boîte'),m[3].trim(),guessAisle(m[3])];
  m=line.match(/^(\d+(?:[.,]\d+)?)\s+(.+)$/);
  if(m)return[parseFloat(m[1].replace(',','.')),'',m[2].trim(),guessAisle(m[2])];
  return[null,'',line,guessAisle(line)];
}
function fmtIngLine([q,u,item]){ const qs=q!=null?(fmtQty(q)+(u?' '+u:'')+' '):(u?u+' ':''); return (qs+item).trim(); }
function openRecipeForm(existing){
  const e=existing||{},sh=$('#sheet');
  sh.innerHTML=`<div class="grab"></div>
    <div class="sh-head"><h3>${existing?'Modifier la recette':'Nouvelle recette'}</h3><button class="sh-x" id="rfClose" aria-label="Fermer"><svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12" stroke-linecap="round"/></svg></button></div>
    <div class="sh-sub">Une ligne par ingrédient et par étape. Le rayon est deviné tout seul.</div>
    <div class="sh-body">
    <div class="frow"><label>Nom</label><input id="rfTitle" value="${e.title?e.title.replace(/"/g,'&quot;'):''}" placeholder="Ex. Tarte aux légumes"></div>
    <div class="frow"><div class="two"><div><label>Portions</label><input id="rfPortions" type="number" inputmode="numeric" min="1" value="${e.portions||4}"></div><div><label>Temps (min)</label><input id="rfTime" type="number" inputmode="numeric" min="1" value="${e.time||30}"></div></div></div>
    <div class="frow"><label>Tags (virgules)</label><input id="rfTags" value="${e.tags?e.tags.join(', '):'végé'}" placeholder="végé, rapide, four"></div>
    <div class="frow"><label>Ingrédients</label><textarea id="rfIng" placeholder="1 boîte de pois chiches&#10;2 carottes&#10;160 g de riz">${e.ingredients?e.ingredients.map(fmtIngLine).join('\n'):''}</textarea></div>
    <div class="frow"><label>Étapes</label><textarea id="rfSteps" placeholder="Cuire le riz.&#10;Faire revenir l'oignon.">${e.steps?e.steps.join('\n'):''}</textarea></div>
    <div class="frow"><label>Astuce (optionnel)</label><input id="rfTip" value="${e.tip?e.tip.replace(/"/g,'&quot;'):''}" placeholder="Se réchauffe très bien"></div>
    <div class="btns"><button class="btn pri" id="rfSave">${existing?'Enregistrer':'Ajouter la recette'}</button></div>
    </div>`;
  openSheet(); $('#rfClose').onclick=closeSheet; $('#rfSave').onclick=()=>saveRecipeForm(existing);
}
function saveRecipeForm(existing){
  const title=$('#rfTitle').value.trim(); if(!title){toast('Donne un nom à la recette');return;}
  const portions=Math.max(1,parseInt($('#rfPortions').value)||4),time=Math.max(1,parseInt($('#rfTime').value)||30);
  const tags=$('#rfTags').value.split(',').map(s=>s.trim()).filter(Boolean);
  const ingredients=$('#rfIng').value.split('\n').map(parseIngLine).filter(Boolean);
  const steps=$('#rfSteps').value.split('\n').map(s=>s.trim()).filter(Boolean);
  const tip=$('#rfTip').value.trim();
  if(!ingredients.length||!steps.length){toast('Ajoute au moins un ingrédient et une étape');return;}
  if(existing){ const idx=customRecipes.findIndex(r=>r.id===existing.id);
    const upd={...existing,title,portions,time,tags,ingredients,steps,tip,custom:true};
    if(existing.dessert||(existing.tags||[]).includes('dessert')||tags.includes('dessert')) upd.dessert=true;
    if(idx>=0)customRecipes[idx]=upd; else{upd.id=existing.id;customRecipes.push(upd);} toast('Recette mise à jour');
  } else { customRecipes.push({id:'c'+Date.now().toString(36),title,portions,time,tags,ingredients,steps,tip,custom:true}); toast('Recette ajoutée'); }
  save(LS.custom,customRecipes); touch(); rebuild(); closeSheet();
}
function deleteRecipe(id){ customRecipes=customRecipes.filter(r=>r.id!==id); save(LS.custom,customRecipes); selection.delete(id); save(LS.selection,[...selection]); touch(); rebuild(); closeSheet(); toast('Recette supprimée'); }
function rebuild(){
  const seedFiltered=RECIPES_SEED.filter(s=>!customRecipes.some(c=>c.id===s.id));
  allRecipes=[...seedFiltered,...customRecipes];
  renderChips(); renderRecipes(); renderShop(); renderWeek(); renderHistory(); renderFridge(); refreshSelUI();
}

/* ---------- TIMER ---------- */
let timer={secs:0,label:'',running:false,int:null};
function startTimer(secs,label){
  timer.secs=secs;timer.label=label||'Minuteur';timer.running=true;
  $('#tpLbl').textContent=timer.label; updateTimerDisplay(); $('#timerPop').classList.add('open'); $('#tpTime').classList.remove('done'); $('#tpToggle').textContent='Pause';
  clearInterval(timer.int);
  timer.int=setInterval(()=>{ if(!timer.running)return; timer.secs--; updateTimerDisplay(); if(timer.secs<=0){clearInterval(timer.int);timer.running=false;timerDone();} },1000);
  toast('Minuteur lancé : '+Math.round(secs/60)+' min');
}
function updateTimerDisplay(){ const m=Math.floor(Math.max(0,timer.secs)/60),s=Math.max(0,timer.secs)%60; $('#tpTime').textContent=String(m).padStart(2,'0')+':'+String(s).padStart(2,'0'); }
function timerDone(){
  $('#tpTime').textContent='00:00'; $('#tpTime').classList.add('done'); $('#tpLbl').textContent=timer.label+' : terminé !';
  toast('⏰ '+timer.label+' : c&rsquo;est prêt !');
  try{ const ac=new(window.AudioContext||window.webkitAudioContext)(); [0,.5,1].forEach(t=>{const o=ac.createOscillator(),g=ac.createGain();o.connect(g);g.connect(ac.destination);o.frequency.value=880;g.gain.setValueAtTime(.001,ac.currentTime+t);g.gain.exponentialRampToValueAtTime(.3,ac.currentTime+t+.02);g.gain.exponentialRampToValueAtTime(.001,ac.currentTime+t+.35);o.start(ac.currentTime+t);o.stop(ac.currentTime+t+.4);}); }catch(e){}
  if(navigator.vibrate)navigator.vibrate([200,100,200,100,200]);
}
$('#tpToggle').onclick=()=>{ if(timer.secs<=0){$('#timerPop').classList.remove('open');return;} timer.running=!timer.running; $('#tpToggle').textContent=timer.running?'Pause':'Reprendre'; };
$('#tpStop').onclick=()=>{ clearInterval(timer.int); timer.running=false; $('#timerPop').classList.remove('open'); };

/* ---------- SHEET open/close ---------- */
function openSheet(){ $('#sheetBg').classList.add('open'); $('#sheet').scrollTop=0; document.body.style.overflow='hidden'; $('#sheetBg').onclick=e=>{if(e.target===$('#sheetBg'))closeSheet();}; }
function closeSheet(){ $('#sheetBg').classList.remove('open'); if(!$('#cookModal').classList.contains('open')) document.body.style.overflow=''; }
document.addEventListener('keydown',e=>{ if(e.key==='Escape'){ if($('#sheetBg').classList.contains('open')) closeSheet(); else if($('#cookModal').classList.contains('open')) closeCook(); } });

/* ---------- ACCOUNT / SYNC UI ---------- */
function updateSyncDot(){
  const dot=$('#syncDot'); const st=!Sync.enabled?'off':(Sync.session?(Sync.status==='syncing'?'syncing':Sync.status==='err'?'err':'on'):'off');
  dot.className='dot'+(st==='off'?' hide':''); dot.style.background=st==='err'?'var(--red)':st==='syncing'?'var(--warn)':'var(--ok)';
}
Sync.onChange=(status,user)=>updateSyncDot();
function openAccountSheet(){ renderSettingsSheet(); openSheet(); }
function segHtml(id,opts,cur){ return `<div class="seg" id="${id}">${opts.map(([v,l])=>`<button type="button" data-v="${v}" class="${cur===v?'on':''}">${l}</button>`).join('')}</div>`; }
function renderSettingsSheet(){
  const sh=$('#sheet');
  sh.innerHTML=`<div class="grab"></div>
    <div class="sh-head"><h3>Réglages</h3><button class="sh-x" id="acClose" aria-label="Fermer"><svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12" stroke-linecap="round"/></svg></button></div>
    <div class="sec"><span>Apparence</span></div>
    <div class="grp" style="margin:0 16px">
      <div class="rw"><span class="ico" style="background:#8E8E93"><svg viewBox="0 0 24 24"><path d="M12 3a9 9 0 1 0 0 18V3z" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="9"/></svg></span><span>Thème</span>${segHtml('segTheme',[['system','Auto'],['light','Clair'],['dark','Sombre']],settings.theme)}</div>
      <div class="rw"><span class="ico" style="background:#3F9B6A">Aa</span><span>Texte plus grand</span><button class="tog ${settings.bigText?'on':''}" id="togBig" role="switch" aria-checked="${!!settings.bigText}"></button></div>
    </div>
    <div class="sec"><span>Cuisine</span></div>
    <div class="grp" style="margin:0 16px">
      <div class="rw"><span class="ico" style="background:var(--acc);color:var(--accFg)">${settings.persons}</span><span>Personnes à la maison</span><div class="stepper" style="margin-left:auto"><button id="persMinus" aria-label="Moins">−</button><span id="persVal">${settings.persons}</span><button id="persPlus" aria-label="Plus">+</button></div></div>
      <div class="rw"><span class="ico" style="background:#2C6FBF">NZ</span><span>Noms anglais en rayon</span><button class="tog ${settings.nz?'on':''}" id="togNz" role="switch" aria-checked="${!!settings.nz}"></button></div>
      <div class="rw"><span class="ico" style="background:#C77800"><svg viewBox="0 0 24 24"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M4 11h16" stroke-linecap="round"/></svg></span><span>Masquer dans les courses ce qui est en stock</span><button class="tog ${settings.hidePantry?'on':''}" id="togHide" role="switch" aria-checked="${!!settings.hidePantry}"></button></div>
      <div class="rw" id="rowNew" style="cursor:pointer"><span class="ico" style="background:#5856D6"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" stroke-linecap="round"/></svg></span><span>Nouvelle recette</span><span class="chev">›</span></div>
    </div>
    <div class="sec"><span>Compte</span></div>
    <div id="acBody"></div>
    <div class="sec" style="justify-content:center;text-transform:none"><span>Cookie Do 3.6 · <button type="button" id="pcOpen2">crédits photos</button></span></div>`;
  $('#acClose').onclick=closeSheet;
  $('#segTheme').querySelectorAll('button').forEach(b=>b.onclick=()=>{ settings.theme=b.dataset.v; saveSettings(); $('#segTheme').querySelectorAll('button').forEach(x=>x.classList.toggle('on',x===b)); });
  const tg=(id,key,after)=>{ const t=$('#'+id); t.onclick=()=>{ settings[key]=!settings[key]; saveSettings(); t.classList.toggle('on',settings[key]); t.setAttribute('aria-checked',settings[key]); if(after)after(); }; };
  tg('togBig','bigText'); tg('togNz','nz',()=>{renderShop();}); tg('togHide','hidePantry',()=>{renderShop();});
  const pers=d=>{ settings.persons=Math.min(8,Math.max(1,(settings.persons||2)+d)); saveSettings(); $('#persVal').textContent=settings.persons; renderRecipes(); renderWeek(); };
  $('#persMinus').onclick=()=>pers(-1); $('#persPlus').onclick=()=>pers(1);
  $('#rowNew').onclick=()=>openRecipeForm(null);
  $('#pcOpen2').onclick=openPhotoCredits;
  const body=$('#acBody');
  if(!Sync.enabled){ body.innerHTML=`<div class="grp" style="margin:0 16px"><div class="rw"><span class="sh-sub" style="padding:0">La sauvegarde en ligne n’est pas configurée. Tes données restent sur cet appareil.</span></div></div>`; }
  else if(Sync.session){ renderAccountLoggedIn(); }
  else { renderAuthForm('signin'); }
}
function syncStatusLabel(){
  if(!Sync.session) return 'Non connecté';
  switch(Sync.status){
    case 'syncing': return 'Synchronisation…';
    case 'err': return 'Erreur de synchro';
    case 'on': return 'Sauvegardé et synchronisé';
    default: return 'Prêt';
  }
}
function renderAccountLoggedIn(){
  const u=Sync.user,body=$('#acBody'); if(!body||!u) return;
  const err = Sync.status==='err' && Sync.lastError;
  body.innerHTML=`<div class="grp" style="margin:0 16px">
      <div class="rw"><span class="ico" style="background:#5856D6">${(u.email||'?')[0].toUpperCase()}</span><div class="b"><div class="t" style="font-weight:500">${u.email}</div><div class="m" id="syncMsg">${syncStatusLabel()}</div></div></div>
      ${err?`<div class="rw"><div class="msg err" style="margin:0;width:100%"><b>La synchro a échoué.</b><br>${escapeHtml(Sync.lastError)}${diagHint(Sync.lastError,Sync.lastStatus)}</div></div>`:''}
      ${err?'<div class="rw" id="retrySync" style="color:var(--accT);font-weight:600;cursor:pointer">Réessayer</div>':''}
      <div class="rw" id="exportData" style="color:var(--accT);cursor:pointer"><span>Exporter mes données</span><span class="chev">›</span></div>
      <div class="rw" id="signOut" style="color:var(--red);cursor:pointer">Se déconnecter</div>
    </div>
    <div class="sh-sub" style="padding-top:8px">Tout se synchronise automatiquement. En te déconnectant, tes données sont retirées de cet appareil mais restent en ligne.</div>`;
  const rs=$('#retrySync'); if(rs) rs.onclick=async()=>{ rs.textContent='…'; await autoSync(true); renderAccountLoggedIn(); };
  $('#signOut').onclick=()=>doSignOut();
  const ex=$('#exportData'); if(ex) ex.onclick=()=>{ const blob=new Blob([JSON.stringify(snapshot(),null,1)],{type:'application/json'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='cookiedo-sauvegarde.json'; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),2000); toast('Sauvegarde téléchargée'); };
}
async function doSignOut(){
  // best-effort final push so nothing unsynced is lost, then wipe device + sign out
  try{ if(Sync.status!=='err') await Sync.push(snapshot()); }catch(e){}
  Sync.signOut();
  wipeLocalData();
  closeSheet(); toast('Déconnecté, appareil vidé'); updateSyncDot();
}
function wipeLocalData(){
  // reset in-memory state
  customRecipes=[]; selection=new Set(); history=[]; shopChecked=new Set(); cookState={}; pantry=[]; favorites=new Set(); ratings={}; prices={}; removedShopItems=new Set(); acquiredItems={}; freeItems=[]; notes={};
  // clear all app keys from this device
  ['mm_custom','mm_selection','mm_shopChecked','mm_history','mm_cookState','mm_fridge','mm_pantry','mm_favorites','mm_ratings','mm_acquired','mm_session','mm_serverUpdated','mm_prices','mm_removedShop','mm_freeShop','mm_notes'].forEach(k=>{ try{localStorage.removeItem(k);}catch(e){} });
  rebuild();
}
function escapeHtml(s){ return String(s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }
function diagHint(e,status){
  e=String(e||'').toLowerCase();
  if(/schema cache|pgrst205|could not find the table/.test(e))
    return '<br><br>La table vient peut-être d&rsquo;être créée : Supabase met parfois ~1 min à la voir. Va dans <b>Settings → API → Reload schema</b> (ou attends une minute) puis touche <b>Réessayer</b>.';
  if(/relation .*does not exist|42p01/.test(e))
    return '<br><br>La table <b>app_state</b> est introuvable dans ce projet. Vérifie que tu as lancé le script SQL sur <b>ce</b> projet, puis touche Réessayer.';
  if(/row-level security|rls|42501|permission denied/.test(e))
    return '<br><br>Les règles de sécurité bloquent l&rsquo;écriture. Relance le script <b>supabase_schema.sql</b> en entier (il crée les règles), puis Réessayer.';
  if(/jwt|token|401|invalid/.test(e))
    return '<br><br>Session expirée. Déconnecte-toi et reconnecte-toi.';
  if(status===0)
    return '<br><br>Le serveur n&rsquo;a pas répondu (connexion internet ou adresse Supabase). Vérifie ta connexion.';
  return '';
}
function renderAuthForm(mode){
  const body=$('#acBody'); if(!body) return;
  body.innerHTML=`<div class="sh-body">
    <div class="seg" style="margin:0 0 12px;display:inline-flex"><button type="button" data-m="signin" class="${mode==='signin'?'on':''}">Se connecter</button><button type="button" data-m="signup" class="${mode==='signup'?'on':''}">Créer un compte</button></div>
    <div class="sh-sub" style="padding:0 0 10px">Un compte sert à retrouver tes recettes, ton stock et ta semaine sur un autre téléphone.</div>
    <div id="authMsg"></div>
    <div class="frow"><label>E-mail</label><input id="authEmail" type="email" autocomplete="email" inputmode="email" placeholder="ton@email.com"></div>
    <div class="frow"><label>Mot de passe</label><input id="authPass" type="password" autocomplete="${mode==='signup'?'new-password':'current-password'}" placeholder="••••••••"></div>
    <div class="stack" style="padding:0"><button class="btn pri wide" id="authGo">${mode==='signin'?'Se connecter':'Créer le compte'}</button>
    ${mode==='signin'?'<button class="btn wide" id="authForgot">Mot de passe oublié</button>':''}</div></div>`;
  body.querySelectorAll('.seg button').forEach(b=>b.onclick=()=>renderAuthForm(b.dataset.m));
  $('#authGo').onclick=()=>doAuth(mode);
  const f=$('#authForgot'); if(f)f.onclick=doForgot;
  $('#authPass').addEventListener('keydown',e=>{if(e.key==='Enter')doAuth(mode);});
}
function authMsg(type,text){ $('#authMsg').innerHTML=`<div class="msg ${type}">${text}</div>`; }
async function doAuth(mode){
  const email=$('#authEmail').value.trim(),pass=$('#authPass').value;
  if(!email||!pass){authMsg('err','Renseigne ton e-mail et ton mot de passe.');return;}
  $('#authGo').disabled=true; $('#authGo').textContent='…';
  try{
    if(mode==='signup'){
      const r=await Sync.signUp(email,pass);
      if(r.confirmed){ await afterLogin(); toast('Compte créé'); }
      else { authMsg('ok','Compte créé ! Vérifie ta boîte mail pour confirmer, puis connecte-toi.'); $('#authGo').disabled=false; $('#authGo').textContent='Créer le compte'; }
    } else { await Sync.signIn(email,pass); await afterLogin(); toast('Connecté'); }
  }catch(err){ authMsg('err',err.message||'Une erreur est survenue.'); $('#authGo').disabled=false; $('#authGo').textContent=mode==='signin'?'Se connecter':'Créer le compte'; }
}
async function doForgot(){
  const email=$('#authEmail').value.trim(); if(!email){authMsg('err','Entre ton e-mail d&rsquo;abord.');return;}
  try{ await Sync.resetPassword(email); authMsg('ok','E-mail de réinitialisation envoyé.'); }catch(e){ authMsg('err','Envoi impossible.'); }
}
/* one full automatic sync: pull remote, merge, push local. Retries once on schema-cache lag. */
let autoSyncing=false;
async function autoSync(isRetry){
  if(!Sync.enabled || !Sync.session || autoSyncing) return;
  autoSyncing=true; updateSyncDot();
  try{
    const remote=await Sync.pull();
    if(remote){
      const localHist=history.slice();
      applySnapshot(remote);
      const seen=new Set(history.map(h=>h.id+'|'+h.date));
      localHist.forEach(h=>{ if(!seen.has(h.id+'|'+h.date)){history.push(h);seen.add(h.id+'|'+h.date);} });
      save(LS.history,history); renderHistory();
      await Sync.push(snapshot());
    } else {
      await Sync.push(snapshot());
    }
    // schema-cache lag: table exists but PostgREST hasn't reloaded -> auto-retry once after a short wait
    if(Sync.status==='err' && !isRetry && /schema cache|pgrst205|could not find the table/i.test(Sync.lastError||'')){
      autoSyncing=false;
      await new Promise(r=>setTimeout(r,4000));
      return autoSync(true);
    }
  }finally{
    autoSyncing=false; updateSyncDot();
    if($('#sheetBg').classList.contains('open') && Sync.session && $('#acBody')) renderAccountLoggedIn();
  }
}
async function afterLogin(){
  updateSyncDot();
  await autoSync();
  if($('#acBody')) renderAccountLoggedIn();
}

/* ---------- NAV ---------- */
let currentView='recipes';
function switchView(v){
  currentView=v;
  $$('.view').forEach(el=>el.classList.remove('active'));
  $('#view-'+v).classList.add('active');
  $$('.tab').forEach(t=>t.classList.toggle('active',t.dataset.view===v));
  window.scrollTo({top:0});
  document.body.classList.remove('scrolled');
  if(v==='shop')renderShop(); if(v==='week')renderWeek(); if(v==='fridge')renderFridge();
}
$$('.tab').forEach(t=>t.onclick=()=>{ if(currentView===t.dataset.view) window.scrollTo({top:0,behavior:'smooth'}); else switchView(t.dataset.view); });
window.addEventListener('scroll',()=>{ document.body.classList.toggle('scrolled',window.scrollY>40); },{passive:true});
$('#accountBtn').onclick=openAccountSheet;
$('#weekRandomBtn').onclick=randomWeek;
$('#clearSelBtn').onclick=()=>{ if(!selection.size) return; if(!confirm('Retirer toutes les recettes de la semaine ?')) return; selection.clear();save(LS.selection,[]);shopChecked.clear();save(LS.shopChecked,[]);clearAcquired();touch();refreshSelUI();renderRecipes();renderFridge();renderShop();renderWeek();};
$('#cookClose').onclick=closeCook;
$('#search').oninput=e=>{searchTerm=e.target.value.trim();$('#searchClr').classList.toggle('hide',!searchTerm);renderRecipes();};
$('#searchClr').onclick=()=>{ $('#search').value=''; searchTerm=''; $('#searchClr').classList.add('hide'); renderRecipes(); };
$('#openFilters').onclick=openFilterSheet;
$('#resetFind').onclick=()=>{ $('#search').value=''; searchTerm=''; $('#searchClr').classList.add('hide'); quickToggle('all'); };
function shoppingListText(){
  const map=buildShopping(); const acq=acquiredSet(); let out='🛒 Ma liste de courses (Cookie Do)\n';
  aisleOrder().forEach(a=>{const ks=Object.keys(map).filter(k=>map[k].aisle===a&&!acq.has(k)&&!removedShopItems.has(k));if(!ks.length)return;out+='\n'+a+'\n';ks.forEach(k=>{const e=map[k];const q=e.mixed?e.mixed+' ':(e.hasQty?fmtQty(e.qty)+(e.unit?' '+unitLabel(e.unit,e.qty):'')+' ':'');out+='• '+q+e.item+'\n';});});
  return out;
}
$('#shareShop').onclick=async()=>{
  const text=shoppingListText();
  if(navigator.share){ try{ await navigator.share({title:'Ma liste de courses', text}); }catch(e){} }
  else { copy(text); toast('Liste copiée'); }
};
function addFreeItemFromInput(){ const inp=$('#freeItemInput'); const v=(inp.value||'').trim(); if(!v)return;
  if(!freeItems.some(f=>norm(f.name)===norm(v))) freeItems.push({name:v});
  save(LS.freeShop,freeItems); touch(); inp.value=''; renderShop(); toast('Ajouté à la liste'); }
$('#freeItemInput').addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); addFreeItemFromInput(); } });
$('#freeItemInput').addEventListener('blur',()=>{ if($('#freeItemInput').value.trim()) addFreeItemFromInput(); });
$('#shopMore').onclick=()=>{
  const map=buildShopping(),acq=acquiredSet();
  const keys=Object.keys(map).filter(k=>!acq.has(k)&&!removedShopItems.has(k));
  const allChecked=keys.length && keys.every(k=>shopChecked.has(k));
  const sh=$('#sheet');
  sh.innerHTML=`<div class="grab"></div>
    <div class="sh-head"><h3>Courses</h3><button class="sh-x" id="smClose" aria-label="Fermer"><svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12" stroke-linecap="round"/></svg></button></div>
    <div class="grp" style="margin:8px 16px 0">
      <div class="rw" id="smAll" style="cursor:pointer"><span>${allChecked?'Tout décocher':'Tout cocher'}</span></div>
      <div class="rw" id="smUncheck" style="cursor:pointer"><span>Décocher sans ranger</span></div>
      <div class="rw"><span>Masquer ce qui est en stock</span><button class="tog ${settings.hidePantry?'on':''}" id="smHide" role="switch" aria-checked="${!!settings.hidePantry}"></button></div>
      <div class="rw" id="smCopy" style="cursor:pointer"><span>Copier la liste en texte</span></div>
    </div>`;
  openSheet(); $('#smClose').onclick=closeSheet;
  $('#smAll').onclick=()=>{ if(allChecked) keys.forEach(k=>shopChecked.delete(k)); else keys.forEach(k=>shopChecked.add(k)); save(LS.shopChecked,[...shopChecked]); touch(); renderShop(); closeSheet(); };
  $('#smUncheck').onclick=()=>{ keys.forEach(k=>shopChecked.delete(k)); save(LS.shopChecked,[...shopChecked]); touch(); renderShop(); closeSheet(); };
  $('#smHide').onclick=()=>{ settings.hidePantry=!settings.hidePantry; saveSettings(); $('#smHide').classList.toggle('on',settings.hidePantry); renderShop(); };
  $('#smCopy').onclick=()=>{ copy(shoppingListText()); toast('Liste copiée'); closeSheet(); };
};
$('#validateShop').onclick=validateShopping;

/* ---------- SHARED VIEWER ---------- */
function checkSharedView(){
  const h=location.hash;
  if(h.startsWith('#cook=')){ try{ const p=JSON.parse(decodeURIComponent(escape(atob(h.slice(6))))); renderSharedViewer(p); return true; }catch(e){} }
  return false;
}
function renderSharedViewer(p){
  document.body.innerHTML=`<div class="shared">
    <div class="kic" style="font-size:12px;color:var(--mut);font-weight:600;letter-spacing:.04em;text-transform:uppercase">Cookie Do · étapes partagées</div>
    <h1>${p.t}</h1>
    <div class="sub">${p.p} portions</div><div id="sv-steps"></div>
    <div style="margin-top:24px"><a href="${location.href.split('#')[0]}" style="font-weight:600;text-decoration:none">← Ouvrir l’app complète</a></div></div>`;
  document.body.style.paddingBottom='0';
  const cont=document.getElementById('sv-steps');
  p.steps.forEach((s,i)=>{ const div=document.createElement('div'); div.className='step';
    div.innerHTML=`<div class="num">${i+1}</div><div class="step-body"><div class="step-txt">${s}</div></div><div class="cbtn"><div class="chk"><svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5" stroke-linecap="round" stroke-linejoin="round"/></svg></div></div>`;
    div.onclick=()=>{ div.classList.toggle('done'); const on=div.classList.contains('done'); const cb=div.querySelector('.chk'); cb.style.background=on?'var(--ok)':''; cb.style.borderColor=on?'var(--ok)':''; cb.querySelector('svg').style.opacity=on?'1':'0'; };
    cont.appendChild(div);
  });
}

/* ---------- INIT ---------- */
async function init(){
  // Sans compte, tout reste sur l'appareil (semaine, stock, courses) : on ne repart
  // plus à zéro à chaque ouverture. Le compte sert à synchroniser entre appareils.
  applyTheme(); rebuild(); updateSyncDot();
  if(Sync.enabled && Sync.session){
    try{ await Sync.refreshIfNeeded(); await autoSync(); }catch(e){}
  }
}
if(!checkSharedView()) init();

