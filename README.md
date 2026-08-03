# つくったもの

ブラウザだけで動く自作の道具とゲームの一覧。

**https://haristweet.github.io/**

このリポジトリは GitHub の「ユーザーサイト」で、リポジトリ名がそのままドメイン名になる決まりのため
`haristweet.github.io` という名前になっている。1アカウントに1つだけ作れる。
配下の `haristweet.github.io/album-track-quiz/` などは各リポジトリの「プロジェクトサイト」で、
このリポジトリとは無関係に動いている。ここを更新しても各アプリには影響しない。

## 中身

`index.html` の1枚のみ。外部ライブラリもビルドも無い。

- **音と音楽** — ELECTRO ALBUM QUIZ／Album Art Downloader／テクノシーケンサー／AMEN GEN／SAM
- **ゲーム** — STAR RAIDER／弾避け練習／DEPTH 100／URL BATTLER／SUCCULENT／Kings Knight／勝手にスタンプラリー
- **道具** — 予定作成ツール／格ゲー大会ビューア／COSTUME FUSION

## 手入れするとき

アプリを足したら `index.html` に `.entry` を1つ増やし、`.tally` の件数と `.colophon` の版・更新日を直す。
バージョンは `.colophon` の `<span class="rev">` の1か所だけ。

デプロイは `cd ~/claude/haristweet.github.io && deploy-pages home haristweet.github.io`。

## 更新履歴（Changelog）

- **v1.1.0** (2026-08-03) — 🎮 「ゲーム」に **STAR RAIDER**（縦スクロールシューティング／`pc8001-shooter`）を追加。全15本に。
- **v1.0.1** (2026-07-17) — 🔗 リンクを**別タブで開く**ようにした（`target="_blank"` ＋ `rel="noopener"`）。目録に戻ってこられるので、続けて別のものを開ける。
- **v1.0.0** (2026-07-17) — 🗂 公開。ルートが404だったので目録を置いた。公開中の14本を「音と音楽5／ゲーム6／道具3」に分類してリンク。説明文は各ページを実際に開いて確認した内容で書いている（リポジトリの説明が10本分空だったため）。デザインはフロッピーのディスクメニューを下敷きに、配色は C64（VIC-II）由来。行を選ぶと選択バーが反転する。ダークは「画面」、ライトは同じ目録を「紙に刷った版」として作り分けた。

バージョンは脚注に表示。アプリの追加でマイナー繰り上げ、説明や体裁の修正でパッチ繰り上げ。
