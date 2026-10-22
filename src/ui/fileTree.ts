// エクスプローラー（ファイルツリー）。フォルダは開いたときに読み込む
import { fs, type DirEntry } from "../core/platform";
import { h, clear } from "../core/dom";
import { t } from "../core/i18n";
import { basename, dirname, join } from "../core/paths";
import { icon } from "./icons";
import { confirmBox, inputBox } from "./dialog";
import { toast } from "./toast";

export interface FileTreeDeps {
  openFile: (path: string) => void;
  onRenamed: (from: string, to: string) => void;
  onDeleted: (path: string) => void;
  onChanged: () => void;
  /** 右クリックに足す項目（グループに追加など） */
  extraMenu?: (path: string, isDir: boolean) => { label: string; run: () => void }[];
}

interface MenuItem {
  label: string;
  run: () => void;
  danger?: boolean;
}

export function contextMenu(x: number, y: number, items: MenuItem[]) {
  document.querySelector(".context-menu")?.remove();
  const menu = h(
    "div",
    { class: "context-menu", role: "menu" },
    ...items.map((it) =>
      h("button", { class: "context-item" + (it.danger ? " danger" : ""), role: "menuitem", onclick: () => (menu.remove(), it.run()) }, it.label),
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
  (menu.querySelector("button") as HTMLElement | null)?.focus();
}

export class FileTree {
  readonly el: HTMLElement;
  private root: string | null = null;
  private expanded = new Set<string>();
  private selected: string | null = null;
  private activeFile: string | null = null;
  private gitFiles = new Map<string, string>();
  private gitDirs = new Set<string>();

  constructor(private deps: FileTreeDeps) {
    this.el = h("div", { class: "tree", role: "tree" });
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
    for (const e of entries) group.append(await this.renderEntry(e, depth));
    if (!entries.length && depth > 0) group.append(h("div", { class: "tree-empty", style: `padding-left:${12 + (depth + 1) * 14}px` }, t("tree.emptyFolder")));
    return group;
  }

  private async renderEntry(e: DirEntry, depth: number): Promise<HTMLElement> {
    const open = e.isDir && this.expanded.has(e.path);
    const row = h(
      "div",
      {
        class: "tree-row" + (e.isDir ? " dir" : "") + (e.name.startsWith(".") ? " hidden-file" : "") + (this.selected === e.path ? " selected" : ""),
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

    row.addEventListener("click", async () => {
      this.selected = e.path;
      this.el.querySelectorAll(".tree-row.selected").forEach((r) => r.classList.remove("selected"));
      row.classList.add("selected");
      if (e.isDir) {
        if (this.expanded.has(e.path)) this.expanded.delete(e.path);
        else this.expanded.add(e.path);
        const fresh = await this.renderEntry(e, depth);
        wrap.replaceWith(fresh);
      } else {
        this.deps.openFile(e.path);
      }
    });
    // グループへドラッグで入れられるように
    if (!e.isDir) {
      row.draggable = true;
      row.addEventListener("dragstart", (ev) => {
        ev.dataTransfer?.setData("text/x-aizome-path", e.path);
        ev.dataTransfer?.setData("text/plain", e.path);
      });
    }
    row.addEventListener("contextmenu", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      this.menuFor(e.path, e.isDir, ev.clientX, ev.clientY);
    });
    return wrap;
  }

  private menuFor(path: string, isDir: boolean, x: number, y: number) {
    const dir = isDir ? path : dirname(path);
    const items: MenuItem[] = [
      { label: t("tree.newFile"), run: () => this.newFile(dir) },
      { label: t("tree.newFolder"), run: () => this.newFolder(dir) },
    ];
    if (path !== this.root) {
      items.push({ label: t("tree.rename"), run: () => this.rename(path) });
      items.push({ label: t("tree.delete"), run: () => this.remove(path), danger: true });
    }
    items.push({ label: t("tree.copyPath"), run: () => navigator.clipboard?.writeText(path) });
    if (!isDir && this.deps.extraMenu) items.push(...this.deps.extraMenu(path, isDir));
    contextMenu(x, y, items);
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
