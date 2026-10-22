// ファイルの言語を決める。
// 1. 1 行目に「## py ##」「## C# ##」「// ## C++ ##」のように書くと、その言語として扱い、その言語で実行する
// 2. 保存していない新しいファイルは、中身から言語を推測する（わからなければ設定の「新しいファイルの言語」）

export interface LangChoice {
  ext: string;
  label: string;
  /** 「## ○○ ##」に書く名前 */
  tag: string;
  aliases: string[];
}

export const LANG_CHOICES: LangChoice[] = [
  { ext: ".py", label: "Python", tag: "py", aliases: ["py", "python", "python3", "パイソン", "ぱいそん"] },
  { ext: ".js", label: "JavaScript", tag: "js", aliases: ["js", "javascript", "node", "nodejs", "ジャバスクリプト"] },
  { ext: ".ts", label: "TypeScript", tag: "ts", aliases: ["ts", "typescript"] },
  { ext: ".cs", label: "C#", tag: "C#", aliases: ["c#", "cs", "csharp", "c sharp", "シーシャープ", "unity"] },
  { ext: ".cpp", label: "C++", tag: "C++", aliases: ["c++", "cpp", "cxx", "cc", "シープラプラ"] },
  { ext: ".c", label: "C", tag: "C", aliases: ["c", "c言語"] },
  { ext: ".java", label: "Java", tag: "java", aliases: ["java", "ジャバ", "じゃば"] },
  { ext: ".go", label: "Go", tag: "go", aliases: ["go", "golang"] },
  { ext: ".rs", label: "Rust", tag: "rust", aliases: ["rust", "rs"] },
  { ext: ".rb", label: "Ruby", tag: "ruby", aliases: ["ruby", "rb", "ルビー"] },
  { ext: ".php", label: "PHP", tag: "php", aliases: ["php"] },
  { ext: ".kt", label: "Kotlin", tag: "kotlin", aliases: ["kotlin", "kt"] },
  { ext: ".swift", label: "Swift", tag: "swift", aliases: ["swift"] },
  { ext: ".dart", label: "Dart", tag: "dart", aliases: ["dart"] },
  { ext: ".lua", label: "Lua", tag: "lua", aliases: ["lua"] },
  { ext: ".html", label: "HTML", tag: "html", aliases: ["html", "htm"] },
  { ext: ".css", label: "CSS", tag: "css", aliases: ["css"] },
  { ext: ".sql", label: "SQL", tag: "sql", aliases: ["sql"] },
  { ext: ".sh", label: "シェル（bash）", tag: "bash", aliases: ["sh", "bash", "shell", "シェル"] },
  { ext: ".ps1", label: "PowerShell", tag: "powershell", aliases: ["ps1", "powershell", "pwsh"] },
  { ext: ".md", label: "Markdown", tag: "md", aliases: ["md", "markdown"] },
  { ext: ".txt", label: "テキスト", tag: "txt", aliases: ["txt", "text", "テキスト"] },
];

/** 1 行目の言語の指定（## py ## など） */
const DIRECTIVE = /^\s*(?:\/\/|--|;|#(?!#))?\s*##\s*(.+?)\s*##\s*$/;

export function parseDirective(firstLine: string): LangChoice | null {
  const m = DIRECTIVE.exec(firstLine);
  if (!m || m[1].startsWith("#") || /構築|終わり/.test(m[1])) return null;
  const name = m[1].trim().toLowerCase().replace(/\s+/g, " ");
  return LANG_CHOICES.find((c) => c.aliases.includes(name) || c.label.toLowerCase() === name) ?? null;
}

export function choiceByExt(ext: string): LangChoice | undefined {
  return LANG_CHOICES.find((c) => c.ext === ext.toLowerCase());
}

/** 中身から言語を推測する（はっきりしなければ null） */
export function guessLanguage(text: string): string | null {
  const s = text.slice(0, 4000);
  if (!s.trim()) return null;
  const score: Record<string, number> = {};
  const add = (ext: string, re: RegExp, w = 1) => {
    if (re.test(s)) score[ext] = (score[ext] ?? 0) + w;
  };
  add(".py", /^\s*def\s+\w+\s*\(.*\)\s*:/m, 3);
  add(".py", /^\s*(import\s+\w+|from\s+[\w.]+\s+import\s)/m, 2);
  add(".py", /^\s*(if|for|while|elif|else|try|except)\b[^{;\n]*:\s*$/m, 2);
  add(".py", /\bprint\s*\(/, 1);
  add(".py", /\binput\s*\(|\brange\s*\(|\bself\b|\bNone\b|\bTrue\b|\bFalse\b/, 1);
  add(".java", /\bpublic\s+(static\s+)?(class|void)\b/, 3);
  add(".java", /System\.out\.print/, 4);
  add(".cs", /using\s+(System|UnityEngine)\b|Console\.Write|MonoBehaviour|Debug\.Log/, 5);
  add(".cs", /\bnamespace\s+\w+|\bvar\s+\w+\s*=\s*new\b/, 1);
  add(".cpp", /#include\s*<(iostream|vector|string|map|algorithm)>|std::|\bcout\s*<<|\bcin\s*>>/, 5);
  add(".c", /#include\s*<(stdio|stdlib|string)\.h>|\bprintf\s*\(|\bscanf\s*\(/, 4);
  add(".go", /^\s*package\s+main\b|^\s*func\s+\w+\s*\(|fmt\.Print/m, 5);
  add(".rs", /\bfn\s+main\s*\(|\blet\s+mut\b|println!\(/, 5);
  add(".js", /\bconsole\.log\s*\(|\bfunction\s+\w+\s*\(|\b(const|let)\s+\w+\s*=|=>\s*[{(]|document\.\w+/, 3);
  add(".ts", /:\s*(string|number|boolean)\b|\binterface\s+\w+\s*\{/, 2);
  add(".html", /<!doctype html|<html[\s>]|<body[\s>]|<div[\s>]/i, 5);
  add(".css", /^[\w.#\-\s,:>*[\]=]+\{\s*$[\s\S]*?^\s*[\w-]+\s*:\s*[^;]+;/m, 3);
  add(".rb", /^\s*(puts|require)\s|^\s*end\s*$/m, 2);
  add(".php", /<\?php/, 6);
  add(".sql", /^\s*(SELECT|CREATE TABLE|INSERT INTO)\b/im, 4);
  // TypeScript は JavaScript の上乗せ
  if (score[".ts"] && score[".js"]) score[".ts"] += score[".js"];
  // C++ は C の書き方も使う
  if (score[".cpp"] && score[".c"]) score[".cpp"] += 1;
  let best: string | null = null;
  let bestScore = 2;
  for (const [ext, v] of Object.entries(score)) {
    if (v > bestScore) {
      best = ext;
      bestScore = v;
    }
  }
  return best;
}

/** 言語の指定を書いた 1 行目を、その言語で正しいコメントにする（実行用のコピーで使う） */
export function directiveAsComment(firstLine: string, ext: string): string {
  const label = parseDirective(firstLine)?.label ?? "";
  const hash = [".py", ".rb", ".sh", ".ps1"];
  const slash = [".js", ".ts", ".cs", ".cpp", ".c", ".java", ".go", ".rs", ".php", ".kt", ".swift", ".dart"];
  if (hash.includes(ext)) return `# ${label}`;
  if (slash.includes(ext)) return `// ${label}`;
  if (ext === ".lua" || ext === ".sql") return `-- ${label}`;
  if (ext === ".html" || ext === ".md") return `<!-- ${label} -->`;
  if (ext === ".css") return `/* ${label} */`;
  return "";
}

/** 1 行目の言語の指定を、別の言語に書き換える（なければ先頭に足す） */
export function setDirective(text: string, choice: LangChoice): string {
  const nl = text.indexOf("\n");
  const first = nl < 0 ? text : text.slice(0, nl);
  const line = `## ${choice.tag} ##`;
  if (parseDirective(first)) return line + (nl < 0 ? "" : text.slice(nl));
  return line + "\n" + text;
}
