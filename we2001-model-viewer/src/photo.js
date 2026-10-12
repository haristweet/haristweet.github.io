// 試合前の集合写真（ENTER.BIN。0x8007a558 に読む）。読み方は ENTER.BIN のプログラムから。
//  - 姿勢: ENTER.BIN 0xfad8 の 16 個の動きの表（ANIME.BIN と同じ形。0＝歩き、2〜15＝1 コマの姿勢）。
//    0x8007c76c が 11 人の並び i に姿勢を付ける: 0（GK）＝7（腕組み）、1〜4＝8〜12 から乱数、5・6＝8・9・12 から乱数、7〜10＝2 か 6 から乱数
//  - 立ち位置: 0xfb18 からの表（11 人 ×（x, z, 姿勢）、1P 側。2P 側は 66 バイト後ろ）。x＋3072（2P 側は符号を反対）、z＋4096。
//    3 つ目の値は決まった姿勢（＋256）。ゲームは乱数で選び直すが、ここでは既定にこの値を使う
//  - カメラ: 場面 64（0x8007ff74）。位置 (−178,−320,−3633)・見る点 (−2096,−256,−2609)・奥行き 603（0x8003ea60）。
//    48 コマ目から毎コマ、位置 (−1280,−384,−4554)・見る点 (−1280,−382,−416) へ寄せる（0x80080538。最後は正面）
//  - スタメン: 選手の表の 0〜10 番目を並びの 0〜10 番目とする（推測。鹿島・磐田などの 2001 年の先発と合う）
const WE_ENTER_BASE=0x8007a558;
function weEnterFrame(enter,k){ const e=weU32(enter,0xfad8+k*4)-WE_ENTER_BASE; return weU32(enter,e)-WE_ENTER_BASE }
// 姿勢を乱数で選ぶ（ゲームの決まり）。rnd(n)→0〜n−1
function wePhotoRandomPose(i,rnd){
  if(i===0) return 7; if(i<=4) return 8+rnd(5);
  if(i<=6) return [8,9,12][rnd(3)]; return rnd(3)===0?2:6;
}
// 11 人を組む。poses に 11 個の姿勢（ENTER の表の番号）を渡すとそれを使い、null なら表の決まった姿勢
function wePhotoScene(model,enter,sel,exe,team,poses,side=0){
  const players=[];
  for(let i=0;i<11;i++){
    const o=0xfb18+side*66+i*6, x0=weSext((enter[o]|enter[o+1]<<8),16)+3072, x=side?-x0:x0, z=weSext((enter[o+2]|enter[o+3]<<8),16)+4096;
    const pose=poses?poses[i]:weSext((enter[o+4]|enter[o+5]<<8),16)-256;
    const pl=weHasRoster(team)?wePlayer(sel,exe,team,i):{name:"",num:i+1,gk:i===0,look:{hmap:0,hcol:0,face:0,beard:false,s112:0,skin:1,boots:0}};
    const gk=i===0, set=gk?4:6, look={...pl.look,cell:gk?null:i-1};
    const parts=wePose(model,enter,set,look.hmap*2+(look.beard?1:0),0,0,weEnterFrame(enter,pose));
    players.push({i,name:pl.name,num:pl.num,gk,set,look,pose,pos:[x,0,z],parts});
  }
  return {players};
}
// カメラ。p＝0（最初の斜め）〜100（最後の正面）。ゲームは毎コマ少しずつ寄せるが、ここでは直線で混ぜる。side＝1 は 2P 側（場面 65。x が反対）
function wePhotoCamera(p,side=0){
  const sg=side?-1:1, a=[-178*sg,-320,-3633,-2096*sg,-256,-2609], b=[-1280*sg,-384,-4554,-1280*sg,-382,-416], m=a.map((v,i)=>v+(b[i]-v)*p/100);
  const eye=m.slice(0,3), tgt=m.slice(3), f=tgt.map((v,i)=>v-eye[i]), fl=Math.hypot(...f); f.forEach((v,i)=>f[i]=v/fl);
  // PS1 の画面: x 右・y 下・z 奥。下向き (0,1,0) と前で右を作る
  const r=[f[2],0,-f[0]], rl=Math.hypot(...r); r.forEach((v,i)=>r[i]=v/rl);
  const d=[f[1]*r[2]-f[2]*r[1],f[2]*r[0]-f[0]*r[2],f[0]*r[1]-f[1]*r[0]];
  return {eye,tgt,f,r,d,h:603};
}
function wePhotoView(C,p){ const q=p.map((v,i)=>v-C.eye[i]); const dot=a=>a[0]*q[0]+a[1]*q[1]+a[2]*q[2]; return [dot(C.r),dot(C.d),dot(C.f)] }
