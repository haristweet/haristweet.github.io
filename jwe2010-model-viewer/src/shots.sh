#!/bin/sh
# 絵で確かめる一覧を作り直す（教訓1）。前回のものは out/prev/ に残す。版を上げるたびに見比べる
# data/ には 0_TEXT.AFS からほどいたファイル（番号.bin）を置く（リポジトリに入れない）
set -e
cd "$(dirname "$0")"
mkdir -p out/shots out/prev
[ -n "$(ls out/shots 2>/dev/null)" ] && cp out/shots/*.png out/prev/
# 選手の表（data/sekiguchi.p2s）の先頭 30 人の顔＋髪を、前・横・後ろ・上で（顔＝値＋922、髪＝値＋6615）。行の数字は顔のファイルの番号
# この台本は髪を半透明にしないので、前髪が目にかかって見える（ページの WebGL では半透明）
C=120 node shot.mjs out/shots/players1.png $(node players.mjs 0 15)
C=120 node shot.mjs out/shots/players2.png $(node players.mjs 15 15)
