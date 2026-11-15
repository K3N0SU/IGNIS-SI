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
const FLIGHT = panel("FLEX flight tests");

const QUESTION = "Has NASA actually tested this, or is it a model prediction?";
const BACKFIRE = {
  fuel: "n-heptane", d0_mm: 3.9, x_o2: 0.21, pressure_atm: 1.0, airflow_cm_s: 8, flow_mode: "RESTORE_AFTER_EXTINCTION",
  restore_delay_s: 6, diluent: "N2", t_max_s: 60, dt_s: 0.1,
};

if (!existsSync(SCORE)) throw new Error("Score not found. Run `python make_score.py` first.");

let reply = null;
try {
  const res = await fetch(`${BASE}/api/assistant`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: QUESTION }], query: BACKFIRE, sensor_view: "optical", playback_time_s: 14 }),
  });
  if (res.ok) reply = await res.json();
} catch {
  reply = null;
}
if (!reply) console.warn("Assistant unavailable; the film will skip the assistant beat.");

const browser = await launch();
const s = await openStage(browser, { framesDir: resolve(WORK, FRAMES) });
const { page } = s;
if (reply) {
  await page.route("**/api/assistant", async (route) => {
    await new Promise((r) => setTimeout(r, 900));
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(reply) });
  });
}

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

// The assistant answers from flight data.
if (reply) {
  await s.click('[data-testid="assistant-launch"]');
  await s.caption("Assistant", "Ask it anything. It runs the model and checks NASA flight records.");
  await page.waitForSelector('[data-testid="assistant-panel"]');
  const ask = `[data-testid="assistant-panel"] button:not([disabled]):has-text("${QUESTION.slice(0, 24)}")`;
  await page.waitForSelector(ask, { timeout: 8000 });
  await s.click(ask);
  await page.waitForSelector('[data-testid="assistant-reply"]', { timeout: 6000 }).catch(() => undefined);
  await s.until(23.4);
  await s.click('[data-testid="assistant-launch"]');
} else {
  await s.until(23.4);
}

// Real flight data, filtered live.
await s.click('[data-testid="nav-flight"]');
await s.caption("Flight data", "Calibrated on 261 real ISS droplet burns. NASA's investigations, compared and ranked.");
await page.waitForSelector('[data-testid="flight-matrix"] circle', { timeout: 8000 }).catch(() => undefined);
await s.until(24.6);
await s.click(`${FLIGHT} button[data-value="methanol"]`);
await s.until(25.4);
await s.click(`${FLIGHT} button[data-value="n-heptane"]`);
await s.until(26.2);

// Material risk across atmospheres.
await s.click('[data-testid="nav-analytics"]');
await s.caption("Artemis", "At 34 % oxygen, materials that are safe on the ISS start to burn.");
await page.waitForSelector('[data-testid="risk-table"] tbody tr', { timeout: 8000 }).catch(() => undefined);
await s.click('[data-testid="risk-filter"] [data-value="ISS"]');
await s.until(27.0);
await s.click('[data-testid="risk-filter"] [data-value="ARTEMIS"]');
await s.until(27.8);

// End card.
await s.caption("", "");
await s.card(`${MARK}<p><b>See the invisible flame. Predict the backfire.</b><br>Know what has never been tested.</p>`, true);
await s.until(29.6);

await s.stop();
await browser.close();

const report = encode({
  frames: s.frames, workDir: WORK, framesName: FRAMES, score: SCORE, output: OUTPUT, fps: 60, maxDuration: MAX_DURATION_S, crf: 15,
});
stills(OUTPUT, resolve(WORK, "verify_short"), [1, 4, 7, 10, 13, 16, 19, 22, 25, 26, 27, 29]);
rmSync(resolve(WORK, FRAMES), { recursive: true, force: true });

report.within_limit = report.duration_s <= MAX_DURATION_S;
report.assistant_beat = Boolean(reply);
console.log(JSON.stringify(report, null, 2));
process.exit(report.within_limit ? 0 : 1);
