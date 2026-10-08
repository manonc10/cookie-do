/* Cookie Do hors ligne : le site, ses scripts et les photos déjà vues restent disponibles sans réseau.
   Pages et scripts : réseau d'abord (pour recevoir les mises à jour), cache si pas de réseau.
   Photos : cache d'abord. */
const CACHE='cookiedo-v2';
const SHELL=['./','index.html','css/app.css','js/qrcode.js','js/data.js','js/app.js','js/plus.js','js/foyer.js','manifest.webmanifest','favicon.png','apple-touch-icon.png'];
self.addEventListener('install',e=>{ e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting())); });
self.addEventListener('activate',e=>{ e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())); });
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(e.request.method!=='GET'||u.origin!==location.origin) return; // Supabase et le reste : pas touché
  if(u.pathname.includes('/photos/')){
    e.respondWith(caches.match(e.request).then(hit=>hit||fetch(e.request).then(r=>{ if(r.ok){ const cp=r.clone(); caches.open(CACHE).then(c=>c.put(e.request,cp)); } return r; })));
    return;
  }
  e.respondWith(fetch(e.request).then(r=>{ if(r.ok){ const cp=r.clone(); caches.open(CACHE).then(c=>c.put(e.request,cp)); } return r; })
    .catch(()=>caches.match(e.request,{ignoreSearch:true}).then(hit=>hit||caches.match('index.html'))));
});
