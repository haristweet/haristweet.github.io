// ============================================================
//  モデル候補をまとめて調べる
//  1件ずつ見せてもらうと往復が増えるので、候補を順に開いて
//  「大きさ・部分の数・展開後の大きさ・先頭の印・三角形が取れたか」を一覧にする。
//  形が1種類なのか複数あるのか、どれがキャラ本体なのかを一度に見分けるため。
// ============================================================
async function surveyModels(limit,onProgress){
  const list=state.entries.filter(entryIsModel).sort((a,b)=>b.size-a.size).slice(0,limit);
  const rows=[];
  for(let i=0;i<list.length;i++){
    const e=list[i];
    if(onProgress) onProgress(i/list.length);
    await idle();
    const r={no:e.no,sector:e.sector,size:e.size,parts:0,partSizes:"",body:"?",dec:0,magic:"",w1:"",tris:0,tex:0,head:"",how:"",err:""};
    try{
      const raw=await readFull(e);
      const ps=unpack(raw);
      if(ps){ r.parts=ps.length; r.partSizes=ps.map(p=>p.length).join("/") }
      const info=buildModel(raw).info;
      r.dec=info.decLen; r.tris=info.tris; r.how=info.layout||""; r.err=info.error||"";
      if(info.bodyPart!==undefined) r.body=String(info.bodyPart);
      r.tex=info.texChain||0;
      if(info.dump&&info.dump[0]) r.head=info.dump[0].slice(-47);   // 先頭16バイトの16進
      if(info.words){ r.magic=hex(info.words[2]); r.w1=hex(info.words[3]) }
    }catch(err){ r.err=err.message }
    rows.push(r);
  }
  if(onProgress) onProgress(1);
  return rows;
}
function surveyLines(rows){
  const L=[];
  L.push("  番号 / sector / ファイル / 部分 / 本体 / 展開後 / 先頭の印 / 語1 / 三角形 / テクスチャ / 先頭16バイト / 備考");
  for(const r of rows){
    L.push(`  #${String(r.no).padStart(4)} ${String(r.sector).padStart(7)} ${String(r.size).padStart(9)} `
      +`${String(r.parts).padStart(2)}[${r.partSizes}] p${r.body} ${String(r.dec).padStart(8)} ${r.magic} ${r.w1} `
      +`${String(r.tris).padStart(6)} ${String(r.tex).padStart(5)}枚 ${r.head||""} ${r.tris?r.how:r.err}`);
  }
  // 先頭の印ごとの件数（形が何種類あるか）
  const by=rows.reduce((m,r)=>m.set(r.magic||"?",(m.get(r.magic||"?")||0)+1),new Map());
  L.push("  先頭の印ごとの件数: "+[...by].map(([k,v])=>`${k}×${v}`).join("  "));
  const got=rows.filter(r=>r.tris>0), tx=rows.filter(r=>r.tex>=2);
  L.push(`  三角形が取れたもの: ${got.length}件`+(got.length?`（例: #${got[0].no} ${got[0].tris}枚 ${got[0].how}）`:""));
  L.push(`  テクスチャの集まり: ${tx.length}件`);
  const un=rows.filter(r=>!r.tris&&r.tex<2);
  L.push(`  まだ分からないもの: ${un.length}件`+(un.length?`（${un.slice(0,8).map(r=>"#"+r.no).join(" ")}）`:""));
  return L;
}
