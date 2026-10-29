// 印刷・書き出しの専用画面：左で形式や用紙を選び、右で「出力するとこうなる」をページごとに見られる
import { h, clear } from "../core/dom";
import { t } from "../core/i18n";
import { settings } from "../core/settings";
import { icon } from "./icons";
import { defaultExportOptions, exportBody, exportCss, exportMarkdown, exportText, PAPER_MM, type ExportFormat, type ExportOptions, type Seg } from "./exportCode";

export interface PrintScreenOptions {
  name: string;
  path: string;
  lines: Seg[][];
  tab: number;
  /** 印刷から開いたか（最初に選ぶ形式が「印刷・PDF」になる） */
  mode: "print" | "export";
  onPrint: (o: ExportOptions) => Promise<void> | void;
  onExport: (o: ExportOptions) => Promise<boolean> | boolean;
}

const MM = 96 / 25.4;
/** exportCss の @page と同じ余白（上・右・下・左） */
const MARGIN = [16, 14, 16, 14];
const MAX_PAGES = 60;

let openRoot: HTMLElement | null = null;

export function openPrintScreen(opts: PrintScreenOptions) {
  openRoot?.remove();
  const o: ExportOptions = { ...defaultExportOptions() };
  if (opts.mode === "print") o.format = "pdf";
  const meta = { name: opts.name, path: opts.path, date: new Date().toLocaleString() };

  // ───── 左：設定
  const seg = <T extends string>(value: () => T, items: [T, string][], set: (v: T) => void) => {
    const box = h("div", { class: "ps-seg", role: "radiogroup" });
    const render = () => {
      clear(box);
      for (const [v, label] of items) {
        box.append(
          h(
            "button",
            {
              type: "button",
              class: "ps-seg-item" + (value() === v ? " on" : ""),
              role: "radio",
              "aria-checked": String(value() === v),
              onclick: () => {
                set(v);
                render();
                changed();
              },
            },
            label,
          ),
        );
      }
    };
    render();
    return box;
  };
  const check = (key: "lineNumbers" | "colors" | "header" | "pageNumbers" | "wrap", label: string) => {
    const box = h("input", { type: "checkbox", class: "switch", checked: o[key] }) as HTMLInputElement;
    box.addEventListener("change", () => {
      o[key] = box.checked;
      changed();
    });
    return h("label", { class: "export-check" }, box, h("span", {}, label));
  };
  const paperChecks: HTMLElement[] = [];
  const paperOnly = (el: HTMLElement) => (paperChecks.push(el), el);
  const row = (label: string, ...control: HTMLElement[]) => h("div", { class: "ps-row" }, h("div", { class: "ps-label" }, label), ...control);

  const formatSeg = seg<ExportFormat>(
    () => o.format,
    [
      ["pdf", t("ps.fmt.print")],
      ["docx", "Word"],
      ["html", "HTML"],
      ["txt", t("ps.fmt.txt")],
      ["md", "Markdown"],
    ],
    (v) => (o.format = v),
  );
  const paperSeg = seg<ExportOptions["paper"]>(() => o.paper, [["A4", "A4"], ["B5", "B5"], ["A3", "A3"], ["Letter", "Letter"]], (v) => (o.paper = v));
  const orientSeg = seg<"p" | "l">(() => (o.landscape ? "l" : "p"), [["p", t("ps.portrait")], ["l", t("ps.landscape")]], (v) => (o.landscape = v === "l"));
  const sizeSeg = seg<string>(() => String(o.fontSize), ["8", "9", "10", "11", "12", "14"].map((v) => [v, v] as [string, string]), (v) => (o.fontSize = Number(v)));
  const pageRows = [row(t("export.paper"), paperSeg), row(t("ps.orientation"), orientSeg), row(t("ps.fontSizePt"), sizeSeg)];
  const note = h("p", { class: "ps-note" });
  const goBtn = h("button", { class: "btn primary ps-go", type: "button" }) as HTMLButtonElement;
  const left = h(
    "div",
    { class: "ps-side" },
    row(t("export.format"), formatSeg),
    ...pageRows,
    h(
      "div",
      { class: "ps-checks" },
      check("lineNumbers", t("export.lineNumbers")),
      paperOnly(check("colors", t("export.colors"))),
      check("header", t("export.header")),
      paperOnly(check("pageNumbers", t("export.pageNumbers"))),
      paperOnly(check("wrap", t("export.wrap"))),
    ),
    note,
    h("div", { class: "ps-spacer" }),
    goBtn,
  );

  // ───── 右：プレビュー（ページの形のまま）
  const info = h("span", { class: "ps-info" });
  const zoomSel = h(
    "select",
    { class: "select ps-zoom", "aria-label": t("ps.zoom") },
    h("option", { value: "fit" }, t("ps.zoomFit")),
    h("option", { value: "0.5" }, "50%"),
    h("option", { value: "0.75" }, "75%"),
    h("option", { value: "1" }, "100%"),
  ) as HTMLSelectElement;
  const host = h("div", { class: "ps-preview-host" });
  const shadow = host.attachShadow({ mode: "open" });
  const area = h("div", { class: "ps-preview" }, host);
  const right = h("div", { class: "ps-main" }, h("div", { class: "ps-toolbar" }, info, h("span", { class: "ps-spacer" }), zoomSel), area);

  const close = () => {
    root.remove();
    document.removeEventListener("keydown", onKey, true);
    if (openRoot === root) openRoot = null;
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };
  const root = h(
    "div",
    { class: "ps-root", role: "dialog", "aria-modal": "true", "aria-label": t("ps.title") },
    h(
      "header",
      { class: "ps-head" },
      h("span", { class: "ps-head-icon", html: icon("file", 16) }),
      h("h2", { class: "ps-title" }, t("ps.title")),
      h("span", { class: "ps-file" }, opts.name),
      h("span", { class: "ps-spacer" }),
      h("button", { class: "icon-btn", type: "button", title: `${t("common.close")} (Esc)`, "aria-label": t("common.close"), html: icon("x", 16), onclick: close }),
    ),
    h("div", { class: "ps-body" }, left, right),
  );
  openRoot = root;
  document.body.append(root);
  document.addEventListener("keydown", onKey, true);

  goBtn.addEventListener("click", async () => {
    settings.set("export.options", { ...o } as never);
    if (o.format === "pdf") {
      close();
      await opts.onPrint({ ...o });
      return;
    }
    goBtn.disabled = true;
    try {
      if (await opts.onExport({ ...o })) close();
    } finally {
      goBtn.disabled = false;
    }
  });
  zoomSel.addEventListener("change", () => applyZoom());

  let pagesBox: HTMLElement | null = null;
  let pageWidthPx = 0;
  const applyZoom = () => {
    if (!pagesBox) return;
    const z = zoomSel.value === "fit" ? Math.min(1, Math.max(0.2, (area.clientWidth - 48) / pageWidthPx)) : Number(zoomSel.value);
    pagesBox.style.zoom = String(z);
  };
  new ResizeObserver(() => applyZoom()).observe(area);

  let timer = 0;
  function changed() {
    const paged = o.format !== "txt" && o.format !== "md";
    for (const r of pageRows) r.hidden = !paged;
    // 色・ページ番号・折り返しは、紙の形（印刷・Word・HTML）のときだけ
    for (const el of paperChecks) el.hidden = !paged;
    note.textContent = t(`export.note.${o.format}`);
    goBtn.textContent = o.format === "pdf" ? t("ps.goPrint") : t("ps.goExport", { fmt: o.format === "docx" ? "Word" : o.format === "html" ? "HTML" : o.format === "md" ? "Markdown" : t("ps.fmt.txt") });
    settings.set("export.options", { ...o } as never);
    window.clearTimeout(timer);
    timer = window.setTimeout(render, 60);
  }

  function render() {
    shadow.replaceChildren();
    const style = document.createElement("style");
    style.textContent = previewCss(o, opts.name);
    shadow.append(style);
    const [w, hgt] = PAPER_MM[o.paper];
    const pw = o.landscape ? hgt : w;
    const ph = o.landscape ? w : hgt;
    pageWidthPx = pw * MM;
    const pages = document.createElement("div");
    pages.className = "pages";
    shadow.append(pages);
    pagesBox = pages;
    if (o.format === "txt" || o.format === "md") {
      // テキスト・Markdown にはページがないので、1 枚の長い紙として見せる（Markdown は書き出す文字そのもの）
      const sheet = document.createElement("pre");
      sheet.className = "txt";
      sheet.textContent = (o.format === "md" ? exportMarkdown(opts.lines, o, meta, opts.tab) : exportText(opts.lines, o, meta, opts.tab)).replace(/\r\n/g, "\n");
      pages.append(sheet);
      pageWidthPx = 760;
      info.textContent = t(o.format === "md" ? "ps.infoMd" : "ps.infoText", { n: String(opts.lines.length) });
      applyZoom();
      return;
    }
    // いったん本文を作って、行を 1 つずつページに流し込む（あふれたら次のページ）
    const tmp = document.createElement("div");
    tmp.innerHTML = exportBody(opts.lines, o, meta, opts.tab);
    const head = tmp.querySelector(".x-head");
    const rows = [...tmp.querySelectorAll(".x-line")];
    const measure = document.createElement("div");
    measure.className = "measure";
    shadow.append(measure);
    const made: HTMLElement[] = [];
    const newPage = () => {
      const page = document.createElement("div");
      page.className = "page";
      page.style.width = `${pw}mm`;
      page.style.height = `${ph}mm`;
      page.style.padding = MARGIN.map((m) => `${m}mm`).join(" ");
      const content = document.createElement("div");
      content.className = "content x-sheet";
      const code = document.createElement("div");
      code.className = "x-code";
      if (!made.length && head) content.append(head);
      content.append(code);
      page.append(content);
      measure.append(page);
      made.push(page);
      return { page, content, code };
    };
    let cur = newPage();
    let truncated = false;
    for (const r of rows) {
      cur.code.append(r);
      if (cur.content.scrollHeight > cur.content.clientHeight + 1 && cur.code.childElementCount > 1) {
        r.remove();
        if (made.length >= MAX_PAGES) {
          truncated = true;
          break;
        }
        cur = newPage();
        cur.code.append(r);
      }
    }
    const total = made.length;
    made.forEach((page, i) => {
      if (o.header) {
        const top = document.createElement("div");
        top.className = "margin-top";
        top.textContent = opts.name;
        page.append(top);
      }
      if (o.pageNumbers) {
        const bottom = document.createElement("div");
        bottom.className = "margin-bottom";
        bottom.textContent = `${i + 1} / ${total}${truncated ? "+" : ""}`;
        page.append(bottom);
      }
      pages.append(page);
    });
    measure.remove();
    if (truncated) {
      const more = document.createElement("p");
      more.className = "more";
      more.textContent = t("ps.more", { n: String(MAX_PAGES) });
      pages.append(more);
    }
    info.textContent = t("ps.info", { pages: String(total) + (truncated ? "+" : ""), paper: `${o.paper}${o.landscape ? " " + t("ps.landscape") : ""}`, lines: String(opts.lines.length) });
    applyZoom();
  }

  changed();
  render();
  requestAnimationFrame(() => (left.querySelector(".ps-seg-item.on") as HTMLElement | null)?.focus());
}

function previewCss(o: ExportOptions, title: string): string {
  // @page は画面では使われないので、ページの枠は自分で描く
  const base = exportCss(o, title).replace(/@page\s*\{[\s\S]*?\n\}/, "");
  return `
:host { display: block; }
.pages { display: flex; flex-direction: column; align-items: center; gap: 18px; padding: 24px 0 40px; }
.measure { position: fixed; left: -100000px; top: 0; visibility: hidden; }
.page { position: relative; box-sizing: border-box; background: #fff; box-shadow: 0 2px 10px rgba(0,0,0,.35); overflow: hidden; flex: none; }
.content { height: 100%; overflow: hidden; }
.margin-top { position: absolute; top: 7mm; left: 14mm; font: 8pt sans-serif; color: #666; }
.margin-bottom { position: absolute; bottom: 7mm; left: 0; right: 0; text-align: center; font: 8pt sans-serif; color: #666; }
.txt { margin: 0; width: 760px; box-sizing: border-box; padding: 24px 28px; background: #fff; color: #000; box-shadow: 0 2px 10px rgba(0,0,0,.35); font: 13px/1.5 Consolas, "BIZ UDGothic", "MS Gothic", monospace; white-space: pre-wrap; word-break: break-all; }
.more { color: #aaa; font: 12px sans-serif; }
${base}
`;
}
