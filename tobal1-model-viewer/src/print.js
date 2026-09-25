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
  return {verts,tris:surf.tris,colors:vc,vox,thick:2*r*vox,parts,hollowed,size:[size[0],size[1]+baseH,size[2]],check:chk,opt:o};
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
