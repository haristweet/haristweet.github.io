// 動きの絵で確かめる台本（教訓1）。#1360 の動きを番号で選び、こまを横に並べて描く（上の段＝横から、下の段＝前から）。
//   node motion.mjs out/shots/motion_394.png 394 [こまの数=8] [data/sekiguchi.p2s]
// 体・手・関口の顔と髪・セーブの 1 着目のユニフォーム。ページと同じ組み立て（jwbody.js の jwMotionPose）
import fs from "fs"; import vm from "vm"; import path from "path"; import {pngEncode} from "./png.mjs";
const here=path.dirname(new URL(import.meta.url).pathname), ctx={TextDecoder,DecompressionStream,Response,Blob}; vm.createContext(ctx);
for(const f of ["fzstd.js","we12.js","p2s.js","jw.js","jwbody.js","raster.js"]) vm.runInContext(fs.readFileSync(path.join(here,f),"utf8"),ctx);
const g=n=>vm.runInContext(n,ctx);
const [,,outp="out/shots/motion.png",ent="394",N="8",save=path.join(here,"data/sekiguchi.p2s")]=process.argv, C=+(process.env.C||200);
const rd=i=>{ const f=path.join(here,`data/${String(i).padStart(5,"0")}.bin`); return fs.existsSync(f)?new Uint8Array(fs.readFileSync(f)):null };
const b=fs.readFileSync(save), file={size:b.length,slice:(a,e)=>({arrayBuffer:async()=>b.buffer.slice(b.byteOffset+a,b.byteOffset+(e??b.length))})};
const mem=await g("jwP2sMemory")(file), players=g("jwPlayers")(mem), kits=g("jwSaveKits")(mem), kit=kits.kits[0];
const common=g("jwCommonTextures")(Object.fromEntries(Object.entries(g("JW_COMMON")).map(([k,i])=>[k,rd(i)])));
const B=g("jwBodyParse")(rd(g("JW_BODY"))), U=rd(g("JW_MOTIONS")), L=g("jwMotionList")(U), M=g("jwMotionFrames")(U,L[+ent]);
const p=players.find(x=>/関口/.test(x.name)), opts=g("jwBodyOpts")(false,false);
console.log("動き",ent,"こま",M.frames.length,"長さ",M.dur.toFixed(3),"秒");
const n=Math.min(+N,M.frames.length), R=g("rasterNew")(n*C,2*C,[40,38,34]);
const smp=(tx,cl)=>tx?(s,t)=>{ const x=cl?Math.max(0,Math.min(tx.W-1,Math.floor(s*tx.W))):((Math.floor(s*tx.W)%tx.W)+tx.W)%tx.W, y=cl?Math.max(0,Math.min(tx.H-1,Math.floor(t*tx.H))):((Math.floor(t*tx.H)%tx.H)+tx.H)%tx.H, i=(y*tx.W+x)*4; return tx.rgba[i+3]<64?null:[tx.rgba[i],tx.rgba[i+1],tx.rgba[i+2]] }:()=>[150,150,150];
for(let c=0;c<n;c++){
  const fi=Math.round(c*(M.frames.length-1)/Math.max(1,n-1)), cur=g("jwMotionPose")(B,M.frames[fi]);
  const h=g("jwHeadMeshes")(rd(p.face),rd(p.hair),common,false), head=g("jwPlaceHead")(h.meshes,cur[16]);
  const ms=[...g("jwBodyMeshes")(B,cur,{0:common.ring,1:kit,5:kits.boots},opts),...head,...g("jwHandMeshes")(rd(g("JW_HANDS")),cur,common.ring)];
  // 大きさは T の姿の背の高さに固定、足もと（根の真下）を枠の下の方に
  const root=g("jwWorldToView")(cur[0].slice(12,15)), s=(C-20)/760;
  [[90,0],[0,1]].forEach(([yaw,row])=>{ const cy=Math.cos(yaw*Math.PI/180), sy=Math.sin(yaw*Math.PI/180);
    for(const m of ms){ const sm=smp(m.tex,m.clamp);
      for(let k=0;k<m.f.length;k+=15){ const q=[0,1,2].map(j=>{ const o=k+j*5, x=m.f[o]-root[0], y=m.f[o+1], z=m.f[o+2]-root[2], X=x*cy+z*sy, Z=-x*sy+z*cy; return [c*C+C/2+X*s,row*C+C-10-y*s,-Z] });
        if(q.some(v=>v[0]<c*C||v[0]>=(c+1)*C)) continue;
        g("rasterTriTex")(R,q[0],q[1],q[2],[m.f[k+3],m.f[k+4]],[m.f[k+8],m.f[k+9]],[m.f[k+13],m.f[k+14]],sm,1) } } });
  g("rasterText")(R,c*C+4,4,String(fi),[255,255,255],2);
}
fs.mkdirSync(path.dirname(outp),{recursive:true}); fs.writeFileSync(outp,pngEncode(R.W,R.H,R.px)); console.log(outp);
