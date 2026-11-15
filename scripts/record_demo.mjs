// Record the 30-second demonstration video of the running application.
//
// Frames are pulled from the Chromium compositor through the DevTools
// screencast API with their presentation timestamps, then encoded to a
// constant-frame-rate H.264 file. Requires the frontend on :3000 and the
// backend on :8000.
//
// Usage: node record_demo.mjs            -> ../demo_30s.mp4

import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import ffmpegPath from "ffmpeg-static";
import ffprobe from "ffprobe-static";
import { chromium } from "playwright-core";

const here = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.IGNIS_URL ?? "http://localhost:3000";
const OUTPUT = resolve(here, "..", "demo_30s.mp4");
const WORK = resolve(here, ".capture");
const FRAMES = resolve(WORK, "frames");
const VERIFY = resolve(WORK, "verify");
const WIDTH = 1920;
const HEIGHT = 1080;
const DURATION_S = 29.4;
const OUTPUT_FPS = 60;
const MAX_DURATION_S = 30.0;

rmSync(FRAMES, { recursive: true, force: true });
rmSync(VERIFY, { recursive: true, force: true });
mkdirSync(FRAMES, { recursive: true });
mkdirSync(VERIFY, { recursive: true });

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
const context = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
const page = await context.newPage();

// Headless capture has no system pointer; draw one, and a caption strip,
// so the viewer can follow the interaction.
await page.addInitScript(() => {
  window.addEventListener("DOMContentLoaded", () => {
    const pointer = document.createElement("div");
    pointer.style.cssText =
      "position:fixed;z-index:99999;width:16px;height:16px;margin:-8px 0 0 -8px;border:1.5px solid #F3F4F6;" +
      "border-radius:50%;pointer-events:none;left:-40px;top:-40px;transition:transform 90ms ease-out;";
    document.body.appendChild(pointer);
    window.addEventListener("mousemove", (e) => {
      pointer.style.left = `${e.clientX}px`;
      pointer.style.top = `${e.clientY}px`;
    }, true);
    window.addEventListener("mousedown", () => (pointer.style.transform = "scale(0.6)"), true);
    window.addEventListener("mouseup", () => (pointer.style.transform = "scale(1)"), true);

    const caption = document.createElement("div");
    caption.id = "demo-caption";
    caption.style.cssText =
      "position:fixed;z-index:99998;left:50%;bottom:74px;transform:translateX(-50%);padding:8px 14px;" +
      "background:#111318;border:1px solid #2A303B;border-radius:6px;color:#F3F4F6;font:500 15px 'Inter Variable',sans-serif;" +
      "pointer-events:none;opacity:0;transition:opacity 200ms linear;white-space:nowrap;";
    document.body.appendChild(caption);
  });
});

const caption = (text) =>
  page.evaluate((t) => {
    const el = document.getElementById("demo-caption");
    if (!el) return;
    el.textContent = t;
    el.style.opacity = t ? "1" : "0";
  }, text);

const cdp = await context.newCDPSession(page);
const frames = [];
let writes = Promise.resolve();
cdp.on("Page.screencastFrame", (event) => {
  const index = frames.length;
  frames.push({ file: `f${String(index).padStart(5, "0")}.jpg`, ts: event.metadata.timestamp });
  writeFileSync(resolve(FRAMES, frames[index].file), Buffer.from(event.data, "base64"));
  writes = writes.then(() => cdp.send("Page.screencastFrameAck", { sessionId: event.sessionId }).catch(() => undefined));
});

const center = async (selector) => {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`Element not found: ${selector}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, box };
};

const click = async (selector) => {
  const { x, y } = await center(selector);
  await page.mouse.move(x, y, { steps: 22 });
  await page.waitForTimeout(120);
  await page.mouse.down();
  await page.mouse.up();
};

const seek = async (simTime) => {
  const { box } = await center('[data-testid="timeline"]');
  const total = Number(await page.getAttribute('[data-testid="timeline"]', "data-duration"));
  const x = box.x + (simTime / total) * box.width;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y, { steps: 18 });
  await page.mouse.down();
  await page.mouse.up();
};

const dragSlider = async (selector, fraction, ms) => {
  const { box } = await center(selector);
  const y = box.y + box.height / 2;
  const x0 = box.x + 3;
  const x1 = box.x + 2 + fraction * (box.width - 4);
  await page.mouse.move(x0, y, { steps: 20 });
  await page.mouse.down();
  const steps = 28;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(x0 + ((x1 - x0) * i) / steps, y);
    await page.waitForTimeout(ms / steps);
  }
  await page.mouse.up();
};

await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: WIDTH, maxHeight: HEIGHT, everyNthFrame: 1 });
const t0 = Date.now();
const until = async (seconds) => {
  const remaining = seconds * 1000 - (Date.now() - t0);
  if (remaining > 0) await page.waitForTimeout(remaining);
};

// 0-6 s: boot into the workbench; the hot flame burns and radiatively extinguishes.
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="eclss"]');
await caption("ISS Destiny, Combustion Integrated Rack: a 3.9 mm n-heptane droplet burns in microgravity");
await until(3.9);
await caption("The flame radiates its heat away. The optical camera now shows an extinguished fire");
await until(6.2);

// 6-11.5 s: sensor toggle reveals the cool flame, then hides it again.
await click('[data-testid="sensor-mode"] [data-value="uv"]');
await caption("UV OH* sensor: an invisible cool flame near 700 K is still burning fuel");
await until(9.6);
await click('[data-testid="sensor-mode"] [data-value="optical"]');
await caption("Back to the optical camera: nothing to see. Crew would clear the alarm");
await until(11.6);

// 11.5-18.5 s: ventilation slider triggers second-stage hot re-ignition.
await caption("What-if: cabin fans restart at 8 cm/s after visible flame-out");
await dragSlider('[data-testid="slider-airflow"]', 8 / 20, 1300);
await page.waitForTimeout(350);
await click('[data-testid="timeline"] ~ div [data-value="1"]').catch(() => undefined);
await seek(9.6);
await until(15.4);
await caption("Fresh oxidizer drives the cool flame through ignition: the hot flame returns");
await until(18.6);

// 18.5-24.5 s: risk leaderboard and knowledge frontier.
await click('[data-testid="nav-analytics"]');
await caption("SI risk leaderboard: cabin materials ranked across ISS and Artemis atmospheres");
await until(20.6);
await click('[data-testid="risk-filter"] [data-value="ARTEMIS"]');
await until(22.4);
const frontier = await center('[data-testid="frontier-map"]');
await page.mouse.move(frontier.x, frontier.y, { steps: 26 });
await caption("Knowledge frontier: droplet flights never exceeded 3 cm/s. This case is beyond the data");
await until(24.8);

// 24.5-29.4 s: PSI citation inspector.
await click('[data-testid="nav-workbench"]');
const inspector = await center('[data-testid="citation-inspector"]');
await page.mouse.move(inspector.x, inspector.y - 40, { steps: 26 });
await caption("PSI citation inspector: reference experiment, flown envelope, and a clear model-output label");
await until(27.6);
await click('[data-testid="sensor-mode"] [data-value="uv"]');
await caption("IGNIS-SI: see the invisible flame, predict the backfire, state what was never tested");
await until(DURATION_S);

await cdp.send("Page.stopScreencast");
await writes;
await browser.close();

if (frames.length < 60) throw new Error(`Only ${frames.length} frames captured; is the application running?`);

const start = frames[0].ts;
const lines = ["ffconcat version 1.0"];
for (let i = 0; i < frames.length; i++) {
  const next = i + 1 < frames.length ? frames[i + 1].ts : frames[i].ts + 1 / OUTPUT_FPS;
  lines.push(`file 'frames/${frames[i].file}'`, `duration ${Math.max(next - frames[i].ts, 0.001).toFixed(5)}`);
}
lines.push(`file 'frames/${frames[frames.length - 1].file}'`);
writeFileSync(resolve(WORK, "frames.ffconcat"), lines.join("\n"));

const captured = frames[frames.length - 1].ts - start;
execFileSync(
  ffmpegPath,
  [
    "-y", "-loglevel", "error",
    "-f", "concat", "-safe", "0", "-i", "frames.ffconcat",
    "-t", String(Math.min(captured, MAX_DURATION_S - 0.25)),
    "-vf", `fps=${OUTPUT_FPS},scale=${WIDTH}:${HEIGHT}:flags=lanczos,format=yuv420p`,
    "-c:v", "libx264", "-preset", "slow", "-crf", "15", "-profile:v", "high",
    "-movflags", "+faststart", "-an",
    OUTPUT,
  ],
  { cwd: WORK, stdio: "inherit" },
);

const probe = JSON.parse(
  execFileSync(ffprobe.path, [
    "-v", "error", "-select_streams", "v:0",
    "-show_entries", "stream=width,height,avg_frame_rate,codec_name:format=duration,size",
    "-of", "json", OUTPUT,
  ]).toString(),
);
const duration = Number(probe.format.duration);

for (const t of [2.0, 5.2, 8.5, 10.8, 16.8, 21.8, 24.2, 28.6]) {
  execFileSync(ffmpegPath, [
    "-y", "-loglevel", "error", "-ss", String(t), "-i", OUTPUT, "-frames:v", "1",
    resolve(VERIFY, `t${t.toFixed(1).padStart(4, "0")}.png`),
  ]);
}

const report = {
  output: OUTPUT,
  duration_s: duration,
  within_limit: duration <= MAX_DURATION_S,
  stream: probe.streams[0],
  size_mb: Number((Number(probe.format.size) / 1e6).toFixed(2)),
  source_frames: frames.length,
  source_fps: Number((frames.length / captured).toFixed(1)),
  verification_frames: VERIFY,
};
console.log(JSON.stringify(report, null, 2));
if (!report.within_limit) {
  console.error(`Video is ${duration.toFixed(2)} s; limit is ${MAX_DURATION_S} s.`);
  process.exit(1);
}
