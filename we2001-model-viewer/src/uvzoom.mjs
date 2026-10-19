// uvmap.mjs の拡大版。ユニフォームの絵の u 0〜W・v 0〜H を Z 倍で、絵の上に面の輪郭と「部品:面」を重ねる
//   node uvzoom.mjs out/uvzoom.png [TEX_xx] [組] [W] [H] [Z]
import fs from "fs"; import vm from "vm"; import path from "path"; import {pngEncode} from "./png.mjs";
const here=path.dirname(new URL(import.meta.url).pathname), ctx={}; vm.createContext(ctx);
for(const f of ["tmd.js","anim.js","raster.js","tex.js"]) vm.runInContext(fs.readFileSync(path.join(here,f),"utf8"),ctx);
const D=path.join(here,"disc/x/BIN"), model=new Uint8Array(fs.readFileSync(D+"/MODEL.BIN")), [,,outp,texA,setA,WA,HA,ZA]=process.argv;
const tex=texA||"TEX_16", set=+(setA||6), W=+(WA||64), H=+(HA||104), Z=+(ZA||8);
const v=ctx.weVramNew(), d2=new Uint8Array(fs.readFileSync(D+"/DAT2D.BIN")); ctx.weTexLoadRun(v,d2,0x800f0000,0); ctx.weTexLoadRun(v,d2,0x800f0000,1);
ctx.weTexLoad(v,new Uint8Array(fs.readFileSync(D+"/"+tex+".BIN")),0x800f0000,new Set([0,1,4,7,8,9,11]));
const R=ctx.rasterNew(W*Z,H*Z,[40,38,34]);
for(let y=0;y<H;y++) for(let x=0;x<W;x++){ const c=ctx.weTexel(v,153,486<<6,x,y)||[60,0,60]; for(let a=0;a<Z;a++) for(let b=0;b<Z;b++){ const i=((y*Z+a)*R.W+x*Z+b)*3; R.px[i]=c[0]*.6; R.px[i+1]=c[1]*.6; R.px[i+2]=c[2]*.6 } }
const line=(a,b,c)=>{ const n=Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])); for(let i=0;i<=n;i++){ const x=Math.round(a[0]+(b[0]-a[0])*i/n), y=Math.round(a[1]+(b[1]-a[1])*i/n); if(x>=0&&y>=0&&x<R.W&&y<R.H){ const j=(y*R.W+x)*3; R.px[j]=c[0]; R.px[j+1]=c[1]; R.px[j+2]=c[2] } } };
const COL=[[255,80,80],[80,255,80],[80,160,255],[255,220,0],[255,0,255],[0,230,230],[255,150,0],[180,120,255],[220,220,220],[150,255,150],[255,130,210],[90,200,90]], lab=[];
ctx.weModelSet(model,set).forEach((e,k)=>{ if(e.type!==2) return; const t=ctx.tmdRead(model,e.off); let n=0;
  for(const o of t.objs) for(const p of o.prims){ n++; if(!p.uv||p.tsb!==153) continue; const Q=p.uv.map(([u,w])=>[u*Z+Z/2,w*Z+Z/2]);
    for(let i=0;i<Q.length;i++) line(Q[i],Q[(i+1)%Q.length],COL[k]); lab.push([k,n,Q]) } });
for(const [k,n,Q] of lab){ const cx=Q.reduce((s,q)=>s+q[0],0)/Q.length, cy=Q.reduce((s,q)=>s+q[1],0)/Q.length; ctx.rasterText(R,cx-10,cy-6,k*100+n,COL[k],2) }
fs.writeFileSync(outp,pngEncode(R.W,R.H,R.px)); console.log(outp);
