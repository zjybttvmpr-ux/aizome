// グループ：ファイルを「授業関係」「課題 3」のように名前を付けてまとめる（ファイルの場所は動かさない）。
// まとめて開く・閉じる、ドラッグで追加、名前の変更ができる（エクスプローラーの上）
import { h, clear } from "../core/dom";
import { settings } from "../core/settings";
import { t } from "../core/i18n";
import { basename, relative, isInside } from "../core/paths";
import { icon } from "./icons";
import { inputBox, confirmBox } from "./dialog";
import { toast } from "./toast";

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

  async function newGroup(withFile?: string): Promise<void> {
    const name = await inputBox({ title: t("groups.new"), placeholder: t("groups.placeholder"), okLabel: t("groups.create") });
    if (!name?.trim()) return;
    const groups = load();
    if (groups.some((g) => g.name === name.trim())) return toast(t("groups.exists", { name }), "warn");
    groups.push({ name: name.trim(), files: withFile ? [withFile] : [], open: true });
    el.classList.add("open");
    settings.set("explorer.groupsOpen", true);
    save(groups);
  }

  function addTo(groupName: string, path: string) {
    const groups = load();
    const g = groups.find((x) => x.name === groupName);
    if (!g) return;
    if (!g.files.includes(path)) g.files.push(path);
    g.open = true;
    save(groups);
    toast(t("groups.added", { file: basename(path), name: groupName }), "success", 2500);
  }

  addBtn.addEventListener("click", () => void newGroup(deps.activePath() ?? undefined));

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
      const path = e.dataTransfer?.getData(DRAG_TYPE);
      if (!path) return;
      e.preventDefault();
      if (groupName) addTo(groupName, path);
      else void newGroup(path);
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
          { class: "group-file" + (f === active ? " active" : ""), title: f },
          h("span", { html: icon("file", 13) }),
          h("span", { class: "group-file-name" }, basename(f)),
          h("span", { class: "group-file-dir" }, root && isInside(root, f) ? relative(root, f).split(/[\\/]/).slice(0, -1).join("/") : ""),
          remove,
        );
        row.addEventListener("click", (e) => {
          if ((e.target as HTMLElement).closest(".group-remove")) return;
          deps.openFile(f);
        });
        remove.addEventListener("click", () => {
          const groupsNow = load();
          const target = groupsNow.find((x) => x.name === g.name);
          if (target) target.files = target.files.filter((x) => x !== f);
          save(groupsNow);
        });
        body.append(row);
      }
    }
  }

  /** ファイルツリーの右クリックに足す項目 */
  function menuItemsFor(path: string): { label: string; run: () => void }[] {
    const items = load().map((g) => ({ label: t("groups.addTo", { name: g.name }), run: () => addTo(g.name, path) }));
    items.push({ label: t("groups.newWith"), run: () => void newGroup(path) });
    return items;
  }

  return { el, render, menuItemsFor, newGroup };
}
