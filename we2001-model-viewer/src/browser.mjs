// Playwright でページをたどる（教訓5: 何も読み込んでいない状態から）。PC とスマホの幅で撮る（out/b_*.png）
//   何も無し → ディスク（CHD）→ ユニフォーム・2 着目・髪型・ひげを変える → 動き 3 を再生 → 回す → PNG
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
  console.log(name,"ディスク（"+(Date.now()-t0)+"ms）:",JSON.stringify(await p.textContent("#info")),JSON.stringify(await p.textContent("#status")),"ユニフォーム",await p.$$eval("#s-kit option",o=>o.length));
  await p.waitForTimeout(300); await p.screenshot({path:`out/b_${name}_1.png`,fullPage:true});
  await p.selectOption("#s-kit",{index:28}); await p.selectOption("#s-alt","1"); await p.selectOption("#s-hair","16"); await p.check("#c-beard");
  await p.waitForTimeout(300); console.log(name,"変えた:",JSON.stringify(await p.textContent("#info"))); await p.locator("#viewer").screenshot({path:`out/b_${name}_2.png`});
  await p.fill("#m-num","3"); await p.dispatchEvent("#m-num","change"); await p.click("#m-play"); await p.waitForTimeout(600); const f1=await p.textContent("#m-fn"); await p.waitForTimeout(400); const f2=await p.textContent("#m-fn"); await p.click("#m-play");
  console.log(name,"再生:",f1,"→",f2); await p.locator("#viewer").screenshot({path:`out/b_${name}_3.png`});
  const box=await p.locator("#cv").boundingBox(); await p.mouse.move(box.x+box.width/2,box.y+box.height/2); await p.mouse.down(); await p.mouse.move(box.x+box.width/2+150,box.y+box.height/2,{steps:5}); await p.mouse.up();
  await p.waitForTimeout(200); await p.locator("#viewer").screenshot({path:`out/b_${name}_4.png`});
  await p.check("#c-clear"); const [dl]=await Promise.all([p.waitForEvent("download"),p.click("#b-png")]); const f=`out/b_${name}_save.png`; await dl.saveAs(f);
  const hd=fs.readFileSync(f); console.log(name,"保存:",dl.suggestedFilename(),hd.readUInt32BE(16)+"×"+hd.readUInt32BE(20),"透過",hd[25]===6);
  console.log(name,"エラー",errs); await p.close();
}
await b.close();
