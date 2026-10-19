#!/bin/sh
# 組み立て → 単体試験 → ../index.html を置く。ブラウザでの確認は node browser.mjs（disc/ にデータがあるとき）
set -e
cd "$(dirname "$0")"
python3 assemble.py
node test.mjs
