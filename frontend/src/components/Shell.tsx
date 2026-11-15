"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api } from "@/lib/api";
import { clock } from "@/lib/playback";
import { COLORS, DEFAULT_QUERY, STATUS_COLOR } from "@/lib/regimes";
import type { Assessment, ChamberQuery, Simulation } from "@/lib/types";

import { AnalyticsView, type AnalyticsFocus } from "./AnalyticsView";
import { ChamberControls } from "./ChamberControls";
import { CitationInspector } from "./CitationInspector";
import type { SensorMode } from "./CombustionTwin";
import { EclssPanel } from "./EclssPanel";
import { JudgeWalkthrough, type View, type WalkthroughController, type WorkbenchFocus } from "./JudgeWalkthrough";
import { TelemetryCharts } from "./TelemetryCharts";
import { TwinPanel } from "./TwinPanel";
import { Tag } from "./ui";

function UtcClock() {
  const [now, setNow] = useState<string>("--:--:--");
  useEffect(() => {
    const update = (): void => setNow(new Date().toISOString().slice(11, 19));
    update();
    const id = window.setInterval(update, 1000);
    return () => window.clearInterval(id);
  }, []);
  return <span className="num text-[11px] text-muted">UTC {now}</span>;
}

export function Shell({ initialView }: { initialView: View }) {
  const [query, setQueryState] = useState<ChamberQuery>(DEFAULT_QUERY);
  const [sim, setSim] = useState<Simulation | null>(null);
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<SensorMode>("optical");
  const [view, setViewState] = useState<View>(initialView);
  const [focus, setFocus] = useState<WorkbenchFocus>(null);
  const [analyticsFocus, setAnalyticsFocus] = useState<AnalyticsFocus>(null);
  const [riskFilter, setRiskFilter] = useState("ALL");
  const [touring, setTouring] = useState(false);
  const firstLoad = useRef(true);

  const setQuery = useCallback((patch: Partial<ChamberQuery>) => setQueryState((q) => ({ ...q, ...patch })), []);

  const setView = useCallback((next: View) => {
    setViewState(next);
    window.history.replaceState(null, "", next === "analytics" ? "/analytics" : "/");
  }, []);

  useEffect(() => {
    const ctl = new AbortController();
    setLoading(true);
    const id = window.setTimeout(() => {
      api
        .simulate(query, ctl.signal)
        .then((result) => {
          setSim(result);
          setError(null);
          setLoading(false);
          const duration = result.t[result.t.length - 1];
          clock.load(duration, result.query.dt_s, !firstLoad.current);
          if (firstLoad.current) {
            firstLoad.current = false;
            clock.play();
          }
        })
        .catch((e: unknown) => {
          if (ctl.signal.aborted) return;
          setLoading(false);
          setError(e instanceof Error ? e.message : "Solver request failed");
        });
    }, 90);
    return () => {
      window.clearTimeout(id);
      ctl.abort();
    };
  }, [query]);

  useEffect(() => {
    const ctl = new AbortController();
    const id = window.setTimeout(() => {
      api.uncertainty(query, ctl.signal).then(setAssessment).catch(() => undefined);
    }, 350);
    return () => {
      window.clearTimeout(id);
      ctl.abort();
    };
  }, [query]);

  const controller = useMemo<WalkthroughController>(
    () => ({ setQuery, setMode, setView, setFocus, setAnalyticsFocus, setRiskFilter }),
    [setQuery, setView],
  );
  const exitTour = useCallback(() => setTouring(false), []);

  const hazard = sim?.protocol.hazard_level;

  return (
    <div className="flex h-screen min-h-0 flex-col gap-2 p-2">
      <header className="flex h-10 shrink-0 items-center justify-between rounded-md border border-line bg-panel px-3">
        <div className="flex items-center gap-4">
          <span className="text-[13px] font-semibold tracking-[0.14em] text-fg">IGNIS-SI</span>
          <span className="h-4 w-px bg-line-strong" />
          <span className="num text-[11px] tracking-wider text-muted" data-testid="mission-id">
            ISS-DESTINY // CIR-FLEX2
          </span>
          <nav className="ml-2 flex">
            {(["workbench", "analytics"] as View[]).map((v) => (
              <button
                key={v}
                type="button"
                data-testid={`nav-${v}`}
                onClick={() => setView(v)}
                className={`h-10 border-b-2 px-3 text-[11px] font-semibold uppercase tracking-wider ${
                  view === v ? "border-fg text-fg" : "border-transparent text-muted hover:text-fg"
                }`}
              >
                {v}
              </button>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-4">
          {error ? <span className="num text-[11px] text-critical">API LINK DOWN: {error}</span> : null}
          {hazard ? <Tag color={STATUS_COLOR[hazard]}>HAZARD {hazard}</Tag> : null}
          {assessment ? (
            <Tag color={STATUS_COLOR[assessment.verdict]}>DATA {assessment.verdict.replace("_", " ")}</Tag>
          ) : null}
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-[1px]" style={{ backgroundColor: error ? COLORS.critical : COLORS.nominal }} />
            <span className="num text-[11px] text-muted">SOLVER {error ? "OFFLINE" : "ONLINE"}</span>
          </span>
          <UtcClock />
          <button
            type="button"
            data-testid="walkthrough-launch"
            onClick={() => setTouring((v) => !v)}
            className="h-7 rounded-md border border-line-strong px-3 text-[11px] font-semibold tracking-wide text-fg hover:bg-line"
          >
            {touring ? "Stop walkthrough" : "▶ Launch 90s Judge Walkthrough"}
          </button>
        </div>
      </header>

      <main className="min-h-0 flex-1">
        {view === "workbench" ? (
          <div className="grid h-full min-h-0 grid-cols-[344px_minmax(0,1fr)_440px] gap-2">
            <div className="grid min-h-0 grid-rows-[minmax(0,1.08fr)_minmax(0,1fr)] gap-2">
              <ChamberControls query={query} onChange={setQuery} sim={sim} loading={loading} highlight={focus === "controls"} />
              <EclssPanel sim={sim} highlight={focus === "eclss"} />
            </div>
            <div className="min-h-0">
              <TwinPanel sim={sim} mode={mode} onMode={setMode} highlight={focus === "twin"} />
            </div>
            <div className="grid min-h-0 grid-rows-[minmax(0,1.5fr)_minmax(0,1fr)] gap-2">
              <TelemetryCharts sim={sim} highlight={focus === "telemetry"} />
              <CitationInspector sim={sim} assessment={assessment} highlight={focus === "inspector"} />
            </div>
          </div>
        ) : (
          <AnalyticsView query={query} assessment={assessment} focus={analyticsFocus} riskFilter={riskFilter} />
        )}
      </main>

      <JudgeWalkthrough active={touring} controller={controller} onExit={exitTour} />
    </div>
  );
}
