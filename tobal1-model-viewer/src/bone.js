// 行列の持ち方は1つとは限らない。ありそうな形を3つ試す
// 1番目の形は、実行ファイルを読んで確かめた（推測ではない）。
// 命令5の処理 0x8001F444 が、表Bの指す先からこう読んで GTE に入れている：
//   lw 0,4,8,12,16($t6) → ctc2 $0..$4   ＝ 回転3×3（int16×9＋詰め2バイト）
//   lw 20,24,28($t6)    → ctc2 $5,$6,$7 ＝ 移動 TRX,TRY,TRZ（int32×3）
// 合わせて32バイト。PS1 の MATRIX そのもの。
// 表Aの指す先は 0,4,8,12,16 の5語だけで ctc2 $8..$12（光源の行列）＝20バイト。
//
// 外していたのは形ではなく前提のほうだった。
// 表A・表B・表Cは「行列の並び」ではなく「行列へのポインタの並び」で、
// 命令5 が来るたびに 4 ずつ進む（0x8001F464 addiu $t0,$t0,4）。
// だからメモリを32バイト刻みで掃いても、並んでいる場所が無い
const MAT_FORMS=[
  {size:32,tAt:20,tBits:32,name:"回転int16×9＋詰め物＋移動int32×3（実行ファイルで確認済み）"},
  {size:24,tAt:18,tBits:16,name:"回転int16×9＋移動int16×3"},
  {size:20,tAt:-1,tBits:0, name:"回転int16×9だけ"},
];
function readMatrix(dv,o,f){
  f=f||MAT_FORMS[0];
  const m=[]; for(let k=0;k<9;k++) m.push(dv.getInt16(o+k*2,true));
  const t=f.tAt<0?[0,0,0]
    :f.tBits===32?[dv.getInt32(o+f.tAt,true),dv.getInt32(o+f.tAt+4,true),dv.getInt32(o+f.tAt+8,true)]
    :[dv.getInt16(o+f.tAt,true),dv.getInt16(o+f.tAt+2,true),dv.getInt16(o+f.tAt+4,true)];
  return {m,t};
}
// 回転行列なら、3本の行はどれも長さ 4096 で、互いに直角になる。
// でたらめなバイト列がこれを満たすことはまずない
// 1.0 が 4096 とは限らないので、目盛りは決め打ちしない。
// 「3本の行の長さが互いに等しく、互いに直角」なら、目盛りがいくつでも回転行列
function matrixOK(M){
  const r=[[M.m[0],M.m[1],M.m[2]],[M.m[3],M.m[4],M.m[5]],[M.m[6],M.m[7],M.m[8]]];
  const L=r.map(v=>Math.hypot(v[0],v[1],v[2]));
  const one=(L[0]+L[1]+L[2])/3;
  if(one<256||one>46341) return false;                 // 小さすぎ・大きすぎは論外
  if(L.some(v=>Math.abs(v-one)>one*0.08)) return false; // 3本の長さがそろっている
  const dot=(a,b)=>(a[0]*b[0]+a[1]*b[1]+a[2]*b[2])/(one*one);
  if(Math.abs(dot(r[0],r[1]))>=0.12||Math.abs(dot(r[0],r[2]))>=0.12||Math.abs(dot(r[1],r[2]))>=0.12) return false;
  M.one=Math.round(one);
  return true;
}
function boneScan(buf,form,skip){
  const f=form||MAT_FORMS[0]; skip=skip||0;
  if(!buf||buf.length-skip<f.size*2||(buf.length-skip)%f.size) return null;
  const dv=new DataView(buf.buffer,buf.byteOffset,buf.byteLength);
  const n=(buf.length-skip)/f.size, list=[]; let good=0;
  for(let k=0;k<n;k++){ const M=readMatrix(dv,skip+k*f.size,f); M.ok=matrixOK(M); if(M.ok) good++; list.push(M) }
  return {n,good,ratio:good/n,list,form:f,skip};
}
// どの持ち方でいちばん筋が通るかを試す。頭に小さな見出しが付いている見込みも入れる
function boneScanBest(buf){
  let best=null;
  for(const f of MAT_FORMS) for(const skip of [0,4,8,16]){
    const b=boneScan(buf,f,skip);
    if(!b||b.n<8) continue;
    if(!best||b.ratio>best.ratio||(b.ratio===best.ratio&&b.n>best.n)) best=b;
  }
  return best;
}
function boneSample(b,k){
  const M=b.list[k]; if(!M) return "";
  return `      [${k}]${M.ok?"○":"×"} 回転 ${M.m.join(",")}${M.one?`（1.0＝${M.one}）`:""}　移動 ${M.t.join(",")}`;
}
function boneLines(hits){
  const L=["骨さがし（32バイトの行列が並んでいる塊）:"];
  if(!hits.length){ L.push("  見つかりませんでした"); return L }
  L.push(`  ${hits.length}件`);
  for(const h of hits.slice(0,12)){
    L.push(`  #${h.e.no} sector ${h.e.sector} 部分${h.pi}　${h.len} B ＝ 行列${h.b.n}個　`
      +`回転として筋が通るもの ${h.b.good}/${h.b.n}　`
      +`持ち方 ${h.b.form.size}B（${h.b.form.name}）${h.b.skip?`　頭を ${h.b.skip}B 飛ばす`:""}`);
    L.push(boneSample(h.b,0));
    L.push(boneSample(h.b,1));
  }
  return L;
}
