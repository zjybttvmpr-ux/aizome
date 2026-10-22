// 拡張機能の見本。activate(aizome) が起動時に1回呼ばれる。
// この中のコードは Web Worker で動き、エディタには aizome の API 経由でだけ触れる。

function activate(aizome) {
  async function updateCount() {
    const file = await aizome.editor.activeFile();
    if (!file) {
      await aizome.statusBar.clear("count");
      return;
    }
    const text = await aizome.editor.getText();
    await aizome.statusBar.set("count", `${[...text].length.toLocaleString()} 文字`, "ファイル全体の文字数");
  }

  aizome.on("activeChanged", updateCount);
  aizome.on("fileSaved", updateCount);

  aizome.commands.register("toolkit.count", async () => {
    const selection = await aizome.editor.getSelection();
    const text = selection || (await aizome.editor.getText());
    const chars = [...text].length;
    const lines = text ? text.split("\n").length : 0;
    const scope = selection ? "選択範囲" : "ファイル全体";
    await aizome.window.showMessage(`${scope}：${chars.toLocaleString()} 文字、${lines.toLocaleString()} 行`);
  });

  aizome.commands.register("toolkit.upper", async () => {
    const selection = await aizome.editor.getSelection();
    if (!selection) {
      await aizome.window.showMessage("先に文字を選択してください", "warn");
      return;
    }
    await aizome.editor.replaceSelection(selection.toUpperCase());
  });

  aizome.commands.register("toolkit.explain", async () => {
    const selection = await aizome.editor.getSelection();
    if (!selection) {
      await aizome.window.showMessage("説明してほしいコードを選択してください", "warn");
      return;
    }
    const language = await aizome.editor.language();
    await aizome.window.showMessage("AI が考えています…");
    const prompt =
      `次の ${language} のコードが何をしているか、日本語で3文以内で説明してください。\n\n` +
      "```\n" + selection.slice(0, 4000) + "\n```\n";
    const answer = await aizome.ai.complete(prompt, { maxTokens: 300 });
    await aizome.window.showMessage(answer.trim() || "説明を作れませんでした");
  });

  updateCount();
}
