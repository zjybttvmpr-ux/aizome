import type { DictLanguage } from "./types";

export const csharp: DictLanguage = {
  id: "csharp",
  label: "C#（Unity）",
  exts: [".cs"],
  entries: [
    // ───── Unity の基本
    ["Unity 基本", "スクリプトのひな形", "MonoBehaviour Start Update ひな形 テンプレート", "using UnityEngine;\n\npublic class ⟨Player⟩ : MonoBehaviour\n{\n    void Start()\n    {\n        ⟨⟩\n    }\n\n    void Update()\n    {\n        \n    }\n}"],
    ["Unity 基本", "Console に表示", "Debug.Log ログ 表示 デバッグ", "Debug.Log(⟨\"こんにちは\"⟩);"],
    ["Unity 基本", "インスペクターで設定できる変数", "SerializeField public インスペクター", "[SerializeField] private float ⟨speed⟩ = ⟨5f⟩;"],
    ["Unity 基本", "同じオブジェクトの部品を取る", "GetComponent コンポーネント 取得", "⟨Rigidbody⟩ ⟨rb⟩ = GetComponent<⟨Rigidbody⟩>();"],
    ["Unity 基本", "名前・タグでオブジェクトを探す", "Find FindWithTag 探す", "GameObject ⟨target⟩ = GameObject.FindWithTag(\"⟨Player⟩\");"],
    ["Unity 基本", "表示・非表示にする", "SetActive 表示 非表示", "⟨obj⟩.SetActive(⟨false⟩);"],
    ["Unity 基本", "オブジェクトを消す", "Destroy 削除 消す", "Destroy(⟨gameObject⟩, ⟨0f⟩);  // 2 つ目は何秒後か"],
    ["Unity 基本", "プレハブから作る", "Instantiate 生成 プレハブ 弾", "Instantiate(⟨prefab⟩, ⟨transform.position⟩, Quaternion.identity);"],

    // ───── 移動・入力
    ["移動・入力", "矢印キー・WASD で動かす", "Input GetAxis 移動 キー操作", "float h = Input.GetAxis(\"Horizontal\");\nfloat v = Input.GetAxis(\"Vertical\");\ntransform.Translate(new Vector3(h, 0, v) * ⟨speed⟩ * Time.deltaTime);"],
    ["移動・入力", "キーが押された瞬間", "GetKeyDown キー 押した ジャンプ", "if (Input.GetKeyDown(KeyCode.⟨Space⟩))\n{\n    ⟨⟩\n}"],
    ["移動・入力", "マウスがクリックされた瞬間", "GetMouseButtonDown クリック マウス", "if (Input.GetMouseButtonDown(0))\n{\n    ⟨⟩\n}"],
    ["移動・入力", "ジャンプする（Rigidbody）", "AddForce ジャンプ 力", "⟨rb⟩.AddForce(Vector3.up * ⟨5f⟩, ForceMode.Impulse);"],
    ["移動・入力", "向きを回す", "Rotate 回転", "transform.Rotate(0, ⟨90f⟩ * Time.deltaTime, 0);"],
    ["移動・入力", "相手のほうを向く", "LookAt 向く", "transform.LookAt(⟨target⟩.transform);"],
    ["移動・入力", "なめらかに近づける", "Lerp MoveTowards 追いかける カメラ", "transform.position = Vector3.Lerp(transform.position, ⟨target⟩.position, ⟨5f⟩ * Time.deltaTime);"],
    ["移動・入力", "2D で左右に動かす", "Rigidbody2D velocity 2D 横移動", "float h = Input.GetAxis(\"Horizontal\");\n⟨rb⟩.velocity = new Vector2(h * ⟨speed⟩, ⟨rb⟩.velocity.y);"],

    // ───── 当たり判定
    ["当たり判定", "ぶつかったとき", "OnCollisionEnter 衝突 当たり", "void OnCollisionEnter(Collision collision)\n{\n    if (collision.gameObject.CompareTag(\"⟨Enemy⟩\"))\n    {\n        ⟨⟩\n    }\n}"],
    ["当たり判定", "すり抜ける範囲に入ったとき（トリガー）", "OnTriggerEnter トリガー アイテム 取る", "void OnTriggerEnter(Collider other)\n{\n    if (other.CompareTag(\"⟨Item⟩\"))\n    {\n        ⟨⟩\n    }\n}"],
    ["当たり判定", "2D でぶつかったとき", "OnCollisionEnter2D 2D 衝突", "void OnCollisionEnter2D(Collision2D collision)\n{\n    ⟨⟩\n}"],
    ["当たり判定", "前に何かあるか調べる（Raycast）", "Raycast レイ 判定", "if (Physics.Raycast(transform.position, transform.forward, out RaycastHit hit, ⟨10f⟩))\n{\n    Debug.Log(hit.collider.name);\n}"],

    // ───── 時間・シーン・UI
    ["時間・シーン・UI", "少し待ってから動かす（コルーチン）", "Coroutine IEnumerator WaitForSeconds 待つ", "IEnumerator ⟨Wait⟩()\n{\n    yield return new WaitForSeconds(⟨1f⟩);\n    ⟨⟩\n}\n// 呼ぶとき: StartCoroutine(Wait());"],
    ["時間・シーン・UI", "何秒後に関数を呼ぶ", "Invoke 遅延 タイマー", "Invoke(nameof(⟨Method⟩), ⟨2f⟩);"],
    ["時間・シーン・UI", "シーンを切り替える", "SceneManager LoadScene シーン 切り替え", "using UnityEngine.SceneManagement;\n\nSceneManager.LoadScene(\"⟨GameOver⟩\");"],
    ["時間・シーン・UI", "画面の文字を書き換える（TextMeshPro）", "TextMeshPro TMP UI テキスト スコア", "using TMPro;\n\n[SerializeField] private TextMeshProUGUI ⟨scoreText⟩;\n// 書き換えるとき\n⟨scoreText⟩.text = $\"スコア：{⟨score⟩}\";"],
    ["時間・シーン・UI", "ボタンが押されたら", "Button onClick UI ボタン", "using UnityEngine.UI;\n\n[SerializeField] private Button ⟨button⟩;\n\nvoid Start()\n{\n    ⟨button⟩.onClick.AddListener(⟨OnClick⟩);\n}"],
    ["時間・シーン・UI", "音を鳴らす", "AudioSource PlayOneShot 音 効果音", "[SerializeField] private AudioSource ⟨audioSource⟩;\n[SerializeField] private AudioClip ⟨clip⟩;\n// 鳴らすとき\n⟨audioSource⟩.PlayOneShot(⟨clip⟩);"],
    ["時間・シーン・UI", "データを保存・読み込み", "PlayerPrefs 保存 セーブ ハイスコア", "PlayerPrefs.SetInt(\"⟨HighScore⟩\", ⟨score⟩);\nint ⟨best⟩ = PlayerPrefs.GetInt(\"⟨HighScore⟩\", 0);"],
    ["時間・シーン・UI", "ゲームを止める・再開", "timeScale ポーズ 一時停止", "Time.timeScale = ⟨0f⟩;  // 再開は 1f"],

    // ───── C# の基本
    ["C# 基本", "もし〜なら", "if else 条件", "if (⟨条件⟩)\n{\n    ⟨⟩\n}\nelse\n{\n    \n}"],
    ["C# 基本", "決まった回数くり返す", "for ループ", "for (int ⟨i⟩ = 0; ⟨i⟩ < ⟨10⟩; ⟨i⟩++)\n{\n    ⟨⟩\n}"],
    ["C# 基本", "リストの中身を順に", "foreach ループ", "foreach (var ⟨item⟩ in ⟨items⟩)\n{\n    ⟨⟩\n}"],
    ["C# 基本", "リスト（List）を使う", "List 追加 Add 配列", "using System.Collections.Generic;\n\nList<⟨int⟩> ⟨items⟩ = new List<⟨int⟩>();\n⟨items⟩.Add(⟨1⟩);"],
    ["C# 基本", "辞書（Dictionary）を使う", "Dictionary 辞書 キー", "Dictionary<string, int> ⟨d⟩ = new Dictionary<string, int>();\n⟨d⟩[\"⟨key⟩\"] = ⟨1⟩;"],
    ["C# 基本", "ランダムな数", "Random Range 乱数", "int ⟨n⟩ = Random.Range(⟨0⟩, ⟨10⟩);  // 10 は含まない"],
    ["C# 基本", "メソッドを作る", "メソッド 関数 void", "private ⟨void⟩ ⟨Name⟩(⟨int x⟩)\n{\n    ⟨⟩\n}"],
    ["C# 基本", "文字列に変数を入れる", "$ 補間 文字列", "$\"⟨名前⟩：{⟨x⟩}\""],
    ["C# 基本", "シングルトン（どこからでも呼べる管理役）", "singleton GameManager Instance", "public static ⟨GameManager⟩ Instance { get; private set; }\n\nvoid Awake()\n{\n    if (Instance != null) { Destroy(gameObject); return; }\n    Instance = this;\n    DontDestroyOnLoad(gameObject);\n}"],
  ],
};
