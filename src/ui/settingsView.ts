// サイドバーの「設定」ビュー
import { h, clear } from "../core/dom";
import { t } from "../core/i18n";
import { settings, type Settings } from "../core/settings";
import { bus } from "../core/events";
import { completer } from "../ai/completer";
import { listThemes } from "./themes";
import { toast } from "./toast";

type Key = keyof Settings;

function field(label: string, control: HTMLElement, help?: string) {
  return h("label", { class: "field" }, h("span", { class: "field-label" }, label), control, help ? h("span", { class: "field-help" }, help) : null);
}

function select<K extends Key>(key: K, options: { value: string; label: string }[]) {
  const el = h("select", { class: "select" }, ...options.map((o) => h("option", { value: o.value, selected: String(settings.get(key)) === o.value }, o.label)));
  el.addEventListener("change", () => settings.set(key, el.value as Settings[K]));
  return el;
}

function number<K extends Key>(key: K, min: number, max: number, step = 1) {
  const el = h("input", { class: "text-input", type: "number", min, max, step, value: String(settings.get(key)) });
  el.addEventListener("change", () => {
    const v = Math.min(max, Math.max(min, Number(el.value) || min));
    el.value = String(v);
    settings.set(key, v as Settings[K]);
  });
  return el;
}

function text<K extends Key>(key: K, placeholder = "", type = "text") {
  const el = h("input", { class: "text-input", type, value: String(settings.get(key) ?? ""), placeholder, spellcheck: "false" });
  el.addEventListener("change", () => settings.set(key, el.value.trim() as Settings[K]));
  return el;
}

function toggle<K extends Key>(key: K) {
  const el = h("input", { type: "checkbox", class: "switch", checked: Boolean(settings.get(key)) });
  el.addEventListener("change", () => settings.set(key, el.checked as Settings[K]));
  return el;
}

export function createSettingsView(): HTMLElement {
  const root = h("div", { class: "view settings-view" });

  function render() {
    clear(root);
    const themeOptions = listThemes().map((th) => ({ value: th.id, label: th.label }));

    const modelInput = text("ai.model", "qwen2.5-coder:1.5b");
    const modelList = h("datalist", { id: "ai-models" });
    modelInput.setAttribute("list", "ai-models");
    const fetchBtn = h("button", { class: "btn small plain", type: "button" }, t("settings.fetchModels"));
    fetchBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      fetchBtn.disabled = true;
      try {
        const models = await completer.models();
        clear(modelList);
        models.forEach((m) => modelList.append(h("option", { value: m })));
        toast(models.length ? t("settings.modelsFound", { n: String(models.length) }) : t("settings.noModels"), models.length ? "success" : "warn");
      } catch (err) {
        toast(t("settings.connectFailed", { err: String(err) }), "error", 7000);
      } finally {
        fetchBtn.disabled = false;
      }
    });

    const isOpenAI = settings.get("ai.provider") === "openai";

    root.append(
      h(
        "section",
        { class: "settings-group" },
        h("h3", {}, t("settings.appearance")),
        field(t("settings.language"), select("ui.language", [{ value: "ja", label: "日本語" }, { value: "en", label: "English" }])),
        field(t("settings.theme"), select("ui.theme", themeOptions)),
      ),
      h(
        "section",
        { class: "settings-group" },
        h("h3", {}, t("settings.editor")),
        field(t("settings.fontSize"), number("editor.fontSize", 10, 28)),
        field(t("settings.tabSize"), number("editor.tabSize", 1, 8)),
        h("label", { class: "field inline" }, h("span", { class: "field-label" }, t("settings.wordWrap")), toggle("editor.wordWrap")),
      ),
      h(
        "section",
        { class: "settings-group" },
        h("h3", {}, t("settings.ai")),
        h("label", { class: "field inline" }, h("span", { class: "field-label" }, t("settings.aiEnabled")), toggle("ai.enabled")),
        field(
          t("settings.provider"),
          select("ai.provider", [
            { value: "ollama", label: "Ollama" },
            { value: "openai", label: t("settings.openaiCompat") },
          ]),
        ),
        field(t("settings.endpoint"), text("ai.endpoint", isOpenAI ? "http://127.0.0.1:8080" : "http://127.0.0.1:11434")),
        h("div", { class: "field" }, h("span", { class: "field-label" }, t("settings.model")), h("div", { class: "field-row" }, modelInput, fetchBtn), modelList, h("span", { class: "field-help" }, t("settings.modelHelp"))),
        field(t("settings.debounce"), number("ai.debounceMs", 50, 2000, 10), t("settings.debounceHelp")),
        field(t("settings.maxTokens"), number("ai.maxTokens", 16, 512, 8)),
        isOpenAI ? field(t("settings.apiKey"), text("ai.apiKey", t("settings.apiKeyPlaceholder"), "password")) : null,
      ),
      h(
        "section",
        { class: "settings-group" },
        h("h3", {}, t("settings.terminal")),
        field(t("settings.shell"), text("terminal.shell", t("settings.shellPlaceholder")), t("settings.shellHelp")),
        field(t("settings.fontSize"), number("terminal.fontSize", 9, 24)),
      ),
    );
  }

  bus.on("settings:changed", ({ key }) => {
    if (key === "ui.language" || key === "ai.provider") render();
  });
  // 表示されるたびに最新の状態（後から追加されたテーマなど）で描き直す
  root.addEventListener("view:show", render);
  render();
  return root;
}
