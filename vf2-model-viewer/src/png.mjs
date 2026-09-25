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
