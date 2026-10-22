// 補完の「頼み方」を決める（純粋関数）。どこまで書かせるか、どこで止めるか
import { basename, extname } from "../core/paths";

export interface Plan {
  /** 複数行を出してよいか */
  multiline: boolean;
  maxTokens: number;
  maxLines: number;
  /** 2行目以降で、これより字下げが浅い行が来たら止める（ブロックの終わり） */
  stopIndent: number | null;
  /** 止める直前に、閉じかっこだけの行（} や ]）を1行含めてよいか */
  allowClosing: boolean;
}

function indentOf(s: string): number {
  const m = /^[ \t]*/.exec(s)!;
  return m[0].replace(/\t/g, "    ").length;
}

/**
 * - 単語の途中（例：「impo」）では今の行だけを補う
 * - 新しい行の頭、または : { ( [ => の直後なら、そのブロックの中身を数行まで
 * - ファイルがほぼ空のときは材料が少ないので、短く
 */
export function planCompletion(opts: {
  linePrefix: string;
  lineSuffix: string;
  /** カーソルより前の文字数（空白を除く） */
  contentBefore: number;
  intent: boolean;
  maxTokensSetting: number;
}): Plan {
  const { linePrefix, lineSuffix, contentBefore, intent, maxTokensSetting } = opts;
  const atLineEnd = lineSuffix.trim() === "";
  const atLineStart = linePrefix.trim() === "";
  const afterOpener = /(:|\{|\(|\[|=>|\bthen|\bdo)\s*$/.test(linePrefix) && !/^\s*(#|\/\/)/.test(linePrefix);
  const indent = indentOf(linePrefix);

  if (intent && atLineEnd) {
    return { multiline: true, maxTokens: Math.max(maxTokensSetting, 320), maxLines: 40, stopIndent: atLineStart ? indent : null, allowClosing: false };
  }
  // ほぼ空のファイル：当てずっぽうの長いコードを出さない
  if (contentBefore < 24) {
    return { multiline: false, maxTokens: 24, maxLines: 1, stopIndent: null, allowClosing: false };
  }
  if (atLineEnd && afterOpener) {
    // ブロックの中身：今の行より深い字下げが続くあいだだけ
    return { multiline: true, maxTokens: Math.min(maxTokensSetting, 128), maxLines: 8, stopIndent: indent + 1, allowClosing: true };
  }
  if (atLineEnd && atLineStart) {
    // 新しい行の頭：同じ字下げの範囲で数行まで
    return { multiline: true, maxTokens: Math.min(maxTokensSetting, 96), maxLines: 6, stopIndent: indent, allowClosing: false };
  }
  // 単語の途中や行の途中：今の行だけ
  return { multiline: false, maxTokens: Math.min(maxTokensSetting, 48), maxLines: 1, stopIndent: null, allowClosing: false };
}

/** 候補の2行目以降を、ブロックが終わるところで切る */
export function cutAtDedent(text: string, stopIndent: number | null, allowClosing: boolean): string {
  if (stopIndent === null) return text;
  const lines = text.split("\n");
  const out: string[] = [lines[0]];
  for (let i = 1; i < lines.length; i++) {
    const l = lines[i];
    if (!l.trim()) {
      out.push(l);
      continue;
    }
    if (indentOf(l) < stopIndent) {
      if (allowClosing && /^\s*[)\]}]+[;,)]*\s*$/.test(l)) out.push(l);
      break;
    }
    out.push(l);
  }
  // 末尾の空行は落とす
  while (out.length > 1 && !out[out.length - 1].trim()) out.pop();
  return out.join("\n");
}

/** 拡張子 → [言語名, コメントの始まり, 終わり] */
const LANGS: Record<string, [string, string, string]> = {
  ".py": ["Python", "#", ""], ".pyw": ["Python", "#", ""], ".ipynb": ["Python", "#", ""],
  ".rb": ["Ruby", "#", ""], ".sh": ["Bash", "#", ""], ".bash": ["Bash", "#", ""], ".zsh": ["Zsh", "#", ""], ".fish": ["Fish", "#", ""],
  ".ps1": ["PowerShell", "#", ""], ".r": ["R", "#", ""], ".pl": ["Perl", "#", ""], ".jl": ["Julia", "#", ""],
  ".ex": ["Elixir", "#", ""], ".exs": ["Elixir", "#", ""], ".nim": ["Nim", "#", ""], ".cr": ["Crystal", "#", ""],
  ".yaml": ["YAML", "#", ""], ".yml": ["YAML", "#", ""], ".toml": ["TOML", "#", ""], ".ini": ["INI", ";", ""], ".cfg": ["INI", "#", ""],
  ".tf": ["Terraform", "#", ""], ".mk": ["Makefile", "#", ""], ".cmake": ["CMake", "#", ""], ".dockerfile": ["Dockerfile", "#", ""],
  ".js": ["JavaScript", "//", ""], ".mjs": ["JavaScript", "//", ""], ".cjs": ["JavaScript", "//", ""], ".jsx": ["JavaScript React", "//", ""],
  ".ts": ["TypeScript", "//", ""], ".mts": ["TypeScript", "//", ""], ".tsx": ["TypeScript React", "//", ""],
  ".c": ["C", "//", ""], ".h": ["C/C++ header", "//", ""], ".cpp": ["C++", "//", ""], ".cc": ["C++", "//", ""], ".cxx": ["C++", "//", ""], ".hpp": ["C++", "//", ""],
  ".m": ["Objective-C", "//", ""], ".mm": ["Objective-C++", "//", ""], ".java": ["Java", "//", ""], ".kt": ["Kotlin", "//", ""], ".kts": ["Kotlin", "//", ""],
  ".scala": ["Scala", "//", ""], ".groovy": ["Groovy", "//", ""], ".gradle": ["Gradle", "//", ""], ".cs": ["C#", "//", ""], ".fs": ["F#", "//", ""],
  ".go": ["Go", "//", ""], ".rs": ["Rust", "//", ""], ".swift": ["Swift", "//", ""], ".dart": ["Dart", "//", ""], ".zig": ["Zig", "//", ""],
  ".php": ["PHP", "//", ""], ".scss": ["SCSS", "//", ""], ".less": ["Less", "//", ""], ".sol": ["Solidity", "//", ""], ".proto": ["Protocol Buffers", "//", ""],
  ".v": ["V", "//", ""], ".d": ["D", "//", ""], ".glsl": ["GLSL", "//", ""], ".hlsl": ["HLSL", "//", ""],
  ".lua": ["Lua", "--", ""], ".sql": ["SQL", "--", ""], ".hs": ["Haskell", "--", ""], ".elm": ["Elm", "--", ""], ".ada": ["Ada", "--", ""],
  ".erl": ["Erlang", "%", ""], ".tex": ["LaTeX", "%", ""], ".m4": ["M4", "dnl", ""],
  ".clj": ["Clojure", ";;", ""], ".lisp": ["Common Lisp", ";;", ""], ".el": ["Emacs Lisp", ";;", ""], ".scm": ["Scheme", ";;", ""], ".asm": ["Assembly", ";", ""],
  ".vb": ["Visual Basic", "'", ""], ".vbs": ["VBScript", "'", ""], ".bat": ["Batch", "REM", ""], ".cmd": ["Batch", "REM", ""],
  ".css": ["CSS", "/*", " */"], ".html": ["HTML", "<!--", " -->"], ".htm": ["HTML", "<!--", " -->"], ".vue": ["Vue", "<!--", " -->"],
  ".svelte": ["Svelte", "<!--", " -->"], ".xml": ["XML", "<!--", " -->"], ".svg": ["SVG", "<!--", " -->"], ".md": ["Markdown", "<!--", " -->"],
};

/** 拡張子のないファイル名 */
const NAMED: Record<string, [string, string, string]> = {
  dockerfile: ["Dockerfile", "#", ""], makefile: ["Makefile", "#", ""], gnumakefile: ["Makefile", "#", ""], cmakelists: ["CMake", "#", ""],
  rakefile: ["Ruby", "#", ""], gemfile: ["Ruby", "#", ""], vagrantfile: ["Ruby", "#", ""], jenkinsfile: ["Groovy", "//", ""],
  ".bashrc": ["Bash", "#", ""], ".zshrc": ["Zsh", "#", ""], ".gitignore": ["gitignore", "#", ""], ".env": ["dotenv", "#", ""],
};

/** ファイル名に合ったコメントの書き方 [始まり, 終わり]（コメントを書けない形式なら null） */
export function commentSyntax(filename: string): [string, string] | null {
  const info = langInfo(filename);
  return info ? [info[1], info[2]] : null;
}

/** ファイル名から言語名を調べる（わからなければ空） */
export function languageOf(filename: string): string {
  return langInfo(filename)?.[0] ?? "";
}

function langInfo(filename: string): [string, string, string] | undefined {
  const base = basename(filename).toLowerCase();
  return LANGS[extname(filename)] ?? NAMED[base] ?? NAMED[base.replace(/\.txt$/, "")];
}

/**
 * ファイルの先頭を補うときに付ける見出し。AI に「何語のどのファイルか」を伝える。
 * 例：「# main.py (Python)」「// main.go (Go)」「<!-- index.html (HTML) -->」
 * JSON のようにコメントを書けない形式では付けない
 */
export function fileHeader(filename: string): string {
  if (!filename) return "";
  const info = langInfo(filename);
  if (!info) return "";
  const [name, start, end] = info;
  const base = basename(filename);
  const label = base.toLowerCase() === name.toLowerCase() ? base : `${base} (${name})`;
  return `${start} ${label}${end}\n`;
}
