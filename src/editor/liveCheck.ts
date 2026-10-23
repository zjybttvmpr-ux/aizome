// 書きながらのエラー表示：文法のまちがい・まだ作っていない名前・import の付け忘れに波線を引く。
// 波線にマウスを乗せると直し方のボタンが出る。Ctrl+. でカーソルの行の直し方をすぐ使える。
import { forceLinting, linter, type Action, type Diagnostic } from "@codemirror/lint";
import { language, syntaxTree } from "@codemirror/language";
import { Decoration, EditorView, WidgetType, keymap, type DecorationSet } from "@codemirror/view";
import { Prec, RangeSetBuilder, StateEffect, StateField, type EditorState, type Extension } from "@codemirror/state";
import { checkCode, checkLangByName, checkLangOf, importEdit, type CheckLang, type Fix, type Problem } from "./codeCheck";
import { inferUpdated } from "./checkEvents";
import { hasValueAt, setValues, traceAt } from "./valueLens";
import { runErrorsAt, setRunErrors } from "./runErrors";
import { sideMode, sideModeChanged } from "./sideMode";
import { explainRuntime } from "../run/pyErrors";
import { contextMenu, type MenuItem as CtxItem } from "../ui/fileTree";
import { cachedPyCheck, pyCheck, translatePy, ZENKAKU_FIX, type PyIssue } from "../run/pycheck";
import { docFilename } from "./ghost";
import { filenameForLanguage } from "../core/languages";
import { parseDirective } from "../core/langDirective";
import { extname } from "../core/paths";
import { settings } from "../core/settings";
import { bus } from "../core/events";
import { t } from "../core/i18n";

/** このファイルを調べる言語（1 行目の ## py ## の指定も見る） */
export function checkLangOfState(state: EditorState): CheckLang | null {
  const first = state.doc.line(1).text;
  const d = settings.get("files.langDirective") ? parseDirective(first) : null;
  // 1 行目の ## 言語 ## → ファイル名（下に出ている言語と同じ）→ エディタが色分けに使っている言語
  const byName = checkLangOf(d?.ext ?? extname(filenameForLanguage(state.facet(docFilename))));
  if (byName) return byName;
  const lang = state.facet(language);
  return lang ? checkLangByName(lang.name) : null;
}

/** 実行するとエラーになりそうなこと（自動判定の行の右に出す用）：まだない名前・モジュールにない名前・0 で割る など */
export function predictedProblems(state: EditorState): { line: number; text: string }[] {
  if (!settings.get("editor.liveCheck")) return [];
  const out: { line: number; text: string }[] = [];
  for (const p of problemsOf(state, null)) {
    if (p.kind !== "undefined" && p.kind !== "runtime") continue;
    if (p.msg === "rt.dynamic") continue;
    const line = state.doc.lineAt(Math.min(p.from, state.doc.length)).number;
    if (out.some((x) => x.line === line)) continue;
    const msg = t(p.msg, p.args ?? {});
    out.push({ line, text: p.kind === "undefined" ? t("predict.name", { msg }) : t("predict.runtime", { msg }) });
  }
  return out;
}

/** 文法のまちがい（自動判定の行の右に出す用）。行番号と短い説明 */
export function syntaxProblems(state: EditorState): { line: number; text: string }[] {
  const lang = checkLangOfState(state);
  if (!lang || state.doc.lines > 8000) return [];
  const text = state.doc.toString();
  const py = lang === "python" && settings.get("editor.pythonCheck") ? cachedPyCheck(text) : null;
  const list = checkCode(text, lang, { syntax: true, names: false, indent: !py }).filter((p) => p.kind === "syntax" && p.severity === "error");
  if (py) list.push(...pyProblems(state, py).filter((p) => p.kind === "syntax" && p.severity === "error"));
  list.sort((a, b) => a.from - b.from);
  const out: { line: number; text: string }[] = [];
  for (const p of list) {
    const line = state.doc.lineAt(Math.min(p.from, state.doc.length)).number;
    if (out.some((x) => x.line === line)) continue;
    out.push({ line, text: t(p.msg, p.args ?? {}) });
  }
  return out;
}

// ───────── 「値を見る」で出た実行時のエラー（日本語の説明と直し方）

/** その行の中で、find がいちばん col に近い場所 */
function findInLine(text: string, find: string, attr: boolean, col: number | null | undefined): number {
  const re = attr ? new RegExp(`\\.(${find})\\b`, "g") : new RegExp(`(?<![\\w.])(${find})\\b`, "g");
  let best = -1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const at = m.index + (attr ? 1 : 0);
    if (best < 0 || (col != null && Math.abs(at - col) < Math.abs(best - col))) best = at;
  }
  return best;
}

export function runtimeProblems(state: EditorState): Problem[] {
  const err = traceAt(state)?.error;
  if (!err?.line || err.line > state.doc.lines) return [];
  const line = state.doc.line(err.line);
  const ex = explainRuntime(err, state.doc.toString());
  const lead = /^\s*/.exec(line.text)![0].length;
  let from = line.from + lead;
  let to = Math.max(from + 1, line.from + line.text.trimEnd().length);
  if (err.col != null && err.endCol != null && err.endCol > err.col && err.endCol <= line.text.length) {
    from = line.from + err.col;
    to = line.from + err.endCol;
  }
  const fixes: Fix[] = [];
  if (ex.fix) {
    const at = findInLine(line.text, ex.fix.find, !!ex.fix.attr, err.col);
    if (at >= 0) {
      from = line.from + at;
      to = from + ex.fix.find.length;
      fixes.push({ label: "rt.fixLabel", args: { to: ex.fix.to }, changes: [{ from, to, insert: ex.fix.to }] });
    }
  }
  return [{ from, to: Math.min(to, line.to), kind: "runtime", severity: "error", msg: "rt.dynamic", args: { text: ex.text + (ex.hint ? `\n${ex.hint}` : ""), install: ex.install ?? "" }, fixes }];
}

/** 実行・コンパイルで出たエラー（どの言語でも）を、波線と直し方にする */
export function runErrorProblems(state: EditorState): Problem[] {
  const out: Problem[] = [];
  for (const it of runErrorsAt(state)) {
    if (it.pos > state.doc.length) continue;
    const line = state.doc.lineAt(it.pos);
    const lead = /^\s*/.exec(line.text)![0].length;
    let from = line.from + lead;
    let to = Math.max(from + 1, line.from + line.text.trimEnd().length);
    if (it.col && it.col - 1 < line.text.length) {
      from = line.from + it.col - 1;
      const w = /^[\w$]+/.exec(line.text.slice(it.col - 1));
      to = w ? from + w[0].length : Math.min(line.to, from + 1);
    }
    const fixes: Fix[] = [];
    if (it.fix) {
      const at = findInLine(line.text, it.fix.find, !!it.fix.attr, it.col ? it.col - 1 : null);
      if (at >= 0) {
        from = line.from + at;
        to = from + it.fix.find.length;
        fixes.push({ label: "rt.fixLabel", args: { to: it.fix.to }, changes: [{ from, to, insert: it.fix.to }] });
      }
    }
    out.push({ from, to: Math.min(Math.max(to, from + 1), line.to), kind: "runtime", severity: it.severity, msg: "rt.dynamic", args: { text: it.text + (it.hint ? `\n${it.hint}` : ""), install: it.install ?? "" }, fixes });
  }
  return out;
}

/** その行の、直し方のある問題（実行時のエラー・実行やコンパイルのエラー・書きながらのチェック） */
function lineProblems(state: EditorState, lineNo: number): Problem[] {
  const line = state.doc.line(Math.max(1, Math.min(lineNo, state.doc.lines)));
  const on = (p: Problem) => p.from >= line.from && p.from <= line.to;
  const seen = new Set<string>();
  return [...runtimeProblems(state), ...runErrorProblems(state), ...problemsOf(state, null).filter((p) => p.severity !== "info")]
    .filter(on)
    .filter((p) => {
      const k = `${p.from}:${p.msg}:${JSON.stringify(p.args ?? {})}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}

/** ホイールの押し込み（中クリック）：その行の、いちばん確かな直し方を使う */
function applyLineFix(view: EditorView, lineNo: number, near: number): boolean {
  const list = lineProblems(view.state, lineNo).filter((p) => p.fixes.length > 0);
  if (!list.length) return false;
  // 実行して出たエラー → タイプミス → そのほか の順。同じなら押した場所に近いもの
  const rank = (p: Problem) => (p.kind === "runtime" ? 0 : p.msg === "check.undefinedNear" || p.msg === "pyl.attr_missing" ? 1 : p.severity === "error" ? 2 : 3);
  list.sort((a, b) => rank(a) - rank(b) || Math.abs(a.from - near) - Math.abs(b.from - near));
  view.dispatch({ changes: list[0].fixes[0].changes, userEvent: "input.quickfix" });
  return true;
}

/** エラーの印（✖ …）を押したとき：説明と直し方の一覧 */
function showProblemMenu(view: EditorView, lineNo: number, x: number, y: number) {
  const list = lineProblems(view.state, lineNo);
  if (!list.length) return;
  const items: CtxItem[] = [{ label: t("rt.menuTitle"), note: true }];
  for (const p of list) {
    const text = p.msg === "rt.dynamic" ? p.args?.text ?? "" : t(p.msg, p.args ?? {});
    for (const l of text.split("\n")) items.push({ label: l, note: true });
    for (const f of p.fixes) items.push({ label: t(f.label, f.args ?? {}), hint: t("rt.wheel"), run: () => view.dispatch({ changes: f.changes, userEvent: "input.quickfix" }) });
    if (p.args?.install) items.push({ label: t("rt.pipLabel", { pip: p.args.install }), run: () => bus.emit("pip:install", { pkg: p.args!.install }) });
    items.push({ label: "", sep: true });
  }
  items.pop();
  contextMenu(x, y, items);
}

window.addEventListener("aizome:runtime-error", (e) => {
  const { el, x, y } = (e as CustomEvent<{ el: HTMLElement; x: number; y: number }>).detail;
  const view = [...views].find((v) => v.dom.contains(el));
  const err = view ? traceAt(view.state)?.error : null;
  if (view && err?.line) showProblemMenu(view, err.line, x, y);
});
window.addEventListener("aizome:problem-menu", (e) => {
  const { el, x, y, line } = (e as CustomEvent<{ el: HTMLElement; x: number; y: number; line: number }>).detail;
  const view = [...views].find((v) => v.dom.contains(el));
  if (view) showProblemMenu(view, line, x, y);
});

// ───────── 書きながら見つけたまちがいを、行の右にも出す（値を見るのエラーと同じ形）

const setInline = StateEffect.define<{ pos: number; text: string; fix: string | null; severity: "error" | "warning" }[]>();

class InlineWidget extends WidgetType {
  constructor(
    readonly text: string,
    readonly fix: string | null,
    readonly severity: "error" | "warning",
    readonly line: number,
  ) {
    super();
  }
  eq(o: InlineWidget) {
    return o.text === this.text && o.fix === this.fix && o.severity === this.severity;
  }
  toDOM() {
    const el = document.createElement("span");
    el.className = `cm-value ${this.severity === "error" ? "error" : "warn"} cm-inline-problem`;
    el.textContent = `${this.severity === "error" ? "✖" : "⚠"} ${this.text}${this.fix ? `　${t("rt.tabHint", { to: this.fix })}` : ""}`;
    el.title = this.text;
    el.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      window.dispatchEvent(new CustomEvent("aizome:problem-menu", { detail: { el, x: e.clientX, y: e.clientY, line: this.line } }));
    });
    return el;
  }
  ignoreEvent() {
    return true;
  }
}

const inlineField = StateField.define<{ items: { pos: number; text: string; fix: string | null; severity: "error" | "warning" }[]; deco: DecorationSet }>({
  create: () => ({ items: [], deco: Decoration.none }),
  update(value, tr) {
    let items = value.items;
    let changed = false;
    for (const e of tr.effects) {
      if (e.is(setInline)) {
        items = e.value;
        changed = true;
      }
      if (e.is(sideModeChanged) || e.is(setValues) || e.is(setRunErrors)) changed = true;
    }
    if (tr.docChanged) {
      items = items.map((it) => ({ ...it, pos: tr.changes.mapPos(it.pos, -1) }));
      changed = true;
    }
    if (!changed) return value;
    return { items, deco: buildInline(tr.state, items) };
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
});

function buildInline(state: EditorState, items: { pos: number; text: string; fix: string | null; severity: "error" | "warning" }[]): DecorationSet {
  // 自動判定では行の右に予想を出すので、ここでは出さない。値を見る・実行のエラーがある行も重ねない
  if (!settings.get("editor.inlineErrors") || sideMode() === "auto" || sideMode() === "off") return Decoration.none;
  const runLines = new Set(runErrorsAt(state).map((x) => state.doc.lineAt(Math.min(x.pos, state.doc.length)).number));
  const b = new RangeSetBuilder<Decoration>();
  const done = new Set<number>();
  for (const it of [...items].sort((a, b) => a.pos - b.pos)) {
    if (it.pos > state.doc.length) continue;
    const line = state.doc.lineAt(it.pos);
    if (done.has(line.number) || runLines.has(line.number) || hasValueAt(state, line.number)) continue;
    done.add(line.number);
    b.add(line.to, line.to, Decoration.widget({ widget: new InlineWidget(it.text, it.fix, it.severity, line.number), side: 3 }));
  }
  return b.finish();
}

/** 行の右にまちがいを出している行（行の説明はその行に重ねない） */
export function inlineLines(state: EditorState): Set<number> {
  const f = state.field(inlineField, false);
  if (!f || !settings.get("editor.inlineErrors") || sideMode() === "auto" || sideMode() === "off") return new Set();
  return new Set(f.items.filter((it) => it.pos <= state.doc.length).map((it) => state.doc.lineAt(it.pos).number));
}

function inlineItems(_state: EditorState, problems: Problem[]) {
  const out: { pos: number; text: string; fix: string | null; severity: "error" | "warning" }[] = [];
  for (const p of problems) {
    if (p.severity === "info" || p.msg === "rt.dynamic") continue;
    const fix = p.fixes[0];
    const to = fix && fix.changes.length === 1 && fix.changes[0].insert && fix.changes[0].insert.length <= 30 && !fix.changes[0].insert.includes("\n") ? fix.changes[0].insert.trim() : null;
    out.push({ pos: p.from, text: t(p.msg, p.args ?? {}), fix: p.kind === "undefined" || p.kind === "runtime" ? to : null, severity: p.severity === "error" ? "error" : "warning" });
  }
  return out;
}

function problemsOf(state: EditorState, cursor: number | null, py: PyIssue[] | null = null): Problem[] {
  const lang = checkLangOfState(state);
  const live = settings.get("editor.liveCheck");
  const imports = settings.get("editor.importHelp");
  if (!lang || (!live && !imports) || state.doc.lines > 8000) return [];
  const text = state.doc.toString();
  if (lang === "python" && !py && settings.get("editor.pythonCheck")) py = cachedPyCheck(text);
  // 本物の Python で調べられたときは、字下げはそちらに任せる
  const all = checkCode(text, lang, { syntax: live, names: true, cursor, indent: !py });
  const out = all.filter((p) => (p.kind === "import" ? imports : live));
  if (live && py) {
    const own = new Set(out.filter((p) => p.kind === "syntax").map((p) => state.doc.lineAt(p.from).number));
    for (const q of pyProblems(state, py)) {
      // 同じ行を自分でも見つけていたら、直し方を付けてあるそちらを使う
      if (q.kind === "syntax" && q.severity === "error" && own.has(state.doc.lineAt(q.from).number)) continue;
      if (cursor !== null && q.kind === "syntax" && q.severity === "error" && q.msg === "py.unterminated" && state.doc.lineAt(cursor).number === state.doc.lineAt(q.from).number) continue;
      out.push(q);
    }
    out.push(...treeErrors(state, out, true));
  } else if (live) out.push(...treeErrors(state, out));
  if (live) out.push(...runtimeProblems(state), ...runErrorProblems(state));
  return out;
}

// ───────── 本物の Python の結果を、波線と直し方にする

/** 行の中の「# コメント」の前（文字列の中の # は除く） */
function codeEnd(text: string): number {
  let q: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === "\\") i++;
      else if (c === q) q = null;
    } else if (c === '"' || c === "'") q = c;
    else if (c === "#") return text.slice(0, i).trimEnd().length;
  }
  return text.trimEnd().length;
}

function indentOf(s: string) {
  return /^[ \t]*/.exec(s)![0].replace(/\t/g, "    ").length;
}

function prevCodeLine(state: EditorState, n: number): { text: string; number: number } | null {
  for (let k = n - 1; k >= 1; k--) {
    const l = state.doc.line(k);
    if (l.text.trim() && !l.text.trim().startsWith("#")) return { text: l.text, number: k };
  }
  return null;
}

export function pyProblems(state: EditorState, issues: PyIssue[]): Problem[] {
  const out: Problem[] = [];
  const doc = state.doc;
  for (const it of issues) {
    const lineNo = Math.max(1, Math.min(doc.lines, it.l));
    const line = doc.line(lineNo);
    const lead = /^[ \t]*/.exec(line.text)![0].length;
    let from = line.from + Math.max(0, (it.c || 1) - 1);
    let to = it.el === it.l && it.ec && it.ec > it.c ? line.from + it.ec - 1 : -1;
    if (from > line.to) from = line.to;
    if (to < 0 || to > line.to) {
      const m = /^[\w\u00c0-\uffff]+/.exec(doc.sliceString(from, line.to));
      to = m ? from + m[0].length : Math.min(line.to, from + 1);
    }
    if (from >= line.to && line.to > line.from) {
      from = line.to - 1;
      to = line.to;
    }
    const wholeLine = () => {
      from = line.from + lead;
      to = Math.max(from + 1, line.from + codeEnd(line.text));
      if (to > line.to) to = line.to;
    };
    if (it.t === "lint") {
      const [key, json] = it.m.split("|");
      const args = json ? (JSON.parse(json) as Record<string, string>) : {};
      const fixes: Fix[] = [];
      if ((key === "input_str" || key === "input_cmp") && args.name) {
        // いちばん近い「name = input(…)」を int(input(…)) に
        for (let k = lineNo - 1; k >= 1; k--) {
          const l = doc.line(k);
          const m = new RegExp(`^(\\s*${args.name}\\s*=\\s*)(input\\(.*\\))(\\s*(#.*)?)$`).exec(l.text);
          if (m) {
            const s0 = l.from + m[1].length;
            fixes.push({ label: "pyl.fix.int", changes: [{ from: s0, to: s0 + m[2].length, insert: `int(${m[2]})` }] });
            break;
          }
        }
      }
      if (key === "need_global" && args.name) {
        const myIndent = indentOf(line.text);
        for (let k = lineNo - 1; k >= 1; k--) {
          const l = doc.line(k);
          if (/^\s*(async\s+)?def\s/.test(l.text) && indentOf(l.text) < myIndent) {
            const body = k + 1 <= doc.lines ? doc.line(k + 1) : null;
            const ind = body ? /^[ \t]*/.exec(body.text)![0] : " ".repeat(indentOf(l.text) + 4);
            const at = body ? body.from : l.to;
            fixes.push({ label: "pyl.fix.global", args: { name: args.name }, changes: [{ from: at, to: at, insert: `${body ? "" : "\n"}${ind}global ${args.name}\n` }] });
            break;
          }
        }
      }
      if ((key === "attr_missing") && args.near) {
        fixes.push({ label: "rt.fixLabel", args: { to: args.near }, changes: [{ from, to, insert: args.near }] });
      }
      if (key === "no_self") {
        const m = /\(\s*\)/.exec(line.text);
        if (m) fixes.push({ label: "pyl.fix.self", changes: [{ from: line.from + m.index + 1, to: line.from + m.index + m[0].length - 1, insert: "self" }] });
      }
      if (key === "endless" || key === "unreachable" || key === "no_self") wholeLine();
      out.push({ from, to, kind: "runtime", severity: "warning", msg: `pyl.${key}`, args, fixes });
      continue;
    }
    const tr = translatePy(it.m, it.t);
    const fixes: Fix[] = [];
    const end = line.from + codeEnd(line.text);
    switch (tr.key) {
      case "py.expectedColon": {
        // Python が指す場所は行の終わり。文が複数行のときもあるので、その行の終わりに足す
        fixes.push({ label: "check.fix.addColon", changes: [{ from: end, to: end, insert: ":" }] });
        from = Math.max(line.from + lead, end - 1);
        to = end;
        break;
      }
      case "py.neverClosed": {
        fixes.push({ label: "check.fix.addClose", args: { c: tr.args.want }, changes: [{ from: end, to: end, insert: tr.args.want }] });
        to = from + 1;
        break;
      }
      case "py.invalidChar": {
        // その行の全角の記号をまとめて半角に（文字列の中は変えない）
        const changes: { from: number; to: number; insert: string }[] = [];
        let q: string | null = null;
        for (let k = 0; k < line.text.length; k++) {
          const ch = line.text[k];
          if (q) {
            if (ch === "\\") k++;
            else if (ch === q) q = null;
            continue;
          }
          if (ch === '"' || ch === "'") q = ch;
          else if (ch === "#") break;
          else if (ZENKAKU_FIX[ch] !== undefined) changes.push({ from: line.from + k, to: line.from + k + 1, insert: ZENKAKU_FIX[ch] });
        }
        if (changes.length) fixes.push({ label: "py.fix.zenkaku", changes });
        to = from + tr.args.c.length;
        break;
      }
      case "py.assignInCond": {
        const seg = doc.sliceString(from, Math.max(to, line.to));
        const m = /(^|[^=!<>:+\-*/%&|^])=(?!=)/.exec(seg);
        if (m) {
          const at = from + m.index + m[1].length;
          fixes.push({ label: "check.fix.replace", args: { c: "==" }, changes: [{ from: at, to: at + 1, insert: "==" }] });
        }
        break;
      }
      case "py.forgotComma": {
        const seg = doc.sliceString(from, to);
        const m = /\S(\s+)\S/.exec(seg);
        if (m) {
          const at = from + m.index + 1;
          fixes.push({ label: "py.fix.comma", changes: [{ from: at, to: at + m[1].length, insert: ", " }] });
        }
        break;
      }
      case "py.printParen": {
        const m = /^(\s*)(print)\s+(.+?)\s*$/.exec(line.text.slice(0, codeEnd(line.text)));
        if (m) fixes.push({ label: "py.fix.printParen", changes: [{ from: line.from, to: line.from + codeEnd(line.text), insert: `${m[1]}print(${m[3]})` }] });
        wholeLine();
        break;
      }
      case "py.expectedIndent":
      case "py.expectedIndentAfter": {
        const prev = prevCodeLine(state, lineNo);
        const want = (prev ? indentOf(prev.text) : 0) + 4;
        fixes.push({ label: "check.fix.indent", changes: [{ from: line.from, to: line.from + lead, insert: " ".repeat(want) }] });
        wholeLine();
        break;
      }
      case "py.unexpectedIndent": {
        const prev = prevCodeLine(state, lineNo);
        fixes.push({ label: "check.fix.indent", changes: [{ from: line.from, to: line.from + lead, insert: " ".repeat(prev ? indentOf(prev.text) : 0) }] });
        wholeLine();
        break;
      }
      case "py.unindent": {
        // 上の行で使っている字下げのうち、いちばん近いもの（同じ近さなら深い方）にそろえる
        const mine = indentOf(line.text);
        let best = 0;
        let bestD = Infinity;
        for (let k = lineNo - 1; k >= 1; k--) {
          const l = doc.line(k);
          if (!l.text.trim() || l.text.trim().startsWith("#")) continue;
          const ind = indentOf(l.text);
          const d = Math.abs(ind - mine);
          if (d < bestD || (d === bestD && ind > best)) {
            best = ind;
            bestD = d;
          }
          if (ind === 0) break;
        }
        fixes.push({ label: "check.fix.indent", changes: [{ from: line.from, to: line.from + lead, insert: " ".repeat(best) }] });
        wholeLine();
        break;
      }
      case "py.tabs": {
        fixes.push({ label: "check.fix.spaces", changes: [{ from: line.from, to: line.from + lead, insert: " ".repeat(indentOf(line.text)) }] });
        wholeLine();
        break;
      }
      default:
        if (!it.c) wholeLine();
    }
    if (to <= from) to = Math.min(line.to, from + 1);
    out.push({ from, to, kind: "syntax", severity: it.k === "error" ? "error" : "warning", msg: tr.key, args: tr.args, fixes });
  }
  return out;
}

/** 言語の文法（Lezer）が見つけたまちがい。自分で見つけたものと同じ行のものは出さない */
function treeErrors(state: EditorState, found: Problem[], cascadeOnly = false): Problem[] {
  const tree = syntaxTree(state);
  if (tree.length < state.doc.length) return [];
  const own = found.filter((p) => p.kind === "syntax" && p.severity === "error").sort((a, b) => a.from - b.from);
  const lines = new Set(own.map((p) => state.doc.lineAt(p.from).number));
  const firstOwn = own.length ? own[0].from : Infinity;
  const out: Problem[] = [];
  const cascaded = new Set<number>();
  tree.iterate({
    enter: (node) => {
      if (!node.type.isError || out.length >= 40) return;
      if (node.from >= firstOwn) {
        // 原因（かっこの閉じ忘れなど）より後ろの「巻き添え」：原因の行を教える
        const line = state.doc.lineAt(node.from);
        if (lines.has(line.number) || cascaded.has(line.number)) return;
        let root = own[0];
        for (const p of own) if (p.from <= node.from) root = p;
        cascaded.add(line.number);
        const rootLine = state.doc.lineAt(Math.min(root.from, state.doc.length)).number;
        const from = line.from + (/^\s*/.exec(line.text)?.[0].length ?? 0);
        const to = Math.max(from + 1, line.to);
        out.push({ from, to: Math.min(to, state.doc.length), kind: "syntax", severity: "info", msg: "check.cascade", args: { line: String(rootLine), cause: t(root.msg, root.args ?? {}) }, fixes: root.fixes });
        return;
      }
      if (cascadeOnly) return;
      const line = state.doc.lineAt(node.from);
      if (line.number === 1 && parseDirective(line.text)) return;
      if (lines.has(line.number)) return;
      lines.add(line.number);
      let from = node.from;
      let to = Math.max(node.to, from + 1);
      // 行の終わりの見えない所なら、直前の文字に印をつける
      if (from >= line.to) {
        from = Math.max(line.from, line.to - 1);
        to = line.to;
      }
      to = Math.min(to, line.to === from ? from + 1 : line.to, state.doc.length);
      if (to <= from) to = Math.min(from + 1, state.doc.length);
      out.push({ from, to, kind: "syntax", severity: "error", msg: "check.syntax", fixes: [] });
    },
  });
  return out;
}

/** 入力中の行のかっこ・コロンなどのまちがいは、打ち終わるまで出さない */
function typingLine(state: EditorState, p: Problem): boolean {
  if (p.kind !== "syntax") return false;
  const head = state.selection.main.head;
  const line = state.doc.lineAt(head);
  if (p.from < line.from || p.from > line.to) return false;
  if (head < line.from + line.text.trimEnd().length) return false;
  // 下にまだコードがあるなら、打ち終わった行のまちがい（直してから下を書いた・あとで消した）なので出す
  for (let n = line.number + 1; n <= Math.min(state.doc.lines, line.number + 50); n++) {
    if (state.doc.line(n).text.trim()) return false;
  }
  return true;
}

function message(p: Problem): string {
  return t(p.msg, p.args ?? {});
}

function toDiagnostic(state: EditorState, p: Problem): Diagnostic {
  const actions: Action[] = p.fixes.map((f, idx) => ({
    name: t(f.label, f.args ?? {}),
    apply: (view: EditorView, from: number) => applyFresh(view, p, from, idx),
  }));
  return {
    from: Math.min(p.from, state.doc.length),
    to: Math.min(Math.max(p.to, p.from), state.doc.length),
    severity: p.severity,
    markClass: p.msg === "check.cascade" ? "cm-cascade" : undefined,
    message: message(p),
    source: t("check.source"),
    actions,
  };
}

/** 直す時点の中身で調べ直してから直す（調べたあとに書きかえていても位置がずれない） */
function applyFresh(view: EditorView, p: Problem, from: number, idx: number) {
  const fresh = problemsOf(view.state, null).find((q) => q.from === from && q.msg === p.msg && q.args?.name === p.args?.name);
  const fix = fresh?.fixes[idx];
  if (!fix) return;
  view.dispatch({ changes: fix.changes, userEvent: "input.quickfix", scrollIntoView: false });
}

/** Ctrl+. ：カーソルのある行の、いちばん近い直し方を使う */
function quickFix(view: EditorView): boolean {
  const head = view.state.selection.main.head;
  const line = view.state.doc.lineAt(head);
  const list = problemsOf(view.state, null).filter((p) => p.fixes.length && p.from <= line.to && p.to >= line.from);
  if (!list.length) return false;
  list.sort((a, b) => Math.abs(a.from - head) - Math.abs(b.from - head));
  view.dispatch({ changes: list[0].fixes[0].changes, userEvent: "input.quickfix" });
  return true;
}

let views = new Set<EditorView>();

export function liveCheck(): Extension {
  return [
    linter(
      async (view) => {
        const state = view.state;
        const cursor = view.hasFocus ? state.selection.main.head : null;
        // Python は本物の Python でも調べる（字下げ・文法のまちがいを、実行したときと同じ判定で）
        let py: PyIssue[] | null = null;
        if (settings.get("editor.liveCheck") && settings.get("editor.pythonCheck") && checkLangOfState(state) === "python") {
          const text = state.doc.toString();
          const fresh = !cachedPyCheck(text);
          py = await pyCheck(text);
          if (view.state.doc !== state.doc) return [];
          // 自動判定の「実行するとエラー」も描き直す
          if (fresh && py) setTimeout(() => view.dispatch({ effects: inferUpdated.of(null) }));
        }
        const shown = problemsOf(state, cursor, py).filter((p) => !typingLine(state, p));
        // 行の右にも出す（実行時のエラー・実行やコンパイルのエラーは、それぞれの印があるので除く）
        const inline = inlineItems(state, shown.filter((p) => p.kind !== "runtime" || p.msg !== "rt.dynamic"));
        setTimeout(() => {
          if (view.state.doc === state.doc) view.dispatch({ effects: [setInline.of(inline), inferUpdated.of(null)] });
        });
        return shown.map((p) => toDiagnostic(state, p));
      },
      { delay: 700 },
    ),
    Prec.high(keymap.of([{ key: "Mod-.", run: quickFix }])),
    inlineField,
    // ホイールの押し込み（中クリック）で、その行のまちがいを直す
    EditorView.domEventHandlers({
      mousedown(e, view) {
        if (e.button !== 1) return false;
        const pos = view.posAtCoords({ x: e.clientX, y: e.clientY }, false);
        const lineNo = view.state.doc.lineAt(pos).number;
        if (!applyLineFix(view, lineNo, pos)) return false;
        e.preventDefault();
        return true;
      },
      auxclick(e) {
        // Linux の「中クリックで貼り付け」を止める（直したとき）
        if (e.button === 1 && e.defaultPrevented) return true;
        return false;
      },
    }),
    EditorView.updateListener.of((u) => {
      views.add(u.view);
      // 「値を見る」の結果が来たら、実行時のエラーの波線もすぐ出す
      if (u.transactions.some((tr) => tr.effects.some((e) => e.is(setValues)))) forceLinting(u.view);
    }),
  ];
}

/** 補完の候補を選んだとき：名前を入れて、import も足す */
export function insertWithImport(view: EditorView, name: string, line: string, from: number, to: number) {
  const lang = checkLangOfState(view.state);
  if (!lang) return;
  const doc = view.state.doc.toString();
  const without = doc.slice(0, from) + doc.slice(to);
  const e = importEdit(without, lang, lang === "go" ? line.replace(/^import\s+/, "") : line, name);
  const shift = (pos: number) => (pos > from ? pos + (to - from) : pos);
  const changes = view.state.changes([
    { from, to, insert: name },
    { from: shift(e.from), to: shift(e.to), insert: e.insert },
  ]);
  view.dispatch({ changes, selection: { anchor: changes.mapPos(to, 1) }, userEvent: "input.complete" });
}

bus.on("settings:changed", ({ key }) => {
  if (key !== "editor.liveCheck" && key !== "editor.importHelp") return;
  views = new Set([...views].filter((v) => v.dom.isConnected));
  for (const v of views) forceLinting(v);
});
