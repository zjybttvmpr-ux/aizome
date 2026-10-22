// 「値を見る」：Python のプログラムを、行ごとの変数の値を記録しながら実行する
// 実行はターミナルで行う（input() も使える）。終わると JSON に記録が書き出されるので、それを読んで行の横に表示する

/** トレーサー本体（Python）。ターミナルで python tracer.py 対象.py 記録.json と動かす */
export const TRACER_PY = String.raw`# Aizome 値を見る（トレーサー）
import sys, os, json, runpy, reprlib, types, traceback, re, linecache

def main():
    target = os.path.abspath(sys.argv[1])
    out = sys.argv[2]
    sys.argv = [target] + sys.argv[3:]
    sys.path.insert(0, os.path.dirname(target))
    rp = reprlib.Repr()
    rp.maxstring = 60; rp.maxother = 60; rp.maxlist = 10; rp.maxtuple = 10
    rp.maxdict = 8; rp.maxset = 8; rp.maxlevel = 3; rp.maxlong = 40
    lines = {}
    last = {}
    state = {"events": 0, "truncated": False, "seq": 0, "recs": 0}
    outputs = {}

    class Tee:
        """画面に出す文字をそのまま出しつつ、どの行の実行で出たかを覚える"""
        def __init__(self, real):
            self._real = real
        def write(self, s):
            try:
                f = sys._getframe(1)
                while f is not None and f.f_code.co_filename != target:
                    f = f.f_back
                if f is not None and s:
                    outputs.setdefault(id(f), []).append(s)
            except Exception:
                pass
            return self._real.write(s)
        def flush(self):
            return self._real.flush()
        def __getattr__(self, name):
            return getattr(self._real, name)
    SKIP = (types.ModuleType, types.FunctionType, types.BuiltinFunctionType, type, types.MethodType)
    NAME = re.compile(r"[A-Za-z_]\w*")

    def show(v):
        t = type(v)
        # 自分で作ったクラスは <… object at 0x…> ではなく、中身を見せる
        if t.__repr__ is object.__repr__ and hasattr(v, "__dict__"):
            items = list(vars(v).items())
            body = ", ".join(k + "=" + rp.repr(x) for k, x in items[:4])
            return t.__name__ + "(" + body + (", …" if len(items) > 4 else "") + ")"
        return rp.repr(v)

    def snap(frame):
        d = {}
        for k, v in list(frame.f_locals.items()):
            if k.startswith("__") or isinstance(v, SKIP):
                continue
            try:
                d[k] = show(v)
            except Exception:
                d[k] = "?"
        return d

    def record(lineno, before, after, key):
        # before：その関数（フレーム）で最後に見たそれぞれの変数の値
        changed = {k: v for k, v in after.items() if before.get(k) != v}
        refs = {}
        if not changed:
            src = linecache.getline(target, lineno)
            src = src.split("#", 1)[0]
            for name in NAME.findall(src):
                if name in after and name not in refs:
                    refs[name] = after[name]
        e = lines.setdefault(lineno, {"n": 0, "recs": []})
        e["n"] += 1
        # s：実行した順番の通し番号（「その瞬間」の値を見るため）、o：この実行で print などが出した文字
        state["seq"] += 1
        rec = {"c": changed, "r": refs, "s": state["seq"]}
        out_text = "".join(outputs.pop(key, []))
        if out_text:
            rec["o"] = out_text[:400]
        if len(e["recs"]) < 300 and state["recs"] < 60000:
            e["recs"].append(rec)
            state["recs"] += 1
        else:
            e["recs"][-1] = rec

    def local(frame, event, arg):
        state["events"] += 1
        if state["events"] > 300000:
            state["truncated"] = True
            sys.settrace(None)
            return None
        key = id(frame)
        now = snap(frame)
        if key in last:
            ln, known = last.pop(key)
            record(ln, known, now, key)
            # 内包表記の中などで一時的に見えなくなった変数も、最後に見た値として覚えておく
            known = dict(known)
            known.update(now)
        else:
            known = now
        if event == "line":
            last[key] = (frame.f_lineno, known)
        return local

    def glob(frame, event, arg):
        if frame.f_code.co_filename == target:
            return local
        return None

    error = None
    linecache.checkcache(target)
    real_stdout = sys.stdout
    sys.stdout = Tee(real_stdout)
    sys.settrace(glob)
    try:
        runpy.run_path(target, run_name="__main__")
    except SystemExit:
        pass
    except BaseException as e:
        sys.settrace(None)
        line = None
        for fr in traceback.extract_tb(e.__traceback__):
            if os.path.abspath(fr.filename) == target:
                line = fr.lineno
        error = {"line": line, "message": type(e).__name__ + ": " + str(e)}
        # 自分のプログラムの部分だけのエラー表示にする（トレーサーの中は見せない）
        tb = e.__traceback__
        while tb is not None and os.path.abspath(tb.tb_frame.f_code.co_filename) != target:
            tb = tb.tb_next
        traceback.print_exception(type(e), e, tb)
    finally:
        sys.settrace(None)
        sys.stdout = real_stdout
        tmp = out + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump({"lines": lines, "error": error, "truncated": state["truncated"]}, f, ensure_ascii=False)
        os.replace(tmp, out)
    if error is not None:
        sys.exit(1)

main()
`;

export interface TraceRecord {
  /** その行で変わった変数 */
  c: Record<string, string>;
  /** 変わらなかったときに、その行で使っている変数 */
  r: Record<string, string>;
  /** 実行した順番の通し番号 */
  s?: number;
  /** この実行で出た出力（print など） */
  o?: string;
}

export interface TraceResult {
  lines: Record<string, { n: number; recs: TraceRecord[] }>;
  error: { line: number | null; message: string } | null;
  truncated: boolean;
}

export interface LineValue {
  text: string;
  /** マウスを乗せたときの、回ごとの値 */
  detail: string;
  kind: "value" | "ref" | "error" | "current" | "output" | "past";
}

const SHORT = 14;

function seqText(values: string[], n: number): string {
  // 同じ値が続くところはまとめる
  const uniq = values.filter((v, i) => i === 0 || v !== values[i - 1]);
  if (uniq.length === 1) return uniq[0] + (n > 1 ? `（${n} 回）` : "");
  const short = uniq.every((v) => v.length <= SHORT);
  if (!short) return `${uniq[uniq.length - 1]}（${n} 回目）`;
  const head = uniq.slice(0, 4);
  const lastV = uniq[uniq.length - 1];
  const body = uniq.length > 5 ? `${head.join(" → ")} → … → ${lastV}` : uniq.join(" → ");
  return `${body}（${n} 回）`;
}

/** 出力を 1 行で見せる形に（改行は ⏎） */
function oneLine(o: string, max = 60): string {
  const t = o.replace(/\r/g, "").replace(/\n$/, "").replace(/\n/g, " ⏎ ");
  return t.length > max ? t.slice(0, max) + "…" : t;
}

export type TraceView = "values" | "output";

/** その行が、指定した瞬間（通し番号 time）までに最後に実行されたときの記録 */
function recAt(recs: TraceRecord[], time: number): TraceRecord | null {
  let best: TraceRecord | null = null;
  for (const r of recs) if ((r.s ?? 0) <= time && (!best || (r.s ?? 0) > (best.s ?? 0))) best = r;
  return best;
}

function varsText(r: TraceRecord): string {
  const vals = Object.entries(Object.keys(r.c).length ? r.c : r.r);
  return vals.slice(0, 4).map(([k, v]) => `${k} = ${v}`).join("　") + (vals.length > 4 ? `　ほか ${vals.length - 4} 個` : "");
}

/**
 * 記録を、行ごとの表示の文にする。
 * view：values（変数の値）か output（その行の出力）。time を渡すと「その瞬間」の値だけを出す（ステップ表示）
 */
export function formatTrace(result: TraceResult, view: TraceView = "values", time: number | null = null): Map<number, LineValue> {
  const out = new Map<number, LineValue>();
  for (const [lineStr, entry] of Object.entries(result.lines)) {
    const line = Number(lineStr);
    const recs = entry.recs;
    const detail =
      view === "output"
        ? recs
            .filter((r) => r.o)
            .map((r, i) => `${i + 1} 回目：${oneLine(r.o!, 200)}`)
            .join("\n")
        : recs
            .map((r, i) => {
              const label = i === recs.length - 1 && entry.n > recs.length ? `${entry.n} 回目` : `${i + 1} 回目`;
              return `${label}：${varsText(r) || "（変化なし）"}`;
            })
            .join("\n");

    // ステップ表示：その瞬間の値・出力
    if (time !== null) {
      const r = recAt(recs, time);
      if (!r) continue;
      const current = r.s === time;
      if (view === "output") {
        if (r.o) out.set(line, { text: oneLine(r.o), detail, kind: current ? "current" : "past" });
      } else {
        const text = varsText(r);
        // 今の行以外は「その行が最後に動いたときの値」なので薄く
        if (text) out.set(line, { text, detail, kind: current ? "current" : "past" });
      }
      continue;
    }

    if (view === "output") {
      const outs = recs.filter((r) => r.o).map((r) => oneLine(r.o!, 30));
      if (!outs.length) continue;
      const n = recs.filter((r) => r.o).length;
      const text = outs.length === 1 ? outs[0] : outs.slice(0, 4).join(" ｜ ") + (outs.length > 4 ? ` ｜ …（${n} 回）` : `（${n} 回）`);
      out.set(line, { text, detail, kind: "output" });
      continue;
    }

    const names: string[] = [];
    for (const r of recs) for (const k of Object.keys(r.c)) if (!names.includes(k)) names.push(k);
    const describe = (field: "c" | "r", keys: string[]) => {
      const parts = keys.slice(0, 3).map((k) => {
        const values = recs.filter((r) => k in r[field]).map((r) => r[field][k]);
        return `${k} = ${seqText(values, values.length === recs.length ? entry.n : values.length)}`;
      });
      if (keys.length > 3) parts.push(`ほか ${keys.length - 3} 個`);
      return parts.join("　");
    };
    if (names.length) {
      out.set(line, { text: describe("c", names), detail, kind: "value" });
    } else {
      const refNames: string[] = [];
      for (const r of recs) for (const k of Object.keys(r.r)) if (!refNames.includes(k)) refNames.push(k);
      if (refNames.length) out.set(line, { text: describe("r", refNames), detail, kind: "ref" });
    }
  }
  if (result.error?.line && (time === null || time >= maxTime(result))) {
    out.set(result.error.line, { text: `✖ ${result.error.message}`, detail: result.error.message, kind: "error" });
  }
  return out;
}

/** その行が実行された瞬間（通し番号）の一覧 */
export function stepTimes(result: TraceResult, line: number): number[] {
  return (result.lines[String(line)]?.recs ?? []).map((r) => r.s ?? 0).filter((s) => s > 0).sort((a, b) => a - b);
}

export function maxTime(result: TraceResult): number {
  let m = 0;
  for (const e of Object.values(result.lines)) for (const r of e.recs) m = Math.max(m, r.s ?? 0);
  return m;
}

/** いちばん多く実行された行（ステップ表示の最初の基準に使う） */
export function busiestLine(result: TraceResult, skip: (line: number) => boolean = () => false): number | null {
  let best: number | null = null;
  let n = 0;
  for (const [l, e] of Object.entries(result.lines)) {
    if (skip(Number(l))) continue;
    if (e.recs.length > n) {
      n = e.recs.length;
      best = Number(l);
    }
  }
  return best;
}
