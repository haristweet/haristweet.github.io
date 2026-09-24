// 保存: スマホは共有シート（写真に保存できる）、それ以外はダウンロード
async function saveBlob(blob,name){
  const file=new File([blob],name,{type:blob.type});
  if(matchMedia("(pointer:coarse)").matches&&navigator.canShare&&navigator.canShare({files:[file]})){
    try{ await navigator.share({files:[file]}); return }catch(err){ if(err.name==="AbortError") return }
  }
  const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=name; document.body.append(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href),4000);
}
