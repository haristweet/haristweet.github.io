// FV のアーケードのテクスチャを、ディスクの ROM_CODE1（i960 のプログラム）と ROM_DATA（main_data、0x2000000〜）から作る。
// 読み込みの流れ（FV 0x4b5ec〜）は VF2 の 0x4bd60〜 と命令単位で同じで、関数の番地だけ違う（arcade.js の I960 を使う）:
// テクスチャ RAM の書き先の頭は、VF2 は定数（0x12200000・0x12600000）だが FV は RAM の [0x500254]（ページ0）・[0x500258]（ページ1）から読み、
// 16bit の語を 2 バイトおきに書く（VF2 は 4 バイトおき）。段（ミップマップ）ごとの進みは 0xc0000（VF2 は 0x180000）。ここでは 0x40000000・0x48000000 を入れて受ける
//   VF2 0x4d16c→FV 0x4ca74（段ごとの写し先）・0x4c180→0x4ba2c（符号の木で展開）・0x4cb64→0x4c470・0x4cd18→0x4c620・0x4c9dc→0x4c2a0・表 0x4c120→0x4b9c0
const FVA={place:0x4ca74, huff:0x4ba2c, b:0x4c470, c:0x4c620, other:0x4c2a0, tbl:0x4b9c0};
function fvArcLoader(prog,data){
  const code={readUInt32LE:a=>(prog[a]|prog[a+1]<<8|prog[a+2]<<16|prog[a+3]<<24)>>>0};
  const ram=new Uint8Array(0x100000), ram2=new Uint8Array(0x40000), tex=[new Uint16Array(0x80000),new Uint16Array(0x80000)], mask=[new Uint8Array(0x80000),new Uint8Array(0x80000)];
  const r8=A=>{ A>>>=0;
    if(A<0x80000) return prog[A];
    if(A>=0x500000&&A<0x600000) return ram[A-0x500000];
    if(A>=0x200000&&A<0x240000) return ram2[A-0x200000];
    if(A>=0x2000000&&A<0x3000000) return data[A-0x2000000];
    if(A>=0xf00000&&A<0xf00010) return 0xff;   // タイマー: いつも「まだ時間がある」
    return 0 };
  const texw=(A,v)=>{ const s=(A>>>27)&1, h=((A&0x7ffffff)>>>1)&0x7ffff; tex[s][h]=v&0xffff; mask[s][h]=1 };
  const mem={ r8, r16:A=>r8(A)|r8(A+1)<<8, r32:A=>(r8(A)|r8(A+1)<<8|r8(A+2)<<16|r8(A+3)<<24)>>>0,
    w8(A,v){ A>>>=0; if(A>=0x500000&&A<0x600000) ram[A-0x500000]=v; else if(A>=0x200000&&A<0x240000) ram2[A-0x200000]=v },
    w16(A,v){ A>>>=0; if(A>=0x40000000&&A<0x50000000) return texw(A,v); this.w8(A,v&255); this.w8(A+1,v>>>8&255) },
    w32(A,v){ A>>>=0; if(A>=0x40000000&&A<0x50000000) return texw(A,v); for(let k=0;k<4;k++) this.w8(A+k,(v>>>(8*k))&255) } };
  const cpu=new I960(code,mem); mem.w32(0x500254,0x40000000); mem.w32(0x500258,0x48000000);
  function loadSet(s,flip=0){
    const R=cpu.r, r32=mem.r32;
    let r10=r32(r32(0x230000c)+s*4); const first=r32(r10); r10+=4;
    let r9=r32(r32(0x2300008)+first*4); const n=r32(r9); r9+=4;
    for(let e=0;e<n;e++){
      const g2=r32(r9), g0=(g2<<16)>>>17;
      R[1]=R[31]=0x5f0000; mem.w32(0x550080,0); mem.w32(0x5500f4,0); mem.w8(0x500000,0); mem.w8(0x50008c,0); mem.w32(0x55c2f4,flip&1); mem.w32(0x550004,0x12a8); mem.w32(0x550008,0x4e20);
      R[24]=(g2^flip)&1; R[22]=(mem.r16(FVA.tbl+g0*4)+(g2>>>24))>>>0; R[23]=(mem.r16(FVA.tbl+2+g0*4)+((g2<<8)>>>24))>>>0;
      cpu.run(FVA.place);
      let g3=r32(r10); const t=r32(g3); R[19]=g3+4;
      if(t===0){ cpu.run(FVA.huff); cpu.run(FVA.b); cpu.run(FVA.c) } else cpu.run(FVA.other);
      r9+=4; r10+=4;
    }
    return n;
  }
  return {cpu,mem,tex,mask,loadSet};
}
