// ============================================================
//  アーカイブを直接さらう
//  表の形が分からなくても、アーカイブの中を 2048 バイトごとに見て
//  「ファイルの先頭らしいところ」を拾えば、モデルは取り出せる。
//  拾えるのは2種類:
//    - ゲーム独自の圧縮（先頭 0x0b ＋ 展開後の大きさ）
//    - 入れ子（部分の数と位置の表）
// ============================================================
// 0x0b で始まるだけなら偶然も多いので、続く「展開後の大きさ」と
// 最初のブロックのモード（0〜6）まで見て確からしさを上げる
function looksPacked(b){
  if(b[0]!==0x0b) return 0;
  const total=b[1]|(b[2]<<8)|(b[3]<<16);
  if(total<64||total>0x1000000) return 0;
  return (b[4]&15)<=6?total:0;
}
async function scanArchive(onProgress){
  const size=state.src.arcSize, total=Math.ceil(size/2048), CH=512;
  const hits=[];
  for(let s=0;s<total;s+=CH){
    const n=Math.min(CH,total-s);
    if(onProgress) onProgress(s/total);
    await idle();
    let buf=null;
    try{ buf=await state.src.readArc(s,n*2048) }catch(_){ continue }
    for(let k=0;k<n&&(k+1)*2048<=buf.length;k++){
      const head=buf.subarray(k*2048,(k+1)*2048), sec=s+k, rest=size-sec*2048;
      const c=classify(head,rest);
      if(c.kind==="model"||c.kind==="pack"){ hits.push({sector:sec,kind:c.kind,parts:c.parts}); continue }
      const t=looksPacked(head);
      if(t) hits.push({sector:sec,kind:"lz",parts:0,unpacked:t});
    }
  }
  if(onProgress) onProgress(1);
  // 大きさは「次のファイルの先頭まで」。展開も入れ子も必要な分しか読まないので、これで足りる
  hits.forEach((h,i)=>{ h.size=Math.min(((i+1<hits.length?hits[i+1].sector:total)-h.sector)*2048, size-h.sector*2048) });
  return hits;
}
// さらった結果から、実行ファイルの中のファイル表を逆算する。
// 見つけたセクタ番号が実行ファイルの中で一定の間隔で並んでいれば、それが表。
function inferTable(exe,hits){
  if(hits.length<4) return null;
  const dv=new DataView(exe.buffer,exe.byteOffset,exe.byteLength);
  const seq=hits.slice(0,48).map(h=>h.sector);
  const where=new Map();          // セクタ番号 → 実行ファイル内でその値が置かれている位置
  const want=new Set(seq);
  for(let o=0;o+4<=exe.byteLength;o+=4){
    const v=dv.getUint32(o,true);
    if(want.has(v)){ const a=where.get(v)||[]; if(a.length<64){ a.push(o); where.set(v,a) } }
  }
  // 隣り合うセクタが同じ間隔で出てくる回数を数える（＝1件の長さ）。
  // セクタ 0 などの小さい値は実行ファイル中にいくらでもあるので、票に入れない
  const votes=new Map();
  for(let i=0;i+1<seq.length;i++){
    if(seq[i]<16||seq[i+1]<16) continue;
    for(const a of (where.get(seq[i])||[])) for(const b of (where.get(seq[i+1])||[])){
      const d=b-a;
      if(d>0&&d<=64&&d%4===0){ const m=votes.get(d)||new Map(); m.set(a,i); votes.set(d,m) }
    }
  }
  let stride=0, best=0;
  for(const [d,m] of votes) if(m.size>best){ best=m.size; stride=d }
  if(!stride||best<3) return null;
  // 票が入った位置と、それが何件目かから、表の先頭を逆算する
  let base=Infinity;
  for(const [a,i] of votes.get(stride)){ const b0=a-i*stride; if(b0>=0&&b0<base) base=b0 }
  if(!isFinite(base)) return null;
  // 大きさがどこに入っているかを当てる: 件の中で「次のセクタまでに収まる値」が続く位置
  let sizeAt=-1;
  for(let off=4;off<stride;off+=4){
    let ok=0, n=0;
    for(let i=0;i+1<seq.length&&i<24;i++){
      const a=base+i*stride;
      if(a+off+4>exe.byteLength) break;
      const sec=dv.getUint32(a,true), sz=dv.getUint32(a+off,true), room=(seq[i+1]-sec)*2048;
      if(sec!==seq[i]) continue;
      n++; if(sz>=64&&sz<=room+2048) ok++;
    }
    if(n>=3&&ok===n){ sizeAt=off; break }
  }
  return {base,stride,sizeAt,votes:best};
}
