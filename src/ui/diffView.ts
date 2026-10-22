// 2 つの版を左右に並べて、違うところに色を付けて見せる（保存記録の比較）
import { h } from "../core/dom";
import { t } from "../core/i18n";
import { modal } from "./dialog";

export type DiffOp = { kind: "same" | "del" | "add"; a?: number; b?: number; text: string };

/** 行ごとの差分（最長共通部分列）。大きすぎるときは前後の一致だけ見る簡易版 */
export function diffLines(aText: string, bText: string): DiffOp[] {
  const a = aText.replace(/\r\n/g, "\n").split("\n");
  const b = bText.replace(/\r\n/g, "\n").split("\n");
  // 先頭と末尾の同じ部分は先に取る
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const ops: DiffOp[] = [];
  for (let i = 0; i < start; i++) ops.push({ kind: "same", a: i + 1, b: i + 1, text: a[i] });
  const ma = a.slice(start, endA);
  const mb = b.slice(start, endB);
  const n = ma.length;
  const m = mb.length;
  if (n * m <= 4_000_000) {
    const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = ma[i] === mb[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && ma[i] === mb[j]) {
        ops.push({ kind: "same", a: start + i + 1, b: start + j + 1, text: ma[i] });
        i++;
        j++;
      } else if (j < m && (i >= n || dp[i][j + 1] >= dp[i + 1][j])) {
        ops.push({ kind: "add", b: start + j + 1, text: mb[j] });
        j++;
      } else {
        ops.push({ kind: "del", a: start + i + 1, text: ma[i] });
        i++;
      }
    }
  } else {
    ma.forEach((text, i) => ops.push({ kind: "del", a: start + i + 1, text }));
    mb.forEach((text, j) => ops.push({ kind: "add", b: start + j + 1, text }));
  }
  for (let k = 0; k < a.length - endA; k++) ops.push({ kind: "same", a: endA + k + 1, b: endB + k + 1, text: a[endA + k] });
  return ops;
}

/** 左右に並べる行（消えた行と増えた行を横に並べる） */
function pairRows(ops: DiffOp[]): { left?: DiffOp; right?: DiffOp }[] {
  const rows: { left?: DiffOp; right?: DiffOp }[] = [];
  let i = 0;
  while (i < ops.length) {
    if (ops[i].kind === "same") {
      rows.push({ left: ops[i], right: ops[i] });
      i++;
      continue;
    }
    const dels: DiffOp[] = [];
    const adds: DiffOp[] = [];
    while (i < ops.length && ops[i].kind !== "same") (ops[i].kind === "del" ? dels : adds).push(ops[i++]);
    for (let k = 0; k < Math.max(dels.length, adds.length); k++) rows.push({ left: dels[k], right: adds[k] });
  }
  return rows;
}

/** 比較の画面を開く。onRestore を渡すと「左の版に戻す」ボタンが付く */
export function showDiff(opts: { leftTitle: string; rightTitle: string; left: string; right: string; onRestore?: () => void }): Promise<void> {
  const ops = diffLines(opts.left, opts.right);
  const rows = pairRows(ops);
  const added = ops.filter((o) => o.kind === "add").length;
  const removed = ops.filter((o) => o.kind === "del").length;
  return modal<void>((close) => {
    const table = h("div", { class: "diff-table" });
    // 変わっていないところが長く続くときは、前後 3 行だけ見せて畳む
    const changed = rows.map((r) => r.left?.kind !== "same" || r.right?.kind !== "same");
    const near = (i: number) => changed.slice(Math.max(0, i - 3), i + 4).some(Boolean);
    let skipped = 0;
    const flushSkip = () => {
      if (skipped) table.append(h("div", { class: "diff-skip" }, t("diff.skipped", { n: String(skipped) })));
      skipped = 0;
    };
    rows.forEach((r, i) => {
      if (!changed[i] && !near(i)) {
        skipped++;
        return;
      }
      flushSkip();
      const cell = (op: DiffOp | undefined, side: "a" | "b") =>
        h(
          "div",
          { class: `diff-cell ${op ? (op.kind === "same" ? "same" : side === "a" ? "del" : "add") : "empty"}` },
          h("span", { class: "diff-num" }, op ? String((side === "a" ? op.a : op.b) ?? "") : ""),
          h("span", { class: "diff-text" }, op?.text ?? ""),
        );
      table.append(h("div", { class: "diff-row" }, cell(r.left, "a"), cell(r.right, "b")));
    });
    flushSkip();
    if (!added && !removed) table.append(h("p", { class: "diff-same" }, t("diff.same")));
    return {
      body: [
        h("h2", { class: "modal-title" }, t("diff.title"), h("span", { class: "diff-stat" }, ` +${added} −${removed}`)),
        h("div", { class: "diff-head" }, h("span", {}, opts.leftTitle), h("span", {}, opts.rightTitle)),
        table,
        h(
          "div",
          { class: "modal-actions" },
          opts.onRestore
            ? h("button", { class: "btn plain", type: "button", onclick: () => (close(), opts.onRestore!()) }, t("diff.restoreLeft"))
            : null,
          h("button", { class: "btn primary", type: "button", onclick: () => close() }, t("common.close")),
        ),
      ],
    };
  }, undefined).then(() => undefined);
}
