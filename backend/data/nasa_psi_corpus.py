"""Structured metadata for the NASA microgravity combustion experiments used here.

Scope and provenance
--------------------
This module records experiment *parameters* (hardware, fuels, tested ranges,
headline findings) as reported in the open literature and in the NASA
Physical Sciences Informatics (PSI) repository descriptions. It does not
contain flight telemetry. Every time series served by IGNIS-SI is produced
by the reduced-order model in ``physics/`` and is labelled ``source="model"``;
the records below supply the context, the tested envelope and the citation
for each simulated condition.

Each numeric range carries a confidence flag:
  * ``published``   - stated in the cited paper or PSI experiment summary;
  * ``approximate`` - representative of the campaign but not traceable to a
    single table; treat as indicative and verify against PSI before reuse.

Bibliographic entries omit DOIs. Verify them against the publisher record
before citing in formal work.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Literal

Confidence = Literal["published", "approximate"]
ExperimentClass = Literal["liquid_droplet", "solid_fuel", "gaseous", "smoke_aerosol"]

PSI_URL = "https://www.nasa.gov/psi/"


@dataclass(frozen=True)
class Citation:
    key: str
    authors: str
    title: str
    venue: str
    year: int


@dataclass(frozen=True)
class ParameterRange:
    low: float
    high: float
    unit: str
    confidence: Confidence


@dataclass(frozen=True)
class Experiment:
    key: str
    name: str
    full_name: str
    experiment_class: ExperimentClass
    platform: str
    facility: str
    period: str
    investigators: str
    fuels: tuple[str, ...]
    model_fuels: tuple[str, ...]
    diluents: tuple[str, ...]
    geometry: str
    envelope: dict[str, ParameterRange]
    findings: tuple[str, ...]
    citations: tuple[str, ...]
    psi_listed: bool = True
    notes: str = ""


@dataclass(frozen=True)
class Benchmark:
    key: str
    experiment: str
    quantity: str
    low: float
    high: float
    unit: str
    conditions: str
    confidence: Confidence
    citation: str
    model_field: str = ""


CITATIONS: dict[str, Citation] = {
    c.key: c
    for c in (
        Citation("nayagam2012", "Nayagam V., Dietrich D.L., Ferkul P.V., Hicks M.C., Williams F.A.",
                 "Can cool flames support quasi-steady alkane droplet burning?",
                 "Combustion and Flame 159, 3583-3588", 2012),
        Citation("dietrich2014", "Dietrich D.L., Nayagam V., Hicks M.C., Ferkul P.V., Dryer F.L., Farouk T., Shaw B.D., Suh H.K., Choi M.Y., Liu Y.C., Avedisian C.T., Williams F.A.",
                 "Droplet combustion experiments aboard the International Space Station",
                 "Microgravity Science and Technology 26, 65-76", 2014),
        Citation("farouk2014", "Farouk T.I., Dryer F.L.",
                 "Isolated n-heptane droplet combustion in microgravity: cool flames - two-stage combustion",
                 "Combustion and Flame 161, 565-581", 2014),
        Citation("law1972", "Law C.K., Williams F.A.",
                 "Kinetics and convection in the combustion of alkane droplets",
                 "Combustion and Flame 19, 393-405", 1972),
        Citation("abramzon1989", "Abramzon B., Sirignano W.A.",
                 "Droplet vaporization model for spray combustion calculations",
                 "International Journal of Heat and Mass Transfer 32, 1605-1618", 1989),
        Citation("kim2023", "Kim M., Waddell K.A., Sunderland P.B., Nayagam V., Stocker D.P., Dietrich D.L., Ju Y., Williams F.A., Irace P., Axelbaum R.L.",
                 "Spherical gas-fueled cool diffusion flames",
                 "Proceedings of the Combustion Institute 39", 2023),
        Citation("olson2017", "Olson S.L., Ferkul P.V.",
                 "Microgravity flammability boundary for PMMA rods in axial stagnation flow: experimental results and energy balance analyses",
                 "Combustion and Flame 180, 217-229", 2017),
        Citation("urban2019", "Urban D.L., Ferkul P., Olson S., Ruff G.A., Easton J., T'ien J.S., Liao Y.-T.T., Li C., Fernandez-Pello C., Torero J.L., Legros G., Eigenbrod C., Smirnov N., Fujita O., Rouvreau S., Toth B., Jomaas G.",
                 "Flame spread: effects of microgravity and scale",
                 "Combustion and Flame 199, 168-182", 2019),
        Citation("jomaas2015", "Jomaas G., Torero J.L., Eigenbrod C., Niehaus J., Olson S.L., Ferkul P.V., Legros G., Fernandez-Pello A.C., Cowlard A.J., Rouvreau S., Smirnov N., Fujita O., T'ien J.S., Ruff G.A., Urban D.L.",
                 "Fire safety in space - beyond flammability testing of small samples",
                 "Acta Astronautica 109, 208-216", 2015),
        Citation("meyer2015", "Meyer M.E., Mulholland G.W., Bryg V., Urban D.L., Yuan Z.-G., Ruff G.A., Cleary T., Yang J.",
                 "Smoke characterization and feasibility of the moment method for spacecraft fire detection",
                 "Aerosol Science and Technology 49, 299-309", 2015),
        Citation("urban2005", "Urban D.L., Ruff G.A., Brooker J.E., Cleary T., Yang J., Mulholland G., Yuan Z.-G.",
                 "Spacecraft fire detection: smoke properties and transport in low gravity",
                 "46th AIAA Aerospace Sciences Meeting, AIAA 2008-806", 2008),
        Citation("kumar1996", "Kumar S., Ramkrishna D.",
                 "On the solution of population balance equations by discretization - I. A fixed pivot technique",
                 "Chemical Engineering Science 51, 1311-1332", 1996),
        Citation("dobbins1991", "Dobbins R.A., Megaridis C.M.",
                 "Absorption and scattering of light by polydisperse aggregates",
                 "Applied Optics 30, 4747-4754", 1991),
    )
}


EXPERIMENTS: dict[str, Experiment] = {
    e.key: e
    for e in (
        Experiment(
            key="FLEX", name="FLEX", full_name="Flame Extinguishment Experiment",
            experiment_class="liquid_droplet",
            platform="ISS, Destiny laboratory",
            facility="Combustion Integrated Rack (CIR) / Multi-user Droplet Combustion Apparatus (MDCA)",
            period="2009-2011",
            investigators="F.A. Williams (UC San Diego); D.L. Dietrich, V. Nayagam (NASA Glenn)",
            fuels=("n-heptane", "methanol"), model_fuels=("n-heptane", "methanol"),
            diluents=("N2", "CO2", "He"),
            geometry="Isolated free-floated or fibre-supported droplet in a quiescent sealed chamber",
            envelope={
                "d0_mm": ParameterRange(1.5, 5.0, "mm", "published"),
                "x_o2": ParameterRange(0.10, 0.40, "mole fraction", "approximate"),
                "pressure_atm": ParameterRange(0.5, 3.0, "atm", "approximate"),
                "airflow_cm_s": ParameterRange(0.0, 0.0, "cm/s", "published"),
            },
            findings=(
                "Large n-heptane droplets lose their visible hot flame to radiative extinction yet keep vaporising at a quasi-steady rate.",
                "The continued burning is sustained by a low-temperature (cool) flame that the colour cameras do not record.",
                "Second-stage burning ends at a finite cool-flame extinction diameter, leaving a vapour cloud of partially oxidised fuel.",
            ),
            citations=("nayagam2012", "dietrich2014", "farouk2014"),
        ),
        Experiment(
            key="FLEX-2", name="FLEX-2", full_name="Flame Extinguishment Experiment 2",
            experiment_class="liquid_droplet",
            platform="ISS, Destiny laboratory",
            facility="CIR / MDCA",
            period="2011-2014",
            investigators="F.A. Williams (UC San Diego) with C.T. Avedisian, M.Y. Choi, F.L. Dryer, B.D. Shaw; NASA Glenn",
            fuels=("n-heptane", "n-octane", "n-decane", "binary alkane mixtures", "surrogate fuels"),
            model_fuels=("n-heptane", "n-decane"),
            diluents=("N2", "CO2", "He"),
            geometry="Isolated droplets and droplet pairs; fibre translation provides a slow relative flow",
            envelope={
                "d0_mm": ParameterRange(1.5, 5.0, "mm", "approximate"),
                "x_o2": ParameterRange(0.10, 0.40, "mole fraction", "approximate"),
                "pressure_atm": ParameterRange(0.5, 3.0, "atm", "approximate"),
                "airflow_cm_s": ParameterRange(0.0, 3.0, "cm/s", "approximate"),
            },
            findings=(
                "Cool-flame burning recurs across normal alkanes and mixtures.",
                "At elevated pressure a cool flame can transition back to a hot flame (second-stage ignition).",
                "Slow convection alters flame shape and extinction relative to the quiescent limit.",
            ),
            citations=("dietrich2014", "farouk2014"),
        ),
        Experiment(
            key="CFI", name="CFI", full_name="Cool Flames Investigation",
            experiment_class="liquid_droplet",
            platform="ISS, Destiny laboratory",
            facility="CIR / MDCA",
            period="2016-2017",
            investigators="F.A. Williams (UC San Diego); D.L. Dietrich (NASA Glenn)",
            fuels=("n-decane", "n-dodecane", "n-octane", "alcohols"),
            model_fuels=("n-decane", "n-dodecane"),
            diluents=("N2", "CO2", "He"),
            geometry="Isolated droplets in a quiescent sealed chamber, cool-flame diagnostics",
            envelope={
                "d0_mm": ParameterRange(2.0, 5.0, "mm", "approximate"),
                "x_o2": ParameterRange(0.15, 0.40, "mole fraction", "approximate"),
                "pressure_atm": ParameterRange(0.5, 3.0, "atm", "approximate"),
                "airflow_cm_s": ParameterRange(0.0, 0.0, "cm/s", "published"),
            },
            findings=(
                "Extended the cool-flame data set to heavier alkanes and to diluted, pressurised atmospheres.",
                "Cool-flame extinction diameter depends on pressure, oxygen and diluent.",
            ),
            citations=("dietrich2014", "farouk2014"),
        ),
        Experiment(
            key="CFI-G", name="CFI-G", full_name="Cool Flames Investigation with Gases",
            experiment_class="gaseous",
            platform="ISS, Destiny laboratory",
            facility="CIR / ACME insert",
            period="2021-2022",
            investigators="P.B. Sunderland (University of Maryland)",
            fuels=("n-butane", "propane", "dimethyl ether"), model_fuels=(),
            diluents=("N2",),
            geometry="Spherical diffusion flame on a porous burner",
            envelope={
                "pressure_atm": ParameterRange(0.5, 3.0, "atm", "approximate"),
                "x_o2": ParameterRange(0.21, 0.40, "mole fraction", "approximate"),
            },
            findings=("First steady spherical gaseous cool diffusion flames observed without a heated oxidizer.",),
            citations=("kim2023",),
        ),
        Experiment(
            key="BASS-II", name="BASS-II", full_name="Burning and Suppression of Solids II",
            experiment_class="solid_fuel",
            platform="ISS, Destiny laboratory",
            facility="Microgravity Science Glovebox (MSG), SPICE flow duct",
            period="2014-2017",
            investigators="S.L. Olson, P.V. Ferkul (NASA Glenn); S. Bhattacharjee; A.C. Fernandez-Pello; F.J. Miller; J.S. T'ien",
            fuels=("PMMA rods, slabs and spheres", "cotton-fiberglass fabric"),
            model_fuels=(), diluents=("N2",),
            geometry="Small solid samples in a low-speed duct, opposed and concurrent flow",
            envelope={
                "x_o2": ParameterRange(0.16, 0.21, "mole fraction", "approximate"),
                "pressure_atm": ParameterRange(1.0, 1.0, "atm", "published"),
                "airflow_cm_s": ParameterRange(0.0, 40.0, "cm/s", "approximate"),
            },
            findings=(
                "Solid fuels burn at oxygen levels below their normal-gravity limits when the flow is slow.",
                "Flammability has a low-speed quenching branch and a high-speed blowoff branch; the widest margin lies between them.",
            ),
            citations=("olson2017",),
        ),
        Experiment(
            key="SAFFIRE-I-III", name="Saffire I-III", full_name="Spacecraft Fire Safety Experiment I-III",
            experiment_class="solid_fuel",
            platform="Cygnus cargo vehicle after ISS departure",
            facility="Saffire flow duct",
            period="2016-2017",
            investigators="D.L. Urban, G.A. Ruff (NASA Glenn)",
            fuels=("cotton-fiberglass sheet 0.4 m x 0.94 m", "PMMA", "silicone", "Nomex", "nine-sample card (Saffire-II)"),
            model_fuels=(), diluents=("N2",),
            geometry="Large-scale concurrent and opposed flame spread in a ventilated duct",
            envelope={
                "x_o2": ParameterRange(0.21, 0.21, "mole fraction", "published"),
                "pressure_atm": ParameterRange(1.0, 1.0, "atm", "published"),
                "airflow_cm_s": ParameterRange(20.0, 30.0, "cm/s", "approximate"),
            },
            findings=(
                "Concurrent flame spread over a metre-scale sample reached a limiting length and steady spread rate.",
                "Spread was slower than normal-gravity upward spread, but the flame persisted at flows typical of spacecraft ventilation.",
            ),
            citations=("urban2019", "jomaas2015"),
        ),
        Experiment(
            key="SAFFIRE-IV-VI", name="Saffire IV-VI", full_name="Spacecraft Fire Safety Experiment IV-VI",
            experiment_class="solid_fuel",
            platform="Cygnus cargo vehicle after ISS departure",
            facility="Saffire flow duct with far-field diagnostics and smoke-eater",
            period="2020-2024",
            investigators="D.L. Urban, G.A. Ruff (NASA Glenn)",
            fuels=("cotton-fiberglass", "PMMA", "Nomex", "structured and thick samples"),
            model_fuels=(), diluents=("N2",),
            geometry="Large-scale flame spread at exploration atmospheres with post-fire cleanup",
            envelope={
                "x_o2": ParameterRange(0.21, 0.34, "mole fraction", "approximate"),
                "pressure_atm": ParameterRange(0.56, 1.0, "atm", "approximate"),
                "airflow_cm_s": ParameterRange(20.0, 30.0, "cm/s", "approximate"),
            },
            findings=(
                "Oxygen-enriched, reduced-pressure exploration atmospheres increase flame spread rate and heat release.",
                "Measured combustion-product transport and the performance of post-fire atmosphere cleanup.",
            ),
            citations=("urban2019",),
            notes="Atmosphere set points follow the NASA exploration atmosphere targets (26.5 % O2 at 10.2 psia, 34 % O2 at 8.2 psia).",
        ),
        Experiment(
            key="SAME", name="SAME", full_name="Smoke Aerosol Measurement Experiment",
            experiment_class="smoke_aerosol",
            platform="ISS, Destiny laboratory",
            facility="Microgravity Science Glovebox",
            period="2007 and 2010 (SAME-R)",
            investigators="D.L. Urban, G.A. Ruff (NASA Glenn); G.W. Mulholland; T. Cleary (NIST)",
            fuels=("Teflon", "Kapton", "cellulose lamp wick", "silicone rubber", "Pyrell foam"),
            model_fuels=(), diluents=("N2",),
            geometry="Overheated material samples; smoke aged in a chamber and characterised by moment instruments",
            envelope={
                "particle_diameter_nm": ParameterRange(100.0, 500.0, "nm", "approximate"),
                "pressure_atm": ParameterRange(1.0, 1.0, "atm", "published"),
                "airflow_cm_s": ParameterRange(0.0, 8.0, "cm/s", "approximate"),
            },
            findings=(
                "Smoke particles from several spacecraft materials are larger in low gravity than in normal gravity.",
                "Neither ionization nor light-scattering detectors respond well across every material; detector sensitivity depends on particle size.",
                "Aging in stagnant conditions shifts the size distribution toward large aggregates.",
            ),
            citations=("meyer2015", "urban2005"),
        ),
    )
}


BENCHMARKS: tuple[Benchmark, ...] = (
    Benchmark("heptane_hot_k", "FLEX", "Hot-flame burning-rate constant, n-heptane in air", 0.50, 0.80, "mm^2/s",
              "1 atm, 21 % O2/N2, quiescent", "approximate", "dietrich2014", "mean_hot_burning_rate_mm2_s"),
    Benchmark("heptane_cool_k", "FLEX", "Cool-flame burning-rate constant, n-heptane in air", 0.25, 0.45, "mm^2/s",
              "1 atm, 21 % O2/N2, quiescent, D0 near 3.9 mm", "approximate", "nayagam2012", "mean_cool_burning_rate_mm2_s"),
    Benchmark("heptane_cool_ext_d", "FLEX", "Cool-flame extinction diameter, n-heptane in air", 0.9, 1.6, "mm",
              "1 atm, 21 % O2/N2, quiescent, D0 near 3.9 mm", "approximate", "nayagam2012", "final_diameter_mm"),
    Benchmark("heptane_rad_ext_d0", "FLEX", "Smallest initial diameter showing radiative extinction", 2.5, 3.5, "mm",
              "1 atm, 21 % O2/N2, quiescent", "approximate", "dietrich2014"),
    Benchmark("methanol_hot_k", "FLEX", "Hot-flame burning-rate constant, methanol in air", 0.40, 0.65, "mm^2/s",
              "1 atm, 21 % O2/N2, quiescent", "approximate", "dietrich2014", "mean_hot_burning_rate_mm2_s"),
    Benchmark("same_particle_d", "SAME", "Smoke diameter of average mass in low gravity", 100.0, 500.0, "nm",
              "Overheated spacecraft materials, moderate aging", "approximate", "meyer2015"),
)


DROPLET_CAMPAIGNS: tuple[str, ...] = ("FLEX", "FLEX-2", "CFI")
ENVELOPE_DIMENSIONS: tuple[str, ...] = ("d0_mm", "x_o2", "pressure_atm", "airflow_cm_s")


def nearest_campaign(fuel: str, airflow_cm_s: float) -> Experiment:
    """Droplet campaign whose configuration is closest to a simulated case."""
    if airflow_cm_s > 0.0:
        return EXPERIMENTS["FLEX-2"]
    for key in DROPLET_CAMPAIGNS:
        if fuel in EXPERIMENTS[key].model_fuels:
            return EXPERIMENTS[key]
    return EXPERIMENTS["FLEX"]


def provenance(fuel: str, d0_mm: float, x_o2: float, pressure_atm: float, airflow_cm_s: float) -> dict[str, object]:
    """Metadata block attached to every simulated telemetry record."""
    exp = nearest_campaign(fuel, airflow_cm_s)
    values = {"d0_mm": d0_mm, "x_o2": x_o2, "pressure_atm": pressure_atm, "airflow_cm_s": airflow_cm_s}
    inside = {
        dim: exp.envelope[dim].low - 1e-9 <= values[dim] <= exp.envelope[dim].high + 1e-9
        for dim in ENVELOPE_DIMENSIONS
    }
    return {
        "source": "model",
        "model": "IGNIS-SI reduced-order droplet combustion solver",
        "reference_experiment": exp.key,
        "reference_experiment_name": exp.full_name,
        "facility": exp.facility,
        "platform": exp.platform,
        "period": exp.period,
        "fuel_tested_in_reference": fuel in exp.model_fuels,
        "within_reference_envelope": inside,
        "citations": [asdict(CITATIONS[c]) for c in exp.citations],
        "repository": PSI_URL,
    }


def corpus_as_dict() -> dict[str, object]:
    return {
        "repository": PSI_URL,
        "disclaimer": (
            "Experiment parameters and findings are summarised from the open literature. "
            "Telemetry shown in this application is model output, not flight data."
        ),
        "experiments": [asdict(e) for e in EXPERIMENTS.values()],
        "benchmarks": [asdict(b) for b in BENCHMARKS],
        "citations": [asdict(c) for c in CITATIONS.values()],
    }


__all__ = [
    "Benchmark", "Citation", "Experiment", "ParameterRange", "BENCHMARKS", "CITATIONS", "EXPERIMENTS",
    "DROPLET_CAMPAIGNS", "ENVELOPE_DIMENSIONS", "PSI_URL", "corpus_as_dict", "nearest_campaign", "provenance",
]
