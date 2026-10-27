// 実行して出た Python のエラーを、日本語の説明と「いちばんありそうな直し方」にする
import { t } from "../core/i18n";
import { closest, PY_BUILTINS } from "../editor/codeCheck";

export interface RuntimeError {
  line: number | null;
  message: string;
  type?: string;
  detail?: string;
  name?: string | null;
  col?: number | null;
  endCol?: number | null;
}

export interface RuntimeExplain {
  /** 短い説明（行の右に出す） */
  text: string;
  /** もう少し詳しい直し方の説明 */
  hint?: string;
  /** その行の中の find を to に置きかえる直し方 */
  fix?: { find: string; to: string; attr?: boolean };
  /** pip で入れるとよいライブラリ */
  install?: string;
  /** まちがいではなく「こう実行するとエラーになる」くらいの注意（引数を渡さずに実行した など） */
  soft?: boolean;
}

/** コマンドから渡す値（引数）を使う書き方：sys.argv[1]・args[0]・process.argv[2] など */
const ARGV_USE = /\b(?:sys\.argv|process\.argv|args|argv|ARGV|os\.Args)\s*\[\s*(\d+)\s*\]/;
const INDEX_ERR = /IndexError|IndexOutOfRange|ArrayIndexOutOfBounds|index out of range|out of bounds|index out of/i;

/**
 * 引数を渡さずに実行したために出た「番号が範囲の外」エラーなら、注意の説明にする（そうでなければ null）。
 * 例：python grep.py だけで実行すると sys.argv[1] がない
 */
export function argvExplain(lineText: string | undefined, message: string): RuntimeExplain | null {
  if (!lineText || !INDEX_ERR.test(message)) return null;
  const m = ARGV_USE.exec(lineText);
  if (!m) return null;
  const expr = m[0].replace(/\s+/g, "");
  return { text: t("rt.argv", { expr }), hint: t("rt.argvHint"), soft: true };
}

const PIP_NAMES: Record<string, string> = {
  cv2: "opencv-python", PIL: "pillow", sklearn: "scikit-learn", yaml: "pyyaml", bs4: "beautifulsoup4", dotenv: "python-dotenv",
};

/** Python が「もしかして」を出さなかったときの候補（ファイルの中の名前と組み込みの名前から） */
function guessName(name: string, source?: string): string | null {
  const pool = new Set<string>(PY_BUILTINS);
  if (source) for (const m of source.matchAll(/[A-Za-z_][\w]*/g)) pool.add(m[0]);
  pool.delete(name);
  for (const k of ["self", "cls", "match", "case", "_"]) pool.delete(k);
  return closest(name, pool);
}

export function explainRuntime(err: RuntimeError, source?: string): RuntimeExplain {
  const type = err.type ?? /^(\w+):/.exec(err.message)?.[1] ?? "";
  if (source && err.line) {
    const soft = argvExplain(source.split("\n")[err.line - 1], `${type} ${err.message}`);
    if (soft) return soft;
  }
  const msg = err.message.replace(/^\w+:\s*/, "");
  const detail = err.detail ?? err.message;
  let mean = /Did you mean:? '([^']+)'\??/.exec(detail)?.[1] ?? /Did you mean '([^']+)'/.exec(detail)?.[1];
  if (!mean && type === "NameError") {
    const nm = /name '(\w+)' is not defined/.exec(msg)?.[1];
    if (nm) mean = guessName(nm, source) ?? undefined;
  }
  let m: RegExpExecArray | null;
  const r = (key: string, args: Record<string, string> = {}, extra: Partial<RuntimeExplain> = {}): RuntimeExplain => ({ text: t(key, args), ...extra });

  switch (type) {
    case "NameError":
      if ((m = /name '(\w+)' is not defined/.exec(msg))) {
        const name = m[1];
        if (mean) return r("rt.nameNear", { name, near: mean }, { fix: { find: name, to: mean }, hint: t("rt.nameNearHint", { near: mean }) });
        return r("rt.name", { name }, { hint: t("rt.nameHint", { name }) });
      }
      break;
    case "AttributeError":
      if ((m = /module '([\w.]+)' has no attribute '(\w+)'/.exec(msg))) {
        if (mean) return r("rt.modAttrNear", { mod: m[1], name: m[2], near: mean }, { fix: { find: m[2], to: mean, attr: true } });
        return r("rt.modAttr", { mod: m[1], name: m[2] });
      }
      if ((m = /'(\w+)' object has no attribute '(\w+)'/.exec(msg))) {
        if (mean) return r("rt.objAttrNear", { type: m[1], name: m[2], near: mean }, { fix: { find: m[2], to: mean, attr: true } });
        return r("rt.objAttr", { type: m[1], name: m[2] }, { hint: t("rt.objAttrHint", { type: m[1] }) });
      }
      break;
    case "TypeError":
      if ((m = /can only concatenate str \(not "(\w+)"\) to str/.exec(msg))) return r("rt.concat", { type: m[1] }, { hint: t("rt.concatHint") });
      if ((m = /unsupported operand type\(s\) for (.+?): '(\w+)' and '(\w+)'/.exec(msg))) return r("rt.operand", { op: m[1], a: m[2], b: m[3] }, { hint: m[2] === "str" || m[3] === "str" ? t("rt.operandStrHint") : undefined });
      if ((m = /'(<|>|<=|>=)' not supported between instances of '(\w+)' and '(\w+)'/.exec(msg))) return r("rt.compare", { op: m[1], a: m[2], b: m[3] }, { hint: m[2] === "str" || m[3] === "str" ? t("rt.operandStrHint") : undefined });
      if ((m = /'(\w+)' object is not callable/.exec(msg))) return r("rt.notCallable", { type: m[1] }, { hint: t("rt.notCallableHint") });
      if ((m = /'(\w+)' object is not subscriptable/.exec(msg))) return r("rt.notSubscriptable", { type: m[1] });
      if ((m = /'(\w+)' object is not iterable/.exec(msg))) return r("rt.notIterable", { type: m[1] }, { hint: m[1] === "int" ? t("rt.notIterableIntHint") : undefined });
      if ((m = /(\w+)\(\) missing (\d+) required positional arguments?: (.+)$/.exec(msg))) return r("rt.missingArg", { name: m[1], n: m[2], args: m[3] });
      if ((m = /(\w+)\(\) takes (\d+) positional arguments? but (\d+) (were|was) given/.exec(msg))) return r("rt.tooManyArgs", { name: m[1], want: m[2], got: m[3] }, { hint: Number(m[3]) === Number(m[2]) + 1 ? t("rt.selfHint") : undefined });
      if ((m = /(\w+)\(\) got an unexpected keyword argument '(\w+)'/.exec(msg))) return r("rt.badKw", { name: m[1], kw: m[2] });
      if (/'str' object cannot be interpreted as an integer/.test(msg)) return r("rt.strAsInt", {}, { hint: t("rt.operandStrHint") });
      if ((m = /list indices must be integers or slices, not (\w+)/.exec(msg))) return r("rt.indexType", { type: m[1] });
      if (/object of type '(\w+)' has no len\(\)/.test(msg)) return r("rt.noLen", { type: /object of type '(\w+)'/.exec(msg)![1] });
      break;
    case "ValueError":
      if ((m = /invalid literal for int\(\) with base 10: '(.*)'/.exec(msg))) return r("rt.intLiteral", { text: m[1] }, { hint: t("rt.intLiteralHint") });
      if ((m = /could not convert string to float: '(.*)'/.exec(msg))) return r("rt.floatLiteral", { text: m[1] });
      if (/math domain error/.test(msg)) return r("rt.mathDomain", {}, { hint: t("rt.mathDomainHint") });
      if ((m = /not enough values to unpack \(expected (\d+), got (\d+)\)/.exec(msg))) return r("rt.unpackFew", { want: m[1], got: m[2] });
      if ((m = /too many values to unpack \(expected (\d+)\)/.exec(msg))) return r("rt.unpackMany", { want: m[1] });
      if (/is not in list/.test(msg)) return r("rt.notInList");
      break;
    case "ZeroDivisionError":
      return r("rt.zeroDiv", {}, { hint: t("rt.zeroDivHint") });
    case "IndexError":
      if (/out of range/.test(msg)) return r("rt.indexRange", { what: /string/.test(msg) ? t("rt.what.str") : /tuple/.test(msg) ? t("rt.what.tuple") : t("rt.what.list") }, { hint: t("rt.indexRangeHint") });
      break;
    case "KeyError":
      return r("rt.key", { key: msg }, { hint: t("rt.keyHint") });
    case "UnboundLocalError":
      if ((m = /local variable '(\w+)'|cannot access local variable '(\w+)'/.exec(msg))) return r("rt.unbound", { name: m[1] ?? m[2] }, { hint: t("rt.unboundHint", { name: m[1] ?? m[2] }) });
      break;
    case "ModuleNotFoundError":
      if ((m = /No module named '([\w.]+)'/.exec(msg))) {
        const top = m[1].split(".")[0];
        return r("rt.noModule", { name: m[1], pip: PIP_NAMES[top] ?? top }, { install: PIP_NAMES[top] ?? top });
      }
      break;
    case "ImportError":
      if ((m = /cannot import name '(\w+)' from '([\w.]+)'/.exec(msg))) return r("rt.importName", { name: m[1], mod: m[2] });
      break;
    case "FileNotFoundError":
      if ((m = /No such file or directory: '(.+)'/.exec(msg))) return r("rt.noFile", { path: m[1] }, { hint: t("rt.noFileHint") });
      break;
    case "RecursionError":
      return r("rt.recursion", {}, { hint: t("rt.recursionHint") });
    case "EOFError":
      return r("rt.eof", {}, { hint: t("rt.eofHint") });
    case "KeyboardInterrupt":
      return r("rt.interrupt");
    case "OverflowError":
      return r("rt.overflow");
    case "UnicodeDecodeError":
      return r("rt.decode", {}, { hint: t("rt.decodeHint") });
    case "IndentationError":
    case "SyntaxError":
    case "TabError":
      return r("rt.syntax", { msg });
    case "AssertionError":
      return r("rt.assert", { msg: msg || "" });
    case "StopIteration":
      return r("rt.stopIteration");
    case "PermissionError":
      return r("rt.permission");
    case "IsADirectoryError":
      return { text: "IsADirectoryError：ファイルではなくフォルダを開こうとしています" };
    case "NotADirectoryError":
      return { text: "NotADirectoryError：フォルダではなくファイルを指定しています" };
    case "FileExistsError":
      return { text: "FileExistsError：同じ名前のファイル（フォルダ）がもうあります" };
    case "JSONDecodeError":
      return { text: `JSONDecodeError：JSON として読めません（${msg}）`, hint: "ファイルの中身が JSON の書き方になっているか確かめましょう" };
    case "NotImplementedError":
      return { text: "NotImplementedError：まだ中身を作っていない部分を呼びました" };
    case "RuntimeError":
      return { text: `RuntimeError：実行中に問題が起きました（${msg}）` };
    case "MemoryError":
      return { text: "MemoryError：メモリが足りません（大きすぎるリストなど）" };
    case "TimeoutError":
      return { text: "TimeoutError：時間内に終わりませんでした" };
    case "ConnectionError":
    case "ConnectionRefusedError":
    case "ConnectionResetError":
      return { text: `${type}：つながりませんでした（ネットや相手の状態を確かめましょう）` };
    case "TclError":
      return { text: `TclError：tkinter の画面でエラー（${msg}）`, hint: "ウィンドウを閉じたあとに部品を使っていないか確かめましょう" };
    case "LookupError":
    case "UnicodeEncodeError":
      return { text: `${type}：この文字はその文字コードで書けません`, hint: "encoding=\"utf-8\" を付けてみましょう" };
    case "SystemExit":
      return { text: "プログラムが exit( ) で終わりました" };
    case "GeneratorExit":
    case "StopAsyncIteration":
      return { text: `${type}：${msg}` };
  }
  return r("rt.other", { type, msg: msg.slice(0, 120) });
}
