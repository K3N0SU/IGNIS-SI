# Handoff

State of the repository as of 2026-11-15, for whoever picks it up next.

## What exists and has been run

| Item | Status | Evidence |
|---|---|---|
| Physics engine (`backend/physics/`) | Complete | 76 pytest cases pass; `scripts/calibration_report.py` |
| Experiment corpus (`backend/data/nasa_psi_corpus.py`) | Complete as metadata | Structure tested; values are literature summaries, see below |
| Classifier, risk ranker, uncertainty detector (`backend/ml/`) | Complete | 99.6 % held-out accuracy on simulated traces |
| FastAPI service (`backend/app/`) | Complete | 13 endpoint checks pass directly and through the frontend proxy |
| Next.js workbench and analytics (`frontend/`) | Complete | `tsc --noEmit` and `next build` clean; reviewed in Chrome at 1920×1080 and 1440×900 |
| `start.sh`, `start.bat` | Complete | Both run end to end with `--verify` on Windows 11 (Git Bash and cmd) |
| `demo_30s.mp4` | Recorded | 1920×1080, 60 fps, H.264, under 30 s; frames inspected for each required beat |

Not run: `start.sh` on macOS or Linux, any browser other than Chrome, and any comparison against real PSI telemetry.

## How to run

`./start.sh` or `start.bat`. See the README for URLs and options. Generated artifacts (`backend/ml/artifacts/`, `backend/data/generated/`) are git-ignored and rebuilt by the start script in about 15 seconds; the API also builds them on first start if they are missing.

## Things that are not obvious

- **Telemetry is simulated.** Nothing in the repository is flight data. If you obtain PSI files, the natural integration point is a loader beside `nasa_psi_corpus.py` plus a calibration fit that replaces the hand-tuned constants in `ModelCalibration`.
- **Calibration is coupled.** `kappa_planck`, `tau_chem_hot` and `activation_temp_hot` together set the radiative-extinction diameter, the blowoff velocity and the burnout diameter. Changing one moves all three. Rerun `scripts/calibration_report.py` and the `TestExtinction` cases after any change.
- **Regime labels drive the classifier.** `RADIATIVE_EXTINCTION` is the 1.2 s transient after a radiative `Da = 1` crossing. An earlier definition based on `Da < 3` before the crossing was not separable from the sensor channels and dropped accuracy to 89 %.
- **Feature schema is checked at load.** If `FEATURE_NAMES` or `LABELS` change, the stored model is rejected and retrained automatically.
- **The playback clock is outside React** (`frontend/src/lib/playback.ts`). The 3D twin and chart cursors read it in their own animation frames; only components that call `usePlayback()` re-render, at the sample rate.
- **Airflow default.** The workbench starts in "fans restart after flame-out" mode with 0 cm/s, which is identical to still air. Raising the airflow slider alone produces the re-ignition scenario.
- **Windows file locks.** A running `next start` locks files in `node_modules`; both start scripts free ports 3000 and 8000 before installing.

## Known limitations

- The cool-flame temperature and re-ignition criterion are algebraic closures, not detailed low-temperature chemistry.
- The aerosol kernel uses the continuum form with slip correction; it is less accurate for primaries well below 30 nm.
- The risk ranker uses handbook constants and a single microgravity shift of the oxygen limit for all materials.
- The workbench is designed for 1920×1080. At 1440×900 the ECLSS and citation panels scroll internally.
- Bibliographic entries have no DOIs and were not checked against publisher records.

## Suggested next steps

1. Fit `ModelCalibration` to digitised FLEX `D²(t)` histories and report residuals in the citation inspector.
2. Replace the cool-flame closure with a two-step reduced mechanism and compare extinction diameters across pressure.
3. Add a solid-fuel flame-spread model so BASS-II and Saffire conditions can be simulated, not only cited.
4. Expose the calibration-ensemble spread as bands on the telemetry charts.
