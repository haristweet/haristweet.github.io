// 顔の寄り（教訓1）。写しの中の、指定したプレイヤーの頭の周り（頭のモデルの位置から半径 r）だけを、4つの向きから大きく描く。
//   node faceshot.mjs disc/states/06_akira_akira out/face.png [プレイヤー 0/1] [頭のモデル番号] [透明にする値（既定 15。-1 で抜かない）]
// 色の付け方はページ・pose.mjs と同じ（build.js・tex.js）
import fs from "fs"; import vm from "vm"; import path from "path"; import {pngEncode} from "./png.mjs";
const here=path.dirname(new URL(import.meta.url).pathname), ctx={console}; vm.createContext(ctx);
for(const f of ["cricmp.js","obj.js","tex.js","scene.js","build.js"]) vm.runInContext(fs.readFileSync(path.join(here,f),"utf8"),ctx);
const g=n=>vm.runInContext(n,ctx);
const [,,dir,outp,plArg,headArg,cutArg]=process.argv, pl=+(plArg??0), headId=+(headArg??412), CUT=+(cutArg??15);
const mem=fs.readFileSync(path.join(dir,"eeMemory.bin")), sc=g("sceneRead")(mem), col=g("sceneColors")(mem);
const light=g("sceneLight")(fs.readFileSync(path.join(dir,"vu1Memory.bin")),sc);
const bin=path.join(here,"disc/bin"), chars=fs.readdirSync(bin).filter(f=>/^OBJ_[A-Z]{3}\d\.CMP$/.test(f)).sort().map(f=>({name:f,models:g("objModels")(g("cricmpUnpack")(new Uint8Array(fs.readFileSync(path.join(bin,f)))))}));
const models={}; for(const p of [0,1]){ const c=g("sceneChooseModels")(sc,p,chars); models[p]=c&&c.map }
const hd=sc.draws.find(d=>d.player===pl&&d.id===headId); if(!hd) throw new Error("頭のモデルが無い");
const C=[hd.m[9],hd.m[10],hd.m[11]], R=0.22;
const mesh=g("sceneMesh")(sc,col,models,{which:"body",stage:false,players:[pl===0,pl===1],light}), D=mesh.data, S=g("BUILD_STRIDE");
const tris=[]; for(let t=0;t<mesh.count;t+=3){ const V=[0,1,2].map(k=>Array.from(D.subarray((t+k)*S,(t+k+1)*S)));
  if(V.every(v=>Math.hypot(v[0]-C[0],v[1]-C[1],v[2]-C[2])<R)) tris.push(V) }
const CELL=360, W=CELL*4, H=CELL, px=new Uint8Array(W*H*3).fill(40), zb=new Float32Array(W*H).fill(Infinity);
for(let k=0;k<4;k++){
  const a=k*Math.PI/2, ca=Math.cos(a), sa=Math.sin(a), sc2=CELL/(2*R*0.9);
  const P=v=>{ const x=v[0]-C[0], y=v[1]-C[1], z=v[2]-C[2]; return [k*CELL+CELL/2+(x*ca+z*sa)*sc2, CELL/2-y*sc2, -x*sa+z*ca] };
  for(const V of tris){
    const [a0,b,c]=V.map(P), d=(b[0]-a0[0])*(c[1]-a0[1])-(b[1]-a0[1])*(c[0]-a0[0]); if(Math.abs(d)<1e-9) continue;
    const Lc=col.clut[V[0][17]*128+g("buildBright")([V[0][3],V[0][4],V[0][5]],[V[0][19],V[0][20],V[0][21],V[0][22]],light)], c5=[V[0][6],V[0][7],V[0][8]], tex=V[0][15]>.5;
    const x0=Math.max(k*CELL,Math.floor(Math.min(a0[0],b[0],c[0]))), x1=Math.min((k+1)*CELL-1,Math.ceil(Math.max(a0[0],b[0],c[0])));
    const y0=Math.max(0,Math.floor(Math.min(a0[1],b[1],c[1]))), y1=Math.min(H-1,Math.ceil(Math.max(a0[1],b[1],c[1])));
    for(let y=y0;y<=y1;y++) for(let x=x0;x<=x1;x++){
      const qx=x+.5,qy=y+.5, w1=((qx-a0[0])*(c[1]-a0[1])-(qy-a0[1])*(c[0]-a0[0]))/d, w2=((b[0]-a0[0])*(qy-a0[1])-(b[1]-a0[1])*(qx-a0[0]))/d, w0=1-w1-w2;
      if(w0<0||w1<0||w2<0) continue; const z=w0*a0[2]+w1*b[2]+w2*c[2], i=y*W+x; if(z>=zb[i]) continue;
      let tv=-1;
      if(tex){ const lx=w0*V[0][9]+w1*V[1][9]+w2*V[2][9], ly=w0*V[0][10]+w1*V[1][10]+w2*V[2][10], sw=V[0][13], sh=V[0][14];
        tv=g("texRam")(col.tex,V[0][16],Math.floor(V[0][11]+((lx%sw)+sw)%sw),Math.floor(V[0][12]+((ly%sh)+sh)%sh)); if(V[0][15]>1.5&&tv===CUT) continue }
      zb[i]=z; const l=g("buildLuma")(Lc,tv,V[0][23]%2>.5); for(let ch=0;ch<3;ch++) px[i*3+ch]=col.xlat[ch*0x800+c5[ch]*64+l];
    }
  }
}
fs.writeFileSync(outp,pngEncode(W,H,px)); console.log(outp,"三角形",tris.length);
