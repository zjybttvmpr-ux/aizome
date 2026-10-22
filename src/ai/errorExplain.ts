// ターミナルに出たエラーを、日本語でかんたんに説明する（よくあるものはルールで、すぐに）

export interface ErrorExplanation {
  /** エラーの名前（例：NameError） */
  kind: string;
  /** 元のエラーの行 */
  raw: string;
  /** 何が起きたか */
  what: string;
  /** どう直すか */
  fix: string;
  /** エラーが起きた場所 */
  file?: string;
  line?: number;
  /** すぐ実行できる直し方（例：pip install） */
  command?: { label: string; run: string };
}

const charName = (c: string) => `「${c}」（U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}）`;

type Rule = (m: RegExpExecArray, ctx: { os: string }) => Omit<ErrorExplanation, "raw" | "kind" | "file" | "line">;

const RULES: [RegExp, string, Rule][] = [
  // ───── Python
  [/SyntaxError: invalid (?:non-printable )?character '(.)' \(U\+([0-9A-F]+)\)/i, "SyntaxError", (m) => ({
    what: `コードの中に、全角の文字 ${charName(m[1])} が混ざっています。日本語入力のまま記号を打つとよく起きます。`,
    fix: "その文字を半角に打ち直してください。「/半角」で、文字列とコメント以外の全角記号をまとめて直せます。",
  })],
  [/SyntaxError: invalid character in identifier/i, "SyntaxError", () => ({
    what: "名前の中に全角の文字（全角スペースなど）が混ざっています。",
    fix: "「/半角」で全角記号をまとめて直せます。",
  })],
  [/SyntaxError: '(\(|\[|\{)' was never closed/i, "SyntaxError", (m) => ({
    what: `「${m[1]}」を開いたまま閉じていません。`,
    fix: `対応する「${{ "(": ")", "[": "]", "{": "}" }[m[1]]}」を書き足してください。`,
  })],
  [/SyntaxError: unmatched '(.)'/i, "SyntaxError", (m) => ({
    what: `「${m[1]}」に対応する開きかっこがありません。`,
    fix: "かっこの数が合っているか確かめてください。",
  })],
  [/SyntaxError: expected ':'/i, "SyntaxError", () => ({
    what: "if・for・def などの行の最後に「:」（コロン）がありません。",
    fix: "行の最後に半角の「:」を付けてください。",
  })],
  [/SyntaxError: unterminated string literal/i, "SyntaxError", () => ({
    what: "文字列の「\"」や「'」が閉じていません。",
    fix: "文字列の最後に同じ引用符を付けてください。全角の「”」になっていないかも確かめてください。",
  })],
  [/SyntaxError: invalid syntax\. Perhaps you forgot a comma\?/i, "SyntaxError", () => ({
    what: "並べた値のあいだに「,」（カンマ）がないようです。",
    fix: "値と値のあいだに半角の「,」を入れてください。",
  })],
  [/SyntaxError: Missing parentheses in call to 'print'/i, "SyntaxError", () => ({
    what: "Python 3 では print にかっこが必要です。",
    fix: "print(\"…\") のように、かっこで囲んでください。",
  })],
  [/SyntaxError: (.+)/, "SyntaxError", (m) => ({
    what: `書き方（文法）のまちがいがあります：${m[1]}`,
    fix: "示された行と、その 1 行前を見てください。かっこやコロン、全角の記号がよくある原因です。",
  })],
  [/IndentationError: expected an indented block/i, "IndentationError", () => ({
    what: "「:」で終わる行の次の行が、字下げ（インデント）されていません。",
    fix: "次の行の先頭にスペース 4 つ（または Tab）を入れてください。",
  })],
  [/IndentationError: unexpected indent/i, "IndentationError", () => ({
    what: "必要のないところで字下げされています。",
    fix: "その行の先頭の空白を、まわりの行とそろえてください。",
  })],
  [/IndentationError: unindent does not match any outer indentation level|TabError/i, "IndentationError", () => ({
    what: "字下げの深さがそろっていません（スペースと Tab が混ざっていることも）。",
    fix: "字下げをスペース 4 つにそろえてください。",
  })],
  [/NameError: name '(\w+)' is not defined/, "NameError", (m) => ({
    what: `「${m[1]}」という名前が、まだ作られていません。`,
    fix: `つづりのまちがい（大文字・小文字も）か、使う前に ${m[1]} = … や def ${m[1]}(…) を書いていないことが多いです。モジュールなら import を忘れていないか確かめてください。`,
  })],
  [/ModuleNotFoundError: No module named '([\w.]+)'/, "ModuleNotFoundError", (m, ctx) => {
    const pkg = PIP_NAMES[m[1].split(".")[0]] ?? m[1].split(".")[0];
    const py = ctx.os === "windows" ? "py -m pip" : "python3 -m pip";
    return {
      what: `「${m[1]}」というモジュール（追加の部品）が入っていません。`,
      fix: `ターミナルで ${py} install ${pkg} を実行すると入れられます。`,
      command: { label: `${pkg} を入れる`, run: `${py} install ${pkg}` },
    };
  }],
  [/ImportError: cannot import name '(\w+)' from '([\w.]+)'/, "ImportError", (m) => ({
    what: `「${m[2]}」の中に「${m[1]}」が見つかりません。`,
    fix: "名前のつづりか、モジュールのバージョンを確かめてください。自分のファイル名がモジュール名と同じ（例：random.py）だと起きることもあります。",
  })],
  [/TypeError: can only concatenate str \(not "(\w+)"\) to str/, "TypeError", (m) => ({
    what: `文字（str）と ${m[1] === "int" ? "数（int）" : m[1]} を「+」でつなげようとしました。`,
    fix: "数を str(…) で文字に変えるか、f\"…{値}…\" の書き方を使ってください。",
  })],
  [/TypeError: unsupported operand type\(s\) for (.+): '(\w+)' and '(\w+)'/, "TypeError", (m) => ({
    what: `${m[2]} と ${m[3]} のあいだで「${m[1]}」の計算はできません。`,
    fix: "input() で受け取った値は文字なので、計算するなら int(…) や float(…) で数に変えてください。",
  })],
  [/TypeError: '(\w+)' object is not callable/, "TypeError", (m) => ({
    what: `${m[1]} を関数のように (…) で呼び出そうとしました。`,
    fix: "同じ名前の変数で関数を上書きしていないか（例：list = … や print = …）確かめてください。",
  })],
  [/TypeError: '(\w+)' object is not subscriptable/, "TypeError", (m) => ({
    what: `${m[1]} に [ ] で番号を指定することはできません。`,
    fix: "リストや文字列のつもりの値が、別の種類になっていないか確かめてください。",
  })],
  [/TypeError: (\w+)\(\) (?:takes|missing) (.+)/, "TypeError", (m) => ({
    what: `関数 ${m[1]} に渡した値の数が合っていません（${m[2]}）。`,
    fix: "def の行の引数と、呼び出すときの値の数をそろえてください。",
  })],
  [/ValueError: invalid literal for int\(\) with base 10: '(.*)'/, "ValueError", (m) => ({
    what: `「${m[1]}」は整数に変えられません。`,
    fix: "数字以外（空白、小数点、全角数字など）が入っていないか確かめてください。小数なら float(…) を使います。",
  })],
  [/ValueError: (.+)/, "ValueError", (m) => ({ what: `値がおかしいです：${m[1]}`, fix: "渡している値の中身を print で確かめてください。" })],
  [/IndexError: (?:list|string|tuple) index out of range/, "IndexError", () => ({
    what: "リスト（や文字列）の範囲の外の番号を指定しました。",
    fix: "番号は 0 から数えます。長さが n なら最後は n-1 です。len(…) で長さを確かめてください。",
  })],
  [/KeyError: (.+)/, "KeyError", (m) => ({
    what: `辞書に ${m[1]} というキーがありません。`,
    fix: "キーのつづりを確かめるか、d.get(キー) を使うと、無いときにエラーになりません。",
  })],
  [/AttributeError: '(\w+)' object has no attribute '(\w+)'/, "AttributeError", (m) => ({
    what: `${m[1]} には「${m[2]}」という機能（属性）がありません。`,
    fix: "つづりを確かめてください。値が思っている種類（例：None）になっていないかも確かめましょう。",
  })],
  [/AttributeError: module '([\w.]+)' has no attribute '(\w+)'/, "AttributeError", (m) => ({
    what: `モジュール ${m[1]} に「${m[2]}」がありません。`,
    fix: "つづりを確かめてください。自分のファイル名がモジュール名と同じだと、そちらが読み込まれて起きます。",
  })],
  [/ZeroDivisionError/, "ZeroDivisionError", () => ({ what: "0 で割ろうとしました。", fix: "割る数が 0 にならないよう、if で確かめてから割ってください。" })],
  [/FileNotFoundError: .*No such file or directory: '(.+)'/, "FileNotFoundError", (m) => ({
    what: `ファイル「${m[1]}」が見つかりません。`,
    fix: "ファイル名と、置いてある場所を確かめてください。実行するときの場所（フォルダ）は、実行するファイルのある場所です。",
  })],
  [/UnicodeDecodeError: '(utf-8|cp932|shift_jis)' codec can't decode/i, "UnicodeDecodeError", (m) => ({
    what: `ファイルの文字コードが ${m[1]} ではありません。`,
    fix: m[1].toLowerCase() === "utf-8" ? "open(…, encoding=\"cp932\") を試してください（Windows で作った日本語のファイルによくあります）。" : "open(…, encoding=\"utf-8\") を試してください。",
  })],
  [/UnicodeEncodeError/, "UnicodeEncodeError", () => ({
    what: "日本語などの文字を書き出せませんでした。",
    fix: "open(…, \"w\", encoding=\"utf-8\") のように文字コードを指定してください。",
  })],
  [/RecursionError/, "RecursionError", () => ({ what: "関数が自分を呼び出し続けて、止まらなくなりました。", fix: "終わる条件（if … return）があるか確かめてください。" })],
  [/KeyboardInterrupt/, "KeyboardInterrupt", () => ({ what: "Ctrl+C（■ 中断）で止めました。", fix: "エラーではありません。" })],
  // ───── JavaScript / TypeScript
  [/ReferenceError: (\w+) is not defined/, "ReferenceError", (m) => ({
    what: `「${m[1]}」という名前が、まだ作られていません。`,
    fix: `つづりか、const / let で宣言しているか、import を忘れていないか確かめてください。`,
  })],
  [/TypeError: Cannot read propert(?:y|ies) of (undefined|null)(?: \(reading '(\w+)'\))?/, "TypeError", (m) => ({
    what: `${m[1]} の${m[2] ? `「${m[2]}」` : "中身"}を読もうとしました。`,
    fix: "その手前の値が空（undefined / null）になっています。?. を使うか、値が入っているか確かめてください。",
  })],
  [/TypeError: (\w[\w.]*) is not a function/, "TypeError", (m) => ({ what: `${m[1]} は関数ではありません。`, fix: "名前のつづりと、値の種類を確かめてください。" })],
  [/SyntaxError: Unexpected token (.+)/, "SyntaxError", (m) => ({ what: `思っていない場所に ${m[1]} があります。`, fix: "かっこや「,」「;」の過不足を確かめてください。" })],
  [/Error: Cannot find module '(.+)'/, "Error", (m) => ({
    what: `モジュール「${m[1]}」が見つかりません。`,
    fix: m[1].startsWith(".") ? "ファイルの場所と名前を確かめてください。" : `npm install ${m[1]} で入れられます。`,
    command: m[1].startsWith(".") ? undefined : { label: `${m[1]} を入れる`, run: `npm install ${m[1]}` },
  })],
  // ───── Go
  [/undefined: (\w+)/, "Go", (m) => ({ what: `「${m[1]}」が定義されていません。`, fix: "つづりと、import・宣言を確かめてください。" })],
  [/declared and not used: (\w+)|(\w+) declared (?:and|but) not used/, "Go", (m) => ({ what: `変数 ${m[1] ?? m[2]} を作ったのに使っていません（Go ではエラーになります）。`, fix: "使わないなら消すか、_ に置き換えてください。" })],
  [/"([\w./-]+)" imported and not used/, "Go", (m) => ({ what: `${m[1]} を import したのに使っていません。`, fix: "使わない import を消してください。" })],
  // ───── C / C++
  [/error: '(\w+)' undeclared|error: use of undeclared identifier '(\w+)'/, "C", (m) => ({ what: `「${m[1] ?? m[2]}」が宣言されていません。`, fix: "つづりと、#include や宣言を確かめてください。" })],
  [/error: expected ';'/, "C", () => ({ what: "文の最後に「;」がありません。", fix: "示された行の 1 行前の最後に「;」を付けてください。" })],
  // ───── シェル・コマンド
  [/(?:The term '([^']+)' is not recognized|'([^']+)' は、内部コマンドまたは外部コマンド|([\w.-]+): command not found|'([^']+)' is not recognized as an internal or external command|用語 '([^']+)' は、.*認識されません)/, "コマンド", (m) => {
    const cmd = m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5];
    return {
      what: `「${cmd}」というコマンドが見つかりません。`,
      fix: cmd.startsWith("python") || cmd === "py"
        ? "Python が入っていないか、PATH に入っていません。「/python」で確かめられます。"
        : "そのソフトが入っているか、PATH（コマンドを探す場所）に入っているか確かめてください。入れた直後なら、ターミナルを開き直すと使えることがあります。",
    };
  }],
  [/Permission denied|アクセスが拒否されました|Access is denied/i, "権限", () => ({
    what: "そのファイルやフォルダを使う権限がありません。",
    fix: "ほかのソフトがファイルを開いていないか、書き込める場所か確かめてください。",
  })],
];

/** import 名と pip で入れるときの名前が違うもの */
const PIP_NAMES: Record<string, string> = {
  cv2: "opencv-python", PIL: "pillow", sklearn: "scikit-learn", bs4: "beautifulsoup4", yaml: "pyyaml",
  dotenv: "python-dotenv", serial: "pyserial", Crypto: "pycryptodome", docx: "python-docx", pptx: "python-pptx",
};

/** 出力（最後の数百行）から、いちばん最後のエラーを見つけて説明する */
export function explainError(output: string, os = "windows"): ErrorExplanation | null {
  const lines = output.split(/\r?\n/).map((l) => l.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").trimEnd());
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i];
    if (!l.trim()) continue;
    for (const [re, kind, rule] of RULES) {
      const m = re.exec(l);
      if (!m) continue;
      const r = rule(m, { os });
      const place = findPlace(lines, i);
      return { kind: /^[A-Z]\w+(Error|Exception|Interrupt)$/.test(l.split(":")[0].trim()) ? l.split(":")[0].trim() : kind, raw: l.trim(), ...r, ...place };
    }
  }
  return null;
}

/** エラーの起きた場所（Python の File "…", line N や file.go:12:3） */
function findPlace(lines: string[], at: number): { file?: string; line?: number } {
  for (let i = at; i >= Math.max(0, at - 40); i--) {
    const py = /File "([^"]+)", line (\d+)/.exec(lines[i]);
    if (py && !/[\\/](lib|site-packages)[\\/]|<frozen/i.test(py[1])) return { file: py[1], line: Number(py[2]) };
    const loc = /((?:[A-Za-z]:)?[\w.\-~/\\]+\.\w{1,6}):(\d+)(?::\d+)?/.exec(lines[i]);
    if (loc) return { file: loc[1], line: Number(loc[2]) };
  }
  return {};
}
