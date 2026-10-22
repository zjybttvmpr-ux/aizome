// 入力の登録：input() に入れる値を前もって登録しておき、実行のときに順に自動で入れる（Python）。
// input() を差し替えるだけなので、画面には「名前: たろう」のように、打ったときと同じ形で出る。
// 登録した値を使い切ったら、ふつうどおりキーボードから入力できる

export const INPUT_WRAPPER_PY = String.raw`# Aizome 入力の登録（input() に登録した値を順に入れる）
import sys, os, builtins, runpy

def main():
    target = os.path.abspath(sys.argv[1])
    with open(sys.argv[2], encoding="utf-8") as f:
        queue = f.read().replace("\r\n", "\n").split("\n")
    if queue and queue[-1] == "":
        queue.pop()
    real_input = builtins.input

    def registered_input(prompt=""):
        if queue:
            value = queue.pop(0)
            sys.stdout.write(str(prompt) + value + "\n")
            sys.stdout.flush()
            return value
        return real_input(prompt)

    builtins.input = registered_input
    sys.argv = [target] + sys.argv[3:]
    sys.path.insert(0, os.path.dirname(target))
    runpy.run_path(target, run_name="__main__")

main()
`;

export interface InputPreset {
  enabled: boolean;
  text: string;
}

/** 登録された値の数（空行も 1 つの入力として数える。最後の空行は数えない） */
export function presetCount(p: InputPreset | undefined): number {
  if (!p?.enabled || !p.text) return 0;
  const lines = p.text.replace(/\r\n/g, "\n").split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines.length;
}
