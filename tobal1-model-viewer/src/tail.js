// ============================================================
//  読み込みの入口
// ============================================================
$("file").onchange=e=>start(e.target.files);
const drop=$("drop");
for(const t of ["dragenter","dragover"]) document.addEventListener(t,e=>{e.preventDefault();drop.classList.add("over")});
document.addEventListener("dragleave",()=>drop.classList.remove("over"));
document.addEventListener("drop",e=>{e.preventDefault();drop.classList.remove("over");start(e.dataTransfer.files)});
// 開発用: ?arc=URL&exe=URL で取り出し済みファイルを読み込む
(async()=>{const q=new URLSearchParams(location.search); if(q.get("arc")&&q.get("exe")){
  const get=async u=>new File([await (await fetch(u)).blob()],u.split("/").pop());
  start([await get(q.get("arc")),await get(q.get("exe"))]);
}})();
updateStatus();
draw();
