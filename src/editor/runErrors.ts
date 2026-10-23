// 実行・コンパイルで出たエラー（どの言語でも）を、その行の右に日本語で出す。
// 行を書きかえると、その行のエラーは消える（直したとみなす）
import { RangeSetBuilder, StateEffect, StateField, type EditorState } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import type { ParsedError } from "../run/errorExplain";
import { t } from "../core/i18n";

export interface RunErrorItem extends ParsedError {
  /** その行の頭の位置（書きかえに合わせて動く） */
  pos: number;
}

export const setRunErrors = StateEffect.define<ParsedError[]>();

class RunErrorWidget extends WidgetType {
  constructor(readonly item: RunErrorItem) {
    super();
  }
  eq(o: RunErrorWidget) {
    return o.item.text === this.item.text && o.item.severity === this.item.severity && !!o.item.fix === !!this.item.fix;
  }
  toDOM() {
    const el = document.createElement("span");
    el.className = `cm-value ${this.item.severity === "error" ? "error" : "warn"} cm-run-error`;
    el.textContent = `${this.item.severity === "error" ? "✖" : "⚠"} ${this.item.text}${this.item.fix ? `　${t("rt.tabHint", { to: this.item.fix.to })}` : ""}`;
    el.title = `${this.item.text}${this.item.hint ? "\n" + this.item.hint : ""}\n（${this.item.detail}）`;
    el.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      window.dispatchEvent(new CustomEvent("aizome:problem-menu", { detail: { el, x: e.clientX, y: e.clientY, line: this.item.line } }));
    });
    return el;
  }
  ignoreEvent() {
    return true;
  }
}

function build(state: EditorState, items: RunErrorItem[]): DecorationSet {
  const b = new RangeSetBuilder<Decoration>();
  for (const it of [...items].sort((a, b) => a.pos - b.pos)) {
    if (it.pos > state.doc.length) continue;
    const line = state.doc.lineAt(it.pos);
    b.add(line.to, line.to, Decoration.widget({ widget: new RunErrorWidget(it), side: 3 }));
  }
  return b.finish();
}

export const runErrorsField = StateField.define<{ items: RunErrorItem[]; deco: DecorationSet }>({
  create: () => ({ items: [], deco: Decoration.none }),
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setRunErrors)) {
        const items = e.value
          .filter((x) => x.line >= 1 && x.line <= tr.state.doc.lines)
          .map((x) => ({ ...x, pos: tr.state.doc.line(x.line).from }));
        return { items, deco: build(tr.state, items) };
      }
    }
    if (!tr.docChanged || !value.items.length) return value;
    // 書きかえた行のエラーは消して、ほかは行の位置を合わせる
    const touched = new Set<number>();
    tr.changes.iterChangedRanges((fromA, toA) => {
      const a = tr.startState.doc.lineAt(fromA).number;
      const b = tr.startState.doc.lineAt(Math.min(toA, tr.startState.doc.length)).number;
      for (let n = a; n <= b; n++) touched.add(n);
    });
    const items = value.items
      .filter((it) => !touched.has(tr.startState.doc.lineAt(Math.min(it.pos, tr.startState.doc.length)).number))
      .map((it) => {
        const pos = tr.changes.mapPos(it.pos, -1);
        return { ...it, pos, line: tr.state.doc.lineAt(Math.min(pos, tr.state.doc.length)).number };
      });
    return { items, deco: build(tr.state, items) };
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
});

export function runErrorsAt(state: EditorState): RunErrorItem[] {
  return state.field(runErrorsField, false)?.items ?? [];
}
