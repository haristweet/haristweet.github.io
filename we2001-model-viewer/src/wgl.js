// ページの描画（WebGL1）。テクスチャは「(tsb,cba) の組ごとに 256×256 にほどいた絵」を 1 枚の大きな絵（4×4 欄）に並べて使う。
// 三角形は [x,y,z, u,v, 明るさ] を CPU で作って毎回送る（選手 1 人で 600 面ほどなので軽い）
const WE_ATLAS=2048, WE_TILE=256;   // 8×8 欄（集合写真は 11 人で色の表の組が増える）
// VRAM と (tsb,cba) の並びから、RGBA の大きな絵と「組→欄の番号」を作る。色 0 は透明
// kit に自分のユニフォームの絵（256×256 の RGBA、背番号は組み立て済み）を渡すと、選手の服（ページ 153・色の表 486）はそれで描く
function weAtlas(vram,combos,kit){
  const px=new Uint8Array(WE_ATLAS*WE_ATLAS*4), slot=new Map();
  combos.slice(0,64).forEach((k,n)=>{ const [tsb,cba]=k.split(",").map(Number), ox=(n&7)*WE_TILE, oy=(n>>3)*WE_TILE; slot.set(k,n); const own=kit&&tsb===153&&(cba>>6)===486;
    for(let v=0;v<256;v++) for(let u=0;u<256;u++){ const c=own?weKitTexel(kit,u,v):weTexel(vram,tsb,cba,u,v), i=((oy+v)*WE_ATLAS+ox+u)*4; if(c){ px[i]=c[0]; px[i+1]=c[1]; px[i+2]=c[2]; px[i+3]=255 } } });
  return {px,slot};
}
// 組んだ部品（wePose の返り値）から三角形の列を作る。tmds は 位置→tmdRead の結果。light は使わない（ゲームが光を当てないので。呼び出しの形だけ残す）。
// look は選手の見た目（look.js の weLookPrim で面ごとに UV・色の表の位置を書き換える。null なら書き換えない）
function weTris(tmds,parts,slot,light,look){
  const out=[], used=new Set();
  for(const pt of parts){ const t=tmds.get(pt.off); if(!t) continue; let pk=0;
    for(const o of t.objs) for(const p0 of o.prims){ pk++; if(!p0.uv) continue;
      const L=weLookPrim(p0,pt.part,pk,look), p={...p0,uv:L.uv,cba:L.cba,tsb:L.tsb};
      const k=p.tsb+","+p.cba; used.add(k); const n=slot?slot.get(k):undefined; if(slot&&n===undefined) continue;
      const P=p.v.map(i=>weXform(pt.m,pt.t,o.verts[i]||[0,0,0]));
      // 明るさ: ゲームは選手に光を当てず、どの面も色 127,127,127 でテクスチャを描く（本体 0x8001235c。光の計算の命令が無い）＝ほぼそのまま
      const sh=127/128;
      const ox=((n??0)&7)*WE_TILE, oy=((n??0)>>3)*WE_TILE;
      const V=P.map((q,j)=>[q[0],q[1],q[2],(ox+p.uv[j][0]+.5)/WE_ATLAS,(oy+p.uv[j][1]+.5)/WE_ATLAS,sh]);
      for(let i=1;i+1<V.length;i++) out.push(...V[0],...V[i],...V[i+1]);
    } }
  return {tris:new Float32Array(out),used:[...used]};
}
function weGL(canvas){
  const gl=canvas.getContext("webgl",{preserveDrawingBuffer:true,alpha:true,antialias:true});
  if(!gl) throw new Error("このブラウザでは WebGL が使えません");
  const sh=(t,s)=>{ const o=gl.createShader(t); gl.shaderSource(o,s); gl.compileShader(o); if(!gl.getShaderParameter(o,gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o };
  const pr=gl.createProgram();
  gl.attachShader(pr,sh(gl.VERTEX_SHADER,"attribute vec3 p;attribute vec2 t;attribute float s;uniform mat4 M;varying vec2 vt;varying float vs;void main(){gl_Position=M*vec4(p,1.);vt=t;vs=s;}"));
  gl.attachShader(pr,sh(gl.FRAGMENT_SHADER,"precision mediump float;uniform sampler2D T;varying vec2 vt;varying float vs;void main(){vec4 c=texture2D(T,vt);if(c.a<.5)discard;gl_FragColor=vec4(min(c.rgb*vs,1.),1.);}"));
  gl.linkProgram(pr); gl.useProgram(pr);
  const buf=gl.createBuffer(), tex=gl.createTexture(), A={p:gl.getAttribLocation(pr,"p"),t:gl.getAttribLocation(pr,"t"),s:gl.getAttribLocation(pr,"s")}, uM=gl.getUniformLocation(pr,"M");
  gl.bindTexture(gl.TEXTURE_2D,tex);
  for(const [k,v] of [[gl.TEXTURE_MIN_FILTER,gl.NEAREST],[gl.TEXTURE_MAG_FILTER,gl.NEAREST],[gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE],[gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D,k,v);
  let n=0;
  return {
    setAtlas(px){ gl.bindTexture(gl.TEXTURE_2D,tex); gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,WE_ATLAS,WE_ATLAS,0,gl.RGBA,gl.UNSIGNED_BYTE,px) },
    setTris(f){ gl.bindBuffer(gl.ARRAY_BUFFER,buf); gl.bufferData(gl.ARRAY_BUFFER,f,gl.DYNAMIC_DRAW); n=f.length/6 },
    // view: {yaw,pitch,dist,target:[x,y,z],fov}。PS1 の座標は Y が下向き・正面が -Z なので、X 軸まわりに半回転して（Y と Z を反転。鏡写しにしない）画面へ
    draw(view,bg){
      const W=canvas.width=Math.round(canvas.clientWidth*devicePixelRatio), H=canvas.height=Math.round(canvas.clientHeight*devicePixelRatio);
      gl.viewport(0,0,W,H); gl.clearColor(...(bg||[0,0,0,0])); gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT); gl.enable(gl.DEPTH_TEST);
      if(!n) return;
      gl.useProgram(pr); gl.uniformMatrix4fv(uM,false,weViewMatrix(view,W/H));
      gl.bindBuffer(gl.ARRAY_BUFFER,buf);
      gl.enableVertexAttribArray(A.p); gl.vertexAttribPointer(A.p,3,gl.FLOAT,false,24,0);
      gl.enableVertexAttribArray(A.t); gl.vertexAttribPointer(A.t,2,gl.FLOAT,false,24,12);
      gl.enableVertexAttribArray(A.s); gl.vertexAttribPointer(A.s,1,gl.FLOAT,false,24,20);
      gl.drawArrays(gl.TRIANGLES,0,n);
    }
  };
}
// 列優先の 4×4。体の座標 → 画面。v.fx・v.fy があれば、画面の横・縦の倍率をそのまま使う（PS1 の 512×240・奥行き 603 を 4:3 に引き伸ばす投影＝fx 603/256・fy 603/120）
function weViewMatrix(v,aspect){
  const cy=Math.cos(v.yaw), sy=Math.sin(v.yaw), cp=Math.cos(v.pitch), sp=Math.sin(v.pitch), [tx,ty,tz]=v.target;
  // 回す: まず X 軸まわりに半回転（Y を上向きに、正面をカメラへ）、ヨー（縦の軸）、ピッチ（横の軸）、カメラは -Z を向く
  const f=1/Math.tan((v.fov||30)*Math.PI/360), near=10, far=20000;
  const tr=p=>{ const x=p[0]-tx, y=-(p[1]-ty), z=-(p[2]-tz);
    const x1=x*cy-z*sy, z1=x*sy+z*cy, y2=y*cp-z1*sp, z2=y*sp+z1*cp; return [x1,y2,z2-v.dist] };
  const o=tr([0,0,0]), ex=tr([1,0,0]).map((a,i)=>a-o[i]), ey=tr([0,1,0]).map((a,i)=>a-o[i]), ez=tr([0,0,1]).map((a,i)=>a-o[i]);
  const V=[ex[0],ex[1],ex[2],0, ey[0],ey[1],ey[2],0, ez[0],ez[1],ez[2],0, o[0],o[1],o[2],1];
  const P=[v.fx?v.fx*(4/3)/aspect:f/aspect,0,0,0, 0,v.fy||f,0,0, 0,0,(far+near)/(near-far),-1, 0,0,2*far*near/(near-far),0];
  const M=new Float32Array(16);
  for(let c=0;c<4;c++) for(let r=0;r<4;r++){ let s=0; for(let k=0;k<4;k++) s+=P[k*4+r]*V[c*4+k]; M[c*4+r]=s }
  return M;
}
