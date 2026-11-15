"use client";

import { COLORS, STATUS_COLOR, sentenceCase } from "@/lib/regimes";
import type { Assessment, DimensionCheck, Simulation } from "@/lib/types";

import { Panel, Skeleton, Tag, Term } from "./ui";

const DIMENSION_DIGITS: Record<string, number> = { d0_mm: 1, x_o2: 2, pressure_atm: 2, airflow_cm_s: 1 };
const DISAGREEMENT_WARN = 0.4;

/** Where the query sits relative to the range that was flown. */
function RangeBar({ d }: { d: DimensionCheck }) {
  const span = Math.max(d.tested_high - d.tested_low, 1e-6);
  const lo = Math.min(d.tested_low, d.value) - 0.12 * span;
  const hi = Math.max(d.tested_high, d.value) + 0.12 * span;
  const pct = (v: number): number => ((v - lo) / (hi - lo)) * 100;
  return (
    <div className="relative h-3" aria-hidden="true">
      <div className="absolute inset-x-0 top-[5.5px] h-px bg-line-strong" />
      <div
        className="absolute top-[4px] h-1 rounded-[1px] bg-muted"
        style={{ left: `${pct(d.tested_low)}%`, width: `${pct(d.tested_high) - pct(d.tested_low)}%` }}
      />
      <div
        className="absolute top-0 h-3 w-0.5 -translate-x-1/2"
        style={{ left: `${pct(d.value)}%`, backgroundColor: d.inside ? COLORS.fg : COLORS.critical }}
      />
    </div>
  );
}

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
      title="Evidence"
      subtitle="Is this prediction backed by flight data?"
      highlight={highlight}
      className="h-full"
      right={assessment ? <Tag color={STATUS_COLOR[assessment.verdict]}>{sentenceCase(assessment.verdict)}</Tag> : null}
      bodyClassName="thin-scroll overflow-y-auto"
    >
      {prov ? (
        <div data-testid="citation-inspector" className="text-[12px]">
          <div className="border-b border-line px-3.5 py-3">
            {assessment ? (
              <p className="text-[13px] font-medium leading-snug text-fg">{assessment.summary}</p>
            ) : (
              <Skeleton lines={2} />
            )}
            <p className="mt-1.5 leading-snug text-muted">
              Every curve in this workbench is <span className="font-medium text-warning">model output</span>, not a
              flight measurement. {prov.fuel_tested_in_reference ? "This fuel was" : "This fuel was not"} flown in the
              reference campaign.
            </p>
          </div>

          {assessment ? (
            <div className="border-b border-line px-3.5 py-3">
              <div className="mb-2 flex items-baseline justify-between">
                <span className="label">
                  Your scenario against the <Term k="envelope">tested range</Term>
                </span>
              </div>
              <div className="grid grid-cols-[104px_40px_minmax(0,1fr)_50px] items-start gap-x-2.5 gap-y-1">
                {assessment.dimensions.map((d) => {
                  const digits = DIMENSION_DIGITS[d.dimension] ?? 2;
                  return (
                    <div key={d.dimension} className="contents">
                      <span className="truncate text-muted">{d.label}</span>
                      <span className="num text-right text-fg">{d.value.toFixed(digits)}</span>
                      <div>
                        <RangeBar d={d} />
                        <div className="num text-center text-[10px] leading-4 text-faint">
                          flown {d.tested_low.toFixed(digits)} to {d.tested_high.toFixed(digits)}
                        </div>
                      </div>
                      <span
                        className="text-right text-[11px] font-medium"
                        style={{ color: d.inside ? COLORS.nominal : COLORS.critical }}
                      >
                        {d.inside ? "Inside" : "Outside"}
                      </span>
                    </div>
                  );
                })}
              </div>
              {assessment.model_disagreement !== null ? (
                <div className="mt-2.5 flex items-baseline justify-between border-t border-line pt-2.5">
                  <span className="text-muted">
                    <Term k="ensemble">Model disagreement</Term> across <span className="num">{assessment.ensemble_size}</span>{" "}
                    runs
                  </span>
                  <span
                    className="num text-[13px]"
                    style={{ color: assessment.model_disagreement > DISAGREEMENT_WARN ? COLORS.warning : COLORS.fg }}
                  >
                    {assessment.model_disagreement.toFixed(2)}
                  </span>
                </div>
              ) : null}
            </div>
          ) : null}

          {assessment && assessment.nearest_tests.length ? (
            <div className="border-b border-line px-3.5 py-3" data-testid="nearest-flight-test">
              <div className="label mb-2">Closest NASA flight test</div>
              {(() => {
                const t = assessment.nearest_tests[0];
                const modelRate = sim?.summary.mean_hot_burning_rate_mm2_s ?? null;
                return (
                  <>
                    <p className="leading-snug text-fg">
                      FLEX test <span className="num">{t.identifier}</span>, <span className="num">{t.date}</span>: {t.fuel},{" "}
                      <span className="num">{t.d0_mm.toFixed(2)}</span> mm, <span className="num">{(t.x_o2 * 100).toFixed(0)}</span> % oxygen,{" "}
                      <span className="num">{t.pressure_atm.toFixed(2)}</span> atm.
                      {t.same_fuel ? "" : " A different fuel from your scenario."}
                    </p>
                    <div className="mt-2 grid grid-cols-3 gap-2">
                      <div>
                        <div className="text-[11px] text-muted">Burning rate, flight</div>
                        <div className="num text-fg">{t.burning_rate_mm2_s?.toFixed(2) ?? "--"} <span className="text-[11px] text-muted">mm²/s</span></div>
                      </div>
                      <div>
                        <div className="text-[11px] text-muted">Burning rate, model</div>
                        <div className="num text-warning">{modelRate?.toFixed(2) ?? "--"} <span className="text-[11px] text-muted">mm²/s</span></div>
                      </div>
                      <div>
                        <div className="text-[11px] text-muted">Flight outcome</div>
                        <div className="text-fg">
                          {t.extinction_ratio !== null ? (
                            <>flame out at <span className="num">{(t.extinction_ratio * 100).toFixed(0)}</span> %</>
                          ) : (
                            t.test_end.toLowerCase()
                          )}
                        </div>
                      </div>
                    </div>
                  </>
                );
              })()}
            </div>
          ) : null}

          <div className="border-b border-line px-3.5 py-3">
            <div className="label mb-2">Reference experiment</div>
            <dl className="grid grid-cols-[72px_minmax(0,1fr)] gap-x-2.5 gap-y-1 leading-snug">
              <dt className="text-muted">Campaign</dt>
              <dd className="text-fg">
                {prov.reference_experiment_name} <span className="text-muted">({prov.reference_experiment})</span>
              </dd>
              <dt className="text-muted">Facility</dt>
              <dd className="text-fg">{prov.facility.replace(/\s+\/\s+/g, ", ")}</dd>
              <dt className="text-muted">Flown</dt>
              <dd className="text-fg">
                {prov.platform}, <span className="num">{prov.period}</span>
              </dd>
              {prov.dataset_doi ? (
                <>
                  <dt className="text-muted">Dataset</dt>
                  <dd>
                    <a href={`https://doi.org/${prov.dataset_doi}`} target="_blank" rel="noreferrer" className="num text-uv underline-offset-2 hover:underline">
                      {prov.dataset_doi}
                    </a>{" "}
                    <span className="text-muted">NASA {prov.accession}, <span className="num">{prov.flight_tests}</span> tests, {prov.dataset_license}</span>
                  </dd>
                </>
              ) : null}
            </dl>
          </div>

          <div className="px-3.5 py-3">
            <div className="label mb-2">Sources</div>
            <ul className="space-y-2">
              {prov.citations.map((c) => (
                <li key={c.key} className="leading-snug">
                  <span className="text-fg">{c.title}.</span>{" "}
                  <span className="text-muted">
                    {c.authors.split(",")[0]} et al., {c.venue} (<span className="num">{c.year}</span>).
                  </span>{" "}
                  <a href={c.url} target="_blank" rel="noreferrer" className="num text-uv underline-offset-2 hover:underline">
                    {c.doi}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : (
        <Skeleton lines={7} className="px-3.5 py-3" />
      )}
    </Panel>
  );
}
