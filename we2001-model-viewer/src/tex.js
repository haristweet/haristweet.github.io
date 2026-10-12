// テクスチャ（TEX_xx.BIN など）を読んで VRAM（1024×512、16 ビット）に置く。読み方は本体から。
//  - TEX_xx は 0x800f0000 に読まれる。先頭は「絵の札」への番地の並び（0 は無し）
//  - 札: +0 型（9＝そのまま、10＝圧縮、0＝無し）、+2 x、+4 y、+6 幅（16 ビット単位）、+8 高さ、+12 中身の番地（0x8001c8d8）
//  - 圧縮は 0x8001cae8（下の weUnlz）
const WE_TEX_BASE=0x800f0000;
function weUnlz(s,p){
  const out=[]; let f=0;
  for(;;){
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
// TEX_xx: 先頭の番地の並び（0 は飛ばす）が札を 1 枚ずつ指す
function weTexLoad(vram,u8,base){
  const u32=o=>(u8[o]|u8[o+1]<<8|u8[o+2]<<16|u8[o+3]<<24)>>>0, put=[];
  for(let i=0;;i++){
    const p=u32(i*4); if(p===0) continue; if(p<0x80000000||p>=0x80200000) break;
    const o=p-base; if(o<0||o+16>u8.length) break;
    weTexPut(vram,u8,base,o,put,i);
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
