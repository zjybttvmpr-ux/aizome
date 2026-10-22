// 自動判定モード：実行せずに AI がコード全体を読んで、変数の中身とエラーになりそうな行を予想する。
// - 変数の上にマウスを置いて少し待つと、その行の時点での値を小窓で見せる（値モードでは実行した結果を見せる）
// - エラーになりそうな行には、右に薄く原因を書く
import { Compartment, RangeSetBuilder, StateEffect, type EditorState, type Extension } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, hoverTooltip, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { settings } from "../core/settings";
import { completer } from "../ai/completer";
import { buildInferPrompt, hashText, lookupInferred, parseInfer, staticGuess, type InferResult } from "../ai/infer";
import { docFilename } from "./ghost";
import { forEachView, sideMode, sideModeChanged, trackView } from "./sideMode";
import { bus } from "../core/events";
import { traceAt, traceTimeAt } from "./valueLens";
import { inferBusy, setInferBusy } from "./inferState";

/** AI の予想が新しくなった合図（行の説明もこれで描き直す） */
export const inferUpdated = StateEffect.define<null>();

/** 自動判定でエラーの可能性を出している行（行の説明より優先するため） */
export function riskLines(state: EditorState): Set<number> {
  if (sideMode() !== "auto") return new Set();
  return new Set(resultFor(state)?.risks.map((r) => r.line) ?? []);
}

// ───────── AI の予想（コードごとに覚えておく）
const cache = new Map<string, InferResult>();
let timer: number | undefined;
let cancelRunning: (() => void) | null = null;
let pauseUntil = 0;
function resultFor(state: EditorState): InferResult | null {
  const key = hashText(state.doc.toString());
  return cache.get(key) ?? null;
}

function stop() {
  window.clearTimeout(timer);
  cancelRunning?.();
  cancelRunning = null;
}

function schedule(view: EditorView, delay = 2500) {
  window.clearTimeout(timer);
  if (sideMode() !== "auto" || !settings.get("ai.enabled")) return;
  if (Date.now() < pauseUntil) delay = Math.max(delay, pauseUntil - Date.now());
  timer = window.setTimeout(() => void analyze(view), delay);
}

async function analyze(view: EditorView) {
  if (sideMode() !== "auto") return;
  // 補完を考えている最中は待つ
  if (completer.status === "thinking" || cancelRunning) return schedule(view, 1500);
  const text = view.state.doc.toString();
  if (!text.trim()) return;
  const key = hashText(text);
  if (cache.has(key)) {
    view.dispatch({ effects: inferUpdated.of(null) });
    return;
  }
  let stopped = false;
  setInferBusy(true);
  try {
    const answer = await completer.ask(buildInferPrompt(text, view.state.facet(docFilename)), {
      maxTokens: 1400,
      temperature: 0.1,
      onStart: (cancel) => {
        cancelRunning = () => {
          stopped = true;
          cancel();
        };
      },
    });
    cancelRunning = null;
    if (stopped) return;
    const result = parseInfer(answer, view.state.doc.lines);
    cache.set(key, result);
    while (cache.size > 30) cache.delete(cache.keys().next().value as string);
    view.dispatch({ effects: inferUpdated.of(null) });
  } catch {
    cancelRunning = null;
    pauseUntil = Date.now() + 60_000;
  } finally {
    setInferBusy(false);
  }
}

// ───────── エラーになりそうな行（右に薄く）
class RiskWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }
  eq(o: RiskWidget) {
    return o.text === this.text;
  }
  toDOM() {
    const el = document.createElement("span");
    el.className = "cm-risk";
    el.textContent = `⚠ ${this.text}`;
    el.title = this.text;
    return el;
  }
  ignoreEvent() {
    return true;
  }
}

function buildRisks(state: EditorState): DecorationSet {
  if (sideMode() !== "auto") return Decoration.none;
  const result = resultFor(state);
  if (!result?.risks.length) return Decoration.none;
  const b = new RangeSetBuilder<Decoration>();
  const seen = new Set<number>();
  for (const r of [...result.risks].sort((a, b) => a.line - b.line)) {
    if (seen.has(r.line) || r.line > state.doc.lines) continue;
    seen.add(r.line);
    const line = state.doc.line(r.line);
    b.add(line.to, line.to, Decoration.widget({ widget: new RiskWidget(r.reason), side: 2 }));
  }
  return b.finish();
}

// ───────── 変数の上にマウスを置いたときの小窓
const IDENT = /[A-Za-z_][\w]*/;

function wordAt(state: EditorState, pos: number): { from: number; to: number; text: string } | null {
  const line = state.doc.lineAt(pos);
  const col = pos - line.from;
  const text = line.text;
  let s = col;
  let e = col;
  while (s > 0 && /\w/.test(text[s - 1])) s--;
  while (e < text.length && /\w/.test(text[e])) e++;
  const word = text.slice(s, e);
  if (!word || !IDENT.test(word) || /^\d/.test(word)) return null;
  // キーワードや組み込み関数は対象外
  if (/^(def|class|for|in|if|elif|else|while|return|import|from|as|with|try|except|finally|and|or|not|is|None|True|False|print|input|range|len|int|str|float|list|dict|set|tuple|open|self|lambda|pass|break|continue|global|yield)$/.test(word)) return null;
  return { from: line.from + s, to: line.from + e, text: word };
}

/** 値モード：実行した記録から、その行の時点の値を探す */
function tracedValue(state: EditorState, name: string, lineNo: number): { value: string; from: number } | null {
  const trace = traceAt(state);
  if (!trace) return null;
  const time = traceTimeAt(state);
  // ステップ表示中は、その瞬間までで最後にわかっている値
  if (time !== null) {
    let best: { value: string; from: number; s: number } | null = null;
    for (const [l, e] of Object.entries(trace.lines)) {
      for (const r of e.recs) {
        const s = r.s ?? 0;
        const v = r.c[name] ?? r.r[name];
        if (v !== undefined && s <= time && (!best || s > best.s)) best = { value: v, from: Number(l), s };
      }
    }
    return best;
  }
  for (let l = lineNo; l >= 1; l--) {
    const e = trace.lines[String(l)];
    if (!e) continue;
    for (let i = e.recs.length - 1; i >= 0; i--) {
      const v = e.recs[i].c[name] ?? e.recs[i].r[name];
      if (v !== undefined) return { value: v, from: l };
    }
  }
  return null;
}

function tooltipBox(name: string, lineNo: number, body: string, source: string): HTMLElement {
  const dom = document.createElement("div");
  dom.className = "cm-var-tip";
  const head = document.createElement("div");
  head.className = "cm-var-tip-head";
  head.textContent = `${name}（${lineNo} 行目の時点）`;
  const val = document.createElement("pre");
  val.className = "cm-var-tip-value";
  val.textContent = body;
  const foot = document.createElement("div");
  foot.className = "cm-var-tip-src";
  foot.textContent = source;
  dom.append(head, val, foot);
  return dom;
}

const hoverSource: Parameters<typeof hoverTooltip>[0] = (view, pos) => {
    const mode = sideMode();
    if ((mode !== "auto" && mode !== "values" && mode !== "output") || !settings.get("editor.valueHover")) return null;
    const word = wordAt(view.state, pos);
    if (!word) return null;
    const lineNo = view.state.doc.lineAt(pos).number;
    let body: string | null = null;
    let source = "";
    if (mode === "values" || mode === "output") {
      const v = tracedValue(view.state, word.text, lineNo);
      if (v) {
        body = v.value;
        source = `▸ 実行した結果（${v.from} 行目）`;
      } else if (traceAt(view.state)) {
        body = "（この時点では値がありません）";
        source = "▸ 実行した結果";
      } else {
        body = "「値を見る（F6）」で実行すると、ここに実際の値が出ます";
        source = "";
      }
    } else {
      const inferred = lookupInferred(resultFor(view.state), word.text, lineNo);
      if (inferred && "value" in inferred) {
        body = inferred.value;
        source = `✦ AI の予想（${inferred.from} 行目で入る値）・実行はしていません`;
      } else if (inferred && "later" in inferred) {
        body = `まだ値が入っていません（${inferred.later} 行目で入ります）`;
        source = "✦ AI の予想";
      } else {
        const lines: string[] = [];
        for (let n = 1; n <= lineNo; n++) lines.push(view.state.doc.line(n).text);
        const guess = staticGuess(lines, word.text, lineNo);
        if (!guess) return null;
        body = guess;
        source = inferBusy ? "コードから読み取った見当（AI が考え中…）" : "コードから読み取った見当";
      }
    }
    return {
      pos: word.from,
      end: word.to,
      above: true,
      create: () => ({ dom: tooltipBox(word.text, lineNo, body!, source) }),
    };
};

/** マウスを乗せてから小窓が出るまでの時間は設定で変えられる（変えたらすぐ反映） */
const hoverSlot = new Compartment();
const makeHover = () => hoverTooltip(hoverSource, { hoverTime: Math.max(0, settings.get("editor.hoverDelay") ?? 250) });

bus.on("settings:changed", ({ key }) => {
  if (key === "editor.hoverDelay") forEachView((v) => v.dispatch({ effects: hoverSlot.reconfigure(makeHover()) }));
});

export function autoInfer(): Extension {
  return [
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;
        untrack: () => void;
        constructor(readonly view: EditorView) {
          this.untrack = trackView(view);
          this.decorations = buildRisks(view.state);
          schedule(view, 1500);
        }
        update(u: ViewUpdate) {
          const effects = u.transactions.flatMap((tr) => tr.effects);
          const modeChanged = effects.some((e) => e.is(sideModeChanged));
          if (u.docChanged) stop();
          if (u.docChanged || modeChanged || effects.some((e) => e.is(inferUpdated))) this.decorations = buildRisks(u.state);
          if (u.docChanged || modeChanged) schedule(u.view, modeChanged ? 300 : 2500);
        }
        destroy() {
          this.untrack();
        }
      },
      { decorations: (v) => v.decorations },
    ),
    hoverSlot.of(makeHover()),
  ];
}
