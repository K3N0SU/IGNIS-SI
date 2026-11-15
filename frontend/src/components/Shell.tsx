"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api } from "@/lib/api";
import { clock } from "@/lib/playback";
import { COLORS, DEFAULT_QUERY } from "@/lib/regimes";
import type { Assessment, AssistantAction, ChamberQuery, Simulation } from "@/lib/types";
import { VIEWS, type View } from "@/lib/views";

import { AnalyticsView, type AnalyticsFocus } from "./AnalyticsView";
import { AssistantPanel } from "./AssistantPanel";
import { ChamberControls } from "./ChamberControls";
import { CitationInspector } from "./CitationInspector";
import type { SensorMode } from "./CombustionTwin";
import { EclssPanel } from "./EclssPanel";
import { FlightDataView } from "./FlightDataView";
import { GuidedTour, type TourController, type WorkbenchFocus } from "./GuidedTour";
import { TelemetryCharts } from "./TelemetryCharts";
import { TwinPanel } from "./TwinPanel";

function UtcClock() {
  const [now, setNow] = useState<string>("--:--:--");
  useEffect(() => {
    const update = (): void => setNow(new Date().toISOString().slice(11, 19));
    update();
    const id = window.setInterval(update, 1000);
    return () => window.clearInterval(id);
  }, []);
  return (
    <span className="text-[12px] text-muted" title="Coordinated Universal Time">
      <span className="num text-fg">{now}</span> UTC
    </span>
  );
}

function Wordmark() {
  return (
    <div className="flex items-center gap-2.5">
      <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
        <circle cx="11" cy="11" r="9.25" fill="none" stroke={COLORS.uv} strokeWidth="1.5" />
        <circle cx="11" cy="11" r="5.5" fill="none" stroke={COLORS.warning} strokeWidth="1.5" />
        <circle cx="11" cy="11" r="2" fill={COLORS.fg} />
      </svg>
      <div className="leading-none">
        <div className="text-[14px] font-semibold tracking-[0.08em] text-fg">IGNIS-SI</div>
        <div className="mt-1 text-[10.5px] text-muted">Spacecraft fire safety</div>
      </div>
    </div>
  );
}

function ApiDown({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex h-full items-center justify-center" role="alert" data-testid="api-error">
      <div className="w-[520px] max-w-full rounded-md border border-line bg-panel p-6">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-critical" />
          <h2 className="text-[15px] font-semibold text-fg">The simulation service is not responding</h2>
        </div>
        <p className="mt-2 text-[13px] leading-relaxed text-muted">
          This page needs the IGNIS-SI solver running on this computer at port 8000. Nothing can be simulated until
          it is back.
        </p>
        <div className="mt-4 text-[12px] text-muted">To start it, run this from the project folder:</div>
        <pre className="num mt-1.5 rounded-md border border-line bg-inset px-3 py-2.5 text-[12px] leading-relaxed text-fg">
          {"./start.sh        macOS, Linux, Git Bash\nstart.bat         Windows"}
        </pre>
        <div className="mt-4 flex items-center justify-between gap-4">
          <span className="num min-w-0 truncate text-[11px] text-faint">{message}</span>
          <button
            type="button"
            onClick={onRetry}
            className="h-8 shrink-0 rounded-md border border-line-strong px-4 text-[12px] font-medium text-fg hover:bg-line"
          >
            Try again
          </button>
        </div>
      </div>
    </div>
  );
}

const isTypingTarget = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && target.closest("input, select, textarea, button, [role='slider'], a") !== null;

export function Shell({ initialView }: { initialView: View }) {
  const [query, setQueryState] = useState<ChamberQuery>(DEFAULT_QUERY);
  const [sim, setSim] = useState<Simulation | null>(null);
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [mode, setMode] = useState<SensorMode>("optical");
  const [view, setViewState] = useState<View>(initialView);
  const [focus, setFocus] = useState<WorkbenchFocus>(null);
  const [analyticsFocus, setAnalyticsFocus] = useState<AnalyticsFocus>(null);
  const [riskFilter, setRiskFilter] = useState("ALL");
  const [touring, setTouring] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const firstLoad = useRef(true);
  const autoRetries = useRef(0);

  const setQuery = useCallback((patch: Partial<ChamberQuery>) => setQueryState((q) => ({ ...q, ...patch })), []);

  const setView = useCallback((next: View) => {
    setViewState(next);
    window.history.replaceState(null, "", VIEWS.find((v) => v.key === next)?.path ?? "/");
  }, []);

  const applyAssistantAction = useCallback(
    (action: AssistantAction) => {
      setQueryState((q) => ({ ...q, ...action.query }));
      if (action.sensor_view) setMode(action.sensor_view);
      setView("workbench");
      window.setTimeout(() => {
        clock.seek(0);
        clock.play();
      }, 400);
    },
    [setView],
  );

  useEffect(() => {
    const ctl = new AbortController();
    setLoading(true);
    const id = window.setTimeout(() => {
      api
        .simulate(query, ctl.signal)
        .then((result) => {
          setSim(result);
          setError(null);
          autoRetries.current = 0;
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
          // The service restarts itself within a few seconds; try again before asking the user to.
          if (autoRetries.current < 4) {
            autoRetries.current += 1;
            window.setTimeout(() => setRetry((n) => n + 1), 2500);
          }
        });
    }, 90);
    return () => {
      window.clearTimeout(id);
      ctl.abort();
    };
  }, [query, retry]);

  useEffect(() => {
    const ctl = new AbortController();
    const id = window.setTimeout(() => {
      api.uncertainty(query, ctl.signal).then(setAssessment).catch(() => undefined);
    }, 350);
    return () => {
      window.clearTimeout(id);
      ctl.abort();
    };
  }, [query, retry]);

  useEffect(() => {
    if (view !== "workbench") return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.code !== "Space" || e.repeat || isTypingTarget(e.target)) return;
      e.preventDefault();
      clock.toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view]);

  const controller = useMemo<TourController>(
    () => ({ setQuery, setMode, setView, setFocus, setAnalyticsFocus, setRiskFilter }),
    [setQuery, setView],
  );
  const exitTour = useCallback(() => setTouring(false), []);
  const retryNow = useCallback(() => setRetry((n) => n + 1), []);

  const link = error
    ? { color: COLORS.critical, text: "Solver offline" }
    : loading
      ? { color: COLORS.muted, text: "Solving" }
      : { color: COLORS.nominal, text: "Solver online" };

  return (
    <div className="flex h-screen min-h-0 flex-col">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-line bg-panel px-4">
        <div className="flex h-full items-center gap-5">
          <Wordmark />
          <span className="h-6 w-px bg-line" />
          <div className="hidden leading-none min-[1280px]:block" data-testid="mission-id">
            <div className="text-[12px] font-medium text-fg">ISS Destiny laboratory</div>
            <div className="mt-1 text-[10.5px] text-muted">Combustion Integrated Rack</div>
          </div>
          <nav className="ml-3 flex h-full" aria-label="Views">
            {VIEWS.map((v) => (
              <button
                key={v.key}
                type="button"
                data-testid={`nav-${v.key}`}
                aria-current={view === v.key ? "page" : undefined}
                onClick={() => setView(v.key)}
                className={`relative h-full px-4 text-[13px] font-medium transition-colors ${
                  view === v.key ? "text-fg" : "text-muted hover:text-fg"
                }`}
              >
                {v.label}
                {view === v.key ? <span className="absolute inset-x-3 bottom-0 h-0.5 bg-fg" /> : null}
              </button>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-5">
          <span className="flex items-center gap-2" role="status" data-testid="solver-status">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: link.color }} />
            <span className="w-[86px] text-[12px] text-muted">{link.text}</span>
          </span>
          <UtcClock />
          <button
            type="button"
            data-testid="assistant-launch"
            aria-pressed={assistantOpen}
            onClick={() => setAssistantOpen((v) => !v)}
            className={`h-8 rounded-md border px-3.5 text-[12px] font-medium text-fg hover:bg-line ${
              assistantOpen ? "border-uv bg-uv/10" : "border-line-strong"
            }`}
          >
            Ask assistant
          </button>
          <button
            type="button"
            data-testid="tour-launch"
            aria-pressed={touring}
            onClick={() => setTouring((v) => !v)}
            className="h-8 rounded-md border border-line-strong px-3.5 text-[12px] font-medium text-fg hover:bg-line"
          >
            {touring ? "End tour" : "Guided tour"}
          </button>
        </div>
      </header>

      <main className="min-h-0 flex-1 p-2">
        {error && !sim ? (
          <ApiDown message={error} onRetry={retryNow} />
        ) : view === "workbench" ? (
          <div className="flex h-full min-h-0 flex-col gap-2">
            {error ? (
              <div
                role="alert"
                className="flex shrink-0 items-center justify-between rounded-md border border-critical/40 bg-critical/10 px-3.5 py-2 text-[12px] text-fg"
              >
                <span>
                  The simulation service stopped responding. You are looking at the last result it returned; changes
                  to the scenario will not be applied.
                </span>
                <button type="button" onClick={retryNow} className="font-medium underline underline-offset-2">
                  Try again
                </button>
              </div>
            ) : null}
            <div className="grid min-h-0 flex-1 grid-cols-[320px_minmax(0,1fr)_384px] gap-2 min-[1700px]:grid-cols-[368px_minmax(0,1fr)_448px]">
              <div className="grid min-h-0 grid-rows-[minmax(0,1.3fr)_minmax(0,1fr)] gap-2">
                <ChamberControls query={query} onChange={setQuery} sim={sim} loading={loading} highlight={focus === "controls"} />
                <EclssPanel sim={sim} highlight={focus === "eclss"} />
              </div>
              <div className="min-h-0">
                <TwinPanel sim={sim} mode={mode} onMode={setMode} highlight={focus === "twin"} />
              </div>
              <div className="grid min-h-0 grid-rows-[minmax(0,1.45fr)_minmax(0,1fr)] gap-2">
                <TelemetryCharts sim={sim} highlight={focus === "telemetry"} reference={assessment?.nearest_tests[0] ?? null} />
                <CitationInspector sim={sim} assessment={assessment} highlight={focus === "inspector"} />
              </div>
            </div>
          </div>
        ) : view === "flight" ? (
          <FlightDataView query={query} sim={sim} assessment={assessment} />
        ) : (
          <AnalyticsView query={query} assessment={assessment} focus={analyticsFocus} riskFilter={riskFilter} />
        )}
      </main>

      <AssistantPanel
        open={assistantOpen}
        onClose={() => setAssistantOpen(false)}
        query={query}
        mode={mode}
        onApply={applyAssistantAction}
      />
      <GuidedTour active={touring} controller={controller} onExit={exitTour} />
    </div>
  );
}
