// コマンドパレット / クイックオープン / 拡張機能からの選択肢表示
import { h, clear } from "../core/dom";
import { t } from "../core/i18n";
import { commands, formatKey } from "../core/commands";
import { basename, relative } from "../core/paths";
import { icon } from "./icons";
import { openSlashPalette } from "./slash";

export interface PickItem<T = unknown> {
  label: string;
  detail?: string;
  hint?: string;
  icon?: string;
  value: T;
}

/** 部分列マッチ。連続一致と単語の先頭一致を高く評価する */
export function fuzzyScore(query: string, text: string): number {
  if (!query) return 1;
  const q = query.toLowerCase();
  const s = text.toLowerCase();
  let qi = 0;
  let score = 0;
  let streak = 0;
  for (let i = 0; i < s.length && qi < q.length; i++) {
    if (s[i] === q[qi]) {
      streak++;
      score += 1 + streak * 2 + (i === 0 || /[\s/\\._-]/.test(s[i - 1]) ? 4 : 0);
      qi++;
    } else streak = 0;
  }
  if (qi < q.length) return 0;
  return score - s.length * 0.02;
}

interface OpenOptions<T> {
  placeholder: string;
  items: (query: string) => PickItem<T>[];
  /** 入力が ">" で始まったら別モードに切り替える等 */
  onQueryPrefix?: (query: string) => boolean;
}

class Palette {
  private backdrop: HTMLElement | null = null;
  private resolve: ((v: unknown) => void) | null = null;

  close(value: unknown = undefined) {
    this.backdrop?.remove();
    this.backdrop = null;
    const r = this.resolve;
    this.resolve = null;
    r?.(value);
  }

  open<T>(opts: OpenOptions<T>, initial = ""): Promise<T | undefined> {
    this.close();
    const prevFocus = document.activeElement as HTMLElement | null;
    return new Promise<T | undefined>((resolve) => {
      this.resolve = (v) => {
        prevFocus?.focus();
        resolve(v as T | undefined);
      };
      const input = h("input", { class: "palette-input", type: "text", placeholder: opts.placeholder, spellcheck: "false", value: initial, "aria-label": opts.placeholder });
      const list = h("ul", { class: "palette-list", role: "listbox" });
      const box = h("div", { class: "palette", role: "dialog" }, h("div", { class: "palette-field", html: icon("search", 15) }, input), list);
      const backdrop = h("div", { class: "palette-backdrop" }, box);
      this.backdrop = backdrop;
      let items: PickItem<T>[] = [];
      let sel = 0;

      const render = () => {
        clear(list);
        if (!items.length) {
          list.append(h("li", { class: "palette-empty" }, t("palette.empty")));
          return;
        }
        items.slice(0, 80).forEach((it, i) => {
          const li = h(
            "li",
            { class: "palette-item" + (i === sel ? " selected" : ""), role: "option", "aria-selected": String(i === sel) },
            it.icon ? h("span", { class: "palette-icon", html: icon(it.icon, 15) }) : null,
            h("span", { class: "palette-label" }, it.label),
            it.detail ? h("span", { class: "palette-detail" }, it.detail) : null,
            it.hint ? h("kbd", { class: "palette-hint" }, it.hint) : null,
          );
          li.addEventListener("mousemove", () => {
            if (sel !== i) {
              sel = i;
              render();
            }
          });
          li.addEventListener("mousedown", (e) => {
            e.preventDefault();
            this.close(it.value);
          });
          list.append(li);
        });
        list.querySelector(".selected")?.scrollIntoView({ block: "nearest" });
      };

      const update = () => {
        if (opts.onQueryPrefix?.(input.value)) return;
        items = opts.items(input.value);
        sel = 0;
        render();
      };

      input.addEventListener("input", update);
      input.addEventListener("keydown", (e) => {
        if (e.key === "ArrowDown") {
          sel = Math.min(sel + 1, Math.min(items.length, 80) - 1);
          render();
          e.preventDefault();
        } else if (e.key === "ArrowUp") {
          sel = Math.max(sel - 1, 0);
          render();
          e.preventDefault();
        } else if (e.key === "Enter") {
          e.preventDefault();
          const it = items[sel];
          this.close(it ? it.value : undefined);
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          this.close();
        }
      });
      backdrop.addEventListener("mousedown", (e) => {
        if (e.target === backdrop) this.close();
      });
      document.body.append(backdrop);
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
      update();
    });
  }
}

export const palette = new Palette();

function rank<T>(query: string, items: PickItem<T>[], key: (i: PickItem<T>) => string = (i) => i.label): PickItem<T>[] {
  if (!query) return items;
  return items
    .map((i) => ({ i, s: fuzzyScore(query, key(i)) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.i);
}

export function openCommandPalette(initial = "") {
  const run = (q: string) => {
    const query = q.replace(/^>\s*/, "");
    const items: PickItem<string>[] = commands
      .list()
      .map((c) => ({ label: commands.title(c), hint: c.key ? formatKey(c.key) : c.display, detail: c.source && c.source !== "core" ? c.source : undefined, value: c.id }));
    items.sort((a, b) => a.label.localeCompare(b.label));
    // 表示名に加えて ID（英語）でも探せるようにする 例: "term" → ターミナル
    return rank(query, items, (i) => `${i.label} ${i.value.replace(/[._]/g, " ")}`);
  };
  return palette
    .open<string>(
      {
        placeholder: t("palette.commands"),
        items: run,
        onQueryPrefix: (q) => {
          if (/^[/／]/.test(q)) {
            palette.close();
            void openSlashPalette(q, (back) => void openCommandPalette(back || ">"));
            return true;
          }
          return false;
        },
      },
      initial || ">",
    )
    .then((id) => (id ? commands.execute(id) : undefined));
}

const SLASH_HINT = "\u0000slash";
const HELP_HINT = "\u0000help";

export function openQuickOpen(files: () => string[], root: string, openFile: (p: string) => void, initial = ""): Promise<unknown> {
  return palette
    .open<string>(
      {
        placeholder: t("palette.files"),
        onQueryPrefix: (q) => {
          if (q.startsWith(">")) {
            palette.close();
            void openCommandPalette(q);
            return true;
          }
          if (/^[/／]/.test(q)) {
            palette.close();
            void openSlashPalette(q, (back) => void openQuickOpen(files, root, openFile, back));
            return true;
          }
          return false;
        },
        items: (q) => {
          const all = files().map((p) => ({ label: basename(p), detail: relative(root, p), icon: "file", value: p }));
          const found = rank(q, all, (i) => i.detail ?? i.label).slice(0, 200);
          if (q) return found;
          // 何も打っていないときは、便利機能とヘルプへの入り口を先頭に
          return [
            { label: t("slash.hintAll"), detail: t("slash.hintAllDetail"), icon: "wand", value: SLASH_HINT },
            { label: t("slash.hintHelp"), detail: "/help", icon: "help", value: HELP_HINT },
            ...found,
          ];
        },
      },
      initial,
    )
    .then((p) => {
      if (p === SLASH_HINT) return openSlashPalette("/", (back) => void openQuickOpen(files, root, openFile, back));
      if (p === HELP_HINT) return commands.execute("help.open");
      if (p) openFile(p);
    });
}

export function quickPick<T>(items: PickItem<T>[], placeholder: string): Promise<T | undefined> {
  return palette.open<T>({ placeholder, items: (q) => rank(q, items) });
}
