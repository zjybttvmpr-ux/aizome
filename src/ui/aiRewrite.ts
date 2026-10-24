// 「AI で書き換え」：選択範囲（なければカーソル位置）に、指示どおりのコードを書く。
// 結果は確認画面に出し、「適用」を押したときだけエディタに反映する。
import { describeAiError } from "../ai/localAi";
import { h } from "../core/dom";
import { t } from "../core/i18n";
import { settings } from "../core/settings";
import { completer } from "../ai/completer";
import type { EditorHost } from "../editor/types";
import { inputBox } from "./dialog";
import { toast } from "./toast";

function stripFences(s: string): string {
  const m = /```[\w+-]*\n([\s\S]*?)```/.exec(s);
  return (m ? m[1] : s).replace(/^\n+|\s+$/g, "");
}

export async function aiRewrite(editor: EditorHost, presetInstruction?: string) {
  if (!settings.get("ai.enabled")) {
    toast(t("chat.aiOff"), "warn");
    return;
  }
  const selection = editor.getSelection();
  const instruction =
    presetInstruction ??
    (await inputBox({
      title: selection ? t("rewrite.titleSelection") : t("rewrite.titleInsert"),
      placeholder: selection ? t("rewrite.placeholderSelection") : t("rewrite.placeholderInsert"),
      okLabel: t("rewrite.generate"),
    }));
  if (!instruction) return;

  const language = editor.languageName();
  const whole = editor.getText();
  const prompt = selection
    ? `Rewrite the following ${language} code according to the instruction.\nInstruction: ${instruction}\nReturn ONLY the rewritten code, with no explanation and no markdown fences.\n\nCode:\n${selection.slice(0, 8000)}\n`
    : `Write ${language} code according to the instruction. It will be inserted at the cursor in the file below.\nInstruction: ${instruction}\nReturn ONLY the code to insert, with no explanation and no markdown fences.\n\nFile (for context):\n${whole.slice(0, 8000)}\n`;

  await new Promise<void>((resolve) => {
    const out = h("pre", { class: "rewrite-out" }, t("rewrite.thinking"));
    const apply = h("button", { class: "btn primary", type: "button", disabled: true }, t("rewrite.apply"));
    const retry = h("button", { class: "btn plain", type: "button", disabled: true }, t("rewrite.retry"));
    const cancelBtn = h("button", { class: "btn plain", type: "button" }, t("common.cancel"));
    const box = h(
      "div",
      { class: "modal wide", role: "dialog", "aria-modal": "true" },
      h("h2", { class: "modal-title" }, t("rewrite.result")),
      h("p", { class: "modal-text" }, instruction),
      out,
      h("div", { class: "modal-actions" }, cancelBtn, retry, apply),
    );
    const backdrop = h("div", { class: "modal-backdrop" }, box);
    document.body.append(backdrop);
    let stop: (() => void) | null = null;
    let result = "";

    const close = () => {
      stop?.();
      backdrop.remove();
      document.removeEventListener("keydown", onKey, true);
      editor.focus();
      resolve();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    };
    document.addEventListener("keydown", onKey, true);

    const run = async () => {
      apply.disabled = true;
      retry.disabled = true;
      out.textContent = t("rewrite.thinking");
      try {
        const text = await completer.ask(prompt, {
          maxTokens: 1200,
          temperature: 0.2,
          onStart: (c) => (stop = c),
          onText: (full) => (out.textContent = stripFences(full) || t("rewrite.thinking")),
        });
        result = stripFences(text);
        out.textContent = result || t("rewrite.empty");
        apply.disabled = !result;
      } catch (err) {
        out.textContent = t("chat.failed", { err: describeAiError(String((err as Error).message ?? err)) });
      } finally {
        stop = null;
        retry.disabled = false;
      }
    };

    apply.addEventListener("click", () => {
      editor.replaceSelection(result);
      close();
    });
    retry.addEventListener("click", () => void run());
    cancelBtn.addEventListener("click", close);
    void run();
  });
}
