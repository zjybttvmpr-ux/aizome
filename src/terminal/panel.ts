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
  private banner!: HTMLElement;
  /** 実行中のプログラムの見張り（長く動き続ける・同じ出力をくり返す） */
  private watch: {
    ptyId: number;
    start: number;
    lastData: number;
    partial: string;
    lastLine: string;
    repeat: number;
    recent: number[];
    warned: boolean;
    done: boolean;
  } | null = null;
  private watchTimer: number | undefined;
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
      (() => {
        const b = this.button("alert", t("terminal.explainError"), () => this.deps.explainError?.());
        b.classList.add("err-btn");
        return b;
      })(),
      h("span", { class: "panel-sep" }),
      plus,
      pick,
      this.button("trash", t("terminal.kill"), () => this.killActive()),
      this.button("x", t("terminal.hide"), () => this.hide()),
    );
    this.banner = h("div", { class: "panel-banner", hidden: true });
    this.el = h("section", { class: "panel", "aria-label": t("terminal.title") }, h("header", { class: "panel-header" }, this.tabsEl, actions), this.banner, this.body);

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
    await pty.onData(({ id, data }) => {
      this.sessions.find((s) => s.ptyId === id)?.view.write(data);
      if (this.watch && this.watch.ptyId === id) this.watchData(data);
    });
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

  // ───────── 見張り

  private startWatch(ptyId: number) {
    this.hideBanner();
    window.clearInterval(this.watchTimer);
    if (!settings.get("run.watch")) {
      this.watch = null;
      return;
    }
    const now = Date.now();
    this.watch = { ptyId, start: now, lastData: now, partial: "", lastLine: "", repeat: 0, recent: [], warned: false, done: false };
    this.watchTimer = window.setInterval(() => this.watchTick(), 1000);
  }

  private stopWatch() {
    window.clearInterval(this.watchTimer);
    this.watch = null;
  }

  private watchData(data: string) {
    const w = this.watch!;
    w.lastData = Date.now();
    const text = (w.partial + data).replace(/\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07/g, "").replace(/\r/g, "");
    // 実行の終わりの印（--- 終了しました …）が出たら見張りをやめる
    if (/--- (終了しました|記録が終わりました|Finished|Recording finished)/.test(text)) {
      w.done = true;
      this.hideBanner();
      this.stopWatch();
      return;
    }
    const lines = text.split("\n");
    w.partial = lines.pop() ?? "";
    const now = Date.now();
    for (const line of lines) {
      w.recent.push(now);
      if (line === w.lastLine && line.trim()) w.repeat++;
      else {
        w.lastLine = line;
        w.repeat = 0;
      }
    }
    while (w.recent.length && now - w.recent[0] > 3000) w.recent.shift();
    if (w.warned) return;
    if (w.repeat >= 300) this.warn(t("watch.repeat", { line: w.lastLine.slice(0, 40) }));
    else if (w.recent.length > 6000) this.warn(t("watch.flood"));
  }

  private watchTick() {
    const w = this.watch;
    if (!w || w.done) return this.stopWatch();
    const s = this.sessions.find((x) => x.ptyId === w.ptyId);
    if (!s || !s.alive) return this.stopWatch();
    if (w.warned) return;
    const now = Date.now();
    const limit = Math.max(3, settings.get("run.watchSeconds") ?? 15) * 1000;
    if (now - w.start < limit) return;
    // 最後の行が改行で終わらずに止まっている＝input() で入力を待っている、とみなして知らせない
    if (w.partial.trim() && now - w.lastData > 1200) return;
    this.warn(t("watch.long", { sec: String(Math.round((now - w.start) / 1000)) }));
  }

  private warn(message: string) {
    if (!this.watch) return;
    this.watch.warned = true;
    const b = this.banner;
    clear(b);
    b.append(
      h("span", { class: "panel-banner-text" }, "⚠ " + message),
      h("button", { class: "btn small danger", type: "button", onclick: () => (this.interruptRunner(), this.hideBanner()) }, t("watch.stop")),
      h("button", { class: "btn small plain", type: "button", onclick: () => this.hideBanner() }, t("watch.keep")),
    );
    b.hidden = false;
    this.show();
  }

  private hideBanner() {
    this.banner.hidden = true;
  }

  /** 実行用のターミナルの実行を止める */
  private interruptRunner() {
    const s = this.sessions.find((x) => x.runner && x.alive && x.ptyId !== null) ?? this.active;
    if (s?.alive && s.ptyId !== null) pty.write(s.ptyId, "\x03").catch(() => {});
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
    if (s.ptyId !== null && s.alive) {
      this.startWatch(s.ptyId);
      await pty.write(s.ptyId, command + "\r");
    }
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
