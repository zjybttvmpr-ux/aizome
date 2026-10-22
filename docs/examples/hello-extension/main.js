function activate(aizome) {
  aizome.commands.register("hello.insert", async () => {
    const name = await aizome.window.showInput({ title: "だれにあいさつしますか？", placeholder: "藍子" });
    if (!name) return;
    await aizome.editor.insertText(`こんにちは、${name}さん`);
  });

  aizome.commands.register("hello.todos", async () => {
    const text = await aizome.editor.getText();
    const todos = text
      .split("\n")
      .map((line, i) => ({ line: i + 1, text: line.trim() }))
      .filter((l) => /\b(TODO|FIXME)\b/.test(l.text));
    if (!todos.length) {
      await aizome.window.showMessage("TODO はありません", "success");
      return;
    }
    const picked = await aizome.window.showQuickPick(
      todos.map((t) => ({ label: t.text, detail: `${t.line} 行目`, value: t.line })),
      { placeholder: "移動する TODO を選ぶ" },
    );
    if (picked) await aizome.commands.execute("editor.goToLineNumber", picked);
  });
}
