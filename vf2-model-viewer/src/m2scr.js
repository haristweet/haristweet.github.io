// MODEL2 の2Dの面（空・遠景）。アーケードのタイル（セガ System 24 と同じ作り）を PS2 版は g_m2Scr に写して持っている。
// 本体の sysScrWL（i960 の番地 → g_m2Scr）と m2esiUpdateCellmap・m2esiMakeupClutData を読んで決めた並び:
//   +0       タイルの表 4面 × 64×64 × 16bit（0x1000000〜）。値: bit0-13 タイル番号、bit7-14 パレット（bit15 で +0x100）
//   +0x8000  1行ごとの横のずらし（0x1008000〜）
//   +0x9000  ずらしの設定 8語（0x100a000〜）
//   +0xa810  タイルの絵 512KB（0x1080000〜）。8×8 画素・4bit。PS2 の並びに直してある（下位の4bit が左）
//   +0x8a810 パレット 0x1000 色（16bit: R bit0-4・G 5-9・B 10-14、bit15 が 0 なら半分の明るさ）。色 0 は透明
const M2SCR=0x12cd770;
function scrRead(mem){
  const b=mem.subarray(M2SCR,M2SCR+0x8c870), dv=new DataView(b.buffer,b.byteOffset,b.byteLength), w=o=>dv.getUint16(o,true);
  const ramp=[0,1,2].map(c=>Array.from(b.subarray(0x8c810+c*32,0x8c810+c*32+32)));
  const pal=new Uint8Array(0x1000*4);
  for(let i=0;i<0x1000;i++){ const c=w(0x8a810+i*2), h=c&0x8000?0:1;
    pal[i*4]=ramp[0][c&31]>>h; pal[i*4+1]=ramp[1][c>>5&31]>>h; pal[i*4+2]=ramp[2][c>>10&31]>>h; pal[i*4+3]=(i&15)?255:0 }
  const regs=[]; for(let i=0;i<8;i++) regs.push(w(0x9000+i*2));
  return {b,w,pal,regs,ramp};
}
// 1面を 512×512 の RGBA に（ずらしは付けない）
function scrLayer(s,layer){
  const out=new Uint8Array(512*512*4);
  for(let ty=0;ty<64;ty++) for(let tx=0;tx<64;tx++){
    const v=s.w(layer*0x2000+(ty*64+tx)*2), tile=v&0x3fff, pal=((v>>7)&0xff)+(v&0x8000?0x100:0);
    for(let y=0;y<8;y++) for(let x=0;x<8;x++){
      const byte=s.b[0xa810+tile*32+y*4+(x>>1)], pen=(x&1)?byte>>4:byte&15, c=(pal*16+pen)&0xfff, o=((ty*8+y)*512+tx*8+x)*4;
      out[o]=s.pal[c*4]; out[o+1]=s.pal[c*4+1]; out[o+2]=s.pal[c*4+2]; out[o+3]=pen?255:0;
    }
  }
  return out;
}
// 奥の2面（2・3）を MODEL2 の画面 496×384 に並べる（m2eScrUpdate→m2esiUpdateScrPos を写した）。
//   横: 語2（bit15 が立てば 1行ごとの表 +0x8800 の値）の下位9bit。画面の x → 絵の u＝(x − 横) mod 512
//   縦: 語6 の下位ビット。bit13 が立てば面2 と面3 を縦につないだ 1024 行、立たなければ 512 行で折り返す。bit15 は消す
// 返すのは RGBA（透明は a=0）
function scrBack(s){
  const out=new Uint8Array(496*384*4), h=s.regs[2], c=s.regs[6];
  if(c&0x8000) return out;
  const L2=scrLayer(s,2), L3=scrLayer(s,3), wrap=c&0x2000?0x3ff:0x1ff;
  for(let y=0;y<384;y++){
    const hh=(h&0x8000?s.w(0x8800+y*2):h)&0x1ff, v=(y+(c&wrap))&wrap, L=v<512?L2:L3;
    for(let x=0;x<496;x++){ const u=(x-hh)&511, i=((v&511)*512+u)*4, o=(y*496+x)*4;
      out[o]=L[i]; out[o+1]=L[i+1]; out[o+2]=L[i+2]; out[o+3]=L[i+3] }
  }
  return out;
}
