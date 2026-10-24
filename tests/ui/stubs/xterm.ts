// 画面確認用：xterm.js の代わりに ANSI 色を少しだけ解釈する簡易表示
export function createTermView(opts: { fontSize: number }) {
  const el = document.createElement("div");
  el.className = "term-view";
  const pre = document.createElement("pre");
  pre.style.cssText = `margin:0;height:100%;overflow:auto;font:${opts.fontSize}px/1.35 var(--font-code);color:var(--text);white-space:pre-wrap`;
  el.append(pre);
  const colors: Record<string, string> = { "36": "var(--ansi-cyan)", "31": "var(--ansi-red)", "2": "var(--text-faint)" };
  let span: HTMLElement = pre;
  return {
    el,
    cols: 100,
    rows: 12,
    write(d: string) {
      for (const part of d.replace(/\r/g, "").split(/(\x1b\[[\d;]*m)/)) {
        const m = /^\x1b\[([\d;]*)m$/.exec(part);
        if (m) {
          if (m[1] === "0" || m[1] === "") span = pre;
          else {
            span = document.createElement("span");
            span.style.color = colors[m[1]] ?? "";
            pre.append(span);
          }
        } else span.append(part);
      }
    },
    onInput() {},
    onResize() {},
    onFileLink() {},
    fit() {},
    focus() {},
    clear() {},
    recentText() { return pre.textContent ?? ""; },
    applyTheme() {},
    setFontSize() {},
    dispose() {},
  };
}
