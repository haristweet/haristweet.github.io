// ---- 実行中のメモリを読む ----
// ここまでの探索は「実行ファイルにどう書かれているか」を追うものだったが、骨の表は
// 実行時にしか存在しない。プレステのメモリの写し（DuckStation のセーブステートなど）
// を直接読めば、表そのものが取れる。
// 写しの形式は決め打ちしない。実行ファイルの中身そのものを手がかりに、
// 写しの中で RAM がどこから始まるかを探す（0x80010000 は RAM の 0x10000 にあるはず）
const PSX_RAM=0x200000, PSX_TEXT=0x10000;
// 実行ファイルの先頭は起動後に書き換わっていることがあるので、手がかりを何か所か試す。
// exe の +0x800 が RAM の 0x10000 にあたるので、そこからのずれをそのまま使う
const RAM_NEEDLES=[0x800,0x10800,0x20800,0x40800,0x60800];
// 64バイト一致しただけでは、たまたま同じ並びの別の場所かもしれない。
// 先頭を仮に決めたら、実行ファイルの中身を何か所も突き合わせて確かめる。
// 起動後に書き換わる場所もあるので、100% は求めず、割合で見る
function memBaseScore(buf,base,exe){
  if(base<0||base+PSX_TEXT+0x1000>buf.length) return 0;
  let same=0, seen=0;
  for(let at=0x800;at+256<=exe.length&&at<0x100000;at+=0x2000){
    const q=base+PSX_TEXT+(at-0x800);
    if(q+256>buf.length) break;
    for(let k=0;k<256;k++){ seen++; if(buf[q+k]===exe[at+k]) same++ }
  }
  return seen?same/seen:0;
}
// 一致した場所を全部拾って、いちばん確からしいものを選ぶ
function findPsxRamAll(buf,exe){
  if(!buf||!exe||exe.length<0x900||buf.length<0x1000) return [];
  const out=[], seen=new Set();
  for(const at of RAM_NEEDLES){
    if(at+64>exe.length) continue;
    const need=exe.subarray(at,at+64);
    const ramOff=PSX_TEXT+(at-0x800);
    const last=buf.length-need.length;
    for(let p=0;p<=last;p++){
      if(buf[p]!==need[0]) continue;
      let hit=true;
      for(let k=1;k<need.length;k++) if(buf[p+k]!==need[k]){ hit=false; break }
      if(!hit) continue;
      const base=p-ramOff;
      if(base<0||base+0x100000>buf.length) continue;
      if(seen.has(base)) continue;
      seen.add(base);
      out.push({base,score:memBaseScore(buf,base,exe)});
    }
  }
  out.sort((a,b)=>b.score-a.score);
  return out;
}
function findPsxRam(buf,exe){
  const all=findPsxRamAll(buf,exe);
  return all.length?all[0].base:-1;
}
// ---- 圧縮されたセーブステートをほどく ----
// DuckStation は既定でセーブステートを圧縮する。ブラウザが自前でほどけるのは
// deflate/gzip だけなので、それらを試し、zstd のときは正直にそう言う
const MEM_MAGIC=[
  {sig:[0x28,0xb5,0x2f,0xfd],name:"zstd"},
  {sig:[0x04,0x22,0x4d,0x18],name:"LZ4"},
  {sig:[0x1f,0x8b],name:"gzip"},
  {sig:[0x78,0x01],name:"zlib"},{sig:[0x78,0x9c],name:"zlib"},{sig:[0x78,0xda],name:"zlib"},
];
function memFindMagic(buf,limit){
  const out=[], last=Math.min(buf.length,limit||0x40000);
  for(let p=0;p<last;p++) for(const m of MEM_MAGIC){
    let hit=true;
    for(let k=0;k<m.sig.length;k++) if(buf[p+k]!==m.sig[k]){ hit=false; break }
    if(hit){ out.push({at:p,name:m.name}); if(out.length>=8) return out }
  }
  return out;
}
async function memInflate(buf,start,fmt){
  if(typeof DecompressionStream!=="function") return null;
  try{
    const ds=new DecompressionStream(fmt), w=ds.writable.getWriter();
    w.write(buf.slice(start)).catch(()=>{}); w.close().catch(()=>{});
    const rd=ds.readable.getReader(), parts=[]; let n=0;
    try{ for(;;){ const {done,value}=await rd.read(); if(done) break;
      parts.push(value); n+=value.length; if(n>0x900000) break } }catch(_){}   // 途中で切れても拾う
    if(n<0x100000) return null;
    const out=new Uint8Array(n); let o=0;
    for(const q of parts){ out.set(q,o); o+=q.length }
    return out;
  }catch(_){ return null }
}
// DuckStation のセーブステートかどうかを見る。先頭が "DUCC"
function memDuckHeader(buf){
  if(buf.length<8||buf[0]!==0x44||buf[1]!==0x55||buf[2]!==0x43||buf[3]!==0x43) return null;
  const dv=new DataView(buf.buffer,buf.byteOffset,buf.byteLength);
  let title="";
  try{ const t=buf.subarray(8,8+128), z=t.indexOf(0);
       title=new TextDecoder("utf-8").decode(z>=0?t.subarray(0,z):t) }catch(_){}
  return {version:dv.getUint32(4,true),title};
}
// 写しをそのまま読めなければ、ほどいてから読む
async function memPrepare(buf,exe){
  if(findPsxRam(buf,exe)>=0) return {buf,note:""};
  const mags=memFindMagic(buf,0x200000);
  const starts=[0,...mags.filter(m=>m.name==="zlib"||m.name==="gzip").map(m=>m.at)];
  for(const fmt of ["deflate","gzip","deflate-raw"])
    for(const st of starts.slice(0,16)){
      const out=await memInflate(buf,st,fmt);
      if(out&&findPsxRam(out,exe)>=0) return {buf:out,note:`（+0x${st.toString(16)} から ${fmt} でほどきました）`};
    }
  return {buf,note:"",mags};
}
function memReader(buf,base){
  const dv=new DataView(buf.buffer,buf.byteOffset,buf.byteLength);
  const off=a=>base+((a>>>0)&0x1fffff);
  const inside=a=>{ const o=off(a); return o>=0&&o+4<=buf.length };
  return {
    base,
    u8:a=>inside(a)?buf[off(a)]:0,
    u32:a=>inside(a)?dv.getUint32(off(a),true):0,
    bytes:(a,n)=>inside(a)?buf.subarray(off(a),Math.min(off(a)+n,buf.length)):new Uint8Array(0),
    // プレステの RAM を指すまともなポインタか
    ptr:a=>{ const v=a>>>0; return (v>=0x80010000&&v<0x80200000)||(v>=0x00010000&&v<0x00200000) },
  };
}
// 写したファイル**全体**を、32バイトの行列の並びで掃く。
//
// RAM だけを見ていたが、スクラッチパッド（PS1 内蔵の高速1KB）に
// 置かれている可能性を外から指摘された。30骨×32バイト＝960バイトで、
// 1KB にちょうど収まる。だが RAM の中だけ探していては見つからない。
//
// さらに、こちらの判定そのものも疑う必要があった。
// 「直交して長さ4096」で探していたので、拡大縮小が混ざった行列は
// 全部落としていた。形だけ（int16×9 が ±4200・詰め物が0・
// 移動が ±30000）でも探す。
//
// 実物のセーブステート（4,013,806バイト）では、どちらの探し方でも
// 並びが見つからなかった。数学で0件、形だけで拾ったものは
// 255 や 511 が並ぶ埋め草だけだった
function memMatrixRunsAll(buf,opt){
  const dv=new DataView(buf.buffer,buf.byteOffset,buf.byteLength);
  const loose=opt&&opt.loose;
  const fit=o=>{
    if(o+32>buf.length) return false;
    const m=[]; for(let i=0;i<9;i++) m.push(dv.getInt16(o+i*2,true));
    if(loose){
      let mx=0; for(const v of m) mx=Math.max(mx,Math.abs(v));
      if(mx>4200||mx<100) return false;
      if(dv.getInt16(o+18,true)!==0) return false;
      for(let k=0;k<3;k++) if(Math.abs(dv.getInt32(o+20+k*4,true))>30000) return false;
      return true;
    }
    const rows=[m.slice(0,3),m.slice(3,6),m.slice(6,9)];
    const ns=rows.map(r=>r[0]*r[0]+r[1]*r[1]+r[2]*r[2]);
    const mn=Math.min(...ns), mx=Math.max(...ns);
    if(mn<2500*2500||mx>5800*5800) return false;
    if(mx-mn>mn*0.10) return false;
    for(let i=0;i<3;i++) for(let j=i+1;j<3;j++){
      let dot=0; for(let k=0;k<3;k++) dot+=rows[i][k]*rows[j][k];
      if(Math.abs(dot)>mn*0.10) return false;
    }
    return true;
  };
  const runs=[];
  for(let o=0;o+32<=buf.length;){
    if(!fit(o)){ o+=4; continue }
    const s=o; let n=0;
    while(o+32<=buf.length&&fit(o)){ n++; o+=32 }
    if(n>=(opt&&opt.min||4)) runs.push({at:s,n});
    o=s+4;
  }
  // 途中から始まる並びも拾うために 4バイトずつ戻して探すので、
  // 長い並びの中に短い並びが入れ子で出てくる。包まれているものは落とす
  runs.sort((a,b)=>b.n-a.n);
  const keep=[];
  for(const r of runs){
    const e=r.at+r.n*32;
    if(keep.some(k=>r.at>=k.at&&e<=k.at+k.n*32)) continue;
    keep.push(r);
  }
  return keep;
}
function memMatrixRunsAllLines(buf,base){
  const L=[];
  for(const [nm,opt] of [["きちんとした回転として",{}],["形だけで",{loose:true}]]){
    const r=memMatrixRunsAll(buf,opt);
    if(!r.length){ L.push(`  写し全体を ${nm}掃いた: 32バイトの並びは 0件`); continue }
    L.push(`  写し全体を ${nm}掃いた: ${r.length}件　いちばん長いもの:`);
    for(const x of r.slice(0,3)){
      const inRam=base>=0&&x.at>=base&&x.at<base+0x200000;
      L.push(`    ${inRam?"RAM "+hex(0x80000000+x.at-base):"ファイル +0x"+x.at.toString(16)}　${x.n}個`);
    }
  }
  return L;
}
// メモリの写しの中で RAM の先頭を見つける、もう一つのやり方。
//
// 実行ファイルと突き合わせる方法は、実行ファイルが要る。
// だが命令5の処理のバイト列は分かっているので、それを探せばいい。
// 実物のセーブステートでは 0x31B93（4の倍数ですらない）だった。
// 決め打ちの刻みで探すと見落とす
const MEM_CODE_ANCHOR={addr:0x8001F44C,
  words:[0x3c08800d,0x8d08be90,0x3c09800d,0x8d29be8c]};
function memFindBaseByCode(buf){
  const A=MEM_CODE_ANCHOR;
  const pat=new Uint8Array(A.words.length*4), pv=new DataView(pat.buffer);
  A.words.forEach((w,i)=>pv.setUint32(i*4,w>>>0,true));
  for(let i=0;i+pat.length<=buf.length;i++){
    if(buf[i]!==pat[0]) continue;
    let ok=true;
    for(let k=1;k<pat.length;k++) if(buf[i+k]!==pat[k]){ ok=false; break }
    if(ok) return i-((A.addr-0x80000000)&0x1fffff);
  }
  return -1;
}
// DuckStation のセーブステートから CPU のレジスタを読む。
// "CPU" の印の少し先に 32本が並んでいる。並びが正しいかは
// 0番が 0、28番($gp)がまともなポインタ、で確かめる
const MEM_REG=["zero","at","v0","v1","a0","a1","a2","a3","t0","t1","t2","t3",
  "t4","t5","t6","t7","s0","s1","s2","s3","s4","s5","s6","s7","t8","t9",
  "k0","k1","gp","sp","fp","ra"];
function memCpuRegs(buf){
  const dv=new DataView(buf.buffer,buf.byteOffset,buf.byteLength);
  const tag=[0x43,0x50,0x55];                    // "CPU"
  for(let i=0;i+3<buf.length;i++){
    if(buf[i]!==tag[0]||buf[i+1]!==tag[1]||buf[i+2]!==tag[2]) continue;
    for(const skip of [16,20,24,12,8]){
      const at=i+3+skip;
      if(at+32*4>buf.length) continue;
      const r=[]; for(let k=0;k<32;k++) r.push(dv.getUint32(at+k*4,true));
      // $sp は実物で 0x807FFF60 だった。2MB決め打ちの範囲では外れる
      // （プレステの RAM は上のほうに鏡像があり、$sp はそちらを指すことがある）
      const ptr=v=>(v>>>0)>=0x80000000&&(v>>>0)<0x80800000;
      if(r[0]===0&&ptr(r[28])&&ptr(r[29])) return {at,r};
    }
  }
  return null;
}
function memCpuLines(buf){
  const c=memCpuRegs(buf);
  if(!c) return ["  CPU のレジスタは読めなかった"];
  const L=[`  CPU のレジスタ（写した瞬間の値）:`];
  const show=["gp","sp","ra","s0","s1","s2","s3","s4","s5","s6","s7","fp"];
  L.push("    "+show.map(n=>`$${n}=${hex(c.r[MEM_REG.indexOf(n)])}`).join(" "));
  const live=["s0","s1","s2","s3","s4","s5","s6","s7"]
    .filter(n=>c.r[MEM_REG.indexOf(n)]!==0).length;
  L.push(live>=4
    ? `    → $s0〜$s7 のうち ${live}本が生きている。モデルを描いている最中の写しかもしれない`
    : `    → $s0〜$s7 がほとんど 0。モデルを描いている最中ではない`);
  return L;
}
// 表のポインタから**後ろ向きに**たどる。
//
// ここが穴だった。表A・表Bのポインタは、命令5が来るたびに
//   0x8001f464  addiu $t0, $t0, 4
//   0x8001f478  sw    $t0, -16752($at)
// と +4 して書き戻される。1フレーム描き終わった時点のメモリを見ると、
// ポインタは**表の終端**を指している。前向きに読んでも、そこにはもう何も無い。
// 直前に使われた骨は、ポインタの**手前**に並んでいる。
//
// 32バイトの行列を探してメモリを掃いていたときは、そもそも
// 「表はポインタの配列」だと気づいていなかった。いまは番地が分かっているので、
// 探索は要らない。読んで、後ろ向きにたどるだけ
function memBonesBack(buf,base,addr,n){
  const R=memReader(buf,base);
  const cur=R.u32(addr);
  if(!R.ptr(cur)) return {cur,ok:false,list:[]};
  const list=[];
  for(let k=1;k<=(n||64);k++){
    const at=(cur-k*4)>>>0;
    const p=R.u32(at);
    if(p===0){ list.push({at,p,why:"空"}); continue }
    if(!R.ptr(p)) break;                       // ポインタでなくなったら表の外
    const b=R.bytes(p,32);
    if(b.length<32) break;
    const dv=new DataView(b.buffer,b.byteOffset,b.byteLength);
    const m=[]; for(let i=0;i<9;i++) m.push(dv.getInt16(i*2,true));
    const t=[dv.getInt32(20,true),dv.getInt32(24,true),dv.getInt32(28,true)];
    list.push({at,p,m,t,ok:matrixOK({m,t})});
  }
  // 表の先頭より手前は 0 なので、そこまで遡ったぶんは落とす。
  // 逆順にすると、この 0 が先頭に並んでしまう（並べ替えの後ろが端になる）。
  // 表の途中の 0 は「骨なし」として意味があるので、端だけ落とす
  while(list.length&&list[list.length-1].why) list.pop();
  return {cur,ok:true,list:list.reverse()};
}
function memBonesBackLines(buf,base){
  const L=[];
  for(const [nm,a] of [["表B",0x800CBE8C],["表A",0x800CBE90]]){
    const r=memBonesBack(buf,base,a,48);
    if(!r.ok){ L.push(`  ${nm} ${hex(a)}: 中身 ${hex(r.cur)} はポインタに見えない`); continue }
    const good=r.list.filter(x=>x.ok).length;
    L.push(`  ${nm} ${hex(a)}: いまの位置 ${hex(r.cur)}　手前に ${r.list.length}件`
      +`（回転として筋が通るもの ${good}件）`);
    for(const x of r.list.slice(0,6)){
      if(x.why){ L.push(`    ${hex(x.at)} → 空`); continue }
      L.push(`    ${hex(x.at)} → ${hex(x.p)} ${x.ok?"○":"×"}`
        +`　回転 ${x.m.join(",")}　移動 ${x.t.join(",")}`);
    }
  }
  return L.length?L:["  後ろ向きにたどれませんでした"];
}
const MEM_TABLES=[["表B",0x800CBE8C],["表A（命令5が引く）",0x800CBE90],["表C（部品）",0x800CBE94]];
// 表の中身を並べ、その先が行列として読めるかまで確かめる
function memBoneLines(buf,exe){
  const L=[];
  // まず実行ファイルと突き合わせる。だめなら命令5の処理のバイト列から探す。
  // 実物のセーブステートでは先頭が 0x31B93（4の倍数ですらない）だった
  // 候補を並べて、表B・表Cの先まで確かめてから決める
  const pick=memPickBase(buf,exe);
  let base=pick.base;
  if(base>=0&&pick.tried.length>1)
    L.push(`RAM の先頭を +0x${base.toString(16)} に決めました（${pick.why}）`);
  if(base<0){
    L.push("メモリの写しの中に実行ファイルが見つかりませんでした。");
    L.push(`  ファイルの大きさ: ${buf.length} B（プレステの RAM は 2,097,152 B）`);
    L.push("  先頭64バイト: "+Array.from(buf.subarray(0,64),v=>v.toString(16).padStart(2,"0")).join(" "));
    L.push("  読める字: "+Array.from(buf.subarray(0,64),v=>(v>=32&&v<127)?String.fromCharCode(v):".").join(""));
    const dk=memDuckHeader(buf);
    if(dk){
      L.push(`  DuckStation のセーブステートです（版 ${dk.version}、題名「${dk.title}」）`);
      if(buf.length<PSX_RAM)
        L.push(`  ファイルが RAM より小さい（${buf.length} < ${PSX_RAM}）ので、中身は確実に圧縮されています`);
    }
    const mags=memFindMagic(buf,0x200000);
    if(mags.length) L.push("  見つかった圧縮の印: "+mags.slice(0,8).map(m=>`${m.name}@+0x${m.at.toString(16)}`).join(" "));
    L.push("");
    L.push("  【直し方】DuckStation の設定 → 詳細（Advanced）に「セーブステートの圧縮」");
    L.push("    （Save State Compression）があります。ここを次のどちらかにして、");
    L.push("    セーブステートを作り直してください:");
    L.push("      ・Deflate / zlib  … このページがほどけます（おすすめ）");
    L.push("      ・なし / Uncompressed … ファイルが 2MB を超えればそのまま読めます");
    L.push("    ※ zstd（既定）はブラウザがほどけないので、これだけは読めません。");
    return L;
  }
  L.push(`メモリの写しを読みました（RAM の先頭は ファイルの +0x${base.toString(16)}）`);
  // 区画ごとに分けて持つ。1本の流れにして「先頭N行だけ」で切ると、
  // 先に出るものが枠を使い切って、あとから足したものが落ちる（6回やった）
  const P={head:[`メモリの写しを読みました（RAM の先頭は ファイルの +0x${base.toString(16)}）`]};
  if(typeof state==="object"&&state) state.memParts=P;
  const put=(k,lines)=>{ P[k]=(P[k]||[]).concat(lines); L.push(...lines) };
  const M=memReader(buf,base);
  const hx=(a,n)=>Array.from(M.bytes(a,n),v=>v.toString(16).padStart(2,"0")).join(" ");
  put("cpu",memCpuLines(buf));
  // ふるいにかけずに、行列の積み場所をそのまま出す。
  // 条件で掃いて0件だったので、条件のほうを疑う
  // 表Bをたどって、本物の骨を取り出す。取れたらそれを使う（推測はもう要らない）
  try{
    const rb=memRealBones(buf,base);
    if(typeof state==="object"&&state) state.realBones=rb;
    put("bones",memRealBoneLines(rb));
    // 表Bが指す行列はカメラを掛けたあとの姿（横に0.8倍の歪みが入っている）。
    // 番号の列に直して、掛ける前の並びに当てる
    const bb=memBestBones(buf,base);
    if(typeof state==="object"&&state) state.bestBones=bb;
    put("best",memBestBoneLines(bb));
    // いま描かれているモデルが、ディスクのどのファイルかを決める。
    // 骨の本数と区切りの数が合わないのは、別のキャラを見ていたからかもしれない。
    // 推測でそう言うのをやめて、突き合わせて決める
    try{
      const dm=memDrawnModel(buf,base);
      if(typeof state==="object"&&state) state.drawnModel=dm;
      put("drawn",memDrawnModelLines(dm,typeof state==="object"&&state?state.sieve:null));
    }catch(err){ L.push("  描かれているモデルが決められませんでした: "+err.message) }
    // 番号が大きく飛んでいる所（別の枝）と、2つの配列のあいだを、そのまま出す
    try{ put("jump",memBoneJumpLines(buf,base)) }catch(err){ put("jump",["  番号の列が出せない: "+err.message]) }
    try{ put("gap",memGapLines(buf,base)) }catch(err){ put("gap",["  あいだが出せない: "+err.message]) }
    const use=(bb&&bb.list)||rb.list;
    if(use&&use.length&&typeof t1SetBones==="function") t1SetBones(use,true);
  }catch(err){ L.push("  本物の骨が取れませんでした: "+err.message) }
  // まとめへは、ふるい（正規表現）を通さずにそのまま渡す。
  // 言葉で拾う仕掛けにしていたので、生ダンプの行が全部落ちていた（5度目）
  try{ const sl=memStackLines(buf,base);
       if(typeof state==="object"&&state) state.memStack=sl;
       put("stack",sl) }
  catch(err){ const e=["  行列の積み場所が読めませんでした: "+err.message];
              if(typeof state==="object"&&state) state.memStack=e;
              L.push(...e) }
  // RAM だけでなく、写したファイル全体を掃く（スクラッチパッドもこの中にある）
  L.push(...memMatrixRunsAllLines(buf,base));
  // モデルがいくつ載っているか。0x90000000 の署名で数える
  { const hits=[];
    for(let o=0;o+4<=Math.min(buf.length-base,0x200000);o+=4){
      if(buf[base+o]===0&&buf[base+o+1]===0&&buf[base+o+2]===0&&buf[base+o+3]===0x90)
        hits.push(0x80000000+o);
      if(hits.length>=16) break;
    }
    L.push(hits.length
      ? `  メモリに載っているモデル ${hits.length}件: `+hits.map(hex).join(" ")
      : "  メモリにモデルの署名（0x90000000）は無い");
  }
  // 表のポインタは命令5のたびに +4 されて書き戻されるので、
  // 描き終わったあとの写しでは**終端**を指している。
  // 直前に使われた骨は手前に並んでいるので、後ろ向きにたどる
  L.push("  表のポインタから後ろ向きにたどった結果:");
  L.push(...memBonesBackLines(buf,base));
  L.push(`  旗 0x800CBE88 = ${M.u8(0x800CBE88)}`);
  L.push("  0x800CBE80 のあたり: "+hx(0x800CBE80,32));
  for(const [name,addr] of MEM_TABLES){
    const p=M.u32(addr);
    L.push(`  ${name} 0x${addr.toString(16).toUpperCase()} → 0x${p.toString(16).toUpperCase()}`
      +(M.ptr(p)?"":"（メモリの外。描画が終わったあとの写しだとこうなる）"));
    if(!M.ptr(p)) continue;
    // 表は「進めたあと」の位置を指しているので、手前も見る
    const from=p-0x40;
    const ent=[]; for(let k=0;k<32;k++) ent.push(M.u32(from+k*4));
    L.push(`    表の中身（0x${(from>>>0).toString(16).toUpperCase()} から32件、太い区切りが今の位置）:`);
    for(let r=0;r<4;r++)
      L.push("      "+ent.slice(r*8,r*8+8).map((v,i)=>
        ((from+(r*8+i)*4)>>>0)===(p>>>0)?`[${v.toString(16).padStart(8,"0")}]`:` ${v.toString(16).padStart(8,"0")} `).join(""));
    // 表の先を辿って、行列として読めるかを確かめる
    let tried=0;
    for(const e of ent){
      if(tried>=3||!M.ptr(e)) continue;
      tried++;
      const blk=M.bytes(e,32*16);
      const b=blk.length>=64?boneScanBest(blk):null;
      L.push(`    0x${e.toString(16).toUpperCase()} の先: `
        +(b?`行列${b.n}個のうち ${b.good}個が回転として筋が通る（持ち方 ${b.form.size}B）`:"行列としては読めない"));
      if(b&&b.good){ L.push(boneSample(b,0)); L.push(boneSample(b,1)) }
      else L.push("      生のバイト: "+Array.from(blk.subarray(0,32),v=>v.toString(16).padStart(2,"0")).join(" "));
    }
  }
  // 行列積みの現在地。ここが指す32バイトが「いま使っている行列」
  const cur=M.u32(0x800CC910);
  L.push(`  行列積みの現在地 0x800CC910 → 0x${cur.toString(16).toUpperCase()}`);
  if(M.ptr(cur)){
    const b=boneScanBest(M.bytes(cur-0x80,0x100));
    L.push("    そのあたり: "+(b?`行列${b.n}個のうち ${b.good}個が筋が通る（持ち方 ${b.form.size}B）`:"行列としては読めない"));
    L.push("    生のバイト: "+hx(cur,32));
  }
  return L;
}

// ============================================================
//  メモリの中から「骨の行列」を探す
//
//  命令5 は 0x800CBE90 の表から次の行列を引いてくる。ところがこの2つの番地は
//  描いている最中に進められるカーソルで、保存した瞬間の値はあてにならない。
//  そこで番地に頼らず、RAM 全体から
//    (1) 32バイトの行列がずらりと並んでいる場所
//    (2) 行列を指す位置がずらりと並んでいる場所（表A はこちらの形）
//  を探す。回転行列は「3本の行の長さがそろっていて互いに直角」という
//  きつい条件を満たすので、でたらめなバイト列が紛れ込むことはまずない
// ============================================================
const MEM_MIN_BONES=6;
// (1) 行列がそのまま並んでいるところ
//  32バイトずつ進めると「先頭からの距離が32の倍数」の場所しか見ない。
//  実際の並びは4バイト境界にあればよいので、それでは8か所に1か所しか見ていない。
//  まず4バイトおきに「ここから行列として読めるか」を全部印に取り、
//  そのあと 32バイト間隔でつながっているところを拾う
function memMatrixOKMap(buf){
  const dv=new DataView(buf.buffer,buf.byteOffset,buf.byteLength);
  const n=Math.max(0,(buf.length-MAT_SIZE)>>2)+1;
  const ok=new Uint8Array(n);
  for(let i=0;i<n;i++){
    const p=i<<2;
    // 全部 0 の場所は数が多いので先に落とす（速さのため）
    if(!dv.getInt16(p,true)&&!dv.getInt16(p+8,true)&&!dv.getInt16(p+16,true)) continue;
    if(matrixOK(readMatrix(dv,p,MAT_FORMS[0]))) ok[i]=1;
  }
  return ok;
}
function memMatrixRuns(buf,base,minN,okMap){
  const ok=okMap||memMatrixOKMap(buf);
  const out=[], used=new Uint8Array(ok.length);
  const step=MAT_SIZE>>2;                       // 32バイト＝4バイト枠で8つ
  for(let i=0;i<ok.length;i++){
    if(!ok[i]||used[i]) continue;
    let k=i, n=0;
    while(k<ok.length&&ok[k]){ used[k]=1; k+=step; n++ }
    if(n>=(minN||MEM_MIN_BONES)) out.push({at:(i<<2)-base,abs:i<<2,n,kind:"並び"});
  }
  return out;
}
// (2) 行列を指す位置が並んでいるところ（表A の形）
//  命令5 のコードは「0 なら飛ばす」（beq $t5,$zero）ので、表には空の骨が混ざる。
//  0 で打ち切ると、そこから先が見えなくなる。0 は「骨なし」として run に入れる
function memMatrixPtrTables(buf,base,minN){
  const dv=new DataView(buf.buffer,buf.byteOffset,buf.byteLength);
  const R=memReader(buf,base);
  const out=[]; let run=[], hits=0, start=0;
  const end=Math.min(buf.length,base+0x200000);
  const flush=()=>{
    // 末尾の空きは表の外なので落とす
    while(run.length&&run[run.length-1]<0) run.pop();
    if(hits>=(minN||MEM_MIN_BONES)&&run.length)
      out.push({at:start-base,n:run.length,hits,offs:run.slice(),kind:"位置の表"});
    run=[]; hits=0;
  };
  for(let p=base;p+4<=end;p+=4){
    const v=dv.getUint32(p,true)>>>0;
    let ok=false, off=-1;
    if(R.ptr(v)){ off=base+(v&0x1fffff);
      if(off+MAT_SIZE<=buf.length) ok=matrixOK(readMatrix(dv,off,MAT_FORMS[0])); }
    if(ok){ if(!run.length) start=p; run.push(off); hits++ }
    else if(v===0&&run.length&&run.length<256) run.push(-1);   // 空の骨
    else flush();
  }
  flush();
  return out;
}
// 見つけたところから、行列そのものを取り出す
function memBonesAt(buf,base,hit){
  const dv=new DataView(buf.buffer,buf.byteOffset,buf.byteLength);
  const list=[];
  // 空の骨（表の中の 0）は、何もしない行列として置く
  const ID={m:[4096,0,0,0,4096,0,0,0,4096],t:[0,0,0],one:4096,empty:true};
  if(hit.offs) for(const o of hit.offs)
    list.push(o<0?{m:ID.m.slice(),t:[0,0,0],one:4096,empty:true}:readMatrix(dv,o,MAT_FORMS[0]));
  else { const b=hit.abs!=null?hit.abs:base+hit.at;
         for(let k=0;k<hit.n;k++) list.push(readMatrix(dv,b+k*MAT_SIZE,MAT_FORMS[0])) }
  for(const M of list) matrixOK(M);           // 目盛り（1.0 がいくつか）を入れる
  return list;
}
// 骨の数がモデルの区切りの数に近いものを選ぶ。
// 区切りより少ない表では足りないので、まず「足りるもの」の中から、いちばん近いもの
function memPickBones(hits,segs){
  if(!hits||!hits.length) return null;
  const enough=hits.filter(h=>h.n>=segs);
  const pool=enough.length?enough:hits;
  return pool.slice().sort((a,b)=>Math.abs(a.n-segs)-Math.abs(b.n-segs)||b.n-a.n)[0];
}
// メモリから骨をさがして、結果を1行ずつにする
function memBoneHunt(buf,exe,segs){
  const all=findPsxRamAll(buf,exe);
  if(!all.length) return {base:-1,hits:[],lines:["  メモリの中に RAM の先頭が見つかりませんでした"]};
  const base=all[0].base;
  const L=[`  RAM の先頭の候補 ${all.length}件（実行ファイルとの一致率）:`];
  for(const a of all.slice(0,4))
    L.push(`    +0x${a.base.toString(16)}　一致 ${Math.round(a.score*1000)/10}%${a.base===base?"　← 使う":""}`);
  if(all[0].score<0.5)
    L.push("    ※ 一致率が低い。RAM の先頭を取り違えている見込みが高い");
  const okMap=memMatrixOKMap(buf);
  const nOK=okMap.reduce((a,b)=>a+b,0);
  L.push(`  行列として読める場所: ${nOK}か所（4バイトおきに全部当たった結果）`);
  const hits=memMatrixPtrTables(buf,base).concat(memMatrixRuns(buf,base,0,okMap));
  hits.sort((a,b)=>(b.hits||b.n)-(a.hits||a.n));
  L.push(`  メモリの中の骨さがし: ${hits.length}か所`);
  for(const h of hits.slice(0,8))
    L.push(`    ${h.kind} +0x${h.at.toString(16)}　${h.n}個${h.hits&&h.hits!==h.n?`（うち中身あり ${h.hits}個）`:""}`);
  if(!hits.length) L.push("    行列の並びは見つかりませんでした");
  // 候補ごとに行列そのものも取り出しておく。どれを使うかは「当ててみて」決める
  const cands=hits.slice(0,16).map(h=>Object.assign({},h,{list:memBonesAt(buf,base,h)}));
  return {base,hits,cands,lines:L,segs:segs||0};
}

// ============================================================
//  行列の積み場所を、ふるいにかけずにそのまま見る
//  「int16×9 が ±4200・詰め物が0・移動が ±30000」という条件で
//  写し全体を掃いたが、一つも出なかった。
//  条件のほうが間違っている可能性がある——移動は数万に達するし、
//  行列は連なって並んでいるとは限らない。
//  0x800CC910 は行列の積みの先端なので、その値が指す所を
//  条件なしで出せば、何が置いてあるか目で見える
// ============================================================
const MEM_STACK_PTR=0x800CC910;
function memMatrixAt(M,addr){
  const b=M.bytes(addr,32); if(b.length<32) return null;
  const dv=new DataView(b.buffer,b.byteOffset,b.byteLength);
  return {r:Array.from({length:9},(_,k)=>dv.getInt16(k*2,true)),
          pad:dv.getInt16(18,true),
          t:[dv.getInt32(20,true),dv.getInt32(24,true),dv.getInt32(28,true)]};
}
function memMatrixLine(m){
  if(!m) return "読めない";
  return `回転[${m.r.join(",")}] 詰${m.pad} 移動(${m.t.join(",")})`;
}
// 行列らしさを、点で言う（0〜3）。ふるいにはせず、目印として付けるだけ
function memMatrixHint(m){
  if(!m) return "";
  const h=[];
  if(m.r.every(v=>v>=-4200&&v<=4200)) h.push("回転が±4096に収まる");
  if(m.pad===0) h.push("詰め物が0");
  if(m.r.some(v=>v!==0)&&!m.r.every(v=>v===m.r[0])) h.push("回転がばらけている");
  return h.length?"　← "+h.join("・"):"";
}
function memStackLines(buf,base,opt){
  const o=opt||{}, M=memReader(buf,base), L=[];
  const sp=M.u32(MEM_STACK_PTR);
  L.push(`  行列の積みの先端 ${hex(MEM_STACK_PTR)} の中身: ${hex(sp)}`
    +(M.ptr(sp)?"（RAM を指している）":"（RAM の番地ではない）"));
  for(const [nm,a] of MEM_TABLES){
    const v=M.u32(a);
    L.push(`  ${nm} ${hex(a)} の中身: ${hex(v)}`+(M.ptr(v)?"（RAM を指している）":""));
    // 表B はポインタの並び。その先が行列として読めるか、条件なしで出す
    if(M.ptr(v)&&/表[AB]/.test(nm))
      for(let k=0;k<(o.ptrs||3);k++){
        const p=M.u32(v+k*4); if(!M.ptr(p)) break;
        L.push(`    [${k}] → ${hex(p)}　${memMatrixLine(memMatrixAt(M,p))}`);
      }
  }
  // 表が全部 0 なら、それは「描き終わったあと」の写し。
  // 番号だけ言われても次に何をすればいいか分からないので、取り方まで書く
  if(MEM_TABLES.every(([,a])=>M.u32(a)===0)){
    L.push("  表A・表B・表C が全部 0 ＝ 描き終わったあとの写しです。");
    L.push("    描いている最中の写しなら、表Bに骨の行列の並びの番地が入っています。");
    L.push("    取り方: DuckStation の設定 → 詳細 で「デバッガを有効」にし、");
    L.push("    実行ブレークは 0x8001F464 に置いてください。");
    L.push("    （0x8001F44C は表が 0 でも通ります。0x8001F45C の beq で");
    L.push("      「表Aが0なら何もせず飛ぶ」ので、その先の 0x8001F464 で止めれば、");
    L.push("      表A・表B にかならず本物の番地が入っています）");
    L.push("    止まったら、その止まったままセーブステートを保存してください。");
  }
  if(!M.ptr(sp)) return L;
  // 先端の前後を、32バイトずつそのまま出す。ふるいにはかけない
  // 手前10個を見たら 0 ばかりだった。並びはもっと広い所にある。
  // まず広く見分けてから、近くを細かく出す
  try{ L.push(...memMatrixMapLines(buf,base,sp,{back:o.back||64,fwd:o.fwd||64})) }
  catch(err){ L.push("  まわりを見分けられませんでした: "+err.message) }
  // 先端のまわりには4個しか無かった。骨は30本ある。
  // 間隔を 32 と決めつけずに、写し全体を探す
  L.push(...memMatrixStrideLines(buf,base,{min:4,top:6,show:4}));
  const n=o.n||6, aft=o.after||2, from=sp-n*32;
  L.push(`  ${hex(sp)} の前後を、そのまま32バイトずつ（手前${n}個・先${aft}個）:`);
  for(let k=0;k<n+aft;k++){
    const a=from+k*32, m=memMatrixAt(M,a);
    L.push(`    ${hex(a)}${a===sp?"←先端":"     "}　${memMatrixLine(m)}${memMatrixHint(m)}`);
  }
  return L;
}

// ============================================================
//  先端のまわりを広く見て、行列の並びを探す
//  先端 0x801E7A94 とその次に、同じ行列が入っていた：
//    回転[3276,0,0, 0,-4096,0, 0,0,-4096] 移動(0,1331,4096)
//  対角に 3276 / -4096 / -4096。4096＝1.0 なので、これは
//  「X を 0.8 倍、Y と Z を反転」——まともな行列。
//  手前10個は 0 ばかりだったので、骨30本ぶんの並びは
//  もっと広い所にある。前後を広げて、枠ごとに見分ける
// ============================================================
// 行列らしさ。回転の3行の長さが 4096 前後でそろっているか。
// 拡大縮小が入っていてもいいように、行どうしの長さの比で見る
function memMatrixLooks(m){
  if(!m) return "";
  const r=m.r;
  if(r.every(v=>v===0)) return "zero";
  if(r.some(v=>Math.abs(v)>20000)) return "no";
  const len=[0,1,2].map(i=>Math.hypot(r[i*3],r[i*3+1],r[i*3+2]));
  if(len.some(v=>v<600||v>20000)) return "no";
  const mx=Math.max(...len), mn=Math.min(...len);
  if(mx/mn>2.5) return "no";
  // 行どうしが直交しているか（回転行列なら内積はほぼ0）
  const dot=(a,b)=>r[a*3]*r[b*3]+r[a*3+1]*r[b*3+1]+r[a*3+2]*r[b*3+2];
  const od=Math.max(Math.abs(dot(0,1)),Math.abs(dot(0,2)),Math.abs(dot(1,2)));
  return od<mx*mx*0.35?"mat":"soso";
}
const MEM_MARK={zero:".",mat:"M",soso:"m",no:"x"};
function memMatrixMapLines(buf,base,addr,opt){
  const o=opt||{}, M=memReader(buf,base), L=[];
  const back=o.back||64, fwd=o.fwd||64, from=addr-back*32, n=back+fwd;
  const kinds=[];
  for(let k=0;k<n;k++) kinds.push(memMatrixLooks(memMatrixAt(M,from+k*32)));
  L.push(`  ${hex(from)} から ${n}枠（32バイトずつ）を見分けた`
    +`　M=行列らしい ${kinds.filter(x=>x==="mat").length}　`
    +`m=たぶん ${kinds.filter(x=>x==="soso").length}　`
    +`.=全部0 ${kinds.filter(x=>x==="zero").length}　`
    +`x=ちがう ${kinds.filter(x=>x==="no").length}`);
  for(let i=0;i<n;i+=64)
    L.push(`    ${hex(from+i*32)}: `
      +kinds.slice(i,i+64).map(x=>MEM_MARK[x]||"?").join(""));
  // いちばん長い「行列らしいものが続く所」を出す。骨30本ぶんならそこ
  let best=null, cur=null;
  for(let k=0;k<=n;k++){
    const ok=kinds[k]==="mat"||kinds[k]==="soso";
    if(ok){ if(!cur) cur={at:k,n:0}; cur.n++ }
    else { if(cur&&(!best||cur.n>best.n)) best=cur; cur=null }
  }
  if(best&&best.n>=2){
    L.push(`  いちばん長く続く所: ${hex(from+best.at*32)} から ${best.n}個`
      +(best.n>=20?"　→ 骨30本ぶんに近い":""));
    for(let k=0;k<Math.min(best.n,o.show||6);k++){
      const a=from+(best.at+k)*32;
      L.push(`    ${hex(a)}　${memMatrixLine(memMatrixAt(M,a))}`);
    }
  } else L.push("  行列らしいものが続く所は無い（1個ずつ散らばっている）");
  return L;
}

// ============================================================
//  写し全体から、行列の並びを「間隔を決めつけずに」探す
//
//  外からの指摘：
//    骨1本ぶんの構造体が
//      MATRIX m（32B）／ SVECTOR 角度（8B）／ VECTOR ずれ（12B）／ 子への印（4B）
//    のようになっていると、行列と行列の間隔は 32 ではなく 48 や 64 になる。
//    「32バイトきざみで連続」という探し方では、一つも引っかからない。
//
//  そのとおりだった。間隔を 32 と決めつけていた。
//  間隔のほうも探す
// ============================================================
// 写しの位置 off にある32バイトが行列らしいか。DataView を直に見る（速さのため）
function memLooksAt(dv,off){
  if(off<0||off+32>dv.byteLength) return 0;
  const r=[];
  for(let k=0;k<9;k++){ const v=dv.getInt16(off+k*2,true); if(Math.abs(v)>20000) return 0; r.push(v) }
  if(r.every(v=>v===0)) return 0;
  const len=[0,1,2].map(i=>Math.hypot(r[i*3],r[i*3+1],r[i*3+2]));
  if(len.some(v=>v<600||v>20000)) return 0;
  const mx=Math.max(...len), mn=Math.min(...len);
  if(mx/mn>2.5) return 0;
  const dot=(a,b)=>r[a*3]*r[b*3]+r[a*3+1]*r[b*3+1]+r[a*3+2]*r[b*3+2];
  const od=Math.max(Math.abs(dot(0,1)),Math.abs(dot(0,2)),Math.abs(dot(1,2)));
  return od<mx*mx*0.35?2:1;              // 2＝行列らしい 1＝たぶん
}
const MEM_STRIDES=[32,36,40,44,48,52,56,64,72,80,96,112,128];
function memMatrixStrideRuns(buf,opt){
  const o=opt||{}, dv=new DataView(buf.buffer,buf.byteOffset,buf.byteLength);
  const step=4, n=Math.max(0,(buf.length-32)/step|0);
  const ok=new Uint8Array(n+1);
  for(let i=0;i<=n;i++) ok[i]=memLooksAt(dv,i*step);
  const out=[];
  for(const S of (o.strides||MEM_STRIDES)){
    const d=S/step; if(!Number.isInteger(d)) continue;
    const seen=new Uint8Array(n+1);
    for(let i=0;i<=n;i++){
      // 「たぶん」でつなぐと、350,351,352… と滑らかに増えるだけの数値表が
      // 550個の並びとして先頭に出てしまう。はっきり行列のものだけでつなぐ
      if(ok[i]!==2||seen[i]) continue;
      let c=0, j=i;
      while(j<=n&&ok[j]===2){ seen[j]=1; c++; j+=d }
      if(c>=(o.min||4)) out.push({at:i*step,stride:S,n:c,strong:c});
    }
  }
  // 同じ所を別の間隔でも拾う。長いほうを残す
  out.sort((a,b)=>b.n-a.n||b.strong-a.strong);
  const keep=[];
  for(const x of out){
    if(keep.some(k=>x.at>=k.at&&x.at<k.at+k.n*k.stride&&x.n<=k.n)) continue;
    keep.push(x); if(keep.length>=(o.top||8)) break;
  }
  return keep;
}
function memMatrixStrideLines(buf,base,opt){
  let runs=[];
  try{ runs=memMatrixStrideRuns(buf,opt) }
  catch(err){ return ["  写し全体の走査で失敗: "+err.message] }
  if(!runs.length) return ["  写しのどこにも、行列が4個以上続く所はない"];
  const L=[`  写し全体（${buf.length}B）を 4バイトきざみ・間隔も変えて走査:`];
  const M=base>=0?memReader(buf,base):null;
  for(const r of runs){
    const ram=base>=0?`（RAM ${hex(0x80000000+(r.at-base))}）`:"";
    L.push(`    +0x${r.at.toString(16)}${ram}　間隔 ${r.stride}B で ${r.n}個続く`
      +`（はっきり行列 ${r.strong}個）`
      +(r.n>=20?"　→ 骨30本ぶんに近い":r.n>=10?"　→ 手足のどれかぶん？":""));
  }
  // いちばん長い所の中身を、そのまま数個出す
  // いちばん長い所が人の形をしているか、移動の値で確かめる
  for(const r of runs.slice(0,3)){
    const sh=memPoseShape(buf,base,r.at,r.stride,r.n);
    if(sh) L.push(`    +0x${r.at.toString(16)} の`+memPoseLine(sh).replace(/^ {2}/,""));
  }
  const b=runs[0];
  for(let k=0;k<Math.min(b.n,opt&&opt.show||4);k++){
    const off=b.at+k*b.stride, d=new DataView(buf.buffer,buf.byteOffset,buf.byteLength);
    const r=Array.from({length:9},(_,i)=>d.getInt16(off+i*2,true));
    const t=[0,1,2].map(i=>d.getInt32(off+20+i*4,true));
    L.push(`      +0x${off.toString(16)}　回転[${r.join(",")}] 移動(${t.join(",")})`);
  }
  return L;
}

// ============================================================
//  見つかった並びが、人の形をしているか
//  実物では、24個の塊が4つ出た。移動の値を並べると
//    Y 28〜1511（足が地面、頭が上）／ Z が ± に分かれる（左右の手足）
//  という、立っている人そのものの形をしていた
// ============================================================
function memPoseShape(buf,base,at,stride,n){
  const dv=new DataView(buf.buffer,buf.byteOffset,buf.byteLength);
  const T=[];
  for(let k=0;k<n;k++){ const o=at+k*stride;
    if(o+32>buf.length) break;
    T.push([0,1,2].map(i=>dv.getInt32(o+20+i*4,true))); }
  if(T.length<4) return null;
  const ax=i=>T.map(t=>t[i]), mn=a=>Math.min(...a), mx=a=>Math.max(...a);
  // 左右の対：Z の符号が逆で、X と Y が近いもの
  let pairs=0;
  for(let i=0;i<T.length;i++) for(let j=i+1;j<T.length;j++){
    const a=T[i], b=T[j];
    if(Math.abs(a[2]+b[2])<60&&Math.abs(a[2])>60
       &&Math.abs(a[0]-b[0])<320&&Math.abs(a[1]-b[1])<320) pairs++; }
  const tall=mx(ax(1))-mn(ax(1));
  return {n:T.length,
    x:[mn(ax(0)),mx(ax(0))], y:[mn(ax(1)),mx(ax(1))], z:[mn(ax(2)),mx(ax(2))],
    tall, pairs, spots:new Set(T.map(t=>t.join(","))).size};
}
function memPoseLine(sh){
  if(!sh) return "  形が読めない";
  return `  移動の値: X ${sh.x.join("〜")}　Y ${sh.y.join("〜")}　Z ${sh.z.join("〜")}`
    +`　背の高さ ${sh.tall}　左右の対 ${sh.pairs}組　別々の位置 ${sh.spots}個`
    +(sh.tall>800&&sh.pairs>=4
      ? "　→ 立っている人の形。これが骨の並び"
      : sh.tall>800?"　→ 縦に長いが、左右の対が無い（横から見た別の空間かも）":"");
}

// ============================================================
//  表Bをたどって、本物の骨を取り出す
//  0x8001F464 で止めた RAM では、表B に本物の番地が入っていた。
//  その先は「MATRIX へのポインタの並び」で、実物では
//    先頭 0x801F0484 から 40個、最後は 0 で終端
//    別々の行列は34個、うち2つが4回ずつ出てくる（枝の付け根に戻る動き）
//  だった。命令5 が1回進むごとに1つ引くので、
//  並びの順番は、モデルの区切りの順番とそのまま対応する
// ============================================================
function memBoneMatrix(M,addr){
  const m=memMatrixAt(M,addr); if(!m) return null;
  const len=[0,1,2].map(i=>Math.hypot(m.r[i*3],m.r[i*3+1],m.r[i*3+2]));
  // 実物は1行目が 3276（＝4096×0.8）だった。拡大縮小が入っていても骨は骨
  if(len.some(v=>v<3000||v>4400)) return null;
  return {m:m.r.slice(),t:m.t.slice(),one:4096};
}
function memRealBones(buf,base,opt){
  const o=opt||{}, M=memReader(buf,base);
  const cur=M.u32(o.tableB||0x800CBE8C);
  if(!M.ptr(cur)) return {why:"表Bが RAM を指していない（描き終わったあとの写し）",list:[]};
  // 命令5 が進めたぶんだけ先へ行っている。行列をたどれる所まで戻る
  let start=cur;
  for(let k=1;k<=(o.back||64);k++){
    const p=M.u32(cur-k*4);
    if(!M.ptr(p)||!memBoneMatrix(M,p)) break;
    start=cur-k*4;
  }
  const list=[], ptrs=[];
  for(let k=0;k<(o.max||256);k++){
    const p=M.u32(start+k*4);
    if(!M.ptr(p)) break;
    const bm=memBoneMatrix(M,p); if(!bm) break;
    ptrs.push(p); list.push(bm);
  }
  const cnt=new Map(); for(const p of ptrs) cnt.set(p,(cnt.get(p)||0)+1);
  return {start,cur,used:(cur-start)/4,list,ptrs,
          uniq:cnt.size,
          roots:[...cnt].filter(x=>x[1]>1).sort((a,b)=>b[1]-a[1]).slice(0,4)};
}
function memRealBoneLines(r){
  if(!r||!r.list.length) return ["  本物の骨は取れない"+(r&&r.why?"（"+r.why+"）":"")];
  const T=r.list.map(b=>b.t), A=i=>T.map(t=>t[i]), R=a=>[Math.min(...a),Math.max(...a)];
  const L=[`  本物の骨が取れました: 表B ${hex(r.start)} から ${r.list.length}個`
    +`（別々の行列 ${r.uniq}個・命令5が使った分 ${r.used}個）`];
  L.push(`    移動の範囲 X ${R(A(0)).join("〜")}　Y ${R(A(1)).join("〜")}　Z ${R(A(2)).join("〜")}`
    +`　背の高さ ${R(A(1))[1]-R(A(1))[0]}`);
  for(const [p,c] of r.roots)
    L.push(`    ${hex(p)} が ${c}回出てくる（枝の付け根に戻る動き）`);
  return L;
}

// ============================================================
//  表Bの並びを「番号の列」に直して、歪みのない姿に置き換える
//
//  表Bが指す行列は、カメラから見た空間に入っている（Z が 3500〜4600、
//  1行目が 3276＝0.8倍。画面の横比の補正がカメラ行列に入っているため）。
//  同じ並びが、カメラを掛ける前の空間にもある。
//
//  実測（実物のダンプ）:
//    表Bの40個のポインタは、すべて 0x801F0A84 からの 32バイト刻みに乗る
//    番号にすると 1〜60（別々に34個）。付け根が2つ（1番と18番）
//    その番号をそのまま 0x801EFB24 に当てると、34個すべてが行列で、
//      X -1954〜-488　Y 28〜1529　Z -492〜573　背の高さ 1501
//    という、立っている人の姿になる
//
//  つまり、2つの並びは同じ番号で並行している。
//  表Bは「どの番号を、どの順で使うか」を教える列だった
// ============================================================
function memBoneIndexList(buf,base,opt){
  const o=opt||{}, M=memReader(buf,base);
  const r=memRealBones(buf,base,o);
  if(!r.list.length) return {why:r.why||"表Bがたどれない",idx:[]};
  const ptrs=r.ptrs;
  const viewBase=Math.min(...ptrs);
  // 全部が同じ刻みに乗っているか。乗らなければ、並行した並びという読みが外れる
  const idx=ptrs.map(p=>(p-viewBase)/32);
  if(idx.some(v=>!Number.isInteger(v)||v<0))
    return {why:"ポインタが32バイト刻みに乗らない",idx:[],viewBase};
  return {idx,viewBase,ptrs,start:r.start,used:r.used};
}
// 番号の列を、別の並びに当てる
function memBonesByIndex(buf,base,idx,at){
  const M=memReader(buf,base), list=[];
  for(const i of idx){
    const bm=memBoneMatrix(M,at+i*32);
    if(!bm) return null;
    list.push(bm);
  }
  return list;
}
// どの並びに当てると「立っている人」になるかを、測って選ぶ。
// 散らばりを高く評価してしまう「縦横比」ではなく、
// 背の高さと左右の対で見る（v4.23.0 でここを間違えた）
function memBonePoseScore(list){
  if(!list||!list.length) return null;
  const T=list.map(b=>b.t), A=i=>T.map(t=>t[i]), R=a=>[Math.min(...a),Math.max(...a)];
  const y=R(A(1)), z=R(A(2));
  let pairs=0;
  for(let i=0;i<T.length;i++) for(let j=i+1;j<T.length;j++){
    const a=T[i],b=T[j];
    if(Math.abs(a[2]+b[2])<60&&Math.abs(a[2])>60
       &&Math.abs(a[0]-b[0])<320&&Math.abs(a[1]-b[1])<320) pairs++; }
  const tall=y[1]-y[0], zw=z[1]-z[0];
  // 立っている人は「背が 800〜3000」「左右に開きすぎない」「左右の対がある」
  const okTall=tall>800&&tall<3000;
  return {tall,pairs,zw,ok:okTall&&pairs>=4,score:(okTall?1:0)*pairs};
}
function memBestBones(buf,base,opt){
  const o=opt||{}, L=memBoneIndexList(buf,base,o);
  if(!L.idx.length) return {why:L.why,list:null};
  // 当てる先の候補。
  // いちばん確かなのは「表Bの最小 − 0xF60」。実測で、1Pも2Pも
  //   0x801F0A84 − 0x801EFB24 = 0xF60
  //   0x801F28CC − 0x801F196C = 0xF60
  // と、カメラを掛ける前と後の並びがこの間隔で並行していた。
  // 走査が拾う「並びの先頭」は1本ずれることがある（実測で 0x801EFB24 と
  // 0x801EFB44 が32バイト違った）ので、そちらは前後もずらして入れる
  const cands=[L.viewBase-(o.gap||0xF60), L.viewBase];
  const runs=(()=>{ try{ return memMatrixStrideRuns(buf,{min:8,top:16,strides:[32]}) }catch(_){ return [] } })();
  for(const r of runs){ const a=0x80000000+(r.at-base);
    for(const d of [0,32,-32,64]) cands.push(a+d) }
  const seen=new Set(), out=[];
  for(const at of cands){
    if(seen.has(at)) continue; seen.add(at);
    const list=memBonesByIndex(buf,base,L.idx,at);
    if(!list) continue;
    const sc=memBonePoseScore(list);
    out.push({at,list,sc,view:at===L.viewBase});
  }
  // 点数で選ぶと、もう一人（2P）の並びが勝つことがある。実測でそうなった。
  // どちらも人の形をしているので、形では見分けられない。
  // 同じキャラの入れものの中を選ぶのが筋なので、
  // 「表Bの最小 − 0xF60」が人の形をしていれば、それを使う
  out.sort((a,b)=>b.sc.score-a.sc.score||a.sc.zw-b.sc.zw);
  const home=out.find(x=>x.at===L.viewBase-(o.gap||0xF60)&&x.sc.ok);
  if(home){ out.splice(out.indexOf(home),1); out.unshift(home); home.home=true }
  const best=out[0];
  return {idx:L.idx,viewBase:L.viewBase,start:L.start,cands:out,
          list:best?best.list:null,at:best?best.at:0,sc:best?best.sc:null};
}
function memBestBoneLines(r){
  if(!r||!r.list) return ["  番号の列に直せない"+(r&&r.why?"（"+r.why+"）":"")];
  const L=[`  表Bを番号の列に直しました: ${r.idx.length}個`
    +`（別々に ${new Set(r.idx).size}個・番号は 0〜${Math.max(...r.idx)}）`];
  for(const c of r.cands.slice(0,3))
    L.push(`    ${hex(c.at)} に当てると 背の高さ ${c.sc.tall}　左右の対 ${c.sc.pairs}組`
      +`　左右の開き ${c.sc.zw}`+(c===r.cands[0]?"　← これを使う":"")
      +(c.home?"（表Bの最小 − 0xF60。同じキャラの入れものの中）":"")
      +(c.view?"（表Bが指している並び。カメラを掛けたあと）":""));
  return L;
}

// ============================================================
//  いま描かれているモデルが、ディスクのどのファイルかを決める
//
//  表C（0x800CBE94）は部品の表。その先の1つ目は、モデルの先頭 +offset0 を
//  指している。だから手前へ 0x90000000 を探して、
//  「先頭＋語1（offset0）＝表Cの1つ目」が成り立つ所を選べば、
//  当てずっぽうではなく、確かめたうえでモデルの先頭が決まる。
//
//  実測（実物のダンプ）:
//    表C = 0x801F0684　その[0] = 0x801078C8
//    手前へ探すと 0x8010788C に 0x90000000、語1 = 0x3C
//    0x8010788C + 0x3C = 0x801078C8　← 合う
// ============================================================
function memDrawnModel(buf,base,opt){
  const o=opt||{}, M=memReader(buf,base);
  const tc=M.u32(o.tableC||0x800CBE94);
  if(!M.ptr(tc)) return {why:"表Cが RAM を指していない"};
  const p0=M.u32(tc);
  if(!M.ptr(p0)) return {why:"表Cの1つ目が RAM を指していない",tableC:tc};
  // 手前へ署名を探す。見つけただけでは決めず、offset0 が合うかまで見る
  for(let a=p0;a>0x80010000&&p0-a<(o.back||0x800);a-=4){
    if(M.u32(a)!==0x90000000) continue;
    const off0=M.u32(a+4);
    if(a+off0!==p0) continue;                       // ここで確かめる
    const words=Array.from({length:8},(_,k)=>M.u32(a+k*4));
    return {tableC:tc,part0:p0,at:a,off0,words};
  }
  return {why:"表Cの手前に、つじつまの合う 0x90000000 が無い",tableC:tc,part0:p0};
}
// 突き合わせた結果を1件に決めて返す（画面がその番号を選べるように）
function memDrawnMatch(r,sieve){
  if(!r||!r.at||!sieve||!sieve.other) return null;
  const c=sieve.other.filter(e=>e.words&&e.words.length>=8
    &&e.words.every((v,k)=>v===r.words[k]));
  return c.length===1?c[0]:null;
}
function memDrawnModelLines(r,sieve){
  if(!r||!r.at) return ["  描かれているモデルは決められない"+(r&&r.why?"（"+r.why+"）":"")];
  const L=[`  描かれているモデル: RAM ${hex(r.at)}（表C ${hex(r.tableC)} の1つ目 ${hex(r.part0)} ＝ 先頭＋0x${r.off0.toString(16)}：合っている）`];
  L.push("    先頭8語: "+r.words.map(v=>hex(v)).join(" "));
  // ディスクのモデルと、先頭8語で突き合わせる
  const cand=[];
  for(const e of ((sieve&&sieve.other)||[]))
    if(e.words&&e.words.length>=8&&e.words.every((v,k)=>v===r.words[k])) cand.push(e);
  L.push(cand.length===1
    ? `    ディスクのファイルと一致: #${cand[0].e.no}(sector ${cand[0].e.sector})`
      +(cand[0].diag&&cand[0].diag.segs?`　区切り ${cand[0].diag.segs}個`:"")
    : cand.length?`    一致したファイルが ${cand.length}件: `+cand.map(c=>"#"+c.e.no).join(" ")
                 :"    先頭8語が一致するファイルは無い（先に「まとめて調べる」を押してください）");
  return L;
}
// 表Bのどの位置が、どの番号を引いているか。飛んでいる所の中身をそのまま出す
function memBoneJumpLines(buf,base,opt){
  const o=opt||{}, M=memReader(buf,base), L=[];
  const r=memRealBones(buf,base,o);
  if(!r.list.length) return ["  表Bがたどれない"];
  const viewBase=Math.min(...r.ptrs);
  const idx=r.ptrs.map(p=>(p-viewBase)/32);
  L.push(`  番号の列: ${idx.join(" ")}`);
  // 1ずつ増えて続く所＝ひと続きの枝。低い番号と離れたものが、別にぶら下がった枝
  const runs=[]; let cur=null;
  for(let k=0;k<idx.length;k++){
    if(cur&&idx[k]===idx[k-1]+1) cur.n++;
    else { if(cur&&cur.n>=3) runs.push(cur); cur={at:k,n:1} }
  }
  if(cur&&cur.n>=3) runs.push(cur);
  L.push(runs.length
    ? "  1ずつ続く枝: "+runs.map(x=>`列の${x.at}番目から ${x.n}本（番号 ${idx[x.at]}〜${idx[x.at+x.n-1]}）`).join("　")
    : "  1ずつ続く枝は無い");
  // いちばん番号の大きい枝の中身を、そのまま出す
  const far=runs.slice().sort((a,b)=>idx[b.at]-idx[a.at])[0];
  if(far){
    L.push(`  いちばん遠い枝（番号 ${idx[far.at]}〜${idx[far.at+far.n-1]}）の中身:`);
    for(let j=far.at;j<far.at+far.n;j++)
      L.push(`    番号${idx[j]} ${hex(r.ptrs[j])}　${memMatrixLine(memMatrixAt(M,r.ptrs[j]))}`);
  }
  return L;
}
// ワールド側の配列の終わりから、カメラ側の始まりまでを、そのまま出す。
// 0xF60 が構造体の決まった間隔なのかどうかは、ここを見れば分かる
function memGapLines(buf,base,opt){
  const o=opt||{}, M=memReader(buf,base), L=[];
  const r=memRealBones(buf,base,o);
  if(!r.list.length) return ["  表Bがたどれない"];
  const viewBase=Math.min(...r.ptrs), gap=o.gap||0xF60;
  const worldBase=viewBase-gap;
  const nmax=Math.max(...r.ptrs.map(p=>(p-viewBase)/32))+1;
  const from=worldBase+nmax*32;
  L.push(`  ワールド側 ${hex(worldBase)}（＝表Bの最小 − 0x${gap.toString(16)}）`
    +`　番号は ${nmax}個ぶん使うので、その終わりは ${hex(from)}`);
  L.push(`  そこから ${hex(viewBase)} までの ${viewBase-from}バイトを、そのまま:`);
  for(let i=0;i<Math.min(6,Math.ceil((viewBase-from)/32));i++){
    const a=from+i*32;
    L.push(`    ${hex(a)}: `+Array.from(M.bytes(a,32),v=>v.toString(16).padStart(2,"0")).join(" "));
  }
  // ここに何があるのか、話で埋めずに数える。
  // 「2行目だけ 0」「縦の値がどれも同じ」なら、それは地面に潰す影の行列
  { let n=0, flat=0; const ty=new Map();
    for(let a=from;a+32<=viewBase;a+=32){
      const m=memMatrixAt(M,a); if(!m) continue;
      const r0=m.r.slice(0,3).some(v=>v!==0), r1=m.r.slice(3,6).every(v=>v===0),
            r2=m.r.slice(6,9).some(v=>v!==0);
      if(!r0&&!r2) continue;
      n++; if(r0&&r1&&r2){ flat++; ty.set(m.t[1],(ty.get(m.t[1])||0)+1) }
    }
    const top=[...ty].sort((a,b)=>b[1]-a[1])[0];
    L.push(`    中身のある枠 ${n}個　そのうち「2行目だけ 0」が ${flat}個`
      +(top?`　縦の値は ${top[0]} が ${top[1]}個で最多`:""));
    if(flat>=3&&top&&top[1]>=flat*0.8)
      L.push(`    → そのうち ${flat}個は「回転は残って 2行目だけ 0・縦の値が ${top[0]}」。`
        +`地面に潰す影の行列です（${top[0]} が地面の高さ）。`
        +"ただし、この範囲はそれだけではありません（表A・表B・表Cの並び自体もここにあります）");
    else L.push("    → 影の行列らしいものは、まとまっては無い");
  }
  const as=M.u32(0x800CBE90);
  if(M.ptr(as)) L.push(`    （表A ${hex(as)} はこの範囲${as>=from&&as<viewBase?"の中":"の外"}）`);
  return L;
}

// ============================================================
//  メモリの写しから、モデルそのものを切り出す
//
//  ディスクのファイルと突き合わせるのをやめる。
//  骨（表B）もモデル（表C）も、**同じ1つの写しの中に揃っている**うえ、
//  写しから読んだほうが欠けずに読めた。実測（dump3）:
//    1P 0x8010788C（34376 B）11部品すべて読めた　区切り40　三角1065
//    2P 0x800B2548（38136 B）11部品すべて読めた　区切り34　三角1128
//
//  書き換えの心配も測って潰した。別の場面・別のポーズで取った2つの写しの、
//  同じ番地の 34376 バイトが**1バイトも違わなかった**（そのときワールド行列の
//  並びのほうは 752 バイト違っていた＝ポーズは別物）。
//  モデルは実行中に書き換えられていない
// ============================================================
// 長さは「次の 0x90000000 まで」。1P では 0x8648 で、ディスクのファイルの
// 大きさとぴったり同じだった。ただし当てずっぽうにしないため、
// 部品がその中に収まっているかを確かめてから返す
function memModelAt(buf,base,part0,opt){
  const o=opt||{}, M=memReader(buf,base);
  if(!M.ptr(part0)) return null;
  for(let a=part0;a>0x80010000&&part0-a<(o.back||0x800);a-=4){
    if(M.u32(a)!==0x90000000) continue;
    const off0=M.u32(a+4);
    if(a+off0!==part0) continue;                    // 先頭だと確かめる
    // 次の署名まで。見つからなければ上限まで
    const cap=o.cap||0x40000;
    let end=0;
    for(let p=a+4;p<a+cap;p+=4) if(M.u32(p)===0x90000000){ end=p; break }
    const len=(end?end:a+cap)-a;
    const bytes=M.bytes(a,len);
    if(bytes.length<len) return {at:a,off0,why:"写しの終わりに届いた"};
    return {at:a,off0,len,bytes,ended:!!end};
  }
  return null;
}
// 本体の命令5の回数。骨の表の終わりを決めるのに使う。
// 表Bを前から順にたどるだけだと終わりが分からず、実測で6個行き過ぎていた
function memCmd5Count(d,partOff){
  if(!d||partOff+0x10>d.length) return 0;
  const dv=new DataView(d.buffer,d.byteOffset,d.byteLength);
  const g=p=>p+4<=d.length?dv.getUint32(p,true):0;
  const LEN=(typeof T1_CMD_LEN==="object"&&T1_CMD_LEN)||{0:0,1:12,2:16,3:8,4:16,5:4,6:8,7:12};
  let fp=partOff+0x10, n=0;
  for(let steps=0;steps<8192&&fp+8<=d.length;steps++){
    const op=g(fp);
    if(op===0) break;
    if(op===5) n++;
    if(op in LEN) fp+=LEN[op];
    else if(op<=15) fp+=8;
    else break;
  }
  return n;
}
// 表Bの先頭（カーソルではなく並びの頭）から、骨を n 本ぶん取る
function memBonesFrom(buf,base,cur,opt){
  const o=opt||{}, M=memReader(buf,base);
  if(!M.ptr(cur)) return {why:"表Bが RAM を指していない（描き終わったあとの写し）",list:[],ptrs:[]};
  let start=cur;
  for(let k=1;k<=(o.back||64);k++){
    const p=M.u32(cur-k*4);
    if(!M.ptr(p)||!memBoneMatrix(M,p)) break;
    start=cur-k*4;
  }
  const list=[], ptrs=[], max=o.want||o.max||256;
  for(let k=0;k<max;k++){
    const p=M.u32(start+k*4);
    if(!M.ptr(p)) break;
    const bm=memBoneMatrix(M,p); if(!bm) break;
    ptrs.push(p); list.push(bm);
  }
  const cnt=new Map(); for(const p of ptrs) cnt.set(p,(cnt.get(p)||0)+1);
  return {start,cur,used:(cur-start)/4,list,ptrs,uniq:cnt.size,
          roots:[...cnt].filter(x=>x[1]>1).sort((a,b)=>b[1]-a[1]).slice(0,4)};
}
// ============================================================
//  写しの中の登場人物を、ぜんぶ並べる
//
//  キャラクター1体ぶんの入れものは 0x1E48 バイト間隔で並んでいた（実測）。
//  1P の表A/B/C にこの間隔を足すと、そのまま 2P の表A/B/C になる。
//  確かめ方は「表Cの1つ目 ＝ モデルの先頭 + 0x3C」で、両方で成り立った
// ============================================================
const MEM_CHAR_STRIDE=0x1E48;
function memCharacters(buf,base,opt){
  const o=opt||{}, M=memReader(buf,base);
  const b0=M.u32(o.tableB||0x800CBE8C), c0=M.u32(o.tableC||0x800CBE94);
  const out=[];
  if(!M.ptr(b0)||!M.ptr(c0)) return out;
  const stride=o.stride||MEM_CHAR_STRIDE;
  for(let k=0;k<(o.max||4);k++){
    const d=k*stride, tb=b0+d, tc=c0+d;
    if(!M.ptr(tb)||!M.ptr(tc)) break;
    const p0=M.u32(tc);
    if(!M.ptr(p0)) break;                       // ここで登場人物は終わり
    const md=memModelAt(buf,base,p0,o);
    if(!md||!md.bytes) break;
    // 本体の命令5の回数＝骨の本数。これで表Bの終わりを決める
    const want=memCmd5Count(md.bytes,md.off0);
    const rb=memBonesFrom(buf,base,tb,Object.assign({},o,{want:want||undefined}));
    out.push({k,who:k===0?"1P":k===1?"2P":`${k+1}体目`,
              tableB:tb,tableC:tc,part0:p0,model:md,cmd5:want,bones:rb});
  }
  return out;
}
// 表Bの並びを、歪みのない（カメラを掛ける前の）並びに置き換える
function memCharBones(buf,base,c,opt){
  const o=opt||{};
  if(!c||!c.bones||!c.bones.ptrs.length) return null;
  const viewBase=Math.min(...c.bones.ptrs);
  const idx=c.bones.ptrs.map(p=>(p-viewBase)/32);
  if(idx.some(v=>!Number.isInteger(v)||v<0)) return {list:c.bones.list,at:viewBase,idx,view:true};
  const cands=[viewBase-(o.gap||0xF60),viewBase];
  for(const at of cands){
    const list=memBonesByIndex(buf,base,idx,at);
    if(!list) continue;
    const sc=memBonePoseScore(list);
    if(at===viewBase||sc.ok) return {list,at,idx,sc,view:at===viewBase};
  }
  return {list:c.bones.list,at:viewBase,idx,view:true};
}
function memCharLines(list){
  if(!list||!list.length) return ["  写しの中に登場人物が見つからない（表B・表Cが RAM を指していない）"];
  const L=[`  写しの中の登場人物 ${list.length}人（入れものは 0x${MEM_CHAR_STRIDE.toString(16).toUpperCase()} バイト間隔）`];
  for(const c of list)
    L.push(`    ${c.who}: モデル ${hex(c.model.at)}（${c.model.len} B${c.model.ended?"":"・次の署名が無いので上限まで"}）`
      +`　本体の命令5 ${c.cmd5}回　表B ${hex(c.tableB)} から骨 ${c.bones.list.length}本`
      +(c.cmd5&&c.bones.list.length===c.cmd5?"（命令5の回数と一致）":c.cmd5?`（命令5は ${c.cmd5}回）`:""));
  return L;
}

// ============================================================
//  RAM の先頭を、当てずっぽうではなく確かめて決める
//
//  実行ファイルと突き合わせる findPsxRam は、**違う実行ファイル**を
//  読み込んでいると、まちがった位置で一致してしまう（試験用の小さな
//  実行ファイルで 572904 という出まかせが返った）。
//  そこで候補を並べ、「表Bと表Cがちゃんと RAM を指し、
//  表Cの先にモデルの署名がある」ものを選ぶ。
//  どれも通らなければ（描き終わったあとの写しなど）先頭の候補に戻す
// ============================================================
function memPickBase(buf,exe){
  const seen=new Set(), real=[];
  const add=(v,a)=>{ if(v>=0&&!seen.has(v)){ seen.add(v); a.push(v) } };
  // 中身から見つけた位置。確かめが通らなくても、最後はここへ戻す
  try{ add(findPsxRam(buf,exe),real) }catch(_){}
  try{ add(memFindBaseByCode(buf),real) }catch(_){}
  // 生の RAM ダンプは先頭がそのまま RAM の 0 番地。ただし
  // 「中身が空でも 0 なら通る」ことになってはいけないので、
  // これは**確かめに通ったときだけ**使う
  const probe=real.slice(); add(0,probe);
  for(const base of probe){
    let n=0; try{ n=memCharacters(buf,base).length }catch(_){}
    if(n>0) return {base,ok:true,tried:probe,why:`表Bと表Cの先が筋の通る位置（登場人物 ${n}人）`};
  }
  return {base:real.length?real[0]:-1,ok:false,tried:probe,
          why:"確かめられなかったので、突き合わせで出た位置をそのまま使う"};
}
