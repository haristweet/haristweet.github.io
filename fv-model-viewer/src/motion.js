// 技（動き）: セーブステートの i960 の RAM から、アーケードのプログラムで好きな技・コマの姿勢を計算する（VF2 の motion.js と同じ作り。番地は FV のもの）。
// i960 は arcade.js の I960、TGP（コプロ）は PS2 本体の代わりの関数（cpr*。表 0x23fc20）を ee.js の EE でそのまま動かす。
// i960 の番地: 0〜 プログラム（ROM_CODE1）、0x500000〜 RAM（写しの 0x16b6dd0〜）、0x2000000〜 main_data（ROM_DATA）、
//   0x6400000〜 ROM_EP1（属性の表など）、0x6c00000〜 ROM_EP2（技の表 0x6c00004。写し4つのコマ数で確かめた）
const MOT_GP=0x292170, MOT_CPR=0x23fc20, MOT_WORK=0x11b6dd0;
const MOT_MOTTBL=0x6c00004;   // 技の番号 → 動きのデータ（先頭の 16bit がコマ数）
const MOT_FN={start:0x1b880, setup:0x29d08, blend:0x29f48, frame:0x2aa84, units:0x17160, script:0x1c0fc, visible:0x1b574, body:0x19f10, setObj:0x5a48};
// prog: i960 のプログラム（512KB）、eeMem: 写しの主メモリ（写してから使う）、rom: {data, ep1, ep2}（ディスクの ROM_DATA・ROM_EP1・ROM_EP2）
function motEngine(prog, eeMem, rom){
  const ee=new EE(new Uint8Array(eeMem));
  const ram=ee.m.subarray(MOT_WORK+0x500000,MOT_WORK+0x600000);
  const argb=ee.r32(MOT_GP-0x7cf4), outb=ee.r32(MOT_GP-0x7d00), cr=ee.r32(MOT_GP-0x7cec);
  const cop={cur:null,out:[]}, miss={};
  let capture=null;
  const curMat=()=>{ const V=ee.vf, r=[]; for(const i of [24,25,26,27]) r.push(V[i*4],V[i*4+1],V[i*4+2]); return r };
  const copCall=(fn,args)=>{ if(capture&&(fn===52||fn===5)){ capture.mat(curMat(),fn); if(fn===52){ cop.out.push(0); return } }
    const f=ee.r32(MOT_CPR+fn*16), nr=ee.r32(MOT_CPR+fn*16+8)>>2; args.forEach((v,k)=>ee.w32(argb+4*k,v)); ee.call(f); for(let k=0;k<nr;k++) cop.out.push(ee.r32(outb+4*k)) };
  const f2u=f=>new Uint32Array(new Float32Array([f]).buffer)[0];
  const copW=v=>{ if(!cop.cur) cop.cur={fn:v&0xff,args:[]}; else cop.cur.args.push(v); const c=cop.cur; if(c.args.length>=ee.r32(MOT_CPR+c.fn*16+4)){ cop.cur=null; copCall(c.fn,c.args) } };
  const copR=()=>cop.out.length?cop.out.shift():0;
  const r8=A=>{ A>>>=0;
    if(A<0x80000) return prog[A];
    if(A>=0x500000&&A<0x600000) return ram[A-0x500000];
    if(A>=0x2000000&&A<0x3000000) return rom.data[A-0x2000000];
    if(A>=0x6400000&&A<0x6500000) return rom.ep1[A-0x6400000];
    if(A>=0x6c00000&&A<0x6d00000) return rom.ep2[A-0x6c00000];
    const k=(A>>>8).toString(16); miss[k]=(miss[k]||0)+1; return 0 };
  const isF=A=>A>=0x880000&&A<0x890000, isC=A=>A>=0x900000&&A<0x920000;   // TGP の FIFO・データ RAM（PS2 の [gp−0x7cec]）
  const mem={ r8,
    r16(A){ A>>>=0; if(isF(A)) return copR()&0xffff; if(isC(A)) return ee.r16(cr+A-0x900000); return r8(A)|r8(A+1)<<8 },
    r32(A){ A>>>=0; if(isF(A)) return copR(); if(isC(A)) return ee.r32(cr+A-0x900000); return (r8(A)|r8(A+1)<<8|r8(A+2)<<16|r8(A+3)<<24)>>>0 },
    w8(A,v){ A>>>=0; if(A>=0x500000&&A<0x600000) ram[A-0x500000]=v; else if(A>=0x800000&&A<0x810000) return; else { const k="w"+(A>>>8).toString(16); miss[k]=(miss[k]||0)+1 } },
    w16(A,v){ this.w8(A,v&255); this.w8(A+1,v>>>8&255) },
    w32(A,v){ A>>>=0; if(isF(A)) return copW(v>>>0); if(isC(A)) return ee.w32(cr+A-0x900000,v); for(let k=0;k<4;k++) this.w8(A+k,(v>>>(8*k))&255) } };
  const cpu=new I960({readUInt32LE:a=>(prog[a]|prog[a+1]<<8|prog[a+2]<<16|prog[a+3]<<24)>>>0}, mem);
  const g7=pl=>mem.r32(pl?0x500808:0x500804);
  const run=(pl,addrs,m)=>{ try{ for(const a of addrs){ const R=cpu.r; R[1]=R[31]=0x5f8000; R[23]=g7(pl); R[24]=g7(1-pl); R[26]=0x800000; R[27]=0x880000; R[28]=0x4000; R[16]=m||0; cpu.run(a,2e7) } }catch(e){ cop.cur=null; cop.out.length=0; throw e } };
  // 関節の行列の置き場（cprMtxStUnitMat 0x18eac0: 引数0 の bit0 で [[gp−0x7fb8]] か [[gp−0x7fb4]]。引数0 は [g7+4]）。64B×16、12 個に直す
  const unitBase=pl=>ee.r32(ee.r32(MOT_GP-0x7fb8+4*(mem.r8(g7(pl)+4)&1)));
  const units=pl=>{ const b=unitBase(pl), F=k=>{ const u=ee.r32(b+k); return new Float32Array(new Uint32Array([u]).buffer)[0] }; return [...Array(16)].map((_,j)=>[0,4,8,16,20,24,32,36,40,48,52,56].map(o=>F(j*64+o))) };
  const cur=[null,null];
  const md16=A=>r8(A)|r8(A+1)<<8, md32=A=>mem.r32(A);
  return {
    mem, cpu, ee, units, unitBase, miss, run, g7,
    info:pl=>({motion:mem.r16(g7(pl)+0x1a8), frame:mem.r16(g7(pl)+0x1aa), length:mem.r16(g7(pl)+0x800)}),
    motionLength(m){ if(m<1||m>=md32(0x6c00000)) return 0; const p=md32(MOT_MOTTBL+m*4); if(!(p>=0x2000000&&p<0x3000000||p>=0x6c00000&&p<0x6d00000)) return 0; return md16(p) },
    start(pl,m,smooth=false){ const G=g7(pl); mem.w16(G+0x1a8,m); mem.w16(G+0x1aa,1); run(pl,smooth?[MOT_FN.start,MOT_FN.setup,MOT_FN.blend]:[MOT_FN.start,MOT_FN.setup],m); cur[pl]={m,f:0} },
    frame(pl,f){ const G=g7(pl), m=mem.r16(G+0x1a8);
      if(!cur[pl]||cur[pl].m!==m||f<=cur[pl].f&&cur[pl].f>0){ if(cur[pl]&&cur[pl].m===m) this.start(pl,m); else cur[pl]={m,f:0} }
      for(let k=cur[pl].f+1;k<=f;k++){ mem.w16(G+0x1a8,m); mem.w16(G+0x1aa,k); if(k<mem.r16(G+0x800)) run(pl,[MOT_FN.script],m) }
      mem.w16(G+0x1a8,m); mem.w16(G+0x1aa,f); cur[pl].f=f; run(pl,[MOT_FN.frame,MOT_FN.units],m); return units(pl) },
  };
}

// 行列（12 個。行ベクトルの形: 点 p → p·R＋t。R の行＝x,y,z の像）
const motMul=(a,b)=>{ const r=[]; for(let i=0;i<3;i++) for(let j=0;j<3;j++) r[i*3+j]=a[i*3]*b[j]+a[i*3+1]*b[3+j]+a[i*3+2]*b[6+j]; for(let j=0;j<3;j++) r[9+j]=a[9]*b[j]+a[10]*b[3+j]+a[11]*b[6+j]+b[9+j]; return r };
const motInv=a=>{ // 回転は直交とみなす
  const r=[a[0],a[3],a[6],a[1],a[4],a[7],a[2],a[5],a[8]]; return [...r,-(a[9]*r[0]+a[10]*r[3]+a[11]*r[6]),-(a[9]*r[1]+a[10]*r[4]+a[11]*r[7]),-(a[9]*r[2]+a[10]*r[5]+a[11]*r[8])] };
const motInvG=a=>{ // 一般の 3×3＋位置（影のように潰れていないもの）
  const [m0,m1,m2,m3,m4,m5,m6,m7,m8]=a, d=m0*(m4*m8-m5*m7)-m1*(m3*m8-m5*m6)+m2*(m3*m7-m4*m6);
  const r=[(m4*m8-m5*m7)/d,(m2*m7-m1*m8)/d,(m1*m5-m2*m4)/d,(m5*m6-m3*m8)/d,(m0*m8-m2*m6)/d,(m2*m3-m0*m5)/d,(m3*m7-m4*m6)/d,(m1*m6-m0*m7)/d,(m0*m4-m1*m3)/d];
  return [...r,-(a[9]*r[0]+a[10]*r[3]+a[11]*r[6]),-(a[9]*r[1]+a[10]*r[4]+a[11]*r[7]),-(a[9]*r[2]+a[10]*r[5]+a[11]*r[8])] };
const motDist=(a,b)=>{ let m=0; for(let i=0;i<a.length;i++) m=Math.max(m,Math.abs(a[i]-b[i])); return m };
const motDet=a=>a[0]*(a[4]*a[8]-a[5]*a[7])-a[1]*(a[3]*a[8]-a[5]*a[6])+a[2]*(a[3]*a[7]-a[4]*a[6]);
const MOT_I=[1,0,0,0,1,0,0,0,1];

// 写しの部品を関節に付ける。V＝カメラ（背景の部品の行列＝いちばん多く出てくる行列）。
// 体の部品は関節の行列そのまま（写し16 で 17 個ともずれ 0）。影（潰れた行列）は 世界＝関節·P（P は床へ潰す行列、全部の影で共通）。
// それ以外（髪など）は、いちばん近い関節からのずれ（rel）をそのまま持って付いていく
// Us: 関節の候補（写しの命令の列は関節の行列より 2 コマほど遅れているので、今のコマから数コマ前まで。いちばん多く体が付くものを使う）
// ids: 写しのときの関節ごとの部品の番号（engine.parts）。あればその番号の部品はその関節に付ける（ゲームと同じ）
// カメラ C（部品の行列＝関節の行列·C）を関節 U から逆算する。pl の体の部品（行列式が 1 に近い）の先頭いくつかと 16 の関節の組で C の候補を作り、
// いちばん多くの部品が どれかの関節·C に一致するもの。n＝一致した部品の数（命令の列が関節と同じコマかの目安にもなる）
function motCamera(sc, pl, U, tries=Infinity){
  let bg=null, nv=0; for(const d of sc.draws){ let n=0; for(const e of sc.draws) if(motDist(e.m,d.m)<1e-4) n++; if(n>nv){ nv=n; bg=d.m } }
  const mine=sc.draws.filter(d=>d.player===pl&&motDet(d.m)>0.5&&!(bg&&motDist(d.m,bg)<1e-4)); let best=null;
  for(const d of mine.slice(0,tries)) for(const u of U){ const C=motMul(motInv(u),d.m), iC=motInvG(C); let n=0;
    for(const e of mine){ const W=motMul(e.m,iC); if(U.some(x=>motDist(x,W)<2e-3)) n++ } if(!best||n>best.n) best={V:C,n} }
  return best;
}
// 命令の列（0x1288000 から 0x8000 おきに 12 本。回しながら書く）のうち、写しの関節と同じコマのもの。2P の関節で照らす（1P の表にはステージも入るので）。
// 列の番号を持つ値は主メモリに見つからなかった（CLAUDE.md）
function motPickScene(mem, U2){
  let best=null;
  for(let k=0;k<12;k++){ let sc; try{ sc=sceneRead(mem,0x1288000+k*0x8000) }catch(e){ continue } const c=motCamera(sc,1,U2,4); if(c&&(!best||c.n>best.n)) best={sc,n:c.n,k} }
  return best;
}
function motAttach(sc, pl, Us, ids){
  if(!Array.isArray(Us[0][0])) Us=[Us];
  let best=null; for(const U of Us){ const a=motAttach1(sc,pl,U,ids); if(!best||a.parts.filter(p=>p.body).length>best.parts.filter(p=>p.body).length) best=a } best.ids=ids||null; return best;
}
function motAttach1(sc, pl, U, ids){
  // カメラ: FV では部品の行列＝関節·C で、C はステージの行列（いちばん多い行列）とは y 軸まわりに回っている。関節から逆算する（motCamera）
  let bg=null, nv=0; for(const d of sc.draws){ let n=0; for(const e of sc.draws) if(motDist(e.m,d.m)<1e-4) n++; if(n>nv){ nv=n; bg=d.m } }
  const V=(motCamera(sc,pl,U)||{V:bg}).V;
  const iV=motInvG(V), out=[], shadows=[], mirrors=[];
  sc.draws.forEach((d,i)=>{ if(d.player!==pl||d.id<0&&!d.dyn||motDist(d.m,bg)<1e-4) return;   // 背景（1P の表に入っている）は除く
    const W=motMul(d.m,iV);
    if(Math.min(...U.map(u=>Math.hypot(u[9]-W[9],u[10]-W[10],u[11]-W[11])))>1.5) return;
    if(Math.abs(motDet(d.m))<0.05){ shadows.push({i,W}); return }   // build.js と同じ見分け方
    if(motDet(d.m)<-0.05){ mirrors.push({i,W}); return }   // 床への映り込み（行列式が負。写し16・17）
    if(ids&&d.id>=0){ const k=ids.indexOf(d.id); if(k>=0){ out.push({i,k,rel:[...MOT_I,0,0,0],body:true}); return } }
    let bk=0, be=1e9; for(let k=0;k<16;k++){ const rel=motMul(W,motInv(U[k])); const e=motDist(rel.slice(0,9),MOT_I)+Math.hypot(rel[9],rel[10],rel[11]); if(e<be){ be=e; bk=k } }
    if(be>=0.6){ be=1e9; for(let k=0;k<16;k++){ const e=Math.hypot(U[k][9]-W[9],U[k][10]-W[10],U[k][11]-W[11]); if(e<be){ be=e; bk=k } } out.push({i,k:bk,rel:motMul(W,motInv(U[bk]))}); return }   // 髪など: いちばん近い関節
    out.push({i,k:bk,rel:[...MOT_I,0,0,0],body:true});
  });
  // 映り込み: 世界＝関節·F（F は床で折り返す行列で全部に共通）。F＝inv(U_k)·W をすべての組で作り、いちばん多く一致するもの
  if(mirrors.length){
    const cand=[]; for(const s of mirrors) for(let k=0;k<16;k++) cand.push(motMul(motInv(U[k]),s.W));
    let F=null, nf=0; for(const c of cand){ let n=0; for(const e of cand) if(motDist(e,c)<0.01) n++; if(n>nf){ nf=n; F=c } }
    for(const s of mirrors){ let bk=0,be=1e9; for(let k=0;k<16;k++){ const e=motDist(motMul(motInv(U[k]),s.W),F); if(e<be){ be=e; bk=k } }
      if(be<0.05) out.push({i:s.i,k:bk,mirror:F}); else { let bj=0,bd=1e9; for(let k=0;k<16;k++){ const e=Math.hypot(U[k][9]-s.W[9],U[k][10]-s.W[10],U[k][11]-s.W[11]); if(e<bd){ bd=e; bj=k } } out.push({i:s.i,k:bj,rel:motMul(s.W,motInvG(U[bj]))}) } }
  }
  // 影: ゲームの影の部品は体の部品と向きの決め方が違い、関節の行列を床へ潰した形では合わない（写し16）。技を出すときは影の部品を消し、
  // 体の部品を光の向きで床（元の影の高さ）へ投げたもので代わりにする（ゲームの影そのものではない）
  const Vr=V, L=sc.light, Lw=[0,1,2].map(j=>L[0]*Vr[j*3]+L[1]*Vr[j*3+1]+L[2]*Vr[j*3+2]);   // カメラの向き → 世界（R は直交。v_world＝v_cam·Rᵀ）
  const h=shadows.length?shadows.reduce((a,s)=>a+s.W[10],0)/shadows.length:null;
  const shadowP=h===null||Math.abs(Lw[1])<1e-3?null:[1,0,0,-Lw[0]/Lw[1],0,-Lw[2]/Lw[1],0,0,1,h*Lw[0]/Lw[1],h,h*Lw[2]/Lw[1]];
  return {V,parts:out,shadowParts:shadows.map(s=>s.i),shadowP};
}
// 新しい関節 U2 で、写しの命令の列（sc）の pl の部品の行列を置き直した列を返す。ids（engine.parts）があれば手などの部品の番号も差し替える（att.ids＝写しのときの番号）
function motApply(sc, att, U2, ids){
  const draws=sc.draws.slice();
  for(const p of att.parts){ const d=draws[p.i], id=ids&&p.body&&ids[p.k]!==undefined&&d.id>=0&&att.ids&&d.id===att.ids[p.k]?ids[p.k]:d.id; draws[p.i]={...d,id,m:motMul(p.mirror?motMul(U2[p.k],p.mirror):motMul(p.rel,U2[p.k]),att.V)} }
  if(att.shadowP) for(const p of att.parts) if(p.body) draws.push({...draws[p.i],m:motMul(motMul(motMul(p.rel,U2[p.k]),att.shadowP),att.V)});
  const hide=new Set(att.shadowParts);
  return {...sc,draws:draws.filter((d,i)=>!hide.has(i))};
}
