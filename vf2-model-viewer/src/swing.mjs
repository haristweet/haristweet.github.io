// 揺れもの（髪・ひも・布）がどの関節にぶら下がるかを、写しから決める（motion.js の MOT_SWING を作る）。node swing.mjs
// 同じ部品が 2 つ以上の写しにあれば、関節ごとに「部品の位置を関節の座標で見た値」の写しどうしのずれを比べ、いちばん動かない関節を親とする（揺れものの根元は親に固定）。
// ずれ 0.06 未満を根元、その後ろ 3 つ以内の番号の部品は根元と同じ親（鎖の先は揺れるので、ずれだけでは決まらない）。どれでもないものは motion.js の決め方（胸か頭）
import fs from "fs"; import vm from "vm"; import path from "path";
const here=path.dirname(new URL(import.meta.url).pathname), ctx={console}; vm.createContext(ctx);
for(const f of ["arcade.js","ee.js","motion.js","scene.js"]) vm.runInContext(fs.readFileSync(path.join(here,f),"utf8"),ctx);
const g=n=>vm.runInContext(n,ctx), prog=new Uint8Array(fs.readFileSync(path.join(here,"disc/bin/IC12_15.dec"))), mul=g("motMul"), inv=g("motInv"), invG=g("motInvG");
const rec={};   // id → [{st,rel:[16 個の位置]}]
for(const st of fs.readdirSync(path.join(here,"disc/states")).filter(f=>!f.endsWith(".p2s")).sort()){
  const mem=fs.readFileSync(path.join(here,"disc/states",st,"eeMemory.bin")), sc=g("sceneRead")(mem);
  for(const pl of [0,1]){ const E=g("motEngine")(prog,mem,null), att=g("motAttach")(sc,pl,[E.units(pl)],E.parts(pl)), U=E.units(pl);
    for(const p of att.parts) if(!p.body&&!p.mirror){ const d=sc.draws[p.i], W=mul(d.m,invG(att.V)); (rec[d.id]=rec[d.id]||[]).push({st:st+"/"+pl,rel:U.map(u=>mul(W,inv(u)).slice(9))}) } } }
const out={};
for(const [id,L] of Object.entries(rec)){ if(L.length<2) { out[id]=null; continue }
  const sp=[...Array(16)].map((_,k)=>{ let m=0; for(let a=0;a<L.length;a++) for(let b=a+1;b<L.length;b++) m=Math.max(m,Math.hypot(...[0,1,2].map(i=>L[a].rel[k][i]-L[b].rel[k][i]))); return m });
  const best=sp.map((v,k)=>[k,v]).sort((x,y)=>x[1]-y[1]); out[id]=best[0]; console.log(id,"写し",L.length,"関節",best[0][0],"ずれ",best[0][1].toFixed(3),"次",best[1][0],best[1][1].toFixed(3)) }
const ids=Object.keys(out).map(Number).filter(i=>out[i]).sort((a,b)=>a-b), tbl={};
for(const i of ids){ const [k,v]=out[i]; if(v<0.06) tbl[i]=k }
for(const i of ids){ if(tbl[i]!==undefined) continue; for(let j=i-1;j>=i-3;j--) if(tbl[j]!==undefined&&out[j][1]<0.06){ tbl[i]=tbl[j]; break } }
console.log("const MOT_SWING={"+Object.entries(tbl).map(([a,b])=>a+":"+b).join(",")+"};");
console.log("1 つの写しだけ",Object.entries(out).filter(([k,v])=>!v).map(([k])=>k).join(","));
