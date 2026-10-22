// 自動判定モード：実行せずに、変数に何が入るかとエラーになりそうな行を予想する（画面に依存しない部分）
import { languageOf } from "./plan";

export interface InferVar {
  line: number;
  name: string;
  value: string;
}

export interface InferRisk {
  line: number;
  reason: string;
}

export interface InferResult {
  vars: InferVar[];
  risks: InferRisk[];
}

const MAX_LINES = 300;

export function buildInferPrompt(code: string, filename: string): string {
  const lang = languageOf(filename) || "プログラム";
  const numbered = code
    .split("\n")
    .slice(0, MAX_LINES)
    .map((l, i) => `${i + 1}: ${l}`)
    .join("\n");
  return [
    `次の ${lang} のコードを、実行せずに読んで考えてください。`,
    "",
    "1. 変数に値が入る（変わる）行ごとに、その行を実行したあとの値を予想する。",
    "   - くり返しの中なら「0 → 1 → … → 9」のように変化を書く。リストなどは最後の中身。",
    "   - input() で受け取る値は「ユーザーの入力に依存（整数）」のように書く。入力から計算できるなら「n * 2（n はユーザーの入力）」のような式で書く。",
    "   - ファイルや通信から読む値は「ファイルの内容に依存（文字列のリスト）」のように書く。",
    "2. 実行するとエラーになりそうな行と、その原因を短く書く（なければ書かない）。",
    "",
    "出力は、次の 2 種類の行だけにしてください。前置きや説明の文章は書かないでください。",
    "V|行番号|変数名|値",
    "E|行番号|起きそうなエラーと原因（30 文字くらい）",
    "",
    "例：",
    "V|1|a|[]",
    "V|2|i|0 → 1 → 2 → … → 9",
    "V|3|a|[0, 1, 2, …, 9]",
    "V|5|n|ユーザーの入力に依存（整数）",
    "E|6|ZeroDivisionError：n が 0 だと割り算できない",
    "",
    "コード：",
    numbered,
  ].join("\n");
}

const V_LINE = /^\s*V\s*[|｜]\s*(\d+)\s*[|｜]\s*([A-Za-z_][\w.]*(?:\[[^\]]*\])?)\s*[|｜]\s*(.+?)\s*$/;
const E_LINE = /^\s*E\s*[|｜]\s*(\d+)\s*[|｜]\s*(.+?)\s*$/;

export function parseInfer(answer: string, lineCount: number): InferResult {
  const vars: InferVar[] = [];
  const risks: InferRisk[] = [];
  for (const row of answer.split("\n")) {
    const v = V_LINE.exec(row);
    if (v) {
      const line = Number(v[1]);
      if (line >= 1 && line <= lineCount) vars.push({ line, name: v[2], value: v[3].slice(0, 160) });
      continue;
    }
    const e = E_LINE.exec(row);
    if (e) {
      const line = Number(e[1]);
      if (line >= 1 && line <= lineCount && !/^(なし|特になし|none)$/i.test(e[2])) risks.push({ line, reason: e[2].slice(0, 80) });
    }
  }
  return { vars, risks };
}

/** その行の時点で、その変数に入っている（と AI が予想した）値 */
export function lookupInferred(result: InferResult | null, name: string, line: number): { value: string; from: number } | { later: number } | null {
  if (!result) return null;
  const hits = result.vars.filter((v) => v.name === name || v.name.split(/[.[]/)[0] === name);
  if (!hits.length) return null;
  const before = hits.filter((v) => v.line <= line).sort((a, b) => b.line - a.line)[0];
  if (before) return { value: before.value, from: before.line };
  return { later: Math.min(...hits.map((v) => v.line)) };
}

const ASSIGN = (name: string) => new RegExp(`^\\s*(?:for\\s+(?:[\\w\\s,]*\\b)?${name}\\b[\\w\\s,]*\\s+in\\s+(.+?):|(?:[\\w\\s,]*\\b)?${name}\\b\\s*(?:[,\\w\\s]*)?(=|\\+=|-=|\\*=|/=)(?!=)\\s*(.+)|with\\s+.+\\s+as\\s+${name}\\s*:)`);

/**
 * AI の予想がまだないときの、コードから読み取れる範囲の見当（実行はしない）。
 * 例：a = [] → 「[]」、n = int(input()) → 「ユーザーの入力に依存」、for i in range(10) → 「range(10) の値を順に」
 */
export function staticGuess(lines: string[], name: string, line: number): string | null {
  if (!/^[A-Za-z_]\w*$/.test(name)) return null;
  const re = ASSIGN(name);
  for (let i = Math.min(line, lines.length) - 1; i >= 0; i--) {
    const text = lines[i].replace(/#.*$/, "");
    const m = re.exec(text);
    if (!m) continue;
    if (m[1]) {
      const iter = m[1].trim();
      const r = /^range\((.+)\)$/.exec(iter);
      if (r) {
        const args = r[1].split(",").map((s) => s.trim());
        const from = args.length > 1 ? args[0] : "0";
        const to = args.length > 1 ? args[1] : args[0];
        return `${from} から ${/^\d+$/.test(to) ? Number(to) - 1 : `${to} - 1`} まで順に（${i + 1} 行目の for）`;
      }
      return `${iter} の中身を 1 つずつ（${i + 1} 行目の for）`;
    }
    if (/with\s+/.test(text) && /open\(/.test(text)) return `ファイル（${i + 1} 行目で開いたもの）`;
    const op = m[2];
    const rhs = (m[3] ?? "").trim();
    if (/\binput\s*\(/.test(rhs)) {
      const kind = /^int\(/.test(rhs) ? "整数" : /^float\(/.test(rhs) ? "小数" : /split\(/.test(rhs) ? "区切った文字列のリスト" : "文字列";
      return `ユーザーの入力に依存（${kind}・${i + 1} 行目）`;
    }
    if (/\bopen\s*\(|\.read(lines)?\s*\(|csv\.reader|json\.load|requests\./.test(rhs)) return `ファイル・通信の内容に依存（${i + 1} 行目）`;
    if (/\brandom\./.test(rhs)) return `ランダム（${rhs}・${i + 1} 行目）`;
    if (op !== "=") return `${name} ${op} ${rhs}（${i + 1} 行目で更新）`;
    return `${rhs}（${i + 1} 行目で代入）`;
  }
  return null;
}

/** 文字列のかんたんなハッシュ（同じコードなら AI に聞き直さない） */
export function hashText(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36) + ":" + s.length;
}
