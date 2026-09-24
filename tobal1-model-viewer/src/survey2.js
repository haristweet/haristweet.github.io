// ============================================================
//  候補を全部ふるいにかける
//  大きい24件が全部テクスチャだったので、114件すべてを見る。
//  テクスチャは署名（語0=組数, 語1=0x10, 語2=8|9, 語3=0x2C|0x20C）で
//  すぐ判るので、組み立てずに弾く。残ったものがモデルの候補。
// ============================================================
async function sieveAll(onProgress){
  const list=state.entries.filter(e=>!e.kind||e.kind!=="raw").sort((a,b)=>b.size-a.size);
  const tex=[], vag=[], other=[], broken=[], bones=[];
  for(let i=0;i<list.length;i++){
    const e=list[i];
    if(onProgress&&i%4===0) onProgress(i/list.length);
    await idle();
    try{
      const raw=await readFull(e);
      let parts=unpack(raw); if(!parts) parts=[raw];
      // いちばん大きい部分を展開してみる
      let body=null;
      parts.forEach((p,pi)=>{
        if(!p||p.length<8) return;
        let out=null; try{ out=p[0]===0x0b?decompress(p):p }catch(_){ return }
        if(!out||out.length<64) return;
        if(!body||out.length>body.length) body=out;
        // ついでに「32バイトの行列の並び」かどうかも見る。骨の表はこの形のはず
        const bs=boneScanBest(out);
        if(bs&&bs.n>=8&&bs.ratio>=0.5) bones.push({e,pi,len:out.length,b:bs});
      });
      // 展開できないファイルは、生のバイトをそのまま覚えておく。
      // 骨の表は圧縮されていない固定長の並びかもしれない——
      // だとすると「展開できない」のは当たり前で、中身を見ないと分からない。
      // 番号だけ出していたので、いちばん知りたいものが見えていなかった
      if(!body){
        broken.push({e,why:"展開できない",
          head:Array.from(raw.subarray(0,32),v=>v.toString(16).padStart(2,"0")).join(" "),
          i16:Array.from({length:12},(_,k)=>
            k*2+2<=raw.length?((raw[k*2]|(raw[k*2+1]<<8))<<16>>16):0).join(","),
          // 先頭32バイトだけでは表かどうか決まらない。小さいものは丸ごと覚える
          full:raw.length<=4096?raw.slice():null,
          rawLen:raw.length});
        continue }
      const ti=textureInfoT1(body);
      if(ti){ tex.push({e,pairs:ti.pairs,colors:ti.colors,dec:body.length}); continue }
      // VAGp = PS1 の音声。効果音やボイス
      if(body[0]===0x56&&body[1]===0x41&&body[2]===0x47&&body[3]===0x70){ vag.push({e,dec:body.length}); continue }
      const dv=new DataView(body.buffer,body.byteOffset,body.byteLength);
      const words=Array.from({length:Math.min(8,body.length>>2)},(_,k)=>dv.getUint32(k*4,true));
      // キャラクターのモデル（署名つきで語1が0x14でない）は、読めるかどうかまで見る
      let diag=null;
      if(words[0]===0x90000000&&words[1]!==0x14){
        try{ diag=t1Diagnose(body) }catch(_){}
      }
      // 読めなかったキャラクターのモデルは、あとでもう一度かける（そのときには
      // ほかのモデルで覚えた命令が増えているので、読めるようになることがある）
      other.push({e,dec:body.length,parts:parts.map(p=>p.length).join("/"),words,diag,
        retry:(diag&&diag.fail>0)?body:null,
        // 小さいファイルは展開後を丸ごと覚える。先頭24バイトでは
        // 「数が並んでいる」までしか分からず、区切りも本数も読めなかった。
        // 16KB まで広げた——角度の列を探すには、1フレームぶんの刻みが
        // 何度も繰り返されるだけの長さが要る
        full:body.length<=16384?body.slice():null,
        head:Array.from(body.subarray(0,24),v=>v.toString(16).padStart(2,"0")).join(" ")});
    }catch(err){ broken.push({e,why:err.message}) }
  }
  // 2周目・3周目。1周目で覚えた命令と読み方があるので、そこで詰まったものが解ける
  for(let pass=0;pass<2;pass++){
    const left=other.filter(o=>o.retry);
    if(!left.length) break;
    let fixed=0;
    for(const o of left){
      try{ const g=t1Diagnose(o.retry); if(g.fail<o.diag.fail){ o.diag=g; fixed++ }
           if(g.fail===0) o.retry=null }catch(_){}
    }
    if(!fixed) break;
  }
  for(const o of other) o.retry=null;          // 展開した中身は抱えたままにしない
  if(onProgress) onProgress(1);
  bones.sort((a,b)=>b.b.ratio-a.b.ratio||b.b.n-a.b.n);
  return {tex,vag,other,broken,bones,total:list.length};
}
function sieveLines(s){
  const L=[];
  L.push(`  全 ${s.total}件 → テクスチャ ${s.tex.length} / 音声(VAGp) ${(s.vag||[]).length} / それ以外 ${s.other.length} / 読めない ${s.broken.length}`);
  if(s.tex.length){
    const by=s.tex.reduce((m,t)=>m.set(t.colors,(m.get(t.colors)||0)+1),new Map());
    L.push("  テクスチャの色数: "+[...by].map(([k,v])=>`${k}色×${v}`).join("  "));
  }
  if(s.bones) L.push(...boneLines(s.bones).map(x=>"  "+x));
  // キャラクターのモデルが読めているかの内訳。理由の種類ごとにまとめる
  { const dg=s.other.filter(o=>o.diag);
    if(dg.length){
      const bad=dg.filter(o=>o.diag.fail>0);
      L.push(`  ── キャラクターのモデル ${dg.length}件: 全部読めた ${dg.length-bad.length}件 / 読めないものがある ${bad.length}件 ──`);
      const byKind=new Map();
      for(const o of bad) for(const w of o.diag.why){
        const k=t1WhyKind(w);
        if(!byKind.has(k)) byKind.set(k,{n:0,ex:w,files:[]});
        const v=byKind.get(k); v.n++; if(v.files.length<6) v.files.push("#"+o.e.no);
      }
      // 大きさを割り出せた命令は、その内訳を出す（推測ではなく引き算の結果）
      { const sv=new Map();
        for(const o of dg) for(const x of (o.diag.solved||[])){
          const k=`命令${x.op} は 1枚 ${x.size}バイト（頂点${x.n}個${x.nrm?"・法線あり":""}）`;
          sv.set(k,(sv.get(k)||0)+1);
        }
        for(const [k,n] of [...sv].sort((a,b)=>b[1]-a[1]))
          L.push(`    割り出した: ${k}　${n}部品で一致`);
        // 未知が2つ残ったときの、大きさの組
        for(const o of dg) for(const x of (o.diag.pairs||[])){
          const f=y=>`命令${y.op}=${y.size}B(頂点${y.n}${y.nrm?"・法線あり":""})`;
          L.push(`    組で割り出した: ${f(x.a)} ${f(x.b)}　`
            +(x.sure?"（通る読み方はこれだけ）"
                    :`（通る読み方が ${x.ways}通り。若い番号を小さいほうにする決まりで選んだ）`));
        }
        const kept=Object.keys(T1_LEARNED).sort((a,b)=>a-b);
        if(kept.length) L.push("    覚えた命令: "+kept.map(op=>
          `命令${op}=${T1_LEARNED[op].size}B(頂点${T1_LEARNED[op].n}${T1_LEARNED[op].nrm?"・法線あり":""})`).join(" "));
      }
      // 当たった「読み方」（命令4や7も頂点を入れる、など）
      { const vs=new Map();
        for(const o of dg) for(const v of (o.diag.vars||[])) vs.set(v,(vs.get(v)||0)+1);
        for(const [k,n] of [...vs].sort((a,b)=>b[1]-a[1]))
          L.push(`    当たった読み方: ${k}　${n}部品で一致`);
        if(T1_VAR_FOUND) L.push(`    覚えた読み方: ${t1VarName(T1_VAR_FOUND)}`); }
      for(const [k,v] of [...byKind].sort((a,b)=>b[1].n-a[1].n)){
        L.push(`    ${v.n}件: ${k}`);
        L.push(`      例: ${v.ex}　（${v.files.join(" ")}）`);
      }
      // 読めなかった部品を「数えるだけ」で調べた結果。
      // 頂点の数と入れる命令の合計が合わないなら、入れる命令を見落としている
      { const au=[];
        for(const o of bad) for(const a of (o.diag.audit||[]))
          if(au.length<6) au.push(`      #${o.e.no} ${a}`);
        if(au.length){ L.push("    読めなかった部品の数え上げ:"); L.push(...au) } }
      for(const o of bad.slice(0,12))
        L.push(`    #${o.e.no} sector ${o.e.sector}　部品${o.diag.parts}個中 読めた${o.diag.run}個`);
      if(bad.length>12) L.push(`    …ほか ${bad.length-12}件`);
    } }
  // 以下は一覧。毎回同じで長いので、ふだんは出さない
  if(typeof repLong==="function"&&!repLong()){
    L.push("  （モデルの一覧・生のバイト列は「実行ファイルや生の中身まで出す」を入れると出ます）");
    return L;
  }
  const sig=s.other.filter(o=>o.words&&o.words[0]===0x90000000);
  if(sig.length){
    L.push(`  ── モデルの署名 0x90000000 があるもの: ${sig.length}件 ──`);
    for(const o of sig.slice(0,24))
      L.push(`  #${String(o.e.no).padStart(4)} sector ${String(o.e.sector).padStart(6)} 展開後 ${String(o.dec).padStart(7)} 語1=${hex(o.words[1],4)} [${o.parts.length>60?o.parts.slice(0,60)+"…":o.parts}]`);
    if(sig.length>24) L.push(`    …ほか ${sig.length-24} 件`);
  }
  L.push("  ── テクスチャ以外（モデルの候補） ──");
  L.push("  番号 / sector / ファイル / 展開後 / 部分 / 先頭24バイト / 語0..7");
  for(const o of s.other.slice(0,40)){
    L.push(`  #${String(o.e.no).padStart(4)} ${String(o.e.sector).padStart(7)} ${String(o.e.size).padStart(8)} ${String(o.dec).padStart(8)} [${o.parts}]`);
    L.push(`        ${o.head}`);
    L.push(`        ${o.words.map(w=>hex(w)).join(" ")}`);
  }
  if(s.other.length>40) L.push(`  …ほか ${s.other.length-40} 件`);
  if(s.broken.length) L.push("  読めなかったもの: "+s.broken.slice(0,10).map(b=>`#${b.e.no}(${b.why})`).join(" "));
  return L;
}

// ============================================================
//  小さいファイルの中身をそのまま読む
//  先頭24バイトだけ出していたので「小さい数が並んでいる」までしか
//  分からなかった。区切りも本数も、全部見ないと決まらない
// ============================================================

// ============================================================
//  アニメーションのデータを、周期から探す
//  静止ポーズという独立したデータは無く、位置の一部は形に焼き込まれ、
//  残りは毎フレームの角度で与えられる——という読みで進める。
//  だとすると探すのは「骨格ファイル」ではなく「角度の列」。
//
//  角度の列には、形から分かる特徴がある：
//  1フレームぶんの長さ（刻み）だけ離れたバイトは、よく似ている。
//  隣のフレームで関節の角度が大きく変わることは無いから。
//  そこで、刻みを変えながら「刻みだけ離れたバイトの差」を測る。
//  いちばん小さくなった刻みが、1フレームの長さ
// ============================================================

// ============================================================
//  外側の命令列らしいファイルを探す
//  外側の命令列は u32 の並びで、24より小さい値が命令、
//  それ以外は番地や個数。だから「小さい値がたくさん混じる u32 の並び」
//  という形をしている。ただし表に入る値は実行時の番地なので、
//  ファイルのままでは番地は入っていないはず（そこも見る）
// ============================================================
