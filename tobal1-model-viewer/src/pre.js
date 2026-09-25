// ============================================================
//  トバルNo.1 モデルビューア
//  ディスクの読み取り・ゲーム独自の圧縮・モデルの組み立て・描画は
//  「トバル2 モデルビューア」で作ったものをそのまま使っている。
//  違うのは、トバル2では解析で分かった固定の値（ファイル表の位置・
//  キャラごとのモデル番号）を直接書いていたところを、No.1 では
//  読み込んだディスクから実行時に探しにいくところ。
// ============================================================
const $=id=>document.getElementById(id);
const state={
  src:null,          // 読み込み元（ディスク or 取り出し済みファイル）
  tables:[],         // 実行ファイルから見つけたファイル表の候補
  tableIdx:0,
  mem:null,          // メモリの写しから読んだ骨の表
  bones:null,        // 骨さがしの結果
  boning:false,
  galling:false,
  galWhy:null,     // 一覧で読めなかったモデルの理由   // モデルを並べている最中か
  t1Part:-1,          // ファイルの中のどのモデルを出すか（-1＝いちばん大きいもの）
  t1Slot:-10,         // 差し替えの組から何番目を出すか（-10＝写しと同じ手。0〜3＝手の形 1〜4）
                      // 付ける骨が決まったので、既定で出す。
                      // ゲームは別の回に描くが、ビューアでは1体として見たい
  vram:null,          // VRAM の写し（テクスチャ）
  ramChars:null,      // メモリの写しの中にいた登場人物（1P・2P…）
  ramSel:-1,          // そのうち、いま出している人
  entries:[],        // 表示中の一覧（アーカイブ or ディスクのファイル）
  scan:null,         // アーカイブを直接さらった結果
  survey:null,       // モデル候補をまとめて調べた結果
  sieve:null,        // 候補を全部ふるいにかけた結果
  infer:null,        // さらった結果から逆算したファイル表
  source:"table",    // "table" = アーカイブのファイル表 / "iso" = ディスクのファイル
  sel:-1,
  rig:"t2",
  cache:new Map(),
  probe:new Map(),   // ファイル番号 → 見分けた結果
  head:new Map(),    // ファイル番号 → 先頭4バイト（解析の表示用）
  log:[],
};
const fmtSize=n=>n>=1048576?(n/1048576).toFixed(2)+" MB":n>=1024?(n/1024).toFixed(1)+" KB":n+" B";
const hex=(n,w=8)=>"0x"+(n>>>0).toString(16).toUpperCase().padStart(w,"0");
function busy(t){ const b=$("busy"); if(!t){b.hidden=true;return} b.textContent=t; b.hidden=false }
const idle=()=>new Promise(r=>setTimeout(r,0));
