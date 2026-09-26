// アーケード（Model 2A）のテクスチャを、ユーザーが用意したロム（vf2.zip）から作る。ロムはページの中で読むだけ（リポジトリに入れない）
// i960 のプログラム（ロム epr-18385〜18388。PS2 の IC12_15 と同じ）の展開処理を、下のエミュレーターでそのまま動かす（CLAUDE.md「アーケードのロム」）
const ARC_PAIRS=[["mpr-17560.10","mpr-17561.11"],["mpr-17558.8","mpr-17559.9"],["mpr-17566.6","mpr-17567.7"],["mpr-17564.4","mpr-17565.5"]];
const ARC_PROG=["epr-18385.12","epr-18386.13","epr-18387.14","epr-18388.15"];
// キャラのテクスチャのセット（2つ1組）の並び。セット 2k+1・2k+2 が ARC_CHARS[k]
const ARC_CHARS=["AKI","JAC","SAR","KAG","LAU","JEF","PAI","WOL","SUI","TOU","DUR"];
// ステージ（OBJ_STAGEn・TEX_STAGEn の n）のテクスチャのセット。TEX_STAGEn の中身がそのセットを展開した中にすべてある（CLAUDE.md）
const ARC_STAGE_SETS={1:34,2:30,3:31,4:33,5:24,6:23,7:29,8:27,9:32,10:28,11:26,13:25};
// files: 名前→Uint8Array。i960 のプログラム（2本ずつ 16bit 交互）と main_data の8本
function arcRom(files){
  const need=[...ARC_PROG,...ARC_PAIRS.flat()].filter(n=>!files[n]); if(need.length) throw new Error("ロムに無いファイル: "+need.join(" "));
  const prog=new Uint8Array(0x80000);
  for(let h=0;h<2;h++){ const A=files[ARC_PROG[2*h]], B=files[ARC_PROG[2*h+1]]; for(let i=0;i<A.length;i+=2){ const o=h*0x40000+i*2; prog[o]=A[i]; prog[o+1]=A[i+1]; prog[o+2]=B[i]; prog[o+3]=B[i+1] } }
  return {prog, chips:ARC_PAIRS.map(p=>p.map(n=>files[n]))};
}
// テクスチャ RAM 2枚（16bit の語に 2×2 テクセル。MAME: 語＝(y>>1)*512＋(x>>1)、y 偶数で上位バイト、x 偶数で上位ニブル）
function arcTexel(s,x,y){ let w=s[((y>>1)*512+(x>>1))&0x7ffff]; if(!(y&1)) w>>=8; if(!(x&1)) w>>=4; return w&15 }
function arcLoader(rom){
  const code={readUInt32LE:a=>(rom.prog[a]|rom.prog[a+1]<<8|rom.prog[a+2]<<16|rom.prog[a+3]<<24)>>>0};
  const half=k=>{ const c=rom.chips[k>>21][k&1], j=(k>>1)&0xfffff; return c[2*j]|c[2*j+1]<<8 };
  const ram=new Uint8Array(0x100000), ram2=new Uint8Array(0x40000), tex=[new Uint16Array(0x80000),new Uint16Array(0x80000)], mask=[new Uint8Array(0x80000),new Uint8Array(0x80000)];
  const md=o=>o<0x1000000?(half(o>>1)>>(8*(o&1)))&255:0;
  const r8=A=>{ A>>>=0;
    if(A<0x80000) return rom.prog[A];
    if(A>=0x500000&&A<0x600000) return ram[A-0x500000];
    if(A>=0x200000&&A<0x240000) return ram2[A-0x200000];
    if(A>=0x2000000&&A<0x4000000) return md(A-0x2000000);
    if(A>=0x6000000&&A<0x7000000) return md(A-0x6000000+0x1000000);
    if(A>=0xf00000&&A<0xf00010) return 0xff;   // タイマー: いつも「まだ時間がある」（0xb6c・0x4cb64 などが時間切れで処理を譲らないように）
    return 0 };
  const texw=(A,v)=>{ const s=(A>>>22)&1, h=((A&0x1fffff)>>>2)&0x7ffff; tex[s][h]=v&0xffff; mask[s][h]=1 };
  const mem={ r8, r16:A=>r8(A)|r8(A+1)<<8, r32:A=>(r8(A)|r8(A+1)<<8|r8(A+2)<<16|r8(A+3)<<24)>>>0,
    w8(A,v){ A>>>=0; if(A>=0x500000&&A<0x600000) ram[A-0x500000]=v; else if(A>=0x200000&&A<0x240000) ram2[A-0x200000]=v },
    w16(A,v){ A>>>=0; if(A>=0x12000000&&A<0x12800000) return texw(A,v); this.w8(A,v&255); this.w8(A+1,v>>>8&255) },
    w32(A,v){ A>>>=0; if(A>=0x12000000&&A<0x12800000) return texw(A,v); for(let k=0;k<4;k++) this.w8(A+k,(v>>>(8*k))&255) } };
  const cpu=new I960(code,mem);
  // テクスチャのセット s を読み込む（0x4bd60〜0x4bf64 の流れ）。flip＝1 ならページを入れ替える（要求の旗の bit0。2P）
  function loadSet(s,flip=0){
    const R=cpu.r, r32=mem.r32;
    let r10=r32(r32(0x230000c)+s*4); const first=r32(r10); r10+=4;
    let r9=r32(r32(0x2300008)+first*4); const n=r32(r9); r9+=4;
    for(let e=0;e<n;e++){
      const g2=r32(r9), g0=(g2<<16)>>>17;
      // 処理を譲る旗は下ろし、持ち時間（0x4c10c が入れる値）を入れておく
      R[1]=R[31]=0x5f0000; mem.w32(0x550080,0); mem.w32(0x5500f4,0); mem.w8(0x500000,0); mem.w8(0x50008c,0); mem.w32(0x55c2f4,flip&1); mem.w32(0x550004,0x12a8); mem.w32(0x550008,0x4e20);
      R[24]=(g2^flip)&1; R[22]=(mem.r16(0x4c120+g0*4)+(g2>>>24))>>>0; R[23]=(mem.r16(0x4c122+g0*4)+((g2<<8)>>>24))>>>0;
      cpu.run(0x4d16c);
      let g3=r32(r10); const t=r32(g3); R[19]=g3+4;
      if(t===0){ cpu.run(0x4c180); cpu.run(0x4cb64); cpu.run(0x4cd18) } else cpu.run(0x4c9dc);
      r9+=4; r10+=4;
    }
    return n;
  }
  return {cpu,mem,tex,mask,loadSet};
}
// キャラ（SC_ROB の名前。[1P, 2P]）のテクスチャを作る。1P はページ1、2P はページ0（PS2 と同じ。要求の旗の bit0 でページが入れ替わる）
function arcCharSheets(rom,chars){
  const L=arcLoader(rom);
  chars.forEach((c,i)=>{ const k=ARC_CHARS.indexOf(c); if(k<0) return; L.loadSet(2*k+1,i); L.loadSet(2*k+2,i) });
  return L;
}

// i960（Model 2 の主 CPU）の小さなエミュレーター。アーケードのプログラムの一部（テクスチャの展開と写し）をそのまま動かすためのもの。
// 浮動小数点・割り込み・特権命令は無い。呼び出し（call/ret）の局所レジスターは JS の配列に積む（メモリには置かない）
// mem: { r8(a), r16(a), r32(a), w8(a,v), w16(a,v), w32(a,v) }
class I960 {
  constructor(code, mem){ this.code=code; this.mem=mem; this.r=new Uint32Array(32); this.cc=0; this.frames=[]; this.steps=0; this.fp=[0,0,0,0] }
  // 浮動小数点（i960 KB）。m＝1 なら番号 0〜3 が fp0〜fp3（拡張精度。JS の数で持つ）、16 が 0.0、22 が 1.0。m＝0 なら g/r に 32bit（rl は2語の 64bit）
  fget(m,i,dbl){
    if(m) return i<4?this.fp[i]:i===16?0:i===22?1:NaN;
    const u=new Uint32Array(2), R=this.r; if(!dbl){ u[0]=R[i]; return new Float32Array(u.buffer)[0] } u[0]=R[i]; u[1]=R[i+1]; return new Float64Array(u.buffer)[0];
  }
  fset(m,i,v,dbl){
    if(m){ this.fp[i&3]=v; return }
    const R=this.r; if(!dbl){ const f=new Float32Array([v]); R[i]=new Uint32Array(f.buffer)[0]; return } const f=new Float64Array([v]), u=new Uint32Array(f.buffer); R[i]=u[0]; R[i+1]=u[1];
  }
  freg(o,w){ // 浮動小数点の REG 命令。扱ったら true
    const dst=(w>>>19)&31, s2=(w>>>14)&31, s1=w&31, m1=(w>>>11)&1, m2=(w>>>12)&1, m3=(w>>>13)&1, R=this.r;
    const dbl=(o>=0x790&&o<=0x79f)||o===0x6d9||o===0x675||o===0x6c1||o===0x6c3||o===0x694||o===0x695||(o>=0x690&&o<=0x69f);
    const A=()=>this.fget(m1,s1,dbl), B=()=>this.fget(m2,s2,dbl), S=v=>this.fset(m3,dst,v,dbl&&o!==0x6c1&&o!==0x6c3);
    const cmp=(a,b)=>{ this.cc=a<b?4:a===b?2:a>b?1:0 };
    switch(o){
      case 0x78b: case 0x79b: S(B()/A()); return true; case 0x78c: case 0x79c: S(B()*A()); return true;
      case 0x78d: case 0x79d: S(B()-A()); return true; case 0x78f: case 0x79f: S(B()+A()); return true;
      case 0x674: S(m1?s1:(R[s1]|0)); return true;                 // cvtir
      case 0x675: this.fset(m3,dst,m1?s1:(R[s1]|0),true); return true;   // cvtilr
      case 0x6c0: { const v=A(); R[dst]=Math.round(v)|0; return true }          // cvtri（偶数への丸めは近似）
      case 0x6c2: { const v=A(); R[dst]=Math.trunc(v)|0; return true }          // cvtzri
      case 0x6c9: case 0x6d9: S(A()); return true;                 // movr / movrl
      case 0x6e1: this.fp[dst&3]=this.fget(m1,s1,false); return true;   // movre（近似）
      case 0x685: case 0x684: case 0x695: case 0x694: cmp(A(),B()); return true;   // cmpr / cmpor
      case 0x688: case 0x698: S(Math.sqrt(A())); return true;
      case 0x68c: case 0x69c: S(Math.sin(A())); return true; case 0x68d: case 0x69d: S(Math.cos(A())); return true;
      case 0x68e: case 0x69e: S(Math.tan(A())); return true;
      case 0x680: case 0x690: S(Math.atan2(B(),A())); return true;    // atanr: atan(src2/src1)
      case 0x68b: case 0x69b: S(Math.round(A())); return true;
      case 0x677: case 0x676: { const n=m1?s1:(R[s1]|0); this.fset(m3,dst,this.fget(m2,s2,o===0x676)*Math.pow(2,n),o===0x676); return true }   // scaler
      case 0x6e2: S(Math.abs(B())*(A()<0?-1:1)); return true;  // cpysre
      case 0x6e3: S(Math.abs(B())*(A()<0?1:-1)); return true;  // cpyrsre
    }
    return false;
  }
  ea(w, a){ // MEM 形式の実効番地と命令長
    const ab=(w>>>14)&31, R=this.r;
    if(!((w>>>12)&1)){ const off=w&0xfff; return [(w>>>13)&1 ? (R[ab]+off)>>>0 : off, 4] }
    const mode=(w>>>10)&15, sc=1<<((w>>>7)&7), ix=w&31;
    const disp=()=>this.code.readUInt32LE(a+4);
    switch(mode){
      case 4: return [R[ab], 4];
      case 5: return [(a+8+disp())>>>0, 8];
      case 7: return [(R[ab]+R[ix]*sc)>>>0, 4];
      case 12: return [disp(), 8];
      case 13: return [(disp()+R[ab])>>>0, 8];
      case 14: return [(disp()+R[ix]*sc)>>>0, 8];
      case 15: return [(disp()+R[ab]+R[ix]*sc)>>>0, 8];
    }
    throw new Error("MEM の番地の形式 "+mode+" at "+a.toString(16));
  }
  cmp(a,b,signed){ if(signed){ a|=0; b|=0 } else { a>>>=0; b>>>=0 } this.cc=a<b?4:a===b?2:1 }
  call(target, ret){
    this.frames.push({loc:this.r.slice(0,16), fp:this.r[31], ret});
    const nfp=((this.r[1]+63)&~63)>>>0;
    this.r.fill(0,0,16); this.r[0]=this.frames[this.frames.length-1].fp; this.r[31]=nfp; this.r[1]=(nfp+64)>>>0; this.r[2]=ret;
    return target;
  }
  // 番地 pc から、ret で最初の深さに戻るまで動かす
  run(pc, maxSteps=5e8){
    const R=this.r, M=this.mem, C=this.code, depth0=this.frames.length;
    this.frames.push({loc:R.slice(0,16), fp:R[31], stop:true});
    { const nfp=((R[1]+63)&~63)>>>0; R.fill(0,0,16); R[31]=nfp; R[1]=(nfp+64)>>>0 }
    for(;;){
      if(++this.steps>maxSteps) throw new Error("命令が多すぎる at "+pc.toString(16));
      if(this.trace) this.trace(pc);
      const w=C.readUInt32LE(pc), op=w>>>24;
      if(op<0x20){ // CTRL
        const d=((w&0xfffffc)<<8)>>8, t=(pc+d)>>>0;
        switch(op){
          case 0x08: pc=t; continue;
          case 0x09: pc=this.call(t,pc+4); continue;
          case 0x0a: { const f=this.frames.pop(); R.set(f.loc,0); R[31]=f.fp; if(f.stop) return; pc=f.ret; continue }
          case 0x0b: R[30]=pc+4; pc=t; continue;
        }
        if(op>=0x10&&op<=0x17){ const m=op&7; if(m===0?this.cc===0:(this.cc&m)) { pc=t; continue } pc+=4; continue }
        throw new Error("CTRL "+op.toString(16)+" at "+pc.toString(16));
      }
      if(op<0x40){ // COBR
        const s1=(w>>>19)&31, s2=(w>>>14)&31, m1=(w>>>13)&1, d=((w&0x1ffc)<<19)>>19, t=(pc+d)>>>0;
        const a=m1?s1:R[s1], b=R[s2];
        if(op>=0x30&&op<=0x37&&(op===0x30||op===0x37)){ const bit=(b>>>(a&31))&1; this.cc=bit?2:0; if((op===0x37)===!!bit){ pc=t; continue } pc+=4; continue }
        if(op>=0x31&&op<=0x36){ this.cmp(a,b,false); if(this.cc&(op&7)){ pc=t; continue } pc+=4; continue }
        if(op>=0x38){ this.cmp(a,b,true); const m=op&7; if(m===0?this.cc===0:(this.cc&m)){ pc=t; continue } pc+=4; continue }
        if(op>=0x20&&op<=0x27){ const m=op&7; R[s1]=(m===0?this.cc===0:(this.cc&m))?1:0; pc+=4; continue }
        throw new Error("COBR "+op.toString(16)+" at "+pc.toString(16));
      }
      if(op<0x80){ // REG
        const o=(op<<4)|((w>>>7)&15), dst=(w>>>19)&31, s2i=(w>>>14)&31, s1i=w&31;
        const a=((w>>>11)&1)?s1i:R[s1i], b=((w>>>12)&1)?s2i:R[s2i];
        let v;
        switch(o){
          case 0x581: v=a&b; break; case 0x582: v=b&~a; break; case 0x584: v=~b&a; break; case 0x586: v=a^b; break; case 0x587: v=a|b; break;
          case 0x588: v=~(a|b); break; case 0x589: v=~(a^b); break; case 0x58a: v=~a; break; case 0x58b: v=b|~a; break; case 0x58d: v=~b|a; break; case 0x58e: v=~(a&b); break;
          case 0x583: v=b|(1<<(a&31)); break; case 0x58c: v=b&~(1<<(a&31)); break; case 0x580: v=b^(1<<(a&31)); break; case 0x58f: v=(this.cc&2)?b|(1<<(a&31)):b&~(1<<(a&31)); break;
          case 0x590: case 0x591: v=a+b; break; case 0x592: case 0x593: v=b-a; break;
          case 0x598: v=a>31?0:b>>>a; break; case 0x59b: v=a>31?((b|0)>>31):((b|0)>>a); break; case 0x59c: case 0x59e: v=a>31?0:b<<a; break;
          case 0x59a: { let x=(b|0)>>(a>31?31:a); if((b|0)<0&&a&&(b&((1<<a)-1))) x+=1; v=x; break }
          case 0x59d: v=(b<<(a&31))|(a&31?b>>>(32-(a&31)):0); break;
          case 0x5a0: this.cmp(a,b,false); pc+=4; continue; case 0x5a1: this.cmp(a,b,true); pc+=4; continue;
          case 0x5a4: this.cmp(a,b,false); v=b+1; break; case 0x5a5: this.cmp(a,b,true); v=b+1; break;
          case 0x5a6: this.cmp(a,b,false); v=b-1; break; case 0x5a7: this.cmp(a,b,true); v=b-1; break;
          case 0x5ae: this.cc=((b>>>(a&31))&1)?2:0; pc+=4; continue;
          case 0x5b0: { const s=(a>>>0)+(b>>>0)+((this.cc>>1)&1); v=s>>>0; this.cc=(s>0xffffffff?2:0); break }
          case 0x5cc: v=a; break;
          case 0x5dc: R[dst]=a; R[dst+1]=((w>>>11)&1)?0:R[s1i+1]; pc+=4; continue;
          case 0x5ec: for(let k=0;k<3;k++) R[dst+k]=((w>>>11)&1)?(k?0:a):R[s1i+k]; pc+=4; continue;
          case 0x5fc: for(let k=0;k<4;k++) R[dst+k]=((w>>>11)&1)?(k?0:a):R[s1i+k]; pc+=4; continue;
          case 0x641: { v=0xffffffff; for(let k=31;k>=0;k--) if((a>>>k)&1){ v=k; break } this.cc=v===0xffffffff?0:2; break }
          case 0x651: v=(R[dst]>>>(a&31))&((b>=32)?0xffffffff:((1<<b)-1)); break;
          case 0x650: v=(b&a)|(R[dst]&~a); break;
          case 0x701: v=Math.imul(a,b); break; case 0x741: v=Math.imul(a,b); break;
          case 0x70b: v=a?Math.floor((b>>>0)/(a>>>0)):0; break; case 0x708: v=a?(b>>>0)%(a>>>0):0; break;
          case 0x74b: v=a?Math.trunc((b|0)/(a|0)):0; break; case 0x748: v=a?(b|0)%(a|0):0; break;
          case 0x66d: case 0x66b: case 0x66c: case 0x66f: pc+=4; continue;   // flushreg など
          default: if(this.freg(o,w)){ pc+=4; continue } throw new Error("REG "+o.toString(16)+" at "+pc.toString(16));
        }
        R[dst]=v>>>0; pc+=4; continue;
      }
      // MEM
      const sd=(w>>>19)&31, [A,len]=this.ea(w,pc);
      switch(op){
        case 0x80: R[sd]=M.r8(A); break; case 0xc0: R[sd]=(M.r8(A)<<24)>>24; break;
        case 0x88: R[sd]=M.r16(A); break; case 0xc8: R[sd]=(M.r16(A)<<16)>>16; break;
        case 0x90: R[sd]=M.r32(A); break;
        case 0x98: R[sd]=M.r32(A); R[sd+1]=M.r32(A+4); break;
        case 0xa0: for(let k=0;k<3;k++) R[sd+k]=M.r32(A+4*k); break;
        case 0xb0: for(let k=0;k<4;k++) R[sd+k]=M.r32(A+4*k); break;
        case 0x82: case 0xc2: M.w8(A,R[sd]&255); break;
        case 0x8a: case 0xca: M.w16(A,R[sd]&0xffff); break;
        case 0x92: M.w32(A,R[sd]); break;
        case 0x9a: M.w32(A,R[sd]); M.w32(A+4,R[sd+1]); break;
        case 0xa2: for(let k=0;k<3;k++) M.w32(A+4*k,R[sd+k]); break;
        case 0xb2: for(let k=0;k<4;k++) M.w32(A+4*k,R[sd+k]); break;
        case 0x8c: R[sd]=A; break;
        case 0x84: pc=A; continue;
        case 0x85: R[sd]=pc+len; pc=A; continue;
        case 0x86: pc=this.call(A,pc+len); continue;
        default: throw new Error("MEM "+op.toString(16)+" at "+pc.toString(16));
      }
      pc+=len;
    }
  }
}
// ステージのテクスチャを作る（ページ 0・1 の両方。PS2 と同じく各ページの横 256〜383 に当たる所＝RAM の縦 1024〜1535）
function arcStageSheets(rom,n){ const L=arcLoader(rom), s=ARC_STAGE_SETS[n]; if(s) L.loadSet(s,0); return L }
// そのコマで使うテクスチャを、アーケードと同じく1つのテクスチャ RAM に展開する（ステージ→1P→2P。ミップマップの段もぶつからない。CLAUDE.md）
function arcSceneSheets(rom,chars,stageN){
  const L=arcLoader(rom), s=ARC_STAGE_SETS[stageN]; if(s) L.loadSet(s,0);
  chars.forEach((c,i)=>{ const k=ARC_CHARS.indexOf(c); if(k<0) return; L.loadSet(2*k+1,i); L.loadSet(2*k+2,i) });
  return L;
}
