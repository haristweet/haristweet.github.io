// 絵で確かめる台本。ユニフォームの絵（ページ 576,256・8 ビット）のどこを、どの部品のどの面が使うかを描く。
//   node uvmap.mjs out/uvmap.png [TEX_xx] [組,…]
// 左＝絵そのもの（色の表 486）、右＝面ごとの UV を部品の色で塗り、面の番号を書いたもの。どちらも 2 倍
import fs from "fs"; import vm from "vm"; import path from "path"; import {pngEncode} from "./png.mjs";
const here=path.dirname(new URL(import.meta.url).pathname), ctx={}; vm.createContext(ctx);
for(const f of ["tmd.js","anim.js","raster.js","tex.js"]) vm.runInContext(fs.readFileSync(path.join(here,f),"utf8"),ctx);
const D=path.join(here,"disc/x/BIN"), model=new Uint8Array(fs.readFileSync(D+"/MODEL.BIN")), tex=process.argv[3]||"TEX_16", sets=(process.argv[4]||"6").split(",").map(Number);
const v=ctx.weVramNew(), d2=new Uint8Array(fs.readFileSync(D+"/DAT2D.BIN")); ctx.weTexLoadRun(v,d2,0x800f0000,0); ctx.weTexLoadRun(v,d2,0x800f0000,1);
ctx.weTexLoad(v,new Uint8Array(fs.readFileSync(D+"/"+tex+".BIN")),0x800f0000,new Set([0,1,4,7,8,9,11]));
const S=2, R=ctx.rasterNew(512*S,256*S,[40,38,34]);
for(let y=0;y<256;y++) for(let x=0;x<256;x++){ const c=ctx.weTexel(v,153,486<<6,x,y)||[60,0,60]; for(let a=0;a<S;a++) for(let b=0;b<S;b++){ const i=((y*S+a)*R.W+x*S+b)*3; R.px[i]=c[0]; R.px[i+1]=c[1]; R.px[i+2]=c[2] } }
const COL=[[255,80,80],[80,200,80],[80,120,255],[255,200,0],[255,0,255],[0,220,220],[255,140,0],[160,90,255],[200,200,200],[120,255,120],[255,120,200],[90,160,90]];
const labels=[];
for(const st of sets) ctx.weModelSet(model,st).forEach((e,k)=>{ if(e.type!==2) return; const t=ctx.tmdRead(model,e.off); let n=0;
  for(const o of t.objs) for(const p of o.prims){ n++; if(!p.uv||p.tsb!==153) continue;
    const Q=p.uv.map(([u,w])=>[256*S+u*S+S/2,w*S+S/2,0]), c=COL[k%COL.length];
    for(let i=1;i+1<Q.length;i++) ctx.rasterTri(R,Q[0],Q[i],Q[i+1],c.map(x=>x*((n%3)*.15+.7)|0));
    labels.push([k,n,Q]) } });
for(const [k,n,Q] of labels){ const cx=Q.reduce((s,q)=>s+q[0],0)/Q.length, cy=Q.reduce((s,q)=>s+q[1],0)/Q.length; ctx.rasterText(R,cx-6,cy-3,k,[0,0,0],1) }
fs.mkdirSync(path.dirname(process.argv[2]),{recursive:true}); fs.writeFileSync(process.argv[2],pngEncode(R.W,R.H,R.px)); console.log(process.argv[2]);
