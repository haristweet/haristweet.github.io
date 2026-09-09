# cd-ripcheck — Claude Code 向けの手引き

リッピングしたCDを聴かずに検査するツール。`README.md` に全体像がある。
ここには**このリポジトリを触るときに知っておくべきこと**だけを書く。

## 設計の原則（重要）

**検出に LLM を使わない。** 1曲ずつ Claude に判定させるのは遅く、高く、
そして CRC や波形解析より不正確。検出は決定論的なコードの仕事。

Claude の担当はその周り：

1. **トリアージ** — `work/report.jsonl` を読んで、再リップすべき盤を優先度つきで並べる
2. **チューニング** — 誤検出の傾向を見て `exclude.txt` と `thresholds.json` を直す
3. **傾向の発見** — 時期やドライブに偏りがないか（＝盤ではなく機材の問題か）
4. **コードの改良** — 新しい検出の追加、既存ロジックの修正

## よく使うコマンド

```bash
MUSIC_ROOT=~/Music ./scan.sh          # 一式。差分だけ走る
MUSIC_ROOT=~/Music ./scan.sh --rescan # 閾値を変えた後は全部やり直す
./triage.py --report work/report.jsonl --xld work/xld.jsonl \
            --flac-log work/flac_test.log --out work/report.md --clips work/suspect
```

集計だけなら jq が速い。

```bash
jq -r .type work/report.jsonl | sort | uniq -c | sort -rn        # 種類別の件数
jq -r .file work/report.jsonl | xargs -n1 dirname | sort | uniq -c | sort -rn | head -30
jq -r 'select(.type=="lossy_suspect") | "\(.cutoff_hz)\t\(.file)"' work/report.jsonl
```

## 閾値の実測値（勝手に変えないこと）

合成した欠陥入り音源で測った値。**この分離を壊さない範囲で調整する。**

| 項目 | 正常音源 | 欠陥入り | 現在の閾値 |
|---|---|---|---|
| `drop_ratio`（周囲の中央値との比） | 誤検出 0 | **実物の音飛びが -38.1dB** | 0.03（-30dB） |
| `lossy_sharpness_db`（高域の崖の落差） | 0.8 dB | mp3 63〜66 dB | 25 |
| `silence_min_ms` | — | CD 1セクタ = 13.3ms | 10 |
| `disc_ratio` | 実音楽で誤検出 1184 件 | 本物の音飛びが 12 | **既定で無効** |

**`drop_ratio` を 0.01（-40dB）に戻さないこと。** 実ファイルにあった本物の
音飛びは -38.1dB で、-40dB では取り逃す。この 1.9dB の差で見逃していた。

`lossy_sharpness_db` は 0.8 対 63 と桁で違うので、この閾値はほぼ動かす必要がない。

### discontinuity について

合成音源では機能したが、**実音楽では役に立たないことが実測で確定している。**
AAC の実ファイル1本（5分半）で誤検出 1184 件、同じファイルの本物の音飛びは
スコア 12（閾値 25 未満）。振幅比・局所中央値・立ち上がり比のどれを足しても
分離できなかった。安易に `disc_enabled: true` に戻さないこと。戻すなら、
必ず実音楽で誤検出件数を数えてから。

## 誤検出を減らすときの順番

1. **`exclude.txt` に足す** ← まずこれ。副作用が対象を限定できる
2. 特定の検出タイプだけ重みを下げる（`triage.py` の `WEIGHT`）
3. `thresholds.json` を触る ← 最後の手段。全体が鈍る

「テクノだから discontinuity が大量に出る」は閾値の問題ではなく対象の問題なので、
1 で解決する。

## 週次トリアージを頼まれたときにやること

```
work/report.jsonl と work/xld.jsonl を読んで:
1. 再リップすべき盤のリスト（優先度つき、理由つき）
2. 誤検出と判断できるパターン → exclude.txt への追記案
3. lossy_suspect の一覧 → 買い直し候補
4. 検出が特定の時期・ドライブに集中していないか（ドライブ劣化の兆候）
```

4 が地味に効く。「先月から急に検出が増えた」なら、盤ではなくドライブを疑う。
`work/xld.jsonl` に `drive` と `date` が入っているので突き合わせられる。

## やってはいけないこと

- **音源ファイルを削除・上書きしない。** このツールは読むだけ。再リップの判断は人間がする
- `work/report.jsonl` は追記型。過去の記録なので、消さずに追記する
- 閾値を「検出が多いから」という理由だけで上げない。まず中身を見る
- 検出ロジックを変えたら、`README.md` の実測値の表も直す

## コードの見取り図

- `ripcheck.py` — 検出ロジック。`analyze()` が入口。閾値は `Config` に集約
  - `moving_mean()` は O(n)。`np.convolve` に戻さないこと（数千曲でここが律速になる）
  - `find_discontinuities()` は振幅ではなく**局所的なざらつきとの比**で見る。ここが肝
  - `estimate_cutoff()` は高域スペクトルの「崖」を探す。閾値通過ではなく段差で見る
- `scan_library.py` — 走査。キャッシュは `パス → "サイズ:mtime"`
- `parse_xld_log.py` — XLD ログの緩いパーサ。書式は版によって揺れるので厳密にしない
- `triage.py` — 重みづけと Markdown 化。`WEIGHT` / `XLD_WEIGHT` が優先度を決める

## テストのしかた

合成音源で回帰を確認できる。欠陥を注入して `analyze()` に通す。

```python
import numpy as np, wave, ripcheck as R
# 正常音源に 40ms の完全無音を入れる → digital_silence が出るはず
# サンプルを733本削る（周期に揃わない長さ）→ discontinuity が出るはず
# 588サンプル（CD 1セクタ）を0にする → digital_silence が出るはず
# mp3 に通して戻す → lossy_suspect が出るはず
```

**正常音源で検出が 0 件であること**を必ず確認する。誤検出は運用を殺す。
