# 拡張機能の作り方

拡張機能は、次の2つのファイルを入れたフォルダです。

```
my-extension/
  extension.json   マニフェスト（必須）
  main.js          動きを書くスクリプト（任意）
```

テーマや実行設定だけなら `extension.json` だけで作れます。

## 追加のしかた

サイドバーの「拡張機能」→「フォルダから追加」でフォルダを選びます。アプリのデータフォルダの `extensions/<id>/` にコピーされます（場所は「保存先をコピー」で確認できます）。

コードを書き換えたら、コピー先を直接編集して「再読み込み」を押すか、もう一度「フォルダから追加」で上書きしてください。

## extension.json

```json
{
  "id": "yourname.hello",
  "name": "Hello",
  "version": "0.1.0",
  "description": "あいさつを挿入する",
  "main": "main.js",
  "permissions": ["workspace.read"],
  "contributes": {
    "commands": [
      { "id": "hello.insert", "title": "あいさつを挿入", "key": "Mod-Alt-H" }
    ],
    "themes": [],
    "runConfigs": [],
    "languages": []
  }
}
```

| 項目 | 内容 |
|---|---|
| `id` | 英数字と `.` `-` `_` だけ。ほかの拡張機能と重ならない名前にします |
| `main` | Worker で動かすスクリプト。なければコードは動かず、`contributes` だけが使われます |
| `permissions` | 使う権限。初めて読み込むときにユーザーへ確認が出ます |
| `contributes.commands` | コマンドパレットに出るコマンド。`key` は `Mod-Shift-K` の形式（Mod は Windows/Linux で Ctrl、Mac で Cmd） |
| `contributes.themes` | テーマ（後述） |
| `contributes.runConfigs` | 「実行」ボタンの設定（後述） |
| `contributes.languages` | 新しい拡張子を既存の言語として色分けする。例：`{ "extensions": [".jsonc"], "basedOn": ".json" }` |

### 権限

| 権限 | できること |
|---|---|
| `workspace.read` | 開いているフォルダの中のファイルを読む、一覧を見る |
| `workspace.write` | 開いているフォルダの中のファイルに書き込む |
| `terminal` | ターミナルでコマンドを実行する |
| `ai` | ローカルAIに文章を生成させる |

開いているエディタの文字の読み書き、メッセージ表示、ステータスバーは権限なしで使えます。ネットワーク（`fetch` など）は使えません。

## main.js

`activate(aizome)` という関数を書くと、起動時に1回呼ばれます。API はすべて Promise を返します。

```js
function activate(aizome) {
  aizome.commands.register("hello.insert", async () => {
    const name = await aizome.window.showInput({ title: "名前は？", placeholder: "藍子" });
    if (name) await aizome.editor.insertText(`こんにちは、${name}さん`);
  });
}
```

### API 一覧

| API | 説明 |
|---|---|
| `aizome.commands.register(id, handler)` | コマンドの処理を登録する |
| `aizome.commands.execute(id, ...args)` | 別のコマンドを実行する（例：`"file.save"`） |
| `aizome.window.showMessage(text, kind?)` | 通知を出す。`kind` は `info` `success` `warn` `error` |
| `aizome.window.showInput({ title, value, placeholder })` | 1行入力。キャンセルなら `null` |
| `aizome.window.showQuickPick(items, { placeholder })` | 選択肢を出す。`items` は文字列か `{ label, detail, value }` |
| `aizome.editor.getText()` | 開いているファイルの全文 |
| `aizome.editor.getSelection()` | 選択中の文字 |
| `aizome.editor.replaceSelection(text)` | 選択範囲を置き換える |
| `aizome.editor.insertText(text)` | カーソル位置に挿入する |
| `aizome.editor.activeFile()` | 開いているファイルのパス（無題なら `null`） |
| `aizome.editor.language()` | 言語名（例：`"Python"`） |
| `aizome.editor.cursor()` | `{ line, col }` |
| `aizome.workspace.root()` | 開いているフォルダのパス |
| `aizome.workspace.readFile(path)` | `workspace.read` が必要。相対パスはフォルダからの位置 |
| `aizome.workspace.listDir(path)` | `workspace.read` が必要 |
| `aizome.workspace.writeFile(path, content)` | `workspace.write` が必要 |
| `aizome.workspace.openFile(path)` | エディタでファイルを開く |
| `aizome.terminal.run(command)` | `terminal` が必要。ターミナルにコマンドを送る |
| `aizome.ai.complete(prompt, { maxTokens, temperature })` | `ai` が必要。生成した文字列を返す |
| `aizome.statusBar.set(id, text, tooltip?)` / `clear(id)` | ステータスバーに表示する |
| `aizome.on(event, fn)` | `activeChanged` `fileSaved` `workspaceChanged` を受け取る。戻り値で解除 |

## テーマ

色は CSS 変数で指定します。書かなかった変数は標準の「藍」の色のままです。主な変数は `src/styles/app.css` の先頭にあります。

```json
{
  "id": "yourname.matcha",
  "label": "抹茶",
  "scheme": "dark",
  "colors": {
    "--bg": "#17201a",
    "--panel": "#1b251e",
    "--editor-bg": "#19221c",
    "--accent": "#9cc37a",
    "--accent-contrast": "#13200c",
    "--syn-keyword": "#b6d98f"
  }
}
```

## 実行設定

```json
{
  "id": "zig",
  "label": "Zig",
  "extensions": [".zig"],
  "command": "cd \"${fileDir}\" && zig run \"${fileBase}\"",
  "windows": "Set-Location \"${fileDir}\"; zig run \"${fileBase}\""
}
```

使える変数：`${file}`（フルパス）、`${fileDir}`、`${fileBase}`（ファイル名）、`${fileNoExt}`、`${fileBaseNoExt}`、`${workspace}`。`windows` は Windows（PowerShell）で使うコマンドで、省略すると `command` を使います。後から追加した拡張機能の設定が優先されます。
