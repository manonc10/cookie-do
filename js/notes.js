/* Cookie Do : notes (4.11).
   Un bouton Note sur chaque écran : une capture de l'écran, ce qui ne va pas, et le contexte
   (écran, version, réglages, erreurs récentes) partent dans la table Supabase cd_notes.
   Claude les lit à la demande, corrige, et marque la note : lue, corrigée en 4.x, question. */

const NOTES_QUEUE='cd_notesQueue';            // notes pas encore envoyées (hors ligne)
const recentErrors=[];
window.addEventListener('error',e=>{ recentErrors.push((e.message||'erreur')+(e.filename?' @'+e.filename.split('/').pop()+':'+e.lineno:'')); if(recentErrors.length>5) recentErrors.shift(); });
window.addEventListener('unhandledrejection',e=>{ recentErrors.push('promesse : '+String(e.reason&&e.reason.message||e.reason)); if(recentErrors.length>5) recentErrors.shift(); });

const VIEW_NAMES={recipes:'Recettes',week:'Semaine',shop:'Courses',fridge:'Stock'};
function noteScreen(){
  let s=VIEW_NAMES[currentView]||currentView;
  const cook=$('#cookModal').classList.contains('open');
  if(cook) s+=' › mode cuisine ('+($('#cookTitle').textContent||'')+')';
  if($('#sheetBg').classList.contains('open')){ const h=$('#sheet h3, #sheet h2'); s+=' › feuille '+(h?'« '+h.textContent.trim()+' »':'ouverte'); }
  return s;
}
function noteContext(){
  const standalone=matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
  return {
    version:'Cookie Do '+APP_VERSION,
    appareil:navigator.userAgent, installee:standalone,
    ecran:innerWidth+'×'+innerHeight+' @'+devicePixelRatio, defilement:Math.round(scrollY),
    theme:settings.theme, sombre:matchMedia('(prefers-color-scheme: dark)').matches, texteGrand:!!settings.bigText,
    personnes:settings.persons, portions:settings.portionSize, foyer:!!(typeof foyer!=='undefined'&&foyer),
    semaine:[...selection], cochés:shopChecked.size, erreurs:recentErrors.slice()
  };
}

/* capture de ce qui est à l'écran, réduite à 390 px de large */
let h2cLoading=null;
function loadH2C(){ if(window.html2canvas) return Promise.resolve(); if(h2cLoading) return h2cLoading;
  h2cLoading=new Promise((ok,ko)=>{ const s=document.createElement('script'); s.src='js/vendor/html2canvas.min.js'; s.onload=ok; s.onerror=ko; document.head.appendChild(s); });
  return h2cLoading; }
async function captureScreen(){
  try{
    await loadH2C();
    const bg=getComputedStyle(document.body).backgroundColor;
    const c=await html2canvas(document.body,{x:scrollX,y:scrollY,width:innerWidth,height:innerHeight,windowWidth:innerWidth,windowHeight:innerHeight,scale:Math.min(2,devicePixelRatio),backgroundColor:bg,logging:false,useCORS:true,
      ignoreElements:el=>el.id==='toast'||el.id==='sheetBg'||el.id==='timerPop'||(el.classList&&el.classList.contains('view')&&!el.classList.contains('active'))});
    const w=Math.min(390*1.5,c.width), out=document.createElement('canvas'); out.width=w; out.height=Math.round(c.height*w/c.width);
    out.getContext('2d').drawImage(c,0,0,out.width,out.height);
    return out.toDataURL('image/jpeg',0.72);
  }catch(e){ return null; }
}

async function notesApi(path,opts={}){
  await Sync.refreshIfNeeded();
  const h={'apikey':SUPA_KEY,'Authorization':'Bearer '+Sync.session.access_token,'Content-Type':'application/json'};
  if(opts.prefer) h['Prefer']=opts.prefer;
  const r=await fetch(SUPA_URL+path,{method:opts.method||'GET',headers:h,body:opts.body?JSON.stringify(opts.body):undefined});
  const txt=await r.text(); let j=null; try{ j=txt?JSON.parse(txt):null; }catch(e){}
  if(!r.ok) throw new Error((j&&(j.message||j.hint))||('erreur '+r.status));
  return j;
}
/* envoie ce qui attend ; une note qui ne part pas reste dans la file */
async function flushNotes(){
  if(!Sync.enabled||!Sync.session||!navigator.onLine) return;
  const q=load(NOTES_QUEUE,[]); if(!q.length) return;
  const left=[];
  for(const n of q){ try{ await notesApi('/rest/v1/cd_notes',{method:'POST',prefer:'return=minimal',body:n}); }catch(e){ left.push(n); } }
  save(NOTES_QUEUE,left);
}
window.addEventListener('online',flushNotes);
document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='visible') flushNotes(); });

async function openNoteSheet(){
  const screen=noteScreen(), ctx=noteContext();
  let shot=null, shotDone=false;
  const shooting=captureScreen().then(d=>{ shot=d; shotDone=true; const box=$('#ntShot'); if(box) box.innerHTML=d?`<img src="${d}" alt="Capture de l’écran">`:'<span>Pas de capture</span>'; const dr=$('#ntDrop'); if(dr) dr.hidden=!d; });
  const logged=Sync.enabled&&Sync.session;
  const sh=$('#sheet');
  sh.innerHTML=`<div class="grab"></div>
    <div class="sh-head"><h3>Nouvelle note</h3><button class="sh-x" id="ntClose" aria-label="Fermer"><svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12" stroke-linecap="round"/></svg></button></div>
    <div class="sh-sub">Ce qui ne va pas, ou ce que tu voudrais à la place.</div>
    <div class="nt-body">
      <div class="nt-shot" id="ntShot"><span>Capture en cours…</span></div>
      <div class="nt-txt"><label for="ntText">Ta note</label><textarea id="ntText" maxlength="4000" placeholder="Ex. la barre du bas se bloque au milieu quand je fais défiler"></textarea>
        <button type="button" class="nt-link" id="ntDrop" hidden>Retirer la capture</button></div>
    </div>
    <div class="sec"><span>Joint automatiquement</span></div>
    <div class="grp" style="margin:0 16px">
      <div class="rw"><span class="nt-k">Écran</span><span class="nt-v">${escapeHtml(screen)}</span></div>
      <div class="rw"><span class="nt-k">Version</span><span class="nt-v">${escapeHtml(ctx.version)}</span></div>
      <div class="rw"><span class="nt-k">Réglages</span><span class="nt-v">${ctx.texteGrand?'texte plus grand, ':''}thème ${({system:'auto',light:'clair',dark:'sombre'})[ctx.theme]||ctx.theme}${ctx.installee?', app installée':''}</span></div>
      <div class="rw"><span class="nt-k">Erreurs récentes</span><span class="nt-v">${ctx.erreurs.length||'aucune'}</span></div>
    </div>
    <div class="stack"><button class="btn pri wide" id="ntSend" ${logged?'':'disabled'}>Envoyer la note</button></div>
    <div class="sh-sub" style="text-align:center">${logged?'Tu la retrouves dans Réglages, Mes notes, avec ce que j’en ai fait.':'Connecte-toi à ton compte dans Réglages pour envoyer tes notes.'}</div>`;
  openSheet();
  $('#ntClose').onclick=closeSheet;
  let dropped=false;
  $('#ntDrop').onclick=()=>{ dropped=true; $('#ntShot').innerHTML='<span>Pas de capture</span>'; $('#ntDrop').hidden=true; };
  $('#ntSend').onclick=async()=>{
    const text=$('#ntText').value.trim(); if(!text){ $('#ntText').focus(); toast('Écris d’abord ta note'); return; }
    closeSheet();
    if(!shotDone&&!dropped) await Promise.race([shooting,new Promise(r=>setTimeout(r,15000))]);
    const q=load(NOTES_QUEUE,[]); q.push({text,screen,context:ctx,shot:dropped?null:shot,created_at:new Date().toISOString()}); save(NOTES_QUEUE,q);
    await flushNotes();
    toast(load(NOTES_QUEUE,[]).length?'Note gardée, elle partira dès que le réseau revient':'Note envoyée');
  };
}

/* Réglages : Mes notes */
const NOTE_STATUS={new:['Envoyée','run'],seen:['Lue','run'],fixed:['Corrigée','ok'],question:['Question pour toi','ask'],wontfix:['Laissée de côté','run']};
async function openNotesList(){
  const sh=$('#sheet');
  sh.innerHTML=`<div class="grab"></div><div class="sh-head"><h3>Mes notes</h3><button class="sh-x" id="nlClose" aria-label="Fermer"><svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12" stroke-linecap="round"/></svg></button></div><div id="nlBody"><div class="sh-sub">Chargement…</div></div>`;
  openSheet(); $('#nlClose').onclick=closeSheet;
  const wait=load(NOTES_QUEUE,[]);
  let rows=[], err='';
  try{ rows=await notesApi('/rest/v1/cd_notes?select=id,created_at,text,status,fixed_in,reply&order=created_at.desc&limit=60')||[]; }catch(e){ err=e.message; }
  const day=iso=>new Date(iso).toLocaleDateString('fr-FR',{day:'numeric',month:'short'})+' à '+new Date(iso).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});
  const item=(text,tag,cls,sub)=>`<div class="rw nt-row"><div class="b"><div class="t">${escapeHtml(text)}</div><div class="m"><span class="nt-tag ${cls}">${escapeHtml(tag)}</span> ${sub?escapeHtml(sub):''}</div></div></div>`;
  let html='';
  if(wait.length) html+=`<div class="sec"><span>Pas encore envoyées</span></div><div class="grp" style="margin:0 16px">${wait.map(n=>item(n.text,'En attente de réseau','run',day(n.created_at))).join('')}</div>`;
  if(rows.length) html+=`<div class="sec"><span>Envoyées</span></div><div class="grp" style="margin:0 16px">${rows.map(n=>{ const [lbl,cls]=NOTE_STATUS[n.status]||[n.status,'run'];
      return item(n.text,n.status==='fixed'&&n.fixed_in?'Corrigée en '+n.fixed_in:lbl,cls,n.reply||day(n.created_at)); }).join('')}</div>`;
  if(err) html+=`<div class="sh-sub" style="color:var(--red)">Impossible de lire tes notes : ${escapeHtml(err)}</div>`;
  if(!html) html=`<div class="sh-sub">Pas encore de note. Touche le bouton Note en haut d’un écran.</div>`;
  $('#nlBody').innerHTML=html;
}
const _renderSettingsSheetNotes=renderSettingsSheet;
renderSettingsSheet=function(){
  _renderSettingsSheetNotes();
  const sec=[...document.querySelectorAll('#sheet .sec')].find(x=>x.textContent.trim()==='Compte'); if(!sec) return;
  const g=document.createElement('div');
  g.innerHTML=`<div class="sec"><span>Notes</span></div><div class="grp" style="margin:0 16px">
    <div class="rw" id="rowNotes" style="cursor:pointer"><span class="ico" style="background:#2F6FD6"><svg viewBox="0 0 24 24"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" stroke-linejoin="round"/></svg></span><span>Mes notes</span><span class="chev">›</span></div></div>`;
  sec.parentNode.insertBefore(g,sec);
  $('#rowNotes').onclick=openNotesList;
};

/* le bouton Note en haut des quatre écrans */
$$('.view .hdr .acts').forEach(a=>{
  const b=document.createElement('button'); b.className='tbtn ic nt-btn'; b.type='button'; b.setAttribute('aria-label','Écrire une note'); b.title='Note';
  b.innerHTML='<svg viewBox="0 0 24 24"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" stroke-linejoin="round"/><path d="M9 12h6M12 9v6" stroke-linecap="round"/></svg>';
  b.onclick=openNoteSheet; a.insertBefore(b,a.firstChild);
});
flushNotes();
