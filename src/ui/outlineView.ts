// 左の「関数の一覧（アウトライン）」：今のファイルのクラス・関数を並べ、クリックでその行へ
import { h, clear } from "../core/dom";
import { t } from "../core/i18n";
import { normalizeQuery } from "../core/jpText";
import type { OutlineItem, SymbolKind } from "../editor/outline";

const BADGE: Record<SymbolKind, { mark: string; cls: string }> = {
  class: { mark: "C", cls: "k-class" },
  struct: { mark: "S", cls: "k-class" },
  interface: { mark: "I", cls: "k-iface" },
  enum: { mark: "E", cls: "k-iface" },
  namespace: { mark: "N", cls: "k-ns" },
  function: { mark: "ƒ", cls: "k-func" },
  method: { mark: "M", cls: "k-func" },
  constructor: { mark: "◇", cls: "k-func" },
  property: { mark: "P", cls: "k-prop" },
};

export class OutlineView {
  readonly el: HTMLElement;
  private list: HTMLElement;
  private filter: HTMLInputElement;
  private items: OutlineItem[] = [];
  private current: OutlineItem | null = null;
  private collapsed = new Set<string>();
  private empty = "";

  constructor(private onPick: (item: OutlineItem) => void) {
    this.filter = h("input", { class: "text-input outline-filter", type: "search", placeholder: t("outline.filter"), spellcheck: "false" }) as HTMLInputElement;
    this.filter.addEventListener("input", () => this.render());
    this.filter.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const first = this.list.querySelector<HTMLElement>(".outline-row");
        first?.click();
      }
    });
    this.list = h("div", { class: "outline-list", role: "tree" });
    this.el = h("div", { class: "outline-view" }, h("div", { class: "outline-top" }, this.filter), this.list);
  }

  /** items が null なら「この言語は一覧にできない」 */
  set(items: OutlineItem[] | null, emptyMessage: string) {
    this.items = items ?? [];
    this.empty = emptyMessage;
    this.render();
  }

  setCurrent(item: OutlineItem | null) {
    if (this.current === item || (this.current && item && this.current.line === item.line && this.current.name === item.name)) return;
    this.current = item;
    for (const row of this.list.querySelectorAll<HTMLElement>(".outline-row")) {
      const on = !!item && Number(row.dataset.line) === item.line;
      row.classList.toggle("current", on);
      if (on) row.scrollIntoView({ block: "nearest" });
    }
  }

  private key(it: OutlineItem) {
    return `${it.line}:${it.name}`;
  }

  private render() {
    clear(this.list);
    const q = normalizeQuery(this.filter.value.trim());
    if (!this.items.length) {
      this.list.append(h("p", { class: "outline-empty" }, this.empty));
      return;
    }
    // たたんだ項目の中身は出さない（検索中は全部）
    let hideBelow = Infinity;
    let shown = 0;
    this.items.forEach((it, i) => {
      if (!q) {
        if (it.level > hideBelow) return;
        hideBelow = Infinity;
      }
      if (q && !normalizeQuery(it.name).includes(q)) return;
      const hasChildren = !!this.items[i + 1] && this.items[i + 1].level > it.level;
      const folded = this.collapsed.has(this.key(it));
      if (!q && folded) hideBelow = it.level;
      const badge = BADGE[it.kind];
      const twisty = h(
        "span",
        { class: "outline-twisty" + (hasChildren && !q ? (folded ? " folded" : " open") : "") },
        hasChildren && !q ? "▸" : "",
      );
      twisty.addEventListener("click", (e) => {
        if (!hasChildren || q) return;
        e.stopPropagation();
        if (folded) this.collapsed.delete(this.key(it));
        else this.collapsed.add(this.key(it));
        this.render();
      });
      const row = h(
        "div",
        {
          class: "outline-row" + (this.current && this.current.line === it.line ? " current" : ""),
          role: "treeitem",
          tabindex: 0,
          title: `${it.name}${it.detail}  （${t("outline.line", { n: String(it.line) })}）`,
          style: `--level:${q ? 0 : it.level}`,
          "data-line": String(it.line),
        },
        twisty,
        h("span", { class: `outline-badge ${badge.cls}` }, badge.mark),
        h("span", { class: "outline-name" }, it.name),
        it.detail ? h("span", { class: "outline-detail" }, it.detail) : null,
        h("span", { class: "outline-line" }, String(it.line)),
      );
      row.addEventListener("click", () => this.onPick(it));
      row.addEventListener("keydown", (e) => {
        if (e.key === "Enter") this.onPick(it);
      });
      this.list.append(row);
      shown++;
    });
    if (!shown) this.list.append(h("p", { class: "outline-empty" }, t("palette.empty")));
  }
}
