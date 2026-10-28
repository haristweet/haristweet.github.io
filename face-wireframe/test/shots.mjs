// 顔ワイヤーフレームの絵の確かめ。版を上げるたびに回して、出た一覧の絵を前の版と見比べる。
//   node face-wireframe/test/shots.mjs <顔の写真（jpg/png）> [出力フォルダ]
// 写真を Chromium のにせのカメラに流し、見せ方ごとに画面を撮って sheet.png に並べる。
// あわせて、顔が見つかるか・背景の色・許可が無いときの案内・OBS 用 URL を数字で確かめる。
// 写真は MediaPipe の見本 https://storage.googleapis.com/mediapipe-assets/portrait.jpg などを使う（リポジトリには置かない）。
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join, extname, resolve } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT || "playwright");

const IMG = resolve(process.argv[2] || "");
const OUT = resolve(process.argv[3] || "fw-out");
const ROOT = resolve(new URL("../..", import.meta.url).pathname);
await mkdir(OUT, { recursive: true });

// 写真を 1280×720 の真ん中に置いた 1 秒の動画にする（にせのカメラはこれを繰り返す）
const Y4M = join(OUT, "cam.y4m");
execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-loop", "1", "-i", IMG, "-t", "1", "-r", "5",
  "-vf", "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=0x406080", "-pix_fmt", "yuv420p", Y4M]);

const TYPES = { ".html": "text/html", ".mjs": "text/javascript", ".js": "text/javascript", ".wasm": "application/wasm" };
const server = createServer(async (req, res) => {
  try {
    let p = join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname));
    if (p.endsWith("/")) p = join(p, "index.html");
    const body = await readFile(p);
    res.writeHead(200, { "content-type": TYPES[extname(p)] || "application/octet-stream" }).end(body);
  } catch { res.writeHead(404).end(); }
}).listen(0);
const BASE = `http://localhost:${server.address().port}/face-wireframe/`;

const browser = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-video-capture=${Y4M}`] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on("pageerror", (e) => console.log("pageerror:", e.message));

let fails = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) fails++; };
// canvas の 1 点の色（左右反転していても canvas の中の座標で読む）
const px = (x, y) => page.evaluate(([x, y]) => [...document.getElementById("view").getContext("2d").getImageData(x, y, 1, 1).data], [x, y]);
const near = (a, b, d = 24) => a.every((v, i) => Math.abs(v - b[i]) <= d);

const SHOTS = [
  ["overlay", "mode=overlay"],
  ["face", "mode=face"],
  ["all-black", "mode=all"],
  ["all-green", "mode=all&bg=green"],
  ["all-none", "mode=all&bg=none"],
  ["overlay-glow-contour", "mode=overlay&glow=1&contour=1&width=2&color=ff4080"],
  ["face-mirror", "mode=face&mirror=1"],
];
const shots = [], zooms = [];
for (const [name, qs] of SHOTS) {
  await page.goto(`${BASE}?ui=0&${qs}`);
  const ok = await page.waitForFunction(() => window.__fw?.ready && window.__fw.faces > 0, null, { timeout: 30000 }).then(() => true, () => false);
  check(ok, `${name}: 顔が見つかる`);
  await page.waitForTimeout(400);
  const corner = await px(5, 5);
  if (name === "all-black") check(near(corner, [0, 0, 0, 255]), `${name}: 隅が黒 ${corner}`);
  if (name === "all-green") check(near(corner, [0, 177, 64, 255]), `${name}: 隅がグリーンバック ${corner}`);
  if (name === "all-none") check(corner[3] === 0, `${name}: 隅が透明 ${corner}`);
  if (name === "overlay") check(near(corner, [64, 96, 128, 255], 40), `${name}: 隅はカメラの絵のまま ${corner}`);
  const file = join(OUT, `${name}.png`);
  await page.screenshot({ path: file, omitBackground: true });
  shots.push(file);
  // 顔の寄り（顔の範囲の 1.6 倍の正方形。画面と canvas は同じ大きさなのでそのまま切る）
  const { box } = await page.evaluate(() => window.__fw);
  const cx = (box[0] + box[2]) / 2 * 1280, cy = (box[1] + box[3]) / 2 * 720, half = Math.max((box[2] - box[0]) * 1280, (box[3] - box[1]) * 720) * 0.8;
  const clip = { x: Math.max(0, cx - half), y: Math.max(0, cy - half), width: Math.min(2 * half, 1280), height: Math.min(2 * half, 720) };
  const zf = join(OUT, `${name}-zoom.png`);
  await page.screenshot({ path: zf, clip, omitBackground: true });
  zooms.push(zf);
}

// 顔だけ網: 顔の中は黒く塗られて線だけになる（重ねるより暗い）
const faceDark = async (mode) => {
  await page.goto(`${BASE}?ui=0&mode=${mode}`);
  await page.waitForFunction(() => window.__fw?.faces > 0, null, { timeout: 30000 });
  await page.waitForTimeout(300);
  return page.evaluate(() => {
    // 顔の範囲の真ん中あたり（目・鼻・口のあたり）
    const c = document.getElementById("view"), [x0, y0, x1, y1] = window.__fw.box, w = x1 - x0, h = y1 - y0;
    const d = c.getContext("2d").getImageData(c.width * (x0 + w * 0.25), c.height * (y0 + h * 0.3), c.width * w * 0.5, c.height * h * 0.4).data;
    let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2];
    return s / (d.length / 4) / 3;
  });
};
const [ov, fc] = [await faceDark("overlay"), await faceDark("face")];
check(fc < ov * 0.6, `face: 顔の真ん中が重ねるより暗い（${fc.toFixed(0)} < ${ov.toFixed(0)}）`);

// 枠を出したまま開く流れ: キーで見せ方が変わり、OBS 用 URL に載る
await page.goto(BASE);
await page.waitForFunction(() => window.__fw?.ready, null, { timeout: 30000 });
await page.keyboard.press("3");
const url = await page.inputValue("#url");
check(/[?&]ui=0/.test(url) && /[?&]mode=all/.test(url), `枠: キー 3 で OBS 用 URL に mode=all（${url}）`);
check((await page.textContent("#status")) === "", "枠: カメラが開けたら案内は消える");
await page.screenshot({ path: join(OUT, "panel.png") });
// 枠は画面を触って隠す／出す（iPhone ではキーが無い。2026-10-28 に「邪魔だった」と言われて足した）
await page.mouse.click(900, 600);
check(await page.isHidden("#panel"), "枠: 画面を触ると隠れる");
await page.waitForTimeout(300);
await page.screenshot({ path: join(OUT, "panel-hidden.png") });
check(await page.evaluate(() => document.getElementById("tapHint").classList.contains("on")), "枠: 隠したら出し方の案内が出る");
await page.mouse.click(900, 600);
check(await page.isVisible("#panel"), "枠: もう一度触ると出る");
await page.click("#hide");
check(await page.isHidden("#panel"), "枠: 「隠す」ボタンで隠れる");
await page.goto(`${BASE}?ui=0`);
await page.waitForFunction(() => window.__fw?.ready, null, { timeout: 30000 });
await page.mouse.click(640, 360);
check(await page.isHidden("#panel"), "枠なし URL: 触っても枠は出ない");

// カメラの許可が無いとき（OBS を印なしで起動したときに近い）: 案内が出る
const denied = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await denied.addInitScript(() => { navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException("no", "NotAllowedError")); });
await denied.goto(BASE);
await denied.waitForFunction(() => /許可/.test(document.getElementById("status").textContent), null, { timeout: 30000 }).then(() => check(true, "許可なし: 案内が出る"), () => check(false, "許可なし: 案内が出る"));
await denied.screenshot({ path: join(OUT, "denied.png") });

await browser.close();
server.close();

// 一覧（4 列）。全体を 480 幅、顔の寄りを 240 角で並べる
const sheet = (files, size, labels, out) => {
const cols = files.length > 4 ? 4 : files.length, rows = Math.ceil(files.length / cols);
const shots = files;
const inputs = shots.flatMap((f) => ["-i", f]);
const layout = shots.map((_, i) => `${(i % cols) ? Array.from({ length: i % cols }, (_, k) => `w${k}`).join("+") : "0"}_${Math.floor(i / cols) ? Array.from({ length: Math.floor(i / cols) }, (_, k) => `h${k}`).join("+") : "0"}`).join("|");
execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...inputs, "-filter_complex",
  shots.map((_, i) => `[${i}]scale=${size},drawtext=text='${labels[i]}':x=8:y=8:fontcolor=white:box=1:boxcolor=black@0.6[s${i}]`).join(";") +
  `;${shots.map((_, i) => `[s${i}]`).join("")}xstack=inputs=${shots.length}:layout=${layout}:fill=gray`, out]);
console.log(`一覧: ${out}（${rows} 段）`);
};
sheet(shots, "480:270", SHOTS.map((s) => s[0]), join(OUT, "sheet.png"));
sheet(zooms, "360:360", SHOTS.map((s) => s[0]), join(OUT, "sheet-zoom.png"));
console.log(fails ? `${fails} 件おかしい` : "全部 ok");
process.exit(fails ? 1 : 0);
