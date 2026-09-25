// PCSX2 のセーブステート（.p2s）を読む。中身は zip で、各ファイルは zstd（形式番号 93）か無圧縮（0）か deflate（8）。
// 返り値: Map(名前 → () => Promise<Uint8Array>)
async function p2sOpen(buf){
  const u8=buf instanceof Uint8Array?buf:new Uint8Array(buf), dv=new DataView(u8.buffer,u8.byteOffset,u8.byteLength);
  let e=u8.length-22; while(e>=0&&dv.getUint32(e,true)!==0x06054b50) e--;
  if(e<0) throw new Error("zip の形をしていない（.p2s ではない？）");
  const n=dv.getUint16(e+10,true); let p=dv.getUint32(e+16,true); const out=new Map();
  for(let k=0;k<n;k++){
    if(dv.getUint32(p,true)!==0x02014b50) throw new Error("zip の目次が壊れている");
    const method=dv.getUint16(p+10,true), csize=dv.getUint32(p+20,true), size=dv.getUint32(p+24,true);
    const nl=dv.getUint16(p+28,true), xl=dv.getUint16(p+30,true), cl=dv.getUint16(p+32,true), loc=dv.getUint32(p+42,true);
    const name=new TextDecoder().decode(u8.subarray(p+46,p+46+nl));
    out.set(name,async()=>{
      const d0=loc+30+dv.getUint16(loc+26,true)+dv.getUint16(loc+28,true), raw=u8.subarray(d0,d0+csize);
      if(method===0) return raw;
      if(method===93) return fzstd.decompress(raw,new Uint8Array(size));
      if(method===8){ const s=new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw")); return new Uint8Array(await new Response(s).arrayBuffer()) }
      throw new Error("知らない圧縮の形式 "+method+"（"+name+"）");
    });
    p+=46+nl+xl+cl;
  }
  return out;
}
