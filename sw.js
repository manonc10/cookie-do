/* Cookie Do hors ligne : le site, ses scripts et les photos déjà vues restent disponibles sans réseau.
   Page (index.html) : réseau d'abord, pour recevoir les mises à jour ; cache si pas de réseau.
   Fichiers versionnés (?v=N) et photos : cache d'abord, ils ne changent pas sous un même nom. */
const CACHE='cookiedo-v11';
const SHELL=['./','index.html','css/app.css?v=26','js/data.js?v=26','js/app.js?v=26','js/plus.js?v=26','js/foyer.js?v=26','js/v4.js?v=26','manifest.webmanifest','favicon.png','apple-touch-icon.png'];
self.addEventListener('install',e=>{ e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting())); });
self.addEventListener('activate',e=>{ e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())); });
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(e.request.method!=='GET'||u.origin!==location.origin) return; // Supabase et le reste : pas touché
  const immutable=u.pathname.includes('/photos')||u.searchParams.has('v');
  if(immutable){
    e.respondWith(caches.match(e.request).then(hit=>hit||fetch(e.request).then(r=>{ if(r.ok){ const cp=r.clone(); caches.open(CACHE).then(c=>c.put(e.request,cp)); } return r; })));
    return;
  }
  e.respondWith(fetch(e.request).then(r=>{ if(r.ok){ const cp=r.clone(); caches.open(CACHE).then(c=>c.put(e.request,cp)); } return r; })
    .catch(()=>caches.match(e.request,{ignoreSearch:true}).then(hit=>hit||caches.match('index.html'))));
});
