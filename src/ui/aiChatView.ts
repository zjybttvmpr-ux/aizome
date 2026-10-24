// サイドバーの「AI チャット」ビュー。開いているファイルや選択範囲について質問できる
import { describeAiError } from "../ai/localAi";
import { h, clear } from "../core/dom";
import { t } from "../core/i18n";
import { settings } from "../core/settings";
import { completer } from "../ai/completer";
import type { EditorHost } from "../editor/types";
import { renderMarkdown } from "./markdown";
import { toast } from "./toast";
import { icon } from "./icons";

interface Message {
  role: "user" | "ai";
  text: string;
}

export interface AiChatDeps {
  editor: EditorHost;
  activeName: () => string | null;
}

export interface AiChatView {
  el: HTMLElement;
  focus(): void;
  ask(question: string): void;
}

export function createAiChatView(deps: AiChatDeps): AiChatView {
  const messages: Message[] = [];
  let cancel: (() => void) | null = null;

  const log = h("div", { class: "chat-log", "aria-live": "polite" });
  const input = h("textarea", { class: "chat-input", rows: 3, placeholder: t("chat.placeholder"), spellcheck: "false" });
  const withFile = h("input", { type: "checkbox", checked: true });
  const withSel = h("input", { type: "checkbox", checked: true });
  const send = h("button", { class: "btn small primary", type: "button" }, t("chat.send"));
  const stop = h("button", { class: "btn small plain", type: "button", hidden: true }, t("chat.stop"));
  const clearBtn = h("button", { class: "icon-btn", type: "button", title: t("chat.clear"), "aria-label": t("chat.clear"), html: icon("trash", 14) });

  const el = h(
    "div",
    { class: "view chat-view" },
    log,
    h(
      "div",
      { class: "chat-compose" },
      input,
      h(
        "div",
        { class: "chat-row" },
        h("label", { class: "chat-check" }, withFile, t("chat.includeFile")),
        h("label", { class: "chat-check" }, withSel, t("chat.includeSelection")),
      ),
      h("div", { class: "chat-row end" }, clearBtn, stop, send),
    ),
  );

  function renderEmpty() {
    if (messages.length) return;
    log.append(
      h(
        "div",
        { class: "chat-empty" },
        h("p", {}, t("chat.empty")),
        ...[t("chat.example1"), t("chat.example2"), t("chat.example3")].map((q) =>
          h("button", { class: "chat-example", type: "button", onclick: () => ask(q) }, q),
        ),
      ),
    );
  }

  function bubble(m: Message): HTMLElement {
    const body = h("div", { class: "chat-body" });
    if (m.role === "ai") {
      body.append(renderMarkdown(m.text || "…"));
      // コードブロックに「挿入」「コピー」を付ける
      body.querySelectorAll("pre").forEach((pre) => {
        const code = pre.textContent ?? "";
        const bar = h(
          "div",
          { class: "code-actions" },
          h("button", { class: "btn small plain", type: "button", onclick: () => (deps.editor.insertText(code.replace(/\n$/, "")), deps.editor.focus()) }, t("chat.insert")),
          h("button", { class: "btn small plain", type: "button", onclick: () => navigator.clipboard?.writeText(code).then(() => toast(t("chat.copied"), "success")) }, t("chat.copy")),
        );
        pre.after(bar);
      });
    } else {
      body.textContent = m.text;
    }
    return h("div", { class: `chat-msg ${m.role}` }, body);
  }

  function render() {
    clear(log);
    renderEmpty();
    for (const m of messages) log.append(bubble(m));
    log.scrollTop = log.scrollHeight;
  }

  function buildPrompt(question: string): string {
    const lang = settings.get("ui.language") === "en" ? "English" : "日本語";
    const parts: string[] = [
      `You are a helpful programming assistant inside a code editor. Answer in ${lang}. Be concise. Put code in fenced code blocks.`,
    ];
    const name = deps.activeName();
    const language = deps.editor.languageName();
    if (withSel.checked) {
      const sel = deps.editor.getSelection();
      if (sel.trim()) parts.push(`Selected code (${language}):\n\`\`\`\n${sel.slice(0, 6000)}\n\`\`\``);
    }
    if (withFile.checked && name) {
      const text = deps.editor.getText();
      if (text.trim()) parts.push(`Current file "${name}" (${language}):\n\`\`\`\n${text.slice(0, 12000)}\n\`\`\``);
    }
    // 直近の会話だけ渡す
    for (const m of messages.slice(-8, -1)) parts.push(`${m.role === "user" ? "User" : "Assistant"}: ${m.text.slice(0, 3000)}`);
    parts.push(`User: ${question}`, "Assistant:");
    return parts.join("\n\n");
  }

  async function ask(question: string) {
    const q = question.trim();
    if (!q || cancel) return;
    if (!settings.get("ai.enabled")) {
      toast(t("chat.aiOff"), "warn");
      return;
    }
    const prompt = buildPrompt(q);
    messages.push({ role: "user", text: q });
    const answer: Message = { role: "ai", text: "" };
    messages.push(answer);
    input.value = "";
    render();
    send.hidden = true;
    stop.hidden = false;
    let frame = 0;
    try {
      const text = await completer.ask(prompt, {
        maxTokens: 1024,
        temperature: 0.3,
        onStart: (c) => (cancel = c),
        onText: (full) => {
          answer.text = full;
          cancelAnimationFrame(frame);
          frame = requestAnimationFrame(render);
        },
      });
      answer.text = text.trim() || t("chat.noAnswer");
    } catch (err) {
      answer.text = t("chat.failed", { err: describeAiError(String((err as Error).message ?? err)) });
    } finally {
      cancel = null;
      send.hidden = false;
      stop.hidden = true;
      cancelAnimationFrame(frame);
      render();
    }
  }

  send.addEventListener("click", () => ask(input.value));
  stop.addEventListener("click", () => cancel?.());
  clearBtn.addEventListener("click", () => {
    messages.length = 0;
    render();
  });
  input.addEventListener("keydown", (e) => {
    // Enter で送信、Shift+Enter で改行（日本語入力の確定中は送らない）
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      void ask(input.value);
    }
  });
  render();

  return {
    el,
    focus: () => requestAnimationFrame(() => input.focus()),
    ask: (q) => void ask(q),
  };
}
