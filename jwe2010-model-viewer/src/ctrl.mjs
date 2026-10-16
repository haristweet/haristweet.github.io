// 見る操作を Playwright でたどる（tobal1・vf2・fv と同じ操作か）。out/c_*.png
//   ドラッグ＝回す、Shift＋ドラッグ・右ドラッグ＝平行に動かす、ホイール＝カーソルの所へ寄る、ダブルクリック＝戻す、右クリックのメニューは出さない
import {chromium} from "/opt/node22/lib/node_modules/playwright/index.mjs";
import path from "path";
const here=path.dirname(new URL(import.meta.url).pathname);
const b=await chromium.launch({args:["--use-gl=swiftshader","--enable-webgl","--ignore-gpu-blocklist"]});
const p=await b.newPage({viewport:{width:1100,height:900}}); const errs=[]; p.on("pageerror",e=>errs.push(e.message));
await p.goto("file://"+path.join(here,"../index.html"));
await p.setInputFiles("#f-save",path.join(here,"data/sekiguchi.p2s")); await p.waitForFunction(()=>/選手 \d+ 人/.test(document.getElementById("status").textContent));
await p.setInputFiles("#f-disc",path.join(here,"out/fake.iso")); await p.waitForFunction(()=>/三角形/.test(document.getElementById("info").textContent)); await p.waitForTimeout(500);
const bb=await p.locator("#cv").boundingBox(), cx=bb.x+bb.width/2, cy=bb.y+bb.height/2;
const v=()=>p.evaluate(()=>JSON.stringify({yaw:+APP.view.yaw.toFixed(2),pitch:+APP.view.pitch.toFixed(2),dist:Math.round(APP.view.dist),pan:(APP.view.pan||[0,0]).map(x=>Math.round(x))}));
const shot=n=>p.locator("#viewer").screenshot({path:`out/c_${n}.png`});
const drag=async(dx,dy,opt={})=>{ await p.mouse.move(cx,cy); if(opt.shift) await p.keyboard.down("Shift"); await p.mouse.down({button:opt.button||"left"}); await p.mouse.move(cx+dx,cy+dy,{steps:8}); await p.mouse.up({button:opt.button||"left"}); if(opt.shift) await p.keyboard.up("Shift"); await p.waitForTimeout(150) };
console.log("はじめ",await v()); await shot("0");
await drag(120,0); console.log("ドラッグ",await v()); await shot("1rot");
await p.dblclick("#cv"); console.log("ダブルクリック",await v());
await drag(150,60,{shift:true}); console.log("Shift＋ドラッグ",await v()); await shot("2shift");
await p.dblclick("#cv"); await drag(-150,0,{button:"right"}); console.log("右ドラッグ",await v()); await shot("3right");
await p.dblclick("#cv"); await shot("4reset");
// ホイール: 頭（画面の上の方）にカーソルを置いて寄る。頭がカーソルの下に残るか
const hx=cx, hy=bb.y+bb.height*0.2; await p.mouse.move(hx,hy); for(let i=0;i<6;i++){ await p.mouse.wheel(0,-200); await p.waitForTimeout(60) }
console.log("ホイール（頭の所で寄る）",await v()); await shot("5wheel");
console.log("エラー",errs.length?errs.join(" / "):"なし"); await b.close();
