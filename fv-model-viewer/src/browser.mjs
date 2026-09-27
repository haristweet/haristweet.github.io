// Playwright でページをたどる（教訓5: 何も読み込んでいない状態から）。PC とスマホの幅で撮る（out/b_*.png）
//   何も無し → ディスクだけ（部品の一覧・1 つずつ）→ 写しも → 2 つ目の写し・回す → PNG（背景なし＋切り抜き）
import {chromium} from "/opt/node22/lib/node_modules/playwright/index.mjs";
import fs from "fs"; import path from "path";
const here=path.dirname(new URL(import.meta.url).pathname);
const b=await chromium.launch({args:["--use-gl=swiftshader","--enable-webgl","--ignore-gpu-blocklist"]});
const states=["grace1P_picky1P_round1","bahn1P_honey1P_tower"].map(s=>path.join(here,"disc/states",s+".p2s")).filter(f=>fs.existsSync(f));
const disc=fs.existsSync(path.join(here,"disc/fv.chd"))?path.join(here,"disc/fv.chd"):path.join(here,"disc/fv.bin");
const waitIdle=p=>p.waitForFunction(()=>{ const s=document.getElementById("status"); return s.className==="err"||!/中…/.test(s.textContent) },null,{timeout:300000});
for(const [name,vp] of [["pc",{width:1100,height:900}],["phone",{width:390,height:844}]]){
  const p=await b.newPage({viewport:vp,acceptDownloads:true}); const errs=[]; p.on("pageerror",e=>errs.push(e.message)); p.on("console",m=>{ if(m.type()==="error") errs.push(m.text()) });
  await p.goto("file://"+path.join(here,"../index.html"));
  console.log(name,"何も無し:",JSON.stringify(await p.textContent("#empty")),"版",await p.textContent("#ver-h"),"背景の色",await p.locator("#bg-box button").count());
  await p.screenshot({path:`out/b_${name}_0.png`,fullPage:true});
  if(!fs.existsSync(disc)){ console.log("ディスクが無いので、ここまで"); await p.close(); continue }
  let t0=Date.now(); await p.setInputFiles("#f-disc",disc); await p.waitForFunction(()=>/ディスクだけ/.test(document.getElementById("info").textContent)||document.getElementById("status").className==="err",null,{timeout:300000});
  console.log(name,"ディスクだけ（"+(Date.now()-t0)+"ms）:",JSON.stringify(await p.textContent("#info")),JSON.stringify(await p.textContent("#status")));
  await p.waitForTimeout(300); await p.locator("#cv").screenshot({path:`out/b_${name}_d0.png`});
  await p.click("#b-next"); await waitIdle(p); await p.click("#b-next"); await waitIdle(p); await p.waitForTimeout(300);
  console.log(name,"1つずつ:",JSON.stringify(await p.textContent("#n-part"))); await p.locator("#cv").screenshot({path:`out/b_${name}_d1.png`});
  if(!states.length){ console.log("写しが無いので、ここまで"); await p.close(); continue }
  t0=Date.now(); await p.setInputFiles("#f-state",states);
  await p.waitForFunction(()=>/1P/.test(document.getElementById("info").textContent)||document.getElementById("status").className==="err",null,{timeout:300000});
  console.log(name,"写しも（"+(Date.now()-t0)+"ms）:",JSON.stringify(await p.textContent("#info")),JSON.stringify(await p.textContent("#status")));
  await p.waitForTimeout(500); await p.screenshot({path:`out/b_${name}_1.png`,fullPage:true});
  await p.locator("#states button").nth(1).click(); await waitIdle(p); await p.waitForTimeout(500);
  console.log(name,"2つ目:",JSON.stringify(await p.textContent("#info")));
  await p.locator("#cv").screenshot({path:`out/b_${name}_2.png`});
  const box=await p.locator("#cv").boundingBox(); await p.mouse.move(box.x+box.width/2,box.y+box.height/2); await p.mouse.down(); await p.mouse.move(box.x+box.width/2+120,box.y+box.height/2+20,{steps:5}); await p.mouse.up();
  await p.waitForTimeout(300); await p.locator("#cv").screenshot({path:`out/b_${name}_3.png`});
  // 背景の色を「空」にして、背景なし＋切り抜きで PNG
  await p.locator("#bg-box button").nth(4).click(); await p.check("#c-clear"); await p.check("#c-crop"); await p.dblclick("#cv");
  const [dl]=await Promise.all([p.waitForEvent("download"),p.click("#b-png")]); const f=`out/b_${name}_save.png`; await dl.saveAs(f);
  const hd=fs.readFileSync(f); console.log(name,"保存:",dl.suggestedFilename(),"大きさ",hd.readUInt32BE(16)+"×"+hd.readUInt32BE(20),"透過",hd[25]===6);
  await p.uncheck("#c-clear"); await p.uncheck("#c-crop"); await p.waitForTimeout(200); await p.locator("#viewer").screenshot({path:`out/b_${name}_4.png`});
  // 技を出す（PC だけ）: grace の写しで技 130（投げ）を選び、コマを動かす → 再生 → ランダム → 写しに戻す → → キー → 動画
  if(name==="pc"){
    await p.locator("#states button").nth(0).click(); await waitIdle(p); await p.waitForTimeout(300);
    console.log(name,"技の欄:",await p.isVisible("#motview"),"写しの技",await p.inputValue("#m-num"),JSON.stringify(await p.textContent("#info")));
    await p.waitForFunction(()=>!document.getElementById("m-name").hidden,null,{timeout:60000});
    const opts=await p.$$eval("#m-name option",o=>o.map(x=>x.value+"|"+x.textContent));
    console.log(name,"名前の一覧:",opts.length-1,"件",opts.slice(1,4).map(x=>x.split("|")[0]).join(","),"…");
    await p.selectOption("#m-name","627"); await p.waitForFunction(()=>/\/ /.test(document.getElementById("m-fn").textContent)&&document.getElementById("m-num").value==="627",null,{timeout:60000});
    await p.locator("#m-frame").fill("20"); await p.waitForTimeout(500); await p.locator("#viewer").screenshot({path:`out/b_${name}_n1.png`}); await p.locator("#motview").screenshot({path:`out/b_${name}_n0.png`});
    console.log(name,"名前で選ぶ: 技",await p.inputValue("#m-num"),await p.textContent("#m-fn"),"一覧の選択",await p.inputValue("#m-name"));
    t0=Date.now(); await p.fill("#m-num","130"); await p.dispatchEvent("#m-num","change"); await p.waitForFunction(()=>/\/ 72/.test(document.getElementById("m-fn").textContent)||document.getElementById("status").className==="err",null,{timeout:120000});
    console.log(name,"技 130（"+(Date.now()-t0)+"ms）:",await p.textContent("#m-fn"),JSON.stringify(await p.textContent("#status")));
    await p.locator("#m-frame").fill("45"); await p.waitForFunction(()=>/^45 /.test(document.getElementById("m-fn").textContent),null,{timeout:20000});
    await p.waitForTimeout(300); await p.locator("#viewer").screenshot({path:`out/b_${name}_m1.png`}); await p.locator("#motview").screenshot({path:`out/b_${name}_m0.png`});
    await p.click("#m-play"); await p.waitForTimeout(700); const f1=await p.textContent("#m-fn"); await p.waitForTimeout(500); const f2=await p.textContent("#m-fn");
    await p.locator("#viewer").screenshot({path:`out/b_${name}_m2.png`}); await p.click("#m-play");
    console.log(name,"再生:",f1,"→",f2,await p.textContent("#m-play"));
    await p.click("#m-back"); await p.waitForTimeout(300); console.log(name,"戻す:",await p.textContent("#m-fn"));
    await p.click("#m-rand"); const seen=new Set(); for(let i=0;i<40&&seen.size<3;i++){ await p.waitForTimeout(250); seen.add(await p.inputValue("#m-num")) }
    await p.locator("#viewer").screenshot({path:`out/b_${name}_m3.png`}); await p.click("#m-rand"); const a1=await p.textContent("#m-fn"); await p.waitForTimeout(400);
    const inList=[...seen].every(v=>opts.some(o=>o.split("|")[0]===v)); console.log(name,"ランダムは一覧の技だけ:",inList);
    console.log(name,"ランダム:",[...seen].join(","),"止めたあと",a1,"→",await p.textContent("#m-fn"),await p.textContent("#m-rand"));
    await p.fill("#m-num","130"); await p.dispatchEvent("#m-num","change"); await p.waitForFunction(()=>/^1 \/ 72/.test(document.getElementById("m-fn").textContent),null,{timeout:60000});
    await p.locator("#cv").click(); await p.keyboard.press("ArrowRight"); await p.waitForTimeout(200); await p.keyboard.press("ArrowRight"); await p.waitForTimeout(400);
    console.log(name,"→ を2回:",await p.textContent("#m-fn"));
    for(const fmt of ["apng","video"]){ await p.click("#m-rec"); const [d]=await Promise.all([p.waitForEvent("download",{timeout:300000}),p.click(`#rec-menu button[data-fmt=${fmt}]`)]);
      const f=`out/b_${name}_rec_${fmt}`; await d.saveAs(f); console.log(name,"動画",fmt,d.suggestedFilename(),fs.statSync(f).size,"B");
      await p.waitForFunction(()=>/動画/.test(document.getElementById("m-rec").textContent),null,{timeout:60000}) }
  }
  console.log(name,"エラー",errs); await p.close();
}
await b.close();
