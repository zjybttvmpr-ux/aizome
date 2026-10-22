// アプリ全体の組み立て：レイアウト、タブ、ファイル操作、コマンド、ステータスバー
import { h, clear } from "./core/dom";
import { t } from "./core/i18n";
import { bus } from "./core/events";
import { settings } from "./core/settings";
import { commands, formatKey, installKeybindings } from "./core/commands";
import { fs, dialog, sys, git, appWindow, osIntegration, runtimes, type SysInfo } from "./core/platform";
import { basename, dirname, extname, isInside, join, relative, resolveIn, stripExt } from "./core/paths";
import { LANG_CHOICES, directiveAsComment, guessLanguage, parseDirective, setDirective } from "./core/langDirective";
import { createEditorHost } from "./editor/editor";
import type { EditorHost } from "./editor/types";
import { TerminalPanel } from "./terminal/panel";
import { expandCommand, findRunConfig } from "./terminal/runner";
import { FileTree } from "./ui/fileTree";
import { createExtensionsView } from "./ui/extensionsView";
import { settingsPage } from "./ui/settingsPage";
import { describeAiError, ensureLocalAi, useModelFile } from "./ai/localAi";
import { checkForUpdates, openUpdateDialog, startUpdateChecks, type UpdateDeps } from "./ui/updates";
import type { UpdateInfo } from "./core/platform";
import { applyTheme, listThemes } from "./ui/themes";
import { choose, inputBox } from "./ui/dialog";
import { toast } from "./ui/toast";
import { icon } from "./ui/icons";
import { openCommandPalette, openQuickOpen, quickPick } from "./ui/palette";
import { completer, type AiStatus } from "./ai/completer";
import { ExtensionHost } from "./extensions/host";
import { createSearchView, type SearchView } from "./ui/searchView";
import { createAiChatView, type AiChatView } from "./ui/aiChatView";
import { createDictView, type DictView } from "./ui/dictView";
import { aiRewrite } from "./ui/aiRewrite";
import { renderMarkdown } from "./ui/markdown";
import { initAppearance, zoomBy } from "./ui/appearance";
import { menu, type MenuItem } from "./ui/menu";
import { buildFromJapanese } from "./ui/jpBuildDialog";
import { sampleTemplate } from "./ai/jpBuild";
import { explainError } from "./ai/errorExplain";
import { helpPage } from "./ui/helpPage";
import { listSlash, openSlashPalette } from "./ui/slash";
import { registerBuiltinSlash, showErrorExplanation } from "./ui/slashCommands";
import { countChars } from "./core/jpText";
import { ENCODINGS, encodingById, encodingLabel } from "./core/encodings";
import { TRACER_PY, formatTrace, type TraceResult } from "./run/trace";

interface Doc {
  id: string;
  path: string | null;
  name: string;
  dirty: boolean;
  /** 文字コード（"utf-8" "shift_jis" など）と BOM・改行コード。保存するときにこのとおり書く */
  encoding: string;
  bom: boolean;
  eol: "crlf" | "lf";
}

/** 新しく保存するファイルの文字コード（設定） */
function defaultEncoding(): { encoding: string; bom: boolean; eol: "crlf" | "lf" } {
  const e = encodingById(settings.get("files.encoding"));
  return { encoding: e.encoding, bom: e.bom, eol: settings.get("files.eol") === "crlf" ? "crlf" : "lf" };
}

type ViewName = "explorer" | "search" | "dict" | "ai" | "extensions" | "settings";

export class App {
  private editor: EditorHost = createEditorHost();
  private docs: Doc[] = [];
  private activeId: string | null = null;
  private root: string | null = null;
  private fileIndex: string[] = [];
  private untitledSeq = 0;
  /** 各ファイルを今どの言語（ファイル名）として扱っているか */
  private appliedName = new Map<string, string>();
  private langTimer: number | undefined;
  /** 実行用のコピー → 元のファイル（エラーの場所をクリックしたとき元を開くため） */
  private runCopies = new Map<string, string>();
  private tracePoll: number | undefined;
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
  private update: UpdateInfo | null = null;
  private updateDeps: UpdateDeps = {
    confirmQuit: () => this.confirmQuit(),
    onAvailable: (info) => {
      this.update = info;
      this.renderStatus();
    },
  };
  private searchView: SearchView;
  private dictView: DictView;
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
      explainError: () => void this.explainLastError(),
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
    this.dictView = createDictView({ editor: this.editor, activeName: () => this.activeDoc()?.name ?? null, hasDoc: () => !!this.activeDoc() });
  }

  async start() {
    this.build();
    this.registerCommands();
    this.registerSlashCommands();
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

    // PC の中の AI を探して、止まっていれば起動する（USB のモデルも探す）
    void ensureLocalAi({ quiet: true });
    let lastRecover = Date.now();
    completer.onStatus((st, detail) => {
      // つながらない・モデルがないときは、1分に1回まで自動で探し直す
      if (st === "error" && /NOT_RUNNING|MODEL_NOT_FOUND|CONNECT_FAILED/.test(detail ?? "") && Date.now() - lastRecover > 60000) {
        lastRecover = Date.now();
        void ensureLocalAi({ quiet: true });
      }
    });

    // ファイルやフォルダを画面にドラッグして開く
    this.setupFileDrop();

    // 「プログラムから開く」や右クリックから渡されたファイルを開く（起動中に渡されたものも）
    const takeOpenPaths = async () => {
      const paths = await osIntegration.takeOpenPaths().catch(() => [] as string[]);
      if (paths.length) await this.openDropped(paths);
    };
    await takeOpenPaths();
    osIntegration.onOpenPaths(() => void takeOpenPaths()).catch(() => {});

    // 新しい版がないか、ときどき調べる
    startUpdateChecks(this.updateDeps);

    // 閉じる前に未保存の確認
    appWindow.onCloseRequested(() => this.confirmQuit()).catch(() => {});
    // ほかのアプリから戻ってきたら Git の状態を更新、離れたら自動保存
    window.addEventListener("focus", () => void this.refreshGit());
    window.addEventListener("blur", () => {
      if (settings.get("editor.autoSave") === "focus") void this.saveAllDirty(true);
    });
    // 見ていないあいだは Git を調べない
    window.setInterval(() => document.hasFocus() && void this.refreshGit(), 30000);
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

  private async saveAllDirty(auto = false) {
    for (const d of this.docs) if (d.dirty && d.path) await this.save(d.id, false, { keepDirective: auto });
  }

  // ───────────── ドラッグ＆ドロップ

  private setupFileDrop() {
    const overlay = h(
      "div",
      { class: "drop-overlay", hidden: true, "aria-hidden": "true" },
      h("div", { class: "drop-box" }, h("span", { html: icon("folderOpen", 28) }), h("strong", {}, t("drop.title")), h("span", {}, t("drop.help"))),
    );
    document.body.append(overlay);
    appWindow
      .onFileDrop(({ type, paths }) => {
        if (type === "enter" || type === "over") overlay.hidden = false;
        else overlay.hidden = true;
        if (type === "drop" && paths.length) void this.openDropped(paths);
      })
      .catch((err) => console.warn("drag-drop", err));
  }

  private async openDropped(paths: string[]) {
    const dirs: string[] = [];
    const files: string[] = [];
    for (const p of paths) {
      const isDir = await fs.isDir(p).catch(() => false);
      (isDir ? dirs : files).push(p);
    }
    // フォルダはワークスペースとして開く（いくつか落とされたら最初の1つ）
    if (dirs.length) await this.openFolder(dirs[0]);
    for (const f of files) {
      const ext = extname(f);
      if (ext === ".gguf") {
        // AI のモデルファイルなら読み込む
        await useModelFile(f);
      } else if ([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".avif"].includes(ext) && settingsPage.isOpen) {
        // 設定画面を開いているときに画像を落としたら背景にする
        settings.set("look.bgImage", f);
      } else {
        await this.openFile(f);
      }
    }
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
        button("wand", t("cmd.slash"), () => void openSlashPalette("/", () => this.quickOpen()), "top-tool"),
        button("help", `${t("cmd.help")} (F1)`, () => helpPage.open(), "top-tool"),
        this.aiPill,
        h(
          "button",
          { class: "run-btn secondary", title: `${t("cmd.trace")} (F6)`, onclick: () => this.traceActive() },
          h("span", { html: icon("eye", 14) }),
          h("span", {}, t("top.trace")),
        ),
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
    addActivity("dict", "book", t("view.dict"));
    addActivity("ai", "spark", t("view.ai"));
    addActivity("extensions", "puzzle", t("view.extensions"));
    activity.append(h("div", { class: "activity-spacer" }));
    activity.append(button("terminal", t("cmd.toggleTerminal"), () => this.terminal.toggle(), "activity-btn"));
    activity.append(button("gear", t("view.settings"), () => settingsPage.toggle(), "activity-btn"));

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
    this.views.set("dict", this.dictView.el);
    this.views.set("ai", this.chatView.el);
    this.views.set("extensions", createExtensionsView(this.extensions));
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
    if (view === "settings") {
      settingsPage.open();
      return;
    }
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
    // フォルダを開いていなくても、/ の便利機能とヘルプは使える
    void openQuickOpen(() => (this.root ? this.fileIndex : []), this.root ?? "", (p) => void this.openFile(p));
  }

  private activeDoc(): Doc | undefined {
    return this.docs.find((d) => d.id === this.activeId);
  }

  async openFile(path: string, line?: number, col?: number) {
    let doc = this.docs.find((d) => d.path === path);
    if (!doc) {
      let text: string;
      let read: Awaited<ReturnType<typeof fs.readFileEnc>>;
      try {
        read = await fs.readFileEnc(path, undefined, settings.get("files.guessEncoding"));
        text = read.text;
      } catch (err) {
        const msg = String(err);
        toast(
          msg.includes("BINARY_FILE") ? t("file.binary", { name: basename(path) }) : msg.includes("FILE_TOO_LARGE") ? t("file.tooLarge", { name: basename(path) }) : t("file.openFailed", { name: basename(path), err: msg }),
          "warn",
        );
        return;
      }
      doc = { id: path, path, name: basename(path), dirty: false, encoding: read.encoding, bom: read.bom, eol: read.eol };
      if (read.encoding !== "utf-8") toast(t("enc.openedAs", { name: doc.name, enc: encodingLabel(read.encoding, read.bom) }), "info", 7000);
      if (read.lossy) toast(t("enc.lossy", { name: doc.name }), "warn", 9000);
      this.docs.push(doc);
      await this.editor.open(doc.id, text, doc.name);
      this.appliedName.set(doc.id, doc.name);
      this.refreshLanguage(doc);
      bus.emit("file:opened", { path });
      this.saveSession();
    }
    this.activate(doc.id);
    if (line) requestAnimationFrame(() => this.editor.goTo(line, col));
  }

  private async openLocation(p: string, line: number, col: number) {
    // 実行用のコピーの場所なら、元のファイルを開く
    for (const [copy, docId] of this.runCopies) {
      if (p === copy || p.replace(/\\/g, "/").endsWith(copy.replace(/\\/g, "/").split("/").slice(-3).join("/"))) {
        if (this.docs.some((d) => d.id === docId)) {
          this.activate(docId);
          this.editor.goTo(line, col);
          return;
        }
      }
    }
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
    const doc: Doc = { id, path: null, name: t("file.untitled", { n: String(this.untitledSeq) }), dirty: false, ...defaultEncoding() };
    this.docs.push(doc);
    const name = `untitled${settings.get("files.newFileLanguage") || ".py"}`;
    this.appliedName.set(id, name);
    void this.editor.open(id, "", name).then(() => this.activate(id));
  }

  /**
   * このファイルを何語として扱うか。
   * 1 行目の「## py ##」などの指定 → 保存前なら中身から推測 → 新しいファイルの言語（設定）→ 拡張子
   */
  private effectiveName(doc: Doc): string {
    const head = this.editor.peek(doc.id, 4000);
    const directive = parseDirective(head.split("\n", 1)[0] ?? "");
    const base = doc.path ? doc.name : `untitled${settings.get("files.newFileLanguage") || ".py"}`;
    if (directive) return stripExt(base) + directive.ext;
    if (!doc.path) {
      const guessed = guessLanguage(head);
      if (guessed) return "untitled" + guessed;
      // 推測できないときは、今の扱いを続ける（入力のたびに言語が変わらないように）
      return this.appliedName.get(doc.id) ?? base;
    }
    return doc.name;
  }

  /** 言語の扱いを見直して、変わっていたらエディタ（色分け・AI・実行）に反映する */
  private refreshLanguage(doc: Doc) {
    if (!this.editor.has(doc.id)) return;
    const name = this.effectiveName(doc);
    if (this.appliedName.get(doc.id) === name) return;
    this.appliedName.set(doc.id, name);
    void this.editor.rename(doc.id, doc.id, name).then(() => this.renderStatus());
  }

  /** 文字コード：保存する文字コードを変える／文字コードを指定して開き直す／改行コードを変える */
  async pickEncoding() {
    const doc = this.activeDoc();
    if (!doc) return;
    type Act = "save" | "reopen" | "eol";
    const act = await quickPick<Act>(
      [
        { label: t("enc.actSave"), detail: t("enc.now", { enc: encodingLabel(doc.encoding, doc.bom) }), value: "save" },
        ...(doc.path ? [{ label: t("enc.actReopen"), detail: t("enc.actReopenDetail"), value: "reopen" as Act }] : []),
        { label: t("enc.actEol", { eol: doc.eol === "crlf" ? "LF" : "CRLF" }), detail: t("enc.nowEol", { eol: doc.eol === "crlf" ? "CRLF" : "LF" }), value: "eol" },
      ],
      t("enc.pick"),
    );
    if (!act) return;
    if (act === "eol") {
      doc.eol = doc.eol === "crlf" ? "lf" : "crlf";
      doc.dirty = true;
      this.renderTabs();
      this.renderStatus();
      if (doc.path) await this.save(doc.id, false, { keepDirective: true });
      toast(t("enc.eolChanged", { eol: doc.eol === "crlf" ? "CRLF" : "LF" }), "success");
      return;
    }
    const choice = await quickPick(
      ENCODINGS.map((e) => ({ label: e.label, detail: e.note, value: e })),
      act === "save" ? t("enc.actSave") : t("enc.actReopen"),
    );
    if (!choice) return;
    if (act === "save") {
      doc.encoding = choice.encoding;
      doc.bom = choice.bom;
      doc.dirty = true;
      this.renderTabs();
      this.renderStatus();
      if (doc.path && (await this.save(doc.id, false, { keepDirective: true }))) toast(t("enc.savedAs", { enc: choice.label }), "success");
      else if (!doc.path) toast(t("enc.willSaveAs", { enc: choice.label }), "info");
      return;
    }
    if (!doc.path) return;
    if (doc.dirty) {
      const ok = await choose(t("enc.reopenTitle"), t("enc.reopenDirty"), [
        { label: t("common.cancel"), value: false, kind: "plain" },
        { label: t("enc.reopenAnyway"), value: true, kind: "danger" },
      ], false);
      if (!ok) return;
    }
    try {
      const read = await fs.readFileEnc(doc.path, choice.encoding);
      doc.encoding = read.encoding;
      doc.bom = read.bom || choice.bom;
      doc.eol = read.eol;
      this.editor.setText(doc.id, read.text);
      doc.dirty = false;
      this.renderTabs();
      this.renderStatus();
      toast(read.lossy ? t("enc.reopenLossy", { enc: choice.label }) : t("enc.reopened", { enc: choice.label }), read.lossy ? "warn" : "success", 7000);
    } catch (err) {
      toast(t("file.openFailed", { name: doc.name, err: String(err) }), "error");
    }
  }

  /** ステータスバーの言語をクリック：1 行目に「## 言語 ##」を書いて切り替える */
  private async pickLanguage() {
    const doc = this.activeDoc();
    if (!doc) return;
    const current = extname(this.appliedName.get(doc.id) ?? doc.name);
    const choice = await quickPick(
      LANG_CHOICES.map((c) => ({ label: c.label, detail: c.ext === current ? t("lang.current") : `## ${c.tag} ##`, value: c })),
      t("lang.pick"),
    );
    if (!choice) return;
    this.editor.activate(doc.id);
    this.editor.applyText(setDirective(this.editor.getText(doc.id), choice));
    this.refreshLanguage(doc);
    toast(t("lang.set", { name: choice.label, tag: `## ${choice.tag} ##` }), "success", 5000);
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

  /**
   * 保存する。1 行目の「## py ##」のような言語の指定は、ファイルには書かずに取り除く（普通のコメントはそのまま）。
   * 自動保存や実行前の保存では取り除かない（書いた直後に消えたり、実行する言語が変わったりしないように）
   */
  async save(id = this.activeId, forceAs = false, opts: { keepDirective?: boolean } = {}): Promise<boolean> {
    const doc = this.docs.find((d) => d.id === id);
    if (!doc) return false;
    let path = doc.path;
    if (!path || forceAs) {
      const suggested = doc.path ? basename(doc.path) : stripExt(doc.name) + (extname(this.appliedName.get(doc.id) ?? "") || ".txt");
      path = await dialog.saveFile(this.root ? resolveIn(this.root, suggested) : suggested);
      if (!path) return false;
    }
    let text = this.editor.getText(doc.id);
    const original = text;
    const firstLine = text.split("\n", 1)[0] ?? "";
    const directive = opts.keepDirective ? null : parseDirective(firstLine);
    if (directive) text = text.slice(firstLine.length).replace(/^\r?\n/, "");
    if (settings.get("editor.trimTrailingWhitespace")) text = text.replace(/[ \t]+$/gm, "");
    if (settings.get("editor.insertFinalNewline") && text.length && !text.endsWith("\n")) text += "\n";
    if (text !== original) {
      // 表示中のファイルは変わったところだけ書き換える（カーソルがずれないように）
      if (doc.id === this.activeId) this.editor.applyText(text);
      else this.editor.setText(doc.id, text);
    }
    if (directive && extname(path) && extname(path).toLowerCase() !== directive.ext) {
      toast(t("lang.savedOtherExt", { name: directive.label, file: basename(path) }), "warn", 8000);
    }
    try {
      await fs.writeFileEnc(path, text, doc.encoding, doc.bom, doc.eol);
    } catch (err) {
      const msg = String(err);
      const bad = /UNMAPPABLE: (.*)/.exec(msg);
      if (bad) {
        // Shift_JIS などで書けない文字（絵文字・一部の漢字）があるとき
        const asUtf8 = await choose(
          t("enc.unmappableTitle", { enc: encodingLabel(doc.encoding, doc.bom) }),
          t("enc.unmappable", { chars: bad[1], enc: encodingLabel(doc.encoding, doc.bom) }),
          [
            { label: t("common.cancel"), value: false, kind: "plain" },
            { label: t("enc.saveUtf8"), value: true, kind: "primary" },
          ],
          false,
        );
        if (!asUtf8) return false;
        doc.encoding = "utf-8";
        doc.bom = false;
        return this.save(doc.id, false, opts);
      }
      toast(t("file.saveFailed", { name: doc.name, err: msg }), "error");
      return false;
    }
    if (doc.path !== path) {
      const oldId = doc.id;
      doc.id = path;
      doc.path = path;
      doc.name = basename(path);
      await this.editor.rename(oldId, path, doc.name);
      if (this.activeId === oldId) this.activeId = path;
      this.appliedName.delete(oldId);
      this.appliedName.set(path, doc.name);
      this.refreshLanguage(doc);
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

  /**
   * 実行するファイルを用意する。
   * 保存してあって言語の指定もなければそのファイル、そうでなければ（## C# ## の指定・保存前）その言語の拡張子のコピーを作る
   */
  private async prepareRunTarget(doc: Doc): Promise<{ path: string; cwd: string; overrides?: Record<string, string> } | null> {
    const first = this.editor.getText(doc.id).split("\n", 1)[0] ?? "";
    const directive = parseDirective(first);
    // 保存してあるファイルは、変更を保存してから
    if (doc.path && doc.dirty && !(await this.save(doc.id, false, { keepDirective: true }))) return null;
    if (!directive && doc.path) return { path: doc.path, cwd: dirname(doc.path) };
    const ext = directive?.ext ?? extname(this.effectiveName(doc));
    if (!ext || ext === ".txt" || ext === ".md") {
      toast(t("run.pickLanguage"), "info", 7000);
      void this.pickLanguage();
      return null;
    }
    const latest = this.editor.getText(doc.id);
    const latestFirst = latest.split("\n", 1)[0] ?? "";
    const body = directive ? directiveAsComment(latestFirst, ext) + latest.slice(latestFirst.length) : latest;
    const runDir = join(join(this.sys.home, ".aizome"), "run");
    await fs.createDir(runDir).catch(() => {});
    const stem = stripExt(doc.name).replace(/[\\/:*?"<>|\s]+/g, "_") || "untitled";
    const copy = join(runDir, stem + ext);
    try {
      await fs.writeFile(copy, body);
    } catch (err) {
      toast(t("file.saveFailed", { name: basename(copy), err: String(err) }), "error");
      return null;
    }
    this.runCopies.set(copy, doc.id);
    const cwd = doc.path ? dirname(doc.path) : runDir;
    return { path: copy, cwd, overrides: { fileDir: cwd, fileBase: copy, file: copy, fileNoExt: join(cwd, stem), fileBaseNoExt: stem } };
  }

  async runActive() {
    const doc = this.activeDoc();
    if (!doc) {
      toast(t("run.noFile"), "info");
      return;
    }
    const target = await this.prepareRunTarget(doc);
    if (target) await this.runPath(target.path, target.overrides);
  }

  /** 値を見る：行ごとの変数の値を記録しながら実行して、行の右に表示する（Python） */
  async traceActive() {
    const doc = this.activeDoc();
    if (!doc) {
      toast(t("run.noFile"), "info");
      return;
    }
    const ext = extname(this.appliedName.get(doc.id) ?? this.effectiveName(doc));
    if (ext !== ".py" && ext !== ".pyw") {
      toast(t("trace.onlyPython"), "info", 6000);
      return;
    }
    const target = await this.prepareRunTarget(doc);
    if (!target) return;
    const home = join(this.sys.home, ".aizome");
    await fs.createDir(home).catch(() => {});
    const tracer = join(home, "tracer.py");
    const out = join(home, `trace-${Date.now()}.json`);
    try {
      await fs.writeFile(tracer, TRACER_PY);
    } catch (err) {
      toast(t("file.saveFailed", { name: "tracer.py", err: String(err) }), "error");
      return;
    }
    const win = this.sys.os === "windows";
    const q = (p: string) => (win ? `"${p.replace(/[`$"]/g, (ch) => "`" + ch)}"` : `"${p.replace(/(["$`\\])/g, "\\$1")}"`);
    let cmd = win
      ? `Set-Location ${q(target.cwd)}; python ${q(tracer)} ${q(target.path)} ${q(out)}`
      : `cd ${q(target.cwd)} && python3 ${q(tracer)} ${q(target.path)} ${q(out)}`;
    const resolved = await this.resolvePython(cmd);
    if (resolved === null) return;
    cmd = resolved;
    if (win) cmd += `; Write-Host ""; Write-Host "--- ${t("trace.finished", { code: "$LASTEXITCODE" })} ---" -ForegroundColor DarkGray`;
    this.lastRunDir = target.cwd;
    this.editor.showValues(doc.id, null);
    const startText = this.editor.getText(doc.id);
    await this.terminal.run(cmd, target.cwd);
    toast(t("trace.running"), "info", 4000);
    // 終わると記録のファイルができるので、それを待って読む
    window.clearInterval(this.tracePoll);
    const started = Date.now();
    this.tracePoll = window.setInterval(async () => {
      if (Date.now() - started > 30 * 60 * 1000) return window.clearInterval(this.tracePoll);
      if (!(await fs.exists(out).catch(() => false))) return;
      window.clearInterval(this.tracePoll);
      try {
        const result = JSON.parse(await fs.readFile(out)) as TraceResult;
        void fs.remove(out).catch(() => {});
        if (!this.docs.some((d) => d.id === doc.id)) return;
        if (this.editor.getText(doc.id) !== startText) {
          toast(t("trace.changed"), "warn", 6000);
          return;
        }
        const values = formatTrace(result);
        if (this.activeId !== doc.id) this.activate(doc.id);
        this.editor.showValues(doc.id, values);
        toast(t(result.truncated ? "trace.truncated" : "trace.done", { n: String(values.size) }), result.error ? "warn" : "success", 7000);
      } catch (err) {
        toast(t("trace.failed", { err: String(err) }), "error");
      }
    }, 500);
  }

  private async runPath(path: string, overrides?: Record<string, string>) {
    const config = findRunConfig(path);
    if (!config) {
      toast(t("run.noConfig", { name: basename(path) }), "warn", 6000);
      return;
    }
    let cmd = expandCommand(config, path, this.root ?? "", this.sys.os, overrides);
    if (config.id === "python") {
      const resolved = await this.resolvePython(cmd);
      if (resolved === null) return;
      cmd = resolved;
    }
    if (this.sys.os === "windows") {
      // 終わったことと終了コードがわかるように（何も出力しないプログラムでも安心できる）
      cmd += `; Write-Host ""; Write-Host "--- ${t("run.finished", { code: "$LASTEXITCODE" })} ---" -ForegroundColor DarkGray`;
    }
    const cwd = overrides?.fileDir ?? dirname(path);
    this.lastRunDir = cwd;
    await this.terminal.run(cmd, cwd);
  }

  /**
   * 「python」を本物の Python に置き換える。
   * Windows では Python が入っていないと、Store へ案内するだけの python が動いて「Python」と出るだけになるため
   */
  private async resolvePython(cmd: string): Promise<string | null> {
    let info: { command: string | null; storeStub: boolean };
    try {
      info = await runtimes.findPython();
    } catch {
      return cmd;
    }
    if (info.command) {
      if (info.command === "python" || info.command === "python3") return cmd;
      const call = this.sys.os === "windows" ? `& ${info.command}` : info.command;
      return cmd.replace(/(^|;\s*|&&\s*)python3?(?=\s)/, (_m, pre: string) => pre + call);
    }
    const isWin = this.sys.os === "windows";
    const choice = await choose(
      t("run.noPythonTitle"),
      t(info.storeStub ? "run.noPythonStub" : "run.noPython"),
      isWin
        ? [
            { label: t("common.cancel"), value: "cancel", kind: "plain" },
            { label: t("run.openStore"), value: "store", kind: "plain" },
            { label: t("run.installPython"), value: "winget", kind: "primary" },
          ]
        : [{ label: t("common.ok"), value: "cancel", kind: "primary" }],
      "cancel",
    );
    if (choice === "winget") {
      await this.terminal.run(
        `winget install -e --id Python.Python.3.12 --scope user --accept-source-agreements --accept-package-agreements; Write-Host ""; Write-Host "${t("run.pythonInstalledHint")}" -ForegroundColor Green`,
      );
    } else if (choice === "store") {
      await this.terminal.run(`Start-Process "ms-windows-store://pdp/?productid=9NCVDN91XZQP"`);
    }
    return null;
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
      const enc = defaultEncoding();
      await fs.writeFileEnc(path, text, enc.encoding, enc.bom, enc.eol);
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
    if (this.update) {
      const info = this.update;
      this.statusLeft.append(
        h("button", { class: "status-item update-item", title: t("update.title", { version: info.latest ?? "" }), onclick: () => void openUpdateDialog(this.updateDeps, info) }, t("update.status", { version: info.latest ?? "" })),
      );
    }
    if (doc?.dirty) this.statusLeft.append(h("span", { class: "status-item dirty-note" }, t("status.unsaved")));
    for (const [, v] of this.statusItems) this.statusLeft.append(item(v.text, v.tooltip));

    if (doc) {
      const pos = this.editor.cursor();
      const sel = this.editor.getSelection();
      if (sel) {
        const c = countChars(sel);
        this.statusRight.append(item(t("status.selection", { n: c.chars.toLocaleString(), lines: String(c.lines) }), t("status.selectionTitle"), () => void openSlashPalette("/count").catch(() => {})));
      }
      this.statusRight.append(
        item(t("status.position", { line: String(pos.line), col: String(pos.col) }), undefined, () => void this.goToLine()),
        item(t("status.spaces", { n: String(settings.get("editor.tabSize")) })),
        item(`${encodingLabel(doc.encoding, doc.bom)}  ${doc.eol === "crlf" ? "CRLF" : "LF"}`, t("enc.pick"), () => void this.pickEncoding()),
        item(this.editor.languageName(), t("lang.pick"), () => void this.pickLanguage()),
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
      status === "error" ? `${t("ai.errorTitle")}\n${describeAiError(completer.lastError)}` : status === "off" ? t("ai.offTitle") : t("ai.onTitle", { model });
    this.aiPill.innerHTML = "";
    this.aiPill.append(h("span", { class: "ai-drop", "aria-hidden": "true" }), h("span", { class: "ai-label" }, label));
  }

  private onAiPillClick() {
    if (completer.status === "error") {
      toast(describeAiError(completer.lastError), "error", 10000);
      completer.setStatus(settings.get("ai.enabled") ? "idle" : "off");
      settingsPage.open("ai");
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
      const read = await fs.readFileEnc(doc.path, doc.encoding);
      const text = read.text;
      doc.bom = read.bom;
      doc.eol = read.eol;
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
          c("view.dict"),
          c("view.zen", () => this.el.classList.contains("zen")),
          c("editor.toggleExplain", () => settings.get("editor.explain") !== "off"),
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
        items: () => [c("run.file"), c("run.trace"), c("run.clearValues"), sep, c("terminal.new"), c("terminal.toggle", () => this.terminal.isVisible), c("terminal.clear")],
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
        items: () => [c("help.open"), c("help.slash"), c("help.shortcuts"), c("view.commandPalette"), sep, c("ext.reload"), c("git.refresh"), sep, c("app.checkUpdates"), c("help.about")],
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

  /** ターミナルに出た最後のエラーを日本語で説明する */
  private async explainLastError() {
    const recent = this.terminal.recentOutput(400);
    await showErrorExplanation(explainError(recent, this.sys.os), {
      recent,
      goTo: (file, line) => void this.openLocation(file, line, 1),
      run: (cmd) => void this.terminal.run(cmd),
      askAi: (q) => {
        this.showView("ai");
        this.chatView.ask(q);
      },
    });
  }

  private registerSlashCommands() {
    registerBuiltinSlash({
      editor: this.editor,
      os: () => this.sys.os,
      activeName: () => this.activeDoc()?.path ?? this.activeDoc()?.name ?? null,
      hasDoc: () => !!this.activeDoc(),
      showView: (v) => this.showView(v),
      searchFor: (text) => {
        this.showView("search");
        this.searchView.focus(text || undefined);
      },
      askAi: (q) => {
        this.showView("ai");
        this.chatView.ask(q);
      },
      runInTerminal: (cmd) => void this.terminal.run(cmd),
      explainError: () => void this.explainLastError(),
      openSettings: (section) => settingsPage.open(section),
      openHelp: (section) => helpPage.open(section),
      openDict: (query) => {
        this.showView("dict");
        this.dictView.focus(query);
      },
    });
    // ヘルプの中の「/〜」をクリックしたとき
    helpPage.runSlash = (name) => {
      const c = listSlash().find((x) => x.name === name);
      if (!c) return;
      if (c.argHint || c.expand) void openSlashPalette(`/${c.name}${c.argHint ? " " : ""}`);
      else void c.run?.("");
    };
  }

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
    reg("view.toggleSidebar", "cmd.toggleSidebar", () => this.el.classList.toggle("sidebar-hidden"), "Mod-B");
    reg("view.explorer", "cmd.showExplorer", () => this.showView("explorer"), "Mod-Shift-E");
    reg("view.extensions", "cmd.showExtensions", () => this.showView("extensions"), "Mod-Shift-X");
    reg("view.settings", "cmd.showSettings", () => settingsPage.toggle(), "Mod-,", true);
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
    reg("editor.toggleExplain", "cmd.toggleExplain", () => {
      const next = settings.get("editor.explain") === "off" ? "ai" : "off";
      settings.set("editor.explain", next);
      toast(t(next === "off" ? "explain.offToast" : "explain.onToast"), "info");
    }, "Mod-Alt-E", true);
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
    reg("ai.settings", "cmd.aiSettings", () => settingsPage.open("ai"));
    reg("ai.detect", "cmd.aiDetect", () => ensureLocalAi());
    reg("help.open", "cmd.help", () => helpPage.open(), "F1", true);
    reg("help.slash", "cmd.slash", () => openSlashPalette("/"));
    reg("terminal.explainError", "cmd.explainError", () => this.explainLastError());
    reg("file.encoding", "cmd.encoding", () => this.pickEncoding());
    reg("run.trace", "cmd.trace", () => this.traceActive(), "F6", true);
    reg("run.clearValues", "cmd.clearValues", () => {
      const doc = this.activeDoc();
      if (doc) this.editor.showValues(doc.id, null);
    });
    reg("view.dict", "cmd.dict", () => {
      this.showView("dict");
      this.dictView.focus();
    }, "Mod-Shift-D", true);
    reg("help.shortcuts", "help.shortcuts", () => this.showShortcuts(), "Mod-K");
    reg("help.about", "help.about", () => this.showAbout());
    reg("app.checkUpdates", "cmd.checkUpdates", () => checkForUpdates(this.updateDeps, true));
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
      if (doc) {
        window.clearTimeout(this.langTimer);
        this.langTimer = window.setTimeout(() => this.refreshLanguage(doc), 350);
      }
      if (doc && settings.get("editor.autoSave") === "delay" && doc.path) {
        window.clearTimeout(this.autoSaveTimer);
        this.autoSaveTimer = window.setTimeout(() => {
          if (doc.dirty) void this.save(doc.id, false, { keepDirective: true });
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
