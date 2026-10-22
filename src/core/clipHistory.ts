// コピー履歴：最近コピーした 10 個を覚えておく（あいぞめの外でコピーしたものも）
import { clipboardWatch } from "./platform";
import { settings } from "./settings";

const KEY = "aizome.clipHistory";
const MAX = 10;
let items: string[] = [];
try {
  const raw = localStorage.getItem(KEY);
  if (raw) items = (JSON.parse(raw) as unknown[]).filter((x): x is string => typeof x === "string").slice(0, MAX);
} catch {
  items = [];
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    /* 保存できなくても動く */
  }
}

export function addClip(text: string) {
  if (!settings.get("clip.history") || !text.trim()) return;
  items = [text, ...items.filter((x) => x !== text)].slice(0, MAX);
  persist();
}

export function clipHistory(): string[] {
  return settings.get("clip.history") ? [...items] : [];
}

export function clearClips() {
  items = [];
  persist();
}

/** 一覧に出す短い形（1 行目を縮めて、行数を添える） */
export function clipLabel(text: string, width = 42): string {
  const lines = text.replace(/\r/g, "").trimEnd().split("\n");
  const first = (lines.find((l) => l.trim()) ?? "").trim().replace(/\s+/g, " ");
  const short = first.length > width ? first.slice(0, width - 1) + "…" : first;
  return lines.length > 1 ? `${short}  （${lines.length} 行）` : short;
}

export function startClipWatch() {
  void clipboardWatch.onChange((text) => addClip(text)).catch(() => undefined);
}
