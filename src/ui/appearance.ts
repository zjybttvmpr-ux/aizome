// 見た目の個別設定：背景色・アクセント色・背景画像・エディタのフォント・拡大率。
// テーマの色を土台に、設定された項目だけ上書きする。
import { settings } from "../core/settings";
import { bus } from "../core/events";
import { fs } from "../core/platform";
import { applyTheme, setOverride, setThemeHook } from "./themes";
import { toast } from "./toast";

type RGB = [number, number, number];

export function parseHex(hex: string): RGB | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let s = m[1];
  if (s.length === 3) s = s.split("").map((c) => c + c).join("");
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}

function toHex([r, g, b]: RGB): string {
  return "#" + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");
}

/** a に b を t の割合で混ぜる */
function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function luminance([r, g, b]: RGB): number {
  const f = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

const WHITE: RGB = [255, 255, 255];
const BLACK: RGB = [0, 0, 0];

/** 背景色1つから、パネルや文字の色一式を作る */
export function paletteFromBackground(bg: RGB): Record<string, string> {
  const dark = luminance(bg) < 0.4;
  const toward = dark ? WHITE : BLACK;
  const ink = dark ? mix(WHITE, bg, 0.12) : mix(BLACK, bg, 0.14);
  return {
    "--bg": toHex(bg),
    "--panel": toHex(mix(bg, toward, 0.035)),
    "--editor-bg": toHex(mix(bg, toward, 0.015)),
    "--surface": toHex(mix(bg, toward, 0.08)),
    "--surface-hover": toHex(mix(bg, toward, 0.13)),
    "--border": toHex(mix(bg, toward, 0.12)),
    "--border-strong": toHex(mix(bg, toward, 0.2)),
    "--term-bg": toHex(mix(bg, dark ? BLACK : WHITE, 0.12)),
    "--text": toHex(ink),
    "--text-muted": toHex(mix(ink, bg, 0.38)),
    "--text-faint": toHex(mix(ink, bg, 0.6)),
    "--line-active": dark ? "rgba(255, 255, 255, 0.035)" : "rgba(0, 0, 0, 0.04)",
    "--syn-variable": toHex(ink),
  };
}

export function paletteFromAccent(accent: RGB): Record<string, string> {
  const [r, g, b] = accent;
  const light = luminance(accent) > 0.35;
  return {
    "--accent": toHex(accent),
    "--accent-contrast": light ? toHex(mix(accent, BLACK, 0.82)) : "#ffffff",
    "--accent-soft": `rgba(${r}, ${g}, ${b}, 0.15)`,
    "--accent-line": `rgba(${r}, ${g}, ${b}, 0.55)`,
    "--cursor": toHex(accent),
    "--ghost-line": `rgba(${r}, ${g}, ${b}, 0.35)`,
  };
}

const DEFAULT_CODE_FONT =
  '"JetBrains Mono", "Cascadia Code", "SF Mono", "Source Han Code JP", "Noto Sans Mono CJK JP", Menlo, Consolas, "MS Gothic", monospace';

let bgLayer: HTMLElement | null = null;
let loadedImage = { path: "", url: "" };

function ensureLayer(): HTMLElement {
  if (!bgLayer) {
    bgLayer = document.createElement("div");
    bgLayer.className = "app-bg";
    bgLayer.setAttribute("aria-hidden", "true");
    document.body.prepend(bgLayer);
  }
  return bgLayer;
}

/** テーマを当てた直後に呼ばれ、個別設定で色を上書きする */
function applyColorOverrides() {
  const root = document.documentElement;
  const set = setOverride;
  const bg = parseHex(settings.get("look.bgColor"));
  const accent = parseHex(settings.get("look.accentColor"));
  if (bg) {
    for (const [k, v] of Object.entries(paletteFromBackground(bg))) set(k, v);
    const scheme = luminance(bg) < 0.4 ? "dark" : "light";
    root.dataset.scheme = scheme;
    root.style.colorScheme = scheme;
  }
  if (accent) for (const [k, v] of Object.entries(paletteFromAccent(accent))) set(k, v);
  const font = settings.get("editor.fontFamily").trim();
  if (font) set("--font-code", `${font.includes(",") || font.includes('"') ? font : `"${font}"`}, ${DEFAULT_CODE_FONT}`);
}

async function applyBackgroundImage() {
  const root = document.documentElement;
  const path = settings.get("look.bgImage");
  if (!path) {
    root.classList.remove("has-bg");
    if (bgLayer) bgLayer.style.backgroundImage = "";
    return;
  }
  if (loadedImage.path !== path) {
    try {
      loadedImage = { path, url: await fs.readDataUrl(path) };
    } catch (err) {
      const msg = String(err);
      toast(msg.includes("NOT_AN_IMAGE") ? "背景に使えるのは画像ファイルだけです" : msg.includes("FILE_TOO_LARGE") ? "背景画像は 40MB までです" : `背景画像を読み込めませんでした：${msg}`, "warn");
      root.classList.remove("has-bg");
      return;
    }
  }
  const layer = ensureLayer();
  const fit = settings.get("look.bgFit");
  layer.style.backgroundImage = `url("${loadedImage.url}")`;
  layer.style.backgroundSize = fit === "tile" ? "auto" : fit === "center" ? "auto" : fit;
  layer.style.backgroundRepeat = fit === "tile" ? "repeat" : "no-repeat";
  layer.style.backgroundPosition = "center";
  const blur = settings.get("look.bgBlur");
  layer.style.filter = blur > 0 ? `blur(${blur}px)` : "";
  // ぼかしで端が透けないよう少し大きくする
  layer.style.inset = blur > 0 ? `-${blur * 2}px` : "0";
  root.style.setProperty("--bg-dim", String(settings.get("look.bgDim")));
  root.style.setProperty("--glass", `${Math.round(settings.get("look.bgOpacity") * 100)}%`);
  root.classList.add("has-bg");
}

function applyZoom() {
  const z = settings.get("look.zoom");
  (document.body.style as CSSStyleDeclaration & { zoom: string }).zoom = z === 1 ? "" : String(z);
}

export function initAppearance() {
  setThemeHook(applyColorOverrides);
  applyColorOverrides();
  void applyBackgroundImage().then(() => bus.emit("theme:changed", { id: settings.get("ui.theme") }));
  applyZoom();
  bus.on("settings:changed", ({ key }) => {
    if (key === "look.bgColor" || key === "look.accentColor" || key === "editor.fontFamily") {
      // テーマを当て直してから上書きし直す（色を空に戻したときのため）
      applyTheme(settings.get("ui.theme"));
    }
    if (key.startsWith("look.bg") && key !== "look.bgColor") {
      void applyBackgroundImage().then(() => bus.emit("theme:changed", { id: settings.get("ui.theme") }));
    }
    if (key === "look.zoom") applyZoom();
  });
}

export function zoomBy(delta: number) {
  const z = Math.round(Math.min(1.8, Math.max(0.6, settings.get("look.zoom") + delta)) * 10) / 10;
  settings.set("look.zoom", z);
}
