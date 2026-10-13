// 体（v0.4.0）。永井の試合中のセーブ（nagai2）で、描く命令の並びとゲームの行列（0x485000 から 0x40 ごと）を照らして読み方を決めた
//   体のファイル #1429: [数 2, 8, 形の位置, 細かさ違いの形の位置]。形の頭: +8＝骨の行列（19 本、立ち姿＝T の形、行ベクトル・平行移動は最後の行）、
//   +0x10＝親の表（i16）、+0x14/+0x18＝骨の対の数と表（28 対、u16 2 つ）、+0x20/+0x24＝包みの数と位置
//   包み: +0x1C＝使う骨の数 nB、+0x24＝使う対の数 nP、+0x18＝番号の並びの位置（前 nB 個＝骨の番号、後ろ nP 個＝対の番号）、+0x34＝部位（sel）、+0x43＝出し分けの番号
//   頂点は小分け（1 つの組に行列 1〜4 個）。組の説明（6d 2 つ＋75）＝[0,0,始め,終わり,行列の番地…]。行列の番地は頂点の後ろから 4 つずつ＝並びの何番目か
//   頂点 1 つ＝4 qword: 位置（s16、1/16）、法線、重み（行列ごと、足して 4095）、uv（/4096）
//   対 p＝(a,b) の行列＝Bind[a]·inv(Bind[b])·Cur[b]（ゲームの行列 28 個と 0.000 まで一致）。頂点は骨 a の向きで持ち、骨 b と一緒に動く
const JW_BODY=1429;
// 出し分けの番号のうち、永井の試合中のセーブで描かれていたもの（長袖・素手など。ほかの組み合わせ（半袖・手袋など）は未確認）
const JW_BODY_OPTS=new Set([0,3,5,6,7,9,12,14,15,17,20,30,37]);
// 部位: 0＝肌（#8231 の頭の肌と同じ絵）、1＝ユニフォーム 512×256、5＝スパイク 256×256。2・3・4・7・9・10＝背番号・名前・袖の印などの重ね（後回し、描かない）
const JW_BODY_SELS=[0,1,5];
function jwM4(A,C){ const R=new Array(16); for(let i=0;i<4;i++) for(let j=0;j<4;j++){ let s=0; for(let k=0;k<4;k++) s+=A[i*4+k]*C[k*4+j]; R[i*4+j]=s } return R }
function jwInv(M){
  const [a,b,c,,d,e,f,,g,h,i]=M, det=a*(e*i-f*h)-b*(d*i-f*g)+c*(d*h-e*g);
  const I=[(e*i-f*h)/det,(c*h-b*i)/det,(b*f-c*e)/det,(f*g-d*i)/det,(a*i-c*g)/det,(c*d-a*f)/det,(d*h-e*g)/det,(b*g-a*h)/det,(a*e-b*d)/det], t=[M[12],M[13],M[14]];
  return [I[0],I[1],I[2],0,I[3],I[4],I[5],0,I[6],I[7],I[8],0,...[0,1,2].map(j=>-(t[0]*I[j]+t[1]*I[3+j]+t[2]*I[6+j])),1];
}
function jwBodyParse(u){
  const dv=new DataView(u.buffer,u.byteOffset,u.byteLength), b=dv.getUint32(8,true);
  const nb=dv.getUint32(b+0x0c,true), mo=b+dv.getUint32(b+0x08,true), pa=b+dv.getUint32(b+0x10,true), pt=b+dv.getUint32(b+0x18,true);
  if(nb<1||nb>64) throw new Error("体のファイルとして読めません");
  const Bind=[], par=[], pairs=[];
  for(let k=0;k<nb;k++){ const f=[]; for(let i=0;i<16;i++) f.push(dv.getFloat32(mo+k*64+i*4,true)); Bind.push(f); par.push(dv.getInt16(pa+k*2,true)) }
  for(let i=0;i<dv.getUint32(b+0x14,true);i++) pairs.push([dv.getUint16(pt+i*4,true),dv.getUint16(pt+i*4+2,true)]);
  const npk=dv.getUint32(b+0x20,true), packs=[]; let po=b+dv.getUint32(b+0x24,true);
  for(let k=0;k<npk;k++){
    const size=dv.getUint32(po,true), un=weVifWalk(u,po+dv.getUint32(po+8,true),po+size), s16=a=>dv.getInt16(a,true);
    const nB=dv.getUint32(po+0x1c,true), nP=dv.getUint32(po+0x24,true), lo=po+dv.getUint32(po+0x18,true);
    const slots=[]; for(let i=0;i<nB+nP;i++){ const v=dv.getUint16(lo+i*2,true); slots.push(i<nB?{bone:v}:{pair:v}) }
    const desc=[];
    for(let j=0;j<un.length;j++){ const x=un[j]; if(x.cmd===0x6d&&x.num===2&&x.addr>=2&&un[j+1]?.cmd===0x75){ const v=[]; for(let i=0;i<8;i++) v.push(s16(x.at+i*2)); desc.push({s:v[2],e:v[3],mats:v.slice(4,8).filter(Boolean)}) } }
    const base=desc.length?desc[desc.length-1].e:0, verts=new Map();
    for(let j=0;j<un.length;j++){ const x=un[j];
      if(!(x.cmd===0x69&&un[j+1]&&un[j+1].cmd===0x69&&un[j+1].addr===x.addr+1&&un[j+1].num===x.num)) continue;
      let e=j; while(e+1<un.length&&un[e+1].num===x.num&&un[e+1].addr>un[e].addr&&un[e+1].addr<=x.addr+3) e++;
      const g=un.slice(j,e+1), N=un[j+1], uvU=g.find(y=>y.addr===x.addr+3&&y.cmd===0x65), wU=g.find(y=>y.addr===x.addr+2); j=e;
      const d=desc.find(d=>x.addr>=d.s&&x.addr<d.e), sl=d?d.mats.map(a=>slots[(a-base)/4]).filter(Boolean):[slots[0]];
      if(!sl.length) continue;
      for(let i=0;i<x.num;i++){
        let w=[1];
        if(sl.length>1&&wU){ const c=wU.cmd===0x65?2:3; w=[]; for(let q=0;q<Math.min(c,sl.length);q++) w.push(s16(wU.at+(i*c+q)*2)/4095); if(w.length<sl.length) w.push(Math.max(0,1-w.reduce((a,b)=>a+b,0))) }
        verts.set(x.addr+4*i,{p:[s16(x.at+i*6),s16(x.at+i*6+2),s16(x.at+i*6+4)],n:[s16(N.at+i*6),s16(N.at+i*6+2),s16(N.at+i*6+4)],sl,w,
          uv:uvU?[s16(uvU.at+i*4)/4096,s16(uvU.at+i*4+2)/4096]:[0,0]}) } }
    const I=un.filter(x=>x.cmd===0x6d).pop(), idx=[];
    if(I) for(let i=0;i<I.num*4;i++) idx.push(dv.getUint16(I.at+i*2,true));
    packs.push({k,sel:dv.getUint32(po+0x34,true),opt:dv.getUint8(po+0x43),verts,idx}); po+=size;
  }
  return {Bind,par,pairs,packs};
}
// 立ち姿: T の形から、肩（骨 9・10 の付け根）を中心に腕を下ろす（ゲームの立ち姿の動きはまだ読んでいない。角度は見た目で決めた）
function jwBodyStand(B,deg=72){
  const kids=r=>{ const out=[r]; B.par.forEach((p,k)=>{ if(p===r) out.push(...kids(k)) }); return out };
  const C=B.Bind.map(m=>m.slice());
  for(const [r,sg] of [[9,1],[10,-1]]){ if(r>=B.Bind.length) continue;
    const a=sg*deg*Math.PI/180, c=Math.cos(a), s=Math.sin(a), j=B.Bind[r].slice(12,15);
    const X=jwM4(jwM4([1,0,0,0,0,1,0,0,0,0,1,0,-j[0],-j[1],-j[2],1],[c,s,0,0,-s,c,0,0,0,0,1,0,0,0,0,1]),[1,0,0,0,0,1,0,0,0,0,1,0,j[0],j[1],j[2],1]);
    for(const k of kids(r)) C[k]=jwM4(B.Bind[k],X) }
  return C;
}
// 体の三角形（世界の座標、Y 上）。cur＝骨ごとの行列（省くと T の形）。show(P) で包みを選ぶ
function jwBodyTris(B,cur,show){
  const C=cur||B.Bind, cache=new Map(), tris=[];
  const matOf=s=>{ if(s.bone!==undefined) return C[s.bone]; if(!cache.has(s.pair)){ const [a,b]=B.pairs[s.pair]; cache.set(s.pair,jwM4(jwM4(B.Bind[a],jwInv(B.Bind[b])),C[b])) } return cache.get(s.pair) };
  for(const P of B.packs){ if(show&&!show(P)) continue;
    const W=new Map(); let a=null,c=null;
    for(const w of P.idx){ const key=w&0x7fff; let v=W.get(key);
      if(!v){ const r=P.verts.get(key);
        if(r){ const p=[0,0,0], n=[0,0,0];
          r.w.forEach((wt,i)=>{ const m=matOf(r.sl[i]); for(let j=0;j<3;j++){ p[j]+=wt*((r.p[0]*m[j]+r.p[1]*m[4+j]+r.p[2]*m[8+j])/16+m[12+j]); n[j]+=wt*(r.n[0]*m[j]+r.n[1]*m[4+j]+r.n[2]*m[8+j]) } });
          v={p,n,uv:r.uv}; W.set(key,v) } }
      if(!(w&0x8000)&&a&&c&&v){
        // 向き: 頂点の法線の和と同じ側を表にする（weModel と同じ考え）
        let f=[a,c,v]; const e1=c.p.map((x,i)=>x-a.p[i]), e2=v.p.map((x,i)=>x-a.p[i]), g=[e1[1]*e2[2]-e1[2]*e2[1],e1[2]*e2[0]-e1[0]*e2[2],e1[0]*e2[1]-e1[1]*e2[0]];
        if(g.reduce((s,x,i)=>s+x*(a.n[i]+c.n[i]+v.n[i]),0)<0) f=[c,a,v];
        tris.push({p:f.map(q=>q.p),uv:f.map(q=>q.uv),sel:P.sel}) }
      a=c; c=v } }
  return tris;
}
// 画面の座標: 世界の座標を Y 軸で 180° 回す（顔の向き＝世界の −Z を画面の手前に）。頭（顔・髪のファイル）の座標とそろえる
function jwWorldToView(p){ return [-p[0],p[1],-p[2]] }
// 体の形を、絵ごとの塊にする。tex: {0:肌,1:ユニフォーム,5:スパイク}
function jwBodyMeshes(B,cur,tex){
  const tris=jwBodyTris(B,cur,P=>JW_BODY_OPTS.has(P.opt)&&JW_BODY_SELS.includes(P.sel)), by=new Map();
  for(const t of tris){ if(!by.has(t.sel)) by.set(t.sel,[]); by.get(t.sel).push(t) }
  const ms=[];
  for(const [sel,ts] of by){ const f=new Float32Array(ts.length*15); let n=0;
    for(const t of ts) for(let j=0;j<3;j++){ const q=jwWorldToView(t.p[j]); f[n++]=q[0]; f[n++]=q[1]; f[n++]=q[2]; f[n++]=t.uv[j][0]; f[n++]=t.uv[j][1] }
    ms.push({f,ntri:ts.length,tex:tex[sel]||null,sel}) }
  return ms;
}
// 頭（weMeshes の座標＝ファイルの (z,−y,x)）を、骨 16（頭）の行列で体に付ける。ゲームも頭の包みに骨 16 の行列を使っていた
function jwPlaceHead(ms,M){
  const det=M[0]*(M[5]*M[10]-M[6]*M[9])-M[1]*(M[4]*M[10]-M[6]*M[8])+M[2]*(M[4]*M[9]-M[5]*M[8]);
  for(const m of ms){ const f=m.f;
    for(let k=0;k<f.length;k+=5){ const p=[f[k+2],-f[k+1],f[k]], w=[0,1,2].map(j=>(p[0]*M[j]+p[1]*M[4+j]+p[2]*M[8+j])/16+M[12+j]), q=jwWorldToView(w); f[k]=q[0]; f[k+1]=q[1]; f[k+2]=q[2] }
    // 行列が裏返し（行列式が負）なら、三角形の向きを戻す
    if(det<0) for(let k=0;k<f.length;k+=15) for(let j=0;j<5;j++){ const t=f[k+5+j]; f[k+5+j]=f[k+10+j]; f[k+10+j]=t } }
  return ms;
}
// ステートセーブのメモリにあるユニフォーム（512×256・8 ビット・色表つき。頭の +8 が 0x20440。同じ大きさの髪の地などは外す）とスパイク（256×256、色表は別の塊）
//   関口・田村の選手選択の画面のセーブでは中身のあるのが 2 着（仙台のホーム・仙台の GK）、梁のセーブでは 4 着、試合中の永井のセーブでは
//   4 着（磐田の 2 着・仙台の GK・仙台のアウェイ）。中身の無い枠や同じ絵の写し（頭の番号 0x1004）は外す。
//   どの枠が何かはセーブによって違う（ディスクのどのファイルかが分かるまでのつなぎ）
//   スパイクの色表は後ろに 23 個並ぶ色違いの 2 つ目（永井の画面と同じ）
function jwSaveKits(m){
  const dv=new DataView(m.buffer,m.byteOffset,m.byteLength), kits=[]; let boots=null; const pals=[];
  for(let o=0;o+64<=m.length;o+=16){
    if(dv.getUint32(o,true)!==0x29857294) continue;
    const a=dv.getUint32(o+16,true), wh=dv.getUint32(o+20,true), W=wh&0xffff, H=wh>>>16, po=a&0xffff, pa=a>>>16, id=dv.getUint32(o+12,true);
    if(W===512&&H===256&&(dv.getUint32(o+8,true)&0xffff0000)===0x20000&&pa&&po===pa+1024&&o+po+W*H<=m.length){
      // 選手選択の画面のセーブでは、頭だけ残って中身が 0 の所がある。中身の無いもの・同じ絵は外す
      // 0 番の色もふつうに使われるので、点の値の種類で見る（中身の無いものは 1 種類）
      const pix=m.subarray(o+po,o+po+W*H), seen=new Set(); let sum=0; for(let i=0;i<pix.length;i+=97){ seen.add(pix[i]); sum=(sum*31+pix[i])>>>0 } for(let i=0;i<1024;i++) sum=(sum*31+m[o+pa+i])>>>0;
      if(seen.size>8&&!kits.some(k=>k.sum===sum)) kits.push({id,at:o,W,H,sum,rgba:jwRGBA(pix,m.subarray(o+pa,o+pa+1024))}) }
    else if(W===256&&H===256&&po&&!pa&&!boots&&o+po+W*H<=m.length) boots={id,at:o,pix:m.subarray(o+po,o+po+W*H)};
    else if(boots&&!W&&!H&&pa&&o-boots.at<0x20000&&pals.length<2) pals.push(m.subarray(o+pa,o+pa+1024));
  }
  return {kits,boots:boots&&pals.length?{W:256,H:256,id:boots.id,rgba:jwRGBA(boots.pix,pals[pals.length-1])}:null};
}
