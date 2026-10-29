// 「値を見る」を Python 以外でも：コードの行のうしろに「変数の値を記録する 1 文」を足したコピーを作って実行し、
// 記録（ファイル）から、行ごとの変数の値（TraceResult）を作る。
// 行番号がずれないように、足すものは同じ行の中に書く（ヘルパーは最後か、最初の行の前に 1 行で）

import type { TraceRecord, TraceResult } from "./trace";

export type TraceLang = "js" | "ts" | "java" | "cs" | "c" | "cpp" | "go" | "rust" | "ruby" | "php" | "lua" | "kotlin" | "swift" | "dart";

export function traceLangOf(ext: string): TraceLang | null {
  const e = ext.toLowerCase();
  if ([".js", ".mjs", ".cjs"].includes(e)) return "js";
  if ([".ts", ".mts"].includes(e)) return "ts";
  if (e === ".java") return "java";
  if (e === ".cs") return "cs";
  if (e === ".c") return "c";
  if ([".cpp", ".cc", ".cxx"].includes(e)) return "cpp";
  if (e === ".go") return "go";
  if (e === ".rs") return "rust";
  if (e === ".rb") return "ruby";
  if (e === ".php") return "php";
  if (e === ".lua") return "lua";
  if (e === ".kts") return "kotlin";
  if (e === ".swift") return "swift";
  if (e === ".dart") return "dart";
  return null;
}

/** 記録の数の上限（ループが長くても重くならないように） */
const MAX_EVENTS = 50000;

// ───────── 行を読むための道具

/** 文字列・文字・コメントの外で、行末のコメントが始まる位置（なければ行の長さ） */
function codeEnd(line: string, lang: TraceLang): number {
  let q = "";
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === "\\") i++;
      else if (c === q) q = "";
      continue;
    }
    if (c === '"' || c === "'" || (c === "`" && (lang === "js" || lang === "ts" || lang === "go"))) {
      // Rust のライフタイム 'a や、文字 'x' は文字列として扱わない（'a の後ろに ' がないとき）
      if (c === "'" && lang === "rust" && !/^'(\\.|[^'\\])'/.test(line.slice(i))) continue;
      q = c;
      continue;
    }
    if ((lang === "ruby" || lang === "php") && c === "#") return i;
    if (lang === "lua" && line.startsWith("--", i)) return i;
    if (lang !== "ruby" && lang !== "lua" && line.startsWith("//", i)) return i;
    if (line.startsWith("/*", i) && lang !== "ruby" && lang !== "lua") return i;
  }
  return line.length;
}

/** かっこの深さの増減（文字列の中は数えない） */
function depthDelta(code: string): number {
  let d = 0;
  let q = "";
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    if (q) {
      if (c === "\\") i++;
      else if (c === q) q = "";
      continue;
    }
    if (c === '"' || c === "`") q = c;
    else if (c === "'" && /^'(\\.|[^'\\])'/.test(code.slice(i))) i += code.slice(i).match(/^'(\\.|[^'\\])'/)![0].length - 1;
    else if (c === "'") q = c;
    else if ("([".includes(c)) d++;
    else if (")]".includes(c)) d--;
  }
  return d;
}

/** トップレベルのカンマで分ける */
function splitTop(s: string): string[] {
  const out: string[] = [];
  let d = 0;
  let q = "";
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      cur += c;
      if (c === "\\") cur += s[++i] ?? "";
      else if (c === q) q = "";
      continue;
    }
    if (c === '"' || c === "'" || c === "`") q = c;
    else if ("([{<".includes(c)) d++;
    else if (")]}>".includes(c)) d--;
    else if (c === "," && d <= 0) {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const NOT_TYPES = /^(return|throw|delete|goto|case|default|else|new|await|yield|break|continue|using|import|package|typedef|struct|enum|class|union|namespace|public|private|protected|if|for|while|switch|do|try|catch|finally|echo|print|printf|puts|go|defer|select|lock|fixed|unsafe|sizeof|typeof|nameof|var\s*\()$/;
const TYPE_BLOCK = /^\s*(?:(?:public|private|protected|internal|static|abstract|final|sealed|partial|export|default|data|open|inner|readonly|unsafe|pub(?:\([\w:]+\))?)\s+)*(class|interface|enum|struct|record|namespace|impl|trait|mod|object|union|extern\s+"C"|type\s+\w+\s+(struct|interface))\b/;
const CODE_BLOCK =
  /(^\s*(\}\s*)?(if|else|for|foreach|while|do|switch|try|catch|finally|loop|match|func|fn|unsafe|using|lock|synchronized|checked|get|set|init|static|defer|go)\b.*\{\s*$)|(\)\s*(const\s*)?(noexcept\s*)?(override\s*)?(throws\s+[\w.,\s]+)?(->\s*[^{]+)?(where\s+[^{]+)?\{\s*$)|(=>\s*\{\s*$)|(->\s*\{\s*$)|(^\s*\{\s*$)/;

interface Insert {
  /** 0 始まりの行 */
  line: number;
  /** 行の中の、足す位置（文字の位置。null なら行のコードの終わり） */
  at: number | null;
  names: string[];
  /** 記録に使う行番号（1 始まり） */
  as: number;
}

// ───────── 代入している名前を探す

function identList(s: string, lang: TraceLang): string[] {
  const id = lang === "php" ? /^\$[A-Za-z_]\w*$/ : lang === "ruby" ? /^[@$]{0,2}[A-Za-z_]\w*$/ : /^[A-Za-z_$][\w$]*$/;
  return s
    .replace(/^[([{]|[)\]}]$/g, "")
    .split(",")
    .map((x) => x.trim().replace(/^(mut|ref|var|let|const|val)\s+/, "").replace(/\s*:.*$/, "").replace(/^&\s*/, ""))
    .filter((x) => id.test(x) && x !== "_" && !/^(true|false|null|nil|None|undefined|this|self)$/.test(x));
}

/** 文（1 行で終わるもの）が値を入れている名前 */
function targetsOf(s: string, lang: TraceLang, cTypes: Map<string, string>): string[] {
  let m: RegExpExecArray | null;
  const t = s.replace(/;\s*$/, "").trim();
  if (!t) return [];
  // ++x / x++
  if ((m = /^(?:\+\+|--)?\s*([A-Za-z_$][\w$.]*(?:->\w+)?)\s*(?:\+\+|--)?$/.exec(t)) && /\+\+|--/.test(t)) return [m[1]];
  switch (lang) {
    case "js":
    case "ts":
      if ((m = /^(?:export\s+)?(?:let|var|const|using)\s+(.+)$/.exec(t))) {
        const out: string[] = [];
        for (const d of splitTop(m[1])) {
          const lhs = d.split(/=(?!=|>)/)[0].trim();
          if (!d.includes("=")) continue;
          if (/^[[{]/.test(lhs)) out.push(...identList(lhs.replace(/\.\.\./g, ""), lang).map((x) => x.split(":").pop()!.trim()));
          else out.push(lhs.replace(/[!?]?\s*:.*$/, "").trim());
        }
        return out.filter((x) => /^[A-Za-z_$][\w$]*$/.test(x));
      }
      break;
    case "rust":
      if ((m = /^let\s+(?:mut\s+)?(\(?[^=:]+?\)?)\s*(?::[^=]+)?=\s*(.+)$/.exec(t))) {
        // クロージャ（|x| …）は値を出せないので記録しない
        if (/^(move\s*)?\|/.test(m[2].trim())) return [];
        return identList(m[1], lang);
      }
      break;
    case "go":
      if ((m = /^([\w\s,]+?)\s*:=\s*(.+)$/.exec(t)) && !/^(if|for|switch|select|go|defer)\b/.test(t)) return identList(m[1], lang);
      if ((m = /^var\s+([\w\s,]+?)(?:\s+[\w.*[\]]+)?\s*=\s*.+$/.exec(t))) return identList(m[1], lang);
      break;
    case "kotlin":
    case "swift":
      if ((m = /^(?:val|var|let)\s+(\(?[\w\s,]+\)?)\s*(?::[^=]+)?=\s*.+$/.exec(t))) return identList(m[1], lang);
      break;
    case "lua":
      if ((m = /^local\s+([\w\s,]+?)\s*=\s*.+$/.exec(t)) && !/^local\s+function\b/.test(t)) return identList(m[1], lang);
      break;
    case "php":
      if ((m = /^(\$[A-Za-z_]\w*)(?:\[[^\]]*\])*\s*(?:\.=|\+=|-=|\*=|\/=|%=|\?\?=|=)(?!=|>)/.exec(t))) return [m[1]];
      if ((m = /^\[([^\]]+)\]\s*=(?!=)/.exec(t)) || (m = /^list\(([^)]+)\)\s*=(?!=)/.exec(t))) return identList(m[1], lang);
      return [];
    case "ruby":
      if ((m = /^([@$]{0,2}[A-Za-z_]\w*(?:\s*,\s*[@$]{0,2}[A-Za-z_]\w*)+)\s*=(?!=|~|>)/.exec(t))) return identList(m[1], lang);
      break;
    default:
      break;
  }
  // 型つきの宣言（Java・C#・C・C++・Dart）：int a = 1, b = 2; / List<int> xs = new(); / auto x{3};
  if (lang === "java" || lang === "cs" || lang === "c" || lang === "cpp" || lang === "dart") {
    m = /^(?:(?:final|const|static|readonly|volatile|register|constexpr|unsigned|signed|late|var|auto|ref|scoped)\s+)*((?:[A-Za-z_][\w.:]*)(?:\s*<[^;=()]*>)?(?:\s*\[\s*\])*(?:\s*[*&?]+)?)\s+(\**\s*[A-Za-z_]\w*\s*(?:\[[^\]]*\])*\s*(?:(?:=|\{|\().*|(?:,\s*\**\s*[A-Za-z_]\w*\s*(?:\[[^\]]*\])*)*))$/.exec(t);
    if (m && !NOT_TYPES.test(m[1].split(/\s/)[0]) && !/^[A-Z_]+$/.test(m[1]) || (m && /^(var|auto|let|final|const)$/.test(m[1]))) {
      const type = m[1].trim();
      const out: string[] = [];
      for (const d of splitTop(m[2])) {
        const mm = /^\**\s*([A-Za-z_]\w*)\s*(\[[^\]]*\])*\s*(=|\{|\()/.exec(d);
        if (!mm) {
          // 値を入れない宣言（double avg;）も、C では型を覚えておく（あとの代入で使う）
          const bare = /^(\**)\s*([A-Za-z_]\w*)\s*(\[[^\]]*\])*$/.exec(d);
          if (bare && lang === "c") cTypes.set(bare[2], (type + bare[1] + (bare[3] ? "[]" : "")).replace(/\s+/g, " "));
          continue;
        }
        // C++ の Foo x(…) は関数の宣言とまぎらわしいので、= か { のときだけ
        if (mm[3] === "(" && lang !== "cpp") continue;
        if (mm[3] === "(" && /^\(\s*\)$/.test(d.slice(d.indexOf("(")))) continue;
        out.push(mm[1]);
        if (lang === "c") cTypes.set(mm[1], (type + (d.trim().startsWith("*") ? "*" : "") + (mm[2] ? "[]" : "")).replace(/\s+/g, " "));
      }
      if (out.length) return out;
    }
  }
  // 中身を変えるメソッド（xs.add(…)・a.push(…)・v.push_back(…) など）は、その変数を記録
  if ((m = /^([A-Za-z_$][\w$]*)\s*(?:\.|->)\s*(add|addAll|push|push_back|emplace_back|append|extend|insert|put|putAll|remove|removeAt|pop|pop_back|shift|unshift|splice|sort|reverse|clear|Add|AddRange|Insert|Remove|RemoveAt|Clear|Sort|Reverse|Push|Pop|Enqueue|Dequeue|set|delete|truncate|retain|dedup|swap|fill)\s*\(.*\)$/.exec(t)) && lang !== "c") {
    if (lang === "rust" && !/^(push|pop|insert|remove|sort|reverse|clear|extend|append|truncate|retain|dedup|swap|fill)$/.test(m[2])) return [];
    return [m[1]];
  }
  // ふつうの代入：x = …・x += …・a[i] = …・obj.x = …・a, b = …
  const assign = lang === "ruby" || lang === "lua" || lang === "go" || lang === "kotlin" || lang === "swift" || lang === "rust";
  if ((m = /^([A-Za-z_$][\w$]*(?:(?:\.|->)[A-Za-z_]\w*)*)\s*(?:\[[^\]]*\])*\s*(=|\+=|-=|\*=|\/=|%=|\*\*=|&=|\|=|\^=|<<=|>>=|\?\?=|\|\|=|&&=)(?!=|>|~)/.exec(t))) {
    const name = m[1];
    if (/^(if|while|elsif|unless|until|return|local|let|val|var|const)$/.test(name)) return [];
    // C は型がわかる名前だけ（構造体などは printf で出せない）
    if (lang === "c" && !cTypes.has(name)) return [];
    if (lang === "c" && /\[\]$/.test(cTypes.get(name)!) && !/char/.test(cTypes.get(name)!)) return [];
    return [name];
  }
  if (assign && (m = /^([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)+)\s*=(?!=)/.exec(t))) return identList(m[1], lang);
  return [];
}

/** ループの変数（for (int i = 0; …) {・for x in xs {・foreach (var x in xs) …） */
function loopVars(s: string, lang: TraceLang): string[] | null {
  let m: RegExpExecArray | null;
  const t = s.trim();
  if (lang === "ruby") {
    if ((m = /\b(?:do|\{)\s*\|([^|]+)\|\s*$/.exec(t))) return identList(m[1], lang);
    if ((m = /^for\s+([\w\s,]+?)\s+in\s+.+?(\s+do)?$/.exec(t))) return identList(m[1], lang);
    return null;
  }
  if (lang === "lua") {
    if ((m = /^for\s+([\w\s,]+?)\s*(?:=|\bin\b).+\bdo$/.exec(t))) return identList(m[1], lang);
    return null;
  }
  if (lang === "php") {
    if ((m = /^foreach\s*\(.+?\s+as\s+(\$\w+)(?:\s*=>\s*(\$\w+))?\s*\)/.exec(t))) return [m[1], m[2]].filter(Boolean);
    if ((m = /^for\s*\(\s*(\$\w+)\s*=/.exec(t))) return [m[1]];
    return null;
  }
  if (lang === "go") {
    if ((m = /^for\s+([\w\s,]+?)\s*:=\s*(?:range\b|.+;)/.exec(t))) return identList(m[1], lang);
    return null;
  }
  if (lang === "rust" || lang === "swift") {
    if ((m = /^for\s+(\(?[\w\s,&]+\)?)\s+in\s+/.exec(t))) return identList(m[1].replace(/&/g, ""), lang);
    return null;
  }
  if (lang === "kotlin") {
    if ((m = /^for\s*\(\s*(\(?[\w\s,]+\)?)\s+in\s+/.exec(t))) return identList(m[1], lang);
    return null;
  }
  // C 系：for (int i = 0; …) / for (const x of xs) / for (Type x : xs) / foreach (var x in xs)
  // C++ の for (auto& [k, v] : m) ・JS の for (const [a, b] of …)
  if ((m = /^for\s*\(\s*(?:const\s+|let\s+|var\s+)?(?:auto\s*[&*]*\s*)?\[([^\]]+)\]\s*(?::(?!:)|\bof\b|\bin\b)/.exec(t))) return identList(m[1], lang);
  if ((m = /^(?:for|foreach)\s*\(\s*(.+?)\s*(?:;|:(?!:)|\bof\b|\bin\b)/.exec(t))) {
    const init = m[1].replace(/^(?:const|let|var|auto|final|int|long|short|char|float|double|size_t|unsigned\s+\w+|[\w.:<>[\]]+)\s*[&*]*\s+(?=[A-Za-z_$\[{(])/, "");
    const names = identList(init.split("=")[0].replace(/^\(|\)$/g, ""), lang);
    if (/^\[/.test(init.trim())) return identList(init.split("=")[0].trim().slice(1, -1), lang);
    return names.length ? names : null;
  }
  return null;
}

// ───────── 言語ごとの、記録の文とヘルパー

function strLit(s: string): string {
  return s.replace(/\\/g, "/").replace(/"/g, '\\"');
}

function callFor(lang: TraceLang, line: number, name: string): string {
  const n = name.replace(/"/g, "");
  switch (lang) {
    case "java":
      return `__Aiz.log(${line}, "${n}", ${name})`;
    case "cs":
      return `__Aiz.Log(${line}, "${n}", ${name})`;
    case "rust":
      return `__aiz(${line}, "${n}", &${name})`;
    case "php":
      return `__aiz(${line}, '${n}', ${name})`;
    default:
      return `__aiz(${line}, "${n}", ${name})`;
  }
}

function helper(lang: TraceLang, log: string, fileName: string): { head?: string; tail?: string; firstLine?: string } {
  const P = strLit(log);
  switch (lang) {
    case "js":
    case "ts": {
      const a = lang === "ts" ? ": any" : "";
      return {
        tail: `\nfunction __aiz(l${a}, n${a}, v${a}) { try { const g${a} = globalThis; g.__azc = (g.__azc || 0) + 1; if (g.__azc > ${MAX_EVENTS}) return; const req${a} = (g.process && g.process.getBuiltinModule) ? g.process.getBuiltinModule : (typeof require === "function" ? require : null); if (!req) return; const fs${a} = req("fs"), util${a} = req("util"); const s = typeof v === "string" ? JSON.stringify(v) : util.inspect(v, { depth: 2, breakLength: Infinity, maxArrayLength: 30, maxStringLength: 200 }); fs.appendFileSync("${P}", l + "\\t" + n + "\\t" + s.replace(/\\n/g, " ") + "\\n"); } catch (e) {} }\n`,
      };
    }
    case "java":
      return {
        tail: `\nclass __Aiz { static int c = 0; static void log(int l, String n, Object v) { if (++c > ${MAX_EVENTS}) return; try (java.io.FileWriter w = new java.io.FileWriter("${P}", java.nio.charset.StandardCharsets.UTF_8, true)) { w.write(l + "\\t" + n + "\\t" + fmt(v).replace("\\n", " ") + "\\n"); } catch (Exception e) {} } static String fmt(Object v) { if (v == null) return "null"; if (v instanceof String) return "\\"" + v + "\\""; if (v instanceof Character) return "'" + v + "'"; if (v.getClass().isArray()) { String s = java.util.Arrays.deepToString(new Object[] { v }); return s.substring(1, s.length() - 1); } return String.valueOf(v); } }\n`,
      };
    case "cs":
      return {
        tail: `\nstatic class __Aiz { static int c = 0; public static void Log(int l, string n, object v) { if (++c > ${MAX_EVENTS}) return; try { System.IO.File.AppendAllText("${P}", l + "\\t" + n + "\\t" + Fmt(v).Replace("\\n", " ") + "\\n"); } catch { } } static string Fmt(object v) { if (v == null) return "null"; if (v is string s) return "\\"" + s + "\\""; if (v is char ch) return "'" + ch + "'"; if (v is bool b) return b ? "true" : "false"; if (v is System.Collections.IEnumerable e) { var parts = new System.Collections.Generic.List<string>(); foreach (var x in e) { if (parts.Count >= 30) { parts.Add("…"); break; } parts.Add(Fmt(x)); } return "[" + string.Join(", ", parts) + "]"; } return System.Convert.ToString(v, System.Globalization.CultureInfo.InvariantCulture) ?? ""; } }\n`,
      };
    case "c":
      return {
        head:
          `#include <stdio.h>\n` +
          `static int __azc = 0;\n` +
          `static FILE* __azf(void) { static FILE* f = 0; if (!f) f = fopen("${P}", "a"); return f; }\n` +
          `#define __AZ_FMT(v) _Generic((v), _Bool: "%d", char: "'%c'", signed char: "%d", unsigned char: "%u", short: "%d", unsigned short: "%u", int: "%d", unsigned int: "%u", long: "%ld", unsigned long: "%lu", long long: "%lld", unsigned long long: "%llu", float: "%g", double: "%g", long double: "%Lg", char*: "\\"%s\\"", const char*: "\\"%s\\"", default: "%p")\n` +
          `#define __aiz(l, n, v) do { if (++__azc <= ${MAX_EVENTS} && __azf()) { fprintf(__azf(), "%d\\t%s\\t", l, n); fprintf(__azf(), __AZ_FMT(v), v); fputc('\\n', __azf()); fflush(__azf()); } } while (0)\n` +
          `#line 1 "${strLit(fileName)}"\n`,
      };
    case "cpp":
      return {
        head:
          `#include <fstream>\n#include <sstream>\n#include <string>\n#include <iterator>\n#include <type_traits>\n#include <utility>\n` +
          `namespace __az { template <class T, class = void> struct S : std::false_type {}; template <class T> struct S<T, std::void_t<decltype(std::declval<std::ostream&>() << std::declval<const T&>())>> : std::true_type {}; ` +
          `template <class T, class = void> struct It : std::false_type {}; template <class T> struct It<T, std::void_t<decltype(std::begin(std::declval<const T&>())), decltype(std::end(std::declval<const T&>()))>> : std::true_type {}; ` +
          `template <class T> struct P : std::false_type {}; template <class A, class B> struct P<std::pair<A, B>> : std::true_type {}; ` +
          `template <class T> void put(std::ostream& o, const T& v) { using D = std::decay_t<T>; if constexpr (std::is_same_v<D, std::string>) o << '"' << v << '"'; else if constexpr (std::is_same_v<D, char>) o << '\\'' << v << '\\''; else if constexpr (std::is_same_v<D, bool>) o << (v ? "true" : "false"); else if constexpr (P<D>::value) { o << '('; put(o, v.first); o << ", "; put(o, v.second); o << ')'; } else if constexpr (std::is_convertible_v<const T&, const char*>) o << '"' << v << '"'; else if constexpr (It<T>::value) { o << '['; int k = 0; for (const auto& x : v) { if (k) o << ", "; if (++k > 30) { o << "…"; break; } put(o, x); } o << ']'; } else if constexpr (S<T>::value) o << v; else o << "<?>"; } ` +
          `inline int c = 0; template <class T> void log(int l, const char* n, const T& v) { if (++c > ${MAX_EVENTS}) return; std::ofstream f("${P}", std::ios::app); std::ostringstream s; put(s, v); std::string t = s.str(); for (auto& ch : t) if (ch == '\\n') ch = ' '; f << l << '\\t' << n << '\\t' << t << '\\n'; } }\n` +
          `#define __aiz(l, n, v) __az::log(l, n, v)\n` +
          `#line 1 "${strLit(fileName)}"\n`,
      };
    case "go":
      return {
        tail: `\nvar __azc int\n\nfunc __aiz(l int, n string, v interface{}) {\n\t__azc++\n\tif __azc > ${MAX_EVENTS} {\n\t\treturn\n\t}\n\tf, err := os.OpenFile("${P}", os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)\n\tif err != nil {\n\t\treturn\n\t}\n\tdefer f.Close()\n\tvar s string\n\tswitch x := v.(type) {\n\tcase string:\n\t\ts = fmt.Sprintf("%q", x)\n\tdefault:\n\t\ts = fmt.Sprintf("%v", x)\n\t}\n\tfmt.Fprintf(f, "%d\\t%s\\t%s\\n", l, n, s)\n}\n`,
      };
    case "rust":
      return {
        tail: `\n#[allow(dead_code)]\nfn __aiz<T: std::fmt::Debug + ?Sized>(l: u32, n: &str, v: &T) { use std::io::Write; static C: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0); if C.fetch_add(1, std::sync::atomic::Ordering::Relaxed) >= ${MAX_EVENTS} { return; } if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open("${P}") { let _ = writeln!(f, "{}\\t{}\\t{}", l, n, format!("{:?}", v).replace('\\n', " ")); } }\n`,
      };
    case "ruby":
      return {
        firstLine: `def __aiz(l, n, v); $__azc = ($__azc || 0) + 1; return v if $__azc > ${MAX_EVENTS}; File.open("${P}", "a") { |f| f.write("#{l}\\t#{n}\\t#{v.inspect.gsub("\\n", " ")[0, 300]}\\n") } rescue nil; v; end; `,
      };
    case "php":
      return {
        firstLine: `function __aiz($l, $n, $v) { static $c = 0; if (++$c > ${MAX_EVENTS}) return; $s = is_string($v) ? '"' . $v . '"' : json_encode($v, JSON_UNESCAPED_UNICODE | JSON_PARTIAL_OUTPUT_ON_ERROR); @file_put_contents("${P}", $l . "\\t" . $n . "\\t" . str_replace("\\n", " ", (string)$s) . "\\n", FILE_APPEND); } `,
      };
    case "lua":
      return {
        firstLine: `local __azc = 0; local function __azs(v, d) if type(v) == "string" then return string.format("%q", v) elseif type(v) == "table" and (d or 0) < 2 then local p = {} for i, x in ipairs(v) do p[#p + 1] = __azs(x, (d or 0) + 1) if i >= 30 then break end end if #p == 0 then for k, x in pairs(v) do p[#p + 1] = tostring(k) .. "=" .. __azs(x, (d or 0) + 1) if #p >= 30 then break end end end return "{" .. table.concat(p, ", ") .. "}" else return tostring(v) end end; local function __aiz(l, n, v) __azc = __azc + 1 if __azc > ${MAX_EVENTS} then return end local f = io.open("${P}", "a") if f then f:write(l .. "\\t" .. n .. "\\t" .. __azs(v):gsub("\\n", " ") .. "\\n") f:close() end end; `,
      };
    case "kotlin":
      return {
        firstLine: `var __azc = 0; fun __aiz(l: Int, n: String, v: Any?) { if (++__azc > ${MAX_EVENTS}) return; val s = when (v) { is String -> "\\"" + v + "\\""; is Array<*> -> v.contentDeepToString(); is IntArray -> v.contentToString(); is DoubleArray -> v.contentToString(); else -> v.toString() }; try { java.io.File("${P}").appendText("" + l + "\\t" + n + "\\t" + s.replace("\\n", " ") + "\\n") } catch (e: Exception) {} }; `,
      };
    case "swift":
      return {
        firstLine: `import Foundation; var __azc = 0; func __aiz(_ l: Int, _ n: String, _ v: Any) { __azc += 1; if __azc > ${MAX_EVENTS} { return }; let s = (v is String) ? "\\"\\(v)\\"" : "\\(v)"; let line = "\\(l)\\t\\(n)\\t\\(s.replacingOccurrences(of: "\\n", with: " "))\\n"; if let h = FileHandle(forWritingAtPath: "${P}") { h.seekToEndOfFile(); h.write(line.data(using: .utf8)!); h.closeFile() } else { try? line.write(toFile: "${P}", atomically: false, encoding: .utf8) } }; `,
      };
    case "dart":
      return {
        firstLine: `import 'dart:io' as __azio; `,
        tail: `\nint __azc = 0;\nvoid __aiz(int l, String n, Object? v) { if (++__azc > ${MAX_EVENTS}) return; final s = v is String ? '"' + v + '"' : '$v'; try { __azio.File("${P}").writeAsStringSync('$l\\t$n\\t\${s.replaceAll("\\n", " ")}\\n', mode: __azio.FileMode.append); } catch (e) {} }\n`,
      };
  }
}

/** Go：fmt と os を import する（ない分だけ、行番号を変えずに） */
function goImports(lines: string[]): boolean {
  const all = lines.join("\n");
  const need = ["fmt", "os"].filter((p) => !new RegExp(`^\\s*(import\\s+)?(\\w+\\s+)?"${p}"`, "m").test(all));
  if (!need.length) return true;
  const add = need.map((p) => `"${p}"`).join("; ");
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*import\s*\(\s*$/.test(lines[i])) {
      lines[i] = lines[i].replace(/\(\s*$/, `(${add};`);
      return true;
    }
    if (/^\s*import\s+(\w+\s+)?"[^"]+"\s*$/.test(lines[i])) {
      lines[i] = lines[i].replace(/^\s*import\s+/, `import (${add}; `) + ")";
      return true;
    }
  }
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*package\s+\w+\s*$/.test(lines[i])) {
      lines[i] += `; import (${add})`;
      return true;
    }
  }
  return false;
}

/** 記録用の文を入れたコードを作る。うまく作れないときは null */
export function instrument(src: string, lang: TraceLang, logPath: string, fileName: string): { code: string; points: number } | null {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const inserts: Insert[] = [];
  const cTypes = new Map<string, string>();
  // ブロックの種類（code：命令を書ける所／other：クラスの中・オブジェクトの {…} など）
  const stack: ("code" | "other")[] = [];
  const braces = !["ruby", "lua"].includes(lang);
  const semis = ["js", "ts", "java", "cs", "c", "cpp", "rust", "php", "dart"].includes(lang);
  let depth = 0;
  let inBlockComment = false;
  let pendingLoop: { names: string[]; as: number } | null = null;
  // Ruby・Lua はブロックを数えずに、関数の外でも中でも書ける（クラスの直下だけ避ける）
  let rubyClassDepth = -1;
  let rubyDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    let code = raw;
    if (inBlockComment) {
      const e = code.indexOf("*/");
      if (e < 0) continue;
      code = " ".repeat(e + 2) + code.slice(e + 2);
      inBlockComment = false;
    }
    const end = codeEnd(code, lang);
    const rest = code.slice(end);
    if (/^\/\*/.test(rest) && !rest.includes("*/")) inBlockComment = true;
    code = code.slice(0, end);
    const s = code.trim();
    const startDepth = depth;
    depth += depthDelta(code);
    if (depth < 0) depth = 0;

    if (braces) {
      const inCode = stack.length > 0 && stack[stack.length - 1] === "code";
      // 前の行が for (…) で、この行が「{」だけ（波かっこを次の行に書く書き方）
      if (pendingLoop && /^\{\s*$/.test(s)) {
        inserts.push({ line: i, at: code.indexOf("{") + 1, names: pendingLoop.names, as: pendingLoop.as });
        pendingLoop = null;
      } else if (s) pendingLoop = null;

      if (startDepth === 0 && depth === 0 && s) {
        const loop = /^(for|foreach)\b/.test(s) ? loopVars(s, lang) : null;
        if (loop && (inCode || lang === "go" || lang === "rust" || lang === "swift" || lang === "kotlin" || lang === "js" || lang === "ts" || lang === "php" || lang === "dart")) {
          if (/\{\s*$/.test(s)) inserts.push({ line: i, at: code.lastIndexOf("{") + 1, names: loop, as: i + 1 });
          else if (!/;\s*$/.test(s)) pendingLoop = { names: loop, as: i + 1 };
        } else {
          const topLevelOk = ["js", "ts", "go", "rust", "php", "kotlin", "swift", "dart", "cs"].includes(lang);
          const okHere = inCode || (stack.length === 0 && topLevelOk && lang !== "go" && lang !== "rust" && lang !== "dart");
          const ends = semis ? /;\s*$/.test(s) && !/^((for|if|while|else|do|switch|return|case|default|break|continue|throw|yield|goto|using|import|package)\b|#|@)/.test(s) : !/[{(\[,+\-*/=&|.\\]$/.test(s) && !/^((for|if|while|else|switch|return|case|default|break|continue|throw|import|package|func|fn|class|struct)\b|}|@)/.test(s);
          if (okHere && ends) {
            // 1 行に文が 2 つ以上あるとき（a = 1; b = 2;）は扱わない
            const body = s.replace(/;\s*$/, "");
            if (!semis || !/;/.test(body.replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '""').replace(/\([^()]*\)/g, "()"))) {
              const names = targetsOf(s, lang, cTypes);
              if (names.length) inserts.push({ line: i, at: null, names, as: i + 1 });
            }
          }
        }
      }
      // 波かっこの開き・閉じ（行ごと。文字列の中は数えない）
      const plain = code.replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '""');
      for (let k = 0; k < plain.length; k++) {
        const c = plain[k];
        if (c === "{") {
          const before = plain.slice(0, k + 1);
          const header = /^\s*\{\s*$/.test(before) ? prevNonBlank(lines, i) : before;
          const kind = TYPE_BLOCK.test(header) ? "other" : CODE_BLOCK.test(header) || /^\s*\{\s*$/.test(before) && CODE_BLOCK.test(header + " {") ? "code" : "other";
          // 関数の中の { … } は、オブジェクトや配列の中身でなければ命令のブロック
          stack.push(kind);
        } else if (c === "}") stack.pop();
      }
    } else {
      // Ruby・Lua
      if (startDepth === 0 && depth === 0 && s) {
        if (lang === "ruby") {
          if (/^(class|module)\b/.test(s)) rubyClassDepth = rubyDepth;
        }
        const loop = /^for\b/.test(s) || /\b(do|\{)\s*\|[^|]+\|\s*$/.test(s) ? loopVars(s, lang) : null;
        if (loop && lang === "ruby" && /\|\s*$/.test(s)) inserts.push({ line: i, at: null, names: loop, as: i + 1 });
        else if (loop && /\bdo\s*$/.test(s)) inserts.push({ line: i, at: null, names: loop, as: i + 1 });
        else if (loop && lang === "ruby" && /^for\b/.test(s)) inserts.push({ line: i, at: null, names: loop, as: i + 1 });
        else if (!/(\bdo|\bthen|[{(\[,+\-*/=&|.\\])\s*$/.test(s) && !/^(if|elsif|unless|while|until|for|def|class|module|end|else|return|case|when|begin|rescue|ensure|local\s+function|function|repeat|until)\b/.test(s)) {
          const inClassBody = lang === "ruby" && rubyClassDepth >= 0 && rubyClassDepth === rubyDepth - 1;
          const rhsBlock = /=\s*(if|case|begin|unless|while|function)\b/.test(s);
          if (!inClassBody && !rhsBlock) {
            const names = targetsOf(s, lang, cTypes);
            if (names.length) inserts.push({ line: i, at: null, names, as: i + 1 });
          }
        }
        if (lang === "ruby") {
          if (/^(class|module|def|if|unless|while|until|case|begin|for)\b/.test(s) && !/\bend\s*$/.test(s)) rubyDepth++;
          else if (/\bdo(\s*\|[^|]*\|)?\s*$/.test(s)) rubyDepth++;
          else if (/^end\b/.test(s)) {
            rubyDepth--;
            if (rubyClassDepth === rubyDepth) rubyClassDepth = -1;
          }
        }
      }
    }
  }

  if (!inserts.length) return null;
  // 同じ行・同じ場所の記録はまとめる
  const sep = lang === "lua" ? " " : "; ";
  const byLine = new Map<number, Insert[]>();
  for (const ins of inserts) byLine.set(ins.line, [...(byLine.get(ins.line) ?? []), ins]);
  let points = 0;
  for (const [ln, list] of byLine) {
    let text = lines[ln];
    // 後ろの位置から入れる（前の位置がずれないように）
    const sorted = [...list].sort((a, b) => (b.at ?? Infinity) - (a.at ?? Infinity));
    for (const ins of sorted) {
      const calls = ins.names.map((n) => callFor(lang, ins.as, n));
      points += calls.length;
      if (ins.at === null) {
        const e = codeEnd(text, lang);
        const head = text.slice(0, e).replace(/\s+$/, "");
        const tail = text.slice(head.length);
        const needSep = semis ? (head.endsWith(";") ? " " : "; ") : sep;
        text = head + needSep + calls.join(sep) + (semis || lang === "dart" ? ";" : "") + tail;
      } else {
        text = text.slice(0, ins.at) + " " + calls.join(sep) + (lang === "lua" || lang === "ruby" ? "" : ";") + text.slice(ins.at);
      }
    }
    lines[ln] = text;
  }

  if (lang === "go" && !goImports(lines)) return null;
  const h = helper(lang, logPath, fileName);
  if (h.firstLine) {
    // 最初の「ふつうの行」の前に（# から始まる行・import・<?php などはそのまま）
    let k = 0;
    if (lang === "php") {
      k = lines.findIndex((l) => /<\?php/.test(l));
      if (k < 0) return null;
      lines[k] = lines[k].replace(/<\?php\s*/, (m) => m.trimEnd() + " " + h.firstLine);
    } else {
      const skip = lang === "ruby" ? /^\s*(#|$)/ : lang === "lua" ? /^\s*(--|#!|$)/ : /^\s*(\/\/|#!|$|import\b|package\b|@file:)/;
      while (k < lines.length && skip.test(lines[k])) k++;
      if (k >= lines.length) return null;
      if (lang === "dart") {
        // import は先頭に（library の行があれば、その後ろに）
        const lib = lines.findIndex((l) => /^\s*library\b/.test(l));
        const at = lib >= 0 ? lib : lines.findIndex((l) => l.trim() !== "" && !/^\s*\/\//.test(l));
        lines[at] = lib >= 0 ? lines[at] + " " + h.firstLine : h.firstLine + lines[at];
      } else lines[k] = h.firstLine + lines[k];
    }
  }
  let code = lines.join("\n");
  if (h.head) code = h.head + code;
  if (h.tail) code += h.tail;
  return { code, points };
}

function prevNonBlank(lines: string[], i: number): string {
  for (let k = i - 1; k >= 0; k--) if (lines[k].trim()) return lines[k] + " {";
  return "{";
}

// ───────── 記録を読む

/** 記録（1 行に「行番号\t名前\t値」）を、行の右に出す形にする */
export function parseTraceLog(text: string): TraceResult {
  const result: TraceResult = { lines: {}, error: null, truncated: false };
  let seq = 0;
  let last: { line: number; rec: TraceRecord } | null = null;
  let count = 0;
  for (const row of text.split("\n")) {
    const m = /^(\d+)\t([^\t]+)\t(.*)$/.exec(row);
    if (!m) continue;
    count++;
    const line = Number(m[1]);
    const value = m[3].length > 300 ? m[3].slice(0, 299) + "…" : m[3];
    // 同じ行の続けての記録（a, b = …）は 1 回の実行にまとめる
    if (last && last.line === line && !(m[2] in last.rec.c)) {
      last.rec.c[m[2]] = value;
      continue;
    }
    const entry = (result.lines[String(line)] ??= { n: 0, recs: [] });
    entry.n++;
    const rec: TraceRecord = { c: { [m[2]]: value }, r: {}, s: ++seq };
    if (entry.recs.length < 300) entry.recs.push(rec);
    else entry.recs[entry.recs.length - 1] = rec;
    last = { line, rec };
  }
  result.truncated = count >= MAX_EVENTS;
  return result;
}
