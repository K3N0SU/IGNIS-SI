// End-to-end check of the interface in a real browser.
//
// Drives the running application the way a user would and asserts on what is
// on screen. Requires the frontend on :3000 and the backend on :8000.
// Usage: node e2e_test.mjs

import { chromium } from "playwright-core";

const BASE = process.env.IGNIS_URL ?? "http://localhost:3000";
const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};

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

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));

const text = (selector) => page.locator(selector).first().innerText();
const seek = async (simTime) => {
  const el = page.locator('[data-testid="timeline"]');
  const box = await el.boundingBox();
  const total = Number(await el.getAttribute("data-duration"));
  await page.mouse.click(box.x + (simTime / total) * box.width, box.y + box.height / 2);
};

await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForSelector('[data-testid="eclss"]');
check("workbench loads without page scroll", await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight));

const body = await page.locator("body").innerText();
check("no slash-joined labels on screen", !/\s\/\/\s/.test(body) && !/[A-Za-z] \/ [A-Za-z]/.test(body));
check("no zero-padded step numbers", !/(^|\n)0[1-9](\n|\s)/.test(body));

await page.click('[data-testid="play-toggle"]');
await seek(3);
await page.waitForTimeout(500);
check("hot flame is reported early in the burn", /hot flame/i.test(await text('[data-testid="fire-state"]')));

await seek(16);
await page.waitForTimeout(600);
const state = await text('[data-testid="fire-state"]');
check("cool flame is reported after the visible flame is lost", /cool flame/i.test(state), state.split("\n")[0]);
check("hidden-flame alert is shown in the optical view", await page.locator('[data-testid="hidden-flame-alert"]').isVisible());

await page.click('[data-testid="sensor-mode"] [data-value="uv"]');
await page.waitForTimeout(400);
check("alert clears in the UV view", !(await page.locator('[data-testid="hidden-flame-alert"]').isVisible()));

const evidence = await text('[data-testid="citation-inspector"]');
check("evidence names the closest NASA flight test", /181F001/.test(evidence));
check("evidence links a NASA dataset DOI", /10\.60555\/mbq8-0451/.test(evidence));
check("flight measurement is overlaid on the telemetry", await page.locator('[data-testid="flight-overlay"]').isVisible());

await page.click('[data-testid="preset-backfire"]');
await page.waitForFunction(() => /re-ignit/i.test(document.querySelector('[data-testid="eclss"]')?.textContent ?? ""), null, { timeout: 15000 });
check("fan restart produces a re-ignition protocol", true);
await page.waitForFunction(() => /beyond/i.test(document.querySelector('[data-testid="citation-inspector"]')?.textContent ?? ""), null, { timeout: 15000 });
check("fan restart is flagged as beyond flown conditions", true);

await page.click('[data-testid="nav-analytics"]');
await page.waitForSelector('[data-testid="risk-table"] tbody tr');
const all = await page.locator('[data-testid="risk-table"] tbody tr').count();
await page.click('[data-testid="risk-filter"] [data-value="ARTEMIS"]');
await page.waitForTimeout(300);
const artemis = await page.locator('[data-testid="risk-table"] tbody tr').count();
check("risk table filters by atmosphere", all === 18 && artemis === 6, `${all} -> ${artemis}`);

await page.click('[data-testid="nav-flight"]');
await page.waitForSelector('[data-testid="investigations"] tbody tr', { timeout: 60000 });
check("investigations are compared and ranked", (await page.locator('[data-testid="investigations"] tbody tr').count()) === 8);
check("FLEX ranks first for a droplet scenario", (await page.locator('[data-testid="investigations"] tbody tr').first().getAttribute("data-investigation")) === "FLEX");
await page.locator('[data-testid="investigations"] tbody tr').first().click();
check("an investigation expands to findings, sensors and DOIs", /10\.60555\/mbq8-0451/.test(await text('[data-testid="investigations"]')));
await page.waitForSelector('[data-testid="flight-matrix"] circle', { timeout: 15000 }).catch(() => undefined);
check("flight view plots the FLEX tests", (await page.locator('[data-testid="flight-matrix"] circle').count()) > 250);
check("calibration results are shown", /held-out/i.test(await text('[data-testid="calibration"]')));

await page.click('[data-testid="nav-how"]');
await page.waitForFunction(() => /^\d+$/.test(document.querySelector('[data-testid="how-stage-check"] .num')?.textContent ?? ""), null, { timeout: 30000 });
const how = await text('[data-testid="how-it-works"]');
check("how it works shows the pipeline with live numbers", /261/.test(how) && /196/.test(how) && /65/.test(how));
await page.hover('[data-testid="how-stage-fit"]');
check("hovering a stage shows a description", /not a black box/.test(await text('[role="tooltip"]')));
await page.click('[data-testid="how-open-workbench"]');
await page.waitForSelector('[data-testid="fold-presets"]');
await page.click('[data-testid="fold-presets"]');
const hidden = (await page.locator('[data-testid="preset-flex"]').count()) === 0;
await page.click('[data-testid="fold-presets"]');
check("sections fold away and drop back down", hidden && (await page.locator('[data-testid="preset-flex"]').isVisible()));
await page.click('[data-testid="fold-chart-tf"]');
const chartGone = (await page.locator('[data-testid="chart-tf"]').count()) === 0;
await page.click('[data-testid="fold-chart-tf"]');
check("charts fold away and come back", chartGone && (await page.locator('[data-testid="chart-tf"]').isVisible()));

await page.click('[data-testid="assistant-launch"]');
await page.waitForSelector('[data-testid="assistant-panel"]');
const status = await (await page.request.get(`${BASE}/api/assistant/status`)).json();
const panel = await text('[data-testid="assistant-panel"]');
check(
  "assistant panel matches its configuration",
  status.configured ? /ask about anything/i.test(panel) : /not set up/i.test(panel),
  status.configured ? "configured" : "no key",
);

check("no console errors", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();

const failed = results.filter((ok) => !ok).length;
console.log(`\n${failed === 0 ? "ALL UI CHECKS PASSED" : `${failed} UI CHECK(S) FAILED`}`);
process.exit(failed ? 1 : 0);
