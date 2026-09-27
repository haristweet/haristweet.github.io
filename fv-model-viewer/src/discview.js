// ディスクだけで見る（セーブステートなし）。OBJ ファイルの部品を、姿勢なしで大きさをそろえて並べる（VF2 の discview.js と同じ作り）。
// 色の材料はディスクから: 面の色＝ROM_DATA の 0x100000（写しの色 RAM と 1024 色のうち 1023 色が同じ）、明るさの曲線＝ROM_EP1 の 0x266e0
// （写しの曲線と 256 本のうち若い番号の 7 本が同じ。キャラが使うのは若い番号）。テクスチャはアーケードのセット（fapp.js）。
// 色の変換表（明るさ→8bit）はステージごとにゲームが作るのでディスクに無い。ここではおおよその直線で作る（推測）
const DV_CRAM=0x100000, DV_CURVE=0x266e0;
function dvXlat(){
  // [ch][行 0..31][明るさ 0..63]。48 以降（目などの特別な欄）は 0..15 を 0..47 に引き伸ばした値で埋める
  const x=new Uint8Array(0x1800);
  for(let ch=0;ch<3;ch++) for(let r=0;r<32;r++) for(let l=0;l<64;l++){
    const ll=l<48?l:(l-48)*47/15; x[ch*0x800+r*64+l]=Math.min(255,Math.round((r*8+7)*(0.22+0.62*ll/47)));
  }
  return x;
}
function dvColors(data,ep1){
  const clut=new Uint8Array(0x8000); clut.set(ep1.subarray(DV_CURVE,Math.min(ep1.length,DV_CURVE+0x8000)));
  return {tex:new Uint8Array(0x80000), cram:data.slice(DV_CRAM,DV_CRAM+0x800), xlat:dvXlat(), clut};
}
// 部品を格子に並べた「場面」。only に番号を渡すとその1つだけを真ん中に置く
function dvScene(models,only){
  const ids=[...models.keys()].sort((a,b)=>a-b).filter(id=>only==null||id===only), box=new Map();
  for(const id of ids){ const e=models.get(id), mn=[1e9,1e9,1e9], mx=[-1e9,-1e9,-1e9];
    for(const p of objPolys(e.ch[3],e.ch[0],e.ch[2])) for(const v of p.v) for(let i=0;i<3;i++){ mn[i]=Math.min(mn[i],v[i]); mx[i]=Math.max(mx[i],v[i]) }
    if(mn[0]<=mx[0]) box.set(id,{c:mn.map((v,i)=>(v+mx[i])/2), s:Math.max(mx[0]-mn[0],mx[1]-mn[1])}) }
  const list=ids.filter(id=>box.has(id)), n=list.length||1, cols=Math.ceil(Math.sqrt(n*1.4)), rows=Math.ceil(n/cols);
  // 部品ごとに大きさをそろえる（欄の 0.85）。縮めすぎると行列の行列式が小さくなり影と見なされるので 0.4 倍までにする
  const cell=1, D=Math.max(cols*cell/2*480/220, rows*cell/2*480/170);
  const draws=list.map((id,k)=>{ const b=box.get(id), gx=(k%cols-(cols-1)/2)*cell, gy=((rows-1)/2-Math.floor(k/cols))*cell, s=Math.max(0.4,0.85*cell/Math.max(b.s,1e-4));
    return {player:0,id,m:[s,0,0,0,s,0,0,0,s,gx-b.c[0]*s,gy-b.c[1]*s,D-b.c[2]*s]} });
  return {draws, focal:[480,480], light:[-0.88,-0.95,-0.1]};
}
