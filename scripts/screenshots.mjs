// Capture reference screenshots of the running application for visual review.
// Usage: node screenshots.mjs [outputDir]   (frontend on :3000, backend on :8000)

import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright-core";

const BASE = process.env.IGNIS_URL ?? "http://localhost:3000";
const outDir = resolve(process.argv[2] ?? ".capture/shots");
mkdirSync(outDir, { recursive: true });

async function launch() {
  for (const channel of ["chrome", "msedge", undefined]) {
    try {
      return await chromium.launch({ channel, headless: true, args: ["--enable-gpu", "--ignore-gpu-blocklist"] });
    } catch {
      continue;
    }
  }
  throw new Error("No Chromium-based browser found. Install Chrome or Edge, or run `npx playwright install chromium`.");
}

const seek = (page, t) =>
  page.evaluate((time) => {
    const el = document.querySelector('[data-testid="timeline"]');
    const total = Number(el.dataset.duration);
    const r = el.getBoundingClientRect();
    return { x: r.left + (time / total) * r.width, y: r.top + r.height / 2 };
  }, t).then(({ x, y }) => page.mouse.click(x, y));

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForSelector('[data-testid="eclss"]');
await page.click('[data-testid="play-toggle"]');

await seek(page, 2.5);
await page.waitForTimeout(700);
await page.screenshot({ path: `${outDir}/01_hot_optical.png` });

await seek(page, 14);
await page.waitForTimeout(700);
await page.screenshot({ path: `${outDir}/02_cool_optical.png` });

await page.click('[data-testid="sensor-mode"] [data-value="uv"]');
await page.waitForTimeout(900);
await page.screenshot({ path: `${outDir}/03_cool_uv.png` });

await page.click('[data-testid="preset-backfire"]');
await page.waitForTimeout(900);
await seek(page, 13.5);
await page.click('[data-testid="sensor-mode"] [data-value="optical"]');
await page.waitForTimeout(900);
await page.screenshot({ path: `${outDir}/04_reignition_optical.png` });

await page.click('[data-testid="nav-analytics"]');
await page.waitForSelector('[data-testid="risk-table"] tbody tr');
await page.waitForTimeout(1500);
await page.screenshot({ path: `${outDir}/05_analytics.png` });

await page.setViewportSize({ width: 1440, height: 900 });
await page.click('[data-testid="nav-workbench"]');
await page.waitForTimeout(1200);
await page.screenshot({ path: `${outDir}/06_workbench_1440.png` });

await browser.close();
console.log(JSON.stringify({ outDir, consoleErrors: errors }, null, 2));
process.exit(errors.length ? 1 : 0);
