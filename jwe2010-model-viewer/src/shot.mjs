// 絵で確かめる台本（教訓1）。ほどいたファイル（data/*.bin）の形を、決まった 4 方向から描いて並べる。
//   node shot.mjs out/x.png data/01600.bin data/01600.bin+data/03600.bin …
// 1 行が 1 つの引数。「a+b」はいくつかのファイルを同じ座標のまま重ねる（顔＋髪など）。
// 列は「前・横・後ろ・上」と、1 つ目のファイルの絵。ゲームの Y は下向きなので、画面では上下を返す
import fs from "fs"; import vm from "vm"; import path from "path"; import {pngEncode} from "./png.mjs";
const here=path.dirname(new URL(import.meta.url).pathname), ctx={}; vm.createContext(ctx);
for(const f of ["we12.js","raster.js"]) vm.runInContext(fs.readFileSync(path.join(here,f),"utf8"),ctx);
const [,,outp,...inps]=process.argv, C=+(process.env.C||200);
const views=[[-90,0],[0,0],[90,0],[-90,90]];
const R=ctx.rasterNew((views.length+1)*C,inps.length*C,[40,38,34]);
// ALPHA=1 で α を見る: α が 0x40（半分）未満の所を桃色に
const sampler=tx=>tx?(s,t)=>{ const x=((Math.floor(s*tx.W)%tx.W)+tx.W)%tx.W, y=((Math.floor(t*tx.H)%tx.H)+tx.H)%tx.H, i=(y*tx.W+x)*4;
  if(process.env.ALPHA&&tx.rgba[i+3]<128) return [255,0,200];
  return [tx.rgba[i],tx.rgba[i+1],tx.rgba[i+2]] }:null;
inps.forEach((inp,row)=>{
  const tris=[], firsts=[];
  for(const f of inp.split("+")){
    const u=new Uint8Array(fs.readFileSync(f)), mine=[], texs=[]; let nm=0;
    for(const p of ctx.weParts(u)){ const k=ctx.weKind(u,p.off);
      // 顔のファイルには同じ大きさの形が 2 つある（三角形 337 と 241。細かさ違いと推測）。重ねると縞になるので 1 つ目だけ。ALL=1 で全部
      if(k==="model"&&(process.env.ALL||!nm++)) mine.push(...ctx.weModel(u,p.off).tris);
      if(k==="tex") texs.push(ctx.weTex(u,p.off,texs.at(-1)?.pal)) }
    const tx=texs.find(t=>t.rgba), sms=texs.map(t=>t.rgba?sampler(t):null); firsts.push(tx);
    // 絵は包みの頭の番号（texi）で選ぶ。TEX0=1 で全部 1 枚目（比べる用）
    // SKIPSEL: 1 つ目のファイル（顔）で描かない sel（ふだんは 2＝あごまわりの重ね。ページと同じ。SKIPSEL=none で全部）
    const skip=(process.env.SKIPSEL??"2");
    if(skip!=="none"&&f===inp.split("+")[0]) mine.splice(0,mine.length,...mine.filter(t=>!skip.split(",").includes(String(t.sel))));
    for(const t of mine){ t.sample=(process.env.TEX0?null:sms[t.texi])||sampler(tx); tris.push(t) }
    console.log(f,"三角形",mine.length,"絵",texs.map(t=>`${t.W}x${t.H}/${t.psm.toString(16)}`).join(" "));
  }
  const all=tris.flatMap(t=>t.p), mn=[0,1,2].map(i=>Math.min(...all.map(v=>v[i]))), mx=[0,1,2].map(i=>Math.max(...all.map(v=>v[i])));
  const ctr=mn.map((v,i)=>(v+mx[i])/2), s=(C-20)/Math.max(1,...mx.map((v,i)=>v-mn[i]));
  views.forEach(([yaw,pitch],col)=>{
    const cy=Math.cos(yaw*Math.PI/180), sy=Math.sin(yaw*Math.PI/180), cp=Math.cos(pitch*Math.PI/180), sp=Math.sin(pitch*Math.PI/180);
    // 前＝+X の側から見る（顔は +X を向いている。絵で確認）。2 列目は −Z の側から。上＝−Y の側から見下ろす
    const rot=v=>{ const x=v[0]-ctr[0], y=-(v[1]-ctr[1]), z=v[2]-ctr[2], x1=x*cy-z*sy, z1=x*sy+z*cy, y1=y*cp-z1*sp, z2=y*sp+z1*cp; return [x1,y1,z2] };
    const scr=v=>{ const r=rot(v); return [col*C+C/2+r[0]*s, row*C+C/2-r[1]*s, r[2]] };
    for(const t of tris){ const q=t.p.map(scr);
      // SELCOLOR=1: 包みの sel ごとに色を塗る（0 灰・1 赤・2 緑・3 青・4 黄）
      if(process.env.SELCOLOR) ctx.rasterTri(R,q[0],q[1],q[2],[[150,150,150],[230,60,60],[60,200,60],[70,110,240],[230,210,60]][t.sel]||[255,0,255]);
      else if(t.sample) ctx.rasterTriTex(R,q[0],q[1],q[2],t.uv[0],t.uv[1],t.uv[2],t.sample,1);
      else ctx.rasterTri(R,q[0],q[1],q[2],[200,190,170]) }
  });
  const tx=firsts[0];
  if(tx) for(let y=0;y<Math.min(tx.H,C);y++) for(let x=0;x<Math.min(tx.W,C);x++){ const i=(y*tx.W+x)*4, o=((row*C+y)*R.W+views.length*C+x)*3; R.px[o]=tx.rgba[i]; R.px[o+1]=tx.rgba[i+1]; R.px[o+2]=tx.rgba[i+2] }
  ctx.rasterText(R,4,row*C+4,path.basename(inp.split("+")[0]).replace(/\D/g,""),[150,150,140],2);
});
fs.mkdirSync(path.dirname(outp)||".",{recursive:true}); fs.writeFileSync(outp,pngEncode(R.W,R.H,R.px));
