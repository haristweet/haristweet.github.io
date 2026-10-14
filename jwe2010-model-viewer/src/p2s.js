// PCSX2 のステートセーブ（.p2s）から選手の表を読む。
// .p2s は zip。中の eeMemory.bin（PS2 のメモリ 32MB）を取り出す。新しい PCSX2 は zstd（方式 93）、古いものは deflate（方式 8）
// 中の 1 つのファイル（name）を取り出す。無ければ null（eeMemory.bin のときはエラー）
async function jwP2sFile(file,want){
  const tail=new Uint8Array(await file.slice(Math.max(0,file.size-65558)).arrayBuffer()), td=new DataView(tail.buffer);
  let e=tail.length-22; while(e>=0&&td.getUint32(e,true)!==0x06054b50) e--;
  if(e<0) throw new Error("ステートセーブ（.p2s）として読めません（zip ではない）");
  const n=td.getUint16(e+10,true), cdSize=td.getUint32(e+12,true), cdOff=td.getUint32(e+16,true);
  const cd=new Uint8Array(await file.slice(cdOff,cdOff+cdSize).arrayBuffer()), cv=new DataView(cd.buffer), names=[];
  for(let i=0,p=0;i<n;i++){
    const method=cv.getUint16(p+10,true), csize=cv.getUint32(p+20,true), nl=cv.getUint16(p+28,true), xl=cv.getUint16(p+30,true), cl=cv.getUint16(p+32,true), lo=cv.getUint32(p+42,true);
    const name=new TextDecoder().decode(cd.subarray(p+46,p+46+nl)); names.push(name); p+=46+nl+xl+cl;
    if(name!==want) continue;
    const lh=new DataView(await file.slice(lo,lo+30).arrayBuffer()), d=lo+30+lh.getUint16(26,true)+lh.getUint16(28,true);
    const z=new Uint8Array(await file.slice(d,d+csize).arrayBuffer());
    if(method===0) return z;
    if(method===93) return fzstd.decompress(z);
    if(method===8) return new Uint8Array(await new Response(new Blob([z]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer());
    throw new Error(`${want} の縮め方（${method}）に対応していません`);
  }
  if(want!=="eeMemory.bin") return null;
  throw new Error(`ステートセーブの中に eeMemory.bin がありません（${names.slice(0,6).join("・")}）`);
}
async function jwP2sMemory(file){ return jwP2sFile(file,"eeMemory.bin") }
// 画面用メモリ（GS.bin の 425 バイト目から 4MB。田村・永井・PK のセーブで確かめた）。無ければ null
async function jwP2sVram(file){ const g=await jwP2sFile(file,"GS.bin"); return g&&g.length>=425+4194304?g.subarray(425,425+4194304):null }
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
// 顔・髪のファイル番号（0_TEXT.AFS の番号）。ゲームがメモリに持つ「読み込み済みの顔・髪」の表（0x556AA0〜、表示中の選手に印）と照らして決めた
//   顔 ＝ 0x64 の 16 ビットの上 11 ビット ＋ 区分ごとの始まり。区分＝0x73 の下 2 ビット（1＝J リーグの選手など #2804〜、2＝#1943〜、0＝#2107〜、3＝#1783〜）
//   髪 ＝ 0x5C の 16 ビットの下 12 ビット ＋ 4733
// 区分 1・2・0 の始まりは読み込まれていた顔と一致（関口・梁・林・朴・レイナルド・エリゼウ・サーレス・シルビーニョなど）。
// 区分 3 の #1783 は顔のファイルの先頭（#1783〜#4266 の 2,484 個＝区分 3・2・0・1 の順に並ぶと数が合う）からの推測。
// 髪の値が 1044 より小さいと #5777 より前の小さなファイル（髪の形だけ？）になる。v0.1.0〜0.1.1 は顔と髪の欄を取り違えていた
const JW_FACE_BASE=[2107,2804,1943,1783], JW_HAIR_BASE=4733;
function jwPlayer(m,a,i){
  const u16=o=>m[a+o]|m[a+o+1]<<8, dec=new TextDecoder("utf-16le");
  let nl=0; while(nl<16&&u16(nl*2)) nl++;
  let sl=0; while(sl<16&&m[a+0x20+sl]) sl++;
  return {i,at:a,name:dec.decode(m.subarray(a,a+nl*2)),shirt:String.fromCharCode(...m.subarray(a+0x20,a+0x20+sl)),
    face:(u16(0x64)>>5)+JW_FACE_BASE[m[a+0x73]&3],hair:(u16(0x5c)&0xfff)+JW_HAIR_BASE};
}
function jwPlayers(m){
  const t=jwFindTable(m);
  if(t.n<100) throw new Error("ステートセーブのメモリに選手の表が見つかりません（ゲームの画面が出ているときに取ったセーブを使ってください）");
  return Array.from({length:t.n},(_,i)=>jwPlayer(m,t.at+i*JW_REC,i));
}
// チーム名の表と名簿（v0.3.0）。どちらもセーブのメモリから読む
//   チーム名: 1 チーム 0x5C バイト。0＝名前（UTF-8、48 バイトまで）、0x31＝短い名前、0x3C＝チームの番号（0,1,2,…と並ぶ）。0 番がベガルタ仙台
//   名簿: 1 チーム 32 枠（u16）。中身は選手の表の何番目か＋1（0＝空き）。関口のセーブでは 0x19D8CA0（選手の表の後ろ）。
//   同じ並びの写しが 0xA51210 にもあるが、174 番目のチームから中身が違うので、選手の表にいちばん近い方を使う
function jwFindTeams(m){
  const dv=new DataView(m.buffer,m.byteOffset,m.byteLength), U=a=>dv.getUint32(a,true);
  for(let a=0;a+0x5c*100<=m.length;a+=4){
    if(U(a+0x3c)!==0||U(a+0x5c+0x3c)!==1||U(a+0xb8+0x3c)!==2) continue;
    let n=3; while(a+(n+1)*0x5c<=m.length&&U(a+n*0x5c+0x3c)===n) n++;
    if(n>=100) return {at:a,n};
  }
  return null;
}
function jwFindRosters(m,np,near){
  const dv=new DataView(m.buffer,m.byteOffset,m.byteLength), H=a=>dv.getUint16(a,true), out=[];
  for(let r=0;r+64*100<=m.length;r+=2){
    if(H(r)!==1||H(r+2)!==2||H(r+4)!==3) continue;
    let good=0;
    for(let t=0;t<100;t++){ const v=[]; for(let k=0;k<32;k++){ const w=H(r+t*64+k*2); if(w) v.push(w) }
      if(v.length>=10&&v.every((w,i)=>w<=np&&(!i||v[i-1]<w))) good++ }
    if(good>=90) out.push(r);
  }
  out.sort((a,b)=>Math.abs(a-near)-Math.abs(b-near));
  return out[0]??null;
}
function jwTeams(m,players){
  const t=jwFindTeams(m); if(!t) return [];
  const np=players.length, r=jwFindRosters(m,np,players[0]?.at??0); if(r===null) return [];
  const dec=new TextDecoder("utf-8",{fatal:true}), out=[];
  for(let i=0;i<t.n;i++){
    const a=t.at+i*0x5c; let name;
    try{ let e=0; while(e<48&&m[a+e]) e++; name=dec.decode(m.subarray(a,a+e)) }catch(e){ continue }
    const mem=[]; let ok=true;
    for(let k=0;k<32;k++){ const w=m[r+i*64+k*2]|m[r+i*64+k*2+1]<<8; if(!w) continue; if(w>np||(mem.length&&w-1<=mem.at(-1))){ ok=false; break } mem.push(w-1) }
    // 名簿の並びが崩れているチーム（選抜・オールスターなど）は出さない
    // 背番号: 名簿の 0x1710 バイト前から 1 チーム 32 バイト。名簿と同じ並びで「番号−1」（0xFF は無し）。
    //   ベガルタの林 16・関口 11・梁 10・永井 8、鹿島の曽ヶ端 21 など実際の番号と合う（v0.5.0。4 つのセーブで同じ場所）
    const na=r-0x1710+i*32, nums=mem.map((_,k)=>na>=0&&m[na+k]<99?m[na+k]+1:null);
    if(ok&&mem.length&&name) out.push({i,name,members:mem,numbers:nums});
  }
  return out;
}
