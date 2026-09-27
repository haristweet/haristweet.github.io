// オフラインで絵を描く道具（ソフトウェアの z バッファ）。PNG は node の zlib で書く。
function rasterNew(W,H,bg){
  const px=new Uint8Array(W*H*3), z=new Float32Array(W*H).fill(Infinity);
  for(let i=0;i<W*H;i++){ px[i*3]=bg[0]; px[i*3+1]=bg[1]; px[i*3+2]=bg[2] }
  return {W,H,px,z};
}
// 画面座標の三角形 (x,y,z)×3 を色 c で塗る。z は小さいほど手前
function rasterTri(R,a,b,c,col){
  const {W,H,px,z}=R;
  const x0=Math.max(0,Math.floor(Math.min(a[0],b[0],c[0]))), x1=Math.min(W-1,Math.ceil(Math.max(a[0],b[0],c[0])));
  const y0=Math.max(0,Math.floor(Math.min(a[1],b[1],c[1]))), y1=Math.min(H-1,Math.ceil(Math.max(a[1],b[1],c[1])));
  const d=(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  if(Math.abs(d)<1e-9) return;
  for(let y=y0;y<=y1;y++) for(let x=x0;x<=x1;x++){
    const px_=x+.5, py=y+.5;
    const w1=((px_-a[0])*(c[1]-a[1])-(py-a[1])*(c[0]-a[0]))/d, w2=((b[0]-a[0])*(py-a[1])-(b[1]-a[1])*(px_-a[0]))/d, w0=1-w1-w2;
    if(w0<-1e-6||w1<-1e-6||w2<-1e-6) continue;
    const zz=w0*a[2]+w1*b[2]+w2*c[2], i=y*W+x;
    if(zz<z[i]){ z[i]=zz; px[i*3]=col[0]; px[i*3+1]=col[1]; px[i*3+2]=col[2] }
  }
}
// 文字（5×7 の点）。数字と英大文字の一部だけ
const RASTER_FONT={"0":"0e 11 13 15 19 11 0e","1":"04 0c 04 04 04 04 0e","2":"0e 11 01 02 04 08 1f","3":"1f 02 04 02 01 11 0e","4":"02 06 0a 12 1f 02 02","5":"1f 10 1e 01 01 11 0e","6":"06 08 10 1e 11 11 0e","7":"1f 01 02 04 08 08 08","8":"0e 11 11 0e 11 11 0e","9":"0e 11 11 0f 01 02 0c"};
function rasterText(R,x,y,s,col,k=2){
  for(const ch of String(s)){
    const g=RASTER_FONT[ch];
    if(g){ const rows=g.replace(/ /g,"").match(/../g);
      rows.forEach((r,j)=>{ const v=parseInt(r,16); for(let i=0;i<5;i++) if(v>>(4-i)&1) for(let dy=0;dy<k;dy++) for(let dx=0;dx<k;dx++){
        const X=x+i*k+dx, Y=y+j*k+dy; if(X>=0&&Y>=0&&X<R.W&&Y<R.H){ const p=(Y*R.W+X)*3; R.px[p]=col[0]; R.px[p+1]=col[1]; R.px[p+2]=col[2] } } }) }
    x+=6*k;
  }
}
// 三角形を、頂点ごとの (s,t) を線形に補間して sample(s,t)→[r,g,b] で塗る。k は明るさ
function rasterTriTex(R,a,b,c,ta,tb,tc,sample,k){
  const {W,H,px,z}=R;
  const x0=Math.max(0,Math.floor(Math.min(a[0],b[0],c[0]))), x1=Math.min(W-1,Math.ceil(Math.max(a[0],b[0],c[0])));
  const y0=Math.max(0,Math.floor(Math.min(a[1],b[1],c[1]))), y1=Math.min(H-1,Math.ceil(Math.max(a[1],b[1],c[1])));
  const d=(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  if(Math.abs(d)<1e-9) return;
  for(let y=y0;y<=y1;y++) for(let x=x0;x<=x1;x++){
    const px_=x+.5, py=y+.5;
    const w1=((px_-a[0])*(c[1]-a[1])-(py-a[1])*(c[0]-a[0]))/d, w2=((b[0]-a[0])*(py-a[1])-(b[1]-a[1])*(px_-a[0]))/d, w0=1-w1-w2;
    if(w0<-1e-6||w1<-1e-6||w2<-1e-6) continue;
    const zz=w0*a[2]+w1*b[2]+w2*c[2], i=y*W+x;
    if(zz<z[i]){ z[i]=zz; if(R.onPix) R.onPix(i); const col=sample(w0*ta[0]+w1*tb[0]+w2*tc[0], w0*ta[1]+w1*tb[1]+w2*tc[1]);
      px[i*3]=Math.min(255,col[0]*k); px[i*3+1]=Math.min(255,col[1]*k); px[i*3+2]=Math.min(255,col[2]*k) }
  }
}
