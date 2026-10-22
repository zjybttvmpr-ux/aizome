# Aizome（藍染）

ローカルAIでコード補完ができる、拡張しやすい多言語コードエディタです。Windows・Mac・Linux で動きます。

- **AI 補完**：入力を止めると、ローカルAI（Ollama など）の候補が薄く表示されます。Tab で確定、Ctrl/Alt+→ で1語ずつ確定、Esc で消せます。
- **多言語**：CodeMirror 6 の言語パックで、Python・JavaScript/TypeScript・Rust・Go・C/C++・Java・PHP・Ruby・HTML/CSS・SQL・Markdown など100以上の形式を色分けします。画面は日本語と英語に対応しています。
- **ターミナル**：下のパネルで本物のシェルが動きます。F5 か「実行」ボタンで、開いているファイルをすぐ試せます。出力に出た `main.py:12` のような場所はクリックで開けます。
- **拡張機能**：`extension.json` と `main.js` を入れたフォルダを追加するだけで、コマンド・テーマ・実行設定・言語を増やせます。拡張機能は Web Worker の中で動き、ファイルやターミナルを使うにはユーザーの許可が必要です。

### 0.2.0 で増えたこと

- **見た目**：背景色・アクセント色の変更（明るい色なら文字が自動で暗くなる）、背景画像（濃さ・暗さ・ぼかし・表示方法）、エディタのフォント、画面の拡大縮小（Ctrl+; / Ctrl+- / Ctrl+0）
- **AI 補完の改善**：同じ行の繰り返しや、上にあるコードの丸写しを出さない。Esc で消した候補は同じ場所で出し直さない。コメントで「〇〇する」と書いて改行すると、その内容から長めにコードを書く
- **AI チャット**（Ctrl+Shift+A）：開いているファイルや選択範囲について質問できる。答えのコードはボタンでエディタに挿入
- **AI で書き換え**（Ctrl+I）：選択範囲を指示どおりに書き換え、何も選んでいなければ指示からコードを書く。確認してから適用。コメント付け・不具合修正の定型コマンドもあり
- **フォルダ全体の検索**（Ctrl+Shift+F）：大文字小文字・単語単位・正規表現
- **Markdown プレビュー**（Ctrl+Shift+V）、パンくず、集中モード（Ctrl+Alt+Z）、全画面（F11）
- **作業の便利機能**：最近開いたフォルダ（Ctrl+R）、前回のタブの復元、閉じるときの未保存確認、自動保存、保存時の行末空白の削除と最終改行、すべて保存、保存済みに戻す、タブの切り替え（Ctrl+Tab）
- **Git**：ステータスバーにブランチ名と変更数、ファイルツリーに変更（M）・未追跡（U）の印

## 必要なもの

| もの | 用途 | 入手先 |
|---|---|---|
| Node.js 20 以上 | 画面側のビルド | https://nodejs.org |
| Rust（stable） | アプリ本体のビルド | https://rustup.rs |
| Tauri の OS 別の準備 | WebView などの開発用ライブラリ | https://v2.tauri.app/start/prerequisites/ |
| Ollama（任意） | AI 補完 | https://ollama.com |

OS 別の準備の例：

- **Windows**：「C++ によるデスクトップ開発」を含む Visual Studio Build Tools と WebView2（Windows 11 には最初から入っています）
- **Mac**：`xcode-select --install`
- **Ubuntu / Debian**：`sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev`

## 起動のしかた

```bash
npm install
npm run app        # 開発モードで起動（tauri dev）
```

配布用のインストーラーを作るとき：

```bash
npm run app:build  # src-tauri/target/release/bundle/ に出力
```

アイコンを差し替えたいときは、1024×1024 の PNG を用意して `npx tauri icon 画像.png` を実行してください。

## AI 補完の準備（Ollama の場合）

```bash
ollama pull qwen2.5-coder:1.5b   # 軽くて速い。GPU があれば 7b も実用的
ollama serve                     # 常駐していれば不要
```

エディタの設定（左下の歯車）→「AI 補完」で、モデル名を選びます。「一覧を取得」を押すと、入っているモデルが候補に出ます。

- 補完には **FIM（途中埋め）に対応したコード用モデル** を使ってください。チャット用モデルだと、説明文が混ざることがあります。
- llama.cpp の `llama-server` や LM Studio を使うときは、「接続先の種類」を「OpenAI 互換」にして、エンドポイントを `http://127.0.0.1:8080` などにします。
- 右上の滴のマークが AI の状態です。考えている間は揺れ、つながらないときは赤くなります。クリックで詳細が出ます。

## 主なショートカット

Mac では Ctrl の代わりに Cmd を使います。

| 操作 | キー |
|---|---|
| フォルダを開く | Ctrl+O |
| ファイルを探して開く | Ctrl+P |
| コマンドパレット | Ctrl+Shift+P または F1 |
| 保存 / 名前を付けて保存 | Ctrl+S / Ctrl+Shift+S |
| タブを閉じる | Ctrl+W |
| このファイルを実行 | F5 |
| ターミナルの表示を切り替え / 新しいターミナル | Ctrl+` / Ctrl+Shift+` |
| サイドバーの表示を切り替え | Ctrl+B |
| AI 補完を今すぐ出す | Alt+\ |
| 行へ移動 | Ctrl+G |
| 検索と置換 | Ctrl+F |

## フォルダ構成

```
src/                  画面側（TypeScript）
  app.ts              全体の組み立て（タブ、保存、実行、コマンド）
  core/               設定・翻訳・コマンド・ネイティブ呼び出し（platform.ts）
  editor/             CodeMirror 6 と AI のゴーストテキスト（ghost.ts）
  ai/                 ローカルAIへのリクエスト管理と、候補の整形
  terminal/           xterm.js のパネルと「実行」設定
  extensions/         拡張機能ホストと Worker の中身
  ui/                 ファイルツリー、パレット、ダイアログ、設定画面など
  styles/app.css      見た目（色はすべて CSS 変数）
public/extensions/    組み込み拡張機能（テーマ、実行設定、ツールキット）
src-tauri/            アプリ本体（Rust）
  src/fsops.rs        ファイル操作
  src/pty.rs          ターミナル（疑似端末）
  src/ai.rs           Ollama / OpenAI 互換サーバーへの中継（ストリーミング）
  src/extensions.rs   ユーザー拡張機能の追加・削除
docs/                 拡張機能の作り方とサンプル
```

## ボタン一つで配れるようにする（GitHub）

このフォルダを GitHub のリポジトリに置くと、インストーラー作りとダウンロードページの公開を GitHub が自動でやってくれます。

1. GitHub で新しいリポジトリを作り、このフォルダの中身を push します。
2. リポジトリの **Settings → Pages** で、Source を **GitHub Actions** にします。
3. バージョンのタグを付けて push します。
   ```bash
   git tag v0.1.0
   git push origin v0.1.0
   ```
4. **Actions** タブで「Release」が終わるのを待ちます（20〜30分）。Windows・Mac・Linux のインストーラーがリリースに載ります。
5. ダウンロードページは `https://<ユーザー名>.github.io/<リポジトリ名>/` です。開いた人の OS に合ったボタンが自動で出ます。

新しいバージョンを出すときは、`package.json`・`src-tauri/tauri.conf.json`・`src-tauri/Cargo.toml` の version を上げて、同じ番号のタグを push します。ページは自動で最新版を指します。

配布版には電子署名が入っていないため、初回だけ Windows や Mac で確認画面が出ます。開き方はダウンロードページに書いてあります。

## 拡張機能

作り方は [docs/EXTENSIONS.md](docs/EXTENSIONS.md) を見てください。`docs/examples/hello-extension` をサイドバーの「拡張機能」→「フォルダから追加」で選ぶと、すぐ試せます。

## まだ入っていないもの（次の候補）

- LSP（定義へジャンプ、型のエラー表示など）。設計上は拡張機能の追加ポイントとして足せます
- Git の表示、ファイル全体の検索、エディタの分割
- 閉じるときの未保存確認（タブを閉じるときの確認はあります）
- 拡張機能のオンライン配布
