// アーケード（Model 2A）のテクスチャをロム（disc/arcade/、リポジトリに入れない）から作って、PS2 のテクスチャと比べる（arcade.js を使う）
//   node arcadetex.mjs  … 11 人のキャラ（1P＝ページ1・2P＝ページ0）で、PS2 の TEX_ROB と一致するかを数える
// PS2 の (横 px, 縦 py) ＝ アーケードのテクスチャ RAM の (横 py, 縦 4×px＋3)
import fs from "fs"; import vm from "vm"; import path from "path";
const here=path.dirname(new URL(import.meta.url).pathname), ctx={}; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(here,"arcade.js"),"utf8"),ctx); const g=n=>vm.runInContext(n,ctx);
export function arcadeRom(){ const files={}; for(const f of fs.readdirSync(path.join(here,"disc/arcade"))) if(!f.endsWith(".zip")&&!f.endsWith(".bin")) files[f]=new Uint8Array(fs.readFileSync(path.join(here,"disc/arcade",f))); return g("arcRom")(files) }
export const arcCharSheets=(...a)=>g("arcCharSheets")(...a), arcTexel=(...a)=>g("arcTexel")(...a), ARC_CHARS=g("ARC_CHARS");
if(process.argv[1]===new URL(import.meta.url).pathname){
  const rom=arcadeRom(), SC=["AKI","JAC","SAR","KAG","LAU","JEF","PAI","WOL","SUI","DUR","TOU"];
  for(const [i,c] of SC.entries()){ const f=path.join(here,"disc/bin/TEX_ROB_"+i+".dec"); if(!fs.existsSync(f)) continue; const t=fs.readFileSync(f);
    const L=arcCharSheets(rom,[c,c]), res=[];
    for(const page of [1,0]){ let same=0,n=0; for(let py=0;py<768;py++) for(let px=0;px<256;px++){ const b=t[py*128+(px>>1)], v=px&1?b>>4:b&15; n++; if(v===arcTexel(L.tex[page],py,4*px+3)) same++ } res.push((100*same/n).toFixed(1)+"%") }
    console.log(c,"1P（ページ1）",res[0],"2P（ページ0）",res[1]) }
}
