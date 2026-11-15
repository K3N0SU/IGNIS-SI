"use client";

import { type RefObject, useEffect, useMemo, useRef, useState } from "react";

import { api } from "@/lib/api";
import { COLORS } from "@/lib/regimes";
import type {
  Assessment,
  ChamberQuery,
  FlexValidation,
  FlightComparison,
  FuelMetrics,
  SaffireSample,
  Simulation,
} from "@/lib/types";

import { InvestigationsPanel } from "./InvestigationsPanel";
import { Panel, Segmented, Skeleton, Stat } from "./ui";

type FuelFilter = "all" | "n-heptane" | "methanol";
type Outcome = "early" | "late" | "unknown";

const OUTCOME: Record<Outcome, { label: string; color: string }> = {
  early: { label: "Visible flame lost early", color: COLORS.uv },
  late: { label: "Burned most of the fuel", color: COLORS.warning },
  unknown: { label: "Extinction diameter not recorded", color: COLORS.faint },
};

function outcomeOf(t: FlightComparison): Outcome {
  if (t.early_extinction_flight === null) return "unknown";
  return t.early_extinction_flight ? "early" : "late";
}

function useSize<T extends HTMLElement>(): [RefObject<T | null>, { width: number; height: number }] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setSize({ width: el.clientWidth, height: el.clientHeight }));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, size];
}

function ticks(low: number, high: number, step: number): number[] {
  const out: number[] = [];
  for (let v = Math.ceil(low / step) * step; v <= high + 1e-9; v += step) out.push(Math.round(v * 1000) / 1000);
  return out;
}

function TestMatrix({
  tests,
  query,
  neighbours,
  onSelect,
  selected,
}: {
  tests: FlightComparison[];
  query: ChamberQuery;
  neighbours: Set<string>;
  onSelect: (t: FlightComparison | null) => void;
  selected: FlightComparison | null;
}) {
  const [ref, size] = useSize<HTMLDivElement>();
  const W = Math.max(size.width, 200);
  const H = Math.max(size.height, 120);
  const M = { l: 44, r: 14, t: 10, b: 34 };
  const x = (d: number): number => M.l + ((d - 1) / 4) * (W - M.l - M.r);
  const y = (o: number): number => H - M.b - ((o - 10) / 26) * (H - M.t - M.b);

  return (
    <div ref={ref} className="relative h-full w-full" data-testid="flight-matrix">
      {size.width > 0 ? (
        <svg width={W} height={H} className="block" role="img" aria-label="FLEX flight tests by droplet diameter and oxygen">
          {ticks(1, 5, 1).map((d) => (
            <g key={`x${d}`}>
              <line x1={x(d)} x2={x(d)} y1={M.t} y2={H - M.b} stroke={COLORS.line} />
              <text x={x(d)} y={H - M.b + 14} textAnchor="middle" className="num" fontSize={10} fill={COLORS.muted}>
                {d}
              </text>
            </g>
          ))}
          {ticks(10, 36, 5).map((o) => (
            <g key={`y${o}`}>
              <line x1={M.l} x2={W - M.r} y1={y(o)} y2={y(o)} stroke={COLORS.line} />
              <text x={M.l - 7} y={y(o) + 3} textAnchor="end" className="num" fontSize={10} fill={COLORS.muted}>
                {o}
              </text>
            </g>
          ))}
          <text x={(W + M.l - M.r) / 2} y={H - 4} textAnchor="middle" fontSize={11} fill={COLORS.muted}>
            Initial droplet diameter, mm
          </text>
          <text x={12} y={(H - M.b + M.t) / 2} textAnchor="middle" fontSize={11} fill={COLORS.muted} transform={`rotate(-90 12 ${(H - M.b + M.t) / 2})`}>
            Oxygen, % by volume
          </text>
          {tests.map((t) => {
            const near = neighbours.has(t.identifier);
            const style = OUTCOME[outcomeOf(t)];
            const isSelected = selected?.test_number === t.test_number;
            return (
              <circle
                key={t.test_number}
                cx={x(t.d0_mm)}
                cy={y(t.x_o2 * 100)}
                r={near || isSelected ? 5 : 3.2}
                fill={style.color}
                fillOpacity={near || isSelected ? 1 : 0.62}
                stroke={near || isSelected ? COLORS.fg : "none"}
                strokeWidth={1.4}
                className="cursor-pointer"
                onMouseEnter={() => onSelect(t)}
                onFocus={() => onSelect(t)}
                tabIndex={near ? 0 : -1}
              >
                <title>{`FLEX ${t.identifier}, ${t.d0_mm} mm, ${(t.x_o2 * 100).toFixed(0)} % O2`}</title>
              </circle>
            );
          })}
          <g pointerEvents="none">
            <line x1={x(query.d0_mm)} x2={x(query.d0_mm)} y1={M.t} y2={H - M.b} stroke={COLORS.fg} strokeDasharray="2 4" strokeWidth={0.8} />
            <line x1={M.l} x2={W - M.r} y1={y(query.x_o2 * 100)} y2={y(query.x_o2 * 100)} stroke={COLORS.fg} strokeDasharray="2 4" strokeWidth={0.8} />
            <rect x={x(query.d0_mm) - 6} y={y(query.x_o2 * 100) - 6} width={12} height={12} fill="none" stroke={COLORS.fg} strokeWidth={1.6} />
            <text x={x(query.d0_mm) + 11} y={y(query.x_o2 * 100) - 9} fontSize={11} fill={COLORS.fg}>
              Your scenario
            </text>
          </g>
        </svg>
      ) : null}
    </div>
  );
}

function Parity({
  tests,
  pick,
  max,
  step,
  label,
  digits,
}: {
  tests: FlightComparison[];
  pick: (t: FlightComparison) => [number | null, number | null];
  max: number;
  step: number;
  label: string;
  digits: number;
}) {
  const [ref, size] = useSize<HTMLDivElement>();
  const S = Math.max(Math.min(size.width, size.height), 120);
  const M = { l: 40, r: 10, t: 8, b: 32 };
  const p = (v: number): number => (Math.min(Math.max(v, 0), max) / max) * (S - M.l - M.r);
  const points = useMemo(
    () =>
      tests
        .map((t) => ({ t, v: pick(t) }))
        .filter((d): d is { t: FlightComparison; v: [number, number] } => d.v[0] !== null && d.v[1] !== null && d.t.model_ignited),
    [tests, pick],
  );
  return (
    <div ref={ref} className="flex h-full w-full items-center justify-center">
      {size.width > 0 ? (
        <svg width={S} height={S} role="img" aria-label={`Model against flight, ${label}`}>
          {ticks(0, max, step).map((v) => (
            <g key={v}>
              <line x1={M.l + p(v)} x2={M.l + p(v)} y1={M.t} y2={S - M.b} stroke={COLORS.line} />
              <line x1={M.l} x2={S - M.r} y1={S - M.b - p(v)} y2={S - M.b - p(v)} stroke={COLORS.line} />
              <text x={M.l + p(v)} y={S - M.b + 13} textAnchor="middle" className="num" fontSize={10} fill={COLORS.muted}>
                {v.toFixed(digits)}
              </text>
              <text x={M.l - 6} y={S - M.b - p(v) + 3} textAnchor="end" className="num" fontSize={10} fill={COLORS.muted}>
                {v.toFixed(digits)}
              </text>
            </g>
          ))}
          <line x1={M.l} y1={S - M.b} x2={S - M.r} y2={M.t} stroke={COLORS.muted} strokeDasharray="3 3" />
          {points.map(({ t, v }) => (
            <circle
              key={t.test_number}
              cx={M.l + p(v[0])}
              cy={S - M.b - p(v[1])}
              r={2.6}
              fill={t.fuel === "methanol" ? COLORS.nominal : COLORS.warning}
              fillOpacity={0.7}
            />
          ))}
          <text x={(S + M.l - M.r) / 2} y={S - 3} textAnchor="middle" fontSize={11} fill={COLORS.muted}>
            Measured on the ISS
          </text>
          <text x={11} y={(S - M.b + M.t) / 2} textAnchor="middle" fontSize={11} fill={COLORS.muted} transform={`rotate(-90 11 ${(S - M.b + M.t) / 2})`}>
            Model
          </text>
        </svg>
      ) : null}
    </div>
  );
}

function burnLength(raw: string): string {
  const text = raw.replace(/\(note \d+\)/gi, "").replace(/~/g, "").replace(/\s+/g, " ").trim();
  if (/^0\b/.test(text) && !/&/.test(text)) return "did not burn";
  return `burned ${text.replace("&", "and")}`;
}

function pct(v: number | null | undefined): string {
  return v === null || v === undefined ? "--" : `${(v * 100).toFixed(0)} %`;
}

function MetricRow({ label, before, after, lowerIsBetter = true }: { label: string; before: string; after: string; lowerIsBetter?: boolean }) {
  const improved = lowerIsBetter ? parseFloat(after) < parseFloat(before) : parseFloat(after) > parseFloat(before);
  return (
    <tr className="border-b border-line/60 last:border-b-0">
      <td className="py-1.5 pr-3 text-muted">{label}</td>
      <td className="num py-1.5 text-right text-muted">{before}</td>
      <td className="num py-1.5 pl-4 text-right" style={{ color: improved ? COLORS.nominal : COLORS.fg }}>
        {after}
      </td>
    </tr>
  );
}

const pickRate = (t: FlightComparison): [number | null, number | null] => [t.k_flight, t.k_model];
const pickRatio = (t: FlightComparison): [number | null, number | null] => [t.ext_ratio_flight, t.ext_ratio_model];

export function FlightDataView({
  query,
  sim,
  assessment,
}: {
  query: ChamberQuery;
  sim: Simulation | null;
  assessment: Assessment | null;
}) {
  const [flex, setFlex] = useState<FlexValidation | null>(null);
  const [saffire, setSaffire] = useState<SaffireSample[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [fuel, setFuel] = useState<FuelFilter>("all");
  const [hovered, setHovered] = useState<FlightComparison | null>(null);

  useEffect(() => {
    const ctl = new AbortController();
    Promise.all([api.flex(ctl.signal), api.saffire(ctl.signal)])
      .then(([f, s]) => {
        setFlex(f);
        setSaffire(s.samples);
      })
      .catch(() => {
        if (!ctl.signal.aborted) setFailed(true);
      });
    return () => ctl.abort();
  }, []);

  const tests = useMemo(() => (flex ? flex.tests.filter((t) => fuel === "all" || t.fuel === fuel) : []), [flex, fuel]);
  const neighbours = useMemo(() => new Set((assessment?.nearest_tests ?? []).map((t) => t.identifier)), [assessment]);
  const fit = flex?.calibration ?? null;
  const before: FuelMetrics | null = fit ? fit.metrics.baseline_holdout.all : null;
  const after: FuelMetrics | null = fit ? fit.metrics.fitted_holdout.all : (flex?.metrics.all ?? null);
  const nearest = assessment?.nearest_tests ?? [];
  const modelRate = sim?.summary.mean_hot_burning_rate_mm2_s ?? null;

  if (failed) {
    return (
      <div className="flex h-full items-center justify-center text-[13px] text-muted" role="alert">
        Flight data could not be loaded from the simulation service.
      </div>
    );
  }

  return (
    <div className="grid h-full min-h-0 grid-cols-12 grid-rows-[minmax(0,1.2fr)_minmax(0,1fr)] gap-2" data-testid="flight-view">
      <Panel
        className="col-span-5"
        title="FLEX flight tests"
        subtitle={flex ? `${flex.tests.length} droplet burns on the ISS, 2009 to 2011` : "Loading NASA flight table"}
        bodyClassName="flex flex-col"
        right={
          <Segmented<FuelFilter>
            size="sm"
            ariaLabel="Fuel"
            value={fuel}
            onChange={setFuel}
            options={[
              { value: "all", label: "All" },
              { value: "n-heptane", label: "n-Heptane" },
              { value: "methanol", label: "Methanol" },
            ]}
          />
        }
      >
        <p className="shrink-0 px-3.5 pt-2.5 text-[12px] leading-snug text-muted">
          Every dot is a real droplet burned in the Combustion Integrated Rack. Outlined dots are the tests closest to your scenario.
        </p>
        <div className="min-h-0 flex-1 px-2 pt-1">
          {flex ? (
            <TestMatrix tests={tests} query={query} neighbours={neighbours} onSelect={setHovered} selected={hovered} />
          ) : (
            <Skeleton lines={6} className="p-3" />
          )}
        </div>
        <div className="flex h-12 shrink-0 items-center justify-between gap-4 border-t border-line px-3.5">
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {(Object.keys(OUTCOME) as Outcome[]).map((k) => (
              <span key={k} className="flex items-center gap-1.5 text-[11px] text-muted">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: OUTCOME[k].color }} />
                {OUTCOME[k].label}
              </span>
            ))}
          </div>
          {hovered ? (
            <span className="num shrink-0 text-[11px] text-fg">
              {hovered.identifier} <span className="text-muted">K</span> {hovered.k_flight?.toFixed(2) ?? "--"}{" "}
              <span className="text-muted">mm²/s</span>
            </span>
          ) : null}
        </div>
      </Panel>

      <Panel
        className="col-span-4"
        title="Model against flight"
        subtitle="Each point is one flight test"
        bodyClassName="flex flex-col"
        right={
          <span className="flex items-center gap-3 text-[11px] text-muted">
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-warning" />n-Heptane</span>
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-nominal" />Methanol</span>
          </span>
        }
      >
        <div className="grid min-h-0 flex-1 grid-cols-2 gap-1 px-2 pt-2" data-testid="parity">
          <div className="flex min-h-0 flex-col">
            <div className="px-2 text-[11.5px] text-fg">Burning rate, mm²/s</div>
            <div className="min-h-0 flex-1">{flex ? <Parity tests={tests} pick={pickRate} max={1.2} step={0.4} label="burning rate" digits={1} /> : null}</div>
          </div>
          <div className="flex min-h-0 flex-col">
            <div className="px-2 text-[11.5px] text-fg">Extinction diameter over initial</div>
            <div className="min-h-0 flex-1">{flex ? <Parity tests={tests} pick={pickRatio} max={1} step={0.25} label="extinction diameter" digits={2} /> : null}</div>
          </div>
        </div>
        <p className="shrink-0 border-t border-line px-3.5 py-2 text-[11.5px] leading-snug text-muted">
          Points on the dashed line are tests the model reproduces exactly. Scatter away from it is the model&apos;s error.
        </p>
      </Panel>

      <Panel className="col-span-3" title="Calibration" subtitle="Fitted to flight data, checked on tests it never saw" bodyClassName="thin-scroll overflow-y-auto px-3.5 py-3">
        {after ? (
          <div className="text-[12px]" data-testid="calibration">
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Held-out tests" value={String(fit?.holdout_tests ?? flex?.metrics.tests_compared ?? 0)} />
              <Stat label="Extinction size reproduced" value={pct(after.extinction_within_tolerance)} color={COLORS.nominal} />
            </div>
            <table className="mt-3 w-full">
              <thead>
                <tr className="border-b border-line text-left text-[11px] text-muted">
                  <th className="pb-1.5 font-medium">Held-out error</th>
                  <th className="pb-1.5 text-right font-medium">{before ? "Before fit" : ""}</th>
                  <th className="pb-1.5 pl-4 text-right font-medium">{before ? "After fit" : "Model"}</th>
                </tr>
              </thead>
              <tbody>
                <MetricRow label="Burning rate, mean error" before={before ? `${before.burning_rate_mm2_s.mape_pct?.toFixed(1)} %` : ""} after={`${after.burning_rate_mm2_s.mape_pct?.toFixed(1)} %`} />
                <MetricRow label="Extinction diameter, mean error" before={before ? `${before.extinction_diameter_ratio.mae?.toFixed(2)}` : ""} after={`${after.extinction_diameter_ratio.mae?.toFixed(2)}`} />
                <MetricRow label="Extinction size within 0.2 of initial" before={before ? pct(before.extinction_within_tolerance) : ""} after={pct(after.extinction_within_tolerance)} lowerIsBetter={false} />
                <MetricRow label="Early or late flame-out, agreement" before={before ? pct(before.outcome_agreement) : ""} after={pct(after.outcome_agreement)} lowerIsBetter={false} />
                <MetricRow label="Burned on orbit, model would not ignite" before={before ? String(before.model_failed_to_ignite) : ""} after={String(after.model_failed_to_ignite)} />
              </tbody>
            </table>
            <p className="mt-3 leading-snug text-muted">
              {fit
                ? `The model's ${Object.keys(fit.parameters).length} adjustable constants were fitted to ${fit.train_tests} FLEX tests. The figures above come from the other ${fit.holdout_tests}, which the fit never used.`
                : "Model constants are set by hand; no fit to flight data is stored."}
            </p>
          </div>
        ) : (
          <Skeleton lines={7} />
        )}
      </Panel>

      <Panel className="col-span-5" title="Closest flight tests to your scenario" subtitle="Measured values from NASA, beside the model" bodyClassName="thin-scroll overflow-y-auto">
        {nearest.length ? (
          <table className="w-full text-[12px]" data-testid="nearest-tests">
            <thead className="sticky top-0 bg-panel">
              <tr className="border-b border-line text-left text-[11px] text-muted">
                <th className="px-3.5 py-2 font-medium">Test</th>
                <th className="py-2 font-medium">Fuel</th>
                <th className="py-2 text-right font-medium">Diameter</th>
                <th className="py-2 text-right font-medium">Oxygen</th>
                <th className="py-2 text-right font-medium">Pressure</th>
                <th className="py-2 text-right font-medium">Burning rate</th>
                <th className="px-3.5 py-2 text-right font-medium">Result</th>
              </tr>
            </thead>
            <tbody>
              {nearest.map((t) => (
                <tr key={t.identifier} className="border-b border-line/60">
                  <td className="px-3.5 py-1.5">
                    <span className="num text-fg">{t.identifier}</span> <span className="num text-[11px] text-muted">{t.date}</span>
                  </td>
                  <td className="py-1.5" style={{ color: t.same_fuel ? COLORS.fg : COLORS.warning }}>
                    {t.fuel} <span className="text-[11px] text-muted">{t.diluent}</span>
                  </td>
                  <td className="num py-1.5 text-right">{t.d0_mm.toFixed(2)} mm</td>
                  <td className="num py-1.5 text-right">{(t.x_o2 * 100).toFixed(0)} %</td>
                  <td className="num py-1.5 text-right">{t.pressure_atm.toFixed(2)} atm</td>
                  <td className="num py-1.5 text-right">{t.burning_rate_mm2_s?.toFixed(2) ?? "--"}</td>
                  <td className="px-3.5 py-1.5 text-right text-muted">
                    {t.extinction_ratio !== null ? `flame out at ${(t.extinction_ratio * 100).toFixed(0)} % of size` : t.test_end.toLowerCase()}
                  </td>
                </tr>
              ))}
              <tr className="bg-inset">
                <td className="px-3.5 py-1.5 text-fg">Model, your scenario</td>
                <td className="py-1.5">{query.fuel} <span className="text-[11px] text-muted">{query.diluent}</span></td>
                <td className="num py-1.5 text-right">{query.d0_mm.toFixed(2)} mm</td>
                <td className="num py-1.5 text-right">{(query.x_o2 * 100).toFixed(0)} %</td>
                <td className="num py-1.5 text-right">{query.pressure_atm.toFixed(2)} atm</td>
                <td className="num py-1.5 text-right text-warning">{modelRate?.toFixed(2) ?? "--"}</td>
                <td className="px-3.5 py-1.5 text-right text-muted">
                  {sim?.summary.first_extinction_s != null ? `visible flame out at ${sim.summary.first_extinction_s.toFixed(1)} s` : "burns to completion"}
                </td>
              </tr>
            </tbody>
          </table>
        ) : (
          <Skeleton lines={5} className="p-3.5" />
        )}
        {saffire ? (
          <div className="border-t border-line px-3.5 py-2.5">
            <div className="label mb-1.5">Saffire-II flight results in microgravity, 20 cm/s airflow</div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-[11.5px]">
              {saffire
                .filter((s) => s.mission === "Saffire-II" && s.microgravity_burn_length)
                .slice(0, 8)
                .map((s) => (
                  <div key={`${s.sample}-${s.material}`} className="flex justify-between gap-3">
                    <span className="truncate text-fg">{s.material}</span>
                    <span className="shrink-0 text-muted">{burnLength(s.microgravity_burn_length)}</span>
                  </div>
                ))}
            </div>
          </div>
        ) : null}
      </Panel>

      <InvestigationsPanel query={query} className="col-span-7" />
    </div>
  );
}
