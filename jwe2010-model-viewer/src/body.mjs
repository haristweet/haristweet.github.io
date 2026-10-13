// 体の絵で確かめる台本（教訓1）。セーブのチーム（ふだんはベガルタ仙台）の選手を、ページと同じ組み立て（jwbody.js）で前・横・後ろから描いて並べる。
//   node body.mjs out/shots/body.png [data/sekiguchi.p2s] [人数]
// 顔・髪・体のファイルは data/番号.bin（ほどいた見本）から。無い選手は飛ばす。ユニフォームはセーブの 1 着目（KIT=2 などで選ぶ）。袖は半袖（LONG=1 で長袖）
import fs from "fs"; import vm from "vm"; import path from "path"; import {pngEncode} from "./png.mjs";
const here=path.dirname(new URL(import.meta.url).pathname), ctx={TextDecoder,DecompressionStream,Response,Blob}; vm.createContext(ctx);
for(const f of ["fzstd.js","we12.js","p2s.js","jw.js","jwbody.js","raster.js"]) vm.runInContext(fs.readFileSync(path.join(here,f),"utf8"),ctx);
const g=n=>vm.runInContext(n,ctx);
const [,,outp="out/shots/body.png",save=path.join(here,"data/sekiguchi.p2s"),N="8"]=process.argv, C=+(process.env.C||260);
const rd=i=>{ const f=path.join(here,`data/${String(i).padStart(5,"0")}.bin`); return fs.existsSync(f)?new Uint8Array(fs.readFileSync(f)):null };
const b=fs.readFileSync(save), file={size:b.length,slice:(a,e)=>({arrayBuffer:async()=>b.buffer.slice(b.byteOffset+a,b.byteOffset+(e??b.length))})};
const mem=await g("jwP2sMemory")(file), players=g("jwPlayers")(mem), teams=g("jwTeams")(mem,players), kits=g("jwSaveKits")(mem);
const common=g("jwCommonTextures")(Object.fromEntries(Object.entries(g("JW_COMMON")).map(([k,i])=>[k,rd(i)])));
const B=g("jwBodyParse")(rd(g("JW_BODY"))), cur=g("jwBodyStand")(B), kit=kits.kits[(+process.env.KIT||1)-1];
const team=teams[0], list=team.members.map(i=>players[i]).filter(p=>rd(p.face)&&rd(p.hair)).slice(0,+N);
console.log(team.name,"ユニフォーム",kit?kit.id.toString(16):"無し","描く",list.map(p=>p.name).join("・"));
// 列: 前・横（右から）・後ろ・顔の寄り。行: 選手
const views=[[0,0,1],[90,0,1],[180,0,1],[0,0,3.2]], R=g("rasterNew")(views.length*C,list.length*C,[40,38,34]);
const smp=tx=>tx?(s,t)=>{ const x=((Math.floor(s*tx.W)%tx.W)+tx.W)%tx.W, y=((Math.floor(t*tx.H)%tx.H)+tx.H)%tx.H, i=(y*tx.W+x)*4; return tx.rgba[i+3]<64?null:[tx.rgba[i],tx.rgba[i+1],tx.rgba[i+2]] }:()=>[150,150,150];
list.forEach((p,row)=>{
  const h=g("jwHeadMeshes")(rd(p.face),rd(p.hair),common,false), head=g("jwPlaceHead")(h.meshes,cur[16]);
  const ms=[...g("jwBodyMeshes")(B,cur,{0:common.ring,1:kit,5:kits.boots},g(process.env.LONG?"JW_BODY_OPTS_LONG":"JW_BODY_OPTS_SHORT")),...head];
  const all=[]; for(const m of ms) for(let k=0;k<m.f.length;k+=5) all.push([m.f[k],m.f[k+1],m.f[k+2]]);
  const mn=[0,1,2].map(i=>Math.min(...all.map(v=>v[i]))), mx=[0,1,2].map(i=>Math.max(...all.map(v=>v[i]))), ctr=mn.map((v,i)=>(v+mx[i])/2);
  const hc=[0,1,2].map(i=>{ const hv=[]; for(const m of head) for(let k=0;k<m.f.length;k+=5) hv.push(m.f[k+i]); return (Math.min(...hv)+Math.max(...hv))/2 });
  views.forEach(([yaw,,zoom],col)=>{ const cy=Math.cos(yaw*Math.PI/180), sy=Math.sin(yaw*Math.PI/180), c0=zoom>1?hc:ctr, s=(C-16)/(mx[1]-mn[1])*zoom;
    for(const m of ms){ const sm=smp(m.tex);
      for(let k=0;k<m.f.length;k+=15){ const q=[0,1,2].map(j=>{ const o=k+j*5, x=m.f[o]-c0[0], y=m.f[o+1]-c0[1], z=m.f[o+2]-c0[2], X=x*cy+z*sy, Z=-x*sy+z*cy;
          return [col*C+C/2+X*s,row*C+C/2-y*s,-Z] });
        // 寄りの列は枠からはみ出す三角形を描かない（隣の行に重ならないように）
        if(q.some(v=>v[0]<col*C||v[0]>=(col+1)*C||v[1]<row*C||v[1]>=(row+1)*C)) continue;
        g("rasterTriTex")(R,q[0],q[1],q[2],[m.f[k+3],m.f[k+4]],[m.f[k+8],m.f[k+9]],[m.f[k+13],m.f[k+14]],sm,1) } } });
  g("rasterText")(R,4,row*C+4,String(p.i+1),[255,255,255],2);
});
fs.mkdirSync(path.dirname(outp),{recursive:true}); fs.writeFileSync(outp,pngEncode(R.W,R.H,R.px)); console.log(outp,R.W+"×"+R.H);
