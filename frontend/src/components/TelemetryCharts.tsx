"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, XAxis, YAxis } from "recharts";

import { notableEvents, placeLabels } from "@/lib/events";
import type { GlossaryKey } from "@/lib/glossary";
import { clock, usePlayback } from "@/lib/playback";
import { COLORS, REGIME_STYLE, fmt, fmtExp, runs } from "@/lib/regimes";
import type { Regime, SimEvent, Simulation } from "@/lib/types";

import { Panel, Skeleton, Term } from "./ui";

const Y_AXIS_WIDTH = 44;
const MARGIN = { top: 6, right: 14, bottom: 0, left: 0 };
const MAX_POINTS = 320;
const LOG_FLOOR = 1e-5;
const SUPERSCRIPT: Record<string, string> = { "-": "⁻", "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵" };

interface Row {
  t: number;
  d2: number;
  tf: number;
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
  hint?: GlossaryKey;
  traces: TraceDef[];
  log?: boolean;
  domain?: [number | string, number | string];
}

const CHARTS: ChartDef[] = [
  {
    id: "d2",
    title: "Droplet size",
    unit: "diameter², mm²",
    hint: "d2",
    traces: [{ key: "d2", name: "D²", color: COLORS.fg, digits: 2 }],
  },
  {
    id: "tf",
    title: "Flame temperature",
    unit: "K",
    traces: [{ key: "tf", name: "T", color: COLORS.warning, digits: 0 }],
    domain: [250, "auto"],
  },
  {
    id: "sensors",
    title: "Sensor signals",
    unit: "log scale",
    log: true,
    domain: [LOG_FLOOR, 1e3],
    traces: [
      { key: "vis", name: "Optical", color: COLORS.fg, exp: true },
      { key: "uv", name: "UV", color: COLORS.uv, exp: true },
      { key: "rad", name: "Radiometer", color: COLORS.warning, exp: true },
    ],
  },
  {
    id: "co",
    title: "Carbon monoxide",
    unit: "CO to O₂ ratio",
    hint: "coRatio",
    traces: [{ key: "co", name: "CO/O₂", color: COLORS.critical, digits: 3 }],
  },
];

const tickStyle = { fontSize: 10, fill: COLORS.muted };

const logTick = (v: number): string => {
  const e = Math.round(Math.log10(v));
  if (e === 0) return "1";
  return `10${String(e)
    .split("")
    .map((c) => SUPERSCRIPT[c] ?? c)
    .join("")}`;
};

const linearTick = (v: number): string => (Number.isInteger(v) ? String(v) : v.toFixed(Math.abs(v) < 1 ? 2 : 1));

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
      <LineChart data={rows} margin={MARGIN} accessibilityLayer={false}>
        <CartesianGrid stroke={COLORS.line} strokeWidth={1} />
        {bands.map(([a, b, regime]) =>
          regime === "INVISIBLE_COOL_FLAME" || regime === "RE_IGNITION_RISK" ? (
            <ReferenceArea
              key={a}
              x1={a}
              x2={b}
              fill={REGIME_STYLE[regime].color}
              fillOpacity={0.09}
              stroke="none"
              ifOverflow="hidden"
            />
          ) : null,
        )}
        {markers.map((m) => (
          <ReferenceLine key={m} x={m} stroke={COLORS.faint} strokeDasharray="2 3" />
        ))}
        <XAxis
          dataKey="t"
          type="number"
          domain={[0, duration]}
          tick={showAxis ? tickStyle : false}
          tickLine={false}
          axisLine={{ stroke: COLORS.lineStrong }}
          height={showAxis ? 18 : 1}
          tickCount={7}
          tickFormatter={(v: number) => `${v.toFixed(0)} s`}
        />
        <YAxis
          width={Y_AXIS_WIDTH}
          tick={tickStyle}
          tickLine={false}
          axisLine={{ stroke: COLORS.lineStrong }}
          scale={def.log ? "log" : "auto"}
          domain={def.domain ?? ["auto", "auto"]}
          allowDataOverflow
          tickCount={def.log ? 5 : 4}
          ticks={def.log ? [1e-4, 1e-2, 1, 1e2] : undefined}
          tickFormatter={def.log ? logTick : linearTick}
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
    rad: s.radiometer_w_m2[i],
    uv: s.uv_intensity[i],
    vis: s.visible_luminosity[i],
    co: s.co_o2_ratio[i],
  };
  const single = def.traces.length === 1;
  return (
    <div className="flex items-center gap-3">
      {def.traces.map((trace) => (
        <span key={trace.key} className="flex items-center gap-1.5">
          <span className="h-0.5 w-2.5 rounded-[1px]" style={{ backgroundColor: trace.color }} />
          {single ? null : <span className="text-[11px] text-muted">{trace.name}</span>}
          <span className={`num text-[12px] text-fg ${trace.exp ? "w-[46px]" : "text-right"}`}>
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
  return <div ref={ref} className="pointer-events-none absolute bottom-0 left-0 top-0 w-px bg-fg" />;
}

/** Event names above the first chart, aligned with the dashed markers that run through every chart. */
function EventStrip({ events, duration }: { events: SimEvent[]; duration: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setWidth(el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const labels = useMemo(() => placeLabels(events, duration, width), [events, duration, width]);
  return (
    <div className="shrink-0 border-b border-line px-2 py-1">
      <div ref={ref} className="relative h-4" style={{ marginLeft: Y_AXIS_WIDTH, marginRight: MARGIN.right }}>
        {labels.map((l) => (
          <span
            key={`${l.event.kind}-${l.event.t}`}
            title={`${l.event.t.toFixed(1)} s. ${l.event.detail}`}
            className={`absolute top-0 whitespace-nowrap text-[10.5px] leading-4 text-muted ${
              l.anchor === "start" ? "border-l border-faint pl-1.5" : "-translate-x-full border-r border-faint pr-1.5"
            }`}
            style={{ left: l.left }}
          >
            {l.text}
          </span>
        ))}
      </div>
    </div>
  );
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
        rad: Math.max(s.radiometer_w_m2[i], LOG_FLOOR),
        uv: Math.max(s.uv_intensity[i], LOG_FLOOR),
        vis: Math.max(s.visible_luminosity[i], LOG_FLOOR),
        co: s.co_o2_ratio[i],
      });
    }
    const timeBands = runs(sim.regime).map(([a, b, r]) => [sim.t[a], sim.t[b], r] as [number, number, Regime]);
    const eventTimes = [...new Set(notableEvents(sim.events, sim.query.airflow_cm_s).filter((e) => e.t > 0).map((e) => e.t))];
    return { rows: out, bands: timeBands, duration: sim.t[n - 1], markers: eventTimes };
  }, [sim]);

  const shaded = useMemo(
    () => [...new Set(bands.map(([, , r]) => r))].filter((r) => r === "INVISIBLE_COOL_FLAME" || r === "RE_IGNITION_RISK"),
    [bands],
  );

  return (
    <Panel
      title="Telemetry"
      subtitle="Simulated, not flight data"
      highlight={highlight}
      className="h-full"
      bodyClassName="flex flex-col"
      right={
        shaded.length ? (
          <span className="flex items-center gap-3 text-[11px] text-muted">
            {shaded.map((r) => (
              <span key={r} className="flex items-center gap-1.5">
                <span
                  className="h-2.5 w-2.5 rounded-[2px] border"
                  style={{ backgroundColor: `${REGIME_STYLE[r].color}33`, borderColor: `${REGIME_STYLE[r].color}88` }}
                />
                {r === "INVISIBLE_COOL_FLAME" ? "Cool flame" : "Re-ignition risk"}
              </span>
            ))}
          </span>
        ) : null
      }
    >
      {sim ? <EventStrip events={notableEvents(sim.events, sim.query.airflow_cm_s)} duration={duration} /> : null}
      {CHARTS.map((def, idx) => {
        const last = idx === CHARTS.length - 1;
        return (
          <div key={def.id} className="flex min-h-0 flex-1 flex-col border-b border-line px-2 pt-2 last:border-b-0">
            <div className="flex h-[18px] items-center justify-between px-1.5">
              <span className="whitespace-nowrap text-[12px] font-medium text-fg">
                {def.hint ? <Term k={def.hint}>{def.title}</Term> : def.title}
                <span className="ml-2 text-[11px] font-normal text-muted">{def.unit}</span>
              </span>
              {sim && def.traces.length === 1 ? <Values def={def} sim={sim} /> : null}
            </div>
            {sim && def.traces.length > 1 ? (
              <div className="mt-0.5 flex h-[18px] items-center px-1.5">
                <Values def={def} sim={sim} />
              </div>
            ) : null}
            <div className="relative mt-1 min-h-0 flex-1" data-testid={`chart-${def.id}`}>
              {sim ? (
                <>
                  <Plot def={def} rows={rows} bands={bands} duration={duration} showAxis={last} markers={markers} />
                  <div className="absolute inset-0 overflow-hidden" style={{ bottom: last ? 18 : 1 }}>
                    <Cursor />
                  </div>
                </>
              ) : (
                <Skeleton lines={2} className="px-2 pt-3" />
              )}
            </div>
          </div>
        );
      })}
    </Panel>
  );
}
