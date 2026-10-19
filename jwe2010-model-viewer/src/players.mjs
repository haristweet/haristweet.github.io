// セーブ（data/sekiguchi.p2s）の選手の表から、顔＋髪の組を shot.mjs の引数の形で出す。node players.mjs 開始 人数
import fs from "fs"; import vm from "vm"; import path from "path";
const here=path.dirname(new URL(import.meta.url).pathname), ctx={TextDecoder,DecompressionStream,Blob,Response}; vm.createContext(ctx);
for(const f of ["fzstd.js","p2s.js"]) vm.runInContext(fs.readFileSync(path.join(here,f),"utf8"),ctx);
const [a=0,n=15]=process.argv.slice(2).map(Number), ps=ctx.jwPlayers(await ctx.jwP2sMemory(new Blob([fs.readFileSync(path.join(here,"data/sekiguchi.p2s"))])));
const d=i=>`data/${String(i).padStart(5,"0")}.bin`, has=p=>fs.existsSync(path.join(here,d(p.face)))&&fs.existsSync(path.join(here,d(p.hair)));
// 見本の無い選手は飛ばす（飛ばした選手は標準エラーに出す）
const sel=ps.slice(a,a+n);
console.log(sel.filter(has).map(p=>`${d(p.face)}+${d(p.hair)}`).join(" "));
console.error(sel.map(p=>`${p.i+1}.${p.name}${has(p)?"":`（見本なし #${p.face}/#${p.hair}）`}`).join(" "));
