// Record the 30-second demonstration film of the running application.
//
// Picture: frames are pulled from the Chromium compositor through the DevTools
// screencast API with their presentation timestamps and encoded at a constant
// 60 fps. Camera moves, the pointer, captions and title cards are drawn in the
// page by this script; none of them are part of the application.
// Sound: the ambient score synthesised by make_score.py.
//
// One edit is made for time: the assistant's answer is requested from the
// real service before recording starts and replayed at the moment the
// question is asked, because a live answer takes 8 to 16 seconds.
//
// Requires the frontend on :3000 and the backend on :8000.
// Usage: node record_demo.mjs            -> ../demo_30s.mp4

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
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
const SCORE = resolve(WORK, "score.wav");
const SILENT = resolve(WORK, "demo_silent.mp4");
const WIDTH = 1920;
const HEIGHT = 1080;
const DURATION_S = 29.6;
const OUTPUT_FPS = 60;
const MAX_DURATION_S = 30.0;

const QUESTION = "Has NASA actually tested this, or is it a model prediction?";
const BACKFIRE = {
  fuel: "n-heptane", d0_mm: 3.9, x_o2: 0.21, pressure_atm: 1.0, airflow_cm_s: 8, flow_mode: "RESTORE_AFTER_EXTINCTION",
  restore_delay_s: 6, diluent: "N2", t_max_s: 60, dt_s: 0.1,
};

rmSync(FRAMES, { recursive: true, force: true });
mkdirSync(FRAMES, { recursive: true });
mkdirSync(VERIFY, { recursive: true });

if (!existsSync(SCORE)) {
  throw new Error("Score not found. Run `python scripts/make_score.py` first.");
}

let assistantReply = null;
try {
  const res = await fetch(`${BASE}/api/assistant`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: QUESTION }], query: BACKFIRE, sensor_view: "optical", playback_time_s: 14 }),
  });
  if (res.ok) assistantReply = await res.json();
} catch {
  assistantReply = null;
}
if (!assistantReply) console.warn("Assistant unavailable; the film will skip the assistant beat.");

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

if (assistantReply) {
  await page.route("**/api/assistant", async (route) => {
    await new Promise((r) => setTimeout(r, 1100));
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(assistantReply) });
  });
}

await page.addInitScript(() => {
  const FONT = "'Inter Variable', system-ui, sans-serif";
  window.addEventListener("DOMContentLoaded", () => {
    const style = document.createElement("style");
    style.textContent = `
      #film-card { position: fixed; inset: 0; z-index: 100000; background: #090A0D; display: flex; flex-direction: column;
        align-items: center; justify-content: center; gap: 18px; opacity: 1; transition: opacity 700ms ease; pointer-events: none; }
      #film-card .mark { display: flex; align-items: center; gap: 18px; }
      #film-card .ring { width: 46px; height: 46px; border: 3px solid #3B82F6; border-radius: 50%; display: flex; align-items: center; justify-content: center; }
      #film-card .ring i { width: 14px; height: 14px; background: #F3F4F6; border-radius: 50%; display: block; }
      #film-card h1 { font: 600 58px ${FONT}; letter-spacing: 0.14em; color: #F3F4F6; margin: 0; }
      #film-card p { font: 400 24px ${FONT}; color: #8B949E; margin: 0; max-width: 1100px; text-align: center; line-height: 1.45; }
      #film-card p b { color: #F3F4F6; font-weight: 500; }
      #film-caption { position: fixed; z-index: 99998; left: 50%; bottom: 46px; transform: translate(-50%, 10px); max-width: 1180px;
        padding: 14px 24px 15px; background: #111318; border: 1px solid #2A303B; border-radius: 6px; text-align: center;
        opacity: 0; transition: opacity 320ms ease, transform 320ms ease; pointer-events: none; }
      #film-caption.on { opacity: 1; transform: translate(-50%, 0); }
      #film-caption .k { font: 600 12px ${FONT}; letter-spacing: 0.12em; text-transform: uppercase; color: #8B949E; margin-bottom: 5px; }
      #film-caption .t { font: 500 25px ${FONT}; color: #F3F4F6; line-height: 1.3; }
      #film-pointer { position: fixed; z-index: 99999; left: -60px; top: -60px; width: 30px; height: 30px; pointer-events: none;
        filter: drop-shadow(0 2px 3px rgba(0,0,0,0.6)); }
      #film-ripple { position: fixed; z-index: 99997; width: 46px; height: 46px; margin: -23px 0 0 -23px; border: 2px solid #F3F4F6;
        border-radius: 50%; opacity: 0; pointer-events: none; }
      #film-ripple.go { animation: film-ripple 520ms ease-out; }
      @keyframes film-ripple { from { opacity: 0.9; transform: scale(0.25); } to { opacity: 0; transform: scale(1.15); } }
      .film-stage { transition: transform 1100ms cubic-bezier(0.65, 0, 0.35, 1); will-change: transform; }
    `;
    document.head.appendChild(style);

    const card = document.createElement("div");
    card.id = "film-card";
    document.body.appendChild(card);
    window.filmCard = (html, visible) => {
      if (html !== null) card.innerHTML = html;
      card.style.opacity = visible ? "1" : "0";
    };

    const caption = document.createElement("div");
    caption.id = "film-caption";
    caption.innerHTML = '<div class="k"></div><div class="t"></div>';
    document.body.appendChild(caption);
    window.filmCaption = (kicker, text) => {
      if (!text) {
        caption.classList.remove("on");
        return;
      }
      caption.classList.remove("on");
      setTimeout(() => {
        caption.querySelector(".k").textContent = kicker;
        caption.querySelector(".t").textContent = text;
        caption.classList.add("on");
      }, 180);
    };

    const pointer = document.createElement("div");
    pointer.id = "film-pointer";
    pointer.innerHTML =
      '<svg viewBox="0 0 24 24" width="30" height="30"><path d="M4 2.5 L4 19 L8.6 14.9 L11.6 21.6 L14.4 20.3 L11.4 13.7 L17.6 13.7 Z" fill="#F3F4F6" stroke="#090A0D" stroke-width="1.3" stroke-linejoin="round"/></svg>';
    document.body.appendChild(pointer);
    const ripple = document.createElement("div");
    ripple.id = "film-ripple";
    document.body.appendChild(ripple);
    window.addEventListener("mousemove", (e) => {
      pointer.style.left = `${e.clientX - 5}px`;
      pointer.style.top = `${e.clientY - 3}px`;
    }, true);
    window.addEventListener("mousedown", (e) => {
      ripple.style.left = `${e.clientX}px`;
      ripple.style.top = `${e.clientY}px`;
      ripple.classList.remove("go");
      void ripple.offsetWidth;
      ripple.classList.add("go");
    }, true);

    window.filmZoom = (selector, scale, anchor) => {
      const bar = document.querySelector("header");
      const stage = bar ? bar.closest("body > *") : null;
      if (!stage) return;
      stage.classList.add("film-stage");
      if (!selector) {
        stage.style.transform = "none";
        return;
      }
      const prior = stage.style.transform;
      stage.style.transform = "none";
      const r = document.querySelector(selector).getBoundingClientRect();
      stage.style.transform = prior;
      void stage.offsetWidth;
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const tx = Math.min(Math.max(window.innerWidth / 2 - cx * scale, window.innerWidth * (1 - scale)), 0);
      // "top" keeps the element's top edge where it is, so its header stays on screen.
      const wantY = anchor === "top" ? r.top * (1 - scale) : window.innerHeight / 2 - cy * scale;
      const ty = Math.min(Math.max(wantY, window.innerHeight * (1 - scale)), 0);
      stage.style.transformOrigin = "0 0";
      stage.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
    };
  });
});

const MARK = '<div class="mark"><div class="ring"><i></i></div><h1>IGNIS-SI</h1></div>';
const card = (html, visible) => page.evaluate(([h, v]) => window.filmCard(h, v), [html, visible]);
const caption = (kicker, text) => page.evaluate(([k, t]) => window.filmCaption(k, t), [kicker, text]);
const TWIN = 'section[aria-label="Combustion chamber"]';
const ZOOM_SETTLE_MS = 1150;
const zoom = (selector, scale, anchor = "center") =>
  page.evaluate(([s, z, a]) => window.filmZoom(s, z, a), [selector, scale, anchor]);
// Element positions are only valid once the camera move has finished.
const zoomOut = async () => {
  await zoom(null, 1);
  await page.waitForTimeout(ZOOM_SETTLE_MS);
};

const cdp = await context.newCDPSession(page);
const frames = [];
let acks = Promise.resolve();
cdp.on("Page.screencastFrame", (event) => {
  const index = frames.length;
  frames.push({ file: `f${String(index).padStart(5, "0")}.jpg`, ts: event.metadata.timestamp });
  writeFileSync(resolve(FRAMES, frames[index].file), Buffer.from(event.data, "base64"));
  acks = acks.then(() => cdp.send("Page.screencastFrameAck", { sessionId: event.sessionId }).catch(() => undefined));
});

const box = async (selector) => {
  const b = await page.locator(selector).first().boundingBox();
  if (!b) throw new Error(`Element not found: ${selector}`);
  return b;
};
const glide = async (x, y, steps = 34) => page.mouse.move(x, y, { steps });
const click = async (selector) => {
  const b = await box(selector);
  await glide(b.x + b.width / 2, b.y + b.height / 2);
  await page.waitForTimeout(140);
  await page.mouse.down();
  await page.waitForTimeout(60);
  await page.mouse.up();
};
const seek = async (simTime) => {
  const b = await box('[data-testid="timeline"]');
  const total = Number(await page.getAttribute('[data-testid="timeline"]', "data-duration"));
  await glide(b.x + (simTime / total) * b.width, b.y + b.height / 2, 26);
  await page.mouse.down();
  await page.mouse.up();
};
const dragSlider = async (selector, fraction, ms) => {
  const b = await box(selector);
  const y = b.y + b.height / 2;
  const x0 = b.x + 8;
  const x1 = b.x + 8 + fraction * (b.width - 16);
  await glide(x0, y, 30);
  await page.mouse.down();
  const steps = 36;
  for (let i = 1; i <= steps; i++) {
    const ease = 0.5 - 0.5 * Math.cos((Math.PI * i) / steps);
    await page.mouse.move(x0 + (x1 - x0) * ease, y);
    await page.waitForTimeout(ms / steps);
  }
  await page.mouse.up();
};

await cdp.send("Page.startScreencast", { format: "jpeg", quality: 93, maxWidth: WIDTH, maxHeight: HEIGHT, everyNthFrame: 1 });
const t0 = Date.now();
const until = async (seconds) => {
  const remaining = seconds * 1000 - (Date.now() - t0);
  if (remaining > 0) await page.waitForTimeout(remaining);
};

// Title card while the workbench loads underneath.
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await card(`${MARK}<p>Fire behaves differently in orbit.<br><b>Some of it you cannot see.</b></p>`, true);
await page.waitForSelector('[data-testid="eclss"]');
await page.mouse.move(980, 620);
await until(2.1);
// Rewind under the title card so the hot flame is on screen when it lifts.
await seek(0.5);
await page.mouse.move(980, 620);
await until(2.3);
await card(null, false);
await caption("International Space Station", "A fuel droplet burns in microgravity. With no buoyancy, the flame is a sphere.");
await until(5.3);

// The visible flame goes out.
await zoom(TWIN, 1.26, "top");
await caption("Optical camera", "The flame radiates its heat away and goes out. The camera sees nothing.");
await until(8.5);

// The UV channel reveals the cool flame.
await click('[data-testid="sensor-mode"] [data-value="uv"]');
await caption("UV sensor", "But it is still burning: an invisible cool flame near 700 K.");
await until(11.6);

// Ventilation restart and re-ignition.
await zoomOut();
await click('[data-testid="sensor-mode"] [data-value="optical"]');
await caption("What if", "The crew sees no flame and switches the cabin fans back on.");
await dragSlider('[data-testid="slider-airflow"]', 8 / 20, 1100);
await page.waitForTimeout(350);
await page.locator('button[data-value="1"]').last().click().catch(() => undefined);
await seek(12.1);
await zoom(TWIN, 1.2, "top");
await until(15.6);
await caption("Re-ignition", "Fresh air feeds the cool flame. The fire comes back.");
await until(17.4);

// The assistant answers from flight data.
await zoomOut();
if (assistantReply) {
  await click('[data-testid="assistant-launch"]');
  await caption("Assistant", "Ask it anything. It runs the model and checks NASA flight records.");
  await page.waitForSelector('[data-testid="assistant-panel"]');
  await click(`[data-testid="assistant-panel"] button:has-text("${QUESTION.slice(0, 24)}")`);
  await page.waitForSelector('[data-testid="assistant-reply"]', { timeout: 6000 }).catch(() => undefined);
  await until(21.4);
  await click('[data-testid="assistant-launch"]');
} else {
  await until(21.4);
}

// Real flight data.
await click('[data-testid="nav-flight"]');
await caption("Flight data", "Calibrated and checked against 261 real droplet burns from NASA's ISS experiments.");
await page.waitForSelector('[data-testid="flight-matrix"] circle', { timeout: 8000 }).catch(() => undefined);
const matrix = await box('[data-testid="flight-matrix"]');
await glide(matrix.x + matrix.width * 0.72, matrix.y + matrix.height * 0.42, 40);
await until(24.9);

// Material risk across atmospheres.
await click('[data-testid="nav-analytics"]');
await caption("Artemis", "At 34 % oxygen, materials that are safe on the ISS start to burn.");
await page.waitForSelector('[data-testid="risk-table"] tbody tr', { timeout: 8000 }).catch(() => undefined);
await click('[data-testid="risk-filter"] [data-value="ARTEMIS"]');
await until(27.3);

// End card.
await caption("", "");
await card(`${MARK}<p><b>See the invisible flame. Predict the backfire.</b><br>Know what has never been tested.</p>`, true);
await until(DURATION_S);

await cdp.send("Page.stopScreencast");
await acks;
await browser.close();

if (frames.length < 120) throw new Error(`Only ${frames.length} frames captured; is the application running?`);

const lines = ["ffconcat version 1.0"];
for (let i = 0; i < frames.length; i++) {
  const next = i + 1 < frames.length ? frames[i + 1].ts : frames[i].ts + 1 / OUTPUT_FPS;
  lines.push(`file 'frames/${frames[i].file}'`, `duration ${Math.max(next - frames[i].ts, 0.001).toFixed(5)}`);
}
lines.push(`file 'frames/${frames[frames.length - 1].file}'`);
writeFileSync(resolve(WORK, "frames.ffconcat"), lines.join("\n"));

const captured = frames[frames.length - 1].ts - frames[0].ts;
const length = Math.min(captured, MAX_DURATION_S - 0.2);
const fadeOut = (length - 0.5).toFixed(2);

execFileSync(
  ffmpegPath,
  [
    "-y", "-loglevel", "error",
    "-f", "concat", "-safe", "0", "-i", "frames.ffconcat",
    "-t", String(length),
    "-vf", `fps=${OUTPUT_FPS},scale=${WIDTH}:${HEIGHT}:flags=lanczos,fade=t=in:st=0:d=0.5,fade=t=out:st=${fadeOut}:d=0.5,format=yuv420p`,
    "-c:v", "libx264", "-preset", "medium", "-threads", "8", "-crf", "15", "-profile:v", "high", "-an",
    SILENT,
  ],
  { cwd: WORK, stdio: "inherit" },
);
execFileSync(
  ffmpegPath,
  [
    "-y", "-loglevel", "error",
    "-i", SILENT, "-i", SCORE,
    "-filter_complex", `[1:a]atrim=0:${length},afade=t=in:st=0:d=1.2,afade=t=out:st=${(length - 2.2).toFixed(2)}:d=2.2,volume=0.9[a]`,
    "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
    "-t", String(length), "-movflags", "+faststart",
    OUTPUT,
  ],
  { stdio: "inherit" },
);

const probe = JSON.parse(
  execFileSync(ffprobe.path, [
    "-v", "error", "-show_entries", "stream=codec_type,codec_name,width,height,avg_frame_rate,sample_rate,channels:format=duration,size",
    "-of", "json", OUTPUT,
  ]).toString(),
);
const duration = Number(probe.format.duration);

for (const t of [1.0, 4.4, 7.6, 10.6, 16.6, 20.4, 23.8, 26.6, 28.9]) {
  execFileSync(ffmpegPath, [
    "-y", "-loglevel", "error", "-ss", String(t), "-i", OUTPUT, "-frames:v", "1",
    resolve(VERIFY, `t${t.toFixed(1).padStart(4, "0")}.png`),
  ]);
}

const report = {
  output: OUTPUT,
  duration_s: duration,
  within_limit: duration <= MAX_DURATION_S,
  streams: probe.streams,
  size_mb: Number((Number(probe.format.size) / 1e6).toFixed(2)),
  source_frames: frames.length,
  source_fps: Number((frames.length / captured).toFixed(1)),
  assistant_beat: Boolean(assistantReply),
  verification_frames: VERIFY,
};
console.log(JSON.stringify(report, null, 2));
if (!report.within_limit) {
  console.error(`Film is ${duration.toFixed(2)} s; limit is ${MAX_DURATION_S} s.`);
  process.exit(1);
}
