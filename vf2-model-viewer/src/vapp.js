// 画面の組み立て
const VERSION="0.4.0";
const $=id=>document.getElementById(id);
const APP={disc:null, robs:null, objCache:new Map(), states:[], cur:-1, scene:null, gl:null, rot:[0,0], zoom:1, pan:[0,0]};
function status(msg,err){ const s=$("status"); s.textContent=msg||""; s.className=err?"err":"" }
async function readRobs(){
  if(APP.robs) return APP.robs;
  const mrg=await APP.disc.get("TEX_ROB.MRG")(), dv=new DataView(mrg.buffer,mrg.byteOffset,mrg.byteLength), n=dv.getUint32(0,true), out=[];
  for(let i=0;i<n;i++){ const o=dv.getUint32(4+i*4,true), e=i+1<n?dv.getUint32(8+i*4,true):mrg.length; out.push(cricmpUnpack(mrg.subarray(o,e))) }
  return APP.robs=out;
}
async function readObj(name){
  if(!APP.objCache.has(name)){ const f=APP.disc.get(name); if(!f) return null; APP.objCache.set(name,objModels(cricmpUnpack(await f()))) }
  return APP.objCache.get(name);
}
// キャラの OBJ ファイルの候補: テクスチャで分かったキャラの 1色目・2色目。分からなければ全部
async function candidatesFor(code){
  const names=[...APP.disc.keys()].filter(n=>/^OBJ_[A-Z]{3}\d\.CMP$/.test(n)&&!/STAGE/.test(n));
  const pick=code?names.filter(n=>n.startsWith("OBJ_"+code)):names;
  const out=[]; for(const n of pick.sort()) out.push({name:n,models:await readObj(n)}); return out;
}
async function show(){
  const st=APP.states[APP.cur]; if(!st||!APP.disc) return;
  try{
    status("読み込み中…");
    if(!st.mem){ st.mem=await st.zip.get("eeMemory.bin")(); const v1=st.zip.get("vu1Memory.bin"); st.vu1=v1?await v1():null; const sh=st.zip.get("Screenshot.png"); if(sh) st.shot=URL.createObjectURL(new Blob([await sh()],{type:"image/png"})) }
    const sc=sceneRead(st.mem), col=sceneColors(st.mem), who=sceneWhichRob(col.tex,await readRobs());
    const models={}, names=[];
    for(const pl of [0,1]){
      const code=who[pl]>=0?SC_ROB[who[pl]]:null;
      let ch=sceneChooseModels(sc,pl,await candidatesFor(code));
      if(!ch&&code) ch=sceneChooseModels(sc,pl,await candidatesFor(null));
      models[pl]=ch?ch.map:null; names.push(ch?ch.name.replace(".CMP",""):"（見つからない）");
    }
    // 背景: 1P の表のうちキャラのファイルに無い番号を、いちばん多く含む OBJ_STAGE*
    const stageNames=[...APP.disc.keys()].filter(n=>/^OBJ_STAGE\d+\.CMP$/.test(n)).sort(), stc=[];
    for(const n of stageNames) stc.push({name:n,models:await readObj(n)});
    const st2=sceneChooseModels(sc,0,stc,models[0]?new Set(models[0].keys()):null);
    models.stage=st2?st2.map:null; names.push(st2?st2.name.replace(".CMP",""):"なし");
    APP.scene={sc,col,models,names,light:sceneLight(st.vu1,sc)};
    APP.gl.setColors(col); rebuild(); resetView();
    $("shot").src=st.shot||""; $("shot").hidden=!st.shot; $("empty").hidden=true; $("hint").hidden=false;
    status("");
  }catch(e){ console.error(e); status("読めなかった: "+e.message,true) }
}
function rebuild(){
  const S=APP.scene; if(!S) return;
  const o={players:[$("c-p1").checked,$("c-p2").checked],stage:$("c-stage").checked,light:S.light};
  const body=sceneMesh(S.sc,S.col,S.models,{...o,which:"body"}), shadow=$("c-shadow").checked?sceneMesh(S.sc,S.col,S.models,{...o,which:"shadow"}):null;
  APP.gl.setMesh(body,shadow);
  $("info").textContent=`1P ${S.names[0]}・2P ${S.names[1]}・背景 ${S.names[2]}　部品 ${S.sc.draws.length} 個（うち影 ${body.shadows}）　三角形 ${(body.count+(shadow?shadow.count:0))/3}`+(body.missing.length?`　ファイルに無い番号 ${body.missing.length} 個`:"");
  draw();
}
// 視点: ゲームのカメラの座標のまま、2人の真ん中を中心に回す
function center(){
  // ファイルにあったキャラの部品（影を除く）の位置の平均
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
  // R = 縦の回転(b) × 横の回転(a)。p' = R(p − c) + c
  const R=[ca,sb*sa,-cb*sa, 0,cb,sb, sa,-sb*ca,cb*ca];   // 列優先 3×3
  const t=[0,1,2].map(i=>[cx,cy,cz][i]-(R[i]*cx+R[3+i]*cy+R[6+i]*cz));
  const V=new Float32Array([R[0],R[1],R[2],0, R[3],R[4],R[5],0, R[6],R[7],R[8],0, t[0]+APP.pan[0],t[1]+APP.pan[1],t[2],1]);
  // ゲームの画面（496×384 を 622×412 に広げて見せている）と同じ写り方。この欄の縦横比は 622:412
  const f=APP.scene.sc.focal, focal=[f[0]*APP.zoom*2/496, f[1]*APP.zoom*2/384];
  APP.gl.draw(V,focal,APP.scene.light.L);   // 光はゲームのカメラの座標のまま（法線も回す前のもの）
}
function hookInput(){
  const v=$("viewer"), pts=new Map(); let last=null, pinch=null;
  v.addEventListener("pointerdown",e=>{ v.setPointerCapture(e.pointerId); pts.set(e.pointerId,[e.clientX,e.clientY]); last=[e.clientX,e.clientY] });
  v.addEventListener("pointermove",e=>{
    if(!pts.has(e.pointerId)) return; pts.set(e.pointerId,[e.clientX,e.clientY]);
    if(pts.size===2){ const [p,q]=[...pts.values()], d=Math.hypot(p[0]-q[0],p[1]-q[1]); if(pinch) APP.zoom=Math.max(.3,Math.min(8,APP.zoom*d/pinch)); pinch=d; draw(); return }
    if(!last) return; const dx=e.clientX-last[0], dy=e.clientY-last[1]; last=[e.clientX,e.clientY];
    APP.rot[0]+=dx*0.01; APP.rot[1]=Math.max(-1.5,Math.min(1.5,APP.rot[1]+dy*0.01)); draw();
  });
  const up=e=>{ pts.delete(e.pointerId); if(pts.size<2) pinch=null; last=pts.size?[...pts.values()][0]:null };
  v.addEventListener("pointerup",up); v.addEventListener("pointercancel",up);
  v.addEventListener("wheel",e=>{ e.preventDefault(); APP.zoom=Math.max(.3,Math.min(8,APP.zoom*Math.exp(-e.deltaY*0.001))); draw() },{passive:false});
  addEventListener("resize",draw);
}
function listStates(){
  const box=$("states"); box.innerHTML="";
  APP.states.forEach((s,i)=>{ const b=document.createElement("button"); b.textContent=s.name.replace(/\.p2s$/i,""); if(i===APP.cur) b.className="on";
    b.onclick=()=>{ APP.cur=i; listStates(); show() }; box.appendChild(b) });
}
function init(){
  $("ver").textContent="版 "+VERSION;
  try{ APP.gl=vglNew($("cv")) }catch(e){ status(e.message,true); return }
  hookInput(); draw();
  $("f-disc").onchange=async e=>{ const f=e.target.files[0]; if(!f) return;
    try{ status("ディスクを読み込み中…"); APP.disc=await discOpen(f); APP.robs=null; APP.objCache.clear();
      $("n-disc").textContent=f.name; $("step-disc").classList.add("done"); status(""); if(APP.cur>=0) show(); else status("次に 2 のセーブステートを選んでください") }
    catch(err){ status("ディスクを読めなかった: "+err.message,true) } };
  $("f-state").onchange=async e=>{
    for(const f of e.target.files){ try{ APP.states.push({name:f.name,zip:await p2sOpen(await f.arrayBuffer())}) }catch(err){ status(f.name+" を読めなかった: "+err.message,true) } }
    if(!APP.states.length) return;
    if(APP.cur<0) APP.cur=0; $("n-state").textContent=APP.states.length+" 個"; $("step-state").classList.add("done"); listStates();
    if(APP.disc) show(); else status("次に 1 のディスクのイメージを選んでください");
  };
  for(const id of ["c-p1","c-p2","c-shadow","c-stage"]) $(id).onchange=rebuild;
  $("c-overlay").onchange=e=>$("viewer").classList.toggle("overlay",e.target.checked);
  $("b-reset").onclick=resetView;
  $("b-png").onclick=()=>{ draw(); $("cv").toBlob(b=>{ const a=document.createElement("a"); a.href=URL.createObjectURL(b); a.download=(APP.states[APP.cur]?.name||"vf2").replace(/\.p2s$/i,"")+".png"; a.click() }) };
}
init();
