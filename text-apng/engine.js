// 文字の並べ方・時間割・描き方。時刻 t を渡すとその時刻の絵を描く（乱数も時刻と文字の番号から作るので、
// プレビューと書き出しの絵は同じになる）。
// 文字は1字ずつ「光彩と影」「縁取り」「塗り」の3枚の小さな絵にしておき、3回に分けて重ねる
// （下の層は上の層の形でくり抜いておくので、薄くなっている途中でも下の層が透けない）。

const TA_FONTS = {
  noto:    { label: 'ゴシック（Noto Sans JP）', family: 'Noto Sans JP', weight: 900 },
  serif:   { label: '明朝（Noto Serif JP）', family: 'Noto Serif JP', weight: 900 },
  shippori:{ label: '太い明朝（しっぽり明朝 B1）', family: 'Shippori Mincho B1', weight: 800 },
  dela:    { label: '極太（Dela Gothic One）', family: 'Dela Gothic One', weight: 400 },
  rocknroll:{ label: 'ロックンロール（RocknRoll One）', family: 'RocknRoll One', weight: 400 },
  reggae:  { label: 'レゲエ（Reggae One）', family: 'Reggae One', weight: 400 },
  rounded: { label: '丸ゴシック（M PLUS Rounded 1c）', family: 'M PLUS Rounded 1c', weight: 800 },
  mochiy:  { label: 'ポップ（Mochiy Pop One）', family: 'Mochiy Pop One', weight: 400 },
  hachi:   { label: '手書き（Hachi Maru Pop）', family: 'Hachi Maru Pop', weight: 400 },
  yuji:    { label: '筆（Yuji Syuku）', family: 'Yuji Syuku', weight: 400 },
  antique: { label: '古風（Zen Antique）', family: 'Zen Antique', weight: 400 },
  kurenaido:{ label: '筆ペン（Zen Kurenaido）', family: 'Zen Kurenaido', weight: 400 },
  dot:     { label: 'ドット（DotGothic16）', family: 'DotGothic16', weight: 400 },
  cinzel:  { label: '欧文・碑文（Cinzel）', family: 'Cinzel', weight: 900 },
  orbitron:{ label: '欧文・SF（Orbitron）', family: 'Orbitron', weight: 900 },
};
const TA_FALLBACK = '"Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans JP","Yu Gothic",sans-serif';

function taFont(s, px) {
  const f = TA_FONTS[s.font] || TA_FONTS.noto;
  return `${f.weight} ${px}px "${f.family}",${TA_FALLBACK}`;
}

// 整数のハッシュから 0〜1 の数（どのブラウザでも同じ値になる）
function taRand(a, b = 0) {
  let h = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul((b | 0) + 0x7f4a7c15, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

const taClamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const taOutCubic = (p) => 1 - Math.pow(1 - p, 3);
const taOutBack = (p) => { const c = 1.70158; return 1 + (c + 1) * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2); };
const taOutBounce = (p) => {
  const n = 7.5625, d = 2.75;
  if (p < 1 / d) return n * p * p;
  if (p < 2 / d) return n * (p -= 1.5 / d) * p + 0.75;
  if (p < 2.5 / d) return n * (p -= 2.25 / d) * p + 0.9375;
  return n * (p -= 2.625 / d) * p + 0.984375;
};

const TA_ANIMS = {
  none:   '出し方なし（最初から表示）',
  fade:   'フェード',
  type:   '1文字ずつパッと',
  pop:    '大きくして着地',
  slide:  '横から滑りこむ',
  spread: '字の間が縮まる',
  blur:   'ぼかしから浮かぶ',
  drop:   '上から落ちて弾む',
  zoom:   '奥から近づく',
  zip:    '上下から合流',
};

// 1字の出し方。p は 0（出る前）〜1（出きった）。em は字の大きさ（px）
function taAnimState(anim, p, g, em, s) {
  const st = { a: 1, dx: 0, dy: 0, sc: 1, blur: 0 };
  if (p >= 1 || anim === 'none') return st;
  if (p <= 0) { st.a = 0; return st; }
  const e = taOutCubic(p);
  switch (anim) {
    case 'fade': st.a = e; break;
    case 'type': st.a = 1; break;
    case 'pop': st.sc = 2.4 - 1.4 * taOutBack(p); st.a = taClamp(p * 3); break;
    case 'slide': {
      const d = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] }[s.dir] || [-1, 0];
      st.dx = d[0] * (1 - e) * em * 1.6; st.dy = d[1] * (1 - e) * em * 1.6; st.a = e; break;
    }
    case 'spread': st.dx = (g.cx - g.lineCx) * 1.4 * (1 - e); st.a = e; break;
    case 'blur': st.blur = (1 - e) * em * 0.3; st.a = e; st.sc = 1 + 0.12 * (1 - e); break;
    case 'drop': st.dy = -(1 - taOutBounce(p)) * em * 2.2; st.a = taClamp(p * 4); break;
    case 'zoom': st.sc = 0.15 + 0.85 * e; st.a = e; break;
    case 'zip': st.dy = (g.i % 2 ? 1 : -1) * (1 - e) * em * 1.3; st.a = e; break;
  }
  return st;
}

// ── 並べ方 ────────────────────────────────────────────

const TA_NO_START = '、。，．・：；？！ー―…‥〜）」』】〕〉》｝’”ゝゞぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ,.!?)]}';
const TA_NO_END = '（「『【〔〈《｛‘“([{';

function taMeasure(ctx, s, px) {
  ctx.font = taFont(s, px);
  const cache = new Map();
  return (ch) => {
    let v = cache.get(ch);
    if (v === undefined) { v = ctx.measureText(ch).width; cache.set(ch, v); }
    return v;
  };
}

const TA_DASH = '―—─━〜～…‥';

// 1行を字ごとの位置に。返す x は行の左端からの位置。
// 「――」「……」のように続けて1つの記号になる字の間には、字の間をあけない
function taLineCells(chars, adv, spacing) {
  const cells = [];
  let x = 0;
  chars.forEach((ch, k) => {
    const a = adv(ch);
    cells.push({ ch, x, adv: a });
    const joined = k < chars.length - 1 && ch === chars[k + 1] && TA_DASH.includes(ch);
    x += a + (k < chars.length - 1 && !joined ? spacing : 0);
  });
  return { cells, width: x };
}

function taWrap(text, adv, spacing, maxW) {
  const out = [];
  for (const para of text.split('\n')) {
    const chars = [...para];
    let line = [], w = 0;
    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i], a = adv(ch);
      const add = (line.length ? spacing : 0) + a;
      if (line.length && w + add > maxW && !TA_NO_START.includes(ch)) {
        // 行末に置けない字（開きかっこ）は次の行へ送る
        let carry = [];
        while (line.length > 1 && TA_NO_END.includes(line[line.length - 1])) carry.unshift(line.pop());
        out.push(line.join(''));
        line = carry; w = taLineCells(line, adv, spacing).width;
      }
      line.push(ch); w = taLineCells(line, adv, spacing).width;
    }
    out.push(line.join(''));
  }
  return out;
}

// 字の塊（行の並び）を作る。返す glyph の位置は塊の左上を (0,0) とする
function taBlock(ctx, s, text, px, align, maxW, wrap) {
  const spacing = s.spacing * px;
  const adv = taMeasure(ctx, s, px);
  const lines = wrap ? taWrap(text, adv, spacing, maxW) : text.split('\n');
  const rows = lines.map((l) => taLineCells([...l], adv, spacing));
  const width = Math.max(0, ...rows.map((r) => r.width));
  const lh = px * (1 + s.lineGap);
  return { rows, width, height: rows.length ? lh * (rows.length - 1) + px : 0, lh, px, align };
}

function taPlaceBlock(block, x0, y0, kind, glyphs, lineBase) {
  block.rows.forEach((row, r) => {
    const off = block.align === 'left' ? 0 : block.align === 'right' ? block.width - row.width : (block.width - row.width) / 2;
    const cy = y0 + block.px / 2 + r * block.lh;
    const lineCx = x0 + off + row.width / 2;
    row.cells.forEach((c) => {
      if (/\s/.test(c.ch)) return; // 空白は描かない（時間割では数えない）
      const x = x0 + off + c.x;
      glyphs.push({ ch: c.ch, x, cx: x + c.adv / 2, cy, adv: c.adv, px: block.px, kind, line: lineBase + r, lineCx });
    });
  });
  return { x0, y0, x1: x0 + block.width, y1: y0 + block.height };
}

function taUnion(a, b) {
  if (!a) return b; if (!b) return a;
  return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
}

// 字の塊を、画像に入りきる大きさまで縮める
function taFitBlock(ctx, s, text, px, align, maxW, maxH, wrap) {
  let b = taBlock(ctx, s, text, px, align, maxW, wrap);
  for (let k = 0; k < 12 && (b.width > maxW || b.height > maxH) && px > 4; k++) {
    const f = Math.min(maxW / Math.max(1, b.width), maxH / Math.max(1, b.height), 0.94);
    px = Math.max(4, px * (wrap ? Math.max(f, 0.9) : f));
    b = taBlock(ctx, s, text, px, align, maxW, wrap);
  }
  return b;
}

const TA_POS = {
  center: { ax: 0.5, ay: 0.5, align: 'center' },
  top:    { ax: 0.5, ay: 0, align: 'center' },
  bottom: { ax: 0.5, ay: 1, align: 'center' },
  tl:     { ax: 0, ay: 0, align: 'left' },
  bl:     { ax: 0, ay: 1, align: 'left' },
  tr:     { ax: 1, ay: 0, align: 'right' },
  br:     { ax: 1, ay: 1, align: 'right' },
};

// ── 時間割 ────────────────────────────────────────────

const TA_DECO_IN = 0.35;   // 飾りが出る時間（秒）
const TA_PAGE_OUT = 0.4;   // 文章モードでページが消える時間

// 字の大きさの基準。16:9 の画像では高さと同じで、横長・縦長の画像では面積が同じ 16:9 の高さ
// （800×200 の帯でも字が小さくなりすぎない。入りきらなければ taFitBlock が縮める）
function taUnit(W, H) { return Math.sqrt((W * H * 9) / 16); }

function taPlan(ctx, s) {
  const W = s.w, H = s.h, m = Math.min(W, H), U = taUnit(W, H);
  const glyphs = [];
  const plan = { s, W, H, glyphs, pages: [], em: 0 };
  if (s.mode === 'story') return taPlanStory(ctx, s, plan);

  const pos = TA_POS[s.pos] || TA_POS.center;
  const marginX = pos.ax === 0.5 ? W * 0.04 : m * 0.07, marginY = m * 0.08;
  const maxW = W - marginX * 2;
  const hasSub = !!(s.sub || '').trim();
  const main = taFitBlock(ctx, s, s.text || '', (s.size / 100) * U, pos.align, maxW, H * (hasSub ? 0.6 : 0.8), false);
  const sub = hasSub ? taFitBlock(ctx, s, s.sub, (s.subSize / 100) * U, pos.align, maxW, H * 0.2, false) : null;
  const gap = sub ? Math.max(main.px, sub.px) * 0.3 : 0;
  const bw = Math.max(main.width, sub ? sub.width : 0);
  const bh = main.height + (sub ? gap + sub.height : 0);
  const bx = pos.ax === 0 ? marginX : pos.ax === 1 ? W - marginX - bw : (W - bw) / 2;
  const by = pos.ay === 0 ? marginY : pos.ay === 1 ? H - marginY - bh : (H - bh) / 2;
  const subFirst = sub && s.subPos === 'above';
  const offX = (b) => (pos.align === 'left' ? 0 : pos.align === 'right' ? bw - b.width : (bw - b.width) / 2);
  let yMain = by, ySub = by + main.height + gap;
  if (subFirst) { ySub = by; yMain = by + sub.height + gap; }
  const rMain = taPlaceBlock(main, bx + offX(main), yMain, 'main', glyphs, 0);
  let rAll = rMain;
  if (sub) rAll = taUnion(rMain, taPlaceBlock(sub, bx + offX(sub), ySub, 'sub', glyphs, main.rows.length));
  plan.box = rAll; plan.mainBox = rMain; plan.em = main.px; plan.align = pos.align;

  // 主の文 → 副の文の順に1字ずつ
  glyphs.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'main' ? -1 : 1));
  glyphs.forEach((g, i) => { g.i = i; });
  const animIn = s.inOn ? s.anim : 'none';
  const instant = animIn === 'none';
  const dur = instant ? 0 : animIn === 'type' ? 0.001 : s.inDur;
  const stagger = instant || animIn === 'spread' ? 0 : s.stagger;
  const deco = s.deco !== 'none';
  const delay = deco && !instant ? TA_DECO_IN * 0.6 : 0;
  glyphs.forEach((g, i) => { g.t0 = delay + i * stagger; g.dur = dur; });
  const n = glyphs.length;
  const tIn = instant ? 0 : Math.max(deco ? TA_DECO_IN : 0, delay + Math.max(0, n - 1) * stagger + dur);
  const tOut = tIn + s.hold;
  plan.animIn = animIn;
  plan.animOut = s.anim === 'type' || s.anim === 'none' ? 'fade' : s.anim;
  plan.tIn = tIn; plan.tOut = tOut; plan.tFull = tIn;
  plan.decoIn = [0, instant ? 0 : TA_DECO_IN];
  if (s.outOn) {
    const os = stagger * 0.4;
    glyphs.forEach((g, i) => { g.o0 = tOut + i * os; g.odur = s.outDur; });
    const textEnd = tOut + Math.max(0, n - 1) * os + s.outDur;
    plan.decoOut = [Math.max(tOut, textEnd - TA_DECO_IN * 0.5), textEnd + (deco ? TA_DECO_IN * 0.5 : 0)];
    plan.T = Math.max(textEnd, plan.decoOut[1]);
  } else {
    plan.T = tOut;
  }
  plan.T = Math.max(plan.T, 0.05);
  plan.idle = [tIn, tOut];
  return plan;
}

function taPlanStory(ctx, s, plan) {
  const W = s.w, H = s.h, m = Math.min(W, H);
  const bottom = s.storyPos === 'bottom';
  const align = s.storyAlign === 'center' ? 'center' : 'left';
  // 下の窓: 横いっぱい（余白つき）・高さは画像の 30%。中央: 画像の 84%×84%
  const pad = m * 0.05;
  const win = bottom
    ? { x0: W * 0.05, y0: H * 0.66, x1: W * 0.95, y1: H * 0.94 }
    : { x0: W * 0.08, y0: H * 0.08, x1: W * 0.92, y1: H * 0.92 };
  const maxW = win.x1 - win.x0 - pad * 2, maxH = win.y1 - win.y0 - pad * 2;
  const pagesText = (s.text || '').replace(/\r/g, '').split(/\n[ \t　]*\n/).map((p) => p.replace(/^\n+|\n+$/g, '')).filter((p) => p.trim());
  if (!pagesText.length) pagesText.push('');
  // どのページも同じ字の大きさにする（いちばん長いページに合わせる）
  let px = (s.size / 100) * taUnit(W, H);
  for (const p of pagesText) px = Math.min(px, taFitBlock(ctx, s, p, px, align, maxW, maxH, true).px);
  const cps = Math.max(1, s.cps);
  const animIn = s.inOn ? s.anim : 'none';
  const dur = animIn === 'none' ? 0 : animIn === 'type' ? 0.001 : Math.min(s.inDur, 0.6);
  let t = 0, gi = 0, box = null;
  pagesText.forEach((txt, pi) => {
    const b = taBlock(ctx, s, txt, px, align, maxW, true);
    // 真ん中に置くときは塊を真ん中に（行のそろえは塊の中で）。下の窓では左の余白から
    const x0 = !bottom || align === 'center' ? (win.x0 + win.x1 - b.width) / 2 : win.x0 + pad;
    const y0 = bottom ? win.y0 + pad : (win.y0 + win.y1 - b.height) / 2;
    const first = plan.glyphs.length;
    box = taUnion(box, taPlaceBlock(b, x0, y0, 'main', plan.glyphs, 0));
    const pageG = plan.glyphs.slice(first);
    const start = t + (pi === 0 && s.deco !== 'none' && animIn !== 'none' ? TA_DECO_IN * 0.6 : 0);
    // 1字ずつ。行が変わるところで少し待つ
    let k = 0, line = pageG.length ? pageG[0].line : 0;
    pageG.forEach((g) => {
      if (g.line !== line) { k += 3; line = g.line; }
      g.i = gi++; g.page = pi;
      g.t0 = animIn === 'none' ? start : start + k / cps; g.dur = dur;
      k++;
    });
    const full = pageG.length ? Math.max(...pageG.map((g) => g.t0 + g.dur)) : start;
    const end = full + s.hold;
    const last = pi === pagesText.length - 1;
    const page = { start: t, full, end, last };
    if (!last || s.outOn) {
      pageG.forEach((g) => { g.o0 = end; g.odur = TA_PAGE_OUT; });
      page.gone = end + TA_PAGE_OUT;
      t = page.gone + 0.15;
    } else t = end;
    plan.pages.push(page);
  });
  const lastPage = plan.pages[plan.pages.length - 1];
  plan.T = Math.max(0.05, s.outOn ? lastPage.gone + (s.deco !== 'none' ? TA_DECO_IN * 0.5 : 0) : lastPage.end);
  plan.box = s.deco === 'box' || s.deco === 'frame' ? win : box || win;
  plan.mainBox = plan.box;
  plan.em = px; plan.align = align;
  plan.animIn = animIn; plan.animOut = 'fade';
  plan.tFull = lastPage.full;
  plan.tIn = plan.pages[0].full;
  plan.decoIn = [0, animIn === 'none' ? 0 : TA_DECO_IN];
  if (s.outOn) plan.decoOut = [lastPage.end, plan.T];
  plan.idle = [0, s.outOn ? lastPage.end : plan.T];
  plan.story = true;
  return plan;
}

// ── 1字の絵（3枚） ──────────────────────────────────

// ページの canvas を使う（読み込んだ Web フォントが確実に効くように）。ページが無い所だけ OffscreenCanvas
function taCanvas(w, h) {
  if (typeof document === 'undefined') return new OffscreenCanvas(Math.max(1, w), Math.max(1, h));
  const c = document.createElement('canvas'); c.width = Math.max(1, w); c.height = Math.max(1, h); return c;
}

function taStyleKey(s) {
  return [s.font, s.italic, s.fill, s.grad, s.fill2, s.subColor, s.stroke, s.strokeW, s.glow, s.glowW,
    s.shadow, s.shadowD, s.shadowB].join('|');
}

function taSprite(cache, s, g) {
  const key = `${g.kind}|${g.ch}|${g.px.toFixed(2)}`;
  let sp = cache.get(key);
  if (sp) return sp;
  const px = g.px;
  const sw = (s.strokeW / 100) * px, gw = (s.glowW / 100) * px;
  const sd = (s.shadowD / 100) * px, sb = (s.shadowB / 100) * px;
  const slant = s.italic ? 0.2 : 0;
  const pad = Math.ceil(sw + gw * 1.6 + Math.max(sd + sb * 1.4, 0) + px * (0.12 + slant * 0.6) + 2);
  const w = Math.ceil(g.adv + pad * 2), h = Math.ceil(px * 1.3 + pad * 2);
  const ox = pad, oy = pad + px * 0.65; // 字の左端・上下の中ほど
  const shape = (withStroke) => {
    const c = taCanvas(w, h), x = c.getContext('2d');
    x.font = taFont(s, px); x.textBaseline = 'middle'; x.textAlign = 'left';
    x.lineJoin = 'round'; x.miterLimit = 2;
    x.setTransform(1, 0, -slant, 1, slant * oy, 0);
    x.fillStyle = x.strokeStyle = '#fff';
    if (withStroke && sw > 0) { x.lineWidth = sw * 2; x.strokeText(g.ch, ox, oy); }
    x.fillText(g.ch, ox, oy);
    return c;
  };
  const fillMask = shape(false), outerMask = sw > 0 ? shape(true) : fillMask;
  const tint = (mask, style) => {
    const c = taCanvas(w, h), x = c.getContext('2d');
    x.drawImage(mask, 0, 0);
    x.globalCompositeOperation = 'source-in';
    x.fillStyle = style; x.fillRect(0, 0, w, h);
    return { c, x };
  };
  // 塗り
  const baseFill = g.kind === 'sub' && s.subColor ? s.subColor : s.fill;
  let fillStyle = baseFill;
  if (s.grad && !(g.kind === 'sub' && s.subColor)) {
    const tmp = taCanvas(1, 1).getContext('2d');
    const gr = tmp.createLinearGradient(0, oy - px * 0.5, 0, oy + px * 0.5);
    gr.addColorStop(0, s.fill); gr.addColorStop(1, s.fill2);
    fillStyle = gr;
  }
  const L2 = tint(fillMask, fillStyle).c;
  // 縁取り（塗りの形でくり抜く）
  let L1 = null;
  if (sw > 0) {
    const t = tint(outerMask, s.stroke);
    t.x.globalCompositeOperation = 'destination-out'; t.x.drawImage(fillMask, 0, 0);
    L1 = t.c;
  }
  // 光彩と影（外形でくり抜く）。形そのものは画面の外に描き、影だけを持ってくる
  let L0 = null;
  if (gw > 0 || sd > 0 || sb > 0) {
    const c = taCanvas(w, h), x = c.getContext('2d');
    const far = w + h + 1000;
    if (sd > 0 || sb > 0) {
      x.shadowColor = s.shadow; x.shadowBlur = sb; x.shadowOffsetX = far + sd; x.shadowOffsetY = sd;
      x.drawImage(outerMask, -far, 0);
    }
    if (gw > 0) {
      x.shadowColor = s.glow; x.shadowBlur = gw; x.shadowOffsetX = far; x.shadowOffsetY = 0;
      x.drawImage(outerMask, -far, 0); x.drawImage(outerMask, -far, 0);
    }
    x.shadowColor = 'transparent';
    x.globalCompositeOperation = 'destination-out'; x.drawImage(outerMask, 0, 0);
    L0 = c;
  }
  sp = { layers: [L0, L1, L2], ox, oy, w, h };
  cache.set(key, sp);
  return sp;
}

let taFilterOk = null;
function taCanBlur(ctx) {
  if (taFilterOk === null) {
    try { const c = taCanvas(4, 4).getContext('2d'); c.filter = 'blur(1px)'; taFilterOk = c.filter === 'blur(1px)'; } catch (e) { taFilterOk = false; }
  }
  return taFilterOk && 'filter' in ctx;
}

function taDrawSprite(ctx, img, x, y, blur) {
  if (blur > 0.4) {
    if (taCanBlur(ctx)) {
      ctx.filter = `blur(${blur.toFixed(2)}px)`;
      ctx.drawImage(img, x, y);
      ctx.filter = 'none';
      return;
    }
    // ctx.filter が無いブラウザ: 縮めてから拡げてぼかす
    const f = Math.max(1, blur / 1.2);
    const tw = Math.max(1, Math.round(img.width / f)), th = Math.max(1, Math.round(img.height / f));
    const t = taCanvas(tw, th), tx = t.getContext('2d');
    tx.imageSmoothingQuality = 'high';
    tx.drawImage(img, 0, 0, tw, th);
    ctx.drawImage(t, x, y, img.width, img.height);
    return;
  }
  ctx.drawImage(img, x, y);
}

// ── 飾り ──────────────────────────────────────────────

const TA_DECOS = {
  none: 'なし', bar: '帯', lines: '上下の線', frame: '枠', box: '塗った箱', side: '縦の棒と下線', hazard: '警告のしま',
};

function taRoundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

function taDrawDeco(ctx, plan, e, t) {
  const s = plan.s;
  if (s.deco === 'none' || e <= 0) return;
  const b = plan.box, em = plan.em, W = plan.W;
  const th = Math.max(1.5, (s.decoSize / 100) * em);
  const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
  ctx.save();
  ctx.fillStyle = ctx.strokeStyle = s.decoColor;
  ctx.globalAlpha = s.decoAlpha;
  const ee = taOutCubic(taClamp(e));
  if (s.deco === 'bar') {
    const h = (b.y1 - b.y0) + em * 0.55;
    const half = (W / 2) * ee;
    ctx.fillRect(W / 2 - half, cy - h / 2, half * 2, h);
    ctx.globalAlpha = Math.min(1, s.decoAlpha * 1.6);
    ctx.fillRect(W / 2 - half, cy - h / 2 - th * 1.4, half * 2, th * 0.5);
    ctx.fillRect(W / 2 - half, cy + h / 2 + th * 0.9, half * 2, th * 0.5);
  } else if (s.deco === 'lines') {
    const half = ((b.x1 - b.x0) / 2 + em * 0.9) * ee;
    ctx.fillRect(cx - half, b.y0 - em * 0.28 - th, half * 2, th);
    ctx.fillRect(cx - half, b.y1 + em * 0.28, half * 2, th);
  } else if (s.deco === 'frame' || s.deco === 'box') {
    const p = plan.story ? 0 : em * 0.42;
    const sc = 1.12 - 0.12 * ee;
    ctx.translate(cx, cy); ctx.scale(sc, sc); ctx.translate(-cx, -cy);
    ctx.globalAlpha = s.decoAlpha * ee;
    taRoundRect(ctx, b.x0 - p, b.y0 - p, b.x1 - b.x0 + p * 2, b.y1 - b.y0 + p * 2, plan.story ? em * 0.4 : em * 0.12);
    if (s.deco === 'box') ctx.fill();
    else { ctx.lineWidth = th; ctx.stroke(); }
  } else if (s.deco === 'side') {
    const right = plan.align === 'right';
    const bx = right ? b.x1 + em * 0.3 : b.x0 - em * 0.3 - th;
    const e1 = taOutCubic(taClamp(e * 1.6)), e2 = taOutCubic(taClamp(e * 1.6 - 0.5));
    ctx.fillRect(bx, b.y0, th, (b.y1 - b.y0) * e1);
    const len = (b.x1 - b.x0 + em * 0.9) * e2, uy = b.y1 + em * 0.18;
    if (right) ctx.fillRect(bx + th - len, uy, len, th * 0.6);
    else ctx.fillRect(bx, uy, len, th * 0.6);
  } else if (s.deco === 'hazard') {
    const hh = Math.max(em * 0.32, th * 3), gap = em * 0.35;
    const strip = (y) => {
      ctx.save();
      ctx.beginPath(); ctx.rect(0, y + hh / 2 - (hh / 2) * ee, W, hh * ee); ctx.clip();
      ctx.fillStyle = '#111'; ctx.fillRect(0, y, W, hh);
      ctx.fillStyle = s.decoColor;
      const step = hh * 1.6, off = (t * em * 1.2) % (step * 2);
      ctx.beginPath();
      for (let x = -step * 2 - hh + off; x < W + hh; x += step * 2) {
        ctx.moveTo(x, y + hh); ctx.lineTo(x + hh, y); ctx.lineTo(x + hh + step, y); ctx.lineTo(x + step, y + hh); ctx.closePath();
      }
      ctx.fill();
      ctx.restore();
    };
    strip(b.y0 - gap - hh);
    strip(b.y1 + gap);
  }
  ctx.restore();
}

// ── 1こまを描く ─────────────────────────────────────

const TA_IDLES = { none: 'なし', blink: '点滅', shake: '震える', glitch: 'ときどきノイズ' };
const TA_IDLE_DELAY = 0.1;

class TaRenderer {
  constructor() { this.cache = new Map(); this.key = ''; this.layer = null; this.tint = null; }
  reset() { this.cache.clear(); }

  render(ctx, plan, t) {
    const s = plan.s, W = plan.W, H = plan.H;
    const key = taStyleKey(s);
    if (key !== this.key) { this.cache.clear(); this.key = key; }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    // 飾り
    let de = 1;
    if (plan.decoIn[1] > 0) de = taClamp((t - plan.decoIn[0]) / (plan.decoIn[1] - plan.decoIn[0]));
    if (plan.decoOut) de = Math.min(de, 1 - taClamp((t - plan.decoOut[0]) / Math.max(1e-6, plan.decoOut[1] - plan.decoOut[0])));
    taDrawDeco(ctx, plan, de, t);

    // 文字は別の層に描いてから、点滅・震え・ノイズをかけて重ねる
    if (!this.layer || this.layer.width !== W || this.layer.height !== H) this.layer = taCanvas(W, H);
    const lx = this.layer.getContext('2d');
    lx.setTransform(1, 0, 0, 1, 0, 0);
    lx.clearRect(0, 0, W, H);
    const states = plan.glyphs.map((g) => this.glyphState(plan, g, t));
    for (let layer = 0; layer < 3; layer++) {
      plan.glyphs.forEach((g, i) => {
        const st = states[i];
        if (st.a <= 0.002) return;
        const sp = taSprite(this.cache, s, g);
        const img = sp.layers[layer];
        if (!img) return;
        lx.globalAlpha = taClamp(st.a);
        const gx = g.x + st.dx, gy = g.cy + st.dy;
        if (st.sc !== 1) {
          const ccx = g.x + g.adv / 2 + st.dx;
          lx.setTransform(st.sc, 0, 0, st.sc, ccx - st.sc * ccx, gy - st.sc * gy);
        } else lx.setTransform(1, 0, 0, 1, 0, 0);
        taDrawSprite(lx, img, gx - sp.ox, gy - sp.oy, st.blur);
      });
    }
    lx.globalAlpha = 1;
    lx.setTransform(1, 0, 0, 1, 0, 0);

    // 表示中の動きは出きってから少しあとに始める（出きった瞬間＝完成形の静止画にノイズや震えを入れない）
    const it = t - plan.idle[0] - TA_IDLE_DELAY;
    const idleOn = s.idle !== 'none' && it > 0 && t <= plan.idle[1];
    let alpha = 1, ox = 0, oy = 0;
    if (idleOn && s.idle === 'blink') alpha = 0.55 + 0.45 * Math.cos(it * Math.PI * 2 / Math.max(0.2, s.blinkSec));
    if (idleOn && s.idle === 'shake') {
      const k = Math.floor(t * 30);
      ox = (taRand(k, 1) - 0.5) * plan.em * 0.06; oy = (taRand(k, 2) - 0.5) * plan.em * 0.06;
    }
    let glitch = 0;
    if (idleOn && s.idle === 'glitch') {
      const slot = Math.floor(t / 0.07);
      if (it < 0.14 || taRand(slot, 7) < 0.16) glitch = 0.5 + taRand(slot, 8) * 0.5;
    }
    ctx.globalAlpha = alpha;
    if (glitch > 0) this.drawGlitch(ctx, plan, t, glitch);
    else ctx.drawImage(this.layer, ox, oy);
    ctx.restore();
  }

  glyphState(plan, g, t) {
    const s = plan.s;
    if (t < g.t0) return { a: 0 };
    let st = taAnimState(plan.animIn, g.dur > 0 ? (t - g.t0) / g.dur : 1, g, g.px, s);
    if (g.o0 !== undefined && t >= g.o0) {
      if (g.odur <= 0 || t >= g.o0 + g.odur) return { a: 0 };
      const q = (t - g.o0) / g.odur;
      const os = taAnimState(plan.animOut, 1 - q, g, g.px, s);
      st = { a: st.a * os.a, dx: st.dx + os.dx, dy: st.dy + os.dy, sc: st.sc * os.sc, blur: st.blur + os.blur };
    }
    return st;
  }

  drawGlitch(ctx, plan, t, k) {
    const s = plan.s, W = plan.W, H = plan.H, em = plan.em;
    const slot = Math.floor(t / 0.07);
    if (!this.tint || this.tint.width !== W || this.tint.height !== H) this.tint = taCanvas(W, H);
    const tx = this.tint.getContext('2d');
    const split = em * (0.03 + 0.06 * k);
    for (const [color, dir] of [[s.glitchA, -1], [s.glitchB, 1]]) {
      tx.globalCompositeOperation = 'copy'; tx.globalAlpha = 1;
      tx.drawImage(this.layer, 0, 0);
      tx.globalCompositeOperation = 'source-in'; tx.fillStyle = color; tx.fillRect(0, 0, W, H);
      const a = ctx.globalAlpha;
      ctx.globalAlpha = a * 0.85;
      ctx.drawImage(this.tint, dir * split, 0);
      ctx.globalAlpha = a;
    }
    // 横の帯ごとにずらす
    const b = plan.box;
    const y0 = Math.max(0, Math.floor(b.y0 - em * 0.3)), y1 = Math.min(H, Math.ceil(b.y1 + em * 0.3));
    ctx.drawImage(this.layer, 0, 0, W, y0, 0, 0, W, y0);
    ctx.drawImage(this.layer, 0, y1, W, H - y1, 0, y1, W, H - y1);
    let y = y0, n = 0;
    while (y < y1) {
      const hh = Math.max(2, Math.round(em * (0.06 + taRand(slot, 20 + n) * 0.3)));
      const h = Math.min(hh, y1 - y);
      const shift = taRand(slot, 40 + n) < 0.35 ? (taRand(slot, 60 + n) - 0.5) * em * 0.5 * k : 0;
      ctx.drawImage(this.layer, 0, y, W, h, shift, y, W, h);
      y += h; n++;
    }
  }
}

if (typeof module !== 'undefined') module.exports = { TA_FONTS, TA_ANIMS, TA_DECOS, TA_IDLES, taPlan, TaRenderer, taWrap, taRand };
