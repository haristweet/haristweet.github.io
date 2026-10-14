// 単体試験。node test.mjs（data/ と out/fake.* があれば本物の見本で）
import fs from "fs"; import vm from "vm"; import path from "path"; import zlib from "zlib";
const here=path.dirname(new URL(import.meta.url).pathname), ctx={console,DecompressionStream,Blob,Response,TextDecoder}; vm.createContext(ctx);
for(const f of ["fzstd.js","we12.js","p2s.js","jw.js","jwbody.js","wgl.js"]) vm.runInContext(fs.readFileSync(path.join(here,f),"utf8"),ctx);
const g=n=>vm.runInContext(n,ctx); let ok=0, ng=0;
const t=(name,c)=>{ if(c){ ok++; console.log("  ok",name) } else { ng++; console.log("  NG",name) } };
// zip を作る（.p2s の代わり）。method: 0＝そのまま、8＝deflate、93＝zstd（node の zlib で縮める）
function zip(files){ const loc=[], cd=[]; let pos=0;
  for(const [name,data,method] of files){ const nm=Buffer.from(name), z=method===8?zlib.deflateRawSync(data):method===93?zlib.zstdCompressSync(data):data;
    const h=Buffer.alloc(30); h.writeUInt32LE(0x04034b50,0); h.writeUInt16LE(method,8); h.writeUInt32LE(z.length,18); h.writeUInt32LE(data.length,22); h.writeUInt16LE(nm.length,26);
    const c=Buffer.alloc(46); c.writeUInt32LE(0x02014b50,0); c.writeUInt16LE(method,10); c.writeUInt32LE(z.length,20); c.writeUInt32LE(data.length,24); c.writeUInt16LE(nm.length,28); c.writeUInt32LE(pos,42);
    loc.push(h,nm,z); cd.push(c,nm); pos+=30+nm.length+z.length }
  const cdb=Buffer.concat(cd), e=Buffer.alloc(22); e.writeUInt32LE(0x06054b50,0); e.writeUInt16LE(files.length,8); e.writeUInt16LE(files.length,10); e.writeUInt32LE(cdb.length,12); e.writeUInt32LE(pos,16);
  return Buffer.concat([...loc,cdb,e]) }
// 偽のメモリ: 0x1000 から 300 人。名前「選手n」、背中「Pn」、顔の値 n（＋上の印 0x1000）、髪の値 n
{ const m=Buffer.alloc(0x40000);
  for(let i=0;i<300;i++){ const a=0x1000+i*0x7C; m.write(`選手${i}`,a,"utf16le"); m.write(`P${i}`,a+0x20,"latin1"); m.writeUInt16LE(0x1000|i,a+0x5c); m.writeUInt16LE(i<<5|8,a+0x64) }
  for(const method of [0,8,93]){ const mem=await g("jwP2sMemory")(new Blob([zip([["PCSX2 Savestate Version.id",Buffer.from("x"),0],["eeMemory.bin",m,method]])]));
    const ps=g("jwPlayers")(mem), p=ps[7];
    t(`偽のセーブ（縮め方 ${method}）: ${ps.length} 人・8 人目 ${p.name}/${p.shirt}・顔 #${p.face}・髪 #${p.hair}`,ps.length===300&&p.name==="選手7"&&p.shirt==="P7"&&p.face===2114&&p.hair===4740) } }
// 本物のセーブ（選手選択の画面。関口・梁にカーソル）。ゲームがメモリに持つ「読み込み済みの顔・髪」の表と、表から出した番号を突き合わせる
//   顔: 0x556AA0 から 0x40 ごと [2,2,印,枠, …, +0x14 にファイル番号]（印 1＝画面に出ている選手）。髪: 0x5572C4 から 0x18 ごと [大きさ, 2,印,枠,0, …, +0x14 にファイル番号]
function cache(mem){ const dv=new DataView(mem.buffer,mem.byteOffset), face=[], hair=[];
  for(let s=0x556aa0;mem[s]===2&&mem[s+1]===2;s+=0x40) face.push({file:dv.getUint16(s+0x14,true),on:mem[s+2]});
  let s=0x5572c4; while(mem[s-0x18+4]===2&&mem[s-0x18+7]===0) s-=0x18;
  for(;mem[s+4]===2&&mem[s+7]===0;s+=0x18) hair.push(dv.getUint16(s+0x14,true));
  return {face,hair} }
// ryang の顔 #2488（相手の横浜 FC の枠）はだれの番号にもならない（分からないまま。表に無い選手？）
for(const [f,who,face,hair,unknown] of [["sekiguchi.p2s","関口 訓充",3378,7189,[]],["ryang.p2s","梁 勇基",4219,8026,[2488]]]){
  const sv=path.join(here,"data",f); if(!fs.existsSync(sv)){ console.log(`data/${f} が無いので本物のセーブでの試験はしない`); continue }
  const mem=await g("jwP2sMemory")(new Blob([fs.readFileSync(sv)])), ps=g("jwPlayers")(mem), p=ps.find(x=>x.name===who), c=cache(mem);
  const on=c.face.find(x=>x.on===1)?.file, fs_=new Set(ps.map(x=>x.face)), hs=new Set(ps.map(x=>x.hair));
  const ts=g("jwTeams")(mem,ps), v=ts[0], k=ts.find(x=>x.name==="鹿島アントラーズ");
  t(`${f}: チーム ${ts.length}、先頭 ${v?.name}（${v?.members.length} 人、8 人目 ${ps[v?.members[7]]?.name}）・鹿島 ${k?.members.length} 人（1 人目 ${ps[k?.members[0]]?.name}）`,ts.length>=150&&v.name==="ベガルタ仙台"&&v.members.length===26&&ps[v.members[7]].name==="関口 訓充"&&ps[k.members[0]].name==="曽ヶ端 準");
  t(`${f}: ${ps.length} 人、${who} 顔 #${p.face}・髪 #${p.hair}、画面の顔 #${on}`,ps.length===4609&&p.face===face&&p.hair===hair&&on===face);
  const nf=c.face.filter(x=>!fs_.has(x.file)&&!unknown.includes(x.file)).map(x=>x.file), nh=c.hair.filter(x=>!hs.has(x));
  t(`${f}: 読み込まれていた顔 ${c.face.length}・髪 ${c.hair.length} がだれかの番号（分からないまま ${unknown.join(",")||"なし"}・だめ 顔 ${nf.join(",")||"なし"}・髪 ${nh.join(",")||"なし"}）`,c.face.length>=6&&!nf.length&&!nh.length);
}
// 見本のある顔・髪のファイルの並び（顔は MMT・髪は MTT）
{ const sv=path.join(here,"data/sekiguchi.p2s");
  if(fs.existsSync(sv)){ const ps=g("jwPlayers")(await g("jwP2sMemory")(new Blob([fs.readFileSync(sv)]))), bad=[]; let n=0;
    for(const p of ps.slice(0,30)) for(const [i,want] of [[p.face,"MMT"],[p.hair,"MTT"]]){ const f=path.join(here,`data/${String(i).padStart(5,"0")}.bin`);
      if(!fs.existsSync(f)) continue; n++; if(g("weSig")(new Uint8Array(fs.readFileSync(f)))!==want) bad.push(p.name+":"+i) }
    t(`表の先頭 30 人のうち見本のある ${n} 個の並び（だめ ${bad.join(" ")||"なし"}）`,!bad.length) } }
// 共通の絵: #8234（目・耳・口）と #8226（髪の地）は並べ替えを戻すと、田村のセーブの画面用メモリ（GS.bin の 425 バイト目から）と同じ点になる
{ const rd=i=>{ const f=path.join(here,`data/0${i}.bin`); return fs.existsSync(f)?new Uint8Array(fs.readFileSync(f)):null };
  const f={parts:rd(8234),partsPal:rd(8227),back:rd(8226),ring:rd(8231)};
  if(Object.values(f).every(Boolean)){ const c=g("jwCommonTextures")(f);
    // 目のあたり（256×128 の右下）に不透明な点がある
    const a=(t,x,y)=>t.rgba[(y*t.W+x)*4+3];
    t(`共通の絵 3 枚（${c.parts.W}×${c.parts.H}・${c.back.W}×${c.back.H}・${c.ring.W}×${c.ring.H}）、目の所が不透明`,c.parts.W===256&&c.back.W===512&&a(c.parts,208,112)>200);
    const gs=path.join(here,"data/tamura_GS.bin");
    if(fs.existsSync(gs)){ const vr=fs.readFileSync(gs).subarray(425), BT=g("JW_BT"), CT8=g("JW_CT8");
      const a8=(bp,bw,x,y)=>bp*256+((x>>7)+(y>>6)*(bw>>1))*8192+BT[(y&63)>>4][(x&127)>>4]*256+CT8[y&15][x&15];
      const pix=g("jwTexHeads")(f.parts)[0].pix, un=g("jwUnswizzle8")(pix,256,128); let ok8=0,n=0;
      for(let y=84;y<128;y++) for(let x=160;x<256;x++){ n++; if(un[y*256+x]===vr[a8(15072,4,x,y)]) ok8++ }
      t(`#8234 を戻した点が画面用メモリの目・耳・口と一致（${ok8}/${n}）`,ok8===n) } } }
// 体（#1429）: 骨 19 本・包み 56。立ち姿の高さと腕の幅、頭が首の上に来ること。対の行列の作り方は nagai2 のゲームの行列と一致したもの（数字はここでは試さない）
{ const f=path.join(here,"data/01429.bin");
  if(fs.existsSync(f)){ const B=g("jwBodyParse")(new Uint8Array(fs.readFileSync(f))), cur=g("jwBodyStand")(B), tris=g("jwBodyTris")(B,cur,P=>g("JW_BODY_OPTS").has(P.opt));
    const ps=tris.flatMap(x=>x.p), mn=[0,1,2].map(i=>Math.min(...ps.map(v=>v[i]))), mx=[0,1,2].map(i=>Math.max(...ps.map(v=>v[i])));
    t(`体 #1429: 骨 ${B.Bind.length}・包み ${B.packs.length}・三角形 ${tris.length}・高さ ${mn[1].toFixed(0)}〜${mx[1].toFixed(0)}・幅 ±${mx[0].toFixed(0)}`,B.Bind.length===19&&B.packs.length===56&&mn[1]<0&&mx[1]>600&&mx[1]<700&&mx[0]<200);
    const T=g("jwBodyTris")(B,null,P=>g("JW_BODY_OPTS").has(P.opt)), tx=Math.max(...T.flatMap(x=>x.p.map(v=>v[0])));
    t(`T の形では腕が横に伸びる（幅 ±${tx.toFixed(0)}）`,tx>300);
    const h=cur[16]; t(`頭の骨（16）は首の上（高さ ${h[13].toFixed(0)}）`,h[13]>650&&Math.abs(h[12])<1);
    // 手（#8095）: 左右 2 つ。手首（骨 17・18）のそばに来る
    const hf=path.join(here,"data/08095.bin");
    if(fs.existsSync(hf)){ const hm=g("jwHandMeshes")(new Uint8Array(fs.readFileSync(hf)),cur,null), d=[];
      for(const [m,b] of [[hm[0],18],[hm[1],17]]){ const w=g("jwWorldToView")(cur[b].slice(12,15)); let s=[0,0,0],n=0; for(let k=0;k<m.f.length;k+=5){ for(let j=0;j<3;j++) s[j]+=m.f[k+j]; n++ } d.push(Math.hypot(...s.map((v,j)=>v/n-w[j]))) }
      t(`手 #8095: 2 つ・三角形 ${hm.map(m=>m.ntri).join("+")}・手の真ん中から手首の骨まで ${d.map(x=>x.toFixed(0)).join("・")}`,hm.length===2&&hm.every(m=>m.ntri>50)&&d.every(x=>x<60)) } } }
// セーブの中のユニフォームとスパイク（関口のセーブ: 中身のある 2 着（仙台のホーム・仙台の GK。絵で確認）とスパイク 1 つ）
{ const f=path.join(here,"data/sekiguchi.p2s");
  if(fs.existsSync(f)){ const b=fs.readFileSync(f), file={size:b.length,slice:(a,e)=>({arrayBuffer:async()=>b.buffer.slice(b.byteOffset+a,b.byteOffset+(e??b.length))})};
    const k=g("jwSaveKits")(await g("jwP2sMemory")(file));
    // 背番号（v0.5.0）: 名簿の 0x1710 前の番号表。ベガルタの林 16・関口 11・梁 10・永井 8、鹿島の曽ヶ端 21
    { const mem=await g("jwP2sMemory")(file), ps=g("jwPlayers")(mem), tm=g("jwTeams")(mem,ps), num=(ti,re)=>{ const T=tm.find(x=>x.i===ti), k=T.members.findIndex(i=>re.test(ps[i].name)); return T.numbers[k] };
      const got=[num(0,/林 卓人/),num(0,/関口/),num(0,/梁/),num(0,/永井 篤志/),num(2,/曽ヶ端/)];
      t(`背番号 林・関口・梁・永井・曽ヶ端＝${got.join("・")}`,got.join()==="16,11,10,8,21");
      const f=k.kits[0].fonts; t(`1 着目に背番号の字と色表がある`,!!(f&&f.digits&&f.letters&&f.back&&f.chest&&f.shorts&&f.name));
      // 番号の絵: 2 桁は升を左右、1 桁は真ん中（16 は「1」を詰める）
      const ink=T=>{ const xs=[]; for(let x=0;x<64;x++) for(let y=0;y<32;y++) if(T[y*64+x]){ xs.push(x); break } return [xs[0],xs.at(-1)] };
      const i8=ink(g("jwNumberIdx")(f.digits,8)), i22=ink(g("jwNumberIdx")(f.digits,22));
      t(`番号の絵 8 は真ん中（${i8}）・22 は左右いっぱい（${i22}）`,Math.abs((i8[0]+i8[1])/2-31.5)<3&&i22[0]<8&&i22[1]>55);
      const nm=g("jwNameIdx")(f.letters,"NAGAI"); let xs=[]; for(let x=0;x<256;x++) for(let y=0;y<32;y++) if(nm[y*256+x]){ xs.push(x); break }
      t(`名前の絵 NAGAI は真ん中あたり（${xs[0]}〜${xs.at(-1)}）`,xs.length&&Math.abs((xs[0]+xs.at(-1))/2-128)<6);
      const bf=path.join(here,"data/01429.bin");
      if(fs.existsSync(bf)){ const B=g("jwBodyParse")(new Uint8Array(fs.readFileSync(bf))), ms=g("jwOverlayMeshes")(B,g("jwBodyStand")(B),f,g("jwBodyOpts")(false,false),"SEKIGUCHI",11);
        t(`重ねの形 ${ms.length} つ（背中・胸・パンツの番号と名前）・端を伸ばす`,ms.length===4&&ms.every(m=>m.clamp&&m.ntri>0)) } }
    t(`セーブのユニフォーム ${k.kits.length} 着（${k.kits.map(x=>x.id.toString(16)).join("・")}）・スパイク ${k.boots?k.boots.W+"×"+k.boots.H:"無し"}`,k.kits.length===2&&k.kits[0].id===0xfa0&&k.boots&&k.boots.W===256) } }
// 動き（v0.6.0）: #1360 の 485 個。0 番の 1 こま目で組んだ骨の行列は T の立ち姿（体のファイルの骨の行列）と 0.1 以内。394 番は 26 こま・1.667 秒
{ const mf=path.join(here,"data/01360.bin"), bf=path.join(here,"data/01429.bin");
  if(fs.existsSync(mf)&&fs.existsSync(bf)){ const U=new Uint8Array(fs.readFileSync(mf)), B=g("jwBodyParse")(new Uint8Array(fs.readFileSync(bf))), L=g("jwMotionList")(U);
    const W=g("jwMotionPose")(B,g("jwMotionFrames")(U,L[0]).frames[0]); let mx=0; W.forEach((m,k)=>m.forEach((v,i)=>mx=Math.max(mx,Math.abs(v-B.Bind[k][i]))));
    const m394=g("jwMotionFrames")(U,L[394]);
    t(`動き ${L.length} 個・0 番の姿と T の姿のずれ ${mx.toFixed(3)}・394 番 ${m394.frames.length} こま ${m394.dur.toFixed(3)} 秒`,L.length===485&&mx<0.1&&m394.frames.length===26&&Math.abs(m394.dur-1.667)<0.01) } }
// 動きの表（v0.7.0）: スライディングの場面のセーブ（data/slide.p2s）のメモリに 1,466 個。725 番＝スライディング 39 こま。表の 1140 番は #1360 の 239 番と同じ中身
{ const sv=path.join(here,"data/slide.p2s"), mf=path.join(here,"data/01360.bin");
  if(fs.existsSync(sv)&&fs.existsSync(mf)){ const b=fs.readFileSync(sv), file={size:b.length,slice:(a,e)=>({arrayBuffer:async()=>b.buffer.slice(b.byteOffset+a,b.byteOffset+(e??b.length))})};
    const S=g("jwSaveMotions")(await g("jwP2sMemory")(file)), U=new Uint8Array(fs.readFileSync(mf)), L=g("jwMotionList")(U);
    const sl=g("jwMotionFrames")(S.u,S.list[725]), x=g("jwMotionFrames")(S.u,S.list[1140]), y=g("jwMotionFrames")(U,L[239]);
    const sk=g("jwSaveMotions")(await g("jwP2sMemory")((b2=>({size:b2.length,slice:(a,e)=>({arrayBuffer:async()=>b2.buffer.slice(b2.byteOffset+a,b2.byteOffset+(e??b2.length))})}))(fs.readFileSync(path.join(here,"data/sekiguchi.p2s")))));
    t(`セーブの動きの表 ${S.list.length} 個・725 番 ${sl.frames.length} こま・1140 番＝#1360 の 239 番・選択の画面のセーブでは使わない`,S.list.length===1466&&sl.frames.length===39&&JSON.stringify(x)===JSON.stringify(y)&&sk===null) } }
// ユニフォームの下絵（v0.8.0）: 服の包みは出し分け 9 つ、uv はどれも 0〜1 の中
{ const bf=path.join(here,"data/01429.bin");
  if(fs.existsSync(bf)){ const B=g("jwBodyParse")(new Uint8Array(fs.readFileSync(bf))), P=g("jwKitLayout")(B,g("jwBodyStand")(B)), us=P.flatMap(p=>p.tris.flat());
    t(`ユニフォームの下絵 ${P.length} 部分・三角形 ${P.reduce((a,p)=>a+p.tris.length,0)}・uv は 0〜1`,P.length===9&&us.every(u=>u[0]>=0&&u[0]<=1&&u[1]>=0&&u[1]<=1)) } }
// 自分の字（v0.9.0）: ゲームの字を字の下絵（256×96）にして読み直すと、数字・英字の 4 ビットの値がまったく同じ
{ const f=path.join(here,"data/sekiguchi.p2s");
  if(fs.existsSync(f)){ const b=fs.readFileSync(f), file={size:b.length,slice:(a,e)=>({arrayBuffer:async()=>b.buffer.slice(b.byteOffset+a,b.byteOffset+(e??b.length))})};
    const F=g("jwSaveKits")(await g("jwP2sMemory")(file)).kits[0].fonts, R=g("jwFontFromRGBA")(g("jwFontToRGBA")(F),256,96);
    t(`字の下絵を読み直すと数字・英字が同じ・数字の幅 ${R.numW.length} 個`,Buffer.from(R.digits).equals(Buffer.from(F.digits))&&Buffer.from(R.letters).equals(Buffer.from(F.letters))&&R.numW.length===10) } }
const fa=path.join(here,"out/fake_0_TEXT.AFS"), fi=path.join(here,"out/fake.iso");
if(fs.existsSync(fa)) for(const [name,f] of [["AFS",fa],["ISO",fi]]){
  const blob=new Blob([fs.readFileSync(f)]), d=await g("weOpen")(blob), u=await g("weFile")(blob,d,3377);
  t(`${name} から開いて #3377 をほどくと見本と同じ・並び ${g("weSig")(u)}`,d.from===name&&Buffer.from(u).equals(fs.readFileSync(path.join(here,"data/03377.bin")))&&g("weSig")(u)==="MMT");
} else console.log("out/fake_0_TEXT.AFS が無いので偽のディスクでの試験はしない（node mkfake.mjs で作る）");
console.log(ok,"件 ok",ng?ng+" 件 NG":""); if(ng) process.exit(1);
