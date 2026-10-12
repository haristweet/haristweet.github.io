// 顔・髪の部品ごとの絵（JWE2010）。ゲームが描くときの指定（GS の TEX0）をステートセーブの描く命令の並びから読んで決めた（v0.2.0）
//   顔: sel 0＝顔のファイルの絵、sel 1・3・4（目・耳・口の中）＝共通の絵 #8234、sel 2（あごの重ね）＝透明（描かない）
//   髪: sel 1（前髪）＝髪のファイルの絵、sel 2（後ろ髪）＝共通の髪の地 #8226（512×256）、sel 0（生え際の帯）＝頭の肌 #8231
// #8226・#8234 の点は PS2 の画面用メモリの並べ替え（PSMCT32 で書いて PSMT8 で読む形）のまましまってある。戻すと画面用メモリと一致
const JW_COMMON={parts:8234,partsPal:8227,back:8226,ring:8231};
const JW_BT=[[0,1,4,5,16,17,20,21],[2,3,6,7,18,19,22,23],[8,9,12,13,24,25,28,29],[10,11,14,15,26,27,30,31]];
const JW_CT32=[[0,1,4,5,8,9,12,13],[2,3,6,7,10,11,14,15],[16,17,20,21,24,25,28,29],[18,19,22,23,26,27,30,31],[32,33,36,37,40,41,44,45],[34,35,38,39,42,43,46,47],[48,49,52,53,56,57,60,61],[50,51,54,55,58,59,62,63]];
const JW_CT8=[[0,4,16,20,32,36,48,52,2,6,18,22,34,38,50,54],[8,12,24,28,40,44,56,60,10,14,26,30,42,46,58,62],[33,37,1,5,49,53,17,21,35,39,3,7,51,55,19,23],[41,45,9,13,57,61,25,29,43,47,11,15,59,63,27,31],[96,100,112,116,64,68,80,84,98,102,114,118,66,70,82,86],[104,108,120,124,72,76,88,92,106,110,122,126,74,78,90,94],[65,69,81,85,97,101,113,117,67,71,83,87,99,103,115,119],[73,77,89,93,105,109,121,125,75,79,91,95,107,111,123,127],[128,132,144,148,160,164,176,180,130,134,146,150,162,166,178,182],[136,140,152,156,168,172,184,188,138,142,154,158,170,174,186,190],[161,165,129,133,177,181,145,149,163,167,131,135,179,183,147,151],[169,173,137,141,185,189,153,157,171,175,139,143,187,191,155,159],[224,228,240,244,192,196,208,212,226,230,242,246,194,198,210,214],[232,236,248,252,200,204,216,220,234,238,250,254,202,206,218,222],[193,197,209,213,225,229,241,245,195,199,211,215,227,231,243,247],[201,205,217,221,233,237,249,253,203,207,219,223,235,239,251,255]];
// 8 ビットの絵 w×h（w は 128 の倍数）を、PSMCT32（w/2×h/2、幅 w/128 ページ）で書いた並びから戻す
function jwUnswizzle8(src,w,h){
  const mem=new Uint8Array(src.length), bw32=w/128, out=new Uint8Array(w*h), W=w/2, H=h/2;
  for(let y=0;y<H;y++) for(let x=0;x<W;x++){ const a=((x>>6)+(y>>5)*bw32)*8192+JW_BT[(y&31)>>3][(x&63)>>3]*256+JW_CT32[y&7][x&7]*4, i=(y*W+x)*4;
    mem[a]=src[i]; mem[a+1]=src[i+1]; mem[a+2]=src[i+2]; mem[a+3]=src[i+3] }
  const bw8=w/64;
  for(let y=0;y<h;y++) for(let x=0;x<w;x++) out[y*w+x]=mem[((x>>7)+(y>>6)*(bw8>>1))*8192+JW_BT[(y&63)>>4][(x&127)>>4]*256+JW_CT8[y&15][x&15]];
  return out;
}
// ファイルの中の絵の頭（0x29857294）を全部: {at,W,H,pix,pal}（pal は色表の位置が無ければ null）
function jwTexHeads(u){
  const dv=new DataView(u.buffer,u.byteOffset,u.byteLength), out=[];
  for(let o=0;o+32<=u.length;o+=16){ if(dv.getUint32(o,true)!==0x29857294) continue;
    const a=dv.getUint32(o+16,true), wh=dv.getUint32(o+20,true), W=wh&0xffff, H=wh>>>16, po=a&0xffff, pa=a>>>16;
    out.push({at:o,W,H,pix:po&&o+po+W*H<=u.length?u.subarray(o+po,o+po+W*H):null,pal:pa&&o+pa+1024<=u.length?u.subarray(o+pa,o+pa+1024):null}) }
  return out;
}
// 8 ビットの点と色表（PS2 の並べ替え、α 0x80＝不透明）から RGBA
function jwRGBA(pix,pal){
  const out=new Uint8Array(pix.length*4);
  for(let i=0;i<pix.length;i++){ const v=pix[i], j=((v&0xe7)|((v&0x10)>>1)|((v&0x08)<<1))*4;
    out[i*4]=pal[j]; out[i*4+1]=pal[j+1]; out[i*4+2]=pal[j+2]; out[i*4+3]=Math.min(255,pal[j+3]*2) }
  return out;
}
// 共通の絵 3 枚を作る。色表の選び方は 3 人のセーブ（田村・関口・永井。どれも同じ）に合わせた【その 3 人で確認・ほかは推測】
//   目・耳・口: #8227 の 4 つ目の色表、ただし 192〜255 番（目のあたり）は 8・14・6 つ目から（画面用メモリの色表と同じ並び）
//   髪の地: #8226 の 2 つ目の色表の α に、0〜95 番の色を黒（3 人とも黒だった）。生え際の帯: #8231 の 256×128 と 9 つ目の色表
function jwCommonTextures(f){
  const parts=jwTexHeads(f.parts)[0], pp=jwTexHeads(f.partsPal).map(t=>t.pal).filter(Boolean);
  const pal=new Uint8Array(pp[3]), seg=[...Array(10).fill(7),...Array(5).fill(13),5,...Array(8).fill(7),...Array(40).fill(5)];
  seg.forEach((k,i)=>pal.set(pp[k].subarray((192+i)*4,(192+i)*4+4),(192+i)*4));
  const bt=jwTexHeads(f.back), back=bt[0], bp=new Uint8Array(bt.map(t=>t.pal).filter(Boolean)[1]);
  for(let j=0;j<96;j++){ bp[j*4]=0; bp[j*4+1]=0; bp[j*4+2]=0 }
  const rt=jwTexHeads(f.ring), ring=rt.find(t=>t.W===256&&t.H===128), rp=rt.map(t=>t.pal).filter(Boolean)[8];
  return {
    parts:{W:256,H:128,rgba:jwRGBA(jwUnswizzle8(parts.pix,256,128),pal)},
    back:{W:512,H:256,rgba:jwRGBA(jwUnswizzle8(back.pix,512,256),bp)},
    ring:{W:256,H:128,rgba:jwRGBA(ring.pix,rp)} };
}
// 顔＋髪の形を、部品ごとの絵で（weMeshes を sel ごとに分けて呼び、絵を差し替える）
function jwHeadMeshes(faceU,hairU,common,all){
  const ms=[], sub=(u,keep)=>weMeshes(u,all,[0,1,2,3,4].filter(s=>!keep.includes(s)));
  const put=(r,tex)=>{ for(const m of r.meshes){ if(tex) m.tex=tex; if(m.f.length) ms.push(m) } return r };
  const face=put(sub(faceU,[0]),null);
  if(common) put(sub(faceU,[1,3,4]),common.parts);
  let hair=null;
  if(hairU){ if(common){ put(sub(hairU,[2]),common.back); put(sub(hairU,[0]),common.ring) } hair=put(sub(hairU,[1]),null) }
  return {meshes:ms,faceTexs:face.texs,hairTexs:hair?hair.texs:[]};
}
