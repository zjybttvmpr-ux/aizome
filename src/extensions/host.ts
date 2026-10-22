// 拡張機能ホスト。マニフェストを読み、静的な追加（テーマ・実行設定・言語・コマンド）を登録し、
// main.js があれば Web Worker で動かして API 呼び出しを権限付きで仲介する。
import { ext as nativeExt, fs } from "../core/platform";
import { commands } from "../core/commands";
import { settings } from "../core/settings";
import { bus } from "../core/events";
import { t } from "../core/i18n";
import { addLanguageAlias } from "../core/languages";
import { isInside, resolveIn } from "../core/paths";
import { addTheme, type Theme } from "../ui/themes";
import { addRunConfig, type RunConfig } from "../terminal/runner";
import { toast } from "../ui/toast";
import { confirmBox, inputBox } from "../ui/dialog";
import { quickPick } from "../ui/palette";
import { completer } from "../ai/completer";
import type { EditorHost } from "../editor/types";
import { buildWorkerSource } from "./workerRuntime";

export type Permission = "workspace.read" | "workspace.write" | "terminal" | "ai";
export const ALL_PERMISSIONS: Permission[] = ["workspace.read", "workspace.write", "terminal", "ai"];

export interface Manifest {
  id: string;
  name: string;
  version?: string;
  description?: string;
  author?: string;
  main?: string;
  permissions?: Permission[];
  contributes?: {
    commands?: { id: string; title: string; key?: string }[];
    themes?: Omit<Theme, "source">[];
    runConfigs?: Omit<RunConfig, "source">[];
    languages?: { extensions: string[]; basedOn: string }[];
  };
}

export type ExtensionStatus = "active" | "disabled" | "error" | "needsPermission" | "loading";

export interface LoadedExtension {
  manifest: Manifest;
  builtin: boolean;
  dir?: string;
  mainSource: string | null;
  status: ExtensionStatus;
  error?: string;
  worker?: Worker;
  disposers: (() => void)[];
  handlers: Set<string>;
}

export interface HostDeps {
  editor: EditorHost;
  activePath: () => string | null;
  root: () => string | null;
  openFile: (path: string) => Promise<void>;
  runInTerminal: (command: string) => Promise<void>;
  setStatusItem: (key: string, text: string | null, tooltip?: string) => void;
}

function validManifest(m: unknown): m is Manifest {
  const x = m as Manifest;
  return !!x && typeof x.id === "string" && /^[A-Za-z0-9._-]+$/.test(x.id) && typeof x.name === "string";
}

export class ExtensionHost {
  private exts = new Map<string, LoadedExtension>();
  private listeners = new Set<() => void>();
  private callSeq = 0;
  private statusKeys = new Set<string>();
  private commandWaiters = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

  constructor(private deps: HostDeps) {
    bus.on("file:saved", ({ path }) => this.broadcast("fileSaved", { path }));
    bus.on("active:changed", ({ path }) => this.broadcast("activeChanged", { path }));
    bus.on("workspace:changed", ({ root }) => this.broadcast("workspaceChanged", { root }));
  }

  onChange(cb: () => void) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private changed() {
    this.listeners.forEach((l) => l());
  }

  list(): LoadedExtension[] {
    return [...this.exts.values()].sort((a, b) => Number(b.builtin) - Number(a.builtin) || a.manifest.name.localeCompare(b.manifest.name));
  }

  async loadAll() {
    await this.loadBuiltins();
    await this.loadUserExtensions();
    this.changed();
  }

  private async loadBuiltins() {
    let ids: string[] = [];
    try {
      ids = await (await fetch("/extensions/index.json")).json();
    } catch (err) {
      console.warn("組み込み拡張機能の一覧を読めませんでした", err);
    }
    for (const id of ids) {
      try {
        const manifest = await (await fetch(`/extensions/${id}/extension.json`)).json();
        if (!validManifest(manifest)) throw new Error("invalid manifest");
        const mainSource = manifest.main ? await (await fetch(`/extensions/${id}/${manifest.main}`)).text() : null;
        await this.add({ manifest, builtin: true, mainSource, status: "loading", disposers: [], handlers: new Set() });
      } catch (err) {
        console.error(`拡張機能 ${id} の読み込みに失敗`, err);
      }
    }
  }

  private async loadUserExtensions() {
    let records: Awaited<ReturnType<typeof nativeExt.list>> = [];
    try {
      records = await nativeExt.list();
    } catch (err) {
      console.warn("ユーザー拡張機能を読めませんでした", err);
      return;
    }
    for (const r of records) {
      if (!validManifest(r.manifest)) {
        console.warn("マニフェストが不正です", r.dir, r.error);
        continue;
      }
      await this.add({ manifest: r.manifest, builtin: false, dir: r.dir, mainSource: r.mainSource, status: r.error ? "error" : "loading", error: r.error ?? undefined, disposers: [], handlers: new Set() });
    }
  }

  private async add(e: LoadedExtension) {
    const existing = this.exts.get(e.manifest.id);
    if (existing) this.deactivate(existing);
    this.exts.set(e.manifest.id, e);
    if (settings.get("extensions.disabled").includes(e.manifest.id)) {
      e.status = "disabled";
      return;
    }
    if (e.status === "error") return;
    await this.activate(e);
  }

  private granted(e: LoadedExtension): boolean {
    const need = e.manifest.permissions ?? [];
    if (e.builtin || need.length === 0) return true;
    const have = settings.get("extensions.granted")[e.manifest.id] ?? [];
    return need.every((p) => have.includes(p));
  }

  async requestPermissions(e: LoadedExtension): Promise<boolean> {
    const need = e.manifest.permissions ?? [];
    const lines = need.map((p) => `・${t(`perm.${p}`)}`).join("\n");
    const ok = await confirmBox(t("ext.permTitle", { name: e.manifest.name }), `${t("ext.permMessage")}\n\n${lines}`, t("ext.permAllow"));
    if (!ok) return false;
    settings.set("extensions.granted", { ...settings.get("extensions.granted"), [e.manifest.id]: [...need] });
    return true;
  }

  private async activate(e: LoadedExtension) {
    const m = e.manifest;
    const src = m.id;
    const c = m.contributes ?? {};
    for (const th of c.themes ?? []) e.disposers.push(addTheme({ ...th, source: src }));
    for (const rc of c.runConfigs ?? []) e.disposers.push(addRunConfig({ ...rc, source: src }));
    for (const lang of c.languages ?? []) for (const x of lang.extensions) e.disposers.push(addLanguageAlias(x, lang.basedOn));
    for (const cmd of c.commands ?? []) {
      e.disposers.push(
        commands.register({ id: cmd.id, title: cmd.title, key: cmd.key, source: src, run: (...args) => this.invoke(e, cmd.id, args) }),
      );
    }

    if (!e.mainSource) {
      e.status = "active";
      return;
    }
    if (!this.granted(e)) {
      const ok = await this.requestPermissions(e);
      if (!ok) {
        e.status = "needsPermission";
        return;
      }
    }
    this.startWorker(e);
  }

  private startWorker(e: LoadedExtension) {
    const blob = new Blob([buildWorkerSource(e.mainSource!, e.manifest.id)], { type: "text/javascript" });
    const url = URL.createObjectURL(blob);
    const worker = new Worker(url, { name: e.manifest.id });
    URL.revokeObjectURL(url);
    e.worker = worker;
    e.status = "active";
    worker.onmessage = (ev) => this.onWorkerMessage(e, ev.data);
    worker.onerror = (ev) => {
      ev.preventDefault();
      e.status = "error";
      e.error = ev.message;
      toast(t("ext.crashed", { name: e.manifest.name, err: ev.message }), "error");
      this.changed();
    };
  }

  private invoke(e: LoadedExtension, command: string, args: unknown[]): Promise<unknown> {
    if (!e.worker || !e.handlers.has(command)) {
      toast(t("ext.notReady", { name: e.manifest.name }), "warn");
      return Promise.resolve();
    }
    const id = ++this.callSeq;
    return new Promise((resolve, reject) => {
      this.commandWaiters.set(id, { resolve, reject });
      e.worker!.postMessage({ type: "command", id, command, args });
    }).catch((err) => {
      toast(t("ext.commandFailed", { name: e.manifest.name, err: String(err.message ?? err) }), "error");
    });
  }

  private broadcast(event: string, payload: unknown) {
    for (const e of this.exts.values()) e.worker?.postMessage({ type: "event", event, payload });
  }

  private async onWorkerMessage(e: LoadedExtension, m: { type: string; [k: string]: unknown }) {
    switch (m.type) {
      case "registerCommand": {
        const id = String(m.id);
        e.handlers.add(id);
        if (!commands.get(id)) {
          e.disposers.push(commands.register({ id, title: id, source: e.manifest.id, run: (...args) => this.invoke(e, id, args) }));
        }
        break;
      }
      case "commandDone": {
        const w = this.commandWaiters.get(Number(m.id));
        if (!w) break;
        this.commandWaiters.delete(Number(m.id));
        if (m.error) w.reject(new Error(String(m.error)));
        else w.resolve(m.value);
        break;
      }
      case "error":
        e.status = "error";
        e.error = String(m.message);
        toast(t("ext.crashed", { name: e.manifest.name, err: e.error.split("\n")[0] }), "error");
        this.changed();
        break;
      case "ready":
        this.changed();
        break;
      case "call": {
        const id = m.id as number;
        try {
          const value = await this.handleCall(e, String(m.method), (m.args as unknown[]) ?? []);
          e.worker?.postMessage({ type: "result", id, value });
        } catch (err) {
          e.worker?.postMessage({ type: "result", id, error: String((err as Error).message ?? err) });
        }
        break;
      }
    }
  }

  private need(e: LoadedExtension, p: Permission) {
    const declared = e.manifest.permissions ?? [];
    if (!declared.includes(p) || !this.granted(e)) throw new Error(`PERMISSION_DENIED: ${p}`);
  }

  private pathIn(p: string): string {
    const root = this.deps.root();
    if (!root) throw new Error("NO_WORKSPACE");
    const full = resolveIn(root, p);
    if (!isInside(root, full)) throw new Error("OUTSIDE_WORKSPACE");
    return full;
  }

  private async handleCall(e: LoadedExtension, method: string, args: unknown[]): Promise<unknown> {
    const ed = this.deps.editor;
    const s = (i: number) => String(args[i] ?? "");
    switch (method) {
      case "commands.execute":
        return commands.execute(s(0), ...args.slice(1));
      case "window.showMessage": {
        const kind = s(1);
        toast(`${e.manifest.name}: ${s(0)}`, kind === "error" || kind === "warn" || kind === "success" ? kind : "info");
        return null;
      }
      case "window.showInput": {
        const o = (args[0] ?? {}) as { title?: string; value?: string; placeholder?: string };
        return inputBox({ title: o.title ?? e.manifest.name, value: o.value, placeholder: o.placeholder });
      }
      case "window.showQuickPick": {
        const items = (Array.isArray(args[0]) ? args[0] : []) as (string | { label: string; detail?: string; value?: unknown })[];
        const o = (args[1] ?? {}) as { placeholder?: string };
        const picked = await quickPick(
          items.map((it, i) => (typeof it === "string" ? { label: it, value: i } : { label: String(it.label), detail: it.detail, value: i })),
          o.placeholder ?? e.manifest.name,
        );
        if (picked === undefined) return null;
        const it = items[picked];
        return typeof it === "string" ? it : it.value ?? it.label;
      }
      case "editor.getText":
        return ed.getText();
      case "editor.getSelection":
        return ed.getSelection();
      case "editor.replaceSelection":
        ed.replaceSelection(s(0));
        return null;
      case "editor.insertText":
        ed.insertText(s(0));
        return null;
      case "editor.activeFile":
        return this.deps.activePath();
      case "editor.language":
        return ed.languageName();
      case "editor.cursor":
        return ed.cursor();
      case "workspace.root":
        return this.deps.root();
      case "workspace.readFile":
        this.need(e, "workspace.read");
        return fs.readFile(this.pathIn(s(0)));
      case "workspace.listDir":
        this.need(e, "workspace.read");
        return fs.listDir(this.pathIn(s(0) || "."));
      case "workspace.writeFile":
        this.need(e, "workspace.write");
        await fs.writeFile(this.pathIn(s(0)), s(1));
        return null;
      case "workspace.openFile":
        await this.deps.openFile(this.pathIn(s(0)));
        return null;
      case "terminal.run":
        this.need(e, "terminal");
        await this.deps.runInTerminal(s(0));
        return null;
      case "ai.complete": {
        this.need(e, "ai");
        const o = (args[1] ?? {}) as { maxTokens?: number; temperature?: number };
        return completer.ask(s(0), o);
      }
      case "statusBar.set": {
        const key = `${e.manifest.id}:${s(0)}`;
        this.deps.setStatusItem(key, s(1), s(2) || undefined);
        if (!this.statusKeys.has(key)) {
          this.statusKeys.add(key);
          e.disposers.push(() => {
            this.statusKeys.delete(key);
            this.deps.setStatusItem(key, null);
          });
        }
        return null;
      }
      case "statusBar.clear":
        this.deps.setStatusItem(`${e.manifest.id}:${s(0)}`, null);
        return null;
      default:
        throw new Error(`Unknown API: ${method}`);
    }
  }

  private deactivate(e: LoadedExtension) {
    e.worker?.terminate();
    e.worker = undefined;
    e.handlers.clear();
    for (const d of e.disposers.splice(0)) {
      try {
        d();
      } catch {
        /* 片付けの失敗は無視 */
      }
    }
  }

  async setEnabled(id: string, enabled: boolean) {
    const e = this.exts.get(id);
    if (!e) return;
    const disabled = new Set(settings.get("extensions.disabled"));
    if (enabled) {
      disabled.delete(id);
      settings.set("extensions.disabled", [...disabled]);
      this.deactivate(e);
      e.status = "loading";
      e.error = undefined;
      await this.activate(e);
    } else {
      disabled.add(id);
      settings.set("extensions.disabled", [...disabled]);
      this.deactivate(e);
      e.status = "disabled";
    }
    this.changed();
  }

  async grantAndStart(id: string) {
    const e = this.exts.get(id);
    if (!e) return;
    if (await this.requestPermissions(e)) {
      this.deactivate(e);
      await this.activate(e);
      this.changed();
    }
  }

  async installFromFolder(folder: string) {
    const id = await nativeExt.install(folder);
    const old = this.exts.get(id);
    if (old) {
      this.deactivate(old);
      this.exts.delete(id);
    }
    const records = await nativeExt.list();
    const r = records.find((x) => (x.manifest as Manifest | null)?.id === id);
    if (r && validManifest(r.manifest)) {
      await this.add({ manifest: r.manifest, builtin: false, dir: r.dir, mainSource: r.mainSource, status: "loading", disposers: [], handlers: new Set() });
    }
    this.changed();
    return id;
  }

  async uninstall(id: string) {
    const e = this.exts.get(id);
    if (!e || e.builtin) return;
    this.deactivate(e);
    this.exts.delete(id);
    await nativeExt.uninstall(id);
    const granted = { ...settings.get("extensions.granted") };
    delete granted[id];
    settings.set("extensions.granted", granted);
    this.changed();
  }

  /** 拡張機能を再読み込み（開発中の拡張機能を試すとき用） */
  async reload() {
    for (const e of this.exts.values()) this.deactivate(e);
    this.exts.clear();
    await this.loadAll();
  }
}
