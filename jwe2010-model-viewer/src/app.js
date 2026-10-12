// ページの操作。ディスク（形と絵）とステートセーブ（選手の表）を開く → 選手を選ぶ → その選手の顔と髪を描く
const VERSION="0.2.0";
const $=id=>document.getElementById(id);
const APP={drawSeq:0,file:null,disc:null,players:[],shown:[],cache:new Map(),view:{yaw:0,pitch:0.1,dist:3000,target:[0,0,0]},base:null,gl:null,cur:null};
function status(msg,err){ const s=$("status"); s.textContent=msg||""; s.className=err?"err":"" }
async function getFile(i){
  if(APP.cache.has(i)) return APP.cache.get(i);
  const u=await weFile(APP.file,APP.disc,i);
  if(APP.cache.size>40) APP.cache.delete(APP.cache.keys().next().value);
  APP.cache.set(i,u); return u;
}
// 共通の絵（目・耳・口、髪の地、頭の肌）。ディスクごとに 1 回だけ作る。読めなければ null
async function getCommon(){
  if(APP.common!==undefined) return APP.common;
  try{ const f={}; for(const [k,i] of Object.entries(JW_COMMON)) f[k]=await getFile(i); APP.common=jwCommonTextures(f) }
  catch(e){ console.warn("共通の絵が読めません",e); APP.common=null }
  return APP.common;
}
async function openDisc(file){
  status("ディスクを開いています…"); $("n-disc").textContent=file.name;
  try{
    const disc=await weOpen(file);
    Object.assign(APP,{file,disc,cache:new Map(),base:null,common:undefined});
    $("step-disc").classList.add("done"); $("anyfile").hidden=false; $("n-file").max=disc.ents.length-1;
    status(`${disc.from==="ISO"?"ISO の中の ":""}0_TEXT.AFS: ${disc.ents.length} 個のファイル`+(APP.players.length?"":"。次にステートセーブを選んでください"));
    if(APP.players.length) show(); else $("empty").textContent="ステートセーブを選ぶと、選手の一覧が出ます（「番号で見る」でファイルの中身も見られます）";
  }catch(e){ status(e.message,true); console.error(e) }
}
async function openSave(file){
  status("ステートセーブを読んでいます…"); $("n-save").textContent=file.name;
  try{
    const mem=await jwP2sMemory(file), players=jwPlayers(mem);
    APP.players=players; $("step-save").classList.add("done");
    $("q").value=""; fillPlayers(); $("pick").hidden=false;
    status(`選手 ${players.length} 人`+(APP.disc?"":"。次にディスクのイメージを選んでください"));
    show(); if(!APP.disc) $("empty").textContent="ディスクのイメージを選ぶと、顔と髪が出ます";
  }catch(e){ status(e.message,true); console.error(e) }
}
function openAny(file){ if(/\.p2s$/i.test(file.name)) openSave(file); else openDisc(file) }
// 名前で絞った一覧。表の順番（番号）も出す
function fillPlayers(){
  const q=$("q").value.trim().toLowerCase(), keep=$("s-player").value;
  APP.shown=APP.players.filter(p=>!q||p.name.toLowerCase().includes(q)||p.shirt.toLowerCase().includes(q));
  $("s-player").innerHTML=APP.shown.map(p=>`<option value="${p.i}">${p.i+1}. ${p.name.replace(/[&<]/g,c=>c==="&"?"&amp;":"&lt;")}</option>`).join("");
  if(APP.shown.some(p=>String(p.i)===keep)) $("s-player").value=keep;
}
// 描くものを決める: {kind:"player", p} か {kind:"file", n}
async function show(what){
  if(what) APP.cur=what;
  else{ const p=APP.players[+$("s-player").value]; if(!p) return; APP.cur={kind:"player",p} }
  const c=APP.cur, seq=++APP.drawSeq;
  if(!APP.disc){ $("info").textContent=c.kind==="player"?`${c.p.name}（${c.p.shirt}）・顔 #${c.p.face}・髪 #${c.p.hair}`:""; return }
  try{
    const ids=c.kind==="player"?[c.p.face,c.p.hair]:[c.n];
    const all=$("c-all").checked, ms=[], texs=[], warn=[]; let ntri=0;
    const us=[];
    for(const [k,i] of ids.entries()){
      if(i<0||i>=APP.disc.ents.length){ warn.push(`#${i} はディスクにありません`); us.push(null); continue }
      const u=await getFile(i);
      // 顔は MMT、髪は MTT の並び。違うときは描かずに知らせる（表の読み方が外れている印）
      if(c.kind==="player"){ const want=k?"MTT":"MMT", sig=weSig(u); if(sig!==want){ warn.push(`#${i} は${k?"髪":"顔"}のファイルではありません（並び ${sig||"-"}）`); us.push(null); continue } }
      us.push(u) }
    if(c.kind==="player"){
      // 部品ごとにゲームと同じ絵を貼る（jw.js）。共通の絵のファイルが読めないときは、前の描き方（顔の絵だけ）にする
      const common=await getCommon(), [fu,hu]=us;
      let r;
      if(fu&&common){ const h=jwHeadMeshes(fu,hu,common,all); r={meshes:h.meshes,texs:[...h.faceTexs.map(t=>({...t,from:c.p.face})),...h.hairTexs.map(t=>({...t,from:c.p.hair}))]} }
      else{ r={meshes:[],texs:[]};
        // 前の描き方（v0.1.3）: 顔の sel 2 を描かない。髪の sel 2 は α を使わずに塗る
        if(fu){ const f=weMeshes(fu,all,[2]); r.meshes.push(...f.meshes); r.texs.push(...f.texs.map(t=>({...t,from:c.p.face}))) }
        if(hu){ const back=weMeshes(hu,all,[0,1]), front=weMeshes(hu,all,[2]); back.meshes.forEach(m=>m.opaque=true); r.meshes.push(...back.meshes,...front.meshes); r.texs.push(...back.texs.map(t=>({...t,from:c.p.hair}))) } }
      ms.push(...r.meshes); ntri+=r.meshes.reduce((a,m)=>a+m.ntri,0);
      texs.push(...r.texs);
      if(common) texs.push(...[["8234（目・耳・口）",common.parts],["8226（髪の地）",common.back],["8231（頭の肌）",common.ring]].map(([n,t])=>({...t,from:n})));
      else warn.push("共通の絵（#8226・#8227・#8231・#8234）が読めないので、目・耳・後ろ髪は仮の描き方");
    }else{
      const u=us[0];
      if(u){ const r=weMeshes(u,all); ms.push(...r.meshes); ntri+=r.meshes.reduce((a,m)=>a+m.ntri,0); texs.push(...weFindTex(u).map(t=>({...t,from:ids[0]}))) } }
    if(seq!==APP.drawSeq) return;
    APP.gl.set(ms);
    // 見る位置: 形の箱の真ん中。大きさで距離を決める。選手を変えたときは同じ向きのまま
    const f0=ms.find(m=>m.f.length);
    if(f0&&(!APP.base||c.kind==="file")){ const mn=[1e9,1e9,1e9], mx=[-1e9,-1e9,-1e9];
      for(const m of ms) for(let k=0;k<m.f.length;k+=5) for(let j=0;j<3;j++){ mn[j]=Math.min(mn[j],m.f[k+j]); mx[j]=Math.max(mx[j],m.f[k+j]) }
      APP.base={target:mn.map((v,j)=>(v+mx[j])/2),h:Math.max(mx[0]-mn[0],mx[1]-mn[1])}; resetCam() }
    $("empty").hidden=!!f0; if(!f0) $("empty").textContent=warn.join("・")||`#${ids.join("・")} には形がありません（絵だけ、またはまだ読めない中身）`;
    $("hint").hidden=!f0; $("savebar").hidden=!f0;
    $("info").textContent=(c.kind==="player"?`${c.p.name}（${c.p.shirt||"-"}）・顔 #${c.p.face}・髪 #${c.p.hair}`:`#${c.n}（並び ${weSig(await getFile(c.n))||"-"}）`)
      +`・三角形 ${ntri}・絵 ${texs.length} 枚`+(warn.length?"・"+warn.join("・"):"");
    showTexs(texs); draw();
  }catch(e){ status(e.message,true); console.error(e) }
}
function showTexs(texs){
  const box=$("texs"); box.innerHTML="";
  for(const t of texs){ const fig=document.createElement("figure"), cv=document.createElement("canvas"); cv.width=t.W; cv.height=t.H;
    if(t.rgba){ const im=new ImageData(new Uint8ClampedArray(t.rgba),t.W,t.H); cv.getContext("2d").putImageData(im,0,0) }
    cv.style.width=Math.min(160,t.W*(t.W<=64?2:1))+"px";
    fig.append(cv,`#${t.from} ${t.W}×${t.H}${t.rgba?"":"（まだ読めない形式）"}`); box.append(fig) }
}
function resetCam(){ if(!APP.base) return; Object.assign(APP.view,{yaw:0,pitch:0.1,target:APP.base.target.slice(),dist:APP.base.h*2.6}); draw() }
function draw(){ if(APP.gl) APP.gl.draw(APP.view,$("c-clear").checked?[0,0,0,0]:null) }
function step(sel,d){ const o=sel.options; if(!o.length) return; sel.selectedIndex=(sel.selectedIndex+d+o.length)%o.length; sel.onchange() }
function savePng(){
  APP.gl.draw(APP.view,$("c-clear").checked?[0,0,0,0]:[0.17,0.165,0.15,1]);
  $("cv").toBlob(b=>{ const a=document.createElement("a"); a.href=URL.createObjectURL(b); const c=APP.cur;
    a.download=c.kind==="player"?`jwe2010_${c.p.shirt||c.p.i}_face${c.p.face}_hair${c.p.hair}.png`:`jwe2010_${c.n}.png`; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),5000); draw() },"image/png");
}
function init(){
  $("ver-h").textContent="v"+VERSION; $("ver").textContent="版 "+VERSION;
  try{ APP.gl=weGL($("cv")) }catch(e){ status(e.message,true) }
  if(typeof DecompressionStream==="undefined") status("このブラウザはファイルの展開に必要な機能に対応していません。iPhone は iOS 16.4 以降にしてください",true);
  $("f-disc").onchange=e=>{ const f=e.target.files[0]; if(f) openDisc(f) };
  $("f-save").onchange=e=>{ const f=e.target.files[0]; if(f) openSave(f) };
  $("s-player").onchange=()=>show();
  $("q").oninput=()=>{ fillPlayers(); if(APP.shown.length&&(APP.cur?.kind!=="player"||String(APP.cur.p.i)!==$("s-player").value)) show() };
  $("p-prev").onclick=()=>step($("s-player"),-1); $("p-next").onclick=()=>step($("s-player"),1);
  $("b-rand").onclick=()=>{ const o=$("s-player").options; if(!o.length) return; $("s-player").selectedIndex=Math.floor(Math.random()*o.length); show() };
  $("b-file").onclick=()=>{ if(APP.disc) show({kind:"file",n:Math.max(0,Math.min(APP.disc.ents.length-1,+$("n-file").value|0))}) };
  $("n-file").onkeydown=e=>{ if(e.key==="Enter") $("b-file").click() };
  $("c-all").onchange=()=>show(APP.cur);
  $("b-png").onclick=savePng; $("c-clear").onchange=draw;
  // 回す・寄る
  const cv=$("cv"), pts=new Map(); let pinch=0;
  const zoom=k=>{ if(APP.base) APP.view.dist=Math.max(APP.base.h*0.3,Math.min(APP.base.h*20,APP.view.dist*k)); draw() };
  cv.addEventListener("pointerdown",e=>{ cv.setPointerCapture(e.pointerId); pts.set(e.pointerId,[e.clientX,e.clientY]) });
  cv.addEventListener("pointermove",e=>{ if(!pts.has(e.pointerId)) return; const [x,y]=pts.get(e.pointerId); pts.set(e.pointerId,[e.clientX,e.clientY]);
    if(pts.size===2){ const [a,b]=[...pts.values()], d=Math.hypot(a[0]-b[0],a[1]-b[1]); if(pinch) zoom(pinch/d); pinch=d; return }
    APP.view.yaw+=(e.clientX-x)*0.01; APP.view.pitch=Math.max(-1.5,Math.min(1.5,APP.view.pitch+(e.clientY-y)*0.01)); draw() });
  const up=e=>{ pts.delete(e.pointerId); if(pts.size<2) pinch=0 };
  cv.addEventListener("pointerup",up); cv.addEventListener("pointercancel",up);
  cv.addEventListener("wheel",e=>{ e.preventDefault(); zoom(Math.exp(e.deltaY*0.001)) },{passive:false});
  cv.addEventListener("dblclick",resetCam);
  const vw=$("viewer");
  document.addEventListener("dragover",e=>{ e.preventDefault(); vw.classList.add("drop-over") });
  document.addEventListener("dragleave",e=>{ if(!e.relatedTarget) vw.classList.remove("drop-over") });
  document.addEventListener("drop",e=>{ e.preventDefault(); vw.classList.remove("drop-over"); for(const f of e.dataTransfer.files) openAny(f) });
  addEventListener("resize",draw);
}
init();
