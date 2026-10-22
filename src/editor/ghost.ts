// AI のインライン補完（ゴーストテキスト）。
// 入力が止まったら候補を薄く表示し、Tab で確定、Ctrl/Alt+→ で1語ずつ確定、Esc で消す。
import { Prec, StateEffect, StateField, type Extension } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, keymap, type ViewUpdate } from "@codemirror/view";
import { completer } from "../ai/completer";
import { cleanCompletion, shouldComplete } from "../ai/clean";
import { settings } from "../core/settings";

interface Ghost {
  pos: number;
  text: string;
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
        return rest ? { pos: value.pos + typed.length, text: rest } : null;
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
    effects: setGhost.of(rest ? { pos: g.pos + text.length, text: rest } : null),
    userEvent: "input.complete",
  });
  return true;
}

function dismiss(view: EditorView): boolean {
  if (!view.state.field(ghostField, false)) return false;
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
  const prefix = doc.sliceString(Math.max(0, pos - 4000), pos);
  const suffix = doc.sliceString(pos, Math.min(doc.length, pos + 1500));
  if (!shouldComplete(prefix, lineSuffix)) return;

  const multiline = lineSuffix.trim() === "";
  const startDoc = doc;
  const show = (raw: string) => {
    if (view.state.doc !== startDoc || view.state.selection.main.head !== pos) return;
    const text = cleanCompletion(raw, { lineSuffix, suffix, multiline });
    const current = view.state.field(ghostField, false);
    if (!text) {
      if (current) view.dispatch({ effects: setGhost.of(null) });
      return;
    }
    if (current?.text === text) return;
    view.dispatch({ effects: setGhost.of({ pos, text }) });
  };
  const final = await completer.inline({ prefix, suffix }, show);
  if (final !== null) show(final);
}

function schedule(view: EditorView, delay = settings.get("ai.debounceMs")) {
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
      const typed = u.transactions.some((tr) => tr.isUserEvent("input.type") || tr.isUserEvent("delete") || tr.isUserEvent("input.paste"));
      if (u.docChanged && typed) {
        if (!u.state.field(ghostField, false)) {
          completer.cancelInline();
          schedule(u.view);
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
