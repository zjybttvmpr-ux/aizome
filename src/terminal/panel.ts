// 下部のターミナルパネル。複数タブ・実行用ターミナル・ファイル位置リンクを扱う
import { pty } from "../core/platform";
import { settings } from "../core/settings";
import { bus } from "../core/events";
import { h, clear } from "../core/dom";
import { icon } from "../ui/icons";
import { t } from "../core/i18n";
import { createTermView } from "./xtermView";
import { menu, type MenuItem } from "../ui/menu";
import type { TermView } from "./types";

interface Session {
  ptyId: number | null;
  name: string;
  view: TermView;
  alive: boolean;
  runner: boolean;
}

export interface TerminalDeps {
  cwd: () => string | undefined;
  /** 「エラーを日本語で」ボタン */
  explainError?: () => void;
  openLocation: (path: string, line: number, col: number) => void;
  onVisibilityChange: (visible: boolean) => void;
}

export class TerminalPanel {
  readonly el: HTMLElement;
  private tabsEl: HTMLElement;
  private body: HTMLElement;
  private sessions: Session[] = [];
  private active: Session | null = null;
  private counter = 0;
  private visible = false;
  private listening = false;
  private lastRun: { command: string; cwd?: string } | null = null;
  private shells: { name: string; command: string }[] | null = null;

  constructor(private deps: TerminalDeps) {
    this.tabsEl = h("div", { class: "panel-tabs", role: "tablist" });
    this.body = h("div", { class: "panel-body" });
    const plus = this.button("plus", t("terminal.new"), () => this.newTerminal());
    const pick = this.button("chevronDown", t("terminal.pickShell"), () => void this.pickShell(pick));
    pick.classList.add("narrow");
    const actions = h(
      "div",
      { class: "panel-actions" },
      this.button("stop", t("terminal.interrupt"), () => this.interrupt()),
      this.button("refresh", t("terminal.rerun"), () => void this.rerun()),
      this.button("alert", t("terminal.explainError"), () => this.deps.explainError?.()),
      h("span", { class: "panel-sep" }),
      plus,
      pick,
      this.button("trash", t("terminal.kill"), () => this.killActive()),
      this.button("x", t("terminal.hide"), () => this.hide()),
    );
    this.el = h("section", { class: "panel", "aria-label": t("terminal.title") }, h("header", { class: "panel-header" }, this.tabsEl, actions), this.body);

    new ResizeObserver(() => this.fitActive()).observe(this.body);
    bus.on("theme:changed", () => this.sessions.forEach((s) => s.view.applyTheme()));
    bus.on("settings:changed", ({ key }) => {
      if (key === "terminal.fontSize") this.sessions.forEach((s) => s.view.setFontSize(settings.get("terminal.fontSize")));
    });
  }

  private button(name: string, label: string, onclick: () => void) {
    return h("button", { class: "icon-btn", title: label, "aria-label": label, onclick, html: icon(name, 15) });
  }

  private async listen() {
    if (this.listening) return;
    this.listening = true;
    await pty.onData(({ id, data }) => this.sessions.find((s) => s.ptyId === id)?.view.write(data));
    await pty.onExit(({ id, code }) => {
      const s = this.sessions.find((x) => x.ptyId === id);
      if (!s) return;
      s.alive = false;
      s.view.write(`\r\n\x1b[2m${t("terminal.exited", { code: String(code ?? "?") })}\x1b[0m\r\n`);
      this.renderTabs();
    });
  }

  get isVisible() {
    return this.visible;
  }

  show() {
    if (!this.visible) {
      this.visible = true;
      this.el.classList.add("open");
      this.deps.onVisibilityChange(true);
    }
    if (!this.sessions.length) void this.newTerminal();
    else requestAnimationFrame(() => {
      this.fitActive();
      this.active?.view.focus();
    });
  }

  hide() {
    if (!this.visible) return;
    this.visible = false;
    this.el.classList.remove("open");
    this.deps.onVisibilityChange(false);
  }

  toggle() {
    if (this.visible) this.hide();
    else this.show();
  }

  /** 実行中のプログラムを止める（Ctrl+C を送る） */
  interrupt() {
    const s = this.active;
    if (s?.alive && s.ptyId !== null) pty.write(s.ptyId, "\x03").catch(() => {});
    s?.view.focus();
  }

  /** 最後に実行したものをもう一度 */
  async rerun() {
    if (this.lastRun) await this.run(this.lastRun.command, this.lastRun.cwd);
  }

  private async pickShell(anchor: HTMLElement) {
    const shells = (this.shells ??= await pty.shells().catch(() => []));
    const items: MenuItem[] = shells.map((sh) => ({
      type: "action",
      label: sh.name,
      hint: sh.command === (settings.get("terminal.shell") || "") ? t("terminal.default") : undefined,
      run: () => this.newTerminal({ name: sh.name, shell: sh.command }),
    }));
    if (shells.length) {
      items.push({ type: "separator" });
      items.push({
        type: "submenu",
        label: t("terminal.setDefault"),
        items: () =>
          shells.map((sh) => ({
            type: "action",
            label: sh.name,
            checked: (settings.get("terminal.shell") || "") === sh.command,
            run: () => settings.set("terminal.shell", sh.command),
          })),
      });
    }
    menu.open(anchor, items.length ? items : [{ type: "note", label: t("terminal.noShells") }]);
  }

  async newTerminal(opts: { name?: string; runner?: boolean; cwd?: string; shell?: string } = {}): Promise<Session> {
    await this.listen();
    if (!this.visible) {
      this.visible = true;
      this.el.classList.add("open");
      this.deps.onVisibilityChange(true);
    }
    const view = createTermView({ fontSize: settings.get("terminal.fontSize") });
    const session: Session = {
      ptyId: null,
      name: opts.name ?? t("terminal.tabName", { n: String(++this.counter) }),
      view,
      alive: true,
      runner: !!opts.runner,
    };
    this.sessions.push(session);
    this.body.append(view.el);
    this.select(session);
    view.fit();
    view.onFileLink((p, l, c) => this.deps.openLocation(p, l, c));
    view.onInput((data) => {
      if (session.alive && session.ptyId !== null) pty.write(session.ptyId, data).catch(() => {});
    });
    view.onResize((cols, rows) => {
      if (session.alive && session.ptyId !== null) pty.resize(session.ptyId, cols, rows).catch(() => {});
    });
    try {
      session.ptyId = await pty.spawn({
        cwd: opts.cwd ?? this.deps.cwd(),
        cols: Math.max(view.cols, 20),
        rows: Math.max(view.rows, 5),
        shell: opts.shell ?? (settings.get("terminal.shell") || undefined),
      });
    } catch (err) {
      session.alive = false;
      view.write(`\x1b[31m${t("terminal.spawnFailed")}\x1b[0m ${String(err)}\r\n`);
    }
    this.renderTabs();
    return session;
  }

  private select(s: Session) {
    this.active = s;
    for (const x of this.sessions) x.view.el.classList.toggle("active", x === s);
    this.renderTabs();
    requestAnimationFrame(() => {
      s.view.fit();
      s.view.focus();
    });
  }

  private close(s: Session) {
    if (s.ptyId !== null && s.alive) pty.kill(s.ptyId).catch(() => {});
    s.view.dispose();
    s.view.el.remove();
    this.sessions = this.sessions.filter((x) => x !== s);
    if (this.active === s) {
      const next = this.sessions[this.sessions.length - 1];
      if (next) this.select(next);
      else {
        this.active = null;
        this.hide();
      }
    }
    this.renderTabs();
  }

  clearActive() {
    this.active?.view.clear();
  }

  killActive() {
    if (this.active) this.close(this.active);
  }

  private renderTabs() {
    clear(this.tabsEl);
    for (const s of this.sessions) {
      const tab = h(
        "div",
        {
          class: "panel-tab" + (s === this.active ? " active" : "") + (s.alive ? "" : " dead"),
          role: "tab",
          "aria-selected": String(s === this.active),
          tabindex: 0,
          onclick: () => this.select(s),
        },
        h("span", { class: "panel-tab-icon", html: icon(s.runner ? "play" : "terminal", 13) }),
        h("span", { class: "panel-tab-name" }, s.name),
        h("button", {
          class: "tab-close",
          title: t("tabs.close"),
          "aria-label": t("tabs.close"),
          html: icon("x", 12),
          onclick: (e: Event) => {
            e.stopPropagation();
            this.close(s);
          },
        }),
      );
      this.tabsEl.append(tab);
    }
  }

  private fitActive() {
    if (this.visible) this.active?.view.fit();
  }

  /** 実行用ターミナルでコマンドを流す（なければ作る） */
  async run(command: string, cwd?: string) {
    this.lastRun = { command, cwd };
    let s = this.sessions.find((x) => x.runner && x.alive && x.ptyId !== null);
    if (!s) {
      // 実行用のコマンドは PowerShell 向けに書いてあるので、Windows の実行タブは PowerShell にする
      const isWindows = navigator.userAgent.includes("Windows");
      s = await this.newTerminal({ name: t("terminal.runTab"), runner: true, cwd, shell: isWindows ? "powershell.exe" : undefined });
      // シェルのプロンプトが出るまで少し待つ
      await new Promise((r) => setTimeout(r, 350));
    } else {
      this.show();
      this.select(s);
    }
    if (s.ptyId !== null && s.alive) await pty.write(s.ptyId, command + "\r");
  }

  /** 実行用ターミナル（なければ表示中のもの）の最近の出力 */
  recentOutput(maxLines = 300): string {
    const s = this.sessions.find((x) => x.runner) ?? this.active;
    return s ? s.view.recentText(maxLines) : "";
  }

  /** アクティブなターミナルに文字列を送る（拡張機能用） */
  async send(command: string) {
    const s = this.active && this.active.alive ? this.active : await this.newTerminal();
    this.show();
    if (s.ptyId !== null) await pty.write(s.ptyId, command + "\r");
  }
}
