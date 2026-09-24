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

// ============================================================
//  行列の積み場所を、ふるいにかけずにそのまま見る
//  「int16×9 が ±4200・詰め物が0・移動が ±30000」という条件で
//  写し全体を掃いたが、一つも出なかった。
//  条件のほうが間違っている可能性がある——移動は数万に達するし、
//  行列は連なって並んでいるとは限らない。
//  0x800CC910 は行列の積みの先端なので、その値が指す所を
//  条件なしで出せば、何が置いてあるか目で見える
// ============================================================
function memMatrixAt(M,addr){
  const b=M.bytes(addr,32); if(b.length<32) return null;
  const dv=new DataView(b.buffer,b.byteOffset,b.byteLength);
  return {r:Array.from({length:9},(_,k)=>dv.getInt16(k*2,true)),
          pad:dv.getInt16(18,true),
          t:[dv.getInt32(20,true),dv.getInt32(24,true),dv.getInt32(28,true)]};
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

// ============================================================
//  見つかった並びが、人の形をしているか
//  実物では、24個の塊が4つ出た。移動の値を並べると
//    Y 28〜1511（足が地面、頭が上）／ Z が ± に分かれる（左右の手足）
//  という、立っている人そのものの形をしていた
// ============================================================

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
