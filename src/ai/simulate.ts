// 自動判定：かんたんな Python を、実行せずに上から順に計算して、変数の値を予想する
// （数・文字・リスト・+= など・for i in range(…)・条件がわかる if）
// input() や乱数、ファイル、自分で作った関数の呼び出しなど、わからないものは「わからない」のまま

type V = number | string | boolean | null | V[] | { tuple: V[] };
const UNKNOWN: unique symbol = Symbol("unknown");
type Val = V | typeof UNKNOWN;

class Unknown extends Error {}
class Break extends Error {}
class Continue extends Error {}
class Budget extends Error {}

const isList = (v: Val | undefined): v is V[] => Array.isArray(v);
const isTuple = (v: Val): v is { tuple: V[] } => typeof v === "object" && v !== null && !Array.isArray(v) && "tuple" in v;

/** Python と同じ見せ方（'abc'、[1, 2]、True、None） */
export function pyRepr(v: V): string {
  if (v === null) return "None";
  if (v === true) return "True";
  if (v === false) return "False";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(12)));
  if (typeof v === "string") return `'${v.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n")}'`;
  if (isTuple(v)) return `(${v.tuple.map(pyRepr).join(", ")}${v.tuple.length === 1 ? "," : ""})`;
  return `[${v.map(pyRepr).join(", ")}]`;
}

// ───────── 式

type Tok = { k: "num" | "str" | "name" | "op"; v: string };

function tokenize(s: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === "#") break;
    let m: RegExpExecArray | null;
    if ((m = /^\d+(\.\d*)?(e[-+]?\d+)?|^\.\d+/i.exec(s.slice(i)))) {
      out.push({ k: "num", v: m[0] });
      i += m[0].length;
      continue;
    }
    if ((m = /^([rbuRBU]?)(['"])((?:\\.|(?!\2).)*)\2/.exec(s.slice(i)))) {
      if (/f/i.test(m[1])) throw new Unknown();
      const raw = /r/i.test(m[1]);
      const body = raw ? m[3] : m[3].replace(/\\(n|t|\\|'|")/g, (_, x) => ({ n: "\n", t: "\t", "\\": "\\", "'": "'", '"': '"' })[x as "n"]);
      out.push({ k: "str", v: body });
      i += m[0].length;
      continue;
    }
    if (/[fF]['"]/.test(s.slice(i, i + 2))) throw new Unknown();
    if ((m = /^[A-Za-z_][\w]*/.exec(s.slice(i)))) {
      out.push({ k: "name", v: m[0] });
      i += m[0].length;
      continue;
    }
    if ((m = /^(\*\*|\/\/|==|!=|<=|>=|[-+*/%<>()[\],.:])/.exec(s.slice(i)))) {
      out.push({ k: "op", v: m[0] });
      i += m[0].length;
      continue;
    }
    throw new Unknown();
  }
  return out;
}

type Env = Map<string, Val>;

const MATH: Record<string, (...a: number[]) => number> = {
  sqrt: Math.sqrt, floor: Math.floor, ceil: Math.ceil, fabs: Math.abs, sin: Math.sin, cos: Math.cos, tan: Math.tan,
  exp: Math.exp, log10: Math.log10, log2: Math.log2, pow: Math.pow, trunc: Math.trunc, hypot: Math.hypot,
  log: (x, b) => (b === undefined ? Math.log(x) : Math.log(x) / Math.log(b)),
  factorial: (n) => {
    let r = 1;
    for (let i = 2; i <= n; i++) r *= i;
    return r;
  },
  gcd: (a, b) => {
    a = Math.abs(a);
    b = Math.abs(b);
    while (b) [a, b] = [b, a % b];
    return a;
  },
  degrees: (x) => (x * 180) / Math.PI,
  radians: (x) => (x * Math.PI) / 180,
};
const MATH_CONST: Record<string, number> = { pi: Math.PI, e: Math.E, tau: Math.PI * 2, inf: Infinity };

function truthy(v: V): boolean {
  if (v === null || v === false || v === 0 || v === "") return false;
  if (isList(v)) return v.length > 0;
  if (isTuple(v)) return v.tuple.length > 0;
  return true;
}

function eq(a: V, b: V): boolean {
  return pyRepr(a) === pyRepr(b);
}

class Parser {
  i = 0;
  constructor(
    readonly t: Tok[],
    readonly env: Env,
  ) {}
  peek(v?: string) {
    const x = this.t[this.i];
    return v === undefined ? x : x && x.v === v && (x.k === "op" || x.k === "name") ? x : undefined;
  }
  eat(v: string) {
    if (!this.peek(v)) throw new Unknown();
    this.i++;
  }
  done() {
    return this.i >= this.t.length;
  }

  // 式全体（カンマがあればタプル）
  exprList(): V {
    const first = this.expr();
    if (!this.peek(",")) return first;
    const items = [first];
    while (this.peek(",")) {
      this.i++;
      if (this.done() || this.peek(")") || this.peek("]")) break;
      items.push(this.expr());
    }
    return { tuple: items };
  }

  expr(): V {
    // a if c else b
    const a = this.or();
    if (this.peek("if")) {
      this.i++;
      const c = this.or();
      this.eat("else");
      const b = this.expr();
      return truthy(c) ? a : b;
    }
    return a;
  }
  or(): V {
    let a = this.and();
    while (this.peek("or")) {
      this.i++;
      const b = this.and();
      a = truthy(a) ? a : b;
    }
    return a;
  }
  and(): V {
    let a = this.not();
    while (this.peek("and")) {
      this.i++;
      const b = this.not();
      a = truthy(a) ? b : a;
    }
    return a;
  }
  not(): V {
    if (this.peek("not")) {
      this.i++;
      return !truthy(this.not());
    }
    return this.cmp();
  }
  cmp(): V {
    let a = this.add();
    let result: boolean | null = null;
    for (;;) {
      const t = this.peek();
      if (!t) break;
      let op = t.v;
      if (t.k === "name" && op === "not" && this.t[this.i + 1]?.v === "in") {
        this.i += 2;
        op = "not in";
      } else if (t.k === "name" && op === "in") this.i++;
      else if (t.k === "op" && ["==", "!=", "<", ">", "<=", ">="].includes(op)) this.i++;
      else break;
      const b = this.add();
      let r: boolean;
      if (op === "==") r = eq(a, b);
      else if (op === "!=") r = !eq(a, b);
      else if (op === "in" || op === "not in") {
        let has: boolean;
        if (typeof b === "string" && typeof a === "string") has = b.includes(a);
        else if (isList(b)) has = b.some((x) => eq(x, a));
        else if (isTuple(b)) has = b.tuple.some((x) => eq(x, a));
        else throw new Unknown();
        r = op === "in" ? has : !has;
      } else {
        if (!((typeof a === "number" && typeof b === "number") || (typeof a === "string" && typeof b === "string"))) throw new Unknown();
        r = op === "<" ? a < b : op === ">" ? a > b : op === "<=" ? a <= b : a >= b;
      }
      result = (result ?? true) && r;
      a = b;
    }
    return result ?? a;
  }
  add(): V {
    let a = this.mul();
    while (this.peek("+") || this.peek("-")) {
      const op = this.t[this.i++].v;
      const b = this.mul();
      if (op === "+") {
        if (typeof a === "number" && typeof b === "number") a = a + b;
        else if (typeof a === "string" && typeof b === "string") a = a + b;
        else if (isList(a) && isList(b)) a = [...a, ...b];
        else throw new Unknown();
      } else {
        if (typeof a !== "number" || typeof b !== "number") throw new Unknown();
        a = a - b;
      }
    }
    return a;
  }
  mul(): V {
    let a = this.unary();
    while (this.peek("*") || this.peek("/") || this.peek("//") || this.peek("%")) {
      const op = this.t[this.i++].v;
      const b = this.unary();
      if (op === "*" && typeof a === "string" && typeof b === "number") a = a.repeat(Math.max(0, b));
      else if (op === "*" && isList(a) && typeof b === "number") a = Array.from({ length: Math.max(0, b) }, () => a as V[]).flat();
      else {
        if (typeof a !== "number" || typeof b !== "number") throw new Unknown();
        if (b === 0 && op !== "*") throw new Unknown();
        a = op === "*" ? a * b : op === "/" ? a / b : op === "//" ? Math.floor(a / b) : ((a % b) + b) % b;
      }
    }
    return a;
  }
  unary(): V {
    if (this.peek("-")) {
      this.i++;
      const v = this.unary();
      if (typeof v !== "number") throw new Unknown();
      return -v;
    }
    if (this.peek("+")) {
      this.i++;
      return this.unary();
    }
    return this.power();
  }
  power(): V {
    const a = this.postfix();
    if (this.peek("**")) {
      this.i++;
      const b = this.unary();
      if (typeof a !== "number" || typeof b !== "number") throw new Unknown();
      return a ** b;
    }
    return a;
  }
  args(): V[] {
    this.eat("(");
    const out: V[] = [];
    while (!this.peek(")")) {
      if (this.t[this.i]?.k === "name" && this.t[this.i + 1]?.v === "=") throw new Unknown(); // キーワード引数は扱わない
      out.push(this.expr());
      if (this.peek(",")) this.i++;
      else break;
    }
    this.eat(")");
    return out;
  }
  postfix(): V {
    let v = this.atom();
    for (;;) {
      if (this.peek("[")) {
        this.i++;
        let start: V | undefined;
        let end: V | undefined;
        let slice = false;
        if (!this.peek(":")) start = this.expr();
        if (this.peek(":")) {
          slice = true;
          this.i++;
          if (!this.peek("]")) end = this.expr();
        }
        this.eat("]");
        const seq = typeof v === "string" ? v : isList(v) ? v : isTuple(v) ? v.tuple : null;
        if (seq === null) throw new Unknown();
        const n = seq.length;
        const idx = (x: V | undefined, d: number) => {
          if (x === undefined) return d;
          if (typeof x !== "number" || !Number.isInteger(x)) throw new Unknown();
          return x < 0 ? Math.max(0, n + x) : Math.min(n, x);
        };
        if (slice) v = seq.slice(idx(start, 0), idx(end, n)) as V;
        else {
          if (typeof start !== "number") throw new Unknown();
          const k = start < 0 ? n + start : start;
          if (k < 0 || k >= n) throw new Unknown();
          v = seq[k] as V;
        }
        continue;
      }
      if (this.peek(".")) {
        this.i++;
        const m = this.t[this.i++];
        if (!m || m.k !== "name") throw new Unknown();
        if (!this.peek("(")) throw new Unknown();
        v = method(v, m.v, this.args());
        continue;
      }
      break;
    }
    return v;
  }
  atom(): V {
    const t = this.t[this.i++];
    if (!t) throw new Unknown();
    if (t.k === "num") return Number(t.v);
    if (t.k === "str") {
      let s = t.v;
      // "a" "b" のように並べた文字はつなぐ
      while (this.t[this.i]?.k === "str") s += this.t[this.i++].v;
      return s;
    }
    if (t.k === "op" && t.v === "(") {
      if (this.peek(")")) {
        this.i++;
        return { tuple: [] };
      }
      const v = this.exprList();
      this.eat(")");
      return v;
    }
    if (t.k === "op" && t.v === "[") {
      const items: V[] = [];
      while (!this.peek("]")) {
        items.push(this.expr());
        if (this.peek("for")) throw new Unknown(); // 内包表記は扱わない
        if (this.peek(",")) this.i++;
        else break;
      }
      this.eat("]");
      return items;
    }
    if (t.k === "name") {
      if (t.v === "True") return true;
      if (t.v === "False") return false;
      if (t.v === "None") return null;
      if (t.v === "math" && this.peek(".")) {
        this.i++;
        const f = this.t[this.i++]?.v ?? "";
        if (this.peek("(")) {
          const fn = MATH[f];
          const a = this.args();
          if (!fn || !a.every((x) => typeof x === "number")) throw new Unknown();
          return fn(...(a as number[]));
        }
        if (f in MATH_CONST) return MATH_CONST[f];
        throw new Unknown();
      }
      if (this.peek("(")) return builtin(t.v, this.args());
      const v = this.env.get(t.v);
      if (v === undefined || v === UNKNOWN) throw new Unknown();
      return v;
    }
    throw new Unknown();
  }
}

function seqOf(v: V): V[] | null {
  if (isList(v)) return v;
  if (isTuple(v)) return v.tuple;
  if (typeof v === "string") return [...v];
  return null;
}

function builtin(name: string, a: V[]): V {
  const [x, y] = a;
  switch (name) {
    case "len": {
      const s = seqOf(x);
      if (!s) throw new Unknown();
      return s.length;
    }
    case "str":
      return x === undefined ? "" : typeof x === "string" ? x : pyRepr(x);
    case "int":
      if (typeof x === "number") return Math.trunc(x);
      if (typeof x === "boolean") return x ? 1 : 0;
      if (typeof x === "string" && /^\s*[-+]?\d+\s*$/.test(x)) return parseInt(x, 10);
      throw new Unknown();
    case "float":
      if (typeof x === "number") return x;
      if (typeof x === "string" && /^\s*[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?\s*$/i.test(x)) return parseFloat(x);
      throw new Unknown();
    case "bool":
      return x === undefined ? false : truthy(x);
    case "abs":
      if (typeof x !== "number") throw new Unknown();
      return Math.abs(x);
    case "round": {
      if (typeof x !== "number") throw new Unknown();
      const d = typeof y === "number" ? y : 0;
      const f = 10 ** d;
      // Python と同じ「偶数への丸め」は複雑なので、ふつうの四捨五入（ずれるのは .5 ちょうどのときだけ）
      const r = Math.round(x * f) / f;
      return d === 0 ? Math.trunc(r) : r;
    }
    case "min":
    case "max": {
      const list = a.length === 1 ? seqOf(x) : a;
      if (!list || !list.length || !list.every((v) => typeof v === "number" || typeof v === "string")) throw new Unknown();
      return (list as (number | string)[]).reduce((p, c) => ((name === "min" ? c < p : c > p) ? c : p));
    }
    case "sum": {
      const list = seqOf(x);
      if (!list || !list.every((v) => typeof v === "number")) throw new Unknown();
      return (list as number[]).reduce((p, c) => p + c, typeof y === "number" ? y : 0);
    }
    case "list":
      return x === undefined ? [] : [...(seqOf(x) ?? (() => { throw new Unknown(); })())];
    case "tuple":
      return { tuple: x === undefined ? [] : [...(seqOf(x) ?? (() => { throw new Unknown(); })())] };
    case "sorted": {
      const list = seqOf(x);
      if (!list || !list.every((v) => typeof v === typeof list[0] && (typeof v === "number" || typeof v === "string"))) throw new Unknown();
      return [...(list as (number | string)[])].sort((p, q) => (p < q ? -1 : p > q ? 1 : 0));
    }
    case "reversed":
      return [...(seqOf(x) ?? (() => { throw new Unknown(); })())].reverse();
    case "range": {
      const nums = a.map((v) => (typeof v === "number" && Number.isInteger(v) ? v : NaN));
      if (nums.some(Number.isNaN)) throw new Unknown();
      const [s, e, st] = nums.length === 1 ? [0, nums[0], 1] : [nums[0], nums[1], nums[2] ?? 1];
      if (!st) throw new Unknown();
      const out: number[] = [];
      for (let i = s; st > 0 ? i < e : i > e; i += st) {
        out.push(i);
        if (out.length > 10000) throw new Unknown();
      }
      return out;
    }
    case "chr":
      if (typeof x !== "number") throw new Unknown();
      return String.fromCodePoint(x);
    case "ord":
      if (typeof x !== "string" || [...x].length !== 1) throw new Unknown();
      return x.codePointAt(0)!;
    case "pow":
      if (typeof x !== "number" || typeof y !== "number") throw new Unknown();
      return x ** y;
  }
  // input()・random・自分で作った関数などは、わからない
  throw new Unknown();
}

function method(v: V, name: string, a: V[]): V {
  const [x, y] = a;
  if (typeof v === "string") {
    switch (name) {
      case "upper":
        return v.toUpperCase();
      case "lower":
        return v.toLowerCase();
      case "strip":
        return typeof x === "string" ? v.replace(new RegExp(`^[${escapeClass(x)}]+|[${escapeClass(x)}]+$`, "g"), "") : v.trim();
      case "lstrip":
        return v.trimStart();
      case "rstrip":
        return v.trimEnd();
      case "replace":
        if (typeof x !== "string" || typeof y !== "string") throw new Unknown();
        return v.split(x).join(y);
      case "split":
        if (x === undefined) return v.trim().split(/\s+/).filter(Boolean);
        if (typeof x !== "string" || !x) throw new Unknown();
        return v.split(x);
      case "join": {
        const list = x === undefined ? null : seqOf(x);
        if (!list || !list.every((s) => typeof s === "string")) throw new Unknown();
        return list.join(v);
      }
      case "count":
        if (typeof x !== "string" || !x) throw new Unknown();
        return v.split(x).length - 1;
      case "find":
        if (typeof x !== "string") throw new Unknown();
        return v.indexOf(x);
      case "startswith":
        if (typeof x !== "string") throw new Unknown();
        return v.startsWith(x);
      case "endswith":
        if (typeof x !== "string") throw new Unknown();
        return v.endsWith(x);
      case "isdigit":
        return /^\d+$/.test(v);
      case "capitalize":
        return v ? v[0].toUpperCase() + v.slice(1).toLowerCase() : v;
      case "title":
        return v.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
      case "zfill":
        if (typeof x !== "number") throw new Unknown();
        return v.padStart(x, "0");
    }
  }
  if (isList(v)) {
    switch (name) {
      case "count":
        return v.filter((e) => x !== undefined && eq(e, x)).length;
      case "index": {
        const i = v.findIndex((e) => x !== undefined && eq(e, x));
        if (i < 0) throw new Unknown();
        return i;
      }
      case "copy":
        return [...v];
    }
  }
  throw new Unknown();
}

function escapeClass(s: string) {
  return s.replace(/[\\\]^-]/g, "\\$&");
}

export function evalExpr(src: string, env: Env): V {
  const p = new Parser(tokenize(src), env);
  const v = p.exprList();
  if (!p.done()) throw new Unknown();
  return v;
}

// ───────── 文

interface Line {
  no: number;
  indent: number;
  text: string;
}

const ASSIGNED = /^([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)\s*(=|\+=|-=|\*=|\/=|\/\/=|%=|\*\*=)(?!=)\s*(.+)$/;

/** ブロックの中で値が入る名前（わからなくするため） */
function assignedIn(lines: Line[]): Set<string> {
  const out = new Set<string>();
  for (const l of lines) {
    const m = ASSIGNED.exec(l.text);
    if (m) for (const n of m[1].split(",")) out.add(n.trim());
    const f = /^for\s+(.+?)\s+in\s/.exec(l.text);
    if (f) for (const n of f[1].replace(/[()]/g, "").split(",")) out.add(n.trim());
    const w = /\bas\s+(\w+)\s*:\s*$/.exec(l.text);
    if (w) out.add(w[1]);
    const mm = /^([A-Za-z_]\w*)\.(append|extend|insert|pop|remove|sort|reverse|clear)\(/.exec(l.text);
    if (mm) out.add(mm[1]);
  }
  return out;
}

class Sim {
  steps = 0;
  /** 調べたい行で、その変数の値（行が動くたびに） */
  seen: Val[] = [];
  /** 小数（float）が入っている変数（4.0 のように見せるため） */
  floats = new Set<string>();
  seenFloat: boolean[] = [];
  constructor(
    readonly lines: Line[],
    readonly name: string,
    readonly target: number,
  ) {}

  /** i 行目から始まるブロック（i 行目より字下げが深い行）の終わり */
  blockEnd(i: number): number {
    const ind = this.lines[i].indent;
    let j = i + 1;
    while (j < this.lines.length && this.lines[j].indent > ind) j++;
    return j;
  }

  watch(no: number, env: Env) {
    if (no === this.target) {
      this.seen.push(env.has(this.name) ? env.get(this.name)! : UNKNOWN);
      this.seenFloat.push(this.floats.has(this.name));
    }
    if (++this.steps > 30000) throw new Budget();
  }

  /** ブロックの中の行を、その場で見たことにする（値はわからない） */
  markUnknown(body: Line[], env: Env) {
    for (const n of assignedIn(body)) env.set(n, UNKNOWN);
    for (const l of body) if (l.no === this.target) this.seen.push(UNKNOWN);
  }

  run(from: number, to: number, env: Env) {
    let i = from;
    while (i < to) {
      const l = this.lines[i];
      const end = /:\s*$/.test(l.text) ? this.blockEnd(i) : i + 1;
      const body = this.lines.slice(i + 1, end);
      const s = l.text;
      let m: RegExpExecArray | null;
      if (/^(def|class|async\s+def|@)/.test(s)) {
        if (l.no === this.target) this.seen.push(env.get(this.name) ?? UNKNOWN);
        i = end;
        continue;
      }
      if ((m = /^(if|elif)\s+(.+):\s*$/.exec(s)) && m[1] === "if") {
        // if / elif / else のつながりをまとめて
        const chain: { cond: string | null; from: number; to: number; no: number }[] = [];
        let j = i;
        for (;;) {
          const h = this.lines[j];
          const e = this.blockEnd(j);
          const c = /^(?:if|elif)\s+(.+):\s*$/.exec(h.text);
          chain.push({ cond: c ? c[1] : null, from: j + 1, to: e, no: h.no });
          if (e < to && this.lines[e].indent === l.indent && /^(elif\s.+|else\s*):\s*$/.test(this.lines[e].text)) {
            j = e;
            continue;
          }
          i = e;
          break;
        }
        let picked = -1;
        let unknown = false;
        for (let k = 0; k < chain.length; k++) {
          this.watch(chain[k].no, env);
          if (chain[k].cond === null) {
            picked = k;
            break;
          }
          let c: V;
          try {
            c = evalExpr(chain[k].cond!, env);
          } catch (err) {
            if (err instanceof Unknown) {
              unknown = true;
              break;
            }
            throw err;
          }
          if (truthy(c)) {
            picked = k;
            break;
          }
        }
        if (unknown) for (const c of chain) this.markUnknown(this.lines.slice(c.from, c.to), env);
        else if (picked >= 0) this.run(chain[picked].from, chain[picked].to, env);
        continue;
      }
      if ((m = /^for\s+(.+?)\s+in\s+(.+):\s*$/.exec(s))) {
        const names = m[1].replace(/[()]/g, "").split(",").map((x) => x.trim());
        let items: V[] | null = null;
        try {
          items = seqOf(evalExpr(m[2], env));
        } catch (err) {
          if (!(err instanceof Unknown)) throw err;
        }
        if (!items || items.length > 5000) {
          for (const n of names) env.set(n, UNKNOWN);
          this.watch(l.no, env);
          this.markUnknown(body, env);
        } else {
          try {
            for (const it of items) {
              if (names.length === 1) env.set(names[0], it);
              else {
                const parts = seqOf(it);
                if (!parts || parts.length !== names.length) throw new Unknown();
                names.forEach((n, k) => env.set(n, parts[k]));
              }
              this.watch(l.no, env);
              try {
                this.run(i + 1, end, env);
              } catch (err) {
                if (err instanceof Continue) continue;
                throw err;
              }
            }
          } catch (err) {
            if (err instanceof Break) {
              // くり返しを抜けた
            } else if (err instanceof Unknown) this.markUnknown(body, env);
            else throw err;
          }
        }
        i = end;
        continue;
      }
      if ((m = /^while\s+(.+):\s*$/.exec(s))) {
        let rounds = 0;
        try {
          for (;;) {
            this.watch(l.no, env);
            const c = evalExpr(m[1], env);
            if (!truthy(c)) break;
            if (++rounds > 2000) throw new Unknown();
            try {
              this.run(i + 1, end, env);
            } catch (err) {
              if (err instanceof Continue) continue;
              throw err;
            }
          }
        } catch (err) {
          if (err instanceof Break) {
            // 抜けた
          } else if (err instanceof Unknown) this.markUnknown(body, env);
          else throw err;
        }
        i = end;
        continue;
      }
      if (/^(try|finally)\s*:\s*$/.test(s)) {
        this.watch(l.no, env);
        this.run(i + 1, end, env);
        i = end;
        continue;
      }
      if (/^(except|else)\b.*:\s*$/.test(s)) {
        // エラーは起きなかったことにする（except の中は動かない）
        this.markUnknown([], env);
        i = end;
        continue;
      }
      if ((m = /^with\s+.+\s+as\s+(\w+)\s*:\s*$/.exec(s))) {
        env.set(m[1], UNKNOWN);
        this.watch(l.no, env);
        this.run(i + 1, end, env);
        i = end;
        continue;
      }
      if (/:\s*$/.test(s)) {
        // ほかのブロック（match など）は中身をわからなくする
        this.watch(l.no, env);
        this.markUnknown(body, env);
        i = end;
        continue;
      }
      if (s === "break") throw new Break();
      if (s === "continue") throw new Continue();
      this.simple(s, env);
      this.watch(l.no, env);
      i = end;
    }
  }

  /** 1 行の文 */
  simple(s: string, env: Env) {
    let m: RegExpExecArray | null;
    if ((m = ASSIGNED.exec(s))) {
      const targets = m[1].split(",").map((x) => x.trim());
      const op = m[2];
      try {
        let v = evalExpr(m[3], env);
        if (op !== "=") {
          const cur = env.get(targets[0]);
          if (targets.length !== 1 || cur === undefined || cur === UNKNOWN) throw new Unknown();
          const sym = op.slice(0, -1);
          v = evalExpr(`__a ${sym} __b`, new Map<string, Val>([["__a", cur], ["__b", v]]));
        }
        if (targets.length === 1) {
          env.set(targets[0], v);
          // 割り算（/）・math・float( )・小数・小数の入った変数が出てくる式は、結果も小数
          const usesFloat = /(^|[^/])\/(?!\/)|\bmath\.|\bfloat\(|\d\.\d|\.\d/.test(m[3]) || [...this.floats].some((f) => new RegExp(`\\b${f}\\b`).test(m![3])) || (op !== "=" && this.floats.has(targets[0]));
          if (typeof v === "number" && (usesFloat || !Number.isInteger(v))) this.floats.add(targets[0]);
          else this.floats.delete(targets[0]);
        }
        else {
          const parts = seqOf(v);
          if (!parts || parts.length !== targets.length) throw new Unknown();
          targets.forEach((n, k) => env.set(n, parts[k]));
        }
      } catch (err) {
        if (!(err instanceof Unknown)) throw err;
        for (const n of targets) env.set(n, UNKNOWN);
      }
      return;
    }
    // a.append(x) などのリストの操作
    if ((m = /^([A-Za-z_]\w*)\.(append|extend|insert|pop|remove|sort|reverse|clear)\((.*)\)\s*$/.exec(s))) {
      const cur = env.get(m[1]);
      try {
        if (!isList(cur)) throw new Unknown();
        const args = m[3].trim() ? seqOrOne(evalExpr(m[3], env)) : [];
        const list = [...cur];
        switch (m[2]) {
          case "append":
            list.push(args[0]);
            break;
          case "extend": {
            const more = seqOf(args[0]);
            if (!more) throw new Unknown();
            list.push(...more);
            break;
          }
          case "insert":
            if (typeof args[0] !== "number") throw new Unknown();
            list.splice(args[0] < 0 ? Math.max(0, list.length + args[0]) : args[0], 0, args[1]);
            break;
          case "pop":
            if (!list.length) throw new Unknown();
            list.splice(args.length ? (args[0] as number) : list.length - 1, 1);
            break;
          case "remove": {
            const k = list.findIndex((e) => eq(e, args[0]));
            if (k < 0) throw new Unknown();
            list.splice(k, 1);
            break;
          }
          case "sort":
            if (args.length || !list.every((v) => typeof v === typeof list[0] && (typeof v === "number" || typeof v === "string"))) throw new Unknown();
            list.sort((p, q) => ((p as number) < (q as number) ? -1 : (p as number) > (q as number) ? 1 : 0));
            break;
          case "reverse":
            list.reverse();
            break;
          case "clear":
            list.length = 0;
            break;
        }
        env.set(m[1], list);
      } catch (err) {
        if (!(err instanceof Unknown)) throw err;
        env.set(m[1], UNKNOWN);
      }
      return;
    }
    // a[i] = x
    if ((m = /^([A-Za-z_]\w*)\s*\[(.+)\]\s*=(?!=)\s*(.+)$/.exec(s))) {
      const cur = env.get(m[1]);
      try {
        if (!isList(cur)) throw new Unknown();
        const k = evalExpr(m[2], env);
        const v = evalExpr(m[3], env);
        if (typeof k !== "number" || !Number.isInteger(k)) throw new Unknown();
        const idx = k < 0 ? cur.length + k : k;
        if (idx < 0 || idx >= cur.length) throw new Unknown();
        const list = [...cur];
        list[idx] = v;
        env.set(m[1], list);
      } catch (err) {
        if (!(err instanceof Unknown)) throw err;
        env.set(m[1], UNKNOWN);
      }
      return;
    }
    // global / del / import などや、print(…) のような式は、値を変えない
    if ((m = /^del\s+([A-Za-z_]\w*)\s*$/.exec(s))) env.delete(m[1]);
  }
}

function seqOrOne(v: V): V[] {
  return isTuple(v) ? v.tuple : [v];
}

/**
 * lines（コード）を上から計算して、line 行目の時点の name の値を予想する。
 * わからなければ null。くり返しの中なら、回ごとの値を並べる
 */
export function simulateValue(lines: string[], name: string, line: number): { text: string; values: string[] } | null {
  if (!/^[A-Za-z_]\w*$/.test(name) || lines.length > 3000) return null;
  // 行を（字下げ・中身）にする。複数行にまたがる文がある行は扱わない
  const parsed: Line[] = [];
  let depth = 0;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const text = raw.replace(/\s+#.*$/, "").replace(/^\s*#.*$/, "").trim();
    for (const c of text) {
      if ("([{".includes(c)) depth++;
      else if (")]}".includes(c)) depth--;
    }
    if (!text || /^("""|''')/.test(text)) continue;
    if (depth !== 0) return null;
    const indent = /^[ \t]*/.exec(raw)![0].replace(/\t/g, "    ").length;
    parsed.push({ no: i + 1, indent, text });
  }
  const sim = new Sim(parsed, name, line);
  const env: Env = new Map();
  try {
    sim.run(0, parsed.length, env);
  } catch (err) {
    if (!(err instanceof Unknown) && !(err instanceof Break) && !(err instanceof Continue) && !(err instanceof Budget)) return null;
    if (err instanceof Budget) return null;
  }
  if (!sim.seen.length) return null;
  if (sim.seen.some((v) => v === UNKNOWN)) return null;
  const values = (sim.seen as V[]).map((v, i) => (typeof v === "number" && Number.isInteger(v) && sim.seenFloat[i] && Number.isFinite(v) ? `${v}.0` : pyRepr(v)));
  if (values.length === 1) return { text: values[0], values };
  // 同じ値が続くところはまとめる
  const uniq = values.filter((v, i) => i === 0 || v !== values[i - 1]);
  const shown = uniq.length > 6 ? [...uniq.slice(0, 3), "…", ...uniq.slice(-2)] : uniq;
  return { text: `${shown.join(" → ")}（${values.length} 回）`, values };
}
