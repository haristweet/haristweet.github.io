// 単体試験。ページの .js を1つの文脈に読み、本物のデータ（disc/ にあれば）で確かめる。node test.mjs
import fs from "fs"; import vm from "vm"; import assert from "assert";
const ctx={console,TextDecoder,Blob,File,Response,DecompressionStream,Uint8Array}; vm.createContext(ctx);
for(const f of ["zstd.js","p2s.js","cricmp.js","obj.js","tex.js","scene.js","vdisc.js"]) vm.runInContext(fs.readFileSync(f,"utf8"),ctx,{filename:f});
const g=n=>vm.runInContext(n,ctx);
let ok=0; const t=async(name,fn)=>{ await fn(); ok++; console.log("  ok",name) };
// 偽のデータでの試験（データが無くても回る）
await t("CRICMP: 旗と写しと繰り返し",()=>{
  // 手で作った 1 組: 旗 0x0001 → 1項目目はそのまま 2バイト、2項目目は w=0x0000 → 直前を 3 回
  const body=[0x00,0x00,0x00,0x00, 0x00,0x01, 0x41,0x42, 0x00,0x00, 0x00,0x02];
  const h=new Uint8Array(0x20+2+body.length); h.set([...Buffer.from("CRICMP")]); h.set([...Buffer.from("2.10")],8);
  new DataView(h.buffer).setUint32(0x14,4,true); new DataView(h.buffer).setUint32(0x18,0x20,true);
  // 数: 0 組、残り 2 項目、切り詰め 1
  const b2=[0x00,0x00, 0x00,0x00,0x00,0x00, 0x01,0x02, 0x00,0x01, 0x41,0x42, 0x00,0x00];
  const src=new Uint8Array(0x20+b2.length); src.set(h.subarray(0,0x20)); src.set(b2,0x20);
  const out=g("cricmpUnpack")(src); assert.deepEqual([...out],[0x41,0x42,0x42,0x42]);
});
const has=f=>fs.existsSync(f);
if(has("disc/vf2.bin")){
  let files;
  await t("ディスク: BIN.CVM の中の 120 ファイル",async()=>{ files=await g("discOpen")(new File([fs.readFileSync("disc/vf2.bin")],"vf2.bin")); assert.equal(files.size,120) });
  await t("ディスク: OBJ_AKI1 を展開して 116 モデル・最後まで区切れる",async()=>{
    const m=g("objModels")(g("cricmpUnpack")(await files.get("OBJ_AKI1.CMP")())); assert.equal(m.length,116) });
  if(has("disc/states")){
    const robs=[]; { const mrg=await files.get("TEX_ROB.MRG")(), dv=new DataView(mrg.buffer,mrg.byteOffset), n=dv.getUint32(0,true);
      for(let i=0;i<n;i++){ const o=dv.getUint32(4+i*4,true), e=i+1<n?dv.getUint32(8+i*4,true):mrg.length; robs.push(g("cricmpUnpack")(mrg.subarray(o,e))) } }
    const expect={"01_akira_lau":["AKI","LAU",111],"02_pai_sarah":["PAI","SAR",108],"03_wolf_jeffry":["WOL","JEF",106],"04_kage_jacky":["KAG","JAC",121],"05_shun_lion":["SUI","TOU",112],"06_akira_akira":["AKI","AKI",118],"07_pai_pai":["PAI","PAI",108]};
    for(const [s,[p1,p2,nd]] of Object.entries(expect)){
      const f="disc/states/"+s+".p2s"; if(!has(f)) continue;
      await t("写し "+s+": 命令の列・キャラの見分け",async()=>{
        const z=await g("p2sOpen")(fs.readFileSync(f)), mem=await z.get("eeMemory.bin")();
        assert.equal(mem.length,32<<20);
        const sc=g("sceneRead")(mem); assert.equal(sc.draws.length,nd); assert.deepEqual(sc.focal,[600,600]);
        const who=g("sceneWhichRob")(g("sceneColors")(mem).tex,robs).map(i=>g("SC_ROB")[i]);
        assert.deepEqual(who,[p1,p2]);
        const li=g("sceneLight")(await z.get("vu1Memory.bin")(),sc); assert.ok(li.fromVu); assert.equal(li.tab.length,32);
        assert.ok(Math.abs(Math.hypot(...li.L)-Math.hypot(...sc.light))<0.05,"VU1 の光のベクトルが命令 10 とほぼ同じ長さ");
        assert.deepEqual(li.tab[31].slice(0,3),[0,127.5,0]);   // 設定 31＝光の影響を受けない（木など）
      });
    }
  }
}
console.log(ok,"件 ok");
