// APNG の組み立てだけの試験（Node だけで動く）: node text-apng/test/apng.test.mjs
import { createRequire } from 'node:module';
import { decodeApng } from './apng-decode.mjs';
const require = createRequire(import.meta.url);
const { ApngEncoder } = require('../apng.js');

let fails = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };

const W = 37, H = 23;
// こま: 動く四角。3〜5 こめは同じ絵（1枚にまとまるはず）。最後は全部透明（消える＝退場）
const pics = [];
for (let f = 0; f < 8; f++) {
  const px = new Uint8Array(W * H * 4);
  const k = f >= 3 && f <= 5 ? 3 : f;
  if (f < 7) for (let y = 2; y < 12; y++) for (let x = k * 3; x < k * 3 + 9; x++) {
    const i = (y * W + x) * 4; px[i] = 200; px[i + 1] = 30 + x; px[i + 2] = y * 9; px[i + 3] = 128 + x;
  }
  pics.push(px);
}
const enc = new ApngEncoder(W, H, { loops: 1, fps: 20 });
const buf = new Uint8Array(W * H * 4); // 同じバッファを使い回しても壊れないこと
for (const p of pics) { buf.set(p); await enc.addFrame(buf, 1); }
const png = enc.finish();
const d = decodeApng(png);
ok(d.width === W && d.height === H, '大きさ');
ok(d.numPlays === 1, '1回再生');
ok(d.frames.length === 6, `同じ絵のこまを1枚に（8 → ${d.frames.length}）`);
ok(Math.abs(d.frames[3].delay - 3 / 20) < 1e-9, `まとめたこまの表示時間 ${d.frames[3].delay}`);
const order = [0, 1, 2, 3, 6, 7];
ok(d.frames.every((fr, i) => Buffer.compare(Buffer.from(fr.rgba), Buffer.from(pics[order[i]])) === 0), 'どのこまも元の絵と1画素も違わない');
ok(d.frames.slice(1).every((fr) => fr.rect.w < W || fr.rect.h < H), '2こめからは変わった所の四角だけ');
const total = d.frames.reduce((s, f) => s + f.delay, 0);
ok(Math.abs(total - 8 / 20) < 1e-9, `全体の長さ ${total}`);

// 1こまだけならふつうの PNG（acTL なし）
const e1 = new ApngEncoder(W, H); await e1.addFrame(pics[1]);
const p1 = e1.finish();
ok(!Buffer.from(p1).includes('acTL'), '1こまはふつうの PNG');
ok(decodeApng(p1).frames.length === 1, '1こまを読める');

// CompressionStream が無い環境（stored の deflate）でも読める
const saved = globalThis.CompressionStream; globalThis.CompressionStream = undefined;
const e2 = new ApngEncoder(W, H, { loops: 0, fps: 10 });
for (const p of pics) await e2.addFrame(p);
globalThis.CompressionStream = saved;
const d2 = decodeApng(e2.finish());
ok(d2.numPlays === 0 && d2.frames.length === 6, '圧縮なしの deflate でも読める・ずっとループ');

// 動かない所で見せる絵（完成形）を別に入れる。こまの数・中身は変わらない
const e3 = new ApngEncoder(W, H, { loops: 1, fps: 20 });
for (const p of pics) await e3.addFrame(p);
await e3.setStill(pics[2]);
const d3 = decodeApng(e3.finish());
ok(d3.frames.length === 6 && d3.still && Buffer.compare(Buffer.from(d3.still), Buffer.from(pics[2])) === 0, '動かない所で見せる絵が入り、こまは6枚のまま');
ok(Buffer.compare(Buffer.from(d3.frames[0].rgba), Buffer.from(pics[0])) === 0, 'その時も1こめは元の絵');

console.log(fails ? `\n${fails} 件失敗` : '\nすべて通った');
process.exit(fails ? 1 : 0);
