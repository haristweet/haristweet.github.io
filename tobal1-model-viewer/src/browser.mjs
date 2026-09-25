import { chromium } from "/opt/node22/lib/node_modules/playwright/index.mjs";
import http from "http"; import fs from "fs"; import path from "path";
const dir=process.cwd();
const types={".html":"text/html",".bin":"application/octet-stream",".js":"text/javascript"};
const srv=http.createServer((req,res)=>{
  const p=path.join(dir,decodeURIComponent(req.url.split("?")[0]));
  if(!fs.existsSync(p)){res.writeHead(404);return res.end()}
  res.writeHead(200,{"content-type":types[path.extname(p)]||"application/octet-stream"});
  fs.createReadStream(p).pipe(res);
});
await new Promise(r=>srv.listen(0,r));
const port=srv.address().port;
const br=await chromium.launch();
const pg=await br.newPage({viewport:{width:1280,height:800}});
const errs=[];
pg.on("pageerror",e=>errs.push("pageerror: "+e.message));
pg.on("console",m=>{ if(m.type()==="error") errs.push("console: "+m.text()) });
await pg.goto(`http://127.0.0.1:${port}/index.html?arc=fixture_arc.bin&exe=fixture_exe.bin`);
await pg.waitForFunction(()=>document.getElementById("files").children.length>0&&document.getElementById("report").value.length>0,null,{timeout:20000});
const out=await pg.evaluate(()=>({
  status:document.getElementById("status").textContent,
  err:document.getElementById("err").textContent,
  count:document.getElementById("file-count").textContent,
  rows:[...document.getElementById("files").children].slice(0,3).map(b=>b.textContent),
  pressed:[...document.getElementById("files").children].filter(b=>b.getAttribute("aria-pressed")==="true").length,
  report:document.getElementById("report").value,
  types:document.getElementById("type-filter").innerHTML,
  gl:!!document.getElementById("gl").getContext("webgl"),
}));
console.log("--- status ---\n"+out.status);
console.log("--- err ---\n"+JSON.stringify(out.err));
console.log("--- file-count ---\n"+out.count+"   選択中の行: "+out.pressed);
console.log("--- rows ---\n"+out.rows.join("\n"));
console.log("--- report ---\n"+out.report);
await pg.screenshot({path:"shot-model.png"});
const px=await pg.evaluate(()=>{ const c=document.getElementById("gl"),g=c.getContext("webgl");
  const n=c.width*c.height, buf=new Uint8Array(n*4); g.readPixels(0,0,c.width,c.height,g.RGBA,g.UNSIGNED_BYTE,buf);
  let opaque=0; for(let i=3;i<buf.length;i+=4) if(buf[i]>8) opaque++;
  return {opaque, ratio:+(opaque/n).toFixed(4)} });
console.log("--- 描かれた画素 ---\n"+JSON.stringify(px));
// 「関節を使わない」に切り替え／種類フィルタ／全部調べる／解析タブ
await pg.click('#rig-seg button[data-v="flat"]');
await pg.waitForTimeout(400);
const s2=await pg.evaluate(()=>document.getElementById("status").textContent);
console.log("--- 関節を使わない ---\n"+s2);
await pg.click("#model-only");
await pg.waitForTimeout(200);
const c2=await pg.evaluate(()=>document.getElementById("file-count").textContent);
console.log("--- しぼり解除 ---\n"+c2);
await pg.click("#scan-all");
await pg.waitForFunction(()=>document.getElementById("scan-all").textContent==="全部のファイルを調べる",null,{timeout:30000});
const after=await pg.evaluate(()=>({types:document.getElementById("type-filter").textContent,report:document.getElementById("report").value.split("\n").filter(l=>l.startsWith("  種類")).join("\n")}));
console.log("--- 全部調べたあと ---\n"+after.types+"\n"+after.report);
// ディスクのファイル側に切り替え
await pg.click('#src-seg button[data-v="iso"]');
await pg.waitForTimeout(600);
console.log("--- ディスクのファイル ---\n"+await pg.evaluate(()=>document.getElementById("file-count").textContent));
// スクショの保存が落ちないか
await pg.click('#src-seg button[data-v="table"]'); await pg.waitForTimeout(600);
await pg.evaluate(()=>document.getElementById("shot").click());
await pg.waitForTimeout(500);
// 報告は既定で短いこと（貼る量・読む量を減らすため）。長い版と比べて確かめる
{ const cmp=await pg.evaluate(async()=>{
    const c=document.getElementById("rep-long"), r=document.getElementById("report");
    c.checked=false; c.dispatchEvent(new Event("change")); const short=r.value.length;
    c.checked=true;  c.dispatchEvent(new Event("change")); const long=r.value.length;
    return {short,long}; });
  console.log(`報告の長さ: 短い ${cmp.short} / 長い ${cmp.long}`);
  console.log("報告を短くできている: "+((cmp.short<cmp.long*0.5&&cmp.short>200)?"ok":"NG")); }
// 「作者に送るまとめ」は報告よりさらに短く、中身は空でないこと
{ const d=await pg.evaluate(()=>{ document.getElementById("copy-digest").click();
    return {txt:digestLines().join("\n"), t1:!!(state.selInfo||{}).t1Color} });
  console.log(`まとめの長さ: ${d.txt.length}文字`);
  // まとめは貼って読めるものであること。
  // 「短くする」と言いながら逆アセンブルを足し続けて 350行まで膨らませた。
  // 行数で見張らないと、また同じことをする
  { const n=d.txt.split("\n").length;
    console.log(`まとめの行数: ${n}行`);
    // いま追っている所の逆アセンブル（部品を組み立てている関数・36行）は
    // わざと入れている。追い終わったら外して 90 行に戻すこと
    console.log("まとめが貼って読める長さ: "+(n<=130?"ok":`NG（${n}行。130行までにする）`)); }
  console.log("まとめが短くて中身がある: "+((d.txt.length>60&&d.txt.length<6000&&/モデルビューア/.test(d.txt))?"ok":"NG"));
  // 足した診断が「まとめ」に実際に届くか。
  // v3.33.0・v3.45.0・v3.69.0 と三度、足した診断がまとめから落ちて届かなかった。
  // 単体の試験は通っていたので、ここで見張る。
  // 試験データはトバル1の道を通らないので、値を入れてから通り道だけを確かめる
  const put=await pg.evaluate(()=>{
    if((state.sel==null||state.sel<0)&&state.entries&&state.entries.length) state.sel=0;
    state.selInfo=state.selInfo||{};
    state.selInfo.t1OpArgs=["  命令4（7回・骨 0..6）","    語1 -120..340 座標らしい7"];
    return {txt:digestLines().join("\n"), sel:state.sel,
            ent:!!(state.entries||[])[state.sel]} });
  console.log("  選択: sel="+put.sel+" 一覧にある="+put.ent);
  const ok1=/まだ意味の分かっていない命令の中身/.test(put.txt)&&/命令4（7回/.test(put.txt);
  console.log("足した診断がまとめまで届く: "+(ok1?"ok":"NG（まとめから落ちている）"));
  // 骨さがしの結果も、まとめのふるいを通ること（四度目の取りこぼしを見張る）
  const bl=await pg.evaluate(()=>{
    state.sieve=state.sieve||{tex:[],vag:[],other:[],broken:[],bones:[],total:0};
    return digestLines().join("\n") });
  console.log("骨さがしの結果がまとめまで届く: "
    +(/骨さがし/.test(bl)?"ok":"NG（まとめから落ちている）"));
  console.log("  握りつぶしていない: "+(/読めなかった: /.test(put.txt)?"NG（例外が出ている）":"ok"));
  console.log("  （実データでの中身は、ディスクを読んだときのまとめで見る"
    +(d.t1?"／この試験データはトバル1の道を通っている":"／この試験データはトバル1の道を通らない")+"）"); }
// ここから先は長い版のまま調べる（一覧の中身を見たいので）
await pg.evaluate(()=>{ const c=document.getElementById("rep-long");
  c.checked=true; c.dispatchEvent(new Event("change")) });
// アーカイブを直接さらう
await pg.click('#src-seg button[data-v="scan"]');
await pg.waitForFunction(()=>document.getElementById("report").value.includes("直接さらった"),null,{timeout:60000});
const sc=await pg.evaluate(()=>({
  count:document.getElementById("file-count").textContent,
  status:document.getElementById("status").textContent,
  rows:[...document.getElementById("files").children].slice(0,2).map(b=>b.textContent),
  lines:document.getElementById("report").value.split("\n").filter(l=>l.includes("さらった")||l.includes("逆算")||l.includes("sector:")).join("\n"),
}));
console.log("--- 直接さらう ---\n"+sc.count+"\n"+sc.status+"\n"+sc.rows.join("\n")+"\n"+sc.lines);
await pg.click('#src-seg button[data-v="table"]'); await pg.waitForTimeout(600);
// 狭い窓（実物で重なりが出た幅）で、上下の重なりが無いか確かめる
await pg.setViewportSize({width:840,height:620});
await pg.waitForTimeout(400);
const lap=await pg.evaluate(()=>{
  const r=el=>{const b=el.getBoundingClientRect();return {l:b.left,t:b.top,r:b.right,b:b.bottom,vis:b.width>0&&getComputedStyle(el).display!=="none"}};
  const over=(a,b)=>a.vis&&b.vis&&a.l<b.r&&b.l<a.r&&a.t<b.b&&b.t<a.b;
  const bgs=r(document.getElementById("bg-box")), shot=r(document.getElementById("shot-box"));
  const st=r(document.getElementById("status")), hint=r(document.getElementById("hint"));
  return {topOverlap:over(bgs,shot), bottomOverlap:over(st,hint), hintShown:hint.vis};
});
console.log("--- 狭い窓での重なり ---\n"+JSON.stringify(lap));
await pg.screenshot({path:"shot-narrow.png"});
// スマホ幅
await pg.setViewportSize({width:390,height:844});
await pg.waitForTimeout(300);
await pg.click('#tabbar button[data-tab="file"]');
await pg.waitForTimeout(300);
await pg.screenshot({path:"shot-mobile.png"});
// 解析済みのディスク（トバル2）だと気づいて知らせるか
const pg2=await br.newPage({viewport:{width:1280,height:800}});
pg2.on("pageerror",e=>errs.push("pageerror(2): "+e.message));
await pg2.goto(`http://127.0.0.1:${port}/index.html?arc=fixture_arc.bin&exe=SLPM_860.33`);
await pg2.waitForFunction(()=>document.getElementById("report").value.length>0,null,{timeout:20000});
const kn=await pg2.evaluate(()=>({
  shown:!document.getElementById("known-note").hidden,
  note:document.getElementById("known-note").textContent,
  head:document.getElementById("report").value.split("\n").filter(l=>l.includes("解析済み")||l.includes("正解")).join("\n"),
  pick:document.getElementById("table-pick").textContent,
}));
console.log("--- 解析済みのディスクの知らせ ---\n出す: "+kn.shown+"\n"+kn.note+"\n"+kn.head+"\n候補: "+kn.pick);
// トバルNo.1 の形のモデルを、ページ側で通しで組めるか
const pg3=await br.newPage({viewport:{width:1280,height:800}});
pg3.on("pageerror",e=>errs.push("pageerror(t1): "+e.message));
pg3.on("console",m=>{ if(m.type()==="error") errs.push("console(t1): "+m.text()) });
await pg3.goto(`http://127.0.0.1:${port}/index.html?arc=fixture_t1_arc.bin&exe=fixture_t1_exe.bin`);
await pg3.waitForFunction(()=>document.getElementById("report").value.length>0,null,{timeout:60000});
const t1=await pg3.evaluate(()=>{
  const c=document.getElementById("gl"), g=c.getContext("webgl");
  const buf=new Uint8Array(c.width*c.height*4);
  g.readPixels(0,0,c.width,c.height,g.RGBA,g.UNSIGNED_BYTE,buf);
  let op=0; for(let i=3;i<buf.length;i+=4) if(buf[i]>8) op++;
  return {status:document.getElementById("status").textContent,
          drawn:op, lines:document.getElementById("report").value.split("\n")
            .filter(l=>l.includes("トバルNo.1 の部品")||l.includes("並び:")||l.includes("部品の内訳")).join("\n")};
});
console.log("--- トバルNo.1 の形を通しで ---\n"+t1.status+"\n描かれた画素: "+t1.drawn+"\n"+t1.lines);
await pg3.screenshot({path:"shot-t1.png"});
// 法線つきの面の読み方が通しで効いているか（部品ごとの数え方の取りこぼしを防ぐ）
{
  // 命令の列として実行できているか。腕の形の部品×3（三角20+四角33 → 86枚ずつ）
  // ＋ 法線つきの部品（命令1・8・9）
  const m=/三角形 ([\d,]+)/.exec(t1.status);
  const tris=m?+m[1].replace(/,/g,""):0;
  const okRun=tris>300&&t1.drawn>1000&&/命令で実行/.test(t1.lines);
  console.log(okRun?`命令として実行: ok（三角形 ${tris}・画素 ${t1.drawn}）`
                   :`命令として実行: NG　${t1.status}　画素 ${t1.drawn}`);
  if(!okRun) errs.push("部品を命令の列として実行できていない");
}
// 同じモデルを2回組み立てて、三角形の数が変わらないこと（読むたびに形が変わらない）
{ const t=await pg3.evaluate(async()=>{
    const e=state.entries[state.sel]; if(!e) return null;
    const raw=await readFull(e);
    const a=buildModel(raw).info.tris, b=buildModel(raw).info.tris;
    return {a,b}; });
  // 実行ファイルの大きさを取り込んでも、形が変わらないこと。
// v3.77.0 は 24バイト＝頂点4＋法線 と決めつけて、三角形の数を変えてしまった。
// バイト数は実行ファイル、頂点の数と法線の持ち方はデータ。混ぜると壊れる
{ const r=await pg.evaluate(()=>{
    const before=state.selInfo&&state.selInfo.tris;
    t1SetExeSizes({8:20,9:24,10:12,11:16,12:20,13:24,14:12,15:16});
    const o=state.t1Objs;
    const after=o?buildT1Mesh(o.d,o.objs).tris:null;
    t1SetExeSizes(null);
    const plain=o?buildT1Mesh(o.d,o.objs).tris:null;
    return {before,after,plain} });
  console.log("実行ファイルの大きさを入れても形が変わらない: "
    +(r.plain==null?"見られない（この試験データにモデルが無い）"
      :r.after===r.plain?`ok（${r.plain}）`:`NG（${r.plain} → ${r.after}）`)); }
console.log("読むたびに形が変わらない: "+(t&&t.a===t.b?"ok":"NG")+(t?`（${t.a} / ${t.b}）`:"（モデル未選択）"));
  if(!t||t.a!==t.b) errs.push("読むたびに形が変わる"); }
// モデルを並べて見る（キャラクターを見分ける道具）が、実際に絵を作れるか
{
  await pg3.click("#mdlgal");
  await pg3.waitForFunction(()=>/並べました|描いています/.test(document.getElementById("mdlnote").textContent),null,{timeout:60000});
  await pg3.waitForFunction(()=>/並べました/.test(document.getElementById("mdlnote").textContent),null,{timeout:120000});
  const gal=await pg3.evaluate(()=>{
    const cvs=[...document.querySelectorAll("#mdlgrid canvas")];
    // 真っ黒（何も描けていない）ではないことを確かめる
    let inked=0;
    for(const c of cvs){
      const d=c.getContext("2d").getImageData(0,0,c.width,c.height).data;
      let on=0; for(let i=3;i<d.length;i+=4) if(d[i]>8) on++;
      if(on>200) inked++;
    }
    return {n:cvs.length,inked,note:document.getElementById("mdlnote").textContent};
  });
  const okGal=gal.n>=1&&gal.inked>=1;
  console.log(okGal?`モデルを並べる: ok（${gal.n}枚・中身のあるもの ${gal.inked}枚）`
                   :`モデルを並べる: NG　${gal.note}`);
  if(!okGal) errs.push("モデルの一覧が絵にならない");
}
// 読み方の内訳が本当に数えられているか。
// 数える場所が早すぎると全部0になり、一覧の見出しが嘘をつく
{
  const rd=await pg3.evaluate(()=>{
    const caps=[...document.querySelectorAll("#mdlgrid figcaption")].map(c=>c.textContent);
    const line=document.getElementById("report").value.split("\n").find(l=>l.includes("部品の読み方"))||"";
    return {caps,line};
  });
  const anyRun=rd.caps.some(c=>/命令([1-9]\d*)/.test(c));
  const okRead=anyRun&&/命令の列として実行 [1-9]/.test(rd.line);
  console.log(okRead?`読み方の内訳: ok（${rd.line.trim()}）`
                   :`読み方の内訳: NG　見出し=${JSON.stringify(rd.caps[0]||"")}　報告=${rd.line.trim()||"(なし)"}`);
  if(!okRead) errs.push("読み方の内訳が数えられていない（全部0になっている疑い）");
}
// 一覧を画像で保存できるか（PNG として筋の通ったものができるか）
{
  const png=await pg3.evaluate(async()=>{
    const figs=[...document.querySelectorAll("#mdlgrid figure")];
    if(!figs.length) return {err:"一覧が空"};
    // 保存の代わりに、同じ道具で作った画像をその場で調べる
    const blobs=[];
    const real=window.saveBlob;
    window.saveBlob=b=>{ blobs.push(b) };
    const ok=gridToPng("mdlgrid","試験","x.png");
    await new Promise(r=>setTimeout(r,300));
    window.saveBlob=real;
    if(!ok||!blobs.length) return {err:"画像ができない"};
    const buf=new Uint8Array(await blobs[0].arrayBuffer());
    const sig=[137,80,78,71,13,10,26,10];
    const isPng=sig.every((v,i)=>buf[i]===v);
    return {isPng,size:buf.length,type:blobs[0].type};
  });
  const okPng=!png.err&&png.isPng&&png.size>2000;
  console.log(okPng?`一覧を画像で保存: ok（PNG ${png.size} バイト）`
                   :`一覧を画像で保存: NG　${png.err||JSON.stringify(png)}`);
  if(!okPng) errs.push("一覧を画像にできない");
}
// 調べた結果が画面に出ていること（スクショ1枚で状況が分かるように）
{ const h=await pg3.evaluate(()=>{ const b=document.getElementById("hud");
    return {hidden:b.hidden,text:b.textContent}; });
  console.log("画面に調べた結果を出す: "+((!h.hidden&&/sector/.test(h.text))?"ok":"NG")
    +"\n"+h.text.split("\n").slice(0,2).join("\n")); }
{ const g=await pg3.evaluate(()=>(state.galGroups||[]).join("\n"));
  console.log("同じ形でまとめた: "+(/まとめると \d+種類/.test(g)?"ok":"NG")+"\n"+g); }
// 本物の RAM ダンプを落として、写しの中の人がそのまま出るか（これが本番の道）
if(fs.existsSync("dump3.bin")){
  await pg3.setInputFiles("#memfile","dump3.bin");
  await pg3.waitForFunction(()=>window.state&&state.ramChars,null,{timeout:30000}).catch(()=>{});
  await pg3.waitForTimeout(800);
  const r=await pg3.evaluate(()=>{
    const c=document.getElementById("gl"),g=c.getContext("webgl");
    const n=c.width*c.height, buf=new Uint8Array(n*4);
    g.readPixels(0,0,c.width,c.height,g.RGBA,g.UNSIGNED_BYTE,buf);
    let opaque=0; for(let i=3;i<buf.length;i+=4) if(buf[i]>8) opaque++;
    const sel=document.getElementById("ramchar");
    return {chars:(state.ramChars||[]).map(x=>`${x.who} ${x.model.len}B 骨${x.bones.list.length} 命令5×${x.cmd5}`),
            boxHidden:document.getElementById("ramchar-box").hidden,
            opts:[...sel.options].map(o=>o.textContent),
            status:document.getElementById("status").textContent,
            slotHidden:document.getElementById("t1slot-box").hidden,
            tris:state.selInfo&&state.selInfo.tris,
            parts:state.selInfo&&state.selInfo.t1Parts,
            ramLine:state.selInfo&&state.selInfo.ramChar,
            report:document.getElementById("report").value,
            digest:digestLines().join("\n"),
            ratio:+(opaque/n).toFixed(4)};
  });
  console.log("--- 写しの中の人 ---\n"+r.chars.join("\n")+"\n選べる: "+r.opts.join(" / ")
    +"\n"+r.status+"\n"+(r.ramLine||"")+"\n三角形 "+r.tris+"　"+(r.parts||"")+"　画素 "+r.ratio);
  const okChars=r.chars.length===2&&!r.boxHidden;
  if(!okChars) errs.push("写しから2人を取り出せていない: "+JSON.stringify(r.chars));
  if(!/命令5×40/.test(r.chars[0]||"")||!/骨40/.test(r.chars[0]||""))
    errs.push("1P の骨が命令5の回数と合っていない: "+r.chars[0]);
  if(!/命令5×34/.test(r.chars[1]||"")||!/骨34/.test(r.chars[1]||""))
    errs.push("2P の骨が命令5の回数と合っていない: "+r.chars[1]);
  if(!(r.tris>500)) errs.push("写しのモデルの三角形が少なすぎる: "+r.tris);
  if(!(r.ratio>0.01)) errs.push("写しのモデルが画面に出ていない（画素 "+r.ratio+"）");
  if(r.slotHidden) errs.push("差し替えの部品の選び口が出ていない");
  if(!/描いているのは 4個/.test(r.parts||"")) errs.push("既定で本体＋右手＋左手＋顔になっていない: "+r.parts);
  if(!/写しの中の登場人物 2人/.test(r.digest)) errs.push("まとめ（貼る用）に登場人物の行が出ていない");
  if(!/1P: モデル 0x8010788C/.test(r.digest)) errs.push("まとめに1Pの行が出ていない");
  if(!/2P: モデル 0x800B2548/.test(r.digest)) errs.push("まとめに2Pの行が出ていない");
  if(!/写しの中の登場人物 2人/.test(r.report)) errs.push("長いほうの報告に登場人物の行が出ていない");
  await pg3.screenshot({path:"shot-ram.png"});
  // 2人目に切り替える
  await pg3.selectOption("#ramchar","1");
  await pg3.waitForTimeout(800);
  const r2=await pg3.evaluate(()=>({status:document.getElementById("status").textContent,
    tris:state.selInfo&&state.selInfo.tris}));
  console.log("--- 2人目 ---\n"+r2.status+"　三角形 "+r2.tris);
  if(!/2P/.test(r2.status)) errs.push("2人目に切り替わらない: "+r2.status);
  if(!(r2.tris>500)) errs.push("2人目の三角形が少なすぎる: "+r2.tris);
  await pg3.screenshot({path:"shot-ram2.png"});
  // VRAM を入れて、テクスチャが貼られるか
  if(fs.existsSync("vram.bin")){
    await pg3.selectOption("#ramchar","0");
    await pg3.waitForTimeout(600);

    await pg3.setInputFiles("#memfile","vram.bin");
    await pg3.waitForTimeout(1500);
    const rv=await pg3.evaluate(()=>({
      status:document.getElementById("mem-status").textContent,
      tex:state.selInfo&&state.selInfo.t1Tex,
      hasVram:!!state.vram,
      texTris:(function(){ try{ return document.getElementById("report").value.match(/テクスチャの貼られる面 \d+枚/)||[] }catch(_){ return [] } })()[0]||"",
    }));
    console.log("--- VRAM ---\n"+rv.status+"\n"+(rv.tex||"")+"  vram="+rv.hasVram);
    if(!rv.hasVram) errs.push("VRAM を受け取れていない: "+rv.status);
    if(!/貼っています/.test(rv.tex||"")) errs.push("テクスチャを貼っていると言っていない: "+rv.tex);
    await pg3.screenshot({path:"shot-tex.png"});
    await pg3.selectOption("#ramchar","1");
    await pg3.waitForTimeout(900);
    await pg3.screenshot({path:"shot-tex2.png"});
    const rv2=await pg3.evaluate(()=>({tex:state.selInfo&&state.selInfo.t1Tex,tris:state.selInfo&&state.selInfo.tris}));
    console.log("--- VRAM 2人目 ---\n"+(rv2.tex||"（テクスチャの面なし）")+"　三角形 "+rv2.tris);
    await pg3.selectOption("#ramchar","0");
    await pg3.waitForTimeout(600);
  }
  // ディスクのファイルを選んでも、読み込んだ VRAM が使われること
    { await pg3.evaluate(()=>selectEntry(0));
      await pg3.waitForTimeout(900);
      const rd=await pg3.evaluate(()=>({from:state.selInfo&&state.selInfo.texFrom,
                                        tex:state.selInfo&&state.selInfo.t1Tex,
                                        vram:!!state.vram, layout:state.selInfo&&state.selInfo.layout,
                                        err:state.selErr}));
      console.log("  （state.vram="+rd.vram+" 並び="+(rd.layout||"-")+" err="+(rd.err||"-")+"）");
      console.log("--- ディスクのモデルと VRAM ---\n"+(rd.from||"（写しの VRAM を使っていない）"));
      if(!/読み込んだ VRAM/.test(rd.from||""))
        errs.push("ディスクのモデルで、読み込んだ VRAM が使われていない");
      await pg3.evaluate(()=>selectRamChar(0));
      await pg3.waitForTimeout(700); }
  // 2人とも出す：もう1人が層1 に描かれ、切ると消える
  { await pg3.evaluate(()=>{ const b=document.getElementById("ramboth"); b.checked=true; b.dispatchEvent(new Event("change")) });
    await pg3.waitForTimeout(1200);
    const on=await pg3.evaluate(()=>({l0:layers[0].count,l1:layers[1].count}));
    await pg3.evaluate(()=>{ const b=document.getElementById("ramboth"); b.checked=false; b.dispatchEvent(new Event("change")) });
    await pg3.waitForTimeout(900);
    const off=await pg3.evaluate(()=>layers[1].count);
    console.log(`--- 2人とも出す ---\n選んだ人 ${on.l0/3}枚・もう1人 ${on.l1/3}枚／切ると ${off}`);
    if(!(on.l0>0&&on.l1>0)) errs.push("2人とも出すで、もう1人が描かれていない");
    if(off!==0) errs.push("2人とも出すを切っても、もう1人が残る"); }
  // 格子：床と縦の面を出すと描かれる画素が増え、切ると戻る
  { const px=()=>pg3.evaluate(()=>{ draw(); const c=document.getElementById("gl"),g=c.getContext("webgl"),b=new Uint8Array(c.width*c.height*4);
      g.readPixels(0,0,c.width,c.height,g.RGBA,g.UNSIGNED_BYTE,b); let n=0; for(let i=3;i<b.length;i+=4) if(b[i]>8) n++; return n });
    const set=v=>pg3.evaluate(v=>{ for(const id of ["grid-floor","grid-wall"]){ const e=document.getElementById(id); e.checked=v; e.dispatchEvent(new Event("change")) } },v);
    const a0=await px(); await set(true); const a1=await px(); await set(false); const a2=await px();
    console.log(`--- 格子 ---\n画素 ${a0} → 出すと ${a1} → 切ると ${a2}`);
    if(!(a1>a0)) errs.push("格子を出しても何も描かれない");
    if(a2!==a0) errs.push("格子を切っても元に戻らない"); }
  // 3Dプリント用に閉じた形を作る（細かさは粗いで速く）
  { await pg3.evaluate(()=>{ document.getElementById("pr-res").value="120"; document.getElementById("pr-make").click() });
    await pg3.waitForFunction(()=>document.getElementById("pr-status").textContent.length>0,null,{timeout:120000});
    const t=await pg3.evaluate(()=>document.getElementById("pr-status").innerText);
    console.log("--- 3Dプリント ---\n"+t);
    if(!/閉じた形になりました/.test(t)) errs.push("3Dプリント用の形が閉じていない: "+t.split("\n")[0]);
    await pg3.evaluate(()=>document.getElementById("pr-back").click()); await pg3.waitForTimeout(900); }
  // 差し替えの部品を1つ出す
  await pg3.selectOption("#t1slot","0");
  await pg3.waitForTimeout(800);
  await pg3.screenshot({path:"shot-slot1.png"});
  try{ await pg3.evaluate(()=>selectRamChar(1)); await pg3.waitForTimeout(900);
       await pg3.evaluate(()=>{ view.yaw=Math.PI; view.pitch=0.05; view.dist=0.9; draw() });
       await pg3.waitForTimeout(300);
       await pg3.screenshot({path:"shot-slot2.png"});
       await pg3.evaluate(()=>selectRamChar(0)); await pg3.waitForTimeout(600); }catch(_){}
  const r3=await pg3.evaluate(()=>({parts:state.selInfo&&state.selInfo.t1Parts,
    tris:state.selInfo&&state.selInfo.tris}));
  console.log("--- 差し替えを1つ出す ---\n"+(r3.parts||"")+"　三角形 "+r3.tris);
  if(!/描いているのは 4個/.test(r3.parts||"")) errs.push("本体・右手・左手・顔の4個になっていない: "+r3.parts);
  await pg3.selectOption("#t1slot","-2"); await pg3.waitForTimeout(700);
  const r4=await pg3.evaluate(()=>state.selInfo&&state.selInfo.t1Parts);
  console.log("--- 手を出さない ---\n"+(r4||""));
  if(!/描いているのは 2個/.test(r4||"")) errs.push("「手を出さない」で本体と顔の2個になっていない: "+r4);
  await pg3.selectOption("#t1slot","0"); await pg3.waitForTimeout(500);
} else console.log("--- 写しの中の人 ---\n(dump3.bin が無いので飛ばしました)");
// 画面に出る版が、中身の版と合っているか（直書きのまま置き去りにした前科あり）
{ const rev=await pg3.evaluate(()=>({rev:document.getElementById("rev").textContent,
                                     ver:typeof VERSION!=="undefined"?VERSION:null}));
  console.log("画面の版: "+rev.rev.trim()+"　中身の版: "+rev.ver);
  if(!rev.ver||rev.rev.indexOf(rev.ver)<0)
    errs.push("画面に出ている版が中身と違う: 画面「"+rev.rev.trim()+"」中身「"+rev.ver+"」"); }
console.log("--- errors ---\n"+(errs.length?errs.join("\n"):"(なし)"));
await br.close(); srv.close();
process.exit(errs.length?1:0);
