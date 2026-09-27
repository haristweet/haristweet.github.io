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

// 面の UV（1/8 画素）から、テクスチャ用メモリの画素の位置を出す（本体 0x1c6380・0x1c6e40 を写し、写しの ST と一致を確かめた）。
// 属性 h0: bit0-2 縦の大きさ・bit3-5 横の大きさ（32..2048）。h2: 下位6bit×32＝原点X（T 側）、次の6bit×32−1024＝原点Y（S 側）、
// 原点X≥1024 なら X−=1024・Y+=1024。bit12＝ページ。UV は +10 して、面の中の最小値が大きさの外なら大きさの倍数ぶん戻す。
// テクスチャ用メモリの1ページ＝幅 512・高さ 1024 の 4bit（1行 256B）。S*1024＝ページ*512＋(u'/8+Y)/4？ ではなく
// ページ内の横 px＝(u'/8+原点Y)/4、縦 py＝v'/8+原点X（GS の S,T を 1024 倍したもの）
const TEX_SZ=[32,64,128,256,512,1024,2048,2048];
function texCoords(attr,uv){
  const [h0,,h2]=attr, su=TEX_SZ[h0>>3&7]*8, sv=TEX_SZ[h0&7]*8;
  let X=(h2&63)*32, Y=(h2>>6&63)*32-1024; if(X>=1024){ X-=1024; Y+=1024 }
  const mu=Math.min(...uv.map(a=>a[0])), mv=Math.min(...uv.map(a=>a[1]));
  const ku=Math.floor((mu+7)/su)*su, kv=Math.floor((mv+7)/sv)*sv;
  // org＝ページ内の原点、size＝ページ内の大きさ（横は 1/4）、loc＝原点からの位置（大きさを越えた分は描くときに折り返す）
  const loc=uv.map(([u,v])=>[(u+10-ku)/32, (v+10-kv)/8]);
  return {page:h2>>12&1, org:[Y/4,X], size:[su/32,sv/8], loc, st:loc.map(([a,b])=>[a+Y/4,b+X])};
}
// テクスチャ用メモリ（g_geo+0xa040 の 512KB）から 4bit を読む
function texRam(ram,page,px,py){
  px=Math.floor(px)&511; py=Math.floor(py)&1023;
  const b=ram[(page<<18)+py*256+(px>>1)];
  return px&1?b>>4:b&15;
}
