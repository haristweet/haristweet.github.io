// 画面の組み立て（VF2 の vapp.js を元に、FV のモデルの選び方とアーケードのテクスチャに合わせたもの）
const VERSION="0.2.0";
const $=id=>document.getElementById(id);
const APP={disc:null, objCache:new Map(), rom:null, states:[], cur:-1, scene:null, gl:null, rot:[0,0], zoom:1, pan:[0,0]};
function status(msg,err){ const s=$("status"); s.textContent=msg||""; s.className=err?"err":"" }
async function readDec(name){ const f=APP.disc.get(name); if(!f) throw new Error(name+" がディスクに無い"); return cricmpUnpack(await f()) }
async function readObj(name){
  if(!APP.objCache.has(name)){ const f=APP.disc.get(name); if(!f) return null; APP.objCache.set(name,new Map(objModels(cricmpUnpack(await f())).map(e=>[e.id,e]))) }
  return APP.objCache.get(name);
}
// モデル: 人ごとに、描いた番号をいちばん多く含む OBJ_ROBnn（＋同じ番号の R・共通 OBJ_COMMON）。背景は、1P の表のうちキャラに無い番号をいちばん多く含む OBJ_STGnn
async function chooseModels(sc){
  const names=[...APP.disc.keys()], best=async(ids,re)=>{ let b=[null,0]; for(const n of names.filter(n=>re.test(n)).sort()){ const m=await readObj(n), k=ids.filter(i=>m.has(i)).length; if(k>b[1]) b=[n,k] } return b[0] };
  const models={}, used=[], common=await readObj("OBJ_COMMON.CMP");
  for(const p of [0,1]){ const f=await best(sc.draws.filter(d=>d.player===p).map(d=>d.id),/^OBJ_ROB\d+\.CMP$/); used.push(f); if(!f){ models[p]=new Map(); continue }
    const m=new Map(await readObj(f)), r=await readObj(f.replace(".CMP","R.CMP")); if(r) for(const [k,v] of r) if(!m.has(k)) m.set(k,v);
    if(common) for(const [k,v] of common) if(!m.has(k)) m.set(k,v); models[p]=m }
  const f=await best(sc.draws.filter(d=>d.player===0&&!models[0].has(d.id)).map(d=>d.id),/^OBJ_STG\d+R?\.CMP$/); used.push(f);
  if(f){ models.stage=new Map(await readObj(f)); const r=await readObj(f.replace(/R?\.CMP$/,"R.CMP")); if(r) for(const [k,v] of r) if(!models.stage.has(k)) models.stage.set(k,v) }
  return {models,names:used};
}
// アーケードのテクスチャ（fvarc.js）: 共通のセット 36、キャラ OBJ_ROBnn はセット 2n+1・2n+2（2P の色 nn≥13 は nn−13）で 2P はページを入れ替え、ステージ OBJ_STGnn はセット 18＋n。
// （写しの PS2 のテクスチャ用メモリと一致するセットはこれだけ。grace・bahn・picky で確かめた）
// キャラは RAM の縦 0〜1023、ステージは 1024〜1535 だけ使い（セットは段の小さい版などほかの所にも書く）、ロムで書いた所は値＋128
async function arcPages(names){
  if(!APP.rom){ status("アーケードのテクスチャを展開中…"); APP.rom={prog:await readDec("ROM_CODE1.CMP"), data:await readDec("ROM_DATA.CMP")} }
  const LC=fvArcLoader(APP.rom.prog,APP.rom.data), LS=fvArcLoader(APP.rom.prog,APP.rom.data);
  LC.loadSet(36,0);   // どの写しにも載っている共通のセット（ページ1）
  names.slice(0,2).forEach((f,pl)=>{ if(!f) return; let n=+f.match(/ROB(\d+)/)[1]; if(n>=13) n-=13; LC.loadSet(2*n+1,pl); LC.loadSet(2*n+2,pl) });
  if(names[2]) LS.loadSet(18+(+names[2].match(/STG(\d+)/)[1]),0);
  return [0,1].map(p=>{ const o=new Uint8Array(1024*2048);
    for(let y=0;y<1536;y++){ const src=y<1024?LC:LS;
      for(let x=0;x<1024;x++){ const h=(y>>1)*512+(x>>1); if(src.mask[p][h]) o[y*1024+x]=128|arcTexel(src.tex[p],x,y) } }
    return o });
}
// ミップマップの小さい版（段 1〜3）を元の大きさの版から作る（VF2 の vapp.js と同じ）。ロムで作った所（値＋128）だけ。ほかは 255（小さい版なし）
function arcMips(pages){
  const o=new Uint8Array(2048*2048).fill(255), place=[null,[512,0],[256,1024],[128,1536]];
  for(const p of [0,1]) for(let l=1;l<=3;l++){ const sc=1<<l, W=1024>>l, H=2048>>l, [ox,oy]=[place[l][0]*p,place[l][1]];
    for(let y=0;y<H;y++) for(let x=0;x<W;x++){ let n=0,tr=0,sum=0,ok=true;
      for(let dy=0;dy<sc&&ok;dy++) for(let dx=0;dx<sc;dx++){ const v=pages[p][(y*sc+dy)*1024+x*sc+dx]; if(v<128){ ok=false; break } n++; if((v&15)===15) tr++; else sum+=v&15 }
      if(ok) o[(oy+y)*2048+ox+x]=tr*2>=n?15:Math.round(sum/(n-tr)) } }
  return o;
}
async function show(){
  const st=APP.states[APP.cur]; if(!st||!APP.disc) return;
  try{
    status("読み込み中…");
    if(!st.mem){ st.mem=await st.zip.get("eeMemory.bin")(); const v1=st.zip.get("vu1Memory.bin"); st.vu1=v1?await v1():null; const sh=st.zip.get("Screenshot.png"); if(sh) st.shot=URL.createObjectURL(new Blob([await sh()],{type:"image/png"})) }
    const sc=sceneRead(st.mem), col=sceneColors(st.mem), light=sceneLight(st.vu1,sc), {models,names}=await chooseModels(sc);
    APP.scene={sc,col,light,models,names};
    if(!st.arc){ st.arc=await arcPages(names); st.arcMip=arcMips(st.arc) }
    APP.gl.setColors(col); APP.gl.setArc(st.arc,st.arcMip);
    $("shot").src=st.shot||""; $("shot").hidden=!st.shot;
    $("empty").hidden=true; $("hint").hidden=false; status(""); rebuild(); resetView();
  }catch(e){ console.error(e); status("読めなかった: "+e.message,true) }
}
function rebuild(){
  const S=APP.scene; if(!S) return;
  const o={players:[$("c-p1").checked,$("c-p2").checked],stage:$("c-stage").checked,light:S.light};
  const body=sceneMesh(S.sc,S.col,S.models,{...o,which:"body"}), shadow=$("c-shadow").checked?sceneMesh(S.sc,S.col,S.models,{...o,which:"shadow"}):null;
  APP.gl.setMesh(body,shadow);
  const nm=n=>n?n.replace(".CMP",""):"なし";
  $("info").textContent=`1P ${nm(S.names[0])}・2P ${nm(S.names[1])}・背景 ${nm(S.names[2])}　部品 ${S.sc.draws.length} 個（うち影 ${body.shadows}）　三角形 ${(body.count+(shadow?shadow.count:0))/3}`+(body.missing.length?`　ファイルに無い番号 ${body.missing.length} 個`:"");
  draw();
}
// 視点: ゲームのカメラの座標のまま、2人の真ん中を中心に回す
function center(){
  const S=APP.scene; let s=[0,0,0],n=0;
  for(const x of S.sc.draws){ const m=x.m; if(Math.abs(m[4])<0.05||!S.models[x.player]||!S.models[x.player].has(x.id)) continue; s[0]+=m[9]; s[1]+=m[10]; s[2]+=m[11]; n++ }
  return n?s.map(v=>v/n):[0,0,4];
}
function resetView(){ APP.rot=[0,0]; APP.zoom=1; APP.pan=[0,0]; draw() }
function draw(){
  const cv=$("cv"), r=cv.getBoundingClientRect(), dpr=Math.min(2,devicePixelRatio||1);
  cv.width=Math.round(r.width*dpr); cv.height=Math.round(r.height*dpr);
  if(!APP.scene){ APP.gl.draw(new Float32Array(16),[1,1],[0,0,1]); return }
  const [cx,cy,cz]=center(), [a,b]=APP.rot, ca=Math.cos(a), sa=Math.sin(a), cb=Math.cos(b), sb=Math.sin(b);
  const R=[ca,sb*sa,-cb*sa, 0,cb,sb, sa,-sb*ca,cb*ca];   // 列優先 3×3。p' = R(p − c) + c
  const t=[0,1,2].map(i=>[cx,cy,cz][i]-(R[i]*cx+R[3+i]*cy+R[6+i]*cz));
  const V=new Float32Array([R[0],R[1],R[2],0, R[3],R[4],R[5],0, R[6],R[7],R[8],0, t[0]+APP.pan[0],t[1]+APP.pan[1],t[2],1]);
  // ゲームの画面（496×384 を 622×412 に広げて見せている）と同じ写り方
  const f=APP.scene.sc.focal, focal=[f[0]*APP.zoom*2/496, f[1]*APP.zoom*2/384];
  APP.gl.draw(V,focal,APP.scene.light.L,false,{bilin:$("c-smooth").checked,arc:true});
}
function hookInput(){
  // ドラッグで回す。Shift を押しながら（または右・中ボタンで）ドラッグすると平行に動かす。2本指はピンチで寄り、指の中ほどの移動で平行に動く
  const v=$("viewer"), pts=new Map(); let last=null, pinch=null, mode=null;
  const panBy=(dx,dy)=>{ const r=$("cv").getBoundingClientRect(), f=APP.scene?APP.scene.sc.focal:[480,480], z=APP.scene?center()[2]:4;
    APP.pan[0]+=dx*2/r.width*z/(f[0]*APP.zoom*2/496); APP.pan[1]-=dy*2/r.height*z/(f[1]*APP.zoom*2/384) };
  v.addEventListener("contextmenu",e=>e.preventDefault());
  v.addEventListener("pointerdown",e=>{ v.setPointerCapture(e.pointerId); pts.set(e.pointerId,[e.clientX,e.clientY]); last=[e.clientX,e.clientY];
    mode=pts.size>=2?"pinch":(e.shiftKey||e.button===1||e.button===2)?"pan":"rotate" });
  v.addEventListener("pointermove",e=>{
    if(!pts.has(e.pointerId)) return; const prev=pts.get(e.pointerId); pts.set(e.pointerId,[e.clientX,e.clientY]);
    if(pts.size===2){ const [p,q]=[...pts.values()], d=Math.hypot(p[0]-q[0],p[1]-q[1]); if(pinch) APP.zoom=Math.max(.3,Math.min(20,APP.zoom*d/pinch)); pinch=d;
      panBy((e.clientX-prev[0])/2,(e.clientY-prev[1])/2); draw(); return }
    if(!last) return; const dx=e.clientX-last[0], dy=e.clientY-last[1]; last=[e.clientX,e.clientY];
    if(mode==="pan"||e.shiftKey) panBy(dx,dy);
    else { APP.rot[0]+=dx*0.01; APP.rot[1]=Math.max(-1.5,Math.min(1.5,APP.rot[1]+dy*0.01)) }
    draw();
  });
  const up=e=>{ pts.delete(e.pointerId); if(pts.size<2) pinch=null; last=pts.size?[...pts.values()][0]:null; if(!pts.size) mode=null; else if(mode==="pinch") mode="pan" };
  v.addEventListener("pointerup",up); v.addEventListener("pointercancel",up);
  // ホイール: カーソルの下の物が動かないように寄る
  v.addEventListener("wheel",e=>{ e.preventDefault(); const z0=APP.zoom; APP.zoom=Math.max(.3,Math.min(20,APP.zoom*Math.exp(-e.deltaY*0.001)));
    const k=APP.zoom/z0, r=$("cv").getBoundingClientRect(), ox=e.clientX-(r.left+r.width/2), oy=e.clientY-(r.top+r.height/2); panBy(ox*(1-k),oy*(1-k)); draw() },{passive:false});
  v.addEventListener("dblclick",resetView);
  addEventListener("resize",draw);
}
function listStates(){
  const box=$("states"); box.innerHTML="";
  APP.states.forEach((s,i)=>{ const b=document.createElement("button"); b.textContent=s.name.replace(/\.p2s$/i,""); if(i===APP.cur) b.className="on";
    b.onclick=()=>{ APP.cur=i; listStates(); show() }; box.appendChild(b) });
}
async function loadDisc(f){ if(!f) return;
  try{ status("ディスクを読み込み中…"); APP.disc=await discOpen(f); APP.objCache.clear(); APP.rom=null; for(const s of APP.states) s.arc=null;
    if(!APP.disc.get("ROM_CODE1.CMP")) throw new Error("ディスクの中に ROM_CODE1.CMP が無い（ファイティングバイパーズの PS2 版ではない？）");
    $("n-disc").textContent=f.name; $("step-disc").classList.add("done"); status(APP.cur<0?"次にセーブステートを選んでください":""); if(APP.cur>=0) show() }
  catch(err){ APP.disc=null; status("ディスクを読めなかった: "+err.message,true) } }
async function loadStates(files){ if(!files||!files.length) return;
  for(const f of files){ try{ APP.states.push({name:f.name,zip:await p2sOpen(await f.arrayBuffer())}) }catch(err){ status(f.name+" を読めなかった: "+err.message,true) } }
  if(!APP.states.length) return;
  $("n-state").textContent=APP.states.length+" 個"; $("step-state").classList.add("done");
  if(APP.cur<0) APP.cur=0; listStates();
  if(APP.disc) show(); else status("次にディスクのイメージを選んでください") }
// ファイルのドロップ: .p2s はセーブステート、ほかはディスク
function hookDrop(){
  const v=$("viewer");
  addEventListener("dragover",e=>{ e.preventDefault(); v.classList.add("drop-over") });
  addEventListener("dragleave",e=>{ if(!e.relatedTarget) v.classList.remove("drop-over") });
  addEventListener("drop",async e=>{ e.preventDefault(); v.classList.remove("drop-over"); const fs=[...e.dataTransfer.files];
    const st=fs.filter(f=>/\.p2s$/i.test(f.name)), disc=fs.find(f=>!/\.p2s$/i.test(f.name));
    if(disc) await loadDisc(disc); if(st.length) await loadStates(st) });
}
function savePng(){
  if(!APP.scene) return; draw();
  $("cv").toBlob(b=>{ const a=document.createElement("a"), st=APP.states[APP.cur]; a.href=URL.createObjectURL(b);
    a.download=`FV_${(st?st.name:"view").replace(/\.p2s$/i,"").replace(/[^\w.-]+/g,"_")}_v${VERSION}.png`; document.body.appendChild(a); a.click(); a.remove() },"image/png");
}
function init(){
  $("ver").textContent="版 "+VERSION; $("ver-h").textContent="v"+VERSION;
  try{ APP.gl=vglNew($("cv")) }catch(e){ status(e.message,true); return }
  hookInput(); hookDrop(); draw();
  $("f-disc").onchange=e=>loadDisc(e.target.files[0]);
  $("f-state").onchange=e=>loadStates(e.target.files);
  for(const id of ["c-p1","c-p2","c-shadow","c-stage"]) $(id).onchange=rebuild;
  $("c-smooth").onchange=draw;
  $("c-overlay").onchange=()=>$("viewer").classList.toggle("overlay",$("c-overlay").checked);
  $("b-reset").onclick=resetView; $("b-png").onclick=savePng;
}
init();
