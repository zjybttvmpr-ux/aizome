// 検索欄に「/」を打つと出る、便利機能の一覧。
// /help のような英語のほか、/ヘルプ /へるぷ /使い方 のような日本語や、ローマ字でも呼び出せる
import { t } from "../core/i18n";
import { commands, formatKey } from "../core/commands";
import { normalizeQuery } from "../core/jpText";
import { fuzzyScore, palette, type PickItem } from "./palette";

export interface SlashCommand {
  /** /help の help の部分 */
  name: string;
  /** 別名（日本語・ひらがな・ローマ字など） */
  aliases: string[];
  title: () => string;
  desc?: () => string;
  icon?: string;
  group: string;
  /** 同じ働きのコマンド（ショートカットの表示に使う） */
  command?: string;
  /** 「/計算 1+2」のように後ろに書く値。ここに説明を書くと、値なしで選んだときに入力をうながす */
  argHint?: () => string;
  /** 値を書いている途中に結果を見せる（例：= 3） */
  preview?: (arg: string) => string | null;
  /** 値に応じて複数の候補を出す（例：日付の書き方） */
  expand?: (arg: string) => { label: string; detail?: string; run: () => unknown }[];
  run?: (arg: string) => unknown;
}

const registry: SlashCommand[] = [];

export function registerSlash(...cmds: SlashCommand[]) {
  for (const c of cmds) {
    const i = registry.findIndex((x) => x.name === c.name);
    if (i >= 0) registry.splice(i, 1);
    registry.push(c);
  }
}

export function listSlash(): SlashCommand[] {
  return [...registry];
}

/** 呼び出し名の一覧（ヘルプ用） */
export function slashNames(c: SlashCommand): string[] {
  return [c.name, ...c.aliases.filter((a) => !/^[a-z]+$/.test(a) || a.length <= 2)];
}

function keyOf(c: SlashCommand): string | undefined {
  const cmd = c.command ? commands.get(c.command) : undefined;
  return cmd?.key ? formatKey(cmd.key) : undefined;
}

function score(c: SlashCommand, head: string): number {
  if (!head) return 1;
  const q = normalizeQuery(head);
  let best = 0;
  for (const k of [c.name, ...c.aliases, c.title()]) {
    const key = normalizeQuery(k);
    if (key === q) best = Math.max(best, 1000);
    else if (key.startsWith(q)) best = Math.max(best, 600 - key.length);
    else best = Math.max(best, fuzzyScore(q, key) * (key.includes(q) ? 3 : 1));
  }
  return best;
}

type Action = () => unknown;

export function slashItems(query: string): PickItem<Action>[] {
  const body = query.replace(/^[/／]/, "");
  const m = /^(\S*)(?:[\s　]+([\s\S]*))?$/.exec(body)!;
  const head = m[1];
  const arg = (m[2] ?? "").trim();
  const hasArg = m[2] !== undefined;
  const ranked = registry
    .map((c) => ({ c, s: score(c, head) }))
    .filter((x) => x.s > 0 && (!hasArg || x.s >= 300))
    .sort((a, b) => b.s - a.s || 0);
  const items: PickItem<Action>[] = [];
  for (const { c } of ranked) {
    if (c.expand && (hasArg || ranked.length <= 3 || head)) {
      const subs = c.expand(arg);
      if (subs.length && (hasArg || ranked[0].c === c)) {
        for (const s of subs) items.push({ label: s.label, detail: s.detail ?? `/${c.name}`, icon: c.icon, value: s.run });
        continue;
      }
    }
    const preview = hasArg && c.preview ? c.preview(arg) : null;
    const needsArg = !!c.argHint && !arg;
    items.push({
      label: preview ? `${c.title()}  ${preview}` : c.title(),
      detail: `/${c.name}${c.argHint ? ` ${arg || c.argHint()}` : ""}${c.desc ? " — " + c.desc() : ""}`,
      hint: keyOf(c),
      icon: c.icon ?? "chevron",
      value: needsArg ? () => openSlashPalette(`/${c.name} `) : () => c.run?.(arg),
    });
  }
  return items;
}

/** 「/」の一覧を開く。「/」を消したら、ファイルを探す画面に戻る */
export function openSlashPalette(initial = "/", back?: (q: string) => void): Promise<unknown> {
  return palette
    .open<Action>(
      {
        placeholder: t("slash.placeholder"),
        items: slashItems,
        onQueryPrefix: (q) => {
          if (!/^[/／]/.test(q) && back) {
            palette.close();
            back(q);
            return true;
          }
          return false;
        },
      },
      initial,
    )
    .then((run) => run?.());
}
