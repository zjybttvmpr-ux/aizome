// コード辞書の型。
// code の中の ⟨名前⟩ は、入れたあと Tab で順に書き換えられる場所。⟨⟩ は最後にカーソルが来る場所。
// 字下げはスペース 4 つで書く（入れるときに、そのファイルの字下げに合わせる）

/** [分類, 見出し（やりたいこと）, 探すための言葉, コード, ひとこと説明] */
export type DictEntry = [category: string, title: string, keys: string, code: string, note?: string];

export interface DictLanguage {
  id: string;
  label: string;
  /** このファイルの拡張子なら自動で選ぶ */
  exts: string[];
  entries: DictEntry[];
}
