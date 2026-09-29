// VF2 と FV を 1 つの場面に（crossshot.mjs と同じ置き方）: VF2 の写しの 2P の代わりに、FV の写しのキャラを置いて、2 人とも技を出す。
// FV の処理は FVX（assemble.py が FV ビューアのソースを包んだもの）。姿勢はそれぞれのゲームのプログラムで計算し、色・テクスチャ・光の強さもそれぞれのゲームのもの。
// 置き方: FV の世界を y 軸まわりに回して動かし、FV のキャラの腰を VF2 の 2P の腰の所へ、FV で相手を向いていた向きを VF2 の 2P が 1P を向く向きに合わせる
// （VF2 と FV は同じ大きさの座標で床は y＝0）。カメラ・背景・光の向きは VF2 の写しのもの。描くのは同じ WebGL・同じ奥行きで、VF2 のあとに FV を重ねる
const XV={disc:null, rom:null, objCache:new Map(), st:null, ready:null, gl:null, m:0, len:0};
function xOn(){ return !!(XV.ready&&$("x-on").checked&&APP.mode==="state"&&APP.scene) }
async function xReadDec(n){ const f=XV.disc.get(n); if(!f) throw new Error("FV のディスクに "+n+" が無い"); return cricmpUnpack(await f()) }
async function xReadObj(n){ if(!XV.objCache.has(n)){ const f=XV.disc.get(n); if(!f) return null; XV.objCache.set(n,new Map(objModels(cricmpUnpack(await f())).map(e=>[e.id,e]))) } return XV.objCache.get(n) }
async function xLoadDisc(f){ if(!f) return;
  try{ status("FV のディスクを読み込み中…"); XV.disc=await FVX.discOpen(f); XV.rom=null; XV.objCache.clear(); XV.ready=null; XV.cmd=null;
    $("x-ndisc").textContent=f.name; status(""); await xPrepare() }catch(err){ console.error(err); status("FV のディスクを読めなかった: "+err.message,true) } }
async function xLoadState(f){ if(!f) return;
  try{ const z=await p2sOpen(await f.arrayBuffer()), v1=z.get("vu1Memory.bin"); XV.st={name:f.name, mem:await z.get("eeMemory.bin")(), vu1:v1?await v1():null}; XV.ready=null;
    $("x-nstate").textContent=f.name; await xPrepare() }catch(err){ console.error(err); status("FV の写しを読めなかった: "+err.message,true) } }
// FV のキャラを用意する（ディスクと写しがそろったとき・1P/2P を変えたとき）
async function xPrepare(){
  XV.ready=null; $("x-on").disabled=true;
  if(!XV.disc||!XV.st){ if(XV.disc||XV.st) status(XV.disc?"FV の写し（.p2s）も選んでください":"FV のディスクも選んでください"); return }
  try{
    status("FV のキャラの用意…"); await new Promise(r=>setTimeout(r));
    if(!XV.rom){ const R={}; for(const [k,n] of [["prog","ROM_CODE1"],["data","ROM_DATA"],["ep1","ROM_EP1"],["ep2","ROM_EP2"]]) R[k]=await xReadDec(n+".CMP"); XV.rom=R }
    const pl=+$("x-pl").value, mem=XV.st.mem, E=FVX.motEngine(XV.rom.prog,mem,XV.rom), pick=FVX.motPickScene(mem,E.units(1));
    if(!pick) throw new Error("FV の写しに、関節と同じコマの命令の列が見つからない");
    const sc=pick.sc, col=FVX.sceneColors(mem), light0=FVX.sceneLight(XV.st.vu1,sc);
    // キャラのファイル: 描いた番号をいちばん多く含む OBJ_ROBnn（＋R・共通 OBJ_COMMON）。FV のビューアと同じ選び方
    const ids=sc.draws.filter(d=>d.player===pl).map(d=>d.id); let best=[null,0];
    for(const n of [...XV.disc.keys()].filter(n=>/^OBJ_ROB\d+\.CMP$/.test(n)).sort()){ const m=await xReadObj(n), k=ids.filter(i=>m.has(i)).length; if(k>best[1]) best=[n,k] }
    if(!best[0]) throw new Error("FV の写しのキャラのファイルが見つからない");
    const file=await xReadObj(best[0]), fileR=await xReadObj(best[0].replace(".CMP","R.CMP")), common=await xReadObj("OBJ_COMMON.CMP")||new Map(), fm=new Map(file);
    for(const x of [fileR,common]) if(x) for(const [k,v] of x) if(!fm.has(k)) fm.set(k,v);
    FVX.sceneAssignCommon(sc,id=>common.has(id),(p,id)=>p===pl&&(file.has(id)||!!fileR&&fileR.has(id)));
    const att=FVX.motAttach(sc,pl,[E.units(pl)],null,d=>d.dyn||fm.has(d.id)), U0=E.units(pl);
    status("FV のテクスチャを展開中…"); await new Promise(r=>setTimeout(r));
    const pages=FVX.fvArcPages(XV.rom,[pl?null:best[0],pl?best[0]:null,null]);
    if(!XV.gl) XV.gl=FVX.vglNew($("cv"));
    XV.colKey=null; XV.gl.setArc(pages,FVX.fvArcMips(pages));
    XV.ready={pl,E,sc,col,light0,fm,att,U0,pB:U0[0].slice(9),pH:E.units(1-pl)[0].slice(9),file:best[0].replace(".CMP",""),cid:E.mem.r8(E.g7(pl)+0x1b1)};
    XV.m=0; XV.len=0; $("x-num").value=0;
    $("x-on").disabled=false; $("x-on").checked=true; status("");
    await xNames(); await xRefresh();
  }catch(err){ console.error(err); XV.ready=null; status("FV のキャラを用意できなかった: "+err.message,true) }
}
// FV の技の名前（ディスクのコマンド表と fvmoves.js の番号。写しのキャラの技を先頭に）
async function xNames(){ const sel=$("x-name"), R=XV.ready; sel.hidden=true; sel.innerHTML="";
  try{ XV.cmd=XV.cmd||{}; const groups=[];
    for(const k of [R.cid,...Object.keys(FVX.FV_MOVES).map(Number).filter(k=>k!==R.cid)]){ const e=FVX.FV_MOVES[k]; if(!e||!XV.disc.get(e[0])) continue;
      if(!XV.cmd[e[0]]) XV.cmd[e[0]]=FVX.cmdStrings(await XV.disc.get(e[0])());
      const s=XV.cmd[e[0]], who=(s[1]||"").split("<")[0]||e[0].replace("_CMND.FTS","");
      groups.push({own:k===R.cid,who,list:e[1].filter(([i])=>s[i]&&s[i+1]).map(([i,m])=>({m,name:s[i],cmd:FVX.cmdPretty(s[i+1])}))}) }
    const esc=t=>t.replace(/[&<>"]/g,c=>"&#"+c.charCodeAt(0)+";"), n=groups.reduce((a,x)=>a+x.list.length,0);
    sel.innerHTML=`<option value="">FV の技の名前から選ぶ（${n}）</option>`+groups.map(x=>`<optgroup label="${esc(x.who)}${x.own?"（このキャラ）":""}">`+x.list.map(y=>`<option value="${y.m}">${esc(y.name)}　${esc(y.cmd)}</option>`).join("")+"</optgroup>").join("");
    sel.hidden=!n; xNameSync() }catch(err){ console.warn(err) } }
function xNameSync(){ const sel=$("x-name"); if(sel.hidden) return; const v=String(+$("x-num").value); sel.value=[...sel.options].some(o=>o.value===v)?v:"" }
// FV の技を変える（0＝写しの姿勢のまま）。2 人とも頭のコマから
async function xSetMove(m){ const R=XV.ready; if(!R||m===XV.m&&(m===0||R.E.info(R.pl).motion===m)) return; motStop();
  if(m){ const len=R.E.motionLength(m); if(!len){ status("FV の技 "+m+" は表に無い",true); return } R.E.start(R.pl,m); XV.m=m; XV.len=len } else { XV.m=0; XV.len=0 }
  status(""); $("x-num").value=XV.m; xNameSync(); await xRefresh(1) }
// 今の VF2 の技・コマで組み直す（入れ替えを切り替えたとき・押し合いを変えたときなど）
// 色の変換表（色の値 5bit × 明るさ → 8bit。ゲームが場面ごとに作る）: 「色を VF2 の場面に合わせる」なら、行 0〜27・明るさ 0〜47 を VF2 の写しの表にする。
// 行 28〜31（VF2 では写しごとに違う、キャラの肌などの行）と明るさ 48〜（特別な欄）は FV のまま。FV の表は同じ値でも明るく（値 16・明るさ 47 で VF2 200・FV 248）、白っぽく見えた
const XV_ROWS=28, XV_COLS=48;
function xColors(){ const R=XV.ready, S=APP.scene; if(!R||!XV.gl||!S) return; const on=$("x-col").checked, key=on?S.col:R.col; if(XV.colKey===key) return; XV.colKey=key;
  if(!on){ XV.gl.setColors(R.col); return }
  const f=R.col.xlat, x=f.slice(), v=S.col.xlat; for(let ch=0;ch<3;ch++) for(let r=0;r<XV_ROWS;r++) for(let l=0;l<XV_COLS;l++){ const i=ch*0x800+r*64+l; x[i]=v[i] }
  if(XV.scale!==false) for(let l=0;l<XV_COLS;l++){ let a=0,b=0; for(let ch=0;ch<3;ch++) for(let r=8;r<XV_ROWS;r++){ a+=v[ch*0x800+r*64+l]; b+=f[ch*0x800+r*64+l] } const k=b?a/b:1;
    for(let ch=0;ch<3;ch++) for(let r=XV_ROWS;r<32;r++){ const i=ch*0x800+r*64+l; x[i]=Math.min(255,Math.round(f[i]*k)) } }
  XV.gl.setColors({...R.col,xlat:x}) }
async function xRefresh(f){ if(!APP.scene||APP.mode!=="state") return; xColors();
  $("m-pl").disabled=xOn(); if(xOn()&&+$("m-pl").value!==0){ $("m-pl").value=0; if(APP.mot) APP.mot.m=0 }
  const M=await motEnsure(); if(!M) return;
  if(M.m) await motSet(M.m,f||M.f); else { APP.scene.sc=APP.scene.sc0; if(xOn()) xCompose(M,null,f||1); rebuild() } }
// 組む: VF2 の 1P（S.sc の 1P の部品。UA＝そのコマの関節、null なら写しのまま）と FV のキャラ（コマ f）→ S.xsc（VF2 の分）・S.fsc（FV の分）
function xCompose(M,UA,f){
  const S=APP.scene, R=XV.ready, mul=motMul, invG=motInvG, [pA,pL]=M.hips, V=M.att[0].V;
  const UB=XV.m?R.E.frame(R.pl,Math.max(1,Math.min(XV.len,f))):R.U0;
  // FV の世界 → VF2 の世界: FV のキャラの腰を原点へ → y 軸まわりに φ 回す → VF2 の 2P の腰へ
  const phi=Math.atan2(pA[2]-pL[2],pA[0]-pL[0])-Math.atan2(R.pH[2]-R.pB[2],R.pH[0]-R.pB[0]), c=Math.cos(phi), s=Math.sin(phi);
  const T=mul(mul([1,0,0,0,1,0,0,0,1,-R.pB[0],0,-R.pB[2]],[c,0,s,0,1,0,-s,0,c,0,0,0]),[1,0,0,0,1,0,0,0,1,pL[0],0,pL[2]]);
  const toV=mul(mul(invG(R.att.V),T),V);   // FV のカメラの座標 → VF2 のカメラの座標
  // 押し合い（仮）: 体の当たりが無いので、2 人を結ぶ向きの腰の間が x-push より近いと押し戻す（ゲームの値ではない。分け方は xPushShares）
  const PUSH=Math.max(0,+$("x-push").value||0), ua=UA?UA[0].slice(9):pA, ub=mul(UB[0],T).slice(9), ax=[pL[0]-pA[0],pL[2]-pA[2]], al=Math.hypot(...ax)||1, u=[ax[0]/al,ax[1]/al];
  const sep=(ub[0]-ua[0])*u[0]+(ub[2]-ua[2])*u[1], [shA,shB]=xPushShares(sep,PUSH,(ua[0]-pA[0])*u[0]+(ua[2]-pA[2])*u[1],-((ub[0]-pL[0])*u[0]+(ub[2]-pL[2])*u[1]));
  const move=d=>mul(mul(invG(V),[1,0,0,0,1,0,0,0,1,d*u[0],0,d*u[1]]),V);
  const MA=move(-shA), MB=mul(toV,move(shB)), own=S.models[0];
  S.xsc={...S.sc,draws:S.sc.draws.filter(d=>d.player===0).map(d=>d.dyn||own&&own.has(d.id)?{...d,m:mul(d.m,MA)}:d)};   // VF2 の 2P は描かない（1P の表のステージは残る）
  const sB=FVX.motApply(R.sc,R.att,UB,null);
  S.fsc={...sB,draws:sB.draws.filter(d=>d.player===R.pl&&(d.dyn||R.fm.has(d.id))).map(d=>({...d,m:mul(d.m,MB)}))};   // 人の番号はそのまま（2P の色は面の 2P 用の属性で付く）
}
// 押し合いの分け方: 近すぎる分（PUSH−sep）を、写しの位置から相手の方へ出た分（advA・advB）に比べて戻す。前へ出たほうが止まり、立っている相手は押されない
// （半分ずつだと、片方だけ前へ出る技で 2 人とも 2P の側へずれていった）。出た分より多く重なるとき（初めから近いなど）は残りを半分ずつ
function xPushShares(sep,PUSH,advA,advB){ const ov=PUSH-sep; if(ov<=0) return [0,0];
  const a=Math.max(0,advA), b=Math.max(0,advB), t=a+b, use=Math.min(ov,t), rest=(ov-use)/2;
  return [(t>1e-6?use*a/t:0)+rest,(t>1e-6?use*b/t:0)+rest] }
function xLightTab(t,mode){ const [d,a]=t; if(d<=0||a>=127||d+a<=0) return t; const s=d+a; return mode===1?[s*2/3,s/3,t[2],t[3]]:[d+(a-31.5)*0.5,31.5+(a-31.5)*0.5,t[2],t[3]] }
// rebuild() から: FV の分のメッシュ（光の向きは VF2 の場面のもの、強さの表は FV のもの）
function xMesh(o){ const S=APP.scene, R=XV.ready; if(!S.fsc) return null;
  const light={...R.light0,L:S.light.L,tab:XV.lightMode?R.light0.tab.map(t=>xLightTab(t,XV.lightMode)):R.light0.tab}, on=$("c-p2").checked, p={which:"body",stage:false,light,players:[on&&R.pl===0,on&&R.pl===1]}, models={[R.pl]:R.fm};
  const body=FVX.sceneMesh(S.fsc,R.col,models,p), shadow=o.shadow?FVX.sceneMesh(S.fsc,R.col,models,{...p,which:"shadow"}):null;
  XV.gl.setMesh(body,shadow); return (body.count+(shadow?shadow.count:0))/3 }
function xInit(){
  $("x-disc").onchange=e=>xLoadDisc(e.target.files[0]); $("x-state").onchange=e=>xLoadState(e.target.files[0]);
  $("x-pl").onchange=()=>xPrepare();
  $("x-on").onchange=()=>{ motStop(); xRefresh() };
  $("x-num").onchange=()=>xSetMove(Math.max(0,+$("x-num").value|0));
  $("x-name").onchange=()=>{ if($("x-name").value) xSetMove(+$("x-name").value) };
  $("x-push").onchange=()=>xRefresh();
  $("x-col").onchange=()=>{ xColors(); draw() };
}
