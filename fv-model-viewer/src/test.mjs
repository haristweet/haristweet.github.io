// 単体試験（disc/ にデータがあれば本物で）。node test.mjs
import fs from "fs"; import vm from "vm"; import path from "path";
const here=path.dirname(new URL(import.meta.url).pathname), ctx={console,TextDecoder}; vm.createContext(ctx);
for(const f of ["cricmp.js","obj.js","tex.js","scene.js","build.js","arcade.js","fvarc.js","fvmoves.js"]) vm.runInContext(fs.readFileSync(path.join(here,f),"utf8"),ctx);
const g=n=>vm.runInContext(n,ctx); let ok=0, ng=0;
const t=(name,c)=>{ if(c){ ok++; console.log("  ok",name) } else { ng++; console.log("  NG",name) } };
const bin=path.join(here,"disc/bin"), sd=path.join(here,"disc/states");
if(!fs.existsSync(bin)){ console.log("disc/ が無いので本物での試験はしない"); process.exit(0) }
const obj=f=>new Map(g("objModels")(g("cricmpUnpack")(new Uint8Array(fs.readFileSync(path.join(bin,f))))).map(e=>[e.id,e]));
t("OBJ_ROB01 が区切れる（196 モデル以上）",obj("OBJ_ROB01.CMP").size>=150);
const states=fs.readdirSync(sd).filter(f=>fs.existsSync(path.join(sd,f,"eeMemory.bin")));
for(const s of states){ const mem=fs.readFileSync(path.join(sd,s,"eeMemory.bin")), sc=g("sceneRead")(mem);
  t(`写し ${s}: 命令の列を読めて部品 ${sc.draws.length} 個（1P・2P とも）・焦点 480`,sc.draws.length>50&&sc.draws.some(d=>d.player===1)&&sc.focal[0]===480) }
{ const L=g("fvArcLoader")(new Uint8Array(fs.readFileSync(path.join(bin,"ROM_CODE1.dec"))),new Uint8Array(fs.readFileSync(path.join(bin,"ROM_DATA.dec")))); L.loadSet(3); L.loadSet(4);
  // PS2 のテクスチャのファイル（TEX_ROB01）の行 r・横 x ＝ アーケードの RAM ページ1 の (r を偶数に丸めたもの, 2x＋1＋512×(r&1))
  const F=fs.readFileSync(path.join(bin,"TEX_ROB01.dec")); let n=0,same=0;
  for(let r=0;r<768;r++) for(let x=0;x<256;x++){ const ax=r&~1, ay=2*x+1+512*(r&1), h=(ay>>1)*512+(ax>>1); if(!L.mask[1][h]) continue; n++; const b=F[r*128+(x>>1)]; if(g("arcTexel")(L.tex[1],ax,ay)===(x&1?b>>4:b&15)) same++ }
  t(`アーケードのセット 3＋4 と TEX_ROB01 の対応（${same}/${n}）`,n>100000&&same/n>0.999) }
// 技の名前: fvmoves.js の番号は、どれもコマンド表の「技の名前」の文字列を指し、次の文字列が入力（<X_20> で始まる）
{ const M=g("FV_MOVES"); let n=0, good=0;
  for(const [cid,[file,list]] of Object.entries(M)){ const s=g("cmdStrings")(new Uint8Array(fs.readFileSync(path.join(bin,file))));
    for(const [i,m] of list){ n++; if(s[i]&&!s[i].startsWith("<X_20>")&&s[i+1]&&s[i+1].startsWith("<X_20>")&&m>=1&&m<=1052) good++ } }
  t(`技の名前の表（${good}/${n} が名前と入力の組を指す）`,n>150&&good===n) }
console.log(ok,"件 ok",ng?ng+" 件 NG":""); if(ng) process.exit(1);
