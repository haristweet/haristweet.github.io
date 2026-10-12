// 絵で確かめる台本（教訓1）。選手を組んで、決まった角度で描いて並べる。
//   node pose.mjs out/pose.png [組] [頭] [動き:コマ,…] [ヨー度,…]
//   行ごとに変えるときは 動き:コマ:組:頭:TEX_xx:チーム-選手[-背番号]（省略した所は引数の値。背番号を省くとゲームの表の番号）
//   チーム-選手 を付けると、ゲームの選手の表から見た目（頭・肌・髪の色・顔・スパイク）を付け、ユニフォームは TEX_チーム にする
//   環境変数 GRID=n で、行を n 個ずつ横に並べる（一覧用）。C=欄の大きさ（既定 200）
//   テクスチャ: 環境変数 TEX=TEX_00（DAT2D.BIN の 2 つの並びのあとに読む）。TEX=none で単色
// 行＝動き、列＝向き（既定 0,90,180,270 と、最後の列は頭の寄り）。全部同じ縮尺。PS1 は Y が下向き
import fs from "fs"; import vm from "vm"; import path from "path"; import {pngEncode} from "./png.mjs";
const here=path.dirname(new URL(import.meta.url).pathname), ctx={}; vm.createContext(ctx);
for(const f of ["tmd.js","anim.js","raster.js","tex.js","look.js"]) vm.runInContext(fs.readFileSync(path.join(here,f),"utf8"),ctx);
const sel=new Uint8Array(fs.readFileSync(path.join(here,"disc/x/SELECT.BIN"))), exe=new Uint8Array(fs.readFileSync(path.join(here,"disc/x/SLPM_868.35"))), disc=path.join(here,"disc/x/BIN"), model=new Uint8Array(fs.readFileSync(disc+"/MODEL.BIN")), anime=new Uint8Array(fs.readFileSync(disc+"/ANIME.BIN"));
const [,,outp,setA,headA,animA,yawA]=process.argv;
const set=+(setA??2), head=+(headA??0), anims=(animA||"0:0").split(",").map(s=>s.split(":")), yaws=(yawA||"0,90,180,270").split(",").map(Number);
const texDefault=process.env.TEX||"TEX_00"; let vram=null, texName=texDefault;
function loadTex(name){ texName=name; vram=ctx.weVramNew(); if(name==="none") return;
  const d2=new Uint8Array(fs.readFileSync(disc+"/DAT2D.BIN")); ctx.weTexLoadRun(vram,d2,0x800f0000,0); ctx.weTexLoadRun(vram,d2,0x800f0000,1);
  const sel=new Set((process.env.TEXSEL||"0,1,4,7,8,9,11").split(",").map(Number));   // TEX_xx の札を選ぶ。既定はページの「1 着目」（2 着目は 2,3,5,7,8,10,11）
  ctx.weTexLoad(vram,new Uint8Array(fs.readFileSync(disc+"/"+name+".BIN")),0x800f0000,sel) }
const C=+(process.env.C||200), per=yaws.length+1, G=+(process.env.GRID||1), cols=per*G, R=ctx.rasterNew(cols*C,Math.ceil(anims.length/G)*C,[40,38,34]);
const L=(()=>{ const l=[-.4,-.6,-.7], n=Math.hypot(...l); return l.map(x=>x/n) })();
const PCOL=[[230,200,170],[200,60,60],[230,190,160],[230,190,160],[230,190,160],[230,190,160],[60,60,200],[230,190,160],[50,50,50],[60,60,200],[230,190,160],[50,50,50]];
let LOOK=null;
function draw(parts,OX,OY,yawDeg,zoomHead){
  const D=ctx.rasterNew(C,C,[40,38,34]), ox=0, oy=0;   // 欄ごとに描いてから貼る（はみ出さない）
  const yaw=yawDeg*Math.PI/180, rot=p=>[p[0]*Math.cos(yaw)+p[2]*Math.sin(yaw), p[1], -p[0]*Math.sin(yaw)+p[2]*Math.cos(yaw)];
  const polys=[];
  for(const pt of parts){ const t=ctx.tmdRead(model,pt.off); if(!t) continue;
    let k=0; for(const o of t.objs) for(const p0 of o.prims){ k++; const Lk=ctx.weLookPrim(p0,pt.part,k,LOOK), p={...p0,uv:Lk.uv,cba:Lk.cba,tsb:Lk.tsb}; polys.push({part:pt.part,pr:p,P:p.v.map(i=>rot(ctx.weXform(pt.m,pt.t,o.verts[i]||[0,0,0])))}) } }
  const hp=polys.filter(p=>p.part===0).flatMap(p=>p.P), all=polys.flatMap(p=>p.P);
  const src=zoomHead&&hp.length?hp:all;
  const mn=[0,1].map(i=>Math.min(...src.map(v=>v[i]))), mx=[0,1].map(i=>Math.max(...src.map(v=>v[i])));
  const s=zoomHead?(C-C*.15)/Math.max(mx[0]-mn[0],mx[1]-mn[1]):(C-C*.1)/420, cx=(mn[0]+mx[0])/2, cy=zoomHead?(mn[1]+mx[1])/2:(mn[1]+mx[1])/2;
  for(const p of polys){
    const q=p.P, e1=q[1].map((x,i)=>x-q[0][i]), e2=q[2].map((x,i)=>x-q[0][i]);
    const n=[e1[1]*e2[2]-e1[2]*e2[1],e1[2]*e2[0]-e1[0]*e2[2],e1[0]*e2[1]-e1[1]*e2[0]], l=Math.hypot(...n)||1;
    const sh=.35+.65*Math.abs((n[0]*L[0]+n[1]*L[1]+n[2]*L[2])/l), col=(PCOL[p.part]||[200,200,200]).map(c=>Math.round(c*sh));
    const Q=q.map(v=>[ox+C/2+(v[0]-cx)*s, oy+C/2+(v[1]-cy)*s, v[2]]);
    if(texName!=="none"&&p.pr.uv){ const T=p.pr.uv, pr=p.pr, smp=(u,v)=>ctx.weTexel(vram,pr.tsb,pr.cba,Math.floor(u),Math.floor(v));
      for(let i=1;i+1<Q.length;i++) ctx.rasterTriTex(D,Q[0],Q[i],Q[i+1],T[0],T[i],T[i+1],smp,127/128) }   // ゲームは光を当てない（0x8001235c）
    else for(let i=1;i+1<Q.length;i++) ctx.rasterTri(D,Q[0],Q[i],Q[i+1],col);
  }
  for(let y=0;y<C;y++) R.px.set(D.px.subarray(y*C*3,(y+1)*C*3),((OY+y)*R.W+OX)*3);
}
anims.forEach((row,r)=>{
  let a=+row[0], f=+(row[1]||0), st=row[2]?+row[2]:set, hd=row[3]?+row[3]:head, tx=row[4]||texDefault; LOOK=null;
  let NUM=0;
  if(row[5]){ const [t,i,num]=row[5].split("-").map(Number), pl=ctx.wePlayer(sel,exe,t,i); NUM=num||pl.num;
    hd=pl.look.hmap*2+(pl.look.beard?1:0); tx="TEX_"+String(t).padStart(2,"0"); if(!row[2]&&pl.gk) st=4;
    LOOK={...pl.look,cell:[4,5,10,11].includes(st)?null:0} }   // キーパーの体は欄 10（UV は書き換えない）
  if(tx!==texName||!vram) loadTex(tx);
  if(NUM) ctx.weComposeNumber(vram,LOOK.cell??10,NUM);
  const parts=ctx.wePose(model,anime,st,hd,a,f);
  const X=(r%G)*per*C, Y=Math.floor(r/G)*C;
  yaws.forEach((y,c)=>draw(parts,X+c*C,Y,y,false)); draw(parts,X+yaws.length*C,Y,yaws[0],true);
  ctx.rasterText(R,X+4,Y+4,row.join(" ").replace(/TEX_/,""),[150,150,140],2);
});
fs.mkdirSync(path.dirname(outp),{recursive:true}); fs.writeFileSync(outp,pngEncode(R.W,R.H,R.px)); console.log(outp);
