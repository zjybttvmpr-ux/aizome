// テーマ = CSS 変数の組。拡張機能が追加できる
import { bus } from "../core/events";
import { settings } from "../core/settings";

export interface Theme {
  id: string;
  label: string;
  scheme: "dark" | "light";
  colors: Record<string, string>;
  source?: string;
}

const themes = new Map<string, Theme>();
let appliedKeys: string[] = [];

export function addTheme(theme: Theme): () => void {
  themes.set(theme.id, theme);
  if (settings.get("ui.theme") === theme.id) applyTheme(theme.id);
  return () => themes.delete(theme.id);
}

export function listThemes(): Theme[] {
  return [...themes.values()];
}

export function applyTheme(id: string) {
  const theme = themes.get(id);
  const root = document.documentElement;
  for (const k of appliedKeys) root.style.removeProperty(k);
  appliedKeys = [];
  if (theme) {
    for (const [k, v] of Object.entries(theme.colors)) {
      const key = k.startsWith("--") ? k : `--${k}`;
      root.style.setProperty(key, v);
      appliedKeys.push(key);
    }
    root.dataset.scheme = theme.scheme;
  } else {
    // 組み込み CSS の既定（藍）に戻る
    root.dataset.scheme = "dark";
  }
  root.style.colorScheme = root.dataset.scheme;
  bus.emit("theme:changed", { id });
}
