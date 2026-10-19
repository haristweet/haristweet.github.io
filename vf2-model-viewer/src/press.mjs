// 入力を与えてゲームの 1 コマの処理を動かし、どの技が始まるかを見る（攻略本の技表の名前と技の番号を結び付けるため。FV の press.mjs と同じ作り）
//   node press.mjs 写し 1P=0|2P=1 [入力の並び（JSON。1 コマ 1 語）…]
// 毎コマ: 入力をキャラの +0x1200 に置き 0x1bac8（入力の処理。FV の 0x1d234）→ 0x14324（キャラの 1 コマ。FV の 0x12b58）から、
// 次のコマの続きの番地を置く所（0x142a8。FV は 0x1b0c）まで
import fs from "fs"; import vm from "vm"; import path from "path";
const here=path.dirname(new URL(import.meta.url).pathname), ctx={console}; vm.createContext(ctx);
for(const f of ["arcade.js","ee.js","motion.js"]) vm.runInContext(fs.readFileSync(path.join(here,f),"utf8"),ctx);
const g=n=>vm.runInContext(n,ctx), prog=new Uint8Array(fs.readFileSync(path.join(here,"disc/bin/IC12_15.dec")));
export const VF2IN={input:0x1bac8, body:0x14324, end:0x142a8, after:0x1645c};
export function vf2Frame(E,pl){ const cpu=E.cpu, G=E.mem.r32(pl?0x500808:0x500804), G8=E.mem.r32(pl?0x500804:0x500808); class Y extends Error{};
  const R=cpu.r; R[1]=R[31]=0x5f8000; R[29]=G; R[23]=G; R[24]=G8; R[28]=0x4000; R[27]=0x880000; R[26]=0x800000; R[30]=0;
  cpu.trace=pc=>{ if(pc===VF2IN.end) throw new Y() };
  try{ cpu.run(VF2IN.body,2e7) }catch(e){ if(!(e instanceof Y)) throw e } finally{ cpu.trace=null } }
export function vf2Step(E,pl,bits){ const G=E.mem.r32(pl?0x500808:0x500804); E.mem.w8(G+0x1200,bits); const cpu=E.cpu, R=cpu.r; R[1]=R[31]=0x5f8000; R[23]=R[29]=G; R[24]=E.mem.r32(pl?0x500804:0x500808); R[26]=0x800000; R[27]=0x880000; R[28]=0x4000; R[30]=0; cpu.run(VF2IN.input,2e7); vf2Frame(E,pl);
  // 2 人の間の処理（0x1645c: 押し合い 0x18144 と、相手との距離 +0x5f4・向きなどを 0x18644 で求める。投げの「近い」はこの距離で決まる）
  R[1]=R[31]=0x5f8000; R[26]=0x800000; R[27]=0x880000; R[28]=0x4000; cpu.run(VF2IN.after,2e7) }
if(process.argv[1]&&process.argv[1].endsWith("press.mjs")){
  const st=process.argv[2]||"16_jacky_jacky_gg", pl=+(process.argv[3]||0), mem=fs.readFileSync(path.join(here,"disc/states",st,"eeMemory.bin"));
  const seqs=JSON.parse(process.argv[4]||'[[1],[2],[4],[8],[16],[32],[64],[128]]');
  // 技のコマンドの表などは main_data（0x2000000〜）にあり、写しに載っていないページもある。アーケードのロム（disc/arcade/）があればそこから読む
  let md=null; if(!process.env.NOARC&&fs.existsSync(path.join(here,"disc/arcade"))){ const files={}; for(const f of fs.readdirSync(path.join(here,"disc/arcade"))) if(!/\.(zip|bin)$/.test(f)) files[f]=new Uint8Array(fs.readFileSync(path.join(here,"disc/arcade",f))); md=g("motRomData")(g("arcRom")(files)) }
  for(const seq of seqs){ const E=g("motEngine")(prog,mem,md), log=[]; let err="";
    try{ for(let f=0;f<40;f++){ vf2Step(E,pl,f<seq.length?seq[f]:0); const i=E.info(pl); if(!log.length||log[log.length-1][1]!==i.motion) log.push([f,i.motion]) } }catch(e){ err=e.message }
    console.log(JSON.stringify(seq), log.map(([f,m])=>f+":"+m).join(" "), err) }
}
