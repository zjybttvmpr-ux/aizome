// 行の右に何を出すか：説明（何をする行か）／値（「値を見る」で実行した結果）／自動判定（AI の予想とエラーの可能性）／なし
import { StateEffect } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { settings } from "../core/settings";
import { bus } from "../core/events";

export type SideMode = "explain" | "values" | "auto" | "off";

export function sideMode(): SideMode {
  return settings.get("editor.sideView");
}

/** 表示を切り替えたときに、各部品に描き直してもらうための合図 */
export const sideModeChanged = StateEffect.define<SideMode>();

const views = new Set<EditorView>();
export function trackView(view: EditorView): () => void {
  views.add(view);
  return () => views.delete(view);
}

export function forEachView(cb: (view: EditorView) => void) {
  views.forEach(cb);
}

/** 表示に関わるオン・オフを変えたら、エディタを描き直す */
const REDRAW = new Set(["editor.sideView", "editor.buildLens", "editor.langTag", "files.langDirective", "editor.valueHover"]);

bus.on("settings:changed", ({ key }) => {
  if (!REDRAW.has(key)) return;
  const mode = sideMode();
  for (const v of views) v.dispatch({ effects: sideModeChanged.of(mode) });
});
