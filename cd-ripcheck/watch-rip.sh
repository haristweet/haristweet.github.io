#!/usr/bin/env bash
# リップが終わるのを待ってから、その1枚を検査する。
# launchd の WatchPaths から呼ばれる想定。手で叩いてもよい。
#
# WatchPaths は XLD がフォルダを作った瞬間にも発火するので、
# 「音源ファイルがしばらく更新されなくなる」のを待ってから検査する。
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[ -f "$HERE/config.sh" ] && . "$HERE/config.sh"

MUSIC_ROOT="${MUSIC_ROOT:-$HOME/Music}"
MAX_WAIT="${RIPCHECK_MAX_WAIT:-2400}"     # 待つ上限（秒）。既定40分
PYTHON="${RIPCHECK_PYTHON:-python3}"

waited=0
while [ "$waited" -lt "$MAX_WAIT" ]; do
  # 直近1分に更新された音源が1つでもあれば、まだリップ中とみなす
  busy=$(find "$MUSIC_ROOT" -type f \
           \( -name '*.flac' -o -name '*.wav' -o -name '*.aiff' -o -name '*.m4a' \) \
           -mmin -1 -print -quit 2>/dev/null | wc -l | tr -d ' ')
  [ "$busy" = "0" ] && break
  sleep 20
  waited=$((waited + 20))
done

exec "$PYTHON" "$HERE/checkdisc.py"
