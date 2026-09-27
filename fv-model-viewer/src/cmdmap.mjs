// コマンド表（XXX_CMND.FTS）の技を、ゲームの 1 コマの処理に入力を与えて出させ、技の番号を集める（press.mjs と同じ動かし方）。
//   node cmdmap.mjs [キャラ…]   → out/cmdmap.json（キャラごとに [表の何番目の技, 技の番号 or null, 入力の並び, 出た技の並び]）と一覧を表示
// 入力の読み方（凡例とボタンの組み合わせから）: r→ l← u↑ d↓ x↘ z↙ a↗ s↖、大文字は長押し。1 つの絵の中は順に押し、「＋」は前の最後と後ろの最初を同時に。
// ボタンのビット（グレースで確かめた）: P 1・K 2・G 32・↑ 4・↓ 16・→ 64・← 128。条件のうち「走り中」「立ち途中」だけ前置きの入力で作る。ほかの条件（ジャンプ中＝この動かし方では跳ばない・投げ・背後など）は試さない。
// 前の技と同じ番号になったもの（途中で止まった連続など）は確かでない（sure＝false）
import fs from "fs"; import vm from "vm"; import path from "path";
const here=path.dirname(new URL(import.meta.url).pathname), ctx={console}; vm.createContext(ctx);
for(const f of ["arcade.js","ee.js","motion.js"]) vm.runInContext(fs.readFileSync(path.join(here,f),"utf8"),ctx);
const g=n=>vm.runInContext(n,ctx), bin=f=>new Uint8Array(fs.readFileSync(path.join(here,"disc/bin",f)));
const prog=bin("ROM_CODE1.dec"), rom={data:bin("ROM_DATA.dec"),ep1:bin("ROM_EP1.dec"),ep2:bin("ROM_EP2.dec")};
const CHARS={GRACE:"grace1P_picky1P_round1",BAHN:"bahn1P_honey1P_tower",RAXEL:"raxel1P_jane1P_tower",TOKIO:"tokio1P_sanman1P_tower",JANE:"jane1P_jane2P",PICKY:"picky1P_picky2P",HONEY:"honey1P_honey2P",SANMAN:"sanman1P_sanman2P"};
// コマンド表の文字列（cmdlist.py と同じ読み方）
function cmdRead(name){ const d=fs.readFileSync(path.join(here,"disc/bin",name+"_CMND.FTS")), t=d.indexOf("<X_200>"); let base=t; while(base>2&&!(d[base-3]===0xa1&&d[base-2]===0xfa&&d[base-1]===0)) base--; base-=3;
  const dec=new TextDecoder("euc-jp"), out=[]; let s=base; for(let i=base;i<d.length;i++) if(!d[i]){ if(i>s) out.push(dec.decode(d.subarray(s,i))); s=i+1 } return out }
const BIT={P:1,K:2,G:32,u:4,d:16,r:64,l:128,x:16|64,z:16|128,a:4|64,s:4|128};
// 入力の文字列 → 手順（1 手＝{bits, hold, dir}）。null は扱えない
function parse(cmd){
  let body=cmd.replace("<X_20>",""), pre=[];
  const cond=body.replace(/<[^>]*>|＋/g,"").trim();
  if(cond==="走り中") pre=[{bits:64,n:2},{bits:0,n:2},{bits:64,n:18,keep:64}];
  else if(cond==="立ち途中") pre=[{bits:16,n:12}];
  else if(cond) return null;
  const toks=[...body.matchAll(/<GFX_([^>]*)>|(＋)/g)].map(m=>m[2]?"+":m[1]);
  const steps=[]; let join=false;
  for(const t of toks){ if(t==="+"){ join=true; continue }
    for(let i=0;i<t.length;i++){ const ch=t[i], lo=ch.toLowerCase(); if(!(lo in BIT)&&!(ch in BIT)) return null;
      const bits=BIT[ch]??BIT[lo], hold=ch!==lo&&!"PKG".includes(ch);
      if(join&&i===0&&steps.length){ const s=steps[steps.length-1]; s.bits|=bits; s.hold=s.hold||hold } else steps.push({bits,hold});
    } join=false }
  return {pre,steps,keep:pre.length&&pre[pre.length-1].keep||0};
}
// 手順 → コマごとの入力。方向だけの手が続くとき（回す入力）は間を空けず、同じ方向が続くときとボタンのあとは離す
function frames(p){ const f=[];
  for(const s of p.pre) for(let k=0;k<s.n;k++) f.push(s.bits);
  p.steps.forEach((s,i)=>{ const n=s.hold?20:2, nx=p.steps[i+1], dirOnly=b=>!(b&(1|2|32));
    for(let k=0;k<n;k++) f.push(s.bits|p.keep);
    if(nx&&!(dirOnly(s.bits)&&dirOnly(nx.bits)&&s.bits!==nx.bits)) for(let k=0;k<(dirOnly(s.bits)?2:4);k++) f.push(p.keep) });
  return f }
function frame(E,pl){ const cpu=E.cpu, G=E.g7(pl); class Y extends Error{};
  const R=cpu.r; R[1]=R[31]=0x5f8000; R[29]=G; R[28]=0x4000; R[27]=0x880000; R[26]=0x800000; R[30]=0;
  cpu.trace=pc=>{ if(pc===0x1b0c) throw new Y() };
  try{ cpu.run(0x12b58,2e7) }catch(e){ if(!(e instanceof Y)) throw e } finally{ cpu.trace=null } }
function step(E,pl,bits){ E.mem.w8(E.g7(pl)+0x1200,bits); E.run(pl,[0x1d234],0); frame(E,pl) }
const mem0={};
function tryInput(ch,inp){ const st=CHARS[ch]; if(!mem0[st]) mem0[st]=fs.readFileSync(path.join(here,"disc/states",st,"eeMemory.bin"));
  const E=g("motEngine")(prog,mem0[st],rom), pl=0, M=E.mem, G=E.g7(pl), basic=new Set(); for(let k=0;k<55;k++) basic.add(M.r16(M.r32(G+0x1a0)+2*k));
  const stance=M.r16(M.r32(G+0x1a0));
  for(let k=0;k<200&&E.info(pl).motion!==stance;k++) step(E,pl,0);   // 構えに戻るまで
  for(let k=0;k<10;k++) step(E,pl,0);
  const seen=[]; let last=-1;
  inp.forEach((b,k)=>{ step(E,pl,b); const m=E.info(pl).motion; if(m!==last){ seen.push([k,m]); last=m } });
  for(let k=0;k<30;k++){ step(E,pl,0); const m=E.info(pl).motion; if(m!==last){ seen.push([inp.length+k,m]); last=m } }
  // 技＝最後の入力（0 でない最後のコマ）より後に始まった、基本の技でない最初の技（無ければ入力中の最後の基本でない技）
  let lastIn=inp.length-1; while(lastIn>0&&!inp[lastIn]) lastIn--;
  const cand=seen.filter(([k,m])=>!basic.has(m));
  const firstIn=inp.findIndex((b,i)=>b&(1|2|32)&&!(i>0&&inp[i-1]&(1|2|32))&&i>=0);
  const lastBtn=inp.reduce((a,b,i)=>b&(1|2|32)?i:a,-1);
  let pick=cand.filter(([k])=>k>=lastBtn).map(([,m])=>m)[0]; if(pick===undefined&&cand.length) pick=cand[cand.length-1][1];
  return {move:pick??null, seen} }
const names=process.argv.slice(2).length?process.argv.slice(2):Object.keys(CHARS), out={};
for(const ch of names){ const s=cmdRead(ch), rows=[];
  for(let i=2;i+1<s.length;i+=2){ const name=s[i], cmd=s[i+1]; if(!cmd.startsWith("<X_20>")){ i--; continue }
    const p=parse(cmd); if(!p){ rows.push([i,null,cmd,"扱えない"]); continue }
    const inp=frames(p); let r; try{ r=tryInput(ch,inp) }catch(e){ r={move:null,seen:e.message} }
    const sure=r.move!=null&&!rows.some(q=>q[1]===r.move);
    rows.push([i,r.move,cmd,r.seen,sure]); console.log(ch,i,name,cmd.replace(/<X_20>|<GFX_|>/g,""),"→",r.move,sure?"":"（確かでない）") }
  out[ch]=rows; const ok=rows.filter(q=>q[4]).length; console.log(ch,"技",rows.length,"番号が決まった",ok) }
fs.mkdirSync(path.join(here,"out"),{recursive:true}); fs.writeFileSync(path.join(here,"out/cmdmap.json"),JSON.stringify(out));
