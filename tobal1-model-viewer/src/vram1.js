// ============================================================
//  トバルNo.1 のテクスチャ（VRAM への転送の列）
//  実物の 84KB のファイル（sector 6408、展開後 189,680B）で確認した形:
//    u32 長さ ; u16 x ; u16 y ; u16 幅 ; u16 高さ ; データ[幅×高さ×2]
//    長さ = 4 + 8 + 幅×高さ×2
//  +0x0C に 16色パレット（x=416, y=486, 16×1, BGR555 に最上位ビット）、
//  0x10AC にも同じ形（x=288, y=504）。2箇所で一致したので、これで読む。
//  トバル2 は「u32 件数 ＋ 12バイトの見出し」で、長さを持っていなかった。
// ============================================================
// 列の途中に 8 バイトの目印（0x10, 0x08）が挟まるので、合わない語は 4 バイトずつ読み飛ばす。
// 「長さ = 12 + 幅×高さ×2」が3つの値の一致を要求するので、当てずっぽうでは通らない
// テクスチャファイルの署名。実物 24 件で一致した:
//   語0 = テクスチャの組数（パレット＋画像。転送はこの2倍）
//   語1 = 0x10
//   語2 = 8 か 9（色数の区別）
//   語3 = 最初のパレットの長さ。0x2C = 12+16×2（16色） / 0x20C = 12+256×2（256色）
function textureInfoT1(d){
  if(d.length<16) return null;
  const dv=new DataView(d.buffer,d.byteOffset,d.byteLength);
  const n=dv.getUint32(0,true), a=dv.getUint32(4,true), b=dv.getUint32(8,true), c=dv.getUint32(12,true);
  if(a!==0x10||(b!==8&&b!==9)||(c!==0x2C&&c!==0x20C)) return null;
  if(n<1||n>4096) return null;
  return {pairs:n, colors:c===0x2C?16:256, depth:b};
}
function vramChainT1(d,start,maxMiss){
  const dv=new DataView(d.buffer,d.byteOffset,d.byteLength);
  const out=[]; let o=start===undefined?0:start, miss=0;
  const MISS=maxMiss===undefined?16:maxMiss;
  while(o+12<=d.length&&out.length<8192){
    const len=dv.getUint32(o,true);
    const x=dv.getUint16(o+4,true), y=dv.getUint16(o+6,true), w=dv.getUint16(o+8,true), h=dv.getUint16(o+10,true);
    const ok=w>=1&&h>=1&&x<=1023&&y<=511&&x+w<=1024&&y+h<=512&&len===12+w*h*2&&o+len<=d.length;
    if(ok){ out.push({x,y,w,h,off:o+12}); o+=len; miss=0; continue }
    if(++miss>MISS) break;
    o+=4;
  }
  return out;
}
function findVramChainT1(d){
  const info=textureInfoT1(d);
  // 署名があるなら、語0 から求まる枚数（組数×2）がそろうまで、多少の目印は読み飛ばして拾い続ける
  const list=vramChainT1(d,0,info?Math.max(64,info.pairs*4):16);
  if(!list.length) return null;
  if(info) return {start:0,list,info};
  return list.length>=2?{start:0,list,info:null}:null;
}
function buildVramT1(d,list){
  const vram=new Uint8Array(1024*512*4);
  for(const t of list){
    for(let j=0;j<t.h;j++) for(let i=0;i<t.w;i++){
      const q=((t.y+j)*1024+t.x+i)*4, s=t.off+(j*t.w+i)*2;
      if(s+1<d.length){ vram[q]=d[s]; vram[q+1]=d[s+1] }
    }
  }
  return vram;
}

// ============================================================
//  トバルNo.1 のモデルの署名
//  実物のふるい分けで、0x90000000 で始まるファイル群が見つかった。
//    種類A: 90000000 | 14 | 0 0 0 | 位置4つ …      109部分・展開後 4KB 前後
//           （sector 6016〜6312。モーションかクエストのデータらしい）
//    種類B: 90000000 | 3C か 34 | 04 | 位置4つ | 04  4部分・展開後 30〜43KB
//           （sector 5529, 5544, 5737, 5927, 5943, 8755, 9289。キャラクターのモデル）
//  語1 が「位置の表」までの距離。
// ============================================================
function modelInfoT1(d){
  if(d.length<16) return null;
  const dv=new DataView(d.buffer,d.byteOffset,d.byteLength);
  if(dv.getUint32(0,true)!==0x90000000) return null;
  const tableAt=dv.getUint32(4,true);
  const offs=[];
  for(let o=8;o+4<=Math.min(d.length,8+128);o+=4){
    const v=dv.getUint32(o,true);
    if(v>=16&&v<d.length) offs.push({at:o,v});
  }
  return {tableAt, offs:offs.slice(0,16), size:d.length,
          kind:(tableAt===0x14?"A（部分が多い・小さい）":"B（キャラクターのモデルらしい）")};
}
