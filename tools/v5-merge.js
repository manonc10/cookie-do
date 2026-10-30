#!/usr/bin/env node
/* Fusionne recettes/v5/*.json dans RECIPES_SEED de js/data.js. Lancé une seule fois : garde l'ancien tableau dans recettes/v5/origine.json. */
const fs=require('fs'),vm=require('vm'),path=require('path');
const root=path.join(__dirname,'..'),dataP=path.join(root,'js/data.js');
const src=fs.readFileSync(dataP,'utf8');
const c={console};c.window=c;vm.createContext(c);vm.runInContext(src.replace(/^(const|let) /gm,'var '),c);
const orig=c.RECIPES_SEED,dir=path.join(root,'recettes/v5');
const patches={};for(const f of fs.readdirSync(dir).filter(f=>/^(pilote|lot\d+)\.json$/.test(f)))for(const p of JSON.parse(fs.readFileSync(path.join(dir,f),'utf8')))patches[p.id]=p;
const missing=orig.filter(r=>!patches[r.id]).map(r=>r.id);if(missing.length){console.error('manquent :',missing.join(', '));process.exit(1)}
const grams=r=>r.ingredients.reduce((s,i)=>s+(i[1]==='g'?i[0]:i[1]==='kg'?i[0]*1000:0),0)/r.portions;
const prot={...c.PROT};
const out=orig.map(o=>{const p=patches[o.id];const t=p.prep+p.cook+p.rest;
 const tags=(o.tags||[]).filter(x=>x!=='rapide'||t<=30);
 const r={id:o.id,title:o.title,portions:p.portions,time:t,prep:p.prep,cook:p.cook,rest:p.rest};
 if(p.advance)r.advance=p.advance;
 Object.assign(r,{difficulty:p.difficulty,cost:p.cost,tools:p.tools,tags,ingredients:p.ingredients,steps:p.steps,stepMeta:p.stepMeta.map(m=>{const x={...m};if(!x.ing||!x.ing.length)delete x.ing;return x}),tip:p.tip??o.tip});
 const light=p.light??o.light;if(light)r.light=light;
 for(const k of ['dessert','yield','pairs','added'])if(o[k]!==undefined)r[k]=o[k];
 if(prot[o.id]&&!o.dessert){const a=grams(o),b=grams(p);if(a>0&&b>0)prot[o.id]=Math.round(prot[o.id]*Math.min(1,b/a))}
 return r});
fs.writeFileSync(path.join(dir,'origine.json'),JSON.stringify(orig));
let h=src;
const a=h.indexOf('const RECIPES_SEED = [');const b=h.indexOf('\n];',a);if(a<0||b<0)throw new Error('RECIPES_SEED introuvable');
h=h.slice(0,a)+'const RECIPES_SEED = [\n'+out.map(r=>JSON.stringify(r)).join(',\n')+h.slice(b);
h=h.replace(/const PROT=\{.*?\};?\n/,'const PROT='+JSON.stringify(prot)+';\n');
const t=dataP+'.tmp';fs.writeFileSync(t,h);fs.renameSync(t,dataP);
console.log(out.length,'recettes fusionnees,',out.filter(r=>r.advance).length,'avec À prévoir, rapide retire de',orig.filter((o,i)=>o.tags.includes('rapide')&&!out[i].tags.includes('rapide')).length);
