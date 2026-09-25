// セーブステートの主メモリ（eeMemory.bin、32MB）から、そのコマの場面を読む（教訓3: ゲーム自身の値だけを使う）。
// 本体 SLPM_625.47 の名前の表: g_geo 0x135a000、g_objTbl 0x1fc8760（2人×5125 語、モデル番号→変換済みモデルの番地）
const SC_GEO=0x135a000, SC_OBJTBL=0x1fc8760;
// ジオメトライザへの命令の列を読む。焦点距離の命令 0x04800000 から1つずつ読み、「終わり」（番号 15）で止める。
// 命令＝上位 bit23〜の番号（下位 23bit は 0）。引数の語数: 物体1=4・枠3=6・モード7=1・8=1・焦点9=2・光10=3・行列11=12・12=3・LOD22=1。
// bit31 の立った語は別の所を呼ぶ1語。物体の4つ目の引数を g_objTbl で逆に引くとモデル番号と 1P/2P
function sceneRead(mem){
  const W32=new Uint32Array(mem.buffer,mem.byteOffset,mem.length>>2), F32=new Float32Array(mem.buffer,mem.byteOffset,mem.length>>2);
  const inv=new Map(), T=SC_OBJTBL>>2;
  for(let i=0;i<10250;i++){ const v=W32[T+i]; if(v&&!inv.has(v)) inv.set(v,{player:(i/5125)|0,id:i%5125}) }
  const LEN={0:0,1:4,3:6,7:1,8:1,9:2,10:3,11:12,12:3,22:1};
  let start=-1; for(let j=0xf50000>>2;j<0xfa0000>>2;j++) if(W32[j]===0x04800000){ start=j; break }
  if(start<0) throw new Error("命令の列が見つからない（対戦中のセーブステートではない？）");
  const draws=[], focal=[F32[start+1],F32[start+2]]; let mat=null, light=null, n=0;
  for(let j=start;;){
    if(++n>100000) throw new Error("命令の列が終わらない");
    const w=W32[j];
    if(w>>>31){ j++; continue }
    const op=w>>>23;
    if(op===15) break;
    if(w&0x7fffff||!(op in LEN)) throw new Error("命令の列に知らない語 "+w.toString(16)+"（"+(j*4).toString(16)+"）");
    if(op===11) mat=Array.from(F32.subarray(j+1,j+13));
    if(op===10&&!light) light=Array.from(F32.subarray(j+1,j+4));
    if(op===1){ const o=inv.get(W32[j+4]); if(o&&mat) draws.push({player:o.player,id:o.id,m:mat}) }
    j+=1+LEN[op];
  }
  return {draws,focal,light:light||[0,-1,0]};
}
// 場面の色とテクスチャの材料（すべて g_geo の中）
//   テクスチャ用メモリ +0xa040（512KB。1ページ＝幅 512・高さ 1024 の 4bit、1行 256B。1P はページ1）
//   面の色 RAM +0x40（16bit×1024、R が下位5bit）、色の変換表 +0x840・+0x1040・+0x1840（R・G・B、各 32行×64）
//   パレット（テクスチャの明るさの表）+0x2040（128B×番号）
function sceneColors(mem){
  const g=mem.subarray(SC_GEO,SC_GEO+0xa040+0x80000);
  return {tex:g.subarray(0xa040,0xa040+0x80000), cram:g.subarray(0x40,0x840), xlat:g.subarray(0x840,0x2040), clut:g.subarray(0x2040,0x2040+0x8000)};
}
// どのキャラのテクスチャが置かれているか（TEX_ROB.MRG の番号）。ページごとに 768 行を比べて、いちばん一致するもの
const SC_ROB=["AKI","JAC","SAR","KAG","LAU","JEF","PAI","WOL","SUI","DUR","TOU"];
function sceneWhichRob(tex,robs){
  const res=[];
  for(const page of [1,0]){   // 1P, 2P の順
    let best=[-1,0];
    robs.forEach((r,i)=>{ let same=0;
      for(let k=0;k<768;k+=8){ let ok=true; const a=(page<<18)+k*256, b=k*128; for(let x=0;x<128;x+=4) if(tex[a+x]!==r[b+x]){ ok=false; break } if(ok) same++ }
      if(same>best[1]) best=[i,same] });
    res.push(best[1]>=48?best[0]:-1);
  }
  return res;
}
