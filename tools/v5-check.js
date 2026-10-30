#!/usr/bin/env node
/* Contrôle des recettes réécrites (recettes/v5/*.json) : node tools/v5-check.js [fichier...] */
const fs=require('fs'),vm=require('vm'),path=require('path');
const root=path.join(__dirname,'..');
const c={console};c.window=c;vm.createContext(c);
vm.runInContext(fs.readFileSync(path.join(root,'js/data.js'),'utf8').replace(/^(const|let) /gm,'var '),c);
const seed=Object.fromEntries((c.RECIPES_ORIGIN||c.RECIPES_SEED).map(r=>[r.id,r]));
const n=s=>String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[’']/g,' ');
const files=process.argv.slice(2).length?process.argv.slice(2):fs.readdirSync(path.join(root,'recettes/v5')).filter(f=>f.endsWith('.json')).map(f=>path.join(root,'recettes/v5',f));
const STARCH=[[/\b(riz)\b/,40],[/\b(semoule|couscous|quinoa|boulgour|polenta)\b/,40],[/\b(pates|spaghettis?|penne|tagliatelles?|linguines?|orzo|macaronis?|fusillis?|coquillettes|nouilles|vermicelles|rigatoni|conchiglie)\b/,70]];
const DIFF=['Facile','Moyen','Difficile'],COST=['Bon marché','Moyen','Assez cher'];
let errs=0,warns=0,count=0;const seen=new Set;
const E=(id,m)=>{errs++;console.log('ERREUR '+id+' : '+m)};const W=(id,m)=>{warns++;console.log('avis   '+id+' : '+m)};
for(const f of files){const arr=JSON.parse(fs.readFileSync(f,'utf8'));
 for(const p of arr){count++;const o=seed[p.id];const id=p.id;
  if(!o){E(id,'id inconnu');continue} if(seen.has(id))E(id,'en double');seen.add(id);
  for(const k of ['portions','prep','cook','rest','difficulty','cost','tools','ingredients','steps','stepMeta'])if(p[k]==null)E(id,'champ manquant '+k);
  if(p.steps==null||p.stepMeta==null||p.ingredients==null)continue;
  if(!DIFF.includes(p.difficulty))E(id,'difficulty');if(!COST.includes(p.cost))E(id,'cost');
  if(!Array.isArray(p.tools)||!p.tools.length)E(id,'tools vide');
  if(p.steps.length!==p.stepMeta.length)E(id,'steps et stepMeta de longueurs differentes');
  const ni=p.ingredients.length;const used=new Set;
  p.ingredients.forEach((i,x)=>{if(!Array.isArray(i)||i.length!==4)E(id,'ingredient '+x+' mal forme');else if(i[0]==null&&!/sel|poivre/.test(n(i[2]))&&!i[1])E(id,'ingredient sans quantite : '+i[2])});
  const isMain=!(o.dessert||o.tags.includes('dessert')||o.tags.includes('sauce'));
  if(isMain&&id!=='minestrone')for(const i of p.ingredients){const it=n(i[2]);if(i[1]!=='g'||/farine|fecule|lait de riz|vinaigre|feuilles de riz|galettes de riz|sauce|papier/.test(it))continue;for(const [re,v] of STARCH)if(re.test(it)&&!(v===40&&/nouilles|vermicelles/.test(it))){const per=i[0]/p.portions;if(Math.abs(per-v)>0.5)E(id,`${i[2]} = ${per} g par portion, attendu ${v}`)}}
  p.steps.forEach((s,x)=>{const m=p.stepMeta[x]||{};
   if(typeof s!=='string')return E(id,'etape '+x+' pas une chaine');
   if(s.length>170)W(id,`etape ${x+1} longue (${s.length})`);
   if(/\s[—–-]\s/.test(s)||/—/.test(s))E(id,`tiret de ponctuation, etape ${x+1}`);
   for(const t of s.matchAll(/\{([^}]*)\}/g)){const v=t[1];if(/^=/.test(v)){if(!/^=\d+(?:[,.]\d+)?\s(g|kg|ml|cl|L|l|c\. à soupe|c\. à café)$/.test(v))E(id,`jeton libre invalide {${v}}`)}else{const a=v.match(/^(\d+)(?::([\d.]+))?$/);if(!a||+a[1]>=ni)E(id,`jeton invalide {${v}}`);else{used.add(+a[1]);const ing=p.ingredients[+a[1]];if(!ing[1]||ing[0]==null)E(id,`{${v}} vise un ingredient sans unite (${ing[2]}) : ecrire le nom sans chiffre`)}}}
   const bare=s.replace(/\{[^}]*\}/g,'');
   if(/\d\s?(g|kg|ml|cl|l|L|c\. à (soupe|café))(?![\p{L}])/u.test(bare))E(id,`quantite en dur, etape ${x+1} : ${s}`);
   if(/\b\d+\s+(oignons?|gousses?|carottes?|œufs?|oeufs?|tomates?|courgettes?|pommes? de terre|filets?|cuisses?|blancs?|poivrons?|boîtes?|cubes?|tranches?|citrons?|échalotes?|aubergines?|brocolis?|poireaux?|avocats?|steaks?)\b/i.test(bare))E(id,`piece en chiffre, etape ${x+1} : ${s}`);
   if(/(?<![\p{L}\p{M}'’])(tu|ton|ta|tes|ajoute|mets|verse|coupe|sers|arrête|laisse|cuis|garde|compte)(?![\p{L}\p{M}])/iu.test(bare))E(id,`tutoiement ou imperatif, etape ${x+1} : ${s}`);
   for(const k of ['mark','why'])if(m[k]&&/—|\s–\s|\s-\s/.test(m[k]))E(id,`tiret dans ${k}, etape ${x+1}`);
   
   if(m.timer!=null&&(!Number.isInteger(m.timer)||m.timer<=0))E(id,'timer invalide etape '+(x+1));
   if(!Array.isArray(m.ing))E(id,'ing manquant etape '+(x+1));else m.ing.forEach(a=>{if(a>=ni||a<0)E(id,'ing hors liste etape '+(x+1));used.add(a)});
  });
  p.ingredients.forEach((i,x)=>{if(!used.has(x))E(id,'ingredient jamais utilise dans stepMeta.ing : '+i[2])});
  const st=n(p.steps.join(' '));const ing=n(p.ingredients.map(i=>i[2]).join(';'));
  const need=[[/\bhuile\b/,/\bhuile\b/,'huile'],[/\b(beurre|beurrer)\b/,/\bbeurre\b/,'beurre'],[/\b(sel|saler|salee?s?)\b/,/\bsel\b/,'sel'],[/\b(poivre|poivrer)\b/,/\bpoivre\b/,'poivre']];
  for(const [a,b,w] of need)if(a.test(st)&&!b.test(ing))E(id,w+' cite dans les etapes, absent de la liste');
  const j=p.steps.join(' ');
  if(/enfourner|au four|préchauff/i.test(j)&&!/\d+\s*°/.test(j))E(id,'four sans temperature');
  if(/\bmoule\b/i.test(j)&&!/\d+\s*cm/.test(j))W(id,'moule sans taille');
  if(p.advance&&p.rest===0&&!/veille/i.test(p.advance))W(id,'advance sans rest');
  if(p.rest>=60&&!p.advance)E(id,'rest long sans advance');
  if((p.time??(p.prep+p.cook+p.rest))!==p.prep+p.cook+p.rest)E(id,'time different de prep+cook+rest');
  const keep=['title','tags','pairs','yield','added','dessert'];for(const k of keep)if(p[k]!==undefined&&JSON.stringify(p[k])!==JSON.stringify(o[k]))E(id,'ne pas modifier '+k);
 }}
console.log(`${count} recettes lues, ${errs} erreurs, ${warns} avis`);process.exit(errs?1:0);
