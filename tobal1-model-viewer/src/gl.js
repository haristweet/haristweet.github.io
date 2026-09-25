const canvas=document.getElementById("gl");
const gl=canvas.getContext("webgl",{antialias:true,preserveDrawingBuffer:true});
const VS=`attribute vec3 p;attribute vec3 n;attribute vec3 c;attribute vec3 t0;attribute vec4 t1;uniform mat4 mvp;uniform mat4 model;
varying vec3 vc;varying vec3 vn;varying vec3 vt0;varying vec4 vt1;
void main(){gl_Position=mvp*vec4(p,1.);vc=c;vn=mat3(model)*n;vt0=t0;vt1=t1;}`;
// VRAM は 16bit の語を R=下位 G=上位 に入れてあり、パレット引きもシェーダで行う
const FS=`precision highp float;varying vec3 vc;varying vec3 vn;varying vec3 vt0;varying vec4 vt1;uniform sampler2D vram;
float word(vec2 q){vec4 t=texture2D(vram,(q+.5)/vec2(1024.,512.));return floor(t.r*255.+.5)+floor(t.g*255.+.5)*256.;}
void main(){
  vec3 N=normalize(vn);vec3 L1=normalize(vec3(.4,.8,.6));vec3 L2=normalize(vec3(-.6,.2,-.5));
  float d=abs(dot(N,L1))*.75+abs(dot(N,L2))*.25;
  float mode=floor(vt0.z+.5);vec3 base;
  if(mode<1.){base=vc;}
  else{
    float u=floor(vt0.x),v=floor(vt0.y);vec4 t=floor(vt1+.5);float w;
    if(mode<5.){float m=mod(u,4.);w=word(vec2(t.x+floor(u/4.),t.y+v));w=mod(floor(w/(m<.5?1.:m<1.5?16.:m<2.5?256.:4096.)),16.);w=word(vec2(t.z+w,t.w));}
    else if(mode<9.){float m=mod(u,2.);w=word(vec2(t.x+floor(u/2.),t.y+v));w=mod(floor(w/(m<.5?1.:256.)),256.);w=word(vec2(t.z+w,t.w));}
    else{w=word(vec2(t.x+u,t.y+v));}
    if(w<.5)discard;
    vec3 tex=vec3(mod(w,32.),mod(floor(w/32.),32.),mod(floor(w/1024.),32.))/31.;
    base=tex*vc*(255./128.);   // テクスチャ × 頂点色/128（PS1 と同じ）。頂点色だけの面と明るさの基準を揃える
  }
  gl_FragColor=vec4(min(base*(.55+.6*d),vec3(1.)),1.);
}`;
function sh(t,s){const o=gl.createShader(t);gl.shaderSource(o,s);gl.compileShader(o);if(!gl.getShaderParameter(o,gl.COMPILE_STATUS))throw gl.getShaderInfoLog(o);return o}
const prog=gl.createProgram(); gl.attachShader(prog,sh(gl.VERTEX_SHADER,VS)); gl.attachShader(prog,sh(gl.FRAGMENT_SHADER,FS)); gl.linkProgram(prog); gl.useProgram(prog);
// 描く物の層: 0 = 選んだキャラ、1 = 投げの相手。テクスチャ（VRAM）は層ごとに持つ
function makeLayer(){
  const tex=gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D,tex);
  for(const [k,v] of [[gl.TEXTURE_MIN_FILTER,gl.NEAREST],[gl.TEXTURE_MAG_FILTER,gl.NEAREST],[gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE],[gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D,k,v);
  return {bufs:{p:gl.createBuffer(),n:gl.createBuffer(),c:gl.createBuffer(),t0:gl.createBuffer(),t1:gl.createBuffer()},tex,count:0,vram:null};
}
const layers=[makeLayer(),makeLayer()];   // 層1 は、同じ写しのもう1人を並べるときに使う
let triCount=0, center=[0,0,0], radius=1000;
const view={yaw:0,pitch:0.08,dist:1,pan:[0,0,0]};
const cam={s:[1,0,0],u:[0,1,0],half:1};   // 描画時のカメラの右・上方向と、注視点の面での画面の半分の高さ
const shading={gouraud:false};
try{ shading.gouraud=localStorage.getItem("t1gouraud")==="1" }catch(_){}
function fitView(P){
  if(!P.length){ center=[0,0,0]; radius=1; view.pan=[0,0,0]; return }
  // 最小・最大で決めると1点の外れ値でモデルが点になり、軸ごとの 2〜98% で決めると
  // 頂点が1か所に固まっているとき帯がゼロ幅になって半径が 1 になり、遠くが切れて消える。
  // 中心は各軸の中央値、半径は「中心からの距離の 98% 点」で決める
  const mid=a=>{ const xs=[]; for(let i=a;i<P.length;i+=3) xs.push(P[i]); xs.sort((x,y)=>x-y); return xs[xs.length>>1] };
  center=[mid(0),mid(1),mid(2)];
  const ds=[];
  for(let i=0;i<P.length;i+=3) ds.push(Math.hypot(P[i]-center[0],P[i+1]-center[1],P[i+2]-center[2]));
  ds.sort((a,b)=>a-b);
  // 読み方が固まったので、ほぼ全部が入るように取る（飛んだ点だけ落とす）
  radius=ds[Math.min(ds.length-1,Math.floor(ds.length*0.999))]||1;
  view.pan=[0,0,0];
}
function upload(mesh,fit=true,li=0){
  const L=layers[li];
  const P=mesh.pos, N=new Float32Array(P.length);
  let mn=[1e9,1e9,1e9], mx=[-1e9,-1e9,-1e9];
  for(let i=0;i<P.length;i+=9){
    const ax=P[i+3]-P[i],ay=P[i+4]-P[i+1],az=P[i+5]-P[i+2],bx=P[i+6]-P[i],by=P[i+7]-P[i+1],bz=P[i+8]-P[i+2];
    let nx=ay*bz-az*by,ny=az*bx-ax*bz,nz=ax*by-ay*bx; const l=Math.hypot(nx,ny,nz);
    if(l<1e-6){ nx=0;ny=1;nz=0 } else { nx/=l;ny/=l;nz/=l }   // つぶれた面は法線が出ないので上向きに
    // ファイルに法線が入っているならそちらを使う（向きの取り違えがなくなる）
    if(mesh.nrm){ const t=i/9*3, ml=Math.hypot(mesh.nrm[t],mesh.nrm[t+1],mesh.nrm[t+2]);
                  if(ml>1e-6){ nx=mesh.nrm[t]/ml; ny=mesh.nrm[t+1]/ml; nz=mesh.nrm[t+2]/ml } }
    for(let k=0;k<3;k++){N[i+k*3]=nx;N[i+k*3+1]=ny;N[i+k*3+2]=nz; for(let a=0;a<3;a++){mn[a]=Math.min(mn[a],P[i+k*3+a]);mx[a]=Math.max(mx[a],P[i+k*3+a])}}
  }
  if(shading.gouraud&&mesh.sm){
    const acc=new Map(), key=i=>Math.round(P[i])+","+Math.round(P[i+1])+","+Math.round(P[i+2]);
    for(let t=0,i=0;i<P.length;t++,i+=9){ if(!mesh.sm[t]) continue;
      for(let k=0;k<3;k++){ const kk=key(i+k*3); let a=acc.get(kk); if(!a){a=[0,0,0];acc.set(kk,a)}
        const s=(a[0]*N[i]+a[1]*N[i+1]+a[2]*N[i+2])<0?-1:1; a[0]+=s*N[i]; a[1]+=s*N[i+1]; a[2]+=s*N[i+2] } }
    for(let t=0,i=0;i<P.length;t++,i+=9){ if(!mesh.sm[t]) continue;
      for(let k=0;k<3;k++){ const a=acc.get(key(i+k*3)), l=Math.hypot(a[0],a[1],a[2])||1; N[i+k*3]=a[0]/l; N[i+k*3+1]=a[1]/l; N[i+k*3+2]=a[2]/l } }
  }
  if(fit) fitView(P);
  if(mesh.vram&&L.vram!==mesh.vram){ gl.bindTexture(gl.TEXTURE_2D,L.tex); gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1024,512,0,gl.RGBA,gl.UNSIGNED_BYTE,mesh.vram); L.vram=mesh.vram }
  for(const [k,data] of [["p",P],["n",N],["c",mesh.col],["t0",mesh.t0],["t1",mesh.t1]]){gl.bindBuffer(gl.ARRAY_BUFFER,L.bufs[k]);gl.bufferData(gl.ARRAY_BUFFER,data,gl.DYNAMIC_DRAW)}
  L.count=P.length/3; L.mn=mn; L.mx=mx; L.mesh=mesh; if(li===0) triCount=L.count;
}
function persp(f,a,n,fa){const t=1/Math.tan(f/2);return[t/a,0,0,0, 0,t,0,0, 0,0,(fa+n)/(n-fa),-1, 0,0,2*fa*n/(n-fa),0]}
function mul4(a,b){const r=new Array(16).fill(0);for(let i=0;i<4;i++)for(let j=0;j<4;j++)for(let k=0;k<4;k++)r[j*4+i]+=a[k*4+i]*b[j*4+k];return r}
// ---- 格子（床・縦の面のワイヤーフレーム）----
// 座標の軸にそろえて、マスの大きさの倍数の所に線を引く。原点を通る線だけ軸の色にする
// （X 赤・Y 緑・Z 青）。キャラクターと同じ立体の中に描くので、回すと一緒に動き、手前の体に隠れる
const LVS=`attribute vec3 p;attribute vec3 c;uniform mat4 mvp;varying vec3 vc;void main(){gl_Position=mvp*vec4(p,1.);vc=c;}`;
const LFS=`precision mediump float;varying vec3 vc;void main(){gl_FragColor=vec4(vc,1.);}`;
const lineProg=gl.createProgram(); gl.attachShader(lineProg,sh(gl.VERTEX_SHADER,LVS)); gl.attachShader(lineProg,sh(gl.FRAGMENT_SHADER,LFS)); gl.linkProgram(lineProg);
const gridBuf={p:gl.createBuffer(),c:gl.createBuffer(),n:0};
const grid={floor:false,wall:false,step:200,color:"#7d828c",style:"line"};
try{ Object.assign(grid,JSON.parse(localStorage.getItem("t1grid")||"{}")) }catch(_){}
function gridSave(){ try{ localStorage.setItem("t1grid",JSON.stringify(grid)) }catch(_){} }
function gridLines(){
  const on=layers.filter(L=>L.count&&L.mn);
  if(!(grid.floor||grid.wall)||!on.length) return {pos:[],col:[]};
  const mn=[0,1,2].map(a=>Math.min(...on.map(L=>L.mn[a]))), mx=[0,1,2].map(a=>Math.max(...on.map(L=>L.mx[a])));
  const st=Math.max(1,+grid.step||200), ext=Math.max(mx[0]-mn[0],mx[2]-mn[2],mx[1]-mn[1]);
  const half=Math.max(st*5,Math.ceil(ext*0.9/st)*st);
  const cx=Math.round((mn[0]+mx[0])/2/st)*st, cz=Math.round((mn[2]+mx[2])/2/st)*st;
  const x0=cx-half, x1=cx+half, z0=cz-half, z1=cz+half, y0=mn[1];
  const h=/^#?([0-9a-f]{6})$/i.exec(grid.color||""), base=h?[0,2,4].map(i=>parseInt(h[1].slice(i,i+2),16)/255):[.5,.5,.5];
  const RED=[.85,.25,.25], GRN=[.3,.75,.35], BLU=[.3,.5,.95];
  const pos=[], col=[], line=(a,b,c)=>{ pos.push(...a,...b); col.push(...c,...c) };
  if(grid.floor&&grid.style==="tile"){ /* タイルの床は gridTiles で面として描く */ }
  else if(grid.floor){
    for(let x=x0;x<=x1;x+=st) line([x,y0,z0],[x,y0,z1],x===0?BLU:base);   // x=0 の線は Z 軸に沿う
    for(let z=z0;z<=z1;z+=st) line([x0,y0,z],[x1,y0,z],z===0?RED:base);   // z=0 の線は X 軸に沿う
  }
  if(grid.wall){
    // 縦の面（X と Y の面）は、体の奥（Z のいちばん小さい所）に立てる
    const zw=Math.floor(mn[2]/st)*st, top=y0+Math.ceil((mx[1]-y0)*1.15/st)*st;
    for(let x=x0;x<=x1;x+=st) line([x,y0,zw],[x,top,zw],x===0?GRN:base);
    const ys=Math.ceil(y0/st)*st;
    if(ys!==y0) line([x0,y0,zw],[x1,y0,zw],base);
    for(let y=ys;y<=top;y+=st) line([x0,y,zw],[x1,y,zw],y===0?RED:base);
  }
  return {pos,col};
}
// ゲーム風のタイルの床（対戦画面の床をまねた近似。ゲームの値ではない）。
// 白〜水色のタイルを1枚ずつ少し明るさを変えて敷き、青紫の帯で階段状の四角い枠を描く
function gridTiles(){
  const on=layers.filter(L=>L.count&&L.mn);
  if(!(grid.floor&&grid.style==="tile")||!on.length) return {pos:[],col:[]};
  const mn=[0,1,2].map(a=>Math.min(...on.map(L=>L.mn[a]))), mx=[0,1,2].map(a=>Math.max(...on.map(L=>L.mx[a])));
  const st=Math.max(1,+grid.step||200), n=Math.max(8,Math.ceil(Math.max(mx[0]-mn[0],mx[2]-mn[2])*1.2/st)+4);
  const cx=Math.round((mn[0]+mx[0])/2/st), cz=Math.round((mn[2]+mx[2])/2/st), y=mn[1]-0.5;
  const R=Math.max(3,Math.round(n*0.55));                 // 帯の枠の半径（タイルの数）
  const hash=(i,j)=>{ let h=(i*73856093)^(j*19349663); h=(h^(h>>>13))*1274126177; return ((h^(h>>>16))>>>0)/4294967296 };
  const pos=[], col=[];
  for(let j=-n;j<n;j++) for(let i=-n;i<n;i++){
    const ai=Math.abs(i+0.5), aj=Math.abs(j+0.5), m=Math.max(ai,aj);
    // 階段状の枠：外周の1マス幅。角は1マス内側へ段を付ける
    const band=(Math.abs(m-R)<0.6&&Math.min(ai,aj)<R-1.5)||(Math.abs(ai-(R-1))<0.6&&Math.abs(aj-(R-1))<0.6);
    const k=hash(i+cx,j+cz)*0.08;
    const c=band?[0.38+k*0.5,0.44+k*0.5,0.78]:[0.72+k,0.86+k,0.93+k*0.5];
    const x0=(cx+i)*st, x1=x0+st, z0=(cz+j)*st, z1=z0+st;
    // 1枚の中でも奥ほど少し暗く（画面の床のなめらかな色の変わり方をまねる）
    const cc=(z)=>{ const f=1-0.06*((z-z0)/st); return c.map(v=>Math.min(1,v*f)) };
    pos.push(x0,y,z0, x1,y,z0, x1,y,z1,  x0,y,z0, x1,y,z1, x0,y,z1);
    col.push(...cc(z0),...cc(z0),...cc(z1),...cc(z0),...cc(z1),...cc(z1));
  }
  return {pos,col};
}
function drawGrid(mvp){
  const tl=gridTiles();
  if(tl.pos.length){
    for(let i=0;i<8;i++) gl.disableVertexAttribArray(i);
    gl.useProgram(lineProg); gl.uniformMatrix4fv(gl.getUniformLocation(lineProg,"mvp"),false,mvp);
    for(const [k,data] of [["p",tl.pos],["c",tl.col]]){ const loc=gl.getAttribLocation(lineProg,k);
      gl.bindBuffer(gl.ARRAY_BUFFER,gridBuf[k]); gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(data),gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc,3,gl.FLOAT,false,0,0) }
    gl.drawArrays(gl.TRIANGLES,0,tl.pos.length/3);
    gl.disableVertexAttribArray(gl.getAttribLocation(lineProg,"p")); gl.disableVertexAttribArray(gl.getAttribLocation(lineProg,"c"));
    gl.useProgram(prog);
  }
  const g=gridLines(); if(!g.pos.length) return;
  for(let i=0;i<8;i++) gl.disableVertexAttribArray(i);   // 体を描いたときの並びが残っていると、数が足りないと言われる
  gl.useProgram(lineProg);
  gl.uniformMatrix4fv(gl.getUniformLocation(lineProg,"mvp"),false,mvp);
  for(const [k,data] of [["p",g.pos],["c",g.col]]){ const loc=gl.getAttribLocation(lineProg,k);
    gl.bindBuffer(gl.ARRAY_BUFFER,gridBuf[k]); gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(data),gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc,3,gl.FLOAT,false,0,0) }
  gl.drawArrays(gl.LINES,0,g.pos.length/3);
  gl.disableVertexAttribArray(gl.getAttribLocation(lineProg,"p")); gl.disableVertexAttribArray(gl.getAttribLocation(lineProg,"c"));
  gl.useProgram(prog);
}
function draw(){
  const dpr=Math.min(devicePixelRatio,2), w=canvas.clientWidth*dpr|0, h=canvas.clientHeight*dpr|0;
  if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h}
  gl.viewport(0,0,w,h); gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT); gl.enable(gl.DEPTH_TEST);
  if(!triCount) return;
  const d=radius*2.9*view.dist*Math.max(1,0.8*h/w), cy=Math.cos(view.pitch), tg=center.map((v,i)=>v+view.pan[i]);   // 縦長の画面では引いて横幅も収める
  const eye=[tg[0]+d*cy*Math.cos(view.yaw),tg[1]+d*Math.sin(view.pitch),tg[2]+d*cy*Math.sin(view.yaw)];
  const f=tg.map((v,i)=>v-eye[i]); const fl=Math.hypot(...f); f.forEach((v,i)=>f[i]=v/fl);
  let s=[f[1]*0-f[2]*1,f[2]*0-f[0]*0,f[0]*1-f[1]*0]; const sl=Math.hypot(...s); s=s.map(v=>v/sl);
  const u=[s[1]*f[2]-s[2]*f[1],s[2]*f[0]-s[0]*f[2],s[0]*f[1]-s[1]*f[0]];
  const V=[s[0],u[0],-f[0],0, s[1],u[1],-f[1],0, s[2],u[2],-f[2],0, -(s[0]*eye[0]+s[1]*eye[1]+s[2]*eye[2]),-(u[0]*eye[0]+u[1]*eye[1]+u[2]*eye[2]),(f[0]*eye[0]+f[1]*eye[1]+f[2]*eye[2]),1];
  cam.s=s; cam.u=u; cam.half=d*Math.tan(0.31); cam.aspect=w/h;
  const P=persp(0.62,w/h,radius*0.02,radius*20);
  const MVP=mul4(P,V);
  gl.uniformMatrix4fv(gl.getUniformLocation(prog,"mvp"),false,MVP);
  gl.uniformMatrix4fv(gl.getUniformLocation(prog,"model"),false,[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
  for(const L of layers){
    if(!L.count) continue;
    gl.bindTexture(gl.TEXTURE_2D,L.tex);
    for(const [k,size] of [["p",3],["n",3],["c",3],["t0",3],["t1",4]]){const loc=gl.getAttribLocation(prog,k); gl.bindBuffer(gl.ARRAY_BUFFER,L.bufs[k]); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc,size,gl.FLOAT,false,0,0)}
    gl.drawArrays(gl.TRIANGLES,0,L.count);
  }
  drawGrid(MVP);
}
// 操作: 左ドラッグ=回転、右ドラッグ／Shift＋ドラッグ／中ボタン=移動、ホイール=カーソル位置へ拡大、2本指=移動と拡大
const pointers=new Map(); let dragMode=null;
function panBy(dx,dy){   // 画面上の移動量(CSS px)だけ注視点をずらす
  const k=2*cam.half/canvas.clientHeight;
  for(let i=0;i<3;i++) view.pan[i]-=(cam.s[i]*dx-cam.u[i]*dy)*k;
}
function zoomAt(factor,cx,cy){   // cx, cy = キャンバス内の位置(CSS px)。その点が画面上で動かないように拡大する
  const nd=Math.max(0.06,Math.min(3,view.dist*factor)), real=nd/view.dist;
  const ox=(cx-canvas.clientWidth/2), oy=(cy-canvas.clientHeight/2);
  panBy(-ox*(1-real),-oy*(1-real));
  view.dist=nd;
}
canvas.addEventListener("contextmenu",e=>e.preventDefault());
canvas.addEventListener("pointerdown",e=>{
  try{ canvas.setPointerCapture(e.pointerId) }catch(_){}
  pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
  dragMode=pointers.size>=2?"pinch":(e.button===2||e.button===1||e.shiftKey)?"pan":"rotate";
});
canvas.addEventListener("pointermove",e=>{
  const p=pointers.get(e.pointerId); if(!p) return;
  if(dragMode==="pinch"&&pointers.size>=2){
    const [a,b]=[...pointers.values()], before=Math.hypot(a.x-b.x,a.y-b.y), mx0=(a.x+b.x)/2, my0=(a.y+b.y)/2;
    p.x=e.clientX; p.y=e.clientY;
    const [c,d]=[...pointers.values()], after=Math.hypot(c.x-d.x,c.y-d.y), mx1=(c.x+d.x)/2, my1=(c.y+d.y)/2;
    panBy(mx1-mx0,my1-my0);
    const r=canvas.getBoundingClientRect();
    if(before>0&&after>0) zoomAt(before/after,mx1-r.left,my1-r.top);
  } else {
    const dx=e.clientX-p.x, dy=e.clientY-p.y; p.x=e.clientX; p.y=e.clientY;
    if(dragMode==="pan") panBy(dx,dy);
    else if(dragMode==="rotate"){ view.yaw+=dx*0.01; view.pitch=Math.max(-1.3,Math.min(1.3,view.pitch+dy*0.01)) }
  }
  draw();
});
for(const t of ["pointerup","pointercancel"]) canvas.addEventListener(t,e=>{ pointers.delete(e.pointerId); if(pointers.size===0) dragMode=null; else if(dragMode==="pinch") dragMode="pan" });
canvas.addEventListener("wheel",e=>{ e.preventDefault(); const r=canvas.getBoundingClientRect(); zoomAt(Math.exp(e.deltaY*(e.ctrlKey?0.01:0.001)),e.clientX-r.left,e.clientY-r.top); draw() },{passive:false});
function resetView(){view.yaw=0;view.pitch=0.08;view.dist=1;view.pan=[0,0,0];draw()}
canvas.addEventListener("dblclick",resetView);
// ダブルタップで戻す（iPhone では dblclick が来ないため）
let lastTap={t:0,x:0,y:0}, tapStart=null;
canvas.addEventListener("pointerdown",e=>{ if(e.pointerType==="touch") tapStart={t:performance.now(),x:e.clientX,y:e.clientY,multi:pointers.size>1} },true);
canvas.addEventListener("pointerup",e=>{
  if(e.pointerType!=="touch"||!tapStart) return;
  const now=performance.now(), moved=Math.hypot(e.clientX-tapStart.x,e.clientY-tapStart.y);
  if(!tapStart.multi&&moved<10&&now-tapStart.t<250){
    if(now-lastTap.t<350&&Math.hypot(e.clientX-lastTap.x,e.clientY-lastTap.y)<40){ resetView(); lastTap.t=0; }
    else lastTap={t:now,x:e.clientX,y:e.clientY};
  }
  tapStart=null;
});
if(matchMedia("(pointer:coarse)").matches) document.getElementById("hint").textContent="1本指で回転 ・ 2本指で移動と拡大 ・ ダブルタップで戻す";
addEventListener("resize",draw);
