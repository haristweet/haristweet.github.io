// out/cmdmap.json（node cmdmap.mjs の結果）から fvmoves.js の表の部分を作り直す。node fvmovesgen.mjs
// 番号ごとに、入力のいちばん短い技の名前を採る（PPK と ←＋K がどちらも 608 なら ←＋K）。表の後ろの関数（cmdStrings など）はそのまま残す
import fs from "fs"; import path from "path";
const here=path.dirname(new URL(import.meta.url).pathname), o=JSON.parse(fs.readFileSync(path.join(here,"out/cmdmap.json"),"utf8"));
const ID={JANE:0,GRACE:1,HONEY:2,TOKIO:3,BAHN:4,PICKY:5,RAXEL:6,SANMAN:7};
const len=c=>c.replace(/<X_20>/,"").replace(/<GFX_([^>]*)>/g,"$1").replace(/＋/g,"").length;
let s="const FV_MOVES={\n", tot=0;
for(const [ch,rows] of Object.entries(o)){ const best=new Map(); for(const q of rows){ if(q[1]==null) continue; const b=best.get(q[1]); if(!b||len(q[2])<len(b[2])) best.set(q[1],q) }
  const r=[...best.values()].sort((a,b)=>a[0]-b[0]); tot+=r.length; s+=`  ${ID[ch]}:["${ch}_CMND.FTS",[${r.map(q=>`[${q[0]},${q[1]}]`).join(",")}]],\n` }
s+="};\n";
const f=path.join(here,"fvmoves.js"), old=fs.readFileSync(f,"utf8"), a=old.indexOf("const FV_MOVES={"), b=old.indexOf("};\n",a)+3;
fs.writeFileSync(f,old.slice(0,a)+s+old.slice(b)); console.log("技",tot);
