#!/usr/bin/env python3
"""1枚ぶんのリップを検査して、合格か再リップかを即座に返す。

    ./checkdisc.py ~/Music/rips/Artist\\ -\\ Album

リップ直後に走らせる想定。盤がまだドライブに入っているうちに判定が出るのが
この道具の全て。ライブラリ全体の走査（scan_library.py）と違い、キャッシュも
優先順位づけもしない。1枚に対して「次へ進んでいいか」だけを答える。

終了コード: 0 = 合格 / 1 = 要再リップ / 2 = 判断保留（要確認）
"""

from __future__ import annotations

import argparse
import json
import os
import platform
import re
import subprocess
import sys
import time
from concurrent.futures import ProcessPoolExecutor
from dataclasses import asdict
from pathlib import Path

import ripcheck
import parse_xld_log

PASS, FAIL, WARN = 0, 1, 2

# 見つかったら問答無用で再リップ
FATAL = {"flac_md5_mismatch", "decode_error", "scan_error", "too_short",
         "digital_silence", "energy_drop"}
# 盤の問題ではないので再リップしても直らない
NOT_A_RIP_ISSUE = {"lossy_suspect"}

XLD_FAIL = {"read_error", "tc_mismatch", "inaccurate"}
XLD_WARN = {"not_in_db", "jitter_fixed", "unknown"}

_CFG = None


def _init(cfg_dict):
    global _CFG
    _CFG = ripcheck.Config(**cfg_dict)


def _work(path):
    return path, ripcheck.analyze(path, _CFG)


def track_no(path: str) -> str:
    """トラック番号。取れなければファイル名を返す。

    「先頭にある数字」だけをトラック番号とみなす。ファイル名のどこかにある
    数字を拾うと、ハッシュ付きの名前などで見当違いの番号になる。
    """
    name = Path(path).stem
    m = re.match(r"^(\d{1,3})(?:[\s._\-]|$)", name)
    if m:
        return m.group(1).lstrip("0") or "0"
    return name if len(name) <= 28 else name[:25] + "…"


def flac_test(files):
    """FLAC 内蔵の MD5 と照合する。壊れたファイルを最も安く見つけられる。"""
    bad = []
    flacs = [f for f in files if f.lower().endswith(".flac")]
    if not flacs or not shutil_which("flac"):
        return bad
    for f in flacs:
        p = subprocess.run(["flac", "-st", f], capture_output=True)
        if p.returncode != 0:
            bad.append(f)
    return bad


def shutil_which(name):
    from shutil import which
    return which(name)


def notify(title, message, sound):
    """macOS の通知センターに出す。席を外していても気づけるように。"""
    if platform.system() != "Darwin":
        return
    text = message.replace('"', "'")
    subprocess.run(["osascript", "-e",
                    f'display notification "{text}" with title "{title}" sound name "{sound}"'],
                   capture_output=True)


def main():
    ap = argparse.ArgumentParser(description="1枚ぶんのリップを検査して合否を返す")
    ap.add_argument("album", nargs="?", help="アルバムのフォルダ。省略すると最新のものを探す")
    ap.add_argument("--root", default=os.environ.get("MUSIC_ROOT", str(Path.home() / "Music")),
                    help="album 省略時に最新フォルダを探す起点")
    ap.add_argument("--thresholds", default=str(Path(__file__).parent / "thresholds.json"))
    ap.add_argument("--history", default=str(Path(__file__).parent / "work" / "history.jsonl"))
    ap.add_argument("--jobs", type=int, default=os.cpu_count() or 4)
    ap.add_argument("--max-drops", type=int, default=0,
                    help="許容する音飛びの数。既定 0（1つでも見つかれば再リップ）")
    ap.add_argument("--quiet", action="store_true", help="通知音を鳴らさない")
    a = ap.parse_args()

    album = Path(a.album) if a.album else newest_album(a.root)
    if album is None or not album.is_dir():
        print("アルバムのフォルダが見つからない", file=sys.stderr)
        return WARN

    files = sorted(str(p) for p in album.rglob("*")
                   if p.suffix.lower() in ripcheck.AUDIO_EXTS and p.is_file())
    if not files:
        print(f"音源が無い: {album}", file=sys.stderr)
        return WARN

    cfg = ripcheck.Config.load(a.thresholds)
    # 1枚だけの検査なので件数を絞る必要がない。実数が見えたほうが盤の状態が分かる
    cfg.max_findings_per_file = 2000
    t0 = time.time()

    print(f"\n{'=' * 62}")
    print(f"  {album.name}   （{len(files)} トラック）")
    print(f"{'=' * 62}")

    # 1. XLD のログ。AccurateRip で一致していれば波形を見るまでもない
    xld_tracks = []
    for lg in album.glob("*.log"):
        try:
            xld_tracks += parse_xld_log.parse(lg)["tracks"]
        except Exception:
            pass

    # 2. FLAC の内部MD5
    broken = flac_test(files)

    # 3. 波形検査
    findings = []
    with ProcessPoolExecutor(a.jobs, initializer=_init, initargs=(asdict(cfg),)) as ex:
        for path, fs in ex.map(_work, files):
            for f in fs:
                findings.append({"file": path, **f})
    for f in broken:
        findings.append({"file": f, "type": "flac_md5_mismatch"})

    verdict = report(album, files, xld_tracks, findings, a.max_drops, time.time() - t0)

    Path(a.history).parent.mkdir(parents=True, exist_ok=True)
    with open(a.history, "a", encoding="utf-8") as fo:
        fo.write(json.dumps({"at": time.strftime("%F %T"), "album": str(album),
                             "tracks": len(files), "verdict": verdict,
                             "findings": len(findings)}, ensure_ascii=False) + "\n")

    if not a.quiet:
        if verdict == PASS:
            notify("リップ検査: 合格", f"{album.name} — 次の盤へ", "Glass")
        elif verdict == FAIL:
            notify("リップ検査: 要再リップ", f"{album.name}", "Basso")
        else:
            notify("リップ検査: 要確認", f"{album.name}", "Funk")
    return verdict


def newest_album(root):
    """音源を含むフォルダのうち、最後に更新されたものを返す。"""
    best, best_t = None, -1
    for p in Path(root).rglob("*"):
        if p.suffix.lower() in ripcheck.AUDIO_EXTS and p.is_file():
            t = p.stat().st_mtime
            if t > best_t:
                best, best_t = p.parent, t
    return best


def report(album, files, xld_tracks, findings, max_drops, elapsed):
    by_track = {}
    for f in findings:
        by_track.setdefault(track_no(f["file"]), []).append(f)

    # --- AccurateRip ---
    if xld_tracks:
        ok = sum(1 for t in xld_tracks if t["verdict"] == "accurate")
        bad = [t for t in xld_tracks if t["verdict"] in XLD_FAIL]
        warn = [t for t in xld_tracks if t["verdict"] in XLD_WARN]
        line = f"AccurateRip : {ok}/{len(xld_tracks)} 一致"
        if bad:
            line += f"  ❌ 不一致・読み取りエラー {len(bad)}"
        if warn:
            line += f"  （DB未登録など {len(warn)}）"
        print(line)
    else:
        bad, warn = [], []
        print("AccurateRip : ログなし（XLD のログ保存を有効にすると確度が上がる）")

    # --- 波形 ---
    fatal = [f for f in findings if f["type"] in FATAL]
    other = [f for f in findings if f["type"] in NOT_A_RIP_ISSUE]
    if fatal:
        print(f"波形検査    : ❌ 異常 {len(fatal)} 箇所")
        for tn in sorted(by_track, key=lambda s: (len(s), s)):
            fs = [f for f in by_track[tn] if f["type"] in FATAL]
            if not fs:
                continue
            print(f"  {tn:<30} {len(fs):>4} 箇所", end="")
            worst = sorted(fs, key=lambda f: f.get("depth_db", 0))[:3]
            desc = ", ".join(
                f"{f['at']}s({f.get('depth_db', '')}dB)" if "at" in f else f["type"]
                for f in worst)
            print(f"   {desc}{' ...' if len(fs) > 3 else ''}")
    else:
        print("波形検査    : 異常なし")
    for f in other:
        print(f"  ⚠ {Path(f['file']).name}: 高域が {f.get('cutoff_hz')}Hz で切れている"
              f"（ロッシー由来の疑い。再リップしても直らない）")

    # --- 判定 ---
    n_drops = len([f for f in fatal if f["type"] in ("energy_drop", "digital_silence")])
    hard = [f for f in fatal if f["type"] not in ("energy_drop", "digital_silence")]
    print()
    if hard or bad or n_drops > max_drops:
        verdict = FAIL
        tracks = sorted({track_no(f["file"]) for f in fatal} |
                        {str(t.get("track")) for t in bad}, key=lambda s: (len(s), s))
        print(f"判定        : ❌ 要再リップ")
        shown = ", ".join(tracks[:8]) + (" ほか" if len(tracks) > 8 else "")
        print(f"              盤を拭いて取り直す: {shown}")
        print(f"              3回やって同じ箇所で落ちるなら盤の傷。CTDB での修復か買い直し")
    elif warn or other:
        verdict = WARN
        print(f"判定        : ⚠ 要確認")
        print(f"              波形に異常は無いが AccurateRip で裏が取れていない")
    else:
        verdict = PASS
        print(f"判定        : ✅ 合格 — 次の盤へ")
    print(f"              （{len(files)} トラック / {elapsed:.1f} 秒）\n")
    return verdict


if __name__ == "__main__":
    sys.exit(main())
