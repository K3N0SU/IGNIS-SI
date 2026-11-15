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

const QUESTION = "Is it safe to turn the cabin fans back on?";
const BASELINE = {
  fuel: "n-heptane", d0_mm: 3.9, x_o2: 0.21, pressure_atm: 1.0, airflow_cm_s: 0, flow_mode: "RESTORE_AFTER_EXTINCTION",
  restore_delay_s: 6, diluent: "N2", t_max_s: 60, dt_s: 0.1,
};
const TWIN = panel("Combustion chamber");
const FLIGHT = panel("FLEX flight tests");
const slider = (name) => `[data-testid="slider-${name}"]`;

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
const s = await openStage(browser, { framesDir: resolve(WORK, FRAMES), everyNthFrame: 3, quality: 86 });
const { page } = s;
if (reply) {
  await page.route("**/api/assistant", async (route) => {
    await new Promise((r) => setTimeout(r, 2200));
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(reply) });
  });
}

// The script is written in durations; `clock` is the running film time in seconds.
let clock = 0;
const marks = [];
const hold = async (seconds) => {
  clock += seconds;
  await s.until(clock);
};
const say = async (kicker, text, seconds) => {
  marks.push(Math.round(clock + Math.min(seconds * 0.7, seconds - 1)));
  await s.caption(kicker, text);
  await hold(seconds);
};
const focus = async (title, scale, anchor = "center") => {
  await s.zoom(panel(title), scale, anchor);
  await page.waitForTimeout(1150);
};
const replay = async (from, speed) => {
  await page.waitForTimeout(450);
  await s.speed(speed);
  await s.seek(from);
  await s.setPlaying(true);
};

await s.start();

// Title.
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await s.card(`${MARK}<p>Spacecraft fire safety,<br><b>built on NASA flight data.</b></p>`, true);
await page.waitForSelector('[data-testid="eclss"]');
await s.until(5.5);
await s.speed(1);
await s.seek(2.4);
await s.setPlaying(false);
await hold(7);
await s.card(null, false);

// The problem.
await say("The problem", "On Earth, hot gas rises and a flame feeds itself. In orbit there is no up.", 7);
await say("The problem", "A flame becomes a sphere, fed only by slow diffusion. NASA studied this on the ISS by burning single fuel droplets.", 8);
await say("The problem", "IGNIS-SI rebuilds that experiment, so you can ask what-if questions about fire in a spacecraft.", 7);

// Tour of the workbench.
await focus("Scenario", 1.5);
await say("Scenario", "Choose the fuel, the droplet size, cabin oxygen and pressure, and how the fans behave.", 8);
await focus("Combustion chamber", 1.24, "top");
await say("Combustion chamber", "A 3D view of the droplet, its flame and its soot shell, driven by the physics model.", 8);
await focus("Telemetry", 1.5);
await say("Telemetry", "Droplet size, flame temperature, sensor signals and carbon monoxide. The green dashed line is a real NASA test.", 9);
await focus("Response protocol", 1.5);
await say("Response protocol", "The life-support actions the model recommends, in order, with the numbers behind each one.", 8);
await focus("Evidence", 1.5);
await say("Evidence", "Is this prediction backed by flight data? The panel names the closest real test and links its dataset.", 9);

// The hidden fire, at real speed.
await s.zoomOut();
await replay(0, 1);
await say("One burn, real speed", "A 3.9 millimetre droplet of n-heptane ignites in still cabin air.", 8);
await s.zoom(TWIN, 1.24, "top");
await say("About six seconds in", "The flame radiates its heat away faster than it makes it, and goes out.", 7);
await say("Optical camera", "The camera sees nothing. A crew would call this fire out.", 7);
await s.click('[data-testid="sensor-mode"] [data-value="uv"]');
await say("UV sensor", "The UV sensor disagrees. An invisible cool flame near 700 kelvin is still burning.", 8);
await s.click('[data-testid="sensor-mode"] [data-value="optical"]');
await hold(1.6);
await s.click('[data-testid="sensor-mode"] [data-value="uv"]');
await s.zoomOut();
await s.seek(12);
await s.setPlaying(true);
await s.zoom(TWIN, 1.24, "top");
await say("Still burning", "Switch back and forth: the same fire, invisible to one sensor and plain to the other.", 7);
await say("Classifier", "The classifier catches it from the radiometer, UV and gas sensors alone, with no camera input.", 7);

// Fan restart.
await s.zoomOut();
await s.click('[data-testid="sensor-mode"] [data-value="optical"]');
await s.caption("What if", "The crew sees no flame and switches the cabin fans back on.");
await s.dragSlider(slider("airflow"), 8 / 20, 1500);
await replay(9.6, 1);
await s.zoom(TWIN, 1.2, "top");
await hold(6.5);
await say("Fans on", "Airflow returns six seconds after the visible flame was lost.", 3.5);
await say("Re-ignition", "Fresh oxygen pushes the cool flame through its ignition point. The fire is back.", 8);
await s.zoomOut();
await s.caption("How much air", "Slide the airflow down. Below about four centimetres per second, the cool flame is not revived.");
await s.dragSlider(slider("airflow"), 2 / 20, 1800);
await replay(11, 2);
await hold(8);
await s.dragSlider(slider("airflow"), 8 / 20, 1200);
await focus("Evidence", 1.5);
await say("Evidence", "The workbench is honest about it. NASA never tested droplets above 5 cm/s, so this is a prediction.", 9);

// Changing the experiment.
await s.zoomOut();
await s.click('[data-testid="preset-flex"]');
await s.caption("Change anything", "Every control reruns the physics in a fraction of a second. Make the droplet smaller.");
await s.dragSlider(slider("diameter"), (2.0 - 1.5) / 3.5, 1600);
await replay(0, 2);
await hold(5);
await say("Small droplet", "A two millimetre droplet never reaches the radiative limit. It burns out completely, with no cool flame.", 7);

await s.dragSlider(slider("diameter"), (3.9 - 1.5) / 3.5, 1400);
await s.caption("More oxygen", "Now raise the oxygen toward an exploration atmosphere.");
await s.dragSlider(slider("o2"), 1, 1800);
await replay(0, 4);
await hold(5);
await say("Thirty percent oxygen", "The hot flame survives to the end. No hidden cool flame, but a hotter and more intense fire.", 7);

await s.dragSlider(slider("o2"), (21 - 14) / 16, 1400);
await s.caption("Another fuel", "Switch the fuel to methanol.");
await s.select('[data-testid="fuel"]', "methanol");
await replay(0, 4);
await hold(4);
await say("Methanol", "Methanol absorbs water from its own flame and goes out early. NASA measured the same thing on orbit.", 8);

await s.select('[data-testid="fuel"]', "n-heptane");
await s.caption("Another atmosphere", "Replace the nitrogen in the cabin air with carbon dioxide.");
await page.waitForTimeout(500);
await s.click('button[data-value="CO2"]');
await replay(0, 2);
await hold(4);
await say("Carbon dioxide", "Carbon dioxide soaks up heat and radiates it away. The hot flame barely gets started.", 7);

await s.click('button[data-value="N2"]');
await s.caption("Putting it out", "Finally, lower the cabin pressure.");
await s.dragSlider(slider("pressure"), 0, 1600);
await replay(0, 2);
await s.zoom(TWIN, 1.2, "top");
await hold(4);
await say("Half an atmosphere", "The hot flame still dies, and now no cool flame can survive either.", 7);
await s.zoomOut();
await focus("Response protocol", 1.5);
await say("Response protocol", "The protocol gives the pressure and oxygen targets, and warns when the crew needs breathing apparatus.", 8);

// The assistant.
await s.zoomOut();
await s.click('[data-testid="preset-flex"]');
await replay(2.4, 1);
await s.click('[data-testid="assistant-launch"]');
await page.waitForSelector('[data-testid="assistant-panel"]');
await s.caption("Assistant", "Or just ask. The assistant runs the model and checks NASA's records for you.");
const ask = `[data-testid="assistant-panel"] button:not([disabled]):has-text("${QUESTION.slice(0, 22)}")`;
await page.waitForSelector(ask, { timeout: 8000 });
await s.click(ask);
await page.waitForSelector('[data-testid="assistant-reply"]', { timeout: 9000 }).catch(() => undefined);
await hold(9);
await s.zoom('[data-testid="assistant-panel"]', 1.35);
await say("Assistant", "Every number in its answer comes from the simulation or the flight tables, never from the language model.", 10);
await s.zoomOut();
await say("Assistant", "It can also set up the workbench, so you see the answer instead of only reading it.", 6);
await s.click('[data-testid="assistant-launch"]');

// Flight data.
await s.click('[data-testid="nav-flight"]');
await page.waitForSelector('[data-testid="flight-matrix"] circle', { timeout: 15000 }).catch(() => undefined);
await s.caption("Flight data", "Every dot is a real droplet burned on the ISS in NASA's FLEX experiment: 261 tests.");
await hold(4);
await s.click(`${FLIGHT} button[data-value="methanol"]`);
await hold(2.5);
await s.click(`${FLIGHT} button[data-value="n-heptane"]`);
await hold(2.5);
await s.click(`${FLIGHT} button[data-value="all"]`);
await hold(1);
await focus("Model against flight", 1.45);
await say("Model against flight", "Each point compares the model with one real test. The closer to the dashed line, the better.", 7);
await focus("Calibration", 1.6);
await say("Calibration", "The model was fitted to 196 tests, then checked on 65 it had never seen: 18 percent error on burning rate.", 8);
await s.zoomOut();
await focus("NASA investigations, ranked for your scenario", 1.4);
await s.caption("Investigations", "Decades of NASA results, compared by fuel, oxygen, airflow and sensors, and ranked for your scenario.");
await page.locator('[data-investigation="FLEX"]').click();
await hold(5);
await page.locator('[data-investigation="BASS-II"]').click();
await hold(4);

// Materials and atmospheres.
await s.zoomOut();
await s.click('[data-testid="nav-analytics"]');
await page.waitForSelector('[data-testid="risk-table"] tbody tr', { timeout: 15000 }).catch(() => undefined);
await s.caption("Materials", "Cabin materials ranked by how easily they ignite, how toxic they burn and how hard they are to put out.");
await s.click('[data-testid="risk-filter"] [data-value="ISS"]');
await hold(5);
await s.click('[data-testid="risk-filter"] [data-value="EVA_PREP"]');
await hold(2.5);
await s.click('[data-testid="risk-filter"] [data-value="ARTEMIS"]');
await say("Artemis", "Artemis cabins will run at 34 percent oxygen. Materials that are safe on the ISS today start to burn.", 7);

// End card.
await s.caption("", "");
await s.card(`${MARK}<p><b>See the invisible flame. Predict the backfire.</b><br>Know what has never been tested.</p>`, true);
await hold(7);

await s.stop();
await browser.close();

const report = encode({
  frames: s.frames, workDir: WORK, framesName: FRAMES, score: SCORE, output: OUTPUT, fps: 30, maxDuration: MAX_DURATION_S, crf: 18,
});
stills(OUTPUT, resolve(WORK, "verify_long"), marks.filter((t) => t < report.duration_s - 1));
rmSync(resolve(WORK, FRAMES), { recursive: true, force: true });

report.planned_s = clock;
report.within_limit = report.duration_s <= MAX_DURATION_S;
report.assistant_chapter = Boolean(reply);
console.log(JSON.stringify(report, null, 2));
process.exit(report.within_limit ? 0 : 1);
