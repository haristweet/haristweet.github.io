// WebGL で描く。色は pose.mjs（写真と照らした式）と同じ:
//   テクスチャあり: 明るさ＝パレット[番号][テクスチャの 4bit]×(0.6+0.4×陰)×1.2、テクスチャなし: 明るさ＝63×陰
//   色＝色の変換表[チャンネル][色 RAM の 5bit][明るさ]
const VGL_VS=`
attribute vec3 aPos; attribute vec3 aNrm; attribute vec3 aCol; attribute vec2 aLoc; attribute vec4 aOrgSize; attribute vec3 aMisc;
uniform mat4 uView; uniform vec2 uFocal; uniform vec3 uLight;
varying vec3 vCol; varying vec2 vLoc; varying vec4 vOrgSize; varying vec3 vMisc; varying float vShade;
void main(){
  vec4 p=uView*vec4(aPos,1.0); vec3 n=normalize(mat3(uView)*aNrm);
  vShade=abs(dot(n,uLight));
  vCol=aCol; vLoc=aLoc; vOrgSize=aOrgSize; vMisc=aMisc;
  // 奥行き 0.05〜100 を -1〜1 に
  gl_Position=vec4(uFocal.x*p.x, uFocal.y*p.y, (p.z*100.05-10.0)/99.95, p.z);
}`;
const VGL_FS=`
precision highp float;
uniform sampler2D uTex, uClut, uXlat; uniform float uLumaK;
varying vec3 vCol; varying vec2 vLoc; varying vec4 vOrgSize; varying vec3 vMisc; varying float vShade;
float xl(float row,float luma){ return texture2D(uXlat,vec2((luma+0.5)/64.0,(row+0.5)/96.0)).r; }
void main(){
  float sh=0.35+0.65*vShade, luma;
  if(vMisc.x>0.5){
    vec2 t=vOrgSize.xy+mod(vLoc,vOrgSize.zw);
    float x=floor(t.x)+vMisc.y*512.0, y=floor(t.y);
    float tx=floor(texture2D(uTex,vec2((x+0.5)/1024.0,(y+0.5)/1024.0)).r*255.0/17.0+0.5);
    luma=texture2D(uClut,vec2((tx+0.5)/16.0,(vMisc.z+0.5)/256.0)).r*255.0*(0.6+0.4*sh)*uLumaK;
  } else luma=63.0*sh;
  luma=clamp(floor(luma),0.0,63.0);
  gl_FragColor=vec4(xl(vCol.r,luma),xl(32.0+vCol.g,luma),xl(64.0+vCol.b,luma),1.0);
}`;
function vglNew(canvas){
  const gl=canvas.getContext("webgl",{antialias:true,preserveDrawingBuffer:true,alpha:true});
  if(!gl) throw new Error("このブラウザは WebGL に対応していない");
  const sh=(t,src)=>{ const s=gl.createShader(t); gl.shaderSource(s,src); gl.compileShader(s); if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s };
  const pr=gl.createProgram(); gl.attachShader(pr,sh(gl.VERTEX_SHADER,VGL_VS)); gl.attachShader(pr,sh(gl.FRAGMENT_SHADER,VGL_FS)); gl.linkProgram(pr);
  if(!gl.getProgramParameter(pr,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr));
  const buf=gl.createBuffer(), tex={};
  const lum=(name,unit,w,h,data)=>{ let t=tex[name]; if(!t){ t=tex[name]=gl.createTexture() }
    gl.activeTexture(gl.TEXTURE0+unit); gl.bindTexture(gl.TEXTURE_2D,t); gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.LUMINANCE,w,h,0,gl.LUMINANCE,gl.UNSIGNED_BYTE,data);
    for(const p of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D,p,gl.NEAREST);
    for(const p of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D,p,gl.CLAMP_TO_EDGE) };
  let count=0;
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
    setMesh(mesh){ gl.bindBuffer(gl.ARRAY_BUFFER,buf); gl.bufferData(gl.ARRAY_BUFFER,mesh.data,gl.STATIC_DRAW); count=mesh.count },
    // view: 4×4（列優先）、focal: [x,y]（クリップ座標の倍率）
    draw(view,focal,light,lumaK){
      const W=canvas.width,H=canvas.height; gl.viewport(0,0,W,H); gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
      if(!count) return; gl.enable(gl.DEPTH_TEST); gl.useProgram(pr); gl.bindBuffer(gl.ARRAY_BUFFER,buf);
      const F=4, S=BUILD_STRIDE*F, at=(n,k,o)=>{ const l=gl.getAttribLocation(pr,n); if(l<0) return; gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l,k,gl.FLOAT,false,S,o*F) };
      at("aPos",3,0); at("aNrm",3,3); at("aCol",3,6); at("aLoc",2,9); at("aOrgSize",4,11); at("aMisc",3,15);
      const u=n=>gl.getUniformLocation(pr,n);
      gl.uniformMatrix4fv(u("uView"),false,view); gl.uniform2fv(u("uFocal"),focal); gl.uniform3fv(u("uLight"),light); gl.uniform1f(u("uLumaK"),lumaK);
      gl.uniform1i(u("uTex"),0); gl.uniform1i(u("uClut"),1); gl.uniform1i(u("uXlat"),2);
      gl.drawArrays(gl.TRIANGLES,0,count);
    }
  };
}
