// セーブステートの1コマを、命令の列（scene.js）とディスクのモデル（obj.js）で組んで描き、画面の写真と並べる（教訓1）。
//   node pose.mjs disc/states/grace1P_picky1P_round1 out/pose_grace.png
// 左＝組んだ絵（1P 青・2P 赤・背景 灰。面の向きで濃淡）、右＝写真に組んだ絵の輪郭を重ねたもの。色・テクスチャはまだ付けない
import fs from "fs"; import vm from "vm"; import path from "path"; import {pngEncode,pngDecode} from "./png.mjs";
const here=path.dirname(new URL(import.meta.url).pathname), ctx={console}; vm.createContext(ctx);
for(const f of ["cricmp.js","obj.js","raster.js","scene.js"]) vm.runInContext(fs.readFileSync(path.join(here,f),"utf8"),ctx);
const g=n=>vm.runInContext(n,ctx);
const [,,dir,outp="out/pose.png"]=process.argv, mem=fs.readFileSync(path.join(dir,"eeMemory.bin")), sc=g("sceneRead")(mem);
// モデルのファイル: キャラ（OBJ_ROBnn）・ステージ（OBJ_STGnn）・共通（OBJ_COMMON）。人ごとに、描いた番号をいちばん多く含むものを選ぶ
const bin=path.join(here,"disc/bin"), files=fs.readdirSync(bin).filter(f=>/^OBJ_(ROB\d+R?|STG\d+R?|COMMON)\.CMP$/.test(f)).sort()
  .map(f=>({name:f,map:new Map(g("objModels")(g("cricmpUnpack")(new Uint8Array(fs.readFileSync(path.join(bin,f))))).map(e=>[e.id,e]))}));
const pick=(ids,re)=>files.filter(f=>re.test(f.name)).map(f=>({f,n:ids.filter(i=>f.map.has(i)).length})).sort((a,b)=>b.n-a.n)[0];
const chosen=[];
for(const p of [0,1]){ const ids=sc.draws.filter(d=>d.player===p).map(d=>d.id); const c=pick(ids,/^OBJ_ROB\d+\.CMP$/); if(c&&c.n) chosen.push({p,f:c.f,kind:"char"}) }
{ const ids=sc.draws.filter(d=>d.player===0&&!chosen.find(c=>c.p===0&&c.f.map.has(d.id))).map(d=>d.id); const c=pick(ids,/^OBJ_STG\d+\.CMP$/); if(c&&c.n) chosen.push({p:0,f:c.f,kind:"stage"}) }
const common=files.find(f=>f.name==="OBJ_COMMON.CMP");
const find=d=>{ for(const c of chosen) if(c.p===d.player&&c.f.map.has(d.id)) return {e:c.f.map.get(d.id),kind:c.kind};
  for(const f of files) if(/R\.CMP$/.test(f.name)&&chosen.some(c=>c.p===d.player&&f.name===c.f.name.replace(".CMP","R.CMP"))&&f.map.has(d.id)) return {e:f.map.get(d.id),kind:"char"};
  if(common.map.has(d.id)) return {e:common.map.get(d.id),kind:"common"}; return null };
const W=640,H=480, fx=sc.focal[0]*622/496, fy=sc.focal[1]*412/384, cx=320, cy=240;
const R=g("rasterNew")(W,H,[40,40,40]); let missing=[], kinds={};
for(const d of sc.draws){ const r=find(d); if(!r){ missing.push(d.player+":"+d.id); continue } kinds[r.kind]=(kinds[r.kind]||0)+1;
  const m=d.m, T=v=>[v[0]*m[0]+v[1]*m[3]+v[2]*m[6]+m[9], v[0]*m[1]+v[1]*m[4]+v[2]*m[7]+m[10], v[0]*m[2]+v[1]*m[5]+v[2]*m[8]+m[11]];
  const flat=Math.abs(m[0]*(m[4]*m[8]-m[5]*m[7])-m[1]*(m[3]*m[8]-m[5]*m[6])+m[2]*(m[3]*m[7]-m[4]*m[6]))<0.05;   // 床に潰した影
  const base=flat?[20,20,20]:r.kind==="char"?(d.player?[220,90,80]:[90,130,230]):r.kind==="common"?[200,190,80]:[150,150,150];
  for(const p of g("objPolys")(r.e.ch[3],r.e.ch[d.player?1:0],r.e.ch[2])){
    const q=p.v.map(T); if(q.some(v=>v[2]<0.05)) continue;
    const a=q[1].map((x,i)=>x-q[0][i]), b=q[2].map((x,i)=>x-q[0][i]), n=[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]], l=Math.hypot(...n)||1;
    const k=flat?1:0.35+0.65*Math.abs(n[2]/l), col=base.map(c=>Math.round(c*k)), P=q.map(v=>[cx+fx*v[0]/v[2],cy-fy*v[1]/v[2],v[2]]);
    for(let i=1;i+1<P.length;i++) g("rasterTri")(R,P[0],P[i],P[i+1],col);
  } }
// 右: 写真に、組んだ絵のキャラの所を半分の濃さで重ねる
const photo=pngDecode(fs.readFileSync(path.join(dir,"Screenshot.png"))), pc=photo.px.length/(photo.W*photo.H);
const out=new Uint8Array(W*2*H*3);
for(let y=0;y<H;y++) for(let x=0;x<W;x++){ const i=y*W+x, o=(y*W*2+x)*3, o2=(y*W*2+W+x)*3, s=(y*photo.W+x)*pc;
  for(let c=0;c<3;c++){ out[o+c]=R.px[i*3+c]; const bg=R.z[i]===Infinity; out[o2+c]=bg?photo.px[s+c]:Math.round(photo.px[s+c]*0.5+R.px[i*3+c]*0.5) } }
fs.mkdirSync(path.dirname(outp),{recursive:true}); fs.writeFileSync(outp,pngEncode(W*2,H,out));
console.log(outp,"部品",sc.draws.length,"種類",JSON.stringify(kinds),"選んだ",chosen.map(c=>c.p+1+"P "+c.f.name).join(" "),"見つからない",missing.length,missing.slice(0,8).join(" "));
