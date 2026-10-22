// 設定の持ち運び：設定・グループ・自分の辞書・入力の登録を 1 つのファイルに書き出し、ほかのパソコンで読み込む
import { settings, type Settings } from "../core/settings";
import { dialog, fs } from "../core/platform";
import { t } from "../core/i18n";
import { toast } from "./toast";
import { confirmBox } from "./dialog";

/** そのパソコンだけで意味があるもの（持ち運ばない） */
const LOCAL_ONLY = new Set<string>(["run.pythonPath", "workspace.last", "workspace.recent", "look.bgImage", "session.tabs", "session.active", "update.skipVersion"]);

export async function exportSettings(): Promise<void> {
  const all = settings.all() as unknown as Record<string, unknown>;
  const data: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(all)) if (!LOCAL_ONLY.has(k) && !k.startsWith("session.")) data[k] = v;
  const d = new Date();
  const name = `aizome-settings-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}.json`;
  const path = await dialog.saveFile(name);
  if (!path) return;
  const body = JSON.stringify({ app: "Aizome", kind: "settings", exportedAt: d.toISOString(), settings: data }, null, 2);
  try {
    await fs.writeFile(path, body);
    toast(t("transfer.exported", { path }), "success", 6000);
  } catch (err) {
    toast(t("transfer.failed", { err: String(err) }), "error");
  }
}

export async function importSettings(): Promise<void> {
  const path = await dialog.pickFile([{ name: "Aizome settings", extensions: ["json"] }]);
  if (!path) return;
  let parsed: { app?: string; settings?: Record<string, unknown> };
  try {
    parsed = JSON.parse(await fs.readFile(path));
  } catch (err) {
    toast(t("transfer.failed", { err: String(err) }), "error");
    return;
  }
  if (parsed.app !== "Aizome" || !parsed.settings) {
    toast(t("transfer.notOurs"), "warn", 6000);
    return;
  }
  const ok = await confirmBox(t("transfer.confirmTitle"), t("transfer.confirm"), t("transfer.apply"));
  if (!ok) return;
  const current = settings.all() as unknown as Record<string, unknown>;
  let n = 0;
  for (const [k, v] of Object.entries(parsed.settings)) {
    if (LOCAL_ONLY.has(k) || !(k in current)) continue;
    // グループ・入力の登録は、今のものに足す（上書きで消さない）
    if ((k === "explorer.groups" || k === "run.inputs") && v && typeof v === "object") {
      settings.set(k as keyof Settings, { ...(current[k] as object), ...(v as object) } as never);
    } else if (k === "dict.user" && Array.isArray(v)) {
      const mine = (current[k] as { lang: string; title: string }[]) ?? [];
      const merged = [...mine, ...(v as { lang: string; title: string }[]).filter((x) => !mine.some((m) => m.lang === x.lang && m.title === x.title))];
      settings.set("dict.user", merged as never);
    } else {
      settings.set(k as keyof Settings, v as never);
    }
    n++;
  }
  toast(t("transfer.imported", { n: String(n) }), "success", 6000);
}
