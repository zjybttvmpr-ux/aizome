// 拡張機能を動かす Web Worker の中身。
// 拡張機能のコードの前にこのブートストラップを付けて、1つのスクリプトとして起動する。
// Worker の中からはエディタや OS に直接触れず、すべて postMessage 経由でホストに頼む。

const BOOTSTRAP = String.raw`
"use strict";
(() => {
  // ネットワークや追加スクリプトの読み込みは使わせない
  for (const k of ["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "importScripts", "Worker", "SharedWorker"]) {
    try { Object.defineProperty(self, k, { value: undefined, configurable: false, writable: false }); } catch (e) {}
  }
  let seq = 0;
  const pending = new Map();
  const handlers = new Map();
  const listeners = new Map();
  const call = (method, ...args) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    postMessage({ type: "call", id, method, args });
  });
  self.onmessage = (e) => {
    const m = e.data || {};
    if (m.type === "result") {
      const p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      if (m.error) p.reject(new Error(m.error)); else p.resolve(m.value);
    } else if (m.type === "command") {
      const h = handlers.get(m.command);
      Promise.resolve()
        .then(() => { if (!h) throw new Error("no handler: " + m.command); return h(...(m.args || [])); })
        .then((value) => postMessage({ type: "commandDone", id: m.id, value }),
              (err) => postMessage({ type: "commandDone", id: m.id, error: String((err && err.message) || err) }));
    } else if (m.type === "event") {
      for (const fn of listeners.get(m.event) || []) {
        try { fn(m.payload); } catch (err) { console.error(err); }
      }
    }
  };
  const api = Object.freeze({
    commands: Object.freeze({
      register(id, fn) { handlers.set(id, fn); postMessage({ type: "registerCommand", id }); },
      execute: (id, ...args) => call("commands.execute", id, ...args),
    }),
    window: Object.freeze({
      showMessage: (text, kind) => call("window.showMessage", String(text), kind || "info"),
      showInput: (opts) => call("window.showInput", opts || {}),
      showQuickPick: (items, opts) => call("window.showQuickPick", items, opts || {}),
    }),
    editor: Object.freeze({
      getText: () => call("editor.getText"),
      getSelection: () => call("editor.getSelection"),
      replaceSelection: (text) => call("editor.replaceSelection", String(text)),
      insertText: (text) => call("editor.insertText", String(text)),
      activeFile: () => call("editor.activeFile"),
      language: () => call("editor.language"),
      cursor: () => call("editor.cursor"),
    }),
    workspace: Object.freeze({
      root: () => call("workspace.root"),
      readFile: (path) => call("workspace.readFile", String(path)),
      writeFile: (path, content) => call("workspace.writeFile", String(path), String(content)),
      listDir: (path) => call("workspace.listDir", String(path || "")),
      openFile: (path) => call("workspace.openFile", String(path)),
    }),
    terminal: Object.freeze({
      run: (command) => call("terminal.run", String(command)),
    }),
    ai: Object.freeze({
      complete: (prompt, opts) => call("ai.complete", String(prompt), opts || {}),
    }),
    statusBar: Object.freeze({
      set: (id, text, tooltip) => call("statusBar.set", String(id), String(text), tooltip ? String(tooltip) : ""),
      clear: (id) => call("statusBar.clear", String(id)),
    }),
    on(event, fn) {
      const set = listeners.get(event) || new Set();
      set.add(fn);
      listeners.set(event, set);
      return () => set.delete(fn);
    },
  });
  Object.defineProperty(self, "aizome", { value: api, writable: false, configurable: false });
})();
`;

const FOOTER = String.raw`
;(() => {
  if (typeof activate === "function") {
    Promise.resolve().then(() => activate(self.aizome)).then(
      () => postMessage({ type: "ready" }),
      (err) => postMessage({ type: "error", message: String((err && err.stack) || err) }),
    );
  } else {
    postMessage({ type: "ready" });
  }
})();
`;

export function buildWorkerSource(extensionSource: string, extensionId: string): string {
  return `${BOOTSTRAP}\n// ---- extension: ${extensionId.replace(/[^\w.-]/g, "")} ----\n${extensionSource}\n${FOOTER}`;
}
