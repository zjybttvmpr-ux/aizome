// AI のインライン補完（ゴーストテキスト）。
// 入力が止まったら候補を薄く表示し、Tab で確定、Ctrl/Alt+→ で1語ずつ確定、Esc で消す。
import { Prec, StateEffect, StateField, type Extension } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, keymap, type ViewUpdate } from "@codemirror/view";
import { completer } from "../ai/completer";
import { cleanCompletion, commentIntent, contextKey, isCommentLine, shouldComplete } from "../ai/clean";
import { language } from "@codemirror/language";
import { acceptCompletion, closeCompletion, completionStatus, hasNextSnippetField, startCompletion } from "@codemirror/autocomplete";
import { Facet } from "@codemirror/state";
import { cutAtDedent, fileHeader, languageOf, planCompletion } from "../ai/plan";

/** 開いているファイルの名前（補完で「何語のファイルか」を AI に伝えるため） */
export const docFilename = Facet.define<string, string>({ combine: (v) => v[0] ?? "" });

/** 言語の付いていない文書（テキスト）や Markdown か */
function isProseFile(view: EditorView): boolean {
  const lang = view.state.facet(language);
  const name = lang?.name ?? "";
  return !lang || /markdown|plain/i.test(name);
}
import { settings } from "../core/settings";

interface Ghost {
  pos: number;
  text: string;
  /** 却下されたときに覚えておくためのキー */
  key: string;
}

/** 却下された候補（同じ場所で同じものを出し直さない） */
const rejected = new Set<string>();
function reject(key: string) {
  rejected.add(key);
  if (rejected.size > 300) rejected.delete(rejected.values().next().value as string);
}

const setGhost = StateEffect.define<Ghost | null>();

class GhostWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }
  eq(other: GhostWidget) {
    return other.text === this.text;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-ghost";
    span.textContent = this.text;
    span.setAttribute("aria-hidden", "true");
    return span;
  }
  ignoreEvent() {
    return true;
  }
}

const ghostField = StateField.define<Ghost | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setGhost)) return e.value;
    if (!value) return null;
    if (tr.docChanged) {
      // 候補と同じ文字を打ったら、残りを表示し続ける
      let typed = "";
      let simple = true;
      tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
        if (fromA !== value.pos + typed.length || toA !== fromA) simple = false;
        typed += inserted.toString();
      });
      if (simple && typed && value.text.startsWith(typed)) {
        const rest = value.text.slice(typed.length);
        return rest ? { pos: value.pos + typed.length, text: rest, key: value.key } : null;
      }
      return null;
    }
    if (tr.selection && tr.state.selection.main.head !== value.pos) return null;
    return value;
  },
  provide: (f) =>
    EditorView.decorations.from(f, (g) =>
      g ? Decoration.set([Decoration.widget({ widget: new GhostWidget(g.text), side: 1 }).range(g.pos)]) : Decoration.none,
    ),
});

function accept(view: EditorView, part?: "word"): boolean {
  const g = view.state.field(ghostField, false);
  if (!g) return false;
  let text = g.text;
  if (part === "word") {
    const m = /^\s*[\w$]+|^\s*[^\w\s]+|^\s+/.exec(text);
    text = m ? m[0] : text;
  }
  const rest = g.text.slice(text.length);
  view.dispatch({
    changes: { from: g.pos, insert: text },
    selection: { anchor: g.pos + text.length },
    effects: setGhost.of(rest ? { pos: g.pos + text.length, text: rest, key: g.key } : null),
    userEvent: "input.complete",
  });
  return true;
}

/** 一覧の準備中に Tab が押されたら、出た時点で入力する（その Tab をインデントにしない） */
let acceptWhenReady = 0;

/**
 * Tab キー。
 * 1. 候補の一覧が出ていれば、選んでいる項目を入力
 * 2. AI の候補があれば確定
 * 3. 一覧を準備中なら、出たところで入力
 * 4. 単語の途中や行の途中ではインデントを入れない（一覧を呼ぶだけ）
 * 5. 行の頭（空白だけの前）や範囲を選んでいるときだけ、ふつうのインデント
 */
/** Tab で先に試す処理（エラーの直し方など）。true を返したら Tab はそこで使われる */
export const tabHooks: ((view: EditorView) => boolean)[] = [];

function onTab(view: EditorView): boolean {
  const listKey = settings.get("editor.listKey") === "tab";
  const status = completionStatus(view.state);
  if (listKey && status === "active") return acceptCompletion(view);
  if (accept(view)) return true;
  // ひな形の入力欄を移動しているときは、そちらに任せる
  if (hasNextSnippetField(view.state)) return false;
  for (const hook of tabHooks) if (hook(view)) return true;
  const sel = view.state.selection.main;
  if (!sel.empty) return false;
  const line = view.state.doc.lineAt(sel.head);
  const before = line.text.slice(0, sel.head - line.from);
  if (before.trim() === "") return false; // 行の頭：インデント
  if (listKey) {
    if (status !== "pending") startCompletion(view);
    acceptWhenReady = Date.now();
  }
  return true; // 行の途中ではインデントを入れない
}

const acceptLater = EditorView.updateListener.of((u) => {
  if (!acceptWhenReady) return;
  if (Date.now() - acceptWhenReady > 1500 || u.docChanged) {
    acceptWhenReady = 0;
    return;
  }
  const status = completionStatus(u.state);
  if (status === "active") {
    acceptWhenReady = 0;
    setTimeout(() => acceptCompletion(u.view), 0);
  } else if (status === null && completionStatus(u.startState) === "pending") {
    acceptWhenReady = 0; // 候補がなかった
  }
});

function dismiss(view: EditorView): boolean {
  const g = view.state.field(ghostField, false);
  if (!g) return false;
  reject(g.key);
  view.dispatch({ effects: setGhost.of(null) });
  completer.cancelInline();
  return true;
}

/** 候補を入れたときに、その範囲で文法のまちがい（エラーの印）が出るか */
function hasSyntaxError(state: import("@codemirror/state").EditorState, pos: number, text: string): boolean | null {
  const lang = state.facet(language);
  if (!lang) return null;
  const doc = state.doc;
  // 大きいファイルは前後だけで調べる（速さのため）
  // 字下げのない行から始める（ブロックの途中から読むと、関係ないエラーが出るため）
  let startLine = doc.lineAt(Math.max(0, pos - 4000)).number;
  for (let i = 0; i < 300 && startLine > 1 && !/^\S/.test(doc.line(startLine).text); i++) startLine--;
  const from = doc.line(startLine).from;
  const to = Math.min(doc.length, pos + 2000);
  const src = doc.sliceString(from, pos) + text + doc.sliceString(pos, to);
  let tree;
  try {
    tree = lang.parser.parse(src);
  } catch {
    return null;
  }
  const start = pos - from;
  const end = start + text.length;
  let bad = false;
  tree.iterate({
    from: start,
    to: end,
    enter: (n) => {
      if (bad) return false;
      if (n.type.isError && n.from >= start && n.from < end) bad = true;
      return undefined;
    },
  });
  return bad;
}

/**
 * 複数行の候補を、文法として崩れていない行までに切る。
 * 小さいモデルは後半で崩れやすいので、正しい部分だけを見せる（1 行目は残す）
 */
function trimToValidSyntax(state: import("@codemirror/state").EditorState, pos: number, text: string): string {
  const lines = text.split("\n");
  if (lines.length < 2) return text;
  const whole = hasSyntaxError(state, pos, text);
  if (whole === null || !whole) return text;
  for (let k = lines.length - 1; k >= 1; k--) {
    const part = lines.slice(0, k).join("\n");
    if (hasSyntaxError(state, pos, part) === false) return part;
  }
  return lines[0];
}

let timer: number | undefined;

async function requestCompletion(view: EditorView) {
  const state = view.state;
  const sel = state.selection.main;
  if (!sel.empty) return;
  const pos = sel.head;
  const doc = state.doc;
  const line = doc.lineAt(pos);
  const lineSuffix = doc.sliceString(pos, line.to);
  const linePrefix = doc.sliceString(line.from, pos);
  const intent = commentIntent(doc.sliceString(Math.max(0, pos - 2000), pos));
  // コメントで指示が書かれているときは、前後をより広く見せて長めに書かせる
  const from = Math.max(0, pos - (intent ? 6000 : 4000));
  let prefix = doc.sliceString(from, pos);
  const suffix = doc.sliceString(pos, Math.min(doc.length, pos + 1500));
  if (!shouldComplete(prefix, lineSuffix)) return;

  const plan = planCompletion({
    linePrefix,
    lineSuffix,
    contentBefore: prefix.replace(/\s+/g, "").length,
    intent: !!intent,
    maxTokensSetting: settings.get("ai.maxTokens"),
  });
  // ファイルの先頭から見せているときは「# main.py」のような見出しを付けて、何語のファイルかを伝える
  const header = from === 0 ? fileHeader(view.state.facet(docFilename)) : "";
  if (header && !prefix.startsWith(header.trim())) prefix = header + prefix;

  // Markdown やテキスト、コメントの中では文章の候補も出してよい
  const proseOk = isProseFile(view) || isCommentLine(linePrefix + "xx") || /["'`]/.test(linePrefix) && (linePrefix.split(/["'`]/).length - 1) % 2 === 1;
  const startDoc = doc;
  const show = (raw: string, finished = false) => {
    if (view.state.doc !== startDoc || view.state.selection.main.head !== pos) return;
    let text = cleanCompletion(raw, { lineSuffix, suffix, prefix, multiline: plan.multiline, maxLines: plan.maxLines, proseOk, language: languageOf(view.state.facet(docFilename)), languageFilter: settings.get("ai.languageFilter") });
    text = cutAtDedent(text, plan.stopIndent, plan.allowClosing);
    // 書き終わってから、文法が崩れている行より後ろは捨てる（流れてくる途中では調べない）
    if (finished && text.includes("\n") && settings.get("ai.syntaxTrim")) text = trimToValidSyntax(view.state, pos, text);
    // 1文字だけ、空白だけの候補は出さない
    if (text.trim().length < 2) text = "";
    const key = contextKey(prefix, text);
    const current = view.state.field(ghostField, false);
    if (!text || rejected.has(key)) {
      if (current) view.dispatch({ effects: setGhost.of(null) });
      return;
    }
    if (current?.text === text) return;
    view.dispatch({ effects: setGhost.of({ pos, text, key }) });
  };
  const final = await completer.inline({ prefix, suffix, maxTokens: plan.maxTokens }, (t) => show(t));
  if (final !== null) show(final, true);
}

function schedule(view: EditorView, delay = completer.recommendedDelay()) {
  window.clearTimeout(timer);
  if (!settings.get("ai.enabled")) return;
  timer = window.setTimeout(() => requestCompletion(view), delay);
}

/** AI の候補を表示している位置（なければ null） */
export function ghostPos(state: import("@codemirror/state").EditorState): number | null {
  return state.field(ghostField, false)?.pos ?? null;
}

export function triggerCompletion(view: EditorView) {
  schedule(view, 0);
}

const scheduler = ViewPlugin.fromClass(
  class {
    update(u: ViewUpdate) {
      // 表示していた候補が、確定されずに消えたら「却下」として覚える
      const before = u.startState.field(ghostField, false);
      const after = u.state.field(ghostField, false);
      const accepted = u.transactions.some((tr) => tr.isUserEvent("input.complete"));
      if (before && !after && !accepted && u.docChanged) reject(before.key);

      // 文字入力・改行・貼り付け・削除のあとに補完する（候補の確定そのものは除く）
      const typed = u.transactions.some((tr) => (tr.isUserEvent("input") && !tr.isUserEvent("input.complete")) || tr.isUserEvent("delete"));
      if (u.docChanged && typed) {
        if (!after) {
          completer.cancelInline();
          const pos = u.state.selection.main.head;
          const intent = commentIntent(u.state.doc.sliceString(Math.max(0, pos - 2000), pos));
          schedule(u.view, intent ? 120 : undefined);
        }
      } else if (u.selectionSet && !u.docChanged) {
        window.clearTimeout(timer);
        completer.cancelInline();
      }
    }
    destroy() {
      window.clearTimeout(timer);
    }
  },
);

export function ghostText(): Extension {
  return [
    ghostField,
    scheduler,
    acceptLater,
    Prec.highest(
      keymap.of([
        // 候補の一覧 → AI の候補 → （行の頭だけ）インデント
        { key: "Tab", run: onTab },
        // 一覧が開いていても、AI の候補をまとめて確定する
        { key: "Alt-Enter", run: (v) => (completionStatus(v.state) === "active" && closeCompletion(v), accept(v)) },
        { key: "Mod-ArrowRight", run: (v) => accept(v, "word") },
        { key: "Alt-ArrowRight", run: (v) => accept(v, "word") },
        {
          // 一覧と AI の候補を両方とも閉じる
          key: "Escape",
          run: (v) => {
            const list = completionStatus(v.state) !== null && closeCompletion(v);
            return dismiss(v) || list;
          },
        },
        { key: "Alt-\\", run: (v) => (triggerCompletion(v), true) },
      ]),
    ),
  ];
}
