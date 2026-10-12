# Jリーグ実況ウイニングイレブン2001 モデルビューア — 作業メモ

PS1『Jリーグ実況ウイニングイレブン2001』（SLPM-86835）の選手を、ディスクイメージからブラウザで表示する。公開は `index.html` 1枚。
進め方の決まりは `../tobal1-model-viewer/CLAUDE.md`、教訓は `../CLAUDE.md` と同じ（返事は日本語、始める前に許可、絵を見ずに言わない）。

## いまの状態

- v0.1.0（2026-10-12）: ページ。ディスクだけで、選手を組んで、顔・肌・髪・ユニフォームのテクスチャ付きで回して見る。ユニフォーム・着・体の組・髪型・ひげ・動き・コマ・再生・PNG
- 次にやること（ユーザーと決めた第二段階の残り）: 背番号と、選手ごとの肌・髪の色を本体から読む
- 写し（RAM/VRAM）はまだもらっていない。頼んだもの: 試合中の数組（別のチーム同士）・変わったポーズ・顔が大きく映る場面
- 分かっていないこと: チームと TEX_xx の対応、ホームとアウェイの選び方（TEX の中の同じ場所へ置く札が 2 組ある）、組 2/3（胴が #63、色の表の行 485）が何か、
  選手ごとの肌・髪の色（ゲームは色の表の位置を差し替えているらしい【推測】。0x80011444 で 0x80079948 あたりの選手の表からビットを取っている）、背番号（背中の水色・黄色の四角）、頭が球を見る動き

## ページ（`index.html`、版は `src/wapp.js` の VERSION、履歴は CHANGELOG.md）

```
cd we2001-model-viewer/src
sh check.sh          # 組み立て（assemble.py が head.html と .js を連結）→ 単体試験（node test.mjs。disc/ があれば本物で。関節のずれの試験もある）→ ../index.html
node browser.mjs     # Playwright。何も無し → ディスク（CHD）→ 選ぶ → 再生 → 回す → PNG を、PC とスマホの幅で撮る（out/b_*.png）
```
- ソース: wdisc.js（CHD は FV の fdisc.js の写し）・tmd.js・anim.js・tex.js・wgl.js（WebGL。(tsb,cba) ごとに 256×256 にほどいて 1 枚の絵に並べる）・wapp.js・head.html

## データの置き場所（リポジトリに入れない。`src/.gitignore` で disc/・out/・*.chd・*.bin・*.png を外す）

- イメージは Google ドライブの CHD（`src/disc/we2001.chd`）。`node chd2bin.mjs disc/we2001.chd disc/we2001.bin 104051` でデータのトラックだけ書き出す
- `python3 iso.py disc/we2001.bin` で一覧、`python3 iso.py disc/we2001.bin --all disc/x` で取り出し（音・動画は除く）

## 絵で確かめる（教訓1）

```
cd we2001-model-viewer/src
sh shots.sh          # out/shots/ に players（正面・横・後ろ・横・頭の寄り）・kits（46 チーム）・heads（頭 32 種）・parts（部品）。前回は out/prev/
node pose.mjs out/x.png 組 頭 "動き:コマ[:組:頭:TEX_xx],…" [ヨー度,…]
node vramshot.mjs out/vram.png disc/x/BIN/DAT2D.BIN:run disc/x/BIN/TEX_00.BIN   # VRAM をそのまま絵に
node tmdscan.mjs disc/x/BIN/*.BIN    # ファイルの中の TMD を探す（読めない面の数も出す）
```

## 分かったこと（本体の番地は SLPM_868.35、読み込み番地 0x80010000、ファイルの 0x800 から）

- 【確定・絵】MODEL.BIN（0x8016ab80 に読む）は PS1 標準の TMD が 104 個。面は全部モードどおりに読める（`tmd.js`）。0,1＝球、残りは選手の部品
- 【確定・絵】MODEL.BIN の先頭 18 個の番地が「組」。組＝(型,番地) の並び、0xff で終わり。型 0x80＝頭（0x68 の 64 個の表から選ぶ。偶数ひげなし・奇数ひげあり）、2＝部品。
  並びは 頭・胴・腕 4・脚（もも・すね・足）×2 の 12。組 6＝フィールドの選手、組 4＝キーパー（手袋）
- 【確定・絵】ANIME.BIN（0x8017ee80）。先頭は動きの番号→コマの番地の並び（0x80026c74）。1 コマ＝部品ごとに 8 バイト。
  読み方は 0x80011ba0〜0x80011dbc（`anim.js` に書いた）。部品ごとの回転（RotMatrix、0x8003c560）と位置を、親子をたどらず選手全体の行列に掛ける（0x80011fc8）
- 【確定・数字と絵】回転の掛け方は Rz·Ry·Rx。最初 Rx·Ry·Rz と思い込んで、曲げた脚が外れた（第一段階の絵は立ち姿もずれていた）。
  48 通りを試し、全部の動きで「親に固定した点＝子に固定した点」の当てはめのずれが最小のもの（膝・足首・肩・ひじ・首で二乗平均 1 未満）。膝はももの y＝88、すねの y＝−57（すねの部品の上の端）。股関節だけはずれが大きい（5.8）
- 【確定・絵】テクスチャの札（0x8001c8d8）: 型 9＝そのまま、10＝圧縮（0x8001cae8、`weUnlz`）。TEX_xx と DAT2D は 0x800f0000 に読む。
  DAT2D は 2 つの並び（絵 23 枚、色の表）で、顔・肌・髪（4 ビット、VRAM 512,256 など）。TEX_xx はユニフォーム（8 ビット、576,256／576,384、色の表 486・488）
- 【数字】場面ごとのプログラム（GAME.BIN など）の読み込み番地は `ovl.py` で出せる（GAME.BIN＝0x8007a558）
- 道具: `dis.mjs`（tobal1 の mips.js で逆アセンブル、GTE も出る）・`mipsgrep.py`（命令を正規表現で探す）・`mipsdis.py --ref`（lui＋即値で作る番地を探す）
