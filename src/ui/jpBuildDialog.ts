// 「日本語から組み立てる」の確認画面
import { h } from "../core/dom";
import { t } from "../core/i18n";
import { settings } from "../core/settings";
import { basename, dirname, extname, join, stripExt } from "../core/paths";
import { completer } from "../ai/completer";
import { BUILD_LANGUAGES, blockAt, buildPrompt, extractCode, type BuildLanguage } from "../ai/jpBuild";
import type { EditorHost } from "../editor/types";
import { inputBox } from "./dialog";
import { quickPick } from "./palette";
import { toast } from "./toast";

export interface BuildDeps {
  editor: EditorHost;
  activeDoc: () => { id: string; path: string | null; name: string } | undefined;
  root: () => string | null;
  /** ファイルに書き込んで開く */
  saveAndOpen: (path: string, text: string) => Promise<boolean>;
  run: (path: string) => Promise<void>;
  insertTemplate: () => void;
}

export async function buildFromJapanese(deps: BuildDeps, line?: number) {
  const doc = deps.activeDoc();
  if (!doc) {
    deps.insertTemplate();
    return;
  }
  if (!settings.get("ai.enabled")) {
    toast(t("chat.aiOff"), "warn");
    return;
  }
  const text = deps.editor.getText();
  const block = blockAt(text, line ?? deps.editor.cursor().line);
  if (!block) {
    toast(t("build.noBlock"), "info", 7000);
    return;
  }
  if (!block.spec.trim()) {
    toast(t("build.emptyBlock"), "info");
    return;
  }
  let lang: BuildLanguage | undefined = block.language;
  if (!lang) {
    if (block.rawLanguage) toast(t("build.unknownLanguage", { name: block.rawLanguage }), "warn");
    lang = await quickPick(
      BUILD_LANGUAGES.map((l) => ({ label: l.name, detail: `###構築${l.key}###`, value: l })),
      t("build.pickLanguage"),
    );
    if (!lang) return;
  }
  const language = lang;

  const baseDir = doc.path ? dirname(doc.path) : deps.root();
  const stem = doc.path ? stripExt(basename(doc.path)) : "main";
  const defaultName = doc.path && extname(doc.path) === language.ext ? `${stem}_built${language.ext}` : `${stem}${language.ext}`;

  await new Promise<void>((resolve) => {
    const keep = h("input", { type: "checkbox", checked: settings.get("build.keepComments") });
    const out = h("pre", { class: "rewrite-out build-out" }, t("rewrite.thinking"));
    const status = h("span", { class: "build-status" });
    const btn = (label: string, kind = "plain") => h("button", { class: `btn ${kind}`, type: "button", disabled: true }, label);
    const cancelBtn = h("button", { class: "btn plain", type: "button" }, t("common.cancel"));
    const retry = btn(t("rewrite.retry"));
    const copy = btn(t("chat.copy"));
    const insert = btn(t("build.insertBelow"));
    const save = btn(t("build.saveOpen"));
    const saveRun = btn(t("build.saveRun"), "primary");
    const actions = [retry, copy, insert, save, saveRun];

    const box = h(
      "div",
      { class: "modal wide", role: "dialog", "aria-modal": "true" },
      h("h2", { class: "modal-title" }, t("build.title", { lang: language.name })),
      h("details", { class: "build-spec" }, h("summary", {}, t("build.spec")), h("pre", {}, block.spec)),
      out,
      h("div", { class: "build-options" }, h("label", { class: "chat-check" }, keep, t("build.keepComments")), status),
      h("div", { class: "modal-actions build-actions" }, cancelBtn, retry, copy, insert, save, saveRun),
    );
    const backdrop = h("div", { class: "modal-backdrop" }, box);
    document.body.append(backdrop);

    let stop: (() => void) | null = null;
    let code = "";
    const close = () => {
      stop?.();
      backdrop.remove();
      document.removeEventListener("keydown", onKey, true);
      deps.editor.focus();
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
      actions.forEach((b) => (b.disabled = true));
      out.textContent = t("rewrite.thinking");
      status.textContent = t("build.generating");
      const started = Date.now();
      try {
        const answer = await completer.ask(buildPrompt(block.spec, language, { keepComments: keep.checked, fileName: defaultName }), {
          maxTokens: 2048,
          temperature: 0.2,
          onStart: (c) => (stop = c),
          onText: (full) => {
            out.textContent = extractCode(full) || t("rewrite.thinking");
            out.scrollTop = out.scrollHeight;
          },
        });
        code = extractCode(answer);
        out.textContent = code || t("rewrite.empty");
        status.textContent = code ? t("build.done", { lines: String(code.split("\n").length - 1), sec: String(Math.round((Date.now() - started) / 1000)) }) : "";
        [copy, insert, save, saveRun].forEach((b) => (b.disabled = !code));
      } catch (err) {
        out.textContent = t("chat.failed", { err: String((err as Error).message ?? err) });
        status.textContent = "";
      } finally {
        stop = null;
        retry.disabled = false;
      }
    };

    const askPath = async () => {
      const name = await inputBox({ title: t("build.fileName"), value: defaultName, selectStem: true, okLabel: t("file.save") });
      if (!name) return null;
      if (/^([A-Za-z]:[\\/]|\/)/.test(name)) return name;
      if (!baseDir) return null;
      return join(baseDir, name);
    };

    keep.addEventListener("change", () => {
      settings.set("build.keepComments", keep.checked);
      void run();
    });
    retry.addEventListener("click", () => void run());
    cancelBtn.addEventListener("click", close);
    copy.addEventListener("click", () => void navigator.clipboard?.writeText(code).then(() => toast(t("chat.copied"), "success")));
    insert.addEventListener("click", () => {
      close();
      deps.editor.goTo(block.endLine, Number.MAX_SAFE_INTEGER);
      deps.editor.insertText("\n\n" + code.replace(/\n$/, ""));
    });
    const saveThen = async (andRun: boolean) => {
      const path = await askPath();
      if (!path) return;
      if (!(await deps.saveAndOpen(path, code))) return;
      close();
      if (andRun) await deps.run(path);
    };
    save.addEventListener("click", () => void saveThen(false));
    saveRun.addEventListener("click", () => void saveThen(true));
    void run();
  });
}
