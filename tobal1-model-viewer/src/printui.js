// ---- 3Dプリント用に書き出す（画面の操作） ----
// 画面に出ている層（1人、または「2人とも出す」なら2人）を、そのまま閉じた形に作り直す
{ const val=id=>$(id), num=(id,d)=>{ const v=+val(id).value; return isFinite(v)&&v>0?v:d };
  let last=null, src=null;   // src: 作り直す前の形（作り直した形を表示している間も、元の形から作る）
  const status=L=>{ $("pr-status").innerHTML=L.join("<br>") };
  $("pr-make").onclick=async()=>{
    const shown=layers.filter(L=>L.count&&L.mesh&&!L.mesh.isPrint).map(L=>L.mesh);
    const meshes=shown.length?shown:(src||[]); src=meshes;
    if(!meshes.length){ status(["先にキャラクターを表示してください"]); return }
    const o={height:num("pr-height",100),res:+val("pr-res").value||160,thick:num("pr-thick",1),
             base:val("pr-base").checked,baseH:3,hollow:val("pr-hollow").checked,shell:num("pr-shell",2)};
    let r;
    try{ r=await printBuild(meshes,o,async m=>{ busy(m); await idle() }) }
    catch(err){ busy(""); status(["作れませんでした: "+err.message]); return }
    busy("");
    last=r;
    // 画面で確かめられるように、作り直した形をそのまま描く
    const n=r.tris.length, pos=new Float32Array(n*3), col=new Float32Array(n*3);
    for(let i=0;i<n;i++){ const v=r.tris[i]; pos.set(r.verts.subarray(v*3,v*3+3),i*3); col[i*3]=r.colors[v*3]/255; col[i*3+1]=r.colors[v*3+1]/255; col[i*3+2]=r.colors[v*3+2]/255 }
    const mesh={pos,col,t0:new Float32Array(n*3),t1:new Float32Array(n*4),sm:new Uint8Array(n/3),nrm:null,isPrint:true};
    layers[1].count=0; upload(mesh); draw();
    const c=r.check, mb=(84+50*c.tris)/1048576;
    const L=[
      c.closed?"✅ 閉じた形になりました（辺はどれも2枚の面で、向きもそろっています）"
              :`⚠ 閉じていない所があります（開いた辺 ${c.open}・重なった辺 ${c.over}・つぶれた面 ${c.degenerate}）`,
      `大きさ 幅 ${r.size[0].toFixed(1)} × 奥行き ${r.size[2].toFixed(1)} × 高さ ${r.size[1].toFixed(1)} mm　体積 ${(c.volume/1000).toFixed(1)} cm³`,
      `三角形 ${c.tris.toLocaleString()}　升 ${r.vox.toFixed(2)} mm　最小の厚み 約 ${r.thick.toFixed(2)} mm`,
      `STL の大きさ 約 ${mb.toFixed(1)} MB`+(mb>20?"　⚠ 20MB を超えています（細かさを下げてください）":""),
    ];
    if(r.parts>1) L.push(`⚠ 塊が ${r.parts} 個に分かれています（宙に浮いた部品があります。台座を付けるか、ポーズを変えてください）`);
    if(o.hollow) L.push("⚠ 中は空洞ですが、液や粉を抜く穴は開けていません。サービスの条件を確かめてください");
    status(L);
    $("pr-save-row").hidden=false;
  };
  const name=()=>{ const c=state.ramSel>=0&&state.ramChars&&state.ramChars[state.ramSel];
    const b=c?"tobal1_"+(c.label||`${state.ramName||"ram"}_${c.who}`)+(state.ramBoth&&!state.fromSaved?"_2人":""):fileBase(true);
    return (b+`_${Math.round(num("pr-height",100))}mm`).replace(/[\\/:*?"<>|\s]/g,"_") };
  $("pr-stl").onclick=()=>{ if(last) saveBlob(new Blob([printSTL(last)],{type:"model/stl"}),name()+".stl") };
  $("pr-3mf").onclick=async()=>{ if(!last) return; busy("3MF を作っています…"); await idle();
    const b=await print3MF(last); busy(""); saveBlob(new Blob([b],{type:"model/3mf"}),name()+".3mf") };
  // 画素の並び → PNG のバイト列（ブラウザの絵の道具で作る）
  const pngBytes=async(W,H,img)=>{ const cv=document.createElement("canvas"); cv.width=W; cv.height=H;
    cv.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(img.buffer,img.byteOffset,img.byteLength),W,H),0,0);
    const b=await new Promise(r=>cv.toBlob(r,"image/png")); return new Uint8Array(await b.arrayBuffer()) };
  $("pr-3mft").onclick=async()=>{ if(!last||!src) return;
    try{ const bake=await printBake(last,src,async m=>{ busy(m); await idle() });
      busy("3MF を作っています…"); await idle();
      const png=await pngBytes(bake.W,bake.H,bake.img), b=await print3MFTex(last,bake,png); busy("");
      saveBlob(new Blob([b],{type:"model/3mf"}),name()+"_tex.3mf");
      status([...$("pr-status").innerHTML.split("<br>").filter(x=>!/^テクスチャ/.test(x)),`テクスチャ ${bake.W}×${bake.H}　3MF ${(b.size/1048576).toFixed(1)} MB`+(b.size>20*1048576?"　⚠ 20MB を超えています":"")]) }
    catch(err){ busy(""); status(["テクスチャで塗れませんでした: "+err.message]) } };
  $("pr-glb").onclick=async()=>{
    const meshes=layers.filter(L=>L.count&&L.mesh&&!L.mesh.isPrint).map(L=>L.mesh);
    if(!meshes.length){ status(["先にキャラクターを表示してください（閉じた形を表示中なら「元の表示に戻す」）"]); return }
    busy("元の形を書き出しています…"); await idle();
    try{ const at=printAtlas(meshes), png=await pngBytes(at.W,at.H,at.img), g=printGLB(meshes,num("pr-height",100),at,png); busy("");
      saveBlob(new Blob([g],{type:"model/gltf-binary"}),name()+"_元の形.glb") }
    catch(err){ busy(""); status(["書き出せませんでした: "+err.message]) } };
  $("pr-back").onclick=()=>{ $("pr-save-row").hidden=true; status([]); last=null; src=null; redrawCurrent() };
}
