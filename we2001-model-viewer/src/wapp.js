// 画面の組み立て
const VERSION="0.1.0";
const $=id=>document.getElementById(id);
// 体の組（MODEL.BIN の先頭の 18 個。0,1 は球）。名前は絵で見た印象（推測）。2・3・16・17 は服の色の表がディスクのどこから来るかまだ分からず、服が抜ける
const WE_SETS=[[6,"フィールド・半袖"],[8,"フィールド・長袖"],[12,"フィールド・半袖 2"],[14,"フィールド・長袖 2"],[7,"フィールド 3"],[9,"フィールド 4"],[13,"フィールド 5"],[15,"フィールド 6"],
  [4,"キーパー"],[10,"キーパー 2"],[5,"キーパー 3"],[11,"キーパー 4"],[2,"組 2（服が抜ける）"],[3,"組 3（服が抜ける）"],[16,"組 16（服が抜ける）"],[17,"組 17（服が抜ける）"]];
// TEX_xx の札のうち、1 着目・2 着目に使うもの（同じ VRAM の場所へ置く札が 2 組ある。どちらがホームかは確かめていない）
const WE_KIT_REC=[new Set([0,1,4,7,8,9,11]),new Set([2,3,5,7,8,10,11])];
const WE_FPS=30;   // 推測
const APP={files:null, model:null, anime:null, dat2d:null, texFiles:new Map(), tmds:new Map(), gl:null, atlasKey:"", slot:null,
  view:{yaw:0,pitch:0.08,dist:1400,target:[0,0,0],fov:30}, base:null, playing:false, last:0};
function status(msg,err){ const s=$("status"); s.textContent=msg||""; s.className=err?"err":"" }
async function readFile(name){ const f=APP.files.get(name); if(!f) throw new Error(name+" がディスクに無い（ウイニングイレブン2001 のディスクではない？）"); return f() }
function tmdAt(off){ if(!APP.tmds.has(off)) APP.tmds.set(off,tmdRead(APP.model,off)); return APP.tmds.get(off) }
async function openDisc(file){
  try{
    status("ディスクを開いています…"); $("n-disc").textContent=file.name;
    APP.files=await discOpen(file);
    status("モデルと動きを読んでいます…");
    APP.model=await readFile("BIN/MODEL.BIN"); APP.anime=await readFile("BIN/ANIME.BIN"); APP.dat2d=await readFile("BIN/DAT2D.BIN");
    APP.tmds.clear(); APP.texFiles.clear(); APP.atlasKey="";
    const kits=[...APP.files.keys()].filter(n=>/^BIN\/TEX_\d+\.BIN$/.test(n)).sort();
    $("s-kit").innerHTML=kits.map(n=>`<option value="${n}">${n.slice(4,-4).replace("TEX_","")}</option>`).join("");
    $("s-set").innerHTML=WE_SETS.map(([k,n])=>`<option value="${k}">${n}</option>`).join("");
    $("s-hair").innerHTML=Array.from({length:32},(_,i)=>`<option value="${i}">${i}</option>`).join("");
    $("step-disc").classList.add("done"); $("pick").hidden=false; $("motion").hidden=false; $("empty").hidden=true; $("hint").hidden=false;
    APP.base=null; await refresh(true); status("");
  }catch(e){ console.error(e); status("読めなかった: "+e.message,true) }
}
function cur(){ return {kit:$("s-kit").value, alt:+$("s-alt").value, set:+$("s-set").value, head:+$("s-hair").value*2+($("c-beard").checked?1:0),
  anim:Math.max(0,Math.min(203,+$("m-num").value|0)), frame:+$("m-frame").value} }
async function loadAtlas(c,used){
  const key=c.kit+"|"+c.alt+"|"+used.join(";"); if(key===APP.atlasKey) return;
  if(!APP.texFiles.has(c.kit)) APP.texFiles.set(c.kit,await readFile(c.kit));
  const vram=weVramNew(); weTexLoadRun(vram,APP.dat2d,WE_TEX_BASE,0); weTexLoadRun(vram,APP.dat2d,WE_TEX_BASE,1);
  weTexLoad(vram,APP.texFiles.get(c.kit),WE_TEX_BASE,WE_KIT_REC[c.alt]);
  const a=weAtlas(vram,used); APP.gl.setAtlas(a.px); APP.slot=a.slot; APP.atlasKey=key;
}
// 動きの番号が変わったらコマの数を数え直す
function setAnim(){
  const c=cur(), n=weAnimFrames(APP.anime,c.anim), r=$("m-frame");
  r.max=Math.max(0,n-1); if(+r.value>n-1) r.value=0; APP.nFrames=n;
}
async function refresh(resetView){
  if(!APP.model) return;
  const c=cur(); if(APP.nFrames==null||resetView) setAnim();
  if(!APP.nFrames){ $("m-fn").textContent="この番号にはコマが無い"; return }
  const parts=wePose(APP.model,APP.anime,c.set,c.head,c.anim,+$("m-frame").value), tm=new Map(parts.map(p=>[p.off,tmdAt(p.off)]));
  const light=[0.35,-0.6,0.7], first=weTris(tm,parts,null,light);
  await loadAtlas(c,first.used);
  const {tris}=weTris(tm,parts,APP.slot,light); APP.gl.setTris(tris);
  if(!APP.base||resetView){ // 立ち姿（動き 0 のコマ 0）の大きさで、見る所と距離を決める
    const p0=wePose(APP.model,APP.anime,c.set,c.head,0,0), b=weTris(new Map(p0.map(p=>[p.off,tmdAt(p.off)])),p0,null,light).tris, mn=[1e9,1e9,1e9], mx=[-1e9,-1e9,-1e9];
    for(let i=0;i<b.length;i+=6) for(let k=0;k<3;k++){ mn[k]=Math.min(mn[k],b[i+k]); mx[k]=Math.max(mx[k],b[i+k]) }
    APP.base={target:mn.map((v,k)=>(v+mx[k])/2), h:mx[1]-mn[1]};
    if(resetView) resetCam();
  }
  $("m-fn").textContent=`${+$("m-frame").value+1} / ${APP.nFrames}`;
  $("info").textContent=`ユニフォーム ${c.kit.slice(4,-4)}（${c.alt+1} 着目）・体の組 ${c.set}・頭 ${c.head}・動き ${c.anim}・面 ${tris.length/18|0}`;
  draw();
}
function resetCam(){ Object.assign(APP.view,{yaw:0,pitch:0.08,target:APP.base.target.slice(),dist:APP.base.h*2.6}); draw() }
function draw(){ if(APP.gl) APP.gl.draw(APP.view,$("c-clear").checked?[0,0,0,0]:null) }
function play(on){
  APP.playing=on; $("m-play").textContent=on?"■ 止める":"▶ 再生";
  if(on){ APP.last=performance.now(); requestAnimationFrame(tick) }
}
function tick(t){
  if(!APP.playing) return;
  if(t-APP.last>=1000/WE_FPS){ APP.last=t; const r=$("m-frame"); r.value=(+r.value+1)%(APP.nFrames||1); refresh(false) }
  requestAnimationFrame(tick);
}
function stepAnim(d){ const e=$("m-num"); e.value=(Math.max(0,Math.min(203,+e.value|0))+d+204)%204; $("m-frame").value=0; setAnim(); refresh(false) }
function savePng(){
  APP.gl.draw(APP.view,$("c-clear").checked?[0,0,0,0]:[0.17,0.165,0.15,1]);
  $("cv").toBlob(b=>{ const a=document.createElement("a"); a.href=URL.createObjectURL(b); const c=cur();
    a.download=`we2001_${c.kit.slice(8,-4)}_${c.alt+1}_${c.set}_${c.head}_${c.anim}_${c.frame+1}.png`; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),5000); draw() },"image/png");
}
function randomPick(){
  const r=n=>Math.floor(Math.random()*n), sk=$("s-kit");
  sk.selectedIndex=r(sk.options.length); $("s-alt").value=r(2); $("s-set").value=[6,8,12,14][r(4)]; $("s-hair").value=r(32); $("c-beard").checked=Math.random()<.3;
  refresh(false);
}
function init(){
  $("ver-h").textContent="v"+VERSION; $("ver").textContent="版 "+VERSION;
  try{ APP.gl=weGL($("cv")) }catch(e){ status(e.message,true) }
  $("f-disc").onchange=e=>{ const f=e.target.files[0]; if(f) openDisc(f) };
  for(const id of ["s-kit","s-alt","s-set","s-hair","c-beard"]) $(id).onchange=()=>refresh(false);
  $("m-num").onchange=()=>{ $("m-frame").value=0; setAnim(); refresh(false) };
  $("m-prev").onclick=()=>stepAnim(-1); $("m-next").onclick=()=>stepAnim(1);
  $("m-frame").oninput=()=>refresh(false);
  $("m-play").onclick=()=>play(!APP.playing);
  $("b-png").onclick=savePng; $("c-clear").onchange=draw; $("b-rand").onclick=randomPick;
  // 回す・寄る
  const cv=$("cv"), pts=new Map(); let pinch=0;
  cv.addEventListener("pointerdown",e=>{ cv.setPointerCapture(e.pointerId); pts.set(e.pointerId,[e.clientX,e.clientY]) });
  cv.addEventListener("pointermove",e=>{ if(!pts.has(e.pointerId)) return; const [x,y]=pts.get(e.pointerId); pts.set(e.pointerId,[e.clientX,e.clientY]);
    if(pts.size===2){ const [a,b]=[...pts.values()], d=Math.hypot(a[0]-b[0],a[1]-b[1]); if(pinch) APP.view.dist=Math.max(200,Math.min(8000,APP.view.dist*pinch/d)); pinch=d; draw(); return }
    APP.view.yaw+=(e.clientX-x)*0.01; APP.view.pitch=Math.max(-1.5,Math.min(1.5,APP.view.pitch+(e.clientY-y)*0.01)); draw() });
  const up=e=>{ pts.delete(e.pointerId); if(pts.size<2) pinch=0 };
  cv.addEventListener("pointerup",up); cv.addEventListener("pointercancel",up);
  cv.addEventListener("wheel",e=>{ e.preventDefault(); APP.view.dist=Math.max(200,Math.min(8000,APP.view.dist*Math.exp(e.deltaY*0.001))); draw() },{passive:false});
  cv.addEventListener("dblclick",()=>{ if(APP.base) resetCam() });
  // ドロップ
  const vw=$("viewer");
  document.addEventListener("dragover",e=>{ e.preventDefault(); vw.classList.add("drop-over") });
  document.addEventListener("dragleave",e=>{ if(!e.relatedTarget) vw.classList.remove("drop-over") });
  document.addEventListener("drop",e=>{ e.preventDefault(); vw.classList.remove("drop-over"); const f=e.dataTransfer.files[0]; if(f) openDisc(f) });
  document.addEventListener("keydown",e=>{ if(!APP.model||/INPUT|SELECT/.test(document.activeElement?.tagName)&&document.activeElement.type!=="range") return;
    const r=$("m-frame");
    if(e.key==="ArrowRight"){ r.value=Math.min(+r.max,+r.value+1); refresh(false) } else if(e.key==="ArrowLeft"){ r.value=Math.max(0,+r.value-1); refresh(false) }
    else if(e.key===" "){ e.preventDefault(); play(!APP.playing) } });
  addEventListener("resize",draw);
}
init();
