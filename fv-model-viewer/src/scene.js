// セーブステートの主メモリから、そのコマでゲームがジオメトライザに送った命令の列を読む（VF2 の scene.js と同じ作り。番地だけ FV のもの）。
// 命令の語の上位 9bit（w>>>23）が番号。引数の語数: 物体1=4・枠3=6・モード7=1・8=1・焦点9=2・光10=3・行列11=12・12=3・LOD22=1、
// 13・16 は 1 語だけ。4 は [番地][語数 n][n 語]。bit31 の立った語は 1 語。15 で終わり。
const SC_OBJTBL=0x1f834f0, SC_OBJN=5413;   // 番号→読み込んだモデルの番地の表（2人 × 5413 語。モデルの頂点で確かめた）
// from: 読み始める番地（命令の列は 0x1288000 から 0x8000 おきにいくつもあり、コマが違う。どれが画面のコマかは調べ中）
function sceneRead(mem,from=0x1280000){
  const W32=new Uint32Array(mem.buffer,mem.byteOffset,mem.length>>2), F32=new Float32Array(mem.buffer,mem.byteOffset,mem.length>>2);
  const inv=new Map(), T=SC_OBJTBL>>2;
  for(let i=0;i<2*SC_OBJN;i++){ const v=W32[T+i]; if(v&&!inv.has(v)) inv.set(v,{player:(i/SC_OBJN)|0,id:i%SC_OBJN}) }
  const LEN={0:0,1:4,3:6,7:1,8:1,9:2,10:3,11:12,12:3,13:0,16:0,22:1};
  let start=-1; for(let j=from>>2;j<0x1300000>>2;j++) if(W32[j]===0x04800000){ start=j; break }
  if(start<0) throw new Error("命令の列が見つからない（対戦中のセーブステートではない？）");
  const draws=[], focal=[F32[start+1],F32[start+2]], windows=[]; let mat=null, light=null, n=0, unknown=0;
  for(let j=start;;){
    if(++n>100000) throw new Error("命令の列が終わらない");
    const w=W32[j];
    if(w>>>31){ j++; continue }
    const op=w>>>23;
    if(op===15) break;
    if(op===4){ j+=3+W32[j+2]; continue }
    if(!(op in LEN)) throw new Error("知らない命令 "+op+" at 0x"+(j*4).toString(16));
    if(op===11) mat=Array.from(F32.subarray(j+1,j+13));
    if(op===10&&!light) light=Array.from(F32.subarray(j+1,j+4));
    if(op===3) windows.push(Array.from(W32.subarray(j+1,j+7)));
    if(op===1){ const a=W32[j+4], o=inv.get(a); if(o&&mat) draws.push({player:o.player,id:o.id,m:mat,addr:a}); else if(a!==0xffffffff) unknown++ }
    j+=1+LEN[op];
  }
  return {focal,light,draws,windows,unknown};
}
// 色とテクスチャ（VF2 の g_geo と同じ並びの塊。FV は 0x12e7a80）: +0x40 色 RAM（16bit×1024）・+0x840 色の変換表（R・G・B、各 32 行×64）・
// +0x2040 明るさの曲線（128B ずつ）・+0xa040 テクスチャ（ページ 2 枚、各 幅 512・高さ 1024 の 4bit）。
// テクスチャのファイル（TEX_ROBnn）が 1P は +0xa040+0x40000、2P は +0xa040 に、128B ずつ行の間隔 256B で載っている所から逆算した
const SC_GEO=0x12e7a80;
function sceneColors(mem){
  const g=mem.subarray(SC_GEO,SC_GEO+0xa040+0x80000);
  return {tex:g.subarray(0xa040,0xa040+0x80000), cram:g.subarray(0x40,0x840), xlat:g.subarray(0x840,0x2040), clut:g.subarray(0x2040,0x2040+0x8000)};
}
// 光の設定（VU1 のデータの 0〜31 番＝拡散・環境・光沢・回数、32 番＝光の向き）。VF2 と同じ読み方
function sceneLight(vu1,sc){
  if(!vu1||vu1.length<34*16) return {tab:Array.from({length:32},()=>[63.5,31.5,0,0]), L:sc?sc.light:[0,-1,0], flags:7, fromVu:false};
  const dv=new DataView(vu1.buffer,vu1.byteOffset,vu1.byteLength), tab=[];
  for(let q=0;q<32;q++) tab.push([dv.getFloat32(q*16,true),dv.getFloat32(q*16+4,true),dv.getFloat32(q*16+8,true),dv.getUint32(q*16+12,true)]);
  return {tab, L:[0,1,2].map(i=>dv.getFloat32(32*16+i*4,true)), flags:dv.getUint32(32*16+12,true), fromVu:true};
}
