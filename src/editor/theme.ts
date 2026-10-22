// エディタの見た目。色はすべて CSS 変数なので、テーマ切り替えは変数の差し替えだけで済む
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";

export const editorTheme = EditorView.theme({
  "&": {
    height: "100%",
    color: "var(--text)",
    backgroundColor: "var(--editor-bg)",
  },
  ".cm-scroller": {
    fontFamily: "var(--font-code)",
    lineHeight: "1.6",
  },
  ".cm-content": { caretColor: "var(--cursor)", padding: "10px 0 40vh" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--cursor)", borderLeftWidth: "2px" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "var(--selection) !important",
  },
  ".cm-activeLine": { backgroundColor: "var(--line-active)" },
  ".cm-gutters": {
    backgroundColor: "var(--editor-bg)",
    color: "var(--text-faint)",
    border: "none",
    paddingLeft: "6px",
  },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--text-muted)" },
  ".cm-lineNumbers .cm-gutterElement": { padding: "0 14px 0 8px", minWidth: "3ch" },
  ".cm-foldGutter .cm-gutterElement": { color: "var(--text-faint)" },
  ".cm-matchingBracket, &.cm-focused .cm-matchingBracket": {
    backgroundColor: "transparent",
    outline: "1px solid var(--accent-line)",
    borderRadius: "2px",
  },
  ".cm-selectionMatch": { backgroundColor: "var(--accent-soft)" },
  ".cm-searchMatch": { backgroundColor: "var(--warn-soft)", outline: "1px solid var(--warn)" },
  ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "var(--warn)", color: "var(--bg)" },
  ".cm-tooltip": {
    backgroundColor: "var(--surface)",
    border: "1px solid var(--border)",
    color: "var(--text)",
    borderRadius: "8px",
    boxShadow: "var(--shadow-pop)",
  },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: "var(--accent-soft)",
    color: "var(--text)",
  },
  ".cm-panels": { backgroundColor: "var(--panel)", color: "var(--text)", borderColor: "var(--border)" },
  ".cm-panel input, .cm-panel button": { fontFamily: "inherit" },
  ".cm-tooltip-autocomplete > ul": {
    fontFamily: "var(--font-suggest)",
  },
  ".cm-explain": {
    fontFamily: "var(--font-suggest)",
    color: "var(--ghost)",
    opacity: "0.75",
    fontSize: "0.88em",
    marginLeft: "2.5em",
    whiteSpace: "pre",
    pointerEvents: "none",
    userSelect: "none",
  },
  ".cm-explain::before": { content: '"← "', opacity: "0.6" },
  ".cm-explain.ai::after": { content: '" ✦"', opacity: "0.5", fontSize: "0.85em" },
  ".cm-ghost": {
    fontFamily: "var(--font-suggest)",
    color: "var(--ghost)",
    whiteSpace: "pre",
    textDecoration: "underline dotted var(--ghost-line)",
    textUnderlineOffset: "4px",
  },
});

const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword], color: "var(--syn-keyword)" },
  { tag: [t.string, t.special(t.string), t.regexp], color: "var(--syn-string)" },
  { tag: [t.number, t.bool, t.null, t.atom], color: "var(--syn-number)" },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: "var(--syn-comment)", fontStyle: "italic" },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName], color: "var(--syn-function)" },
  { tag: [t.typeName, t.className, t.namespace, t.definition(t.typeName)], color: "var(--syn-type)" },
  { tag: [t.propertyName, t.attributeName], color: "var(--syn-property)" },
  { tag: [t.tagName, t.heading], color: "var(--syn-tag)", fontWeight: "600" },
  { tag: [t.operator, t.punctuation, t.bracket], color: "var(--syn-operator)" },
  { tag: [t.definition(t.variableName), t.self], color: "var(--syn-variable)" },
  { tag: [t.meta, t.annotation, t.processingInstruction], color: "var(--syn-meta)" },
  { tag: t.link, color: "var(--accent)", textDecoration: "underline" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strong, fontWeight: "700" },
  { tag: t.invalid, color: "var(--danger)" },
]);

export const syntaxColors = syntaxHighlighting(highlight);
