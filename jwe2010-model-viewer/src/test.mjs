// 単体試験。node test.mjs（data/ と out/fake.* があれば本物の見本で）
import fs from "fs"; import vm from "vm"; import path from "path"; import zlib from "zlib";
const here=path.dirname(new URL(import.meta.url).pathname), ctx={console,DecompressionStream,Blob,Response,TextDecoder}; vm.createContext(ctx);
for(const f of ["fzstd.js","we12.js","p2s.js","wgl.js"]) vm.runInContext(fs.readFileSync(path.join(here,f),"utf8"),ctx);
const g=n=>vm.runInContext(n,ctx); let ok=0, ng=0;
const t=(name,c)=>{ if(c){ ok++; console.log("  ok",name) } else { ng++; console.log("  NG",name) } };
// zip を作る（.p2s の代わり）。method: 0＝そのまま、8＝deflate、93＝zstd（node の zlib で縮める）
function zip(files){ const loc=[], cd=[]; let pos=0;
  for(const [name,data,method] of files){ const nm=Buffer.from(name), z=method===8?zlib.deflateRawSync(data):method===93?zlib.zstdCompressSync(data):data;
    const h=Buffer.alloc(30); h.writeUInt32LE(0x04034b50,0); h.writeUInt16LE(method,8); h.writeUInt32LE(z.length,18); h.writeUInt32LE(data.length,22); h.writeUInt16LE(nm.length,26);
    const c=Buffer.alloc(46); c.writeUInt32LE(0x02014b50,0); c.writeUInt16LE(method,10); c.writeUInt32LE(z.length,20); c.writeUInt32LE(data.length,24); c.writeUInt16LE(nm.length,28); c.writeUInt32LE(pos,42);
    loc.push(h,nm,z); cd.push(c,nm); pos+=30+nm.length+z.length }
  const cdb=Buffer.concat(cd), e=Buffer.alloc(22); e.writeUInt32LE(0x06054b50,0); e.writeUInt16LE(files.length,8); e.writeUInt16LE(files.length,10); e.writeUInt32LE(cdb.length,12); e.writeUInt32LE(pos,16);
  return Buffer.concat([...loc,cdb,e]) }
// 偽のメモリ: 0x1000 から 300 人。名前「選手n」、背中「Pn」、顔の値 n（＋上の印 0x1000）、髪の値 n
{ const m=Buffer.alloc(0x40000);
  for(let i=0;i<300;i++){ const a=0x1000+i*0x7C; m.write(`選手${i}`,a,"utf16le"); m.write(`P${i}`,a+0x20,"latin1"); m.writeUInt16LE(0x1000|i,a+0x5c); m.writeUInt16LE(i<<5|8,a+0x64) }
  for(const method of [0,8,93]){ const mem=await g("jwP2sMemory")(new Blob([zip([["PCSX2 Savestate Version.id",Buffer.from("x"),0],["eeMemory.bin",m,method]])]));
    const ps=g("jwPlayers")(mem), p=ps[7];
    t(`偽のセーブ（縮め方 ${method}）: ${ps.length} 人・8 人目 ${p.name}/${p.shirt}・顔 #${p.face}・髪 #${p.hair}`,ps.length===300&&p.name==="選手7"&&p.shirt==="P7"&&p.face===929&&p.hair===6622) } }
// 本物のセーブ（関口 訓充の選手選択の画面）
const sv=path.join(here,"data/sekiguchi.p2s");
if(fs.existsSync(sv)){ const mem=await g("jwP2sMemory")(new Blob([fs.readFileSync(sv)])), ps=g("jwPlayers")(mem), by=n=>ps.find(p=>p.name===n);
  const s=by("関口 訓充");
  t(`本物のセーブ: ${ps.length} 人、関口 ${s?.shirt} 顔 #${s?.face} 髪 #${s?.hair}`,ps.length===4609&&s.shirt==="KUNIMITSU"&&s.face===3378&&s.hair===7189);
  // メモリに読み込まれていた顔・髪のファイル 5 組（ディスクの番号で照合したもの）が、画面の一覧のベガルタの 5 人とそろう
  const five=[["中島 裕希",3377,7188],["関口 訓充",3378,7189],["富田 晋伍",3381,7192],["菅井 直樹",3382,7193],["中原 貴之",3387,7198]].map(([n,f,h])=>{ const p=by(n); return p.face===f&&p.hair===h });
  t(`読み込まれていた 5 組＝中島・関口・富田・菅井・中原（${five.join(",")}）`,five.every(x=>x));
  // 見本のある 30 人は、顔が MMT・髪が MTT の並び
  const bad=[]; for(const p of ps.slice(0,30)) for(const [i,want] of [[p.face,"MMT"],[p.hair,"MTT"]]){ const f=path.join(here,`data/${String(i).padStart(5,"0")}.bin`);
    if(!fs.existsSync(f)) continue; else if(g("weSig")(new Uint8Array(fs.readFileSync(f)))!==want) bad.push(p.name+":"+i) }
  t(`表の先頭 30 人のうち見本のある顔・髪のファイルの並び（だめ ${bad.join(" ")||"なし"}）`,!bad.length);
} else console.log("data/sekiguchi.p2s が無いので本物のセーブでの試験はしない");
const fa=path.join(here,"out/fake_0_TEXT.AFS"), fi=path.join(here,"out/fake.iso");
if(fs.existsSync(fa)) for(const [name,f] of [["AFS",fa],["ISO",fi]]){
  const blob=new Blob([fs.readFileSync(f)]), d=await g("weOpen")(blob), u=await g("weFile")(blob,d,3377);
  t(`${name} から開いて #3377 をほどくと見本と同じ・並び ${g("weSig")(u)}`,d.from===name&&Buffer.from(u).equals(fs.readFileSync(path.join(here,"data/03377.bin")))&&g("weSig")(u)==="MMT");
} else console.log("out/fake_0_TEXT.AFS が無いので偽のディスクでの試験はしない（node mkfake.mjs で作る）");
console.log(ok,"件 ok",ng?ng+" 件 NG":""); if(ng) process.exit(1);
