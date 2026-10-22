// 変数・関数の「定義元」を探す（画面に依存しない部分）。
// 言語ごとの厳密な解析はせず、よくある書き方（def / class / function / 代入 / for / import / 引数など）から探す

export interface DefinitionHit {
  line: number;
  col: number;
  kind: "function" | "variable";
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function stripComment(line: string): string {
  // 文字列の中の # まで消さないよう、ざっくり：先頭が # や // の行だけ空にする
  return /^\s*(#|\/\/)/.test(line) ? "" : line;
}

/** 関数・クラスなどの定義 */
function functionDef(n: string): RegExp {
  return new RegExp(`\\b(?:def|class|function|func|fn|struct|interface|enum|type|module|sub|record)\\s+\\*?${n}\\b`);
}

/** 変数を作る・入れる書き方 */
function bindings(n: string): RegExp[] {
  return [
    new RegExp(`^\\s*(?:self\\.)?${n}\\s*(?::[^=]+)?=(?!=)`), // x = 1 / x: int = 1
    new RegExp(`^\\s*[\\w\\s,*()\\[\\]]*\\b${n}\\b[\\w\\s,*()\\[\\]]*=(?!=)`), // a, x = ... / (a, x) = ...
    new RegExp(`\\b${n}\\b[\\w\\s,]*:=`), // Go の x := / Python の (x := ...)
    new RegExp(`\\b(?:const|let|var|val|auto|static|final)\\s+(?:mut\\s+)?[\\w<>\\[\\],\\s]*?\\b${n}\\b`), // const x / let mut x / var x
    new RegExp(`\\b(?:int|long|short|float|double|char|bool|boolean|string|String|size_t|unsigned|byte|decimal|var)\\b[\\w<>\\[\\]*&\\s]*\\b${n}\\b\\s*(?:=|;|,|\\[|\\))`), // int x = / String x;
    new RegExp(`^\\s*for\\s*\\(?[\\w\\s,()]*\\b${n}\\b[\\w\\s,()]*\\s+(?:in|of)\\s`), // for x in / for (const x of
    new RegExp(`\\bfor\\s*\\(\\s*(?:\\w+\\s+)?${n}\\s*(?:=|:)`), // for (int x = 0; / for (x :
    new RegExp(`^\\s*(?:from\\s+\\S+\\s+)?import\\s+.*\\b${n}\\b`), // import x / from a import x
    new RegExp(`\\bas\\s+${n}\\b`), // with ... as x / import a as x / except E as x
    new RegExp(`\\b(?:def|function|func|fn)\\s+\\w*\\s*\\(([^)]*\\b${n}\\b[^)]*)\\)`), // 引数
    new RegExp(`\\blambda\\b[^:]*\\b${n}\\b[^:]*:`), // lambda x:
    new RegExp(`\\bcatch\\s*\\(\\s*(?:\\w+\\s+)?${n}\\b`), // catch (e)
  ];
}

function colOf(text: string, n: string): number {
  const m = new RegExp(`\\b${n}\\b`).exec(text);
  return m ? m.index + 1 : 1;
}

/**
 * name の定義元を探す。fromLine はクリックした行（1 から）。
 * 関数・クラスの定義 → その前で最後に値を入れた行 → ファイル全体で最初に値を入れた行 の順
 */
export function findDefinition(lines: string[], name: string, fromLine: number): DefinitionHit | null {
  if (!/^[A-Za-z_$][\w$]*$/.test(name)) return null;
  const n = esc(name);
  const fdef = functionDef(n);
  const binds = bindings(n);
  const text = lines.map(stripComment);
  // 1. 関数・クラス（近い上のもの、なければ最初のもの）
  const fnLines = text.map((l, i) => (fdef.test(l) ? i + 1 : 0)).filter(Boolean);
  if (fnLines.length) {
    const above = fnLines.filter((l) => l < fromLine).pop();
    const line = above ?? fnLines[0];
    if (line !== fromLine) return { line, col: colOf(lines[line - 1], n), kind: "function" };
  }
  const isBinding = (l: string) => binds.some((re) => re.test(l));
  // 2. その行より上で、最後に値を入れた行（クリックした行が代入なら、さらに上）
  for (let i = fromLine - 1; i >= 1; i--) {
    if (isBinding(text[i - 1])) return { line: i, col: colOf(lines[i - 1], n), kind: "variable" };
  }
  // 3. ファイル全体で最初に値を入れた行
  for (let i = 1; i <= text.length; i++) {
    if (i !== fromLine && isBinding(text[i - 1])) return { line: i, col: colOf(lines[i - 1], n), kind: "variable" };
  }
  return null;
}

/** ほかのファイルを探すときの正規表現（関数・クラスの定義） */
export function definitionSearchRegex(name: string): string {
  return `\\b(def|class|function|func|fn|struct|interface|enum)\\s+${esc(name)}\\b`;
}

/** このファイルに定義が見つからないとき（ほかのファイルを探す）。app が設定する */
let fallback: ((name: string) => Promise<boolean>) | null = null;
export function setDefinitionFallback(fn: (name: string) => Promise<boolean>) {
  fallback = fn;
}
export function definitionFallback(): ((name: string) => Promise<boolean>) | null {
  return fallback;
}
