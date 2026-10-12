// 絵で確かめる台本（教訓1）。試合前の集合写真を、ゲームのカメラ（ENTER.BIN の場面 64）で描く。
//   node photo.mjs out/photo.png チーム [着 0/1] [GK 0/1] [カメラの進み 0〜100（0＝最初の斜め、100＝最後の正面）] [側 0/1（1＝2P 側）]
// 画面はゲームと同じく 512×240 に、奥行き 603 で投影し、4:3（640×480）に引き伸ばす（PS1 と同じ。縦横の補正はしない）
import fs from "fs"; import vm from "vm"; import path from "path"; import {pngEncode} from "./png.mjs";
const here=path.dirname(new URL(import.meta.url).pathname), ctx={TextDecoder}; vm.createContext(ctx);
for(const f of ["tmd.js","anim.js","raster.js","tex.js","look.js","photo.js"]) vm.runInContext(fs.readFileSync(path.join(here,f),"utf8"),ctx);
const X=path.join(here,"disc/x"), rd=f=>new Uint8Array(fs.readFileSync(path.join(X,f)));
const model=rd("BIN/MODEL.BIN"), enter=rd("ENTER.BIN"), sel=rd("SELECT.BIN"), exe=rd("SLPM_868.35"), dat2d=rd("BIN/DAT2D.BIN");
const [,,outp,teamA,altA,gkA,camA,sideA]=process.argv, side=+(sideA??0), team=+(teamA??1), alt=+(altA??0), gk=+(gkA??0), cam=+(camA??100);
const scene=ctx.wePhotoScene(model,enter,sel,exe,team,null,side);
const vram=ctx.weVramNew(); ctx.weTexLoadRun(vram,dat2d,0x800f0000,0); ctx.weTexLoadRun(vram,dat2d,0x800f0000,1);
ctx.weTexLoad(vram,rd("BIN/TEX_"+String(team).padStart(2,"0")+".BIN"),0x800f0000,new Set([...(alt?[2,3,7,8,10,11]:[0,1,7,8,9,11]),4+gk]));
for(const p of scene.players) if(p.num) ctx.weComposeNumber(vram,p.look.cell??10,p.num);
const C=ctx.wePhotoCamera(cam,side), W=640, H=480, R=ctx.rasterNew(W,H,[40,38,34]);
for(const p of scene.players) for(const pt of p.parts){ const t=ctx.tmdRead(model,pt.off); let k=0;
  for(const o of t.objs) for(const p0 of o.prims){ k++; if(!p0.uv) continue; const L=ctx.weLookPrim(p0,pt.part,k,p.look);
    const S=p0.v.map(i=>{ const w=ctx.weXform(pt.m,pt.t,o.verts[i]||[0,0,0]); const q=[w[0]+p.pos[0],w[1],w[2]+p.pos[2]], c=ctx.wePhotoView(C,q);
      return [(256+603*c[0]/c[2])*W/512,(120+603*c[1]/c[2])*H/240,c[2]] });
    if(S.some(s=>s[2]<10)) continue;
    const smp=(u,v)=>ctx.weTexel(vram,L.tsb,L.cba,Math.floor(u),Math.floor(v));
    for(let i=1;i+1<S.length;i++) ctx.rasterTriTex(R,S[0],S[i],S[i+1],L.uv[0],L.uv[i],L.uv[i+1],smp,127/128) } }
fs.mkdirSync(path.dirname(outp),{recursive:true}); fs.writeFileSync(outp,pngEncode(W,H,R.px));
console.log(outp, scene.players.map(p=>p.num+" "+p.name+" "+p.pose).join(" / "));
