// 単体試験。node test.mjs（data/ と out/fake.* があれば本物の見本で）
import fs from "fs"; import vm from "vm"; import path from "path";
const here=path.dirname(new URL(import.meta.url).pathname), ctx={console,DecompressionStream,Blob,Response}; vm.createContext(ctx);
for(const f of ["we12.js","wgl.js"]) vm.runInContext(fs.readFileSync(path.join(here,f),"utf8"),ctx);
const g=n=>vm.runInContext(n,ctx); let ok=0, ng=0;
const t=(name,c)=>{ if(c){ ok++; console.log("  ok",name) } else { ng++; console.log("  NG",name) } };
// 帯: 0x8004,0x8008 で始めて 12・16 で三角形 2 つ（向きを交互に）
{ const u=new Uint8Array(64); t("VIF の大きさ（V3-16×16＝96、V2-16×16＝64、V4-16×5＝40）",g("weVifSize")(0x69,16)===96&&g("weVifSize")(0x65,16)===64&&g("weVifSize")(0x6d,5)===40) }
const fa=path.join(here,"out/fake_0_TEXT.AFS"), fi=path.join(here,"out/fake.iso");
if(!fs.existsSync(fa)){ console.log("out/fake_0_TEXT.AFS が無いので本物での試験はしない（node mkfake.mjs で作る）"); console.log(ok,"件 ok",ng?ng+" 件 NG":""); process.exit(ng?1:0) }
for(const [name,f] of [["AFS",fa],["ISO",fi]]){
  const blob=new Blob([fs.readFileSync(f)]), d=await g("weOpen")(blob);
  t(`${name} から開く（${d.from}・${d.ents.length} 個）`,d.from===name&&d.ents.length===10001);
  const u=await g("weFile")(blob,d,1600);
  t(`${name}: #1600 をほどくと見本と同じ`,Buffer.from(u).equals(fs.readFileSync(path.join(here,"data/01600.bin"))));
}
{ const blob=new Blob([fs.readFileSync(fa)]), d=await g("weOpen")(blob), sig={};
  for(const i of [0,200,1600,1601,1602,3600,3601,3602,5200,6403]) sig[i]=g("weSig")(await g("weFile")(blob,d,i));
  t(`並び: 顔 MMT・髪 MTT（${JSON.stringify(sig)}）`,[1600,1601,1602].every(i=>sig[i]==="MMT")&&[3600,3601,3602].every(i=>sig[i]==="MTT")&&![0,200,5200,6403].some(i=>sig[i]==="MMT"||sig[i]==="MTT"));
  const u=await g("weFile")(blob,d,1600), m=g("weModel")(u,0x20), r=g("weMeshes")(u,false), r2=g("weMeshes")(u,true);
  { let pos=0; for(const tr of m.tris){ const [a,b,c]=tr.p, e1=b.map((v,i)=>v-a[i]), e2=c.map((v,i)=>v-a[i]), n=[e1[1]*e2[2]-e1[2]*e2[1],e1[2]*e2[0]-e1[0]*e2[2],e1[0]*e2[1]-e1[1]*e2[0]], s=[0,1,2].map(i=>tr.n[0][i]+tr.n[1][i]+tr.n[2][i]); if(n[0]*s[0]+n[1]*s[1]+n[2]*s[2]>=0) pos++ }
    t(`三角形の向きが頂点の法線と同じ側（${pos}/${m.tris.length}）`,pos===m.tris.length) }
  t(`#1600 の 1 つ目の形 三角形 ${m.tris.length}・包み ${m.packets.length}`,m.tris.length===337&&m.packets.length===7);
  t(`weMeshes: 1 つ目だけ ${r.meshes.length}・全部 ${r2.meshes.length}、絵 ${r.texs[0].W}×${r.texs[0].H}`,r.meshes.length===1&&r2.meshes.length===2&&r.texs[0].W===128&&r.meshes[0].f.length===337*15);
  // 向き: 画面では顔が手前（+Z）。鼻（いちばん手前）は左右の真ん中あたり
  const f=r.meshes[0].f; let zi=2; for(let k=2;k<f.length;k+=5) if(f[k]>f[zi]) zi=k;
  const xs=[]; for(let k=0;k<f.length;k+=5) xs.push(f[k]); const cx=(Math.max(...xs)+Math.min(...xs))/2, w=Math.max(...xs)-Math.min(...xs);
  t(`いちばん手前の点が左右の真ん中（ずれ ${(f[zi-2]-cx).toFixed(0)}／幅 ${w}）`,Math.abs(f[zi-2]-cx)<w*0.1) }
// 見本の全部の形で、包みの数だけ読める（小さい包みの並びは 0x40 番地より前にある。v0.1.4 まで読み落としていた）
{ let n=0,bad=[]; for(const f of fs.readdirSync(path.join(here,"data"))){ const u=new Uint8Array(fs.readFileSync(path.join(here,"data",f))), dv=new DataView(u.buffer);
    for(const p of g("weParts")(u)) if(p.off+4<=u.length&&g("weKind")(u,p.off)==="model"){ const npk=dv.getUint32(p.off+0x20,true), m=g("weModel")(u,p.off); n++; if(m.packets.length!==npk) bad.push(f+":"+m.packets.length+"/"+npk) } }
  t(`形 ${n} 個の包みを全部読める（だめ ${bad.join(" ")||"なし"}）`,!bad.filter(x=>!/^0900/.test(x)).length) }
console.log(ok,"件 ok",ng?ng+" 件 NG":""); if(ng) process.exit(1);
