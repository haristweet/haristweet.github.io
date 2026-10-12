// 選手ごとの見た目（肌・髪の色・髪型・ひげ・顔・スパイク・背番号）。読み方は本体と SELECT.BIN から。
//  - チーム名: SELECT.BIN（0x8007a558 に読む）の 0x3b1e0 からの番地の表（43 チーム）
//  - 選手の表（12 バイト＝3 語 A,B,C）: J の 28 チームは SELECT.BIN の 0x26e28＋(t×26＋i)×12、34〜40 は 0x29048＋((t−34)×26＋i)×12（SELECT の 0x80087060）
//    試合の前に本体の 0x80079948 へ写す（SELECT の 0x80081e48）
//  - 名前: J は SELECT.BIN の 0x439a0 からの番地の表（728 人）、34〜40 は本体の 0x80052bc8＋t×260＋i×10（10 バイト）
//  - 値の意味（本体の 0x80011444 と 0x8001b640）: 髪型＝本体 0x800516e8 の表[(A>>4)&31]（0〜15）、髪の色＝(A>>9)&15、
//    顔＝(A>>13)&15（5 以上でひげのある頭）、もう 1 つの色＝(A>>17)&7、肌＝B&3、スパイク＝(C>>27)&7。
//    キーパーかどうかは A&15＝0 で見ている（推測。各チームの GK とされる選手が 0 だった）
//  - 背番号: 本体の 0x80055e5c＋t×26＋i の値＋1（SELECT の 0x80087f7c が 0x800611a0 へ写し、0x8002fcb0 で 0x8001f204 に渡す）。0xff は空き
const WE_SELECT_BASE=0x8007a558, WE_EXE_BASE=0x8000f800;
function weSjis(u8,o){ let e=o; while(e<u8.length&&u8[e]) e++; try{ return new TextDecoder("shift_jis").decode(u8.subarray(o,e)).normalize("NFKC") }catch(_){ return "" } }
function weTeamNames(sel){
  const out=[]; for(let i=0;i<43;i++) out.push(weSjis(sel,weU32(sel,0x3b1e0+i*4)-WE_SELECT_BASE)); return out;
}
function weHasRoster(t){ return t<28||(t>=34&&t<=40) }
function wePlayer(sel,exe,t,i){
  const o=t<28?0x26e28+(t*26+i)*12:0x29048+((t-34)*26+i)*12, A=weU32(sel,o), B=weU32(sel,o+4), C=weU32(sel,o+8);
  const name=t<28?weSjis(sel,weU32(sel,0x439a0+(t*26+i)*4)-WE_SELECT_BASE):weSjis(exe.subarray(0,exe.length),0x80052bc8+t*260+i*10-WE_EXE_BASE).slice(0,10);
  const hmap=exe[0x800516e8-WE_EXE_BASE+((A>>4)&31)], face=(A>>13)&15;
  const nb=exe[0x80055e5c-WE_EXE_BASE+t*26+i];
  return {name, num:nb===255?0:nb+1, gk:(A&15)===0, look:{hmap, hcol:(A>>9)&15, face, beard:face>=5, s112:(A>>17)&7, skin:B&3, boots:(C>>>27)&7}, raw:[A,B,C]};
}
// 面 1 つの UV・CBA・TSB を、選手の見た目に合わせて書き換えた値で返す。part＝組の中の番号（0 頭・1 胴）、k＝部品の中の面の番号（1 から）
// look が null なら書き換えない。書き換えは本体と同じく TMD の並び（Z の字）の UV に対して行い、最後に描く並び（0-1-3-2）に直す
function weLookPrim(p,part,k,look){
  if(!look||!p.uvRaw) return {uv:p.uv,cba:p.cba,tsb:p.tsb};
  const uv=p.uvRaw.map(a=>a.slice()); let cba=p.cba, tsb=p.tsb;
  const cls=cba&0xffc0, low=cba&15;
  // 色の表の位置（0x800125b4〜0x80012674）
  if(cls>=0x7800&&cls<=0x78c0){ const t4=0x7800|look.skin<<6; cba=low===0?t4:low<9?t4|(look.hcol+1):t4|(look.s112+9) }
  else if(cls===0x7900){ if(low<8) cba=0x7900|look.boots }
  else if(cls===0x7980||cls===0x79c0){ cba=0x7980; tsb=153 }     // 1P 側（2P 側は 0x79c0・154）
  else if(cls===0x7a00||cls===0x7a40){ cba=0x7a00; tsb=153 }
  const V=(j,v)=>{ if(uv[j]) uv[j][1]=v&255 }, U=(j,u)=>{ if(uv[j]) uv[j][0]=u&255 };
  if(part===0){   // 顔と髪の模様（0x800112a4）
    const lo=uv[0][1]&15, u0=uv[0][0], F=look.face*16, H=look.hmap*16;
    if(lo>=14){ if(look.hmap<9){
        const T2=[1,1,0,0,0,0,0,0,1,0,0,0,1,0,0,1,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,1,0,0,0,0,0,0,1];
        if(u0>=176&&u0<216&&T2[u0-176]){ V(0,H+15); V(1,H+1); V(2,H+15); V(3,H+1) }
        if(u0===212||u0===200){ V(0,H+15); V(1,H+5); V(2,H+15); V(3,H+5) } } }
    else if(lo===0){ const c=u0-160;
      if(c===0||c===4){ V(0,F); V(1,F+16); V(2,F); V(3,F+12) }
      else if(c===14||c===15){ V(0,F); V(1,F+12); V(2,F); V(3,F+16) }
      else if(c===7){ V(0,F); V(1,F+16); V(2,F); V(3,F+16) } }
    else if(lo===12){ if(u0>=171&&u0<=173){ V(0,F+12); V(1,F+16); V(2,F); V(3,F) } }
  }
  if(part===1&&look.cell!=null&&(k===3||k===15)){   // 背番号の欄（0x80011184。本体は並びの 2〜11 番目の選手に欄 0〜9 を指す。番号の絵は weComposeNumber が欄に描く）
    const n=look.cell, q=Math.floor(n/5), r=n%5, a0=r*20, b=q*24;
    if(k===3){ U(0,a0+10); V(0,b+103); U(1,a0+2); V(1,b+103); U(2,a0+10); V(2,b+86); U(3,a0); V(3,b+82) }
    else { U(0,a0+10); V(0,b+86); U(1,a0+19); V(1,b+82); U(2,a0+10); V(2,b+103); U(3,a0+17); V(3,b+103) }
  }
  return {uv:p.quad?[uv[0],uv[1],uv[3],uv[2]]:uv, cba, tsb};
}
