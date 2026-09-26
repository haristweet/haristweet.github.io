// PS2 の EE（R5900）の小さなエミュレーター。本体のコプロ代わりの関数（cpr*）を、セーブステートの主メモリの上でそのまま動かすためのもの。
// 整数（64bit は2語で持つ。lq/sq・pcpyud のため4語）・COP1（単精度）・VU0 のマクロ命令だけ
const f32=Math.fround;
const FB=new Float32Array(1), UB=new Uint32Array(FB.buffer);
const u2f=u=>{ UB[0]=u; return FB[0] }, f2u=f=>{ FB[0]=f; return UB[0] };
class EE {
  constructor(mem){ // mem: Uint8Array（32MB）
    this.m=mem; this.dv=new DataView(mem.buffer,mem.byteOffset,mem.byteLength);
    this.g=new Uint32Array(32*4); this.hi=[0,0]; this.lo=[0,0];
    this.f=new Float32Array(32); this.fcc=false; this.acc=0;
    this.vf=new Float32Array(32*4); this.vf[3]=1; this.vi=new Uint16Array(16); this.Q=0; this.I=0; this.vacc=new Float32Array(4);
    this.steps=0; this.unk={};
  }
  a(A){ A>>>=0; if(A>=0x20000000&&A<0x22000000) A-=0x20000000; else if(A>=0x30000000&&A<0x32000000) A-=0x30000000; else if(A>=0x70000000&&A<0x70004000) A=0x1fc0000+(A-0x70000000); return A&0x1ffffff }   // スクラッチパッドは空いていそうな所に置く
  r8(A){ return this.m[this.a(A)] } r16(A){ return this.dv.getUint16(this.a(A),true) } r32(A){ return this.dv.getUint32(this.a(A),true) }
  w8(A,v){ this.m[this.a(A)]=v } w16(A,v){ this.dv.setUint16(this.a(A),v,true) } w32(A,v){ this.dv.setUint32(this.a(A),v>>>0,true) }
  set32(r,v){ if(!r) return; const G=this.g; G[r*4]=v>>>0; G[r*4+1]=(v|0)<0?0xffffffff:0 }   // 32bit の結果は符号を広げる
  set64(r,lo,hi){ if(!r) return; this.g[r*4]=lo>>>0; this.g[r*4+1]=hi>>>0 }
  // 関数 pc を ra＝止まる番地 で呼ぶ
  call(pc, args=[], sp=0x1ff0000){
    const G=this.g; for(let i=0;i<args.length;i++) this.set32(4+i,args[i]);
    this.set32(29,sp); this.set32(31,0xfffffff0); this.set32(28,0x25da70);
    this.run(pc);
    return G[2*4];
  }
  run(pc){
    const G=this.g, V=this.vf;
    let npc=pc+4, delay=false;
    const S=(r)=>G[r*4]|0, U=(r)=>G[r*4]>>>0;
    for(;;){
      if(pc===0xfffffff0) return;
      if(++this.steps>5e7) throw new Error("命令が多すぎる");
      const w=this.r32(pc), op=w>>>26, rs=(w>>>21)&31, rt=(w>>>16)&31, rd=(w>>>11)&31, sa=(w>>>6)&31, imm=(w<<16)>>16, uimm=w&0xffff;
      let next=npc, target=-1, likely=false, taken=false;
      const br=(c,l)=>{ taken=c; likely=l; target=(npc+(imm<<2))>>>0 };
      switch(op){
        case 0x00: { // SPECIAL
          const fn=w&63;
          switch(fn){
            case 0x00: this.set32(rd,U(rt)<<sa); break;
            case 0x02: this.set32(rd,U(rt)>>>sa); break;
            case 0x03: this.set32(rd,S(rt)>>sa); break;
            case 0x04: this.set32(rd,U(rt)<<(U(rs)&31)); break;
            case 0x06: this.set32(rd,U(rt)>>>(U(rs)&31)); break;
            case 0x07: this.set32(rd,S(rt)>>(U(rs)&31)); break;
            case 0x08: target=U(rs); taken=true; break;
            case 0x09: { const t=U(rs); this.set32(rd||31,npc+4); target=t; taken=true; break }
            case 0x0a: if(G[rt*4]===0&&G[rt*4+1]===0) this.g64copy(rd,rs); break;   // movz
            case 0x0b: if(G[rt*4]!==0||G[rt*4+1]!==0) this.g64copy(rd,rs); break;   // movn
            case 0x0f: break; // sync
            case 0x10: this.set64(rd,this.hi[0],this.hi[1]); break; case 0x12: this.set64(rd,this.lo[0],this.lo[1]); break;
            case 0x11: this.hi=[G[rs*4],G[rs*4+1]]; break; case 0x13: this.lo=[G[rs*4],G[rs*4+1]]; break;
            case 0x14: { const v=this.get64(rt)<<BigInt(U(rs)&63); this.put64(rd,v); break }
            case 0x16: { const v=BigInt.asUintN(64,this.get64(rt))>>BigInt(U(rs)&63); this.put64(rd,v); break }
            case 0x17: { const v=BigInt.asIntN(64,this.get64(rt))>>BigInt(U(rs)&63); this.put64(rd,v); break }
            case 0x18: { const p=BigInt(S(rs))*BigInt(S(rt)); this.setHL(p); if(rd) this.set32(rd,this.lo[0]); break }
            case 0x19: { const p=BigInt(U(rs))*BigInt(U(rt)); this.setHL(p); if(rd) this.set32(rd,this.lo[0]); break }
            case 0x1a: { const a=S(rs), b=S(rt); if(b){ this.lo=this.sx(Math.trunc(a/b)); this.hi=this.sx(a%b) } break }
            case 0x1b: { const a=U(rs), b=U(rt); if(b){ this.lo=this.sx(Math.floor(a/b)|0); this.hi=this.sx((a%b)|0) } break }
            case 0x20: case 0x21: this.set32(rd,U(rs)+U(rt)); break;
            case 0x22: case 0x23: this.set32(rd,U(rs)-U(rt)); break;
            case 0x24: this.set64(rd,G[rs*4]&G[rt*4],G[rs*4+1]&G[rt*4+1]); break;
            case 0x25: this.set64(rd,G[rs*4]|G[rt*4],G[rs*4+1]|G[rt*4+1]); break;
            case 0x26: this.set64(rd,G[rs*4]^G[rt*4],G[rs*4+1]^G[rt*4+1]); break;
            case 0x27: this.set64(rd,~(G[rs*4]|G[rt*4]),~(G[rs*4+1]|G[rt*4+1])); break;
            case 0x2a: this.set32(rd,BigInt.asIntN(64,this.get64(rs))<BigInt.asIntN(64,this.get64(rt))?1:0); break;
            case 0x2b: this.set32(rd,this.get64(rs)<this.get64(rt)?1:0); break;
            case 0x2c: case 0x2d: this.put64(rd,this.get64(rs)+this.get64(rt)); break;
            case 0x2e: case 0x2f: this.put64(rd,this.get64(rs)-this.get64(rt)); break;
            case 0x38: this.put64(rd,this.get64(rt)<<BigInt(sa)); break;
            case 0x3a: this.put64(rd,BigInt.asUintN(64,this.get64(rt))>>BigInt(sa)); break;
            case 0x3b: this.put64(rd,BigInt.asIntN(64,this.get64(rt))>>BigInt(sa)); break;
            case 0x3c: this.put64(rd,this.get64(rt)<<BigInt(sa+32)); break;
            case 0x3e: this.put64(rd,BigInt.asUintN(64,this.get64(rt))>>BigInt(sa+32)); break;
            case 0x3f: this.put64(rd,BigInt.asIntN(64,this.get64(rt))>>BigInt(sa+32)); break;
            default: throw new Error("SPECIAL "+fn.toString(16)+" at "+pc.toString(16));
          }
          break;
        }
        case 0x01: { // REGIMM
          const a=BigInt.asIntN(64,this.get64(rs));
          switch(rt){ case 0: br(a<0n,false); break; case 1: br(a>=0n,false); break; case 2: br(a<0n,true); break; case 3: br(a>=0n,true); break;
            case 0x11: this.set32(31,npc+4); br(a>=0n,false); break; case 0x10: this.set32(31,npc+4); br(a<0n,false); break;
            default: throw new Error("REGIMM "+rt+" at "+pc.toString(16)) }
          break;
        }
        case 0x02: target=((npc&0xf0000000)|((w&0x3ffffff)<<2))>>>0; taken=true; break;
        case 0x03: this.set32(31,npc+4); target=((npc&0xf0000000)|((w&0x3ffffff)<<2))>>>0; taken=true; break;
        case 0x04: br(this.eq(rs,rt),false); break; case 0x05: br(!this.eq(rs,rt),false); break;
        case 0x06: br(BigInt.asIntN(64,this.get64(rs))<=0n,false); break; case 0x07: br(BigInt.asIntN(64,this.get64(rs))>0n,false); break;
        case 0x14: br(this.eq(rs,rt),true); break; case 0x15: br(!this.eq(rs,rt),true); break;
        case 0x16: br(BigInt.asIntN(64,this.get64(rs))<=0n,true); break; case 0x17: br(BigInt.asIntN(64,this.get64(rs))>0n,true); break;
        case 0x08: case 0x09: this.set32(rt,U(rs)+imm); break;
        case 0x18: case 0x19: this.put64(rt,this.get64(rs)+BigInt(imm)); break;
        case 0x0a: this.set32(rt,BigInt.asIntN(64,this.get64(rs))<BigInt(imm)?1:0); break;
        case 0x0b: this.set32(rt,this.get64(rs)<BigInt.asUintN(64,BigInt(imm))?1:0); break;
        case 0x0c: this.set64(rt,G[rs*4]&uimm,0); break;
        case 0x0d: this.set64(rt,G[rs*4]|uimm,G[rs*4+1]); break;
        case 0x0e: this.set64(rt,G[rs*4]^uimm,G[rs*4+1]); break;
        case 0x0f: this.set32(rt,uimm<<16); break;
        case 0x20: this.set32(rt,(this.r8(U(rs)+imm)<<24)>>24); break;
        case 0x24: this.set32(rt,this.r8(U(rs)+imm)); break;
        case 0x21: this.set32(rt,(this.r16(U(rs)+imm)<<16)>>16); break;
        case 0x25: this.set32(rt,this.r16(U(rs)+imm)); break;
        case 0x23: this.set32(rt,this.r32(U(rs)+imm)); break;
        case 0x27: this.set64(rt,this.r32(U(rs)+imm),0); break;
        case 0x37: { const A=U(rs)+imm; this.set64(rt,this.r32(A),this.r32(A+4)); break }
        case 0x1e: { const A=(U(rs)+imm)&~15; if(rt) for(let k=0;k<4;k++) G[rt*4+k]=this.r32(A+4*k); break }   // lq
        case 0x1f: { const A=(U(rs)+imm)&~15; for(let k=0;k<4;k++) this.w32(A+4*k,G[rt*4+k]); break }   // sq
        case 0x28: this.w8(U(rs)+imm,G[rt*4]&255); break;
        case 0x29: this.w16(U(rs)+imm,G[rt*4]&0xffff); break;
        case 0x2b: this.w32(U(rs)+imm,G[rt*4]); break;
        case 0x3f: { const A=U(rs)+imm; this.w32(A,G[rt*4]); this.w32(A+4,G[rt*4+1]); break }
        case 0x22: case 0x26: { // lwl / lwr
          const A=(U(rs)+imm)>>>0, al=A&~3, sh=A&3, mw=this.r32(al), old=G[rt*4];
          let v; if(op===0x22){ v=((mw<<(8*(3-sh)))|(old&(sh===3?0:(0xffffffff>>>(8*(sh+1))))))>>>0 } else { v=((mw>>>(8*sh))|(sh?(old&((0xffffffff<<(8*(4-sh)))>>>0)):0))>>>0 }
          if(op===0x26&&sh!==0) G[rt*4]=v; else this.set32(rt,v); break }
        case 0x2c: case 0x2d: { // sdl / sdr
          const A=(U(rs)+imm)>>>0, al=A&~7, sh=A&7, v=this.get64(rt);
          let mw=(BigInt(this.r32(al+4))<<32n)|BigInt(this.r32(al));
          if(op===0x2c){ const n=BigInt(8*(7-sh)), mask=sh===7?0n:((1n<<64n)-1n)<<BigInt(8*(sh+1)); mw=(mw&mask)|(BigInt.asUintN(64,v)>>n) }
          else { const n=BigInt(8*sh), mask=sh===0?0n:((1n<<BigInt(8*sh))-1n); mw=(mw&mask)|BigInt.asUintN(64,v<<n) }
          mw=BigInt.asUintN(64,mw); this.w32(al,Number(mw&0xffffffffn)); this.w32(al+4,Number(mw>>32n)); break }
        case 0x1a: case 0x1b: { // ldl / ldr
          const A=(U(rs)+imm)>>>0, al=A&~7, sh=A&7, mw=(BigInt(this.r32(al+4))<<32n)|BigInt(this.r32(al)), old=BigInt.asUintN(64,this.get64(rt));
          let v; if(op===0x1a){ const n=BigInt(8*(7-sh)); const keep=sh===7?0n:((1n<<BigInt(8*(7-sh)))-1n); v=BigInt.asUintN(64,mw<<n)|(old&keep) }
          else { const n=BigInt(8*sh); const keep=sh===0?0n:(((1n<<64n)-1n)<<BigInt(8*(8-sh)))&((1n<<64n)-1n); v=(mw>>n)|(old&keep) }
          this.put64(rt,v); break }
        case 0x2f: break; // cache
        case 0x31: this.f[rt]=u2f(this.r32(U(rs)+imm)); break;   // lwc1
        case 0x39: this.w32(U(rs)+imm,f2u(this.f[rt])); break;   // swc1
        case 0x36: { const A=(U(rs)+imm)&~15; for(let k=0;k<4;k++) V[rt*4+k]=u2f(this.r32(A+4*k)); if(!rt){V[0]=V[1]=V[2]=0;V[3]=1} break }   // lqc2
        case 0x3e: { const A=(U(rs)+imm)&~15; for(let k=0;k<4;k++) this.w32(A+4*k,f2u(V[rt*4+k])); break }   // sqc2
        case 0x11: this.cop1(w,pc,br); break;
        case 0x12: this.cop2(w,pc,br); break;
        case 0x1c: this.mmi(w,pc); break;
        default: throw new Error("op "+op.toString(16)+" at "+pc.toString(16)+" w="+w.toString(16));
      }
      if(target>=0||likely){
        if(taken){ // 遅延スロットを実行してから飛ぶ
          pc=npc; npc=target; continue;
        } else if(likely){ pc=npc+4; npc=pc+4; continue }
      }
      pc=npc; npc=pc+4;
      if(this.pendingTarget!==undefined){}
    }
  }
  g64copy(d,s){ if(d){ this.g[d*4]=this.g[s*4]; this.g[d*4+1]=this.g[s*4+1] } }
  get64(r){ return BigInt.asIntN(64,(BigInt(this.g[r*4+1])<<32n)|BigInt(this.g[r*4])) }
  put64(r,v){ v=BigInt.asUintN(64,v); this.set64(r,Number(v&0xffffffffn),Number(v>>32n)) }
  eq(a,b){ return this.g[a*4]===this.g[b*4]&&this.g[a*4+1]===this.g[b*4+1] }
  sx(v){ return [v>>>0,(v|0)<0?0xffffffff:0] }
  setHL(p){ const lo=Number(BigInt.asIntN(32,p)), hi=Number(BigInt.asIntN(32,p>>32n)); this.lo=this.sx(lo); this.hi=this.sx(hi) }
  cop1(w,pc,br){
    const fmt=(w>>>21)&31, ft=(w>>>16)&31, fs=(w>>>11)&31, fd=(w>>>6)&31, fn=w&63, F=this.f;
    if(fmt===0){ this.set32(ft,f2u(F[fs])); return }            // mfc1
    if(fmt===4){ F[fs]=u2f(this.g[ft*4]); return }             // mtc1
    if(fmt===2||fmt===6) return;                                // cfc1/ctc1
    if(fmt===8){ const t=(w>>>16)&1, l=(w>>>17)&1; br(t?this.fcc:!this.fcc,!!l); return }
    if(fmt===16){
      switch(fn){
        case 0: F[fd]=f32(F[fs]+F[ft]); return; case 1: F[fd]=f32(F[fs]-F[ft]); return;
        case 2: F[fd]=f32(F[fs]*F[ft]); return; case 3: F[fd]=f32(F[fs]/F[ft]); return;
        case 4: F[fd]=f32(Math.sqrt(Math.abs(F[ft]))); return; case 5: F[fd]=Math.abs(F[fs]); return;
        case 6: F[fd]=F[fs]; return; case 7: F[fd]=-F[fs]; return;
        case 0x16: F[fd]=f32(F[fs]/Math.sqrt(Math.abs(F[ft]))); return;
        case 0x18: this.acc=f32(F[fs]+F[ft]); return; case 0x19: this.acc=f32(F[fs]-F[ft]); return; case 0x1a: this.acc=f32(F[fs]*F[ft]); return;
        case 0x1c: F[fd]=this.acc=f32(this.acc+f32(F[fs]*F[ft])); return; case 0x1d: F[fd]=this.acc=f32(this.acc-f32(F[fs]*F[ft])); return;
        case 0x1e: this.acc=f32(this.acc+f32(F[fs]*F[ft])); return; case 0x1f: this.acc=f32(this.acc-f32(F[fs]*F[ft])); return;
        case 0x24: { const v=F[fs]; FB[0]=0; const i=Math.trunc(v); UB[0]=(i|0)>>>0; F[fd]=FB[0]; return }   // cvt.w.s
        case 0x28: F[fd]=Math.max(F[fs],F[ft]); return; case 0x29: F[fd]=Math.min(F[fs],F[ft]); return;
        case 0x30: this.fcc=false; return; case 0x32: this.fcc=F[fs]===F[ft]; return;
        case 0x34: this.fcc=F[fs]<F[ft]; return; case 0x36: this.fcc=F[fs]<=F[ft]; return;
      }
    }
    if(fmt===20&&fn===0x20){ FB[0]=F[fs]; F[fd]=f32(UB[0]|0); return }   // cvt.s.w
    throw new Error("COP1 fmt "+fmt+" fn "+fn.toString(16)+" at "+pc.toString(16));
  }
  mmi(w,pc){
    const rs=(w>>>21)&31, rt=(w>>>16)&31, rd=(w>>>11)&31, sa=(w>>>6)&31, fn=w&63, G=this.g;
    if(fn===0x29&&sa===14){ // pcpyud
      if(rd){ const a=[G[rs*4+2],G[rs*4+3],G[rt*4+2],G[rt*4+3]]; for(let k=0;k<4;k++) G[rd*4+k]=a[k] } return }
    if(fn===0x09&&sa===14){ // pcpyld
      if(rd){ const a=[G[rt*4],G[rt*4+1],G[rs*4],G[rs*4+1]]; for(let k=0;k<4;k++) G[rd*4+k]=a[k] } return }
    if(fn===0x08&&sa===18){ if(rd){ const a=[G[rt*4],G[rs*4],G[rt*4+1],G[rs*4+1]]; for(let k=0;k<4;k++) G[rd*4+k]=a[k] } return }   // pextlw
    if(fn===0x28&&sa===18){ if(rd){ const a=[G[rt*4+2],G[rs*4+2],G[rt*4+3],G[rs*4+3]]; for(let k=0;k<4;k++) G[rd*4+k]=a[k] } return }   // pextuw
    if(fn===0x29&&sa===18){ if(rd) for(let k=0;k<4;k++) G[rd*4+k]=G[rs*4+k]|G[rt*4+k]; return }   // por
    if(fn===0x09&&sa===18){ if(rd) for(let k=0;k<4;k++) G[rd*4+k]=G[rs*4+k]&G[rt*4+k]; return }   // pand
    if(fn===0x18){ const p=BigInt(this.g[rs*4]|0)*BigInt(this.g[rt*4]|0); this.setHL(p); if(rd) this.set32(rd,this.lo[0]); return }   // mult1 近似
    throw new Error("MMI fn "+fn.toString(16)+" sa "+sa+" at "+pc.toString(16));
  }
  cop2(w,pc,br){
    const V=this.vf, G=this.g, rs=(w>>>21)&31;
    if(!((w>>>25)&1)){
      const rt=(w>>>16)&31, rd=(w>>>11)&31;
      switch(rs){
        case 1: if(rt) for(let k=0;k<4;k++) G[rt*4+k]=f2u(V[rd*4+k]); return;   // qmfc2
        case 5: if(rd) for(let k=0;k<4;k++) V[rd*4+k]=u2f(G[rt*4+k]); return;   // qmtc2
        case 2: { let v=0; if(rd<16) v=this.vi[rd]; else if(rd===22) v=f2u(this.Q); else if(rd===21) v=f2u(this.I); this.set32(rt,v); return }   // cfc2
        case 6: { const v=G[rt*4]; if(rd<16){ if(rd) this.vi[rd]=v&0xffff } else if(rd===22) this.Q=u2f(v); else if(rd===21) this.I=u2f(v); return }   // ctc2
        case 8: { const t=(w>>>16)&1, l=(w>>>17)&1; br(t?false:true,!!l); return }   // bc2f/t（VU0 はいつも止まっている）
      }
      throw new Error("COP2 rs "+rs+" at "+pc.toString(16));
    }
    const dest=(w>>>21)&15, ft=(w>>>16)&31, fs=(w>>>11)&31, fd=(w>>>6)&31, fn=w&63;
    const D=[(dest>>3)&1,(dest>>2)&1,(dest>>1)&1,dest&1];
    const rd=(r,k)=>r===0?(k===3?1:0):V[r*4+k];
    const wr=(r,vals)=>{ if(!r) return; for(let k=0;k<4;k++) if(D[k]) V[r*4+k]=f32(vals[k]) };
    const wacc=vals=>{ for(let k=0;k<4;k++) if(D[k]) this.vacc[k]=f32(vals[k]) };
    const vs=r=>[0,1,2,3].map(k=>rd(r,k));
    const bc=w&3;
    if(fn<0x3c){
      const a=vs(fs), b=vs(ft), bb=[0,1,2,3].map(()=>rd(ft,bc)), A=this.vacc;
      const mul=(x,y)=>x.map((v,k)=>f32(v*y[k]));
      switch(fn>>2){
        case 0: wr(fd,a.map((v,k)=>v+bb[k])); return;                 // vaddbc
        case 1: wr(fd,a.map((v,k)=>v-bb[k])); return;                 // vsubbc
        case 2: wr(fd,mul(a,bb).map((v,k)=>A[k]+v)); return;          // vmaddbc
        case 3: wr(fd,mul(a,bb).map((v,k)=>A[k]-v)); return;          // vmsubbc
        case 4: wr(fd,a.map((v,k)=>Math.max(v,bb[k]))); return;
        case 5: wr(fd,a.map((v,k)=>Math.min(v,bb[k]))); return;
        case 6: wr(fd,mul(a,bb)); return;                             // vmulbc
      }
      switch(fn){
        case 0x1c: wr(fd,a.map(v=>v*this.Q)); return;
        case 0x1e: wr(fd,a.map(v=>v*this.I)); return;
        case 0x20: wr(fd,a.map(v=>v+this.Q)); return;
        case 0x21: wr(fd,a.map((v,k)=>A[k]+f32(v*this.Q))); return;
        case 0x22: wr(fd,a.map(v=>v+this.I)); return;
        case 0x24: wr(fd,a.map(v=>v-this.Q)); return;
        case 0x26: wr(fd,a.map(v=>v-this.I)); return;
        case 0x28: wr(fd,a.map((v,k)=>v+b[k])); return;
        case 0x29: wr(fd,mul(a,b).map((v,k)=>A[k]+v)); return;
        case 0x2a: wr(fd,mul(a,b)); return;
        case 0x2b: wr(fd,a.map((v,k)=>Math.max(v,b[k]))); return;
        case 0x2c: wr(fd,a.map((v,k)=>v-b[k])); return;
        case 0x2d: wr(fd,mul(a,b).map((v,k)=>A[k]-v)); return;
        case 0x2e: { const r=[A[0]-f32(a[1]*b[2]),A[1]-f32(a[2]*b[0]),A[2]-f32(a[0]*b[1])]; if(fd) for(let k=0;k<3;k++) V[fd*4+k]=f32(r[k]); return }   // vopmsub
        case 0x2f: wr(fd,a.map((v,k)=>Math.min(v,b[k]))); return;
        case 0x30: this.vi[fd&15]=(this.vi[fs&15]+this.vi[ft&15])&0xffff; return;
        case 0x31: this.vi[fd&15]=(this.vi[fs&15]-this.vi[ft&15])&0xffff; return;
        case 0x32: { const im=((w>>>6)&31)<<27>>27; if(ft&15) this.vi[ft&15]=(this.vi[fs&15]+im)&0xffff; return }
      }
      throw new Error("VU0 "+fn.toString(16)+" at "+pc.toString(16));
    }
    const op2=(((w>>>6)&31)<<2)|(w&3), a=vs(fs), b=vs(ft), bb=[0,1,2,3].map(()=>rd(ft,bc)), A=this.vacc;
    const mul=(x,y)=>x.map((v,k)=>f32(v*y[k]));
    switch(op2>>2){
      case 0: wacc(a.map((v,k)=>v+bb[k])); return;
      case 1: wacc(a.map((v,k)=>v-bb[k])); return;
      case 2: wacc(mul(a,bb).map((v,k)=>A[k]+v)); return;
      case 3: wacc(mul(a,bb).map((v,k)=>A[k]-v)); return;
      case 6: wacc(mul(a,bb)); return;
    }
    switch(op2){
      case 0x10: case 0x11: case 0x12: case 0x13: { const sc=[1,16,4096,32768][op2-0x10]; wr(ft,[0,1,2,3].map(k=>this.itof(fs,k)/sc)); return }
      case 0x14: case 0x15: case 0x16: case 0x17: { const sc=[1,16,4096,32768][op2-0x14]; if(!ft) return; for(let k=0;k<4;k++) if(D[k]){ const i=Math.trunc(rd(fs,k)*sc); FB[0]=0; UB[0]=(Math.max(-2147483648,Math.min(2147483647,i))|0)>>>0; V[ft*4+k]=FB[0] } return }
      case 0x1c: wacc(a.map(v=>v*this.Q)); return;
      case 0x1d: wr(ft,a.map(Math.abs)); return;
      case 0x1e: wacc(a.map(v=>v*this.I)); return;
      case 0x28: wacc(a.map((v,k)=>v+b[k])); return;
      case 0x29: wacc(mul(a,b).map((v,k)=>A[k]+v)); return;
      case 0x2a: wacc(mul(a,b)); return;
      case 0x2c: wacc(a.map((v,k)=>v-b[k])); return;
      case 0x2d: wacc(mul(a,b).map((v,k)=>A[k]-v)); return;
      case 0x2e: { this.vacc[0]=f32(a[1]*b[2]); this.vacc[1]=f32(a[2]*b[0]); this.vacc[2]=f32(a[0]*b[1]); return }   // vopmula
      case 0x2f: return; // vnop
      case 0x30: wr(ft,a); return;   // vmove
      case 0x31: wr(ft,[a[1],a[2],a[3],a[0]]); return;   // vmr32
      case 0x38: { const fsf=(w>>>21)&3, ftf=(w>>>23)&3; this.Q=f32(rd(fs,fsf)/rd(ft,ftf)); return }   // vdiv
      case 0x39: { const ftf=(w>>>23)&3; this.Q=f32(Math.sqrt(Math.abs(rd(ft,ftf)))); return }
      case 0x3a: { const fsf=(w>>>21)&3, ftf=(w>>>23)&3; this.Q=f32(rd(fs,fsf)/Math.sqrt(Math.abs(rd(ft,ftf)))); return }
      case 0x3b: return; // vwaitq
      case 0x3c: this.vi[ft&15]=f2u(rd(fs,(w>>>21)&3))&0xffff; return;   // vmtir
      case 0x3d: { const v=(this.vi[fs&15]<<16)>>16; FB[0]=0; UB[0]=v>>>0; const f=FB[0]; wr(ft,[f,f,f,f]); return }   // vmfir
    }
    throw new Error("VU0 special2 "+op2.toString(16)+" at "+pc.toString(16));
  }
  itof(r,k){ FB[0]=this.vf[r*4+k]; return UB[0]|0 }
}
