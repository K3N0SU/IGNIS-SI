// Record the five-minute walkthrough film of the running application.
//
// See film_kit.mjs for how picture and overlays are produced. As in the short
// film, the assistant's answer is requested from the live service before
// recording starts and replayed when the question is asked, because a live
// answer takes 8 to 16 seconds.
//
// Requires the frontend on :3000 and the backend on :8000, and a five-minute
// score:  python make_score.py .capture/score_long.wav --seconds 300
// Usage:  node record_long.mjs            -> ../demo_5min.mp4

import { existsSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { MARK, encode, launch, openStage, panel, stills } from "./film_kit.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.IGNIS_URL ?? "http://localhost:3000";
const OUTPUT = resolve(here, "..", "demo_5min.mp4");
const WORK = resolve(here, ".capture");
const FRAMES = "frames_long";
const SCORE = resolve(WORK, "score_long.wav");
const MAX_DURATION_S = 300.0;
const END_S = 298.5;

const QUESTION = "Is it safe to turn the cabin fans back on?";
const BASELINE = {
  fuel: "n-heptane", d0_mm: 3.9, x_o2: 0.21, pressure_atm: 1.0, airflow_cm_s: 0, flow_mode: "RESTORE_AFTER_EXTINCTION",
  restore_delay_s: 6, diluent: "N2", t_max_s: 60, dt_s: 0.1,
};
const TWIN = panel("Combustion chamber");

if (!existsSync(SCORE)) throw new Error("Score not found. Run `python make_score.py .capture/score_long.wav --seconds 300`.");

let reply = null;
try {
  const res = await fetch(`${BASE}/api/assistant`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: QUESTION }], query: BASELINE, sensor_view: "optical", playback_time_s: 14 }),
  });
  if (res.ok) reply = await res.json();
} catch {
  reply = null;
}
if (!reply) console.warn("Assistant unavailable; that chapter will show the panel without an answer.");

const browser = await launch();
const s = await openStage(browser, { framesDir: resolve(WORK, FRAMES), everyNthFrame: 2, quality: 88 });
const { page } = s;
if (reply) {
  await page.route("**/api/assistant", async (route) => {
    await new Promise((r) => setTimeout(r, 2200));
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(reply) });
  });
}

const say = async (kicker, text, untilT) => {
  await s.caption(kicker, text);
  await s.until(untilT);
};
const focus = async (title, scale, anchor = "center") => {
  await s.zoom(panel(title), scale, anchor);
  await page.waitForTimeout(1150);
};

await s.start();

// Title.
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await s.card(`${MARK}<p>Spacecraft fire safety,<br><b>built on NASA flight data.</b></p>`, true);
await page.waitForSelector('[data-testid="eclss"]');
await page.mouse.move(960, 600);
await s.until(5.5);
await s.speed(1);
await s.seek(2.4);
await s.setPlaying(false);
await page.mouse.move(960, 640);
await s.until(7);
await s.card(null, false);

// The problem.
await say("The problem", "On Earth, hot gas rises and a flame feeds itself. In orbit there is no up.", 15);
await say("The problem", "A flame becomes a sphere, fed only by slow diffusion. NASA studied this on the ISS by burning single fuel droplets.", 24);
await say("The problem", "IGNIS-SI rebuilds that experiment, so you can ask what-if questions about fire in a spacecraft.", 32);

// Tour of the workbench.
await focus("Scenario", 1.5);
await say("Scenario", "Choose the fuel, the droplet size, cabin oxygen and pressure, and how the fans behave.", 42);
await focus("Combustion chamber", 1.24, "top");
await say("Combustion chamber", "A 3D view of the droplet, its flame and its soot shell, driven by the physics model.", 52);
await focus("Telemetry", 1.5);
await say("Telemetry", "Droplet size, flame temperature, sensor signals and carbon monoxide. The green dashed line is a real NASA test.", 63);
await focus("Response protocol", 1.5);
await say("Response protocol", "The life-support actions the model recommends, in order, with the numbers behind each one.", 73);
await focus("Evidence", 1.5);
await say("Evidence", "Is this prediction backed by flight data? The panel names the closest real test and links its dataset.", 84);

// The hidden fire, at real speed.
await s.zoomOut();
await s.seek(0);
await s.setPlaying(true);
await say("One burn, real speed", "A 3.9 millimetre droplet of n-heptane ignites in still cabin air.", 92.5);
await s.zoom(TWIN, 1.24, "top");
await say("About six seconds in", "The flame radiates its heat away faster than it makes it, and goes out.", 100);
await say("Optical camera", "The camera sees nothing. A crew would call this fire out.", 108);
await s.click('[data-testid="sensor-mode"] [data-value="uv"]');
await say("UV sensor", "The UV sensor disagrees. An invisible cool flame near 700 kelvin is still burning.", 117);
await s.zoomOut();
await s.seek(13);
await s.setPlaying(true);
await s.zoom(TWIN, 1.24, "top");
await say("Still burning", "It keeps consuming fuel and producing carbon monoxide for another thirty seconds.", 126);
await say("Classifier", "The classifier catches it from the radiometer, UV and gas sensors alone, with no camera input.", 136);

// Fan restart.
await s.zoomOut();
await s.click('[data-testid="sensor-mode"] [data-value="optical"]');
await s.caption("What if", "The crew sees no flame and switches the cabin fans back on.");
await s.dragSlider('[data-testid="slider-airflow"]', 8 / 20, 1500);
await page.waitForTimeout(500);
await s.seek(9.6);
await s.setPlaying(true);
await s.zoom(TWIN, 1.2, "top");
await s.until(146.5);
await say("Fans on", "Airflow returns six seconds after the visible flame was lost.", 150.5);
await say("Re-ignition", "Fresh oxygen pushes the cool flame through its ignition point. The fire is back.", 160);
await s.zoomOut();
await focus("Response protocol", 1.5);
await say("Response protocol", "The protocol changes: keep ventilation off until the cool flame is confirmed out.", 170);
await focus("Evidence", 1.5);
await say("Evidence", "And the workbench is honest about it. NASA never tested droplets above 5 cm/s, so this is a prediction.", 182);

// Putting it out.
await s.zoomOut();
await s.click('[data-testid="preset-flex"]');
await page.waitForTimeout(500);
await s.caption("Putting it out", "How do you stop it? One option is to lower the cabin pressure.");
await s.dragSlider('[data-testid="slider-pressure"]', 0, 1500);
await page.waitForTimeout(600);
await s.seek(0);
await s.setPlaying(true);
await s.until(193);
await s.zoom(TWIN, 1.2, "top");
await say("Half an atmosphere", "The hot flame still dies, and now no cool flame can survive either.", 202);
await s.zoomOut();
await focus("Response protocol", 1.5);
await say("Response protocol", "The protocol gives the pressure and oxygen targets, and warns when the crew needs breathing apparatus.", 213);

// The assistant.
await s.zoomOut();
await s.click('[data-testid="preset-flex"]');
await page.waitForTimeout(400);
await s.seek(2.4);
await s.setPlaying(true);
await s.click('[data-testid="assistant-launch"]');
await page.waitForSelector('[data-testid="assistant-panel"]');
await s.caption("Assistant", "Or just ask. The assistant runs the model and checks NASA's records for you.");
await s.click(`[data-testid="assistant-panel"] button:has-text("${QUESTION.slice(0, 22)}")`);
await page.waitForSelector('[data-testid="assistant-reply"]', { timeout: 9000 }).catch(() => undefined);
await s.until(226);
await s.zoom('[data-testid="assistant-panel"]', 1.35);
await say("Assistant", "Every number in its answer comes from the simulation or the flight tables, never from the language model.", 238);
await s.zoomOut();
await say("Assistant", "It can also set up the workbench, so you see the answer instead of only reading it.", 247);
await s.click('[data-testid="assistant-launch"]');

// Flight data.
await s.click('[data-testid="nav-flight"]');
await page.waitForSelector('[data-testid="flight-matrix"] circle', { timeout: 15000 }).catch(() => undefined);
await s.caption("Flight data", "Every dot is a real droplet burned on the ISS in NASA's FLEX experiment: 261 tests.");
await s.hover('[data-testid="flight-matrix"]', 0.7, 0.42);
await s.until(256);
await focus("Model against flight", 1.45);
await say("Model against flight", "Each point compares the model with one real test. The closer to the dashed line, the better.", 264);
await focus("Calibration", 1.6);
await say("Calibration", "The model was fitted to 196 tests, then checked on 65 it had never seen: 18 percent error on burning rate.", 273);
await s.zoomOut();
await focus("NASA datasets in this workbench", 1.4);
await say("Open data", "Eleven NASA investigations, all public domain, each linked by its DOI.", 281);

// Materials and atmospheres.
await s.zoomOut();
await s.click('[data-testid="nav-analytics"]');
await page.waitForSelector('[data-testid="risk-table"] tbody tr', { timeout: 15000 }).catch(() => undefined);
await s.click('[data-testid="risk-filter"] [data-value="ARTEMIS"]');
await say("Artemis", "Artemis cabins will run at 34 percent oxygen. Materials that are safe on the ISS today start to burn.", 292);

// End card.
await s.caption("", "");
await s.card(`${MARK}<p><b>See the invisible flame. Predict the backfire.</b><br>Know what has never been tested.</p>`, true);
await s.until(END_S);

await s.stop();
await browser.close();

const report = encode({
  frames: s.frames, workDir: WORK, framesName: FRAMES, score: SCORE, output: OUTPUT, fps: 30, maxDuration: MAX_DURATION_S, crf: 18,
});
stills(OUTPUT, resolve(WORK, "verify_long"), [3, 20, 38, 58, 68, 80, 96, 104, 113, 130, 155, 166, 178, 198, 208, 232, 252, 260, 269, 277, 288, 296]);
rmSync(resolve(WORK, FRAMES), { recursive: true, force: true });

report.within_limit = report.duration_s <= MAX_DURATION_S;
report.assistant_chapter = Boolean(reply);
console.log(JSON.stringify(report, null, 2));
process.exit(report.within_limit ? 0 : 1);
