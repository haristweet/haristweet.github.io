// R3000 の逆アセンブル（tobal1 の mips.js を使う。GTE の命令も出る）。node dis.mjs ファイル 読み込み番地 始め [数]
import fs from "fs"; import vm from "vm";
const ctx={}; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(new URL("../../tobal1-model-viewer/src/mips.js",import.meta.url),"utf8")+";this.mipsDis=mipsDis",ctx);
const [,,f,b,a,n]=process.argv, d=fs.readFileSync(f), base=parseInt(b,16), at=parseInt(a,16);
for(let i=0;i<(+n||40);i++){ const pc=at+i*4, o=pc-base; if(o<0||o+4>d.length) break; const w=d.readUInt32LE(o);
  const s=ctx.mipsDis(w,pc); if(s!=="nop") console.log(pc.toString(16)+": "+s) }
