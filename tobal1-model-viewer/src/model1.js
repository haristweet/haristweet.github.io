// ============================================================
//  トバルNo.1 のモデル
//  実物（sector 5927、展開後 42,744B）のダンプから、部品ひとつの形が分かった。
//
//    +0x00 u32 面の位置   +0x04 u32 頂点の位置
//    +0x08 u32 法線の位置 +0x0C u32 色の位置      ← 位置は部品の先頭から
//    +0x10 u32 ? (5)      +0x14 u32 ? (1か2)      +0x18 u32 0
//    +0x1C u32 頂点の数   +0x20 u32 法線の数
//    +0x24 u32 面の数×4種（先の2種が8バイト、後の2種が12バイト）
//    +0x34 u32 0
//    +0x38 頂点 int16 x,y,z,余り → 法線（同じ形）→ 面 → 色 u8 r,g,b,余り
//
//  0x6F10 の部品: 51頂点・51法線・面 10/20/11/33 →
//    10×8 + 20×8 + 11×12 + 33×12 = 768 バイトで、色の位置とぴったり合う。
//    0x7644 の部品（48頂点）でも一致したので、この形で間違いない。
//  部品の位置はファイルの先頭に「個数 ＋ その数だけの位置」の組で並び、0 で終わる。
// ============================================================
function t1ObjectOffsets(d){
  const dv=new DataView(d.buffer,d.byteOffset,d.byteLength);
  const out=[], grp=[]; let o=8, g=0, empty=0;
  // 部品の頭は「面／頂点／法線／色」の4つの位置で始まる。
  // そこが全部 0 なら、枠だけあって中身が入っていない（未格納）。
  // 実物の #157 は、0x420 刻みで並ぶ枠が9つあって、どれも 0 だった。
  // 無理に読むと「面はあるのに頂点が無い区切り」が大量に出る
  const filled=p=>{
    if(p+16>d.length) return false;
    for(let k=0;k<4;k++) if(dv.getUint32(p+k*4,true)!==0) return true;
    return false;
  };
  for(let guard=0;guard<16&&o+4<=d.length;guard++){
    const n=dv.getUint32(o,true); o+=4;
    if(n<1||n>64) break;
    g++;
    for(let k=0;k<n&&o+4<=d.length;k++,o+=4){
      const p=dv.getUint32(o,true);
      if(p<16||p+56>d.length) continue;
      if(!filled(p)){ empty++; continue }
      out.push(p); grp.push(g);
    }
  }
  out.empty=empty;                              // 枠だけで中身が入っていない数
  const tableAt=dv.getUint32(4,true);           // 本体そのものの部品
  if(tableAt>=16&&tableAt+56<=d.length){ out.push(tableAt); grp.push(0) }
  out.group=grp;                                // どの組から出てきたか（0＝本体）
  return out;
}
// ============================================================
//  描く部品を選ぶ
//
//  部品の組（0以外）は「差し替えの枠」。実測（dump3）で、8個の組は
//  4個ずつ2かたまりに分かれ、対になるものどうしは X と Y の広がりが同じで
//  **Z だけが符号ごと裏返って**いた（-30〜125 と -125〜30 など、4組すべて）。
//  左右の手で、片側4種は外へ届く長さが 211→229→288→307 と伸びる。
//  握り拳から開いた手までの差し替えである。
//
//  だから全部いっぺんに描いてはいけない（手が片側に4つ重なる）。各組から1つずつ出す。
//  本体には手が無い（前腕の先で切れている）ので、手の組は出さないと手が抜ける。
//  ゲームも手と顔は本体とは別の回に描いている（RAM の描く命令の並び、t1SlotAttach の注）
// ============================================================
// その部品が「貼りもの」か（面の命令が全部テクスチャ＝顔の目・眉・傷）。
// 組み立てる前に決めたいので、o.run ではなく命令の列を直接歩く
function t1PartIsDecal(d,o){
  if(o.run&&o.run.faces&&o.run.faces.length)
    return o.run.faces.every(f=>T1_COL_TEX[f.op]);
  if(!d||o.base==null) return false;
  const dv=new DataView(d.buffer,d.byteOffset,d.byteLength);
  const g=p=>p+4<=d.length?dv.getUint32(p,true):0;
  const LEN=(typeof T1_CMD_LEN==="object"&&T1_CMD_LEN)||{0:0,1:12,2:16,3:8,4:16,5:4,6:8,7:12};
  let fp=o.base+0x10, n=0;
  for(let st=0;st<4096&&fp+8<=d.length;st++){
    const op=g(fp); if(op===0) break;
    if(op in LEN){ fp+=LEN[op]; continue }
    if(op>15) return false;
    if(!T1_COL_TEX[op]) return false;
    n++; fp+=8;
  }
  return n>0;
}
function t1GroupIsDecal(list,d){
  return list.length>0&&list.every(o=>t1PartIsDecal(d,o));
}
// slot: 0〜 ＝ 各組からその番目（組より大きければ最後）、-1 ＝ 本体だけ、
//       -2 ＝ 貼りもの（顔）だけで手は出さない。100以上は前の版の値なので 100 を引く
function t1PickParts(objs,slot,d){
  const body=objs.filter(o=>!o.group);
  if(!body.length) return objs;                 // 組が付いていなければ、そのまま
  if(slot==null||slot===-1||slot<-2) return body;   // 「出さない」なら本体だけ
  const decalOnly=slot===-2;
  const pick=decalOnly?0:slot>=100?slot-100:slot;
  const by=new Map();
  for(const o of objs){ if(!o.group) continue;
    const a=by.get(o.group)||[]; a.push(o); by.set(o.group,a) }
  const out=body.slice();
  for(const [,a] of [...by].sort((x,y)=>x[0]-y[0])){
    if(decalOnly&&!t1GroupIsDecal(a,d)) continue;
    out.push(a[Math.min(pick,a.length-1)]);     // 組ごとに1つだけ
  }
  return out;
}
// 頂点や法線の「数」はヘッダの決まった場所にあるとは限らない（実物で、頂点51/法線51 の
// 部品と 頂点47/法線45 の部品が混ざっていた）。位置の差から割り出すほうが確実。
// 面の数4種だけはヘッダから拾うが、これも場所を決め打ちせず
// 「8バイト×2種 ＋ 12バイト×2種 が面の大きさに一致する並び」を探す。
function readT1Object(d,base){
  if(base+56>d.length) return null;
  const dv=new DataView(d.buffer,d.byteOffset,d.byteLength);
  const g=k=>base+(k+1)*4<=d.length?dv.getUint32(base+k*4,true):0;
  const o={base,facePtr:g(0),vertPtr:g(1),normPtr:g(2),colPtr:g(3),nv:0,nn:0,counts:null,countsAt:-1};
  // 法線を持たない部品がある（部分1・部分3 は 法線の位置＝面の位置で、法線の数が0）
  if(!(o.vertPtr>=16&&o.vertPtr<o.normPtr&&o.normPtr<=o.facePtr&&o.facePtr<o.colPtr)) return o;
  if((o.normPtr-o.vertPtr)%8||(o.facePtr-o.normPtr)%8) return o;
  o.nv=(o.normPtr-o.vertPtr)/8;
  o.nn=(o.facePtr-o.normPtr)/8;
  o.faceBytes=o.colPtr-o.facePtr;
  for(let k=4;k<24&&base+(k+4)*4<=d.length;k++){
    const c=[g(k),g(k+1),g(k+2),g(k+3)];
    if(c.some(v=>v>65535)) continue;
    if((c[0]+c[1])*8+(c[2]+c[3])*12===o.faceBytes){ o.counts=c; o.countsAt=k; break }
  }
  // 面の数（ヘッダの並び）は表示のために探すだけ。読み方は面の大きさから決まる
  o.ok = o.nv>0 && o.nv<65536 && o.faceBytes>0 && o.faceBytes%4===0 &&
         base+o.colPtr+o.nv*4<=d.length;
  return o;
}
// 面の1枚の形（実物 sector 5927 の面のバイト列から）:
//   18 00 00 00 | 14 00 00 00 | 10 00 00 00   → 24, 20, 16 → ÷4 して 頂点 6, 5, 4
// u32 ×3 で1枚の三角形。値は頂点番号の4倍（PS1 でよくある、掛け算を省くための持ち方）。
// 面の領域 768 バイト ÷ 12 = 64枚ちょうどで、ヘッダの 20 + 11 + 33 = 64 と一致する。
// 念のため、1枚の大きさ・倍率・頂点数は「使われる頂点の種類が多い読み方」で選ぶ。
function t1FaceMode(d,o){
  const dv=new DataView(d.buffer,d.byteOffset,d.byteLength);
  let best=null;
  // 面の領域がきっちり割り切れない部品があるので、頭を少しずらす読み方も試す
  const skips=[0]; for(const sz of [12,16,8]){ const r=o.faceBytes%sz; if(r&&skips.indexOf(r)<0) skips.push(r) }
  for(const skip of skips) for(const sz of [12,16,8]) for(const scale of [4,1]) for(const nvtx of [3,4]){
    if(nvtx*4>sz) continue;
    const n=Math.floor((o.faceBytes-skip)/sz); if(n<1) continue;
    const used=new Set(); let ok=0, seen=0;
    for(let k=0;k<n;k++){
      const p=o.base+o.facePtr+skip+k*sz;
      if(p+sz>d.length) break;
      seen++;
      const idx=[]; let fine=true;
      for(let j=0;j<nvtx;j++){
        const v=dv.getUint32(p+j*4,true);
        if(scale===4&&(v&3)) fine=false;
        const i=v/scale;
        if(!(i<o.nv)) fine=false;
        idx.push(i);
      }
      if(fine){ ok++; for(const v of idx) used.add(v) }
    }
    if(!seen) continue;
    const score=(ok/seen)*(used.size/Math.max(1,o.nv));
    if(!best||score>best.score) best={sz,scale,nvtx,skip,score,n:seen,ok,used:used.size};
  }
  return best;
}
// 面の並びがどれだけ素直に読めたか。途切れが多くても、ほとんどの場所が
// 法線つきの面として読めるなら、その部品はキャラクターの見た目とみなす
function t1WalkGood(W){ return !!W&&W.faces.length>=8&&W.covered/W.bytes>0.9 }
function t1WalkLine(W){
  if(W.uniform) return `面はぜんぶ ${W.uniform}B / 三角${W.tris} 四角${W.quads}`
    +`${W.kinds[2]+W.kinds[3]?"（法線あり）":"（法線なし）"} / いちばん大きい頂点番号 ${W.maxIdx}`;
  return `面は4種混在 / 三角${W.kinds[0]}+四角${W.kinds[1]}（法線なし） `
    +`三角${W.kinds[2]}+四角${W.kinds[3]}（法線あり） / `
    +`説明できた ${Math.round(W.covered/W.bytes*100)}% / 捨てた ${W.resync*4}B ${W.runs}かたまり / `
    +`いちばん大きい頂点番号 ${W.maxIdx}`;
}
const T1_MAX_COORD=8000;   // これを超える座標は読み違い。カメラの合わせ枠が壊れるので落とす
// 見せ方の切り替え。どこがおかしいのかを切り分けるための道具
// segOnly ＝ この区切りだけ描く。segPart ＝ その区切りがどの部品のものか。
// 区切りの番号は部品ごとに0から振り直されるので、部品を決めないと別物が混ざる
const t1Show={all:false,only:false,segColor:false,spread:false,segSpread:false,segOnly:-1,segPart:-1,guessBone:false,guessAmt:0.6,chainBone:false,flatColor:true,colMode:"",up:2};
try{ t1Show.all=localStorage.getItem("t1all")==="1";
     t1Show.only=localStorage.getItem("t1only")==="1";
     t1Show.segColor=localStorage.getItem("t1segcol")==="1";
     t1Show.spread=localStorage.getItem("t1spread")==="1";
     t1Show.segSpread=localStorage.getItem("t1segspread")==="1";
     t1Show.guessBone=localStorage.getItem("t1guessbone")==="1";
     t1Show.chainBone=localStorage.getItem("t1chainbone")==="1";
     { const f=localStorage.getItem("t1flatcol"); if(f!=null) t1Show.flatColor=f==="1" }
     t1Show.colMode=localStorage.getItem("t1colmode2")||"";
     { const a=localStorage.getItem("t1guessamt"); if(a!=null) t1Show.guessAmt=+a }
     // 向きの記憶は v3.5.0 で作り直した（前の既定値が上下逆だったので、古い記憶は捨てる）
     const u=localStorage.getItem("t1up2"); if(u!=null) t1Show.up=+u }catch(_){}
// モデルの「背の高さ」がどの軸かは決め打ちできないので、向きを選べるようにする。
// 実物 #68 は X 811 / Y 411 / Z 417 で、X が背の高さ（人の縦横比 2:1:1）。
// ビューアは Y を上に描くので、そのままだとキャラクターが寝てしまう。
// さらに X は足のほうが大きい（プレステの座標は下が＋）ので、上下をひっくり返す
const T1_UP=[
  {name:"そのまま",      f:(x,y,z)=>[x,y,z]},
  {name:"X を上に",      f:(x,y,z)=>[-y,x,z]},
  {name:"X を上に（逆）", f:(x,y,z)=>[y,-x,z]},
  {name:"Z を上に",      f:(x,y,z)=>[x,z,-y]},
  {name:"Y を上（逆）",   f:(x,y,z)=>[x,-y,z]},
];
// 写しから取った本物の骨を当てたあとは、ワールドの Y がそのまま背の高さになる。
// v4.29.0 で「Y を裏返す」にしたが、**逆だった**（ビューアで頭が下になっていた）。
// 画面で向きを変えれば人が立つ、と外から指摘されて分かった。
// 確かめ方: 写しを読み込んで、そのまま立っているか見る
const T1_UP_WORLD=0;                            // 本物の骨のときの向き＝そのまま
// 骨ごとに色を変えるときの色。棘がどの骨から出ているかを目で追うため
const T1_SEG_COL=[[.95,.35,.35],[.35,.85,.45],[.40,.55,.95],[.95,.80,.30],
                  [.85,.45,.90],[.30,.85,.85],[.95,.60,.35],[.60,.60,.95],
                  [.45,.95,.70],[.95,.45,.65],[.70,.85,.35],[.50,.75,.95]];
// 部品を横一列に並べるときの置き場所。重なって見えないので、1つずつ形を確かめるため
function t1Layout(objs,dv,up){
  const box=[], gap=60; let total=0;
  for(const o of objs){
    const mn=[1e9,1e9,1e9], mx=[-1e9,-1e9,-1e9];
    for(let i=0;i<o.nv;i++){ const p=o.base+o.vertPtr+i*8;
      const v=up(dv.getInt16(p,true),dv.getInt16(p+2,true),dv.getInt16(p+4,true));
      for(let a=0;a<3;a++){ if(v[a]<mn[a])mn[a]=v[a]; if(v[a]>mx[a])mx[a]=v[a] } }
    const w=Math.max(1,mx[0]-mn[0]); box.push({mn,mx,w}); total+=w+gap;
  }
  const out=new Map(); let x=-total/2;
  objs.forEach((o,k)=>{ const b=box[k];
    out.set(o,[x-b.mn[0], -(b.mn[1]+b.mx[1])/2, -(b.mn[2]+b.mx[2])/2]);
    x+=b.w+gap });
  return out;
}
// 骨の区切り（命令5）ごとに横へ並べる。
// 「どの区切りが腕で、どれが脚で、どれが胴なのか」は、重なったままでは分からない。
// 一度ばらして見れば、形から骨を組むための土台になる
// 「その区切りで入れられた頂点」でまとめた箱。
//
// これまで出していた箱は、面を区切りでまとめたものだった。
// だが面が使う頂点は前の区切りで入れたものでもよく（置き場所は命令5をまたいで残る）、
// そのせいで箱に別の骨の頂点が混ざっていた。
// 実物 #123 の区切り8が 379×155×141 ——
// 背丈746 のモデルで、前腕ひとつが半分の長さになるはずがない。
// 混ざった数字の上に「親からの相対だ」と積み上げていた
function t1VertBoxes(d,o,useBone){
  if(!o.run||!o.run.vseg) return null;
  const dv=new DataView(d.buffer,d.byteOffset,d.byteLength);
  const vs=(useBone&&o.run.vbone)||o.run.vseg, box=new Map();
  for(let i=0;i<vs.length;i++){
    const k=vs[i]; if(k==null) continue;
    const q=o.base+o.vertPtr+i*8; if(q+6>d.length) continue;
    const p=[dv.getInt16(q,true),dv.getInt16(q+2,true),dv.getInt16(q+4,true)];
    let b=box.get(k);
    if(!b){ b={n:0,mn:[1e9,1e9,1e9],mx:[-1e9,-1e9,-1e9]}; box.set(k,b) }
    b.n++;
    for(let a=0;a<3;a++){ if(p[a]<b.mn[a])b.mn[a]=p[a]; if(p[a]>b.mx[a])b.mx[a]=p[a] }
  }
  return [...box.entries()].sort((a,b)=>a[0]-b[0]).map(([k,b])=>({
    seg:k, n:b.n,
    size:b.mn.map((v,a)=>Math.round(b.mx[a]-v)).join("×"),
    mid:b.mn.map((v,a)=>Math.round((v+b.mx[a])/2)).join(",")}));
}
function t1VertBoxLine(V){
  if(!V||!V.length) return "";
  const big=Math.max(...V.map(x=>Math.max(...x.size.split("×").map(Number))));
  return `  入れた区切りごとの頂点（面ではなく、頂点を入れた区切りでまとめたもの）`
    +`　${V.length}区切り　いちばん大きい辺 ${big}`;
}
// 区切り（骨）ごとの中心が、原点のまわりに固まっているかを見る。
//
// なぜ見るのか：「みんなお腹のところに顔がある」から。
// 頭の部品が腹の高さに出るのは、骨の行列が無くて全部の部品が原点に重なり、
// モデルの原点が腰のあたりにあるため。団子の正体がこれ。
// だが「どれも原点」なのか「位置を持っている部品もある」のかは、
// 中心を並べてみないと分からない。ずっと大きさだけ出して中心は捨てていた。
//
// 位置を持っている部品があるなら、行列が無くてもそこだけは正しく置ける
function t1SegOrigin(S,extent){
  if(!S||!S.length) return null;
  const mid=x=>String(x.mid).split(",").map(Number);
  const len=v=>Math.hypot(v[0],v[1],v[2]);
  const scale=extent||Math.max(...S.map(x=>x.span))||1;
  const far=S.filter(x=>len(mid(x))>scale*0.15);
  const all=S.map(x=>len(mid(x)));
  return {n:S.length, far:far.length, scale,
    max:Math.round(Math.max(...all)), avg:Math.round(all.reduce((a,b)=>a+b,0)/all.length),
    list:far.slice(0,6).map(x=>`${x.seg}(${x.mid})`)};
}
function t1SegOriginLine(o){
  if(!o) return "";
  if(!o.far) return `  骨ごとの中心: ${o.n}区切りとも原点のまわり`
    +`（いちばん離れて ${o.max}、平均 ${o.avg}、モデルの大きさ ${Math.round(o.scale)}）`
    +"　→ 位置は頂点に入っていない。行列でしか運べない";
  return `  骨ごとの中心: ${o.n}区切り中 ${o.far}個 が原点から離れている`
    +`（いちばん離れて ${o.max}、平均 ${o.avg}、モデルの大きさ ${Math.round(o.scale)}）`
    +`　離れているもの: ${o.list.join(" ")}`
    +"　→ その部品は位置を持っている。行列が無くてもそこは正しく置ける";
}
function t1SegLayout(d,objs,up){
  const dv=new DataView(d.buffer,d.byteOffset,d.byteLength);
  const box=new Map(), gap=50;
  for(const o of objs){
    if(!o.run) continue;
    for(const f of o.run.faces){
      const k=f.seg|0;
      let b=box.get(k);
      if(!b){ b={mn:[1e9,1e9,1e9],mx:[-1e9,-1e9,-1e9],n:0}; box.set(k,b) }
      b.n++;
      for(const i of f.idx){ const p=o.base+o.vertPtr+i*8;
        if(p+6>d.length) continue;
        const v=up(dv.getInt16(p,true),dv.getInt16(p+2,true),dv.getInt16(p+4,true));
        for(let a=0;a<3;a++){ if(v[a]<b.mn[a])b.mn[a]=v[a]; if(v[a]>b.mx[a])b.mx[a]=v[a] } }
    }
  }
  const keys=[...box.keys()].sort((a,b)=>a-b);
  let total=0;
  for(const k of keys) total+=Math.max(1,box.get(k).mx[0]-box.get(k).mn[0])+gap;
  const out=new Map(); let x=-total/2;
  for(const k of keys){ const b=box.get(k);
    const w=Math.max(1,b.mx[0]-b.mn[0]);
    out.set(k,[x-b.mn[0], -(b.mn[1]+b.mx[1])/2, -(b.mn[2]+b.mx[2])/2]);
    x+=w+gap }
  out.box=box; out.keys=keys;
  return out;
}
function buildT1Mesh(d,objs){
  // 色の範囲の終わりは「次の部品の頭まで」で決める。ここは**絞る前の全部品**で
  // 見ないといけない。本体だけ描くようにしてから、部品が1つしか渡らなくなり、
  // 終わりがファイルの末尾になって、命令ごとの色の並びが一度も使われていなかった
  // 呼ぶ側がすでに「本体だけ」に絞っていることがあるので、
  // 部品の頭はモデルそのものから読み直す
  const partBases=(()=>{ try{ return t1ObjectOffsets(d).slice().sort((a,b)=>a-b) }catch(_){ return [] } })();
  let slotAttach=null;                  // 差し替えの部品を、どの区切りの骨に付けるか
  // 法線つきで読める部品が1つでもあれば、それがキャラクターの見た目。
  // 読めない部品は当たり判定か影なので、ふだんは出さない
  for(const o of objs){ if(!o.ok) continue;
    o.run=t1RunBest(d,o);
    // 読んだ頂点の数がファイルの頂点数と合えば、命令の読み方で間違いない
    if(o.run&&Math.abs(o.run.verts-o.nv)>2){
      o.why=`読んだ頂点 ${o.run.verts}個 とファイルの頂点 ${o.nv}個 が合わない`; o.run=null;
    }else if(!o.run) o.why=t1RunWhy;
    if(!o.run){ o.walkTry=t1WalkFaces(d,o); o.walkOK=t1WalkGood(o.walkTry) } }
  if(!t1Show.all){ const real=objs.filter(o=>o.run||o.walkOK); if(real.length) objs=real }
  // 組の中身が「同じ面数の同じ形」なら、それはポーズ違い（実物では手だった）。
  // 実際に出るのは組から1つだけで、全部出すと原点で重なって棘になる。
  // 面の大きさがばらばらな組は別々の部品なので、そのまま全部出す
  if(!t1Show.all&&!t1Show.spread){
    const same=new Map();
    for(const o of objs){ if(!o.group) continue;
      const v=same.get(o.group);
      if(v===undefined) same.set(o.group,o.faceBytes||0);
      else if(v!==(o.faceBytes||0)) same.set(o.group,-1) }
    const seen=new Set();
    objs=objs.filter(o=>{ const g=o.group; if(!g||same.get(g)===-1) return true;
      if(seen.has(g)) return false; seen.add(g); return true });
  }
  // 「本体だけ」…いちばん頂点の多い部品（キャラクターの胴体）だけにする
  if(t1Show.only){ const big=objs.slice().sort((a,b)=>b.nv-a.nv)[0]; if(big) objs=[big] }
  try{ slotAttach=t1SlotAttach(d,objs) }catch(_){ slotAttach=null }
  const dv=new DataView(d.buffer,d.byteOffset,d.byteLength);
  // 色の引き方を部品ごとに測っておく（頂点ごと／面の頂点ごと／面に1色）
  const cfit=new Map();
  try{
    const CMODES=["頂点ごと","面の頂点ごと","面に1色","面に1色（四角は2枚ぶん）"];
    // 手で選ばれているときは、測らずにそれを使う（自動の判定が僅差で外すことがある）
    if(t1Show.colMode){ for(const o of objs) cfit.set(o.base,t1Show.colMode) }
    else
    for(const c of t1ColorFit(d,objs)){
      const o=objs.find(x=>x.base===c.base);
      if(c.exact){ cfit.set(c.base,c.fit); continue }
      // バイト数がぴったりでないときは、当ててみて「隣り合う面の色が揃う」ほうを採る
      const b=o?t1ColorBest(d,o,CMODES):null;
      cfit.set(c.base,b?b.mode:(c.near?c.fit:"頂点ごと"));
      if(b) c.picked=b.mode, c.score=Math.round(b.score);
    }
  }catch(_){}
  const lay=t1Show.spread?t1Layout(objs,dv,(T1_UP[t1Show.up]||T1_UP[0]).f):null;
  // 骨の区切りごとに並べる（どの区切りが何なのかを見るため）
  const segLay=t1Show.segSpread?t1SegLayout(d,objs,(T1_UP[t1Show.up]||T1_UP[0]).f):null;
  const pos=[],col=[],t0=[],t1=[],sm=[],nrm=[];
  let used=0, tris=0, dropped=0, texTris=0;
  for(const o of objs){
    if(!o.ok) continue;
    used++;
    // 部品ごとの範囲を控えておく（どの部品が変なのか分かるように）
    { const mn=[1e9,1e9,1e9], mx=[-1e9,-1e9,-1e9];
      for(let i=0;i<o.nv;i++){ const p=o.base+o.vertPtr+i*8;
        for(let a=0;a<3;a++){ const v=dv.getInt16(p+a*2,true); if(v<mn[a])mn[a]=v; if(v>mx[a])mx[a]=v } }
      o.box=mn.map((v,a)=>`${v}..${mx[a]}`).join(" "); o.span=Math.max(...mx.map((v,a)=>v-mn[a])); }
    const up=(T1_UP[t1Show.up]||T1_UP[0]).f;
    const sp=lay?lay.get(o):null;
    // 頂点は「その骨のローカル座標」で入っている。骨の行列が分かっていれば
    // ここでかける。無ければそのまま（手足が胴に畳み込まれた形になる）
    const BM=T1_BONES;
    const BOFF=BM?t1BoneOrigins(d,o,T1_BONE_ORIGIN):null;
    // どの骨をかけるかは、**その頂点が入れられたとき**の区切りで決まる。
    // ゲームは 命令5 で行列を差し替え、命令1/2 でそのときの行列をかけてから
    // 置き場所に入れる。面は入れ終わった置き場所を番号で引くだけなので、
    // 継ぎ目の面は「前の区切りで入れた頂点」を混ぜて指す。
    // 面の区切りで引くと、そこがねじれて全体が散らばる（実物でそうなった）
    const VSEG=o.run&&o.run.vseg;
    // 差し替えの部品は、本体の区切りのうち箱の中心がいちばん近いものに付ける
    const fixSeg=(o.group&&slotAttach)?slotAttach.get(o.base):undefined;
    const V0=(i,seg,off)=>{ const q=o.base+o.vertPtr+i*8;
                  let x=dv.getInt16(q,true), y=dv.getInt16(q+2,true), z=dv.getInt16(q+4,true);
                  // 貼りもの（顔の目・眉・傷）は頭の面とほぼ同じ所にあるので、
                  // そのままだと内側に埋まって見えない。法線の向きへ少し押し出す
                  if(off){ x+=off[0]; y+=off[1]; z+=off[2] }
                  const vs=fixSeg!=null?fixSeg:((VSEG&&VSEG[i]!=null)?VSEG[i]:seg);
                  // 頂点は「その骨のローカル座標」ではなく、組み上がった姿勢の
                  // 共有空間に入っている（尻尾の輪が 11 ずつ離れて一列に並ぶ）。
                  // そのまま R を掛けると、区切りごとにモデル全体の原点を中心に
                  // 振り回される。区切りの回転中心 B を引いてから掛ける
                  if(BOFF){ const B=BOFF.get(vs|0);
                    if(B){ x-=B[0]; y-=B[1]; z-=B[2] } }
                  // t1Run の区切り番号は、最初の命令5 で 1 になる（0 から始まらない）。
                  // 表Bの骨は 0 から並ぶので、そのまま引くと全部が1つ隣の関節に付く
                  const bi=BM?(((vs|0)+T1_BONE_SHIFT)%BM.length+BM.length)%BM.length:0;
                  const M=BM&&BM[bi];
                  if(M){ const k=M.one||4096;
                    const X=(M.m[0]*x+M.m[1]*y+M.m[2]*z)/k+M.t[0];
                    const Y=(M.m[3]*x+M.m[4]*y+M.m[5]*z)/k+M.t[1];
                    const Z=(M.m[6]*x+M.m[7]*y+M.m[8]*z)/k+M.t[2];
                    x=X; y=Y; z=Z }
                  const v=up(x,y,z);
                  const g=segLay?segLay.get(seg|0):null;
                  if(g) return [v[0]+g[0],v[1]+g[1],v[2]+g[2]];
                  return sp?[v[0]+sp[0],v[1]+sp[1],v[2]+sp[2]]:v };
    // 色の欄が全部同じ値なら、色は入っていない（ディスクの #157 は全部 0。
    // 対戦中にゲームが書き込む）。そのまま引くと真っ黒になるので灰色で描く
    o.noColor=t1ColorBlank(d,o,partBases.length?partBases:objs.map(x=>x.base).filter(x=>x>0).sort((x,y)=>x-y));
    const C0=o.noColor?()=>T1_NO_COLOR:i=>{ const q=o.base+o.colPtr+i*4;
                  return q+2<d.length?[d[q]/255,d[q+1]/255,d[q+2]/255]:[.5,.5,.5] };
    // 色の引き方は部品ごとに測って決める。頂点ごとでない部品を頂点番号で引くと模様が乱れる。
    //   頂点ごと     … 頂点番号で引く
    //   面の頂点ごと … 面を描きながら、頂点1つにつき1つ進める
    //   面に1色     … 面1枚につき1色。3つの角とも同じ色になる（べた塗り）
    // 命令ごとの色の並びが、色のバイト数とぴったり合うなら、そちらを使う
    // 命令ごとの並びが色のバイト数と**ぴったり合った**ときは、それが答え。
    // 手で選んだ引き方より優先する。
    // 以前は colMode が入っていると並びを使わない作りで、しかも colMode は
    // localStorage に覚えていた。一度「面に1色」を選んだ人は、v4.36.0 で
    // 解いた並びが黙って無効になったままになる罠だった。
    // 手で選ぶほうは「ぴったり合わない部品」にだけ効く
    const plan=(()=>{ if(o.run){
        const pl=t1ColorPlan(o.run);
        const ends=partBases.length?partBases:objs.map(x=>x.base).filter(x=>x>0).sort((x,y)=>x-y);
        const st=o.base+o.colPtr; let en=d.length;
        for(const b of ends) if(b>st&&b<en) en=b;
        if(pl&&pl.words*4===en-st) return pl;
      } return null })();
    o.colPlan=!!plan;                 // どの引き方を使ったかを、あとで報告に出す
    const cmode=cfit.get(o.base)||"頂点ごと";
    const byCorner=cmode==="面の頂点ごと";
    const byFace=cmode==="面に1色"||cmode==="面に1色（四角は2枚ぶん）";
    const faceSplit=cmode==="面に1色（四角は2枚ぶん）";
    let ci=0, fi=0;
    const far=(i,seg)=>V0(i,seg).some(v=>Math.abs(v)>T1_MAX_COORD);
    void far;
    // まず部品を「命令の列」として実行する（実行ファイルのコードから読み取った本物の手順）
    const R=o.run;
    if(R){
      const before=tris;
      let fidx=0;
      const skipPart=t1Show.segOnly>=0&&t1Show.segPart>=0&&o.base!==t1Show.segPart;
      for(const f of R.faces){
        // 区切りを1つだけ描く（どの区切りが何なのかを見分けるため）。
        // 番号は部品ごとに振り直されるので、部品も合っていないといけない
        if(skipPart) continue;
        if(t1Show.segOnly>=0&&(f.seg|0)!==t1Show.segOnly) continue;
        const a=f.idx;
        const cbase=ci; ci+=a.length;          // 面の頂点ごとに色が並んでいるときの引き位置
        const cface=fi; fi+=faceSplit&&a.length===4?2:1;   // 面に1色のときの引き位置
        const pf=plan?plan.at[fidx]:null; fidx++;
        if(a.some(i=>far(i,f.seg))){ dropped++; continue }
        const strip=a.length===4?[[0,1,2],[0,2,3]]:[[0,1,2]];
        for(const t of strip){
          const sc=t1Show.segColor?T1_SEG_COL[(f.seg||0)%T1_SEG_COL.length]:null;
          // 色を面ごとにそろえる（平面塗り）。プレステのポリゴンは1枚1色のものが多い。
          // 頂点ごとに色が置かれていても、三角形の中で混ぜずに1色で塗る作りがある
          // 命令ごとの並びが解けていれば、それで引く。
          //   1語  … べた塗り（面に1色）
          //   角+1 … 基準1語のあと、角ごとに1語
          // テクスチャ付きの面は、語1以降が u,v なので色として引かない。
          //   1語        … べた塗り
          //   テクスチャ  … 語0（白）だけ
          //   角の数ぴったり … 角ごと
          // 色を持たない面（命令10・11）は、頂点ごとの色を引く
          const vAt=plan&&plan.vcolAt;
          const pc=pf?(j=>pf.w===0?(vAt&&vAt[a[j]]!=null?vAt[a[j]]:0)
                        :(pf.w===1||pf.tex)?pf.at
                        :pf.w===pf.corners?pf.at+j
                        :pf.at+1+j):null;
          const tx=(T1_VRAM&&pf&&pf.tex&&!o.noColor)?t1FaceTex(d,o,pf,a.length):null;
          const flat=t1Show.flatColor
            ?C0(pf?pc(t[0]):byFace?cface:byCorner?cbase:a[t[0]]):null;
          // 貼りものは法線の向きへ押し出す。押す量は骨の大きさに対して十分小さい
          let push=null;
          if(tx&&f.n&&T1_DECAL_PUSH){ const L=Math.hypot(f.n[0],f.n[1],f.n[2]);
            if(L>1) push=[f.n[0]/L*T1_DECAL_PUSH,f.n[1]/L*T1_DECAL_PUSH,f.n[2]/L*T1_DECAL_PUSH] }
          for(const j of t){ pos.push(...V0(a[j],f.seg,push));
            col.push(...(sc||flat||C0(pf?pc(j):byFace?cface:byCorner?cbase+j:a[j])));
            if(tx&&tx.uv[j]){ t0.push(tx.uv[j][0],tx.uv[j][1],tx.tp[0]);
                              t1.push(tx.tp[1],tx.tp[2],tx.tp[3],tx.tp[4]); texTris++ }
            else { t0.push(0,0,0); t1.push(0,0,0,0) } }
          if(f.n) nrm.push(...up(f.n[0],f.n[1],f.n[2])); else nrm.push(0,0,0);
          sm.push(1); tris++;
        }
      }
      o.tris=tris-before;
      o.lays=`命令で実行　命令${R.steps}個　頂点${R.verts}個　面${R.faces.length}枚`
        +`（${R.used.map(([op,n])=>`命令${op}:${n}枚`).join(" ")}）`;
      continue;
    }
    // 通らなければ、これまでの「見た目から当てる」読み方に落ちる
    const W=o.walkTry;
    if(o.walkOK){
      o.walk=W; const before=tris;
      // 番号が区切りごとに振り直されているなら、区切りの頭の位置を足して本来の番号に戻す
      const B=t1SpanBases(W,o.nv);
      const shift=new Int32Array(W.faces.length);
      if(B&&B.fits){ o.rebased=B.sum;
        W.spans.forEach((sp,k)=>{ for(let i=sp.from;i<sp.from+sp.n;i++) shift[i]=B.bases[k] }) }
      let fi=-1;
      for(const f of W.faces){
        fi++;
        const a=shift[fi]?f.idx.map(v=>v+shift[fi]):f.idx;
        if(a.some(v=>v>=o.nv)){ dropped++; continue }
        if(a.some(far)){ dropped++; continue }
        const strip=a.length===4?[[0,1,2],[0,2,3]]:[[0,1,2]];
        for(const t of strip){
          const sc=t1Show.segColor?T1_SEG_COL[(f.seg||0)%T1_SEG_COL.length]:null;
          for(const j of t){ pos.push(...V0(a[j])); col.push(...(sc||C0(a[j]))); t0.push(0,0,0); t1.push(0,0,0,0) }
          if(f.n) nrm.push(f.n[0],f.n[1],f.n[2]);
          else if(o.nv===o.nn){ const q=o.base+o.normPtr+a[t[0]]*8;
            nrm.push(dv.getInt16(q,true),dv.getInt16(q+2,true),dv.getInt16(q+4,true)) }
          else nrm.push(0,0,0);   // 形から計算させる
          sm.push(1); tris++;
        }
      }
      o.tris=tris-before;
      o.lays=t1WalkLine(W)+(o.rebased?`　／ 区切りごとに番号を振り直し（合計${o.rebased}）`:"");
      continue;
    }
    const M=t1FaceMode(d,o);
    if(!M) continue;
    o.lays=`1枚 ${M.sz}B / 頂点番号は ${M.scale===4?"4倍":"そのまま"} / ${M.nvtx}頂点 / ${M.ok}枚中${M.n}枚が有効 / 使用${M.used}/${o.nv}`
      +(M.skip?` / 頭を ${M.skip}B 飛ばす`:"");
    const V=i=>[dv.getInt16(o.base+o.vertPtr+i*8,true),
                dv.getInt16(o.base+o.vertPtr+i*8+2,true),
                dv.getInt16(o.base+o.vertPtr+i*8+4,true)];
    const C=i=>{ const p=o.base+o.colPtr+i*4;
                 return p+2<d.length?[d[p]/255,d[p+1]/255,d[p+2]/255]:[.5,.5,.5] };
    {
      const n=Math.floor((o.faceBytes-M.skip)/M.sz);
      const trisBefore=tris;
      for(let k=0;k<n;k++){
      const fp=o.base+o.facePtr+M.skip+k*M.sz;
      if(fp+M.sz>d.length) break;
      const idx=[];
      for(let j=0;j<M.nvtx;j++) idx.push(dv.getUint32(fp+j*4,true)/M.scale);
      if(!idx.slice(0,3).every(v=>Number.isInteger(v)&&v<o.nv)) continue;
      // 座標が人の大きさを外れている面は落とす（読み違いを画面に出さない）
      if(idx.slice(0,(M.nvtx===4&&idx[3]<o.nv)?4:3).some(v=>{
        const p=o.base+o.vertPtr+v*8;
        return Math.abs(dv.getInt16(p,true))>T1_MAX_COORD||Math.abs(dv.getInt16(p+2,true))>T1_MAX_COORD||Math.abs(dv.getInt16(p+4,true))>T1_MAX_COORD;
      })){ dropped++; continue }
      const quad=M.nvtx===4&&Number.isInteger(idx[3])&&idx[3]<o.nv;
      for(const t of (quad?[[0,1,3],[1,2,3]]:[[0,1,2]])){
        for(const j of t){ const vi=idx[j]; pos.push(...V(vi)); col.push(...C(vi)); t0.push(0,0,0); t1.push(0,0,0,0) }
        // 頂点と法線の数が同じ部品は、同じ番号で法線を引く（面ごとの法線は持っていない）
        if(o.nv===o.nn){ const q=o.base+o.normPtr+idx[0]*8;
          nrm.push(dv.getInt16(q,true),dv.getInt16(q+2,true),dv.getInt16(q+4,true)) }
        else nrm.push(0,0,0);
        sm.push(1); tris++;
      }
      }
      o.tris=tris-trisBefore;
    }
  }
  return {texTris,vram:T1_VRAM,mesh:{vram:T1_VRAM,pos:new Float32Array(pos),col:new Float32Array(col),t0:new Float32Array(t0),
                t1:new Float32Array(t1),sm:new Uint8Array(sm),
                nrm:nrm.some(v=>v)?new Float32Array(nrm):null}, used, tris, dropped};
}

// 部品のヘッダを生のまま出す。+0x10〜+0x18 が何なのか（置き場所かもしれない）を
// 実物の数字で確かめるため。まだ意味は決めつけない。
function t1HeadDump(d,o,words){
  const dv=new DataView(d.buffer,d.byteOffset,d.byteLength);
  const out=[];
  for(let k=0;k<(words||16)&&o.base+(k+1)*4<=d.length;k++){
    const v=dv.getUint32(o.base+k*4,true);
    out.push(`+${(k*4).toString(16).padStart(2,"0")}:${v>0x7fffffff?(v|0):v}`);
  }
  return out.join(" ");
}
// 先頭の部品だけ、ヘッダと頂点のあいだにやけに広い空きがある（実物で 1,504 バイト）。
// 骨の並びか、部品の入れ子の目録だと思うので、そのまま並べて出す。
function t1GapDump(d,o,rows){
  const dv=new DataView(d.buffer,d.byteOffset,d.byteLength);
  const from=o.base+0x38, to=o.base+o.vertPtr;
  if(to-from<64) return null;
  const L=[`  ヘッダと頂点のあいだ（+${(0x38).toString(16)}〜+${o.vertPtr.toString(16)}、${to-from}バイト）:`];
  const n=Math.min(rows||12,Math.ceil((to-from)/16));
  for(let r=0;r<n;r++){
    const p=from+r*16; if(p+16>to||p+16>d.length) break;
    const w=[0,4,8,12].map(j=>{ const v=dv.getUint32(p+j,true); return String(v>0x7fffffff?(v|0):v).padStart(11) });
    const b=Array.from(d.subarray(p,p+16),v=>v.toString(16).padStart(2,"0")).join("");
    L.push(`    +${(p-o.base).toString(16).padStart(4,"0")}  ${w.join(" ")}   ${b}`);
  }
  return L;
}

// ============================================================
//  面の本当の形（実物 sector 5927 の +0x0034 の部品から）
//
//    0c 00 00 00  08 00 00 00  04 00 00 00  00 00 00 00   頂点番号 u32 ×4（どれも4倍）
//    25 02 63 f8  e8 0d 00 00                             法線 int16 x,y,z,0
//
//  法線の長さは 549,-1949,3560 で 4095.6 ＝ 4096。1.12 の固定小数で長さ 1 ということ。
//  4枚とも 4096 ちょうどだったので、これで間違いない。
//  三角形なら頂点番号が3つで 20 バイト、四角形なら4つで 24 バイト。混ざって並ぶので、
//  法線が来る位置がどちらかで1枚ずつ見分ける。
//
//  なお「腕脚らしい8部品」はこの形では読めない。法線を持たず、頂点番号3つ12バイトが
//  ずらりと並ぶだけ。キャラクターの見た目ではなく、当たり判定か影のための形だと思う。
// ============================================================
const T1_NRM_LEN=4096;
// 面は4通りある（PS1 のモデルでよくある、平らな面となめらかな面の組み合わせ）
//   種A 三角・法線なし 12B   種B 四角・法線なし 16B
//   種C 三角・法線あり 20B   種D 四角・法線あり 24B
// 実物 sector 5927 の本体では、法線ありの並びが 70% 続いたあと
//   … 53 01 10 f0 6e 00 00 00 ┃ 0c 00 00 00 08 00 00 00 04 00 00 00 00 00 00 00 …
// と、法線（長さ4095.5）で終わった次から法線なしの四角（3,2,1,0）に切り替わっていた。
// どこで切り替わるかはファイルに書かれていないので、
// 「いちばん多くのバイトを説明できる並べ方」を後ろから決めていく。
const T1_FACE_KINDS=[{n:3,size:12,nrm:false},{n:4,size:16,nrm:false},
                     {n:3,size:20,nrm:true },{n:4,size:24,nrm:true }];
function t1WalkFaces(d,o,limit){
  const dv=new DataView(d.buffer,d.byteOffset,d.byteLength);
  const start=o.base+o.facePtr, end=Math.min(o.base+o.colPtr,d.length);
  if(end-start<12) return null;
  const top=limit||o.nv;
  const idxAt=p=>{ const v=dv.getUint32(p,true); return (v&3)||v/4>=top?-1:v/4 };
  const nrmAt=p=>{
    const x=dv.getInt16(p,true),y=dv.getInt16(p+2,true),z=dv.getInt16(p+4,true);
    if(dv.getInt16(p+6,true)!==0) return null;
    const m=Math.hypot(x,y,z);
    return m>T1_NRM_LEN*0.94&&m<T1_NRM_LEN*1.06?[x,y,z]:null };
  const take=(p,k)=>{
    if(p+k.size>end) return null;
    const a=[]; for(let j=0;j<k.n;j++){ const v=idxAt(p+j*4); if(v<0) return null; a.push(v) }
    if(!k.nrm) return {idx:a,n:null};
    const nr=nrmAt(p+k.n*4); return nr?{idx:a,n:nr}:null };
  // 12バイトの三角2枚と16バイトの四角1枚は、どちらでもバイト数が埋まってしまう。
  // そこで「形として筋が通っているか」で選ぶ。点が重なっていないか、四角なら平らか、
  // 持っている法線が実際の面の向きと合っているか。
  const V=i=>{ const q=o.base+o.vertPtr+i*8;
    return q+6<=d.length?[dv.getInt16(q,true),dv.getInt16(q+2,true),dv.getInt16(q+4,true)]:null };
  const quality=f=>{
    const a=f.idx;
    if(new Set(a).size<a.length) return 0;           // 同じ頂点が混ざる面は怪しい
    const P=a.map(V); if(P.some(p=>!p)) return 0;
    const u=[P[1][0]-P[0][0],P[1][1]-P[0][1],P[1][2]-P[0][2]];
    const v=[P[2][0]-P[0][0],P[2][1]-P[0][1],P[2][2]-P[0][2]];
    const n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
    const L=Math.hypot(...n); if(L<1) return 0;      // つぶれた面
    let s=6;
    if(a.length===4){                                 // 四角は平らなはず
      const w=[P[3][0]-P[0][0],P[3][1]-P[0][1],P[3][2]-P[0][2]];
      const gap=Math.abs(n[0]*w[0]+n[1]*w[1]+n[2]*w[2])/L;
      if(gap<Math.max(Math.hypot(...u),Math.hypot(...v))*0.15) s+=8;
    }
    if(f.n){                                          // 持っている法線と向きが合えば大加点
      const m=Math.hypot(...f.n)||1;
      const dot=(n[0]*f.n[0]+n[1]*f.n[1]+n[2]*f.n[2])/(L*m);
      if(Math.abs(dot)>0.7) s+=16;
    }
    return s;
  };

  // まず「ぜんぶ同じ形」で隙間なく並ぶかを見る。腕や脚の部品は12バイトの三角だけで
  // きっちり埋まる。この場合は下の詰め込みより確実なので、こちらを優先する
  for(const kd of T1_FACE_KINDS){
    if((end-start)%kd.size) continue;
    const list=[]; let okAll=true;
    for(let p=start;p<end;p+=kd.size){ const f=take(p,kd); if(!f){ okAll=false; break } list.push(f) }
    if(!okAll||list.length<8) continue;
    const kinds=[0,0,0,0]; kinds[T1_FACE_KINDS.indexOf(kd)]=list.length;
    let maxIdx=-1; for(const f of list) for(const v of f.idx) if(v>maxIdx) maxIdx=v;
    return {faces:list,kinds,bad:[],resync:0,runs:1,maxIdx,bytes:end-start,
            covered:end-start,tris:kd.n===3?list.length:0,quads:kd.n===4?list.length:0,
            left:0,uniform:kd.size};
  }
  // 後ろから「ここから先で説明できるバイト数」を決める。読み飛ばしは 0 点
  const N=(end-start)>>2;
  const best=new Int32Array(N+1), pick=new Int8Array(N+1).fill(-1);
  for(let i=N-1;i>=0;i--){
    let b=best[i+1], k=-1;                       // 何も当てはまらなければ4バイト捨てる
    for(let t=0;t<4;t++){
      const kd=T1_FACE_KINDS[t], step=kd.size>>2;
      if(i+step>N) continue;
      const f=take(start+i*4,kd); if(!f) continue;
      const v=kd.size*64+quality(f)+best[i+step];
      if(v>b){ b=v; k=t }
    }
    best[i]=b; pick[i]=k;
  }
  const faces=[], bad=[], kinds=[0,0,0,0];
  let i=0, resync=0, maxIdx=-1, runs=0, inRun=false, covered=0;
  while(i<N){
    const t=pick[i];
    if(t<0){ if(bad.length<8) bad.push(i*4); resync++; inRun=false; i++; continue }
    const kd=T1_FACE_KINDS[t], f=take(start+i*4,kd);
    faces.push(f); kinds[t]++; covered+=kd.size;
    for(const v of f.idx) if(v>maxIdx) maxIdx=v;
    if(!inRun){ runs++; inRun=true }
    i+=kd.size>>2;
  }
  if(!faces.length) return null;
  const bytes=end-start;
  return {faces,kinds,bad,resync,runs,maxIdx,bytes,covered,
          tris:kinds[0]+kinds[2], quads:kinds[1]+kinds[3], left:bytes-covered-resync*4,
          spans:t1FaceSpans(faces)};
}
// 読み直しが起きた場所のまわりを生で見る。区切りに何が挟まっているか確かめるため
function t1BadDump(d,o,W,n){
  if(!W||!W.bad.length) return null;
  const L=[`  面の並びが途切れた場所（部品 +${o.base.toString(16)}、面の頭からの位置）:`];
  for(const off of W.bad.slice(0,n||4)){
    const p=o.base+o.facePtr+off;
    const hx=(f,len)=>Array.from(d.subarray(Math.max(0,f),Math.max(0,f)+len),
                                 v=>v.toString(16).padStart(2,"0")).join(" ");
    L.push(`    +${off}  前 ${hx(p-16,16)} ┃ ${hx(p,32)}`);
  }
  return L;
}

// 頂点番号が途中で 0 に戻っている。頂点854個に対して面が使う番号は 0..167 しかない。
// 小部品ごとに 0 から振り直されているとみて、区切りを当てずっぽうではなく計算で決める。
//
//   決め手: ひとつの小部品は、自分の頂点を 0 から順に「ひとつ残らず」使うはず。
//   つまり区切りの中で使われた番号が ちょうど {0,1,…,最大} になっていること。
//   さらに、区切りの幅を全部足すと頂点の数ちょうどになること。
//   この2つを同時に満たす切り方を探す。見つかればそれが正解。
function t1GroupFaces(faces,nv){
  const F=faces.length;
  if(!F||nv<1||nv>4096) return null;
  const MIN_W=16, MIN_N=4;                 // 小さすぎる区切りは相手にしない
  // 頭を s にしたとき、どこで「0..最大 をひとつ残らず使った」状態になるか
  const seen=new Int32Array(nv), ends=[];
  let stamp=0, work=0;
  for(let s0=0;s0<F;s0++){
    stamp++; let max=-1, count=0; const list=[];
    for(let e=s0;e<F;e++){
      let bad=false;
      for(const v of faces[e].idx){
        if(v>=nv){ bad=true; break }
        if(seen[v]!==stamp){ seen[v]=stamp; count++ }
        if(v>max) max=v;
      }
      if(bad) break;
      if(count===max+1&&max+1>=MIN_W&&e-s0+1>=MIN_N) list.push([e+1,max+1]);
      if(max+1>nv) break;
    }
    ends.push(list); work+=list.length;
  }
  if(work>200000) return null;             // 手に負えない並びは深追いしない
  // 区切りの幅の合計がちょうど頂点の数になる切り方のうち、区切りがいちばん少ないもの。
  // 「全部使い切る」だけだと切り方がいくつも成り立つので、少ないほうを選ぶ
  const W=nv+1, INF=0x3fffffff;
  const cost=new Int32Array((F+1)*W).fill(INF), from=new Int32Array((F+1)*W).fill(-1);
  cost[0]=0;
  for(let f=0;f<F;f++) for(let v=0;v<=nv;v++){
    const c=cost[f*W+v]; if(c>=INF) continue;
    for(const [e,w] of ends[f]){
      const nv2=v+w; if(nv2>nv) continue;
      const k=e*W+nv2;
      if(c+1<cost[k]){ cost[k]=c+1; from[k]=f*W+v }
    }
  }
  if(cost[F*W+nv]>=INF) return null;
  const cuts=[]; let cur=F*W+nv;
  while(cur>0){ const pr=from[cur]; if(pr<0) return null;
    cuts.push({from:(pr/W)|0,to:(cur/W)|0,base:pr%W,n:((cur/W)|0)-((pr/W)|0),width:cur%W-pr%W});
    cur=pr; }
  cuts.reverse();
  return cuts;
}
// 当てずっぽうの区切り（報告用）。計算で決まらなかったときの手掛かりに使う
// 頂点番号が途中で 0 に戻っていないかを見る。本体は小部品の入れ物らしく、
// 番号が小部品ごとに振り直されている疑いがある（頂点854個なのに最大276だった）。
// 面を並び順に区切って、区切りごとの番号の幅を出す。
function t1FaceSpans(faces){
  const out=[]; let cur=null, seen=-1;
  for(let i=0;i<faces.length;i++){
    const a=faces[i].idx, lo=Math.min(...a), hi=Math.max(...a);
    // 大きい番号を使ったあとに急に小さい番号へ戻ったら、そこが区切り
    if(cur&&hi<seen-8&&lo<=4){ out.push(cur); cur=null }
    if(!cur){ cur={from:i,n:0,lo:65535,hi:-1}; seen=-1 }
    cur.n++; if(lo<cur.lo)cur.lo=lo; if(hi>cur.hi)cur.hi=hi;
    if(hi>seen) seen=hi;
  }
  if(cur) out.push(cur);
  return out;
}
// 区切りごとに「その区切りの中だけの番号」だとしたら、頂点の位置はどこから始まるか。
// 区切りの番号の幅を順に足していったものが頂点の数と合えば、その読み方で当たり。
function t1SpanBases(W,nv){
  if(!W||!W.spans) return null;
  let sum=0; const bases=[];
  for(const s of W.spans){ bases.push(sum); sum+=s.hi+1 }
  return {bases,sum,nv,fits:Math.abs(sum-nv)<=Math.max(4,nv*0.02)};
}

// 頂点を 64個ずつに区切って、それぞれがどのあたりに置かれているかを見る。
// 小部品ごとに固まっていれば、区切りの位置で範囲がはっきり飛ぶはず。
function t1VertWindows(d,o,step){
  const dv=new DataView(d.buffer,d.byteOffset,d.byteLength);
  const L=[`  頂点を${step||64}個ずつ見た置き場所（部品 +${o.base.toString(16)}、頂点${o.nv}）:`];
  const n=step||64;
  for(let s0=0;s0<o.nv;s0+=n){
    const mn=[1e9,1e9,1e9], mx=[-1e9,-1e9,-1e9];
    for(let i=s0;i<Math.min(s0+n,o.nv);i++){
      const p=o.base+o.vertPtr+i*8; if(p+6>d.length) break;
      for(let a=0;a<3;a++){ const v=dv.getInt16(p+a*2,true); if(v<mn[a])mn[a]=v; if(v>mx[a])mx[a]=v }
    }
    L.push(`    ${String(s0).padStart(4)}..${String(Math.min(s0+n,o.nv)-1).padStart(4)}  `
      +mn.map((v,a)=>`${String(v).padStart(5)}..${String(mx[a]).padEnd(5)}`).join(" "));
  }
  return L;
}
// 面の並びの切れ目まわりを生で見る。区切りの目印が挟まっているかどうか
function t1CutDump(d,o,W,n){
  if(!W||!W.spans||W.spans.length<2) return null;
  const dv=new DataView(d.buffer,d.byteOffset,d.byteLength);
  // 面ごとのバイト位置を数え直す
  const at=[]; let p=o.base+o.facePtr;
  for(const f of W.faces){ at.push(p); p+=f.idx.length*4+(f.n?8:0) }
  const hx=(f,len)=>Array.from(d.subarray(Math.max(0,f),Math.max(0,f)+len),
                               v=>v.toString(16).padStart(2,"0")).join(" ");
  const L=["  面の並びの切れ目まわり（左が前の区切りの終わり、右が次の始まり）:"];
  for(const sp of W.spans.slice(1,(n||4)+1)){
    const q=at[sp.from]; if(q==null) continue;
    L.push(`    +${(q-o.base-o.facePtr)}  ${hx(q-24,24)} ┃ ${hx(q,32)}`);
  }
  return L;
}

// ============================================================
//  部品は「命令の列」だった。実行ファイルのコードから読み取った仕様:
//
//   部品の頭16バイト = 面/頂点/法線/色 の位置（部品の先頭からの相対）
//   +0x10 から 命令が並ぶ。命令は 命令コード(u32) ＋ 引数(u32)。長さは命令ごとに違う
//
//     0  終了
//     1  12B  (1, 置き場所, 個数)        頂点を個数ぶん読み、置き場所から順に入れる
//     2  16B  (2, 置き場所, 個数, 個数2) 頂点と法線を読む
//     3   8B / 4 16B / 5 4B / 6 8B / 7 12B   行列や描画の設定（形には関わらない）
//     8以上  8B  (命令, 枚数)            面を枚数ぶん描く。種類は命令で決まる
//
//   面の1枚の大きさ:  8 → 20B 三角＋法線 / 9 → 24B 四角＋法線
//                    10 → 12B 三角      / 11 → 16B 四角
//
//   面の頂点番号は「置き場所（スロット）×4」。本当の頂点番号ではない。
//   頂点854個の部品で番号が 0..167 までしか出てこなかったのはこのため
//   （置き場所はスクラッチパッド 1KB ぶんしかない）。
//
//   実物 sector 5927 の本体で検算: 命令163個で頂点の直前ちょうどに終わり、
//   読んだ頂点は 854個（ファイルの頂点数と一致）、面のバイト数も 12,736 と一致した。
// ============================================================
const T1_CMD_LEN={0:0,1:12,2:16,3:8,4:16,5:4,6:8,7:12};
const T1_FACE_OP={8:{size:20,n:3,nrm:true},9:{size:24,n:4,nrm:true},
                  10:{size:12,n:3,nrm:false},11:{size:16,n:4,nrm:false},
// 命令12・13 は、総当たりの解き方だと「12=三角+法線／13=三角+12バイト」という
// 通ってしまう別解を選んでいた。生のバイト列で確かめたら違った。
//   命令13 の記録 24B の 4つ目の語は、**4の倍数で頂点数の内側** に収まる。
//   dump3 の両キャラ・全部品を合わせて 51枚中51枚。つまり4つ目の頂点番号。
//   最後の8バイトは ±4300 に収まり詰め物が0 → 法線。51枚中51枚。
//   命令12 の4つ目の語は 8枚中0枚しか通らない → こちらは三角のまま。
// 三角として読んでいたので、19枚ぶんの面が欠け、色の割り当てもそこでずれていた
                  12:{size:20,n:3,nrm:true},13:{size:24,n:4,nrm:true}};
const T1_SLOTS=256;
// メモリから取れた骨の行列。区切り（命令5）の番号で引く。null なら骨なしで描く
let T1_BONES=null;
let T1_BONES_REAL=false;         // メモリから取れた本物か（本物があれば推測は使わない）
// ============================================================
//  色は「面の命令ごと」に並び方が違う
//
//  部品ごとに1つの引き方（頂点ごと／面に1色…）を決めて全部の面に当てていたが、
//  1つの部品の中で面の命令が混ざっている。命令ごとに1枚あたりの語数が違うので、
//  1つの引き方で通すと、違う命令の面に当たった所から先が全部ずれる。
//  画面がところどころ塊で別の色になっていたのはこれ。
//
//  実測（dump3・合計が色のバイト数にぴったり合う組み合わせを総当たりで解いた）:
//    小さい部品8個: 命令9 が 27枚で 108B → 命令9 = 1語/枚（一意）
//    1P 本体 3076B: 命令8=1 命令9=1 命令12=4 命令13=4（一意）
//    ×2 の部品 256B: 命令12=4 命令13=4（一意）
//  命令12・13 は3角の面なので、4語 ＝ 基準1語 ＋ 角ごとに1語
// ============================================================
// 命令12・13 は**テクスチャ付き**の面だった。色の語は
//   語0 = 色（テクスチャをそのまま出すので 255,255,255）
//   語1〜 = 角ごとの u,v（上半分に CLUT とテクスチャページ）
// 実測（dump3）: 1P 本体の21枚すべてで語0が白、u,v は 63/63 が 0〜255 に収まる。
// ページは 1P が 0x1e、2P が 0x1f。CLUT は 0x7800〜0x7a83。
// つまりこの2つの命令では、角の色は**引いてはいけない**（UV を色として塗ってしまう）
// ============================================================
//  差し替えの部品（手・顔）を、どの骨に付けるか
//
//  差し替えの部品は命令5 が1回しかなく、どの骨に付くかは部品の中に
//  書かれていない。そのままだと全部が骨0（腰の付け根）に付いてしまう。
//
//  答えは RAM の「描く命令の並び」にあった（dump3・1P は 0x801E69C4 から）:
//    6, 骨の行列, 別の行列, 0x10, 0, 右手1, 右手2, 右手3
//    6, 骨の行列, 別の行列, 0x10, 0, 左手1, 左手2, 左手3
//    6, 骨の行列, 別の行列, 顔
//  その行列が表B の何番目かを数えると
//    1P 右手 → 骨30　左手 → 骨36　顔 → 骨39
//    2P 右手 → 骨24　左手 → 骨30　顔 → 骨33
//  どれも腕の鎖（付け根→肩→肘→手首）のいちばん先の骨で、顔は頭の骨。
//
//  部品の頂点は、付く骨の区切りと**同じ骨の座標**で書かれている（手は X が
//  11 から始まる＝手首から先。その区切りの本体の頂点も X が 0 から）。
//  だから、部品の頂点がいちばん近くに重なる区切りを選べば、RAM が無くても
//  決まる。各頂点から区切りのいちばん近い頂点までの距離の、近いほう 1/4 の平均で比べる
//  （手首のつなぎ目だけ重なればよい）。上の6つとも RAM の答えと一致した。
//
//  前の版は「箱の中心がいちばん近い区切り」で選んでいて、手は上腕（1P 区切り34・28）
//  に付いていた。腕から緑の破片が飛び出していたのはこれ
// ============================================================
function t1SlotAttach(d,objs){
  const body=objs.find(o=>!o.group&&o.run&&o.run.vseg);
  if(!body) return null;
  const dv=new DataView(d.buffer,d.byteOffset,d.byteLength);
  const V=(o,i)=>{ const q=o.base+o.vertPtr+i*8;
    return q+6<=d.length?[dv.getInt16(q,true),dv.getInt16(q+2,true),dv.getInt16(q+4,true)]:null };
  const segV=new Map(), vs=body.run.vseg;
  for(let i=0;i<vs.length;i++){ const sg=vs[i]; if(sg==null) continue; const v=V(body,i); if(!v) continue;
    const a=segV.get(sg)||[]; a.push(v); segV.set(sg,a) }
  if(!segV.size) return null;
  const out=new Map();
  for(const o of objs){
    if(!o.group||!o.run) continue;
    const P=[]; for(let i=0;i<o.nv;i++){ const v=V(o,i); if(v) P.push(v) }
    if(!P.length) continue;
    let best=null;
    for(const [sg,a] of segV){
      const ds=P.map(p=>{ let m=1e9;
        for(const v of a){ const e=Math.hypot(p[0]-v[0],p[1]-v[1],p[2]-v[2]); if(e<m) m=e }
        return m }).sort((x,y)=>x-y);
      const h=ds.slice(0,Math.max(1,ds.length>>2));
      const sc=h.reduce((t,x)=>t+x,0)/h.length;
      if(!best||sc<best.d) best={seg:sg,d:sc};
    }
    if(best) out.set(o.base,best.seg);
  }
  return out.size?out:null;
}
const T1_COL_WORDS={8:1,9:1,12:4,13:4};
const T1_COL_TEX={12:true,13:true};        // 語1以降が色ではなく u,v
// 貼りもの（顔の目・眉・傷）を、頭の面から外へ押し出す量。
// 同じ所にあると内側に埋まって見えない。モデルの大きさは背が800前後なので、
// 6 は目で見て分からない程度
let T1_DECAL_PUSH=6;
// テクスチャ付きの面の、貼り先を読む。並びはプレステの描画命令そのもの:
//   語0: 色（テクスチャをそのまま出すので 255,255,255）
//   語1: u0,v0 ＋ 上半分に CLUT
//   語2: u1,v1 ＋ 上半分にテクスチャページ
//   語3: u2,v2 ＋ 上半分に u3,v3（四角のときだけ。三角では 0）
function t1FaceTex(d,o,pf,corners){
  if(!pf||!pf.tex) return null;
  const cp=o.base+o.colPtr, q=i=>cp+(pf.at+i)*4;
  if(q(3)+4>d.length) return null;
  const clut=d[q(1)+2]|(d[q(1)+3]<<8);
  const page=d[q(2)+2]|(d[q(2)+3]<<8);
  const uv=[[d[q(1)],d[q(1)+1]],[d[q(2)],d[q(2)+1]],[d[q(3)],d[q(3)+1]]];
  if(corners===4) uv.push([d[q(3)+2],d[q(3)+3]]);
  return {uv,clut,page,
    tp:[[4,8,16,16][(page>>7)&3],(page&15)*64,((page>>4)&1)*256,(clut&63)*16,clut>>6]};
}
// VRAM の写し（1024×512×2バイト）を、絵に貼れる形にする。
// シェーダは r + g*256 で16ビットの語を読む
function t1VramRGBA(buf){
  if(!buf||buf.length<1024*512*2) return null;
  const out=new Uint8Array(1024*512*4);
  for(let i=0;i<1024*512;i++){ out[i*4]=buf[i*2]; out[i*4+1]=buf[i*2+1]; out[i*4+2]=0; out[i*4+3]=255 }
  return out;
}
let T1_VRAM=null;
// 色の入っていない部品を塗る色
const T1_NO_COLOR=[.62,.62,.6];
// 部品の色の欄（次の部品の手前まで）が全部同じ語なら true。
// 本物のモデルは白1色でも、テクスチャの u,v や面ごとの色が混じるので同じ語だけにはならない
function t1ColorBlank(d,o,ends){
  const st=o.base+o.colPtr; let en=d.length;
  for(const b of ends) if(b>st&&b<en) en=b;
  if(en-st<16) return false;
  for(let q=st+4;q+4<=en;q++) if(d[q]!==d[q-4]) return false;
  return true;
}
function t1SetVram(rgba){ T1_VRAM=rgba||null; return !!T1_VRAM }
function t1ColWords(op,corners){
  const w=T1_COL_WORDS[op];
  return w==null?corners+1:w;   // 分かっていない命令は 角+1 を当てにいく
}
function t1ColorPlan(run){
  if(!run||!run.faces) return null;
  // t1Run が命令の列を歩きながら数えた位置があれば、それを使う。
  // 面だけを見て数えると、命令2 が使う頂点ごとの色を取りこぼす
  if(run.colWords!=null&&run.faces.every(f=>f.cW!=null)){
    const at=run.faces.map(f=>({at:f.cAt,w:f.cW,corners:f.idx.length,
                               tex:!!T1_COL_TEX[f.op],vert:f.cW===0}));
    return {at,words:run.colWords,vcolAt:run.vcolAt};
  }
  const at=new Array(run.faces.length); let p=0;
  for(let i=0;i<run.faces.length;i++){
    const f=run.faces[i], w=t1ColWords(f.op,f.idx.length);
    at[i]={at:p,w,corners:f.idx.length,tex:!!T1_COL_TEX[f.op]}; p+=w;
  }
  return {at,words:p};
}
// ============================================================
//  区切りごとの「回転中心 B」
//
//  頂点はバインドポーズの共有空間に入っているので、R をそのまま掛けると
//  モデル全体の原点を中心に振り回される。区切りごとの中心を引いてから掛ける。
//  実測（dump3・継ぎ目の辺が変換でどれだけ伸びるか、小さいほど良い）:
//    1P  B なし 129 → 重心 79 → 箱の中心 74
//    2P  B なし  95 → 重心 51 → 箱の中心 52
//  半分になる。**それでも既定は "none"**。
//  向きを直して絵を並べたら、B を引いたほうが姿は崩れていた（頭が消える）。
//  継ぎ目の伸びという数は下がるのに、見た目は悪くなる。
//  v4.23.0 の「縦横比で選んで外した」のと同じ形の失敗なので、
//  数だけで決めず、既定は引かないことにした。画面から試せる
// ============================================================
let T1_BONE_ORIGIN="none";             // "none" / "cent" / "box"
function t1BoneOrigins(d,o,mode){
  if(!mode||mode==="none"||!o.run||!o.run.vseg) return null;
  if(o._boff&&o._boffMode===mode) return o._boff;
  const dv=new DataView(d.buffer,d.byteOffset,d.byteLength);
  const vs=o.run.vseg, acc=new Map();
  for(let i=0;i<vs.length;i++){
    const s=vs[i]; if(s==null) continue;
    const q=o.base+o.vertPtr+i*8; if(q+6>d.length) continue;
    const v=[dv.getInt16(q,true),dv.getInt16(q+2,true),dv.getInt16(q+4,true)];
    let a=acc.get(s);
    if(!a){ a={n:0,s:[0,0,0],mn:[1e9,1e9,1e9],mx:[-1e9,-1e9,-1e9]}; acc.set(s,a) }
    a.n++;
    for(let k=0;k<3;k++){ a.s[k]+=v[k];
      if(v[k]<a.mn[k])a.mn[k]=v[k]; if(v[k]>a.mx[k])a.mx[k]=v[k] }
  }
  const out=new Map();
  for(const [s,a] of acc)
    out.set(s, mode==="cent"?a.s.map(v=>v/a.n):a.mn.map((v,k)=>(v+a.mx[k])/2));
  o._boff=out; o._boffMode=mode;
  return out;
}
// 区切り番号から骨の番号へのずらし量。既定は -1。
// t1Run は最初の命令5 で区切りを 1 にするが、表Bの骨は 0 から並ぶ
let T1_BONE_SHIFT=-1;
function t1SetBones(list,real){ T1_BONES=(list&&list.length)?list:null; if(real!=null) T1_BONES_REAL=!!real }
// 頂点を置き場所に入れる命令の「読み方」。既定は「1と2だけが入れる／語1が置き場所／語2が個数」。
// これで読めない部品があるので、別の読み方も用意して、合うものを探して覚える
const T1_VAR0={};
let t1RunWhy="";    // 直前の t1Run が失敗した理由（読めないモデルの原因を追うため）
function t1Run(d,base,limit,extra,V){
  V=V||T1_VAR0;
  const dv=new DataView(d.buffer,d.byteOffset,d.byteLength);
  const no=(why,at)=>{ t1RunWhy=`${why}（+0x${((at||0)-base).toString(16)}）`; return null };
  t1RunWhy="";
  const g=p=>p+4<=d.length?dv.getUint32(p,true):0;
  const facePtr=base+g(base), colPtr=base+g(base+12);
  let fp=base+0x10, xp=facePtr, vi=0, steps=0, seg=0;
  const slot=new Int32Array(T1_SLOTS).fill(-1);
  const faces=[], used=new Map();
  // その頂点が「どの区切り（命令5のあと）で入れられたか」を覚えておく。
  // 面でまとめると、前の区切りで入れた頂点が混ざる（置き場所は命令5をまたいで残る）。
  // 骨ごとの広がりを知りたいなら、入れたときの区切りでまとめないといけない
  const vseg=[];
  // もうひとつの数え方。命令5で1進め、命令6の中身（±4）を4で割って足す。
  // 4 は表がひとつ進む量（命令5の処理に addiu $t0,$t0,4 とある）なので、
  // 命令6が「骨をひとつ進める／戻す」なら、こちらが本当の骨の番号になる。
  // どちらが正しいかは、出てきた箱を見れば分かる——
  // 正しい数え方なら、骨ごとの箱は骨らしい大きさにそろうはず
  const vbone=[]; let bone=0;
  // 色の語の位置を、命令の列を歩きながら数える。
  //   命令8・9      … 1語（べた塗り）
  //   命令12・13    … 4語（色＋u,v）
  //   命令10・11    … 0語。頂点ごとの色を使う
  //   命令2         … 入れた頂点1つにつき1語（頂点ごとの色）
  // 実測（dump3・2P 本体）: 152+337+10×4+294 = 823語 で、色の 3292B にぴったり
  let cw=0; const vcolAt=[];
  while(fp+8<=d.length&&steps<(limit||4096)){
    const op=dv.getUint32(fp,true);
    if(op===0) break;
    if(op in T1_CMD_LEN){
      const arg=dv.getUint32(fp+4,true);
      if(op===5){ seg++; bone++ }                         // 命令5 = 次の骨の行列を取り出す
      if(op===6){ const v=dv.getInt32(fp+4,true); bone+=(v/4)|0 }   // 命令6 = 骨を動かす？
      if(op===1||op===2||(V.load4&&op===4)||(V.load7&&op===7)){
        // 置き場所と個数の位置・数え方は、読み方によって変わる（t1RunBest が選ぶ）
        let at=arg, n=dv.getUint32(fp+8,true);
        if(V.swap){ const t=at; at=n; n=t }
        if(V.unit4) at>>=2;
        n+=V.plus||0;
        if(at<0||at+n>T1_SLOTS||n>4096) return no(`命令${op} の置き場所 ${at}／個数 ${n} が枠(${T1_SLOTS})に収まらない`,fp);
        for(let k=0;k<n;k++){ slot[at+k]=vi; vseg[vi]=seg; vbone[vi]=bone;
          if(op===2) vcolAt[vi]=cw++;            // 命令2 は頂点ごとに色を1語使う
          vi++ }
      }
      fp+=T1_CMD_LEN[op];
    }else if(T1_FACE_OP[op]||(extra&&extra[op])){
      const k=T1_FACE_OP[op]||extra[op], cnt=dv.getUint32(fp+4,true);
      if(cnt>4096) return no(`命令${op} の枚数 ${cnt} が多すぎる`,fp);
      for(let f=0;f<cnt;f++){
        if(xp+k.size>colPtr) return no(`面の並びが色の手前を越えた`,xp);
        const idx=[];
        for(let j=0;j<k.n;j++){
          const v=dv.getUint32(xp+j*4,true);
          if(v&3) return no(`頂点番号 ${v} が4の倍数でない`,xp+j*4);
          const s=v/4;
          if(s>=T1_SLOTS||slot[s]<0) return no(`まだ入れていない置き場所 ${s} を指している`,xp+j*4);   // 頂点が置かれる前に使われた
          idx.push(slot[s]);
        }
        let nr=null;
        // 法線の持ち方は3通り: 面に1つ / 頂点ごとに番号 / 頂点ごとにそのもの。
        // 絵にするときは面に1つあれば足りるので、先頭の1つだけ取る
        if(k.nrm) nr=[dv.getInt16(xp+k.n*4,true),dv.getInt16(xp+k.n*4+2,true),dv.getInt16(xp+k.n*4+4,true)];
        // この面が使う色の語
        let cAt=-1, cW=0;
        if(op===8||op===9){ cAt=cw; cW=1; cw+=1 }
        else if(op===12||op===13){ cAt=cw; cW=4; cw+=4 }
        faces.push({idx,n:nr,seg,op,cAt,cW}); used.set(op,(used.get(op)||0)+1);
        xp+=k.size;
      }
      fp+=8;
    }else return no(`知らない命令 ${op}`,fp);          // 表に無い命令
    steps++;
  }
  if(!faces.length) return no("面が1枚も出てこなかった",fp);
  return {faces,verts:vi,vseg,vbone,vcolAt,colWords:cw,steps,segs:seg,used:[...used.entries()].sort((a,b)=>a[0]-b[0]),
          faceBytes:xp-facePtr, cmdBytes:fp+4-(base+0x10)};
}

// まだ意味の分かっていない命令3・4・6・7の中身をそのまま集める。
//
// なぜこれを見るのか：部品がどれも原点に重なって団子になるのは、
// 骨のずらし量（部品ごとの位置）が無いから。メモリからは取れなかったが、
// ファイルの中にある可能性をまだ潰していない。
// 命令4は16バイト＝命令の語のほかに3語ある。この3語が x,y,z なら、
// それがそのまま骨の位置になる。命令7も12バイトで2語ある。
//
// 見分け方：
//   座標らしい   小さい符号つきの値（|v| < 4096）。3語そろって小さければ有力
//   ポインタ     0x80000000 台
//   番号・個数   0..255 くらいの小さい正の値
// 実行はせず、ただ読んで数えるだけなので、形が崩れることはない
const T1_ARG_KIND=v=>{
  const sv=v|0;
  if((v>>>24)===0x80) return "ポインタ";
  if(v===0) return "0";
  if(sv>-4096&&sv<4096) return "座標らしい";
  if(v<65536) return "番号・個数";
  return "その他";
};
function t1OpArgs(d,base,limit){
  const dv=new DataView(d.buffer,d.byteOffset,d.byteLength);
  const g=p=>p+4<=d.length?dv.getUint32(p,true):0;
  const out=new Map();          // op -> {n, slots:[{kind:Map, mn, mx, vals:[]}]}
  let fp=base+0x10, steps=0, seg=0;
  while(fp+8<=d.length&&steps<(limit||4096)){
    const op=dv.getUint32(fp,true);
    if(op===0) break;
    if(op in T1_CMD_LEN){
      if(op===5) seg++;
      const len=T1_CMD_LEN[op], words=len/4-1;
      if(words>0){
        let e=out.get(op);
        if(!e){ e={op,n:0,seg:[],slots:[]}; for(let i=0;i<words;i++)
                  e.slots.push({kind:new Map(),mn:1e9,mx:-1e9,vals:[]});
                out.set(op,e) }
        e.n++; e.seg.push(seg);
        for(let i=0;i<words;i++){
          const v=g(fp+4+i*4), sv=v|0, sl=e.slots[i];
          sl.kind.set(T1_ARG_KIND(v),(sl.kind.get(T1_ARG_KIND(v))||0)+1);
          if(sv<sl.mn)sl.mn=sv; if(sv>sl.mx)sl.mx=sv;
          if(sl.vals.length<12) sl.vals.push(sv);
        }
      }
      fp+=len;
    }else if(T1_FACE_OP[op]){
      const cnt=dv.getUint32(fp+4,true);
      if(cnt>4096) break;
      fp+=8;
    }else break;
    steps++;
  }
  return [...out.values()].sort((a,b)=>a.op-b.op);
}
// 命令3・命令6 が合計でいくつ動かすかを数える。
//
// 部品を組み立てている関数 0x8001BBE0 で、正体が分かった（$gp=0x800CBCDC）。
//   lw 0($s0) → sw 3468($gp)   面ポインタ    （部品[0]）
//   $s0 += 8（頂点を飛ばす）
//   lw 0($s0) → sw 3736($gp)   法線ポインタ  （部品[2]）
//   lw 0($s0) → sw 3444($gp)   色ポインタ    （部品[3]）★
//
// 命令6 は `andi $t8,0x8` の旗を見てから `addu $s7,$s7,$s6`。
// ±4 ずつ動かし、旗が立っているときは動かさない。**4は色ひとつぶん。**
// つまり命令6は「色を1つ進める／1つ戻す」で、骨ではなく色だった。
// 命令3（`addu $s3,$s3,$s6`）はもう一方——おそらく法線。
//
// 色の勘定がいつも少しずれていた（「76ずれ」など）のは、
// これを読んでいなかったせいではないか。合計を出して突き合わせる
function t1PtrMoves(d,base,limit){
  const dv=new DataView(d.buffer,d.byteOffset,d.byteLength);
  let fp=base+0x10, steps=0;
  const sum={3:0,6:0}, cnt={3:0,6:0}, plus={3:0,6:0};
  while(fp+8<=d.length&&steps<(limit||4096)){
    const op=dv.getUint32(fp,true);
    if(op===0) break;
    if(op in T1_CMD_LEN){
      if(op===3||op===6){
        const v=dv.getInt32(fp+4,true);
        sum[op]+=v; cnt[op]++; if(v>0) plus[op]+=v;
      }
      fp+=T1_CMD_LEN[op];
    }else if(T1_FACE_OP[op]){
      if(dv.getUint32(fp+4,true)>4096) break;
      fp+=8;
    }else break;
    steps++;
  }
  return {sum,cnt,plus};
}
function t1PtrMoveLine(m,colorGap){
  if(!m||(!m.cnt[3]&&!m.cnt[6])) return "";
  const f=op=>`命令${op}: ${m.cnt[op]}回 合計${m.sum[op]}（＋のぶんだけなら${m.plus[op]}）`;
  let L=`  ポインタを動かす命令　${f(3)}　${f(6)}`;
  if(colorGap!=null){
    // 色の勘定のずれと突き合わせる。合えば、これが原因だったことになる
    const hit=[["合計",m.sum[6]],["＋のぶんだけ",m.plus[6]],
               ["命令3の合計",m.sum[3]],["命令3の＋のぶんだけ",m.plus[3]]]
      .filter(([,v])=>v===colorGap).map(([n])=>n);
    L+=`　色のずれ ${colorGap} と`+(hit.length?`合う: ${hit.join("・")}`:"合うものは無い");
  }
  return L;
}
// 集めた中身を、そのまま貼れる形にする。
// 分かっている命令には、その語が何なのかを添える
const T1_ARG_MEAN={
  1:["置き場所","個数"],
  2:["置き場所","個数","個数2"],
  7:["置き場所","個数"],
};
function t1OpArgLines(list){
  const L=[];
  for(const e of list){
    const mean=T1_ARG_MEAN[e.op];
    L.push(`  命令${e.op}（${e.n}回・骨 ${Math.min(...e.seg)}..${Math.max(...e.seg)}）`
      +(mean?`　＝ ${mean.join(" / ")}`:"　＝ まだ意味が分かっていない"));
    e.slots.forEach((sl,i)=>{
      const k=[...sl.kind.entries()].sort((a,b)=>b[1]-a[1])
              .map(([n,c])=>`${n}${c}`).join("/");
      L.push(`    語${i+1}${mean?`(${mean[i]||"?"})`:""} ${sl.mn}..${sl.mx} ${k} 例[${sl.vals.join(" ")}]`);
    });
    // 骨のずらし量なら、必ず負の値が出る（体の左右・前後に振れるので）。
    // 個数や番号は 0 以上にしかならない。v3.69.0 の判定はここを見ていなかったので、
    // 命令2（置き場所と個数）を「座標らしい」と言ってしまった
    if(!mean&&e.slots.length===3&&e.slots.every(sl=>sl.mn<0&&sl.mn>-4096&&sl.mx<4096))
      L.push("    ★3語とも負の値を含む小さい符号つき。骨のずらし量（x,y,z）の可能性がある");
    // 値が2種類しかなく符号違いなら、向きの切り替えや親子のたどりかもしれない
    if(e.slots.length===1&&e.slots[0].mn===-e.slots[0].mx&&e.slots[0].mx>0){
      const v=e.slots[0].vals, alt=v.length>3&&v.every((x,i)=>i===0||x===-v[i-1]);
      if(alt) L.push(`    ★＋${e.slots[0].mx} と −${e.slots[0].mx} が交互。`
        +`骨をたどる向き（下る／戻る）の指示かもしれない`);
    }
  }
  if(!L.length) L.push("  中身のある命令が無かった");
  return L;
}
// 骨（命令5）ごとに、面が使う頂点がどのあたりに置かれているかを見る。
// 区切りごとにこぢんまり固まっていれば、部品は別々の座標系にあって
// 行列で運ばないといけない、ということ
function t1SegBoxes(d,o){
  if(!o.run) return null;
  const dv=new DataView(d.buffer,d.byteOffset,d.byteLength);
  const V=i=>{ const q=o.base+o.vertPtr+i*8;
    return [dv.getInt16(q,true),dv.getInt16(q+2,true),dv.getInt16(q+4,true)] };
  const box=new Map();
  for(const f of o.run.faces){
    let b=box.get(f.seg);
    if(!b){ b={n:0,mn:[1e9,1e9,1e9],mx:[-1e9,-1e9,-1e9]}; box.set(f.seg,b) }
    b.n++;
    for(const i of f.idx){ const p=V(i);
      for(let a=0;a<3;a++){ if(p[a]<b.mn[a])b.mn[a]=p[a]; if(p[a]>b.mx[a])b.mx[a]=p[a] } }
  }
  return [...box.entries()].sort((a,b)=>a[0]-b[0]).map(([k,b])=>({
    seg:k, n:b.n, box:b.mn.map((v,a)=>`${v}..${b.mx[a]}`).join(" "),
    span:Math.max(...b.mx.map((v,a)=>v-b.mn[a])),
    mid:b.mn.map((v,a)=>Math.round((v+b.mx[a])/2)).join(",")}));
}

// モデル1つが「命令の列として読めるか」だけを確かめる。絵にしないので速い。
// ふるい分けのついでに全ファイルにかけられるので、ボタンを押さなくても結果が出る
function t1Diagnose(d){
  const offs=t1ObjectOffsets(d);
  const objs=offs.map(p=>readT1Object(d,p)).filter(o=>o&&o.ok);
  const done=new Set(), why=[], solved=[], vars=[], audit=[], pairs=[];
  const got=new Map();                    // 読めた部品の結果。あとで数えるのに使う
  const budget={n:4};                     // 総当たりは1ファイルにつき4部品まで（全件にかけるので）
  const best=o=>t1RunBest(d,o,0,budget);
  // 1つ解けると「分かっているもの」が増えて次が解けるので、進まなくなるまで回す
  for(let pass=0;pass<4;pass++){
    const before=done.size;
    for(const o of objs){
      if(done.has(o.base)) continue;
      const r=best(o);
      if(r&&Math.abs(r.verts-o.nv)<=2){ done.add(o.base); got.set(o.base,r);
        if(r.solved) solved.push(r.solved);
        if(r.solved2) pairs.push(r.solved2);
        if(r.variant) vars.push(t1VarName(r.variant)); continue }
    }
    if(done.size===before&&pass>0) break;
    if(done.size===objs.length) break;
  }
  // 最後まで読めなかった部品の理由は、回し終えてから集める
  // （途中で集めると、あとで解けたものの理由まで残ってしまう）
  for(const o of objs){
    if(done.has(o.base)) continue;
    const r=t1RunBest(d,o,0,false);
    const w=r?`読んだ頂点 ${r.verts}個 とファイルの頂点 ${o.nv}個 が合わない`:t1RunWhy;
    if(w&&why.indexOf(w)<0) why.push(w);
    // 読めなかった部品は「数えるだけ」の調べもつけておく（理由の当たりをつけるため）
    if(audit.length<3){ try{ audit.push(t1AuditLine(t1Audit(d,o))) }catch(_){} }
  }
  // いちばん大きい部品の「骨の区切り数」も返す。
  //
  // なぜ数えるのか：エンディングに出てくる衛兵のような、ローブ姿で
  // 脚の分かれていないキャラクターが混じっている可能性があるため。
  // 格闘キャラは腕2本×6・脚2本×5・胴・頭で30前後の区切りを持つが、
  // ローブの立ち姿ならずっと少ないはず。
  // 「使用可能な8人＋ボス」で数を合わせる考え方は、こういうキャラには通じない
  // 大きさも返す。ウダン皇帝は身長152cmで小柄、という設定があるので、
  // 背の高さを並べれば候補が絞れる。絵を見なくても分かること
  let segs=0, tris=0, ext=0;
  { const big=objs.filter(o=>done.has(o.base)).sort((a,b)=>b.nv-a.nv)[0];
    // 読めたときの結果をそのまま使う。読み直すと、覚えた読み方の具合で
    // 取れないことがある（最初はここで読み直して 0 になっていた）
    const r=big&&got.get(big.base);
    if(r&&r.faces){ segs=r.segs||0;
      tris=r.faces.reduce((n,f)=>n+(f.idx.length>3?2:1),0);
      const dv=new DataView(d.buffer,d.byteOffset,d.byteLength);
      const mn=[1e9,1e9,1e9], mx=[-1e9,-1e9,-1e9];
      for(let i=0;i<r.verts;i++){ const q=big.base+big.vertPtr+i*8;
        if(q+6>d.length) break;
        for(let a=0;a<3;a++){ const v=dv.getInt16(q+a*2,true);
          if(v<mn[a])mn[a]=v; if(v>mx[a])mx[a]=v } }
      ext=Math.round(Math.max(...mn.map((v,a)=>mx[a]-v))); } }
  return {parts:objs.length,run:done.size,fail:objs.length-done.size,why,solved,vars,audit,pairs,segs,tris,ext};
}
// 理由の「種類」だけを取り出す（位置や数を除いてまとめるため）
function t1WhyKind(w){
  return String(w||"")
    .replace(/（\+0x[0-9a-f]+）/,"")
    .replace(/\d+/g,"N").trim();
}

// ============================================================
//  命令12〜15 の「面1枚のバイト数」を、バイト数の勘定から割り出す
//  実行ファイルの表（0x80010308）は15命令ぶんあるのに、こちらは11までしか
//  知らなかった。37体が「知らない命令 12」で止まっていたのはこれが理由。
//  面の領域は「枚数 × 1枚の大きさ」の合計にぴったり一致するはずなので、
//  未知の大きさは引き算で出る（10と11のときと同じやり方）
// ============================================================
const T1_KNOWN_SIZE={8:20,9:24,10:12,11:16};
// 引き算で分かった命令は覚えておく。未知が1つのときしか解けないので、
// 1つ解けるたびに「分かっているもの」が増え、次が解けるようになる（雪だるま式）
const T1_LEARNED={};
// 実行ファイルから読んだ、面1枚のバイト数。処理の中の addiu $s2,$s2,N に
// 書いてある（v3.76.0 で命令8〜15の8つとも、こちらの表と一致した）。
// これがあるときは、データの辻褄合わせで探さずにこの数を使う。
// 「通る読み方が2通りあるので、若い番号を小さいほうにする」という
// こちらの決めごとは、これで要らなくなる
let T1_EXE_SIZE=null;
function t1SetExeSizes(m){
  T1_EXE_SIZE=(m&&Object.keys(m).length)?m:null;
  return T1_EXE_SIZE?Object.keys(T1_EXE_SIZE).length:0;
}
// 実行ファイルから分かるのは「面1枚が何バイトか」だけ。
// その中で頂点がいくつで法線をどう持つかは書いていないので、
// そこはデータに決めさせる（面の領域のバイト数と突き合わせる、今までのやり方）。
//
// v3.77.0 は、24バイトなら頂点4＋法線、と勝手に決めてしまった。
// 実際は 命令12=20B が頂点3＋法線8 なので、24B＝頂点3＋12 で、
// 12 は頂点ごとの法線。三角形の数が変わって、それで壊れたと分かった。
// バイト数は実行ファイル、持ち方はデータ。混ぜない
function t1ExeSizeOK(op,size){
  return !T1_EXE_SIZE||!T1_EXE_SIZE[op]||T1_EXE_SIZE[op]===size;
}
function t1Learn(op,k){ T1_LEARNED[op]={size:k.size,n:k.n,nrm:k.nrm} }
function t1SizeOf(op){
  return T1_KNOWN_SIZE[op]||(T1_LEARNED[op]&&T1_LEARNED[op].size)||0;
}
// 面のバイトを消費せず、命令と枚数だけ数える。知らない命令も (命令,枚数) の
// 8バイトだとみなして読み進める（8〜11 がその形なので、続きも同じはず）
function t1ScanOps(d,base,limit){
  const dv=new DataView(d.buffer,d.byteOffset,d.byteLength);
  const g=p=>p+4<=d.length?dv.getUint32(p,true):0;
  const facePtr=g(base), colPtr=g(base+12);
  const counts=new Map();
  let fp=base+0x10, steps=0;
  while(fp+8<=d.length&&steps<(limit||4096)){
    const op=dv.getUint32(fp,true);
    if(op===0) break;
    if(op in T1_CMD_LEN){ fp+=T1_CMD_LEN[op]; steps++; continue }
    if(op<8||op>15) return null;                 // 命令は 1..15 しかない
    counts.set(op,(counts.get(op)||0)+dv.getUint32(fp+4,true));
    fp+=8; steps++;
  }
  return {counts,faceBytes:colPtr-facePtr};
}
// 未知の命令が1つだけなら、その大きさは引き算で決まる
function t1SolveSize(scan){
  if(!scan) return null;
  let known=0; const unknown=[];
  for(const [op,n] of scan.counts){
    const sz=t1SizeOf(op);
    if(sz) known+=sz*n; else unknown.push([op,n]);
  }
  if(unknown.length!==1) return null;
  const [op,n]=unknown[0], rest=scan.faceBytes-known;
  if(n<1||rest<=0||rest%n) return null;
  const size=rest/n;
  if(size<8||size>64||size%4) return null;
  if(!t1ExeSizeOK(op,size)) return null;          // 実行ファイルと食い違うなら採らない
  return {op,size,count:n};
}
// 大きさが決まれば、中身の並べ方は数通りしかない
function t1Layouts(size){
  const out=[];
  for(const n of [3,4]){
    const rest=size-n*4;
    if(rest===0) out.push({size,n,nrm:false});          // 頂点番号だけ
    else if(rest===8) out.push({size,n,nrm:true});       // ＋面に法線1つ
    else if(rest===n*4) out.push({size,n,nrm:false});    // ＋頂点ごとの法線番号
    else if(rest===n*8) out.push({size,n,nrm:true});     // ＋頂点ごとの法線
  }
  return out;
}
// 未知の命令を含む部品を、大きさと並べ方を当てながら読む
function t1RunExtra(d,base,limit,V){
  const scan=t1ScanOps(d,base,limit);
  if(!scan) return null;
  // 覚えている命令はそのまま使う
  const extra={};
  for(const op of Object.keys(T1_LEARNED)) extra[op]=T1_LEARNED[op];
  // 覚えているだけで読めるなら、それで済ませる
  if(Object.keys(extra).length){
    const r0=t1Run(d,base,limit,extra,V);
    if(r0&&r0.faceBytes===scan.faceBytes) return r0;
  }
  // まだ未知が1つ残っているなら、引き算で解く
  const sol=t1SolveSize(scan);
  if(!sol) return null;
  for(const k of t1Layouts(sol.size)){
    const r=t1Run(d,base,limit,Object.assign({},extra,{[sol.op]:k}),V);
    if(r&&r.faceBytes===scan.faceBytes){
      t1Learn(sol.op,k);
      return Object.assign(r,{solved:{op:sol.op,size:sol.size,n:k.n,nrm:k.nrm}});
    }
  }
  return null;
}

// ============================================================
//  頂点を置き場所に入れる命令の「読み方」を探す
//
//  既定の読み方（1と2だけが入れる）では、36体のうちほとんどが
//  「まだ入れていない置き場所を指している」で止まった。
//  命令4（16B）と命令7（12B）は 命令2・命令1 と同じ形をしているので、
//  これも頂点を入れる命令である見込みが高い。ほかに考えられる読み違いは
//    ・語1が置き場所ではなく個数（swap）
//    ・語1は置き場所のバイト位置で、4で割ると置き場所（unit4）
//    ・個数が「n個」ではなく「n+1個」（plus）
//  の3つ。全部で32通りしかないので、片っ端から試して
//  「読んだ頂点数＝ファイルの頂点数」かつ「面のバイト数がぴったり」に
//  なるものを選ぶ。当たったら覚えて、次の部品ではそれを先に試す
// ============================================================
const T1_VARIANTS=(()=>{
  const out=[];
  for(const L of [{},{load7:1},{load4:1},{load4:1,load7:1}])
    for(const p of [0,1]) for(const u of [0,1]) for(const w of [0,1]){
      if(!p&&!u&&!w&&!L.load4&&!L.load7) continue;      // 既定は別に試す
      out.push(Object.assign({},L,{plus:p,unit4:u,swap:w}));
    }
  return out;
})();
function t1VarName(V){
  if(!V||!Object.keys(V).some(k=>V[k])) return "既定";
  const a=[];
  if(V.load4) a.push("命令4も頂点を入れる");
  if(V.load7) a.push("命令7も頂点を入れる");
  if(V.swap) a.push("語1が個数・語2が置き場所");
  if(V.unit4) a.push("置き場所は4で割る");
  if(V.plus) a.push("個数は+1");
  return a.join("・")||"既定";
}
let T1_VAR_FOUND=null;      // 当たった読み方（覚えておいて次から先に試す）
// 部品ひとつを、いちばん確からしい読み方で読む。
// 「読んだ頂点数＝ファイルの頂点数」かつ「面のバイト数がぴったり」なら合格
function t1RunBest(d,o,limit,sweep){
  const okr=r=>!!r&&Math.abs(r.verts-o.nv)<=2&&(!o.faceBytes||r.faceBytes===o.faceBytes);
  let first=null;
  const tries=[null];
  if(T1_VAR_FOUND) tries.push(T1_VAR_FOUND);
  for(const V of tries){
    const a=t1Run(d,o.base,limit,null,V); if(okr(a)) return a; first=first||a;
    const b=t1RunExtra(d,o.base,limit,V); if(okr(b)) return b; first=first||b;
  }
  const firstWhy=t1RunWhy;
  // 総当たりは重い。false なら省く。{n:回数} を渡すと、その回数だけ総当たりする
  if(sweep===false) return first;
  if(sweep&&typeof sweep==="object"){ if(sweep.n<=0) return first; sweep.n-- }
  for(const V of T1_VARIANTS){
    const a=t1Run(d,o.base,limit,null,V);
    if(okr(a)){ T1_VAR_FOUND=V; return Object.assign(a,{variant:V}) }
    const b=t1RunExtra(d,o.base,limit,V);
    if(okr(b)){ T1_VAR_FOUND=V; return Object.assign(b,{variant:V}) }
  }
  // ここまで来たら、未知の命令が2つ残っている見込み。大きさの組を総当たりする
  for(const V of tries){
    const p=t1RunPair(d,o,limit,V,okr);
    if(p){ if(V) T1_VAR_FOUND=V; return p }
  }
  t1RunWhy=firstWhy;        // 理由は既定の読み方のものを返す（そちらが本筋）
  return first;
}

// ============================================================
//  読めなかった部品を「数えるだけ」で調べる。
//  面のバイトを一切消費しないので、どこかで読み違えても数は狂わない。
//  知りたいのは2つ:
//    ・面のバイト数の勘定が合うか（＝1枚の大きさの表が正しいか）
//    ・頂点を入れる命令の個数の合計が、ファイルの頂点数と合うか
//  合わなければ、頂点を入れる命令が他にもある、ということになる
// ============================================================
function t1Audit(d,o){
  const dv=new DataView(d.buffer,d.byteOffset,d.byteLength);
  const g=p=>p+4<=d.length?dv.getUint32(p,true):0;
  const faceBytes=g(o.base+12)-g(o.base);
  const cmd=new Map(), face=new Map(), cnt=new Map(), cnt2=new Map(), argMax=new Map();
  let fp=o.base+0x10, steps=0, bad=0;
  while(fp+8<=d.length&&steps<4096){
    const op=g(fp);
    if(op===0) break;
    cmd.set(op,(cmd.get(op)||0)+1);
    if(op in T1_CMD_LEN){
      if(T1_CMD_LEN[op]>=12){
        cnt.set(op,(cnt.get(op)||0)+g(fp+8));
        argMax.set(op,Math.max(argMax.get(op)||0,g(fp+4)));
      }
      if(T1_CMD_LEN[op]>=16) cnt2.set(op,(cnt2.get(op)||0)+g(fp+12));
      fp+=T1_CMD_LEN[op];
    }else if(op<=15){ face.set(op,(face.get(op)||0)+g(fp+4)); fp+=8 }
    else { bad=op; break }
    steps++;
  }
  let known=0; const unknown=[];
  for(const [op,n] of face){ const sz=t1SizeOf(op); if(sz) known+=sz*n; else unknown.push(op) }
  const sum=m=>[...m.values()].reduce((a,b)=>a+b,0);
  return {cmd,face,cnt,cnt2,argMax,faceBytes,known,unknown,bad,nv:o.nv,
          load12:(cnt.get(1)||0)+(cnt.get(2)||0),
          load47:(cnt.get(4)||0)+(cnt.get(7)||0),
          faces:sum(face),
          gap:unknown.length?null:known-faceBytes};
}
// 部品ひとつぶんの調べた結果を1行にする
function t1AuditLine(a){
  const ord=m=>[...m.entries()].sort((x,y)=>x[0]-y[0]);
  const c=ord(a.cmd).map(([op,n])=>`${op}×${n}`).join(" ");
  const ld=ord(a.cnt).map(([op,n])=>`命令${op}:${n}`).join(" ");
  return `頂点 ${a.nv} ／ 入れる合計 ${a.load12}${a.load47?`（＋4と7で ${a.load47}）`:""}`
    +` [${ld}] ／ 面 ${a.faceBytes}B 勘定 ${a.gap==null?`未知の命令 ${a.unknown.join(",")}`:(a.gap===0?"ぴったり":`${a.gap>0?"+":""}${a.gap}`)}`
    +` ／ 命令 ${c}`;
}

// ============================================================
//  未知が2つ残ったとき（命令14 と 命令15）
//
//  引き算は未知が1つのときしか使えない。2つ残ったら、片方の大きさを決め打ちして
//  もう片方を引き算で出す、を総当たりする。1枚の大きさは 8〜64 の4の倍数しかないので
//  組は高々十数通りしかなく、そのうえ「読んだ頂点数＝ファイルの頂点数」かつ
//  「面のバイト数がぴったり」を通るものはさらに少ない。
//  答えが1つに絞れたときだけ覚える（絞れないのに覚えると、あとの部品を巻き添えにする）
// ============================================================
const T1_SIZE_TRY=[12,16,20,24,8,28,32,36,40,44,48,52,56,60,64];
function t1SolveSize2(scan){
  if(!scan) return null;
  let known=0; const unknown=[];
  for(const [op,n] of scan.counts){ const sz=t1SizeOf(op); if(sz) known+=sz*n; else unknown.push([op,n]) }
  if(unknown.length!==2) return null;
  const rest=scan.faceBytes-known; if(rest<=0) return null;
  const [[opA,nA],[opB,nB]]=unknown;
  if(nA<1||nB<1) return null;
  const out=[];
  for(const a of T1_SIZE_TRY){
    const r=rest-a*nA;
    if(r<=0||r%nB) continue;
    const b=r/nB;
    if(b<8||b>64||b%4) continue;
    if(!t1ExeSizeOK(opA,a)||!t1ExeSizeOK(opB,b)) continue;   // 実行ファイルと食い違う組は捨てる
    out.push([{op:opA,size:a},{op:opB,size:b}]);
  }
  return out.length?out:null;
}
// 未知2つの部品を、大きさの組と並べ方を当てながら読む。
// 合格したものを全部集めて、大きさが1組に絞れたときだけ覚える
function t1RunPair(d,o,limit,V,okr){
  const scan=t1ScanOps(d,o.base,limit);
  const pairs=t1SolveSize2(scan);
  if(!pairs) return null;
  const learned={}; for(const op of Object.keys(T1_LEARNED)) learned[op]=T1_LEARNED[op];
  const hits=[];
  for(const [A,B] of pairs)
    for(const ka of t1Layouts(A.size)) for(const kb of t1Layouts(B.size)){
      const extra=Object.assign({},learned,{[A.op]:ka,[B.op]:kb});
      const r=t1Run(d,o.base,limit,extra,V);
      if(okr(r)&&r.faceBytes===scan.faceBytes) hits.push({r,A:Object.assign({},A,ka),B:Object.assign({},B,kb)});
    }
  if(!hits.length) return null;
  // 命令14と命令15の出現回数が同じだと、大きさを入れ替えても勘定は合う。
  // 既に分かっている組は 8→3頂点/9→4頂点、10→3頂点/11→4頂点 と、
  // 若い番号が小さいほうだった。同じ並びになる読み方を先に採る
  const pairOK=h=>{ const [lo,hi]=h.A.op<h.B.op?[h.A,h.B]:[h.B,h.A];
    return lo.size<=hi.size?0:1 };
  hits.sort((x,y)=>pairOK(x)-pairOK(y)
    ||(x.A.op-y.A.op)||(x.A.size-y.A.size)||(x.B.size-y.B.size));
  const sizes=k=>new Set(hits.map(h=>h[k].size));
  const one=sizes("A").size===1&&sizes("B").size===1;
  const h=hits[0];
  // 1つに絞れなくても覚える。覚えないと毎回解き直すことになり、
  // 読むたびに形が変わってしまう（三角形の数が回ごとに違っていた）
  t1Learn(h.A.op,h.A); t1Learn(h.B.op,h.B);
  return Object.assign(h.r,{solved2:{a:h.A,b:h.B,ways:hits.length,sure:one}});
}

// ============================================================
//  骨の表が「本当に骨か」を、当ててみて確かめる
//
//  個数が近いというだけで選ぶと、まるで違う行列の並び（画面用や光源用）を
//  掴んでしまい、頂点が全部どこかへ飛んで何も残らなくなる。
//  そこで候補ごとに実際に頂点を運んでみて、
//    ・枠の中に収まった頂点の割合
//    ・全体の大きさが人として筋が通るか
//  を見る。これなら中身を知らなくても良し悪しが決まる
// ============================================================

// ============================================================
//  仮の骨組み（形から組み立てる）
//
//  メモリに本物の行列は無かった。だが測れる事実が1つある:
//  区切りには「Z を反転しただけの対」がきれいに並んでいる。誤差1以内で一致する。
//  これは左右の手足が、同じ形を鏡写しにして作られているということ。
//  同じ場所に重なっているなら、対を左右に開くだけで形が出る。
//
//  推測なので既定では使わない。当てるかどうかは見る人が決める
// ============================================================
function t1SegBoxMap(d,o){
  if(!o||!o.run) return null;
  const dv=new DataView(d.buffer,d.byteOffset,d.byteLength);
  const box=new Map();
  for(const f of o.run.faces){
    const k=f.seg|0;
    let b=box.get(k);
    if(!b){ b={n:0,mn:[1e9,1e9,1e9],mx:[-1e9,-1e9,-1e9]}; box.set(k,b) }
    b.n++;
    for(const i of f.idx){ const p=o.base+o.vertPtr+i*8;
      if(p+6>d.length) continue;
      const v=[dv.getInt16(p,true),dv.getInt16(p+2,true),dv.getInt16(p+4,true)];
      for(let a=0;a<3;a++){ if(v[a]<b.mn[a])b.mn[a]=v[a]; if(v[a]>b.mx[a])b.mx[a]=v[a] } }
  }
  return box;
}
// Z を反転すると重なる区切りどうしを見つける
function t1MirrorPairs(box,tol){
  const t=tol==null?10:tol, keys=[...box.keys()].sort((a,b)=>a-b), out=new Map();
  const near=(a,b)=>Math.abs(a-b)<=t;
  for(let i=0;i<keys.length;i++){
    if(out.has(keys[i])) continue;
    const a=box.get(keys[i]);
    for(let j=i+1;j<keys.length;j++){
      if(out.has(keys[j])) continue;
      const b=box.get(keys[j]);
      if(a.n!==b.n) continue;
      if(near(a.mn[0],b.mn[0])&&near(a.mx[0],b.mx[0])&&
         near(a.mn[1],b.mn[1])&&near(a.mx[1],b.mx[1])&&
         near(a.mn[2],-b.mx[2])&&near(a.mx[2],-b.mn[2])){
        out.set(keys[i],keys[j]); out.set(keys[j],keys[i]); break;
      }
    }
  }
  return out;
}
// 対を左右に開く。開く量は、対にならない区切り（胴）の奥行きから決める
// 鎖をたどって積む骨組み。
//
// 実物 #68 の中心を見ると、こうなっていた。
//   17(腿)  1軸目 -133   3軸目 ±51    ← 付け根だけが左右に離れている
//   18(脛)      +54          ±2
//   19          +79          ±1
//   20          +31          ±2
//   21          +33          ±2
// 腕も同じで、4 は ±3、8 は ±16。
// **左右に離れているのは鎖の先頭だけ**で、その先は ±2 しか離れていない。
//
// これは「各部品の座標が親からの相対」ということ。
// 脛の座標は腿の先を原点とした値なので、鎖をたどって足さないと場所が合わない。
// 命令6 の ＋4 / −4 の交互（下る／戻る）とも噛み合う。
//
// ここでやるのは、続き番号の区切りをひと続きの鎖とみなして、
// 親の中心を足していくこと。**推測であることは変わらない**ので、
// 効き具合を変えられるようにして、切れるようにしてある
// 二つの数え方を並べて、どちらが骨らしいかを数で言う。
// 骨ごとの箱が骨らしい大きさにそろっているほうが正しい数え方のはず。
// 「いちばん大きい辺」と「ぺたんこな区切りの数」で比べる
// 追記（v3.93.0）。命令6は骨を動かしていなかった。処理を読んだら
//   0x8001f434  andi $v0, $t8, 0x8     ← 描画の旗を見て
//   0x8001f438  bne  $v0, $zero, …     ←   立っていたら何もしない
//   0x8001f440  addu $s7, $s7, $s6     ← $s7 に語1を足すだけ
// 命令3も同じで `addu $s3, $s3, $s6`。どちらも骨には触っていない。
// $s2 が面のデータを指していた（lw $t4,0($s2) / addiu $s2,$s2,N）ので、
// $s3 と $s7 も部品の中のどれかを指すポインタで、
// 命令3・6 は**それを前後にずらす命令**。
// 命令6が ±4 で描画の旗で切り替わるのは、色ひとつが4バイトだから——
// 色の引き方のずれ（「76ずれ」など）の出どころがこれかもしれない。
//
// 下の比べは、読む前に「データに答えさせる」つもりで書いたもの。
// 結果は「どちらとも言えない」で、読んだ答えと食い違わなかった。
// 残しておくが、決め手になったのは逆アセンブルのほう
function t1BoneCountCompare(A,B){
  const stat=V=>{
    if(!V||!V.length) return null;
    const big=V.map(x=>Math.max(...x.size.split("×").map(Number)));
    return {n:V.length, max:Math.max(...big),
      avg:Math.round(big.reduce((a,b)=>a+b,0)/big.length),
      flat:t1FlatSegs(V).length};
  };
  const a=stat(A), b=stat(B);
  if(!a||!b) return "";
  const f=(t,x)=>`${t}: ${x.n}区切り　いちばん大きい辺 ${x.max}　平均 ${x.avg}　ぺたんこ ${x.flat}個`;
  const better=b.max<a.max*0.9?"命令6も数えたほう"
             :a.max<b.max*0.9?"命令5だけのほう":"どちらとも言えない";
  return `  骨の数え方くらべ　${f("命令5だけ",a)}　／　${f("命令6も数える",b)}`
    +`　→ 骨らしいのは ${better}`;
}
// モデルのファイルのうち、どのバイトが何に使われているかを数え上げ、
// **説明の付かない余り**を出す。
//
// 外からの助言（3-2）：メッシュ（頂点・法線・面・色）の合計を差し引いた
// 余剰領域に、30要素のベクトル配列が無いか確認せよ。
//
// これは一度もやっていなかった。部品の中身は読めるようになったが、
// 「ファイル全体のどこが余っているか」は見ていなかった。
// 骨の親子の表がこのファイルにあるなら、そこにしか置けない
function t1FileUse(d,objs){
  if(!d||!objs||!objs.length) return null;
  const used=[];
  const add=(a,b,what)=>{ if(b>a) used.push({a,b,what}) };
  for(const o of objs){
    if(!o||!o.ok) continue;
    add(o.base,o.base+16,"部品の頭");
    add(o.base+o.vertPtr,o.base+o.normPtr,"頂点");
    add(o.base+o.normPtr,o.base+o.facePtr,"法線");
    add(o.base+o.facePtr,o.base+o.colPtr,"面");
    add(o.base+o.colPtr,o.base+o.colPtr+o.nv*4,"色");
    // 命令の列は部品の頭の直後から。終わりは分からないので、頂点の手前まで
    add(o.base+16,o.base+o.vertPtr,"命令の列");
  }
  used.sort((x,y)=>x.a-y.a);
  const gaps=[]; let p=0;
  for(const u of used){
    if(u.a>p) gaps.push({a:p,b:u.a});
    p=Math.max(p,u.b);
  }
  if(p<d.length) gaps.push({a:p,b:d.length});
  const big=gaps.filter(g=>g.b-g.a>=64);
  return {len:d.length, used:used.reduce((s,u)=>s+(u.b-u.a),0),
          gaps:big.sort((x,y)=>(y.b-y.a)-(x.b-x.a))};
}
function t1FileUseLines(d,u,nb){
  if(!u) return [];
  const L=[`  ファイルの使われ方: 全 ${u.len}B　説明の付く所 ${u.used}B`
    +`　余り（64B以上）${u.gaps.length}か所`];
  if(!u.gaps.length){ L.push("    余りなし。骨の親子の表はこのファイルには無い"); return L }
  const dv=new DataView(d.buffer,d.byteOffset,d.byteLength);
  for(const g of u.gaps.slice(0,4)){
    const n=g.b-g.a;
    const hex=[]; for(let i=0;i<Math.min(24,n);i++) hex.push(d[g.a+i].toString(16).padStart(2,"0"));
    const per=nb?Math.floor(n/nb):0;
    L.push(`    +0x${g.a.toString(16)}〜+0x${g.b.toString(16)}　${n}B`
      +(nb&&per>=4?`（骨${nb}本なら1本${per}B）`:"")
      +`　先頭 ${hex.join(" ")}`);
  }
  return L;
}
// モデルの中から「骨の親子と、親からのずれ」の表を探す。
//
// 測って決まった（v4.3.0）。隣り合う骨は頂点を1点も共有していない。
//   骨の境目で重なる頂点: 4組（うち番号が隣どうし 0組）
//     18-24:22点   ← 左右の脛。鏡の対が同じ空間にいるので一致する
//     3-16 / 3-22 / 3-28: 各6点  ← 胴と、脚の付け根
// **鎖の先頭だけが親の空間にあり、その先は自分の空間。**
// だから行列がいる。これははっきりした。
//
// 残る道は、行列そのものではなく「角度＋親からのずれ」の表を
// モデルの中から見つけること。外からの助言（アプローチA）。
//   親の番号（1〜2バイト）＋ 親からのずれ (dx,dy,dz)
//   骨30本 × 8〜16バイト ＝ 240〜480バイトくらい
//
// 探し方：刻みを決め打ちせず 8/12/16 を試す。
// 親の番号は「自分より小さい」のが木の形。全部がそうでなくてもよいが、
// 半分以上がそうなら木らしい。ずれは ±2000 に収まるはず
function t1FindSkelTable(d,nb,opt){
  if(!d||!nb||nb<4) return [];
  const dv=new DataView(d.buffer,d.byteOffset,d.byteLength);
  const out=[];
  const lim=opt&&opt.limit||8;
  for(const st of [8,12,16]){
    for(const pAt of [0,1,2]){                 // 親の番号がどこにあるか
      for(const vAt of [2,4,6,8]){             // ずれの3つがどこから始まるか
        if(vAt+6>st) continue;
        for(let base=0;base+nb*st<=d.length;base+=2){
          let tree=0, nz=0, ok=true;
          for(let k=0;k<nb;k++){
            const o=base+k*st;
            const par=pAt===2?dv.getUint16(o,true):d[o+pAt];
            if(par>=nb&&par!==0xff){ ok=false; break }
            if(par<k) tree++;
            for(let a=0;a<3;a++){
              const v=dv.getInt16(o+vAt+a*2,true);
              if(Math.abs(v)>2000){ ok=false; break }
              if(v) nz++;
            }
            if(!ok) break;
          }
          if(!ok) continue;
          if(nz<nb) continue;                  // ほとんど 0 の表は捨てる
          if(tree<nb*0.6) continue;            // 木の形になっていない
          // ここが甘かった（v4.5.0）。親が全部 0 だと「親が自分より小さい」が
          // 自動で成り立ってしまい、頂点データを表として拾っていた。
          //   0←0(1,0,0) 1←0(28,0,1) 2←0(5,0,1) …   ← 親も Y も全部 0
          // 本物の木なら、親の番号は何種類も出るし、0 以外も必ず出る。
          // ずれも、3軸のどれかが全部 0 なら表ではない
          const pars=new Set(), ax=[0,0,0];
          for(let k=0;k<nb;k++){
            const o=base+k*st;
            pars.add(pAt===2?dv.getUint16(o,true):d[o+pAt]);
            for(let a=0;a<3;a++) if(dv.getInt16(o+vAt+a*2,true)) ax[a]++;
          }
          if(pars.size<4) continue;            // 親が2〜3種類しかない＝表ではない
          if(pars.size===1&&pars.has(0)) continue;
          if(ax.some(c=>c===0)) continue;      // どれかの軸が全部 0
          out.push({at:base,stride:st,pAt,vAt,tree,nz,pars:pars.size});
          if(out.length>=lim*4) break;
        }
      }
    }
  }
  // 木らしさの強い順
  out.sort((a,b)=>b.tree-a.tree||b.nz-a.nz);
  return out.slice(0,lim);
}
function t1SkelTableLines(d,nb,hits){
  if(!hits||!hits.length) return [`  骨の親子の表は見つからない（骨 ${nb}本ぶんで探した）`];
  const dv=new DataView(d.buffer,d.byteOffset,d.byteLength);
  const L=[`  骨の親子の表らしきもの ${hits.length}件（骨 ${nb}本ぶんで探した）:`];
  for(const h of hits.slice(0,3)){
    L.push(`    +0x${h.at.toString(16)}　1件${h.stride}バイト　親は+${h.pAt}　ずれは+${h.vAt}`
      +`　親が自分より小さい ${h.tree}/${nb}　親の種類 ${h.pars}`);
    const row=[];
    for(let k=0;k<Math.min(nb,8);k++){
      const o=h.at+k*h.stride;
      const par=h.pAt===2?dv.getUint16(o,true):d[o+h.pAt];
      const v=[0,1,2].map(a=>dv.getInt16(o+h.vAt+a*2,true));
      row.push(`${k}←${par}(${v.join(",")})`);
    }
    L.push("      "+row.join(" "));
  }
  return L;
}
// 隣り合う骨の境目で、頂点が同じ座標を共有しているかを数える。
//
// これを一度も測っていなかった。ここで話が決まる。
//   共有している → ファイルは既に共通の空間にある。行列は要らない。
//                   団子に見える原因は、こちらの読み方の別の所にある
//   していない   → 骨ごとの別空間だと確定。行列が無いと組み立てられない
//
// 外からの助言（アプローチB）：どの頂点がどの骨に属するかは分かっているので、
// 親の端と子の端で近接・共有される頂点を突き合わせれば、
// 外の行列に頼らずメッシュの形から骨組みを組み直せる。
// その前提が成り立つかどうかが、まずこれで分かる
function t1SegTouch(d,o,tol){
  if(!o||!o.run||!o.run.vseg) return null;
  const t=tol==null?2:tol;
  const dv=new DataView(d.buffer,d.byteOffset,d.byteLength);
  const vs=o.run.vseg, pts=new Map();          // 区切り → [[x,y,z],…]
  for(let i=0;i<vs.length;i++){
    const k=vs[i]; if(k==null) continue;
    const q=o.base+o.vertPtr+i*8; if(q+6>d.length) continue;
    if(!pts.has(k)) pts.set(k,[]);
    pts.get(k).push([dv.getInt16(q,true),dv.getInt16(q+2,true),dv.getInt16(q+4,true)]);
  }
  const keys=[...pts.keys()].sort((a,b)=>a-b);
  const out=[];
  for(let i=0;i<keys.length;i++) for(let j=i+1;j<keys.length;j++){
    const A=pts.get(keys[i]), B=pts.get(keys[j]);
    if(A.length>400||B.length>400) continue;   // 大きすぎる組は飛ばす（重い）
    let n=0;
    for(const a of A) for(const b of B)
      if(Math.abs(a[0]-b[0])<=t&&Math.abs(a[1]-b[1])<=t&&Math.abs(a[2]-b[2])<=t){ n++; break }
    if(n) out.push({a:keys[i],b:keys[j],n,
      near:keys[j]===keys[i]+1});
  }
  out.sort((x,y)=>y.n-x.n);
  return {pairs:out, segs:keys.length,
          adj:out.filter(x=>x.near).length,
          adjPts:out.filter(x=>x.near).reduce((s,x)=>s+x.n,0)};
}
function t1SegTouchLine(r){
  if(!r) return "";
  if(!r.pairs.length)
    return `  骨の境目で重なる頂点: 0組（${r.segs}区切り）`
      +"　→ 骨ごとに別の空間。行列が無いと組み立てられない";
  const top=r.pairs.slice(0,6).map(x=>`${x.a}-${x.b}:${x.n}点${x.near?"（隣）":""}`).join(" ");
  return `  骨の境目で重なる頂点: ${r.pairs.length}組`
    +`（うち番号が隣どうし ${r.adj}組・${r.adjPts}点）　${top}`
    +(r.adj>=3?"　→ 隣の骨が端を共有している。共通の空間にある見込み"
              :"　→ 隣どうしの共有が少ない。骨ごとに別の空間らしい");
}
// 「ぺたんこな区切り」を見つける。
//
// #68 の頂点の箱を高さの軸で見ると、こうなっていた。
//   19: 6点  2×88×68     20:12点  1×94×77     21: 6点  5×65×42
//   25: 6点  2×88×68     26:12点  1×94×77     27: 6点  5×65×42
//    2: 8点  3×183×237
// 高さ方向の厚みが 1〜5 しかない。**面ではなく板**で、しかも点が6〜12個。
// 手足の肉ではありえない。関節の印か、当たり判定か、影のようなものだと思う。
//
// これを手足の骨と同じに扱っていたから、鎖の積み上げがおかしくなっていた。
// まず「どれが肉で、どれが板か」を分けて出す
function t1FlatSegs(V,ratio){
  if(!V||!V.length) return [];
  const r=ratio==null?0.12:ratio;
  const big=Math.max(...V.map(x=>Math.max(...x.size.split("×").map(Number))));
  return V.filter(x=>{
    const d=x.size.split("×").map(Number);
    const thin=Math.min(...d), fat=Math.max(...d);
    return fat>0&&thin/fat<=r&&thin<big*0.05;
  }).map(x=>`${x.seg}(${x.n}点 ${x.size})`);
}
// 積んだあと、いちばん上といちばん下に来るのがどの区切りかを出す。
//
// 人の形になったかどうかは、これで数になる。
// 脚の鎖の**いちばん最後**の骨が下端にあれば、腰から脚が下に伸びている。
// 胴や頭が下端にあるなら、積み方が逆か効きすぎ。
// 背の高さの軸は生の1軸目（実物 #68 で -320..+231 と、いちばん広く振れていた）
function t1ChainEnds(box,list,runs){
  if(!box||!list) return null;
  let lo=null, hi=null;
  for(const [k,b] of box){
    const t=(list[k]&&list[k].t)||[0,0,0];
    const a=b.mn[0]+t[0], z=b.mx[0]+t[0];
    if(!lo||a<lo.v) lo={seg:k,v:a};
    if(!hi||z>hi.v) hi={seg:k,v:z};
  }
  const tail=new Set((runs||[]).map(r=>r[r.length-1]));
  const head=new Set((runs||[]).map(r=>r[0]));
  return {lo,hi,loIsLimbTip:tail.has(lo.seg),hiIsLimbTip:tail.has(hi.seg),
          loIsLimbRoot:head.has(lo.seg),hiIsLimbRoot:head.has(hi.seg)};
}
function t1ChainEndLine(e){
  if(!e) return "";
  const tag=x=>x.loIsLimbTip?"手足の先":x.loIsLimbRoot?"手足の付け根":"胴・頭のほう";
  return `　下端 区切り${e.lo.seg}（${tag(e)}）　上端 区切り${e.hi.seg}`
    +`（${e.hiIsLimbTip?"手足の先":e.hiIsLimbRoot?"手足の付け根":"胴・頭のほう"}）`;
}
// 手足の鎖を、鏡の対から割り出す。
//
// これまでは「続き番号がとぎれた所で鎖を切る」としていたが、
// とぎれ目は**面の**区切りで見ていた。#68 では 16・22・28 に面が無いので
// そこで切っていたが、頂点でまとめ直したら 16 と 22 こそが鎖の先頭だった。
//   16:24点 100×115×28@-254,-3,-127  ↔ 22:@-254,-4,+126   ← 腰。左右 ±127
//   17: 6点  87×112×33@  -6,-4,  22  ↔ 23:@  -6,-3, -21
//   18:44点 188×108×86@  64, 0,  -2  ↔ 24:@  64, 0,   2
// 面が無い区切りを切れ目とみなしていたせいで、いちばん大事な所を捨てていた。
//
// 正しい切り方は、鏡の対のほうにある。#68 では 4..15 と 16..27 が対になっていて、
// 4↔10、16↔22 のように「ずれ幅」が一定。そのずれ幅が手足の長さになる
function t1LimbRuns(box){
  const pairs=t1MirrorPairs(box);
  if(!pairs.size) return [];
  const keys=[...box.keys()].sort((a,b)=>a-b);
  const runs=[]; let cur=null;
  for(const k of keys){
    const j=pairs.get(k);
    const d=(j!=null&&j>k)?j-k:0;            // 先に来るほうだけ見る
    if(!d){ cur=null; continue }
    if(cur&&cur.d===d&&k===cur.to+1){ cur.to=k; continue }
    cur={from:k,to:k,d}; runs.push(cur);
  }
  // ずれ幅と長さが合っているものだけを手足とみなす（4..9 と 10..15 で d=6）
  const out=[];
  for(const r of runs){
    const len=r.to-r.from+1;
    if(len<2||r.d!==len) continue;
    out.push([r.from,r.to]);                  // こちら側
    out.push([r.from+r.d,r.to+r.d]);          // 鏡の側
  }
  return out.sort((a,b)=>a[0]-b[0]);
}
function t1ChainBones(d,o,amt){
  // 頂点の箱を使う。面の箱には、面を持たない区切り（#68 の 16・22・28）が
  // 入っていない。そこが鎖の先頭だったので、面の箱では取りこぼす
  const box=t1VertBoxMap(d,o)||t1SegBoxMap(d,o);
  if(!box) return null;
  return t1ChainFromBox(box,amt);
}
// t1VertBoxes と同じものを、Map の形で返す（鏡の対さがしがこの形を取る）
function t1VertBoxMap(d,o){
  if(!o||!o.run||!o.run.vseg) return null;
  const dv=new DataView(d.buffer,d.byteOffset,d.byteLength);
  const vs=o.run.vseg, box=new Map();
  for(let i=0;i<vs.length;i++){
    const k=vs[i]; if(k==null) continue;
    const q=o.base+o.vertPtr+i*8; if(q+6>d.length) continue;
    let b=box.get(k);
    if(!b){ b={n:0,mn:[1e9,1e9,1e9],mx:[-1e9,-1e9,-1e9]}; box.set(k,b) }
    b.n++;
    for(let a=0;a<3;a++){ const v=dv.getInt16(q+a*2,true);
      if(v<b.mn[a])b.mn[a]=v; if(v>b.mx[a])b.mx[a]=v }
  }
  return box.size?box:null;
}
// 箱の表だけ受け取る形にしておく。こうしないと、本物のモデルが無いと試せない
function t1ChainFromBox(box,amt){
  const keys=[...box.keys()].sort((a,b)=>a-b);
  if(keys.length<3) return null;
  const mid=k=>{ const b=box.get(k);
    return b?[0,1,2].map(a=>(b.mn[a]+b.mx[a])/2):[0,0,0] };
  // 鎖の切り方は、まず鏡の対から割り出す（手足はかならず左右一対になる）。
  // 対が見つからないときだけ、続き番号のとぎれで切る昔のやり方に落ちる
  let runs=t1LimbRuns(box).map(([a,b])=>{
    const r=[]; for(let k=a;k<=b;k++) if(box.has(k)) r.push(k); return r;
  }).filter(r=>r.length>1);
  if(!runs.length){
    runs=[]; let cur=[keys[0]];
    for(let i=1;i<keys.length;i++){
      if(keys[i]===keys[i-1]+1) cur.push(keys[i]);
      else { runs.push(cur); cur=[keys[i]] }
    }
    runs.push(cur);
  }
  const k1=amt==null?1:amt;
  const max=Math.max(...keys), list=[];
  const t=new Map();
  for(const run of runs){
    // 鎖の先頭はそのまま。2つ目からは、親の中心を積んでいく
    let acc=[0,0,0];
    for(let i=0;i<run.length;i++){
      if(i>0){ const pm=mid(run[i-1]); acc=[acc[0]+pm[0],acc[1]+pm[1],acc[2]+pm[2]] }
      t.set(run[i],acc.map(v=>v*k1));
    }
  }
  for(let k=0;k<=max;k++){
    const v=t.get(k)||[0,0,0];
    list.push({m:[4096,0,0,0,4096,0,0,0,4096],t:[Math.round(v[0]),Math.round(v[1]),Math.round(v[2])],one:4096});
  }
  list.runs=runs.map(r=>`${r[0]}..${r[r.length-1]}`);
  return list;
}
function t1GuessBones(d,o,spread){
  const box=t1SegBoxMap(d,o); if(!box) return null;
  const pairs=t1MirrorPairs(box);
  if(!pairs.size) return null;
  // 対にならない区切り＝中心線。いちばん大きいものを胴とみなす
  let widest=0;
  for(const [k,b] of box){ if(pairs.has(k)) continue;
    widest=Math.max(widest,b.mx[2]-b.mn[2]) }
  const gap=(widest||200)*(spread==null?t1Show.guessAmt:spread);
  // 肩は広く、腰は狭い。対の「高さ」で開く量を変える。
  // 高さの軸は生の X（実物 #68 で X が背の高さだった）
  let hi=-1e9, lo=1e9;
  for(const [k,b] of box){ if(!pairs.has(k)) continue;
    const c=(b.mn[0]+b.mx[0])/2; if(c>hi)hi=c; if(c<lo)lo=c }
  const span=hi>lo?hi-lo:1;
  const max=Math.max(...box.keys());
  const list=[];
  for(let k=0;k<=max;k++){
    const I={m:[4096,0,0,0,4096,0,0,0,4096],t:[0,0,0],one:4096};
    const j=pairs.get(k);
    // 対のうち、番号が小さいほうを ＋Z、大きいほうを −Z へ寄せる
    if(j!=null){
      const b=box.get(k), c=(b.mn[0]+b.mx[0])/2;
      const h=(c-lo)/span;                       // 0＝いちばん下、1＝いちばん上
      I.t=[0,0,(k<j?1:-1)*gap*(0.45+0.55*h)];
    }
    list.push(I);
  }
  list.pairs=pairs; list.gap=gap;
  return list;
}

// ============================================================
//  色の引き方を確かめる
//
//  いまは「色は頂点ごと、頂点番号で引く」と決め打ちしている。
//  #68 はそれで合っているが、模様が混ざって見えるモデルがいくつかある。
//  色の置き場所の大きさを測れば、引き方が違うかどうかは数で分かる:
//    頂点の数 × 4 と一致      → 頂点ごと（いまの読み方で正しい）
//    面の頂点の延べ数 × 4 と一致 → 面ごと（引き方が違う）
//    面の数 × 4 と一致        → 面に1色
//  色の終わりは、次の部品の始まりか、ファイルの終わり
// ============================================================
function t1ColorFit(d,objs){
  const ends=objs.map(o=>o.base).filter(x=>x>0).sort((a,b)=>a-b);
  const out=[];
  for(const o of objs){
    if(!o.ok||!o.run) continue;
    const start=o.base+o.colPtr;
    let end=d.length;
    for(const b of ends) if(b>start&&b<end) end=b;         // 次の部品の手前まで
    const bytes=end-start;
    let corner=0; for(const f of o.run.faces) corner+=f.idx.length;
    // 「置き場所ごと」＝ 面が指す枠の番号でそのまま引く形。
    // 大きい部品では枠が使い回されるので、頂点の並び順とはずれる
    let maxSlot=0; for(const f of o.run.faces) for(const i of f.idx) if(i>maxSlot) maxSlot=i;
    const cand=[["頂点ごと",o.nv*4],["面の頂点ごと",corner*4],["面に1色",o.run.faces.length*4],
                ["面に1色（四角は2枚ぶん）",o.run.faces.reduce((a,f)=>a+(f.idx.length===4?2:1),0)*4]];
    let best=null;
    for(const [name,n] of cand){ const d2=Math.abs(bytes-n);
      if(!best||d2<best.diff) best={name,n,diff:d2} }
    // 色の語の4バイト目。プレステの描画命令では、ここに命令コードが入る
    //   （色の語 ＝ コード<<24 | B<<16 | G<<8 | R）。
    // 0x20/0x28/0x30/0x38 などが並んでいたら、そこは色ではなく描画命令の並び
    const tag=new Map(); const hue=new Set();
    for(let q=start;q+4<=end;q+=4){
      tag.set(d[q+3],(tag.get(d[q+3])||0)+1);
      if(hue.size<4096) hue.add((d[q]<<16)|(d[q+1]<<8)|d[q+2]);
    }
    const tags=[...tag.entries()].sort((a,b)=>b[1]-a[1]).slice(0,4);
    const tri=o.run.faces.reduce((a,f)=>a+(f.idx.length===4?2:1),0);
    const quads=o.run.faces.filter(f=>f.idx.length===4).length;
    out.push({base:o.base,bytes,nv:o.nv,corner,faces:o.run.faces.length,maxSlot,tri,quads,
              tags,colors:hue.size,
              cand:cand.map(([n,v])=>`${n}:${Math.abs(bytes-v)}`).join(" "),
              fit:best.name,diff:best.diff,
              exact:best.diff<=8,
              // ぴったりでなくても、いちばん近いものが頂点でなく面なら面で引く。
              // 「ぴったりのときしか使わない」作りだと、少しずれただけで既定に落ちて模様が乱れる
              near:best.diff<=Math.max(64,bytes*0.08)});
  }
  return out;
}
function t1ColorLine(c){
  return `+${c.base.toString(16)}: 色 ${c.bytes}B ／ 頂点${c.nv}×4=${c.nv*4}`
    +` 面の頂点${c.corner}×4=${c.corner*4} 面${c.faces}×4=${c.faces*4}`
    +` 三角${c.tri}×4=${c.tri*4}（四角${c.quads}枚）`
    +` → ${c.fit}${c.exact?"（ぴったり）":`（${c.diff}ずれ）`}`
    +(c.picked?`／当ててみて選んだ: ${c.picked}（隣の面との色差 ${c.score}）`:"")
    +`／4バイト目 ${(c.tags||[]).map(([v,n])=>`0x${v.toString(16).padStart(2,"0")}×${n}`).join(" ")}`
    +`／色の種類 ${c.colors}／ずれ ${c.cand}`
    +`／いちばん大きい頂点番号 ${c.maxSlot}`;
}


// ============================================================
//  色の引き方を「当ててみて」決める
//
//  バイト数の一致だけでは決まらない部品がある（#135 がそれだった）。
//  そこで骨のときと同じやり方にする: 候補ごとに実際に色を引いてみて、
//  結果が筋の通るものを選ぶ。
//
//  筋の通り方の見方: **隣り合う面の色は似ているはず**。
//  キャラクターは面がひとかたまりで同じ色に塗られているので、
//  辺を共有する面どうしの色の差は小さい。引き方を間違えると色はでたらめに散り、
//  その差が跳ね上がる。中身の意味を知らなくても測れる
// ============================================================
function t1ColorIndexOf(o,mode,faceIdx,corner,slotIdx){
  if(mode==="面に1色") return faceIdx;
  if(mode==="面に1色（四角は2枚ぶん）"){
    let n=0; const F=o.run.faces;
    for(let i=0;i<faceIdx;i++) n+=F[i].idx.length===4?2:1;
    return n;
  }
  if(mode==="面の頂点ごと"){
    let n=0; const F=o.run.faces;
    for(let i=0;i<faceIdx;i++) n+=F[i].idx.length;
    return n+corner;
  }
  return slotIdx;                                  // 頂点ごと
}
function t1ColorSmooth(d,o,mode){
  if(!o||!o.run) return Infinity;
  const F=o.run.faces;
  const col=k=>{ const q=o.base+o.colPtr+k*4;
    return q+2<d.length?[d[q],d[q+1],d[q+2]]:null };
  // 面ごとの代表色（角ぜんぶの平均）。先頭の角だけだと、
  // 角によって色が変わる引き方の違いが見えない
  const rep=new Array(F.length);
  for(let i=0;i<F.length;i++){
    const a=F[i].idx; let r=0,g=0,b=0,n=0;
    for(let j=0;j<a.length;j++){
      const c=col(t1ColorIndexOf(o,mode,i,j,a[j]));
      if(c){ r+=c[0]; g+=c[1]; b+=c[2]; n++ }
    }
    rep[i]=n?[r/n,g/n,b/n]:null;
  }
  // 辺を共有する面の組を集めて、その色の差を平均する
  let sum=0, n=0;
  const seen=new Map();
  for(let i=0;i<F.length;i++){
    const a=F[i].idx;
    for(let j=0;j<a.length;j++){
      const p=a[j], q=a[(j+1)%a.length];
      const key=p<q?p*100000+q:q*100000+p;
      const prev=seen.get(key);
      if(prev===undefined){ seen.set(key,i); continue }
      const A=rep[prev], B=rep[i];
      if(!A||!B) continue;
      sum+=Math.abs(A[0]-B[0])+Math.abs(A[1]-B[1])+Math.abs(A[2]-B[2]); n++;
    }
  }
  return n?sum/n:Infinity;
}
// 候補の中から、隣り合う面の色がいちばん揃うものを選ぶ
function t1ColorBest(d,o,cands){
  let best=null;
  for(const m of cands){
    const s=t1ColorSmooth(d,o,m);
    if(best===null||s<best.score) best={mode:m,score:s};
  }
  return best;
}

// ============================================================
//  キャラクターの名前
//
//  名前と内部番号は裏技の一覧（P1 Character Modifier）から:
//    00 Chuji 01 Oliem 02 Epon 03 Hom 04 Fei 05 Mary 06 Illgoga 07 Gren
//    08 Mufu  09 Emperor Upan  0A Super Nork  0B Tori
//  モデルとの対応は、ゲーム画面（プラクティスモード）の配色と突き合わせて決めた。
//  15セクター離れた対が「同じキャラの衣装2着」で、若い側が2着目（2P側の色）。
//  8人 × 衣装2 ＋ ボス4 ＝ 20 は、形でまとめた種類数とぴったり合う
// ============================================================
// 「？」が付いているものは、こちらが色を見比べただけの推測。
// ゲーム画面と直に突き合わせて確かめたものには付けていない。
// 色合わせは2回外している（#145 をイルゴガ、#126 をオリエムとしたのが誤り）ので、
// 確かめたものと推測を札の上で区別する
const T1_NAMES={
  // ボス・隠しキャラクター
  // ノークとSノーク。目で見た推測ではなく、測った数と設定が噛み合った。
  //   組B: 3体 三角形1235  #27(5529) #28(5544) #151(9561)
  //   大きさ  #151 = 2561、#27 と #28 = 1280        ← ちょうど2倍
  // 設定に「怪人ノークは**その巨体**から繰り出される技の破壊力は…」とあり、
  // 「プレイヤーキャラクターとしては、ミニバージョンであるSノークが
  // 使用可能になる」ともある。同じモデルを半分にしたのが Sノーク。
  // 三角形の数が同じで大きさが倍、というのはそれ以外に説明が付かない
  5529:"Sノーク", 5544:"Sノーク（別衣装）", 9561:"ノーク",
  5559:"トリ", 5572:"トリ", 5585:"トリ", 5598:"トリ", 5611:"トリ",
  5624:"トリ", 5637:"トリ", 5650:"トリ", 5663:"トリ",
  5737:"？",
  // ウダンの札は外した。ウダン皇帝は身長152cmで小柄という設定なのに、
  // #154(9662) は大きさ1205 で、40体のうち大きいほうから4番目だった。合わない。
  // #153/#154 をウダンとしたのは並び順からの推測で、根拠が無くなった。
  // 同じ形でまとめると #154 は #132(9004＝フェイ) と同じ組に入るが、
  // 「同じ形」は三角形の数と部品数でしか見ていないので、これも決め手にならない
  9647:"？（大きさがウダンに合わない）", 9662:"？（大きさがウダンに合わない）",
  // ↑ 元の札は怪しい。同じ形でまとめると #154(9662) が #132(9004＝フェイ) と
  //   同じ組に入る（三角形1237）。ただし「同じ形」は三角形の数と部品数でしか
  //   見ていないので、たまたま合っただけかもしれない。断定しない。
  //   ウダン皇帝は身長152cmで小柄という設定なので、大きさの順を出すようにした。
  //   いちばん小さいものが候補になる
  9369:"ムーフー（別衣装）", // 動画 "using Mufu's second costume" の緑と紫で確定
  9383:"ムーフー",          // ボス。腹の赤い十字と橙の体で確定
  // 使用可能な8人（すべて 8755〜9484 の並びの中にいる）
  8755:"エポン？（別衣装）",8770:"エポン？",
  8835:"チュージ（別衣装）",8850:"チュージ",   // 白い上衣・赤い帯・濃い緑で確定
  8931:"オライムス（別衣装）",8946:"オライムス", // 青いトリ姿。英字表記 OLIEMS
  9004:"フェイ（別衣装）", 9018:"フェイ",       // 老人。#132/#133
  9117:"グリン（別衣装）", 9132:"グリン",       // グリン カッツ。英字表記 GREN KUTS
  // 9223/9237 に付けていた「イール・ゴガ？」は、色を見比べただけの推測だった。
  // 実機の画面と直に突き合わせた結果、イール・ゴガは **9742（#157）** のほう。
  //   ・対戦中の RAM の写しで、1P が描いていたモデルが #157（sector 9742）
  //     （表C → モデル先頭を「先頭＋語1 ＝ 表Cの1つ目」で確かめ、
  //       先頭8語がディスクの #157 と一致。一致は1件だけ）
  //   ・その場面の実機の絵が、角と尻尾のある桃色の竜人＝イール・ゴガ
  //   ・写しから組み立てた #157 も、角・尻尾・緑のレオタード・
  //     青のガントレットとブーツで、絵とそのまま重なる
  // 9223/9237 が誰なのかは、これで分からなくなった。？に戻す
  9223:"？（イール・ゴガとしていたが、9742 のほうだった）",
  9237:"？（イール・ゴガとしていたが、9742 のほうだった）",
  9742:"イール・ゴガ",   // #157。実機の画面と直に突き合わせて確定
  // #156(9728) は #157 と同じ組E（同じ形でまとめたときの相方）で、
  // 区切りもどちらも41。絵にすると角・尻尾・青いブーツまで同じで、
  // 色だけが違う（赤茶の体に黄色い帯）。ほかのキャラクターも全員2着ずつなので、
  // #157 が確定した以上、その相方がイール・ゴガの別衣装になる
  9728:"イール・ゴガ（別衣装）",
  9274:"マリー（別衣装）",9289:"マリー",       // マリー・イボンスカヤ
  9470:"ホム（別衣装）",   9484:"ホム",
};
// 読み方は Wikipedia の登場人物の項に合わせた。
// それまで使っていた「メアリー」「グレン」「ムフ」「イルゴガ」「オリエム」は、
// どれも私が英字表記から起こした当て字で、公式の読みではなかった。
//   マリー・イボンスカヤ / グリン カッツ / ムーフー / イール・ゴガ / オライムス
//
// 並びの意味が分かった。8755〜9484 の9組は
//   「使用可能な8人」＋ムーフー
// で、ムーフーがその中に混ざっているのは間違いではない。
// ムーフーは元々は選手の1人で、フェイの2度目の優勝を阻むために
// ウダン皇帝が急きょ呼んだ、と設定にある。選手として作られたものが
// そのまま選手の並びに残っている。
// 以前「対の中にボスが混じっていた」と書いたが、混じっていたのではなく
// 最初からそこにいるべきものだった。
//
// その9組から、画面と直に見比べて決めた6人
//   チュージ・オライムス・フェイ・グリン・マリー・ホム
// と、確定しているムーフーを除くと、残りは 8755/8770 と 9223/9237 の2組。
// 使用可能な8人のうち名前が付いていないのも エポン と イール・ゴガ の2人。
// なので、この2組がその2人だとほぼ言える——ただし
// 「どちらがどちらか」は並びからは決まらないので ？ を付けてある。
// ただし「残りは格闘キャラの誰か」という数え方は、たぶん成り立たない。
// エンディングの玉座の間に、青いローブに尖った帽子の衛兵が立っている。
// 選手でないキャラクターのモデルが混じっているなら、
// 「使用可能な8人＋ボス」で数を合わせる理屈は、その分には当てはまらない。
//
// 骨の区切り数で測ったら、はっきり割れた（v3.86.0）。
//   #54(5817) #66(5912)   区切り12・437三角形  ← 脚が分かれていない。衛兵側
//   #60 #68 #69           区切り29             ← 格闘キャラ並み
//   #156(9728) #157(9742) 区切り40             ← 格闘キャラ（30〜35）より多い。
//                                                杖や外套のような余分な部品つき
// 名前を当てる前に、まず選手かどうかを分ける。
//
// エポンは18歳の娘、イール・ゴガは竜人のような姿なので、
// 画面で見れば一目で分かるはず。そこで確かめてから ？ を外す。
//
// 色合わせは2回外している（#145 をイール・ゴガ、#126 をオライムスとしたのが誤り）ので、
// 画面と直に見比べていないものには ？ を付ける。
// 「残りは◯体だから消去法でこれ」という数え方は、一覧を32体で
// 打ち切っていたあいだは成り立っていなかった。今回それが使えるのは
// 一覧が全部出るようになり、かつ範囲が 8755〜9484 に区切られているから。
function t1NameOf(sector){ return T1_NAMES[sector]||"" }
