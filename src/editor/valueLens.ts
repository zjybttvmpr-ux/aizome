// 「値を見る」の結果を、行の右に表示する（編集すると消える）
import { StateEffect, StateField, type EditorState, type Extension } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import type { LineValue, TraceResult } from "../run/trace";
import { sideMode, sideModeChanged } from "./sideMode";

export const setValues = StateEffect.define<{ values: Map<number, LineValue>; raw: TraceResult } | null>();

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
  raw: TraceResult | null;
  deco: DecorationSet;
}

function decorate(state: EditorState, values: Map<number, LineValue>): DecorationSet {
  // 「値」の表示にしているときだけ出す
  if (sideMode() !== "values") return Decoration.none;
  const ranges = [...values]
    .filter(([line]) => line >= 1 && line <= state.doc.lines)
    .sort((a, b) => a[0] - b[0])
    .map(([line, v]) => Decoration.widget({ widget: new ValueWidget(v), side: 2 }).range(state.doc.line(line).to));
  return Decoration.set(ranges);
}

export const valuesField = StateField.define<ValuesState>({
  create: () => ({ values: new Map(), raw: null, deco: Decoration.none }),
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setValues)) {
        const values = e.value?.values ?? new Map();
        return { values, raw: e.value?.raw ?? null, deco: decorate(tr.state, values) };
      }
      if (e.is(sideModeChanged)) return { ...value, deco: decorate(tr.state, value.values) };
    }
    // 書き換えたら、記録は古くなるので消す
    if (tr.docChanged && (value.values.size || value.raw)) return { values: new Map(), raw: null, deco: Decoration.none };
    return value;
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
});

/** その行に値を表示しているか */
export function hasValueAt(state: EditorState, line: number): boolean {
  return sideMode() === "values" && (state.field(valuesField, false)?.values.has(line) ?? false);
}

/** 「値を見る」で記録した生のデータ（マウスを乗せたときの小窓用） */
export function traceAt(state: EditorState): TraceResult | null {
  return state.field(valuesField, false)?.raw ?? null;
}

export function valueLens(): Extension {
  return valuesField;
}
