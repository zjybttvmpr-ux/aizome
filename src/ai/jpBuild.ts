// 「日本語から組み立てる」：###構築py### の下に書いた日本語の手順を、AI にプログラムへ組み立ててもらう（純粋関数）

export interface BuildLanguage {
  /** 目印に書く短い名前 例: py */
  key: string;
  name: string;
  ext: string;
  comment: string;
}

export const BUILD_LANGUAGES: BuildLanguage[] = [
  { key: "py", name: "Python", ext: ".py", comment: "#" },
  { key: "js", name: "JavaScript (Node.js)", ext: ".js", comment: "//" },
  { key: "ts", name: "TypeScript", ext: ".ts", comment: "//" },
  { key: "rs", name: "Rust", ext: ".rs", comment: "//" },
  { key: "go", name: "Go", ext: ".go", comment: "//" },
  { key: "c", name: "C", ext: ".c", comment: "//" },
  { key: "cpp", name: "C++", ext: ".cpp", comment: "//" },
  { key: "java", name: "Java", ext: ".java", comment: "//" },
  { key: "cs", name: "C#", ext: ".cs", comment: "//" },
  { key: "kt", name: "Kotlin", ext: ".kts", comment: "//" },
  { key: "swift", name: "Swift", ext: ".swift", comment: "//" },
  { key: "rb", name: "Ruby", ext: ".rb", comment: "#" },
  { key: "php", name: "PHP", ext: ".php", comment: "//" },
  { key: "lua", name: "Lua", ext: ".lua", comment: "--" },
  { key: "sh", name: "Bash", ext: ".sh", comment: "#" },
  { key: "ps1", name: "PowerShell", ext: ".ps1", comment: "#" },
  { key: "html", name: "HTML（CSS と JavaScript を含む1ファイル）", ext: ".html", comment: "<!-- -->" },
  { key: "dart", name: "Dart", ext: ".dart", comment: "//" },
];

const ALIASES: Record<string, string> = {
  python: "py", パイソン: "py", javascript: "js", node: "js", typescript: "ts", rust: "rs", golang: "go",
  "c++": "cpp", "c#": "cs", csharp: "cs", kotlin: "kt", ruby: "rb", bash: "sh", shell: "sh", powershell: "ps1", web: "html",
};

export function findLanguage(key: string | undefined): BuildLanguage | undefined {
  if (!key) return undefined;
  const k = key.trim().toLowerCase();
  const resolved = ALIASES[k] ?? k;
  return BUILD_LANGUAGES.find((l) => l.key === resolved);
}

/** ###構築py### / ### 構築 python ### / ＃＃＃構築＃＃＃ など。言語は省略可 */
export const START_MARK = /^\s*[#＃]{3}\s*構築\s*([A-Za-z+#]*|パイソン)?\s*[#＃]{3}\s*$/;
/** ###終わり### / ###おわり### / ###end### */
export const END_MARK = /^\s*[#＃]{3}\s*(終わり|おわり|終了|end)\s*[#＃]{3}\s*$/i;

export interface BuildBlock {
  /** 目印の行（1 始まり） */
  startLine: number;
  /** ブロックの最後の行（1 始まり、終わりの目印があればその行） */
  endLine: number;
  language?: BuildLanguage;
  /** 目印に書かれた言語名（見つからない名前のときの表示用） */
  rawLanguage: string;
  /** 日本語の手順（空行の前後は整える） */
  spec: string;
}

export function findBlocks(text: string): BuildBlock[] {
  const lines = text.split("\n");
  const blocks: BuildBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const m = START_MARK.exec(lines[i]);
    if (!m) {
      i++;
      continue;
    }
    const start = i;
    let end = lines.length - 1;
    let bodyEnd = lines.length;
    for (let j = i + 1; j < lines.length; j++) {
      if (END_MARK.test(lines[j])) {
        end = j;
        bodyEnd = j;
        break;
      }
      if (START_MARK.test(lines[j])) {
        end = j - 1;
        bodyEnd = j;
        break;
      }
    }
    const body = lines.slice(start + 1, bodyEnd);
    // 末尾の空行は手順に含めない
    while (body.length && !body[body.length - 1].trim()) body.pop();
    const lastBodyLine = start + body.length;
    blocks.push({
      startLine: start + 1,
      endLine: END_MARK.test(lines[end] ?? "") ? end + 1 : Math.max(lastBodyLine + 1, start + 1),
      language: findLanguage(m[1]),
      rawLanguage: m[1] ?? "",
      spec: body.join("\n").replace(/^\n+/, ""),
    });
    i = bodyEnd;
  }
  return blocks;
}

/** カーソルのある行（1 始まり）を含むブロック。なければ直前のブロック */
export function blockAt(text: string, line: number): BuildBlock | undefined {
  const blocks = findBlocks(text);
  return blocks.find((b) => line >= b.startLine && line <= b.endLine) ?? [...blocks].reverse().find((b) => b.startLine <= line);
}

function commentExample(lang: BuildLanguage): string {
  if (lang.comment === "<!-- -->") return "<!-- 空リストaを作る -->";
  return `${lang.comment} 空リストaを作る`;
}

export function buildPrompt(spec: string, lang: BuildLanguage, opts: { fileName?: string; keepComments: boolean }): string {
  const rules = [
    `Convert the Japanese step-by-step description below into one complete, runnable ${lang.name} program.`,
    "How to read the description:",
    "- Each line is one step, in order. Implement every step.",
    "- Indented lines belong to the step above them. Phrases such as 以下ループ / 以下繰り返し / ずっと繰り返す mean the indented lines below run in a loop; もし〜なら / 〜の場合 mean a condition; 以下の処理 / 関数 mean a block.",
    "- 「……」 or 「など」 means the step is loosely described: pick the most natural meaning for a small program.",
    "Rules for the program:",
    opts.keepComments
      ? `- Put each Japanese step as a short comment directly above the code that implements it, for example: ${commentExample(lang)}`
      : "- Keep comments short.",
    "- If something is ambiguous, choose the most reasonable interpretation and list each choice at the very top as a comment that starts with 「仮定:」 (in Japanese).",
    "- When the program asks for input, show a clear prompt in Japanese and handle invalid input without crashing.",
    "- If there is an endless loop, let the user stop it (for example by entering an empty line or q) and say so in a comment.",
    "- Use only the standard library unless the description asks for something else.",
    "- Messages shown to the user should be in Japanese.",
    "- Output ONLY the program in a single fenced code block. No explanation before or after.",
  ];
  const file = opts.fileName ? `\nThe program will be saved as "${opts.fileName}".` : "";
  return `${rules.join("\n")}${file}\n\nJapanese description:\n"""\n${spec}\n"""\n`;
}

/** 返答からコード部分だけを取り出す */
export function extractCode(answer: string): string {
  const fenced = /```[\w+#.-]*\s*\n([\s\S]*?)```/.exec(answer);
  if (fenced) return fenced[1].replace(/\s+$/, "") + "\n";
  // 閉じていないフェンス（途中まで）
  const open = /```[\w+#.-]*\s*\n([\s\S]*)$/.exec(answer);
  if (open) return open[1].replace(/\s+$/, "") + "\n";
  return answer.trim() ? answer.replace(/\s+$/, "") + "\n" : "";
}

export function sampleTemplate(): string {
  return [
    "###構築py###",
    "以下ループ",
    "    空リストaを作る",
    "    コンマ区切りの数字を入力してもらい、コンマごとに分けて数字としてaに入れる",
    "    aの合計と平均を表示する",
    "    aを小さい順に並べ替えて表示する",
    "###終わり###",
    "",
    "（目印の行の「▶ 組み立てる」を押すか、この中で Ctrl+Shift+Enter を押すと、AI がプログラムにします）",
    "",
  ].join("\n");
}
