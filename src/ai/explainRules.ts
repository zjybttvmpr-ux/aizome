// 1行のコードが何をするかを、日本語で短く説明する（AI を使わないルール。純粋関数）
// 対応：Python、JavaScript / TypeScript、よく使う C・C++・Java・Rust・Go の表示

import { asCondition, joinLambdas, describeExpr, describeStatement, importedMeaning, moduleMeaning, type ExprLang } from "./exprJa";

export type ExplainLang = "python" | "js" | "c" | "ruby" | "shell" | "other";

const exprLang = (l: ExplainLang): ExprLang | null => (l === "python" || l === "js" || l === "c" || l === "ruby" ? l : null);

/** 式の意味（名詞）。分からなければ null */
function nounOf(expr: string, lang: ExplainLang): string | null {
  const el = exprLang(lang);
  return el ? describeExpr(expr, el)?.noun ?? null : null;
}

/** 条件式を「〜なら」の前の部分にする（分からなければ式のまま） */
function cond(expr: string, lang: ExplainLang): string {
  const n = nounOf(expr, lang);
  return n ? asCondition(n) : cut(expr, 30) + " ";
}

/** 条件式を「」の中に入れる形に（「s が数字だけでできている」「x > 0」） */
export function condPhrase(expr: string, lang: ExplainLang): string {
  return cond(expr, lang).trim();
}

/** 「もし 〜なら」の 〜 の部分（式のままなら後ろに空白） */
export function condIf(expr: string, lang: ExplainLang): string {
  return cond(expr, lang);
}

function stmt(line: string, lang: ExplainLang): string | null {
  const el = exprLang(lang);
  return el ? describeStatement(line, el) : null;
}

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
  return joinLambdas(out);
}

/** 表示する中身の説明：「こんにちは」/ x の中身 / 文字と値 */
function describeShown(args: string[], lang: ExplainLang = "other"): string {
  const parts = args.filter((a) => !/^(sep|end|file|flush)\s*=/.test(a));
  const opt = args.filter((a) => /^(sep|end|file|flush)\s*=/.test(a)).map((a) => {
    const [k, v] = a.split(/=(.*)/s).map((x) => x.trim());
    const lit = stringLiteral(v);
    if (k === "end") return lit === "" ? "改行しない" : lit === "\\n" || lit === "（改行）" ? "" : `最後に「${lit ?? v}」を付ける`;
    if (k === "sep") return `区切りは「${lit ?? v}」`;
    if (k === "file") return `${v} に書き出す`;
    if (k === "flush") return "すぐに書き出す";
    return "";
  }).filter(Boolean);
  if (opt.length) {
    const base = describeShown(parts, lang);
    return `${base}（${opt.join("・")}）`;
  }
  if (!parts.length) return "空の行を表示します";
  if (parts.length === 1) {
    const a = parts[0];
    const lit = stringLiteral(a);
    if (lit !== null && !isTemplate(a)) return lit ? `「${cut(lit, 30)}」と表示します` : "空の行を表示します";
    if (isTemplate(a)) {
      const inner = a.replace(/^\s*f?(["'`])/, "").replace(/(["'`])\s*$/, "").replace(/\$?\{([^}]*)\}/g, "〔$1〕");
      return `「${cut(inner, 30)}」と表示します（〔 〕の所に値が入ります）`;
    }
    if (/^-?\d+(\.\d+)?$/.test(a)) return `${a} を表示します`;
    if (/^\*\w[\w.]*$/.test(a)) return `${a.slice(1)} の中身をばらして並べて表示します`;
    const n = nounOf(a, lang);
    if (n) return `${n}${/か$/.test(n) ? "どうか" : ""}を表示します`;
    if (/^[A-Za-z_][\w.]*$/.test(a)) return `${a} の中身を表示します`;
    if (/^len\([^()]*\)$/.test(a)) return `${a.slice(4, -1)} の長さ（個数）を表示します`;
    return `${cut(a)} の結果を表示します`;
  }
  const lits = parts.map((p) => stringLiteral(p));
  if (lits.every((l) => l !== null)) return `「${cut(lits.join(" "), 30)}」と表示します`;
  const shown = parts.map((p, i) => {
    if (lits[i] !== null) return `「${cut(lits[i]!, 12)}」`;
    const n = nounOf(p, lang);
    return n && n.length <= 24 ? `『${n}』` : cut(p, 12);
  });
  return `${shown.join("・")} を並べて表示します`;
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
  if (/^\[.*\]$/.test(t) && !/\sfor\s/.test(t)) return `リスト ${cut(t, 20)}`;
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

const DECORATORS: Record<string, string> = {
  property: "下の関数を、かっこなしで読める属性にします",
  staticmethod: "下の関数を、self を受け取らないメソッドにします",
  classmethod: "下の関数を、クラス（cls）を受け取るメソッドにします",
  dataclass: "下のクラスをデータ用のクラスにします（__init__ などを自動で作ります）",
  lru_cache: "下の関数の結果を覚えて、同じ引数なら計算を省きます",
  cache: "下の関数の結果を覚えて、同じ引数なら計算を省きます",
  wraps: "元の関数の名前や説明を引きつぎます",
  abstractmethod: "下の関数を、子クラスで必ず作るメソッドにします",
  override: "下の関数は親クラスのものを上書きします",
};

function decorator(name: string, args?: string): string {
  const base = name.split(".").pop()!;
  if (/\.setter$/.test(name)) return `下の関数を、属性 ${name.split(".")[0]} に代入したときの処理にします`;
  if (/^(app|router|bp)\.(route|get|post|put|delete)$/.test(name)) return `アドレス ${args ? cut(args, 20) : ""} に来たときに下の関数を動かします`;
  return DECORATORS[base] ?? `下の関数を ${name} で包みます（デコレーター）`;
}

const SPECIAL_DEFS: Record<string, string> = {
  __init__: "作るときに最初に動く処理", __str__: "print や str( ) したときの文字を決める処理", __repr__: "開発者向けの表し方（repr）を決める処理",
  __len__: "len( ) したときの長さを決める処理", __eq__: "== で比べたときの処理", __lt__: "< で比べたときの処理（並べかえにも使われる）",
  __add__: "+ で足したときの処理", __sub__: "- で引いたときの処理", __call__: "関数のように ( ) で呼んだときの処理",
  __iter__: "for で回したときの処理", __next__: "next( ) で次を取り出すときの処理", __getitem__: "[ ] で取り出すときの処理",
  __enter__: "with に入るときの処理", __exit__: "with から出るときの処理", __new__: "オブジェクトを作る前の処理",
};

/** def の行：引数の種類（省略時の値・*args・**kwargs・/ と *）と返すものの型まで説明する */
function pyDef(name: string, paramText: string, ret: string | undefined, isAsync: boolean, inlineBody?: string): string {
  const parts: string[] = [];
  const notes: string[] = [];
  for (const raw of splitArgs(paramText)) {
    const p = raw.trim();
    if (!p || p === "self" || p === "cls") continue;
    if (p === "/") {
      notes.push("/ より前は名前を付けずに順番で渡す");
      continue;
    }
    if (p === "*") {
      notes.push("* より後ろは名前を付けて渡す");
      continue;
    }
    const mm = /^(\*{0,2})(\w+)\s*(?::\s*([^=]+?))?\s*(?:=\s*(.+))?$/.exec(p);
    if (!mm) {
      parts.push(p);
      continue;
    }
    const [, star, pn, type, def] = mm;
    const info: string[] = [];
    if (star === "*") info.push("いくつでも・タプルで受け取る");
    if (star === "**") info.push("名前つきでいくつでも・辞書で受け取る");
    if (type) info.push(type.trim());
    if (def !== undefined) {
      info.push(`省略すると ${def.trim()}`);
      if (/^(\[\s*\]|\{\s*\}|list\(\)|dict\(\)|set\(\))$/.test(def.trim())) notes.push(`※ ${pn} の省略時の値 ${def.trim()} は呼ぶたびに同じものが使い回されます（None にして中で作るのが安全）`);
    }
    parts.push(`${star}${pn}${info.length ? `（${info.join("、")}）` : ""}`);
  }
  const special = SPECIAL_DEFS[name];
  const kind = special ? `${special}（${name}）を` : `${isAsync ? "非同期の" : ""}関数 ${name} を`;
  const extra = [parts.length ? `受け取るもの：${parts.join("、")}` : "", ret ? `返すもの：${ret.trim()}` : ""].filter(Boolean).join("／");
  let text = `${kind}定義します${extra ? `（${extra}）` : ""}`;
  if (notes.length) text += `　${notes.join("。")}`;
  if (inlineBody) text += `　中身：${python(inlineBody) ?? cut(inlineBody)}`;
  return text;
}

function returns(expr: string, lang: ExplainLang): string {
  if (/^None$/.test(expr.trim())) return "「何もない」という値（None）を返して関数を終わります";
  const many = splitArgs(expr);
  if (lang === "python" && many.length > 1 && !/^[[({]/.test(expr.trim())) {
    return `${many.map((x) => {
      const n = nounOf(x, lang);
      return n ? `『${n}』` : cut(x, 12);
    }).join(" と ")} をまとめて（タプルで）返します`;
  }
  const n = nounOf(expr, lang);
  return n ? `${n}を返します` : `${cut(expr)} を返します`;
}

function pyFromImport(mod: string, list: string): string {
  const names = list.replace(/[()]/g, "").split(",").map((x) => x.trim()).filter(Boolean);
  const modMean = moduleMeaning(mod, "python");
  if (names.length === 1 && names[0] === "*") return `${mod}${modMean ? `（${modMean}）` : ""} の中身を全部読み込みます`;
  const parts = names.map((n) => {
    const [name, alias] = n.split(/\s+as\s+/);
    const mean = importedMeaning(mod, name, "python");
    return `${name}${mean ? `（${mean}）` : ""}${alias ? ` を ${alias} という名前で` : ""}`;
  });
  const text = parts.join("・");
  if (text.length > 60) return `${mod} から ${cut(names.join("・"), 30)} を読み込みます`;
  return `${mod} から ${text} を読み込みます`;
}

// ───────── Python

function python(line: string): string | null {
  const s = line.trim();
  let m: RegExpExecArray | null;

  if (/^if\s+__name__\s*==\s*["']__main__["']\s*:/.test(s)) return "このファイルを直接実行したときだけ、下の処理を動かします";
  if ((m = /^from\s+([\w.]+)\s+import\s+(.+)$/.exec(s))) return pyFromImport(m[1], m[2]);
  if ((m = /^import\s+([\w.]+)\s+as\s+(\w+)$/.exec(s))) {
    const mean = moduleMeaning(m[1], "python");
    return `${m[1]}${mean ? `（${mean}）` : ""} を ${m[2]} という名前で読み込みます`;
  }
  if ((m = /^import\s+(.+)$/.exec(s))) {
    const mods = m[1].split(",").map((x) => x.trim());
    const one = mods.length === 1 ? moduleMeaning(mods[0], "python") : null;
    return `${mods.join("・")}${one ? `（${one}）` : ""} を読み込みます`;
  }
  if ((m = /^(async\s+)?def\s+(\w+)\s*\((.*)\)\s*(?:->\s*([^:]+?))?\s*:\s*(\S.*)?$/.exec(s))) return pyDef(m[2], m[3], m[4], !!m[1], m[5]);
  if ((m = /^class\s+(\w+)\s*(\((.*)\))?\s*:/.exec(s))) return m[3] ? `${m[3]} をもとにしたクラス ${m[1]} を定義します` : `クラス ${m[1]} を定義します`;
  if ((m = /^for\s+(.+?)\s+in\s+range\((.*)\)\s*:/.exec(s))) {
    const r = describeRange(splitArgs(m[2]));
    return r ? `${m[1]} を ${r}変えながら繰り返します` : `${m[1]} を数えながら繰り返します`;
  }
  if ((m = /^for\s+(.+?)\s+in\s+(.+?)\s*:/.exec(s)) && !/^enumerate\(/.test(m[2])) {
    const n = nounOf(m[2], "python");
    if (n) return `${n} の中身を 1 つずつ ${m[1]} に入れて繰り返します`;
  }
  if ((m = /^for\s+(.+?),\s*(.+?)\s+in\s+enumerate\((.+)\)\s*:/.exec(s))) return `${m[3]} の中身を、番号 ${m[1]} と一緒に 1 つずつ ${m[2]} に入れて繰り返します`;
  if ((m = /^for\s+(.+?)\s+in\s+(.+?)\s*:/.exec(s))) return `${cut(m[2])} の中身を 1 つずつ ${m[1]} に入れて繰り返します`;
  if (/^while\s+(True|1)\s*:/.test(s)) return "ずっと繰り返します（break で抜けます）";
  if ((m = /^while\s+(.+?)\s*:/.exec(s))) return `${cond(m[1], "python")}のあいだ繰り返します`;
  if ((m = /^if\s+(.+?)\s*:/.exec(s))) return `もし ${cond(m[1], "python")}なら`;
  if ((m = /^elif\s+(.+?)\s*:/.exec(s))) return `そうでなく、もし ${cond(m[1], "python")}なら`;
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
  if ((m = /^with\s+(.+?)\s+as\s+(\w+)\s*:/.exec(s))) {
    const n = nounOf(m[1], "python");
    return `${n ? n : cut(m[1], 20)} を ${m[2]} として使い、終わったら自動で片付けます`;
  }
  if ((m = /^with\s+(.+?)\s*:/.exec(s))) return `${cut(m[1], 20)} を使い、終わったら自動で片付けます`;
  if ((m = /^@([\w.]+)(\((.*)\))?\s*$/.exec(s))) return decorator(m[1], m[3]);
  if ((m = /^global\s+(.+)$/.exec(s))) return `${m[1]} は関数の外（全体）の変数を使います`;
  if ((m = /^nonlocal\s+(.+)$/.exec(s))) return `${m[1]} は 1 つ外側の関数の変数を使います`;
  if ((m = /^yield\s+from\s+(.+)$/.exec(s))) return `${cut(m[1])} の中身を 1 つずつ順に渡します`;
  if ((m = /^yield\s+(.+)$/.exec(s))) return `${nounOf(m[1], "python") ?? cut(m[1])} を 1 つ渡して、次に呼ばれるまで一時停止します`;
  if (/^yield$/.test(s)) return "ここで一時停止します";
  if ((m = /^raise\s+(\w+)(?:\((.*)\))?/.exec(s))) {
    const msg = m[2] ? stringLiteral(m[2]) : null;
    return `わざとエラー ${m[1]} を起こします${msg ? `（「${cut(msg, 20)}」）` : ""}`;
  }
  if (/^raise$/.test(s)) return "今のエラーをもう一度起こします";
  if ((m = /^del\s+(.+)$/.exec(s))) return `${cut(m[1])} を消します`;
  if ((m = /^assert\s+(.+?)(?:,\s*(.+))?$/.exec(s))) return `${condIf(m[1], "python")}であることを確かめます（違えばエラー）`;
  if ((m = /^match\s+(.+?)\s*:/.exec(s))) return `${cut(m[1])} の値によって分けます`;
  if (/^case\s+_\s*:/.test(s)) return "どれにも当てはまらないとき";
  if ((m = /^case\s+(.+?)\s*:/.exec(s))) return `${cut(m[1])} のとき`;
  if (/^return\s*$/.test(s)) return "関数を終わります";
  if ((m = /^return\s+(.+)$/.exec(s))) return returns(m[1], "python");
  if (/^break$/.test(s)) return "繰り返しを抜けます";
  if (/^continue$/.test(s)) return "次の繰り返しへ進みます";
  if (/^pass$/.test(s)) return "何もしません";
  if ((m = /^print\((.*)\)$/.exec(s))) return describeShown(splitArgs(m[1]), "python");
  if ((m = /^([\w.[\]]+)\.append\((.+)\)$/.exec(s))) return `${m[1]} の最後に ${cut(m[2], 16)} を追加します`;
  if ((m = /^([\w.[\]]+)\.extend\((.+)\)$/.exec(s))) return `${m[1]} の最後に ${cut(m[2], 16)} の中身をまとめて追加します`;
  if ((m = /^([\w.[\]]+)\.sort\((.*)\)$/.exec(s))) return /reverse\s*=\s*True/.test(m[2]) ? `${m[1]} を大きい順に並べ替えます` : `${m[1]} を小さい順に並べ替えます`;
  if ((m = /^([\w.[\]]+)\.remove\((.+)\)$/.exec(s))) return `${m[1]} から ${cut(m[2], 16)} を取り除きます`;
  if ((m = /^([\w.[\]]+)\.pop\((.*)\)$/.exec(s))) return m[2] ? `${m[1]} の ${m[2]} 番目を取り出します` : `${m[1]} の最後の 1 つを取り出します`;
  if ((m = /^([\w.]+)\.write\((.+)\)$/.exec(s))) return `${cut(m[2], 20)} をファイルに書き込みます`;
  if ((m = /^time\.sleep\((.+)\)$/.exec(s))) return `${m[1]} 秒待ちます`;
  return stmt(s, "python") ?? assignment(s, "python");
}

// ───────── JavaScript / TypeScript

function js(line: string): string | null {
  const s = line.trim().replace(/;$/, "");
  let m: RegExpExecArray | null;
  if ((m = /^import\s+(.+?)\s+from\s+["'](.+)["']$/.exec(s))) {
    const mean = moduleMeaning(m[2], "js");
    return `${m[2]}${mean ? `（${mean}）` : ""} から ${cut(m[1].replace(/[{}]/g, "").trim(), 24)} を読み込みます`;
  }
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
  if ((m = /^while\s*\((.+)\)\s*\{?$/.exec(s))) return `${cond(m[1], "js")}のあいだ繰り返します`;
  if ((m = /^\}?\s*else\s+if\s*\((.+)\)\s*\{?$/.exec(s))) return `そうでなく、もし ${cond(m[1], "js")}なら`;
  if ((m = /^if\s*\((.+)\)\s*\{?$/.exec(s))) return `もし ${cond(m[1], "js")}なら`;
  if (/^\}?\s*else\s*\{?$/.test(s)) return "そうでなければ";
  if (/^try\s*\{?$/.test(s)) return "エラーが起きるかもしれない処理を試します";
  if (/^\}?\s*catch\s*(\(.*\))?\s*\{?$/.test(s)) return "エラーが起きたら";
  if (/^\}?\s*finally\s*\{?$/.test(s)) return "最後に必ず行う処理";
  if (/^return$/.test(s)) return "関数を終わります";
  if ((m = /^return\s+(.+)$/.exec(s))) return returns(m[1], "js");
  if (/^break$/.test(s)) return "繰り返しを抜けます";
  if (/^continue$/.test(s)) return "次の繰り返しへ進みます";
  if ((m = /^console\.(log|info|warn|error)\((.*)\)$/.exec(s))) {
    const d = describeShown(splitArgs(m[2]), "js");
    return m[1] === "error" ? d.replace("表示します", "エラーとして表示します") : m[1] === "warn" ? d.replace("表示します", "注意として表示します") : d;
  }
  if ((m = /^alert\((.*)\)$/.exec(s))) return describeShown(splitArgs(m[1]), "js").replace("表示します", "画面に知らせます");
  if ((m = /^([\w.[\]]+)\.push\((.+)\)$/.exec(s))) return `${m[1]} の最後に ${cut(m[2], 16)} を追加します`;
  if ((m = /^([\w.[\]]+)\.forEach\(/.exec(s))) return `${m[1]} の中身を 1 つずつ処理します`;
  if ((m = /^document\.getElementById\(["'](.+)["']\)/.exec(s))) return `id が ${m[1]} の部品を探します`;
  if ((m = /^([\w.]+)\.addEventListener\(["'](\w+)["']/.exec(s))) return `${m[1]} で ${m[2]} が起きたときの処理を登録します`;
  if ((m = /^await\s+(.+)$/.exec(s))) return stmt(s, "js") ?? `${cut(m[1])} が終わるのを待ちます`;
  const st = stmt(s, "js");
  if (st) return st;
  return assignment(s.replace(/^(?:export\s+)?(?:const|let|var)\s+/, (k) => (k.includes("const") ? "const " : "let ")), "js");
}

// ───────── C・C++・Java・Rust・Go など（表示と、よくある制御だけ）

function cLike(line: string): string | null {
  const s = line.trim().replace(/;$/, "");
  let m: RegExpExecArray | null;
  if ((m = /^(?:printf|puts)\((.*)\)$/.exec(s))) {
    const args = splitArgs(m[1]);
    const lit = stringLiteral(args[0] ?? "");
    return lit !== null ? `「${cut(lit.replace(/%\w/g, "〔値〕"), 30)}」と表示します` : describeShown(args, "c");
  }
  if ((m = /^Debug\.Log(Warning|Error)?(?:Format)?\((.*)\)$/.exec(s))) {
    const d = describeShown(splitArgs(m[2]), "c");
    return d.replace("表示します", m[1] === "Error" ? "エラーとしてコンソールに表示します" : m[1] === "Warning" ? "注意としてコンソールに表示します" : "コンソールに表示します");
  }
  if ((m = /^(?:println|print)\((.*)\)$/.exec(s))) return describeShown(splitArgs(m[1]), "c");
  if ((m = /^(?:std::)?cin\s*>>\s*(.+)$/.exec(s))) return `入力を読み取って ${m[1].split(">>").map((x) => x.trim()).join("・")} に入れます`;
  if ((m = /^System\.out\.print(?:ln)?\((.*)\)$/.exec(s))) return describeShown(splitArgs(m[1]), "c");
  if ((m = /^Console\.Write(?:Line)?\((.*)\)$/.exec(s))) return describeShown(splitArgs(m[1]), "c");
  if ((m = /^(?:println|print)!\((.*)\)$/.exec(s))) {
    const args = splitArgs(m[1]);
    const lit = stringLiteral(args[0] ?? "");
    return lit !== null ? `「${cut(lit.replace(/\{[^}]*\}/g, "〔値〕"), 30)}」と表示します` : null;
  }
  if ((m = /^fmt\.Print(?:ln|f)?\((.*)\)$/.exec(s))) return describeShown(splitArgs(m[1]), "c");
  if ((m = /^(?:std::)?cout\s*<<\s*(.+)$/.exec(s))) {
    const parts = m[1].split("<<").map((p) => p.trim()).filter((p) => !/^(std::)?endl$/.test(p));
    return describeShown(parts, "c");
  }
  const withMean = (name: string) => {
    const mean = moduleMeaning(name, "c");
    return `${name}${mean ? `（${mean}）` : ""}`;
  };
  if ((m = /^#include\s*[<"](.+)[>"]/.exec(s))) return `${withMean(m[1])} を読み込みます`;
  if ((m = /^using\s+(?:static\s+)?([\w.]+)$/.exec(s))) return `${withMean(m[1])} を使えるようにします`;
  if ((m = /^using\s+namespace\s+(\w+)$/.exec(s))) return m[1] === "std" ? "std:: を書かずに標準の機能を使えるようにします" : `${m[1]} の名前を直接使えるようにします`;
  if ((m = /^use\s+(.+)$/.exec(s))) return `${withMean(m[1])} を使えるようにします`;
  if ((m = /^import\s+(.+)$/.exec(s))) return `${withMean(m[1].replace(/["'()]/g, "").replace(/^static\s+/, "").trim())} を読み込みます`;
  if ((m = /^(?:(?:public|private|protected|internal|abstract|sealed|static|partial|final|open|data)\s+)*class\s+(\w+)(?:<[^>]*>)?(?:\s*(?::|extends)\s*([\w.]+))?/.exec(s))) {
    if (m[2] === "MonoBehaviour") return `Unity のスクリプト（MonoBehaviour）としてクラス ${m[1]} を定義します`;
    if (m[2] === "ScriptableObject") return `Unity のデータ用の入れ物（ScriptableObject）としてクラス ${m[1]} を定義します`;
    return m[2] ? `${m[2]} をもとにしたクラス ${m[1]} を定義します` : `クラス ${m[1]} を定義します`;
  }
  if ((m = /^(?:(?:public|private|protected|internal|static|override|virtual|async|abstract|final|sealed|synchronized|inline|extern)\s+)*(?:[\w.]+(?:<[^()]*>)?(?:\[\])*\??\*?\s+)(\w+)\s*\(([^)]*)\)\s*(?:const\s*)?(?:throws\s+[\w,\s]+)?\{?$/.exec(s)) && !/^(return|new|else|if|while|for|switch|catch|using|await|throw|yield|case|delete|goto)\b/.test(s)) {
    const life = UNITY_EVENTS[m[1]];
    if (life) return `${life}（${m[1]}）を定義します`;
    if (m[1] === "main" || m[1] === "Main") return "プログラムの入口（最初に動く関数）を定義します";
    const params = splitArgs(m[2]).map((p) => p.trim().split(/\s+/).pop()!.replace(/[=].*$/, "")).filter(Boolean);
    return params.length ? `関数 ${m[1]} を定義します（受け取るもの：${cut(params.join("、"), 30)}）` : `関数 ${m[1]} を定義します`;
  }
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
  if ((m = /^\}?\s*else\s+if\s*\((.+)\)\s*\{?$/.exec(s)) || (m = /^\}?\s*else\s+if\s+(.+?)\s*\{?$/.exec(s))) return `そうでなく、もし ${cond(m[1], "c")}なら`;
  if ((m = /^if\s*\((.+)\)\s*\{?$/.exec(s)) || (m = /^if\s+(.+?)\s*\{?$/.exec(s))) return `もし ${cond(m[1], "c")}なら`;
  if (/^\}?\s*else\s*\{?$/.test(s)) return "そうでなければ";
  if (/^(while\s*\(\s*(true|1)\s*\)|loop)\s*\{?$/.test(s)) return "ずっと繰り返します（break で抜けます）";
  if ((m = /^while\s*\((.+)\)\s*\{?$/.exec(s)) || (m = /^while\s+(.+?)\s*\{?$/.exec(s))) return `${cond(m[1], "c")}のあいだ繰り返します`;
  if (/^return$/.test(s)) return "関数を終わります";
  if ((m = /^yield\s+return\s+(.+)$/.exec(s))) {
    const n = nounOf(m[1], "c");
    if (/^null$/.test(m[1])) return "次のフレームまで待ちます（コルーチン）";
    if (n && /待つ指示$/.test(n)) return n.replace(/待つ指示$/, "待ちます（コルーチン）");
    return n ? `${n}が終わるまで待ちます（コルーチン）` : `${cut(m[1])} を待ちます（コルーチン）`;
  }
  if ((m = /^return\s+(.+)$/.exec(s))) return returns(m[1], "c");
  if (/^break$/.test(s)) return "繰り返しを抜けます";
  if (/^continue$/.test(s)) return "次の繰り返しへ進みます";
  if ((m = /^(?:pub\s+)?fn\s+(\w+)\s*\(/.exec(s))) return m[1] === "main" ? "プログラムの入口（最初に動く関数）を定義します" : `関数 ${m[1]} を定義します`;
  if ((m = /^func\s+(\w+)\s*\(/.exec(s))) return m[1] === "main" ? "プログラムの入口（最初に動く関数）を定義します" : `関数 ${m[1]} を定義します`;
  if (/^(public\s+)?static\s+void\s+main\s*\(/.test(s) || /^int\s+main\s*\(/.test(s)) return "プログラムの入口（最初に動く関数）を定義します";
  const st = stmt(s, "c");
  if (st) return st;
  // 型つきの宣言：int x = 5 / float speed = Mathf.Sqrt(a) / var list = new List<int>() / val x = …
  if ((m = /^(?:(?:public|private|protected|internal|static|readonly|final|const|volatile|unsigned|signed|val|var|auto|let)\s+)*(?:[\w.]+(?:<[^=]*>)?(?:\[\])*\??\*?\s+)?\*?(\w+)\s*(?::\s*[\w<>?[\]., ]+)?\s*=\s*(?!=)(.+)$/.exec(s)) && !/^(return|if|while|for)\b/.test(s)) return assignment(`${m[1]} = ${m[2]}`, "c");
  return assignment(s, "c");
}

const UNITY_EVENTS: Record<string, string> = {
  Awake: "いちばん最初に 1 回だけ動く処理", Start: "最初のフレームの前に 1 回だけ動く処理", Update: "毎フレーム動く処理",
  FixedUpdate: "物理計算のたびに（一定間隔で）動く処理", LateUpdate: "毎フレーム、Update のあとに動く処理",
  OnEnable: "有効になったときに動く処理", OnDisable: "無効になったときに動く処理", OnDestroy: "消されるときに動く処理",
  OnCollisionEnter: "何かにぶつかったときの処理", OnCollisionStay: "何かにぶつかり続けているあいだの処理", OnCollisionExit: "ぶつかっていたものから離れたときの処理",
  OnTriggerEnter: "トリガーの範囲に入ったときの処理", OnTriggerStay: "トリガーの範囲にいるあいだの処理", OnTriggerExit: "トリガーの範囲から出たときの処理",
  OnCollisionEnter2D: "何かにぶつかったとき（2D）の処理", OnCollisionExit2D: "ぶつかっていたものから離れたとき（2D）の処理",
  OnTriggerEnter2D: "トリガーの範囲に入ったとき（2D）の処理", OnTriggerExit2D: "トリガーの範囲から出たとき（2D）の処理", OnTriggerStay2D: "トリガーの範囲にいるあいだ（2D）の処理",
  OnMouseDown: "このオブジェクトがクリックされたときの処理", OnMouseUp: "クリックが離されたときの処理", OnMouseEnter: "マウスが乗ったときの処理", OnMouseExit: "マウスが離れたときの処理",
  OnBecameVisible: "カメラに映ったときの処理", OnBecameInvisible: "カメラから見えなくなったときの処理", OnGUI: "画面に GUI を描く処理",
  OnApplicationQuit: "ゲームが終わるときの処理", OnValidate: "インスペクターで値が変わったときの処理", Reset: "コンポーネントを付けたとき（リセット時）の処理",
  OnDrawGizmos: "シーン画面に確認用の図形を描く処理",
};

// ───────── Ruby

function ruby(line: string): string | null {
  const s = line.trim();
  let m: RegExpExecArray | null;
  if ((m = /^(puts|print|p)\s*\(?(.*?)\)?$/.exec(s)) && m[2]) return describeShown(splitArgs(m[2]), "ruby");
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
  return stmt(s, "ruby") ?? assignment(s, "ruby");
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
  const r = assignmentRaw(s, lang);
  const t = /^(?:const |let )?([A-Za-z_]\w*(?:\s*,\s*\*?[A-Za-z_]\w*)+)\s*=(?!=)/.exec(s);
  if (r && t) return r.replace(`${t[1]} に `, `${t[1]} にそれぞれ（順に分けて）`);
  return r;
}

function assignmentRaw(s: string, lang: ExplainLang): string | null {
  let m: RegExpExecArray | null;
  const opnd = (e: string) => {
    const n = nounOf(e, lang);
    return n ? (n.includes("『") ? `${n} ` : `『${n}』`) : cut(e, 16);
  };
  if ((m = /^(?:const |let )?([\w.[\]]+)\s*\+=\s*(.+)$/.exec(s))) return /^\d+$/.test(m[2]) ? `${m[1]} を ${m[2]} 増やします` : `${m[1]} に ${opnd(m[2])}を足します`.replace("』を", "』を").replace(/ +を足します$/, "を足します");
  if ((m = /^(?:const |let )?([\w.[\]]+)\s*-=\s*(.+)$/.exec(s))) return `${m[1]} を ${opnd(m[2])} 減らします`;
  if ((m = /^(?:const |let )?([\w.[\]]+)\s*\*=\s*(.+)$/.exec(s))) return `${m[1]} を ${opnd(m[2])} 倍にします`;
  if ((m = /^(?:const |let )?([\w.[\]]+)\s*\/=\s*(.+)$/.exec(s))) return `${m[1]} を ${opnd(m[2])} で割ります`;
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
  const noun = nounOf(rhs, lang);
  if (noun) return /^空の/.test(noun) ? `${noun} ${target} を作ります` : `${target} に ${noun}を入れます`;
  let mm: RegExpExecArray | null;
  if ((mm = /^(.+)\.split\((.*)\)$/.exec(rhs))) {
    const sep = stringLiteral(mm[2] ?? "");
    return `${cut(mm[1], 14)} を${sep ? `「${sep}」` : "空白"}で区切って ${target} に入れます`;
  }
  if ((mm = /^len\(([^()]*)\)$/.exec(rhs))) return `${mm[1]} の長さ（個数）を ${target} に入れます`;
  if ((mm = /^(sum|max|min|sorted)\(([^()]*)\)$/.exec(rhs))) {
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
  return !s || /^(#(?!include|define|import|pragma|if|endif|region|endregion)|\/\/|\/\*|\*|<!--|--)/.test(s) || /^[)\]}>;,]+$/.test(s) || /^("""|''')/.test(s) || s.length > 220;
}

export function explainLine(line: string, lang: ExplainLang): string | null {
  const r = explainLineRaw(line, lang);
  // 「x > 0なら」「-xを」のように英数字のすぐ後ろに日本語が続くときは空白を入れる
  return r ? r.replace(/([A-Za-z0-9_)\]"'])(?=[をなとがでにのは])/g, "$1 ") : r;
}

function explainLineRaw(line: string, lang: ExplainLang): string | null {
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
