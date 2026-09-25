// セーブステートの1コマを、ゲームが描いたとおりに組んで描く（教訓3: ゲーム自身の値を使う）。
//   node pose.mjs disc/states/01_akira_lau out/pose01.png
// 主メモリ eeMemory.bin の中の、ジオメトライザへの命令の列（アーケードのプログラムが作ったもの）を読む:
//   行列 0x05800000 + float×12、物体 0x00800000 + 引数×4（4つ目を g_objTbl 0x1fc8760 で逆に引くとモデル番号）
// 頂点の変換は x'=x·m0+y·m3+z·m6+m9 …（MODEL2 と同じと仮定）。焦点距離は命令 0x04800000 の値
import fs from "fs"; import vm from "vm"; import path from "path"; import {pngEncode,pngDecode} from "./png.mjs";
const here=path.dirname(new URL(import.meta.url).pathname), ctx={}; vm.createContext(ctx);
for(const f of ["cricmp.js","obj.js","raster.js","tex.js"]) vm.runInContext(fs.readFileSync(path.join(here,f),"utf8"),ctx);
const [,,dir,outp]=process.argv;
const mem=fs.readFileSync(path.join(dir,"eeMemory.bin")), W32=new Uint32Array(mem.buffer,mem.byteOffset,mem.length>>2), F32=new Float32Array(mem.buffer,mem.byteOffset,mem.length>>2);
// モデル番号 → どのファイルのどのモデルか（キャラの OBJ_*1/2.CMP を全部読む）
const bin=path.join(here,"disc/bin"), byId=new Map();
for(const f of fs.readdirSync(bin).filter(f=>/^OBJ_(?!STAGE).*\.CMP$/.test(f))){
  const ms=ctx.objModels(ctx.cricmpUnpack(new Uint8Array(fs.readFileSync(path.join(bin,f)))));
  for(const m of ms) if(!byId.has(m.id)) byId.set(m.id,{file:f,m});
}
// CLUT の置き場所（写しごとに違う入れもの）: 番号2 の並び 00 00 01 01 02 02 … を探して、そこから 2×128 戻る
const CLUT_BASE=(()=>{ const pat=Buffer.from([0,0,1,1,2,2,3,3,4,4,5,5]); let i=mem.indexOf(pat,0x100000);
  while(i>=0){ if(mem[i-128+4*5]!==undefined) return i-2*128; } return 0 })();
const LUMAK=+(process.env.LUMAK||1.2);   // 明るさの倍率（仮。色ごとに 0.5〜1.25 で合う値が違う。光の計算を入れていないため）
const GEO=0x135a000, TEXRAM=mem.subarray(GEO+0xa040,GEO+0xa040+0x80000);
// g_objTbl を逆に引く表
const TBL=0x1fc8760>>2, inv=new Map();
for(let i=0;i<0xa028/4;i++){ const v=W32[TBL+i]; if(v&&!inv.has(v)) inv.set(v,{player:(i/5125)|0,id:i%5125}) }
// 命令の列を先頭（焦点距離の命令 0x04800000）から1つずつ読み、「終わり」（番号 15）で止める。
// 命令＝上位 bit23〜の番号、下位 23bit は 0。引数の語数（MAME の MODEL2 と実物で確かめた）: 物体1=4、枠3=6、モード7=1、
// 8=1、焦点9=2、光10=3、行列11=12、平行移動12=3、LOD22=1。bit31 の立った語は別の所を呼ぶ1語。5つの写しで知らない語なしに終わりまで読める
const LEN={0:0,1:4,3:6,7:1,8:1,9:2,10:3,11:12,12:3,22:1};
let start=W32.indexOf(0x04800000,0xf50000>>2);
if(start<0) throw new Error("命令の列が見つからない");
let draws=[], focal=[F32[start+1],F32[start+2]], mat=null;
for(let j=start;;){
  const w=W32[j];
  if(w>>>31){ j++; continue }
  const op=w>>>23;
  if(w&0x7fffff||!(op in LEN)&&op!==15) throw new Error("知らない語 "+(j*4).toString(16));
  if(op===15) break;
  if(op===11) mat=Array.from(F32.subarray(j+1,j+13));
  if(op===1){ const o=inv.get(W32[j+4]); if(o&&mat) draws.push({...o,m:mat}) }
  j+=1+LEN[op];
}
const W=640,H=480, R=ctx.rasterNew(W*2,H,[40,38,34]);
// MODEL2 の画面（496×384、命令 3 の枠。中心は枠の真ん中）を、写真の中の絵の範囲 x 9〜630・y 34〜445 に引き伸ばす（写真で測った）
const probe=new Map(); if(process.env.PROBE) R.onPix=i=>probe.set(i,[probeKey,probeT]);
const cx=320, cy=240, fx=focal[0]*622/496, fy=focal[1]*412/384;
let drawn=0, skipped=new Set(), probeT=-1, probeKey='';
for(const d of draws){
  const e=byId.get(d.id); if(!e){ skipped.add(d.id); continue }
  const m=d.m, T=v=>[v[0]*m[0]+v[1]*m[3]+v[2]*m[6]+m[9], v[0]*m[1]+v[1]*m[4]+v[2]*m[7]+m[10], v[0]*m[2]+v[1]*m[5]+v[2]*m[8]+m[11]];
  // 属性の表は 1P が塊0、2P が塊1（塊1 はページの bit が反転し、色番号がほぼ +2。全ファイルで数えた）
  for(const p of ctx.objPolys(e.m.ch[3],e.m.ch[d.player?1:0],e.m.ch[2])){
    const q=p.v.map(T); if(q.some(v=>v[2]<0.05)) continue;
    const S=q.map(v=>[cx+fx*v[0]/v[2], cy-fy*v[1]/v[2], v[2]]);
    const e1=q[1].map((x,i)=>x-q[0][i]), e2=q[2].map((x,i)=>x-q[0][i]);
    const n=[e1[1]*e2[2]-e1[2]*e2[1],e1[2]*e2[0]-e1[0]*e2[2],e1[0]*e2[1]-e1[1]*e2[0]], l=Math.hypot(...n)||1;
    const sh=.3+.7*Math.abs(n[2]/l), col=d.player?[120*sh,200*sh,130*sh]:[210*sh,190*sh,160*sh];
    // 色（推測。写しで確かめ中）: 面の色 RAM（g_geo+0x40、16bit×1024、番号＝h3 の bit6-15、R が下位5bit）の各チャンネル 5bit と、
    // 明るさ（0〜63）で、色の変換表（R・G・B が g_geo+0x840・0x1040・0x1840、各 32行×64）を引く。
    // テクスチャの明るさ＝ h1 の下8bit の番号の CLUT（128B。写しの中の場所は CLUT_BASE）の t 番目の R バイト。テクスチャ無しは陰から
    const c16=mem.readUInt16LE(GEO+0x40+(p.attr[3]>>6&1023)*2), c5=[c16&31,c16>>5&31,c16>>10&31];
    const xl=(luma)=>c5.map((v,ch)=>mem[GEO+0x840+ch*0x800+v*64+Math.max(0,Math.min(63,luma|0))]);
    const base=xl(63*sh);
    if(p.attr[0]>>14&1){
      const {page,st}=ctx.texCoords(p.attr,p.uv), clut=CLUT_BASE+(p.attr[1]&255)*128;
      const sample=(x,y)=>{ const t=ctx.texRam(TEXRAM,page,x,y); probeT=t; return xl(mem[clut+t*4]*(.6+.4*sh)*LUMAK) };
      probeKey=d.id+':'+(p.attr[3]>>6)+':'+(p.attr[1]&0xffff);
      for(let i=1;i+1<S.length;i++) ctx.rasterTriTex(R,S[0],S[i],S[i+1],st[0],st[i],st[i+1],sample,1);
    } else for(let i=1;i+1<S.length;i++) ctx.rasterTri(R,S[0],S[i],S[i+1],base);
  }
  drawn++;
}
// 右半分に画面の写真
const shot=pngDecode(fs.readFileSync(path.join(dir,"Screenshot.png")));
// 右半分に画面の写真。組んだ2人がある所は、写真に半分の濃さで重ねる（重なり具合を見るため）
for(let y=0;y<Math.min(H,shot.H);y++) for(let x=0;x<Math.min(W,shot.W);x++){
  const o=(y*W*2+W+x)*3, s=(y*shot.W+x)*3, a=(y*W*2+x)*3, hit=R.z[y*W*2+x]<Infinity;
  for(let c=0;c<3;c++) R.px[o+c]=hit?(shot.px[s+c]+R.px[a+c])>>1:shot.px[s+c];
}
if(process.env.PROBE){ const out={}; for(const [i,[k,t]] of probe){ if(R.z[i]===Infinity) continue; const y=(i/(W*2))|0, x=i%(W*2); if(x>=W||y>=shot.H) continue; const s=(y*shot.W+x)*3; (out[k+':'+t]??=[]).push([shot.px[s],shot.px[s+1],shot.px[s+2]]) } fs.writeFileSync('out/probe.json',JSON.stringify(out)) }
fs.mkdirSync(path.dirname(outp),{recursive:true}); fs.writeFileSync(outp,pngEncode(R.W,R.H,R.px));
console.log(outp,"物体",draws.length,"描いた",drawn,"焦点",focal.join(","),"ファイルに無い番号",[...skipped].slice(0,20).join(","));
