# Submission form text

Paste each block into the matching field on the Space Apps project page.

## Project name

IGNIS-SI

## High-level summary

Fire in a spacecraft does not behave like fire on Earth. NASA's FLEX experiment on the International Space Station found that a burning fuel droplet can lose its visible flame and keep burning as a "cool flame" that a camera cannot see. IGNIS-SI turns eleven NASA microgravity combustion investigations into a working fire-safety dashboard. It summarises, compares and ranks the investigations for the situation you describe, rebuilds the droplet experiment as a physics model calibrated on real ISS tests, shows the same fire through an optical camera and a UV sensor, predicts what happens when cabin fans are switched back on, recommends a life-support response, and always says whether NASA has actually tested the condition. An AI assistant answers questions in plain language by running the model and looking up the flight records.

## Link to project demo

(public link to demo_30s.mp4)

## Link to final project

(public GitHub repository link)

## Project details

**What does it do and how does it work?**

IGNIS-SI is a web dashboard with three views and an AI assistant.

The Workbench lets you set a fuel, droplet size, oxygen level, cabin pressure and fan airflow. A 3D view shows the droplet, its flame and its soot shell, and you can switch between an optical camera and a UV sensor. Charts show droplet size, flame temperature, sensor signals and carbon monoxide, with the closest real NASA test drawn beside the model. A plain-language panel says what the fire is doing and what each sensor can see. A response protocol lists life-support actions with oxygen, pressure and airflow targets. An evidence panel says whether the scenario is inside what NASA flew.

The Flight data view plots all 261 usable FLEX droplet burns, plots the model against the flight measurements, and compares NASA's investigations by fuel, oxygen, airflow and sensors, ranked for the current scenario with a reason for each rank.

The Analytics view ranks cabin materials across the ISS, 10.2 psia and Artemis atmospheres, maps tested and untested conditions, shows how fire intensity responds to airflow, and models how smoke particles grow in orbit.

Behind it is a physics model of a burning droplet: the d-squared law with Stefan flow and gas radiation, a Damkohler-number extinction test, a low-temperature cool-flame branch, slow airflow, and water absorption for methanol. Nine constants were fitted to 196 FLEX flight tests. On 65 tests the fit never saw, burning-rate error is 18 % and 76 % of extinction diameters are reproduced within 0.2 of the initial diameter. A machine-learning classifier identifies the fire state from radiometer, UV and gas sensors with no camera input. The assistant is a tool-using agent: it runs simulations, fetches the nearest flight tests, compares investigations and can set up the workbench, and it is instructed never to state a number that did not come from one of those tools.

**What benefits does it have?**

- It makes a hidden hazard visible: a fire that looks extinguished to a camera but is still burning and producing carbon monoxide.
- It lets a crew or designer test a response before using it. For example, it shows that restarting cabin fans can re-ignite a cool flame, and gives the airflow at which that happens.
- It is honest about evidence. Every scenario is labelled as verified by flight data, between tested points, or beyond anything NASA has flown, and it names the closest real test.
- It puts decades of NASA combustion results in one place where they can be compared, ranked and traced to their sources by DOI.
- It explains itself in plain language, so it is usable by people who are not combustion scientists.

**What is the intended impact?**

To help people planning Moon and Mars missions make better fire-safety decisions. Artemis cabins are planned to run at 34 % oxygen and reduced pressure, where materials that are safe on the ISS can burn. IGNIS-SI is meant to help mission designers, safety engineers, crew trainers and students see how fire behaves in those conditions, understand which NASA experiments support a conclusion, and recognise where more experiments are needed. It is a decision aid for analysis and training, not flight software.

**What tools, coding languages, hardware or software did you use?**

- Languages: Python 3.13, TypeScript.
- Backend: FastAPI, NumPy, SciPy, scikit-learn, Pydantic, pytest.
- Frontend: Next.js, React, three.js, Recharts, Tailwind CSS.
- AI: Google Gemini API for the in-app assistant; a scikit-learn gradient-boosted classifier trained on the project's own simulations.
- Testing and media: Playwright for browser tests and screen capture, FFmpeg for encoding, a Python script that synthesises the film soundtrack.
- Development: Git, Visual Studio Code, and an AI coding assistant (Anthropic's Claude through Claude Code), which wrote most of the code and documentation under the team's direction.
- Hardware: an ordinary Windows 11 PC. No special hardware.

**How is your project creative?**

- It shows the same fire through two sensors side by side, so you watch the flame vanish from the camera while the UV sensor still sees it.
- It treats "has NASA actually tested this?" as a first-class answer, with a map of tested conditions and the nearest real tests named on screen.
- It does not only display NASA data; it uses the data to calibrate a physics model and then checks the model on tests it never saw.
- The AI assistant operates the dashboard. Ask whether it is safe to restart the fans and it runs the simulation, checks the flight records, answers, and loads the scenario so you can watch it.
- Even the film soundtrack is generated by code in the repository.

**What factors did your team consider?**

- Scientific honesty. Simulated curves are labelled as simulated, model error is published, and predictions beyond flight data are flagged.
- Crew safety limits. The response protocol accounts for the oxygen partial pressure a crew needs to breathe and for the cabin's pressure limit.
- Understandability. Plain-language fire states, a glossary, a guided tour and no unexplained jargon.
- Trust in AI. The assistant may only report numbers that come from the model or the flight tables, and must say which is which.
- Reproducibility. All data is stored with source links and checksums, one command installs, tests and starts everything, and 107 automated tests run on every start.
- Reliability. The solver runs under a supervisor that restarts it, and the interface recovers on its own.
- Open data and licensing. Only public-domain NASA data and open-source software are used.

## NASA data and resources

All from the NASA Physical Sciences Informatics (PSI) repository, https://psi.nasa.gov, licensed CC0.

| Name | Link |
|---|---|
| NASA Physical Sciences Informatics (PSI) repository | https://psi.nasa.gov |
| PSI-69 Flame Extinguishment Experiment (FLEX) | https://doi.org/10.60555/mbq8-0451 |
| PSI-68 Flame Extinguishment Experiment 2 (FLEX-2) | https://doi.org/10.60555/byp8-h018 |
| PSI-39 Cool Flames Investigation (CFI) | https://doi.org/10.60555/m6pj-a914 |
| PSI-159 Cool Flames Investigation with Gases (CFI-G) | https://doi.org/10.60555/cyt1-kh64 |
| PSI-26 Burning and Suppression of Solids (BASS) | https://doi.org/10.60555/58h4-dy80 |
| PSI-25 Burning and Suppression of Solids II (BASS-II) | https://doi.org/10.60555/4qc4-de67 |
| PSI-98 Spacecraft Fire Safety Experiment I (Saffire-I) | https://doi.org/10.60555/0t15-1z43 |
| PSI-99 Spacecraft Fire Experiment II (Saffire-II) | https://doi.org/10.60555/2chp-m469 |
| PSI-100 Spacecraft Fire Experiment III (Saffire-III) | https://doi.org/10.60555/040q-4h36 |
| PSI-102 Smoke and Aerosol Measurement Experiment (SAME) | https://doi.org/10.60555/gd4k-8h62 |
| PSI-101 Smoke Aerosol Measurement Experiment Reflight (SAME-R) | https://doi.org/10.60555/2np7-jv14 |
| NASA/TP-2015-216046, Detailed Results from the Flame Extinguishment Experiment (NASA Technical Reports Server) | https://ntrs.nasa.gov/citations/20150023456 |

## Space agency partner data and resources

None. This project uses NASA data only. No data or resources from other space agencies were used.

## Other references and resources

Peer-reviewed papers:

- Nayagam et al., Can cool flames support quasi-steady alkane droplet burning?, Combustion and Flame (2012). https://doi.org/10.1016/j.combustflame.2012.07.012
- Dietrich et al., Droplet combustion experiments aboard the International Space Station, Microgravity Science and Technology (2014). https://doi.org/10.1007/s12217-014-9372-2
- Farouk and Dryer, Isolated n-heptane droplet combustion in microgravity: cool flames, two-stage combustion, Combustion and Flame (2014). https://doi.org/10.1016/j.combustflame.2013.09.011
- Nayagam et al., Cool-flame extinction during n-alkane droplet combustion in microgravity, Combustion and Flame (2015). https://doi.org/10.1016/j.combustflame.2015.01.012
- Law and Williams, Kinetics and convection in the combustion of alkane droplets, Combustion and Flame (1972). https://doi.org/10.1016/0010-2180(72)90009-0
- Abramzon and Sirignano, Droplet vaporization model for spray combustion calculations, Int. J. Heat and Mass Transfer (1989). https://doi.org/10.1016/0017-9310(89)90043-4
- Kim et al., Spherical gas-fueled cool diffusion flames, Proceedings of the Combustion Institute (2023). https://doi.org/10.1016/j.proci.2022.07.015
- Olson and Ferkul, Microgravity flammability boundary for PMMA rods in axial stagnation flow, Combustion and Flame (2017). https://doi.org/10.1016/j.combustflame.2017.03.001
- Urban et al., Flame spread: effects of microgravity and scale, Combustion and Flame (2019). https://doi.org/10.1016/j.combustflame.2018.10.012
- Jomaas et al., Fire safety in space: beyond flammability testing of small samples, Acta Astronautica (2015). https://doi.org/10.1016/j.actaastro.2014.11.025
- Meyer et al., Smoke characterization and feasibility of the moment method for spacecraft fire detection, Aerosol Science and Technology (2015). https://doi.org/10.1080/02786826.2015.1025124
- Urban et al., Spacecraft fire detection: smoke properties and transport in low-gravity, AIAA 2008-806. https://doi.org/10.2514/6.2008-806
- Kumar and Ramkrishna, On the solution of population balance equations by discretization, I, Chemical Engineering Science (1996). https://doi.org/10.1016/0009-2509(96)88489-2
- Dobbins and Megaridis, Absorption and scattering of light by polydisperse aggregates, Applied Optics (1991). https://doi.org/10.1364/ao.30.004747

Software and services: Python, FastAPI, NumPy, SciPy, scikit-learn, Pydantic, pytest, Next.js, React, three.js, Recharts, Tailwind CSS, Playwright, FFmpeg, Google Gemini API, Anthropic Claude (Claude Code), Crossref (DOI lookup). Fonts: Inter, JetBrains Mono.

## Use of artificial intelligence

- In the product: the assistant uses Google Gemini. A scikit-learn classifier trained on the project's own simulations identifies the fire state.
- In building it: an AI coding assistant (Anthropic's Claude, through Claude Code) wrote most of the code, documentation and film scripts under the team's direction, and ran the tests and calibration.
- Media: the film soundtrack is synthesised by a script in the repository. No AI-generated images and no NASA logos are used.
