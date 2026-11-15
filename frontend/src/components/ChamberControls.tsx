"use client";

import { COLORS, PRESETS, type Preset } from "@/lib/regimes";
import type { ChamberQuery, DiluentKey, FlowMode, FuelKey, Simulation } from "@/lib/types";

import { Panel, Segmented, Slider, Term } from "./ui";

const FUELS: { value: FuelKey; label: string }[] = [
  { value: "n-heptane", label: "n-Heptane (C7H16)" },
  { value: "n-decane", label: "n-Decane (C10H22)" },
  { value: "n-dodecane", label: "n-Dodecane (C12H26)" },
  { value: "methanol", label: "Methanol (CH3OH)" },
];

const PPO2_HYPOXIA_ATM = 0.16;

function matches(preset: Preset, query: ChamberQuery): boolean {
  return (Object.keys(preset.query) as (keyof ChamberQuery)[]).every((k) => preset.query[k] === query[k]);
}

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
      title="Scenario"
      subtitle="Set up the chamber"
      highlight={highlight}
      right={
        <span className="text-[11px] text-muted" aria-live="polite">
          {loading ? (
            "Solving"
          ) : sim ? (
            <>
              Solved in <span className="num">{sim.solve_ms.toFixed(0)}</span> ms
            </>
          ) : null}
        </span>
      }
      bodyClassName="thin-scroll overflow-y-auto px-3.5 py-2.5"
    >
      <div className="space-y-2 sw:grid sw:grid-cols-2 sw:gap-x-6 sw:gap-y-2.5 sw:space-y-0">
        <div className="sw:col-span-2">
          <div className="label mb-1.5">Presets</div>
          <div className="grid grid-cols-2 gap-1.5 sw:grid-cols-4">
            {PRESETS.map((p) => {
              const active = matches(p, query);
              return (
                <button
                  key={p.key}
                  type="button"
                  data-testid={`preset-${p.key}`}
                  aria-pressed={active}
                  title={p.description}
                  onClick={() => onChange(p.query)}
                  className={`rounded-md border px-2.5 py-1.5 text-left transition-colors ${
                    active ? "border-muted bg-raised" : "border-line hover:border-line-strong hover:bg-raised"
                  }`}
                >
                  <div className="text-[12px] font-medium text-fg">{p.label}</div>
                  <div className="truncate text-[11px] text-muted">{p.summary}</div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-2 border-t border-line pt-2.5 sw:col-start-1 sw:row-start-2">
          <div className="flex items-center justify-between gap-3">
            <label className="text-[12px] text-muted" htmlFor="fuel">
              Fuel
            </label>
            <select
              id="fuel"
              value={query.fuel}
              data-testid="fuel"
              onChange={(e) => onChange({ fuel: e.target.value as FuelKey })}
              className="h-[30px] w-[190px] rounded-md sw:w-[160px] border border-line bg-inset pl-2.5 pr-7 text-[12px] text-fg hover:border-line-strong"
            >
              {FUELS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>
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
        </div>

        <div className="space-y-2 border-t border-line pt-2.5 sw:col-start-2 sw:row-span-2 sw:row-start-2">
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
            label="Cabin pressure"
            unit="atm"
            value={query.pressure_atm}
            min={0.5}
            max={1.2}
            step={0.01}
            digits={2}
            onChange={(v) => onChange({ pressure_atm: v })}
          />
          <div className="flex items-center justify-between gap-3">
            <span className="text-[12px] text-muted">
              <Term k="diluent">Diluent gas</Term>
            </span>
            <Segmented<DiluentKey>
              size="sm"
              ariaLabel="Diluent gas"
              value={query.diluent}
              onChange={(diluent) => onChange({ diluent })}
              options={[
                { value: "N2", label: "N2" },
                { value: "CO2", label: "CO2" },
                { value: "He", label: "He" },
              ]}
            />
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-[12px] text-muted">
              <Term k="ppo2">Oxygen partial pressure</Term>
            </span>
            <span className="num text-[13px]" style={{ color: ppo2 < PPO2_HYPOXIA_ATM ? COLORS.critical : COLORS.fg }}>
              {ppo2.toFixed(3)}
              <span className="ml-1 text-[11px] text-muted">atm</span>
            </span>
          </div>
        </div>

        <div className="space-y-2 border-t border-line pt-2.5 sw:col-start-1 sw:row-start-3">
          <Slider
            testId="slider-airflow"
            label="Cabin fan airflow"
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
            <div className="mb-1 text-[12px] text-muted">When the fans run</div>
            <Segmented<FlowMode>
              block
              size="sm"
              ariaLabel="When the fans run"
              value={query.flow_mode}
              onChange={(flow_mode) => onChange({ flow_mode })}
              options={[
                { value: "RESTORE_AFTER_EXTINCTION", label: "Restart after flame-out" },
                { value: "CONTINUOUS", label: "All the time" },
              ]}
            />
          </div>
          {query.flow_mode === "RESTORE_AFTER_EXTINCTION" ? (
            <Slider
              testId="slider-delay"
              label="Restart delay after flame-out"
              unit="s"
              value={query.restore_delay_s}
              min={0}
              max={20}
              step={0.5}
              digits={1}
              onChange={(v) => onChange({ restore_delay_s: v })}
            />
          ) : null}
        </div>
      </div>
    </Panel>
  );
}
