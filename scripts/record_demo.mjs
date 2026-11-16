// Record the 30-second film of the running application.
//
// See film_kit.mjs for how picture and overlays are produced. One edit is made
// for time: the assistant's answer is requested from the live service before
// recording starts and replayed when the question is asked, because a live
// answer takes 8 to 16 seconds.
//
// Requires the frontend on :3000 and the backend on :8000, and the score:
//   python make_score.py
// Usage: node record_demo.mjs            -> ../demo_30s.mp4

import { existsSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { MARK, encode, launch, openStage, panel, stills } from "./film_kit.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.IGNIS_URL ?? "http://localhost:3000";
const OUTPUT = resolve(here, "..", "demo_30s.mp4");
const WORK = resolve(here, ".capture");
const FRAMES = "frames";
const SCORE = resolve(WORK, "score.wav");
const MAX_DURATION_S = 30.0;
const TWIN = panel("Combustion chamber");


if (!existsSync(SCORE)) throw new Error("Score not found. Run `python make_score.py` first.");

const browser = await launch();
const s = await openStage(browser, { framesDir: resolve(WORK, FRAMES) });
const { page } = s;
await s.start();

// Title card while the workbench loads underneath.
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await s.card(`${MARK}<p>Fire behaves differently in orbit.<br><b>Some of it you cannot see.</b></p>`, true);
await page.waitForSelector('[data-testid="eclss"]');
await s.until(2.0);
await s.seek(0.5);
await s.setPlaying(true);
await s.until(2.3);
await s.card(null, false);
await s.caption("International Space Station", "A fuel droplet burns in microgravity. With no buoyancy, the flame is a sphere.");
await s.until(5.2);

// The visible flame goes out.
await s.zoom(TWIN, 1.26, "top");
await s.caption("Optical camera", "The flame radiates its heat away and goes out. The camera sees nothing.");
await s.until(8.0);

// The UV channel reveals the cool flame.
await s.click('[data-testid="sensor-mode"] [data-value="uv"]');
await s.caption("UV sensor", "But it is still burning: an invisible cool flame near 700 K.");
await s.until(10.8);

// Ventilation restart and re-ignition.
await s.zoomOut();
await s.click('[data-testid="sensor-mode"] [data-value="optical"]');
await s.caption("What if", "The crew sees no flame and switches the cabin fans back on.");
await s.dragSlider('[data-testid="slider-airflow"]', 8 / 20, 1000);
await page.waitForTimeout(350);
await s.speed(1);
await s.seek(12.1);
await s.setPlaying(true);
await s.zoom(TWIN, 1.2, "top");
await s.until(14.7);
await s.caption("Re-ignition", "Fresh air feeds the cool flame. The fire comes back.");
await s.until(16.8);

// Lower the pressure: nothing survives.
await s.zoomOut();
await s.caption("Putting it out", "Drop the cabin pressure and neither flame can survive.");
await s.dragSlider('[data-testid="slider-pressure"]', 0, 900);
await page.waitForTimeout(350);
await s.speed(4);
await s.seek(0);
await s.setPlaying(true);
await s.until(20.2);

// One deliberate move to one other screen: where the numbers come from.
await s.caption("", "");
await s.card(`<p style="font-size:40px"><b>Can you trust it?</b></p>`, true);
await page.waitForTimeout(600);
await s.click('[data-testid="nav-how"]');
await page.waitForSelector('[data-testid="how-stage-check"]', { timeout: 8000 }).catch(() => undefined);
await page
  .waitForFunction(() => /^\d+$/.test(document.querySelector('[data-testid="how-stage-check"] .num')?.textContent ?? ""), null, { timeout: 8000 })
  .catch(() => undefined);
await s.until(21.7);
await s.card(null, false);
await s.zoom('[data-testid="how-stage-data"]', 1.5, "top");
await s.caption("Built on flight data", "261 real droplet burns on the ISS tune the physics model.");
await s.until(24.7);
await s.zoom('[data-testid="how-stage-check"]', 1.5, "top");
await s.caption("Checked, not assumed", "65 tests it never saw score it: 18 % error on burning rate.");
await s.until(27.5);

// End card.
await s.caption("", "");
await s.card(`${MARK}<p><b>See the invisible flame. Predict the backfire.</b><br>Know what has never been tested.</p>`, true);
await s.until(29.7);

await s.stop();
await browser.close();

const report = encode({
  frames: s.frames, workDir: WORK, framesName: FRAMES, score: SCORE, output: OUTPUT, fps: 60, maxDuration: MAX_DURATION_S, crf: 15,
});
stills(OUTPUT, resolve(WORK, "verify_short"), [1, 4, 7, 10, 13, 16, 19, 21, 23, 26, 28, 29]);
rmSync(resolve(WORK, FRAMES), { recursive: true, force: true });

report.within_limit = report.duration_s <= MAX_DURATION_S;
console.log(JSON.stringify(report, null, 2));
process.exit(report.within_limit ? 0 : 1);
