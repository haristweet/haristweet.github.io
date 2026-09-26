// 技の姿勢の確かめ: セーブステートの i960 の RAM から始めて、アーケードのプログラムの「コマのデータを読む」（0x27ce0 → 0x28184）と
// 「関節の行列を作る」（0x16504）を i960 のエミュレーター（arcade.js）で動かし、TGP（コプロ）の計算は PS2 本体の代わりの関数（cpr*）を
// EE のエミュレーター（ee.js）でそのまま動かす。できた 16 個の関節の行列（g_UnitMtxRob0/1Buf）を、写しに残っているゲームの値と比べる。
//   node motcheck.mjs [写しのフォルダ…]   （無ければ disc/states の全部）
//   WIPE=b00-c4c で、比べる前にキャラの構造体のその範囲を消す（動きのデータから計算し直していることの確かめ）
import fs from "fs"; import vm from "vm"; import path from "path";
const here=path.dirname(new URL(import.meta.url).pathname), ctx={console}; vm.createContext(ctx);
for(const f of ["arcade.js","ee.js"]) vm.runInContext(fs.readFileSync(path.join(here,f),"utf8"),ctx);
const g=n=>vm.runInContext(n,ctx);
const files={}; for(const f of fs.readdirSync(path.join(here,"disc/arcade"))) if(!f.endsWith(".zip")&&!f.endsWith(".bin")) files[f]=new Uint8Array(fs.readFileSync(path.join(here,"disc/arcade",f)));
const rom=g("arcRom")(files);
const half=k=>{ const c=rom.chips[k>>21][k&1], j=(k>>1)&0xfffff; return c[2*j]|c[2*j+1]<<8 };
const md=o=>o<0x1000000?(half(o>>1)>>(8*(o&1)))&255:0;
// コプロの関数の表（PS2 0x207a50。16B ずつ: 関数・引数の語数・返すバイト数）の語数
const GP=0x25da70, TBL=0x207a50;
const fl=u=>{ const b=Buffer.alloc(4); b.writeUInt32LE(u>>>0); return b.readFloatLE() };

export function motionRun(eeBuf, pl, seq=[0x27ce0,0x16504], wipe=null){
  const ee=new (g("EE"))(new Uint8Array(eeBuf)), WB=0x1069240;
  const ram=ee.m.subarray(WB+0x500000,WB+0x600000), ram2=ee.m.subarray(0x1469240+0x200000,0x1469240+0x240000);
  const argb=ee.r32(GP-0x7d90), outb=ee.r32(GP-0x7d9c), cr=ee.r32(GP-0x7d8c);
  const cop={cur:null,out:[]};
  const copCall=(fn,args)=>{ const f=ee.r32(TBL+fn*16), nr=ee.r32(TBL+fn*16+8)>>2; args.forEach((v,k)=>ee.w32(argb+4*k,v)); ee.call(f); for(let k=0;k<nr;k++) cop.out.push(ee.r32(outb+4*k)) };
  // FIFO（i960 の 0x880000〜）: 命令の語（下位8bit が関数の番号）→ 引数 → 答えを読む
  const copW=v=>{ if(!cop.cur) cop.cur={fn:v&0xff,args:[]}; else cop.cur.args.push(v); const c=cop.cur; if(c.args.length>=ee.r32(TBL+c.fn*16+4)){ cop.cur=null; copCall(c.fn,c.args) } };
  const copR=()=>cop.out.length?cop.out.shift():0;
  const r8=A=>{ A>>>=0;
    if(A<0x80000) return rom.prog[A];
    if(A>=0x500000&&A<0x600000) return ram[A-0x500000];
    if(A>=0x200000&&A<0x240000) return ram2[A-0x200000];
    if(A>=0x2000000&&A<0x4000000) return md(A-0x2000000);
    return 0 };
  const isF=A=>A>=0x880000&&A<0x890000, isC=A=>A>=0x900000&&A<0x910000;   // TGP の FIFO・TGP のデータ RAM（PS2 では [gp-0x7d8c]）
  const mem={ r8,
    r16(A){ A>>>=0; if(isF(A)) return copR()&0xffff; if(isC(A)) return ee.r16(cr+A-0x900000); return r8(A)|r8(A+1)<<8 },
    r32(A){ A>>>=0; if(isF(A)) return copR(); if(isC(A)) return ee.r32(cr+A-0x900000); return (r8(A)|r8(A+1)<<8|r8(A+2)<<16|r8(A+3)<<24)>>>0 },
    w8(A,v){ A>>>=0; if(A>=0x500000&&A<0x600000) ram[A-0x500000]=v; else if(A>=0x200000&&A<0x240000) ram2[A-0x200000]=v },
    w16(A,v){ this.w8(A,v&255); this.w8(A+1,v>>>8&255) },
    w32(A,v){ A>>>=0; if(isF(A)) return copW(v>>>0); if(isC(A)) return ee.w32(cr+A-0x900000,v); for(let k=0;k<4;k++) this.w8(A+k,(v>>>(8*k))&255) } };
  const cpu=new (g("I960"))({readUInt32LE:a=>(rom.prog[a]|rom.prog[a+1]<<8|rom.prog[a+2]<<16|rom.prog[a+3]<<24)>>>0}, mem);
  const g7=mem.r32(pl?0x500808:0x500804);
  if(wipe) for(let o=wipe[0];o<wipe[1];o++) mem.w8(g7+o,0x55);
  // 関節の行列の置き場（cprMtxStUnitMat: 引数0 が 1 なら [gp-0x7db0]、それ以外は [gp-0x7dac]。1語目は [g7+4] の bit0）
  const ub=ee.r32(GP-((mem.r8(g7+4)&1)?0x7db0:0x7dac)), before=[]; for(let i=0;i<0x400;i+=4){ before.push(ee.r32(ub+i)); ee.w32(ub+i,0) }
  for(const a of seq){ const R=cpu.r; R[1]=R[31]=0x5f8000; R[23]=g7; R[27]=0x880000; R[28]=0x4000; cpu.run(a) }
  const after=[]; for(let i=0;i<0x400;i+=4) after.push(ee.r32(ub+i));
  return {g7, motion:mem.r16(g7+0x1a8), frame:mem.r16(g7+0x1aa), before, after, steps:cpu.steps, eeSteps:ee.steps};
}
// 関節ごとの向きの差（3×3 の最大）と位置の差（長さ）
export function unitDiff(r){ const out=[]; for(let j=0;j<16;j++){ let mr=0,mp=0; for(let i=0;i<15;i++){ if(i%4===3) continue; const d=Math.abs(fl(r.after[j*16+i])-fl(r.before[j*16+i])); if(i<12) mr=Math.max(mr,d); else mp=Math.max(mp,d) } out.push({rot:mr,pos:mp}) } return out }

if(import.meta.url===`file://${process.argv[1]}`){
  const sd=path.join(here,"disc/states"), dirs=process.argv.length>2?process.argv.slice(2):fs.readdirSync(sd).filter(f=>fs.statSync(path.join(sd,f)).isDirectory()).sort().map(f=>path.join(sd,f));
  const wipe=process.env.WIPE?process.env.WIPE.split("-").map(x=>parseInt(x,16)):null;
  for(const d of dirs){ const buf=fs.readFileSync(path.join(d,"eeMemory.bin"));
    for(const pl of [0,1]){ const r=motionRun(buf,pl,undefined,wipe), df=unitDiff(r);
      const bad=df.map((e,j)=>e.rot>0.01||e.pos>0.01?`${j}:${e.rot.toFixed(3)}/${e.pos.toFixed(3)}`:null).filter(Boolean);
      console.log(`${path.basename(d)} ${pl?"2P":"1P"} 技 ${r.motion} コマ ${r.frame}  合う関節 ${16-bad.length}/16 ${bad.length?"合わない（関節:向き/位置）"+bad.join(" "):""}`) } }
}
