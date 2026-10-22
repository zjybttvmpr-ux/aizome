// ###構築py### の行の右端に「▶ 組み立てる」ボタンを出す
import { RangeSetBuilder, type Extension } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { commands, formatKey } from "../core/commands";
import { t } from "../core/i18n";
import { START_MARK, findLanguage } from "../ai/jpBuild";

class BuildButton extends WidgetType {
  constructor(readonly line: number, readonly lang: string) {
    super();
  }
  eq(other: BuildButton) {
    return other.line === this.line && other.lang === this.lang;
  }
  toDOM() {
    const btn = document.createElement("button");
    btn.className = "cm-build-btn";
    btn.type = "button";
    btn.textContent = `▶ ${t("build.button")}${this.lang ? `（${this.lang}）` : ""}`;
    btn.title = `${t("build.buttonTitle")} (${formatKey("Mod-Shift-Enter")})`;
    btn.addEventListener("mousedown", (e) => e.preventDefault());
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      void commands.execute("ai.build", this.line);
    });
    return btn;
  }
  ignoreEvent() {
    return true;
  }
}

const markLine = Decoration.line({ class: "cm-build-mark" });

function build(view: EditorView): DecorationSet {
  const b = new RangeSetBuilder<Decoration>();
  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = view.state.doc.lineAt(pos);
      const m = START_MARK.exec(line.text);
      if (m) {
        const lang = findLanguage(m[1])?.name.split(/[ （(]/)[0] ?? (m[1] ? m[1] : "");
        b.add(line.from, line.from, markLine);
        b.add(line.to, line.to, Decoration.widget({ widget: new BuildButton(line.number, lang), side: 1 }));
      }
      pos = line.to + 1;
    }
  }
  return b.finish();
}

export function buildLens(): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = build(view);
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.viewportChanged) this.decorations = build(u.view);
      }
    },
    { decorations: (v) => v.decorations },
  );
}
