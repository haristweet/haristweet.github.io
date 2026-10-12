// テクスチャ（TEX_xx.BIN など）を読んで VRAM（1024×512、16 ビット）に置く。読み方は本体から。
//  - TEX_xx は 0x800f0000 に読まれる。先頭は「絵の札」への番地の並び（0 は無し）
//  - 札: +0 型（9＝そのまま、10＝圧縮、0＝無し）、+2 x、+4 y、+6 幅（16 ビット単位）、+8 高さ、+12 中身の番地（0x8001c8d8）
//  - 圧縮は 0x8001cae8（下の weUnlz）
const WE_TEX_BASE=0x800f0000;
function weUnlz(s,p){
  const out=[]; let f=0;
  while(p<s.length){
    f>>>=1; if(!(f&0x100)){ f=s[p++]|0xff00 }
    const c=s[p];
    if(!(f&1)){ out.push(c); p++; continue }
    if(!(c&0x80)){ const d=((c&3)<<8)|s[p+1], n=(c>>2)+3; p+=2; for(let i=0;i<n;i++) out.push(out[out.length-d]) }
    else if(!(c&0x40)){ const d=(c&15)+1, n=(c>>4)-6; p++; for(let i=0;i<n;i++) out.push(out[out.length-d]) }
    else { if(c===0xff) break; const n=c-184; p++; for(let i=0;i<n;i++) out.push(s[p++]) }
  }
  return new Uint8Array(out);
}
function weVramNew(){ return new Uint16Array(1024*512) }
// 札を 1 枚 VRAM に置く
function weTexPut(vram,u8,base,o,put,i){
  const u32=o=>(u8[o]|u8[o+1]<<8|u8[o+2]<<16|u8[o+3]<<24)>>>0, u16=o=>u8[o]|u8[o+1]<<8;
  {
    const type=u8[o], x=u16(o+2), y=u16(o+4), w=u16(o+6), h=u16(o+8), d=u32(o+12)-base;
    if(type!==9&&type!==10) return false;
    const px=type===10?weUnlz(u8,d):u8.subarray(d,d+w*h*2);
    for(let yy=0;yy<h;yy++) for(let xx=0;xx<w;xx++){ const k=(yy*w+xx)*2; if(k+1<px.length&&y+yy<512&&x+xx<1024) vram[(y+yy)*1024+x+xx]=px[k]|px[k+1]<<8 }
    put.push({i,type,x,y,w,h,len:px.length,want:w*h*2});
  }
  return true;
}
// TEX_xx: 先頭の番地の並び（0 は飛ばす）が札を 1 枚ずつ指す。only に番号の集合を渡すとそれだけ置く
function weTexLoad(vram,u8,base,only){
  const u32=o=>(u8[o]|u8[o+1]<<8|u8[o+2]<<16|u8[o+3]<<24)>>>0, put=[];
  for(let i=0;;i++){
    const p=u32(i*4); if(p===0) continue; if(p<0x80000000||p>=0x80200000) break;
    const o=p-base; if(o<0||o+16>u8.length) break;
    if(!only||only.has(i)) weTexPut(vram,u8,base,o,put,i);
  }
  return put;
}
// DAT2D.BIN など: 先頭の番地が札の並び（16 バイトずつ続く）を指す。型が 9/10 でなくなったら終わり（推測）
function weTexLoadRun(vram,u8,base,k=0){
  const u32=o=>(u8[o]|u8[o+1]<<8|u8[o+2]<<16|u8[o+3]<<24)>>>0, put=[];
  let o=u32(k*4)-base;
  for(let i=0;o+16<=u8.length;i++,o+=16) if(!weTexPut(vram,u8,base,o,put,i)) break;
  return put;
}
// VRAM から 1 点取る。tsb/cba は TMD の値。色 0 は抜き（null）
function weTexel(vram,tsb,cba,u,v){
  const tx=(tsb&15)*64, ty=(tsb>>4&1)*256, md=tsb>>7&3, cx=(cba&63)*16, cy=cba>>6;
  u&=255; v&=255; let c;
  if(md===0){ const w=vram[(ty+v)*1024+tx+(u>>2)]; c=vram[cy*1024+cx+(w>>((u&3)*4)&15)] }
  else if(md===1){ const w=vram[(ty+v)*1024+tx+(u>>1)]; c=vram[cy*1024+cx+(w>>((u&1)*8)&255)] }
  else c=vram[(ty+v)*1024+tx+u];
  if(!c) return null;
  return [(c&31)<<3,(c>>5&31)<<3,(c>>10&31)<<3];
}
// 背番号を VRAM に組み立てる（本体の 0x8001f204。1P 側）。cell＝欄（0〜9。並びの 2〜11 番目の選手。10＝並びの 1 番目＝キーパーの欄 (626,360)）、num＝背番号
//  欄は (576＋(cell%5)×10, 336＋⌊cell/5⌋×24) の 10×24（16 ビット単位。8 ビットの絵で 20×24 点）。まずシャツの無地 (598,262)（キーパーの欄は (630,262)）を写し、
//  数字の絵 (608＋3×数字, 324) の 3×12 を、1 桁なら欄の (+3,+7)、2 桁なら (+1,+7) と (+5,+7) へ、1 点右にずらして色 0 を抜いて重ねる
function weComposeNumber(vram,cell,num){
  if(num===100) num=0; else if(num>100) num=14;
  const cx=cell===10?626:576+(cell%5)*10, cy=cell===10?360:336+Math.floor(cell/5)*24;
  const bx=cell===10?630:598;
  for(let y=0;y<24;y++) for(let x=0;x<10;x++) vram[(cy+y)*1024+cx+x]=vram[(262+y)*1024+bx+x];
  const glyph=(d,dx)=>{ const sx=608+3*d, tx=cx+dx, ty=cy+7;
    for(let y=0;y<12;y++){ const row=[]; for(let x=0;x<3;x++){ const w=vram[(324+y)*1024+sx+x]; row.push(w&255,w>>8) }
      const dst=[]; for(let x=0;x<4;x++){ const w=vram[(ty+y)*1024+tx+x]; dst.push(w&255,w>>8) }
      for(let i=0;i<6;i++) if(row[i]) dst[i+1]=row[i];
      for(let x=0;x<4;x++) vram[(ty+y)*1024+tx+x]=dst[x*2]|dst[x*2+1]<<8 } };
  if(num<10) glyph(num,3); else { glyph(Math.floor(num/10),1); glyph(num%10,5) }
}
