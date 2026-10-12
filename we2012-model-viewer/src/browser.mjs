// Playwright でページをたどる（教訓5: 何も読み込んでいない状態から）。PC とスマホの幅で撮る（out/b_*.png）
//   何も無し → 偽の ISO（node mkfake.mjs）→ 調べ終わる → 顔を次へ → 髪を変える → 番号で見る → 回す → PNG
import {chromium} from "/opt/node22/lib/node_modules/playwright/index.mjs";
import fs from "fs"; import path from "path";
const here=path.dirname(new URL(import.meta.url).pathname), disc=process.argv[2]||path.join(here,"out/fake.iso");
const b=await chromium.launch({args:["--use-gl=swiftshader","--enable-webgl","--ignore-gpu-blocklist"]});
fs.mkdirSync(path.join(here,"out"),{recursive:true});
const info=p=>p.textContent("#info");
for(const [name,vp] of [["pc",{width:1100,height:900}],["phone",{width:390,height:844}]]){
  const p=await b.newPage({viewport:vp,acceptDownloads:true}); const errs=[]; p.on("pageerror",e=>errs.push(e.message)); p.on("console",m=>{ if(m.type()==="error") errs.push(m.text()) });
  await p.goto("file://"+path.join(here,"../index.html"));
  console.log(name,"何も無し:",JSON.stringify(await p.textContent("#empty")),"版",await p.textContent("#ver-h"),"操作の欄",await p.isVisible("#pick"),await p.isVisible("#anyfile"));
  await p.screenshot({path:`out/b_${name}_0.png`,fullPage:true});
  if(!fs.existsSync(disc)){ console.log("ディスクが無いので、ここまで"); await p.close(); continue }
  let t0=Date.now(); await p.setInputFiles("#f-disc",disc);
  await p.waitForFunction(()=>/顔 \d+・髪 \d+$/.test(document.getElementById("status").textContent)||document.getElementById("status").className==="err",null,{timeout:600000});
  console.log(name,"開く（"+(Date.now()-t0)+"ms）:",JSON.stringify(await p.textContent("#status")),JSON.stringify(await info(p)),"顔",await p.$$eval("#s-face option",o=>o.length),"髪",await p.$$eval("#s-hair option",o=>o.length));
  await p.waitForTimeout(300); await p.screenshot({path:`out/b_${name}_1.png`,fullPage:true});
  await p.click("#f-next"); await p.waitForTimeout(300); console.log(name,"次の顔:",JSON.stringify(await info(p)));
  await p.selectOption("#s-hair",{index:3}); await p.waitForTimeout(300); console.log(name,"髪を変える:",JSON.stringify(await info(p))); await p.locator("#viewer").screenshot({path:`out/b_${name}_2.png`});
  await p.selectOption("#s-hair",{value:""}); await p.waitForTimeout(300); console.log(name,"髪なし:",JSON.stringify(await info(p)));
  // 横から（ドラッグで 4 分の 1 周）
  { const bb=await p.locator("#cv").boundingBox(); await p.mouse.move(bb.x+20,bb.y+bb.height/2); await p.mouse.down(); await p.mouse.move(bb.x+20+157,bb.y+bb.height/2,{steps:6}); await p.mouse.up(); await p.waitForTimeout(200); await p.locator("#viewer").screenshot({path:`out/b_${name}_side.png`}); await p.dblclick("#cv") }
  await p.fill("#n-file","200"); await p.click("#b-file"); await p.waitForTimeout(400); console.log(name,"#200:",JSON.stringify(await info(p)),"空の札",await p.isVisible("#empty"),"絵",await p.$$eval("#texs canvas",c=>c.length));
  await p.screenshot({path:`out/b_${name}_3.png`,fullPage:true});
  await p.fill("#n-file","3600"); await p.press("#n-file","Enter"); await p.waitForTimeout(400); console.log(name,"#3600:",JSON.stringify(await info(p)));
  await p.locator("#viewer").screenshot({path:`out/b_${name}_4.png`});
  await p.click("#b-rand"); await p.waitForTimeout(300); console.log(name,"おまかせ:",JSON.stringify(await info(p)));
  await p.check("#c-clear"); const [dl]=await Promise.all([p.waitForEvent("download"),p.click("#b-png")]); const f=`out/b_${name}_save.png`; await dl.saveAs(f);
  const hd=fs.readFileSync(f); console.log(name,"保存:",dl.suggestedFilename(),hd.readUInt32BE(16)+"×"+hd.readUInt32BE(20),"透過",hd[25]===6);
  const sw=await p.evaluate(()=>document.documentElement.scrollWidth); console.log(name,"横幅",sw,"／",vp.width,"エラー",errs.length?errs:"なし");
  await p.close();
}
await b.close();
