// 場面の2人（と背景）を、描くための頂点の配列にする（WebGL でも node の台本でも使う）。
// 頂点ごとに 24 個の数: 位置3（カメラの座標）・法線3・色 RAM の 5bit×3・テクスチャの loc2・org2・size2・テクスチャ（0 なし・1 あり・2 あり＋値 15 を抜く）・ページ・パレット番号・面の頭の bit10-11 と bit17-22（(h>>10&3)|((h>>17&63)<<2)）・光の表の値4（拡散・環境・光沢・光沢の回数）・旗（1＝光の設定 10〜12、2＝貼りもの＝h1 の上位バイトが 0 でない。目や眉）
const BUILD_STRIDE=24;
// models: {0: 1P のモデル, 1: 2P のモデル, stage: ステージのモデル}（どれも Map 番号→モデル）。
// opt.which: "body"（影以外）か "shadow"（影だけ）。opt.players: [1P を出すか, 2P を出すか]。opt.stage: 背景を出すか（false で出さない）
function sceneMesh(sc,col,models,opt={}){
  const out=[], missing=new Set(), mirror=[-1,-1]; let shadows=0; const which=opt.which||"body";
  const cram=new DataView(col.cram.buffer,col.cram.byteOffset,col.cram.byteLength);
  for(const d of sc.draws){
    let e=d.dyn||(models[d.player]&&models[d.player].get(d.id)), isStage=false;
    if(!e&&d.player===0&&models.stage){ e=models.stage.get(d.id); isStage=!!e }   // ステージの部品は 1P の表に入っている
    if(!e){ missing.add(d.id); continue }
    const m=d.m, det=m[0]*(m[4]*m[8]-m[5]*m[7])-m[1]*(m[3]*m[8]-m[5]*m[6])+m[2]*(m[3]*m[7]-m[4]*m[6]);
    const shadow=!isStage&&Math.abs(det)<0.05;   // 床に潰した影（行列の縦がほぼ 0。01 の写しで 343〜354 など）
    if(shadow) shadows++;
    if((which==="shadow")!==shadow) continue;
    if(isStage?opt.stage===false:(opt.players&&!opt.players[d.player])) continue;
    // 映り込み（行列式が負の部品。OBJ_*B）: ゲームは命令の列の組の順に描き、映り込みの組のあとにリングの床の組が来るので床に隠れる。
    // 映り込みの前の組（縁の帯など）の上には、帯の方が手前でも塗る。ページでは映り込みを奥行きを比べず・書かずに描いて（vgl.js）、あとの部品に上から塗らせる。その頂点の範囲を覚えておく
    const mir=!shadow&&det<-0.05; if(mir&&mirror[0]<0) mirror[0]=out.length/BUILD_STRIDE;
    const T=v=>[v[0]*m[0]+v[1]*m[3]+v[2]*m[6]+m[9], v[0]*m[1]+v[1]*m[4]+v[2]*m[7]+m[10], v[0]*m[2]+v[1]*m[5]+v[2]*m[8]+m[11]];
    // 属性の表は 1P（とステージ）が塊0、2P が塊1
    let over=0;   // 部品の中で何枚目の「重ねる面」か（透明ありのテクスチャの面と貼りもの。ゲームは部品の中をファイルの順に上塗りする）
    for(const p of objPolys(e.ch[3],e.ch[d.player?1:0],e.ch[2])){
      const q=p.v.map(T), a=q[1].map((x,i)=>x-q[0][i]), b=q[2].map((x,i)=>x-q[0][i]);
      const n=[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]], l=(det<0?-1:1)*(Math.hypot(...n)||1); for(let i=0;i<3;i++) n[i]/=l;   // 映り込み（行列式が負）は頂点の並びが裏返るので法線を戻す
      const c16=cram.getUint16((p.attr[3]>>6&1023)*2,true), c5=[c16&31,c16>>5&31,c16>>10&31];
      let tx=null; if(p.attr[0]>>14&1) tx=texCoords(p.attr,p.uv);
      const ov=(p.attr[1]>>8)||(tx&&(p.attr[0]>>13&1))?++over:0;
      const ls=p.h>>18&31, lt=opt.light?opt.light.tab[ls]:[63.5,31.5,0,0], lk=[lt[0],lt[1],lt[2],(lt[3]&7&(opt.light?opt.light.flags:0))?1:0,(ls>=10&&ls<=12?1:0)+(ov?2:0)+4*Math.min(ov,255)];
      const vert=k=>{ out.push(...q[k],...n,...c5);
        if(tx) out.push(...tx.loc[k],...tx.org,...tx.size,(p.attr[0]>>13&1)?2:1,tx.page,p.attr[1]&255); else out.push(0,0,0,0,1,1,0,0,0);
        out.push((p.h>>10&3)|((p.h>>17&63)<<2),...lk) };
      for(let i=1;i+1<q.length;i++){ vert(0); vert(i); vert(i+1) }
    }
    if(mir) mirror[1]=out.length/BUILD_STRIDE;
  }
  return {data:new Float32Array(out), count:out.length/BUILD_STRIDE, missing:[...missing], shadows, mirror:mirror[0]<0?null:mirror};
}
// 明るさ（0〜63）。VU1 のプログラム（calcBrightnessMainMdl2・m2CalcCont・m2mdlQuadPoly…m2mdlTex）を読んで写したもの:
//   B＝clamp(拡散×d＋環境＋光沢×s^8, 0, 127)（d・s は scene.js の sceneLight の説明）→ L＝曲線[h1 の番号][B]（g_geo+0x2040＋番号×128）
//   テクスチャあり: 光の設定が 10〜12 か L＜48 なら L×(テクスチャの値×17)×8/2048、それ以外は 48＋テクスチャの値（色の変換表の特別な欄）
//   テクスチャなし: L。光沢の回数は s^8 と近似（7つの写しでは結果に影響しなかった）
// 7つの写しで、写真とのずれが当てはめた式より減る（light.mjs。当てはめに使わなかった 06 で 11.45→8.78）
function buildBright(n,lk,light){
  const L=light.L, d=Math.max(0,Math.min(1,L[0]*n[0]+L[1]*n[1]+L[2]*n[2])), s=Math.max(0,Math.min(1,2*d*n[2]-L[2]));
  return Math.floor(Math.max(0,Math.min(127,lk[0]*d+lk[1]+(lk[3]?lk[2]*Math.pow(s,8):0))));
}
function buildLuma(curveVal,tex,special){
  if(tex<0) return Math.min(63,curveVal);
  const v=special||curveVal<48?Math.floor(curveVal*tex*17*8/2048):48+tex; return Math.max(0,Math.min(63,v));
}
// OBJ ファイル（展開後のモデルの一覧）の候補から、そのプレイヤーが描いた番号をいちばん多く含むものを選ぶ
// （1P の表にはステージの部品も入っているので「全部」は求めない。同じ数なら先の候補＝1色目）。skip の番号は数えない
// キャラのファイルに無い番号を、同じ名前に1文字足したファイル（OBJ_JAC1B の映り込み、E・A など）から足す。files: [{name,models}]
function sceneAddCompanions(ch,sc,player,files){
  if(!ch) return ch; const map=new Map(ch.map), used=[];
  const need=new Set(sc.draws.filter(d=>d.player===player&&!map.has(d.id)).map(d=>d.id));
  for(const f of files){ let n=0; for(const m of f.models) if(need.has(m.id)&&!map.has(m.id)){ map.set(m.id,m); n++ } if(n) used.push(f.name) }
  return {...ch,map,used};
}
function sceneChooseModels(sc,player,candidates,skip){
  const need=new Set(sc.draws.filter(d=>d.player===player&&!(skip&&skip.has(d.id))).map(d=>d.id)); let best=null;
  for(const c of candidates){ const map=new Map(c.models.map(m=>[m.id,m])); let n=0; for(const id of need) if(map.has(id)) n++;
    if(n>0&&(!best||n>best.n)) best={name:c.name,map,n} }
  return best;
}
