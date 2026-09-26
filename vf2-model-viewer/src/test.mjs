// 単体試験。ページの .js を1つの文脈に読み、本物のデータ（disc/ にあれば）で確かめる。node test.mjs
import fs from "fs"; import vm from "vm"; import assert from "assert";
const ctx={console,TextDecoder,Blob,File,Response,DecompressionStream,Uint8Array}; vm.createContext(ctx);
for(const f of ["zstd.js","p2s.js","cricmp.js","obj.js","tex.js","scene.js","build.js","m2scr.js","vdisc.js"]) vm.runInContext(fs.readFileSync(f,"utf8"),ctx,{filename:f});
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
    // 部品の数は、毎コマ作り直す腹の帯（1人1つ）を含む
    const expect={"01_akira_lau":["AKI","LAU",113],"02_pai_sarah":["PAI","SAR",110],"03_wolf_jeffry":["WOL","JEF",108],"04_kage_jacky":["KAG","JAC",123],"05_shun_lion":["SUI","TOU",114],"06_akira_akira":["AKI","AKI",120],"07_pai_pai":["PAI","PAI",110],
      // 同じキャラ同士・投げ・倒れ・ソフトウェア描画・一時停止中など（08〜19）
      "08_wolf_wolf_cc":["WOL","WOL",93],"09_wolf_wolf_dd":["WOL","WOL",94],"10_shun_shun_ee":["SUI","SUI",104],"11_wolf_wolf_hh":["WOL","WOL",94],
      "12_wolftest":["WOL","WOL",94],"13_jeffrytest":["JEF","JEF",112],"14_jeffrytest2":["JEF","JEF",112],"15_wolftest2":["WOL","WOL",94],
      "16_jacky_jacky_gg":["JAC","JAC",112],"17_jacky_somersault":["JAC","JAC",120],"18_jacky_lau":["JAC","LAU",114],"19_jacky_sarah":["JAC","SAR",102],
      "20_akira_lion":["AKI","TOU",111],"21_jacky_win":["JAC","SAR",105],
      "22_shun_lau_ringout":["SUI","LAU",99],"23_akira_lion_ringout":["AKI","TOU",109],"24_kage_jeffry_beach":["KAG","JEF",146]};
    for(const [s,[p1,p2,nd]] of Object.entries(expect)){
      const f="disc/states/"+s+".p2s"; if(!has(f)) continue;
      await t("写し "+s+": 命令の列・キャラの見分け",async()=>{
        const z=await g("p2sOpen")(fs.readFileSync(f)), mem=await z.get("eeMemory.bin")();
        assert.equal(mem.length,32<<20);
        const sc=g("sceneRead")(mem); assert.equal(sc.draws.length,nd); assert.deepEqual(sc.focal,[600,600]);
        // 腹の帯: 1P と 2P に1つずつ、面がある（ファイルの帯と同じ 16 面）
        const dyn=sc.draws.filter(d=>d.dyn); assert.deepEqual(dyn.map(d=>d.player).sort(),[0,1]);
        for(const d of dyn) assert.equal(g("objPolys")(d.dyn.ch[3],d.dyn.ch[0],d.dyn.ch[2]).length,16);
        const who=g("sceneWhichRob")(g("sceneColors")(mem).tex,robs).map(i=>g("SC_ROB")[i]);
        assert.deepEqual(who,[p1,p2]);
        const li=g("sceneLight")(await z.get("vu1Memory.bin")(),sc); assert.ok(li.fromVu); assert.equal(li.tab.length,32);
        assert.ok(Math.abs(Math.hypot(...li.L)-Math.hypot(...sc.light))<0.05,"VU1 の光のベクトルが命令 10 とほぼ同じ長さ");
        assert.deepEqual(li.tab[31].slice(0,3),[0,127.5,0]);   // 設定 31＝光の影響を受けない（木など）
        // 空: 奥の面は消えておらず、画面の上端の行はすべて塗られている（空に透明の穴が無い）
        const sk=g("scrRead")(mem), bk=g("scrBack")(sk); assert.equal(sk.regs[6]&0x8000,0);
        for(let x=0;x<496;x++) assert.equal(bk[x*4+3],255,"空の上端 x="+x);
      });
    }
    if(has("disc/states/17_jacky_somersault.p2s")) await t("写し 17: 床への映り込み（行列式が負の部品）は OBJ_JAC1B・JAC2B にある",async()=>{
      const z=await g("p2sOpen")(fs.readFileSync("disc/states/17_jacky_somersault.p2s")), sc=g("sceneRead")(await z.get("eeMemory.bin")());
      const obj=async n=>({name:n,models:g("objModels")(g("cricmpUnpack")(await files.get(n)()))});
      for(const [pl,a,b] of [[0,"OBJ_JAC1.CMP","OBJ_JAC1B.CMP"],[1,"OBJ_JAC2.CMP","OBJ_JAC2B.CMP"]]){
        const ch=g("sceneAddCompanions")(g("sceneChooseModels")(sc,pl,[await obj(a)]),sc,pl,[await obj(b)]);
        assert.deepEqual(ch.used,[b]);
        const mir=sc.draws.filter(d=>d.player===pl&&!d.dyn&&(m=>m[0]*(m[4]*m[8]-m[5]*m[7])-m[1]*(m[3]*m[8]-m[5]*m[6])+m[2]*(m[3]*m[7]-m[4]*m[6]))(d.m)<-0.05);
        assert.equal(mir.length,pl?4:6); for(const d of mir) assert.ok(ch.map.has(d.id));
      }
    });
  }
}
console.log(ok,"件 ok");
