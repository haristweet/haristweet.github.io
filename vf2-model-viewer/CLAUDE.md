# バーチャファイター2 モデルビューア — 作業メモ

PS2『SEGA AGES 2500 Vol.16 バーチャファイター2』（SLPM_625.47）のモデルを読む。
進め方の決まりは `../tobal1-model-viewer/CLAUDE.md`、教訓は `../CLAUDE.md` と同じ（返事は日本語、始める前に許可、絵を見ずに言わない）。

## データの置き場所（リポジトリに入れない）

- イメージは Google ドライブから `src/disc/vf2.bin`（MODE2/2352、1トラック）に落とす。`src/disc/` と `src/out/` は .gitignore 済み
- `python3 iso.py disc/vf2.bin` で一覧、`iso.py disc/vf2.bin /BIN.CVM disc/x/BIN.CVM` で取り出し
- `python3 cvm.py disc/x/BIN.CVM disc/bin` で BIN.CVM（CRI ROFS。中は ISO9660）の 120 ファイルを取り出す
- `python3 cricmp.py disc/bin/*.CMP` で .CMP を展開して .dec を置く

## 絵で確かめる（教訓1）

```
node sheet.mjs disc/bin/OBJ_AKI1.CMP out/aki1.png [列数] [ヨー度] [ピッチ度] [番号,…] [欄の大きさ]
```
1ファイルの全モデルを決まった角度で並べる。表の色＝法線が画面の向こう、青＝こちら（今は法線が内向きらしく、見える面はほぼ青）

## 分かっていること（確定＝本体のコードか全ファイルで確かめた）

- `.CMP` は CRICMP 2.10。展開は本体 0x1547c0/0x154e80 を写した（`cricmp.py`・`cricmp.js`）。102 ファイル全部で展開後の大きさが頭の値と一致、JS と Python の出力も一致
- OBJ ファイル（展開後）＝ [モデル数] + モデル×N。モデル＝[番号] + 塊×4（各 [長さ][中身]）。全ファイルの最後のバイトまで区切れる
  - 塊3 が面の記録 40B: +0 頭、+4 法線、+0x10 頂点A、+0x1c 頂点B（float）
  - 頭 bit0-1 = 形（0 終わり・1 四角・2 三角）、bit8-9 = つなぎ方。手元の2点 P0,P1 で面 (P0,P1,B,A)。
    つなぎ方 0=描かずに P0=A,P1=B、2=P0=A,P1=B、1=P1=A、3=P0=B（本体 0x1c9cc0）
  - 並べた頂点の向きとファイルの法線: AKI1・PAI1・WOL2 で 99.2% 同じ向き、STAGE1 は全部同じ（数字で確認）
- 描いた部品は手（握り・開き・指違いが多数）・腕・脚・足・胴らしい形に見える（絵で確認。どれが何かは推測）

## 本体の作り（名前の表で確認。`python3 syms.py disc/x/SLPM_625.47 正規表現`）

- 本体には名前の表が残っている（6341個）。アーケードの i960 のプログラム（IC12_15.CMP、展開 512KB。戻り命令 0x0a000000 が 1756 個）を
  i960 のエミュレーター（i960Exec*）で動かし、ジオメトライザは PS2 側の代わりの処理（g_geo 0x135a000・m2epiExecGeoCmd・m2epiSetModel）、
  TGP の計算は PS2 の機械語に書き直したもの（cprMtx*・cprMot*）
- 面を読む divideModel 0x1c9cc0、展開 0x1547c0 など、上のアドレスは名前の表と一致
- 写しで見る所の候補（推測）: g_UnitMtxRob0Buf 0x1689d40・g_UnitMtxRob1Buf 0x1689940（各 0x400）、g_geo、g_objTbl 0x1fc8760

## 推測・未確定

- 塊0（面ごと 8B の属性）・塊1（同じ形の表）・塊2（面ごとの UV 4組）の中身。テクスチャ（TEX_*・OBJ_*B/E？）
- OBJ_xxx1/2 = 1色目/2色目、B/E/A の役割
- 法線は内向き？（見える面がほぼ裏向き）。軸の向き（どちらが上か）
- 部品の組み方（骨）。IC12_15.CMP・PROM_CODE2.CMP は MODEL2 の ROM と同じ名前で、ゲームの動きのデータかもしれない
