// 拡張機能から追加された「拡張子 → 既存言語」の対応表
import { extname } from "./paths";

const aliases = new Map<string, string>();

export function addLanguageAlias(ext: string, basedOnExt: string): () => void {
  const e = ext.startsWith(".") ? ext.toLowerCase() : "." + ext.toLowerCase();
  const b = basedOnExt.startsWith(".") ? basedOnExt : "." + basedOnExt;
  aliases.set(e, b);
  return () => aliases.delete(e);
}

/** 言語判定用のファイル名を返す（別名があれば置き換える） */
export function filenameForLanguage(filename: string): string {
  const alias = aliases.get(extname(filename));
  return alias ? "file" + alias : filename;
}
