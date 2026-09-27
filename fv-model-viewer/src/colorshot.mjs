// 写しの1コマを、VF2 と同じ色の付け方（scene.js の色・build.js の明るさ・tex.js のテクスチャ）で描いて、ゲームの写真と並べる（教訓1）。
//   node colorshot.mjs disc/states/grace1P_picky1P_round1 out/color.png   （BUF=12c0000 で読む命令の列を選ぶ。ARC=1 でアーケードのテクスチャ）
// ARC=1: ディスクの ROM_CODE1・ROM_DATA からアーケードのテクスチャを展開して引く（fvarc.js）。キャラ OBJ_ROBnn はセット 2n+1・2n+2（2P の色 nn≥13 は nn−13）、
//   2P はページを入れ替えて読む。ステージ OBJ_STGnn はセット 18＋n（PS2 のテクスチャ用メモリと 100% 一致で確かめた）
// 左＝組んだ絵（影は半分の暗さ）、右＝写真
import fs from "fs"; import vm from "vm"; import path from "path"; import {pngEncode,pngDecode} from "./png.mjs";
const here=path.dirname(new URL(import.meta.url).pathname), ctx={console}; vm.createContext(ctx);
for(const f of ["cricmp.js","obj.js","tex.js","scene.js","build.js","arcade.js","fvarc.js"]) vm.runInContext(fs.readFileSync(path.join(here,f),"utf8"),ctx);
const g=n=>vm.runInContext(n,ctx);
const [,,dir,outp="out/color.png"]=process.argv, mem=fs.readFileSync(path.join(dir,"eeMemory.bin"));
const sc=g("sceneRead")(mem,process.env.BUF?parseInt(process.env.BUF,16):undefined), col=g("sceneColors")(mem);
if(process.env.SKIP){ const sk=process.env.SKIP.split(",").map(Number); sc.draws=sc.draws.filter(d=>!sk.includes(d.id)) }   // 調べ用: SKIP=番号,… の部品を描かない
const vu1p=path.join(dir,"vu1Memory.bin"), light=g("sceneLight")(fs.existsSync(vu1p)?fs.readFileSync(vu1p):null,sc);
// モデル: 人ごとに、描いた番号をいちばん多く含む OBJ_ROBnn（＋同じ番号の R・共通 OBJ_COMMON）。背景は OBJ_STGnn
const bin=path.join(here,"disc/bin"), load=f=>new Map(g("objModels")(g("cricmpUnpack")(new Uint8Array(fs.readFileSync(path.join(bin,f))))).map(e=>[e.id,e]));
const names=fs.readdirSync(bin).filter(f=>/^OBJ_(ROB\d+R?|STG\d+R?|COMMON)\.CMP$/.test(f)).sort(), files=Object.fromEntries(names.map(f=>[f,load(f)]));
const best=(ids,re)=>names.filter(f=>re.test(f)).map(f=>[f,ids.filter(i=>files[f].has(i)).length]).sort((a,b)=>b[1]-a[1])[0];
const models={}, used=[];
for(const p of [0,1]){ const ids=sc.draws.filter(d=>d.player===p).map(d=>d.id), [f]=best(ids,/^OBJ_ROB\d+\.CMP$/), m=new Map(files[f]); used.push(f);
  const r=f.replace(".CMP","R.CMP"); if(files[r]) for(const [k,v] of files[r]) if(!m.has(k)) m.set(k,v);
  for(const [k,v] of files["OBJ_COMMON.CMP"]) if(!m.has(k)) m.set(k,v); models[p]=m }
{ const ids=sc.draws.filter(d=>d.player===0&&!models[0].has(d.id)).map(d=>d.id), b=best(ids,/^OBJ_STG\d+R?\.CMP$/); if(b&&b[1]){ models.stage=files[b[0]]; used.push(b[0]) } }
let arc=null;
if(process.env.ARC){ const L=g("fvArcLoader")(new Uint8Array(fs.readFileSync(path.join(bin,"ROM_CODE1.dec"))),new Uint8Array(fs.readFileSync(path.join(bin,"ROM_DATA.dec"))));
  L.loadSet(36,0);
  used.slice(0,2).forEach((f,pl)=>{ let n=+f.match(/ROB(\d+)/)[1]; if(n>=13) n-=13; L.loadSet(2*n+1,pl); L.loadSet(2*n+2,pl) });
  if(used[2]){ const n=+used[2].match(/STG(\d+)/)[1]; L.loadSet(18+n,0) }
  arc=(p,ay,ax)=>{ ax=Math.floor(ax)&1023; ay=Math.floor(ay)&2047; let w=L.tex[p][(ay>>1)*512+(ax>>1)]; if(!(ay&1)) w>>=8; if(!(ax&1)) w>>=4; return w&15 } }
const CULL=+(process.env.CULL||-1), W=640,H=480, fx=sc.focal[0]*622/496, fy=sc.focal[1]*412/384;
function render(which){
  const mesh=g("sceneMesh")(sc,col,models,{which,stage:true,light}), D=mesh.data, S=g("BUILD_STRIDE");
  const px=new Float32Array(W*H*4), zb=new Float32Array(W*H).fill(Infinity), tris=[];
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
    if(V[0][23]>=1024&&CULL*d<0) continue;   // キャラの裏向きの面（build.js の 1024）。CULL＝向き（画面の上の頂点の回り方の符号）
    const c5=[V[0][6],V[0][7],V[0][8]], tex=V[0][15]>.5, Lc=col.clut[V[0][17]*128+g("buildBright")([V[0][3],V[0][4],V[0][5]],[V[0][19],V[0][20],V[0][21],V[0][22]],light)];
    const x0=Math.max(0,Math.floor(Math.min(a[0],b[0],c[0]))), x1=Math.min(W-1,Math.ceil(Math.max(a[0],b[0],c[0])));
    const y0=Math.max(0,Math.floor(Math.min(a[1],b[1],c[1]))), y1=Math.min(H-1,Math.ceil(Math.max(a[1],b[1],c[1])));
    for(let y=y0;y<=y1;y++) for(let x=x0;x<=x1;x++){
      const qx=x+.5, qy=y+.5, w1=((qx-a[0])*(c[1]-a[1])-(qy-a[1])*(c[0]-a[0]))/d, w2=((b[0]-a[0])*(qy-a[1])-(b[1]-a[1])*(qx-a[0]))/d, w0=1-w1-w2;
      if(w0<0||w1<0||w2<0) continue; const z=w0*a[2]+w1*b[2]+w2*c[2], i=y*W+x; if(z>=zb[i]) continue;
      let tv=-1;
      if(tex){ const lx=w0*V[0][9]+w1*V[1][9]+w2*V[2][9], ly=w0*V[0][10]+w1*V[1][10]+w2*V[2][10], sw=V[0][13], sh=V[0][14];
        const X=Math.floor(V[0][11]+((lx%sw)+sw)%sw), Y=Math.floor(V[0][12]+((ly%sh)+sh)%sh); const tx=arc?arc(V[0][16],X,Y):g("texRam")(col.tex,V[0][16],X,Y); if(V[0][15]>1.5&&tx===15) continue; tv=tx }
      zb[i]=z; const l=g("buildLuma")(Lc,tv,V[0][23]%2>.5);
      for(let ch=0;ch<3;ch++) px[i*4+ch]=col.xlat[ch*0x800+c5[ch]*64+l]; px[i*4+3]=1;
    }
  }
  return {px,zb};
}
const body=render("body"), shadow=render("shadow");
const shot=pngDecode(fs.readFileSync(path.join(dir,"Screenshot.png"))), sc3=shot.px.length/(shot.W*shot.H), out=new Uint8Array(W*2*H*3);
for(let y=0;y<H;y++) for(let x=0;x<W;x++){
  const i=y*W+x, o=(y*W*2+x)*3, o2=(y*W*2+W+x)*3, s=(y*shot.W+x)*sc3;
  let c=body.px[i*4+3]?[body.px[i*4],body.px[i*4+1],body.px[i*4+2]]:[40,38,34];
  if(shadow.px[i*4+3]&&shadow.zb[i]<=body.zb[i]+1e-3) c=c.map(v=>v*0.55);
  for(let k=0;k<3;k++){ out[o+k]=c[k]; out[o2+k]=shot.px[s+k] }
}
fs.mkdirSync(path.dirname(outp),{recursive:true}); fs.writeFileSync(outp,pngEncode(W*2,H,out));
console.log(outp,"部品",sc.draws.length,"使ったファイル",used.join(" "),"光",light.fromVu?"VU1":"なし");
