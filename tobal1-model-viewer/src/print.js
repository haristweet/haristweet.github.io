// ============================================================
//  3Dプリント用に、閉じた形を作り直す
//
//  PS1 のモデルは画面に映すための作りで、部品ごとに穴があき、面が重なり、
//  顔の貼りものは厚みが 0。印刷サービスは「水が漏れない閉じた形」を求めるので、
//  元の面をつなぎ直すのではなく、形を丸ごと作り直す。
//    1. 升目（ボクセル）に置き、面が通る升に印を付ける（色も覚える）
//    2. 印を太らせる（最小の厚み）。薄い所に厚みが付き、小さな穴がふさがる
//    3. 外から塗りつぶし、外に届かなかった所を全部「中身」にする
//    4. （選べば）台座を足す／中を空洞にする
//    5. 表面を作り直す（四面体で切る方式。あいまいな場合が無いので、必ず閉じる）
//  出てきた形は、辺がどれもちょうど2枚の面に逆向きで使われている（閉じていて向きがそろう）。
//  それを数えて確かめる（printCheck）
// ============================================================

// 画面に描いている面の色を、印刷用に1点ずつ取る。
// シェーダと同じ引き方（4bit/8bit はパレット経由）。光の当たり具合は入れない
function printTexel(V,u,v,tp,t1){
  if(!V) return null;
  const word=(x,y)=>{ x|=0; y|=0; if(x<0||y<0||x>=1024||y>=512) return 0; const i=(y*1024+x)*4; return V[i]|(V[i+1]<<8) };
  const mode=Math.round(tp); u=Math.floor(u); v=Math.floor(v);
  let w;
  if(mode<1) return null;
  if(mode<5){ w=word(t1[0]+(u>>2),t1[1]+v); w=(w>>((u&3)*4))&15; w=word(t1[2]+w,t1[3]) }
  else if(mode<9){ w=word(t1[0]+(u>>1),t1[1]+v); w=(w>>((u&1)*8))&255; w=word(t1[2]+w,t1[3]) }
  else w=word(t1[0]+u,t1[1]+v);
  if(!w) return -1;                                   // 透けている
  return [(w&31)/31,((w>>5)&31)/31,((w>>10)&31)/31];
}

// meshes: [{pos,col,t0,t1,vram}]（画面の層と同じ形。座標は Y が上）
// o: {height:mm, res:升の数（いちばん長い辺）, thick:最小の厚み mm, base:台座, baseH:台座の厚み mm,
//     hollow:中を空洞, shell:殻の厚み mm}
async function printBuild(meshes,o,progress){
  const tick=async m=>{ if(progress) await progress(m) };
  o=Object.assign({height:100,res:160,thick:1,base:true,baseH:3,hollow:false,shell:2},o||{});
  // ---- 大きさを mm にそろえる ----
  let mn=[1e9,1e9,1e9], mx=[-1e9,-1e9,-1e9];
  for(const m of meshes){ const P=m.pos; for(let i=0;i<P.length;i+=3) for(let a=0;a<3;a++){ if(P[i+a]<mn[a])mn[a]=P[i+a]; if(P[i+a]>mx[a])mx[a]=P[i+a] } }
  if(!(mx[1]>mn[1])) throw new Error("形がありません");
  const s=o.height/(mx[1]-mn[1]);                     // 元の単位 → mm
  const size=[0,1,2].map(a=>(mx[a]-mn[a])*s);
  const baseH=o.base?Math.max(0.5,o.baseH):0;
  const vox=Math.max(size[0],size[1]+baseH,size[2])/o.res;   // 升1つの大きさ（mm）
  const r=Math.max(1,Math.round(o.thick/2/vox));      // 太らせる升の数（両側で最小の厚みになる）
  const pad=r+3, padXZ=pad+(o.base?Math.ceil(4/vox)+1:0);   // 台座は足もとより 4mm 広い
  const nx=Math.ceil(size[0]/vox)+2*padXZ+2, ny=Math.ceil((size[1]+baseH)/vox)+2*pad+2, nz=Math.ceil(size[2]/vox)+2*padXZ+2;
  const N=nx*ny*nz; if(N>40e6) throw new Error("升が多すぎます（細かさを下げてください）");
  const ox=padXZ, oy=pad+Math.ceil(baseH/vox), oz=padXZ;   // 元の最小の点が来る升
  const at=(x,y,z)=>x+nx*(y+ny*z);
  // mm の座標（原点はモデルのいちばん下・左・奥。台座はその下）
  const toG=(P,i)=>[(P[i]-mn[0])*s/vox+ox,(P[i+1]-mn[1])*s/vox+oy,(P[i+2]-mn[2])*s/vox+oz];

  // ---- 1. 面が通る升に印を付ける。色も覚える（貼りものの色を優先） ----
  await tick("面を升目に置いています…");
  const mark=new Uint8Array(N);                       // 0=空 1=体 2=貼りもの（色が勝つ）
  const cr=new Uint8Array(N), cg=new Uint8Array(N), cb=new Uint8Array(N);
  for(const m of meshes){
    const P=m.pos, C=m.col, T0=m.t0, T1=m.t1, V=m.vram;
    const nt=P.length/9;
    for(let t=0;t<nt;t++){
      const a=toG(P,t*9), b=toG(P,t*9+3), c=toG(P,t*9+6);
      const tex=T0&&T0[t*9+2]>0.5&&V;
      const L=Math.max(Math.hypot(b[0]-a[0],b[1]-a[1],b[2]-a[2]),Math.hypot(c[0]-a[0],c[1]-a[1],c[2]-a[2]),Math.hypot(c[0]-b[0],c[1]-b[1],c[2]-b[2]));
      const n=Math.max(1,Math.ceil(L*2));             // 升の半分より細かく刻む
      for(let i=0;i<=n;i++) for(let j=0;j<=n-i;j++){
        const u=i/n, v=j/n, w=1-u-v;
        const x=Math.floor(a[0]*w+b[0]*u+c[0]*v), y=Math.floor(a[1]*w+b[1]*u+c[1]*v), z=Math.floor(a[2]*w+b[2]*u+c[2]*v);
        if(x<0||y<0||z<0||x>=nx||y>=ny||z>=nz) continue;
        let col=[C[t*9]*w+C[t*9+3]*u+C[t*9+6]*v,C[t*9+1]*w+C[t*9+4]*u+C[t*9+7]*v,C[t*9+2]*w+C[t*9+5]*u+C[t*9+8]*v], lv=1;
        if(tex){
          const tu=T0[t*9]*w+T0[t*9+3]*u+T0[t*9+6]*v, tv=T0[t*9+1]*w+T0[t*9+4]*u+T0[t*9+7]*v;
          const tx=printTexel(V,tu,tv,T0[t*9+2],[T1[t*12],T1[t*12+1],T1[t*12+2],T1[t*12+3]]);
          if(tx===-1) continue;                        // 透けている所は形にも色にもしない
          if(tx){ col=tx.map((q,k)=>Math.min(1,q*col[k]*255/128)); lv=2 }
        }
        const k=at(x,y,z);
        if(mark[k]>lv) continue;
        mark[k]=lv; cr[k]=col[0]*255; cg[k]=col[1]*255; cb[k]=col[2]*255;
      }
    }
    await tick("面を升目に置いています…");
  }

  // ---- 台座（足もとを囲む板）。上の面は足の裏に少しめり込ませてつなぐ ----
  if(o.base){
    await tick("台座を足しています…");
    let x0=1e9,x1=-1e9,z0=1e9,z1=-1e9; const yTop=oy+Math.max(1,Math.round(1.5/vox));
    for(let z=0;z<nz;z++) for(let y=oy;y<=yTop;y++) for(let x=0;x<nx;x++) if(mark[at(x,y,z)]){ if(x<x0)x0=x; if(x>x1)x1=x; if(z<z0)z0=z; if(z>z1)z1=z }
    if(x1>=x0){
      const m=Math.round(4/vox), cx=(x0+x1)/2, cz=(z0+z1)/2, rx=(x1-x0)/2+m, rz=(z1-z0)/2+m;
      const y0=oy-Math.max(1,Math.round(baseH/vox));
      for(let z=0;z<nz;z++) for(let x=0;x<nx;x++){
        const q=((x-cx)/rx)**2+((z-cz)/rz)**2; if(q>1) continue;       // だ円の板
        for(let y=y0;y<=oy;y++){ const k=at(x,y,z); if(mark[k]) continue; mark[k]=1; cr[k]=cg[k]=cb[k]=150 }
      }
    }
  }

  // ---- 2. 太らせる（r 升ぶん）。色もいっしょに広げる ----
  await tick("最小の厚みまで太らせています…");
  let cur=mark;
  for(let it=0;it<r;it++){
    const nxt=new Uint8Array(cur);
    for(let z=1;z<nz-1;z++) for(let y=1;y<ny-1;y++) for(let x=1;x<nx-1;x++){
      const k=at(x,y,z); if(cur[k]) continue;
      for(const d of [1,-1,nx,-nx,nx*ny,-nx*ny]){ const q=k+d; if(cur[q]){ nxt[k]=1; cr[k]=cr[q]; cg[k]=cg[q]; cb[k]=cb[q]; break } }
    }
    cur=nxt; await tick("最小の厚みまで太らせています…");
  }

  // ---- 3. 外から塗りつぶす。外に届かなかった所が中身 ----
  await tick("中身を決めています…");
  const out=new Uint8Array(N), st=new Int32Array(N); let sp=0;
  const push=k=>{ if(!out[k]&&!cur[k]){ out[k]=1; st[sp++]=k } };
  for(let z=0;z<nz;z++) for(let y=0;y<ny;y++){ push(at(0,y,z)); push(at(nx-1,y,z)) }
  for(let z=0;z<nz;z++) for(let x=0;x<nx;x++){ push(at(x,0,z)); push(at(x,ny-1,z)) }
  for(let y=0;y<ny;y++) for(let x=0;x<nx;x++){ push(at(x,y,0)); push(at(x,y,nz-1)) }
  while(sp){ const k=st[--sp], x=k%nx, y=((k/nx)|0)%ny, z=(k/(nx*ny))|0;
    if(x>0)push(k-1); if(x<nx-1)push(k+1); if(y>0)push(k-nx); if(y<ny-1)push(k+nx); if(z>0)push(k-nx*ny); if(z<nz-1)push(k+nx*ny) }
  const solid=new Uint8Array(N); for(let k=0;k<N;k++) solid[k]=out[k]?0:1;
  // いちばん外側の升は必ず空にする（端に触れると、そこで面が閉じない）
  for(let z=0;z<nz;z++) for(let y=0;y<ny;y++) for(let x=0;x<nx;x++)
    if(x===0||y===0||z===0||x===nx-1||y===ny-1||z===nz-1) solid[at(x,y,z)]=0;

  // ---- 4. 中を空洞にする（外からの距離が殻の厚みより深い所を抜く） ----
  let hollowed=0;
  if(o.hollow){
    await tick("中を空洞にしています…");
    const dist=new Int32Array(N).fill(-1), q=new Int32Array(N); let h=0,t=0;
    for(let k=0;k<N;k++) if(!solid[k]){ dist[k]=0; q[t++]=k }
    while(h<t){ const k=q[h++], x=k%nx, y=((k/nx)|0)%ny, z=(k/(nx*ny))|0, dk=dist[k]+1;
      for(const [ok,d] of [[x>0,-1],[x<nx-1,1],[y>0,-nx],[y<ny-1,nx],[z>0,-nx*ny],[z<nz-1,nx*ny]]){
        if(!ok) continue; const j=k+d; if(dist[j]<0){ dist[j]=dk; q[t++]=j } } }
    const kk=Math.max(2,Math.round(o.shell/vox));
    for(let k=0;k<N;k++) if(solid[k]&&dist[k]>kk){ solid[k]=0; hollowed++ }
  }

  // 塊の数（6方向でつながるもの）。宙に浮いた部品があると 2 以上になる
  const parts=printComponents(solid,nx,ny,nz);

  // ---- 5. 表面を作り直す ----
  await tick("表面を作り直しています…");
  // 升の値を少しぼかして（3×3×3 の平均）面をなめらかにする。値は k/27 なので 0.5 ちょうどにはならない
  const f=new Float32Array(N);
  { const tmp=new Float32Array(N), tmp2=new Float32Array(N);
    for(let k=0;k<N;k++) tmp[k]=solid[k];
    for(let z=0;z<nz;z++) for(let y=0;y<ny;y++) for(let x=0;x<nx;x++){ const k=at(x,y,z); tmp2[k]=tmp[k]+(x>0?tmp[k-1]:0)+(x<nx-1?tmp[k+1]:0) }
    for(let z=0;z<nz;z++) for(let y=0;y<ny;y++) for(let x=0;x<nx;x++){ const k=at(x,y,z); tmp[k]=tmp2[k]+(y>0?tmp2[k-nx]:0)+(y<ny-1?tmp2[k+nx]:0) }
    for(let z=0;z<nz;z++) for(let y=0;y<ny;y++) for(let x=0;x<nx;x++){ const k=at(x,y,z); f[k]=(tmp[k]+(z>0?tmp[k-nx*ny]:0)+(z<nz-1?tmp[k+nx*ny]:0))/27 }
  }
  const surf=printTetSurface(f,nx,ny,nz,0.5);
  // 点の色：内側の升のうち、色の付いたいちばん近いもの
  const vc=new Uint8Array(surf.verts.length);
  const findCol=(x,y,z)=>{
    for(let R=0;R<=3;R++) for(let dz=-R;dz<=R;dz++) for(let dy=-R;dy<=R;dy++) for(let dx=-R;dx<=R;dx++){
      if(Math.max(Math.abs(dx),Math.abs(dy),Math.abs(dz))!==R) continue;
      const X=x+dx,Y=y+dy,Z=z+dz; if(X<0||Y<0||Z<0||X>=nx||Y>=ny||Z>=nz) continue;
      const k=at(X,Y,Z); if(cur[k]) return [cr[k],cg[k],cb[k]] }
    return [150,150,150] };
  for(let i=0;i<surf.verts.length;i+=3){
    const c=findCol(Math.round(surf.verts[i]),Math.round(surf.verts[i+1]),Math.round(surf.verts[i+2]));
    vc[i]=c[0]; vc[i+1]=c[1]; vc[i+2]=c[2];
  }
  // 升の座標 → mm（台座の下を 0 に）
  const verts=new Float32Array(surf.verts.length);
  const y0mm=(oy-(o.base?Math.max(1,Math.round(baseH/vox)):0))*vox;
  for(let i=0;i<verts.length;i+=3){ verts[i]=(surf.verts[i]-ox)*vox; verts[i+1]=surf.verts[i+1]*vox-y0mm; verts[i+2]=(surf.verts[i+2]-oz)*vox }
  await tick("確かめています…");
  const chk=printCheck(verts,surf.tris);
  // 元の座標 → mm の写し方（テクスチャで塗るときに、元の面を同じ所へ置くため）
  const xf={s,mn:mn.slice(),yoff:oy*vox-y0mm};
  return {verts,tris:surf.tris,colors:vc,vox,thick:2*r*vox,parts,hollowed,size:[size[0],size[1]+baseH,size[2]],check:chk,opt:o,xf};
}

// 6方向でつながった塊の数
function printComponents(solid,nx,ny,nz){
  const N=solid.length, seen=new Uint8Array(N), st=new Int32Array(N); let n=0;
  for(let k0=0;k0<N;k0++){ if(!solid[k0]||seen[k0]) continue; n++; let sp=0; st[sp++]=k0; seen[k0]=1;
    while(sp){ const k=st[--sp], x=k%nx, y=((k/nx)|0)%ny, z=(k/(nx*ny))|0;
      for(const [ok,d] of [[x>0,-1],[x<nx-1,1],[y>0,-nx],[y<ny-1,nx],[z>0,-nx*ny],[z<nz-1,nx*ny]]){
        if(!ok) continue; const j=k+d; if(solid[j]&&!seen[j]){ seen[j]=1; st[sp++]=j } } } }
  return n;
}

// 四面体で切る方式の表面（立方体を主対角線のまわりの6つの四面体に分ける）。
// 隣の立方体と面の分け方がそろうので、できた面は必ずつながって閉じる
function printTetSurface(f,nx,ny,nz,iso){
  const C=[[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]];
  const TET=[[0,5,1,6],[0,1,2,6],[0,2,3,6],[0,3,7,6],[0,7,4,6],[0,4,5,6]];
  const verts=[], tris=[], emap=new Map();
  const gi=(x,y,z)=>x+nx*(y+ny*z);
  const vert=(a,b,pa,pb,fa,fb)=>{
    const key=a<b?a*67108864+b:b*67108864+a;
    let v=emap.get(key); if(v!=null) return v;
    const t=(iso-fa)/(fb-fa);
    v=verts.length/3; verts.push(pa[0]+(pb[0]-pa[0])*t,pa[1]+(pb[1]-pa[1])*t,pa[2]+(pb[2]-pa[2])*t);
    emap.set(key,v); return v };
  const P=new Array(8), G=new Array(8), F=new Array(8);
  for(let z=0;z<nz-1;z++) for(let y=0;y<ny-1;y++) for(let x=0;x<nx-1;x++){
    let any=0, all=1;
    for(let c=0;c<8;c++){ const q=C[c], g=gi(x+q[0],y+q[1],z+q[2]); G[c]=g; F[c]=f[g]; if(F[c]>iso) any=1; else all=0 }
    if(!any||all) continue;
    for(let c=0;c<8;c++){ const q=C[c]; P[c]=[x+q[0],y+q[1],z+q[2]] }
    for(const T of TET){
      const ins=T.filter(c=>F[c]>iso), outs=T.filter(c=>F[c]<=iso);
      if(!ins.length||!outs.length) continue;
      const tri=(a,b,c)=>{
        // 外向きにそろえる：法線が内側の点から外側の点へ向くように
        const pa=verts.slice(a*3,a*3+3), pb=verts.slice(b*3,b*3+3), pc=verts.slice(c*3,c*3+3);
        const u=[pb[0]-pa[0],pb[1]-pa[1],pb[2]-pa[2]], w=[pc[0]-pa[0],pc[1]-pa[1],pc[2]-pa[2]];
        const n=[u[1]*w[2]-u[2]*w[1],u[2]*w[0]-u[0]*w[2],u[0]*w[1]-u[1]*w[0]];
        const mi=[0,1,2].map(k=>ins.reduce((s,c)=>s+P[c][k],0)/ins.length), mo=[0,1,2].map(k=>outs.reduce((s,c)=>s+P[c][k],0)/outs.length);
        if(n[0]*(mo[0]-mi[0])+n[1]*(mo[1]-mi[1])+n[2]*(mo[2]-mi[2])<0) tris.push(a,c,b); else tris.push(a,b,c) };
      const e=(i,o)=>vert(G[i],G[o],P[i],P[o],F[i],F[o]);
      if(ins.length===1){ const i=ins[0]; tri(e(i,outs[0]),e(i,outs[1]),e(i,outs[2])) }
      else if(ins.length===3){ const o=outs[0]; tri(e(ins[0],o),e(ins[1],o),e(ins[2],o)) }
      else { const [i0,i1]=ins, [o0,o1]=outs;
        const a=e(i0,o0), b=e(i0,o1), c=e(i1,o1), d=e(i1,o0);
        tri(a,b,c); tri(a,c,d) }
    }
  }
  return {verts:new Float32Array(verts),tris:new Uint32Array(tris)};
}

// 閉じているかを数える。辺ごとに「向きつきで1回ずつ、逆向きで1回ずつ」なら閉じていて向きもそろう
function printCheck(verts,tris){
  const E=new Map(); let bad=0, deg=0;
  const nv=verts.length/3;
  for(let t=0;t<tris.length;t+=3){
    const a=tris[t],b=tris[t+1],c=tris[t+2];
    if(a===b||b===c||a===c){ deg++; continue }
    for(const [p,q] of [[a,b],[b,c],[c,a]]){ const k=p*nv+q; E.set(k,(E.get(k)||0)+1) }
  }
  let open=0, over=0;
  for(const [k,n] of E){ if(n>1) over++; const p=Math.floor(k/nv), q=k%nv; if(!E.has(q*nv+p)) open++ }
  bad=open+over;
  // 体積（mm³）。外向きなら正
  let vol=0;
  for(let t=0;t<tris.length;t+=3){
    const a=tris[t]*3,b=tris[t+1]*3,c=tris[t+2]*3;
    vol+=(verts[a]*(verts[b+1]*verts[c+2]-verts[b+2]*verts[c+1])-verts[a+1]*(verts[b]*verts[c+2]-verts[b+2]*verts[c])+verts[a+2]*(verts[b]*verts[c+1]-verts[b+1]*verts[c]))/6;
  }
  return {closed:bad===0&&deg===0,open,over,degenerate:deg,volume:vol,tris:tris.length/3,verts:nv};
}

// ---- 書き出し ----
function printSTL(r){
  const n=r.tris.length/3, buf=new ArrayBuffer(84+n*50), dv=new DataView(buf);
  const head="tobal1-model-viewer print (mm)"; for(let i=0;i<head.length;i++) dv.setUint8(i,head.charCodeAt(i));
  dv.setUint32(80,n,true);
  const V=r.verts;
  for(let t=0;t<n;t++){
    const o=84+t*50, a=r.tris[t*3]*3, b=r.tris[t*3+1]*3, c=r.tris[t*3+2]*3;
    const u=[V[b]-V[a],V[b+1]-V[a+1],V[b+2]-V[a+2]], w=[V[c]-V[a],V[c+1]-V[a+1],V[c+2]-V[a+2]];
    let nn=[u[1]*w[2]-u[2]*w[1],u[2]*w[0]-u[0]*w[2],u[0]*w[1]-u[1]*w[0]]; const L=Math.hypot(...nn)||1; nn=nn.map(q=>q/L);
    // STL は Z が上の決まりが多いので、Y 上 → Z 上に回して書く（x, -z, y）
    const put=(off,x,y,z)=>{ dv.setFloat32(off,x,true); dv.setFloat32(off+4,-z,true); dv.setFloat32(off+8,y,true) };
    put(o,nn[0],nn[1],nn[2]); put(o+12,V[a],V[a+1],V[a+2]); put(o+24,V[b],V[b+1],V[b+2]); put(o+36,V[c],V[c+1],V[c+2]);
  }
  return new Uint8Array(buf);
}
// 3MF（色つき）。色は点ごと（5bit ずつに丸めて数を抑える）。Z が上
function print3MFModel(r){
  const cols=new Map(), ci=new Int32Array(r.verts.length/3), list=[];
  const hx=v=>v.toString(16).padStart(2,"0");
  for(let i=0;i<ci.length;i++){
    const q=k=>Math.min(255,(r.colors[i*3+k]>>3)*8+4);
    const key=("#"+hx(q(0))+hx(q(1))+hx(q(2))).toUpperCase();
    let j=cols.get(key); if(j==null){ j=list.length; cols.set(key,j); list.push(key) } ci[i]=j;
  }
  const V=r.verts, out=[];
  out.push('<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="ja-JP" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02">\n<resources>\n<m:colorgroup id="2">\n');
  for(const c of list) out.push(`<m:color color="${c}"/>\n`);
  out.push('</m:colorgroup>\n<object id="1" type="model" pid="2" pindex="0"><mesh><vertices>\n');
  const f=v=>(Math.round(v*1000)/1000).toString();
  for(let i=0;i<V.length;i+=3) out.push(`<vertex x="${f(V[i])}" y="${f(-V[i+2])}" z="${f(V[i+1])}"/>\n`);
  out.push('</vertices><triangles>\n');
  for(let t=0;t<r.tris.length;t+=3){ const a=r.tris[t],b=r.tris[t+1],c=r.tris[t+2];
    out.push(`<triangle v1="${a}" v2="${b}" v3="${c}" pid="2" p1="${ci[a]}" p2="${ci[b]}" p3="${ci[c]}"/>\n`) }
  out.push('</triangles></mesh></object>\n</resources>\n<build><item objectid="1"/></build>\n</model>\n');
  return out.join("");
}
// 小さな ZIP 書き（3MF の入れ物）。deflate が使えれば縮める
const PRINT_CRC=(()=>{ const t=new Uint32Array(256); for(let n=0;n<256;n++){ let c=n; for(let k=0;k<8;k++) c=c&1?0xEDB88320^(c>>>1):c>>>1; t[n]=c>>>0 } return t })();
function printCrc(d){ let c=0xFFFFFFFF; for(let i=0;i<d.length;i++) c=PRINT_CRC[(c^d[i])&255]^(c>>>8); return (c^0xFFFFFFFF)>>>0 }
async function printZip(files){
  const enc=new TextEncoder(), parts=[], cen=[]; let off=0;
  for(const [name,data0] of files){
    const data=typeof data0==="string"?enc.encode(data0):data0, nm=enc.encode(name), crc=printCrc(data);
    let body=data, method=0;
    if(typeof CompressionStream!=="undefined"&&data.length>1024){
      try{ const cs=new Blob([data]).stream().pipeThrough(new CompressionStream("deflate-raw"));
        body=new Uint8Array(await new Response(cs).arrayBuffer()); method=8 }catch(_){ body=data; method=0 } }
    const h=new DataView(new ArrayBuffer(30));
    h.setUint32(0,0x04034b50,true); h.setUint16(4,20,true); h.setUint16(8,method,true);
    h.setUint32(14,crc,true); h.setUint32(18,body.length,true); h.setUint32(22,data.length,true); h.setUint16(26,nm.length,true);
    parts.push(new Uint8Array(h.buffer),nm,body);
    const c=new DataView(new ArrayBuffer(46));
    c.setUint32(0,0x02014b50,true); c.setUint16(4,20,true); c.setUint16(6,20,true); c.setUint16(10,method,true);
    c.setUint32(16,crc,true); c.setUint32(20,body.length,true); c.setUint32(24,data.length,true); c.setUint16(28,nm.length,true); c.setUint32(42,off,true);
    cen.push(new Uint8Array(c.buffer),nm);
    off+=30+nm.length+body.length;
  }
  const csz=cen.reduce((s,a)=>s+a.length,0), e=new DataView(new ArrayBuffer(22));
  e.setUint32(0,0x06054b50,true); e.setUint16(8,files.length,true); e.setUint16(10,files.length,true); e.setUint32(12,csz,true); e.setUint32(16,off,true);
  return new Blob([...parts,...cen,new Uint8Array(e.buffer)]);
}
async function print3MF(r){
  return printZip([
    ["[Content_Types].xml",'<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>'],
    ["_rels/.rels",'<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>'],
    ["3D/3dmodel.model",print3MFModel(r)]]);
}


// ============================================================
//  元の面の色を1点ずつ取る（テクスチャ込み）。透けている所は null
// ============================================================
function printFaceColor(m,t,w,u,v){
  const C=m.col, T0=m.t0, T1=m.t1;
  const col=[C[t*9]*w+C[t*9+3]*u+C[t*9+6]*v,C[t*9+1]*w+C[t*9+4]*u+C[t*9+7]*v,C[t*9+2]*w+C[t*9+5]*u+C[t*9+8]*v];
  if(T0&&T0[t*9+2]>0.5&&m.vram){
    const tu=T0[t*9]*w+T0[t*9+3]*u+T0[t*9+6]*v, tv=T0[t*9+1]*w+T0[t*9+4]*u+T0[t*9+7]*v;
    const tx=printTexel(m.vram,tu,tv,T0[t*9+2],[T1[t*12],T1[t*12+1],T1[t*12+2],T1[t*12+3]]);
    if(tx===-1) return null;
    if(tx) return tx.map((q,k)=>Math.min(1,q*col[k]*255/128));
  }
  return col;
}
// 点 p にいちばん近い三角形上の点（重心座標で返す）
function printClosest(p,a,b,c){
  const ab=[b[0]-a[0],b[1]-a[1],b[2]-a[2]], ac=[c[0]-a[0],c[1]-a[1],c[2]-a[2]], ap=[p[0]-a[0],p[1]-a[1],p[2]-a[2]];
  const dot=(x,y)=>x[0]*y[0]+x[1]*y[1]+x[2]*y[2];
  const d1=dot(ab,ap), d2=dot(ac,ap); if(d1<=0&&d2<=0) return [1,0,0];
  const bp=[p[0]-b[0],p[1]-b[1],p[2]-b[2]], d3=dot(ab,bp), d4=dot(ac,bp); if(d3>=0&&d4<=d3) return [0,1,0];
  const vc=d1*d4-d3*d2; if(vc<=0&&d1>=0&&d3<=0){ const v=d1/(d1-d3); return [1-v,v,0] }
  const cp=[p[0]-c[0],p[1]-c[1],p[2]-c[2]], d5=dot(ab,cp), d6=dot(ac,cp); if(d6>=0&&d5<=d6) return [0,0,1];
  const vb=d5*d2-d1*d6; if(vb<=0&&d2>=0&&d6<=0){ const w=d2/(d2-d6); return [1-w,0,w] }
  const va=d3*d6-d5*d4; if(va<=0&&(d4-d3)>=0&&(d5-d6)>=0){ const w=(d4-d3)/((d4-d3)+(d5-d6)); return [0,1-w,w] }
  const den=1/(va+vb+vc), v=vb*den, w=vc*den; return [1-v-w,v,w];
}

// ============================================================
//  閉じた形をテクスチャで塗る。面1枚ごとに升（3×3 画素）を使い、
//  升の各画素に、いちばん近い元の面の色を写す（透けている貼りものは飛ばして下の面へ）
// ============================================================
async function printBake(r,meshes,progress,cellPx){
  const tick=async m=>{ if(progress) await progress(m) };
  const T=cellPx||3, xf=r.xf, nt=r.tris.length/3;
  // 元の面を mm に置き、2mm の升に振り分ける（近くを探すため）
  const src=[]; const G=2, grid=new Map();
  const toMM=(P,i)=>[(P[i]-xf.mn[0])*xf.s,(P[i+1]-xf.mn[1])*xf.s+xf.yoff,(P[i+2]-xf.mn[2])*xf.s];
  for(const m of meshes){ const P=m.pos; for(let t=0;t<P.length/9;t++){
    const a=toMM(P,t*9), b=toMM(P,t*9+3), c=toMM(P,t*9+6), id=src.length; src.push({m,t,a,b,c});
    const lo=[0,1,2].map(k=>Math.floor(Math.min(a[k],b[k],c[k])/G)), hi=[0,1,2].map(k=>Math.floor(Math.max(a[k],b[k],c[k])/G));
    for(let z=lo[2];z<=hi[2];z++) for(let y=lo[1];y<=hi[1];y++) for(let x=lo[0];x<=hi[0];x++){
      const key=x+","+y+","+z; let L=grid.get(key); if(!L){ L=[]; grid.set(key,L) } L.push(id) } } }
  const colorAt=p=>{
    let best=null, bd=1e9;
    const cx=Math.floor(p[0]/G), cy=Math.floor(p[1]/G), cz=Math.floor(p[2]/G);
    for(let R=1;R<=2&&!best;R++){ const seen=new Set();
      for(let z=cz-R;z<=cz+R;z++) for(let y=cy-R;y<=cy+R;y++) for(let x=cx-R;x<=cx+R;x++){
        const L=grid.get(x+","+y+","+z); if(!L) continue;
        for(const id of L){ if(seen.has(id)) continue; seen.add(id); const S=src[id];
          const q=printClosest(p,S.a,S.b,S.c);
          const pt=[0,1,2].map(k=>S.a[k]*q[0]+S.b[k]*q[1]+S.c[k]*q[2]), d=(pt[0]-p[0])**2+(pt[1]-p[1])**2+(pt[2]-p[2])**2;
          if(d>=bd) continue;
          const col=printFaceColor(S.m,S.t,q[0],q[1],q[2]); if(!col) continue;   // 透けている所は飛ばす
          bd=d; best=col } } }
    return best||[150/255,150/255,150/255] };           // 近くに元の面が無い（台座など）
  // 面1枚ごとに T×T 画素の升。角は画素の中心の内側に置くので、隣の升の画素を拾わない。
  // 三角形の外の画素（升の右上）は、三角形の縁の色で埋める（にじみ止め）
  const cells=nt, per=Math.floor(2048/T), W=per*T, H=Math.ceil(cells/per)*T;
  const img=new Uint8Array(W*H*4), uv=new Float32Array(nt*6), V=r.verts;
  const cs=[[0.5,0.5],[T-0.5,0.5],[0.5,T-0.5]];
  for(let t=0;t<nt;t++){
    const bx=(t%per)*T, by=Math.floor(t/per)*T;
    for(let k=0;k<3;k++){ uv[t*6+k*2]=(bx+cs[k][0])/W; uv[t*6+k*2+1]=1-(by+cs[k][1])/H }   // 3MF は左下が (0,0)
    const ia=r.tris[t*3]*3, ib=r.tris[t*3+1]*3, ic=r.tris[t*3+2]*3, span=T-1;
    for(let py=0;py<T;py++) for(let px=0;px<T;px++){
      let l1=px/span, l2=py/span, l0=1-l1-l2;
      if(l0<0){ const sm=l1+l2; l1/=sm; l2/=sm; l0=0 }        // 升の右上は縁へ寄せる
      const p=[0,1,2].map(k=>V[ia+k]*l0+V[ib+k]*l1+V[ic+k]*l2);
      const col=colorAt(p), o=((by+py)*W+bx+px)*4;
      img[o]=col[0]*255; img[o+1]=col[1]*255; img[o+2]=col[2]*255; img[o+3]=255;
    }
    if(t%8000===0) await tick(`テクスチャを塗っています… ${Math.round(t/nt*100)}%`);
  }
  return {W,H,img,uv};
}
// 3MF（テクスチャつき）。png はブラウザで作った画像のバイト列
function print3MFTexModel(r,bake){
  const V=r.verts, out=[];
  out.push('<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="ja-JP" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02">\n<resources>\n');
  out.push('<m:texture2d id="3" path="/3D/Textures/color.png" contenttype="image/png" tilestyleu="clamp" tilestylev="clamp" filter="nearest"/>\n<m:texture2dgroup id="4" texid="3">\n');
  const f=v=>(Math.round(v*1e5)/1e5).toString();
  for(let i=0;i<bake.uv.length;i+=2) out.push(`<m:tex2coord u="${f(bake.uv[i])}" v="${f(bake.uv[i+1])}"/>\n`);
  out.push('</m:texture2dgroup>\n<object id="1" type="model" pid="4" pindex="0"><mesh><vertices>\n');
  const g=v=>(Math.round(v*1000)/1000).toString();
  for(let i=0;i<V.length;i+=3) out.push(`<vertex x="${g(V[i])}" y="${g(-V[i+2])}" z="${g(V[i+1])}"/>\n`);
  out.push('</vertices><triangles>\n');
  for(let t=0;t<r.tris.length/3;t++) out.push(`<triangle v1="${r.tris[t*3]}" v2="${r.tris[t*3+1]}" v3="${r.tris[t*3+2]}" pid="4" p1="${t*3}" p2="${t*3+1}" p3="${t*3+2}"/>\n`);
  out.push('</triangles></mesh></object>\n</resources>\n<build><item objectid="1"/></build>\n</model>\n');
  return out.join("");
}
async function print3MFTex(r,bake,png){
  return printZip([
    ["[Content_Types].xml",'<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/><Default Extension="png" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodeltexture"/></Types>'],
    ["_rels/.rels",'<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>'],
    ["3D/_rels/3dmodel.model.rels",'<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/Textures/color.png" Id="rel1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dtexture"/></Relationships>'],
    ["3D/3dmodel.model",print3MFTexModel(r,bake)],
    ["3D/Textures/color.png",png]]);
}

// ============================================================
//  元の形のまま書き出す（glTF の .glb）。Blender で手直しする出発点。
//  使っているテクスチャ（ページ＋パレットの組）を VRAM から切り出して1枚の絵にまとめる
// ============================================================
function printAtlas(meshes){
  const groups=new Map();
  for(const m of meshes){ const T0=m.t0, T1=m.t1; if(!T0||!m.vram) continue;
    for(let t=0;t<T0.length/9;t++){ if(!(T0[t*9+2]>0.5)) continue;
      const key=[T0[t*9+2],T1[t*12],T1[t*12+1],T1[t*12+2],T1[t*12+3]].join(",");
      let g=groups.get(key); if(!g){ g={mode:T0[t*9+2],t1:[T1[t*12],T1[t*12+1],T1[t*12+2],T1[t*12+3]],u0:1e9,v0:1e9,u1:-1e9,v1:-1e9,vram:m.vram}; groups.set(key,g) }
      for(let k=0;k<3;k++){ const u=T0[t*9+k*3], v=T0[t*9+k*3+1]; g.u0=Math.min(g.u0,Math.floor(u)); g.v0=Math.min(g.v0,Math.floor(v)); g.u1=Math.max(g.u1,Math.ceil(u)); g.v1=Math.max(g.v1,Math.ceil(v)) } } }
  // 棚詰め（1画素の余白つき）。先頭に白い 4×4（テクスチャの無い面用）
  const list=[...groups.values()].sort((a,b)=>(b.v1-b.v0)-(a.v1-a.v0));
  const W=1024; let x=6, y=0, rowH=6; const place=[];
  for(const g of list){ const w=g.u1-g.u0+3, h=g.v1-g.v0+3;
    if(x+w>W){ x=0; y+=rowH; rowH=0 } g.bx=x; g.by=y; x+=w; rowH=Math.max(rowH,h); place.push(g) }
  const H=Math.max(8,y+rowH), img=new Uint8Array(W*H*4);
  for(let yy=0;yy<4;yy++) for(let xx=0;xx<4;xx++){ const o=((yy+1)*W+xx+1)*4; img[o]=img[o+1]=img[o+2]=img[o+3]=255 }
  for(const g of place) for(let yy=-1;yy<=g.v1-g.v0;yy++) for(let xx=-1;xx<=g.u1-g.u0;xx++){
    const u=Math.min(Math.max(g.u0+xx,g.u0),g.u1), v=Math.min(Math.max(g.v0+yy,g.v0),g.v1);   // 余白は端の画素を伸ばす
    const c=printTexel(g.vram,u+0.5,v+0.5,g.mode,g.t1), o=((g.by+1+yy)*W+g.bx+1+xx)*4;
    if(c&&c!==-1){ img[o]=c[0]*255; img[o+1]=c[1]*255; img[o+2]=c[2]*255; img[o+3]=255 }
  }
  return {W,H,img,groups};
}
// meshes → glb のバイト列。高さ height mm（glTF はメートル）。Y が上
function printGLB(meshes,height,atlas,png){
  let mn=[1e9,1e9,1e9], mx=[-1e9,-1e9,-1e9];
  for(const m of meshes){ const P=m.pos; for(let i=0;i<P.length;i+=3) for(let a=0;a<3;a++){ if(P[i+a]<mn[a])mn[a]=P[i+a]; if(P[i+a]>mx[a])mx[a]=P[i+a] } }
  const k=(height/1000)/(mx[1]-mn[1]), cx=(mn[0]+mx[0])/2, cz=(mn[2]+mx[2])/2;
  const bufs=[], views=[], accs=[], meshesJ=[], nodes=[]; let off=0;
  const add=(arr,type,count,extra)=>{ const b=new Uint8Array(arr.buffer,arr.byteOffset,arr.byteLength);
    const pad=(4-(off%4))%4; if(pad){ bufs.push(new Uint8Array(pad)); off+=pad }
    views.push({buffer:0,byteOffset:off,byteLength:b.length}); bufs.push(b); off+=b.length;
    accs.push(Object.assign({bufferView:views.length-1,componentType:5126,count,type},extra||{})); return accs.length-1 };
  meshes.forEach((m,mi)=>{
    const n=m.pos.length/3, pos=new Float32Array(n*3), col=new Float32Array(n*3), uv=new Float32Array(n*2);
    const pmn=[1e9,1e9,1e9], pmx=[-1e9,-1e9,-1e9];
    for(let i=0;i<n;i++){
      const p=[(m.pos[i*3]-cx)*k,(m.pos[i*3+1]-mn[1])*k,(m.pos[i*3+2]-cz)*k];
      for(let a=0;a<3;a++){ pos[i*3+a]=p[a]; pmn[a]=Math.min(pmn[a],p[a]); pmx[a]=Math.max(pmx[a],p[a]) }
      const t=Math.floor(i/3), tex=m.t0&&m.t0[t*9+2]>0.5&&m.vram;
      let g=null; if(tex) g=atlas.groups.get([m.t0[t*9+2],m.t1[t*12],m.t1[t*12+1],m.t1[t*12+2],m.t1[t*12+3]].join(","));
      const mul=g?255/128:1;
      for(let a=0;a<3;a++) col[i*3+a]=Math.min(1,m.col[i*3+a]*mul);
      if(g){ uv[i*2]=(g.bx+1+(m.t0[i*3]-g.u0))/atlas.W; uv[i*2+1]=(g.by+1+(m.t0[i*3+1]-g.v0))/atlas.H }
      else { uv[i*2]=3/atlas.W; uv[i*2+1]=3/atlas.H }
    }
    const pa=add(pos,"VEC3",n,{min:pmn,max:pmx}), ca=add(col,"VEC3",n), ua=add(uv,"VEC2",n);
    meshesJ.push({name:"character"+(mi+1),primitives:[{attributes:{POSITION:pa,COLOR_0:ca,TEXCOORD_0:ua},material:0}]});
    nodes.push({mesh:mi,name:"character"+(mi+1)});
  });
  const pad=(4-(off%4))%4; if(pad){ bufs.push(new Uint8Array(pad)); off+=pad }
  views.push({buffer:0,byteOffset:off,byteLength:png.length}); bufs.push(png); off+=png.length;
  const json={asset:{version:"2.0",generator:"tobal1-model-viewer"},scene:0,scenes:[{nodes:nodes.map((_,i)=>i)}],nodes,meshes:meshesJ,
    materials:[{name:"ps1",pbrMetallicRoughness:{baseColorTexture:{index:0},metallicFactor:0,roughnessFactor:1},alphaMode:"MASK",alphaCutoff:0.5,doubleSided:true}],
    textures:[{sampler:0,source:0}],samplers:[{magFilter:9728,minFilter:9728,wrapS:33071,wrapT:33071}],
    images:[{bufferView:views.length-1,mimeType:"image/png"}],accessors:accs,bufferViews:views,buffers:[{byteLength:0}]};
  const binPad=(4-(off%4))%4; if(binPad){ bufs.push(new Uint8Array(binPad)); off+=binPad }
  json.buffers[0].byteLength=off;
  let js=new TextEncoder().encode(JSON.stringify(json)); const jp=(4-(js.length%4))%4;
  if(jp){ const t=new Uint8Array(js.length+jp); t.set(js); t.fill(0x20,js.length); js=t }
  const total=12+8+js.length+8+off, outB=new Uint8Array(total), dv=new DataView(outB.buffer);
  dv.setUint32(0,0x46546C67,true); dv.setUint32(4,2,true); dv.setUint32(8,total,true);
  dv.setUint32(12,js.length,true); dv.setUint32(16,0x4E4F534A,true); outB.set(js,20);
  let o=20+js.length; dv.setUint32(o,off,true); dv.setUint32(o+4,0x004E4942,true); o+=8;
  for(const b of bufs){ outB.set(b,o); o+=b.length }
  return outB;
}
