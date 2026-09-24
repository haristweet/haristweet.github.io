// 画面と同じ背景（中心が明るい円形のグラデーション）を、キャンバス全体の中の (ox,oy) から切り出す位置で塗る
function paintBackground(g,W,H,ox,oy,w,h){
  const st=getComputedStyle(document.documentElement), cx=W/2-ox, cy=H*.35-oy, grd=g.createRadialGradient(cx,cy,0,cx,cy,Math.max(W,H)*.7);
  grd.addColorStop(0,st.getPropertyValue("--stage2").trim()||"#3a3834"); grd.addColorStop(1,st.getPropertyValue("--stage").trim()||"#2a2926");
  g.fillStyle=grd; g.fillRect(0,0,w,h);
}
// 描いたキャンバスで不透明な画素の範囲（キャラのいる所）。box があれば広げる
const probe=document.createElement("canvas"), probeG=probe.getContext("2d",{willReadFrequently:true});
function opaqueBox(box){
  const W=canvas.width, H=canvas.height; probe.width=W; probe.height=H; probeG.clearRect(0,0,W,H); probeG.drawImage(canvas,0,0);
  const d=probeG.getImageData(0,0,W,H).data;
  let x0=W,y0=H,x1=-1,y1=-1;
  for(let y=0;y<H;y+=2){ const row=y*W; for(let x=0;x<W;x+=2) if(d[(row+x)*4+3]>8){ if(x<x0)x0=x; if(x>x1)x1=x; if(y<y0)y0=y; if(y>y1)y1=y } }
  if(x1<0) return box;
  x1=Math.min(W,x1+2); y1=Math.min(H,y1+2);
  return box?{x0:Math.min(box.x0,x0),y0:Math.min(box.y0,y0),x1:Math.max(box.x1,x1),y1:Math.max(box.y1,y1)}:{x0,y0,x1,y1};
}
// 範囲に余白を足し、偶数の大きさにそろえる（動画の符号化で奇数が嫌われるため）
function padBox(b){
  const W=canvas.width, H=canvas.height, m=Math.round(Math.max(b.x1-b.x0,b.y1-b.y0)*.04)+4;
  let x0=Math.max(0,b.x0-m), y0=Math.max(0,b.y0-m), x1=Math.min(W,b.x1+m), y1=Math.min(H,b.y1+m);
  if((x1-x0)%2) x1<W?x1++:x0--; if((y1-y0)%2) y1<H?y1++:y0--;
  return {x:x0,y:y0,w:x1-x0,h:y1-y0};
}
$("shot").onclick=()=>{
  draw();
  const W=canvas.width, H=canvas.height, r=$("shot-crop").checked?padBox(opaqueBox(null)||{x0:0,y0:0,x1:W,y1:H}):{x:0,y:0,w:W,h:H};
  const out=document.createElement("canvas"); out.width=r.w; out.height=r.h;
  const g=out.getContext("2d");
  if(!$("shot-clear").checked) paintBackground(g,W,H,r.x,r.y,r.w,r.h);
  g.drawImage(canvas,r.x,r.y,r.w,r.h,0,0,r.w,r.h);
  out.toBlob(b=>saveBlob(b,fileBase(true)+".png"),"image/png");
};
