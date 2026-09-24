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
// ジャンプ表を番地から直に読む（命令ごとの処理の飛び先）
function mipsTableAt(exe,addr,n){
  const t=exeText(exe); if(!t) return [];
  const off=addr-t.base; if(off<0||off+n*4>t.body.length) return [];
  const dv=new DataView(t.body.buffer,t.body.byteOffset,t.body.byteLength);
  const out=[];
  for(let k=0;k<n;k++) out.push(dv.getUint32(off+k*4,true));
  return out;
}

// ============================================================
//  命令の列を読んでいる関数を「呼んでいる側」を探す
//  表A・表B に番地を入れている所が、読み書きの形では見つからない。
//  handler の中でしか触っていないということは、
//  最初の値は「別の register を土台にした書き込み」で入っている。
//  それは呼び出し元にあるはずなので、呼び出し元を読む
// ============================================================

// ============================================================
//  「進めている入れもの」を全部探す
//  命令5は表A・表Bを4ずつ進めていた。呼び出し元を読んだら、
//  0x800CC910 を 32 ずつ進めている所が出てきた——32バイトは
//  PS1 の MATRIX ちょうど1個ぶん。
//  番地を決め打ちで追うのはもうやめる。
//  「読んで・足して・同じ所に書き戻す」形を全部拾えば、
//  行列の並びも、その他の並びも、まとめて出てくる
// ============================================================

// ============================================================
//  表に最初の値を入れている所を、まとめて読む
//  $gp を壊していたあいだは「読み1・書き1」しか見えず、どちらも
//  命令5の処理そのものだった。直したら書き込みが3か所ずつになった。
//  増えたぶんは 0x8001A18C 付近に固まっている——そこが仕込みの場所
// ============================================================

// ============================================================
//  外側の命令列（場面の組み立て）
//  0x8001A184 で分かった：表A・表B・表C に入る値は、$s0 が歩いている
//  「外側の命令列」から読んだ語そのもの。つまり骨の行列の並びは
//  ディスクにも実行ファイルにも無く、この列で渡されている。
//  この列には 24 個の命令がある（sltiu $a0, 24）。
//  0x800CC910 は +32 と -32 の両方で動いている＝行列の積み上げ／取り出し。
//  階層はこの列の積み上げ／取り出しで表されている
// ============================================================
