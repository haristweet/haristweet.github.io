// 入力を与えてゲームの 1 コマの処理を動かし、どの技が始まるかを見る（コマンド表の名前と技の番号を結び付けるため）。
//   node press.mjs 写し 1P=0|2P=1 [入力の並び（JSON。1 コマ 1 語、1＝P・2＝K・32＝G・4＝↑・16＝↓・64＝→・128＝←）…]
// 毎コマ: 入力をキャラの +0x1200 に置き 0x1d234（入力の処理）→ 0x12b58 から次に休む（call 0x1b0c）まで（キャラの 1 コマ）
import fs from "fs"; import vm from "vm"; import path from "path";
const here=path.dirname(new URL(import.meta.url).pathname), ctx={console}; vm.createContext(ctx);
for(const f of ["arcade.js","ee.js","motion.js"]) vm.runInContext(fs.readFileSync(path.join(here,f),"utf8"),ctx);
const g=n=>vm.runInContext(n,ctx), bin=f=>new Uint8Array(fs.readFileSync(path.join(here,"disc/bin",f)));
const prog=bin("ROM_CODE1.dec"), rom={data:bin("ROM_DATA.dec"),ep1:bin("ROM_EP1.dec"),ep2:bin("ROM_EP2.dec")};
const st=process.argv[2]||"grace1P_picky1P_round1", pl=+(process.argv[3]||0), mem=fs.readFileSync(path.join(here,"disc/states",st,"eeMemory.bin"));
// 1 コマ: 0x12b58 から、休む（call 0x1b0c）まで
function frame(E,pl){ const cpu=E.cpu, M=E.mem, G=E.g7(pl); class Y extends Error{};
  const R=cpu.r; R[1]=R[31]=0x5f8000; R[29]=G; R[28]=0x4000; R[27]=0x880000; R[26]=0x800000; R[30]=0;
  cpu.trace=pc=>{ if(pc===0x1b0c) throw new Y() };
  try{ cpu.run(0x12b58,2e7) }catch(e){ if(!(e instanceof Y)) throw e } finally{ cpu.trace=null }
}
const seqs=JSON.parse(process.argv[4]||'[[1],[2],[4],[8],[16],[32],[64],[128]]');
for(const seq of seqs){ const E=g("motEngine")(prog,mem,rom), M=E.mem, sh=pl*8; const log=[]; let err="";
  try{ for(let f=0;f<40;f++){ const cur=f<seq.length?seq[f]:0, prev=f>0&&f-1<seq.length?seq[f-1]:0;
      const G=E.g7(pl); M.w8(G+0x1200,cur); E.run(pl,[0x1d234],0);
      frame(E,pl); const i=E.info(pl); if(!log.length||log[log.length-1][1]!==i.motion) log.push([f,i.motion]) } }catch(e){ err=e.message }
  console.log(JSON.stringify(seq), log.map(([f,m])=>f+":"+m).join(" "), err, JSON.stringify(E.miss).slice(0,80)) }
