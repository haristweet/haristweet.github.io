// CHD のディスクを 2352B/セクタの .bin に書き出す（tobal1 の disc.js の ChdDisc を使う）。
//   node chd2bin.mjs disc/we2001.chd disc/we2001.bin 104051   ← セクタ数は CHD の中の TRACK:1 の FRAMES（データのトラックだけ）
import fs from "fs"; import vm from "vm";
const src=fs.readFileSync(new URL("../../tobal1-model-viewer/src/disc.js",import.meta.url),"utf8");
const ctx={DecompressionStream,Blob,Response,TextDecoder,Uint8Array,console}; vm.createContext(ctx);
vm.runInContext(src+";this.ChdDisc=ChdDisc;",ctx);
const d=new ctx.ChdDisc(new Blob([fs.readFileSync(process.argv[2])])); await d.init();
const n=+process.argv[4], fd=fs.openSync(process.argv[3],"w");
for(let i=0;i<n;i++) fs.writeSync(fd,await d.readRaw(i));
fs.closeSync(fd); console.log(process.argv[3],n,"セクタ");
