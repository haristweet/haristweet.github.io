// PS1 の標準のモデル形式 TMD を読む（MODEL.BIN の中身はこれが並んだもの）。
// tmdRead(u8, off) → {objs:[{verts:[[x,y,z]], prims:[{v:[番号], uv:[[u,v]]|null, cba, tsb, col, mode, flag}], bad}]}
// 1 つの部品の並び（ilen）と、モード・フラグから計算した長さが合わないものは bad に数える（読み方の確かめ）
function tmdRead(u8,off){
  const dv=new DataView(u8.buffer,u8.byteOffset,u8.byteLength);
  const h=i=>dv.getInt16(i,true), w=i=>dv.getUint32(i,true);
  if(w(off)!==0x41) return null;
  const flags=w(off+4), n=w(off+8), top=off+12, objs=[];
  for(let k=0;k<n;k++){
    const o=top+k*28, base=flags&1?off:top;
    const vt=base+w(o), nv=w(o+4), pt=base+w(o+16), np=w(o+20);
    const verts=[]; for(let i=0;i<nv;i++) verts.push([h(vt+i*8),h(vt+i*8+2),h(vt+i*8+4)]);
    const prims=[]; let p=pt, bad=0;
    for(let i=0;i<np;i++){
      const ilen=u8[p+1], flag=u8[p+2], mode=u8[p+3], d=p+4;
      if(mode>>5===1){
        const quad=mode>>3&1, tme=mode>>2&1, iip=mode>>4&1, lgt=flag&1, grd=flag>>2&1, nn=quad?4:3;
        let q=d, uv=null, cba=0, tsb=0, col=null;
        if(tme){ uv=[]; for(let j=0;j<nn;j++){ uv.push([u8[q],u8[q+1]]); if(j===0) cba=dv.getUint16(q+2,true); if(j===1) tsb=dv.getUint16(q+2,true); q+=4 } }
        const ncol=lgt?(iip||grd?nn:1):(!tme?(grd?nn:1):0);
        if(ncol){ col=[]; for(let j=0;j<ncol;j++){ col.push([u8[q],u8[q+1],u8[q+2]]); q+=4 } }
        const idx=[]; let hw=q;
        if(lgt){ for(let j=0;j<nn;j++){ idx.push(dv.getUint16(hw,true)); hw+=2 } }
        else if(iip){ for(let j=0;j<nn;j++){ hw+=2; idx.push(dv.getUint16(hw,true)); hw+=2 } }
        else { hw+=2; for(let j=0;j<nn;j++){ idx.push(dv.getUint16(hw,true)); hw+=2 } }
        const len=((hw-d)+3)>>2;
        if(len!==ilen) bad++;
        // 四角は頂点 0,1,2,3 が Z の字の並び（0-1-3-2 で一周）
        const v=quad?[idx[0],idx[1],idx[3],idx[2]]:idx, uvs=uv&&(quad?[uv[0],uv[1],uv[3],uv[2]]:uv);
        prims.push({v,uv:uvs,cba,tsb,col,mode,flag});
      } else bad++;
      p=d+ilen*4;
    }
    objs.push({verts,prims,bad});
  }
  return {objs};
}
