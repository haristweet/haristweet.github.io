// 試験用の APNG の読み戻し。チャンクの CRC・順番の番号を確かめ、こまごとの絵（全面の RGBA）と表示時間を返す。
// 色は RGBA 8bit（このツールが書く形）だけを読む。
import { inflateSync } from 'node:zlib';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (b) => {
  let c = 0xffffffff;
  for (const x of b) c = CRC_TABLE[(c ^ x) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

function unfilter(raw, w, h) {
  const rowLen = w * 4, out = new Uint8Array(rowLen * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (rowLen + 1)], src = y * (rowLen + 1) + 1, dst = y * rowLen;
    for (let i = 0; i < rowLen; i++) {
      const a = i >= 4 ? out[dst + i - 4] : 0, b = y ? out[dst - rowLen + i] : 0, c = y && i >= 4 ? out[dst - rowLen + i - 4] : 0;
      let p = 0;
      if (f === 1) p = a; else if (f === 2) p = b; else if (f === 3) p = (a + b) >> 1;
      else if (f === 4) { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      else if (f !== 0) throw new Error('unknown filter ' + f);
      out[dst + i] = (raw[src + i] + p) & 0xff;
    }
  }
  return out;
}

export function decodeApng(buf) {
  const u8 = new Uint8Array(buf);
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  sig.forEach((v, i) => { if (u8[i] !== v) throw new Error('not png'); });
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let o = 8, W = 0, H = 0, numFrames = 1, numPlays = null, seqExpect = 0;
  const chunks = [];
  while (o < u8.length) {
    const len = dv.getUint32(o), type = String.fromCharCode(...u8.subarray(o + 4, o + 8));
    const data = u8.subarray(o + 8, o + 8 + len);
    if (crc32(u8.subarray(o + 4, o + 8 + len)) !== dv.getUint32(o + 8 + len)) throw new Error('crc ' + type);
    chunks.push({ type, data });
    o += 12 + len;
    if (type === 'IEND') break;
  }
  const frames = [];
  let cur = null, idatSeen = false, still = null;
  for (const { type, data } of chunks) {
    const d = new DataView(data.buffer, data.byteOffset, data.byteLength);
    if (type === 'IHDR') {
      W = d.getUint32(0); H = d.getUint32(4);
      if (data[8] !== 8 || data[9] !== 6) throw new Error('not rgba8');
    } else if (type === 'acTL') { numFrames = d.getUint32(0); numPlays = d.getUint32(4); }
    else if (type === 'fcTL') {
      if (d.getUint32(0) !== seqExpect++) throw new Error('seq fcTL');
      cur = { w: d.getUint32(4), h: d.getUint32(8), x: d.getUint32(12), y: d.getUint32(16),
        delay: d.getUint16(20) / (d.getUint16(22) || 100), dispose: data[24], blend: data[25], parts: [] };
      if (cur.x + cur.w > W || cur.y + cur.h > H) throw new Error('frame outside');
      frames.push(cur);
    } else if (type === 'IDAT') {
      idatSeen = true;
      if (cur) cur.parts.push(data);
      else if (numPlays !== null) (still = still || []).push(data); // fcTL より前の IDAT はアニメーションに入らない絵
      else frames.push(cur = { w: W, h: H, x: 0, y: 0, delay: 0, dispose: 0, blend: 0, parts: [data] });
    } else if (type === 'fdAT') {
      if (d.getUint32(0) !== seqExpect++) throw new Error('seq fdAT');
      cur.parts.push(data.subarray(4));
    }
  }
  if (!idatSeen) throw new Error('no IDAT');
  if (numPlays !== null && frames.length !== numFrames) throw new Error(`acTL says ${numFrames}, found ${frames.length}`);
  if (frames[0].x || frames[0].y || frames[0].w !== W || frames[0].h !== H) throw new Error('first frame must be full');
  // 画面を重ねていく
  const canvas = new Uint8Array(W * H * 4);
  const out = [];
  for (const f of frames) {
    const raw = inflateSync(Buffer.concat(f.parts.map((p) => Buffer.from(p))));
    const px = unfilter(raw, f.w, f.h);
    if (f.blend !== 0 || f.dispose !== 0) throw new Error('unexpected dispose/blend');
    for (let y = 0; y < f.h; y++) canvas.set(px.subarray(y * f.w * 4, (y + 1) * f.w * 4), ((f.y + y) * W + f.x) * 4);
    out.push({ rgba: new Uint8Array(canvas), delay: f.delay, rect: { x: f.x, y: f.y, w: f.w, h: f.h } });
  }
  const stillRgba = still ? unfilter(inflateSync(Buffer.concat(still.map((p) => Buffer.from(p)))), W, H) : null;
  return { width: W, height: H, numPlays, frames: out, still: stillRgba };
}
