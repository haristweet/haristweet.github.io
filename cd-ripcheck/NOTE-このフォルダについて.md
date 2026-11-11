# このフォルダは haristweet.github.io のサイト本体とは無関係

`cd-ripcheck/` は CD リッピングの検査ツールで、GitHub Pages で公開している
サイトの中身ではない。単独のリポジトリとして切り出す前提で、作業ブランチに
一時的に置いてあるだけ。

**`main` にマージしないこと。** サイトの構成は `index.html` 1枚のまま。

Mac に持っていくときは、このフォルダを取り出して独立したリポジトリにする:

    cp -r cd-ripcheck ~/claude/cd-ripcheck
    cd ~/claude/cd-ripcheck
    rm NOTE-このフォルダについて.md
    git init && git add -A && git commit -m "cd-ripcheck: 初期実装"
