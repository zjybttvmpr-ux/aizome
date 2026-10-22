// ローカルAIへのリクエストを管理する。最新の1件だけを生かし、古いものは中断する。
import { ai, type AiChunk } from "../core/platform";
import { settings } from "../core/settings";

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
  private inlineSeq = 0;
  private listeners = new Set<StatusListener>();
  status: AiStatus = settings.get("ai.enabled") ? "idle" : "off";
  lastError = "";

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
    };
  }

  private async request(
    req: { prompt: string; suffix?: string; maxTokens: number; temperature: number; stop?: string[] },
    onText: (full: string) => void,
  ): Promise<{ id: number; done: Promise<string> }> {
    await ensureListener();
    const id = await ai.start({ ...this.base(), ...req });
    const done = new Promise<string>((resolve, reject) => {
      register(id, { onText, resolve, reject, text: "" });
    });
    return { id, done };
  }

  /** エディタのインライン補完。新しい呼び出しが来たら前のものは捨てる */
  async inline(ctx: { prefix: string; suffix: string }, onText: (full: string) => void): Promise<string | null> {
    if (!settings.get("ai.enabled")) return null;
    this.cancelInline();
    const seq = ++this.inlineSeq;
    this.setStatus("thinking");
    try {
      const { id, done } = await this.request(
        {
          prompt: ctx.prefix,
          suffix: ctx.suffix,
          maxTokens: settings.get("ai.maxTokens"),
          temperature: 0.15,
        },
        onText,
      );
      if (seq !== this.inlineSeq) {
        // 待っている間に次の要求が来た
        ai.cancel(id).catch(() => {});
        return null;
      }
      this.inlineId = id;
      const text = await done;
      if (this.inlineId === id) {
        this.inlineId = null;
        this.setStatus("idle");
      }
      return text;
    } catch (err) {
      this.setStatus("error", String((err as Error).message ?? err));
      return null;
    }
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
  async ask(prompt: string, opts: { maxTokens?: number; temperature?: number } = {}): Promise<string> {
    const { done } = await this.request(
      { prompt, maxTokens: opts.maxTokens ?? 512, temperature: opts.temperature ?? 0.3 },
      () => {},
    );
    return done;
  }

  async models(): Promise<string[]> {
    const b = this.base();
    return ai.models(b.provider, b.endpoint, b.apiKey);
  }
}

export const completer = new Completer();
