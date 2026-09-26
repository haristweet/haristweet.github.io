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
  await p.setInputFiles("#f-state",states); await p.waitForFunction(()=>/個/.test(document.getElementById("n-state").textContent),null,{timeout:60000});
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
    await p.uncheck("#c-overlay");
    // 技を出す: 写し 16（ジャッキー同士）の 1P で技 672 を選び、コマを動かす → 再生 → 写しに戻す
    await p.click("#states button:nth-child(16)"); await p.waitForFunction(()=>/JAC/.test(document.getElementById("info").textContent),null,{timeout:60000});
    console.log(tag,"技の欄:",await p.isVisible("#motview"),"写しの技",await p.inputValue("#m-num"));
    await p.fill("#m-num","672"); await p.dispatchEvent("#m-num","change"); await p.waitForFunction(()=>/\/ 68/.test(document.getElementById("m-fn").textContent),null,{timeout:60000});
    await p.locator("#m-frame").fill("34"); await p.waitForFunction(()=>/^34 /.test(document.getElementById("m-fn").textContent),null,{timeout:20000});
    await p.waitForTimeout(300); await p.locator("#viewer").screenshot({path:"out/b_pc_m1.png"}); await p.locator("#motview").screenshot({path:"out/b_pc_m0.png"});
    await p.click("#m-play"); await p.waitForTimeout(700); const f1=await p.textContent("#m-fn"); await p.waitForTimeout(500); const f2=await p.textContent("#m-fn");
    await p.locator("#viewer").screenshot({path:"out/b_pc_m2.png"}); await p.click("#m-play");
    console.log(tag,"再生:",f1,"→",f2,JSON.stringify(await p.textContent("#status")));
    await p.click("#m-back"); await p.waitForTimeout(300); console.log(tag,"戻す:",await p.textContent("#m-fn"));
  }
  console.log(tag,"エラー",errs);
  await p.close();
}
// ディスクだけ（セーブステートを持っていない人の流れ）: 部品を並べる → 1つずつ → キャラを変える → あとから写しを足す
for(const [w,h,tag] of [[1100,900,"pc"],[390,844,"phone"]]){
  const p=await b.newPage({viewport:{width:w,height:h}}); const errs=[];
  p.on("pageerror",e=>errs.push(e.message)); p.on("console",m=>{ if(m.type()==="error") errs.push(m.text()) });
  await p.goto(page0); await p.setInputFiles("#f-disc",path.join(here,"disc/vf2.bin"));
  await p.waitForFunction(()=>/ディスクだけ/.test(document.getElementById("info").textContent),null,{timeout:180000});
  console.log(tag,"ディスクだけ:",JSON.stringify(await p.textContent("#info")),JSON.stringify(await p.textContent("#status")));
  await p.waitForTimeout(300); await p.screenshot({path:`out/b_${tag}_d1.png`,fullPage:true});
  await p.click("#b-next"); await p.click("#b-next"); await p.waitForFunction(()=>/\//.test(document.getElementById("n-part").textContent));
  await p.waitForTimeout(300); console.log(tag,"1つずつ:",JSON.stringify(await p.textContent("#n-part"))); await p.locator("#viewer").screenshot({path:`out/b_${tag}_d2.png`});
  if(tag==="pc"){
    await p.selectOption("#s-char","OBJ_PAI2"); await p.waitForFunction(()=>/OBJ_PAI2/.test(document.getElementById("info").textContent),null,{timeout:60000});
    await p.waitForTimeout(300); await p.locator("#viewer").screenshot({path:"out/b_pc_d3.png"});
    const states=fs.readdirSync(path.join(here,"disc/states")).filter(f=>f.endsWith(".p2s")).map(f=>path.join(here,"disc/states",f));
    await p.setInputFiles("#f-state",states.slice(0,1)); await p.waitForFunction(()=>/1P OBJ_AKI1/.test(document.getElementById("info").textContent),null,{timeout:60000});
    console.log(tag,"あとから写し:",JSON.stringify(await p.textContent("#info")));
  }
  console.log(tag,"ディスクだけ エラー",errs);
  await p.close();
}
await b.close();
