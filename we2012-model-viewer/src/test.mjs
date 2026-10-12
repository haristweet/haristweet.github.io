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
  t(`#1600 の 1 つ目の形 三角形 ${m.tris.length}・包み ${m.packets.length}`,m.tris.length===337&&m.packets.length===7);
  t(`weMeshes: 1 つ目だけ ${r.meshes.length}・全部 ${r2.meshes.length}、絵 ${r.texs[0].W}×${r.texs[0].H}`,r.meshes.length===1&&r2.meshes.length===2&&r.texs[0].W===128&&r.meshes[0].f.length===337*15);
  // 向き: 画面では顔が手前（+Z）。鼻（いちばん手前）は左右の真ん中あたり
  const f=r.meshes[0].f; let zi=2; for(let k=2;k<f.length;k+=5) if(f[k]>f[zi]) zi=k;
  const xs=[]; for(let k=0;k<f.length;k+=5) xs.push(f[k]); const cx=(Math.max(...xs)+Math.min(...xs))/2, w=Math.max(...xs)-Math.min(...xs);
  t(`いちばん手前の点が左右の真ん中（ずれ ${(f[zi-2]-cx).toFixed(0)}／幅 ${w}）`,Math.abs(f[zi-2]-cx)<w*0.1) }
console.log(ok,"件 ok",ng?ng+" 件 NG":""); if(ng) process.exit(1);
