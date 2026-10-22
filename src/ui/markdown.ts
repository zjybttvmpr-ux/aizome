// Markdown を安全な HTML にする（AI の返答や Markdown プレビュー用）
import { marked } from "marked";

marked.setOptions({ gfm: true, breaks: false });

const BLOCKED = new Set(["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "LINK", "META", "BASE", "FORM", "INPUT", "BUTTON", "TEXTAREA", "SELECT"]);

/** 危ないタグ・属性（on*、javascript: など）を取り除く */
export function sanitize(html: string): DocumentFragment {
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  const walk = (node: Element) => {
    for (const child of [...node.children]) {
      if (BLOCKED.has(child.tagName)) {
        child.remove();
        continue;
      }
      for (const attr of [...child.attributes]) {
        const name = attr.name.toLowerCase();
        const value = attr.value.trim().toLowerCase();
        if (name.startsWith("on") || name === "style" || name === "srcdoc") child.removeAttribute(attr.name);
        else if ((name === "href" || name === "src" || name === "xlink:href") && /^(javascript|vbscript|data:text)/.test(value)) child.removeAttribute(attr.name);
      }
      if (child.tagName === "A") {
        child.setAttribute("rel", "noopener noreferrer");
        child.setAttribute("target", "_blank");
      }
      walk(child);
    }
  };
  walk(tpl.content as unknown as Element);
  return tpl.content;
}

export function renderMarkdown(src: string): DocumentFragment {
  return sanitize(marked.parse(src, { async: false }) as string);
}
