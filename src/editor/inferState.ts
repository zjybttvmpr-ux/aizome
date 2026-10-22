// 自動判定で AI が考えている最中か（切り替えボタンの表示用。エディタ部品に依存しない）
const listeners = new Set<() => void>();
export let inferBusy = false;

export function setInferBusy(b: boolean) {
  inferBusy = b;
  listeners.forEach((l) => l());
}

export function onInferBusy(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
