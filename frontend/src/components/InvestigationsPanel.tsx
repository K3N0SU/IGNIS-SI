"use client";

import { useEffect, useState } from "react";

import { api } from "@/lib/api";
import { COLORS } from "@/lib/regimes";
import type { ChamberQuery, Investigation, TestedRange } from "@/lib/types";

import { Panel, Skeleton } from "./ui";

function oxygen(r: TestedRange | null): string {
  if (!r) return "not recorded";
  const low = (r.low * 100).toFixed(0);
  const high = (r.high * 100).toFixed(0);
  return low === high ? `${low} %` : `${low} to ${high} %`;
}

function airflow(r: TestedRange | null): string {
  if (!r) return "not recorded";
  if (r.high === 0) return "still air";
  return r.low === r.high ? `${r.high} cm/s` : `${r.low} to ${r.high} cm/s`;
}

/**
 * NASA's microgravity combustion investigations, compared by fuel, oxygen,
 * airflow and sensors and ranked by how directly each bears on the scenario.
 */
export function InvestigationsPanel({ query, className = "" }: { query: ChamberQuery; className?: string }) {
  const [rows, setRows] = useState<Investigation[] | null>(null);
  const [scoring, setScoring] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const key = `${query.fuel}|${query.d0_mm}|${query.x_o2}|${query.pressure_atm}|${query.airflow_cm_s}`;

  useEffect(() => {
    const ctl = new AbortController();
    const id = window.setTimeout(() => {
      api
        .investigations(query, ctl.signal)
        .then((r) => {
          setRows(r.investigations);
          setScoring(r.scoring);
          setFailed(false);
        })
        .catch(() => {
          if (!ctl.signal.aborted) setFailed(true);
        });
    }, 200);
    return () => {
      window.clearTimeout(id);
      ctl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const records = rows ? rows.reduce((n, r) => n + r.records, 0) : 0;

  return (
    <Panel
      className={className}
      title="NASA investigations, ranked for your scenario"
      subtitle={rows ? `${rows.length} investigations, ${records.toLocaleString("en-US")} flight records, compared by fuel, oxygen, airflow and sensors` : "Loading"}
      bodyClassName="thin-scroll overflow-y-auto"
    >
      {failed ? (
        <p className="px-3.5 py-3 text-[12px] text-muted" role="alert">
          The investigation comparison could not be loaded.
        </p>
      ) : rows ? (
        <table className="w-full text-[12px]" data-testid="investigations">
          <thead className="sticky top-0 z-10 bg-panel">
            <tr className="border-b border-line text-left text-[11px] text-muted">
              <th className="w-8 px-3.5 py-2 font-medium">Rank</th>
              <th className="py-2 pl-2 font-medium">Investigation</th>
              <th className="py-2 font-medium">Fuels</th>
              <th className="py-2 font-medium">Oxygen</th>
              <th className="py-2 font-medium">Airflow</th>
              <th className="py-2 text-right font-medium">Records</th>
              <th className="px-3.5 py-2 text-right font-medium" title={scoring}>
                Relevance
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const expanded = open === r.key;
              const color = r.relevance >= 75 ? COLORS.nominal : r.relevance >= 55 ? COLORS.warning : COLORS.muted;
              return (
                <tr
                  key={r.key}
                  className="cursor-pointer border-b border-line/60 align-top last:border-b-0 hover:bg-inset"
                  onClick={() => setOpen(expanded ? null : r.key)}
                  aria-expanded={expanded}
                  data-investigation={r.key}
                >
                  <td className="num px-3.5 py-2 text-muted">{r.rank}</td>
                  <td className="py-2 pl-2 pr-3">
                    <div className="text-fg">
                      {r.name} <span className="text-[11px] text-muted">{r.type}, <span className="num">{r.period}</span></span>
                    </div>
                    <div className="mt-0.5 text-[11.5px] leading-snug text-muted">{r.why}</div>
                    {expanded ? (
                      <div className="mt-2 space-y-1.5 text-[11.5px] leading-snug">
                        {r.findings.map((f) => (
                          <p key={f} className="text-fg/90">
                            {f}
                          </p>
                        ))}
                        <p className="text-muted">
                          Sensors: {r.diagnostics.join(", ")}.
                        </p>
                        <p className="flex flex-wrap gap-x-3 gap-y-0.5">
                          {r.dataset_dois.map((d) => (
                            <a key={d} href={`https://doi.org/${d}`} target="_blank" rel="noreferrer" className="num text-uv underline-offset-2 hover:underline" onClick={(e) => e.stopPropagation()}>
                              {d}
                            </a>
                          ))}
                          {r.papers.slice(0, 2).map((p) => (
                            <a key={p.doi} href={p.url} target="_blank" rel="noreferrer" className="num text-uv underline-offset-2 hover:underline" onClick={(e) => e.stopPropagation()}>
                              {p.doi}
                            </a>
                          ))}
                        </p>
                      </div>
                    ) : null}
                  </td>
                  <td className="max-w-[150px] py-2 pr-3 text-muted">{r.fuels.slice(0, 3).join(", ")}</td>
                  <td className="num whitespace-nowrap py-2 pr-3">{oxygen(r.oxygen)}</td>
                  <td className="num whitespace-nowrap py-2 pr-3">{airflow(r.airflow)}</td>
                  <td className="num py-2 text-right">{r.records > 0 ? r.records : "none"}</td>
                  <td className="px-3.5 py-2">
                    <div className="flex items-center justify-end gap-2">
                      <div className="h-1 w-14 bg-line">
                        <div className="h-1" style={{ width: `${r.relevance}%`, backgroundColor: color }} />
                      </div>
                      <span className="num w-7 text-right" style={{ color }}>
                        {r.relevance.toFixed(0)}
                      </span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <Skeleton lines={8} className="p-3.5" />
      )}
    </Panel>
  );
}
