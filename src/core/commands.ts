// コマンドの登録と実行。メニュー・ショートカット・コマンドパレット・拡張機能はすべてここを通る。

export interface Command {
  id: string;
  /** 表示名（翻訳済みの文字列を返す関数でもよい） */
  title: string | (() => string);
  /** 例: "Mod-Shift-P"。Mod は Windows/Linux で Ctrl、Mac で Cmd */
  key?: string;
  /** 表示だけのショートカット（エディタ側が処理するキーの案内用） */
  display?: string;
  /** ターミナルにフォーカスがあるときもショートカットを奪うか */
  inTerminal?: boolean;
  /** 提供元（"core" または拡張機能ID） */
  source?: string;
  /** コマンドパレットに出さない */
  hidden?: boolean;
  run: (...args: unknown[]) => unknown;
}

const registry = new Map<string, Command>();
const isMac = navigator.platform.toLowerCase().includes("mac");

export const commands = {
  register(cmd: Command): () => void {
    registry.set(cmd.id, cmd);
    return () => {
      if (registry.get(cmd.id) === cmd) registry.delete(cmd.id);
    };
  },
  async execute(id: string, ...args: unknown[]): Promise<unknown> {
    const cmd = registry.get(id);
    if (!cmd) throw new Error(`Unknown command: ${id}`);
    return cmd.run(...args);
  },
  get(id: string) {
    return registry.get(id);
  },
  list(): Command[] {
    return [...registry.values()].filter((c) => !c.hidden);
  },
  title(cmd: Command): string {
    return typeof cmd.title === "function" ? cmd.title() : cmd.title;
  },
};

/** "Mod-Shift-P" を [修飾キー..., キー] に分ける（"Mod--" のようにキー自体が "-" の場合も扱う） */
function splitKey(key: string): string[] {
  if (key.endsWith("--")) return [...key.slice(0, -2).split("-").filter(Boolean), "-"];
  return key.split("-");
}

/** "Mod-Shift-P" を画面表示用の "Ctrl+Shift+P" / "⌘⇧P" にする */
export function formatKey(key: string): string {
  const arrows: Record<string, string> = { ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→" };
  const parts = splitKey(key).map((p) => arrows[p] ?? p);
  if (isMac) {
    const map: Record<string, string> = { Mod: "⌘", Ctrl: "⌃", Shift: "⇧", Alt: "⌥" };
    return parts.map((p) => map[p] ?? (p.length === 1 ? p.toUpperCase() : p)).join("");
  }
  return parts.map((p) => (p === "Mod" ? "Ctrl" : p.length === 1 ? p.toUpperCase() : p)).join("+");
}

function eventToKey(e: KeyboardEvent): string {
  const mods: string[] = [];
  const mod = isMac ? e.metaKey : e.ctrlKey;
  if (mod) mods.push("Mod");
  if (isMac && e.ctrlKey) mods.push("Ctrl");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  let k = e.key;
  if (e.code === "Backquote") k = "`";
  else if (e.code === "Comma") k = ",";
  else if (e.code === "Backslash") k = "\\";
  else if (e.code === "Minus") k = "-";
  else if (e.code === "Equal") k = "=";
  else if (e.code === "Semicolon") k = ";";
  else if (/^Key[A-Z]$/.test(e.code)) k = e.code.slice(3).toLowerCase();
  else if (/^Digit\d$/.test(e.code)) k = e.code.slice(5);
  else if (k.length === 1) k = k.toLowerCase();
  return [...mods, k].join("-");
}

function normalize(key: string): string {
  const parts = splitKey(key);
  const last = parts.pop()!;
  const order = ["Mod", "Ctrl", "Alt", "Shift"];
  const mods = order.filter((m) => parts.includes(m));
  return [...mods, last.length === 1 ? last.toLowerCase() : last].join("-");
}

export function installKeybindings() {
  window.addEventListener(
    "keydown",
    (e) => {
      const pressed = eventToKey(e);
      const inTerminal = !!(document.activeElement as HTMLElement | null)?.closest(".xterm");
      for (const cmd of registry.values()) {
        if (!cmd.key || normalize(cmd.key) !== pressed) continue;
        if (inTerminal && !cmd.inTerminal) continue;
        e.preventDefault();
        e.stopPropagation();
        Promise.resolve(cmd.run()).catch((err) => console.error(err));
        return;
      }
    },
    true,
  );
}
