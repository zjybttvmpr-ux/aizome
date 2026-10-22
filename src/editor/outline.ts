// 関数の一覧（アウトライン）：ファイルの中のクラス・関数・メソッドなどを取り出す。
// 文字列やコメントの中は見ない（codeCheck の字句分けを使う）。CodeMirror を使わないのでテストしやすい
import { lex, type CheckLang, type Tok } from "./codeCheck";

export type SymbolKind = "class" | "struct" | "interface" | "enum" | "namespace" | "function" | "method" | "property" | "constructor";

export interface OutlineItem {
  name: string;
  kind: SymbolKind;
  /** 1 から始まる行番号 */
  line: number;
  /** 入れ子の深さ（0 = いちばん外側） */
  level: number;
  /** 引数など（短く） */
  detail: string;
  /** 終わりの行（わかるとき） */
  endLine?: number;
}

/** 拡張子 → 字句の分け方 */
export function outlineLangOf(ext: string): CheckLang | null {
  const e = ext.toLowerCase();
  if (e === ".py" || e === ".pyw") return "python";
  if (e === ".cs") return "csharp";
  if ([".c", ".h"].includes(e)) return "c";
  if ([".cpp", ".cc", ".cxx", ".hpp", ".hh"].includes(e)) return "cpp";
  if (e === ".go") return "go";
  if (e === ".rs") return "rust";
  // Java と同じように字句を分けられる言語
  if ([".java", ".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx", ".mts", ".kt", ".kts", ".swift", ".dart", ".php", ".scala", ".groovy"].includes(e)) return "java";
  return null;
}

function lineOf(text: string): (pos: number) => number {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1);
  return (pos: number) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= pos) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
}

function shortParams(text: string, max = 40): string {
  const s = text.replace(/\s+/g, " ").trim();
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

// ───────── Python

function pythonOutline(text: string): OutlineItem[] {
  const { skipped } = lex(text, "python");
  const inString = (pos: number) => skipped.some(([a, b]) => pos > a && pos < b);
  const lines = text.split("\n");
  const out: OutlineItem[] = [];
  // 字下げの深さと、そこにある入れ物（class / def）
  const stack: { indent: number; kind: SymbolKind }[] = [];
  let offset = 0;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const start = offset;
    offset += l.length + 1;
    const m = /^([ \t]*)(?:async\s+)?(def|class)\s+([A-Za-z_À-￿][\wÀ-￿]*)\s*(\([^)]*\)?)?/.exec(l);
    if (!m || inString(start + m[1].length)) continue;
    const indent = m[1].replace(/\t/g, "    ").length;
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    const parent = stack[stack.length - 1];
    const kind: SymbolKind = m[2] === "class" ? "class" : parent?.kind === "class" ? (m[3] === "__init__" ? "constructor" : "method") : "function";
    let detail = m[4] ?? "";
    if (m[2] === "def") detail = detail.replace(/^\((self|cls)\s*,?\s*/, "(");
    out.push({ name: m[3], kind, line: i + 1, level: stack.length, detail: shortParams(detail) });
    stack.push({ indent, kind });
  }
  // 終わりの行：次の同じか浅い字下げの項目の手前まで
  for (let k = 0; k < out.length; k++) {
    const next = out.slice(k + 1).find((x) => x.level <= out[k].level);
    out[k].endLine = next ? next.line - 1 : lines.length;
  }
  return out;
}

// ───────── { } を使う言語

const NOT_FUNC = new Set([
  "if", "for", "while", "switch", "catch", "using", "lock", "foreach", "return", "new", "else", "do", "try", "fixed",
  "sizeof", "typeof", "nameof", "default", "checked", "unchecked", "await", "throw", "case", "in", "of", "yield",
  "synchronized", "when", "match", "loop", "assert", "delete", "elif", "guard", "defer", "go", "select", "with", "function",
]);
const MODIFIERS = new Set([
  "public", "private", "protected", "internal", "static", "virtual", "override", "abstract", "sealed", "async", "extern",
  "unsafe", "partial", "readonly", "final", "inline", "constexpr", "export", "pub", "open", "suspend", "operator", "explicit", "implicit", "new",
]);
const CONTAINERS: Record<string, SymbolKind> = {
  class: "class",
  struct: "struct",
  interface: "interface",
  enum: "enum",
  record: "class",
  namespace: "namespace",
  trait: "interface",
  impl: "class",
  mod: "namespace",
  object: "class",
  union: "struct",
  extension: "class",
  protocol: "interface",
};

function braceOutline(text: string, lang: CheckLang): OutlineItem[] {
  const { toks } = lex(text, lang);
  const line = lineOf(text);
  const out: OutlineItem[] = [];
  const containers: { depth: number; item: OutlineItem }[] = [];
  let depth = 0;
  let pending: OutlineItem | null = null;
  // 関数の中（{ の深さ）。関数の中のさらに内側の関数は出さない
  let funcDepth = -1;
  const matching = (i: number): number => {
    const want = toks[i].d;
    for (let j = i + 1; j < toks.length; j++) if (toks[j].v === ")" && toks[j].d === want) return j;
    return -1;
  };
  const prevSig = (i: number): Tok | undefined => toks[i - 1];

  for (let i = 0; i < toks.length; i++) {
    const tk = toks[i];
    if (tk.v === "{") {
      depth++;
      if (pending) {
        containers.push({ depth, item: pending });
        pending = null;
      }
      continue;
    }
    if (tk.v === "}") {
      while (containers.length && containers[containers.length - 1].depth >= depth) {
        const c = containers.pop()!;
        c.item.endLine = line(tk.from);
      }
      if (funcDepth >= depth) {
        const f = out[out.length - 1];
        if (f && !f.endLine) f.endLine = line(tk.from);
        funcDepth = -1;
      }
      depth--;
      continue;
    }
    if (tk.v === ";" && pending) {
      // class X; や namespace X;（ファイル全体が名前空間）
      if (pending.kind === "namespace") containers.push({ depth, item: pending });
      pending = null;
      continue;
    }
    if (tk.k !== "id" || funcDepth >= 0) continue;
    // 括弧の中（引数など）は見ない。{ } の深さだけのところ
    if (tk.d !== depth) continue;
    const level = containers.length;
    const inClass = containers.some((c) => ["class", "struct", "interface", "enum"].includes(c.item.kind));

    // Go の type Dog struct {
    if (tk.v === "type" && lang === "go" && toks[i + 1]?.k === "id" && (toks[i + 2]?.v === "struct" || toks[i + 2]?.v === "interface")) {
      const item: OutlineItem = { name: toks[i + 1].v, kind: toks[i + 2].v === "struct" ? "struct" : "interface", line: line(tk.from), level, detail: "" };
      out.push(item);
      pending = item;
      i += 2;
      continue;
    }
    // class / struct / namespace …
    const ck = CONTAINERS[tk.v];
    if (ck && toks[i + 1]?.k === "id" && prevSig(i)?.v !== ".") {
      let name = toks[i + 1].v;
      // impl Trait for Type / namespace A.B.C
      let j = i + 2;
      while (toks[j] && (toks[j].v === "." || toks[j].v === "::") && toks[j + 1]?.k === "id") {
        name += toks[j].v + toks[j + 1].v;
        j += 2;
      }
      if (tk.v === "impl" && toks[j]?.v === "for" && toks[j + 1]?.k === "id") name = `${name} for ${toks[j + 1].v}`;
      if (tk.v === "enum" && name === "class" && toks[i + 2]?.k === "id") name = toks[i + 2].v; // C++ の enum class
      const item: OutlineItem = { name, kind: ck, line: line(tk.from), level, detail: "" };
      out.push(item);
      pending = item;
      i = j - 1;
      continue;
    }

    // Go の func (r *T) Name( ／ Rust の fn ／ Kotlin の fun ／ JS の function
    if (tk.v === "func" || tk.v === "fn" || tk.v === "fun" || (tk.v === "function" && toks[i + 1]?.k === "id")) {
      let j = i + 1;
      let receiver = "";
      if (tk.v === "func" && toks[j]?.v === "(") {
        const close = matching(j);
        receiver = text.slice(toks[j].to, close >= 0 ? toks[close].from : toks[j].to).trim().split(/\s+/).pop()?.replace(/^\*/, "") ?? "";
        j = close + 1;
      }
      const nameTok = toks[j];
      if (nameTok?.k !== "id") continue;
      let open = j + 1;
      if (toks[open]?.v === "<") while (open < toks.length && toks[open].v !== "(") open++;
      if (toks[open]?.v !== "(") continue;
      const close = matching(open);
      const params = close > 0 ? text.slice(toks[open].from, toks[close].to) : "()";
      out.push({ name: receiver ? `${receiver}.${nameTok.v}` : nameTok.v, kind: receiver || inClass ? "method" : "function", line: line(nameTok.from), level, detail: shortParams(params) });
      // 本体の { まで進めて、中の関数は出さない
      let k = close + 1;
      while (k < toks.length && toks[k].v !== "{" && toks[k].v !== ";") k++;
      if (toks[k]?.v === "{") {
        depth++;
        funcDepth = depth;
        i = k;
      } else i = k;
      continue;
    }

    // const name = (…) => {  ／  const name = function
    if ((tk.v === "const" || tk.v === "let" || tk.v === "var") && toks[i + 1]?.k === "id" && toks[i + 2]?.v === "=") {
      const a = toks[i + 3];
      const isFn = a && (a.v === "function" || a.v === "async" || (a.v === "(" && (() => {
        const c = matching(i + 3);
        return c > 0 && toks[c + 1]?.v === "=>";
      })()) || (a.k === "id" && toks[i + 4]?.v === "=>"));
      if (isFn) {
        out.push({ name: toks[i + 1].v, kind: inClass ? "method" : "function", line: line(toks[i + 1].from), level, detail: "" });
      }
      continue;
    }

    if (NOT_FUNC.has(tk.v) || MODIFIERS.has(tk.v)) continue;
    const prev = prevSig(i);
    // C# のプロパティ  public int Hp { get; set; }
    if (inClass && toks[i + 1]?.v === "{" && (toks[i + 2]?.v === "get" || toks[i + 2]?.v === "set" || toks[i + 2]?.v === "init") && prev && (prev.k === "id" || prev.v === ">" || prev.v === "]" || prev.v === "?")) {
      out.push({ name: tk.v, kind: "property", line: line(tk.from), level, detail: "" });
      continue;
    }
    // 名前(…) のあとに { か => が来れば関数・メソッド
    let open = i + 1;
    if (toks[open]?.v === "<") {
      let k = open;
      let angle = 0;
      for (; k < toks.length; k++) {
        if (toks[k].v === "<") angle++;
        else if (toks[k].v === ">") angle--;
        else if (toks[k].v === ">>") angle -= 2;
        if (angle <= 0) break;
      }
      open = k + 1;
    }
    if (toks[open]?.v !== "(") continue;
    if (prev && prev.v === ".") continue;
    // 前が型名・修飾子（void Update / public Player / int main / ~Foo / name: のような JS のメソッド）
    // C++ の public: のあと
    const afterLabel = prev?.v === ":" && ["public", "private", "protected"].includes(toks[i - 2]?.v ?? "");
    const prevOk = !prev || afterLabel || prev.k === "id" || [">", "]", "*", "&", "?", "~", "}", ";", "{", "::"].includes(prev.v);
    if (!prevOk) continue;
    if (prev?.k === "id" && (NOT_FUNC.has(prev.v) || prev.v === "return")) continue;
    const close = matching(open);
    if (close < 0) continue;
    let k = close + 1;
    let guard = 0;
    while (k < toks.length && guard++ < 40 && !["{", ";", "=>", "}"].includes(toks[k].v)) {
      // C++ の初期化リスト・C# の : base(…)・where 制約・throws・const などは飛ばす
      k++;
    }
    const end = toks[k]?.v;
    if (end !== "{" && end !== "=>") continue;
    // 関数の呼び出しのあとの { （if (x) { など）を避ける：前の行の終わりや文の始まりにある名前だけ
    const before = prev?.v;
    const atStatementStart = !prev || afterLabel || ["}", ";", "{"].includes(before ?? "") || prev.k === "id" || before === ">" || before === "]" || before === "*" || before === "&" || before === "?" || before === "~" || before === "::";
    if (!atStatementStart) continue;
    // JS で行の頭の name(…) { はクラスの中だけメソッドとみなす（それ以外は呼び出しの可能性）
    if (lang === "java" && (!prev || ["}", ";", "{"].includes(before ?? "")) && !inClass) continue;
    if (afterLabel && !inClass) continue;
    const className = [...containers].reverse().find((c) => ["class", "struct"].includes(c.item.kind))?.item.name.split(/[.:]/).pop();
    const kind: SymbolKind = tk.v === className || (before === "~" && inClass) ? "constructor" : inClass ? "method" : "function";
    out.push({ name: before === "~" ? "~" + tk.v : tk.v, kind, line: line(tk.from), level, detail: shortParams(text.slice(toks[open].from, toks[close].to)) });
    if (end === "{") {
      depth++;
      funcDepth = depth;
      i = k;
    } else {
      i = k;
    }
  }
  return out;
}

export function buildOutline(text: string, lang: CheckLang): OutlineItem[] {
  if (text.length > 1_000_000) return [];
  return lang === "python" ? pythonOutline(text) : braceOutline(text, lang);
}

/** カーソルの行を含む（なければ直前の）項目 */
export function currentSymbol(items: OutlineItem[], line: number): OutlineItem | null {
  let best: OutlineItem | null = null;
  for (const it of items) {
    if (it.line > line) break;
    if (!it.endLine || it.endLine >= line) best = it;
  }
  return best;
}
