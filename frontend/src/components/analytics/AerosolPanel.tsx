"use client";

import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, XAxis, YAxis } from "recharts";

import { api } from "@/lib/api";
import { COLORS } from "@/lib/regimes";
import type { AerosolComparison, ChamberQuery } from "@/lib/types";

import { Panel, Segmented, Skeleton, Stat } from "../ui";
import { Explain, LegendKey, LoadFailed, axisLine, axisTitle, tick, useDebounced, useFetch } from "./shared";

const FAN_SPEED_CM_S = 10;
const ONE_MICROMETRE_NM = 1000;

export function AerosolPanel({ query, highlight }: { query: ChamberQuery; highlight?: boolean }) {
  const [fans, setFans] = useState<"off" | "on">("off");
  const ventilation = fans === "on" ? FAN_SPEED_CM_S : 0;
  const key = useDebounced(`${ventilation}|${query.pressure_atm}`, 250);
  const { data, failed } = useFetch<AerosolComparison>((signal) => api.aerosol(ventilation, query.pressure_atm, signal), key);

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
      title="Smoke particle growth"
      subtitle="Why smoke detectors respond differently in orbit"
      highlight={highlight}
      className="h-full"
      bodyClassName="flex flex-col"
      right={
        <Segmented
          size="sm"
          ariaLabel="Cabin fans"
          value={fans}
          onChange={setFans}
          options={[
            { value: "off", label: "Fans off" },
            { value: "on", label: "Fans at 10 cm/s" },
          ]}
        />
      }
    >
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 px-3.5 pt-2.5">
        <LegendKey color={COLORS.uv} label="In orbit (microgravity)" />
        <LegendKey color={COLORS.muted} label="On Earth" />
        <LegendKey color={COLORS.critical} label="1 micrometre" dashed />
      </div>
      <div className="min-h-0 flex-1 px-1 pt-1.5" data-testid="aerosol-chart">
        {data ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows} margin={{ top: 6, right: 16, bottom: 0, left: 4 }} accessibilityLayer={false}>
              <CartesianGrid stroke={COLORS.line} />
              <ReferenceLine y={ONE_MICROMETRE_NM} stroke={COLORS.critical} strokeDasharray="3 3" />
              <XAxis
                dataKey="t"
                type="number"
                domain={[0, "dataMax"]}
                tick={tick}
                tickLine={false}
                axisLine={axisLine}
                height={34}
                tickCount={7}
                label={{ value: "Smoke age, s", position: "insideBottom", offset: 2, ...axisTitle }}
              />
              <YAxis
                width={52}
                scale="log"
                domain={[30, 3000]}
                ticks={[30, 100, 300, 1000, 3000]}
                allowDataOverflow
                tick={tick}
                tickLine={false}
                axisLine={axisLine}
                label={{ value: "Particle size, nm", angle: -90, position: "insideLeft", offset: 6, style: { textAnchor: "middle" }, ...axisTitle }}
              />
              <Line type="linear" dataKey="normal" stroke={COLORS.muted} strokeWidth={1.5} dot={false} isAnimationActive={false} />
              <Line type="linear" dataKey="micro" stroke={COLORS.uv} strokeWidth={1.5} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        ) : failed ? (
          <LoadFailed />
        ) : (
          <Skeleton lines={5} className="px-3 pt-3" />
        )}
      </div>
      <div className="shrink-0 border-t border-line px-3.5 py-2.5">
        <div className="mb-2 grid grid-cols-4 gap-3">
          <Stat label="Size in orbit" value={m ? m.final_count_mean_diameter_nm.toFixed(0) : "--"} unit="nm" color={COLORS.uv} />
          <Stat label="Mass above 1 µm" value={m ? (m.final_mass_fraction_above_1um * 100).toFixed(0) : "--"} unit="%" />
          <Stat
            label="Ionization detector"
            value={m ? (m.ionization_per_mass[last] * 100).toFixed(1) : "--"}
            unit="% of fresh"
            color={COLORS.critical}
          />
          <Stat label="Optical detector" value={m ? `${m.photoelectric_per_mass[last].toFixed(0)}×` : "--"} unit="fresh" />
        </div>
        <Explain>
          With no buoyancy to carry it away, smoke stays put and its particles keep clumping together. Large particles
          are nearly invisible to ionization detectors, so only fans or an optical detector will find them.
        </Explain>
      </div>
    </Panel>
  );
}
