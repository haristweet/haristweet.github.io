#!/bin/sh
# 絵で確かめる一覧を作り直す（教訓1）。前回のものは out/prev/ に残す。版を上げるたびに見比べる
# data/ には 0_TEXT.AFS からほどいたファイル（番号.bin）を置く（リポジトリに入れない）
set -e
cd "$(dirname "$0")"
mkdir -p out/shots out/prev
[ -n "$(ls out/shots 2>/dev/null)" ] && cp out/shots/*.png out/prev/
# 選手の表（ステートセーブ）から出した顔＋髪を、前・横・後ろ・上で。関口・梁・林・菅井
# この台本は髪を半透明にしないので、前髪が目にかかって見える（ページの WebGL では半透明）
C=160 node shot.mjs out/shots/sendai.png data/03377.bin+data/07188.bin data/04214.bin+data/08029.bin data/02948.bin+data/06758.bin data/03381.bin+data/07192.bin
# 外国の選手: フェルナンジーニョ・レイナルド・エリゼウ・朴 柱成
C=160 node shot.mjs out/shots/others.png data/02119.bin+data/06647.bin data/02173.bin+data/06701.bin data/02140.bin+data/06668.bin data/04175.bin+data/07988.bin
