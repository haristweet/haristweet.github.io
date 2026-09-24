// ============================================================
//  トバルNo.1 のテクスチャを絵にする
//  キャラクターのモデルには貼り先（UV）が無い。面のバイトを数えると:
//    命令8 三角+法線 20B = 頂点番号12 + 法線8 → 余り0
//    命令9 四角+法線 24B = 頂点番号16 + 法線8 → 余り0
//    命令10 三角    12B = 頂点番号12        → 余り0
//    命令11 四角    16B = 頂点番号16        → 余り0
//    193×20 + 210×24 + 93×12 + 170×16 = 12,736 ＝ 面の領域ぴったり
//  1バイトも余らないので、UV の入る場所が無い。キャラクターは頂点の色だけで塗る。
//  だからテクスチャは「別物」として見る道具を用意する。
// ============================================================
// VRAM への転送は「パレット1枚 ＋ 画像1枚」の組で並ぶ。
// パレットは 高さ1 で 幅16（16色）か 幅256（256色）なので、そこで見分ける
function t1TexPairs(d){
  const found=findVramChainT1(d); if(!found) return null;
  const pairs=[]; let clut=null;
  for(const t of found.list){
    if(t.h===1&&(t.w===16||t.w===256)){ clut=t; continue }
    if(clut) pairs.push({clut,img:t,colors:clut.w});
  }
  return {pairs,info:found.info,blocks:found.list.length};
}
// プレステの色は BGR555。最上位ビットは半透明の印。全部0 の色は「透ける」決まり
function t1Color(v){
  return [(v&31)*255/31|0, ((v>>>5)&31)*255/31|0, ((v>>>10)&31)*255/31|0, v===0?0:255];
}
// 16色なら16bitの語に4画素、256色なら2画素。だから絵の幅は転送の幅の4倍か2倍になる
function t1TexRGBA(d,p){
  const dv=new DataView(d.buffer,d.byteOffset,d.byteLength);
  const pal=[];
  for(let i=0;i<p.colors;i++){
    const s=p.clut.off+i*2;
    pal.push(s+1<d.length?t1Color(dv.getUint16(s,true)):[0,0,0,0]);
  }
  const bpp=p.colors===16?4:8, per=16/bpp, mask=(1<<bpp)-1;
  const w=p.img.w*per, h=p.img.h;
  if(w<1||h<1||w*h>4194304) return null;
  const out=new Uint8ClampedArray(w*h*4);
  for(let j=0;j<h;j++) for(let i=0;i<p.img.w;i++){
    const s=p.img.off+(j*p.img.w+i)*2; if(s+1>=d.length) continue;
    const v=dv.getUint16(s,true);
    for(let k=0;k<per;k++){
      const c=pal[(v>>>(k*bpp))&mask]||[0,0,0,0], q=(j*w+i*per+k)*4;
      out[q]=c[0]; out[q+1]=c[1]; out[q+2]=c[2]; out[q+3]=c[3];
    }
  }
  return {w,h,data:out};
}
// モデルにテクスチャを貼れるかどうかを、面のバイトの内訳から判定する
function t1HasUV(run){
  if(!run||!run.used) return {uv:false,why:"面が読めていない"};
  const SZ={8:20,9:24,10:12,11:16}, NEED={8:20,9:24,10:12,11:16};
  let extra=0, total=0;
  for(const [op,n] of run.used){
    const sz=SZ[op]||0; total+=sz*n; extra+=(sz-(NEED[op]||sz))*n;
  }
  return {uv:extra>0, extra, total,
    why:extra>0?`1枚あたり ${extra} バイト余っている`
               :"頂点番号と法線で使い切っていて、UV の入る場所が1バイトも無い"};
}
