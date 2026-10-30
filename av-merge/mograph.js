// モーショングラフィックス: 曲に合わせて動く図形・ワイプ・動く歌詞・タイトル・枠を、透明の canvas に 1 コマずつ描く。
// drawFrame(ctx, scene, t) は時刻 t だけから描く（前のコマに頼らない）。パーティクルも拍の番号から乱数を決めて式で位置を出すので、
// どのコマから描いても同じ絵になり、プレビューと書き出しが一致する
import { rng } from "./remix.js";

// ── 曲の解析 ──
// 10ms ごとに: 大きさ（rms）・低い音・中くらい・高い音・32 本のスペクトラム・64 点の波形。
// 上がるときは素早く、下がるときはゆっくり（見た目が落ち着くように）
export const BANDS = 32, WAVE = 64;
export function analyzeAudio(x, sr) {
  const rate = 100, hop = sr / rate, N = 1024, n = Math.floor(x.length / hop);
  const rms = new Float32Array(n), low = new Float32Array(n), mid = new Float32Array(n), high = new Float32Array(n);
  const bands = new Float32Array(n * BANDS), wave = new Float32Array(n * WAVE);
  // 帯の境目（40Hz〜10kHz を対数で 32 に）
  const edges = Array.from({ length: BANDS + 1 }, (_, i) => Math.max(1, Math.round((40 * Math.pow(10000 / 40, i / BANDS)) / (sr / N))));
  const win = Float32Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
  const re = new Float32Array(N), im = new Float32Array(N);
  const prev = new Float32Array(BANDS + 3);
  let peak = 1e-6;
  const raw = new Float32Array(n * (BANDS + 3));
  for (let i = 0; i < n; i++) {
    const c = Math.floor(i * hop);
    let e = 0;
    for (let j = 0; j < N; j++) { const v = x[c - N / 2 + j] || 0; re[j] = v * win[j]; im[j] = 0; e += v * v; }
    for (let j = 0; j < WAVE; j++) wave[i * WAVE + j] = x[c + Math.floor((j * hop * 2) / WAVE)] || 0;
    fft(re, im);
    const mag = (k) => Math.hypot(re[k], im[k]);
    for (let b = 0; b < BANDS; b++) {
      let s = 0;
      for (let k = edges[b]; k <= Math.max(edges[b], edges[b + 1] - 1) && k < N / 2; k++) s += mag(k);
      raw[i * (BANDS + 3) + b] = Math.log1p(s / Math.max(1, edges[b + 1] - edges[b]) * 50);
    }
    const band = (lo, hi) => { let s = 0; const a = Math.round(lo / (sr / N)), z = Math.round(hi / (sr / N)); for (let k = a; k <= z; k++) s += mag(k); return Math.log1p(s / (z - a + 1) * 50); };
    raw[i * (BANDS + 3) + BANDS] = band(30, 150);
    raw[i * (BANDS + 3) + BANDS + 1] = band(300, 2000);
    raw[i * (BANDS + 3) + BANDS + 2] = band(4000, 10000);
    rms[i] = Math.sqrt(e / N);
    peak = Math.max(peak, rms[i]);
  }
  // 帯ごとに曲全体の大きい所（98%）で割って 0〜1 に。上がりは即、下がりはゆっくり
  const norm = new Float32Array(BANDS + 3);
  for (let b = 0; b < BANDS + 3; b++) {
    const col = Float32Array.from({ length: n }, (_, i) => raw[i * (BANDS + 3) + b]).sort();
    norm[b] = col[Math.floor(n * 0.98)] || 1;
  }
  for (let i = 0; i < n; i++) {
    for (let b = 0; b < BANDS + 3; b++) {
      const v = Math.min(1.2, raw[i * (BANDS + 3) + b] / norm[b]);
      prev[b] = v > prev[b] ? v : prev[b] * 0.88 + v * 0.12;
      if (b < BANDS) bands[i * BANDS + b] = prev[b];
    }
    low[i] = prev[BANDS]; mid[i] = prev[BANDS + 1]; high[i] = prev[BANDS + 2];
    rms[i] = Math.min(1, rms[i] / peak);
  }
  // 波形は曲全体のいちばん大きな振れ（99.5%）で割って -1〜1 に
  const absw = Float32Array.from(wave, Math.abs).sort();
  const wpk = absw[Math.floor(absw.length * 0.995)] || 1;
  for (let i = 0; i < wave.length; i++) wave[i] = Math.max(-1, Math.min(1, wave[i] / wpk));
  // 大きさを足し合わせたもの（HUD のスコア用。時刻 t までの合計を一発で引けるように）
  const acc = new Float32Array(n + 1);
  for (let i = 0; i < n; i++) acc[i + 1] = acc[i] + rms[i];
  return { rate, n, rms, low, mid, high, bands, wave, acc };
}

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const a = i + j, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}

// ── スタイル ──
export const STYLES = {
  neon:    { name: "ネオン", colors: ["#00f0ff", "#ff2bd6", "#fffb00", "#7cff4f"], glow: 18, line: 0.006, add: true, font: "800", fill: false },
  retro:   { name: "レトロ", colors: ["#fcfc54", "#54fcfc", "#fc5454", "#fcfcfc", "#a854fc"], pixel: 5, line: 0.012, font: "900", fill: true, mono: true },
  pop:     { name: "ポップ", colors: ["#ffde00", "#ff4f9a", "#2bb3ff", "#ffffff"], outline: "#111111", line: 0.012, font: "900", fill: true },
  minimal: { name: "ミニマル", colors: ["#ffffff"], line: 0.003, alpha: 0.85, font: "400", fill: false },
  cyber:   { name: "サイバー", colors: ["#00ff66", "#00c8ff", "#e8ff00"], glow: 10, line: 0.005, font: "800", fill: false, mono: true, scan: true },
  // ここから下は描き方そのものが違う: grad＝上から下へのグラデーションで塗る、sketch＝線がふるえる（手描き）、
  // rainbow＝色が時間で流れる、split＝赤と水色にずれて重なる、serif＝明朝体
  vapor:   { name: "ヴェイパー", colors: ["#ff71ce", "#01cdfe", "#b967ff", "#fffb96"], grad: "#5b00d6", glow: 8, line: 0.007, font: "800", fill: true },
  sketch:  { name: "手描き", colors: ["#ffffff", "#f2f2f2"], outline: "#111111", line: 0.011, font: "900", fill: true, sketch: true },
  gaming:  { name: "ゲーミング", colors: ["#ff0000"], rainbow: true, glow: 14, line: 0.007, add: true, font: "900", fill: true },
  glitch:  { name: "グリッチ", colors: ["#ffffff", "#e6e6e6"], split: true, line: 0.008, font: "900", fill: true, mono: true },
  gold:    { name: "ゴールド", colors: ["#ffe9a8", "#f5c542", "#fff8e1"], grad: "#8a5a00", glow: 6, line: 0.006, font: "700", fill: true, serif: true },
};
export const LAYERS = ["bars", "ring", "wave", "pulse", "particles"];
export const FRAMES = ["none", "hud", "vhs", "rec"];
export const WIPES = ["none", "4", "8", "cut"];
export const LYRIC_ANIMS = ["bounce", "pop", "type", "glitch"];

// scene: { W, H, style, layers: Set|Array, wipe, frame, title: { on, title, artist }, lyrics: { anim, pos, lines: [{t,text}] } | null,
//          an: analyzeAudio の結果, bpm, offset（曲の中の1拍目）, shift（曲の時刻→できあがりの時刻のずれ）, cuts: できあがりの切り替え時刻, seed, T, font }
export function makeScene(o) {
  const st = STYLES[o.style] || STYLES.neon;
  const beat = 60 / (o.bpm || 120);
  const sc = { ...o, st, beat, layers: new Set(o.layers || []), seed: o.seed || 1 };
  // VHS の日付は作った日（o.date で決めることもできる）
  const d = o.date || new Date();
  sc.dateText = `${["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"][d.getMonth()]}. ${String(d.getDate()).padStart(2, "0")} ${d.getFullYear()}`;
  // ワイプの時刻: 4拍・8拍ごと、またはカット（近すぎるものは間引き、ときどきにする）
  const wipes = [];
  if (o.wipe === "4" || o.wipe === "8") {
    const every = +o.wipe * beat;
    for (let t = (o.offset || 0) + (o.shift || 0) + every; t < o.T; t += every) if (t > 0.3) wipes.push(t);
  } else if (o.wipe === "cut") {
    const R = rng(sc.seed * 7 + 3);
    let last = -9;
    for (const t of o.cuts || []) if (t > 0.3 && t < o.T - 0.2 && t - last > 1.2 && R() < 0.35) { wipes.push(t); last = t; }
  }
  sc.wipeTimes = wipes;
  // 歌詞の行の終わり（次の行の始まり、最長 8 秒）
  if (o.lyrics && o.lyrics.lines) {
    const L = o.lyrics.lines.map((l) => ({ ...l, t: l.t + (o.shift || 0) }));
    sc.lines = L.map((l, i) => ({ ...l, end: Math.min(L[i + 1] ? L[i + 1].t : l.t + 8, l.t + 8) })).filter((l) => l.text);
  }
  return sc;
}

// 曲の特徴を時刻 t（できあがりの時刻）で引く
function feat(sc, t) {
  const an = sc.an, ta = t - (sc.shift || 0);
  if (!an || ta < 0) return { rms: 0, low: 0, mid: 0, high: 0, i: -1 };
  const i = Math.min(an.n - 1, Math.max(0, Math.round(ta * an.rate)));
  return { rms: an.rms[i], low: an.low[i], mid: an.mid[i], high: an.high[i], i };
}
// 拍: 番号と、拍から何秒たったか
function beatAt(sc, t) {
  const t0 = (sc.offset || 0) + (sc.shift || 0);
  const k = Math.floor((t - t0) / sc.beat);
  return { k, since: t - (t0 + k * sc.beat), t0 };
}

const ease = (x) => 1 - Math.pow(1 - Math.max(0, Math.min(1, x)), 3);
const back = (x) => { x = Math.max(0, Math.min(1, x)); const c = 1.9; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };

// ── 1 コマ ──
export function drawFrame(ctx, sc, t) {
  const { W, H, st } = sc;
  ctx.clearRect(0, 0, W, H);
  // 図形は、そのまま描くか、いったん別の canvas に描いてから重ねる（レトロ＝粗く引きのばす、手描き＝ずらして二重、グリッチ＝色をずらして三重）
  let g = ctx, sw = W, sh = H;
  if (st.pixel || st.sketch || st.split) {
    if (st.pixel) { sw = Math.max(32, Math.round(W / st.pixel)); sh = Math.max(18, Math.round(H / st.pixel)); }
    if (!sc._buf || sc._buf.width !== sw) {
      sc._buf = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(sw, sh) : Object.assign(document.createElement("canvas"), { width: sw, height: sh });
    }
    g = sc._buf.getContext("2d");
    g.clearRect(0, 0, sw, sh);
  }
  const u = Math.min(sw, sh);   // 大きさの基準
  const f = feat(sc, t), b = beatAt(sc, t);
  const col = st.rainbow
    ? (i) => `hsl(${Math.round((t * 120 + i * 47) % 360)}, 100%, 60%)`
    : (i) => st.colors[((i % st.colors.length) + st.colors.length) % st.colors.length];
  g.save();
  g.lineJoin = "round"; g.lineCap = "round";
  if (st.add) g.globalCompositeOperation = "lighter";
  if (st.glow) { g.shadowBlur = st.glow * (u / 360); }
  const stroke = (c, w) => { g.strokeStyle = c; g.lineWidth = Math.max(1, w * u); if (st.glow) g.shadowColor = c; g.globalAlpha = st.alpha ?? 1; };
  const fill = (c) => {
    if (st.grad) { const gr = g.createLinearGradient(0, 0, 0, sh); gr.addColorStop(0, c); gr.addColorStop(1, st.grad); g.fillStyle = gr; } else g.fillStyle = c;
    if (st.glow) g.shadowColor = c; g.globalAlpha = st.alpha ?? 1;
  };
  const outline = () => { if (st.outline) { g.strokeStyle = st.outline; g.lineWidth = Math.max(1, st.line * u * 0.8); g.stroke(); } };

  const L = sc.layers;
  if (L.has("pulse")) drawPulse(g, sc, t, b, sw, sh, u, col, stroke, fill, outline);
  if (L.has("ring")) drawRing(g, sc, t, f, sw, sh, u, col, stroke, fill, outline);
  if (L.has("wave")) drawWave(g, sc, f, sw, sh, u, col, stroke);
  if (L.has("bars")) drawBars(g, sc, f, sw, sh, u, col, fill, outline, stroke);
  if (L.has("particles")) drawParticles(g, sc, t, b, sw, sh, u, col, fill, outline);
  g.restore();
  if (st.pixel) {
    ctx.save(); ctx.imageSmoothingEnabled = false; ctx.drawImage(sc._buf, 0, 0, W, H); ctx.restore();
  } else if (st.sketch) {
    // 1/8 秒ごとに少しずつずらして二重に（線がふるえて見える）
    const R = rng(Math.floor(t * 8) + 11), j = Math.max(1, u * 0.004);
    ctx.save();
    ctx.globalAlpha = 0.45; ctx.drawImage(sc._buf, (R() - 0.5) * j * 2, (R() - 0.5) * j * 2);
    ctx.globalAlpha = 1; ctx.drawImage(sc._buf, (R() - 0.5) * j, (R() - 0.5) * j);
    ctx.restore();
  } else if (st.split) {
    // 赤と水色に染めた写しを左右にずらす。ずれは低い音の強さで大きく、拍の頭でさらに跳ねる
    if (!sc._tint || sc._tint.width !== W || sc._tint.height !== H) sc._tint = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(W, H) : Object.assign(document.createElement("canvas"), { width: W, height: H });
    const tc = sc._tint.getContext("2d");
    const d = u * (0.006 + 0.02 * f.low + (b.since < 0.06 ? 0.02 : 0));
    ctx.save();
    for (const [c, dx] of [["#ff0040", -d], ["#00e5ff", d]]) {
      tc.globalCompositeOperation = "source-over"; tc.clearRect(0, 0, W, H); tc.drawImage(sc._buf, 0, 0);
      tc.globalCompositeOperation = "source-in"; tc.fillStyle = c; tc.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = "lighter"; ctx.drawImage(sc._tint, dx, 0);
    }
    ctx.globalCompositeOperation = "source-over"; ctx.drawImage(sc._buf, 0, 0);
    ctx.restore();
  }
  // 文字（枠・タイトル・歌詞）とワイプは細かいまま上に描く（レトロでも読めるように）
  const U = Math.min(W, H);
  if (sc.frame && sc.frame !== "none") { ctx.save(); drawFrameDeco(ctx, sc, t, f, b, W, H, U, col); ctx.restore(); }
  if (sc.title && sc.title.on) { ctx.save(); drawTitle(ctx, sc, t, b, W, H, U, col); ctx.restore(); }
  if (sc.lines) { ctx.save(); drawLyrics(ctx, sc, t, b, W, H, U, col); ctx.restore(); }
  if (sc.wipeTimes && sc.wipeTimes.length) { ctx.save(); drawWipe(ctx, sc, t, W, H, U, col); ctx.restore(); }
}

// 拍ごとに図形がドンと広がる（4 拍目ごとに大きく）
function drawPulse(g, sc, t, b, W, H, u, col, stroke) {
  for (let back = 0; back < 3; back++) {
    const k = b.k - back, since = b.since + back * sc.beat;
    const life = 0.9;
    if (since < 0 || since > life || k < 0) continue;
    const R = rng(sc.seed * 1000 + k);
    const big = k % 4 === 0;
    const p = since / life, r = u * (big ? 0.55 : 0.32) * ease(p);
    const cx = big ? W / 2 : W * (0.2 + 0.6 * R()), cy = big ? H / 2 : H * (0.25 + 0.5 * R());
    const shape = Math.floor(R() * 3);
    stroke(col(k), (big ? 2.2 : 1.4) * sc.st.line * (1 - p * 0.6));
    g.globalAlpha *= 1 - p;
    g.beginPath();
    if (shape === 0) g.arc(cx, cy, r, 0, Math.PI * 2);
    else if (shape === 1) { const a = R() * Math.PI + since; for (let i = 0; i < 4; i++) { const q = a + (i * Math.PI) / 2; g[i ? "lineTo" : "moveTo"](cx + r * Math.cos(q), cy + r * Math.sin(q)); } g.closePath(); }
    else { const a = -Math.PI / 2 + since * 2; for (let i = 0; i < 3; i++) { const q = a + (i * 2 * Math.PI) / 3; g[i ? "lineTo" : "moveTo"](cx + r * Math.cos(q), cy + r * Math.sin(q)); } g.closePath(); }
    g.stroke();
  }
}

// 丸く並んだスペクトラム。低い音で輪がふくらみ、ゆっくり回る
function drawRing(g, sc, t, f, W, H, u, col, stroke, fill, outline) {
  if (f.i < 0) return;
  const an = sc.an, cx = W / 2, cy = H / 2;
  const r0 = u * (0.16 + 0.05 * f.low), n = BANDS * 2;
  const rot = t * 0.4;
  stroke(col(0), sc.st.line * 1.2);
  g.beginPath(); g.arc(cx, cy, r0, 0, Math.PI * 2); g.stroke();
  for (let i = 0; i < n; i++) {
    const bi = i < BANDS ? i : n - 1 - i;
    const v = an.bands[f.i * BANDS + bi];
    const a = rot + (i / n) * Math.PI * 2, len = u * (0.02 + 0.17 * v);
    stroke(col(sc.st.rainbow ? i : 1 + (i % 2)), sc.st.line * 1.6);
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * (r0 + u * 0.015), cy + Math.sin(a) * (r0 + u * 0.015));
    g.lineTo(cx + Math.cos(a) * (r0 + len), cy + Math.sin(a) * (r0 + len));
    g.stroke();
  }
}

// オシロスコープの線
function drawWave(g, sc, f, W, H, u, col, stroke) {
  if (f.i < 0) return;
  const an = sc.an, y0 = H * 0.5, amp = H * 0.2;
  stroke(col(2), sc.st.line * 1.3);
  g.beginPath();
  for (let j = 0; j < WAVE; j++) {
    const v = an.wave[f.i * WAVE + j];
    g[j ? "lineTo" : "moveTo"]((j / (WAVE - 1)) * W, y0 + v * amp);
  }
  g.stroke();
}

// 下に並ぶスペクトラムのバー
function drawBars(g, sc, f, W, H, u, col, fill, outline, stroke) {
  if (f.i < 0) return;
  const an = sc.an, n = BANDS, gap = W * 0.004, bw = (W * 0.9 - gap * (n - 1)) / n, x0 = W * 0.05;
  for (let i = 0; i < n; i++) {
    const v = Math.min(1, an.bands[f.i * BANDS + i]), h = Math.max(u * 0.01, H * 0.28 * v);
    const x = x0 + i * (bw + gap), y = H * 0.97 - h;
    if (sc.st.fill || sc.st.glow) {
      fill(col(sc.st.rainbow ? i : Math.floor((i / n) * sc.st.colors.length)));   // ゲーミングは 1 本ずつ色相をずらして虹に
      g.beginPath(); g.rect(x, y, bw, h); g.fill(); outline();
    } else {
      stroke(col(0), sc.st.line); g.beginPath(); g.rect(x, y, bw, h); g.stroke();
    }
  }
}

// 拍ではじけるつぶ。拍の番号から乱数を決め、位置は経過時間の式で出す
function drawParticles(g, sc, t, b, W, H, u, col, fill, outline) {
  const life = 1.1;
  for (let back = 0; back < 3; back++) {
    const k = b.k - back, age = b.since + back * sc.beat;
    if (k < 0 || age < 0 || age > life) continue;
    const ta = b.t0 + k * sc.beat - (sc.shift || 0);
    const strength = sc.an && ta >= 0 ? sc.an.low[Math.min(sc.an.n - 1, Math.round(ta * sc.an.rate))] : 0.6;
    if (strength < 0.35 && k % 2) continue;   // 弱い拍の半分はお休み
    const R = rng(sc.seed * 7919 + k);
    const cx = W * (0.15 + 0.7 * R()), cy = H * (0.2 + 0.5 * R());
    const count = 22 + Math.floor(R() * 20);
    for (let i = 0; i < count; i++) {
      const a = R() * Math.PI * 2, sp = u * (0.35 + R() * 0.9) * (0.6 + strength);
      const x = cx + Math.cos(a) * sp * age, y = cy + Math.sin(a) * sp * age + u * 0.9 * age * age;
      const s = u * (0.012 + R() * 0.022) * (1 - 0.7 * age / life);
      fill(col(i));
      g.globalAlpha *= 1 - age / life;
      g.beginPath();
      if (sc.st.pixel || i % 3 === 0) g.rect(x - s, y - s, s * 2, s * 2); else g.arc(x, y, s, 0, Math.PI * 2);
      g.fill(); outline();
      g.globalAlpha = sc.st.alpha ?? 1;
    }
  }
}

// ── ワイプ: 切り替えの前後 0.32 秒で画面をおおってから開ける ──
function drawWipe(g, sc, t, W, H, u, col) {
  const d = Math.min(0.32, sc.beat * 0.75);
  const wt = sc.wipeTimes.find((w) => t >= w - d / 2 && t < w + d / 2);
  if (wt === undefined) return;
  const idx = sc.wipeTimes.indexOf(wt), R = rng(sc.seed * 31 + idx);
  const kind = Math.floor(R() * 4), c = col(Math.floor(R() * 8));
  let p = (t - (wt - d / 2)) / d;              // 0→1。0.5 で全部おおう
  if (sc.st.pixel) p = Math.round(p * 6) / 6;   // レトロは 6 段でカクカク
  const cover = p < 0.5 ? ease(p * 2) : 1 - ease((p - 0.5) * 2);
  g.fillStyle = c; g.globalAlpha = 1;
  if (sc.st.outline) { g.strokeStyle = sc.st.outline; g.lineWidth = Math.max(2, u * 0.012); }
  const diag = Math.hypot(W, H);
  g.beginPath();
  if (kind === 0) {               // 丸がひらく
    g.arc(W / 2, H / 2, (diag / 2) * cover, 0, Math.PI * 2);
  } else if (kind === 1) {        // 斜めの帯が横切る
    const n = 5;
    for (let i = 0; i < n; i++) {
      const w = (W / n) * 1.25 * Math.min(1, cover * 1.6), cx = W / 2 + (i - (n - 1) / 2) * (W / n);
      g.moveTo(cx - w / 2 - H * 0.3, H); g.lineTo(cx + w / 2 - H * 0.3, H); g.lineTo(cx + w / 2 + H * 0.3, 0); g.lineTo(cx - w / 2 + H * 0.3, 0); g.closePath();
    }
  } else if (kind === 2) {        // ブラインド
    const n = 8, hh = H / n;
    for (let i = 0; i < n; i++) g.rect(0, i * hh + (hh * (1 - cover)) / 2, W, hh * cover + 1);
  } else {                        // 斜めの一閃（左から右へ抜ける）
    const w = W * 1.4 * Math.min(1, cover * 1.4 + 0.15), x = -W * 0.8 + p * W * 2.6;
    g.moveTo(x - w / 2, H); g.lineTo(x + w / 2, H); g.lineTo(x + w / 2 + H * 0.5, 0); g.lineTo(x - w / 2 + H * 0.5, 0); g.closePath();
  }
  g.fill();
  if (sc.st.outline) g.stroke();
}

// ── 文字 ──
function font(sc, px, weight) {
  const fam = sc.st.serif ? `"Hiragino Mincho ProN", "Yu Mincho", YuMincho, "Noto Serif JP", "Noto Serif CJK JP", serif`
    : sc.st.mono ? `"${sc.font || "sans-serif"}", ui-monospace, monospace` : `"${sc.font || "sans-serif"}", sans-serif`;
  return `${weight || sc.st.font} ${Math.round(px)}px ${fam}`;
}
function textStyle(g, sc, c, u) {
  g.fillStyle = c;
  if (sc.st.glow) { g.shadowColor = c; g.shadowBlur = sc.st.glow * (u / 360); }
  g.lineJoin = "round";
  g.strokeStyle = sc.st.outline || "rgba(0,0,0,0.85)";
  g.lineWidth = Math.max(2, u * (sc.st.outline ? 0.016 : 0.01));
}
function fitSize(g, sc, text, px, maxW, weight) {
  g.font = font(sc, px, weight);
  const w = g.measureText(text).width;
  return w > maxW ? (px * maxW) / w : px;
}

// タイトル: 0.3〜3.8 秒。スタイルごとに出かたを変える
function drawTitle(g, sc, t, b, W, H, u, col) {
  const a = 0.3, z = 3.8;
  if (t < a || t > z + 0.4 || !(sc.title.title || sc.title.artist)) return;
  const p = (t - a) / (z - a), out = t > z ? 1 - (t - z) / 0.4 : 1;
  const title = sc.title.title || "", artist = sc.title.artist || "";
  g.textAlign = "center"; g.textBaseline = "middle";
  const px = fitSize(g, sc, title, u * 0.13, W * 0.86), apx = fitSize(g, sc, artist, u * 0.06, W * 0.8, "700");
  const cy = H * 0.46;
  g.globalAlpha = Math.max(0, out);
  const kind = sc.style;
  let shown = title, dy = 0, scale = 1, spacing = 0;
  if (kind === "retro" || kind === "cyber") shown = title.slice(0, Math.floor(ease(p * 2.2) * title.length + 0.999));
  if (kind === "pop") { scale = back(p * 3); dy = 0; }
  if (kind === "minimal") { g.globalAlpha *= ease(p * 3); spacing = (1 - ease(p * 2)) * u * 0.03; }
  if (kind === "neon") g.globalAlpha *= p < 0.15 ? (Math.floor(t * 30) % 3 ? 0.2 : 1) : 1;   // ちらついて点く
  g.save();
  g.translate(W / 2, cy + dy); g.scale(scale, scale);
  g.font = font(sc, px);
  textStyle(g, sc, col(0), u);
  if ("letterSpacing" in g) g.letterSpacing = `${spacing}px`;
  if (sc.st.outline || !sc.st.glow) g.strokeText(shown, 0, 0);
  g.fillText(shown, 0, 0);
  g.restore();
  if (artist && p > 0.25) {
    g.globalAlpha = Math.max(0, out) * ease((p - 0.25) * 4);
    g.font = font(sc, apx, "700");
    textStyle(g, sc, col(1), u);
    const y = cy + px * 0.85 + (1 - ease((p - 0.25) * 4)) * u * 0.05;
    if (sc.st.outline || !sc.st.glow) g.strokeText(artist, W / 2, y);
    g.fillText(artist, W / 2, y);
  }
  // 下線がのびる
  g.globalAlpha = Math.max(0, out);
  g.fillStyle = col(2);
  const lw = W * 0.5 * ease(p * 2.5);
  g.fillRect(W / 2 - lw / 2, cy - px * 0.75, lw, Math.max(2, u * 0.008));
}

// 動く歌詞: 1 文字ずつ出す。anim = bounce（跳ねて落ちる）/ pop（ポンと出て拍でふくらむ）/ type（打つ）/ glitch（ずれる）
function drawLyrics(g, sc, t, b, W, H, u, col) {
  const line = sc.lines.find((l) => t >= l.t && t < l.end);
  if (!line) return;
  const anim = (sc.lyrics && sc.lyrics.anim) || "bounce";
  const chars = [...line.text], age = t - line.t, left = line.end - t;
  const px0 = u * 0.085;
  const px = fitSize(g, sc, line.text, px0, W * 0.9);
  g.font = font(sc, px);
  g.textBaseline = "middle"; g.textAlign = "left";
  const widths = chars.map((c) => g.measureText(c).width), total = widths.reduce((a, w) => a + w, 0);
  const y = (sc.lyrics && sc.lyrics.pos === "middle") ? H * 0.5 : H * 0.84;
  let x = (W - total) / 2;
  const fadeOut = Math.min(1, left / 0.25);
  const pulse = 1 + 0.08 * Math.max(0, 1 - b.since / 0.18);
  const per = Math.min(0.06, 0.6 / chars.length);
  chars.forEach((ch, i) => {
    const ca = age - i * per;
    const w = widths[i];
    if (anim === "type" && ca < 0) return;
    g.save();
    let dx = 0, dy = 0, sc2 = 1, alpha = fadeOut;
    if (anim === "bounce") { dy = -(1 - back(ca / 0.35)) * px * 1.2; alpha *= ca < 0 ? 0 : Math.min(1, ca / 0.08); }
    if (anim === "pop") { sc2 = ca < 0 ? 0 : back(ca / 0.25) * pulse; }
    if (anim === "glitch") { alpha *= ca < 0 ? 0 : 1; dx = (b.since < 0.08 ? (rng(i * 13 + b.k)() - 0.5) * px * 0.4 : 0); }
    g.globalAlpha = Math.max(0, alpha);
    g.translate(x + w / 2 + dx, y + dy);
    g.scale(sc2, sc2);
    g.font = font(sc, px);
    if (anim === "glitch") {
      g.globalCompositeOperation = "lighter";
      g.fillStyle = "#ff0040"; g.fillText(ch, -w / 2 - px * 0.04, 0);
      g.fillStyle = "#00e5ff"; g.fillText(ch, -w / 2 + px * 0.04, 0);
      g.globalCompositeOperation = "source-over";
    }
    textStyle(g, sc, anim === "glitch" ? "#ffffff" : col(i % 4 === 3 ? 1 : 0), u);
    if (sc.st.outline || !sc.st.glow || anim !== "glitch") g.strokeText(ch, -w / 2, 0);
    g.fillText(ch, -w / 2, 0);
    g.restore();
    x += w;
  });
  if (anim === "type" && Math.floor(t * 3) % 2 === 0) {
    const shownW = widths.reduce((a, w, i) => a + (age - i * per >= 0 ? w : 0), 0);
    g.fillStyle = col(1); g.globalAlpha = fadeOut;
    g.fillRect((W - total) / 2 + shownW + px * 0.05, y - px * 0.45, px * 0.08, px * 0.9);
  }
}

// ── 枠 ──
const tc = (t) => { const s = Math.max(0, t), m = Math.floor(s / 60), h = Math.floor(m / 60); return `${h}:${String(m % 60).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`; };
function drawFrameDeco(g, sc, t, f, b, W, H, u, col) {
  const k = sc.frame, m = u * 0.05;
  g.textBaseline = "top";
  const label = (txt, x, y, px, c, align = "left") => {
    g.font = font({ ...sc, st: { ...sc.st, mono: true } }, px, "800");
    g.textAlign = align; textStyle(g, sc, c, u);
    g.strokeText(txt, x, y); g.fillText(txt, x, y);
  };
  if (k === "hud") {
    // レトロゲーム: スコア（曲の大きさの合計）、ハイスコア、ステージ（16 拍ごと）、体力（今の大きさ）
    const an = sc.an, ta = t - (sc.shift || 0);
    const i = an ? Math.max(0, Math.min(an.n, Math.round(ta * an.rate))) : 0;
    const score = an ? Math.floor(an.acc[i] * 10) : 0, hi = an ? Math.floor(an.acc[an.n] * 10) : 0;
    const px = u * 0.05;
    label(`SCORE ${String(score).padStart(7, "0")}`, m, m, px, col(3) || "#fff");
    label(`HI ${String(hi).padStart(7, "0")}`, W / 2, m, px, col(0), "center");
    label(`STAGE ${Math.max(1, Math.floor(b.k / 16) + 1)}`, W - m, m, px, col(1), "right");
    const bw = W * 0.28, hp = f.rms;
    g.globalAlpha = 1; g.fillStyle = "rgba(0,0,0,0.6)"; g.fillRect(m, m + px * 1.4, bw, px * 0.6);
    g.fillStyle = hp > 0.7 ? col(2) : col(0); g.fillRect(m, m + px * 1.4, bw * hp, px * 0.6);
    label("HP", m + bw + px * 0.3, m + px * 1.3, px * 0.7, col(3) || "#fff");
    // 残機
    for (let j = 0; j < 3; j++) { g.fillStyle = col(2); g.fillRect(W - m - (j + 1) * px * 1.1, m + px * 1.4, px * 0.8, px * 0.6); }
  } else if (k === "vhs") {
    const px = u * 0.055;
    label("PLAY ▶", m, m, px, "#ffffff");
    label(`SP  ${tc(t)}`, W - m, H - m - px, px, "#ffffff", "right");
    label(sc.dateText, m, H - m - px, px * 0.9, "#ffffff");
    // 走査線と、8 拍ごとに流れる乱れ
    g.globalAlpha = 0.12; g.fillStyle = "#000";
    for (let y = 0; y < H; y += Math.max(2, Math.round(u / 120))) g.fillRect(0, y, W, Math.max(1, Math.round(u / 240)));
    if (b.k % 8 === 7) {
      const y = H * (1 - b.since / sc.beat);
      g.globalAlpha = 0.35; g.fillStyle = "#ffffff";
      const R = rng(b.k * 17 + Math.floor(t * 30));
      for (let j = 0; j < 30; j++) g.fillRect(R() * W, y + R() * u * 0.05, R() * u * 0.2, Math.max(1, u * 0.004));
    }
  } else if (k === "rec") {
    const px = u * 0.05, c = "#ffffff", L = u * 0.09;
    g.strokeStyle = c; g.lineWidth = Math.max(2, u * 0.006); g.globalAlpha = 0.9;
    for (const [x, y, sx, sy] of [[m, m, 1, 1], [W - m, m, -1, 1], [m, H - m, 1, -1], [W - m, H - m, -1, -1]]) {
      g.beginPath(); g.moveTo(x, y + sy * L); g.lineTo(x, y); g.lineTo(x + sx * L, y); g.stroke();
    }
    if (Math.floor(t * 1.6) % 2 === 0) { g.fillStyle = "#ff2020"; g.beginPath(); g.arc(m * 2 + px * 0.4, m * 1.6 + px * 0.5, px * 0.38, 0, Math.PI * 2); g.fill(); }
    label("REC", m * 2 + px, m * 1.6, px, c);
    label(tc(t), W - m * 2, m * 1.6, px, c, "right");
    // 電池と焦点の十字
    g.strokeStyle = c; g.strokeRect(W - m * 2 - px * 1.6, H - m * 2 - px * 0.8, px * 1.4, px * 0.7);
    g.fillStyle = c; g.fillRect(W - m * 2 - px * 1.5, H - m * 2 - px * 0.7, px * 1.2 * (0.4 + 0.6 * (1 - t / Math.max(1, sc.T))), px * 0.5);
    g.beginPath(); g.moveTo(W / 2 - L * 0.4, H / 2); g.lineTo(W / 2 + L * 0.4, H / 2); g.moveTo(W / 2, H / 2 - L * 0.4); g.lineTo(W / 2, H / 2 + L * 0.4); g.stroke();
  }
  if (sc.st.scan) {
    g.globalAlpha = 0.08; g.fillStyle = sc.st.colors[0];
    for (let y = (t * 40) % 6; y < H; y += 6) g.fillRect(0, y, W, 1);
  }
}
