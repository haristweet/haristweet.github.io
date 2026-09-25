// WebGL で描く。明るさは build.js の buildLuma と同じ式（pose.mjs も同じ）:
//   テクスチャあり: パレット[番号][テクスチャの 4bit]×(環境＋拡散×max(0,法線・光))、テクスチャなし: 36×(同じ)
//   色＝色の変換表[チャンネル][色 RAM の 5bit][明るさ]。影は黒の半透明で、体と背景のあとに描く
const VGL_VS=`
attribute vec3 aPos; attribute vec3 aNrm; attribute vec3 aCol; attribute vec2 aLoc; attribute vec4 aOrgSize; attribute vec3 aMisc;
uniform mat4 uView; uniform vec2 uFocal; uniform vec3 uLight;
varying vec3 vCol; varying vec2 vLoc; varying vec4 vOrgSize; varying vec3 vMisc; varying float vDot;
void main(){
  vec4 p=uView*vec4(aPos,1.0); vec3 n=normalize(mat3(uView)*aNrm);
  vDot=dot(n,uLight);
  vCol=aCol; vLoc=aLoc; vOrgSize=aOrgSize; vMisc=aMisc;
  // 奥行き 0.05〜100 を -1〜1 に
  gl_Position=vec4(uFocal.x*p.x, uFocal.y*p.y, (p.z*100.05-10.0)/99.95, p.z);
}`;
const VGL_FS=`
precision highp float;
uniform sampler2D uTex, uClut, uXlat; uniform vec3 uLumaK; uniform float uShadow, uCut;
varying vec3 vCol; varying vec2 vLoc; varying vec4 vOrgSize; varying vec3 vMisc; varying float vDot;
float xl(float row,float luma){ return texture2D(uXlat,vec2((luma+0.5)/64.0,(row+0.5)/96.0)).r; }
void main(){
  if(uShadow>0.5){ gl_FragColor=vec4(0.0,0.0,0.0,0.45); return; }
  float k=uLumaK.x+uLumaK.y*max(0.0,vDot), luma;
  if(vMisc.x>0.5){
    vec2 t=vOrgSize.xy+mod(vLoc,vOrgSize.zw);
    float x=floor(t.x)+vMisc.y*512.0, y=floor(t.y);
    float tx=floor(texture2D(uTex,vec2((x+0.5)/1024.0,(y+0.5)/1024.0)).r*255.0/17.0+0.5);
    if(abs(tx-uCut)<0.5||(vMisc.x>1.5&&tx>14.5)) discard;   // 値 15 は、属性 h0 の bit13 が立った面では透明（推測。写真で木が抜けるのを確かめた）
    luma=texture2D(uClut,vec2((tx+0.5)/16.0,(vMisc.z+0.5)/256.0)).r*255.0*k;
  } else luma=uLumaK.z*k;
  luma=clamp(floor(luma),0.0,63.0);
  gl_FragColor=vec4(xl(vCol.r,luma),xl(32.0+vCol.g,luma),xl(64.0+vCol.b,luma),1.0);
}`;
let vglCut=+(new URLSearchParams(location.search).get("cut")??-1);
function vglNew(canvas){
  const gl=canvas.getContext("webgl",{antialias:true,preserveDrawingBuffer:true,alpha:true});
  if(!gl) throw new Error("このブラウザは WebGL に対応していない");
  const sh=(t,src)=>{ const s=gl.createShader(t); gl.shaderSource(s,src); gl.compileShader(s); if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s };
  const pr=gl.createProgram(); gl.attachShader(pr,sh(gl.VERTEX_SHADER,VGL_VS)); gl.attachShader(pr,sh(gl.FRAGMENT_SHADER,VGL_FS)); gl.linkProgram(pr);
  if(!gl.getProgramParameter(pr,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr));
  const bufs=[gl.createBuffer(),gl.createBuffer()], counts=[0,0], tex={};
  const lum=(name,unit,w,h,data)=>{ let t=tex[name]; if(!t){ t=tex[name]=gl.createTexture() }
    gl.activeTexture(gl.TEXTURE0+unit); gl.bindTexture(gl.TEXTURE_2D,t); gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.LUMINANCE,w,h,0,gl.LUMINANCE,gl.UNSIGNED_BYTE,data);
    for(const p of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D,p,gl.NEAREST);
    for(const p of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D,p,gl.CLAMP_TO_EDGE) };
  return {
    // 色とテクスチャの材料（sceneColors の結果）を GPU に置く
    setColors(col){
      const t=new Uint8Array(1024*1024);
      for(let page=0;page<2;page++) for(let y=0;y<1024;y++) for(let x=0;x<512;x+=2){
        const b=col.tex[(page<<18)+y*256+(x>>1)], o=y*1024+page*512+x; t[o]=(b&15)*17; t[o+1]=(b>>4)*17 }
      lum("tex",0,1024,1024,t);
      const c=new Uint8Array(16*256); for(let p=0;p<256;p++) for(let k=0;k<16;k++) c[p*16+k]=col.clut[p*128+k*4];
      lum("clut",1,16,256,c);
      lum("xlat",2,64,96,col.xlat.slice(0,64*96));
    },
    // body＝体と背景、shadow＝影
    setMesh(body,shadow){ [body,shadow].forEach((m,i)=>{ gl.bindBuffer(gl.ARRAY_BUFFER,bufs[i]); gl.bufferData(gl.ARRAY_BUFFER,m?m.data:new Float32Array(0),gl.STATIC_DRAW); counts[i]=m?m.count:0 }) },
    // view: 4×4（列優先）、focal: [x,y]（クリップ座標の倍率）
    draw(view,focal,light){
      const W=canvas.width,H=canvas.height; gl.viewport(0,0,W,H); gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
      if(!counts[0]&&!counts[1]) return; gl.enable(gl.DEPTH_TEST); gl.useProgram(pr);
      const u=n=>gl.getUniformLocation(pr,n);
      gl.uniformMatrix4fv(u("uView"),false,view); gl.uniform2fv(u("uFocal"),focal); gl.uniform3fv(u("uLight"),light);
      gl.uniform3f(u("uLumaK"),BUILD_AMB,BUILD_DIF,BUILD_FLAT); gl.uniform1f(u("uCut"),vglCut);
      gl.uniform1i(u("uTex"),0); gl.uniform1i(u("uClut"),1); gl.uniform1i(u("uXlat"),2);
      const F=4, S=BUILD_STRIDE*F;
      for(let i=0;i<2;i++){ if(!counts[i]) continue;
        gl.bindBuffer(gl.ARRAY_BUFFER,bufs[i]);
        const at=(n,k,o)=>{ const l=gl.getAttribLocation(pr,n); if(l<0) return; gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l,k,gl.FLOAT,false,S,o*F) };
        at("aPos",3,0); at("aNrm",3,3); at("aCol",3,6); at("aLoc",2,9); at("aOrgSize",4,11); at("aMisc",3,15);
        gl.uniform1f(u("uShadow"),i);
        if(i){ gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false) }
        gl.drawArrays(gl.TRIANGLES,0,counts[i]);
        if(i){ gl.disable(gl.BLEND); gl.depthMask(true) }
      }
    }
  };
}
