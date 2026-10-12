// 絵で確かめる台本（教訓1）。ファイルの中の TMD を全部、決まった角度で並べて PNG にする。
//   node sheet.mjs disc/x/BIN/MODEL.BIN out/model.png [列数] [ヨー度] [ピッチ度] [欄の大きさ] [same]
// 欄の左上の数は TMD の通し番号。same を付けると全部を同じ縮尺で描く（部品の大きさを比べられる）
import fs from "fs"; import vm from "vm"; import path from "path"; import {pngEncode} from "./png.mjs"; import {tmdFind} from "./tmdscan.mjs";
const here=path.dirname(new URL(import.meta.url).pathname), ctx={}; vm.createContext(ctx);
for(const f of ["tmd.js","raster.js"]) vm.runInContext(fs.readFileSync(path.join(here,f),"utf8"),ctx);
const [,,inp,outp,colsArg,yawArg,pitchArg,cellArg,same]=process.argv;
const L0=tmdFind(new Uint8Array(fs.readFileSync(inp))), cols=+colsArg||12, C=+cellArg||128, rows=Math.ceil(L0.length/cols);
const R=ctx.rasterNew(cols*C,rows*C,[40,38,34]);
const yaw=(+(yawArg??30))*Math.PI/180, pitch=(+(pitchArg??15))*Math.PI/180;
const rot=p=>{ const x=p[0]*Math.cos(yaw)+p[2]*Math.sin(yaw), z0=-p[0]*Math.sin(yaw)+p[2]*Math.cos(yaw);
  const y=p[1]*Math.cos(pitch)-z0*Math.sin(pitch), z=p[1]*Math.sin(pitch)+z0*Math.cos(pitch); return [x,y,z] };
const L=(()=>{ const l=[-.4,-.6,-.7], n=Math.hypot(...l); return l.map(x=>x/n) })();
const polys=t=>t.objs.flatMap(o=>o.prims.map(p=>({...p,P:p.v.map(i=>o.verts[i]||[0,0,0])})));
let S0=Infinity; if(same) for(const {t} of L0){ const vs=polys(t).flatMap(p=>p.P.map(rot)); if(!vs.length) continue;
  const e=Math.max(...[0,1].map(i=>Math.max(...vs.map(v=>v[i]))-Math.min(...vs.map(v=>v[i])))); S0=Math.min(S0,(C-24)/Math.max(e,1e-6)) }
L0.forEach(({t},k)=>{
  const ps=polys(t), ox=(k%cols)*C, oy=Math.floor(k/cols)*C, vs=ps.flatMap(p=>p.P.map(rot)); if(!vs.length) return;
  const mn=[0,1].map(i=>Math.min(...vs.map(v=>v[i]))), mx=[0,1].map(i=>Math.max(...vs.map(v=>v[i])));
  const s=same?S0:(C-24)/Math.max(mx[0]-mn[0],mx[1]-mn[1],1e-6), cx=(mn[0]+mx[0])/2, cy=(mn[1]+mx[1])/2;
  const scr=v=>[ox+C/2+(v[0]-cx)*s, oy+C/2+(v[1]-cy)*s+6, v[2]];   // PS1 は Y が下向き。画面もそのまま
  for(const p of ps){
    const q=p.P.map(rot), e1=q[1].map((x,i)=>x-q[0][i]), e2=q[2].map((x,i)=>x-q[0][i]);
    const n=[e1[1]*e2[2]-e1[2]*e2[1],e1[2]*e2[0]-e1[0]*e2[2],e1[0]*e2[1]-e1[1]*e2[0]], l=Math.hypot(...n)||1;
    const d=(n[0]*L[0]+n[1]*L[1]+n[2]*L[2])/l, sh=.35+.65*Math.abs(d), base=p.col?p.col[0]:[200,190,170];
    const col=base.map(c=>Math.min(255,Math.round(c*sh*(p.col?1.6:1))));
    const Q=q.map(scr); for(let i=1;i+1<Q.length;i++) ctx.rasterTri(R,Q[0],Q[i],Q[i+1],col);
  }
  ctx.rasterText(R,ox+4,oy+4,k,[150,150,140],2);
});
fs.mkdirSync(path.dirname(outp),{recursive:true}); fs.writeFileSync(outp,pngEncode(R.W,R.H,R.px));
console.log(outp, L0.length, "TMD");
