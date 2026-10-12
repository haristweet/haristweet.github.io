#!/bin/sh
# 絵で確かめる一覧を作り直す（教訓1）。前回のものは out/prev/ に残す。版を上げるたびに見比べる
# data/ には 0_TEXT.AFS からほどいたファイル（番号.bin）を置く（リポジトリに入れない）
set -e
cd "$(dirname "$0")"
mkdir -p out/shots out/prev
[ -n "$(ls out/shots 2>/dev/null)" ] && cp out/shots/*.png out/prev/
# 顔（1600〜）＋髪（3600〜）を重ねて、前・横・後ろ・上。組み合わせは仮（どの顔にどの髪かはまだ知らない）
C=160 node shot.mjs out/shots/faces.png data/01600.bin+data/03600.bin data/01601.bin+data/03601.bin data/01602.bin+data/03602.bin
# 顔だけ（2 つ目の形も重ねる）・髪だけ・5200 番台（絵の無い形）
C=160 ALL=1 node shot.mjs out/shots/parts.png data/01600.bin data/03600.bin data/05200.bin data/05201.bin
