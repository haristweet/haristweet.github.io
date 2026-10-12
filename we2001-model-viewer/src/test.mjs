// 単体試験（disc/ にデータがあれば本物で）。node test.mjs
import fs from "fs"; import vm from "vm"; import path from "path";
const here=path.dirname(new URL(import.meta.url).pathname), ctx={console,TextDecoder,DecompressionStream,Blob,Response}; vm.createContext(ctx);
for(const f of ["wdisc.js","tmd.js","anim.js","tex.js","look.js","wgl.js"]) vm.runInContext(fs.readFileSync(path.join(here,f),"utf8"),ctx);
const g=n=>vm.runInContext(n,ctx); let ok=0, ng=0;
const t=(name,c)=>{ if(c){ ok++; console.log("  ok",name) } else { ng++; console.log("  NG",name) } };
// 圧縮: 旗 0x0b（1,1,0,1）: 生のまま 8 つ（0xc0）・近くの写し（0x80＝1 つ前を 2 つ）・文字 9・終わり（0xff）
{ const s=new Uint8Array([0x0b,0xc0,1,2,3,4,5,6,7,8,0x80,9,0xff]); t("weUnlz の 3 つの形",g("weUnlz")(s,0).join()==="1,2,3,4,5,6,7,8,8,8,9") }
const chd=path.join(here,"disc/we2001.chd"), x=path.join(here,"disc/x/BIN");
if(!fs.existsSync(chd)){ console.log("disc/ が無いので本物での試験はしない"); console.log(ok,"件 ok",ng?ng+" 件 NG":""); process.exit(ng?1:0) }
const files=await g("discOpen")(new Blob([fs.readFileSync(chd)]));
t(`CHD のファイルの一覧（${files.size} 個、BIN/MODEL.BIN がある）`,files.size>200&&files.has("BIN/MODEL.BIN"));
const model=await files.get("BIN/MODEL.BIN")(), anime=await files.get("BIN/ANIME.BIN")(), dat2d=await files.get("BIN/DAT2D.BIN")();
if(fs.existsSync(x)) t("CHD から読んだ MODEL.BIN が iso.py で取り出したものと同じ",Buffer.from(model).equals(fs.readFileSync(path.join(x,"MODEL.BIN"))));
{ let n=0,bad=0; for(const s of [2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17]) for(const e of g("weModelSet")(model,s)) if(e.type===2&&e.off>=0){ const tm=g("tmdRead")(model,e.off); n++; bad+=tm.objs.reduce((a,o)=>a+o.bad,0) }
  t(`組の部品が TMD として読める（${n} 個、読めない面 ${bad}）`,n>150&&bad===0) }
{ let withF=0; for(let a=0;a<204;a++) if(g("weAnimFrames")(anime,a)>0) withF++; t(`動き 204 個のうちコマのあるもの ${withF}`,withF>150) }
{ const v=g("weVramNew")(), p=[...g("weTexLoadRun")(v,dat2d,0x800f0000,0),...g("weTexLoadRun")(v,dat2d,0x800f0000,1)];
  t(`DAT2D の札 ${p.length} 枚、圧縮をほどいた大きさが合う`,p.length===290&&p.every(r=>r.type===9||r.len===r.want)) }
{ let bad=0,n=0; for(const [k,f] of files) if(/^BIN\/TEX_\d+\.BIN$/.test(k)){ const p=g("weTexLoad")(g("weVramNew")(),await f(),0x800f0000); n++; if(p.length!==11||p.some(r=>r.type===10&&r.len<r.want)) bad++ }
  t(`TEX_00〜45 の札が 11 枚ずつ読める（${n} 個、だめ ${bad}）`,n===46&&!bad) }
{ const parts=g("wePose")(model,anime,6,0,3,0), tm=new Map(parts.map(p=>[p.off,g("tmdRead")(model,p.off)])), r=g("weTris")(tm,parts,null,[0,-1,0]);
  t(`組 6 を組むと 12 部品・三角形 ${r.tris.length/18}・テクスチャの組 ${r.used.length}`,parts.length===12&&r.tris.length/18>200&&r.used.length<=16) }
// 関節: 全部の動き・コマで「親の部品に固定した点」と「子の部品に固定した点」が重なるように当てはめ、残りのずれが小さい（回転の掛け方の確かめ）
{ const solve=(A,b)=>{ const n=6, M=Array.from({length:n},()=>new Array(n+1).fill(0));
    for(let r=0;r<A.length;r++) for(let i=0;i<n;i++){ for(let j=0;j<n;j++) M[i][j]+=A[r][i]*A[r][j]; M[i][n]+=A[r][i]*b[r] }
    for(let i=0;i<n;i++){ let p=i; for(let k=i+1;k<n;k++) if(Math.abs(M[k][i])>Math.abs(M[p][i])) p=k; [M[i],M[p]]=[M[p],M[i]];
      for(let k=0;k<n;k++) if(k!==i){ const f=M[k][i]/M[i][i]; for(let j=i;j<=n;j++) M[k][j]-=f*M[i][j] } }
    return M.map((r,i)=>r[n]/r[i]) };
  let worst=0;
  for(const [p,q] of [[6,7],[9,10],[7,8],[10,11],[1,0],[1,2],[2,3],[1,4],[4,5]]){ const A=[],b=[];
    for(let an=0;an<204;an++){ const n=g("weAnimFrames")(anime,an); for(let f=0;f<n;f++){ const fo=g("weAnimFrame")(anime,an,f), P=g("weDecodePart")(anime,fo+p*8), Q=g("weDecodePart")(anime,fo+q*8), mp=g("weRotMatrix")(P.rot), mq=g("weRotMatrix")(Q.rot);
      for(let i=0;i<3;i++){ A.push([mp[i][0],mp[i][1],mp[i][2],-mq[i][0],-mq[i][1],-mq[i][2]]); b.push(Q.t[i]-P.t[i]) } } }
    const x=solve(A,b); let e=0; for(let r=0;r<A.length;r++){ const d=A[r].reduce((s,v,i)=>s+v*x[i],0)-b[r]; e+=d*d } worst=Math.max(worst,Math.sqrt(e/A.length)) }
  t(`膝・足首・首・肩・ひじのずれ（二乗平均）最大 ${worst.toFixed(2)}（すねの長さ 120 ほどに対して）`,worst<1.5) }
// 選手の表: 鹿島（1）の小笠原は背番号 8、ジュビロ（9）の中山は 9、マンチェスター（34）のベッカム（7 人目）は 7。各チームの 1 人目はキーパー
{ const sel=await files.get("SELECT.BIN")(), exe=await files.get("SLPM_868.35")(), P=(t,i)=>g("wePlayer")(sel,exe,t,i), T=g("weTeamNames")(sel);
  t(`チーム名 43（${T[1]}・${T[9]}・${T[34]}）`,T.length===43&&T[1]==="鹿島アントラーズ"&&T[34]==="マンチェスター");
  t(`小笠原 ${P(1,8).num}・中山 ${P(9,9).num}・ベッカム ${P(34,7).num}`,P(1,8).name==="小笠原 満男"&&P(1,8).num===8&&P(9,9).num===9&&P(34,7).num===7);
  let gk=0; for(let k=0;k<28;k++) if(P(k,0).gk) gk++; t(`各チームの 1 人目がキーパー（${gk}/28）`,gk===28);
  // 背番号の UV: 欄 0 は元の UV と同じ（ゲームの式を 0 で計算すると TMD の値に戻る）
  const set=g("weModelSet")(model,6), tm=g("tmdRead")(model,set[1].off), p3=tm.objs[0].prims[2], L=g("weLookPrim")(p3,1,3,{skin:1,hcol:0,s112:0,boots:0,face:0,hmap:0,cell:0});
  t("背番号の欄 0 の UV が TMD の元の値と同じ",JSON.stringify(L.uv)===JSON.stringify(p3.uv)) }
console.log(ok,"件 ok",ng?ng+" 件 NG":""); if(ng) process.exit(1);
