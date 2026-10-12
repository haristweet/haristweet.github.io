#!/bin/sh
# 絵で確かめる一覧を作り直す（教訓1）。前回のものは out/prev/ に残す。版を上げるたびに見比べる
set -e
cd "$(dirname "$0")"
mkdir -p out/shots out/prev
[ -n "$(ls out/shots 2>/dev/null)" ] && cp out/shots/*.png out/prev/
# 正面・横・後ろ・横と頭の寄り。組 6＝フィールドの選手、組 4＝キーパー（手袋）。動き 0＝立ち、3＝走り、20＝蹴り
node pose.mjs out/shots/players.png 6 0 "0:0:6,3:0:6,20:0:6,0:0:4,3:0:4"
# 46 チームのユニフォーム（TEX_00〜45）、頭 32 種
rows=$(for i in $(seq -w 0 45); do printf "0:0:6:0:TEX_%s," $i; done | sed 's/,$//')
GRID=8 C=120 node pose.mjs out/shots/kits.png 6 0 "$rows" 0
rows=$(for i in $(seq 0 31); do printf "0:0:6:%d," $i; done | sed 's/,$//')
GRID=8 C=120 node pose.mjs out/shots/heads.png 6 0 "$rows" 0
# ゲームの選手の表から（チーム-選手）: 鹿島の GK・小笠原・ビスマルク、札幌のビジュ、磐田の GK・中山・高原、マンチェスターの GK・ベッカム。正面・背中・頭の寄り
node pose.mjs out/shots/look.png 6 0 "0:0::::1-0,0:0::::1-8,0:0::::1-7,0:0::::0-4,0:0::::9-0,0:0::::9-9,0:0::::9-10,0:0::::34-0,0:0::::34-7" 0,180
# 集合写真（ENTER.BIN の場面。ユーザーの画面と見比べる: 仙台 1P 正面・鹿島 1P 正面 GK 2・山形 2P 最初の斜め）
node photo.mjs out/shots/photo_sendai.png 16 0 0 100 0 >/dev/null
node photo.mjs out/shots/photo_kashima.png 1 0 1 100 0 >/dev/null
node photo.mjs out/shots/photo_yamagata.png 17 0 0 0 1 >/dev/null
# 部品（MODEL.BIN の TMD 104 個、単色）
node sheet.mjs disc/x/BIN/MODEL.BIN out/shots/parts.png 13 30 15 120
