// 変数・関数を Shift+クリック（または F12）で、その定義元へ飛ぶ
import { StateEffect, StateField, type Extension } from "@codemirror/state";
import { Decoration, EditorView, keymap } from "@codemirror/view";
import { settings } from "../core/settings";
import { t } from "../core/i18n";
import { toast } from "../ui/toast";
import { definitionFallback, findDefinition } from "./definition";


// 飛んだ先の行を少しのあいだ光らせる
const flash = StateEffect.define<number | null>();
const flashField = StateField.define({
  create: () => Decoration.none,
  update(deco, tr) {
    for (const e of tr.effects) {
      if (e.is(flash)) {
        if (e.value === null) return Decoration.none;
        const line = tr.state.doc.line(e.value);
        return Decoration.set([Decoration.line({ class: "cm-def-flash" }).range(line.from)]);
      }
    }
    return tr.docChanged ? Decoration.none : deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

function wordAt(view: EditorView, pos: number): string | null {
  const line = view.state.doc.lineAt(pos);
  const text = line.text;
  let s = pos - line.from;
  let e = s;
  while (s > 0 && /[\w$]/.test(text[s - 1])) s--;
  while (e < text.length && /[\w$]/.test(text[e])) e++;
  const w = text.slice(s, e);
  return /^[A-Za-z_$][\w$]*$/.test(w) ? w : null;
}

/** pos にある名前の定義元へ飛ぶ */
export async function goToDefinition(view: EditorView, pos: number): Promise<boolean> {
  const name = wordAt(view, pos);
  if (!name) return false;
  const doc = view.state.doc;
  const fromLine = doc.lineAt(pos).number;
  const lines: string[] = [];
  for (let i = 1; i <= doc.lines; i++) lines.push(doc.line(i).text);
  const hit = findDefinition(lines, name, fromLine);
  if (hit) {
    const line = doc.line(hit.line);
    const at = Math.min(line.to, line.from + hit.col - 1);
    view.dispatch({ selection: { anchor: at, head: at + name.length }, effects: [EditorView.scrollIntoView(at, { y: "center" }), flash.of(hit.line)] });
    window.setTimeout(() => view.dispatch({ effects: flash.of(null) }), 900);
    toast(t(hit.kind === "function" ? "def.jumpedFn" : "def.jumped", { name, line: String(hit.line) }), "info", 2500);
    return true;
  }
  const fallback = definitionFallback();
  if (fallback && (await fallback(name))) return true;
  toast(t("def.notFound", { name }), "info", 3500);
  return false;
}

export function gotoDefinition(): Extension {
  return [
    flashField,
    EditorView.domEventHandlers({
      mousedown(e, view) {
        if (!e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || e.button !== 0 || !settings.get("editor.gotoDefinition")) return false;
        const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
        if (pos === null || !wordAt(view, pos)) return false;
        e.preventDefault();
        void goToDefinition(view, pos);
        return true;
      },
    }),
    keymap.of([
      {
        key: "F12",
        run: (view) => {
          if (!settings.get("editor.gotoDefinition")) return false;
          void goToDefinition(view, view.state.selection.main.head);
          return true;
        },
      },
    ]),
  ];
}
