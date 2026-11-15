"use client";

import { type RefObject, useEffect, useMemo, useRef, useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, XAxis, YAxis } from "recharts";

import { api } from "@/lib/api";
import { COLORS, REGIME_STYLE, STATUS_COLOR } from "@/lib/regimes";
import type {
  AerosolComparison,
  Assessment,
  ChamberQuery,
  FlowPoint,
  FrontierGrid,
  ModelCard,
  RiskBoard,
  Verdict,
} from "@/lib/types";

import { Panel, Segmented, Tag } from "./ui";

const tick = { fontSize: 10, fill: COLORS.muted };

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
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

function Bar({ value, color }: { value: number; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1 w-16 bg-line">
        <div className="h-1" style={{ width: `${value}%`, backgroundColor: color }} />
      </div>
      <span className="num w-9 text-right text-[11px] text-fg">{value.toFixed(1)}</span>
    </div>
  );
}

function RiskLeaderboard({ highlight, focus }: { highlight?: boolean; focus: string }) {
  const [board, setBoard] = useState<RiskBoard | null>(null);
  const [filter, setFilter] = useState<string>("ALL");

  useEffect(() => {
    const ctl = new AbortController();
    api.risk(ctl.signal).then(setBoard).catch(() => undefined);
    return () => ctl.abort();
  }, []);
  useEffect(() => setFilter(focus), [focus]);

  const rows = useMemo(
    () => (board ? board.entries.filter((e) => filter === "ALL" || e.atmosphere === filter) : []),
    [board, filter],
  );

  return (
    <Panel
      title="SI risk leaderboard  /  material x atmosphere"
      highlight={highlight}
      className="h-full"
      bodyClassName="thin-scroll overflow-y-auto"
      right={
        <Segmented
          size="sm"
          testId="risk-filter"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "ALL", label: "ALL" },
            { value: "ISS", label: "ISS 21 %" },
            { value: "EVA_PREP", label: "10.2 PSIA 26.5 %" },
            { value: "ARTEMIS", label: "ARTEMIS 34 %" },
          ]}
        />
      }
    >
      <table className="w-full text-[11px]" data-testid="risk-table">
        <thead className="sticky top-0 bg-panel">
          <tr className="label border-b border-line text-left">
            <th className="px-3 py-1.5 font-semibold">#</th>
            <th className="py-1.5 font-semibold">Material</th>
            <th className="py-1.5 font-semibold">Atmosphere</th>
            <th className="py-1.5 text-right font-semibold">O2 margin</th>
            <th className="py-1.5 pl-4 font-semibold">Ignition</th>
            <th className="py-1.5 font-semibold">Toxic CO</th>
            <th className="py-1.5 font-semibold">Suppression</th>
            <th className="py-1.5 text-right font-semibold">Composite</th>
            <th className="px-3 py-1.5 text-right font-semibold">Level</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => {
            const color = STATUS_COLOR[e.severity];
            return (
              <tr key={`${e.material}-${e.atmosphere}`} className="border-b border-line/60 last:border-b-0">
                <td className="num px-3 py-[4px] text-faint">{String(e.rank).padStart(2, "0")}</td>
                <td className="py-[4px] text-fg">{e.material_name}</td>
                <td className="py-[4px] text-muted">
                  {e.atmosphere_name}{" "}
                  <span className="num text-faint">
                    {(e.x_o2 * 100).toFixed(1)} % / {e.pressure_atm.toFixed(2)} atm
                  </span>
                </td>
                <td
                  className="num py-[4px] text-right"
                  style={{ color: e.oxygen_margin_pct > 0 ? COLORS.critical : COLORS.nominal }}
                >
                  {e.oxygen_margin_pct > 0 ? "+" : ""}
                  {e.oxygen_margin_pct.toFixed(1)} pp
                </td>
                <td className="py-[4px] pl-4">
                  <Bar value={e.ignition_propensity} color={COLORS.warning} />
                </td>
                <td className="py-[4px]">
                  <Bar value={e.toxic_co_yield} color={COLORS.muted} />
                </td>
                <td className="py-[4px]">
                  <Bar value={e.suppression_difficulty} color={COLORS.uv} />
                </td>
                <td className="num py-[4px] text-right text-[12px] font-semibold" style={{ color }}>
                  {e.composite.toFixed(1)}
                </td>
                <td className="px-3 py-[4px] text-right">
                  <Tag color={color}>{e.severity}</Tag>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {board ? <p className="border-t border-line px-3 py-1.5 text-[10px] text-faint">{board.basis}</p> : null}
    </Panel>
  );
}

const VERDICT_FILL: Record<Verdict, string> = {
  VERIFIED: "rgba(16,185,129,0.42)",
  INTERPOLATED: "rgba(245,158,11,0.34)",
  BEYOND_FRONTIER: "rgba(239,68,68,0.13)",
};

function FrontierMap({
  query,
  assessment,
  highlight,
}: {
  query: ChamberQuery;
  assessment: Assessment | null;
  highlight?: boolean;
}) {
  const [grid, setGrid] = useState<FrontierGrid | null>(null);
  const key = useDebounced(`${query.fuel}|${query.d0_mm}|${query.pressure_atm}|${query.diluent}`, 250);

  useEffect(() => {
    const ctl = new AbortController();
    api
      .frontier({ fuel: query.fuel, d0_mm: query.d0_mm, pressure_atm: query.pressure_atm, diluent: query.diluent }, ctl.signal)
      .then(setGrid)
      .catch(() => undefined);
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const [plotRef, plot] = useSize<HTMLDivElement>();
  const W = Math.max(plot.width, 120);
  const H = Math.max(plot.height, 80);
  const L = 34;
  const B = 22;
  const T = 6;
  const R = 8;

  return (
    <Panel
      title="Knowledge frontier  /  flown envelope vs. query"
      highlight={highlight}
      className="h-full"
      bodyClassName="flex flex-col"
      right={assessment ? <Tag color={STATUS_COLOR[assessment.verdict]}>{assessment.verdict.replace("_", " ")}</Tag> : null}
    >
      <div ref={plotRef} className="mx-2 mt-2 min-h-0 flex-1" data-testid="frontier-map">
        {grid && plot.width > 0 ? (
          <svg width={W} height={H} className="block">
            {(() => {
              const cols = grid.o2.length;
              const rowsN = grid.airflow_cm_s.length;
              const cw = (W - L - R) / cols;
              const ch = (H - T - B) / rowsN;
              const cells = [];
              for (let r = 0; r < rowsN; r++) {
                for (let c = 0; c < cols; c++) {
                  cells.push(
                    <rect
                      key={`${r}-${c}`}
                      x={L + c * cw}
                      y={H - B - (r + 1) * ch}
                      width={cw - 0.6}
                      height={ch - 0.6}
                      fill={VERDICT_FILL[grid.verdict[r][c]]}
                    />,
                  );
                }
              }
              const o2Min = grid.o2[0];
              const o2Max = grid.o2[cols - 1];
              const uMax = grid.airflow_cm_s[rowsN - 1];
              const qx = L + ((Math.min(Math.max(query.x_o2, o2Min), o2Max) - o2Min) / (o2Max - o2Min + 0.01)) * (W - L - R) + cw / 2;
              const qy = H - B - (Math.min(query.airflow_cm_s, uMax) / (uMax + 1)) * (H - T - B) - ch / 2;
              return (
                <>
                  {cells}
                  {[0.1, 0.2, 0.3, 0.4].map((x) => (
                    <text key={x} x={L + ((x - o2Min) / (o2Max - o2Min + 0.01)) * (W - L - R) + cw / 2} y={H - 7} textAnchor="middle" className="num" fontSize={10} fill={COLORS.muted}>
                      {(x * 100).toFixed(0)}
                    </text>
                  ))}
                  {[0, 5, 10, 15, 20].map((u) => (
                    <text key={u} x={L - 6} y={H - B - (u / (uMax + 1)) * (H - T - B) - ch / 2 + 3} textAnchor="end" className="num" fontSize={10} fill={COLORS.muted}>
                      {u}
                    </text>
                  ))}
                  <line x1={qx} x2={qx} y1={T} y2={H - B} stroke={COLORS.fg} strokeWidth={0.6} strokeDasharray="2 3" />
                  <line x1={L} x2={W - R} y1={qy} y2={qy} stroke={COLORS.fg} strokeWidth={0.6} strokeDasharray="2 3" />
                  <rect x={qx - 4} y={qy - 4} width={8} height={8} fill="none" stroke={COLORS.fg} strokeWidth={1.4} />
                </>
              );
            })()}
          </svg>
        ) : null}
      </div>
      <div className="shrink-0 border-t border-line px-3 py-2 text-[11px]">
        <div className="mb-1.5 flex gap-4">
          <span className="text-[10px] text-faint">x: O2 % vol &nbsp; y: airflow cm/s</span>
          {(["VERIFIED", "INTERPOLATED", "BEYOND_FRONTIER"] as Verdict[]).map((v) => (
            <span key={v} className="flex items-center gap-1.5 text-[10px] text-muted">
              <span className="h-2 w-2" style={{ backgroundColor: VERDICT_FILL[v], outline: `1px solid ${STATUS_COLOR[v]}55` }} />
              {v === "VERIFIED" ? "Flown on ISS" : v === "INTERPOLATED" ? "Between campaigns" : "Never tested"}
            </span>
          ))}
        </div>
        <p className="leading-snug text-fg">{assessment?.summary ?? "Evaluating query against the flown envelope."}</p>
        {assessment?.outcome_distribution ? (
          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5">
            {Object.entries(assessment.outcome_distribution)
              .filter(([, p]) => p > 0)
              .map(([outcome, p]) => (
                <span key={outcome} className="text-[10px] text-muted">
                  {outcome.replace("_", " ")} <span className="num text-fg">{(p * 100).toFixed(0)} %</span>
                </span>
              ))}
            <span className="text-[10px] text-faint">of calibration ensemble</span>
          </div>
        ) : null}
      </div>
    </Panel>
  );
}

function FlowResponse({ query, highlight }: { query: ChamberQuery; highlight?: boolean }) {
  const [points, setPoints] = useState<FlowPoint[]>([]);
  const diameter = Math.round(query.d0_mm * 0.8 * 10) / 10;
  const key = useDebounced(`${query.fuel}|${diameter}|${query.x_o2}|${query.pressure_atm}|${query.diluent}`, 250);

  useEffect(() => {
    const ctl = new AbortController();
    api
      .flowSweep(query, diameter, ctl.signal)
      .then((r) => setPoints(r.points))
      .catch(() => undefined);
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const rows = useMemo(
    () => points.map((p) => ({ u: Math.max(p.airflow_cm_s, 0.2), q: p.heat_release_w, tc: p.cool_flame_temperature_k })),
    [points],
  );
  const peak = points.reduce((m, p) => (p.heat_release_w > m.heat_release_w ? p : m), points[0]);
  const blowoff = points.find((p, i) => i > 0 && p.heat_release_w === 0 && points[i - 1].heat_release_w > 0);

  return (
    <Panel
      title="Airflow response  /  non-monotonic"
      highlight={highlight}
      className="h-full"
      bodyClassName="flex flex-col"
      right={<span className="num text-[10px] text-faint">D = {diameter.toFixed(1)} mm</span>}
    >
      <div className="min-h-0 flex-1 px-1 pt-2" data-testid="flow-chart">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 6, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={COLORS.line} />
            <ReferenceArea x1={1} x2={10} fill={COLORS.warning} fillOpacity={0.07} stroke="none" />
            {query.airflow_cm_s > 0 ? <ReferenceLine x={Math.max(query.airflow_cm_s, 0.2)} stroke={COLORS.fg} strokeDasharray="2 3" /> : null}
            <XAxis
              dataKey="u"
              type="number"
              scale="log"
              domain={[0.2, 300]}
              ticks={[0.2, 1, 10, 100, 300]}
              tick={tick}
              tickLine={false}
              axisLine={{ stroke: COLORS.line }}
              height={18}
              tickFormatter={(v: number) => (v < 1 ? "0" : String(v))}
            />
            <YAxis width={40} tick={tick} tickLine={false} axisLine={{ stroke: COLORS.line }} tickCount={5} />
            <Line type="linear" dataKey="q" stroke={COLORS.warning} strokeWidth={1.25} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="grid shrink-0 grid-cols-3 gap-2 border-t border-line px-3 py-2">
        <div>
          <div className="label">Still air</div>
          <div className="num text-[12px]">{points[0] ? points[0].heat_release_w.toFixed(1) : "--"} <span className="text-[10px] text-faint">W</span></div>
        </div>
        <div>
          <div className="label">Peak</div>
          <div className="num text-[12px] text-warning">
            {peak ? `${peak.heat_release_w.toFixed(1)} W @ ${peak.airflow_cm_s.toFixed(0)}` : "--"} <span className="text-[10px] text-faint">cm/s</span>
          </div>
        </div>
        <div>
          <div className="label">Blowoff</div>
          <div className="num text-[12px]">{blowoff ? blowoff.airflow_cm_s.toFixed(0) : "> 300"} <span className="text-[10px] text-faint">cm/s</span></div>
        </div>
        <p className="col-span-3 text-[10px] leading-snug text-faint">
          Heat release (W) against airflow (cm/s, log). Shaded band: 1-10 cm/s, typical of cabin ventilation.
        </p>
      </div>
    </Panel>
  );
}

function AerosolPanel({ query, highlight }: { query: ChamberQuery; highlight?: boolean }) {
  const [data, setData] = useState<AerosolComparison | null>(null);
  const [fans, setFans] = useState<"off" | "on">("off");
  const ventilation = fans === "on" ? 10 : 0;
  const key = useDebounced(`${ventilation}|${query.pressure_atm}`, 250);

  useEffect(() => {
    const ctl = new AbortController();
    api.aerosol(ventilation, query.pressure_atm, ctl.signal).then(setData).catch(() => undefined);
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const rows = useMemo(() => {
    if (!data) return [];
    return data.microgravity.t.map((t, i) => ({
      t,
      micro: data.microgravity.count_mean_diameter_nm[i],
      normal: data.normal_gravity.count_mean_diameter_nm[i],
    }));
  }, [data]);
  const m = data?.microgravity;
  const last = m ? m.t.length - 1 : 0;

  return (
    <Panel
      title="Smoke aerosol aging  /  SAME physics"
      highlight={highlight}
      className="h-full"
      bodyClassName="flex flex-col"
      right={
        <span className="flex items-center gap-3 text-[10px] text-muted">
          <Segmented
            size="sm"
            value={fans}
            onChange={setFans}
            options={[
              { value: "off", label: "FANS OFF" },
              { value: "on", label: "FANS 10 cm/s" },
            ]}
          />
          <span className="flex items-center gap-1.5"><span className="h-px w-3 bg-uv" />0 g</span>
          <span className="flex items-center gap-1.5"><span className="h-px w-3 bg-muted" />1 g</span>
        </span>
      }
    >
      <div className="min-h-0 flex-1 px-1 pt-2" data-testid="aerosol-chart">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 6, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={COLORS.line} />
            <ReferenceLine y={1000} stroke={COLORS.critical} strokeDasharray="3 3" />
            <XAxis dataKey="t" type="number" domain={[0, "dataMax"]} tick={tick} tickLine={false} axisLine={{ stroke: COLORS.line }} height={18} tickCount={7} />
            <YAxis
              width={44}
              scale="log"
              domain={[30, 3000]}
              ticks={[30, 100, 300, 1000, 3000]}
              allowDataOverflow
              tick={tick}
              tickLine={false}
              axisLine={{ stroke: COLORS.line }}
            />
            <Line type="linear" dataKey="normal" stroke={COLORS.muted} strokeWidth={1.25} dot={false} isAnimationActive={false} />
            <Line type="linear" dataKey="micro" stroke={COLORS.uv} strokeWidth={1.25} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="grid shrink-0 grid-cols-4 gap-2 border-t border-line px-3 py-2">
        <div>
          <div className="label">0 g mean D</div>
          <div className="num text-[12px] text-uv">{m ? m.final_count_mean_diameter_nm.toFixed(0) : "--"} <span className="text-[10px] text-faint">nm</span></div>
        </div>
        <div>
          <div className="label">Mass &gt; 1 um</div>
          <div className="num text-[12px]">{m ? (m.final_mass_fraction_above_1um * 100).toFixed(0) : "--"} <span className="text-[10px] text-faint">%</span></div>
        </div>
        <div>
          <div className="label">Ionization</div>
          <div className="num text-[12px] text-critical">{m ? `${(m.ionization_per_mass[last] * 100).toFixed(1)}` : "--"} <span className="text-[10px] text-faint">% of fresh</span></div>
        </div>
        <div>
          <div className="label">Scattering</div>
          <div className="num text-[12px]">{m ? `${m.photoelectric_per_mass[last].toFixed(0)}x` : "--"} <span className="text-[10px] text-faint">plateau</span></div>
        </div>
        <p className="col-span-4 text-[10px] leading-snug text-faint">
          Count-mean aggregate diameter (nm) against age (s). Detector response is per unit smoke mass relative to fresh
          smoke. In 0 g the only removal is forced ventilation.
        </p>
      </div>
    </Panel>
  );
}

function ModelCardPanel({ highlight }: { highlight?: boolean }) {
  const [card, setCard] = useState<ModelCard | null>(null);
  useEffect(() => {
    const ctl = new AbortController();
    api.modelCard(ctl.signal).then(setCard).catch(() => undefined);
    return () => ctl.abort();
  }, []);

  return (
    <Panel title="Regime classifier  /  held-out scenarios" highlight={highlight} className="h-full" bodyClassName="thin-scroll overflow-y-auto">
      {card ? (
        <div className="text-[11px]" data-testid="model-card">
          <div className="grid grid-cols-3 gap-2 border-b border-line px-3 py-2">
            <div>
              <div className="label">Accuracy</div>
              <div className="num text-[14px]">{(card.accuracy * 100).toFixed(1)} %</div>
            </div>
            <div>
              <div className="label">Macro F1</div>
              <div className="num text-[14px]">{card.macro_f1.toFixed(3)}</div>
            </div>
            <div>
              <div className="label">Test burns</div>
              <div className="num text-[14px]">{card.test_scenarios}</div>
            </div>
          </div>
          <table className="w-full">
            <thead>
              <tr className="label border-b border-line text-left">
                <th className="px-3 py-1.5 font-semibold">Class</th>
                <th className="py-1.5 text-right font-semibold">Precision</th>
                <th className="py-1.5 text-right font-semibold">Recall</th>
                <th className="px-3 py-1.5 text-right font-semibold">n</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(card.per_class).map(([label, m]) => (
                <tr key={label} className="border-b border-line/60">
                  <td className="px-3 py-1">
                    <span className="mr-2 inline-block h-1.5 w-1.5" style={{ backgroundColor: REGIME_STYLE[label as keyof typeof REGIME_STYLE]?.color }} />
                    {REGIME_STYLE[label as keyof typeof REGIME_STYLE]?.label ?? label}
                  </td>
                  <td className="num py-1 text-right">{m.precision.toFixed(3)}</td>
                  <td className="num py-1 text-right">{m.recall.toFixed(3)}</td>
                  <td className="num px-3 py-1 text-right text-muted">{m.support.toFixed(0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-3 py-2 text-[10px] leading-snug text-faint">
            Inputs: radiometer, UV chemiluminescence, CO/O2 and their slopes. No optical-camera input. Trained on{" "}
            <span className="num">{card.train_rows.toLocaleString("en-US")}</span> samples of {card.training_data}.
          </p>
        </div>
      ) : (
        <p className="px-3 py-2 text-[11px] text-muted">Loading model card.</p>
      )}
    </Panel>
  );
}

export type AnalyticsFocus = "risk" | "frontier" | "flow" | "aerosol" | null;

export function AnalyticsView({
  query,
  assessment,
  focus,
  riskFilter,
}: {
  query: ChamberQuery;
  assessment: Assessment | null;
  focus: AnalyticsFocus;
  riskFilter: string;
}) {
  return (
    <div className="grid h-full min-h-0 grid-cols-12 grid-rows-[minmax(0,1.25fr)_minmax(0,1fr)] gap-2">
      <div className="col-span-7 min-h-0">
        <RiskLeaderboard highlight={focus === "risk"} focus={riskFilter} />
      </div>
      <div className="col-span-5 min-h-0">
        <FrontierMap query={query} assessment={assessment} highlight={focus === "frontier"} />
      </div>
      <div className="col-span-4 min-h-0">
        <FlowResponse query={query} highlight={focus === "flow"} />
      </div>
      <div className="col-span-5 min-h-0">
        <AerosolPanel query={query} highlight={focus === "aerosol"} />
      </div>
      <div className="col-span-3 min-h-0">
        <ModelCardPanel />
      </div>
    </div>
  );
}
