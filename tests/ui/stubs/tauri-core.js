// 画面確認用の偽ネイティブ層（メモリ上のファイルシステム）
const files = {
  "/demo/main.py": 'import math\n\n\ndef area(radius: float) -> float:\n    """円の面積を返す"""\n    return math.pi * radius ** 2\n\n\nif __name__ == "__main__":\n    for r in range(1, 4):\n        print(f"r={r}: {area(r):.2f}")\n',
  "/demo/src/app.ts": 'export function greet(name: string) {\n  return `こんにちは、${name}`;\n}\n',
  "/demo/src/lib.rs": "pub fn add(a: i32, b: i32) -> i32 {\n    a + b\n}\n",
  "/demo/構築メモ.txt": "###構築py###\n以下ループ\n    空リストaを作る。\n    実行時にコンマ区切りの数字を入力することを求め、aにコンマごとに格納する。\n    実行場所のファイルをインプットする……\n    aを表示する\n###終わり###\n",
  "/demo/README.md": "# demo\n\nサンプルプロジェクトです。**Aizome** で Markdown を書くと、右側にすぐ反映されます。\n\n## 使い方\n\n- `main.py` を開いて F5 で実行\n- 検索は Ctrl+Shift+F\n\n```python\nprint(area(2))\n```\n",
  "/demo/.gitignore": "node_modules\n",
};
window.__fs = files;
const dirs = new Set(["/demo", "/demo/src", "/demo/assets"]);
window.__aizomeEvents = window.__aizomeEvents || {};
const emit = (name, payload) => (window.__aizomeEvents[name] || []).forEach((cb) => cb({ payload }));
let ptySeq = 0;
let aiSeq = 0;

window.__calls = [];
export async function invoke(cmd, args = {}) {
  window.__calls.push(cmd);
  switch (cmd) {
    case "run_capture":
      throw new Error("no python in test");
    case "find_tool":
      return null;
    case "print_page":
      window.__printed = true;
      return null;
    case "app_info":
      return { version: "0.2.0", tauri: "2.x" };
    case "sys_info":
      return { os: "linux", home: "/home/me", defaultShell: "/bin/zsh", pathSep: "/" };
    case "fs_list_dir": {
      const p = args.path.replace(/\/$/, "");
      const out = [];
      for (const d of dirs) if (d !== p && d.startsWith(p + "/") && !d.slice(p.length + 1).includes("/")) out.push({ name: d.slice(p.length + 1), path: d, isDir: true });
      for (const f of Object.keys(files)) if (f.startsWith(p + "/") && !f.slice(p.length + 1).includes("/")) out.push({ name: f.slice(p.length + 1), path: f, isDir: false });
      return out.sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name));
    }
    case "fs_walk":
      return Object.keys(files);
    case "fs_read_file":
      if (!(args.path in files)) throw "not found";
      return files[args.path];
    case "fs_read_file_enc":
      if (!(args.path in files)) throw "not found";
      return { text: files[args.path], encoding: args.encoding || (args.path.endsWith(".txt") ? "shift_jis" : "utf-8"), bom: false, lossy: false, eol: "lf" };
    case "fs_write_file_enc":
      if (args.encoding === "shift_jis" && /[\u{1F300}-\u{1FAFF}]/u.test(args.content)) throw "UNMAPPABLE: 😀";
      files[args.path] = args.content;
      window.__lastWrite = { path: args.path, encoding: args.encoding, bom: args.bom, eol: args.eol };
      return null;
    case "fs_write_file":
      files[args.path] = args.content;
      return null;
    case "fs_create_file":
      files[args.path] = "";
      return null;
    case "fs_create_dir":
      dirs.add(args.path);
      return null;
    case "take_open_paths":
      if (window.__openOnce) return [];
      window.__openOnce = true;
      return ["/demo/main.py"];
    case "os_integration_status":
      return { supported: true, registered: true };
    case "os_integration_set":
      return null;
    case "fs_is_dir":
      return dirs.has(args.path);
    case "fs_exists":
      return args.path in files || dirs.has(args.path);
    case "fs_read_data_url":
      return (await fetch("/bg.b64")).text();
    case "fs_search": {
      const hits = [];
      const re = new RegExp(args.regex ? args.query : args.query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), args.caseSensitive ? "" : "i");
      for (const [path, text] of Object.entries(files)) text.split("\n").forEach((l, i) => { const m = re.exec(l); if (m) hits.push({ path, line: i + 1, col: m.index + 1, text: l.trim() }); });
      return { hits, truncated: false, filesSearched: Object.keys(files).length };
    }
    case "git_status":
      return { isRepo: true, branch: "main", ahead: 0, behind: 0, files: [{ path: "main.py", status: "M" }, { path: "src/lib.rs", status: "U" }] };
    case "fs_rename":
    case "fs_remove":
      return null;
    case "pty_spawn": {
      const id = ++ptySeq;
      setTimeout(() => emit("pty:data", { id, data: "\x1b[36mme@aizome\x1b[0m \x1b[2m~/demo\x1b[0m $ " }), 50);
      return id;
    }
    case "pty_write": {
      const id = args.id;
      const d = args.data;
      if (d.endsWith("\r")) {
        const cmd = d.slice(0, -1);
        const out = cmd.includes("python3")
          ? "\r\nr=1: 3.14\r\nr=2: 12.57\r\nr=3: 28.27\r\n"
          : "\r\n";
        setTimeout(() => emit("pty:data", { id, data: cmd + out + "\x1b[36mme@aizome\x1b[0m \x1b[2m~/demo\x1b[0m $ " }), 30);
      }
      return null;
    }
    case "pty_shells":
      return [{ name: "PowerShell", command: "powershell.exe" }, { name: "コマンドプロンプト (cmd)", command: "cmd.exe" }, { name: "Git Bash", command: "\"C:\\Program Files\\Git\\bin\\bash.exe\" --login -i" }, { name: "WSL (Linux)", command: "wsl.exe" }];
    case "pty_resize":
    case "pty_kill":
      return null;
    case "ai_complete": {
      const id = ++aiSeq;
      if (args.req.prompt.includes("Japanese description")) {
        const code = "```python\n# 仮定: 空の入力で終了する\n# 仮定: 実行場所のファイルは data.txt とする\nimport os\n\nwhile True:\n    # 空リストaを作る\n    a = []\n    # コンマ区切りの数字を入力してもらい、aに格納する\n    line = input(\"数字をコンマ区切りで入力（空で終了）: \").strip()\n    if not line:\n        break\n    try:\n        a = [float(x) for x in line.split(\",\") if x.strip()]\n    except ValueError:\n        print(\"数字だけを入力してください\")\n        continue\n    # aを表示する\n    print(a)\n```";
        const parts = code.match(/[\s\S]{1,40}/g);
        parts.forEach((p, i) => setTimeout(() => emit("ai:chunk", { id, text: p, done: false, error: null }), 60 + i * 25));
        setTimeout(() => emit("ai:chunk", { id, text: "", done: true, error: null }), 80 + parts.length * 25);
        return id;
      }
      const text = /prin$/.test(args.req.prompt) ? "t(i)" : "    return math.pi * radius ** 2";
      window.__lastPrompt = args.req.prompt.slice(-80);
      setTimeout(() => emit("ai:chunk", { id, text, done: false, error: null }), 120);
      setTimeout(() => emit("ai:chunk", { id, text: "", done: true, error: null }), 200);
      return id;
    }
    case "ai_diagnose":
      return { reachable: true, error: null, version: "0.40.8", models: ["qwen2.5-coder:7b", "llama3.2:3b"], modelFound: ["qwen2.5-coder:7b", "llama3.2:3b"].includes(args.model), local: true };
    case "ai_autodetect":
      return { endpoint: "http://127.0.0.1:11434", models: ["qwen2.5-coder:7b", "llama3.2:3b"], source: "usb", ollamaPath: "C:/Users/me/AppData/Local/Programs/Ollama/ollama.exe", modelsDir: "E:\\ollama-models", foundDirs: ["E:\\ollama-models"], foundGguf: [], error: null };
    case "ai_use_models_dir":
      return { endpoint: "http://127.0.0.1:11435", models: ["qwen2.5-coder:1.5b"], source: "folder", ollamaPath: "", modelsDir: args.dir, foundDirs: [], foundGguf: [], error: null };
    case "ai_import_gguf":
      return args.name;
    case "update_check":
      return { current: "0.5.0", latest: "0.6.0", available: true, manualOnly: false, notes: "## 0.6.0\n\n- 便利な機能を追加しました\n- 不具合を直しました", downloadUrl: "https://github.com/zjybttvmpr-ux/aizome/releases/download/v0.6.0/Aizome_0.6.0_x64-setup.exe", pageUrl: "" };
    case "update_install": {
      [10, 40, 75, 100].forEach((p, i) => setTimeout(() => emit("update:progress", { received: p * 1e5, total: 1e7 }), i * 200));
      await new Promise((r) => setTimeout(r, 900));
      return null;
    }
    case "ai_cancel":
      return null;
    case "ai_models":
      return ["qwen2.5-coder:1.5b", "qwen2.5-coder:7b", "deepseek-coder-v2:16b"];
    case "ext_dir":
      return "/home/me/.local/share/dev.aizome.editor/extensions";
    case "ext_list":
      return [];
    default:
      console.log("UNKNOWN " + cmd);
      throw new Error("unknown " + cmd);
  }
}
