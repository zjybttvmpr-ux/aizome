// 行の右の表示（自動判定・説明）を描き直す合図。AI の予想や、本物の Python の確認が終わったときに送る
import { StateEffect } from "@codemirror/state";

export const inferUpdated = StateEffect.define<null>();
