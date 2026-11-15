"""NASA microgravity combustion experiments: flight tables, envelopes, citations.

Everything here is anchored to records retrieved from the NASA Physical
Sciences Informatics (PSI) repository by ``data.fetch_psi`` and stored under
``data/psi``. Tested parameter ranges are computed from the PSI experimental
tables wherever the table carries the quantity; each range states where it
came from:

  ``flight_table``  computed from, or read directly off, a PSI experimental table
  ``published``     stated in the cited paper or PSI investigation record
  ``approximate``   representative value not present in the retrieved tables

Paper DOIs were resolved through Crossref and match on title, first author,
year, volume and pages. Dataset DOIs are those assigned by NASA PSI.

The time series produced by ``physics.solver`` remain model output. What the
flight tables supply is the test matrix and the measured burning rate,
extinction diameter and burn time of each test, which are used to calibrate
and validate the model (``data.calibrate``, ``data.validation``).
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from functools import lru_cache
from typing import Literal

import numpy as np

from data import psi_flight

Confidence = Literal["flight_table", "published", "approximate"]
ExperimentClass = Literal["liquid_droplet", "solid_fuel", "gaseous", "smoke_aerosol"]

PSI_URL = "https://psi.nasa.gov"


@dataclass(frozen=True)
class Citation:
    key: str
    authors: str
    title: str
    venue: str
    year: int
    doi: str

    @property
    def url(self) -> str:
        return f"https://doi.org/{self.doi}"


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
    accessions: tuple[str, ...]
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
    flight_tests: int = 0
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
    source: str
    n_tests: int = 0


CITATIONS: dict[str, Citation] = {
    c.key: c
    for c in (
        Citation("nayagam2012", "Nayagam V., Dietrich D.L., Ferkul P.V., Hicks M.C., Williams F.A.",
                 "Can cool flames support quasi-steady alkane droplet burning?",
                 "Combustion and Flame 159, 3583-3588", 2012, "10.1016/j.combustflame.2012.07.012"),
        Citation("dietrich2014", "Dietrich D.L., Nayagam V., Hicks M.C., Ferkul P.V., Dryer F.L., Farouk T., Shaw B.D., Suh H.K., Choi M.Y., Liu Y.C., Avedisian C.T., Williams F.A.",
                 "Droplet combustion experiments aboard the International Space Station",
                 "Microgravity Science and Technology 26, 65-76", 2014, "10.1007/s12217-014-9372-2"),
        Citation("farouk2014", "Farouk T.I., Dryer F.L.",
                 "Isolated n-heptane droplet combustion in microgravity: cool flames, two-stage combustion",
                 "Combustion and Flame 161, 565-581", 2014, "10.1016/j.combustflame.2013.09.011"),
        Citation("nayagam2015", "Nayagam V., Dietrich D.L., Hicks M.C., Williams F.A.",
                 "Cool-flame extinction during n-alkane droplet combustion in microgravity",
                 "Combustion and Flame 162, 2140-2147", 2015, "10.1016/j.combustflame.2015.01.012"),
        Citation("dietrich2024", "Dietrich D.L. et al.",
                 "Low temperature n-dodecane droplet combustion experiments aboard the International Space Station",
                 "Microgravity Science and Technology 36", 2024, "10.1007/s12217-024-10115-x"),
        Citation("law1972", "Law C.K., Williams F.A.",
                 "Kinetics and convection in the combustion of alkane droplets",
                 "Combustion and Flame 19, 393-405", 1972, "10.1016/0010-2180(72)90009-0"),
        Citation("abramzon1989", "Abramzon B., Sirignano W.A.",
                 "Droplet vaporization model for spray combustion calculations",
                 "International Journal of Heat and Mass Transfer 32, 1605-1618", 1989, "10.1016/0017-9310(89)90043-4"),
        Citation("kim2023", "Kim M., Waddell K.A., Sunderland P.B., Nayagam V., Stocker D.P., Dietrich D.L., Ju Y., Williams F.A., Irace P., Axelbaum R.L.",
                 "Spherical gas-fueled cool diffusion flames",
                 "Proceedings of the Combustion Institute 39, 1647-1656", 2023, "10.1016/j.proci.2022.07.015"),
        Citation("olson2017", "Olson S.L., Ferkul P.V.",
                 "Microgravity flammability boundary for PMMA rods in axial stagnation flow: experimental results and energy balance analyses",
                 "Combustion and Flame 180, 217-229", 2017, "10.1016/j.combustflame.2017.03.001"),
        Citation("urban2019", "Urban D.L., Ferkul P., Olson S., Ruff G.A., Easton J., T'ien J.S., Liao Y.-T.T., Li C., Fernandez-Pello C., Torero J.L., Legros G., Eigenbrod C., Smirnov N., Fujita O., Rouvreau S., Toth B., Jomaas G.",
                 "Flame spread: effects of microgravity and scale",
                 "Combustion and Flame 199, 168-182", 2019, "10.1016/j.combustflame.2018.10.012"),
        Citation("jomaas2015", "Jomaas G., Torero J.L., Eigenbrod C., Niehaus J., Olson S.L., Ferkul P.V., Legros G., Fernandez-Pello A.C., Cowlard A.J., Rouvreau S., Smirnov N., Fujita O., T'ien J.S., Ruff G.A., Urban D.L.",
                 "Fire safety in space: beyond flammability testing of small samples",
                 "Acta Astronautica 109, 208-216", 2015, "10.1016/j.actaastro.2014.11.025"),
        Citation("meyer2015", "Meyer M.E., Mulholland G.W., Bryg V., Urban D.L., Yuan Z.-G., Ruff G.A., Cleary T., Yang J.",
                 "Smoke characterization and feasibility of the moment method for spacecraft fire detection",
                 "Aerosol Science and Technology 49, 299-309", 2015, "10.1080/02786826.2015.1025124"),
        Citation("urban2008", "Urban D.L., Ruff G.A., Mulholland G., Cleary T., Yang J., Yuan Z.-G.",
                 "Spacecraft fire detection: smoke properties and transport in low-gravity",
                 "46th AIAA Aerospace Sciences Meeting, AIAA 2008-806", 2008, "10.2514/6.2008-806"),
        Citation("kumar1996", "Kumar S., Ramkrishna D.",
                 "On the solution of population balance equations by discretization - I. A fixed pivot technique",
                 "Chemical Engineering Science 51, 1311-1332", 1996, "10.1016/0009-2509(96)88489-2"),
        Citation("dobbins1991", "Dobbins R.A., Megaridis C.M.",
                 "Absorption and scattering of light by polydisperse aggregates",
                 "Applied Optics 30, 4747", 1991, "10.1364/ao.30.004747"),
    )
}


def _span(values: list[float], unit: str, digits: int = 3) -> ParameterRange:
    return ParameterRange(round(min(values), digits), round(max(values), digits), unit, "flight_table")


def _flex_envelope() -> dict[str, ParameterRange]:
    tests = [t for t in psi_flight.load_flex() if t.usable]
    return {
        "d0_mm": _span([float(t.d0_mm or 0.0) for t in tests], "mm", 2),
        "x_o2": _span([t.x_o2 for t in tests], "mole fraction"),
        "pressure_atm": _span([t.pressure_atm for t in tests], "atm", 2),
        "airflow_cm_s": ParameterRange(0.0, 0.0, "cm/s", "published"),
    }


def _cfi_envelope() -> dict[str, ParameterRange]:
    tests = psi_flight.load_cfi()
    return {
        "d0_mm": ParameterRange(2.0, 5.0, "mm", "approximate"),
        "x_o2": _span([t.x_o2 for t in tests], "mole fraction"),
        "pressure_atm": _span([t.pressure_atm for t in tests], "atm", 2),
        "airflow_cm_s": ParameterRange(0.0, 0.0, "cm/s", "published"),
    }


def _saffire_envelope() -> dict[str, ParameterRange]:
    flows = [s.airflow_cm_s for s in psi_flight.load_saffire() if s.airflow_cm_s is not None]
    return {
        "x_o2": ParameterRange(0.215, 0.221, "mole fraction", "flight_table"),
        "pressure_atm": ParameterRange(1.0, 1.0, "atm", "published"),
        "airflow_cm_s": _span(flows, "cm/s", 1),
    }


def _same_envelope() -> dict[str, ParameterRange]:
    runs = psi_flight.load_same_r()
    flows = [r.inlet_velocity_cm_s for r in runs if r.inlet_velocity_cm_s is not None]
    ages = [r.aging_time_s for r in runs if r.aging_time_s is not None]
    return {
        "airflow_cm_s": _span(flows, "cm/s", 1),
        "aging_time_s": _span(ages, "s", 0),
        "pressure_atm": ParameterRange(1.0, 1.0, "atm", "published"),
    }


def _build_experiments() -> dict[str, Experiment]:
    flex = [t for t in psi_flight.load_flex() if t.usable]
    cfi = psi_flight.load_cfi()
    saffire = psi_flight.load_saffire()
    rows = psi_flight.table_row_counts()

    def count(fragment: str) -> int:
        return sum(n for name, n in rows.items() if fragment in name)

    experiments = (
        Experiment(
            key="FLEX", name="FLEX", full_name="Flame Extinguishment Experiment",
            experiment_class="liquid_droplet", accessions=("PSI-69",),
            platform="ISS, Destiny laboratory",
            facility="Combustion Integrated Rack, Multi-user Droplet Combustion Apparatus",
            period="2009-2011",
            investigators="F.A. Williams (UC San Diego); D.L. Dietrich, V. Nayagam (NASA Glenn)",
            fuels=("n-heptane", "methanol"), model_fuels=("n-heptane", "methanol"),
            diluents=("N2", "CO2", "He"),
            geometry="Isolated free-floated or fibre-supported droplet in a quiescent sealed chamber",
            envelope=_flex_envelope(),
            findings=(
                "Large n-heptane droplets lose their visible hot flame to radiative extinction yet keep vaporising at a quasi-steady rate.",
                "The continued burning is sustained by a low-temperature (cool) flame that the colour cameras do not record.",
                "Methanol droplets absorb water from the flame and extinguish at a finite diameter that grows with initial size.",
            ),
            citations=("nayagam2012", "dietrich2014", "farouk2014"),
            flight_tests=len(flex),
        ),
        Experiment(
            key="FLEX-2", name="FLEX-2", full_name="Flame Extinguishment Experiment 2",
            experiment_class="liquid_droplet", accessions=("PSI-68",),
            platform="ISS, Destiny laboratory",
            facility="Combustion Integrated Rack, Multi-user Droplet Combustion Apparatus",
            period="2011-2014",
            investigators="F.A. Williams (UC San Diego) with C.T. Avedisian, M.Y. Choi, F.L. Dryer, B.D. Shaw; NASA Glenn",
            fuels=("iso-octane", "n-octane", "n-heptane", "n-decane", "ethanol", "binary mixtures"),
            model_fuels=("n-heptane", "n-decane"),
            diluents=("N2", "He"),
            geometry="Isolated droplets and droplet pairs; fibre translation provides a slow relative flow",
            # The PSI-68 table gives the matrix as ranges rather than per-test rows.
            envelope={
                "d0_mm": ParameterRange(1.5, 5.0, "mm", "flight_table"),
                "x_o2": ParameterRange(0.17, 0.30, "mole fraction", "flight_table"),
                "pressure_atm": ParameterRange(0.5, 3.0, "atm", "flight_table"),
                "airflow_cm_s": ParameterRange(0.0, 5.0, "cm/s", "flight_table"),
            },
            findings=(
                "Cool-flame burning recurs across normal alkanes and mixtures.",
                "At elevated pressure a cool flame can transition back to a hot flame.",
                "Slow convection of 0.1 to 5 cm/s alters flame shape and extinction relative to the quiescent limit.",
            ),
            citations=("dietrich2014", "nayagam2015"),
            flight_tests=count("Flex2"),
            notes="Matrix recorded as ranges per fuel in the PSI table.",
        ),
        Experiment(
            key="CFI", name="CFI", full_name="Cool Flames Investigation",
            experiment_class="liquid_droplet", accessions=("PSI-39",),
            platform="ISS, Destiny laboratory",
            facility="Combustion Integrated Rack, Multi-user Droplet Combustion Apparatus",
            period="2016-2017",
            investigators="F.A. Williams (UC San Diego); D.L. Dietrich (NASA Glenn)",
            fuels=tuple(sorted({t.fuel for t in cfi}))[:6],
            model_fuels=("n-decane", "n-dodecane"),
            diluents=("N2", "He"),
            geometry="Isolated droplets in a quiescent sealed chamber with cool-flame diagnostics",
            envelope=_cfi_envelope(),
            findings=(
                "Extended the cool-flame data set to n-dodecane and its blends, to helium dilution and to 3 atm.",
                "Cool-flame extinction diameter depends on pressure, oxygen and diluent.",
            ),
            citations=("nayagam2015", "dietrich2024"),
            flight_tests=len(cfi),
        ),
        Experiment(
            key="CFI-G", name="CFI-G", full_name="Cool Flames Investigation with Gases",
            experiment_class="gaseous", accessions=("PSI-159",),
            platform="ISS, Destiny laboratory",
            facility="Combustion Integrated Rack, ACME insert",
            period="2021-2022",
            investigators="P.B. Sunderland (University of Maryland)",
            fuels=("n-butane", "propane", "ethane"), model_fuels=(),
            diluents=("N2",),
            geometry="Spherical diffusion flame on a porous burner, normal and inverse configurations",
            envelope={
                "pressure_atm": ParameterRange(0.5, 3.3, "atm", "flight_table"),
                "x_o2": ParameterRange(0.15, 0.85, "mole fraction", "flight_table"),
            },
            findings=("First steady spherical gaseous cool diffusion flames observed without a heated oxidizer.",),
            citations=("kim2023",),
            flight_tests=count("CFI-G"),
        ),
        Experiment(
            key="BASS-II", name="BASS and BASS-II", full_name="Burning and Suppression of Solids",
            experiment_class="solid_fuel", accessions=("PSI-26", "PSI-25"),
            platform="ISS, Destiny laboratory",
            facility="Microgravity Science Glovebox, SPICE flow duct",
            period="2012-2017",
            investigators="S.L. Olson, P.V. Ferkul (NASA Glenn); S. Bhattacharjee; A.C. Fernandez-Pello; F.J. Miller; J.S. T'ien",
            fuels=("PMMA rods, slabs and spheres", "cotton-fiberglass fabric", "wax candle"),
            model_fuels=(), diluents=("N2",),
            geometry="Small solid samples in a low-speed duct, opposed and concurrent flow",
            envelope={
                "x_o2": ParameterRange(0.16, 0.222, "mole fraction", "flight_table"),
                "pressure_atm": ParameterRange(1.0, 1.0, "atm", "published"),
                "airflow_cm_s": ParameterRange(0.0, 40.0, "cm/s", "approximate"),
            },
            findings=(
                "Solid fuels burn at oxygen levels below their normal-gravity limits when the flow is slow.",
                "Flammability has a low-speed quenching branch and a high-speed blowoff branch.",
            ),
            citations=("olson2017",),
            flight_tests=count("BASS"),
        ),
        Experiment(
            key="SAFFIRE-I-III", name="Saffire I-III", full_name="Spacecraft Fire Safety Experiment I-III",
            experiment_class="solid_fuel", accessions=("PSI-98", "PSI-99", "PSI-100"),
            platform="Cygnus cargo vehicle after ISS departure",
            facility="Saffire flow duct",
            period="2016-2017",
            investigators="D.L. Urban, G.A. Ruff (NASA Glenn)",
            fuels=tuple(sorted({s.material for s in saffire})),
            model_fuels=(), diluents=("N2",),
            geometry="Large-scale concurrent and opposed flame spread in a ventilated duct",
            envelope=_saffire_envelope(),
            findings=(
                "Concurrent flame spread over a metre-scale cotton-fiberglass sheet reached a limiting length and steady rate.",
                "In Saffire-II, silicone did not sustain burning and Nomex did not propagate, in either gravity level.",
                "Thin PMMA spread faster in microgravity than in the matched normal-gravity test.",
            ),
            citations=("urban2019", "jomaas2015"),
            flight_tests=len(saffire),
        ),
        Experiment(
            key="SAFFIRE-IV-VI", name="Saffire IV-VI", full_name="Spacecraft Fire Safety Experiment IV-VI",
            experiment_class="solid_fuel", accessions=(),
            platform="Cygnus cargo vehicle after ISS departure",
            facility="Saffire flow duct with far-field diagnostics",
            period="2020-2024",
            investigators="D.L. Urban, G.A. Ruff (NASA Glenn)",
            fuels=("cotton-fiberglass", "PMMA", "Nomex"),
            model_fuels=(), diluents=("N2",),
            geometry="Large-scale flame spread at exploration atmospheres with post-fire cleanup",
            envelope={
                "x_o2": ParameterRange(0.21, 0.34, "mole fraction", "approximate"),
                "pressure_atm": ParameterRange(0.56, 1.0, "atm", "approximate"),
                "airflow_cm_s": ParameterRange(20.0, 30.0, "cm/s", "approximate"),
            },
            findings=("Oxygen-enriched, reduced-pressure exploration atmospheres increase flame spread rate and heat release.",),
            citations=("urban2019",),
            notes="No experimental table for these missions was found in PSI at retrieval time; ranges are indicative.",
        ),
        Experiment(
            key="SAME", name="SAME and SAME-R", full_name="Smoke Aerosol Measurement Experiment",
            experiment_class="smoke_aerosol", accessions=("PSI-102", "PSI-101"),
            platform="ISS, Destiny laboratory",
            facility="Microgravity Science Glovebox",
            period="2007 and 2010",
            investigators="D.L. Urban, G.A. Ruff (NASA Glenn); G.W. Mulholland; T. Cleary (NIST)",
            fuels=tuple(sorted({r.material for r in psi_flight.load_same_r()})),
            model_fuels=(), diluents=("N2",),
            geometry="Overheated material samples; smoke aged in a chamber and characterised by moment instruments",
            envelope=_same_envelope(),
            findings=(
                "Smoke particles from several spacecraft materials are larger in low gravity than in normal gravity.",
                "Neither ionization nor light-scattering detectors respond well across every material.",
                "Aging in stagnant conditions shifts the size distribution toward large aggregates.",
            ),
            citations=("meyer2015", "urban2008"),
            flight_tests=count("SAME"),
        ),
    )
    return {e.key: e for e in experiments}


EXPERIMENTS: dict[str, Experiment] = _build_experiments()

DROPLET_CAMPAIGNS: tuple[str, ...] = ("FLEX", "FLEX-2", "CFI")
ENVELOPE_DIMENSIONS: tuple[str, ...] = ("d0_mm", "x_o2", "pressure_atm", "airflow_cm_s")


def _air_tests(fuel: str) -> list[psi_flight.FlexTest]:
    return [
        t for t in psi_flight.load_flex()
        if t.usable and t.fuel == fuel and t.diluent_label == "N2"
        and abs(t.pressure_atm - 1.0) < 0.1 and abs(t.x_o2 - 0.21) < 0.011
    ]


@lru_cache(maxsize=1)
def benchmarks() -> tuple[Benchmark, ...]:
    """Reference ranges measured in FLEX tests in air at 1 atm."""
    out: list[Benchmark] = []
    for fuel, key in (("n-heptane", "heptane"), ("methanol", "methanol")):
        tests = _air_tests(fuel)
        rates = [t.burning_rate_mm2_s for t in tests if t.burning_rate_mm2_s]
        out.append(Benchmark(
            f"{key}_hot_k", "FLEX", f"Burning-rate constant, {fuel} in air", round(float(np.min(rates)), 3),
            round(float(np.max(rates)), 3), "mm^2/s", "1 atm, 21 % O2 in N2, quiescent", "flight_table", "PSI-69", len(rates),
        ))
    heptane = _air_tests("n-heptane")
    early = [float(t.d0_mm or 0.0) for t in heptane if t.extinction_diameter_mm and t.d0_mm and t.extinction_diameter_mm / t.d0_mm > 0.5]
    late = [float(t.d0_mm or 0.0) for t in heptane if t.extinction_diameter_mm is not None and t.d0_mm and t.extinction_diameter_mm / t.d0_mm <= 0.5]
    out.append(Benchmark(
        "heptane_rad_ext_d0", "FLEX", "Initial diameter separating complete burning from radiative extinction",
        round(max(late), 2), round(min(early), 2), "mm", "n-heptane, 1 atm, 21 % O2 in N2", "flight_table", "PSI-69", len(early) + len(late),
    ))
    ratios = [t.extinction_diameter_mm / t.d0_mm for t in heptane if t.extinction_diameter_mm and t.d0_mm and t.extinction_diameter_mm / t.d0_mm > 0.5]
    out.append(Benchmark(
        "heptane_rad_ext_ratio", "FLEX", "Visible-flame extinction diameter over initial diameter, large droplets",
        round(min(ratios), 3), round(max(ratios), 3), "-", "n-heptane, 1 atm, 21 % O2 in N2, D0 above 3.4 mm", "flight_table", "PSI-69", len(ratios),
    ))
    out.append(Benchmark(
        "heptane_cool_k", "FLEX", "Cool-flame burning-rate constant, n-heptane in air", 0.25, 0.45, "mm^2/s",
        "1 atm, 21 % O2 in N2, quiescent", "published", "nayagam2012",
    ))
    out.append(Benchmark(
        "heptane_cool_ext_d", "FLEX", "Cool-flame extinction diameter, n-heptane in air", 0.9, 1.6, "mm",
        "1 atm, 21 % O2 in N2, quiescent, D0 near 3.9 mm", "published", "nayagam2012",
    ))
    return tuple(out)


BENCHMARKS: tuple[Benchmark, ...] = benchmarks()


def nearest_campaign(fuel: str, airflow_cm_s: float) -> Experiment:
    """Droplet campaign whose configuration is closest to a simulated case."""
    if airflow_cm_s > 0.0:
        return EXPERIMENTS["FLEX-2"]
    for key in DROPLET_CAMPAIGNS:
        if fuel in EXPERIMENTS[key].model_fuels:
            return EXPERIMENTS[key]
    return EXPERIMENTS["FLEX"]


def datasets() -> list[dict[str, object]]:
    """PSI investigations held locally, with DOI, license and table sizes."""
    rows = psi_flight.table_row_counts()
    out: list[dict[str, object]] = []
    for accession, entry in psi_flight.manifest()["investigations"].items():  # type: ignore[union-attr]
        record = psi_flight.investigation(accession)
        tables = [{"file": t["file"], "rows": rows.get(t["file"], 0), "sha256": t["sha256"]} for t in entry["tables"]]
        out.append({
            "accession": accession,
            "key": entry["key"],
            "title": entry["title"] or record.get("proposalTitle", ""),
            "doi": entry["doi"],
            "doi_url": f"https://doi.org/{entry['doi']}" if entry["doi"] else "",
            "license": entry["license"],
            "landing_page": entry["landing_page"],
            "hardware": record.get("experimentHardware", ""),
            "start": record.get("investigationStartDate", ""),
            "end": record.get("investigationEndDate", ""),
            "objective": record.get("objective", ""),
            "tables": tables,
            "rows": sum(int(t["rows"]) for t in tables),
        })
    return out


def provenance(fuel: str, d0_mm: float, x_o2: float, pressure_atm: float, airflow_cm_s: float) -> dict[str, object]:
    """Metadata block attached to every simulated telemetry record."""
    exp = nearest_campaign(fuel, airflow_cm_s)
    values = {"d0_mm": d0_mm, "x_o2": x_o2, "pressure_atm": pressure_atm, "airflow_cm_s": airflow_cm_s}
    inside = {
        dim: exp.envelope[dim].low - 1e-9 <= values[dim] <= exp.envelope[dim].high + 1e-9
        for dim in ENVELOPE_DIMENSIONS
    }
    manifest = psi_flight.manifest()["investigations"]
    accession = exp.accessions[0] if exp.accessions else ""
    dataset = manifest.get(accession, {}) if accession else {}  # type: ignore[union-attr]
    return {
        "source": "model",
        "model": "IGNIS-SI reduced-order droplet combustion solver, calibrated to the FLEX flight table",
        "reference_experiment": exp.key,
        "reference_experiment_name": exp.full_name,
        "facility": exp.facility,
        "platform": exp.platform,
        "period": exp.period,
        "accession": accession,
        "dataset_doi": dataset.get("doi", ""),
        "dataset_url": dataset.get("landing_page", ""),
        "dataset_license": dataset.get("license", ""),
        "flight_tests": exp.flight_tests,
        "fuel_tested_in_reference": fuel in exp.model_fuels,
        "within_reference_envelope": inside,
        "citations": [{**asdict(CITATIONS[c]), "url": CITATIONS[c].url} for c in exp.citations],
        "repository": PSI_URL,
    }


def corpus_as_dict() -> dict[str, object]:
    return {
        "repository": PSI_URL,
        "retrieved_utc": psi_flight.manifest()["retrieved_utc"],
        "disclaimer": (
            "Test matrices and measured burning rates, extinction diameters and burn times are NASA PSI flight data. "
            "Time series shown in this application are model output, not flight data."
        ),
        "experiments": [asdict(e) for e in EXPERIMENTS.values()],
        "datasets": datasets(),
        "benchmarks": [asdict(b) for b in BENCHMARKS],
        "citations": [{**asdict(c), "url": c.url} for c in CITATIONS.values()],
    }
