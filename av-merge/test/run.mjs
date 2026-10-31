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
// 歌詞の字の形（M PLUS Rounded 1c ExtraBold の ttf）。無ければ歌詞の試験は飛ばす
const FONT = process.env.FONT ? resolve(process.env.FONT) : "";
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
// 軽くする用: 1080p の横長と縦長（音付き）
ff("-f", "lavfi", "-i", "testsrc=size=1920x1080:rate=30:duration=2", "-f", "lavfi", "-i", "sine=f=440:duration=2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", S("v_big.mp4"));
ff("-f", "lavfi", "-i", "testsrc=size=1080x1920:rate=30:duration=3", "-f", "lavfi", "-i", "sine=f=440:duration=3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", S("v_bigtall.mp4"));
// 歌詞の見本: 真っ黒の 8 秒（字が出たか明るさで分かる）、時刻付き（0.5 秒と 3 秒に出て 6 秒で消える）と時刻なしの歌詞入り mp3
ff("-f", "lavfi", "-i", "color=c=black:s=640x360:r=25:d=8", "-c:v", "libx264", "-pix_fmt", "yuv420p", S("v_black.mp4"));
ff("-f", "lavfi", "-i", "sine=f=500:duration=8", "-c:a", "libmp3lame", "-metadata", "lyrics=[00:00.50]いちばん目の歌詞\n[00:03.00]二番目 second\n[00:06.00]", S("a_lrc.mp3"));
ff("-f", "lavfi", "-i", "sine=f=500:duration=8", "-c:a", "libmp3lame", "-metadata", "lyrics=時刻の無い一行目\n二行目", S("a_plain.mp3"));
// リミックスの見本: 128 BPM のドラム 20 秒（1拍目 0.3 秒）
{
  const P = 60 / 128, inb = "mod(t-0.3," + P + ")", off = "mod(t-0.3+" + P / 2 + "," + P + ")";
  ff("-f", "lavfi", "-i", `aevalsrc='if(gte(t,0.3), 0.9*sin(2*PI*55*${inb}*(1+3*exp(-40*${inb})))*exp(-12*${inb}) + 0.25*(random(0)-0.5)*exp(-60*${off}), 0) + 0.15*sin(2*PI*110*t)':s=44100:d=20`, "-c:a", "libmp3lame", S("a_drum.mp3"));
}
// サビの見本: 128 BPM で前半 12 秒は小さく、後半 12 秒は大きく（＋ざらざら）
{
  const P = 60 / 128, inb = "mod(t," + P + ")";
  ff("-f", "lavfi", "-i", `aevalsrc='(if(lt(t,12),0.22,1))*(0.9*sin(2*PI*55*${inb}*(1+3*exp(-40*${inb})))*exp(-12*${inb})) + if(lt(t,12),0,0.3*(random(0)-0.5)) + 0.1*sin(2*PI*110*t)':s=44100:d=24`, "-c:a", "libmp3lame", S("a_hype.mp3"));
}
// 写真の見本: 横長の PNG・縦長の JPEG と、中身がでたらめな HEIC
ff("-f", "lavfi", "-i", "testsrc2=size=1600x1200:rate=1:duration=1", "-frames:v", "1", S("p_land.png"));
ff("-f", "lavfi", "-i", "mandelbrot=size=900x1600:rate=1", "-frames:v", "1", S("p_tall.jpg"));
await writeFile(S("p_fake.heic"), Buffer.from("これは写真ではない".repeat(50)));
ff("-f", "lavfi", "-i", "sine=f=880:duration=10", "-c:a", "libmp3lame", S("a_10s.mp3"));
ff("-f", "lavfi", "-i", "sine=f=660:duration=2", S("a_2s.wav"));

const probe = (p) => JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", p]));

// ── ページを出す（/core/ は手元の core を返す） ──
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm" };
const server = createServer(async (req, res) => {
  const u = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const file = u.startsWith("/core/") ? join(CORE, u.slice(6)) : u.startsWith("/out/") ? join(OUT, u.slice(5)) : u === "/font.ttf" ? FONT : join(ROOT, u.endsWith("/") ? u + "index.html" : u);
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
await page.goto(`${base}?chunk=0.7&core=${encodeURIComponent(base + "core")}&font=${encodeURIComponent(base + "font.ttf")}`);
await page.screenshot({ path: S("shot_empty.png"), fullPage: true });

const MGALL = { style: "neon", layers: ["bars", "ring", "wave", "pulse", "particles"], wipe: "4", frame: "hud", title: true };
const cases = [
  // 音ハメ: 素材 1（黒）と 2（テスト柄）を 2・4・6 秒の区切りで 1→2→1→2
  { name: "音ハメ・区間ごとに映像を割り当てる", v: ["v_black.mp4", "v_h264.mp4"], a: "a_drum.mp3", set: {}, dur: 20, vcodec: "h264", size: "640x360",
    cut: { cuts: [2, 4, 6], assign: [{ src: 0, at: 0, time: "normal", look: "" }, { src: 1, at: 0, time: "stutter", look: "" }, { src: 0, at: 1, time: "normal", look: "" }, { src: 1, at: 2, time: "normal", look: "mono" }] },
    bright: [[1, false, "all"], [3, true, "all"], [5, false, "all"], [10, true, "all"]], cutLog: /"srcs":"0101"/, note: /4 区間（音ハメ）/ },
  { name: "GIF・WebM にする", v: "v_h264.mp4", a: "a_10s.mp3", set: {}, dur: 6, vcodec: "h264", conv: { gif: /^gif\/- 320x240 6\.\ds/, webm: /^vp8\/opus 320x240 6\.\ds/ } },
  // 写真
  { name: "写真・2 枚のスライドショー", v: ["p_land.png", "p_tall.jpg"], a: "a_10s.mp3", set: {}, dur: 8, vcodec: "h264", size: "1600x1200", moving: [0.3, 3.5], mgShot: true },
  { name: "写真・動画とつなぐ", v: ["v_h264.mp4", "p_land.png"], a: "a_10s.mp3", set: {}, dur: 10, vcodec: "h264", size: "320x240" },
  { name: "写真・読めない写真があると作れず、理由を出す", v: ["p_fake.heic"], a: "a_10s.mp3", set: {}, expectDisabled: /読めない写真/ },
  { name: "写真・リミックスに混ぜる（試し）", v: ["p_land.png", "v_h264.mp4"], a: "a_drum.mp3", set: {}, dur: 15, vcodec: "h264", remix: { chaos: 60, seed: 3, try: true } },
  // サビ: 後半 12〜24 秒を見つけて強める
  { name: "サビ・グラフィックス", v: "v_black.mp4", a: "a_hype.mp3", set: { len: "audio" }, dur: 24, vcodec: "h264", hype: true,
    mg: { style: "neon", layers: ["pulse", "particles", "bars"], wipe: "none", frame: "none", title: false },
    hypeLog: (hl) => hl.length === 1 && hl[0][0] >= 9 && hl[0][0] <= 14.5 && hl[0][1] >= 22, mgShot: true },
  { name: "サビ・リミックス（試し）", v: ["v_h264.mp4", "v_big.mp4"], a: "a_hype.mp3", set: {}, dur: 15, vcodec: "h264", hype: true,
    remix: { chaos: 30, seed: 4, try: true }, hypeLog: (hl) => hl.length === 1 && hl[0][0] >= 9 && hl[0][0] <= 14.5 },
  { name: "テロップ・上に 1〜3 秒", v: "v_black.mp4", a: "a_drum.mp3", set: {}, dur: 8, vcodec: "h264", telops: [{ t: 1, dur: 2, text: "テロップです", pos: "top" }],
    bright: [[0.5, false, "top"], [2, true, "top"], [2, false, "bottom"], [4.5, false, "top"]], fxLog: /"mg":true/, mgShot: true },
  // 仕上げ（形・色）
  { name: "仕上げ・縦 9:16 で真ん中を切る", v: "v_h264.mp4", a: "a_10s.mp3", set: {}, dur: 6, vcodec: "h264", size: "240x426", fx: { aspect: "9:16" }, fxLog: /"aspect":"9:16".*"fit":"crop"/ },
  { name: "仕上げ・正方形で余白をぼかす＋軽く 720p", v: "v_big.mp4", a: "a_10s.mp3", set: { size: "720" }, dur: 2, vcodec: "h264", size: "720x720", fx: { aspect: "1:1", fit: "blur" }, fxLog: /"fit":"blur"/ },
  { name: "仕上げ・モノクロ", v: "v_h264.mp4", a: "a_10s.mp3", set: {}, dur: 6, vcodec: "h264", size: "320x240", fx: { grade: "mono" }, satBelow: 2, fxLog: /"grade":"mono"/ },
  { name: "仕上げ・縦 9:16 ＋字幕の歌詞（切ったあとに焼く）", v: "v_black.mp4", a: "a_lrc.mp3", set: {}, dur: 8, vcodec: "h264", size: "360x640", fx: { aspect: "9:16" },
    bright: [[0.2, false, "bottom"], [1.5, true, "bottom"], [7, false, "bottom"]], fxLog: /"lyCount":2/, mgShot: true },
  { name: "仕上げ・縦 9:16 ＋グラフィックス＋あざやか", v: "v_h264.mp4", a: "a_drum.mp3", set: {}, dur: 6, vcodec: "h264", size: "240x426", fx: { aspect: "9:16", grade: "vivid" },
    mg: { style: "pop", layers: ["bars", "pulse"], wipe: "none", frame: "rec", title: true }, fxLog: /"mg":true/, mgShot: true },
  // モーショングラフィックス（sameAs は並びの番号）
  { name: "グラフィックス・全部入りを黒い動画に重ねる", v: "v_black.mp4", a: "a_drum.mp3", set: {}, dur: 8, vcodec: "h264", mg: MGALL, note: /グラフィックス/,
    bright: [[1.5, true, "all"], [5, true, "all"]], mgLog: /"layers":\["bars","ring","wave","pulse","particles"\].*"wipes":[1-9]/, mgShot: true },
  // 描き方が違うスタイル（いったん別の canvas に描いて重ねる・グラデーション・明朝体）を 1 つずつ書き出す
  ...[["vapor", "hud"], ["sketch", "vhs"], ["gaming", "hud"], ["glitch", "rec"], ["gold", "vhs"]].map(([style, frame]) => (
    { name: `グラフィックス・スタイル ${style}`, v: "v_black.mp4", a: "a_drum.mp3", set: {}, dur: 8, vcodec: "h264", mg: { ...MGALL, style, frame }, bright: [[1.5, true, "all"]], mgLog: new RegExp(`"style":"${style}"`), mgShot: true })),
  { name: "グラフィックス・新しい音の図形 7 種", v: "v_black.mp4", a: "a_drum.mp3", set: {}, dur: 8, vcodec: "h264",
    mg: { style: "vapor", layers: ["center", "mountain", "rays", "tunnel", "grid", "stars", "scope"], wipe: "none", frame: "none", title: false },
    bright: [[1.5, true, "all"], [6, true, "all"]], mgLog: /"layers":\["center","mountain","rays","tunnel","grid","stars","scope"\]/, mgShot: true },
  { name: "グラフィックス・同じ設定なら同じ絵", v: "v_black.mp4", a: "a_drum.mp3", set: {}, dur: 8, vcodec: "h264", mg: MGALL, sameAs: "グラフィックス・全部入りを黒い動画に重ねる" },
  { name: "グラフィックス・動く歌詞だけ", v: "v_black.mp4", a: "a_lrc.mp3", set: {}, dur: 8, vcodec: "h264", lyStyle: "bounce", noAss: true,
    bright: [[0.2, false, "bottom"], [1.5, true, "bottom"], [4, true, "bottom"], [7, false, "bottom"]], mgLog: /"lyrics":true/, mgShot: true },
  { name: "グラフィックス・リミックス＋レトロ＋VHS（試し）", v: ["v_big.mp4", "v_h264.mp4"], a: "a_drum.mp3", set: {}, dur: 15, vcodec: "h264", size: "854x480",
    mg: { style: "retro", layers: ["bars", "pulse"], wipe: "cut", frame: "vhs", title: true }, remix: { chaos: 60, seed: 2, try: true }, mgLog: /"style":"retro"/, mgShot: true },
  // リミックス（並びを変えるとき sameAs / diffFrom の番号も直す）
  { name: "リミックス・試し書き出し（1080p → 480p・頭 15 秒）", v: ["v_big.mp4", "v_h264.mp4"], a: "a_drum.mp3", set: {}, dur: 15, vcodec: "h264", size: "854x480", note: /試し書き出し/,
    remix: { chaos: 80, seed: 7, try: true, shot: true } },
  { name: "リミックス・同じ番号なら同じ絵", v: ["v_big.mp4", "v_h264.mp4"], a: "a_drum.mp3", set: {}, dur: 15, vcodec: "h264", remix: { chaos: 80, seed: 7, try: true, sameAs: "リミックス・試し書き出し（1080p → 480p・頭 15 秒）" } },
  { name: "リミックス・番号を変えると別の絵", v: ["v_big.mp4", "v_h264.mp4"], a: "a_drum.mp3", set: {}, dur: 15, vcodec: "h264", remix: { chaos: 80, seed: 8, try: true, diffFrom: "リミックス・試し書き出し（1080p → 480p・頭 15 秒）" } },
  { name: "リミックス・本番（曲の長さ 20 秒・形の違う 3 本）", v: ["v_h264.mp4", "v_vp9.webm", "v_tall.mp4"], a: "a_drum.mp3", set: {}, dur: 20, vcodec: "h264", size: "320x240", note: /区間/,
    remix: { chaos: 100, seed: 3, shot: true } },
  ...(FONT ? [
    { name: "歌詞・時刻付きを焼き込む", v: "v_black.mp4", a: "a_lrc.mp3", set: {}, dur: 8, vcodec: "h264", copy: false, note: /歌詞を 2 回/,
      lyrics: { status: /時刻付き 2 行/, on: true, at: [[0.2, false], [1.5, true], [4, true], [7, false]], shot: 1.5 } },
    { name: "歌詞・頭出しと入れ始めでずれる", v: "v_black.mp4", a: "a_lrc.mp3", set: { askip: 1, adelay: 2 }, dur: 8, vcodec: "h264",
      lyrics: { status: /時刻付き 2 行/, on: true, at: [[1.3, false], [2.2, true], [6.5, true], [7.5, false]] } },
    { name: "歌詞・時刻なしは焼き込まない", v: "v_black.mp4", a: "a_plain.mp3", set: {}, dur: 8, vcodec: "h264", copy: true,
      lyrics: { status: /時刻が無いので/, on: true, at: [[1.5, false]] } },
  ] : []),
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
  { name: "VP9 を作り直す", v: "v_vp9.webm", a: "a_10s.mp3", set: {}, dur: 4, vcodec: "h264", copy: false, est: true },
  { name: "軽く 720p・繰り返す", v: "v_big.mp4", a: "a_10s.mp3", set: { len: "audio", size: "720" }, dur: 10, vcodec: "h264", size: "1280x720", lastCopy: true, note: /1280×720 に軽く/ },
  { name: "もっと軽く 480p・縦長・折り返しを重ねる", v: "v_bigtall.mp4", a: "a_10s.mp3", set: { len: "audio", size: "480", xfade: 0.5, orig: "mix" }, dur: 10, vcodec: "h264", size: "480x854", lastCopy: true, noFile: /\/work\/xl\.mp4/ },
  { name: "もっと軽く 480p・形が違う2本は一度で縮める", v: ["v_big.mp4", "v_tall.mp4"], a: "a_10s.mp3", set: { size: "480" }, dur: 4, vcodec: "h264", size: "854x480", noFile: /\/work\/small\.mp4/ },
  { name: "VP9・軽く 720p（小さいので縮めない）", v: "v_vp9.webm", a: "a_10s.mp3", set: { size: "720", len: "audio" }, dur: 10, vcodec: "h264", size: "320x240", est: true },
];
let fail = 0;
// 比べる相手（sameAs・diffFrom）は名前で指す。並びを変えてもずれないように
const byName = (n) => { const c = cases.find((x) => x.name === n); if (!c) throw new Error(`試験の名前が見つからない: ${n}`); return c; };
// ONLY=名前の一部 で、その試験だけ回す
for (const [i, c] of cases.entries()) {
  if (process.env.ONLY && !c.name.includes(process.env.ONLY)) continue;
  // 前の処理の後片付けが終わる（「全部外す」が押せる）まで待つ
  await page.waitForFunction(() => document.getElementById("vlistbox").hidden || !document.getElementById("vclear").disabled, null, { timeout: 30000 });
  await page.check("input[name=mode][value=merge]", { force: true });
  if (await page.isVisible("#vclear")) await page.click("#vclear");
  await page.setInputFiles("#vfile", [c.v].flat().map(S));
  await page.setInputFiles("#afile", S(c.a));
  if (c.lyrics) {
    // 歌詞を読み終わるのを待って、案内と「焼き込む」の印を確かめる
    await page.waitForFunction(() => !/探しています/.test(document.getElementById("lyStatus").textContent), null, { timeout: 5000 });
    c.lyStatus = await page.$eval("#lyStatus", (e) => e.textContent);
    c.lyOn = await page.$eval("#lyOn", (e) => e.checked);
  }
  await page.check(`input[name=orig][value=${c.set.orig || "replace"}]`, { force: true });
  await page.check(`input[name=len][value=${c.set.len || "video"}]`, { force: true });
  if (c.set.len === "audio") await page.check(`input[name=vloop][value=${c.set.vloop || "repeat"}]`, { force: true });
  await page.fill("#askip", String(c.set.askip || 0));
  await page.fill("#adelay", String(c.set.adelay || 0));
  await page.check(`input[name=size][value="${c.set.size || "orig"}"]`, { force: true });
  // つなぎ目の欄は出ていないこともあるので、値は直に入れる
  await page.$eval("#xfade", (e, v) => { e.value = v; e.dispatchEvent(new Event("input", { bubbles: true })); }, String(c.set.xfade || 0));
  if (c.est) {
    // 大きさの目安（<video> で長さが読める形式のときだけ出る）
    await page.waitForFunction(() => /約 [\d.]+ (MB|GB)/.test(document.getElementById("sizeNote").textContent), null, { timeout: 5000 }).catch(() => {});
    c.estText = await page.$eval("#sizeNote", (e) => e.textContent);
  }
  // グラフィックスと歌詞の見せ方（隠れている部品もあるので値を直に入れる）
  await page.evaluate((o) => {
    const set = (sel, v) => { const e = document.querySelector(sel); if (!e) return; if (e.type === "checkbox" || e.type === "radio") e.checked = v; else e.value = v; e.dispatchEvent(new Event("change", { bubbles: true })); e.dispatchEvent(new Event("input", { bubbles: true })); };
    const mg = o.mg;
    set("#mgOn", !!mg);
    if (mg) {
      set(`input[name=mgStyle][value=${mg.style}]`, true);
      for (const e of document.querySelectorAll("[id^=mgL_]")) set(`#${e.id}`, mg.layers.includes(e.id.slice(4)));
      set(`input[name=mgWipe][value="${mg.wipe}"]`, true);
      set(`input[name=mgFrame][value=${mg.frame}]`, true);
      set("#mgTitle", !!mg.title);
    }
    set(`input[name=lyStyle][value=${o.lyStyle || "sub"}]`, true);
    set("#telopText", JSON.stringify(o.telops || []));
    set("#hypeOn", !!o.hype);
    set(`input[name=aspect][value="${o.fx.aspect || "orig"}"]`, true);
    set(`input[name=fit][value=${o.fx.fit || "crop"}]`, true);
    set(`input[name=grade][value=${o.fx.grade || "none"}]`, true);
  }, { mg: c.mg, lyStyle: c.lyStyle, fx: c.fx || {}, telops: c.telops, hype: c.hype });
  if (c.expectDisabled) {
    // 押せないこと、一覧の下に理由が出ていること
    await page.waitForFunction(() => /読めません/.test(document.getElementById("vlist").textContent), null, { timeout: 5000 }).catch(() => {});
    const dis = await page.$eval("#go", (e) => e.disabled), why = await page.$eval("#vtotal", (e) => e.textContent);
    const ok = dis && c.expectDisabled.test(why);
    console.log(`${ok ? "OK" : "NG"} ${c.name}: ${dis ? "押せない" : "押せてしまう"}・${why}`);
    if (!ok) fail++;
    continue;
  }
  if (c.cut) {
    // 音ハメ: 区切りと割り当てを直に入れて書き出す
    await page.evaluate((d) => { const e = document.getElementById("ctData"); e.value = JSON.stringify(d); }, c.cut);
    await page.check("input[name=mode][value=cut]", { force: true });
    await page.click(c.cutTry ? "#ctTry" : "#go");
  } else if (c.remix) {
    // リミックスに切りかえ、テンポを自動で調べ終わるのを待つ
    await page.check("input[name=mode][value=remix]", { force: true });
    await page.waitForFunction(() => document.getElementById("rmBpm").value !== "", null, { timeout: 15000 }).catch(() => {});
    c.gotBpm = +(await page.$eval("#rmBpm", (e) => e.value));
    await page.$eval("#rmChaos", (e, v) => { e.value = v; e.dispatchEvent(new Event("input", { bubbles: true })); }, String(c.remix.chaos));
    await page.fill("#rmSeed", String(c.remix.seed));
    await page.click(c.remix.try ? "#rmTry" : "#go");
  } else {
    await page.click("#go");
  }
  try {
    await page.waitForFunction(() => !document.getElementById("result").hidden || document.getElementById("status").classList.contains("err"), null, { timeout: +process.env.WAIT || 180000 });
  } catch {
    console.log(`NG ${c.name}: 終わらない（${await page.$eval("#status", (e) => e.textContent)}）`);
    fail++; break;
  }
  const err = await page.$eval("#status", (e) => e.classList.contains("err") ? e.textContent : "");
  if (c.expectError) {
    const ok = c.expectError.test(err);
    console.log(`${ok ? "OK" : "NG"} ${c.name}: ${err || "（エラーにならなかった）"}`);
    if (!ok) fail++;
    if (!err) await page.click("#dl").catch(() => {});
    continue;
  }
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
  if (c.est && !/約 [\d.]+ (MB|GB)/.test(c.estText)) probs.push(`大きさの目安が出ない: ${c.estText}`);
  if (c.est) console.log(`   目安 ${c.estText} → 実際 ${(await stat(out)).size} B`);
  if (c.noFile && c.noFile.test(log)) probs.push(`作らないはずのファイルを作った: ${log.match(c.noFile)[0]}`);
  if (c.lastCopy !== undefined && /-c:v copy[^\n]*\/out\.mp4/.test(log) !== c.lastCopy) probs.push("最後の処理のコピー／作り直しが期待と違う");
  if (c.remix) {
    if (Math.abs(c.gotBpm - 128) > 0.5) probs.push(`テンポの自動検出 ${c.gotBpm}`);
    // 絵の中身の指紋（同じ番号なら同じ絵になるか）
    c.vmd5 = execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", out, "-map", "0:v", "-f", "md5", "-"]).toString().trim();
    if (c.remix.sameAs !== undefined && byName(c.remix.sameAs).vmd5 !== c.vmd5) probs.push("同じ番号なのに絵が違う");
    if (c.remix.diffFrom !== undefined && byName(c.remix.diffFrom).vmd5 === c.vmd5) probs.push("番号を変えたのに絵が同じ");
    if (c.remix.shot) execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", out, "-vf", "fps=4,scale=160:-1,tile=8x4", "-frames:v", "1", S(`shot_remix_${i}.png`)]);
  }
  // できあがりを受け取る時に、途中の動画・音声が残っていないこと（終わり際にメモリを何倍も使って落ちないように）
  const left = (log.match(/\[残り\][^\n]*/) || [""])[0];
  if (!left) probs.push("[残り] の記録が無い");
  else if (/\.(mp4|m4a)\b/.test(left)) probs.push(`途中のファイルが残っている: ${left}`);
  // ちゃんと終わったら「落ちた控え」は消えている
  if (await page.evaluate(() => localStorage.getItem("avmerge.run"))) probs.push("終わったのに落ちた控えが残っている");
  if (c.bright) {
    // 黒い動画の明るさ（region: bottom＝下の 1/3、all＝全体）で、グラフィックスが出ているか
    for (const [t, lit, region] of c.bright) {
      const crop = region === "bottom" ? "crop=iw:ih/3:0:ih*2/3," : region === "top" ? "crop=iw:ih/3:0:0," : "";
      const yy = parseFloat((execFileSync("sh", ["-c", `ffmpeg -hide_banner -ss ${t} -i '${out}' -frames:v 1 -vf "${crop}signalstats,metadata=print:key=lavfi.signalstats.YAVG" -f null - 2>&1 | grep -o 'YAVG=[0-9.]*' | head -1`]).toString().split("=")[1]) || "0");
      if (lit ? yy < 17.5 : yy > 16.8) probs.push(`${t} 秒の明るさ ${yy.toFixed(1)}（${lit ? "描かれているはず" : "何も無いはず"}）`);
    }
  }
  if (c.satBelow !== undefined) {
    const sat = parseFloat((execFileSync("sh", ["-c", `ffmpeg -hide_banner -ss 2 -i '${out}' -frames:v 1 -vf "signalstats,metadata=print:key=lavfi.signalstats.SATAVG" -f null - 2>&1 | grep -o 'SATAVG=[0-9.]*' | head -1`]).toString().split("=")[1]) || "99");
    if (sat > c.satBelow) probs.push(`色の濃さ ${sat.toFixed(1)}（${c.satBelow} 以下のはず）`);
  }
  if (c.fxLog && !c.fxLog.test(log)) probs.push(`仕上げの記録が期待と違う: ${(log.match(/\[仕上げ\][^\n]*/) || ["（無い）"])[0]}`);
  if (c.hypeLog) {
    const m = log.match(/\[サビ\] (\[[^\n]*\])/);
    const hl = m ? JSON.parse(m[1]) : null;
    if (!hl || !c.hypeLog(hl)) probs.push(`サビの見つけ方が期待と違う: ${m ? m[1] : "（記録が無い）"}`);
  }
  if (c.conv) {
    // できあがりから GIF・WebM を作り、中身を調べる
    for (const [kind, want] of Object.entries(c.conv)) {
      await page.click(kind === "gif" ? "#toGif" : "#toWebm");
      await page.waitForFunction(() => !document.getElementById("convDl").hidden || /できませんでした/.test(document.getElementById("convNote").textContent), null, { timeout: 180000 });
      const [d2] = await Promise.all([page.waitForEvent("download"), page.click("#convDl")]);
      const o2 = S(`out_${i}.${kind}`); await d2.saveAs(o2);
      const pi = probe(o2), vs = pi.streams.find((x) => x.codec_type === "video"), as = pi.streams.find((x) => x.codec_type === "audio");
      const got = `${vs?.codec_name}/${as?.codec_name || "-"} ${vs?.width}x${vs?.height} ${parseFloat(pi.format.duration).toFixed(1)}s`;
      if (!want.test(got)) probs.push(`${kind}: ${got}`);
      console.log(`   ${kind}: ${got}`);
    }
  }
  if (c.moving) {
    // 同じ写真の中の 2 つの時刻で絵が違う（動いている）
    const md = (t) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-ss", String(t), "-i", out, "-frames:v", "1", "-f", "md5", "-"]).toString().trim();
    if (md(c.moving[0]) === md(c.moving[1])) probs.push(`${c.moving.join("・")} 秒の絵が同じ（写真が動いていない）`);
  }
  if (c.cutLog && !c.cutLog.test(log)) probs.push(`音ハメの記録が期待と違う: ${(log.match(/\[音ハメ\][^\n]*/) || ["（無い）"])[0]}`);
  if (c.mgLog && !c.mgLog.test(log)) probs.push(`グラフィックスの記録が期待と違う: ${(log.match(/\[グラフィックス\][^\n]*/) || [""])[0]}`);
  if (c.noAss && /lyrics\.ass/.test(log)) probs.push("字幕（ASS）を使ってしまった");
  if (c.mgShot) execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", out, "-vf", "fps=2,scale=320:-1,tile=4x4", "-frames:v", "1", S(`shot_mg_${i}.png`)]);
  if (c.sameAs !== undefined || c.remix || c.mgShot) c.vmd5 = c.vmd5 || execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", out, "-map", "0:v", "-f", "md5", "-"]).toString().trim();
  if (c.sameAs !== undefined && byName(c.sameAs).vmd5 !== c.vmd5) probs.push("同じ設定なのに絵が違う");
  if (c.catCopy !== undefined && /-f concat -safe 0 -i \/work\/vlist/.test(log) !== c.catCopy) probs.push("つなぎ方（そのまま／作り直し）が期待と違う");
  if (c.size && `${v?.width}x${v?.height}` !== c.size) probs.push(`大きさ ${v?.width}x${v?.height}`);
  if (c.rot && !JSON.stringify(v?.side_data_list || []).includes("rotation")) probs.push("回す印が消えた");
  if (c.note && !c.note.test(rinfo)) probs.push(`知らせが無い: ${rinfo}`);
  if (c.lyrics) {
    if (!c.lyrics.status.test(c.lyStatus)) probs.push(`歌詞の案内が違う: ${c.lyStatus}`);
    if (c.lyOn !== c.lyrics.on) probs.push(`焼き込むの印が ${c.lyOn}`);
    // 黒い動画の下のほうの明るさ: 字が出ている時刻は明るく、出ていない時刻は真っ黒
    for (const [t, lit] of c.lyrics.at) {
      const yy = parseFloat((execFileSync("sh", ["-c", `ffmpeg -hide_banner -ss ${t} -i '${out}' -frames:v 1 -vf "crop=iw:ih/3:0:ih*2/3,signalstats,metadata=print:key=lavfi.signalstats.YAVG" -f null - 2>&1 | grep -o 'YAVG=[0-9.]*' | head -1`]).toString().split("=")[1]) || "0");
      if (lit ? yy < 16.8 : yy > 16.8) probs.push(`${t} 秒の字の明るさ ${yy.toFixed(1)}（${lit ? "字が出るはず" : "何も出ないはず"}）`);
    }
    if (c.lyrics.shot) execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-ss", String(c.lyrics.shot), "-i", out, "-frames:v", "1", S(`shot_lyrics_${i}.png`)]);
  }
  console.log(`${probs.length ? "NG" : "OK"} ${c.name}: ${dur.toFixed(2)}s ${v?.codec_name}/${a?.codec_name} ${(await stat(out)).size}B ${probs.join(" / ")}`);
  if (probs.length) fail++;
  if (i === 0) await page.screenshot({ path: S("shot_result.png"), fullPage: true });
}
// 歌詞にタップで時刻を付ける: 曲を流して 2 回押すと、2 行に時刻が付くか
if (FONT && (!process.env.ONLY || "タップ".includes(process.env.ONLY))) {
  const p3 = await browser.newPage();
  await p3.goto(`${base}?core=${encodeURIComponent(base + "core")}`);
  await p3.setInputFiles("#afile", S("a_plain.mp3"));
  await p3.waitForFunction(() => /時刻なし 2 行/.test(document.getElementById("lyStatus").textContent), null, { timeout: 5000 });
  await p3.click("#lyTap");
  await p3.waitForTimeout(1200); await p3.keyboard.press("Space");
  await p3.waitForTimeout(1000); await p3.keyboard.press("Space");
  const text = await p3.$eval("#lyText", (e) => e.value);
  const ts = [...text.matchAll(/\[(\d+):(\d+\.\d+)\]/g)].map((m) => +m[1] * 60 + +m[2]);
  const ok = ts.length === 2 && ts[0] > 0.8 && ts[1] - ts[0] > 0.6 && /\]時刻の無い一行目\n\[.*\]二行目/.test(text);
  console.log(`${ok ? "OK" : "NG"} タップで時刻を付ける: ${JSON.stringify(text)}`);
  if (!ok) fail++;
  await p3.screenshot({ path: S("shot_tap.png"), fullPage: true });
  await p3.close();
}
// リミックスの崩し方を全部、ブラウザの ffmpeg（5.1）で 1 つずつ流し、ちょうど決めたコマ数が出るか。
// 手元の ffmpeg（6.1）で通っても、ブラウザのほうに無い書き方があると本番で落ちるので
if (!process.env.ONLY || "崩し方".includes(process.env.ONLY)) {
  const p4 = await browser.newPage();
  p4.on("pageerror", (e) => console.log("pageerror:", e.message));
  await p4.goto(base);
  const res = await p4.evaluate(async (core) => {
    const { FFmpeg } = await import("/vendor/ffmpeg/index.js");
    const { segFilter, TIME_FX, LOOK_FX } = await import("/remix.js");
    const f = new FFmpeg(), logs = [];
    f.on("log", ({ message }) => logs.push(message));
    await f.load({ coreURL: `${core}/ffmpeg-core.js`, wasmURL: `${core}/ffmpeg-core.wasm` });
    await f.writeFile("/src.mp4", new Uint8Array(await (await fetch("/out/v_h264.mp4")).arrayBuffer()));
    const NEED = { fast: 2, warp: 4, skip: 2, slow: 0.5, pingpong: 0.5, freeze: 0.1 };
    const tests = [
      ...TIME_FX.map((time) => ({ name: time, seg: { frames: 13, time, reps: 3, need: 13 / 30 * (NEED[time] || 1), look: [] } })),
      ...LOOK_FX.map((fx) => ({ name: fx, seg: { frames: 9, time: "normal", reps: 1, need: 0.3, look: [fx], p: { dir: -1, hue: 200 } } })),
      { name: "pingpong+kaleido+rgbx+trail+huespin", seg: { frames: 15, time: "pingpong", reps: 1, need: 0.25, look: ["kaleido", "rgbx", "trail", "huespin"], p: { dir: 1, hue: 10 } } },
      { name: "skip+grid4+strobe+zoomin+noise", seg: { frames: 11, time: "skip", reps: 1, need: 0.8, look: ["grid4", "strobe", "zoomin", "noise"] } },
    ];
    const out = [];
    for (const t of tests) {
      logs.length = 0;
      const ret = await f.exec(["-hide_banner", "-ss", "1", "-t", t.seg.need.toFixed(3), "-i", "/src.mp4", "-filter_complex", `[0:v:0]${segFilter(t.seg, { W: 320, H: 180, F: 30 }, "q")}[v]`, "-map", "[v]", "-f", "null", "-"]);
      const fr = logs.join("\n").match(/frame=\s*(\d+)/g);
      out.push({ name: t.name, want: t.seg.frames, got: fr ? +fr[fr.length - 1].match(/\d+/)[0] : -1, ret, err: ret ? logs.slice(-4).join(" | ") : "" });
    }
    f.terminate();
    return out;
  }, `${base}core`);
  const bad = res.filter((r) => r.ret !== 0 || r.got !== r.want);
  console.log(`${bad.length ? "NG" : "OK"} 崩し方を全部ブラウザの ffmpeg で（${res.length} 通り）${bad.length ? " " + JSON.stringify(bad) : ""}`);
  if (bad.length) fail++;
  await p4.close();
}
// 落ちたあと: 途中の控えが残っていれば、開き直した時に知らせ、設定と歌詞を戻す。同じ音声を入れ直してもタグで上書きしない
if (!process.env.ONLY || "落ちた".includes(process.env.ONLY)) {
  const p5 = await browser.newPage();
  await p5.goto(base);
  await p5.evaluate(() => localStorage.setItem("avmerge.run", JSON.stringify({
    at: Date.now() - 180000, stage: "グラフィックスを描いています（3/10）", audio: "a_lrc.mp3",
    settings: { lyText: "[00:01.00]戻った歌詞", lyOn: true, mgOn: true, "radio:mgStyle": "retro", mgTitleText: "直した曲名" },
  })));
  await p5.reload();
  const shown = await p5.isVisible("#crashNote");
  const text = await p5.$eval("#crashText", (e) => e.textContent);
  const st = await p5.evaluate(() => ({ mgOn: document.getElementById("mgOn").checked, retro: document.querySelector("input[name=mgStyle][value=retro]").checked, key: localStorage.getItem("avmerge.run") }));
  await p5.setInputFiles("#afile", S("a_lrc.mp3"));
  await p5.waitForFunction(() => !/探しています/.test(document.getElementById("lyStatus").textContent), null, { timeout: 5000 });
  const ly = await p5.$eval("#lyText", (e) => e.value), title = await p5.$eval("#mgTitleText", (e) => e.value);
  // 別の音声なら、ふつうにタグから読む
  await p5.setInputFiles("#afile", S("a_plain.mp3"));
  await p5.waitForFunction(() => /時刻の無い一行目/.test(document.getElementById("lyText").value), null, { timeout: 5000 }).catch(() => {});
  const ly2 = await p5.$eval("#lyText", (e) => e.value);
  const ok = shown && /グラフィックスを描いています（3\/10）/.test(text) && /3 分前/.test(text) && st.mgOn && st.retro && st.key === null
    && ly === "[00:01.00]戻った歌詞" && title === "直した曲名" && /時刻の無い一行目/.test(ly2);
  console.log(`${ok ? "OK" : "NG"} 落ちたあとの知らせと設定の戻し ${ok ? "" : JSON.stringify({ shown, text, st, ly, title, ly2 })}`);
  if (!ok) fail++;
  await p5.screenshot({ path: S("shot_crash.png") });
  await p5.close();
}
// 写真の一覧: 長さは「1 枚の長さ」、変えると一覧も変わる。読めない写真は理由を出す
if (!process.env.ONLY || "写真".includes(process.env.ONLY)) {
  const p8 = await browser.newPage();
  await p8.goto(base);
  await p8.setInputFiles("#vfile", [S("p_land.png"), S("p_fake.heic")]);
  await p8.waitForFunction(() => /読めません/.test(document.getElementById("vlist").textContent), null, { timeout: 5000 }).catch(() => {});
  const a1 = await p8.$eval("#vlist", (e) => e.textContent), row = await p8.isVisible("#photoRow"), tot = await p8.$eval("#vtotal", (e) => e.textContent);
  await p8.fill("#photoSec", "2.5");
  const a2 = await p8.$eval("#vlist", (e) => e.textContent);
  const ok = /写真 0:04\.0/.test(a1) && /読めません/.test(a1) && row && /読めない写真/.test(tot) && /写真 0:02\.5/.test(a2);
  console.log(`${ok ? "OK" : "NG"} 写真の一覧 ${ok ? "" : JSON.stringify({ a1, row, tot, a2 })}`);
  if (!ok) fail++;
  await p8.close();
}
// 音ハメの画面: 一気に区切る → 一覧の行数。使い始めに打っても入力欄が消えない。スペースで近い半拍に区切る
if (!process.env.ONLY || "音ハメ".includes(process.env.ONLY)) {
  const p9 = await browser.newPage();
  await p9.goto(base);
  await p9.setInputFiles("#vfile", [S("v_vp9.webm"), S("v_black.mp4")]);
  await p9.setInputFiles("#afile", S("a_drum.mp3"));
  await p9.check("input[name=mode][value=cut]", { force: true });
  await p9.waitForFunction(() => +document.getElementById("rmBpm").value > 0, null, { timeout: 15000 });
  await p9.fill("#ctEvery", "4");
  await p9.click("#ctAuto");
  const d1 = await p9.$eval("#ctData", (e) => JSON.parse(e.value)), rows = await p9.locator(".ctrow").count();
  const at = p9.locator(".ctrow input[type=number]").nth(1);
  await at.click(); await at.fill(""); await p9.keyboard.type("1.5");
  const focused = await p9.evaluate(() => document.activeElement?.closest(".ctrow") !== null);
  const d2 = await p9.$eval("#ctData", (e) => JSON.parse(e.value));
  await p9.evaluate(() => { document.getElementById("aprev").currentTime = 5.1; document.activeElement.blur(); });
  await p9.waitForTimeout(300);
  await p9.keyboard.press("Space");
  const d3 = await p9.$eval("#ctData", (e) => JSON.parse(e.value));
  const bpm = +(await p9.$eval("#rmBpm", (e) => e.value)), off = +(await p9.$eval("#rmOffset", (e) => e.value)), half = 30 / bpm;
  const added = d3.cuts.find((c) => !d1.cuts.some((x) => Math.abs(x - c) < 1e-6));
  // 区切りは 1/1000 秒にそろえるので、半拍の位置から 2 ミリ秒以内なら吸いついている
  const onHalf = added !== undefined && Math.abs(added - (off + Math.round((added - off) / half) * half)) < 0.002 && Math.abs(added - 5.1) < half;
  // 一気に区切ったあと、素材は 1→2→1→2… と順に回る（選んでいない区間は前の区間を引き継がない）
  const srcs = await p9.$$eval(".ctrow select:first-of-type", (es) => es.map((e) => e.value).join(""));
  const alt = /^0101/.test(srcs);
  const ok = d1.cuts.length >= 9 && rows === d1.cuts.length + 1 && focused && d2.assign[1].at === 1.5 && onHalf && alt && !d2.assign[0];
  console.log(`${ok ? "OK" : "NG"} 音ハメの画面 ${ok ? "" : JSON.stringify({ cuts: d1.cuts.length, rows, focused, at1: d2.assign[1]?.at, added, bpm, off, srcs, a0: d2.assign[0] })}`);
  if (!ok) fail++;
  await p9.screenshot({ path: S("shot_cut.png"), fullPage: true });
  await p9.close();
}
// テロップの一覧: 足す → 文字を打つ → データに入る → 消す
if (!process.env.ONLY || "テロップ".includes(process.env.ONLY)) {
  const p7 = await browser.newPage();
  await p7.goto(base);
  await p7.click("#tpAdd"); await p7.click("#tpAdd");
  await p7.locator(".tprow .tptext").first().fill("ひとつめ");
  const d1 = await p7.$eval("#telopText", (e) => JSON.parse(e.value));
  await p7.locator(".tprow button").nth(1).click();
  const d2 = await p7.$eval("#telopText", (e) => JSON.parse(e.value));
  const rows = await p7.locator(".tprow").count();
  const ok = d1.length === 2 && d1[0].text === "ひとつめ" && d1[0].dur === 3 && d2.length === 1 && d2[0].text === "ひとつめ" && rows === 1;
  console.log(`${ok ? "OK" : "NG"} テロップの一覧の操作 ${ok ? "" : JSON.stringify({ d1, d2, rows })}`);
  if (!ok) fail++;
  await p7.close();
}
// 設定の保存: 保存 → 変える → 呼び出すと戻る。曲ごとのもの（歌詞）は入れない。名前に記号が入っても文字のまま
if (!process.env.ONLY || "プリセット".includes(process.env.ONLY)) {
  const p6 = await browser.newPage();
  await p6.goto(base);
  await p6.evaluate(() => localStorage.removeItem("avmerge.presets"));
  await p6.reload();
  const set = (sel, v) => p6.evaluate(([sel, v]) => { const e = document.querySelector(sel); if (e.type === "checkbox" || e.type === "radio") e.checked = v; else e.value = v; e.dispatchEvent(new Event("change", { bubbles: true })); e.dispatchEvent(new Event("input", { bubbles: true })); }, [sel, v]);
  await set("#mgOn", true); await set("input[name=mgStyle][value=glitch]", true); await set("#rmChaos", "30"); await set("input[name=mode][value=remix]", true);
  await set("#lyText", "歌詞は入れない");
  await set("#psName", "<b>私の設定</b>");
  await p6.click("#psSave");
  await set("#mgOn", false); await set("input[name=mgStyle][value=neon]", true); await set("#rmChaos", "90"); await set("input[name=mode][value=merge]", true); await set("#lyText", "別の歌詞");
  await p6.click("#psLoad");
  const r = await p6.evaluate(() => ({
    mgOn: document.getElementById("mgOn").checked, glitch: document.querySelector("input[name=mgStyle][value=glitch]").checked,
    chaos: document.getElementById("rmChaos").value, remix: document.querySelector("input[name=mode][value=remix]").checked,
    ly: document.getElementById("lyText").value, opt: document.getElementById("psList").options[0].textContent, html: document.getElementById("psList").innerHTML,
    stored: JSON.parse(localStorage.getItem("avmerge.presets")),
  }));
  const ok = r.mgOn && r.glitch && r.chaos === "30" && r.remix && r.ly === "別の歌詞" && r.opt === "<b>私の設定</b>" && !/<b>/.test(r.html) && !("lyText" in r.stored["<b>私の設定</b>"]);
  console.log(`${ok ? "OK" : "NG"} 設定の保存と呼び出し ${ok ? "" : JSON.stringify(r).slice(0, 400)}`);
  if (!ok) fail++;
  await p6.close();
}
// メモリの警告: 境目を下げたページで、大きすぎる見込みなら警告が出るか
if (!process.env.ONLY || "メモリの警告".includes(process.env.ONLY)) {
  const p2 = await browser.newPage();
  await p2.goto(`${base}?memlimit=1000&core=${encodeURIComponent(base + "core")}`);
  await p2.setInputFiles("#vfile", S("v_vp9.webm"));
  await p2.setInputFiles("#afile", S("a_10s.mp3"));
  const warned = await p2.waitForFunction(() => document.getElementById("sizeNote").classList.contains("warn"), null, { timeout: 5000 }).then(() => true, () => false);
  const text = await p2.$eval("#sizeNote", (e) => e.textContent);
  console.log(`${warned && /メモリが足りず/.test(text) ? "OK" : "NG"} メモリの警告: ${text}`);
  if (!warned) fail++;
  await p2.screenshot({ path: S("shot_warn.png"), fullPage: true });
  await p2.close();
}
await page.setViewportSize({ width: 390, height: 1400 });
await page.screenshot({ path: S("shot_phone.png"), fullPage: true });
await browser.close();
server.close();
console.log(fail ? `${fail} 件 NG` : "全部 OK");
process.exit(fail ? 1 : 0);
