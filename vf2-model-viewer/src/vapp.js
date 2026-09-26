// 画面の組み立て
const VERSION="0.9.0";
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
// ディスクだけで見る
async function readDec(name){ const f=APP.disc.get(name); if(!f) throw new Error(name+" がディスクに無い"); return cricmpUnpack(await f()) }
function listChars(){
  const names=[...APP.disc.keys()].filter(n=>/^OBJ_[A-Z]{3}\d[A-Z]?\.CMP$/.test(n)&&SC_ROB.includes(n.slice(4,7))).sort(), sel=$("s-char");
  sel.innerHTML=names.map(n=>`<option>${n.replace(".CMP","")}</option>`).join(""); if(names.includes("OBJ_AKI1.CMP")) sel.value="OBJ_AKI1";
  $("discview").hidden=!names.length;
}
async function showDisc(){
  if(!APP.disc) return; const name=$("s-char").value+".CMP";
  try{
    status("読み込み中…");
    if(!APP.dvBase) APP.dvBase={fix:await readDec("FIXPAGE.CMP"), ic:await readDec("IC12_15.CMP"), dfl:await readDec("TEX_DFL.CMP")};
    const models=new Map((await readObj(name)).map(m=>[m.id,m])), rob=(await readRobs())[SC_ROB.indexOf(name.slice(4,7))], ids=[...models.keys()].sort((a,b)=>a-b);
    if(APP.dv?.name!==name) APP.dv={name,ids,k:-1};
    const only=APP.dv.k<0?null:ids[APP.dv.k], col=dvColors(APP.dvBase.fix,APP.dvBase.ic,rob,APP.dvBase.dfl), sc=dvScene(models,only);
    APP.mode="disc"; APP.cur=-1; listStates();
    APP.scene={sc,col,models:{0:models,1:null,stage:null},names:[name.replace(".CMP",""),"なし","なし"],light:sceneLight(null,sc)};
    APP.gl.setColors(col); APP.gl.setBack(null); APP.gl.setArc(null); rebuild(); resetView();
    if(only!=null){ APP.rot=[0.6,0.3]; draw() }   // 1つだけのときは斜めから（真横だと薄い部品が見えない）
    $("n-part").textContent=only==null?`全部（${ids.length}）`:`${APP.dv.k+1}/${ids.length}（番号 ${only}）`;
    $("shot").hidden=true; $("empty").hidden=true; $("hint").hidden=false;
    status(APP.states.length?"":"セーブステートを選ぶと、ゲームのその場面の姿勢と色で2人が出ます");
  }catch(e){ console.error(e); status("読めなかった: "+e.message,true) }
}
function stepPart(d){ if(!APP.dv) return; const n=APP.dv.ids.length; APP.dv.k=d===0?-1:((APP.dv.k<0?(d>0?-1:0):APP.dv.k)+d+n)%n; showDisc() }
async function show(){
  const st=APP.states[APP.cur]; if(!st||!APP.disc) return;
  APP.mode="state";
  try{
    status("読み込み中…");
    if(!st.mem){ st.mem=await st.zip.get("eeMemory.bin")(); const v1=st.zip.get("vu1Memory.bin"); st.vu1=v1?await v1():null; const sh=st.zip.get("Screenshot.png"); if(sh) st.shot=URL.createObjectURL(new Blob([await sh()],{type:"image/png"})) }
    const sc=sceneRead(st.mem), col=sceneColors(st.mem), who=sceneWhichRob(col.tex,await readRobs());
    const models={}, names=[];
    for(const pl of [0,1]){
      const code=who[pl]>=0?SC_ROB[who[pl]]:null;
      let ch=sceneChooseModels(sc,pl,await candidatesFor(code));
      if(!ch&&code) ch=sceneChooseModels(sc,pl,await candidatesFor(null));
      if(ch){ const base=ch.name.replace(".CMP",""), comp=[]; for(const n of [...APP.disc.keys()].filter(n=>new RegExp("^"+base+"[A-Z]\\.CMP$").test(n)).sort()) comp.push({name:n,models:await readObj(n)}); ch=sceneAddCompanions(ch,sc,pl,comp) }
      models[pl]=ch?ch.map:null; names.push(ch?ch.name.replace(".CMP","")+(ch.used&&ch.used.length?"＋"+ch.used.map(n=>n.replace(".CMP","").slice(-1)).join("＋"):""):"（見つからない）");
    }
    // 背景: 1P の表のうちキャラのファイルに無い番号を、いちばん多く含む OBJ_STAGE*
    const stageNames=[...APP.disc.keys()].filter(n=>/^OBJ_STAGE\d+\.CMP$/.test(n)).sort(), stc=[];
    for(const n of stageNames) stc.push({name:n,models:await readObj(n)});
    const st2=sceneChooseModels(sc,0,stc,models[0]?new Set(models[0].keys()):null);
    models.stage=st2?st2.map:null; names.push(st2?st2.name.replace(".CMP",""):"なし");
    APP.scene={sc,col,models,names,light:sceneLight(st.vu1,sc),rob:[who[0]>=0?SC_ROB[who[0]]:null,who[1]>=0?SC_ROB[who[1]]:null]};
    APP.gl.setColors(col); APP.gl.setBack(scrBack(scrRead(st.mem))); applyArc(); rebuild(); resetView();
    $("shot").src=st.shot||""; $("shot").hidden=!st.shot; $("empty").hidden=true; $("hint").hidden=false;
    status("");
  }catch(e){ console.error(e); status("読めなかった: "+e.message,true) }
}
function rebuild(){
  const S=APP.scene; if(!S) return;
  const o={players:[$("c-p1").checked,$("c-p2").checked],stage:$("c-stage").checked,light:S.light};
  const body=sceneMesh(S.sc,S.col,S.models,{...o,which:"body"}), shadow=$("c-shadow").checked?sceneMesh(S.sc,S.col,S.models,{...o,which:"shadow"}):null;
  APP.gl.setMesh(body,shadow);
  if(APP.mode==="disc"){ $("info").textContent=`${S.names[0]}　部品 ${S.sc.draws.length} 個　三角形 ${body.count/3}（ディスクだけ。姿勢なし・色は灰色がち）`; draw(); return }
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
  APP.gl.draw(V,focal,APP.scene.light.L,$("c-sky").checked,{bilin:$("c-smooth").checked,arc:$("c-arc").checked});   // 光はゲームのカメラの座標のまま（法線も回す前のもの）
}
function hookInput(){
  // ドラッグで回す。Shift を押しながら（または右・中ボタンで）ドラッグすると平行に動かす。2本指はピンチで寄り、指の中ほどの移動で平行に動く（tobal ビューアと同じ）
  const v=$("viewer"), pts=new Map(); let last=null, pinch=null, mode=null;
  // 画面の px をカメラの座標の長さに直して、平行移動に足す（中心の奥行きで、指の下の物が指に付いてくる量）
  const panBy=(dx,dy)=>{ const cv=$("cv"), r=cv.getBoundingClientRect(), f=APP.scene?APP.scene.sc.focal:[600,600], z=APP.scene?center()[2]:4;
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
  v.addEventListener("wheel",e=>{ e.preventDefault(); APP.zoom=Math.max(.3,Math.min(20,APP.zoom*Math.exp(-e.deltaY*0.001))); draw() },{passive:false});
  v.addEventListener("dblclick",resetView);
  addEventListener("resize",draw);
}
// アーケードのテクスチャ: そのセーブステートの2人のテクスチャをロムから作り（arcade.js）、ロムで書かれなかった所は PS2 のテクスチャを縦に 4 倍して埋める
function applyArc(){
  const S=APP.scene, st=APP.states[APP.cur];
  if(!APP.arcRom||!S||APP.mode!=="state"||!st){ APP.gl.setArc(null); return }
  if(!st.arc){
    const L=arcCharSheets(APP.arcRom,S.rob), T=S.col.tex;   // S.rob＝[1P, 2P]
    st.arc=[0,1].map(p=>{ const o=new Uint8Array(1024*2048), m=L.mask[p], a=L.tex[p];
      for(let y=0;y<2048;y++) for(let x=0;x<1024;x++){ const h=(y>>1)*512+(x>>1);
        if(m[h]) o[y*1024+x]=arcTexel(a,x,y); else { const b=T[(p<<18)+x*256+(y>>3)]; o[y*1024+x]=(y>>2)&1?b>>4:b&15 } }
      return o });
  }
  APP.gl.setArc(st.arc);
}
function listStates(){
  const box=$("states"); box.innerHTML="";
  APP.states.forEach((s,i)=>{ const b=document.createElement("button"); b.textContent=s.name.replace(/\.p2s$/i,""); if(i===APP.cur) b.className="on";
    b.onclick=()=>{ APP.cur=i; listStates(); show() }; box.appendChild(b) });
}
function init(){
  $("ver").textContent="版 "+VERSION; $("ver-h").textContent="v"+VERSION;
  try{ APP.gl=vglNew($("cv")) }catch(e){ status(e.message,true); return }
  hookInput(); draw();
  $("f-disc").onchange=async e=>{ const f=e.target.files[0]; if(!f) return;
    try{ status("ディスクを読み込み中…"); APP.disc=await discOpen(f); APP.robs=null; APP.objCache.clear();
      $("n-disc").textContent=f.name; $("step-disc").classList.add("done"); status(""); APP.dvBase=null; listChars(); if(APP.cur>=0) show(); else showDisc() }
    catch(err){ status("ディスクを読めなかった: "+err.message,true) } };
  $("f-state").onchange=async e=>{
    for(const f of e.target.files){ try{ APP.states.push({name:f.name,zip:await p2sOpen(await f.arrayBuffer())}) }catch(err){ status(f.name+" を読めなかった: "+err.message,true) } }
    if(!APP.states.length) return;
    if(APP.cur<0) APP.cur=0; $("n-state").textContent=APP.states.length+" 個"; $("step-state").classList.add("done"); listStates();
    if(APP.disc) show(); else status("次に 1 のディスクのイメージを選んでください");
  };
  $("f-arc").onchange=async e=>{ const f=e.target.files[0]; if(!f) return;
    try{ status("アーケードのロムを読み込み中…"); const z=await p2sOpen(await f.arrayBuffer()), files={};
      for(const n of z.keys()) files[n.split("/").pop()]=await z.get(n)();
      APP.arcRom=arcRom(files); for(const st of APP.states) st.arc=null;
      $("n-arc").textContent=f.name; $("step-arc").classList.add("done"); $("c-arc").disabled=false; $("c-arc").checked=true; status("");
      if(APP.mode==="state"&&APP.scene){ applyArc(); draw() } }
    catch(err){ status("ロムを読めなかった: "+err.message,true) } };
  $("c-arc").onchange=draw;
  for(const id of ["c-p1","c-p2","c-shadow","c-stage"]) $(id).onchange=rebuild;
  $("c-sky").onchange=draw; $("c-smooth").onchange=draw;
  $("s-char").onchange=()=>{ APP.dv=null; showDisc() };
  $("b-prev").onclick=()=>stepPart(-1); $("b-next").onclick=()=>stepPart(1); $("b-all").onclick=()=>stepPart(0);
  $("c-overlay").onchange=e=>$("viewer").classList.toggle("overlay",e.target.checked);
  $("b-reset").onclick=resetView;
  $("b-png").onclick=()=>{ draw(); $("cv").toBlob(b=>{ const a=document.createElement("a"); a.href=URL.createObjectURL(b); a.download=(APP.mode==="disc"?APP.scene?.names[0]:APP.states[APP.cur]?.name||"vf2").replace(/\.p2s$/i,"")+"_v"+VERSION+".png"; a.click() }) };
}
init();
