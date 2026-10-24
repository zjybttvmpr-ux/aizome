import { chromium } from "playwright";
import http from "http";
import { readFileSync, existsSync } from "fs";
import path from "path";
const dist = path.join(path.dirname(new URL(import.meta.url).pathname), "dist");
const types = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".png": "image/png", ".svg": "image/svg+xml" };
http.createServer((q, r) => { let p = path.join(dist, decodeURIComponent(q.url.split("?")[0])); if (!existsSync(p) || p.endsWith("/")) p = path.join(dist, "index.html"); r.writeHead(200, { "content-type": types[path.extname(p)] ?? "application/octet-stream" }); r.end(readFileSync(p)); }).listen(4173);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1360, height: 820 } });
const logs = [];
page.on("pageerror", (e) => logs.push("PAGEERROR " + String(e)));
page.on("console", (m) => logs.push(m.type() + " " + m.text()));
await page.goto("http://127.0.0.1:4173/");
await page.waitForTimeout(1200);
for (let i = 0; i < 3; i++) { const b = await page.$(".modal .btn.primary"); if (!b) break; await b.click(); await page.waitForTimeout(300); }
await page.screenshot({ path: "shots/0-start.png" });
await page.keyboard.press("Control+o");
await page.waitForTimeout(400);
await page.click('.tree-row[data-path="/demo/main.py"]');
await page.waitForTimeout(600);
await page.click(".cm-content");
await page.keyboard.press("Control+End");
const info = async (label) => {
  const r = await page.evaluate(() => ({
    ghost: [...document.querySelectorAll(".cm-ghost")].map((e) => e.textContent),
    calls: window.__calls.filter((c) => c.startsWith("ai")).join(","),
    last: window.__lastPrompt,
    aiPill: document.querySelector(".ai-status, .ai-pill, [class*=ai-]")?.textContent?.slice(0, 60),
    settings: (() => { try { return JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(localStorage.getItem("aizome.settings") ?? "{}")).filter(([k]) => k.startsWith("ai.")))); } catch (e) { return String(e); } })(),
  }));
  console.log(label, JSON.stringify(r));
};
await info("before");
await page.keyboard.press("Enter");
await page.keyboard.type("prin", { delay: 90 });
for (const t of [500, 1000, 2000, 4000]) { await page.waitForTimeout(t); await info("after " + t); }
await page.screenshot({ path: "shots/1-prin.png" });
// 横の表示を「説明」「なし」にしても出るか
for (const mode of ["説明", "なし", "自動判定"]) {
  const btn = page.locator(`button:has-text("${mode}")`).first();
  if (await btn.count()) await btn.click().catch(() => {});
  await page.click(".cm-content");
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("prin", { delay: 90 });
  await page.waitForTimeout(3000);
  await info("mode " + mode);
  await page.screenshot({ path: `shots/2-${mode}.png` });
}
console.log(logs.filter((l) => !/^(debug|info)/.test(l)).slice(0, 60).join("\n"));
await browser.close();
process.exit(0);
