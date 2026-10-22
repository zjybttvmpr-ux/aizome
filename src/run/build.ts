// ビルド（実行ファイルなどを作る）と、実行に必要な道具（コンパイラ）の表。
// 言語は「▶ 実行」と同じ決め方（拡張子か 1 行目の ## go ## など）で、自動で選ぶ。

export interface Toolchain {
  /** 表示名 */
  label: string;
  /** 探すコマンド名（どれか 1 つ） */
  names: string[];
  /** Windows で入れるときの winget の ID */
  winget?: string;
  /** 公式のダウンロードページ */
  url: string;
  /** 入れたあとの注意（なければ出さない） */
  note?: string;
}

/** 実行の設定（runConfig の id）ごとに、必要な道具 */
export const RUN_TOOLS: Record<string, Toolchain> = {
  go: { label: "Go", names: ["go"], winget: "GoLang.Go", url: "https://go.dev/dl/" },
  c: { label: "C コンパイラ（gcc）", names: ["gcc"], winget: "BrechtSanders.WinLibs.POSIX.UCRT", url: "https://winlibs.com/" },
  cpp: { label: "C++ コンパイラ（g++）", names: ["g++"], winget: "BrechtSanders.WinLibs.POSIX.UCRT", url: "https://winlibs.com/" },
  rust: {
    label: "Rust（rustc）",
    names: ["rustc"],
    winget: "Rustlang.Rustup",
    url: "https://rustup.rs/",
    note: "Windows では、Rust が使う「Visual Studio Build Tools（C++ によるデスクトップ開発）」も必要です。",
  },
  csharp: { label: ".NET SDK（dotnet）", names: ["dotnet"], winget: "Microsoft.DotNet.SDK.10", url: "https://dotnet.microsoft.com/download" },
  java: { label: "Java（JDK）", names: ["java"], winget: "EclipseAdoptium.Temurin.21.JDK", url: "https://adoptium.net/" },
  node: { label: "Node.js", names: ["node"], winget: "OpenJS.NodeJS.LTS", url: "https://nodejs.org/" },
  typescript: { label: "Node.js（TypeScript の実行に使います）", names: ["node"], winget: "OpenJS.NodeJS.LTS", url: "https://nodejs.org/" },
  ruby: { label: "Ruby", names: ["ruby"], winget: "RubyInstallerTeam.Ruby.3.3", url: "https://rubyinstaller.org/" },
  php: { label: "PHP", names: ["php"], winget: "PHP.PHP.8.3", url: "https://windows.php.net/download/" },
  lua: { label: "Lua", names: ["lua", "lua54"], winget: "DEVCOM.Lua", url: "https://www.lua.org/download.html" },
  dart: { label: "Dart", names: ["dart"], winget: "Google.DartSDK", url: "https://dart.dev/get-dart" },
  kotlin: { label: "Kotlin", names: ["kotlinc"], url: "https://kotlinlang.org/docs/command-line.html" },
  swift: { label: "Swift", names: ["swift"], url: "https://www.swift.org/install/" },
};

export interface BuildTarget {
  id: string;
  label: string;
  detail: string;
  /** 必要な道具（RUN_TOOLS と同じ形） */
  tools: Toolchain[];
  /**
   * PowerShell（Windows）用のコマンド。${src} 元のファイル、${out} 出力フォルダ、${name} 名前（拡張子なし）、${py} Python
   * 成功したら $true になるように最後の命令を置く
   */
  windows: string;
  /** macOS / Linux 用（sh） */
  unix: string;
  /** できあがるもの（表示用。${out} ${name} が使える） */
  result: string;
  /** 成功・失敗の表示のあとに行う後かたづけ（PowerShell） */
  after?: string;
}

const javac: Toolchain = { label: "Java（JDK の javac）", names: ["javac"], winget: "EclipseAdoptium.Temurin.21.JDK", url: "https://adoptium.net/" };
const py: Toolchain = { label: "Python", names: [], url: "https://www.python.org/downloads/" };

/** 言語（runConfig の id）ごとのビルドのしかた。最初のものがおすすめ */
export const BUILD_TARGETS: Record<string, BuildTarget[]> = {
  python: [
    {
      id: "py-onefile",
      label: "exe（1 つのファイルにまとめる）",
      detail: "PyInstaller で、Python が入っていないパソコンでも動く .exe を作ります（初回は PyInstaller を入れます）",
      tools: [py],
      windows:
        '${py} -m PyInstaller --version *> $null; if (-not $?) { ${py} -m pip install --user pyinstaller }; ${py} -m PyInstaller --noconfirm --onefile --distpath "${out}" --workpath "$env:TEMP\\aizome-pyi" --specpath "$env:TEMP\\aizome-pyi" --name "${name}" "${src}"',
      unix: '${py} -m PyInstaller --version >/dev/null 2>&1 || ${py} -m pip install --user pyinstaller; ${py} -m PyInstaller --noconfirm --onefile --distpath "${out}" --workpath /tmp/aizome-pyi --specpath /tmp/aizome-pyi --name "${name}" "${src}"',
      result: "${out}/${name}.exe",
    },
    {
      id: "py-window",
      label: "exe（黒い画面を出さない。tkinter などの画面のあるアプリ用）",
      detail: "--noconsole を付けて作ります",
      tools: [py],
      windows:
        '${py} -m PyInstaller --version *> $null; if (-not $?) { ${py} -m pip install --user pyinstaller }; ${py} -m PyInstaller --noconfirm --onefile --noconsole --distpath "${out}" --workpath "$env:TEMP\\aizome-pyi" --specpath "$env:TEMP\\aizome-pyi" --name "${name}" "${src}"',
      unix: '${py} -m PyInstaller --noconfirm --onefile --windowed --distpath "${out}" --workpath /tmp/aizome-pyi --specpath /tmp/aizome-pyi --name "${name}" "${src}"',
      result: "${out}/${name}.exe",
    },
  ],
  go: [
    {
      id: "go-here",
      label: "exe（このパソコン用）",
      detail: "go build で実行ファイルを作ります",
      tools: [RUN_TOOLS.go],
      windows: 'go build -o "${out}\\${name}.exe" "${src}"',
      unix: 'go build -o "${out}/${name}" "${src}"',
      result: "${out}/${name}.exe",
    },
    {
      id: "go-mac",
      label: "Mac 用（Apple シリコン）",
      detail: "GOOS=darwin GOARCH=arm64 で作ります",
      tools: [RUN_TOOLS.go],
      windows: '$env:GOOS="darwin"; $env:GOARCH="arm64"; go build -o "${out}\\${name}-mac" "${src}"',
      after: "Remove-Item Env:GOOS, Env:GOARCH",
      unix: 'GOOS=darwin GOARCH=arm64 go build -o "${out}/${name}-mac" "${src}"',
      result: "${out}/${name}-mac",
    },
    {
      id: "go-linux",
      label: "Linux 用",
      detail: "GOOS=linux GOARCH=amd64 で作ります",
      tools: [RUN_TOOLS.go],
      windows: '$env:GOOS="linux"; $env:GOARCH="amd64"; go build -o "${out}\\${name}-linux" "${src}"',
      after: "Remove-Item Env:GOOS, Env:GOARCH",
      unix: 'GOOS=linux GOARCH=amd64 go build -o "${out}/${name}-linux" "${src}"',
      result: "${out}/${name}-linux",
    },
    {
      id: "go-win",
      label: "Windows 用（ほかの OS から）",
      detail: "GOOS=windows GOARCH=amd64 で作ります",
      tools: [RUN_TOOLS.go],
      windows: 'go build -o "${out}\\${name}.exe" "${src}"',
      unix: 'GOOS=windows GOARCH=amd64 go build -o "${out}/${name}.exe" "${src}"',
      result: "${out}/${name}.exe",
    },
  ],
  c: [
    {
      id: "c-release",
      label: "exe（ほかのパソコンでも動く）",
      detail: "gcc -O2 -static で、DLL がなくても動く実行ファイルを作ります",
      tools: [RUN_TOOLS.c],
      windows: 'gcc -O2 -static "${src}" -o "${out}\\${name}.exe"',
      unix: 'cc -O2 "${src}" -o "${out}/${name}"',
      result: "${out}/${name}.exe",
    },
    {
      id: "c-debug",
      label: "exe（デバッグ用・警告を全部出す）",
      detail: "gcc -g -Wall -Wextra で作ります",
      tools: [RUN_TOOLS.c],
      windows: 'gcc -g -Wall -Wextra "${src}" -o "${out}\\${name}.exe"',
      unix: 'cc -g -Wall -Wextra "${src}" -o "${out}/${name}"',
      result: "${out}/${name}.exe",
    },
  ],
  cpp: [
    {
      id: "cpp-release",
      label: "exe（ほかのパソコンでも動く）",
      detail: "g++ -std=c++17 -O2 -static で作ります",
      tools: [RUN_TOOLS.cpp],
      windows: 'g++ -std=c++17 -O2 -static "${src}" -o "${out}\\${name}.exe"',
      unix: 'c++ -std=c++17 -O2 "${src}" -o "${out}/${name}"',
      result: "${out}/${name}.exe",
    },
    {
      id: "cpp-debug",
      label: "exe（デバッグ用・警告を全部出す）",
      detail: "g++ -std=c++17 -g -Wall -Wextra で作ります",
      tools: [RUN_TOOLS.cpp],
      windows: 'g++ -std=c++17 -g -Wall -Wextra "${src}" -o "${out}\\${name}.exe"',
      unix: 'c++ -std=c++17 -g -Wall -Wextra "${src}" -o "${out}/${name}"',
      result: "${out}/${name}.exe",
    },
  ],
  rust: [
    {
      id: "rust-release",
      label: "exe（最適化あり）",
      detail: "rustc -O で作ります",
      tools: [RUN_TOOLS.rust],
      windows: 'rustc -O "${src}" -o "${out}\\${name}.exe"',
      unix: 'rustc -O "${src}" -o "${out}/${name}"',
      result: "${out}/${name}.exe",
    },
  ],
  csharp: [
    {
      id: "cs-build",
      label: "exe（.NET のアプリ）",
      detail: "dotnet build でこのファイルだけのアプリを作ります（.NET 10 以降）",
      tools: [RUN_TOOLS.csharp],
      windows: 'dotnet build "${src}" -c Release -o "${out}"',
      unix: 'dotnet build "${src}" -c Release -o "${out}"',
      result: "${out}/${name}.exe",
    },
  ],
  java: [
    {
      id: "java-jar",
      label: "jar（ダブルクリックや java -jar で動く）",
      detail: "javac でコンパイルして、1 つの .jar にまとめます",
      tools: [javac],
      windows:
        '$cls = Join-Path $env:TEMP "aizome-java"; Remove-Item -Recurse -Force $cls -ErrorAction SilentlyContinue; javac -encoding UTF-8 -d $cls "${src}"; if ($?) { jar --create --file "${out}\\${name}.jar" --main-class ${main} -C $cls . }',
      unix: 'cls=/tmp/aizome-java; rm -rf "$cls"; javac -encoding UTF-8 -d "$cls" "${src}" && jar --create --file "${out}/${name}.jar" --main-class ${main} -C "$cls" .',
      result: "${out}/${name}.jar",
    },
    {
      id: "java-class",
      label: "class ファイル",
      detail: "javac でコンパイルだけします",
      tools: [javac],
      windows: 'javac -encoding UTF-8 -d "${out}" "${src}"',
      unix: 'javac -encoding UTF-8 -d "${out}" "${src}"',
      result: "${out}",
    },
  ],
  typescript: [
    {
      id: "ts-js",
      label: "JavaScript に変換",
      detail: "tsc で .js を作ります（ブラウザや Node.js で動かせます）",
      tools: [RUN_TOOLS.typescript],
      windows: 'npx --yes -p typescript tsc "${src}" --outDir "${out}" --target es2020 --module es2020',
      unix: 'npx --yes -p typescript tsc "${src}" --outDir "${out}" --target es2020 --module es2020',
      result: "${out}/${name}.js",
    },
  ],
};

/** Java の main があるクラス名（package があれば付ける） */
export function javaMainClass(text: string, fallback: string): string {
  const pkg = /^\s*package\s+([\w.]+)\s*;/m.exec(text)?.[1];
  const withMain = /(?:public\s+)?(?:final\s+)?class\s+(\w+)[^{]*\{[\s\S]*?\bstatic\s+void\s+main\s*\(/.exec(text)?.[1];
  const pub = /public\s+(?:final\s+)?class\s+(\w+)/.exec(text)?.[1];
  const name = withMain ?? pub ?? fallback;
  return pkg ? `${pkg}.${name}` : name;
}

/** Unity のスクリプト（Unity エディタでしかビルドできない） */
export function isUnityScript(text: string): boolean {
  return /^\s*using\s+UnityEngine\b/m.test(text) || /:\s*MonoBehaviour\b/.test(text);
}

export function fillBuild(tpl: string, vars: Record<string, string>, windows: boolean): string {
  const esc = windows ? (v: string) => v.replace(/[`$"]/g, (ch) => "`" + ch) : (v: string) => v.replace(/(["$`\\])/g, "\\$1");
  return tpl.replace(/\$\{(\w+)\}/g, (m, k: string) => {
    if (!(k in vars)) return m;
    // ${py} はコマンドそのもの（& "C:\…\python.exe" など）なので、そのまま
    return k === "py" || k === "main" ? vars[k] : esc(vars[k]);
  });
}
