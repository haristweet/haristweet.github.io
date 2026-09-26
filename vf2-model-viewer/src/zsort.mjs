// 重なりの決め方を、ゲームが描いた画面（ソフトウェア描画のセーブステートの GS.bin）と画素ごとに比べる。
//   node zsort.mjs disc/states/14_jeffrytest2 [out/zsort.png]
// GS.bin: 頭 0x1a9 バイトの後ろに GS のメモリ 4MB。画面は PSMCT32・幅 512（FBW=8）で FBP 0 と 0x80 の2枚（交互に描く2コマ）。
// このゲームは奥行きの表（Zバッファ）を使わず、面を並べて奥から塗る（MODEL2 と同じ）。どう並べるかの候補を数字で比べる
import fs from "fs"; import vm from "vm"; import path from "path"; import {pngEncode} from "./png.mjs";
const here=path.dirname(new URL(import.meta.url).pathname), ctx={console}; vm.createContext(ctx);
for(const f of ["cricmp.js","obj.js","tex.js","scene.js","build.js"]) vm.runInContext(fs.readFileSync(path.join(here,f),"utf8"),ctx);
const g=n=>vm.runInContext(n,ctx);
const [,,dir,outp]=process.argv, mem=fs.readFileSync(path.join(dir,"eeMemory.bin"));
const sc=g("sceneRead")(mem), col=g("sceneColors")(mem), light=g("sceneLight")(fs.readFileSync(path.join(dir,"vu1Memory.bin")),sc);
const bin=path.join(here,"disc/bin"), load=re=>fs.readdirSync(bin).filter(f=>re.test(f)).sort().map(f=>({name:f,models:g("objModels")(g("cricmpUnpack")(new Uint8Array(fs.readFileSync(path.join(bin,f)))))}));
const chars=load(/^OBJ_[A-Z]{3}\d\.CMP$/), stages=load(/^OBJ_STAGE\d+\.CMP$/);
const models={}; for(const p of [0,1]){ const c=g("sceneChooseModels")(sc,p,chars); models[p]=c&&c.map }
const st=g("sceneChooseModels")(sc,0,stages,models[0]?new Set(models[0].keys()):null); models.stage=st&&st.map;

// ゲームの画面（GS のメモリ）
const B32=[[0,1,4,5,16,17,20,21],[2,3,6,7,18,19,22,23],[8,9,12,13,24,25,28,29],[10,11,14,15,26,27,30,31]];
const C32=[[0,1,4,5,8,9,12,13],[2,3,6,7,10,11,14,15],[16,17,20,21,24,25,28,29],[18,19,22,23,26,27,30,31],[32,33,36,37,40,41,44,45],[34,35,38,39,42,43,46,47],[48,49,52,53,56,57,60,61],[50,51,54,55,58,59,62,63]];
const a32=(bp,x,y)=>((bp+((y>>5)*8+(x>>6))*32+B32[(y>>3)&3][(x>>3)&7])*64+C32[y&7][x&7]);
const gsb=fs.readFileSync(path.join(dir,"GS.bin")), gsu=new Uint32Array(gsb.buffer.slice(gsb.byteOffset+0x1a9,gsb.byteOffset+0x1a9+(4<<20)));
const W=512,H=448, frames=[0,0x80*32].map(bp=>{ const f=new Uint8Array(W*H*3); for(let y=0;y<H;y++) for(let x=0;x<W;x++){ const v=gsu[a32(bp,x,y)], o=(y*W+x)*3; f[o]=v&255; f[o+1]=v>>8&255; f[o+2]=v>>16&255 } return f });

// 三角形（面の番号・部品の番号つき）。手前 0.05 で切る
// キャラとステージを分けて作り（ステージは裏向きも描く）、つなげる
const S=g("BUILD_STRIDE"); const partOf=[], partZ=[];
const mC=(()=>{ const parts=[]; let n=0; for(const d of sc.draws){ const m=g("sceneMesh")({...sc,draws:[d]},col,models,{which:"body",stage:false,light}); if(!m.count) continue; parts.push(m); for(let k=0;k<m.count;k++) partOf.push(partZ.length); partZ.push(d.m[11]); n+=m.data.length }
  const data=new Float32Array(n); let o=0; for(const m of parts){ data.set(m.data,o); o+=m.data.length } return {data,count:n/S} })(), mS=g("sceneMesh")(sc,col,models,{which:"body",stage:true,players:[false,false],light});
const D=new Float32Array(mC.data.length+mS.data.length); D.set(mC.data); D.set(mS.data,mC.data.length); const mesh={count:mC.count+mS.count}, NC=mC.count;
function tris(OX,OY){
  const out=[]; let part=-1, lastM=null, poly=-1, lastKey="";
  for(let t=0;t<mesh.count;t+=3){
    const V0=[0,1,2].map(k=>Array.from(D.subarray((t+k)*S,(t+k+1)*S)));
    let pl=V0; if(pl.some(v=>v[2]<0.05)){ const o=[]; for(let i=0;i<3;i++){ const A=pl[i],B=pl[(i+1)%3],ia=A[2]>=0.05,ib=B[2]>=0.05; if(ia) o.push(A); if(ia!==ib){ const k=(0.05-A[2])/(B[2]-A[2]); o.push(A.map((x,j)=>x+(B[j]-x)*k)) } } pl=o; if(pl.length<3) continue }
    for(let i=1;i+1<pl.length;i++) out.push({V:[pl[0],pl[i],pl[i+1]],t,orig:V0,ch:t<NC,part:t<NC?partOf[t]:-1});
  }
  return out.map(o=>({...o,P:o.V.map(v=>[OX+248+600*v[0]/v[2],OY+192-600*v[1]/v[2],v[2]])}));
}
// 面（四角は2つの三角形）ごとのまとまり: 同じ法線・同じ属性で続く三角形を1つの面とみなすのは不確かなので、build.js の並び（四角→2三角）を使う
let LASTSH=null, REC=null;
function shade(o,w0,w1,w2){
  const V=o.V, c5=[V[0][6],V[0][7],V[0][8]], tex=V[0][15]>.5, Lc=col.clut[V[0][17]*128+g("buildBright")((o.ch||!process.env.FLIPST)?[V[0][3],V[0][4],V[0][5]]:[-V[0][3],-V[0][4],-V[0][5]],[V[0][19],V[0][20],V[0][21],V[0][22]],light)];
  let tv=-1; if(tex){ const lx=w0*V[0][9]+w1*V[1][9]+w2*V[2][9], ly=w0*V[0][10]+w1*V[1][10]+w2*V[2][10], sw=V[0][13], sh=V[0][14];
    if(process.env.BILIN){ // 4つのテクセルの重み付き平均（GS のバイリニア）。値 15 の透明は最寄りのテクセルで決める
      const T=(X,Y)=>g("texRam")(col.tex,V[0][16],Math.floor(V[0][11]+(((X%sw)+sw)%sw)),Math.floor(V[0][12]+(((Y%sh)+sh)%sh)));
      if(V[0][15]>1.5&&T(Math.floor(lx),Math.floor(ly))===15) return null;
      const fx=lx-0.5, fy=ly-0.5, x0=Math.floor(fx), y0=Math.floor(fy), ax=fx-x0, ay=fy-y0;
      tv=(1-ax)*(1-ay)*T(x0,y0)+ax*(1-ay)*T(x0+1,y0)+(1-ax)*ay*T(x0,y0+1)+ax*ay*T(x0+1,y0+1) }
    else { tv=g("texRam")(col.tex,V[0][16],Math.floor(V[0][11]+((lx%sw)+sw)%sw),Math.floor(V[0][12]+((ly%sh)+sh)%sh)); if(V[0][15]>1.5&&tv===15) return null } }
  const l=Math.round(g("buildLuma")(Lc,tv,V[0][23]%2>.5)); LASTSH=[Lc,tv,V[0][23]%2>.5?1:0,c5,l,V[0][19]+"/"+V[0][20]]; return [0,1,2].map(ch=>col.xlat[ch*0x800+c5[ch]*64+l]);
}
// mode: "pixel"＝画素ごとの奥行き、それ以外は並べて奥から塗る（key: 三角形の頂点の奥行きの min/max/avg、cull: 裏向きを描かない）
function render(T,mode,key,cull){
  const px=new Uint8Array(W*H*3), cov=new Uint8Array(W*H), zb=new Float32Array(W*H).fill(Infinity);
  let list=T;
  if(mode!=="pixel"){ const kz=o=>{ const z=o.orig.map(v=>v[2]); return key==="min"?Math.min(...z):key==="max"?Math.max(...z):(z[0]+z[1]+z[2])/3 };
    if(key.startsWith("part")){ // 部品ごとの値で並べ、部品の中はファイルの順
      const pk={}; for(const o of T){ if(o.part<0) continue; const z=o.orig.map(v=>v[2]); const e=pk[o.part]||(pk[o.part]={mn:Infinity,mx:-Infinity}); e.mn=Math.min(e.mn,...z); e.mx=Math.max(e.mx,...z) }
      const k2=o=>o.part<0?kz(o):key==="part-org"?partZ[o.part]:key==="part-min"?pk[o.part].mn:pk[o.part].mx;
      list=T.map((o,i)=>({o,i,k:k2(o)})).sort((a,b)=>b.k-a.k||a.i-b.i).map(e=>e.o) }
    else list=T.map((o,i)=>({o,i,k:kz(o)})).sort((a,b)=>b.k-a.k||a.i-b.i).map(e=>e.o) }
  for(const o of list){
    const [a,b,c]=o.P, d=(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]); if(Math.abs(d)<1e-9) continue;
    if(cull&&o.ch){ const n=[o.V[0][3],o.V[0][4],o.V[0][5]]; if(n[0]*o.V[0][0]+n[1]*o.V[0][1]+n[2]*o.V[0][2]<0) continue }
    const x0=Math.max(0,Math.floor(Math.min(a[0],b[0],c[0]))), x1=Math.min(W-1,Math.ceil(Math.max(a[0],b[0],c[0])));
    const y0=Math.max(0,Math.floor(Math.min(a[1],b[1],c[1]))), y1=Math.min(H-1,Math.ceil(Math.max(a[1],b[1],c[1])));
    for(let y=y0;y<=y1;y++) for(let x=x0;x<=x1;x++){
      const qx=x+.5,qy=y+.5, w1=((qx-a[0])*(c[1]-a[1])-(qy-a[1])*(c[0]-a[0]))/d, w2=((b[0]-a[0])*(qy-a[1])-(b[1]-a[1])*(qx-a[0]))/d, w0=1-w1-w2;
      if(w0<0||w1<0||w2<0) continue; const i=y*W+x;
      // テクスチャは奥行きを考えて（1/z で重みを付けて）引く
      const p0=w0/a[2], p1=w1/b[2], p2=w2/c[2], ps=p0+p1+p2, u0=p0/ps, u1=p1/ps, u2=p2/ps;
      if(mode==="pixel"){ const z=w0*a[2]+w1*b[2]+w2*c[2]; if(z>=zb[i]) continue; const s=shade(o,u0,u1,u2); if(!s) continue; zb[i]=z; px.set(s,i*3); cov[i]=1; if(REC) REC[i]=LASTSH.concat([z]) }
      else { const s=shade(o,u0,u1,u2); if(!s) continue; px.set(s,i*3); cov[i]=1 }
    }
  }
  return {px,cov};
}
const err=(r,f,mask)=>{ let e=0,n=0; for(let i=0;i<W*H;i++){ if(!r.cov[i]||(mask&&!mask[i])) continue; e+=Math.abs(r.px[i*3]-f[i*3])+Math.abs(r.px[i*3+1]-f[i*3+1])+Math.abs(r.px[i*3+2]-f[i*3+2]); n++ } return n?e/n/3:0 };
// 画面の中の位置（MODEL2 の 496×384 がどこにあるか）と、どちらのコマかを、画素ごとの奥行きの絵で合わせる
let best=process.env.POS?(([OX,OY,fi])=>({e:0,OX,OY,fi}))(process.env.POS.split(",").map(Number)):null; if(!best) for(const fi of [0,1]) for(let OX=4;OX<=12;OX+=2) for(let OY=24;OY<=40;OY+=2){ const T=tris(OX,OY), r=render(T,"pixel"), e=err(r,frames[fi]); if(!best||e<best.e) best={e,OX,OY,fi} }
console.log("位置",best.OX,best.OY,"コマ",best.fi,"画素ごとの奥行きでのずれ",best.e.toFixed(2));
const T=tris(best.OX,best.OY), F=frames[best.fi], base=render(T,"pixel");
if(process.env.REC){ REC=new Array(W*H); render(T,"pixel"); const out=[];
  for(let i=0;i<W*H;i++){ const r=REC[i]; if(!r) continue; const f=[F[i*3],F[i*3+1],F[i*3+2]];
    let best=[1e9,0]; for(let l=0;l<64;l++){ const q=[0,1,2].map(ch=>col.xlat[ch*0x800+r[3][ch]*64+l]); const e=Math.abs(q[0]-f[0])+Math.abs(q[1]-f[1])+Math.abs(q[2]-f[2]); if(e<best[0]) best=[e,l] }
    const pc=[0,1,2].map(ch=>col.xlat[ch*0x800+r[3][ch]*64+r[4]]); out.push([r[0],r[1],r[2],r[4],best[1],best[0],r[5],Math.abs(pc[0]-f[0])+Math.abs(pc[1]-f[1])+Math.abs(pc[2]-f[2]),i,pc,f,r[6]]) }
  fs.writeFileSync(process.env.REC,JSON.stringify(out)); console.log("記録",out.length); process.exit(0) }
const variants=[["pixel",null,false]]; for(const key of ["max","part-org","part-min","part-max"]) for(const cull of [false,true]) variants.push(["sort",key,cull]);
const rs=variants.map(([m,k,c])=>render(T,m,k,c));
// 候補どうしで色が食い違う画素だけで比べる（床の明るさなど、重なりと関係ないずれを除く）
const dis=new Uint8Array(W*H); for(let i=0;i<W*H;i++){ for(let v=1;v<rs.length;v++){ const A=rs[0],B=rs[v]; if(A.cov[i]!==B.cov[i]||A.px[i*3]!==B.px[i*3]||A.px[i*3+1]!==B.px[i*3+1]||A.px[i*3+2]!==B.px[i*3+2]){ dis[i]=1; break } } }
// キャラの画素（画素ごとの奥行きの絵でキャラが勝った所）に限る
const chm=render(T.filter(o=>o.ch),"pixel").cov; for(let i=0;i<W*H;i++) if(!chm[i]) dis[i]=0;
let nd=0; for(const v of dis) nd+=v; console.log("食い違う画素",nd);
variants.forEach(([m,k,c],v)=>console.log((m+(k?"/"+k:"")+(c?"/裏なし":"")).padEnd(16),"全体",err(rs[v],F).toFixed(2),"食い違う所",err(rs[v],F,dis).toFixed(2)));
if(outp){ // 画素ごと・max・max/裏なし・ゲーム を並べる
  const pick=[0,3,4], im=new Uint8Array(W*4*H*3);
  for(let y=0;y<H;y++) for(let x=0;x<W;x++){ const i=y*W+x; pick.forEach((v,j)=>im.set(rs[v].cov[i]?rs[v].px.subarray(i*3,i*3+3):[40,38,34],(y*W*4+j*W+x)*3)); im.set(F.subarray(i*3,i*3+3),(y*W*4+3*W+x)*3) }
  fs.writeFileSync(outp,pngEncode(W*4,H,im)) }
