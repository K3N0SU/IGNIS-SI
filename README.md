# IGNIS-SI

**An entry for the NASA Space Apps 2026 challenge "Flame in Freefall: AI-Powered Fire Safety Insights from Microgravity Combustion Data".**

A spacecraft fire-safety workbench built on NASA flight data. It shows the fire a camera cannot see, predicts what happens when the cabin fans come back on, and tells you whether NASA has ever tested the condition you are looking at.

The scripts in `scripts/` record two films of the running application: a 30-second demo and a five-minute walkthrough of every view.

## The problem

Fire behaves differently without buoyancy. On the International Space Station, NASA's FLEX experiment found that a large fuel droplet can lose its visible flame and keep burning as a *cool flame* near 700 K. It gives off no visible light, so a colour camera shows an extinguished fire, while fuel is still being consumed and carbon monoxide is still being produced.

The standard first response to a spacecraft fire is to stop ventilation. If the crew restarts the fans because the flame looks out, fresh oxygen can push that cool flame back into a hot one.

## What the workbench does

| View | What you can do |
|---|---|
| **Workbench** | Set fuel, droplet size, oxygen, pressure and fan airflow. Watch the burn in 3D through an optical camera or a UV sensor, with synchronised sensor charts (the closest real NASA test is drawn on the droplet-size chart), a plain-language fire state, a step-by-step life-support response and the evidence behind the prediction. |
| **Analytics** | Compare cabin materials across the ISS, 10.2 psia and Artemis atmospheres; see which conditions NASA has flown; see how fire intensity responds to airflow; see how smoke particles grow in orbit. |
| **Flight data** | Browse all 261 usable FLEX droplet burns, see the model plotted against flight measurements, and compare NASA's investigations by fuel, oxygen, airflow and sensors, ranked for your scenario, each with its findings and DOI. |
| **Assistant** | Ask a question in plain language. It runs the simulation, looks up flight tests and sets up the workbench to show you the answer. |

A guided tour in the top bar walks through the whole story in about 90 seconds.

## Quick start

Requirements: Python 3.11 to 3.13 (3.13 recommended; 3.14.6 showed interpreter faults) and Node.js 20 or newer. Chrome or Edge is needed only to re-record the film.

```bash
./start.sh            # macOS, Linux, Git Bash
start.bat             # Windows
```

The script installs dependencies, checks the model against the NASA flight tables, trains the classifier, runs the tests, builds the frontend, starts both servers and smoke-tests every endpoint. Then open http://localhost:3000.

`./start.sh --verify` (or `start.bat --verify`) runs the same checks and then stops the servers.

The API runs under a small supervisor (`scripts/serve_backend.py`) that restarts it if its process dies, and the interface retries on its own, so a dropped service recovers without a reload.

**Assistant (optional).** Copy `backend/.env.example` to `backend/.env` and set `GEMINI_API_KEY`. Without a key everything else works and the assistant panel explains how to enable it. When it is enabled, your question and the current scenario are sent to Google Gemini; nothing else is.

## NASA data

All flight data comes from the NASA Physical Sciences Informatics repository (https://psi.nasa.gov), retrieved through its public API by `backend/data/fetch_psi.py` and stored unmodified in `backend/data/psi/` with source URLs and SHA-256 checksums in `manifest.json`. Every dataset is CC0.

| Investigation | PSI | Records | Dataset DOI |
|---|---|---|---|
| Flame Extinguishment Experiment (FLEX) | PSI-69 | 274 | 10.60555/mbq8-0451 |
| Flame Extinguishment Experiment 2 | PSI-68 | 8 | 10.60555/byp8-h018 |
| Cool Flames Investigation | PSI-39 | 87 | 10.60555/m6pj-a914 |
| Cool Flames Investigation with Gases | PSI-159 | 333 | 10.60555/cyt1-kh64 |
| Burning and Suppression of Solids | PSI-26 | 122 | 10.60555/58h4-dy80 |
| Burning and Suppression of Solids II | PSI-25 | 129 | 10.60555/4qc4-de67 |
| Saffire I, II, III | PSI-98, 99, 100 | 21 | 10.60555/0t15-1z43, 2chp-m469, 040q-4h36 |
| Smoke Aerosol Measurement Experiment and Reflight | PSI-102, 101 | 117 | 10.60555/gd4k-8h62, 2np7-jv14 |

How the data is used:

- **Calibration.** Nine closure constants of the combustion model are fitted to 196 FLEX tests (`backend/data/calibrate.py`).
- **Validation.** The fitted model is scored on the other 65 FLEX tests, which the fit never saw.
- **Tested envelope.** The ranges that decide whether a scenario is "verified" or "beyond the frontier" are computed from the flight tables.
- **Evidence.** For any scenario the workbench shows the closest real tests with their measured burning rate and outcome.
- **Risk context.** Saffire-II flight results are shown beside the material ranking.

### How well the model matches flight

Held-out FLEX tests, n = 65. "Before" is the model with hand-set constants.

| Measure | Before fit | After fit |
|---|---|---|
| Burning rate, mean absolute error | 34 % | 18 % |
| Extinction diameter, mean error (fraction of initial diameter) | 0.35 | 0.16 |
| Extinction diameter within 0.2 of initial | 31 % | 76 % |
| Early or late flame-out predicted correctly | 57 % | 69 % |
| Burned on orbit but the model will not ignite | 16 | 11 |

For n-heptane in air at 1 atm the model reproduces the central FLEX result closely: droplets up to about 3.4 mm burn out and larger ones lose their visible flame at 0.8 to 0.9 of their initial diameter, in both the flight table and the model.

## What is measured and what is modelled

- **Measured by NASA:** the test matrix and each test's burning rate, visible-flame extinction diameter, burn time and outcome.
- **Modelled:** every time series on screen (droplet size, flame temperature, sensor signals, CO). The interface labels these "Simulated, not flight data".
- **Never tested on orbit:** cool-flame re-ignition by ventilation above 5 cm/s. FLEX was quiescent and FLEX-2 reached 5 cm/s. The fan-restart scenario at 8 cm/s is a model prediction, and the workbench marks it "Beyond frontier". Treat the predicted critical airflow as a hypothesis for an experiment, not as a flight rule.
- **Classifier scores** (98.5 % on held-out simulated burns) measure agreement with the simulator, not performance on real instruments.
- **Material ranking** uses handbook constants with a microgravity shift of the oxygen limit. It is indicative.
- **The "UV OH*" channel** is modelled as an intensified ultraviolet band. Real cool flames emit mainly excited formaldehyde with a trace of OH*, three to four orders of magnitude weaker than a hot flame; the model uses that ratio.
- **Smoke detectors.** Scattering theory implemented here says aged smoke aggregates blind *ionization* detectors (response falls to about 4 % of fresh smoke), while light-scattering response rises and then levels off. The panel reports what the model computes.

## How it answers the challenge

| The challenge asks for | Where it is |
|---|---|
| Summarise decades of microgravity combustion results | Investigations panel with findings, period, fuels and sources; the assistant summarises on request |
| Rank them | Relevance ranking of investigations for the current scenario, with the scoring rule shown; material risk ranking |
| Explain them | Plain-language fire state, glossary, a reason for every ranked investigation, the assistant, the guided tour |
| Compare by fuel, oxygen, airflow and sensors | Investigations table and expandable sensor lists; FLEX test map with fuel filter |
| AI-powered | Tool-using assistant, machine-learning fire-state classifier, calibration ensemble |
| Inform Moon and Mars fire safety | Artemis atmosphere in the risk ranking; response protocol; explicit flagging of untested conditions |

## Assessment against the Space Apps judging criteria

| Criterion | Evidence in this project | Honest gap |
|---|---|---|
| **Impact** | Addresses a real crew-safety hazard: a fire that is invisible to the standard optical check, and a standard response (fan restart) that can make it worse. Produces a concrete response protocol with oxygen, pressure and airflow targets. | The response protocol is a decision aid. It has not been reviewed by flight operations. |
| **Creativity** | Shows the same fire through two sensors side by side; turns "has this been tested?" into a first-class answer with the nearest real tests; an assistant that operates the workbench instead of only chatting. | The 3D view is a visualisation of the model, not a reconstruction of flight video. |
| **Validity** | Physics from the droplet-combustion literature; constants fitted to 196 real ISS tests and scored on 65 held out; 107 unit tests plus browser and load tests; every source has a DOI. | Model error is still 18 % on burning rate. Methanol near its flammability limit is the weakest area. Re-ignition under flow has no flight data. |
| **Relevance** | Uses eleven NASA PSI investigations directly; summarises, ranks, explains and compares them by fuel, oxygen, airflow and sensors as the challenge asks; extends to the Artemis 34 % oxygen atmosphere. | Saffire IV to VI tables were not found in PSI at retrieval time, so exploration-atmosphere flame-spread data is cited, not used. |
| **Presentation** | Plain-language fire state, guided tour, glossary tooltips, a 30-second film and a five-minute walkthrough, one-command start, and this document. | Designed for desktop at 1920x1080; smaller windows scroll inside panels. Not tested on mobile. |

## How it works

```text
backend/     Dockerfile for the API
  physics/   droplet d²-law with Stefan flow and radiation, Damkohler extinction,
             cool-flame branch, low-flow response, event-driven ODE solver,
             smoke coagulation, life-support protocol
  data/      fetch_psi.py, psi/ (NASA tables), psi_flight.py, calibrate.py,
             validation.py, nasa_psi_corpus.py, calibration_fit.json
  ml/        regime classifier, material risk ranker, uncertainty and nearest-test search
  app/       FastAPI service and the assistant agent
  tests/     107 pytest cases
frontend/    Next.js, three.js, Recharts
scripts/     API supervisor, smoke, browser and load tests, screenshots, film recorders, score synthesiser
```

**Physics in brief.** A burning droplet follows `D²(t) = D0² - K t` with `K = 8 λ_g / (ρ_l c_pg) · ln(1 + B)`, where the logarithm accounts for Stefan flow and `B` includes the heat of combustion reduced by the radiated fraction. Radiation from the flame ball scales as `D³ T⁴` while heat release scales as `D`, so large droplets radiate themselves out. Extinction is a single Damkohler-number test, `Da = τ_flow / τ_chem < 1`, which yields radiative, blowoff and small-droplet limits. A separate low-temperature branch models the cool flame; slow airflow raises its temperature and can carry it back to hot ignition. Methanol absorbs water from its own flame, which is modelled as dilution of the fuel stream. Smoke growth uses a number- and mass-conserving sectional coagulation model for fractal aggregates.

**Assistant.** A tool-using agent on Google Gemini. It can run a simulation, look up flight evidence, read the risk ranking and model accuracy, and load a scenario into the workbench. It is instructed never to state a number that did not come from a tool, and to say whether a statement is a NASA measurement or a model prediction.

## API

| Method | Path | Returns |
|---|---|---|
| POST | `/api/simulate` | Time series, fire states, events, classifier trace, response protocol, provenance |
| POST | `/api/uncertainty` | Coverage verdict, per-parameter ranges, nearest flight tests, model disagreement |
| POST | `/api/investigations` | NASA investigations compared and ranked for a scenario |
| GET | `/api/flight/flex` | Every usable FLEX test with the model's prediction, error metrics and the calibration report |
| GET | `/api/flight/datasets` | NASA investigations with DOI, license and table checksums |
| GET | `/api/flight/saffire` | Saffire sample results |
| POST | `/api/assistant` | Assistant reply, tool calls made and any scenario to apply |
| POST | `/api/eclss`, `/api/classify`, `/api/frontier`, `/api/flow-sweep`, `/api/aerosol` | Response protocol, sensor classification, coverage map, airflow response, smoke growth |
| GET, POST | `/api/risk` | Material ranking |
| GET | `/api/corpus`, `/api/model-card`, `/api/health`, `/api/assistant/status` | Experiment metadata, classifier metrics, service status |

Interactive documentation is at http://127.0.0.1:8000/docs while the service is running.

## Reproducing the results

```bash
cd backend
python -m data.fetch_psi --force      # download the NASA tables again
python -m data.calibrate              # refit the constants (about four minutes)
python -m data.validation             # model against every usable FLEX test
python -m pytest -q
```

```bash
cd scripts && npm install
node e2e_test.mjs                               # drive the interface in a real browser
python soak_test.py                             # 400 concurrent randomised requests
python make_score.py && node record_demo.mjs    # re-record demo_30s.mp4
python make_score.py .capture/score_long.wav --seconds 300 && node record_long.mjs    # demo_5min.mp4
```

Checks run on the final code: 107 unit tests, the endpoint smoke test, a 20-step browser test, and three load runs of 400 concurrent requests each with no failed request and no service restart.

About the films: camera moves, captions and title cards are drawn by the recorder and are not part of the application. No pointer is shown; the controls are driven with real input and are seen to move. The music is synthesised by `scripts/make_score.py` and carries no third-party rights. One edit is made for time in both films: the assistant's answer is requested from the live service just before recording and replayed when the question is asked, because a live answer takes 8 to 16 seconds.

## Deploying

**One step, on Render:** open https://render.com/deploy?repo=https://github.com/K3N0SU/IGNIS-SI, sign in, enter `GEMINI_API_KEY` if you want the assistant, and apply. `render.yaml` creates both services. If Render adds a suffix to the API's name, copy the API's real address into the web service's `IGNIS_API_ORIGIN` variable and redeploy it.

To host the two parts separately instead:

The app is two services: the Next.js frontend and the Python API. The frontend sends every `/api` request through its own server to the API, so the browser only ever talks to one address and no CORS setup is needed.

**API, on any container host** (Render, Railway, Fly.io, Google Cloud Run):

1. Create a web service from this repository with `backend` as the root directory and `backend/Dockerfile` as the Dockerfile. The image trains the classifier and runs the flight-data comparison while it builds, so the container is ready about two seconds after it starts.
2. Add the environment variable `GEMINI_API_KEY` if you want the assistant. Leave it out and everything else still works.
3. The container listens on `$PORT` (8000 if the host does not set one). Check `https://<your-api>/api/health`.

To try the image locally:

```bash
docker build -t ignis-si-api backend
docker run -p 8000:8000 -e GEMINI_API_KEY=your-key ignis-si-api
```

**Frontend, on Vercel:**

1. Import the repository and set the root directory to `frontend`.
2. Add the environment variable `IGNIS_API_ORIGIN` with the API's public address, for example `https://ignis-si-api.onrender.com`, with no trailing slash. It is read when the site is built, so redeploy after changing it.
3. Deploy.

A public deployment with a Gemini key lets anyone who has the link use that key's quota through the assistant.

## References

Papers, with DOIs resolved through Crossref:

- Nayagam et al., *Can cool flames support quasi-steady alkane droplet burning?*, Combustion and Flame 159 (2012). https://doi.org/10.1016/j.combustflame.2012.07.012
- Dietrich et al., *Droplet combustion experiments aboard the International Space Station*, Microgravity Science and Technology 26 (2014). https://doi.org/10.1007/s12217-014-9372-2
- Farouk and Dryer, *Isolated n-heptane droplet combustion in microgravity: cool flames, two-stage combustion*, Combustion and Flame 161 (2014). https://doi.org/10.1016/j.combustflame.2013.09.011
- Nayagam et al., *Cool-flame extinction during n-alkane droplet combustion in microgravity*, Combustion and Flame 162 (2015). https://doi.org/10.1016/j.combustflame.2015.01.012
- Law and Williams, *Kinetics and convection in the combustion of alkane droplets*, Combustion and Flame 19 (1972). https://doi.org/10.1016/0010-2180(72)90009-0
- Abramzon and Sirignano, *Droplet vaporization model for spray combustion calculations*, Int. J. Heat Mass Transfer 32 (1989). https://doi.org/10.1016/0017-9310(89)90043-4
- Kim et al., *Spherical gas-fueled cool diffusion flames*, Proc. Combust. Inst. 39 (2023). https://doi.org/10.1016/j.proci.2022.07.015
- Olson and Ferkul, *Microgravity flammability boundary for PMMA rods in axial stagnation flow*, Combustion and Flame 180 (2017). https://doi.org/10.1016/j.combustflame.2017.03.001
- Urban et al., *Flame spread: effects of microgravity and scale*, Combustion and Flame 199 (2019). https://doi.org/10.1016/j.combustflame.2018.10.012
- Jomaas et al., *Fire safety in space: beyond flammability testing of small samples*, Acta Astronautica 109 (2015). https://doi.org/10.1016/j.actaastro.2014.11.025
- Meyer et al., *Smoke characterization and feasibility of the moment method for spacecraft fire detection*, Aerosol Science and Technology 49 (2015). https://doi.org/10.1080/02786826.2015.1025124
- Urban et al., *Spacecraft fire detection: smoke properties and transport in low-gravity*, AIAA 2008-806. https://doi.org/10.2514/6.2008-806
- Kumar and Ramkrishna, *On the solution of population balance equations by discretization, I*, Chem. Eng. Sci. 51 (1996). https://doi.org/10.1016/0009-2509(96)88489-2
- Dobbins and Megaridis, *Absorption and scattering of light by polydisperse aggregates*, Applied Optics 30 (1991). https://doi.org/10.1364/ao.30.004747
