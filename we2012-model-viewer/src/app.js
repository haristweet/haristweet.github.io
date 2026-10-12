// 番号の並びのうち、続き番号のいちばん長い一続き。本物では MMT が #1521〜#3120 の 1600 個、MTT が #3588〜#5187 の 1600 個と
// #6233〜#6243 の 11 個（髪ではない形。肩まである大きな形と白い布の絵）に分かれたので、長い方を顔・髪とする
function weLongestRun(list){
  const s=[...list].sort((a,b)=>a-b); let best=[0,0], st=0;
  for(let i=1;i<=s.length;i++) if(i===s.length||s[i]!==s[i-1]+1){ if(i-st>best[1]-best[0]) best=[st,i]; st=i }
  return s.slice(best[0],best[1]);
}
// ページの操作。開く → 全ファイルをほどいて顔・髪の一覧を作る（順に増える）→ 選んで描く
const VERSION="0.1.2";
const $=id=>document.getElementById(id);
const APP={drawSeq:0,file:null,disc:null,faces:[],hairs:[],mmt:[],mtt:[],cache:new Map(),view:{yaw:0,pitch:0.1,dist:3000,target:[0,0,0]},base:null,seq:0,gl:null,cur:null};
function status(msg,err){ const s=$("status"); s.textContent=msg||""; s.className=err?"err":"" }
async function getFile(i){
  if(APP.cache.has(i)) return APP.cache.get(i);
  const u=await weFile(APP.file,APP.disc,i);
  if(APP.cache.size>40) APP.cache.delete(APP.cache.keys().next().value);
  APP.cache.set(i,u); return u;
}
async function openDisc(file){
  APP.seq++; const seq=APP.seq;
  status("開いています…"); $("n-disc").textContent=file.name;
  try{
    const disc=await weOpen(file);
    Object.assign(APP,{file,disc,faces:[],hairs:[],mmt:[],mtt:[],cache:new Map(),base:null,hairPicked:false,cur:null});
    $("step-disc").classList.add("done"); $("empty").textContent="中身を調べています…";
    $("anyfile").hidden=false; $("n-file").max=disc.ents.length-1;
    status(`${disc.from==="ISO"?"ISO の中の ":""}0_TEXT.AFS: ${disc.ents.length} 個のファイル`);
    await scan(seq);
  }catch(e){ status(e.message,true); console.error(e) }
}
// 全ファイルをほどいて並び（weSig）を見る。6 つずつ同時に。一覧は 200 個ごとに作り直す
async function scan(seq){
  const n=APP.disc.ents.length; let next=0, done=0;
  $("scan").hidden=false; $("p-scan").max=n;
  const refreshLists=()=>{ fillSelect($("s-face"),APP.faces,"顔"); fillSelect($("s-hair"),APP.hairs,"髪",true);
    if(APP.faces.length&&$("pick").hidden){ $("pick").hidden=false; $("s-face").value=APP.faces[0]; show() }
    // 髪は顔より後ろの番号にあるので、見つかったら同じ順番の髪を付ける（まだ手で選んでいなければ）
    if(!APP.hairPicked&&$("c-link").checked&&$("s-hair").value===""&&APP.cur?.kind==="pair"){ const k=APP.faces.indexOf(APP.cur.face); if(APP.hairs[k]!==undefined){ $("s-hair").value=APP.hairs[k]; show() } } };
  const work=async()=>{ while(next<n&&seq===APP.seq){ const i=next++;
      let sig=""; try{ const e=APP.disc.ents[i]; if(e.size) sig=weSig(await weFile(APP.file,APP.disc,i)) }catch(e){}
      if(sig==="MMT") APP.mmt.push(i); else if(sig==="MTT") APP.mtt.push(i);
      if(++done%200===0||done===n){ APP.faces=weLongestRun(APP.mmt); APP.hairs=weLongestRun(APP.mtt); $("p-scan").value=done; $("t-scan").textContent=`${done}/${n}・顔 ${APP.faces.length}・髪 ${APP.hairs.length}`; refreshLists() } } };
  await Promise.all(Array.from({length:6},work));
  if(seq!==APP.seq) return;
  $("scan").hidden=true;
  const other=[...APP.mmt.filter(i=>!APP.faces.includes(i)),...APP.mtt.filter(i=>!APP.hairs.includes(i))].sort((a,b)=>a-b);
  status(`0_TEXT.AFS: ${n} 個のファイル・顔 ${APP.faces.length}・髪 ${APP.hairs.length}`+(other.length?`（同じ並びで一覧から外したもの ${other.length} 個: #${other.join("・#")}。番号で見られます）`:""));
  if(!APP.faces.length){ $("empty").textContent="顔が見つかりませんでした（「番号で見る」で中身を見られます）"; }
}
function fillSelect(sel,list,word,none){
  const keep=sel.value, html=(none?['<option value="">なし</option>']:[]).concat(list.map((i,k)=>`<option value="${i}">${word} ${k+1}（#${i}）</option>`));
  if(sel.options.length!==html.length){ sel.innerHTML=html.join(""); if(keep!=="") sel.value=keep }
}
// 描くものを決める: {kind:"pair", face, hair} か {kind:"file", n}
async function show(what){
  if(what) APP.cur=what; else APP.cur={kind:"pair",face:+$("s-face").value,hair:$("s-hair").value===""?null:+$("s-hair").value};
  const c=APP.cur, seq=++APP.drawSeq;
  try{
    const ids=c.kind==="pair"?[c.face,c.hair].filter(x=>x!==null&&!isNaN(x)):[c.n];
    const all=$("c-all").checked, ms=[], texs=[]; let ntri=0;
    for(const i of ids){ const u=await getFile(i), r=weMeshes(u,all); ms.push(...r.meshes); ntri+=r.meshes.reduce((a,m)=>a+m.ntri,0);
      // 番号で見るときは入れ子の中の絵も全部出す
      texs.push(...(c.kind==="file"?weFindTex(u):r.texs).map(t=>({...t,from:i}))) }
    if(seq!==APP.drawSeq) return;
    APP.gl.set(ms);
    // 見る位置: 最初の形（顔）の箱の真ん中。大きさで距離を決める
    const f0=ms.find(m=>m.f.length);
    if(f0&&(!APP.base||c.kind==="file")){ const mn=[1e9,1e9,1e9], mx=[-1e9,-1e9,-1e9];
      for(const m of ms) for(let k=0;k<m.f.length;k+=5) for(let j=0;j<3;j++){ mn[j]=Math.min(mn[j],m.f[k+j]); mx[j]=Math.max(mx[j],m.f[k+j]) }
      APP.base={target:mn.map((v,j)=>(v+mx[j])/2),h:Math.max(mx[0]-mn[0],mx[1]-mn[1])}; resetCam() }
    $("empty").hidden=!!f0; if(!f0) $("empty").textContent=`#${ids.join("・")} には形がありません（絵だけ、またはまだ読めない中身）`;
    $("hint").hidden=!f0; $("savebar").hidden=!f0;
    $("info").textContent=(c.kind==="pair"?`顔 #${c.face}${c.hair!==null?"・髪 #"+c.hair:""}`:`#${c.n}（並び ${weSig(await getFile(c.n))||"-"}）`)+`・三角形 ${ntri}・絵 ${texs.length} 枚`;
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
    a.download=c.kind==="pair"?`we2012_face${c.face}${c.hair!==null?"_hair"+c.hair:""}.png`:`we2012_${c.n}.png`; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),5000); draw() },"image/png");
}
function init(){
  $("ver-h").textContent="v"+VERSION; $("ver").textContent="版 "+VERSION;
  try{ APP.gl=weGL($("cv")) }catch(e){ status(e.message,true) }
  if(typeof DecompressionStream==="undefined") status("このブラウザはファイルの展開に必要な機能に対応していません。iPhone は iOS 16.4 以降にしてください",true);
  $("f-disc").onchange=e=>{ const f=e.target.files[0]; if(f) openDisc(f) };
  $("s-face").onchange=()=>{ if($("c-link").checked){ const k=APP.faces.indexOf(+$("s-face").value); if(APP.hairs[k]!==undefined) $("s-hair").value=APP.hairs[k] } show() };
  $("s-hair").onchange=()=>{ APP.hairPicked=true; show() };
  $("f-prev").onclick=()=>step($("s-face"),-1); $("f-next").onclick=()=>step($("s-face"),1);
  $("h-prev").onclick=()=>step($("s-hair"),-1); $("h-next").onclick=()=>step($("s-hair"),1);
  $("b-rand").onclick=()=>{ const r=n=>Math.floor(Math.random()*n); if(!APP.faces.length) return; $("s-face").value=APP.faces[r(APP.faces.length)]; $("s-face").onchange() };
  $("b-file").onclick=()=>show({kind:"file",n:Math.max(0,Math.min(APP.disc.ents.length-1,+$("n-file").value|0))});
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
  document.addEventListener("drop",e=>{ e.preventDefault(); vw.classList.remove("drop-over"); const f=e.dataTransfer.files[0]; if(f) openDisc(f) });
  addEventListener("resize",draw);
}
init();
