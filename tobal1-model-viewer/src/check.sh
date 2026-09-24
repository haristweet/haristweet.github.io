#!/bin/sh
# 組み立てて単体試験を回す。通ったら ../index.html に置く
set -e
cd "$(dirname "$0")"
[ -f fixture_exe.bin ] || python3 mkfix.py >/dev/null
[ -f SLPM_860.33 ] || cp fixture_exe.bin SLPM_860.33
python3 extract.py
python3 assemble.py
node --check bundle.js
node test.mjs
cp index.html ../index.html
