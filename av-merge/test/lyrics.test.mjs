// 歌詞の読み取りと LRC・ASS の単体試験。  node test/lyrics.test.mjs [出力フォルダ]
// 手元の ffmpeg で歌詞入りの見本を作って読む。ffmpeg が書けない SYLT（時刻付き）と Shift_JIS のタグはバイトを手で組む
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { openAsBlob } from "node:fs";
import { join, resolve } from "node:path";
import { readEmbeddedLyrics, parseLrc, buildAss } from "../lyrics.js";

const OUT = resolve(process.argv[2] || "test-out");
await mkdir(OUT, { recursive: true });
const S = (n) => join(OUT, n);
const ff = (...a) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...a]);
const tone = ["-f", "lavfi", "-i", "sine=f=440:duration=1"];
const LY = "一行目の歌詞\n二行目 second line\n三行目";

let fail = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "OK" : "NG"} ${name}${ok ? "" : " " + detail}`); if (!ok) fail++; };
const read = async (p) => readEmbeddedLyrics(await openAsBlob(p));

// ── ffmpeg が書ける形 ──
const made = [
  ["mp3 ID3v2.4", "l24.mp3", ["-c:a", "libmp3lame"]],
  ["mp3 ID3v2.3", "l23.mp3", ["-c:a", "libmp3lame", "-id3v2_version", "3"]],
  ["m4a", "l.m4a", ["-c:a", "aac"]],
  ["flac", "l.flac", []],
  ["ogg", "l.ogg", ["-c:a", "libvorbis"]],
  ["opus", "l.opus", ["-c:a", "libopus"]],
];
for (const [name, file, codec] of made) {
  ff(...tone, ...codec, "-metadata", `lyrics=${LY}`, S(file));
  const r = await read(S(file));
  check(`${name} の歌詞`, r.text.trim() === LY, JSON.stringify(r));
}
ff(...tone, "-c:a", "libmp3lame", S("none.mp3"));
check("歌詞の無い mp3", (await read(S("none.mp3"))).text === "");

// ── 手で組む ID3v2.3 ──
const raw = await readFile(S("none.mp3"));
const tagEnd = 10 + ((raw[6] << 21) | (raw[7] << 14) | (raw[8] << 7) | raw[9]);
const audio = raw.subarray(tagEnd);
const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const frame = (id, body) => Buffer.concat([Buffer.from(id), Buffer.from(u32(body.length)), Buffer.from([0, 0]), body]);
const tag = (...frames) => {
  const body = Buffer.concat(frames), n = body.length;
  return Buffer.concat([Buffer.from("ID3"), Buffer.from([3, 0, 0, (n >> 21) & 127, (n >> 14) & 127, (n >> 7) & 127, n & 127]), body]);
};
// SYLT: 文字コード 3（UTF-8）・言語・時刻はミリ秒（2）・中身は歌詞（1）・説明は空
const sylt = Buffer.concat([Buffer.from([3]), Buffer.from("jpn"), Buffer.from([2, 1, 0]),
  ...[["はじまり", 1500], ["つぎの行", 4250], ["おわり", 61000]].map(([t, ms]) => Buffer.concat([Buffer.from(t), Buffer.from([0]), Buffer.from(u32(ms))]))]);
await writeFile(S("sylt.mp3"), Buffer.concat([tag(frame("SYLT", sylt)), audio]));
const rs = await read(S("sylt.mp3"));
check("SYLT（時刻付き）", JSON.stringify(rs.synced) === JSON.stringify([{ t: 1.5, text: "はじまり" }, { t: 4.25, text: "つぎの行" }, { t: 61, text: "おわり" }]), JSON.stringify(rs));
check("SYLT を LRC の形にする", rs.text.split("\n")[2] === "[01:01.00]おわり", rs.text);

// USLT（文字コード 0）に Shift_JIS で書いた日本語
const sjis = Buffer.from([0x82, 0xa0, 0x82, 0xa2, 0x82, 0xa4, 0x0a, 0x89, 0xcc]);   // あいう\n歌
await writeFile(S("sjis.mp3"), Buffer.concat([tag(frame("USLT", Buffer.concat([Buffer.from([0]), Buffer.from("jpn"), Buffer.from([0]), sjis]))), audio]));
check("Shift_JIS の USLT", (await read(S("sjis.mp3"))).text === "あいう\n歌", JSON.stringify(await read(S("sjis.mp3"))));

// USLT（UTF-16 ＋ BOM、説明付き）に LRC 形式
const lrcText = "[ti:テスト]\n[00:01.00]いち\n[00:03.50][00:10.00]サビ\n[00:05.00]";
const u16 = (s) => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(s, "utf16le")]);
await writeFile(S("lrc.mp3"), Buffer.concat([tag(frame("USLT", Buffer.concat([Buffer.from([1]), Buffer.from("jpn"), u16("説明"), Buffer.from([0, 0]), u16(lrcText)]))), audio]));
const rl = await read(S("lrc.mp3"));
check("UTF-16 の USLT（説明付き）", rl.text === lrcText, JSON.stringify(rl.text));

// ── LRC ──
const p = parseLrc(lrcText);
check("LRC: 1行に時刻が2つ・空の行は消す印・見出しは読み飛ばす",
  JSON.stringify(p.timed) === JSON.stringify([{ t: 1, text: "いち" }, { t: 3.5, text: "サビ" }, { t: 5, text: "" }, { t: 10, text: "サビ" }]) && p.untimed.length === 0, JSON.stringify(p));
check("LRC: [offset] でずらす", parseLrc("[offset:+500]\n[00:02.00]a").timed[0].t === 1.5);
check("LRC: 時刻の無い行", JSON.stringify(parseLrc("a\n\nb").untimed) === '["a","b"]');

// ── ASS ──
const ass = buildAss([{ t: 1, text: "いち" }, { t: 3.5, text: "サビ" }, { t: 5, text: "" }], { W: 640, H: 360, T: 12, shift: 0.5, period: 6, font: "F" });
const ev = ass.split("\n").filter((l) => l.startsWith("Dialogue"));
check("ASS: ずらし・次の行まで・空の行で消える・音声のくり返しに合わせてくり返す",
  ev.length === 4 && ev[0].includes("0:00:01.50,0:00:04.00") && ev[1].includes("0:00:04.00,0:00:05.50") && ev[2].includes("0:00:07.50,0:00:10.00") && ev[3].includes("0:00:10.00,0:00:11.50"), ev.join("\n"));
check("ASS: { } は文字として出す", buildAss([{ t: 0, text: "{a}" }], { W: 2, H: 2, T: 5, font: "F" }).includes("｛a｝"));

console.log(fail ? `${fail} 件 NG` : "全部 OK");
process.exit(fail ? 1 : 0);
