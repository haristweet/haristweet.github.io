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
function objPolys(g){
  const dv=new DataView(g.buffer,g.byteOffset,g.byteLength), out=[];
  let P0=null, P1=null;
  const v=o=>[dv.getFloat32(o,true),dv.getFloat32(o+4,true),dv.getFloat32(o+8,true)];
  for(let r=0;r+40<=g.length;r+=40){
    const h=dv.getUint32(r,true), kind=h&3, link=h>>8&3;
    if(!kind) break;
    const n=v(r+4), A=v(r+16), B=v(r+28);
    if(!link){ P0=A; P1=B; continue }
    out.push({h,n,v:kind===2?[P0,P1,A]:[P0,P1,B,A]});
    if(link===2){ P0=A; P1=B } else if(link===1) P1=A; else P0=B;
  }
  return out;
}
