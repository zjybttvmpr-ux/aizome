// アプリ全体の組み立て：レイアウト、タブ、ファイル操作、コマンド、ステータスバー
import { h, clear } from "./core/dom";
import { t } from "./core/i18n";
import { bus } from "./core/events";
import { settings } from "./core/settings";
import { commands, formatKey, installKeybindings } from "./core/commands";
import { fs, dialog, sys, git, appWindow, type SysInfo } from "./core/platform";
import { basename, dirname, extname, isInside, relative, resolveIn } from "./core/paths";
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
import { createSearchView, type SearchView } from "./ui/searchView";
import { createAiChatView, type AiChatView } from "./ui/aiChatView";
import { aiRewrite } from "./ui/aiRewrite";
import { renderMarkdown } from "./ui/markdown";
import { initAppearance, zoomBy } from "./ui/appearance";
import { menu, type MenuItem } from "./ui/menu";
import { buildFromJapanese } from "./ui/jpBuildDialog";
import { sampleTemplate } from "./ai/jpBuild";

interface Doc {
  id: string;
  path: string | null;
  name: string;
  dirty: boolean;
}

type ViewName = "explorer" | "search" | "ai" | "extensions" | "settings";

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
  private menuButton!: HTMLElement;
  private breadcrumbsEl!: HTMLElement;
  private previewEl!: HTMLElement;
  private editorArea!: HTMLElement;
  private previewOn = false;
  private previewTimer: number | undefined;
  private autoSaveTimer: number | undefined;
  private gitBranch: string | null = null;
  private gitChanges = 0;
  private restoring = false;
  private searchView: SearchView;
  private chatView: AiChatView;

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
    this.searchView = createSearchView({ root: () => this.root, open: (p, l, c) => void this.openFile(p, l, c) });
    this.chatView = createAiChatView({ editor: this.editor, activeName: () => this.activeDoc()?.name ?? null });
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
    initAppearance();
    await this.extensions.loadAll();
    applyTheme(settings.get("ui.theme"));

    const last = settings.get("workspace.last");
    if (last && (await fs.exists(last).catch(() => false))) {
      await this.setRoot(last);
      if (settings.get("editor.restoreTabs")) await this.restoreSession();
    } else this.renderExplorerState();
    this.renderTabs();
    this.renderStatus();

    // 閉じる前に未保存の確認
    appWindow.onCloseRequested(() => this.confirmQuit()).catch(() => {});
    // ほかのアプリから戻ってきたら Git の状態を更新、離れたら自動保存
    window.addEventListener("focus", () => void this.refreshGit());
    window.addEventListener("blur", () => {
      if (settings.get("editor.autoSave") === "focus") void this.saveAllDirty();
    });
    window.setInterval(() => void this.refreshGit(), 15000);
  }

  // ───────────── セッション（開いていたタブの復元）

  private saveSession() {
    if (this.restoring) return;
    settings.set("session.files", this.docs.filter((d) => d.path).map((d) => d.path!));
    settings.set("session.active", this.activeDoc()?.path ?? "");
  }

  private async restoreSession() {
    const files = settings.get("session.files");
    const active = settings.get("session.active");
    this.restoring = true;
    try {
      for (const f of files) {
        if (await fs.exists(f).catch(() => false)) await this.openFile(f);
      }
      if (active && this.docs.some((d) => d.path === active)) this.activate(active);
    } finally {
      this.restoring = false;
      this.saveSession();
    }
  }

  private async confirmQuit(): Promise<boolean> {
    const dirty = this.docs.filter((d) => d.dirty);
    if (!dirty.length) return true;
    const answer = await choose(
      t("quit.title", { n: String(dirty.length) }),
      dirty.map((d) => `・${d.name}`).join("\n"),
      [
        { label: t("common.cancel"), value: "cancel", kind: "plain" },
        { label: t("quit.discard"), value: "discard", kind: "plain" },
        { label: t("quit.saveAll"), value: "save", kind: "primary" },
      ],
      "cancel",
    );
    if (answer === "cancel") return false;
    if (answer === "save") {
      for (const d of dirty) if (!(await this.save(d.id))) return false;
    }
    return true;
  }

  private async saveAllDirty() {
    for (const d of this.docs) if (d.dirty && d.path) await this.save(d.id);
  }

  // ───────────── Git

  private async refreshGit() {
    if (!this.root) return;
    try {
      const st = await git.status(this.root);
      const files = new Map<string, string>();
      const base = this.root.replace(/\\/g, "/").replace(/\/+$/, "");
      for (const f of st.files) files.set(`${base}/${f.path.replace(/\/+$/, "")}`, f.status);
      this.tree.setGit(files);
      const branch = st.isRepo ? st.branch : null;
      if (branch !== this.gitBranch || files.size !== this.gitChanges) {
        this.gitBranch = branch;
        this.gitChanges = files.size;
        this.renderStatus();
      }
    } catch {
      /* git がなければ表示しない */
    }
  }

  // ───────────── レイアウト

  private build() {
    const button = (name: string, label: string, onclick: () => void, extra = "") =>
      h("button", { class: `icon-btn ${extra}`, title: label, "aria-label": label, onclick, html: icon(name, 16) });

    this.workspaceLabel = h("span", { class: "workspace-name" });
    this.aiPill = h("button", { class: "ai-pill", onclick: () => this.onAiPillClick() });
    const paletteKey = formatKey("Mod-P");

    const menuBtn = h(
      "button",
      { class: "menu-btn", type: "button", title: t("menu.open"), "aria-label": t("menu.open"), "aria-haspopup": "menu", "aria-expanded": "false" },
      h("span", { class: "brand-mark", "aria-hidden": "true" }, "藍"),
      h("span", { class: "brand-name" }, "Aizome"),
      h("span", { class: "menu-btn-caret", html: icon("chevronDown", 12) }),
    );
    menuBtn.addEventListener("click", () => {
      if (menu.isOpen) return menu.close();
      menuBtn.setAttribute("aria-expanded", "true");
      menuBtn.classList.add("open");
      menu.open(menuBtn, this.menuItems(), () => {
        menuBtn.setAttribute("aria-expanded", "false");
        menuBtn.classList.remove("open");
      });
    });
    this.menuButton = menuBtn;

    const topbar = h(
      "header",
      { class: "topbar" },
      h("div", { class: "brand" }, menuBtn),
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
    addActivity("search", "search", t("view.search"));
    addActivity("ai", "spark", t("view.ai"));
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
    this.views.set("search", this.searchView.el);
    this.views.set("ai", this.chatView.el);
    this.views.set("extensions", createExtensionsView(this.extensions));
    this.views.set("settings", createSettingsView());
    const viewsHost = h("div", { class: "sidebar-body" }, ...this.views.values());
    this.sidebarEl = h("aside", { class: "sidebar" }, h("div", { class: "sidebar-head" }, this.sidebarTitle, this.sidebarActions), viewsHost);

    const sideResizer = h("div", { class: "resizer resizer-x", role: "separator", "aria-orientation": "vertical" });
    const panelResizer = h("div", { class: "resizer resizer-y", role: "separator", "aria-orientation": "horizontal" });

    this.tabsEl = h("div", { class: "tabs", role: "tablist" });
    this.editorMount = h("div", { class: "editor-mount" });
    this.welcomeEl = this.buildWelcome();
    this.breadcrumbsEl = h("nav", { class: "breadcrumbs", "aria-label": t("breadcrumbs.label") });
    this.previewEl = h("article", { class: "md-preview", hidden: true, "aria-label": t("preview.label") });
    this.editorArea = h("div", { class: "editor-area" }, this.editorMount, this.previewEl, this.welcomeEl);
    const editorArea = this.editorArea;
    const main = h("main", { class: "main" }, this.tabsEl, this.breadcrumbsEl, editorArea, panelResizer, this.terminal.el);

    this.statusLeft = h("div", { class: "status-left" });
    this.statusRight = h("div", { class: "status-right" });
    const statusbar = h("footer", { class: "statusbar" }, this.statusLeft, this.statusRight);

    this.el = h("div", { class: "app" }, topbar, h("div", { class: "body" }, activity, this.sidebarEl, sideResizer, main), statusbar);
    this.el.style.setProperty("--side-w", `${settings.get("ui.sidebarWidth")}px`);
    this.el.style.setProperty("--panel-h", `${settings.get("ui.panelHeight")}px`);
    this.el.classList.toggle("hide-line-numbers", !settings.get("editor.lineNumbers"));
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
        h("div", {}, this.recentList()),
        h("p", { class: "welcome-hint" }, t("welcome.aiHint")),
      );
    };
    queueMicrotask(fill);
    bus.on("settings:changed", ({ key }) => (key === "ui.language" || key === "workspace.recent") && fill());
    return el;
  }

  private recentList(): HTMLElement | null {
    const recent = settings.get("workspace.recent").filter((r) => r !== this.root);
    if (!recent.length) return null;
    return h(
      "div",
      { class: "welcome-recent" },
      h("h2", {}, t("welcome.recent")),
      ...recent.slice(0, 6).map((r) =>
        h("button", { class: "recent-item", type: "button", title: r, onclick: () => this.openFolder(r) }, h("span", { class: "recent-name" }, basename(r)), h("span", { class: "recent-path" }, r)),
      ),
    );
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
    if (view === "search") this.searchView.focus(this.editor.getSelection().split("\n")[0] || undefined);
    if (view === "ai") this.chatView.focus();
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
    if (this.root && this.root !== root) {
      // 別のフォルダに移るときは、今のタブを閉じる
      for (const d of [...this.docs]) await this.closeDoc(d.id);
      if (this.docs.length) return;
    }
    this.root = root;
    settings.set("workspace.last", root);
    settings.set("workspace.recent", [root, ...settings.get("workspace.recent").filter((r) => r !== root)].slice(0, 10));
    await this.tree.setRoot(root);
    this.renderExplorerState();
    bus.emit("workspace:changed", { root });
    await this.reindex();
    this.gitBranch = null;
    void this.refreshGit();
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
      this.saveSession();
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
    this.renderBreadcrumbs();
    this.renderPreview();
    this.saveSession();
  }

  private renderBreadcrumbs() {
    clear(this.breadcrumbsEl);
    const doc = this.activeDoc();
    if (!doc) return;
    const rel = doc.path ? (this.root && isInside(this.root, doc.path) ? relative(this.root, doc.path) : doc.path) : doc.name;
    const parts = rel.split(/[\\/]/).filter(Boolean);
    parts.forEach((p, i) => {
      if (i > 0) this.breadcrumbsEl.append(h("span", { class: "crumb-sep", "aria-hidden": "true", html: icon("chevron", 11) }));
      this.breadcrumbsEl.append(h("span", { class: i === parts.length - 1 ? "crumb current" : "crumb" }, p));
    });
  }

  private isMarkdown(doc?: Doc) {
    return !!doc && [".md", ".markdown", ".mdx"].includes(extname(doc.path ?? doc.name));
  }

  private renderPreview() {
    const doc = this.activeDoc();
    const show = this.previewOn && this.isMarkdown(doc);
    this.previewEl.hidden = !show;
    this.editorArea.classList.toggle("with-preview", show);
    if (!show) return;
    clear(this.previewEl);
    this.previewEl.append(renderMarkdown(this.editor.getText()));
  }

  private togglePreview() {
    if (!this.isMarkdown(this.activeDoc())) {
      toast(t("preview.onlyMarkdown"), "info");
      return;
    }
    this.previewOn = !this.previewOn;
    this.renderPreview();
  }

  async save(id = this.activeId, forceAs = false): Promise<boolean> {
    const doc = this.docs.find((d) => d.id === id);
    if (!doc) return false;
    let path = doc.path;
    if (!path || forceAs) {
      path = await dialog.saveFile(this.root ? resolveIn(this.root, doc.path ? basename(doc.path) : "untitled.txt") : undefined);
      if (!path) return false;
    }
    let text = this.editor.getText(doc.id);
    const original = text;
    if (settings.get("editor.trimTrailingWhitespace")) text = text.replace(/[ \t]+$/gm, "");
    if (settings.get("editor.insertFinalNewline") && text.length && !text.endsWith("\n")) text += "\n";
    if (text !== original) this.editor.setText(doc.id, text);
    try {
      await fs.writeFile(path, text);
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
    this.saveSession();
    void this.refreshGit();
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
    this.renderBreadcrumbs();
    this.renderPreview();
    this.saveSession();
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
    await this.runPath(doc.path!);
  }

  private async runPath(path: string) {
    const config = findRunConfig(path);
    if (!config) {
      toast(t("run.noConfig", { name: basename(path) }), "warn", 6000);
      return;
    }
    const cmd = expandCommand(config, path, this.root ?? "", this.sys.os);
    this.lastRunDir = dirname(path);
    await this.terminal.run(cmd, dirname(path));
  }

  /** 新しいファイルとして書き込んで開く（同じ名前があれば確認） */
  private async saveAndOpen(path: string, text: string): Promise<boolean> {
    if (await fs.exists(path).catch(() => false)) {
      const ok = await choose(t("build.overwriteTitle", { name: basename(path) }), t("build.overwriteMessage"), [
        { label: t("common.cancel"), value: false, kind: "plain" },
        { label: t("build.overwrite"), value: true, kind: "danger" },
      ], false);
      if (!ok) return false;
    }
    try {
      await fs.writeFile(path, text);
    } catch (err) {
      toast(t("file.saveFailed", { name: basename(path), err: String(err) }), "error");
      return false;
    }
    const open = this.docs.find((d) => d.path === path);
    if (open) {
      this.editor.setText(open.id, text);
      open.dirty = false;
    }
    if (this.root && isInside(this.root, path)) await this.tree.refresh().then(() => this.reindex());
    await this.openFile(path);
    toast(t("build.saved", { name: basename(path) }), "success");
    return true;
  }

  private insertBuildTemplate() {
    if (!this.activeDoc()) {
      this.newUntitled();
      requestAnimationFrame(() => this.editor.insertText(sampleTemplate()));
    } else {
      this.editor.insertText(sampleTemplate());
    }
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
    if (this.gitBranch) {
      const label = this.gitChanges ? `${this.gitBranch}  ${t("status.gitChanges", { n: String(this.gitChanges) })}` : this.gitBranch;
      this.statusLeft.append(
        h("button", { class: "status-item git-item", title: t("status.gitTitle"), onclick: () => void this.refreshGit() }, h("span", { class: "git-icon", "aria-hidden": "true" }), label),
      );
    }
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

  private toggleZen() {
    const on = !this.el.classList.contains("zen");
    this.el.classList.toggle("zen", on);
    if (on) toast(t("zen.hint", { key: formatKey("Mod-Alt-Z") }), "info");
    this.editor.focus();
  }

  private async revert() {
    const doc = this.activeDoc();
    if (!doc?.path) return;
    try {
      const text = await fs.readFile(doc.path);
      this.editor.setText(doc.id, text);
      doc.dirty = false;
      this.renderTabs();
      this.renderStatus();
      toast(t("file.reverted", { name: doc.name }), "success");
    } catch (err) {
      toast(t("file.openFailed", { name: doc.name, err: String(err) }), "error");
    }
  }

  private cycleTab(dir: number) {
    if (this.docs.length < 2) return;
    const i = this.docs.findIndex((d) => d.id === this.activeId);
    const next = this.docs[(i + dir + this.docs.length) % this.docs.length];
    this.activate(next.id);
  }

  // ───────────── メニュー

  private menuItems(): MenuItem[] {
    const c = (id: string, checked?: () => boolean): MenuItem => ({ type: "command", id, checked });
    const sep: MenuItem = { type: "separator" };
    const recent = (): MenuItem[] => {
      const list = settings.get("workspace.recent");
      if (!list.length) return [{ type: "note", label: t("recent.none") }];
      return list.slice(0, 10).map((r) => ({ type: "action", label: basename(r), hint: r.length > 40 ? "…" + r.slice(-38) : r, run: () => this.openFolder(r) }));
    };
    const themes = (): MenuItem[] =>
      listThemes().map((th) => ({ type: "action", label: th.label, checked: settings.get("ui.theme") === th.id, run: () => settings.set("ui.theme", th.id) }));
    return [
      {
        type: "submenu",
        label: t("menu.file"),
        items: () => [
          c("file.new"),
          c("file.openFolder"),
          { type: "submenu", label: t("cmd.openRecent"), items: recent },
          sep,
          c("file.save"),
          c("file.saveAs"),
          c("file.saveAll"),
          c("file.revert"),
          sep,
          c("file.print"),
          c("file.copyPath"),
          sep,
          c("file.close"),
          c("file.closeAll"),
          sep,
          c("view.settings"),
          c("app.quit"),
        ],
      },
      {
        type: "submenu",
        label: t("menu.edit"),
        items: () => [
          c("edit.undo"),
          c("edit.redo"),
          sep,
          c("edit.cut"),
          c("edit.copy"),
          c("edit.paste"),
          c("edit.selectAll"),
          sep,
          c("edit.find"),
          c("edit.replace"),
          c("search.inFiles"),
          c("editor.goToLine"),
          sep,
          c("edit.toggleComment"),
          c("edit.duplicateLine"),
          c("edit.deleteLine"),
          c("edit.moveLineUp"),
          c("edit.moveLineDown"),
          sep,
          c("edit.foldAll"),
          c("edit.unfoldAll"),
        ],
      },
      {
        type: "submenu",
        label: t("menu.view"),
        items: () => [
          c("view.commandPalette"),
          c("file.quickOpen"),
          sep,
          c("view.explorer"),
          c("search.inFiles"),
          c("view.ai"),
          c("view.extensions"),
          sep,
          c("view.toggleSidebar", () => !this.el.classList.contains("sidebar-hidden")),
          c("terminal.toggle", () => this.terminal.isVisible),
          c("view.markdownPreview", () => this.previewOn),
          c("view.zen", () => this.el.classList.contains("zen")),
          c("view.fullscreen"),
          sep,
          c("view.zoomIn"),
          c("view.zoomOut"),
          c("view.zoomReset"),
          sep,
          c("editor.toggleWrap", () => settings.get("editor.wordWrap")),
          c("editor.toggleLineNumbers", () => settings.get("editor.lineNumbers")),
          { type: "submenu", label: t("settings.theme"), items: themes },
        ],
      },
      {
        type: "submenu",
        label: t("menu.run"),
        items: () => [c("run.file"), sep, c("terminal.new"), c("terminal.toggle", () => this.terminal.isVisible), c("terminal.clear")],
      },
      {
        type: "submenu",
        label: t("menu.ai"),
        items: () => [
          c("view.ai"),
          c("ai.build"),
          c("ai.buildTemplate"),
          sep,
          c("ai.rewrite"),
          c("ai.explain"),
          c("ai.comment"),
          c("ai.fix"),
          c("ai.trigger"),
          sep,
          c("ai.toggle", () => settings.get("ai.enabled")),
          c("ai.settings"),
        ],
      },
      {
        type: "submenu",
        label: t("menu.help"),
        items: () => [c("help.shortcuts"), c("view.commandPalette"), sep, c("ext.reload"), c("git.refresh"), sep, c("help.about")],
      },
    ];
  }

  /** 開いているファイルを印刷する（画面ではなく、コードだけを行番号付きで） */
  private async printActive() {
    const doc = this.activeDoc();
    if (!doc) {
      toast(t("print.noFile"), "info");
      return;
    }
    document.querySelector(".print-sheet")?.remove();
    const lines = this.editor.getText(doc.id).split("\n");
    const width = String(lines.length).length;
    const sheet = h(
      "div",
      { class: "print-sheet" },
      h("header", { class: "print-head" }, h("strong", {}, doc.name), h("span", {}, doc.path ?? ""), h("span", {}, new Date().toLocaleString())),
      h("pre", { class: "print-code" }, lines.map((l, i) => `${String(i + 1).padStart(width, " ")}  ${l}`).join("\n")),
    );
    if (this.isMarkdown(doc) && this.previewOn) {
      sheet.replaceChildren(h("div", { class: "print-md" }, renderMarkdown(this.editor.getText(doc.id))));
    }
    document.body.append(sheet);
    try {
      await sys.print();
    } catch {
      window.print();
    }
  }

  private showShortcuts() {
    const rows = commands
      .list()
      .filter((c) => c.key || c.display)
      .map((c) => ({ title: commands.title(c), key: c.key ? formatKey(c.key) : c.display! }))
      .sort((a, b) => a.title.localeCompare(b.title));
    const box = h(
      "div",
      { class: "modal wide", role: "dialog", "aria-modal": "true" },
      h("h2", { class: "modal-title" }, t("help.shortcuts")),
      h("div", { class: "shortcut-list" }, ...rows.map((r) => h("div", { class: "shortcut-row" }, h("span", {}, r.title), h("kbd", {}, r.key)))),
      h("div", { class: "modal-actions" }, h("button", { class: "btn primary", type: "button", onclick: () => backdrop.remove() }, t("common.ok"))),
    );
    const backdrop = h("div", { class: "modal-backdrop" }, box);
    backdrop.addEventListener("mousedown", (e) => e.target === backdrop && backdrop.remove());
    backdrop.addEventListener("keydown", (e) => e.key === "Escape" && backdrop.remove());
    document.body.append(backdrop);
    (box.querySelector("button") as HTMLElement).focus();
  }

  private async showAbout() {
    let version = "";
    try {
      version = (await sys.appInfo()).version;
    } catch {
      version = "—";
    }
    await choose(
      "Aizome",
      t("help.aboutText", { version, os: this.sys.os, model: settings.get("ai.model") }),
      [{ label: t("common.ok"), value: true, kind: "primary" }],
      true,
    );
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
    reg("search.inFiles", "cmd.searchInFiles", () => this.showView("search"), "Mod-Shift-F");
    reg("view.ai", "cmd.showAiChat", () => this.showView("ai"), "Mod-Shift-A");
    reg("ai.rewrite", "cmd.aiRewrite", () => aiRewrite(this.editor), "Mod-I");
    reg("ai.explain", "cmd.aiExplain", () => {
      this.showView("ai");
      this.chatView.ask(t("chat.example1"));
    });
    reg("ai.comment", "cmd.aiComment", () => aiRewrite(this.editor, t("rewrite.presetComment")));
    reg("ai.fix", "cmd.aiFix", () => aiRewrite(this.editor, t("rewrite.presetFix")));
    reg("view.markdownPreview", "cmd.markdownPreview", () => this.togglePreview(), "Mod-Shift-V");
    reg("view.zen", "cmd.zen", () => this.toggleZen(), "Mod-Alt-Z", true);
    reg("view.fullscreen", "cmd.fullscreen", async () => appWindow.setFullscreen(!(await appWindow.isFullscreen())), "F11", true);
    reg("view.zoomIn", "cmd.zoomIn", () => zoomBy(0.1), "Mod-=", true);
    reg("view.zoomOut", "cmd.zoomOut", () => zoomBy(-0.1), "Mod--", true);
    reg("view.zoomReset", "cmd.zoomReset", () => settings.set("look.zoom", 1), "Mod-0", true);
    // 日本語キーボードの「;+」キーでも拡大できるように
    commands.register({ id: "view.zoomInJis", title: () => t("cmd.zoomIn"), key: "Mod-;", inTerminal: true, hidden: true, run: () => zoomBy(0.1) });
    commands.register({ id: "view.zoomInShift", title: () => t("cmd.zoomIn"), key: "Mod-Shift-;", inTerminal: true, hidden: true, run: () => zoomBy(0.1) });
    reg("editor.toggleWrap", "cmd.toggleWrap", () => settings.set("editor.wordWrap", !settings.get("editor.wordWrap")), "Alt-Z");
    reg("editor.toggleLineNumbers", "cmd.toggleLineNumbers", () => settings.set("editor.lineNumbers", !settings.get("editor.lineNumbers")));
    reg("file.openRecent", "cmd.openRecent", async () => {
      const items = settings.get("workspace.recent").map((r) => ({ label: basename(r), detail: r, icon: "folder", value: r }));
      if (!items.length) return toast(t("recent.none"), "info");
      const picked = await quickPick(items, t("cmd.openRecent"));
      if (picked) await this.openFolder(picked);
    }, "Mod-R");
    reg("file.revert", "cmd.revert", () => this.revert());
    reg("file.saveAll", "cmd.saveAll", () => this.saveAllDirty(), "Mod-Alt-S");
    reg("file.closeAll", "cmd.closeAll", async () => {
      for (const d of [...this.docs]) await this.closeDoc(d.id);
    });
    reg("file.copyPath", "cmd.copyPath", () => {
      const p = this.activeDoc()?.path;
      if (p) void navigator.clipboard?.writeText(p).then(() => toast(t("chat.copied"), "success"));
    });
    reg("tabs.next", "cmd.nextTab", () => this.cycleTab(1), "Ctrl-Tab", true);
    reg("tabs.prev", "cmd.prevTab", () => this.cycleTab(-1), "Ctrl-Shift-Tab", true);
    // Windows / Linux では Ctrl が Mod 扱いになるため、同じ動作を Mod でも登録する
    commands.register({ id: "tabs.nextMod", title: () => t("cmd.nextTab"), key: "Mod-Tab", inTerminal: true, hidden: true, run: () => this.cycleTab(1) });
    commands.register({ id: "tabs.prevMod", title: () => t("cmd.prevTab"), key: "Mod-Shift-Tab", inTerminal: true, hidden: true, run: () => this.cycleTab(-1) });
    reg("terminal.clear", "cmd.clearTerminal", () => this.terminal.clearActive());
    reg("git.refresh", "cmd.gitRefresh", () => this.refreshGit());
    // 編集（キー操作はエディタ側が受け持つので、表示用のキーだけ載せる）
    const edit = (id: string, title: string, action: Parameters<EditorHost["run"]>[0], display?: string) =>
      commands.register({ id, title: () => t(title), display, source: "core", run: () => this.editor.run(action) });
    const mod = (k: string) => formatKey(k);
    edit("edit.undo", "cmd.undo", "undo", mod("Mod-Z"));
    edit("edit.redo", "cmd.redo", "redo", mod("Mod-Shift-Z"));
    edit("edit.cut", "cmd.cut", "cut", mod("Mod-X"));
    edit("edit.copy", "cmd.copy", "copy", mod("Mod-C"));
    commands.register({
      id: "edit.paste",
      title: () => t("cmd.paste"),
      display: mod("Mod-V"),
      source: "core",
      run: async () => {
        if (!(await this.editor.run("paste"))) toast(t("edit.pasteBlocked", { key: mod("Mod-V") }), "info");
      },
    });
    edit("edit.selectAll", "cmd.selectAll", "selectAll", mod("Mod-A"));
    edit("edit.find", "cmd.find", "find", mod("Mod-F"));
    edit("edit.replace", "cmd.replace", "replace");
    edit("edit.toggleComment", "cmd.toggleComment", "toggleComment", mod("Mod-/"));
    edit("edit.duplicateLine", "cmd.duplicateLine", "duplicateLine", mod("Shift-Alt-ArrowDown"));
    edit("edit.deleteLine", "cmd.deleteLine", "deleteLine", mod("Mod-Shift-K"));
    edit("edit.moveLineUp", "cmd.moveLineUp", "moveLineUp", mod("Alt-ArrowUp"));
    edit("edit.moveLineDown", "cmd.moveLineDown", "moveLineDown", mod("Alt-ArrowDown"));
    edit("edit.foldAll", "cmd.foldAll", "foldAll");
    edit("edit.unfoldAll", "cmd.unfoldAll", "unfoldAll");
    reg("file.print", "cmd.print", () => this.printActive(), "Mod-Alt-P");
    // 日本語から組み立てる（行番号を渡すとそのブロック、なければカーソル位置のブロック）
    commands.register({
      id: "ai.build",
      title: () => t("cmd.aiBuild"),
      key: "Mod-Shift-Enter",
      source: "core",
      run: (line) =>
        buildFromJapanese(
          {
            editor: this.editor,
            activeDoc: () => this.activeDoc(),
            root: () => this.root,
            saveAndOpen: (p, text) => this.saveAndOpen(p, text),
            run: (p) => this.runPath(p),
            insertTemplate: () => this.insertBuildTemplate(),
          },
          typeof line === "number" ? line : undefined,
        ),
    });
    reg("ai.buildTemplate", "cmd.aiBuildTemplate", () => this.insertBuildTemplate());
    reg("app.quit", "cmd.quit", () => appWindow.close(), "Mod-Q", true);
    reg("ai.settings", "cmd.aiSettings", () => this.showView("settings"));
    reg("help.shortcuts", "help.shortcuts", () => this.showShortcuts(), "Mod-K");
    reg("help.about", "help.about", () => this.showAbout());
    reg("view.menu", "menu.open", () => this.menuButton.click(), "Alt-F", true);
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
      if (doc && settings.get("editor.autoSave") === "delay" && doc.path) {
        window.clearTimeout(this.autoSaveTimer);
        this.autoSaveTimer = window.setTimeout(() => {
          if (doc.dirty) void this.save(doc.id);
        }, 1200);
      }
      if (this.previewOn && id === this.activeId) {
        window.clearTimeout(this.previewTimer);
        this.previewTimer = window.setTimeout(() => this.renderPreview(), 200);
      }
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
      if (key === "editor.lineNumbers") this.el.classList.toggle("hide-line-numbers", !settings.get("editor.lineNumbers"));
      if (key === "ai.enabled") {
        if (!settings.get("ai.enabled")) completer.cancelInline();
        completer.setStatus(settings.get("ai.enabled") ? "idle" : "off");
      }
      if (key === "ai.model") this.renderAi(completer.status);
      if (key === "ui.language") toast(t("settings.languageChanged"), "info");
    });
  }
}
