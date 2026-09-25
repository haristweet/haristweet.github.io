#!/bin/sh
# 絵で確かめる一覧を作り直す（教訓1）。前回の絵は out/prev/ に残して dash.mjs で並べる。
# キャラごとの部品の一覧（1色目）と、セーブステートの場面（ゲームの命令の列から組んで写真と重ねた絵）
set -e
cd "$(dirname "$0")"
mkdir -p out/shots out/prev
[ -n "$(# セーブステートの場面（左＝組んだ絵、右＝画面の写真に重ねたもの）
for d in disc/states/*/; do
  [ -f "$d/eeMemory.bin" ] && node pose.mjs "$d" "out/shots/pose_$(basename "$d").png" >/dev/null
done
ls out/shots 2>/dev/null)" ] && rm -f out/prev/*.png && mv out/shots/*.png out/prev/
for c in AKI JAC JEF KAG LAU PAI SAR SUI TOU WOL DUR; do
  node sheet.mjs disc/bin/OBJ_${c}1.CMP out/shots/${c}1.png 16 30 15 "" 96 >/dev/null
done
# セーブステートの場面（左＝組んだ絵、右＝画面の写真に重ねたもの）
for d in disc/states/*/; do
  [ -f "$d/eeMemory.bin" ] && node pose.mjs "$d" "out/shots/pose_$(basename "$d").png" >/dev/null
done
ls out/shots
