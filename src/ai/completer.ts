// ローカルAIへのリクエストを管理する。最新の1件だけを生かし、古いものは中断する。
import { ai, type AiChunk } from "../core/platform";
import { settings } from "../core/settings";

/**
 * AI が一度に読める量（トークン数）。補完とチャットで同じ値にする
 * （値が変わると Ollama がモデルを読み込み直して遅くなるため）
 */
const NUM_CTX = 8192;

export type AiStatus = "off" | "idle" | "thinking" | "error";

interface Pending {
  onText: (full: string) => void;
  resolve: (full: string) => void;
  reject: (err: Error) => void;
  text: string;
}

const pending = new Map<number, Pending>();
const cancelled = new Set<number>();
/** ID の登録より先に届いたチャンク（invoke の戻りとイベントの到着順は保証されない） */
const early = new Map<number, AiChunk[]>();
let listening: Promise<unknown> | null = null;

function deliver(c: AiChunk) {
  const p = pending.get(c.id);
  if (!p) {
    if (cancelled.has(c.id)) {
      if (c.done) cancelled.delete(c.id);
      return;
    }
    const list = early.get(c.id) ?? [];
    list.push(c);
    early.set(c.id, list);
    if (early.size > 50) early.delete(early.keys().next().value as number);
    return;
  }
  if (c.text) {
    p.text += c.text;
    p.onText(p.text);
  }
  if (c.done) {
    pending.delete(c.id);
    if (c.error?.startsWith("RUNNER_CRASHED")) completer.memoryProblem();
    if (c.error) p.reject(new Error(c.error));
    else p.resolve(p.text);
  }
}

function register(id: number, p: Pending) {
  pending.set(id, p);
  const queued = early.get(id);
  if (queued) {
    early.delete(id);
    queued.forEach(deliver);
  }
}

function ensureListener() {
  listening ??= ai.onChunk(deliver);
  return listening;
}

type StatusListener = (s: AiStatus, detail?: string) => void;

class Completer {
  private inlineId: number | null = null;
  /** 最近の応答時間（ミリ秒）の平均。遅い PC では候補を頼む回数を減らす */
  private latency = 0;
  private inlineSeq = 0;
  private listeners = new Set<StatusListener>();
  status: AiStatus = settings.get("ai.enabled") ? "idle" : "off";
  lastError = "";
  /** メモリ不足で、使うかどうかを聞いている（または「あとで」にした）あいだは AI に頼まない */
  paused = false;
  private memoryListeners = new Set<() => void>();

  /** メモリ不足で AI が動かなかったときに呼ばれる（画面で「使うかどうか」を聞く） */
  onMemoryProblem(cb: () => void) {
    this.memoryListeners.add(cb);
    return () => this.memoryListeners.delete(cb);
  }

  memoryProblem() {
    if (this.paused) return;
    this.paused = true;
    this.cancelInline();
    this.setStatus("error", "RUNNER_CRASHED");
    for (const l of this.memoryListeners) l();
  }

  /** 休止をやめて、また AI に頼めるようにする */
  resume() {
    this.paused = false;
    this.setStatus(settings.get("ai.enabled") ? "idle" : "off");
  }

  onStatus(cb: StatusListener) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  setStatus(s: AiStatus, detail = "") {
    this.status = s;
    if (s === "error") this.lastError = detail;
    for (const l of this.listeners) l(s, detail);
  }

  private base() {
    return {
      provider: settings.get("ai.provider"),
      endpoint: settings.get("ai.endpoint"),
      model: settings.get("ai.model"),
      apiKey: settings.get("ai.apiKey") || undefined,
      cpu: settings.get("ai.cpuOnly") || undefined,
    };
  }

  private async request(
    req: { prompt: string; suffix?: string; maxTokens: number; temperature: number; stop?: string[]; repeatPenalty?: number; numCtx?: number },
    onText: (full: string) => void,
  ): Promise<{ id: number; done: Promise<string> }> {
    if (this.paused) throw new Error("AI_PAUSED");
    await ensureListener();
    const id = await ai.start({ ...this.base(), ...req });
    const done = new Promise<string>((resolve, reject) => {
      register(id, { onText, resolve, reject, text: "" });
    });
    return { id, done };
  }

  /** エディタのインライン補完。新しい呼び出しが来たら前のものは捨てる */
  async inline(
    ctx: { prefix: string; suffix: string; maxTokens?: number },
    onText: (full: string) => void,
  ): Promise<string | null> {
    if (!settings.get("ai.enabled") || this.paused) return null;
    this.cancelInline();
    const seq = ++this.inlineSeq;
    this.setStatus("thinking");
    try {
      const { id, done } = await this.request(
        {
          prompt: ctx.prefix,
          // 後ろが空だと Ollama がチャット用の書式に切り替えてしまうので、改行を1つ渡して途中埋めのままにする
          suffix: ctx.suffix || "\n",
          maxTokens: ctx.maxTokens ?? settings.get("ai.maxTokens"),
          temperature: 0.1,
          // コードは同じ記号や名前をくり返すのが普通なので、くり返しの抑制はごく弱く（強いと候補が崩れる）
          repeatPenalty: 1.02,
          // 前後のコードを切り捨てずに読ませる
          numCtx: NUM_CTX,
          // チャット口調で話し始めたり、コードの囲み（```）を書き出したら止める
          stop: ["<|endoftext|>", "<|file_sep|>", "<|im_end|>", "<|fim_prefix|>", "```"],
        },
        onText,
      );
      if (seq !== this.inlineSeq) {
        // 待っている間に次の要求が来た
        ai.cancel(id).catch(() => {});
        return null;
      }
      this.inlineId = id;
      const started = performance.now();
      const text = await done;
      const took = performance.now() - started;
      this.latency = this.latency ? this.latency * 0.7 + took * 0.3 : took;
      if (this.inlineId === id) {
        this.inlineId = null;
        this.setStatus("idle");
      }
      return text;
    } catch (err) {
      const msg = String((err as Error).message ?? err);
      if (!this.paused) this.setStatus("error", msg);
      return null;
    }
  }

  /** 次の候補を頼むまでの待ち時間。応答が遅いほど長く待って、PC の負担を減らす */
  recommendedDelay(): number {
    const base = settings.get("ai.debounceMs");
    if (this.latency < 800) return base;
    return Math.min(1500, Math.max(base, Math.round(this.latency * 0.5)));
  }

  cancelInline() {
    this.inlineSeq++;
    if (this.status === "thinking" && this.inlineId === null) this.setStatus("idle");
    if (this.inlineId !== null) {
      const id = this.inlineId;
      this.inlineId = null;
      pending.delete(id);
      cancelled.add(id);
      if (cancelled.size > 200) cancelled.delete(cancelled.values().next().value as number);
      ai.cancel(id).catch(() => {});
      if (this.status === "thinking") this.setStatus("idle");
    }
  }

  /** 拡張機能などからの、指示文による生成 */
  async ask(
    prompt: string,
    opts: { maxTokens?: number; temperature?: number; onText?: (full: string) => void; onStart?: (cancel: () => void) => void } = {},
  ): Promise<string> {
    const { id, done } = await this.request(
      { prompt, maxTokens: opts.maxTokens ?? 512, temperature: opts.temperature ?? 0.3, repeatPenalty: 1.05, numCtx: NUM_CTX },
      opts.onText ?? (() => {}),
    );
    opts.onStart?.(() => {
      const p = pending.get(id);
      pending.delete(id);
      cancelled.add(id);
      ai.cancel(id).catch(() => {});
      p?.resolve(p.text);
    });
    return done;
  }

  async models(): Promise<string[]> {
    const b = this.base();
    return ai.models(b.provider, b.endpoint, b.apiKey);
  }
}

export const completer = new Completer();
