// ディスクのイメージを読む。CHD（MAME の圧縮イメージ v5・CD。cdlz/cdzl）は tobal1-model-viewer/src/disc.js の読み取りを写したもの、
// .bin（2352）・.iso（2048）・BIN.CVM は VF2 の vdisc.js と同じ。返り値: Map(名前 → () => Promise<Uint8Array>)
// ============================================================
//  CHD（MAME の圧縮ディスクイメージ、v5・CD）
// ============================================================
class MsbBits{
  constructor(d){this.d=d;this.pos=0}
  peek(n){let v=0;for(let i=0;i<n;i++){const p=this.pos+i;v=v*2+(((this.d[p>>3]||0)>>(7-(p&7)))&1)}return v}
  read(n){const v=this.peek(n);this.pos+=n;return v}
}
function huffmanFromRle(br,numcodes,maxbits){
  const nb=maxbits>=16?5:maxbits>=8?4:3, len=new Array(numcodes).fill(0);
  for(let cur=0;cur<numcodes;){
    let b=br.read(nb);
    if(b!==1){len[cur++]=b;continue}
    b=br.read(nb);
    if(b===1){len[cur++]=1;continue}
    for(let r=br.read(nb)+3;r>0&&cur<numcodes;r--) len[cur++]=b;
  }
  const hist=new Array(33).fill(0); for(const l of len) if(l) hist[l]++;
  let start=0; for(let l=32;l>0;l--){const next=(start+hist[l])>>1; hist[l]=start; start=next}
  const table=new Array(1<<maxbits).fill(0);
  len.forEach((l,sym)=>{ if(!l) return; const code=hist[l]++, sh=maxbits-l; for(let k=code<<sh;k<((code+1)<<sh);k++) table[k]=[sym,l] });
  return ()=>{const e=table[br.peek(maxbits)]; if(!e) throw new Error("CHD の目次が壊れています"); br.pos+=e[1]; return e[0]};
}
function lzmaDecode(src,outLen,lc=3,lp=0,pb=2){
  const out=new Uint8Array(outLen);
  let ip=5, range=0xFFFFFFFF, code=((src[1]<<24)>>>0)+(src[2]<<16)+(src[3]<<8)+src[4];
  const P=n=>new Uint16Array(n).fill(1024);
  const bit=(p,i)=>{
    const b=(range>>>11)*p[i]; let r;
    if(code<b){range=b; p[i]+=(2048-p[i])>>5; r=0} else {range-=b; code-=b; p[i]-=p[i]>>5; r=1}
    if(range<16777216){range*=256; code=code*256+(src[ip++]||0)}
    return r;
  };
  const tree=(p,base,n)=>{let m=1;for(let i=0;i<n;i++)m=(m<<1)+bit(p,base+m);return m-(1<<n)};
  const rtree=(p,base,n)=>{let m=1,s=0;for(let i=0;i<n;i++){const b=bit(p,base+m);m=(m<<1)+b;s|=b<<i}return s};
  const isMatch=P(192),isRep=P(12),isRepG0=P(12),isRepG1=P(12),isRepG2=P(12),isRep0Long=P(192);
  const posSlot=P(256),specPos=P(114),align=P(16),lenC=P(514),repLenC=P(514),lit=P(0x300<<(lc+lp));
  const len=(p,ps)=>!bit(p,0)?tree(p,2+(ps<<3),3):!bit(p,1)?8+tree(p,130+(ps<<3),3):16+tree(p,258,8);
  let state=0,r0=0,r1=0,r2=0,r3=0,op=0;
  const pbMask=(1<<pb)-1, lpMask=(1<<lp)-1;
  while(op<outLen){
    const ps=op&pbMask;
    if(!bit(isMatch,(state<<4)+ps)){
      const base=0x300*(((op&lpMask)<<lc)+((op?out[op-1]:0)>>(8-lc)));
      let s=1;
      if(state<7){ while(s<0x100) s=(s<<1)|bit(lit,base+s) }
      else{
        let mb=out[op-r0-1];
        while(s<0x100){ const m=(mb>>7)&1; mb<<=1; const b=bit(lit,base+0x100+(m<<8)+s); s=(s<<1)|b; if(m!==b){ while(s<0x100) s=(s<<1)|bit(lit,base+s); break } }
      }
      out[op++]=s&255; state=state<4?0:state<10?state-3:state-6; continue;
    }
    let n;
    if(bit(isRep,state)){
      if(!bit(isRepG0,state)){
        if(!bit(isRep0Long,(state<<4)+ps)){ state=state<7?9:11; out[op]=out[op-r0-1]; op++; continue }
      }else{
        let d;
        if(!bit(isRepG1,state)) d=r1; else { if(!bit(isRepG2,state)) d=r2; else {d=r3; r3=r2} r2=r1 }
        r1=r0; r0=d;
      }
      n=len(repLenC,ps); state=state<7?8:11;
    }else{
      r3=r2; r2=r1; r1=r0;
      n=len(lenC,ps); state=state<7?7:10;
      const slot=tree(posSlot,Math.min(n,3)<<6,6);
      if(slot<4) r0=slot;
      else{
        const nd=(slot>>1)-1; let d=(2|(slot&1))*2**nd;
        if(slot<14) d+=rtree(specPos,d-slot-1,nd);
        else{
          let direct=0;
          for(let i=0;i<nd-4;i++){ range=range>>>1; let b=0; if(code>=range){code-=range;b=1} direct=direct*2+b; if(range<16777216){range*=256; code=code*256+(src[ip++]||0)} }
          d+=direct*16+rtree(align,0,4);
        }
        if(d>=0xFFFFFFFF) break;
        r0=d;
      }
    }
    for(n+=2;n>0&&op<outLen;n--,op++) out[op]=out[op-r0-1];
  }
  return out;
}
async function inflateRaw(data){
  if(typeof DecompressionStream==="undefined") throw new Error("このブラウザは CHD の展開に必要な機能に対応していません。iPhone は iOS 16.4 以降にしてください（.bin なら読めます）");
  const s=new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
class ChdDisc{
  constructor(file){this.file=file;this.cache=new Map()}
  async bytes(off,n){return new Uint8Array(await this.file.slice(off,off+n).arrayBuffer())}
  async init(){
    const h=await this.bytes(0,124), dv=new DataView(h.buffer);
    if(String.fromCharCode(...h.subarray(0,8))!=="MComprHD") throw new Error("CHD ファイルとして読めませんでした");
    if(dv.getUint32(12)!==5) throw new Error("この版の CHD にはまだ対応していません（v5 のみ）");
    this.codecs=[0,1,2,3].map(i=>String.fromCharCode(...h.subarray(16+i*4,20+i*4)).replace(/\0/g,""));
    const logical=Number(dv.getBigUint64(32)), mapoff=Number(dv.getBigUint64(40));
    this.hunkBytes=dv.getUint32(56); this.unitBytes=dv.getUint32(60);
    if(dv.getBigUint64(104)|dv.getBigUint64(112)) throw new Error("差分形式（親ファイルが必要）の CHD には対応していません");
    if(!this.codecs[0]) throw new Error("非圧縮の CHD にはまだ対応していません");
    const count=Math.ceil(logical/this.hunkBytes);
    const mh=await this.bytes(mapoff,16), mdv=new DataView(mh.buffer);
    const mapLen=mdv.getUint32(0), lengthBits=mh[12], selfBits=mh[13], parentBits=mh[14];
    let cur=mdv.getUint32(4)*65536+mdv.getUint16(8);
    const br=new MsbBits(await this.bytes(mapoff+16,mapLen)), dec=huffmanFromRle(br,16,8);
    const types=new Uint8Array(count);
    for(let i=0,last=0,rep=0;i<count;i++){
      if(rep>0){types[i]=last;rep--;continue}
      const v=dec();
      if(v===7){types[i]=last;rep=2+dec()}
      else if(v===8){types[i]=last;rep=2+16+(dec()<<4);rep+=dec()}
      else types[i]=last=v;
    }
    this.map=[];
    for(let i=0,lastSelf=0;i<count;i++){
      let t=types[i], off=0, len=0;
      if(t<=3){len=br.read(lengthBits);off=cur;cur+=len;br.read(16)}
      else if(t===4){len=this.hunkBytes;off=cur;cur+=len;br.read(16)}
      else if(t===5){off=lastSelf=br.read(selfBits)}
      else if(t===9||t===10){if(t===10)lastSelf++;t=5;off=lastSelf}
      else throw new Error("親ファイルを参照する CHD には対応していません");
      this.map.push([t,off,len]);
    }
    const f0=await this.hunk(0);
    this.dataOff=f0[15]===1?16:24;
  }
  async hunk(i){
    if(this.cache.has(i)) return this.cache.get(i);
    const [t,off,len]=this.map[i]; let out;
    if(t===5) out=await this.hunk(off);
    else if(t===4) out=await this.bytes(off,len);
    else{
      const src=await this.bytes(off,len), codec=this.codecs[t], hb=this.hunkBytes;
      if(!/^cd(lz|zl)$/.test(codec)) throw new Error(`この圧縮形式（${codec}）の部分はまだ読めません`);
      const frames=hb/2448, eccBytes=(frames+7)>>3, clBytes=hb<65536?2:3;
      let cl=0; for(let k=0;k<clBytes;k++) cl=cl*256+src[eccBytes+k];
      const body=src.subarray(eccBytes+clBytes,eccBytes+clBytes+cl);
      const sect=codec==="cdlz"?lzmaDecode(body,frames*2352):await inflateRaw(body);
      out=new Uint8Array(hb);
      for(let f=0;f<frames;f++) out.set(sect.subarray(f*2352,(f+1)*2352),f*2448);
    }
    if(this.cache.size>64) this.cache.delete(this.cache.keys().next().value);
    this.cache.set(i,out); return out;
  }
  async read(lba,count){
    const out=new Uint8Array(count*2048);
    for(let k=0;k<count;k++){
      const pos=(lba+k)*this.unitBytes, h=await this.hunk(Math.floor(pos/this.hunkBytes)), o=pos%this.hunkBytes;
      out.set(h.subarray(o+this.dataOff,o+this.dataOff+2048),k*2048);
    }
    return out;
  }
  async readRaw(lba){ const pos=lba*this.unitBytes, h=await this.hunk(Math.floor(pos/this.hunkBytes)), o=pos%this.hunkBytes; return h.subarray(o,o+2352) }
  async rootFiles(){return BinDisc.prototype.rootFiles.call(this)}
}
async function vdSlice(file,off,len){ return new Uint8Array(await file.slice(off,off+len).arrayBuffer()) }
function vdWalk(readSec,root){   // ISO9660 のファイルを全部たどる。readSec(lba,count)→Promise<Uint8Array>
  const out=[];
  const walk=async(lba,size,pre)=>{
    const d=await readSec(lba,Math.ceil(size/2048)), dv=new DataView(d.buffer,d.byteOffset,d.byteLength);
    for(let p=0;p<d.length;){
      const L=d[p]; if(!L){ p=(Math.floor(p/2048)+1)*2048; continue }
      const el=dv.getUint32(p+2,true), es=dv.getUint32(p+10,true), fl=d[p+25], nl=d[p+32];
      const nm=String.fromCharCode(...d.subarray(p+33,p+33+nl)).split(";")[0];
      if(nl===1&&d[p+33]<2){ p+=L; continue }
      if(fl&2) await walk(el,es,pre+nm+"/"); else out.push({name:pre+nm,lba:el,size:es});
      p+=L;
    }
  };
  return walk(root[0],root[1],"").then(()=>out);
}
function vdRootOf(pvd){ const dv=new DataView(pvd.buffer,pvd.byteOffset,pvd.byteLength); return [dv.getUint32(156+2,true),dv.getUint32(156+10,true)] }
// 2048 バイトのセクタを読む関数から、File と同じ slice(a,b).arrayBuffer() で読める物を作る（CHD の中の BIN.CVM を全部展開せずに読む）
function fdSectorFile(readSec,lba,size){
  return {size, slice(a,b){ return {arrayBuffer:async()=>{ b=Math.min(b,size); if(b<=a) return new ArrayBuffer(0);
    const s0=Math.floor(a/2048), s1=Math.ceil(b/2048), d=await readSec(lba+s0,s1-s0); return d.slice(a-s0*2048,b-s0*2048).buffer } } } };
}
async function discOpen(file){
  const head=await vdSlice(file,0,16);
  let cvm=null;
  if(String.fromCharCode(...head.subarray(0,4))==="CVMH") cvm=file;
  else {
    let readSec;
    if(String.fromCharCode(...head.subarray(0,8))==="MComprHD"){ const chd=new ChdDisc(file); await chd.init(); readSec=(lba,n)=>chd.read(lba,n) }
    else {
      let sec,base;
      if(String.fromCharCode(...(await vdSlice(file,16*2352+25,5)))==="CD001"){ sec=2352; base=24 }
      else if(String.fromCharCode(...(await vdSlice(file,16*2048+1,5)))==="CD001"){ sec=2048; base=0 }
      else throw new Error("ディスクのイメージ（.chd・.bin・.iso）か BIN.CVM ではない");
      readSec=async(lba,n)=>{ const raw=await vdSlice(file,lba*sec,n*sec); if(sec===2048) return raw;
        const o=new Uint8Array(n*2048); for(let i=0;i<n;i++) o.set(raw.subarray(i*sec+base,i*sec+base+2048),i*2048); return o };
    }
    const list=await vdWalk(readSec,vdRootOf(await readSec(16,1)));
    const e=list.find(f=>f.name.toUpperCase()==="BIN.CVM");
    if(!e) throw new Error("ディスクの中に BIN.CVM が無い（ファイティングバイパーズの PS2 版ではない？）");
    cvm=fdSectorFile(readSec,e.lba,e.size);
  }
  const ch=await vdSlice(cvm,0,0x20000); let at=-1;
  for(let i=0;i<ch.length-6;i++) if(ch[i]===1&&ch[i+1]===0x43&&ch[i+2]===0x44&&ch[i+3]===0x30&&ch[i+4]===0x30&&ch[i+5]===0x31){ at=i; break }
  if(at<0) throw new Error("BIN.CVM の中に ISO9660 が見つからない");
  const base=at-16*2048, readSec=(lba,n)=>vdSlice(cvm,base+lba*2048,n*2048), files=new Map();
  for(const f of await vdWalk(readSec,vdRootOf(await readSec(16,1))))
    files.set(f.name,()=>vdSlice(cvm,base+f.lba*2048,f.size));
  return files;
}
