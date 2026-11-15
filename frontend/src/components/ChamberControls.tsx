"use client";

import { COLORS, PRESETS } from "@/lib/regimes";
import type { ChamberQuery, DiluentKey, FlowMode, FuelKey, Simulation } from "@/lib/types";

import { Panel, Segmented, Slider } from "./ui";

const FUELS: { value: FuelKey; label: string }[] = [
  { value: "n-heptane", label: "n-Heptane  C7H16" },
  { value: "n-decane", label: "n-Decane  C10H22" },
  { value: "n-dodecane", label: "n-Dodecane  C12H26" },
  { value: "methanol", label: "Methanol  CH3OH" },
];

export function ChamberControls({
  query,
  onChange,
  sim,
  loading,
  highlight,
}: {
  query: ChamberQuery;
  onChange: (patch: Partial<ChamberQuery>) => void;
  sim: Simulation | null;
  loading: boolean;
  highlight?: boolean;
}) {
  const ppo2 = query.x_o2 * query.pressure_atm;
  return (
    <Panel
      title="What-if chamber controls"
      highlight={highlight}
      right={
        <span className="num text-[10px] text-faint">
          {loading ? "SOLVING" : sim ? `ODE ${sim.solve_ms.toFixed(0)} ms` : ""}
        </span>
      }
      bodyClassName="thin-scroll overflow-y-auto px-3 py-2"
    >
      <div className="space-y-2">
        <div className="grid grid-cols-4 gap-1">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              data-testid={`preset-${p.key}`}
              onClick={() => onChange(p.query)}
              className="truncate rounded-md border border-line px-1 py-1 text-[10px] font-medium text-muted hover:border-line-strong hover:text-fg"
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-[1fr_auto] items-end gap-2">
          <div>
            <div className="label mb-1">Fuel</div>
            <select
              value={query.fuel}
              data-testid="fuel"
              onChange={(e) => onChange({ fuel: e.target.value as FuelKey })}
              className="num h-7 w-full rounded-md border border-line bg-inset px-2 text-[11px] text-fg"
            >
              {FUELS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <div className="label mb-1">Diluent</div>
            <Segmented<DiluentKey>
              value={query.diluent}
              onChange={(diluent) => onChange({ diluent })}
              options={[
                { value: "N2", label: "N2" },
                { value: "CO2", label: "CO2" },
                { value: "He", label: "He" },
              ]}
            />
          </div>
        </div>

        <Slider
          testId="slider-o2"
          label="Oxygen"
          unit="% vol"
          value={query.x_o2 * 100}
          min={14}
          max={30}
          step={0.5}
          digits={1}
          onChange={(v) => onChange({ x_o2: v / 100 })}
        />
        <Slider
          testId="slider-pressure"
          label="Pressure"
          unit="atm"
          value={query.pressure_atm}
          min={0.5}
          max={1.2}
          step={0.01}
          digits={2}
          onChange={(v) => onChange({ pressure_atm: v })}
        />
        <Slider
          testId="slider-diameter"
          label="Droplet diameter"
          unit="mm"
          value={query.d0_mm}
          min={1.5}
          max={5}
          step={0.1}
          digits={1}
          onChange={(v) => onChange({ d0_mm: v })}
        />
        <Slider
          testId="slider-airflow"
          label="Ventilation airflow"
          unit="cm/s"
          value={query.airflow_cm_s}
          min={0}
          max={20}
          step={0.5}
          digits={1}
          accent={query.airflow_cm_s > 0 ? COLORS.warning : undefined}
          onChange={(v) => onChange({ airflow_cm_s: v })}
        />

        <div>
          <div className="label mb-1">Airflow schedule</div>
          <Segmented<FlowMode>
            value={query.flow_mode}
            onChange={(flow_mode) => onChange({ flow_mode })}
            options={[
              { value: "RESTORE_AFTER_EXTINCTION", label: "Fans restart after flame-out" },
              { value: "CONTINUOUS", label: "Continuous" },
            ]}
          />
        </div>
        {query.flow_mode === "RESTORE_AFTER_EXTINCTION" ? (
          <Slider
            testId="slider-delay"
            label="Restart delay after visible flame-out"
            unit="s"
            value={query.restore_delay_s}
            min={0}
            max={20}
            step={0.5}
            digits={1}
            onChange={(v) => onChange({ restore_delay_s: v })}
          />
        ) : null}

        <div className="grid grid-cols-3 gap-2 border-t border-line pt-2">
          <div>
            <div className="label">ppO2</div>
            <div className="num text-[12px]" style={{ color: ppo2 < 0.16 ? COLORS.critical : COLORS.fg }}>
              {ppo2.toFixed(3)} <span className="text-[10px] text-faint">atm</span>
            </div>
          </div>
          <div>
            <div className="label">Hot / cool</div>
            <div className="num text-[12px]">
              {sim ? `${sim.summary.hot_flame_duration_s.toFixed(1)} / ${sim.summary.cool_flame_duration_s.toFixed(1)}` : "--"}{" "}
              <span className="text-[10px] text-faint">s</span>
            </div>
          </div>
          <div>
            <div className="label">Fuel burned</div>
            <div className="num text-[12px]">
              {sim ? (sim.summary.fuel_consumed_fraction * 100).toFixed(1) : "--"} <span className="text-[10px] text-faint">%</span>
            </div>
          </div>
        </div>
      </div>
    </Panel>
  );
}
