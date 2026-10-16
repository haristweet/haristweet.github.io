// ユニフォームの絵（ページ 576,256・8 ビット）を、色の表を通して 256×256 の RGBA の PNG に書き出す（自分のユニフォームの下絵）。
//   node kitexport.mjs out/kit_16.png [TEX_xx] [着 0/1] [色の表の行 486（選手）/488（GK）]
// 色 0（PS1 の透明）は透明に。ページの「下絵を書き出す」と同じもの
import fs from "fs"; import vm from "vm"; import path from "path"; import {pngEncodeRGBA} from "./png.mjs";
const here=path.dirname(new URL(import.meta.url).pathname), ctx={}; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(here,"tex.js"),"utf8"),ctx);
const D=path.join(here,"disc/x/BIN"), [,,outp,texA,altA,rowA]=process.argv, alt=+(altA||0), row=+(rowA||486);
const v=ctx.weVramNew(); ctx.weTexLoad(v,new Uint8Array(fs.readFileSync(D+"/"+(texA||"TEX_16")+".BIN")),0x800f0000,new Set([...(alt?[2,3,7,8,10,11]:[0,1,7,8,9,11]),4,5]));
const px=new Uint8Array(256*256*4);
for(let y=0;y<256;y++) for(let x=0;x<256;x++){ const c=ctx.weTexel(v,153,row<<6,x,y), i=(y*256+x)*4; if(c){ px[i]=c[0]; px[i+1]=c[1]; px[i+2]=c[2]; px[i+3]=255 } }
fs.mkdirSync(path.dirname(outp),{recursive:true}); fs.writeFileSync(outp,pngEncodeRGBA(256,256,px)); console.log(outp);
