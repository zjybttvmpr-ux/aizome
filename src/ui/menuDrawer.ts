// 左上の「藍 Aizome」を押すと、画面の左側全体から半透明のパネルがすっと出てくるメニュー。
// 分類（ファイル・編集・表示…）ごとに項目を並べ、上の検索欄で絞り込める。Esc や外側のクリックで閉じる
import { h, clear } from "../core/dom";
import { commands, formatKey } from "../core/commands";
import { t } from "../core/i18n";
import { normalizeQuery } from "../core/jpText";
import { icon } from "./icons";
import type { MenuItem } from "./menu";

interface Row {
  el: HTMLElement;
  run: () => void;
  text: string;
}

class MenuDrawer {
  private root: HTMLElement | null = null;
  private onClose: (() => void) | null = null;
  private rows: Row[] = [];
  private index = -1;
  private expanded = new Set<string>();

  get isOpen() {
    return !!this.root;
  }

  toggle(items: () => MenuItem[], onClose?: () => void) {
    if (this.root) this.close();
    else this.open(items, onClose);
  }

  open(items: () => MenuItem[], onClose?: () => void) {
    this.close();
    this.onClose = onClose ?? null;
    const search = h("input", { class: "drawer-search", type: "search", placeholder: t("drawer.search"), spellcheck: "false", "aria-label": t("drawer.search") });
    const list = h("div", { class: "drawer-list", role: "menu" });
    const panel = h(
      "aside",
      { class: "drawer", role: "dialog", "aria-label": t("menu.open") },
      h(
        "div",
        { class: "drawer-head" },
        h("span", { class: "brand-mark", "aria-hidden": "true" }, "藍"),
        h("span", { class: "drawer-title" }, "Aizome"),
        h("button", { class: "icon-btn drawer-close", type: "button", title: `${t("common.close")} (Esc)`, "aria-label": t("common.close"), html: icon("x", 16), onclick: () => this.close() }),
      ),
      h("div", { class: "drawer-search-wrap", html: icon("search", 14) }, search),
      list,
    );
    const backdrop = h("div", { class: "drawer-backdrop" });
    const root = h("div", { class: "drawer-root" }, backdrop, panel);
    backdrop.addEventListener("mousedown", () => this.close());
    this.root = root;
    document.body.append(root);
    // 次のフレームで開く（すっと出てくるアニメーション）
    requestAnimationFrame(() => root.classList.add("open"));
    const render = () => this.render(list, items(), search.value);
    search.addEventListener("input", () => {
      this.index = -1;
      render();
    });
    search.addEventListener("keydown", (e) => this.onKey(e, render));
    panel.addEventListener("keydown", (e) => {
      if (e.target !== search) this.onKey(e, render);
    });
    render();
    search.focus();
  }

  close() {
    const root = this.root;
    if (!root) return;
    this.root = null;
    this.rows = [];
    root.classList.remove("open");
    root.classList.add("closing");
    window.setTimeout(() => root.remove(), 180);
    const cb = this.onClose;
    this.onClose = null;
    cb?.();
  }

  private info(item: MenuItem): { text: string; hint?: string; checked?: boolean; disabled?: boolean } {
    if (item.type === "command") {
      const c = commands.get(item.id);
      return { text: item.label ?? (c ? commands.title(c) : item.id), hint: c?.key ? formatKey(c.key) : c?.display, checked: item.checked?.(), disabled: !c };
    }
    if (item.type === "action") return { text: item.label, hint: item.hint, checked: item.checked, disabled: item.disabled };
    if (item.type === "submenu" || item.type === "note") return { text: item.label };
    return { text: "" };
  }

  private run(item: MenuItem) {
    this.close();
    if (item.type === "command") void Promise.resolve(commands.execute(item.id)).catch((err) => console.error(err));
    else if (item.type === "action") void Promise.resolve(item.run()).catch((err) => console.error(err));
  }

  private render(list: HTMLElement, items: MenuItem[], query: string) {
    clear(list);
    this.rows = [];
    const q = normalizeQuery(query.trim());
    const match = (s: string) => !q || normalizeQuery(s).includes(q);

    const addItems = (parent: HTMLElement, entries: MenuItem[], path: string, depth: number) => {
      for (const item of entries) {
        if (item.type === "separator") {
          if (!q) parent.append(h("div", { class: "drawer-sep" }));
          continue;
        }
        if (item.type === "note") {
          if (!q) parent.append(h("div", { class: "drawer-note" }, item.label));
          continue;
        }
        const info = this.info(item);
        if (item.type === "submenu") {
          // 分類の中の小分類（最近開いたフォルダ・テーマなど）：押すと開く。検索中は中身を全部出す
          const key = `${path}/${info.text}`;
          const children = item.items();
          const open = !!q || this.expanded.has(key);
          const childBox = h("div", { class: "drawer-sub" });
          if (open) addItems(childBox, children, key, depth + 1);
          if (q && !childBox.childElementCount) continue;
          const row = h(
            "button",
            { class: "drawer-item has-sub" + (open ? " open" : ""), type: "button", role: "menuitem", "aria-expanded": String(open), style: `--depth:${depth}` },
            h("span", { class: "drawer-check" }),
            h("span", { class: "drawer-label" }, info.text),
            h("span", { class: "drawer-arrow", html: icon("chevron", 12) }),
          );
          const toggle = () => {
            if (this.expanded.has(key)) this.expanded.delete(key);
            else this.expanded.add(key);
            this.render(list, items, query);
          };
          row.addEventListener("click", toggle);
          parent.append(row, childBox);
          this.rows.push({ el: row, run: toggle, text: info.text });
          continue;
        }
        if (!match(info.text + (item.type === "command" ? " " + item.id.replace(/[._]/g, " ") : ""))) continue;
        const row = h(
          "button",
          { class: "drawer-item" + (info.checked ? " checked" : ""), type: "button", role: "menuitem", disabled: info.disabled, style: `--depth:${depth}` },
          h("span", { class: "drawer-check", "aria-hidden": "true" }, info.checked ? "✓" : ""),
          h("span", { class: "drawer-label" }, info.text),
          info.hint ? h("kbd", { class: "drawer-hint" }, info.hint) : null,
        );
        row.addEventListener("click", () => this.run(item));
        parent.append(row);
        if (!info.disabled) this.rows.push({ el: row, run: () => this.run(item), text: info.text });
      }
    };

    // いちばん上の段の分類は、見出しにして中身を並べる
    for (const item of items) {
      if (item.type === "submenu") {
        const section = h("section", { class: "drawer-section" });
        const body = h("div", { class: "drawer-section-body" });
        addItems(body, item.items(), item.label, 0);
        if (q && !body.childElementCount) continue;
        section.append(h("h3", { class: "drawer-heading" }, item.label), body);
        list.append(section);
      } else {
        addItems(list, [item], "", 0);
      }
    }
    if (!this.rows.length) list.append(h("p", { class: "drawer-empty" }, t("palette.empty")));
    if (this.index >= this.rows.length) this.index = this.rows.length - 1;
    this.highlight();
  }

  private highlight() {
    this.rows.forEach((r, i) => r.el.classList.toggle("active", i === this.index));
    this.rows[this.index]?.el.scrollIntoView({ block: "nearest" });
  }

  private onKey(e: KeyboardEvent, rerender: () => void) {
    const handled = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    if (e.key === "Escape") {
      handled();
      this.close();
    } else if (e.key === "ArrowDown") {
      handled();
      this.index = Math.min(this.rows.length - 1, this.index + 1);
      this.highlight();
    } else if (e.key === "ArrowUp") {
      handled();
      this.index = Math.max(0, this.index - 1);
      this.highlight();
    } else if (e.key === "Enter") {
      handled();
      const row = this.rows[Math.max(0, this.index)];
      row?.run();
      if (this.root) rerender();
    }
  }
}

export const menuDrawer = new MenuDrawer();
