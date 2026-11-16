"use client";

import { useEffect, useMemo, useState } from "react";

import { api } from "@/lib/api";
import { COLORS, STATUS_COLOR, sentenceCase } from "@/lib/regimes";
import type { RiskBoard } from "@/lib/types";

import { Panel, Segmented, Skeleton, Term } from "../ui";
import { Explain, LoadFailed, useFetch } from "./shared";

function Score({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="hidden h-1 w-14 overflow-hidden rounded-[1px] bg-line min-[1200px]:block">
        <div className="h-1 bg-muted" style={{ width: `${value}%` }} />
      </div>
      <span className="num w-8 text-right text-fg">{value.toFixed(0)}</span>
    </div>
  );
}

const FILTERS = [
  { value: "ALL", label: "All" },
  { value: "ISS", label: "ISS, 21 %" },
  { value: "EVA_PREP", label: "10.2 psia, 26.5 %" },
  { value: "ARTEMIS", label: "Artemis, 34 %" },
];

export function RiskLeaderboard({ highlight, focus }: { highlight?: boolean; focus: string }) {
  const { data: board, failed } = useFetch<RiskBoard>((signal) => api.risk(signal), "risk");
  const [filter, setFilter] = useState<string>("ALL");
  useEffect(() => setFilter(focus), [focus]);

  const rows = useMemo(
    () => (board ? board.entries.filter((e) => filter === "ALL" || e.atmosphere === filter) : []),
    [board, filter],
  );
  const th = "whitespace-nowrap py-2 text-[11px] font-medium text-muted";

  return (
    <Panel
      title="Material fire risk"
      help="Common cabin materials ranked by how easily they ignite, how much carbon monoxide they make and how hard they are to put out."
      subtitle="Cabin materials ranked in each cabin atmosphere"
      highlight={highlight}
      className="h-full"
      bodyClassName="thin-scroll overflow-y-auto"
      right={
        <>
          <span className="hidden text-[11.5px] text-muted min-[1200px]:inline">Oxygen level</span>
          <Segmented size="sm" testId="risk-filter" ariaLabel="Cabin atmosphere" value={filter} onChange={setFilter} options={FILTERS} />
        </>
      }
    >
      {failed && !board ? <LoadFailed /> : null}
      {!board && !failed ? <Skeleton lines={10} className="px-3.5 py-3" /> : null}
      <table className={`w-full text-[12px] ${board ? "" : "hidden"}`} data-testid="risk-table">
        <thead className="sticky top-0 z-10 bg-panel shadow-[0_1px_0_var(--color-line)]">
          <tr className="text-left">
            <th className={`${th} w-[60px] pl-3.5`}>Rank</th>
            <th className={th}>Material</th>
            <th className={th}>Atmosphere</th>
            <th className={`${th} pr-5 text-right`}>
              <Term k="limitingO2">Oxygen margin</Term>
            </th>
            <th className={`${th} pr-4`}>Ignition</th>
            <th className={`${th} pr-4`}>CO yield</th>
            <th className={`${th} pr-4`}>Suppression</th>
            <th className={`${th} text-right`}>Risk score</th>
            <th className={`${th} w-[92px] pl-5`}>Level</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => {
            const color = STATUS_COLOR[e.severity];
            return (
              <tr key={`${e.material}-${e.atmosphere}`} className="border-b border-line/70 last:border-b-0 hover:bg-raised">
                <td className="num py-1 pl-3.5 text-muted">{e.rank}</td>
                <td className="whitespace-nowrap py-1 pr-3 font-medium text-fg">{e.material_name}</td>
                <td className="whitespace-nowrap py-1 pr-3 text-muted">
                  {e.atmosphere_name}
                  <span className="num ml-2 hidden text-[11px] text-faint min-[1360px]:inline">
                    {(e.x_o2 * 100).toFixed(1)} % O₂, {e.pressure_atm.toFixed(2)} atm
                  </span>
                </td>
                <td
                  className="num py-1 pr-5 text-right"
                  style={{ color: e.oxygen_margin_pct > 0 ? COLORS.critical : COLORS.nominal }}
                >
                  {e.oxygen_margin_pct > 0 ? "+" : "−"}
                  {Math.abs(e.oxygen_margin_pct).toFixed(1)} pts
                </td>
                <td className="py-1">
                  <Score value={e.ignition_propensity} />
                </td>
                <td className="py-1">
                  <Score value={e.toxic_co_yield} />
                </td>
                <td className="py-1">
                  <Score value={e.suppression_difficulty} />
                </td>
                <td className="num py-1 text-right text-[13px] font-semibold" style={{ color }}>
                  {e.composite.toFixed(1)}
                </td>
                <td className="py-1 pl-5 pr-3.5 font-medium" style={{ color }}>
                  <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle" style={{ backgroundColor: color }} />
                  {sentenceCase(e.severity)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {board ? (
        <div className="border-t border-line px-3.5 py-2.5">
          <Explain>
            Scores run from 0 to 100 and higher is worse. A positive oxygen margin (red) means the cabin holds more
            oxygen than the material needs to keep burning. {board.basis}
          </Explain>
        </div>
      ) : null}
    </Panel>
  );
}
