// ぐちゃぐちゃリミックス: 曲の拍を拾い、拍ごとに「どの動画のどこを・どう崩して」出すかを番号（seed）から決める。
// 曲には手を加えない。ここは画面にも ffmpeg にも触らない計算だけ（node で試験できるように）

// ── 番号から毎回同じ乱数 ──
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── 拍を拾う ──
// x: モノラルの音（Float32Array）、sr: 1秒あたりの数。
// 5ms ごとに「全体」と「低い音（キック）」の大きさを取り、増えたぶんを打ち始めの強さにする。
// テンポは、打ち始めの強さを拍の間隔で足し合わせた値が一番大きくなる所を、粗く→細かく探す。
export function detectBeats(x, sr, { minBpm = 70, maxBpm = 180 } = {}) {
  const hop = Math.max(1, Math.round(sr * 0.005)), rate = sr / hop;
  const n = Math.floor(x.length / hop);
  if (n < rate * 4) return null;                       // 4 秒より短いと決められない
  const full = new Float32Array(n), low = new Float32Array(n);
  const k = 1 - Math.exp((-2 * Math.PI * 150) / sr);   // 150Hz より下を通す
  let lp = 0;
  for (let i = 0; i < n; i++) {
    let ef = 0, el = 0;
    for (let j = i * hop, e = j + hop; j < e; j++) {
      const v = x[j]; lp += k * (v - lp);
      ef += v * v; el += lp * lp;
    }
    full[i] = Math.log(1e-9 + ef / hop); low[i] = Math.log(1e-9 + el / hop);
  }
  const onset = new Float32Array(n);
  for (let i = 1; i < n; i++) onset[i] = Math.max(0, full[i] - full[i - 1]) + 1.5 * Math.max(0, low[i] - low[i - 1]);
  // 0.4 秒の平均を引いて、ずっと鳴っている音の揺れを消す
  const W = Math.round(rate * 0.2);
  const pref = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) pref[i + 1] = pref[i] + onset[i];
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - W), b = Math.min(n, i + W + 1);
    onset[i] = Math.max(0, onset[i] - (pref[b] - pref[a]) / (b - a));
  }
  const at = (t) => { const f = t * rate, i = Math.floor(f), r = f - i; return i + 1 < n ? onset[i] * (1 - r) + onset[i + 1] * r : 0; };
  // テンポ P 秒・位置 phase の拍に当たる強さの平均。半拍の強さも少し足す（裏打ちの多い曲で倍・半分に外れにくく）
  const score = (P, phase, half = 0.3) => {
    let s = 0, c = 0;
    for (let t = phase; t < n / rate; t += P) { s += at(t) + half * at(t + P / 2); c++; }
    return c ? s / c : 0;
  };
  const best = (P, step, half) => {
    let bs = -1, bp = 0;
    for (let ph = 0; ph < P; ph += step) { const s = score(P, ph, half); if (s > bs) { bs = s; bp = ph; } }
    return [bs, bp];
  };
  // 粗く: 1 BPM ずつ。120 BPM あたりを少し好む（倍・半分のどちらにも取れるときに、よくある方を選ぶ）
  const cand = [];
  for (let bpm = minBpm; bpm <= maxBpm; bpm += 1) {
    const [s, ph] = best(60 / bpm, 0.01);
    const prior = Math.exp(-0.5 * (Math.log2(bpm / 120) / 0.9) ** 2);
    cand.push({ bpm, s, w: s * (0.6 + 0.4 * prior), ph });
  }
  cand.sort((a, b) => b.w - a.w);
  // 細かく: 一番の候補のまわりを 0.02 BPM ずつ。曲が長いほど小さなずれが効くので、ここで詰める
  let top = cand[0];
  for (let bpm = top.bpm - 1; bpm <= top.bpm + 1; bpm += 0.02) {
    const [s, ph] = best(60 / bpm, 0.0025);
    if (s > top.s) top = { bpm, s, ph };
  }
  // 半分のテンポに取ると、拍にも半拍にも強い音が当たって得をしやすい。
  // 倍のテンポでも拍の強さ（半拍を足さない）がほぼ同じなら、倍のほうが本当の拍
  if (top.bpm * 2 <= maxBpm) {
    const [s1] = best(60 / top.bpm, 0.0025, 0), [s2, ph2] = best(60 / (top.bpm * 2), 0.0025, 0);
    if (s2 >= 0.85 * s1) top = { bpm: top.bpm * 2, s: score(60 / (top.bpm * 2), ph2), ph: ph2 };
  }
  const mean = cand.reduce((t, c) => t + c.s, 0) / cand.length;
  return { bpm: Math.round(top.bpm * 100) / 100, offset: Math.round(top.ph * 1000) / 1000, confidence: top.s / (mean || 1) };
}

// ── 設計図 ──
// 区間ごとに { src: 動画の番号, at: 使い始め（秒）, frames: 出すコマ数, time: 時間の崩し方, look: [見た目の崩し方] }。
// 区切りは拍の上に置き、コマ数で数える（長い曲でも絵と曲がずれないように）
export const TIME_FX = ["normal", "stutter", "reverse", "fast", "slow", "freeze"];
export const LOOK_FX = ["hflip", "negate", "flash", "zoom", "rgb", "mono"];

export function makePlan({ seed, chaos, bpm, offset, T, F, clips }) {
  const R = rng(seed), pick = (a) => a[Math.floor(R() * a.length)];
  const beat = 60 / bpm, total = Math.round(T * F);
  const c = Math.max(0, Math.min(1, chaos));
  // 区切りの時刻（秒）: 頭〜1拍目、そのあと拍ごと。ぐちゃぐちゃ度が高いほど 1 拍・半拍・1/4 拍に細かく割る
  const cuts = [0];
  let t = offset % beat;
  if (t > 0.05) cuts.push(t);
  while (t < T) {
    const r = R();
    let len = r < 0.15 * c ? beat / 4 : r < 0.5 * c ? beat / 2 : r < 0.5 * c + (1 - c) * 0.3 ? beat : 2 * beat;
    if (len === beat / 4) { for (let i = 0; i < 2 && t < T; i++) { t += len; cuts.push(t); } continue; }
    t += len; cuts.push(t);
  }
  const frameCuts = [...new Set(cuts.map((s) => Math.min(total, Math.round(s * F))))].sort((a, b) => a - b);
  if (frameCuts[frameCuts.length - 1] !== total) frameCuts.push(total);
  const segs = [];
  for (let i = 0; i + 1 < frameCuts.length; i++) {
    const frames = frameCuts[i + 1] - frameCuts[i];
    if (frames <= 0) continue;
    const dur = frames / F;
    let time = "normal";
    if (R() < 0.75 * c) time = pick(TIME_FX.slice(1));
    if (time === "reverse" && dur > 1.2) time = "normal";           // 逆回しはコマを全部抱えるので短い区間だけ
    if (time === "stutter" && frames < 4) time = "normal";
    const look = [];
    for (const fx of LOOK_FX) if (R() < 0.12 * c) look.push(fx);
    if (R() < 0.25 * c && !look.includes("flash")) look.push("flash");
    const src = Math.floor(R() * clips.length);
    const reps = time === "stutter" ? 2 + Math.floor(R() * 3) : 1;
    const need = time === "fast" ? dur * 2 : time === "slow" ? dur / 2 : time === "stutter" ? dur / reps : time === "freeze" ? 1 / F : dur;
    const len = clips[src].dur;
    // 動画が足りなければ短く使い、足りないぶんは最後のコマを延ばす（フィルタの tpad）
    const at = len > need ? R() * (len - need) : 0;
    segs.push({ src, at: Math.round(at * 1000) / 1000, frames, time, reps, need: Math.min(need, len), look });
  }
  return segs;
}

export function planSummary(segs) {
  const n = (f) => segs.filter(f).length;
  return {
    segments: segs.length,
    stutter: n((s) => s.time === "stutter"), reverse: n((s) => s.time === "reverse"),
    fast: n((s) => s.time === "fast"), slow: n((s) => s.time === "slow"), freeze: n((s) => s.time === "freeze"),
    look: n((s) => s.look.length > 0),
  };
}

// ── 1区間ぶんのフィルタ ──
// 入力は「-ss at -t need -i 動画」で切り出してある前提。W×H・F コマ/秒にそろえ、ちょうど frames コマにする
export function segFilter(seg, { W, H, F }) {
  const N = seg.frames;
  const fit = `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1`;
  const f = [];
  if (seg.time === "fast") f.push("setpts=0.5*(PTS-STARTPTS)");
  else if (seg.time === "slow") f.push("setpts=2*(PTS-STARTPTS)");
  else f.push("setpts=PTS-STARTPTS");
  f.push(`fps=${F}`, fit, "format=yuv420p");
  if (seg.time === "stutter") {
    const M = Math.max(1, Math.round(N / seg.reps));
    f.push(`tpad=stop_mode=clone:stop=${M}`, `trim=end_frame=${M}`, "setpts=PTS-STARTPTS", `loop=loop=${seg.reps}:size=${M}:start=0`);
  } else if (seg.time === "freeze") {
    f.push("trim=end_frame=1", "setpts=PTS-STARTPTS", `loop=loop=${N}:size=1:start=0`);
  } else if (seg.time === "reverse") {
    f.push(`tpad=stop_mode=clone:stop=${N}`, `trim=end_frame=${N}`, "reverse");
  }
  for (const fx of seg.look) {
    if (fx === "hflip") f.push("hflip");
    if (fx === "negate") f.push("negate");
    if (fx === "mono") f.push("hue=s=0");
    if (fx === "zoom") f.push(`crop=iw/1.35:ih/1.35,scale=${W}:${H},setsar=1`);
    if (fx === "rgb") f.push(`rgbashift=rh=-${Math.max(2, Math.round(W / 80))}:bh=${Math.max(2, Math.round(W / 80))}`);
    if (fx === "flash") f.push(`fade=t=in:st=0:d=${Math.min(0.15, N / F / 2).toFixed(3)}:color=white`);
  }
  // 最後にちょうど N コマに（足りなければ最後のコマを延ばす）
  f.push("setpts=N/FRAME_RATE/TB", `tpad=stop_mode=clone:stop=${N}`, `trim=end_frame=${N}`, "setpts=PTS-STARTPTS");
  return f.join(",");
}
