#!/usr/bin/env python3
"""検査結果をアルバム単位でまとめ、疑わしい箇所を切り出す。

    ./triage.py --report report.jsonl --xld xld.jsonl --out report.md --clips suspect/

一括スキャンは必ず大量に引っかかる。閾値で消すのではなく、
「怪しい順に並べて上から見る」ための道具。切り出した wav は1件3秒なので、
50件でも3分で聴き終わる。
"""

from __future__ import annotations

import argparse
import json
import subprocess
from collections import defaultdict
from pathlib import Path

# 重み。大きいほど「まず見るべき」。運用しながら調整する前提。
WEIGHT = {
    "flac_md5_mismatch": 100,  # FLAC 内蔵の MD5 と中身が食い違う。確実に壊れている。
    "decode_error": 100,   # ファイルが壊れている。最優先。
    "scan_error": 30,
    "too_short": 50,       # リップが途中で止まった残骸
    "digital_silence": 20, # 読み取り失敗の最も分かりやすい痕跡
    "lossy_suspect": 15,   # 音飛びではないが、そもそも音源が偽物
    "energy_drop": 8,
    "discontinuity": 5,
    "truncated": 0,
}
XLD_WEIGHT = {
    "read_error": 40, "tc_mismatch": 40, "inaccurate": 25,
    "jitter_fixed": 5, "not_in_db": 3, "unknown": 2, "accurate": 0,
}
LABEL = {
    "flac_md5_mismatch": "FLAC内部MD5と不一致",
    "decode_error": "デコード不能", "scan_error": "検査失敗", "too_short": "短すぎる",
    "digital_silence": "曲中の完全無音", "lossy_suspect": "ロッシー由来の疑い",
    "energy_drop": "一瞬の音量落ち", "discontinuity": "波形の不連続",
    "read_error": "XLD読み取りエラー", "tc_mismatch": "XLD 2回読みで不一致",
    "inaccurate": "AccurateRip不一致", "jitter_fixed": "ジッタ訂正あり",
    "not_in_db": "AccurateRip未登録", "unknown": "XLD判定不明", "accurate": "AccurateRip一致",
}


def load(path):
    if not path or not Path(path).exists():
        return []
    out = []
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError:
                pass
    return out


def album_of(file_path):
    return str(Path(file_path).parent)


def build(findings, xld):
    albums = defaultdict(lambda: {"score": 0, "findings": [], "xld": [], "files": set()})
    for f in findings:
        if not f.get("file") or f.get("type") == "truncated":
            continue
        a = albums[album_of(f["file"])]
        a["score"] += WEIGHT.get(f["type"], 5)
        a["findings"].append(f)
        a["files"].add(f["file"])
    for t in xld:
        if not t.get("file"):
            continue
        a = albums[album_of(t["file"])]
        a["score"] += XLD_WEIGHT.get(t.get("verdict", "unknown"), 2)
        if t.get("verdict") != "accurate":
            a["xld"].append(t)
        a.setdefault("album_name", t.get("album"))
    return albums


def counts(items, key):
    c = defaultdict(int)
    for i in items:
        c[i.get(key, "?")] += 1
    return dict(sorted(c.items(), key=lambda kv: -kv[1]))


def write_report(albums, findings, xld, out, top):
    ranked = sorted(albums.items(), key=lambda kv: -kv[1]["score"])
    L = []
    L.append("# リッピング検査レポート\n")
    L.append(f"- 検出のあったアルバム: **{len(albums)}**")
    L.append(f"- 検出の総数: **{len(findings)}**")
    if xld:
        ok = sum(1 for t in xld if t.get("verdict") == "accurate")
        L.append(f"- XLD ログ: {len(xld)} トラック中 **{ok}** が AccurateRip 一致"
                 f"（＝聴かなくてよい）")
    L.append("")

    L.append("## 検出タイプの内訳\n")
    L.append("| 種類 | 件数 |")
    L.append("|---|---:|")
    for k, v in counts(findings, "type").items():
        L.append(f"| {LABEL.get(k, k)} | {v} |")
    L.append("")

    urgent = [f for f in findings
              if f["type"] in ("flac_md5_mismatch", "decode_error", "scan_error", "too_short")]
    if urgent:
        # 同じファイルが複数の理由で挙がることがあるので1行にまとめる
        by_file = defaultdict(list)
        for f in urgent:
            by_file[f["file"]].append(LABEL.get(f["type"], f["type"]))
        L.append("## 🔴 まず対処するもの（ファイルが壊れている）\n")
        for path, reasons in list(by_file.items())[:80]:
            L.append(f"- `{path}` — {' / '.join(dict.fromkeys(reasons))}")
        L.append("")

    lossy = [f for f in findings if f["type"] == "lossy_suspect"]
    if lossy:
        L.append("## 🟡 ロッシー由来の疑い（音飛びとは別問題／買い直し候補）\n")
        L.append("高域が急に切れている。可逆圧縮の顔をした非可逆音源の可能性。\n")
        L.append("| ファイル | 打ち切り | 落差 |")
        L.append("|---|---:|---:|")
        for f in sorted(lossy, key=lambda f: -f.get("sharpness_db", 0))[:60]:
            L.append(f"| `{f['file']}` | {f.get('cutoff_hz')} Hz | {f.get('sharpness_db')} dB |")
        L.append("")

    L.append(f"## 怪しい順のアルバム（上位 {min(top, len(ranked))}）\n")
    L.append("| 点 | アルバム | 内訳 |")
    L.append("|---:|---|---|")
    for path, a in ranked[:top]:
        kinds = counts(a["findings"], "type")
        kinds.update({f"XLD:{k}": v for k, v in counts(a["xld"], "verdict").items()})
        desc = " / ".join(f"{LABEL.get(k.replace('XLD:', ''), k)}×{v}" for k, v in kinds.items())
        L.append(f"| {a['score']} | `{path}` | {desc} |")
    L.append("")

    L.append("## 上位アルバムの詳細\n")
    for path, a in ranked[:min(top, 20)]:
        L.append(f"### `{path}`  （{a['score']}点）\n")
        for t in sorted(a["xld"], key=lambda t: t.get("track", 0)):
            extra = f" / 読み取りエラー {t['read_errors']}" if t.get("read_errors") else ""
            L.append(f"- XLD Track {t.get('track')}: **{LABEL.get(t['verdict'], t['verdict'])}**{extra}")
        for f in sorted(a["findings"], key=lambda f: (f["file"], f.get("at", 0)))[:30]:
            at = f" @ {f['at']}s" if "at" in f else ""
            also = f"（＋{'/'.join(LABEL.get(x, x) for x in f['also'])}）" if f.get("also") else ""
            L.append(f"- {Path(f['file']).name}: {LABEL.get(f['type'], f['type'])}{at}{also}")
        L.append("")

    Path(out).write_text("\n".join(L), encoding="utf-8")
    return ranked


def extract_clips(findings, albums, clips_dir, top, seconds, per_album):
    """疑わしい箇所の前後を切り出す。人間が聴くのはここだけでいい。"""
    ranked = sorted(albums.items(), key=lambda kv: -kv[1]["score"])[:top]
    d = Path(clips_dir)
    d.mkdir(parents=True, exist_ok=True)
    made = 0
    for _, a in ranked:
        timed = sorted((f for f in a["findings"] if "at" in f),
                       key=lambda f: -WEIGHT.get(f["type"], 0))[:per_album]
        for f in timed:
            src = Path(f["file"])
            start = max(0.0, f["at"] - seconds / 2)
            name = f"{src.parent.name}__{src.stem}__{f['at']:.2f}s__{f['type']}.wav"
            name = "".join(c if c.isalnum() or c in "._-" else "_" for c in name)
            p = subprocess.run(
                ["ffmpeg", "-v", "error", "-nostdin", "-y", "-ss", f"{start:.3f}",
                 "-t", str(seconds), "-i", str(src), str(d / name)],
                capture_output=True)
            if p.returncode == 0:
                made += 1
    return made


def main():
    ap = argparse.ArgumentParser(description="検査結果の集計と切り出し")
    ap.add_argument("--report", default="report.jsonl")
    ap.add_argument("--xld", default="xld.jsonl")
    ap.add_argument("--flac-log", help="flac -t で落ちたファイルのパス一覧（1行1件）")
    ap.add_argument("--out", default="report.md")
    ap.add_argument("--top", type=int, default=40)
    ap.add_argument("--clips", help="指定すると疑わしい箇所を切り出す先")
    ap.add_argument("--clip-seconds", type=float, default=3.0)
    ap.add_argument("--clips-per-album", type=int, default=3)
    a = ap.parse_args()

    findings = load(a.report)
    if a.flac_log and Path(a.flac_log).exists():
        for line in Path(a.flac_log).read_text(encoding="utf-8", errors="replace").splitlines():
            line = line.strip()
            if line:
                findings.append({"file": line, "type": "flac_md5_mismatch"})
    xld = load(a.xld)
    albums = build(findings, xld)
    ranked = write_report(albums, findings, xld, a.out, a.top)
    print(f"アルバム {len(albums)} / 検出 {len(findings)} → {a.out}")
    if ranked:
        print(f"最も怪しい: {ranked[0][0]}（{ranked[0][1]['score']}点）")
    if a.clips:
        n = extract_clips(findings, albums, a.clips, a.top, a.clip_seconds, a.clips_per_album)
        print(f"切り出し {n} 本 → {a.clips}（1本 {a.clip_seconds}秒）")


if __name__ == "__main__":
    main()
