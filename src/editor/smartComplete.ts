// 入力中に下に出る「候補の一覧」を賢くする。
// - 打った文字で「始まる」ものだけ（im で RuntimeError が出るようなあいまい一致はしない）
// - 文の頭ではキーワードを先に、例外クラス（〜Error）は except / raise のときだけ上に
// - このファイルで使っている名前を優先し、言語の候補がない言語でも単語で補える
// - import の後ろではモジュール名、`import numpy as` の後ろでは np のような定番の略称
import {
  autocompletion,
  completeFromList,
  type Completion,
  type CompletionContext,
  type CompletionResult,
  type CompletionSource,
} from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";
import { settings } from "../core/settings";
import { docFilename } from "./ghost";

const PY_MODULES = [
  "os", "sys", "re", "math", "random", "time", "datetime", "json", "csv", "pathlib", "itertools", "functools", "collections",
  "typing", "dataclasses", "subprocess", "shutil", "glob", "argparse", "logging", "threading", "asyncio", "statistics",
  "string", "copy", "pickle", "sqlite3", "urllib", "http", "socket", "hashlib", "base64", "decimal", "fractions",
  "tkinter", "turtle", "unittest", "textwrap", "enum", "abc", "io", "zipfile", "tempfile", "heapq", "bisect", "pprint",
  "numpy", "pandas", "matplotlib", "matplotlib.pyplot", "scipy", "sklearn", "requests", "flask", "django", "fastapi",
  "pygame", "PIL", "cv2", "torch", "tensorflow", "seaborn", "bs4", "openpyxl", "pytest", "yaml", "tqdm",
];
const PY_ALIASES: Record<string, string> = {
  numpy: "np", pandas: "pd", "matplotlib.pyplot": "plt", seaborn: "sns", tensorflow: "tf", tkinter: "tk",
  "tkinter.ttk": "ttk", datetime: "dt", networkx: "nx", "plotly.express": "px", polars: "pl",
};
const EXCEPTION = /(Error|Exception|Warning|Exit|Interrupt|Iteration)$/;

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i).toLowerCase() : "";
}

/** ファイルの中の名前と、出てくる回数（大きいファイルは先頭だけ） */
const wordCache = new WeakMap<object, Map<string, number>>();
function docWords(ctx: CompletionContext): Map<string, number> {
  const doc = ctx.state.doc;
  const hit = wordCache.get(doc);
  if (hit) return hit;
  const text = doc.sliceString(0, Math.min(doc.length, 200_000));
  const words = new Map<string, number>();
  for (const m of text.matchAll(/[A-Za-z_$][\w$]{2,}/g)) words.set(m[0], (words.get(m[0]) ?? 0) + 1);
  wordCache.set(doc, words);
  return words;
}

async function languageResults(ctx: CompletionContext): Promise<CompletionResult[]> {
  const sources = ctx.state.languageDataAt<CompletionSource | readonly (string | Completion)[]>("autocomplete", ctx.pos);
  const results = await Promise.all(
    sources.map(async (s) => {
      try {
        return await (typeof s === "function" ? s(ctx) : completeFromList(s)(ctx));
      } catch {
        return null;
      }
    }),
  );
  return results.filter((r): r is CompletionResult => !!r);
}

async function smartSource(ctx: CompletionContext): Promise<CompletionResult | null> {
  const mode = settings.get("editor.suggestList");
  if (mode === "off" && !ctx.explicit) return null;
  const filename = ctx.state.facet(docFilename);
  const ext = extOf(filename);
  const python = ext === ".py" || ext === ".pyw";
  const line = ctx.state.doc.lineAt(ctx.pos);
  const before = line.text.slice(0, ctx.pos - line.from);

  if (python) {
    // import の後ろ：モジュール名
    const imp = /^\s*(?:import|from)\s+([\w.]*)$/.exec(before);
    if (imp) {
      const from = ctx.pos - imp[1].length;
      const used = [...ctx.state.doc.toString().matchAll(/^\s*(?:import|from)\s+([\w.]+)/gm)].map((m) => m[1]);
      const all = [...new Set([...used, ...PY_MODULES])];
      return {
        from,
        options: all.map((name, i) => ({ label: name, type: "namespace", boost: used.includes(name) ? 10 : -i / 100 })),
        validFor: /^[\w.]*$/,
      };
    }
    // import numpy as ▮ → np
    const as = /^\s*import\s+([\w.]+)\s+as\s+(\w*)$/.exec(before);
    if (as) {
      const alias = PY_ALIASES[as[1]];
      return alias ? { from: ctx.pos - as[2].length, options: [{ label: alias, type: "variable", boost: 50 }] } : null;
    }
  }

  const word = ctx.matchBefore(/[A-Za-z_$][\w$]*/);
  // 1 文字だけでは出さない（Ctrl+Space で呼んだときは別）
  if (!ctx.explicit && (!word || word.to - word.from < 2)) return null;
  // コメントの中では出さない
  if (!ctx.explicit && /^\s*(#|\/\/|--|;)/.test(before)) return null;
  const from = word ? word.from : ctx.pos;
  const typed = word ? word.text : "";

  const statementStart = before.slice(0, from - line.from).trim() === "";
  const wantsException = /\b(except|raise|catch|throw|throws|isinstance)\b/.test(before);
  const words = docWords(ctx);

  const seen = new Set<string>();
  const labels = new Set<string>();
  const options: Completion[] = [];
  for (const r of await languageResults(ctx)) {
    if (r.from !== from) continue;
    for (const o of r.options) {
      if (o.label === typed || seen.has(o.label + "\u0000" + (o.detail ?? ""))) continue;
      seen.add(o.label + "\u0000" + (o.detail ?? ""));
      labels.add(o.label);
      let boost = o.boost ?? 0;
      if (o.label.startsWith("_") && !typed.startsWith("_")) boost -= 40;
      if (EXCEPTION.test(o.label) && (o.type === "class" || o.type === "type")) boost += wantsException ? 15 : -30;
      if (statementStart && o.type === "keyword") boost += 6;
      if (!statementStart && o.type === "keyword" && /statement|block/.test(o.detail ?? "")) boost -= 10;
      const n = words.get(o.label);
      if (n) boost += Math.min(8, 2 + n);
      options.push(boost === (o.boost ?? 0) ? o : { ...o, boost });
    }
  }
  // このファイルの単語（言語の候補にないもの）
  for (const [w, n] of words) {
    if (w === typed || !w.toLowerCase().startsWith(typed.toLowerCase())) continue;
    if (labels.has(w)) continue;
    options.push({ label: w, type: "text", boost: Math.min(4, n) - 2 });
  }
  if (!options.length) return null;
  return { from, options, validFor: /^[\w$]*$/ };
}

export function smartCompletion(): Extension {
  return autocompletion({ override: [smartSource], filterStrict: true, maxRenderedOptions: 40 });
}
