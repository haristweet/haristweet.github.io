// RGB の画素（Uint8Array、W*H*3）を PNG にする（node の zlib を使う）
import zlib from "zlib";
export function pngEncode(W,H,px){
  const raw=Buffer.alloc((W*3+1)*H);
  for(let y=0;y<H;y++){ raw[y*(W*3+1)]=0; Buffer.from(px.buffer,px.byteOffset+y*W*3,W*3).copy(raw,y*(W*3+1)+1) }
  const crc=b=>{ let c=~0; for(const x of b){ c^=x; for(let k=0;k<8;k++) c=c>>>1^(0xedb88320&-(c&1)) } return ~c>>>0 };
  const chunk=(t,d)=>{ const b=Buffer.alloc(12+d.length); b.writeUInt32BE(d.length,0); b.write(t,4); d.copy(b,8); b.writeUInt32BE(crc(b.subarray(4,8+d.length)),8+d.length); return b };
  const ih=Buffer.alloc(13); ih.writeUInt32BE(W,0); ih.writeUInt32BE(H,4); ih[8]=8; ih[9]=2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk("IHDR",ih),chunk("IDAT",zlib.deflateSync(raw)),chunk("IEND",Buffer.alloc(0))]);
}
// PNG を読む（8bit の RGB/RGBA、インターレースなし）。{W,H,px(RGB)} を返す
export function pngDecode(buf){
  let p=8, W, H, ct, idat=[];
  while(p<buf.length){ const L=buf.readUInt32BE(p), t=buf.toString("ascii",p+4,p+8);
    if(t==="IHDR"){ W=buf.readUInt32BE(p+8); H=buf.readUInt32BE(p+12); ct=buf[p+17] }
    if(t==="IDAT") idat.push(buf.subarray(p+8,p+8+L)); p+=12+L }
  const bpp=ct===6?4:3, r=zlib.inflateSync(Buffer.concat(idat)), st=W*bpp, out=new Uint8Array(st*H);
  for(let y=0;y<H;y++){ const f=r[y*(st+1)], src=y*(st+1)+1, o=y*st;
    for(let x=0;x<st;x++){ const a=x>=bpp?out[o+x-bpp]:0, b=y?out[o-st+x]:0, c=(x>=bpp&&y)?out[o-st+x-bpp]:0; let v=r[src+x];
      if(f===1) v+=a; else if(f===2) v+=b; else if(f===3) v+=(a+b)>>1; else if(f===4){ const q=a+b-c, pa=Math.abs(q-a), pb=Math.abs(q-b), pc=Math.abs(q-c); v+=pa<=pb&&pa<=pc?a:pb<=pc?b:c }
      out[o+x]=v&255 } }
  const px=new Uint8Array(W*H*3); for(let i=0;i<W*H;i++){ px[i*3]=out[i*bpp]; px[i*3+1]=out[i*bpp+1]; px[i*3+2]=out[i*bpp+2] }
  return {W,H,px};
}
