// ページの操作。ディスク（形と絵）とステートセーブ（選手の表・ユニフォームの絵）を開く → 選手を選ぶ → その選手の顔と髪と体を描く
const VERSION="0.10.0";
const $=id=>document.getElementById(id);
const APP={drawSeq:0,file:null,disc:null,players:[],teams:[],shown:[],cache:new Map(),view:{yaw:0,pitch:0.1,dist:3000,target:[0,0,0]},base:null,gl:null,cur:null};
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
// 体の形（#1429）。ディスクごとに 1 回だけ読む。読めなければ null
async function getBody(){
  if(APP.body!==undefined) return APP.body;
  try{ const B=jwBodyParse(await getFile(JW_BODY)); APP.body={B,cur:jwBodyStand(B),hands:null};
    fillMotions();
    // 手は別のファイル。読めなくても体は出す
    try{ APP.body.hands=await getFile(JW_HANDS) }catch(e){ console.warn("手のファイルが読めません",e) } }
  catch(e){ console.warn("体のファイルが読めません",e); APP.body=null }
  return APP.body;
}
async function openDisc(file){
  status("ディスクを開いています…"); $("n-disc").textContent=file.name;
  try{
    const disc=await weOpen(file);
    Object.assign(APP,{file,disc,cache:new Map(),base:null,common:undefined,body:undefined,motions:undefined,motT:0});
    $("step-disc").classList.add("done"); $("anyfile").hidden=false; $("n-file").max=disc.ents.length-1;
    status(`${disc.from==="ISO"?"ISO の中の ":""}0_TEXT.AFS: ${disc.ents.length} 個のファイル`+(APP.players.length?"":"。次にステートセーブを選んでください"));
    if(APP.players.length) show(); else $("empty").textContent="ステートセーブを選ぶと、選手の一覧が出ます（「番号で見る」でファイルの中身も見られます）";
  }catch(e){ status(e.message,true); console.error(e) }
}
async function openSave(file){
  status("ステートセーブを読んでいます…"); $("n-save").textContent=file.name;
  try{
    const mem=await jwP2sMemory(file), players=jwPlayers(mem);
    APP.players=players; APP.teams=jwTeams(mem,players); APP.kits=jwSaveKits(mem); APP.saveMot=jwSaveMotions(mem);
    // ボール（試合中のセーブだけ。形はメモリ、絵は画面用メモリから）
    try{ APP.ball=jwSaveBall(mem,await jwP2sVram(file)) }catch(e){ console.warn("ボールが読めません",e); APP.ball=null }
    $("l-ball").hidden=!APP.ball; APP.motions=undefined; APP.motT=0; $("step-save").classList.add("done");
    if(APP.body) fillMotions();
    fillKits(); $("bodybar").hidden=false; $("kitbar").hidden=false;
    fillTeams(); $("q").value=""; fillPlayers(); $("pick").hidden=false;
    status(`選手 ${players.length} 人・チーム ${APP.teams.length}`+(APP.disc?"":"。次にディスクのイメージを選んでください"));
    show(); if(!APP.disc) $("empty").textContent="ディスクのイメージを選ぶと、顔・髪と体が出ます";
  }catch(e){ status(e.message,true); console.error(e) }
}
// 自分で描いたユニフォームの絵（v0.8.0）。下絵＝体の服の割り付けの線と部分の名前（透明の背景、1024×512）
function saveCanvas(cv,name){ cv.toBlob(b=>{ const a=document.createElement("a"); a.href=URL.createObjectURL(b); a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),5000) },"image/png") }
async function kitTemplate(){ const body=await getBody(); if(!body){ status("下絵には体のファイル（ディスク）が要ります",true); return }
  const W=1024, H=512, cv=document.createElement("canvas"); cv.width=W; cv.height=H; const x=cv.getContext("2d"), parts=jwKitLayout(body.B,body.cur);
  const cols=["#e53935","#43a047","#1e88e5","#fdd835","#d81b60","#00acc1","#fb8c00","#8e24aa","#7cb342","#5e35b1"];
  parts.forEach((p,k)=>{ x.strokeStyle=cols[k%cols.length]; x.lineWidth=1; x.beginPath();
    for(const t of p.tris){ x.moveTo(t[0][0]*W,t[0][1]*H); x.lineTo(t[1][0]*W,t[1][1]*H); x.lineTo(t[2][0]*W,t[2][1]*H); x.closePath() } x.stroke() });
  x.font="bold 18px sans-serif"; x.textAlign="center"; x.textBaseline="middle"; x.lineJoin="round";
  const label=(u,v,t)=>{ x.lineWidth=4; x.strokeStyle="#000"; x.strokeText(t,u*W,v*H); x.fillStyle="#fff"; x.fillText(t,u*W,v*H) };
  for(const p of parts){ if(!p.name) continue; const us=p.tris.flat(); label(us.reduce((a,u)=>a+u[0],0)/us.length,us.reduce((a,u)=>a+u[1],0)/us.length,p.name) }
  for(const [u,v,t] of JW_KIT_LABELS) label(u,v,t);
  saveCanvas(cv,"jwe2010_kit_template.png") }
function kitCurrent(){ const k=curKit(); if(!k){ status("ユニフォームの絵がありません",true); return }
  const cv=document.createElement("canvas"); cv.width=k.W; cv.height=k.H; cv.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(k.rgba),k.W,k.H),0,0);
  saveCanvas(cv,`jwe2010_kit_${k===APP.customKit?"custom":String($("s-kit").value*1+1)}.png`) }
// 読み込んだ絵は 1024×512（幅 1024 以上のとき）か 512×256 に合わせる（2 のべき乗でないと繰り返しが使えない）。背番号の字は選んでいたセーブのユニフォームのもの
async function openKit(file){
  try{ const im=await createImageBitmap(file), big=im.width>=1024, W=big?1024:512, H=big?512:256, cv=document.createElement("canvas"); cv.width=W; cv.height=H;
    const x=cv.getContext("2d"); x.drawImage(im,0,0,W,H); const base=curKit()!==APP.customKit?curKit():APP.customKit?.base||null;
    APP.customKit={id:"custom",name:file.name,W,H,rgba:new Uint8Array(x.getImageData(0,0,W,H).data.buffer),fonts:base?.fonts||null,base};
    fillKits(); $("s-kit").value="c"; status(`ユニフォームの絵 ${file.name}（${im.width}×${im.height} → ${W}×${H}）`); if(APP.cur?.kind==="player") show(APP.cur) }
  catch(e){ status("絵が読めません: "+e.message,true); console.error(e) } }
// 自分の字（v0.9.0）。字の下絵＝いまのユニフォームの字を同じ並び（256×96）で。読み込んだ字は、どのユニフォームでも使う
function fontTemplate(){ const k=curKit(); if(!k?.fonts){ status("このユニフォームの字がセーブにありません",true); return }
  const cv=document.createElement("canvas"); cv.width=256; cv.height=96; cv.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(jwFontToRGBA(k.fonts)),256,96),0,0);
  saveCanvas(cv,"jwe2010_font_template.png") }
async function openFont(file){
  try{ const im=await createImageBitmap(file), cv=document.createElement("canvas"); cv.width=im.width; cv.height=im.height;
    const x=cv.getContext("2d"); x.drawImage(im,0,0); APP.customFont=jwFontFromRGBA(x.getImageData(0,0,im.width,im.height).data,im.width,im.height);
    $("l-font").hidden=false; $("c-font").checked=true; status(`字の絵 ${file.name}`); if(APP.cur?.kind==="player") show(APP.cur) }
  catch(e){ status("字の絵が読めません: "+e.message,true); console.error(e) } }
function openAny(file){ if(/\.p2s$/i.test(file.name)) openSave(file); else openDisc(file) }
// チームの一覧。最初は 0 番（ベガルタ仙台）。「全員」で選手の表の全部
function fillTeams(){
  const esc=x=>x.replace(/[&<]/g,c=>c==="&"?"&amp;":"&lt;");
  $("s-team").innerHTML=['<option value="">全員</option>',...APP.teams.map(t=>`<option value="${t.i}">${esc(t.name)}（${t.members.length}）</option>`)].join("");
  $("s-team").hidden=!APP.teams.length; if(APP.teams.length) $("s-team").value=String(APP.teams[0].i);
}
// ユニフォームの一覧（セーブの中にあるもの）。最初は 1 着目（関口・田村のセーブでは仙台のホーム。ほかのセーブでは別のチームのこともある）
function curKit(){ const v=$("s-kit").value; return v==="c"?APP.customKit||null:APP.kits?.kits[+v]||null }
function fillKits(){
  const k=APP.kits?.kits||[], esc=s=>s.replace(/[&<]/g,c=>c==="&"?"&amp;":"&lt;");
  $("s-kit").innerHTML=(k.length?k.map((x,i)=>`<option value="${i}">${i+1} 着目</option>`).join(""):'<option value="">セーブに無い</option>')
    +(APP.customKit?`<option value="c">読み込んだ絵（${esc(APP.customKit.name)}）</option>`:"");
  if(k.length) $("s-kit").value="0";
}
// チームと名前で絞った一覧。チームは名簿の並び、全員は選手の表の順。表の順番（番号）も出す
function fillPlayers(){
  const q=$("q").value.trim().toLowerCase(), keep=$("s-player").value, tm=APP.teams.find(t=>String(t.i)===$("s-team").value);
  const base=tm?tm.members.map(i=>APP.players[i]):APP.players;
  APP.shown=base.filter(p=>!q||p.name.toLowerCase().includes(q)||p.shirt.toLowerCase().includes(q));
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
      // 体: 頭は骨 16（頭）の行列で体に付ける。ユニフォームとスパイクの絵はセーブから、肌は頭の生え際と同じ絵
      const body=$("c-body").checked?await getBody():null;
      APP.rig=null;
      if(body){ const kit=curKit(), boots=APP.kits?.boots||null;
        const opts=jwBodyOpts($("c-long").checked,$("c-studs").checked);
        // 背番号と名前。番号は選んでいるチーム、無ければその選手がいる最初のチームの番号表から
        // 字は読み込んだ字（チェックが入っていれば）、無ければユニフォームの字。色はユニフォームの色表のまま
        const fonts=kit&&kit.fonts?(APP.customFont&&$("c-font").checked?{...kit.fonts,...APP.customFont}:kit.fonts):null;
        let num=null, wantNum=$("c-num").checked&&fonts;
        if($("c-num").checked){ const tm=[APP.teams.find(t=>String(t.i)===$("s-team").value),...APP.teams].find(t=>t&&t.members.includes(c.p.i)); num=tm?tm.numbers[tm.members.indexOf(c.p.i)]:null;
          // 手で入れた番号・名前（v0.9.0）があればそちら
          const nIn=$("n-num").value.trim(); if(nIn!==""&&+nIn>=0&&+nIn<=99) num=+nIn;
          if(kit&&kit.fonts){ if(num==null) warn.push("背番号が分からない") } else if(kit) warn.push("このユニフォームの背番号の字がセーブに無い") }
        const shirtName=$("t-name").value.trim()||c.p.shirt;
        let hands=body.hands; if(!hands) warn.push(`手のファイル #${JW_HANDS} が読めません`);
        // 姿（骨ごとの行列）から形を作る。動きの再生ではこれをこまごとに呼ぶ（頭の形は元を写してから付ける）
        const headBase=r.meshes.map(m=>({...m,f:m.f.slice()}));
        const build=cur=>{ const out=[];
          if(hands){ try{ out.push(...jwHandMeshes(hands,cur,common?.ring||null)) }catch(e){ hands=null; warn.push(`手 #${JW_HANDS} が読めません`) } }
          out.push(...jwBodyMeshes(body.B,cur,{0:common?.ring||null,1:kit,5:boots},opts));
          out.push(...jwPlaceHead(headBase.map(m=>({...m,f:m.f.slice()})),cur[16]));
          // ボール: 両足の前（つま先の少し先）の地面の上。立ち姿の足の裏は高さ 0、つま先は −z の向き。動きの再生中も同じ所
          if(APP.ball&&$("c-ball").checked) out.push(...jwBallMeshes(APP.ball,[0,5.6*JW_BALL_SCALE,-140]));
          // 背番号と名前は服の上に重ねるので最後に描く
          // 胸の番号（出し分け 15）はチェックで消せる（2026 年のユニフォームなど、胸に番号の無いもの）
          if(wantNum) out.push(...jwOverlayMeshes(body.B,cur,fonts,$("c-chest").checked?opts:new Set([...opts].filter(o=>o!==15)),shirtName,num));
          return out };
        APP.rig={build,B:body.B};
        r.meshes=build(motPose()||body.cur);
        if(kit) r.texs.push({...kit,from:kit===APP.customKit?`読み込んだ絵 ${kit.name}`:`セーブのユニフォーム ${+$("s-kit").value+1}`}); else warn.push("ユニフォームの絵がセーブに無いので、体は灰色");
        if(boots) r.texs.push({...boots,from:"セーブのスパイク"}) }
      else if($("c-body").checked) warn.push(`体のファイル #${JW_BODY} が読めません`);
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
// 動き（v0.6.0）。#1360 の動きを番号で選んで再生する。こまの間は向きを球面で補う。動きの選び方・こまの送り方はゲームと同じとは限らない
async function getMotions(){
  if(APP.motions!==undefined) return APP.motions;
  // セーブのメモリに動きの表があればそれ（試合中のセーブで 1,466 個）、無ければディスクの #1360（485 個）
  if(APP.saveMot){ APP.motions={...APP.saveMot,cache:new Map(),from:"save"}; return APP.motions }
  try{ const u=await getFile(JW_MOTIONS); APP.motions={u,list:jwMotionList(u),cache:new Map(),from:"disc"} }catch(e){ console.warn("動きのファイルが読めません",e); APP.motions=null }
  return APP.motions;
}
function motData(){ const M=APP.motions, i=$("s-mot").value; if(!M||i==="") return null;
  if(!M.cache.has(i)) M.cache.set(i,jwMotionFrames(M.u,M.list[+i])); const d=M.cache.get(i); return d.frames.length?d:null }
// いまの姿。時刻 APP.motT（秒）から、こま（長さを こま数−1 で割った間隔）と間の t
function motPose(){ const d=motData(), B=APP.rig?.B||APP.body?.B; if(!d||!B) return null;
  const n=d.frames.length; if(n===1) return jwMotionPose(B,d.frames[0]);
  const step=d.dur>0?d.dur/(n-1):1/30, x=Math.max(0,Math.min(n-1,(APP.motT||0)/step)), f=Math.min(n-2,Math.floor(x));
  return jwMotionPose(B,d.frames[f],d.frames[f+1],x-f) }
function motUpdate(){ const d=motData(); if(!APP.rig) return;
  const cur=motPose()||APP.body.cur; APP.gl.geom(APP.rig.build(cur));
  if(d){ const n=d.frames.length, step=d.dur>0?d.dur/(n-1):1/30; $("r-mot").max=String(n-1); $("r-mot").value=String(Math.round((APP.motT||0)/step)); $("t-mot").textContent=`こま ${Math.round((APP.motT||0)/step)}／${n-1}・${(APP.motT||0).toFixed(2)}／${d.dur.toFixed(2)} 秒` }
  draw() }
function motPlay(on){ APP.motPlaying=on??!APP.motPlaying; $("b-mot").textContent=APP.motPlaying?"⏸ 止める":"▶ 再生";
  if(!APP.motPlaying) return; let last=performance.now();
  const tick=now=>{ if(!APP.motPlaying) return; const d=motData(); if(!d){ motPlay(false); return }
    APP.motT=((APP.motT||0)+(now-last)/1000)%Math.max(d.dur,1/30); last=now; motUpdate(); requestAnimationFrame(tick) };
  requestAnimationFrame(tick) }
function motStep(k){ const d=motData(); if(!d) return; motPlay(false); const n=d.frames.length, step=d.dur>0?d.dur/(n-1):1/30;
  const f=(Math.round((APP.motT||0)/step)+k+n)%n; APP.motT=f*step; motUpdate() }
async function fillMotions(){ const M=await getMotions(); if(!M){ $("s-mot").innerHTML='<option value="">立ち姿（動きのファイルが読めない）</option>'; return }
  // 見た目の区分ごとにまとめる（区分は推測）。区分を出すのに全部のこまを組むので、最初の 1 回だけ少し待つ
  if(!M.kinds){ const B=(await getBody())?.B; M.kinds=M.list.map(e=>{ const d=jwMotionFrames(M.u,e); M.cache.set(String(e.i),d); return {n:d.frames.length,kind:B?jwMotionKind(B,d):"その場の動き"} }) }
  const esc=s=>s.replace(/[&<]/g,c=>c==="&"?"&amp;":"&lt;");
  const sv=M.from==="save", lab=e=>`動き ${e.i}${sv&&JW_MOTION_NAMES[e.i]?"・"+JW_MOTION_NAMES[e.i]:""}（${M.kinds[e.i].n} こま${sv&&e.i>=JW_MOTION_FIXED?"・場面ごとの枠":""}）`;
  const named=sv?M.list.filter(e=>JW_MOTION_NAMES[e.i]&&M.kinds[e.i].n):[];
  $("s-mot").innerHTML=`<option value="">立ち姿（動き: ${sv?"セーブのメモリの表":"ディスクの #1360"}）</option>`
    +(named.length?`<optgroup label="名前の分かった動き（${named.length}）">`+named.map(e=>`<option value="${e.i}">${esc(lab(e))}</option>`).join("")+"</optgroup>":"")
    +JW_MOTION_KINDS.map(k=>{ const es=M.list.filter(e=>M.kinds[e.i].kind===k&&M.kinds[e.i].n&&!JW_MOTION_NAMES[sv?e.i:-1]);
    return es.length?`<optgroup label="${esc(k)}（${es.length}）">`+es.map(e=>`<option value="${e.i}">${esc(lab(e))}</option>`).join("")+"</optgroup>":"" }).join("");
  $("motbar").hidden=!motData() }
function showTexs(texs){
  const box=$("texs"); box.innerHTML="";
  for(const t of texs){ const fig=document.createElement("figure"), cv=document.createElement("canvas"); cv.width=t.W; cv.height=t.H;
    if(t.rgba){ const im=new ImageData(new Uint8ClampedArray(t.rgba),t.W,t.H); cv.getContext("2d").putImageData(im,0,0) }
    cv.style.width=Math.min(160,t.W*(t.W<=64?2:1))+"px";
    fig.append(cv,`#${t.from} ${t.W}×${t.H}${t.rgba?"":"（まだ読めない形式）"}`); box.append(fig) }
}
function resetCam(){ if(!APP.base) return; Object.assign(APP.view,{yaw:0,pitch:0.1,target:APP.base.target.slice(),dist:APP.base.h*2.6,pan:[0,0]}); draw() }
function draw(){ if(APP.gl) APP.gl.draw(APP.view,$("c-clear").checked?[0,0,0,0]:null) }
function step(sel,d){ const o=sel.options; if(!o.length) return; sel.selectedIndex=(sel.selectedIndex+d+o.length)%o.length; sel.onchange() }
// 背景の色（tobal1・vf2・fv のビューアと同じ 8 種。選んだものは覚えておく。ルートの CLAUDE.md の決まり 8）。PNG にも同じ背景を塗る
const BG_PRESETS=[{name:"ダーク",c:"#3a3834",e:"#2a2926"},{name:"黒",c:"#111111",e:"#000000"},{name:"グレー",c:"#8a8a8a",e:"#6a6a6a"},{name:"白",c:"#ffffff",e:"#e6e4df"},
  {name:"空",c:"#bfe3ff",e:"#5a9fd6"},{name:"夕焼け",c:"#ffcf8a",e:"#c4533a"},{name:"夜",c:"#35407a",e:"#0d1030"},{name:"グリーンバック",c:"#00b140",e:"#00b140"}];
function setBackground(i){ const p=BG_PRESETS[i]||BG_PRESETS[0], v=$("viewer").style; v.setProperty("--stage2",p.c); v.setProperty("--stage",p.e); APP.bg=p;
  [...$("bg-box").children].forEach((b,k)=>b.setAttribute("aria-pressed",String(k===i))); try{ localStorage.setItem("jwebg",String(i)) }catch(_){} }
function hookBackground(){
  BG_PRESETS.forEach((p,i)=>{ const b=document.createElement("button"); b.title=p.name; b.setAttribute("aria-label","背景の色: "+p.name);
    b.style.background=`radial-gradient(circle at 40% 35%,${p.c},${p.e})`; b.onclick=()=>setBackground(i); $("bg-box").append(b) });
  let i=0; try{ i=+localStorage.getItem("jwebg")||0 }catch(_){} setBackground(i) }
// PNG: 透明に描いてから、枠と同じ背景（50% 35% からいちばん遠い角まで）の上に重ねる（「背景なし」なら透明のまま）
function savePng(){
  APP.gl.draw(APP.view,[0,0,0,0]);
  const cv0=$("cv"), W=cv0.width, H=cv0.height, out=document.createElement("canvas"); out.width=W; out.height=H; const g=out.getContext("2d");
  if(!$("c-clear").checked){ const p=APP.bg||BG_PRESETS[0], grd=g.createRadialGradient(W/2,H*.35,0,W/2,H*.35,Math.hypot(W/2,H*.65)); grd.addColorStop(0,p.c); grd.addColorStop(1,p.e); g.fillStyle=grd; g.fillRect(0,0,W,H) }
  g.drawImage(cv0,0,0);
  out.toBlob(b=>{ const a=document.createElement("a"); a.href=URL.createObjectURL(b); const c=APP.cur;
    a.download=c.kind==="player"?`jwe2010_${c.p.shirt||c.p.i}_face${c.p.face}_hair${c.p.hair}.png`:`jwe2010_${c.n}.png`; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),5000); draw() },"image/png");
}
function init(){
  $("ver-h").textContent="v"+VERSION; $("ver").textContent="版 "+VERSION;
  try{ APP.gl=weGL($("cv")) }catch(e){ status(e.message,true) }
  if(typeof DecompressionStream==="undefined") status("このブラウザはファイルの展開に必要な機能に対応していません。iPhone は iOS 16.4 以降にしてください",true);
  $("f-disc").onchange=e=>{ const f=e.target.files[0]; if(f) openDisc(f) };
  $("f-save").onchange=e=>{ const f=e.target.files[0]; if(f) openSave(f) };
  $("s-player").onchange=()=>show();
  // チームを変えたら名前の絞り込みは消す（前の名前が残って 0 人にならないように）
  $("s-team").onchange=()=>{ $("q").value=""; fillPlayers(); if(APP.shown.length) show() };
  $("q").oninput=()=>{ fillPlayers(); if(APP.shown.length&&(APP.cur?.kind!=="player"||String(APP.cur.p.i)!==$("s-player").value)) show() };
  $("p-prev").onclick=()=>step($("s-player"),-1); $("p-next").onclick=()=>step($("s-player"),1);
  $("b-rand").onclick=()=>{ const o=$("s-player").options; if(!o.length) return; $("s-player").selectedIndex=Math.floor(Math.random()*o.length); show() };
  $("b-file").onclick=()=>{ if(APP.disc) show({kind:"file",n:Math.max(0,Math.min(APP.disc.ents.length-1,+$("n-file").value|0))}) };
  $("n-file").onkeydown=e=>{ if(e.key==="Enter") $("b-file").click() };
  $("c-all").onchange=()=>show(APP.cur);
  // 体の有り無しで大きさが変わるので、見る位置を作り直す
  $("c-body").onchange=()=>{ APP.base=null; if(APP.cur?.kind==="player") show(APP.cur) };
  $("s-kit").onchange=()=>{ if(APP.cur?.kind==="player") show(APP.cur) };
  $("c-ball").onchange=$("n-num").oninput=$("t-name").oninput=$("c-chest").onchange=$("c-font").onchange=()=>{ if(APP.cur?.kind==="player") show(APP.cur) };
  $("b-fonttpl").onclick=fontTemplate; $("f-font").onchange=e=>{ const f=e.target.files[0]; if(f) openFont(f); e.target.value="" };
  $("b-kittpl").onclick=kitTemplate; $("b-kitcur").onclick=kitCurrent; $("f-kit").onchange=e=>{ const f=e.target.files[0]; if(f) openKit(f); e.target.value="" };
  $("c-long").onchange=$("c-studs").onchange=$("c-num").onchange=()=>{ if(APP.cur?.kind==="player") show(APP.cur) };
  // 動き: 選ぶ・再生・こま送り（← →・スペース。ほかのビューアと同じ）
  $("s-mot").onchange=()=>{ APP.motT=0; motPlay(false); const d=motData(); $("motbar").hidden=!d; if(APP.rig) motUpdate() };
  $("b-mot").onclick=()=>motPlay(); $("r-mot").oninput=()=>{ const d=motData(); if(!d) return; motPlay(false); const n=d.frames.length; APP.motT=+$("r-mot").value*(d.dur>0?d.dur/(n-1):1/30); motUpdate() };
  document.addEventListener("keydown",e=>{ if(!motData()||e.target.closest("input:not([type=range]),select,textarea")) return;
    if(e.key==="ArrowLeft"){ e.preventDefault(); motStep(-1) } else if(e.key==="ArrowRight"){ e.preventDefault(); motStep(1) } else if(e.key===" "){ e.preventDefault(); motPlay() } });
  $("b-png").onclick=savePng; $("c-clear").onchange=draw; hookBackground();
  // 回す・動かす・寄る（tobal1・vf2・fv のビューアと同じ操作）: ドラッグで回す。Shift を押しながら（または右・中ボタンで）ドラッグすると平行に動かす。
  // ホイールはカーソルの下の物が動かないように寄る。2本指はピンチで寄り、指の中ほどの移動で平行に動く。ダブルクリックで戻す
  const cv=$("cv"), pts=new Map(); let pinch=0, last=null, mode=null;
  // 画面の 1 ピクセルが、見ている所（target）の深さで形の何単位か
  const unit=()=>{ const f=1/Math.tan((APP.view.fov||30)*Math.PI/360); return 2*APP.view.dist/(f*cv.clientHeight) };
  const panBy=(dx,dy)=>{ const u=unit(), p=APP.view.pan||(APP.view.pan=[0,0]); p[0]+=dx*u; p[1]-=dy*u };
  // 寄る。ox,oy＝画面の真ん中から見たカーソルの位置（ピクセル）。その下の物が動かないように平行にもずらす
  const zoom=(k,ox=0,oy=0)=>{ if(!APP.base) return; const u0=unit();
    APP.view.dist=Math.max(APP.base.h*0.3,Math.min(APP.base.h*20,APP.view.dist*k)); const du=unit()-u0, p=APP.view.pan||(APP.view.pan=[0,0]);
    p[0]+=ox*du; p[1]-=oy*du; draw() };
  const mid=(x,y)=>{ const r=cv.getBoundingClientRect(); return [x-(r.left+r.width/2),y-(r.top+r.height/2)] };
  cv.addEventListener("contextmenu",e=>e.preventDefault());
  cv.addEventListener("pointerdown",e=>{ cv.setPointerCapture(e.pointerId); pts.set(e.pointerId,[e.clientX,e.clientY]); last=[e.clientX,e.clientY];
    mode=pts.size>=2?"pinch":(e.shiftKey||e.button===1||e.button===2)?"pan":"rotate" });
  cv.addEventListener("pointermove",e=>{ if(!pts.has(e.pointerId)) return; const prev=pts.get(e.pointerId); pts.set(e.pointerId,[e.clientX,e.clientY]);
    if(pts.size===2){ const [a,b]=[...pts.values()], d=Math.hypot(a[0]-b[0],a[1]-b[1]);
      panBy((e.clientX-prev[0])/2,(e.clientY-prev[1])/2);
      if(pinch) zoom(pinch/d,...mid((a[0]+b[0])/2,(a[1]+b[1])/2)); else draw(); pinch=d; return }
    if(!last) return; const dx=e.clientX-last[0], dy=e.clientY-last[1]; last=[e.clientX,e.clientY];
    if(mode==="pan"||e.shiftKey) panBy(dx,dy);
    else { APP.view.yaw+=dx*0.01; APP.view.pitch=Math.max(-1.5,Math.min(1.5,APP.view.pitch+dy*0.01)) }
    draw() });
  const up=e=>{ pts.delete(e.pointerId); if(pts.size<2) pinch=0; last=pts.size?[...pts.values()][0]:null; if(!pts.size) mode=null; else if(mode==="pinch") mode="pan" };
  cv.addEventListener("pointerup",up); cv.addEventListener("pointercancel",up);
  cv.addEventListener("wheel",e=>{ e.preventDefault(); zoom(Math.exp(e.deltaY*0.001),...mid(e.clientX,e.clientY)) },{passive:false});
  cv.addEventListener("dblclick",resetCam);
  const vw=$("viewer");
  document.addEventListener("dragover",e=>{ e.preventDefault(); vw.classList.add("drop-over") });
  document.addEventListener("dragleave",e=>{ if(!e.relatedTarget) vw.classList.remove("drop-over") });
  document.addEventListener("drop",e=>{ e.preventDefault(); vw.classList.remove("drop-over"); for(const f of e.dataTransfer.files) openAny(f) });
  addEventListener("resize",draw);
}
init();
