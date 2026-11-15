"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { clock, usePlayback } from "@/lib/playback";
import { COLORS, REGIME_STYLE, fmt, runs } from "@/lib/regimes";
import type { Simulation } from "@/lib/types";

import { CombustionTwin, type SensorMode } from "./CombustionTwin";
import { Panel, Readout, Segmented, Tag } from "./ui";

const VISIBLE_THRESHOLD = 0.01;
const UV_THRESHOLD = 1e-4;

function ScaleBar({ pxPerMm }: { pxPerMm: number }) {
  const mm = [1, 2, 5, 10, 20].find((v) => v * pxPerMm >= 48) ?? 20;
  return (
    <div className="flex flex-col gap-1">
      <div className="h-1.5 border-x border-b border-muted" style={{ width: mm * pxPerMm }} />
      <span className="num text-[10px] text-muted">{mm} mm</span>
    </div>
  );
}

function Hud({ sim, mode }: { sim: Simulation; mode: SensorMode }) {
  const { index } = usePlayback();
  const i = Math.min(index, sim.t.length - 1);
  const s = sim.series;
  const regime = sim.regime[i];
  const predicted = sim.classifier.labels[i];
  const confidence = sim.classifier.confidence[i];
  const style = REGIME_STYLE[regime];
  const mlStyle = REGIME_STYLE[predicted];

  const burning = regime === "INVISIBLE_COOL_FLAME" || regime === "RE_IGNITION_RISK";
  const seen = mode === "optical" ? s.visible_luminosity[i] > VISIBLE_THRESHOLD : s.uv_intensity[i] > UV_THRESHOLD;
  let status = "NO SIGNAL";
  let statusColor: string = COLORS.muted;
  if (seen) {
    status = mode === "optical" ? "FLAME VISIBLE" : burning ? "COOL FLAME EMISSION" : "OH* EMISSION";
    statusColor = mode === "optical" ? COLORS.warning : COLORS.uv;
  } else if (burning) {
    status = "NO VISIBLE EMISSION";
  }

  const da = regime === "HOT_FLAME" || regime === "RADIATIVE_EXTINCTION" ? s.damkohler_hot[i] : s.damkohler_cool[i];

  return (
    <>
      <div className="pointer-events-none absolute left-3 top-3 space-y-1">
        <div className="num text-[10px] tracking-wider text-muted">
          {mode === "optical" ? "CAM-1  COLOR CCD  400-700 nm" : "CAM-2  INTENSIFIED UV  310 nm"}
        </div>
        <div className="num text-[11px] font-semibold tracking-wider" style={{ color: statusColor }} data-testid="twin-status">
          {status}
        </div>
        {mode === "optical" && burning ? (
          <div className="text-[11px] text-critical">Fuel still burning. Camera shows nothing.</div>
        ) : null}
      </div>

      <div className="pointer-events-none absolute right-3 top-3 grid grid-cols-2 gap-x-5 gap-y-2">
        <Readout label="Droplet D" value={fmt(s.d_mm[i], 3)} unit="mm" align="right" />
        <Readout label="Flame D" value={fmt(s.flame_diameter_mm[i], 1)} unit="mm" align="right" />
        <Readout label="Flame T" value={fmt(s.flame_temperature_k[i], 0)} unit="K" align="right" />
        <Readout label="Burn rate K" value={fmt(s.burning_rate_mm2_s[i], 3)} unit="mm2/s" align="right" />
        <Readout label="Damkohler" value={fmt(da, 2)} align="right" color={da > 0 && da < 1.5 ? COLORS.critical : undefined} />
        <Readout label="Heat release" value={fmt(s.heat_release_w[i], 1)} unit="W" align="right" />
      </div>

      <div className="pointer-events-none absolute bottom-3 right-3 flex flex-col items-end gap-1.5">
        <div className="flex items-center gap-2">
          <span className="label">Solver</span>
          <Tag color={style.color}>{style.label.toUpperCase()}</Tag>
        </div>
        <div className="flex items-center gap-2" data-testid="ml-readout">
          <span className="label">Classifier</span>
          <Tag color={mlStyle.color}>{mlStyle.label.toUpperCase()}</Tag>
          <span className="num text-[11px] text-muted">{fmt(confidence, 2)}</span>
        </div>
      </div>
    </>
  );
}

function PlaybackBar({ sim }: { sim: Simulation }) {
  const { playing, speed, duration, index } = usePlayback();
  const trackRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const bands = useMemo(() => runs(sim.regime), [sim]);
  const n = sim.t.length - 1;

  useEffect(
    () =>
      clock.onFrame((t) => {
        if (headRef.current) headRef.current.style.left = `${(t / clock.duration) * 100}%`;
      }),
    [],
  );

  const seekFromPointer = useCallback((clientX: number) => {
    const el = trackRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    clock.seek(((clientX - rect.left) / rect.width) * clock.duration);
  }, []);

  return (
    <div className="flex h-11 shrink-0 items-center gap-3 border-t border-line px-3">
      <button
        type="button"
        onClick={() => clock.toggle()}
        data-testid="play-toggle"
        className="num h-6 w-14 rounded-md border border-line-strong text-[10px] font-semibold tracking-wider text-fg hover:bg-line"
      >
        {playing ? "PAUSE" : "PLAY"}
      </button>
      <div className="num w-[118px] text-[11px] text-muted">
        T+<span className="text-fg">{sim.t[Math.min(index, n)].toFixed(1).padStart(5, "0")}</span> / {duration.toFixed(1)} s
      </div>
      <div
        ref={trackRef}
        data-testid="timeline"
        data-duration={duration}
        className="relative h-5 flex-1 cursor-pointer"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          seekFromPointer(e.clientX);
        }}
        onPointerMove={(e) => {
          if (e.buttons === 1) seekFromPointer(e.clientX);
        }}
      >
        <div className="absolute inset-x-0 top-2 flex h-1 overflow-hidden rounded-[1px] bg-line">
          {bands.map(([a, b, regime]) => (
            <div
              key={a}
              title={REGIME_STYLE[regime].label}
              style={{ width: `${((b - a + 1) / (n + 1)) * 100}%`, backgroundColor: REGIME_STYLE[regime].color, opacity: 0.85 }}
            />
          ))}
        </div>
        {sim.events.slice(1).map((e) => (
          <div
            key={`${e.kind}-${e.t}`}
            title={`${e.t.toFixed(1)} s  ${e.detail}`}
            className="absolute top-0.5 h-4 w-px bg-muted/70"
            style={{ left: `${(e.t / duration) * 100}%` }}
          />
        ))}
        <div ref={headRef} className="absolute top-0 h-5 w-0.5 -translate-x-1/2 bg-fg" />
      </div>
      <Segmented
        size="sm"
        value={String(speed)}
        onChange={(v) => clock.setSpeed(Number(v))}
        options={[
          { value: "1", label: "1x" },
          { value: "2", label: "2x" },
          { value: "4", label: "4x" },
        ]}
      />
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
      title="Combustion twin  /  single droplet, CIR chamber"
      highlight={highlight}
      className="h-full"
      bodyClassName="flex flex-col"
      right={
        <Segmented
          testId="sensor-mode"
          value={mode}
          onChange={onMode}
          options={[
            { value: "optical", label: "OPTICAL CAMERA" },
            { value: "uv", label: "UV OH* SENSOR", accent: COLORS.uv },
          ]}
        />
      }
    >
      <div className="relative min-h-0 flex-1 overflow-hidden bg-[#050608]">
        <CombustionTwin sim={sim} mode={mode} onScale={setPxPerMm} />
        <div className="pointer-events-none absolute inset-3 border border-line/60" />
        <div className="pointer-events-none absolute left-1/2 top-1/2 h-3 w-px -translate-x-1/2 -translate-y-1/2 bg-muted/40" />
        <div className="pointer-events-none absolute left-1/2 top-1/2 h-px w-3 -translate-x-1/2 -translate-y-1/2 bg-muted/40" />
        {sim ? <Hud sim={sim} mode={mode} /> : null}
        <div className="pointer-events-none absolute bottom-3 left-3">
          <ScaleBar pxPerMm={pxPerMm} />
        </div>
      </div>
      {sim ? <PlaybackBar sim={sim} /> : <div className="h-11 border-t border-line" />}
    </Panel>
  );
}
