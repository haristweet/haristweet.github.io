// 技の絵で確かめる（教訓1）: 写しの1人を、アーケードのプログラムで計算した姿勢に置き直して描き、並べる。
//   node motshot.mjs 写しのフォルダ 1P=0|2P=1 [技の番号 [コマ,…]] [out/motshot.png]
// 1枚目＝写しのまま、2枚目＝写しの技・コマを計算し直したもの（1枚目と同じになるはず）、3枚目から＝指定の技のコマ（無ければ写しの技の 1・¼・½・¾・最後）
// カメラは写しのまま。背景は描かない（影は床の高さに描く）
import fs from "fs"; import vm from "vm"; import path from "path"; import {pngEncode} from "./png.mjs";
const here=path.dirname(new URL(import.meta.url).pathname), ctx={console}; vm.createContext(ctx);
for(const f of ["cricmp.js","obj.js","tex.js","scene.js","build.js","arcade.js","ee.js","motion.js"]) vm.runInContext(fs.readFileSync(path.join(here,f),"utf8"),ctx);
const g=n=>vm.runInContext(n,ctx);
const args=process.argv.slice(2), dir=args[0], pl=+(args[1]||0);
const outp=args.find(a=>a.endsWith(".png"))||"out/motshot.png", rest=args.slice(2).filter(a=>!a.endsWith(".png"));
const mem=fs.readFileSync(path.join(dir,"eeMemory.bin"));
const sc=g("sceneRead")(mem), col=g("sceneColors")(mem), vu1p=path.join(dir,"vu1Memory.bin"), light=g("sceneLight")(fs.existsSync(vu1p)?fs.readFileSync(vu1p):null,sc);
const bin=path.join(here,"disc/bin"), load=re=>fs.readdirSync(bin).filter(f=>re.test(f)).sort().map(f=>({name:f,models:g("objModels")(g("cricmpUnpack")(new Uint8Array(fs.readFileSync(path.join(bin,f)))))}));
const chars=load(/^OBJ_[A-Z]{3}\d\.CMP$/);
const models={}; for(const p of [0,1]){ const c=g("sceneChooseModels")(sc,p,chars); models[p]=c&&c.map }
// i960 のプログラムはディスクの IC12_15（展開後）、main_data は写しに載っているページ（アーケードのロムがあればロム）
const prog=new Uint8Array(fs.readFileSync(path.join(bin,"IC12_15.dec")));
let md=null; if(process.env.ROM){ const files={}; for(const f of fs.readdirSync(path.join(here,"disc/arcade"))) if(!f.endsWith(".zip")&&!f.endsWith(".bin")) files[f]=new Uint8Array(fs.readFileSync(path.join(here,"disc/arcade",f)));
  const rom=g("arcRom")(files), half=k=>{ const c=rom.chips[k>>21][k&1], j=(k>>1)&0xfffff; return c[2*j]|c[2*j+1]<<8 }; md=o=>o<0x1000000?(half(o>>1)>>(8*(o&1)))&255:0 }
const E=g("motEngine")(prog,new Uint8Array(mem),md), info=E.info(pl);
const Us=[E.units(pl)]; for(const d of [1,2,3]){ const Ex=g("motEngine")(prog,new Uint8Array(mem),md); Us.push(Ex.frame(pl,Math.max(1,info.frame-d))) }
const att=g("motAttach")(sc,pl,Us,E.parts(pl)), U0=Us[2];
const m=rest[0]?+rest[0]:info.motion, len=E.motionLength(m);
const frames=rest[1]?rest[1].split(",").map(Number):[1,Math.round(len/4),Math.round(len/2),Math.round(len*3/4),len].filter(f=>f>=1);
const scenes=[{sc,label:"写し"}];
{ const E2=g("motEngine")(prog,new Uint8Array(mem),md), U=E2.frame(pl,info.frame); scenes.push({sc:g("motApply")(sc,att,U,E2.parts(pl)),U,label:"計算"}) }
E.start(pl,m); for(const f of frames){ const U=E.frame(pl,f); scenes.push({sc:g("motApply")(sc,att,U,E.parts(pl)),U,label:m+":"+f}) }
console.log("技",info.motion,"コマ",info.frame,"/",info.length," 付けた部品",att.parts.length,"（体",att.parts.filter(p=>p.body).length,"・影",att.parts.filter(p=>p.shadow).length,"）  描く技",m,"長さ",len,"コマ",frames.join(","));

// HAND=5 か 8: その関節の手に 5 倍で寄る（手の形の確かめ）
const W=320,H=240, Z=process.env.HAND?5:1, fx=sc.focal[0]*622/496/2*Z, fy=sc.focal[1]*412/384/2*Z;
function handCenter(s){ if(!process.env.HAND) return [W/2,H/2]; const k=+process.env.HAND, U=s.U||U0;
  const m=g("motMul")(U[k],att.V); return [W/2-fx*m[9]/m[11], H/2+fy*m[10]/m[11]] }
function render(s0){ const s=s0.sc||s0, [cx,cy]=handCenter(s0.sc?s0:{sc:s0});
  const px=new Uint8Array(W*H*3).fill(40), zb=new Float32Array(W*H).fill(Infinity), sh=new Uint8Array(W*H);
  for(const which of ["body","shadow"]){
    const mesh=g("sceneMesh")(s,col,models,{which,stage:false,light,players:[pl===0,pl===1]}), D=mesh.data, S=g("BUILD_STRIDE");
    for(let t=0;t<mesh.count;t+=3){
      const V=[0,1,2].map(k=>Array.from(D.subarray((t+k)*S,(t+k+1)*S))); if(V.some(v=>v[2]<0.05)) continue;
      const P=V.map(v=>[cx+fx*v[0]/v[2],cy-fy*v[1]/v[2],v[2]]), [a,b,c]=P, d=(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]); if(Math.abs(d)<1e-9) continue;
      const c5=[V[0][6],V[0][7],V[0][8]], Lc=col.clut[V[0][17]*128+g("buildBright")([V[0][3],V[0][4],V[0][5]],[V[0][19],V[0][20],V[0][21],V[0][22]],light)];
      const x0=Math.max(0,Math.floor(Math.min(a[0],b[0],c[0]))), x1=Math.min(W-1,Math.ceil(Math.max(a[0],b[0],c[0])));
      const y0=Math.max(0,Math.floor(Math.min(a[1],b[1],c[1]))), y1=Math.min(H-1,Math.ceil(Math.max(a[1],b[1],c[1])));
      for(let y=y0;y<=y1;y++) for(let x=x0;x<=x1;x++){
        const qx=x+.5, qy=y+.5, w1=((qx-a[0])*(c[1]-a[1])-(qy-a[1])*(c[0]-a[0]))/d, w2=((b[0]-a[0])*(qy-a[1])-(b[1]-a[1])*(qx-a[0]))/d, w0=1-w1-w2;
        if(w0<0||w1<0||w2<0) continue; const z=w0*a[2]+w1*b[2]+w2*c[2], i=y*W+x;
        if(which==="shadow"){ if(z<=zb[i]+1e-3) sh[i]=1; continue }
        if(z>=zb[i]) continue;
        let tv=-1;
        if(V[0][15]>.5){ const lx=w0*V[0][9]+w1*V[1][9]+w2*V[2][9], ly=w0*V[0][10]+w1*V[1][10]+w2*V[2][10], sw=V[0][13], shh=V[0][14];
          const tx=g("texRam")(col.tex,V[0][16],Math.floor(V[0][11]+((lx%sw)+sw)%sw),Math.floor(V[0][12]+((ly%shh)+shh)%shh)); if(V[0][15]>1.5&&tx===15) continue; tv=tx }
        zb[i]=z; const l=g("buildLuma")(Lc,tv,V[0][23]%2>.5);
        for(let ch=0;ch<3;ch++) px[i*3+ch]=col.xlat[ch*0x800+c5[ch]*64+l];
      }
    }
  }
  for(let i=0;i<W*H;i++) if(sh[i]&&zb[i]===Infinity) for(let ch=0;ch<3;ch++) px[i*3+ch]=20;
  return px;
}
const cols=Math.min(4,scenes.length), rows=Math.ceil(scenes.length/cols), out=new Uint8Array(W*cols*H*rows*3);
scenes.forEach((s,n)=>{ const px=render(s), ox=(n%cols)*W, oy=((n/cols)|0)*H;
  for(let y=0;y<H;y++) for(let x=0;x<W;x++) for(let k=0;k<3;k++) out[((oy+y)*W*cols+ox+x)*3+k]=px[(y*W+x)*3+k];
  // 枠の上の帯の色で何の絵か（1枚目 灰・2枚目 青・その後 橙）
  const bc=n===0?[160,160,160]:n===1?[80,140,220]:[230,150,60]; for(let y=0;y<3;y++) for(let x=0;x<W;x++) for(let k=0;k<3;k++) out[((oy+y)*W*cols+ox+x)*3+k]=bc[k];
});
fs.mkdirSync(path.dirname(outp),{recursive:true}); fs.writeFileSync(outp,pngEncode(W*cols,H*rows,out)); console.log(outp);
