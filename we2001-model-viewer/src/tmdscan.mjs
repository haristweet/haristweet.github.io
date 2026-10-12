// ファイルの中の TMD を全部探して、部品数・頂点数・読めなかった部品の数を出す。node tmdscan.mjs ファイル…
import fs from "fs"; import vm from "vm"; import path from "path";
const here=path.dirname(new URL(import.meta.url).pathname), ctx={}; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(here,"tmd.js"),"utf8"),ctx);
export function tmdFind(u8){
  const out=[];
  for(let o=0;o+40<=u8.length;o+=4){
    if(u8[o]!==0x41||u8[o+1]|u8[o+2]|u8[o+3]) continue;
    const n=u8[o+8]|u8[o+9]<<8; if(n<1||n>64||(u8[o+10]|u8[o+11])) continue;
    try{ const t=ctx.tmdRead(u8,o); if(t&&t.objs.every(b=>b.verts.length>0&&b.verts.length<5000)) out.push({off:o,t}) }catch(e){}
  }
  return out;
}
if(process.argv[1].endsWith("tmdscan.mjs")) for(const f of process.argv.slice(2)){
  const u8=new Uint8Array(fs.readFileSync(f)), L=tmdFind(u8);
  const bad=L.reduce((s,x)=>s+x.t.objs.reduce((a,b)=>a+b.bad,0),0), np=L.reduce((s,x)=>s+x.t.objs.reduce((a,b)=>a+b.prims.length,0),0);
  if(L.length) console.log(path.basename(f), "TMD", L.length, "面", np, "読めない", bad, "モード", [...new Set(L.flatMap(x=>x.t.objs.flatMap(b=>b.prims.map(p=>p.mode.toString(16)+"/"+p.flag))))].join(" "));
}
