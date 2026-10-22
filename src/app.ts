// アプリ全体の組み立て：レイアウト、タブ、ファイル操作、コマンド、ステータスバー
import { h, clear } from "./core/dom";
import { t } from "./core/i18n";
import { bus } from "./core/events";
import { settings } from "./core/settings";
import { commands, formatKey, installKeybindings } from "./core/commands";
import { fs, dialog, sys, type SysInfo } from "./core/platform";
import { basename, dirname, isInside, resolveIn } from "./core/paths";
import { createEditorHost } from "./editor/editor";
import type { EditorHost } from "./editor/types";
import { TerminalPanel } from "./terminal/panel";
import { expandCommand, findRunConfig } from "./terminal/runner";
import { FileTree } from "./ui/fileTree";
import { createExtensionsView } from "./ui/extensionsView";
import { createSettingsView } from "./ui/settingsView";
import { applyTheme, listThemes } from "./ui/themes";
import { choose, inputBox } from "./ui/dialog";
import { toast } from "./ui/toast";
import { icon } from "./ui/icons";
import { openCommandPalette, openQuickOpen, quickPick } from "./ui/palette";
import { completer, type AiStatus } from "./ai/completer";
import { ExtensionHost } from "./extensions/host";

interface Doc {
  id: string;
  path: string | null;
  name: string;
  dirty: boolean;
}

type ViewName = "explorer" | "extensions" | "settings";

export class App {
  private editor: EditorHost = createEditorHost();
  private docs: Doc[] = [];
  private activeId: string | null = null;
  private root: string | null = null;
  private fileIndex: string[] = [];
  private untitledSeq = 0;
  private lastRunDir: string | null = null;
  private sys: SysInfo = { os: "unknown", home: "", defaultShell: "", pathSep: "/" };
  private statusItems = new Map<string, { text: string; tooltip?: string }>();

  // DOM
  private el!: HTMLElement;
  private tabsEl!: HTMLElement;
  private editorMount!: HTMLElement;
  private welcomeEl!: HTMLElement;
  private sidebarEl!: HTMLElement;
  private sidebarTitle!: HTMLElement;
  private sidebarActions!: HTMLElement;
  private views = new Map<ViewName, HTMLElement>();
  private activityButtons = new Map<ViewName, HTMLElement>();
  private currentView: ViewName = "explorer";
  private workspaceLabel!: HTMLElement;
  private aiPill!: HTMLElement;
  private statusLeft!: HTMLElement;
  private statusRight!: HTMLElement;
  private explorerEmpty!: HTMLElement;

  private tree: FileTree;
  private terminal: TerminalPanel;
  private extensions: ExtensionHost;

  constructor(private mountPoint: HTMLElement) {
    this.tree = new FileTree({
      openFile: (p) => void this.openFile(p),
      onRenamed: (from, to) => this.handleRenamed(from, to),
      onDeleted: (p) => this.handleDeleted(p),
      onChanged: () => void this.reindex(),
    });
    this.terminal = new TerminalPanel({
      cwd: () => this.root ?? undefined,
      openLocation: (p, l, c) => void this.openLocation(p, l, c),
      onVisibilityChange: (v) => this.el.classList.toggle("panel-open", v),
    });
    this.extensions = new ExtensionHost({
      editor: this.editor,
      activePath: () => this.activeDoc()?.path ?? null,
      root: () => this.root,
      openFile: (p) => this.openFile(p),
      runInTerminal: (cmd) => this.terminal.send(cmd),
      setStatusItem: (key, text, tooltip) => {
        if (text === null) this.statusItems.delete(key);
        else this.statusItems.set(key, { text, tooltip });
        this.renderStatus();
      },
    });
  }

  async start() {
    this.build();
    this.registerCommands();
    installKeybindings();
    this.bindEvents();

    try {
      this.sys = await sys.info();
    } catch (err) {
      console.warn("sys_info", err);
    }
    await this.extensions.loadAll();
    applyTheme(settings.get("ui.theme"));

    const last = settings.get("workspace.last");
    if (last && (await fs.exists(last).catch(() => false))) await this.setRoot(last);
    else this.renderExplorerState();
    this.renderTabs();
    this.renderStatus();
  }

  // ───────────── レイアウト

  private build() {
    const button = (name: string, label: string, onclick: () => void, extra = "") =>
      h("button", { class: `icon-btn ${extra}`, title: label, "aria-label": label, onclick, html: icon(name, 16) });

    this.workspaceLabel = h("span", { class: "workspace-name" });
    this.aiPill = h("button", { class: "ai-pill", onclick: () => this.onAiPillClick() });
    const paletteKey = formatKey("Mod-P");

    const topbar = h(
      "header",
      { class: "topbar" },
      h("div", { class: "brand" }, h("span", { class: "brand-mark", "aria-hidden": "true" }, "藍"), h("span", { class: "brand-name" }, "Aizome")),
      this.workspaceLabel,
      h(
        "button",
        { class: "palette-trigger", onclick: () => this.quickOpen() },
        h("span", { html: icon("search", 14) }),
        h("span", { class: "palette-trigger-text" }, t("top.search")),
        h("kbd", {}, paletteKey),
      ),
      h(
        "div",
        { class: "top-actions" },
        this.aiPill,
        h(
          "button",
          { class: "run-btn", title: `${t("cmd.run")} (F5)`, onclick: () => this.runActive() },
          h("span", { html: icon("play", 13) }),
          h("span", {}, t("top.run")),
        ),
      ),
    );

    const activity = h("nav", { class: "activity", "aria-label": t("activity.label") });
    const addActivity = (view: ViewName, name: string, label: string) => {
      const b = button(name, label, () => this.toggleView(view), "activity-btn");
      this.activityButtons.set(view, b);
      activity.append(b);
    };
    addActivity("explorer", "files", t("view.explorer"));
    addActivity("extensions", "puzzle", t("view.extensions"));
    activity.append(h("div", { class: "activity-spacer" }));
    activity.append(button("terminal", t("cmd.toggleTerminal"), () => this.terminal.toggle(), "activity-btn"));
    addActivity("settings", "gear", t("view.settings"));

    this.sidebarTitle = h("h2", { class: "sidebar-title" });
    this.sidebarActions = h("div", { class: "sidebar-actions" });
    this.explorerEmpty = h(
      "div",
      { class: "explorer-empty" },
      h("p", {}, t("explorer.empty")),
      h("button", { class: "btn primary", onclick: () => this.openFolder() }, t("cmd.openFolder")),
    );
    const explorer = h("div", { class: "view explorer-view" }, this.explorerEmpty, this.tree.el);
    this.views.set("explorer", explorer);
    this.views.set("extensions", createExtensionsView(this.extensions));
    this.views.set("settings", createSettingsView());
    const viewsHost = h("div", { class: "sidebar-body" }, ...this.views.values());
    this.sidebarEl = h("aside", { class: "sidebar" }, h("div", { class: "sidebar-head" }, this.sidebarTitle, this.sidebarActions), viewsHost);

    const sideResizer = h("div", { class: "resizer resizer-x", role: "separator", "aria-orientation": "vertical" });
    const panelResizer = h("div", { class: "resizer resizer-y", role: "separator", "aria-orientation": "horizontal" });

    this.tabsEl = h("div", { class: "tabs", role: "tablist" });
    this.editorMount = h("div", { class: "editor-mount" });
    this.welcomeEl = this.buildWelcome();
    const editorArea = h("div", { class: "editor-area" }, this.editorMount, this.welcomeEl);
    const main = h("main", { class: "main" }, this.tabsEl, editorArea, panelResizer, this.terminal.el);

    this.statusLeft = h("div", { class: "status-left" });
    this.statusRight = h("div", { class: "status-right" });
    const statusbar = h("footer", { class: "statusbar" }, this.statusLeft, this.statusRight);

    this.el = h("div", { class: "app" }, topbar, h("div", { class: "body" }, activity, this.sidebarEl, sideResizer, main), statusbar);
    this.el.style.setProperty("--side-w", `${settings.get("ui.sidebarWidth")}px`);
    this.el.style.setProperty("--panel-h", `${settings.get("ui.panelHeight")}px`);
    this.mountPoint.append(this.el);

    this.editor.mount(this.editorMount);
    this.showView("explorer");
    this.dragResize(sideResizer, "x");
    this.dragResize(panelResizer, "y");
    this.renderAi(completer.status);
  }

  private buildWelcome(): HTMLElement {
    const row = (cmd: string, label: string) => {
      const c = commands.get(cmd);
      return h(
        "button",
        { class: "welcome-action", onclick: () => commands.execute(cmd) },
        h("span", {}, label),
        c?.key ? h("kbd", {}, formatKey(c.key)) : null,
      );
    };
    // コマンド登録前に呼ばれるので、キー表示は後から差し込む
    const el = h("div", { class: "welcome" });
    const fill = () => {
      clear(el);
      el.append(
        h("div", { class: "welcome-mark", "aria-hidden": "true" }, "藍"),
        h("h1", { class: "welcome-title" }, "Aizome"),
        h("p", { class: "welcome-lead" }, t("welcome.lead")),
        h(
          "div",
          { class: "welcome-actions" },
          row("file.openFolder", t("cmd.openFolder")),
          row("file.new", t("cmd.newFile")),
          row("file.quickOpen", t("cmd.quickOpen")),
          row("view.commandPalette", t("cmd.commandPalette")),
          row("terminal.toggle", t("cmd.toggleTerminal")),
        ),
        h("p", { class: "welcome-hint" }, t("welcome.aiHint")),
      );
    };
    queueMicrotask(fill);
    bus.on("settings:changed", ({ key }) => key === "ui.language" && fill());
    return el;
  }

  private dragResize(handle: HTMLElement, axis: "x" | "y") {
    handle.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      handle.classList.add("dragging");
      const startPos = axis === "x" ? e.clientX : e.clientY;
      const start = axis === "x" ? settings.get("ui.sidebarWidth") : settings.get("ui.panelHeight");
      let value = start;
      const move = (ev: PointerEvent) => {
        const delta = (axis === "x" ? ev.clientX : ev.clientY) - startPos;
        if (axis === "x") {
          value = Math.round(Math.min(560, Math.max(180, start + delta)));
          this.el.style.setProperty("--side-w", `${value}px`);
        } else {
          value = Math.round(Math.min(innerHeight - 200, Math.max(120, start - delta)));
          this.el.style.setProperty("--panel-h", `${value}px`);
        }
      };
      const up = () => {
        handle.classList.remove("dragging");
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", up);
        settings.set(axis === "x" ? "ui.sidebarWidth" : "ui.panelHeight", value);
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", up);
    });
  }

  // ───────────── サイドバー

  private showView(view: ViewName) {
    this.currentView = view;
    this.el.classList.remove("sidebar-hidden");
    for (const [name, el] of this.views) {
      const on = name === view;
      el.hidden = !on;
      if (on) el.dispatchEvent(new Event("view:show"));
    }
    for (const [name, b] of this.activityButtons) b.classList.toggle("active", name === view);
    this.sidebarTitle.textContent = t(`view.${view}`);
    clear(this.sidebarActions);
    if (view === "explorer" && this.root) {
      const b = (name: string, label: string, fn: () => void) =>
        h("button", { class: "icon-btn", title: label, "aria-label": label, html: icon(name, 15), onclick: fn });
      this.sidebarActions.append(
        b("newFile", t("tree.newFile"), () => this.tree.newFile()),
        b("newFolder", t("tree.newFolder"), () => this.tree.newFolder()),
        b("refresh", t("tree.refresh"), () => void this.tree.refresh().then(() => this.reindex())),
        b("folderOpen", t("cmd.openFolder"), () => this.openFolder()),
      );
    }
  }

  private toggleView(view: ViewName) {
    if (this.currentView === view && !this.el.classList.contains("sidebar-hidden")) {
      this.el.classList.add("sidebar-hidden");
      for (const b of this.activityButtons.values()) b.classList.remove("active");
    } else this.showView(view);
  }

  private renderExplorerState() {
    this.explorerEmpty.hidden = !!this.root;
    this.tree.el.hidden = !this.root;
    this.workspaceLabel.textContent = this.root ? basename(this.root) : "";
    this.workspaceLabel.title = this.root ?? "";
    if (this.currentView === "explorer") this.showView("explorer");
  }

  // ───────────── ワークスペースとファイル

  async openFolder(path?: string) {
    const picked = path ?? (await dialog.pickFolder());
    if (picked) await this.setRoot(picked);
  }

  private async setRoot(root: string) {
    this.root = root;
    settings.set("workspace.last", root);
    await this.tree.setRoot(root);
    this.renderExplorerState();
    bus.emit("workspace:changed", { root });
    await this.reindex();
  }

  private async reindex() {
    if (!this.root) return;
    try {
      this.fileIndex = await fs.walk(this.root, 20000);
    } catch {
      this.fileIndex = [];
    }
  }

  private quickOpen() {
    if (!this.root) {
      void openCommandPalette();
      return;
    }
    void openQuickOpen(() => this.fileIndex, this.root, (p) => void this.openFile(p));
  }

  private activeDoc(): Doc | undefined {
    return this.docs.find((d) => d.id === this.activeId);
  }

  async openFile(path: string, line?: number, col?: number) {
    let doc = this.docs.find((d) => d.path === path);
    if (!doc) {
      let text: string;
      try {
        text = await fs.readFile(path);
      } catch (err) {
        const msg = String(err);
        toast(
          msg.includes("BINARY_FILE") ? t("file.binary", { name: basename(path) }) : msg.includes("FILE_TOO_LARGE") ? t("file.tooLarge", { name: basename(path) }) : t("file.openFailed", { name: basename(path), err: msg }),
          "warn",
        );
        return;
      }
      doc = { id: path, path, name: basename(path), dirty: false };
      this.docs.push(doc);
      await this.editor.open(doc.id, text, doc.name);
      bus.emit("file:opened", { path });
    }
    this.activate(doc.id);
    if (line) requestAnimationFrame(() => this.editor.goTo(line, col));
  }

  private async openLocation(p: string, line: number, col: number) {
    const candidates = [p];
    if (this.lastRunDir) candidates.push(resolveIn(this.lastRunDir, p));
    if (this.root) candidates.push(resolveIn(this.root, p));
    for (const c of candidates) {
      if (/^([A-Za-z]:[\\/]|\/)/.test(c) && (await fs.exists(c).catch(() => false))) {
        await this.openFile(c, line, col);
        return;
      }
    }
    toast(t("file.notFound", { name: p }), "warn");
  }

  newUntitled() {
    const id = `untitled:${++this.untitledSeq}`;
    const doc: Doc = { id, path: null, name: t("file.untitled", { n: String(this.untitledSeq) }), dirty: false };
    this.docs.push(doc);
    void this.editor.open(id, "", "untitled.txt").then(() => this.activate(id));
  }

  private activate(id: string) {
    this.activeId = id;
    this.editor.activate(id);
    const doc = this.activeDoc();
    this.tree.setActive(doc?.path ?? null);
    this.renderTabs();
    this.renderStatus();
    document.title = doc ? `${doc.dirty ? "● " : ""}${doc.name} — Aizome` : "Aizome";
    bus.emit("active:changed", { path: doc?.path ?? null });
  }

  async save(id = this.activeId, forceAs = false): Promise<boolean> {
    const doc = this.docs.find((d) => d.id === id);
    if (!doc) return false;
    let path = doc.path;
    if (!path || forceAs) {
      path = await dialog.saveFile(this.root ? resolveIn(this.root, doc.path ? basename(doc.path) : "untitled.txt") : undefined);
      if (!path) return false;
    }
    try {
      await fs.writeFile(path, this.editor.getText(doc.id));
    } catch (err) {
      toast(t("file.saveFailed", { name: doc.name, err: String(err) }), "error");
      return false;
    }
    if (doc.path !== path) {
      const oldId = doc.id;
      doc.id = path;
      doc.path = path;
      doc.name = basename(path);
      await this.editor.rename(oldId, path, doc.name);
      if (this.activeId === oldId) this.activeId = path;
      if (this.root && isInside(this.root, path)) void this.tree.refresh().then(() => this.reindex());
    }
    doc.dirty = false;
    this.renderTabs();
    this.renderStatus();
    if (this.activeId === doc.id) document.title = `${doc.name} — Aizome`;
    bus.emit("file:saved", { path });
    return true;
  }

  async closeDoc(id = this.activeId) {
    const doc = this.docs.find((d) => d.id === id);
    if (!doc) return;
    if (doc.dirty) {
      const answer = await choose(
        t("file.unsavedTitle", { name: doc.name }),
        t("file.unsavedMessage"),
        [
          { label: t("common.cancel"), value: "cancel", kind: "plain" },
          { label: t("file.dontSave"), value: "discard", kind: "plain" },
          { label: t("file.save"), value: "save", kind: "primary" },
        ],
        "cancel",
      );
      if (answer === "cancel") return;
      if (answer === "save" && !(await this.save(doc.id))) return;
    }
    const index = this.docs.indexOf(doc);
    this.docs.splice(index, 1);
    this.editor.close(doc.id);
    if (this.activeId === doc.id) {
      const next = this.docs[Math.min(index, this.docs.length - 1)];
      this.activeId = null;
      if (next) this.activate(next.id);
      else {
        this.tree.setActive(null);
        document.title = "Aizome";
        bus.emit("active:changed", { path: null });
      }
    }
    this.renderTabs();
    this.renderStatus();
  }

  private handleRenamed(from: string, to: string) {
    for (const doc of this.docs) {
      if (!doc.path) continue;
      if (doc.path === from || isInside(from, doc.path)) {
        const newPath = to + doc.path.slice(from.length);
        const oldId = doc.id;
        doc.path = newPath;
        doc.id = newPath;
        doc.name = basename(newPath);
        void this.editor.rename(oldId, newPath, doc.name);
        if (this.activeId === oldId) this.activeId = newPath;
      }
    }
    this.renderTabs();
    this.renderStatus();
  }

  private handleDeleted(path: string) {
    for (const doc of [...this.docs]) {
      if (doc.path && (doc.path === path || isInside(path, doc.path))) {
        doc.dirty = false;
        void this.closeDoc(doc.id);
      }
    }
  }

  // ───────────── 実行

  async runActive() {
    const doc = this.activeDoc();
    if (!doc) {
      toast(t("run.noFile"), "info");
      return;
    }
    if (doc.dirty || !doc.path) {
      if (!(await this.save(doc.id))) return;
    }
    const path = doc.path!;
    const config = findRunConfig(path);
    if (!config) {
      toast(t("run.noConfig", { name: doc.name }), "warn", 6000);
      return;
    }
    const cmd = expandCommand(config, path, this.root ?? "", this.sys.os);
    this.lastRunDir = dirname(path);
    await this.terminal.run(cmd, dirname(path));
  }

  // ───────────── タブ

  private renderTabs() {
    clear(this.tabsEl);
    for (const doc of this.docs) {
      const active = doc.id === this.activeId;
      const tab = h(
        "div",
        {
          class: "tab" + (active ? " active" : "") + (doc.dirty ? " dirty" : ""),
          role: "tab",
          "aria-selected": String(active),
          tabindex: 0,
          title: doc.path ?? doc.name,
        },
        h("span", { class: "tab-name" }, doc.name),
        h("button", {
          class: "tab-close",
          title: t("tabs.close"),
          "aria-label": t("tabs.close"),
          html: icon("x", 12),
          onclick: (e: Event) => {
            e.stopPropagation();
            void this.closeDoc(doc.id);
          },
        }),
      );
      tab.addEventListener("click", () => this.activate(doc.id));
      tab.addEventListener("auxclick", (e) => {
        if (e.button === 1) void this.closeDoc(doc.id);
      });
      tab.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") this.activate(doc.id);
      });
      this.tabsEl.append(tab);
      if (active) requestAnimationFrame(() => tab.scrollIntoView({ block: "nearest", inline: "nearest" }));
    }
    const empty = this.docs.length === 0;
    this.welcomeEl.hidden = !empty;
    this.editorMount.hidden = empty;
    this.tabsEl.classList.toggle("empty", empty);
  }

  // ───────────── ステータスバーと AI 表示

  private renderStatus() {
    clear(this.statusLeft);
    clear(this.statusRight);
    const item = (text: string, title?: string, onclick?: () => void) =>
      onclick
        ? h("button", { class: "status-item", title: title ?? text, onclick }, text)
        : h("span", { class: "status-item", title: title ?? text }, text);

    const doc = this.activeDoc();
    if (doc?.dirty) this.statusLeft.append(h("span", { class: "status-item dirty-note" }, t("status.unsaved")));
    for (const [, v] of this.statusItems) this.statusLeft.append(item(v.text, v.tooltip));

    if (doc) {
      const pos = this.editor.cursor();
      this.statusRight.append(
        item(t("status.position", { line: String(pos.line), col: String(pos.col) }), undefined, () => void this.goToLine()),
        item(t("status.spaces", { n: String(settings.get("editor.tabSize")) })),
        item("UTF-8"),
        item(this.editor.languageName()),
      );
    }
  }

  private async goToLine() {
    const v = await inputBox({ title: t("cmd.goToLine"), placeholder: "42" });
    const [line, col] = (v ?? "").split(/[:,\s]+/).map(Number);
    if (line) this.editor.goTo(line, col || 1);
  }

  private renderAi(status: AiStatus) {
    const model = settings.get("ai.model");
    const label =
      status === "off" ? t("ai.off") : status === "error" ? t("ai.error") : model;
    this.aiPill.className = `ai-pill ${status}`;
    this.aiPill.title =
      status === "error" ? `${t("ai.errorTitle")}\n${completer.lastError}` : status === "off" ? t("ai.offTitle") : t("ai.onTitle", { model });
    this.aiPill.innerHTML = "";
    this.aiPill.append(h("span", { class: "ai-drop", "aria-hidden": "true" }), h("span", { class: "ai-label" }, label));
  }

  private onAiPillClick() {
    if (completer.status === "error") {
      toast(t("ai.errorDetail", { err: completer.lastError.slice(0, 200) }), "error", 8000);
      completer.setStatus(settings.get("ai.enabled") ? "idle" : "off");
      this.showView("settings");
      return;
    }
    settings.set("ai.enabled", !settings.get("ai.enabled"));
  }

  // ───────────── コマンド

  private registerCommands() {
    const reg = (id: string, titleKey: string, run: () => unknown, key?: string, inTerminal = false) =>
      commands.register({ id, title: () => t(titleKey), key, inTerminal, source: "core", run });

    reg("file.openFolder", "cmd.openFolder", () => this.openFolder(), "Mod-O");
    reg("file.new", "cmd.newFile", () => this.newUntitled(), "Mod-N");
    reg("file.save", "cmd.save", () => this.save(), "Mod-S");
    reg("file.saveAs", "cmd.saveAs", () => this.save(this.activeId, true), "Mod-Shift-S");
    reg("file.close", "cmd.closeTab", () => this.closeDoc(), "Mod-W");
    reg("file.quickOpen", "cmd.quickOpen", () => this.quickOpen(), "Mod-P");
    reg("view.commandPalette", "cmd.commandPalette", () => openCommandPalette(), "Mod-Shift-P", true);
    commands.register({ id: "view.commandPaletteF1", title: () => t("cmd.commandPalette"), key: "F1", inTerminal: true, hidden: true, run: () => openCommandPalette() });
    reg("view.toggleSidebar", "cmd.toggleSidebar", () => this.el.classList.toggle("sidebar-hidden"), "Mod-B");
    reg("view.explorer", "cmd.showExplorer", () => this.showView("explorer"), "Mod-Shift-E");
    reg("view.extensions", "cmd.showExtensions", () => this.showView("extensions"), "Mod-Shift-X");
    reg("view.settings", "cmd.showSettings", () => this.showView("settings"), "Mod-,");
    reg("terminal.toggle", "cmd.toggleTerminal", () => this.terminal.toggle(), "Mod-`", true);
    reg("terminal.new", "cmd.newTerminal", () => this.terminal.newTerminal(), "Mod-Shift-`", true);
    reg("run.file", "cmd.run", () => this.runActive(), "F5", true);
    reg("editor.goToLine", "cmd.goToLine", () => this.goToLine(), "Mod-G");
    // 拡張機能用：commands.execute("editor.goToLineNumber", 行, 列)
    commands.register({
      id: "editor.goToLineNumber",
      title: () => t("cmd.goToLine"),
      hidden: true,
      source: "core",
      run: (line, col) => this.editor.goTo(Number(line) || 1, Number(col) || 1),
    });
    reg("ai.toggle", "cmd.aiToggle", () => settings.set("ai.enabled", !settings.get("ai.enabled")));
    reg("ai.trigger", "cmd.aiTrigger", () => this.editor.triggerCompletion());
    reg("ext.reload", "cmd.reloadExtensions", () => this.extensions.reload());
    reg("theme.select", "cmd.selectTheme", async () => {
      const id = await quickPick(
        listThemes().map((th) => ({ label: th.label, detail: th.scheme === "dark" ? t("theme.dark") : t("theme.light"), value: th.id })),
        t("cmd.selectTheme"),
      );
      if (id) settings.set("ui.theme", id);
    });
  }

  private bindEvents() {
    this.editor.onChange((id) => {
      const doc = this.docs.find((d) => d.id === id);
      if (doc && !doc.dirty) {
        doc.dirty = true;
        this.renderTabs();
        this.renderStatus();
        if (id === this.activeId) document.title = `● ${doc.name} — Aizome`;
      }
    });
    let pending = false;
    this.editor.onCursor(() => {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => {
        pending = false;
        this.renderStatus();
      });
    });
    completer.onStatus((s) => this.renderAi(s));
    bus.on("settings:changed", ({ key }) => {
      if (key.startsWith("editor.")) {
        this.editor.applySettings();
        this.renderStatus();
      }
      if (key === "ui.theme") applyTheme(settings.get("ui.theme"));
      if (key === "ai.enabled") {
        if (!settings.get("ai.enabled")) completer.cancelInline();
        completer.setStatus(settings.get("ai.enabled") ? "idle" : "off");
      }
      if (key === "ai.model") this.renderAi(completer.status);
      if (key === "ui.language") toast(t("settings.languageChanged"), "info");
    });
  }
}
