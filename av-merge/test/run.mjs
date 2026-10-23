// 音声ガッちゃんこの通し試験。
//   node test/run.mjs <@ffmpeg/core の dist/esm のフォルダ> [出力フォルダ]
// 手元の ffmpeg で見本の動画・音声を作り、Chromium でページを開いて実際にくっつけ、
// できたファイルを ffprobe で調べる。画面の写真も出力フォルダに置く。
import { createServer } from "node:http";
import { readFile, mkdir, writeFile, stat } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join, extname, resolve } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT || "playwright");

const CORE = resolve(process.argv[2] || "");
const OUT = resolve(process.argv[3] || "test-out");
const ROOT = resolve(new URL("..", import.meta.url).pathname);
await mkdir(OUT, { recursive: true });

// ── 見本を作る ──
const ff = (...a) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...a]);
const S = (n) => join(OUT, n);
ff("-f", "lavfi", "-i", "testsrc=size=320x240:rate=30:duration=6", "-f", "lavfi", "-i", "sine=f=220:duration=6",
   "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", S("v_h264.mp4"));
ff("-f", "lavfi", "-i", "testsrc=size=320x240:rate=30:duration=5", "-c:v", "libx264", "-pix_fmt", "yuv420p", S("v_mute.mov"));
ff("-f", "lavfi", "-i", "testsrc=size=320x240:rate=30:duration=4", "-c:v", "libvpx-vp9", "-b:v", "300k", S("v_vp9.webm"));
// コマごとに明るさが 8 ずつ上がる 3 秒（10fps・30 コマ）。逆回しの並びを明るさで読む
ff("-f", "lavfi", "-i", "nullsrc=s=64x64:r=10:d=3,geq=lum='N*8':cb=128:cr=128", "-c:v", "libx264", "-qp", "0", "-pix_fmt", "yuv420p", S("v_ramp.mp4"));
// つなげる用: v_h264 と同じ形の 2 秒（音なし）、縦長、スマホのような「90°回す」印付き
ff("-f", "lavfi", "-i", "testsrc=size=320x240:rate=30:duration=2", "-c:v", "libx264", "-pix_fmt", "yuv420p", S("v_same2.mp4"));
ff("-f", "lavfi", "-i", "testsrc=size=240x320:rate=25:duration=2", "-f", "lavfi", "-i", "sine=f=330:duration=2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-ac", "1", "-ar", "22050", S("v_tall.mp4"));
ff("-display_rotation", "90", "-i", S("v_same2.mp4"), "-c", "copy", S("v_rot.mp4"));
ff("-f", "lavfi", "-i", "sine=f=880:duration=10", "-c:a", "libmp3lame", S("a_10s.mp3"));
ff("-f", "lavfi", "-i", "sine=f=660:duration=2", S("a_2s.wav"));

const probe = (p) => JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", p]));

// ── ページを出す（/core/ は手元の core を返す） ──
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm" };
const server = createServer(async (req, res) => {
  const u = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const file = u.startsWith("/core/") ? join(CORE, u.slice(6)) : join(ROOT, u.endsWith("/") ? u + "index.html" : u);
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream", "content-length": body.length });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
}).listen(0);
const base = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 1300 }, acceptDownloads: true });
page.on("pageerror", (e) => console.log("pageerror:", e.message));
// chunk=0.7 で逆回しを区切りに分けさせ、つなぎ目も通す
await page.goto(`${base}?chunk=0.7&core=${encodeURIComponent(base + "core")}`);
await page.screenshot({ path: S("shot_empty.png"), fullPage: true });

const cases = [
  { name: "差し替え・動画に合わせる", v: "v_h264.mp4", a: "a_10s.mp3", set: {}, dur: 6, acodec: "aac", vcodec: "h264", copy: true },
  { name: "混ぜる・短いほう", v: "v_h264.mp4", a: "a_2s.wav", set: { orig: "mix", len: "shortest" }, dur: 2 },
  { name: "音声をくり返す・無音の動画に混ぜる", v: "v_mute.mov", a: "a_2s.wav", set: { orig: "mix", len: "loop" }, dur: 5, note: /差し替え/ },
  { name: "頭出し・入れ始め", v: "v_h264.mp4", a: "a_10s.mp3", set: { askip: 3, adelay: 1 }, dur: 6 },
  { name: "音声に合わせる・繰り返す", v: "v_h264.mp4", a: "a_10s.mp3", set: { len: "audio" }, dur: 10, vcodec: "h264", copy: true, note: /繰り返し/ },
  { name: "音声に合わせる・音声が短い", v: "v_h264.mp4", a: "a_2s.wav", set: { len: "audio", vloop: "bounce" }, dur: 2 },
  { name: "音声に合わせる・逆回し", v: "v_ramp.mp4", a: "a_10s.mp3", set: { len: "audio", vloop: "bounce" }, dur: 10, vcodec: "h264", note: /逆回し/, ramp: true },
  { name: "音声に合わせる・逆回し＋元の音を混ぜる", v: "v_h264.mp4", a: "a_10s.mp3", set: { len: "audio", vloop: "bounce", orig: "mix" }, dur: 10, vcodec: "h264" },
  { name: "つなげる・同じ形はそのまま", v: ["v_h264.mp4", "v_same2.mp4"], a: "a_10s.mp3", set: { orig: "mix" }, dur: 8, vcodec: "h264", copy: true, catCopy: true, size: "320x240", note: /2 本をそのまま/ },
  { name: "つなげる・形が違うと作り直す", v: ["v_h264.mp4", "v_vp9.webm", "v_tall.mp4"], a: "a_10s.mp3", set: { orig: "mix" }, dur: 12, vcodec: "h264", catCopy: false, size: "320x240", note: /3 本を作り直して/ },
  { name: "つなげる・回す印はそのまま残る", v: ["v_rot.mp4", "v_rot.mp4"], a: "a_10s.mp3", set: {}, dur: 4, vcodec: "h264", catCopy: true, rot: true },
  { name: "つなげる・音声に合わせて逆回し", v: ["v_ramp.mp4", "v_ramp.mp4"], a: "a_10s.mp3", set: { len: "audio", vloop: "bounce" }, dur: 10, vcodec: "h264", catCopy: true },
  // 繰り返しの折り返しを 1 秒重ねる。1回目は 0..19、そのあと「重ね（20+j と j を溶かす。おおよそ 20→11）＋中ほど 10..19」の 20 コマずつ
  { name: "繰り返す・折り返しを重ねる", v: "v_ramp.mp4", a: "a_10s.mp3", set: { len: "audio", xfade: 1 }, dur: 10, vcodec: "h264", copy: true, note: /折り返しを 1 秒重ねて/,
    frames: { n: 100, at: (k) => { if (k < 20) return [k, k]; const p = (k - 20) % 20; return p < 10 ? [p, 20 + p] : [p, p]; } } },
  // 2本を 1 秒重ねてつなぐ。0..19、重ね 10 コマ、10..29 で 50 コマ
  { name: "つなげる・つなぎ目を重ねる", v: ["v_ramp.mp4", "v_ramp.mp4"], a: "a_10s.mp3", set: { xfade: 1 }, dur: 5, vcodec: "h264", catCopy: false, note: /つなぎ目を 1 秒重ねて/,
    frames: { n: 50, at: (k) => k < 20 ? [k, k] : k < 30 ? [k - 20, k] : [k - 20, k - 20] } },
  { name: "つなげる・形が違う＋重ねる＋元の音", v: ["v_h264.mp4", "v_vp9.webm", "v_tall.mp4"], a: "a_10s.mp3", set: { orig: "mix", xfade: 1 }, dur: 10, vcodec: "h264", size: "320x240" },
  { name: "繰り返す・重ねる＋元の音", v: "v_h264.mp4", a: "a_10s.mp3", set: { len: "audio", xfade: 1.5, orig: "mix" }, dur: 10, vcodec: "h264" },
  { name: "重ねる秒数が長すぎると縮める", v: ["v_same2.mp4", "v_h264.mp4"], a: "a_10s.mp3", set: { xfade: 3 }, dur: 7.05, vcodec: "h264", note: /縮めました/ },
  { name: "VP9 を作り直す", v: "v_vp9.webm", a: "a_10s.mp3", set: {}, dur: 4, vcodec: "h264", copy: false },
];
let fail = 0;
// ONLY=名前の一部 で、その試験だけ回す
for (const [i, c] of cases.entries()) {
  if (process.env.ONLY && !c.name.includes(process.env.ONLY)) continue;
  if (await page.isVisible("#vclear")) await page.click("#vclear");
  await page.setInputFiles("#vfile", [c.v].flat().map(S));
  await page.setInputFiles("#afile", S(c.a));
  await page.check(`input[name=orig][value=${c.set.orig || "replace"}]`, { force: true });
  await page.check(`input[name=len][value=${c.set.len || "video"}]`, { force: true });
  if (c.set.len === "audio") await page.check(`input[name=vloop][value=${c.set.vloop || "repeat"}]`, { force: true });
  await page.fill("#askip", String(c.set.askip || 0));
  await page.fill("#adelay", String(c.set.adelay || 0));
  // つなぎ目の欄は出ていないこともあるので、値は直に入れる
  await page.$eval("#xfade", (e, v) => { e.value = v; e.dispatchEvent(new Event("input", { bubbles: true })); }, String(c.set.xfade || 0));
  await page.click("#go");
  try {
    await page.waitForFunction(() => !document.getElementById("result").hidden || document.getElementById("status").classList.contains("err"), null, { timeout: +process.env.WAIT || 180000 });
  } catch {
    console.log(`NG ${c.name}: 終わらない（${await page.$eval("#status", (e) => e.textContent)}）`);
    fail++; break;
  }
  const err = await page.$eval("#status", (e) => e.classList.contains("err") ? e.textContent : "");
  if (err) { console.log(`NG ${c.name}: ${err}`); console.log(await page.$eval("#log", (e) => e.textContent.slice(-1500))); fail++; continue; }
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#dl")]);
  const out = S(`out_${i}.mp4`);
  await dl.saveAs(out);
  const info = probe(out);
  const v = info.streams.find((s) => s.codec_type === "video"), a = info.streams.find((s) => s.codec_type === "audio");
  const dur = parseFloat(info.format.duration);
  const rinfo = await page.$eval("#rinfo", (e) => e.textContent);
  const log = await page.$eval("#log", (e) => e.textContent);
  const probs = [];
  if (!v || !a) probs.push("絵か音が無い");
  if (Math.abs(dur - c.dur) > 0.25) probs.push(`長さ ${dur} (期待 ${c.dur})`);
  if (c.vcodec && v?.codec_name !== c.vcodec) probs.push(`絵 ${v?.codec_name}`);
  if (a && a.codec_name !== "aac") probs.push(`音 ${a.codec_name}`);
  if (c.copy !== undefined && /-c:v copy/.test(log) !== c.copy) probs.push("絵のコピー／作り直しが期待と違う");
  if (c.ramp) {
    // 期待: 1..29, 28..0, 1..29, 28..0 …（10fps で 100 コマ）
    const ys = execFileSync("ffprobe", ["-v", "error", "-f", "lavfi", "-i", `movie=${out},signalstats`, "-show_entries", "frame_tags=lavfi.signalstats.YAVG", "-of", "csv=p=0"]).toString().trim().split("\n").map((y) => Math.round(parseFloat(y) / 8));
    const want = Array.from({ length: ys.length }, (_, k) => { const p = k % 58; return p < 29 ? p + 1 : 57 - p; });
    const bad = ys.findIndex((y, k) => y !== want[k]);
    const chunks = (log.match(/\/work\/r\d+\.mp4/g) || []).length / 2;
    if (chunks < 5) probs.push(`逆回しが区切られていない（${chunks}）`);
    if (ys.length < 99 || bad >= 0) probs.push(`コマの並びが違う（${ys.length} コマ, ${bad} コマ目: ${ys.slice(Math.max(0, bad - 3), bad + 4)} 期待 ${want.slice(Math.max(0, bad - 3), bad + 4)}）`);
  }
  if (c.frames) {
    // コマごとの明るさ（÷8 でコマ番号）が、期待の幅 [lo, hi] に入っているか
    const ys = execFileSync("ffprobe", ["-v", "error", "-f", "lavfi", "-i", `movie=${out},signalstats`, "-show_entries", "frame_tags=lavfi.signalstats.YAVG", "-of", "csv=p=0"]).toString().trim().split("\n").map((y) => parseFloat(y) / 8);
    const bad = ys.findIndex((y, k) => { const [lo, hi] = c.frames.at(k); return y < lo - 0.6 || y > hi + 0.6; });
    if (Math.abs(ys.length - c.frames.n) > 1 || bad >= 0) {
      probs.push(`コマの並びが違う（${ys.length} コマ, ${bad} コマ目: ${ys.slice(Math.max(0, bad - 3), bad + 4).map((y) => y.toFixed(1))} 期待 ${JSON.stringify(c.frames.at(bad))}）`);
    }
  }
  if (c.catCopy !== undefined && /-f concat -safe 0 -i \/work\/vlist/.test(log) !== c.catCopy) probs.push("つなぎ方（そのまま／作り直し）が期待と違う");
  if (c.size && `${v?.width}x${v?.height}` !== c.size) probs.push(`大きさ ${v?.width}x${v?.height}`);
  if (c.rot && !JSON.stringify(v?.side_data_list || []).includes("rotation")) probs.push("回す印が消えた");
  if (c.note && !c.note.test(rinfo)) probs.push(`知らせが無い: ${rinfo}`);
  console.log(`${probs.length ? "NG" : "OK"} ${c.name}: ${dur.toFixed(2)}s ${v?.codec_name}/${a?.codec_name} ${(await stat(out)).size}B ${probs.join(" / ")}`);
  if (probs.length) fail++;
  if (i === 0) await page.screenshot({ path: S("shot_result.png"), fullPage: true });
}
await page.setViewportSize({ width: 390, height: 1400 });
await page.screenshot({ path: S("shot_phone.png"), fullPage: true });
await browser.close();
server.close();
console.log(fail ? `${fail} 件 NG` : "全部 OK");
process.exit(fail ? 1 : 0);
