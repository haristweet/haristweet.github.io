// 音声ファイルに入っている歌詞を読む。ffmpeg を読み込む前に、ファイルを選んだその場で読めるよう JS だけで書く。
//   mp3（ID3v2.2〜2.4 の USLT・SYLT）／ m4a・mp4（©lyr）／ flac・ogg・opus（LYRICS などのコメント）
//   mp3 は TXXX（自由な欄）の LYRICS・UNSYNCEDLYRICS・USLT も読む
// 曲名・アーティスト（title・artist）も一緒に読む（モーショングラフィックスのタイトル用）。
// 返すのは { text, synced, source, title, artist }。synced は SYLT のような時刻付き（[{ t, text }]）。text は LRC 形式（[mm:ss.xx]）のこともある

const td = (enc) => new TextDecoder(enc);
const readBytes = async (blob, start, len) => new Uint8Array(await blob.slice(start, start + len).arrayBuffer());

export async function readEmbeddedLyrics(blob) {
  const head = await readBytes(blob, 0, 12);
  const tag = String.fromCharCode(...head.slice(0, 4));
  try {
    if (tag.startsWith("ID3")) return await readId3(blob);
    if (tag === "fLaC") return await readFlac(blob);
    if (tag === "OggS") return await readOgg(blob);
    if (String.fromCharCode(...head.slice(4, 8)) === "ftyp") return await readMp4(blob);
  } catch (e) {
    return { text: "", synced: null, source: "", error: String(e.message || e) };
  }
  return { text: "", synced: null, source: "" };
}

// ── ID3v2 ──
const syncsafe = (b, i) => (b[i] << 21) | (b[i + 1] << 14) | (b[i + 2] << 7) | b[i + 3];
const be32 = (b, i) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
// 「非同期化」で FF のあとに挟まれた 00 を取り除く
const unsync = (b) => {
  const out = [];
  for (let i = 0; i < b.length; i++) { out.push(b[i]); if (b[i] === 0xff && b[i + 1] === 0) i++; }
  return Uint8Array.from(out);
};

// 文字コード 0 は本来 Latin-1 だが、日本の古いタグは Shift_JIS のことが多い。高い字があれば Shift_JIS で読めるか試す
function decodeText(bytes, enc) {
  if (enc === 1) {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) return td("utf-16le").decode(bytes.subarray(2));
    if (bytes[0] === 0xfe && bytes[1] === 0xff) return td("utf-16be").decode(bytes.subarray(2));
    return td("utf-16le").decode(bytes);
  }
  if (enc === 2) return td("utf-16be").decode(bytes);
  if (enc === 3) return td("utf-8").decode(bytes);
  if (bytes.some((x) => x >= 0x80)) {
    try { return new TextDecoder("shift_jis", { fatal: true }).decode(bytes); } catch { /* Latin-1 として読む */ }
  }
  return td("latin1").decode(bytes);
}

// 文字列の終わり（00、UTF-16 なら 2 バイトそろった 00 00）を探す
function termEnd(b, i, enc) {
  if (enc === 1 || enc === 2) {
    for (let j = i; j + 1 < b.length; j += 2) if (b[j] === 0 && b[j + 1] === 0) return [j, j + 2];
    return [b.length, b.length];
  }
  const j = b.indexOf(0, i);
  return j < 0 ? [b.length, b.length] : [j, j + 1];
}

async function readId3(blob) {
  const h = await readBytes(blob, 0, 10);
  const ver = h[3], flags = h[5], size = syncsafe(h, 6);
  let b = await readBytes(blob, 10, size);
  if (ver < 4 && flags & 0x80) b = unsync(b);
  let p = 0;
  if (flags & 0x40) p = ver === 4 ? syncsafe(b, 0) : be32(b, 0) + 4;
  const idLen = ver === 2 ? 3 : 4, hdrLen = ver === 2 ? 6 : 10;
  const uslt = [], sylt = [], tags = { title: "", artist: "" };
  while (p + hdrLen <= b.length) {
    const id = String.fromCharCode(...b.subarray(p, p + idLen));
    if (!/^[A-Z0-9]+$/.test(id)) break;           // 詰め物（00）に来たら終わり
    const fsize = ver === 2 ? (b[p + 3] << 16) | (b[p + 4] << 8) | b[p + 5] : ver === 4 ? syncsafe(b, p + 4) : be32(b, p + 4);
    const fflags = ver === 2 ? 0 : b[p + 9];
    let data = b.subarray(p + hdrLen, p + hdrLen + fsize);
    p += hdrLen + fsize;
    if (ver === 4) {
      if (fflags & 0x01) data = data.subarray(4);    // データの長さの印
      if (fflags & 0x02) data = unsync(data);
    }
    if (id === "USLT" || id === "ULT") uslt.push(parseUslt(data));
    if ((id === "TIT2" || id === "TT2") && !tags.title) tags.title = decodeText(data.subarray(1), data[0]).replace(/\0[\s\S]*$/, "").trim();
    if ((id === "TPE1" || id === "TP1") && !tags.artist) tags.artist = decodeText(data.subarray(1), data[0]).replace(/\0[\s\S]*$/, "").trim();
    if (id === "SYLT" || id === "SLT") sylt.push(parseSylt(data));
    // TXXX（自由な欄）に歌詞を入れる道具もある。ffmpeg は「USLT」という名前で入れる
    if (id === "TXXX" || id === "TXX") {
      const enc = data[0], [end, after] = termEnd(data, 1, enc);
      if (/^(USLT|LYRICS|UNSYNCED ?LYRICS|SYNCED ?LYRICS)$/i.test(decodeText(data.subarray(1, end), enc).trim()))
        uslt.push(decodeText(data.subarray(after), enc).replace(/\0+$/, ""));
    }
  }
  const synced = sylt.find((s) => s && s.length);
  if (synced) return { text: synced.map((l) => `[${fmtLrc(l.t)}]${l.text}`).join("\n"), synced, source: "mp3（SYLT・時刻付き）", ...tags };
  const text = uslt.find((t) => t && t.trim());
  return { text: text || "", synced: null, source: text ? "mp3（歌詞）" : "", ...tags };
}

function parseUslt(d) {
  const enc = d[0];
  const [, after] = termEnd(d, 4, enc);   // 4 = 文字コード 1 ＋ 言語 3
  return decodeText(d.subarray(after), enc).replace(/\0+$/, "");
}

function parseSylt(d) {
  const enc = d[0], fmt = d[4];
  if (fmt !== 2) return null;               // 2 = ミリ秒。1（MPEG のコマ数）はほとんど使われないので読まない
  let [, p] = termEnd(d, 6, enc);           // 6 = 文字コード・言語・時刻の形・中身の種類
  const out = [];
  while (p < d.length) {
    const [end, next] = termEnd(d, p, enc);
    if (next + 4 > d.length) break;
    const text = decodeText(d.subarray(p, end), enc);
    out.push({ t: be32(d, next) / 1000, text: text.replace(/^[\r\n]+/, "") });
    p = next + 4;
  }
  return out;
}

// ── MP4（moov/udta/meta/ilst/©lyr/data） ──
async function readMp4(blob) {
  // 先頭の箱を順にたどって moov を探す（カメラの mp4 は moov が後ろにある）
  let pos = 0, moov = null;
  while (pos + 8 <= blob.size) {
    const h = await readBytes(blob, pos, 16);
    let size = be32(h, 0);
    const type = String.fromCharCode(...h.subarray(4, 8));
    let hl = 8;
    if (size === 1) { size = be32(h, 8) * 2 ** 32 + be32(h, 12); hl = 16; }
    if (size === 0) size = blob.size - pos;
    if (size < hl) break;
    if (type === "moov") { moov = await readBytes(blob, pos + hl, size - hl); break; }
    pos += size;
  }
  if (!moov) return { text: "", synced: null, source: "" };
  const find = (b, path) => {
    let p = 0;
    while (p + 8 <= b.length) {
      const size = be32(b, p), type = td("latin1").decode(b.subarray(p + 4, p + 8));
      if (size < 8) return null;
      if (type === path[0]) {
        let body = b.subarray(p + 8, p + size);
        if (type === "meta") body = body.subarray(4);   // meta は版と印の 4 バイトが先に付く
        return path.length === 1 ? body : find(body, path.slice(1));
      }
      p += size;
    }
    return null;
  };
  const str = (key) => { const d = find(moov, ["udta", "meta", "ilst", key, "data"]); return d ? td("utf-8").decode(d.subarray(8)) : ""; };   // 8 = 種類 4 ＋ 地域 4
  const text = str("\xa9lyr");
  return { text, synced: null, source: text ? "m4a（©lyr）" : "", title: str("\xa9nam").trim(), artist: str("\xa9ART").trim() };
}

// ── Vorbis コメント（flac・ogg・opus） ──
const le32 = (b, i) => b[i] + (b[i + 1] << 8) + (b[i + 2] << 16) + ((b[i + 3] << 24) >>> 0);
function lyricsFromComments(b, p, source) {
  p += 4 + le32(b, p);                      // 作った道具の名前
  const n = le32(b, p); p += 4;
  const found = {};
  for (let i = 0; i < n && p + 4 <= b.length; i++) {
    const len = le32(b, p); p += 4;
    const kv = td("utf-8").decode(b.subarray(p, p + len)); p += len;
    const eq = kv.indexOf("=");
    if (eq > 0) found[kv.slice(0, eq).toUpperCase()] = kv.slice(eq + 1);
  }
  const text = found.SYNCEDLYRICS || found.LYRICS || found.UNSYNCEDLYRICS || "";
  return { text, synced: null, source: text ? source : "", title: (found.TITLE || "").trim(), artist: (found.ARTIST || "").trim() };
}

async function readFlac(blob) {
  let p = 4;
  for (;;) {
    const h = await readBytes(blob, p, 4);
    if (h.length < 4) break;
    const last = h[0] & 0x80, type = h[0] & 0x7f, len = (h[1] << 16) | (h[2] << 8) | h[3];
    if (type === 4) return lyricsFromComments(await readBytes(blob, p + 4, len), 0, "flac（LYRICS）");
    p += 4 + len;
    if (last) break;
  }
  return { text: "", synced: null, source: "" };
}

async function readOgg(blob) {
  // ページをたどって 2 つ目のパケット（コメント）を組み立てる。ジャケット画像で大きいこともあるので 16MB まで
  const b = await readBytes(blob, 0, Math.min(blob.size, 16 << 20));
  let p = 0, packet = [], count = 0;
  while (p + 27 <= b.length && td("latin1").decode(b.subarray(p, p + 4)) === "OggS") {
    const nseg = b[p + 26], segs = b.subarray(p + 27, p + 27 + nseg);
    let q = p + 27 + nseg;
    for (const s of segs) {
      packet.push(b.subarray(q, q + s)); q += s;
      if (s < 255) {
        count++;
        if (count === 2) {
          const all = new Uint8Array(packet.reduce((t, x) => t + x.length, 0));
          let o = 0; for (const x of packet) { all.set(x, o); o += x.length; }
          const isOpus = td("latin1").decode(all.subarray(0, 8)) === "OpusTags";
          return lyricsFromComments(all, isOpus ? 8 : 7, isOpus ? "opus（LYRICS）" : "ogg（LYRICS）");
        }
        packet = [];
      }
    }
    p = q;
  }
  return { text: "", synced: null, source: "" };
}

// ── LRC（[mm:ss.xx]歌詞）──
const fmtLrc = (t) => { const m = Math.floor(t / 60), s = t - m * 60; return `${String(m).padStart(2, "0")}:${s.toFixed(2).padStart(5, "0")}`; };
export { fmtLrc };

// 1行に時刻が何個あってもよい（サビのくり返し）。[ar:..] などの見出しは読み飛ばし、[offset:+100] はずらす
export function parseLrc(text) {
  const lines = [], plain = [];
  let offset = 0;
  for (const raw of text.split(/\r?\n/)) {
    const off = raw.match(/^\s*\[offset:\s*([+-]?\d+)\s*\]/i);
    if (off) { offset = +off[1] / 1000; continue; }
    const stamps = [...raw.matchAll(/\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g)];
    if (stamps.length) {
      const body = raw.replace(/\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]/g, "").trim();
      for (const s of stamps) lines.push({ t: +s[1] * 60 + parseFloat(s[2].replace(":", ".")), text: body });
    } else if (!/^\s*\[[a-z]+:.*\]\s*$/i.test(raw) && raw.trim()) {
      plain.push(raw.trim());
    }
  }
  lines.forEach((l) => { l.t = Math.max(0, l.t - offset); });
  lines.sort((a, b) => a.t - b.t);
  return { timed: lines, untimed: plain };
}

// ── ASS 字幕を作る ──
const assTime = (t) => {
  t = Math.max(0, t);
  const h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, s = t % 60;
  return `${h}:${String(m).padStart(2, "0")}:${s.toFixed(2).padStart(5, "0")}`;
};
const assEsc = (s) => s.replace(/\\/g, "\\\\").replace(/[{}]/g, (c) => (c === "{" ? "｛" : "｝"));

// lines: 曲の中の時刻（秒）の付いた行。shift は曲の時刻→できあがりの時刻のずれ、period は音声をくり返すときの長さ、T はできあがりの長さ。
// 行の終わりは次の行の始まり（最長 maxHold 秒）。空の行は「そこで消す」印
export function buildAss(lines, { W, H, T, shift = 0, period = 0, size = "m", pos = "bottom", font, maxHold = 8 }) {
  const fs = Math.round(H * { s: 0.05, m: 0.07, l: 0.09 }[size]);
  const align = pos === "middle" ? 5 : 2;
  const margin = Math.round(H * 0.06);
  const events = [];
  const reps = period > 0 ? Math.ceil(T / period) + 1 : 1;
  for (let k = 0; k < reps; k++) {
    lines.forEach((l, i) => {
      const next = lines[i + 1] ? lines[i + 1].t : l.t + maxHold;
      const a = l.t + shift + k * period, b = Math.min(next, l.t + maxHold) + shift + k * period;
      if (!l.text || b <= 0 || a >= T) return;
      events.push(`Dialogue: 0,${assTime(a)},${assTime(Math.min(b, T))},L,,0,0,0,,${assEsc(l.text)}`);
    });
  }
  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${W}
PlayResY: ${H}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: L,${font},${fs},&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,${Math.max(2, Math.round(fs * 0.08))},${Math.max(1, Math.round(fs * 0.04))},${align},${margin},${margin},${margin},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${events.join("\n")}
`;
}
