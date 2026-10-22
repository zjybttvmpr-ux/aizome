// サイドバーの「拡張機能」ビュー
import { h, clear } from "../core/dom";
import { t } from "../core/i18n";
import { dialog, ext as nativeExt } from "../core/platform";
import type { ExtensionHost, LoadedExtension } from "../extensions/host";
import { confirmBox } from "./dialog";
import { toast } from "./toast";
import { icon } from "./icons";

export function createExtensionsView(host: ExtensionHost): HTMLElement {
  const list = h("div", { class: "ext-list" });
  const root = h(
    "div",
    { class: "view ext-view" },
    h(
      "div",
      { class: "view-actions" },
      h("button", { class: "btn small primary", onclick: () => install() }, t("ext.install")),
      h("button", { class: "btn small plain", onclick: () => showFolder() }, t("ext.openFolder")),
      h("button", { class: "icon-btn", title: t("ext.reload"), "aria-label": t("ext.reload"), html: icon("refresh", 15), onclick: () => host.reload() }),
    ),
    list,
    h("p", { class: "view-note" }, t("ext.note")),
  );

  async function install() {
    const folder = await dialog.pickFolder();
    if (!folder) return;
    try {
      const id = await host.installFromFolder(folder);
      toast(t("ext.installed", { id }), "success");
    } catch (err) {
      const msg = String(err);
      toast(msg.includes("NO_MANIFEST") ? t("ext.noManifest") : msg.includes("INVALID_ID") ? t("ext.invalidId") : t("ext.installFailed", { err: msg }), "error");
    }
  }

  async function showFolder() {
    try {
      const dir = await nativeExt.dir();
      await navigator.clipboard?.writeText(dir);
      toast(t("ext.folderCopied", { dir }), "info", 7000);
    } catch (err) {
      toast(String(err), "error");
    }
  }

  function statusLabel(e: LoadedExtension) {
    return t(`ext.status.${e.status}`);
  }

  function card(e: LoadedExtension) {
    const m = e.manifest;
    const enabled = e.status !== "disabled";
    const toggle = h("input", { type: "checkbox", class: "switch", checked: enabled, "aria-label": t("ext.enable") });
    toggle.addEventListener("change", () => host.setEnabled(m.id, toggle.checked));
    const contrib = m.contributes ?? {};
    const parts = [
      contrib.commands?.length ? t("ext.c.commands", { n: String(contrib.commands.length) }) : "",
      contrib.themes?.length ? t("ext.c.themes", { n: String(contrib.themes.length) }) : "",
      contrib.runConfigs?.length ? t("ext.c.run", { n: String(contrib.runConfigs.length) }) : "",
      contrib.languages?.length ? t("ext.c.languages", { n: String(contrib.languages.length) }) : "",
    ].filter(Boolean);
    return h(
      "article",
      { class: `ext-card status-${e.status}` },
      h(
        "header",
        { class: "ext-card-head" },
        h("div", { class: "ext-title" }, h("strong", {}, m.name), m.version ? h("span", { class: "ext-version" }, m.version) : null),
        h("label", { class: "switch-wrap" }, toggle),
      ),
      m.description ? h("p", { class: "ext-desc" }, m.description) : null,
      parts.length ? h("p", { class: "ext-contrib" }, parts.join("、")) : null,
      m.permissions?.length ? h("p", { class: "ext-perms" }, t("ext.perms"), " ", m.permissions.map((p) => t(`perm.${p}`)).join("、")) : null,
      h(
        "footer",
        { class: "ext-card-foot" },
        h("span", { class: `ext-status ${e.status}`, title: e.error ?? "" }, e.builtin ? t("ext.builtin") + "／" + statusLabel(e) : statusLabel(e)),
        e.status === "needsPermission" ? h("button", { class: "btn small primary", onclick: () => host.grantAndStart(m.id) }, t("ext.permAllow")) : null,
        !e.builtin
          ? h(
              "button",
              {
                class: "btn small plain danger-text",
                onclick: async () => {
                  if (await confirmBox(t("ext.uninstallTitle", { name: m.name }), t("ext.uninstallMessage"), t("ext.uninstall"), true)) {
                    await host.uninstall(m.id);
                  }
                },
              },
              t("ext.uninstall"),
            )
          : null,
      ),
      e.error ? h("pre", { class: "ext-error" }, e.error.split("\n").slice(0, 4).join("\n")) : null,
    );
  }

  function render() {
    clear(list);
    const all = host.list();
    if (!all.length) list.append(h("p", { class: "view-empty" }, t("ext.none")));
    for (const e of all) list.append(card(e));
  }

  host.onChange(render);
  render();
  return root;
}
