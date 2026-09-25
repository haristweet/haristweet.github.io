// 明るさの解析（写真を答えにする）。セーブステートの2人を組み、画素ごとに
// 「面の向き・光の向き・色 RAM・テクスチャの値」と「写真の色を色の変換表で逆に引いた明るさ（0〜63）」を並べて out/light_<名前>.json に書く。
//   node light.mjs disc/states/01_akira_lau
import fs from "fs"; import vm from "vm"; import path from "path"; import {pngDecode} from "./png.mjs";
const here=path.dirname(new URL(import.meta.url).pathname), ctx={console}; vm.createContext(ctx);
for(const f of ["cricmp.js","obj.js","tex.js","scene.js","build.js"]) vm.runInContext(fs.readFileSync(path.join(here,f),"utf8"),ctx);
const g=n=>vm.runInContext(n,ctx);
const dir=process.argv[2], mem=fs.readFileSync(path.join(dir,"eeMemory.bin"));
const sc=g("sceneRead")(mem), col=g("sceneColors")(mem);
const bin=path.join(here,"disc/bin"), cand=fs.readdirSync(bin).filter(f=>/^OBJ_[A-Z]{3}\d\.CMP$/.test(f)).map(f=>({name:f,models:g("objModels")(g("cricmpUnpack")(new Uint8Array(fs.readFileSync(path.join(bin,f)))))}));
const models={}; for(const p of [0,1]){ const c=g("sceneChooseModels")(sc,p,cand); models[p]=c&&c.map }
const stc=fs.readdirSync(bin).filter(f=>/^OBJ_STAGE\d+\.CMP$/.test(f)).map(f=>({name:f,models:g("objModels")(g("cricmpUnpack")(new Uint8Array(fs.readFileSync(path.join(bin,f)))))}));
{ const st=g("sceneChooseModels")(sc,0,stc,models[0]?new Set(models[0].keys()):null); models.stage=st&&st.map }
const mesh=g("sceneMesh")(sc,col,models,{}), D=mesh.data, S=g("BUILD_STRIDE");
const shot=pngDecode(fs.readFileSync(path.join(dir,"Screenshot.png")));
const W=640,H=480, zb=new Float32Array(W*H).fill(Infinity), rec=new Array(W*H);
const fx=sc.focal[0]*622/496, fy=sc.focal[1]*412/384, L=sc.light, ll=Math.hypot(...L), Ln=L.map(v=>v/ll);
const xl=(c5,l)=>c5.map((v,ch)=>col.xlat[ch*0x800+v*64+l]);
for(let t=0;t<mesh.count;t+=3){
  const V=[0,1,2].map(k=>D.subarray((t+k)*S,(t+k+1)*S)), P=V.map(v=>[320+fx*v[0]/v[2],240-fy*v[1]/v[2],v[2]]);
  if(V.some(v=>v[2]<0.05)) continue;
  const n=[V[0][3],V[0][4],V[0][5]], dot=n[0]*Ln[0]+n[1]*Ln[1]+n[2]*Ln[2], c5=[V[0][6],V[0][7],V[0][8]], tex=V[0][15]>.5;
  const [a,b,c]=P, d=(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]); if(Math.abs(d)<1e-9) continue;
  const x0=Math.max(0,Math.floor(Math.min(a[0],b[0],c[0]))), x1=Math.min(W-1,Math.ceil(Math.max(a[0],b[0],c[0])));
  const y0=Math.max(0,Math.floor(Math.min(a[1],b[1],c[1]))), y1=Math.min(H-1,Math.ceil(Math.max(a[1],b[1],c[1])));
  for(let y=y0;y<=y1;y++) for(let x=x0;x<=x1;x++){
    const px=x+.5, py=y+.5, w1=((px-a[0])*(c[1]-a[1])-(py-a[1])*(c[0]-a[0]))/d, w2=((b[0]-a[0])*(py-a[1])-(b[1]-a[1])*(px-a[0]))/d, w0=1-w1-w2;
    if(w0<0||w1<0||w2<0) continue; const z=w0*a[2]+w1*b[2]+w2*c[2], i=y*W+x; if(z>=zb[i]) continue; zb[i]=z;
    let tl=-1, traw=-1, pal=-1;
    if(tex){ const lx=w0*V[0][9]+w1*V[1][9]+w2*V[2][9], ly=w0*V[0][10]+w1*V[1][10]+w2*V[2][10];
      const ox=V[0][11],oy=V[0][12],sw=V[0][13],shh=V[0][14],page=V[0][16]; pal=V[0][17]; const pal_x=0;
      const X=Math.floor(ox+((lx%sw)+sw)%sw), Y=Math.floor(oy+((ly%shh)+shh)%shh), tx=g("texRam")(col.tex,page,X,Y); tl=col.clut[pal*128+tx*4]; traw=tx; if(V[0][15]>1.5&&tx===15) continue }
    rec[i]={dot,c5,tl,traw,pal,hb:V[0][18],n:[V[0][3],V[0][4],V[0][5]]};
  }
}
// 写真の色 → 明るさ（その面の色 RAM の行で、いちばん近い列）
const out=[];
for(let i=0;i<W*H;i++){ const r=rec[i]; if(!r) continue; const s=i*3, sp=[shot.px[s],shot.px[s+1],shot.px[s+2]];
  let best=[1e9,0]; for(let l=0;l<64;l++){ const q=xl(r.c5,l), e=Math.abs(q[0]-sp[0])+Math.abs(q[1]-sp[1])+Math.abs(q[2]-sp[2]); if(e<best[0]) best=[e,l] }
  out.push([+r.dot.toFixed(3),r.tl,best[1],best[0],r.c5.join(","),r.traw,r.pal,r.hb,i%W,(i/W)|0,sp.join(","),r.n.map(v=>+v.toFixed(4))]) }
fs.writeFileSync(path.join(here,"out/light_"+path.basename(dir)+".json"),JSON.stringify(out));
console.log("画素",out.length,"光",Ln.map(v=>v.toFixed(3)).join(","));
