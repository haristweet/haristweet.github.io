// 動きの一覧（棒人間）。#1360 の動きを、1 行に 1 つ、こまを 5 つ横から並べる。左の手足は赤、右は青、胴と頭は白
//   node motsheet.mjs out/shots/motsheet [始め=0] [数=60] → out/shots/motsheet_000.png …（IDS=1,2,3 で番号を選ぶ。C＝枠の大きさ、PER＝1 枚の数、K＝こまの数、VIEW=front／top）
import fs from "fs"; import vm from "vm"; import path from "path"; import {pngEncode} from "./png.mjs";
const here=path.dirname(new URL(import.meta.url).pathname), ctx={}; vm.createContext(ctx);
for(const f of ["we12.js","jw.js","jwbody.js","raster.js"]) vm.runInContext(fs.readFileSync(path.join(here,f),"utf8"),ctx);
const g=n=>vm.runInContext(n,ctx);
const [,,outp="out/shots/motsheet",from="0",count="485"]=process.argv, per=+(process.env.PER||60), K=+(process.env.K||5), C=+(process.env.C||72);
const rd=i=>new Uint8Array(fs.readFileSync(path.join(here,`data/${String(i).padStart(5,"0")}.bin`)));
const B=g("jwBodyParse")(rd(g("JW_BODY"))), U=rd(g("JW_MOTIONS")), L=g("jwMotionList")(U);
const left=new Set([2,4,12,7,9,14,17]), right=new Set([3,5,13,8,10,15,18]);
// 線を太さ 2 で引く
const line=(R,a,b,col)=>{ const n=Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1]))+1; for(let i=0;i<=n;i++){ const x=Math.round(a[0]+(b[0]-a[0])*i/n), y=Math.round(a[1]+(b[1]-a[1])*i/n);
  for(const [dx,dy] of [[0,0],[1,0],[0,1],[1,1]]){ const X=x+dx, Y=y+dy; if(X>=0&&Y>=0&&X<R.W&&Y<R.H){ const p=(Y*R.W+X)*3; R.px[p]=col[0]; R.px[p+1]=col[1]; R.px[p+2]=col[2] } } } };
const end=Math.min(L.length,+from+ +count), pick=process.env.IDS?process.env.IDS.split(",").map(Number):null;
for(let s=pick?0:+from;s<(pick?pick.length:end);s+=per){
  const ids=[]; if(pick) ids.push(...pick.slice(s,s+per)); else for(let i=s;i<Math.min(end,s+per);i++) ids.push(i);
  const cols=2, rowsN=Math.ceil(ids.length/cols), cw=40+K*C, R=g("rasterNew")(cols*cw,rowsN*C,[30,30,30]);
  ids.forEach((i,j)=>{ const ox=(j%cols)*cw, oy=Math.floor(j/cols)*C, M=g("jwMotionFrames")(U,L[i]);
    g("rasterText")(R,ox+2,oy+4,String(i),[255,255,255],1);
    const n=M.frames.length; if(!n) return;
    g("rasterText")(R,ox+2,oy+14,String(n),[150,150,150],1);
    for(let c=0;c<K;c++){ const fi=Math.round(c*(n-1)/Math.max(1,K-1)), W=g("jwMotionPose")(B,M.frames[fi]);
      const P=W.map(m=>g("jwWorldToView")(m.slice(12,15))), rx=P[0][2], s2=(C-6)/760;
      // 横から（画面の右＝体の前）。足もとを枠の下に
      // VIEW=front で前から（画面の右＝体の左）、top で上から（下＝体の前）
      const fx=P[0][0], fz=P[0][2], V=process.env.VIEW;
      const scr=p=>V==="front"?[ox+40+c*C+C/2+(p[0]-fx)*s2, oy+C-3-p[1]*s2]:V==="top"?[ox+40+c*C+C/2+(p[0]-fx)*s2, oy+C/2+(p[2]-fz)*s2]:[ox+40+c*C+C/2+(p[2]-rx)*s2, oy+C-3-p[1]*s2];
      B.par.forEach((pp,k)=>{ if(pp<0) return; line(R,scr(P[pp]),scr(P[k]),left.has(k)?[255,90,90]:right.has(k)?[90,150,255]:[230,230,230]) });
      // 頭の向き: 骨 16 から少し先へ
      const hd=P[16], hm=W[16]; line(R,scr(hd),scr(g("jwWorldToView")([hm[12]+hm[0]*40,hm[13]+hm[1]*40,hm[14]+hm[2]*40])),[255,220,0]) } });
  const f=`${outp}_${String(s).padStart(3,"0")}.png`; fs.mkdirSync(path.dirname(f),{recursive:true}); fs.writeFileSync(f,pngEncode(R.W,R.H,R.px)); console.log(f);
}
