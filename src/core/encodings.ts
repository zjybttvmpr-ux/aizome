// 文字コードの一覧（表示名と、保存するときの指定）
export interface EncodingChoice {
  /** 設定などで使う ID */
  id: "utf-8" | "utf-8-bom" | "shift_jis" | "euc-jp" | "utf-16le" | "utf-16be";
  label: string;
  /** Rust 側に渡す文字コード名 */
  encoding: string;
  bom: boolean;
  note: string;
}

export const ENCODINGS: EncodingChoice[] = [
  { id: "utf-8", label: "UTF-8", encoding: "utf-8", bom: false, note: "ふつうはこれ（Python・Web・Mac・Linux の標準）" },
  { id: "utf-8-bom", label: "UTF-8（BOM 付き）", encoding: "utf-8", bom: true, note: "Excel や古いメモ帳で文字化けするとき" },
  { id: "shift_jis", label: "Shift_JIS", encoding: "shift_jis", bom: false, note: "Windows の古い日本語ファイル（cp932）" },
  { id: "euc-jp", label: "EUC-JP", encoding: "euc-jp", bom: false, note: "古い Linux・Web の日本語ファイル" },
  { id: "utf-16le", label: "UTF-16 LE", encoding: "utf-16le", bom: true, note: "Windows の Unicode（メモ帳の「Unicode」）" },
  { id: "utf-16be", label: "UTF-16 BE", encoding: "utf-16be", bom: true, note: "" },
];

export function encodingLabel(encoding: string, bom: boolean): string {
  const e = ENCODINGS.find((x) => x.encoding === encoding && (x.encoding !== "utf-8" || x.bom === bom));
  return e?.label ?? encoding.toUpperCase();
}

export function encodingById(id: string): EncodingChoice {
  return ENCODINGS.find((e) => e.id === id) ?? ENCODINGS[0];
}
