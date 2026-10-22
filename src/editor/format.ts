// 自動整形（あいぞめの中だけで動く簡単なもの）。black・gofmt などが入っていないときに使う。
// 文字列・コメントの中は変えない。Python は字下げの「段」を保ったまま 4 つずつにそろえる
import { lex, type CheckLang } from "./codeCheck";

/** 行ごとに、その行の始まりが文字列・コメントの中か */
function insideMap(_text: string, skipped: [number, number][]): (lineStart: number) => boolean {
  return (pos) => skipped.some(([a, b]) => pos > a && pos < b);
}

/** 行の中の「コードの部分」だけを書きかえる（文字列・コメントはそのまま） */
function mapCode(line: string, lineStart: number, skipped: [number, number][], fn: (code: string) => string): string {
  const ranges = skipped.filter(([a, b]) => b > lineStart && a < lineStart + line.length).map(([a, b]) => [Math.max(0, a - lineStart), Math.min(line.length, b - lineStart)] as [number, number]);
  if (!ranges.length) return fn(line);
  let out = "";
  let pos = 0;
  for (const [a, b] of ranges) {
    out += fn(line.slice(pos, a)) + line.slice(a, b);
    pos = b;
  }
  return out + fn(line.slice(pos));
}

function finish(lines: string[]): string {
  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
  return lines.join("\n") + "\n";
}

// ───────── Python

export function formatPython(text: string, unit = 4): string {
  const src = text.replace(/\r\n?/g, "\n");
  const { skipped, toks } = lex(src, "python");
  const inside = insideMap(src, skipped);
  const lines = src.split("\n");
  // 行の始まりのかっこの深さ（かっこの中の続きの行は、文の始まりの行と同じだけずらす）
  const depthAt: number[] = [];
  {
    let ti = 0;
    let offset = 0;
    for (let i = 0; i < lines.length; i++) {
      while (ti < toks.length && toks[ti].from < offset) ti++;
      depthAt.push(ti < toks.length ? toks[ti].d : 0);
      offset += lines[i].length + 1;
    }
  }
  const out: string[] = [];
  const stack: number[] = [0]; // 元の字下げ
  let shift = 0; // 今の文の、元の字下げ → 新しい字下げ の差
  let offset = 0;
  let blank = 0;
  let prevCode = ""; // 直前の空でない行（新しいもの）
  let prevLevel = 0;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const start = offset;
    offset += raw.length + 1;
    if (inside(start)) {
      // 三重引用符の文字列の中：そのまま
      out.push(raw);
      continue;
    }
    const expanded = raw.replace(/^[ \t]+/, (m) => m.replace(/\t/g, " ".repeat(unit)));
    const body = expanded.trimStart();
    const oldIndent = expanded.length - body.length;
    if (!body.trim()) {
      blank++;
      continue;
    }
    let line: string;
    let level = prevLevel;
    const continuation = (depthAt[i] ?? 0) > 0 || /\\\s*$/.test(lines[i - 1] ?? "");
    if (continuation) {
      line = " ".repeat(Math.max(0, oldIndent + shift)) + body;
    } else {
      if (body.startsWith("#")) {
        // コメントは、次のコードの深さに合わせるのが難しいので、今の段より深くしない
        while (stack.length > 1 && stack[stack.length - 1] > oldIndent) stack.pop();
        if (oldIndent > stack[stack.length - 1]) stack.push(oldIndent);
      } else {
        while (stack.length > 1 && stack[stack.length - 1] > oldIndent) stack.pop();
        if (oldIndent > stack[stack.length - 1]) stack.push(oldIndent);
      }
      level = stack.length - 1;
      shift = level * unit - oldIndent;
      line = " ".repeat(level * unit) + body;
    }
    // 空行の数：いちばん外側の def / class の前は 2 行、中の def の前は 1 行。ほかは最大 2 行（中は 1 行）
    const isDef = /^(async\s+def|def|class)\b/.test(body) || body.startsWith("@");
    const prevIsDecoOrHead = /^@/.test(prevCode.trim()) || /^(\s*)(async\s+def|def|class)\b.*:\s*(#.*)?$/.test(prevCode);
    let want = Math.min(blank, level === 0 ? 2 : 1);
    if (out.length && !continuation && isDef && !prevIsDecoOrHead && !/^\s*#/.test(prevCode)) want = level === 0 ? 2 : Math.max(want, 1);
    if (!out.length) want = 0;
    for (let k = 0; k < want; k++) out.push("");
    blank = 0;
    // コードの部分：行末の空白、「#コメント」→「# コメント」、「,」のあとに空白
    const fixed = fixLinePython(raw, start, skipped, line.length - body.length, src);
    out.push(fixed);
    prevCode = fixed;
    if (!continuation) prevLevel = level;
  }
  return finish(out);
}

function fixLinePython(raw: string, start: number, skipped: [number, number][], newIndent: number, src: string): string {
  const rawBody = raw.replace(/^[ \t]+/, "");
  const bodyStart = start + (raw.length - rawBody.length);
  let body = mapCode(rawBody, bodyStart, skipped, (code) => code.replace(/,(?=[^\s)\]}])/g, ", "));
  body = spaceAssign(body);
  // コメント：# のすぐ後ろに空白（#! と ## 言語 ## は除く）
  const comment = skipped.find(([a, b]) => a >= bodyStart && a < bodyStart + rawBody.length && src[a] === "#" && b > a + 1);
  if (comment && !/^#[#! ]/.test(src.slice(comment[0], comment[0] + 2))) {
    const text = src.slice(comment[0], comment[1]);
    const idx = body.lastIndexOf(text);
    if (idx >= 0) body = body.slice(0, idx) + "# " + text.slice(1) + body.slice(idx + text.length);
  }
  // コードのあとのコメントは、2 つ空けてから
  if (comment) {
    const idx = body.lastIndexOf("#");
    const code = body.slice(0, idx);
    if (idx > 0 && code.trim() && !code.endsWith("  ")) body = code.replace(/[ \t]*$/, "  ") + body.slice(idx);
  }
  return " ".repeat(newIndent) + body.replace(/[ \t]+$/, "");
}

/** 文の始まりの代入「x=1」「total+=n」を「x = 1」「total += n」に（== や <= は変えない） */
function spaceAssign(body: string): string {
  return body.replace(
    /^((?:[A-Za-z_][\w.]*(?:<[\w,\s<>]*>)?(?:\[[^\]=]*\])?)(?:\s*,\s*[A-Za-z_][\w.]*)*(?:\s+[A-Za-z_][\w.]*(?:\[\])?)?)\s*(\+|-|\*|\/|%|\/\/|\*\*|&|\||\^|<<|>>)?=(?![=>])\s*(?=\S)/,
    (_m, target: string, op: string | undefined) => `${target} ${op ?? ""}= `,
  );
}

// ───────── { } を使う言語

const CLOSERS = new Set(["}", ")", "]"]);

export function formatBraces(text: string, lang: CheckLang, unit = 4, useTabs = false): string {
  const src = text.replace(/\r\n?/g, "\n");
  const { skipped, toks } = lex(src, lang);
  const inside = insideMap(src, skipped);
  const lines = src.split("\n");
  const ind = (n: number) => (useTabs ? "\t".repeat(n) : " ".repeat(n * unit));
  const out: string[] = [];
  // 開いているかっこ（開いた行の番号）。同じ行で開いたかっこは 1 段と数える
  const open: number[] = [];
  let ti = 0;
  let offset = 0;
  let blank = 0;
  let prevTrim = "";
  let oneLineBody = false;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const start = offset;
    const end = start + raw.length;
    offset += raw.length + 1;
    // この行のトークン
    const lineToks: string[] = [];
    while (ti < toks.length && toks[ti].from < end) {
      if (toks[ti].from >= start && toks[ti].k === "op" && "{}()[]".includes(toks[ti].v)) lineToks.push(toks[ti].v);
      ti++;
    }
    if (inside(start)) {
      // 複数行のコメント・文字列の中：字下げはいじらない
      out.push(raw.replace(/[ \t]+$/, ""));
      for (const tk of lineToks) {
        if ("{([".includes(tk)) open.push(i);
        else open.pop();
      }
      continue;
    }
    const body = raw.trim();
    if (!body) {
      blank++;
      for (const tk of lineToks) {
        if ("{([".includes(tk)) open.push(i);
        else open.pop();
      }
      continue;
    }
    // 行の頭の } ) ] を数える（空白をはさんでいてもよい）
    let lead = 0;
    for (const ch of body) {
      if (ch === " " || ch === "\t") continue;
      if (CLOSERS.has(ch) && lineToks[lead] === ch) lead++;
      else break;
    }
    const before = [...open];
    for (let k = 0; k < lead; k++) before.pop();
    let level = new Set(before).size;
    // { のない if / for / else の次の 1 行
    if (oneLineBody && !body.startsWith("{")) level++;
    const preproc = (lang === "c" || lang === "cpp") && body.startsWith("#");
    // 空行：{ の直後と } の直前は消す。ほかは最大 1 行（いちばん外側は 2 行）
    let want = Math.min(blank, level === 0 ? 2 : 1);
    if (prevTrim.endsWith("{") || body.startsWith("}")) want = 0;
    if (!out.length) want = 0;
    for (let k = 0; k < want; k++) out.push("");
    blank = 0;
    const fixedBody = mapCode(raw.trim(), start + (raw.length - raw.trimStart().length), skipped, (code) =>
      code
        .replace(/\b(if|for|foreach|while|switch|catch|using|lock|fixed)\(/g, "$1 (")
        .replace(/\)\{/g, ") {")
        .replace(/,(?=[^\s)\]}>])/g, ", ")
        .replace(/[ \t]+$/, ""),
    ).replace(/[ \t]+$/, "");
    const assigned = spaceAssign(fixedBody);
    out.push(preproc ? fixedBody : ind(level) + assigned);
    // この行のかっこを反映
    for (const tk of lineToks) {
      if ("{([".includes(tk)) open.push(i);
      else open.pop();
    }
    oneLineBody = /^(}\s*)?(else\s+if|if|for|foreach|while)\b.*\)\s*$/.test(fixedBody) || /^(}\s*)?else\s*$/.test(fixedBody);
    prevTrim = fixedBody;
  }
  return finish(out);
}

/** JSON：中身を読み直してきれいに書く（読めなければ null） */
export function formatJson(text: string, unit = 2): string | null {
  try {
    return JSON.stringify(JSON.parse(text), null, unit) + "\n";
  } catch {
    return null;
  }
}

/** そのほか：行末の空白と、ファイルの終わりの空行だけ */
export function formatPlain(text: string): string {
  return finish(text.replace(/\r\n?/g, "\n").split("\n").map((l) => l.replace(/[ \t]+$/, "")));
}
