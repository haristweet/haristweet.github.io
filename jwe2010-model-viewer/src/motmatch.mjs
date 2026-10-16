// セーブの瞬間にゲームが再生していた動きを当てる（v0.6 の答え合わせ）。
//   node motmatch.mjs data/xxx.p2s [行列の番地(16進)]   番地を省くと、体の描く命令と、メモリ全体の「親子で割ると回転になる 19 個の行列の並び」から探す
//   （手前の選手は描く命令からは見つからないことがあった。前の場面の行列が消えずに残っていることもある）
// しくみ: ゲームの骨の行列 G（射影込み）の 3×3 を親子で割ると、射影が消えて「親から見た向き」が出る（頭の骨は伸びているので大きさで割る）。
//   それをセーブのメモリの動きの表（v0.7.0、1,466 個。無ければ #1360）の全部のこま（とこまの間）と比べ、骨 1〜18 の角度のずれの平均がいちばん小さい動きを出す。脚・胴だけのずれも出す（腕は手を加えられていることがある）
import fs from "fs"; import vm from "vm"; import path from "path";
const here=path.dirname(new URL(import.meta.url).pathname), ctx={TextDecoder,DecompressionStream,Response,Blob}; vm.createContext(ctx);
for(const f of ["fzstd.js","we12.js","p2s.js","jw.js","jwbody.js"]) vm.runInContext(fs.readFileSync(path.join(here,f),"utf8"),ctx);
const g=n=>vm.runInContext(n,ctx);
const [,,save,addr]=process.argv; if(!save){ console.log("node motmatch.mjs data/xxx.p2s [番地]"); process.exit(1) }
const rd=i=>new Uint8Array(fs.readFileSync(path.join(here,`data/${String(i).padStart(5,"0")}.bin`)));
const b=fs.readFileSync(save), file={size:b.length,slice:(a,e)=>({arrayBuffer:async()=>b.buffer.slice(b.byteOffset+a,b.byteOffset+(e??b.length))})};
const m=await g("jwP2sMemory")(file), dv=new DataView(m.buffer,m.byteOffset,m.byteLength);
const B=g("jwBodyParse")(rd(g("JW_BODY"))), par=B.par, SM=g("jwSaveMotions")(m);
const U=SM?SM.u:rd(g("JW_MOTIONS")), L=SM?SM.list:g("jwMotionList")(U); console.log("動き",SM?`セーブのメモリの表 ${L.length} 個`:`#1360 の ${L.length} 個`);
// 行列の場所: 体の形（メモリの 0x1B5F100 付近の #1429）の包みのうち、骨 0 から始まる包みの ref のすぐ後ろの行列の ref
function findBases(){ const out=new Set(); const key=rd(g("JW_BODY")).subarray(16+0x80,16+0x80+0x200);
  let bm=-1; for(let a=0;a+key.length<=m.length;a+=16){ let ok=true; for(let i=0;i<64;i++) if(m[a+i]!==key[i]){ ok=false; break } if(ok){ bm=a-0x80; break } }
  if(bm<0) return [];
  const npk=dv.getUint32(bm+0x20,true); let po=bm+dv.getUint32(bm+0x24,true); const pk=[];
  for(let k=0;k<npk;k++){ const size=dv.getUint32(po,true), lo=po+dv.getUint32(po+0x18,true); pk.push([po,size,dv.getUint16(lo,true)]); po+=size }
  for(let a=0;a+32<=m.length;a+=16){ const lo=dv.getUint32(a,true), hi=dv.getUint32(a+4,true); if(((lo>>>28)&7)!==3) continue;
    const p=pk.find(([s,z,b0])=>hi>=s&&hi<s+z&&b0===0); if(!p) continue;
    const l2=dv.getUint32(a+16,true), h2=dv.getUint32(a+20,true); if(((l2>>>28)&7)===3&&(l2&0xffff)===4) out.add(h2) }
  return [...out].sort((a,c)=>a-c) }
const M3=(a)=>[0,1,2].map(r=>[0,1,2].map(c=>dv.getFloat32(a+r*16+c*4,true)));
const mul=(A,C)=>A.map(r=>[0,1,2].map(j=>r[0]*C[0][j]+r[1]*C[1][j]+r[2]*C[2][j]));
const inv=A=>{ const [[a,b,c],[d,e,f],[g2,h,i]]=A, D=a*(e*i-f*h)-b*(d*i-f*g2)+c*(d*h-e*g2); return [[(e*i-f*h)/D,(c*h-b*i)/D,(b*f-c*e)/D],[(f*g2-d*i)/D,(a*i-c*g2)/D,(c*d-a*f)/D],[(d*h-e*g2)/D,(b*g2-a*h)/D,(a*e-b*d)/D]] };
const quat=R=>{ const M=[[R[0][0],R[1][0],R[2][0]],[R[0][1],R[1][1],R[2][1]],[R[0][2],R[1][2],R[2][2]]], t=M[0][0]+M[1][1]+M[2][2];  // 行ベクトルの行列 → 向き (x,y,z,w)
  if(t>0){ const s=Math.sqrt(t+1)*2; return [(M[2][1]-M[1][2])/s,(M[0][2]-M[2][0])/s,(M[1][0]-M[0][1])/s,s/4] }
  const i=[0,1,2].reduce((a,c)=>M[c][c]>M[a][a]?c:a,0), j=(i+1)%3, k=(i+2)%3, s=Math.sqrt(1+M[i][i]-M[j][j]-M[k][k])*2, q=[0,0,0,0];
  q[i]=s/4; q[j]=(M[j][i]+M[i][j])/s; q[k]=(M[k][i]+M[i][k])/s; q[3]=(M[k][j]-M[j][k])/s; return q };
const local=base=>{ const G=[...Array(19)].map((_,k)=>M3(base+k*64)), q=[];
  for(let k=1;k<19;k++){ let R=mul(G[k],inv(G[par[k]])); const d=Math.cbrt(R[0][0]*(R[1][1]*R[2][2]-R[1][2]*R[2][1])-R[0][1]*(R[1][0]*R[2][2]-R[1][2]*R[2][0])+R[0][2]*(R[1][0]*R[2][1]-R[1][1]*R[2][0]));
    R=R.map(r=>r.map(x=>x/d)); q.push(quat(R)) } return q };
const ang=(a,b)=>2*Math.acos(Math.min(1,Math.abs(a[0]*b[0]+a[1]*b[1]+a[2]*b[2]+a[3]*b[3])))*180/Math.PI;
const LEGS=[1,2,3,4,5,6,12,13];   // 骨の番号（腰・腿・すね・足・胴）
const all=L.map(e=>g("jwMotionFrames")(U,e));
// メモリ全体から: 3 列目と 4 列目が等しい（射影込み）行列が 19 個続き、親子で割ると回転になる（頭の骨 16 は伸びているので除く）所
function scanBases(){ const f=a=>dv.getFloat32(a,true), out=new Set();
  const okM=a=>{ let nz=0; for(let r=0;r<4;r++){ const x=f(a+r*16+8), y=f(a+r*16+12); if(!isFinite(x)||Math.abs(x-y)>1e-3*Math.max(1,Math.abs(x))) return false;
    for(let c=0;c<4;c++){ const v=f(a+r*16+c*4); if(!isFinite(v)||Math.abs(v)>1e5||(v!==0&&Math.abs(v)<1e-6)) return false; if(v!==0) nz++ } } return nz>=8 };
  for(let a=0;a+19*64<=m.length;a+=16){ if(!okM(a)) continue; let k=1; for(;k<19;k++) if(!okM(a+k*64)) break; if(k<19) continue;
    const G=[...Array(19)].map((_,k)=>M3(a+k*64)); let err=0, moved=0;
    for(let k=1;k<19;k++){ if(k===16) continue; let R=mul(G[k],inv(G[par[k]])); const d=Math.cbrt(R[0][0]*(R[1][1]*R[2][2]-R[1][2]*R[2][1])-R[0][1]*(R[1][0]*R[2][2]-R[1][2]*R[2][0])+R[0][2]*(R[1][0]*R[2][1]-R[1][1]*R[2][0]));
      R=R.map(r=>r.map(x=>x/d)); for(let i=0;i<3;i++) for(let j=0;j<3;j++){ const v=R[i][0]*R[j][0]+R[i][1]*R[j][1]+R[i][2]*R[j][2]; err=Math.max(err,Math.abs(v-(i===j?1:0))||0); if(i===j&&Math.abs(R[i][i]-1)>0.01) moved++ } }
    if(err<0.05&&moved>5) out.add(a) }
  return out }
// 同じ選手の行列が少しずれた番地でも拾われるので、19 個分（0x4C0）の中は 1 つにする（描く命令から見つけた所を先に）
function allBases(){ const kept=findBases(); for(const a of [...scanBases()].sort((x,y)=>x-y)) if(kept.every(k=>Math.abs(k-a)>=19*64)) kept.push(a); return kept.sort((x,y)=>x-y) }
const bases=addr?[parseInt(addr,16)]:allBases();
console.log("行列の場所",bases.map(x=>x.toString(16)).join(" ")||"見つからない");
for(const base of bases){ const T=local(base); if(T.some(q=>q.some(x=>!isFinite(x)))) continue; const res=[];
  all.forEach((M,i)=>{ const F=M.frames; for(let f=0;f<F.length;f++) for(const t of F.length>1&&f<F.length-1?[0,0.25,0.5,0.75]:[0]){
    const q=F[f].q.map((v,k)=>t?g("jwSlerp")(v,F[f+1].q[k],t):v), e=q.map((v,k)=>ang(v,T[k])), all18=e.reduce((a,c)=>a+c,0)/18, legs=LEGS.reduce((a,k)=>a+e[k-1],0)/LEGS.length;
    res.push({i,f:f+t,all18,legs,n:F.length}) } });
  res.sort((a,c)=>a.legs-c.legs);
  console.log(`番地 ${base.toString(16)}:`,res.slice(0,3).map(r=>`動き ${r.i}（${r.n} こま）の ${r.f} こま目・脚と胴のずれ ${r.legs.toFixed(1)}°・全体 ${r.all18.toFixed(1)}°`).join(" ／ ")) }
