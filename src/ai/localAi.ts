// PC の中の AI を探して使える状態にする（起動時・エラー時・設定画面から呼ぶ）
import { ai, type AiDetected } from "../core/platform";
import { settings } from "../core/settings";
import { basename } from "../core/paths";
import { t } from "../core/i18n";
import { toast } from "../ui/toast";
import { completer } from "./completer";

/** エラー文字列を、画面に出す説明に変える */
export function describeAiError(raw: string): string {
  const model = settings.get("ai.model");
  if (raw.startsWith("MODEL_NOT_FOUND")) return t("aiErr.modelNotFound", { model });
  if (raw.startsWith("NOT_RUNNING")) return t("aiErr.notRunning");
  if (raw.startsWith("TIMEOUT")) return t("aiErr.timeout");
  if (raw.startsWith("OLLAMA_NOT_FOUND")) return t("aiErr.ollamaNotFound");
  if (raw.startsWith("NO_MODELS")) return t("aiErr.noModels");
  if (raw.startsWith("START_FAILED")) return t("aiErr.startFailed");
  if (raw.startsWith("NOT_MODELS_DIR")) return t("aiErr.notModelsDir");
  if (raw.startsWith("NOT_GGUF")) return t("aiErr.notGguf");
  if (raw.startsWith("IMPORT_FAILED")) return t("aiErr.importFailed", { err: raw.replace(/^IMPORT_FAILED:\s*/, "") });
  if (raw.startsWith("CONNECT_FAILED")) return t("aiErr.connectFailed");
  if (raw.startsWith("AI_PAUSED")) return t("aiErr.paused");
  if (raw.startsWith("RUNNER_CRASHED") || /health resp|llama runner|runner process/i.test(raw)) return t("aiErr.runnerCrashed");
  if (/HTTP 40[13]/.test(raw)) return t("aiErr.auth");
  return raw;
}

const norm = (m: string) => (m.includes(":") ? m.toLowerCase() : `${m.toLowerCase()}:latest`);

/** 入っているモデルから、コード補完に向いたものを選ぶ */
export function pickBestModel(models: string[]): string | undefined {
  const score = (m: string) => {
    const s = m.toLowerCase();
    let v = 0;
    if (s.includes("coder") || s.includes("code")) v += 100;
    if (s.includes("qwen")) v += 20;
    if (s.includes("deepseek") || s.includes("starcoder") || s.includes("codegemma")) v += 15;
    // 補完は軽いほうが快適。7b 前後を少しだけ優先
    const size = /(\d+(?:\.\d+)?)b/.exec(s);
    if (size) {
      const b = Number(size[1]);
      v += b <= 8 ? 10 - Math.abs(b - 3) : -b / 4;
    }
    if (s.includes("embed")) v -= 1000;
    return v;
  };
  return [...models].sort((a, b) => score(b) - score(a))[0];
}

function modelNameFromFile(path: string): string {
  return basename(path)
    .replace(/\.gguf$/i, "")
    .replace(/-0000\d-of-0000\d$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .slice(0, 60);
}

/** 設定のモデルがなければ、入っているものに切り替える。切り替えたら名前を返す */
function applyModels(models: string[]): string | null {
  if (!models.length) return null;
  const current = settings.get("ai.model");
  if (models.some((m) => norm(m) === norm(current))) return null;
  const best = pickBestModel(models);
  if (!best) return null;
  settings.set("ai.model", best);
  return best;
}

let running: Promise<AiDetected | null> | null = null;

/**
 * PC の中の AI を探す。
 * - 動いている Ollama を探し、なければ起動する
 * - USB などにある ollama-models フォルダや .gguf ファイルも読み込む
 */
export function ensureLocalAi(opts: { quiet?: boolean } = {}): Promise<AiDetected | null> {
  if (settings.get("ai.provider") !== "ollama" || !settings.get("ai.enabled")) return Promise.resolve(null);
  running ??= (async () => {
    try {
      const d = await ai.autodetect(settings.get("ai.endpoint"));
      if (d.endpoint && d.endpoint !== settings.get("ai.endpoint")) settings.set("ai.endpoint", d.endpoint);

      // モデルがひとつもなく、USB などに .gguf があれば取り込む
      if (d.endpoint && !d.models.length && d.foundGguf.length) {
        const file = d.foundGguf[0];
        toast(t("localAi.importing", { name: basename(file) }), "info", 15000);
        try {
          const name = await ai.importGguf(file, modelNameFromFile(file), d.endpoint);
          d.models = [name];
          d.error = null;
          toast(t("localAi.imported", { name }), "success");
        } catch (err) {
          toast(describeAiError(String(err)), "error", 10000);
        }
      }

      const switched = applyModels(d.models);
      if (d.models.length) {
        completer.setStatus("idle");
        // 自動で起動したときだけ知らせる（もともと動いていたときは静かに）
        if (d.source === "usb") toast(t("localAi.usb", { dir: d.modelsDir ?? "" }), "success");
        else if (d.source === "started") toast(t("localAi.started"), "success");
        if (switched) toast(t("localAi.switched", { model: switched }), "info", 7000);
      } else if (d.error) {
        completer.setStatus("error", d.error);
        if (!opts.quiet) toast(describeAiError(d.error), "warn", 10000);
      }
      return d;
    } catch (err) {
      if (!opts.quiet) toast(describeAiError(String(err)), "error");
      return null;
    } finally {
      running = null;
    }
  })();
  return running;
}

/** 選んだモデルファイル（.gguf）を取り込んで使う */
export async function useModelFile(path: string): Promise<boolean> {
  const d = await ensureLocalAi({ quiet: true });
  const endpoint = d?.endpoint ?? settings.get("ai.endpoint");
  toast(t("localAi.importing", { name: basename(path) }), "info", 15000);
  try {
    const name = await ai.importGguf(path, modelNameFromFile(path), endpoint);
    settings.set("ai.model", name);
    completer.setStatus("idle");
    toast(t("localAi.imported", { name }), "success");
    return true;
  } catch (err) {
    toast(describeAiError(String(err)), "error", 10000);
    return false;
  }
}

/** 選んだモデルフォルダ（ollama-models）で Ollama を起動して使う */
export async function useModelsDir(dir: string): Promise<boolean> {
  try {
    const d = await ai.useModelsDir(dir);
    if (d.endpoint) settings.set("ai.endpoint", d.endpoint);
    if (!d.models.length) {
      toast(describeAiError("NO_MODELS"), "warn");
      return false;
    }
    const switched = applyModels(d.models);
    completer.setStatus("idle");
    toast(t("localAi.folder", { n: String(d.models.length) }) + (switched ? " " + t("localAi.switched", { model: switched }) : ""), "success", 7000);
    return true;
  } catch (err) {
    toast(describeAiError(String(err)), "error", 10000);
    return false;
  }
}
