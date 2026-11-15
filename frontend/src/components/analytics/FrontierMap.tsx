"use client";

import { api } from "@/lib/api";
import { COLORS, STATUS_COLOR, sentenceCase } from "@/lib/regimes";
import type { Assessment, ChamberQuery, FrontierGrid, Verdict } from "@/lib/types";

import { Panel, Skeleton, Tag, Term } from "../ui";
import { LoadFailed, useDebounced, useFetch, useSize } from "./shared";

const VERDICT_FILL: Record<Verdict, string> = {
  VERIFIED: "rgba(16,185,129,0.45)",
  INTERPOLATED: "rgba(245,158,11,0.36)",
  BEYOND_FRONTIER: "rgba(239,68,68,0.12)",
};
const VERDICT_LABEL: Record<Verdict, string> = {
  VERIFIED: "Tested on the ISS",
  INTERPOLATED: "Between tested points",
  BEYOND_FRONTIER: "Never tested",
};
const OUTCOME_LABEL: Record<string, string> = {
  NO_IGNITION: "no ignition",
  HOT_BURNOUT: "burns out hot",
  COOL_FLAME: "cool flame persists",
  REIGNITION: "re-ignition",
  BLOWOFF: "blown out",
};
const VERDICTS: Verdict[] = ["VERIFIED", "INTERPOLATED", "BEYOND_FRONTIER"];

const PAD = { left: 48, right: 10, top: 8, bottom: 36 };

function Grid({ grid, query, width, height }: { grid: FrontierGrid; query: ChamberQuery; width: number; height: number }) {
  const cols = grid.o2.length;
  const rows = grid.airflow_cm_s.length;
  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  const cw = plotW / cols;
  const ch = plotH / rows;
  const o2Min = grid.o2[0];
  const o2Step = grid.o2[1] - grid.o2[0];
  const uMin = grid.airflow_cm_s[0];
  const uStep = grid.airflow_cm_s[1] - grid.airflow_cm_s[0];
  const clamp = (v: number, n: number): number => Math.min(Math.max(v, 0), n - 1);
  // Values map to cell centres, so a tick sits under the middle of its column.
  const x = (o2: number): number => PAD.left + (clamp((o2 - o2Min) / o2Step, cols) + 0.5) * cw;
  const y = (u: number): number => PAD.top + plotH - (clamp((u - uMin) / uStep, rows) + 0.5) * ch;
  const qx = x(query.x_o2);
  const qy = y(query.airflow_cm_s);
  const labelLeft = qx > width - 120;
  const labelBelow = qy < PAD.top + 24;

  const cells = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      cells.push(
        <rect
          key={`${r}-${c}`}
          x={PAD.left + c * cw}
          y={PAD.top + plotH - (r + 1) * ch}
          width={Math.max(cw - 1, 1)}
          height={Math.max(ch - 1, 1)}
          fill={VERDICT_FILL[grid.verdict[r][c]]}
        />,
      );
    }
  }

  return (
    <svg width={width} height={height} className="block" role="img" aria-label="Map of tested oxygen and airflow conditions">
      {cells}
      {[0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4].map((v) => (
        <text key={v} x={x(v)} y={height - PAD.bottom + 14} textAnchor="middle" className="num" fontSize={10} fill={COLORS.muted}>
          {(v * 100).toFixed(0)}
        </text>
      ))}
      {[0, 5, 10, 15, 20].map((u) => (
        <text key={u} x={PAD.left - 8} y={y(u) + 3.5} textAnchor="end" className="num" fontSize={10} fill={COLORS.muted}>
          {u}
        </text>
      ))}
      <text x={PAD.left + plotW / 2} y={height - 5} textAnchor="middle" fontSize={10.5} fill={COLORS.muted}>
        Oxygen, % by volume
      </text>
      <text
        transform={`translate(12 ${PAD.top + plotH / 2}) rotate(-90)`}
        textAnchor="middle"
        fontSize={10.5}
        fill={COLORS.muted}
      >
        Airflow, cm/s
      </text>
      <line x1={qx} x2={qx} y1={PAD.top} y2={PAD.top + plotH} stroke={COLORS.fg} strokeWidth={0.75} strokeDasharray="2 3" opacity={0.7} />
      <line x1={PAD.left} x2={PAD.left + plotW} y1={qy} y2={qy} stroke={COLORS.fg} strokeWidth={0.75} strokeDasharray="2 3" opacity={0.7} />
      <rect x={qx - 5} y={qy - 5} width={10} height={10} fill={COLORS.canvas} stroke={COLORS.fg} strokeWidth={1.5} />
      <text
        x={labelLeft ? qx - 10 : qx + 10}
        y={labelBelow ? qy + 18 : qy - 9}
        textAnchor={labelLeft ? "end" : "start"}
        fontSize={11}
        fontWeight={500}
        fill={COLORS.fg}
        stroke={COLORS.canvas}
        strokeWidth={3}
        paintOrder="stroke"
      >
        Your scenario
      </text>
    </svg>
  );
}

export function FrontierMap({
  query,
  assessment,
  highlight,
}: {
  query: ChamberQuery;
  assessment: Assessment | null;
  highlight?: boolean;
}) {
  const key = useDebounced(`${query.fuel}|${query.d0_mm}|${query.pressure_atm}|${query.diluent}`, 250);
  const { data: grid, failed } = useFetch<FrontierGrid>(
    (signal) =>
      api.frontier({ fuel: query.fuel, d0_mm: query.d0_mm, pressure_atm: query.pressure_atm, diluent: query.diluent }, signal),
    key,
  );
  const [plotRef, plot] = useSize<HTMLDivElement>();
  const outcomes = assessment?.outcome_distribution
    ? Object.entries(assessment.outcome_distribution)
        .filter(([, p]) => p > 0)
        .sort((a, b) => b[1] - a[1])
    : [];

  return (
    <Panel
      title="Tested conditions"
      subtitle="Where flight data exists, and where your scenario sits"
      highlight={highlight}
      className="h-full"
      bodyClassName="flex flex-col"
      right={assessment ? <Tag color={STATUS_COLOR[assessment.verdict]}>{sentenceCase(assessment.verdict)}</Tag> : null}
    >
      <div ref={plotRef} className="mx-2 mt-2.5 min-h-0 flex-1" data-testid="frontier-map">
        {grid && plot.width > 120 && plot.height > 80 ? (
          <Grid grid={grid} query={query} width={plot.width} height={plot.height} />
        ) : failed ? (
          <LoadFailed />
        ) : (
          <Skeleton lines={5} className="px-2 pt-2" />
        )}
      </div>
      <div className="shrink-0 border-t border-line px-3.5 py-2.5">
        <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1">
          {VERDICTS.map((v) => (
            <span key={v} className="flex items-center gap-1.5 text-[11.5px] text-muted">
              <span className="h-2.5 w-2.5 rounded-[2px] border" style={{ backgroundColor: VERDICT_FILL[v], borderColor: `${STATUS_COLOR[v]}77` }} />
              {VERDICT_LABEL[v]}
            </span>
          ))}
        </div>
        <p className="text-[13px] font-medium leading-snug text-fg">
          {assessment?.summary ?? "Checking your scenario against the tested range."}
        </p>
        <p className="mt-1 text-[12px] leading-snug text-muted">
          Each cell is one combination of oxygen and airflow for this fuel, droplet size and pressure. Outside the green{" "}
          <Term k="envelope">tested range</Term> the model has no flight data to check itself against.
          {outcomes.length ? (
            <>
              {" "}
              Across <span className="num">{assessment?.ensemble_size}</span> <Term k="ensemble">model runs</Term>:{" "}
              {outcomes.map(([outcome, p], i) => (
                <span key={outcome}>
                  {i > 0 ? ", " : ""}
                  {OUTCOME_LABEL[outcome] ?? sentenceCase(outcome).toLowerCase()} <span className="num text-fg">{(p * 100).toFixed(0)} %</span>
                </span>
              ))}
              .
            </>
          ) : null}
        </p>
      </div>
    </Panel>
  );
}
