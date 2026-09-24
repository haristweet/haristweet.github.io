// ============================================================
//  ディスクを開く（トバルNo.1 用に、中身の名前を決め打ちしない）
// ============================================================
// ISO9660 のディレクトリをたどって、ディスクの中の全ファイルを並べる
async function listAll(disc){
  const pvd=await disc.read(16,1);
  if(String.fromCharCode(...pvd.subarray(1,6))!=="CD001") throw new Error("ISO9660 のディスクイメージとして読めませんでした");
  const pv=new DataView(pvd.buffer,pvd.byteOffset,pvd.byteLength);
  const files=[];
  const walkDir=async(lba,size,prefix,depth)=>{
    const buf=await disc.read(lba,Math.max(1,Math.ceil(size/2048))), d=new DataView(buf.buffer,buf.byteOffset,buf.byteLength);
    const dirs=[]; let i=0;
    while(i+33<=Math.min(size,buf.length)){
      const len=buf[i];
      if(len===0){ const nx=(Math.floor(i/2048)+1)*2048; if(nx<=i) break; i=nx; continue }
      const flags=buf[i+25], nl=buf[i+32];
      const name=String.fromCharCode(...buf.subarray(i+33,i+33+nl)).split(";")[0];
      const ent={name,path:prefix+name,lba:d.getUint32(i+2,true),size:d.getUint32(i+10,true)};
      if(flags&2){ if(!(nl===1&&(buf[i+33]===0||buf[i+33]===1))) dirs.push(ent) }   // 「.」「..」は飛ばす
      else files.push(ent);
      i+=len;
    }
    if(depth<6) for(const dd of dirs) await walkDir(dd.lba,dd.size,dd.path+"/",depth+1);
  };
  await walkDir(pv.getUint32(156+2,true),pv.getUint32(156+10,true),"",0);
  return files;
}
// 音声・動画・ストリーム。トバルNo.1 の BGM は BGM/*.DA で、ALLBIN.BIN より大きいものが
// 6本あるため、これを除かないとアーカイブの候補が全部 BGM で埋まってしまう
// （しかも CHD では音楽トラックが FLAC 圧縮で、読もうとすると例外になる）
const isStream=n=>/\.(xa|str|da|vag|adp|pcm|wav|int|bs|vb|xs|iki|mov|avi)$/i.test(n);
// アーカイブらしさ。大きさだけで決めると音声に負けるので、名前も手がかりにする。
// ALLBIN.BIN はトバル2 と同じ名前（No.1 のディスクにも入っている）。決め打ちではなく、
// あくまで試す順番の手がかりで、実際に中身を読んで確かめた結果が優先される（scoreTables）
const archiveRank=f=>{
  const n=(f.path||f.name).toUpperCase();
  let s=f.size;
  if(/(^|\/)ALLBIN\.BIN$/.test(n)) s+=1e12;
  else if(/\.(BIN|DAT|PAK|WAD|IMG|ARC|HED|PAC)$/.test(n)) s+=1e11;
  if(/(^|\/)(BGM|SOUND|SE|VOICE|MUSIC|MOVIE|STR)\//.test(n)) s-=1e11;
  return s;
};
// どのファイルがアーカイブかは当てずっぽうなので、候補を持っておいて後から切り替えられるようにする
function withArcs(obj,arcs){
  obj.arcs=arcs; obj.arcIdx=0;
  obj.maxArcSize=arcs.reduce((m,a)=>Math.max(m,a.size),0);
  obj.setArc=i=>{ obj.arcIdx=Math.max(0,Math.min(arcs.length-1,i|0)); obj.arcName=arcs[obj.arcIdx].name; obj.arcSize=arcs[obj.arcIdx].size };
  obj.readArc=arcs.length?((sec,size)=>arcs[obj.arcIdx].read(sec,size)):null;
  if(arcs.length) obj.setArc(0); else { obj.arcName="—"; obj.arcSize=0 }
  return obj;
}
async function openSource(fileList){
  const files=[...fileList].filter(f=>f.size>0);
  if(!files.length) throw new Error("ファイルが選ばれていません");
  // (1) ディスクから取り出したファイルを直接渡された場合: PS-X EXE と、いちばん大きい別のファイル
  if(files.length>=2&&!files.some(f=>/\.(chd|cue)$/i.test(f.name))){
    const heads=await Promise.all(files.map(f=>f.slice(0,8).arrayBuffer()));
    const ei=heads.findIndex(h=>String.fromCharCode(...new Uint8Array(h))==="PS-X EXE");
    if(ei>=0){
      const exeF=files[ei];
      const arcs=files.filter((_,k)=>k!==ei).sort((a,b)=>archiveRank(b)-archiveRank(a)).map(f=>({
        name:f.name, size:f.size,
        read:async(sec,size)=>new Uint8Array(await f.slice(sec*2048,sec*2048+size).arrayBuffer()),
      }));
      if(arcs.length) return withArcs({
        kind:"取り出し済みファイル", discName:"—", exeName:exeF.name,
        exe:new Uint8Array(await exeF.arrayBuffer()),
        iso:files.map(f=>({name:f.name,path:f.name,size:f.size,file:f})),
        readIso:async(e,limit)=>new Uint8Array(await (limit?e.file.slice(0,Math.min(limit,e.size)):e.file).arrayBuffer()),
        xa:[], readRaw:null,
      },arcs);
    }
  }
  // (2) ディスクイメージ
  const bin=files.find(f=>/\.(chd|bin|iso|img)$/i.test(f.name))||files[0];
  if(/\.cue$/i.test(bin.name)) throw new Error(".cue ではなく、同じ名前の .bin を選んでください");
  const magic=String.fromCharCode(...new Uint8Array(await bin.slice(0,8).arrayBuffer()));
  const disc=magic==="MComprHD"?new ChdDisc(bin):new BinDisc(bin); await disc.init();
  const all=await listAll(disc);
  if(!all.length) throw new Error("ディスクの中にファイルが見つかりませんでした");
  const byName=n=>all.find(f=>f.name.toUpperCase()===n.toUpperCase());
  // SYSTEM.CNF の BOOT= から実行ファイルの名前を取る
  let boot=null;
  const cnf=byName("SYSTEM.CNF");
  if(cnf){
    const txt=new TextDecoder().decode(await disc.read(cnf.lba,Math.max(1,Math.ceil(cnf.size/2048))));
    const m=txt.match(/BOOT\s*=\s*cdrom:?\\?([^\s;]+)/i);
    if(m) boot=m[1].split("\\").pop().split("/").pop();
  }
  let exeE=boot&&byName(boot);
  if(!exeE) exeE=all.find(f=>/^S[LC][PEU][SM][_.]\d/i.test(f.name));
  if(!exeE) throw new Error("PlayStation の実行ファイル（SLPS_… など）が見つかりませんでした");
  const exe=(await disc.read(exeE.lba,Math.ceil(exeE.size/2048))).subarray(0,exeE.size);
  // アーカイブの候補: 実行ファイルと音声・動画を除いて、大きい順に数件
  const arcs=all.filter(f=>f!==exeE&&!isStream(f.name)&&f.size>=0x10000).sort((a,b)=>archiveRank(b)-archiveRank(a)).slice(0,6).map(f=>({
    name:f.path, size:f.size,
    read:async(sec,size)=>(await disc.read(f.lba+sec,Math.max(1,Math.ceil(size/2048)))).subarray(0,size),
  }));
  const canRaw=!!(await disc.readRaw(16));
  return withArcs({
    kind:magic==="MComprHD"?"CHD":"BIN/ISO", discName:bin.name, exeName:exeE.name, exe,
    iso:all,
    readIso:async(e,limit)=>{ const bytes=limit?Math.min(limit,e.size):e.size;
      return (await disc.read(e.lba,Math.max(1,Math.ceil(bytes/2048)))).subarray(0,bytes) },
    xa:canRaw?all.filter(f=>/\.xa$/i.test(f.name)):[],
    readRaw:canRaw?lba=>disc.readRaw(lba):null,
  },arcs);
}
