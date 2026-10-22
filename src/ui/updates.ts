// アプリ内アップデートの画面と流れ
import { h } from "../core/dom";
import { t } from "../core/i18n";
import { settings } from "../core/settings";
import { updater, type UpdateInfo } from "../core/platform";
import { renderMarkdown } from "./markdown";
import { toast } from "./toast";

export interface UpdateDeps {
  /** 未保存のファイルを確認する。false なら更新しない */
  confirmQuit: () => Promise<boolean>;
  /** 見つかった更新をステータスバーなどに出す */
  onAvailable: (info: UpdateInfo | null) => void;
}

let latest: UpdateInfo | null = null;

export function currentUpdate() {
  return latest;
}

/** 新しい版があるか調べる。manual のときは結果を必ず知らせる */
export async function checkForUpdates(deps: UpdateDeps, manual = false): Promise<UpdateInfo | null> {
  try {
    const info = await updater.check();
    if (info.available && (manual || info.latest !== settings.get("update.skipVersion"))) {
      latest = info;
      deps.onAvailable(info);
      if (manual) await openUpdateDialog(deps, info);
      else toast(t("update.found", { version: info.latest ?? "" }), "info", 8000);
    } else {
      latest = null;
      deps.onAvailable(null);
      if (manual) toast(t("update.upToDate", { version: info.current }), "success");
    }
    return info;
  } catch (err) {
    if (manual) toast(t("update.checkFailed", { err: String(err).replace(/^NETWORK:\s*/, "") }), "warn", 8000);
    return null;
  }
}

export function openUpdateDialog(deps: UpdateDeps, info: UpdateInfo): Promise<void> {
  return new Promise((resolve) => {
    const bar = h("div", { class: "update-bar" }, h("div", { class: "update-bar-fill" }));
    const progress = h("div", { class: "update-progress", hidden: true }, bar, h("span", { class: "update-progress-text" }));
    const notes = h("div", { class: "update-notes" });
    if (info.notes) notes.append(renderMarkdown(info.notes));
    const later = h("button", { class: "btn plain", type: "button" }, t("update.later"));
    const skip = h("button", { class: "btn plain", type: "button" }, t("update.skip"));
    const go = h("button", { class: "btn primary", type: "button" }, info.manualOnly ? t("update.copyPage") : t("update.now"));
    const box = h(
      "div",
      { class: "modal wide", role: "dialog", "aria-modal": "true" },
      h("h2", { class: "modal-title" }, t("update.title", { version: info.latest ?? "" })),
      h("p", { class: "modal-text" }, info.manualOnly ? t("update.manualText", { current: info.current }) : t("update.text", { current: info.current })),
      info.notes ? notes : null!,
      progress,
      h("div", { class: "modal-actions" }, skip, later, go),
    );
    const backdrop = h("div", { class: "modal-backdrop" }, box);
    document.body.append(backdrop);
    let busy = false;
    const close = () => {
      if (busy) return;
      backdrop.remove();
      resolve();
    };
    later.addEventListener("click", close);
    skip.addEventListener("click", () => {
      settings.set("update.skipVersion", info.latest ?? "");
      latest = null;
      deps.onAvailable(null);
      close();
    });
    backdrop.addEventListener("keydown", (e) => e.key === "Escape" && close());

    go.addEventListener("click", async () => {
      if (info.manualOnly || !info.downloadUrl) {
        await navigator.clipboard?.writeText(info.pageUrl).catch(() => {});
        toast(t("update.pageCopied", { url: info.pageUrl }), "info", 10000);
        close();
        return;
      }
      if (!(await deps.confirmQuit())) return;
      busy = true;
      [go, later, skip].forEach((b) => (b.disabled = true));
      progress.hidden = false;
      const text = progress.querySelector(".update-progress-text")!;
      const fill = bar.firstElementChild as HTMLElement;
      text.textContent = t("update.downloading");
      const unlisten = await updater.onProgress(({ received, total }) => {
        const pct = total ? Math.round((received / total) * 100) : 0;
        fill.style.width = `${pct}%`;
        text.textContent = total
          ? t("update.downloadingPct", { pct: String(pct), mb: (total / 1048576).toFixed(1) })
          : t("update.downloading");
      });
      try {
        await updater.install(info.downloadUrl);
        fill.style.width = "100%";
        text.textContent = t("update.restarting");
      } catch (err) {
        busy = false;
        unlisten();
        [go, later, skip].forEach((b) => (b.disabled = false));
        progress.hidden = true;
        toast(t("update.failed", { err: String(err).replace(/^NETWORK:\s*/, "") }), "error", 10000);
      }
    });
    go.focus();
  });
}

/** 起動して少したってから調べ、その後も 6 時間ごとに調べる */
export function startUpdateChecks(deps: UpdateDeps) {
  if (!settings.get("update.autoCheck")) return;
  window.setTimeout(() => void checkForUpdates(deps), 8000);
  window.setInterval(() => {
    if (settings.get("update.autoCheck")) void checkForUpdates(deps);
  }, 6 * 60 * 60 * 1000);
}
