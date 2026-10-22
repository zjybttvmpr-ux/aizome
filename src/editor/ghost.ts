// AI のインライン補完（ゴーストテキスト）。
// 入力が止まったら候補を薄く表示し、Tab で確定、Ctrl/Alt+→ で1語ずつ確定、Esc で消す。
import { Prec, StateEffect, StateField, type Extension } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, keymap, type ViewUpdate } from "@codemirror/view";
import { completer } from "../ai/completer";
import { cleanCompletion, commentIntent, contextKey, isCommentLine, shouldComplete } from "../ai/clean";
import { language } from "@codemirror/language";
import { Facet } from "@codemirror/state";
import { cutAtDedent, fileHeader, planCompletion } from "../ai/plan";

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

function dismiss(view: EditorView): boolean {
  const g = view.state.field(ghostField, false);
  if (!g) return false;
  reject(g.key);
  view.dispatch({ effects: setGhost.of(null) });
  completer.cancelInline();
  return true;
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
  const show = (raw: string) => {
    if (view.state.doc !== startDoc || view.state.selection.main.head !== pos) return;
    let text = cleanCompletion(raw, { lineSuffix, suffix, prefix, multiline: plan.multiline, maxLines: plan.maxLines, proseOk });
    text = cutAtDedent(text, plan.stopIndent, plan.allowClosing);
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
  const final = await completer.inline({ prefix, suffix, maxTokens: plan.maxTokens }, show);
  if (final !== null) show(final);
}

function schedule(view: EditorView, delay = completer.recommendedDelay()) {
  window.clearTimeout(timer);
  if (!settings.get("ai.enabled")) return;
  timer = window.setTimeout(() => requestCompletion(view), delay);
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
    Prec.highest(
      keymap.of([
        { key: "Tab", run: (v) => accept(v) },
        { key: "Mod-ArrowRight", run: (v) => accept(v, "word") },
        { key: "Alt-ArrowRight", run: (v) => accept(v, "word") },
        { key: "Escape", run: dismiss },
        { key: "Alt-\\", run: (v) => (triggerCompletion(v), true) },
      ]),
    ),
  ];
}
