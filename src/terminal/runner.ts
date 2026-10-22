// 「▶ 実行」の設定。拡張機能が言語ごとに登録する
import { basename, dirname, extname, stripExt } from "../core/paths";

export interface RunConfig {
  id: string;
  label: string;
  /** 対象の拡張子 例: [".py"] */
  extensions: string[];
  /** ${file} ${fileDir} ${fileBase} ${fileNoExt} ${workspace} が使える */
  command: string;
  /** Windows 用（PowerShell）。なければ command を使う */
  windows?: string;
  source?: string;
}

const configs: RunConfig[] = [];

export function addRunConfig(c: RunConfig): () => void {
  configs.unshift(c); // 後から入れた拡張機能が優先
  return () => {
    const i = configs.indexOf(c);
    if (i >= 0) configs.splice(i, 1);
  };
}

export function findRunConfig(path: string): RunConfig | undefined {
  const e = extname(path);
  return configs.find((c) => c.extensions.map((x) => x.toLowerCase()).includes(e));
}

export function listRunConfigs(): RunConfig[] {
  return [...configs];
}

export function expandCommand(c: RunConfig, file: string, workspace: string, os: string): string {
  const tpl = os === "windows" && c.windows ? c.windows : c.command;
  const vars: Record<string, string> = {
    file,
    fileDir: dirname(file),
    fileBase: basename(file),
    fileNoExt: stripExt(file),
    fileBaseNoExt: stripExt(basename(file)),
    workspace: workspace || dirname(file),
  };
  // PowerShell の "…" の中では $ と ` が特別な意味になるので、パスの中のものは文字として扱わせる
  const esc = os === "windows" && c.windows ? (v: string) => v.replace(/[`$"]/g, (ch) => "`" + ch) : (v: string) => v;
  return tpl.replace(/\$\{(\w+)\}/g, (m, k: string) => (k in vars ? esc(vars[k]) : m));
}
