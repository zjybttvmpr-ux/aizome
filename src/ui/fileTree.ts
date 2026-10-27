// エクスプローラー（ファイルツリー）。フォルダは開いたときに読み込む
import { fs, type DirEntry } from "../core/platform";
import { h, clear } from "../core/dom";
import { t } from "../core/i18n";
import { basename, dirname, join } from "../core/paths";
import { icon } from "./icons";
import { confirmBox, inputBox } from "./dialog";
import { toast } from "./toast";
import { settings } from "../core/settings";

export interface FileTreeDeps {
  openFile: (path: string) => void;
  onRenamed: (from: string, to: string) => void;
  onDeleted: (path: string) => void;
  onChanged: () => void;
  /** 開いているフォルダの読み込みを解除する（ファイルは消さない） */
  unloadRoot?: () => void;
  /** 右クリックに足す項目（グループに追加など）。paths は選んでいるものすべて */
  extraMenu?: (path: string, isDir: boolean, paths: string[]) => { label: string; run: () => void }[];
}

export interface MenuItem {
  label: string;
  run?: () => void;
  danger?: boolean;
  /** 押せない見出し */
  note?: boolean;
  /** 区切り線（label は使わない） */
  sep?: boolean;
  /** 右に薄く出す（ショートカットなど） */
  hint?: string;
  /** マウスを乗せたときの説明 */
  title?: string;
  /** 等幅の文字で出す（コピー履歴など） */
  code?: boolean;
  /** メニューが開いているときに押すと選べるキー（1〜9 など） */
  key?: string;
}

export function contextMenu(x: number, y: number, items: MenuItem[]) {
  document.querySelector(".context-menu")?.remove();
  const menu = h(
    "div",
    { class: "context-menu", role: "menu" },
    ...items.map((it) =>
      it.sep
        ? h("div", { class: "context-sep", role: "separator" })
        : it.note
          ? h("div", { class: "context-note" }, it.label)
          : h(
              "button",
              {
                class: "context-item" + (it.danger ? " danger" : "") + (it.code ? " code" : ""),
                role: "menuitem",
                title: it.title ?? "",
                onclick: () => (menu.remove(), it.run?.()),
              },
              h("span", { class: "context-label" }, it.label),
              it.hint ? h("span", { class: "context-hint" }, it.hint) : null,
            ),
    ),
  );
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  document.body.append(menu);
  const r = menu.getBoundingClientRect();
  if (r.bottom > innerHeight) menu.style.top = `${Math.max(4, innerHeight - r.height - 4)}px`;
  if (r.right > innerWidth) menu.style.left = `${Math.max(4, innerWidth - r.width - 4)}px`;
  const off = (e: Event) => {
    if (!menu.contains(e.target as Node)) {
      menu.remove();
      document.removeEventListener("mousedown", off, true);
    }
  };
  setTimeout(() => document.addEventListener("mousedown", off, true));
  menu.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      menu.remove();
      return;
    }
    const hit = items.find((it) => it.key && it.key === e.key && it.run);
    if (hit) {
      e.preventDefault();
      menu.remove();
      hit.run!();
    }
  });
  (menu.querySelector("button") as HTMLElement | null)?.focus();
}

export class FileTree {
  readonly el: HTMLElement;
  private root: string | null = null;
  private expanded = new Set<string>();
  private selected: string | null = null;
  /** Ctrl / Shift を押しながら選んだもの（まとめてグループに入れる用） */
  private multi = new Set<string>();
  private anchor: string | null = null;
  private activeFile: string | null = null;
  private gitFiles = new Map<string, string>();
  private gitDirs = new Set<string>();

  constructor(private deps: FileTreeDeps) {
    this.el = h("div", { class: "tree", role: "tree", tabindex: 0 });
    // Ctrl+A ですべて選ぶ、Esc で選ぶのをやめる（エクスプローラーを触っているとき）
    this.el.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
        e.preventDefault();
        this.selectAll();
      } else if (e.key === "Escape" && this.multi.size) {
        e.preventDefault();
        this.clearSelection();
      } else if (e.key === "Delete" && this.selectedPaths().length) {
        e.preventDefault();
        void this.removeMany(this.selectedPaths());
      }
    });
    this.el.addEventListener("contextmenu", (e) => {
      if (e.target === this.el && this.root) {
        e.preventDefault();
        this.menuFor(this.root, true, e.clientX, e.clientY);
      }
    });
  }

  async setRoot(root: string | null) {
    this.root = root;
    this.expanded = new Set(root ? [root] : []);
    await this.refresh();
  }

  setActive(path: string | null) {
    this.activeFile = path;
    this.el.querySelectorAll(".tree-row.active").forEach((r) => r.classList.remove("active"));
    if (path) this.el.querySelector(`.tree-row[data-path="${CSS.escape(path)}"]`)?.classList.add("active");
  }

  /** Git の状態を反映する。キーは区切りを / にした絶対パス */
  setGit(files: Map<string, string>) {
    this.gitFiles = files;
    this.gitDirs = new Set();
    for (const p of files.keys()) {
      let i = p.lastIndexOf("/");
      while (i > 0) {
        p.slice(0, i) && this.gitDirs.add(p.slice(0, i));
        i = p.lastIndexOf("/", i - 1);
      }
    }
    this.el.querySelectorAll<HTMLElement>(".tree-row").forEach((row) => this.applyGit(row, row.dataset.path ?? "", row.classList.contains("dir")));
  }

  private applyGit(row: HTMLElement, path: string, isDir: boolean) {
    const key = path.replace(/\\/g, "/");
    row.classList.remove("git-M", "git-A", "git-U", "git-D", "git-R", "git-C", "git-dir");
    row.querySelector(".tree-git")?.remove();
    const st = this.gitFiles.get(key);
    if (st) {
      row.classList.add(`git-${st}`);
      row.append(h("span", { class: "tree-git", title: t(`git.${st}`) }, st === "U" ? "U" : st));
    } else if (isDir && this.gitDirs.has(key)) {
      row.classList.add("git-dir");
      row.append(h("span", { class: "tree-git dot", "aria-hidden": "true" }));
    }
  }

  async refresh() {
    clear(this.el);
    if (!this.root) return;
    const children = await this.renderDir(this.root, 0);
    this.el.append(children);
    // 一覧から外したものがあれば、下に「表示し直す」を出す（全部外しても戻せるように）
    const hiddenN = this.hiddenList().length;
    if (hiddenN) {
      this.el.append(
        h("button", { class: "tree-hidden-note", type: "button", title: t("tree.hideHelp"), onclick: () => this.showHidden() }, t("tree.showHidden", { n: String(hiddenN) })),
      );
    }
    this.setActive(this.activeFile);
  }

  private async renderDir(dir: string, depth: number): Promise<HTMLElement> {
    const group = h("div", { class: "tree-group", role: "group" });
    let entries: DirEntry[] = [];
    try {
      entries = await fs.listDir(dir);
    } catch {
      group.append(h("div", { class: "tree-error" }, t("tree.readFailed")));
      return group;
    }
    const hidden = new Set(this.hiddenList());
    for (const e of entries) if (!hidden.has(e.path)) group.append(await this.renderEntry(e, depth));
    if (!entries.length && depth > 0) group.append(h("div", { class: "tree-empty", style: `padding-left:${12 + (depth + 1) * 14}px` }, t("tree.emptyFolder")));
    return group;
  }

  private async renderEntry(e: DirEntry, depth: number): Promise<HTMLElement> {
    const open = e.isDir && this.expanded.has(e.path);
    const row = h(
      "div",
      {
        class: "tree-row" + (e.isDir ? " dir" : "") + (e.name.startsWith(".") ? " hidden-file" : "") + ((this.multi.size ? this.multi.has(e.path) : this.selected === e.path) ? " selected" : ""),
        role: "treeitem",
        "aria-expanded": e.isDir ? String(open) : undefined,
        tabindex: -1,
        "data-path": e.path,
        style: `padding-left:${8 + depth * 14}px`,
        title: e.path,
      },
      h("span", { class: "tree-twist" + (open ? " open" : ""), html: e.isDir ? icon("chevron", 12) : "" }),
      h("span", { class: "tree-icon", html: icon(e.isDir ? (open ? "folderOpen" : "folder") : "file", 15) }),
      h("span", { class: "tree-name" }, e.name),
    );
    this.applyGit(row, e.path, e.isDir);
    const wrap = h("div", { class: "tree-node" }, row);
    if (open) wrap.append(await this.renderDir(e.path, depth + 1));

    row.addEventListener("click", async (ev) => {
      // Ctrl（Mac は ⌘）で 1 つずつ足す・外す、Shift で範囲をまとめて選ぶ
      if (ev.ctrlKey || ev.metaKey || ev.shiftKey) {
        ev.preventDefault();
        if (ev.shiftKey && this.anchor) this.selectRange(this.anchor, e.path);
        else {
          if (!this.multi.size && this.selected && this.selected !== e.path) this.multi.add(this.selected);
          if (this.multi.has(e.path)) this.multi.delete(e.path);
          else this.multi.add(e.path);
          this.anchor = e.path;
        }
        this.selected = e.path;
        this.paintSelection();
        return;
      }
      this.multi.clear();
      this.anchor = e.path;
      this.selected = e.path;
      this.paintSelection();
      if (e.isDir) {
        if (this.expanded.has(e.path)) this.expanded.delete(e.path);
        else this.expanded.add(e.path);
        const fresh = await this.renderEntry(e, depth);
        wrap.replaceWith(fresh);
      } else {
        this.deps.openFile(e.path);
      }
    });
    // グループへドラッグで入れられるように（選んでいるものはまとめて・フォルダは中のファイルごと）
    row.draggable = true;
    row.addEventListener("dragstart", (ev) => {
      const paths = this.multi.has(e.path) && this.multi.size > 1 ? this.selectedPaths() : [e.path];
      const data = paths.map((p) => (this.isDirPath(p) ? `dir:${p}` : p)).join("\n");
      ev.dataTransfer?.setData("text/x-aizome-path", data);
      ev.dataTransfer?.setData("text/plain", paths.join("\n"));
    });
    row.addEventListener("contextmenu", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      this.menuFor(e.path, e.isDir, ev.clientX, ev.clientY);
    });
    return wrap;
  }

  private menuFor(path: string, isDir: boolean, x: number, y: number) {
    const dir = isDir ? path : dirname(path);
    const paths = this.multi.has(path) && this.multi.size > 1 ? this.selectedPaths() : [path];
    const n = String(paths.length);
    const items: MenuItem[] = [];
    if (paths.length > 1) {
      // まとめて選んでいるとき
      const files = paths.filter((p) => !this.isDirPath(p));
      items.push({ label: t("tree.selectedCount", { n }), note: true });
      if (files.length) items.push({ label: t("tree.openMany", { n: String(files.length) }), run: () => files.forEach((f) => this.deps.openFile(f)) });
      items.push({ label: t("tree.copyPaths", { n }), run: () => navigator.clipboard?.writeText(paths.join("\n")) });
      items.push({ label: t("tree.hideMany", { n }), run: () => this.hide(paths) });
      items.push({ label: t("tree.selectNone"), run: () => this.clearSelection() });
      items.push({ label: t("tree.deleteMany", { n }), run: () => void this.removeMany(paths), danger: true });
    } else {
      items.push({ label: t("tree.newFile"), run: () => this.newFile(dir) }, { label: t("tree.newFolder"), run: () => this.newFolder(dir) });
      if (path !== this.root) items.push({ label: t("tree.rename"), run: () => this.rename(path) });
      items.push({ label: t("tree.copyPath"), run: () => navigator.clipboard?.writeText(path) });
      items.push({ label: "", sep: true });
      if (isDir) items.push({ label: t("tree.selectInFolder"), run: () => void this.selectInFolder(path) });
      items.push({ label: t("tree.selectAll"), hint: "Ctrl+A", run: () => this.selectAll() });
      if (path === this.root) {
        const hiddenN = this.hiddenList().length;
        if (hiddenN) items.push({ label: t("tree.showHidden", { n: String(hiddenN) }), run: () => this.showHidden() });
        if (this.deps.unloadRoot) items.push({ label: t("tree.unload"), run: () => this.deps.unloadRoot?.() });
      } else {
        items.push({ label: t("tree.hide"), title: t("tree.hideHelp"), run: () => this.hide([path]) });
        items.push({ label: t("tree.delete"), run: () => this.remove(path), danger: true });
      }
    }
    const extra = this.deps.extraMenu?.(path, isDir, paths) ?? [];
    if (extra.length) items.push({ label: "", sep: true }, ...extra);
    contextMenu(x, y, items);
  }

  /** 選んでいるもの（画面の上から順） */
  selectedPaths(): string[] {
    const order = [...this.el.querySelectorAll<HTMLElement>(".tree-row")].map((r) => r.dataset.path ?? "");
    const set = this.multi.size ? this.multi : new Set(this.selected ? [this.selected] : []);
    return order.filter((p) => set.has(p));
  }

  isDir(path: string): boolean {
    return this.isDirPath(path);
  }

  private isDirPath(path: string): boolean {
    return !!this.el.querySelector(`.tree-row.dir[data-path="${CSS.escape(path)}"]`);
  }

  private selectRange(from: string, to: string) {
    const order = [...this.el.querySelectorAll<HTMLElement>(".tree-row")].map((r) => r.dataset.path ?? "");
    let a = order.indexOf(from);
    let b = order.indexOf(to);
    if (a < 0 || b < 0) return;
    if (a > b) [a, b] = [b, a];
    this.multi = new Set(order.slice(a, b + 1));
  }

  private paintSelection() {
    this.el.querySelectorAll<HTMLElement>(".tree-row").forEach((r) => {
      const p = r.dataset.path ?? "";
      r.classList.toggle("selected", this.multi.size ? this.multi.has(p) : p === this.selected);
    });
  }

  /** まとめて選んでいるのをやめる */
  clearSelection() {
    this.multi.clear();
    this.paintSelection();
  }

  /** 見えているものをすべて選ぶ */
  selectAll() {
    const all = [...this.el.querySelectorAll<HTMLElement>(".tree-row")].map((r) => r.dataset.path ?? "").filter(Boolean);
    this.multi = new Set(all);
    this.paintSelection();
    this.el.focus();
    if (all.length) toast(t("tree.selectedCount", { n: String(all.length) }), "info", 1800);
  }

  /** フォルダを開いて、その中のファイルとフォルダをすべて選ぶ */
  async selectInFolder(dir: string) {
    if (!this.expanded.has(dir)) {
      this.expanded.add(dir);
      await this.refresh();
    }
    const prefix = dir.replace(/[\\/]$/, "");
    const inside = [...this.el.querySelectorAll<HTMLElement>(".tree-row")]
      .map((r) => r.dataset.path ?? "")
      .filter((p) => p !== dir && (p.startsWith(prefix + "/") || p.startsWith(prefix + "\\")));
    this.multi = new Set(inside);
    this.paintSelection();
    this.el.focus();
    toast(t("tree.selectedCount", { n: String(inside.length) }), "info", 1800);
  }

  // ───── 一覧から外す（ファイルは消さず、Aizome に表示しないだけ）
  private hiddenList(): string[] {
    return this.root ? (settings.get("explorer.hidden") ?? {})[this.root] ?? [] : [];
  }

  private setHidden(list: string[]) {
    if (!this.root) return;
    settings.set("explorer.hidden", { ...(settings.get("explorer.hidden") ?? {}), [this.root]: list });
  }

  private hide(paths: string[]) {
    const list = [...new Set([...this.hiddenList(), ...paths.filter((p) => p !== this.root)])];
    this.setHidden(list);
    this.multi.clear();
    void this.refresh();
    toast(t("tree.hidden", { n: String(paths.length) }), "info", 4000);
  }

  private showHidden() {
    this.setHidden([]);
    void this.refresh();
  }

  /** まとめてフォルダから削除 */
  private async removeMany(paths: string[]) {
    if (paths.length === 1) return this.remove(paths[0]);
    const list = paths.filter((p) => p !== this.root);
    const ok = await confirmBox(t("tree.deleteManyTitle", { n: String(list.length) }), t("tree.deleteMessage"), t("tree.delete"), true);
    if (!ok) return;
    let failed = 0;
    for (const p of list) {
      try {
        await fs.remove(p);
        this.deps.onDeleted(p);
      } catch {
        failed++;
      }
    }
    this.multi.clear();
    await this.refresh();
    this.deps.onChanged();
    if (failed) toast(t("tree.deleteFailed", { err: String(failed) }), "error");
  }

  /** 選択中のフォルダ（なければルート） */
  targetDir(): string | null {
    if (!this.root) return null;
    if (!this.selected) return this.root;
    const row = this.el.querySelector(`.tree-row[data-path="${CSS.escape(this.selected)}"]`);
    return row?.classList.contains("dir") ? this.selected : dirname(this.selected);
  }

  async newFile(dir = this.targetDir()) {
    if (!dir) return;
    const name = await inputBox({ title: t("tree.newFile"), placeholder: "main.py" });
    if (!name) return;
    const path = join(dir, name);
    try {
      await fs.createFile(path);
      this.expanded.add(dir);
      await this.refresh();
      this.deps.onChanged();
      this.deps.openFile(path);
    } catch (err) {
      toast(t("tree.createFailed", { name, err: String(err) }), "error");
    }
  }

  async newFolder(dir = this.targetDir()) {
    if (!dir) return;
    const name = await inputBox({ title: t("tree.newFolder"), placeholder: "src" });
    if (!name) return;
    try {
      await fs.createDir(join(dir, name));
      this.expanded.add(dir);
      await this.refresh();
      this.deps.onChanged();
    } catch (err) {
      toast(t("tree.createFailed", { name, err: String(err) }), "error");
    }
  }

  private async rename(path: string) {
    const name = await inputBox({ title: t("tree.rename"), value: basename(path), selectStem: true, okLabel: t("tree.rename") });
    if (!name || name === basename(path)) return;
    const to = join(dirname(path), name);
    try {
      await fs.rename(path, to);
      if (this.expanded.delete(path)) this.expanded.add(to);
      await this.refresh();
      this.deps.onRenamed(path, to);
      this.deps.onChanged();
    } catch (err) {
      toast(t("tree.renameFailed", { err: String(err) }), "error");
    }
  }

  private async remove(path: string) {
    const ok = await confirmBox(t("tree.deleteTitle", { name: basename(path) }), t("tree.deleteMessage"), t("tree.delete"), true);
    if (!ok) return;
    try {
      await fs.remove(path);
      await this.refresh();
      this.deps.onDeleted(path);
      this.deps.onChanged();
    } catch (err) {
      toast(t("tree.deleteFailed", { err: String(err) }), "error");
    }
  }
}
