// 使い方とヘルプ（/help）。左に項目、右に本文。上の検索欄で全部から探せる
import { h, clear } from "../core/dom";
import { commands, formatKey } from "../core/commands";
import { normalizeQuery } from "../core/jpText";
import { renderMarkdown } from "./markdown";
import { icon } from "./icons";
import { listSlash, slashNames } from "./slash";

interface Section {
  id: string;
  label: string;
  icon: string;
  body: () => string;
}

const k = (key: string) => `<kbd>${formatKey(key)}</kbd>`;

function slashTable(): string {
  const groups = new Map<string, ReturnType<typeof listSlash>>();
  for (const c of listSlash()) {
    if (!groups.has(c.group)) groups.set(c.group, []);
    groups.get(c.group)!.push(c);
  }
  let md = "";
  for (const [group, list] of groups) {
    md += `\n### ${group}\n\n| 呼び出し方 | できること |\n|---|---|\n`;
    for (const c of list) {
      const names = slashNames(c)
        .slice(0, 4)
        .map((n) => `<a href="#slash:${encodeURIComponent(c.name)}">/${n}</a>`)
        .join(" ");
      const arg = c.argHint ? ` <span class="help-arg">${c.argHint()}</span>` : "";
      md += `| ${names}${arg} | ${c.title()}${c.desc ? `<br><span class="help-sub">${c.desc()}</span>` : ""} |\n`;
    }
  }
  return md;
}

function shortcutTable(): string {
  const rows = commands
    .list()
    .filter((c) => c.key)
    .map((c) => [commands.title(c), formatKey(c.key!)] as const)
    .sort((a, b) => a[0].localeCompare(b[0], "ja"));
  const editorKeys: [string, string][] = [
    ["AI の候補・候補の一覧を入力", "Tab"],
    ["一覧が出ていても AI の候補を確定", "Alt+Enter"],
    ["AI の候補を 1 語ずつ確定", "Ctrl+→ / Alt+→"],
    ["AI の候補を今すぐ出す", "Alt+\\"],
    ["候補を消す・一覧を閉じる", "Esc"],
    ["候補の一覧を出す", "Ctrl+Space"],
    ["実行中のプログラムを止める（ターミナル）", "Ctrl+C"],
  ];
  return (
    "| 操作 | キー |\n|---|---|\n" +
    [...editorKeys, ...rows].map(([a, b]) => `| ${a} | <kbd>${b}</kbd> |`).join("\n")
  );
}

function sections(): Section[] {
  return [
    {
      id: "start",
      label: "はじめに",
      icon: "help",
      body: () => `
# あいぞめへようこそ

ローカルの AI がコードの続きを考えてくれる、日本語で使いやすいコードエディタです。

## まずはこれだけ

1. **ファイルを作る・開く**：${k("Mod-N")} で新しいファイル、${k("Mod-O")} でフォルダを開きます。ファイルを画面にドラッグしても開けます。
2. **書く**：手を止めると、AI の候補が薄い文字で出ます。**Tab** で入力、**Esc** で消せます。
3. **実行する**：右上の「▶ 実行」か **F5**。下のターミナルに結果が出ます。
4. **困ったら**：上の検索欄（${k("Mod-P")}）で **/** を打つと、便利機能の一覧が出ます。**/help** でこの画面です。

## 上の検索欄でできること

| 打つもの | できること |
|---|---|
| ファイル名の一部 | フォルダの中のファイルを開く |
| **/** | 便利機能の一覧（/保存、/日付、/計算、/エラー など） |
| **/help** | この使い方の画面 |
| **/辞書 並べ替え** | コード辞書から「やりたいこと」で探して、そのまま入れる |
| **>** | メニューにあるすべての操作を探す |

## コード辞書

左の 📖 ボタン（${k("Mod-Shift-D")}）で開きます。「並べ替え」「ファイル 読む」「ジャンプ」のように **やりたいことを日本語で** 探して、「入れる」を押すとコードが入ります。
入れたあとは **Tab** で、名前や値など書き換える場所へ順に移動できます。
Python・JavaScript・C#（Unity）・Go・C・C++・Java・HTML・CSS・シェルに対応していて、開いているファイルに合わせて自動で切り替わります。
辞書にないときは「AI に書き方を聞く」、よく使うコードはエディタで選んで ＋ を押すと「自分の辞書」に保存できます。

/ のあとは、英語・日本語・ひらがな・ローマ字のどれでも探せます。例：<a href="#slash:date">/日付</a>、/ひづけ、/hiduke はどれも同じです。
`,
    },
    {
      id: "slash",
      label: "/ 便利機能の一覧",
      icon: "wand",
      body: () => `
# / 便利機能の一覧

上の検索欄（${k("Mod-P")}）で **/** を打つと呼び出せます。名前をクリックしてもすぐ使えます。
後ろに言葉を書けるものもあります（例：**/計算 1200*1.1**、**/探す print**、**/聞く for文の使い方**、**/行 30**）。
${slashTable()}`,
    },
    {
      id: "ai",
      label: "AI 補完と AI 機能",
      icon: "spark",
      body: () => `
# AI 補完と AI 機能

## 薄い文字の候補（AI 補完）

- 入力を止めると、AI が続きを考えて薄い文字で見せます。**Tab** で入力、**Ctrl+→** で 1 語ずつ、**Esc** で消します。
- Esc で消した候補は、同じ場所では出し直しません。
- 単語の途中（例：\`impo\`）では今の行だけ、新しい行の頭や \`:\` \`{\` の直後ではブロックの中身を数行だけ出します。
- **コメントで頼める**：\`# 1 から 10 までの合計を出す\` と書いて改行すると、その内容のコードを提案します。
- ファイルの拡張子から「何語のファイルか」を AI に伝えるので、Python・Go・JavaScript など言語に合った候補になります。

## 入力中の候補一覧

AI とは別に、打った文字で始まる名前の一覧が出ます。**Tab** で選んでいるものを入力（↑↓ で選ぶ）。
一覧が出ていても AI の候補を入れたいときは **Alt+Enter**。設定 → エディタ で Enter に変えたり、Ctrl+Space のときだけにしたりできます。

## 行の横の説明

各行の右に「← 「こんにちは」と表示します」のような説明が薄く出ます。よくある書き方はすぐに、ほかの行は手を止めたときに AI が説明します（✦ 印）。
${k("Mod-Alt-E")} か <a href="#slash:lines">/行の説明</a> で表示・非表示を切り替えます。

## そのほかの AI 機能

| 呼び出し方 | できること |
|---|---|
| <a href="#slash:ai">/聞く</a> | 横の AI チャットで質問する |
| <a href="#slash:explain">/説明</a> | 選んだコードを日本語で説明 |
| <a href="#slash:comment">/コメント</a> | 選んだコードに日本語のコメントを付ける |
| <a href="#slash:fix">/直す</a> | 選んだコードのまちがいを直す |
| <a href="#slash:error">/エラー</a> | ターミナルのエラーを日本語で解説 |
| <a href="#slash:build">/構築</a> | 日本語の手順からプログラムを組み立てる |

## AI の準備

- パソコンに Ollama が入っていれば、起動時に自動で見つけてつなぎます。USB メモリの中のモデルも探します。
- 見つからないときは、設定 → AI の「AI を探す」か、**.gguf** ファイルを画面にドラッグしてください。
- おすすめのモデル：\`qwen2.5-coder:1.5b\`（軽い）、\`qwen2.5-coder:7b\`（賢い・少し重い）。
`,
    },
    {
      id: "build",
      label: "日本語から組み立て",
      icon: "wand",
      body: () => `
# 日本語から組み立てる

\`###構築py###\` のような行の下に、やりたいことを日本語で箇条書きにして、行の横の **▶ 組み立てる** を押す（または ${k("Mod-Shift-Enter")}）と、AI がプログラムにします。

\`\`\`
###構築py###
空のリスト a を作る
1 から 10 まで繰り返す
  数を a に入れる
a の合計を表示する
\`\`\`

- \`py\` の部分を \`js\` \`go\` \`c\` などに変えると、その言語で作ります。
- <a href="#slash:template">/ひな形</a> で見本が入ります。
`,
    },
    {
      id: "run",
      label: "実行とターミナル",
      icon: "terminal",
      body: () => `
# 実行とターミナル

- **F5** か「▶ 実行」で、開いているファイルを実行します（Python・JavaScript・Go・C/C++・Java・Ruby など）。
- 終わると「--- 終了しました（終了コード 0）---」と出ます。**0 なら正常**、それ以外はエラーで終わっています。
- 実行中に止めるには ■（または Ctrl+C）。🔁 でもう一度実行。
- ターミナルはコマンドプロンプトのように使えます。▾ から PowerShell・cmd・Git Bash などを選べます。
- 出力の \`ファイル名:行\` をクリックすると、その行へ移動します。

## エラーが出たら

ターミナルの ⚠ ボタンか <a href="#slash:error">/エラー</a> で、最後のエラーを **日本語で** 説明します。
「その行へ移動」「ライブラリを入れる」「AI にくわしく聞く」もボタン一つです。

## Python のライブラリを入れる

<a href="#slash:pip">/pip numpy</a> のように書くと、ターミナルで入れます。
`,
    },
    {
      id: "japanese",
      label: "日本語の便利機能",
      icon: "text",
      body: () => `
# 日本語の便利機能

## 全角のまちがいを見つける・直す

日本語入力のまま \`（\` \`：\` \`＝\` や全角スペースを打つと、エラーになります。
あいぞめは、コードの中（文字列とコメント以外）の全角文字に **赤い波線**、全角スペースに **四角い印** を付けます。マウスを乗せると、どの文字かがわかります。

<a href="#slash:hankaku">/半角</a> で、文字列とコメント以外の全角記号をまとめて半角に直せます（範囲を選んでいれば、その範囲だけ）。

## 文字の変換

| 呼び出し方 | できること |
|---|---|
| <a href="#slash:hankaku">/半角</a> | 全角英数・記号 → 半角 |
| <a href="#slash:zenkaku">/全角</a> | 半角英数・記号 → 全角（選んだ範囲） |
| <a href="#slash:kana">/半角カナ</a> | ｶﾀｶﾅ → カタカナ |
| <a href="#slash:katakana">/カタカナ</a> ・ <a href="#slash:hiragana">/ひらがな</a> | ひらがな ⇄ カタカナ |
| <a href="#slash:count">/文字数</a> | 文字数・行数・原稿用紙の枚数 |

範囲を選ぶと、下のステータスバーにも選んだ文字数が出ます。

## 入力の手助け

| 呼び出し方 | できること |
|---|---|
| <a href="#slash:date">/日付</a> | 2026年10月22日（木）・令和・2026-10-22 などから選んで入力 |
| <a href="#slash:time">/時刻</a> | 今の時刻 |
| <a href="#slash:calc">/計算 1200*1.1</a> | 計算（全角数字や × ÷ も使える）。結果をコピーまたは入力 |
| <a href="#slash:header">/ヘッダー 名前</a> | 先頭に「ファイル名・作成日・作成者・説明」のコメント（課題の提出に便利） |
| <a href="#slash:todo">/やること</a> | TODO・FIXME の行の一覧から移動 |
`,
    },
    {
      id: "keys",
      label: "ショートカット",
      icon: "keyboard",
      body: () => `
# ショートカット

${shortcutTable()}
`,
    },
    {
      id: "faq",
      label: "困ったとき",
      icon: "alert",
      body: () => `
# 困ったとき

### 実行しても「Python」とだけ出て、結果が出ない
Python が入っていないときに Windows が用意している、Microsoft Store 案内用の仮の \`python\` が動いています。
実行すると入れ方を案内するので、「Python を入れる」を押してください。<a href="#slash:python">/python</a> で確かめられます。

### 「AI に接続できません」と出る
<a href="#slash:detect">/AIを探す</a> を試してください。Ollama が入っていなければ、設定 → AI から .gguf ファイルを選ぶこともできます。
会社や学校のネットワークでダウンロードできない場合は、USB メモリにモデルを入れて読み込めます。

### AI の候補が的外れ・長すぎる
小さいモデル（1.5b）は精度が低めです。できれば \`qwen2.5-coder:7b\` を使ってください。
コメントで「何をしたいか」を書いてから改行すると、意図に沿った候補になりやすくなります。

### 文字化けする
ターミナルは UTF-8 にしてあります。Python で古いファイルを読むときは \`open(…, encoding="cp932")\` を試してください。

### 全角の印がじゃま
<a href="#slash:zenkakucheck">/全角チェック</a> で表示・非表示を切り替えます。

### ウイルス対策ソフト（ノートンなど）が反応する
署名のない新しいソフトなので、反応することがあります。あいぞめのフォルダを除外に入れると落ち着きます。

### 更新したい
自動で新しい版を確かめ、左下に「更新があります」と出ます。<a href="#slash:update">/更新</a> でも確かめられます。インストールし直す必要はありません。
`,
    },
  ];
}

class HelpPage {
  private el: HTMLElement | null = null;
  private current = "start";
  private query = "";
  /** / の便利機能を実行する（ヘルプを閉じてから） */
  runSlash: (name: string) => void = () => {};

  get isOpen() {
    return !!this.el;
  }

  open(section?: string) {
    if (section) this.current = section;
    if (!this.el) {
      this.el = h("div", { class: "settings-page help-page", role: "dialog", "aria-label": "使い方とヘルプ" });
      this.el.addEventListener("click", (e) => {
        const a = (e.target as HTMLElement).closest("a");
        const href = a?.getAttribute("href") ?? "";
        if (href.startsWith("#slash:")) {
          e.preventDefault();
          const name = decodeURIComponent(href.slice(7));
          this.close();
          this.runSlash(name);
        } else if (href.startsWith("#")) e.preventDefault();
      });
      document.body.append(this.el);
      document.addEventListener("keydown", this.onKey, true);
    }
    this.render();
  }

  close() {
    this.el?.remove();
    this.el = null;
    this.query = "";
    document.removeEventListener("keydown", this.onKey, true);
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && !document.querySelector(".modal-backdrop, .palette-backdrop, .menu")) {
      e.preventDefault();
      e.stopPropagation();
      this.close();
    }
  };

  private render() {
    const el = this.el!;
    clear(el);
    const all = sections();
    const search = h("input", { class: "text-input set-search", type: "search", placeholder: "使い方を探す（例：エラー、日付、AI）", value: this.query, spellcheck: "false" });
    const content = h("div", { class: "set-content help-content" });
    search.addEventListener("input", () => {
      this.query = search.value;
      this.renderContent(content, all);
      nav.querySelectorAll(".set-nav-item").forEach((b) => b.classList.toggle("active", !this.query && b.getAttribute("data-id") === this.current));
    });
    const nav = h(
      "nav",
      { class: "set-nav" },
      ...all.map((s) =>
        h(
          "button",
          {
            class: "set-nav-item" + (s.id === this.current && !this.query ? " active" : ""),
            type: "button",
            "data-id": s.id,
            onclick: () => {
              this.current = s.id;
              this.query = "";
              this.render();
            },
          },
          h("span", { html: icon(s.icon, 15) }),
          h("span", {}, s.label),
        ),
      ),
    );
    el.append(
      h(
        "div",
        { class: "set-side" },
        h("div", { class: "set-head" }, h("h2", {}, "使い方とヘルプ"), h("button", { class: "icon-btn", type: "button", title: "閉じる", "aria-label": "閉じる", html: icon("x", 16), onclick: () => this.close() })),
        search,
        nav,
      ),
      content,
    );
    this.renderContent(content, all);
    if (this.query) search.focus();
  }

  private renderContent(content: HTMLElement, all: Section[]) {
    clear(content);
    content.scrollTop = 0;
    const q = normalizeQuery(this.query.trim());
    if (!q) {
      const s = all.find((x) => x.id === this.current) ?? all[0];
      content.append(h("div", { class: "md-preview help-body" }, renderMarkdown(s.body())));
      return;
    }
    // 検索：見出しごとに分けて、言葉を含むところだけ見せる
    let hits = 0;
    for (const s of all) {
      const md = s.body();
      const parts = md.split(/\n(?=#{2,3} )/);
      const found = parts.filter((p) => normalizeQuery(p.replace(/<[^>]+>/g, "")).includes(q));
      if (!found.length) continue;
      hits += found.length;
      content.append(h("h2", { class: "set-group-title" }, s.label), h("div", { class: "md-preview help-body" }, renderMarkdown(found.join("\n"))));
    }
    if (!hits) content.append(h("p", { class: "set-empty" }, "見つかりませんでした。別の言葉で探すか、/聞く で AI に質問してみてください。"));
  }
}

export const helpPage = new HelpPage();
