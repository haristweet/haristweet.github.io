// 顔の一覧（教訓1）。ページそのもの（../index.html）で、写しごと・プレイヤーごとに頭へ寄り、4つの向きから撮って1枚に並べる。
//   node faces.mjs [出力 out/faces.png]
// 頭＝目や眉の貼りもの（光の設定 31 で、属性 h1 の上位バイト≠0 の面）を持つ部品のうち高い所にあるもの。貼りものの中心に寄る。版を上げたら前の out/faces.png と見比べる
import {chromium} from "/opt/node22/lib/node_modules/playwright/index.mjs";
import fs from "fs"; import path from "path";
const here=path.dirname(new URL(import.meta.url).pathname), outp=process.argv[2]||path.join(here,"out/faces.png");
const states=fs.readdirSync(path.join(here,"disc/states")).filter(f=>f.endsWith(".p2s")).sort().map(f=>path.join(here,"disc/states",f));
const b=await chromium.launch({args:["--use-gl=swiftshader","--enable-webgl","--ignore-gpu-blocklist"]});
const p=await b.newPage({viewport:{width:900,height:800}}); const errs=[]; p.on("pageerror",e=>errs.push(e.message));
await p.goto("file://"+path.join(here,"../index.html"));
await p.setInputFiles("#f-state",states); await p.setInputFiles("#f-disc",path.join(here,"disc/vf2.bin"));
await p.waitForFunction(()=>document.getElementById("info").textContent.length>0,null,{timeout:120000});
await p.uncheck("#c-stage"); await p.uncheck("#c-shadow");
const version=await p.evaluate(()=>VERSION), rows=[];
for(let si=0;si<states.length;si++){
  await p.evaluate(async i=>{ APP.cur=i; await show() },si);
  for(const pl of [0,1]){
    await p.evaluate(pl=>{ document.getElementById("c-p1").checked=pl===0; document.getElementById("c-p2").checked=pl===1;
      document.getElementById("c-p1").dispatchEvent(new Event("change")); document.getElementById("c-p2").dispatchEvent(new Event("change")) },pl);
    const head=await p.evaluate(pl=>{
      // 貼りもの（光の設定 31・h1 の上位バイト≠0）を持つ部品ごとに、その面の中心（カメラの座標）と数を出す
      const S=APP.scene, c=[];
      for(const d of S.sc.draws){ if(d.player!==pl) continue; const e=S.models[pl]&&S.models[pl].get(d.id); if(!e) continue; const m=d.m;
        let n=0, s=[0,0,0];
        for(const q of objPolys(e.ch[3],e.ch[pl],e.ch[2])) if((q.h>>18&31)===31&&(q.attr[1]>>8)) for(const v of q.v){ n++;
          s[0]+=v[0]*m[0]+v[1]*m[3]+v[2]*m[6]+m[9]; s[1]+=v[0]*m[1]+v[1]*m[4]+v[2]*m[7]+m[10]; s[2]+=v[0]*m[2]+v[1]*m[5]+v[2]*m[8]+m[11] }
        if(n) c.push({id:d.id,n,c:s.map(x=>x/n),name:S.names[pl]}) }
      return c;
    },pl);
    if(process.env.DUMP){ console.log(path.basename(states[si]),pl,JSON.stringify(head.map(h=>[h.id,h.n,h.c.map(x=>+x.toFixed(2))]))); continue }
    // カメラの座標は y が上。いちばん高い部品から 0.07 以内のうち、貼りものがいちばん多い部品を頭とする（胴の刺繍や耳飾りをよける）
    const top=Math.max(...head.map(h=>h.c[1])), hd=head.filter(h=>h.c[1]>top-0.07).sort((a,b)=>b.n-a.n)[0];
    const row={label:`${path.basename(states[si],".p2s")} ${pl+1}P ${hd?hd.name+" 頭 "+hd.id:"頭が見つからない"}`,shots:[]};
    if(hd) for(let k=0;k<4;k++){
      await p.evaluate(([c,k])=>{ window.center=()=>c; APP.pan=[-c[0],-c[1]]; APP.zoom=c[2]*1.4; APP.rot=[k*Math.PI/2,0]; draw() },[hd.c,k]);
      await p.waitForTimeout(100);
      const box=await p.locator("#cv").boundingBox(), s=box.height*0.8;
      row.shots.push("data:image/png;base64,"+(await p.screenshot({clip:{x:box.x+box.width/2-s/2,y:box.y+box.height/2-s/2,width:s,height:s}})).toString("base64"));
    }
    rows.push(row);
  }
}
// 並べる（ラベル付きの表を同じブラウザで描いて撮る）
const q=await b.newPage({viewport:{width:8*180+60,height:600}}), cell=r=>`<div style="display:inline-block;vertical-align:top;margin:0 10px 8px 0"><div>${r.label}</div>`+r.shots.map(s=>`<img src="${s}" style="width:180px;height:180px">`).join("")+"</div>";
// 1行に 1P と 2P を並べる
await q.setContent(`<body style="margin:0;padding:10px;background:#222;color:#ddd;font:13px sans-serif;white-space:nowrap"><div>VF2 顔の一覧 v${version}（頭の周りで横に 90° ずつ回す）</div>`+
  rows.map((r,i)=>(i%2?"":"<div>")+cell(r)+(i%2?"</div>":"")).join("")+"</body>");
await q.screenshot({path:outp,fullPage:true}); await b.close();
console.log(outp,"行",rows.length,"頭なし",rows.filter(r=>!r.shots.length).length,"エラー",errs);
