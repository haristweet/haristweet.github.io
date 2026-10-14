// 体（v0.4.0）。永井の試合中のセーブ（nagai2）で、描く命令の並びとゲームの行列（0x485000 から 0x40 ごと）を照らして読み方を決めた
//   体のファイル #1429: [数 2, 8, 形の位置, 細かさ違いの形の位置]。形の頭: +8＝骨の行列（19 本、立ち姿＝T の形、行ベクトル・平行移動は最後の行）、
//   +0x10＝親の表（i16）、+0x14/+0x18＝骨の対の数と表（28 対、u16 2 つ）、+0x20/+0x24＝包みの数と位置
//   包み: +0x1C＝使う骨の数 nB、+0x24＝使う対の数 nP、+0x18＝番号の並びの位置（前 nB 個＝骨の番号、後ろ nP 個＝対の番号）、+0x34＝部位（sel）、+0x43＝出し分けの番号
//   頂点は小分け（1 つの組に行列 1〜4 個）。組の説明（6d 2 つ＋75）＝[0,0,始め,終わり,行列の番地…]。行列の番地は頂点の後ろから 4 つずつ＝並びの何番目か
//   頂点 1 つ＝4 qword: 位置（s16、1/16）、法線、重み（行列ごと、足して 4095）、uv（/4096）
//   対 p＝(a,b) の行列＝Bind[a]·inv(Bind[b])·Cur[b]（ゲームの行列 28 個と 0.000 まで一致）。頂点は骨 a の向きで持ち、骨 b と一緒に動く
const JW_BODY=1429;
// 出し分けの番号（包み +0x43）。ゲームが描いていた組をそのまま使う（v0.4.1。入場の場面のセーブ zenin で、仙台のホームとアウェイの 20 人を読んだ）
//   半袖＝フィールドの選手（4＝半袖、22＝腕章なし（23＝キャプテンの腕章）、26・27＝腕の肌）。長袖＝永井の試合中・GK（3＝長袖、20＝袖口）。GK は 31（手袋？）も描くが、絵がまだ無いので描かない
//   37＝スパイクの歯（靴底から 4cm ほど下にとがって出る。ゲームでは芝に埋まる）。ふだんは描かない（v0.4.4。ユーザーの「スパイクの下に筋」）。jwBodyOpts(長袖, 歯) で組を作る
const JW_BODY_OPTS_SHORT=new Set([0,4,5,6,7,9,12,14,15,17,22,26,27,30]);
const JW_BODY_OPTS_LONG=new Set([0,3,5,6,7,9,12,14,15,17,20,30]);
const JW_BODY_STUDS=37;
const JW_BODY_OPTS=JW_BODY_OPTS_SHORT;
function jwBodyOpts(long,studs){ const s=new Set(long?JW_BODY_OPTS_LONG:JW_BODY_OPTS_SHORT); if(studs) s.add(JW_BODY_STUDS); return s }
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
// 体の形を、絵ごとの塊にする。tex: {0:肌,1:ユニフォーム,5:スパイク}。opts＝出し分けの組（半袖か長袖）
function jwBodyMeshes(B,cur,tex,opts=JW_BODY_OPTS){
  const tris=jwBodyTris(B,cur,P=>opts.has(P.opt)&&JW_BODY_SELS.includes(P.sel)), by=new Map();
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
// ユニフォームの絵の割り付け（v0.8.0。自分で描いた絵に差し替えるための下絵）。体 #1429 の服（sel 1）の包みを、出し分けの番号ごとに uv で並べる。
//   名前は形の位置と絵を見て決めた（左半分の上＝シャツの前（胸のスポンサー・エンブレム）、右半分の上＝背中、下＝パンツ。前後は形の向きで確認）。脇の 2 つは推測
const JW_KIT_PARTS={3:"長袖",4:"半袖",7:"シャツの裾",9:"ストッキング",12:"ストッキングの足首",20:"脇（長袖のとき）",22:"脇（半袖のとき）"};
const JW_KIT_LABELS=[[0.307,0.035,"襟"],[0.15,0.25,"シャツの前"],[0.45,0.25,"シャツの背中"],[0.15,0.78,"パンツの前"],[0.45,0.78,"パンツの後ろ"]];
function jwKitLayout(B,cur){
  const opts=[...new Set([...jwBodyOpts(false,false),...jwBodyOpts(true,false)])];
  return opts.map(op=>({opt:op,name:JW_KIT_PARTS[op]||"",tris:jwBodyTris(B,cur,P=>P.opt===op&&P.sel===1).map(t=>t.uv)})).filter(p=>p.tris.length);
}
// ステートセーブのメモリにあるユニフォーム（512×256・8 ビット・色表つき。頭の +8 が 0x20440。同じ大きさの髪の地などは外す）とスパイク（256×256、色表は別の塊）
//   関口・田村の選手選択の画面のセーブでは中身のあるのが 2 着（仙台のホーム・仙台の GK）、梁のセーブでは 4 着、試合中の永井のセーブでは
//   4 着（磐田の 2 着・仙台の GK・仙台のアウェイ）。中身の無い枠や同じ絵の写し（頭の番号 0x1004）は外す。
//   どの枠が何かはセーブによって違う（ディスクのどのファイルかが分かるまでのつなぎ）
//   スパイクの色表は後ろに 23 個並ぶ色違いの 2 つ目（永井の画面と同じ）
function jwSaveKits(m){
  const dv=new DataView(m.buffer,m.byteOffset,m.byteLength), kits=[], fonts=[{},{},{},{}]; let boots=null; const pals=[];
  for(let o=0;o+64<=m.length;o+=16){
    if(dv.getUint32(o,true)!==0x29857294) continue;
    const a=dv.getUint32(o+16,true), wh=dv.getUint32(o+20,true), W=wh&0xffff, H=wh>>>16, po=a&0xffff, pa=a>>>16, id=dv.getUint32(o+12,true);
    if(W===512&&H===256&&(dv.getUint32(o+8,true)&0xffff0000)===0x20000&&pa&&po===pa+1024&&o+po+W*H<=m.length){
      // 選手選択の画面のセーブでは、頭だけ残って中身が 0 の所がある。中身の無いもの・同じ絵は外す
      // 0 番の色もふつうに使われるので、点の値の種類で見る（中身の無いものは 1 種類）
      const pix=m.subarray(o+po,o+po+W*H), seen=new Set(); let sum=0; for(let i=0;i<pix.length;i+=97){ seen.add(pix[i]); sum=(sum*31+pix[i])>>>0 } for(let i=0;i<1024;i++) sum=(sum*31+m[o+pa+i])>>>0;
      if(seen.size>8&&!kits.some(k=>k.sum===sum)) kits.push({id,at:o,W,H,sum,rgba:jwRGBA(pix,m.subarray(o+pa,o+pa+1024)),slot:id>=0xfa0&&id<=0xfa3?id-0xfa0:-1}) }
    // 背番号・名前の字（4 ビット）と色表。ユニフォームの枠ごと（k＝0〜3）: 数字 0xFAA+k（256×64、32×32 の升に 0〜4・5〜9）、字 0xFB4+k（256×32、A〜N・O〜Z.）、
    //   色表 0x2512+k（背中の番号）・0x251C+k（パンツの番号）・0x2580+k（胸の番号）・0x247C+k（名前）。どれもゲームが描くときに使っていたもの（永井のセーブの命令で確認）
    else if(id>=0xfaa&&id<=0xfad&&W===256&&H===64&&po) fonts[id-0xfaa]={...fonts[id-0xfaa],digits:m.subarray(o+po,o+po+W*H/2)};
    else if(id>=0xfb4&&id<=0xfb7&&W===256&&H===32&&po) fonts[id-0xfb4]={...fonts[id-0xfb4],letters:m.subarray(o+po,o+po+W*H/2)};
    else if(!W&&!H&&pa&&[0x2512,0x251c,0x2580,0x247c].some(b=>id>=b&&id<b+4)){ const b=[0x2512,0x251c,0x2580,0x247c].find(b=>id>=b&&id<b+4), k=id-b;
      fonts[k]={...fonts[k],[{0x2512:"back",0x251c:"shorts",0x2580:"chest",0x247c:"name"}[b]]:m.subarray(o+pa,o+pa+64)} }
    else if(W===256&&H===256&&po&&!pa&&!boots&&o+po+W*H<=m.length) boots={id,at:o,pix:m.subarray(o+po,o+po+W*H)};
    else if(boots&&!W&&!H&&pa&&o-boots.at<0x20000&&pals.length<2) pals.push(m.subarray(o+pa,o+pa+1024));
  }
  // 字と色表がそろっている枠だけ、ユニフォームに付ける（中身が 0 の枠は外す）
  for(const k of kits){ const f=fonts[k.slot]; if(f&&f.digits&&f.letters&&f.back&&f.chest&&f.shorts&&f.name&&f.digits.some(x=>x)&&f.name.some(x=>x)) k.fonts=f }
  return {kits,boots:boots&&pals.length?{W:256,H:256,id:boots.id,rgba:jwRGBA(boots.pix,pals[pals.length-1])}:null};
}
// 手（v0.4.3）。体のファイルには手首までしか無く、手は別のファイル #8095（形 4 つ）。試合中・入場のセーブで、ゲームは体と頭のあとに
//   1 つ目の形を骨 18（左手）、2 つ目を骨 17（右手）の行列で描いていた。絵は体の肌と同じ（#8231）。3・4 つ目は 1 回ずつしか描かれず、何かは未確認
const JW_HANDS=8095;
function jwHandMeshes(u,cur,skin){
  const dv=new DataView(u.buffer,u.byteOffset,u.byteLength), n=dv.getUint32(0,true), ms=[];
  if(n<2||n>16) throw new Error("手のファイルとして読めません");
  for(const [k,bone] of [[0,18],[1,17]]){
    const tris=weModel(u,dv.getUint32(8+k*4,true)).tris, f=new Float32Array(tris.length*15); let i=0;
    for(const t of tris) for(let j=0;j<3;j++){ const p=t.p[j]; f[i++]=p[2]; f[i++]=-p[1]; f[i++]=p[0]; f[i++]=t.uv[j][0]; f[i++]=t.uv[j][1] }
    ms.push(...jwPlaceHead([{f,ntri:tris.length,tex:skin||null}],cur[bone])) }
  return ms;
}

// 背番号・名前（v0.5.0）。ゲームは選手ごとに、字から 64×32 の番号の絵と 256×32 の名前の絵を組み立て、体の重ねの包みの uv を書き換えて貼る
//   uv の書き換え（試合中と入場のセーブで同じ。誤差 0.0003 以内）: 新しい uv＝a×ファイルの uv＋b。番号の絵 1 枚を 3 つの色表で背中・胸・パンツに使う
const JW_OVERLAY={6:{a:10/23,bu:-0.1521,bv:-0.6893,tex:"num",pal:"back"},15:{a:1/3,bu:-0.3811,bv:-0.0715,tex:"num",pal:"chest"},
  14:{a:2/5,bu:-1.0970,bv:-1.7798,tex:"num",pal:"shorts"},17:{a:14/23,bu:-0.4130,bv:-2.9868,tex:"name",pal:"name"}};
function jwNib(src,W,x,y){ const b=src[(y*W+x)>>1]; return x&1?b>>4:b&15 }
// 番号の絵（4 ビットの値、64×32）。数字は 32×32 の升をそのまま写す。1 桁は真ん中、2 桁は左右。「1」は幅 22（升の 1〜22）で詰める
//   （ベガルタの字で 11 個の番号がこの決まりで点まで一致。「1」を含む番号は 1 点ずれることがある【推測】）
//   読み込んだ字（jwFontFromRGBA）は升ごとに測った幅 ws（[左, 幅]）を使う
function jwNumberIdx(digits,n,ws){
  const T=new Uint8Array(64*32), s=String(n).slice(0,2), w=c=>ws?ws[+c][1]:c==="1"?22:32, sx=c=>ws?ws[+c][0]:c==="1"?1:0;
  let x=Math.floor((64-[...s].reduce((a,c)=>a+w(c),0))/2);
  for(const c of s){ const d=+c, cx=(d%5)*32+sx(c), cy=Math.floor(d/5)*32;
    for(let y=0;y<32;y++) for(let i=0;i<w(c);i++){ const X=x+i; if(X<0||X>=64) continue; const v=jwNib(digits,256,cx+i,cy+y); if(v) T[y*64+X]=v }
    x+=w(c) }
  return T;
}
// 名前の絵（256×32）。字の絵の行ごとに、字の切れ目（空いた列）で A〜N・O〜Z. を切り出す。字は y 11 の高さにそろえ、真ん中に並べる。
//   字の間はおよそ 90 点の幅に広げ、5〜23 点（ゲームの名前の絵 22 個の並びに合わせた近似【推測】）
//   読み込んだ字は字の間を決めて渡す（gap。2026 年のベガルタの名前は字が詰まっている）
function jwNameIdx(letters,name,fixGap){
  const glyphs={}, order=["ABCDEFGHIJKLMN","OPQRSTUVWXYZ."];
  order.forEach((chars,row)=>{ const y0=row*16, ink=[]; let top=99;
    for(let x=0;x<256;x++){ let on=false; for(let y=y0;y<y0+16;y++) if(jwNib(letters,256,x,y)){ on=true; top=Math.min(top,y-y0) } ink.push(on) }
    const runs=[]; let s=-1; for(let x=0;x<=256;x++){ const on=x<256&&ink[x]; if(on&&s<0) s=x; if(!on&&s>=0){ runs.push([s,x-1]); s=-1 } }
    if(runs.length===chars.length) [...chars].forEach((c,k)=>glyphs[c]={x0:runs[k][0],w:runs[k][1]-runs[k][0]+1,y0,top}) });
  const T=new Uint8Array(256*32), cs=[...String(name||"").toUpperCase()].filter(c=>glyphs[c]||c===" ");
  if(!cs.length) return T;
  const ws=cs.map(c=>c===" "?6:glyphs[c].w), sum=ws.reduce((a,b)=>a+b,0), gap=cs.length>1?(fixGap??Math.round(Math.min(23,Math.max(5,(90-sum)/(cs.length-1))))):0;
  let x=Math.round(128-(sum+gap*(cs.length-1))/2);
  cs.forEach((c,k)=>{ const g=glyphs[c];
    if(g) for(let y=0;y<16;y++){ const ty=11-g.top+y; if(ty<0||ty>=32) continue; for(let i=0;i<g.w;i++){ const X=x+i; if(X<0||X>=256) continue; const v=jwNib(letters,256,g.x0+i,g.y0+y); if(v) T[ty*256+X]=v } }
    x+=ws[k]+gap });
  return T;
}
// 自分の字（v0.9.0）: 256×96 の絵（上の 64 行＝数字 0〜4・5〜9 を 32×32 の升に、下の 32 行＝英字 A〜N・O〜Z. を高さ 16 の 2 行に、字の間は空ける）。
//   塗りの濃さ（透明度。透明度の無い絵は暗さ）を、ゲームの字と同じ 16 段階の番号に直す（番号ごとの濃さは背中の番号の色表の α。0＝塗らない、15＝いちばん濃い）
const JW_FONT_LEVELS=[[0,0],[1,7],[2,15],[8,25],[9,36],[10,45],[11,56],[12,67],[13,76],[3,83],[4,94],[14,103],[5,111],[6,117],[7,123],[15,128]];
function jwFontFromRGBA(rgba,W,H){
  if(W!==256||H!==96) throw new Error(`字の絵は 256×96 にしてください（いまは ${W}×${H}）`);
  let opaque=true; for(let i=3;i<rgba.length;i+=4) if(rgba[i]<250){ opaque=false; break }
  const cov=i=>opaque?(255-(rgba[i]*0.3+rgba[i+1]*0.59+rgba[i+2]*0.11))/255:rgba[i+3]/255;
  const pack=(y0,h)=>{ const out=new Uint8Array(256*h/2);
    for(let y=0;y<h;y++) for(let x=0;x<256;x++){ const a=cov(((y0+y)*256+x)*4)*128; let v=0, bd=1e9; for(const [k,l] of JW_FONT_LEVELS) if(Math.abs(l-a)<bd){ bd=Math.abs(l-a); v=k }
      const o=(y*256+x)>>1; out[o]|=x&1?v<<4:v }
    return out };
  const digits=pack(0,64), letters=pack(64,32), numW=[];
  for(let d=0;d<10;d++){ const cx=(d%5)*32, cy=Math.floor(d/5)*32; let l=32,r=-1;
    for(let y=0;y<32;y++) for(let x=0;x<32;x++) if(jwNib(digits,256,cx+x,cy+y)){ l=Math.min(l,x); r=Math.max(r,x) }
    numW.push(r<0?[0,16]:[Math.max(0,l-1),Math.min(32,r+2)-Math.max(0,l-1)]) }
  return {digits,letters,numW,nameGap:2};
}
// ゲームの字を同じ並びの絵にする（字の下絵）。黒で、濃さを透明度に
function jwFontToRGBA(fonts){
  const al=new Array(16).fill(0); for(const [k,v] of JW_FONT_LEVELS) al[k]=Math.min(255,v*2);
  const out=new Uint8Array(256*96*4);
  for(let y=0;y<96;y++) for(let x=0;x<256;x++){ const v=y<64?jwNib(fonts.digits,256,x,y):jwNib(fonts.letters,256,x,y-64); out[(y*256+x)*4+3]=al[v] }
  return out;
}
function jwIdxRGBA(idx,pal){ const out=new Uint8Array(idx.length*4); for(let i=0;i<idx.length;i++){ const j=idx[i]*4; out[i*4]=pal[j]; out[i*4+1]=pal[j+1]; out[i*4+2]=pal[j+2]; out[i*4+3]=Math.min(255,pal[j+3]*2) } return out }
// 重ねの形（背中の番号・胸の番号・パンツの番号・名前）。uv を書き換え、絵は端を伸ばす（くり返さない）
function jwOverlayMeshes(B,cur,fonts,opts,name,number){
  if(!fonts) return [];
  const numIdx=number!=null?jwNumberIdx(fonts.digits,number,fonts.numW):null, nameIdx=name?jwNameIdx(fonts.letters,name,fonts.nameGap):null, ms=[];
  for(const [opt,o] of Object.entries(JW_OVERLAY)){
    if(!opts.has(+opt)) continue; const idx=o.tex==="num"?numIdx:nameIdx; if(!idx) continue;
    const tex={W:o.tex==="num"?64:256,H:32,rgba:jwIdxRGBA(idx,fonts[o.pal])}, tris=jwBodyTris(B,cur,P=>P.opt===+opt), f=new Float32Array(tris.length*15); let n=0;
    for(const t of tris) for(let j=0;j<3;j++){ const q=jwWorldToView(t.p[j]); f[n++]=q[0]; f[n++]=q[1]; f[n++]=q[2]; f[n++]=o.a*t.uv[j][0]+o.bu; f[n++]=o.a*t.uv[j][1]+o.bv }
    ms.push({f,ntri:tris.length,tex,clamp:true,overlay:o.pal}) }
  return ms;
}
// 動き（v0.6.0 の準備）。#1360＝動きの入れもの（中に 485 個。[数, 8, 位置…] が +0x50 から）。どの動きにもしるし 0x20011119 の後ろに、
//   こまが 164 バイトずつ並ぶ: 根の向き（s16×4、x,y,z,w、32767＝1）・根の位置（f32×3）・骨 1〜18 の向き（親から見た向き、s16×4）。
//   しるしの +8 が長さ（秒）。こまの数は大きさから（中身が単位の向きでなくなるところまで）。1 つ目（0 番）は T の立ち姿そのもの（骨の行列と 0.08 以内で一致）。
//   動きの世界は体のファイルの世界を x のまわりに 180° 回したもの（根の行列の後ろに diag(1,−1,−1) を掛けると合う）
const JW_MOTIONS=1360;
function jwMotionList(u){
  const dv=new DataView(u.buffer,u.byteOffset,u.byteLength), b=0x50, n=dv.getUint32(b,true), offs=[];
  if(n<1||n>4096) throw new Error("動きのファイルとして読めません");
  for(let i=0;i<n;i++) offs.push(dv.getUint32(b+8+i*4,true));
  const sorted=[...new Set([...offs,u.length-b])].sort((a,c)=>a-c), end=o=>sorted[sorted.indexOf(o)+1];
  return offs.map((o,i)=>({i,start:b+o,end:b+end(o)}));
}
// セーブのメモリの動きの表（v0.7.0）。0x56A50C から動きへの指し（u32）が並ぶ（試合中のセーブで 1,466 個）。1 つ分の中身は #1360 の 1 つ分と同じ形。
//   #1360 の 485 個はこの一部（417 個が中身ごと一致。並びは別。#1360 の 239＝表の 1140）。残りは別のファイルから来るらしい（どれかは未確認）。
//   0〜1436 番は試合中のセーブのあいだで同じ中身、1437 番から後ろは場面ごとに入れ替わる枠。選手選択の画面のセーブでは一部しか読み込まれていない
const JW_MOTION_TABLE=0x56A50C, JW_MOTION_FIXED=1437;
// 名前（場面のセーブで、そのとき再生中の動きを骨の向きの一致で当てたもの。motmatch.mjs）
const JW_MOTION_NAMES={217:"PK のキック",725:"スライディング"};
function jwSaveMotions(m){
  const dv=new DataView(m.buffer,m.byteOffset,m.byteLength), ptr=[];
  for(let a=JW_MOTION_TABLE;a+4<=m.length&&ptr.length<4096;a+=4){ const p=dv.getUint32(a,true); if(p<0x100000||p>=m.length) break; ptr.push(p) }
  if(ptr.length<100) return null;
  // 指し先は 24MB ほどに散らばるので、1 つ分ずつ（次の指し先まで、長くても 256KB）を詰めて写す
  const srt=[...new Set(ptr)].sort((a,c)=>a-c), seg=new Map(); let tot=0;
  srt.forEach((p,k)=>{ const e=Math.min(srt[k+1]??m.length,p+0x40000,m.length); seg.set(p,{at:tot,n:e-p}); tot+=e-p });
  // 選手選択の画面のセーブなどは一部しか読み込まれていない。読める動き（中身の違うもの）が 700 に届かなければ使わない（ディスクの #1360 にまかせる。試合中で 922、選択の画面で 483）
  let ok=0; for(const p of srt) for(let a=p;a<p+64&&a+4<=m.length;a+=4) if(dv.getUint32(a,true)===0x20011119){ ok++; break }
  if(ok<700) return null;
  const u=new Uint8Array(tot); for(const [p,{at,n}] of seg) u.set(m.subarray(p,p+n),at);
  return {u,list:ptr.map((p,i)=>{ const {at,n}=seg.get(p); return {i,start:at,end:at+n} })};
}
function jwMotionFrames(u,ent){
  const dv=new DataView(u.buffer,u.byteOffset,u.byteLength), out=[];
  let p=-1; for(let a=ent.start;a+4<=ent.end;a+=4) if(dv.getUint32(a,true)===0x20011119){ p=a; break }
  if(p<0) return {frames:out,dur:0};
  const dur=dv.getFloat32(p+8,true), q4=a=>[0,1,2,3].map(j=>dv.getInt16(a+j*2,true)/32767);
  for(let s=p+0x1c;s+164<=ent.end;s+=164){
    const q=[]; let ok=true;
    for(let k=0;k<18;k++){ const v=q4(s+20+8*k), l=Math.hypot(...v); if(Math.abs(l-1)>0.02){ ok=false; break } q.push(v) }
    if(!ok) break;
    out.push({rq:q4(s),rp:[0,1,2].map(j=>dv.getFloat32(s+8+j*4,true)),q});
  }
  return {frames:out,dur};
}
// 向き（x,y,z,w）→ 行ベクトルの 4×4 の回転
function jwQuatRow(q){ const [x,y,z,w]=q;
  return [1-2*(y*y+z*z),2*(x*y+z*w),2*(x*z-y*w),0, 2*(x*y-z*w),1-2*(x*x+z*z),2*(y*z+x*w),0, 2*(x*z+y*w),2*(y*z-x*w),1-2*(x*x+y*y),0, 0,0,0,1] }
function jwSlerp(a,b,t){ let d=a[0]*b[0]+a[1]*b[1]+a[2]*b[2]+a[3]*b[3]; if(d<0){ b=b.map(x=>-x); d=-d }
  if(d>0.9995){ const r=a.map((x,i)=>x+(b[i]-x)*t), l=Math.hypot(...r); return r.map(x=>x/l) }
  const th=Math.acos(d), s=Math.sin(th), ka=Math.sin((1-t)*th)/s, kb=Math.sin(t*th)/s; return a.map((x,i)=>ka*x+kb*b[i]) }
// こま（とこまの間 t）から骨ごとの行列。親の行列に「向き＋T の姿の親からの位置」を掛けていく
function jwMotionPose(B,fa,fb,t){
  const lerp=(x,y)=>x+(y-x)*t, rq=fb?jwSlerp(fa.rq,fb.rq,t):fa.rq, rp=fb?fa.rp.map((x,i)=>lerp(x,fb.rp[i])):fa.rp;
  const W=new Array(B.Bind.length), root=jwQuatRow(rq); root[12]=rp[0]; root[13]=rp[1]; root[14]=rp[2];
  W[0]=jwM4(root,[1,0,0,0,0,-1,0,0,0,0,-1,0,0,0,0,1]);
  for(let k=1;k<B.Bind.length;k++){ const p=B.par[k], Lb=jwM4(B.Bind[k],jwInv(B.Bind[p])), q=fb?jwSlerp(fa.q[k-1],fb.q[k-1],t):fa.q[k-1], L=jwQuatRow(q);
    L[12]=Lb[12]; L[13]=Lb[13]; L[14]=Lb[14]; W[k]=jwM4(L,W[p]) }
  return W;
}
// 動きの見た目の区分（v0.6.1。棒人間の一覧を見て決めたしきい値で分ける【推測】。ゲームの中の名前ではない）
//   腰がいちばん低い所 250 未満＝倒れる・起きる、腰が 540 より上＝跳ぶ、足が 330 より上＝蹴る、手が 900 より上＝手を高く上げる、
//   前後の足が 3 回以上入れかわる＝足が 190 より上なら走る・下なら歩く、ほか＝その場の動き、1 こま＝止まった姿
const JW_MOTION_KINDS=["止まった姿","歩く","走る","蹴る","跳ぶ","倒れる・起きる","手を高く上げる","その場の動き"];
function jwMotionKind(B,M){
  const n=M.frames.length; if(n<=1) return "止まった姿";
  let hipMin=1e9,hipMax=-1e9,footMax=-1e9,handMax=-1e9,cross=0,prev=null;
  for(const fr of M.frames){ const W=jwMotionPose(B,fr), y=k=>W[k][13];
    hipMin=Math.min(hipMin,y(0)); hipMax=Math.max(hipMax,y(0)); footMax=Math.max(footMax,y(12),y(13)); handMax=Math.max(handMax,y(17),y(18));
    const sw=W[12][14]-W[13][14]; if(prev!==null&&Math.sign(sw)!==Math.sign(prev)&&Math.abs(sw-prev)>5) cross++; prev=sw }
  if(hipMin<250) return "倒れる・起きる"; if(hipMax>540) return "跳ぶ"; if(footMax>330) return "蹴る"; if(handMax>900) return "手を高く上げる";
  if(cross>=3) return footMax>190?"走る":"歩く";
  return "その場の動き";
}
