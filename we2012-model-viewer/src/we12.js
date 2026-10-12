// WE2012（PS2）のデータを読む。ブラウザでも node（vm）でも動くように、最上位の関数だけで書く。
// 数は全部リトルエンディアン。

// ── AFS（0_TEXT.AFS など）: "AFS\0"・個数・(位置,大きさ)×個数。名前の表は無い ──
function weAfsIndex(u){
  const dv=new DataView(u.buffer,u.byteOffset,u.byteLength);
  if(dv.getUint32(0,true)!==0x00534641) throw new Error("AFS ではない");
  const n=dv.getUint32(4,true), ents=[];
  for(let i=0;i<n;i++) ents.push({off:dv.getUint32(8+i*8,true),size:dv.getUint32(12+i*8,true)});
  return ents;
}
// AFS の中の 1 ファイル: 頭 32 バイト（[0]=0x10600 なら圧縮、[1]=縮めた大きさ、[2]=ほどいた大きさ）のあとが zlib。
// inflate は呼ぶ側が渡す（node は zlib.inflateSync、ブラウザは DecompressionStream）
function weAfsHead(b){
  const dv=new DataView(b.buffer,b.byteOffset,b.byteLength);
  return {kind:dv.getUint32(0,true),csize:dv.getUint32(4,true),usize:dv.getUint32(8,true)};
}

// ── 入れもの: [個数, 8, 頭の大きさ, 位置1, 位置2, …]。1 つ目は頭の大きさの所から ──
function weParts(u){
  const dv=new DataView(u.buffer,u.byteOffset,u.byteLength), n=dv.getUint32(0,true);
  if(n<1||n>64||dv.getUint32(4,true)!==8) return [{off:0,end:u.length}];
  const offs=[dv.getUint32(8,true)];
  for(let k=1;k<n;k++) offs.push(dv.getUint32(8+k*4,true));
  return offs.map((o,k)=>({off:o,end:k+1<n?offs[k+1]:u.length}));
}
function weKind(u,o){
  const dv=new DataView(u.buffer,u.byteOffset,u.byteLength), w=dv.getUint32(o,true);
  return w===0x29857294?"tex":w===0xffff0003?"model":"?";
}

// ── 絵: 頭 0x29857294。[4]=点の位置(下16)・色表の位置(上16)、[5]=幅・高さ、[6] の 2 バイト目＝形式（0x13=8bit、0x14=4bit） ──
// 8bit の色表は PS2 の並べ替え（8 色ずつの 2・3 組目を入れ替え）。α は 0x80 が不透明
// 色表の位置が点の位置と同じ絵（[3]＝2。髪の 64×64）は色表を持たない。palFrom（同じファイルの前の絵）の色表を借りる【絵で確かめる】
function weTex(u,o,palFrom){
  const dv=new DataView(u.buffer,u.byteOffset,u.byteLength);
  const a=dv.getUint32(o+16,true), pix=o+(a&0xffff), own=(a>>>16)!==(a&0xffff), pal=own||palFrom==null?o+(a>>>16):palFrom;
  const wh=dv.getUint32(o+20,true), W=wh&0xffff, H=wh>>>16, psm=(dv.getUint32(o+24,true)>>8)&0xff;
  const rgba=new Uint8Array(W*H*4), col=i=>{ const p=pal+i*4; return [u[p],u[p+1],u[p+2],Math.min(255,u[p+3]*2)] };
  if(psm===0x13){
    const cl=[]; for(let i=0;i<256;i++) cl.push(col((i&0xe7)|((i&0x10)>>1)|((i&0x08)<<1)));
    for(let i=0;i<W*H;i++) rgba.set(cl[u[pix+i]],i*4);
  } else if(psm===0x14){
    const cl=[]; for(let i=0;i<16;i++) cl.push(col(i));
    for(let i=0;i<W*H;i++) rgba.set(cl[(u[pix+(i>>1)]>>((i&1)*4))&15],i*4);
  } else return {W,H,psm,rgba:null};
  return {W,H,psm,rgba,pal};
}

// ── 形: 頭 0xffff0003。[8]=包みの数、[9]=最初の包みの位置。包み＝[大きさ, 0, VIF の位置, …] のあとに VIF の命令列 ──
// VIF の UNPACK: 0x69（V3-16）を 4 番地に＝位置、5 番地＝法線、0x65（V2-16）を 7 番地＝UV（/4096）。
// 0x6d（V4-16）を頂点の後ろ（8＋4×頂点数 番地）に＝頂点の並び（値/4−1 が頂点の番号、0x8000 の印は「三角形を閉じない」）。並びは帯（ストリップ）
function weVifSize(cmd,num){ const vn=(cmd>>2)&3, vl=cmd&3, bits=vl===3?16:(vn+1)*(32>>vl); return Math.ceil(num*bits/32)*4 }
function weVifWalk(u,p,end){
  const dv=new DataView(u.buffer,u.byteOffset,u.byteLength), out=[];
  while(p+4<=end){
    const w=dv.getUint32(p,true), cmd=(w>>>24)&0x7f, num=(w>>>16)&0xff, imm=w&0xffff; let q=p+4;
    if(cmd>=0x60){ const n=num||256; out.push({cmd,num:n,addr:imm&0x3ff,flg:imm>>15,at:q}); q+=weVifSize(cmd,n) }
    else if(cmd===0x20) q+=4;
    else if(cmd===0x30||cmd===0x31) q+=16;
    else if(cmd===0x50||cmd===0x51) q+=(imm||65536)*16;
    else if(cmd===0x4a) q+=(num||256)*8;
    else if(!(cmd<=7||cmd===0x10||cmd===0x11||cmd===0x13||cmd===0x14||cmd===0x15||cmd===0x17)) break;
    p=q;
  }
  return out;
}
// 形を三角形の並びにする。{tris:[{p:[[x,y,z]×3], uv:[[s,t]×3], n:[[…]×3], pk}], packets}
function weModel(u,b){
  const dv=new DataView(u.buffer,u.byteOffset,u.byteLength);
  const npk=dv.getUint32(b+0x20,true); let po=b+dv.getUint32(b+0x24,true);
  const tris=[], packets=[];
  for(let k=0;k<npk;k++){
    const size=dv.getUint32(po,true), vifAt=po+dv.getUint32(po+8,true);
    const un=weVifWalk(u,vifAt,po+size);
    const get=(cmd,addr)=>un.find(x=>x.cmd===cmd&&x.addr===addr);
    const P=get(0x69,4), N=get(0x69,5), T=get(0x65,7), I=un.filter(x=>x.cmd===0x6d&&x.addr===8+4*(P?P.num:0)).pop();   // 並びは頂点の後ろ（8＋4×頂点数 番地。見本の全部の包みで合う）。小さい包みでは 0x40 より前になる
    if(P&&I){
      const s16=a=>dv.getInt16(a,true), V=[], NV=[], UV=[];
      for(let i=0;i<P.num;i++){ V.push([s16(P.at+i*6),s16(P.at+i*6+2),s16(P.at+i*6+4)]);
        NV.push(N?[s16(N.at+i*6)/32768,s16(N.at+i*6+2)/32768,s16(N.at+i*6+4)/32768]:[0,0,1]);
        UV.push(T?[s16(T.at+i*4)/4096,s16(T.at+i*4+2)/4096]:[0,0]) }
      // 包みの頭の [16] の上 8 ビット＝使う絵の番号（見本では 3600 の 1 つの包みが 1＝64×64。1 枚目の色表を借りると三つ編みがつながる。絵で確認）
      const texi=dv.getUint32(po+64,true)>>>24, nIdx=dv.getUint32(po+12,true), idx=[];
      // 包みの頭の [13]（sel、+0x34）。部位の番号（骨？）。JWE2010 の顔で 0＝顔、1＝目、2＝あごの重ね、3＝耳、4＝口の中、髪で 0＝生え際の帯、1＝前髪、2＝後ろ（SELCOLOR=1 の絵で見た）
      const sel=dv.getUint32(po+0x34,true);
      for(let i=0;i<I.num*4;i++) idx.push(dv.getUint16(I.at+i*2,true));
      let a=-1,c=-1,nt=0;
      for(let i=0;i<idx.length;i++){
        const w=idx[i], v=((w&0x7fff)>>2)-1;
        if(!(w&0x8000)&&a>=0&&c>=0&&v>=0&&v<V.length&&a<V.length&&c<V.length){
          // 向き: 帯の交互の数え方は合っていない（法線と逆向きが 4 割）。頂点の法線（VIF の 5 番地）の和と同じ側を表にする
          let f=[a,c,v]; nt++;
          { const [p,q,r]=f.map(j=>V[j]), e1=[q[0]-p[0],q[1]-p[1],q[2]-p[2]], e2=[r[0]-p[0],r[1]-p[1],r[2]-p[2]];
            const n=[e1[1]*e2[2]-e1[2]*e2[1],e1[2]*e2[0]-e1[0]*e2[2],e1[0]*e2[1]-e1[1]*e2[0]], s=[0,1,2].map(i=>NV[a][i]+NV[c][i]+NV[v][i]);
            if(n[0]*s[0]+n[1]*s[1]+n[2]*s[2]<0) f=[c,a,v] }
          tris.push({p:f.map(j=>V[j]),uv:f.map(j=>UV[j]),n:f.map(j=>NV[j]),pk:k,texi,sel}) }
        else if(w&0x8000) nt=0;
        a=c; c=v;
      }
      packets.push({at:po,nv:P.num,nIdx,idx,texi,sel});
    }
    po+=size;
  }
  return {tris,packets};
}

// ── ディスク: ISO（2048 バイトの区切り、ISO9660）か、0_TEXT.AFS そのもの。File.slice で要る所だけ読む ──
async function weBytes(file,off,n){ return new Uint8Array(await file.slice(off,off+n).arrayBuffer()) }
// ISO の根の一覧から name を探す（PS2 の DVD は根に直に並ぶ）。{off,size}
async function weIsoFind(file,name){
  const pvd=await weBytes(file,16*2048,2048);
  if(String.fromCharCode(...pvd.subarray(1,6))!=="CD001") return null;
  const dv=new DataView(pvd.buffer), lba=dv.getUint32(156+2,true), len=dv.getUint32(156+10,true);
  const dir=await weBytes(file,lba*2048,len), dd=new DataView(dir.buffer);
  for(let p=0;p<dir.length;){
    const L=dir[p]; if(!L){ p=(Math.floor(p/2048)+1)*2048; continue }
    const nl=dir[p+32], nm=String.fromCharCode(...dir.subarray(p+33,p+33+nl)).replace(/;1$/,"");
    if(nm.toUpperCase()===name) return {off:dd.getUint32(p+2,true)*2048,size:dd.getUint32(p+10,true)};
    p+=L;
  }
  return null;
}
// ISO でも AFS でも開く。{base, ents, from}
async function weOpen(file){
  let base=0, from="AFS";
  const h=await weBytes(file,0,4);
  if(!(h[0]===0x41&&h[1]===0x46&&h[2]===0x53&&h[3]===0)){
    const f=await weIsoFind(file,"0_TEXT.AFS");
    if(!f) throw new Error("ISO の中に 0_TEXT.AFS が無い（ウイニングイレブン2012 の PS2 のディスクではない？）か、ISO でも AFS でもないファイルです");
    base=f.off; from="ISO";
  }
  const n=new DataView((await weBytes(file,base+4,4)).buffer).getUint32(0,true);
  if(!(n>0&&n<100000)) throw new Error("AFS の個数が変です");
  const ents=weAfsIndex(await weBytes(file,base,8+n*8));
  return {base,ents,from};
}
// zlib をほどく（ブラウザも node 18 以降も DecompressionStream がある）
async function weInflate(b){
  const s=new Blob([b]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
// AFS の i 番目をほどいて返す。頭が圧縮の印で zlib の頭（0x78）があればほどく。ほどけなければそのまま
async function weFile(file,disc,i){
  const e=disc.ents[i]; if(!e||!e.size) return new Uint8Array(0);
  const b=await weBytes(file,disc.base+e.off,e.size);
  if(b.length>34&&b[32]===0x78){ const h=weAfsHead(b);
    try{ return await weInflate(b.subarray(32,32+h.csize)) }catch(err){} }
  return b;
}
// ほどいた中身の並び（M＝形、T＝絵、?＝ほか）。「MMT」＝顔、「MTT」＝髪（見本 3 つずつで絵で確かめた形）
function weSig(u){
  if(u.length<16) return "";
  try{ return weParts(u).map(p=>p.off+4<=u.length?{model:"M",tex:"T"}[weKind(u,p.off)]||"?":"?").join("") }catch(e){ return "?" }
}
// 形と絵を、ページで描ける形にする。1 つ目の形だけ（顔の 2 つ目は細かさ違いと推測）。all なら全部。
// 座標はゲーム（Y 下・顔が +X）→ 画面（Y 上・顔が手前 +Z）: (x,y,z)→(z,−y,x)。鏡写しにはしない
function weMeshes(u,all){
  const parts=weParts(u), texs=[], models=[];
  for(const p of parts){ const k=weKind(u,p.off); if(k==="tex") texs.push(weTex(u,p.off,texs.at(-1)?.pal)); if(k==="model") models.push(p.off) }
  // 包みの頭の [16] の上 8 ビット＝絵の番号（髪の 64×64 は 1。絵で確認）。絵ごとに形を分ける
  const meshes=[];
  for(const off of all?models:models.slice(0,1)){
    const m=weModel(u,off), by=new Map();
    for(const t of m.tris){ const k=texs[t.texi]?.rgba?t.texi:0; if(!by.has(k)) by.set(k,[]); by.get(k).push(t) }
    for(const [k,ts] of by){ const f=new Float32Array(ts.length*15); let n=0;
      for(const t of ts) for(let j=0;j<3;j++){ const p=t.p[j]; f[n++]=p[2]; f[n++]=-p[1]; f[n++]=p[0]; f[n++]=t.uv[j][0]; f[n++]=t.uv[j][1] }
      meshes.push({f,ntri:ts.length,tex:texs[k]?.rgba?texs[k]:null}) }
  }
  return {meshes,texs};
}
// ファイルの中の絵を全部探す（入れものが入れ子のときも）。頭の印と、幅・高さが 2 のべき乗で 1024 以下のものだけ
function weFindTex(u){
  const out=[], dv=new DataView(u.buffer,u.byteOffset,u.byteLength), p2=x=>x>=8&&x<=1024&&!(x&(x-1));
  for(let o=0;o+32<=u.length;o+=16){ if(dv.getUint32(o,true)!==0x29857294) continue;
    const wh=dv.getUint32(o+20,true); if(!p2(wh&0xffff)||!p2(wh>>>16)) continue;
    try{ out.push({...weTex(u,o,out.at(-1)?.pal),at:o}) }catch(e){} }
  return out;
}
