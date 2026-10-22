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
  "extensions.disabled": string[];
  "extensions.granted": Record<string, string[]>;
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
  "ai.debounceMs": 220,
  "ai.maxTokens": 96,
  "ai.apiKey": "",
  "terminal.shell": "",
  "terminal.fontSize": 13,
  "workspace.last": "",
  "extensions.disabled": [],
  "extensions.granted": {},
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
