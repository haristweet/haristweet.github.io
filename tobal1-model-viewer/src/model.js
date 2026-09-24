function walk(blk,start){
  const dv=new DataView(blk.buffer,blk.byteOffset,blk.byteLength);
  const L={"-3":8,"-7":8,"3":8,"6":8,"1":12,"2":16,"-10":36,"-8":8,"-9":16,"-11":24,"-12":8};
  const ops=[]; let o=start===undefined?0x20:start;
  for(let n=0;n<100000&&o+8<=blk.length;n++){
    const u=dv.getUint32(o,true), c=dv.getInt32(o,true), a=dv.getInt32(o+4,true);
    if(((u&0xff000000)>>>0)===0x80000000||c===0) break;
    if(c===-4){o+=a; continue}
    if(L[c]){const args=[]; for(let k=4;k<L[c];k+=4) args.push(dv.getInt32(o+k,true)); ops.push([c,args]); o+=L[c]; continue}
    if(c>=7&&c<=70){ops.push([c,[a]]); o+=8; continue}
    break;
  }
  return ops;
}
const mat=(A,B)=>{const r=new Array(9); for(let i=0;i<3;i++)for(let j=0;j<3;j++)r[i*3+j]=A[i*3]*B[j]+A[i*3+1]*B[3+j]+A[i*3+2]*B[6+j]; return r};
const apply=(R,v)=>[R[0]*v[0]+R[1]*v[1]+R[2]*v[2],R[3]*v[0]+R[4]*v[1]+R[5]*v[2],R[6]*v[0]+R[7]*v[1]+R[8]*v[2]];
function ortho(R){
  const n=v=>{const l=Math.hypot(...v)||1; return v.map(x=>x/l)};
  const x=n([R[0],R[3],R[6]]), b=[R[1],R[4],R[7]], d=x[0]*b[0]+x[1]*b[1]+x[2]*b[2];
  const y=n([b[0]-d*x[0],b[1]-d*x[1],b[2]-d*x[2]]), z=[x[1]*y[2]-x[2]*y[1],x[2]*y[0]-x[0]*y[2],x[0]*y[1]-x[1]*y[0]];
  return [x[0],y[0],z[0],x[1],y[1],z[1],x[2],y[2],z[2]];
}
function bonesFromBlock(blk){
  const dv=new DataView(blk.buffer,blk.byteOffset,blk.byteLength);
  const h11=dv.getUint32(0x2c,true);
  if(h11<8||h11+0x30>blk.length) return Array.from({length:41},()=>[0,0,0]);   // 骨の表が無い／壊れているとき
  const size=Math.max(0,Math.min(dv.getUint32(h11+0x2c,true),blk.length-h11-0x30)), base=h11+0x30, bones=[];
  for(let k=0;k<Math.max(41,size/8);k++) bones.push(k<size/8?[dv.getInt16(base+k*8,true),dv.getInt16(base+k*8+2,true),dv.getInt16(base+k*8+4,true)]:[0,0,0]);
  return bones;
}
function pose(bones,local=REST_LOCAL){
  const W={};
  for(const s of SLOT_ORDER){
    const [p,bi]=SLOTS[s];
    let L=local[s]||I3; if(FIXED[s]) L=mat(FIXED[s],L);
    if(p===null){W[s]={R:mat(ROOT,L),T:[0,0,0]}; continue}
    const P=W[p], off=apply(P.R,bi===null?[0,0,0]:bones[bi]);
    W[s]={R:mat(P.R,L),T:[P.T[0]+off[0],P.T[1]+off[1],P.T[2]+off[2]]};
  }
  return finishSlots(W,bones);
}
// 主要な枠（0〜17, 30, 31）から、胸・頭・中間の枠や付属部品の枠を足す
function finishSlots(W,bones){
  if(!W[41]) W[41]={R:mat(W[10].R,RZ180),T:W[10].T};
  if(!W[42]) W[42]={R:mat(W[11].R,FIXED[42]),T:W[11].T};
  for(const [m,[a,b]] of Object.entries(MID)) if(!W[m]) W[m]={R:ortho(W[a].R.map((v,i)=>(v+W[b].R[i])/2)),T:W[b].T};
  // 眼球（勝利モデルだけ骨の表の 36・37 に位置が入る）。首の枠からの位置で、向きは首と同じ
  for(const [s,bi] of [[80,36],[81,37]]){
    const b=bones[bi]; if(!b||b[0]===-25600) continue;
    const off=apply(W[11].R,b); W[s]={R:W[11].R,T:[W[11].T[0]+off[0],W[11].T[1]+off[1],W[11].T[2]+off[2]]};
  }
  // 腰から垂れる部品（58・59番。試合中はゆれるが、基本は胴の枠を Z 軸で半回転した向き。メモリの行列から求めた）
  W[68]=W[69]={R:mat(W[10].R,RZ180),T:W[10].T};
  // しっぽ（イール）: 骨の表 20 が腰からの付け根、21〜24 が各節の長さ。基本はまっすぐ後ろ向き
  if(bones[20]&&bones[20][0]!==-25600){
    const off=apply(W[1].R,bones[20]); let prev={R:mat(W[1].R,[0,1,0,-1,0,0,0,0,1]),T:[W[1].T[0]+off[0],W[1].T[1]+off[1],W[1].T[2]+off[2]]};
    W[20]=prev;
    for(let k=21;k<=24;k++){ const o=apply(prev.R,bones[k]); prev={R:prev.R,T:[prev.T[0]+o[0],prev.T[1]+o[1],prev.T[2]+o[2]]}; W[k]=prev }
  }
  // 2P モデルの中心線の頂点（62番）: 左右の太ももの中間
  W[51]={R:ortho(W[2].R.map((v,i)=>(v+W[6].R[i])/2)),T:W[2].T.map((v,i)=>(v+W[6].T[i])/2)};
  return W;
}
// lay = {dl, vp, fp, cp}。省略するとトバル2 の並び（描画命令 0x20、頂点/面/色はヘッダから）
function buildMesh(blk,W,lay){
  const dv=new DataView(blk.buffer,blk.byteOffset,blk.byteLength);
  const h=k=>k*4+4<=blk.length?dv.getUint32(k*4,true):0;   // 短いブロックでも落ちないように
  lay=lay||{dl:0x20,vp:h(5)+16,fp:h(4)+16,cp:h(7)+16};
  W=W||pose(bonesFromBlock(blk));
  const jointMat=j=>{const s=DLMAP[j]; return (s!==undefined&&W[s])||W[42]};
  const PRIM={24:[3,8,1],25:[4,8,1],28:[3,20,1],29:[4,20,1],32:[3,4,0],33:[4,4,0],34:[3,16,0],35:[4,16,0]};
  let vp=lay.vp, fp=lay.fp, cp=lay.cp, cur=W[42];
  const verts=[], vcol=[], slot={}, slotcol={}, pos=[], col=[], t0=[], t1=[], sm=[];
  const TEXTURED={28:1,29:1,34:1,35:1};
  for(const [c,a] of walk(blk,lay.dl)){
   try{
    if(c===-3) cur=jointMat(a[0]);
    else if(c===-7) cp+=a[0];
    else if(c===1||c===2){
      const [s0,n]=a;
      for(let k=0;k<n;k++){
        const v=[dv.getInt16(vp+k*8,true),dv.getInt16(vp+k*8+2,true),dv.getInt16(vp+k*8+4,true)];
        const r=apply(cur.R,v);
        if(c===2){slotcol[s0+k]=[blk[cp],blk[cp+1],blk[cp+2]]; cp+=4}
        slot[s0+k]=verts.length; verts.push([r[0]+cur.T[0],r[1]+cur.T[1],r[2]+cur.T[2]]); vcol.push(slotcol[s0+k]||null);  // 座標はそのまま使う（ベルトの文字が正しく読める向き）
      }
      vp+=n*8;
    } else if(PRIM[c]){
      const [nv,sz,flat]=PRIM[c];
      for(let p=0;p<a[0];p++){
        const w=dv.getUint32(fp,true), idx=[w&255,(w>>>8)&255,(w>>>16)&255,(w>>>24)&255].slice(0,nv);
        let fc=null, uvs=null, tp=[0,0,0,0,0];
        if(TEXTURED[c]){
          // UV0, パレット位置, UV1, テクスチャページ, UV2, UV3（単色テクスチャ面は語1が色ではないので無視）
          const q=fp+(flat?8:4), clut=dv.getUint16(q+2,true), page=dv.getUint16(q+6,true);
          uvs=[[blk[q],blk[q+1]],[blk[q+4],blk[q+5]],[blk[q+8],blk[q+9]],[blk[q+10],blk[q+11]]];
          tp=[[4,8,16,16][(page>>7)&3],(page&15)*64,((page>>4)&1)*256,(clut&63)*16,clut>>6];
        }
        if(flat){ // 語1 = 法線の番号(下位8bit) と 色の番号(次の8bit)。色は現在の色の列から ×4 バイト目（ゲームの描画処理 0x800248a0 と同じ）
          const ci=cp+((dv.getUint32(fp+4,true)>>>8)&255)*4; fc=[blk[ci],blk[ci+1],blk[ci+2]] }
        fp+=sz;
        if(!idx.every(i=>slot[i]!==undefined)) continue;
        const vi=idx.map(i=>slot[i]);
        const tris=nv===3?[[0,1,2]]:[[0,1,3],[1,2,3]];   // 四角形はデータの輪の順。GPU へは 0,1,3,2 で送られる
        if(!fc){ const cs=vi.map(v=>vcol[v]).filter(Boolean); if(cs.length) fc=[0,1,2].map(ch=>cs.reduce((t,x)=>t+x[ch],0)/cs.length) }
        for(let q=0;q<tris.length;q++) sm.push(flat?0:1);
        for(const t of tris) for(const k of t){ pos.push(...verts[vi[k]]); col.push(...(flat?fc:vcol[vi[k]]||fc||[128,128,128]));
          if(uvs){ t0.push(uvs[k][0],uvs[k][1],tp[0]); t1.push(tp[1],tp[2],tp[3],tp[4]) } else { t0.push(0,0,0); t1.push(0,0,0,0) } }
      }
    }
   }catch(_e){ break }   // 想定と違う並びのファイルでも、読めたところまでは見せる
  }
  return {pos:new Float32Array(pos), col:new Float32Array(col.map(x=>x/255)), t0:new Float32Array(t0), t1:new Float32Array(t1), sm:new Uint8Array(sm)};
}
