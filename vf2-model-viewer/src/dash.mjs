// 進み具合のダッシュボード（1枚の HTML）を out/dash.html に作る。node dash.mjs
// 中身: 作業メモ（../CLAUDE.md）の「いまの状態」、絵の一覧（out/shots と前回の out/prev）、分かったことの色分け。
// ゲームの絵を含むのでリポジトリには入れない（out/ は .gitignore 済み）
import fs from "fs"; import path from "path"; import {execSync} from "child_process";
const here=path.dirname(new URL(import.meta.url).pathname);
const memo=fs.readFileSync(path.join(here,"../CLAUDE.md"),"utf8");
const esc=s=>s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
const inline=s=>esc(s).replace(/`([^`]+)`/g,"<code>$1</code>");

// 作業メモを節ごとに分け、箇条（続きの行を含む）を取り出す
const secs=[]; let cur=null, sub="";
for(const line of memo.split("\n")){
  const h=line.match(/^## (.*)/);
  if(h){ cur={title:h[1],items:[]}; secs.push(cur); sub=""; continue }
  if(!cur) continue;
  if(/^- /.test(line)) cur.items.push({sub,text:line.slice(2)});
  else if(/^\s{2,}\S/.test(line)&&cur.items.length) cur.items[cur.items.length-1].text+=" "+line.trim();
  else if(/^\S/.test(line)&&!/^```/.test(line)) sub=line.trim();
}
// 確かめ方の色分け: 作業メモの各項目の頭の札（【確定】【数字】【絵】【推測】【×】）をそのまま使う。札が無い項目は「札なし」
const KIND={ok:"確定",num:"数字",pic:"絵",guess:"推測",bad:"×",none:"札なし"};
const TAG={"確定":"ok","数字":"num","絵":"pic","推測":"guess","×":"bad"};
function kind(it){ const m=it.text.match(/^【([^】]+)】/); if(m&&TAG[m[1]]){ it.text=it.text.slice(m[0].length); return TAG[m[1]] } return "none" }
const now=secs.find(s=>/いまの状態/.test(s.title));
const facts=secs.filter(s=>!/いまの状態|データの置き場所|絵で確かめる/.test(s.title));
const count={}; for(const k in KIND) count[k]=0;
const factHtml=facts.map(s=>`<section><h2>${inline(s.title)}</h2><ul>${s.items.map(it=>{const k=kind(it); count[k]++;
  return `<li class="${k}"><span class="tag">${KIND[k]}</span><span>${inline(it.text)}</span></li>`}).join("")}</ul></section>`).join("");

// 絵: 今回と前回を並べる。タップで大きく
const img=f=>fs.existsSync(f)?"data:image/png;base64,"+fs.readFileSync(f).toString("base64"):null;
const shots=fs.existsSync(path.join(here,"out/shots"))?fs.readdirSync(path.join(here,"out/shots")).filter(f=>f.endsWith(".png")).sort():[];
const shotHtml=shots.map(f=>{const a=img(path.join(here,"out/shots",f)), b=img(path.join(here,"out/prev",f));
  return `<figure><figcaption>${esc(f.replace(".png",""))}</figcaption><div class="pair"><div><small>今回</small><img src="${a}" alt="${esc(f)} 今回"></div>${b?`<div><small>前回</small><img src="${b}" alt="${esc(f)} 前回"></div>`:""}</div></figure>`}).join("");

let git=""; try{ git=execSync("git log -1 --format='%h %s (%cd)' --date=format:'%m/%d %H:%M'",{cwd:here}).toString().trim() }catch{}
const nowHtml=now?now.items.map(it=>{const m=it.text.match(/^([^:：]+)[:：]\s*(.*)$/); return m?`<div class="now"><b>${inline(m[1])}</b><p>${inline(m[2])}</p></div>`:`<p>${inline(it.text)}</p>`}).join(""):"";
const tiles=Object.entries(KIND).map(([k,n])=>`<div class="tile ${k}"><span>${n}</span><b>${count[k]}</b></div>`).join("");

const html=`<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>VF2 進み具合</title><style>
:root{--bg:#f6f5f2;--card:#fff;--fg:#222;--mut:#6b6860;--line:#e3e0d8;--ok:#2f7d4f;--num:#2d6aa3;--pic:#7a4fa8;--guess:#a87a12;--bad:#b3392f}
@media (prefers-color-scheme:dark){:root{--bg:#1c1b19;--card:#262522;--fg:#ecebe6;--mut:#a09d94;--line:#3a3833;--ok:#6cc58f;--num:#79aee0;--pic:#b99be0;--guess:#e0b44f;--bad:#ec7a6f}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.6 system-ui,-apple-system,"Hiragino Sans",sans-serif}
main{max-width:980px;margin:0 auto;padding:16px}h1{font-size:20px;margin:4px 0}h2{font-size:16px;margin:0 0 8px}
.sub{color:var(--mut);font-size:13px;margin:0 0 16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 16px;margin:0 0 16px}
.now{margin:0 0 10px}.now b{display:block;font-size:13px;color:var(--mut)}.now p{margin:2px 0 0}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px;margin:0 0 16px}
.tile{background:var(--card);border:1px solid var(--line);border-left:4px solid;border-radius:8px;padding:8px 10px}
.tile span{display:block;font-size:12px;color:var(--mut)}.tile b{font-size:22px}
.ok{border-color:var(--ok)}.num{border-color:var(--num)}.pic{border-color:var(--pic)}.guess{border-color:var(--guess)}.bad{border-color:var(--bad)}.none{border-color:var(--mut)}
section{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 16px;margin:0 0 16px}
ul{list-style:none;margin:0;padding:0}li{display:flex;gap:10px;padding:8px 0;border-top:1px solid var(--line);align-items:flex-start}li:first-child{border-top:0}
.tag{flex:none;font-size:11px;font-weight:600;padding:1px 7px;border-radius:99px;border:1px solid;white-space:nowrap;margin-top:2px}
li.ok .tag{color:var(--ok)}li.num .tag{color:var(--num)}li.pic .tag{color:var(--pic)}li.guess .tag{color:var(--guess)}li.bad .tag{color:var(--bad)}li.none .tag{color:var(--mut)}
li>span:last-child{min-width:0;overflow-wrap:anywhere}
code{font-size:12.5px;background:var(--bg);padding:0 4px;border-radius:4px}
figure{margin:0 0 16px}figcaption{font-weight:600;margin:0 0 4px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.pair small{color:var(--mut)}.pair img{width:100%;display:block;border-radius:6px;cursor:zoom-in;background:#28261f}
@media (max-width:640px){.pair{grid-template-columns:1fr}}
dialog{padding:0;border:0;max-width:100vw;max-height:100vh;background:#000}dialog img{max-width:100vw;max-height:100vh;display:block}
</style></head><body><main>
<h1>バーチャファイター2（PS2）モデル抽出の進み具合</h1><p class="sub">作った時刻 ${new Date().toLocaleString("ja-JP",{timeZone:"Asia/Tokyo"})}　／　最新のコミット ${esc(git)}</p>
<div class="card">${nowHtml}</div>
<div class="tiles">${tiles}</div><p class="sub">確定＝本体のコードで確かめた　数字＝全ファイルで数えた　絵＝描いて見た　推測＝未確認　×＝試して合わなかった</p>
<section><h2>絵の一覧（shots.sh の出力。今回と前回）</h2>${shotHtml||"<p>まだ無い。./shots.sh を実行する</p>"}</section>
${factHtml}
</main><dialog id="z"><img alt=""></dialog><script>
const z=document.getElementById("z");
document.querySelectorAll(".pair img").forEach(i=>i.onclick=()=>{z.querySelector("img").src=i.src;z.showModal()});
z.onclick=()=>z.close();
</script></body></html>`;
fs.writeFileSync(path.join(here,"out/dash.html"),html);
console.log("out/dash.html", (html.length/1024|0)+"KB", count);
