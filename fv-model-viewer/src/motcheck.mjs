// 技の姿勢の確かめ（VF2 の motcheck.mjs と同じ）: 写しの i960 の RAM から「コマのデータを読む」（0x2aa84）と「関節の行列を作る」（0x17160）を動かし、
// できた 16 個の関節の行列を、写しに残っているゲームの値と比べる。  node motcheck.mjs [写しのフォルダ…]（無ければ disc/states の全部）
import fs from "fs"; import vm from "vm"; import path from "path";
const here=path.dirname(new URL(import.meta.url).pathname), ctx={console}; vm.createContext(ctx);
for(const f of ["arcade.js","ee.js","motion.js"]) vm.runInContext(fs.readFileSync(path.join(here,f),"utf8"),ctx);
const g=n=>vm.runInContext(n,ctx), bin=f=>new Uint8Array(fs.readFileSync(path.join(here,"disc/bin",f)));
const prog=bin("ROM_CODE1.dec"), rom={data:bin("ROM_DATA.dec"),ep1:bin("ROM_EP1.dec"),ep2:bin("ROM_EP2.dec")};
const fl=u=>new Float32Array(new Uint32Array([u]).buffer)[0];
const sd=path.join(here,"disc/states"), dirs=process.argv.length>2?process.argv.slice(2):fs.readdirSync(sd).filter(f=>fs.statSync(path.join(sd,f)).isDirectory()).sort().map(f=>path.join(sd,f));
for(const d of dirs){ const buf=fs.readFileSync(path.join(d,"eeMemory.bin"));
  for(const pl of [0,1]){ const E=g("motEngine")(prog,buf,rom), before=E.units(pl), inf=E.info(pl), b=E.unitBase(pl);
    for(let i=0;i<0x400;i+=4) E.ee.w32(b+i,0);
    let err=""; try{ E.run(pl,process.env.SEQ?process.env.SEQ.split(",").map(x=>parseInt(x,16)):[0x2aa84,0x17160],inf.motion) }catch(e){ err=" 止まった "+e.message }
    const after=E.units(pl), bad=[];
    for(let j=0;j<16;j++){ let mr=0,mp=0; for(let i=0;i<12;i++){ const x=Math.abs(after[j][i]-before[j][i]); if(i<9) mr=Math.max(mr,x); else mp=Math.max(mp,x) } if(mr>0.01||mp>0.01) bad.push(`${j}:${mr.toFixed(3)}/${mp.toFixed(3)}`) }
    console.log(`${path.basename(d)} ${pl?"2P":"1P"} 技 ${inf.motion} コマ ${inf.frame}/${inf.length} 表 ${E.motionLength(inf.motion)}  合う関節 ${16-bad.length}/16 ${bad.join(" ")}${err} 読めない ${JSON.stringify(E.miss)}`) } }
