// 全角スペース・全角記号に印を付ける。
// 日本語入力のまま「（」「：」「＝」や全角スペースを打つとエラーになるので、コードの中（文字列・コメント以外）では赤い波線、
// 全角スペースはどこでも薄い四角で見えるようにする
import { RangeSetBuilder, type Extension } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { settings } from "../core/settings";
import { bus } from "../core/events";
import { t } from "../core/i18n";
import { zenToHan } from "../core/jpText";
import { docFilename } from "./ghost";

/** 全角の文字がふつうに出てくるファイル（文章など）。ここでは全角スペースだけ薄く示す */
const PROSE = new Set([".md", ".markdown", ".txt", ".csv", ".tsv", ".html", ".htm", ".xml", ".svg", ".vue", ".svelte", ".rst", ".tex", ".log", ".adoc"]);

const ZEN = /[　！-～“”‘’￥]/g;
const softSpace = Decoration.mark({ class: "cm-zen-space soft" });

function isProse(filename: string): boolean {
  const i = filename.lastIndexOf(".");
  return i < 0 || PROSE.has(filename.slice(i).toLowerCase());
}

function inStringOrComment(view: EditorView, pos: number): boolean {
  for (let node: ReturnType<ReturnType<typeof syntaxTree>["resolveInner"]> | null = syntaxTree(view.state).resolveInner(pos, 1); node; node = node.parent) {
    if (/String|Comment|Template|Docstring|Heredoc|Char/i.test(node.type.name)) return true;
  }
  return false;
}

const markCache = new Map<string, Decoration>();
function badMark(c: string): Decoration {
  let d = markCache.get(c);
  if (!d) {
    const han = zenToHan(c);
    const title = c === "　" ? t("zenkaku.spaceTitle") : t("zenkaku.title", { c, han });
    d = Decoration.mark({ class: c === "　" ? "cm-zen-space bad" : "cm-zen-bad", attributes: { title } });
    markCache.set(c, d);
  }
  return d;
}

function build(view: EditorView): DecorationSet {
  if (!settings.get("editor.zenkaku")) return Decoration.none;
  const prose = isProse(view.state.facet(docFilename));
  const b = new RangeSetBuilder<Decoration>();
  for (const { from, to } of view.visibleRanges) {
    const text = view.state.doc.sliceString(from, to);
    ZEN.lastIndex = 0;
    for (let m: RegExpExecArray | null; (m = ZEN.exec(text)); ) {
      const pos = from + m.index;
      const c = m[0];
      if (prose || inStringOrComment(view, pos)) {
        if (c === "　") b.add(pos, pos + 1, softSpace);
        continue;
      }
      b.add(pos, pos + 1, badMark(c));
    }
  }
  return b.finish();
}

const views = new Set<EditorView>();

export function zenkakuMarks(): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(readonly view: EditorView) {
        views.add(view);
        this.decorations = build(view);
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.viewportChanged || syntaxTree(u.state) !== syntaxTree(u.startState) || u.transactions.some((tr) => tr.reconfigured)) this.decorations = build(u.view);
      }
      destroy() {
        views.delete(this.view);
      }
    },
    { decorations: (v) => v.decorations },
  );
}

bus.on("settings:changed", ({ key }) => {
  if (key === "editor.zenkaku" || key === "ui.language") {
    markCache.clear();
    for (const v of views) v.dispatch({});
  }
});
