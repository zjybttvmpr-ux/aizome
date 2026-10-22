// モデルの出力を、エディタに出せる補完候補に整える（純粋関数）

export interface CleanContext {
  /** カーソルから行末までの文字 */
  lineSuffix: string;
  /** カーソルより後ろのコード */
  suffix: string;
  /** 複数行を許すか（行末で補完するとき true） */
  multiline: boolean;
  maxLines?: number;
}

const SPECIAL_TOKENS = /<\|[^|>]*\|>|<fim_[a-z_]+>|<\/?s>|<EOT>|<PRE>|<SUF>|<MID>|<\|endoftext\|>/g;

export function cleanCompletion(raw: string, ctx: CleanContext): string {
  let s = raw.replace(/\r/g, "").replace(SPECIAL_TOKENS, "");

  // コードフェンスで返してくるモデル対策
  s = s.replace(/^```[\w+-]*\n?/, "").replace(/\n?```\s*$/, "");

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
  }

  return s.replace(/\s+$/, "");
}

/** 補完を出してよい場所か（単語の途中などでは出さない） */
export function shouldComplete(prefix: string, lineSuffix: string): boolean {
  if (!prefix.trim()) return false;
  // 行末、または閉じ括弧・引用符・区切りだけが残っているとき
  return /^[\s)\]}'"`;,>]*$/.test(lineSuffix);
}
