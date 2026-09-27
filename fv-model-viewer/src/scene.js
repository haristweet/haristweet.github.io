// セーブステートの主メモリから、そのコマでゲームがジオメトライザに送った命令の列を読む（VF2 の scene.js と同じ作り。番地だけ FV のもの）。
// 命令の語の上位 9bit（w>>>23）が番号。引数の語数: 物体1=4・枠3=6・モード7=1・8=1・焦点9=2・光10=3・行列11=12・12=3・LOD22=1、
// 13・16 は 1 語だけ。4 は [番地][語数 n][n 語]。bit31 の立った語は 1 語。15 で終わり。
const SC_OBJTBL=0x1f834f0, SC_OBJN=5413;   // 番号→読み込んだモデルの番地の表（2人 × 5413 語。モデルの頂点で確かめた）
function sceneRead(mem){
  const W32=new Uint32Array(mem.buffer,mem.byteOffset,mem.length>>2), F32=new Float32Array(mem.buffer,mem.byteOffset,mem.length>>2);
  const inv=new Map(), T=SC_OBJTBL>>2;
  for(let i=0;i<2*SC_OBJN;i++){ const v=W32[T+i]; if(v&&!inv.has(v)) inv.set(v,{player:(i/SC_OBJN)|0,id:i%SC_OBJN}) }
  const LEN={0:0,1:4,3:6,7:1,8:1,9:2,10:3,11:12,12:3,13:0,16:0,22:1};
  let start=-1; for(let j=0x1280000>>2;j<0x1300000>>2;j++) if(W32[j]===0x04800000){ start=j; break }
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
