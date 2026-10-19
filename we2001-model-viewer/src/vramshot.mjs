// VRAM を絵にする（教訓1）。node vramshot.mjs out/vram.png ファイル[@番地] …
// ファイル名に :run を付けると DAT2D の形（先頭の番地が札の並び）で読む。16 ビットの色のまま描く（4/8 ビットの絵は色がつかず縞に見える）
import fs from "fs"; import vm from "vm"; import path from "path"; import {pngEncode} from "./png.mjs";
const here=path.dirname(new URL(import.meta.url).pathname), ctx={}; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(here,"tex.js"),"utf8"),ctx);
const [,,outp,...files]=process.argv, vram=ctx.weVramNew();
for(const a0 of files){ const run=a0.endsWith(":run"), a=a0.replace(/:run$/,""), [f,b]=a.split("@"), u8=new Uint8Array(fs.readFileSync(f)), B=b?parseInt(b,16):0x800f0000;
  const put=run?ctx.weTexLoadRun(vram,u8,B):ctx.weTexLoad(vram,u8,B);
  console.log(path.basename(f)); for(const p of put) console.log("  ",JSON.stringify(p)) }
const px=new Uint8Array(1024*512*3);
for(let i=0;i<1024*512;i++){ const c=vram[i]; px[i*3]=(c&31)<<3; px[i*3+1]=(c>>5&31)<<3; px[i*3+2]=(c>>10&31)<<3 }
fs.mkdirSync(path.dirname(outp),{recursive:true}); fs.writeFileSync(outp,pngEncode(1024,512,px));
