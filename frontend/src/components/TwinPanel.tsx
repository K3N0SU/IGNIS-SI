"use client";

import { type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { clock, usePlayback } from "@/lib/playback";
import { notableEvents, placeLabels } from "@/lib/events";
import { COLORS, REGIME_STYLE, fmt, runs } from "@/lib/regimes";
import type { Regime, Simulation } from "@/lib/types";

import { CombustionTwin, type SensorMode, flameExtent, sample } from "./CombustionTwin";
import { Panel, Readout, Segmented, Skeleton, Term, Tip } from "./ui";

const VISIBLE_THRESHOLD = 0.01;
const UV_THRESHOLD = 1e-4;
const DAMKOHLER_MARGINAL = 1.5;

const isCool = (regime: Regime): boolean => regime === "INVISIBLE_COOL_FLAME" || regime === "RE_IGNITION_RISK";

function SensorCell({
  name,
  sees,
  seesText,
  detail,
  color,
  alarm,
  testId,
  help,
}: {
  name: string;
  help: string;
  sees: boolean;
  seesText: string;
  detail: string;
  color: string;
  alarm?: boolean;
  testId?: string;
}) {
  return (
    <div className="w-[168px] shrink-0 border-l border-line px-3.5 py-2.5" data-testid={testId}>
      <div className="text-[11px] text-muted">
        <Tip text={help} className="cursor-help">
          {name}
        </Tip>
      </div>
      <div className="mt-0.5 flex items-center gap-1.5 text-[13px] font-medium text-fg">
        <span
          className="h-2 w-2 rounded-full border"
          style={{ backgroundColor: sees ? color : "transparent", borderColor: sees ? color : COLORS.faint }}
        />
        {sees ? seesText : "Sees nothing"}
      </div>
      <div className="mt-0.5 truncate text-[11.5px]" style={{ color: alarm ? COLORS.critical : COLORS.muted }}>
        {detail}
      </div>
    </div>
  );
}

/** The one place that says, in plain words, what is happening and which sensors can tell. */
function StatusStrip({ sim }: { sim: Simulation }) {
  const { index } = usePlayback();
  const i = Math.min(index, sim.t.length - 1);
  const regime = sim.regime[i];
  const style = REGIME_STYLE[regime];
  const cool = isCool(regime);
  const opticalSees = sim.series.visible_luminosity[i] > VISIBLE_THRESHOLD;
  const uvSees = sim.series.uv_intensity[i] > UV_THRESHOLD;
  const predicted = REGIME_STYLE[sim.classifier.labels[i]];
  const confidence = sim.classifier.confidence[i];

  return (
    <div className="@container shrink-0 border-b border-line">
      <div className="flex items-stretch">
        <div className="min-w-0 flex-1 px-3.5 py-2.5" aria-live="polite">
          <div className="text-[11px] text-muted">
            <Tip text="What the fire is doing at this moment of the playback, according to the physics model." className="cursor-help">
              Fire state
            </Tip>
          </div>
          <div className="mt-0.5 flex items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ backgroundColor: style.color }} />
            <span className="truncate text-[17px] font-semibold leading-6 text-fg" data-testid="fire-state">
              {style.label}
            </span>
          </div>
          <p className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-muted">{style.plain}</p>
        </div>
        <SensorCell
          testId="twin-status"
          name="Optical camera"
          help="An ordinary camera, like the ones watching the cabin. It only sees flames that give off visible light."
          sees={opticalSees}
          seesText="Sees a flame"
          detail={opticalSees ? "Visible light" : cool ? "Blind to the cool flame" : "Nothing is glowing"}
          color={COLORS.warning}
          alarm={!opticalSees && cool}
        />
        <SensorCell
          name="UV sensor"
          help="A detector tuned to ultraviolet light from burning chemistry. It still sees a cool flame that is invisible to a camera."
          sees={uvSees}
          seesText="Detects emission"
          detail={uvSees ? (cool ? "Cool flame, still burning" : "Hot flame") : "No ultraviolet signal"}
          color={COLORS.uv}
        />
        <div className="hidden w-[176px] shrink-0 border-l border-line px-3.5 py-2.5 @[820px]:block" data-testid="ml-readout">
          <div className="text-[11px] text-muted">
            <Term k="classifier">Sensor classifier</Term>
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[13px] font-medium text-fg">
            <span className="h-2 w-2 shrink-0 rounded-[2px]" style={{ backgroundColor: predicted.color }} />
            <span className="truncate">{predicted.label}</span>
          </div>
          <div className="mt-0.5 text-[11.5px] text-muted">
            <span className="num">{(confidence * 100).toFixed(0)}</span> % confident
          </div>
        </div>
      </div>
    </div>
  );
}

function ScaleBar({ pxPerMm }: { pxPerMm: number }) {
  const mm = [1, 2, 5, 10, 20].find((v) => v * pxPerMm >= 56) ?? 20;
  return (
    <div className="flex flex-col gap-1">
      <div className="h-1.5 border-x border-b border-muted" style={{ width: mm * pxPerMm }} />
      <span className="num text-[11px] text-muted">{mm} mm</span>
    </div>
  );
}

function Reticle() {
  const corner = "absolute h-3 w-3 border-line-strong";
  return (
    <div className="pointer-events-none absolute inset-2.5" aria-hidden="true">
      <div className={`${corner} left-0 top-0 border-l border-t`} />
      <div className={`${corner} right-0 top-0 border-r border-t`} />
      <div className={`${corner} bottom-0 left-0 border-b border-l`} />
      <div className={`${corner} bottom-0 right-0 border-b border-r`} />
      <div className="absolute left-0 top-1/2 h-px w-2 bg-line-strong" />
      <div className="absolute right-0 top-1/2 h-px w-2 bg-line-strong" />
      <div className="absolute left-1/2 top-0 h-2 w-px bg-line-strong" />
      <div className="absolute bottom-0 left-1/2 h-2 w-px bg-line-strong" />
    </div>
  );
}

const FLAME_ANGLE = (-38 * Math.PI) / 180;
const DROPLET_ANGLE = (40 * Math.PI) / 180;

/**
 * Leader-line labels for the droplet and the flame front. Positions follow the
 * playback clock directly so the labels track the rendered geometry frame by frame.
 */
function Callouts({ sim, mode, pxPerMm }: { sim: Simulation; mode: SensorMode; pxPerMm: number }) {
  const flameRef = useRef<HTMLDivElement>(null);
  const flameText = useRef<HTMLSpanElement>(null);
  const flameName = useRef<HTMLSpanElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const dropText = useRef<HTMLSpanElement>(null);
  const redraw = useRef<() => void>(() => undefined);
  const state = useRef({ sim, mode, pxPerMm });
  state.current = { sim, mode, pxPerMm };

  useEffect(() => {
    const draw = (t: number): void => {
      const { sim: s, mode: m, pxPerMm: k } = state.current;
      const d = sample(s, "d_mm", t);
      const flameD = sample(s, "flame_diameter_mm", t);
      const airflow = sample(s, "airflow_cm_s", t);
      const seen =
        m === "optical" ? sample(s, "visible_luminosity", t) > VISIBLE_THRESHOLD : sample(s, "uv_intensity", t) > UV_THRESHOLD;
      const regime = s.regime[Math.min(Math.round(t / s.query.dt_s), s.regime.length - 1)];

      const flame = flameRef.current;
      if (flame) {
        const e = flameExtent(flameD, d, airflow);
        const x = (e.cx + e.rx * Math.cos(FLAME_ANGLE)) * k;
        const y = e.ry * Math.sin(FLAME_ANGLE) * k;
        flame.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
        flame.style.opacity = seen && flameD > d * 1.2 ? "1" : "0";
        if (flameText.current) flameText.current.textContent = flameD.toFixed(1);
        if (flameName.current) flameName.current.textContent = isCool(regime) ? "Cool flame" : "Flame front";
      }
      const drop = dropRef.current;
      if (drop) {
        const r = (d / 2) * k;
        drop.style.transform = `translate(${(r * Math.cos(DROPLET_ANGLE)).toFixed(1)}px, ${(r * Math.sin(DROPLET_ANGLE)).toFixed(1)}px)`;
        drop.style.opacity = d > 0.4 ? "1" : "0";
        if (dropText.current) dropText.current.textContent = d.toFixed(2);
      }
    };
    redraw.current = () => draw(clock.time);
    return clock.onFrame(draw);
  }, []);

  // Sensor mode and zoom change outside the clock; redraw so a paused view stays correct.
  useEffect(() => redraw.current(), [mode, pxPerMm, sim]);

  const label = "absolute whitespace-nowrap rounded-[3px] bg-[#050608]/85 px-1.5 py-0.5 text-[11px] leading-4 text-muted";
  return (
    <div className="pointer-events-none absolute left-1/2 top-1/2 h-0 w-0" aria-hidden="true">
      <div ref={flameRef} className="absolute left-0 top-0 transition-opacity duration-300">
        <svg width="1" height="1" className="absolute left-0 top-0 overflow-visible">
          <polyline points="0,0 16,-16 34,-16" fill="none" stroke={COLORS.muted} strokeWidth="1" opacity="0.7" />
          <circle r="2" fill={COLORS.fg} />
        </svg>
        <div className={label} style={{ left: 38, top: -26 }}>
          <span ref={flameName}>Flame front</span>{" "}
          <span className="num text-fg">
            <span ref={flameText} /> mm
          </span>
        </div>
      </div>
      <div ref={dropRef} className="absolute left-0 top-0 transition-opacity duration-300">
        <svg width="1" height="1" className="absolute left-0 top-0 overflow-visible">
          <polyline points="0,0 14,14 30,14" fill="none" stroke={COLORS.muted} strokeWidth="1" opacity="0.7" />
          <circle r="2" fill={COLORS.fg} />
        </svg>
        <div className={label} style={{ left: 34, top: 4 }}>
          Fuel droplet{" "}
          <span className="num text-fg">
            <span ref={dropText} /> mm
          </span>
        </div>
      </div>
    </div>
  );
}

function Hud({ sim, mode, onMode }: { sim: Simulation; mode: SensorMode; onMode: (mode: SensorMode) => void }) {
  const { index } = usePlayback();
  const i = Math.min(index, sim.t.length - 1);
  const s = sim.series;
  const regime = sim.regime[i];
  const cool = isCool(regime);
  const hidden = mode === "optical" && cool && s.visible_luminosity[i] <= VISIBLE_THRESHOLD;
  const da = regime === "HOT_FLAME" || regime === "RADIATIVE_EXTINCTION" ? s.damkohler_hot[i] : s.damkohler_cool[i];
  const airflow = s.airflow_cm_s[i];

  return (
    <>
      <div className="absolute left-5 top-4">
        <div className="flex items-center gap-2 text-[13px] font-medium text-fg">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: mode === "optical" ? COLORS.fg : COLORS.uv }} />
          {mode === "optical" ? "Optical camera" : "UV sensor"}
        </div>
        <div className="mt-0.5 text-[11.5px] text-muted">
          {mode === "optical" ? (
            <>
              Colour camera, <span className="num">400</span> to <span className="num">700</span> nm
            </>
          ) : (
            <>
              <Term k="uv">Intensified UV camera</Term>, <span className="num">310</span> nm
            </>
          )}
        </div>
      </div>

      <div className="pointer-events-none absolute right-5 top-4 grid grid-cols-2 gap-x-6 gap-y-2.5 [&_*]:pointer-events-auto">
        <Readout label="Flame temperature" value={fmt(s.flame_temperature_k[i], 0)} unit="K" align="right" />
        <Readout label="Heat release" value={fmt(s.heat_release_w[i], 1)} unit="W" align="right" />
        <Readout label="Burning rate" hint="burnRate" value={fmt(s.burning_rate_mm2_s[i], 3)} unit="mm²/s" align="right" />
        <Readout
          label="Damkohler number"
          hint="damkohler"
          value={fmt(da, 2)}
          align="right"
          color={da > 0 && da < DAMKOHLER_MARGINAL ? COLORS.critical : undefined}
        />
      </div>

      {airflow > 0 ? (
        <div className="pointer-events-none absolute bottom-4 right-5 flex items-center gap-2 text-[11.5px] text-muted">
          Airflow
          <span className="num text-[13px] text-warning">{airflow.toFixed(1)}</span>
          cm/s
          <svg width="22" height="8" viewBox="0 0 22 8" aria-hidden="true">
            <path d="M0 4h20M16 0.5L20.5 4 16 7.5" fill="none" stroke={COLORS.warning} strokeWidth="1.2" />
          </svg>
        </div>
      ) : null}

      {hidden ? (
        <div
          role="status"
          data-testid="hidden-flame-alert"
          className="absolute bottom-14 left-1/2 flex w-max max-w-[90%] -translate-x-1/2 items-center gap-3 rounded-md border border-critical/50 bg-[#1a0d0f] px-3.5 py-2"
        >
          <span className="h-2 w-2 shrink-0 rounded-full bg-critical" />
          <span className="text-[12.5px] leading-snug text-fg">
            A <Term k="coolFlame">cool flame</Term> is still burning here. This camera cannot see it.
          </span>
          <button
            type="button"
            onClick={() => onMode("uv")}
            className="h-7 shrink-0 rounded-md border border-line-strong bg-panel px-3 text-[12px] font-medium text-fg hover:bg-line"
          >
            Show UV view
          </button>
        </div>
      ) : null}
    </>
  );
}

function PlaybackBar({ sim }: { sim: Simulation }) {
  const { playing, speed, duration, index } = usePlayback();
  const trackRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const bands = useMemo(() => runs(sim.regime), [sim]);
  const n = sim.t.length - 1;
  const now = sim.t[Math.min(index, n)];

  useEffect(
    () =>
      clock.onFrame((t) => {
        if (headRef.current) headRef.current.style.left = `${(t / clock.duration) * 100}%`;
      }),
    [],
  );

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setWidth(el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const seekFromPointer = useCallback((clientX: number) => {
    const el = trackRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    clock.seek(((clientX - rect.left) / rect.width) * clock.duration);
  }, []);

  const onKey = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 5 : 1;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") clock.seek(clock.time + step);
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") clock.seek(clock.time - step);
    else if (e.key === "Home") clock.seek(0);
    else if (e.key === "End") clock.seek(clock.duration);
    else if (e.key === " ") clock.toggle();
    else return;
    e.preventDefault();
  }, []);

  const events = useMemo(() => notableEvents(sim.events, sim.query.airflow_cm_s), [sim]);
  const labels = useMemo(() => placeLabels(events, duration, width), [events, duration, width]);
  const legend = useMemo(() => [...new Set(sim.regime)], [sim]);

  return (
    <div className="@container shrink-0 border-t border-line px-3.5 pb-2.5 pt-2">
      <div className="flex items-end gap-3.5">
        <button
          type="button"
          onClick={() => clock.toggle()}
          data-testid="play-toggle"
          aria-label={playing ? "Pause playback" : "Play"}
          title={playing ? "Pause (Space)" : "Play (Space)"}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-line-strong text-fg hover:bg-line"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" fill="currentColor">
            {playing ? <path d="M2 1h3v10H2zM7 1h3v10H7z" /> : <path d="M2.5 1l8 5-8 5z" />}
          </svg>
        </button>
        <div className="w-[104px] shrink-0 pb-1.5 text-[12px] text-muted">
          <span className="num text-[14px] text-fg">{now.toFixed(1)}</span> of{" "}
          <span className="num">{duration.toFixed(1)}</span> s
        </div>
        <div
          ref={trackRef}
          data-testid="timeline"
          data-duration={duration}
          role="slider"
          tabIndex={0}
          aria-label="Playback position, seconds"
          aria-valuemin={0}
          aria-valuemax={Number(duration.toFixed(1))}
          aria-valuenow={Number(now.toFixed(1))}
          onKeyDown={onKey}
          className="relative h-9 min-w-0 flex-1 cursor-pointer touch-none rounded-[2px]"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            seekFromPointer(e.clientX);
          }}
          onPointerMove={(e) => {
            if (e.buttons === 1) seekFromPointer(e.clientX);
          }}
        >
          {labels.map((l) => (
            <span
              key={`${l.event.kind}-${l.event.t}`}
              title={`${l.event.t.toFixed(1)} s. ${l.event.detail}`}
              className={`absolute top-0 whitespace-nowrap text-[10.5px] leading-4 text-muted ${
                l.anchor === "start" ? "pl-1.5" : "-translate-x-full pr-1.5"
              }`}
              style={{ left: l.left }}
            >
              {l.text}
            </span>
          ))}
          {events.map((e) => (
            <div
              key={`${e.kind}-${e.t}`}
              className="absolute bottom-0 top-0.5 w-px bg-line-strong"
              style={{ left: `${(e.t / duration) * 100}%` }}
            />
          ))}
          <div className="absolute inset-x-0 bottom-1.5 flex h-1.5 overflow-hidden rounded-[2px] bg-line">
            {bands.map(([a, b, regime]) => (
              <div
                key={a}
                title={REGIME_STYLE[regime].label}
                style={{ width: `${((b - a + 1) / (n + 1)) * 100}%`, backgroundColor: REGIME_STYLE[regime].color }}
              />
            ))}
          </div>
          <div ref={headRef} className="absolute bottom-0 h-[18px] w-0.5 -translate-x-1/2 rounded-[1px] bg-fg" />
        </div>
        <div className="pb-0.5">
          <Segmented
            size="sm"
            ariaLabel="Playback speed"
            value={String(speed)}
            onChange={(v) => clock.setSpeed(Number(v))}
            options={[
              { value: "1", label: "1×" },
              { value: "2", label: "2×" },
              { value: "4", label: "4×" },
            ]}
          />
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between gap-4">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3.5 gap-y-1" data-testid="regime-legend">
          {legend.map((regime) => (
            <span key={regime} className="flex items-center gap-1.5 text-[11.5px] text-muted" title={REGIME_STYLE[regime].plain}>
              <span className="h-2 w-2 rounded-[2px]" style={{ backgroundColor: REGIME_STYLE[regime].color }} />
              {REGIME_STYLE[regime].label}
            </span>
          ))}
        </div>
        <div className="hidden shrink-0 items-center gap-4 text-[11.5px] text-muted @[860px]:flex">
          <span>
            Hot flame <span className="num text-fg">{sim.summary.hot_flame_duration_s.toFixed(1)}</span> s
          </span>
          <span>
            Cool flame <span className="num text-fg">{sim.summary.cool_flame_duration_s.toFixed(1)}</span> s
          </span>
          <span>
            Fuel burned <span className="num text-fg">{(sim.summary.fuel_consumed_fraction * 100).toFixed(0)}</span> %
          </span>
        </div>
      </div>
    </div>
  );
}

export function TwinPanel({
  sim,
  mode,
  onMode,
  highlight,
}: {
  sim: Simulation | null;
  mode: SensorMode;
  onMode: (mode: SensorMode) => void;
  highlight?: boolean;
}) {
  const [pxPerMm, setPxPerMm] = useState(10);
  return (
    <Panel
      title="Combustion chamber"
      help="A live picture of the burning droplet. Switch between what a normal camera sees and what an ultraviolet sensor sees. Drag to rotate, scroll to zoom."
      subtitle="One fuel droplet burning in microgravity"
      highlight={highlight}
      className="h-full"
      bodyClassName="flex flex-col"
      right={
        <>
          <span className="hidden text-[11.5px] text-muted min-[1500px]:inline">View through</span>
          <Segmented
            testId="sensor-mode"
            ariaLabel="Sensor view"
            value={mode}
            onChange={onMode}
            options={[
              { value: "optical", label: "Optical camera" },
              { value: "uv", label: "UV sensor", accent: COLORS.uv },
            ]}
          />
        </>
      }
    >
      {sim ? (
        <StatusStrip sim={sim} />
      ) : (
        <div className="shrink-0 border-b border-line px-3.5 py-3">
          <Skeleton lines={3} className="max-w-[360px]" />
        </div>
      )}
      <div className="relative min-h-0 flex-1 overflow-hidden bg-[#050608]">
        <CombustionTwin sim={sim} mode={mode} onScale={setPxPerMm} />
        <Reticle />
        {sim ? (
          <>
            <Callouts sim={sim} mode={mode} pxPerMm={pxPerMm} />
            <Hud sim={sim} mode={mode} onMode={onMode} />
          </>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-[12px] text-muted">
            Running the first simulation
          </div>
        )}
        <div className="pointer-events-none absolute bottom-4 left-5">
          <ScaleBar pxPerMm={pxPerMm} />
          <div className="mt-1.5 text-[11px] text-faint">Drag to rotate, scroll to zoom, double-click to reset</div>
        </div>
      </div>
      {sim ? <PlaybackBar sim={sim} /> : <div className="h-[84px] shrink-0 border-t border-line" />}
    </Panel>
  );
}
