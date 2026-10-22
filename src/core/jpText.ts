// 日本語まわりの文字の変換・数え方・日付など（画面に依存しない関数だけ）

/** 全角の英数字・記号・スペースを半角に（ひらがな・カタカナ・漢字はそのまま） */
export function zenToHan(s: string): string {
  return s
    .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/　/g, " ")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/￥/g, "\\")
    .replace(/ー(?=\d)/g, "-");
}

/** 半角の英数字・記号を全角に */
export function hanToZen(s: string): string {
  return s.replace(/[!-~]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0xfee0)).replace(/ /g, "　");
}

/** 半角カタカナ（ｶﾀｶﾅ）を全角カタカナに */
export function hanKanaToZen(s: string): string {
  return s.replace(/[｡-ﾟ]+/g, (m) => m.normalize("NFKC"));
}

export function hiraToKata(s: string): string {
  return s.replace(/[ぁ-ゖゝゞ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
}

export function kataToHira(s: string): string {
  return s.replace(/[ァ-ヶヽヾ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

/** コードの中でまちがえやすい全角文字（スペース・かっこ・記号・英数字） */
export const ZENKAKU_IN_CODE = /[　！-～“”‘’￥]/g;

/**
 * コードの中の全角記号を半角に直す。文字列（"…" '…' `…`）とコメントの中はそのまま。
 * 言語ごとの細かい文法までは見ないが、よくあるまちがい（全角スペース・（）・：・＝ など）を直せる
 */
export function fixZenkakuInCode(text: string, commentStart: string[] = ["#", "//"]): { text: string; count: number } {
  let count = 0;
  const out = text.split("\n").map((line) => {
    let res = "";
    let quote: string | null = null;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (quote) {
        res += c;
        if (c === "\\") {
          res += line[++i] ?? "";
          continue;
        }
        if (c === quote) quote = null;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") {
        quote = c;
        res += c;
        continue;
      }
      if (commentStart.some((m) => line.startsWith(m, i))) {
        res += line.slice(i);
        break;
      }
      ZENKAKU_IN_CODE.lastIndex = 0;
      if (ZENKAKU_IN_CODE.test(c)) {
        count++;
        res += zenToHan(c);
      } else res += c;
    }
    return res;
  });
  return { text: out.join("\n"), count };
}

export interface CharCount {
  chars: number;
  charsNoSpace: number;
  lines: number;
  words: number;
  /** 400 字詰め原稿用紙で何枚分か（空白を除いた文字数で計算） */
  manuscript: number;
  bytesUtf8: number;
}

export function countChars(s: string): CharCount {
  const chars = [...s.replace(/\r?\n/g, "")].length;
  const charsNoSpace = [...s.replace(/\s/g, "")].length;
  return {
    chars,
    charsNoSpace,
    lines: s ? s.split("\n").length : 0,
    words: (s.match(/[A-Za-z0-9_]+|[^\sA-Za-z0-9_]/g) ?? []).length,
    manuscript: Math.round((charsNoSpace / 400) * 10) / 10,
    bytesUtf8: new TextEncoder().encode(s).length,
  };
}

const WEEK = ["日", "月", "火", "水", "木", "金", "土"];
const ERAS: [string, Date][] = [
  ["令和", new Date(2019, 4, 1)],
  ["平成", new Date(1989, 0, 8)],
  ["昭和", new Date(1926, 11, 25)],
];

/** 和暦（例：令和8年） */
export function wareki(d: Date): string {
  for (const [name, start] of ERAS) {
    if (d >= start) {
      const y = d.getFullYear() - start.getFullYear() + 1;
      return `${name}${y === 1 ? "元" : y}年${d.getMonth() + 1}月${d.getDate()}日`;
    }
  }
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** 日付の書き方いろいろ（入力の候補） */
export function dateFormats(d = new Date()): { label: string; text: string }[] {
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const w = WEEK[d.getDay()];
  return [
    { label: "年月日（曜日）", text: `${y}年${m}月${day}日（${w}）` },
    { label: "和暦", text: wareki(d) },
    { label: "ハイフン", text: `${y}-${pad(m)}-${pad(day)}` },
    { label: "スラッシュ", text: `${y}/${pad(m)}/${pad(day)}` },
    { label: "日時", text: `${y}-${pad(m)}-${pad(day)} ${pad(d.getHours())}:${pad(d.getMinutes())}` },
    { label: "時刻", text: `${pad(d.getHours())}:${pad(d.getMinutes())}` },
  ];
}

/**
 * かんたんな計算（+ - * / % ^ と かっこ）。全角の数字や ×÷ も使える。
 * eval は使わない。計算できなければ null
 */
export function calc(expr: string): number | null {
  const src = zenToHan(expr).replace(/×/g, "*").replace(/÷/g, "/").replace(/,/g, "").replace(/\*\*/g, "^").trim();
  if (!src || !/^[\d.+\-*/%^()\s]+$/.test(src)) return null;
  const tokens = src.match(/\d+(?:\.\d+)?|\.\d+|[+\-*/%^()]/g);
  if (!tokens) return null;
  let i = 0;
  const peek = () => tokens[i];
  const next = () => tokens[i++];
  const primary = (): number => {
    const tk = next();
    if (tk === "(") {
      const v = expr1();
      if (next() !== ")") throw new Error("paren");
      return v;
    }
    if (tk === "-") return -primary();
    if (tk === "+") return primary();
    const n = Number(tk);
    if (tk === undefined || Number.isNaN(n)) throw new Error("num");
    return n;
  };
  const power = (): number => {
    const b = primary();
    if (peek() === "^") {
      next();
      return b ** power();
    }
    return b;
  };
  const term = (): number => {
    let v = power();
    while (peek() === "*" || peek() === "/" || peek() === "%") {
      const op = next();
      const r = power();
      v = op === "*" ? v * r : op === "/" ? v / r : v % r;
    }
    return v;
  };
  const expr1 = (): number => {
    let v = term();
    while (peek() === "+" || peek() === "-") {
      const op = next();
      const r = term();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  };
  try {
    const v = expr1();
    if (i !== tokens.length || !Number.isFinite(v)) return null;
    return Math.round(v * 1e12) / 1e12;
  } catch {
    return null;
  }
}

/** ローマ字・ひらがなでも探せるように、比べる前にそろえる */
export function normalizeQuery(s: string): string {
  return kataToHira(hanKanaToZen(zenToHan(s))).toLowerCase();
}
