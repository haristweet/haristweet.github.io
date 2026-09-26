// 頭の部品だけを大きく描き、画素ごとにどの三角形か・その下の三角形との奥行きの差を out/…png.json に出す（顔の線や隈取りの原因を調べた道具）。
//   node facepick.mjs 写し 出力.png プレイヤー 頭の番号 [向き 1] [拡大] [ずらしx] [ずらしy]
// 部品の中はファイルの順に上塗り（ゲームの m2mdlSetSameZval と同じ）
// 顔を正面寄り（faceshot の 2 枚目の向き）で大きく描き、画素ごとにどの三角形かを記録する
import fs from "fs"; import vm from "vm"; import path from "path"; import {pngEncode} from "./png.mjs";
const here=path.dirname(new URL(import.meta.url).pathname), ctx={console}; vm.createContext(ctx);
for(const f of ["cricmp.js","obj.js","tex.js","scene.js","build.js"]) vm.runInContext(fs.readFileSync(path.join(here,f),"utf8"),ctx);
const g=n=>vm.runInContext(n,ctx);
const [,,dir,outp,plArg,headArg,angArg,zArg,oxArg,oyArg]=process.argv, pl=+plArg, headId=+headArg, ANG=+(angArg??1), ZM=+(zArg??3), OX=+(oxArg??0), OY=+(oyArg??0);
const mem=fs.readFileSync(path.join(dir,"eeMemory.bin")), sc=g("sceneRead")(mem), col=g("sceneColors")(mem);
const light=g("sceneLight")(fs.readFileSync(path.join(dir,"vu1Memory.bin")),sc);
const bin=path.join(here,"disc/bin"), chars=fs.readdirSync(bin).filter(f=>/^OBJ_[A-Z]{3}\d\.CMP$/.test(f)).sort().map(f=>({name:f,models:g("objModels")(g("cricmpUnpack")(new Uint8Array(fs.readFileSync(path.join(bin,f)))))}));
const models={}; for(const p of [0,1]){ const c=g("sceneChooseModels")(sc,p,chars); models[p]=c&&c.map }
const hd=sc.draws.find(d=>d.player===pl&&d.id===headId); const C=[hd.m[9],hd.m[10],hd.m[11]], R=0.22;
// 頭の部品だけ
const mesh=g("sceneMesh")({...sc,draws:[hd]},col,models,{which:"body",stage:false,players:[pl===0,pl===1],light}), D=mesh.data, S=g("BUILD_STRIDE");
const tris=[]; for(let t=0;t<mesh.count;t+=3) tris.push({t:t/3,V:[0,1,2].map(k=>Array.from(D.subarray((t+k)*S,(t+k+1)*S)))});
const under=new Int32Array(800*800).fill(-1), dz=new Float32Array(800*800);
const W=800,H=800, px=new Uint8Array(W*H*3).fill(40), zb=new Float32Array(W*H).fill(Infinity), id=new Int32Array(W*H).fill(-1), tvs=new Int16Array(W*H).fill(-1);
const a=ANG*Math.PI/2*(process.env.DEG?+process.env.DEG/90/ANG:1), ca=Math.cos(a), sa=Math.sin(a), s2=W/(2*R*0.9)*ZM/3*3/ (ZM>0?1:1) *ZM/ZM;
const P=v=>{ const x=v[0]-C[0], y=v[1]-C[1], z=v[2]-C[2]; return [W/2+((x*ca+z*sa)*s2*ZM/3)+OX, H/2-y*s2*ZM/3+OY, -x*sa+z*ca] };
tris.forEach(({t,V},order)=>{
  const [a0,b,c]=V.map(P), d=(b[0]-a0[0])*(c[1]-a0[1])-(b[1]-a0[1])*(c[0]-a0[0]); if(Math.abs(d)<1e-9) return;
  const Lc=col.clut[V[0][17]*128+g("buildBright")([V[0][3],V[0][4],V[0][5]],[V[0][19],V[0][20],V[0][21],V[0][22]],light)], c5=[V[0][6],V[0][7],V[0][8]], tex=V[0][15]>.5;
  const x0=Math.max(0,Math.floor(Math.min(a0[0],b[0],c[0]))), x1=Math.min(W-1,Math.ceil(Math.max(a0[0],b[0],c[0])));
  const y0=Math.max(0,Math.floor(Math.min(a0[1],b[1],c[1]))), y1=Math.min(H-1,Math.ceil(Math.max(a0[1],b[1],c[1])));
  for(let y=y0;y<=y1;y++) for(let x=x0;x<=x1;x++){
    const qx=x+.5,qy=y+.5, w1=((qx-a0[0])*(c[1]-a0[1])-(qy-a0[1])*(c[0]-a0[0]))/d, w2=((b[0]-a0[0])*(qy-a0[1])-(b[1]-a0[1])*(qx-a0[0]))/d, w0=1-w1-w2;
    if(w0<0||w1<0||w2<0) continue; const z=w0*a0[2]+w1*b[2]+w2*c[2]-order*1e-7, i=y*W+x; if(z>=zb[i]) continue;   // 同じ部品はファイルの順に塗る
    let tv=-1;
    if(tex){ const lx=w0*V[0][9]+w1*V[1][9]+w2*V[2][9], ly=w0*V[0][10]+w1*V[1][10]+w2*V[2][10], sw=V[0][13], sh=V[0][14];
      tv=g("texRam")(col.tex,V[0][16],Math.floor(V[0][11]+((lx%sw)+sw)%sw),Math.floor(V[0][12]+((ly%sh)+sh)%sh)); if(V[0][15]>1.5&&tv===15) continue }
    if(id[i]>=0){ under[i]=id[i]; dz[i]=zb[i]-(z+order*1e-7) } zb[i]=z; id[i]=t; tvs[i]=tv; const l=g("buildLuma")(Lc,tv,V[0][23]%2>.5); for(let ch=0;ch<3;ch++) px[i*3+ch]=col.xlat[ch*0x800+c5[ch]*64+l];
  }
});
fs.writeFileSync(outp,pngEncode(W,H,px));
fs.writeFileSync(outp+".json",JSON.stringify({under:Array.from(under),dz:Array.from(dz).map(x=>+x.toFixed(5)),id:Array.from(id),tv:Array.from(tvs),tris:tris.map(({V})=>V.map(v=>v.map(x=>+x.toFixed(4))))}));
console.log(outp,"三角形",tris.length);
