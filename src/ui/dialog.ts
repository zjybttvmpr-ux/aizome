// アプリ内のダイアログ（WebView の prompt/confirm は OS によって使えないため自前で用意）
import { h } from "../core/dom";
import { t } from "../core/i18n";

interface Choice<T> {
  label: string;
  value: T;
  kind?: "primary" | "danger" | "plain";
}

export function modal<T>(build: (close: (v: T) => void) => { body: HTMLElement[]; initialFocus?: HTMLElement }, cancelValue: T): Promise<T> {
  return new Promise((resolve) => {
    const prevFocus = document.activeElement as HTMLElement | null;
    const backdrop = h("div", { class: "modal-backdrop" });
    const box = h("div", { class: "modal", role: "dialog", "aria-modal": "true" });
    let done = false;
    const close = (v: T) => {
      if (done) return;
      done = true;
      backdrop.remove();
      document.removeEventListener("keydown", onKey, true);
      prevFocus?.focus();
      resolve(v);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close(cancelValue);
      }
    };
    const { body, initialFocus } = build(close);
    box.append(...body);
    backdrop.append(box);
    backdrop.addEventListener("mousedown", (e) => {
      if (e.target === backdrop) close(cancelValue);
    });
    document.addEventListener("keydown", onKey, true);
    document.body.append(backdrop);
    (initialFocus ?? box.querySelector<HTMLElement>("button, input"))?.focus();
  });
}

export function choose<T>(title: string, message: string, choices: Choice<T>[], cancelValue: T): Promise<T> {
  return modal<T>(
    (close) => ({
      body: [
        h("h2", { class: "modal-title" }, title),
        message ? h("p", { class: "modal-text" }, message) : null!,
        h(
          "div",
          { class: "modal-actions" },
          ...choices.map((c) => h("button", { class: `btn ${c.kind ?? "plain"}`, onclick: () => close(c.value) }, c.label)),
        ),
      ].filter(Boolean),
    }),
    cancelValue,
  );
}

export async function confirmBox(title: string, message: string, okLabel: string, danger = false): Promise<boolean> {
  return choose(
    title,
    message,
    [
      { label: t("common.cancel"), value: false, kind: "plain" },
      { label: okLabel, value: true, kind: danger ? "danger" : "primary" },
    ],
    false,
  );
}

export function inputBox(opts: { title: string; value?: string; placeholder?: string; okLabel?: string; selectStem?: boolean }): Promise<string | null> {
  return modal<string | null>((close) => {
    const input = h("input", { class: "text-input", type: "text", value: opts.value ?? "", placeholder: opts.placeholder ?? "", spellcheck: "false" });
    const submit = () => {
      const v = input.value.trim();
      close(v ? v : null);
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        submit();
      }
    });
    requestAnimationFrame(() => {
      if (opts.selectStem && opts.value) {
        const dot = opts.value.lastIndexOf(".");
        input.setSelectionRange(0, dot > 0 ? dot : opts.value.length);
      } else input.select();
    });
    return {
      body: [
        h("h2", { class: "modal-title" }, opts.title),
        input,
        h(
          "div",
          { class: "modal-actions" },
          h("button", { class: "btn plain", onclick: () => close(null) }, t("common.cancel")),
          h("button", { class: "btn primary", onclick: submit }, opts.okLabel ?? t("common.ok")),
        ),
      ],
      initialFocus: input,
    };
  }, null);
}
