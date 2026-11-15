# Handoff

State of the repository as of 2026-11-15, for whoever picks it up next.

## What exists and has been run

| Item | Status | Evidence |
|---|---|---|
| NASA PSI flight tables (`backend/data/psi/`) | Downloaded from psi.nasa.gov, 11 investigations, 1,091 records | Checksums verified by a test on every run |
| Physics engine | Complete, calibrated to FLEX | 104 pytest cases pass |
| Calibration and validation | Fitted on 196 FLEX tests, scored on 65 held out | `backend/data/calibration_fit.json` |
| Classifier, risk ranker, uncertainty and nearest-test search | Complete | 98.5 % on held-out simulated burns |
| Assistant agent (Google Gemini) | Works end to end with a key | Live exchanges run in the browser; unit-tested with a stubbed provider |
| Frontend: Workbench, Analytics, Flight data, guided tour | Complete | `tsc` and `next build` clean; reviewed in Chrome at 1920x1080, 1440x900, 1366x768 |
| `start.sh`, `start.bat` | Both run end to end with `--verify` on Windows 11 on the final code and leave nothing running | 104 tests, build, all smoke checks |
| Browser and load tests (`scripts/e2e_test.mjs`, `scripts/soak_test.py`) | 18 UI checks passed on repeated runs; 1,200 concurrent requests with no failure and no restart | Run against the supervised API |
| `demo_30s.mp4` | 29.0 s, 1920x1080, 60 fps, H.264 with AAC audio | Frames inspected for every beat; the audio was not listened to |
| `demo_5min.mp4` | 4 min 58 s, 1920x1080, 30 fps, H.264 with AAC audio | Frames inspected in every chapter; the audio was not listened to |

Not run: macOS or Linux, any browser other than Chrome, mobile layouts, a screen reader.

## Things that are not obvious

- **Python 3.14 instability.** On this machine (Python 3.14.6, the only version installed) worker processes died intermittently during the parallel calibration with interpreter errors such as `Fatal Python error: _PyEval_EvalFrameDefault: Executing a cache`, and once a constants lookup returned the wrong type. The same fault later killed the API process while it served two requests at once. Three mitigations are in place: the solver's hot path does far fewer lookups, the API runs solver work from one thread at a time (`backend/app/serial.py`), and a supervisor restarts the API if it dies (`scripts/serve_backend.py`). After that, 1,200 concurrent requests ran with no failure and no restart. This looks like an interpreter fault, not a logic error, but it was not isolated. **For anything long-running, use Python 3.12 or 3.13.** Installing one needs an administrator prompt on this machine and was not done.
- **Calibration is loaded at import.** `physics/properties.py` reads `data/calibration_fit.json`. Delete that file to fall back to the hand-set baseline; rerun `python -m data.calibrate` to refit. The fit continues from the stored result when one exists.
- **Tests depend on the stored fit.** A refit can move thresholds in `tests/test_physics.py`; they are written against flight benchmarks with tolerances, so small moves pass.
- **Regime labels drive the classifier.** `RADIATIVE_EXTINCTION` is the 1.2 s transient after the flame is lost. A definition based on closeness to extinction before the event was not separable from the sensor channels.
- **Assistant model name.** `gemini-flash-latest` by default; override with `GEMINI_MODEL`. `gemini-2.5-flash` is retired for new keys.
- **Secrets.** `backend/.env` is git-ignored. Never commit it. `backend/.env.example` documents the variables.
- **The playback clock is outside React** (`frontend/src/lib/playback.ts`); the 3D view and chart cursors read it in their own animation frames.
- **Adding a view** is one entry in `frontend/src/lib/views.ts`, one page under `src/app/`, and one branch in `Shell.tsx`.
- **Stopping the API.** `python scripts/serve_backend.py --stop` stops the supervisor and the API together. Killing only the process on port 8000 makes the supervisor start a new one.
- **Film encoding.** `ffmpeg-static` crashed once with an access violation at `-preset slow` on the five-minute film; `film_kit.mjs` and `record_demo.mjs` now use `-preset medium -threads 8`.
- **Windows file locks.** A running `next start` locks files in `node_modules`; the start scripts free ports 3000 and 8000 before installing.

## Known limitations

- Burning-rate error on held-out flight tests is 18 %. Methanol near its flammability limit is the weakest area: the model declines to ignite 8 of 41 held-out methanol tests that burned on orbit.
- Cool-flame temperature and the re-ignition criterion are algebraic closures, and no flight data constrains re-ignition under flow.
- The chamber controls accept one diluent at a time; the solver itself handles N2/CO2/He blends, which is how FLEX tests are simulated.
- Saffire IV to VI tables were not found in PSI, so exploration-atmosphere flame spread is cited, not used.
- The material ranking uses handbook constants.

## Suggested next steps

1. Move to Python 3.12 or 3.13 and rerun the calibration to confirm the fit is reproducible.
2. Use the CFI table (PSI-39) to calibrate n-dodecane and helium dilution, which are currently uncalibrated.
3. Digitise `D²(t)` histories from the FLEX reports and fit the cool-flame branch, which is now tied only to two published values.
4. Add a solid-fuel flame-spread model so BASS-II and Saffire conditions can be simulated.
5. Show the calibration-ensemble spread as bands on the telemetry charts.
