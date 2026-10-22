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
  /** 文章を書いてよい場所か（Markdown・テキスト・コメントの中など） */
  proseOk?: boolean;
  /** ファイルの言語（例：Python）。違う言語の書き方の候補を捨てるのに使う */
  language?: string;
  /** false なら言語ちがいの候補も出す */
  languageFilter?: boolean;
}

/** Python のファイルに出てきたら、ほかの言語（JavaScript・C・Java など）の候補とみなす書き方 */
const NOT_PYTHON = [
  /^\s*(function\s+\w+\s*\(|const\s+\w+\s*=|let\s+\w+\s*=|var\s+\w+\s*=|console\.log|export\s|public\s|private\s|#include|using\s+\w|package\s+\w|fn\s+\w+\s*\(|func\s+\w+\s*\()/,
  /\)\s*\{\s*$/,
  /^\s*\}\s*else\b/,
  /;\s*$/,
  /=>\s*\{?/,
  /^\s*import\s+.+\s+from\s+['"]/,
  /\b(System\.out\.println|printf|std::)/,
];
/** JavaScript・C・Go などのファイルに出てきたら、Python の候補とみなす書き方 */
const PYTHON_ONLY = [/^\s*def\s+\w+\s*\(.*\)\s*(->.*)?:\s*$/, /^\s*elif\b/, /^\s*(if|for|while)\b[^{;]*:\s*$/, /^\s*print\s*\(.*\)\s*$/, /^\s*from\s+[\w.]+\s+import\s/];
const BRACE_LANGS = /^(JavaScript|TypeScript|C|C\+\+|C#|Java|Go|Rust|Kotlin|Swift|Dart|PHP|Scala|Groovy)/;

/** ファイルの言語と違う書き方の候補か */
export function wrongLanguage(text: string, language?: string): boolean {
  if (!language) return false;
  const lines = text.split("\n").filter((l) => l.trim() && !/^\s*(#|\/\/|\/\*|\*)/.test(l));
  if (!lines.length) return false;
  if (language === "Python") return lines.some((l) => NOT_PYTHON.some((re) => re.test(l)));
  if (BRACE_LANGS.test(language) && !/^Go$/.test(language)) return lines.some((l) => PYTHON_ONLY.some((re) => re.test(l)));
  if (language === "Go") return lines.some((l) => PYTHON_ONLY.slice(0, 2).some((re) => re.test(l)));
  return false;
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

// AI がコードの続きではなく「返事」を書き始めたときの言い出し
const CHAT_OPENERS =
  /^(it (looks|seems) like|it appears|here('s| is| are)\b|sure[,!. ]|certainly|of course|i('m| am| can| see| think| will|'ll| would)\b|this (code|snippet|script|program|line|is)\b|the (code|snippet|error|line) (you|is|above|provided)|you (can|might|may|are|should|need|have)\b|to (fix|import|use|do|achieve)\b|note[:：]|explanation|let('s| me)\b|please\b|great[,!.]|unfortunately|as an ai|in (python|javascript|this (case|example)))/i;
const CHAT_OPENERS_JA = /^(この(コード|スニペット|プログラム|行)|以下(は|の|に)|はい[、。！]|もちろん|申し訳|コードが|例えば|おそらく|ご(質問|指摘)|それでは|まず(は|、)|説明)/;

/** 候補が、コードではなく説明の文章に見えるか */
export function looksLikeProse(text: string, proseOk = false): boolean {
  const first = text.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  if (!first) return false;
  if (CHAT_OPENERS.test(first) || CHAT_OPENERS_JA.test(first)) return !proseOk || /^(it looks like|here('s| is)|sure|certainly|as an ai|はい|もちろん|申し訳)/i.test(first);
  if (proseOk) return false;
  // 単語が多く、記号がほとんどなく、文末が句点などで終わる行は文章とみなす
  const words = first.split(/\s+/).filter(Boolean);
  const codeChars = (first.match(/[()[\]{}=;<>_+*/\\|&$#@`'"]/g) ?? []).length;
  if (words.length >= 7 && codeChars === 0 && /[.!?:。！？：]$/.test(first)) return true;
  return false;
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

  // 説明の文章（チャットの返事）は候補にしない
  if (looksLikeProse(s, ctx.proseOk)) return "";
  // Python のファイルに JavaScript の候補、のような言語ちがいは出さない（文字列やコメントの中は別）
  if (!ctx.proseOk && ctx.languageFilter !== false && wrongLanguage(s, ctx.language)) return "";

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
