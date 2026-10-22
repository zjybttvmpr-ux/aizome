// 「値を見る」の結果を、行の右に表示する（編集すると消える）
import { StateEffect, StateField, type EditorState, type Extension } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import type { LineValue } from "../run/trace";

export const setValues = StateEffect.define<Map<number, LineValue> | null>();

class ValueWidget extends WidgetType {
  constructor(readonly v: LineValue) {
    super();
  }
  eq(o: ValueWidget) {
    return o.v.text === this.v.text && o.v.kind === this.v.kind;
  }
  toDOM() {
    const el = document.createElement("span");
    el.className = `cm-value ${this.v.kind}`;
    el.textContent = this.v.text;
    el.title = this.v.detail;
    return el;
  }
  ignoreEvent() {
    return true;
  }
}

interface ValuesState {
  values: Map<number, LineValue>;
  deco: DecorationSet;
}

function decorate(state: EditorState, values: Map<number, LineValue>): DecorationSet {
  const ranges = [...values]
    .filter(([line]) => line >= 1 && line <= state.doc.lines)
    .sort((a, b) => a[0] - b[0])
    .map(([line, v]) => Decoration.widget({ widget: new ValueWidget(v), side: 2 }).range(state.doc.line(line).to));
  return Decoration.set(ranges);
}

export const valuesField = StateField.define<ValuesState>({
  create: () => ({ values: new Map(), deco: Decoration.none }),
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setValues)) {
        const values = e.value ?? new Map();
        return { values, deco: decorate(tr.state, values) };
      }
    }
    // 書き換えたら、記録は古くなるので消す
    if (tr.docChanged && value.values.size) return { values: new Map(), deco: Decoration.none };
    return value;
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
});

/** その行に値を表示しているか（行の説明と重ねないため） */
export function hasValueAt(state: EditorState, line: number): boolean {
  return state.field(valuesField, false)?.values.has(line) ?? false;
}

export function valueLens(): Extension {
  return valuesField;
}
