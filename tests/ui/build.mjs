import { cpSync, mkdirSync, writeFileSync } from "fs";
import path from "path";
import * as esbuild from "esbuild";
const here = path.dirname(new URL(import.meta.url).pathname);
const proj = path.resolve(here, "../..");
const out = path.join(here, "dist");
mkdirSync(out, { recursive: true });
const stubs = {
  "@tauri-apps/api/core": path.join(here, "stubs/tauri-core.js"),
  "@tauri-apps/api/event": path.join(here, "stubs/tauri-event.js"),
  "@tauri-apps/plugin-dialog": path.join(here, "stubs/tauri-dialog.js"),
  "@tauri-apps/api/window": path.join(here, "stubs/tauri-window.js"),
  "@tauri-apps/api/webview": path.join(here, "stubs/tauri-webview.js"),
};
await esbuild.build({
  entryPoints: [path.join(proj, "src/main.ts")], bundle: true, format: "esm", outfile: path.join(out, "app.js"),
  loader: { ".ttf": "file", ".woff2": "file", ".woff": "file", ".png": "file", ".svg": "file" },
  plugins: [{ name: "stubs", setup(b) { b.onResolve({ filter: /.*/ }, (a) => {
    if (stubs[a.path]) return { path: stubs[a.path] };
    if (a.path === "./xtermView") return { path: path.join(here, "stubs/xterm.ts") };
    return undefined; }); } }],
  logLevel: "warning",
});
cpSync(path.join(proj, "public"), out, { recursive: true });
writeFileSync(path.join(out, "index.html"), `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>Aizome</title><link rel="stylesheet" href="/app.css"></head><body><div id="app"></div><script type="module" src="/app.js"></script></body></html>`);
console.log("built");
