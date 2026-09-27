// CRICMP 2.10 の展開（本体 SLPM_625.47 の 0x1547c0・0x154e80 を写したもの）。u8: Uint8Array → Uint8Array
function cricmpUnpack(u8){
  const dv=new DataView(u8.buffer,u8.byteOffset,u8.byteLength);
  if(String.fromCharCode(...u8.subarray(0,6))!=="CRICMP") throw new Error("CRICMP ではない");
  const size=dv.getUint32(0x14,true), ver=parseFloat(String.fromCharCode(...u8.subarray(8,12)).replace(/\0.*/,""));
  let p=dv.getUint32(0x18,true)+2, n;
  if(ver>2){ n=dv.getUint32(p,false); p+=4 } else { n=dv.getUint16(p,false); p+=2 }
  const out=new Uint8Array(size+0x20000); let o=0;
  const group=items=>{
    const flags=dv.getUint16(p,false); p+=2;
    for(let i=0;i<items;i++){
      const w=dv.getUint16(p,false); p+=2;
      if(flags>>i&1){ out[o++]=w>>8; out[o++]=w&255 }
      else if(!(w&0xf000)){ const b=out[o-1]; for(let k=w+3;k>0;k--) out[o++]=b }
      else { const off=w&0xfff; for(let k=(w>>12)+2;k>0;k--){ out[o]=out[o-off]; o++ } }
    }
  };
  for(let k=0;k<n;k++) group(16);
  const trim=dv.getInt8(p), rest=u8[p+1]; p+=2;
  if(rest>0) group(rest);
  if(trim>0) o-=trim;
  if(o!==size) throw new Error(`展開の大きさが合わない ${o} ≠ ${size}`);
  return out.slice(0,o);
}
