// ブラウザでの確認（Playwright）。何も読み込んでいない所から、セーブステート→ディスクの順にたどる（教訓5）。node browser.mjs
import {chromium} from "/opt/node22/lib/node_modules/playwright/index.mjs";
import fs from "fs"; import path from "path";
const here=path.dirname(new URL(import.meta.url).pathname), page0="file://"+path.join(here,"../index.html");
const b=await chromium.launch({args:["--use-gl=swiftshader","--enable-webgl","--ignore-gpu-blocklist"]});
for(const [w,h,tag] of [[1100,900,"pc"],[390,844,"phone"]]){
  const p=await b.newPage({viewport:{width:w,height:h}}); const errs=[];
  p.on("pageerror",e=>errs.push(e.message)); p.on("console",m=>{ if(m.type()==="error") errs.push(m.text()) });
  await p.goto(page0); await p.screenshot({path:`out/b_${tag}_0.png`,fullPage:true});
  console.log(tag,"何も無し: 状態",JSON.stringify(await p.textContent("#status")),"空の案内",await p.isVisible("#empty"));
  const states=fs.readdirSync(path.join(here,"disc/states")).filter(f=>f.endsWith(".p2s")).map(f=>path.join(here,"disc/states",f));
  await p.setInputFiles("#f-state",states);
  console.log(tag,"写しだけ:",JSON.stringify(await p.textContent("#status")));
  await p.setInputFiles("#f-disc",path.join(here,"disc/vf2.bin"));
  await p.waitForFunction(()=>document.getElementById("info").textContent.length>0,null,{timeout:120000});
  console.log(tag,"両方:",JSON.stringify(await p.textContent("#info")),JSON.stringify(await p.textContent("#status")));
  await p.waitForTimeout(300); await p.screenshot({path:`out/b_${tag}_1.png`,fullPage:true});
  if(tag==="pc"){
    await p.click("#states button:nth-child(2)"); await p.waitForFunction(()=>/PAI/.test(document.getElementById("info").textContent),null,{timeout:60000});
    await p.waitForTimeout(300); await p.screenshot({path:"out/b_pc_2.png"});
    const box=await p.locator("#viewer").boundingBox(); await p.mouse.move(box.x+box.width/2,box.y+box.height/2); await p.mouse.down(); await p.mouse.move(box.x+box.width/2+160,box.y+box.height/2+20,{steps:5}); await p.mouse.up();
    await p.waitForTimeout(200); await p.screenshot({path:"out/b_pc_3.png"});
    await p.check("#c-overlay"); await p.click("#b-reset"); await p.waitForTimeout(300); await p.screenshot({path:"out/b_pc_4.png"});
  }
  console.log(tag,"エラー",errs);
  await p.close();
}
await b.close();
