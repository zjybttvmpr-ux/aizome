// 入力の登録の画面：1 行に 1 つずつ、input() に入れる値を書いておく
import { h } from "../core/dom";
import { t } from "../core/i18n";
import { modal } from "./dialog";
import type { InputPreset } from "../run/inputs";

export function editInputPreset(fileName: string, current: InputPreset | undefined): Promise<InputPreset | null> {
  return modal<InputPreset | null>((close) => {
    const area = h("textarea", { class: "text-input preset-area", rows: 8, spellcheck: "false", placeholder: t("inputs.placeholder") }) as HTMLTextAreaElement;
    area.value = current?.text ?? "";
    const enabled = h("input", { type: "checkbox", class: "switch", checked: current ? current.enabled : true }) as HTMLInputElement;
    const save = () => close({ enabled: enabled.checked, text: area.value });
    area.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        save();
      }
    });
    return {
      body: [
        h("h2", { class: "modal-title" }, t("inputs.title", { name: fileName })),
        h("p", { class: "modal-text" }, t("inputs.help")),
        area,
        h("label", { class: "preset-toggle" }, enabled, h("span", {}, t("inputs.enabled"))),
        h(
          "div",
          { class: "modal-actions" },
          h("button", { class: "btn plain", type: "button", onclick: () => close({ enabled: false, text: "" }) }, t("inputs.clear")),
          h("button", { class: "btn plain", type: "button", onclick: () => close(null) }, t("common.cancel")),
          h("button", { class: "btn primary", type: "button", onclick: save }, t("inputs.save")),
        ),
      ],
      initialFocus: area,
    };
  }, null);
}
