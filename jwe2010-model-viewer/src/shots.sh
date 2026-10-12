#!/bin/sh
# 絵で確かめる一覧を作り直す（教訓1）。前回のものは out/prev/ に残す。版を上げるたびに見比べる
# data/ には 0_TEXT.AFS からほどいたファイル（番号.bin）を置く（リポジトリに入れない）
set -e
cd "$(dirname "$0")"
mkdir -p out/shots out/prev
[ -n "$(ls out/shots 2>/dev/null)" ] && cp out/shots/*.png out/prev/
# 選手の表（ステートセーブ）から出した顔＋髪を、前・横・後ろ・上で（顔＝値＋922、髪＝値＋6615）。中島・富田・千葉・渡辺
# この台本は髪を半透明にしないので、前髪が目にかかって見える（ページの WebGL では半透明）
C=160 node shot.mjs out/shots/sendai.png data/03377.bin+data/07188.bin data/03381.bin+data/07192.bin data/03376.bin+data/07187.bin data/03380.bin+data/07191.bin
