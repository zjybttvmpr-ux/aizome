// 保存記録：保存するたびに中身を残しておき、あとから「保存前の状態」などに戻せる（エクスプローラーの下）
import { h, clear } from "../core/dom";
import { fs } from "../core/platform";
import { join } from "../core/paths";
import { settings } from "../core/settings";
import { t } from "../core/i18n";
import { hashText } from "../ai/infer";
import { icon } from "./icons";
import { toast } from "./toast";

export interface SaveHistoryDeps {
  home: () => string;
  activeDoc: () => { id: string; path: string | null; name: string } | null;
  getText: (id: string) => string;
  applyText: (id: string, text: string) => void;
}

interface Entry {
  /** 保存した時刻（ミリ秒） */
  t: number;
  /** "before"（保存前の中身）か "save"（保存した中身） */
  kind: "before" | "save";
  file: string;
  lines: number;
}

const MAX_ENTRIES = 40;

function timeLabel(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  if (d.toDateString() === now.toDateString()) return `${t("history.today")} ${hm}`;
  return `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}

/** 行の増減（+3 −1 のような目安） */
function diffCount(a: string, b: string): { add: number; del: number } {
  const count = (s: string) => {
    const m = new Map<string, number>();
    for (const l of s.split("\n")) m.set(l, (m.get(l) ?? 0) + 1);
    return m;
  };
  const ma = count(a);
  const mb = count(b);
  let add = 0;
  let del = 0;
  for (const [l, n] of mb) add += Math.max(0, n - (ma.get(l) ?? 0));
  for (const [l, n] of ma) del += Math.max(0, n - (mb.get(l) ?? 0));
  return { add, del };
}

export function createSaveHistory(deps: SaveHistoryDeps) {
  const list = h("div", { class: "side-section-body history-list" });
  const count = h("span", { class: "side-section-count" });
  const undoBtn = h("button", { class: "btn small plain history-undo", type: "button", title: t("history.undoTitle") }, t("history.undo"));
  const head = h(
    "div",
    { class: "side-section-head", role: "button", tabindex: 0 },
    h("span", { class: "side-section-arrow", html: icon("chevron", 11) }),
    h("span", { class: "side-section-title" }, t("history.title")),
    count,
    undoBtn,
  );
  const el = h("section", { class: "side-section history" }, head, list);
  const setOpen = (open: boolean) => {
    el.classList.toggle("open", open);
    settings.set("explorer.historyOpen", open);
  };
  el.classList.toggle("open", settings.get("explorer.historyOpen"));
  head.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest(".history-undo")) return;
    setOpen(!el.classList.contains("open"));
  });

  const dirFor = (path: string) => join(join(join(deps.home(), ".aizome"), "history"), hashText(path).replace(/[^\w]/g, "_"));

  async function readIndex(path: string): Promise<Entry[]> {
    try {
      return JSON.parse(await fs.readFile(join(dirFor(path), "index.json"))) as Entry[];
    } catch {
      return [];
    }
  }

  async function writeIndex(path: string, entries: Entry[]) {
    await fs.writeFile(join(dirFor(path), "index.json"), JSON.stringify(entries));
  }

  /** 保存したときに呼ぶ。before は保存する前のファイルの中身（なければ null） */
  async function record(path: string, before: string | null, after: string) {
    if (!settings.get("ui.saveHistory")) return;
    const dir = dirFor(path);
    await fs.createDir(dir).catch(() => {});
    let entries = await readIndex(path);
    const now = Date.now();
    const add = async (kind: Entry["kind"], text: string, time: number) => {
      const file = `${time}-${kind}.txt`;
      await fs.writeFile(join(dir, file), text);
      entries.push({ t: time, kind, file, lines: text.split("\n").length });
    };
    try {
      const last = entries[entries.length - 1];
      const lastText = last ? await fs.readFile(join(dir, last.file)).catch(() => null) : null;
      // 記録がないか、前回の記録とファイルが違う（ほかのソフトで書き換えた）ときは「保存前」も残す
      if (before !== null && before !== after && before !== lastText) await add("before", before, now - 1);
      if (after !== lastText) await add("save", after, now);
      if (entries.length > MAX_ENTRIES) {
        const drop = entries.slice(0, entries.length - MAX_ENTRIES);
        entries = entries.slice(-MAX_ENTRIES);
        for (const d of drop) void fs.remove(join(dir, d.file)).catch(() => {});
      }
      await writeIndex(path, entries);
    } catch {
      /* 記録できなくても保存そのものは済んでいる */
    }
    void refresh();
  }

  async function restore(path: string, entry: Entry) {
    const doc = deps.activeDoc();
    if (!doc || doc.path !== path) return;
    try {
      const text = await fs.readFile(join(dirFor(path), entry.file));
      deps.applyText(doc.id, text);
      toast(t("history.restored", { time: timeLabel(entry.t) }), "success", 6000);
    } catch (err) {
      toast(t("history.failed", { err: String(err) }), "error");
    }
  }

  let seq = 0;
  async function refresh() {
    const my = ++seq;
    const doc = deps.activeDoc();
    el.hidden = !settings.get("ui.saveHistory");
    if (!doc?.path) {
      clear(list);
      count.textContent = "";
      undoBtn.hidden = true;
      list.append(h("p", { class: "side-section-empty" }, t(doc ? "history.unsaved" : "history.noFile")));
      return;
    }
    const path = doc.path;
    const entries = await readIndex(path);
    if (my !== seq) return;
    clear(list);
    count.textContent = entries.length ? String(entries.length) : "";
    // 「保存前に戻す」：最後の保存より 1 つ前の状態
    const prev = entries.length >= 2 ? entries[entries.length - 2] : null;
    undoBtn.hidden = !prev;
    undoBtn.onclick = (e) => {
      e.stopPropagation();
      if (prev) void restore(path, prev);
    };
    if (!entries.length) {
      list.append(h("p", { class: "side-section-empty" }, t("history.empty")));
      return;
    }
    const current = deps.getText(doc.id);
    for (const entry of [...entries].reverse()) {
      const row = h(
        "div",
        { class: "history-row" + (entry.kind === "before" ? " before" : "") },
        h("span", { class: "history-time" }, timeLabel(entry.t)),
        h("span", { class: "history-kind" }, t(entry.kind === "before" ? "history.before" : "history.saved")),
        h("span", { class: "history-diff" }),
        h("button", { class: "btn small plain", type: "button", title: t("history.restoreTitle"), onclick: () => void restore(path, entry) }, t("history.restore")),
      );
      list.append(row);
      // 今の中身との差と、中身の先頭（マウスを乗せると見える）
      void fs
        .readFile(join(dirFor(path), entry.file))
        .then((text) => {
          const d = diffCount(text, current);
          row.querySelector(".history-diff")!.textContent = d.add || d.del ? `+${d.add} −${d.del}` : t("history.same");
          row.title = text.split("\n").slice(0, 12).join("\n");
        })
        .catch(() => {});
    }
  }

  return { el, record, refresh };
}
