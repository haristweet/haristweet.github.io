// WebGL で描く。明るさは build.js の buildBright・buildLuma と同じ式（VU1 のプログラムを写したもの。pose.mjs も同じ）。
// 色＝色の変換表[チャンネル][色 RAM の 5bit][明るさ]。光はゲームのカメラの座標で計算する（回して見ても場面に固定）。影は黒の半透明で最後に描く
const VGL_VS=`
attribute vec3 aPos; attribute vec3 aNrm; attribute vec3 aCol; attribute vec2 aLoc; attribute vec4 aOrgSize; attribute vec3 aMisc; attribute vec4 aLk; attribute float aSpecial;
uniform mat4 uView; uniform vec2 uFocal; uniform vec3 uLight;
varying vec3 vCol; varying vec2 vLoc; varying vec4 vOrgSize; varying vec3 vMisc; varying float vB; varying float vSpecial;
void main(){
  vec4 p=uView*vec4(aPos,1.0);
  float d=clamp(dot(uLight,aNrm),0.0,1.0), s=clamp(2.0*d*aNrm.z-uLight.z,0.0,1.0);
  vB=floor(clamp(aLk.x*d+aLk.y+(aLk.w>0.5?aLk.z*pow(s,8.0):0.0),0.0,127.0));
  vCol=aCol; vLoc=aLoc; vOrgSize=aOrgSize; vMisc=aMisc; vSpecial=mod(aSpecial,2.0);
  // 奥行き 0.05〜100 を -1〜1 に
  gl_Position=vec4(uFocal.x*p.x, uFocal.y*p.y, (p.z*100.05-10.0)/99.95, p.z);
  // 貼りもの（目や眉）は肌とほぼ同じ所にあるので、ごくわずか手前へ（ゲームは部品の中を描く順に重ね塗りする。VU1 の m2mdlSetSameZval）
  if(aSpecial>1.5) gl_Position.z-=0.00002*p.z;
}`;
const VGL_FS=`
precision highp float;
uniform sampler2D uTex, uClut, uXlat; uniform float uShadow, uCut, uBilin;
varying vec3 vCol; varying vec2 vLoc; varying vec4 vOrgSize; varying vec3 vMisc; varying float vB; varying float vSpecial;
// テクスチャの値（0〜15）。loc は面の中のテクセルの位置で、テクスチャの大きさで折り返す
float texv(vec2 loc){
  vec2 t=vOrgSize.xy+mod(loc,vOrgSize.zw);
  return floor(texture2D(uTex,vec2((floor(t.x)+vMisc.y*512.0+0.5)/1024.0,(floor(t.y)+0.5)/1024.0)).r*255.0/17.0+0.5);
}
float xl(float row,float luma){ return texture2D(uXlat,vec2((luma+0.5)/64.0,(row+0.5)/96.0)).r; }
void main(){
  if(uShadow>0.5){ gl_FragColor=vec4(0.0,0.0,0.0,0.45); return; }
  float L=floor(texture2D(uClut,vec2((vB+0.5)/128.0,(vMisc.z+0.5)/256.0)).r*255.0+0.5), luma;
  if(vMisc.x>0.5){
    float tx=texv(vLoc);
    bool cut=vMisc.x>1.5, ramp=vSpecial>0.5||L<48.0;
    if(abs(tx-uCut)<0.5||(cut&&tx>14.5)) discard;   // 値 15 は、属性 h0 の bit13 が立った面では透明（推測。写真で木が抜けるのを確かめた）
    // なめらか: ゲームは GS にバイリニアで引かせている（ゲームが描いた画面がぼけている）。周りの4つのテクセルの重み付き平均。
    // 透明のある面では透明のテクセル（15）を混ぜない（混ぜると縁が白っぽく色あせる）
    if(uBilin>0.5){ vec2 f=vLoc-0.5, b=floor(f), a=f-b;
      vec4 t=vec4(texv(b),texv(b+vec2(1.0,0.0)),texv(b+vec2(0.0,1.0)),texv(b+vec2(1.0,1.0))), w=vec4((1.0-a.x)*(1.0-a.y),a.x*(1.0-a.y),(1.0-a.x)*a.y,a.x*a.y);
      if(cut) w*=step(t,vec4(14.5));
      float ws=dot(w,vec4(1.0)); if(ws<1e-3){ t=vec4(tx); w=vec4(1.0,0.0,0.0,0.0); } else w/=ws;   // 4つとも透明（重み 0）なら一番近いテクセルだけ
      if(!ramp){
        // 目や眉など、値を色の表の特別な欄（48 列目〜）の番号として使う面: 番号を平均すると関係のない色になるので、4つを色にしてから混ぜる
        vec3 c=vec3(0.0);
        for(int k=0;k<4;k++){ float tk=k==0?t.x:k==1?t.y:k==2?t.z:t.w, wk=k==0?w.x:k==1?w.y:k==2?w.z:w.w; float lk=clamp(floor(48.0+tk+0.5),0.0,63.0);
          c+=wk*vec3(xl(vCol.r,lk),xl(32.0+vCol.g,lk),xl(64.0+vCol.b,lk)); }
        gl_FragColor=vec4(c,1.0); return;
      }
      tx=dot(t,w); }
    luma=ramp?floor(L*tx*17.0*8.0/2048.0):floor(48.0+tx+0.5);
  } else luma=L;
  luma=clamp(luma,0.0,63.0);
  gl_FragColor=vec4(xl(vCol.r,luma),xl(32.0+vCol.g,luma),xl(64.0+vCol.b,luma),1.0);
}`;
let vglCut=+(new URLSearchParams(location.search).get("cut")??-1);
function vglNew(canvas){
  const gl=canvas.getContext("webgl",{antialias:true,preserveDrawingBuffer:true,alpha:true});
  if(!gl) throw new Error("このブラウザは WebGL に対応していない");
  const sh=(t,src)=>{ const s=gl.createShader(t); gl.shaderSource(s,src); gl.compileShader(s); if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s };
  const pr=gl.createProgram(); gl.attachShader(pr,sh(gl.VERTEX_SHADER,VGL_VS)); gl.attachShader(pr,sh(gl.FRAGMENT_SHADER,VGL_FS)); gl.linkProgram(pr);
  if(!gl.getProgramParameter(pr,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr));
  const bufs=[gl.createBuffer(),gl.createBuffer()], counts=[0,0], tex={}; let mirror=null;
  // 空と遠景（MODEL2 の2Dの面。画面に貼るだけで、視点を回しても動かない）
  const bp=gl.createProgram();
  gl.attachShader(bp,sh(gl.VERTEX_SHADER,"attribute vec2 aXY; varying vec2 vUV; void main(){ vUV=vec2(aXY.x*0.5+0.5,0.5-aXY.y*0.5); gl_Position=vec4(aXY,0.999,1.0); }"));
  gl.attachShader(bp,sh(gl.FRAGMENT_SHADER,"precision mediump float; uniform sampler2D uBack; varying vec2 vUV; void main(){ vec4 c=texture2D(uBack,vUV); if(c.a<0.5) discard; gl_FragColor=vec4(c.rgb,1.0); }"));
  gl.linkProgram(bp); if(!gl.getProgramParameter(bp,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(bp));
  const quad=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,quad); gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
  let hasBack=false;
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
      lum("clut",1,128,256,col.clut.slice(0,128*256));   // 曲線（明るさの段階 B → L）。番号ごとに 128 段
      lum("xlat",2,64,96,col.xlat.slice(0,64*96));
    },
    // 空と遠景の絵（496×384 の RGBA。null で消す）
    setBack(rgba){ hasBack=!!rgba; if(!rgba) return; let t=tex.back; if(!t) t=tex.back=gl.createTexture();
      gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D,t); gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,496,384,0,gl.RGBA,gl.UNSIGNED_BYTE,rgba);
      for(const p of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D,p,gl.NEAREST);
      for(const p of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D,p,gl.CLAMP_TO_EDGE) },
    // body＝体と背景、shadow＝影
    setMesh(body,shadow){ [body,shadow].forEach((m,i)=>{ gl.bindBuffer(gl.ARRAY_BUFFER,bufs[i]); gl.bufferData(gl.ARRAY_BUFFER,m?m.data:new Float32Array(0),gl.STATIC_DRAW); counts[i]=m?m.count:0 }); mirror=body&&body.mirror },
    // view: 4×4（列優先）、focal: [x,y]（クリップ座標の倍率）
    draw(view,focal,light,back,opt={}){
      const W=canvas.width,H=canvas.height; gl.viewport(0,0,W,H); gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
      if(!counts[0]&&!counts[1]) return;
      for(let l=0;l<8;l++) gl.disableVertexAttribArray(l);
      if(back&&hasBack){   // いちばん先に、奥行きを書かずに画面いっぱいに貼る（ゲームも 3D より先に描く）
        gl.useProgram(bp); gl.disable(gl.DEPTH_TEST); gl.bindBuffer(gl.ARRAY_BUFFER,quad);
        const l=gl.getAttribLocation(bp,"aXY"); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l,2,gl.FLOAT,false,0,0);
        gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D,tex.back); gl.uniform1i(gl.getUniformLocation(bp,"uBack"),3);
        gl.drawArrays(gl.TRIANGLE_STRIP,0,4); gl.disableVertexAttribArray(l);
      }
      gl.enable(gl.DEPTH_TEST); gl.useProgram(pr);
      const u=n=>gl.getUniformLocation(pr,n);
      gl.uniformMatrix4fv(u("uView"),false,view); gl.uniform2fv(u("uFocal"),focal); gl.uniform3fv(u("uLight"),light);
      gl.uniform1f(u("uCut"),vglCut); gl.uniform1f(u("uBilin"),opt.bilin?1:0);
      gl.uniform1i(u("uTex"),0); gl.uniform1i(u("uClut"),1); gl.uniform1i(u("uXlat"),2);
      const F=4, S=BUILD_STRIDE*F;
      for(let i=0;i<2;i++){ if(!counts[i]) continue;
        gl.bindBuffer(gl.ARRAY_BUFFER,bufs[i]);
        const at=(n,k,o)=>{ const l=gl.getAttribLocation(pr,n); if(l<0) return; gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l,k,gl.FLOAT,false,S,o*F) };
        at("aPos",3,0); at("aNrm",3,3); at("aCol",3,6); at("aLoc",2,9); at("aOrgSize",4,11); at("aMisc",3,15); at("aLk",4,19); at("aSpecial",1,23);
        gl.uniform1f(u("uShadow"),i);
        if(i){ gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false) }
        // 映り込みは奥行きを比べず・書かずに描き（前の組の上に塗る）、あとに来る床に隠させる（build.js の sceneMesh の説明）
        if(!i&&mirror){ gl.drawArrays(gl.TRIANGLES,0,mirror[0]); gl.depthMask(false); gl.disable(gl.DEPTH_TEST); gl.drawArrays(gl.TRIANGLES,mirror[0],mirror[1]-mirror[0]); gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.drawArrays(gl.TRIANGLES,mirror[1],counts[0]-mirror[1]) }
        else gl.drawArrays(gl.TRIANGLES,0,counts[i]);
        if(i){ gl.disable(gl.BLEND); gl.depthMask(true) }
      }
    }
  };
}
