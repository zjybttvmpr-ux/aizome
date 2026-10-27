// グループ：ファイルを「授業関係」「課題 3」のように名前を付けてまとめる（ファイルの場所は動かさない）。
// まとめて開く・閉じる、ドラッグで追加、名前の変更ができる（エクスプローラーの上）
import { h, clear } from "../core/dom";
import { settings } from "../core/settings";
import { t } from "../core/i18n";
import { basename, relative, isInside } from "../core/paths";
import { icon } from "./icons";
import { inputBox, confirmBox } from "./dialog";
import { toast } from "./toast";
import { fs } from "../core/platform";
import { contextMenu } from "./fileTree";

export interface FileGroup {
  name: string;
  files: string[];
  open?: boolean;
}

export interface FileGroupsDeps {
  root: () => string | null;
  openFile: (path: string) => void;
  activePath: () => string | null;
  closeFiles: (paths: string[]) => void;
  /** いま開いているファイル（保存してあるものだけ） */
  openPaths?: () => string[];
}

/** フォルダの中のファイルを集めるときに飛ばすフォルダ */
const SKIP_DIRS = /^(\.git|\.svn|node_modules|__pycache__|\.venv|venv|Library|Temp|Logs|obj|bin|build|dist|target|\.idea|\.vs|\.vscode)$/;
const MAX_FILES = 300;

/** フォルダの中のファイル（下のフォルダもふくめて、最大 300 個） */
async function filesIn(dir: string, depth = 0, out: string[] = []): Promise<string[]> {
  if (depth > 6 || out.length >= MAX_FILES) return out;
  let entries: Awaited<ReturnType<typeof fs.listDir>> = [];
  try {
    entries = await fs.listDir(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    if (out.length >= MAX_FILES) break;
    if (e.name.startsWith(".")) continue;
    if (e.isDir) {
      if (!SKIP_DIRS.test(e.name)) await filesIn(e.path, depth + 1, out);
    } else if (!/\.(meta|pyc|exe|dll|obj|o|class)$/i.test(e.name)) out.push(e.path);
  }
  return out;
}

/** ドラッグや右クリックで渡されたもの（"dir:" 付きはフォルダ）を、ファイルの一覧にする */
async function expand(items: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const it of items) {
    if (it.startsWith("dir:")) out.push(...(await filesIn(it.slice(4))));
    else if (it) out.push(it);
  }
  return [...new Set(out)];
}

/** ファイルツリーからドラッグするときの種類 */
export const DRAG_TYPE = "text/x-aizome-path";

export function createFileGroups(deps: FileGroupsDeps) {
  const body = h("div", { class: "side-section-body groups-body" });
  const addBtn = h("button", { class: "icon-btn", type: "button", title: t("groups.new"), "aria-label": t("groups.new"), html: icon("plus", 13) });
  const head = h(
    "div",
    { class: "side-section-head", role: "button", tabindex: 0 },
    h("span", { class: "side-section-arrow", html: icon("chevron", 11) }),
    h("span", { class: "side-section-title" }, t("groups.title")),
    addBtn,
  );
  const el = h("section", { class: "side-section groups" }, head, body);
  el.classList.toggle("open", settings.get("explorer.groupsOpen"));
  head.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest("button")) return;
    const open = !el.classList.contains("open");
    el.classList.toggle("open", open);
    settings.set("explorer.groupsOpen", open);
  });

  const key = () => deps.root() ?? "*";
  const load = (): FileGroup[] => (settings.get("explorer.groups") ?? {})[key()] ?? [];
  const save = (groups: FileGroup[]) => {
    settings.set("explorer.groups", { ...(settings.get("explorer.groups") ?? {}), [key()]: groups });
    render();
  };

  async function newGroup(withFile?: string | string[], suggested?: string): Promise<void> {
    const files = await expand(typeof withFile === "string" ? [withFile] : withFile ?? []);
    const name = await inputBox({ title: files.length > 1 ? t("groups.newMany", { n: String(files.length) }) : t("groups.new"), value: suggested ?? "", placeholder: t("groups.placeholder"), okLabel: t("groups.create") });
    if (!name?.trim()) return;
    const groups = load();
    if (groups.some((g) => g.name === name.trim())) return toast(t("groups.exists", { name }), "warn");
    groups.push({ name: name.trim(), files, open: true });
    el.classList.add("open");
    settings.set("explorer.groupsOpen", true);
    save(groups);
    if (files.length > 1) toast(t("groups.addedMany", { n: String(files.length), name: name.trim() }), "success", 3000);
  }

  function addTo(groupName: string, path: string) {
    void addMany(groupName, [path]);
  }

  /** まとめてグループに入れる（フォルダは中のファイルごと） */
  async function addMany(groupName: string, items: string[]) {
    const paths = await expand(items);
    const groups = load();
    const g = groups.find((x) => x.name === groupName);
    if (!g || !paths.length) {
      if (!paths.length) toast(t("groups.nothing"), "info");
      return;
    }
    const fresh = paths.filter((p) => !g.files.includes(p));
    g.files.push(...fresh);
    g.open = true;
    save(groups);
    if (paths.length === 1) toast(fresh.length ? t("groups.added", { file: basename(paths[0]), name: groupName }) : t("groups.already", { name: groupName }), fresh.length ? "success" : "info", 2500);
    else toast(t("groups.addedManySkip", { n: String(fresh.length), name: groupName, skip: String(paths.length - fresh.length) }), "success", 3500);
  }

  addBtn.addEventListener("click", () => void newGroup(deps.activePath() ?? undefined));

  // ───── グループの中のファイルをまとめて選ぶ（Ctrl / Shift を押しながらクリック）
  const picked = new Set<string>();
  const pickKey = (g: string, f: string) => `${g}\u0000${f}`;
  let pickAnchor: string | null = null;
  const pickedIn = (g: string) => [...picked].filter((k) => k.startsWith(g + "\u0000")).map((k) => k.slice(g.length + 1));
  function removeFiles(groupName: string, files: string[]) {
    const groups = load();
    const target = groups.find((x) => x.name === groupName);
    if (target) target.files = target.files.filter((x) => !files.includes(x));
    for (const f of files) picked.delete(pickKey(groupName, f));
    save(groups);
  }
  function setOpenAll(open: boolean) {
    save(load().map((g) => ({ ...g, open })));
  }

  // 「グループ」の見出しを右クリック：まとめて広げる・たたむ・消す
  head.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    const groups = load();
    if (!groups.length) return;
    contextMenu(e.clientX, e.clientY, [
      { label: t("groups.expandAll"), run: () => setOpenAll(true) },
      { label: t("groups.collapseAll"), run: () => setOpenAll(false) },
      { label: t("groups.openEvery"), run: () => groups.forEach((g) => g.files.forEach((f) => deps.openFile(f))) },
      ...(picked.size ? [{ label: t("tree.selectNone"), run: () => (picked.clear(), render()) }] : []),
      { label: "", sep: true },
      {
        label: t("groups.deleteAll", { n: String(groups.length) }),
        danger: true,
        run: async () => {
          if (!(await confirmBox(t("groups.deleteAllTitle", { n: String(groups.length) }), t("groups.deleteMessage"), t("groups.delete"), true))) return;
          picked.clear();
          save([]);
        },
      },
    ]);
  });

  function groupMenu(g: FileGroup, anchor: HTMLElement) {
    document.querySelector(".context-menu")?.remove();
    const r = anchor.getBoundingClientRect();
    const items: { label: string; run: () => void; danger?: boolean }[] = [
      { label: t("groups.openAll"), run: () => g.files.forEach((f) => deps.openFile(f)) },
      { label: t("groups.closeAll"), run: () => deps.closeFiles(g.files) },
      {
        label: t("groups.addCurrent"),
        run: () => {
          const p = deps.activePath();
          if (p) addTo(g.name, p);
          else toast(t("groups.noActive"), "info");
        },
      },
      {
        label: t("groups.selectAllIn"),
        run: () => {
          for (const f of g.files) picked.add(pickKey(g.name, f));
          const groups = load();
          const target = groups.find((x) => x.name === g.name);
          if (target) target.open = true;
          save(groups);
        },
      },
      {
        label: t("groups.clear"),
        run: async () => {
          if (!g.files.length) return;
          if (!(await confirmBox(t("groups.clearTitle", { name: g.name }), t("groups.deleteMessage"), t("groups.clear"), true))) return;
          removeFiles(g.name, [...g.files]);
        },
      },
      {
        label: t("groups.addOpen"),
        run: () => {
          const list = deps.openPaths?.() ?? [];
          if (list.length) void addMany(g.name, list);
          else toast(t("groups.noActive"), "info");
        },
      },
      {
        label: t("groups.rename"),
        run: async () => {
          const name = await inputBox({ title: t("groups.rename"), value: g.name });
          if (!name?.trim()) return;
          const groups = load();
          const target = groups.find((x) => x.name === g.name);
          if (target) target.name = name.trim();
          save(groups);
        },
      },
      {
        label: t("groups.delete"),
        danger: true,
        run: async () => {
          if (!(await confirmBox(t("groups.deleteTitle", { name: g.name }), t("groups.deleteMessage"), t("groups.delete"), true))) return;
          save(load().filter((x) => x.name !== g.name));
        },
      },
    ];
    const menu = h(
      "div",
      { class: "context-menu", role: "menu" },
      ...items.map((it) => h("button", { class: "context-item" + (it.danger ? " danger" : ""), type: "button", onclick: () => (menu.remove(), void it.run()) }, it.label)),
    );
    menu.style.left = `${r.left}px`;
    menu.style.top = `${r.bottom + 2}px`;
    document.body.append(menu);
    const off = (e: Event) => {
      if (!menu.contains(e.target as Node)) {
        menu.remove();
        document.removeEventListener("mousedown", off, true);
      }
    };
    setTimeout(() => document.addEventListener("mousedown", off, true));
  }

  function acceptDrop(target: HTMLElement, groupName: string | null) {
    target.addEventListener("dragover", (e) => {
      if (!e.dataTransfer?.types.includes(DRAG_TYPE)) return;
      e.preventDefault();
      target.classList.add("drop");
    });
    target.addEventListener("dragleave", () => target.classList.remove("drop"));
    target.addEventListener("drop", (e) => {
      target.classList.remove("drop");
      const data = e.dataTransfer?.getData(DRAG_TYPE);
      if (!data) return;
      e.preventDefault();
      const items = data.split("\n").filter(Boolean);
      const folder = items.length === 1 && items[0].startsWith("dir:") ? basename(items[0].slice(4)) : undefined;
      if (groupName) void addMany(groupName, items);
      else void newGroup(items, folder);
    });
  }
  acceptDrop(head, null);

  function render() {
    clear(body);
    el.hidden = !settings.get("ui.fileGroups");
    const groups = load();
    const active = deps.activePath();
    if (!groups.length) {
      body.append(h("p", { class: "side-section-empty" }, t("groups.empty")));
      return;
    }
    for (const g of groups) {
      const arrow = h("span", { class: "side-section-arrow", html: icon("chevron", 11) });
      const more = h("button", { class: "icon-btn", type: "button", title: t("groups.more"), "aria-label": t("groups.more") }, "⋯");
      const openAll = h("button", { class: "icon-btn", type: "button", title: t("groups.openAll"), "aria-label": t("groups.openAll"), html: icon("folderOpen", 13) });
      const header = h(
        "div",
        { class: "group-head" + (g.open ? " open" : "") },
        arrow,
        h("span", { class: "group-name" }, g.name),
        h("span", { class: "side-section-count" }, String(g.files.length)),
        openAll,
        more,
      );
      header.addEventListener("click", (e) => {
        if ((e.target as HTMLElement).closest("button")) return;
        const groupsNow = load();
        const target = groupsNow.find((x) => x.name === g.name);
        if (target) target.open = !target.open;
        save(groupsNow);
      });
      openAll.addEventListener("click", () => g.files.forEach((f) => deps.openFile(f)));
      more.addEventListener("click", () => groupMenu(g, more));
      acceptDrop(header, g.name);
      body.append(header);
      if (!g.open) continue;
      const root = deps.root();
      for (const f of g.files) {
        const remove = h("button", { class: "icon-btn group-remove", type: "button", title: t("groups.removeFile"), "aria-label": t("groups.removeFile"), html: icon("x", 11) });
        const row = h(
          "div",
          { class: "group-file" + (f === active ? " active" : "") + (picked.has(pickKey(g.name, f)) ? " selected" : ""), title: f },
          h("span", { html: icon("file", 13) }),
          h("span", { class: "group-file-name" }, basename(f)),
          h("span", { class: "group-file-dir" }, root && isInside(root, f) ? relative(root, f).split(/[\\/]/).slice(0, -1).join("/") : ""),
          remove,
        );
        row.addEventListener("click", (e) => {
          if ((e.target as HTMLElement).closest(".group-remove")) return;
          if (e.ctrlKey || e.metaKey || e.shiftKey) {
            const k = pickKey(g.name, f);
            if (e.shiftKey && pickAnchor?.startsWith(g.name + "\u0000")) {
              const a = g.files.indexOf(pickAnchor.slice(g.name.length + 1));
              const b = g.files.indexOf(f);
              for (const x of g.files.slice(Math.min(a, b), Math.max(a, b) + 1)) picked.add(pickKey(g.name, x));
            } else if (picked.has(k)) picked.delete(k);
            else picked.add(k);
            pickAnchor = k;
            render();
            return;
          }
          picked.clear();
          pickAnchor = pickKey(g.name, f);
          deps.openFile(f);
          render();
        });
        row.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          const sel = picked.has(pickKey(g.name, f)) ? pickedIn(g.name) : [f];
          const n = String(sel.length);
          contextMenu(e.clientX, e.clientY, [
            ...(sel.length > 1 ? [{ label: t("tree.selectedCount", { n }), note: true }] : []),
            { label: sel.length > 1 ? t("tree.openMany", { n }) : t("groups.openFile"), run: () => sel.forEach((x) => deps.openFile(x)) },
            { label: t("groups.selectAllIn"), run: () => (g.files.forEach((x) => picked.add(pickKey(g.name, x))), render()) },
            ...(picked.size ? [{ label: t("tree.selectNone"), run: () => (picked.clear(), render()) }] : []),
            { label: sel.length > 1 ? t("groups.removeMany", { n }) : t("groups.removeFile"), run: () => removeFiles(g.name, sel), danger: true },
          ]);
        });
        remove.addEventListener("click", () => {
          // まとめて選んでいるものの × なら、選んだものを全部外す
          removeFiles(g.name, picked.has(pickKey(g.name, f)) ? pickedIn(g.name) : [f]);
        });
        body.append(row);
      }
    }
  }

  /** ファイルツリーの右クリックに足す項目（選んでいるものすべて・フォルダは中のファイルごと） */
  function menuItemsFor(path: string, isDir = false, selected: string[] = [path], dirOf: (p: string) => boolean = () => isDir): { label: string; run: () => void }[] {
    const list = selected.length ? selected : [path];
    const items = list.map((p) => (dirOf(p) ? `dir:${p}` : p));
    const many = list.length > 1;
    const folderOnly = !many && isDir;
    const label = (key: string, name?: string) =>
      t(many ? `${key}Many` : folderOnly ? `${key}Folder` : key, { name: name ?? "", n: String(list.length) });
    const out = load().map((g) => ({ label: label("groups.addTo", g.name), run: () => void addMany(g.name, items) }));
    out.push({ label: label("groups.newWith"), run: () => void newGroup(items, folderOnly ? basename(path) : undefined) });
    return out;
  }

  return { el, render, menuItemsFor, newGroup };
}
