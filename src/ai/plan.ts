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

const COMMENT: Record<string, [string, string]> = {
  ".py": ["#", ""], ".pyw": ["#", ""], ".rb": ["#", ""], ".sh": ["#", ""], ".bash": ["#", ""], ".zsh": ["#", ""],
  ".ps1": ["#", ""], ".r": ["#", ""], ".pl": ["#", ""], ".yaml": ["#", ""], ".yml": ["#", ""], ".toml": ["#", ""],
  ".js": ["//", ""], ".mjs": ["//", ""], ".cjs": ["//", ""], ".jsx": ["//", ""], ".ts": ["//", ""], ".tsx": ["//", ""],
  ".c": ["//", ""], ".h": ["//", ""], ".cpp": ["//", ""], ".cc": ["//", ""], ".hpp": ["//", ""], ".java": ["//", ""],
  ".kt": ["//", ""], ".kts": ["//", ""], ".cs": ["//", ""], ".go": ["//", ""], ".rs": ["//", ""], ".swift": ["//", ""],
  ".dart": ["//", ""], ".php": ["//", ""], ".scss": ["//", ""],
  ".lua": ["--", ""], ".sql": ["--", ""],
  ".css": ["/*", " */"], ".html": ["<!--", " -->"], ".htm": ["<!--", " -->"], ".vue": ["<!--", " -->"], ".xml": ["<!--", " -->"],
};

/**
 * ファイルの先頭を補うときに付ける見出し。AI に「何語のどのファイルか」を伝える。
 * 例：「# main.py」
 */
export function fileHeader(filename: string): string {
  if (!filename) return "";
  const c = COMMENT[extname(filename)];
  if (!c) return "";
  return `${c[0]} ${basename(filename)}${c[1]}\n`;
}
