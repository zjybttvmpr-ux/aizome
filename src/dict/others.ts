import type { DictLanguage } from "./types";

export const go: DictLanguage = {
  id: "go",
  label: "Go",
  exts: [".go"],
  entries: [
    ["基本", "プログラムのひな形", "main package ひな形", "package main\n\nimport \"fmt\"\n\nfunc main() {\n    ⟨fmt.Println(\"こんにちは\")⟩\n}"],
    ["基本", "表示する", "Println Printf 表示 出力", "fmt.Println(⟨\"こんにちは\"⟩)"],
    ["基本", "書式つきで表示", "Printf 書式 %d %s", "fmt.Printf(\"⟨%s は %d です⟩\\n\", ⟨name⟩, ⟨n⟩)"],
    ["基本", "変数を作る", "変数 := var 宣言", "⟨x⟩ := ⟨10⟩"],
    ["基本", "入力を読む", "Scan 入力", "var ⟨n⟩ int\nfmt.Scan(&⟨n⟩)"],
    ["条件・繰り返し", "もし〜なら", "if else 条件", "if ⟨条件⟩ {\n    ⟨⟩\n} else {\n    \n}"],
    ["条件・繰り返し", "決まった回数くり返す", "for ループ 回数", "for ⟨i⟩ := 0; ⟨i⟩ < ⟨10⟩; ⟨i⟩++ {\n    ⟨⟩\n}"],
    ["条件・繰り返し", "スライスの中身を順に", "range for 要素", "for ⟨i⟩, ⟨v⟩ := range ⟨items⟩ {\n    fmt.Println(i, v)\n}"],
    ["条件・繰り返し", "条件のあいだくり返す（while の代わり）", "for while ループ", "for ⟨条件⟩ {\n    ⟨⟩\n}"],
    ["条件・繰り返し", "値によって分ける", "switch case", "switch ⟨x⟩ {\ncase ⟨1⟩:\n    ⟨⟩\ndefault:\n}"],
    ["データ", "スライスを作って追加", "slice append 配列 追加", "⟨items⟩ := []⟨int⟩{}\n⟨items⟩ = append(⟨items⟩, ⟨1⟩)"],
    ["データ", "マップ（辞書）を使う", "map 辞書 キー", "⟨m⟩ := map[string]int{}\n⟨m⟩[\"⟨key⟩\"] = ⟨1⟩\nif v, ok := ⟨m⟩[\"⟨key⟩\"]; ok {\n    fmt.Println(v)\n}"],
    ["データ", "並べ替え", "sort 並べ替え slices", "import \"sort\"\n\nsort.Ints(⟨items⟩)"],
    ["データ", "構造体", "struct 構造体 型", "type ⟨User⟩ struct {\n    ⟨Name⟩ string\n    ⟨Age⟩  int\n}"],
    ["関数", "関数を作る", "func 関数", "func ⟨name⟩(⟨x int⟩) ⟨int⟩ {\n    ⟨⟩\n    return ⟨x⟩\n}"],
    ["関数", "エラーを返す関数と受け取り方", "error エラー 処理 err", "func ⟨load⟩() (⟨string⟩, error) {\n    return \"\", fmt.Errorf(\"⟨失敗しました⟩\")\n}\n\nv, err := ⟨load⟩()\nif err != nil {\n    fmt.Println(err)\n    return\n}"],
    ["便利", "文字列を数に変える", "strconv Atoi 変換", "import \"strconv\"\n\n⟨n⟩, err := strconv.Atoi(⟨s⟩)"],
    ["便利", "ファイルを読む", "os ReadFile ファイル", "import \"os\"\n\ndata, err := os.ReadFile(\"⟨data.txt⟩\")\ntext := string(data)"],
    ["便利", "同時に動かす（goroutine）", "goroutine go 並行 WaitGroup", "import \"sync\"\n\nvar wg sync.WaitGroup\nwg.Add(1)\ngo func() {\n    defer wg.Done()\n    ⟨⟩\n}()\nwg.Wait()"],
    ["便利", "少し待つ", "time Sleep 待つ", "import \"time\"\n\ntime.Sleep(⟨1⟩ * time.Second)"],
  ],
};

export const c: DictLanguage = {
  id: "c",
  label: "C",
  exts: [".c", ".h"],
  entries: [
    ["基本", "プログラムのひな形", "main stdio ひな形", "#include <stdio.h>\n\nint main(void) {\n    ⟨printf(\"こんにちは\\n\");⟩\n    return 0;\n}"],
    ["基本", "表示する", "printf 表示 出力 %d", "printf(\"⟨%d⟩\\n\", ⟨x⟩);"],
    ["基本", "数を入力する", "scanf 入力", "int ⟨n⟩;\nscanf(\"%d\", &⟨n⟩);"],
    ["基本", "もし〜なら", "if else 条件", "if (⟨条件⟩) {\n    ⟨⟩\n} else {\n    \n}"],
    ["基本", "決まった回数くり返す", "for ループ", "for (int ⟨i⟩ = 0; ⟨i⟩ < ⟨10⟩; ⟨i⟩++) {\n    ⟨⟩\n}"],
    ["基本", "条件のあいだくり返す", "while ループ", "while (⟨条件⟩) {\n    ⟨⟩\n}"],
    ["基本", "値によって分ける", "switch case", "switch (⟨x⟩) {\n    case ⟨1⟩:\n        ⟨⟩\n        break;\n    default:\n        break;\n}"],
    ["データ", "配列を作って合計", "配列 合計 sum", "int ⟨a⟩[] = {⟨1, 2, 3⟩};\nint n = sizeof(⟨a⟩) / sizeof(⟨a⟩[0]);\nint sum = 0;\nfor (int i = 0; i < n; i++) sum += ⟨a⟩[i];"],
    ["データ", "文字列をコピー・つなげる・比べる", "strcpy strcat strcmp 文字列", "#include <string.h>\n\nstrcpy(⟨dst⟩, ⟨src⟩);\nstrcat(⟨dst⟩, ⟨src⟩);\nif (strcmp(⟨a⟩, ⟨b⟩) == 0) { /* 同じ */ }"],
    ["データ", "構造体", "struct 構造体", "typedef struct {\n    char ⟨name⟩[32];\n    int ⟨age⟩;\n} ⟨Person⟩;"],
    ["データ", "メモリを確保・解放", "malloc free メモリ", "#include <stdlib.h>\n\nint *⟨p⟩ = malloc(sizeof(int) * ⟨n⟩);\n⟨⟩\nfree(⟨p⟩);"],
    ["関数", "関数を作る", "関数 定義", "⟨int⟩ ⟨name⟩(⟨int x⟩) {\n    ⟨⟩\n    return ⟨x⟩;\n}"],
    ["関数", "ポインタで値を書き換える（入れ替え）", "ポインタ swap 入れ替え", "void swap(int *a, int *b) {\n    int t = *a;\n    *a = *b;\n    *b = t;\n}"],
    ["便利", "ファイルを読む", "fopen fgets ファイル 読み込み", "FILE *fp = fopen(\"⟨data.txt⟩\", \"r\");\nchar line[256];\nwhile (fgets(line, sizeof line, fp)) {\n    printf(\"%s\", line);\n}\nfclose(fp);"],
    ["便利", "ランダムな数", "rand srand 乱数", "#include <stdlib.h>\n#include <time.h>\n\nsrand((unsigned)time(NULL));\nint ⟨n⟩ = rand() % ⟨6⟩ + 1;"],
  ],
};

export const cpp: DictLanguage = {
  id: "cpp",
  label: "C++",
  exts: [".cpp", ".cc", ".cxx", ".hpp", ".hh"],
  entries: [
    ["基本", "プログラムのひな形", "main iostream ひな形", "#include <iostream>\nusing namespace std;\n\nint main() {\n    ⟨cout << \"こんにちは\" << endl;⟩\n    return 0;\n}"],
    ["基本", "表示する", "cout 表示 出力", "cout << ⟨x⟩ << endl;"],
    ["基本", "入力する", "cin 入力", "int ⟨n⟩;\ncin >> ⟨n⟩;"],
    ["基本", "範囲 for で順に取り出す", "for range ループ", "for (const auto& ⟨x⟩ : ⟨v⟩) {\n    ⟨⟩\n}"],
    ["データ", "vector（伸びる配列）", "vector push_back 配列", "#include <vector>\n\nvector<⟨int⟩> ⟨v⟩;\n⟨v⟩.push_back(⟨1⟩);"],
    ["データ", "並べ替え", "sort 並べ替え algorithm", "#include <algorithm>\n\nsort(⟨v⟩.begin(), ⟨v⟩.end());"],
    ["データ", "map（辞書）", "map 辞書 キー", "#include <map>\n\nmap<string, int> ⟨m⟩;\n⟨m⟩[\"⟨key⟩\"] = ⟨1⟩;"],
    ["データ", "文字列（string）", "string 文字列 長さ", "#include <string>\n\nstring ⟨s⟩ = \"⟨abc⟩\";\n⟨s⟩.size();"],
    ["クラス", "クラスを作る", "class クラス", "class ⟨Name⟩ {\npublic:\n    ⟨Name⟩(⟨int x⟩) : ⟨x_⟩(⟨x⟩) {}\n    ⟨⟩\nprivate:\n    int ⟨x_⟩;\n};"],
  ],
};

export const java: DictLanguage = {
  id: "java",
  label: "Java",
  exts: [".java"],
  entries: [
    ["基本", "プログラムのひな形", "main class ひな形", "public class ⟨Main⟩ {\n    public static void main(String[] args) {\n        ⟨System.out.println(\"こんにちは\");⟩\n    }\n}"],
    ["基本", "表示する", "println 表示 出力", "System.out.println(⟨x⟩);"],
    ["基本", "入力する", "Scanner 入力", "import java.util.Scanner;\n\nScanner sc = new Scanner(System.in);\nint ⟨n⟩ = sc.nextInt();"],
    ["基本", "もし〜なら", "if else 条件", "if (⟨条件⟩) {\n    ⟨⟩\n} else {\n    \n}"],
    ["基本", "決まった回数くり返す", "for ループ", "for (int ⟨i⟩ = 0; ⟨i⟩ < ⟨10⟩; ⟨i⟩++) {\n    ⟨⟩\n}"],
    ["基本", "リストの中身を順に", "for each 拡張for", "for (var ⟨item⟩ : ⟨items⟩) {\n    ⟨⟩\n}"],
    ["データ", "ArrayList を使う", "ArrayList List add 配列", "import java.util.ArrayList;\nimport java.util.List;\n\nList<⟨Integer⟩> ⟨items⟩ = new ArrayList<>();\n⟨items⟩.add(⟨1⟩);"],
    ["データ", "HashMap（辞書）を使う", "HashMap Map 辞書", "import java.util.HashMap;\nimport java.util.Map;\n\nMap<String, Integer> ⟨m⟩ = new HashMap<>();\n⟨m⟩.put(\"⟨key⟩\", ⟨1⟩);"],
    ["データ", "並べ替え", "sort Collections 並べ替え", "import java.util.Collections;\n\nCollections.sort(⟨items⟩);"],
    ["クラス", "クラスを作る", "class クラス コンストラクタ", "public class ⟨Name⟩ {\n    private ⟨String⟩ ⟨name⟩;\n\n    public ⟨Name⟩(⟨String⟩ ⟨name⟩) {\n        this.⟨name⟩ = ⟨name⟩;\n    }\n}"],
    ["便利", "エラーを受け止める", "try catch 例外", "try {\n    ⟨⟩\n} catch (⟨Exception⟩ e) {\n    e.printStackTrace();\n}"],
    ["便利", "ランダムな数", "Random 乱数", "import java.util.Random;\n\nint ⟨n⟩ = new Random().nextInt(⟨6⟩) + 1;"],
  ],
};

export const html: DictLanguage = {
  id: "html",
  label: "HTML",
  exts: [".html", ".htm"],
  entries: [
    ["基本", "ページのひな形", "html ひな形 テンプレート doctype", "<!doctype html>\n<html lang=\"ja\">\n<head>\n    <meta charset=\"utf-8\">\n    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n    <title>⟨タイトル⟩</title>\n    <link rel=\"stylesheet\" href=\"⟨style.css⟩\">\n</head>\n<body>\n    ⟨⟩\n    <script src=\"⟨script.js⟩\"></script>\n</body>\n</html>"],
    ["基本", "見出しと段落", "h1 p 見出し 段落", "<h1>⟨見出し⟩</h1>\n<p>⟨文章⟩</p>"],
    ["基本", "リンク", "a href リンク", "<a href=\"⟨https://example.com⟩\">⟨リンクの文字⟩</a>"],
    ["基本", "画像", "img 画像", "<img src=\"⟨image.png⟩\" alt=\"⟨説明⟩\">"],
    ["基本", "箇条書き", "ul li リスト", "<ul>\n    <li>⟨項目⟩</li>\n</ul>"],
    ["基本", "表", "table tr td 表", "<table>\n    <tr><th>⟨見出し⟩</th><th>⟨見出し⟩</th></tr>\n    <tr><td>⟨データ⟩</td><td>⟨データ⟩</td></tr>\n</table>"],
    ["フォーム", "入力欄とボタン", "input button フォーム", "<input type=\"⟨text⟩\" id=\"⟨name⟩\" placeholder=\"⟨名前⟩\">\n<button id=\"⟨submit⟩\">⟨送信⟩</button>"],
    ["フォーム", "選択肢（プルダウン）", "select option プルダウン", "<select id=\"⟨choice⟩\">\n    <option value=\"⟨a⟩\">⟨A⟩</option>\n</select>"],
    ["フォーム", "チェックボックス", "checkbox チェック", "<label><input type=\"checkbox\" id=\"⟨agree⟩\"> ⟨同意する⟩</label>"],
    ["便利", "動画を埋め込む", "video 動画", "<video src=\"⟨movie.mp4⟩\" controls></video>"],
  ],
};

export const css: DictLanguage = {
  id: "css",
  label: "CSS",
  exts: [".css", ".scss", ".less"],
  entries: [
    ["配置", "横に並べる（flex）", "flex 横並び 並べる", "⟨.box⟩ {\n    display: flex;\n    gap: ⟨16px⟩;\n    align-items: center;\n}"],
    ["配置", "真ん中に置く", "中央 センター 真ん中 center", "⟨.box⟩ {\n    display: grid;\n    place-items: center;\n}"],
    ["配置", "格子状に並べる（grid）", "grid グリッド タイル", "⟨.grid⟩ {\n    display: grid;\n    grid-template-columns: repeat(auto-fill, minmax(⟨200px⟩, 1fr));\n    gap: ⟨16px⟩;\n}"],
    ["配置", "画面に固定する", "fixed 固定 ヘッダー", "⟨.header⟩ {\n    position: fixed;\n    top: 0;\n    left: 0;\n    right: 0;\n}"],
    ["見た目", "文字の大きさ・色・太さ", "font color 文字 色 太字", "⟨p⟩ {\n    font-size: ⟨16px⟩;\n    color: ⟨#333⟩;\n    font-weight: ⟨bold⟩;\n}"],
    ["見た目", "背景の色・画像", "background 背景", "⟨body⟩ {\n    background: ⟨#f5f5f5⟩ url(\"⟨bg.png⟩\") center / cover no-repeat;\n}"],
    ["見た目", "角を丸く・影をつける", "border-radius box-shadow 角丸 影", "⟨.card⟩ {\n    border-radius: ⟨12px⟩;\n    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);\n}"],
    ["見た目", "マウスを乗せたとき", "hover ホバー", "⟨.button⟩:hover {\n    ⟨opacity: 0.8;⟩\n}"],
    ["見た目", "ゆっくり変化させる", "transition アニメーション", "⟨.button⟩ {\n    transition: ⟨all⟩ 0.3s ease;\n}"],
    ["見た目", "アニメーション", "keyframes animation 動き", "@keyframes ⟨fade⟩ {\n    from { opacity: 0; }\n    to { opacity: 1; }\n}\n\n⟨.box⟩ {\n    animation: ⟨fade⟩ 1s ease;\n}"],
    ["便利", "スマホの幅のときだけ", "media クエリ スマホ レスポンシブ", "@media (max-width: ⟨600px⟩) {\n    ⟨⟩\n}"],
    ["便利", "日本語が読みやすい文字の設定", "font-family 日本語 フォント", "⟨body⟩ {\n    font-family: \"Hiragino Sans\", \"Noto Sans JP\", \"Yu Gothic UI\", \"Meiryo\", sans-serif;\n    line-height: 1.8;\n}"],
  ],
};

export const shell: DictLanguage = {
  id: "shell",
  label: "シェル / PowerShell",
  exts: [".sh", ".bash", ".zsh", ".ps1", ".bat", ".cmd"],
  entries: [
    ["PowerShell", "フォルダを移動・中身を見る", "cd ls dir 移動 一覧", "Set-Location \"⟨C:\\Users⟩\"\nGet-ChildItem"],
    ["PowerShell", "ファイルを探す", "検索 Get-ChildItem Recurse", "Get-ChildItem -Recurse -Filter \"⟨*.py⟩\""],
    ["PowerShell", "ファイルの中の文字を探す", "grep Select-String 検索", "Select-String -Path \"⟨*.txt⟩\" -Pattern \"⟨word⟩\""],
    ["PowerShell", "Python のライブラリを入れる", "pip install ライブラリ", "py -m pip install ⟨numpy⟩"],
    ["PowerShell", "環境変数を見る・設定する", "env 環境変数 PATH", "$env:⟨PATH⟩\n$env:⟨MY_VAR⟩ = \"⟨value⟩\""],
    ["シェル", "変数を使う", "変数 echo", "⟨name⟩=\"⟨value⟩\"\necho \"$⟨name⟩\""],
    ["シェル", "もし〜なら", "if test 条件", "if [ ⟨-f file.txt⟩ ]; then\n    ⟨⟩\nfi"],
    ["シェル", "くり返す", "for ループ", "for ⟨f⟩ in ⟨*.txt⟩; do\n    echo \"$⟨f⟩\"\ndone"],
    ["シェル", "ファイルの中の文字を探す（grep）", "grep 検索", "grep -rn \"⟨word⟩\" ⟨.⟩"],
  ],
};
