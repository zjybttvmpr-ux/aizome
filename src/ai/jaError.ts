// AI が英語で書いてきたエラーの予想（「IndexError: list index out of range」など）を日本語にする
import { settings } from "../core/settings";
import { translateError } from "../run/errorExplain";

const HAS_JA = /[぀-ヿ㐀-鿿]/;

/** エラーの名前 → 日本語のひとこと */
const EXC_JA: Record<string, string> = {
  // Python
  ZeroDivisionError: "0 で割り算をしています",
  IndexError: "番号がリスト（文字列）の範囲の外です",
  KeyError: "辞書にないキーを使っています",
  ValueError: "値の形がちがいます（数字ではない文字を数にしようとした など）",
  TypeError: "型（種類）の組み合わせがちがいます（文字と数を足した など）",
  NameError: "まだ作られていない名前を使っています",
  UnboundLocalError: "値を入れる前の変数を使っています",
  AttributeError: "その値にはない属性・メソッドを使っています",
  FileNotFoundError: "ファイルが見つかりません",
  PermissionError: "ファイルを開く許可がありません",
  ModuleNotFoundError: "モジュール（ライブラリ）が入っていません",
  ImportError: "読み込めないものがあります",
  RecursionError: "自分を呼ぶ回数（再帰）が多すぎます",
  OverflowError: "数が大きすぎます",
  MemoryError: "メモリが足りません",
  EOFError: "入力がもうありません",
  StopIteration: "取り出す要素がもうありません",
  AssertionError: "assert の条件が成り立っていません",
  IndentationError: "字下げ（インデント）がまちがっています",
  TabError: "字下げにタブと空白がまざっています",
  SyntaxError: "書き方（文法）がまちがっています",
  UnicodeDecodeError: "文字コードがちがうので読めません",
  UnicodeEncodeError: "この文字はその文字コードで書けません",
  JSONDecodeError: "JSON として読めません",
  TimeoutError: "時間内に終わりませんでした",
  ConnectionError: "つながりませんでした",
  KeyboardInterrupt: "途中で止められました",
  // C# / Unity
  NullReferenceException: "中身が null（何もない）の変数を使っています",
  IndexOutOfRangeException: "番号が配列の範囲の外です",
  ArgumentOutOfRangeException: "番号（引数）が範囲の外です",
  ArgumentNullException: "引数が null（何もない）です",
  ArgumentException: "引数の値がまちがっています",
  DivideByZeroException: "0 で割り算をしています",
  FormatException: "数字ではない文字を数にしようとしています",
  InvalidCastException: "その型には変換できません",
  KeyNotFoundException: "辞書にないキーを使っています",
  InvalidOperationException: "今の状態ではできない操作です",
  MissingReferenceException: "もう消えたオブジェクトを使っています",
  UnassignedReferenceException: "インスペクターで何も入れていない変数を使っています",
  StackOverflowException: "自分を呼ぶ回数（再帰）が多すぎます",
  OverflowException: "数が大きすぎます",
  // Java
  NullPointerException: "中身が null（何もない）の変数を使っています",
  ArrayIndexOutOfBoundsException: "番号が配列の範囲の外です",
  StringIndexOutOfBoundsException: "番号が文字列の範囲の外です",
  IndexOutOfBoundsException: "番号が範囲の外です",
  NumberFormatException: "数字ではない文字を数にしようとしています",
  ArithmeticException: "計算できません（0 で割り算 など）",
  ClassCastException: "その型には変換できません",
  InputMismatchException: "入力の形がちがいます（数字のところに文字 など）",
  NoSuchElementException: "取り出す要素（入力）がもうありません",
  ConcurrentModificationException: "くり返しの途中でリストを変えています",
  StackOverflowError: "自分を呼ぶ回数（再帰）が多すぎます",
  OutOfMemoryError: "メモリが足りません",
  IOException: "ファイルの読み書きに失敗しています",
  FileNotFoundException: "ファイルが見つかりません",
  // JavaScript
  ReferenceError: "まだ作られていない名前を使っています",
  RangeError: "値が使える範囲の外です",
};

/** よくある英語の言い回し → 日本語 */
const PHRASES: [RegExp, string | ((m: RegExpExecArray) => string)][] = [
  [/(integer |float )?division (or modulo )?by zero|divide by zero|divided by zero/i, "0 で割り算をしています"],
  [/(list|string|tuple|array) index out of range|index out of (range|bounds)|out of bounds/i, "番号が範囲の外です"],
  [/name '(\w+)' is not defined|(\w+) is not defined/i, (m) => `${m[1] ?? m[2]} がまだ作られていません`],
  [/has no attribute '(\w+)'/i, (m) => `${m[1]} という属性・メソッドがありません`],
  [/no such file( or directory)?|file not found|does not exist/i, "ファイルが見つかりません"],
  [/invalid literal for int\(\)|could not convert string to float|non-?numeric|not a (valid )?number/i, "数字ではない文字を数にしようとしています"],
  [/can only concatenate str|unsupported operand type|must be str, not|cannot concatenate/i, "文字と数のように、種類のちがうものを計算しています"],
  [/is not iterable/i, "くり返しに使えない値です"],
  [/is not callable/i, "関数ではないものを ( ) で呼んでいます"],
  [/is not subscriptable/i, "[ ] で取り出せない値です"],
  [/missing (\d+) required positional argument/i, (m) => `引数が ${m[1]} 個足りません`],
  [/takes (\d+) positional arguments? but (\d+)/i, (m) => `引数は ${m[1]} 個なのに ${m[2]} 個渡しています`],
  [/maximum recursion depth|infinite recursion|stack overflow/i, "自分を呼ぶ回数（再帰）が多すぎます"],
  [/infinite loop|never ends|loops forever/i, "くり返しが終わらない可能性があります"],
  [/null|none ?type|undefined/i, "中身が「何もない」値を使っています"],
  [/key ?error|key not found|missing key/i, "辞書にないキーを使っています"],
  [/permission denied/i, "許可がありません"],
  [/no module named '?([\w.]+)'?/i, (m) => `モジュール ${m[1]} が入っていません`],
  [/user (enters|inputs?|types)|if the input|invalid input/i, "入力された値によってはエラーになります"],
];

/** 「if n is 0」のような条件の言い回し */
function conditionJa(text: string): string {
  let m: RegExpExecArray | null;
  if ((m = /\bif\s+([\w.[\]]+)\s+(?:is|==|equals)\s+(?:0|zero)\b/i.exec(text))) return `${m[1]} が 0 だと`;
  if ((m = /\bif\s+([\w.[\]]+)\s+is\s+(?:empty)\b/i.exec(text))) return `${m[1]} が空だと`;
  if ((m = /\bif\s+([\w.[\]]+)\s+is\s+(?:None|null)\b/i.exec(text))) return `${m[1]} が何もない（None）と`;
  if ((m = /\bif\s+(?:the\s+)?file\s+(?:'([^']+)'|"([^"]+)"|(\S+))?\s*(?:does not exist|doesn't exist|is missing|not found)/i.exec(text))) return `ファイル${m[1] ?? m[2] ?? m[3] ? `「${m[1] ?? m[2] ?? m[3]}」` : ""}がないと`;
  return "";
}

/**
 * エラーの予想や説明を日本語にする（もともと日本語ならそのまま）。
 * 「IndexError: list index out of range」→「IndexError：番号が範囲の外です」
 */
export function jaReason(reason: string, lang: string | null = null): string {
  const text = reason.trim();
  if (!text || HAS_JA.test(text) || settings.get("ui.language") === "en") return text;
  const exc = /\b([A-Z]\w*(?:Error|Exception|Interrupt|Iteration))\b/.exec(text)?.[1] ?? null;
  // 1. 実行エラーの日本語化の表（直し方つきの、いちばん詳しいもの）
  try {
    const em = exc ? text.slice(text.indexOf(exc)) : text;
    const tr = translateError(em.replace(/\s*\(.*$/, ""), lang);
    if (tr.text && HAS_JA.test(tr.text)) return tr.text;
  } catch {
    // 使えなければ次へ
  }
  // 2. 言い回しの表
  const cond = conditionJa(text);
  for (const [re, ja] of PHRASES) {
    const m = re.exec(text);
    if (m) {
      const body = typeof ja === "string" ? ja : ja(m);
      return `${exc ? `${exc}：` : ""}${cond ? `${cond}エラーになります（${body}）` : body}`;
    }
  }
  // 3. エラーの名前だけはわかる
  if (exc && EXC_JA[exc]) return `${exc}：${cond ? `${cond}エラーになります（${EXC_JA[exc]}）` : EXC_JA[exc]}`;
  if (exc) return `${exc}：${cond ? `${cond}エラーになります` : "実行するとエラーになる可能性があります"}`;
  return cond ? `${cond}エラーになる可能性があります` : "実行するとエラーになる可能性があります";
}
