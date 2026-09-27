// Playwright でページをたどる（教訓5: 何も読み込んでいない状態から）。何も無し → 写しだけ → ディスク（CHD）も、の順。PC とスマホの幅で撮る（out/b_*.png）
import {chromium} from "/opt/node22/lib/node_modules/playwright/index.mjs";
import fs from "fs"; import path from "path";
const here=path.dirname(new URL(import.meta.url).pathname);
const b=await chromium.launch({args:["--use-gl=swiftshader","--enable-webgl","--ignore-gpu-blocklist"]});
const states=["grace1P_picky1P_round1","bahn1P_honey1P_tower"].map(s=>path.join(here,"disc/states",s+".p2s")).filter(f=>fs.existsSync(f));
for(const [name,vp] of [["pc",{width:1100,height:900}],["phone",{width:390,height:844}]]){
  const p=await b.newPage({viewport:vp}); const errs=[]; p.on("pageerror",e=>errs.push(e.message)); p.on("console",m=>{ if(m.type()==="error") errs.push(m.text()) });
  await p.goto("file://"+path.join(here,"../index.html"));
  console.log(name,"何も無し:",JSON.stringify(await p.textContent("#empty")),"版",await p.textContent("#ver-h"));
  await p.screenshot({path:`out/b_${name}_0.png`,fullPage:true});
  if(!states.length){ console.log("写しが無いので、ここまで"); await p.close(); continue }
  await p.setInputFiles("#f-state",states); await p.waitForFunction(()=>document.querySelectorAll("#states button").length>0,null,{timeout:60000});
  console.log(name,"写しだけ:",JSON.stringify(await p.textContent("#status")),"一覧",await p.locator("#states button").count());
  const disc=fs.existsSync(path.join(here,"disc/fv.chd"))?path.join(here,"disc/fv.chd"):path.join(here,"disc/fv.bin");
  const t0=Date.now(); await p.setInputFiles("#f-disc",disc);
  await p.waitForFunction(()=>document.getElementById("info").textContent.length>0||document.getElementById("status").className==="err",null,{timeout:300000});
  console.log(name,"ディスクも（"+(Date.now()-t0)+"ms）:",JSON.stringify(await p.textContent("#info")),JSON.stringify(await p.textContent("#status")));
  await p.waitForTimeout(500); await p.screenshot({path:`out/b_${name}_1.png`,fullPage:true});
  // 2つ目の写しへ
  await p.locator("#states button").nth(1).click(); await p.waitForFunction(()=>document.getElementById("status").textContent==="",null,{timeout:120000}); await p.waitForTimeout(500);
  console.log(name,"2つ目:",JSON.stringify(await p.textContent("#info")));
  await p.locator("#cv").screenshot({path:`out/b_${name}_2.png`});
  // 回す
  const box=await p.locator("#cv").boundingBox(); await p.mouse.move(box.x+box.width/2,box.y+box.height/2); await p.mouse.down(); await p.mouse.move(box.x+box.width/2+120,box.y+box.height/2+20,{steps:5}); await p.mouse.up();
  await p.waitForTimeout(300); await p.locator("#cv").screenshot({path:`out/b_${name}_3.png`});
  console.log(name,"エラー",errs); await p.close();
}
await b.close();
