// モーショングラフィックスの見本帳。全スタイル × 部品を同じ時刻・同じ背景で描いて 1 枚に並べる。
// 版を上げるたびにこれを作り、前の版と見比べる（数字の試験では見た目の崩れが分からないので）。
//   node test/mograph-sheet.mjs <曲（mp3 など）> <背景の画像（png）> <字の形（ttf）> [出力 png]
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { join, extname, resolve } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT || "playwright");
const [AUDIO, BG, FONT] = process.argv.slice(2, 5).map((p) => resolve(p));
const OUT = resolve(process.argv[5] || "mograph-sheet.png");
const ROOT = resolve(new URL("..", import.meta.url).pathname);

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript" };
const server = createServer(async (req, res) => {
  const u = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const file = u === "/audio" ? AUDIO : u === "/bg.png" ? BG : u === "/font.ttf" ? FONT : join(ROOT, u === "/" ? "index.html" : u);
  try { const b = await readFile(file); res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" }); res.end(b); }
  catch { res.writeHead(404); res.end(); }
}).listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("pageerror:", e.message));
page.on("console", (m) => { if (m.type() === "error") console.log("console:", m.text()); });
await page.goto(`${base}/`);
const png = await page.evaluate(async () => {
  const { analyzeAudio, makeScene, drawFrame, STYLES } = await import("/mograph.js");
  const { detectBeats } = await import("/remix.js");
  const ff = new FontFace("MG", "url(/font.ttf)"); await ff.load(); document.fonts.add(ff);
  const buf = await new OfflineAudioContext(1, 1, 22050).decodeAudioData(await (await fetch("/audio")).arrayBuffer());
  const x = buf.getChannelData(0);
  const an = analyzeAudio(x, buf.sampleRate), bt = detectBeats(x, buf.sampleRate);
  const bg = await createImageBitmap(await (await fetch("/bg.png")).blob());
  const W = 384, H = 216, beat = 60 / bt.bpm;
  const lines = [{ t: 0.0, text: "ぐちゃぐちゃリミックス" }, { t: 30, text: "" }];
  // 列: [見出し, 時刻, 設定]
  const cols = [
    ["title", 1.6, { title: { on: true, title: "曲の名前 SONG", artist: "Artist" } }],
    ["bars+ring", bt.offset + beat * 8 + 0.03, { layers: ["bars", "ring"] }],
    ["wave+pulse", bt.offset + beat * 8 + 0.12, { layers: ["wave", "pulse"] }],
    ["particles", bt.offset + beat * 8 + 0.25, { layers: ["particles"] }],
    ["center+mountain", bt.offset + beat * 8 + 0.03, { layers: ["center", "mountain"] }],
    ["rays+tunnel", bt.offset + beat * 8 + 0.06, { layers: ["rays", "tunnel"] }],
    ["grid+stars", 6.3, { layers: ["grid", "stars"] }],
    ["scope", bt.offset + beat * 8 + 0.05, { layers: ["scope"] }],
    ["lyric bounce", 0.5, { lyrics: { anim: "bounce", lines } }],
    ["lyric pop", 0.5, { lyrics: { anim: "pop", lines } }],
    ["lyric type", 0.45, { lyrics: { anim: "type", lines } }],
    ["lyric glitch", bt.offset + beat * 4 + 0.03, { lyrics: { anim: "glitch", lines } }],
    ["wipe", bt.offset + beat * 8, { wipe: "4" }],
    ["hud", 6, { frame: "hud" }],
    ["vhs", bt.offset + beat * 7 + 0.1, { frame: "vhs" }],
    ["rec", 6, { frame: "rec", layers: ["pulse"] }],
  ];
  const styles = Object.keys(STYLES);
  const sheet = document.createElement("canvas");
  sheet.width = cols.length * (W + 4); sheet.height = styles.length * (H + 4) + 18;
  const s = sheet.getContext("2d");
  s.fillStyle = "#777"; s.fillRect(0, 0, sheet.width, sheet.height);
  s.font = "12px sans-serif"; s.fillStyle = "#fff";
  cols.forEach(([name], c) => s.fillText(name, c * (W + 4) + 4, 13));
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const g = cv.getContext("2d");
  styles.forEach((style, r) => cols.forEach(([, t, o], c) => {
    const sc = makeScene({ W, H, style, layers: [], wipe: "none", frame: "none", an, bpm: bt.bpm, offset: bt.offset, shift: 0, T: 30, seed: 5, font: "MG", ...o });
    drawFrame(g, sc, t);
    const x = c * (W + 4), y = 18 + r * (H + 4);
    s.drawImage(bg, x, y, W, H); s.drawImage(cv, x, y);
    s.fillStyle = "#fff"; s.font = "bold 12px sans-serif"; s.fillText(style, x + 3, y + H - 4);
  }));
  return sheet.toDataURL("image/png");
});
await writeFile(OUT, Buffer.from(png.split(",")[1], "base64"));
console.log("見本帳:", OUT);
await browser.close();
server.close();
