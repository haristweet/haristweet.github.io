// VF2 と FV を 1 つの場面に（教訓1 の絵の道具）: VF2 の写しの 2P を、FV の写しのキャラに入れ替えて描く。
//   node crossshot.mjs [VF2 の写し] [FV の写し] [FV の 1P=0|2P=1] [VF2 1P の技] [FV の技] [コマの割合,…] [out/cross.png]
//   例: node crossshot.mjs 01_akira_lau bahn1P_honey1P_tower 0 108 727
// 置き方: FV の世界の座標を、y 軸まわりに回して動かし、FV のキャラの腰を VF2 の 2P の腰の所へ、FV で相手を向いていた向きを VF2 の 2P が 1P を向く向きに合わせる
// （VF2 と FV は同じ大きさの座標で床は y＝0）。カメラ・背景・光の向きは VF2 の写しのもの。色・テクスチャ・光の強さはそれぞれのゲームのもの
import fs from "fs"; import vm from "vm"; import path from "path"; import {pngEncode} from "./png.mjs";
const here=path.dirname(new URL(import.meta.url).pathname), FVD=path.join(here,"../../fv-model-viewer/src");
function load(dir,files){ const ctx={console,TextDecoder}; vm.createContext(ctx); for(const f of files) vm.runInContext(fs.readFileSync(path.join(dir,f),"utf8"),ctx); return n=>vm.runInContext(n,ctx) }
const A=load(here,["cricmp.js","obj.js","tex.js","scene.js","build.js","arcade.js","ee.js","motion.js"]);
const B=load(FVD,["cricmp.js","obj.js","tex.js","scene.js","build.js","arcade.js","ee.js","motion.js"]);
const [vst="01_akira_lau",fst="bahn1P_honey1P_tower",fplS="0",mAS,mBS,fracS="0,0.2,0.35,0.5,0.65,0.8",outp="out/cross.png"]=process.argv.slice(2), fpl=+fplS;
const mul=A("motMul"), inv=A("motInv"), invG=A("motInvG");

// ===== VF2: 1P（技を出す）と場面 =====
const vdir=path.join(here,"disc/states",vst), vmem=fs.readFileSync(path.join(vdir,"eeMemory.bin"));
const vsc=A("sceneRead")(vmem), vcol=A("sceneColors")(vmem), vvu=path.join(vdir,"vu1Memory.bin"), vlight=A("sceneLight")(fs.existsSync(vvu)?fs.readFileSync(vvu):null,vsc);
const vbin=path.join(here,"disc/bin"), vchars=fs.readdirSync(vbin).filter(f=>/^OBJ_[A-Z]{3}\d\.CMP$/.test(f)).sort().map(f=>({name:f,models:A("objModels")(A("cricmpUnpack")(new Uint8Array(fs.readFileSync(path.join(vbin,f)))))}));
const vmodels={0:A("sceneChooseModels")(vsc,0,vchars).map};
{ const st=vchars.map(c=>c).filter(c=>/STAGE/.test(c.name)); }
const vstage=fs.readdirSync(vbin).filter(f=>/^OBJ_STAGE\d+\.CMP$/.test(f)).map(f=>({name:f,m:new Map(A("objModels")(A("cricmpUnpack")(new Uint8Array(fs.readFileSync(path.join(vbin,f))))).map(e=>[e.id,e]))}))
  .map(s=>[s,vsc.draws.filter(d=>d.player===0&&!vmodels[0].has(d.id)&&s.m.has(d.id)).length]).sort((a,b)=>b[1]-a[1])[0][0];
vmodels.stage=vstage.m;
const vprog=new Uint8Array(fs.readFileSync(path.join(vbin,"IC12_15.dec")));
const EA=A("motEngine")(vprog,new Uint8Array(vmem),null), iA=EA.info(0);
const UsA=[EA.units(0)]; for(const d of [1,2,3]){ const Ex=A("motEngine")(vprog,new Uint8Array(vmem),null); UsA.push(Ex.frame(0,Math.max(1,iA.frame-d))) }
const attA=A("motAttach")(vsc,0,UsA,EA.parts(0)), V=attA.V;
const pA=EA.units(0)[0].slice(9), pL=EA.units(1)[0].slice(9);   // VF2 の 1P と 2P の腰（世界の座標）

// ===== FV: 入れ替えるキャラ =====
const fbin=f=>new Uint8Array(fs.readFileSync(path.join(FVD,"disc/bin",f))), fdir=path.join(FVD,"disc/states",fst), fmem=fs.readFileSync(path.join(fdir,"eeMemory.bin"));
const EB=B("motEngine")(fbin("ROM_CODE1.dec"),fmem,{data:fbin("ROM_DATA.dec"),ep1:fbin("ROM_EP1.dec"),ep2:fbin("ROM_EP2.dec")});
const fsc=B("motPickScene")(fmem,EB.units(1)).sc, fcol=B("sceneColors")(fmem), fvu=path.join(fdir,"vu1Memory.bin"), flight0=B("sceneLight")(fs.existsSync(fvu)?fs.readFileSync(fvu):null,fsc);
const floadM=f=>new Map(B("objModels")(B("cricmpUnpack")(fbin(f))).map(e=>[e.id,e]));
const fnames=fs.readdirSync(path.join(FVD,"disc/bin")).filter(f=>/^OBJ_ROB\d+\.CMP$/.test(f)), common=floadM("OBJ_COMMON.CMP");
const fids=fsc.draws.filter(d=>d.player===fpl).map(d=>d.id), ffile=fnames.map(f=>[f,floadM(f)]).map(([f,m])=>[f,m,fids.filter(i=>m.has(i)).length]).sort((a,b)=>b[2]-a[2])[0];
const fm=new Map(ffile[1]); { const r=ffile[0].replace(".CMP","R.CMP"); if(fs.existsSync(path.join(FVD,"disc/bin",r))) for(const [k,v] of floadM(r)) if(!fm.has(k)) fm.set(k,v) } for(const [k,v] of common) if(!fm.has(k)) fm.set(k,v);
const own=fm; B("sceneAssignCommon")(fsc,id=>common.has(id),(p,id)=>p===fpl&&own.has(id)&&!common.has(id));
const attB=B("motAttach")(fsc,fpl,[EB.units(fpl)],null,d=>d.dyn||own.has(d.id));
const pB=EB.units(fpl)[0].slice(9), pH=EB.units(1-fpl)[0].slice(9);   // FV のキャラと相手の腰
// FV の世界 → VF2 の世界: pB を原点へ → y 軸まわりに φ 回す → pL へ
const phi=Math.atan2(pA[2]-pL[2],pA[0]-pL[0])-Math.atan2(pH[2]-pB[2],pH[0]-pB[0]), c=Math.cos(phi), s=Math.sin(phi);
const T=mul(mul([1,0,0,0,1,0,0,0,1,-pB[0],0,-pB[2]],[c,0,s,0,1,0,-s,0,c,0,0,0]),[1,0,0,0,1,0,0,0,1,pL[0],0,pL[2]]);
const toV=m=>mul(mul(mul(m,invG(attB.V)),T),V);   // FV のカメラの座標 → VF2 のカメラの座標
// 光: 向きは VF2 の場面のもの（法線は VF2 のカメラの座標）、強さの表は FV のもの
const flight={...flight0,L:vlight.L};
console.log("VF2",vst,"1P 技",iA.motion,"→",mAS||"写しのまま","／FV",fst,fpl?"2P":"1P",ffile[0],"技",EB.info(fpl).motion,"→",mBS||"写しのまま","／回す角度",(phi*180/Math.PI).toFixed(1),"°");

// ===== コマごとに組んで描く =====
const PUSH=+(process.env.PUSH||0.6), W=640,H=480, fx=vsc.focal[0]*622/496, fy=vsc.focal[1]*412/384, fracs=fracS.split(",").map(Number);
const mA=mAS?+mAS:0, mB=mBS?+mBS:0, LA=mA?EA.motionLength(mA):0, LB=mB?EB.motionLength(mB):0;
if(mA) EA.start(0,mA); if(mB) EB.start(fpl,mB);
function frameScenes(fr){
  const UA=mA?EA.frame(0,Math.max(1,Math.round(fr*(LA-1))+1)):null, UB=mB?EB.frame(fpl,Math.max(1,Math.round(fr*(LB-1))+1)):EB.units(fpl);
  // 押し合い（仮）: ビューアには体の当たりが無く、前へ出る技ですれ違うので、腰の間（2 人を結ぶ向き）が PUSH より近いと押し戻す（ゲームの値ではない）
  const ua=(UA||EA.units(0))[0].slice(9), ub=mul([...UB[0].slice(0,9),...UB[0].slice(9)],T).slice(9), ax=[pL[0]-pA[0],pL[2]-pA[2]], al=Math.hypot(...ax), u=[ax[0]/al,ax[1]/al];
  // 分け方は cross.js の xPushShares と同じ（前へ出たほうが止まる）
  const sep=(ub[0]-ua[0])*u[0]+(ub[2]-ua[2])*u[1], ov=PUSH-sep, aA=Math.max(0,(ua[0]-pA[0])*u[0]+(ua[2]-pA[2])*u[1]), aB=Math.max(0,-((ub[0]-pL[0])*u[0]+(ub[2]-pL[2])*u[1])), t=aA+aB, use=Math.min(Math.max(ov,0),t), rest=Math.max(0,ov-use)/2;
  const shA=ov>0?(t>1e-6?use*aA/t:0)+rest:0, shB=ov>0?(t>1e-6?use*aB/t:0)+rest:0, move=d=>mul(mul(invG(V),[1,0,0,0,1,0,0,0,1,d*u[0],0,d*u[1]]),V);
  const MA=move(-shA), MB=move(shB);
  const sA0=UA?A("motApply")(vsc,attA,UA,EA.parts(0)):vsc, sA={...sA0,draws:sA0.draws.map(d=>d.player===0&&(d.dyn||vmodels[0].has(d.id))?{...d,m:mul(d.m,MA)}:d)};
  const vs={...sA,draws:sA.draws.filter(d=>d.player===0)};   // VF2 の 2P は消す（1P の表のステージは残る）
  const sB=B("motApply")(fsc,attB,UB,null);
  const fsB={...sB,draws:sB.draws.filter(d=>d.player===fpl&&(d.dyn||own.has(d.id))).map(d=>({...d,m:mul(toV(d.m),MB)}))};   // 人の番号はそのまま（2P の色は面の 2P 用の属性で付く）
  return [{g:A,sc:vs,col:vcol,models:vmodels,light:vlight,stage:true},{g:B,sc:fsB,col:fcol,models:{[fpl]:fm},light:flight,stage:false,players:[fpl===0,fpl===1]}];
}
function render(parts){
  const px=new Uint8Array(W*H*3).fill(40), zb=new Float32Array(W*H).fill(Infinity), sh=new Uint8Array(W*H);
  for(const which of ["body","shadow"]) for(const P of parts){ const g=P.g;
    const mesh=g("sceneMesh")(P.sc,P.col,P.models,{which,stage:P.stage,light:P.light,players:P.players||[true,false]}), D=mesh.data, S=g("BUILD_STRIDE");
    for(let t=0;t<mesh.count;t+=3){
      const Vv=[0,1,2].map(k=>Array.from(D.subarray((t+k)*S,(t+k+1)*S))); if(Vv.some(v=>v[2]<0.05)) continue;
      const Pp=Vv.map(v=>[W/2+fx*v[0]/v[2],H/2-fy*v[1]/v[2],v[2]]), [a,b,cc]=Pp, d=(b[0]-a[0])*(cc[1]-a[1])-(b[1]-a[1])*(cc[0]-a[0]); if(Math.abs(d)<1e-9) continue;
      if(Vv[0][23]>=1024&&d>0) continue;   // キャラの裏向きの面（build.js の 1024）
      const c5=[Vv[0][6],Vv[0][7],Vv[0][8]], Lc=P.col.clut[Vv[0][17]*128+g("buildBright")([Vv[0][3],Vv[0][4],Vv[0][5]],[Vv[0][19],Vv[0][20],Vv[0][21],Vv[0][22]],P.light)];
      const x0=Math.max(0,Math.floor(Math.min(a[0],b[0],cc[0]))), x1=Math.min(W-1,Math.ceil(Math.max(a[0],b[0],cc[0])));
      const y0=Math.max(0,Math.floor(Math.min(a[1],b[1],cc[1]))), y1=Math.min(H-1,Math.ceil(Math.max(a[1],b[1],cc[1])));
      for(let y=y0;y<=y1;y++) for(let x=x0;x<=x1;x++){
        const qx=x+.5, qy=y+.5, w1=((qx-a[0])*(cc[1]-a[1])-(qy-a[1])*(cc[0]-a[0]))/d, w2=((b[0]-a[0])*(qy-a[1])-(b[1]-a[1])*(qx-a[0]))/d, w0=1-w1-w2;
        if(w0<0||w1<0||w2<0) continue; const z=w0*a[2]+w1*b[2]+w2*cc[2], i=y*W+x;
        if(which==="shadow"){ if(z<=zb[i]+1e-3) sh[i]=1; continue }
        if(z>=zb[i]) continue;
        let tv=-1;
        if(Vv[0][15]>.5){ const lx=w0*Vv[0][9]+w1*Vv[1][9]+w2*Vv[2][9], ly=w0*Vv[0][10]+w1*Vv[1][10]+w2*Vv[2][10], sw=Vv[0][13], shh=Vv[0][14];
          const tx=g("texRam")(P.col.tex,Vv[0][16],Math.floor(Vv[0][11]+((lx%sw)+sw)%sw),Math.floor(Vv[0][12]+((ly%shh)+shh)%shh)); if(Vv[0][15]>1.5&&tx===15) continue; tv=tx }
        zb[i]=z; const l=g("buildLuma")(Lc,tv,Vv[0][23]%2>.5);
        for(let ch=0;ch<3;ch++) px[i*3+ch]=P.col.xlat[ch*0x800+c5[ch]*64+l];
      }
    }
  }
  for(let i=0;i<W*H;i++) if(sh[i]) for(let ch=0;ch<3;ch++) px[i*3+ch]=px[i*3+ch]*0.55;
  return px;
}
const cols=3, rows=Math.ceil(fracs.length/cols), out=new Uint8Array(W*cols*H*rows*3);
fracs.forEach((fr,n)=>{ const px=render(frameScenes(fr)), ox=(n%cols)*W, oy=((n/cols)|0)*H;
  for(let y=0;y<H;y++) for(let x=0;x<W;x++) for(let k=0;k<3;k++) out[((oy+y)*W*cols+ox+x)*3+k]=px[(y*W+x)*3+k] });
fs.mkdirSync(path.dirname(path.resolve(here,outp)),{recursive:true}); fs.writeFileSync(path.resolve(here,outp),pngEncode(W*cols,H*rows,out)); console.log(outp);
