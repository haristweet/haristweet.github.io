"""ripcheck — 音声ファイル1本を解析して、リッピング事故の候補を返す。

検出するもの:
  digital_silence  曲の途中の完全無音。読み取り失敗の最も分かりやすい痕跡。
  discontinuity    サンプル間の不連続。飛んだ箇所の継ぎ目に出るクリック。
  energy_drop      一瞬だけ音量が落ちて戻る。ドロップアウト。
  lossy_suspect    高域が一定周波数で切れている。ロッシーから作られた疑い。
  too_short        数秒しかない。リップが途中で止まった残骸。
  decode_error     ファイルそのものが壊れている。

閾値はすべて Config にある。誤検出を見ながら調整する前提なので、
数値を直接いじるのではなく thresholds.json で上書きすること。
"""

from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass, asdict, fields
from pathlib import Path

import numpy as np

SR = 44100  # CD の標準。ハイレゾもここへ落として解析する。

AUDIO_EXTS = {
    ".flac", ".wav", ".aiff", ".aif", ".m4a", ".mp3",
    ".ape", ".wv", ".ogg", ".opus", ".tta", ".alac",
}


@dataclass
class Config:
    # --- digital_silence ---
    silence_min_ms: float = 10.0      # これ未満の無音は無視（CD 1セクタ = 588サンプル = 13.3ms）
    silence_context_level: float = 0.01   # 直前1秒の平均振幅がこれ以上なら「鳴っていた」

    # --- discontinuity ---
    # 2階差分を「局所的なざらつき（同じ指標の50ms移動平均）」と比べる。
    # 振幅と比べる方式より遥かに素直に効く。実測: 正常音源の最大 21 に対し、
    # サンプル欠落 35 / ブロック重複 235 / セクタ欠落 39。
    disc_ratio: float = 25.0          # この倍率を超えたら候補
    disc_context_level: float = 0.003 # かつ、その付近が実際に鳴っていること
    disc_merge_ms: float = 50.0       # これ以内の連続ヒットは1件にまとめる

    # --- energy_drop ---
    drop_ratio: float = 0.01          # 周囲の中央値に対してこの比率まで落ちたら（-40dB）
    drop_context_level: float = 0.005 # 周囲がこれ以上鳴っているときだけ見る

    # --- lossy_suspect ---
    lossy_cutoff_hz: float = 21000.0  # これ未満で高域が切れていたら疑う
    lossy_sharpness_db: float = 25.0  # かつ崖の落差がこれ以上なら（実測: 正常 1dB / mp3由来 60dB超）

    # --- 共通 ---
    guard_sec: float = 2.0            # 曲頭・曲尾のこの秒数は無視（フェードやプリギャップ）
    min_duration_sec: float = 3.0     # これ未満は too_short
    max_findings_per_file: int = 50   # 壊れきったファイルでレポートが溢れないように

    @classmethod
    def load(cls, path: str | Path | None) -> "Config":
        cfg = cls()
        if not path or not Path(path).exists():
            return cfg
        known = {f.name for f in fields(cls)}
        data = json.loads(Path(path).read_text())
        for k, v in data.items():
            if k in known:
                setattr(cfg, k, v)
        return cfg

    def dump(self, path: str | Path) -> None:
        Path(path).write_text(json.dumps(asdict(self), indent=2) + "\n")


# --------------------------------------------------------------------------
# 下ごしらえ
# --------------------------------------------------------------------------

def moving_mean(a: np.ndarray, w: int) -> np.ndarray:
    """O(n) の移動平均。長さは a と同じ。

    np.convolve は O(n*w) なので、数千曲を回すとここが律速になる。
    """
    w = max(1, int(w))
    if w >= len(a):
        return np.full(len(a), float(a.mean()))
    c = np.cumsum(np.concatenate(([0.0], a)), dtype=np.float64)
    m = (c[w:] - c[:-w]) / w
    left = w // 2
    right = len(a) - len(m) - left
    return np.concatenate((np.full(left, m[0]), m, np.full(right, m[-1])))


def runs_of(mask: np.ndarray) -> np.ndarray:
    """True が連続する区間を [[start, end), ...] で返す。"""
    d = np.diff(np.concatenate(([0], mask.astype(np.int8), [0])))
    return np.stack((np.flatnonzero(d == 1), np.flatnonzero(d == -1)), axis=1)


def decode(path: str | Path, sr: int = SR) -> np.ndarray:
    """ffmpeg で float32 モノラルに落とす。

    flac / ALAC / mp3 / APE / WavPack を同じ入口で扱えるのが ffmpeg 経由の利点。
    モノラルに畳むので片チャンネルだけの欠落は鈍るが、CD の読み取り失敗は
    両チャンネルに同時に出るので実用上は困らない。
    """
    p = subprocess.run(
        ["ffmpeg", "-v", "error", "-nostdin", "-i", str(path),
         "-f", "f32le", "-ac", "1", "-ar", str(sr), "-"],
        capture_output=True,
    )
    if p.returncode != 0:
        raise RuntimeError(p.stderr.decode("utf-8", "replace").strip()[:300] or "ffmpeg failed")
    return np.frombuffer(p.stdout, dtype="<f4")


def probe(path: str | Path) -> dict:
    """ffprobe でフォーマット情報を取る。スキャン本体とは独立に使える。"""
    p = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries",
         "stream=codec_name,sample_rate,channels,bits_per_raw_sample:format=duration",
         "-select_streams", "a:0", "-of", "json", str(path)],
        capture_output=True,
    )
    if p.returncode != 0:
        return {}
    try:
        d = json.loads(p.stdout)
    except json.JSONDecodeError:
        return {}
    st = (d.get("streams") or [{}])[0]
    return {
        "codec": st.get("codec_name"),
        "sample_rate": int(st["sample_rate"]) if st.get("sample_rate") else None,
        "channels": st.get("channels"),
        "bits": int(st["bits_per_raw_sample"]) if st.get("bits_per_raw_sample") else None,
        "duration": float(d.get("format", {}).get("duration") or 0) or None,
    }


# --------------------------------------------------------------------------
# 個別の検出
# --------------------------------------------------------------------------

def find_digital_silence(x, sr, cfg):
    n, guard = len(x), int(sr * cfg.guard_sec)
    out = []
    for s, e in runs_of(x == 0.0):
        if (e - s) < sr * cfg.silence_min_ms / 1000:
            continue
        if s < guard or e > n - guard:
            continue  # 曲頭・曲尾の無音は正常
        before = np.abs(x[max(0, s - sr):s])
        if before.size and before.mean() > cfg.silence_context_level:
            out.append({"type": "digital_silence", "at": round(s / sr, 3),
                        "ms": round((e - s) / sr * 1000, 1)})
    return out


def find_discontinuities(x, sr, env, cfg):
    dd = np.abs(np.diff(x, n=2))          # dd[i] は x[i+1] に対応
    local = moving_mean(dd, int(sr * 0.05)) + 1e-12
    ratio = dd / local
    hits = np.flatnonzero((ratio > cfg.disc_ratio) & (env[1:-1] > cfg.disc_context_level))
    if hits.size == 0:
        return []
    keep = np.concatenate(([True], np.diff(hits) > sr * cfg.disc_merge_ms / 1000))
    guard = int(sr * cfg.guard_sec)
    out = []
    for i in hits[keep]:
        if i < guard or i > len(x) - guard:
            continue
        out.append({"type": "discontinuity", "at": round((i + 1) / sr, 3),
                    "score": round(float(ratio[i]), 1)})
    return out


def find_energy_drops(x, sr, cfg):
    hop = max(1, int(sr * 0.01))          # 10ms
    rms = np.sqrt(moving_mean(x.astype(np.float64) ** 2, hop)[::hop] + 1e-12)
    half = 20                             # ±200ms の中央値と比べる
    if len(rms) < half * 2 + 2:
        return []
    med = np.median(np.lib.stride_tricks.sliding_window_view(rms, half * 2 + 1), axis=1)
    center = rms[half:half + len(med)]
    hit = (center < med * cfg.drop_ratio) & (med > cfg.drop_context_level)
    idx = np.flatnonzero(hit) + half
    if idx.size == 0:
        return []
    keep = np.concatenate(([True], np.diff(idx) > 5))
    guard_f = int(cfg.guard_sec * sr / hop)
    out = []
    for i in idx[keep]:
        if i < guard_f or i > len(rms) - guard_f:
            continue
        out.append({"type": "energy_drop", "at": round(i * hop / sr, 3)})
    return out


def estimate_cutoff(x, sr):
    """高域スペクトルの「崖」を探す。返り値は (周波数Hz, 落差dB)。

    ロッシーのエンコーダは決まった周波数で断崖のように切り落とすので、
    その段差の大きさが手がかりになる。アナログ由来のゆるいロールオフは
    段差にならないため区別できる。実測では正常な音源で落差 1dB 前後、
    mp3 から作り直したものは 60dB 超と、はっきり分かれる。
    """
    nfft = 8192
    if len(x) < nfft * 4:
        return None, None
    hop = max(nfft, (len(x) - nfft) // 400)
    starts = np.arange(0, len(x) - nfft, hop)
    frames = np.stack([x[s:s + nfft] for s in starts])
    # 静かなフレームは高域が無くて当然なので、鳴っている上位半分だけ使う
    energy = (frames ** 2).mean(axis=1)
    frames = frames[energy >= np.median(energy)]
    if len(frames) < 4:
        return None, None
    spec = (np.abs(np.fft.rfft(frames * np.hanning(nfft), axis=1)) ** 2).mean(axis=0)
    freqs = np.fft.rfftfreq(nfft, 1 / sr)

    ref = spec[(freqs >= 300) & (freqs <= 4000)].mean()
    if ref <= 0:
        return None, None
    db = 10 * np.log10(spec / ref + 1e-18)

    bin_hz = freqs[1] - freqs[0]
    w = max(2, int(1500 / bin_hz))                 # 崖の前後 1.5kHz ずつを比べる
    c = np.cumsum(np.concatenate(([0.0], db)))
    idx = np.flatnonzero((freqs >= 12000) & (freqs <= 21000))
    idx = idx[(idx >= w) & (idx + w < len(db))]
    if idx.size == 0:
        return None, None
    below = (c[idx] - c[idx - w]) / w
    above = (c[idx + w] - c[idx]) / w
    drop = below - above
    k = int(np.argmax(drop))
    return float(freqs[idx[k]]), float(drop[k])


# --------------------------------------------------------------------------
# まとめ
# --------------------------------------------------------------------------

def _dedupe(findings, sr, cfg):
    """同じ瞬間を指す複数の検出を1つにまとめる。

    本物のドロップアウトは digital_silence と energy_drop と discontinuity に
    同時に引っかかる。レポート上は1件として数えたい。
    """
    priority = {"digital_silence": 0, "energy_drop": 1, "discontinuity": 2}
    timed = sorted((f for f in findings if "at" in f), key=lambda f: f["at"])
    other = [f for f in findings if "at" not in f]
    merged = []
    for f in timed:
        near = [m for m in merged if abs(m["at"] - f["at"]) <= cfg.disc_merge_ms / 1000]
        if not near:
            merged.append(dict(f))
            continue
        m = near[-1]
        m.setdefault("also", [])
        if priority.get(f["type"], 9) < priority.get(m["type"], 9):
            m["also"].append(m["type"])
            m.update({k: v for k, v in f.items() if k != "also"})
        elif f["type"] != m["type"] and f["type"] not in m["also"]:
            m["also"].append(f["type"])
    return other + merged


def analyze(path: str | Path, cfg: Config | None = None) -> list[dict]:
    """1ファイルを解析して findings のリストを返す。例外は投げない。"""
    cfg = cfg or Config()
    try:
        x = decode(path)
    except Exception as e:  # noqa: BLE001 — 呼び出し側は結果だけ見たい
        return [{"type": "decode_error", "detail": str(e)[:300]}]

    n = len(x)
    if n < SR * cfg.min_duration_sec:
        return [{"type": "too_short", "sec": round(n / SR, 2)}]

    env = moving_mean(np.abs(x.astype(np.float64)), int(SR * 0.05)) + 1e-9
    findings = (find_digital_silence(x, SR, cfg)
                + find_discontinuities(x, SR, env, cfg)
                + find_energy_drops(x, SR, cfg))
    findings = _dedupe(findings, SR, cfg)
    findings.sort(key=lambda f: f.get("at", -1))

    cutoff, sharp = estimate_cutoff(x, SR)
    if cutoff is not None and cutoff < cfg.lossy_cutoff_hz and sharp >= cfg.lossy_sharpness_db:
        findings.append({"type": "lossy_suspect", "cutoff_hz": int(cutoff),
                         "sharpness_db": round(sharp, 1)})

    if len(findings) > cfg.max_findings_per_file:
        head = findings[:cfg.max_findings_per_file]
        head.append({"type": "truncated", "omitted": len(findings) - cfg.max_findings_per_file})
        return head
    return findings
