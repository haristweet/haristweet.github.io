// ============================================================
//  ファイル表さがし
//  トバル2 では実行ファイルの 0x800CD660 に「8バイト × 0x552 個」の表があり、
//  1件が { 先頭セクタ, 大きさ<<8 | 種類 } だった。No.1 でも同じ形のはずなので、
//  実行ファイル全体から「その形の並びが続くところ」を探す。
// ============================================================
const MIN_ENTRY=64;            // 大きさ数バイトの並びはファイル表ではない（誤検出が上位に来ていた）
const MAX_ENTRY=0x2000000;     // 1ファイル 32MB を超える表は無いものとして弾く
// 解析済みのディスク。No.1 用の探索が正しく動くかを、答えの分かっているトバル2 で確かめられる
const KNOWN_DISCS={
  "SLPM_860.33":{title:"トバル2 (SLPM-86033)",addr:0x800CD660,count:0x552,
                 note:"トバルNo.1 ではありません。専用のビューアがあります: https://haristweet.github.io/tobal2-model-viewer/"},
};
const knownDisc=name=>KNOWN_DISCS[(name||"").toUpperCase()]||KNOWN_DISCS[name]||null;
const MAX_TYPE=64;
function exeInfo(exe){
  const dv=new DataView(exe.buffer,exe.byteOffset,exe.byteLength);
  const ok=String.fromCharCode(...exe.subarray(0,8))==="PS-X EXE";
  // +0x14 は起動時の $gp。このゲームはグローバル変数を $gp 相対で読み書きしているので、
  // これが分からないと「その変数を使っている場所」を見つけられない
  return {ok, text:ok?dv.getUint32(0x18,true):0, size:ok?dv.getUint32(0x1c,true):0,
          pc:ok?dv.getUint32(0x10,true):0, gp:ok?dv.getUint32(0x14,true):0};
}
// 表の1件がどう並んでいるか。トバル2 は前者だったが、No.1 で違っていても拾えるように両方試す
const TABLE_SHAPES=[
  {name:"位置 / 大きさ<<8|種類", dec:(a,b)=>({sector:a,size:b>>>8,type:b&0xff})},
  {name:"位置 / 大きさ",         dec:(a,b)=>({sector:a,size:b,type:0})},
];
function findFileTables(exe,arcSize){
  const dv=new DataView(exe.buffer,exe.byteOffset,exe.byteLength), body=exe.byteLength;
  const arcSectors=Math.ceil(arcSize/2048), found=[];
  TABLE_SHAPES.forEach((sh,si)=>{
    const at=o=>{
      if(o+8>body) return null;
      const a=dv.getUint32(o,true), b=dv.getUint32(o+4,true);
      if(a===0&&b===0) return "hole";                       // 空きスロット。並びは切らさない
      const e=sh.dec(a,b);
      if(e.size<MIN_ENTRY||e.size>MAX_ENTRY||e.type>=MAX_TYPE) return null;
      if(e.sector>arcSectors||e.sector*2048+e.size>arcSize+2048) return null;
      return e;
    };
    for(const phase of [0,4]){
      // 表の中はセクタ順に並んでいるとは限らない（トバル2の表で、順番が飛ぶたびに
      // 並びが切れて 1362件が6つ以上に割れてしまった）。連続は「質」として数えるだけにして、
      // 並び自体は「1件として筋が通る」ことだけで続ける。空きスロットや変な1件は
      // 8件までなら飛ばす。
      let start=-1, prev=null, count=0, strict=0, noise=0;
      const flush=()=>{ const n=count-noise; if(start>=0&&n>=32) found.push({off:start,count:n,strict,shape:si,name:sh.name}); start=-1; count=0; strict=0; noise=0; prev=null };
      for(let o=phase;o+8<=body;o+=8){
        const e=at(o);
        if(e==="hole"||!e){ if(start>=0&&noise<8){ noise++; count++; continue } flush(); continue }
        noise=0;
        if(start<0){ start=o; count=1; prev=e; continue }
        if(prev&&e.sector===prev.sector+Math.ceil(prev.size/2048)) strict++;
        count++; prev=e;
      }
      flush();
    }
  });
  // 詰まり「率」で並べると、たまたま数件そろっただけの短い並びが勝ってしまう。
  // 隙間なくつながっている「本数」で並べ、あとでアーカイブを実際に読んで確かめる（scoreTables）
  found.sort((a,b)=>(b.strict-a.strict)||(b.count-a.count));
  return found.slice(0,12);
}
function readTable(exe,t){
  const dv=new DataView(exe.buffer,exe.byteOffset,exe.byteLength), dec=TABLE_SHAPES[t.shape||0].dec, out=[];
  for(let i=0;i<t.count;i++){
    const a=dv.getUint32(t.off+i*8,true), b=dv.getUint32(t.off+i*8+4,true);
    out.push({no:i,...dec(a,b)});
  }
  return out;
}
// ============================================================
//  ファイルの見分け（先頭だけ読んで種類をあてる）
// ============================================================
// トバルの入れ子: 先頭に「部分の数」と「各部分の位置」が並ぶ。
// モデルのファイルは、その部分0がゲーム独自の圧縮（先頭 0x0b）になっている。
function classify(head,size){
  if(head.length>=12){
    const dv=new DataView(head.buffer,head.byteOffset,head.byteLength), n=dv.getUint32(0,true);
    if(n>=1&&n<=4096&&4+4*(n+1)<=head.length){
      const offs=[]; for(let i=0;i<=n;i++) offs.push(dv.getUint32(4+i*4,true));
      // 末尾はぴったり size とは限らない（セクタの切りで余りが付く）。<= で見る
      let ok=offs[0]===4+4*(n+1)&&offs[n]<=size&&offs[n]>=offs[0];
      for(let i=0;i<n&&ok;i++) if(offs[i+1]<offs[i]||offs[i+1]>size) ok=false;
      if(ok){
        const p0=offs[0]<head.length?head[offs[0]]:-1;
        return {kind:p0===0x0b?"model":"pack", parts:n, packed:p0===0x0b, offs};
      }
    }
  }
  if(head[0]===0x0b) return {kind:"lz", parts:0};
  if(head.length>=4&&head[0]===0x10&&head[1]===0&&head[2]===0&&head[3]===0) return {kind:"tim", parts:0};
  return {kind:"raw", parts:0};
}
const KIND_LABEL={model:"モデルらしい",pack:"入れ子",lz:"圧縮",tim:"TIM 画像",raw:"そのまま",err:"読めない"};
async function probeEntry(e){
  if(state.probe.has(e.key)) return state.probe.get(e.key);
  let r;
  try{ r=classify(await readHead(e,Math.min(e.size,2048)),e.size) }
  catch(err){ r={kind:"err",parts:0,err:err.message} }
  state.probe.set(e.key,r); return r;
}
// 部分の中から、テクスチャ（VRAM への転送の列）らしいものを探す
function looksVram(d){
  if(d.length<16) return false;
  const dv=new DataView(d.buffer,d.byteOffset,d.byteLength), n=dv.getUint32(0,true);
  if(n<1||n>512) return false;
  let o=4;
  for(let k=0;k<n;k++){
    if(o+12>d.length) return false;
    const x=dv.getUint16(o,true), y=dv.getUint16(o+2,true), w=dv.getUint16(o+8,true), h=dv.getUint16(o+10,true);
    if(x>1023||y>511||w<1||h<1||w>1024||h>512||x+w>1024||y+h>512) return false;
    o+=12+w*h*2;
  }
  return o<=d.length&&o>=d.length-16;
}
function findVram(parts){
  for(let i=1;i<parts.length;i++){
    let d=parts[i]; if(!d||!d.length) continue;
    try{ if(d[0]===0x0b) d=decompress(d) }catch(_){ continue }
    if(looksVram(d)) return {index:i,vram:buildVram(parts[i])};
  }
  return {index:-1,vram:new Uint8Array(1024*512*4)};
}
// テクスチャ: VRAM への転送の列（x, y, 種類, 0, 幅, 高さ ＋ 16bit×幅×高さ）
function buildVram(part){
  const vram=new Uint8Array(1024*512*4);
  if(!part||!part.length) return vram;
  let d=part; try{ if(part[0]===0x0b) d=decompress(part) }catch(_){ return vram }
  const dv=new DataView(d.buffer,d.byteOffset,d.byteLength);
  let o=4;
  for(let k=dv.getUint32(0,true);k>0&&o+12<=d.length;k--){
    const x=dv.getUint16(o,true), y=dv.getUint16(o+2,true), w=dv.getUint16(o+8,true), h=dv.getUint16(o+10,true); o+=12;
    for(let j=0;j<h;j++) for(let i=0;i<w;i++){ const q=((y+j)*1024+x+i)*4, s=o+(j*w+i)*2; if(x+i<1024&&y+j<512&&s+1<d.length){vram[q]=d[s];vram[q+1]=d[s+1]} }
    o+=w*h*2;
  }
  return vram;
}
