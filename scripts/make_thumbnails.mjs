// Build 1280x720 video thumbnails from frames of the recorded films.
//
// Expects three full-resolution frames in .capture/thumb (see the README):
//   f_90.png   optical camera, flame not visible
//   f_98.png   UV sensor, cool flame visible
//   f_128.png  optical camera, hot flame after re-ignition
// Usage: node make_thumbnails.mjs      -> ../thumbnail_30s.png, ../thumbnail_5min.png

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { launch } from "./film_kit.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const data = (path, type) => `data:${type};base64,${readFileSync(path).toString("base64")}`;
const frame = (name) => data(resolve(here, ".capture", "thumb", name), "image/png");
const font = data(
  resolve(here, "..", "frontend", "node_modules", "@fontsource-variable", "inter", "files", "inter-latin-wght-normal.woff2"),
  "font/woff2",
);

// Each crop is the region of a 1920x1080 frame to show: the chamber, without the caption strip.
const crop = (src, x, y, w, h) =>
  `background-image:url(${src});background-size:${(1920 / w) * 100}% ${(1080 / h) * 100}%;` +
  `background-position:${(x / (1920 - w)) * 100}% ${(y / (1080 - h)) * 100}%;background-repeat:no-repeat;`;

const base = `
  @font-face { font-family: Inter; src: url(${font}) format("woff2"); font-weight: 100 900; }
  * { box-sizing: border-box; margin: 0; }
  body { width: 1280px; height: 720px; background: #090A0D; color: #F3F4F6; font-family: Inter, sans-serif; overflow: hidden; position: relative; }
  .label { position: absolute; font-weight: 700; font-size: 26px; letter-spacing: 0.1em; padding: 8px 14px; background: #090A0D; border: 2px solid; border-radius: 6px; }
  .brand { position: absolute; left: 44px; bottom: 36px; font-weight: 600; font-size: 30px; letter-spacing: 0.16em; display: flex; align-items: center; gap: 14px; }
  .ring { width: 30px; height: 30px; border: 3px solid #3B82F6; border-radius: 50%; display: flex; align-items: center; justify-content: center; }
  .ring i { width: 10px; height: 10px; background: #F3F4F6; border-radius: 50%; }
`;

const short = `<!doctype html><html><head><style>${base}
  .half { position: absolute; top: 0; width: 640px; height: 720px; }
  .divider { position: absolute; left: 638px; top: 150px; width: 4px; height: 570px; background: #F3F4F6; }
  h1 { position: absolute; left: 0; right: 0; top: 34px; text-align: center; font-weight: 800; font-size: 78px; letter-spacing: -0.01em; text-shadow: 0 2px 0 #090A0D, 0 0 24px #090A0D; }
</style></head><body>
  <div class="half" style="left:0;${crop(frame("f_90.png"), 640, 180, 640, 720)}"></div>
  <div class="half" style="left:640px;${crop(frame("f_98.png"), 640, 180, 640, 720)}"></div>
  <div class="divider"></div>
  <h1>THE FIRE YOU CAN'T SEE</h1>
  <div class="label" style="left:44px;top:170px;color:#8B949E;border-color:#8B949E">CAMERA: NOTHING</div>
  <div class="label" style="right:44px;top:170px;color:#3B82F6;border-color:#3B82F6">UV: STILL BURNING</div>
  <div class="brand"><span class="ring"><i></i></span>IGNIS-SI</div>
</body></html>`;

const long = `<!doctype html><html><head><style>${base}
  .shot { position: absolute; right: 0; top: 0; width: 720px; height: 720px; }
  .text { position: absolute; left: 44px; top: 70px; width: 560px; }
  h1 { font-weight: 800; font-size: 92px; line-height: 0.98; letter-spacing: -0.02em; }
  p { margin-top: 26px; font-weight: 500; font-size: 34px; line-height: 1.25; color: #8B949E; }
  p b { color: #F3F4F6; font-weight: 600; }
  .label { left: 44px; top: 470px; color: #F59E0B; border-color: #F59E0B; }
</style></head><body>
  <div class="shot" style="${crop(frame("f_128.png"), 600, 160, 720, 720)}"></div>
  <div class="text"><h1>FIRE IN<br>ORBIT</h1><p>Built on <b>261 real NASA</b><br>space station tests</p></div>
  <div class="label">FULL WALKTHROUGH</div>
  <div class="brand"><span class="ring"><i></i></span>IGNIS-SI</div>
</body></html>`;

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
for (const [html, name] of [[short, "thumbnail_30s.png"], [long, "thumbnail_5min.png"]]) {
  await page.setContent(html, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: resolve(here, "..", name) });
  console.log(name);
}
await browser.close();
