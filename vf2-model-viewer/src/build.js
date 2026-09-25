// 場面の2人（と背景）を、描くための頂点の配列にする（WebGL でも node の台本でも使う）。
// 頂点ごとに 21 個の数: 位置3（カメラの座標）・法線3・色 RAM の 5bit×3・テクスチャの loc2・org2・size2・テクスチャ（0 なし・1 あり・2 あり＋値 15 を抜く）・ページ・パレット番号・面の頭の bit10-11 と bit17-22（(h>>10&3)|((h>>17&63)<<2)）・明るさの係数2（環境・拡散）
const BUILD_STRIDE=21;
// models: {0: 1P のモデル, 1: 2P のモデル, stage: ステージのモデル}（どれも Map 番号→モデル）。
// opt.which: "body"（影以外）か "shadow"（影だけ）。opt.players: [1P を出すか, 2P を出すか]。opt.stage: 背景を出すか（false で出さない）
function sceneMesh(sc,col,models,opt={}){
  const out=[], missing=new Set(); let shadows=0; const which=opt.which||"body";
  const cram=new DataView(col.cram.buffer,col.cram.byteOffset,col.cram.byteLength);
  for(const d of sc.draws){
    let e=models[d.player]&&models[d.player].get(d.id), isStage=false;
    if(!e&&d.player===0&&models.stage){ e=models.stage.get(d.id); isStage=!!e }   // ステージの部品は 1P の表に入っている
    if(!e){ missing.add(d.id); continue }
    const m=d.m, det=m[0]*(m[4]*m[8]-m[5]*m[7])-m[1]*(m[3]*m[8]-m[5]*m[6])+m[2]*(m[3]*m[7]-m[4]*m[6]);
    const shadow=!isStage&&Math.abs(det)<0.05;   // 床に潰した影（行列の縦がほぼ 0。01 の写しで 343〜354 など）
    if(shadow) shadows++;
    if((which==="shadow")!==shadow) continue;
    if(isStage?opt.stage===false:(opt.players&&!opt.players[d.player])) continue;
    const T=v=>[v[0]*m[0]+v[1]*m[3]+v[2]*m[6]+m[9], v[0]*m[1]+v[1]*m[4]+v[2]*m[7]+m[10], v[0]*m[2]+v[1]*m[5]+v[2]*m[8]+m[11]];
    // 属性の表は 1P（とステージ）が塊0、2P が塊1
    for(const p of objPolys(e.ch[3],e.ch[d.player?1:0],e.ch[2])){
      const q=p.v.map(T), a=q[1].map((x,i)=>x-q[0][i]), b=q[2].map((x,i)=>x-q[0][i]);
      const n=[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]], l=Math.hypot(...n)||1; for(let i=0;i<3;i++) n[i]/=l;
      const c16=cram.getUint16((p.attr[3]>>6&1023)*2,true), c5=[c16&31,c16>>5&31,c16>>10&31];
      let tx=null; if(p.attr[0]>>14&1) tx=texCoords(p.attr,p.uv);
      const lk=BUILD_LIGHT[p.h>>18&31]||BUILD_LIGHT_ALL;
      const vert=k=>{ out.push(...q[k],...n,...c5);
        if(tx) out.push(...tx.loc[k],...tx.org,...tx.size,(p.attr[0]>>13&1)?2:1,tx.page,p.attr[1]&255); else out.push(0,0,0,0,1,1,0,0,0);
        out.push((p.h>>10&3)|((p.h>>17&63)<<2),...lk) };
      for(let i=1;i+1<q.length;i++){ vert(0); vert(i); vert(i+1) }
    }
  }
  return {data:new Float32Array(out), count:out.length/BUILD_STRIDE, missing:[...missing], shadows};
}
// 明るさ（0〜63）＝パレットの値（テクスチャなしは 36）×(環境＋拡散×max(0, 法線・光))。法線は頂点の並びから、光は命令 10 の向き。
// 環境・拡散の係数は、面の頭の bit18-22（面ごとの光の設定。ゲームの値）ごとに、5つの写しの写真の画素（キャラと背景、約 67 万）に当てはめたもの（light.mjs）。
// 設定 31（光の影響を受けない。パレット 1 の値 49〜56 がそのまま色の変換表の特別な欄＝木の緑などを指す）は 1.0 に固定。
// 当てはめに使わなかった写しで、写真とのずれが全体の係数より減るのを確かめた（04・05: 5.72→3.96、背景込みの 05: 7.99→6.91）。ゲームの本当の計算（VU1）は読んでいない
const BUILD_LIGHT={2:[1.33,0],3:[0.7,0.57],4:[0.56,1.08],5:[0.67,1.01],6:[0.47,1.4],7:[1.03,0.84],10:[1.25,0.57],11:[0.72,1.09],16:[1.43,0.14],19:[0.35,0.49],21:[1.21,0],28:[1.66,0],31:[1,0]}, BUILD_LIGHT_ALL=[1.12,0.02], BUILD_FLAT=36;
function buildLuma(texVal,dot,lk){ const k=lk[0]+lk[1]*Math.max(0,dot); return Math.max(0,Math.min(63,Math.floor((texVal<0?BUILD_FLAT:texVal)*k))) }
// OBJ ファイル（展開後のモデルの一覧）の候補から、そのプレイヤーが描いた番号をいちばん多く含むものを選ぶ
// （1P の表にはステージの部品も入っているので「全部」は求めない。同じ数なら先の候補＝1色目）。skip の番号は数えない
function sceneChooseModels(sc,player,candidates,skip){
  const need=new Set(sc.draws.filter(d=>d.player===player&&!(skip&&skip.has(d.id))).map(d=>d.id)); let best=null;
  for(const c of candidates){ const map=new Map(c.models.map(m=>[m.id,m])); let n=0; for(const id of need) if(map.has(id)) n++;
    if(n>0&&(!best||n>best.n)) best={name:c.name,map,n} }
  return best;
}
