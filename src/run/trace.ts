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
    state = {"events": 0, "truncated": False}
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

    def record(lineno, before, after):
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
        rec = {"c": changed, "r": refs}
        if len(e["recs"]) < 25:
            e["recs"].append(rec)
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
            record(ln, known, now)
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
  kind: "value" | "ref" | "error";
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

/** 記録を、行ごとの表示の文にする */
export function formatTrace(result: TraceResult): Map<number, LineValue> {
  const out = new Map<number, LineValue>();
  for (const [lineStr, entry] of Object.entries(result.lines)) {
    const line = Number(lineStr);
    const recs = entry.recs;
    const names: string[] = [];
    for (const r of recs) for (const k of Object.keys(r.c)) if (!names.includes(k)) names.push(k);
    const detail = recs
      .map((r, i) => {
        const vals = Object.entries(Object.keys(r.c).length ? r.c : r.r).map(([k, v]) => `${k} = ${v}`);
        const label = i === recs.length - 1 && entry.n > recs.length ? `${entry.n} 回目` : `${i + 1} 回目`;
        return `${label}：${vals.join(", ") || "（変化なし）"}`;
      })
      .join("\n");
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
  if (result.error?.line) {
    out.set(result.error.line, { text: `✖ ${result.error.message}`, detail: result.error.message, kind: "error" });
  }
  return out;
}
