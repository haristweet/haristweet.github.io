// 絵で確かめる台本（教訓1）。モデルのファイル1つの全部品を、決まった角度で並べて PNG にする。
//   node sheet.mjs disc/bin/OBJ_AKI1.CMP out/aki1.png [列数] [ヨー度] [ピッチ度] [番号,番号…] [欄の大きさ]
// 部品ごとに大きさを合わせて描く（部品どうしの大きさは比べられない）。欄の左上の数はモデル番号
import fs from "fs"; import vm from "vm"; import path from "path"; import {pngEncode} from "./png.mjs";
const here=path.dirname(new URL(import.meta.url).pathname), ctx={}; vm.createContext(ctx);
for(const f of ["cricmp.js","obj.js","raster.js"]) vm.runInContext(fs.readFileSync(path.join(here,f),"utf8"),ctx);
const [,,inp,outp,colsArg,yawArg,pitchArg,idsArg,cellArg]=process.argv;
let u8=new Uint8Array(fs.readFileSync(inp));
if(String.fromCharCode(...u8.subarray(0,6))==="CRICMP") u8=ctx.cricmpUnpack(u8);
const ids=idsArg?idsArg.split(",").map(Number):null, models=ctx.objModels(u8).filter(m=>!ids||ids.includes(m.id)), cols=+colsArg||12, C=+cellArg||160, rows=Math.ceil(models.length/cols);
const R=ctx.rasterNew(cols*C,rows*C,[40,38,34]);
const yaw=(+(yawArg??30))*Math.PI/180, pitch=(+(pitchArg??15))*Math.PI/180;
const rot=p=>{ const x=p[0]*Math.cos(yaw)+p[2]*Math.sin(yaw), z0=-p[0]*Math.sin(yaw)+p[2]*Math.cos(yaw);
  const y=p[1]*Math.cos(pitch)-z0*Math.sin(pitch), z=p[1]*Math.sin(pitch)+z0*Math.cos(pitch); return [x,y,z] };
const L=(()=>{ const l=[-.4,.6,-.7], n=Math.hypot(...l); return l.map(x=>x/n) })();
models.forEach((m,k)=>{
  const ps=ctx.objPolys(m.ch[3]), ox=(k%cols)*C, oy=Math.floor(k/cols)*C;
  const vs=ps.flatMap(p=>p.v.map(rot)); if(!vs.length) return;
  const mn=[0,1,2].map(i=>Math.min(...vs.map(v=>v[i]))), mx=[0,1,2].map(i=>Math.max(...vs.map(v=>v[i])));
  const s=(C-24)/Math.max(mx[0]-mn[0],mx[1]-mn[1],1e-6), cx=(mn[0]+mx[0])/2, cy=(mn[1]+mx[1])/2;
  // Y は下向きと仮定して、画面の上下はそのまま（上が -Y）。確かめたら直す
  const scr=v=>[ox+C/2+(v[0]-cx)*s, oy+C/2+(v[1]-cy)*s+6, v[2]];
  for(const p of ps){
    const q=p.v.map(rot), e1=q[1].map((x,i)=>x-q[0][i]), e2=q[2].map((x,i)=>x-q[0][i]);
    const n=[e1[1]*e2[2]-e1[2]*e2[1],e1[2]*e2[0]-e1[0]*e2[2],e1[0]*e2[1]-e1[1]*e2[0]], l=Math.hypot(...n)||1;
    const d=(n[0]*L[0]+n[1]*L[1]+n[2]*L[2])/l, front=n[2]<0, sh=.35+.65*Math.abs(d);
    const col=front?[220*sh,200*sh,170*sh]:[120*sh,140*sh,200*sh];
    const S=q.map(scr);
    for(let i=1;i+1<S.length;i++) ctx.rasterTri(R,S[0],S[i],S[i+1],col.map(Math.round));
  }
  ctx.rasterText(R,ox+4,oy+4,m.id,[150,150,140],2);
});
fs.mkdirSync(path.dirname(outp),{recursive:true});
fs.writeFileSync(outp,pngEncode(R.W,R.H,R.px));
console.log(outp, models.length, "モデル");
