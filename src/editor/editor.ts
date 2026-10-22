// CodeMirror 6 を使ったエディタ本体。タブごとに EditorState を持ち、表示中の1つを EditorView に載せる。
import { basicSetup } from "codemirror";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { indentUnit, LanguageDescription } from "@codemirror/language";
import {
  copyLineDown,
  deleteLine,
  indentLess,
  indentMore,
  indentWithTab,
  moveLineDown,
  moveLineUp,
  redo,
  selectAll,
  toggleComment,
  undo,
} from "@codemirror/commands";
import { openSearchPanel } from "@codemirror/search";
import { snippet } from "@codemirror/autocomplete";
import { foldAll, unfoldAll } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { editorTheme, syntaxColors } from "./theme";
import { docFilename, ghostText, triggerCompletion } from "./ghost";
import { buildLens } from "./buildLens";
import { lineExplanations } from "./explain";
import { smartCompletion } from "./smartComplete";
import { zenkakuMarks } from "./zenkaku";
import { langTag } from "./langTag";
import { settings } from "../core/settings";
import { filenameForLanguage } from "../core/languages";
import type { EditorAction, EditorHost } from "./types";

interface DocEntry {
  state: EditorState;
  filename: string;
  language: string;
  scrollTop: number;
}

const languageSlot = new Compartment();
const configSlot = new Compartment();
const nameSlot = new Compartment();

function configExtensions(): Extension {
  const size = settings.get("editor.fontSize");
  const tab = settings.get("editor.tabSize");
  return [
    EditorState.tabSize.of(tab),
    indentUnit.of(" ".repeat(tab)),
    EditorView.theme({ "&": { fontSize: `${size}px` } }),
    settings.get("editor.wordWrap") ? EditorView.lineWrapping : [],
  ];
}

function detect(filename: string): LanguageDescription | null {
  return LanguageDescription.matchFilename(languages, filenameForLanguage(filename));
}

class CodeMirrorHost implements EditorHost {
  private view: EditorView | null = null;
  private docs = new Map<string, DocEntry>();
  private activeId: string | null = null;
  private changeListeners: ((id: string) => void)[] = [];
  private cursorListeners: ((p: { line: number; col: number }) => void)[] = [];

  mount(parent: HTMLElement) {
    this.view = new EditorView({
      parent,
      state: EditorState.create({ doc: "" }),
      dispatch: (tr, view) => {
        view.update([tr]);
        if (this.activeId) {
          const entry = this.docs.get(this.activeId);
          if (entry) entry.state = view.state;
          if (tr.docChanged) this.changeListeners.forEach((l) => l(this.activeId!));
        }
        if (tr.selection || tr.docChanged) {
          const pos = this.cursor();
          this.cursorListeners.forEach((l) => l(pos));
        }
      },
    });
    this.view.dom.style.display = "none";
  }

  private extensions(filename = ""): Extension[] {
    return [
      nameSlot.of(docFilename.of(filename)),
      basicSetup,
      keymap.of([indentWithTab]),
      editorTheme,
      syntaxColors,
      ghostText(),
      buildLens(),
      lineExplanations(),
      smartCompletion(),
      zenkakuMarks(),
      langTag(),
      languageSlot.of([]),
      configSlot.of(configExtensions()),
    ];
  }

  private async loadLanguage(id: string, filename: string) {
    const desc = detect(filename);
    const entry = this.docs.get(id);
    if (!entry) return;
    entry.language = desc?.name ?? "Plain Text";
    if (!desc) return;
    try {
      const support = await desc.load();
      const current = this.docs.get(id);
      if (!current) return;
      const effects = languageSlot.reconfigure(support);
      if (this.activeId === id && this.view) {
        this.view.dispatch({ effects });
      } else {
        current.state = current.state.update({ effects }).state;
      }
    } catch (err) {
      console.warn("言語の読み込みに失敗しました", filename, err);
    }
  }

  has(id: string) {
    return this.docs.has(id);
  }

  async open(id: string, text: string, filename: string) {
    if (!this.docs.has(id)) {
      const state = EditorState.create({ doc: text, extensions: this.extensions(filename) });
      this.docs.set(id, { state, filename, language: detect(filename)?.name ?? "Plain Text", scrollTop: 0 });
      void this.loadLanguage(id, filename);
    }
    this.activate(id);
  }

  activate(id: string) {
    const view = this.view;
    const entry = this.docs.get(id);
    if (!view || !entry) return;
    if (this.activeId && this.activeId !== id) {
      const prev = this.docs.get(this.activeId);
      if (prev) prev.scrollTop = view.scrollDOM.scrollTop;
    }
    this.activeId = id;
    view.dom.style.display = "";
    view.setState(entry.state);
    // 開いていない間に変わった設定を反映
    view.dispatch({ effects: configSlot.reconfigure(configExtensions()) });
    requestAnimationFrame(() => {
      view.scrollDOM.scrollTop = entry.scrollTop;
      view.focus();
    });
    const pos = this.cursor();
    this.cursorListeners.forEach((l) => l(pos));
  }

  close(id: string) {
    this.docs.delete(id);
    if (this.activeId === id) {
      this.activeId = null;
      if (this.view) this.view.dom.style.display = "none";
    }
  }

  async rename(oldId: string, newId: string, filename: string) {
    const entry = this.docs.get(oldId);
    if (!entry) return;
    this.docs.delete(oldId);
    entry.filename = filename;
    const effects = nameSlot.reconfigure(docFilename.of(filename));
    if (this.activeId === oldId && this.view) {
      this.view.dispatch({ effects });
      entry.state = this.view.state;
    } else {
      entry.state = entry.state.update({ effects }).state;
    }
    this.docs.set(newId, entry);
    if (this.activeId === oldId) this.activeId = newId;
    await this.loadLanguage(newId, filename);
  }

  peek(id: string, max: number) {
    const state = id === this.activeId && this.view ? this.view.state : this.docs.get(id)?.state;
    return state ? state.doc.sliceString(0, Math.min(max, state.doc.length)) : "";
  }

  getText(id?: string) {
    const key = id ?? this.activeId;
    if (!key) return "";
    if (key === this.activeId && this.view) return this.view.state.doc.toString();
    return this.docs.get(key)?.state.doc.toString() ?? "";
  }

  setText(id: string, text: string) {
    const apply = (state: EditorState) => {
      const head = Math.min(state.selection.main.head, text.length);
      return { changes: { from: 0, to: state.doc.length, insert: text }, selection: { anchor: head } };
    };
    if (id === this.activeId && this.view) {
      this.view.dispatch(apply(this.view.state));
    } else {
      const entry = this.docs.get(id);
      if (entry) entry.state = entry.state.update(apply(entry.state)).state;
    }
  }

  applyText(text: string) {
    if (!this.view || !this.activeId) return;
    const old = this.view.state.doc.toString();
    if (old === text) return;
    let start = 0;
    while (start < old.length && start < text.length && old[start] === text[start]) start++;
    let endOld = old.length;
    let endNew = text.length;
    while (endOld > start && endNew > start && old[endOld - 1] === text[endNew - 1]) {
      endOld--;
      endNew--;
    }
    this.view.dispatch({ changes: { from: start, to: endOld, insert: text.slice(start, endNew) }, userEvent: "input.replace" });
  }

  getSelection() {
    if (!this.view || !this.activeId) return "";
    const s = this.view.state.selection.main;
    return this.view.state.sliceDoc(s.from, s.to);
  }

  replaceSelection(text: string) {
    if (!this.view || !this.activeId) return;
    this.view.dispatch(this.view.state.replaceSelection(text));
  }

  insertText(text: string) {
    if (!this.view || !this.activeId) return;
    const pos = this.view.state.selection.main.head;
    this.view.dispatch({ changes: { from: pos, insert: text }, selection: { anchor: pos + text.length } });
  }

  insertSnippet(template: string) {
    const view = this.view;
    if (!view || !this.activeId) return;
    const sel = view.state.selection.main;
    let from = sel.from;
    let to = sel.to;
    const line = view.state.doc.lineAt(from);
    if (template.includes("\n") && sel.empty && line.text.trim()) {
      // 行の途中に複数行を入れると崩れるので、次の行を作ってそこに入れる
      const indent = /^[ \t]*/.exec(line.text)![0];
      view.dispatch({ changes: { from: line.to, insert: "\n" + indent }, selection: { anchor: line.to + 1 + indent.length } });
      from = to = line.to + 1 + indent.length;
    }
    snippet(template)(view, null, from, to);
    view.focus();
  }

  cursor() {
    if (!this.view || !this.activeId) return { line: 0, col: 0 };
    const head = this.view.state.selection.main.head;
    const line = this.view.state.doc.lineAt(head);
    return { line: line.number, col: head - line.from + 1 };
  }

  goTo(line: number, col = 1) {
    if (!this.view) return;
    const doc = this.view.state.doc;
    const l = doc.line(Math.max(1, Math.min(line, doc.lines)));
    const pos = Math.min(l.to, l.from + Math.max(0, col - 1));
    this.view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
    this.view.focus();
  }

  languageName(id?: string) {
    const key = id ?? this.activeId;
    return key ? this.docs.get(key)?.language ?? "Plain Text" : "";
  }

  focus() {
    this.view?.focus();
  }

  applySettings() {
    this.view?.dispatch({ effects: configSlot.reconfigure(configExtensions()) });
  }

  async run(action: EditorAction): Promise<boolean> {
    const view = this.view;
    if (!view || !this.activeId) return false;
    view.focus();
    const simple: Partial<Record<EditorAction, (v: EditorView) => boolean>> = {
      undo,
      redo,
      selectAll,
      toggleComment,
      duplicateLine: copyLineDown,
      deleteLine,
      moveLineUp,
      moveLineDown,
      indentMore,
      indentLess,
      foldAll,
      unfoldAll,
      find: openSearchPanel,
      replace: (v) => {
        openSearchPanel(v);
        // 置換の入力欄にフォーカスを移す
        requestAnimationFrame(() => v.dom.querySelector<HTMLInputElement>(".cm-search input[name=replace]")?.focus());
        return true;
      },
    };
    const fn = simple[action];
    if (fn) return fn(view);
    const sel = view.state.selection.main;
    const text = view.state.sliceDoc(sel.from, sel.to);
    if (action === "copy" || action === "cut") {
      // 何も選んでいなければ、その行全体を対象にする
      const line = view.state.doc.lineAt(sel.head);
      const target = text || line.text + "\n";
      await navigator.clipboard.writeText(target);
      if (action === "cut") {
        view.dispatch(
          text
            ? { changes: { from: sel.from, to: sel.to, insert: "" } }
            : { changes: { from: line.from, to: Math.min(line.to + 1, view.state.doc.length), insert: "" } },
        );
      }
      return true;
    }
    if (action === "paste") {
      try {
        const clip = await navigator.clipboard.readText();
        view.dispatch(view.state.replaceSelection(clip));
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }

  triggerCompletion() {
    if (this.view && this.activeId) triggerCompletion(this.view);
  }

  onChange(cb: (id: string) => void) {
    this.changeListeners.push(cb);
  }

  onCursor(cb: (p: { line: number; col: number }) => void) {
    this.cursorListeners.push(cb);
  }
}

export function createEditorHost(): EditorHost {
  return new CodeMirrorHost();
}
