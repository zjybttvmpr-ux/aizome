import type { DictLanguage } from "./types";

export const python: DictLanguage = {
  id: "python",
  label: "Python",
  exts: [".py", ".pyw", ".ipynb"],
  entries: [
    // ───── 入出力
    ["入出力", "画面に表示する", "print ひょうじ 出力 表示", 'print(⟨"こんにちは"⟩)'],
    ["入出力", "変数の中身を文章に入れて表示（f文字列）", "f-string format ふぉーまっと 埋め込み", 'print(f"⟨名前⟩ は {⟨x⟩} です")', "{ } の中に変数や式を書けます"],
    ["入出力", "小数を桁をそろえて表示", "小数点 桁 丸め format .2f", 'print(f"{⟨x⟩:.2f}")', ".2f で小数点以下 2 けた"],
    ["入出力", "キーボードから文字を入力", "input にゅうりょく 受け取る", '⟨s⟩ = input("⟨入力してください：⟩")'],
    ["入出力", "整数を入力", "input int 数字 にゅうりょく", '⟨n⟩ = int(input("⟨数を入力：⟩"))'],
    ["入出力", "スペース区切りの数をまとめて入力", "split map list 複数 一行", "⟨nums⟩ = list(map(int, input().split()))"],
    ["入出力", "改行せずに表示", "end 改行なし", 'print(⟨x⟩, end="")'],
    ["入出力", "区切り文字を変えて表示", "sep 区切り カンマ", 'print(⟨a⟩, ⟨b⟩, sep=", ")'],

    // ───── 条件・繰り返し
    ["条件・繰り返し", "もし〜なら（if / elif / else）", "if もし 条件 分岐 elif else", "if ⟨条件⟩:\n    ⟨⟩\nelif ⟨別の条件⟩:\n    pass\nelse:\n    pass"],
    ["条件・繰り返し", "決まった回数くり返す", "for range ループ くりかえし 回数", "for ⟨i⟩ in range(⟨10⟩):\n    ⟨print(i)⟩"],
    ["条件・繰り返し", "リストの中身を順に取り出す", "for in 要素 ループ", "for ⟨item⟩ in ⟨items⟩:\n    ⟨print(item)⟩"],
    ["条件・繰り返し", "番号つきで順に取り出す", "enumerate インデックス 番号", "for ⟨i⟩, ⟨item⟩ in enumerate(⟨items⟩):\n    print(i, item)"],
    ["条件・繰り返し", "2 つのリストを同時に回す", "zip 同時 並行", "for ⟨a⟩, ⟨b⟩ in zip(⟨list1⟩, ⟨list2⟩):\n    print(a, b)"],
    ["条件・繰り返し", "条件が成り立つあいだくり返す", "while ループ あいだ", "while ⟨条件⟩:\n    ⟨⟩"],
    ["条件・繰り返し", "ずっとくり返して、途中で抜ける", "while True break 無限ループ ぬける", "while True:\n    ⟨⟩\n    if ⟨条件⟩:\n        break"],
    ["条件・繰り返し", "今回だけ飛ばして次へ", "continue スキップ とばす", "if ⟨条件⟩:\n    continue"],
    ["条件・繰り返し", "1 行で条件分岐（三項演算子）", "三項 if else 一行", "⟨x⟩ = ⟨a⟩ if ⟨条件⟩ else ⟨b⟩"],
    ["条件・繰り返し", "値によって分ける（match）", "match case switch 場合分け", "match ⟨value⟩:\n    case ⟨1⟩:\n        ⟨⟩\n    case _:\n        pass", "Python 3.10 以降"],

    // ───── 文字列
    ["文字列", "文字列の長さ", "len 文字数 ながさ", "len(⟨s⟩)"],
    ["文字列", "区切って分ける", "split 分割 わける カンマ", '⟨parts⟩ = ⟨s⟩.split("⟨,⟩")'],
    ["文字列", "リストをつなげて 1 つの文字列に", "join 結合 つなげる", '⟨s⟩ = "⟨, ⟩".join(⟨items⟩)'],
    ["文字列", "置き換える", "replace 置換 ちかん", '⟨s⟩ = ⟨s⟩.replace("⟨古い⟩", "⟨新しい⟩")'],
    ["文字列", "前後の空白・改行を取る", "strip 空白 トリム", "⟨s⟩ = ⟨s⟩.strip()"],
    ["文字列", "大文字・小文字にする", "upper lower 大文字 小文字", "⟨s⟩.upper()  # 小文字なら .lower()"],
    ["文字列", "〜を含むか調べる", "in 含む 部分一致 ふくむ", 'if "⟨word⟩" in ⟨s⟩:\n    ⟨⟩'],
    ["文字列", "〜で始まる・終わるか", "startswith endswith 先頭 末尾", 'if ⟨s⟩.startswith("⟨abc⟩"):\n    ⟨⟩'],
    ["文字列", "一部を取り出す（スライス）", "スライス 切り出し 部分", "⟨s⟩[⟨0⟩:⟨3⟩]", "[開始:終わり] 終わりの位置は含まない"],
    ["文字列", "逆順にする", "reverse 反転 さかさま", "⟨s⟩[::-1]"],
    ["文字列", "数を文字列に・文字列を数に", "str int float 変換 へんかん 型", "⟨text⟩ = str(⟨n⟩)\n⟨n⟩ = int(⟨text⟩)"],
    ["文字列", "0 で埋めて桁をそろえる", "zfill ゼロ埋め 桁", "str(⟨n⟩).zfill(⟨3⟩)"],
    ["文字列", "複数行の文字列", "三重引用符 ヒアドキュメント 複数行", 'text = """⟨1行目\n2行目⟩"""'],

    // ───── リスト
    ["リスト", "リストを作る", "list 配列 はいれつ 作る", "⟨items⟩ = [⟨1, 2, 3⟩]"],
    ["リスト", "最後に追加する", "append 追加 ついか", "⟨items⟩.append(⟨x⟩)"],
    ["リスト", "位置を指定して追加", "insert 挿入", "⟨items⟩.insert(⟨0⟩, ⟨x⟩)"],
    ["リスト", "値を指定して削除", "remove 削除 さくじょ", "⟨items⟩.remove(⟨x⟩)"],
    ["リスト", "最後の要素を取り出して削除", "pop 取り出す", "⟨last⟩ = ⟨items⟩.pop()"],
    ["リスト", "要素の数", "len 個数 長さ 数える", "len(⟨items⟩)"],
    ["リスト", "合計・最大・最小・平均", "sum max min 平均 合計 へいきん", "total = sum(⟨items⟩)\nbiggest = max(⟨items⟩)\nsmallest = min(⟨items⟩)\naverage = sum(⟨items⟩) / len(⟨items⟩)"],
    ["リスト", "小さい順に並べ替え", "sort 並べ替え ならべかえ 昇順 sorted", "⟨items⟩.sort()  # 新しいリストにするなら sorted(items)"],
    ["リスト", "大きい順に並べ替え", "sort reverse 降順", "⟨items⟩.sort(reverse=True)"],
    ["リスト", "条件で並べ替え（キーを指定）", "sort key lambda 並べ替え", "⟨items⟩.sort(key=lambda ⟨x⟩: ⟨x[1]⟩)"],
    ["リスト", "条件に合うものだけ取り出す", "filter 内包表記 絞り込み しぼりこみ", "⟨result⟩ = [⟨x⟩ for ⟨x⟩ in ⟨items⟩ if ⟨x > 0⟩]"],
    ["リスト", "全部に同じ計算をする", "内包表記 map 変換", "⟨result⟩ = [⟨x * 2⟩ for ⟨x⟩ in ⟨items⟩]"],
    ["リスト", "値が何番目にあるか", "index 検索 位置", "⟨i⟩ = ⟨items⟩.index(⟨x⟩)"],
    ["リスト", "値がいくつあるか数える", "count 数える 個数", "⟨items⟩.count(⟨x⟩)"],
    ["リスト", "重複を取り除く", "set 重複 ユニーク", "⟨unique⟩ = list(dict.fromkeys(⟨items⟩))  # 順番を保つ"],
    ["リスト", "2 次元のリスト（表）を作る", "二次元 表 行列 マス", "⟨grid⟩ = [[⟨0⟩] * ⟨横⟩ for _ in range(⟨縦⟩)]"],
    ["リスト", "リストをコピー", "copy 複製", "⟨b⟩ = ⟨a⟩.copy()"],

    // ───── 辞書
    ["辞書", "辞書を作る", "dict 辞書 じしょ 連想配列 キー", '⟨d⟩ = {"⟨key⟩": ⟨value⟩}'],
    ["辞書", "キーで値を取り出す（なければ既定値）", "get キー 取り出す", '⟨d⟩.get("⟨key⟩", ⟨0⟩)'],
    ["辞書", "キーと値を順に取り出す", "items for 辞書 ループ", "for ⟨key⟩, ⟨value⟩ in ⟨d⟩.items():\n    print(key, value)"],
    ["辞書", "キーがあるか調べる", "in キー 存在", 'if "⟨key⟩" in ⟨d⟩:\n    ⟨⟩'],
    ["辞書", "出てきた回数を数える", "Counter 集計 数える 頻度", "from collections import Counter\n\n⟨counts⟩ = Counter(⟨items⟩)\nprint(counts.most_common(⟨3⟩))"],
    ["辞書", "削除する", "del pop 削除", '⟨d⟩.pop("⟨key⟩", None)'],

    // ───── 関数・クラス
    ["関数・クラス", "関数を作る", "def 関数 かんすう 定義", "def ⟨name⟩(⟨引数⟩):\n    ⟨⟩\n    return ⟨結果⟩"],
    ["関数・クラス", "初期値のある引数", "デフォルト 引数 初期値", "def ⟨name⟩(⟨x⟩, ⟨y⟩=⟨10⟩):\n    ⟨⟩"],
    ["関数・クラス", "小さな関数（lambda）", "lambda 無名関数 ラムダ", "⟨f⟩ = lambda ⟨x⟩: ⟨x * 2⟩"],
    ["関数・クラス", "クラスを作る", "class クラス オブジェクト __init__", "class ⟨Name⟩:\n    def __init__(self, ⟨name⟩):\n        self.⟨name⟩ = ⟨name⟩\n\n    def ⟨hello⟩(self):\n        ⟨⟩"],
    ["関数・クラス", "データをまとめる型（dataclass）", "dataclass データ 構造体", "from dataclasses import dataclass\n\n\n@dataclass\nclass ⟨Point⟩:\n    ⟨x⟩: ⟨int⟩\n    ⟨y⟩: ⟨int⟩"],
    ["関数・クラス", "直接実行したときだけ動かす", "main __name__ 実行", 'if __name__ == "__main__":\n    ⟨main()⟩'],

    // ───── ファイル
    ["ファイル", "テキストファイルを全部読む", "open read 読み込み よむ", 'with open("⟨data.txt⟩", encoding="utf-8") as f:\n    ⟨text⟩ = f.read()'],
    ["ファイル", "1 行ずつ読む", "readlines 行 読み込み", 'with open("⟨data.txt⟩", encoding="utf-8") as f:\n    for line in f:\n        ⟨print(line.strip())⟩'],
    ["ファイル", "テキストファイルに書く（上書き）", "write 書き込み かく 保存", 'with open("⟨out.txt⟩", "w", encoding="utf-8") as f:\n    f.write(⟨text⟩)'],
    ["ファイル", "ファイルの最後に追記", "append 追記 a", 'with open("⟨log.txt⟩", "a", encoding="utf-8") as f:\n    f.write(⟨text⟩ + "\\n")'],
    ["ファイル", "CSV を読む", "csv 表 読み込み エクセル", 'import csv\n\nwith open("⟨data.csv⟩", encoding="utf-8") as f:\n    for row in csv.reader(f):\n        ⟨print(row)⟩'],
    ["ファイル", "CSV に書く", "csv 書き込み 保存", 'import csv\n\nwith open("⟨out.csv⟩", "w", newline="", encoding="utf-8") as f:\n    writer = csv.writer(f)\n    writer.writerow(⟨["名前", "点数"]⟩)'],
    ["ファイル", "Shift_JIS（Windows の日本語）のファイルを読む", "cp932 shift_jis 文字化け エンコード", 'with open("⟨data.txt⟩", encoding="cp932") as f:\n    ⟨text⟩ = f.read()'],
    ["ファイル", "ファイルがあるか調べる", "exists 存在 pathlib", 'from pathlib import Path\n\nif Path("⟨data.txt⟩").exists():\n    ⟨⟩'],
    ["ファイル", "フォルダの中のファイル一覧", "glob 一覧 フォルダ ディレクトリ", 'from pathlib import Path\n\nfor p in Path("⟨.⟩").glob("⟨*.txt⟩"):\n    print(p.name)'],
    ["ファイル", "フォルダを作る", "mkdir フォルダ 作成", 'from pathlib import Path\n\nPath("⟨out⟩").mkdir(parents=True, exist_ok=True)'],

    // ───── 日付・時刻
    ["日付・時刻", "今の日時", "datetime now 今日 現在", "from datetime import datetime\n\nnow = datetime.now()\nprint(now.strftime(\"%Y年%m月%d日 %H:%M\"))"],
    ["日付・時刻", "何日後・何日前", "timedelta 日後 日前 計算", "from datetime import datetime, timedelta\n\n⟨later⟩ = datetime.now() + timedelta(days=⟨7⟩)"],
    ["日付・時刻", "少し待つ", "sleep 待つ 一時停止 ウェイト", "import time\n\ntime.sleep(⟨1⟩)  # 秒"],
    ["日付・時刻", "かかった時間を計る", "計測 時間 速さ perf_counter", "import time\n\nstart = time.perf_counter()\n⟨⟩\nprint(f\"{time.perf_counter() - start:.3f} 秒\")"],

    // ───── 数学・乱数
    ["数学・乱数", "ランダムな整数", "random randint 乱数 ランダム サイコロ", "import random\n\n⟨n⟩ = random.randint(⟨1⟩, ⟨6⟩)"],
    ["数学・乱数", "リストからランダムに 1 つ選ぶ", "random choice 抽選 くじ", "import random\n\n⟨pick⟩ = random.choice(⟨items⟩)"],
    ["数学・乱数", "リストをシャッフル", "shuffle まぜる 並べ替え ランダム", "import random\n\nrandom.shuffle(⟨items⟩)"],
    ["数学・乱数", "割り算の商と余り", "割り算 余り あまり 商 // %", "⟨q⟩ = ⟨a⟩ // ⟨b⟩  # 商\n⟨r⟩ = ⟨a⟩ % ⟨b⟩   # 余り"],
    ["数学・乱数", "べき乗・平方根・円周率", "math sqrt pi 二乗 ルート", "import math\n\nmath.sqrt(⟨x⟩)\n⟨x⟩ ** 2\nmath.pi"],
    ["数学・乱数", "四捨五入・切り上げ・切り捨て", "round ceil floor 丸め", "import math\n\nround(⟨x⟩)       # 四捨五入（偶数への丸め）\nmath.ceil(⟨x⟩)   # 切り上げ\nmath.floor(⟨x⟩)  # 切り捨て"],
    ["数学・乱数", "偶数か奇数か", "偶数 奇数 判定", "if ⟨n⟩ % 2 == 0:\n    print(\"偶数\")\nelse:\n    print(\"奇数\")"],

    // ───── エラー処理
    ["エラー処理", "エラーが起きても止まらないようにする", "try except 例外 エラー", "try:\n    ⟨⟩\nexcept ⟨ValueError⟩ as e:\n    print(\"エラー：\", e)"],
    ["エラー処理", "数でない入力をやり直させる", "try int input 入力チェック", "while True:\n    try:\n        ⟨n⟩ = int(input(\"⟨数を入力：⟩\"))\n        break\n    except ValueError:\n        print(\"数字を入力してください\")"],
    ["エラー処理", "エラーを自分で起こす", "raise 例外", 'raise ⟨ValueError⟩("⟨説明⟩")'],

    // ───── 正規表現・JSON・ネット
    ["正規表現・JSON", "正規表現で探す", "re 正規表現 検索 match", 'import re\n\nm = re.search(r"⟨\\d+⟩", ⟨s⟩)\nif m:\n    print(m.group())'],
    ["正規表現・JSON", "正規表現で全部取り出す", "re findall 抽出", 'import re\n\n⟨found⟩ = re.findall(r"⟨\\d+⟩", ⟨s⟩)'],
    ["正規表現・JSON", "JSON ファイルを読む", "json 読み込み load", 'import json\n\nwith open("⟨data.json⟩", encoding="utf-8") as f:\n    ⟨data⟩ = json.load(f)'],
    ["正規表現・JSON", "JSON ファイルに書く", "json 書き込み dump 保存", 'import json\n\nwith open("⟨data.json⟩", "w", encoding="utf-8") as f:\n    json.dump(⟨data⟩, f, ensure_ascii=False, indent=2)', "ensure_ascii=False で日本語がそのまま保存されます"],
    ["正規表現・JSON", "Web ページ・API からデータを取る", "requests http 通信 API ウェブ", 'import requests\n\nres = requests.get("⟨https://example.com/api⟩", timeout=10)\n⟨data⟩ = res.json()', "pip install requests が必要"],

    // ───── 便利
    ["便利", "プログラムを終了する", "exit 終了 sys", "import sys\n\nsys.exit()"],
    ["便利", "コマンドを実行する", "subprocess コマンド 外部", 'import subprocess\n\nsubprocess.run(["⟨echo⟩", "⟨hello⟩"], check=True)'],
    ["便利", "型ヒントを付けた関数", "型 type hint アノテーション", "def ⟨name⟩(⟨x⟩: ⟨int⟩) -> ⟨int⟩:\n    ⟨⟩"],
    ["便利", "グラフを描く（matplotlib）", "グラフ matplotlib plot 図", 'import matplotlib.pyplot as plt\n\nplt.plot(⟨[1, 2, 3]⟩, ⟨[2, 4, 1]⟩)\nplt.title("⟨タイトル⟩")\nplt.show()', "pip install matplotlib が必要"],
    ["便利", "ウィンドウを出す（tkinter）", "tkinter GUI ウィンドウ 画面", 'import tkinter as tk\n\nroot = tk.Tk()\nroot.title("⟨タイトル⟩")\ntk.Label(root, text="⟨こんにちは⟩").pack(padx=20, pady=20)\nroot.mainloop()'],
    ["便利", "表のデータを読む（pandas）", "pandas csv excel データ 表", 'import pandas as pd\n\ndf = pd.read_csv("⟨data.csv⟩")\nprint(df.head())', "pip install pandas が必要"],
  ],
};
