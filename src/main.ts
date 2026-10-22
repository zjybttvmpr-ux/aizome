import "./styles/app.css";
import { App } from "./app";
import { applyTheme } from "./ui/themes";
import { settings } from "./core/settings";

// 拡張機能（テーマ）が読み込まれる前でも、組み込みの既定色で描画する
applyTheme(settings.get("ui.theme"));

const root = document.getElementById("app")!;
new App(root).start().catch((err) => {
  console.error(err);
  root.textContent = `起動に失敗しました: ${String(err)}`;
});
