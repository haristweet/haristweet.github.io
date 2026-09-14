#!/usr/bin/env python3
"""音楽フォルダをまるごと検査する。

    ./scan_library.py ~/Music --jobs 8 --out report.jsonl

サイズと更新時刻でキャッシュするので、2回目以降は増えたぶんだけ。
毎晩流しても数秒で終わる。途中で Ctrl-C しても続きから再開できる。
"""

from __future__ import annotations

import argparse
import fnmatch
import json
import os
import signal
import sys
import time
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import ripcheck

_CFG: ripcheck.Config | None = None


def _init(cfg_dict):
    """ワーカー起動時に1回だけ。Config を毎タスク pickle しないため。"""
    global _CFG
    _CFG = ripcheck.Config(**cfg_dict)
    signal.signal(signal.SIGINT, signal.SIG_IGN)   # Ctrl-C は親だけが受ける


def _work(path_str):
    p = Path(path_str)
    t0 = time.time()
    try:
        findings = ripcheck.analyze(p, _CFG)
    except Exception as e:      # noqa: BLE001 — 1本の失敗で全体を止めない
        findings = [{"type": "scan_error", "detail": str(e)[:300]}]
    return path_str, _stamp(p), findings, round(time.time() - t0, 2)


def _stamp(p: Path) -> str:
    st = p.stat()
    return f"{st.st_size}:{int(st.st_mtime)}"


def load_excludes(path):
    """1行1パターン。# はコメント。パスの一部一致か glob で照合する。"""
    if not path or not Path(path).exists():
        return []
    out = []
    for line in Path(path).read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            out.append(line)
    return out


def excluded(path_str, patterns):
    return any(pat in path_str or fnmatch.fnmatch(path_str, pat) for pat in patterns)


def collect(root, patterns):
    for p in sorted(Path(root).rglob("*")):
        if p.suffix.lower() not in ripcheck.AUDIO_EXTS or not p.is_file():
            continue
        s = str(p)
        if not excluded(s, patterns):
            yield s


def main():
    ap = argparse.ArgumentParser(description="音楽フォルダの一括検査")
    ap.add_argument("root", help="走査するフォルダ")
    ap.add_argument("--jobs", type=int, default=os.cpu_count() or 4)
    ap.add_argument("--out", default="report.jsonl", help="検出結果の追記先")
    ap.add_argument("--cache", default=".ripcheck_cache.json")
    ap.add_argument("--exclude", default="exclude.txt")
    ap.add_argument("--thresholds", default="thresholds.json")
    ap.add_argument("--rescan", action="store_true", help="キャッシュを無視して全部やり直す")
    ap.add_argument("--min-age", type=float, default=0.0, metavar="SEC",
                    help="更新からこの秒数が経っていないファイルは飛ばす。"
                         "リッピング中の書きかけを掴まないため（次回拾われる）")
    a = ap.parse_args()

    cfg = ripcheck.Config.load(a.thresholds)
    patterns = load_excludes(a.exclude)
    cache = {}
    if not a.rescan and Path(a.cache).exists():
        cache = json.loads(Path(a.cache).read_text())

    files = list(collect(a.root, patterns))
    todo = [f for f in files if cache.get(f) != _stamp(Path(f))]
    if a.min_age > 0:
        now = time.time()
        fresh = [f for f in todo if now - Path(f).stat().st_mtime < a.min_age]
        if fresh:
            print(f"書きかけの可能性がある {len(fresh)} 本は今回見送り", file=sys.stderr)
        todo = [f for f in todo if f not in set(fresh)]
    print(f"対象 {len(files)} 本 / 今回検査 {len(todo)} 本 / 並列 {a.jobs}", file=sys.stderr)
    if not todo:
        return

    from dataclasses import asdict
    done = 0
    t0 = time.time()
    audio_sec = 0.0
    try:
        with open(a.out, "a", encoding="utf-8") as fo, \
                ProcessPoolExecutor(a.jobs, initializer=_init, initargs=(asdict(cfg),)) as ex:
            for path, stamp, findings, elapsed in ex.map(_work, todo, chunksize=4):
                cache[path] = stamp
                done += 1
                audio_sec += elapsed
                for f in findings:
                    fo.write(json.dumps({"file": path, **f}, ensure_ascii=False) + "\n")
                if done % 100 == 0 or done == len(todo):
                    el = time.time() - t0
                    eta = el / done * (len(todo) - done)
                    print(f"  {done}/{len(todo)}  経過 {el/60:.1f}分  残り約 {eta/60:.1f}分",
                          file=sys.stderr)
                    fo.flush()
                    Path(a.cache).write_text(json.dumps(cache))
    except KeyboardInterrupt:
        print("\n中断。次回は続きから。", file=sys.stderr)
    finally:
        Path(a.cache).write_text(json.dumps(cache))
        print(f"検査 {done} 本 / {(time.time()-t0)/60:.1f}分 → {a.out}", file=sys.stderr)


if __name__ == "__main__":
    main()
