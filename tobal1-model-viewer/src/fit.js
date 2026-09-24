// ============================================================
//  モデルの並びを自分で合わせる
//  トバル2 のモデルは「描画命令が 0x20 から、頂点/面/色の位置がヘッダの語 5/4/7（+16）」
//  という並びだった。No.1 で違っていても動くように、そのままで三角形が取れなかったら
//  ブロックを見て並びを割り出す。
// ============================================================
// 組めた形の「広がり」。三角形が出ていても、全部同じ点に潰れていれば当たっていない
function meshExtent(mesh){
  const P=mesh.pos; if(!P.length) return 0;
  const mn=[1e9,1e9,1e9], mx=[-1e9,-1e9,-1e9];
  for(let i=0;i<P.length;i+=3) for(let a=0;a<3;a++){ const v=P[i+a]; if(v<mn[a])mn[a]=v; if(v>mx[a])mx[a]=v }
  return Math.max(mx[0]-mn[0],mx[1]-mn[1],mx[2]-mn[2]);
}
const PRIM_NV={24:3,25:4,28:3,29:4,32:3,33:4,34:3,35:4};
const PRIM_SZ={24:8,25:8,28:20,29:20,32:4,33:4,34:16,35:16};
// 描画命令がどこから始まるか。頂点を置く命令と面を描く命令の両方が出るところを選ぶ
function dlCandidates(blk){
  const dv=new DataView(blk.buffer,blk.byteOffset,blk.byteLength);
  const out=new Set([0x20,0x10,0x18,0x28,0x30,0x38,0x40,0x08,0x0c,0x14,0x1c,0x24,0x2c,0x34]);
  // ヘッダの語が指す先そのもの。トバル2 は 0x20 固定だったが、No.1 はヘッダに位置が書いてある
  for(let hi=0;hi<Math.min(32,blk.length>>2);hi++){
    const w=dv.getUint32(hi*4,true);
    if(w<8||w+16>blk.length) continue;
    for(const b of [8,0,16]) if(w+b+16<=blk.length) out.add(w+b);
  }
  return [...out];
}
function fitDisplayList(blk){
  let best=null;
  for(const dl of dlCandidates(blk)){
    if(dl+8>blk.length) continue;
    const ops=walk(blk,dl);
    let nv=0, nprim=0, faceBytes=0, hasVert=false;
    for(const [c,a] of ops){
      if(c===1||c===2){ hasVert=true; nv=Math.max(nv,a[0]+a[1]) }
      else if(PRIM_NV[c]){ nprim+=a[0]; faceBytes+=a[0]*PRIM_SZ[c] }
    }
    if(!hasVert||!nprim||nv<3||nv>65536) continue;
    const LEN={"-3":8,"-7":8,"3":8,"6":8,"1":12,"2":16,"-10":36,"-8":8,"-9":16,"-11":24,"-12":8};
    let end=dl; for(const [c] of ops) end+=LEN[c]||8;
    const sc=nprim+ops.length;
    if(!best||sc>best.sc) best={dl,ops,nv,nprim,faceBytes,sc,end};
  }
  return best;
}
// ヘッダの語を順に「ここが頂点/面の置き場所では」と当てて、いちばん筋が通るものを選ぶ
// 置き場所は描画命令より後ろにあるはず。ヘッダや命令の列そのものを頂点表と間違えないように
function fitPointer(blk,need,test,after){
  const dv=new DataView(blk.buffer,blk.byteOffset,blk.byteLength);
  const n=Math.min(24,blk.length>>2);
  let top=null;
  for(let hi=0;hi<n;hi++){
    const w=dv.getUint32(hi*4,true);
    if(w>blk.length) continue;
    for(const bias of [0,8,16,-16]){
      const p=w+bias;
      if(p<Math.max(8,after||0)||p+need>blk.length) continue;
      const s=test(p);
      if(s>0&&(!top||s>top.s)) top={p,s,word:hi,bias};
    }
  }
  return top;
}
function fitLayout(blk){
  const d=fitDisplayList(blk); if(!d) return null;
  const dv=new DataView(blk.buffer,blk.byteOffset,blk.byteLength);
  // 頂点: 16bit×3（＋余り2）で、座標が人の大きさに収まり、全部 0 ではないところ
  const vp=fitPointer(blk,d.nv*8,p=>{
    let ok=0, nz=0;
    for(let k=0;k<d.nv;k++){
      const x=dv.getInt16(p+k*8,true), y=dv.getInt16(p+k*8+2,true), z=dv.getInt16(p+k*8+4,true);
      if(Math.abs(x)<6000&&Math.abs(y)<6000&&Math.abs(z)<6000) ok++;
      if(x||y||z) nz++;
    }
    // 中身が詰まっているほど良い。後ろが 0 で埋まった所（ずらしすぎ）を選ばないため
    return nz<2?0:(ok/d.nv)*(nz/d.nv);
  },d.end);
  if(!vp) return null;
  // 面: 最初の面の並びの頂点番号が、置いた頂点の数に収まるところ
  const first=d.ops.find(([c])=>PRIM_NV[c]);
  const fp=fitPointer(blk,Math.max(64,d.faceBytes),p=>{
    if(!first) return 0;
    const [c,a]=first, nv=PRIM_NV[c], sz=PRIM_SZ[c];
    let ok=0, n=0, nz=0;
    for(let i=0;i<Math.min(a[0],12);i++){
      if(p+i*sz+4>blk.length) break;
      const w=dv.getUint32(p+i*sz,true);
      const idx=[w&255,(w>>>8)&255,(w>>>16)&255,(w>>>24)&255].slice(0,nv);
      n++; if(idx.every(v=>v<d.nv)) ok++; if(w) nz++;
    }
    return n?(ok/n)*(nz/n):0;
  },d.end);
  if(!fp) return null;
  // 色: 残った語のうち、範囲に収まるものを1つ（外しても形は出る）
  const cp=fitPointer(blk,64,p=>(p!==vp.p&&p!==fp.p)?0.5:0.1,d.end);
  return {dl:d.dl, vp:vp.p, fp:fp.p, cp:cp?cp.p:fp.p,
          how:`描画命令 ${hex(d.dl,4)} / 頂点 語${vp.word}${vp.bias>=0?"+":""}${vp.bias} / 面 語${fp.word}${fp.bias>=0?"+":""}${fp.bias}`,
          nv:d.nv, nprim:d.nprim};
}
