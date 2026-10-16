// 試験用の偽のディスクを作る。data/番号.bin（ほどいた見本）を、同じ番号の所に入れた 0_TEXT.AFS と、それを入れた ISO
//   node mkfake.mjs → out/fake_0_TEXT.AFS・out/fake.iso（ゲームのデータを含むのでリポジトリに入れない）
import fs from "fs"; import path from "path"; import zlib from "zlib";
const here=path.dirname(new URL(import.meta.url).pathname), dd=path.join(here,"data");
const files=fs.readdirSync(dd).filter(f=>/^\d+\.bin$/.test(f)).map(f=>({i:+f.slice(0,-4),u:fs.readFileSync(path.join(dd,f))}));
const n=Math.max(...files.map(f=>f.i))+1, head=8+n*8, al=x=>Math.ceil(x/2048)*2048;
let pos=al(head); const ents=new Array(n).fill(null).map(()=>({off:0,size:0})), blobs=[];
for(const {i,u} of files){ const z=zlib.deflateSync(u), h=Buffer.alloc(32); h.writeUInt32LE(0x10600,0); h.writeUInt32LE(z.length,4); h.writeUInt32LE(u.length,8);
  const b=Buffer.concat([h,z]); ents[i]={off:pos,size:b.length}; blobs.push([pos,b]); pos=al(pos+b.length) }
const afs=Buffer.alloc(pos); afs.write("AFS\0",0,"latin1"); afs.writeUInt32LE(n,4);
ents.forEach((e,i)=>{ afs.writeUInt32LE(e.off,8+i*8); afs.writeUInt32LE(e.size,12+i*8) });
for(const [p,b] of blobs) b.copy(afs,p);
fs.mkdirSync(path.join(here,"out"),{recursive:true}); fs.writeFileSync(path.join(here,"out/fake_0_TEXT.AFS"),afs);
// ISO9660: 16 番目に PVD、18 番目に根の一覧（SYSTEM.CNF と 0_TEXT.AFS）、20 番目から AFS
const iso=Buffer.alloc(20*2048+afs.length), rec=(name,lba,size,dir)=>{ const nm=Buffer.from(name,"latin1"), L=33+nm.length+(nm.length%2?0:1), r=Buffer.alloc(L);
  r[0]=L; r.writeUInt32LE(lba,2); r.writeUInt32BE(lba,6); r.writeUInt32LE(size,10); r.writeUInt32BE(size,14); r[25]=dir?2:0; r[32]=nm.length; nm.copy(r,33); return r };
iso[16*2048]=1; iso.write("CD001",16*2048+1,"latin1"); rec("\0",18,2048,true).copy(iso,16*2048+156);
Buffer.concat([rec("\0",18,2048,true),rec("\x01",18,2048,true),rec("SYSTEM.CNF;1",19,10),rec("0_TEXT.AFS;1",20,afs.length)]).copy(iso,18*2048);
afs.copy(iso,20*2048); fs.writeFileSync(path.join(here,"out/fake.iso"),iso);
console.log("out/fake_0_TEXT.AFS",afs.length,"out/fake.iso",iso.length,"ファイル",n,"中身のあるもの",files.length);
