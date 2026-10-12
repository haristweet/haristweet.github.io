// WE2012（PS2）のデータを読む。ブラウザでも node（vm）でも動くように、最上位の関数だけで書く。
// 数は全部リトルエンディアン。

// ── AFS（0_TEXT.AFS など）: "AFS\0"・個数・(位置,大きさ)×個数。名前の表は無い ──
function weAfsIndex(u){
  const dv=new DataView(u.buffer,u.byteOffset,u.byteLength);
  if(dv.getUint32(0,true)!==0x00534641) throw new Error("AFS ではない");
  const n=dv.getUint32(4,true), ents=[];
  for(let i=0;i<n;i++) ents.push({off:dv.getUint32(8+i*8,true),size:dv.getUint32(12+i*8,true)});
  return ents;
}
// AFS の中の 1 ファイル: 頭 32 バイト（[0]=0x10600 なら圧縮、[1]=縮めた大きさ、[2]=ほどいた大きさ）のあとが zlib。
// inflate は呼ぶ側が渡す（node は zlib.inflateSync、ブラウザは DecompressionStream）
function weAfsHead(b){
  const dv=new DataView(b.buffer,b.byteOffset,b.byteLength);
  return {kind:dv.getUint32(0,true),csize:dv.getUint32(4,true),usize:dv.getUint32(8,true)};
}

// ── 入れもの: [個数, 8, 頭の大きさ, 位置1, 位置2, …]。1 つ目は頭の大きさの所から ──
function weParts(u){
  const dv=new DataView(u.buffer,u.byteOffset,u.byteLength), n=dv.getUint32(0,true);
  if(n<1||n>64||dv.getUint32(4,true)!==8) return [{off:0,end:u.length}];
  const offs=[dv.getUint32(8,true)];
  for(let k=1;k<n;k++) offs.push(dv.getUint32(8+k*4,true));
  return offs.map((o,k)=>({off:o,end:k+1<n?offs[k+1]:u.length}));
}
function weKind(u,o){
  const dv=new DataView(u.buffer,u.byteOffset,u.byteLength), w=dv.getUint32(o,true);
  return w===0x29857294?"tex":w===0xffff0003?"model":"?";
}

// ── 絵: 頭 0x29857294。[4]=点の位置(下16)・色表の位置(上16)、[5]=幅・高さ、[6] の 2 バイト目＝形式（0x13=8bit、0x14=4bit） ──
// 8bit の色表は PS2 の並べ替え（8 色ずつの 2・3 組目を入れ替え）。α は 0x80 が不透明
function weTex(u,o){
  const dv=new DataView(u.buffer,u.byteOffset,u.byteLength);
  const a=dv.getUint32(o+16,true), pix=o+(a&0xffff), pal=o+(a>>>16);
  const wh=dv.getUint32(o+20,true), W=wh&0xffff, H=wh>>>16, psm=(dv.getUint32(o+24,true)>>8)&0xff;
  const rgba=new Uint8Array(W*H*4), col=i=>{ const p=pal+i*4; return [u[p],u[p+1],u[p+2],Math.min(255,u[p+3]*2)] };
  if(psm===0x13){
    const cl=[]; for(let i=0;i<256;i++) cl.push(col((i&0xe7)|((i&0x10)>>1)|((i&0x08)<<1)));
    for(let i=0;i<W*H;i++) rgba.set(cl[u[pix+i]],i*4);
  } else if(psm===0x14){
    const cl=[]; for(let i=0;i<16;i++) cl.push(col(i));
    for(let i=0;i<W*H;i++) rgba.set(cl[(u[pix+(i>>1)]>>((i&1)*4))&15],i*4);
  } else return {W,H,psm,rgba:null};
  return {W,H,psm,rgba};
}

// ── 形: 頭 0xffff0003。[8]=包みの数、[9]=最初の包みの位置。包み＝[大きさ, 0, VIF の位置, …] のあとに VIF の命令列 ──
// VIF の UNPACK: 0x69（V3-16）を 4 番地に＝位置、5 番地＝法線、0x65（V2-16）を 7 番地＝UV（/4096）。
// 0x6d（V4-16）を 0xc0xx 以降に＝頂点の並び（値/4−1 が頂点の番号、0x8000 の印は「三角形を閉じない」）。並びは帯（ストリップ）
function weVifSize(cmd,num){ const vn=(cmd>>2)&3, vl=cmd&3, bits=vl===3?16:(vn+1)*(32>>vl); return Math.ceil(num*bits/32)*4 }
function weVifWalk(u,p,end){
  const dv=new DataView(u.buffer,u.byteOffset,u.byteLength), out=[];
  while(p+4<=end){
    const w=dv.getUint32(p,true), cmd=(w>>>24)&0x7f, num=(w>>>16)&0xff, imm=w&0xffff; let q=p+4;
    if(cmd>=0x60){ const n=num||256; out.push({cmd,num:n,addr:imm&0x3ff,flg:imm>>15,at:q}); q+=weVifSize(cmd,n) }
    else if(cmd===0x20) q+=4;
    else if(cmd===0x30||cmd===0x31) q+=16;
    else if(cmd===0x50||cmd===0x51) q+=(imm||65536)*16;
    else if(cmd===0x4a) q+=(num||256)*8;
    else if(!(cmd<=7||cmd===0x10||cmd===0x11||cmd===0x13||cmd===0x14||cmd===0x15||cmd===0x17)) break;
    p=q;
  }
  return out;
}
// 形を三角形の並びにする。{tris:[{p:[[x,y,z]×3], uv:[[s,t]×3], n:[[…]×3], pk}], packets}
function weModel(u,b){
  const dv=new DataView(u.buffer,u.byteOffset,u.byteLength);
  const npk=dv.getUint32(b+0x20,true); let po=b+dv.getUint32(b+0x24,true);
  const tris=[], packets=[];
  for(let k=0;k<npk;k++){
    const size=dv.getUint32(po,true), vifAt=po+dv.getUint32(po+8,true);
    const un=weVifWalk(u,vifAt,po+size);
    const get=(cmd,addr)=>un.find(x=>x.cmd===cmd&&x.addr===addr);
    const P=get(0x69,4), N=get(0x69,5), T=get(0x65,7), I=un.filter(x=>x.cmd===0x6d&&x.addr>=0x40).pop();
    if(P&&I){
      const s16=a=>dv.getInt16(a,true), V=[], NV=[], UV=[];
      for(let i=0;i<P.num;i++){ V.push([s16(P.at+i*6),s16(P.at+i*6+2),s16(P.at+i*6+4)]);
        NV.push(N?[s16(N.at+i*6)/32768,s16(N.at+i*6+2)/32768,s16(N.at+i*6+4)/32768]:[0,0,1]);
        UV.push(T?[s16(T.at+i*4)/4096,s16(T.at+i*4+2)/4096]:[0,0]) }
      const nIdx=dv.getUint32(po+12,true), idx=[];
      for(let i=0;i<I.num*4;i++) idx.push(dv.getUint16(I.at+i*2,true));
      let a=-1,c=-1,nt=0;
      for(let i=0;i<idx.length;i++){
        const w=idx[i], v=((w&0x7fff)>>2)-1;
        if(!(w&0x8000)&&a>=0&&c>=0&&v>=0&&v<V.length&&a<V.length&&c<V.length){
          const f=nt++&1?[c,a,v]:[a,c,v];
          tris.push({p:f.map(j=>V[j]),uv:f.map(j=>UV[j]),n:f.map(j=>NV[j]),pk:k}) }
        else if(w&0x8000) nt=0;
        a=c; c=v;
      }
      packets.push({at:po,nv:P.num,nIdx,idx});
    }
    po+=size;
  }
  return {tris,packets};
}
