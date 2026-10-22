// 1行のコードが何をするかを、日本語で短く説明する（AI を使わないルール。純粋関数）
// 対応：Python、JavaScript / TypeScript、よく使う C・C++・Java・Rust・Go の表示

export type ExplainLang = "python" | "js" | "c" | "ruby" | "shell" | "other";

export function langFromFilename(name: string): ExplainLang {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (["py", "pyw"].includes(ext)) return "python";
  if (["js", "mjs", "cjs", "jsx", "ts", "mts", "tsx", "vue", "svelte"].includes(ext)) return "js";
  if (["c", "h", "cpp", "cc", "cxx", "hpp", "java", "cs", "rs", "go", "kt", "kts", "swift", "dart", "php", "scala", "groovy", "zig"].includes(ext)) return "c";
  if (["rb"].includes(ext)) return "ruby";
  if (["sh", "bash", "zsh", "ps1", "bat", "cmd"].includes(ext)) return "shell";
  return "other";
}

const cut = (s: string, n = 24) => {
  const t = s.trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
};

/** "abc" / 'abc' / `abc` なら中身を返す */
function stringLiteral(s: string): string | null {
  const m = /^\s*([rbuf]*)(["'`])((?:\\.|(?!\2).)*)\2\s*$/i.exec(s);
  if (!m) return null;
  return m[3].replace(/\\n/g, "（改行）").replace(/\\t/g, " ");
}

/** f"..." や `...${x}` のような、値を埋め込む文字列か */
function isTemplate(s: string): boolean {
  return /^\s*f["']/i.test(s) || (/^\s*`/.test(s) && s.includes("${"));
}

/** かっこの対応を見ながら、カンマで引数を分ける */
function splitArgs(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = "";
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      cur += c;
      if (c === "\\") cur += s[++i] ?? "";
      else if (c === quote) quote = "";
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) depth--;
    else if (c === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** 表示する中身の説明：「こんにちは」/ x の中身 / 文字と値 */
function describeShown(args: string[]): string {
  const parts = args.filter((a) => !/^(sep|end|file|flush)\s*=/.test(a));
  if (!parts.length) return "空の行を表示します";
  if (parts.length === 1) {
    const a = parts[0];
    const lit = stringLiteral(a);
    if (lit !== null && !isTemplate(a)) return lit ? `「${cut(lit, 30)}」と表示します` : "空の行を表示します";
    if (isTemplate(a)) {
      const inner = a.replace(/^\s*f?(["'`])/, "").replace(/(["'`])\s*$/, "").replace(/\$?\{([^}]*)\}/g, "〔$1〕");
      return `「${cut(inner, 30)}」と表示します（〔 〕の所に値が入ります）`;
    }
    if (/^[A-Za-z_][\w.]*$/.test(a)) return `${a} の中身を表示します`;
    if (/^len\((.+)\)$/.test(a)) return `${a.slice(4, -1)} の長さ（個数）を表示します`;
    return `${cut(a)} の結果を表示します`;
  }
  const lits = parts.map((p) => stringLiteral(p));
  if (lits.every((l) => l !== null)) return `「${cut(lits.join(" "), 30)}」と表示します`;
  return `${parts.map((p, i) => (lits[i] !== null ? `「${cut(lits[i]!, 12)}」` : cut(p, 12))).join("・")} を並べて表示します`;
}

function describeValue(v: string): string | null {
  const t = v.trim().replace(/;$/, "");
  if (/^\[\s*\]$/.test(t)) return "空のリスト";
  if (/^\{\s*\}$/.test(t)) return "空の辞書（入れ物）";
  if (/^\(\s*\)$/.test(t)) return "空のタプル";
  if (/^(set|new Set)\(\s*\)$/.test(t)) return "空の集合";
  if (/^new Map\(\s*\)$/.test(t)) return "空の Map";
  if (/^-?\d+(\.\d+)?$/.test(t)) return t;
  if (/^(True|False|true|false)$/.test(t)) return /^t/i.test(t) ? "真（はい）" : "偽（いいえ）";
  if (/^(None|null|undefined)$/.test(t)) return "「何もない」という値";
  const lit = stringLiteral(t);
  if (lit !== null) return `文字「${cut(lit, 20)}」`;
  if (/^\[.*\]$/.test(t)) return `リスト ${cut(t, 20)}`;
  return null;
}

function inputDescription(rhs: string): { prompt: string; asNumber: string | null } | null {
  let t = rhs.trim();
  let conv: string | null = null;
  // int(input("…")) のような変換を外す
  const wrap = /^(int|float|Number|parseInt|parseFloat)\((.*)\)$/.exec(t);
  if (wrap) {
    conv = /int/i.test(wrap[1]) ? "整数" : "数";
    t = wrap[2].trim();
  }
  const m = /^(input|prompt)\((.*)\)$/.exec(t);
  if (!m) return null;
  const lit = stringLiteral(splitArgs(m[2])[0] ?? "");
  return { prompt: lit ?? "", asNumber: conv };
}

function describeRange(args: string[]): string | null {
  const [a, b, c] = args;
  if (args.length === 1) return /^\d+$/.test(a) ? `0 から ${Number(a) - 1} まで` : `0 から ${a}−1 まで`;
  if (args.length >= 2) {
    const end = /^\d+$/.test(b) ? String(Number(b) - 1) : `${b}−1`;
    return `${a} から ${end} まで${c ? `（${c} ずつ）` : ""}`;
  }
  return null;
}

// ───────── Python

function python(line: string): string | null {
  const s = line.trim();
  let m: RegExpExecArray | null;

  if (/^if\s+__name__\s*==\s*["']__main__["']\s*:/.test(s)) return "このファイルを直接実行したときだけ、下の処理を動かします";
  if ((m = /^from\s+([\w.]+)\s+import\s+(.+)$/.exec(s))) return `${m[1]} から ${cut(m[2].replace(/[()]/g, ""), 30)} を読み込みます`;
  if ((m = /^import\s+([\w.]+)\s+as\s+(\w+)$/.exec(s))) return `${m[1]} を ${m[2]} という名前で読み込みます`;
  if ((m = /^import\s+(.+)$/.exec(s))) return `${m[1].split(",").map((x) => x.trim()).join("・")} を読み込みます`;
  if ((m = /^(async\s+)?def\s+(\w+)\s*\((.*)\)\s*(->\s*[^:]+)?:\s*$/.exec(s))) {
    const params = splitArgs(m[3]).filter((p) => p && p !== "self" && p !== "cls").map((p) => p.split(/[:=]/)[0].trim());
    const kind = m[2] === "__init__" ? "作るときに最初に動く処理を" : `関数 ${m[2]} を`;
    return params.length ? `${kind}定義します（受け取るもの：${cut(params.join("、"), 30)}）` : `${kind}定義します`;
  }
  if ((m = /^class\s+(\w+)\s*(\((.*)\))?\s*:/.exec(s))) return m[3] ? `${m[3]} をもとにしたクラス ${m[1]} を定義します` : `クラス ${m[1]} を定義します`;
  if ((m = /^for\s+(.+?)\s+in\s+range\((.*)\)\s*:/.exec(s))) {
    const r = describeRange(splitArgs(m[2]));
    return r ? `${m[1]} を ${r}変えながら繰り返します` : `${m[1]} を数えながら繰り返します`;
  }
  if ((m = /^for\s+(.+?),\s*(.+?)\s+in\s+enumerate\((.+)\)\s*:/.exec(s))) return `${m[3]} の中身を、番号 ${m[1]} と一緒に 1 つずつ ${m[2]} に入れて繰り返します`;
  if ((m = /^for\s+(.+?)\s+in\s+(.+?)\s*:/.exec(s))) return `${cut(m[2])} の中身を 1 つずつ ${m[1]} に入れて繰り返します`;
  if (/^while\s+(True|1)\s*:/.test(s)) return "ずっと繰り返します（break で抜けます）";
  if ((m = /^while\s+(.+?)\s*:/.exec(s))) return `${cut(m[1])} のあいだ繰り返します`;
  if ((m = /^if\s+(.+?)\s*:/.exec(s))) return `もし ${cut(m[1], 30)} なら`;
  if ((m = /^elif\s+(.+?)\s*:/.exec(s))) return `そうでなく、もし ${cut(m[1], 30)} なら`;
  if (/^else\s*:/.test(s)) return "そうでなければ";
  if (/^try\s*:/.test(s)) return "エラーが起きるかもしれない処理を試します";
  if ((m = /^except\s+(\w+)/.exec(s))) return `${m[1]} のエラーが起きたら`;
  if (/^except\s*:/.test(s)) return "何かエラーが起きたら";
  if (/^finally\s*:/.test(s)) return "最後に必ず行う処理";
  if ((m = /^with\s+open\((.+?)\)\s+as\s+(\w+)\s*:/.exec(s))) {
    const args = splitArgs(m[1]);
    const mode = stringLiteral(args[1] ?? "") ?? "r";
    const what = mode.includes("w") ? "書き込み用" : mode.includes("a") ? "追記用" : "読み込み用";
    const name = stringLiteral(args[0] ?? "");
    return `ファイル${name !== null ? `「${cut(name, 20)}」` : ` ${cut(args[0], 20)} `}を${what}に開いて ${m[2]} として使います`;
  }
  if (/^return\s*$/.test(s)) return "関数を終わります";
  if ((m = /^return\s+(.+)$/.exec(s))) return `${cut(m[1])} を返します`;
  if (/^break$/.test(s)) return "繰り返しを抜けます";
  if (/^continue$/.test(s)) return "次の繰り返しへ進みます";
  if (/^pass$/.test(s)) return "何もしません";
  if ((m = /^print\((.*)\)$/.exec(s))) return describeShown(splitArgs(m[1]));
  if ((m = /^([\w.[\]]+)\.append\((.+)\)$/.exec(s))) return `${m[1]} の最後に ${cut(m[2], 16)} を追加します`;
  if ((m = /^([\w.[\]]+)\.extend\((.+)\)$/.exec(s))) return `${m[1]} の最後に ${cut(m[2], 16)} の中身をまとめて追加します`;
  if ((m = /^([\w.[\]]+)\.sort\((.*)\)$/.exec(s))) return /reverse\s*=\s*True/.test(m[2]) ? `${m[1]} を大きい順に並べ替えます` : `${m[1]} を小さい順に並べ替えます`;
  if ((m = /^([\w.[\]]+)\.remove\((.+)\)$/.exec(s))) return `${m[1]} から ${cut(m[2], 16)} を取り除きます`;
  if ((m = /^([\w.[\]]+)\.pop\((.*)\)$/.exec(s))) return m[2] ? `${m[1]} の ${m[2]} 番目を取り出します` : `${m[1]} の最後の 1 つを取り出します`;
  if ((m = /^([\w.]+)\.write\((.+)\)$/.exec(s))) return `${cut(m[2], 20)} をファイルに書き込みます`;
  if ((m = /^time\.sleep\((.+)\)$/.exec(s))) return `${m[1]} 秒待ちます`;
  return assignment(s, "python");
}

// ───────── JavaScript / TypeScript

function js(line: string): string | null {
  const s = line.trim().replace(/;$/, "");
  let m: RegExpExecArray | null;
  if ((m = /^import\s+(.+?)\s+from\s+["'](.+)["']$/.exec(s))) return `${m[2]} から ${cut(m[1].replace(/[{}]/g, "").trim(), 24)} を読み込みます`;
  if ((m = /^import\s+["'](.+)["']$/.exec(s))) return `${m[1]} を読み込みます`;
  if ((m = /^(?:const|let|var)\s+(\w+)\s*=\s*require\(["'](.+)["']\)$/.exec(s))) return `${m[2]} を ${m[1]} という名前で読み込みます`;
  if ((m = /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*(\w*)\s*\(([^)]*)\)/.exec(s))) {
    const params = splitArgs(m[2]).map((p) => p.split(/[:=]/)[0].trim()).filter(Boolean);
    const name = m[1] ? `関数 ${m[1]} を` : "名前のない関数を";
    return params.length ? `${name}定義します（受け取るもの：${cut(params.join("、"), 30)}）` : `${name}定義します`;
  }
  if ((m = /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(?([^)=]*)\)?\s*=>/.exec(s))) {
    const params = splitArgs(m[2]).map((p) => p.split(/[:=]/)[0].trim()).filter(Boolean);
    return params.length ? `関数 ${m[1]} を定義します（受け取るもの：${cut(params.join("、"), 30)}）` : `関数 ${m[1]} を定義します`;
  }
  if ((m = /^(?:export\s+)?(?:default\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?/.exec(s))) return m[2] ? `${m[2]} をもとにしたクラス ${m[1]} を定義します` : `クラス ${m[1]} を定義します`;
  if ((m = /^for\s*\(\s*(?:let|var)?\s*(\w+)\s*=\s*(\S+?)\s*;\s*\1\s*(<=?)\s*(.+?)\s*;\s*\1(\+\+|\s*\+=\s*1)\s*\)/.exec(s))) {
    const end = m[3] === "<=" ? m[4] : /^\d+$/.test(m[4]) ? String(Number(m[4]) - 1) : `${m[4]}−1`;
    return `${m[1]} を ${m[2]} から ${cut(end, 16)} まで変えながら繰り返します`;
  }
  if ((m = /^for\s*\(\s*(?:const|let|var)\s+(.+?)\s+of\s+(.+?)\s*\)/.exec(s))) return `${cut(m[2])} の中身を 1 つずつ ${m[1]} に入れて繰り返します`;
  if ((m = /^for\s*\(\s*(?:const|let|var)\s+(.+?)\s+in\s+(.+?)\s*\)/.exec(s))) return `${cut(m[2])} の項目名を 1 つずつ ${m[1]} に入れて繰り返します`;
  if (/^while\s*\(\s*true\s*\)/.test(s)) return "ずっと繰り返します（break で抜けます）";
  if ((m = /^while\s*\((.+)\)\s*\{?$/.exec(s))) return `${cut(m[1])} のあいだ繰り返します`;
  if ((m = /^\}?\s*else\s+if\s*\((.+)\)\s*\{?$/.exec(s))) return `そうでなく、もし ${cut(m[1], 30)} なら`;
  if ((m = /^if\s*\((.+)\)\s*\{?$/.exec(s))) return `もし ${cut(m[1], 30)} なら`;
  if (/^\}?\s*else\s*\{?$/.test(s)) return "そうでなければ";
  if (/^try\s*\{?$/.test(s)) return "エラーが起きるかもしれない処理を試します";
  if (/^\}?\s*catch\s*(\(.*\))?\s*\{?$/.test(s)) return "エラーが起きたら";
  if (/^\}?\s*finally\s*\{?$/.test(s)) return "最後に必ず行う処理";
  if (/^return$/.test(s)) return "関数を終わります";
  if ((m = /^return\s+(.+)$/.exec(s))) return `${cut(m[1])} を返します`;
  if (/^break$/.test(s)) return "繰り返しを抜けます";
  if (/^continue$/.test(s)) return "次の繰り返しへ進みます";
  if ((m = /^console\.(log|info|warn|error)\((.*)\)$/.exec(s))) {
    const d = describeShown(splitArgs(m[2]));
    return m[1] === "error" ? d.replace("表示します", "エラーとして表示します") : m[1] === "warn" ? d.replace("表示します", "注意として表示します") : d;
  }
  if ((m = /^alert\((.*)\)$/.exec(s))) return describeShown(splitArgs(m[1])).replace("表示します", "画面に知らせます");
  if ((m = /^([\w.[\]]+)\.push\((.+)\)$/.exec(s))) return `${m[1]} の最後に ${cut(m[2], 16)} を追加します`;
  if ((m = /^([\w.[\]]+)\.forEach\(/.exec(s))) return `${m[1]} の中身を 1 つずつ処理します`;
  if ((m = /^document\.getElementById\(["'](.+)["']\)/.exec(s))) return `id が ${m[1]} の部品を探します`;
  if ((m = /^([\w.]+)\.addEventListener\(["'](\w+)["']/.exec(s))) return `${m[1]} で ${m[2]} が起きたときの処理を登録します`;
  if ((m = /^await\s+(.+)$/.exec(s))) return `${cut(m[1])} が終わるのを待ちます`;
  return assignment(s.replace(/^(?:export\s+)?(?:const|let|var)\s+/, (k) => (k.includes("const") ? "const " : "let ")), "js");
}

// ───────── C・C++・Java・Rust・Go など（表示と、よくある制御だけ）

function cLike(line: string): string | null {
  const s = line.trim().replace(/;$/, "");
  let m: RegExpExecArray | null;
  if ((m = /^(?:printf|puts)\((.*)\)$/.exec(s))) {
    const args = splitArgs(m[1]);
    const lit = stringLiteral(args[0] ?? "");
    return lit !== null ? `「${cut(lit.replace(/%\w/g, "〔値〕"), 30)}」と表示します` : describeShown(args);
  }
  if ((m = /^System\.out\.print(?:ln)?\((.*)\)$/.exec(s))) return describeShown(splitArgs(m[1]));
  if ((m = /^Console\.Write(?:Line)?\((.*)\)$/.exec(s))) return describeShown(splitArgs(m[1]));
  if ((m = /^(?:println|print)!\((.*)\)$/.exec(s))) {
    const args = splitArgs(m[1]);
    const lit = stringLiteral(args[0] ?? "");
    return lit !== null ? `「${cut(lit.replace(/\{[^}]*\}/g, "〔値〕"), 30)}」と表示します` : null;
  }
  if ((m = /^fmt\.Print(?:ln|f)?\((.*)\)$/.exec(s))) return describeShown(splitArgs(m[1]));
  if ((m = /^(?:std::)?cout\s*<<\s*(.+)$/.exec(s))) {
    const parts = m[1].split("<<").map((p) => p.trim()).filter((p) => !/^(std::)?endl$/.test(p));
    return describeShown(parts);
  }
  if ((m = /^#include\s*[<"](.+)[>"]/.exec(s))) return `${m[1]} を読み込みます`;
  if ((m = /^use\s+(.+)$/.exec(s))) return `${m[1]} を使えるようにします`;
  if ((m = /^import\s+(.+)$/.exec(s))) return `${m[1].replace(/["'()]/g, "").trim()} を読み込みます`;
  if ((m = /^for\s*\(\s*(?:int|let|var|auto|size_t)?\s*(\w+)\s*=\s*(\S+?)\s*;\s*\1\s*(<=?)\s*(.+?)\s*;\s*(?:\1\+\+|\+\+\1)\s*\)/.exec(s))) {
    const end = m[3] === "<=" ? m[4] : /^\d+$/.test(m[4]) ? String(Number(m[4]) - 1) : `${m[4]}−1`;
    return `${m[1]} を ${m[2]} から ${cut(end, 16)} まで変えながら繰り返します`;
  }
  if ((m = /^for\s+(\w+)\s+in\s+(\d+)\.\.(=?)(\w+)\s*\{?$/.exec(s))) return `${m[1]} を ${m[2]} から ${m[3] ? m[4] : /^\d+$/.test(m[4]) ? Number(m[4]) - 1 : m[4] + "−1"} まで変えながら繰り返します`;
  if ((m = /^for\s+(\w+)\s*:=\s*(\S+?)\s*;\s*\1\s*(<=?)\s*(.+?)\s*;\s*\1\+\+\s*\{?$/.exec(s))) {
    const end = m[3] === "<=" ? m[4] : /^\d+$/.test(m[4]) ? String(Number(m[4]) - 1) : `${m[4]}−1`;
    return `${m[1]} を ${m[2]} から ${cut(end, 16)} まで変えながら繰り返します`;
  }
  if ((m = /^for\s+(\w+)\s*,\s*(\w+)\s*:=\s*range\s+(.+?)\s*\{?$/.exec(s))) return m[1] === "_" ? `${cut(m[3])} の中身を 1 つずつ ${m[2]} に入れて繰り返します` : `${cut(m[3])} の中身を、番号 ${m[1]} と一緒に 1 つずつ ${m[2]} に入れて繰り返します`;
  if ((m = /^for\s+(\w+)\s*:=\s*range\s+(.+?)\s*\{?$/.exec(s))) return `${cut(m[2])} の番号を 1 つずつ ${m[1]} に入れて繰り返します`;
  if (/^for\s*\{?$/.test(s)) return "ずっと繰り返します（break で抜けます）";
  if ((m = /^for\s+(.+?)\s*\{$/.exec(s)) && !s.includes(";")) return `${cut(m[1])} のあいだ繰り返します`;
  if ((m = /^package\s+(\w+)$/.exec(s))) return m[1] === "main" ? "実行できるプログラム（main パッケージ）です" : `${m[1]} パッケージです`;
  if ((m = /^(?:var\s+)?(\w+(?:\s*,\s*\w+)*)\s*:=\s*(.+)$/.exec(s))) return assignment(`${m[1]} = ${m[2]}`, "c");
  if ((m = /^let\s+(?:mut\s+)?(\w+)\s*(?::\s*[^=]+)?=\s*(.+)$/.exec(s))) return assignment(`${m[1]} = ${m[2]}`, "c");
  if ((m = /^\}?\s*else\s+if\s*\(?(.+?)\)?\s*\{?$/.exec(s))) return `そうでなく、もし ${cut(m[1], 30)} なら`;
  if ((m = /^if\s*\(?(.+?)\)?\s*\{?$/.exec(s))) return `もし ${cut(m[1], 30)} なら`;
  if (/^\}?\s*else\s*\{?$/.test(s)) return "そうでなければ";
  if (/^(while\s*\(\s*(true|1)\s*\)|loop)\s*\{?$/.test(s)) return "ずっと繰り返します（break で抜けます）";
  if ((m = /^while\s*\(?(.+?)\)?\s*\{?$/.exec(s))) return `${cut(m[1])} のあいだ繰り返します`;
  if (/^return$/.test(s)) return "関数を終わります";
  if ((m = /^return\s+(.+)$/.exec(s))) return `${cut(m[1])} を返します`;
  if (/^break$/.test(s)) return "繰り返しを抜けます";
  if (/^continue$/.test(s)) return "次の繰り返しへ進みます";
  if ((m = /^(?:pub\s+)?fn\s+(\w+)\s*\(/.exec(s))) return m[1] === "main" ? "プログラムの入口（最初に動く関数）を定義します" : `関数 ${m[1]} を定義します`;
  if ((m = /^func\s+(\w+)\s*\(/.exec(s))) return m[1] === "main" ? "プログラムの入口（最初に動く関数）を定義します" : `関数 ${m[1]} を定義します`;
  if (/^(public\s+)?static\s+void\s+main\s*\(/.test(s) || /^int\s+main\s*\(/.test(s)) return "プログラムの入口（最初に動く関数）を定義します";
  return null;
}

// ───────── Ruby

function ruby(line: string): string | null {
  const s = line.trim();
  let m: RegExpExecArray | null;
  if ((m = /^(puts|print|p)\s*\(?(.*?)\)?$/.exec(s)) && m[2]) return describeShown(splitArgs(m[2]));
  if ((m = /^require(?:_relative)?\s+["'](.+)["']$/.exec(s))) return `${m[1]} を読み込みます`;
  if ((m = /^def\s+(\w+[?!]?)\s*(\((.*)\))?/.exec(s))) return m[3] ? `関数 ${m[1]} を定義します（受け取るもの：${cut(m[3], 30)}）` : `関数 ${m[1]} を定義します`;
  if ((m = /^class\s+(\w+)(?:\s*<\s*(\w+))?/.exec(s))) return m[2] ? `${m[2]} をもとにしたクラス ${m[1]} を定義します` : `クラス ${m[1]} を定義します`;
  if ((m = /^(.+?)\.each\s*(?:do|\{)\s*\|(\w+)\|/.exec(s))) return `${cut(m[1])} の中身を 1 つずつ ${m[2]} に入れて繰り返します`;
  if ((m = /^(\d+)\.times\s*(?:do|\{)/.exec(s))) return `${m[1]} 回繰り返します`;
  if ((m = /^if\s+(.+)$/.exec(s))) return `もし ${cut(m[1], 30)} なら`;
  if ((m = /^elsif\s+(.+)$/.exec(s))) return `そうでなく、もし ${cut(m[1], 30)} なら`;
  if (/^else$/.test(s)) return "そうでなければ";
  if (/^end$/.test(s)) return null;
  if ((m = /^(\w+)\s*=\s*gets(\.chomp)?(\.to_i)?$/.exec(s))) return m[3] ? `入力された整数を ${m[1]} に入れます` : `入力された文字を ${m[1]} に入れます`;
  return assignment(s, "other");
}

// ───────── シェル・バッチ

function shell(line: string): string | null {
  const s = line.trim();
  let m: RegExpExecArray | null;
  if ((m = /^(?:echo|Write-Host|Write-Output)\s+(.*)$/i.exec(s))) {
    const lit = stringLiteral(m[1]);
    return `「${cut(lit ?? m[1], 30)}」と表示します`;
  }
  if ((m = /^cd\s+(.+)$/i.exec(s))) return `${cut(m[1])} に移動します`;
  if ((m = /^(?:mkdir|md)\s+(?:-p\s+)?(.+)$/i.exec(s))) return `フォルダ ${cut(m[1])} を作ります`;
  if ((m = /^(?:rm|del|Remove-Item)\s+(.+)$/i.exec(s))) return `${cut(m[1])} を削除します`;
  if ((m = /^(?:cp|copy|Copy-Item)\s+(.+)$/i.exec(s))) return `${cut(m[1])} をコピーします`;
  if ((m = /^(?:set\s+)?(\w+)=(.*)$/i.exec(s))) return `${m[1]} に ${cut(m[2] || "空", 16)} を入れます`;
  if ((m = /^if\s+(.+?)(?:;\s*then)?$/.exec(s))) return `もし ${cut(m[1], 30)} なら`;
  if ((m = /^for\s+(\w+)\s+in\s+(.+?)(?:;\s*do)?$/.exec(s))) return `${cut(m[2])} を 1 つずつ ${m[1]} に入れて繰り返します`;
  if (/^(fi|done|esac|end)$/.test(s)) return null;
  return null;
}

// ───────── 代入（言語共通）

function assignment(s: string, lang: ExplainLang): string | null {
  let m: RegExpExecArray | null;
  if ((m = /^(?:const |let )?([\w.[\]]+)\s*\+=\s*(.+)$/.exec(s))) return /^\d+$/.test(m[2]) ? `${m[1]} を ${m[2]} 増やします` : `${m[1]} に ${cut(m[2], 16)} を足します`;
  if ((m = /^(?:const |let )?([\w.[\]]+)\s*-=\s*(.+)$/.exec(s))) return `${m[1]} を ${cut(m[2], 16)} 減らします`;
  if ((m = /^(?:const |let )?([\w.[\]]+)\s*\*=\s*(.+)$/.exec(s))) return `${m[1]} を ${cut(m[2], 16)} 倍にします`;
  if ((m = /^([\w.[\]]+)(\+\+|--)$/.exec(s))) return m[2] === "++" ? `${m[1]} を 1 増やします` : `${m[1]} を 1 減らします`;
  m = /^(const |let )?([A-Za-z_][\w.]*(?:\[[^\]]+\])?(?:\s*,\s*[A-Za-z_]\w*)*)\s*(?::\s*[\w<>[\], ]+)?\s*=\s*(?!=)(.+)$/.exec(s);
  if (!m) return null;
  const target = m[2];
  const rhs = m[3].trim();
  const inp = inputDescription(rhs);
  if (inp) {
    const asked = inp.prompt ? `「${cut(inp.prompt, 20)}」と聞いて、` : "";
    return inp.asNumber ? `${asked}入力された${inp.asNumber}を ${target} に入れます` : `${asked}入力された文字を ${target} に入れます`;
  }
  const v = describeValue(rhs);
  if (v) return v.startsWith("空の") ? `${v} ${target} を作ります` : `${target} に ${v} を入れます`;
  let mm: RegExpExecArray | null;
  if ((mm = /^(.+)\.split\((.*)\)$/.exec(rhs))) {
    const sep = stringLiteral(mm[2] ?? "");
    return `${cut(mm[1], 14)} を${sep ? `「${sep}」` : "空白"}で区切って ${target} に入れます`;
  }
  if ((mm = /^len\((.+)\)$/.exec(rhs))) return `${mm[1]} の長さ（個数）を ${target} に入れます`;
  if ((mm = /^(sum|max|min|sorted)\((.+)\)$/.exec(rhs))) {
    const w = { sum: "合計", max: "いちばん大きい値", min: "いちばん小さい値", sorted: "小さい順に並べたもの" }[mm[1] as "sum"];
    return `${cut(mm[2], 14)} の${w}を ${target} に入れます`;
  }
  if ((mm = /^open\((.+)\)$/.exec(rhs))) return `ファイル ${cut(splitArgs(mm[1])[0], 20)} を開いて ${target} に入れます`;
  if ((mm = /^new\s+(\w+)\(/.exec(rhs))) return `新しい ${mm[1]} を作って ${target} に入れます`;
  if (lang === "python" && (mm = /^([A-Z]\w*)\(/.exec(rhs))) return `新しい ${mm[1]} を作って ${target} に入れます`;
  if ((mm = /^await\s+(.+)$/.exec(rhs))) return `${cut(mm[1], 18)} が終わるのを待って、結果を ${target} に入れます`;
  return `${target} に ${cut(rhs, 18)} の結果を入れます`;
}

/** 説明しない行（空行・コメント・かっこだけ・文字列の続き） */
export function isTrivial(line: string): boolean {
  const s = line.trim();
  return !s || /^(#|\/\/|\/\*|\*|<!--|--)/.test(s) || /^[)\]}>;,]+$/.test(s) || /^("""|''')/.test(s) || s.length > 220;
}

export function explainLine(line: string, lang: ExplainLang): string | null {
  if (isTrivial(line)) return null;
  // 行末のコメントは取り除いてから見る
  const code = line.replace(/\s+(#|\/\/)\s.*$/, "");
  if (lang === "python") return python(code);
  if (lang === "js") return js(code);
  if (lang === "c") return cLike(code);
  if (lang === "ruby") return ruby(code);
  if (lang === "shell") return shell(code);
  return null;
}
