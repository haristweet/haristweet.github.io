// 画面: 場面・テンプレート・設定・プレビューの再生・書き出し
const VERSION = 'v1.0.0';
const LS_KEY = 'textApngMaker.v1';

const SIZE_PRESETS = [
  ['1280x720', '1280×720（16:9）'], ['1920x1080', '1920×1080（16:9・大）'], ['960x540', '960×540（16:9・小）'],
  ['1080x1080', '1080×1080（正方形）'], ['1200x300', '1200×300（横長の帯）'], ['800x200', '800×200（小さな帯）'], ['custom', '自分で決める'],
];

// 見る所の背景（CLAUDE.md の 8 と同じ色）。市松は透けている所を見るためのもの
const BG_PRESETS = [
  ['checker', '市松（透明）', null, null],
  ['dark', 'ダーク', '#3a3834', '#2a2926'], ['black', '黒', '#111111', '#000000'], ['gray', 'グレー', '#8a8a8a', '#6a6a6a'],
  ['white', '白', '#ffffff', '#e6e4df'], ['sky', '空', '#bfe3ff', '#5a9fd6'], ['sunset', '夕焼け', '#ffcf8a', '#c4533a'],
  ['night', '夜', '#35407a', '#0d1030'], ['green', 'グリーンバック', '#00b140', '#00b140'],
];

const fontOpts = Object.fromEntries(Object.entries(TA_FONTS).map(([k, f]) => [k, f.label]));
const notStory = (s) => s.mode !== 'story';
const isStory = (s) => s.mode === 'story';

// 設定パネルの中身。show が false のものは隠す
const TABS = [
  ['text', '文章', [
    { k: 'text', label: '文章', type: 'area', wide: true, hint: (s) => (s.mode === 'story' ? '空の行でページが変わります。長い行は自動で折り返します。' : '改行で行を分けられます。入りきらないときは自動で小さくします。') },
    { k: 'sub', label: '小さな文', type: 'text', show: notStory, hint: () => '空にすると出しません。' },
    { k: 'subPos', label: '小さな文の位置', type: 'select', opts: { below: '大きな文の下', above: '大きな文の上' }, show: (s) => notStory(s) && (s.sub || '').trim() },
    { k: 'cps', label: '1秒に出す字数', type: 'range', min: 2, max: 40, step: 1, fmt: (v) => v + ' 字', show: isStory },
    { k: 'storyPos', label: '置く所', type: 'select', opts: { center: '真ん中', bottom: '下（メッセージ窓）' }, show: isStory },
    { k: 'storyAlign', label: '行のそろえ', type: 'select', opts: { left: '左そろえ', center: '中央' }, show: isStory },
  ]],
  ['font', '文字', [
    { k: 'font', label: 'フォント', type: 'select', opts: fontOpts },
    { k: 'size', label: '大きさ', type: 'range', min: 2, max: 40, step: 0.5, fmt: (v) => v + '%', hint: () => '画像の大きさに対する割合（16:9 なら高さに対する割合）' },
    { k: 'subSize', label: '小さな文の大きさ', type: 'range', min: 2, max: 20, step: 0.2, fmt: (v) => v + '%', show: (s) => notStory(s) && (s.sub || '').trim() },
    { k: 'spacing', label: '字の間', type: 'range', min: -0.2, max: 1, step: 0.01, fmt: (v) => v.toFixed(2) },
    { k: 'lineGap', label: '行の間', type: 'range', min: 0, max: 1.5, step: 0.02, fmt: (v) => v.toFixed(2) },
    { k: 'italic', label: '斜めにする', type: 'check' },
    { k: 'fill', label: '文字の色', type: 'color' },
    { k: 'grad', label: '下へ色を変える', type: 'check' },
    { k: 'fill2', label: '下の色', type: 'color', show: (s) => s.grad },
    { k: 'subColor', label: '小さな文の色', type: 'color', optional: '大きな文と同じ', show: (s) => notStory(s) && (s.sub || '').trim() },
    { k: 'stroke', label: '縁取りの色', type: 'color' },
    { k: 'strokeW', label: '縁取りの太さ', type: 'range', min: 0, max: 25, step: 0.5, fmt: (v) => (v ? v + '%' : 'なし') },
    { k: 'glow', label: '光彩の色', type: 'color' },
    { k: 'glowW', label: '光彩の広さ', type: 'range', min: 0, max: 40, step: 1, fmt: (v) => (v ? v + '%' : 'なし') },
    { k: 'shadow', label: '影の色', type: 'color' },
    { k: 'shadowD', label: '影のずれ', type: 'range', min: 0, max: 20, step: 0.5, fmt: (v) => v + '%' },
    { k: 'shadowB', label: '影のぼかし', type: 'range', min: 0, max: 30, step: 1, fmt: (v) => v + '%' },
  ]],
  ['anim', '動き', [
    { k: 'inOn', label: '登場の動き', type: 'check', hint: () => '外すと最初から全部出した状態で始めます。' },
    { k: 'anim', label: '出し方', type: 'select', opts: TA_ANIMS, show: (s) => s.inOn },
    { k: 'dir', label: '滑りこむ向き', type: 'select', opts: { left: '左から', right: '右から', up: '上から', down: '下から' }, show: (s) => s.inOn && s.anim === 'slide' },
    { k: 'inDur', label: '1字が出る時間', type: 'range', min: 0.05, max: 2, step: 0.05, fmt: (v) => v.toFixed(2) + ' 秒', show: (s) => s.inOn && !['none', 'type'].includes(s.anim) },
    { k: 'stagger', label: '次の字までの間', type: 'range', min: 0, max: 0.4, step: 0.01, fmt: (v) => v.toFixed(2) + ' 秒', show: (s) => notStory(s) && s.inOn && !['none', 'spread'].includes(s.anim) },
    { k: 'hold', label: '見せておく時間', type: 'range', min: 0.2, max: 8, step: 0.1, fmt: (v) => v.toFixed(1) + ' 秒', hint: (s) => (s.mode === 'story' ? '1ページを出しきってから次へ進むまで' : '出きってから退場するまで') },
    { k: 'idle', label: '表示中の動き', type: 'select', opts: TA_IDLES },
    { k: 'blinkSec', label: '点滅の速さ', type: 'range', min: 0.2, max: 4, step: 0.1, fmt: (v) => v.toFixed(1) + ' 秒', show: (s) => s.idle === 'blink' },
    { k: 'glitchA', label: 'ノイズの色1', type: 'color', show: (s) => s.idle === 'glitch' },
    { k: 'glitchB', label: 'ノイズの色2', type: 'color', show: (s) => s.idle === 'glitch' },
    { k: 'outOn', label: '退場する', type: 'check', hint: () => '外すと出したまま終わります（ずっと出しておく素材に）。' },
    { k: 'outDur', label: '消える時間', type: 'range', min: 0.1, max: 2, step: 0.05, fmt: (v) => v.toFixed(2) + ' 秒', show: (s) => s.outOn && notStory(s) },
  ]],
  ['deco', '配置と飾り', [
    { k: 'pos', label: '置く所', type: 'select', opts: { center: '真ん中', top: '上', bottom: '下', tl: '左上', bl: '左下', tr: '右上', br: '右下' }, show: notStory },
    { k: 'deco', label: '飾り', type: 'select', opts: TA_DECOS },
    { k: 'decoColor', label: '飾りの色', type: 'color', show: (s) => s.deco !== 'none' },
    { k: 'decoAlpha', label: '飾りの濃さ', type: 'range', min: 0.05, max: 1, step: 0.05, fmt: (v) => Math.round(v * 100) + '%', show: (s) => s.deco !== 'none' },
    { k: 'decoSize', label: '線の太さ', type: 'range', min: 1, max: 20, step: 0.5, fmt: (v) => v + '%', show: (s) => ['lines', 'frame', 'side', 'bar', 'hazard'].includes(s.deco) },
  ]],
];

// ── 保存 ──────────────────────────────────────────────

function freshMode(mode) {
  const t = TA_TEMPLATES[mode][0];
  return { s: { ...TA_BASE[mode], ...t.patch, loop: t.loop || 'once' }, tpl: t.id };
}

function loadStore() {
  const def = {
    mode: 'cutin', tab: 'text', bg: 'dark', repeat: true,
    modes: { cutin: freshMode('cutin'), telop: freshMode('telop'), story: freshMode('story') },
    exp: { w: 1280, h: 720, fps: 20, trim: false, still: true, fmt: 'apng', name: '' },
  };
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    if (raw && typeof raw === 'object') {
      for (const m of Object.keys(TA_MODES)) {
        const saved = raw.modes && raw.modes[m];
        if (saved && saved.s) {
          // 初期値にある項目・同じ種類の値だけを使う
          const s = { ...TA_BASE[m] };
          for (const k of Object.keys(s)) if (typeof saved.s[k] === typeof s[k]) s[k] = saved.s[k];
          def.modes[m] = { s, tpl: saved.tpl || null };
        }
      }
      if (TA_MODES[raw.mode]) def.mode = raw.mode;
      if (typeof raw.tab === 'string') def.tab = raw.tab;
      if (BG_PRESETS.some((b) => b[0] === raw.bg)) def.bg = raw.bg;
      if (typeof raw.repeat === 'boolean') def.repeat = raw.repeat;
      if (raw.exp) for (const k of Object.keys(def.exp)) if (typeof raw.exp[k] === typeof def.exp[k]) def.exp[k] = raw.exp[k];
    }
  } catch (e) { /* 読めないときは初期値 */ }
  def.exp.w = clampInt(def.exp.w, 32, 3840); def.exp.h = clampInt(def.exp.h, 32, 3840);
  return def;
}

let saveTimer = 0;
function saveStore() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(store)); } catch (e) { /* 保存できない環境 */ }
  }, 250);
}

function clampInt(v, a, b) { v = Math.round(Number(v)); return Number.isFinite(v) ? Math.min(b, Math.max(a, v)) : a; }

// ── 状態 ──────────────────────────────────────────────

const store = loadStore();
const $ = (id) => document.getElementById(id);
const view = $('view'), vctx = view.getContext('2d');
const measureCtx = document.createElement('canvas').getContext('2d');
const renderer = new TaRenderer();
let plan = null, t = 0, playing = true, lastTs = 0, endWait = 0, dirty = true;

function settings() {
  const m = store.modes[store.mode];
  return { ...m.s, mode: store.mode, w: store.exp.w, h: store.exp.h };
}

function rebuild() {
  const s = settings();
  plan = taPlan(measureCtx, s);
  if (view.width !== s.w || view.height !== s.h) { view.width = s.w; view.height = s.h; }
  if (t > plan.T) t = 0;
  dirty = true;
  updateEstimate();
}

// ── 画面を組む ────────────────────────────────────────

function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids) if (kid !== null && kid !== undefined) e.append(kid);
  return e;
}

function buildModes() {
  const box = $('modes'); box.textContent = '';
  for (const [k, name] of Object.entries(TA_MODES)) {
    box.append(el('button', { type: 'button', 'aria-pressed': String(store.mode === k), onclick: () => setMode(k) }, name));
  }
}

function buildTemplates() {
  const box = $('tpls'); box.textContent = '';
  const cur = store.modes[store.mode].tpl;
  for (const tp of TA_TEMPLATES[store.mode]) {
    box.append(el('button', { type: 'button', class: 'tpl', 'aria-pressed': String(cur === tp.id), onclick: () => applyTemplate(tp) }, tp.name));
  }
}

function buildTabs() {
  const box = $('tabs'); box.textContent = '';
  if (!TABS.some((tb) => tb[0] === store.tab)) store.tab = 'text';
  for (const [id, name] of TABS) {
    box.append(el('button', { type: 'button', role: 'tab', 'aria-selected': String(store.tab === id), onclick: () => { store.tab = id; saveStore(); buildTabs(); buildControls(); } }, name));
  }
}

let ctlRows = [];
function buildControls() {
  const box = $('ctrls'); box.textContent = ''; ctlRows = [];
  const tab = TABS.find((tb) => tb[0] === store.tab);
  const s = store.modes[store.mode].s;
  for (const c of tab[2]) {
    const id = 'c_' + c.k;
    const row = el('div', { class: 'ctl' + (c.wide ? ' wide' : '') });
    const lbl = el('label', { class: 'lbl', for: id }, c.label);
    let input;
    const set = (v) => { s[c.k] = v; onChange(c.k); };
    if (c.type === 'range') {
      const out = el('output', {}, c.fmt ? c.fmt(s[c.k]) : String(s[c.k]));
      input = el('input', { type: 'range', id, min: c.min, max: c.max, step: c.step, value: s[c.k] });
      input.addEventListener('input', () => { const v = Number(input.value); out.textContent = c.fmt ? c.fmt(v) : String(v); set(v); });
      row.append(lbl, el('div', { class: 'rng' }, input, out));
    } else if (c.type === 'color') {
      input = el('input', { type: 'color', id, value: s[c.k] || s.fill });
      const wrap = el('div', { class: 'colr' }, input);
      if (c.optional) {
        const same = el('input', { type: 'checkbox' }); same.checked = !s[c.k];
        input.disabled = same.checked;
        same.addEventListener('change', () => { input.disabled = same.checked; set(same.checked ? '' : input.value); });
        wrap.append(el('label', { class: 'chk' }, same, c.optional));
      }
      input.addEventListener('input', () => set(input.value));
      row.append(lbl, wrap);
    } else if (c.type === 'select') {
      input = el('select', { id });
      for (const [v, name] of Object.entries(c.opts)) input.append(el('option', { value: v }, name));
      input.value = s[c.k];
      input.addEventListener('change', () => set(input.value));
      row.append(lbl, input);
    } else if (c.type === 'check') {
      input = el('input', { type: 'checkbox', id }); input.checked = !!s[c.k];
      input.addEventListener('change', () => set(input.checked));
      row.append(lbl, el('label', { class: 'chk', for: id }, input, 'する'));
    } else {
      input = el(c.type === 'area' ? 'textarea' : 'input', { id, type: c.type === 'area' ? undefined : 'text', rows: c.type === 'area' ? 4 : undefined });
      input.value = s[c.k];
      input.addEventListener('input', () => set(input.value));
      row.append(lbl, input);
    }
    const hint = c.hint ? el('div', { class: 'hint' }) : null;
    if (hint) row.append(hint);
    box.append(row);
    ctlRows.push({ c, row, hint });
  }
  refreshVisibility();
}

function refreshVisibility() {
  const s = settings();
  for (const { c, row, hint } of ctlRows) {
    row.hidden = c.show ? !c.show(s) : false;
    if (hint) hint.textContent = c.hint(s);
  }
}

function onChange(k) {
  refreshVisibility();
  rebuild();
  saveStore();
  hideResult();
}

function setMode(m) {
  store.mode = m; t = 0;
  syncExportUi();
  buildModes(); buildTemplates(); buildControls();
  rebuild(); saveStore(); hideResult();
}

function applyTemplate(tp) {
  const m = store.modes[store.mode];
  m.s = { ...TA_BASE[store.mode], ...tp.patch, loop: tp.loop || 'once' };
  m.tpl = tp.id; t = 0; playing = true;
  syncExportUi();
  buildTemplates(); buildControls();
  rebuild(); saveStore(); hideResult();
}

// ── 背景 ──────────────────────────────────────────────

function setBackground(id) {
  store.bg = id;
  const b = BG_PRESETS.find((x) => x[0] === id) || BG_PRESETS[1];
  const st = $('stage');
  st.dataset.bg = b[0];
  if (b[2]) { st.style.setProperty('--stage2', b[2]); st.style.setProperty('--stage', b[3]); }
  for (const btn of $('bgs').querySelectorAll('.bg-dot')) btn.setAttribute('aria-pressed', String(btn.dataset.id === id));
  saveStore();
}

function buildBackgrounds() {
  const box = $('bgs');
  for (const [id, name, c2, c1] of BG_PRESETS) {
    const style = c2 ? `background:radial-gradient(circle at 50% 35%,${c2},${c1})` : 'background:repeating-conic-gradient(#bbb 0 25%,#fff 0 50%) 0 0/10px 10px';
    box.append(el('button', { type: 'button', class: 'bg-dot', title: name, 'aria-label': '背景: ' + name, 'data-id': id, style, onclick: () => setBackground(id) }));
  }
  setBackground(store.bg);
}

// ── 再生 ──────────────────────────────────────────────

function fmtSec(v) { return v.toFixed(2); }

function draw() {
  renderer.render(vctx, plan, t);
  $('seek').value = String(Math.round((t / plan.T) * 1000));
  $('time').textContent = `${fmtSec(t)} / ${fmtSec(plan.T)} 秒`;
  dirty = false;
}

function tick(ts) {
  const dt = lastTs ? Math.min(0.1, (ts - lastTs) / 1000) : 0;
  lastTs = ts;
  if (playing && plan) {
    if (t >= plan.T) {
      endWait += dt;
      if (endWait > 0.7) {
        if (store.repeat) { t = 0; endWait = 0; } else { playing = false; setPlayIcon(); }
      }
    } else t = Math.min(plan.T, t + dt);
    dirty = true;
  }
  if (dirty && plan) draw();
  requestAnimationFrame(tick);
}

function setPlayIcon() { $('play').textContent = playing ? '❚❚' : '▶'; }

function togglePlay() {
  if (!playing && t >= plan.T) t = 0;
  playing = !playing; endWait = 0; setPlayIcon();
}

// ── 書き出し ──────────────────────────────────────────

function syncExportUi() {
  const e = store.exp, s = store.modes[store.mode].s;
  const key = `${e.w}x${e.h}`;
  $('sizePreset').value = SIZE_PRESETS.some((p) => p[0] === key) ? key : 'custom';
  $('w').value = e.w; $('h').value = e.h;
  $('fps').value = String(e.fps); $('loop').value = s.loop;
  $('trim').checked = e.trim; $('still').checked = e.still; $('fmt').value = e.fmt;
  $('name').value = e.name;
  $('still').closest('label').hidden = e.fmt !== 'apng';
  $('loop').closest('label').hidden = e.fmt !== 'apng';
  $('fps').closest('label').hidden = e.fmt !== 'apng';
}

function buildExport() {
  const sp = $('sizePreset');
  for (const [v, name] of SIZE_PRESETS) sp.append(el('option', { value: v }, name));
  sp.addEventListener('change', () => {
    if (sp.value !== 'custom') { const [w, h] = sp.value.split('x').map(Number); store.exp.w = w; store.exp.h = h; }
    syncExportUi(); rebuild(); saveStore(); hideResult();
  });
  const wh = () => {
    store.exp.w = clampInt($('w').value, 32, 3840); store.exp.h = clampInt($('h').value, 32, 3840);
    syncExportUi(); rebuild(); saveStore(); hideResult();
  };
  $('w').addEventListener('change', wh); $('h').addEventListener('change', wh);
  $('fps').addEventListener('change', () => { store.exp.fps = Number($('fps').value); saveStore(); updateEstimate(); hideResult(); });
  $('loop').addEventListener('change', () => { store.modes[store.mode].s.loop = $('loop').value; saveStore(); hideResult(); });
  $('trim').addEventListener('change', () => { store.exp.trim = $('trim').checked; saveStore(); hideResult(); });
  $('still').addEventListener('change', () => { store.exp.still = $('still').checked; saveStore(); hideResult(); });
  $('fmt').addEventListener('change', () => { store.exp.fmt = $('fmt').value; syncExportUi(); updateEstimate(); saveStore(); hideResult(); });
  $('name').addEventListener('input', () => { store.exp.name = $('name').value; saveStore(); });
  $('export').addEventListener('click', () => runExport());
  syncExportUi();
}

function fileBase() {
  const typed = store.exp.name.trim();
  if (typed) return typed.replace(/\.(a?png)$/i, '');
  const s = store.modes[store.mode].s;
  const src = (s.text || '').split('\n').find((l) => l.trim()) || TA_MODES[store.mode];
  let base = src.trim().replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 24) || 'text';
  if (store.exp.fmt === 'apng' && s.loop === 'infinite') base += '_ループ';
  return base;
}

function frameTimes(p, fps) {
  const n = Math.max(1, Math.round(p.T * fps));
  const ts = [];
  for (let i = 0; i <= n; i++) ts.push(Math.min(p.T, i / fps));
  return ts;
}

function updateEstimate() {
  if (!plan) return;
  const e = store.exp;
  $('estimate').textContent = e.fmt === 'apng'
    ? `${fmtSec(plan.T)} 秒・${frameTimes(plan, e.fps).length} こま（同じ絵が続くこまは1枚にまとめます）`
    : '文字が出きったときの絵を保存します';
}

function hideResult() { $('result').classList.remove('on'); }

// 全こまで不透明な画素がある範囲（余白を切るため）
function alphaBounds(data, w, h, acc) {
  const d32 = new Uint32Array(data.buffer, data.byteOffset, w * h);
  let { x0, y0, x1, y1 } = acc;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      if (d32[row + x] >>> 24 === 0) continue; // 透明（下位から R,G,B,A の順に並ぶ）
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  return { x0, y0, x1, y1 };
}

let exporting = false;
async function runExport(opts = {}) {
  if (exporting) return null;
  exporting = true;
  const btn = $('export'), prog = $('prog');
  btn.disabled = true; prog.hidden = false;
  const setProg = (v) => { prog.firstElementChild.style.width = (v * 100).toFixed(1) + '%'; };
  setProg(0);
  try {
    await waitFonts();
    const s = settings(), p = taPlan(measureCtx, s);
    const W = s.w, H = s.h, fmt = opts.fmt || store.exp.fmt;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    const r = new TaRenderer();
    const times = fmt === 'apng' ? frameTimes(p, store.exp.fps) : [p.tFull];
    // 余白を切るときは、先に全こまを描いて範囲を決める
    let crop = { x: 0, y: 0, w: W, h: H };
    if (store.exp.trim) {
      let b = { x0: W, y0: H, x1: -1, y1: -1 };
      for (let i = 0; i < times.length; i++) {
        r.render(cx, p, times[i]);
        b = alphaBounds(cx.getImageData(0, 0, W, H).data, W, H, b);
        if (i % 4 === 0) { setProg((i / times.length) * 0.3); await yieldUi(); }
      }
      if (b.x1 >= 0) {
        const m = 2;
        const x0 = Math.max(0, b.x0 - m), y0 = Math.max(0, b.y0 - m);
        crop = { x: x0, y: y0, w: Math.min(W, b.x1 + 1 + m) - x0, h: Math.min(H, b.y1 + 1 + m) - y0 };
      }
    }
    const base = store.exp.trim ? 0.3 : 0;
    let bytes, frames = 1;
    if (fmt === 'apng') {
      const enc = new ApngEncoder(crop.w, crop.h, { loops: s.loop === 'infinite' ? 0 : 1, fps: store.exp.fps });
      for (let i = 0; i < times.length; i++) {
        r.render(cx, p, times[i]);
        await enc.addFrame(cx.getImageData(crop.x, crop.y, crop.w, crop.h).data, 1);
        if (i % 2 === 0) { setProg(base + (i / times.length) * (1 - base) * 0.95); await yieldUi(); }
      }
      if (store.exp.still) { r.render(cx, p, p.tFull); await enc.setStill(cx.getImageData(crop.x, crop.y, crop.w, crop.h).data); }
      bytes = enc.finish(); frames = enc.frameCount;
    } else {
      r.render(cx, p, p.tFull);
      const enc = new ApngEncoder(crop.w, crop.h);
      await enc.addFrame(cx.getImageData(crop.x, crop.y, crop.w, crop.h).data);
      bytes = enc.finish();
    }
    setProg(1);
    const blob = new Blob([bytes], { type: 'image/png' });
    const url = URL.createObjectURL(blob);
    const name = fileBase() + '.png';
    const old = $('dl').href; if (old && old.startsWith('blob:')) URL.revokeObjectURL(old);
    $('thumb').src = url; $('dl').href = url; $('dl').download = name;
    $('resInfo').textContent = `${name}　${crop.w}×${crop.h}・${(bytes.length / 1024).toFixed(1)} KB` +
      (fmt === 'apng' ? `・${frames} こま・${fmtSec(p.T)} 秒・${s.loop === 'infinite' ? 'ずっとくり返す' : '1回再生'}` : '');
    $('result').classList.add('on');
    return { bytes, crop, plan: p, times, frames };
  } catch (err) {
    console.error(err);
    toast('書き出せませんでした: ' + (err && err.message ? err.message : err));
    return null;
  } finally {
    exporting = false; btn.disabled = false;
    setTimeout(() => { prog.hidden = true; }, 400);
  }
}

const yieldUi = () => new Promise((r) => setTimeout(r, 0));

// 使うフォントを読みこむ（Google Fonts は使う字の分だけ読む）。読めたら字の絵を作りなおす
async function waitFonts() {
  const s = settings();
  const f = TA_FONTS[s.font];
  const sample = (s.text || '') + (s.sub || '') + 'あア亜A';
  try {
    await Promise.race([
      document.fonts.load(`${f.weight} 40px "${f.family}"`, sample),
      new Promise((r) => setTimeout(r, 8000)),
    ]);
  } catch (e) { /* 読めなければ代わりのフォントで描く */ }
  renderer.reset();
  rebuild();
}

let toastTimer = 0;
function toast(msg) {
  const tEl = $('toast'); tEl.textContent = msg; tEl.classList.add('on');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => tEl.classList.remove('on'), 3200);
}

// ── 明るさ ────────────────────────────────────────────

function applyTheme(th) {
  if (th) document.documentElement.dataset.theme = th; else delete document.documentElement.dataset.theme;
}
function initTheme() {
  let th = null;
  try { th = localStorage.getItem('textApngMaker.theme'); } catch (e) { /* なし */ }
  applyTheme(th);
  $('theme').addEventListener('click', () => {
    const dark = document.documentElement.dataset.theme
      ? document.documentElement.dataset.theme === 'dark'
      : matchMedia('(prefers-color-scheme: dark)').matches;
    const next = dark ? 'light' : 'dark';
    applyTheme(next);
    try { localStorage.setItem('textApngMaker.theme', next); } catch (e) { /* なし */ }
  });
}

// ── はじめ ────────────────────────────────────────────

function init() {
  $('ver').textContent = VERSION;
  initTheme();
  buildModes(); buildTemplates(); buildTabs(); buildControls(); buildBackgrounds(); buildExport();
  $('repeat').checked = store.repeat;
  $('repeat').addEventListener('change', () => { store.repeat = $('repeat').checked; saveStore(); });
  $('play').addEventListener('click', togglePlay);
  $('seek').addEventListener('input', () => { t = (Number($('seek').value) / 1000) * plan.T; playing = false; setPlayIcon(); dirty = true; });
  $('resetMode').addEventListener('click', () => {
    store.modes[store.mode] = freshMode(store.mode);
    t = 0; syncExportUi(); buildTemplates(); buildControls(); rebuild(); saveStore(); hideResult();
    toast(TA_MODES[store.mode] + 'を初期状態に戻しました');
  });
  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input,textarea,select,[contenteditable]') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
    else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault(); playing = false; setPlayIcon();
      t = Math.min(plan.T, Math.max(0, t + (e.key === 'ArrowRight' ? 1 : -1) / store.exp.fps)); dirty = true;
    }
  });
  rebuild(); setPlayIcon();
  // フォントが届いたら描きなおす
  document.fonts.addEventListener('loadingdone', () => { renderer.reset(); rebuild(); });
  waitFonts();
  requestAnimationFrame(tick);
}

init();

// 試験の台本から使う入り口
window.__textApng = {
  store, settings, rebuild, applyTemplate, setMode, runExport, waitFonts,
  get plan() { return plan; },
  seek(v) { t = v; playing = false; setPlayIcon(); draw(); },
  renderAt(s, time) {
    const p = taPlan(measureCtx, s), c = document.createElement('canvas');
    c.width = s.w; c.height = s.h;
    const cx = c.getContext('2d', { willReadFrequently: true });
    new TaRenderer().render(cx, p, time);
    return { canvas: c, plan: p };
  },
  frameTimes,
};
