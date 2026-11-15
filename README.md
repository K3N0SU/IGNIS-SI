# IGNIS-SI

**Microgravity spacecraft fire-safety workbench.** A physics solver, a sensor-fusion classifier and an ECLSS response generator behind a mission-control interface, built for the NASA Space Apps Challenge.

`demo_30s.mp4` in this directory is a 30-second capture of the running application.

## What it shows

Fire behaves differently without buoyancy. IGNIS-SI makes three consequences of that visible and quantitative.

1. **The hidden danger.** A large fuel droplet burning in microgravity loses its visible flame to radiative heat loss, yet keeps burning as a ~700 K *cool flame* that a colour camera cannot see. This was discovered on the ISS in the FLEX experiment. The workbench lets you switch between the optical camera (flame vanishes) and the UV channel (flame is still there), and a classifier identifies the cool flame from radiometer, UV and CO/O2 signals alone.
2. **The ventilation backfire.** Stopping cabin fans is the standard first response to a fire. If the crew restarts them because the flame *looks* out, a few cm/s of fresh oxidizer can push the cool flame back through its ignition threshold. The model predicts when this happens and the ECLSS panel turns that into a hold instruction with a critical airflow.
3. **The knowledge frontier.** ISS droplet experiments were run in still or near-still air. The ventilation-restart case lies outside anything flown. IGNIS-SI says so explicitly, per parameter, instead of presenting an extrapolation as fact.

A fourth view ranks cabin materials across the ISS, 10.2 psia and Artemis (34 % O2, 8.2 psia) atmospheres, and a fifth models how smoke particles grow in microgravity and what that does to smoke detectors.

## Quick start

Requirements: Python 3.11 or newer, Node.js 20 or newer. Chrome or Edge is needed only to re-record the video.

```bash
./start.sh            # macOS, Linux, Git Bash
start.bat             # Windows
```

The script installs dependencies, generates the training set, trains the classifier, runs the test suite, builds the frontend, launches both servers and smoke-tests every endpoint. Then open:

| | |
|---|---|
| Workbench | http://localhost:3000 |
| Analytics | http://localhost:3000/analytics |
| API docs | http://127.0.0.1:8000/docs |

`./start.sh --verify` (or `start.bat --verify`) runs the same checks and then stops the servers, for use before a push.

Press **Launch 90s Judge Walkthrough** in the top bar for a guided tour.

## Read this before trusting a number

**Every time series in this application is model output, not flight data.** The interface labels it that way in the telemetry header and in the citation inspector, and every API response carries `"source": "model"`.

- `backend/data/nasa_psi_corpus.py` holds experiment *metadata* for FLEX, FLEX-2, CFI, CFI-G, BASS-II, Saffire I-VI and SAME: hardware, fuels, tested ranges, findings and citations. Each range is flagged `published` or `approximate`. No PSI telemetry files are bundled or downloaded.
- The physics is a reduced-order model. Its closure constants (`ModelCalibration` in `backend/physics/properties.py`) were tuned so the model reproduces published behaviour: n-heptane burning-rate constants of 0.5-0.8 mm²/s, radiative extinction above roughly 3 mm initial diameter in air, a cool-flame burning rate near 0.36 mm²/s and a cool-flame extinction diameter near 1.2 mm. `scripts/calibration_report.py` prints the model across the calibration matrix.
- The cool-flame re-ignition threshold under forced flow is a model prediction. No orbital droplet experiment has tested it; that is the point the application makes, and it is also a reason to treat the predicted critical airflow as a hypothesis.
- The "UV OH*" channel is modelled as an intensified ultraviolet band. Real cool flames emit mainly excited formaldehyde with only a trace of OH*, three to four orders of magnitude weaker than a hot flame; the model uses that intensity ratio, and the label follows the challenge brief.
- The classifier is trained and scored on simulated sensor traces with added instrument noise. Its 99.6 % held-out accuracy measures consistency with the simulator, not performance on real instruments.
- Bibliographic entries were written from knowledge of the literature and omit DOIs. Check them against the publisher record before citing.
- Material constants in the risk ranker are handbook-level values. The ranking is indicative, not a qualification test.

## Architecture

```text
backend/
  physics/   properties.py   fuel, diluent and calibration data
             transport.py    gas transport, Frossling correlation with Stefan-flow correction
             droplet.py      d²-law hot branch, cool-flame branch, radiative loss
             damkohler.py    Da = tau_flow / tau_chem, extinction attribution
             low_flow.py     non-monotonic airflow response, re-ignition margin
             solver.py       event-driven coupled ODE integration of one burn
             aerosol.py      sectional Smoluchowski coagulation, detector response
             eclss.py        suppression protocol from the extinction criteria
  data/      nasa_psi_corpus.py, generate_dataset.py
  ml/        features.py, regime_classifier.py, risk_ranker.py, uncertainty.py, train.py
  app/       FastAPI application and schemas
  tests/     76 pytest cases
frontend/
  src/app/         Next.js App Router: workbench (/) and analytics (/analytics)
  src/components/  CombustionTwin (three.js), TelemetryCharts (Recharts), controls, ECLSS,
                   citation inspector, analytics panels, judge walkthrough
  src/lib/         API client, playback clock, design tokens
scripts/           smoke test, calibration report, screenshot and video capture
```

## Physics

**d²-law, hot flame.** `D²(t) = D0² - K t`, with

```text
K = 8 λ_g / (ρ_l c_pg) · ln(1 + B) · F_conv
B = [ c_pg (T∞ - T_b) + (1 - χ_r) Y_O,∞ Q / s ] / h_fg
```

The logarithm is the Stefan-flow solution for a vaporising surface. With no oxidizer `B` reduces to the pure-vaporisation transfer number `c_pg (T∞ - T_b) / h_fg`. Film properties follow the Law and Williams mixing rule. `F_conv` is the Frossling factor `1 + 0.276 Re^½ Pr^⅓`, reduced by the Abramzon-Sirignano function for Stefan-flow film thickening.

**Radiation.** For an optically thin flame ball, `Q_rad = (π/6) D_f³ · 4 σ κ_P (T_f⁴ - T∞⁴)`. Heat release scales with `D` and loss with `D³ T⁴`, so the radiative fraction `χ_r` grows as `D²`. `χ_r`, `T_f`, `B` and `K` are solved together by a damped fixed point.

**Extinction.** `Da = τ_flow / τ_chem`, with `1/τ_flow = α/D_f² + 2U/D_f` and a one-step Arrhenius `τ_chem`. The single condition `Da < 1` gives three limits: radiative (large flame, low temperature), convective blowoff (high strain) and diffusive burnout (small droplet).

**Cool flame.** The low-temperature flame is pinned near the NTC turnover, so its transfer number is set by conduction from a sheet at `T_cf` at finite standoff. `T_cf` rises with an oxidizer-supply factor `Φ = (X_O2/0.21) p^½ Sh/Sh0`.

**Low-flow enhancement.** Slow flow compresses the flame standoff (less radiating volume), raises the Sherwood number (hotter cool flame) and adds strain. The first two dominate at 1-10 cm/s; strain dominates at high speed. Burn intensity is therefore non-monotonic in airflow, and a cool flame re-ignites when `T_cf` exceeds the NTC ceiling while the hot branch is viable.

**Solver.** State `[D², η]` (η is the flame standoff ratio, relaxing toward its quasi-steady target on a diffusive time scale) is integrated with adaptive RK45. Terminal events switch regime: hot → radiative extinction → cool flame → re-ignition or extinction. One burn solves in 30-100 ms.

**Smoke aerosol.** The Smoluchowski equation on a geometric grid with the Kumar-Ramkrishna fixed-pivot method (number and mass conserving), a Brownian kernel with slip correction, and fractal aggregates (`D_f = 1.8`). In 1 g a buoyant plume dilutes the smoke within about a second and freezes its size; in 0 g with fans off it keeps coagulating past 1 µm.

One departure from the challenge brief: the brief states that >1 µm aggregates evade photoelectric detectors. Rayleigh-Debye-Gans scattering theory, implemented here, gives a different result. Per unit smoke mass the *ionization* response collapses (to about 4 % of fresh smoke after ten minutes), while the *light-scattering* response rises and then plateaus. The panel reports what the model computes.

## Machine learning

| Component | Method | Notes |
|---|---|---|
| Regime classifier | Gradient-boosted trees on six features from radiometer, UV and CO/O2 (levels, slopes, ratio) | No optical input. Split by scenario to avoid leakage. 99.6 % accuracy, macro-F1 0.97 on 72 held-out burns |
| Risk ranker | Weighted multi-criteria score (ignition, CO yield, suppression) over 6 materials × 3 atmospheres | Deterministic; weights adjustable through `POST /api/risk` |
| Uncertainty detector | Envelope check against flown ranges plus outcome entropy over a 12-member calibration ensemble | Verdicts: `VERIFIED`, `INTERPOLATED`, `BEYOND_FRONTIER` |

## API

| Method | Path | Returns |
|---|---|---|
| POST | `/api/simulate` | Time series, regimes, events, classifier trace, ECLSS protocol, provenance |
| POST | `/api/classify` | Regime labels and probabilities for supplied sensor traces |
| POST | `/api/eclss` | Suppression protocol for a chamber condition |
| POST | `/api/uncertainty` | Envelope verdict and ensemble disagreement |
| POST | `/api/frontier` | Verdict grid over O2 × airflow |
| POST | `/api/flow-sweep` | Quasi-steady burn intensity against airflow |
| POST | `/api/aerosol` | Coagulation in 1 g and 0 g with detector response |
| GET, POST | `/api/risk` | Material × atmosphere leaderboard |
| GET | `/api/corpus` | Experiment metadata, benchmarks, citations |
| GET | `/api/model-card` | Classifier metrics |
| GET | `/api/health` | Service status |

## Verification

```bash
cd backend && .venv/bin/python -m pytest -q        # .venv\Scripts\python on Windows
python scripts/smoke_test.py                        # servers must be running
cd scripts && npm install && node screenshots.mjs   # visual review captures
cd scripts && node record_demo.mjs                  # re-record demo_30s.mp4
```

The test suite checks the d²-law against its closed form, linearity of `D²(t)`, benchmark ranges, extinction ordering and attribution, the non-monotonic flow response, coagulation mass conservation, classifier accuracy, the uncertainty verdicts and every endpoint including input validation.

## Interface

Dark industrial palette (`#090A0D` canvas, `#111318` panels, `#1E222B` hairlines), Inter for labels and JetBrains Mono with tabular figures for every number. Colour carries state only: green nominal, amber warning, red critical, blue for the UV channel. The workbench is a fixed three-column grid that does not scroll at 1920×1080.

## References

- Nayagam et al., *Can cool flames support quasi-steady alkane droplet burning?*, Combustion and Flame 159 (2012).
- Dietrich et al., *Droplet combustion experiments aboard the International Space Station*, Microgravity Science and Technology 26 (2014).
- Farouk and Dryer, *Isolated n-heptane droplet combustion in microgravity: cool flames - two-stage combustion*, Combustion and Flame 161 (2014).
- Law and Williams, *Kinetics and convection in the combustion of alkane droplets*, Combustion and Flame 19 (1972).
- Abramzon and Sirignano, *Droplet vaporization model for spray combustion calculations*, Int. J. Heat Mass Transfer 32 (1989).
- Olson and Ferkul, *Microgravity flammability boundary for PMMA rods in axial stagnation flow*, Combustion and Flame 180 (2017).
- Urban et al., *Flame spread: effects of microgravity and scale*, Combustion and Flame 199 (2019).
- Meyer et al., *Smoke characterization and feasibility of the moment method for spacecraft fire detection*, Aerosol Science and Technology 49 (2015).
- Kumar and Ramkrishna, *On the solution of population balance equations by discretization - I*, Chem. Eng. Sci. 51 (1996).
- Dobbins and Megaridis, *Absorption and scattering of light by polydisperse aggregates*, Applied Optics 30 (1991).
- NASA Physical Sciences Informatics: https://www.nasa.gov/psi/
