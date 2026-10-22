import { bus } from "./events";

export interface Settings {
  "ui.language": "ja" | "en";
  "ui.theme": string;
  "ui.sidebarWidth": number;
  "ui.panelHeight": number;
  "editor.fontSize": number;
  "editor.tabSize": number;
  "editor.wordWrap": boolean;
  "ai.enabled": boolean;
  "ai.provider": "ollama" | "openai";
  "ai.endpoint": string;
  "ai.model": string;
  "ai.debounceMs": number;
  "ai.maxTokens": number;
  "ai.apiKey": string;
  "terminal.shell": string;
  "terminal.fontSize": number;
  "workspace.last": string;
  "workspace.recent": string[];
  "session.files": string[];
  "session.active": string;
  "extensions.disabled": string[];
  "extensions.granted": Record<string, string[]>;

  "look.bgColor": string;
  "look.accentColor": string;
  "look.bgImage": string;
  "look.bgOpacity": number;
  "look.bgBlur": number;
  "look.bgDim": number;
  "look.bgFit": "cover" | "contain" | "tile" | "center";
  "look.zoom": number;
  "editor.fontFamily": string;
  "editor.autoSave": "off" | "delay" | "focus";
  "editor.trimTrailingWhitespace": boolean;
  "editor.insertFinalNewline": boolean;
  "editor.restoreTabs": boolean;
  "editor.lineNumbers": boolean;
  "build.keepComments": boolean;
  "update.autoCheck": boolean;
  "editor.suggestFont": "kyokasho" | "code" | "bizud";
  "editor.explain": "off" | "rules" | "ai";
  "editor.suggestList": "smart" | "off";
  "editor.listKey": "tab" | "enter";
  "editor.zenkaku": boolean;
  /** 新しいファイル（保存前）を何語として扱うか（拡張子） */
  "files.newFileLanguage": string;
  /** 新しく保存するファイルの文字コード */
  "files.encoding": "utf-8" | "utf-8-bom" | "shift_jis" | "euc-jp" | "utf-16le";
  /** UTF-8 で読めないファイルを Shift_JIS などとして読む */
  "files.guessEncoding": boolean;
  /** 新しく保存するファイルの改行コード */
  "files.eol": "auto" | "lf" | "crlf";
  "dict.user": { lang: string; title: string; code: string; keys?: string }[];
  "update.skipVersion": string;
}

export const defaults: Settings = {
  "ui.language": "ja",
  "ui.theme": "ai",
  "ui.sidebarWidth": 260,
  "ui.panelHeight": 240,
  "editor.fontSize": 14,
  "editor.tabSize": 4,
  "editor.wordWrap": false,
  "ai.enabled": true,
  "ai.provider": "ollama",
  "ai.endpoint": "http://127.0.0.1:11434",
  "ai.model": "qwen2.5-coder:1.5b",
  "ai.debounceMs": 300,
  "ai.maxTokens": 96,
  "ai.apiKey": "",
  "terminal.shell": "",
  "terminal.fontSize": 13,
  "workspace.last": "",
  "workspace.recent": [],
  "session.files": [],
  "session.active": "",
  "extensions.disabled": [],
  "extensions.granted": {},

  "look.bgColor": "",
  "look.accentColor": "",
  "look.bgImage": "",
  "look.bgOpacity": 0.74,
  "look.bgBlur": 0,
  "look.bgDim": 0.2,
  "look.bgFit": "cover",
  "look.zoom": 1,
  "editor.fontFamily": "",
  "editor.autoSave": "off",
  "editor.trimTrailingWhitespace": false,
  "editor.insertFinalNewline": true,
  "editor.restoreTabs": true,
  "editor.lineNumbers": true,
  "build.keepComments": true,
  "update.autoCheck": true,
  "editor.suggestFont": "kyokasho",
  "editor.explain": "ai",
  "editor.suggestList": "smart",
  "editor.listKey": "tab",
  "editor.zenkaku": true,
  "files.newFileLanguage": ".py",
  "files.encoding": "utf-8",
  "files.guessEncoding": true,
  "files.eol": "lf",
  "dict.user": [],
  "update.skipVersion": "",
};

const STORAGE_KEY = "aizome.settings.v1";

function load(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...defaults, ...JSON.parse(raw) };
  } catch {
    /* 読めなければ既定値で起動する */
  }
  return { ...defaults };
}

const current: Settings = load();

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    /* 保存できない環境では今回の起動中だけ有効 */
  }
}

export const settings = {
  get<K extends keyof Settings>(key: K): Settings[K] {
    return current[key];
  },
  set<K extends keyof Settings>(key: K, value: Settings[K]): void {
    current[key] = value;
    persist();
    bus.emit("settings:changed", { key });
  },
  all(): Readonly<Settings> {
    return current;
  },
};
