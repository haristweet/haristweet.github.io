// セーブステートの1コマを、ゲームが描いたとおりに組んで描く（教訓3: ゲーム自身の値を使う）。
//   node pose.mjs disc/states/01_akira_lau out/pose01.png
// 主メモリ eeMemory.bin の中の、ジオメトライザへの命令の列（アーケードのプログラムが作ったもの）を読む:
//   行列 0x05800000 + float×12、物体 0x00800000 + 引数×4（4つ目を g_objTbl 0x1fc8760 で逆に引くとモデル番号）
// 頂点の変換は x'=x·m0+y·m3+z·m6+m9 …（MODEL2 と同じと仮定）。焦点距離は命令 0x04800000 の値
import fs from "fs"; import vm from "vm"; import path from "path"; import {pngEncode,pngDecode} from "./png.mjs";
const here=path.dirname(new URL(import.meta.url).pathname), ctx={}; vm.createContext(ctx);
for(const f of ["cricmp.js","obj.js","raster.js"]) vm.runInContext(fs.readFileSync(path.join(here,f),"utf8"),ctx);
const [,,dir,outp]=process.argv;
const mem=fs.readFileSync(path.join(dir,"eeMemory.bin")), W32=new Uint32Array(mem.buffer,mem.byteOffset,mem.length>>2), F32=new Float32Array(mem.buffer,mem.byteOffset,mem.length>>2);
// モデル番号 → どのファイルのどのモデルか（キャラの OBJ_*1/2.CMP を全部読む）
const bin=path.join(here,"disc/bin"), byId=new Map();
for(const f of fs.readdirSync(bin).filter(f=>/^OBJ_(?!STAGE).*\.CMP$/.test(f))){
  const ms=ctx.objModels(ctx.cricmpUnpack(new Uint8Array(fs.readFileSync(path.join(bin,f)))));
  for(const m of ms) if(!byId.has(m.id)) byId.set(m.id,{file:f,m});
}
// g_objTbl を逆に引く表
const TBL=0x1fc8760>>2, inv=new Map();
for(let i=0;i<0xa028/4;i++){ const v=W32[TBL+i]; if(v&&!inv.has(v)) inv.set(v,{player:(i/5125)|0,id:i%5125}) }
// 命令の列: 最初のコマ（最初の「物体」から、物体の間が 0x1000 語以上あくまで）
let draws=[], focal=[600,600], last=-1;
for(let i=0x100000;i<W32.length-16;i++){
  if(W32[i]===0x04800000&&draws.length===0&&F32[i+1]>100&&F32[i+1]<5000) focal=[F32[i+1],F32[i+2]];
  if(W32[i]===0x00800000&&W32[i-13]===0x05800000&&inv.has(W32[i+4])){
    if(last>=0&&i-last>0x1000) break;
    const o=inv.get(W32[i+4]); draws.push({...o,m:Array.from(F32.subarray(i-12,i))}); last=i;
  }
}
const W=640,H=480, R=ctx.rasterNew(W*2,H,[40,38,34]);
const cx=W/2, cy=H/2, fk=W/496;   // MODEL2 の画面の幅 496 を 640 に広げると仮定
let drawn=0, skipped=new Set();
for(const d of draws){
  const e=byId.get(d.id); if(!e){ skipped.add(d.id); continue }
  const m=d.m, T=v=>[v[0]*m[0]+v[1]*m[3]+v[2]*m[6]+m[9], v[0]*m[1]+v[1]*m[4]+v[2]*m[7]+m[10], v[0]*m[2]+v[1]*m[5]+v[2]*m[8]+m[11]];
  for(const p of ctx.objPolys(e.m.ch[3])){
    const q=p.v.map(T); if(q.some(v=>v[2]<0.05)) continue;
    const S=q.map(v=>[cx+focal[0]*fk*v[0]/v[2], cy-focal[1]*fk*v[1]/v[2], v[2]]);
    const e1=q[1].map((x,i)=>x-q[0][i]), e2=q[2].map((x,i)=>x-q[0][i]);
    const n=[e1[1]*e2[2]-e1[2]*e2[1],e1[2]*e2[0]-e1[0]*e2[2],e1[0]*e2[1]-e1[1]*e2[0]], l=Math.hypot(...n)||1;
    const sh=.3+.7*Math.abs(n[2]/l), col=d.player?[120*sh,200*sh,130*sh]:[210*sh,190*sh,160*sh];
    for(let i=1;i+1<S.length;i++) ctx.rasterTri(R,S[0],S[i],S[i+1],col.map(Math.round));
  }
  drawn++;
}
// 右半分に画面の写真
const shot=pngDecode(fs.readFileSync(path.join(dir,"Screenshot.png")));
for(let y=0;y<Math.min(H,shot.H);y++) for(let x=0;x<Math.min(W,shot.W);x++) for(let c=0;c<3;c++) R.px[(y*W*2+W+x)*3+c]=shot.px[(y*shot.W+x)*3+c];
fs.mkdirSync(path.dirname(outp),{recursive:true}); fs.writeFileSync(outp,pngEncode(R.W,R.H,R.px));
console.log(outp,"物体",draws.length,"描いた",drawn,"焦点",focal.join(","),"ファイルに無い番号",[...skipped].slice(0,20).join(","));
