// 場面の2人を、描くための頂点の配列にする（WebGL でも node の試験でも使う）。
// 頂点ごとに 18 個の数: 位置3（カメラの座標）・法線3・色 RAM の 5bit×3・テクスチャの loc2・org2・size2・あり/なし・ページ・パレット番号
const BUILD_STRIDE=18;
function sceneMesh(sc,col,models,opt={}){
  const out=[], missing=new Set(); let shadows=0;
  const cram=new DataView(col.cram.buffer,col.cram.byteOffset,col.cram.byteLength);
  for(const d of sc.draws){
    const e=models[d.player]&&models[d.player].get(d.id); if(!e){ missing.add(d.id); continue }
    const m=d.m, det=m[0]*(m[4]*m[8]-m[5]*m[7])-m[1]*(m[3]*m[8]-m[5]*m[6])+m[2]*(m[3]*m[7]-m[4]*m[6]);
    const shadow=Math.abs(det)<0.05;   // 床に潰した影（行列の縦がほぼ 0。01 の写しで 343〜354 など）
    if(shadow){ shadows++; if(!opt.shadow) continue }
    if(opt.players&&!opt.players[d.player]) continue;
    const T=v=>[v[0]*m[0]+v[1]*m[3]+v[2]*m[6]+m[9], v[0]*m[1]+v[1]*m[4]+v[2]*m[7]+m[10], v[0]*m[2]+v[1]*m[5]+v[2]*m[8]+m[11]];
    // 属性の表は 1P が塊0、2P が塊1
    for(const p of objPolys(e.ch[3],e.ch[d.player?1:0],e.ch[2])){
      const q=p.v.map(T), a=q[1].map((x,i)=>x-q[0][i]), b=q[2].map((x,i)=>x-q[0][i]);
      const n=[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]], l=Math.hypot(...n)||1; for(let i=0;i<3;i++) n[i]/=l;
      const c16=cram.getUint16((p.attr[3]>>6&1023)*2,true), c5=[c16&31,c16>>5&31,c16>>10&31];
      let tx=null; if(p.attr[0]>>14&1) tx=texCoords(p.attr,p.uv);
      const vert=k=>{ out.push(...q[k],...n,...c5);
        if(tx) out.push(...tx.loc[k],...tx.org,...tx.size,1,tx.page,p.attr[1]&255); else out.push(0,0,0,0,1,1,0,0,0) };
      for(let i=1;i+1<q.length;i++){ vert(0); vert(i); vert(i+1) }
    }
  }
  return {data:new Float32Array(out), count:out.length/BUILD_STRIDE, missing:[...missing], shadows};
}
// キャラの OBJ ファイル（展開後のモデルの一覧）から、そのプレイヤーが描いた番号をいちばん多く含むものを選ぶ
// （1P の表にはステージの部品も入っているので「全部」は求めない。同じ数なら先の候補＝1色目）
function sceneChooseModels(sc,player,candidates){
  const need=new Set(sc.draws.filter(d=>d.player===player).map(d=>d.id)); let best=null;
  for(const c of candidates){ const map=new Map(c.models.map(m=>[m.id,m])); let n=0; for(const id of need) if(map.has(id)) n++;
    if(n>0&&(!best||n>best.n)) best={name:c.name,map,n} }
  return best;
}
