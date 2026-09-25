// ディスクのイメージ（.bin＝2352 バイト/セクタ、.iso＝2048）か、中の BIN.CVM を、File のまま必要な所だけ読む。
// BIN.CVM は CRI ROFS（頭 "CVMH"、中は ISO9660）。返り値: Map(名前 → () => Promise<Uint8Array>)
async function vdSlice(file,off,len){ return new Uint8Array(await file.slice(off,off+len).arrayBuffer()) }
function vdWalk(readSec,root){   // ISO9660 のファイルを全部たどる。readSec(lba,count)→Promise<Uint8Array>
  const out=[];
  const walk=async(lba,size,pre)=>{
    const d=await readSec(lba,Math.ceil(size/2048)), dv=new DataView(d.buffer,d.byteOffset,d.byteLength);
    for(let p=0;p<d.length;){
      const L=d[p]; if(!L){ p=(Math.floor(p/2048)+1)*2048; continue }
      const el=dv.getUint32(p+2,true), es=dv.getUint32(p+10,true), fl=d[p+25], nl=d[p+32];
      const nm=String.fromCharCode(...d.subarray(p+33,p+33+nl)).split(";")[0];
      if(nl===1&&d[p+33]<2){ p+=L; continue }
      if(fl&2) await walk(el,es,pre+nm+"/"); else out.push({name:pre+nm,lba:el,size:es});
      p+=L;
    }
  };
  return walk(root[0],root[1],"").then(()=>out);
}
async function vdRootOf(pvd){ const dv=new DataView(pvd.buffer,pvd.byteOffset,pvd.byteLength); return [dv.getUint32(156+2,true),dv.getUint32(156+10,true)] }
async function discOpen(file){
  const head=await vdSlice(file,0,0x10000), files=new Map();
  const isCD=(o)=>head[o]===1&&String.fromCharCode(...head.subarray(o+1,o+6))==="CD001";
  let cvm=null;
  if(String.fromCharCode(...head.subarray(0,4))==="CVMH") cvm=file;
  else {
    let sec,base;
    const probe=await vdSlice(file,16*2352,2352);
    if(String.fromCharCode(...probe.subarray(25,30))==="CD001"){ sec=2352; base=24 }
    else if(String.fromCharCode(...(await vdSlice(file,16*2048+1,5)))==="CD001"){ sec=2048; base=0 }
    else throw new Error("ディスクのイメージ（.bin/.iso）か BIN.CVM ではない");
    const readSec=async(lba,n)=>{ const raw=await vdSlice(file,lba*sec,n*sec); if(sec===2048) return raw;
      const o=new Uint8Array(n*2048); for(let i=0;i<n;i++) o.set(raw.subarray(i*sec+base,i*sec+base+2048),i*2048); return o };
    const list=await vdWalk(readSec,await vdRootOf(await readSec(16,1)));
    const e=list.find(f=>f.name.toUpperCase()==="BIN.CVM");
    if(!e) throw new Error("ディスクの中に BIN.CVM が無い（バーチャファイター2 の PS2 版ではない？）");
    cvm=new Blob([await readSec(e.lba,Math.ceil(e.size/2048))]).slice(0,e.size);
  }
  const ch=await vdSlice(cvm,0,0x20000); let at=-1;
  for(let i=0;i<ch.length-6;i++) if(ch[i]===1&&ch[i+1]===0x43&&ch[i+2]===0x44&&ch[i+3]===0x30&&ch[i+4]===0x30&&ch[i+5]===0x31){ at=i; break }
  if(at<0) throw new Error("BIN.CVM の中に ISO9660 が見つからない");
  const base=at-16*2048, readSec=(lba,n)=>vdSlice(cvm,base+lba*2048,n*2048);
  for(const f of await vdWalk(readSec,await vdRootOf(await readSec(16,1))))
    files.set(f.name,()=>vdSlice(cvm,base+f.lba*2048,f.size));
  return files;
}
