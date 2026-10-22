// モデルの出力を、エディタに出せる補完候補に整える（純粋関数）

export interface CleanContext {
  /** カーソルから行末までの文字 */
  lineSuffix: string;
  /** カーソルより後ろのコード */
  suffix: string;
  /** カーソルより前のコード（繰り返しの検出に使う） */
  prefix?: string;
  /** 複数行を許すか（行末で補完するとき true） */
  multiline: boolean;
  maxLines?: number;
}

const SPECIAL_TOKENS = /<\|[^|>]*\|>|<fim_[a-z_]+>|<\/?s>|<EOT>|<PRE>|<SUF>|<MID>|<\|endoftext\|>/g;

/** コメント行か（主要な言語のコメント記号） */
export function isCommentLine(line: string): boolean {
  return /^\s*(\/\/|#(?!include|define|if|endif|pragma|import)|--|;;?|\/\*|\*(?!\*?\s*$)|<!--|%|REM\s|')/i.test(line) && line.trim().length > 2;
}

/**
 * 直前がコメントで、カーソル行が空なら「コメントの指示からコードを書く」場面とみなす。
 * 返り値はそのコメントの文章（なければ null）
 */
export function commentIntent(prefix: string): string | null {
  const lines = prefix.split("\n");
  const current = lines[lines.length - 1];
  if (current.trim() !== "") return null;
  const block: string[] = [];
  for (let i = lines.length - 2; i >= 0 && block.length < 12; i--) {
    const l = lines[i];
    if (l.trim() === "" && block.length === 0) continue;
    if (!isCommentLine(l)) break;
    block.unshift(l.trim());
  }
  if (!block.length) return null;
  const text = block.join(" ").replace(/^(\/\/|#|--|;+|\/\*+|\*+|<!--|%|')\s*/gm, "").trim();
  // 区切り線や空のコメントは指示とみなさない
  return /[\p{L}\p{N}]{2,}/u.test(text) ? text : null;
}

function norm(s: string) {
  return s.trim().replace(/\s+/g, " ");
}

/** 同じ行の連続や、直前のコードの丸写しを取り除く */
export function removeRepetition(text: string, prefix = ""): string {
  let lines = text.split("\n");

  // 1. 同じ行（または同じ2〜3行の塊）が続いたら、2回目の手前で切る
  for (let size = 1; size <= 3; size++) {
    for (let i = size; i + size <= lines.length; i++) {
      const a = lines.slice(i - size, i).map(norm).join("\n");
      const b = lines.slice(i, i + size).map(norm).join("\n");
      if (a.length > 3 && a === b) {
        lines = lines.slice(0, i);
        break;
      }
    }
  }

  // 2. 直前の行をそのまま繰り返している先頭行を落とす
  const prevLines = prefix.split("\n").map(norm).filter((l) => l.length > 0);
  const last = prevLines[prevLines.length - 1] ?? "";
  while (lines.length && lines[0].trim() !== "" && norm(lines[0]) === last && last.length > 3) {
    lines.shift();
  }

  // 3. 少し上にすでにある複数行の塊を丸ごと書こうとしていたら捨てる
  const body = lines.map(norm).filter(Boolean);
  if (body.length >= 2) {
    const recent = prevLines.slice(-60).join("\n");
    if (recent.includes(body.join("\n"))) return "";
  }

  return lines.join("\n");
}

export function cleanCompletion(raw: string, ctx: CleanContext): string {
  let s = raw.replace(/\r/g, "").replace(SPECIAL_TOKENS, "");

  // コードフェンスで返してくるモデル対策
  s = s.replace(/^```[\w+-]*\n?/, "").replace(/\n?```[\s\S]*$/, "");

  if (!ctx.multiline) {
    s = s.split("\n")[0];
  } else {
    // 空行が2つ続いたらそこで打ち切る
    const stop = s.search(/\n[ \t]*\n[ \t]*\n/);
    if (stop >= 0) s = s.slice(0, stop);
    const lines = s.split("\n");
    const max = ctx.maxLines ?? 12;
    if (lines.length > max) s = lines.slice(0, max).join("\n");
  }

  s = removeRepetition(s, ctx.prefix);

  // カーソル後ろにすでにある文字と重複させない
  const tail = ctx.lineSuffix.trim();
  if (tail && s.trimEnd().endsWith(tail)) {
    s = s.trimEnd().slice(0, -tail.length);
  }

  // 後続コードの先頭行を繰り返していたら、その手前で切る
  const nextLine = ctx.suffix.replace(/^[^\n]*\n/, "").split("\n").find((l) => l.trim().length > 3);
  if (ctx.multiline && nextLine) {
    const idx = s.indexOf("\n" + nextLine);
    if (idx >= 0) s = s.slice(0, idx);
    else if (norm(s.split("\n")[0] ?? "") === norm(nextLine)) s = "";
  }

  s = s.replace(/\s+$/, "");
  // 空白だけの候補は出さない
  return s.trim() ? s : "";
}

/** 補完を出してよい場所か（単語の途中などでは出さない） */
export function shouldComplete(prefix: string, lineSuffix: string): boolean {
  if (!prefix.trim()) return false;
  // 行末、または閉じ括弧・引用符・区切りだけが残っているとき
  return /^[\s)\]}'"`;,>]*$/.test(lineSuffix);
}

/** 候補を覚えておくためのキー（同じ場所で却下された候補を出し直さない） */
export function contextKey(prefix: string, text: string): string {
  return prefix.slice(-160) + "\u0000" + norm(text);
}
