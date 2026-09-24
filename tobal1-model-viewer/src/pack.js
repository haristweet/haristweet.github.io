function unpack(b){
  const dv=new DataView(b.buffer,b.byteOffset,b.byteLength);
  const n=dv.getUint32(0,true); if(n<1||n>4096) return null;
  const offs=[]; for(let i=0;i<=n;i++) offs.push(dv.getUint32(4+i*4,true));
  if(offs[0]!==4+4*(n+1)) return null;
  const parts=[]; for(let i=0;i<n;i++) parts.push(b.subarray(offs[i],offs[i+1]));
  return parts;
}
function decompress(data){
  let pos=0;
  const peek=n=>{const i=pos>>>3; let v=0,m=1; for(let k=0;k<6;k++){v+=(data[i+k]||0)*m; m*=256} v=Math.floor(v/(1<<(pos&7))); return v%2**n};
  const get=n=>{const v=peek(n); pos+=n; return v};
  if(get(8)!==0x0b) throw new Error("圧縮データの形式が違います");
  const lo=get(16), hi=get(8), total=hi*65536+lo;
  const out=new Uint8Array(total+512); let op=0, remaining=total;
  const hist=new Array(16).fill(0), UNIT={1:2,2:2,3:3,4:3,5:4,6:4};
  while(remaining>0){
    const chunk=Math.min(remaining,256); remaining-=chunk;
    const mode=get(4);
    if(mode===0){ for(let i=0;i<(chunk+3>>2);i++){const w=get(32); out[op++]=w&255; out[op++]=(w>>>8)&255; out[op++]=(w>>>16)&255; out[op++]=(w>>>24)&255} continue }
    let units=(chunk*8)>>UNIT[mode], s4=0, pend=-1;
    while(units>0){
      let w=peek(32)>>>0, used, cnt, val;
      if((w&1)===0){cnt=1;used=1;w>>>=1}
      else{ w>>>=1; if((w&1)===0){cnt=2;used=2;w>>>=1} else { w>>>=1; cnt=w&15; w>>>=4; if(cnt){used=6} else {cnt=w&255; w>>>=8; used=14} } }
      if(mode===1){val=w&15; used+=4}
      else if(mode===2){ const f=w&1; used+=1; if(!f){val=(w>>>1)&15; used+=4; s4^=1; hist[s4]=val} else {s4^=1; val=hist[s4]} }
      else if(mode===3){val=w&255; used+=8}
      else if(mode===4){ const f=w&1; used+=1; w>>>=1; if(!f){val=w&255; used+=8} else {val=hist[w&3]; used+=2} s4=(s4+1)&3; hist[s4]=val }
      else if(mode===5){val=w&0xffff; used+=16}
      else { const f=w&1; used+=1; w>>>=1; if(!f){val=w&0xffff; used+=16} else {val=hist[w&15]; used+=4} s4=(s4+1)&15; hist[s4]=val }
      pos+=used; units-=cnt;
      if(mode<=2){ for(let k=0;k<cnt;k++){ if(pend<0) pend=val; else {out[op++]=pend|(val<<4); pend=-1} } }
      else if(mode<=4){ for(let k=0;k<cnt;k++) out[op++]=val }
      else { for(let k=0;k<cnt;k++){out[op++]=val&255; out[op++]=val>>>8} }
    }
  }
  return out.subarray(0,total);
}
