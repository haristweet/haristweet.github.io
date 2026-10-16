// ページの描画（WebGL1）。形ごとに [x,y,z,u,v] の列と、その形の絵（RGBA）を持つ。光は当てない（絵の色をそのまま）。
// 髪の絵は α が段々（0〜0x80）なので半透明で重ねる。並べた順（顔→髪）に描く
function weGL(canvas){
  const gl=canvas.getContext("webgl",{preserveDrawingBuffer:true,alpha:true,antialias:true});
  if(!gl) throw new Error("このブラウザでは WebGL が使えません");
  const sh=(t,s)=>{ const o=gl.createShader(t); gl.shaderSource(o,s); gl.compileShader(o); if(!gl.getShaderParameter(o,gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o };
  const pr=gl.createProgram();
  gl.attachShader(pr,sh(gl.VERTEX_SHADER,"attribute vec3 p;attribute vec2 t;uniform mat4 M;varying vec2 vt;void main(){gl_Position=M*vec4(p,1.);vt=t;}"));
  gl.attachShader(pr,sh(gl.FRAGMENT_SHADER,"precision mediump float;uniform sampler2D T;uniform float useT;uniform float opq;varying vec2 vt;void main(){vec4 c=useT>.5?texture2D(T,vt):vec4(.78,.75,.68,1.);if(opq>.5)c.a=1.;if(c.a<.02)discard;gl_FragColor=c;}"));
  gl.linkProgram(pr); gl.useProgram(pr);
  const A={p:gl.getAttribLocation(pr,"p"),t:gl.getAttribLocation(pr,"t")}, uM=gl.getUniformLocation(pr,"M"), uT=gl.getUniformLocation(pr,"useT"), uO=gl.getUniformLocation(pr,"opq");
  let items=[];
  return {
    // ms: [{f:Float32Array, tex:{W,H,rgba}|null, opaque?, clamp?, overlay?}]。opaque は絵の α を使わずに塗る（JWE2010 の後ろ髪）。clamp は絵をくり返さない、overlay は服に重ねる絵（JWE2010 の背番号・名前）
    set(ms){
      for(const it of items){ gl.deleteBuffer(it.buf); if(it.tex) gl.deleteTexture(it.tex) }
      items=ms.map(m=>{ const buf=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,buf); gl.bufferData(gl.ARRAY_BUFFER,m.f,gl.STATIC_DRAW);
        let tex=null;
        if(m.tex&&m.tex.rgba){ tex=gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D,tex);
          // 絵は 2 のべき乗の大きさなので、くり返し（REPEAT）が使える
          // clamp の形（JWE2010 の背番号・名前）は端を伸ばす
          const wr=m.clamp?gl.CLAMP_TO_EDGE:gl.REPEAT;
          for(const [k,v] of [[gl.TEXTURE_MIN_FILTER,gl.LINEAR],[gl.TEXTURE_MAG_FILTER,gl.LINEAR],[gl.TEXTURE_WRAP_S,wr],[gl.TEXTURE_WRAP_T,wr]]) gl.texParameteri(gl.TEXTURE_2D,k,v);
          gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,m.tex.W,m.tex.H,0,gl.RGBA,gl.UNSIGNED_BYTE,m.tex.rgba) }
        return {buf,tex,n:m.f.length/5,opaque:!!m.opaque,overlay:!!m.overlay} });
    },
    // 形の位置だけ差し替える（絵はそのまま）。ms は set と同じ並び・同じ数（JWE2010 の動きの再生）
    geom(ms){ ms.forEach((m,i)=>{ const it=items[i]; if(!it) return; gl.bindBuffer(gl.ARRAY_BUFFER,it.buf); gl.bufferData(gl.ARRAY_BUFFER,m.f,gl.DYNAMIC_DRAW); it.n=m.f.length/5 }) },
    draw(view,bg){
      const W=canvas.width=Math.round(canvas.clientWidth*devicePixelRatio), H=canvas.height=Math.round(canvas.clientHeight*devicePixelRatio);
      gl.viewport(0,0,W,H); gl.clearColor(...(bg||[0,0,0,0])); gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT); gl.enable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA,gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(pr); gl.uniformMatrix4fv(uM,false,weViewMatrix(view,W/H));
      // 裏向きの面は描かない（向きは頂点の法線から決めてある。we12.js の weModel）。顔は前だけの面なので、後ろから見ると髪の向こうは抜ける
      gl.frontFace(gl.CW); gl.enable(gl.CULL_FACE);
      for(const it of items){
        gl.bindBuffer(gl.ARRAY_BUFFER,it.buf);
        gl.enableVertexAttribArray(A.p); gl.vertexAttribPointer(A.p,3,gl.FLOAT,false,20,0);
        gl.enableVertexAttribArray(A.t); gl.vertexAttribPointer(A.t,2,gl.FLOAT,false,20,12);
        gl.uniform1f(uT,it.tex?1:0); gl.uniform1f(uO,it.opaque?1:0); if(it.tex) gl.bindTexture(gl.TEXTURE_2D,it.tex);
        // overlay の形（服の面と同じ所に重ねる絵）は、少し手前にずらして同じ深さでも描く
        if(it.overlay){ gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(-1,-4); gl.depthFunc(gl.LEQUAL) } else { gl.disable(gl.POLYGON_OFFSET_FILL); gl.depthFunc(gl.LESS) }
        gl.drawArrays(gl.TRIANGLES,0,it.n);
      }
    }
  };
}
// 列優先の 4×4。view: {yaw,pitch,dist,target:[x,y,z],fov,pan:[x,y]}。画面の座標（Y 上・手前 +Z）を回してカメラは −Z を向く。pan は画面に平行にずらす量（形の単位、無ければ 0）
function weViewMatrix(v,aspect){
  const cy=Math.cos(v.yaw), sy=Math.sin(v.yaw), cp=Math.cos(v.pitch), sp=Math.sin(v.pitch), [tx,ty,tz]=v.target;
  const f=1/Math.tan((v.fov||30)*Math.PI/360), near=v.dist/50, far=v.dist*50;
  const tr=p=>{ const x=p[0]-tx, y=p[1]-ty, z=p[2]-tz, x1=x*cy+z*sy, z1=-x*sy+z*cy, y2=y*cp-z1*sp, z2=y*sp+z1*cp; return [x1+(v.pan?.[0]||0),y2+(v.pan?.[1]||0),z2-v.dist] };
  const o=tr([0,0,0]), ex=tr([1,0,0]).map((a,i)=>a-o[i]), ey=tr([0,1,0]).map((a,i)=>a-o[i]), ez=tr([0,0,1]).map((a,i)=>a-o[i]);
  const V=[ex[0],ex[1],ex[2],0, ey[0],ey[1],ey[2],0, ez[0],ez[1],ez[2],0, o[0],o[1],o[2],1];
  const P=[f/aspect,0,0,0, 0,f,0,0, 0,0,(far+near)/(near-far),-1, 0,0,2*far*near/(near-far),0];
  const M=new Float32Array(16);
  for(let c=0;c<4;c++) for(let r=0;r<4;r++){ let s=0; for(let k=0;k<4;k++) s+=P[k*4+r]*V[c*4+k]; M[c*4+r]=s }
  return M;
}
