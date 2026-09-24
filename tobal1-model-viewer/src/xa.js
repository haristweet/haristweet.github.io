const XA_K0=[0,60,115,98,122], XA_K1=[0,0,-52,-55,-60];
function xaDecodeSector(b,hist,L,R,off){   // 4bit・ステレオ・37800Hz。1セクタ = 18グループ × 4組 × 28サンプル = 2016 フレーム
  for(let g=0;g<18;g++){
    const o=24+g*128;
    for(let u=0;u<8;u++){
      const p=b[o+4+u], rng=p&15, flt=(p>>4)&7, ch=u&1, dst=ch?R:L, hh=hist[ch];
      let h1=hh[0], h2=hh[1]; const k0=XA_K0[flt]||0, k1=XA_K1[flt]||0, base=off+(g*4+(u>>1))*28;
      for(let i=0;i<28;i++){
        let n=(b[o+16+i*4+(u>>1)]>>((u&1)*4))&15; if(n&8) n-=16;
        let v=((n<<12)>>rng)+((h1*k0+h2*k1+32)>>6);
        v=v<-32768?-32768:v>32767?32767:v; h2=h1; h1=v; dst[base+i]=v/32768;
      }
      hh[0]=h1; hh[1]=h2;
    }
  }
}
