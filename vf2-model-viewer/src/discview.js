// ディスクだけで見る（セーブステートなし）。キャラの OBJ ファイルの部品を、姿勢なしで大きさをそろえて並べる。
// 色の材料はディスクから: 面の色＝FIXPAGE の 0x51000（写しの色 RAM と 1024 色のうち 899 色が同じ）、明るさの曲線＝IC12_15 の 0x78d10
// （写しの曲線と 256 本のうち 73 本が同じ。キャラが使う若い番号は同じ）、テクスチャ＝TEX_ROB（キャラ）と TEX_DFL を写しと同じ位置（ページ1 の 0〜767 行と 768 行〜）に置く。
// 色の変換表（明るさ→8bit）はステージごとにゲームが作るのでディスクに無い。ここではおおよその直線で作る（推測）
const DV_FIXPAGE_CRAM=0x51000, DV_IC_CURVE=0x78d10;
function dvXlat(){
  // [ch][行 0..31][明るさ 0..63]。48 以降（目などの特別な欄）は 0..15 を 0..47 に引き伸ばした値で埋める
  const x=new Uint8Array(0x1800);
  for(let ch=0;ch<3;ch++) for(let r=0;r<32;r++) for(let l=0;l<64;l++){
    const ll=l<48?l:(l-48)*47/15; x[ch*0x800+r*64+l]=Math.min(255,Math.round((r*8+7)*(0.22+0.62*ll/47)));
  }
  return x;
}
// cram: FIXPAGE の展開後、curve: IC12_15 の展開後、rob: TEX_ROB の1キャラぶん、dfl: TEX_DFL の展開後
function dvColors(fix,ic,rob,dfl){
  const tex=new Uint8Array(0x80000), P=1<<18;
  for(let y=0;y<768&&(y+1)*128<=rob.length;y++) tex.set(rob.subarray(y*128,(y+1)*128),P+y*256);
  for(let y=0;y<256&&(y+1)*128<=dfl.length;y++) tex.set(dfl.subarray(y*128,(y+1)*128),P+(768+y)*256);
  // IC12_15 は曲線の途中（230 本目あたり）で終わるので、足りない所は 0 で埋める（使うのは若い番号だけ）
  const clut=new Uint8Array(0x8000); clut.set(ic.subarray(DV_IC_CURVE,DV_IC_CURVE+0x8000));
  return {tex, cram:fix.slice(DV_FIXPAGE_CRAM,DV_FIXPAGE_CRAM+0x800), xlat:dvXlat(), clut};
}
// 部品を格子に並べた「場面」。only に番号を渡すとその1つだけを真ん中に置く
function dvScene(models,only){
  const ids=[...models.keys()].sort((a,b)=>a-b).filter(id=>only==null||id===only), box=new Map();
  for(const id of ids){ const e=models.get(id), mn=[1e9,1e9,1e9], mx=[-1e9,-1e9,-1e9];
    for(const p of objPolys(e.ch[3],e.ch[0],e.ch[2])) for(const v of p.v) for(let i=0;i<3;i++){ mn[i]=Math.min(mn[i],v[i]); mx[i]=Math.max(mx[i],v[i]) }
    if(mn[0]<=mx[0]) box.set(id,{c:mn.map((v,i)=>(v+mx[i])/2), s:Math.max(mx[0]-mn[0],mx[1]-mn[1])}) }
  const list=ids.filter(id=>box.has(id)), n=list.length||1, cols=Math.ceil(Math.sqrt(n*1.4)), rows=Math.ceil(n/cols);
  // 部品ごとに大きさをそろえる（欄の 0.85）。縮めすぎると行列の行列式が小さくなり影と見なされるので 0.4 倍までにする
  const cell=1, D=Math.max(cols*cell/2*600/220, rows*cell/2*600/170);
  const draws=list.map((id,k)=>{ const b=box.get(id), gx=(k%cols-(cols-1)/2)*cell, gy=((rows-1)/2-Math.floor(k/cols))*cell, s=Math.max(0.4,0.85*cell/Math.max(b.s,1e-4));
    return {player:0,id,m:[s,0,0,0,s,0,0,0,s,gx-b.c[0]*s,gy-b.c[1]*s,D-b.c[2]*s]} });
  return {draws, focal:[600,600], light:(globalThis.DV_LIGHT||[-0.88,-0.95,-0.1])};
}
