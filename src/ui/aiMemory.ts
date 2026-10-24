// AI がメモリ不足で動かなかったときに、警告を出して「それでも使うか」を聞く
import { completer } from "../ai/completer";
import { settings } from "../core/settings";
import { t } from "../core/i18n";
import { choose } from "./dialog";
import { toast } from "./toast";

type Answer = "cpu" | "retry" | "off" | "later";
let asking = false;

export async function askAboutMemory() {
  if (asking) return;
  asking = true;
  const onCpu = settings.get("ai.cpuOnly");
  const choices: { label: string; value: Answer; kind?: "primary" | "plain" | "danger" }[] = [
    ...(onCpu ? [] : [{ label: t("aiMem.cpu"), value: "cpu" as const, kind: "primary" as const }]),
    { label: t("aiMem.retry"), value: "retry", kind: onCpu ? "primary" : "plain" },
    { label: t("aiMem.off"), value: "off", kind: "plain" },
  ];
  const answer = await choose<Answer>(t("aiMem.title"), t(onCpu ? "aiMem.textCpu" : "aiMem.text"), choices, "later");
  asking = false;
  if (answer === "cpu") {
    settings.set("ai.cpuOnly", true);
    completer.resume();
    toast(t("aiMem.cpuOn"), "info");
  } else if (answer === "retry") {
    completer.resume();
  } else if (answer === "off") {
    completer.resume();
    settings.set("ai.enabled", false);
  } else {
    // Esc などで閉じた：休ませたまま（右上の AI の表示から選び直せる）
    toast(t("aiMem.paused"), "warn", 8000);
  }
}

export function watchAiMemory() {
  completer.onMemoryProblem(() => void askAboutMemory());
}
