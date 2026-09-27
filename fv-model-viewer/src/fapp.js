// 画面の組み立て（VF2 の vapp.js を元に、FV のモデルの選び方とアーケードのテクスチャに合わせたもの）
const VERSION="0.6.2";
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
  // 共通の部品を近いほうの人に（sceneAssignCommon）。1 つの列につき 1 回
  if(common&&!sc.commonFixed){ const own=[0,1].map(p=>used[p]?APP.objCache.get(used[p]):null), rr=[0,1].map(p=>used[p]?APP.objCache.get(used[p].replace(".CMP","R.CMP")):null);
    sceneAssignCommon(sc,id=>common.has(id),(p,id)=>!!(own[p]&&own[p].has(id)||rr[p]&&rr[p].has(id))); sc.commonFixed=true }
  return {models,names:used};
}
async function arcPages(names){
  if(!APP.rom){ status("アーケードのテクスチャを展開中…"); APP.rom={prog:await readDec("ROM_CODE1.CMP"), data:await readDec("ROM_DATA.CMP")} }
  return fvArcPages(APP.rom,names);
}
const arcMips=fvArcMips;
// ===== ディスクだけで見る =====
function listChars(){
  const names=[...APP.disc.keys()].filter(n=>/^OBJ_(ROB\d+|STG\d+|COMMON)\.CMP$/.test(n)).sort(), sel=$("s-char");
  sel.innerHTML=names.map(n=>`<option>${n.replace(".CMP","")}</option>`).join(""); if(names.includes("OBJ_ROB01.CMP")) sel.value="OBJ_ROB01";
  $("discview").hidden=!names.length;
}
async function showDisc(){
  if(!APP.disc) return; const name=$("s-char").value+".CMP";
  try{
    status("読み込み中…");
    if(!APP.dvBase) APP.dvBase={data:await readDec("ROM_DATA.CMP"), ep1:await readDec("ROM_EP1.CMP")};
    const models=new Map(await readObj(name));
    if(/ROB\d+\.CMP$/.test(name)){ const r=await readObj(name.replace(".CMP","R.CMP")); if(r) for(const [k,v] of r) if(!models.has(k)) models.set(k,v) }
    const ids=[...models.keys()].sort((a,b)=>a-b);
    if(APP.dv?.name!==name) APP.dv={name,ids,k:-1,arc:null};
    const only=APP.dv.k<0?null:ids[APP.dv.k], col=dvColors(APP.dvBase.data,APP.dvBase.ep1), sc=dvScene(models,only);
    if(!APP.dv.arc){ const st=/STG/.test(name), rob=/ROB/.test(name); APP.dv.arc=await arcPages([rob?name:null,null,st?name:null]); APP.dv.mip=arcMips(APP.dv.arc) }
    APP.mode="disc"; APP.cur=-1; listStates(); motStop(); APP.mot=null; $("motview").hidden=true;
    // ステージのファイルは背景として描く（属性は塊0、裏向きも描く）
    APP.scene={sc,col,models:/STG/.test(name)?{0:new Map(),1:null,stage:models}:{0:models,1:null,stage:null},names:[name,null,null],light:sceneLight(null,sc)};
    APP.gl.setColors(col); APP.gl.setArc(APP.dv.arc,APP.dv.mip); rebuild(); resetView();
    if(only!=null){ APP.rot=[0.6,0.3]; draw() }   // 1つだけのときは斜めから（真横だと薄い部品が見えない）
    $("n-part").textContent=only==null?`全部（${ids.length}）`:`${APP.dv.k+1}/${ids.length}（番号 ${only}）`;
    $("shot").hidden=true; $("empty").hidden=true; $("hint").hidden=false;
    status(APP.states.length?"":"セーブステートを選ぶと、ゲームのその場面の姿勢と色で2人が出ます");
  }catch(e){ console.error(e); status("読めなかった: "+e.message,true) }
}
function stepPart(d){ if(!APP.dv) return; const n=APP.dv.ids.length; APP.dv.k=d===0?-1:((APP.dv.k<0?(d>0?-1:0):APP.dv.k)+d+n)%n; showDisc() }
async function show(){
  const st=APP.states[APP.cur]; if(!st||!APP.disc) return;
  try{
    status("読み込み中…");
    if(!st.mem){ st.mem=await st.zip.get("eeMemory.bin")(); const v1=st.zip.get("vu1Memory.bin"); st.vu1=v1?await v1():null; const sh=st.zip.get("Screenshot.png"); if(sh) st.shot=URL.createObjectURL(new Blob([await sh()],{type:"image/png"})) }
    if(!st.sc0){ status("今のコマの命令の列を探し中…"); await new Promise(r=>setTimeout(r)); st.sc0=pickScene(st.mem) }
    const sc=st.sc0, col=sceneColors(st.mem), light=sceneLight(st.vu1,sc), {models,names}=await chooseModels(sc);
    motStop(); APP.mot=null;
    APP.mode="state"; APP.scene={sc,sc0:sc,col,light,models,names};
    if(!st.arc){ st.arc=await arcPages(names); st.arcMip=arcMips(st.arc) }
    APP.gl.setColors(col); APP.gl.setArc(st.arc,st.arcMip);
    $("shot").src=st.shot||""; $("shot").hidden=!st.shot;
    $("empty").hidden=true; $("hint").hidden=false; status(""); rebuild(); resetView(); motShowUI(st);
  }catch(e){ console.error(e); status("読めなかった: "+e.message,true) }
}
// 命令の列は 0x1288000 から 12 本（回しながら書く）。写しの関節（2P）と同じコマのものを使う（motion.js の motPickScene）。合う列が無ければ最初に見つかる列
function pickScene(mem){
  try{ const U2=motEngine(new Uint8Array(0),mem,null).units(1), p=motPickScene(mem,U2); if(p&&p.n>=8) return p.sc }catch(e){ console.warn(e) }
  return sceneRead(mem);
}
// ===== 技の名前（ディスクのコマンド表 XXX_CMND.FTS と fvmoves.js の番号） =====
// 技の名前の一覧: 写しのキャラの技を先頭に、ほかのキャラの技もキャラごとの見出しで並べる（ほかのキャラの技も同じ 16 の関節で出せる）。
// APP.names＝写しのキャラの技、APP.namesAll＝全員の技
async function motNames(st,pl){ const sel=$("m-name"); sel.hidden=true; sel.innerHTML=""; APP.names=null; APP.namesAll=null;
  try{ const d=new DataView(st.mem.buffer,st.mem.byteOffset,st.mem.byteLength), g7=d.getUint32(MOT_WORK+(pl?0x500808:0x500804),true), cid=st.mem[MOT_WORK+g7+0x1b1];
    if(!APP.disc) return;
    APP.cmdCache=APP.cmdCache||{}; const groups=[];
    for(const k of [cid,...Object.keys(FV_MOVES).map(Number).filter(k=>k!==cid)]){ const e=FV_MOVES[k]; if(!e||!APP.disc.get(e[0])) continue;
      if(!APP.cmdCache[e[0]]) APP.cmdCache[e[0]]=cmdStrings(await APP.disc.get(e[0])());
      const s=APP.cmdCache[e[0]], who=(s[1]||"").split("<")[0]||e[0].replace("_CMND.FTS","");
      groups.push({own:k===cid,who,list:e[1].filter(([i])=>s[i]&&s[i+1]).map(([i,m])=>({m,name:s[i],cmd:cmdPretty(s[i+1])}))}) }
    if(+$("m-pl").value!==pl||APP.states[APP.cur]!==st) return;   // 読むあいだに切り替わった
    const own=groups.find(x=>x.own); APP.names=own?own.list:null; APP.namesAll=groups.flatMap(x=>x.list);
    const esc=t=>t.replace(/[&<>"]/g,c=>"&#"+c.charCodeAt(0)+";");
    sel.innerHTML=`<option value="">技の名前から選ぶ（${own?own.list.length:0}／全員 ${APP.namesAll.length}）</option>`+groups.map(x=>`<optgroup label="${esc(x.who)}${x.own?"（このキャラ）":""}">`+x.list.map(y=>`<option value="${y.m}">${esc(y.name)}　${esc(y.cmd)}</option>`).join("")+"</optgroup>").join("");
    sel.hidden=!APP.namesAll.length; motNameSync() }catch(err){ console.warn(err) } }
// 番号の欄と名前の一覧をそろえる（一覧に無い番号なら先頭の「技の名前から選ぶ」）
function motNameSync(){ const sel=$("m-name"); if(sel.hidden) return; const v=String(+$("m-num").value); sel.value=[...sel.options].some(o=>o.value===v)?v:"" }
// ===== 技を出す（motion.js）。エンジンは写しごとに最初に触ったときに作る（写しの主メモリを写して使う） =====
const MOT_MAX=1052;
function motG7Info(mem,pl){ const d=new DataView(mem.buffer,mem.byteOffset,mem.byteLength), W=MOT_WORK, g7=d.getUint32(W+(pl?0x500808:0x500804),true); return {motion:d.getUint16(W+g7+0x1a8,true),frame:d.getUint16(W+g7+0x1aa,true)} }
function motShowUI(st){ $("motview").hidden=false; const pl=+$("m-pl").value; $("m-num").value=motG7Info(st.mem,pl).motion; motNames(st,pl); $("m-fn").textContent="写しのまま"; $("m-play").textContent="▶ 再生" }
async function motEnsure(){
  const st=APP.states[APP.cur]; if(!st||!APP.scene||APP.mode!=="state") return null;
  if(APP.mot&&APP.mot.st===st) return APP.mot;
  status("技の計算の用意…");
  if(!APP.rom) APP.rom={prog:await readDec("ROM_CODE1.CMP"), data:await readDec("ROM_DATA.CMP")};
  if(!APP.rom.ep2){ APP.rom.ep1=await readDec("ROM_EP1.CMP"); APP.rom.ep2=await readDec("ROM_EP2.CMP") }
  const eng=motEngine(APP.rom.prog,st.mem,APP.rom), sc=APP.scene.sc0;
  // 写しの部品を関節に付ける（命令の列は関節と同じコマのものを選んであるので、今の関節だけでよい）。キャラのファイルに無い番号（1P の表に入るステージ）は付けない
  const models=APP.scene.models, att=[0,1].map(pl=>motAttach(sc,pl,[eng.units(pl)],null,d=>d.dyn||!!models[pl]&&models[pl].has(d.id)));
  status("");
  return APP.mot={st,eng,att,pl:0,m:0,f:1,len:0,play:false};
}
async function motSet(m,f,smooth=false){
  try{
    const M=await motEnsure(); if(!M) return; const pl=+$("m-pl").value;
    if(M.pl!==pl){ M.pl=pl; M.m=0 }
    if(m!==M.m){ const len=M.eng.motionLength(m); if(!len){ status("技 "+m+" は表に無い",true); return } M.m=m; M.len=len; M.eng.start(pl,m,smooth); $("m-frame").max=len; status("") }
    M.f=Math.max(1,Math.min(M.len,f)); $("m-frame").value=M.f; $("m-num").value=M.m; $("m-fn").textContent=M.f+" / "+M.len; motNameSync();
    const S=APP.scene; S.sc=motApply(S.sc0,M.att[pl],M.eng.frame(pl,M.f),null); rebuild();
  }catch(e){ console.error(e); motStop(); status("技を計算できなかった: "+e.message,true) }
}
function motStop(){ if(APP.mot){ APP.mot.play=false; APP.mot.random=false } $("m-play").textContent="▶ 再生"; $("m-rand").textContent="🎲 ランダムに連続" }
// ランダムに連続: 技が終わるたびに名前の一覧（このキャラの技、「全員の技から」なら全員の技。無ければ 1〜1052）から次の技を選び、ゲームの「前の技からのつなぎ」（0x29f48）でつなぐ
function motPickRandom(M){ const L=$("c-randall").checked?APP.namesAll:APP.names; if(L&&L.length) return L[Math.floor(Math.random()*L.length)].m;
  for(let n=0;n<200;n++){ const m=1+Math.floor(Math.random()*MOT_MAX); if(M.eng.motionLength(m)>0) return m } return M.m||1 }
async function motRandom(){
  if(rec.busy) return;
  if(APP.mot&&APP.mot.random){ motStop(); return }
  motStop(); const M=await motEnsure(); if(!M) return;
  await motSet(motPickRandom(M),1,!!M.m); if(!M.m) return;
  M.random=true; $("m-rand").textContent="■ 止める"; motPlay(true);
}
function motPlay(fromRandom){
  if(rec.busy) return;
  const M=APP.mot; if(!M||!M.m){ motSet(+$("m-num").value,1).then(()=>{ if(APP.mot&&APP.mot.m) motPlay() }); return }
  if(M.play&&!fromRandom){ motStop(); return }
  M.play=true; if(!M.random) $("m-play").textContent="■ 止める"; let t0=performance.now(), f0=M.f>=M.len?1:M.f, busy=false;
  const tick=async now=>{ if(!M.play||APP.mot!==M) return;
    if(!busy){ const f=f0+Math.floor((now-t0)*60/1000);   // ゲームは 1 秒 60 コマ
      busy=true;
      if(f>M.len){ t0=now; f0=1; await motSet(M.random?motPickRandom(M):M.m,1,M.random) }
      else if(f!==M.f) await motSet(M.m,f);
      busy=false }
    requestAnimationFrame(tick) };
  requestAnimationFrame(tick);
}
function motBack(){ motStop(); if(APP.mot) APP.mot.m=0; if(APP.scene&&APP.scene.sc0){ APP.scene.sc=APP.scene.sc0; rebuild() } const st=APP.states[APP.cur]; if(st&&APP.mode==="state") motShowUI(st) }
// コマ送り（◀ ▶・← →）。技をまだ選んでいなければ番号の欄の技の 1 コマ目から
function motStep(d){ if(rec.busy) return; motStop(); const M=APP.mot; if(M&&M.m) motSet(M.m,Math.max(1,Math.min(M.len,M.f+d))); else motSet(+$("m-num").value,1) }
function rebuild(){
  const S=APP.scene; if(!S) return;
  const o={players:[$("c-p1").checked,$("c-p2").checked],stage:APP.mode==="disc"||$("c-stage").checked,light:S.light};
  const body=sceneMesh(S.sc,S.col,S.models,{...o,which:"body"}), shadow=$("c-shadow").checked?sceneMesh(S.sc,S.col,S.models,{...o,which:"shadow"}):null;
  APP.gl.setMesh(body,shadow);
  const nm=n=>n?n.replace(".CMP",""):"なし";
  if(APP.mode==="disc"){ $("info").textContent=`${nm(S.names[0])}　部品 ${S.sc.draws.length} 個　三角形 ${body.count/3}（ディスクだけ。姿勢なし・色は灰色がち）`; draw(); return }
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
  try{ status("ディスクを読み込み中…"); APP.disc=await discOpen(f); APP.objCache.clear(); APP.cmdCache=null; APP.rom=null; for(const s of APP.states) s.arc=null;
    if(!APP.disc.get("ROM_CODE1.CMP")) throw new Error("ディスクの中に ROM_CODE1.CMP が無い（ファイティングバイパーズの PS2 版ではない？）");
    $("n-disc").textContent=f.name; $("step-disc").classList.add("done"); APP.dvBase=null; listChars(); if(APP.cur>=0) show(); else showDisc() }
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
// 背景の色（VF2・tobal2 のビューアと同じ8種。選んだものは覚えておく）。背景を消したとき・「背景なし」でないスクショに出る
const BG_PRESETS=[{name:"ダーク",c:"#3a3834",e:"#2a2926"},{name:"黒",c:"#111111",e:"#000000"},{name:"グレー",c:"#8a8a8a",e:"#6a6a6a"},{name:"白",c:"#ffffff",e:"#e6e4df"},
  {name:"空",c:"#bfe3ff",e:"#5a9fd6"},{name:"夕焼け",c:"#ffcf8a",e:"#c4533a"},{name:"夜",c:"#35407a",e:"#0d1030"},{name:"グリーンバック",c:"#00b140",e:"#00b140"}];
function setBackground(i){ const p=BG_PRESETS[i]||BG_PRESETS[0], v=$("viewer").style; v.setProperty("--stage2",p.c); v.setProperty("--stage",p.e); APP.bg=p;
  [...$("bg-box").children].forEach((b,k)=>b.setAttribute("aria-pressed",String(k===i))); try{ localStorage.setItem("fvbg",String(i)) }catch(_){} }
function hookBackground(){
  BG_PRESETS.forEach((p,i)=>{ const b=document.createElement("button"); b.title=p.name; b.setAttribute("aria-label","背景の色: "+p.name);
    b.style.background=`radial-gradient(circle at 40% 35%,${p.c},${p.e})`; b.onclick=()=>setBackground(i); $("bg-box").append(b) });
  let i=0; try{ i=+localStorage.getItem("fvbg")||0 }catch(_){} setBackground(i);
}
// 枠と同じ背景（CSS の radial-gradient（50% 35%、いちばん遠い角まで））をキャンバスに塗る。x,y,w,h＝切り抜く範囲
function paintBackground(g,W,H,x,y,w,h){ const p=APP.bg||BG_PRESETS[0], cx=W/2-x, cy=H*.35-y, grd=g.createRadialGradient(cx,cy,0,cx,cy,Math.hypot(W/2,H*.65));
  grd.addColorStop(0,p.c); grd.addColorStop(1,p.e); g.fillStyle=grd; g.fillRect(0,0,w,h) }
// 一時的に表示を変えて fn を呼ぶ（キャラだけで範囲を測る・背景なしで撮る）
async function withView(opt,fn){ const keep={}; for(const [id,v] of Object.entries(opt)){ keep[id]=$(id).checked; $(id).checked=v }
  if(Object.keys(opt).length) rebuild(); else draw();
  try{ return await fn() } finally{ if(Object.keys(keep).length){ for(const id in keep) $(id).checked=keep[id]; rebuild() } } }
const CHARS_ONLY={"c-stage":false};
// 描いたキャンバスで不透明な画素の範囲（box があれば広げる）と、余白を足して偶数にそろえた範囲（tobal2 と同じ）
const probe=document.createElement("canvas"), probeG=probe.getContext("2d",{willReadFrequently:true});
function opaqueBox(box){ const cv=$("cv"), W=cv.width, H=cv.height; probe.width=W; probe.height=H; probeG.clearRect(0,0,W,H); probeG.drawImage(cv,0,0);
  const d=probeG.getImageData(0,0,W,H).data; let x0=W,y0=H,x1=-1,y1=-1;
  for(let y=0;y<H;y+=2){ const row=y*W; for(let x=0;x<W;x+=2) if(d[(row+x)*4+3]>8){ if(x<x0)x0=x; if(x>x1)x1=x; if(y<y0)y0=y; if(y>y1)y1=y } }
  if(x1<0) return box; x1=Math.min(W,x1+2); y1=Math.min(H,y1+2);
  return box?{x0:Math.min(box.x0,x0),y0:Math.min(box.y0,y0),x1:Math.max(box.x1,x1),y1:Math.max(box.y1,y1)}:{x0,y0,x1,y1} }
function padBox(b){ const cv=$("cv"), W=cv.width, H=cv.height, m=Math.round(Math.max(b.x1-b.x0,b.y1-b.y0)*.04)+4;
  let x0=Math.max(0,b.x0-m), y0=Math.max(0,b.y0-m), x1=Math.min(W,b.x1+m), y1=Math.min(H,b.y1+m);
  if((x1-x0)%2) x1<W?x1++:x0--; if((y1-y0)%2) y1<H?y1++:y0--; return {x:x0,y:y0,w:x1-x0,h:y1-y0} }
// 保存の名前（ASCII だけ。日本語だと「download」になるブラウザがあった）
function fileBase(){ const st=APP.states[APP.cur], b=APP.mode==="disc"?(APP.scene?.names[0]||"fv").replace(".CMP",""):(st?st.name:"fv"); const M=APP.mot, mv=M&&M.m&&APP.scene&&APP.scene.sc!==APP.scene.sc0?`_${M.pl?"2P":"1P"}_move${M.m}`:"";
  return "FV_"+b.replace(/\.p2s$/i,"").replace(/[^\w.-]+/g,"_")+mv+"_v"+VERSION }
function saveBlob(b,name){ const a=document.createElement("a"); a.href=URL.createObjectURL(b); a.download=name; a.hidden=true; document.body.append(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href),60000) }
async function savePng(){
  if(!APP.scene) return; const cv=$("cv"), clear=$("c-clear").checked, crop=$("c-crop").checked, only=APP.mode==="disc"?{}:CHARS_ONLY;
  let r=null; if(crop) await withView(only,()=>{ const b=opaqueBox(null); if(b) r=padBox(b) });
  const blob=await withView(clear?only:{},()=>{ const W=cv.width,H=cv.height; r=r||{x:0,y:0,w:W,h:H};
    const out=document.createElement("canvas"); out.width=r.w; out.height=r.h; const g=out.getContext("2d");
    if(!clear) paintBackground(g,W,H,r.x,r.y,r.w,r.h); g.drawImage(cv,r.x,r.y,r.w,r.h,0,0,r.w,r.h); return new Promise(res=>out.toBlob(res,"image/png")) });
  saveBlob(blob,fileBase()+".png");
}
// ===== 技を1回分、動画（MP4／WebM）かアニメーション PNG に保存（tobal2 のビューアと同じ作り） =====
const rec={busy:false,cancel:false};
async function* motFrames(){ const M=APP.mot; for(let f=1;f<=M.len;f++){ await motSet(M.m,f); yield f } }
async function recordMotion(fmt){
  const M=APP.mot; if(rec.busy||!M||!M.m){ if(!rec.busy) status("先に技を選んでください",true); return }
  rec.busy=true; rec.cancel=false; motStop(); const keepF=M.f, cv=$("cv"), total=M.len;
  const clear=$("c-clear").checked&&fmt==="apng", crop=$("c-crop").checked, prog=t=>$("m-rec").textContent=t;
  try{
    let box=null;
    if(crop) await withView(CHARS_ONLY,async()=>{ for await (const f of motFrames()){ if(rec.cancel) throw new Error("cancel"); if(f%2===1) box=opaqueBox(box); if(f%10===0){ prog(`範囲 ${Math.round(f/total*100)}%`); await new Promise(r=>setTimeout(r)) } } });
    const blob=await withView(clear?CHARS_ONLY:{},async()=>{
      const W=cv.width, H=cv.height, r=crop&&box?padBox(box):{x:0,y:0,w:W-(W%2),h:H-(H%2)};
      const cap=fmt==="apng"?540:1080, sc=Math.min(1,cap/Math.max(r.w,r.h)), ow=Math.max(2,Math.round(r.w*sc/2)*2), oh=Math.max(2,Math.round(r.h*sc/2)*2);
      const out=document.createElement("canvas"); out.width=ow; out.height=oh; const g=out.getContext("2d",{willReadFrequently:fmt==="apng"});
      const paint=()=>{ g.clearRect(0,0,ow,oh); if(!clear){ g.save(); g.scale(ow/r.w,oh/r.h); paintBackground(g,W,H,r.x,r.y,r.w,r.h); g.restore() } g.drawImage(cv,r.x,r.y,r.w,r.h,0,0,ow,oh) };
      return fmt==="video"?encodeVideo(out,paint,total,prog):encodeApng(out,g,paint,total,prog) });
    await motSet(M.m,keepF);
    if(blob) saveBlob(blob,fileBase()+(fmt==="apng"?".png":blob.type.includes("mp4")?".mp4":".webm"));
  }catch(err){ if(err.message!=="cancel"){ console.error(err); status("保存できなかった: "+err.message,true) } await motSet(M.m,keepF) }
  finally{ rec.busy=false; prog("🎬 動画") }
}
// 動画: MediaRecorder に1コマずつ渡す。コマの計算中は録画を一時停止し、各コマをちょうど 1/60 秒ぶん流す
async function encodeVideo(out,paint,total,prog){
  if(!window.MediaRecorder||!out.captureStream) throw new Error("このブラウザは動画の書き出しに対応していません");
  const mime=["video/mp4;codecs=avc1","video/mp4","video/webm;codecs=vp9","video/webm;codecs=vp8","video/webm"].find(t=>MediaRecorder.isTypeSupported(t));
  const stream=out.captureStream(0), track=stream.getVideoTracks()[0], mr=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:8e6}), chunks=[];
  mr.ondataavailable=e=>{ if(e.data.size) chunks.push(e.data) }; const done=new Promise(res=>mr.onstop=res), wait=ms=>new Promise(r=>setTimeout(r,ms));
  let started=false;
  for await (const f of motFrames()){
    if(rec.cancel){ if(started){ mr.stop(); await done } throw new Error("cancel") }
    paint(); if(!started){ mr.start(); started=true } else mr.resume();
    track.requestFrame?track.requestFrame():stream.requestFrame&&stream.requestFrame(); await wait(1000/60); mr.pause();
    if(f%5===0) prog(`書き出し ${Math.round(f/total*100)}%`);
  }
  mr.resume(); await wait(1000/60); mr.stop(); await done;
  const blob=new Blob(chunks,{type:mime.split(";")[0]}); if(blob.size<1000) throw new Error("このブラウザでは動画を作れませんでした（アニメーション PNG なら保存できるかもしれません）");
  return blob;
}
// アニメーション PNG: 30コマ/秒（1コマおき）。RGBA を「上」フィルタで圧縮して並べる
const CRC_T=(()=>{ const t=new Uint32Array(256); for(let n=0;n<256;n++){ let c=n; for(let k=0;k<8;k++) c=c&1?0xedb88320^(c>>>1):c>>>1; t[n]=c>>>0 } return t })();
function pngChunk(type,data){ const b=new Uint8Array(12+data.length), dv=new DataView(b.buffer); dv.setUint32(0,data.length); for(let i=0;i<4;i++) b[4+i]=type.charCodeAt(i); b.set(data,8);
  let c=0xffffffff; for(let i=4;i<8+data.length;i++) c=CRC_T[(c^b[i])&255]^(c>>>8); dv.setUint32(8+data.length,(c^0xffffffff)>>>0); return b }
async function zlibDeflate(u8){ return new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(new CompressionStream("deflate"))).arrayBuffer()) }
async function encodeApng(out,g,paint,total,prog){
  if(!window.CompressionStream) throw new Error("このブラウザはアニメーション PNG の書き出しに対応していません");
  const w=out.width, h=out.height, frames=Math.ceil(total/2), parts=[new Uint8Array([137,80,78,71,13,10,26,10])];
  const u32=(...v)=>{ const b=new Uint8Array(v.length*4), dv=new DataView(b.buffer); v.forEach((x,i)=>dv.setUint32(i*4,x)); return b };
  const ihdr=new Uint8Array(13); ihdr.set(u32(w,h)); ihdr[8]=8; ihdr[9]=6; parts.push(pngChunk("IHDR",ihdr)); parts.push(pngChunk("acTL",u32(frames,0)));
  let seq=0, fi=0; const raw=new Uint8Array((w*4+1)*h);
  for await (const f of motFrames()){
    if(rec.cancel) throw new Error("cancel"); if(!(f%2)) continue;
    paint(); const d=g.getImageData(0,0,w,h).data;
    for(let y=0;y<h;y++){ const o=y*(w*4+1), s=y*w*4; raw[o]=y?2:0; if(y) for(let i=0;i<w*4;i++) raw[o+1+i]=(d[s+i]-d[s-w*4+i])&255; else raw.set(d.subarray(0,w*4),o+1) }
    const fc=new Uint8Array(26); fc.set(u32(seq++,w,h,0,0)); new DataView(fc.buffer).setUint16(20,1); new DataView(fc.buffer).setUint16(22,30); parts.push(pngChunk("fcTL",fc));
    const z=await zlibDeflate(raw); if(fi===0) parts.push(pngChunk("IDAT",z)); else { const fd=new Uint8Array(4+z.length); fd.set(u32(seq++)); fd.set(z,4); parts.push(pngChunk("fdAT",fd)) }
    fi++; prog(`書き出し ${Math.round(f/total*100)}%`);
  }
  parts.push(pngChunk("IEND",new Uint8Array(0))); return new Blob(parts,{type:"image/png"});
}
function init(){
  $("ver").textContent="版 "+VERSION; $("ver-h").textContent="v"+VERSION;
  try{ APP.gl=vglNew($("cv")) }catch(e){ status(e.message,true); return }
  hookInput(); hookDrop(); hookBackground(); draw();
  $("f-disc").onchange=e=>loadDisc(e.target.files[0]);
  $("f-state").onchange=e=>loadStates(e.target.files);
  for(const id of ["c-p1","c-p2","c-shadow","c-stage"]) $(id).onchange=rebuild;
  $("c-smooth").onchange=draw;
  $("c-overlay").onchange=()=>$("viewer").classList.toggle("overlay",$("c-overlay").checked);
  $("b-reset").onclick=resetView; $("b-png").onclick=savePng;
  $("m-num").onchange=()=>{ motStop(); motSet(+$("m-num").value,1) };
  $("m-name").onchange=()=>{ const v=+$("m-name").value; if(!v) return; motStop(); motSet(v,1) };
  $("m-prev").onclick=()=>{ motStop(); motSet(Math.max(1,+$("m-num").value-1),1) }; $("m-next").onclick=()=>{ motStop(); motSet(Math.min(MOT_MAX,+$("m-num").value+1),1) };
  $("m-frame").oninput=()=>{ motStop(); motSet(APP.mot&&APP.mot.m?APP.mot.m:+$("m-num").value,+$("m-frame").value) };
  $("m-play").onclick=()=>motPlay(); $("m-rand").onclick=motRandom; $("m-back").onclick=motBack; $("m-pl").onchange=()=>motBack();
  $("m-fprev").onclick=()=>motStep(-1); $("m-fnext").onclick=()=>motStep(1);
  $("m-rec").onclick=e=>{ e.stopPropagation(); if(rec.busy){ rec.cancel=true; return } $("rec-menu").hidden=!$("rec-menu").hidden };
  $("rec-menu").onclick=e=>{ const b=e.target.closest("button"); if(!b) return; e.stopPropagation(); $("rec-menu").hidden=true; recordMotion(b.dataset.fmt) };
  document.addEventListener("click",()=>{ $("rec-menu").hidden=true });
  // キー: ← → でコマ送り、スペースで再生・止める（技の欄が出ているとき。文字を打つ欄では使わない）
  document.addEventListener("keydown",e=>{ if($("motview").hidden||rec.busy||e.target.closest("input:not([type=range]),select,textarea")) return;
    if(e.key==="ArrowLeft"){ e.preventDefault(); motStep(-1) } else if(e.key==="ArrowRight"){ e.preventDefault(); motStep(1) } else if(e.key===" "){ e.preventDefault(); motPlay() } });
  $("s-char").onchange=()=>{ APP.dv=null; showDisc() }; $("b-prev").onclick=()=>stepPart(-1); $("b-next").onclick=()=>stepPart(1); $("b-all").onclick=()=>stepPart(0);
}
init();
