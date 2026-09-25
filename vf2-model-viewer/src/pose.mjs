// セーブステートの1コマを、ページと同じ組み方・色の付け方（scene.js・build.js・tex.js）で描いて、画面の写真と並べる（教訓1・3）。
//   node pose.mjs disc/states/01_akira_lau out/pose01.png
// 左＝組んだ絵（背景・影つき）、右＝写真に組んだ絵（背景なし）を半分の濃さで重ねたもの
import fs from "fs"; import vm from "vm"; import path from "path"; import {pngEncode,pngDecode} from "./png.mjs";
const here=path.dirname(new URL(import.meta.url).pathname), ctx={console}; vm.createContext(ctx);
for(const f of ["cricmp.js","obj.js","tex.js","scene.js","build.js"]) vm.runInContext(fs.readFileSync(path.join(here,f),"utf8"),ctx);
const g=n=>vm.runInContext(n,ctx);
const [,,dir,outp]=process.argv, mem=fs.readFileSync(path.join(dir,"eeMemory.bin"));
const sc=g("sceneRead")(mem), col=g("sceneColors")(mem), vu1p=path.join(dir,"vu1Memory.bin"), light=g("sceneLight")(fs.existsSync(vu1p)?fs.readFileSync(vu1p):null,sc);
const bin=path.join(here,"disc/bin"), load=re=>fs.readdirSync(bin).filter(f=>re.test(f)).sort().map(f=>({name:f,models:g("objModels")(g("cricmpUnpack")(new Uint8Array(fs.readFileSync(path.join(bin,f)))))}));
const chars=load(/^OBJ_[A-Z]{3}\d\.CMP$/), stages=load(/^OBJ_STAGE\d+\.CMP$/);
const models={}; for(const p of [0,1]){ const c=g("sceneChooseModels")(sc,p,chars); models[p]=c&&c.map }
const st=g("sceneChooseModels")(sc,0,stages,models[0]?new Set(models[0].keys()):null); models.stage=st&&st.map;
const W=640,H=480, L=sc.light, ll=Math.hypot(...L), Ln=L.map(v=>v/ll);
const fx=sc.focal[0]*622/496, fy=sc.focal[1]*412/384;
function render(which,stage){
  const mesh=g("sceneMesh")(sc,col,models,{which,stage,light}), D=mesh.data, S=g("BUILD_STRIDE");
  const px=new Float32Array(W*H*4), zb=new Float32Array(W*H).fill(Infinity);
  // カメラの手前（奥行き 0.05）で三角形を切る（ページの WebGL と同じく、床のように手前に回り込む面も出す）
  const tris=[];
  for(let t=0;t<mesh.count;t+=3){
    let poly=[0,1,2].map(k=>Array.from(D.subarray((t+k)*S,(t+k+1)*S)));
    if(poly.some(v=>v[2]<0.05)){ const o=[];
      for(let i=0;i<poly.length;i++){ const A=poly[i], B=poly[(i+1)%poly.length], ia=A[2]>=0.05, ib=B[2]>=0.05;
        if(ia) o.push(A); if(ia!==ib){ const k=(0.05-A[2])/(B[2]-A[2]); o.push(A.map((x,j)=>x+(B[j]-x)*k)) } }
      poly=o; if(poly.length<3) continue }
    for(let i=1;i+1<poly.length;i++) tris.push([poly[0],poly[i],poly[i+1]]);
  }
  for(const V of tris){
    const P=V.map(v=>[320+fx*v[0]/v[2],240-fy*v[1]/v[2],v[2]]), [a,b,c]=P, d=(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]); if(Math.abs(d)<1e-9) continue;
    const c5=[V[0][6],V[0][7],V[0][8]], tex=V[0][15]>.5, Lc=col.clut[V[0][17]*128+g("buildBright")([V[0][3],V[0][4],V[0][5]],[V[0][19],V[0][20],V[0][21],V[0][22]],light)];
    const x0=Math.max(0,Math.floor(Math.min(a[0],b[0],c[0]))), x1=Math.min(W-1,Math.ceil(Math.max(a[0],b[0],c[0])));
    const y0=Math.max(0,Math.floor(Math.min(a[1],b[1],c[1]))), y1=Math.min(H-1,Math.ceil(Math.max(a[1],b[1],c[1])));
    for(let y=y0;y<=y1;y++) for(let x=x0;x<=x1;x++){
      const qx=x+.5, qy=y+.5, w1=((qx-a[0])*(c[1]-a[1])-(qy-a[1])*(c[0]-a[0]))/d, w2=((b[0]-a[0])*(qy-a[1])-(b[1]-a[1])*(qx-a[0]))/d, w0=1-w1-w2;
      if(w0<0||w1<0||w2<0) continue; const z=w0*a[2]+w1*b[2]+w2*c[2], i=y*W+x; if(z>=zb[i]) continue;
      let tv=-1;
      if(tex){ const lx=w0*V[0][9]+w1*V[1][9]+w2*V[2][9], ly=w0*V[0][10]+w1*V[1][10]+w2*V[2][10], sw=V[0][13], sh=V[0][14];
        const X=Math.floor(V[0][11]+((lx%sw)+sw)%sw), Y=Math.floor(V[0][12]+((ly%sh)+sh)%sh); const tx=g("texRam")(col.tex,V[0][16],X,Y); if(V[0][15]>1.5&&tx===15) continue; tv=tx }
      zb[i]=z; const l=g("buildLuma")(Lc,tv,V[0][23]>.5);
      for(let ch=0;ch<3;ch++) px[i*4+ch]=col.xlat[ch*0x800+c5[ch]*64+l]; px[i*4+3]=1;
    }
  }
  return {px,zb};
}
const body=render("body",true), chars2=render("body",false), shadow=render("shadow",true);
const shot=pngDecode(fs.readFileSync(path.join(dir,"Screenshot.png"))), out=new Uint8Array(W*2*H*3);
for(let y=0;y<H;y++) for(let x=0;x<W;x++){
  const i=y*W+x, o=(y*W*2+x)*3, o2=(y*W*2+W+x)*3, s=(y*shot.W+x)*3;
  let c=body.px[i*4+3]?[body.px[i*4],body.px[i*4+1],body.px[i*4+2]]:[40,38,34];
  if(shadow.px[i*4+3]&&shadow.zb[i]<=body.zb[i]+1e-3) c=c.map(v=>v*0.55);
  for(let k=0;k<3;k++){ out[o+k]=c[k]; out[o2+k]=chars2.px[i*4+3]?(shot.px[s+k]+chars2.px[i*4+k])>>1:shot.px[s+k] }
}
fs.mkdirSync(path.dirname(outp),{recursive:true}); fs.writeFileSync(outp,pngEncode(W*2,H,out));
console.log(outp,"部品",sc.draws.length,"1P",chars.find(c=>c.models&&models[0]&&c.models.length&&c.models[0]&&models[0].has(c.models[0].id))?.name||"","背景",st?st.name:"なし");
