import fs from "fs";
const read=f=>fs.readFileSync(f,"utf8");
let code=[ "skel.js","pack.js","table.js","mips.js","model.js","fit.js","vram1.js","model1.js","bone.js","mem.js","tex1.js","survey2.js","print.js" ].map(read).join("\n")
  + "\nconst state={rig:'t2'};\nconst hex=(n,w=8)=>'0x'+(n>>>0).toString(16).toUpperCase().padStart(w,'0');\n"
  + "const FLAT_W=new Proxy({},{get:()=>({R:I3,T:[0,0,0]})});\n"
  + read("_buildModel.js") + "\n" + read("_scoreTables.js") + "\n" + read("_arcpick.js") + "\n"
  + "const idle=()=>Promise.resolve();\n" + read("_scan.js") + "\n"
code+="\n;globalThis.API={"+[...new Set([...code.matchAll(/^(?:async\s+)?function\*?\s+([\w$]+)|^(?:const|let|var)\s+([\w$]+)/gm)].map(m=>m[1]||m[2]))]
      .map(n=>`get ${n}(){return ${n}}`).join(",")+"};";
const fn=new Function(code); fn();
const API=globalThis.API;
// 中の名前を全部そのまま使えるようにする（一覧を手で書かない。書き忘れ・消し忘れが起きる）
for(const n of Object.keys(Object.getOwnPropertyDescriptors(API)))
  if(!(n in globalThis)) Object.defineProperty(globalThis,n,{get:()=>API[n],configurable:true});

let pass=0,fail=0;
const ok=(name,cond,extra="")=>{ if(cond){pass++;console.log("  ok   "+name)} else {fail++;console.log("  FAIL "+name+"  "+extra)} };

const file0=new Uint8Array(fs.readFileSync("fixture_model.bin"));
const exe  =new Uint8Array(fs.readFileSync("fixture_exe.bin"));
const arc  =new Uint8Array(fs.readFileSync("fixture_arc.bin"));

console.log("\n[1] 入れ子と見分け");
const parts=unpack(file0);
ok("unpack で 4 部分に分かれる", parts && parts.length===4, parts?parts.length:"null");
const cl=classify(file0.subarray(0,2048), file0.length);
ok("classify がモデルらしいと見分ける", cl.kind==="model"&&cl.parts===4, JSON.stringify(cl).slice(0,80));

console.log("\n[2] ゲーム独自の圧縮の展開");
const out=decompress(parts[0]);
ok("展開できる（長さ 0x3F8）", out.length===0x400-8, out.length);

console.log("\n[3] モデルの組み立て");
for(const rig of ["t2","flat"]){
  state.rig=rig;
  let r=null,err=null;
  try{ r=buildModel(file0) }catch(e){ err=e.message }
  ok(`骨格「${rig}」で三角形が2枚出る`, r&&r.info.tris===2, err||(r?r.info.tris:""));
  if(r&&rig==="t2"){
    ok("  テクスチャの部分を 2 と当てる", r.info.texIndex===2, r.info.texIndex);
    ok("  骨を 41 本読む", r.info.bones>0, r.info.bones);
    ok("  頂点の色が乗る（200,150,100）", Math.round(r.mesh.col[0]*255)===200&&Math.round(r.mesh.col[1]*255)===150, [r.mesh.col[0],r.mesh.col[1]]);
    ok("  骨の長さが座標に効く（原点から離れる）", r.mesh.pos.some(v=>Math.abs(v)>0), "");
  }
}
state.rig="t2";

console.log("\n[4] ファイル表さがし");
const ex=exeInfo(exe);
ok("PS-X EXE と分かる", ex.ok&&ex.text===0x80010000, JSON.stringify(ex));
const tbls=findFileTables(exe,arc.length);
ok("候補が見つかる", tbls.length>0, tbls.length);
const best=tbls[0], addr=ex.text+(best.off-0x800);
ok("いちばんの候補が 0x800CD660", addr===0x800CD660, "0x"+addr.toString(16));
ok("件数 200 を当てる", best.count===200, best.count);
ok("詰まり 100%", best.strict===best.count-1, `${best.strict}/${best.count-1}`);
const tb=readTable(exe,best);
ok("表の1件目が sector 0 / 種類 3", tb[0].sector===0&&tb[0].type===3, JSON.stringify(tb[0]));
ok("表から読んだ位置で本物のファイルが取れる",
   (()=>{ const e=tb[3]; const d=arc.subarray(e.sector*2048,e.sector*2048+e.size);
          return e.size===file0.length&&d.every((v,i)=>v===file0[i]) })(), "");

console.log("\n[5] 種類ちがいのファイルを弾く");
const other=arc.subarray(tb[1].sector*2048,tb[1].sector*2048+tb[1].size);
ok("モデルでないファイルは model と見分けない", classify(other.subarray(0,2048),other.length).kind!=="model", "");
let bad=null; try{ bad=buildModel(other) }catch(_){ bad="threw" }
ok("モデルでないファイルは三角形が取れず、理由が付く（黙って空を返さない）",
   bad==="threw"||(bad&&bad.info.tris===0&&!!bad.info.error), JSON.stringify(bad==="threw"?"threw":bad.info.error));

console.log("\n[6] 表の形ちがい・空きスロット");
function fakeExe(entries,{shape=0,holesAt=[]}={}){
  const buf=new Uint8Array(0x800+0x20000), dv=new DataView(buf.buffer);
  buf.set(new TextEncoder().encode("PS-X EXE"),0);
  dv.setUint32(0x18,0x80010000,true); dv.setUint32(0x1c,0x20000,true);
  const base=0x800+0x1000;
  entries.forEach(([sec,size,type],i)=>{
    if(holesAt.includes(i)){ dv.setUint32(base+i*8,0,true); dv.setUint32(base+i*8+4,0,true); return }
    dv.setUint32(base+i*8,sec,true);
    dv.setUint32(base+i*8+4,shape===0?((size<<8)|type):size,true);
  });
  return {buf,base};
}
const seq=[]; { let sec=0; for(let i=0;i<120;i++){ const size=1000+i*13; seq.push([sec,size,3]); sec+=Math.ceil(size/2048) } }
const arcBytes=seq.at(-1)[0]*2048+seq.at(-1)[1];
{
  const {buf,base}=fakeExe(seq,{holesAt:[40,41,42]});
  const t=findFileTables(buf,arcBytes)[0];
  ok("途中の空きスロットで並びが切れない", t&&t.off===base&&t.count===120, t?`off=${t.off} base=${base} count=${t.count}`:"none");
  const rows=readTable(buf,t);
  ok("  空きスロットは大きさ 0 で返る", rows[41].size===0&&rows[43].size>0, JSON.stringify(rows[41]));
}
{
  const {buf,base}=fakeExe(seq,{shape:1});
  const t=findFileTables(buf,arcBytes)[0];
  ok("「位置 / 大きさ」の表も見つかる", t&&t.off===base&&t.shape===1&&t.count===120, t?`shape=${t.shape} count=${t.count}`:"none");
  const rows=readTable(buf,t);
  ok("  その形で大きさが読める", rows[5].size===seq[5][1]&&rows[5].sector===seq[5][0], JSON.stringify(rows[5]));
}
{
  const {buf}=fakeExe(seq);
  ok("末尾の 0 埋めを表に飲み込まない", findFileTables(buf,arcBytes)[0].count===120, findFileTables(buf,arcBytes)[0].count);
}

console.log("\n[7] 本物の表より長い「まぐれの並び」に負けないか（実物で起きた症状）");
{
  // まぐれ: 隙間なく 200 件そろっているが、指す先は中身でたらめ
  // 本物:   120 件で、指す先はちゃんとした入れ子ファイル
  const junk=new Uint8Array(1200).fill(0x5a);
  const realRows=[], junkRows=[], arcParts=[];
  let sec=0;
  const push=(data,rows)=>{ rows.push([sec,data.length]); arcParts.push(data); sec+=Math.ceil(data.length/2048) };
  for(let i=0;i<120;i++) push(file0,realRows);
  for(let i=0;i<200;i++) push(junk,junkRows);
  const arcLen=sec*2048, arc2=new Uint8Array(arcLen);
  { let off=0; for(const d of arcParts){ arc2.set(d,off); off+=Math.ceil(d.length/2048)*2048 } }

  const buf=new Uint8Array(0x800+0x40000), dv=new DataView(buf.buffer);
  buf.set(new TextEncoder().encode("PS-X EXE"),0);
  dv.setUint32(0x18,0x80010000,true); dv.setUint32(0x1c,0x40000,true);
  const realBase=0x800+0x1000, junkBase=0x800+0x8000;
  realRows.forEach(([s0,sz],i)=>{ dv.setUint32(realBase+i*8,s0,true); dv.setUint32(realBase+i*8+4,(sz<<8)|3,true) });
  junkRows.forEach(([s0,sz],i)=>{ dv.setUint32(junkBase+i*8,s0,true); dv.setUint32(junkBase+i*8+4,(sz<<8)|5,true) });

  const tbls=findFileTables(buf,arcLen);
  const realAddr=0x80010000+(realBase-0x800), junkAddr=0x80010000+(junkBase-0x800);
  const addrOf=t=>0x80010000+(t.off-0x800);
  ok("まぐれの並びのほうが長いので、並べただけでは先頭に来る", addrOf(tbls[0])===junkAddr, "0x"+addrOf(tbls[0]).toString(16));

  state.src={exe:buf, readArc:async(s0,n)=>arc2.subarray(s0*2048,s0*2048+n)};
  await scoreTables(tbls);
  ok("中身を確かめると本物が先頭に来る", addrOf(tbls[0])===realAddr, "0x"+addrOf(tbls[0]).toString(16));
  ok("  本物は中身 100%", tbls[0].hits===1, tbls[0].hits);
  ok("  まぐれは中身 0%", tbls.find(t=>addrOf(t)===junkAddr).hits===0, tbls.find(t=>addrOf(t)===junkAddr).hits);
  state.src=null;
}
{
  // アーカイブに素のデータが混ざっていると、本物の表の「中身の割合」は下がる。
  // 割合だけで並べると、たまたま高い割合が出た短い誤検出に負けてしまう
  const t=[{off:0x800,count:200,strict:199,hits:0.38},{off:0x900,count:88,strict:0,hits:0.50}];
  const score=x=>x.hits*x.count;
  t.sort((a,b)=>(score(b)-score(a))||(b.hits-a.hits)||(b.strict-a.strict)||(b.count-a.count));
  ok("割合が低くても、確かめられた本数が多いほうを選ぶ", t[0].count===200, `${t[0].count}件`);
}

console.log("\n[8] 実物のトバル2ディスクで出た症状");
{
  // (a) 末尾に余りがある入れ子ファイル。表の「大きさ」はセクタ境界まで切り上がっていることがあり、
  //     offs[n] === size を要求すると、本物の入れ子が全部「そのまま」に落ちる（中身 0% の原因）
  const padded=new Uint8Array(Math.ceil(file0.length/2048)*2048);
  padded.set(file0);
  ok("末尾に余りがあっても入れ子と見分ける", classify(padded.subarray(0,2048),padded.length).kind==="model",
     JSON.stringify(classify(padded.subarray(0,2048),padded.length)).slice(0,90));
  ok("  実物の先頭4バイト 12 00 00 00 は「18部分の入れ子」と読める",
     (()=>{ const b2=new Uint8Array(2048); const d=new DataView(b2.buffer);
            d.setUint32(0,18,true); const head=4+4*19;
            for(let i=0;i<=18;i++) d.setUint32(4+i*4,head+i*16,true);
            b2[head]=0x0b;
            return classify(b2,17404).kind==="model" })(), "");

  // (b) 表の中でセクタの順番が飛ぶと、1362件が細切れになっていた
  const rows=[]; let sec=0;
  for(let i=0;i<1362;i++){
    const size=1000+(i%37)*211;
    rows.push([sec,size]);
    sec+=Math.ceil(size/2048);
    if(i%50===49) sec+=0;              // 詰まっている区間
    if(i%97===96) sec=Math.max(0,sec-40);  // ときどき前に戻る（順番が飛ぶ）
  }
  const arcLen2=(Math.max(...rows.map(([s0,sz])=>s0+Math.ceil(sz/2048)))+1)*2048;
  const buf2=new Uint8Array(0x800+0x100000), dv2=new DataView(buf2.buffer);
  buf2.set(new TextEncoder().encode("PS-X EXE"),0);
  dv2.setUint32(0x18,0x80010000,true); dv2.setUint32(0x1c,0x100000,true);
  const base2=0x800+(0x800CD660-0x80010000);
  rows.forEach(([s0,sz],i)=>{ dv2.setUint32(base2+i*8,s0,true); dv2.setUint32(base2+i*8+4,(sz<<8)|0,true) });
  const t2=findFileTables(buf2,arcLen2)[0];
  const addr2=0x80010000+(t2.off-0x800);
  ok("セクタの順番が飛んでも表が割れない（0x800CD660 / 1362件）", addr2===0x800CD660&&t2.count===1362,
     `0x${addr2.toString(16)} / ${t2.count}件`);
}

console.log("\n[9] 実物のトバルNo.1 のディスクでアーカイブを選べるか");
{
  // 実際のディスクの中身。BGM/*.DA が ALLBIN.BIN より大きいものが6本あり、
  // 大きさ順だと候補の上位が全部 BGM で埋まって ALLBIN.BIN に届かなかった
  const MB=1048576;
  const files=[
    ["ALLBIN.BIN",24.22],["OPENING.STR",19.88],["SLPS_004.00",0.74],["SYSTEM.CNF",0.00006],["UDAEND.STR",8.86],
    ["BGM/BIGBOSS.DA",21.55],["BGM/CITY.DA",26.73],["BGM/CLOWD.DA",28.58],["BGM/CONTINU.DA",2.10],
    ["BGM/ENDING.DA",35.61],["BGM/GAMEOVER.DA",0.73],["BGM/HAIKOU.DA",27.44],["BGM/ICE.DA",26.84],
    ["BGM/MAGUMA.DA",28.22],["BGM/MIYA.DA",24.75],["BGM/NAME.DA",14.58],["BGM/RAIN.DA",23.50],
    ["BGM/RIVER.DA",26.20],["BGM/ROOM.DA",26.39],["BGM/SABAKU.DA",27.20],["BGM/SELECT.DA",12.50],
    ["BGM/STAFF.DA",28.28],["BGM/STAGECLR.DA",0.93],["BGM/TAKARA.DA",1.16],
  ].map(([path,mb])=>({path,name:path.split("/").pop(),size:Math.round(mb*MB)}));
  const exe=files.find(f=>f.name==="SLPS_004.00");

  ok("BGM の .DA は音声として除く", files.filter(f=>isStream(f.name)).length===19+2, files.filter(f=>isStream(f.name)).length);
  const cands=files.filter(f=>f!==exe&&!isStream(f.name)&&f.size>=0x10000).sort((a,b)=>archiveRank(b)-archiveRank(a));
  ok("アーカイブの1番手が ALLBIN.BIN", cands[0]&&cands[0].path==="ALLBIN.BIN", cands[0]?cands[0].path:"なし");
  ok("  大きさ順だけなら BGM/ENDING.DA が1番手だった（改修前の症状）",
     [...files].filter(f=>f!==exe).sort((a,b)=>b.size-a.size)[0].path==="BGM/ENDING.DA", "");
}
{
  // 大きさ数バイトの並びは表ではない（実物で sector 11 / 大きさ 10 のような候補が上位に来ていた）
  const buf=new Uint8Array(0x800+0x4000), dv=new DataView(buf.buffer);
  buf.set(new TextEncoder().encode("PS-X EXE"),0);
  dv.setUint32(0x18,0x80010000,true); dv.setUint32(0x1c,0x4000,true);
  const base=0x800+0x100;
  for(let i=0;i<200;i++){ dv.setUint32(base+i*8,(i%50)+1,true); dv.setUint32(base+i*8+4,(i%20)+2,true) }
  ok("大きさ数バイトばかりの並びは候補にしない", findFileTables(buf,4*1048576).length===0, findFileTables(buf,4*1048576).length);
}

console.log("\n[9b] 三角形が取れなくても、手がかりは残す");
{
  // 入れ子で部分0は圧縮だが、描画命令が無いファイル（実物で 圧縮/入れ子 は多数見つかる）
  const empty=new Uint8Array(0x200);              // 中身 0 の「ブロック」
  const enc=(()=>{ const bits=[]; let pos=0; const w=(v,n)=>{for(let k=0;k<n;k++){const byte=pos>>3;while(bits.length<=byte)bits.push(0);if((v>>k)&1)bits[byte]|=1<<(pos&7);pos++}};
    w(0x0b,8); w(empty.length&0xffff,16); w(empty.length>>16,8);
    let rem=empty.length, off=0;
    while(rem>0){ const ch=Math.min(rem,256); rem-=ch; w(0,4); for(let i=0;i<(ch+3>>2);i++) w(0,32); off+=ch }
    return new Uint8Array(bits) })();
  const n=2, head=4+4*(n+1), offs=[head,head+enc.length,head+enc.length+8];
  const cont=new Uint8Array(offs[2]); const dv=new DataView(cont.buffer);
  dv.setUint32(0,n,true); offs.forEach((o,i)=>dv.setUint32(4+i*4,o,true));
  cont.set(enc,head);
  const r=buildModel(cont);
  ok("三角形0でも例外にせず、理由を返す", r.info.error&&r.info.tris===0, JSON.stringify(r.info.error));
  ok("  ブロックの頭と生の描画命令を控えている", r.info.words.length===16&&r.info.dlRaw.length>0,
     `words=${r.info.words.length} dl=${r.info.dlRaw.length}`);
}

console.log("\n[9c] トバル2 と並びが違うモデルでも、自分で合わせて組めるか");
{
  const v2=new Uint8Array(fs.readFileSync("fixture_model_v2.bin"));
  const keep=state.rig; state.rig="flat";
  // まずトバル2 の並びのまま（ヘッダの語5/4/7 ＋16）では取れないことを確かめる
  const out=decompress(unpack(v2)[0]);
  const blk=new Uint8Array(out.length+8); blk.set(out,8); new DataView(blk.buffer).setUint32(0,out.length+8,true);
  ok("トバル2 の並びのままでは形にならない（1点に潰れる）", meshExtent(buildMesh(blk,FLAT_W))<8,
     meshExtent(buildMesh(blk,FLAT_W)));
  const lay=fitLayout(blk);
  ok("並びを割り出せる", !!lay, lay?lay.how:"null");
  if(lay){
    ok("  描画命令の位置を当てる（0x18）", lay.dl===0x18, hex(lay.dl,4));
    ok("  頂点の位置を語2から当てる", lay.vp===0x100, hex(lay.vp,4));
    ok("  面の位置を語3から当てる", lay.fp===0x180, hex(lay.fp,4));
  }
  const r=buildModel(v2);
  ok("buildModel が自動で合わせて三角形を出す", r.info.tris===2&&/合わせた並び/.test(r.info.layout),
     `${r.info.tris}枚 / ${r.info.layout}`);
  // トバル2 の並びのファイルは、これまでどおり合わせずに組める
  const r0=buildModel(file0);
  ok("  トバル2 の並びのファイルは今までどおり", r0.info.tris===2&&r0.info.layout==="トバル2 と同じ並び", r0.info.layout);
  state.rig=keep;
}

console.log("\n[9d] 実物のトバルNo.1 のヘッダ形（0x90000000 ＋ 位置表）でも合わせられるか");
{
  const t1=new Uint8Array(fs.readFileSync("fixture_model_t1.bin"));
  const keep=state.rig; state.rig="flat";
  const out=decompress(unpack(t1)[0]);
  const blk=new Uint8Array(out.length+8); blk.set(out,8); new DataView(blk.buffer).setUint32(0,out.length+8,true);
  ok("トバル2 の並びでは形にならない", meshExtent(buildMesh(blk,FLAT_W))<8, meshExtent(buildMesh(blk,FLAT_W)));
  const lay=fitLayout(blk);
  ok("ヘッダが指す先から描画命令を見つける", lay&&lay.dl===0x140, lay?hex(lay.dl,4):"null");
  ok("  頂点の置き場所も当てる", lay&&lay.vp===0x300, lay?hex(lay.vp,4):"null");
  ok("  面の置き場所も当てる", lay&&lay.fp===0x400, lay?hex(lay.fp,4):"null");
  const r=buildModel(t1);
  ok("三角形が3枚出て、形が広がる", r.info.tris===3&&r.info.extent>100, `${r.info.tris}枚 広がり ${r.info.extent}`);
  state.rig=keep;
}

console.log("\n[9f] モデル本体が部分0 とは限らない（実物 #108 の形）");
{
  // 実物: 部分 3 [8, 8, 85440]。部分0 は 8 バイト（展開して 4 バイト）で、本体は部分2
  const lz=unpack(file0)[0];                       // トバル2 と同じ並びのモデル（圧縮済み）
  const tiny=new Uint8Array([1,2,3,4,5,6,7,8]);
  const ps=[tiny,tiny,lz], n=ps.length, head=4+4*(n+1);
  let total=head; const offs=[head];
  for(const p of ps){ total+=p.length; offs.push(total) }
  const cont=new Uint8Array(total), cd=new DataView(cont.buffer);
  cd.setUint32(0,n,true); offs.forEach((o,i)=>cd.setUint32(4+i*4,o,true));
  ps.forEach((p,i)=>cont.set(p,offs[i]));

  let r=null,threw=null;
  try{ r=buildModel(cont) }catch(err){ threw=err.message }
  ok("小さすぎる部分0 で落ちない", !threw, threw);
  ok("  本体が部分2 だと見抜く", r&&r.info.bodyPart===2, r?`部分${r.info.bodyPart}`:"");
  ok("  三角形が取れる", r&&r.info.tris===2, r?r.info.tris:"");
  ok("  試した部分が記録に残る", r&&/部分2/.test(r.info.tried||""), r?r.info.tried:"");
}

console.log("\n[9e] 解析のダンプ作りで落ちないか（実物で踏んだ）");
{
  // ヘッダの語が「ブロックの終わり際」を指していると、区画の中身を覗くときに範囲外を読んでいた
  const bodyLen=256, bodyBuf=new Uint8Array(bodyLen), bd=new DataView(bodyBuf.buffer);
  bd.setUint32(0,bodyLen-2,true);          // 終わり際を指す
  bd.setUint32(4,bodyLen-1,true);
  bd.setUint32(8,16,true);
  const n=1, head=4+4*(n+1), cont=new Uint8Array(head+bodyLen), cd=new DataView(cont.buffer);
  cd.setUint32(0,n,true); cd.setUint32(4,head,true); cd.setUint32(8,head+bodyLen,true);
  cont.set(bodyBuf,head);
  let r=null,threw=null;
  try{ r=buildModel(cont) }catch(err){ threw=err.message }
  ok("終わり際を指すヘッダでも落ちない", !threw, threw);
  ok("  ダンプ作りも失敗しない", r&&!r.info.dumpError, r?r.info.dumpError:"");
  ok("  組めなかった理由はちゃんと返る", r&&!!r.info.error, r?r.info.error:"");
}

console.log("\n[9g] トバルNo.1 のテクスチャ（実物のバイト列そのまま）");
{
  // 実物 sector 6408 の本体（部分2、展開後 189,680B）の先頭。解析ダンプから起こしたもの
  const head=[
    0x2c,0,0,0, 0x10,0,0,0, 0x08,0,0,0, 0x2c,0,0,0,
    0xa0,0x01,0xe6,0x01, 0x10,0x00,0x01,0x00,
    0x19,0x80,0x65,0x84,0xea,0x88,0x4c,0x99,
    0x6f,0x99,0x8e,0xa1,0xb1,0xa1,0xd1,0xa5,
    0xd2,0xa5,0xd3,0xa5,0xf3,0xa5,0xf4,0xa9,
    0x15,0xae,0x76,0xba,0x00,0x00,0x00,0x00,
    0x6c,0x10,0x00,0x00, 0x70,0x02,0x00,0x00, 0x10,0x00,0x83,0x00,
  ];
  // 2枚目は 16×131 なので、続きを 0xee で埋めて長さを合わせる
  const d=new Uint8Array(0x38+0x106c+64); d.set(head); d.fill(0xee,head.length,0x38+0x106c);
  const list=vramChainT1(d,0);
  ok("転送の列を2枚読める", list.length===2, JSON.stringify(list.map(t=>`(${t.x},${t.y}) ${t.w}x${t.h}`)));
  if(list.length>=2){
    ok("  1枚目は 16色パレット (416,486) 16x1", list[0].x===416&&list[0].y===486&&list[0].w===16&&list[0].h===1,
       `(${list[0].x},${list[0].y}) ${list[0].w}x${list[0].h}`);
    ok("  2枚目は画像 (624,0) 16x131", list[1].x===624&&list[1].y===0&&list[1].w===16&&list[1].h===131,
       `(${list[1].x},${list[1].y}) ${list[1].w}x${list[1].h}`);
    ok("  長さ = 12 + 幅×高さ×2 が両方で成り立つ", 0x2c===12+16*1*2&&0x106c===12+16*131*2, "");
  }
  ok("  途中の 0x10, 0x08 の目印を読み飛ばせている", list.length===2, "");
  // でたらめなデータでは列にならない
  const junk=new Uint8Array(4096); for(let i=0;i<junk.length;i++) junk[i]=(i*97)&255;
  ok("  でたらめなデータは転送の列と見なさない", !findVramChainT1(junk), findVramChainT1(junk)?"見なした":"");
}

console.log("\n[9h] テクスチャファイルの署名（実物24件で確かめた法則）");
{
  const mk=bytes=>{ const d=new Uint8Array(64); d.set(bytes); return d };
  // #118 の頭: 語0=8組, 語1=0x10, 語2=8, 語3=0x2C(16色)
  const a16=mk([0x08,0,0,0, 0x10,0,0,0, 0x08,0,0,0, 0x2c,0,0,0]);
  // #181 の頭: 語0=20組, 語2=9, 語3=0x20C(256色)
  const a256=mk([0x14,0,0,0, 0x10,0,0,0, 0x09,0,0,0, 0x0c,0x02,0,0]);
  const i1=textureInfoT1(a16), i2=textureInfoT1(a256);
  ok("16色のテクスチャを見分ける", i1&&i1.pairs===8&&i1.colors===16, JSON.stringify(i1));
  ok("256色のテクスチャを見分ける", i2&&i2.pairs===20&&i2.colors===256, JSON.stringify(i2));
  ok("  パレットの長さの計算が合う（0x2C=12+16×2 / 0x20C=12+256×2）",
     0x2c===12+16*2&&0x20c===12+256*2, "");
  ok("  実物の「語0 と 転送枚数」の関係が 2倍で合う",
     [[8,16],[20,40],[25,50],[19,38],[41,82],[35,70],[22,44],[16,32],[15,30],[14,28],[18,36],[31,62],[3,6]]
       .every(([w0,n])=>w0*2===n), "");
  // モデルらしいヘッダ（語1 が 0x10 でない）は弾く
  ok("  テクスチャでないものは弾く", !textureInfoT1(mk([0x00,0,0,0x90, 0x14,0,0,0, 0,0,0,0, 0,0,0,0])), "");
  ok("  でたらめも弾く", !textureInfoT1(mk([1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16])), "");
}

console.log("\n[9i] モデルの署名 0x90000000（実物のふるい分けで見つけた形）");
{
  const mk=(bytes,len)=>{ const d=new Uint8Array(len||40000); d.set(bytes); return d };
  // 実物 #45 (sector 5737, 展開後 38536B) の頭
  const b45=mk([0x00,0x00,0x00,0x90, 0x3c,0,0,0, 0x04,0,0,0,
                0xd0,0x67,0,0, 0xf0,0x6b,0,0, 0x10,0x70,0,0, 0x30,0x74,0,0, 0x04,0,0,0], 38536);
  // 実物 #101 (sector 6247, 展開後 4412B) の頭
  const b101=mk([0x00,0x00,0x00,0x90, 0x14,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0,
                 0x88,0x0b,0,0, 0x48,0,0,0, 0xe8,0x05,0,0], 4412);
  const m1=modelInfoT1(b45), m2=modelInfoT1(b101);
  ok("キャラクターのモデル（種類B）を見分ける", m1&&m1.tableAt===0x3c&&/B/.test(m1.kind), JSON.stringify(m1&&m1.kind));
  ok("  ヘッダの位置を拾える（0x67D0 など）",
     m1&&m1.offs.some(o=>o.v===0x67d0)&&m1.offs.some(o=>o.v===0x7430),
     m1?m1.offs.map(o=>hex(o.v)).join(" "):"");
  ok("部分が多いほう（種類A）も見分ける", m2&&m2.tableAt===0x14&&/A/.test(m2.kind), JSON.stringify(m2&&m2.kind));
  ok("  テクスチャは署名にならない", !modelInfoT1(mk([0x08,0,0,0, 0x10,0,0,0, 0x08,0,0,0, 0x2c,0,0,0],64)), "");
  ok("  でたらめも弾く", !modelInfoT1(mk([1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16],64)), "");
  // テクスチャの署名と食い違わないこと
  ok("  モデルとテクスチャの署名は排他", !textureInfoT1(b45)&&!modelInfoT1(mk([0x14,0,0,0,0x10,0,0,0,0x09,0,0,0,0x0c,0x02,0,0],64)), "");
}

console.log("\n[9j] 音声 VAGp と、署名どうしが食い違わないこと");
{
  const vag=new Uint8Array(64); vag.set([0x56,0x41,0x47,0x70, 0,0,0,3]);   // "VAGp"
  ok("VAGp は 0x70474156 として読める", new DataView(vag.buffer).getUint32(0,true)===0x70474156, "");
  ok("  VAGp はテクスチャの署名にならない", !textureInfoT1(vag), "");
  ok("  VAGp はモデルの署名にならない", !modelInfoT1(vag), "");
}

console.log("\n[9b] 骨さがし（32バイトの行列を見分ける）");
{
  // 本物と同じ作りで作る: int16 m[9]（1.0＝4096）＋詰め物2B＋int32 t[3] ＝ 32バイト
  const N=29, buf=new Uint8Array(N*32), bv=new DataView(buf.buffer);
  for(let k=0;k<N;k++){
    const a=k*0.21, c=Math.round(Math.cos(a)*4096), s2=Math.round(Math.sin(a)*4096);
    const m=[c,-s2,0, s2,c,0, 0,0,4096];
    m.forEach((v,j)=>bv.setInt16(k*32+j*2,v,true));
    [10*k,-20*k,30*k].forEach((v,j)=>bv.setInt32(k*32+20+j*4,v,true));
  }
  const b=boneScan(buf);
  ok("29個ぶんの行列として読める", !!b&&b.n===29, b?`${b.n}個`:"null");
  ok("  全部が回転として筋が通る", !!b&&b.good===29, b?`${b.good}/${b.n}`:"null");
  ok("  移動量も読める", !!b&&b.list[2].t.join(",")==="20,-40,60", b?b.list[2].t.join(","):"null");
  // でたらめなバイト列は拾わない
  const junk=new Uint8Array(N*32);
  for(let i=0;i<junk.length;i++) junk[i]=(i*97+13)&0xff;
  const j=boneScan(junk);
  ok("  でたらめな並びは回転と認めない", !!j&&j.good===0, j?`${j.good}/${j.n}`:"null");
  ok("  32で割り切れない大きさは見ない", boneScan(new Uint8Array(100))===null, "");
  ok("  結果を字にできる", boneLines([{e:{no:97,sector:6016},pi:7,len:928,b}]).length>=3, "");
  ok("  どの持ち方かを選べる（32バイトを当てる）", (()=>{
       const x=boneScanBest(buf); return !!x&&x.form.size===32&&x.good===29 })(),
     (()=>{ const x=boneScanBest(buf); return x?`${x.form.size}B ${x.good}/${x.n}`:"null" })());
  // 移動量が int16 の持ち方（24バイト）も見分けられる
  { const M=24, b2=new Uint8Array(N*M), v2=new DataView(b2.buffer);
    for(let k=0;k<N;k++){
      const a=k*0.17, c=Math.round(Math.cos(a)*4096), s3=Math.round(Math.sin(a)*4096);
      [4096,0,0, 0,c,-s3, 0,s3,c].forEach((v,j)=>v2.setInt16(k*M+j*2,v,true));
      [3*k,-4*k,5*k].forEach((v,j)=>v2.setInt16(k*M+18+j*2,v,true));
    }
    const x=boneScanBest(b2);
    ok("  24バイトの持ち方も見分ける", !!x&&x.form.size===24&&x.good===N,
       x?`${x.form.size}B ${x.good}/${x.n}`:"null"); }
  // 目盛りが 4096 でなくても（1.0＝16384 でも）回転として見分けられる
  { const M=32, b3=new Uint8Array(N*M), v3=new DataView(b3.buffer), ONE=16384;
    for(let k=0;k<N;k++){
      const a=k*0.3, c=Math.round(Math.cos(a)*ONE), s4=Math.round(Math.sin(a)*ONE);
      [c,0,-s4, 0,ONE,0, s4,0,c].forEach((v,j)=>v3.setInt16(k*M+j*2,v,true));
    }
    const y=boneScanBest(b3);
    ok("  目盛りが 4096 でなくても見分ける", !!y&&y.good===N&&y.list[1].one===ONE,
       y?`${y.good}/${y.n} 1.0=${y.list[1].one}`:"null"); }
}

console.log("\n[9t] テクスチャを絵にする");
{
  // 実物と同じ形で作る: u32 長さ / u16 x,y,w,h / データ。長さ = 12 + w*h*2
  const put=(a,o,vals)=>vals.forEach(([sz,v])=>{ if(sz===4){a.setUint32(o,v,true);o+=4} else {a.setUint16(o,v,true);o+=2} });
  const PAL=16, IW=4, IH=2;                       // 16色・転送幅4語 → 絵の幅は16画素
  const palLen=12+PAL*1*2, imgLen=12+IW*IH*2;
  const d=new Uint8Array(16+palLen+imgLen), dv=new DataView(d.buffer);
  // 署名（語0=組数, 語1=0x10, 語2=8, 語3=最初のパレットの長さ）
  [1,0x10,8,palLen].forEach((v,i)=>dv.setUint32(i*4,v,true));
  let o=16;
  put(dv,o,[[4,palLen],[2,416],[2,486],[2,PAL],[2,1]]);
  // パレット: 0番は透明、1番は赤、2番は緑、3番は青
  const bgr=(r,g,b)=>(b<<10)|(g<<5)|r;
  [0,bgr(31,0,0),bgr(0,31,0),bgr(0,0,31)].forEach((v,i)=>dv.setUint16(o+12+i*2,v,true));
  o+=palLen;
  put(dv,o,[[4,imgLen],[2,320],[2,0],[2,IW],[2,IH]]);
  // 16bit の語に4画素ぶんの番号を詰める（0,1,2,3 の繰り返し）
  for(let k=0;k<IW*IH;k++) dv.setUint16(o+12+k*2,(3<<12)|(2<<8)|(1<<4)|0,true);

  const P=t1TexPairs(d);
  ok("パレットと画像の組にできる", !!P&&P.pairs.length===1&&P.pairs[0].colors===16,
     P?`${P.pairs.length}組`:"null");
  const img=P&&t1TexRGBA(d,P.pairs[0]);
  ok("  16色は1語に4画素なので、幅は転送幅の4倍", !!img&&img.w===IW*4&&img.h===IH,
     img?`${img.w}x${img.h}`:"null");
  ok("  0番の色は透ける", !!img&&img.data[3]===0, img?String(img.data[3]):"null");
  ok("  1番は赤、2番は緑、3番は青", !!img&&img.data[4]===255&&img.data[5]===0
     &&img.data[9]===255&&img.data[14]===255,
     img?[...img.data.slice(4,16)].join(","):"null");

  // BGR555 の読み方そのもの
  ok("  BGR555 を色に直せる", t1Color(bgr(31,0,0)).join(",")==="255,0,0,255", t1Color(bgr(31,0,0)).join(","));

  // 面のバイトに UV の余りがあるかを判定する
  ok("  余りが無ければ「貼り先なし」と言う",
     t1HasUV({used:[[8,193],[9,210],[10,93],[11,170]]}).uv===false, "");
  ok("    そのとき合計は 12736 バイト",
     t1HasUV({used:[[8,193],[9,210],[10,93],[11,170]]}).total===12736,
     String(t1HasUV({used:[[8,193],[9,210],[10,93],[11,170]]}).total));
}

console.log("\n[9m] メモリの写しから骨の表を読む");
{
  // セーブステートを模したもの: 頭に見出しが付いていて、そのあとに RAM 2MB がそのまま入る
  const HEAD=0x1234, RAM=0x200000;
  const sav=new Uint8Array(HEAD+RAM);
  for(let i=0;i<HEAD;i++) sav[i]=(i*31+7)&0xff;              // 見出しはでたらめ
  const exe2=new Uint8Array(0x800+0x200);
  exe2.set(new TextEncoder().encode("PS-X EXE"),0);
  const ev=new DataView(exe2.buffer);
  ev.setUint32(0x18,0x80010000,true); ev.setUint32(0x1c,0x200,true);
  // 繰り返しのない中身にする（同じ並びが何度も出ると、ずれた場所に当たってしまう）
  { let r=12345; for(let i=0;i<0x200;i++){ r=(r*1103515245+12345)>>>0; exe2[0x800+i]=(r>>>16)&0xff } }
  sav.set(exe2.subarray(0x800,0x800+0x200),HEAD+0x10000);    // RAM の 0x10000 に置く

  const base=findPsxRam(sav,exe2);
  ok("写しの中の RAM の先頭を当てる", base===HEAD, `0x${(base>>>0).toString(16)} / 予想 0x${HEAD.toString(16)}`);

  const M=memReader(sav,base), sv=new DataView(sav.buffer);
  // 表A に 0x80100000 を置き、その先に行列を29個並べる
  const TBL=0x80100000, MAT=0x80120000;
  sv.setUint32(base+(0x800CBE90&0x1fffff),TBL+0x40,true);    // 進んだあとの位置
  for(let k=0;k<32;k++) sv.setUint32(base+((TBL+k*4)&0x1fffff),MAT,true);
  for(let k=0;k<29;k++){
    const a=k*0.2, c=Math.round(Math.cos(a)*4096), s5=Math.round(Math.sin(a)*4096), o=base+((MAT+k*32)&0x1fffff);
    [c,-s5,0, s5,c,0, 0,0,4096].forEach((v,j)=>sv.setInt16(o+j*2,v,true));
  }
  sav[base+(0x800CBE88&0x1fffff)]=1;
  ok("  旗と表のポインタを読める", M.u8(0x800CBE88)===1&&M.u32(0x800CBE90)===(TBL+0x40)>>>0,
     `旗${M.u8(0x800CBE88)} 表0x${M.u32(0x800CBE90).toString(16)}`);
  // 先頭が書き換わっていても、後ろの手がかりで当てられること
  { const sav2=new Uint8Array(HEAD+RAM);
    sav2.set(exe2.subarray(0x800,0x800+0x200),HEAD+0x10000);
    for(let i=0;i<64;i++) sav2[HEAD+0x10000+i]=0;          // 先頭64バイトを潰す
    // 手がかりは1か所しか置けない作りものなので、先頭を潰したら見つからないのが正しい。
    // 「間違った場所を当てて平気な顔をしない」ことを確かめる
    const got=findPsxRam(sav2,exe2);
    ok("  手がかりが消えたら、でたらめな場所を答えない", got===-1||got===HEAD,
       `0x${(got>>>0).toString(16)}`); }
  // 圧縮の印を見分けられること（ほどけない形式を正直に言うため）
  { const z=new Uint8Array(4096); z.set([0x28,0xb5,0x2f,0xfd],100);
    const m=memFindMagic(z);
    ok("  zstd の印を見分ける", m.length>=1&&m[0].name==="zstd"&&m[0].at===100,
       m.length?`${m[0].name}@${m[0].at}`:"なし"); }
  // DuckStation のセーブステートを見分けて、題名まで読めること
  { const d=new Uint8Array(200); d.set([0x44,0x55,0x43,0x43, 0x57,0,0,0]);
    d.set(new TextEncoder().encode("トバルナンバーワン"),8);
}
}

console.log("\n[9r] 番地を使っている場所を実行ファイルから探す");
{
  // lui ＋ lw/sw の2手で 0x800C1234 を読む形を作って、見つけられるかを確かめる
  const body=new Uint8Array(64), bv=new DataView(body.buffer);
  bv.setUint32(0,(0x0f<<26)|(8<<16)|0x800d,true);        // lui $t0, 0x800d
  bv.setUint32(4,(0x23<<26)|(8<<21)|(9<<16)|0xbe90,true); // lw  $t1, -16752($t0)
  bv.setUint32(8,(0x2b<<26)|(8<<21)|(9<<16)|0xbe90,true); // sw  $t1, -16752($t0)
  const exe2=new Uint8Array(0x800+body.length); exe2.set(body,0x800);
  const ev=new DataView(exe2.buffer);
  ev.setUint32(0x18,0x80010000,true); ev.setUint32(0x1c,body.length,true);
  exe2.set(new TextEncoder().encode("PS-X EXE"),0);
  // lui → addiu で番地を作ってから書く形（構造体ごし）も追えること
  ev.setUint32(0x800+12,(0x0f<<26)|(1<<16)|0x800d,true);          // lui $at, 0x800d
  ev.setUint32(0x800+16,(0x09<<26)|(1<<21)|(2<<16)|0xbe8c,true);  // addiu $v0, $at, -16756
  ev.setUint32(0x800+20,(0x2b<<26)|(2<<21)|(9<<16)|0x0004,true);  // sw $t1, 4($v0)
  // 範囲で探すと、構造体の先頭を土台にした別のずれの書き込みも入る
  // 番地を作っているだけ（読み書きしない）の場所も見つかること
  { }
  // $gp 相対の読み書きも拾えること。
  // このゲームは lw $v1, 3444($gp) の形でグローバル変数を触るので、
  // $gp を知らないと「その変数を使っている場所」が1つも見つからない
  { const GP=0x800CD540, target=GP-0x16B4;      // = 0x800CBE8C
    ev.setUint32(0x800+28,(0x23<<26)|(28<<21)|(9<<16)|((-0x16B4)&0xffff),true); // lw $t1, -5812($gp)
    ok("    実行ファイルの +0x14 が起動時の $gp", exeInfo(exe2).gp===0,
       hex(exeInfo(exe2).gp));
    // ヘッダが 0 でも、コードの lui＋addiu から $gp を割り出せること
    { const b=new Uint8Array(0x800+64), bv=new DataView(b.buffer);
      b.set(new TextEncoder().encode("PS-X EXE"),0);
      bv.setUint32(0x18,0x80010000,true); bv.setUint32(0x1c,64,true);
      bv.setUint32(0x800+0,(0x0f<<26)|(28<<16)|0x800d,true);              // lui $gp, 0x800d
      bv.setUint32(0x800+4,(0x09<<26)|(28<<21)|(28<<16)|((-0x2ac0)&0xffff),true); // addiu $gp,$gp,-0x2ac0
} }
  // 命令の処理が呼んでいる関数（jal の飛び先）を拾えること。
  // 面を描く命令は飛び先で1枚の大きさが決まるので、まとめる手がかりになる
  { ev.setUint32(0x800+24,(0x03<<26)|((0x8001B8B8>>>2)&0x03ffffff),true);  // jal 0x8001b8b8
}
}

console.log("\n[9k] トバルNo.1 のモデルの部品（実物 sector 5927 の形そのまま）");
{
  t1Show.up=0;   // 座標をそのまま確かめたいので、向きの付け替えは切っておく
  // 「10,20,11,33」は面の数4種ではなく、命令10（三角20枚）と命令11（四角33枚）だった。
  // 20×12 ＋ 33×16 = 768 バイトで、面の領域とぴったり合う
  const NV=51, NT=20, NQ=33, NTRI=NT+NQ*2;
  const VERT=0x38, NORM=VERT+NV*8, FACE=NORM+NV*8, FB=NT*12+NQ*16, COL=FACE+FB, END=COL+NV*4;
  ok("実物の位置が計算どおりに並ぶ", VERT===0x38&&NORM===0x1d0&&FACE===0x368&&FB===768&&COL===0x668&&END===0x734,
     `頂${hex(VERT,4)} 法${hex(NORM,4)} 面${hex(FACE,4)} 面バイト${FB} 色${hex(COL,4)} 末尾${hex(END,4)}`);
  ok("  命令10が三角20枚・命令11が四角33枚で 768 バイトちょうど", NT*12+NQ*16===768, `${NT*12+NQ*16}`);

  const d=new Uint8Array(END), dv=new DataView(d.buffer);
  const put=(o,vals)=>vals.forEach((v,i)=>dv.setUint32(o+i*4,v,true));
  put(0,[FACE,VERT,NORM,COL, 5,2,0, NV,NV, 10,20,11,33, 0]);
  for(let i=0;i<NV;i++){ const o=VERT+i*8;
    dv.setInt16(o,(i%7)*40-120,true); dv.setInt16(o+2,((i/7)|0)*35-100,true); dv.setInt16(o+4,(i%5)*30-60,true) }
  for(let i=0;i<NV;i++){ const o=COL+i*4; d[o]=200-i; d[o+1]=150; d[o+2]=100+i }
  for(let k=0;k<NT;k++) put(FACE+k*12,[((k*3)%NV)*4, ((k*3+1)%NV)*4, ((k*3+2)%NV)*4]);
  for(let k=0;k<NQ;k++) put(FACE+NT*12+k*16,[((k*2)%NV)*4,((k*2+1)%NV)*4,((k*2+2)%NV)*4,((k*2+3)%NV)*4]);

  const o=readT1Object(d,0);
  ok("部品として筋が通ると判定する", o&&o.ok&&o.nv===NV&&o.faceBytes===768,
     o?`頂${o.nv} 面${o.faceBytes}B ok=${o.ok}`:"null");
  const r=buildT1Mesh(d,[o]);
  ok("  三角20枚＋四角33枚 → 86枚の三角形が出る", r.tris===NTRI, `${r.tris} / 予想 ${NTRI}`);
  ok("  命令の列として実行できる（頂点51個・面53枚）", (()=>{
       const R=t1Run(d,0);
       return R&&R.verts===NV&&R.faces.length===NT+NQ&&R.faceBytes===768 })(),
     JSON.stringify(t1Run(d,0)&&{v:t1Run(d,0).verts,f:t1Run(d,0).faces.length,b:t1Run(d,0).faceBytes}));
  ok("  頂点をひととおり使う（同じ点に固まらない）", (()=>{
       const seen=new Set(); const P=r.mesh.pos;
       for(let i=0;i<P.length;i+=3) seen.add(P[i]+","+P[i+1]+","+P[i+2]);
       return seen.size>=NV-2 })(), "");
  ok("  立体になっている", meshExtent(r.mesh)>100, meshExtent(r.mesh));

  // 読めないときは理由が残ること（原因を追えるように）
  { const e=new Uint8Array(END), ev=new DataView(e.buffer); e.set(d);
    ev.setUint32(0x10,99,true);                    // 表に無い命令を置く
    const r99=t1Run(e,0);
    ok("  知らない命令に当たったら、そう言う", r99===null&&/知らない命令 99/.test(API.t1RunWhy||""),
       API.t1RunWhy||"(理由なし)"); }
  { const e=new Uint8Array(END), ev=new DataView(e.buffer); e.set(d);
    ev.setUint32(FACE,0x400,true);                 // 枠の外の置き場所を指す面にする
    t1Run(e,0);
    ok("  おかしな置き場所を指したら、そう言う", /置き場所/.test(API.t1RunWhy||""),
       API.t1RunWhy||"(理由なし)"); }

  // まだ意味の分かっていない命令の中身を、そのまま読み出せること。
  // 骨のずらし量がファイルの中にあるかどうかは、これで見る
  { const e=new Uint8Array(END), ev=new DataView(e.buffer); e.set(d);
    // 命令4（16バイト＝3語）に、座標らしい値を置く
    const put4=(o,vals)=>vals.forEach((v,i)=>ev.setUint32(o+i*4,v>>>0,true));
    put4(0x10,[4, -120, 340, -55,  5, 2,0, NV,NV, 10,20, 11,33, 0]);
    const A=t1OpArgs(e,0);
    const four=A.find(x=>x.op===4);
    ok("  意味の分かっていない命令の中身を、そのまま集められる", !!four&&four.n===1,
       four?`命令4 を ${four.n}回`:"命令4 が拾えていない");
    ok("    3語を符号つきで読む", !!four&&four.slots.length===3
       &&four.slots[0].vals[0]===-120&&four.slots[1].vals[0]===340&&four.slots[2].vals[0]===-55,
       four?four.slots.map(x=>x.vals[0]).join(","):"-");
    const lines=t1OpArgLines(A);
    ok("    3語とも小さい符号つきでも、意味が分かっている命令には ★ を付けない",
       !lines.some(x=>/★/.test(x)), lines.filter(x=>/★/.test(x)).join(" | ")||"(★なし)");
    // 骨のずらし量なら必ず負の値が出る。個数や番号は 0 以上にしかならない。
    // v3.69.0 はここを見ておらず、命令2（置き場所と個数）を座標だと言ってしまった
    { const mk=(vals)=>[{op:99,n:vals[0].length,seg:[0],slots:vals.map(v=>({
        kind:new Map(),mn:Math.min(...v),mx:Math.max(...v),vals:v}))}];
      ok("    負の値を含む3語なら ★ を付ける",
         API.t1OpArgLines(mk([[-120,40],[340,-8],[-55,9]])).some(x=>/★/.test(x)), "");
      ok("    0以上ばかりの3語には ★ を付けない（個数は負にならない）",
         !API.t1OpArgLines(mk([[0,6],[12,50],[12,48]])).some(x=>/★/.test(x)), "");
      ok("    ＋と−が交互に出る1語は、骨をたどる向きかもしれないと言う",
         API.t1OpArgLines([{op:6,n:6,seg:[3],slots:[{kind:new Map(),mn:-4,mx:4,
           vals:[4,-4,4,-4,4,-4]}]}]).some(x=>/交互/.test(x)), "");
    }
    ok("    ポインタは座標と区別する",
       API.t1OpArgLines([{op:4,n:1,seg:[0],slots:[{kind:new Map([["ポインタ",1]]),mn:0,mx:0,vals:[0]},
         {kind:new Map(),mn:0,mx:0,vals:[]},{kind:new Map(),mn:0,mx:0,vals:[]}]}])
         .some(x=>/ポインタ/.test(x)), "");
  }

  // 知らない命令の「1枚のバイト数」を、引き算で割り出せること
  { // 命令12 を 三角＋法線（20B）として作った部品
    const NV2=12, N12=5, FB=N12*20;
    const V=0x38, N=V+NV2*8, F=N+NV2*8, C=F+FB, E2=C+NV2*4;
    const e=new Uint8Array(E2), ev=new DataView(e.buffer);
    const put=(o,vals)=>vals.forEach((v,i)=>ev.setUint32(o+i*4,v,true));
    put(0,[F,V,N,C, 5, 1,0,NV2, 12,N12, 0]);
    for(let i=0;i<NV2;i++){ const o=V+i*8;
      ev.setInt16(o,(i%4)*30-45,true); ev.setInt16(o+2,((i/4)|0)*30-30,true); ev.setInt16(o+4,(i%3)*20-20,true) }
    for(let k=0;k<N12;k++){ const o=F+k*20;
      put(o,[((k*2)%NV2)*4,((k*2+1)%NV2)*4,((k*2+2)%NV2)*4]);
      ev.setInt16(o+12,0,true); ev.setInt16(o+14,4096,true); ev.setInt16(o+16,0,true) }

    const sc=t1ScanOps(e,0);
    ok("  知らない命令でも、枚数と面の大きさは数えられる",
       !!sc&&sc.counts.get(12)===N12&&sc.faceBytes===FB,
       sc?`枚数${sc.counts.get(12)} 面${sc.faceBytes}B`:"null");
    const sol=t1SolveSize(sc);
    ok("    引き算で 1枚 20バイトと出る", !!sol&&sol.op===12&&sol.size===20,
       sol?`命令${sol.op} は ${sol.size}B`:"null");
    ok("    20バイトの並べ方は「頂点3個＋法線」", t1Layouts(20).some(k=>k.n===3&&k.nrm),
       JSON.stringify(t1Layouts(20)));
    const r=t1RunExtra(e,0);
    ok("    その読み方で面が5枚出る", !!r&&r.faces.length===N12&&r.solved.op===12,
       r?`面${r.faces.length}枚 命令${r.solved.op}=${r.solved.size}B`:"null");
  }

  // 命令14・15 はもう解けている（v4.48.0）。ここは「知らない命令を引き算で覚える」仕組みの試験なので、
  // 試験のあいだだけ知らない命令に戻す
  const KEEP1415=[T1_FACE_OP[14],T1_FACE_OP[15]]; delete T1_FACE_OP[14]; delete T1_FACE_OP[15];
  // 1つ解けると次が解ける（雪だるま式）ことを確かめる。
  // 部品A: 命令14 だけ → 引き算で解ける
  // 部品B: 命令14 と 命令15 → A で 14 を覚えていれば、15 も引き算で解ける
  // （命令12・13 は実物のバイト列から形が確定したので、ここでは使えない）
  { for(const k of Object.keys(T1_LEARNED)) delete T1_LEARNED[k];
    const mk=(ops,sizes)=>{           // ops=[[命令,枚数]...] sizes={命令:1枚のバイト数}
      const NV3=16;
      let fb=0; for(const [op,n] of ops) fb+=sizes[op]*n;
      const V=0x38, N=V+NV3*8, F=N+NV3*8, C=F+fb, E3=C+NV3*4;
      const b=new Uint8Array(E3), bv=new DataView(b.buffer);
      const put=(o,vals)=>vals.forEach((v,i)=>bv.setUint32(o+i*4,v,true));
      const cmd=[5,1,0,NV3]; for(const [op,n] of ops) cmd.push(op,n); cmd.push(0);
      put(0,[F,V,N,C,...cmd]);
      for(let i=0;i<NV3;i++){ const o=V+i*8;
        bv.setInt16(o,(i%4)*30-45,true); bv.setInt16(o+2,((i/4)|0)*30-45,true); bv.setInt16(o+4,(i%3)*20-20,true) }
      let p2=F;
      for(const [op,n] of ops) for(let k=0;k<n;k++){
        const nv=sizes[op]===16?4:3;
        for(let j=0;j<nv;j++) bv.setUint32(p2+j*4,((k*2+j)%NV3)*4,true);
        p2+=sizes[op];
      }
      return b;
    };
    const A=mk([[14,6]],{14:24});                 // 14 だけ
    const B=mk([[14,4],[15,5]],{14:24,15:16});    // 14 と 15
    ok("  まず 命令14 を引き算で覚える", !!t1RunExtra(A,0)&&T1_LEARNED[14]&&T1_LEARNED[14].size===24,
       T1_LEARNED[14]?`命令14=${T1_LEARNED[14].size}B`:"覚えていない");
    const rb=t1RunExtra(B,0);
    ok("    覚えたおかげで 命令15 も解ける", !!rb&&T1_LEARNED[15]&&T1_LEARNED[15].size===16,
       T1_LEARNED[15]?`命令15=${T1_LEARNED[15].size}B`:"解けない");
    // 覚えていなければ解けないこと（雪だるま式が効いている証拠）
    for(const k of Object.keys(T1_LEARNED)) delete T1_LEARNED[k];
    ok("    覚えていなければ、未知が2つなので解けない", t1RunExtra(B,0)===null, "");
  }

  // 「頂点を入れる命令」を見落としているときに、読み方を見つけて覚えること。
  // 命令7 でも頂点が入る部品を作る。既定の読み方だと「まだ入れていない置き場所」で止まり、
  // 命令7 も入れる命令とみなすと、頂点の数も面のバイト数もぴったり合う
  { const NV4=16, NT4=6, FB4=NT4*12;
    const V=0x38, N=V+NV4*8, F=N+NV4*8, C=F+FB4, E4=C+NV4*4;
    const e=new Uint8Array(E4), ev=new DataView(e.buffer);
    const put=(o,vals)=>vals.forEach((v,i)=>ev.setUint32(o+i*4,v,true));
    //  命令1 で前半8個、命令7 で後半8個を入れる
    put(0,[F,V,N,C, 1,0,8, 7,8,8, 10,NT4, 0]);
    for(let i=0;i<NV4;i++){ const o=V+i*8;
      ev.setInt16(o,(i%4)*30-45,true); ev.setInt16(o+2,((i/4)|0)*30-45,true); ev.setInt16(o+4,(i%3)*20-20,true) }
    for(let k=0;k<NT4;k++) put(F+k*12,[(k+0)*4,(k+1)*4,(k+8)*4]);   // 後半の置き場所も指す
    const o4=readT1Object(e,0);
    ok("  入れる命令を見落とすと、置き場所が足りないと分かる",
       t1Run(e,0)===null&&/置き場所/.test(API.t1RunWhy||""), API.t1RunWhy||"(理由なし)");
    const rb=t1RunBest(e,o4);
    ok("    読み方を探すと「命令7も頂点を入れる」が当たる",
       !!rb&&rb.verts===NV4&&rb.faceBytes===FB4&&rb.variant&&rb.variant.load7===1,
       rb?`頂${rb.verts} 面${rb.faceBytes}B ${t1VarName(rb.variant)}`:"null");
    ok("    当たった読み方を覚える", !!API.T1_VAR_FOUND&&API.T1_VAR_FOUND.load7===1,
       API.T1_VAR_FOUND?t1VarName(API.T1_VAR_FOUND):"覚えていない");
    // 数えるだけの調べ: 命令1・2 の合計が頂点数に足りないことが見える
    const au=t1Audit(e,o4);
    ok("    数え上げで「入れる合計が頂点数に足りない」と出る",
       au.nv===NV4&&au.load12===8&&au.load47===8&&au.gap===0,
       t1AuditLine(au));
    ok("    読み方の候補は32通り", T1_VARIANTS.length===31, String(T1_VARIANTS.length)); }

  // 未知が2つ残ったとき（命令14 と 命令15）。引き算だけでは決まらないので、
  // 大きさの組を総当たりして、通るものが1組だけなら覚える
  { for(const k of Object.keys(T1_LEARNED)) delete T1_LEARNED[k];
    const NV5=16, N14=5, N15=3, FB5=N14*12+N15*16;   // 命令14=12B(三角) 命令15=16B(四角)
    const V=0x38, N=V+NV5*8, F=N+NV5*8, C=F+FB5, E5=C+NV5*4;
    const e=new Uint8Array(E5), ev=new DataView(e.buffer);
    const put=(o,vals)=>vals.forEach((v,i)=>ev.setUint32(o+i*4,v,true));
    put(0,[F,V,N,C, 1,0,NV5, 14,N14, 15,N15, 0]);
    for(let i=0;i<NV5;i++){ const o=V+i*8;
      ev.setInt16(o,(i%4)*30-45,true); ev.setInt16(o+2,((i/4)|0)*30-45,true); ev.setInt16(o+4,(i%3)*20-20,true) }
    let q=F;
    for(let k=0;k<N14;k++){ put(q,[(k%NV5)*4,((k+1)%NV5)*4,((k+2)%NV5)*4]); q+=12 }
    for(let k=0;k<N15;k++){ put(q,[(k%NV5)*4,((k+1)%NV5)*4,((k+2)%NV5)*4,((k+3)%NV5)*4]); q+=16 }
    const o5=readT1Object(e,0);
    ok("  未知が2つあると、引き算だけでは解けない", t1SolveSize(t1ScanOps(e,0))===null, "");
    const cand=t1SolveSize2(t1ScanOps(e,0));
    ok("    大きさの組を総当たりすると、候補が出る", !!cand&&cand.length>=1,
       cand?cand.map(([a,b])=>`${a.size}/${b.size}`).join(" "):"null");
    const rp=t1RunBest(e,o5);
    ok("    組で読むと、頂点も面のバイト数もぴったり合う",
       !!rp&&rp.verts===NV5&&rp.faceBytes===FB5&&rp.solved2,
       rp?`頂${rp.verts} 面${rp.faceBytes}B`:"null");
    // 2通りあっても覚えること。覚えないと毎回解き直して、読むたびに形が変わる
    ok("    2通りあっても覚える（読むたびに形が変わらないように）",
       !!T1_LEARNED[14]&&!!T1_LEARNED[15],
       `命令14=${T1_LEARNED[14]&&T1_LEARNED[14].size}B 命令15=${T1_LEARNED[15]&&T1_LEARNED[15].size}B`);
    ok("      若い番号のほうが小さい大きさになる",
       !!T1_LEARNED[14]&&!!T1_LEARNED[15]&&T1_LEARNED[14].size<=T1_LEARNED[15].size,
       `${T1_LEARNED[14]&&T1_LEARNED[14].size} ≦ ${T1_LEARNED[15]&&T1_LEARNED[15].size}`);
    ok("    通る読み方が1組だけなら覚える",
       !!rp&&rp.solved2&&rp.solved2.sure&&T1_LEARNED[14]&&T1_LEARNED[14].size===12
       &&T1_LEARNED[15]&&T1_LEARNED[15].size===16,
       rp&&rp.solved2?`${rp.solved2.ways}通り 命令14=${T1_LEARNED[14]&&T1_LEARNED[14].size}B 命令15=${T1_LEARNED[15]&&T1_LEARNED[15].size}B`:"null");
    for(const k of Object.keys(T1_LEARNED)) delete T1_LEARNED[k]; }
  T1_FACE_OP[14]=KEEP1415[0]; T1_FACE_OP[15]=KEEP1415[1];

  // 骨の行列を当てると、区切りが動くこと。
  // 頂点は「その骨のローカル座標」で入っているので、行列をかけないと手足が胴に重なる
  { const NV6=6, NT6=2, FB6=NT6*12;
    const V=0x50, N=V+NV6*8, F=N+NV6*8, C=F+FB6, E6=C+NV6*4;   // 命令が 48B 要るので頂点は 0x50 から
    const e=new Uint8Array(E6), ev=new DataView(e.buffer);
    const put=(o,vals)=>vals.forEach((v,i)=>ev.setUint32(o+i*4,v,true));
    //  区切り0 に三角1枚、命令5 のあと 区切り1 に三角1枚
    put(0,[F,V,N,C, 1,0,3, 10,1, 5, 1,3,3, 10,1, 0]);
    for(let i=0;i<NV6;i++){ const o=V+i*8;
      ev.setInt16(o,(i%3)*10,true); ev.setInt16(o+2,(i<3?0:0),true); ev.setInt16(o+4,0,true) }
    put(F,[0,4,8]); put(F+12,[12,16,20]);
    const o6=readT1Object(e,0);
    const spanX=m=>{ let mn=1e9,mx=-1e9; for(let i=0;i<m.pos.length;i+=3){ if(m.pos[i]<mn)mn=m.pos[i]; if(m.pos[i]>mx)mx=m.pos[i] } return mx-mn };
    t1Show.up=0; t1SetBones(null);
    const before=spanX(buildT1Mesh(e,[readT1Object(e,0)]).mesh);
    //  区切り1 だけ X に +1000 ずらす行列を当てる
    const I={m:[4096,0,0, 0,4096,0, 0,0,4096],t:[0,0,0],one:4096};
    t1SetBones([I,{m:I.m.slice(),t:[1000,0,0],one:4096}]);
    const after=spanX(buildT1Mesh(e,[readT1Object(e,0)]).mesh);
    t1SetBones(null);
    ok("  骨の行列を当てると、区切りが動く", after>before+900, `${before} → ${after}`);
    ok("    骨を外すと元に戻る", spanX(buildT1Mesh(e,[readT1Object(e,0)]).mesh)===before, ""); }

  // 骨の区切りごとに横へ並べられること（どの区切りが何なのかを見るため）
  { const NV8=6, FB8=24;
    const V=0x50, N=V+NV8*8, F=N+NV8*8, C=F+FB8, E8=C+NV8*4;
    const e=new Uint8Array(E8), ev=new DataView(e.buffer);
    const put=(o,vals)=>vals.forEach((v,i)=>ev.setUint32(o+i*4,v,true));
    put(0,[F,V,N,C, 1,0,3, 10,1, 5, 1,3,3, 10,1, 0]);
    for(let i=0;i<NV8;i++){ const o=V+i*8; ev.setInt16(o,(i%3)*10,true) }
    put(F,[0,4,8]); put(F+12,[12,16,20]);
    t1Show.up=0; t1SetBones(null); t1Show.segSpread=false;
    const spanX=m=>{ let mn=1e9,mx=-1e9; for(let i=0;i<m.pos.length;i+=3){ if(m.pos[i]<mn)mn=m.pos[i]; if(m.pos[i]>mx)mx=m.pos[i] } return mx-mn };
    const before=spanX(buildT1Mesh(e,[readT1Object(e,0)]).mesh);
    t1Show.segSpread=true;
    const after=spanX(buildT1Mesh(e,[readT1Object(e,0)]).mesh);
    t1Show.segSpread=false;
    ok("  骨の区切りごとに並べると、横に離れる", after>before+40, `${before} → ${after}`);
    const o8=readT1Object(e,0); buildT1Mesh(e,[o8]);
    const lay=t1SegLayout(e,[o8],(x,y,z)=>[x,y,z]);
    ok("    区切りの数だけ置き場所が決まる", lay.keys.length===2, lay.keys.join(","));
    // 区切りを1つだけ描けること（一覧にするときに使う）
    { const all=buildT1Mesh(e,[readT1Object(e,0)]).tris;
      t1Show.segOnly=0; const one=buildT1Mesh(e,[readT1Object(e,0)]).tris;
      t1Show.segOnly=1; const two=buildT1Mesh(e,[readT1Object(e,0)]).tris;
      t1Show.segOnly=-1;
      ok("    区切りを1つだけ描ける", all===2&&one===1&&two===1,
         `全部${all} 区切り0=${one} 区切り1=${two}`); }
    // 区切りの番号は部品ごとに振り直されるので、部品を決めないと別物が混ざる。
    // 同じ部品を2つ並べて、片方だけを指せることを確かめる
    { t1Show.segOnly=0; t1Show.segPart=-1;
      const both=buildT1Mesh(e,[readT1Object(e,0),readT1Object(e,0)]).tris;   // 2部品ぶん混ざる
      t1Show.segPart=0;
      const mine=buildT1Mesh(e,[readT1Object(e,0),readT1Object(e,0)]).tris;
      t1Show.segPart=0x7fffff;                                   // どの部品とも合わない
      const none=buildT1Mesh(e,[readT1Object(e,0),readT1Object(e,0)]).tris;
      t1Show.segOnly=-1; t1Show.segPart=-1;
      ok("    部品を決めれば、その部品の区切りだけになる", both===2&&mine===2&&none===0,
         `決めない${both} 合う部品${mine} 合わない部品${none}`); } }

  // 色の引き方を、色の置き場所の大きさから測れること
  { const o=readT1Object(d,0);                       // 実物どおりの部品（頂点51・面53）
    buildT1Mesh(d,[o]);
    const cf=t1ColorFit(d,[o]);
    ok("  色の引き方を測れる（実物は頂点ごと）",
       cf.length===1&&cf[0].fit==="頂点ごと"&&cf[0].exact,
       cf.length?t1ColorLine(cf[0]):"0件");
    // 色の置き場所を「面の頂点ぶん」に広げると、そちらだと判定すること
    { const corner=cf[0].corner;
      const e=new Uint8Array(0x668+corner*4);        // 色の位置 0x668 から面の頂点ぶん
      e.set(d.subarray(0,Math.min(d.length,e.length)));
      const o2=readT1Object(e,0); buildT1Mesh(e,[o2]);
      const c2=t1ColorFit(e,[o2]);
      // 面に1色のときは、1枚の3つの角がぜんぶ同じ色になること（べた塗り）
      { const nf=cf[0].faces;
        const e3=new Uint8Array(0x668+nf*4), v3=new DataView(e3.buffer);
        e3.set(d.subarray(0,Math.min(d.length,e3.length)));
        for(let k=0;k<nf;k++){ const q=0x668+k*4; e3[q]=(k*7)&0xff; e3[q+1]=(k*13)&0xff; e3[q+2]=(k*29)&0xff }
        const o3=readT1Object(e3,0);
        const r3=buildT1Mesh(e3,[o3]);          // 先に組み立てる（run が決まらないと色は測れない）
        const c3=t1ColorFit(e3,[o3]);
        const C=r3.mesh.col;
        let flat=true;
        for(let t=0;t<C.length;t+=9)
          for(let a=0;a<3;a++) if(C[t+a]!==C[t+3+a]||C[t+a]!==C[t+6+a]) flat=false;
        ok("    面に1色なら、1枚は3つの角とも同じ色になる",
           c3.length===1&&c3[0].fit==="面に1色"&&flat,
           (c3.length?c3[0].fit:"?")+" / "+(flat?"べた塗り":"角ごとに違う")); }
      // ぴったりでなくても、いちばん近いのが面なら面で引くこと。
      // 「ぴったりのときだけ」だと、少しずれただけで既定に落ちて模様が乱れる
      { const nf=cf[0].faces;
        const e4=new Uint8Array(0x668+nf*4+40);      // 面の数より 10色ぶん多い
        e4.set(d.subarray(0,Math.min(d.length,e4.length)));
        const o4=readT1Object(e4,0); buildT1Mesh(e4,[o4]);
        const c4=t1ColorFit(e4,[o4]);
        ok("    ぴったりでなくても、いちばん近い引き方を使う",
           c4.length===1&&c4[0].fit==="面に1色"&&!c4[0].exact&&c4[0].near,
           c4.length?`${c4[0].fit} ずれ${c4[0].diff} 近い=${c4[0].near}`:"0件"); }
      // 当ててみて選ぶ: 隣り合う面の色が揃う引き方を選べること。
      // 面ごとに「隣どうし似た色」を置いた部品なら、面に1色が選ばれる
      { // 辺を共有する三角2枚。面ごとの色は似せ、頂点ごとの色はかけ離れさせる
        const NVc=6, FBc=2*12;
        const V=0x50, N=V+NVc*8, F=N+NVc*8, C=F+FBc, Ec=C+NVc*4;
        const e5=new Uint8Array(Ec), v5=new DataView(e5.buffer);
        const pu=(o2,vals)=>vals.forEach((v,i)=>v5.setUint32(o2+i*4,v,true));
        pu(0,[F,V,N,C, 1,0,6, 10,2, 0]);
        for(let i=0;i<NVc;i++){ const q=V+i*8;
          v5.setInt16(q,(i%3)*40,true); v5.setInt16(q+2,((i/3)|0)*40,true) }
        pu(F,[0,4,8]); pu(F+12,[0,4,20]);        // 辺（頂点0-1）を共有する
        const put3=(k,r,g,b)=>{ const q=C+k*4; e5[q]=r; e5[q+1]=g; e5[q+2]=b };
        put3(0,10,10,10); put3(1,14,14,14);      // 面ごとの色（似ている）
        put3(2,250,10,10); put3(3,10,250,10); put3(4,10,10,250); put3(5,250,250,10);
        const o5=readT1Object(e5,0); buildT1Mesh(e5,[o5]);
        const sFace=t1ColorSmooth(e5,o5,"面に1色");
        const sVert=t1ColorSmooth(e5,o5,"頂点ごと");
        const b5=t1ColorBest(e5,o5,["頂点ごと","面の頂点ごと","面に1色"]);
        ok("    隣り合う面の色が揃う引き方を選ぶ",
           !!b5&&b5.mode==="面に1色"&&sFace<sVert,
           b5?`${b5.mode}（面${Math.round(sFace)} 頂点${Math.round(sVert)}）`:"null"); }
      ok("    面の頂点ごとに並んでいれば、そう見分ける",
         c2.length===1&&c2[0].fit==="面の頂点ごと"&&c2[0].exact,
         c2.length?t1ColorLine(c2[0]):"0件"); } }

  // 分かったキャラクターの名前が引けること
  // 「みんなお腹のところに顔がある」＝部品が全部原点に重なっている、
  // という見立てを数で確かめられること。中心はずっと計算していたのに捨てていた
  { const zero=[{seg:0,mid:"0,0,0",span:100},{seg:1,mid:"2,-3,1",span:80}];
    const o1=API.t1SegOrigin(zero,400);
    ok("  骨ごとの中心が原点のまわりかを数で出せる", o1&&o1.far===0, JSON.stringify(o1));
    ok("    そのときは「行列でしか運べない」と言う",
       /行列でしか運べない/.test(API.t1SegOriginLine(o1)), API.t1SegOriginLine(o1));
    const some=[{seg:0,mid:"0,0,0",span:100},{seg:1,mid:"0,300,0",span:80}];
    const o2=API.t1SegOrigin(some,400);
    ok("    位置を持っている部品があれば、それを名指しする",
       o2&&o2.far===1&&/1\(0,300,0\)/.test(API.t1SegOriginLine(o2)), API.t1SegOriginLine(o2));
    ok("    そのときは「そこは正しく置ける」と言う",
       /正しく置ける/.test(API.t1SegOriginLine(o2)), "");
    ok("    区切りが無ければ何も言わない",
       API.t1SegOrigin([],400)===null&&API.t1SegOriginLine(null)==="", "");
  }
  // 鎖をたどって積む。#68 の中心が「先頭だけ左右に離れ、その先は ±2」
  // だったので、部品の座標は親からの相対だと読んだ。
  // 実物 #68 の脚（17→18→19）の中心をそのまま使って確かめる
  { const B=(mid,half)=>({mn:mid.map((v,i)=>v-half[i]),mx:mid.map((v,i)=>v+half[i]),n:1});
    const box=new Map([
      [17,B([-133,-3,-51],[170,57,89])],
      [18,B([  54,-3, -2],[104,57,43])],
      [19,B([  79, 1, -1],[ 79,53,42])],
      [21,B([  33, 1, -2],[ 29,47,38])],   // 20 を抜いて、鎖が切れることも見る
    ]);
    const L=API.t1ChainFromBox(box,1);
    // 面でまとめると、前の区切りで入れた頂点が混ざる。
  // 入れたときの区切りを覚えておけば、骨ごとの広がりが正しく出る
  { const R=t1Run(d,0);
    // 骨の区切り数を、ふるいの結果にも出す。
  // エンディングの衛兵のような、ローブ姿で脚の分かれていないキャラクターが
  // 混じっているなら、区切りの数でふるい分けられる
  // ファイルの形（0x90000000 ＋ 部品の位置）に包まないと t1Diagnose は動かない。
  // 最初に書いたものは部品単体を渡していて、parts=0 のまま
  // 「segs は数値である」が 0 で通っていた。これも空振りを ok と呼ぶやつ
  { const HEAD=16, file=new Uint8Array(HEAD+d.length), fv=new DataView(file.buffer);
    fv.setUint32(0,0x90000000,true);
    fv.setUint32(4,HEAD,true);      // 本体の部品はここから
    fv.setUint32(8,0,true);         // 組は無し（0件で打ち切り）
    file.set(d,HEAD);
    const g=t1Diagnose(file);
    ok("  ふるいの結果に骨の区切り数が入る", g&&g.parts>0&&typeof g.segs==="number",
       g?`parts=${g.parts} run=${g.run} segs=${g.segs}`:"null");
    ok("    三角形の数も入る（見なくても大きさが分かるように）",
       g&&g.tris===NTRI, g?`${g.tris} / 予想 ${NTRI}`:"-");
    // ウダン皇帝は身長152cmで小柄。大きさが出れば、絵を見ずに候補を絞れる
    ok("    大きさ（いちばん長い辺）も入る", g&&g.ext>0, g?String(g.ext):"-");
    ok("    部品が1つも無ければ 0（数えられなかったと分かるように）",
       (()=>{ const z=t1Diagnose(d); return z.parts===0&&z.tris===0&&z.ext===0 })(), "");
  }
  ok("  頂点を入れた区切りを覚えている",
       !!R&&Array.isArray(R.vseg)&&R.vseg.length===R.verts,
       R?`${R.vseg&&R.vseg.length} / 頂点 ${R.verts}`:"null");
    // この試験データは先頭に命令5があるので、頂点はどれも区切り1で入る
    ok("    区切りをまたがなければ、全部が同じ区切り",
       !!R&&R.vseg.every(v=>v===1), R?[...new Set(R.vseg)].join(","):"-");
    const V=API.t1VertBoxes(d,{base:0,vertPtr:VERT,run:R});
    ok("    入れた区切りごとに箱が出る", !!V&&V.length===1&&V[0].n===NV,
       V?`${V.length}区切り ${V[0]&&V[0].n}点`:"null");
    ok("    まとめの行になる", /入れた区切りごとの頂点/.test(API.t1VertBoxLine(V)),
       API.t1VertBoxLine(V));
    ok("    無いときは空", API.t1VertBoxLine(null)===""&&API.t1VertBoxes(d,{run:null})===null, "");
  }
  // 手足の鎖は、鏡の対から割り出す。
  // 実物 #68 の頂点の箱をそのまま入れて確かめる（16..21 と 22..27 が脚）
  { const B=(mid,half,n)=>({n,mn:mid.map((v,i)=>v-half[i]),mx:mid.map((v,i)=>v+half[i])});
    const box=new Map([
      [16,B([-254,-3,-127],[50,57,14],24)], [22,B([-254,-4, 126],[50,57,14],24)],
      [17,B([  -6,-4,  22],[43,56,16], 6)], [23,B([  -6,-3, -21],[43,56,16], 6)],
      [18,B([  64, 0,  -2],[94,54,43],44)], [24,B([  64, 0,   2],[94,54,43],44)],
      [19,B([   1, 1,  -2],[ 1,44,34], 6)], [25,B([   1, 0,   2],[ 1,44,34], 6)],
      [20,B([  62, 1,  -2],[ 0,47,38],12)], [26,B([  62, 0,   3],[ 0,47,38],12)],
      [21,B([   6, 0,  -4],[ 2,32,21], 6)], [27,B([   6,-1,   4],[ 2,32,21], 6)],
      [29,B([-233,10,   9],[182,200,119],113)],           // 対にならない＝中心線
    ]);
    const runs=API.t1LimbRuns(box);
    // ぺたんこな区切りを見つける。実物 #68 の数字をそのまま入れる
  { const V=[{seg:18,n:44,size:"188×108×86",mid:"64,0,-2"},
             {seg:19,n:6, size:"2×88×68",   mid:"1,1,-2"},
             {seg:20,n:12,size:"1×94×77",   mid:"62,1,-2"},
             {seg:3, n:160,size:"630×365×417",mid:"-21,-18,1"}];
    const f=API.t1FlatSegs(V);
    // 骨の数え方を二つ並べて、どちらが骨らしいかを数で言えること
  { const A=[{seg:0,n:10,size:"600×100×100",mid:"0,0,0"},
             {seg:1,n:10,size:"2×90×80",   mid:"0,0,0"}];
    const Bb=[{seg:0,n:10,size:"120×100×100",mid:"0,0,0"},
              {seg:1,n:10,size:"110×90×80", mid:"0,0,0"}];
    const line=API.t1BoneCountCompare(A,Bb);
    ok("  骨の数え方を比べて、骨らしいほうを言う",
       /骨らしいのは 命令6も数えたほう/.test(line), line);
    ok("    逆のときは逆を言う",
       /骨らしいのは 命令5だけのほう/.test(API.t1BoneCountCompare(Bb,A)),
       API.t1BoneCountCompare(Bb,A));
    ok("    差が小さければ、どちらとも言わない",
       /どちらとも言えない/.test(API.t1BoneCountCompare(A,A)), API.t1BoneCountCompare(A,A));
    ok("    片方が無ければ何も言わない", API.t1BoneCountCompare(A,null)==="", "");
  }
  // 骨の境目で頂点が共有されているか。共有していれば共通の空間にある
  { const NV2=6, VERT2=0x40;
    const buf=new Uint8Array(0x200), bv=new DataView(buf.buffer);
    // 区切り0に3点、区切り1に3点。うち1点は同じ座標
    const P=[[10,20,30],[40,50,60],[70,80,90],
             [10,20,30],[100,110,120],[130,140,150]];
    P.forEach((p,i)=>{ const o=VERT2+i*8;
      bv.setInt16(o,p[0],true); bv.setInt16(o+2,p[1],true); bv.setInt16(o+4,p[2],true) });
    const o={base:0,vertPtr:VERT2,run:{vseg:[0,0,0,1,1,1]}};
    const r=API.t1SegTouch(buf,o);
    // 骨の親子の表（親の番号＋親からのずれ）をモデルの中から探せること
  { const NB=8, ST=8, AT=0x30;
    const buf=new Uint8Array(0x200), bv=new DataView(buf.buffer);
    // 0←0, 1←0, 2←1, 3←2, 4←0, 5←4, 6←5, 7←6  という木
    const par=[0,0,1,2,0,4,5,6];
    par.forEach((p,k)=>{ const o=AT+k*ST;
      buf[o]=p;
      bv.setInt16(o+2,(k+1)*17,true);
      bv.setInt16(o+4,-(k+1)*13,true);
      bv.setInt16(o+6,(k+1)*7,true); });
    const hits=API.t1FindSkelTable(buf,NB);
    const hit=hits.find(h=>h.at===AT&&h.stride===ST&&h.pAt===0&&h.vAt===2);
    // ファイルのうち、説明の付かない余りを出せること
  { const buf=new Uint8Array(0x400);
    const o={base:0,ok:true,vertPtr:0x40,normPtr:0x80,facePtr:0xC0,colPtr:0x100,nv:4};
    // 説明が付くのは 0..0x110。余りは 0x110..0x400（752B）
    buf[0x110]=0xAA; buf[0x111]=0xBB;
    const u=API.t1FileUse(buf,[o]);
    ok("  ファイルの余りを出せる", u&&u.gaps.length===1&&u.gaps[0].a===0x110&&u.gaps[0].b===0x400,
       u?JSON.stringify(u.gaps):"null");
    ok("    説明の付くバイト数も数える", u&&u.used===0x110, u?String(u.used):"-");
    ok("    骨の数で割った1本あたりも出す",
       /骨30本なら1本25B/.test(API.t1FileUseLines(buf,u,30).join(" ")),
       API.t1FileUseLines(buf,u,30)[1]);
    ok("    余りが無ければ、そう言う", (()=>{
         const b2=new Uint8Array(0x110);
         return /余りなし/.test(API.t1FileUseLines(b2,API.t1FileUse(b2,[o]),30).join(" ")) })(), "");
  }
  ok("  骨の親子の表を見つける", !!hit,
       hits.slice(0,3).map(h=>`+0x${h.at.toString(16)}/${h.stride}B/p+${h.pAt}/v+${h.vAt}`).join(" ")||"(なし)");
    ok("    親が自分より小さい数を数える", !!hit&&hit.tree===NB-1, hit?String(hit.tree):"-");
    ok("    まとめの行になる（親とずれを並べる）",
       /0←0\(17,-13,7\)/.test(API.t1SkelTableLines(buf,NB,hits).join(" ")),
       (API.t1SkelTableLines(buf,NB,hits)[2]||"").slice(0,60));
    ok("    何も無ければ、そう言う",
       /見つからない/.test(API.t1SkelTableLines(buf,NB,[]).join(" ")), "");
    ok("    ゼロばかりの所は拾わない",
       API.t1FindSkelTable(new Uint8Array(0x200),NB).length===0, "");
    // 実物で拾っていた偽物：親が全部 0、どれかの軸が全部 0。
    // 「親が自分より小さい」は親が0なら自動で成り立つ
    { const b2=new Uint8Array(0x200), v2=new DataView(b2.buffer);
      for(let k=0;k<NB;k++){ const o=AT+k*ST;
        b2[o]=0;                                  // 親は全部 0
        v2.setInt16(o+2,(k+1)*11,true);
        v2.setInt16(o+4,0,true);                  // Y は全部 0
        v2.setInt16(o+6,(k+1)*3,true); }
      ok("    親が全部0・軸が全部0 のものは拾わない（実物で拾っていた偽物）",
         API.t1FindSkelTable(b2,NB).length===0,
         API.t1FindSkelTable(b2,NB).map(h=>`+0x${h.at.toString(16)}`).join(" ")||"(なし)"); }
  }
  ok("  骨の境目で重なる頂点を数える", r&&r.pairs.length===1&&r.pairs[0].n===1,
       r?JSON.stringify(r.pairs):"null");
    ok("    番号が隣どうしかを区別する", r&&r.pairs[0].near===true, "");
    ok("    重なりが無ければ、別の空間だと言う", (()=>{
         const o2={base:0,vertPtr:VERT2,run:{vseg:[0,0,0,1,1,1]}};
         const b2=new Uint8Array(0x200), v2=new DataView(b2.buffer);
         [[10,20,30],[40,50,60],[70,80,90],[500,510,520],[530,540,550],[560,570,580]]
           .forEach((p,i)=>{ const q=VERT2+i*8;
             v2.setInt16(q,p[0],true); v2.setInt16(q+2,p[1],true); v2.setInt16(q+4,p[2],true) });
         return /別の空間/.test(API.t1SegTouchLine(API.t1SegTouch(b2,o2))) })(), "");
    ok("    区切りが無ければ何も言わない", API.t1SegTouchLine(null)==="", "");
  }
  ok("  ぺたんこな区切りを見分ける", f.join(" ")==="19(6点 2×88×68) 20(12点 1×94×77)",
       f.join(" ")||"(なし)");
    ok("    肉のある区切りは拾わない", !f.some(x=>/^18\(|^3\(/.test(x)), f.join(" "));
    ok("    空のときは空", API.t1FlatSegs([]).length===0&&API.t1FlatSegs(null).length===0, "");
  }
  ok("  鏡の対から手足の鎖を割り出せる",
       runs.map(r=>r.join("..")).join(" ")==="16..21 22..27",
       runs.map(r=>r.join("..")).join(" ")||"(なし)");
    ok("    対にならない区切り（中心線）は手足に入れない",
       !runs.some(r=>r[0]<=29&&29<=r[1]), runs.map(r=>r.join("..")).join(" "));
    ok("    対が無ければ手足も無い", API.t1LimbRuns(new Map([[0,B([0,0,0],[1,1,1],1)]])).length===0, "");
    // 鎖の切り方が、対から割り出したものになること。
    // 面の箱だと 16・22 に面が無くて切れ目とみなされ、鎖の先頭を捨てていた
    const L=API.t1ChainFromBox(box,1);
    ok("    鎖は対から割り出した区切りで切る", L&&L.runs.join(" ")==="16..21 22..27",
       L?L.runs.join(" "):"null");
    ok("    脚の先頭(16)は動かさず、次(17)に腰の中心が入る",
       L&&L[16].t.join(",")==="0,0,0"&&L[17].t.join(",")==="-254,-3,-127",
       L?`${L[16].t} / ${L[17].t}`:"null");
    ok("    中心線(29)は鎖に入らないので動かさない",
       L&&L[29].t.join(",")==="0,0,0", L?L[29].t.join(","):"null");
    // 人の形になったかを数で見る。積んだあと、いちばん下に来るのが
    // 脚の鎖のいちばん最後の骨なら、腰から脚が下に伸びている
    { const runs=[[16,17,18,19,20,21],[22,23,24,25,26,27]];
      const e=API.t1ChainEnds(box,L,runs);
      ok("    積んだあと、いちばん下に来る区切りが分かる", !!e&&e.lo!=null,
         e?`下端 ${e.lo.seg}(${e.lo.v}) 上端 ${e.hi.seg}(${e.hi.v})`:"null");
      ok("      下端が脚の鎖の最後なら「手足の先」と言う",
         !!e&&(e.loIsLimbTip?/手足の先/.test(API.t1ChainEndLine(e)):true),
         API.t1ChainEndLine(e));
      ok("      鎖が無ければ何も言わない",
         API.t1ChainEnds(null,L,runs)===null&&API.t1ChainEndLine(null)==="", "");
    }
  }
  ok("  鎖をたどって積める", !!L&&L.length>=22, L?`${L.length}本`:"null");
    ok("    続き番号がとぎれたら鎖を切る（17..19 と 21）",
       L&&L.runs.join(" ")==="17..19 21..21", L?L.runs.join(" "):"-");
    // 鎖の先頭はそのまま、2つ目からは親の中心を積む
    ok("    鎖の先頭は動かさない", L&&L[17].t.join(",")==="0,0,0", L?L[17].t.join(","):"-");
    ok("    2つ目には親(17)の中心が入る",
       L&&L[18].t.join(",")==="-133,-3,-51", L?L[18].t.join(","):"-");
    ok("    3つ目には 17＋18 が入る",
       L&&L[19].t.join(",")==="-79,-6,-53", L?L[19].t.join(","):"-");
    ok("    切れた先の鎖は、また先頭から",
       L&&L[21].t.join(",")==="0,0,0", L?L[21].t.join(","):"-");
    const half=API.t1ChainFromBox(box,0.5);
    ok("    効きを半分にすると、積む量も半分（端数は Math.round の通り）",
       half&&half[18].t.join(",")==="-66,-1,-25", half?half[18].t.join(","):"-");
    ok("    区切りが少なすぎるときは何もしない",
       API.t1ChainFromBox(new Map([[0,B([0,0,0],[1,1,1])]]),1)===null, "");
  }
  // 表のポインタは命令5のたびに +4 されるので、描き終わったあとの写しでは
  // 終端を指している。直前に使われた骨は手前に並ぶ。後ろ向きにたどれること
  // 写したファイル全体を、32バイトの行列の並びで掃けること。
  // スクラッチパッド（PS1 内蔵の高速1KB）は RAM の外にあるので、
  // RAM だけ見ていては見つからない
  { const buf=new Uint8Array(0x800), dv=new DataView(buf.buffer);
    const M=0x200;
    for(let k=0;k<5;k++){ const o=M+k*32;
      dv.setInt16(o,4096,true);    dv.setInt16(o+6,0,true);
      dv.setInt16(o+8,4096,true);  dv.setInt16(o+16,4096,true);
      dv.setInt32(o+20,100*k,true);
    }
  }
  // メモリの写しの中で RAM の先頭を、命令5の処理のバイト列から見つけられること。
  // 実物では先頭が 0x31B93 で、4の倍数ですらなかった
  { const SKEW=0x123, buf=new Uint8Array(SKEW+0x30000);
    const dv=new DataView(buf.buffer);
    [0x3c08800d,0x8d08be90,0x3c09800d,0x8d29be8c].forEach((w,i)=>
      dv.setUint32(SKEW+0x1f44c+i*4,w>>>0,true));
    ok("  命令5の処理のバイト列から RAM の先頭を見つける",
       API.memFindBaseByCode(buf)===SKEW, String(API.memFindBaseByCode(buf)));
    ok("    無ければ -1", API.memFindBaseByCode(new Uint8Array(1024))===-1, "");
  }
  // DuckStation の写しから CPU のレジスタを読めること
  { const buf=new Uint8Array(0x400), dv=new DataView(buf.buffer);
    buf.set([0x43,0x50,0x55],0x40);                    // "CPU"
    const at=0x40+3+16;
    for(let k=0;k<32;k++) dv.setUint32(at+k*4,0,true);
    dv.setUint32(at+28*4,0x800cbcdc,true);             // $gp
    dv.setUint32(at+29*4,0x807fff60,true);             // $sp
    dv.setUint32(at+16*4,0x80020000,true);             // $s0
  }
  { const RAM=0xD0000, buf=new Uint8Array(RAM), dv=new DataView(buf.buffer);   // 0x800CBE8C が入る大きさ
    const put32=(a,v)=>dv.setUint32(a&0x1fffff,v>>>0,true);
    const put16=(a,v)=>dv.setInt16(a&0x1fffff,v,true);
    // 行列を2つ置く（単位行列＋移動）
    const M1=0x80020000, M2=0x80020020;
    for(const [m,tx] of [[M1,111],[M2,-222]]){
      put16(m,4096); put16(m+2,0); put16(m+4,0);
      put16(m+6,0);  put16(m+8,4096); put16(m+10,0);
      put16(m+12,0); put16(m+14,0);  put16(m+16,4096);
      put32(m+20,tx); put32(m+24,0); put32(m+28,0);
    }
    // 表を置いて、ポインタは終端（2件ぶん進んだ位置）を指させる
    const TBL=0x80021000;
    put32(TBL,M1); put32(TBL+4,M2);
    put32(0x800CBE8C,TBL+8);
  }
  ok("  sector から名前を引ける", t1NameOf(9484)==="ホム"&&t1NameOf(8850)==="チュージ",
     `${t1NameOf(9484)} / ${t1NameOf(8850)}`);
  ok("    ボスも名前の表に入る（ムーフー）", t1NameOf(9383)==="ムーフー", t1NameOf(9383));
  ok("    読み方は公式のものに合わせる", t1NameOf(9289)==="マリー"&&t1NameOf(9132)==="グリン",
     `${t1NameOf(9289)} / ${t1NameOf(9132)}`);
  ok("    使用可能な8人は 8755〜9484 に9組そろう（＋ムーフー）",
     [8755,8835,8931,9004,9117,9223,9274,9369,9470].every(s=>t1NameOf(s)!==""),
     [8755,8835,8931,9004,9117,9223,9274,9369,9470].map(s=>t1NameOf(s)).join(" "));
  // ノークとSノーク。同じ三角形の数で大きさがちょうど2倍だった
  ok("    ノークとSノークを分けて持つ",
     t1NameOf(9561)==="ノーク"&&/^Sノーク/.test(t1NameOf(5529)),
     `${t1NameOf(9561)} / ${t1NameOf(5529)}`);
  ok("    大きさが合わない札は ？ に戻す（ウダン）",
     /^？/.test(t1NameOf(9662))&&!/ウダン(?!に)/.test(t1NameOf(9662).replace("ウダンに合わない","")),
     t1NameOf(9662));
  ok("    推測のものには ？ が付く", /？/.test(t1NameOf(8770))&&!/？/.test(t1NameOf(9132)),
     `${t1NameOf(8770)} / ${t1NameOf(9132)}`);
  ok("    老人のフェイも名前の表に入る", t1NameOf(9018)==="フェイ"&&/別衣装/.test(t1NameOf(9004)),
     `${t1NameOf(9004)} / ${t1NameOf(9018)}`);
  ok("    知らない sector では空になる", t1NameOf(1)==="" , `"${t1NameOf(1)}"`);

  // 色の引き方は手で選べる。ただし「命令ごとの並び」が色のバイト数と
  // ぴったり合った部品では、そちらが優先される（手で選んだものは効かない）。
  // 以前は手で選ぶと並びが無効になり、しかもその選択を localStorage に
  // 覚えていたので、一度選んだ人は解けた並びを使えないままになっていた
  { const o7=readT1Object(d,0); buildT1Mesh(d,[o7]);
    const run1=()=>{ const o=readT1Object(d,0); const r=buildT1Mesh(d,[o]);
      return {col:r.mesh.col.join(","),plan:!!o.colPlan} };
    t1Show.colMode=""; const auto=run1();
    t1Show.colMode="面に1色"; const face=run1();
    t1Show.colMode="頂点ごと"; const vert=run1();
    t1Show.colMode="";
    if(auto.plan){
      ok("  並びがぴったり合う部品では、手で選んでも変わらない",
         auto.col===face.col&&auto.col===vert.col, "並びが優先されていない");
      ok("    その部品には印が付く", face.plan===true&&vert.plan===true, "");
    }else{
      ok("  並びが合わない部品では、手で選んだ引き方が効く",
         auto.col===vert.col&&face.col!==vert.col,
         `自動=${auto.col===vert.col?"頂点ごと":"別"} 面に1色=${face.col!==vert.col?"変わる":"変わらない"}`);
      ok("    印は付かない", face.plan===false, "");
    } }

  // 色を面ごとにそろえると、1枚の3つの角が同じ色になること
  { const o6=readT1Object(d,0);
    const keepFlat=t1Show.flatColor;
    t1Show.flatColor=false;
    const m1=buildT1Mesh(d,[readT1Object(d,0)]).mesh.col;
    t1Show.flatColor=true;
    const m2=buildT1Mesh(d,[readT1Object(d,0)]).mesh.col;
    t1Show.flatColor=keepFlat;
    const allFlat=C=>{ for(let t=0;t<C.length;t+=9) for(let a=0;a<3;a++)
      if(C[t+a]!==C[t+3+a]||C[t+a]!==C[t+6+a]) return false; return true };
    ok("  色を面ごとにそろえると、1枚が1色になる", !allFlat(m1)&&allFlat(m2),
       `そのまま=${allFlat(m1)?"1色":"混ざる"} そろえた=${allFlat(m2)?"1色":"混ざる"}`); void o6; }

  // 仮の骨組み: Z を反転すると重なる区切りどうしを見つけ、左右に開けること
  { const NV9=12, FB9=3*12;
    const V=0x60, N=V+NV9*8, F=N+NV9*8, C=F+FB9, E9=C+NV9*4;
    const e=new Uint8Array(E9), ev=new DataView(e.buffer);
    const put=(o,vals)=>vals.forEach((v,i)=>ev.setUint32(o+i*4,v,true));
    //  区切り0＝中心（胴）、区切り1と2＝Z を反転した対
    put(0,[F,V,N,C, 1,0,4, 10,1, 5, 1,4,4, 10,1, 5, 1,8,4, 10,1, 0]);
    const vset=(i,x,y,z)=>{ const o=V+i*8;
      ev.setInt16(o,x,true); ev.setInt16(o+2,y,true); ev.setInt16(o+4,z,true) };
    for(let i=0;i<4;i++) vset(i,i*40,0,(i%2)*100-50);        // 胴（Z は ±50）
    for(let i=0;i<4;i++) vset(4+i,100+i*10,0,60+i*10);       // 右手
    for(let i=0;i<4;i++) vset(8+i,100+i*10,0,-(60+i*10));    // 左手（Z 反転）
    put(F,[0,4,8]); put(F+12,[16,20,24]); put(F+24,[32,36,40]);
    t1Show.up=0; t1SetBones(null);
    const o9=readT1Object(e,0); buildT1Mesh(e,[o9]);
    const box=t1SegBoxMap(e,o9);
    ok("  区切りごとの枠を取れる", !!box&&box.size===3, box?`${box.size}個`:"null");
    const pr=t1MirrorPairs(box);
    ok("    Z を反転すると重なる対を見つける", pr.get(1)===2&&pr.get(2)===1&&!pr.has(0),
       [...pr].map(([a,b])=>`${a}↔${b}`).join(" ")||"0組");
    const g=t1GuessBones(e,o9,0.5);
    { t1Show.guessAmt=0;  const z0=t1GuessBones(e,o9)[1].t[2];
      t1Show.guessAmt=1.0; const z1=t1GuessBones(e,o9)[1].t[2];
      t1Show.guessAmt=0.5;
      ok("    開く量を変えられる", z0===0&&z1>0, `0のとき${z0} 1のとき${z1}`); }
    ok("    対だけを左右に開く（中心はそのまま）",
       !!g&&g[0].t[2]===0&&g[1].t[2]>0&&g[2].t[2]===-g[1].t[2],
       g?g.map(x=>x.t[2]).join(","):"null");
    // 肩は広く腰は狭く。上にある対ほど大きく開くこと
    { const NVa=16;
      const V=0x70, N=V+NVa*8, F=N+NVa*8, C=F+4*12, Ea=C+NVa*4;
      const b=new Uint8Array(Ea), bv=new DataView(b.buffer);
      const pu=(o,vals)=>vals.forEach((v,i)=>bv.setUint32(o+i*4,v,true));
      pu(0,[F,V,N,C, 1,0,4,10,1, 5, 1,4,4,10,1, 5, 1,8,4,10,1, 5, 1,12,4,10,1, 0]);
      const vs=(i,x,y,z)=>{ const o=V+i*8;
        bv.setInt16(o,x,true); bv.setInt16(o+2,y,true); bv.setInt16(o+4,z,true) };
      for(let i=0;i<4;i++) vs(i,300+i,0,(i%2)*60-30);      // 上の対（右）
      for(let i=0;i<4;i++) vs(4+i,300+i,0,-((i%2)*60-30)); // 上の対（左）
      for(let i=0;i<4;i++) vs(8+i,-300+i,0,(i%2)*60-30);   // 下の対（右）
      for(let i=0;i<4;i++) vs(12+i,-300+i,0,-((i%2)*60-30));// 下の対（左）
      pu(F,[0,4,8]); pu(F+12,[16,20,24]); pu(F+24,[32,36,40]); pu(F+36,[48,52,56]);
      const oa=readT1Object(b,0); t1SetBones(null); buildT1Mesh(b,[oa]);
      const gg=t1GuessBones(b,oa,0.6);
      ok("    上にある対ほど大きく開く（肩は広く、腰は狭く）",
         !!gg&&Math.abs(gg[0].t[2])>Math.abs(gg[2].t[2])&&Math.abs(gg[2].t[2])>0,
         gg?gg.map(x=>Math.round(x.t[2])).join(","):"null"); } }

  // 骨の表は「当ててみて」選ぶこと。個数が近いだけのでたらめな表を掴まない
  { const NV7=6, NT7=2, FB7=NT7*12;
    const V=0x50, N=V+NV7*8, F=N+NV7*8, C=F+FB7, E7=C+NV7*4;
    const e=new Uint8Array(E7), ev=new DataView(e.buffer);
    const put=(o,vals)=>vals.forEach((v,i)=>ev.setUint32(o+i*4,v,true));
    put(0,[F,V,N,C, 1,0,3, 10,1, 5, 1,3,3, 10,1, 0]);
    for(let i=0;i<NV7;i++){ const o=V+i*8; ev.setInt16(o,(i%3)*100,true) }
    put(F,[0,4,8]); put(F+12,[12,16,20]);
    const o7=readT1Object(e,0); t1Show.up=0; t1SetBones(null);
    buildT1Mesh(e,[o7]);                      // o7.run を作る
    const I=[4096,0,0, 0,4096,0, 0,0,4096];
    const okList=[{m:I,t:[0,0,0],one:4096},{m:I.slice(),t:[0,400,0],one:4096}];
    const badList=[{m:I,t:[0,0,0],one:4096},{m:I.slice(),t:[90000000,0,0],one:4096}];
}

  // メモリの中から骨の表を見つけられること（作りもののRAMで確かめる）
  // プレステの RAM は先頭 64KB が OS の場所なので、その先に置いて試す
  { const RAM=0x30000, ram=new Uint8Array(RAM), rv=new DataView(ram.buffer);
    const NB=10, matAt=0x20000, tblAt=0x21000;
    for(let k=0;k<NB;k++){ const o=matAt+k*32;   // 単位行列＋骨ごとの移動
      rv.setInt16(o,4096,true); rv.setInt16(o+8,4096,true); rv.setInt16(o+16,4096,true);
      rv.setInt32(o+20,k*100,true); rv.setInt32(o+24,0,true); rv.setInt32(o+28,0,true) }
    for(let k=0;k<NB;k++) rv.setUint32(tblAt+k*4,(0x80000000|(matAt+k*32))>>>0,true);
    // 32の倍数でない場所に置いた並びも見つかること（前は8か所に1か所しか見ていなかった）
    { const r2=new Uint8Array(RAM), r2v=new DataView(r2.buffer);
      const at2=0x20004;                       // 32 で割り切れない場所
      for(let k=0;k<NB;k++){ const o=at2+k*32;
        r2v.setInt16(o,4096,true); r2v.setInt16(o+8,4096,true); r2v.setInt16(o+16,4096,true);
        r2v.setInt32(o+20,k*100,true) }
}
    // 表の途中の 0（空の骨）で打ち切らないこと。命令5 は 0 を飛ばす作りだった
    rv.setUint32(tblAt+4*4,0,true);
}

  // 読めるかどうかだけを速く見る道具（ふるい分けのついでに全件にかける）
  // t1Diagnose はファイル全体（署名つき）を受け取るので、部品を1つ入れた小さなファイルを作る
  const asFile=part=>{ const f=new Uint8Array(16+part.length), fv=new DataView(f.buffer);
    fv.setUint32(0,0x90000000,true); fv.setUint32(4,16,true); fv.setUint32(8,0,true);
    f.set(part,16); return f };
  { const g=t1Diagnose(asFile(d));
    ok("  読めるモデルは「読めた」と数える", g.parts>=1&&g.run===g.parts&&g.fail===0,
       `部品${g.parts} 読めた${g.run} 読めない${g.fail}`); }
  { const e=new Uint8Array(END), ev=new DataView(e.buffer); e.set(d);
    ev.setUint32(0x10,99,true);                 // 表に無い命令にする
    const g=t1Diagnose(asFile(e));
    ok("  読めないモデルは理由つきで数える", g.fail>=1&&g.why.length>=1&&/知らない命令/.test(g.why[0]),
       `部品${g.parts} 読めない${g.fail} 理由=${g.why[0]||"なし"}`); }
  // 理由は位置や数を除いて「種類」でまとめられること
  ok("  理由の種類でまとめられる",
     t1WhyKind("まだ入れていない置き場所 41 を指している（+0x368）")
     ===t1WhyKind("まだ入れていない置き場所 7 を指している（+0x12）"),
     t1WhyKind("まだ入れていない置き場所 41 を指している（+0x368）"));

  // 法線を持たない部品（法線の位置＝面の位置）も読めること
  { const e=new Uint8Array(END), ev=new DataView(e.buffer); e.set(d);
    ev.setUint32(8,FACE,true);               // 法線の位置を面の位置と同じにする
    const o3=readT1Object(e,0);
    // 色の数は足りない作りものなので ok は問わない。途中で投げ出さずに読めることを見る
    ok("  法線のない部品も読める（途中で投げ出さない）", !!o3&&o3.nn===0&&o3.nv===(FACE-VERT)/8&&o3.faceBytes>0,
       o3?`頂${o3.nv} 法${o3.nn} 面${o3.faceBytes}B`:"null"); }

  // 組になっている部品（手のポーズ違い）は、組から1つだけ出す
  { const offs=t1ObjectOffsets(new Uint8Array(8));
    ok("  部品の組を控えている", Array.isArray(offs.group), typeof offs.group); }

  // 「部品を並べる」…同じ部品を2つ並べたら、横に離れて置かれる
  { const a=readT1Object(d,0), b=readT1Object(d,0);
    const spanX=m=>{ let mn=1e9,mx=-1e9; for(let i=0;i<m.pos.length;i+=3){ if(m.pos[i]<mn)mn=m.pos[i]; if(m.pos[i]>mx)mx=m.pos[i] } return mx-mn };
    const before=spanX(buildT1Mesh(d,[a,b]).mesh);
    t1Show.spread=true;
    const after=spanX(buildT1Mesh(d,[a,b]).mesh);
    t1Show.spread=false;
    ok("  部品を並べると横に離れる", after>before*1.8, `並べる前 ${Math.round(before)} → 並べた後 ${Math.round(after)}`);
  }

  // 実物のバイト列そのもの: 18 00 00 00 14 00 00 00 10 00 00 00 → 頂点 6,5,4
  {
    const e=new Uint8Array(END), ev=new DataView(e.buffer);
    e.set(d);
    ev.setUint32(FACE,0x18,true); ev.setUint32(FACE+4,0x14,true); ev.setUint32(FACE+8,0x10,true);
    const o2=readT1Object(e,0), r2=buildT1Mesh(e,[o2]);
    const V=i=>[ev.getInt16(VERT+i*8,true),ev.getInt16(VERT+i*8+2,true),ev.getInt16(VERT+i*8+4,true)];
    const want=[...V(6),...V(5),...V(4)];
    ok("実物の面のバイト列が 頂点 6,5,4 として読める",
       want.every((v,i)=>r2.mesh.pos[i]===v), `${[...r2.mesh.pos.slice(0,9)]} / 予想 ${want}`);
  }
  // 法線つきの面（実物 sector 5927 の +0x0034 の部品のバイト列そのまま）
  {
    const hx=t=>Uint8Array.from(t.trim().split(/\s+/),v=>parseInt(v,16));
    const f1=hx("0c 00 00 00 08 00 00 00 04 00 00 00 00 00 00 00 25 02 63 f8 e8 0d 00 00");
    const f2=hx("14 00 00 00 0c 00 00 00 00 00 00 00 10 00 00 00 a1 02 6c f8 d7 0d 00 00");
    const f3=hx("90 00 00 00 cc 00 00 00 f0 00 00 00 8c 00 00 00 65 ff 54 fe 1a f0 00 00");
    const d=new Uint8Array(0x400);
    d.set(f1,0x100); d.set(f2,0x118); d.set(f3,0x130);
    const o={base:0,vertPtr:0x20,normPtr:0x20,facePtr:0x100,colPtr:0x148,nv:100,ok:true};
    const W=t1WalkFaces(d,o);
    ok("法線つきの面を四角形3枚として読める",
       W&&W.quads===3&&W.tris===0&&W.resync===0&&W.left===0,
       W?`四角${W.quads} 三角${W.tris} 読み直し${W.resync} 余り${W.left}`:"読めない");
    ok("  頂点番号は4倍で入っている（3,2,1,0 / 5,3,0,4 / 36,51,60,35）",
       W&&[[3,2,1,0],[5,3,0,4],[36,51,60,35]].every((w,i)=>w.join()===W.faces[i].idx.join()),
       W?JSON.stringify(W.faces.map(f=>f.idx)):"-");
    ok("  法線の長さは 4096（1.12 の固定小数の 1.0）",
       W&&W.faces.every(f=>Math.abs(Math.hypot(...f.n)-4096)<40),
       W?W.faces.map(f=>Math.round(Math.hypot(...f.n))).join(" / "):"-");
    // 三角形（頂点番号3つ＋法線）も混ざって読めること
    const d3=new Uint8Array(0x400), v3=new DataView(d3.buffer);
    [12,8,4].forEach((v,i)=>v3.setUint32(0x100+i*4,v,true));
    [549,-1949,3560,0].forEach((v,i)=>v3.setInt16(0x10c+i*2,v,true));
    d3.set(f1,0x114);
    const W3=t1WalkFaces(d3,{base:0,vertPtr:0x20,normPtr:0x20,facePtr:0x100,colPtr:0x12c,nv:100,ok:true});
    ok("  三角形と四角形が混ざっていても切り分けられる",
       W3&&W3.tris===1&&W3.quads===1&&W3.left===0,
       W3?`四角${W3.quads} 三角${W3.tris} 余り${W3.left}`:"読めない");
    // 法線をまったく持たない部品（12バイトの三角だけ）も、そのまま読めること
    const d4=new Uint8Array(0x400), v4=new DataView(d4.buffer);
    for(let k=0;k<20;k++) for(let j=0;j<3;j++) v4.setUint32(0x100+k*12+j*4,((k+j)%40)*4,true);
    const W4=t1WalkFaces(d4,{base:0,vertPtr:0x20,normPtr:0x20,facePtr:0x100,colPtr:0x100+240,nv:40,ok:true});
    ok("  法線なしの三角だけの部品も読める",
       W4&&W4.kinds[0]===20&&W4.covered===W4.bytes,
       W4?`三角${W4.kinds[0]} ${W4.covered}/${W4.bytes}`:"読めない");
    // 実物と同じ「法線あり → 法線なし」の切り替わりが読めること
    {
      const d5=new Uint8Array(0x800), v5=new DataView(d5.buffer);
      // 平らな四角がきれいに並ぶように、筒の形に頂点を置く
      for(let i=0;i<40;i++){ const a=(i>>1)/20*6.283;
        v5.setInt16(0x20+i*8  ,Math.round(120*Math.cos(a)),true);
        v5.setInt16(0x20+i*8+2,(i&1)?80:-80,true);
        v5.setInt16(0x20+i*8+4,Math.round(120*Math.sin(a)),true); }
      let q=0x100;
      for(let k=0;k<10;k++){                         // 種D: 四角・法線あり 24B
        const r=[k*2,k*2+1,k*2+3,k*2+2].map(x=>x%40);
        r.forEach((x,i)=>v5.setUint32(q+i*4,x*4,true));
        const a=(k+.5)/20*6.283, nx=Math.round(4096*Math.cos(a)), nz=Math.round(4096*Math.sin(a));
        [nx,0,nz,0].forEach((v,i)=>v5.setInt16(q+16+i*2,v,true)); q+=24;
      }
      for(let k=0;k<10;k++){                         // 種B: 四角・法線なし 16B
        const r=[(k+10)*2,(k+10)*2+1,(k+10)*2+3,(k+10)*2+2].map(x=>x%40);
        r.forEach((x,i)=>v5.setUint32(q+i*4,x*4,true)); q+=16;
      }
      for(let k=0;k<6;k++){                          // 種A: 三角・法線なし 12B
        [0,k*2+1,k*2+3].forEach((x,i)=>v5.setUint32(q+i*4,(x%40)*4,true)); q+=12;
      }
      const W5=t1WalkFaces(d5,{base:0,vertPtr:0x20,normPtr:0x20,facePtr:0x100,colPtr:q,nv:40,ok:true});
      ok("  法線ありから法線なしへの切り替わりを読み分ける",
         W5&&W5.kinds[3]===10&&W5.kinds[1]===10&&W5.kinds[0]===6&&W5.resync===0,
         W5?`三角${W5.kinds[0]} 四角${W5.kinds[1]} 三角法線${W5.kinds[2]} 四角法線${W5.kinds[3]} 捨て${W5.resync}`:"読めない");
      ok("    バイトを1つ残らず説明できる",
         W5&&W5.covered===W5.bytes&&t1WalkGood(W5),
         W5?`${W5.covered}/${W5.bytes}`:"-");
    }
    ok("  途切れたら場所を控える（報告に出すため）",
       (()=>{ const dd=new Uint8Array(0x400), vd=new DataView(dd.buffer);
              for(let j=0;j<40;j++) vd.setUint32(0x100+j*4,0x7fffffff,true);  // 面として読めない並び
              const w=t1WalkFaces(dd,{base:0,vertPtr:0x20,normPtr:0x20,facePtr:0x100,colPtr:0x1a0,nv:40,ok:true});
              return !t1WalkGood(w) })(), "読めない並びを通してしまう");
  }
  // 頂点番号が途中で 0 に戻る形（小部品の入れ物）を見分けられること
  {
    const mk=(lo,hi,n)=>Array.from({length:n},(_,k)=>({idx:[lo+k%(hi-lo+1),lo+(k+1)%(hi-lo+1),hi]}));
    const faces=[...mk(0,49,30),...mk(0,29,20),...mk(0,19,15)];
    const sp=t1FaceSpans(faces);
    ok("頂点番号が 0 に戻る場所で区切れる",
       sp.length===3&&sp[0].hi===49&&sp[1].hi===29&&sp[2].hi===19,
       JSON.stringify(sp.map(x=>`${x.n}枚 ${x.lo}..${x.hi}`)));
    const B=t1SpanBases({spans:sp},100);
    ok("  区切りの幅を足すと頂点の数に合う（50+30+20=100）",
       B.sum===100&&B.fits&&B.bases.join()==="0,50,80", `${B.sum} / ${B.bases}`);
    ok("  数が合わないときは振り直しとみなさない",
       !t1SpanBases({spans:sp},854).fits, "854 に合ってしまう");
  }
  // 向きの付け替え（背の高さの軸を上に持ってくる）
  {
    ok("向きの付け替えは5通り", T1_UP.length===5&&T1_UP[0].f(1,2,3).join()==="1,2,3", T1_UP.length);
    ok("  「Y を上（逆）」は Y だけ裏返す", T1_UP[4].f(1,2,3).join()==="1,-2,3", T1_UP[4].f(1,2,3).join());
    ok("  本物の骨のときの向きは「そのまま」", T1_UP_WORLD===0&&T1_UP[T1_UP_WORLD].f(1,2,3).join()==="1,2,3", T1_UP_WORLD);
    ok("  「X を上に」で X が縦になる", T1_UP[1].f(10,0,0).join()==="0,10,0", T1_UP[1].f(10,0,0).join());
    ok("  「X を上に（逆）」は上下が逆", T1_UP[2].f(10,0,0).join()==="0,-10,0", T1_UP[2].f(10,0,0).join());
    ok("  「Z を上に」で Z が縦になる", T1_UP[3].f(0,0,10).join()==="0,10,0", T1_UP[3].f(0,0,10).join());
    ok("  どれも長さを変えない（回すだけ）",
       T1_UP.every(u=>Math.abs(Math.hypot(...u.f(3,4,12))-13)<1e-9), "");
    t1Show.up=1;
    const d5=new Uint8Array(0x200), v5=new DataView(d5.buffer);
    const NV=6, VERT=0x38, NORM=VERT+NV*8, FACE=NORM+NV*8, FB=12, COL=FACE+FB;
    [FACE,VERT,NORM,COL].forEach((v,i)=>v5.setUint32(i*4,v,true));
    v5.setUint32(0x10,5,true);
    [2,0,NV,NV].forEach((v,i)=>v5.setUint32(0x14+i*4,v,true));
    [10,1].forEach((v,i)=>v5.setUint32(0x24+i*4,v,true));
    v5.setUint32(0x2c,0,true);
    for(let i=0;i<NV;i++) v5.setInt16(VERT+i*8,100+i*10,true);   // X だけに広がる形
    [0,4,8].forEach((o,j)=>v5.setUint32(FACE+o,j*4,true));
    const o5=readT1Object(d5,0), r5=buildT1Mesh(d5,[o5]);
    const P=r5.mesh.pos;
    let mx=0,my=0; for(let i=0;i<P.length;i+=3){ mx=Math.max(mx,Math.abs(P[i])); my=Math.max(my,Math.abs(P[i+1])) }
    ok("  組んだ形にも向きが効く（X に広がる形が縦になる）", my>mx&&my>=110, `横${mx} 縦${my}`);
    t1Show.up=0;
  }
  // 部品の位置は「個数＋位置」の組で並ぶ
  const d2=new Uint8Array(0x9000), v2=new DataView(d2.buffer);
  v2.setUint32(0,0x90000000,true); v2.setUint32(4,0x34,true);
  v2.setUint32(8,4,true); [0x6F10,0x7644,0x7D3C,0x8420].forEach((p,i)=>v2.setUint32(12+i*4,p,true));
  v2.setUint32(0x1c,4,true); [0x8B04,0x8238,0x8930,0x8A14].forEach((p,i)=>v2.setUint32(0x20+i*4,p,true));
  v2.setUint32(0x30,0,true);
  // 部品の頭（面／頂点／法線／色の位置）を入れておく。
  // ここが全部0だと「枠だけで中身が無い」とみなして飛ばす作りになった
  for(const p of [0x6F10,0x7644,0x7D3C,0x8420,0x8B04,0x8238,0x8930,0x8A14])
    v2.setUint32(p,0x100,true);
  const offs=t1ObjectOffsets(d2);
  ok("部品の位置を8つとも拾う（実物の並び）",
     offs.length>=8&&offs[0]===0x6F10&&offs[3]===0x8420&&offs[4]===0x8B04, JSON.stringify(offs.map(x=>hex(x,4))));
  { // 枠だけあって中身の入っていない部品は飛ばす。
    // 実物の #157 は 0x420 刻みで9つ並んでいて、どれも中身が 0 だった
    const d3=new Uint8Array(0x9000), v3=new DataView(d3.buffer);
    v3.setUint32(0,0x90000000,true); v3.setUint32(4,0x3c,true);
    v3.setUint32(8,4,true);
    [0x6320,0x6740,0x6B60,0x6F80].forEach((p,i)=>v3.setUint32(12+i*4,p,true));
    v3.setUint32(0x1c,4,true);
    [0x73A0,0x77C0,0x7BE0,0x8000].forEach((p,i)=>v3.setUint32(0x20+i*4,p,true));
    v3.setUint32(0x30,2,true);
    [0x8420,0x8534].forEach((p,i)=>v3.setUint32(0x34+i*4,p,true));
    v3.setUint32(0x3c,0x200,true);                  // 本体だけ中身がある
    const o3=t1ObjectOffsets(d3);
    ok("  中身の入っていない枠は飛ばす", o3.length===1&&o3[0]===0x3c,
       JSON.stringify(o3.map(x=>x.toString(16))));
    ok("    飛ばした数を数えておく", o3.empty===10, String(o3.empty));
    // 1つだけ中身を入れたら、それは拾う
    v3.setUint32(0x6740+4,7,true);
    const o4=t1ObjectOffsets(d3);
    ok("    中身が1つでも入っていれば拾う", o4.length===2&&o4.includes(0x6740),
       JSON.stringify(o4.map(x=>x.toString(16))));
  }
}

console.log("\n[9m] 実行ファイルのコードを読む（MIPS）");
{
  const cases=[
    [0x3c0a9000,0x80010000,"lui $t2, 0x9000"],
    [0x8ca30000,0x80010000,"lw $v1, 0($a1)"],
    [0x8c830010,0x80010000,"lw $v1, 16($a0)"],
    [0xaca20004,0x80010000,"sw $v0, 4($a1)"],
    [0x84620002,0x80010000,"lh $v0, 2($v1)"],
    [0x27bdffe8,0x80010000,"addiu $sp, $sp, -24"],
    [0x03e00008,0x80010000,"jr $ra"],
    [0x00000000,0x80010000,"nop"],
    [0x00851021,0x80010000,"addu $v0, $a0, $a1"],
    [0x000418c0,0x80010000,"sll $v1, $a0, 3"],
    [0x14620004,0x80010000,"bne $v1, $v0, 0x80010014"],
    [0x4a000030,0x80010000,"RTPT"],
    [0x4b80e012,0x80010000,"MVMVA"],
  ];
  for(const [w,pc,want] of cases)
    ok(`  0x${w.toString(16).padStart(8,"0")} → ${want}`, mipsDis(w,pc)===want, mipsDis(w,pc));
  // 作りものの実行ファイルから「署名を作る lui」を見つけられるか
  const exe=new Uint8Array(0x800+0x200), dv=new DataView(exe.buffer);
  exe.set(new TextEncoder().encode("PS-X EXE"),0);
  dv.setUint32(0x18,0x80010000,true); dv.setUint32(0x1c,0x200,true);
  dv.setUint32(0x800+0x00,0x27bdffe8,true);   // addiu $sp,$sp,-24  関数の頭
  dv.setUint32(0x800+0x04,0x8c820000,true);   // lw $v0, 0($a0)
  dv.setUint32(0x800+0x08,0x3c039000,true);   // lui $v1, 0x9000    ← 署名
  dv.setUint32(0x800+0x0c,0x14430005,true);   // bne $v0,$v1, ...
  dv.setUint32(0x800+0x10,0x0c004010,true);   // jal 0x80010040（呼び出し先）
  dv.setUint32(0x800+0x14,0x00000000,true);   // nop
  dv.setUint32(0x800+0x18,0x03e00008,true);   // jr $ra
  dv.setUint32(0x800+0x1c,0x00000000,true);
  dv.setUint32(0x800+0x40,0x27bdfff0,true);   // 呼び出し先の関数
  dv.setUint32(0x800+0x44,0x8c820000,true);
  dv.setUint32(0x800+0x48,0x27bd0010,true);
  dv.setUint32(0x800+0x4c,0x03e00008,true);
  dv.setUint32(0x800+0x50,0x00000000,true);
  ok("  jal の飛び先を正しく出す（符号なしで 0x8001BE24）",
     mipsDis(0x0c006f89,0x800680d8)==="jal 0x8001be24", mipsDis(0x0c006f89,0x800680d8));
  // 番地を指定して読む／分岐の飛び先を集める／飛び先の表を読む
  {
    const e2=new Uint8Array(0x800+0x400), d2=new DataView(e2.buffer);
    e2.set(new TextEncoder().encode("PS-X EXE"),0);
    d2.setUint32(0x18,0x80010000,true); d2.setUint32(0x1c,0x400,true);
    d2.setUint32(0x800+0x00,0x27bdffe8,true);       // addiu $sp,$sp,-24
    d2.setUint32(0x800+0x04,0x3c089001,true);       // lui $t0, 0x9001（表の番地の上）
    d2.setUint32(0x800+0x04,0x3c088001,true);       // lui $t0, 0x8001
    d2.setUint32(0x800+0x08,0x25080200,true);       // addiu $t0,$t0,0x200 → 0x80010200
    d2.setUint32(0x800+0x0c,0x10000004,true);       // beq $zero,$zero, 0x80010020
    d2.setUint32(0x800+0x10,0x03e00008,true);       // jr $ra
    d2.setUint32(0x800+0x20,0x24020001,true);       // 飛び先の中身
    d2.setUint32(0x800+0x200,0x80010020,true);      // 表 [0]
    d2.setUint32(0x800+0x204,0x80010024,true);
    d2.setUint32(0x800+0x208,0x80010028,true);
    d2.setUint32(0x800+0x20c,0x8001002c,true);
    const fn={from:0,to:0x14};
  }
  // 命令の振り分けと、命令ごとの長さをコードから割り出せるか
  {
    const e3=new Uint8Array(0x800+0x400), d3=new DataView(e3.buffer);
    e3.set(new TextEncoder().encode("PS-X EXE"),0);
    d3.setUint32(0x18,0x80010000,true); d3.setUint32(0x1c,0x400,true);
    const LOOP=0x80010100;
    // 振り分け: ori $v0,$zero,1 / beq $v1,$v0,0x80010200
    d3.setUint32(0x800+0x00,0x34020001,true);
    d3.setUint32(0x800+0x04,0x1062007e,true);   // beq → 0x80010200
    d3.setUint32(0x800+0x08,0x34020002,true);
    d3.setUint32(0x800+0x0c,0x1062008e,true);   // beq → 0x80010248
    // 命令1の処理: 頂点ポインタを進め、+8 を読み、RTPT して fp += 12
    d3.setUint32(0x800+0x200,0x8fc70008,true);  // lw $a3, 8($fp)
    d3.setUint32(0x800+0x204,0xae0803f8,true);  // sw $t0, 1016($s0)
    d3.setUint32(0x800+0x208,0x4a280030,true);  // RTPT
    d3.setUint32(0x800+0x20c,0x08004040,true);  // j 0x80010100
    d3.setUint32(0x800+0x210,0x27de000c,true);  // addiu $fp, $fp, 12
    // 命令2の処理: fp += 8 だけ
    d3.setUint32(0x800+0x248,0x08004040,true);  // j 0x80010100
    d3.setUint32(0x800+0x24c,0x27de0008,true);  // addiu $fp, $fp, 8
    const disp=mipsDispatch(e3,{from:0,to:0x10});
    ok("  命令の振り分け（ori＋beq）を読み取る",
       disp.length===2&&disp[0].code===1&&disp[0].addr===0x80010200
       &&disp[1].code===2&&disp[1].addr===0x80010248,
       JSON.stringify(disp.map(x=>x.code+":"+x.addr.toString(16))));
  }
  // 命令の処理は「j 振り分け ＋ addiu $fp,$fp,長さ」で終わる。
  // この形を拾えば、命令ごとの長さが実行ファイルから直に分かる
  { const base=0x80010000, code=new Array(64).fill(0);
    const J=to=>(2<<26)|(((to>>>0)&0x0ffffffc)>>>2);
    const ADDIU_FP=n=>(9<<26)|(30<<21)|(30<<16)|(n&0xffff);
    code[0]=J(0x80010100);  code[1]=ADDIU_FP(4);
    code[8]=J(0x80010100);  code[9]=ADDIU_FP(8);
    code[16]=J(0x80010100); code[17]=ADDIU_FP(16);
    const body=new Uint8Array(code.length*4), bv=new DataView(body.buffer);
    code.forEach((w,i)=>bv.setUint32(i*4,w>>>0,true));
    const exe=new Uint8Array(0x800+body.length), ev=new DataView(exe.buffer);
    exe.set(new TextEncoder().encode("PS-X EXE"),0);
    ev.setUint32(0x18,base,true); ev.setUint32(0x1c,body.length,true);
    exe.set(body,0x800);
    const disp=API.mipsFindDispatch(exe);
    // 角度から行列を作るにはサイン表が要る。でたらめなバイト列では起きない形
  { const N=1024, ONE=4096;
    const body=new Uint8Array(0x400+N*2), bv=new DataView(body.buffer);
    for(let i=0;i<0x200;i++) bv.setInt16(i*2,(i*7919)%5000-2500,true);   // 雑音
    for(let i=0;i<N;i++) bv.setInt16(0x400+i*2,Math.round(ONE*Math.sin(2*Math.PI*i/N)),true);
    const exe=new Uint8Array(0x800+body.length), ev=new DataView(exe.buffer);
    exe.set(new TextEncoder().encode("PS-X EXE"),0);
    ev.setUint32(0x18,0x80010000,true); ev.setUint32(0x1c,body.length,true);
    exe.set(body,0x800);
    // 実物は int32 だった。幅を決め打ちにしていたので「512段」と誤って出していた
    { const M=256, b2=new Uint8Array(0x100+M*4), v2=new DataView(b2.buffer);
      for(let i=0;i<M;i++) v2.setInt32(0x100+i*4,Math.round(4096*Math.sin(2*Math.PI*i/M)),true);
      const e2=new Uint8Array(0x800+b2.length), q2=new DataView(e2.buffer);
      e2.set(new TextEncoder().encode("PS-X EXE"),0);
      q2.setUint32(0x18,0x80010000,true); q2.setUint32(0x1c,b2.length,true);
      e2.set(b2,0x800);
    }
    // 外からもらった照合用のバイト列と突き合わせられるように、先頭を出す。
    // 512段・振幅4096 なら 00 00 32 00 64 00 97 00 …
    // 外からもらった照合用のバイト列と突き合わせられるように、先頭を出す。
    //   512段・振幅4096:  00 00 32 00 64 00 …（0,50,100,…）
    //   1024段・振幅4096: 00 00 19 00 32 00 …（0,25,50,…）← この試験データ
    // 雑音だけの実行ファイルでは拾わないこと（空振りを ok と呼ばないため）
    const noise=new Uint8Array(exe.length); noise.set(exe.subarray(0,0x800));
    const nv=new DataView(noise.buffer);
    for(let i=0;i<(body.length>>1);i++) nv.setInt16(0x800+i*2,(i*7919)%5000-2500,true);
    nv.setUint32(0x18,0x80010000,true); nv.setUint32(0x1c,body.length,true);
  }
  ok("  命令の処理の尻尾から、振り分けの戻り先が分かる", disp===0x80010100, hex(disp));
    const t=API.mipsCmdTails(exe,disp);
    ok("    3つ拾えて、長さが 4 / 8 / 16", t.length===3
       &&t.map(x=>x.len).sort((a,b)=>a-b).join(",")==="4,8,16",
       t.map(x=>`${hex(x.at)}:${x.len}`).join(" "));
    ok("    戻り先の違うものは拾わない", API.mipsCmdTails(exe,0x80019999).length===0, "");
    // 振り分け表（処理の番地が並んだ配列）を見つけて、番号と長さを結びつける
    { const tbl=[0x80010000,0x80010020,0x80010040,0x80010000];
      const ex2=new Uint8Array(exe.length+0x40), e2=new DataView(ex2.buffer);
      ex2.set(exe);
      tbl.forEach((v,i)=>e2.setUint32(exe.length+i*4,v>>>0,true));
      e2.setUint32(0x1c,body.length+0x40,true);
      // 遠くにある尻尾を、近くの処理のものだと言い張らないこと。
      // v3.74.0 はこれで「全部16バイト」という中身のない表を出した
      { const far=new Uint8Array(exe.length+0x40), fv=new DataView(far.buffer);
        far.set(exe);
        // 表の中身を、尻尾からずっと離れた番地にする
        [0x80010800,0x80010820].forEach((v,i)=>fv.setUint32(exe.length+i*4,v>>>0,true));
        fv.setUint32(exe.length+8,0x80010840,true);
        fv.setUint32(exe.length+12,0x80010860,true);
        fv.setUint32(0x1c,body.length+0x40,true);
      }
    }
    // 面の命令が面1枚あたり何バイト進むかは、処理の中の addiu $s2,$s2,N にある。
    // これが読めれば、命令14と15の長さを決めごとで選ばなくてよくなる
    { const c2=new Array(16).fill(0);
      const ADDIU=(rs,rt,n)=>(9<<26)|(rs<<21)|(rt<<16)|(n&0xffff);
      c2[2]=ADDIU(18,18,12);                    // addiu $s2,$s2,12
      const b2=new Uint8Array(c2.length*4), v2=new DataView(b2.buffer);
      c2.forEach((w,i)=>v2.setUint32(i*4,w>>>0,true));
      const e3=new Uint8Array(0x800+b2.length), q3=new DataView(e3.buffer);
      e3.set(new TextEncoder().encode("PS-X EXE"),0);
      q3.setUint32(0x18,0x80010000,true); q3.setUint32(0x1c,b2.length,true);
      e3.set(b2,0x800);
      // 実行ファイルから読んだ大きさは、データの辻褄合わせより強い。
  // これで「通る読み方が2通り。若い番号を小さいほうに」という決めごとが要らなくなる
  { const n=API.t1SetExeSizes({14:12,15:16});
    // 命令3・6 が合計でいくつ動かすかを数えられること。
  // 色ポインタは $gp+3444、命令6 は ±4（色ひとつ）ずつ動かす
  { const e=new Uint8Array(0x200), ev=new DataView(e.buffer);
    const put=(o,vals)=>vals.forEach((v,i)=>ev.setUint32(o+i*4,v>>>0,true));
    // 命令の列だけあればよい。6(+4) 6(-4) 3(+12) 6(+4) 0
    put(0x10,[6, 4, 6, (-4)>>>0, 3, 12, 6, 4, 0]);
    const m=API.t1PtrMoves(e,0);
    ok("  命令6が動かす量を数えられる", m&&m.cnt[6]===3&&m.sum[6]===4&&m.plus[6]===8,
       m?`${m.cnt[6]}回 合計${m.sum[6]} ＋のぶん${m.plus[6]}`:"null");
    ok("    命令3も別に数える", m&&m.cnt[3]===1&&m.sum[3]===12,
       m?`${m.cnt[3]}回 合計${m.sum[3]}`:"null");
    ok("    色のずれと合えば、そう言う",
       /合う: ＋のぶんだけ/.test(API.t1PtrMoveLine(m,8)), API.t1PtrMoveLine(m,8));
    ok("    合わなければ、合わないと言う",
       /合うものは無い/.test(API.t1PtrMoveLine(m,999)), API.t1PtrMoveLine(m,999));
    ok("    どちらも無ければ何も言わない",
       API.t1PtrMoveLine({sum:{3:0,6:0},cnt:{3:0,6:0},plus:{3:0,6:0}},0)==="", "");
  }
  ok("  実行ファイルの大きさを取り込む", n===2, `${n}個`);
    // 実行ファイルに書いてあるのは「1枚が何バイトか」だけ。
    // 頂点の数と法線の持ち方はデータに決めさせる。
    // v3.77.0 は 24B から「頂点4＋法線」と決めつけて形を壊した
    ok("    大きさを決めるだけで、持ち方は覚えない",
       !T1_LEARNED[14]&&!T1_LEARNED[15],
       JSON.stringify([T1_LEARNED[14],T1_LEARNED[15]]));
    ok("    食い違う大きさは採らない",
       API.t1ExeSizeOK(14,12)&&!API.t1ExeSizeOK(14,16), "");
    ok("    書いていない命令には口を出さない", API.t1ExeSizeOK(13,24)&&API.t1ExeSizeOK(13,20), "");
    // 本題：同じ個数だと (14,15)=(12,16) と (16,12) の両方が通ってしまう。
    // それが「通る読み方が2通り。若い番号を小さいほうにする決まりで選んだ」の正体。
    // 実行ファイルの数を入れれば、決まりを使わずに1組に絞れる
    { const scan={counts:new Map([[14,10],[15,10]]),faceBytes:12*10+16*10};
      API.t1SetExeSizes(null);
      const both=API.t1SolveSize2(scan)||[];
      const pair=h=>h.map(x=>x.size).join(",");
      ok("    取り込みが無いと (12,16) と (16,12) の両方が通る",
         both.length>=2&&both.some(h=>pair(h)==="12,16")&&both.some(h=>pair(h)==="16,12"),
         both.map(pair).join(" / "));
      API.t1SetExeSizes({14:12,15:16});
      const one=API.t1SolveSize2(scan)||[];
      ok("    取り込むと1組に絞れる（決まりが要らなくなる）",
         one.length===1&&pair(one[0])==="12,16", one.map(pair).join(" / ")||"(なし)");
    }
    API.t1SetExeSizes(null);
    ok("    取り込みを外せば何でも通る", API.t1ExeSizeOK(14,16), "");
  }
  // $gp 相対で番地を作る形（addiu $a0, $gp, N）も拾えること。
  // このゲームはグローバルを $gp 相対で触るので、これを見ないと
  // 「表の番地を作っている場所が無い」と見誤る
  { const GP=0x800CBCDC;
    const c=new Array(8).fill(0);
    c[0]=(9<<26)|(28<<21)|(4<<16)|(432&0xffff);      // addiu $a0, $gp, 432
    c[1]=(0x0f<<26)|(2<<16)|0x800d;                  // lui   $v0, 0x800d
    c[2]=(9<<26)|(2<<21)|(2<<16)|(0xbe94&0xffff);    // addiu $v0, $v0, -16748
    const b=new Uint8Array(c.length*4), bv=new DataView(b.buffer);
    c.forEach((w,i)=>bv.setUint32(i*4,w>>>0,true));
    const e=new Uint8Array(0x800+b.length), ev=new DataView(e.buffer);
    e.set(new TextEncoder().encode("PS-X EXE"),0);
    ev.setUint32(0x18,0x80010000,true); ev.setUint32(0x1c,b.length,true);
    e.set(b,0x800);
  }
  ok("  面1枚の大きさを addiu $s2,$s2,N から読む",
         API.mipsFaceStep(e3,0x80010000)===12, String(API.mipsFaceStep(e3,0x80010000)));
      ok("    無いときは0を返す（分からないと言うため）",
         API.mipsFaceStep(e3,0x80010020)===0, String(API.mipsFaceStep(e3,0x80010020)));
    }
    {     }
  }
}

console.log("\n[10] 表が分からなくてもアーカイブを直接さらえるか");
{
  const SEC=2048;
  const parts=[], starts=[];
  const put=(data,mark)=>{ const sec=parts.reduce((n,p)=>n+p.length/SEC,0);
    const pad=new Uint8Array(Math.ceil(data.length/SEC)*SEC); pad.set(data); parts.push(pad);
    if(mark) starts.push(sec); return sec };
  const dummy=new Uint8Array(SEC*3); dummy.set(new TextEncoder().encode("dummy"));
  const lz=unpack(file0)[0];                 // 0x0b 圧縮のかたまり
  put(dummy,false);
  put(lz,true);
  put(new Uint8Array(SEC*2).fill(0x77),false);
  put(file0,true);
  put(new Uint8Array(SEC).fill(0x31),false);
  put(lz,true);
  put(file0,true);
  const arcLen=parts.reduce((n,p)=>n+p.length,0), arc3=new Uint8Array(arcLen);
  { let o=0; for(const p of parts){ arc3.set(p,o); o+=p.length } }

  state.src={arcSize:arcLen, readArc:async(sec,n)=>arc3.subarray(sec*SEC,sec*SEC+n)};
  const hits=await scanArchive(null);
  ok("ファイルの先頭を全部見つける", hits.length===starts.length&&hits.every((h,i)=>h.sector===starts[i]),
     `見つけた ${JSON.stringify(hits.map(h=>h.sector))} / 正解 ${JSON.stringify(starts)}`);
  ok("  圧縮と入れ子を見分ける", hits.map(h=>h.kind).join(",")==="lz,model,lz,model", hits.map(h=>h.kind).join(","));
  ok("  dummy と埋め草は拾わない", !hits.some(h=>h.sector===0), "");

  const exe3=new Uint8Array(0x800+0x8000), d3=new DataView(exe3.buffer);
  exe3.set(new TextEncoder().encode("PS-X EXE"),0);
  d3.setUint32(0x18,0x80010000,true); d3.setUint32(0x1c,0x8000,true);
  const tbase=0x800+0x2000;
  hits.forEach((h,i)=>{ d3.setUint32(tbase+i*16,h.sector+100,true); d3.setUint32(tbase+i*16+4,h.size-16,true);
                        d3.setUint32(tbase+i*16+8,0x8000EA00,true); d3.setUint32(tbase+i*16+12,1,true) });
  const inf=inferTable(exe3,hits.map(h=>({...h,sector:h.sector+100})));
  ok("実行ファイルの中の表を逆算できる（先頭・1件の長さ・大きさの位置）",
     inf&&inf.base===tbase&&inf.stride===16&&inf.sizeAt===4, JSON.stringify(inf));
  state.src=null;
}
{
  ok("0x0b で始まるだけの偶然は拾わない", looksPacked(new Uint8Array([0x0b,1,0,0,0x0f,0,0,0]))===0, "");
  ok("  展開後の大きさとモードが筋なら拾う", looksPacked(new Uint8Array([0x0b,0x84,0xde,0x00,0x00,0,0,0]))===0xde84, "");
}

{
  // 小さいファイルの中身を全部読む道具
  const u=new Uint8Array(24);
  for(let i=0;i<12;i++){ u[i*2]=i*3; u[i*2+1]=0 }

  // 親の番号らしい列を当てる。1行4バイト×16行、0バイト目が親
  const par=[-1,0,1,2,2,4,5,0,7,8,9,0,11,12,13,14];
  const t=new Uint8Array(par.length*4);
  for(let i=0;i<par.length;i++){ t[i*4]=par[i]&0xff; t[i*4+1]=0x40; t[i*4+2]=i; t[i*4+3]=0x7f }

  // 位置の並びとして読む。位置の先が 0b なら圧縮された中身
  const raw=new Uint8Array(64); const dv=new DataView(raw.buffer);
  dv.setUint32(0,3,true); dv.setUint32(4,16,true); dv.setUint32(8,32,true); dv.setUint32(12,48,true);
  raw[16]=0x0b; raw[32]=0x11; raw[48]=0x22;
}

{
  // 「呼んでいる側」を探す。jal だけを拾い、番地の作り方（上位4bitは PC から）を間違えない
  const exe=new Uint8Array(0x800+0x40), dv=new DataView(exe.buffer);
  exe.set(new TextEncoder().encode("PS-X EXE"),0);
  dv.setUint32(0x18,0x80010000,true); dv.setUint32(0x1c,0x40,true);
  const W=(i,w)=>dv.setUint32(0x800+i*4,w,true);
  W(0,0x27bdffe8);                       // 0x80010000 addiu $sp,$sp,-24  ← 関数の頭
  W(1,0x00000000);
  W(2,0x03e00008);                       // jr $ra
  W(3,0x00000000);
  // 0x80010010 から呼ぶ側。jal 0x80010000 ＝ 0x0c004000
  W(4,0x24040001);                       // addiu $a0,$zero,1
  W(5,0x0c004000);                       // jal 0x80010000
  W(6,0x00000000);

  // 3つ組の並びかどうか。同じ番号3つ＝埋め草
  const mk=(a)=>{ const u=new Uint8Array(a.length*2);
    a.forEach((v,i)=>{ u[i*2]=v&0xff; u[i*2+1]=(v>>8)&0xff }); return u };
}

{
  // 角度の列さがし。1フレームぶんの刻みだけ離れたバイトは似ている
  const F=90, N=40;                       // 1フレーム90バイト×40フレーム
  const a=new Uint8Array(F*N);
  const seed=[]; for(let k=0;k<F;k++) seed.push((k*37+11)&0xff);
  for(let f=0;f<N;f++) for(let k=0;k<F;k++)
    a[f*F+k]=(seed[k]+Math.round(12*Math.sin((f+k*0.3)/6)))&0xff;   // ゆっくり動く

  // でたらめな並びからは刻みを拾わない（拾ったら何でも当たってしまう）
  const b=new Uint8Array(3600); let x=12345;
  for(let i=0;i<b.length;i++){ x=(x*1103515245+12345)>>>0; b[i]=(x>>>16)&0xff }
  // 短いものは「当てにならない」と言う。564バイトで刻み124と言っていたのがこれ
  // 0.64 や 0.71 は「隣のバイトが少し似ている」だけ。刻みとは言わない
  const soft=new Uint8Array(3600);
  for(let i=0;i<soft.length;i++) soft[i]=(Math.round(120+100*Math.sin(i/9))+((i*53)%31))&0xff;
}

{
  // 「読んで・足して・同じ所に書き戻す」入れものを拾う
  const exe=new Uint8Array(0x800+0x40), dv=new DataView(exe.buffer);
  exe.set(new TextEncoder().encode("PS-X EXE"),0);
  dv.setUint32(0x18,0x80010000,true); dv.setUint32(0x1c,0x40,true);
  const W=(i,w)=>dv.setUint32(0x800+i*4,w,true);
  // lui $v0,0x800d / lw $v0,-14064($v0) / addiu $v0,$v0,32 / lui $at,0x800d / sw $v0,-14064($at)
  W(0,0x3c02800d); W(1,0x8c42c910); W(2,0x00000000); W(3,0x24420020);
  W(4,0x3c01800d); W(5,0xac22c910);

  // データ領域の語が lui $gp に見えて $gp が壊れる。
  // これで 0x3c3c0b18 という有り得ない番地を出していた
  const e3=exe.slice(), d3=new DataView(e3.buffer);
  d3.setUint32(0x800+2*4,0x3c3c3c3c,true);          // nop だった所を lui $gp,0x3c3c に

  // いろいろな大きさで進めている所は、行列ではなく GPU のパケット
  const e4=new Uint8Array(0x800+0x80), d4=new DataView(e4.buffer);
  e4.set(new TextEncoder().encode("PS-X EXE"),0);
  d4.setUint32(0x18,0x80010000,true); d4.setUint32(0x1c,0x80,true);
  const V=(i,w)=>d4.setUint32(0x800+i*4,w,true);
  [20,24,36].forEach((step,k)=>{                    // POLY_F4 / POLY_G3 / POLY_GT3
    const b=k*6;
    V(b+0,0x3c02800d); V(b+1,0x8c42c7f4); V(b+2,0x00000000);
    V(b+3,0x24420000|step); V(b+4,0x3c01800d); V(b+5,0xac22c7f4);
  });
}

{
  // 表に値を入れている所を、散らばっていても1つの塊としてまとめて出す
  const exe=new Uint8Array(0x800+0x60), dv=new DataView(exe.buffer);
  exe.set(new TextEncoder().encode("PS-X EXE"),0);
  dv.setUint32(0x18,0x80010000,true); dv.setUint32(0x1c,0x60,true);
  const W=(i,w)=>dv.setUint32(0x800+i*4,w,true);
  const GP=0x800CBCDC, off=(a)=>(a-GP)&0xffff;
  for(let i=0;i<24;i++) W(i,0x00000000);
  W(8, 0x24040001);                                  // addiu $a0,$zero,1 ← 手前も出る
  W(9, 0xaf800000|off(0x800CBE94));                  // sw $zero, N($gp)  0x80010024
  W(12,0xaf800000|off(0x800CBE8C));                  // sw $zero, N($gp)  0x80010030
  W(15,0xaf800000|off(0x800CBE90));                  // sw $zero, N($gp)  0x8001003c
}

{
  // 外側の命令の飛び先表と、その命令が何を触っているか
  const exe=new Uint8Array(0x800+0x200), dv=new DataView(exe.buffer);
  exe.set(new TextEncoder().encode("PS-X EXE"),0);
  dv.setUint32(0x18,0x80019000,true); dv.setUint32(0x1c,0x200,true);
  const W=(i,w)=>dv.setUint32(0x800+i*4,w,true);
  for(let i=0;i<0x80;i++) W(i,0x00000000);
  const GP=0x800CBCDC, gpoff=a=>(a-GP)&0xffff;
  // 0x80019100 ＝ 命令0 の処理：語を1つ食って表Bに入れる
  const B=0x40;
  W(B+0,0x8e020000);                       // lw $v0,0($s0)
  W(B+1,0x26100004);                       // addiu $s0,$s0,4
  W(B+2,0xaf800000|gpoff(0x800CBE8C));     // sw $v0, N($gp)
  W(B+3,0x08000000);                       // j （ここで打ち切り）
  // 0x80019120 ＝ 命令1 の処理：行列を積む
  const C=0x48;
  W(C+0,0x3c02800d); W(C+1,0x8c42c910); W(C+2,0x24420020);
  W(C+3,0xac22c910); W(C+4,0x08000000);
  // 飛び先の並び（2件）を 0x80019180 に置く
  W(0x60,0x80019100); W(0x61,0x80019120);
  const marks={0x800CBE8C:"表B",0x800CC910:"行列の積み"};

  // 外側の命令列らしいファイルの形
  const mkw=a=>{ const u=new Uint8Array(a.length*4), d=new DataView(u.buffer);
    a.forEach((v,i)=>d.setUint32(i*4,v>>>0,true)); return u };
}

{
  // 行列の積み場所を、ふるいにかけずにそのまま読む
  const RAM=0x200000, buf=new Uint8Array(RAM), dv=new DataView(buf.buffer);
  const put=(a,v)=>dv.setUint32(a&0x1fffff,v>>>0,true);
  const SP=0x80100000, TB=0x80110000, M0=0x80120000;
  put(0x800CC910,SP);
  put(0x800CBE8C,TB);                       // 表B＝ポインタの並び
  put(TB,M0);
  // 行列1個。回転は ±4096、移動は数万（±30000 では弾かれていた大きさ）
  const w16=(a,k,v)=>dv.setInt16((a&0x1fffff)+k*2,v,true);
  const w32=(a,o,v)=>dv.setInt32((a&0x1fffff)+o,v,true);
  [4096,0,0, 0,4096,0, 0,0,4096].forEach((v,k)=>w16(M0,k,v));
  w16(M0,9,0); w32(M0,20,123456); w32(M0,24,-98765); w32(M0,28,4242);
  // 積みの手前にも1個置く
  [0,4096,0, -4096,0,0, 0,0,4096].forEach((v,k)=>w16(SP-32,k,v));
  w16(SP-32,9,0); w32(SP-32,20,-50000); w32(SP-32,24,7); w32(SP-32,28,0);

  const M=memReader(buf,0);
  const m=memMatrixAt(M,M0);
  ok("32バイトを行列として読む", !!m&&m.r[0]===4096&&m.r[4]===4096&&m.t[0]===123456,
     JSON.stringify(m));
  ok("  移動が数万でも読める（±30000で弾いていた）", !!m&&m.t[1]===-98765, String(m&&m.t[1]));
}

{
  // 共通の戻り先まで読んでしまうと、戻り先の仕事が全部の命令に混ざる。
  // 命令20 が「語8個・行列積む」に見えたのがこれだった
  const exe=new Uint8Array(0x800+0x200), dv=new DataView(exe.buffer);
  exe.set(new TextEncoder().encode("PS-X EXE"),0);
  dv.setUint32(0x18,0x80019000,true); dv.setUint32(0x1c,0x200,true);
  const W=(i,w)=>dv.setUint32(0x800+i*4,w,true);
  for(let i=0;i<0x80;i++) W(i,0x00000000);
  const GP=0x800CBCDC;
  // 命令0（0x80019100）: 語1個食って、戻り先へ j
  W(0x40,0x8e020000); W(0x41,0x26100004); W(0x42,0x08006448); W(0x43,0x00000000);
  // 命令1（0x80019110）: 何もせず、そのまま戻り先へ落ちる（j 無し）
  W(0x44,0x00000000); W(0x45,0x00000000); W(0x46,0x00000000); W(0x47,0x00000000);
  // 戻り先（0x80019120 ＝ j 先 0x80019120）: ここで行列を積む
  W(0x48,0x3c02800d); W(0x49,0x8c42c910); W(0x4a,0x24420020); W(0x4b,0xac22c910);
  // 命令2 も j で戻り先へ（多数決で戻り先を決めるため）
  W(0x50,0x00000000); W(0x51,0x08006448); W(0x52,0x00000000);
  W(0x53,0x08006448); W(0x54,0x00000000); W(0x55,0x08006448);
  W(0x60,0x80019100); W(0x61,0x80019110); W(0x62,0x80019120);
  const addrs=[0x80019100,0x80019110,0x80019140,0x80019148,0x80019150];
  const marks={0x800CC910:"行列の積み"};

  // 0 を「小さい値」に数えて、0が並ぶだけのファイルを拾っていた
  const mkw=a=>{ const u=new Uint8Array(a.length*4), d=new DataView(u.buffer);
    a.forEach((v,i)=>d.setUint32(i*4,v>>>0,true)); return u };
}

{
  // ＋と−の両方あるだけでは、積み下ろしか、一方向に進んで最後に戻すだけかが
  // 区別できない。か所の数で見分ける
  const mk=(up,dn)=>({addr:1,steps:[-32,32],n:up+dn,
    bySt:[{step:32,n:up,ats:[1,2,3]},{step:-32,n:dn,ats:[9]}]});
  // 場所の数で積み下ろしかどうかを決めない。
  // 輪の中で毎回進めて抜けるときに1回戻す形でも、場所の数は 1対1 になる
}

{
  // 行列らしさの見分け。回転の3行の長さがそろい、直交していれば行列
  const RAM=0x200000, buf=new Uint8Array(RAM), dv=new DataView(buf.buffer);
  const w16=(a,k,v)=>dv.setInt16((a&0x1fffff)+k*2,v,true);
  const w32=(a,o,v)=>dv.setInt32((a&0x1fffff)+o,v,true);
  const setM=(a,r,t)=>{ r.forEach((v,k)=>w16(a,k,v)); w16(a,9,0);
    (t||[0,0,0]).forEach((v,k)=>w32(a,20+k*4,v)) };
  const M=memReader(buf,0);
  const A=0x80100000;
  setM(A,[4096,0,0, 0,4096,0, 0,0,4096]);
  // 実物から出てきたもの：X を 0.8 倍、Y と Z を反転
  setM(A+32,[3276,0,0, 0,-4096,0, 0,0,-4096],[0,1331,4096]);
  setM(A+64,[0,0,0, 0,0,0, 0,0,0]);
  setM(A+96,[10157,0,59, 0,18572,-32749, 7193,0,19]);
  setM(A+128,[0,0,16896, 0,0,0, 0,0,0]);

  // 続いている所を見つける。骨の並びはここにあるはず
  const B=0x80120000;
  for(let k=0;k<24;k++) setM(B+k*32,[4096,0,0, 0,4096,0, 0,0,4096],[k*10,0,0]);
}

{
  // 間隔を 32 と決めつけない。骨の構造体に埋まっていると 48 や 64 になる
  const buf=new Uint8Array(0x8000), dv=new DataView(buf.buffer);
  const setM=(off,r,t)=>{ r.forEach((v,k)=>dv.setInt16(off+k*2,v,true));
    dv.setInt16(off+18,0,true);
    (t||[0,0,0]).forEach((v,k)=>dv.setInt32(off+20+k*4,v,true)) };
  // 間隔48で24個。あいだの16バイトは角度とずれのつもり
  const A=0x1000, S=48;
  for(let k=0;k<24;k++){
    const a=(k*7)%360*Math.PI/180, c=Math.round(4096*Math.cos(a)), n=Math.round(4096*Math.sin(a));
    setM(A+k*S,[c,0,n, 0,4096,0, -n,0,c],[k*13,k*5,0]);
    for(let j=32;j<S;j++) buf[A+k*S+j]=(k*j)&0xff;
  }
}

{
  // 滑らかに増えるだけの数値表を、行列の並びとして拾わないこと。
  // 実物では 350,351,352… という表が「550個続く並び」として先頭に出ていた
  const buf=new Uint8Array(0x6000), dv=new DataView(buf.buffer);
  for(let k=0;k<400;k++){ const o=0x100+k*32;
    for(let i=0;i<9;i++) dv.setInt16(o+i*2,350+k+i,true);
    for(let i=0;i<3;i++) dv.setInt32(o+20+i*4,23331171+k*1000,true); }

  // 人の形をしているか。実物の値をそのまま入れる
  const b2=new Uint8Array(0x2000), d2=new DataView(b2.buffer);
  // 実物の24個をそのまま（0x801EFB24 から）
  const T=[[-1024,1097,0],[-1024,1097,0],[-1077,861,-144],[-997,472,-360],
           [-1297,120,-365],[-1197,28,-453],[-972,862,144],[-684,574,337],
           [-789,125,350],[-660,32,380],[-1024,1097,0],[-734,1511,0],
           [-873,1481,-326],[-1051,1244,-378],[-852,1052,-493],[-701,1391,322],
           [-770,1113,409],[-487,1109,500],[-1024,1097,0],[-734,1511,0],
           [-1077,861,-144],[-972,862,144],[-997,472,-360],[-684,574,337]];
  T.forEach((t,k)=>{ const o=k*32;
    [4096,0,0,0,4096,0,0,0,4096].forEach((v,i)=>d2.setInt16(o+i*2,v,true));
    t.forEach((v,i)=>d2.setInt32(o+20+i*4,v,true)); });
  // 縦に長いだけで左右の対が無いもの（別の空間に移したほう）は、そう言わない
  const b3=new Uint8Array(0x2000), d3=new DataView(b3.buffer);
  T.forEach((t,k)=>{ const o=k*32;
    [4096,0,0,0,4096,0,0,0,4096].forEach((v,i)=>d3.setInt16(o+i*2,v,true));
    [t[0],t[1],4000+k].forEach((v,i)=>d3.setInt32(o+20+i*4,v,true)); });
}

{
  // 表Bをたどって本物の骨を取り出す。実物と同じ形に作る：
  //   表B は命令5が進めたぶん先を指していて、並びは 0 で終わる
  const RAM=0x200000, buf=new Uint8Array(RAM), dv=new DataView(buf.buffer);
  const off=a=>a&0x1fffff;
  const putM=(a,r,t)=>{ r.forEach((v,k)=>dv.setInt16(off(a)+k*2,v,true));
    dv.setInt16(off(a)+18,0,true);
    t.forEach((v,k)=>dv.setInt32(off(a)+20+k*4,v,true)) };
  const TBL=0x80120000, M0=0x80130000, N=12;
  for(let k=0;k<N;k++){
    const a=M0+k*32, th=k*0.4, c=Math.round(4096*Math.cos(th)), s2=Math.round(4096*Math.sin(th));
    // 1行目を 0.8倍にする（実物がそうだった）
    putM(a,[Math.round(c*0.8),0,Math.round(s2*0.8), 0,4096,0, -s2,0,c],[k*10,k*100,4000]);
    // 3の倍数の所は「枝の付け根」に戻す＝同じ行列を指す
    dv.setUint32(off(TBL+k*4), (k%4===0?M0:a)>>>0, true);
  }
  dv.setUint32(off(TBL+N*4),0,true);                 // 終端
  dv.setUint32(off(0x800CBE8C),(TBL+3*4)>>>0,true);  // 命令5が3個ぶん進めたところ
  ok("  1行目が0.8倍でも骨と見る（実物がそう）",
     !!memBoneMatrix(memReader(buf,0),M0+32), "");
  // 表Bが0なら、取れないとはっきり言う
  dv.setUint32(off(0x800CBE8C),0,true);
}


{
  // 表Bを番号の列に直し、カメラを掛ける前の並びに当てる。
  // 実物では、表Bのポインタが 0x801F0A84 から32バイト刻みに全部乗り、
  // その番号を 0x801EFB24 に当てると立っている人の姿になった
  const RAM=0x200000, buf=new Uint8Array(RAM), dv=new DataView(buf.buffer);
  const off=a=>a&0x1fffff;
  const putM=(a,r,t)=>{ r.forEach((v,k)=>dv.setInt16(off(a)+k*2,v,true));
    dv.setInt16(off(a)+18,0,true);
    t.forEach((v,k)=>dv.setInt32(off(a)+20+k*4,v,true)) };
  const WORLD=0x80130000, VIEW=WORLD+123*32, TBL=0x80120000;
  // 人の形（足が下、頭が上、左右に対）をワールド側に、
  // カメラ側は Y を裏返して Z を 4000 ずらしたもの
  const T=[[-1024,1112,0],[-1077,876,-144],[-1007,481,-354],[-1297,120,-364],
           [-1197,28,-452],[-972,877,144],[-696,575,331],[-791,124,349],
           [-662,31,379],[-871,1508,-324],[-1047,1274,-385],[-698,1419,318],
           [-777,1153,429],[-530,1300,-100],[-530,1300,100],[-600,900,-200]];
  T.forEach((t,i)=>{
    const rot=[3276,0,0, 0,4096,0, 0,0,4096];
    putM(WORLD+i*32,rot,t);
    putM(VIEW +i*32,rot,[t[0],1500-t[1],4000+t[2]]);   // カメラ側＝Y裏返し＋奥へ
  });
  const ORDER=[0,9,1,0,2,3,4,5,6,7,8,10,11,12,13,14,15,0];
  ORDER.forEach((i,k)=>dv.setUint32(off(TBL+k*4),(VIEW+i*32)>>>0,true));
  dv.setUint32(off(TBL+ORDER.length*4),0,true);
  dv.setUint32(off(0x800CBE8C),(TBL+2*4)>>>0,true);     // 命令5が2個進めた所

}

{
  // 表Cから手前へ 0x90000000 を探して、描かれているモデルを決める。
  // 見つけただけでは決めず、「先頭＋語1（offset0）＝表Cの1つ目」まで確かめる
  const RAM=0x200000, buf=new Uint8Array(RAM), dv=new DataView(buf.buffer);
  const off=a=>a&0x1fffff, W=(a,v)=>dv.setUint32(off(a),v>>>0,true);
  const MODEL=0x80107000, OFF0=0x3C, TC=0x80140000;
  W(MODEL,0x90000000); W(MODEL+4,OFF0);
  [4,0x6320,0x6740,0x6B60,0x6F80,4].forEach((v,k)=>W(MODEL+8+k*4,v));
  W(TC,MODEL+OFF0);
  W(0x800CBE94,TC);
  // 手前に、つじつまの合わない署名も置いておく（そちらを拾ってはいけない）
  W(MODEL+0x20,0x90000000); W(MODEL+0x24,0x99);
  // ディスクのファイルと突き合わせる
  W(0x800CBE94,0);
}

{
  // 当てる先の候補に「表Bの最小 − 0xF60」が入り、それが人の形なら、それを使う。
  // 点数だけで選ぶと、もう一人（2P）の並びが勝つことがある（実測でそうなった）
  const RAM=0x200000, buf=new Uint8Array(RAM), dv=new DataView(buf.buffer);
  const off=a=>a&0x1fffff;
  const putM=(a,r,t)=>{ r.forEach((v,k)=>dv.setInt16(off(a)+k*2,v,true));
    dv.setInt16(off(a)+18,0,true);
    t.forEach((v,k)=>dv.setInt32(off(a)+20+k*4,v,true)) };
  const VIEW=0x80130000, HOME=VIEW-0xF60, OTHER=0x80160000, TBL=0x80120000;
  const T=[[-1024,1112,0],[-1077,876,-144],[-1007,481,-354],[-1297,120,-364],
           [-1197,28,-452],[-972,877,144],[-696,575,331],[-791,124,349],
           [-662,31,379],[-871,1508,-324],[-1047,1274,-385],[-698,1419,318],
           [-777,1153,429],[-530,1300,-100],[-530,1300,100],[-600,900,-200]];
  const rot=[3276,0,0, 0,4096,0, 0,0,4096];
  T.forEach((t,i)=>{
    putM(VIEW +i*32,rot,[t[0],1500-t[1],4000+t[2]]);
    putM(HOME +i*32,rot,t);                       // 同じキャラのワールド側
    putM(OTHER+i*32,rot,[t[0]+2000,t[1],t[2]]);   // もう一人（形は同じ、位置だけ違う）
  });
  const ORDER=[0,9,1,0,2,3,4,5,6,7,8,10,11,12,13,14,15,0];
  ORDER.forEach((i,k)=>dv.setUint32(off(TBL+k*4),(VIEW+i*32)>>>0,true));
  dv.setUint32(off(TBL+ORDER.length*4),0,true);
  dv.setUint32(off(0x800CBE8C),(TBL+2*4)>>>0,true);
}

console.log("\n[44] 写しの中からモデルそのものを取り出す");
{
  // 2人ぶんの入れものを、実測どおり 0x1E48 の間隔で組み立てる
  const buf=new Uint8Array(0x200000);
  const dv=new DataView(buf.buffer);
  const off=a=>(a>>>0)&0x1fffff;
  const w=(a,v)=>dv.setUint32(off(a),v>>>0,true);
  const I3=[4096,0,0, 0,4096,0, 0,0,4096];
  const putM=(a,t)=>{ for(let i=0;i<9;i++) dv.setInt16(off(a)+i*2,I3[i],true);
    dv.setInt16(off(a)+18,0,true);
    for(let i=0;i<3;i++) dv.setInt32(off(a)+20+i*4,t[i],true) };
  // ちいさなモデルを作る。本体は命令5を n 回だけ呼ぶ
  const mkModel=(at,n,slots)=>{
    w(at,0x90000000); w(at+4,0x3c);
    let p=at+8;
    for(const g of slots){ w(p,g.length); p+=4; for(const o of g){ w(p,o); p+=4 } }
    // 部品のヘッダ（面/頂点/法線/色）。中身は空でも「枠だけ」ではなくする
    const hdr=(b,f)=>{ w(b,f); w(b+4,0x20); w(b+8,f); w(b+12,f+4) };
    hdr(at+0x3c,0x100);
    for(const g of slots) for(const o of g) hdr(at+o,0x40);
    // 本体の命令の列: 命令5 を n 回、そのあと 0
    let q=at+0x3c+0x10;
    for(let k=0;k<n;k++){ w(q,5); q+=4 }
    w(q,0);
  };
  const M1=0x80100000, M2=0x80120000;
  mkModel(M1,5,[[0x1000,0x1400,0x1800,0x1c00]]);
  mkModel(M2,3,[[0x1000,0x1400]]);
  // 骨の並びと、表B・表C
  const V1=0x801F0A80, V2=V1+0x2000;
  for(let i=0;i<8;i++){ putM(V1+i*32,[0,i*100,0]); putM(V2+i*32,[500,i*100,0]) }
  const B1=0x801F0480, C1=0x801F0680;
  const B2=B1+0x1E48,  C2=C1+0x1E48;
  // 表Bは、本体の命令5の回数より長く置く（行き過ぎるかどうかを見る）
  for(let k=0;k<8;k++) w(B1+k*4,V1+(k%8)*32);
  for(let k=0;k<8;k++) w(B2+k*4,V2+(k%8)*32);
  w(C1,M1+0x3c); w(C2,M2+0x3c);
  w(0x800CBE8C,B1); w(0x800CBE94,C1);
  const cs=memCharacters(buf,0);
  ok("写しの中の人を2人とも見つける", cs.length===2, cs.length);
  ok("  1人目のモデルの先頭を当てる", cs[0]&&cs[0].model.at===M1, cs[0]&&"0x"+cs[0].model.at.toString(16));
  ok("  2人目は 0x1E48 先の表から見つける", cs[1]&&cs[1].model.at===M2, cs[1]&&"0x"+cs[1].model.at.toString(16));
  ok("  本体の命令5を数える（5回・3回）", cs[0]&&cs[0].cmd5===5&&cs[1]&&cs[1].cmd5===3,
     cs.map(c=>c.cmd5).join(","));
  ok("  骨の数を命令5の回数で止める（行き過ぎない）",
     cs[0]&&cs[0].bones.list.length===5&&cs[1]&&cs[1].bones.list.length===3,
     cs.map(c=>c.bones.list.length).join(","));
  ok("  モデルの長さを次の署名まででとる", cs[0]&&cs[0].model.len===(M2-M1), cs[0]&&cs[0].model.len);
  const L=memCharLines(cs).join("\n");
  ok("  行に「命令5の回数と一致」と出る", /命令5の回数と一致/.test(L), L.slice(0,200));
  ok("  間隔 0x1E48 を行に出す", /1E48/.test(L), L.slice(0,120));
  ok("  表Cが指していないと、人は見つからない",
     (()=>{ const b2=buf.slice(); new DataView(b2.buffer).setUint32(0x0CBE94,0,true);
            return memCharacters(b2,0).length===0 })(), "");

  // 表を指す語が 0 でも、いつもの場所に表があれば読む（dump4 がそうだった）
  { const b3=new Uint8Array(buf.length), v3=new DataView(b3.buffer);
    b3.set(buf); v3.setUint32(0x0CBE8C,0,true); v3.setUint32(0x0CBE94,0,true);
    const s=MEM_T1_TABLE_B-B1;   // 表をいつもの場所へずらして置き直す
    for(let k=0;k<8;k++){ v3.setUint32((B1+s+k*4)&0x1fffff,V1+(k%8)*32,true); v3.setUint32((B2+s+k*4)&0x1fffff,V2+(k%8)*32,true) }
    v3.setUint32((MEM_T1_TABLE_C)&0x1fffff,M1+0x3c,true); v3.setUint32((MEM_T1_TABLE_C+0x1E48)&0x1fffff,M2+0x3c,true);
    const c3=memCharacters(b3,0);
    ok("  表を指す語が 0 でも、いつもの場所の表を読む", c3.length===2&&c3.fixed&&c3[0].model.at===M1, c3.length);
    ok("    そう読んだことを行に出す", /直に読んだ/.test(memCharLines(c3).join("\n")), ""); }
}

console.log("\n[45] 差し替えの組から、出すものを選ぶ");
{
  // 組1 は「貼りもの」（面が全部テクスチャ）、組2 は手（べた塗りの面）とする
  const decal=n=>({faces:Array.from({length:n},()=>({op:13,idx:[0,1,2,3]}))});
  const hand =n=>({faces:Array.from({length:n},()=>({op:9,idx:[0,1,2,3]}))});
  const mk=(g,base,run)=>({base,group:g,ok:true,run});
  const objs=[mk(1,100,decal(4)),mk(1,200,decal(4)),mk(1,300,decal(4)),mk(1,400,decal(4)),
              mk(2,500,hand(9)),mk(2,600,hand(9)),mk(0,10,hand(20))];
  const body=t1PickParts(objs,-1);
  ok("「出さない」なら本体だけ", body.length===1&&body[0].base===10, body.map(o=>o.base).join(","));
  const one=t1PickParts(objs,0);
  ok("  既定は各組から1つずつ（本体には手が無いので、手の組も出す）",
     one.length===3&&one[1].base===100&&one[2].base===500, one.map(o=>o.base).join(","));
  const two=t1PickParts(objs,1);
  ok("  番号を変えると、別のものになる", two[1].base===200&&two[2].base===600, two.map(o=>o.base).join(","));
  const big=t1PickParts(objs,9);
  ok("  組より大きい番号でも、はみ出さない", big[1].base===400&&big[2].base===600, big.map(o=>o.base).join(","));
  const dec=t1PickParts(objs,-2);
  ok("  -2 なら貼りものだけ（手は出さない）", dec.length===2&&dec[1].base===100, dec.map(o=>o.base).join(","));
  const old=t1PickParts(objs,101);
  ok("  前の版の値（100以上）は 100 を引いて読む", old.length===3&&old[1].base===200, old.map(o=>o.base).join(","));
  ok("  組が付いていなければ、そのまま返す",
     t1PickParts([{base:1,ok:true},{base:2,ok:true}],-1).length===2, "");
}

console.log("\n[46] RAM の先頭を、確かめてから決める");
{
  const buf=new Uint8Array(0x200000);
  const dv=new DataView(buf.buffer);
  const w=(a,v)=>dv.setUint32((a>>>0)&0x1fffff,v>>>0,true);
  const at=0x80100000;
  w(at,0x90000000); w(at+4,0x3c); w(at+8,0);
  w(at+0x3c,0x100); w(at+0x40,0x20); w(at+0x44,0x100); w(at+0x48,0x104);
  w(at+0x3c+0x10,0);
  w(0x801F0480,0); w(0x800CBE8C,0x801F0480); w(0x800CBE94,0x801F0680);
  w(0x801F0680,at+0x3c);
  const p=memPickBase(buf,null);
  ok("確かめが通った位置を選ぶ", p.ok&&p.base===0, JSON.stringify({ok:p.ok,base:p.base}));
  ok("  選んだ理由を返す", /登場人物/.test(p.why), p.why);
  const empty=memPickBase(new Uint8Array(0x200000),null);
  ok("  空の写しでは 0 を使わない（見つからないと言う）", empty.base===-1&&!empty.ok,
     JSON.stringify({ok:empty.ok,base:empty.base}));
}

console.log("\n[47] 区切りごとの回転の中心 B");
{
  // 頂点4個を2つの区切りに分けて置く
  const d=new Uint8Array(256);
  const dv=new DataView(d.buffer);
  const vert=64;
  const put=(k,x,y,z)=>{ dv.setInt16(vert+k*8,x,true); dv.setInt16(vert+k*8+2,y,true); dv.setInt16(vert+k*8+4,z,true) };
  put(0,100,0,0); put(1,140,0,0);       // 区切り1
  put(2,300,10,-10); put(3,340,30,10);  // 区切り2
  const o={base:0,vertPtr:vert,run:{vseg:[1,1,2,2]}};
  const box=t1BoneOrigins(d,o,"box");
  ok("箱の中心を区切りごとに出す",
     box.get(1).join()==="120,0,0"&&box.get(2).join()==="320,20,0",
     JSON.stringify([box.get(1),box.get(2)]));
  const cent=t1BoneOrigins(d,Object.assign({},o),"cent");
  ok("  重心も出せる", cent.get(1).join()==="120,0,0"&&cent.get(2).join()==="320,20,0",
     JSON.stringify([cent.get(1),cent.get(2)]));
  ok("  none なら何も返さない", t1BoneOrigins(d,Object.assign({},o),"none")===null, "");
  ok("  区切りが無ければ何も返さない",
     t1BoneOrigins(d,{base:0,vertPtr:vert,run:{}},"box")===null, "");
  // 同じ結果を覚えて返す（毎回測り直さない）
  const o2={base:0,vertPtr:vert,run:{vseg:[1,1,2,2]}};
  ok("  2度目は同じものを返す", t1BoneOrigins(d,o2,"box")===t1BoneOrigins(d,o2,"box"), "");
  ok("  引き方を変えたら測り直す", t1BoneOrigins(d,o2,"cent")!==t1BoneOrigins(d,o2,"box"), "");
}

console.log("\n[48] 色は面の命令ごとに並びが違う");
{
  ok("命令9 は1枚あたり1語（べた塗り）", t1ColWords(9,4)===1, t1ColWords(9,4));
  ok("  命令8 も1語", t1ColWords(8,3)===1, t1ColWords(8,3));
  ok("  命令12・13 は4語（基準1＋角3）", t1ColWords(12,3)===4&&t1ColWords(13,3)===4, "");
  ok("  分かっていない命令は 角+1 を当てにいく", t1ColWords(99,4)===5, t1ColWords(99,4));
  // 小さい部品の実測: 命令9 が 27枚 → 27語 = 108B
  const run9={faces:Array.from({length:27},()=>({op:9,idx:[0,1,2,3]}))};
  const p9=t1ColorPlan(run9);
  ok("命令9×27枚 で 27語（実測の 108B と合う）", p9.words===27&&p9.words*4===108, p9.words);
  // 1P 本体の実測: 8×326 9×359 12×2 13×19 → 3076B
  const mk=(op,n,c)=>Array.from({length:n},()=>({op,idx:Array.from({length:c},(_,i)=>i)}));
  const body={faces:[...mk(8,326,3),...mk(9,359,4),...mk(12,2,3),...mk(13,19,3)]};
  const pb=t1ColorPlan(body);
  ok("1P 本体が 3076B にぴったり合う", pb.words*4===3076, pb.words*4);
  // 位置は面の順に積み上がる
  const two={faces:[{op:9,idx:[0,1,2]},{op:13,idx:[0,1,2]},{op:8,idx:[0,1,2]}]};
  const pt=t1ColorPlan(two);
  ok("  語の位置が面の順に積み上がる",
     pt.at[0].at===0&&pt.at[1].at===1&&pt.at[2].at===5, pt.at.map(x=>x.at).join(","));
  ok("  語数も面ごとに控える", pt.at[1].w===4&&pt.at[2].w===1, "");
  ok("  面が無ければ何も返さない", t1ColorPlan(null)===null&&t1ColorPlan({})===null, "");
}

console.log("\n[49] 命令12・13 の正体");
{
  ok("命令13 は四角（三角ではない）", T1_FACE_OP[13].n===4&&T1_FACE_OP[13].size===24, JSON.stringify(T1_FACE_OP[13]));
  ok("  命令13 は法線を持つ", T1_FACE_OP[13].nrm===true, "");
  ok("  命令12 は三角のまま", T1_FACE_OP[12].n===3&&T1_FACE_OP[12].size===20, JSON.stringify(T1_FACE_OP[12]));
  ok("  どちらもテクスチャ付きと覚える", T1_COL_TEX[12]&&T1_COL_TEX[13], "");
  // テクスチャ付きの面は、色の語0だけを使う（語1以降は u,v）
  const run={faces:[{op:13,idx:[0,1,2,3]},{op:8,idx:[0,1,2]}]};
  const pl=t1ColorPlan(run);
  ok("テクスチャ付きの印が計画に乗る", pl.at[0].tex===true&&pl.at[1].tex===false,
     JSON.stringify([pl.at[0].tex,pl.at[1].tex]));
  ok("  語数は 4 と 1", pl.at[0].w===4&&pl.at[1].w===1, "");
  ok("  合計は5語", pl.words===5, pl.words);
}

console.log("\n[50] 色の語は命令の列を歩いて数える");
{
  // 命令2 は「頂点を入れる」だけでなく、頂点1つにつき色を1語使う。
  // 命令10・11 は自分の色を持たず、その頂点ごとの色を使う
  const run={colWords:12,
    vcolAt:{5:0,6:1,7:2},
    faces:[{op:8,idx:[0,1,2],cAt:3,cW:1},
           {op:10,idx:[5,6,7],cAt:-1,cW:0},
           {op:13,idx:[0,1,2,3],cAt:4,cW:4}]};
  const pl=t1ColorPlan(run);
  ok("t1Run が数えた位置をそのまま使う", pl.words===12, pl.words);
  ok("  色を持たない面に印が付く", pl.at[1].vert===true&&pl.at[1].w===0, JSON.stringify(pl.at[1]));
  ok("  べた塗りの面は1語", pl.at[0].w===1&&pl.at[0].at===3, JSON.stringify(pl.at[0]));
  ok("  テクスチャの面は4語", pl.at[2].w===4&&pl.at[2].tex===true, JSON.stringify(pl.at[2]));
  ok("  頂点ごとの色の位置も渡す", pl.vcolAt&&pl.vcolAt[6]===1, JSON.stringify(pl.vcolAt));
  // 数えたものが無ければ、今までの数え方に落ちる
  const old=t1ColorPlan({faces:[{op:9,idx:[0,1,2,3]},{op:13,idx:[0,1,2,3]}]});
  ok("  数えたものが無ければ、面だけで数える", old.words===5, old.words);
}

console.log("\n[51] 名前の札");
{
  ok("9742 はイール・ゴガ（実機と突き合わせて確定）", t1NameOf(9742)==="イール・ゴガ", t1NameOf(9742));
  ok("  9728 はその別衣装（同じ組・同じ区切り41）", t1NameOf(9728)==="イール・ゴガ（別衣装）", t1NameOf(9728));
  ok("  9223/9237 の推測は ？ に戻した",
     /^？/.test(t1NameOf(9223))&&/^？/.test(t1NameOf(9237)), t1NameOf(9223)+" / "+t1NameOf(9237));
  ok("  確定している札はそのまま", t1NameOf(8850)==="チュージ"&&t1NameOf(9383)==="ムーフー", "");
  ok("  知らない sector は空", t1NameOf(1)==="", t1NameOf(1));
}

console.log("\n[52] 差し替えの部品を、どの骨に付けるか");
{
  // 部品の頂点は、付く骨の区切りと同じ骨の座標で書かれている。
  // 区切り1 と 区切り9 を、どちらも原点のまわりに置く（箱の中心は同じくらい）。
  // 部品は区切り9 の端の頂点に重なる
  const d=new Uint8Array(512);
  const dv=new DataView(d.buffer);
  const put=(base,k,x,y,z)=>{ dv.setInt16(base+k*8,x,true); dv.setInt16(base+k*8+2,y,true);
                              dv.setInt16(base+k*8+4,z,true) };
  const bodyV=64, faceV=200;
  put(bodyV,0,-100,0,0); put(bodyV,1,100,0,0);    // 区切り1: X に長い
  put(bodyV,2,0,-30,120); put(bodyV,3,0,30,120);    // 区切り9: Z の側に短い輪
  put(faceV,0,1,-29,121); put(faceV,1,60,0,0);    // 1点目が区切り9 の頂点に重なる
  put(faceV,2,1,29,119);  put(faceV,3,90,0,-20);
  const body={base:0,vertPtr:bodyV,nv:4,group:0,run:{vseg:[1,1,9,9]}};
  const part={base:100,vertPtr:faceV-100,nv:4,group:1,run:{vseg:[1,1,1,1]}};
  const at=t1SlotAttach(d,[body,part]);
  ok("差し替えの部品を、頂点が重なる区切りに付ける", at&&at.get(100)===9, at?at.get(100):"null");
  // 箱の中心で選ぶと区切り1 になる（前の版の間違い）ことを確かめておく
  const mid=(a,b)=>(a+b)/2;
  const cPart=[mid(1,90),0,mid(-20,121)], c1=[0,0,0], c9=[0,0,120];
  const dd=(p,q)=>Math.hypot(p[0]-q[0],p[1]-q[1],p[2]-q[2]);
  ok("  （箱の中心なら区切り1 を選んでしまう配置になっている）", dd(cPart,c1)<dd(cPart,c9), `${dd(cPart,c1).toFixed(0)} vs ${dd(cPart,c9).toFixed(0)}`);
  // 区切り1 の頂点に重ねると、そちらに付く
  put(faceV,0,-99,1,0); put(faceV,1,-60,0,5); put(faceV,2,99,-1,0); put(faceV,3,60,0,5);
  const at2=t1SlotAttach(d,[body,Object.assign({},part)]);
  ok("  重なる所を変えると、付く区切りも変わる", at2&&at2.get(100)===1, at2?at2.get(100):"null");
  ok("  本体が無ければ何も返さない", t1SlotAttach(d,[Object.assign({},part)])===null, "");
  ok("  差し替えの部品が無ければ何も返さない", t1SlotAttach(d,[body])===null, "");
}

console.log("\n[53] 色の入っていない部品／合わない写しの骨");
{
  // 色の欄が全部 0 の部品は「色が無い」。1語でも違えば色がある
  const d=new Uint8Array(64);
  const o={base:0,colPtr:16};
  ok("色の欄が全部 0 なら、色が入っていない", t1ColorBlank(d,o,[])===true, "");
  d[40]=0x80;
  ok("  1語でも違えば、色がある", t1ColorBlank(d,o,[])===false, "");
  ok("  違う語が次の部品より後ろなら、見ない", t1ColorBlank(d,o,[40])===true, "");
  // 写しの骨の本数と、本体の命令5 の回数が合わなければ外す
  const m=new Uint8Array(64), mv=new DataView(m.buffer);
  mv.setUint32(0x10,5,true); mv.setUint32(0x14,5,true); mv.setUint32(0x18,0,true);   // 命令5 を2回
  const bone={m:[4096,0,0,0,4096,0,0,0,4096],t:[0,0,0]};
  const info={};
  t1SetBones([bone,bone,bone],true); state.t1BoneKeep=null;
  t1BonesFit(m,[{base:0,nv:4,group:0}],info);
  ok("骨3本・命令5が2回なら、骨を外す", T1_BONES===null&&!T1_BONES_REAL&&state.t1BoneKeep===true, String(T1_BONES&&T1_BONES.length));
  ok("  外した理由を出す", /3本は当てていません.*2回/.test(info.t1BoneSkip||""), info.t1BoneSkip);
  const info2={};
  t1SetBones([bone,bone],true); state.t1BoneKeep=null;
  t1BonesFit(m,[{base:0,nv:4,group:0}],info2);
  ok("  本数が合えば当てたまま", T1_BONES&&T1_BONES.length===2&&!info2.t1BoneSkip, "");
  t1SetBones(null,false); state.t1BoneKeep=null;
}

console.log("\n[54] 命令14・15（法線の無いテクスチャの面）");
{
  // 命令2 で頂点を3つ（頂点ごとの色つき）→ 命令14 で三角1枚。色の語は 3（頂点）＋3（u,v）
  const e=new Uint8Array(0x80), v=new DataView(e.buffer);
  const put=(o,vals)=>vals.forEach((x,i)=>v.setUint32(o+i*4,x>>>0,true));
  put(0,[0x58,0x40,0x58,0x64]);                  // 面・頂点・法線・色の位置
  put(0x10,[2,0,3,0, 14,1, 0]);                   // 命令2（置き場所0から3個）、命令14 を1枚
  [[0,0,0],[100,0,0],[0,100,0]].forEach((p,i)=>{ v.setInt16(0x40+i*8,p[0],true); v.setInt16(0x42+i*8,p[1],true); v.setInt16(0x44+i*8,p[2],true) });
  put(0x58,[0,4,8]);                              // 三角（頂点番号は4倍）
  const R=t1Run(e,0);
  ok("命令14 を三角 12B として読む", !!R&&R.faces.length===1&&R.faces[0].idx.length===3, R?R.faces.length:t1RunWhy);
  const pl=R&&t1ColorPlan(R);
  ok("  色の語は 頂点3 ＋ u,v 3 ＝ 6語", pl&&pl.words===6, pl&&pl.words);
  ok("  u,v だけの面（色は頂点ごと）と分かる", pl&&pl.at[0].tex&&pl.at[0].uvOnly&&pl.at[0].at===3, pl&&JSON.stringify(pl.at[0]));
  ok("  命令15 は四角 16B", T1_FACE_OP[15]&&T1_FACE_OP[15].size===16&&T1_FACE_OP[15].n===4, "");
}

console.log("\n[55] 最初に正面を向ける");
{
  const I={m:[4096,0,0,0,4096,0,0,0,4096],t:[0,0,0]};
  const Y180={m:[-4096,0,0,0,4096,0,0,0,-4096],t:[0,0,0]};
  ok("回転なしの骨0 なら、正面は +Z と +Y の間（yaw = π/2）", Math.abs(t1FrontYaw([I])-Math.PI/2)<1e-6, t1FrontYaw([I]));
  ok("  Y まわりに半回転すると、反対を向く", Math.abs(t1FrontYaw([Y180])+Math.PI/2)<1e-6, t1FrontYaw([Y180]));
  ok("  骨が無ければ決めない", t1FrontYaw(null)===null, "");
}

console.log("\n[56] 骨の組は回転かどうかで決める（ポーズでは決めない）");
{
  const I={m:[4096,0,0,0,4096,0,0,0,4096],t:[0,300,0]}, bad={m:[900,0,0,0,4096,0,0,0,4096],t:[0,0,0]};
  ok("回転の行列なら通す（横になっていて背が低くても）", memRotOk([I,I,I]), "");
  ok("  長さが 1.0 から外れた行があれば通さない", !memRotOk([I,bad]), "");
  ok("  空なら通さない", !memRotOk([]), "");
}

console.log("\n[57] 3Dプリント用に閉じた形を作る");
{
  // 三角形の並び（画面の層と同じ形）を作る
  const mk=(quads)=>{ const pos=[];
    for(const q of quads){ pos.push(...q[0],...q[1],...q[2],...q[0],...q[2],...q[3]) }
    const n=pos.length/3; return {pos:new Float32Array(pos),col:new Float32Array(n*3).fill(0.5),t0:new Float32Array(n*3),t1:new Float32Array(n*4),vram:null} };
  const box=(x,y,z,w,h,d,top=true)=>{ const X=x+w,Y=y+h,Z=z+d; const q=[
    [[x,y,z],[X,y,z],[X,y,Z],[x,y,Z]],[[x,y,z],[x,Y,z],[X,Y,z],[X,y,z]],[[x,y,Z],[X,y,Z],[X,Y,Z],[x,Y,Z]],
    [[x,y,z],[x,y,Z],[x,Y,Z],[x,Y,z]],[[X,y,z],[X,Y,z],[X,Y,Z],[X,y,Z]]]; if(top) q.push([[x,Y,z],[x,Y,Z],[X,Y,Z],[X,Y,z]]); return q };
  const run=async(m,o)=>printBuild([m],Object.assign({height:40,res:40,thick:1,base:false},o));
  const a=await run(mk(box(0,0,0,100,100,100,false)));         // 上の面が無い箱（開いている）
  ok("開いた箱でも、閉じた形になる", a.check.closed, JSON.stringify(a.check));
  ok("  体積が正（面が外向き）", a.check.volume>0, a.check.volume);
  ok("  大きく開いた口はふさがず、コップの形のまま（体積は詰まった箱より小さい）", a.check.volume<40*40*40*0.6, Math.round(a.check.volume));
  // 上の面に細い隙間（1%）がある箱：隙間は太らせでふさがり、中まで詰まる
  const gap=box(0,0,0,100,100,100,false); gap.push([[0,100,0],[0,100,100],[99,100,100],[99,100,0]]);
  const g=await run(mk(gap));
  ok("  細い隙間の箱は、中まで詰まる（40mm 角に近い体積）", g.check.closed&&g.check.volume>40*40*40*0.85&&g.check.volume<40*40*40*1.3, Math.round(g.check.volume));
  ok("  塊は1つ", a.parts===1, a.parts);
  const b=await run(mk([[[0,50,0],[100,50,0],[100,50,100],[0,50,100]],[[0,0,0],[1,0,0],[1,100,0],[0,100,0]]]),{thick:2});   // 厚み 0 の板
  ok("厚み 0 の板に厚みが付いて閉じる", b.check.closed&&b.check.volume>0, JSON.stringify(b.check));
  const c=await run(mk([...box(0,0,0,40,100,40),...box(200,0,0,40,100,40)]));   // 離れた2つ
  ok("離れた2つの箱は、塊が2つと数える", c.parts===2&&c.check.closed, c.parts);
  const d=await run(mk([...box(0,0,0,40,100,40),...box(200,0,0,40,100,40)]),{base:true,baseH:3});
  ok("  台座を付けると1つにつながる", d.parts===1&&d.check.closed, d.parts);
  ok("  台座のぶん背が伸びる（40mm ＋ 3mm）", Math.abs(d.size[1]-43)<0.01, d.size[1]);
  const one=await run(mk(box(0,0,0,40,100,40)),{base:true,baseH:3});
  ok("  1つでも台座が升目の端にかからず、閉じている", one.check.closed&&one.parts===1, JSON.stringify(one.check));
  const e=await run(mk(box(0,0,0,100,100,100)),{hollow:true,shell:3,res:60});
  ok("中を空洞にしても閉じている", e.check.closed&&e.hollowed>0, JSON.stringify({closed:e.check.closed,hollowed:e.hollowed}));
  const full=await run(mk(box(0,0,0,100,100,100)),{res:60});
  ok("  空洞にすると体積が減る（閉じた箱と比べて）", e.check.volume<full.check.volume*0.7, `${Math.round(e.check.volume)} / ${Math.round(full.check.volume)}`);
  const stl=printSTL(a), dv=new DataView(stl.buffer);
  ok("STL は 84 + 50×面 バイト", stl.length===84+50*a.check.tris&&dv.getUint32(80,true)===a.check.tris, stl.length);
  const x=print3MFModel(a);
  ok("3MF の中身に単位 mm と色の組がある", /unit="millimeter"/.test(x)&&/<m:colorgroup id="2">/.test(x)&&/<triangle v1=/.test(x), x.slice(0,80));
  const z=await print3MF(a); const zb=new Uint8Array(await z.arrayBuffer());
  ok("3MF は ZIP（PK で始まる）", zb[0]===0x50&&zb[1]===0x4b, zb.slice(0,4));
}

console.log(`\n${pass} ok / ${fail} fail`);
process.exit(fail?1:0);
