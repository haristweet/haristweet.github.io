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
// int16 で並べて出す。値が小さいものばかりなので16進より読みやすい
function fileI16Lines(u8,per){
  per=per||16;
  const L=[], n=u8.length>>1;
  for(let i=0;i<n;i+=per){
    const v=[];
    for(let k=i;k<Math.min(i+per,n);k++) v.push(((u8[k*2]|(u8[k*2+1]<<8))<<16>>16));
    L.push(String(i*2).padStart(4," ")+": "+v.map(x=>String(x).padStart(5," ")).join(""));
  }
  return L;
}
function fileHexLines(u8,from,to,per){
  per=per||32; const L=[];
  for(let i=from;i<Math.min(to,u8.length);i+=per)
    L.push(String(i).padStart(4," ")+": "
      +Array.from(u8.subarray(i,Math.min(i+per,to,u8.length)),
        v=>v.toString(16).padStart(2,"0")).join(" "));
  return L;
}
// 先頭が「増えていく位置の並び」なら、その区切りでばらして中身を見る。
// #71 の先頭 4,24,40,56,64,80 がそれに見えた
function fileBlockRead(raw){
  if(!raw||raw.length<16) return null;
  const dv=new DataView(raw.buffer,raw.byteOffset,raw.byteLength);
  const w=[]; for(let k=0;k<Math.min(16,raw.length>>2);k++) w.push(dv.getUint32(k*4,true));
  // 位置の並びは何語目から始まるか。w[0] が語数のこともあれば位置のこともある
  for(const start of [0,1]){
    const off=[];
    for(let k=start;k<w.length;k++){
      const v=w[k];
      if(v<=(off.length?off[off.length-1]:0)) break;
      if(v>=raw.length||v>=0x10000) break;
      off.push(v);
    }
    if(off.length<3) continue;
    // 位置の並びの直後から中身が始まっているはず
    if(off[0]<(start+off.length)*4) { off.shift(); if(off.length<3) continue }
    const blocks=off.map((o,i)=>{
      const end=i+1<off.length?off[i+1]:raw.length;
      const b=raw.subarray(o,end);
      let dec=null;
      try{ if(b.length&&b[0]===0x0b) dec=decompress(b) }catch(_){}
      return {at:o,len:end-o,c0:b.length?b[0]:-1,dec:dec?dec.length:0,
        out:dec&&dec.length<=256?dec:null,
        head:Array.from(b.subarray(0,8),v=>v.toString(16).padStart(2,"0")).join(" ")};
    });
    return {start,head:w.slice(0,start+off.length),blocks};
  }
  return null;
}
function fileBlockLines(r){
  if(!r) return ["  位置の並びには見えない"];
  const L=[`  先頭の語: ${r.head.join(", ")}（${r.start?"語0は個数らしい":"語0から位置"}）`];
  for(const b of r.blocks.slice(0,10)){
    L.push(`    位置 ${b.at} 長さ ${b.len}B`
      +(b.dec?`　圧縮されている→展開すると ${b.dec}B`:"")+`　先頭 ${b.head}`);
    // 展開できたら中身も出す。長さだけ見て「小さいから表ではない」と
    // 決めつけると、また同じ所で止まる
    // 中身は値が入っていない器だった。1行にまとめる
    if(b.out) L.push("    "+fileI16Lines(b.out,12)[0]
      +(b.out.every(v=>v===0||v===24||v===5)?"　（値が入っていない）":""));
  }
  if(r.blocks.length>10) L.push(`    …ほか ${r.blocks.length-10}件`);
  return L;
}
// 「1行いくつバイトの表か」を中身から当てる。
// 骨の表なら、どこかの列に「親の番号（自分より小さい／最初は-1か0）」が並ぶ
function tableRecGuess(u8){
  const out=[];
  for(const R of [4,6,8,10,12,16,20,24,28,32,36,40]){
    const n=(u8.length/R)|0;
    if(n<8||n>128) continue;
    if(u8.length%R) continue;                 // 端数が出る区切りは見ない
    for(const wid of [1,2]) for(let c=0;c+wid<=R;c+=wid){
      let ok=0, less=0, zero=0, max=-999;
      for(let i=0;i<n;i++){
        const p=i*R+c;
        const v=wid===1?(u8[p]<<24>>24):((u8[p]|(u8[p+1]<<8))<<16>>16);
        if(v>max) max=v;
        if(v>=-1&&v<n) ok++;
        if(v<i) less++;
        if(v===0) zero++;
      }
      if(ok===n&&less>=n-1&&zero<n*0.8&&max>=3)
        out.push({R,n,c,wid,zero,max});
    }
  }
  out.sort((a,b)=>b.max-a.max||a.R-b.R);
  return out;
}
function tableRecLines(g,len){
  if(!g.length) return [`  ${len}B。「親の番号らしい列」は見つからない`];
  const L=[`  ${len}B。親の番号らしい列の候補:`];
  for(const x of g.slice(0,4))
    L.push(`    1行 ${x.R}B×${x.n}行 の ${x.c}バイト目`
      +`（${x.wid===1?"1バイト":"int16"}・最大 ${x.max}・0が ${x.zero}個）`);
  return L;
}
function eqBytes(a,b){
  if(!a||!b||a.length!==b.length) return false;
  for(let i=0;i<a.length;i++) if(a[i]!==b[i]) return false;
  return true;
}

// int16 が3つ組の並び（面の頂点番号の列）に見えるか。
// 同じ番号3つの組は「埋め草の面」で、固定長の表ではよく使われる
function indexTripleLines(u8,name){
  const n=(u8.length/6)|0;
  if(n<4||u8.length%6) return [`  ${name}: 3つ組では割り切れない（${u8.length}B）`];
  let same=0, max=-1, rise=0, rep=0, prev=null, prev3=null;
  for(let i=0;i<n;i++){
    const v=[0,1,2].map(k=>{ const p=i*6+k*2; return (u8[p]|(u8[p+1]<<8))<<16>>16 });
    if(v[0]===v[1]&&v[1]===v[2]) same++;
    // 「同じ番号が3つ」ではなく「同じ組がそのまま繰り返される」ことがある。
    // 93 95 94 が12回続くのがそれで、前の数え方では拾えていなかった
    if(prev3&&v[0]===prev3[0]&&v[1]===prev3[1]&&v[2]===prev3[2]) rep++;
    for(const x of v) if(x>max) max=x;
    if(prev!==null&&v[0]>=prev) rise++;
    prev=v[0]; prev3=v;
  }
  return [`  ${name}: 3つ組として ${n}組　同じ番号3つ ${same}組　`
    +`前の組とそっくり同じ ${rep}組　いちばん大きい番号 ${max}　先頭が増えていく組 ${rise}/${n-1}`
    +(same+rep>=n*0.2
        ? "　→ 同じ組を何度も指す固定長の表。"
          +"面の3頂点に何かを貼り付ける表（当たり判定など）らしい。骨の親子ではない"
        : "　→ 埋め草が少ない。固定長の表とは言い切れない")];
}

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
function animStrideScan(u8,opt){
  const o=opt||{}, cap=Math.min(u8.length,o.cap||4096);
  const min=o.min||8, max=Math.min(o.max||288,(cap>>2));
  if(cap<min*4) return null;
  // 0だらけのところは、どの刻みでも差が0になる。中身のあるぶんだけ見る
  let nz=0; for(let i=0;i<cap;i++) if(u8[i]) nz++;
  if(nz<cap*0.25) return {flat:true,nz:nz/cap};
  // ものさし。離れた所どうしの差の平均（ここまで小さければ意味がある、の基準）
  let base=0,bn=0;
  for(let i=0;i+1<cap;i++){ base+=Math.abs(u8[i]-u8[(i*7+13)%cap]); bn++ }
  base=bn?base/bn:0;
  if(base<4) return {flat:true,nz:nz/cap};       // そもそも変化が無い
  const out=[];
  for(let S=min;S<=max;S++){
    let sum=0,n=0;
    for(let i=0;i+S<cap;i++){ sum+=Math.abs(u8[i+S]-u8[i]); n++ }
    if(n<64) continue;
    out.push({S,score:(sum/n)/base});
  }
  if(!out.length) return null;
  out.sort((a,b)=>a.score-b.score);
  // 短いものは、どの刻みでも比べる回数が足りず、たまたま小さい値が出る。
  // 564バイトで「124バイト刻み」と言われても、4回ぶんしか見ていない
  const short=cap<1024;
  // 刻みの倍数は当然よく似る。いちばん小さい刻みを残す
  const keep=[];
  for(const x of out){
    // 0.64 や 0.71 は「隣のバイトが少し似ている」だけで、どんな並びでも出る。
    // 1フレームぶんの繰り返しなら、はっきり小さくなる。
    // 刻みが10バイトでは骨30本ぶんにならないので、下も切る
    if(x.score>0.5||x.S<16) continue;
    if(keep.some(k=>x.S%k.S===0)) continue;
    keep.push(x); if(keep.length>=3) break;
  }
  return {base,nz:nz/cap,short,len:cap,best:keep,all:out.slice(0,3)};
}
function animStrideLine(r,name){
  if(!r) return `  ${name}: 短すぎて測れない`;
  if(r.flat) return `  ${name}: 中身がほとんど 0（${Math.round(r.nz*100)}%）。角度の列ではない`;
  if(r.short)
    return `  ${name}: 短すぎて当てにならない（${r.len}バイトでは繰り返しが数回しか無い）`
      +(r.best.length?`　参考までに ${r.best[0].S}バイト(${r.best[0].score.toFixed(2)})`:"");
  if(!r.best.length)
    return `  ${name}: 繰り返す刻みは見つからない`
      +`（いちばん近くて ${r.all[0].S}バイト・${r.all[0].score.toFixed(2)}）`;
  return `  ${name}: 1フレームらしい刻み `
    +r.best.map(x=>`${x.S}バイト(${x.score.toFixed(2)})`).join(" ")
    +"　"+animStrideMean(r.best[0].S);
}
// 骨30本。角度が1バイトなら 30×3＝90、int16 なら 180
function animStrideMean(S){
  const n=[[90,"骨30本×角度3つ(1バイト)"],[180,"骨30本×角度3つ(int16)"],
           [60,"骨30本×2"],[30,"骨30本×1"],[120,"骨30本×4"],
           [96,"骨32本×3"],[192,"骨32本×3(int16)"]];
  for(const [v,t] of n) if(S===v) return "→ "+t;
  for(const [v,t] of n) if(S%v===0) return `→ ${t} の ${S/v}倍`;
  if(S%3===0) return `→ 3で割ると ${S/3}（角度3つなら骨 ${S/3}本）`;
  return "";
}

// ============================================================
//  外側の命令列らしいファイルを探す
//  外側の命令列は u32 の並びで、24より小さい値が命令、
//  それ以外は番地や個数。だから「小さい値がたくさん混じる u32 の並び」
//  という形をしている。ただし表に入る値は実行時の番地なので、
//  ファイルのままでは番地は入っていないはず（そこも見る）
// ============================================================
function scriptShape(u8){
  const n=u8.length>>2; if(n<16) return null;
  const dv=new DataView(u8.buffer,u8.byteOffset,u8.byteLength);
  let small=0, ram=0, zero=0, big=0;
  for(let k=0;k<n;k++){
    const v=dv.getUint32(k*4,true);
    if(v===0) zero++;
    else if(v<24) small++;
    else if(v>=0x80000000&&v<0x80800000) ram++;
    else if(v>=0x01000000) big++;
  }
  // 0 を「小さい値」に数えていたので、0が並ぶだけのファイルが
  // 「外側の命令列らしい」になってしまった（#105 がそれ）。
  // 命令そのもの（1〜23）がどれだけあるかで見る
  const live=n-zero;
  return {n,small,ram,zero,big,live,
          ratio:live?small/live:0};
}
function scriptShapeLine(r,name){
  if(!r) return `  ${name}: 短すぎて見られない`;
  return `  ${name}: u32 ${r.n}個中　24より小さい ${r.small}個／0 ${r.zero}個`
    +`／RAMの番地らしい ${r.ram}個／大きい値 ${r.big}個`
    +(r.small>=8&&r.ratio>=0.3&&r.big<r.n*0.2
        ?"　→ 外側の命令列らしい"
        :r.small===0?"　→ 命令らしい小さい値が一つも無い。外側の命令列ではない":"");
}
