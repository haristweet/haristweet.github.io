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
await page.goto(`${base}?core=${encodeURIComponent(base + "core")}`);
await page.screenshot({ path: S("shot_empty.png"), fullPage: true });

const cases = [
  { name: "差し替え・動画に合わせる", v: "v_h264.mp4", a: "a_10s.mp3", set: {}, dur: 6, acodec: "aac", vcodec: "h264", copy: true },
  { name: "混ぜる・短いほう", v: "v_h264.mp4", a: "a_2s.wav", set: { orig: "mix", len: "shortest" }, dur: 2 },
  { name: "音声をくり返す・無音の動画に混ぜる", v: "v_mute.mov", a: "a_2s.wav", set: { orig: "mix", len: "loop" }, dur: 5, note: /差し替え/ },
  { name: "頭出し・入れ始め", v: "v_h264.mp4", a: "a_10s.mp3", set: { askip: 3, adelay: 1 }, dur: 6 },
  { name: "VP9 を作り直す", v: "v_vp9.webm", a: "a_10s.mp3", set: {}, dur: 4, vcodec: "h264", copy: false },
];
let fail = 0;
for (const [i, c] of cases.entries()) {
  await page.setInputFiles("#vfile", S(c.v));
  await page.setInputFiles("#afile", S(c.a));
  await page.check(`input[name=orig][value=${c.set.orig || "replace"}]`, { force: true });
  await page.check(`input[name=len][value=${c.set.len || "video"}]`, { force: true });
  await page.fill("#askip", String(c.set.askip || 0));
  await page.fill("#adelay", String(c.set.adelay || 0));
  await page.click("#go");
  await page.waitForFunction(() => !document.getElementById("result").hidden || document.getElementById("status").classList.contains("err"), null, { timeout: 180000 });
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
