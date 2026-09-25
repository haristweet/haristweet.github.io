// OBJ_*.CMP（展開後）のモデル。1ファイル＝[数][モデル…]、モデル＝[番号][塊×4]、塊＝[長さ][中身]。
// 塊0: 面ごとの属性 8B、塊1: 同じ形の表（用途未確定）、塊2: 面ごとの UV 4組（16bit×2×4）、塊3: 面の記録 40B
function objModels(u8){
  const dv=new DataView(u8.buffer,u8.byteOffset,u8.byteLength), n=dv.getUint32(0,true), out=[];
  let p=4;
  for(let k=0;k<n;k++){
    const id=dv.getUint32(p,true), ch=[]; p+=4;
    for(let c=0;c<4;c++){ const L=dv.getUint32(p,true); ch.push(u8.subarray(p+4,p+4+L)); p+=4+L }
    out.push({id,ch});
  }
  if(p!==u8.length) throw new Error(`モデルの区切りが合わない ${p} ≠ ${u8.length}`);
  return out;
}
// 面の記録: +0 頭（bit0-1 形 0=終わり 1=四角 2=三角、bit8-9 つなぎ方）、+4 法線、+0x10 頂点A、+0x1c 頂点B。
// 手元の2点 P0,P1 と A,B で面 (P0,P1,B,A) を作る。つなぎ方 0=描かずに P0=A,P1=B、2=P0=A,P1=B、1=P1=A、3=P0=B
// （本体 SLPM_625.47 の 0x1c9cc0 を写したもの）
// 面ごとの属性（塊0 の 8B＝16bit×4）と UV（塊2、1/8 画素）も返す。
// 属性の位置は面の頭の bit12-16（符号付き）×8B ずつ進む。UV は描いた面ごとに四角 16B・三角 12B、
// つなぎ方 0 の記録も（最初の1つを除き）1つぶん進む（本体 0x1c6380）
function objPolys(g,A,U){
  const dv=new DataView(g.buffer,g.byteOffset,g.byteLength), out=[];
  const av=A&&new DataView(A.buffer,A.byteOffset,A.byteLength), uvv=U&&new DataView(U.buffer,U.byteOffset,U.byteLength);
  let P0=null, P1=null, ai=0, fp=0, drawn=false;
  const v=o=>[dv.getFloat32(o,true),dv.getFloat32(o+4,true),dv.getFloat32(o+8,true)];
  for(let r=0;r+40<=g.length;r+=40){
    const h=dv.getUint32(r,true), kind=h&3, link=h>>8&3, step=kind===1?16:12;
    if(!kind) break;
    const n=v(r+4), A_=v(r+16), B=v(r+28);
    if(!link){ P0=A_; P1=B; if(drawn) fp+=step }
    else {
      const p={h,n,v:kind===2?[P0,P1,A_]:[P0,P1,B,A_]};
      if(av){ p.attr=[0,2,4,6].map(k=>av.getUint16(ai*8+k,true)) }
      if(uvv){ const uv=[]; for(let j=0;j<(kind===1?4:3);j++) uv.push([uvv.getUint16(fp+j*4,true),uvv.getUint16(fp+j*4+2,true)]);
        // UV の並びは (P1,P0,A,B)（写しの中の変換済みモデルの ST と照らして確かめた）。頂点の順 (P0,P1,B,A) に合わせる
        p.uv=kind===1?[uv[1],uv[0],uv[3],uv[2]]:[uv[1],uv[0],uv[2]] }
      out.push(p); drawn=true; fp+=step;
      if(link===2){ P0=A_; P1=B } else if(link===1) P1=A_; else P0=B;
    }
    const d=h>>12&31; ai+=d>=16?d-32:d;
  }
  return out;
}
