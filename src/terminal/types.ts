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
  applyTheme(): void;
  setFontSize(px: number): void;
  dispose(): void;
}
