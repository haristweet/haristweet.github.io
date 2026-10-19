// 攻略本の技表（書き起こしたテキスト。リポジトリに入れない）の技を、ゲームの 1 コマの処理に入力を与えて出させ、技の番号を集める（FV の cmdmap.mjs と同じ作り。入力の入れ方は press.mjs）
//   node cmdmap.mjs 書き起こしのフォルダ [キャラ…]   → out/cmdmap.json と一覧
// 書き起こし 1 行: 番号|技名|読み|コマンド|発生-持続|硬化|種類（コマンド: r→ l← u↑ d↓ x↘ z↙ a↗ s↖、大文字の D U R＝塗りつぶしの矢印（長め）、
//   ?＝斜め（本の絵で向きを読み分けられなかったもの。4 方向を全部試す）、@＝塗りつぶしの斜め（? と同じに試し長めに押す）、P K G、+＝同時。[近] などの条件は前に付く）
// ボタンのビット: P 1・K 2・G 32・↑ 4・↓ 16・→ 64・← 128（1P の右向き。FV と同じ）
import fs from "fs"; import vm from "vm"; import path from "path";
import {vf2Step} from "./press.mjs";
const here=path.dirname(new URL(import.meta.url).pathname), ctx={console}; vm.createContext(ctx);
for(const f of ["arcade.js","ee.js","motion.js"]) vm.runInContext(fs.readFileSync(path.join(here,f),"utf8"),ctx);
const g=n=>vm.runInContext(n,ctx), prog=new Uint8Array(fs.readFileSync(path.join(here,"disc/bin/IC12_15.dec")));
// キャラ → [写し, 1P=0|2P=1]
export const VF2_CHAR_STATE={akira:["01_akira_lau",0],pai:["02_pai_sarah",0],wolf:["03_wolf_jeffry",0],kage:["04_kage_jacky",0],shun:["05_shun_lion",0],
  jeffry:["13_jeffrytest",0],jacky:["18_jacky_lau",0],lau:["01_akira_lau",1],sarah:["02_pai_sarah",1],lion:["05_shun_lion",1]};
export const VF2_BIT={P:1,K:2,G:32,u:4,d:16,r:64,l:128};   // FV と同じ（写し 01 のアキラで 1 つずつ押して確かめた: 4 で跳ぶ・16 でしゃがむ・32 でガード）
const BIT=VF2_BIT;
function dirBits(ch){ const B=BIT; return {r:B.r,l:B.l,u:B.u,d:B.d,x:B.d|B.r,z:B.d|B.l,a:B.u|B.r,s:B.u|B.l}[ch] }
// コマンド → 手順の候補（? を 4 方向に展開）
export function expand(cmd){ let outs=[""]; for(const ch of cmd){ if(ch==="?"||ch==="@"){ const up=ch==="@"; outs=outs.flatMap(o=>["x","z","a","s"].map(d=>o+(up?d.toUpperCase():d))) } else outs=outs.map(o=>o+ch) } return outs }
export function parse(cmd){
  let body=cmd.replace(/^\[[^\]]*\]/,"").replace(/\(.*?\)/g,"").replace(/後G放す/,"").trim(); if(!body||/[^rludxzasRLUDXZASPKG+ ]/.test(body)) return null;
  const steps=[]; let join=false;
  for(const ch of body){ if(ch===" ") continue; if(ch==="+"){ join=true; continue }
    const lo=ch.toLowerCase(), isDir="rludxzas".includes(lo), bits=isDir?dirBits(lo):BIT[ch], hold=isDir&&ch!==lo;
    if(bits===undefined) return null;
    if(join&&steps.length){ const s=steps[steps.length-1]; s.bits|=bits; s.hold=s.hold||hold } else steps.push({bits,hold}); join=false }
  return steps }
// 手順 → コマごとの入力。方向のすぐ後のボタンは、方向を入れたまま押す（VF2 の ↓P などは「↓」と「↓＋P」。離してから押すと立ちの P になった）。
// 方向だけが続くとき（回す入力）は間を空けず、同じ方向が続くときとボタンのあとは離す
export function frames(steps){ const f=[], btn=b=>b&(BIT.P|BIT.K|BIT.G), dirOf=b=>b&~(BIT.P|BIT.K|BIT.G);
  steps.forEach((s,i)=>{ const n=s.hold?12:2, nx=steps[i+1], pv=steps[i-1], carry=pv&&!btn(pv.bits)&&btn(s.bits)&&!dirOf(s.bits)?pv.bits:0;
    for(let k=0;k<n;k++) f.push(s.bits|carry);
    if(!nx) return;
    if(!btn(s.bits)&&btn(nx.bits)&&!dirOf(nx.bits)) return;   // 次のボタンは今の方向と一緒に
    if(!(!btn(s.bits)&&!btn(nx.bits)&&s.bits!==nx.bits)) for(let k=0;k<(btn(s.bits)?4:2);k++) f.push(0) });
  return f }
const mem0={};
// near: 投げ・崩しなど「近」の技は、相手に近づいてから（前に歩いて腰の間が near より近くなるまで）
export function tryInput(st,pl,inp,flip,near=0){ if(!mem0[st]) mem0[st]=fs.readFileSync(path.join(here,"disc/states",st,"eeMemory.bin"));
  const E=g("motEngine")(prog,mem0[st],null), M=E.mem, G=M.r32(pl?0x500808:0x500804), basic=new Set(); for(let k=0;k<55;k++) basic.add(M.r16(M.r32(G+0x1a0)+2*k));
  const stance=M.r16(M.r32(G+0x1a0)), sw=b=>flip?(b&~(BIT.r|BIT.l))|(b&BIT.r?BIT.l:0)|(b&BIT.l?BIT.r:0):b;
  for(let k=0;k<200&&E.info(pl).motion!==stance;k++) vf2Step(E,pl,0);
  for(let k=0;k<10;k++) vf2Step(E,pl,0);
  if(near){ const d=()=>{ const a=E.units(0)[0], b=E.units(1)[0]; return Math.hypot(a[9]-b[9],a[11]-b[11]) };
    for(let k=0;k<240&&d()>near;k++) vf2Step(E,pl,sw(BIT.r)); for(let k=0;k<6;k++) vf2Step(E,pl,0) }
  const seen=[]; let last=-1;
  inp.forEach((b,k)=>{ vf2Step(E,pl,sw(b)); const m=E.info(pl).motion; if(m!==last){ seen.push([k,m]); last=m } });
  for(let k=0;k<30;k++){ vf2Step(E,pl,0); const m=E.info(pl).motion; if(m!==last){ seen.push([inp.length+k,m]); last=m } }
  const cand=seen.filter(([k,m])=>!basic.has(m)), lastBtn=inp.reduce((a,b,i)=>b&(BIT.P|BIT.K|BIT.G)?i:a,-1);
  let pick=cand.filter(([k])=>k>=lastBtn).map(([,m])=>m)[0]; if(pick===undefined&&cand.length) pick=cand[cand.length-1][1];
  return {move:pick??null,seen,stance} }
if(process.argv[1]&&process.argv[1].endsWith("cmdmap.mjs")){
  const dir=process.argv[2], names=process.argv.slice(3).length?process.argv.slice(3):Object.keys(VF2_CHAR_STATE), out={};
  for(const ch of names){ const [st,pl]=VF2_CHAR_STATE[ch], rows=[], flip=!!pl&&process.env.NOFLIP!=="1";
    for(const line of fs.readFileSync(path.join(dir,ch+".txt"),"utf8").split("\n")){ if(!line||line[0]==="#") continue;
      const [no,name,yomi,cmd,,,kind]=line.split("|");
      if(!["基本","固有","投げ","崩し","振り向き"].includes(kind)){ rows.push({no,name,cmd,kind,skip:true}); continue }
      const tries=expand(cmd).map(c=>{ const s=parse(c); if(!s) return {c,move:null,err:"扱えない"}; try{ const r=tryInput(st,pl,frames(s),flip,/^\[近\]/.test(c)?+(process.env.NEAR||0.9):0); return {c,move:r.move,seen:r.seen.map(x=>x.join(":")).join(" ")} }catch(e){ return {c,move:null,err:e.message} } });
      rows.push({no,name,cmd,kind,tries}); console.log(ch,no,name,cmd,"→",tries.map(t=>t.c+":"+(t.move??t.err??"-")).join(" ")) }
    out[ch]=rows }
  fs.mkdirSync(path.join(here,"out"),{recursive:true}); fs.writeFileSync(path.join(here,"out/cmdmap.json"),JSON.stringify(out,null,1));
}
