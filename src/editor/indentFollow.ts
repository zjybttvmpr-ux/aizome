// インデントを動かしたあと、Tab で「もともとその下にあった行（ブロックの中身）」もまとめて同じだけ動かす。
// 例：for の行だけ字下げを変えると中身がずれてしまうので、続けて Tab を押すと中身もそろう
import { Prec, StateEffect, StateField, type EditorState, type Extension, type Transaction } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, keymap } from "@codemirror/view";
import { indentString } from "@codemirror/language";
import { settings } from "../core/settings";
import { t } from "../core/i18n";

interface Pending {
  /** 字下げを変えた行（1 から） */
  line: number;
  /** 最初の字下げ（桁） */
  original: number;
  /** 今の字下げとの差（桁） */
  delta: number;
  /** 一緒に動かす行の範囲（1 から） */
  from: number;
  to: number;
}

const clear = StateEffect.define<null>();

function cols(text: string, tabSize: number): number {
  let n = 0;
  for (const ch of /^[ \t]*/.exec(text)![0]) n = ch === "\t" ? n + tabSize - (n % tabSize) : n + 1;
  return n;
}

/** 1 行の行頭の空白だけを変えた変更か。そうならその行番号 */
function indentOnlyChange(tr: Transaction): number | null {
  if (!tr.docChanged) return null;
  let lineNo: number | null = null;
  let ok = true;
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    if (!ok) return;
    const line = tr.startState.doc.lineAt(fromA);
    const lead = /^[ \t]*/.exec(line.text)![0].length;
    if (toA > line.from + lead || (lineNo !== null && lineNo !== line.number) || !/^[ \t]*$/.test(inserted.toString())) {
      ok = false;
      return;
    }
    lineNo = line.number;
  });
  return ok ? lineNo : null;
}

/** 古い文書で、その行の下にある「より深い字下げ」の行のかたまり */
function blockBelow(state: EditorState, lineNo: number, indent: number): { from: number; to: number } | null {
  const doc = state.doc;
  const ts = state.tabSize;
  let last = 0;
  for (let n = lineNo + 1; n <= doc.lines; n++) {
    const text = doc.line(n).text;
    if (!text.trim()) continue;
    if (cols(text, ts) <= indent) break;
    last = n;
  }
  return last ? { from: lineNo + 1, to: last } : null;
}

const pendingField = StateField.define<Pending | null>({
  create: () => null,
  update(value, tr) {
    if (tr.effects.some((e) => e.is(clear))) return null;
    if (!settings.get("editor.indentFollow")) return null;
    const lineNo = indentOnlyChange(tr);
    if (lineNo !== null) {
      const ts = tr.state.tabSize;
      const now = cols(tr.state.doc.line(lineNo).text, ts);
      // 同じ行の字下げを続けて変えているときは、最初の字下げからの差にする
      if (value && value.line === lineNo) return { ...value, delta: now - value.original };
      const before = cols(tr.startState.doc.line(lineNo).text, ts);
      const block = blockBelow(tr.startState, lineNo, before);
      if (!block || now === before) return null;
      return { line: lineNo, original: before, delta: now - before, from: block.from, to: block.to };
    }
    if (tr.docChanged) return null;
    // カーソルがほかの行へ行ったら終わり
    if (value && tr.selection && tr.state.doc.lineAt(tr.state.selection.main.head).number !== value.line) return null;
    return value;
  },
});

class HintWidget extends WidgetType {
  constructor(readonly n: number) {
    super();
  }
  eq(o: HintWidget) {
    return o.n === this.n;
  }
  toDOM() {
    const el = document.createElement("span");
    el.className = "cm-indent-hint";
    el.textContent = t("indent.hint", { n: String(this.n) });
    return el;
  }
  ignoreEvent() {
    return true;
  }
}

const hint = EditorView.decorations.compute([pendingField], (state) => {
  const p = state.field(pendingField, false);
  if (!p || p.delta === 0 || p.line > state.doc.lines) return Decoration.none;
  const line = state.doc.line(p.line);
  return Decoration.set([Decoration.widget({ widget: new HintWidget(p.to - p.from + 1), side: 1 }).range(line.to)]);
});

/** 一緒に動かす（Tab） */
export function applyIndentFollow(view: EditorView): boolean {
  const p = view.state.field(pendingField, false);
  if (!p || p.delta === 0) return false;
  const doc = view.state.doc;
  const ts = view.state.tabSize;
  const changes: { from: number; to: number; insert: string }[] = [];
  for (let n = p.from; n <= Math.min(p.to, doc.lines); n++) {
    const line = doc.line(n);
    if (!line.text.trim()) continue;
    const lead = /^[ \t]*/.exec(line.text)![0];
    const next = Math.max(0, cols(line.text, ts) + p.delta);
    changes.push({ from: line.from, to: line.from + lead.length, insert: indentString(view.state, next) });
  }
  view.dispatch({ changes, effects: clear.of(null), userEvent: "input.indent" });
  return true;
}

export function indentFollow(): Extension {
  return [
    pendingField,
    hint,
    Prec.highest(
      keymap.of([
        { key: "Tab", run: applyIndentFollow },
        { key: "Escape", run: (v) => (v.state.field(pendingField, false) ? (v.dispatch({ effects: clear.of(null) }), true) : false) },
      ]),
    ),
  ];
}
