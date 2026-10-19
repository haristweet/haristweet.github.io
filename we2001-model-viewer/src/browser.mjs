// Playwright でページをたどる（教訓5: 何も読み込んでいない状態から）。PC とスマホの幅で撮る（out/b_*.png）
//   何も無し → ディスク（CHD）→ チーム・選手・2 着目を変える → 手で顔を変える → おまかせ → 動き 3 を再生 → 回す → PNG
import {chromium} from "/opt/node22/lib/node_modules/playwright/index.mjs";
import fs from "fs"; import path from "path";
const here=path.dirname(new URL(import.meta.url).pathname);
const disc=["we2001.chd","we2001.bin"].map(f=>path.join(here,"disc",f)).find(f=>fs.existsSync(f));
const b=await chromium.launch({args:["--use-gl=swiftshader","--enable-webgl","--ignore-gpu-blocklist"]});
fs.mkdirSync(path.join(here,"out"),{recursive:true});
for(const [name,vp] of [["pc",{width:1100,height:900}],["phone",{width:390,height:844}]]){
  const p=await b.newPage({viewport:vp,acceptDownloads:true}); const errs=[]; p.on("pageerror",e=>errs.push(e.message)); p.on("console",m=>{ if(m.type()==="error") errs.push(m.text()) });
  await p.goto("file://"+path.join(here,"../index.html"));
  console.log(name,"何も無し:",JSON.stringify(await p.textContent("#empty")),"版",await p.textContent("#ver-h"),"操作の欄",await p.isVisible("#pick"));
  await p.screenshot({path:`out/b_${name}_0.png`,fullPage:true});
  if(!disc){ console.log("ディスクが無いので、ここまで"); await p.close(); continue }
  let t0=Date.now(); await p.setInputFiles("#f-disc",disc);
  await p.waitForFunction(()=>/面/.test(document.getElementById("info").textContent)||document.getElementById("status").className==="err",null,{timeout:300000});
  console.log(name,"ディスク（"+(Date.now()-t0)+"ms）:",JSON.stringify(await p.textContent("#info")),JSON.stringify(await p.textContent("#status")),"チーム",await p.$$eval("#s-team option",o=>o.length),"選手",await p.$$eval("#s-player option",o=>o.length));
  await p.waitForTimeout(300); await p.screenshot({path:`out/b_${name}_1.png`,fullPage:true});
  // 鹿島のキーパー（高桑）を GK の服 2 で（集合写真の画面では灰色の袖に緑の胸）
  await p.selectOption("#s-player","0"); await p.selectOption("#s-gk",{value:"1"}); await p.waitForTimeout(300); await p.locator("#viewer").screenshot({path:`out/b_${name}_gk.png`});
  console.log(name,"鹿島 GK 2:",JSON.stringify(await p.textContent("#info"))); await p.selectOption("#s-gk",{value:"0"});
  await p.selectOption("#s-team","9"); await p.selectOption("#s-player","9"); await p.selectOption("#s-alt","1");
  await p.waitForTimeout(300); console.log(name,"磐田・中山・2着目:",JSON.stringify(await p.textContent("#info")),"背番号",await p.inputValue("#n-num")); await p.locator("#viewer").screenshot({path:`out/b_${name}_2.png`});
  await p.click("#detail summary"); await p.selectOption("#s-face","6"); await p.waitForTimeout(200); console.log(name,"顔 6:",JSON.stringify(await p.textContent("#info")),"選手の欄",JSON.stringify(await p.inputValue("#s-player")));
  await p.click("#b-rand"); await p.waitForTimeout(300); console.log(name,"おまかせ:",JSON.stringify(await p.textContent("#info"))); await p.locator("#viewer").screenshot({path:`out/b_${name}_r.png`});
  // 背中から（ドラッグで半周）
  { const bb=await p.locator("#cv").boundingBox(); await p.mouse.move(bb.x+20,bb.y+bb.height/2); await p.mouse.down(); await p.mouse.move(bb.x+20+314,bb.y+bb.height/2,{steps:6}); await p.mouse.up(); await p.waitForTimeout(200); await p.locator("#viewer").screenshot({path:`out/b_${name}_back.png`}); await p.dblclick("#cv") }
  await p.fill("#m-num","3"); await p.dispatchEvent("#m-num","change"); await p.click("#m-play"); await p.waitForTimeout(600); const f1=await p.textContent("#m-fn"); await p.waitForTimeout(400); const f2=await p.textContent("#m-fn"); await p.click("#m-play");
  console.log(name,"再生:",f1,"→",f2); await p.locator("#viewer").screenshot({path:`out/b_${name}_3.png`});
  const box=await p.locator("#cv").boundingBox(); await p.mouse.move(box.x+box.width/2,box.y+box.height/2); await p.mouse.down(); await p.mouse.move(box.x+box.width/2+150,box.y+box.height/2,{steps:5}); await p.mouse.up();
  await p.waitForTimeout(200); await p.locator("#viewer").screenshot({path:`out/b_${name}_4.png`});
  await p.check("#c-clear"); const [dl]=await Promise.all([p.waitForEvent("download"),p.click("#b-png")]); const f=`out/b_${name}_save.png`; await dl.saveAs(f);
  const hd=fs.readFileSync(f); console.log(name,"保存:",dl.suggestedFilename(),hd.readUInt32BE(16)+"×"+hd.readUInt32BE(20),"透過",hd[25]===6);
  // 自分のユニフォーム: 仙台の下絵を書き出す → 絵を読み込む（環境変数 KITFILE があればそれ、無ければ書き出した下絵）→ 背中から
  await p.selectOption("#s-team","16"); await p.selectOption("#s-player","2"); await p.click("#ownkit summary");
  { const [d]=await Promise.all([p.waitForEvent("download"),p.click("#b-kittpl")]); const f=`out/b_${name}_kittpl.png`; await d.saveAs(f); console.log(name,"下絵:",d.suggestedFilename(),fs.statSync(f).size,"B");
    await p.setInputFiles("#f-kit",process.env.KITFILE||f); await p.waitForFunction(()=>!document.getElementById("b-kit0").hidden,null,{timeout:30000}); await p.waitForTimeout(300);
    console.log(name,"自分の絵:",await p.textContent("#n-kit")); await p.locator("#viewer").screenshot({path:`out/b_${name}_kit1.png`});
    const bb=await p.locator("#cv").boundingBox(); await p.mouse.move(bb.x+20,bb.y+bb.height/2); await p.mouse.down(); await p.mouse.move(bb.x+20+314,bb.y+bb.height/2,{steps:6}); await p.mouse.up(); await p.waitForTimeout(200);
    await p.locator("#viewer").screenshot({path:`out/b_${name}_kit2.png`}); await p.dblclick("#cv") }
  // 集合写真: 仙台（1P・正面）→ 山形（2P・最初の斜め）→ 並べ直す → PNG
  await p.selectOption("#s-mode","photo"); await p.selectOption("#s-team","16"); await p.selectOption("#s-alt",{value:"0"}); await p.selectOption("#s-gk",{value:"0"});
  await p.waitForFunction(()=>/集合写真: ベガルタ/.test(document.getElementById("info").textContent),null,{timeout:60000}); await p.waitForTimeout(300);
  console.log(name,"集合写真:",JSON.stringify(await p.textContent("#info")).slice(0,160),"1人用の欄",await p.isVisible("#s-player"),"動き",await p.isVisible("#motion"));
  await p.locator("#viewer").screenshot({path:`out/b_${name}_photo1.png`});
  await p.selectOption("#s-team","17"); await p.selectOption("#s-side",{value:"1"}); await p.locator("#r-cam").fill("0"); await p.waitForTimeout(400);
  await p.locator("#viewer").screenshot({path:`out/b_${name}_photo2.png`});
  await p.click("#b-pose"); await p.waitForTimeout(300); await p.locator("#viewer").screenshot({path:`out/b_${name}_photo3.png`});
  { const [d]=await Promise.all([p.waitForEvent("download"),p.click("#b-png")]); console.log(name,"写真の保存:",d.suggestedFilename()) }
  await p.selectOption("#s-team","16"); await p.selectOption("#s-side",{value:"0"}); await p.locator("#r-cam").fill("100"); await p.waitForTimeout(400); await p.locator("#viewer").screenshot({path:`out/b_${name}_photo4.png`});
  await p.click("#b-kit0"); await p.waitForTimeout(300); console.log(name,"ゲームの絵に戻す:",await p.textContent("#n-kit"));
  await p.selectOption("#s-mode","one"); await p.waitForTimeout(300); console.log(name,"1人に戻す:",JSON.stringify(await p.textContent("#info")).slice(0,80));
  console.log(name,"エラー",errs); await p.close();
}
await b.close();
