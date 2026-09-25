// テクスチャのシート（本体のテクスチャ用メモリ g_geo+0xa040 と同じ並び）。1024×512 の 4bit が2ページ、1行 512B。
// TEX_ROB.MRG の1人ぶん（展開 98304B）は、128B の行 r をシートの行 r>>1・横 (r&1)*512 画素に置く（本体 sysGeoWriteRobTex）。
// 1P（player 0）はページ1、2P はページ0
function texSheetNew(){ return new Uint8Array(0x80000) }
function texPutRob(sheet,rob,player){
  const base=(player^1)<<18;
  for(let r=0;r<768;r++) sheet.set(rob.subarray(r*128,r*128+128),base+r*256);
}
function texNibble(sheet,page,X,Y){
  X&=1023; Y&=511;
  const b=sheet[(page<<18)+Y*512+(X>>1)];
  return X&1?b>>4:b&15;
}
