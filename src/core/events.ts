type Handler<T> = (payload: T) => void;

export class Emitter<E extends Record<string, unknown>> {
  private handlers = new Map<keyof E, Set<Handler<never>>>();

  on<K extends keyof E>(event: K, handler: Handler<E[K]>): () => void {
    let set = this.handlers.get(event);
    if (!set) this.handlers.set(event, (set = new Set()));
    set.add(handler as Handler<never>);
    return () => set!.delete(handler as Handler<never>);
  }

  emit<K extends keyof E>(event: K, payload: E[K]): void {
    for (const h of this.handlers.get(event) ?? []) {
      try {
        (h as Handler<E[K]>)(payload);
      } catch (err) {
        console.error(`[event ${String(event)}]`, err);
      }
    }
  }
}

export interface AppEvents extends Record<string, unknown> {
  "workspace:changed": { root: string | null };
  "file:opened": { path: string };
  "file:saved": { path: string };
  "active:changed": { path: string | null };
  "docs:changed": void;
  "settings:changed": { key: string };
  "theme:changed": { id: string };
  "cursor:changed": { line: number; col: number };
  /** pip でライブラリを入れる（エラーの直し方から） */
  "pip:install": { pkg: string };
}

export const bus = new Emitter<AppEvents>();
