"use client";

import { memo, useEffect, useMemo, useRef } from "react";
import { CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, XAxis, YAxis } from "recharts";

import { clock, usePlayback } from "@/lib/playback";
import { COLORS, REGIME_STYLE, fmt, fmtExp, runs } from "@/lib/regimes";
import type { Regime, Simulation } from "@/lib/types";

import { Panel } from "./ui";

const Y_AXIS_WIDTH = 46;
const MARGIN = { top: 6, right: 12, bottom: 0, left: 0 };
const MAX_POINTS = 320;
const LOG_FLOOR = 1e-5;

interface Row {
  t: number;
  d2: number;
  tf: number;
  hrr: number;
  rad: number;
  uv: number;
  vis: number;
  co: number;
}

interface TraceDef {
  key: keyof Row;
  name: string;
  color: string;
  digits?: number;
  exp?: boolean;
}

interface ChartDef {
  id: string;
  title: string;
  unit: string;
  traces: TraceDef[];
  log?: boolean;
  domain?: [number | string, number | string];
}

const CHARTS: ChartDef[] = [
  {
    id: "d2",
    title: "Droplet D squared",
    unit: "mm2",
    traces: [{ key: "d2", name: "D2", color: COLORS.fg, digits: 2 }],
  },
  {
    id: "tf",
    title: "Flame temperature",
    unit: "K",
    traces: [{ key: "tf", name: "T_f", color: COLORS.warning, digits: 0 }],
    domain: [250, "auto"],
  },
  {
    id: "sensors",
    title: "Sensors",
    unit: "log",
    log: true,
    domain: [LOG_FLOOR, 1e3],
    traces: [
      { key: "vis", name: "Optical", color: COLORS.fg, exp: true },
      { key: "uv", name: "UV", color: COLORS.uv, exp: true },
      { key: "rad", name: "Rad W/m2", color: COLORS.warning, exp: true },
    ],
  },
  {
    id: "co",
    title: "CO/O2, heat release",
    unit: "-, W/100",
    traces: [
      { key: "co", name: "CO/O2", color: COLORS.critical, digits: 3 },
      { key: "hrr", name: "HRR/100", color: COLORS.muted, digits: 3 },
    ],
  },
];

const tickStyle = { fontSize: 10, fill: COLORS.muted };

const Plot = memo(function Plot({
  def,
  rows,
  bands,
  duration,
  showAxis,
  markers,
}: {
  def: ChartDef;
  rows: Row[];
  bands: [number, number, Regime][];
  duration: number;
  showAxis: boolean;
  markers: number[];
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={rows} margin={MARGIN}>
        <CartesianGrid stroke={COLORS.line} strokeWidth={1} />
        {bands.map(([a, b, regime]) =>
          regime === "INVISIBLE_COOL_FLAME" || regime === "RE_IGNITION_RISK" ? (
            <ReferenceArea
              key={a}
              x1={a}
              x2={b}
              fill={REGIME_STYLE[regime].color}
              fillOpacity={0.07}
              stroke="none"
              ifOverflow="hidden"
            />
          ) : null,
        )}
        {markers.map((m) => (
          <ReferenceLine key={m} x={m} stroke={COLORS.lineStrong} strokeDasharray="2 3" />
        ))}
        <XAxis
          dataKey="t"
          type="number"
          domain={[0, duration]}
          tick={showAxis ? tickStyle : false}
          tickLine={false}
          axisLine={{ stroke: COLORS.line }}
          height={showAxis ? 18 : 1}
          tickCount={7}
          tickFormatter={(v: number) => v.toFixed(0)}
        />
        <YAxis
          width={Y_AXIS_WIDTH}
          tick={tickStyle}
          tickLine={false}
          axisLine={{ stroke: COLORS.line }}
          scale={def.log ? "log" : "auto"}
          domain={def.domain ?? ["auto", "auto"]}
          allowDataOverflow
          tickCount={def.log ? 5 : 4}
          ticks={def.log ? [1e-4, 1e-2, 1, 1e2] : undefined}
          tickFormatter={(v: number) => (def.log ? `1e${Math.round(Math.log10(v))}` : Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1))}
        />
        {def.traces.map((trace) => (
          <Line
            key={trace.key}
            type="linear"
            dataKey={trace.key}
            stroke={trace.color}
            strokeWidth={1.25}
            dot={false}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
});

function Values({ def, sim }: { def: ChartDef; sim: Simulation }) {
  const { index } = usePlayback();
  const i = Math.min(index, sim.t.length - 1);
  const s = sim.series;
  const live: Record<string, number> = {
    d2: s.d2_mm2[i],
    tf: s.flame_temperature_k[i],
    hrr: s.heat_release_w[i] / 100,
    rad: s.radiometer_w_m2[i],
    uv: s.uv_intensity[i],
    vis: s.visible_luminosity[i],
    co: s.co_o2_ratio[i],
  };
  return (
    <div className="flex items-center gap-3">
      {def.traces.map((trace) => (
        <span key={trace.key} className="flex items-center gap-1.5">
          <span className="h-px w-2.5" style={{ backgroundColor: trace.color }} />
          <span className="text-[10px] text-muted">{trace.name}</span>
          <span className="num w-[52px] text-right text-[11px] text-fg">
            {trace.exp ? fmtExp(live[trace.key]) : fmt(live[trace.key], trace.digits ?? 2)}
          </span>
        </span>
      ))}
    </div>
  );
}

function Cursor() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(
    () =>
      clock.onFrame((t) => {
        const el = ref.current;
        const parent = el?.parentElement;
        if (!el || !parent) return;
        const plot = parent.clientWidth - Y_AXIS_WIDTH - MARGIN.right;
        el.style.transform = `translateX(${Y_AXIS_WIDTH + (t / clock.duration) * plot}px)`;
      }),
    [],
  );
  return <div ref={ref} className="pointer-events-none absolute bottom-0 left-0 top-0 w-px bg-fg/70" />;
}

export function TelemetryCharts({ sim, highlight }: { sim: Simulation | null; highlight?: boolean }) {
  const { rows, bands, duration, markers } = useMemo(() => {
    if (!sim) return { rows: [] as Row[], bands: [] as [number, number, Regime][], duration: 1, markers: [] as number[] };
    const n = sim.t.length;
    const stride = Math.max(1, Math.ceil(n / MAX_POINTS));
    const s = sim.series;
    const out: Row[] = [];
    for (let i = 0; i < n; i += stride) {
      out.push({
        t: sim.t[i],
        d2: s.d2_mm2[i],
        tf: s.flame_temperature_k[i],
        hrr: s.heat_release_w[i] / 100,
        rad: Math.max(s.radiometer_w_m2[i], LOG_FLOOR),
        uv: Math.max(s.uv_intensity[i], LOG_FLOOR),
        vis: Math.max(s.visible_luminosity[i], LOG_FLOOR),
        co: s.co_o2_ratio[i],
      });
    }
    const timeBands = runs(sim.regime).map(([a, b, r]) => [sim.t[a], sim.t[b], r] as [number, number, Regime]);
    const eventTimes = sim.events
      .filter((e) => e.kind === "VENTILATION_RESTORED" || e.kind === "HOT_REIGNITION")
      .map((e) => e.t);
    return { rows: out, bands: timeBands, duration: sim.t[n - 1], markers: eventTimes };
  }, [sim]);

  return (
    <Panel
      title="Telemetry  /  synchronized to playback"
      highlight={highlight}
      className="h-full"
      bodyClassName="flex flex-col"
      right={<span className="num text-[10px] text-faint">SOURCE: MODEL</span>}
    >
      {CHARTS.map((def, idx) => (
        <div key={def.id} className="flex min-h-0 flex-1 flex-col border-b border-line px-2 pt-1.5 last:border-b-0">
          <div className="flex h-4 items-center justify-between pl-1 pr-1">
            <span className="text-[10px] text-muted">
              {def.title} <span className="text-faint">({def.unit})</span>
            </span>
            {sim ? <Values def={def} sim={sim} /> : null}
          </div>
          <div className="relative min-h-0 flex-1" data-testid={`chart-${def.id}`}>
            {sim ? (
              <>
                <Plot def={def} rows={rows} bands={bands} duration={duration} showAxis={idx === CHARTS.length - 1} markers={markers} />
                <Cursor />
              </>
            ) : null}
          </div>
        </div>
      ))}
    </Panel>
  );
}
