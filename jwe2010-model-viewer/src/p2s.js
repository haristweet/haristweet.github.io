// PCSX2 のステートセーブ（.p2s）から選手の表を読む。
// .p2s は zip。中の eeMemory.bin（PS2 のメモリ 32MB）を取り出す。新しい PCSX2 は zstd（方式 93）、古いものは deflate（方式 8）
async function jwP2sMemory(file){
  const tail=new Uint8Array(await file.slice(Math.max(0,file.size-65558)).arrayBuffer()), td=new DataView(tail.buffer);
  let e=tail.length-22; while(e>=0&&td.getUint32(e,true)!==0x06054b50) e--;
  if(e<0) throw new Error("ステートセーブ（.p2s）として読めません（zip ではない）");
  const n=td.getUint16(e+10,true), cdSize=td.getUint32(e+12,true), cdOff=td.getUint32(e+16,true);
  const cd=new Uint8Array(await file.slice(cdOff,cdOff+cdSize).arrayBuffer()), cv=new DataView(cd.buffer), names=[];
  for(let i=0,p=0;i<n;i++){
    const method=cv.getUint16(p+10,true), csize=cv.getUint32(p+20,true), nl=cv.getUint16(p+28,true), xl=cv.getUint16(p+30,true), cl=cv.getUint16(p+32,true), lo=cv.getUint32(p+42,true);
    const name=new TextDecoder().decode(cd.subarray(p+46,p+46+nl)); names.push(name); p+=46+nl+xl+cl;
    if(name!=="eeMemory.bin") continue;
    const lh=new DataView(await file.slice(lo,lo+30).arrayBuffer()), d=lo+30+lh.getUint16(26,true)+lh.getUint16(28,true);
    const z=new Uint8Array(await file.slice(d,d+csize).arrayBuffer());
    if(method===0) return z;
    if(method===93) return fzstd.decompress(z);
    if(method===8) return new Uint8Array(await new Response(new Blob([z]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer());
    throw new Error(`eeMemory.bin の縮め方（${method}）に対応していません`);
  }
  throw new Error(`ステートセーブの中に eeMemory.bin がありません（${names.slice(0,6).join("・")}）`);
}
// 選手の記録は 1 人 0x7C バイト。0 から名前（UTF-16、16 字）、0x20 から背中の名前（ASCII、16 字）。
// 名前と背中の名前として読める記録がいちばん長く続く所を表とする（関口のセーブでは 0x194B43C から 4,609 人）
const JW_REC=0x7C;
function jwRecOk(m,a){
  if(a<0||a+JW_REC>m.length) return false;
  const u16=i=>m[a+i*2]|m[a+i*2+1]<<8;
  if(u16(0)<0x20) return false;
  let end=false;
  for(let i=0;i<16;i++){ const c=u16(i); if(c===0) end=true; else if(end||c<0x20||(c>=0xd800&&c<0xe000)) return false }
  if(!end) return false;
  end=false;
  for(let i=0;i<16;i++){ const c=m[a+0x20+i]; if(c===0) end=true; else if(end||c<0x20||c>0x7e) return false }
  return end;
}
function jwFindTable(m){
  let best={at:-1,n:0};
  for(let a=0;a+JW_REC<=m.length;a+=4){
    if(!jwRecOk(m,a)||jwRecOk(m,a-JW_REC)) continue;
    let n=1; while(jwRecOk(m,a+n*JW_REC)) n++;
    if(n>best.n) best={at:a,n};
  }
  return best;
}
// 顔・髪のファイル番号（0_TEXT.AFS の番号）。メモリに読み込まれていた顔・髪のファイルと、その選手の記録の値を突き合わせて決めた
//   顔 ＝ 0x5C の 16 ビットの下 12 ビット ＋ 921（関口 2456→#3377・菅井 2460→#3381・萬代 2461→#3382）
//   髪 ＝ 0x64 の 16 ビットの上 11 ビット ＋ 6614（関口 574→#7188・菅井 578→#7192・萬代 579→#7193）
// 足す数は表の値とファイルの番号の差で、ゲームの中でどう決めているかは見ていない
function jwPlayer(m,a,i){
  const u16=o=>m[a+o]|m[a+o+1]<<8, dec=new TextDecoder("utf-16le");
  let nl=0; while(nl<16&&u16(nl*2)) nl++;
  let sl=0; while(sl<16&&m[a+0x20+sl]) sl++;
  return {i,at:a,name:dec.decode(m.subarray(a,a+nl*2)),shirt:String.fromCharCode(...m.subarray(a+0x20,a+0x20+sl)),
    face:(u16(0x5c)&0xfff)+921,hair:(u16(0x64)>>5)+6614};
}
function jwPlayers(m){
  const t=jwFindTable(m);
  if(t.n<100) throw new Error("ステートセーブのメモリに選手の表が見つかりません（ゲームの画面が出ているときに取ったセーブを使ってください）");
  return Array.from({length:t.n},(_,i)=>jwPlayer(m,t.at+i*JW_REC,i));
}
