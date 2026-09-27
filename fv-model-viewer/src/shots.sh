#!/bin/sh
# 絵で確かめる一覧を作り直す（教訓1）。前回の絵は out/prev/ に残す。
# キャラごとの部品の一覧と、セーブステートの場面（命令の列から組んだ絵を写真と並べたもの）
set -e
cd "$(dirname "$0")"
mkdir -p out/shots out/prev
if [ -n "$(ls out/shots)" ]; then rm -f out/prev/*.png; mv out/shots/*.png out/prev/; fi
for f in disc/bin/OBJ_ROB[0-9][0-9].CMP; do
  node sheet.mjs "$f" "out/shots/$(basename "$f" .CMP).png" 16 30 15 "" 96 >/dev/null
done
for d in disc/states/*/; do
  [ -f "$d/eeMemory.bin" ] && node pose.mjs "$d" "out/shots/pose_$(basename "$d").png"
done
ls out/shots
