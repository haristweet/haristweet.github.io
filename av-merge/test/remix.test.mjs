// リミックスの単体試験。  node test/remix.test.mjs [出力フォルダ]
// 拍の検出は、テンポの分かっている合成ドラムで当たるか。設計図は、同じ番号で同じになるか・区切りが拍の上か・コマ数が合うか。
// 区間のフィルタは手元の ffmpeg で効果ごとに流し、ちょうど決めたコマ数が出るか
import { execFileSync } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { detectBeats, makePlan, segFilter, TIME_FX, LOOK_FX, LOOKS } from "../remix.js";

const OUT = resolve(process.argv[2] || "test-out");
await mkdir(OUT, { recursive: true });
const S = (n) => join(OUT, n);
const ff = (...a) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...a]);
let fail = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "OK" : "NG"} ${name}${ok ? "" : " " + detail}`); if (!ok) fail++; };

// ── 拍の検出 ──
// キック（拍ごと）・ハイハット（裏拍）・ベース（ずっと鳴る）・雑音。first 秒から始まる
const SR = 22050;
async function drums(bpm, first, dur, name) {
  const P = 60 / bpm;
  const ph = `(t-${first})`, inb = `mod(${ph},${P})`, off = `mod(${ph}+${P / 2},${P})`;
  const expr = `if(gte(t,${first}), 0.9*sin(2*PI*55*${inb}*(1+3*exp(-40*${inb})))*exp(-12*${inb}) + 0.25*(random(0)-0.5)*exp(-60*${off}), 0) + 0.15*sin(2*PI*110*t) + 0.03*(random(1)-0.5)`;
  ff("-f", "lavfi", "-i", `aevalsrc='${expr}':s=${SR}:d=${dur}`, "-f", "f32le", "-ac", "1", S(name));
  const b = await readFile(S(name));
  return new Float32Array(b.buffer, b.byteOffset, b.length / 4);
}
for (const [bpm, first, okOctave] of [[128, 0.3, false], [95, 1.1, false], [174, 0.05, true], [140, 0.47, false]]) {
  const r = detectBeats(await drums(bpm, first, 40, `d${bpm}.f32`), SR);
  const P = 60 / bpm;
  const bpmOk = Math.abs(r.bpm - bpm) < 0.3 || (okOctave && Math.abs(r.bpm * 2 - bpm) < 0.6);
  const Pd = 60 / r.bpm;
  const d = Math.abs(((r.offset - first) % Pd + Pd * 1.5) % Pd - Pd / 2);   // 拍の位置のずれ（拍の長さで回る）
  check(`拍の検出 ${bpm} BPM（1拍目 ${first} 秒）→ ${r.bpm} BPM・${r.offset} 秒・確かさ ${r.confidence.toFixed(1)}`, bpmOk && d < 0.03, `ずれ ${d.toFixed(3)} 秒`);
  void P;
}
check("4 秒より短いと決めない", detectBeats(new Float32Array(SR * 2), SR) === null);

// ── 設計図 ──
const clips = [{ dur: 6 }, { dur: 0.3 }, { dur: 20 }];
const base = { seed: 42, chaos: 0.8, bpm: 128, offset: 0.3, T: 60, F: 30, clips };
const a = makePlan(base), b = makePlan(base), c2 = makePlan({ ...base, seed: 43 });
check("同じ番号なら同じ設計図", JSON.stringify(a) === JSON.stringify(b));
check("番号を変えると別の設計図", JSON.stringify(a) !== JSON.stringify(c2));
check("全部でちょうど T 秒ぶんのコマ", a.reduce((t, s) => t + s.frames, 0) === 60 * 30, a.reduce((t, s) => t + s.frames, 0));
let f = 0, offGrid = 0;
const q = 60 / 128 / 4;
for (const s of a) {
  const tt = f / 30;
  if (f > 0 && Math.abs(((tt - 0.3) / q) - Math.round((tt - 0.3) / q)) * q > 0.5 / 30 + 1e-9) offGrid++;
  f += s.frames;
}
check("区切りは 1/4 拍の上（コマの丸めの範囲）", offGrid === 0, `${offGrid} 個ずれ`);
check("素材の外を使わない", a.every((s) => s.at >= 0 && s.at + s.need <= clips[s.src].dur + 1e-6));
const calm = makePlan({ ...base, chaos: 0 });
check("ぐちゃぐちゃ度 0 は崩さない（区切りは 1〜2 拍）", calm.every((s) => s.time === "normal" && !s.look.length) && calm.slice(1, -1).every((s) => s.frames >= Math.round(60 / 128 * 30) - 1), "");
const wild = makePlan({ ...base, chaos: 1, amount: 1, T: 180 });
const used = new Set(wild.flatMap((s) => [s.time, ...s.look]));
check("ぐちゃぐちゃ度 1 なら崩し方が全部出る", [...TIME_FX, ...LOOK_FX].every((x) => used.has(x)), [...TIME_FX, ...LOOK_FX].filter((x) => !used.has(x)).join(","));
const few = makePlan({ ...base, amount: 0.2 }), lots = makePlan({ ...base, amount: 1 });
const per = (pl) => pl.reduce((t, s) => t + s.look.length, 0) / pl.length;
check(`効果の量を上げると見た目の崩しが増える（${per(few).toFixed(2)} → ${per(lots).toFixed(2)} 個／区間）`, per(lots) > per(few) * 2 && per(lots) >= 1.5);
const clash = lots.filter((sg) => sg.look.filter((fx) => LOOKS[fx].group === "layout").length > 1);
check("画面の割り方を変える効果は 1 区間に 1 つまで", clash.length === 0, JSON.stringify(clash[0]));
check("ぐちゃぐちゃ度が高いほど区切りが細かい", wild.length / 180 > calm.length / 60 * 1.3, `${wild.length / 180} vs ${calm.length / 60}`);

// ── 区間のフィルタを手元の ffmpeg で流す ──
ff("-f", "lavfi", "-i", "testsrc=size=480x270:rate=24:duration=6", "-c:v", "libx264", "-pix_fmt", "yuv420p", S("src.mp4"));
ff("-f", "lavfi", "-i", "testsrc=size=270x480:rate=30:duration=0.3", "-c:v", "libx264", "-pix_fmt", "yuv420p", S("short.mp4"));
const files = [S("src.mp4"), S("short.mp4"), S("src.mp4")];
const dims = { W: 640, H: 360, F: 30 };
// 崩し方ごとに 1 つずつ＋重ねがけ＋短すぎる素材
const NEEDX = { fast: 2, warp: 4, skip: 2, slow: 0.5, pingpong: 0.5, freeze: 0.1 };
const tests = [
  ...TIME_FX.map((time) => ({ src: 0, at: 1, frames: 13, time, reps: 3, need: 13 / 30 * (NEEDX[time] || 1), look: [] })),
  ...LOOK_FX.map((fx) => ({ src: 0, at: 2, frames: 9, time: "normal", reps: 1, need: 0.3, look: [fx], p: { dir: -1, hue: 200 } })),
  { src: 0, at: 0.5, frames: 15, time: "pingpong", reps: 1, need: 0.25, look: ["kaleido", "rgbx", "trail", "huespin"], p: { dir: 1, hue: 10 } },
  { src: 2, at: 0.2, frames: 11, time: "skip", reps: 1, need: 0.8, look: ["grid4", "strobe", "zoomin", "noise"] },
  { src: 1, at: 0, frames: 20, time: "fast", reps: 1, need: 0.3, look: ["zoom"] },
];
for (const s of tests) {
  const out = S("seg.mp4");
  try {
    ff("-ss", String(s.at), "-t", s.need.toFixed(3), "-i", files[s.src], "-filter_complex", `[0:v:0]${segFilter(s, dims, "q")}[v]`, "-map", "[v]", "-an", "-c:v", "libx264", "-preset", "ultrafast", out);
    const info = execFileSync("ffprobe", ["-v", "error", "-count_frames", "-select_streams", "v", "-show_entries", "stream=nb_read_frames,width,height", "-of", "csv=p=0", out]).toString().trim();
    check(`フィルタ ${s.time}${s.look.length ? "＋" + s.look.join("・") : ""}${s.src === 1 ? "（短い素材）" : ""} → ${info}`, info === `640,360,${s.frames}`);
  } catch (e) {
    check(`フィルタ ${s.time}`, false, String(e.stderr || e).slice(0, 300));
  }
}

console.log(fail ? `${fail} 件 NG` : "全部 OK");
process.exit(fail ? 1 : 0);
