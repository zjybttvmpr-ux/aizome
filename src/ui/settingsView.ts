// サイドバーの「設定」ビュー
import { h, clear } from "../core/dom";
import { t } from "../core/i18n";
import { settings, type Settings } from "../core/settings";
import { bus } from "../core/events";
import { completer } from "../ai/completer";
import { listThemes } from "./themes";
import { dialog } from "../core/platform";
import { basename } from "../core/paths";
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

function range<K extends Key>(key: K, min: number, max: number, step: number, format: (v: number) => string) {
  const out = h("span", { class: "range-value" }, format(Number(settings.get(key))));
  const el = h("input", { class: "range", type: "range", min, max, step, value: String(settings.get(key)) });
  el.addEventListener("input", () => {
    out.textContent = format(Number(el.value));
    settings.set(key, Number(el.value) as Settings[K]);
  });
  return h("div", { class: "range-row" }, el, out);
}

/** 色の選択。空欄ならテーマの色を使う */
function color(key: "look.bgColor" | "look.accentColor", cssVar: string) {
  const current = () => settings.get(key) || getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim();
  const toHex7 = (v: string) => (/^#[0-9a-f]{6}$/i.test(v) ? v : /^#[0-9a-f]{3}$/i.test(v) ? "#" + v.slice(1).split("").map((c) => c + c).join("") : "#000000");
  const picker = h("input", { class: "color-input", type: "color", value: toHex7(current()) });
  const code = h("input", { class: "text-input mono", type: "text", value: settings.get(key), placeholder: t("settings.themeColor"), spellcheck: "false", maxlength: 7 });
  const reset = h("button", { class: "btn small plain", type: "button", disabled: !settings.get(key) }, t("settings.reset"));
  picker.addEventListener("input", () => {
    code.value = picker.value;
    settings.set(key, picker.value);
    reset.disabled = false;
  });
  code.addEventListener("change", () => {
    const v = code.value.trim();
    if (!v || /^#?[0-9a-f]{3}([0-9a-f]{3})?$/i.test(v)) {
      const val = v && !v.startsWith("#") ? "#" + v : v;
      settings.set(key, val);
      picker.value = toHex7(val || current());
      reset.disabled = !val;
    }
  });
  reset.addEventListener("click", () => {
    settings.set(key, "");
    code.value = "";
    requestAnimationFrame(() => (picker.value = toHex7(current())));
    reset.disabled = true;
  });
  return h("div", { class: "field-row color-row" }, picker, code, reset);
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
    const bgImage = settings.get("look.bgImage");
    const pickImage = async () => {
      const p = await dialog.pickImage();
      if (p) settings.set("look.bgImage", p);
    };

    root.append(
      h(
        "section",
        { class: "settings-group" },
        h("h3", {}, t("settings.appearance")),
        field(t("settings.language"), select("ui.language", [{ value: "ja", label: "日本語" }, { value: "en", label: "English" }])),
        field(t("settings.theme"), select("ui.theme", themeOptions)),
        field(t("settings.bgColor"), color("look.bgColor", "--bg"), t("settings.bgColorHelp")),
        field(t("settings.accentColor"), color("look.accentColor", "--accent")),
        field(t("settings.zoom"), range("look.zoom", 0.6, 1.8, 0.1, (v) => `${Math.round(v * 100)}%`)),
      ),
      h(
        "section",
        { class: "settings-group" },
        h("h3", {}, t("settings.bgImage")),
        h(
          "div",
          { class: "field" },
          h("div", { class: "bg-file" }, bgImage ? h("span", { class: "bg-file-name", title: bgImage }, basename(bgImage)) : h("span", { class: "field-help" }, t("settings.bgImageNone"))),
          h(
            "div",
            { class: "field-row" },
            h("button", { class: "btn small primary", type: "button", onclick: pickImage }, bgImage ? t("settings.bgImageChange") : t("settings.bgImagePick")),
            bgImage ? h("button", { class: "btn small plain", type: "button", onclick: () => settings.set("look.bgImage", "") }, t("settings.bgImageRemove")) : null,
          ),
        ),
        bgImage ? field(t("settings.bgOpacity"), range("look.bgOpacity", 0.3, 1, 0.02, (v) => `${Math.round(v * 100)}%`), t("settings.bgOpacityHelp")) : null,
        bgImage ? field(t("settings.bgDim"), range("look.bgDim", 0, 0.9, 0.05, (v) => `${Math.round(v * 100)}%`)) : null,
        bgImage ? field(t("settings.bgBlur"), range("look.bgBlur", 0, 24, 1, (v) => `${v}px`)) : null,
        bgImage
          ? field(
              t("settings.bgFit"),
              select("look.bgFit", [
                { value: "cover", label: t("settings.fit.cover") },
                { value: "contain", label: t("settings.fit.contain") },
                { value: "center", label: t("settings.fit.center") },
                { value: "tile", label: t("settings.fit.tile") },
              ]),
            )
          : null,
      ),
      h(
        "section",
        { class: "settings-group" },
        h("h3", {}, t("settings.editor")),
        field(t("settings.fontSize"), number("editor.fontSize", 10, 28)),
        field(t("settings.tabSize"), number("editor.tabSize", 1, 8)),
        field(t("settings.fontFamily"), text("editor.fontFamily", "JetBrains Mono"), t("settings.fontFamilyHelp")),
        h("label", { class: "field inline" }, h("span", { class: "field-label" }, t("settings.wordWrap")), toggle("editor.wordWrap")),
        h("label", { class: "field inline" }, h("span", { class: "field-label" }, t("settings.lineNumbers")), toggle("editor.lineNumbers")),
        field(
          t("settings.autoSave"),
          select("editor.autoSave", [
            { value: "off", label: t("settings.autoSave.off") },
            { value: "delay", label: t("settings.autoSave.delay") },
            { value: "focus", label: t("settings.autoSave.focus") },
          ]),
        ),
        h("label", { class: "field inline" }, h("span", { class: "field-label" }, t("settings.trimWhitespace")), toggle("editor.trimTrailingWhitespace")),
        h("label", { class: "field inline" }, h("span", { class: "field-label" }, t("settings.finalNewline")), toggle("editor.insertFinalNewline")),
        h("label", { class: "field inline" }, h("span", { class: "field-label" }, t("settings.restoreTabs")), toggle("editor.restoreTabs")),
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
    if (key === "ui.language" || key === "ai.provider" || key === "look.bgImage" || key === "ui.theme") {
      // 入力中のコントロールを壊さないよう、少し待ってから描き直す
      requestAnimationFrame(render);
    }
  });
  // 表示されるたびに最新の状態（後から追加されたテーマなど）で描き直す
  root.addEventListener("view:show", render);
  render();
  return root;
}
