// 絵で確かめる台本。版を上げるたびに走らせ、前の版の一覧と見比べる。
//   node text-apng/test/shots.mjs [出力フォルダ]（既定は text-apng/test/out。リポジトリには入れない）
// 1. テンプレートごとに「出ている途中・出きった所・消える途中」を描いて、場面ごとに1枚の一覧にする
// 2. 書き出した APNG を読み戻し、こまの絵・表示時間・余白を切った範囲・動かない所の絵を描いた絵と比べる
// 3. 何も覚えていない状態で開いて、エラーなく絵が出るか
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { decodeApng } from './apng-decode.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const outDir = path.resolve(process.argv[2] || path.join(here, 'out'));
fs.mkdirSync(outDir, { recursive: true });

let fails = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };

const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  const f = fs.existsSync(p) && fs.statSync(p).isDirectory() ? path.join(p, 'index.html') : p;
  if (!f.startsWith(root) || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch();
try {
  // ── 3. 何も覚えていない状態 ──
  const ctx0 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx0.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(url);
  await page.waitForFunction(() => window.__textApng);
  await page.evaluate(() => window.__textApng.waitFonts());
  const first = await page.evaluate(() => {
    const A = window.__textApng; A.seek(A.plan.tFull);
    const c = document.getElementById('view'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++;
    return { n, w: c.width, h: c.height, mode: A.store.mode, tpl: A.store.modes[A.store.mode].tpl };
  });
  ok(first.n > 1000 && first.w === 1280 && first.h === 720, `初めて開いた状態で絵が出る（${first.mode}/${first.tpl}、不透明 ${first.n} 画素）`);
  await page.screenshot({ path: path.join(outDir, 'page.png') });
  // スマートフォンの幅でも横にはみ出さない
  await page.setViewportSize({ width: 375, height: 800 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok(overflow <= 0, `幅 375px で横にはみ出さない（${overflow}px）`);
  await page.screenshot({ path: path.join(outDir, 'page-phone.png'), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });

  // 前に直した所（v1.0.0 の作りの途中で絵を見て直した）
  const fixed = await page.evaluate(() => {
    const A = window.__textApng;
    const base = { ...TA_BASE.story, mode: 'story', w: 1280, h: 720, spacing: 0.3, text: 'あ――い……う\n短い', storyPos: 'center', storyAlign: 'left' };
    const p = A.renderAt(base, 0).plan;
    const g = p.glyphs;
    const dash = g[2].x - (g[1].x + g[1].adv), dots = g[5].x - (g[4].x + g[4].adv), other = g[1].x - (g[0].x + g[0].adv);
    const cx = (p.box.x0 + p.box.x1) / 2;
    return { dash, dots, other, cx };
  });
  ok(Math.abs(fixed.dash) < 0.01 && Math.abs(fixed.dots) < 0.01 && fixed.other > 5, `「――」「……」の間はあけない（間 ${fixed.dash.toFixed(2)}・${fixed.dots.toFixed(2)}、ほかの字 ${fixed.other.toFixed(1)}px）`);
  ok(Math.abs(fixed.cx - 640) < 1, `文章を真ん中に置いて左そろえでも、塊は真ん中（中心 x=${fixed.cx.toFixed(1)}）`);

  // ── 1. テンプレートの一覧 ──
  const sheets = await page.evaluate(async () => {
    const A = window.__textApng;
    const out = {}, checks = [];
    const W = 640, H = 360, cols = 3, lab = 22;
    for (const mode of Object.keys(TA_MODES)) {
      A.setMode(mode);
      const tpls = TA_TEMPLATES[mode];
      const sheet = document.createElement('canvas');
      sheet.width = cols * W; sheet.height = tpls.length * (H + lab);
      const g = sheet.getContext('2d');
      g.fillStyle = '#202020'; g.fillRect(0, 0, sheet.width, sheet.height);
      for (let r = 0; r < tpls.length; r++) {
        A.applyTemplate(tpls[r]);
        await A.waitFonts();
        const s = { ...A.settings(), w: 1280, h: 720 };
        const p = A.renderAt(s, 0).plan;
        const mid = p.story ? p.pages[0].start + (p.pages[0].full - p.pages[0].start) * 0.5 : p.tIn * 0.45;
        const outT = p.glyphs.some((gg) => gg.o0 !== undefined) ? Math.min(p.T - 0.02, Math.max(...p.glyphs.map((gg) => gg.o0 ?? 0)) - 0.0 + 0.12) : p.T;
        const ts = [mid, p.tFull, outT];
        ts.forEach((tt, c) => {
          const { canvas } = A.renderAt(s, tt);
          const x = c * W, y = r * (H + lab) + lab;
          g.fillStyle = '#5a5a5a';
          for (let yy = 0; yy < H; yy += 20) for (let xx = 0; xx < W; xx += 20) if (((xx + yy) / 20) % 2) g.fillRect(x + xx, y + yy, 20, 20);
          g.fillStyle = '#7a7a7a';
          for (let yy = 0; yy < H; yy += 20) for (let xx = 0; xx < W; xx += 20) if (!(((xx + yy) / 20) % 2)) g.fillRect(x + xx, y + yy, 20, 20);
          g.drawImage(canvas, x, y, W, H);
          g.fillStyle = '#fff'; g.font = '14px sans-serif';
          g.fillText(`${tpls[r].name}　${['途中', '出きった所', '消える途中'][c]} t=${tt.toFixed(2)} / ${p.T.toFixed(2)}`, x + 6, r * (H + lab) + 16);
          if (c === 1) {
            // 出きった所: 字が全部出て、上下の端で切れていない
            const d = canvas.getContext('2d').getImageData(0, 0, 1280, 720).data;
            let edge = 0, n = 0;
            for (let i = 3; i < d.length; i += 4) if (d[i]) { n++; const yy = ((i - 3) / 4 / 1280) | 0, xx = ((i - 3) / 4) % 1280; if (yy === 0 || yy === 719 || ((xx === 0 || xx === 1279) && !['bar', 'hazard'].includes(s.deco))) edge++; }
            checks.push({ name: `${mode}/${tpls[r].name}`, n, edge, glyphs: p.glyphs.length, T: p.T, fontOk: document.fonts.check(`${TA_FONTS[s.font].weight} 40px "${TA_FONTS[s.font].family}"`, s.text) });
          }
        });
      }
      out[mode] = sheet.toDataURL('image/png');
    }
    return { out, checks };
  });
  // 完成形（静止画・動かない所の絵）には表示中の動き（点滅・震え・ノイズ）が入らない
  const cleanStill = await page.evaluate(() => {
    const A = window.__textApng, bad = [];
    for (const mode of Object.keys(TA_TEMPLATES)) for (const tp of TA_TEMPLATES[mode]) {
      const s = { ...TA_BASE[mode], ...tp.patch, mode, w: 640, h: 360 };
      if (s.idle === 'none') continue;
      const p = A.renderAt(s, 0).plan;
      const a = A.renderAt(s, p.tFull).canvas.toDataURL(), b = A.renderAt({ ...s, idle: 'none' }, p.tFull).canvas.toDataURL();
      if (a !== b) bad.push(tp.name);
    }
    return bad;
  });
  ok(cleanStill.length === 0, `完成形に点滅・震え・ノイズが入らない${cleanStill.length ? '：' + cleanStill.join('・') : ''}`);

  // 横長の帯（800×200）: 出きった所を並べ、字が上下・左右にはみ出さないか
  const banner = await page.evaluate(async () => {
    const A = window.__textApng;
    const W = 800, H = 200, list = [];
    for (const mode of ['cutin', 'telop']) for (const tp of TA_TEMPLATES[mode]) list.push([mode, tp]);
    const sheet = document.createElement('canvas');
    sheet.width = W * 2; sheet.height = Math.ceil(list.length / 2) * H;
    const g = sheet.getContext('2d');
    const bad = [];
    for (let i = 0; i < list.length; i++) {
      const [mode, tp] = list[i];
      A.setMode(mode); A.applyTemplate(tp); await A.waitFonts();
      const s = { ...A.settings(), w: W, h: H };
      const { canvas, plan } = A.renderAt(s, A.renderAt(s, 0).plan.tFull);
      const x = (i % 2) * W, y = Math.floor(i / 2) * H;
      g.fillStyle = (i + Math.floor(i / 2)) % 2 ? '#555' : '#666'; g.fillRect(x, y, W, H);
      g.drawImage(canvas, x, y);
      g.fillStyle = '#ff0'; g.font = '12px sans-serif'; g.fillText(tp.name, x + 4, y + 13);
      for (const gl of plan.glyphs) {
        if (gl.cy - gl.px * 0.5 < 0 || gl.cy + gl.px * 0.5 > H || gl.x < 0 || gl.x + gl.adv > W) { bad.push(`${mode}/${tp.name}`); break; }
      }
    }
    return { png: sheet.toDataURL('image/png'), bad };
  });
  fs.writeFileSync(path.join(outDir, 'sheet-banner.png'), Buffer.from(banner.png.split(',')[1], 'base64'));
  ok(banner.bad.length === 0, `800×200 の帯で字がはみ出さない${banner.bad.length ? '：' + banner.bad.join('・') : ''}`);

  for (const [mode, data] of Object.entries(sheets.out)) {
    fs.writeFileSync(path.join(outDir, `sheet-${mode}.png`), Buffer.from(data.split(',')[1], 'base64'));
  }
  for (const c of sheets.checks) {
    ok(c.n > 500 && c.edge === 0 && c.glyphs > 0 && c.T > 0.3 && c.fontOk,
      `${c.name}: 字 ${c.glyphs}・${c.T.toFixed(2)} 秒・不透明 ${c.n} 画素・端に触れる ${c.edge}・フォント ${c.fontOk ? '読めた' : '読めない'}`);
  }

  // ── 2. 書き出しを読み戻す ──
  const exportCase = async (label, mode, tplId, exp) => {
    const res = await page.evaluate(async ({ mode, tplId, exp }) => {
      const A = window.__textApng;
      A.setMode(mode);
      A.applyTemplate(TA_TEMPLATES[mode].find((x) => x.id === tplId));
      Object.assign(A.store.exp, exp);
      A.rebuild();
      await A.waitFonts();
      const r = await A.runExport();
      // 期待する絵: 同じ時刻を別に描き、同じ範囲を切り出す
      const s = A.settings();
      const enc = (canvas) => {
        const d = canvas.getContext('2d').getImageData(r.crop.x, r.crop.y, r.crop.w, r.crop.h).data;
        let bin = ''; for (let i = 0; i < d.length; i += 8192) bin += String.fromCharCode(...d.subarray(i, i + 8192));
        return btoa(bin);
      };
      const expect = r.times.map((tt) => enc(A.renderAt(s, tt).canvas));
      const still = enc(A.renderAt(s, r.plan.tFull).canvas);
      // ブラウザ自身が読めるか
      const img = new Image();
      const blobUrl = URL.createObjectURL(new Blob([r.bytes], { type: 'image/png' }));
      await new Promise((ok, ng) => { img.onload = ok; img.onerror = ng; img.src = blobUrl; });
      let bin = ''; for (let i = 0; i < r.bytes.length; i += 8192) bin += String.fromCharCode(...r.bytes.subarray(i, i + 8192));
      return { png: btoa(bin), expect, still, crop: r.crop, fps: A.store.exp.fps, loop: s.loop, natural: [img.naturalWidth, img.naturalHeight], full: [s.w, s.h] };
    }, { mode, tplId, exp });
    const buf = Buffer.from(res.png, 'base64');
    fs.writeFileSync(path.join(outDir, `export-${label}.png`), buf);
    const d = decodeApng(buf);
    const expect = res.expect.map((b) => Buffer.from(b, 'base64'));
    // 続けて同じ絵のこまは1枚にまとまるはず
    const groups = [];
    expect.forEach((e) => { const last = groups[groups.length - 1]; if (last && Buffer.compare(last.px, e) === 0) last.n++; else groups.push({ px: e, n: 1 }); });
    ok(d.width === res.crop.w && d.height === res.crop.h && res.natural[0] === d.width && res.natural[1] === d.height, `${label}: 大きさ ${d.width}×${d.height}（ブラウザでも読める）`);
    ok(d.frames.length === groups.length, `${label}: こま ${expect.length} → まとめて ${d.frames.length}（期待 ${groups.length}）`);
    let same = d.frames.length === groups.length;
    let delays = same;
    if (same) d.frames.forEach((f, i) => {
      if (Buffer.compare(Buffer.from(f.rgba), groups[i].px) !== 0) same = false;
      if (Math.abs(f.delay - groups[i].n / res.fps) > 1e-6) delays = false;
    });
    ok(same, `${label}: どのこまも描いた絵と1画素も違わない`);
    ok(delays, `${label}: 表示時間が合う（全体 ${d.frames.reduce((a, f) => a + f.delay, 0).toFixed(2)} 秒）`);
    ok(d.numPlays === (res.loop === 'infinite' ? 0 : 1), `${label}: 再生の回数 ${d.numPlays === 0 ? 'ずっと' : d.numPlays + ' 回'}`);
    return { d, res };
  };
  const a = await exportCase('battle', 'cutin', 'battle', { w: 480, h: 270, fps: 12, trim: false, still: true, fmt: 'apng' });
  ok(a.d.still && Buffer.compare(Buffer.from(a.d.still), Buffer.from(a.res.still, 'base64')) === 0, 'battle: 動かない所の絵が完成形と同じ');
  const lastF = a.d.frames[a.d.frames.length - 1].rgba;
  ok(lastF.every((v, i) => i % 4 !== 3 || v === 0), 'battle: 退場ありの最後のこまは全部透明');
  const b = await exportCase('place-trim', 'telop', 'place', { w: 640, h: 360, fps: 15, trim: true, still: false, fmt: 'apng' });
  ok(b.d.width < 640 && b.d.height < 360 && !b.d.still, `place-trim: 余白を切った（${b.d.width}×${b.d.height}）・動かない所の絵なし`);
  const c = await exportCase('break-loop', 'cutin', 'break', { w: 320, h: 180, fps: 12, trim: false, still: false, fmt: 'apng' });
  const lastC = c.d.frames[c.d.frames.length - 1].rgba;
  ok(lastC.some((v, i) => i % 4 === 3 && v > 0), 'break-loop: 退場なしの最後のこまは字が残る');
  await exportCase('story', 'story', 'window', { w: 480, h: 270, fps: 12, trim: false, still: false, fmt: 'apng' });

  // ── 4. 画面を触ってたどる（本物のクリックと入力） ──
  const p2 = await ctx0.newPage();
  p2.on('pageerror', (e) => errors.push(String(e)));
  await p2.goto(url);
  await p2.waitForFunction(() => window.__textApng);
  await p2.getByRole('button', { name: 'テロップ', exact: true }).click();
  await p2.getByRole('button', { name: '時刻', exact: true }).click();
  await p2.locator('#c_text').fill('PM 11:45');
  await p2.getByRole('tab', { name: '動き' }).click();
  await p2.locator('#c_idle').selectOption('blink');
  ok(await p2.locator('#c_blinkSec').isVisible(), '点滅を選ぶと「点滅の速さ」が出る');
  await p2.locator('#sizePreset').selectOption('800x200');
  await p2.locator('#fps').selectOption('12');
  await p2.getByRole('button', { name: '書き出す' }).click();
  await p2.locator('#result.on').waitFor({ timeout: 60000 });
  const res = await p2.evaluate(async () => {
    const img = document.getElementById('thumb');
    await img.decode();
    return { name: document.getElementById('dl').download, href: document.getElementById('dl').href, w: img.naturalWidth, h: img.naturalHeight, info: document.getElementById('resInfo').textContent };
  });
  ok(res.href.startsWith('blob:') && res.name === 'PM_11_45.png' && res.w === 800 && res.h === 200, `書き出して保存のリンクが出る（${res.info}）`);
  await p2.screenshot({ path: path.join(outDir, 'page-exported.png') });
  await p2.reload();
  await p2.waitForFunction(() => window.__textApng);
  const kept = await p2.evaluate(() => ({ mode: window.__textApng.store.mode, text: document.getElementById('c_text') ? null : window.__textApng.settings().text, idle: window.__textApng.settings().idle, w: window.__textApng.settings().w }));
  ok(kept.mode === 'telop' && kept.idle === 'blink' && kept.w === 800, `開きなおしても覚えている（${kept.mode}・${kept.idle}・幅 ${kept.w}）`);

  ok(errors.length === 0, `エラーなし${errors.length ? '：' + errors.join(' / ') : ''}`);
  await ctx0.close();
} finally {
  await browser.close();
  server.close();
}
console.log(`\n一覧: ${outDir}`);
console.log(fails ? `${fails} 件失敗` : 'すべて通った');
process.exit(fails ? 1 : 0);
