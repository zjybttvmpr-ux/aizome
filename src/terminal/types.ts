export interface TermView {
  readonly el: HTMLElement;
  readonly cols: number;
  readonly rows: number;
  write(data: string): void;
  onInput(cb: (data: string) => void): void;
  onResize(cb: (cols: number, rows: number) => void): void;
  /** 出力中の "file.py:12" のような場所をクリックできるようにする */
  onFileLink(cb: (path: string, line: number, col: number) => void): void;
  fit(): void;
  focus(): void;
  clear(): void;
  /** 画面に出ている文字の最後の何行か（エラーの説明などに使う） */
  recentText(maxLines?: number): string;
  applyTheme(): void;
  setFontSize(px: number): void;
  dispose(): void;
}
