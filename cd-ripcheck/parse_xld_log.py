#!/usr/bin/env python3
"""XLD のログを読んで、トラックごとの AccurateRip 判定を JSONL で吐く。

    ./parse_xld_log.py ~/Music --out xld.jsonl

AccurateRip で一致が取れたトラックはビットパーフェクトがほぼ確定なので、
そもそも聴く必要がない。逆に「DBに無い」「一致しない」「読み取りエラーあり」の
トラックだけが波形検査と試聴の対象になる。この選別がいちばん効く。

XLD のログ書式は版によって揺れるので、行の意味だけを拾う緩いパーサにしてある。
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ENCODINGS = ("utf-8", "utf-16", "shift_jis", "latin-1")

RE_TRACK = re.compile(r"^\s*Track\s+(\d+)\s*$")
RE_FIELD = re.compile(r"^\s*([A-Za-z0-9 ()/_-]+?)\s*:\s*(.*?)\s*$")
RE_STAT = re.compile(r"^\s*(.+?)\s*:\s*(\d+)\s*$")
RE_CONF = re.compile(r"confidence\s+(\d+)", re.I)


def read_text(path: Path) -> str:
    raw = path.read_bytes()
    for enc in ENCODINGS:
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("latin-1", "replace")


def verdict_of(tr: dict) -> str:
    """トラック1件の総合判定。悪いものを優先して返す。"""
    if tr.get("read_errors", 0) or tr.get("skipped", 0) or tr.get("inconsistency", 0):
        return "read_error"
    if tr.get("crc_test") and tr.get("crc_copy") and tr["crc_test"] != tr["crc_copy"]:
        return "tc_mismatch"          # 2回読んで結果が違う = そのトラックは信用できない
    mark = tr.get("mark", "")
    if "accurately ripped" in mark:
        return "accurate"
    if "not present" in mark or "no match" in mark:
        return "not_in_db"
    if "may not be accurate" in mark or "not accurate" in mark:
        return "inaccurate"
    if tr.get("jitter_fixed", 0):
        return "jitter_fixed"         # 訂正済みだが、盤が弱っている兆候
    return "unknown"


def parse(path: Path) -> dict:
    text = read_text(path)
    lines = text.splitlines()
    info = {"log": str(path), "album": None, "drive": None, "ripper": None,
            "date": None, "summary": None, "tracks": []}
    cur = None

    for line in lines:
        low = line.lower()

        m = RE_TRACK.match(line)
        if m:
            cur = {"track": int(m.group(1)), "file": None, "mark": "",
                   "read_errors": 0, "skipped": 0, "inconsistency": 0, "jitter_fixed": 0}
            info["tracks"].append(cur)
            continue

        if line.strip().startswith("->"):
            mark = line.strip()[2:].strip()
            if cur is not None:
                cur["mark"] = mark.lower()
                c = RE_CONF.search(mark)
                if c:
                    cur["confidence"] = int(c.group(1))
            else:
                info["summary"] = mark
            continue

        f = RE_FIELD.match(line)
        if not f:
            continue
        key, val = f.group(1).strip().lower(), f.group(2).strip()

        if cur is None:
            if key == "used drive":
                info["drive"] = val
            elif key == "ripper mode":
                info["ripper"] = val
            elif "extraction logfile from" in low:
                info["date"] = val
            continue

        if key == "filename":
            cur["file"] = val
        elif key.startswith("crc32 hash"):
            if "test" in key:
                cur["crc_test"] = val
            elif "skip zero" not in key:
                cur["crc_copy"] = val
        else:
            s = RE_STAT.match(line)
            if not s:
                continue
            n = int(s.group(2))
            if key.startswith("read error"):
                cur["read_errors"] = n
            elif key.startswith("skipped"):
                cur["skipped"] = n
            elif key.startswith("inconsistency"):
                cur["inconsistency"] = n
            elif "jitter error" in key or "bytes error" in key or key.startswith("drift error"):
                cur["jitter_fixed"] += n

    # アルバム名は「Artist / Album」の行。ヘッダ直後にある。
    for line in lines[:12]:
        if " / " in line and ":" not in line and not line.startswith(("X Lossless", "XLD")):
            info["album"] = line.strip()
            break

    for t in info["tracks"]:
        t["verdict"] = verdict_of(t)
    return info


def main():
    ap = argparse.ArgumentParser(description="XLD ログから AccurateRip 判定を抽出")
    ap.add_argument("root", help="ログを探すフォルダ（再帰）、または .log ファイル")
    ap.add_argument("--out", default="xld.jsonl")
    a = ap.parse_args()

    root = Path(a.root)
    logs = [root] if root.is_file() else sorted(root.rglob("*.log"))
    n_ok = n_bad = 0
    with open(a.out, "w", encoding="utf-8") as fo:
        for lg in logs:
            try:
                info = parse(lg)
            except Exception as e:      # noqa: BLE001
                print(f"skip {lg}: {e}", file=sys.stderr)
                continue
            if not info["tracks"]:
                continue                # XLD のログではなかった
            for t in info["tracks"]:
                rec = {"log": info["log"], "album": info["album"], "drive": info["drive"],
                       "date": info["date"], **t}
                rec.pop("mark", None)
                fo.write(json.dumps(rec, ensure_ascii=False) + "\n")
                if t["verdict"] == "accurate":
                    n_ok += 1
                else:
                    n_bad += 1
    print(f"ログ {len(logs)} 本 / accurate {n_ok} トラック / 要確認 {n_bad} トラック → {a.out}",
          file=sys.stderr)


if __name__ == "__main__":
    main()
