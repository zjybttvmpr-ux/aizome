import { h } from "../core/dom";

let host: HTMLElement | null = null;

export type ToastKind = "info" | "success" | "warn" | "error";

export function toast(message: string, kind: ToastKind = "info", ms = Math.min(15000, Math.max(4200, message.length * 70))) {
  if (!host) {
    host = h("div", { class: "toasts", role: "status", "aria-live": "polite" });
    document.body.append(host);
  }
  const el = h("div", { class: `toast ${kind}` }, h("span", { class: "toast-text" }, message));
  el.addEventListener("click", () => el.remove());
  host.append(el);
  window.setTimeout(() => {
    el.classList.add("leaving");
    window.setTimeout(() => el.remove(), 200);
  }, ms);
}
