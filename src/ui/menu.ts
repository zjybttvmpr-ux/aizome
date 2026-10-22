// 左上のメニュー（ファイル・編集・表示…）。項目にマウスを乗せるか → キーで右にサブメニューが開く
import { h } from "../core/dom";
import { commands, formatKey } from "../core/commands";
import { icon } from "./icons";

export type MenuItem =
  | { type: "command"; id: string; label?: string; checked?: () => boolean }
  | { type: "action"; label: string; run: () => unknown; hint?: string; checked?: boolean; disabled?: boolean }
  | { type: "submenu"; label: string; items: () => MenuItem[] }
  | { type: "separator" }
  | { type: "note"; label: string };

interface Level {
  el: HTMLElement;
  items: HTMLElement[];
  index: number;
}

class MenuController {
  private levels: Level[] = [];
  private onClose: (() => void) | null = null;
  private outside = (e: MouseEvent) => {
    if (!this.levels.some((l) => l.el.contains(e.target as Node))) this.close();
  };
  private keys = (e: KeyboardEvent) => this.onKey(e);

  get isOpen() {
    return this.levels.length > 0;
  }

  open(anchor: HTMLElement, items: MenuItem[], onClose?: () => void) {
    this.close();
    this.onClose = onClose ?? null;
    const r = anchor.getBoundingClientRect();
    this.openLevel(items, r.left, r.bottom + 4, null);
    document.addEventListener("mousedown", this.outside, true);
    document.addEventListener("keydown", this.keys, true);
    this.focus(0, 0);
  }

  close() {
    for (const l of this.levels) l.el.remove();
    this.levels = [];
    document.removeEventListener("mousedown", this.outside, true);
    document.removeEventListener("keydown", this.keys, true);
    const cb = this.onClose;
    this.onClose = null;
    cb?.();
  }

  private closeFrom(depth: number) {
    for (const l of this.levels.splice(depth)) l.el.remove();
  }

  private label(item: MenuItem): { text: string; hint?: string; checked?: boolean; disabled?: boolean } {
    if (item.type === "command") {
      const c = commands.get(item.id);
      return {
        text: item.label ?? (c ? commands.title(c) : item.id),
        hint: c?.key ? formatKey(c.key) : c?.display,
        checked: item.checked?.(),
        disabled: !c,
      };
    }
    if (item.type === "action") return { text: item.label, hint: item.hint, checked: item.checked, disabled: item.disabled };
    if (item.type === "submenu" || item.type === "note") return { text: item.label };
    return { text: "" };
  }

  private openLevel(items: MenuItem[], x: number, y: number, parentRow: HTMLElement | null) {
    const depth = this.levels.length;
    const el = h("div", { class: "menu", role: "menu" });
    const rows: HTMLElement[] = [];
    items.forEach((item) => {
      if (item.type === "separator") {
        el.append(h("div", { class: "menu-sep", role: "separator" }));
        return;
      }
      if (item.type === "note") {
        el.append(h("div", { class: "menu-note" }, item.label));
        return;
      }
      const info = this.label(item);
      const row = h(
        "button",
        {
          class: "menu-item" + (item.type === "submenu" ? " has-sub" : "") + (info.checked ? " checked" : ""),
          role: info.checked === undefined ? "menuitem" : "menuitemcheckbox",
          "aria-checked": info.checked === undefined ? undefined : String(info.checked),
          "aria-haspopup": item.type === "submenu" ? "menu" : undefined,
          disabled: info.disabled,
          type: "button",
          tabindex: -1,
        },
        h("span", { class: "menu-check", "aria-hidden": "true" }, info.checked ? "✓" : ""),
        h("span", { class: "menu-label" }, info.text),
        info.hint ? h("span", { class: "menu-hint" }, info.hint) : null,
        item.type === "submenu" ? h("span", { class: "menu-arrow", html: icon("chevron", 12) }) : null,
      );
      const index = rows.length;
      rows.push(row);
      row.addEventListener("mouseenter", () => {
        this.focus(depth, index, false);
        if (item.type === "submenu") this.openSub(depth, row, item.items());
        else this.closeFrom(depth + 1);
      });
      row.addEventListener("click", (e) => {
        e.preventDefault();
        if (item.type === "submenu") {
          this.openSub(depth, row, item.items());
          this.focus(depth + 1, 0);
        } else this.activate(item);
      });
      el.append(row);
    });
    document.body.append(el);
    // 画面からはみ出さないように位置を調整
    const rect = el.getBoundingClientRect();
    let left = x;
    let top = y;
    if (left + rect.width > innerWidth - 4) left = parentRow ? parentRow.getBoundingClientRect().left - rect.width + 2 : innerWidth - rect.width - 4;
    if (top + rect.height > innerHeight - 4) top = Math.max(4, innerHeight - rect.height - 4);
    el.style.left = `${Math.max(4, left)}px`;
    el.style.top = `${top}px`;
    this.levels.push({ el, items: rows, index: -1 });
  }

  private openSub(depth: number, row: HTMLElement, items: MenuItem[]) {
    const existing = this.levels[depth + 1];
    if (existing && existing.el.dataset.parent === String(this.levels[depth].items.indexOf(row))) return;
    this.closeFrom(depth + 1);
    const r = row.getBoundingClientRect();
    this.openLevel(items, r.right - 2, r.top - 5, row);
    this.levels[depth + 1].el.dataset.parent = String(this.levels[depth].items.indexOf(row));
  }

  private focus(depth: number, index: number, moveFocus = true) {
    const level = this.levels[depth];
    if (!level || !level.items.length) return;
    const i = Math.max(0, Math.min(index, level.items.length - 1));
    level.items.forEach((r, k) => r.classList.toggle("active", k === i));
    level.index = i;
    if (moveFocus) level.items[i].focus();
  }

  private activate(item: MenuItem) {
    this.close();
    if (item.type === "command") void Promise.resolve(commands.execute(item.id)).catch((err) => console.error(err));
    else if (item.type === "action") void Promise.resolve(item.run()).catch((err) => console.error(err));
  }

  private onKey(e: KeyboardEvent) {
    const depth = this.levels.length - 1;
    const level = this.levels[depth];
    if (!level) return;
    const step = (dir: number) => {
      let i = level.index;
      for (let n = 0; n < level.items.length; n++) {
        i = (i + dir + level.items.length) % level.items.length;
        if (!(level.items[i] as HTMLButtonElement).disabled) break;
      }
      this.focus(depth, i);
    };
    const handled = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    if (e.key === "ArrowDown") (handled(), step(1));
    else if (e.key === "ArrowUp") (handled(), step(-1));
    else if (e.key === "Enter" || e.key === " ") {
      handled();
      level.items[level.index]?.click();
    } else if (e.key === "ArrowRight") {
      handled();
      const row = level.items[level.index];
      if (row?.classList.contains("has-sub")) row.click();
    } else if (e.key === "ArrowLeft") {
      handled();
      if (depth > 0) {
        this.closeFrom(depth);
        this.focus(depth - 1, this.levels[depth - 1].index);
      }
    } else if (e.key === "Escape") {
      handled();
      if (depth > 0) {
        this.closeFrom(depth);
        this.focus(depth - 1, this.levels[depth - 1].index);
      } else this.close();
    } else if (e.key === "Tab") {
      handled();
      this.close();
    }
  }
}

export const menu = new MenuController();
