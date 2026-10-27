// 実行・コンパイルで出たエラーを、言語を問わず日本語にする。
// ターミナルの出力から「どのファイルの何行目か」と「何のエラーか」を読み取り、行の右に出す説明と直し方を作る。
import { settings } from "../core/settings";
import { argvExplain, explainRuntime } from "./pyErrors";

export interface Explained {
  text: string;
  hint?: string;
  /** その行の find を to に置きかえると直る */
  fix?: { find: string; to: string; attr?: boolean };
  install?: string;
}

export interface ParsedError extends Explained {
  file: string;
  line: number;
  col: number | null;
  /** 元の英語のメッセージ */
  detail: string;
  severity: "error" | "warning";
}

type Rule = [RegExp, (m: RegExpExecArray) => Explained | string];

const q = (s: string) => `「${s}」`;

// ───────── メッセージ → 日本語（言語ごとに、よく出るものを網羅）

const RULES: Rule[] = [
  // ── C#（コンパイラ）
  [/CS0103: The name '(\w+)' does not exist in the current context/, (m) => ({ text: `${q(m[1])}という名前はありません（まだ作っていないか、つづりのまちがい）`, hint: "変数なら使う前に作る、クラスなら using を確かめましょう" })],
  [/CS0246: The type or namespace name '(\w+)' could not be found/, (m) => `型${q(m[1])}が見つかりません（using が足りないか、つづりのまちがい）`],
  [/CS1002: ; expected/, () => "行の終わりに「;」がありません"],
  [/CS1513: } expected/, () => "「}」が足りません（{ の閉じ忘れ）"],
  [/CS1514: { expected/, () => "「{」が足りません"],
  [/CS1026: \) expected/, () => "「)」が足りません"],
  [/CS1003: Syntax error, '(.+?)' expected/, (m) => `書き方のまちがい：${q(m[1])}が必要です`],
  [/CS1525: Invalid expression term '(.+?)'/, (m) => `ここに${q(m[1])}は書けません`],
  [/CS1001: Identifier expected/, () => "名前（変数名など）が必要です"],
  [/CS1010: Newline in constant/, () => "文字列の \" が閉じていません"],
  [/CS1012: Too many characters in character literal/, () => "' ' の中は 1 文字だけです（文字列なら \" \" を使います）"],
  [/CS0029: Cannot implicitly convert type '(.+?)' to '(.+?)'/, (m) => ({ text: `${q(m[1])}を${q(m[2])}にそのまま入れられません`, hint: "int.Parse( ) や (int) などで変換しましょう" })],
  [/CS0266: Cannot implicitly convert type '(.+?)' to '(.+?)'\. An explicit conversion exists/, (m) => ({ text: `${q(m[1])}から${q(m[2])}へは、自分で変換が必要です`, hint: `(${m[2]}) を前に付けるか Mathf.RoundToInt( ) などを使いましょう` })],
  [/CS1061: '(.+?)' does not contain a definition for '(\w+)'/, (m) => `${q(m[1])}には${q(m[2])}がありません（つづりか型のまちがい）`],
  [/CS0117: '(.+?)' does not contain a definition for '(\w+)'/, (m) => `${q(m[1])}に${q(m[2])}はありません`],
  [/CS0161: '(.+?)': not all code paths return a value/, (m) => `${q(m[1])}が値を返さずに終わる道があります（return が足りません）`],
  [/CS0165: Use of unassigned local variable '(\w+)'/, (m) => `${q(m[1])}に値を入れる前に使っています`],
  [/CS0128: A local variable or function named '(\w+)' is already defined/, (m) => `${q(m[1])}はもう作ってあります（同じ名前を 2 回作っています）`],
  [/CS0136: A local or parameter named '(\w+)' cannot be declared/, (m) => `${q(m[1])}は外側で使っている名前なので、ここでは作れません`],
  [/CS0019: Operator '(.+?)' cannot be applied to operands of type '(.+?)' and '(.+?)'/, (m) => `${q(m[2])}と${q(m[3])}は${q(m[1])}で計算できません`],
  [/CS1503: Argument (\d+): cannot convert from '(.+?)' to '(.+?)'/, (m) => `${m[1]} 番目の引数：${q(m[2])}は${q(m[3])}として渡せません`],
  [/CS7036: There is no argument given that corresponds to the required parameter '(\w+)'/, (m) => `引数${q(m[1])}が足りません`],
  [/CS1501: No overload for method '(\w+)' takes (\d+) arguments/, (m) => `${q(m[1])}に引数 ${m[2]} 個の使い方はありません`],
  [/CS0120: An object reference is required for the non-static field, method, or property '(.+?)'/, (m) => ({ text: `${q(m[1])}は static ではないので、そのままでは使えません`, hint: "インスタンスを作って使うか、static を付けましょう" })],
  [/CS0101: The namespace '(.+?)' already contains a definition for '(\w+)'/, (m) => `${q(m[2])}という型がもう 1 つあります（ほかのファイルと同じ名前）`],
  [/CS0111: Type '(.+?)' already defines a member called '(\w+)'/, (m) => `${q(m[2])}がもう 1 つあります（同じ名前・同じ引数のメソッド）`],
  [/CS0106: The modifier '(\w+)' is not valid for this item/, (m) => `ここには${q(m[1])}を付けられません`],
  [/CS0127: Since '(.+?)' returns void, a return keyword must not be followed by an object expression/, (m) => `${q(m[1])}は void なので、return に値を付けられません`],
  [/CS0126: An object of a type convertible to '(.+?)' is required/, (m) => `return に${q(m[1])}の値が必要です`],
  [/CS0236: A field initializer cannot reference/, () => "フィールドの初期値で、ほかのフィールドは使えません（Start( ) などで入れましょう）"],
  [/CS0023: Operator '(.+?)' cannot be applied to operand of type '(.+?)'/, (m) => `${q(m[2])}には${q(m[1])}が使えません`],
  [/CS0100: The parameter name '(\w+)' is a duplicate/, (m) => `引数の名前${q(m[1])}が重なっています`],
  [/CS0122: '(.+?)' is inaccessible due to its protection level/, (m) => ({ text: `${q(m[1])}は private などで外から使えません`, hint: "public にするか、[SerializeField] を使いましょう" })],
  [/CS0200: Property or indexer '(.+?)' cannot be assigned to -- it is read only/, (m) => `${q(m[1])}は読むだけで、値を入れられません`],
  [/CS0029|CS0030: Cannot convert type '(.+?)' to '(.+?)'/, (m) => `${q(m[1] ?? "")}を${q(m[2] ?? "")}に変換できません`],
  [/CS0815: Cannot assign (.+?) to an implicitly-typed variable/, () => "var で作る変数に null などは入れられません（型を書きましょう）"],
  [/CS0118: '(.+?)' is a (\w+) but is used like a (\w+)/, (m) => `${q(m[1])}は ${m[2]} なのに ${m[3]} として使っています`],
  [/CS0428: Cannot convert method group '(\w+)'/, (m) => `${q(m[1])}の後ろに ( ) を付け忘れていませんか？`],
  [/CS0201: Only assignment, call, increment, decrement/, () => "この行は何もしていません（= や ( ) を忘れていませんか？）"],
  [/CS0168: The variable '(\w+)' is declared but never used/, (m) => `${q(m[1])}を作りましたが使っていません`],
  [/CS0219: The variable '(\w+)' is assigned but its value is never used/, (m) => `${q(m[1])}に値を入れましたが使っていません`],
  [/CS0162: Unreachable code detected/, () => "ここは実行されません（上で return などをしています）"],
  [/CS8600|CS8602|CS8604|CS8618: (.+)/, (m) => `null になるかもしれない値です（${m[1]}）`],
  // ── C#（実行時）
  [/System\.NullReferenceException/, () => ({ text: "NullReferenceException：中身のない（null）変数を使っています", hint: "Unity なら、インスペクターで入れ忘れていないか、GetComponent が見つけられたか確かめましょう" })],
  [/System\.IndexOutOfRangeException/, () => ({ text: "IndexOutOfRangeException：配列の番号が範囲の外です", hint: "番号は 0 から Length - 1 までです" })],
  [/System\.ArgumentOutOfRangeException/, () => ({ text: "ArgumentOutOfRangeException：リストの番号や値が範囲の外です", hint: "番号は 0 から Count - 1 までです" })],
  [/System\.DivideByZeroException/, () => "DivideByZeroException：0 で割っています"],
  [/System\.FormatException/, () => ({ text: "FormatException：文字を数に変換できません", hint: "int.TryParse( ) を使うと安全です" })],
  [/System\.InvalidCastException/, () => "InvalidCastException：その型には変換できません"],
  [/System\.Collections\.Generic\.KeyNotFoundException/, () => ({ text: "KeyNotFoundException：辞書にそのキーがありません", hint: "TryGetValue( ) か ContainsKey( ) で確かめましょう" })],
  [/System\.StackOverflowException|Stack overflow/, () => "StackOverflow：メソッドが自分を呼び続けています（終わらない再帰）"],
  [/System\.InvalidOperationException: (.+)/, (m) => `InvalidOperationException：今はその操作ができません（${m[1]}）`],
  [/System\.IO\.FileNotFoundException/, () => "FileNotFoundException：ファイルが見つかりません"],
  [/System\.OverflowException/, () => "OverflowException：数が大きすぎます"],
  [/UnassignedReferenceException: The variable (\w+) of (\w+) has not been assigned/, (m) => ({ text: `${m[2]} の${q(m[1])}が設定されていません`, hint: "インスペクターで入れましょう" })],
  [/MissingReferenceException/, () => "MissingReferenceException：消したオブジェクトを使っています"],
  [/MissingComponentException: There is no '(\w+)' attached/, (m) => `${q(m[1])}コンポーネントが付いていません（Add Component で付けましょう）`],
  // ── Java（コンパイラ）
  [/error: cannot find symbol/, () => ({ text: "その名前が見つかりません（まだ作っていないか、つづり・import のまちがい）" })],
  [/error: ';' expected/, () => "「;」がありません"],
  [/error: '\)' expected/, () => "「)」がありません"],
  [/error: '\(' expected/, () => "「(」がありません"],
  [/error: class, interface, enum, or record expected|error: class, interface, or enum expected/, () => "ここにはクラスの外では書けません（{ } の数を確かめましょう）"],
  [/error: reached end of file while parsing/, () => "ファイルが途中で終わっています（「}」が足りません）"],
  [/error: incompatible types: (.+?) cannot be converted to (.+)/, (m) => ({ text: `${q(m[1])}を${q(m[2])}に入れられません`, hint: "Integer.parseInt( ) などで変換しましょう" })],
  [/error: incompatible types: possible lossy conversion from (\w+) to (\w+)/, (m) => `${m[1]} から ${m[2]} にすると値が欠けるかもしれません（(${m[2]}) で変換）`],
  [/error: missing return statement/, () => "return が足りません"],
  [/error: variable (\w+) might not have been initialized/, (m) => `${q(m[1])}に値を入れる前に使っています`],
  [/error: variable (\w+) is already defined/, (m) => `${q(m[1])}はもう作ってあります`],
  [/error: unreachable statement/, () => "この文は実行されません"],
  [/error: illegal start of expression/, () => "式の書き始めがおかしいです（かっこや ; を確かめましょう）"],
  [/error: illegal start of type/, () => "ここに型や文は書けません"],
  [/error: class (\w+) is public, should be declared in a file named (\S+)/, (m) => `public なクラス${q(m[1])}は、ファイル名を ${m[2]} にする必要があります`],
  [/error: non-static (method|variable) (\w+).* cannot be referenced from a static context/, (m) => `static でない${q(m[2])}を main（static）から使っています`],
  [/error: bad operand types for binary operator '(.+?)'/, (m) => `その型どうしは${q(m[1])}で計算できません`],
  [/error: method (\w+) in class (\w+) cannot be applied to given types/, (m) => `${q(m[1])}の引数の数や型がちがいます`],
  [/error: unclosed string literal/, () => "文字列の \" が閉じていません"],
  [/error: else without if/, () => "else の前に if がありません（{ } や ; を確かめましょう）"],
  [/error: (\w+) is already defined in/, (m) => `${q(m[1])}はもう作ってあります`],
  [/error: cannot assign a value to final variable (\w+)/, (m) => `final の${q(m[1])}は変えられません`],
  [/error: unreported exception (\w+); must be caught or declared to be thrown/, (m) => `${m[1]} を try-catch で受けるか throws を付ける必要があります`],
  [/error: package ([\w.]+) does not exist/, (m) => `パッケージ${q(m[1])}がありません（import のつづり）`],
  // ── Java（実行時）
  [/java\.lang\.NullPointerException/, () => "NullPointerException：中身のない（null）変数を使っています"],
  [/java\.lang\.ArrayIndexOutOfBoundsException: (?:Index )?(-?\d+)/, (m) => ({ text: `ArrayIndexOutOfBoundsException：配列の番号 ${m[1]} は範囲の外です`, hint: "番号は 0 から length - 1 までです" })],
  [/java\.lang\.(String)?IndexOutOfBoundsException/, () => "IndexOutOfBoundsException：番号が範囲の外です"],
  [/java\.lang\.ArithmeticException: \/ by zero/, () => "ArithmeticException：0 で割っています"],
  [/java\.lang\.NumberFormatException: For input string: "(.*)"/, (m) => `NumberFormatException：${q(m[1])}は数に変換できません`],
  [/java\.util\.InputMismatchException/, () => "InputMismatchException：入力が思っていた型と違います（数のところに文字など）"],
  [/java\.util\.NoSuchElementException/, () => "NoSuchElementException：読む入力がもうありません"],
  [/java\.lang\.ClassCastException/, () => "ClassCastException：その型には変換できません"],
  [/java\.lang\.StackOverflowError/, () => "StackOverflowError：メソッドが自分を呼び続けています"],
  [/java\.lang\.OutOfMemoryError/, () => "OutOfMemoryError：メモリが足りません"],
  [/java\.io\.FileNotFoundException/, () => "FileNotFoundException：ファイルが見つかりません"],
  [/Error: Could not find or load main class/, () => "main のあるクラスが見つかりません（クラス名とファイル名を確かめましょう）"],
  // ── C / C++（gcc・clang）
  [/'(\w+)' undeclared \(first use in this function\)/, (m) => `${q(m[1])}は作られていません（宣言を忘れているか、つづりのまちがい）`],
  [/'(\w+)' was not declared in this scope/, (m) => ({ text: `${q(m[1])}は作られていません（宣言・#include・つづりを確かめましょう）` })],
  [/use of undeclared identifier '(\w+)'/, (m) => `${q(m[1])}は作られていません`],
  [/expected ';' (before|after|at end of)/, () => "「;」がありません"],
  [/expected '\)' before/, () => "「)」がありません"],
  [/expected '\}' (at end of input|before)/, () => "「}」が足りません"],
  [/expected declaration or statement at end of input/, () => "ファイルが途中で終わっています（「}」が足りません）"],
  [/expected expression before '(.+?)'/, (m) => `${q(m[1])}の前に式が必要です`],
  [/implicit declaration of function '(\w+)'/, (m) => ({ text: `${q(m[1])}を使う前に宣言がありません（#include 忘れか、つづりのまちがい）` })],
  [/too few arguments to function '(.+?)'/, (m) => `${q(m[1])}の引数が足りません`],
  [/too many arguments to function '(.+?)'/, (m) => `${q(m[1])}の引数が多すぎます`],
  [/conflicting types for '(\w+)'/, (m) => `${q(m[1])}の宣言が 2 か所で食い違っています`],
  [/redefinition of '(.+?)'/, (m) => `${q(m[1])}を 2 回作っています`],
  [/no matching function for call to '(.+?)'/, (m) => `${q(m[1])}に合う使い方（引数の型・数）がありません`],
  [/invalid conversion from '(.+?)' to '(.+?)'/, (m) => `${q(m[1])}から${q(m[2])}には変換できません`],
  [/cannot convert '(.+?)' to '(.+?)'/, (m) => `${q(m[1])}を${q(m[2])}に変換できません`],
  [/undefined reference to `(\w+)'/, (m) => ({ text: `${q(m[1])}の中身が見つかりません（作り忘れか、つづりのまちがい）`, hint: m[1] === "main" || m[1] === "WinMain" ? "main 関数がありません" : undefined })],
  [/control reaches end of non-void function/, () => "値を返す関数なのに、return せずに終わる道があります"],
  [/format '(%\w+)' expects argument of type '(.+?)', but argument (\d+) has type '(.+?)'/, (m) => `${m[1]} には${q(m[2])}を渡します（${m[3]} 番目が${q(m[4])}）`],
  [/unused variable '(\w+)'/, (m) => `${q(m[1])}を作りましたが使っていません`],
  [/suggest parentheses around assignment used as truth value/, () => "if の中で = を使っています（比べるなら ==）"],
  [/comparison between signed and unsigned/, () => "符号ありと符号なしの数を比べています"],
  [/'(\w+)' is not a member of '(\w+)'/, (m) => `${q(m[2])}に${q(m[1])}はありません（#include やつづりを確かめましょう）`],
  [/request for member '(\w+)' in .*which is of non-class type/, (m) => `${q(m[1])}は使えません（-> と . のまちがい？）`],
  [/fatal error: (.+?): No such file or directory/, (m) => `${q(m[1])}が見つかりません（#include の名前のつづり）`],
  [/missing terminating " character/, () => "文字列の \" が閉じていません"],
  [/stray '(.+?)' in program/, (m) => `プログラムに使えない文字${q(m[1])}が入っています（全角の記号など）`],
  [/lvalue required as left operand of assignment/, () => "= の左には変数が必要です（== のまちがい？）"],
  [/array subscript is not an integer/, () => "配列の番号は整数です"],
  [/Segmentation fault/, () => ({ text: "Segmentation fault：使ってはいけないメモリにさわりました", hint: "配列の範囲外・NULL のポインタ・初期化していないポインタを確かめましょう" })],
  [/Floating point exception/, () => "Floating point exception：0 で割っています（整数の割り算）"],
  [/terminate called after throwing an instance of 'std::out_of_range'/, () => "std::out_of_range：番号が範囲の外です（at( ) など）"],
  [/terminate called after throwing an instance of 'std::(\w+)'/, (m) => `std::${m[1]} が起きて止まりました`],
  // ── JavaScript / TypeScript（Node）
  [/ReferenceError: (\w+) is not defined/, (m) => ({ text: `ReferenceError：${q(m[1])}という名前はありません（作っていないか、つづりのまちがい）` })],
  [/TypeError: Cannot read propert(?:y|ies) of (undefined|null)(?: \(reading '(.+?)'\))?/, (m) => ({ text: `TypeError：${m[1]} の${m[2] ? ` ${q(m[2])}` : ""}を読もうとしました（中身がありません）`, hint: "その変数に値が入っているか確かめましょう（?. を使う方法もあります）" })],
  [/TypeError: Cannot set propert(?:y|ies) of (undefined|null)/, (m) => `TypeError：${m[1]} に値を入れようとしました`],
  [/TypeError: ([\w.$]+) is not a function/, (m) => `TypeError：${q(m[1])}は関数ではありません（つづりか、( ) のつけすぎ）`],
  [/TypeError: ([\w.$]+) is not iterable/, (m) => `TypeError：${q(m[1])}は for…of で回せません`],
  [/TypeError: Assignment to constant variable/, () => "TypeError：const の変数は変えられません（let にしましょう）"],
  [/TypeError: (\w+) is not a constructor/, (m) => `TypeError：${q(m[1])}には new が使えません`],
  [/SyntaxError: Unexpected token '?(.+?)'?$/, (m) => `SyntaxError：ここに${q(m[1])}は書けません`],
  [/SyntaxError: Unexpected end of input/, () => "SyntaxError：コードが途中で終わっています（かっこの閉じ忘れ）"],
  [/SyntaxError: Unexpected identifier '?(\w*)'?/, (m) => `SyntaxError：ここに名前${q(m[1])}は書けません（, や ; の忘れ）`],
  [/SyntaxError: Identifier '(\w+)' has already been declared/, (m) => `SyntaxError：${q(m[1])}はもう作ってあります`],
  [/SyntaxError: Invalid or unexpected token/, () => "SyntaxError：使えない文字があります（全角の記号や、閉じていない文字列）"],
  [/SyntaxError: missing \) after argument list/, () => "SyntaxError：「)」がありません"],
  [/SyntaxError: Unexpected string/, () => "SyntaxError：文字列の前に , か + を忘れていませんか？"],
  [/SyntaxError: Cannot use import statement outside a module/, () => "import を使うには、ファイルを .mjs にするか package.json に \"type\": \"module\" が必要です"],
  [/RangeError: Maximum call stack size exceeded/, () => "RangeError：関数が自分を呼び続けています（終わらない再帰）"],
  [/RangeError: Invalid array length/, () => "RangeError：配列の長さがおかしいです"],
  [/Error: Cannot find module '(.+?)'/, (m) => ({ text: `${q(m[1])}が見つかりません`, hint: m[1].startsWith(".") ? "ファイルの場所を確かめましょう" : `npm install ${m[1]} で入れましょう` })],
  [/error TS2304: Cannot find name '(\w+)'/, (m) => `${q(m[1])}という名前はありません`],
  [/error TS2322: Type '(.+?)' is not assignable to type '(.+?)'/, (m) => `${q(m[1])}は${q(m[2])}に入れられません`],
  [/error TS2339: Property '(\w+)' does not exist on type '(.+?)'/, (m) => `${q(m[2])}に${q(m[1])}はありません`],
  [/error TS2345: Argument of type '(.+?)' is not assignable to parameter of type '(.+?)'/, (m) => `引数の${q(m[1])}は${q(m[2])}として渡せません`],
  [/error TS2554: Expected (\d+) arguments, but got (\d+)/, (m) => `引数は ${m[1]} 個ですが、${m[2]} 個渡しています`],
  // ── Go
  [/undefined: (\w+)/, (m) => `${q(m[1])}は作られていません（つづりか import のまちがい）`],
  [/declared and not used: (\w+)|(\w+) declared (?:and|but) not used/, (m) => ({ text: `${q(m[1] ?? m[2])}を作りましたが使っていません（Go ではエラーです）`, hint: "使わないなら消すか _ にしましょう" })],
  [/"(.+?)" imported and not used/, (m) => `${q(m[1])}を import しましたが使っていません（Go ではエラーです）`],
  [/missing return/, () => "return が足りません"],
  [/syntax error: unexpected (.+?), expected (.+)/, (m) => `書き方のまちがい：${m[1]} ではなく ${m[2]} が必要です`],
  [/syntax error: unexpected (.+)/, (m) => `書き方のまちがい：ここに ${m[1]} は書けません`],
  [/cannot use (.+?) \((?:variable|constant|untyped \w+ constant|value) of type (.+?)\) as (.+?) value/, (m) => `${q(m[1])}（${m[2]}）は ${m[3]} として使えません`],
  [/non-name (.+?) on left side of :=/, () => ":= の左には新しい変数名を書きます"],
  [/no new variables on left side of :=/, () => ":= の左の変数はもう全部あります（= を使いましょう）"],
  [/panic: runtime error: index out of range \[(-?\d+)\] with length (\d+)/, (m) => ({ text: `panic：番号 ${m[1]} は範囲の外です（長さは ${m[2]}）`, hint: "番号は 0 から len( ) - 1 までです" })],
  [/panic: runtime error: integer divide by zero/, () => "panic：0 で割っています"],
  [/panic: runtime error: invalid memory address or nil pointer dereference/, () => "panic：nil（中身のない）ポインタを使っています"],
  [/panic: assignment to entry in nil map/, () => "panic：make( ) していない map に入れています"],
  [/fatal error: all goroutines are asleep - deadlock!/, () => "deadlock：すべての goroutine が待ち続けています（チャネルの受け渡しを確かめましょう）"],
  // ── Rust
  [/error\[E0425\]: cannot find value `(\w+)` in this scope/, (m) => `${q(m[1])}は作られていません`],
  [/error\[E0425\]: cannot find function `(\w+)`/, (m) => `関数${q(m[1])}が見つかりません`],
  [/error\[E0308\]: mismatched types/, () => "型が合いません（期待している型と違う値です）"],
  [/error\[E0382\]: (?:borrow|use) of moved value: `(\w+)`/, (m) => ({ text: `${q(m[1])}はもう別の場所に渡した（move した）ので使えません`, hint: "&（参照）で渡すか .clone( ) しましょう" })],
  [/error\[E0384\]: cannot assign twice to immutable variable `(\w+)`/, (m) => ({ text: `${q(m[1])}は変えられない変数です`, hint: `let mut ${m[1]} にしましょう` })],
  [/error\[E0596\]: cannot borrow `(.+?)` as mutable/, (m) => `${q(m[1])}は mut ではないので変えられません`],
  [/error\[E0502\]|error\[E0499\]/, () => "同じ値を、変える用と読む用に同時に借りています（借用のルール）"],
  [/error\[E0433\]: failed to resolve: use of undeclared (?:type|crate or module) `(\w+)`/, (m) => `${q(m[1])}が見つかりません（use が足りません）`],
  [/error\[E0599\]: no method named `(\w+)` found/, (m) => `${q(m[1])}というメソッドはありません`],
  [/error\[E0061\]: this function takes (\d+) arguments? but (\d+) arguments? (?:was|were) supplied/, (m) => `引数は ${m[1]} 個ですが、${m[2]} 個渡しています`],
  [/error: expected `;`, found/, () => "「;」がありません"],
  [/error: this file contains an unclosed delimiter/, () => "かっこが閉じていません"],
  [/index out of bounds: the len is (\d+) but the index is (\d+)/, (m) => `panic：番号 ${m[2]} は範囲の外です（長さは ${m[1]}）`],
  [/attempt to divide by zero/, () => "panic：0 で割っています"],
  [/called `(Option|Result)::unwrap\(\)` on an? `(None|Err)/, (m) => ({ text: `panic：${m[2]} なのに unwrap( ) しました`, hint: "match や if let で確かめましょう" })],
  [/attempt to (add|subtract|multiply) with overflow/, () => "panic：計算が大きすぎて（小さすぎて）あふれました"],
  // ── Ruby
  [/undefined local variable or method `(\w+)'/, (m) => `NameError：${q(m[1])}という名前はありません`],
  [/undefined method `(\w+)' for (nil|an instance of \w+|\S+)/, (m) => ({ text: `NoMethodError：${m[2] === "nil" ? "nil（中身なし）" : m[2]} に${q(m[1])}はありません`, hint: m[2] === "nil" ? "その変数に値が入っているか確かめましょう" : undefined })],
  [/(String|Integer|Float|nil) can't be coerced into (\w+)/, (m) => ({ text: `TypeError：${m[1]} を ${m[2]} として計算できません`, hint: "to_i や to_s で変換しましょう" })],
  [/no implicit conversion of (\w+) into (\w+)/, (m) => ({ text: `TypeError：${m[1]} を ${m[2]} にそのままつなげられません`, hint: "to_s や to_i で変換しましょう" })],
  [/wrong number of arguments \(given (\d+), expected (.+?)\)/, (m) => `ArgumentError：引数は ${m[2]} 個ですが、${m[1]} 個渡しています`],
  [/divided by 0/, () => "ZeroDivisionError：0 で割っています"],
  [/syntax error, unexpected end-of-input, expecting (?:`end'|'end'|end)/, () => "SyntaxError：end が足りません"],
  [/syntax error, unexpected `?'?end'?/, () => "SyntaxError：end が多すぎます"],
  [/syntax error, unexpected (.+)/, (m) => `SyntaxError：ここに ${m[1]} は書けません`],
  [/uninitialized constant (\w+)/, (m) => `NameError：${q(m[1])}というクラスや定数はありません（require やつづりを確かめましょう）`],
  [/cannot load such file -- (\S+)/, (m) => `${q(m[1])}が見つかりません（gem install か、ファイルの場所を確かめましょう）`],
  // ── PHP
  [/Call to undefined function (\w+)\(\)/, (m) => `関数${q(m[1])}はありません（つづりのまちがい）`],
  [/Undefined variable \$(\w+)/, (m) => `変数 $${m[1]} はまだ作られていません`],
  [/syntax error, unexpected end of file/, () => "ファイルが途中で終わっています（「}」の閉じ忘れ）"],
  [/syntax error, unexpected (.+?)(?:, expecting (.+?))?(?: in | on |$)/, (m) => `書き方のまちがい：${m[1]}${m[2] ? ` ではなく ${m[2]}` : " は書けません"}`],
  [/Undefined (array key|index|offset) "?(.+?)"?(?: in|$)/, (m) => `配列にキー ${q(m[2])}がありません`],
  [/Division by zero/, () => "0 で割っています"],
  // ── Lua
  [/attempt to call a nil value \((?:global|local|field|method) '(\w+)'\)/, (m) => `${q(m[1])}という関数はありません（つづりのまちがい？）`],
  [/attempt to perform arithmetic on a (nil|string|table) value(?: \((?:global|local|field) '(\w+)'\))?/, (m) => `${m[2] ? q(m[2]) + " は " : ""}${m[1]} なので計算できません`],
  [/attempt to index a nil value(?: \((?:global|local|field) '(\w+)'\))?/, (m) => `${m[1] ? q(m[1]) + " が " : ""}nil（中身なし）なので [ ] や . が使えません`],
  [/attempt to concatenate a (nil|table|boolean) value/, (m) => `${m[1]} は .. でつなげられません（tostring( ) を使いましょう）`],
  [/attempt to compare (\w+) with (\w+)/, (m) => `${m[1]} と ${m[2]} は比べられません`],
  [/'end' expected(?: \(to close '(\w+)' at line (\d+)\))?/, (m) => `end が足りません${m[1] ? `（${m[2]} 行目の ${m[1]} を閉じる end）` : ""}`],
  [/unexpected symbol near '(.+?)'/, (m) => `ここに${q(m[1])}は書けません`],
  [/'=' expected near '(.+?)'/, (m) => `${q(m[1])}の前に = が必要です`],
  [/unfinished string near/, () => "文字列が閉じていません"],
  // ── Kotlin / Swift / Dart
  [/Unresolved reference:? '?(\w+)'?/, (m) => `${q(m[1])}は作られていません`],
  [/Type mismatch: inferred type is (.+?) but (.+?) was expected/, (m) => `${q(m[1])}ではなく${q(m[2])}が必要です`],
  [/Val cannot be reassigned/, () => "val の変数は変えられません（var にしましょう）"],
  [/cannot find '(\w+)' in scope/, (m) => `${q(m[1])}は作られていません`],
  [/cannot assign to value: '(\w+)' is a 'let' constant/, (m) => `${q(m[1])}は let なので変えられません（var にしましょう）`],
  [/value of optional type '(.+?)' must be unwrapped/, (m) => `${q(m[1])}は nil かもしれないので、! や if let で取り出しましょう`],
  [/Fatal error: Index out of range/, () => "番号が範囲の外です"],
  [/Fatal error: Unexpectedly found nil while unwrapping/, () => "nil を ! で取り出そうとしました"],
  [/Undefined name '(\w+)'/, (m) => `${q(m[1])}という名前はありません`],
  [/Expected ';' after this/, () => "「;」がありません"],
  [/The method '(\w+)' isn't defined for the (?:class|type) '(\w+)'/, (m) => `${q(m[2])}に${q(m[1])}はありません`],
  [/A value of type '(.+?)' can't be assigned to a variable of type '(.+?)'/, (m) => `${q(m[1])}は${q(m[2])}の変数に入れられません`],
  [/Null check operator used on a null value/, () => "null の値に ! を使いました"],
  // ── シェル・PowerShell
  [/(\S+): command not found/, (m) => ({ text: `${q(m[1])}というコマンドはありません（つづりか、入っていない）` })],
  [/syntax error near unexpected token `(.+?)'/, (m) => `${q(m[1])}の前の書き方がまちがっています（then・do・fi・done を確かめましょう）`],
  [/syntax error: unexpected end of file/, () => "ファイルが途中で終わっています（fi・done・esac の閉じ忘れ）"],
  [/\[: missing `\]'/, () => "[ の閉じ ] がありません（] の前に空白が必要です）"],
  [/integer expression expected/, () => "数として比べるところに、数でない値があります"],
  [/No such file or directory/, () => "ファイルやフォルダが見つかりません"],
  [/Permission denied/, () => "許可がありません（chmod +x か、場所を確かめましょう）"],
  [/is not recognized as the name of a cmdlet, function, script file, or operable program/, () => ({ text: "そのコマンドが見つかりません（入っていないか、つづりのまちがい）", hint: "インストールしたあとは、あいぞめを開き直すと見つかることがあります" })],
  [/The term '(.+?)' is not recognized/, (m) => `${q(m[1])}というコマンドが見つかりません（入っていないか、つづりのまちがい）`],
  [/Missing closing '\}' in statement block/, () => "「}」が足りません"],
  [/Unexpected token '(.+?)' in expression or statement/, (m) => `ここに${q(m[1])}は書けません`],
  [/Cannot index into a null array/, () => "中身のない配列に [ ] を使っています"],
  [/You cannot call a method on a null-valued expression/, () => "中身のない（null）値にメソッドを使っています"],
  // ── SQL
  [/no such table: (\w+)/, (m) => `テーブル${q(m[1])}がありません`],
  [/no such column: (\w+)/, (m) => `列${q(m[1])}がありません`],
  [/near "(.+?)": syntax error/, (m) => `${q(m[1])}のあたりの書き方がまちがっています`],
  [/UNIQUE constraint failed: ([\w.]+)/, (m) => `${q(m[1])}に同じ値がもうあります`],
  // ── 共通
  [/out of memory/i, () => "メモリが足りません"],
];

/** 1 つのエラーメッセージを日本語に（わからなければ元のまま） */
export function translateError(message: string, lang: string | null, source?: string): Explained {
  const msg = message.trim();
  if (settings.get("ui.language") === "en") return { text: msg };
  // Python は別の表で（直し方つき）
  const py = /^(\w+(?:Error|Exception|Warning|Interrupt|Exit|Iteration))(?::\s*(.*))?$/.exec(msg);
  if (lang === "python" && py) return explainRuntime({ line: null, message: msg, type: py[1], detail: msg }, source);
  for (const [re, make] of RULES) {
    const m = re.exec(msg);
    if (m) {
      const r = make(m);
      return typeof r === "string" ? { text: r } : r;
    }
  }
  if (py) return explainRuntime({ line: null, message: msg, type: py[1], detail: msg }, source);
  return { text: msg };
}

// ───────── 出力から「どのファイルの何行目に、どのエラー」を取り出す

interface Hit {
  file: string;
  line: number;
  col: number | null;
  msg: string | null;
  severity: "error" | "warning";
}

const LOC_RULES: { re: RegExp; get: (m: RegExpExecArray) => Hit }[] = [
  // C# / MSBuild：path(12,5): error CS0103: …
  { re: /^\s*(.+?)\((\d+),(\d+)\): (error|warning) (\w+: .+?)(?: \[.*\])?$/, get: (m) => ({ file: m[1], line: +m[2], col: +m[3], msg: m[5], severity: m[4] === "warning" ? "warning" : "error" }) },
  // gcc / clang / go / swift / dart / tsc：path:12:5: error: …
  { re: /^\s*(.+?\.\w+):(\d+):(\d+):\s*(?:(fatal error|error|warning|note|Error|Warning)\s*:\s*)?(.+)$/, get: (m) => ({ file: m[1], line: +m[2], col: +m[3], msg: m[5], severity: /warning/i.test(m[4] ?? "") ? "warning" : "error" }) },
  // javac：Main.java:12: error: …
  { re: /^\s*(.+?\.\w+):(\d+): (error|warning): (.+)$/, get: (m) => ({ file: m[1], line: +m[2], col: null, msg: `${m[3]}: ${m[4]}`, severity: m[3] === "warning" ? "warning" : "error" }) },
  // Kotlin：e: path.kt:12:5 Unresolved reference
  { re: /^([ew]): (?:file:\/\/\/?)?(.+?\.kts?):(\d+):(\d+):? (.+)$/, get: (m) => ({ file: m[2], line: +m[3], col: +m[4], msg: m[5], severity: m[1] === "w" ? "warning" : "error" }) },
  // Rust：--> src/main.rs:12:5（メッセージは前の行）
  { re: /^\s*--> (.+?):(\d+):(\d+)/, get: (m) => ({ file: m[1], line: +m[2], col: +m[3], msg: null, severity: "error" }) },
  // Ruby：path.rb:12:in `<main>': msg (NameError)
  { re: /^(.+?\.rb):(\d+):in .*?: (.+)$/, get: (m) => ({ file: m[1], line: +m[2], col: null, msg: m[3], severity: "error" }) },
  { re: /^(.+?\.rb):(\d+): (.+)$/, get: (m) => ({ file: m[1], line: +m[2], col: null, msg: m[3], severity: "error" }) },
  // PHP：… in path.php on line 12 ／ … in path.php:12
  { re: /^(?:PHP )?(?:Parse error|Fatal error|Warning|Notice|Deprecated):\s+(.+?) in (.+?\.php)(?::(\d+))? on line (\d+)/, get: (m) => ({ file: m[2], line: +m[4], col: null, msg: m[1], severity: /^(?:PHP )?(Warning|Notice|Deprecated)/.test(m[0]) ? "warning" : "error" }) },
  { re: /^(?:PHP )?(?:Parse error|Fatal error|Warning|Notice|Deprecated):\s+(.+?) in (.+?\.php):(\d+)$/, get: (m) => ({ file: m[2], line: +m[3], col: null, msg: m[1].replace(/^Uncaught \w+: /, ""), severity: /^(?:PHP )?(Warning|Notice|Deprecated)/.test(m[0]) ? "warning" : "error" }) },
  // Lua：lua: path.lua:12: msg
  { re: /^(?:lua\S*: )?(.+?\.lua):(\d+): (.+)$/, get: (m) => ({ file: m[1], line: +m[2], col: null, msg: m[3], severity: "error" }) },
  // bash：path.sh: line 12: msg
  { re: /^(.+?): line (\d+): (.+)$/, get: (m) => ({ file: m[1], line: +m[2], col: null, msg: m[3], severity: "error" }) },
  // PowerShell：At path.ps1:12 char:5
  { re: /^At (.+?\.ps1):(\d+) char:(\d+)/, get: (m) => ({ file: m[1], line: +m[2], col: +m[3], msg: null, severity: "error" }) },
];

/** 実行時のスタックトレースの「場所」の行（メッセージは別の行） */
const FRAME_RULES: { re: RegExp; get: (m: RegExpExecArray) => { file: string; line: number; col: number | null } }[] = [
  { re: /File "(.+?)", line (\d+)/, get: (m) => ({ file: m[1], line: +m[2], col: null }) }, // Python
  { re: /\bat [\w.$<>\[\]]+\((\w+\.(?:java|kt)):(\d+)\)/, get: (m) => ({ file: m[1], line: +m[2], col: null }) }, // Java・Kotlin
  { re: / in (.+?\.cs):line (\d+)/, get: (m) => ({ file: m[1], line: +m[2], col: null }) }, // C#
  { re: /\bat (?:.*? \()?(.+?\.(?:m?js|cjs|ts|mts|tsx)):(\d+):(\d+)\)?/, get: (m) => ({ file: m[1], line: +m[2], col: +m[3] }) }, // Node
  { re: /^(.+?\.(?:m?js|cjs|ts)):(\d+)$/, get: (m) => ({ file: m[1], line: +m[2], col: null }) }, // Node（コードの前の行）
  { re: /^\s+(.+?\.go):(\d+)(?: \+0x[0-9a-f]+)?$/, get: (m) => ({ file: m[1], line: +m[2], col: null }) }, // Go の panic
  { re: /panicked at (.+?\.rs):(\d+):(\d+)/, get: (m) => ({ file: m[1], line: +m[2], col: +m[3] }) }, // Rust の panic
  { re: /^\s+from (.+?\.rb):(\d+):in/, get: (m) => ({ file: m[1], line: +m[2], col: null }) }, // Ruby
  { re: /^\s+(.+?\.lua):(\d+): in /, get: (m) => ({ file: m[1], line: +m[2], col: null }) }, // Lua
];

/** 実行時のエラーの「メッセージ」の行 */
const RUNTIME_MSG = [
  /^(\w+(?:Error|Exception|Interrupt|Exit))(?::\s*.*)?$/, // Python・JS（最後の行）
  /^Exception in thread "\w+" (.+)$/, // Java
  /^Unhandled exception\.\s*(.+)$/, // C#
  /^Uncaught (\w+.*)$/, // Node（ブラウザ風）
  /^panic: (.+)$/, // Go
  /^thread '.+' panicked at .+?:\s*(.*)$/, // Rust（同じ行）
  /^(Segmentation fault|Floating point exception).*$/,
  /^terminate called after throwing .+$/,
  /^Fatal error: (.+)$/, // Swift
  /^Unhandled exception:\s*(.*)$/, // Dart
];

function baseName(p: string): string {
  return p.replace(/^file:\/\/\/?/, "").split(/[\\/]/).pop()!.replace(/\.aizome-run(?=\.)/, "").toLowerCase();
}

/**
 * 出力のテキストから、自分のファイル（names のどれか）に関係するエラーを取り出す。
 * 同じ行は 1 つにまとめる
 */
export function parseRunErrors(output: string, names: string[], lang: string | null, source?: string): ParsedError[] {
  const want = new Set(names.map(baseName));
  const mine = (f: string) => want.has(baseName(f));
  const lines = output.replace(/\r/g, "").split("\n");
  const out: ParsedError[] = [];
  const push = (file: string, line: number, col: number | null, msg: string, severity: "error" | "warning") => {
    if (!mine(file) || !line) return;
    if (out.some((e) => e.line === line && e.severity === "error" && severity === "warning")) return;
    // 引数を渡さずに実行したために出たエラーは、まちがいではないので「注意」に
    const soft = argvExplain(source?.split("\n")[line - 1], msg);
    if (soft) severity = "warning";
    const ex = soft ?? translateError(msg, lang, source);
    const dup = out.findIndex((e) => e.line === line);
    if (dup >= 0) {
      if (out[dup].severity === "warning" && severity === "error") out.splice(dup, 1);
      else return;
    }
    out.push({ ...ex, file, line, col, detail: msg, severity });
  };
  // 1. 場所とメッセージが同じ行（コンパイルのエラー）
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    for (const r of LOC_RULES) {
      const m = r.re.exec(l);
      if (!m) continue;
      const hit = r.get(m);
      let msg = hit.msg;
      // Rust：メッセージは --> の前の行（error[E0425]: …）
      if (!msg) {
        for (let k = i - 1; k >= Math.max(0, i - 3); k--) {
          if (/^(error|warning)(\[E\d+\])?: /.test(lines[k])) {
            msg = lines[k];
            if (/^warning/.test(lines[k])) hit.severity = "warning";
            break;
          }
        }
        // PowerShell：メッセージは At の前の行
        if (!msg && /\.ps1$/i.test(hit.file)) msg = lines[i - 1]?.trim() || null;
      }
      if (msg && !/^note:/.test(msg)) push(hit.file, hit.line, hit.col, msg, hit.severity);
      break;
    }
  }
  // 2. 実行時のエラー（メッセージの行と、スタックトレースの場所）
  let message: string | null = null;
  for (const l of lines) {
    for (const re of RUNTIME_MSG) {
      const m = re.exec(l.trim());
      if (m) {
        message = l.trim();
        break;
      }
    }
  }
  if (message) {
    // 自分のファイルの中で、いちばん深い（最後に出た）場所。Java・C#・Node は最初に出たもの
    let frame: { file: string; line: number; col: number | null } | null = null;
    // Python・Ruby は最後（いちばん深い）場所、それ以外（Java・C#・Node・Go）は最初に出た場所が原因の行
    const firstWins = !lines.some((l) => /^Traceback \(most recent call last\)/.test(l)) && lang !== "ruby";
    for (const l of lines) {
      for (const r of FRAME_RULES) {
        const m = r.re.exec(l);
        if (!m) continue;
        const f = r.get(m);
        if (!mine(f.file)) continue;
        if (!frame || !firstWins) frame = f;
        break;
      }
    }
    // Rust の panic はメッセージの次の行にあることもある
    let msgText0 = message;
    // Rust 1.73 から：panicked at path:1:2: の次の行がメッセージ
    if (/panicked at .+:\d+:\d+:\s*$/.test(message)) {
      const idx = lines.findIndex((l) => l.trim() === message);
      if (idx >= 0 && lines[idx + 1]) msgText0 = lines[idx + 1].trim();
    }
    const msgText = msgText0.replace(/^(Exception in thread "\w+" |Unhandled exception\.\s*|Uncaught |thread '.+' panicked at .+?:\s*)/, "");
    if (frame) push(frame.file, frame.line, frame.col, msgText || msgText0, "error");
  }
  return out.sort((a, b) => a.line - b.line);
}
