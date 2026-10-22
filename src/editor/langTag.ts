// 1 行目の「## py ##」「## C# ##」に、「← Python として扱います」と小さく添える
import { RangeSetBuilder, type Extension } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { parseDirective } from "../core/langDirective";
import { t } from "../core/i18n";

class TagWidget extends WidgetType {
  constructor(readonly label: string) {
    super();
  }
  eq(o: TagWidget) {
    return o.label === this.label;
  }
  toDOM() {
    const el = document.createElement("span");
    el.className = "cm-lang-tag";
    el.textContent = t("lang.tag", { name: this.label });
    return el;
  }
  ignoreEvent() {
    return true;
  }
}

const lineMark = Decoration.line({ class: "cm-lang-directive" });

function build(view: EditorView): DecorationSet {
  const line = view.state.doc.line(1);
  const choice = parseDirective(line.text);
  if (!choice) return Decoration.none;
  const b = new RangeSetBuilder<Decoration>();
  b.add(line.from, line.from, lineMark);
  b.add(line.to, line.to, Decoration.widget({ widget: new TagWidget(choice.label), side: 1 }));
  return b.finish();
}

export function langTag(): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = build(view);
      }
      update(u: ViewUpdate) {
        if (u.docChanged) this.decorations = build(u.view);
      }
    },
    { decorations: (v) => v.decorations },
  );
}
