// APNG（アニメーションPNG）を組み立てる。外部のライブラリは使わない。
// 前のこまから変わった四角だけを入れ（dispose: NONE / blend: SOURCE）、同じ絵が続くこまは1枚にまとめて表示時間を延ばす。
// 圧縮はブラウザの CompressionStream('deflate')（zlib 形式）。無い環境では圧縮しない deflate（stored）で書く。
// ブラウザでも Node（18 以上）でも動く。

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes, crc = 0xffffffff) {
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return crc;
}

function adler32(bytes) {
  let a = 1, b = 0;
  for (let i = 0; i < bytes.length; i += 5552) {
    const end = Math.min(i + 5552, bytes.length);
    for (let j = i; j < end; j++) { a += bytes[j]; b += a; }
    a %= 65521; b %= 65521;
  }
  return ((b << 16) | a) >>> 0;
}

async function zlibDeflate(bytes) {
  if (typeof CompressionStream === 'function') {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  // 圧縮しない deflate（stored ブロック）。大きくはなるが正しい PNG になる
  const blocks = Math.max(1, Math.ceil(bytes.length / 65535));
  const out = new Uint8Array(2 + bytes.length + blocks * 5 + 4);
  out[0] = 0x78; out[1] = 0x01;
  let o = 2;
  for (let i = 0; i < blocks; i++) {
    const start = i * 65535, len = Math.min(65535, bytes.length - start);
    out[o++] = i === blocks - 1 ? 1 : 0;
    out[o++] = len & 0xff; out[o++] = len >> 8;
    out[o++] = ~len & 0xff; out[o++] = (~len >> 8) & 0xff;
    out.set(bytes.subarray(start, start + len), o); o += len;
  }
  const ad = adler32(bytes);
  out[o++] = ad >>> 24; out[o++] = (ad >>> 16) & 0xff; out[o++] = (ad >>> 8) & 0xff; out[o++] = ad & 0xff;
  return out;
}

// 行ごとにいちばん小さくなりそうなフィルタを選ぶ（符号付きの絶対値の和が小さいもの）
function filterRect(rgba, stride, x, y, w, h) {
  const rowLen = w * 4;
  const out = new Uint8Array((rowLen + 1) * h);
  const cand = [0, 1, 2, 3, 4].map(() => new Uint8Array(rowLen));
  const zero = new Uint8Array(rowLen);
  let prev = zero;
  for (let r = 0; r < h; r++) {
    const s = ((y + r) * stride + x) * 4;
    const cur = rgba.subarray(s, s + rowLen);
    let best = 0, bestSum = Infinity;
    for (let f = 0; f < 5; f++) {
      const c = cand[f];
      let sum = 0;
      for (let i = 0; i < rowLen; i++) {
        const a = i >= 4 ? cur[i - 4] : 0, b = prev[i], cc = i >= 4 ? prev[i - 4] : 0;
        let p;
        if (f === 0) p = 0;
        else if (f === 1) p = a;
        else if (f === 2) p = b;
        else if (f === 3) p = (a + b) >> 1;
        else {
          const pa = Math.abs(b - cc), pb = Math.abs(a - cc), pc = Math.abs(a + b - 2 * cc);
          p = pa <= pb && pa <= pc ? a : pb <= pc ? b : cc;
        }
        const v = (cur[i] - p) & 0xff;
        c[i] = v;
        sum += v < 128 ? v : 256 - v;
        if (sum >= bestSum) break;
      }
      if (sum < bestSum) { bestSum = sum; best = f; }
    }
    // 途中で打ち切った候補もあるので、選んだものだけ最後まで計算しなおす
    const o = r * (rowLen + 1);
    out[o] = best;
    const c = cand[best];
    for (let i = 0; i < rowLen; i++) {
      const a = i >= 4 ? cur[i - 4] : 0, b = prev[i], cc = i >= 4 ? prev[i - 4] : 0;
      let p;
      if (best === 0) p = 0;
      else if (best === 1) p = a;
      else if (best === 2) p = b;
      else if (best === 3) p = (a + b) >> 1;
      else {
        const pa = Math.abs(b - cc), pb = Math.abs(a - cc), pc = Math.abs(a + b - 2 * cc);
        p = pa <= pb && pa <= pc ? a : pb <= pc ? b : cc;
      }
      c[i] = (cur[i] - p) & 0xff;
    }
    out.set(c, o + 1);
    prev = cur;
  }
  return out;
}

// 2つのこまで違う画素を囲む四角。同じなら null
function diffRect(a, b, w, h) {
  const a32 = new Uint32Array(a.buffer, a.byteOffset, w * h);
  const b32 = new Uint32Array(b.buffer, b.byteOffset, w * h);
  let top = -1, bottom = -1;
  for (let y = 0; y < h && top < 0; y++) {
    for (let x = 0, i = y * w; x < w; x++, i++) if (a32[i] !== b32[i]) { top = y; break; }
  }
  if (top < 0) return null;
  for (let y = h - 1; y >= top && bottom < 0; y--) {
    for (let x = 0, i = y * w; x < w; x++, i++) if (a32[i] !== b32[i]) { bottom = y; break; }
  }
  let left = w, right = -1;
  for (let y = top; y <= bottom; y++) {
    const row = y * w;
    for (let x = 0; x < left; x++) if (a32[row + x] !== b32[row + x]) { left = x; break; }
    for (let x = w - 1; x > right; x--) if (a32[row + x] !== b32[row + x]) { right = x; break; }
  }
  return { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
}

function u32(v) { return [v >>> 24, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff]; }
function u16(v) { return [(v >>> 8) & 0xff, v & 0xff]; }

function chunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  out.set(u32(data.length), 0);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  const crc = crc32(out.subarray(4, 8 + data.length)) ^ 0xffffffff;
  out.set(u32(crc >>> 0), 8 + data.length);
  return out;
}

function ihdr(w, h) {
  return chunk('IHDR', new Uint8Array([...u32(w), ...u32(h), 8, 6, 0, 0, 0]));
}

const PNG_SIG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

class ApngEncoder {
  // loops: 0 ＝ずっとくり返す、1 ＝1回再生。fps は表示時間の分母（1こま＝1/fps 秒）
  constructor(width, height, { loops = 0, fps = 24 } = {}) {
    this.w = width; this.h = height; this.loops = loops; this.fps = fps;
    this.frames = []; // { rect, data(圧縮済み), ticks }
    this.prev = null;
    this.still = null; // APNG が動かない所で見せる絵（アニメーションのこまには入らない）
  }

  async setStill(rgba) {
    const bytes = rgba instanceof Uint8Array ? rgba : new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.byteLength);
    this.still = await zlibDeflate(filterRect(bytes, this.w, 0, 0, this.w, this.h));
  }

  // rgba: 幅×高さ×4 の画素（ImageData.data でも Uint8Array でもよい）。ticks: このこまを何こま分見せるか
  async addFrame(rgba, ticks = 1) {
    const bytes = rgba instanceof Uint8Array ? rgba : new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.byteLength);
    let rect;
    if (!this.prev) rect = { x: 0, y: 0, w: this.w, h: this.h };
    else {
      rect = diffRect(this.prev, bytes, this.w, this.h);
      if (!rect) { this.frames[this.frames.length - 1].ticks += ticks; return; }
    }
    const data = await zlibDeflate(filterRect(bytes, this.w, rect.x, rect.y, rect.w, rect.h));
    this.frames.push({ rect, data, ticks });
    this.prev = new Uint8Array(bytes); // 呼び出し側が同じバッファを使い回してもよいように写す
  }

  get frameCount() { return this.frames.length; }

  finish() {
    const parts = [PNG_SIG, ihdr(this.w, this.h)];
    const animated = this.frames.length > 1;
    if (animated) parts.push(chunk('acTL', new Uint8Array([...u32(this.frames.length), ...u32(this.loops)])));
    const still = animated && this.still;
    if (still) parts.push(chunk('IDAT', this.still));
    let seq = 0;
    this.frames.forEach((f, i) => {
      if (animated) {
        // 表示時間は ticks/fps 秒。分子・分母とも 16bit に収める
        let num = f.ticks, den = this.fps;
        while (num > 65535) { num = Math.round(num / 2); den = Math.max(1, Math.round(den / 2)); }
        parts.push(chunk('fcTL', new Uint8Array([
          ...u32(seq++), ...u32(f.rect.w), ...u32(f.rect.h), ...u32(f.rect.x), ...u32(f.rect.y),
          ...u16(num), ...u16(den), 0 /* dispose NONE */, 0 /* blend SOURCE */,
        ])));
      }
      if (i === 0 && !still) parts.push(chunk('IDAT', f.data));
      else {
        const d = new Uint8Array(4 + f.data.length);
        d.set(u32(seq++), 0); d.set(f.data, 4);
        parts.push(chunk('fdAT', d));
      }
    });
    parts.push(chunk('IEND', new Uint8Array(0)));
    let len = 0;
    for (const p of parts) len += p.length;
    const out = new Uint8Array(len);
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }
}

if (typeof module !== 'undefined') module.exports = { ApngEncoder, crc32, diffRect, zlibDeflate };
