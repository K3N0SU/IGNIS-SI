"""Download investigation records and experimental tables from NASA PSI.

Source: NASA Physical Sciences Informatics repository, https://psi.nasa.gov.
For each investigation the public repository API returns a metadata record
(title, objective, hardware, license, DOI, publications) and lists one or
more "experimental table" CSV files summarising every test point. Both are
stored unmodified under ``data/psi/`` together with a manifest recording the
source URL, retrieval time, byte count and SHA-256 of every file.

Usage:  python -m data.fetch_psi [--force]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

PSI_ORIGIN = "https://psi.nasa.gov"
RECORD_URL = PSI_ORIGIN + "/geode-py/ws/repo/investigations/{accession}"
FILE_URL = PSI_ORIGIN + "/geode-py/ws/studies/{accession}/download?source=datamanager&file={name}"
LANDING_URL = PSI_ORIGIN + "/physci/repo/data/investigations/{accession}"

PSI_DIR = Path(__file__).resolve().parent / "psi"
MANIFEST_PATH = PSI_DIR / "manifest.json"

# Accession -> short key used throughout the application.
INVESTIGATIONS: dict[str, str] = {
    "PSI-69": "FLEX",
    "PSI-68": "FLEX-2",
    "PSI-39": "CFI",
    "PSI-159": "CFI-G",
    "PSI-26": "BASS",
    "PSI-25": "BASS-II",
    "PSI-98": "SAFFIRE-I",
    "PSI-99": "SAFFIRE-II",
    "PSI-100": "SAFFIRE-III",
    "PSI-102": "SAME",
    "PSI-101": "SAME-R",
}

_HEADERS = {"User-Agent": "ignis-si-data-fetch/1.0", "Accept": "*/*"}


def _get(url: str, attempts: int = 4) -> bytes:
    last: Exception | None = None
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=_HEADERS), timeout=90) as response:
                return response.read()
        except (urllib.error.URLError, TimeoutError, OSError) as err:
            last = err
            time.sleep(2.0 * (attempt + 1))
    raise RuntimeError(f"Could not retrieve {url}: {last}")


def _slim_record(record: dict[str, object]) -> dict[str, object]:
    """Keep the descriptive fields; drop bulky file listings and internal ids."""
    keep = (
        "accession", "title", "investigationAcronym", "doi", "licenseIdentifier", "licenseName", "licenseLink",
        "objective", "hypothesis", "approach", "results", "description", "experimentHardware", "flightProgram",
        "managingNasaCenter", "investigationStartDate", "investigationEndDate", "proposalTitle", "projectType",
        "modifiedDate", "funding", "version",
    )
    slim: dict[str, object] = {k: record.get(k) for k in keep if record.get(k) not in (None, "", [])}
    slim["contacts"] = [
        {
            "name": " ".join(str(c.get(k, "")).strip() for k in ("firstName", "midInitials", "lastName")).replace("  ", " ").strip(),
            "affiliation": c.get("affiliation", ""),
            "roles": [r.get("annotationValue", "") for r in c.get("roles", [])],
        }
        for c in record.get("contacts", [])  # type: ignore[union-attr]
    ]
    slim["publications"] = [
        {"title": p.get("title", ""), "authors": p.get("authorList", ""), "doi": p.get("doi", "")}
        for p in record.get("publications", [])  # type: ignore[union-attr]
    ]
    slim["experimental_tables"] = [t.get("file_name", "") for t in record.get("experimentalTable", [])]  # type: ignore[union-attr]
    return slim


def fetch(force: bool = False) -> dict[str, object]:
    PSI_DIR.mkdir(parents=True, exist_ok=True)
    if MANIFEST_PATH.exists() and not force:
        return json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))

    manifest: dict[str, object] = {
        "repository": "NASA Physical Sciences Informatics (PSI)",
        "origin": PSI_ORIGIN,
        "retrieved_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "investigations": {},
    }
    entries: dict[str, object] = manifest["investigations"]  # type: ignore[assignment]

    for accession, key in INVESTIGATIONS.items():
        record_url = RECORD_URL.format(accession=accession)
        record = json.loads(_get(record_url))
        slim = _slim_record(record)
        (PSI_DIR / f"{accession}.json").write_text(json.dumps(slim, indent=1, ensure_ascii=False), encoding="utf-8")

        files: list[dict[str, object]] = []
        for table in record.get("experimentalTable", []):
            name = str(table.get("file_name", ""))
            if not name.lower().endswith(".csv") or table.get("restricted"):
                continue
            url = FILE_URL.format(accession=accession, name=urllib.parse.quote(name))
            raw = _get(url)
            (PSI_DIR / name).write_bytes(raw)
            files.append({"file": name, "url": url, "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()})

        entries[accession] = {
            "key": key,
            "title": slim.get("title", ""),
            "doi": slim.get("doi", ""),
            "license": slim.get("licenseIdentifier", ""),
            "landing_page": LANDING_URL.format(accession=accession),
            "record_url": record_url,
            "tables": files,
        }
        print(f"{accession:8s} {key:12s} tables={len(files)} doi={slim.get('doi', '')} license={slim.get('licenseIdentifier', '')}")
        time.sleep(0.5)

    MANIFEST_PATH.write_text(json.dumps(manifest, indent=1), encoding="utf-8")
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--force", action="store_true", help="download again even if a manifest exists")
    fetch(parser.parse_args().force)


if __name__ == "__main__":
    main()
