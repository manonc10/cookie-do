/* Importer une recette depuis un lien : lit la page côté serveur (le navigateur n'y a pas droit)
   et rend titre, portions, temps, ingrédients et étapes. Données schema.org d'abord, Marmiton en repli. */
const PRIVATE=/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|\[|.*\.local$|.*\.internal$)/i;
const MAX=3*1024*1024;
const json=(o,status=200)=>new Response(JSON.stringify(o),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const decode=s=>String(s||'').replace(/&nbsp;/g,' ').replace(/&#0?39;|&apos;/g,"'").replace(/&quot;/g,'"').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').replace(/&#(\d+);/g,(m,n)=>String.fromCodePoint(+n));
const text=s=>decode(String(s||'').replace(/<[^>]+>/g,' ')).replace(/\s+/g,' ').trim();
function minutes(d){ const m=String(d||'').match(/^P(?:\d+D)?T?(?:(\d+)H)?(?:(\d+)M)?/); return m?(+m[1]||0)*60+(+m[2]||0):0; }
function findRecipe(n){
  if(!n||typeof n!=='object') return null;
  if(Array.isArray(n)){ for(const x of n){ const r=findRecipe(x); if(r) return r; } return null; }
  const t=n['@type']; if(t==='Recipe'||(Array.isArray(t)&&t.includes('Recipe'))) return n;
  return findRecipe(n['@graph']);
}
function stepsOf(i){
  if(!i) return [];
  if(typeof i==='string') return i.split(/\n+/).map(text).filter(Boolean);
  if(Array.isArray(i)) return i.flatMap(stepsOf);
  if(i.itemListElement) return stepsOf(i.itemListElement);
  return i.text?[text(i.text)]:[];
}
export function parseRecipe(html){
  for(const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)){
    let j; try{ j=JSON.parse(m[1]); }catch{ continue; }
    const r=findRecipe(j); if(!r) continue;
    const ingredients=(r.recipeIngredient||[]).map(text).filter(Boolean), steps=stepsOf(r.recipeInstructions);
    if(ingredients.length||steps.length){
      const y=String(Array.isArray(r.recipeYield)?r.recipeYield[0]:r.recipeYield||'').match(/\d+/);
      return {title:text(r.name).replace(/\s*:\s*la (vraie|meilleure) .*$/i,''),portions:y?+y[0]:4,time:minutes(r.totalTime)||minutes(r.prepTime)+minutes(r.cookTime),ingredients,steps};
    }
  }
  /* Marmiton : les étapes sont dans la page, les ingrédients dans ses cartes */
  const steps=[...html.matchAll(/class="recipe-step__title"[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/g)].map(m=>text(m[1])).filter(Boolean);
  const ingredients=[...html.matchAll(/class="card-ingredient-content"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/g)].map(m=>text(m[1])).filter(Boolean);
  if(!steps.length) return null;
  const title=text((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)||[])[1]).replace(/\s*:\s*la (vraie|meilleure) .*$/i,'');
  const p=html.match(/recipe-ingredients__servings-input[^>]*value="(\d+)"/);
  return {title,portions:p?+p[1]:4,time:0,ingredients,steps};
}
export default async req=>{
  const raw=new URL(req.url).searchParams.get('url')||'';
  let u; try{ u=new URL(raw); }catch{ return json({error:'Ce lien n’est pas valide.'},400); }
  if(!/^https?:$/.test(u.protocol)||PRIVATE.test(u.hostname)) return json({error:'Ce lien n’est pas valide.'},400);
  let res;
  try{ res=await fetch(u,{redirect:'follow',signal:AbortSignal.timeout(8000),headers:{'user-agent':'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1','accept-language':'fr'}}); }
  catch{ return json({error:'Ce site ne répond pas.'},502); }
  if(!res.ok) return json({error:'Ce site refuse de donner la page.'},502);
  const html=(await res.text()).slice(0,MAX);
  const r=parseRecipe(html);
  return r?json(r):json({error:'Aucune recette trouvée sur cette page.'},422);
};
