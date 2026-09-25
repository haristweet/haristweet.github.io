// 明るさのずれの集計（light.mjs の出力 out/light_*.json を読む）。写しごとの平均のずれと、条件（テクスチャの値・光の設定・曲線の番号・法線と光）ごとのずれと偏り。
//   for s in disc/states/*/; do node light.mjs $s; done; node lighterr.mjs
import fs from "fs";
const sts=["01_akira_lau","02_pai_sarah","03_wolf_jeffry","04_kage_jacky","05_shun_lion","06_akira_akira","07_pai_pai"];
const by={}, tot={n:0,e:0,b:0};
const add=(k,e,bias)=>{ const o=by[k]||(by[k]={n:0,e:0,b:0}); o.n++; o.e+=e; o.b+=bias };
for(const s of sts){ const R=JSON.parse(fs.readFileSync(`out/light_${s}.json`)); let n=0,e=0;
  for(const r of R){ const [dot,tl,obs,fit,c5,traw,pal,hb,x,y,rgb,nn,pred,B,ls]=r; if(fit>30) continue; const d=pred-obs, ae=Math.abs(d); n++; e+=ae; tot.n++; tot.e+=ae; tot.b+=d;
    add("tex:"+(traw<0?"no":traw>=0?"yes":"?"),ae,d); add("ls:"+ls,ae,d); add("pal:"+pal,ae,d); add("dot:"+(dot<0?"<0":dot<0.3?"0-.3":dot<0.7?".3-.7":">.7"),ae,d);
    if(traw>=0) add("traw:"+traw,ae,d); }
  console.log(s,"n",n,"mae",(e/n).toFixed(2)) }
console.log("all mae",(tot.e/tot.n).toFixed(2),"bias",(tot.b/tot.n).toFixed(2));
for(const [k,o] of Object.entries(by).filter(([k,o])=>o.n>3000).sort((a,b)=>b[1].e-a[1].e).slice(0,30)) console.log(k.padEnd(28),"n",String(o.n).padStart(7),"mae",(o.e/o.n).toFixed(2),"bias",(o.b/o.n).toFixed(2),"share",(o.e/tot.e*100).toFixed(1)+"%");
