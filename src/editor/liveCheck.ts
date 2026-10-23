// 書きながらのエラー表示：文法のまちがい・まだ作っていない名前・import の付け忘れに波線を引く。
// 波線にマウスを乗せると直し方のボタンが出る。Ctrl+. でカーソルの行の直し方をすぐ使える。
import { forceLinting, linter, type Action, type Diagnostic } from "@codemirror/lint";
import { syntaxTree } from "@codemirror/language";
import { EditorView, keymap } from "@codemirror/view";
import { Prec, type EditorState, type Extension } from "@codemirror/state";
import { checkCode, checkLangOf, importEdit, type CheckLang, type Problem } from "./codeCheck";
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
  return checkLangOf(d?.ext ?? extname(filenameForLanguage(state.facet(docFilename))));
}

/** 文法のまちがい（自動判定の行の右に出す用）。行番号と短い説明 */
export function syntaxProblems(state: EditorState): { line: number; text: string }[] {
  const lang = checkLangOfState(state);
  if (!lang || state.doc.lines > 8000) return [];
  const list = checkCode(state.doc.toString(), lang, { syntax: true, names: false }).filter((p) => p.kind === "syntax");
  const out: { line: number; text: string }[] = [];
  for (const p of list) {
    const line = state.doc.lineAt(Math.min(p.from, state.doc.length)).number;
    if (out.some((x) => x.line === line)) continue;
    out.push({ line, text: t(p.msg, p.args ?? {}) });
  }
  return out;
}

function problemsOf(state: EditorState, cursor: number | null): Problem[] {
  const lang = checkLangOfState(state);
  const live = settings.get("editor.liveCheck");
  const imports = settings.get("editor.importHelp");
  if (!lang || (!live && !imports) || state.doc.lines > 8000) return [];
  const text = state.doc.toString();
  const all = checkCode(text, lang, { syntax: live, names: true, cursor });
  const out = all.filter((p) => (p.kind === "import" ? imports : live));
  if (live) out.push(...treeErrors(state, out));
  return out;
}

/** 言語の文法（Lezer）が見つけたまちがい。自分で見つけたものと同じ行のものは出さない */
function treeErrors(state: EditorState, found: Problem[]): Problem[] {
  const tree = syntaxTree(state);
  if (tree.length < state.doc.length) return [];
  const own = found.filter((p) => p.kind === "syntax");
  const lines = new Set(own.map((p) => state.doc.lineAt(p.from).number));
  // 自分で原因（かっこの閉じ忘れなど）を見つけたときは、その後ろの「巻き添え」のまちがいは出さない
  const firstOwn = own.length ? Math.min(...own.map((p) => p.from)) : Infinity;
  const out: Problem[] = [];
  tree.iterate({
    enter: (node) => {
      if (!node.type.isError || out.length >= 20) return;
      if (node.from >= firstOwn) return;
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
      (view) => {
        const state = view.state;
        const cursor = view.hasFocus ? state.selection.main.head : null;
        return problemsOf(state, cursor)
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
