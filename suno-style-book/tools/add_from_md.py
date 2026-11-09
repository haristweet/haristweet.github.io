#!/usr/bin/env python3
"""Suno スタイル帳に、決まった形の .md からプロンプトを足す。

使い方:
  python3 suno-style-book/tools/add_from_md.py 新しいプロンプト.md --check   # 足さずに中身を確かめる
  python3 suno-style-book/tools/add_from_md.py 新しいプロンプト.md            # data.json に足す

.md の形（suno_prompts.md と同じ）:
  # 1. 見出し（地域や時代のまとまり。検索に使われる）
  ### 曲調の名前
  <!-- 分類: ポップス -->            ← 省略すると --cat の値、それもなければ止まる
  <!-- 曲: 苦悩の人 -->              ← 作った曲なら書く（書かなければ「ひな形」）
  <!-- まとめる: 日本語ロック -->      ← 近い版を1枚のカードにまとめたいとき
  **Style of Music**
  ```
  ...
  ```
  **Exclude Styles**
  ```
  ...
  ```
  - メモ1
  - メモ2

確かめること（--check でも同じ）:
  - 2語より長い [タグ] がメモにないか（Suno は長いタグを歌ってしまう）
  - Style にある言葉を Exclude でも消していないか
  - 年と BPM が書いてあるか
  - すでに同じ名前・同じ Style のものがないか
"""
import argparse, json, re, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
DATA = HERE / 'data.json'
CATS = ['歌謡曲','ポップス','ロック／パンク','フォーク','R&B／ソウル','ジャズ／フュージョン','ヒップホップ','ビッグビート',
        'ブレイクコア／DnB','ハウス／ディスコ','テクノ','80s／シンセ','アンビエント／エレクトロニカ','クラシカル／劇伴','ラウンジ','EDM／ベース','ワールド','いまの流行','その他']


def parse(md: str, default_cat):
    out, section = [], ''
    for part in re.split(r'^(# .+)$', md, flags=re.M):
        if part.startswith('# '):
            section = re.sub(r'^#\s*\d+\.\s*', '', part[2:]).strip(); continue
        for blk in re.split(r'^### ', part, flags=re.M)[1:]:
            name = blk.split('\n', 1)[0].strip()
            code = re.findall(r'```\n(.*?)\n```', blk, re.S)
            if len(code) < 2:
                sys.exit(f'「{name}」: Style と Exclude のコードブロックが2つ見つかりません')
            meta = dict(re.findall(r'<!--\s*(分類|曲|まとめる)\s*:\s*(.+?)\s*-->', blk))
            notes = [l[2:].strip() for l in blk.split('\n') if l.startswith('- ')]
            out.append(dict(section=section, name=name, style=code[0].strip(), exclude=code[1].strip(), notes=notes,
                            cat=meta.get('分類', default_cat), song=meta.get('曲'), set=meta.get('まとめる')))
    return out


def check(e, existing):
    warn = []
    for n in e['notes']:
        for t in re.findall(r'\[[^\]]+\]', n):
            if len(t.split()) > 2 or ',' in t: warn.append(f'長いタグ {t}（歌われるので短く）')
    st = e['style'].lower()
    for t in [x.strip() for x in e['exclude'].split(',') if x.strip()]:
        if t not in ('vocals', 'singing') and re.search(r'\b' + re.escape(t.lower()) + r'\b', st):
            warn.append(f'Style にある「{t}」を Exclude でも消している')
    if not re.search(r'\b(19|20)\d\d', e['style']): warn.append('年が書いていない')
    if not re.search(r'\d+\s*bpm', e['style'], re.I): warn.append('BPM が書いていない')
    if e['cat'] not in CATS: warn.append(f'分類「{e["cat"]}」がない（{" / ".join(CATS)}）')
    for x in existing:
        if x['style'] == e['style']: warn.append(f'同じ Style がすでにある（{x["id"]} {x["genre"]}）')
        elif x['genre'] == e['name'] and x['song'] == (e['song'] or '汎用テンプレート'): warn.append(f'同じ名前がすでにある（{x["id"]}）')
    return warn


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('md'); ap.add_argument('--cat'); ap.add_argument('--check', action='store_true')
    a = ap.parse_args()
    data = json.loads(DATA.read_text())
    ents = parse(Path(a.md).read_text(), a.cat)
    bad = 0
    for e in ents:
        w = check(e, data)
        print(('⚠ ' if w else '✓ ') + f'[{e["cat"]}] {e["name"]}')
        for x in w: print('    - ' + x)
        bad += any(('分類' in x or '同じ' in x) for x in w)
    if a.check: return
    if bad: sys.exit('分類が無い・重複しているものがあるので、足していません。直してからもう一度。')
    nid = max(int(x['id'][1:]) for x in data) + 1
    for e in ents:
        song = e['song'] or '汎用テンプレート'
        rec = {'group': e['section'] or '追加分', 'song': song, 'genre': e['name'], 'cat': e['cat'], 'mix': '', 'mixStatus': '',
               'style': e['style'], 'exclude': e['exclude'], 'notes': e['notes'], 'id': f's{nid}', 'title': f'{song} — {e["name"]}'}
        if e['set']: rec['set'] = e['set']
        data.append(rec); nid += 1
    DATA.write_text(json.dumps(data, ensure_ascii=False, indent=1))
    print(f'{len(ents)} 件を足しました（全 {len(data)} 件）。index.html の VERSION と更新履歴も上げてください。')


if __name__ == '__main__':
    main()
