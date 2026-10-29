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
export const TIME_FX = ["normal", "stutter", "reverse", "fast", "slow", "freeze", "pingpong", "choppy", "warp", "skip"];
// 見た目の崩し方。group が同じものは 1 区間に 1 つまで（画面の割り方・寄り方がぶつからないように）
export const LOOKS = {
  hflip: {}, vflip: {}, negate: {}, mono: {},
  flash: { group: "fade" }, blackflash: { group: "fade" },
  zoom: { group: "zoom" }, zoomin: { group: "zoom" }, shake: { group: "zoom" }, lens: { group: "zoom" },
  mirror: { group: "layout" }, kaleido: { group: "layout" }, grid4: { group: "layout" },
  rgb: { group: "rgb" }, rgbx: { group: "rgb" }, chroma: { group: "rgb" },
  pixel: { group: "pixel" }, blur: { group: "pixel" },
  posterize: { group: "color" }, edge: { group: "color" }, huespin: { group: "color" }, saturate: { group: "color" },
  xpro: { group: "color" }, swap: { group: "color" },
  contrast: {}, vignette: {}, noise: {}, strobe: {}, trail: {},
};
export const LOOK_FX = Object.keys(LOOKS);
// 時間の崩し方ごとに、出す長さ dur に対して素材を何秒使うか
const NEED = { fast: 2, warp: 4, skip: 2, slow: 0.5, pingpong: 0.5 };

// chaos（ぐちゃぐちゃ度）は切り方の細かさと時間の崩し、amount（効果の量）は見た目の崩しの多さ。どちらも 0〜1
export function makePlan({ seed, chaos, amount = chaos, bpm, offset, T, F, clips }) {
  const R = rng(seed), pick = (a) => a[Math.floor(R() * a.length)];
  const beat = 60 / bpm, total = Math.round(T * F);
  const c = Math.max(0, Math.min(1, chaos)), am = Math.max(0, Math.min(1, amount));
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
    if (R() < 0.85 * c) time = pick(TIME_FX.slice(1));
    // 逆回し・行って戻るはコマを全部抱えるので短い区間だけ。くり返し・飛ばしは数コマないと形にならない
    if ((time === "reverse" || time === "pingpong") && dur > 1.2) time = "normal";
    if ((time === "stutter" || time === "skip" || time === "pingpong") && frames < 4) time = "normal";
    // 見た目の崩し: 効果の量に応じて 0〜4 個重ねる。group ごとに 1 つまで
    let k = 0;
    while (k < 4 && R() < am * (k === 0 ? 0.9 : 0.55)) k++;
    const look = [], groups = new Set();
    for (let tries = 0; look.length < k && tries < 20; tries++) {
      const fx = pick(LOOK_FX), g = LOOKS[fx].group;
      if (look.includes(fx) || (g && groups.has(g))) continue;
      look.push(fx); if (g) groups.add(g);
    }
    const src = Math.floor(R() * clips.length);
    const reps = time === "stutter" ? 2 + Math.floor(R() * 3) : 1;
    const need = time === "stutter" ? dur / reps : time === "freeze" ? 1 / F : dur * (NEED[time] || 1);
    const len = clips[src].dur;
    // 動画が足りなければ短く使い、足りないぶんは最後のコマを延ばす（フィルタの tpad）
    const at = len > need ? R() * (len - need) : 0;
    // 効果の加減（色相の回る向き、ずれの向き）も番号から決める
    const p = { dir: R() < 0.5 ? -1 : 1, hue: Math.round(R() * 360) };
    segs.push({ src, at: Math.round(at * 1000) / 1000, frames, time, reps, need: Math.min(need, len), look, p });
  }
  return segs;
}

export function planSummary(segs) {
  const n = (f) => segs.filter(f).length;
  const kinds = new Set(segs.flatMap((s) => s.look));
  return {
    segments: segs.length,
    timeFx: n((s) => s.time !== "normal"),
    lookFx: segs.reduce((t, s) => t + s.look.length, 0),
    kinds: kinds.size + new Set(segs.map((s) => s.time).filter((x) => x !== "normal")).size,
    stutter: n((s) => s.time === "stutter"), reverse: n((s) => s.time === "reverse"),
    fast: n((s) => s.time === "fast"), slow: n((s) => s.time === "slow"), freeze: n((s) => s.time === "freeze"),
    look: n((s) => s.look.length > 0),
  };
}

// ── 1区間ぶんのフィルタ ──
// 入力は「-ss at -t need -i 動画」で切り出してある前提。W×H・F コマ/秒にそろえ、ちょうど frames コマにする。
// id はこの区間の中だけで使う枝の名前の頭（鏡写し・万華鏡・4分割は枝分かれするので、グラフの中で名前がぶつからないように）
export function segFilter(seg, { W, H, F }, id = "s") {
  const N = seg.frames, p = seg.p || { dir: 1, hue: 90 };
  const fit = `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1`;
  const f = [];
  const speed = { fast: 0.5, warp: 0.25, skip: 0.5, slow: 2, pingpong: 1 }[seg.time] || 1;
  f.push(speed === 1 ? "setpts=PTS-STARTPTS" : `setpts=${speed}*(PTS-STARTPTS)`);
  f.push(`fps=${F}`, fit, "format=yuv420p");
  if (seg.time === "stutter") {
    const M = Math.max(1, Math.round(N / seg.reps));
    f.push(`tpad=stop_mode=clone:stop=${M}`, `trim=end_frame=${M}`, "setpts=PTS-STARTPTS", `loop=loop=${seg.reps}:size=${M}:start=0`);
  } else if (seg.time === "freeze") {
    f.push("trim=end_frame=1", "setpts=PTS-STARTPTS", `loop=loop=${N}:size=1:start=0`);
  } else if (seg.time === "reverse") {
    f.push(`tpad=stop_mode=clone:stop=${N}`, `trim=end_frame=${N}`, "reverse");
  } else if (seg.time === "pingpong") {
    // 前半を前向き、後半を同じところの逆回し
    const M = Math.max(1, Math.ceil(N / 2));
    f.push(`tpad=stop_mode=clone:stop=${M}`, `trim=end_frame=${M}`, "setpts=PTS-STARTPTS",
      `split[${id}pa][${id}pb];[${id}pb]reverse[${id}pr];[${id}pa][${id}pr]concat=n=2:v=1:a=0`);
  } else if (seg.time === "choppy") {
    f.push(`fps=${Math.max(4, Math.round(F / 5))}`, `fps=${F}`);
  } else if (seg.time === "skip") {
    // 2 倍の素材から 4 コマ出して 4 コマ飛ばす（つっかえながら進む）
    f.push("select='lt(mod(n,8),4)'", "setpts=N/FRAME_RATE/TB");
  }
  const sh = Math.max(2, Math.round(W / 80)) * p.dir;
  for (const fx of seg.look) {
    const L = `${id}${fx}`;
    switch (fx) {
      case "hflip": f.push("hflip"); break;
      case "vflip": f.push("vflip"); break;
      case "negate": f.push("negate"); break;
      case "mono": f.push("hue=s=0"); break;
      case "flash": f.push(`fade=t=in:st=0:d=${Math.min(0.15, N / F / 2).toFixed(3)}:color=white`); break;
      case "blackflash": f.push(`fade=t=in:st=0:d=${Math.min(0.2, N / F / 2).toFixed(3)}:color=black`); break;
      case "zoom": f.push(`crop=iw/1.35:ih/1.35,scale=${W}:${H},setsar=1`); break;
      case "zoomin": f.push(`zoompan=z='1+0.6*on/${N}':d=1:x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':s=${W}x${H}:fps=${F}`, "setsar=1"); break;
      case "shake": f.push(`crop=iw*0.88:ih*0.88:x='(iw-ow)/2+(random(1)-0.5)*iw*0.1':y='(ih-oh)/2+(random(2)-0.5)*ih*0.1'`, `scale=${W}:${H}`, "setsar=1"); break;
      case "lens": f.push("lenscorrection=k1=0.6:k2=0.4"); break;
      case "mirror": f.push(`crop=iw/2:ih:0:0,split[${L}a][${L}b];[${L}b]hflip[${L}c];[${L}a][${L}c]hstack`, `scale=${W}:${H}`, "setsar=1"); break;
      case "kaleido": f.push(`crop=iw/2:ih/2:0:0,split=4[${L}a][${L}b][${L}c][${L}d];[${L}b]hflip[${L}e];[${L}c]vflip[${L}f];[${L}d]hflip,vflip[${L}g];[${L}a][${L}e]hstack[${L}t];[${L}f][${L}g]hstack[${L}u];[${L}t][${L}u]vstack`, `scale=${W}:${H}`, "setsar=1"); break;
      case "grid4": f.push(`scale=${Math.round(W / 2)}:${Math.round(H / 2)},split=4[${L}a][${L}b][${L}c][${L}d];[${L}a][${L}b]hstack[${L}t];[${L}c][${L}d]hstack[${L}u];[${L}t][${L}u]vstack`, `scale=${W}:${H}`, "setsar=1"); break;
      case "rgb": f.push(`rgbashift=rh=${-sh}:bh=${sh}`); break;
      case "rgbx": f.push(`rgbashift=rh=${-3 * sh}:bh=${3 * sh}:gv=${sh}`); break;
      case "chroma": f.push(`chromashift=cbh=${2 * sh}:crh=${-2 * sh}:cbv=${sh}`); break;
      case "pixel": f.push(`scale=${Math.max(8, Math.round(W / 24))}:-2,scale=${W}:${H}:flags=neighbor`, "setsar=1"); break;
      case "blur": f.push("boxblur=10:2"); break;
      case "posterize": f.push("lutrgb=r='bitand(val,192)':g='bitand(val,192)':b='bitand(val,192)'"); break;
      case "edge": f.push("edgedetect=mode=colormix:high=0.15:low=0.05"); break;
      case "huespin": f.push(`hue=h='${p.hue}+${720 * p.dir}*t':s=1.8`); break;
      case "saturate": f.push("eq=saturation=3:contrast=1.2"); break;
      case "xpro": f.push("curves=preset=cross_process"); break;
      case "swap": f.push("colorchannelmixer=rr=0:rb=1:br=1:bb=0"); break;
      case "contrast": f.push("eq=contrast=2.2:brightness=0.05"); break;
      case "vignette": f.push("vignette=PI/3"); break;
      case "noise": f.push("noise=alls=45:allf=t+u"); break;
      case "strobe": f.push("eq=brightness='0.5*mod(floor(t*16),2)':eval=frame"); break;
      case "trail": f.push("lagfun=decay=0.92"); break;
    }
  }
  // 最後にちょうど N コマに（足りなければ最後のコマを延ばす）。途中の効果で形が変わっても yuv420p にそろえる
  f.push("format=yuv420p", "setpts=N/FRAME_RATE/TB", `tpad=stop_mode=clone:stop=${N}`, `trim=end_frame=${N}`, "setpts=PTS-STARTPTS");
  return f.join(",");
}
