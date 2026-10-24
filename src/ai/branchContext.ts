// elif / else などが「どの if の、どの条件が違ったときか」を、上の行をさかのぼって説明する
// 字下げ（インデント）を手がかりにする。{ } の言語でも、ふつうは字下げがそろっているので同じ方法で見る
import { condIf, condPhrase, explainLine, isTrivial, type ExplainLang } from "./explainRules";

type Kind = "if" | "elif" | "else" | "loop" | "try" | "except" | "other";

interface Branch {
  kind: Kind;
  cond?: string;
}

function parse(line: string, lang: ExplainLang): Branch {
  const s = line.trim().replace(/\s+(#|\/\/)\s.*$/, "");
  let m: RegExpExecArray | null;
  if (lang === "python") {
    if ((m = /^if\s+(.+?)\s*:(\s*$|\s+\S)/.exec(s))) return { kind: "if", cond: m[1] };
    if ((m = /^elif\s+(.+?)\s*:(\s*$|\s+\S)/.exec(s))) return { kind: "elif", cond: m[1] };
    if (/^else\s*:/.test(s)) return { kind: "else" };
    if (/^(async\s+)?(for|while)\b/.test(s)) return { kind: "loop" };
    if (/^try\s*:/.test(s)) return { kind: "try" };
    if (/^(except|finally)\b/.test(s)) return { kind: "except" };
    return { kind: "other" };
  }
  if (lang === "ruby") {
    if ((m = /^(?:if|unless)\s+(.+?)(\s+then)?$/.exec(s))) return { kind: "if", cond: /^unless/.test(s) ? `not ${m[1]}` : m[1] };
    if ((m = /^elsif\s+(.+?)(\s+then)?$/.exec(s))) return { kind: "elif", cond: m[1] };
    if (/^else$/.test(s)) return { kind: "else" };
    return { kind: /^(while|until|for)\b/.test(s) ? "loop" : "other" };
  }
  if (lang === "shell") {
    if ((m = /^if\s+(.+?)(\s*;\s*then)?$/.exec(s))) return { kind: "if", cond: m[1] };
    if ((m = /^elif\s+(.+?)(\s*;\s*then)?$/.exec(s))) return { kind: "elif", cond: m[1] };
    if (/^else$/.test(s)) return { kind: "else" };
    return { kind: "other" };
  }
  // C・C#・Java・JavaScript・Go・Rust・Lua など
  if ((m = /^(?:\}\s*)?else\s*if\s*\((.+)\)\s*\{?\s*$/.exec(s)) || (m = /^(?:\}\s*)?else\s+if\s+(.+?)\s*\{\s*$/.exec(s)) || (m = /^elseif\s+(.+?)\s+then$/.exec(s))) return { kind: "elif", cond: m[1] };
  if ((m = /^(?:\}\s*)?if\s*\((.+)\)\s*\{?\s*$/.exec(s)) || (m = /^if\s+(.+?)\s*\{\s*$/.exec(s)) || (m = /^if\s+(.+?)\s+then$/.exec(s))) return { kind: "if", cond: m[1] };
  if (/^(?:\}\s*)?else\s*\{?\s*$/.test(s)) return { kind: "else" };
  if (/^(?:\}\s*)?(for|foreach|while|do|loop)\b/.test(s)) return { kind: "loop" };
  if (/^(?:\}\s*)?try\b/.test(s)) return { kind: "try" };
  if (/^(?:\}\s*)?(catch|finally|except)\b/.test(s)) return { kind: "except" };
  return { kind: "other" };
}

const indentOf = (line: string) => {
  let n = 0;
  for (const c of line) {
    if (c === " ") n++;
    else if (c === "\t") n += 4;
    else break;
  }
  return n;
};

const blank = (line: string) => isTrivial(line) && !/^\s*\}/.test(line);
const onlyBrace = (line: string) => /^\s*[}\])]+;?\s*$/.test(line) || /^\s*end\s*$/.test(line) || /^\s*(fi|done)\s*$/.test(line);

const MAX_UP = 400;

interface Chain {
  /** 同じ if のつながりの条件（上から順） */
  conds: string[];
  /** if 以外の頭（for の else・try の else） */
  head: "if" | "loop" | "try" | null;
  /** if の行の番号（0 始まり） */
  headLine: number;
}

/** n 行目（0 始まり）の elif / else から上にさかのぼって、属している if のつながりを集める */
function chainFor(lines: (i: number) => string, n: number, lang: ExplainLang): Chain | null {
  const ind = indentOf(lines(n));
  const conds: string[] = [];
  for (let j = n - 1, k = 0; j >= 0 && k < MAX_UP; j--, k++) {
    const text = lines(j);
    if (blank(text)) continue;
    const ji = indentOf(text);
    if (ji > ind) continue;
    if (ji < ind) return null;
    if (onlyBrace(text)) continue;
    const b = parse(text, lang);
    if (b.kind === "elif") conds.unshift(b.cond!);
    else if (b.kind === "if") {
      conds.unshift(b.cond!);
      return { conds, head: "if", headLine: j };
    } else if (b.kind === "loop") return { conds, head: conds.length ? null : "loop", headLine: j };
    else if (b.kind === "except") continue; // try … except … else
    else if (b.kind === "try") return { conds, head: "try", headLine: j };
    else return null;
  }
  return null;
}

const q = (c: string, lang: ExplainLang) => `「${condPhrase(c, lang)}」`;

function negation(conds: string[], lang: ExplainLang, end: "なく" | "ない"): string {
  if (conds.length === 1) return `${q(conds[0], lang)}では${end}`;
  return conds.map((c) => q(c, lang)).join("でも") + `でも${end}`;
}

/** 外側の if / elif / else の条件（短く）。一番近いものから */
function outerConds(lines: (i: number) => string, n: number, lang: ExplainLang, depth = 0): string[] {
  if (depth > 2) return [];
  const ind = indentOf(lines(n));
  if (ind === 0) return [];
  for (let j = n - 1, k = 0; j >= 0 && k < MAX_UP; j--, k++) {
    const text = lines(j);
    if (blank(text) || onlyBrace(text)) continue;
    if (indentOf(text) >= ind) continue;
    const b = parse(text, lang);
    let here: string | null = null;
    if (b.kind === "if") here = `${q(b.cond!, lang)}のとき`;
    else if (b.kind === "elif" || b.kind === "else") {
      const ch = chainFor(lines, j, lang);
      if (ch && ch.head === "if") here = b.kind === "elif" ? `${negation(ch.conds, lang, "なく")}${q(b.cond!, lang)}のとき` : `${negation(ch.conds, lang, "ない")}とき`;
    } else if (b.kind === "loop") here = "繰り返しの中";
    else if (/^\s*(def|class|function|func|fn|public|private|protected|static|void|int|async)\b/.test(text)) return [];
    if (!here) return [];
    return [here, ...outerConds(lines, j, lang, depth + 1)];
  }
  return [];
}

function withOuter(text: string, lines: (i: number) => string, n: number, lang: ExplainLang): string {
  const outs = outerConds(lines, n, lang);
  // 繰り返しだけなら付けない
  if (!outs.some((o) => o !== "繰り返しの中")) return text;
  return `${text}（外側：${outs.reverse().join(" ＞ ")}）`;
}

/**
 * n 行目（0 始まり）が if / elif / else なら、属している条件までふくめた説明を返す。
 * それ以外（またはわからない）なら null（ふつうの説明を使う）
 */
export function explainBranch(lines: (i: number) => string, n: number, lang: ExplainLang): string | null {
  const text = lines(n);
  const b = parse(text, lang);
  if (b.kind === "if") {
    const base = explainLine(text, lang);
    if (!base) return null;
    const w = withOuter(base, lines, n, lang);
    return w === base ? null : w;
  }
  if (b.kind !== "elif" && b.kind !== "else") return null;
  const ch = chainFor(lines, n, lang);
  if (!ch) return null;
  let main: string;
  if (ch.head === "loop" && b.kind === "else") main = "上の繰り返しが break で抜けずに最後まで終わったとき";
  else if (ch.head === "try" && b.kind === "else") main = "上の try の中でエラーが起きなかったとき";
  else if (ch.head !== "if" || !ch.conds.length) return null;
  else if (b.kind === "elif") main = `上の${negation(ch.conds, lang, "なく")}、もし ${condIf(b.cond!, lang)}なら`;
  else main = ch.conds.length === 1 ? `上の${negation(ch.conds, lang, "ない")}とき` : `上の${negation(ch.conds, lang, "ない")}とき（どれにも当てはまらないとき）`;
  return withOuter(main, lines, ch.headLine, lang);
}
