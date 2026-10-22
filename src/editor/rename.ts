// 名前の一括変更：カーソルのある変数・関数の名前を、そのファイル内でまとめて変える。
// 文字列・コメントの中と、「obj.名前」のような別のものの属性は変えない
import type { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";

const IDENT = /[A-Za-z_$À-￿][\w$À-￿]*/;

export function symbolAt(state: EditorState, pos: number): { from: number; to: number; name: string } | null {
  const line = state.doc.lineAt(pos);
  const text = line.text;
  let s = pos - line.from;
  let e = s;
  const word = /[\w$À-￿]/;
  while (s > 0 && word.test(text[s - 1])) s--;
  while (e < text.length && word.test(text[e])) e++;
  const name = text.slice(s, e);
  if (!name || !IDENT.test(name) || /^\d/.test(name)) return null;
  return { from: line.from + s, to: line.from + e, name };
}

function inStringOrComment(state: EditorState, pos: number): boolean {
  for (let n: ReturnType<ReturnType<typeof syntaxTree>["resolveInner"]> | null = syntaxTree(state).resolveInner(pos, 1); n; n = n.parent) {
    if (/String|Comment|Docstring|Template(?!Expression)|Char/i.test(n.type.name)) return true;
  }
  return false;
}

/** ファイル内のその名前の出てくる場所（変えてよいものだけ） */
export function occurrences(state: EditorState, name: string): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?<![\\w$\\u00C0-\\uFFFF])${esc}(?![\\w$\\u00C0-\\uFFFF])`, "g");
  const text = state.doc.toString();
  for (let m: RegExpExecArray | null; (m = re.exec(text)); ) {
    const from = m.index;
    // obj.name（別のものの属性）は変えない
    let i = from - 1;
    while (i >= 0 && (text[i] === " " || text[i] === "\t")) i--;
    if (text[i] === "." && !(text[i - 1] === "." )) continue;
    if (inStringOrComment(state, from)) continue;
    out.push({ from, to: from + name.length });
  }
  return out;
}

/** まとめて変える。変えた数を返す */
export function renameAll(view: EditorView, name: string, next: string): number {
  const occ = occurrences(view.state, name);
  if (!occ.length) return 0;
  view.dispatch({ changes: occ.map((o) => ({ from: o.from, to: o.to, insert: next })), userEvent: "input.rename" });
  return occ.length;
}
