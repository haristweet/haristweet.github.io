// アーケードのテクスチャのセットを展開して、テクスチャ RAM 2 枚を絵にする（MAME の並び: 16bit の語に縦2×横2、1 枚 2048×1024 を 1024×2048 に折る）
//   node arcadetex.mjs 1,2 out/arc.png
import fs from "fs"; import vm from "vm"; import path from "path"; import {pngEncode} from "./png.mjs";
const here=path.dirname(new URL(import.meta.url).pathname), ctx={console}; vm.createContext(ctx);
for(const f of ["arcade.js","fvarc.js"]) vm.runInContext(fs.readFileSync(path.join(here,f),"utf8"),ctx);
const g=n=>vm.runInContext(n,ctx);
const [,,sets="1,2",outp="out/arc.png"]=process.argv;
const prog=new Uint8Array(fs.readFileSync(path.join(here,"disc/bin/ROM_CODE1.dec"))), data=new Uint8Array(fs.readFileSync(path.join(here,"disc/bin/ROM_DATA.dec")));
const L=g("fvArcLoader")(prog,data); let t0=Date.now();
for(const s of sets.split(",").map(Number)) console.log("セット",s,"要素",L.loadSet(s));
console.log("命令",L.cpu.steps,(Date.now()-t0)+"ms");
const W=1024,H=2048,o=new Uint8Array(W*2*H*3);
for(let p=0;p<2;p++) for(let y=0;y<H;y++) for(let x=0;x<W;x++){ let w=L.tex[p][((y>>1)*512+(x>>1))&0x7ffff]; if(!(y&1)) w>>=8; if(!(x&1)) w>>=4; const v=(w&15)*17, i=(y*W*2+p*W+x)*3; o[i]=o[i+1]=o[i+2]=L.mask[p][((y>>1)*512+(x>>1))&0x7ffff]?v:40 }
fs.writeFileSync(outp,pngEncode(W*2,H,o)); console.log(outp);
