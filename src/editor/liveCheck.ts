// 書きながらのエラー表示：文法のまちがい・まだ作っていない名前・import の付け忘れに波線を引く。
// 波線にマウスを乗せると直し方のボタンが出る。Ctrl+. でカーソルの行の直し方をすぐ使える。
import { forceLinting, linter, type Action, type Diagnostic } from "@codemirror/lint";
import { language, syntaxTree } from "@codemirror/language";
import { EditorView, keymap } from "@codemirror/view";
import { Prec, type EditorState, type Extension } from "@codemirror/state";
import { checkCode, checkLangByName, checkLangOf, importEdit, type CheckLang, type Fix, type Problem } from "./codeCheck";
import { inferUpdated } from "./checkEvents";
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
        return problemsOf(state, cursor, py)
          .filter((p) => !typingLine(state, p))
          .map((p) => toDiagnostic(state, p));
      },
      { delay: 700 },
    ),
    Prec.high(keymap.of([{ key: "Mod-.", run: quickFix }])),
    EditorView.updateListener.of((u) => {
      views.add(u.view);
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
