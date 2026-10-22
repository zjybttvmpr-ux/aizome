// サイドバーの「検索」ビュー：ワークスペース全体から文字列を探す
import { h, clear } from "../core/dom";
import { t } from "../core/i18n";
import { fs, type SearchHit } from "../core/platform";
import { basename, dirname, relative } from "../core/paths";
import { icon } from "./icons";

export interface SearchViewDeps {
  root: () => string | null;
  open: (path: string, line: number, col: number) => void;
}

export interface SearchView {
  el: HTMLElement;
  focus(initial?: string): void;
}

export function createSearchView(deps: SearchViewDeps): SearchView {
  const input = h("input", { class: "text-input search-input", type: "search", placeholder: t("search.placeholder"), spellcheck: "false", "aria-label": t("search.placeholder") });
  const opt = (label: string, title: string) => {
    const b = h("button", { class: "search-opt", type: "button", title, "aria-label": title, "aria-pressed": "false" }, label);
    b.addEventListener("click", () => {
      b.setAttribute("aria-pressed", String(b.getAttribute("aria-pressed") !== "true"));
      void run();
    });
    return b;
  };
  const caseBtn = opt("Aa", t("search.case"));
  const wordBtn = opt("ab", t("search.word"));
  const regexBtn = opt(".*", t("search.regex"));
  const summary = h("p", { class: "search-summary" });
  const results = h("div", { class: "search-results" });

  const el = h(
    "div",
    { class: "view search-view" },
    h("div", { class: "search-box" }, input, h("div", { class: "search-opts" }, caseBtn, wordBtn, regexBtn)),
    summary,
    results,
  );

  let timer: number | undefined;
  let seq = 0;
  input.addEventListener("input", () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(run, 280);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      window.clearTimeout(timer);
      void run();
    }
  });

  const on = (b: HTMLElement) => b.getAttribute("aria-pressed") === "true";

  function highlight(text: string, query: string): Node {
    const frag = document.createDocumentFragment();
    if (on(regexBtn)) {
      frag.append(text);
      return frag;
    }
    const hay = on(caseBtn) ? text : text.toLowerCase();
    const needle = on(caseBtn) ? query : query.toLowerCase();
    let i = 0;
    let at = hay.indexOf(needle);
    while (needle && at >= 0) {
      frag.append(text.slice(i, at), h("mark", {}, text.slice(at, at + needle.length)));
      i = at + needle.length;
      at = hay.indexOf(needle, i);
    }
    frag.append(text.slice(i));
    return frag;
  }

  async function run() {
    const root = deps.root();
    const query = input.value;
    const my = ++seq;
    clear(results);
    if (!root) {
      summary.textContent = t("search.noFolder");
      return;
    }
    if (!query.trim()) {
      summary.textContent = "";
      return;
    }
    summary.textContent = t("search.searching");
    try {
      const r = await fs.search({ root, query, regex: on(regexBtn), caseSensitive: on(caseBtn), wholeWord: on(wordBtn), limit: 2000 });
      if (my !== seq) return;
      const byFile = new Map<string, SearchHit[]>();
      for (const hit of r.hits) {
        const list = byFile.get(hit.path) ?? [];
        list.push(hit);
        byFile.set(hit.path, list);
      }
      summary.textContent = r.hits.length
        ? t(r.truncated ? "search.summaryTruncated" : "search.summary", { hits: String(r.hits.length), files: String(byFile.size) })
        : t("search.none");
      for (const [path, hits] of byFile) {
        const body = h("div", { class: "search-hits" });
        const head = h(
          "button",
          { class: "search-file", type: "button", title: path },
          h("span", { class: "tree-twist open", html: icon("chevron", 12) }),
          h("span", { class: "search-file-name" }, basename(path)),
          h("span", { class: "search-file-dir" }, relative(root, dirname(path))),
          h("span", { class: "search-count" }, String(hits.length)),
        );
        head.addEventListener("click", () => {
          body.hidden = !body.hidden;
          head.querySelector(".tree-twist")?.classList.toggle("open", !body.hidden);
        });
        for (const hit of hits) {
          const row = h(
            "button",
            { class: "search-hit", type: "button" },
            h("span", { class: "search-line" }, String(hit.line)),
            h("span", { class: "search-text" }, highlight(hit.text, query)),
          );
          row.addEventListener("click", () => deps.open(hit.path, hit.line, hit.col));
          body.append(row);
        }
        results.append(h("div", { class: "search-group" }, head, body));
      }
    } catch (err) {
      if (my !== seq) return;
      const msg = String(err);
      summary.textContent = msg.includes("INVALID_REGEX") ? t("search.badRegex") : t("search.failed", { err: msg });
    }
  }

  return {
    el,
    focus(initial) {
      if (initial) input.value = initial;
      requestAnimationFrame(() => {
        input.focus();
        input.select();
      });
      if (initial) void run();
    },
  };
}
