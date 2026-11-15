"use client";

import { COLORS, STATUS_COLOR } from "@/lib/regimes";
import type { Assessment, Simulation } from "@/lib/types";

import { Panel, Tag } from "./ui";

const DIMENSION_DIGITS: Record<string, number> = { d0_mm: 1, x_o2: 2, pressure_atm: 2, airflow_cm_s: 1 };

export function CitationInspector({
  sim,
  assessment,
  highlight,
}: {
  sim: Simulation | null;
  assessment: Assessment | null;
  highlight?: boolean;
}) {
  const prov = sim?.provenance;
  return (
    <Panel
      title="PSI citation inspector"
      highlight={highlight}
      className="h-full"
      right={assessment ? <Tag color={STATUS_COLOR[assessment.verdict]}>{assessment.verdict.replace("_", " ")}</Tag> : null}
      bodyClassName="thin-scroll overflow-y-auto"
    >
      {prov ? (
        <div data-testid="citation-inspector" className="text-[11px]">
          <div className="grid grid-cols-[92px_1fr] gap-x-2 gap-y-1 border-b border-line px-3 py-2">
            <span className="text-muted">Reference</span>
            <span className="text-fg">
              <span className="num font-semibold">{prov.reference_experiment}</span> {prov.reference_experiment_name}
            </span>
            <span className="text-muted">Facility</span>
            <span className="text-fg">{prov.facility}</span>
            <span className="text-muted">Platform</span>
            <span className="text-fg">
              {prov.platform}, <span className="num">{prov.period}</span>
            </span>
            <span className="text-muted">Telemetry</span>
            <span className="text-fg">
              <span className="num font-semibold text-warning">MODEL OUTPUT</span>, not flight data. Fuel{" "}
              {prov.fuel_tested_in_reference ? "flown" : "not flown"} in this campaign.
            </span>
          </div>

          {assessment ? (
            <div className="border-b border-line px-3 py-2">
              <p className="leading-snug text-fg">{assessment.summary}</p>
              <table className="mt-2 w-full">
                <thead>
                  <tr className="label text-left">
                    <th className="pb-1 font-semibold">Parameter</th>
                    <th className="pb-1 text-right font-semibold">Query</th>
                    <th className="pb-1 text-right font-semibold">Flown range</th>
                    <th className="pb-1 text-right font-semibold">State</th>
                  </tr>
                </thead>
                <tbody>
                  {assessment.dimensions.map((d) => {
                    const digits = DIMENSION_DIGITS[d.dimension] ?? 2;
                    return (
                      <tr key={d.dimension}>
                        <td className="py-px text-muted">{d.label}</td>
                        <td className="num py-px text-right text-fg">{d.value.toFixed(digits)}</td>
                        <td className="num py-px text-right text-muted">
                          {d.tested_low.toFixed(digits)} - {d.tested_high.toFixed(digits)}
                        </td>
                        <td
                          className="num py-px text-right text-[10px] font-semibold"
                          style={{ color: d.inside ? COLORS.nominal : COLORS.critical }}
                        >
                          {d.inside ? "INSIDE" : "OUTSIDE"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {assessment.model_disagreement !== null ? (
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-muted">
                    Calibration-ensemble disagreement (n = <span className="num">{assessment.ensemble_size}</span>)
                  </span>
                  <span
                    className="num font-semibold"
                    style={{ color: assessment.model_disagreement > 0.4 ? COLORS.warning : COLORS.fg }}
                  >
                    {assessment.model_disagreement.toFixed(2)}
                  </span>
                </div>
              ) : null}
            </div>
          ) : null}

          <ul className="px-3 py-2">
            {prov.citations.map((c) => (
              <li key={c.key} className="mb-1.5 leading-snug last:mb-0">
                <span className="text-fg">{c.title}.</span>{" "}
                <span className="text-muted">
                  {c.authors.split(",")[0]} et al., {c.venue} (<span className="num">{c.year}</span>).
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="px-3 py-2 text-[11px] text-muted">Waiting for solver.</p>
      )}
    </Panel>
  );
}
