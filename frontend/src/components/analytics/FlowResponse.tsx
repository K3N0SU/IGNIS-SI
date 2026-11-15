"use client";

import { useMemo } from "react";
import { CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, XAxis, YAxis } from "recharts";

import { api } from "@/lib/api";
import { COLORS } from "@/lib/regimes";
import type { ChamberQuery, FlowPoint } from "@/lib/types";

import { Panel, Skeleton, Stat } from "../ui";
import { Explain, LegendKey, LoadFailed, axisLine, axisTitle, tick, useDebounced, useFetch } from "./shared";

const LOG_MIN = 0.2;

export function FlowResponse({ query, highlight }: { query: ChamberQuery; highlight?: boolean }) {
  const diameter = Math.round(query.d0_mm * 0.8 * 10) / 10;
  const key = useDebounced(`${query.fuel}|${diameter}|${query.x_o2}|${query.pressure_atm}|${query.diluent}`, 250);
  const { data, failed } = useFetch<{ points: FlowPoint[] }>((signal) => api.flowSweep(query, diameter, signal), key);
  const points = useMemo(() => data?.points ?? [], [data]);

  const rows = useMemo(() => points.map((p) => ({ u: Math.max(p.airflow_cm_s, LOG_MIN), q: p.heat_release_w })), [points]);
  const peak = points.length ? points.reduce((m, p) => (p.heat_release_w > m.heat_release_w ? p : m), points[0]) : null;
  const blowoff = points.find((p, i) => i > 0 && p.heat_release_w === 0 && points[i - 1].heat_release_w > 0);

  return (
    <Panel
      title="Airflow and fire intensity"
      subtitle="A little air feeds the flame, a lot blows it out"
      highlight={highlight}
      className="h-full"
      bodyClassName="flex flex-col"
    >
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 px-3.5 pt-2.5">
        <LegendKey color={COLORS.warning} label="Heat release" />
        <span className="flex items-center gap-1.5 text-[11px] text-muted">
          <span className="h-2.5 w-2.5 rounded-[2px] border border-warning/50 bg-warning/15" />
          Cabin ventilation, 1 to 10 cm/s
        </span>
        {query.airflow_cm_s > 0 ? <LegendKey color={COLORS.fg} label="Your scenario" dashed /> : null}
      </div>
      <div className="min-h-0 flex-1 px-1 pt-1.5" data-testid="flow-chart">
        {points.length ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows} margin={{ top: 6, right: 16, bottom: 0, left: 4 }} accessibilityLayer={false}>
              <CartesianGrid stroke={COLORS.line} />
              <ReferenceArea x1={1} x2={10} fill={COLORS.warning} fillOpacity={0.09} stroke="none" />
              {query.airflow_cm_s > 0 ? (
                <ReferenceLine x={Math.max(query.airflow_cm_s, LOG_MIN)} stroke={COLORS.fg} strokeDasharray="3 3" />
              ) : null}
              <XAxis
                dataKey="u"
                type="number"
                scale="log"
                domain={[LOG_MIN, 300]}
                ticks={[LOG_MIN, 1, 10, 100, 300]}
                tick={tick}
                tickLine={false}
                axisLine={axisLine}
                height={34}
                tickFormatter={(v: number) => (v < 1 ? "0" : String(v))}
                label={{ value: "Airflow, cm/s (log scale)", position: "insideBottom", offset: 2, ...axisTitle }}
              />
              <YAxis
                width={48}
                tick={tick}
                tickLine={false}
                axisLine={axisLine}
                tickCount={5}
                label={{ value: "Heat release, W", angle: -90, position: "insideLeft", offset: 6, style: { textAnchor: "middle" }, ...axisTitle }}
              />
              <Line type="linear" dataKey="q" stroke={COLORS.warning} strokeWidth={1.5} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        ) : failed ? (
          <LoadFailed />
        ) : (
          <Skeleton lines={5} className="px-3 pt-3" />
        )}
      </div>
      <div className="shrink-0 border-t border-line px-3.5 py-2.5">
        <div className="mb-2 grid grid-cols-3 gap-3">
          <Stat label="In still air" value={points[0] ? points[0].heat_release_w.toFixed(1) : "--"} unit="W" />
          <Stat
            label="Peak intensity"
            value={peak ? peak.heat_release_w.toFixed(1) : "--"}
            unit={peak ? `W at ${peak.airflow_cm_s.toFixed(0)} cm/s` : "W"}
            color={COLORS.warning}
          />
          <Stat label="Blown out above" value={blowoff ? blowoff.airflow_cm_s.toFixed(0) : "300+"} unit="cm/s" />
        </div>
        <Explain>
          For a <span className="num">{diameter.toFixed(1)}</span> mm droplet of this fuel. Cabin fans sit on the rising
          side of the curve, so turning them on makes a surviving fire stronger, not weaker.
        </Explain>
      </div>
    </Panel>
  );
}
