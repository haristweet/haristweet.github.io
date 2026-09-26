// ページで顔に寄って撮る（教訓1）。アーケードのテクスチャ・なめらかの入り切りで4枚（ONLY=1 でなめらかありの2枚）。
//   node faceview.mjs 写しの名前 [0|1]   ROT＝頭の周りの横の回転（ラジアン）。out/aki_face_a{1,0}s{1,0}.png
import {chromium} from "/opt/node22/lib/node_modules/playwright/index.mjs";
import fs from "fs"; import path from "path";
const here=path.dirname(new URL(import.meta.url).pathname), st=process.argv[2]||"01_akira_lau", pl=+(process.argv[3]||0);
const b=await chromium.launch({args:["--use-gl=swiftshader","--enable-webgl","--ignore-gpu-blocklist"]});
const p=await b.newPage({viewport:{width:1100,height:900}}); const errs=[]; p.on("pageerror",e=>errs.push(e.message));
await p.goto("file://"+path.join(here,"../index.html"));
await p.setInputFiles("#f-state",[path.join(here,"disc/states",st+".p2s")]); await p.setInputFiles("#f-disc",path.join(here,"disc/vf2.bin"));
await p.waitForFunction(()=>document.getElementById("info").textContent.length>0,null,{timeout:180000});
await p.setInputFiles("#f-arc",path.join(here,"disc/arcade/vf2.zip")); await p.waitForFunction(()=>!document.getElementById("c-arc").disabled,null,{timeout:180000}); await p.waitForTimeout(1500);
const hd=await p.evaluate(pl=>{ const S=APP.scene, c=[];
  for(const d of S.sc.draws){ if(d.player!==pl) continue; const e=S.models[pl]&&S.models[pl].get(d.id); if(!e) continue; const m=d.m; let n=0,s=[0,0,0];
    for(const q of objPolys(e.ch[3],e.ch[pl],e.ch[2])) if((q.h>>18&31)===31&&(q.attr[1]>>8)) for(const v of q.v){ n++; s[0]+=v[0]*m[0]+v[1]*m[3]+v[2]*m[6]+m[9]; s[1]+=v[0]*m[1]+v[1]*m[4]+v[2]*m[7]+m[10]; s[2]+=v[0]*m[2]+v[1]*m[5]+v[2]*m[8]+m[11] }
    if(n) c.push({id:d.id,n,c:s.map(x=>x/n)}) }
  const top=Math.max(...c.map(h=>h.c[1])); return c.filter(h=>h.c[1]>top-0.07).sort((a,b)=>b.n-a.n)[0] },pl);
console.log("頭",hd.id);
await p.evaluate(pl=>{ for(const [id,v] of [["c-p1",pl===0],["c-p2",pl===1],["c-stage",false],["c-shadow",false]]){ const e=document.getElementById(id); e.checked=v; e.dispatchEvent(new Event("change")) } },pl);
const rot=+(process.env.ROT||0);
for(const [arc,smooth] of (process.env.ONLY?[[1,1],[0,1]]:[[1,1],[1,0],[0,1],[0,0]])){
  await p.evaluate(([c,arc,smooth,rot])=>{ document.getElementById("c-arc").checked=!!arc; document.getElementById("c-smooth").checked=!!smooth; window.center=()=>c; APP.pan=[-c[0],-c[1]]; APP.zoom=c[2]*(+(window.ZM||3)); APP.rot=[rot,0]; draw() },[hd.c,arc,smooth,rot]);
  await p.waitForTimeout(200); await p.locator("#cv").screenshot({path:`out/aki_face_a${arc}s${smooth}.png`}) }
console.log("エラー",errs); await b.close();
