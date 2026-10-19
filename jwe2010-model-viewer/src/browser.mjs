// Playwright でページをたどる（教訓5: 何も読み込んでいない状態から）。PC とスマホの幅で撮る（out/b_*.png）
//   何も無し → ステートセーブ（data/sekiguchi.p2s）→ 偽の ISO（node mkfake.mjs）→ 名前で探す → 次の選手 → 番号で見る → 回す → PNG
//   偽の ISO には見本のファイルしか無いので、無い選手（関口など）は「ファイルではありません」と出る。回すのは中島（見本あり）で
import {chromium} from "/opt/node22/lib/node_modules/playwright/index.mjs";
import fs from "fs"; import path from "path";
const here=path.dirname(new URL(import.meta.url).pathname), disc=process.argv[2]||path.join(here,"out/fake.iso"), save=process.argv[3]||path.join(here,"data/sekiguchi.p2s");
const b=await chromium.launch({args:["--use-gl=swiftshader","--enable-webgl","--ignore-gpu-blocklist"]});
fs.mkdirSync(path.join(here,"out"),{recursive:true});
const info=p=>p.textContent("#info"), st=p=>p.textContent("#status");
const settle=async p=>{ await p.waitForFunction(()=>!/…$/.test(document.getElementById("status").textContent),null,{timeout:60000}); await p.waitForTimeout(400) };
for(const [name,vp] of [["pc",{width:1100,height:900}],["phone",{width:390,height:844}]]){
  const p=await b.newPage({viewport:vp,acceptDownloads:true}); const errs=[]; p.on("pageerror",e=>errs.push(e.message)); p.on("console",m=>{ if(m.type()==="error") errs.push(m.text()) });
  await p.goto("file://"+path.join(here,"../index.html"));
  console.log(name,"何も無し:",JSON.stringify(await p.textContent("#empty")),"版",await p.textContent("#ver-h"),"操作の欄",await p.isVisible("#pick"),await p.isVisible("#anyfile"));
  await p.screenshot({path:`out/b_${name}_0.png`,fullPage:true});
  if(!fs.existsSync(save)||!fs.existsSync(disc)){ console.log("セーブかディスクが無いので、ここまで"); await p.close(); continue }
  let t0=Date.now(); await p.setInputFiles("#f-save",save); await settle(p);
  console.log(name,"セーブ（"+(Date.now()-t0)+"ms）:",JSON.stringify(await st(p)),JSON.stringify(await p.textContent("#empty")),"一覧",await p.$$eval("#s-player option",o=>o.length),JSON.stringify(await info(p)));
  console.log(name,"チーム:",await p.$$eval("#s-team option",o=>o.length),"選んでいる",JSON.stringify(await p.$eval("#s-team",s=>s.options[s.selectedIndex].text)),"一覧",await p.$$eval("#s-player option",o=>o.map(x=>x.textContent).slice(0,3).join("／")));
  t0=Date.now(); await p.setInputFiles("#f-disc",disc); await settle(p);
  console.log(name,"ディスク（"+(Date.now()-t0)+"ms）:",JSON.stringify(await st(p)),JSON.stringify(await info(p)));
  await p.screenshot({path:`out/b_${name}_1.png`,fullPage:true});
  await p.fill("#q","関口"); await p.waitForTimeout(500); console.log(name,"関口で探す:",await p.$$eval("#s-player option",o=>o.map(x=>x.textContent).join("／")),JSON.stringify(await info(p)));
  await p.locator("#viewer").screenshot({path:`out/b_${name}_2.png`});
  await p.fill("#q",""); await p.waitForTimeout(300); console.log(name,"探すのをやめる:",await p.$$eval("#s-player option",o=>o.length),"選んでいる",await p.$eval("#s-player",s=>s.value));
  await p.click("#p-next"); await p.waitForTimeout(400); console.log(name,"次の選手:",JSON.stringify(await info(p)));
  await p.fill("#q","中島 裕希"); await p.waitForTimeout(500); console.log(name,"中島:",JSON.stringify(await info(p))); await p.locator("#viewer").screenshot({path:`out/b_${name}_nakajima.png`});
  // 横から（ドラッグで 4 分の 1 周）
  { const bb=await p.locator("#cv").boundingBox(); await p.mouse.move(bb.x+20,bb.y+bb.height/2); await p.mouse.down(); await p.mouse.move(bb.x+20+157,bb.y+bb.height/2,{steps:6}); await p.mouse.up(); await p.waitForTimeout(200); await p.locator("#viewer").screenshot({path:`out/b_${name}_side.png`}); await p.dblclick("#cv") }
  await p.selectOption("#s-team",{label:"鹿島アントラーズ（31）"}); await p.waitForTimeout(400); console.log(name,"鹿島:",await p.$$eval("#s-player option",o=>o.length),JSON.stringify(await info(p)));
  await p.selectOption("#s-team",{index:1}); await p.waitForTimeout(300);
  await p.fill("#n-file","7188"); await p.click("#b-file"); await p.waitForTimeout(400); console.log(name,"#7188:",JSON.stringify(await info(p)),"絵",await p.$$eval("#texs canvas",c=>c.length));
  await p.screenshot({path:`out/b_${name}_3.png`,fullPage:true});
  await p.selectOption("#s-player",{index:0}); await p.waitForTimeout(400); console.log(name,"1 人目:",JSON.stringify(await info(p)));
  await p.check("#c-clear"); const [dl]=await Promise.all([p.waitForEvent("download"),p.click("#b-png")]); const f=`out/b_${name}_save.png`; await dl.saveAs(f);
  const hd=fs.readFileSync(f); console.log(name,"保存:",dl.suggestedFilename(),hd.readUInt32BE(16)+"×"+hd.readUInt32BE(20),"透過",hd[25]===6);
  const sw=await p.evaluate(()=>document.documentElement.scrollWidth); console.log(name,"横幅",sw,"／",vp.width,"エラー",errs.length?errs:"なし");
  await p.close();
}
await b.close();
