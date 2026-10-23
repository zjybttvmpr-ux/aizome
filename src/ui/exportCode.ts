// コードを PDF・Word・HTML・テキストに、ページの形（用紙・余白・見出し・ページ番号）ごと書き出す
import { h } from "../core/dom";
import { t } from "../core/i18n";
import { settings } from "../core/settings";
import { modal } from "./dialog";

export type ExportFormat = "pdf" | "docx" | "html" | "txt";
export type Seg = { text: string; cls: string };

export interface ExportOptions {
  format: ExportFormat;
  paper: "A4" | "B5" | "A3" | "Letter";
  landscape: boolean;
  fontSize: number;
  lineNumbers: boolean;
  colors: boolean;
  header: boolean;
  pageNumbers: boolean;
  wrap: boolean;
}

/** 紙に合う明るい色（VS Code の「Light+」に近い） */
export const PAPER_COLORS: Record<string, string> = {
  k: "#0000ff",
  s: "#a31515",
  c: "#008000",
  n: "#098658",
  f: "#795e26",
  t: "#267f99",
  v: "#001080",
  m: "#808080",
};

export const PAPER_MM: Record<ExportOptions["paper"], [number, number]> = {
  A4: [210, 297],
  B5: [182, 257],
  A3: [297, 420],
  Letter: [216, 279],
};

export function defaultExportOptions(): ExportOptions {
  const saved = settings.get("export.options") as Partial<ExportOptions> | null;
  return {
    format: "pdf",
    paper: "A4",
    landscape: false,
    fontSize: 10,
    lineNumbers: true,
    colors: true,
    header: true,
    pageNumbers: true,
    wrap: true,
    ...(saved ?? {}),
  };
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function tabsToSpaces(s: string, tab: number): string {
  let out = "";
  for (const ch of s) {
    if (ch === "\t") out += " ".repeat(tab - (out.length % tab));
    else out += ch;
  }
  return out;
}

/** タブを空白にした行（列がずれないように、区切りをまたいで数える） */
function normalize(lines: Seg[][], tab: number): Seg[][] {
  return lines.map((segs) => {
    let col = 0;
    return segs.map((s) => {
      let text = "";
      for (const ch of s.text.replace(/\r/g, "")) {
        if (ch === "\t") {
          const n = tab - (col % tab);
          text += " ".repeat(n);
          col += n;
        } else {
          text += ch;
          col++;
        }
      }
      return { text, cls: s.cls };
    });
  });
}

// ───────── 設定の画面

export function askExportOptions(fileName: string): Promise<ExportOptions | null> {
  const o = defaultExportOptions();
  return modal<ExportOptions | null>((close) => {
    const select = <T extends string>(value: T, items: [T, string][], onChange: (v: T) => void) => {
      const el = h("select", { class: "select" }, ...items.map(([v, label]) => h("option", { value: v, selected: v === value }, label))) as HTMLSelectElement;
      el.addEventListener("change", () => onChange(el.value as T));
      return el;
    };
    const check = (key: "lineNumbers" | "colors" | "header" | "pageNumbers" | "wrap" | "landscape", label: string) => {
      const box = h("input", { type: "checkbox", class: "switch", checked: o[key] }) as HTMLInputElement;
      box.addEventListener("change", () => {
        o[key] = box.checked;
        refresh();
      });
      return h("label", { class: "export-check" }, box, h("span", {}, label));
    };
    const pageOnly: HTMLElement[] = [];
    const note = h("p", { class: "modal-text export-note" });
    const refresh = () => {
      const paged = o.format === "pdf" || o.format === "docx" || o.format === "html";
      for (const el of pageOnly) el.hidden = !paged;
      note.textContent = t(`export.note.${o.format}`);
    };
    const formatSel = select<ExportFormat>(o.format, [
      ["pdf", t("export.pdf")],
      ["docx", t("export.docx")],
      ["html", t("export.html")],
      ["txt", t("export.txt")],
    ], (v) => {
      o.format = v;
      refresh();
    });
    const paperRow = h(
      "div",
      { class: "export-row" },
      h("span", { class: "export-label" }, t("export.paper")),
      select<ExportOptions["paper"]>(o.paper, [["A4", "A4"], ["B5", "B5"], ["A3", "A3"], ["Letter", "Letter"]], (v) => (o.paper = v)),
      check("landscape", t("export.landscape")),
    );
    const sizeRow = h(
      "div",
      { class: "export-row" },
      h("span", { class: "export-label" }, t("export.fontSize")),
      select<string>(String(o.fontSize), ["8", "9", "10", "11", "12", "14"].map((v) => [v, `${v} pt`] as [string, string]), (v) => (o.fontSize = Number(v))),
    );
    pageOnly.push(paperRow, sizeRow);
    const opts = h(
      "div",
      { class: "export-checks" },
      check("lineNumbers", t("export.lineNumbers")),
      check("colors", t("export.colors")),
      check("header", t("export.header")),
      check("pageNumbers", t("export.pageNumbers")),
      check("wrap", t("export.wrap")),
    );
    refresh();
    const go = () => {
      settings.set("export.options", { ...o } as never);
      close({ ...o });
    };
    return {
      body: [
        h("h2", { class: "modal-title" }, t("export.title", { name: fileName })),
        h("div", { class: "export-row" }, h("span", { class: "export-label" }, t("export.format")), formatSel),
        paperRow,
        sizeRow,
        opts,
        note,
        h(
          "div",
          { class: "modal-actions" },
          h("button", { class: "btn plain", type: "button", onclick: () => close(null) }, t("common.cancel")),
          h("button", { class: "btn primary", type: "button", onclick: go }, t("export.go")),
        ),
      ],
      initialFocus: formatSel,
    };
  }, null);
}

// ───────── HTML（PDF の印刷にも使う）

export function exportCss(o: ExportOptions, title: string): string {
  const [w, hgt] = PAPER_MM[o.paper];
  const size = o.landscape ? `${hgt}mm ${w}mm` : `${w}mm ${hgt}mm`;
  const q = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  const colors = o.colors ? Object.entries(PAPER_COLORS).map(([k, c]) => `.x-code .${k}{color:${c}}`).join("\n") : "";
  return `
@page { size: ${size}; margin: 16mm 14mm 16mm 14mm;
  ${o.header ? `@top-left { content: ${q(title)}; font: 8pt sans-serif; color: #666; }` : ""}
  ${o.pageNumbers ? `@bottom-center { content: counter(page) " / " counter(pages); font: 8pt sans-serif; color: #666; }` : ""}
}
.x-sheet { color: #000; background: #fff; font-family: "Yu Gothic UI", "Meiryo", sans-serif; }
.x-head { display: flex; gap: 12px; align-items: baseline; border-bottom: 1px solid #bbb; padding-bottom: 4px; margin-bottom: 8px; font-size: 9pt; color: #444; }
.x-head strong { font-size: 11pt; color: #000; }
.x-head .x-date { margin-left: auto; }
.x-code { font: ${o.fontSize}pt/1.5 Consolas, "BIZ UDGothic", "MS Gothic", monospace; margin: 0; }
.x-line { display: flex; break-inside: avoid; }
.x-num { flex: none; color: #999; text-align: right; padding-right: 1.2em; user-select: none; white-space: nowrap; box-sizing: content-box; }
.x-text { flex: 1; min-width: 0; ${o.wrap ? "white-space: pre-wrap; word-break: break-all;" : "white-space: pre;"} }
.x-code .c { font-style: italic; }
${colors}
`;
}

export function exportBody(lines: Seg[][], o: ExportOptions, meta: { name: string; path: string; date: string }, tab = 4): string {
  const rows = normalize(lines, tab);
  const width = String(rows.length).length;
  const body = rows
    .map((segs, i) => {
      const text = segs.map((s) => (s.cls ? `<span class="${s.cls}">${esc(s.text)}</span>` : esc(s.text))).join("") || "&#8203;";
      const num = o.lineNumbers ? `<span class="x-num" style="width:${width + 0.5}ch">${i + 1}</span>` : "";
      return `<div class="x-line">${num}<span class="x-text">${text}</span></div>`;
    })
    .join("\n");
  const head = o.header
    ? `<div class="x-head"><strong>${esc(meta.name)}</strong><span>${esc(meta.path)}</span><span class="x-date">${esc(meta.date)}</span></div>`
    : "";
  return `<div class="x-sheet">${head}<div class="x-code">${body}</div></div>`;
}

export function exportHtmlDocument(lines: Seg[][], o: ExportOptions, meta: { name: string; path: string; date: string }, tab = 4): string {
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(meta.name)}</title>
<style>
body { margin: 24px auto; max-width: 980px; padding: 0 16px; background: #fff; }
${exportCss(o, meta.name)}
@media print { body { margin: 0; max-width: none; padding: 0; } }
</style>
</head>
<body>
${exportBody(lines, o, meta, tab)}
</body>
</html>
`;
}

// ───────── テキスト

export function exportText(lines: Seg[][], o: ExportOptions, meta: { name: string; path: string; date: string }, tab = 4): string {
  const rows = normalize(lines, tab).map((segs) => segs.map((s) => s.text).join(""));
  const width = String(rows.length).length;
  const body = rows.map((l, i) => (o.lineNumbers ? `${String(i + 1).padStart(width, " ")} | ${l}` : l));
  const head = o.header ? [`${meta.name}    ${meta.path}    ${meta.date}`, "=".repeat(Math.min(80, Math.max(20, meta.name.length + 10))), ""] : [];
  return [...head, ...body].join("\r\n") + "\r\n";
}

// ───────── Word（.docx）

const enc = new TextEncoder();

function xmlEsc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** mm → Word の長さ（1/20 pt） */
const twip = (mm: number) => Math.round((mm / 25.4) * 1440);

export function exportDocx(lines: Seg[][], o: ExportOptions, meta: { name: string; path: string; date: string }, tab = 4): Uint8Array {
  const rows = normalize(lines, tab);
  const width = String(rows.length).length;
  const sz = Math.round(o.fontSize * 2);
  const font = `<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:eastAsia="BIZ UDGothic" w:cs="Consolas"/>`;
  const run = (text: string, color: string | null, italic = false) =>
    `<w:r><w:rPr>${font}${color ? `<w:color w:val="${color.replace("#", "")}"/>` : ""}${italic ? "<w:i/>" : ""}<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/></w:rPr><w:t xml:space="preserve">${xmlEsc(text)}</w:t></w:r>`;
  const pPr = `<w:pPr><w:spacing w:before="0" w:after="0" w:line="${Math.round(240 * 1.15)}" w:lineRule="auto"/>${o.wrap ? "" : ""}</w:pPr>`;
  const paras = rows
    .map((segs, i) => {
      const num = o.lineNumbers ? run(`${String(i + 1).padStart(width, " ")}  `, "#999999") : "";
      const body = segs.map((s) => run(s.text, o.colors && s.cls ? PAPER_COLORS[s.cls] ?? null : null, s.cls === "c")).join("");
      return `<w:p>${pPr}${num}${body}</w:p>`;
    })
    .join("");
  const [w, hgt] = PAPER_MM[o.paper];
  const pw = twip(o.landscape ? hgt : w);
  const ph = twip(o.landscape ? w : hgt);
  const small = `<w:rPr><w:sz w:val="16"/><w:color w:val="666666"/></w:rPr>`;
  const header = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="4" w:space="1" w:color="BBBBBB"/></w:pBdr><w:tabs><w:tab w:val="right" w:pos="${pw - twip(28)}"/></w:tabs></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="20"/></w:rPr><w:t xml:space="preserve">${xmlEsc(meta.name)}</w:t></w:r><w:r>${small}<w:t xml:space="preserve">  ${xmlEsc(meta.path)}</w:t></w:r><w:r>${small}<w:tab/><w:t>${xmlEsc(meta.date)}</w:t></w:r></w:p></w:hdr>`;
  const footer = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r>${small}<w:fldChar w:fldCharType="begin"/></w:r><w:r>${small}<w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r>${small}<w:fldChar w:fldCharType="separate"/></w:r><w:r>${small}<w:t>1</w:t></w:r><w:r>${small}<w:fldChar w:fldCharType="end"/></w:r><w:r>${small}<w:t xml:space="preserve"> / </w:t></w:r><w:r>${small}<w:fldChar w:fldCharType="begin"/></w:r><w:r>${small}<w:instrText xml:space="preserve"> NUMPAGES </w:instrText></w:r><w:r>${small}<w:fldChar w:fldCharType="separate"/></w:r><w:r>${small}<w:t>1</w:t></w:r><w:r>${small}<w:fldChar w:fldCharType="end"/></w:r></w:p></w:ftr>`;
  const refs = `${o.header ? `<w:headerReference w:type="default" r:id="rIdHeader"/>` : ""}${o.pageNumbers ? `<w:footerReference w:type="default" r:id="rIdFooter"/>` : ""}`;
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${paras}<w:sectPr>${refs}<w:pgSz w:w="${pw}" w:h="${ph}"${o.landscape ? ' w:orient="landscape"' : ""}/><w:pgMar w:top="${twip(18)}" w:right="${twip(14)}" w:bottom="${twip(18)}" w:left="${twip(14)}" w:header="${twip(8)}" w:footer="${twip(8)}" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const files: [string, string][] = [
    [
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>`,
    ],
    [
      "_rels/.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    ],
    [
      "word/_rels/document.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdHeader" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/><Relationship Id="rIdFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>`,
    ],
    ["word/document.xml", document],
    ["word/header1.xml", header],
    ["word/footer1.xml", footer],
  ];
  return zipStore(files.map(([name, text]) => [name, enc.encode(text)]));
}

// ───────── ZIP（圧縮なし。Word が読める最小の形）

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function zipStore(files: [string, Uint8Array][]): Uint8Array {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const d = new Date();
  const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  for (const [name, data] of files) {
    const nameBytes = enc.encode(name);
    const crc = crc32(data);
    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true); // 名前は UTF-8
    lv.setUint16(8, 0, true); // 圧縮なし
    lv.setUint16(10, dosTime, true);
    lv.setUint16(12, dosDate, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    local.set(nameBytes, 30);
    parts.push(local, data);
    const cen = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cen.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, dosTime, true);
    cv.setUint16(14, dosDate, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    cen.set(nameBytes, 46);
    central.push(cen);
    offset += local.length + data.length;
  }
  const cenSize = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cenSize, true);
  ev.setUint32(16, offset, true);
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let p = 0;
  for (const a of all) {
    out.set(a, p);
    p += a.length;
  }
  return out;
}

export function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export { tabsToSpaces };
