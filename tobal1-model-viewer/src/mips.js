function mipsOpTableLines(exe){
  const list=mipsOpTable(exe,true);
  if(!list||!list.length) return ["  振り分け表が見つからない"];
  const L=[];
  list.slice(0,3).forEach((T,i)=>{
    L.push(`  ${i===0?"":"べつの"}表 ${hexA(T.at)}　${T.n}件`
      +`　長さの分かった処理 ${T.known}/${T.n}`
      +(T.dup.length?`　同じ処理を指す組 ${T.dup.join(" ")}`:""));
    for(const e of T.ents)
      L.push(`    ${e.op} → ${hexA(e.addr)}　`
        +(e.len?`長さ ${e.len}バイト（尻尾 ${hexA(e.tail)}）`
               :"長さは分からない（この処理の中に尻尾が無い）"));
  });
  return L;
}
// ============================================================
//  MIPS(R3000) の逆アセンブラ
//
//  トバルNo.1 の実行ファイルの中から、モデルを読んでいる場所を探して中身を読むため。
//  手掛かりは署名 0x90000000 との比較。これは必ず `lui ○, 0x9000` という命令になり、
//  バイト列では 00 90 ?? 3C と並ぶ。そこを起点に、前後へ関数の切れ目まで広げて出す。
// ============================================================
const MIPS_REG=["zero","at","v0","v1","a0","a1","a2","a3","t0","t1","t2","t3","t4","t5","t6","t7",
                "s0","s1","s2","s3","s4","s5","s6","s7","t8","t9","k0","k1","gp","sp","fp","ra"];
const MIPS_SPECIAL={0x00:"sll",0x02:"srl",0x03:"sra",0x04:"sllv",0x06:"srlv",0x07:"srav",
  0x08:"jr",0x09:"jalr",0x0c:"syscall",0x0d:"break",0x10:"mfhi",0x11:"mthi",0x12:"mflo",0x13:"mtlo",
  0x18:"mult",0x19:"multu",0x1a:"div",0x1b:"divu",0x20:"add",0x21:"addu",0x22:"sub",0x23:"subu",
  0x24:"and",0x25:"or",0x26:"xor",0x27:"nor",0x2a:"slt",0x2b:"sltu"};
const MIPS_OP={0x08:"addi",0x09:"addiu",0x0a:"slti",0x0b:"sltiu",0x0c:"andi",0x0d:"ori",0x0e:"xori",
  0x20:"lb",0x21:"lh",0x22:"lwl",0x23:"lw",0x24:"lbu",0x25:"lhu",0x26:"lwr",
  0x28:"sb",0x29:"sh",0x2a:"swl",0x2b:"sw",0x2e:"swr"};
// GTE（座標を変換する専用回路）。頂点を触るところに必ず出てくる
const GTE_OP={0x01:"RTPS",0x06:"NCLIP",0x0c:"OP",0x10:"DPCS",0x11:"INTPL",0x12:"MVMVA",0x13:"NCDS",
  0x14:"CDP",0x16:"NCDT",0x1b:"NCCS",0x1c:"CC",0x1e:"NCS",0x20:"NCT",0x28:"SQR",0x29:"DCPL",
  0x2a:"DPCT",0x2d:"AVSZ3",0x2e:"AVSZ4",0x30:"RTPT",0x3d:"GPF",0x3e:"GPL",0x3f:"NCCT"};
const r=n=>"$"+MIPS_REG[n];
const s16=v=>v&0x8000?v-0x10000:v;
function mipsDis(w,pc){
  if(w===0) return "nop";
  const op=w>>>26, rs=(w>>>21)&31, rt=(w>>>16)&31, rd=(w>>>11)&31, sa=(w>>>6)&31,
        fn=w&63, im=w&0xffff, tgt=((pc&0xf0000000)|((w&0x3ffffff)<<2))>>>0;
  const br=()=>"0x"+((pc+4+s16(im)*4)>>>0).toString(16);
  const jt=()=>"0x"+tgt.toString(16);
  if(op===0){
    const n=MIPS_SPECIAL[fn]; if(!n) return `.word 0x${w.toString(16)}`;
    if(fn===0x08) return `jr ${r(rs)}`;
    if(fn===0x09) return `jalr ${r(rd)}, ${r(rs)}`;
    if(fn<=0x03) return `${n} ${r(rd)}, ${r(rt)}, ${sa}`;
    if(fn>=0x10&&fn<=0x13) return `${n} ${r(fn&1?rs:rd)}`;
    if(fn>=0x18&&fn<=0x1b) return `${n} ${r(rs)}, ${r(rt)}`;
    return `${n} ${r(rd)}, ${r(rs)}, ${r(rt)}`;
  }
  if(op===1) return `${rt&1?"bgez":"bltz"} ${r(rs)}, ${br()}`;
  if(op===2||op===3) return `${op===2?"j":"jal"} ${jt()}`;
  if(op===4) return `beq ${r(rs)}, ${r(rt)}, ${br()}`;
  if(op===5) return `bne ${r(rs)}, ${r(rt)}, ${br()}`;
  if(op===6) return `blez ${r(rs)}, ${br()}`;
  if(op===7) return `bgtz ${r(rs)}, ${br()}`;
  if(op===0x0f) return `lui ${r(rt)}, 0x${im.toString(16)}`;
  if(op===0x12){                                   // COP2 = GTE
    if(rs===0) return `mfc2 ${r(rt)}, $${rd}`;
    if(rs===2) return `cfc2 ${r(rt)}, $${rd}`;
    if(rs===4) return `mtc2 ${r(rt)}, $${rd}`;
    if(rs===6) return `ctc2 ${r(rt)}, $${rd}`;
    const g=GTE_OP[w&0x3f]; return g?`${g}`:`cop2 0x${(w&0x1ffffff).toString(16)}`;
  }
  if(op===0x32) return `lwc2 $${rt}, ${s16(im)}(${r(rs)})`;
  if(op===0x3a) return `swc2 $${rt}, ${s16(im)}(${r(rs)})`;
  const n=MIPS_OP[op];
  if(!n) return `.word 0x${w.toString(16)}`;
  if(op>=0x20) return `${n} ${r(rt)}, ${s16(im)}(${r(rs)})`;
  if(op>=0x0c&&op<=0x0e) return `${n} ${r(rt)}, ${r(rs)}, 0x${im.toString(16)}`;
  return `${n} ${r(rt)}, ${r(rs)}, ${s16(im)}`;
}
// 実行ファイルの中身（ヘッダ 2048 バイトのあと）が text 番地に載る
function exeText(exe){
  const i=exeInfo(exe);
  return i.ok?{body:exe.subarray(0x800),base:i.text}:null;
}
// 起点から前後へ、関数の切れ目（addiu $sp,$sp,-N ／ jr $ra）まで広げる
function mipsFunc(body,at,maxBack,maxFwd){
  const dv=new DataView(body.buffer,body.byteOffset,body.byteLength);
  let s=at;
  for(let k=0;k<(maxBack||160);k++){ const p=at-k*4; if(p<0) break;
    const w=dv.getUint32(p,true);
    if((w>>>16)===0x27bd&&(w&0x8000)){ s=p; break }            // addiu $sp, $sp, -N
    s=p;
  }
  let e=at;
  for(let k=0;k<(maxFwd||200);k++){ const p=at+k*4; if(p+4>body.length) break;
    e=p+8;                                                      // jr のあとの1命令まで
    if(dv.getUint32(p,true)===0x03e00008) break;                // jr $ra
  }
  return {from:s,to:Math.min(e,body.length)};
}
// 署名 0x90000000 を作る lui を探す
function findModelCode(exe){
  const t=exeText(exe); if(!t) return [];
  const dv=new DataView(t.body.buffer,t.body.byteOffset,t.body.byteLength);
  const hits=[];
  for(let p=0;p+4<=t.body.length;p+=4){
    const w=dv.getUint32(p,true);
    if((w>>>26)===0x0f&&(w&0xffff)===0x9000) hits.push(p);      // lui ??, 0x9000
  }
  return hits.map(at=>({at,addr:t.base+at,...mipsFunc(t.body,at)}));
}
function mipsLines(exe,fn,mark){
  const t=exeText(exe); if(!t) return [];
  const dv=new DataView(t.body.buffer,t.body.byteOffset,t.body.byteLength);
  const L=[];
  for(let p=fn.from;p<fn.to&&p+4<=t.body.length;p+=4){
    const w=dv.getUint32(p,true);
    L.push(`    ${p===mark?"→":" "} 0x${(t.base+p).toString(16)}  ${w.toString(16).padStart(8,"0")}  ${mipsDis(w,t.base+p)}`);
  }
  return L;
}

// 見つけた関数が呼んでいる先を集める。モデルを開く関数から、部品を読む関数へ辿るため
function mipsCalls(exe,fn){
  const t=exeText(exe); if(!t) return [];
  const dv=new DataView(t.body.buffer,t.body.byteOffset,t.body.byteLength);
  const out=[], seen=new Set();
  for(let p=fn.from;p<fn.to&&p+4<=t.body.length;p+=4){
    const w=dv.getUint32(p,true);
    if((w>>>26)!==3) continue;                                   // jal だけ
    const addr=((((t.base+p)&0xf0000000)|((w&0x3ffffff)<<2))>>>0);
    const off=addr-t.base;
    if(off<0||off+4>t.body.length||seen.has(off)) continue;
    seen.add(off);
    out.push({at:off,addr,from:off,to:mipsFunc(t.body,off,0,400).to});
  }
  return out;
}

// 番地を指定して n 命令ぶん読む（関数の切れ目に関係なく見たいとき）
function mipsBlock(exe,addr,n,label){
  const t=exeText(exe); if(!t) return [];
  const off=addr-t.base;
  if(off<0||off+4>t.body.length) return [];
  const dv=new DataView(t.body.buffer,t.body.byteOffset,t.body.byteLength);
  const L=[`  ${label||""}${hexAddr(addr)}:`];
  for(let k=0;k<n&&off+k*4+4<=t.body.length;k++){
    const w=dv.getUint32(off+k*4,true);
    L.push(`      ${hexAddr(addr+k*4)}  ${w.toString(16).padStart(8,"0")}  ${mipsDis(w,addr+k*4)}`);
  }
  return L;
}
const hexAddr=a=>"0x"+(a>>>0).toString(16);
// 関数の中の分岐の飛び先を集める（命令ごとの処理はこの先にある）
function mipsBranches(exe,fn){
  const t=exeText(exe); if(!t) return [];
  const dv=new DataView(t.body.buffer,t.body.byteOffset,t.body.byteLength);
  const out=[], seen=new Set();
  for(let p=fn.from;p<fn.to&&p+4<=t.body.length;p+=4){
    const w=dv.getUint32(p,true), op=w>>>26, pc=t.base+p;
    let a=-1;
    if(op===4||op===5||op===6||op===7||op===1) a=(pc+4+((w&0x8000?(w&0xffff)-0x10000:(w&0xffff))*4))>>>0;
    else if(op===2) a=(((pc&0xf0000000)|((w&0x3ffffff)<<2))>>>0);
    if(a<0) continue;
    const off=a-t.base;
    if(off<0||off+4>t.body.length) continue;
    if(off>=fn.from&&off<fn.to) continue;      // 関数の中なら出さない
    if(seen.has(off)) continue;
    seen.add(off); out.push(a);
  }
  return out;
}
// lui + addiu の組から番地を割り出し、そこを表として読む（飛び先の表を見つけるため）
function mipsTables(exe,fn){
  const t=exeText(exe); if(!t) return [];
  const dv=new DataView(t.body.buffer,t.body.byteOffset,t.body.byteLength);
  const hi=new Map(), out=[], seen=new Set();
  for(let p=fn.from;p<fn.to&&p+4<=t.body.length;p+=4){
    const w=dv.getUint32(p,true), op=w>>>26, rs=(w>>>21)&31, rt=(w>>>16)&31, im=w&0xffff;
    if(op===0x0f){ hi.set(rt,im); continue }
    if(op===0x09&&hi.has(rs)&&rs===rt){
      const a=((hi.get(rs)<<16)+(im&0x8000?im-0x10000:im))>>>0;
      const off=a-t.base;
      if(off<0||off+4>t.body.length||seen.has(off)) continue;
      seen.add(off);
      const vals=[];
      for(let k=0;k<20&&off+k*4+4<=t.body.length;k++) vals.push(dv.getUint32(off+k*4,true));
      // 実行ファイルの中の番地が並んでいれば、それは飛び先の表
      const looksTable=vals.slice(0,6).filter(v=>v>=t.base&&v<t.base+t.body.length).length>=4;
      out.push({addr:a,vals,looksTable});
    }
  }
  return out;
}

// 命令ごとの「1つの長さ」を、コードから自動で割り出す。
// どの処理も最後は `j ループの先頭` に戻り、その次の命令（遅延スロット）で
// `addiu $fp, $fp, N` と進めている。この N が命令の長さ。
// あわせて、頂点ポインタ（スクラッチパッド 1016）を動かすか、3つ目の語を読むかも見る。
function mipsCmdInfo(exe,handler,loopAddr,limit){
  const t=exeText(exe); if(!t) return null;
  const dv=new DataView(t.body.buffer,t.body.byteOffset,t.body.byteLength);
  let off=handler-t.base;
  if(off<0||off+4>t.body.length) return null;
  const lens=new Set(); let vertMove=false, reads=new Set(), gte=false;
  for(let k=0;k<(limit||300);k++){
    const p=off+k*4; if(p+8>t.body.length) break;
    const w=dv.getUint32(p,true), op=w>>>26, rs=(w>>>21)&31, im=w&0xffff;
    if(op===0x2b&&im===1016) vertMove=true;              // sw ?, 1016($s0)
    if(op===0x23&&rs===30) reads.add(im);                // lw ?, N($fp)
    if(op===0x12&&(w&0x3f)===0x30) gte=true;             // RTPT
    if(op===2&&((((handler+k*4)&0xf0000000)|((w&0x3ffffff)<<2))>>>0)===loopAddr){
      const d=dv.getUint32(p+4,true);                    // 遅延スロット
      if((d>>>26)===0x09&&((d>>>21)&31)===30&&((d>>>16)&31)===30)
        lens.add(d&0x8000?(d&0xffff)-0x10000:(d&0xffff));
      break;                                             // ここで処理は終わり。次の命令の処理に食い込まない
    }
    if(w===0x03e00008) break;                            // jr $ra
  }
  return {lens:[...lens].sort((a,b)=>a-b),vertMove,reads:[...reads].sort((a,b)=>a-b),gte};
}
// 命令の振り分け（beq の連鎖と飛び先の表）を読み取って、番号→処理 の対応を作る
function mipsDispatch(exe,fn){
  const t=exeText(exe); if(!t) return [];
  const dv=new DataView(t.body.buffer,t.body.byteOffset,t.body.byteLength);
  const out=[]; let pend=-1;
  for(let p=fn.from;p<fn.to&&p+4<=t.body.length;p+=4){
    const w=dv.getUint32(p,true), op=w>>>26, pc=t.base+p;
    if(op===0x0d&&((w>>>21)&31)===0){ pend=w&0xffff; continue }        // ori $v0, $zero, K
    if(op===4&&pend>=0){                                               // beq $v1, $v0, target
      out.push({code:pend,addr:(pc+4+((w&0x8000?(w&0xffff)-0x10000:(w&0xffff))*4))>>>0});
      pend=-1;
    }
  }
  return out;
}

// ある番地（グローバル変数）を読み書きしている場所を実行ファイル全体から探す。
// MIPS はいつも「lui で上位16bit → lw/sw で下位をずらす」の2手なので、その形を追う
// このゲームはグローバル変数を $gp 相対で読み書きしている（lw $v1, 3444($gp) など）。
// $gp は起動時に決まった値が入り、以後変わらないので、それを入れておけば
// lui を経由しない読み書きも追える。これを見ていなかったために
// 「骨の表を用意しているコードが無い」と何度も見誤っていた
const MIPS_GP=28;
function mipsRefs(exe,addr,limit,gp){
  const t=exeText(exe); if(!t) return [];
  const dv=new DataView(t.body.buffer,t.body.byteOffset,t.body.byteLength);
  const hi=new Array(32).fill(-1), out=[];   // 上位16bit。符号なしで持つ
  if(gp) hi[MIPS_GP]=gp>>>0;                // $gp は動かないので、ずっと入れておく
  const MEM=op=>(op>=0x20&&op<=0x2e)||op===0x30||op===0x32||op===0x38||op===0x3a;
  for(let p=0;p+4<=t.body.length;p+=4){
    const w=dv.getUint32(p,true), op=w>>>26, rs=(w>>>21)&31, rt=(w>>>16)&31, rd=(w>>>11)&31;
    const im=w&0xffff, se=im>0x7fff?im-0x10000:im;
    // $gp は動かない。データ領域の語が偶然 lui $gp に見えると、
    // そこで $gp が壊れて、以後ずっと嘘の番地を出す（0x3c3c0b18 がそれだった）
    if(op===0x0f){ if(!(gp&&rt===MIPS_GP)) hi[rt]=(im<<16)>>>0; continue }   // lui
    // lui のあと addiu/ori で番地を作り、その register を土台に読み書きすることがある。
    // これを追わないと、構造体ごしの書き込みを取りこぼす（0x800CBE90 がまさにそれだった）
    if(op===0x09&&hi[rs]>=0){ if(!(gp&&rt===MIPS_GP)) hi[rt]=((hi[rs]+se)>>>0); continue }  // addiu
    if(op===0x0d&&hi[rs]>=0){ if(!(gp&&rt===MIPS_GP)) hi[rt]=((hi[rs]|im)>>>0); continue }  // ori
    if(MEM(op)){
      if(hi[rs]>=0&&((hi[rs]+se)>>>0)===(addr>>>0)) out.push({at:t.base+p,store:op>=0x28,w});
      if(op>=0x20&&op<=0x27&&rt!==MIPS_GP) hi[rt]=-1;            // 読み込み先は上位が消える（$gp は別）
      if(out.length>=(limit||16)) break;
      continue;
    }
    if(op===0){ if(rd!==MIPS_GP) hi[rd]=-1 }
    else if(op!==0x02&&op!==0x03&&op>=0x08&&rt!==MIPS_GP) hi[rt]=-1;   // 分岐以外は行き先の上位が消える
  }
  return out;
}

// ある「範囲」を読み書きしている場所を探す。番地を1つずつ指定するのでは、
// 構造体の先頭を土台にして別のずれで書く形を取りこぼす
function mipsRefsRange(exe,from,to,limit,gp){
  const t=exeText(exe); if(!t) return [];
  const dv=new DataView(t.body.buffer,t.body.byteOffset,t.body.byteLength);
  const hi=new Array(32).fill(-1), out=[];
  if(gp) hi[MIPS_GP]=gp>>>0;
  const MEM=op=>(op>=0x20&&op<=0x2e)||op===0x30||op===0x32||op===0x38||op===0x3a;
  for(let p=0;p+4<=t.body.length;p+=4){
    const w=dv.getUint32(p,true), op=w>>>26, rs=(w>>>21)&31, rt=(w>>>16)&31, rd=(w>>>11)&31;
    const im=w&0xffff, se=im>0x7fff?im-0x10000:im;
    if(op===0x0f){ if(!(gp&&rt===MIPS_GP)) hi[rt]=(im<<16)>>>0; continue }
    if(op===0x09&&hi[rs]>=0){ if(!(gp&&rt===MIPS_GP)) hi[rt]=((hi[rs]+se)>>>0); continue }
    if(op===0x0d&&hi[rs]>=0){ if(!(gp&&rt===MIPS_GP)) hi[rt]=((hi[rs]|im)>>>0); continue }
    if(MEM(op)){
      if(hi[rs]>=0){ const a=((hi[rs]+se)>>>0);
        if(a>=(from>>>0)&&a<=(to>>>0)) out.push({at:t.base+p,addr:a,store:op>=0x28,w}) }
      if(op>=0x20&&op<=0x27&&rt!==MIPS_GP) hi[rt]=-1;
      if(out.length>=(limit||24)) break;
      continue;
    }
    if(op===0){ if(rd!==MIPS_GP) hi[rd]=-1 }
    else if(op!==0x02&&op!==0x03&&op>=0x08&&rt!==MIPS_GP) hi[rt]=-1;
  }
  return out;
}
// 番地からその関数の範囲を割り出して、丸ごと字にする
function mipsFuncAt(exe,addr,cap){
  const t=exeText(exe); if(!t) return [];
  const off=addr-t.base; if(off<0||off>=t.body.length) return [];
  const fn=mipsFunc(t.body,off,4,cap||200);
  return mipsLines(exe,fn,fn.from);
}

// 命令の処理はどれも同じ形で終わっている：
//   j <振り分けへ戻る>
//   addiu $fp, $fp, <その命令の長さ>     ← 遅延スロット
// 0x8001F444 の命令5がまさにそれで、addiu $fp,$fp,4 は命令5の長さ4と一致した。
// この形を実行ファイル全体から拾えば、命令ごとの長さと処理の場所が
// データから推測しなくても分かる。$fp は 30 番
const MIPS_FP=30;
function mipsCmdTails(exe,disp){
  const t=exeText(exe); if(!t) return [];
  const dv=new DataView(t.body.buffer,t.body.byteOffset,t.body.byteLength);
  const out=[];
  for(let p=0;p+8<=t.body.length;p+=4){
    const w=dv.getUint32(p,true);
    if((w>>>26)!==2) continue;                                  // j
    const tgt=((((t.base+p)&0xf0000000)>>>0)|((w&0x3ffffff)<<2))>>>0;
    if(disp!=null&&tgt!==(disp>>>0)) continue;
    const d=dv.getUint32(p+4,true);                             // 遅延スロット
    if((d>>>26)!==9) continue;                                  // addiu
    if(((d>>>21)&31)!==MIPS_FP||((d>>>16)&31)!==MIPS_FP) continue;
    const im=d&0xffff;
    out.push({at:t.base+p,to:tgt,len:im>0x7fff?im-0x10000:im});
  }
  return out;
}
// 振り分けの番地は決め打ちにしない。上の形でいちばん多く戻っている先がそれ
function mipsFindDispatch(exe){
  const all=mipsCmdTails(exe,null);
  if(!all.length) return 0;
  const by=new Map();
  for(const x of all) by.set(x.to,(by.get(x.to)||0)+1);
  return [...by.entries()].sort((a,b)=>b[1]-a[1])[0][0];
}
// 拾った尻尾を、長さごとにまとめて貼れる形にする
function mipsCmdTailLines(exe){
  const disp=mipsFindDispatch(exe);
  if(!disp) return ["  命令の処理の尻尾が見つからない"];
  const tails=mipsCmdTails(exe,disp);
  const L=[`  振り分けの戻り先 ${hexA(disp)}　命令の処理 ${tails.length}個`];
  const by=new Map();
  for(const x of tails){ if(!by.has(x.len)) by.set(x.len,[]); by.get(x.len).push(x.at) }
  for(const [len,ats] of [...by.entries()].sort((a,b)=>a[0]-b[0]))
    L.push(`    長さ ${len}バイト: ${ats.length}個　${ats.map(hexA).join(" ")}`);
  return L;
}
function hexA(v){ return "0x"+(v>>>0).toString(16) }

// 振り分け表は「処理の番地が並んだ配列」なので、拾った尻尾のまわりに
// 収まる語が並んでいる場所を探せばいい。並びの番号がそのまま命令の番号。
// これが分かれば、命令14と15の長さを「若い番号を小さいほうに」という
// こちらが決めた規則で選ぶ必要がなくなる
function mipsOpTable(exe,all){
  const t=exeText(exe); if(!t) return null;
  const disp=mipsFindDispatch(exe); if(!disp) return null;
  const tails=mipsCmdTails(exe,disp).sort((a,b)=>a.at-b.at);
  if(!tails.length) return null;
  const lo=Math.min(disp,tails[0].at)-0x2000, hi=tails[tails.length-1].at+0x1000;
  const dv=new DataView(t.body.buffer,t.body.byteOffset,t.body.byteLength);
  const inRange=v=>v>=lo&&v<=hi&&(v&3)===0;
  const runs=[];
  for(let p=0;p+4<=t.body.length;p+=4){
    if(!inRange(dv.getUint32(p,true))) continue;
    let q=p; while(q+4<=t.body.length&&inRange(dv.getUint32(q,true))) q+=4;
    const n=(q-p)/4;
    if(n>=4) runs.push({at:t.base+p,n});
    p=q;
  }
  if(!runs.length) return null;
  runs.sort((a,b)=>b.n-a.n);
  const build=r=>{
    const addrs=[];
    for(let k=0;k<r.n;k++) addrs.push(dv.getUint32(r.at-t.base+k*4,true));
    const set=new Set(addrs);
    const ents=addrs.map((a,k)=>{
      // 尻尾がこの処理のものだと言えるのは、
      //   ・その番地より後ろにあって
      //   ・間に別の処理の頭が挟まっていなくて
      //   ・そこそこ近い（0x200 以内）
      // とき。そうでなければ「分からない」と出す。
      // 中身を見ずに「番地以上で最初の尻尾」を当てると、
      // 遠くにある1個へ全部が吸い寄せられて、一律の長さになってしまう
      const tl=tails.find(x=>x.at>=a&&x.at<a+0x200
        &&!addrs.some(b=>b>a&&b<=x.at));
      return {op:k,addr:a,len:tl?tl.len:0,tail:tl?tl.at:0};
    });
    return {at:r.at,n:r.n,ents,disp,
            known:ents.filter(e=>e.len).length,
            // 処理の番地が重なっている組（同じ描き方をする命令）
            dup:addrs.map((a,k)=>[a,k]).filter(([a],i)=>addrs.indexOf(a)!==i)
                 .map(([a,k])=>`${addrs.indexOf(a)}=${k}`)};
  };
  return all?runs.map(build):build(runs[0]);
}
function mipsOpTableLines(exe){
  const T=mipsOpTable(exe);
  if(!T) return ["  振り分け表が見つからない"];
  const L=[`  振り分け表 ${hexA(T.at)}　${T.n}件（戻り先 ${hexA(T.disp)}）`];
  for(const e of T.ents)
    L.push(`    命令${e.op} → ${hexA(e.addr)}　長さ ${e.len||"?"}バイト`);
  return L;
}

// 角度から行列を作っている所を、サイン表から手繰る。
//
// 外からの助言：ディスクに32バイトの行列が無いのは当たり前で、
// PS1 の初期3Dでは姿勢を「関節ごとの角度＋親からのずれ」で持ち、
// 毎フレーム FK（順運動学）で行列に組み立てて RAM に展開する。
// つまり探すべきは行列ではなく、**角度から行列を作っている処理**のほう。
//
// 角度から回転行列を作るには必ずサイン表が要る。
// サイン表は「int16 が一周ぶん並び、山と谷が 4096 前後」という、
// でたらめなバイト列ではまず起きない形をしている。
// 見つければ、それを読んでいる関数が行列を作っている所
function mipsFindSinTable(exe,limit){
  const t=exeText(exe); if(!t) return [];
  const dv=new DataView(t.body.buffer,t.body.byteOffset,t.body.byteLength);
  const out=[], seen=new Set();
  // 実物は int32 だった（先頭 00 00 00 00 / 64 00 00 00 / c8 00 00 00 …
  // ＝ 0, 100, 200 ＝ 4096×sin(2πi/256)）。
  // int16 としてだけ見ていたので「512段」と出していたが、正しくは
  // **1周256段・4バイト刻み**。角度は1バイト（0〜255）で持てる。
  // 幅を決め打ちにしていたのが間違いだったので、2バイトと4バイトの両方を見る
  for(const w of [4,2]) for(const n of [256,512,1024,4096]){
    for(let p=0;p+n*w<=t.body.length;p+=16){
      const rd=i=>w===4?dv.getInt32(p+i*4,true):dv.getInt16(p+i*2,true);
      const a0=rd(0), q=rd(n>>2);
      if(Math.abs(a0)>64) continue;
      if(Math.abs(Math.abs(q)-4096)>96) continue;
      let bad=0; const one=Math.abs(q);
      for(let i=0;i<n;i+=Math.max(1,n>>6)){
        const v=rd(i), e=Math.round(one*Math.sin(2*Math.PI*i/n));
        if(Math.abs(v-e)>one*0.03){ bad++; if(bad>1) break }
      }
      if(bad<=1){
        const at=t.base+p;
        if(seen.has(at)) continue;                 // 同じ場所を幅違いで二度出さない
        seen.add(at);
        out.push({at,n,one,w});
        if(out.length>=(limit||8)) return out;
      }
    }
  }
  return out;
}
// 見つけたサイン表を、外からもらった照合用のバイト列と突き合わせる。
//   512段・振幅4096:  00 00 32 00 64 00 97 00 C9 00 FB 00 2D 01 5E 01
//   4096段・振幅4096: 00 00 06 00 0D 00 13 00 19 00 1F 00 26 00 2C 00
// 先頭16バイトをそのまま出すので、どちらなのか（どちらでもないのか）が分かる。
//
// そして肝心なのは、その表を**読んでいる所**。
// 0x8004B8A0 なら lui 0x8005 ＋ addiu -0x4760 で作られるはずで、
// その形は mipsAddrOf が拾える。見つかればそこが行列を組んでいる関数
function mipsSinTableLines(exe,gp){
  const L=mipsFindSinTable(exe,8);
  if(!L.length) return ["  サイン表は見つからない"];
  const t=exeText(exe);
  const dv=t&&new DataView(t.body.buffer,t.body.byteOffset,t.body.byteLength);
  const out=[];
  for(const x of L){
    const off=t?x.at-t.base:-1;
    let head="";
    if(dv&&off>=0&&off+16<=t.body.length){
      const b=[]; for(let i=0;i<16;i++) b.push(t.body[off+i].toString(16).padStart(2,"0"));
      head=`　先頭16バイト ${b.join(" ")}`;
    }
    out.push(`  サイン表 ${hexA(x.at)}　一周 ${x.n}段　${x.w}バイト刻み　1.0＝${x.one}`
      +`（角度は${x.n<=256?"1バイト":x.n<=512?"9ビット":"それ以上"}で持てる）${head}`);
    // 表の番地を作っている所＝行列を組んでいる関数の入口
    const mk=mipsAddrOf(exe,x.at-64,x.at+64,12,gp);
    out.push(`    番地を作っている所: `
      +(mk.length?mk.map(r=>`${hexA(r.at)}→${hexA(r.addr)}(${r.how})`).join(" ")
                 :"見つからない")); 
  }
  const has4096=L.some(x=>x.n===4096), has1024=L.some(x=>x.n===1024);
  out.push(`  （Psy-Q の標準は 1周4096段・振幅4096。`
    +`4096段 ${has4096?"あり":"なし"}／1024段 ${has1024?"あり":"なし"}）`);
  return out;
}
// サイン表を作っている所を含む関数を丸ごと出す。ここが行列を組む処理のはず
// サイン表を引いている所を、**まとめて一つの範囲で**出す。
//
// 実物では参照が 0x8005A580 / 0x8005A6D8 / 0x8005A738 と 0x1B8 の中に
// 固まっていた。関数の頭から数十行だけ出すやり方では、3つとも見えない。
// 外からの見立てでは「3か所＝X軸・Y軸・Z軸の回転」。
// それを確かめるには、3つを含む範囲を丸ごと見る必要がある
function mipsSinUserLines(exe,gp,cap,skip){
  const L=mipsFindSinTable(exe,4);
  const out=[];
  for(const x of L){
    let refs=mipsAddrOf(exe,x.at-64,x.at+64,12,gp).map(r=>r.at);
    if(skip) refs=refs.filter(a=>!skip.some(b=>Math.abs(a-b)<0x200));
    if(!refs.length) continue;
    // 近いものどうしを一group にまとめる（0x400 以内なら同じかたまり）
    refs.sort((a,b)=>a-b);
    const groups=[[refs[0]]];
    for(let i=1;i<refs.length;i++){
      const g=groups[groups.length-1];
      if(refs[i]-g[g.length-1]<=0x400) g.push(refs[i]); else groups.push([refs[i]]);
    }
    for(const g of groups.slice(0,2)){
      const from=g[0]-0x40, to=g[g.length-1]+0x60;
      out.push(`  サイン表 ${hexA(x.at)} を引いている所 ${g.length}か所`
        +`（${g.map(hexA).join(" ")}）のまわり:`);
      out.push(...mipsCmdBody(exe,from,to,cap||72));
      if(out.length>90) return out;
    }
    if(out.length) return out;
  }
  return ["  サイン表を使っている関数は見つからない"];
}
// 表の番地を「どこかの構造体の一部」として書いている所を探す。
//
// 外からの助言：固定番地に直接書くのではなく、
//   sw $reg, offset($base)
// の形で、$base に構造体の先頭が入っている実装が普通。
// だから表そのものの番地を作る場所を探しても出てこない。
// 表の少し手前・少し後ろまで広げて、番地を作っている所を全部出す
function mipsNearAddrLines(exe,lo,hi,gp){
  const hits=mipsAddrOf(exe,lo,hi,24,gp);
  if(!hits.length) return [`  ${hexA(lo)}〜${hexA(hi)} の番地を作っている所は見つからない`];
  return [`  ${hexA(lo)}〜${hexA(hi)} の番地を作っている所 ${hits.length}件:`]
    .concat(hits.map(x=>`    ${hexA(x.at)} → ${hexA(x.addr)}（${x.how}・$${x.reg}）`));
}

// 命令ひとつぶんの処理を、飛び先から尻尾まで丸ごと出す。
//
// 命令3と命令6は短い（尻尾までそれぞれ数命令）のに、まだ意味が分かっていない。
// 命令6の中身は ±4 の交互で、4 は表がひとつ進む量そのもの
//   0x8001f464  addiu $t0, $t0, 4     ← 命令5が表Aを4進める
// なので、命令6は「骨をひとつ進める／ひとつ戻す」ではないか。
// もしそうなら、骨の番号を命令5だけで数えているこちらの数え方が間違っている。
// 推測で進めず、処理をそのまま読む
function mipsCmdBody(exe,from,to,cap){
  const t=exeText(exe); if(!t) return [];
  const a=from-t.base, b=Math.min(to-t.base+8,a+(cap||32)*4);
  if(a<0||a>=t.body.length) return [];
  return mipsLines(exe,{from:a,to:Math.min(b,t.body.length)},-1);
}
function mipsShortCmdLines(exe,ops){
  const M=mipsCmdMap(exe);
  if(!M) return ["  振り分けが読めない"];
  const L=[];
  for(const e of M.ents){
    if(ops&&ops.indexOf(e.op)<0) continue;
    if(!e.tail) continue;
    L.push(`  命令${e.op} の処理 ${hexA(e.addr)}〜${hexA(e.tail)}:`);
    L.push(...mipsCmdBody(exe,e.addr,e.tail,16));
  }
  return L.length?L:["  短い命令の処理が読めない"];
}

// 振り分けを丸ごと読んで、命令ごとの飛び先と長さを出す。
//
// 0x8001EFA8 はこうなっている：
//   lw    $v1, 0($fp)        命令の番号
//   lw    $s6, 4($fp)        語1（面の命令ではその枚数）
//   addiu $v0, $v1, -7
//   blez  $v0, <beqの並びへ>   7以下は ori＋beq で振り分ける
//   lw    $t0, 1020($s0)     表の先頭（0x80021FEC）
//   addu  $t0, $t0, $v0      表[命令-7]
//   addiu $fp, $fp, 8        ← 表を使う命令（8以上）はどれも8バイト
//   jr    $v1
// なので「8以上＝面の命令＝命令の列では8バイト」は、コードに書いてある。
// 面1枚が何バイトかは別の話で、それは処理の中の addiu $s2,$s2,N にある
const MIPS_S2=18;
function mipsFaceStep(exe,addr,cap){
  const t=exeText(exe); if(!t) return 0;
  const off=addr-t.base; if(off<0||off>=t.body.length) return 0;
  const dv=new DataView(t.body.buffer,t.body.byteOffset,t.body.byteLength);
  for(let k=0,p=off;k<(cap||160)&&p+4<=t.body.length;k++,p+=4){
    const w=dv.getUint32(p,true);
    if((w>>>26)===9&&((w>>>21)&31)===MIPS_S2&&((w>>>16)&31)===MIPS_S2){
      const im=w&0xffff; return im>0x7fff?im-0x10000:im;      // addiu $s2,$s2,N
    }
  }
  return 0;
}
// 命令ごとに「飛び先・尻尾・長さ」をまとめる。
// 長さは、その飛び先の後ろにあって間に別の飛び先が挟まらない尻尾から取る
function mipsCmdMap(exe){
  const t=exeText(exe); if(!t) return null;
  const disp=mipsFindDispatch(exe); if(!disp) return null;
  const tails=mipsCmdTails(exe,disp).sort((a,b)=>a.at-b.at);
  const fn=mipsFuncAt(exe,disp,64);            // 逆アセンブルは使わず番地だけ要る
  // 振り分けの手前から読むと、関係のない ori＋beq を拾って
  // 幽霊の行（命令2 → 0x8001efa4 など）が出る。振り分けの頭から読む
  const raw=mipsDispatch(exe,{from:disp-t.base,to:disp-t.base+0x100});
  const seen=new Set(), chain=[];
  for(const c of raw){ if(seen.has(c.code)) continue; seen.add(c.code); chain.push(c) }
  const heads=chain.map(c=>c.addr).sort((a,b)=>a-b);
  const ents=chain.sort((a,b)=>a.code-b.code).map(c=>{
    const tl=tails.find(x=>x.at>=c.addr&&!heads.some(h=>h>c.addr&&h<=x.at));
    return {op:c.code,addr:c.addr,len:tl?tl.len:0,tail:tl?tl.at:0};
  });
  // 表を使う側（8以上）。表の先頭は lui＋addiu で作って $s0 に控えている
  const dv=new DataView(t.body.buffer,t.body.byteOffset,t.body.byteLength);
  let tbl=0;
  for(let p=Math.max(0,disp-t.base-0x40);p<disp-t.base;p+=4){
    const w=dv.getUint32(p,true);
    if((w>>>26)!==0x0f) continue;                                  // lui
    const nx=dv.getUint32(p+4,true);
    if((nx>>>26)!==9) continue;                                    // addiu
    const im=nx&0xffff, se=im>0x7fff?im-0x10000:im;
    tbl=(((w&0xffff)<<16)+se)>>>0;
  }
  return {disp,tbl,ents,tails:tails.length,
          used:ents.filter(e=>e.len).length};
}
function mipsCmdMapLines(exe){
  const M=mipsCmdMap(exe);
  if(!M) return ["  振り分けが読めない"];
  const L=[`  振り分け ${hexA(M.disp)}　表の先頭 ${hexA(M.tbl)}（命令8以上は 表[命令-7]、命令の列では8バイト）`,
           `  命令7以下（ori＋beq で振り分け）${M.used}/${M.ents.length}件で長さが取れた:`];
  for(const e of M.ents)
    L.push(`    命令${e.op} → ${hexA(e.addr)}　`
      +(e.len?`長さ ${e.len}バイト（尻尾 ${hexA(e.tail)}）`:"長さは分からない"));
  return L;
}
// 読み終わったので、まとめには1行で出す。
// 振り分けの中身そのものは長い報告のほうにある
function mipsCmdMapBrief(exe){
  const M=mipsCmdMap(exe);
  if(!M) return ["  振り分けが読めない"];
  return [`  命令の長さ（振り分け ${hexA(M.disp)}／表 ${hexA(M.tbl)}）: `
    +M.ents.map(e=>`${e.op}:${e.len||"?"}`).join(" ")
    +"　命令8以上は列では8バイト"];
}
function mipsFaceSizeBrief(exe,tbl,ops){
  const v=[];
  for(const op of ops||[8,9,10,11,12,13,14,15]){
    const a=mipsTableAt(exe,tbl+(op-7)*4,1)[0];
    v.push(`${op}:${a?(mipsFaceStep(exe,a)||"?"):"?"}`);
  }
  return ["  面1枚あたりのバイト数: "+v.join(" ")];
}
// 面の命令（8以上）が、面1枚あたり何バイト進むか
function mipsFaceSizeLines(exe,tbl,ops){
  const L=[];
  for(const op of ops||[8,9,10,11,12,13,14,15]){
    const a=mipsTableAt(exe,tbl+(op-7)*4,1)[0];
    if(!a){ L.push(`    命令${op} → 飛び先が読めない`); continue }
    const n=mipsFaceStep(exe,a);
    L.push(`    命令${op} → ${hexA(a)}　面1枚 ${n?n+"バイト":"分からない"}`);
  }
  return L;
}

// 「その番地を register に作っている場所」を探す。lui＋addiu で番地を組み立てて
// 関数に渡す形は、読み書きの命令として現れないので、これを見ないと取りこぼす
// gp を渡すと「addiu $?, $gp, N」で番地を作る形も拾う。
// このゲームはグローバルを $gp 相対で触るので、
//   addiu $a0, $gp, 432     ← 表の番地を作って関数に渡す
// という形になりうる。lui＋addiu しか見ていないと丸ごと取りこぼす。
// mipsRefs で同じ取りこぼしを一度やっている（v3.36.0）ので、こちらも直す
function mipsAddrOf(exe,from,to,limit,gp){
  const t=exeText(exe); if(!t) return [];
  const dv=new DataView(t.body.buffer,t.body.byteOffset,t.body.byteLength);
  const hi=new Array(32).fill(-1), out=[];
  const hit=(p,a,rt,how)=>{
    if(a<(from>>>0)||a>(to>>>0)) return false;
    out.push({at:t.base+p,addr:a,reg:rt,how});
    return out.length>=(limit||16);
  };
  for(let p=0;p+4<=t.body.length;p+=4){
    const w=dv.getUint32(p,true), op=w>>>26, rs=(w>>>21)&31, rt=(w>>>16)&31, rd=(w>>>11)&31;
    const im=w&0xffff, se=im>0x7fff?im-0x10000:im;
    if(gp&&op===0x09&&rs===MIPS_GP&&rt!==MIPS_GP){
      const a=((gp>>>0)+se)>>>0;
      hi[rt]=a;
      if(hit(p,a,rt,"$gp＋ずれ")) break;
      continue;
    }
    if(op===0x0f){ hi[rt]=(im<<16)>>>0; continue }
    if((op===0x09||op===0x0d)&&hi[rs]>=0){
      const a=op===0x09?((hi[rs]+se)>>>0):((hi[rs]|im)>>>0);
      hi[rt]=a;
      if(hit(p,a,rt,"lui＋addiu")) break;
      continue;
    }
    if(op===0){ if(rd!==MIPS_GP) hi[rd]=-1 }
    else if(op!==0x02&&op!==0x03&&op>=0x08&&rt!==MIPS_GP) hi[rt]=-1;
  }
  return out;
}
// ジャンプ表を番地から直に読む（命令ごとの処理の飛び先）
function mipsTableAt(exe,addr,n){
  const t=exeText(exe); if(!t) return [];
  const off=addr-t.base; if(off<0||off+n*4>t.body.length) return [];
  const dv=new DataView(t.body.buffer,t.body.byteOffset,t.body.byteLength);
  const out=[];
  for(let k=0;k<n;k++) out.push(dv.getUint32(off+k*4,true));
  return out;
}
// 命令の処理の中で最初に呼んでいる関数（jal の飛び先）を返す。
// 面を描く処理はどれも「数を足して、描く関数を呼ぶ」形なので、
// この飛び先が同じ命令どうしは、1枚の大きさも同じはず
function mipsJalIn(exe,addr,n){
  const t=exeText(exe); if(!t) return 0;
  const off=addr-t.base; if(off<0) return 0;
  const dv=new DataView(t.body.buffer,t.body.byteOffset,t.body.byteLength);
  for(let k=0;k<(n||12)&&off+k*4+4<=t.body.length;k++){
    const w=dv.getUint32(off+k*4,true);
    // 符号ありの | で潰れないよう、最後にまとめて符号なしに直す
    if((w>>>26)===3) return ((((addr+k*4)&0xf0000000)|((w&0x03ffffff)<<2))>>>0);
  }
  return 0;
}

// 起動時の $gp は PS-X EXE ヘッダの +0x14 に入っていることになっているが、
// 0 のままの実行ファイルも多い（トバルNo.1 もそうだった）。
// その場合でも $gp はコードの中で必ず作られる:
//     lui  $gp, 0x800d
//     addiu $gp, $gp, -0x2ac0
// この形を実行ファイル全体から拾い、いちばん多く出てくる値を採る。
// $gp は動かない前提の土台なので、作る場所は数えるほどしかない
function mipsFindGp(exe){
  const t=exeText(exe); if(!t) return 0;
  const dv=new DataView(t.body.buffer,t.body.byteOffset,t.body.byteLength);
  const tally=new Map(); let hi=-1;
  for(let p=0;p+4<=t.body.length;p+=4){
    const w=dv.getUint32(p,true), op=w>>>26, rs=(w>>>21)&31, rt=(w>>>16)&31;
    const im=w&0xffff, se=im>0x7fff?im-0x10000:im;
    if(op===0x0f&&rt===MIPS_GP){ hi=(im<<16)>>>0; continue }        // lui $gp
    if(hi>=0&&rt===MIPS_GP&&rs===MIPS_GP){
      let v=0;
      if(op===0x09) v=(hi+se)>>>0;                                   // addiu $gp,$gp,imm
      else if(op===0x0d) v=(hi|im)>>>0;                              // ori  $gp,$gp,imm
      else { hi=-1; continue }
      tally.set(v,(tally.get(v)||0)+1); hi=-1; continue;
    }
    if(rt===MIPS_GP||rs===MIPS_GP) hi=-1;
  }
  if(!tally.size) return 0;
  return [...tally].sort((a,b)=>b[1]-a[1]||a[0]-b[0])[0][0];
}

// ============================================================
//  命令の列を読んでいる関数を「呼んでいる側」を探す
//  表A・表B に番地を入れている所が、読み書きの形では見つからない。
//  handler の中でしか触っていないということは、
//  最初の値は「別の register を土台にした書き込み」で入っている。
//  それは呼び出し元にあるはずなので、呼び出し元を読む
// ============================================================
function mipsFuncRange(exe,addr){
  const t=exeText(exe); if(!t) return null;
  const off=addr-t.base; if(off<0||off>=t.body.length) return null;
  const fn=mipsFunc(t.body,off,400,400);
  return {from:t.base+fn.from,to:t.base+fn.to,off:fn};
}
function mipsCallersOf(exe,target,limit){
  const t=exeText(exe); if(!t) return [];
  const dv=new DataView(t.body.buffer,t.body.byteOffset,t.body.byteLength);
  const out=[], tgt=target>>>0;
  for(let p=0;p+4<=t.body.length;p+=4){
    const w=dv.getUint32(p,true);
    if((w>>>26)!==3) continue;                                  // jal だけ
    const a=(((t.base&0xf0000000)>>>0)|((w&0x03ffffff)<<2))>>>0;
    if(a===tgt){ out.push(t.base+p); if(out.length>=(limit||16)) break }
  }
  return out;
}
// 呼び出しの前後を出す。引数を作っている所が前に並んでいる
function mipsCallSiteLines(exe,at,back,fwd){
  const t=exeText(exe); if(!t) return [];
  const off=at-t.base; if(off<0||off>=t.body.length) return [];
  const from=Math.max(0,off-(back||10)*4), to=Math.min(t.body.length,off+((fwd||2)+1)*4);
  return mipsLines(exe,{from,to},off);
}
function mipsCallerLines(exe,target,nCallers,back){
  const fr=mipsFuncRange(exe,target);
  if(!fr) return ["  呼ばれている関数の範囲が取れない"];
  const cs=mipsCallersOf(exe,fr.from,16);
  const L=[`  命令の列を読む関数 ${hexA(fr.from)}〜${hexA(fr.to)}`
    +`　呼んでいる所 ${cs.length}件`+(cs.length?"： "+cs.map(hexA).join(" "):"（見つからない）")];
  for(const c of cs.slice(0,nCallers||2)){
    L.push(`  ${hexA(c)} の呼び出しの手前:`);
    L.push(...mipsCallSiteLines(exe,c,back||10,1));
  }
  return L;
}

// ============================================================
//  「進めている入れもの」を全部探す
//  命令5は表A・表Bを4ずつ進めていた。呼び出し元を読んだら、
//  0x800CC910 を 32 ずつ進めている所が出てきた——32バイトは
//  PS1 の MATRIX ちょうど1個ぶん。
//  番地を決め打ちで追うのはもうやめる。
//  「読んで・足して・同じ所に書き戻す」形を全部拾えば、
//  行列の並びも、その他の並びも、まとめて出てくる
// ============================================================
function mipsCursorScan(exe,gp,opt){
  const t=exeText(exe); if(!t) return [];
  const dv=new DataView(t.body.buffer,t.body.byteOffset,t.body.byteLength);
  const hi=new Array(32).fill(-1);          // register が指している番地
  const src=new Array(32).fill(-1);         // その register が「どこから読んだ値」か
  const add=new Array(32).fill(0);          // 読んでから足した量
  if(gp) hi[MIPS_GP]=gp>>>0;
  const out=[], o=opt||{};
  const clear=r=>{ if(!(gp&&r===MIPS_GP)){ hi[r]=-1; src[r]=-1; add[r]=0 } };
  for(let p=0;p+4<=t.body.length;p+=4){
    const w=dv.getUint32(p,true), op=w>>>26, rs=(w>>>21)&31, rt=(w>>>16)&31, rd=(w>>>11)&31;
    const im=w&0xffff, se=im>0x7fff?im-0x10000:im;
    // $gp を上書きさせない。ここを守らないと、データ領域の 0x3c3c…（lui $gp に
    // 見える語）ひとつで $gp が壊れ、以後の番地が全部でたらめになる
    if(op===0x0f){ if(!(gp&&rt===MIPS_GP)){ hi[rt]=(im<<16)>>>0; src[rt]=-1; add[rt]=0 } continue }
    if(op===0x09){                                                           // addiu
      if(gp&&rt===MIPS_GP) continue;
      if(src[rs]>=0&&rs!==MIPS_GP){ src[rt]=src[rs]; add[rt]=add[rs]+se;
                                    hi[rt]=hi[rs]>=0?((hi[rs]+se)>>>0):-1; continue }
      if(hi[rs]>=0){ hi[rt]=((hi[rs]+se)>>>0); src[rt]=-1; add[rt]=0; continue }
      clear(rt); continue;
    }
    if(op===0x23){                                                           // lw
      const a=hi[rs]>=0?((hi[rs]+se)>>>0):-1;
      if(!(gp&&rt===MIPS_GP)){ hi[rt]=-1; src[rt]=a; add[rt]=0 }
      continue;
    }
    if(op===0x2b){                                                           // sw
      const a=hi[rs]>=0?((hi[rs]+se)>>>0):-1;
      if(a>=0&&src[rt]===a&&add[rt]!==0) out.push({addr:a,step:add[rt],at:t.base+p});
      continue;
    }
    if(op===0){ clear(rd) }
    else if(op!==0x02&&op!==0x03&&op>=0x08) clear(rt);
    if(out.length>=(o.limit||64)) break;
  }
  // 同じ入れものを何度も進めていることがある。番地と進める量でまとめる
  const by=new Map();
  for(const x of out){ const k=x.addr+"/"+x.step;
    if(!by.has(k)) by.set(k,{...x,n:0,ats:[]});
    const v=by.get(k); v.n++; if(v.ats.length<4) v.ats.push(x.at) }
  return [...by.values()].sort((a,b)=>b.step-a.step||a.addr-b.addr);
}
// 進め方が何を意味するか。
// 同じ入れものを 20・24・36・40 と、いろいろな量で進めているなら、
// それは行列の並びではなく GPU のパケットを積む所。
// 20=POLY_F4 24=POLY_G3 28=POLY_FT3 32=POLY_G4 36=POLY_GT3 40=POLY_GT4
const GPU_PACKET=new Set([12,16,20,24,28,32,36,40,44,48]);
function mipsCursorByAddr(exe,gp){
  const cs=mipsCursorScan(exe,gp), by=new Map();
  for(const c of cs){
    if(!by.has(c.addr)) by.set(c.addr,{addr:c.addr,steps:[],n:0,bySt:[]});
    const v=by.get(c.addr); v.steps.push(c.step); v.n+=c.n;
    // 進める量ごとに、何か所で動かしているかを覚えておく。
    // 「＋32 と −32 の両方ある」だけでは、積み下ろし（push/pop）なのか、
    // 一方向に進んで最後に1回戻すだけなのか、区別が付かない
    v.bySt.push({step:c.step,n:c.n,ats:c.ats.slice(0,3)});
    if(!v.ats||v.ats.length<3){ v.ats=(v.ats||[]).concat(c.ats.slice(0,2)) }
  }
  for(const v of by.values()){
    v.steps=[...new Set(v.steps)].sort((a,b)=>a-b);
    // いろいろな大きさで進めている＝パケットを積む所
    v.packet=v.steps.length>=3&&v.steps.every(x=>GPU_PACKET.has(x));
    v.matrix=!v.packet&&v.steps.length===1&&v.steps[0]===32;
  }
  // 1ずつ進むものは、ただの数え上げ。行列さがしには関係ないので後ろへ
  const rank=v=>v.matrix?0:(v.steps.some(x=>x>=8)?1:2);
  return [...by.values()].sort((a,b)=>rank(a)-rank(b)||a.addr-b.addr);
}
// 積み下ろしか、一方向に進むだけか。
// ＋と−の「か所の数」が釣り合っていれば積み下ろし。
// 片方が1か所だけなら、それは最後の後始末で、階層のたどりではない
function mipsCursorFlow(v){
  if(!v||!v.bySt) return "";
  const up=v.bySt.filter(x=>x.step>0).reduce((a,x)=>a+x.n,0);
  const dn=v.bySt.filter(x=>x.step<0).reduce((a,x)=>a+x.n,0);
  if(!up||!dn) return "";
  // これはコードの「場所の数」であって、実際に何回動くかではない。
  // 輪の中で毎回進めて、抜けるときに1回戻す形でも、場所の数は 1対1 になる。
  // 数だけで積み下ろしかどうかを決めてはいけない——
  // v4.17.0 でそう決めて、また間違えた。逆アセンブルを見るしかない
  return `＋の場所 ${up}／−の場所 ${dn}`
    +"（場所の数であって回数ではない。積み下ろしかどうかは下の逆アセンブルで見る）";
}
function mipsCursorMean(v){
  if(v.packet) return "→ 進め方がばらばら。GPUのパケットを積む所（行列ではない）";
  if(v.matrix) return "→ 32バイトずつだけ。行列の並びらしい";
  if(v.steps.length===1&&v.steps[0]===4) return "→ 4バイトずつだけ。ポインタの並び";
  if(v.steps.length===1&&v.steps[0]===20) return "→ 20バイトずつだけ。光源の行列らしい";
  return "";
}
function mipsCursorLines(exe,gp){
  const vs=mipsCursorByAddr(exe,gp);
  if(!vs.length) return ["  読んで足して書き戻している所は見つからない"];
  const L=[`  読んで・足して・同じ所に書き戻している入れもの ${vs.length}件`
    +`（行列らしいもの ${vs.filter(v=>v.matrix).length}件）:`];
  // 1ずつ進むものは読み終わった。行列さがしに効くものだけ残す
  for(const v of vs.filter(v=>v.steps.some(x=>Math.abs(x)>=8)).slice(0,5))
    L.push(`    ${hexA(v.addr)} を ${v.steps.join("/")} ずつ`
      +`（${v.n}か所 ${(v.ats||[]).slice(0,3).map(hexA).join(" ")}）　${mipsCursorMean(v)}`
      +(mipsCursorFlow(v)?"　"+mipsCursorFlow(v):""));
  return L;
}
function mipsCursorPick(exe,gp){ return mipsCursorByAddr(exe,gp).find(v=>v.matrix)||null }

// ============================================================
//  表に最初の値を入れている所を、まとめて読む
//  $gp を壊していたあいだは「読み1・書き1」しか見えず、どちらも
//  命令5の処理そのものだった。直したら書き込みが3か所ずつになった。
//  増えたぶんは 0x8001A18C 付近に固まっている——そこが仕込みの場所
// ============================================================
function mipsSetupSites(exe,addrs,gp,skipFrom){
  const sites=[];
  for(const a of addrs)
    for(const r of mipsRefs(exe,a,24,gp))
      if(r.store&&!(skipFrom&&r.at>=skipFrom)) sites.push({addr:a,at:r.at});
  sites.sort((x,y)=>x.at-y.at);
  return sites;
}
// 仕込みの場所が固まっているなら、その塊を丸ごと字にする
function mipsSetupWindow(exe,addrs,gp,opt){
  const o=opt||{}, sites=mipsSetupSites(exe,addrs,gp,o.skipFrom);
  if(!sites.length) return {sites,lines:["  表に値を入れている所は見つからない"]};
  // いちばん手前の書き込みから、近いものだけを1つの塊とみなす
  const first=sites[0].at;
  const near=sites.filter(s=>s.at-first<=(o.span||0x80));
  const last=near[near.length-1].at;
  const t=exeText(exe); if(!t) return {sites,lines:["  実行ファイルが読めない"]};
  const from=Math.max(0,first-t.base-(o.back||12)*4);
  const to=Math.min(t.body.length,last-t.base+(o.fwd||3)*4);
  return {sites,near,lines:mipsLines(exe,{from,to},first-t.base)};
}

// ============================================================
//  外側の命令列（場面の組み立て）
//  0x8001A184 で分かった：表A・表B・表C に入る値は、$s0 が歩いている
//  「外側の命令列」から読んだ語そのもの。つまり骨の行列の並びは
//  ディスクにも実行ファイルにも無く、この列で渡されている。
//  この列には 24 個の命令がある（sltiu $a0, 24）。
//  0x800CC910 は +32 と -32 の両方で動いている＝行列の積み上げ／取り出し。
//  階層はこの列の積み上げ／取り出しで表されている
// ============================================================
// 飛び先の並びを、番地の範囲から探す（振り分けの形に頼らない）
function mipsJumpTable(exe,lo,hi,n){
  const t=exeText(exe); if(!t) return null;
  const dv=new DataView(t.body.buffer,t.body.byteOffset,t.body.byteLength);
  const ok=v=>v>=lo&&v<hi&&(v&3)===0;
  let best=null;
  for(let p=0;p+4<=t.body.length;p+=4){
    if(!ok(dv.getUint32(p,true))) continue;
    let q=p; while(q+4<=t.body.length&&ok(dv.getUint32(q,true))) q+=4;
    const cnt=(q-p)/4;
    if(cnt>=n&&(!best||cnt>best.n)) best={at:t.base+p,n:cnt};
    p=q;
  }
  if(!best) return null;
  const addrs=[];
  for(let k=0;k<Math.min(best.n,n);k++)
    addrs.push(dv.getUint32(best.at-t.base+k*4,true));
  return {at:best.at,n:best.n,addrs};
}
// それぞれの命令が何をしているか、要点だけ見る。
// 全部を字にすると長すぎるので、「どの入れものを触ったか」で言い当てる
// 命令の処理はどれも同じ所へ j で戻る。その戻り先まで読んでしまうと、
// 戻り先の仕事（行列を積む・進める）が全部の命令に混ざって見える。
// 命令20 が「語8個・行列積む」に見えたのはこれだった
function mipsCommonTail(exe,addrs){
  const t=exeText(exe); if(!t) return 0;
  const dv=new DataView(t.body.buffer,t.body.byteOffset,t.body.byteLength);
  const cnt=new Map();
  for(const a of addrs){
    const off=a-t.base; if(off<0||off>=t.body.length) continue;
    for(let k=0;k<32;k++){
      const p=off+k*4; if(p+4>t.body.length) break;
      const w=dv.getUint32(p,true);
      if((w>>>26)===0x02){
        const d=(((t.base&0xf0000000)>>>0)|((w&0x03ffffff)<<2))>>>0;
        cnt.set(d,(cnt.get(d)||0)+1); break;
      }
    }
  }
  let best=0,bn=0;
  for(const [d,n] of cnt) if(n>bn){ bn=n; best=d }
  return bn>=3?best:0;
}
function mipsOpGist(exe,addr,gp,marks,cap,stopAt){
  const t=exeText(exe); if(!t) return "";
  const off=addr-t.base; if(off<0||off>=t.body.length) return "";
  const dv=new DataView(t.body.buffer,t.body.byteOffset,t.body.byteLength);
  const hi=new Array(32).fill(-1); if(gp) hi[MIPS_GP]=gp>>>0;
  const hit=new Set(); let jal=0, words=0, step=0;
  for(let k=0;k<(cap||24);k++){
    const p=off+k*4; if(p+4>t.body.length) break;
    // 共通の戻り先に入ったら、そこから先は数えない。
    // 命令の中身を見る前に止めないと、戻り先の仕事が混ざる
    if(stopAt&&t.base+p===(stopAt>>>0)) break;
    const w=dv.getUint32(p,true), op=w>>>26, rs=(w>>>21)&31, rt=(w>>>16)&31;
    const im=w&0xffff, se=im>0x7fff?im-0x10000:im;
    if(op===0x0f){ if(!(gp&&rt===MIPS_GP)) hi[rt]=(im<<16)>>>0; continue }
    if(op===0x09){ if(hi[rs]>=0&&!(gp&&rt===MIPS_GP)) hi[rt]=((hi[rs]+se)>>>0);
                   if(rs===16&&rt===16) words+=se/4;         // $s0 を進める＝語を食う
                   if(se===32||se===-32) step=se;
                   continue }
    if(op===0x03){ jal++; continue }
    if(op===0x02) break;                                      // j ＝ 次の命令へ戻る
    if((op>=0x20&&op<=0x2e)&&hi[rs]>=0){
      const a=((hi[rs]+se)>>>0), nm=marks&&marks[a];
      if(nm) hit.add((op>=0x28?"→":"←")+nm);
    }
  }
  const s=[...hit].join(" ");
  return (words?`語${words}個 `:"")+(step?`行列${step>0?"積む":"戻す"} `:"")
    +s+(jal&&!s?`呼び出し${jal}`:"");
}
function mipsSceneOpLines(exe,gp,opt){
  const o=opt||{}, lo=o.lo||0x80019000, hi=o.hi||0x8001C000;
  const T=mipsJumpTable(exe,lo,hi,o.n||24);
  if(!T) return ["  外側の命令の飛び先表は見つからない"];
  const marks=o.marks||{};
  const L=[`  外側の命令の飛び先表 ${hexA(T.at)}　${Math.min(T.n,o.n||24)}件`
    +`（${T.n>(o.n||24)?`つながり ${T.n}件のうち先頭から`:"ちょうど"}）:`];
  const tail=mipsCommonTail(exe,T.addrs);
  if(tail) L[0]+=`　共通の戻り先 ${hexA(tail)}（そこから先は数えない）`;
  T.addrs.forEach((a,k)=>{
    const g=a===tail?"（共通の戻り先そのもの＝何もしない命令）"
                    :mipsOpGist(exe,a,gp,marks,24,tail);
    L.push(`    命令${String(k).padStart(2)} → ${hexA(a)}${g?"　"+g:""}`);
  });
  return L;
}
