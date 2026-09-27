// ソフトウェア描画の写しの GS のメモリから、ゲームが描いた画面を取り出す（VF2 の zsort.mjs と同じ読み方）。
//   node gsframe.mjs disc/states/grace1P_picky1P_round1 out/gs.png   → FBP 0 と 0x80 の2枚を横に並べる
// GS.bin: 頭 0x1a9 バイトの後ろに GS のメモリ 4MB。画面は PSMCT32・幅 512（FBW=8）
import fs from "fs"; import path from "path"; import {pngEncode} from "./png.mjs";
const [,,dir,outp="out/gs.png"]=process.argv;
const B32=[[0,1,4,5,16,17,20,21],[2,3,6,7,18,19,22,23],[8,9,12,13,24,25,28,29],[10,11,14,15,26,27,30,31]];
const C32=[[0,1,4,5,8,9,12,13],[2,3,6,7,10,11,14,15],[16,17,20,21,24,25,28,29],[18,19,22,23,26,27,30,31],[32,33,36,37,40,41,44,45],[34,35,38,39,42,43,46,47],[48,49,52,53,56,57,60,61],[50,51,54,55,58,59,62,63]];
const a32=(bp,x,y)=>((bp+((y>>5)*8+(x>>6))*32+B32[(y>>3)&3][(x>>3)&7])*64+C32[y&7][x&7]);
const gsb=fs.readFileSync(path.join(dir,"GS.bin")), gsu=new Uint32Array(gsb.buffer.slice(gsb.byteOffset+0x1a9,gsb.byteOffset+0x1a9+(4<<20)));
const W=512,H=448, out=new Uint8Array(W*2*H*3);
[0,0x80*32].forEach((bp,k)=>{ for(let y=0;y<H;y++) for(let x=0;x<W;x++){ const v=gsu[a32(bp,x,y)], o=(y*W*2+k*W+x)*3; out[o]=v&255; out[o+1]=v>>8&255; out[o+2]=v>>16&255 } });
fs.mkdirSync(path.dirname(outp),{recursive:true}); fs.writeFileSync(outp,pngEncode(W*2,H,out)); console.log(outp);
