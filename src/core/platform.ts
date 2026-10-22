// ネイティブ側（Rust）との窓口。Tauri への依存はこのファイルだけに閉じ込める。
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";

export interface DirEntry {
  name: string;
  path: string;
  isDir: boolean;
}

export interface SysInfo {
  os: string;
  home: string;
  defaultShell: string;
  pathSep: string;
}

export interface AiRequest {
  provider: "ollama" | "openai";
  endpoint: string;
  model: string;
  prompt: string;
  suffix?: string;
  maxTokens?: number;
  temperature?: number;
  stop?: string[];
  apiKey?: string;
  repeatPenalty?: number;
}

export interface AiChunk {
  id: number;
  text: string;
  done: boolean;
  error: string | null;
}

export interface UserExtensionRecord {
  dir: string;
  manifest: unknown;
  mainSource: string | null;
  error: string | null;
}

export const fs = {
  listDir: (path: string) => invoke<DirEntry[]>("fs_list_dir", { path }),
  walk: (root: string, limit?: number) => invoke<string[]>("fs_walk", { root, limit }),
  readFile: (path: string) => invoke<string>("fs_read_file", { path }),
  writeFile: (path: string, content: string) => invoke<void>("fs_write_file", { path, content }),
  createFile: (path: string) => invoke<void>("fs_create_file", { path }),
  createDir: (path: string) => invoke<void>("fs_create_dir", { path }),
  rename: (from: string, to: string) => invoke<void>("fs_rename", { from, to }),
  remove: (path: string) => invoke<void>("fs_remove", { path }),
  exists: (path: string) => invoke<boolean>("fs_exists", { path }),
  readDataUrl: (path: string) => invoke<string>("fs_read_data_url", { path }),
  search: (opts: { root: string; query: string; regex: boolean; caseSensitive: boolean; wholeWord: boolean; limit?: number }) =>
    invoke<SearchResult>("fs_search", opts),
};

export interface SearchHit {
  path: string;
  line: number;
  col: number;
  text: string;
}

export interface SearchResult {
  hits: SearchHit[];
  truncated: boolean;
  filesSearched: number;
}

export interface GitStatus {
  isRepo: boolean;
  branch: string | null;
  ahead: number;
  behind: number;
  files: { path: string; status: string }[];
}

export const git = {
  status: (root: string) => invoke<GitStatus>("git_status", { root }),
};

export const appWindow = {
  async setFullscreen(on: boolean) {
    await getCurrentWindow().setFullscreen(on);
  },
  async isFullscreen() {
    return getCurrentWindow().isFullscreen();
  },
  /** 閉じる前に確認する。handler が false を返すと閉じない */
  onCloseRequested(handler: () => Promise<boolean>) {
    const w = getCurrentWindow();
    return w.onCloseRequested(async (event) => {
      event.preventDefault();
      if (await handler()) await w.destroy();
    });
  },
};

export const dialog = {
  async pickFolder(): Promise<string | null> {
    const r = await open({ directory: true, multiple: false });
    return typeof r === "string" ? r : null;
  },
  async pickImage(): Promise<string | null> {
    const r = await open({
      multiple: false,
      filters: [{ name: "Image", extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp", "svg", "avif"] }],
    });
    return typeof r === "string" ? r : null;
  },
  async saveFile(defaultPath?: string): Promise<string | null> {
    const r = await save({ defaultPath });
    return typeof r === "string" ? r : null;
  },
};

export const pty = {
  spawn: (opts: { cwd?: string; cols: number; rows: number; shell?: string }) =>
    invoke<number>("pty_spawn", opts),
  write: (id: number, data: string) => invoke<void>("pty_write", { id, data }),
  resize: (id: number, cols: number, rows: number) => invoke<void>("pty_resize", { id, cols, rows }),
  kill: (id: number) => invoke<void>("pty_kill", { id }),
  onData: (cb: (p: { id: number; data: string }) => void) =>
    listen<{ id: number; data: string }>("pty:data", (e) => cb(e.payload)),
  onExit: (cb: (p: { id: number; code: number | null }) => void) =>
    listen<{ id: number; code: number | null }>("pty:exit", (e) => cb(e.payload)),
};

export const ai = {
  start: (req: AiRequest) => invoke<number>("ai_complete", { req }),
  cancel: (id: number) => invoke<void>("ai_cancel", { id }),
  models: (provider: string, endpoint: string, apiKey?: string) =>
    invoke<string[]>("ai_models", { provider, endpoint, apiKey }),
  onChunk: (cb: (c: AiChunk) => void) => listen<AiChunk>("ai:chunk", (e) => cb(e.payload)),
};

export const ext = {
  dir: () => invoke<string>("ext_dir"),
  list: () => invoke<UserExtensionRecord[]>("ext_list"),
  install: (from: string) => invoke<string>("ext_install", { from }),
  uninstall: (id: string) => invoke<void>("ext_uninstall", { id }),
};

export const sys = {
  info: () => invoke<SysInfo>("sys_info"),
};
