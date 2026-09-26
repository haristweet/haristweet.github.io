// i960（Model 2 の主 CPU）の小さなエミュレーター。アーケードのプログラムの一部（テクスチャの展開と写し）をそのまま動かすためのもの。
// 浮動小数点・割り込み・特権命令は無い。呼び出し（call/ret）の局所レジスターは JS の配列に積む（メモリには置かない）
// mem: { r8(a), r16(a), r32(a), w8(a,v), w16(a,v), w32(a,v) }
export class I960 {
  constructor(code, mem){ this.code=code; this.mem=mem; this.r=new Uint32Array(32); this.cc=0; this.frames=[]; this.steps=0 }
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
          default: throw new Error("REG "+o.toString(16)+" at "+pc.toString(16));
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
