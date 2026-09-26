// アーケード（Model 2A）のテクスチャ RAM をロムから作る（i960 のプログラム 0x115c0 の写し方）。ロムは disc/arcade/（リポジトリに入れない）
//   node arcadetex.mjs 写し  … ロムから作ったテクスチャを PS2 の並べ方（writeTex）に直して、写しのテクスチャ（g_geo+0xa040）と比べる
// main_data（i960 の 0x02000000〜）は 2本1組を 16bit ずつ交互に並べたもの（ROM_LOAD32_WORD）。テクスチャ RAM は 16bit の語に 2×2 テクセル
//   （MAME: 語＝(y>>1)*512＋(x>>1)、y 偶数で上位バイト、x 偶数で上位ニブル）。i960 は 0x60000 語をそのまま写す
import fs from "fs"; import vm from "vm"; import path from "path";
const here=path.dirname(new URL(import.meta.url).pathname), A=f=>fs.readFileSync(path.join(here,"disc/arcade",f));
const PAIRS=[["mpr-17560.10","mpr-17561.11"],["mpr-17558.8","mpr-17559.9"],["mpr-17566.6","mpr-17567.7"],["mpr-17564.4","mpr-17565.5"]];
const chips=PAIRS.map(p=>p.map(A));
// main_data の 16bit の語 k（バイト番地／2）
export function mainHalf(k){ const pair=chips[k>>21], j=(k>>1)&0xfffff, c=pair[k&1]; return c[2*j]|c[2*j+1]<<8 }
// テクスチャ RAM 1枚（語の配列）: 番地 src（i960 の番地）から 0x60000 語
export function arcadeSheet(src){ const k0=(src-0x2000000)>>1, s=new Uint16Array(0x100000); for(let h=0;h<0x60000;h++) s[h]=mainHalf(k0+h); return s }
export function arcTexel(s,x,y){ let w=s[((y>>1)*512+(x>>1))&0xfffff]; if(!(y&1)) w>>=8; if(!(x&1)) w>>=4; return w&15 }
if(process.argv[1]===new URL(import.meta.url).pathname){
  const ctx={}; vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(here,"scene.js"),"utf8"),ctx);
  const T=vm.runInContext("sceneColors",ctx)(fs.readFileSync(path.join(process.argv[2],"eeMemory.bin"))).tex;
  const ps2=(pg,x,y)=>{ const b=T[(pg<<18)+y*256+(x>>1)]; return x&1?b>>4:b&15 };
  for(const [name,src] of [["0x2300000",0x2300000],["0x2600000",0x2600000]]){ const s=arcadeSheet(src);
    for(const pg of [0,1]) for(const [y0,y1] of [[0,768],[768,1024]]){ let same=0,n=0; for(let py=y0;py<y1;py++) for(let px=0;px<512;px++){ n++; if(ps2(pg,px,py)===arcTexel(s,py,4*px+3)) same++ }
      console.log("ロム",name,"→ ページ",pg,"行",y0+"〜"+(y1-1),"一致",(100*same/n).toFixed(1)+"%") } }
}

// ---- i960 のプログラムを動かしてテクスチャ RAM を作る ----
import {I960} from "./i960emu.mjs";
export function arcadeLoader(){
  const prog=fs.readFileSync(path.join(here,"disc/bin/IC12_15.dec")), code=Buffer.alloc(0x80000); prog.copy(code);
  const ram=new Uint8Array(0x100000), ram2=new Uint8Array(0x40000), tex=[new Uint16Array(0x80000),new Uint16Array(0x80000)];
  const md=(o)=>o<0x1000000?(mainHalf(o>>1)>>(8*(o&1)))&255:0;
  const r8=A=>{ A>>>=0;
    if(A<0x80000) return code[A];
    if(A>=0x500000&&A<0x600000) return ram[A-0x500000];
    if(A>=0x200000&&A<0x240000) return ram2[A-0x200000];
    if(A>=0x2000000&&A<0x4000000) return md(A-0x2000000);
    if(A>=0x6000000&&A<0x7000000) return md(A-0x6000000+0x1000000);
    if(A>=0xf00000&&A<0xf00010) return 0xff;   // タイマー: いつも「まだ時間がある」（0xb6c・0x4cb64 などが時間切れで処理を譲らないように）
    return 0 };
  const mem={ r8, r16:A=>r8(A)|r8(A+1)<<8, r32:A=>(r8(A)|r8(A+1)<<8|r8(A+2)<<16|r8(A+3)<<24)>>>0,
    w8(A,v){ A>>>=0; if(A>=0x500000&&A<0x600000) ram[A-0x500000]=v; else if(A>=0x200000&&A<0x240000) ram2[A-0x200000]=v },
    w16(A,v){ A>>>=0; if(A>=0x12000000&&A<0x12800000){ tex[(A>>>22)&1][((A&0x1fffff)>>>2)&0x7ffff]=v&0xffff; return } this.w8(A,v&255); this.w8(A+1,v>>>8&255) },
    w32(A,v){ A>>>=0; if(A>=0x12000000&&A<0x12800000){ tex[(A>>>22)&1][((A&0x1fffff)>>>2)&0x7ffff]=v&0xffff; return } for(let k=0;k<4;k++) this.w8(A+k,(v>>>(8*k))&255) } };
  const cpu=new I960(code,mem);
  // テクスチャのセット s を読み込む（0x4bd60〜0x4bf64 の流れを JS で。要求の旗 r7 は 0）
  function loadSet(s, log){
    const R=cpu.r, r32=mem.r32;
    let r10=r32(r32(0x230000c)+s*4); const first=r32(r10); r10+=4;
    let r9=r32(r32(0x2300008)+first*4); const n=r32(r9); r9+=4;
    for(let e=0;e<n;e++){
      const g2=r32(r9), g0=(g2<<16)>>>17;
      // 処理を譲る旗は下ろし、持ち時間（0x4c10c が入れる値）を入れておく
      R[1]=R[31]=0x5f0000; mem.w32(0x550080,0); mem.w32(0x5500f4,0); mem.w8(0x500000,0); mem.w8(0x50008c,0); mem.w32(0x55c2f4,0); mem.w32(0x550004,0x12a8); mem.w32(0x550008,0x4e20);
      R[16+8]=g2&1; R[16+6]=(mem.r16(0x4c120+g0*4)+(g2>>>24))>>>0; R[16+7]=(mem.r16(0x4c122+g0*4)+((g2<<8)>>>24))>>>0;
      if(log) log("  要素",e,"語",g2.toString(16),"位置",R[22],R[23],"面",R[24]);
      cpu.run(0x4d16c);
      let g3=r32(r10); const t=r32(g3); g3+=4; R[16+3]=g3;
      if(log) log("  圧縮",t,"番地",(g3-4).toString(16));
      if(t===0){ R[16+3]=g3; cpu.run(0x4c180); cpu.run(0x4cb64); cpu.run(0x4cd18) } else cpu.run(0x4c9dc);
      r9+=4; r10+=4;
    }
    return n;
  }
  return {cpu,mem,tex,loadSet};
}
