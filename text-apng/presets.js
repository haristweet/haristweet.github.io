// 初期値とテンプレート。テンプレートの patch には初期値からの違いだけを書く。
// 画像の大きさ・こま数（fps）・余白を切るかは書き出しの設定なので、テンプレートを選んでも変えない。

const TA_COMMON = {
  font: 'noto', italic: false, size: 18, subSize: 6, spacing: 0.04, lineGap: 0.22, subPos: 'below',
  fill: '#ffffff', grad: false, fill2: '#ffd84a', subColor: '',
  stroke: '#1b1b1f', strokeW: 9, glow: '#ff3b3b', glowW: 0, shadow: '#000000', shadowD: 4, shadowB: 6,
  pos: 'center', deco: 'none', decoColor: '#000000', decoAlpha: 0.6, decoSize: 6,
  inOn: true, anim: 'pop', dir: 'left', inDur: 0.45, stagger: 0.06, hold: 1.6,
  idle: 'none', blinkSec: 0.9, glitchA: '#ff2a6d', glitchB: '#05d9e8',
  outOn: true, outDur: 0.35,
  cps: 14, storyPos: 'center', storyAlign: 'left',
  loop: 'once',
};

const TA_BASE = {
  cutin: { ...TA_COMMON, text: '戦闘開始', sub: 'BATTLE START' },
  telop: { ...TA_COMMON, text: '古びた洋館', sub: '1924年 アーカム', size: 9, subSize: 4.2, pos: 'bl', subPos: 'above',
    anim: 'slide', dir: 'left', stagger: 0.04, inDur: 0.5, hold: 2.4, deco: 'side', decoColor: '#ffffff', decoAlpha: 0.9, decoSize: 5,
    strokeW: 0, shadowD: 3, shadowB: 10 },
  story: { ...TA_COMMON, text: '霧の深い夜だった。\n古い洋館の扉が、ひとりでに軋んで開く。\n\n誰かが、こちらを呼んでいる――。',
    sub: '', size: 6, anim: 'fade', inDur: 0.25, hold: 1.8, strokeW: 0, shadowD: 2, shadowB: 8, font: 'serif', spacing: 0.06, lineGap: 0.6 },
};

const TA_MODES = { cutin: 'カットイン', telop: 'テロップ', story: '文章' };

const TA_TEMPLATES = {
  cutin: [
    { id: 'battle', name: '戦闘開始', patch: { text: '戦闘開始', sub: 'BATTLE START', font: 'dela', fill: '#ffffff', stroke: '#b3121b', strokeW: 10,
      glow: '#ff2d2d', glowW: 14, deco: 'bar', decoColor: '#0a0a0a', decoAlpha: 0.7, anim: 'pop', stagger: 0.07 } },
    { id: 'battleEnd', name: '戦闘終了', patch: { text: '戦闘終了', sub: 'BATTLE END', font: 'dela', stroke: '#1d3b8a', strokeW: 9,
      deco: 'lines', decoColor: '#ffffff', decoAlpha: 0.9, decoSize: 4, anim: 'fade', stagger: 0.08, inDur: 0.5 } },
    { id: 'boss', name: '強敵出現', patch: { text: '強敵出現', sub: 'WARNING', font: 'dela', fill: '#ff3030', stroke: '#1a0000', strokeW: 8,
      glow: '#ff0000', glowW: 10, deco: 'hazard', decoColor: '#ffcc00', decoAlpha: 1, anim: 'zoom', stagger: 0.05, idle: 'blink', blinkSec: 0.5, hold: 2 } },
    { id: 'explore', name: '探索開始', patch: { text: '探索開始', sub: 'EXPLORATION', font: 'shippori', stroke: '#2d2418', strokeW: 6,
      grad: true, fill: '#fff6dc', fill2: '#d8b46a', deco: 'lines', decoColor: '#e9d7a6', decoAlpha: 0.85, decoSize: 3, anim: 'spread', inDur: 0.9, glowW: 0 } },
    { id: 'incident', name: '事件発生', patch: { text: '事件発生', sub: 'INCIDENT', font: 'rocknroll', fill: '#ffe14a', stroke: '#111111', strokeW: 10,
      deco: 'bar', decoColor: '#111111', decoAlpha: 0.75, anim: 'slide', dir: 'left', stagger: 0.04, idle: 'shake' } },
    { id: 'chapter', name: '章の始まり', patch: { text: '第一章', sub: 'はじまりの街', font: 'serif', size: 15, subSize: 5.5, strokeW: 0,
      shadowD: 0, shadowB: 14, shadow: '#000000', glow: '#ffffff', glowW: 0, deco: 'lines', decoColor: '#ffffff', decoAlpha: 0.7, decoSize: 2.5,
      anim: 'blur', stagger: 0.12, inDur: 0.9, hold: 2.2, outDur: 0.8 } },
    { id: 'critical', name: 'クリティカル', patch: { text: 'クリティカル!!', sub: 'CRITICAL', font: 'dela', size: 15, grad: true, fill: '#fff7b0', fill2: '#ffae00',
      stroke: '#5a2a00', strokeW: 9, glow: '#ffd000', glowW: 16, anim: 'pop', stagger: 0.04, idle: 'shake', hold: 1.4 }, loop: 'once' },
    { id: 'fumble', name: 'ファンブル', patch: { text: 'ファンブル…', sub: 'FUMBLE', font: 'rounded', size: 15, fill: '#c9d6ff', grad: true, fill2: '#6b6fd6',
      stroke: '#14143a', strokeW: 9, anim: 'drop', stagger: 0.07, inDur: 0.8, idle: 'glitch', glitchA: '#5a5aff', glitchB: '#a0ffea' } },
    { id: 'success', name: '成功', patch: { text: '成功', sub: 'SUCCESS', font: 'dela', size: 22, fill: '#ffffff', stroke: '#0d6b3a', strokeW: 11,
      glow: '#3dff9a', glowW: 10, anim: 'pop', stagger: 0.1 } },
    { id: 'failure', name: '失敗', patch: { text: '失敗', sub: 'FAILURE', font: 'dela', size: 22, fill: '#d8d8d8', stroke: '#2a2a2a', strokeW: 11,
      anim: 'drop', stagger: 0.12, inDur: 0.7 } },
    { id: 'san', name: 'SANチェック', patch: { text: 'SANチェック', sub: '正気度ロール', font: 'antique', size: 15, fill: '#e01b1b', stroke: '#140000', strokeW: 6,
      glow: '#7a0000', glowW: 18, shadowD: 0, shadowB: 0, deco: 'bar', decoColor: '#000000', decoAlpha: 0.75, anim: 'blur', stagger: 0.05, inDur: 0.7,
      idle: 'glitch', glitchA: '#ff0040', glitchB: '#00ffd5', hold: 2.2 } },
    { id: 'break', name: '休憩中', patch: { text: '休憩中', sub: 'しばらくお待ちください', font: 'rounded', size: 16, subSize: 5, fill: '#ffffff', stroke: '#e0778f', strokeW: 10,
      shadowD: 0, shadowB: 0, deco: 'none', anim: 'drop', stagger: 0.12, inDur: 0.8, idle: 'blink', blinkSec: 2.2, outOn: false, hold: 3 }, loop: 'infinite' },
    { id: 'start', name: 'セッション開始', patch: { text: 'セッション開始', sub: 'よろしくお願いします', font: 'mochiy', size: 12, subSize: 5, fill: '#ffffff',
      stroke: '#2b67c9', strokeW: 11, deco: 'none', anim: 'zip', stagger: 0.05 } },
    { id: 'thanks', name: 'おつかれさま', patch: { text: 'おつかれさまでした', sub: 'ありがとうございました', font: 'hachi', size: 10, subSize: 4.8, fill: '#ffffff',
      stroke: '#c85a2a', strokeW: 10, anim: 'type', stagger: 0.09, hold: 2.4, deco: 'none' } },
  ],
  telop: [
    { id: 'place', name: '場所', patch: {} },
    { id: 'placeCenter', name: '場所（中央）', patch: { text: '― 地下礼拝堂 ―', sub: '', pos: 'center', size: 8, font: 'shippori', deco: 'lines',
      decoColor: '#ffffff', decoAlpha: 0.7, decoSize: 2, anim: 'spread', inDur: 1.0, shadowB: 12 } },
    { id: 'time', name: '時刻', patch: { text: 'AM 2:00', sub: '深夜', pos: 'tl', font: 'dot', size: 9, subSize: 4, subPos: 'below', anim: 'type', stagger: 0.12,
      deco: 'box', decoColor: '#000000', decoAlpha: 0.55, strokeW: 0, shadowD: 0, shadowB: 0, hold: 2.4 } },
    { id: 'day', name: '日付', patch: { text: '十月三十一日', sub: '一日目', pos: 'br', font: 'serif', size: 7, subSize: 4, subPos: 'above', anim: 'fade',
      stagger: 0.08, deco: 'side', decoColor: '#ffffff' } },
    { id: 'flashback', name: '回想', patch: { text: '― 十年前 ―', sub: '', pos: 'center', font: 'serif', size: 8, fill: '#f3ead8', anim: 'blur', stagger: 0.1,
      inDur: 1.1, hold: 2.4, outDur: 1, deco: 'none', shadowD: 0, shadowB: 16 } },
    { id: 'scene', name: 'シーン', patch: { text: 'シーン3　夜の港', sub: 'Scene 3', pos: 'bottom', font: 'noto', size: 7, subSize: 3.6, subPos: 'above',
      anim: 'zip', stagger: 0.04, deco: 'bar', decoColor: '#000000', decoAlpha: 0.55, strokeW: 0 } },
  ],
  story: [
    { id: 'prologue', name: 'プロローグ', patch: {} },
    { id: 'window', name: 'メッセージ窓', patch: { text: '「……誰か、そこにいるの？」\n返事はない。ただ、廊下の奥で灯りが揺れた。', storyPos: 'bottom',
      font: 'rounded', size: 5.2, deco: 'box', decoColor: '#0b0b1e', decoAlpha: 0.78, anim: 'type', cps: 18, lineGap: 0.45, hold: 2 } },
    { id: 'typewriter', name: 'タイプライター', patch: { text: '1924年10月31日\nマサチューセッツ州 アーカム\n\n記録者：ハワード・P', font: 'dot',
      size: 5.5, anim: 'type', cps: 10, storyAlign: 'left', deco: 'none', shadowB: 10 } },
    { id: 'ending', name: 'エンディング', patch: { text: 'こうして、長い夜は明けた。\n\nけれど、あの洋館の扉は――\nいまも、誰かを待っている。', storyAlign: 'center',
      font: 'shippori', size: 6, anim: 'blur', inDur: 0.6, cps: 9, hold: 2.4 } },
  ],
};

if (typeof module !== 'undefined') module.exports = { TA_BASE, TA_TEMPLATES, TA_MODES };
