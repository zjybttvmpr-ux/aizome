// エディタ本体の公開インターフェース。UI や拡張機能はこの型だけに依存する。

export type EditorAction =
  | "undo"
  | "redo"
  | "cut"
  | "copy"
  | "paste"
  | "selectAll"
  | "find"
  | "replace"
  | "toggleComment"
  | "duplicateLine"
  | "deleteLine"
  | "moveLineUp"
  | "moveLineDown"
  | "indentMore"
  | "indentLess"
  | "foldAll"
  | "unfoldAll";

export interface EditorHost {
  mount(parent: HTMLElement): void;
  /** 未作成ならドキュメントを作ってから表示する */
  open(id: string, text: string, filename: string): Promise<void>;
  has(id: string): boolean;
  activate(id: string): void;
  close(id: string): void;
  rename(oldId: string, newId: string, filename: string): Promise<void>;
  getText(id?: string): string;
  /** 先頭から max 文字だけ（大きいファイルでも速い） */
  peek(id: string, max: number): string;
  /** 中身をまるごと置き換える（カーソル位置はできるだけ保つ） */
  setText(id: string, text: string): void;
  /** 表示中のファイルの中身を書き換える（変わった部分だけ置き換えるので、カーソルや元に戻すが自然） */
  applyText(text: string): void;
  getSelection(): string;
  replaceSelection(text: string): void;
  insertText(text: string): void;
  /**
   * ひな形を入れる（${名前} の場所を Tab で順に書き換えられる）。
   * 複数行のひな形で、カーソルの行に文字があるときは、次の行に入れる
   */
  insertSnippet(template: string): void;
  /** 「値を見る」の結果を行の右に出す（null で消す） */
  showValues(id: string, data: { values: Map<number, import("../run/trace").LineValue>; raw: import("../run/trace").TraceResult; time?: number | null } | null): void;
  cursor(): { line: number; col: number };
  goTo(line: number, col?: number): void;
  languageName(id?: string): string;
  focus(): void;
  /** フォントサイズなどの設定を反映する */
  applySettings(): void;
  /** 編集メニューなどからの操作。できなかったら false */
  run(action: EditorAction): Promise<boolean>;
  /** AI 補完をすぐに要求する */
  triggerCompletion(): void;
  onChange(cb: (id: string) => void): void;
  onCursor(cb: (pos: { line: number; col: number }) => void): void;
}
