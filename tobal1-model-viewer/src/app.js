const VERSION="v4.56.0";
// ============================================================
//  一覧と表示
// ============================================================
const FLAT_W=new Proxy({},{get:()=>({R:I3,T:[0,0,0]})});   // 「関節を使わない」= どの枠も向き・位置なし
async function readHead(e,n){ return e.src==="iso"?await state.src.readIso(e.iso,n):await state.src.readArc(e.sector,n) }
function clearMesh(){ for(const L of layers) L.count=0; triCount=0 }
const MAX_READ=16*1024*1024;   // 表が当てにならないとき、でたらめな大きさで確保に失敗しないように
async function readFull(e){
  if(state.cache.has(e.key)) return state.cache.get(e.key);
  if(e.size>MAX_READ) throw new Error(`大きすぎます（${fmtSize(e.size)}）`);
  const d=e.src==="iso"?await state.src.readIso(e.iso):await state.src.readArc(e.sector,e.size);
  if(state.cache.size>24) state.cache.delete(state.cache.keys().next().value);
  state.cache.set(e.key,d); return d;
}
// 面1枚のバイト数を実行ファイルから読んで、読み方の絞り込みに使う。
//
// これはモデルを読みはじめる前に呼ばないと意味がない。
// v4.6.0 は報告を組み立てるときに呼んでいたので、読み終わったあとになり、
// 「通る読み方が2通り。若い番号を小さいほうにする決まりで選んだ」が
// 消えないままだった。測ったものを、測る前に使えていなかった
function applyExeSizes(exe){
  try{
    const M=mipsCmdMap(exe);
    if(!M||!M.tbl){ t1SetExeSizes(null); return 0 }
    const sz={};
    for(let op=8;op<=15;op++){
      const a=mipsTableAt(exe,M.tbl+(op-7)*4,1)[0];
      if(a){ const n=mipsFaceStep(exe,a); if(n>0) sz[op]=n }
    }
    return t1SetExeSizes(sz);
  }catch(_){ t1SetExeSizes(null); return 0 }
}
// 読み込んだファイルからモデルを組む。途中で分かったことは info に集める（解析の表示用）
function buildModel(raw){
  const info={parts:0,partSizes:[],texIndex:-1,decLen:0,ops:0,tris:0,bones:0,rig:state.rig};
  // 写しの骨が合わないモデルでは、そのモデルを組むあいだだけ骨を外す（t1BonesFit）。
  // 終わったら戻す。写しの人を選び直さなくても、合うモデルにはまた当たるように
  const keep={list:T1_BONES,real:T1_BONES_REAL}; state.t1BoneKeep=null;
  try{ return buildModelInner(raw,info) }catch(err){ err.info=info; throw err }
  finally{ if(state.t1BoneKeep) t1SetBones(keep.list,keep.real); state.t1BoneKeep=null }
}
// 写しの骨は、本体の命令5 の回数と本数が合うモデルにだけ当てる。
// 合わないのに当てると、区切りが1つずつずれた骨が掛かって形が崩れる
// （写しの 2P の骨34本が、区切り41のディスクの #157 に当たっていた）
function t1BonesFit(d,objs,info){
  if(!T1_BONES_REAL||!T1_BONES) return;
  const body=objs.filter(o=>!o.group).sort((a,b)=>(b.nv||0)-(a.nv||0))[0];
  const n=body?memCmd5Count(d,body.base):0;
  if(!n||n===T1_BONES.length) return;
  state.t1BoneKeep=true;
  info.t1BoneSkip=`  写しの骨 ${T1_BONES.length}本は当てていません（このモデルの本体の命令5 は ${n}回で、本数が合わない）`;
  t1SetBones(null,false);
}
function buildModelInner(raw,info){
  let parts=unpack(raw);
  if(!parts) parts=[raw];
  info.parts=parts.length;
  info.partSizes=parts.map(p=>p.length);
  // どの部分がモデル本体かは決まっていない。トバル2 は必ず部分0 だったが、
  // トバルNo.1 は [8, 8, 85440] のように後ろの部分に入っていることがある。
  // 展開できた部分を大きい順に試す
  const bodies=[];
  parts.forEach((p,i)=>{
    if(!p||p.length<8) return;
    let out=null;
    try{ out=p[0]===0x0b?decompress(p):p }catch(_){ return }
    if(out&&out.length>=64) bodies.push({i,out,packed:p[0]===0x0b});
  });
  if(!bodies.length) throw new Error("展開できる中身がありませんでした（部分の大きさ: "+info.partSizes.join(", ")+"）");
  // 部分1・部分3 も 0x90000000 のモデルだった（骨ではない）。中身を控えて報告に出し、
  // どれを出すかを選べるようにする
  info.otherParts=parts.map((p,i)=>{
    let out=p; try{ if(p&&p[0]===0x0b) out=decompress(p) }catch(_){}
    let model=null; try{ model=modelInfoT1(out)?out.length:0 }catch(_){}
    return {i,len:p?p.length:0,out,model};
  });
  info.modelParts=info.otherParts.filter(q=>q.model).map(q=>q.i);
  bodies.sort((a,b)=>b.out.length-a.out.length);
  // 「どのモデルを出すか」が選ばれていれば、それを先頭に持ってくる
  if(state.t1Part>=0){ const k=bodies.findIndex(b=>b.i===state.t1Part); if(k>0) bodies.unshift(bodies.splice(k,1)[0]) }

  // トバルNo.1 のモデル（0x90000000）なら、専用の読み方で組む
  for(const b of bodies.slice(0,4)){
    if(!modelInfoT1(b.out)) continue;
    const offs=t1ObjectOffsets(b.out);
    const objs=offs.map((p,i)=>{ const o=readT1Object(b.out,p); if(o) o.group=offs.group?offs.group[i]:0; return o }).filter(Boolean);
    const allObjs=objs.filter(o=>o.ok);
    // 組（差し替えの枠）は各組から1つだけ描く。全部描くと、手が片側に4つ重なる
    const okObjs=t1PickParts(allObjs,state.t1Slot,b.out);
    { const by=new Map();
      for(const o of allObjs){ if(!o.group) continue; by.set(o.group,(by.get(o.group)||0)+1) }
      info.t1SlotMax=by.size?Math.max(...by.values()):0; }
    info.t1Parts=`${allObjs.length}/${objs.length} 部品`
      +(okObjs.length<allObjs.length?`（描いているのは ${okObjs.length}個。組は差し替えなので、各組から1つずつ）`:"")
      +(objs.empty?`（ほかに 枠だけで中身の無い部品 ${objs.empty}個。手の差し替え用らしい枠が 0x420 刻みで並んでいる）`:"");
    // テクスチャを貼れるかどうかを、面のバイトの内訳から判定して出す
    { const big=okObjs.slice().sort((a,b)=>b.nv-a.nv)[0];
      const R=big&&t1Run(b.out,big.base);
      const u=t1HasUV(R);
      if(R) info.t1UV=`  テクスチャの貼り先: ${u.uv?"あり":"なし"}　面の ${u.total} バイトを頂点番号と法線で使い切っている（${u.why}）`; }
    { const by=new Map(); for(const o of objs) by.set(o.group||0,(by.get(o.group||0)||0)+1);
      info.t1Groups="  部品の組: "+[...by].map(([g,n])=>g?`組${g} ${n}個`:`本体 ${n}個`).join("　")
        +"（組の中は同じ形のポーズ違い＝手。実際に出るのは組から1つ）"; }
    if(!okObjs.length) continue;
    state.t1Objs={d:b.out,objs:okObjs};      // 骨を当てて確かめるときに使う
    t1BonesFit(b.out,okObjs,info);
    // 仮の骨組み。本物の行列が無いときに、鏡の対を左右へ開いて形を出す（推測）
    // 鎖で積んだときの効きは、印が付いていなくても測る。
    // 「印を付けて見てください」と頼むのをやめるため。
    // 測るだけで、絵は変えない（印が付いていなければ骨は当てない）
    if(!T1_BONES_REAL) try{
      t1SetBones(null);
      const m0=buildT1Mesh(b.out,okObjs);
      const big0=okObjs.filter(x=>x.run).sort((x,y)=>y.nv-x.nv)[0];
      const g0=big0?t1ChainBones(b.out,big0,t1Show.guessAmt):null;
      if(g0){
        const ext=m=>{ const P=m.mesh.pos, mn=[1e9,1e9,1e9], mx=[-1e9,-1e9,-1e9];
          for(let i=0;i<P.length;i+=3) for(let a=0;a<3;a++){
            if(P[i+a]<mn[a])mn[a]=P[i+a]; if(P[i+a]>mx[a])mx[a]=P[i+a] }
          return mn.map((v,a)=>Math.round(mx[a]-v)) };
        const before=ext(m0);
        t1SetBones(g0);
        const after=ext(buildT1Mesh(b.out,okObjs));
        const tb=Math.max(...before), ta=Math.max(...after);
        // 効きを何通りか試して並べる。どれが人の形に近いかを、
        // 絵ではなく「下端に何が来るか」で決められるようにする
        const box0=t1VertBoxMap(b.out,big0);
        const runs0=(g0.runs||[]).map(r=>{ const [a,z]=r.split("..").map(Number);
          const out=[]; for(let k=a;k<=z;k++) out.push(k); return out });
        const tries=[0.5,1,1.5,2].map(amt=>{
          const g=t1ChainBones(b.out,big0,amt);
          if(!g) return null;
          t1SetBones(g);
          const e=ext(buildT1Mesh(b.out,okObjs));
          const ends=t1ChainEnds(box0,g,runs0);
          return `効き${amt}: ${Math.max(...e)}（${tb?Math.round(Math.max(...e)/tb*100):0}%）`
            +(ends?`下端 ${ends.lo.seg}${ends.loIsLimbTip?"＝手足の先":""}`:"");
        }).filter(Boolean);
        info.t1ChainTry=`  鎖で積むとどうなるか（印に関係なく測るだけ）:`
          +`　鎖 ${g0.runs.join(" ")}　縦横 ${before.join("×")} → ${after.join("×")}`
          +`　いちばん長い辺 ${tb}→${ta}（${tb?Math.round(ta/tb*100):0}%）`
          +t1ChainEndLine(t1ChainEnds(box0,g0,runs0));
        if(tries.length) info.t1ChainTry+=`\n    効きを変えると: `+tries.join("　");
      }
      t1SetBones(null);
    }catch(err){ info.t1ChainTry="  鎖の効きが測れなかった: "+(err&&err.message||err) }
    // 鎖をたどって積む（部品の座標が親からの相対だという読みに沿った置き方）
    if(t1Show.chainBone&&!T1_BONES_REAL){
      t1SetBones(null); buildT1Mesh(b.out,okObjs);
      const big=okObjs.filter(x=>x.run).sort((x,y)=>y.nv-x.nv)[0];
      const g=big?t1ChainBones(b.out,big,t1Show.guessAmt):null;
      // 効きを数で出す。毎回「見てください」と頼むのをやめる。
      // 積む前と積んだあとの縦横を比べれば、伸びたのか散らばったのかが分かる
      let eff="";
      if(g){
        const ext=m=>{ const P=m.mesh.pos, mn=[1e9,1e9,1e9], mx=[-1e9,-1e9,-1e9];
          for(let i=0;i<P.length;i+=3) for(let a=0;a<3;a++){
            if(P[i+a]<mn[a])mn[a]=P[i+a]; if(P[i+a]>mx[a])mx[a]=P[i+a] }
          return mn.map((v,a)=>Math.round(mx[a]-v)) };
        t1SetBones(null); const before=ext(buildT1Mesh(b.out,okObjs));
        t1SetBones(g);    const after =ext(buildT1Mesh(b.out,okObjs));
        const tall=Math.max(...after), tb=Math.max(...before);
        eff=`　縦横 ${before.join("×")} → ${after.join("×")}`
          +`　いちばん長い辺 ${tb}→${tall}（${tb?Math.round(tall/tb*100):0}%）`;
      }
      t1SetBones(g);
      info.t1Guess=g?`  鎖をたどって積んでいます（推測）: 鎖 ${g.runs.join(" ")}　効き ${t1Show.guessAmt.toFixed(2)}${eff}`
                    :"  鎖が見つからないので、何もしていません";
    }
    else if(t1Show.guessBone&&!T1_BONES_REAL){
      // 先に区切りを知るため、いったん骨なしで組み立てる
      t1SetBones(null); buildT1Mesh(b.out,okObjs);
      const big=okObjs.filter(x=>x.run).sort((x,y)=>y.nv-x.nv)[0];
      const g=big?t1GuessBones(b.out,big):null;
      t1SetBones(g);
      info.t1Guess=g?`  仮の骨組み: 鏡の対 ${g.pairs.size/2}組を ±${Math.round(g.gap)} だけ左右に開いています（推測）`
                    :"  仮の骨組み: 鏡の対が見つからないので、何もしていません";
    }
    const r1=buildT1Mesh(b.out,okObjs);
    info.t1BonesUsed=T1_BONES?T1_BONES.length:0;   // 画面の説明はこれで出す（組んだあと骨は戻すので）
    { const n=okObjs.filter(o=>o.noColor).length;
      if(n) info.t1NoColor=`  色が入っていない部品 ${n}/${okObjs.length}個（色の欄が全部同じ値。対戦中にゲームが書き込むらしい）。灰色で描いています`; }
    // 色をどう引いたかを出す。手で選んだ引き方が効いているのかどうかが
    // 画面から分からず、古い選択が残ったまま「色がおかしい」ことがあった
    { let byPlan=0;
      for(const o of okObjs){ if(o.colPlan) byPlan++ }
      if(okObjs.length) info.t1ColHow=`  色の引き方: ${byPlan}/${okObjs.length} 部品で`
        +`「命令ごとの並び」（色のバイト数とぴったり合ったもの）`
        +(byPlan<okObjs.length?`　残りは ${t1Show.colMode||"自動で決める"}`:""); }
    // テクスチャの貼れる面を数える。buildT1Mesh のあとでないと o.run が無い
    { let tex=0;
      for(const o of okObjs){ if(!o.run) continue;
        for(const f of o.run.faces) if(T1_COL_TEX[f.op]) tex++ }
      if(tex) info.t1Tex=`  テクスチャの貼られる面 ${tex}枚`
        +(state.vram?`（VRAM を読み込み済み。三角 ${r1.texTris||0}枚に貼っています）`
                    :"（VRAM の写し 1,048,576バイトを読み込むと貼れます）"); }
    // どの部品が「命令の列として実行できた」かを数える。読み方を決めるのは
    // buildT1Mesh なので、必ずそのあとで数えること（前だと全部0になる）
    { let run=0, guess=0; const why=[], audit=[];
      for(const o of okObjs){ if(o.run) run++; else { if(o.walk) guess++;
        if(o.why&&why.indexOf(o.why)<0) why.push(o.why);
        if(audit.length<4){ try{ audit.push(t1AuditLine(t1Audit(b.out,o))) }catch(_){} } } }
      try{ const cf=t1ColorFit(b.out,okObjs);
        if(cf.length){
          const by=new Map();
          for(const c of cf) by.set(c.fit,(by.get(c.fit)||0)+1);
          const loose=cf.filter(c=>!c.exact&&c.near).length;
          info.t1Color="  色の引き方: "+[...by].map(([k,n])=>`${k} ${n}部品`).join("　")
            +(loose?`　（うち ${loose}部品 はぴったりではないが、いちばん近い引き方を使っています）`:"");
          // 大きい部品（＝本体）から順に出す。小さい部品ばかり出しても本丸が見えない
          info.t1ColorLines=cf.slice().sort((a,b)=>b.nv-a.nv).slice(0,4).map(t1ColorLine);
          // 命令3・6 が動かす量と、色の勘定のずれを突き合わせる。
          // 色ポインタは $gp+3444（部品を組み立てている関数で確認済み）で、
          // 命令6 が ±4（＝色ひとつ）ずつ動かしている
          try{
            const bigc=cf.slice().sort((a,b)=>b.nv-a.nv)[0];
            const o=okObjs.slice().sort((a,b)=>(b.nv||0)-(a.nv||0))[0];
            if(o) info.t1PtrMove=t1PtrMoveLine(t1PtrMoves(b.out,o.base),
              bigc?Math.abs(bigc.cand&&bigc.cand["頂点ごと"]!=null?bigc.cand["頂点ごと"]:0):null);
          }catch(_){}
        } }catch(_){}
      // まだ意味の分かっていない命令の中身。いちばん大きい部品（＝本体）で見る。
      // 骨のずらし量がここに入っていないか探している
      // 黙って握りつぶさない。失敗したらその理由をそのまま報告に出す。
      // 届かない診断は、足していないのと同じ
      try{
        const big=okObjs.slice().sort((a,b)=>(b.nv||0)-(a.nv||0))[0];
        info.t1OpArgs=big ? t1OpArgLines(t1OpArgs(b.out,big.base))
                          : ["  部品が1つも無いので見られなかった"];
      }catch(err){ info.t1OpArgs=["  読めなかった: "+(err&&err.message||err)] }
      info.t1Read={run,guess,total:okObjs.length,why,audit,
                   vari:T1_VAR_FOUND?t1VarName(T1_VAR_FOUND):""}; }
    { const P=r1.mesh.pos, mn=[1e9,1e9,1e9], mx=[-1e9,-1e9,-1e9];
      for(let i=0;i<P.length;i+=3) for(let a=0;a<3;a++){ if(P[i+a]<mn[a])mn[a]=P[i+a]; if(P[i+a]>mx[a])mx[a]=P[i+a] }
      info.t1Size=P.length
        ? `  モデル全体の縦横: X ${Math.round(mx[0]-mn[0])}　Y ${Math.round(mx[1]-mn[1])}　Z ${Math.round(mx[2]-mn[2])}`
          +`（いちばん長い軸が背の高さのはず）`
        : `  モデル全体の縦横: 頂点が1つも残りませんでした（当てている骨の表が違う見込み）`;
      // 上から下へ10段に切って、それぞれの横幅を測る。上下が合っているかを目でなく数で見るため
      const h=mx[1]-mn[1]||1, seg=Array.from({length:10},()=>[1e9,-1e9,1e9,-1e9]);
      for(let i=0;i<P.length;i+=3){ let k=Math.floor((mx[1]-P[i+1])/h*10); if(k<0)k=0; if(k>9)k=9;
        const g=seg[k]; if(P[i]<g[0])g[0]=P[i]; if(P[i]>g[1])g[1]=P[i];
        if(P[i+2]<g[2])g[2]=P[i+2]; if(P[i+2]>g[3])g[3]=P[i+2] }
      info.t1Prof="  上から下への横幅: "+seg.map(g=>g[1]<g[0]?"-":Math.round(Math.max(g[1]-g[0],g[3]-g[2]))).join(" ")
        +"（頭→肩→腰→足の順。肩のあたりがいちばん広ければ上下は合っている）"; }
    info.t1Detail=objs.slice(0,12).map(o=>`+${hex(o.base,4)}${o.ok?"○":"×"}${o.run?"命令で実行":(o.walk?"法線あり":"見た目から推測")}(頂${o.nv} 法${o.nn} 面${o.faceBytes||0}B${o.tris?" 三角"+o.tris:""}${o.box?" 範囲 "+o.box:""})`
      +(o.run?"":o.why?`\n      読めない理由: ${o.why}`:"")).join("\n    ");
    if(r1.tris>0){
      info.t1Dropped=r1.dropped;
      // 面のバイト列。区画のダンプは先頭と末尾しか出しておらず、面は真ん中にあって見えなかった
      const f=okObjs[0];
      if(f){
        const hx=(from,len)=>Array.from(b.out.subarray(from,from+len),v=>v.toString(16).padStart(2,"0")).join(" ");
        // 割り切れない部品（本体）の面の頭と尻。ずれの正体を見るため
        const odd=okObjs.find(o=>o.walk)||f;
        info.t1Faces=[
          `  面の中身（部品 +${hex(odd.base,4)}、頂点${odd.nv}、面 ${odd.faceBytes}B${odd.walk?`　四角${odd.walk.quads} 三角${odd.walk.tris} 余り${odd.walk.left}B`:""}）:`,
          `    頭 +${hex(odd.facePtr,4)}  ${hx(odd.base+odd.facePtr,48)}`,
          `    尻 +${hex(odd.colPtr-48,4)}  ${hx(odd.base+odd.colPtr-48,48)}`,
          `    色 +${hex(odd.colPtr,4)}  ${hx(odd.base+odd.colPtr,32)}`,
        ];
        // 骨（命令5）ごとの置き場所。棘の原因が「部品が原点に重なっている」かを確かめる
        const bigO=okObjs.slice().sort((a,c)=>c.nv-a.nv)[0];
        if(bigO&&bigO.run){
          const S=t1SegBoxes(b.out,bigO);
          if(S){
            // 区切りの数＝要る骨の数。メモリから表を選ぶときの手がかりになる
            info.t1Segs=Math.max(...S.map(x=>x.seg))+1;
            info.t1SegBase=bigO.base;        // 区切りの番号は、この部品のもの
            // 区切りひとつひとつの「細長さ」。腕・脚・胴の見分けは、これで付く。
            // 絵を見なくても読めるように、まとめにも出す
            info.t1SegLine=S.map(x=>{
              const w=x.box.split(" ").map(r=>{ const [a,b]=r.split(".."); return Math.round(b-a) });
              return `${x.seg}:${x.n}枚 ${w.join("×")}@${x.mid}`;
            });
            // 「みんなお腹のところに顔がある」＝全部の部品が原点に重なっている、
            // という見立てが本当かを一行で出す。中心はずっと捨てていた
            info.t1SegOrigin=t1SegOriginLine(t1SegOrigin(S,info.t1Extent));
            // 面でまとめた箱には別の骨の頂点が混ざる。
            // 「入れた区切り」でまとめ直したものも出して、並べて比べられるようにする
            try{
              const V=t1VertBoxes(b.out,bigO);
              if(V&&V.length){
                info.t1VertBox=t1VertBoxLine(V);
                // 命令6も数えた場合の箱も作って、どちらが骨らしいか比べる
                const Vb=t1VertBoxes(b.out,bigO,true);
                info.t1BoneCmp=t1BoneCountCompare(V,Vb);
                // 骨の境目で頂点が共有されているか。ここで話が決まる
                try{ info.t1Touch=t1SegTouchLine(t1SegTouch(b.out,bigO)) }catch(_){}
                // 骨の親子の表をモデルの中から探す（行列ではなく、角度＋ずれ）
                try{
                  const nb=info.t1Segs||0;
                  if(nb>=4){
                    const hits=t1FindSkelTable(b.out,nb);
                    info.t1Skel=t1SkelTableLines(b.out,nb,hits);
                    // ファイルのどこが余っているか。骨の表があるならそこにしか無い
                    info.t1Skel.push(...t1FileUseLines(b.out,t1FileUse(b.out,okObjs),nb));
                  }
                }catch(err){ info.t1Skel=["  骨の親子の表さがしで失敗: "+(err&&err.message||err)] }
                const flat=t1FlatSegs(V);
                if(flat.length) info.t1Flat=`  ぺたんこな区切り ${flat.length}個`
                  +`（厚みがほとんど無い板。点も少ない。手足の肉ではなく、`
                  +`関節の印か当たり判定のようなもの）: `+flat.join(" ");
                info.t1VertBoxLine=V.map(x=>`${x.seg}:${x.n}点 ${x.size}@${x.mid}`);
              }
            }catch(_){}
            info.t1Seg=[`  骨ごとの置き場所（部品 +${hex(bigO.base,4)}、命令5で区切る、${S.length}区切り）:`,
              `    区切りが小さくまとまっていれば、部品は別々の座標系にあり行列で運ぶ必要がある`];
            S.slice(0,24).forEach(x=>info.t1Seg.push(
              `    [${String(x.seg).padStart(2)}] ${String(x.n).padStart(3)}枚　中心 ${x.mid}　広がり ${x.span}　範囲 ${x.box}`));
          }
        }
        info.t1Lays=okObjs.slice(0,10).map(o=>`+${hex(o.base,4)}: ${o.lays||"-"}`
          +(o.walkTry&&!o.walkOK?`\n      （法線つきで読むと: ${t1WalkLine(o.walkTry)}）`:""));
        for(const o of okObjs){ const g=t1BadDump(b.out,o,o.walkTry,4); if(g&&o.walkTry.resync){ info.t1Bad=g; break } }
        // 頂点番号が途中で 0 に戻るか（本体が小部品の入れ物かどうかの決め手）
        const big=okObjs.slice().sort((a,c)=>c.nv-a.nv)[0];
        if(big&&big.walkTry&&big.walkTry.spans){
          const W=big.walkTry, B=t1SpanBases(W,big.nv);
          info.t1Spans=[`  頂点番号の区切り（部品 +${hex(big.base,4)}、頂点${big.nv}、面${W.faces.length}枚）:`,
            `    区切り ${W.spans.length}個　幅を足すと ${B.sum}　頂点の数 ${big.nv}　${B.fits?"→ 一致（番号は区切りごとに振り直し）":"→ 合わない"}`];
          W.spans.slice(0,8).forEach((sp,i)=>info.t1Spans.push(
            `    [${i}] ${sp.n}枚　番号 ${sp.lo}..${sp.hi}　足し込む位置 ${B.bases[i]}`));
        }
        if(big&&big.walkTry){
          info.t1Win=t1VertWindows(b.out,big,64);
          const c=t1CutDump(b.out,big,big.walkTry,5); if(c) info.t1Cut=c;
          const G=t1GroupFaces(big.walkTry.faces,big.nv);
          info.t1Group=G?`  区切りを計算で解くと ${G.length}個: 幅 ${G.map(x=>x.width).join(",")}`
                        :"  区切りは計算では決まらなかった（切り方がいくつも成り立つ）";
        }
        // 本体のヘッダと頂点のあいだ（小部品の目録らしき 1504 バイト）を全部出す
        if(big&&big.vertPtr>0x100){
          const dvv=new DataView(b.out.buffer,b.out.byteOffset,b.out.byteLength);
          const vals=[]; for(let q=big.base+0x38;q+4<=big.base+big.vertPtr;q+=4) vals.push(dvv.getInt32(q,true));
          info.t1Gap2=[`  ヘッダと頂点のあいだ（${vals.length}個の32bit）:`];
          for(let i=0;i<vals.length;i+=16)
            info.t1Gap2.push(`    +${hex(0x38+i*4,4)}  ${vals.slice(i,i+16).join(" ")}`);
        }
        info.t1Heads=objs.slice(0,10).map(o=>`+${hex(o.base,4)}  ${t1HeadDump(b.out,o,14)}`);
        for(const o of objs){ const g=t1GapDump(b.out,o,14); if(g){ info.t1Gap=g; break } }
      }
      const P=r1.mesh.pos, seen=new Set();
      for(let i=0;i<P.length&&seen.size<4096;i+=3) seen.add(P[i]+","+P[i+1]+","+P[i+2]);
      info.t1Distinct=seen.size;
      return finishT1(r1,info,parts,b);
    }
  }

  let best=null;
  for(const b of bodies.slice(0,4)){
    const r=tryBody(b.out);
    if(!best||r.extent>best.r.extent||(r.extent===best.r.extent&&r.tris>best.r.tris)) best={b,r};
    if(r.tris>0&&r.extent>=8) break;
  }
  const b=best.b, r=best.r;
  info.bodyPart=b.i; info.compressed=b.packed; info.decLen=b.out.length;
  info.tried=bodies.map(x=>`部分${x.i}(${x.out.length}B)`).join(" ");
  info.layout=r.layout; info.extent=Math.round(r.extent); info.tris=r.tris;
  info.ops=r.ops; info.opcodes=r.opcodes; info.bones=r.bones; if(r.fit) info.fit=r.fit;
  collectDump(r.blk,info);
  const mi=modelInfoT1(b.out);
  if(mi){
    info.modelSig=mi.kind;
    info.modelTableAt=mi.tableAt;
    info.modelOffs=mi.offs.map(o=>`+${hex(o.at,4)}→${hex(o.v)}`).join(" ");
  }
  const tex=findVram(parts); info.texIndex=tex.index; r.mesh.vram=tex.vram;
  // トバル2 の形でテクスチャが見つからないとき、No.1 の形（長さ付きの転送の列）を探す
  if(tex.index<0){
    const ch=findVramChainT1(b.out);
    if(ch&&ch.list.length){
      info.texChain=ch.list.length; info.texChainAt=ch.start;
      if(ch.info){ info.texPairs=ch.info.pairs; info.texColors=ch.info.colors }
      info.texSample=ch.list.slice(0,6).map(t=>`(${t.x},${t.y}) ${t.w}x${t.h}`).join(" ");
      r.mesh.vram=buildVramT1(b.out,ch.list);
    }
  }
  if(!info.tris) info.error=info.texChain>=2
    ? `テクスチャの集まりのようです（${info.texPairs?info.texPairs+"組 / ":""}転送 ${info.texChain}枚${info.texColors?" / "+info.texColors+"色":""}）。モデルではありません`
    : "三角形が1つも取れませんでした（モデルのファイルではないかもしれません）";
  else if(info.extent<8) info.error="組めた形が1点に潰れています（頂点や面の置き場所が合っていません）";
  return {mesh:r.mesh,info};
}
// トバルNo.1 の読み方で組めたときの仕上げ
function finishT1(r1,info,parts,b){
  info.layout="トバルNo.1 の並び（部品ごとに 面/頂点/法線/色）";
  info.tris=r1.tris; info.extent=Math.round(meshExtent(r1.mesh));
  info.bodyPart=b.i; info.compressed=b.packed; info.decLen=b.out.length;
  const mi=modelInfoT1(b.out);
  if(mi){ info.modelSig=mi.kind; info.modelTableAt=mi.tableAt;
          info.modelOffs=mi.offs.map(o=>`+${hex(o.at,4)}→${hex(o.v)}`).join(" ") }
  const blk=new Uint8Array(b.out.length+8); blk.set(b.out,8);
  new DataView(blk.buffer).setUint32(0,b.out.length+8,true);
  collectDump(blk,info);
  const tex=findVram(parts); info.texIndex=tex.index;
  // 読み込んだ VRAM の写しがあれば、それを使う。
  // ここで「ディスクの中のテクスチャ、無ければ真っ白な1MB」で上書きしていたので、
  // せっかく読み込んだ VRAM が毎回捨てられ、テクスチャが出なかった
  const loaded=r1.mesh.vram;
  if(!loaded){
    r1.mesh.vram=tex.index>=0?tex.vram:new Uint8Array(1024*512*4);
    if(tex.index<0){
      const ch=findVramChainT1(b.out);
      if(ch&&ch.list.length){ info.texChain=ch.list.length; r1.mesh.vram=buildVramT1(b.out,ch.list) }
    }
  }else info.texFrom="  テクスチャ: 読み込んだ VRAM の写しを使っています";
  return {mesh:r1.mesh,info};
}
// 展開した中身1つをモデルとして組んでみる。まずトバル2 の並び、だめなら自分で合わせる
function tryBody(out){
  const blk=new Uint8Array(out.length+8); blk.set(out,8);
  new DataView(blk.buffer).setUint32(0,out.length+8,true);
  const bones=bonesFromBlock(blk);
  const W0=state.rig==="flat"?FLAT_W:(()=>{ try{ return pose(bones) }catch(_){ return FLAT_W } })();
  const ops=walk(blk);
  const r={blk,bones:bones.filter(v=>v[0]||v[1]||v[2]).length,ops:ops.length,
           opcodes:[...ops.reduce((m,[c])=>m.set(c,(m.get(c)||0)+1),new Map()).entries()].sort((a,b)=>a[0]-b[0]),
           layout:"トバル2 と同じ並び",fit:null};
  let mesh; try{ mesh=buildMesh(blk,W0) }catch(_){ mesh={pos:new Float32Array(0),col:new Float32Array(0),t0:new Float32Array(0),t1:new Float32Array(0),sm:new Uint8Array(0)} }
  let extent=meshExtent(mesh);
  if(!mesh.pos.length||extent<8){
    let lay=null; try{ lay=fitLayout(blk) }catch(_){}
    if(lay){
      let m2=null; try{ m2=buildMesh(blk,W0,lay) }catch(_){}
      const e2=m2?meshExtent(m2):0;
      if(m2&&m2.pos.length&&e2>extent){
        mesh=m2; extent=e2; r.layout="合わせた並び: "+lay.how; r.fit=lay;
        const o2=walk(blk,lay.dl);
        r.ops=o2.length;
        r.opcodes=[...o2.reduce((m,[c])=>m.set(c,(m.get(c)||0)+1),new Map()).entries()].sort((a,b)=>a[0]-b[0]);
      }
    }
  }
  r.mesh=mesh; r.extent=extent; r.tris=mesh.pos.length/9;
  return r;
}
// 解析の表示用。ブロックの頭・区画ごとの中身・命令の生の並びを控える（失敗しても組み立ては続ける）
function collectDump(blk,info){
  const dvb=new DataView(blk.buffer,blk.byteOffset,blk.byteLength);
  try{
    const hx=(from,len)=>Array.from(blk.subarray(from,from+len),v=>v.toString(16).padStart(2,"0")).join(" ");
    const lines=(from,len,base)=>{ const r=[]; for(let o=from;o<Math.min(from+len,blk.length);o+=16) r.push(`    +${(o-base).toString(16).padStart(4,"0")}  ${hx(o,16)}`); return r };
    info.words=Array.from({length:Math.min(16,blk.length>>2)},(_,i)=>dvb.getInt32(i*4,true));
    info.dlRaw=[];
    for(let o=0x20,k=0;k<10&&o+8<=blk.length;k++,o+=8) info.dlRaw.push([dvb.getInt32(o,true),dvb.getInt32(o+4,true)]);
    info.dump=lines(8,160,8);
    const bodyLen=blk.length-8, offs=new Set();
    for(let hi=0;hi<24&&hi*4+4<=blk.length;hi++){ const w=dvb.getUint32(hi*4,true); if(w>=16&&w<bodyLen) offs.add(w) }
    const secs=[...offs].sort((a,b)=>a-b);
    info.sections=[];
    secs.slice(0,8).forEach((st,i)=>{
      const en=i+1<secs.length?secs[i+1]:bodyLen, len=en-st;
      const i16=[]; for(let k=0;k<8&&8+st+k*2+2<=blk.length;k++) i16.push(dvb.getInt16(8+st+k*2,true));
      info.sections.push(`  区画 ${hex(st)} … ${hex(en)}  ${len} バイト  (16bit: ${i16.join(", ")})`);
      info.sections.push(...lines(8+st,96,8+st));
      if(len>96) info.sections.push("    …末尾 32 バイト",...lines(8+en-32,32,8+st));
    });
    info.recs=[];
    for(let k=0;k<10;k++){ const o=8+0x24+k*24; if(o+24>blk.length) break;
      info.recs.push("    "+Array.from({length:6},(_,i)=>dvb.getInt32(o+i*4,true)).join(", ")) }
  }catch(err){ info.dumpError=err.message }
}
// ---- 一覧を組み直す ----
// 見分けたついでに先頭4バイトも覚えておく（解析の表示用）
async function rememberHead(e){
  if(state.head.has(e.key)) return;
  try{ const h=await readHead(e,4); state.head.set(e.key,[...h].map(v=>v.toString(16).padStart(2,"0")).join(" ")) }
  catch(_){ state.head.set(e.key,"読めず") }
}
function typeStats(list){
  const m=new Map();
  for(const e of list){ const t=m.get(e.type)||{type:e.type,count:0,model:0,probed:0}; t.count++; m.set(e.type,t) }
  for(const e of list){ const p=state.probe.get(e.key); if(!p) continue; const t=m.get(e.type); t.probed++; if(p.kind==="model") t.model++ }
  return [...m.values()].sort((a,b)=>a.type-b.type);
}
const typeIsModel=t=>{ const s=state.stats&&state.stats.find(x=>x.type===t); return !!(s&&s.probed&&s.model/s.probed>=0.5) };
const entryIsModel=e=>{
  if(e.kind) return e.kind==="model";   // さらった結果: 入れ子で部分0が圧縮のものだけ
  const p=state.probe.get(e.key); return p?p.kind==="model":typeIsModel(e.type);
};
function rebuildEntries(){
  if(state.source==="scan"){
    state.entries=(state.scan||[]).map((h,i)=>({...h,key:"scan"+i,src:"arc",no:i,type:0,
      label:{model:"モデルらしい",pack:"入れ子",lz:"圧縮"}[h.kind]+(h.parts?`（${h.parts}部分）`:h.unpacked?`（展開後 ${fmtSize(h.unpacked)}）`:"")}));
    state.stats=typeStats(state.entries);
    return;
  }
  if(state.source==="iso"){
    state.entries=(state.src.iso||[]).map((f,i)=>({key:"iso"+i,src:"iso",iso:f,no:i,name:f.path,size:f.size,type:0}));
  } else {
    const t=state.tables[state.tableIdx];
    state.entries=t?readTable(state.src.exe,t).filter(e=>e.size>0).map(e=>({...e,key:"arc"+e.no,src:"arc",name:"#"+e.no})):[];
  }
  state.stats=typeStats(state.entries);
}
function fillTypeFilter(){
  const sel=$("type-filter"), keep=sel.value;
  const opts=['<option value="">すべての種類</option>'];
  for(const s of state.stats) opts.push(`<option value="${s.type}">種類 ${s.type}　${s.count}件${s.probed?"　"+(s.model/s.probed>=0.5?"モデルらしい":"モデルではなさそう"):""}</option>`);
  sel.innerHTML=opts.join("");
  sel.value=[...sel.options].some(o=>o.value===keep)?keep:"";
  sel.parentElement.hidden=state.stats.length<2;
}
function visibleEntries(){
  const ft=$("type-filter").value, only=$("model-only").checked;
  return state.entries.filter(e=>(ft===""||String(e.type)===ft)&&(!only||entryIsModel(e)));
}
function renderFiles(){
  const box=$("files"); box.textContent="";
  const list=visibleEntries(), shown=list.slice(0,600);
  for(const e of shown){
    const b=document.createElement("button");
    b.dataset.key=e.key; b.setAttribute("aria-pressed",String(e.key===(state.entries[state.sel]||{}).key));
    const p=state.probe.get(e.key);
    const no=document.createElement("span"); no.className="no"; no.textContent=e.src==="iso"?"":"#"+e.no;
    const nm=document.createElement("span"); nm.className="nm";
    nm.textContent=e.src==="iso"?e.name:(e.label||`種類 ${e.type}${p?"　"+KIND_LABEL[p.kind]:""}`);
    const sz=document.createElement("span"); sz.className="sz"; sz.textContent=fmtSize(e.size);
    b.append(no,nm,sz);
    b.onclick=()=>{ selectEntry(state.entries.indexOf(e)); if(mobileMQ.matches) closeSheet() };
    box.append(b);
  }
  $("file-count").textContent=`${list.length} 件${list.length>shown.length?`（先頭 ${shown.length} 件を表示）`:""}`;
}
// ---- 表示 ----
async function selectEntry(i){
  const e=state.entries[i]; if(!e) return;
  state.sel=i; state.ramSel=-1; state.selInfo=null; state.selErr="";
  if(typeof t1SetVram==="function") t1SetVram(state.vram);   // 写しの VRAM はディスクのモデルにも使う
  for(const b of $("files").children) if(b.dataset) b.setAttribute("aria-pressed",String(b.dataset.key===e.key));
  busy("読み込み中…");
  try{
    const raw=await readFull(e);
    const {mesh,info}=buildModel(raw);
    state.selInfo=info;
    layers[1].count=0;                       // 写しのもう1人は、ディスクのモデルでは出さない
    if(info.error){ state.selErr=info.error; clearMesh() } else upload(mesh);
    draw();
  }catch(err){
    state.selErr=err.message; state.selInfo=err.info||null; console.error(err);
    clearMesh(); draw();
  }
  busy(""); updateStatus(); updateReport(); updateHud();
  fillT1Part(state.selInfo); fillT1Slot(state.selInfo);
}
// モデル候補を順に開いて、最初に三角形が出たものを表示する
async function selectFirstModel(limit=16){
  // モデルの署名（0x90000000）が分かっているものを先に、次に大きいものを試す。
  // テクスチャの集まりだと分かったものは飛ばす
  let list=state.entries.filter(entryIsModel).sort((a,b)=>b.size-a.size);
  if(state.sieve&&state.sieve.other.length){
    const sig=state.sieve.other.filter(o=>o.words&&o.words[0]===0x90000000)
      .sort((a,b)=>(a.words[1]===0x14?1:0)-(b.words[1]===0x14?1:0)||b.dec-a.dec)
      .map(o=>o.e);
    const rest=list.filter(e=>!sig.includes(e));
    list=sig.concat(rest);
  }
  list=list.slice(0,limit);
  let firstShown=-1;
  for(const [k,e] of list.entries()){
    busy(`モデルを探しています… ${k+1}/${list.length}`);
    await selectEntry(state.entries.indexOf(e));
    if(firstShown<0) firstShown=state.sel;
    if(state.selInfo&&state.selInfo.tris>0){ busy(""); return true }
  }
  busy("");
  if(firstShown>=0) await selectEntry(firstShown);   // 見つからなければ 1件目を見せる
  return false;
}
function entryLabel(e){
  if(!e) return "";
  if(e.src==="iso") return e.name;
  const nm=t1NameOf(e.sector);          // 名前が分かっているものは先に出す
  const base=e.label?`#${e.no}　sector ${e.sector}　${e.label}`:`#${e.no}　種類 ${e.type}`;
  return nm?`${nm}　${base}`:base;
}
function updateStatus(){
  const e=state.entries[state.sel];
  // 写しの中の人を出しているときは、ディスクの一覧に相手がいない
  if(!e&&state.ramSel>=0&&state.ramChars&&state.ramChars[state.ramSel]){
    const c=state.ramChars[state.ramSel], inf=state.selInfo;
    $("status").textContent=state.selErr?`${c.label||"写しの "+c.who}　— ${state.selErr}`
      :`${c.label||"写しの "+c.who}　${hex(c.model.at)}　${fmtSize(c.model.len)}　三角形 ${inf?inf.tris.toLocaleString():0}`
       +(inf&&inf.extent?`　広がり ${inf.extent}`:"")+`　骨 ${c.bones.list.length}本`
       +(inf&&inf.t1Parts?`　${inf.t1Parts}`:"");
    return;
  }
  if(!e){ $("status").textContent="左の一覧からファイルを選んでください"; return }
  const inf=state.selInfo;
  $("status").textContent=state.selErr?`${entryLabel(e)}　— ${state.selErr}`
    :`${entryLabel(e)}　${fmtSize(e.size)}　三角形 ${inf?inf.tris.toLocaleString():0}`
     +(inf&&inf.extent?`　広がり ${inf.extent}`:"")+(inf&&inf.t1Parts?`　${inf.t1Parts}`:"");
}
function fileBase(){
  const e=state.entries[state.sel];
  return ("tobal1_"+(e?(e.src==="iso"?e.name.replace(/\W+/g,"_"):`f${e.no}_t${e.type}`):"model")).replace(/[\\/:*?"<>|\s]/g,"_");
}
// ---- 解析の表示 ----
// 報告は既定で「短く」。実行ファイルの逆アセンブルや生のバイト列は、
// 毎回同じ内容なのに何百行にもなる。読む側の手間と、貼るときの量を減らすため、
// 要るときだけ出す（覚えておく）
function repLong(){ const c=$("rep-long"); return !!(c&&c.checked) }
// 調べた結果を画面に重ねて出す。
// 報告を貼ってもらわなくても、スクショ1枚で今どう読めているかが分かるように
function updateHud(){
  const box=$("hud"), on=$("hudon");
  if(!box) return;
  if(on&&!on.checked){ box.hidden=true; return }
  const inf=state.selInfo, e=state.entries[state.sel];
  if(!inf||!e){ box.hidden=true; return }
  const L=[];
  const nm=t1NameOf(e.sector);
  L.push((nm?`${nm}　`:"")+`#${e.no} sector ${e.sector}　三角形 ${inf.tris||0}`);
  if(inf.t1Read) L.push(`部品 ${inf.t1Read.run}/${inf.t1Read.total} 命令の列として実行`
    +(inf.t1Segs?`　骨の区切り ${inf.t1Segs}`:"")
    +(inf.t1BonesUsed?`　骨 ${inf.t1BonesUsed} を当てている`:""));
  if(inf.t1BoneSkip) L.push(inf.t1BoneSkip.trim());
  if(inf.t1Hand) L.push(inf.t1Hand.trim());
  if(inf.t1NoColor) L.push(inf.t1NoColor.trim());
  if(inf.t1Color) L.push(inf.t1Color.trim());
  for(const x of (inf.t1ColorLines||[]).slice(0,2)) L.push(x);
  box.textContent=L.join("\n");
  box.hidden=false;
}
// 作者に送るぶんだけを集めた、短いまとめ。
// 毎回同じ内容（実行ファイルの逆アセンブル、ファイルの一覧、生のバイト列）は入れない。
// 入れるのは「前回と変わりうるもの」＝読めた数・読めない理由・数え上げ・覚えたことだけ
function digestLines(){
  const L=[], s=state.src;
  L.push(`トバルNo.1 モデルビューア ${VERSION} ・ まとめ`);
  if(s) L.push(`読み込み元: ${s.kind} / ${s.discName}`);
  if(state.sieve){
    // 骨さがしの結果も必ず入れる。作っていたのに、ふるいが落としていた（四度目）
    const keep=sieveLines(state.sieve).filter(x=>
      /キャラクターのモデル|割り出した|覚えた|当たった読み方|組で割り出した|件: |例: |数え上げ|部品\d+個中|^ {6}#|骨さがし|行列\d+個|回転 |見つかりませんでした/.test(x));
    if(keep.length){ L.push(""); L.push(...keep.map(x=>x.replace(/^ {2}/,""))) }
    const t=sieveLines(state.sieve).find(x=>/全 \d+件 →/.test(x));
    if(t) L.push("", t.trim());
  }
  const inf=state.selInfo, e=state.entries[state.sel];
  if(inf&&e){
    L.push("");
    L.push(`選んでいるファイル: #${e.no} sector ${e.sector}`);
    for(const k of ["ramChar","t1Hand","t1ColHow","t1Tex","texFrom","t1Parts","t1RealBone","t1Size","t1Read","t1Color"]) if(inf[k]&&typeof inf[k]==="string") L.push(inf[k]);
    for(const x of inf.t1ColorLines||[]) L.push("    "+x);
    if(inf.t1OpArgs&&inf.t1OpArgs.length){
      L.push("  まだ意味の分かっていない命令の中身（骨のずらし量を探している）:");
      L.push(...inf.t1OpArgs);
    }
    if(inf.t1Read&&inf.t1Read.run!=null)
      L.push(`  部品の読み方: 命令の列として実行 ${inf.t1Read.run}個／当てずっぽう ${inf.t1Read.guess}個`
        +(inf.t1Read.vari&&inf.t1Read.vari!=="既定"?`／頂点を入れる読み方: ${inf.t1Read.vari}`:""));
    if(inf.t1Segs) L.push(`  骨の区切り: ${inf.t1Segs}個`+(inf.t1BonesUsed?`／骨 ${inf.t1BonesUsed}個 を当てている`:"／骨はまだ無い"));
    if(inf.t1BoneSkip) L.push(inf.t1BoneSkip);
    if(inf.t1SegLine&&inf.t1SegLine.length){
      if(inf.t1Guess) L.push(inf.t1Guess);
      if(inf.t1ChainTry) L.push(inf.t1ChainTry);
      if(inf.t1SegOrigin) L.push(inf.t1SegOrigin);
      if(inf.t1PtrMove) L.push(inf.t1PtrMove);
      if(inf.t1Touch) L.push(inf.t1Touch);
      if(inf.t1Skel) L.push(...inf.t1Skel);
      // モデルの前後のファイル。モーションが隣に置かれている、という見立ての検証。
      // ふるいの分類（テクスチャ／それ以外）も添える
      { const idx=state.entries.indexOf(e);
        if(idx>=0){
          const kind=x=>{
            const sv=state.sieve;
            if(!sv) return "";
            if((sv.tex||[]).some(t=>t.e===x)) return "テクスチャ";
            const o=(sv.other||[]).find(t=>t.e===x);
            if(!o) return "読めない";
            return (o.words&&o.words[0]===0x90000000)?"モデル":"それ以外";
          };
          const near=[];
          for(let k=-3;k<=3;k++){
            const x=state.entries[idx+k];
            if(!x) continue;
            near.push(`${k===0?"→":"  "}#${x.no}(${x.sector}) ${fmtSize(x.size)} ${kind(x)}`);
          }
          if(near.length){ L.push("  このモデルの前後のファイル:"); L.push("    "+near.join("　")) }
        } }
      if(inf.t1BoneCmp) L.push(inf.t1BoneCmp);
      if(inf.t1Flat) L.push(inf.t1Flat);
      if(inf.t1VertBox){
        L.push(inf.t1VertBox);
        const W=inf.t1VertBoxLine||[];
        for(let i=0;i<W.length;i+=4) L.push("    "+W.slice(i,i+4).join("　"));
      }
      L.push("  区切りごとの大きさ（番号:面数 幅×高×奥@中心）:");
      for(let i=0;i<inf.t1SegLine.length;i+=4) L.push("    "+inf.t1SegLine.slice(i,i+4).join("　"));
    }
    for(const w of (inf.t1Read&&inf.t1Read.why)||[]) L.push(`    読めない理由: ${w}`);
    for(const a of (inf.t1Read&&inf.t1Read.audit)||[]) L.push(`    読めなかった部品: ${a}`);
  }
  if(state.mem&&state.mem.length) L.push("",...state.mem.slice(0,10));
  // まだ名前の付いていないキャラクターのモデル。残りを数えるため
  { const sig=((state.sieve&&state.sieve.other)||[])
      .filter(o=>o.words&&o.words[0]===0x90000000&&o.words[1]!==0x14&&!t1NameOf(o.e.sector));
    if(sig.length){ L.push("");
      // 骨の区切り数を添える。格闘キャラは30前後。
      // ローブ姿の衛兵のような、脚の分かれていないキャラクターはずっと少ないはず
      L.push(`名前の付いていないモデル ${sig.length}件（かっこ内は sector・骨の区切り数）:`);
      L.push("  "+sig.map(o=>`#${o.e.no}(${o.e.sector}・区切り${(o.diag&&o.diag.segs)||"?"})`).join(" "));
      // 大きさの順。ウダン皇帝は身長152cmで小柄という設定があるので、
      // いちばん小さいものが候補になる。絵を見ないで絞るための手がかり
      { const all=((state.sieve&&state.sieve.other)||[])
          .filter(o=>o.diag&&o.diag.ext>0)
          .map(o=>({no:o.e.no,sec:o.e.sector,ext:o.diag.ext,nm:t1NameOf(o.e.sector)}))
          .sort((a,b)=>a.ext-b.ext);
        if(all.length>=6){
          const f=x=>`${x.nm?x.nm+" ":""}#${x.no}(${x.ext})`;
          L.push(`  大きさの順（かっこ内はいちばん長い辺）　小さいほう: `
            +all.slice(0,4).map(f).join(" "));
          L.push(`  　大きいほう: `+all.slice(-4).reverse().map(f).join(" "));
        } }
      const few=sig.filter(o=>o.diag&&o.diag.segs&&o.diag.segs<20);
      if(few.length) L.push(`  区切りが20より少ないもの ${few.length}件`
        +`（格闘キャラは30前後。ローブ姿など脚の分かれていないキャラクターかもしれない）: `
        +few.map(o=>`#${o.e.no}(区切り${o.diag.segs})`).join(" "));
    } }
  if(state.galGroups&&state.galGroups.length){
    L.push(""); L.push("同じ形でまとめた結果:"); L.push(...state.galGroups);
  }
  if(state.galWhy&&state.galWhy.length){
    L.push(""); L.push("一覧で読めなかったモデル:"); L.push(...state.galWhy.slice(0,8));
  }
  return L;
}
try{ addEventListener("DOMContentLoaded",()=>{ const c=$("rep-long"); if(!c) return;
  try{ c.checked=localStorage.getItem("replong")==="1" }catch(_){}
  c.addEventListener("change",()=>{ try{ localStorage.setItem("replong",c.checked?"1":"0") }catch(_){}
    updateReport() }) }) }catch(_){}
function updateReport(){
  const s=state.src; if(!s) return;
  const L=[], ex=exeInfo(s.exe);
  L.push(`トバルNo.1 モデルビューア ${VERSION} ・ 解析結果`);
  L.push("");
  L.push(`読み込み元: ${s.kind} / ${s.discName}`);
  L.push(`実行ファイル: ${s.exeName}  ${ex.ok?`(PS-X EXE  text=${hex(ex.text)}  size=${hex(ex.size)}  pc=${hex(ex.pc)})`:"(PS-X EXE ではありません)"}`);
  L.push(`アーカイブ: ${s.arcName}  ${fmtSize(s.arcSize)}`);
  L.push("");
  const kn=knownDisc(s.exeName);
  if(kn){
    L.push("");
    L.push(`【解析済みのディスク】${kn.title}`);
    L.push(`  ${kn.note}`);
    L.push(`  正解のファイル表: ${hex(kn.addr)}  ${kn.count}件  ← 探索がこれを当てられれば、探し方は正しい`);
    L.push("");
  }
  L.push(`ファイル表の候補 (${state.tables.length}件):`);
  if(!state.tables.length) L.push("  見つかりませんでした");
  state.tables.forEach((t,i)=>L.push(`  ${i===state.tableIdx?"→":" "} [${i+1}] ${tableLabel(t,ex).replace(/　/g,"  ")}`));
  L.push("");
  L.push(`一覧: ${state.source==="iso"?"ディスクのファイル":"アーカイブのファイル表"}  ${state.entries.length}件`);
  const st=state.stats||[];
  if(state.source!=="iso"&&st.length){
    L.push("種類ごと（件数 / 調べた数 / モデルらしい数）:");
    for(const t of st) L.push(`  種類 ${String(t.type).padStart(3)} : ${String(t.count).padStart(5)} / ${String(t.probed).padStart(4)} / ${String(t.model).padStart(4)}`);
  }
  if(state.scan){
    L.push("");
    const by=state.scan.reduce((m,h)=>m.set(h.kind,(m.get(h.kind)||0)+1),new Map());
    L.push(`アーカイブを直接さらった結果: ${state.scan.length}件  (${[...by].map(([k,v])=>KIND_LABEL[k]+" "+v).join(" / ")})`);
    L.push("  先頭10件の sector: "+state.scan.slice(0,10).map(h=>h.sector).join(", "));
    if(state.infer){
      L.push(`  逆算したファイル表: ${hex((exeInfo(s.exe).text||0)+(state.infer.base-0x800))}  1件 ${state.infer.stride} バイト  大きさの位置 +${state.infer.sizeAt<0?"?":state.infer.sizeAt}  (一致 ${state.infer.votes})`);
      L.push("  ※ 1件の長さは「さらって見つかったファイルどうしの間隔」。拾えないファイルが間に挟まると、その倍数になる");
    }
    else L.push("  実行ファイルの中に、さらったセクタ番号の並びは見つからなかった");
  }
  if(state.source==="table"&&state.entries.length){
    L.push("");
    L.push("表の先頭 8件 (番号 : sector / 大きさ / 種類 / 先頭4バイト):");
    for(const en of state.entries.slice(0,8))
      L.push(`  #${String(en.no).padStart(4)} : ${String(en.sector).padStart(7)} / ${String(en.size).padStart(8)} / ${String(en.type).padStart(3)} / ${state.head.get(en.key)||"?"}`);
  }
  if(s.iso&&s.iso.length){
    L.push("");
    L.push("大きいファイル 5件（アーカイブの選び方の確認用）:");
    for(const f of [...s.iso].sort((x,y)=>y.size-x.size).slice(0,5)) L.push(`  ${f.path||f.name}  ${fmtSize(f.size)}`);
  }
  if(state.galWhy&&state.galWhy.length)
    L.push("","一覧で読めなかったモデルと、その理由:",...state.galWhy,"");
  if(state.mem) L.push("", ...state.mem, "");
  if(state.sieve){
    L.push("");
    L.push("候補を全部ふるいにかけた結果:");
    L.push(...sieveLines(state.sieve));
  }
  const e=state.entries[state.sel], inf=state.selInfo;
  L.push("");
  L.push("選んでいるファイル: "+(e?`${entryLabel(e)}${e.label||e.src==="iso"?"":`  sector ${e.sector}`}  ${fmtSize(e.size)}`:"なし"));
  if(state.selErr) L.push("  → 表示できず: "+state.selErr);
  if(inf){
    L.push(`  部分 ${inf.parts}  [${inf.partSizes.join(", ")}]`);
    if(inf.otherParts) for(const q of inf.otherParts){
      if(q.i===inf.bodyPart||!q.out||!q.out.length) continue;
      const hx=(f,n)=>Array.from(q.out.subarray(f,f+n),v=>v.toString(16).padStart(2,"0")).join(" ");
      const dvq=new DataView(q.out.buffer,q.out.byteOffset,q.out.byteLength);
      const i16=n=>{ const a=[]; for(let k=0;k<n&&k*2+2<=q.out.length;k++) a.push(dvq.getInt16(k*2,true)); return a.join(" ") };
      const i32=n=>{ const a=[]; for(let k=0;k<n&&k*4+4<=q.out.length;k++) a.push(dvq.getInt32(k*4,true)); return a.join(" ") };
      L.push(`  部分${q.i}（${q.len} B${q.out.length!==q.len?` → 展開後 ${q.out.length} B`:""}）`
        +(q.model?"これも 0x90000000 のモデル（部品が少ない＝簡易版らしい）:":"モデルではない:"));
      L.push("    "+hx(0,32));
      L.push("    "+hx(32,32));
      L.push("    16bit: "+i16(16));
      L.push("    32bit: "+i32(8));
    }
    L.push(`  モデル本体: 部分${inf.bodyPart===undefined?"?":inf.bodyPart}  ${inf.compressed?"圧縮あり":"圧縮なし"}  展開後 ${inf.decLen} B　（試した: ${inf.tried||"-"}）`);
    L.push(`  テクスチャの部分: ${inf.texIndex<0?"見つからず":inf.texIndex}`
      +(inf.texChain?`　No.1 形式の転送の列: ${inf.texChain}枚 (+${hex(inf.texChainAt,4)})  ${inf.texSample}`:""));
    L.push(`  描画命令 ${inf.ops}  三角形 ${inf.tris}  骨 ${inf.bones}  骨格 ${inf.rig}`);
    if(inf.opcodes&&inf.opcodes.length) L.push("  命令の内訳: "+inf.opcodes.map(([c,n])=>`${c}×${n}`).join(" "));
    if(inf.t1Parts) L.push(`  トバルNo.1 の部品: ${inf.t1Parts}`+(inf.t1Dropped?`　範囲外で落とした面 ${inf.t1Dropped}`:"")
      +(inf.t1Distinct?`　別々の位置 ${inf.t1Distinct}点`:""));
    if(inf.t1Detail) L.push("  部品の内訳: "+inf.t1Detail);
    if(inf.t1Lays){ L.push("  面の読み方（選ばれたもの）:"); inf.t1Lays.forEach(x=>L.push("    "+x)) }
    if(inf.t1Size) L.push(inf.t1Size);
    if(inf.t1Prof) L.push(inf.t1Prof);
    if(inf.t1Groups) L.push(inf.t1Groups);
    if(inf.t1UV) L.push(inf.t1UV);
    if(inf.t1Read) L.push(`  部品の読み方: 命令の列として実行 ${inf.t1Read.run}個`
      +(inf.t1Read.guess?`／当てずっぽう ${inf.t1Read.guess}個（ここが多いと形が崩れる）`:"（全部きちんと読めています）"));
    if(inf.t1NoColor) L.push(inf.t1NoColor);
    if(inf.t1Color) L.push(inf.t1Color);
    if(inf.t1ColorLines) inf.t1ColorLines.forEach(x=>L.push("    "+x));
    if(inf.t1OpArgs){
      L.push("  まだ意味の分かっていない命令の中身:");
      inf.t1OpArgs.forEach(x=>L.push(x));
    }
    if(inf.t1Guess) L.push(inf.t1Guess);
    if(inf.t1Segs) L.push(`  骨の区切り: ${inf.t1Segs}個`
      +(inf.t1BonesUsed?`　メモリから取った骨 ${inf.t1BonesUsed}個 を当てています`
               :`　骨の行列がまだ無いので、手足は胴に畳み込まれたまま出ます`));
    if(inf.t1Read&&inf.t1Read.vari&&inf.t1Read.vari!=="既定")
      L.push(`    頂点を入れる命令の読み方: ${inf.t1Read.vari}`);
    if(inf.t1Read&&inf.t1Read.why&&inf.t1Read.why.length)
      inf.t1Read.why.forEach(w=>L.push(`    読めない理由: ${w}`));
    if(inf.t1Read&&inf.t1Read.audit&&inf.t1Read.audit.length)
      inf.t1Read.audit.forEach(a=>L.push(`    読めなかった部品: ${a}`));
    if(inf.modelSig) L.push(`  モデルの署名 0x90000000  種類${inf.modelSig}　位置の表 +${hex(inf.modelTableAt,4)}`);
    if(inf.layout) L.push(`  並び: ${inf.layout}　広がり ${inf.extent}`);
    if(inf.dumpError) L.push("  ダンプ作りで失敗: "+inf.dumpError);
    // ここから下は生のバイト列。毎回同じで長いので、ふだんは出さない
    if(repLong()){
      if(inf.t1Seg) L.push(...inf.t1Seg);
      if(inf.t1Heads){ L.push("  部品ヘッダの生の数字:"); inf.t1Heads.forEach(x=>L.push("    "+x)) }
      if(inf.modelOffs) L.push("  ヘッダにある位置: "+inf.modelOffs);
      if(inf.words) L.push("  ブロックの頭 (32bit×16): "+inf.words.map(v=>hex(v)).join(" "));
      if(inf.dlRaw) L.push("  0x20 からの生の並び: "+inf.dlRaw.map(([a,b])=>`(${a}, ${b})`).join(" "));
      if(inf.dump&&inf.dump.length){ L.push("  展開した中身の頭:"); L.push(...inf.dump) }
      if(inf.recs&&inf.recs.length){ L.push("  +0024 からの 24バイトごと:"); L.push(...inf.recs) }
      if(inf.sections&&inf.sections.length){ L.push("  区画ごとの中身:"); L.push(...inf.sections) }
    }
  }
  if(repLong()&&s.iso&&s.iso.length){
    L.push("");
    L.push(`ディスクのファイル (${s.iso.length}件):`);
    for(const f of s.iso.slice(0,80)) L.push(`  ${f.path||f.name}  ${fmtSize(f.size)}`);
    if(s.iso.length>80) L.push(`  …ほか ${s.iso.length-80} 件`);
  }
  if(bgm.tracks.length) L.push("", `XA: ${bgm.tracks.length} チャンネル`);
  state.report=L.join("\n");   // まとめを作るときに、ここから拾う
  $("report").value=state.report;
}
// 候補の裏取り: その表が指す先を実際に何件か読んで、トバルのファイルらしいかを見る。
// 本物の表なら中身が入れ子か圧縮になっているはずで、まぐれで並んだだけの表はここで落ちる。
const GOOD_KIND={model:1,pack:1,lz:1,tim:1};
async function scoreOne(t){
  const rows=readTable(state.src.exe,t).filter(e=>e.size>0);
  const step=Math.max(1,Math.floor(rows.length/8));
  let hit=0, n=0;
  for(let i=0;i<rows.length&&n<8;i+=step){
    const e=rows[i];
    try{ if(GOOD_KIND[classify(await state.src.readArc(e.sector,Math.min(e.size,2048)),e.size).kind]) hit++ }catch(_){}
    n++;
  }
  return n?hit/n:0;
}
// どのファイルがアーカイブかも当てずっぽうなので、当たりが出るまで候補を順に試す。
// 全部だめだった場合も、最後に試したものではなく、いちばんマシだったものを残す
async function scoreTables(tables){
  const arcs=state.src.arcs||[];
  let best=null;
  for(let a=0;a<Math.max(1,arcs.length);a++){
    if(arcs.length){ state.src.setArc(a); busy(`ファイル表の候補を確かめています… ${state.src.arcName}`) }
    const hits=[]; let top=0;
    for(const t of tables){ const h=await scoreOne(t); hits.push(h); top=Math.max(top,h*t.count) }
    if(!best||top>best.top) best={arc:a,hits,top};
    if(top>0) break;
  }
  if(best){ tables.forEach((t,i)=>{ t.hits=best.hits[i]; t.arc=best.arc }); if(arcs.length) state.src.setArc(best.arc) }
  // 「中身の割合」だけで並べると、アーカイブに素のデータが混ざっているとき（割合が下がる）、
  // 短い誤検出に負ける。確かめられた実ファイルの「本数」＝ 割合×件数 で並べる
  const score=t=>(t.hits||0)*t.count;
  tables.sort((a,b)=>(score(b)-score(a))||(b.hits-a.hits)||(b.strict-a.strict)||(b.count-a.count));
  if(arcs.length&&tables.length) state.src.setArc(tables[0].arc||0);
}
function tableAddr(t,ex){ return ex.ok?ex.text+(t.off-0x800):t.off }
function tableLabel(t,ex){
  const kn=state.src&&knownDisc(state.src.exeName);
  const mark=kn&&tableAddr(t,ex)===kn.addr?(t.count===kn.count?" ✓正解":" ✓位置は正解"):"";
  return `${ex.ok?hex(tableAddr(t,ex)):"file+"+hex(t.off)}　${t.count}件　中身 ${Math.round(100*(t.hits||0))}%　詰まり ${(100*t.strict/Math.max(1,t.count-1)).toFixed(0)}%　${t.name}${mark}`;
}
// ---- 調べる ----
async function probeSamples(){
  for(const en of state.entries.slice(0,8)) await rememberHead(en);   // 解析に出す先頭8件
  const byType=new Map();
  for(const e of state.entries){ const a=byType.get(e.type)||[]; if(a.length<6) a.push(e); byType.set(e.type,a) }
  let n=0, total=[...byType.values()].reduce((t,a)=>t+a.length,0);
  for(const arr of byType.values()) for(const e of arr){ await probeEntry(e); if(++n%8===0){ busy(`ファイルの種類を調べています… ${n}/${total}`); await idle() } }
  state.stats=typeStats(state.entries);
}
let scanning=false;
async function scanAll(){
  if(scanning){ scanning=false; return }
  scanning=true; $("scan-all").textContent="やめる";
  const list=state.entries;
  for(let i=0;i<list.length&&scanning;i++){
    await probeEntry(list[i]);
    if(i%16===0){ busy(`調べています… ${i}/${list.length}`); await idle() }
  }
  scanning=false; $("scan-all").textContent="全部のファイルを調べる";
  busy(""); state.stats=typeStats(state.entries); fillTypeFilter(); renderFiles(); updateReport();
}
// ---- 読み込み ----
async function start(files){
  $("err").textContent="";
  try{
    busy("ディスクを読んでいます…");
    state.src=await openSource(files);
    state.cache.clear(); state.probe.clear(); state.head.clear(); state.scan=null; state.infer=null;
    const ex=exeInfo(state.src.exe);
    // モデルを読む前に、面1枚のバイト数を実行ファイルから取り込んでおく。
    // 読んだあとで取り込んでも、読み方の絞り込みには使えない
    state.exeSizes=applyExeSizes(state.src.exe);
    state.tables=state.src.readArc&&ex.ok?findFileTables(state.src.exe,state.src.maxArcSize||state.src.arcSize):[];
    if(state.tables.length){ busy("ファイル表の候補を確かめています…"); await scoreTables(state.tables) }
    state.tableIdx=0;
    state.source=state.tables.length?"table":"iso";
    showMainUI();
    const known=knownDisc(state.src.exeName);
    $("known-note").textContent=known?`${known.title} のディスクです。${known.note}`:"";
    $("known-note").hidden=!known;
    $("src-note").textContent=state.tables.length
      ? `実行ファイルの中にファイル表らしい並びが ${state.tables.length} 個ありました。いちばんそれらしいものを選んでいます。`
      : "ファイル表が見つからなかったので、ディスクのファイルをそのまま並べています。";
    for(const b of $("src-seg").children) b.setAttribute("aria-pressed",String(b.dataset.v===state.source));
    $("arc-pick").innerHTML=(state.src.arcs||[]).map((a,i)=>`<option value="${i}">${a.name}　${fmtSize(a.size)}</option>`).join("");
    $("arc-pick").value=String(state.src.arcIdx||0);
    $("arc-pick").parentElement.hidden=(state.src.arcs||[]).length<2;
    $("table-pick").innerHTML=state.tables.map((t,i)=>`<option value="${i}">[${i+1}] ${tableLabel(t,ex)}</option>`).join("")||'<option value="-1">候補なし</option>';
    rebuildEntries();
    busy("ファイルの種類を調べています…");
    await probeSamples();
    fillTypeFilter(); renderFiles();
    busy("BGM を探しています…");
    try{ bgm.tracks=state.src.readRaw?await bgmScan(state.src):[] }catch(err){ bgm.tracks=[]; console.warn("BGM を探せませんでした",err) }
    $("bgm-box").hidden=!bgm.tracks.length;
    $("bgm").innerHTML='<option value="-1">なし</option>'+bgm.tracks.map((t,i)=>`<option value="${i}">${t.label}</option>`).join("");
    busy("");
    // 表の形が合わずモデルが出ないときは、アーカイブを直接さらう方に切り替える
    if(!state.entries.some(entryIsModel)&&state.src.readArc){
      state.source="scan";
      for(const b of $("src-seg").children) b.setAttribute("aria-pressed",String(b.dataset.v==="scan"));
      await runScan();
      rebuildEntries();
      busy("調べています…"); await probeSamples(); busy("");
      fillTypeFilter(); renderFiles();
    }
    // ふるいは「いま表示している一覧」にかける。表の当てにならない一覧にかけると
    // でたらめな大きさで確保に失敗するので、さらった結果に切り替えたあとで行う
    if(state.src.readArc){
      try{ state.sieve=await sieveAll(p=>busy(`候補を全部ふるいにかけています… ${Math.round(p*100)}%`)); fillTexPick() }
      catch(err){ console.warn(err) }
      busy("");
    }
    if(!await selectFirstModel()){ busy(""); updateStatus(); updateReport() }
  }catch(err){ busy(""); $("err").textContent=err.message; console.error(err) }
}
// ---- 操作 ----
async function runScan(){
  if(state.scan) return;
  state.scan=await scanArchive(p=>busy(`アーカイブをさらっています… ${Math.round(p*100)}%`));
  state.infer=inferTable(state.src.exe,state.scan);
}
$("src-seg").onclick=async e=>{
  const b=e.target.closest("button"); if(!b) return;
  state.source=b.dataset.v; state.sel=-1;
  if(state.source==="scan"){ busy("アーカイブをさらっています…"); await runScan() }
  for(const x of $("src-seg").children) x.setAttribute("aria-pressed",String(x===b));
  rebuildEntries(); busy("調べています…"); await probeSamples(); busy("");
  fillTypeFilter(); renderFiles(); updateReport();
};
// ファイルの中に入っているモデルの選択（部分0＝本体、ほかは簡易版らしい）
// ---- 並べた一覧を1枚の画像にして保存する ----
// 画面を何度もスクリーンショットしなくて済むように、見出しごと1枚にまとめる
function gridToPng(gridId,title,name){
  const figs=[...$(gridId).querySelectorAll("figure")].filter(f=>f.querySelector("canvas"));
  if(!figs.length) return false;
  const CELL=132, PAD=10, HEAD=26, LINE=13;
  // 説明は枠の幅で折り返す。折り返さずに書くと隣の枠の説明に重なっていた。
  // 行数も切らない（切ると「色はディスクに無い」のような後ろの行が消える）
  const mg=document.createElement("canvas").getContext("2d"); mg.font="11px sans-serif";
  const wrap=t=>{ const out=[]; let cur="";
    for(const ch of t){ if(cur&&mg.measureText(cur+ch).width>CELL){ out.push(cur); cur="" } cur+=ch }
    if(cur) out.push(cur); return out };
  const caps=figs.map(f=>(f.querySelector("figcaption").textContent||"").split("\n").flatMap(wrap));
  const CAP=Math.max(3,...caps.map(c=>c.length))*LINE+6;
  const COLS=Math.max(1,Math.min(6,figs.length));
  const rows=Math.ceil(figs.length/COLS);
  const W=PAD+COLS*(CELL+PAD), H=PAD+HEAD+rows*(CELL+CAP+PAD);
  const out=document.createElement("canvas"); out.width=W; out.height=H;
  const g=out.getContext("2d");
  g.fillStyle="#1e1d1b"; g.fillRect(0,0,W,H);
  g.textBaseline="top";
  g.fillStyle="#e8e4dc"; g.font="bold 14px sans-serif"; g.fillText(title,PAD,PAD);
  figs.forEach((f,i)=>{
    const cv=f.querySelector("canvas");
    const cx=PAD+(i%COLS)*(CELL+PAD), cy=PAD+HEAD+((i/COLS)|0)*(CELL+CAP+PAD);
    // 市松模様。透けている所が分かるように
    for(let y=0;y<CELL;y+=12) for(let x=0;x<CELL;x+=12){
      g.fillStyle=((x/12+y/12)&1)?"#2e2e2e":"#3a3a3a";
      g.fillRect(cx+x,cy+y,Math.min(12,CELL-x),Math.min(12,CELL-y));
    }
    const sc=Math.min(CELL/cv.width,CELL/cv.height);
    const w=Math.max(1,cv.width*sc), h=Math.max(1,cv.height*sc);
    g.drawImage(cv,cx+(CELL-w)/2,cy+(CELL-h)/2,w,h);
    g.font="11px sans-serif"; g.fillStyle="#bdb7ac";
    caps[i].forEach((t,k)=>g.fillText(t,cx,cy+CELL+3+k*LINE));
  });
  out.toBlob(b=>saveBlob(b,name),"image/png");
  return true;
}

// ---- キャラクターのモデルを並べて見る ----
// どのファイルが誰なのかは、形と色を見比べるのが一番早い。
// 署名つきで「語1 が 0x14 でない」ものがキャラクターのモデル（0x14 は小さい別物）
function galleryEntries(limit){
  const sig=((state.sieve&&state.sieve.other)||[])
    .filter(o=>o.words&&o.words[0]===0x90000000&&o.words[1]!==0x14)
    .sort((a,b)=>b.dec-a.dec).map(o=>o.e);
  const list=sig.length?sig:state.entries.filter(entryIsModel).sort((a,b)=>b.size-a.size);
  // 同じ sector を二度出さない
  const seen=new Set(), out=[];
  for(const e of list){ if(seen.has(e.sector)) continue; seen.add(e.sector); out.push(e);
    if(out.length>=(limit||64)) break }   // 打ち切ると、そこにいるキャラを見落とす
  return out;
}
// 同じキャラかどうかの見分け方。色や模様は違っても、
// 三角形の数と部品の数が同じなら同じ形＝同一キャラの色違い・衣装違い
function t1CharKey(info){
  return `${info.tris}/${(info.t1Read&&info.t1Read.total)||0}`;
}
// 同じ形のものに 組A・組B… と名札を付け、絵の説明にも足す
function labelCharGroups(made){
  const by=new Map();
  for(const m of made){ if(!by.has(m.key)) by.set(m.key,[]); by.get(m.key).push(m) }
  const groups=[...by.values()].sort((a,b)=>b.length-a.length||b[0].tris-a[0].tris);
  const L=[], NAME="ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let gi=0;
  for(const g of groups){
    if(g.length<2) continue;
    const name="組"+(NAME[gi++]||"?");
    for(const m of g) m.cap.textContent+=`\n${name}（${g.length}体で同じ形）`;
    L.push(`  ${name}: ${g.length}体　三角形 ${g[0].tris}　${g.map(m=>"#"+m.e.no).join(" ")}`);
  }
  const alone=groups.filter(g=>g.length===1);
  if(alone.length) L.push(`  ほかに1体だけのもの ${alone.length}件: `
    +alone.map(g=>`#${g[0].e.no}(${g[0].tris})`).join(" "));
  L.unshift(`  同じ形でまとめると ${groups.length}種類（${made.length}体から）`);
  return L;
}
// いま描かれている絵を、キャラクターのところだけ切り出して小さくする
function grabThumb(side){
  const b=opaqueBox(null); if(!b) return null;
  const r=padBox(b);
  const cv=document.createElement("canvas"), S=side||132;
  const sc=Math.min(S/r.w,S/r.h), w=Math.max(1,Math.round(r.w*sc)), h=Math.max(1,Math.round(r.h*sc));
  cv.width=S; cv.height=S;
  const g=cv.getContext("2d");
  g.drawImage(canvas,r.x,r.y,r.w,r.h,(S-w)/2,(S-h)/2,w,h);
  return cv;
}
$("mdlgal").onclick=async()=>{
  if(state.galling) return;
  state.galling=true;
  const grid=$("mdlgrid"), note=$("mdlnote"), keep=state.sel;
  grid.innerHTML="";
  const list=galleryEntries(64);   // ふるい分けで見つかった数（40体）を全部出す
  state.segGal=false;
  // 一覧は見比べるための道具なので、角度を揃える。
  // 見る人が回した向きのままだと、肩の上が見えたり潰れたりして比べられない
  const keepView={yaw:view.yaw,pitch:view.pitch,dist:view.dist,pan:view.pan.slice()};
  view.yaw=0; view.pitch=0.08; view.dist=1; view.pan=[0,0,0];
  const whyAll=[], made=[]; let n=0;
  for(let k=0;k<list.length;k++){
    const e=list[k];
    note.textContent=`モデルを描いています… ${k+1}/${list.length}`;
    await idle();
    try{
      const {mesh,info}=buildModel(await readFull(e));
      if(!info||!info.tris){ clearMesh(); continue }
      upload(mesh); draw();
      if(info.t1Read&&info.t1Read.why&&info.t1Read.why.length)
        whyAll.push(`  #${e.no} sector ${e.sector}　命令${info.t1Read.run}／推測${info.t1Read.guess}　${info.t1Read.why[0]}`);
      const cv=grabThumb(132); if(!cv) continue;
      const fig=document.createElement("figure"), cap=document.createElement("figcaption");
      const r=info.t1Read;
      const nm=t1NameOf(e.sector);
      // 骨の区切り数も出す。格闘キャラは30前後で、ローブ姿の衛兵のような
      // 脚の分かれていないキャラクターは少ない（実物で #54/#66 が12だった）。
      // 名前を当てる前に、選手かどうかを絵と数の両方で見られるようにする
      const sg=info.t1Segs||0;
      cap.textContent=(nm?`${nm}\n`:"")+`#${e.no}　sector ${e.sector}`
        +`\n三角形 ${info.tris}`+(sg?`　区切り${sg}`:"")
        +(r?`　命令${r.run}`+(r.guess?`／推測${r.guess}`:""):"");
      if(sg&&sg<20) cap.textContent+="\n選手ではないかも";
      if(info.t1NoColor) cap.textContent+="\n色はディスクに無い（灰色で表示）";
      cap.style.whiteSpace="pre-line";
      if(r&&r.guess) cap.style.color="#c2683f";   // 当てずっぽうが混じるものは目立たせる
      cv.style.cursor="pointer";
      cv.onclick=()=>{ const i=state.entries.indexOf(e); if(i>=0) selectEntry(i) };
      fig.append(cv,cap); grid.append(fig); n++;
      made.push({e,cap,key:t1CharKey(info),tris:info.tris});
    }catch(_){}
  }
  // 同じ形（三角形の数も部品の数も同じ）のものは、同一キャラの色違い。
  // 40体がいくつのキャラに畳めるかは、名前を当てるときの手がかりになる
  state.galGroups=labelCharGroups(made);
  Object.assign(view,keepView);            // 見る人の向きは戻す
  state.galWhy=whyAll;
  note.textContent=`${n}体を並べました。絵を押すと、そのモデルに切り替わります`
    +(whyAll.length?`　読めないものが ${whyAll.length}体（理由は「解析」に出ています）`:"");
  state.galling=false;
  if(keep>=0) selectEntry(keep); else { clearMesh(); draw() }
};

// ---- テクスチャの一覧と絵 ----
// ふるい分けで見つけたテクスチャのファイルを選べるようにする
function fillTexPick(){
  const sel=$("texpick"), box=sel.closest("div");
  const tex=(state.sieve&&state.sieve.tex)||[];
  if(!tex.length){ box.hidden=true; return }
  box.hidden=false;
  sel.innerHTML='<option value="-1">選んでください（'+tex.length+'件）</option>'
    +'<option value="-2">すべて並べて見る</option>'
    +tex.map((t,i)=>`<option value="${i}">#${t.e.no} sector ${t.e.sector}　${t.colors}色　${t.pairs}組</option>`).join("");
}
// 選んだファイルの中身を取り出す（入れ子と圧縮をほどいて、いちばん大きい部分）
async function texBytes(e){
  const raw=await readFull(e);
  let parts=unpack(raw); if(!parts) parts=[raw];
  let best=null;
  for(const p of parts){
    if(!p||p.length<8) continue;
    let out=null; try{ out=p[0]===0x0b?decompress(p):p }catch(_){ continue }
    if(out&&(!best||out.length>best.length)) best=out;
  }
  return best;
}
// 絵を1枚ぶん作って並べる
function texAppend(grid,d,p,label){
  const img=t1TexRGBA(d,p); if(!img) return false;
  const cv=document.createElement("canvas");
  cv.width=img.w; cv.height=img.h;
  cv.getContext("2d").putImageData(new ImageData(img.data,img.w,img.h),0,0);
  const fig=document.createElement("figure"), cap=document.createElement("figcaption");
  cap.textContent=label||`${img.w}×${img.h}　${p.colors}色`;
  fig.append(cv,cap); grid.append(fig);
  return true;
}
// すべてのテクスチャを少しずつ並べる。どのファイルが誰の顔かを見比べるため
async function texAll(){
  const grid=$("texgrid"), note=$("texnote"), tex=state.sieve.tex;
  grid.innerHTML=""; let drawn=0;
  for(let k=0;k<tex.length;k++){
    const t=tex[k];
    note.textContent=`すべて並べています… ${k+1}/${tex.length}`;
    await idle();
    try{
      const d=await texBytes(t.e); if(!d) continue;
      const P=t1TexPairs(d); if(!P||!P.pairs.length) continue;
      for(const p of P.pairs.slice(0,3)) if(texAppend(grid,d,p,`#${t.e.no}`)) drawn++;
    }catch(_){}
  }
  note.textContent=`${tex.length}件から ${drawn}枚（各ファイル先頭3枚まで）。同じ顔ぶれが並ぶので、どれが誰かを見比べられます`;
}
// ---- 骨の区切りを1つずつ並べる ----
// 横一列に伸ばすと小さすぎて読めなかったので、モデル一覧と同じくタイルにする。
// どの区切りが腕で、どれが脚で、どれが胴なのか——ここが決まらないと骨組みは組めない
// 画面ぜんぶを小さくして取る（切り抜かない）。
// 切り抜いて大きさを合わせると、6枚の輪も134枚の塊も同じ大きさに見えてしまい、
// どれが腕でどれが脚かが分からなくなる
function grabFrame(side){
  const S=side||132, cv=document.createElement("canvas");
  cv.width=S; cv.height=S;
  const sc=Math.min(S/canvas.width,S/canvas.height);
  const w=Math.max(1,Math.round(canvas.width*sc)), h=Math.max(1,Math.round(canvas.height*sc));
  cv.getContext("2d").drawImage(canvas,0,0,canvas.width,canvas.height,(S-w)/2,(S-h)/2,w,h);
  return cv;
}
$("seggal").onclick=async()=>{
  const grid=$("mdlgrid"), note=$("mdlnote");
  const e=state.entries[state.sel], inf=state.selInfo;
  if(!e||!inf||!inf.t1Segs){ note.textContent="先にキャラクターのモデルを選んでください"; return }
  grid.innerHTML="";
  const keep={only:t1Show.segOnly,spread:t1Show.segSpread,col:t1Show.segColor};
  t1Show.segSpread=false; t1Show.segColor=false; t1Show.segOnly=-1;
  t1Show.segPart=inf.t1SegBase!=null?inf.t1SegBase:-1;   // 数字を出したのと同じ部品だけを描く
  const sizes=new Map();
  for(const line of inf.t1SegLine||[]){
    const m=/^(\d+):(\d+)枚 (.+)$/.exec(line);
    if(m) sizes.set(+m[1],{n:+m[2],wh:m[3]});
  }
  let made=0;
  const keepView2={yaw:view.yaw,pitch:view.pitch,dist:view.dist,pan:view.pan.slice()};
  view.yaw=0; view.pitch=0.08; view.dist=1; view.pan=[0,0,0];
  try{
    const raw=await readFull(e);
    // まずモデル全体でカメラを合わせ、以後は合わせ直さない。
    // 同じ縮尺・同じ角度で並ぶので、大きさと位置をそのまま見比べられる
    upload(buildModel(raw).mesh, true); draw();
    for(const k of [...sizes.keys()].sort((a,b)=>a-b)){
      note.textContent=`区切りを描いています… ${made+1}/${sizes.size}`;
      await idle();
      t1Show.segOnly=k;
      const {mesh}=buildModel(raw);
      upload(mesh,false); draw();
      const cv=grabFrame(132);
      const fig=document.createElement("figure"), cap=document.createElement("figcaption");
      const z=sizes.get(k);
      cap.textContent=`区切り ${k}\n${z.n}枚　${z.wh}`;
      cap.style.whiteSpace="pre-line";
      cv.style.cursor="default";
      fig.append(cv,cap); grid.append(fig); made++;
    }
  }catch(err){ note.textContent="区切りを描けませんでした: "+err.message }
  Object.assign(view,keepView2);
  t1Show.segOnly=keep.only; t1Show.segSpread=keep.spread; t1Show.segColor=keep.col; t1Show.segPart=-1;
  await selectEntry(state.sel);
  state.segGal=true;
  note.textContent=`${made}個の区切りを、同じ縮尺・同じ角度で並べました。「この一覧を画像で保存」で1枚にできます`;
};
$("mdlsave").onclick=()=>{
  const t=state.segGal?"トバルNo.1 骨の区切り":"トバルNo.1 モデル一覧";
  const nm=state.segGal?`tobal1_segments.png`:`tobal1_models_${state.entries.length}.png`;
  if(!gridToPng("mdlgrid",t,nm))
    $("mdlnote").textContent="先に「モデルを並べて見る」を押してください";
};
$("texsave").onclick=()=>{
  if(!gridToPng("texgrid","トバルNo.1 テクスチャ一覧","tobal1_textures.png"))
    $("texnote").textContent="先にテクスチャを選んでください";
};
$("texpick").onchange=async e=>{
  const i=+e.target.value, grid=$("texgrid"), note=$("texnote");
  grid.innerHTML="";
  if(i===-2){ await texAll(); return }
  if(i<0) return;
  const t=state.sieve.tex[i];
  note.textContent=`#${t.e.no} を読んでいます…`;
  try{
    const d=await texBytes(t.e);
    const P=d?t1TexPairs(d):null;
    if(!P||!P.pairs.length){ note.textContent="絵にできる組が見つかりませんでした"; return }
    let drawn=0;
    for(const p of P.pairs.slice(0,64)) if(texAppend(grid,d,p)) drawn++;
    note.textContent=`#${t.e.no} sector ${t.e.sector}　${drawn}枚`
      +(P.pairs.length>drawn?`（ほか ${P.pairs.length-drawn}枚）`:"")
      +`　転送 ${P.blocks}回`;
  }catch(err){ console.error(err); note.textContent="読めませんでした: "+err.message }
};

// メモリの写しを読む。読むのはこのページの仕事で、あなたはゲームを動かすだけでいい
// ヘッダーの版は VERSION から書く。
// head.html に直書きしていたので、v4.29〜v4.32 のあいだ「v4.28.0」と
// 出たままだった。新しい版を上げたのに古いと見える、いちばん困る間違い方
{ const r=$("rev"); if(r) r.textContent=VERSION+" ・ 非公式" }
// RAM と VRAM は2つ同時に選べる。大きさで見分け、RAM（2MB）を先に読む
async function loadMemFiles(files){
  const fs=[...(files||[])].sort((a,b)=>b.size-a.size);
  for(const f of fs) await loadMemFile(f);
  if(fs.length) openTab("file");
}
$("memfile").onchange=e=>loadMemFiles(e.target.files);
$("memfile2").onchange=e=>{ showMainUI(); loadMemFiles(e.target.files) };
$("saved-open").onclick=async()=>{ showMainUI(); openTab("file");
  const list=await fillSaved(); if(list.length) await selectSaved(list[0].id) };
// ディスクを読まずに（写しや保存したキャラクターだけで）画面を出す
function showMainUI(){
  $("drop").hidden=true; $("side").hidden=false; $("hint").hidden=false; $("shot-box").hidden=false; $("bg-box").hidden=false;
  document.body.classList.add("loaded"); applyLayout();
}
async function loadMemFile(f){
  if(!f) return;
  const st=$("mem-status");
  st.textContent=`${f.name}（${fmtSize(f.size)}）を読んでいます…`;
  try{
    let buf=new Uint8Array(await f.arrayBuffer());
    // VRAM の写し（1024×512×2＝1,048,576バイト）なら、テクスチャとして受け取る。
    // 貼り先（UV・CLUT・ページ）はモデルの中に入っているが、絵そのものは
    // VRAM にあって RAM ダンプには入っていない
    if(buf.length===1024*512*2){
      const rgba=t1VramRGBA(buf);
      state.vram=rgba; t1SetVram(rgba);
      st.textContent=`${f.name}: VRAM を受け取りました（1024×512）。テクスチャを貼ります`;
      redrawCurrent(); updateReport(); openTab("info");
      return;
    }
    const exe=state.src&&state.src.exe;
    const prep=await memPrepare(buf,exe);
    state.mem=[`メモリの写し: ${f.name}（${fmtSize(f.size)}）${prep.note}`];
    state.ramName=f.name.replace(/\.[^.]*$/,""); state.fromSaved=false;
    // 写しに載っているモデルと骨をそのまま出す（ディスクとは突き合わせない）
    const pick=memPickBase(prep.buf,exe);
    const cs=pick.base>=0?memCharacters(prep.buf,pick.base):[];
    state.ramBuf=prep.buf; state.ramBase=pick.base;
    state.ramChars=cs.length?cs:null;
    state.mem.push(...memCharLines(cs));
    fillRamChar();
    if(cs.length){
      st.textContent=`${f.name}: 写しの中の ${cs.map(c=>c.who).join("・")} を取り出しました`;
      await selectRamChar(0);
      busy("");
    } else st.textContent=`${f.name}: 写しの中にキャラクターが見つかりませんでした`;
  }catch(err){ console.error(err); state.mem=["メモリの写しを読めませんでした: "+err.message];
    st.textContent="読めませんでした: "+err.message }
  updateReport(); openTab("info");
}
// ============================================================
//  写しの中の人を出す
//
//  ディスクのファイルと突き合わせるのをやめた。骨（表B）もモデル（表C）も
//  同じ1つの写しの中に揃っていて、写しから読んだほうが欠けずに読める。
//  実測（dump3）: 1P 11/11部品 区切り40 三角1065／2P 11/11部品 区切り34 三角1128。
//  骨の本数は、本体の命令5の回数（40・34）とぴったり一致した
// ============================================================
async function selectRamChar(k){
  const c=(state.ramChars||[])[k]; if(!c) return;
  state.ramSel=k; state.sel=-1; state.selInfo=null; state.selErr="";
  for(const b of $("files").children) if(b.dataset) b.setAttribute("aria-pressed","false");
  busy("写しからモデルを組み立てています…");
  try{
    // 本物の骨はワールド空間にあるので、向きは Y を裏返したものにする
    if(typeof T1_UP_WORLD==="number"&&t1Show.up!==T1_UP_WORLD){
      t1Show.up=T1_UP_WORLD;
      for(const x of $("up-seg").children) x.setAttribute("aria-pressed",String(+x.dataset.up===t1Show.up));
      try{ localStorage.setItem("t1up2",String(t1Show.up)) }catch(_){}
    }
    // 骨は、カメラを掛ける前の並びに置き換えたものを使う
    const bb=c.savedBones||memCharBones(state.ramBuf,state.ramBase,c);   // 保存したキャラは骨も保存してある
    state.ramBones=bb;
    t1SetBones(bb&&bb.list&&bb.list.length?bb.list:null,!!(bb&&bb.list&&bb.list.length));
    // 手は写しと同じ形（形A と 形B を混ぜたもの）にする。選び口で形 1〜4 も選べる
    const useBlend=state.t1Slot===-10&&c.hand;
    const {mesh,info}=buildModel(useBlend?memApplyHandBlend(c.model.bytes,c.hand):c.model.bytes);
    if(c.hand) info.t1Hand="  写しの手の形: "+Object.entries(c.hand).map(([g,h])=>`${g==="1"?"右手":"左手"} 形${h.a+1}`+(h.t?`→形${h.b+1} を ${Math.round(h.t*100)}%`:" そのまま")).join("　")
      +(useBlend?"（この形で描いています）":"（いまは選び口の形で描いています）");
    if(state.vram&&typeof t1SetVram==="function") t1SetVram(state.vram);
    info.ramChar=`  写しの中の ${c.who}: モデル ${hex(c.model.at)}（${c.model.len} B）`
      +`　骨 ${c.bones.list.length}本　本体の命令5 ${c.cmd5}回`
      +(c.cmd5&&c.bones.list.length===c.cmd5?"（一致）":"（合っていない）")
      +(bb?`　骨を当てた並び ${hex(bb.at)}${bb.sc?`　背の高さ ${bb.sc.tall}　左右の対 ${bb.sc.pairs}組`:"（カメラを掛けたまま）"}`:"");
    state.selInfo=info;
    layers[1].count=0;
    if(info.error){ state.selErr=info.error; clearMesh() } else upload(mesh);
    // 向きを正面に戻す。写しの骨を当てると縦に伸びるので、寄りすぎて見切れる
    if(typeof resetView==="function"){ resetView(); view.dist=1.5 }
    // 最初から正面を向ける。骨はワールドの向きなので、2P は後ろ向きで出ていた
    { const y=t1FrontYaw(bb&&bb.list); if(y!=null){ view.yaw=y; draw() } }
    if(!info.error&&state.ramBoth&&!state.fromSaved) showRamPartner(k,mesh,bb);
    draw();
  }catch(err){
    state.selErr=err.message; state.selInfo=err.info||null; console.error(err);
    clearMesh(); draw();
  }
  busy(""); updateStatus(); updateReport(); updateHud();
  fillT1Part(state.selInfo); fillT1Slot(state.selInfo);
}
// 同じ写しのもう1人を、層1 に並べて描く。骨はどちらも対戦の場面の座標なので、
// そのまま描けばゲームと同じ立ち位置で向かい合う
function showRamPartner(k,mesh,bb){
  const j=(state.ramChars||[]).findIndex((_,i)=>i!==k); if(j<0) return;
  const c=state.ramChars[j];
  try{
    const b2=memCharBones(state.ramBuf,state.ramBase,c);
    if(!b2||!b2.list||!b2.list.length) return;
    t1SetBones(b2.list,true);
    const m2=buildModel(state.t1Slot===-10&&c.hand?memApplyHandBlend(c.model.bytes,c.hand):c.model.bytes).mesh;
    upload(m2,false,1);
    // 2人とも入るようにカメラを合わせ、2人を結ぶ線の真横から見る
    const P=new Float32Array(mesh.pos.length+m2.pos.length); P.set(mesh.pos); P.set(m2.pos,mesh.pos.length);
    fitView(P); view.dist=1.2;
    const mid=a=>{ let s=0,n=0; for(let i=0;i<a.length;i+=3){ s+=a[i]; n++ } return n?s/n:0 };
    const midz=a=>{ let s=0,n=0; for(let i=2;i<a.length;i+=3){ s+=a[i]; n++ } return n?s/n:0 };
    const d=[mid(m2.pos)-mid(mesh.pos),midz(m2.pos)-midz(mesh.pos)];   // 選んだ人 → もう1人
    const one=k===0?1:-1;   // 1P が左、2P が右に来るように
    view.yaw=Math.atan2(d[1],d[0])+Math.PI/2; draw();
    if((cam.s[0]*d[0]+cam.s[2]*d[1])*one<0){ view.yaw+=Math.PI; draw() }
  }finally{
    t1SetBones(bb&&bb.list&&bb.list.length?bb.list:null,!!(bb&&bb.list&&bb.list.length));   // 選んだ人の骨に戻す
  }
}
function fillRamChar(){
  const box=$("ramchar-box"), sel=$("ramchar");
  const c=state.ramChars||[];
  if(!box||!sel) return;
  if(!c.length||state.fromSaved){ box.hidden=true; return }
  box.hidden=false;
  sel.innerHTML=c.map((x,i)=>`<option value="${i}">${x.who}　モデル ${hex(x.model.at)}　骨 ${x.bones.list.length}本</option>`).join("");
  sel.value=String(state.ramSel<0?0:state.ramSel);
}
// 差し替えの組から何番目を出すか。既定は各組の1つ目（手と顔が付く）
function fillT1Slot(inf){
  const box=$("t1slot-box"), sel=$("t1slot");
  if(!box||!sel) return;
  const n=inf&&inf.t1SlotMax||0;
  if(n<1){ box.hidden=true; return }
  box.hidden=false;
  const ram=state.ramSel>=0&&state.ramChars&&state.ramChars[state.ramSel];
  sel.innerHTML=`<option value="-10">${ram&&ram.hand?"写しと同じ手（既定）":"既定（手の形 1）"}</option>`
    +Array.from({length:n},(_,i)=>`<option value="${i}">手の形 ${i+1}</option>`).join("")
    +'<option value="-2">手を出さない（顔の貼りものだけ）</option>'
    +'<option value="-1">出さない（本体だけ）</option>';
  const v=state.t1Slot>=100?state.t1Slot-100:state.t1Slot;
  sel.value=String(v>=n?n-1:v);
}
$("t1part").onchange=e=>{ state.t1Part=+e.target.value; redrawCurrent() };
$("t1slot").onchange=e=>{ state.t1Slot=+e.target.value; redrawCurrent() };
$("ramchar").onchange=e=>{ selectRamChar(+e.target.value) };
// 格子の切り替え。選んだものはブラウザに覚えておく
{ const f=$("grid-floor"), w=$("grid-wall"), st=$("grid-step"), co=$("grid-color");
  f.checked=!!grid.floor; w.checked=!!grid.wall; st.value=String(grid.step); co.value=grid.color;
  const upd=()=>{ grid.floor=f.checked; grid.wall=w.checked; grid.step=+st.value||200; grid.color=co.value; gridSave(); draw() };
  for(const x of [f,w,st]) x.onchange=upd; co.oninput=upd; }
$("ramboth").onchange=e=>{ state.ramBoth=e.target.checked; if(state.ramSel>=0) selectRamChar(state.ramSel) };

// ============================================================
//  写しから取り出したキャラクターを、ブラウザの中（IndexedDB）に保存する
//
//  毎回 RAM と VRAM を読み込まなくても、一覧から選ぶだけで出せるように。
//  保存するのはモデルのバイト列・当てた骨・VRAM（1MB）だけ。
//  データはこの端末のブラウザにだけ残り、サイトには載らない
// ============================================================
const SAVED_DB="tobal1-viewer", SAVED_STORE="chars";
function savedDb(){
  return new Promise((ok,ng)=>{
    if(typeof indexedDB==="undefined") return ng(new Error("このブラウザでは保存できません"));
    const rq=indexedDB.open(SAVED_DB,1);
    rq.onupgradeneeded=()=>{ rq.result.createObjectStore(SAVED_STORE,{keyPath:"id",autoIncrement:true}) };
    rq.onsuccess=()=>ok(rq.result); rq.onerror=()=>ng(rq.error||new Error("保存先を開けません"));
  });
}
async function savedDo(mode,fn){
  const db=await savedDb();
  try{ return await new Promise((ok,ng)=>{ const tx=db.transaction(SAVED_STORE,mode), st=tx.objectStore(SAVED_STORE);
    const rq=fn(st); tx.oncomplete=()=>ok(rq&&rq.result); tx.onerror=()=>ng(tx.error); tx.onabort=()=>ng(tx.error) }) }
  finally{ db.close() }
}
const savedAll=()=>savedDo("readonly",st=>st.getAll());
// VRAM は絵にする形（1画素4バイト）で持っているので、元の 16bit の並びに戻して半分の大きさで保存する
function vramRaw(rgba){ if(!rgba) return null; const o=new Uint8Array(1024*512*2);
  for(let i=0;i<1024*512;i++){ o[i*2]=rgba[i*4]; o[i*2+1]=rgba[i*4+1] } return o }
async function saveRamChars(){
  const cs=state.ramChars||[], st=$("saved-status");
  if(!cs.length||state.fromSaved) return;
  if(!state.vram&&!confirm("VRAM ダンプがまだ読み込まれていません。模様（テクスチャ）なしで保存しますか？")) return;
  const vram=vramRaw(state.vram);
  let n=0;
  for(const c of cs){
    const name=prompt(`${c.who} の名前（一覧に出ます）`,`${state.ramName||"写し"} ${c.who}`);
    if(name===null) continue;
    const bb=memCharBones(state.ramBuf,state.ramBase,c);
    await savedDo("readwrite",s=>s.add({name:name.trim()||c.who,who:c.who,saved:Date.now(),
      model:new Uint8Array(c.model.bytes),at:c.model.at,len:c.model.len,cmd5:c.cmd5,
      bones:c.bones.list,bb:bb?{list:bb.list,at:bb.at,sc:bb.sc,view:bb.view}:null,vram,hand:c.hand||null}));
    n++;
  }
  if(st) st.textContent=n?`${n}人を保存しました。次からは「保存したキャラクター」から選べます`:"";
  await fillSaved();
}
async function fillSaved(){
  const box=$("saved-box"), sel=$("savedchar"); if(!box||!sel) return [];
  let list=[]; try{ list=await savedAll() }catch(err){ box.hidden=true; return [] }
  box.hidden=!list.length;
  { const b=$("saved-open"); if(b) b.hidden=!list.length; }
  sel.innerHTML='<option value="">選んでください</option>'
    +list.map(r=>`<option value="${r.id}">${r.name.replace(/[<&>"]/g,"")}${r.vram?"":"（模様なし）"}</option>`).join("");
  if(state.savedId!=null&&list.some(r=>r.id===state.savedId)) sel.value=String(state.savedId);
  return list;
}
async function selectSaved(id){
  const r=(await savedAll()).find(x=>x.id===id); if(!r) return;
  state.savedId=id; state.fromSaved=true;
  // 写しの人と同じ形にして、同じ道（selectRamChar）で描く
  const c={who:r.who,label:r.name,cmd5:r.cmd5,model:{bytes:r.model,at:r.at,len:r.len},
           bones:{list:r.bones,ptrs:[]},savedBones:r.bb,hand:r.hand||null};
  state.ramChars=[c]; state.ramBuf=null;
  state.vram=r.vram?t1VramRGBA(r.vram):null; t1SetVram(state.vram);
  fillRamChar();
  await selectRamChar(0);
}
$("savedchar").onchange=e=>{ if(e.target.value) selectSaved(+e.target.value) };
$("saved-del").onclick=async()=>{
  const sel=$("savedchar"), id=+sel.value; if(!sel.value) return;
  const name=sel.options[sel.selectedIndex].textContent;
  if(!confirm(`「${name}」を消しますか？`)) return;
  await savedDo("readwrite",s=>s.delete(id));
  if(state.savedId===id) state.savedId=null;
  await fillSaved();
};
$("saved-add").onclick=()=>saveRamChars();
fillSaved();
// いま出しているものを組み立て直す（写しの中の人か、ディスクのファイルか）
function redrawCurrent(){
  if(state.ramSel>=0&&state.ramChars) return selectRamChar(state.ramSel);
  if(state.sel>=0) return selectEntry(state.sel);
}
function fillT1Part(inf){
  const box=$("t1part-box"), sel=$("t1part"), list=inf&&inf.modelParts||[];
  if(list.length<2){ box.hidden=true; return }
  box.hidden=false;
  const want=String(state.t1Part);
  sel.innerHTML='<option value="-1">いちばん大きいもの（本体）</option>'
    +list.map(i=>{ const q=inf.otherParts.find(x=>x.i===i);
      return `<option value="${i}">部分${i}（${q?q.out.length:0} B）</option>` }).join("");
  sel.value=[...sel.options].some(o=>o.value===want)?want:"-1";
}
$("rig-seg").onclick=e=>{
  const b=e.target.closest("button"); if(!b) return;
  state.rig=b.dataset.v;
  for(const x of $("rig-seg").children) x.setAttribute("aria-pressed",String(x===b));
  if(state.sel>=0) selectEntry(state.sel);
};
$("arc-pick").onchange=async e=>{
  state.src.setArc(+e.target.value);
  state.cache.clear(); state.probe.clear(); state.head.clear(); state.sel=-1;
  busy("確かめています…"); await scoreTables(state.tables); busy("");
  const ex=exeInfo(state.src.exe);
  $("table-pick").innerHTML=state.tables.map((t,i)=>`<option value="${i}">[${i+1}] ${tableLabel(t,ex)}</option>`).join("");
  state.tableIdx=0; rebuildEntries();
  busy("調べています…"); await probeSamples(); busy("");
  fillTypeFilter(); renderFiles(); updateReport();
  if(!await selectFirstModel()) updateStatus();
};
$("table-pick").onchange=async e=>{
  const i=+e.target.value; if(i<0) return;
  state.tableIdx=i; state.source="table"; state.sel=-1; state.probe.clear();
  for(const x of $("src-seg").children) x.setAttribute("aria-pressed",String(x.dataset.v==="table"));
  rebuildEntries(); busy("調べています…"); await probeSamples(); busy("");
  fillTypeFilter(); renderFiles(); updateReport();
  await selectFirstModel();
};
$("type-filter").onchange=renderFiles;
$("model-only").onchange=renderFiles;
$("scan-all").onclick=scanAll;
$("copy-report").onclick=async()=>{
  const t=$("report");
  try{ await navigator.clipboard.writeText(t.value) }catch(_){ t.select(); document.execCommand("copy") }
  $("copy-report").textContent="コピーしました"; setTimeout(()=>{$("copy-report").textContent="この内容をぜんぶコピー"},1400);
};
// 作者に送るまとめ。報告そのものより短く、前回と変わったところだけが入る
$("copy-digest").onclick=async()=>{
  const b=$("copy-digest"), txt=digestLines().join("\n");
  try{ await navigator.clipboard.writeText(txt) }
  catch(_){ const t=$("report"); const keep=t.value; t.value=txt; t.select();
            document.execCommand("copy"); t.value=keep }
  b.textContent=`コピーしました（${txt.length}文字）`;
  setTimeout(()=>{b.textContent="作者に送るまとめをコピー（短い）"},1800);
};
$("bgm").onchange=e=>bgmPlay(+e.target.value);
$("bgm-vol").oninput=e=>{ bgm.volume=+e.target.value; if(bgm.gain) bgm.gain.gain.value=bgm.volume };
const redraw=()=>{ if(state.sel!=null&&state.sel>=0) selectEntry(state.sel) };
const showToggle=(id,key,store)=>{
  $(id).checked=t1Show[key];
  $(id).onchange=e=>{ t1Show[key]=e.target.checked;
    try{ localStorage.setItem(store,t1Show[key]?"1":"0") }catch(_){}
    redraw() };
};
// 向き（背の高さの軸を上に持ってくる）
$("up-seg").onclick=e=>{
  const b=e.target.closest("button"); if(!b) return;
  for(const x of $("up-seg").children) x.setAttribute("aria-pressed",String(x===b));
  t1Show.up=+b.dataset.up;
  try{ localStorage.setItem("t1up2",String(t1Show.up)) }catch(_){}
  redraw();
};
for(const x of $("up-seg").children) x.setAttribute("aria-pressed",String(+x.dataset.up===t1Show.up));
showToggle("showall","all","t1all");
showToggle("showonly","only","t1only");
showToggle("segcol","segColor","t1segcol");
showToggle("spread","spread","t1spread");
showToggle("segspread","segSpread","t1segspread");
showToggle("guessbone","guessBone","t1guessbone");
showToggle("chainbone","chainBone","t1chainbone");
showToggle("flatcol","flatColor","t1flatcol");
// 色の引き方の自動判定は僅差になることがある。手で選べるようにしておく
// 覚える鍵を変える。古い「t1colmode」に入っていた選択は捨てる。
// v4.36.0 より前に手で選んだ人が、解けた並びを使えないままになるため
try{ const cm=$("colmode"); if(cm){ cm.value=t1Show.colMode||"";
  cm.onchange=()=>{ t1Show.colMode=cm.value;
    try{ localStorage.setItem("t1colmode2",cm.value) }catch(_){}
    redrawCurrent() } } }catch(_){}
try{ const h=$("hudon"); if(h){ try{ h.checked=localStorage.getItem("t1hud")!=="0" }catch(_){}
  h.onchange=()=>{ try{ localStorage.setItem("t1hud",h.checked?"1":"0") }catch(_){} updateHud() };
  updateHud() } }catch(_){}
// 切り替えを増やしすぎた。1つ押せばふつうの見た目に戻せるようにする。
// 調べもの用の切り替え（並べる・色分け・読めない部品も出す）を全部切る
$("viewreset").onclick=()=>{
  for(const [id,key,mem] of [["showall","all","t1all"],["showonly","only","t1only"],
                             ["segcol","segColor","t1segcol"],["spread","spread","t1spread"],
                             ["segspread","segSpread","t1segspread"]]){
    t1Show[key]=false; const c=$(id); if(c) c.checked=false;
    try{ localStorage.setItem(mem,"0") }catch(_){}
  }
  t1Show.segOnly=-1; t1Show.segPart=-1;
  if(state.sel>=0) selectEntry(state.sel); else redraw();
};
// 開く量。決め打ちより、見ながら合わせられるほうが早い
$("gbamt").value=String(Math.round(t1Show.guessAmt*100));
$("gbamt-v").textContent=t1Show.guessAmt.toFixed(2);
$("gbamt").oninput=e=>{
  t1Show.guessAmt=+e.target.value/100;
  $("gbamt-v").textContent=t1Show.guessAmt.toFixed(2);
  try{ localStorage.setItem("t1guessamt",String(t1Show.guessAmt)) }catch(_){}
  if(t1Show.guessBone&&state.sel>=0) selectEntry(state.sel);
};
$("gouraud").checked=shading.gouraud;
$("gouraud").onchange=e=>{
  shading.gouraud=e.target.checked; try{ localStorage.setItem("t1gouraud",shading.gouraud?"1":"0") }catch(_){}
  if(state.sel>=0) selectEntry(state.sel);
};
// ---- 背景 ----
const BG_PRESETS=[
  {name:"ダーク",c:"#3a3834",e:"#2a2926",light:false},
  {name:"黒",c:"#111111",e:"#000000",light:false},
  {name:"グレー",c:"#8a8a8a",e:"#6a6a6a",light:false},
  {name:"白",c:"#ffffff",e:"#e6e4df",light:true},
  {name:"空",c:"#bfe3ff",e:"#5a9fd6",light:true},
  {name:"夕焼け",c:"#ffcf8a",e:"#c4533a",light:true},
  {name:"夜",c:"#35407a",e:"#0d1030",light:false},
  {name:"グリーンバック",c:"#00b140",e:"#00b140",light:false},
];
function setBackground(i){
  const p=BG_PRESETS[i]||BG_PRESETS[0], root=document.documentElement.style;
  root.setProperty("--stage2",p.c); root.setProperty("--stage",p.e);
  document.querySelector(".stage").classList.toggle("light",p.light);
  for(const [k,b] of [...$("bg-box").children].entries()) b.setAttribute("aria-pressed",String(k===i));
  try{ localStorage.setItem("t1bg",String(i)) }catch(_){}
}
BG_PRESETS.forEach((p,i)=>{ const b=document.createElement("button"); b.title=p.name; b.setAttribute("aria-label","背景: "+p.name);
  b.style.background=`radial-gradient(circle at 40% 35%,${p.c},${p.e})`; b.onclick=()=>setBackground(i); $("bg-box").append(b) });
(()=>{ let i=0; try{ i=+localStorage.getItem("t1bg")||0 }catch(_){} setBackground(i) })();
// ---- スマホの配置 ----
const mobileMQ=matchMedia("(max-width:720px)");
const shotOpt=$("shot-clear").closest("label"), gouraudOpt=$("gouraud-opt"), cropOpt=$("crop-opt"),
      allOpt=$("showall-opt"), onlyOpt=$("showonly-opt"), segOpt=$("segcol-opt"), sprOpt=$("spread-opt"), sspOpt=$("segspread-opt"), gbOpt=$("guessbone-opt"), gaOpt=$("gbamt-opt"), vrBtn=$("viewreset"), hudOpt=$("hud-opt"), fcOpt=$("flatcol-opt"), cmOpt=$("colmode-opt");
function applyLayout(){
  const m=mobileMQ.matches, stage=document.querySelector(".stage");
  if(m){ $("look-bg").append($("bg-box"),gouraudOpt,allOpt,onlyOpt,segOpt,sprOpt,sspOpt,gbOpt,gaOpt,vrBtn,fcOpt,cmOpt,hudOpt,shotOpt,cropOpt);
          shotOpt.className=gouraudOpt.className=cropOpt.className=allOpt.className=onlyOpt.className=segOpt.className=sprOpt.className=sspOpt.className=gbOpt.className=gaOpt.className=hudOpt.className=fcOpt.className=cmOpt.className="shot-opt"; $("bg-box").hidden=false }
  else { stage.insertBefore($("bg-box"),$("shot-box")); $("shot-box").prepend(cropOpt); $("shot-box").prepend(shotOpt); $("shot-box").prepend(hudOpt); $("shot-box").prepend(cmOpt); $("shot-box").prepend(fcOpt); $("shot-box").prepend(vrBtn); $("shot-box").prepend(gaOpt); $("shot-box").prepend(gbOpt); $("shot-box").prepend(sspOpt); $("shot-box").prepend(sprOpt); $("shot-box").prepend(segOpt); $("shot-box").prepend(onlyOpt); $("shot-box").prepend(allOpt); $("shot-box").prepend(gouraudOpt);
          shotOpt.className=gouraudOpt.className=cropOpt.className=allOpt.className=onlyOpt.className=segOpt.className=sprOpt.className=sspOpt.className=gbOpt.className=gaOpt.className=hudOpt.className=fcOpt.className=cmOpt.className=""; closeSheet() }
  requestAnimationFrame(draw);
}
function openTab(t){
  const side=$("side"), same=side.classList.contains("open")&&side.dataset.tab===t;
  if(same){ closeSheet(); return }
  side.dataset.tab=t; side.classList.add("open"); side.scrollTop=0;
  for(const b of $("tabbar").children) b.setAttribute("aria-pressed",String(b.dataset.tab===t));
}
function closeSheet(){ $("side").classList.remove("open"); for(const b of $("tabbar").children) b.setAttribute("aria-pressed","false") }
$("tabbar").onclick=e=>{ const b=e.target.closest("button"); if(b) openTab(b.dataset.tab) };
canvas.addEventListener("pointerdown",()=>{ if(mobileMQ.matches) closeSheet() });
mobileMQ.addEventListener("change",applyLayout);
applyLayout();
