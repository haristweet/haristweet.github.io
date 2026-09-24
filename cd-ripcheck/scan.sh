#!/usr/bin/env bash
# 一連の検査をまとめて回す。launchd から叩かれるのもこれ。
#
#   ./scan.sh                 # 差分だけ
#   ./scan.sh --rescan        # 全部やり直す
#
# 設定は環境変数か、同じ場所に置いた config.sh で上書きする。
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[ -f "$HERE/config.sh" ] && . "$HERE/config.sh"

MUSIC_ROOT="${MUSIC_ROOT:-$HOME/Music}"          # 検査する音楽フォルダ
WORK="${RIPCHECK_WORK:-$HERE/work}"              # レポートとキャッシュの置き場
JOBS="${RIPCHECK_JOBS:-$(sysctl -n hw.ncpu 2>/dev/null || nproc)}"
MIN_AGE="${RIPCHECK_MIN_AGE:-300}"               # 直近5分に更新されたものは見送り
PYTHON="${RIPCHECK_PYTHON:-python3}"

mkdir -p "$WORK"
cd "$HERE"
echo "=== ripcheck $(date '+%F %T') / $MUSIC_ROOT ==="

# 1. FLAC の内部MD5を照合する。壊れたファイルをいちばん安く見つけられる。
if command -v flac >/dev/null 2>&1; then
  echo "--- flac -t（ファイル破損の全数検査）"
  # flac 自身はファイル名しか出さないので、失敗したパスを自前で書き出す。
  # 500枚あると "03.flac: ERROR" だけでは特定できない。
  find "$MUSIC_ROOT" -name '*.flac' -print0 \
    | xargs -0 -P "$JOBS" -I{} sh -c 'flac -st "$1" >/dev/null 2>&1 || printf "%s\n" "$1"' _ {} \
    > "$WORK/flac_test.log" || true
  n=$(grep -c . "$WORK/flac_test.log" 2>/dev/null || echo 0)
  echo "    MD5 不一致・破損 $n 本 → $WORK/flac_test.log"
fi

# 2. XLD のログから AccurateRip の判定を吸い出す。一致した曲は以後ノータッチでよい。
echo "--- XLD ログ"
"$PYTHON" parse_xld_log.py "$MUSIC_ROOT" --out "$WORK/xld.jsonl"

# 3. 波形の検査。ここがいちばん時間を食う（8コアで実時間の 240〜480倍速）。
echo "--- 波形検査"
"$PYTHON" scan_library.py "$MUSIC_ROOT" \
  --jobs "$JOBS" \
  --out "$WORK/report.jsonl" \
  --cache "$WORK/cache.json" \
  --exclude "$HERE/exclude.txt" \
  --thresholds "$HERE/thresholds.json" \
  --min-age "$MIN_AGE" \
  "$@"

# 4. 集計して、疑わしい箇所を3秒ずつ切り出す。人間が聴くのはここだけ。
echo "--- 集計"
"$PYTHON" triage.py \
  --report "$WORK/report.jsonl" \
  --xld "$WORK/xld.jsonl" \
  --flac-log "$WORK/flac_test.log" \
  --out "$WORK/report.md" \
  --clips "$WORK/suspect"

echo "=== 完了: $WORK/report.md ==="
