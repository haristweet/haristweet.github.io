#!/bin/sh
# 絵で確かめる一覧を作り直す（教訓1）。前回の絵は out/prev/ に残して dash.mjs で並べる。
# 今は組み立て前なので、キャラごとに部品の一覧（1色目）。組み立てができたら正面と顔の寄りに替える
set -e
cd "$(dirname "$0")"
mkdir -p out/shots out/prev
[ -n "$(ls out/shots 2>/dev/null)" ] && rm -f out/prev/*.png && mv out/shots/*.png out/prev/
for c in AKI JAC JEF KAG LAU PAI SAR SUI TOU WOL DUR; do
  node sheet.mjs disc/bin/OBJ_${c}1.CMP out/shots/${c}1.png 16 30 15 "" 96 >/dev/null
done
ls out/shots
