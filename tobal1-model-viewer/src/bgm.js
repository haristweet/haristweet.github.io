// ============================================================
//  BGM: ディスクの XA を鳴らす
//  トバル2 では「8チャンネルを1セクタずつ交互に」と分かっていたが、
//  No.1 では何本入っているか分からないので、先頭を少し読んで
//  セクタのサブヘッダ（17バイト目＝チャンネル、18バイト目＝種類）から数える。
// ============================================================
const bgm={ctx:null,gain:null,track:-1,timer:null,next:0,pos:0,hist:null,nodes:[],gen:0,volume:0.6,tracks:[]};
async function bgmScan(src){
  const out=[];
  for(const f of (src.xa||[])){
    const total=Math.max(1,Math.ceil(f.size/2048));
    const seen=new Map();                      // チャンネル → 最初に見つけたセクタ位置
    const look=Math.min(total,64);             // 交互の周期が分かれば十分なので少しだけ読む
    for(let k=0;k<look;k++){
      const b=await src.readRaw(f.lba+k); if(!b) break;
      if(!(b[18]&4)) continue;                 // 音声のセクタだけ（サブモードの bit2）
      const ch=b[17]; if(!seen.has(ch)) seen.set(ch,k);
    }
    const chans=[...seen.entries()].sort((a,b)=>a[1]-b[1]);
    const stride=chans.length||1;
    chans.sort((a,b)=>a[0]-b[0]).forEach(([ch,first])=>{
      out.push({file:{lba:f.lba,sectors:total},ch,first,stride,label:`${f.name} ch${ch}`});
    });
  }
  return out;
}
function bgmStop(){
  bgm.gen++; clearInterval(bgm.timer); bgm.timer=null;
  for(const n of bgm.nodes){ try{ n.stop() }catch(_){} } bgm.nodes=[]; bgm.track=-1;
}
async function bgmPlay(idx){
  bgmStop(); if(idx<0) return;
  const t=bgm.tracks[idx]; if(!t) return;
  if(!bgm.ctx){ bgm.ctx=new (window.AudioContext||window.webkitAudioContext)(); bgm.gain=bgm.ctx.createGain(); bgm.gain.connect(bgm.ctx.destination) }
  await bgm.ctx.resume();
  bgm.gain.gain.value=bgm.volume;
  const gen=++bgm.gen; bgm.track=idx; bgm.pos=0; bgm.hist=[[0,0],[0,0]]; bgm.next=bgm.ctx.currentTime+0.15;
  let busyNow=false;
  const pump=async()=>{
    if(busyNow||gen!==bgm.gen) return; busyNow=true;
    try{
      while(gen===bgm.gen&&bgm.next-bgm.ctx.currentTime<3){
        const N=19, buf=bgm.ctx.createBuffer(2,N*2016,37800), L=buf.getChannelData(0), R=buf.getChannelData(1);
        let n=0, rewinds=0;
        while(n<N){
          const k=t.first+bgm.pos*t.stride;
          const b=k<t.file.sectors?await state.src.readRaw(t.file.lba+k):null;
          if(gen!==bgm.gen) return;
          // 音声でない・別のチャンネルになった＝曲の終わり。頭から繰り返す
          if(!b||!(b[18]&4)||b[17]!==t.ch){ bgm.pos=0; bgm.hist=[[0,0],[0,0]]; if(n===0&&++rewinds<2) continue; break }
          xaDecodeSector(b,bgm.hist,L,R,n*2016); n++; bgm.pos++;
        }
        if(n===0){ bgmStop(); return }   // 音声のセクタが1つも取れない＝この見分けは外れ
        const srcNode=bgm.ctx.createBufferSource(); srcNode.buffer=buf; srcNode.connect(bgm.gain);
        const when=Math.max(bgm.next,bgm.ctx.currentTime+0.02); srcNode.start(when,0,n*2016/37800); bgm.next=when+n*2016/37800;
        bgm.nodes.push(srcNode); srcNode.onended=()=>{ bgm.nodes=bgm.nodes.filter(x=>x!==srcNode) };
      }
    }catch(err){ console.error(err); $("status").textContent="BGM を再生できませんでした: "+err.message; bgmStop() }
    finally{ busyNow=false }
  };
  bgm.timer=setInterval(pump,250); pump();
}
