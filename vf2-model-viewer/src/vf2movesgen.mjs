// out/cmdmap.json（node cmdmap.mjs 書き起こしのフォルダ）から vf2moves.js を作る。番号がただ 1 つに決まった技だけを入れる
//   node vf2movesgen.mjs   → vf2moves.js（キャラの番号 → [技名, 入力, 技の番号] の並び）
// 決め方: 斜め（? @）の無い入力の技を先に決め、斜めの技は 4 方向を試した中で、ほかの技に使われていない番号が 1 つだけのとき。同じ番号が 2 つの技に出たものは入力の短いほうだけ、候補が 2 つ以上のものは入れない
import fs from "fs"; import path from "path";
const here=path.dirname(new URL(import.meta.url).pathname), J=JSON.parse(fs.readFileSync(path.join(here,"out/cmdmap.json"),"utf8"));
const CID={akira:0,jacky:1,sarah:2,kage:3,lau:4,jeffry:5,pai:6,wolf:7,shun:8,lion:10};
const ARROW={r:"→",l:"←",u:"↑",d:"↓",x:"↘",z:"↙",a:"↗",s:"↖"};
const pretty=c=>c.replace(/^\[近\]/,"（近）").replace(/[rludxzas]/g,ch=>ARROW[ch]).replace(/[RLUDXZAS]/g,ch=>ARROW[ch.toLowerCase()]+"長").replace(/\+/g,"＋");
const out={}; let n=0;
for(const [ch,rows] of Object.entries(J)){
  // 「近」の技（投げ・崩し）は、相手との距離の判定がこの動かし方では効かず空振りの動きになるので入れない
  // P＋G（と G の後の P）は投げの入力で、空振りの動きが出ることがある（舜帝の後側後避払手・リオンの偸歩背掃手が絵で別の動きだった）ので入れない
  const R=rows.filter(r=>!r.skip&&!/^\[/.test(r.cmd)&&!/P\+G|GP/.test(r.cmd)), used=new Map(), add=m=>used.set(m,(used.get(m)||0)+1);
  for(const r of R) if(!/[?@]/.test(r.cmd)){ r.m=r.tries[0].move; r.c=r.tries[0].c; if(r.m!=null) add(r.m) }
  for(const r of R) if(/[?@]/.test(r.cmd)){ const c=[...new Set(r.tries.map(t=>t.move).filter(m=>m!=null&&!used.has(m)))];
    if(c.length===1){ r.m=c[0]; r.c=r.tries.find(t=>t.move===r.m).c; add(r.m) } else r.m=null }
  // 同じ番号が 2 つ以上の技に出たとき: いちばん短い入力が、ほかの入力の頭と同じとき（PPK が PP で止まったなど）か、基本攻撃のときだけ、短いほうに付ける。
  // それ以外（→K＋G と →→K＋G と ←→K＋G が同じ番号など）は、どれが本当か分からないので入れない（ウルフの 926 は絵でローリングソバットに見えなかった）
  const groups=new Map(); for(const r of R) if(r.m!=null){ if(!groups.has(r.m)) groups.set(r.m,[]); groups.get(r.m).push(r) }
  const keep=new Set(); for(const g of groups.values()){ g.sort((x,y)=>x.c.length-y.c.length); const s0=g[0];
    if(g.length===1||s0.kind==="基本"||g.slice(1).every(r=>r.c.startsWith(s0.c))) keep.add(s0) }
  const list=R.filter(r=>keep.has(r)).map(r=>[r.name,pretty(r.c),r.m]);
  out[CID[ch]]=list; n+=list.length }
const body=Object.entries(out).map(([k,l])=>`${k}:[${l.map(x=>JSON.stringify(x)).join(",")}]`).join(",\n");
fs.writeFileSync(path.join(here,"vf2moves.js"),`// 技の名前（『バーチャファイター2 マニアックス』の技表から。入力を与えてゲームの処理で出させた番号。vf2movesgen.mjs が作る）
// キャラの番号（構造体の +0x1b1）→ [技名, 入力（1P の右向き）, 技の番号]。番号がただ 1 つに決まった技だけ（${n} 技。合っているかを絵で確かめたのは一部）
const VF2_MOVES={
${body}};
const VF2_WHO={0:"アキラ",1:"ジャッキー",2:"サラ",3:"影丸",4:"ラウ",5:"ジェフリー",6:"パイ",7:"ウルフ",8:"舜帝",10:"リオン"};
`);
console.log("技",n);
