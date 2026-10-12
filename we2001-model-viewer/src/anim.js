// ANIME.BIN（動き）と MODEL.BIN（部品の組）を読んで、選手の部品を置く。
// 読み方は本体（SLPM_868.35）の 0x80011444（選手を描く関数）から。
//  - ANIME.BIN は 0x8017ee80 に読まれる。先頭は動きの番号→「コマの番地の並び」への番地の表（0x80026c74 が引く）
//  - 1 コマ＝部品ごとに 8 バイト（2 語 w,v）。部品は MODEL.BIN の組の並び（0 番が頭）と同じ順
//      回転 x,y,z＝w の 0-9・10-19・20-29 ビット（符号付き 10 ビット）×16（4096＝1 周）
//      位置 x＝v の 0-10 ビット（符号付き 11 ビット）
//           y＝(w の 30 ビット)×4096＋(v の 11-15 ビット)×32＋(v の 16-20 ビット)、w の 31 ビットが立てば負
//           z＝v の 21-31 ビット（符号付き 11 ビット）
//  - 部品ごとの行列は RotMatrix（0x8003c560）＋位置で、選手全体の行列に掛ける（親子はたどらない）。
//    掛ける順は Rz·Ry·Rx（x を先に回す）。全コマで「ももから見たすねの付け根」がいちばんぶれない順を 48 通りから選んだ（数字。2 番目の約半分のぶれ）
//  - MODEL.BIN は 0x8016ab80 に読まれる。先頭 18 個の番地が「組」（型と番地の並び。0xff で終わり）
//      型 0x80＝頭（0x68 からの 64 個の表から選ぶ）、2＝部品、0＝無し
const WE_MODEL_BASE=0x8016ab80, WE_ANIME_BASE=0x8017ee80;
function weU32(u8,o){ return (u8[o]|u8[o+1]<<8|u8[o+2]<<16|u8[o+3]<<24)>>>0 }
function weSext(v,b){ return v&(1<<(b-1))?v-(1<<b):v }
// 組 k の並び → [{type, off（MODEL.BIN の中の位置）}]
function weModelSet(model,k){
  const out=[]; let o=weU32(model,k*4)-WE_MODEL_BASE;
  for(;;){ const t=weU32(model,o), p=weU32(model,o+4); if(t===0xff) break; out.push({type:t,off:p?p-WE_MODEL_BASE:-1}); o+=8 }
  return out;
}
// 頭の表（0x80 の型が指す）。番号 i の頭の TMD の位置
function weHeadOff(model,listOff,i){ return weU32(model,listOff+i*4)-WE_MODEL_BASE }
// 動き a のコマ f の番地（ANIME.BIN の中の位置）
function weAnimFrame(anime,a,f){ const e=weU32(anime,a*4)-WE_ANIME_BASE; return weU32(anime,e+f*4)-WE_ANIME_BASE }
// コマの数（並びの番地が ANIME.BIN の中を指している間を数える。推測：終わりの印は見ていない）
function weAnimFrames(anime,a){
  const e=weU32(anime,a*4)-WE_ANIME_BASE; let n=0;
  for(;;){ const p=weU32(anime,e+n*4); if(p<WE_ANIME_BASE||p>=WE_ANIME_BASE+anime.length||((p-WE_ANIME_BASE)&3)) break; n++; if(n>2000) break }
  return n;
}
function weDecodePart(anime,o){
  const w=weU32(anime,o), v=weU32(anime,o+4);
  const rot=[weSext(w&1023,10)*16, weSext(w>>>10&1023,10)*16, weSext(w>>>20&1023,10)*16];
  let y=((w>>>30)&1)*4096+((v>>>11)&31)*32+((v>>>16)&31); if(w>>>31) y=-y;
  return {rot, t:[weSext(v&2047,11), y, weSext(v>>>21,11)]};
}
// RotMatrix（PsyQ）: Rz·Ry·Rx。角度は 4096＝1 周
function weRotMatrix([x,y,z]){
  const a=k=>k*Math.PI*2/4096, sx=Math.sin(a(x)), cx=Math.cos(a(x)), sy=Math.sin(a(y)), cy=Math.cos(a(y)), sz=Math.sin(a(z)), cz=Math.cos(a(z));
  return [[cz*cy,cz*sy*sx-sz*cx,cz*sy*cx+sz*sx],[sz*cy,sz*sy*sx+cz*cx,sz*sy*cx-cz*sx],[-sy,cy*sx,cy*cx]];
}
function weXform(m,t,p){ return [0,1,2].map(i=>m[i][0]*p[0]+m[i][1]*p[1]+m[i][2]*p[2]+t[i]) }
// 選手 1 人を組む。set＝MODEL.BIN の組の番号、head＝頭の番号、anim/frame＝動き（frameOff を渡すと anime の中のその位置のコマを直接読む）。
// 返すのは [{part:番号, off, m, t}]（m,t は体の基準からの行列と位置）
function wePose(model,anime,set,head,anim,frame,frameOff){
  const list=weModelSet(model,set), fo=frameOff??weAnimFrame(anime,anim,frame), out=[];
  list.forEach((e,k)=>{
    let off=e.off; if(e.type===0x80) off=weHeadOff(model,e.off,head); else if(e.type!==2) return;
    const {rot,t}=weDecodePart(anime,fo+k*8);
    out.push({part:k,off,m:weRotMatrix(rot),t,rot});
  });
  return out;
}
