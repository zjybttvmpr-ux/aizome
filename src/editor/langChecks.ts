// 言語ごとの文法のチェック（{ } 以外で囲む言語・JSON・HTML・CSS）。
// Ruby / Lua の end、シェルの fi・done・esac、JSON の書き方、HTML のタグの閉じ忘れ、CSS の「;」忘れ
import type { CheckLang, Lexed, Problem } from "./codeCheck";

/** 文字列とコメントを空白に置きかえた文（位置はそのまま） */
function codeOnly(text: string, skipped: [number, number][]): string {
  const arr = text.split("");
  for (const [a, b] of skipped) for (let i = a; i < b && i < arr.length; i++) if (arr[i] !== "\n") arr[i] = " ";
  return arr.join("");
}

function lineStartOf(text: string, pos: number) {
  return text.lastIndexOf("\n", pos - 1) + 1;
}

function indentAtLine(text: string, pos: number) {
  const ls = lineStartOf(text, pos);
  return /^[ \t]*/.exec(text.slice(ls, ls + 200))![0];
}

/** 開いた行より後で、同じか浅い字下げになる最初の行の頭（end を足す場所） */
function endInsertPos(text: string, openPos: number, middle: RegExp): number {
  const base = indentAtLine(text, openPos).replace(/\t/g, "    ").length;
  let pos = text.indexOf("\n", openPos);
  if (pos < 0) return text.length;
  pos++;
  let lastCode = -1;
  while (pos < text.length) {
    const e = text.indexOf("\n", pos);
    const line = text.slice(pos, e < 0 ? text.length : e);
    if (line.trim()) {
      const ind = /^[ \t]*/.exec(line)![0].replace(/\t/g, "    ").length;
      if (ind <= base && !middle.test(line.trim())) return lastCode >= 0 ? lastCode : pos;
      lastCode = e < 0 ? text.length : e + 1;
    }
    if (e < 0) break;
    pos = e + 1;
  }
  return text.length;
}

interface Word {
  w: string;
  from: number;
  /** 文の頭（行の頭や ; のあと）か */
  head: boolean;
}

function words(code: string, headAfter: RegExp): Word[] {
  const out: Word[] = [];
  const re = /[A-Za-z_][\w]*|[;\n|&(){}=]/g;
  let head = true;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    const w = m[0];
    if (w === "\n" || w === ";") {
      head = true;
      continue;
    }
    if (/^[A-Za-z_]/.test(w)) {
      // メソッド呼び出し（x.end や obj:do）は除く
      const before = code[m.index - 1];
      if (before === "." || before === ":" || before === "$" || before === "@") {
        head = false;
        continue;
      }
      out.push({ w, from: m.index, head });
      head = headAfter.test(w);
    } else {
      head = w === "|" || w === "&" || w === "(" || w === "{" || w === "=";
    }
  }
  return out;
}

/** Ruby・Lua：ブロックの end の数 */
export function endBlockProblems(text: string, lang: CheckLang, lexed: Lexed): Problem[] {
  const code = codeOnly(text, lexed.skipped);
  const out: Problem[] = [];
  const stack: Word[] = [];
  const indentW = (pos: number) => indentAtLine(text, pos).replace(/\t/g, "    ").length;
  /**
   * end が来たとき：字下げが同じ始まりと組にする（内側の end を忘れたときに、正しい方を知らせるため）。
   * 同じ字下げがなければ、いちばん内側と組にする
   */
  const closeWith = (from: number, middle: RegExp, skip: (w: Word) => boolean = () => false): boolean => {
    const ind = indentW(from);
    let k = stack.length - 1;
    while (k >= 0 && skip(stack[k])) k--;
    if (k < 0) return false;
    const sameLine = lineStartOf(text, stack[k].from) === lineStartOf(text, from);
    if (!sameLine && indentW(stack[k].from) !== ind) {
      for (let j = k - 1; j >= 0; j--) {
        if (skip(stack[j])) continue;
        if (indentW(stack[j].from) === ind && lineStartOf(text, stack[j].from) !== lineStartOf(text, from)) {
          // j より内側は end を忘れている
          for (let x = stack.length - 1; x > j; x--) {
            const o = stack[x];
            if (skip(o)) continue;
            const at = endInsertPos(text, o.from, middle);
            const oi = indentAtLine(text, o.from);
            out.push({ from: o.from, to: o.from + o.w.length, kind: "syntax", severity: "error", msg: "check.missingEnd", args: { kw: o.w, end: "end" }, fixes: [{ label: "check.fix.addEnd", args: { end: "end" }, changes: [{ from: Math.min(at, lineStartOf(text, from)), to: Math.min(at, lineStartOf(text, from)), insert: `${oi}end\n` }] }] });
          }
          stack.length = j;
          return true;
        }
      }
    }
    stack.splice(k, 1);
    return true;
  };
  if (lang === "ruby") {
    const ws = words(code, /^(then|do|else|begin|ensure|rescue)$/);
    const openers = new Set(["def", "class", "module", "begin", "case"]);
    const condOpeners = new Set(["if", "unless", "while", "until", "for"]);
    let pendingDo = -1; // while / until / for の行の do は、同じブロック
    for (let i = 0; i < ws.length; i++) {
      const { w, from, head } = ws[i];
      const line = code.slice(lineStartOf(code, from), code.indexOf("\n", from) < 0 ? code.length : code.indexOf("\n", from));
      if (openers.has(w)) {
        // def x = 1 のような 1 行の def（Ruby 3）は除く
        if (w === "def" && /^\s*def\s+[\w?!.]+(\([^)]*\))?\s*=/.test(line)) continue;
        if (w === "class" && /class\s*<</.test(line)) {
          stack.push(ws[i]);
          continue;
        }
        stack.push(ws[i]);
      } else if (condOpeners.has(w)) {
        // x if y のような後ろに付く形は、ブロックを作らない
        const prev = ws[i - 1];
        const assigned = /=\s*$/.test(code.slice(lineStartOf(code, from), from));
        if (head || assigned) {
          stack.push(ws[i]);
          if (w === "while" || w === "until" || w === "for") pendingDo = code.indexOf("\n", from);
        }
        void prev;
      } else if (w === "do") {
        if (pendingDo >= 0 && from < pendingDo) {
          pendingDo = -1;
          continue;
        }
        stack.push(ws[i]);
      } else if (w === "end") {
        if (!closeWith(from, /^(else|elsif|when|rescue|ensure|end|in)\b/)) {
          out.push({ from, to: from + 3, kind: "syntax", severity: "error", msg: "check.extraEnd", args: { end: "end" }, fixes: [{ label: "check.fix.remove", args: { c: "end" }, changes: [{ from, to: from + 3, insert: "" }] }] });
        }
      }
    }
    for (const o of stack) {
      const at = endInsertPos(text, o.from, /^(else|elsif|when|rescue|ensure|end|in)\b/);
      const ind = indentAtLine(text, o.from);
      out.push({ from: o.from, to: o.from + o.w.length, kind: "syntax", severity: "error", msg: "check.missingEnd", args: { kw: o.w, end: "end" }, fixes: [{ label: "check.fix.addEnd", args: { end: "end" }, changes: [{ from: at, to: at, insert: `${ind}end\n` }] }] });
    }
  } else if (lang === "lua") {
    const ws = words(code, /^(then|do|else|repeat)$/);
    let pendingDo = -1;
    for (let i = 0; i < ws.length; i++) {
      const { w, from } = ws[i];
      if (w === "function" || w === "if") stack.push(ws[i]);
      else if (w === "for" || w === "while") {
        stack.push(ws[i]);
        pendingDo = i;
      } else if (w === "do") {
        if (pendingDo >= 0) {
          pendingDo = -1;
          continue;
        }
        stack.push(ws[i]);
      } else if (w === "repeat") stack.push(ws[i]);
      else if (w === "until") {
        const top = stack[stack.length - 1];
        if (top?.w === "repeat") stack.pop();
      } else if (w === "end") {
        // repeat の中で end は使わない
        if (!closeWith(from, /^(else|elseif|end|until)\b/, (x) => x.w === "repeat")) {
          out.push({ from, to: from + 3, kind: "syntax", severity: "error", msg: "check.extraEnd", args: { end: "end" }, fixes: [{ label: "check.fix.remove", args: { c: "end" }, changes: [{ from, to: from + 3, insert: "" }] }] });
        }
      }
    }
    for (const o of stack) {
      const close = o.w === "repeat" ? "until" : "end";
      const at = endInsertPos(text, o.from, /^(else|elseif|end|until)\b/);
      const ind = indentAtLine(text, o.from);
      out.push({ from: o.from, to: o.from + o.w.length, kind: "syntax", severity: "error", msg: "check.missingEnd", args: { kw: o.w, end: close }, fixes: close === "end" ? [{ label: "check.fix.addEnd", args: { end: "end" }, changes: [{ from: at, to: at, insert: `${ind}end\n` }] }] : [] });
    }
  }
  return out;
}

/** シェル：if … fi、case … esac、do … done */
export function shellBlockProblems(text: string, lexed: Lexed): Problem[] {
  const code = codeOnly(text, lexed.skipped);
  const out: Problem[] = [];
  const pairs: Record<string, string> = { if: "fi", case: "esac", do: "done" };
  const closers: Record<string, string> = { fi: "if", esac: "case", done: "do" };
  const stack: Word[] = [];
  for (const wd of words(code, /^(then|do|else|elif|in)$/)) {
    if (!wd.head) continue;
    if (pairs[wd.w]) stack.push(wd);
    else if (closers[wd.w]) {
      const want = closers[wd.w];
      const top = stack[stack.length - 1];
      if (top?.w === want) stack.pop();
      else if (stack.some((s) => s.w === want)) {
        // 内側の閉じ忘れ
        while (stack.length && stack[stack.length - 1].w !== want) {
          const o = stack.pop()!;
          out.push({ from: o.from, to: o.from + o.w.length, kind: "syntax", severity: "error", msg: "check.missingEnd", args: { kw: o.w, end: pairs[o.w] }, fixes: [] });
        }
        stack.pop();
      } else out.push({ from: wd.from, to: wd.from + wd.w.length, kind: "syntax", severity: "error", msg: "check.extraEnd", args: { end: wd.w }, fixes: [] });
    }
  }
  for (const o of stack) {
    const at = endInsertPos(text, o.from, /^(then|else|elif|fi|done|esac|;;|\S+\))/);
    const ind = indentAtLine(text, o.from);
    out.push({ from: o.from, to: o.from + o.w.length, kind: "syntax", severity: "error", msg: "check.missingEnd", args: { kw: o.w, end: pairs[o.w] }, fixes: [{ label: "check.fix.addEnd", args: { end: pairs[o.w] }, changes: [{ from: at, to: at, insert: `${ind}${pairs[o.w]}\n` }] }] });
  }
  // if の行の then 忘れ・for/while の do 忘れ
  const lines = code.split("\n");
  let off = 0;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const start = off;
    off += l.length + 1;
    const t = l.trim();
    const next = (lines.slice(i + 1).find((x) => x.trim()) ?? "").trim();
    if (/^(if|elif)\s/.test(t) && !/\bthen\b/.test(t) && !/^then\b/.test(next) && !/\\$/.test(t)) {
      const pos = start + l.trimEnd().length;
      out.push({ from: pos - 1, to: pos, kind: "syntax", severity: "error", msg: "check.missingWord", args: { word: "then", kw: t.split(/\s/)[0] }, fixes: [{ label: "check.fix.addWord", args: { word: "; then" }, changes: [{ from: pos, to: pos, insert: "; then" }] }] });
    }
    if (/^(for|while|until)\s/.test(t) && !/\bdo\b/.test(t) && !/^do\b/.test(next) && !/\\$/.test(t)) {
      const pos = start + l.trimEnd().length;
      out.push({ from: pos - 1, to: pos, kind: "syntax", severity: "error", msg: "check.missingWord", args: { word: "do", kw: t.split(/\s/)[0] }, fixes: [{ label: "check.fix.addWord", args: { word: "; do" }, changes: [{ from: pos, to: pos, insert: "; do" }] }] });
    }
    // [ の中の空白忘れ（[$a -eq 1]）
    const m = /(^|\s)\[(?!\[)(\S)/.exec(l);
    if (m && /^(if|elif|while|until)\b|&&|\|\|/.test(t) && m[2] !== " ") {
      const pos = start + m.index + m[1].length;
      out.push({ from: pos, to: pos + 2, kind: "syntax", severity: "error", msg: "check.bracketSpace", fixes: [{ label: "check.fix.addSpace", changes: [{ from: pos + 1, to: pos + 1, insert: " " }] }] });
    }
  }
  // do を忘れた for の done は「多すぎる」とは言わない（do 忘れの方を知らせているので）
  let missingDo = out.filter((p) => p.msg === "check.missingWord" && p.args?.word === "do").length;
  return out.filter((p) => {
    if (p.msg === "check.extraEnd" && p.args?.end === "done" && missingDo > 0) {
      missingDo--;
      return false;
    }
    return true;
  });
}

/** JSON：自分で読み進めて、最初にまちがえた場所と理由を出す（ブラウザの JSON.parse は場所を教えてくれないことがある） */
export function jsonProblems(text: string): Problem[] {
  if (!text.trim()) return [];
  let i = 0;
  const n = text.length;
  type Fail = { from: number; to: number; msg: string; args?: Record<string, string>; fixes?: Problem["fixes"] };
  const fail = (f: Fail): never => {
    throw f;
  };
  const ws = () => {
    for (;;) {
      while (i < n && /\s/.test(text[i])) i++;
      if (text[i] === "/" && (text[i + 1] === "/" || text[i + 1] === "*")) {
        const end = text[i + 1] === "/" ? text.indexOf("\n", i) : text.indexOf("*/", i) + 2;
        fail({ from: i, to: end > i ? end : n, msg: "json.comment" });
      }
      return;
    }
  };
  const str = () => {
    const start = i;
    if (text[i] === "'") {
      const end = text.indexOf("'", i + 1);
      fail({ from: i, to: end > i ? end + 1 : i + 1, msg: "json.singleQuote", fixes: end > i ? [{ label: "json.fix.quotes", changes: [{ from: i, to: i + 1, insert: '"' }, { from: end, to: end + 1, insert: '"' }] }] : [] });
    }
    i++;
    while (i < n && text[i] !== '"') {
      if (text[i] === "\\") i++;
      else if (text[i] === "\n") fail({ from: start, to: i, msg: "check.unclosedString", args: { q: '"' }, fixes: [{ label: "check.fix.addClose", args: { c: '"' }, changes: [{ from: i, to: i, insert: '"' }] }] });
      i++;
    }
    if (i >= n) fail({ from: start, to: start + 1, msg: "check.unclosedString", args: { q: '"' } });
    i++;
  };
  const value = (): void => {
    ws();
    const c = text[i];
    if (c === "{") return obj();
    if (c === "[") return arr();
    if (c === '"' || c === "'") return str();
    const m = /^(-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?|true|false|null)/.exec(text.slice(i, i + 64));
    if (m) {
      i += m[0].length;
      return;
    }
    const word = /^[A-Za-z_]\w*/.exec(text.slice(i))?.[0];
    if (word === "True" || word === "False" || word === "None" || word === "undefined" || word === "NaN") {
      const rep = word === "True" ? "true" : word === "False" ? "false" : "null";
      fail({ from: i, to: i + word.length, msg: "json.badWord", args: { word, rep }, fixes: [{ label: "check.fix.replace", args: { c: rep }, changes: [{ from: i, to: i + word.length, insert: rep }] }] });
    }
    if (i >= n) fail({ from: Math.max(0, n - 1), to: n, msg: "json.eof" });
    fail({ from: i, to: i + Math.max(1, (word ?? "").length), msg: "json.unexpected", args: { c: word ?? c } });
  };
  const sepOrEnd = (close: string, open: number) => {
    ws();
    if (text[i] === ",") {
      const comma = i;
      i++;
      ws();
      if (text[i] === close) fail({ from: comma, to: comma + 1, msg: "json.trailingComma", fixes: [{ label: "check.fix.remove", args: { c: "," }, changes: [{ from: comma, to: comma + 1, insert: "" }] }] });
      return false;
    }
    if (text[i] === close) {
      i++;
      return true;
    }
    if (i >= n) fail({ from: open, to: open + 1, msg: "check.unclosed", args: { c: close === "}" ? "{" : "[", want: close }, fixes: [{ label: "check.fix.addClose", args: { c: close }, changes: [{ from: n, to: n, insert: close }] }] });
    // 「,」忘れ：前の値のすぐ後ろに足す
    let at = i;
    while (at > 0 && /\s/.test(text[at - 1])) at--;
    fail({ from: Math.max(0, at - 1), to: at, msg: "json.missingComma", fixes: [{ label: "py.fix.comma", changes: [{ from: at, to: at, insert: "," }] }] });
    return true;
  };
  const obj = () => {
    const open = i;
    i++;
    ws();
    if (text[i] === "}") {
      i++;
      return;
    }
    for (;;) {
      ws();
      if (text[i] === '"' || text[i] === "'") str();
      else {
        const key = /^[A-Za-z_$][\w$]*/.exec(text.slice(i))?.[0];
        if (key) fail({ from: i, to: i + key.length, msg: "json.unquotedKey", fixes: [{ label: "json.fix.quoteKey", changes: [{ from: i, to: i + key.length, insert: `"${key}"` }] }] });
        if (i >= n) fail({ from: open, to: open + 1, msg: "check.unclosed", args: { c: "{", want: "}" } });
        fail({ from: i, to: i + 1, msg: "json.unexpected", args: { c: text[i] } });
      }
      ws();
      if (text[i] !== ":") {
        let at = i;
        while (at > 0 && /\s/.test(text[at - 1])) at--;
        fail({ from: Math.max(0, at - 1), to: at, msg: "json.missingColon", fixes: [{ label: "check.fix.addColon", changes: [{ from: at, to: at, insert: ":" }] }] });
      }
      i++;
      value();
      if (sepOrEnd("}", open)) return;
    }
  };
  const arr = () => {
    const open = i;
    i++;
    ws();
    if (text[i] === "]") {
      i++;
      return;
    }
    for (;;) {
      value();
      if (sepOrEnd("]", open)) return;
    }
  };
  try {
    value();
    ws();
    if (i < n) fail({ from: i, to: i + 1, msg: "json.afterEnd" });
    return [];
  } catch (e) {
    const f = e as Fail;
    if (typeof f !== "object" || f === null || !("msg" in f)) return [];
    return [{ from: f.from, to: Math.max(f.to, f.from + 1), kind: "syntax", severity: "error", msg: f.msg, args: f.args, fixes: f.fixes ?? [] }];
  }
}

const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr", "!doctype"]);
/** 閉じタグを省略してよいタグ（HTML の決まり） */
const OPTIONAL_CLOSE = new Set(["li", "p", "td", "th", "tr", "option", "dt", "dd", "thead", "tbody", "tfoot", "colgroup", "rt", "rp", "optgroup", "html", "head", "body"]);

/** HTML / XML：タグの閉じ忘れ・閉じタグのまちがい・引用符の閉じ忘れ */
export function htmlProblems(text: string, xml: boolean): Problem[] {
  const out: Problem[] = [];
  const stack: { name: string; from: number; to: number }[] = [];
  // 属性の引用符が閉じていないタグ（<a href="x>）は、先に見つけて、そのタグの閉じタグは数えない
  const brokenClose = new Map<string, number>();
  {
    const open = /<([A-Za-z][\w:-]*)\b([^<>]*)>/g;
    let b: RegExpExecArray | null;
    while ((b = open.exec(text))) {
      const attrs = b[2];
      if ((attrs.match(/"/g) ?? []).length % 2 === 1 || (attrs.match(/'/g) ?? []).length % 2 === 1) {
        const at = b.index + b[0].indexOf(attrs);
        out.push({ from: b.index, to: at + attrs.length + 1, kind: "syntax", severity: "error", msg: "html.attrQuote", fixes: [] });
        const name = b[1].toLowerCase();
        brokenClose.set(name, (brokenClose.get(name) ?? 0) + 1);
      }
    }
  }
  const re = /<!--[\s\S]*?(-->|$)|<(\/?)([A-Za-z][\w:-]*|!doctype)\b((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>|<(script|style)\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m[0].startsWith("<!--")) {
      if (!m[1]) out.push({ from: m.index, to: m.index + 4, kind: "syntax", severity: "error", msg: "html.unclosedComment", fixes: [] });
      continue;
    }
    const closing = m[2] === "/";
    const name = (m[3] ?? "").toLowerCase();
    const selfClose = m[5] === "/";
    const nameFrom = m.index + 1 + (closing ? 1 : 0);
    if (!closing && (name === "script" || name === "style") && !selfClose) {
      // 中身は飛ばす
      const end = text.toLowerCase().indexOf(`</${name}`, re.lastIndex);
      if (end < 0) {
        out.push({ from: nameFrom, to: nameFrom + name.length, kind: "syntax", severity: "error", msg: "html.unclosed", args: { tag: name }, fixes: [{ label: "html.fix.close", args: { tag: name }, changes: [{ from: text.length, to: text.length, insert: `</${name}>` }] }] });
        break;
      }
      re.lastIndex = end;
      stack.push({ name, from: nameFrom, to: nameFrom + name.length });
      continue;
    }
    if (!closing) {
      if (selfClose || (!xml && VOID_TAGS.has(name))) continue;
      stack.push({ name, from: nameFrom, to: nameFrom + name.length });
      continue;
    }
    // 閉じタグ
    if (!xml && VOID_TAGS.has(name)) continue;
    let k = stack.length - 1;
    while (k >= 0 && stack[k].name !== name) k--;
    if (k < 0 && (brokenClose.get(name) ?? 0) > 0) {
      brokenClose.set(name, brokenClose.get(name)! - 1);
      continue;
    }
    if (k < 0) {
      out.push({ from: m.index, to: m.index + m[0].length, kind: "syntax", severity: "error", msg: "html.extraClose", args: { tag: name }, fixes: [{ label: "check.fix.remove", args: { c: `</${name}>` }, changes: [{ from: m.index, to: m.index + m[0].length, insert: "" }] }] });
      continue;
    }
    // 間に閉じていないタグがある
    for (let j = stack.length - 1; j > k; j--) {
      const o = stack[j];
      if (!xml && OPTIONAL_CLOSE.has(o.name)) continue;
      out.push({ from: o.from, to: o.to, kind: "syntax", severity: "error", msg: "html.unclosed", args: { tag: o.name }, fixes: [{ label: "html.fix.close", args: { tag: o.name }, changes: [{ from: m.index, to: m.index, insert: `</${o.name}>` }] }] });
    }
    stack.length = k;
  }
  for (const o of stack) {
    if (!xml && OPTIONAL_CLOSE.has(o.name)) continue;
    out.push({ from: o.from, to: o.to, kind: "syntax", severity: "error", msg: "html.unclosed", args: { tag: o.name }, fixes: [{ label: "html.fix.close", args: { tag: o.name }, changes: [{ from: text.length, to: text.length, insert: `${text.endsWith("\n") ? "" : "\n"}</${o.name}>\n` }] }] });
  }
  return out;
}

/** CSS：{ } の中で「;」を忘れて、次の行にまた「名前:」が続いている */
export function cssProblems(text: string, lexed: Lexed): Problem[] {
  const code = codeOnly(text, lexed.skipped);
  const out: Problem[] = [];
  let depth = 0;
  const lines = code.split("\n");
  let off = 0;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const start = off;
    off += l.length + 1;
    const before = depth;
    for (const ch of l) {
      if (ch === "{") depth++;
      else if (ch === "}") depth = Math.max(0, depth - 1);
    }
    if (before === 0 || /[{}]/.test(l)) continue;
    const t = l.trim();
    if (!t || t.endsWith(";") || t.endsWith(",") || t.endsWith("{") || !/^[\w-]+\s*:/.test(t)) continue;
    const next = lines.slice(i + 1).find((x) => x.trim()) ?? "";
    if (/^\s*[\w-]+\s*:[^:]/.test(next) && !/[{]\s*$/.test(next)) {
      const pos = start + l.trimEnd().length;
      out.push({ from: pos - 1, to: pos, kind: "syntax", severity: "error", msg: "check.missingSemicolon", fixes: [{ label: "check.fix.addSemicolon", changes: [{ from: pos, to: pos, insert: ";" }] }] });
    }
  }
  return out;
}
