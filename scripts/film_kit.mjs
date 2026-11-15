// Shared tooling for recording films of the running application.
//
// Picture comes from the Chromium compositor through the DevTools screencast
// API. The pointer, captions, title cards and camera moves are drawn in the
// page by this module; none of them are part of the application.

import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import ffmpegPath from "ffmpeg-static";
import ffprobe from "ffprobe-static";
import { chromium } from "playwright-core";

export const WIDTH = 1920;
export const HEIGHT = 1080;
export const ZOOM_SETTLE_MS = 1150;
export const MARK = '<div class="mark"><div class="ring"><i></i></div><h1>IGNIS-SI</h1></div>';
export const panel = (title) => `section[aria-label="${title}"]`;

export async function launch() {
  for (const channel of ["chrome", "msedge", undefined]) {
    try {
      return await chromium.launch({ channel, headless: true, args: ["--enable-gpu", "--ignore-gpu-blocklist"] });
    } catch {
      continue;
    }
  }
  throw new Error("No Chromium-based browser found. Install Chrome or Edge, or run `npx playwright install chromium`.");
}

function overlayScript() {
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
      #film-caption { position: fixed; z-index: 99998; left: 50%; bottom: 46px; transform: translate(-50%, 10px); max-width: 1240px;
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
      caption.classList.remove("on");
      if (!text) return;
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
      const priorTransition = stage.style.transition;
      stage.style.transition = "none";
      stage.style.transform = "none";
      const target = document.querySelector(selector);
      const r = target ? target.getBoundingClientRect() : null;
      stage.style.transform = prior;
      void stage.offsetWidth;
      stage.style.transition = priorTransition;
      if (!r) return;
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
}

/** Opens a page with the film overlay and returns the controls a scene script needs. */
export async function openStage(browser, { framesDir, everyNthFrame = 1, quality = 93 }) {
  rmSync(framesDir, { recursive: true, force: true });
  mkdirSync(framesDir, { recursive: true });
  const context = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.addInitScript(overlayScript);

  const cdp = await context.newCDPSession(page);
  const frames = [];
  let acks = Promise.resolve();
  cdp.on("Page.screencastFrame", (event) => {
    const index = frames.length;
    frames.push({ file: `f${String(index).padStart(6, "0")}.jpg`, ts: event.metadata.timestamp });
    writeFileSync(resolve(framesDir, frames[index].file), Buffer.from(event.data, "base64"));
    acks = acks.then(() => cdp.send("Page.screencastFrameAck", { sessionId: event.sessionId }).catch(() => undefined));
  });

  let t0 = 0;
  const box = async (selector) => {
    const b = await page.locator(selector).first().boundingBox();
    if (!b) throw new Error(`Element not found: ${selector}`);
    return b;
  };
  const glide = (x, y, steps = 34) => page.mouse.move(x, y, { steps });
  const stage = {
    page,
    frames,
    card: (html, visible) => page.evaluate(([h, v]) => window.filmCard(h, v), [html, visible]),
    caption: (kicker, text) => page.evaluate(([k, t]) => window.filmCaption(k, t), [kicker, text]),
    zoom: (selector, scale, anchor = "center") =>
      page.evaluate(([s, z, a]) => window.filmZoom(s, z, a), [selector, scale, anchor]),
    // Element positions are only valid once the camera move has finished.
    zoomOut: async () => {
      await page.evaluate(() => window.filmZoom(null, 1));
      await page.waitForTimeout(ZOOM_SETTLE_MS);
    },
    box,
    glide,
    hover: async (selector, fx = 0.5, fy = 0.5) => {
      const b = await box(selector);
      await glide(b.x + b.width * fx, b.y + b.height * fy, 40);
    },
    click: async (selector) => {
      const b = await box(selector);
      await glide(b.x + b.width / 2, b.y + b.height / 2);
      await page.waitForTimeout(140);
      await page.mouse.down();
      await page.waitForTimeout(60);
      await page.mouse.up();
    },
    seek: async (simTime) => {
      const b = await box('[data-testid="timeline"]');
      const total = Number(await page.getAttribute('[data-testid="timeline"]', "data-duration"));
      await glide(b.x + Math.min(simTime / total, 0.995) * b.width, b.y + b.height / 2, 26);
      await page.mouse.down();
      await page.mouse.up();
    },
    speed: (value) => page.locator(`button[data-value="${value}"]`).last().click().catch(() => undefined),
    // Playback stops by itself at the end of a burn, so set the state explicitly
    // instead of toggling. Uses the keyboard so the pointer does not jump.
    setPlaying: async (want) => {
      const label = await page.getAttribute('[data-testid="play-toggle"]', "aria-label");
      const playing = label !== "Play";
      if (playing !== want) await page.locator('[data-testid="play-toggle"]').dispatchEvent("click");
    },
    dragSlider: async (selector, fraction, ms) => {
      const b = await box(selector);
      const y = b.y + b.height / 2;
      const current = await page.locator(selector).first().evaluate((el) => (Number(el.value) - Number(el.min)) / (Number(el.max) - Number(el.min)));
      const x0 = b.x + 8 + current * (b.width - 16);
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
    },
    start: async () => {
      await cdp.send("Page.startScreencast", { format: "jpeg", quality, maxWidth: WIDTH, maxHeight: HEIGHT, everyNthFrame });
      t0 = Date.now();
    },
    until: async (seconds) => {
      const remaining = seconds * 1000 - (Date.now() - t0);
      if (remaining > 0) await page.waitForTimeout(remaining);
    },
    stop: async () => {
      await cdp.send("Page.stopScreencast");
      await acks;
    },
  };
  return stage;
}

/** Encodes captured frames with the score into an H.264/AAC file and returns a probe report. */
export function encode({ frames, workDir, framesName, score, output, fps, maxDuration, crf = 16 }) {
  if (frames.length < 120) throw new Error(`Only ${frames.length} frames captured; is the application running?`);
  const lines = ["ffconcat version 1.0"];
  for (let i = 0; i < frames.length; i++) {
    const next = i + 1 < frames.length ? frames[i + 1].ts : frames[i].ts + 1 / fps;
    lines.push(`file '${framesName}/${frames[i].file}'`, `duration ${Math.max(next - frames[i].ts, 0.001).toFixed(5)}`);
  }
  lines.push(`file '${framesName}/${frames[frames.length - 1].file}'`);
  const list = `${framesName}.ffconcat`;
  writeFileSync(resolve(workDir, list), lines.join("\n"));

  const captured = frames[frames.length - 1].ts - frames[0].ts;
  const length = Math.min(captured, maxDuration - 0.2);
  const silent = resolve(workDir, `${framesName}_silent.mp4`);
  execFileSync(
    ffmpegPath,
    [
      "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list, "-t", String(length),
      "-vf", `fps=${fps},scale=${WIDTH}:${HEIGHT}:flags=lanczos,fade=t=in:st=0:d=0.6,fade=t=out:st=${(length - 0.7).toFixed(2)}:d=0.7,format=yuv420p`,
      "-c:v", "libx264", "-preset", "medium", "-threads", "8", "-crf", String(crf), "-profile:v", "high", "-an", silent,
    ],
    { cwd: workDir, stdio: "inherit" },
  );
  execFileSync(
    ffmpegPath,
    [
      "-y", "-loglevel", "error", "-i", silent, "-i", score,
      "-filter_complex", `[1:a]atrim=0:${length},afade=t=in:st=0:d=1.5,afade=t=out:st=${(length - 3).toFixed(2)}:d=3,volume=0.9[a]`,
      "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-t", String(length), "-movflags", "+faststart", output,
    ],
    { stdio: "inherit" },
  );
  rmSync(silent, { force: true });

  const probe = JSON.parse(
    execFileSync(ffprobe.path, [
      "-v", "error", "-show_entries", "stream=codec_type,codec_name,width,height,avg_frame_rate:format=duration,size", "-of", "json", output,
    ]).toString(),
  );
  return {
    output,
    duration_s: Number(probe.format.duration),
    streams: probe.streams,
    size_mb: Number((Number(probe.format.size) / 1e6).toFixed(1)),
    source_frames: frames.length,
    source_fps: Number((frames.length / captured).toFixed(1)),
  };
}

export function stills(output, dir, times) {
  mkdirSync(dir, { recursive: true });
  for (const t of times) {
    execFileSync(ffmpegPath, [
      "-y", "-loglevel", "error", "-ss", String(t), "-i", output, "-frames:v", "1", "-vf", "scale=960:540",
      resolve(dir, `t${String(Math.round(t)).padStart(3, "0")}.png`),
    ]);
  }
}
