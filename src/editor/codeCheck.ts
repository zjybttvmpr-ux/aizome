import { cssProblems, endBlockProblems, htmlProblems, jsonProblems, shellBlockProblems } from "./langChecks";
// 書きながらのチェック（CodeMirror を使わない部分。テストしやすいように文字列だけで動く）
// - かっこ・引用符の閉じ忘れ、Python の「:」の付け忘れ
// - Python の「まだ作っていない名前」（タイプミスの候補つき）
// - import / using / #include の付け忘れと、それを足す位置
// 言語ごとに表を分けていて、ほかの言語の候補が混ざらないようにしている。

export type CheckLang =
  | "python" | "java" | "csharp" | "c" | "cpp" | "go" | "rust"
  | "js" | "php" | "kotlin" | "swift" | "dart" | "ruby" | "lua" | "shell" | "powershell" | "sql" | "css" | "json" | "html" | "xml";

const EXT_LANG: Record<string, CheckLang> = {
  ".py": "python", ".pyw": "python",
  ".java": "java",
  ".cs": "csharp",
  ".c": "c", ".h": "c",
  ".cpp": "cpp", ".cc": "cpp", ".cxx": "cpp", ".hpp": "cpp", ".hh": "cpp",
  ".go": "go",
  ".rs": "rust",
  ".js": "js", ".mjs": "js", ".cjs": "js", ".jsx": "js", ".ts": "js", ".tsx": "js", ".mts": "js", ".cts": "js",
  ".php": "php",
  ".kt": "kotlin", ".kts": "kotlin",
  ".swift": "swift",
  ".dart": "dart",
  ".rb": "ruby",
  ".lua": "lua",
  ".sh": "shell", ".bash": "shell", ".zsh": "shell",
  ".ps1": "powershell", ".psm1": "powershell",
  ".sql": "sql",
  ".css": "css", ".scss": "css", ".less": "css",
  ".json": "json",
  ".html": "html", ".htm": "html", ".vue": "html", ".xml": "xml", ".svg": "xml", ".xhtml": "xml", ".csproj": "xml", ".xaml": "xml",
};

/** エディタの言語の名前（CodeMirror の言語名や、下に出ている言語名）から */
const NAME_LANG: Record<string, CheckLang> = {
  python: "python", java: "java", csharp: "csharp", "c#": "csharp", c: "c", cpp: "cpp", "c++": "cpp", go: "go", rust: "rust",
  javascript: "js", typescript: "js", jsx: "js", tsx: "js", php: "php", kotlin: "kotlin", swift: "swift", dart: "dart",
  ruby: "ruby", lua: "lua", shell: "shell", sh: "shell", bash: "shell", powershell: "powershell", sql: "sql",
  css: "css", scss: "css", less: "css", json: "json", html: "html", xml: "xml", vue: "html",
};

export function checkLangOf(ext: string): CheckLang | null {
  return EXT_LANG[ext.toLowerCase()] ?? null;
}

export function checkLangByName(name: string): CheckLang | null {
  return NAME_LANG[name.toLowerCase().replace(/\s+/g, "")] ?? null;
}

// ---------- 字句に分ける ----------

export interface Tok {
  k: "id" | "op" | "nl" | "num";
  v: string;
  from: number;
  to: number;
  /** かっこの深さ（このトークンの前の時点） */
  d: number;
}

export interface Problem {
  from: number;
  to: number;
  kind: "syntax" | "undefined" | "import" | "runtime";
  severity: "error" | "warning" | "info";
  /** 表示用の言葉のキーと埋め込む値 */
  msg: string;
  args?: Record<string, string>;
  fixes: Fix[];
}

export interface Fix {
  /** ボタンの言葉のキーと値 */
  label: string;
  args?: Record<string, string>;
  changes: { from: number; to: number; insert: string }[];
}

const OPS3 = ["**=", "//=", ">>=", "<<=", "...", "!==", "==="];
const OPS2 = ["==", "!=", "<=", ">=", ":=", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "@=", "->", "**", "//", "<<", ">>", "::", "&&", "||", "++", "--", "=>"];
const OPEN: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
const CLOSE: Record<string, string> = { ")": "(", "]": "[", "}": "{" };

export interface Lexed {
  toks: Tok[];
  problems: Problem[];
  /** 文字列・コメントの範囲（差し込み位置の判断などに使う） */
  skipped: [number, number][];
}

function isIdStart(c: string) {
  return /[A-Za-z_$À-￿]/.test(c) && !/[　-〿！-｠]/.test(c);
}
function isId(c: string) {
  return /[\w$À-￿]/.test(c) && !/[　-〿！-｠]/.test(c);
}

export function lex(text: string, lang: CheckLang): Lexed {
  const py = lang === "python";
  // コメントの書き方
  const hashComment = py || lang === "ruby" || lang === "shell" || lang === "php" || lang === "powershell";
  const lineSlash = !["python", "ruby", "shell", "lua", "sql", "css", "powershell"].includes(lang);
  const blockSlash = lineSlash || lang === "sql" || lang === "css";
  const dashComment = lang === "lua" || lang === "sql";
  // 何行にもわたってよい文字列
  const multilineStr = ["shell", "ruby", "sql", "php", "powershell"].includes(lang);
  // シェルの case の「a)」などで、かっこが合わないのはふつうなので数えない
  const noBrackets = lang === "shell";
  const toks: Tok[] = [];
  const problems: Problem[] = [];
  const skipped: [number, number][] = [];
  const stack: { c: string; at: number; prev: string }[] = [];
  let i = 0;
  const n = text.length;
  let lineStart = true;
  /** Python：今の文が始まった行の字下げ */
  let stmtIndent = 0;
  const indentAt = (pos: number) => {
    const ls = text.lastIndexOf("\n", pos - 1) + 1;
    const m = /^[ \t]*/.exec(text.slice(ls, ls + 200))![0];
    return m.replace(/\t/g, "    ").length;
  };
  /** 閉じていないかっこを、ここで閉じ忘れたとみなして知らせ、続きを読めるように閉じたことにする */
  const closeHere = (insertAt: number, upto: number) => {
    const open = stack.splice(upto);
    if (!open.length) return;
    const closers = open.map((s) => OPEN[s.c]).reverse().join("");
    const inner = open[open.length - 1];
    const where = (pos: number) => {
      const ls = text.lastIndexOf("\n", pos - 1) + 1;
      return { line: String(text.slice(0, ls).split("\n").length), col: String(pos - ls + 1) };
    };
    const at = where(inner.at);
    const fixes = [{ label: "check.fix.addClose", args: { c: closers }, changes: [{ from: insertAt, to: insertAt, insert: closers }] }];
    // 波線は「本来 ) があるべき場所」に。開いたかっこにも、薄く印をつける
    problems.push({ from: insertAt, to: insertAt, kind: "syntax", severity: "error", msg: "check.missingCloseHere", args: { c: inner.c, want: closers, line: at.line, col: at.col }, fixes });
    problems.push({ from: inner.at, to: inner.at + 1, kind: "syntax", severity: "info", msg: "check.openedHere", args: { c: inner.c, want: closers, line: where(insertAt).line }, fixes });
  };
  while (i < n) {
    const c = text[i];
    if (c === "\n") {
      // Python：かっこが閉じないまま、次の行で新しい文が始まっている → この行の終わりで閉じ忘れ
      if (py && stack.length > 0) {
        const last = toks[toks.length - 1];
        const complete = !!last && (last.k === "id" || last.k === "num" || [")", "]", "}"].includes(last.v)) && !["and", "or", "not", "in", "is", "if", "else", "lambda", "for"].includes(last.v);
        if (complete) {
          let j = i + 1;
          let next = "";
          while (j < n) {
            const e = text.indexOf("\n", j);
            const line = text.slice(j, e < 0 ? n : e);
            if (line.trim() && !line.trim().startsWith("#")) {
              next = line;
              break;
            }
            if (e < 0) break;
            j = e + 1;
          }
          const ni = /^[ \t]*/.exec(next)![0].replace(/\t/g, "    ").length;
          const body = next.trim();
          const startsStmt =
            /^(def|class|if|elif|else|for|while|try|except|finally|with|return|import|from|print|pass|break|continue|raise|global|nonlocal|assert|del|yield|async|match)\b/.test(body) ||
            body.startsWith("@") ||
            /^[A-Za-z_\u00c0-\uffff][\w\u00c0-\uffff]*(\.[\w\u00c0-\uffff]+)*(\[[^\]]*\])?\s*(=(?!=)|\+=|-=|\*=|\/=|\()/.test(body);
          if (next && ni <= stmtIndent && startsStmt) closeHere(last.to, 0);
        }
      }
      if (py && stack.length === 0) {
        const last = toks[toks.length - 1];
        if (last && last.k !== "nl") toks.push({ k: "nl", v: "\n", from: i, to: i + 1, d: 0 });
      }
      i++;
      lineStart = true;
      continue;
    }
    if (c === " " || c === "\t" || c === "\r" || c === "\f") {
      i++;
      continue;
    }
    // 行の続き（Python の \）
    if (py && c === "\\" && text[i + 1] === "\n") {
      i += 2;
      continue;
    }
    // コメント
    if (lang === "ruby" && lineStart && text.startsWith("=begin", i)) {
      const e = text.indexOf("\n=end", i);
      const end = e < 0 ? n : e + 5;
      skipped.push([i, end]);
      i = end;
      continue;
    }
    if (lang === "powershell" && c === "<" && text[i + 1] === "#") {
      const e = text.indexOf("#>", i + 2);
      const end = e < 0 ? n : e + 2;
      skipped.push([i, end]);
      i = end;
      continue;
    }
    if (dashComment && c === "-" && text[i + 1] === "-") {
      // Lua の --[[ … ]]
      const long = lang === "lua" ? /^--\[(=*)\[/.exec(text.slice(i, i + 12)) : null;
      let end: number;
      if (long) {
        const close = text.indexOf("]" + long[1] + "]", i + long[0].length);
        end = close < 0 ? n : close + long[1].length + 2;
      } else {
        const e = text.indexOf("\n", i);
        end = e < 0 ? n : e;
      }
      skipped.push([i, end]);
      i = end;
      continue;
    }
    if (hashComment && c === "#" && !(lang === "shell" && i > 0 && !/\s/.test(text[i - 1])) && !(lang === "ruby" && text[i + 1] === "{")) {
      const e = text.indexOf("\n", i);
      const end = e < 0 ? n : e;
      skipped.push([i, end]);
      i = end;
      continue;
    }
    if (lineSlash && c === "/" && text[i + 1] === "/") {
      const e = text.indexOf("\n", i);
      const end = e < 0 ? n : e;
      skipped.push([i, end]);
      i = end;
      continue;
    }
    if (blockSlash && c === "/" && text[i + 1] === "*") {
      const e = text.indexOf("*/", i + 2);
      const end = e < 0 ? n : e + 2;
      skipped.push([i, end]);
      i = end;
      continue;
    }
    // C / C++ のプリプロセッサ行（#include など）は名前の対象にしない
    if ((lang === "c" || lang === "cpp" || lang === "csharp") && c === "#" && lineStart) {
      let e = i;
      for (;;) {
        const nl = text.indexOf("\n", e);
        if (nl < 0) {
          e = n;
          break;
        }
        if (text[nl - 1] === "\\" || (text[nl - 1] === "\r" && text[nl - 2] === "\\")) {
          e = nl + 1;
          continue;
        }
        e = nl;
        break;
      }
      skipped.push([i, e]);
      i = e;
      continue;
    }
    lineStart = false;
    // JavaScript の正規表現 /…/（かっこを数えないように）
    if (lang === "js" && c === "/") {
      const prev = toks[toks.length - 1];
      const regexOk = !prev || (prev.k === "op" && !")]}".includes(prev.v)) || ["return", "typeof", "case", "in", "of", "delete", "void", "throw", "new"].includes(prev.v);
      if (regexOk && text[i + 1] !== "/" && text[i + 1] !== "*") {
        let j = i + 1;
        let cls = false;
        while (j < n && text[j] !== "\n") {
          const ch = text[j];
          if (ch === "\\") j++;
          else if (ch === "[") cls = true;
          else if (ch === "]") cls = false;
          else if (ch === "/" && !cls) break;
          j++;
        }
        if (text[j] === "/") {
          j++;
          while (j < n && /[a-z]/.test(text[j])) j++;
          skipped.push([i, j]);
          toks.push({ k: "num", v: "regex", from: i, to: j, d: stack.length });
          i = j;
          continue;
        }
      }
    }
    // Lua の [[ … ]] の文字列
    if (lang === "lua" && c === "[" && /^\[=*\[/.test(text.slice(i, i + 10))) {
      const eq = /^\[(=*)\[/.exec(text.slice(i, i + 10))![1];
      const close = text.indexOf("]" + eq + "]", i);
      const end = close < 0 ? n : close + eq.length + 2;
      if (close < 0) problems.push({ from: i, to: i + 2 + eq.length, kind: "syntax", severity: "error", msg: "check.unclosedString", args: { q: `[${eq}[` }, fixes: [] });
      skipped.push([i, end]);
      toks.push({ k: "num", v: "str", from: i, to: end, d: stack.length });
      i = end;
      continue;
    }
    // 文字列
    let q = -1;
    let prefixLen = 0;
    if (py) {
      const m = /^([rRbBuUfF]{0,2})(['"])/.exec(text.slice(i, i + 3));
      if (m && (m[1] === "" || !isId(text[i - 1] ?? " "))) {
        q = i + m[1].length;
        prefixLen = m[1].length;
      }
    } else if (c === '"' || c === "`") {
      q = i;
    } else if (lang === "csharp" && (c === "@" || c === "$") && /^[@$]{1,2}"/.test(text.slice(i, i + 3))) {
      prefixLen = text[i + 1] === '"' ? 1 : 2;
      q = i + prefixLen;
    } else if (c === "'") {
      // 1 文字（'a' '\n'）。Rust の 'a のような寿命は文字ではない
      if (lang === "rust" && text[i + 2] !== "'" && text[i + 1] !== "\\") {
        i++;
        continue;
      }
      // 英語の文の中の ' （don't など）は、文字の扱いにしない言語もある
      if ((lang === "shell" || lang === "ruby") && i > 0 && /[A-Za-z]/.test(text[i - 1]) && /[A-Za-z]/.test(text[i + 1] ?? "")) {
        i++;
        continue;
      }
      q = i;
    }
    if (q >= 0 && prefixLen === q - i) {
      const quote = text[q];
      const triple = py && text.slice(q, q + 3) === quote.repeat(3);
      const verbatim = lang === "csharp" && text.slice(i, q).includes("@");
      // シェルの '…' は \ も文字のまま
      const raw = quote === "`" || verbatim || ((lang === "shell" || lang === "powershell") && quote === "'");
      let j = q + (triple ? 3 : 1);
      let closed = false;
      while (j < n) {
        const ch = text[j];
        if (!raw && ch === "\\") {
          j += 2;
          continue;
        }
        if (triple) {
          if (text.slice(j, j + 3) === quote.repeat(3)) {
            j += 3;
            closed = true;
            break;
          }
        } else if (ch === quote) {
          if (verbatim && text[j + 1] === '"') {
            j += 2;
            continue;
          }
          j++;
          closed = true;
          break;
        } else if (ch === "\n" && !raw && !multilineStr) {
          break;
        }
        j++;
      }
      if (!closed) {
        problems.push({ from: i, to: Math.max(i + 1, Math.min(j, n)), kind: "syntax", severity: "error", msg: "check.unclosedString", args: { q: triple ? quote.repeat(3) : quote }, fixes: [] });
      }
      skipped.push([i, j]);
      toks.push({ k: "num", v: "str", from: i, to: j, d: stack.length });
      i = j;
      continue;
    }
    // 数
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(text[i + 1] ?? ""))) {
      let j = i + 1;
      while (j < n && (/[\w.]/.test(text[j]) || ((text[j] === "+" || text[j] === "-") && /[eE]/.test(text[j - 1]) && !/^0[xX]/.test(text.slice(i, i + 2))))) j++;
      toks.push({ k: "num", v: text.slice(i, j), from: i, to: j, d: stack.length });
      i = j;
      continue;
    }
    if (py && stack.length === 0 && (toks.length === 0 || toks[toks.length - 1].k === "nl")) stmtIndent = indentAt(i);
    if (isIdStart(c)) {
      let j = i + 1;
      while (j < n && isId(text[j])) j++;
      toks.push({ k: "id", v: text.slice(i, j), from: i, to: j, d: stack.length });
      i = j;
      continue;
    }
    // 記号
    const three = text.slice(i, i + 3);
    const two = text.slice(i, i + 2);
    const op = OPS3.includes(three) ? three : OPS2.includes(two) ? two : c;
    if (noBrackets && (OPEN[op] || CLOSE[op])) {
      toks.push({ k: "op", v: op, from: i, to: i + op.length, d: 0 });
      i += op.length;
      continue;
    }
    // { } の言語：「;」や「{」が来たのに、同じ文の ( が閉じていない
    if (!py && lang !== "powershell" && (op === ";" || op === "{") && stack.length && stack[stack.length - 1].c !== "{") {
      let k = stack.length;
      while (k > 0 && stack[k - 1].c !== "{") k--;
      const open = stack.slice(k);
      const inFor = open.some((s) => s.c === "(" && s.prev === "for");
      const head = open[0];
      const blockHead = op === "{" && head.c === "(" && ["if", "while", "foreach", "switch", "catch", "using", "lock", "for"].includes(head.prev) && open.length === 1;
      if (op === ";" && !inFor && open.every((s) => s.c !== "{")) closeHere(toks[toks.length - 1]?.to ?? i, k);
      else if (blockHead) closeHere(toks[toks.length - 1]?.to ?? i, k);
    }
    const d = stack.length;
    if (py && d === 0 && (toks.length === 0 || toks[toks.length - 1].k === "nl")) stmtIndent = indentAt(i);
    if (OPEN[op]) stack.push({ c: op, at: i, prev: toks[toks.length - 1]?.v ?? "" });
    else if (CLOSE[op]) {
      const top = stack[stack.length - 1];
      if (!top) {
        problems.push({ from: i, to: i + 1, kind: "syntax", severity: "error", msg: "check.extraClose", args: { c: op }, fixes: [{ label: "check.fix.remove", args: { c: op }, changes: [{ from: i, to: i + 1, insert: "" }] }] });
      } else if (top.c !== CLOSE[op]) {
        // 外側のかっこと合うなら、内側を閉じ忘れている（[1, 2} → ] が足りない）
        let k = stack.length - 1;
        while (k >= 0 && stack[k].c !== CLOSE[op]) k--;
        if (k >= 0) {
          closeHere(toks[toks.length - 1]?.to ?? i, k + 1);
          stack.pop();
        } else {
          problems.push({
            from: i,
            to: i + 1,
            kind: "syntax",
            severity: "error",
            msg: "check.mismatch",
            args: { open: top.c, close: op, want: OPEN[top.c] },
            fixes: [{ label: "check.fix.replace", args: { c: OPEN[top.c] }, changes: [{ from: i, to: i + 1, insert: OPEN[top.c] }] }],
          });
          stack.pop();
        }
      } else stack.pop();
    }
    toks.push({ k: "op", v: op, from: i, to: i + op.length, d: CLOSE[op] ? stack.length : d });
    i += op.length;
  }
  // 最後まで閉じなかったかっこ：最後のコードの後ろに足す
  if (stack.length) {
    const lastTok = toks[toks.length - 1];
    closeHere(lastTok ? lastTok.to : n, 0);
  }
  if (py) {
    const last = toks[toks.length - 1];
    if (last && last.k !== "nl") toks.push({ k: "nl", v: "\n", from: n, to: n, d: 0 });
  }
  return { toks, problems, skipped };
}

// ---------- Python ----------

const PY_KEYWORDS = new Set(
  "False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield".split(" "),
);
export const PY_BUILTINS = new Set(
  (
    "abs aiter all anext any ascii bin bool breakpoint bytearray bytes callable chr classmethod compile complex copyright credits delattr dict dir divmod " +
    "enumerate eval exec exit filter float format frozenset getattr globals hasattr hash help hex id input int isinstance issubclass iter len license list " +
    "locals map max memoryview min next object oct open ord pow print property quit range repr reversed round set setattr slice sorted staticmethod str sum " +
    "super tuple type vars zip __import__ __name__ __file__ __doc__ __builtins__ __spec__ __loader__ __package__ __debug__ __annotations__ __dict__ __class__ " +
    "NotImplemented Ellipsis self cls match case _ " +
    "BaseException Exception ArithmeticError AssertionError AttributeError BufferError EOFError FloatingPointError GeneratorExit ImportError " +
    "ModuleNotFoundError IndexError KeyError KeyboardInterrupt LookupError MemoryError NameError NotImplementedError OSError OverflowError " +
    "RecursionError ReferenceError RuntimeError StopIteration StopAsyncIteration SyntaxError IndentationError TabError SystemError SystemExit " +
    "TypeError UnboundLocalError UnicodeError UnicodeEncodeError UnicodeDecodeError UnicodeTranslateError ValueError ZeroDivisionError " +
    "EnvironmentError IOError WindowsError BlockingIOError ChildProcessError ConnectionError BrokenPipeError ConnectionAbortedError " +
    "ConnectionRefusedError ConnectionResetError FileExistsError FileNotFoundError InterruptedError IsADirectoryError NotADirectoryError " +
    "PermissionError ProcessLookupError TimeoutError Warning UserWarning DeprecationWarning PendingDeprecationWarning SyntaxWarning " +
    "RuntimeWarning FutureWarning ImportWarning UnicodeWarning BytesWarning ResourceWarning EncodingWarning ExceptionGroup BaseExceptionGroup"
  ).split(" "),
);
const PY_BLOCK = new Set(["if", "elif", "else", "for", "while", "def", "class", "try", "except", "finally", "with"]);

/** Python：名前 → 足す import 文 */
interface PyImport {
  /** import 文（そのまま書く形） */
  line: string;
  /** from 〜 import の形なら、そのモジュール名（既存の行に足せる） */
  from?: string;
  name: string;
}

const PY_MODULE_USE = [
  "math", "random", "os", "sys", "json", "csv", "time", "re", "collections", "copy", "statistics", "itertools", "functools",
  "string", "turtle", "pathlib", "subprocess", "shutil", "glob", "pickle", "sqlite3", "heapq", "bisect", "decimal", "fractions",
  "tkinter", "socket", "threading", "asyncio", "logging", "argparse", "typing", "enum", "textwrap", "pprint", "unittest", "datetime",
  "calendar", "hashlib", "base64", "secrets", "urllib", "zipfile", "tempfile", "platform", "webbrowser", "winsound",
];
const PY_ALIAS: Record<string, string> = {
  np: "import numpy as np",
  pd: "import pandas as pd",
  plt: "import matplotlib.pyplot as plt",
  tk: "import tkinter as tk",
  sns: "import seaborn as sns",
  ttk: "from tkinter import ttk",
};
const PY_FROM: Record<string, string> = {};
function fromList(mod: string, names: string) {
  for (const n of names.split(" ")) PY_FROM[n] = mod;
}
fromList("math", "sqrt isqrt floor ceil pi gcd lcm factorial log log2 log10 exp sin cos tan asin acos atan atan2 radians degrees hypot inf comb perm fabs trunc dist prod");
fromList("random", "randint randrange choice choices shuffle uniform sample");
fromList("time", "sleep perf_counter");
fromList("pathlib", "Path");
fromList("collections", "deque Counter defaultdict namedtuple OrderedDict");
fromList("dataclasses", "dataclass field asdict");
fromList("copy", "deepcopy");
fromList("datetime", "date timedelta");
fromList("statistics", "mean median mode stdev pstdev variance");
fromList("functools", "reduce partial lru_cache cache cmp_to_key");
fromList("itertools", "permutations combinations product accumulate chain zip_longest groupby combinations_with_replacement");
fromList("heapq", "heappush heappop heapify nlargest nsmallest");
fromList("bisect", "bisect_left bisect_right insort");
fromList("fractions", "Fraction");
fromList("decimal", "Decimal");
fromList("enum", "Enum IntEnum auto");
fromList("pprint", "pprint");
fromList("typing", "List Dict Tuple Set Optional Any Union Callable Iterable");
fromList("abc", "ABC abstractmethod");
fromList("string", "ascii_lowercase ascii_uppercase ascii_letters digits punctuation");

function pyImportFor(name: string, toks: Tok[], idx: number): PyImport | null {
  const nextDot = toks[idx + 1]?.v === ".";
  if (name === "datetime") {
    // datetime.datetime / datetime.date… ならモジュール、datetime.now() ならクラス
    const attr = nextDot ? toks[idx + 2]?.v : "";
    if (attr && ["datetime", "date", "timedelta", "time", "timezone"].includes(attr)) return { line: "import datetime", name };
    return { line: "from datetime import datetime", from: "datetime", name };
  }
  if (name === "random" && !nextDot) return { line: "from random import random", from: "random", name };
  if (name === "pprint" && nextDot) return { line: "import pprint", name };
  if (PY_ALIAS[name]) return { line: PY_ALIAS[name], name, from: PY_ALIAS[name].startsWith("from ") ? "tkinter" : undefined };
  if (nextDot && PY_MODULE_USE.includes(name)) return { line: `import ${name}`, name };
  const mod = PY_FROM[name];
  if (mod) return { line: `from ${mod} import ${name}`, from: mod, name };
  if (PY_MODULE_USE.includes(name)) return { line: `import ${name}`, name };
  return null;
}

interface PyScan {
  defined: Set<string>;
  uses: { name: string; i: number }[];
  /** 調べるのをやめた方がよいとき（from x import * など） */
  unsure: boolean;
}

function scanPython(toks: Tok[]): PyScan {
  const defined = new Set<string>();
  const uses: { name: string; i: number }[] = [];
  let unsure = false;
  const skip = new Set<number>();
  let start = 0;
  for (let i = 0; i <= toks.length; i++) {
    const end = i === toks.length || toks[i].k === "nl" || (toks[i].v === ";" && toks[i].d === 0);
    if (!end) continue;
    const L = toks.slice(start, i).map((t, j) => ({ t, j: start + j }));
    start = i + 1;
    if (!L.length) continue;
    const first = L[0].t.v;
    const ids = (a: number, b: number) => L.slice(a, b).filter((x) => x.t.k === "id");
    // 先頭が async のときは、その次を見る
    const head = first === "async" ? 1 : first.startsWith("@") ? -1 : 0;
    const kw = head >= 0 ? L[head]?.t.v : "";
    if (kw === "import" || kw === "from") {
      for (const x of L) skip.add(x.j);
      if (kw === "import") {
        // import a.b as c, d
        let k = head + 1;
        while (k < L.length) {
          const seg = L[k];
          if (seg.t.k !== "id") {
            k++;
            continue;
          }
          let e = k;
          while (L[e + 1]?.t.v === "." && L[e + 2]?.t.k === "id") e += 2;
          if (L[e + 1]?.t.v === "as" && L[e + 2]) {
            defined.add(L[e + 2].t.v);
            k = e + 3;
          } else {
            defined.add(seg.t.v);
            k = e + 1;
          }
        }
      } else {
        const imp = L.findIndex((x) => x.t.v === "import");
        if (imp < 0) continue;
        for (let k = imp + 1; k < L.length; k++) {
          const x = L[k].t;
          if (x.v === "*") unsure = true;
          if (x.k !== "id" || x.v === "as") continue;
          if (L[k + 1]?.t.v === "as") continue;
          defined.add(x.v);
        }
      }
      continue;
    }
    if (kw === "global" || kw === "nonlocal") {
      for (const x of L) {
        skip.add(x.j);
        if (x.t.k === "id" && x.t.v !== kw) defined.add(x.t.v);
      }
      continue;
    }
    if ((kw === "def" || kw === "class") && L[head + 1]?.t.k === "id") {
      defined.add(L[head + 1].t.v);
      skip.add(L[head + 1].j);
      if (kw === "def") {
        // 引数
        const open = head + 2;
        if (L[open]?.t.v === "(") {
          const base = L[open].t.d + 1;
          for (let k = open + 1; k < L.length; k++) {
            const x = L[k].t;
            if (x.v === ")" && x.d === base - 1) break;
            if (x.k === "id" && x.d === base && ["(", ",", "*", "**"].includes(L[k - 1].t.v)) {
              defined.add(x.v);
              skip.add(L[k].j);
            }
          }
        }
      }
    }
    if (kw === "case") {
      for (const x of ids(head + 1, L.length)) if (L[L.indexOf(x) - 1]?.t.v !== ".") defined.add(x.t.v);
    }
    // 注釈つきの代入 x: int = 5
    if (L[0].t.k === "id" && L[1]?.t.v === ":" && !PY_KEYWORDS.has(first)) {
      defined.add(first);
      skip.add(L[0].j);
    }
    // 代入（いちばん外側の = より左）
    let lastEq = -1;
    for (let k = 0; k < L.length; k++) {
      const v = L[k].t.v;
      if (L[k].t.k === "op" && L[k].t.d === 0 && (v === "=" || (v.length >= 2 && v.endsWith("=") && !["==", "!=", "<=", ">=", "==="].includes(v)))) lastEq = k;
    }
    if (lastEq > 0) {
      for (let k = 0; k < lastEq; k++) {
        const x = L[k].t;
        if (x.k === "id" && L[k - 1]?.t.v !== "." && !PY_KEYWORDS.has(x.v)) defined.add(x.v);
      }
    }
    for (let k = 0; k < L.length; k++) {
      const x = L[k].t;
      if (x.k !== "id") continue;
      const prev = L[k - 1]?.t;
      const next = L[k + 1]?.t;
      // for 〜 in（内包表記も）
      if (x.v === "for") {
        for (let e = k + 1; e < L.length && !(L[e].t.v === "in" && L[e].t.d === x.d); e++) {
          if (L[e].t.k === "id" && L[e - 1].t.v !== ".") defined.add(L[e].t.v);
        }
      }
      if (x.v === "lambda") {
        for (let e = k + 1; e < L.length && !(L[e].t.v === ":" && L[e].t.d === x.d); e++) {
          if (L[e].t.k === "id" && ["lambda", ",", "*", "**"].includes(L[e - 1].t.v)) {
            defined.add(L[e].t.v);
            skip.add(L[e].j);
          }
        }
      }
      if (x.v === "as" && next?.k === "id") defined.add(next.v);
      if (next?.v === ":=") defined.add(x.v);
      // f(x=1) の x は名前の使用ではない
      if (x.d > 0 && next?.v === "=" && (prev?.v === "(" || prev?.v === ",")) skip.add(L[k].j);
      if (x.v === "exec" && next?.v === "(") unsure = true;
      if (x.v === "globals" && next?.v === "(") unsure = true;
    }
    for (const x of L) {
      if (x.t.k !== "id" || skip.has(x.j)) continue;
      if (toks[x.j - 1]?.v === ".") continue;
      if (PY_KEYWORDS.has(x.t.v)) continue;
      uses.push({ name: x.t.v, i: x.j });
    }
  }
  return { defined, uses, unsure };
}

function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  // 入れかわり（pirnt → print）も 1 回と数える
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    let best = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      best = Math.min(best, d[i][j]);
    }
    if (best > max) return max + 1;
  }
  return d[a.length][b.length];
}

/** よく使う名前（打ちかけ・タイプミスの候補で先に出す） */
const COMMON_NAMES = ["print", "input", "range", "len", "int", "str", "float", "list", "dict", "set", "tuple", "sorted", "sum", "max", "min", "abs", "round", "open", "enumerate", "zip", "type", "isinstance", "bool", "format", "reversed", "map", "filter", "any", "all"];

/** タイプミスの直し方の候補：同じ大文字小文字ちがい → 打ちかけ（pr → print）→ 1〜2 文字ちがい */
export function closest(name: string, pool: Iterable<string>): string | null {
  const list = [...new Set(pool)].filter((c) => c !== name && c.length >= 2);
  const lower = name.toLowerCase();
  const sameCase = list.find((c) => c.toLowerCase() === lower);
  if (sameCase) return sameCase;
  const max = name.length >= 6 ? 2 : 1;
  let best: string | null = null;
  let bestD = max + 1;
  for (const cand of list) {
    const d = editDistance(name, cand, max);
    if (d < bestD || (d === bestD && best && COMMON_NAMES.indexOf(cand) >= 0 && (COMMON_NAMES.indexOf(best) < 0 || COMMON_NAMES.indexOf(cand) < COMMON_NAMES.indexOf(best)))) {
      bestD = d;
      best = cand;
    }
  }
  // 打ちかけ（先頭が同じで、少し短い）は、よく使う名前を優先
  if (name.length >= 2) {
    const prefix = list.filter((c) => c.startsWith(name) && c.length - name.length <= 6);
    if (prefix.length) {
      prefix.sort((a, b) => {
        const ia = COMMON_NAMES.indexOf(a);
        const ib = COMMON_NAMES.indexOf(b);
        if (ia >= 0 || ib >= 0) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
        return a.length - b.length;
      });
      const p = prefix[0];
      // 1 文字ちがいの候補があって、それがよく使う名前なら、そちら（pirnt → print）
      if (!best || bestD > 1 || COMMON_NAMES.indexOf(p) >= 0) return p;
    }
  }
  return best;
}

/** Python の import を足す変更 */
export function pythonImportEdit(text: string, imp: { line: string; from?: string; name: string }): { from: number; to: number; insert: string } {
  const lines = text.split("\n");
  const offsets: number[] = [];
  let o = 0;
  for (const l of lines) {
    offsets.push(o);
    o += l.length + 1;
  }
  // すでに「from math import a, b」があれば、そこに足す
  if (imp.from) {
    const re = new RegExp(`^from\\s+${imp.from.replace(/\./g, "\\.")}\\s+import\\s+([^#()\\\\]+?)\\s*(#.*)?$`);
    for (let i = 0; i < lines.length; i++) {
      const m = re.exec(lines[i].replace(/\r$/, ""));
      if (m && m[1] !== "*") {
        const pos = offsets[i] + lines[i].replace(/\r$/, "").indexOf(m[1]) + m[1].length;
        return { from: pos, to: pos, insert: `, ${imp.name}` };
      }
    }
  }
  // いちばん後ろの import 行の下
  let last = -1;
  let inDoc = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const tq = (l.match(/"""|'''/g) ?? []).length;
    if (inDoc) {
      if (tq % 2 === 1) inDoc = false;
      continue;
    }
    if (tq % 2 === 1) {
      inDoc = true;
      continue;
    }
    if (/^(import|from)\s+\S/.test(l)) {
      last = i;
      // かっこで複数行にわたる from 〜 import (
      if (/\(\s*(#.*)?$/.test(l)) while (last + 1 < lines.length && !lines[last].includes(")")) last++;
    }
  }
  if (last >= 0) {
    const pos = offsets[last] + lines[last].length;
    return { from: pos, to: pos, insert: "\n" + imp.line };
  }
  // 1 行目の指定（## py ##）・#!・文字コードの指定・最初の説明文の下
  let at = 0;
  while (at < lines.length && (/^#!|^#.*coding[:=]|^\s*##\s*.+\s*##\s*$/.test(lines[at]) || /^from\s+__future__/.test(lines[at]))) at++;
  if (at < lines.length && /^\s*[rRuU]?("""|''')/.test(lines[at])) {
    const q = /("""|''')/.exec(lines[at])![1];
    const rest = lines[at].slice(lines[at].indexOf(q) + 3);
    if (!rest.includes(q)) {
      at++;
      while (at < lines.length && !lines[at].includes(q)) at++;
    }
    at++;
  }
  if (at >= lines.length) {
    return { from: text.length, to: text.length, insert: (text && !text.endsWith("\n") ? "\n" : "") + imp.line + "\n" };
  }
  const next = lines[at];
  return { from: offsets[at], to: offsets[at], insert: imp.line + "\n" + (next.trim() ? "\n" : "") };
}

function checkPython(text: string, lexed: Lexed, cursor: number | null): Problem[] {
  const out: Problem[] = [];
  const { toks } = lexed;
  // 「:」の付け忘れ
  let start = 0;
  for (let i = 0; i < toks.length; i++) {
    if (toks[i].k !== "nl") continue;
    const L = toks.slice(start, i);
    start = i + 1;
    if (!L.length) continue;
    const head = L[0].v === "async" ? L[1] : L[0];
    if (!head || head.k !== "id" || !PY_BLOCK.has(head.v)) continue;
    if (L[L.length - 1].d !== 0) continue;
    if (L.some((t) => t.v === ":" && t.d === 0)) continue;
    // else だけのときなどは、行の終わりに印をつける
    const last = L[L.length - 1];
    out.push({
      from: last.from,
      to: last.to,
      kind: "syntax",
      severity: "error",
      msg: "check.missingColon",
      args: { kw: head.v },
      fixes: [{ label: "check.fix.addColon", changes: [{ from: last.to, to: last.to, insert: ":" }] }],
    });
  }
  // まだ作っていない名前
  const scan = scanPython(toks);
  if (scan.unsure) return out;
  const pool = new Set([...scan.defined, ...PY_BUILTINS, ...Object.keys(PY_FROM)]);
  let count = 0;
  for (const u of scan.uses) {
    if (scan.defined.has(u.name) || PY_BUILTINS.has(u.name)) continue;
    const t = toks[u.i];
    // 入力の途中（カーソルが名前にくっついている）は出さない
    if (cursor !== null && cursor >= t.from && cursor <= t.to) continue;
    if (++count > 200) break;
    const imp = pyImportFor(u.name, toks, u.i);
    if (imp) {
      out.push({
        from: t.from,
        to: t.to,
        kind: "import",
        severity: "warning",
        msg: "check.needImport",
        args: { name: u.name, line: imp.line },
        fixes: [{ label: "check.fix.addImport", args: { line: imp.line }, changes: [pythonImportEdit(text, imp)] }],
      });
      continue;
    }
    const near = closest(u.name, pool);
    out.push({
      from: t.from,
      to: t.to,
      kind: "undefined",
      severity: "warning",
      msg: near ? "check.undefinedNear" : "check.undefined",
      args: { name: u.name, near: near ?? "" },
      fixes: near ? [{ label: "check.fix.rename", args: { name: near }, changes: [{ from: t.from, to: t.to, insert: near }] }] : [],
    });
  }
  return out;
}

// ---------- Java / C# / C / C++ / Go / Rust ----------

interface ImportRule {
  /** 足す文 */
  line: string;
  /** すでにあるかどうか */
  has: (text: string) => boolean;
}

function mapOf(entries: [string, string][]): Map<string, string> {
  const m = new Map<string, string>();
  for (const [pkg, names] of entries) for (const n of names.split(" ")) m.set(n, pkg);
  return m;
}

const JAVA = mapOf([
  ["java.util", "ArrayList List HashMap Map HashSet Set Scanner Arrays Collections LinkedList Queue Deque ArrayDeque Random Iterator Stack TreeMap TreeSet PriorityQueue Optional Objects LinkedHashMap"],
  ["java.io", "File FileReader BufferedReader InputStreamReader IOException FileWriter PrintWriter BufferedWriter FileNotFoundException"],
  ["java.nio.file", "Files Paths Path"],
  ["java.util.stream", "Collectors Stream IntStream"],
  ["java.math", "BigInteger BigDecimal"],
  ["java.time", "LocalDate LocalDateTime LocalTime Duration"],
  ["java.util.function", "Function Consumer Supplier Predicate BiFunction"],
]);
const CSHARP = mapOf([
  ["System", "Console Math Random DateTime TimeSpan Exception Action Func Array Convert Environment Guid ArgumentException InvalidOperationException NotImplementedException Serializable NonSerialized"],
  ["System.Collections", "IEnumerator ArrayList Hashtable"],
  ["System.Collections.Generic", "List Dictionary HashSet Queue Stack KeyValuePair LinkedList SortedDictionary IEnumerable"],
  ["System.Text", "StringBuilder Encoding"],
  ["System.IO", "File Directory StreamReader StreamWriter"],
  ["System.Text.RegularExpressions", "Regex"],
  ["System.Threading.Tasks", "Task"],
  ["UnityEngine", "MonoBehaviour Vector2 Vector3 Vector4 Vector2Int Vector3Int GameObject Transform Rigidbody Rigidbody2D Collider Collider2D Collision Collision2D Debug Time Input Quaternion Mathf Color Camera SerializeField Header Tooltip RequireComponent Coroutine WaitForSeconds WaitForEndOfFrame Application Physics Physics2D Ray RaycastHit RaycastHit2D KeyCode AudioSource AudioClip Animator Sprite SpriteRenderer Resources PlayerPrefs ScriptableObject LayerMask Screen Cursor Renderer Material Texture2D Light CharacterController Bounds Gizmos ForceMode ForceMode2D"],
  ["UnityEngine.SceneManagement", "SceneManager Scene"],
  ["UnityEngine.UI", "Image Button Slider Toggle InputField RawImage Scrollbar Dropdown ScrollRect"],
  ["TMPro", "TextMeshProUGUI TMP_Text TextMeshPro TMP_InputField TMP_Dropdown"],
  ["UnityEngine.AI", "NavMeshAgent NavMesh"],
  ["UnityEngine.Events", "UnityEvent UnityAction"],
]);
const CSHARP_LINQ = new Set(["Where", "Select", "OrderBy", "OrderByDescending", "ToList", "FirstOrDefault", "LastOrDefault", "Any", "All", "Sum", "Average", "Distinct", "GroupBy", "SelectMany", "ThenBy", "Take", "Skip", "ToDictionary", "Aggregate"]);
const C_HEADERS = mapOf([
  ["stdio.h", "printf scanf puts fopen fclose fgets fputs fprintf fscanf getchar putchar sprintf snprintf FILE EOF"],
  ["stdlib.h", "malloc free calloc realloc exit atoi atof rand srand qsort abs system EXIT_SUCCESS EXIT_FAILURE"],
  ["string.h", "strlen strcpy strncpy strcmp strncmp strcat strchr strstr memset memcpy memcmp"],
  ["math.h", "sqrt pow sin cos tan fabs floor ceil log log10 exp round"],
  ["time.h", "time clock clock_t time_t CLOCKS_PER_SEC"],
  ["stdbool.h", "bool true false"],
  ["ctype.h", "isdigit isalpha isalnum isspace isupper islower toupper tolower"],
]);
const CPP_HEADERS = mapOf([
  ["iostream", "cout cin endl cerr"],
  ["vector", "vector"],
  ["string", "string getline to_string stoi stod"],
  ["map", "map"],
  ["unordered_map", "unordered_map"],
  ["set", "set"],
  ["unordered_set", "unordered_set"],
  ["queue", "queue priority_queue"],
  ["stack", "stack"],
  ["deque", "deque"],
  ["algorithm", "sort reverse max_element min_element find_if count_if unique lower_bound upper_bound next_permutation"],
  ["numeric", "accumulate iota"],
  ["cmath", "sqrt pow fabs floor ceil"],
  ["iomanip", "setprecision setw fixed"],
  ["cstdio", "printf scanf"],
  ["cstring", "strlen strcpy strcmp memset"],
  ["cstdlib", "rand srand malloc exit"],
  ["random", "mt19937 random_device uniform_int_distribution"],
  ["chrono", "chrono"],
  ["thread", "thread"],
]);
const GO_PKGS: Record<string, string> = {
  fmt: "fmt", strings: "strings", strconv: "strconv", math: "math", os: "os", time: "time", sort: "sort", bufio: "bufio",
  errors: "errors", rand: "math/rand", io: "io", sync: "sync", json: "encoding/json", http: "net/http", filepath: "path/filepath",
  unicode: "unicode", bytes: "bytes", regexp: "regexp", utf8: "unicode/utf8", log: "log",
};
const RUST = mapOf([
  ["std::collections", "HashMap HashSet BTreeMap BTreeSet VecDeque BinaryHeap"],
  ["std::cmp", "Ordering Reverse"],
  ["std::fs", "File"],
  ["std::fmt", "Display"],
  ["std::rc", "Rc"],
  ["std::cell", "RefCell"],
  ["std::sync", "Arc Mutex"],
  ["rand", "Rng"],
]);

function ruleFor(lang: CheckLang, name: string, toks: Tok[], i: number): ImportRule | null {
  const prev = toks[i - 1]?.v;
  const next = toks[i + 1]?.v;
  if (lang === "java") {
    const pkg = JAVA.get(name);
    if (!pkg || prev === ".") return null;
    return {
      line: `import ${pkg}.${name};`,
      has: (t) => new RegExp(`^\\s*import\\s+(${pkg.replace(/\./g, "\\.")}\\.(\\*|${name})|[\\w.]+\\.${name})\\s*;`, "m").test(t),
    };
  }
  if (lang === "csharp") {
    let ns: string | undefined;
    if (prev === "." && next === "(" && CSHARP_LINQ.has(name)) {
      // Math.Max( などの「型.メソッド」は LINQ ではない
      const owner = toks[i - 2];
      if (owner && /^[A-Z]/.test(owner.v) && toks[i - 3]?.v !== ".") return null;
      ns = "System.Linq";
    } else if (prev !== ".") ns = CSHARP.get(name);
    if (!ns) return null;
    // Debug は System.Diagnostics にもある
    const nsRe = ns.replace(/\./g, "\\.");
    return {
      line: `using ${ns};`,
      has: (t) => new RegExp(`^\\s*(global\\s+)?using\\s+${nsRe}\\s*;`, "m").test(t) || (name === "Debug" && /using\s+System\.Diagnostics\s*;/.test(t)) || new RegExp(`^\\s*namespace\\s+${nsRe}\\b`, "m").test(t),
    };
  }
  if (lang === "c" || lang === "cpp") {
    if (prev === "." || prev === "->") return null;
    if (lang === "cpp" && prev === "::" && toks[i - 2]?.v !== "std") return null;
    const h = (lang === "c" ? C_HEADERS : CPP_HEADERS).get(name);
    if (!h) return null;
    // C++ で std:: が付いていない string などは、using namespace std がなければ別の名前
    if (lang === "cpp" && prev !== "::" && !["printf", "scanf", "strlen", "strcpy", "strcmp", "memset", "rand", "srand", "malloc", "exit", "sqrt", "pow", "fabs", "floor", "ceil"].includes(name)) {
      return {
        line: `#include <${h}>`,
        has: (t) => !/using\s+namespace\s+std\s*;/.test(t) || hasInclude(t, h) || (name === "string" && hasInclude(t, "iostream")),
      };
    }
    return { line: `#include <${h}>`, has: (t) => hasInclude(t, h) };
  }
  if (lang === "go") {
    if (prev === "." || next !== ".") return null;
    const pkg = GO_PKGS[name];
    if (!pkg) return null;
    return { line: `"${pkg}"`, has: (t) => new RegExp(`(^|\\s|\\()(\\w+\\s+)?"${pkg.replace(/\//g, "\\/")}"`, "m").test(goImportBlock(t)) };
  }
  if (lang === "rust") {
    if (prev === "::") return null;
    const path = RUST.get(name);
    if (!path) return null;
    const pre = path.replace(/:/g, "\\:");
    return {
      line: `use ${path}::${name};`,
      has: (t) => new RegExp(`^\\s*use\\s+${pre}::(${name}\\b|\\{[^}]*\\b${name}\\b|\\*)`, "m").test(t),
    };
  }
  return null;
}

function hasInclude(text: string, header: string): boolean {
  if (/#\s*include\s*<bits\/stdc\+\+\.h>/.test(text)) return true;
  const h = header.replace(/[.+]/g, "\\$&");
  if (new RegExp(`#\\s*include\\s*[<"]${h}[>"]`).test(text)) return true;
  // C++ の <cmath> と C の <math.h> は同じもの
  const alt = header.startsWith("c") && !header.includes(".") ? header.slice(1) + ".h" : header.endsWith(".h") ? "c" + header.slice(0, -2) : "";
  return !!alt && new RegExp(`#\\s*include\\s*[<"]${alt.replace(/[.+]/g, "\\$&")}[>"]`).test(text);
}

function goImportBlock(text: string): string {
  const m = /^import\s*\(([\s\S]*?)\)/m.exec(text);
  const singles = [...text.matchAll(/^import\s+(\w+\s+)?"[^"]+"/gm)].map((x) => x[0]);
  return (m ? m[1] : "") + "\n" + singles.join("\n");
}

/** 言語ごとの「足す位置」 */
export function importEdit(text: string, lang: CheckLang, line: string, name = ""): { from: number; to: number; insert: string } {
  if (lang === "python") {
    const m = /^from\s+(\S+)\s+import\s+(\w+)$/.exec(line);
    return pythonImportEdit(text, { line, from: m?.[1], name: m?.[2] ?? name });
  }
  const lines = text.split("\n");
  const offsets: number[] = [];
  let o = 0;
  for (const l of lines) {
    offsets.push(o);
    o += l.length + 1;
  }
  const after = (i: number, insert: string) => {
    const pos = offsets[i] + lines[i].length;
    return { from: pos, to: pos, insert: "\n" + insert };
  };
  const lastMatch = (re: RegExp) => {
    let last = -1;
    for (let i = 0; i < lines.length; i++) if (re.test(lines[i])) last = i;
    return last;
  };
  // 1 行目の言語の指定（// ## C# ##）の下
  const top = /^\s*(\/\/)?\s*##\s*.+\s*##\s*$/.test(lines[0] ?? "") ? 1 : 0;
  const atTop = (insert: string) => {
    const pos = top ? offsets[1] ?? text.length : 0;
    const next = lines[top] ?? "";
    return { from: pos, to: pos, insert: (top && pos === text.length && !text.endsWith("\n") ? "\n" : "") + insert + "\n" + (next.trim() ? "\n" : "") };
  };
  if (lang === "go") {
    const block = lines.findIndex((l) => /^import\s*\(/.test(l));
    if (block >= 0) {
      let close = block;
      while (close < lines.length && !/^\s*\)/.test(lines[close]) && !(close === block && lines[close].includes(")"))) close++;
      if (close < lines.length && close > block) return { from: offsets[close], to: offsets[close], insert: `\t${line}\n` };
    }
    const single = lastMatch(/^import\s+(\w+\s+)?"/);
    if (single >= 0) return after(single, `import ${line}`);
    const pkg = lines.findIndex((l) => /^package\s+\w+/.test(l));
    if (pkg >= 0) return after(pkg, `\nimport ${line}`);
    return atTop(`import ${line}`);
  }
  const re = lang === "java" ? /^\s*import\s+[\w.*]+\s*;/ : lang === "csharp" ? /^\s*using\s+[\w.]+\s*;/ : lang === "rust" ? /^\s*use\s+/ : /^\s*#\s*include\b/;
  const last = lastMatch(re);
  if (last >= 0) {
    if (lang === "rust") {
      // use の中身が複数行のとき
      let e = last;
      while (e < lines.length && !lines[e].includes(";")) e++;
      return after(Math.min(e, lines.length - 1), line);
    }
    return after(last, line);
  }
  if (lang === "java") {
    const pkg = lines.findIndex((l) => /^\s*package\s+[\w.]+\s*;/.test(l));
    if (pkg >= 0) return after(pkg, "\n" + line);
  }
  return atTop(line);
}

const NOT_TYPE = new Set(["new", "return", "else", "throw", "case", "await", "yield", "typeof", "sizeof", "delete", "goto", "in", "is", "as", "using", "nameof"]);

function checkOthers(text: string, lang: CheckLang, lexed: Lexed): Problem[] {
  const out: Problem[] = [];
  const { toks } = lexed;
  // ファイルの中で自分で作っている型・関数
  const own = new Set<string>();
  for (let i = 0; i < toks.length; i++) {
    const v = toks[i].v;
    if (["class", "struct", "interface", "enum", "record", "type", "fn", "func", "typedef"].includes(v) && toks[i + 1]?.k === "id") own.add(toks[i + 1].v);
    // int max(…) { のような関数の定義
    if (toks[i].k === "id" && !NOT_TYPE.has(toks[i].v) && toks[i + 1]?.k === "id" && toks[i + 2]?.v === "(" && lang !== "go" && lang !== "rust") own.add(toks[i + 1].v);
  }
  for (const m of text.matchAll(/^\s*#\s*define\s+(\w+)/gm)) own.add(m[1]);
  const seen = new Map<string, ImportRule | null>();
  let count = 0;
  for (let i = 0; i < toks.length; i++) {
    const tk = toks[i];
    if (tk.k !== "id" || own.has(tk.v)) continue;
    const key = tk.v + "\u0000" + (toks[i - 1]?.v === "." ? "." : "");
    let rule = seen.get(key);
    if (rule === undefined) {
      rule = ruleFor(lang, tk.v, toks, i);
      if (rule && rule.has(text)) rule = null;
      seen.set(key, rule);
    }
    if (!rule) {
      // LINQ などは毎回つづきを見て決める
      if (seen.get(key) === null && !(lang === "csharp" && CSHARP_LINQ.has(tk.v))) continue;
      rule = ruleFor(lang, tk.v, toks, i);
      if (!rule || rule.has(text)) continue;
    }
    if (++count > 100) break;
    const shown = lang === "go" ? `import ${rule.line}` : rule.line;
    out.push({
      from: tk.from,
      to: tk.to,
      kind: "import",
      severity: "info",
      msg: "check.needImport",
      args: { name: tk.v, line: shown },
      fixes: [{ label: "check.fix.addImport", args: { line: shown }, changes: [importEdit(text, lang, rule.line)] }],
    });
  }
  return out;
}

/** まとめて調べる。cursor は入力中の場所（そこにくっついている名前は出さない） */
/** Python の字下げ（本物の Python で調べられないときの代わり） */
export function pythonIndentProblems(text: string, lexed: Lexed): Problem[] {
  const out: Problem[] = [];
  const { toks, skipped } = lexed;
  const inSkip = (pos: number) => skipped.some(([a, b]) => pos > a && pos < b);
  const lines = text.split("\n");
  const stack = [0];
  let headerPending = false;
  let offset = 0;
  let ti = 0;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const start = offset;
    offset += raw.length + 1;
    const body = raw.trim();
    if (!body || body.startsWith("#") || inSkip(start)) continue;
    // この行の最初のトークンが「かっこの中」なら続きの行
    while (ti < toks.length && toks[ti].to <= start) ti++;
    const first = toks[ti];
    if (!first || first.from >= start + raw.length + 1) continue;
    if (first.d > 0) continue;
    if (i > 0 && /\\\s*$/.test(lines[i - 1])) continue;
    const lead = /^[ \t]*/.exec(raw)![0];
    const ind = lead.replace(/\t/g, "    ").length;
    const mark = { from: start + lead.length, to: start + raw.trimEnd().length };
    if (lead.includes("\t") && lead.includes(" ")) {
      out.push({ ...mark, kind: "syntax", severity: "warning", msg: "py.tabs", fixes: [{ label: "check.fix.spaces", changes: [{ from: start, to: start + lead.length, insert: " ".repeat(ind) }] }] });
    }
    const top = stack[stack.length - 1];
    if (headerPending) {
      headerPending = false;
      if (ind <= top) {
        const want = top + 4;
        out.push({ ...mark, kind: "syntax", severity: "error", msg: "py.expectedIndent", fixes: [{ label: "check.fix.indent", changes: [{ from: start, to: start + lead.length, insert: " ".repeat(want) }] }] });
        stack.push(want);
      } else stack.push(ind);
    } else if (ind > top) {
      out.push({ ...mark, kind: "syntax", severity: "error", msg: "py.unexpectedIndent", fixes: [{ label: "check.fix.indent", changes: [{ from: start, to: start + lead.length, insert: " ".repeat(top) }] }] });
    } else if (ind < top) {
      while (stack.length > 1 && stack[stack.length - 1] > ind) stack.pop();
      if (stack[stack.length - 1] !== ind) {
        const near = stack[stack.length - 1];
        out.push({ ...mark, kind: "syntax", severity: "error", msg: "py.unindent", fixes: [{ label: "check.fix.indent", changes: [{ from: start, to: start + lead.length, insert: " ".repeat(near) }] }] });
      }
    }
    // この行（とかっこの続き）の終わりが「:」なら、次の行は字下げが必要
    let j = ti;
    let lastTok = first;
    let colonInside = false;
    while (j < toks.length && toks[j].k !== "nl") {
      lastTok = toks[j++];
      if (lastTok.v === ":" && lastTok.d === 0) colonInside = true;
    }
    // 「:」を忘れた行（そちらは別に知らせる）も、次の行の字下げは正しいとみなす
    const blockKw = /^(if|elif|else|for|while|def|class|try|except|finally|with|async|match|case)\b/.test(body);
    const isHeader = blockKw && ((lastTok.v === ":" && lastTok.d === 0) || !colonInside);
    if (isHeader) headerPending = true;
  }
  return out;
}

const STMT_KW = new Set(["if", "for", "foreach", "while", "switch", "catch", "lock", "using", "fixed", "else", "do", "try", "finally"]);
const NOT_END = new Set(["else", "do", "try", "finally", "get", "set", "init", "public", "private", "protected", "internal", "static", "override", "virtual", "abstract", "sealed", "async", "return", "new", "case", "default", "operator", "where", "const", "readonly", "extern", "unsafe", "volatile", "partial", "template", "typename", "class", "struct", "enum", "interface", "namespace", "throws", "implements", "extends"]);
const CONT_START = new Set(["{", ".", "?", ":", "+", "-", "*", "/", "%", "&&", "||", "=>", ",", ")", "]", "?.", "??", "&", "|", "^", "==", "!=", "<", ">", "<=", ">=", "=", "+=", "-=", "<<", ">>", "::", "->"]);

/** C# / Java / C / C++：行の終わりの「;」忘れと、if の中の「=」 */
export function bracePunctProblems(text: string, lang: CheckLang, lexed: Lexed): Problem[] {
  if (!["csharp", "java", "c", "cpp", "dart"].includes(lang)) return [];
  const out: Problem[] = [];
  const { toks } = lexed;
  // 行ごとにトークンを分ける
  const lineOf: number[] = [];
  {
    let line = 0;
    let pos = 0;
    for (const tk of toks) {
      while (pos < tk.from) {
        const nl = text.indexOf("\n", pos);
        if (nl < 0 || nl >= tk.from) {
          pos = tk.from;
          break;
        }
        line++;
        pos = nl + 1;
      }
      lineOf.push(line);
    }
  }
  // { の種類：コードのまとまりか、値を並べる（enum・初期化）か
  const braceKinds: boolean[] = []; // true = 値を並べる
  let paren = 0;
  const lineText = (tkIndex: number) => {
    const ls = text.lastIndexOf("\n", toks[tkIndex].from - 1) + 1;
    const le = text.indexOf("\n", toks[tkIndex].from);
    return text.slice(ls, le < 0 ? text.length : le);
  };
  for (let i = 0; i < toks.length; i++) {
    const tk = toks[i];
    if (tk.v === "(" || tk.v === "[") paren++;
    else if (tk.v === ")" || tk.v === "]") paren = Math.max(0, paren - 1);
    else if (tk.v === "{") {
      const prev = toks[i - 1];
      const lt = lineText(i);
      const init = !!prev && (["=", ",", "(", "return", "=>", "]"].includes(prev.v) || /\b(new|enum)\b/.test(lt.slice(0, tk.from - (text.lastIndexOf("\n", tk.from - 1) + 1))) || (prev.v === ">" && /\bnew\b/.test(lt)));
      braceKinds.push(init || paren > 0);
    } else if (tk.v === "}") braceKinds.pop();
    // if ( x = 5 ) の「=」
    if ((tk.v === "if" || tk.v === "while") && toks[i + 1]?.v === "(") {
      const base = toks[i + 1].d + 1;
      for (let k = i + 2; k < toks.length; k++) {
        const x = toks[k];
        if (x.v === ")" && x.d === base - 1) break;
        if (x.v === "=" && x.d === base) {
          out.push({ from: x.from, to: x.to, kind: "syntax", severity: lang === "c" || lang === "cpp" ? "warning" : "error", msg: "check.assignInIf", fixes: [{ label: "check.fix.replace", args: { c: "==" }, changes: [{ from: x.from, to: x.to, insert: "==" }] }] });
          break;
        }
      }
    }
    // 行の終わりのトークンか
    const next = toks[i + 1];
    const endOfLine = !next || lineOf[i + 1] !== lineOf[i];
    if (!endOfLine) continue;
    if (paren > 0 || braceKinds[braceKinds.length - 1]) continue;
    const endsValue = tk.k === "id" || tk.k === "num" || tk.v === ")" || tk.v === "]" || tk.v === "++" || tk.v === "--" || (tk.v === ">" && false);
    if (!endsValue || (tk.k === "id" && NOT_END.has(tk.v))) continue;
    // この行の最初のトークン
    let f = i;
    while (f > 0 && lineOf[f - 1] === lineOf[i]) f--;
    const firstTok = toks[f];
    if (firstTok.v === "[" && tk.v === "]") continue; // [SerializeField] などの属性
    if (firstTok.v === "@") continue; // Java の @Override など
    if (STMT_KW.has(firstTok.v) && (tk.v === ")" || firstTok.v === "else" || firstTok.v === "do")) continue; // { のない if (…) など
    if (firstTok.v === "}" && toks[f + 1]?.v === "else") continue;
    if (firstTok.v === "case" || firstTok.v === "default") continue;
    // 次の行が続き（. や + で始まる・{ で始まる）なら、まだ文の途中
    if (!next) {
      // ファイルの最後：} の外の文だけ
    } else {
      if (CONT_START.has(next.v)) continue;
      if (next.v === "{" ) continue;
    }
    // 前の行が続きの記号で終わっている文の途中（a +\n b）も、ここで終わるなら ; が要る
    // メソッドや関数の宣言（次の行が { ）は上で除いた。型の宣言 class A : B も同じ
    if (/\b(class|struct|interface|enum|namespace|record)\b/.test(lineText(i))) continue;
    out.push({
      from: tk.from,
      to: tk.to,
      kind: "syntax",
      severity: "error",
      msg: "check.missingSemicolon",
      fixes: [{ label: "check.fix.addSemicolon", changes: [{ from: tk.to, to: tk.to, insert: ";" }] }],
    });
  }
  return out;
}

export function checkCode(text: string, lang: CheckLang, opts: { syntax: boolean; names: boolean; cursor?: number | null; indent?: boolean }): Problem[] {
  if (text.length > 400_000) return [];
  // 字句で分けない言語
  if (lang === "json") return opts.syntax ? jsonProblems(text) : [];
  if (lang === "html" || lang === "xml") return opts.syntax ? htmlProblems(text, lang === "xml") : [];
  const lexed = lex(text, lang);
  const out: Problem[] = [];
  if (opts.syntax) out.push(...lexed.problems);
  if (opts.syntax) {
    const lines = new Set(out.map((p) => text.slice(0, p.from).split("\n").length));
    const extra = lang === "ruby" || lang === "lua" ? endBlockProblems(text, lang, lexed) : lang === "shell" ? shellBlockProblems(text, lexed) : lang === "css" ? cssProblems(text, lexed) : [];
    out.push(...extra.filter((p) => !lines.has(text.slice(0, p.from).split("\n").length)));
  }
  if (opts.syntax && lang === "python" && opts.indent !== false) {
    const lines = new Set(out.map((p) => text.slice(0, p.from).split("\n").length));
    out.push(...pythonIndentProblems(text, lexed).filter((p) => !lines.has(text.slice(0, p.from).split("\n").length)));
  }
  if (opts.syntax && lang !== "python") {
    const lines = new Set(out.map((p) => text.slice(0, p.from).split("\n").length));
    out.push(...bracePunctProblems(text, lang, lexed).filter((p) => !lines.has(text.slice(0, p.from).split("\n").length)));
  }
  if (lang === "python") {
    const py = checkPython(text, lexed, opts.cursor ?? null);
    out.push(...py.filter((p) => (p.kind === "syntax" ? opts.syntax : opts.names)));
  } else if (opts.names) {
    out.push(...checkOthers(text, lang, lexed));
  }
  return out.sort((a, b) => a.from - b.from);
}

/** 補完の一覧に出す「import も足す」候補 */
export interface ImportSuggestion {
  name: string;
  line: string;
  edit: { from: number; to: number; insert: string };
}

export function importSuggestions(text: string, lang: CheckLang, typed: string, wordFrom: number): ImportSuggestion[] {
  if (typed.length < 2) return [];
  const out: ImportSuggestion[] = [];
  // 打っている途中の単語は除いて調べる（それ自体を「定義」と見なさないように）
  const rest = text.slice(0, wordFrom) + text.slice(wordFrom + typed.length);
  if (lang === "python") {
    const lexed = lex(rest, "python");
    const scan = scanPython(lexed.toks);
    if (scan.unsure) return [];
    const names = new Set([...PY_MODULE_USE, ...Object.keys(PY_ALIAS), ...Object.keys(PY_FROM)]);
    for (const name of names) {
      if (!name.startsWith(typed) || name === typed || scan.defined.has(name) || PY_BUILTINS.has(name)) continue;
      const fake: Tok[] = [{ k: "id", v: name, from: 0, to: 0, d: 0 }];
      const imp = pyImportFor(name, fake, 0);
      if (!imp) continue;
      out.push({ name, line: imp.line, edit: pythonImportEdit(rest, imp) });
    }
  } else if (["java", "csharp", "c", "cpp", "rust", "go"].includes(lang)) {
    const table: Map<string, string> | Record<string, string> =
      lang === "java" ? JAVA : lang === "csharp" ? CSHARP : lang === "c" ? C_HEADERS : lang === "cpp" ? CPP_HEADERS : lang === "rust" ? RUST : GO_PKGS;
    const keys = table instanceof Map ? [...table.keys()] : Object.keys(table);
    for (const name of keys) {
      if (!name.startsWith(typed) || name === typed) continue;
      const fake: Tok[] = [
        { k: "id", v: name, from: 0, to: 0, d: 0 },
        { k: "op", v: lang === "go" ? "." : "", from: 0, to: 0, d: 0 },
      ];
      const rule = ruleFor(lang, name, fake, 0);
      if (!rule || rule.has(rest)) continue;
      out.push({ name, line: lang === "go" ? `import ${rule.line}` : rule.line, edit: importEdit(rest, lang, rule.line) });
    }
  }
  // 編集の位置は「打っている単語を除いた文」でのものなので、元の文の位置に直す
  for (const s of out) {
    if (s.edit.from >= wordFrom) {
      s.edit = { ...s.edit, from: s.edit.from + typed.length, to: s.edit.to + typed.length };
    }
  }
  return out.slice(0, 12);
}
