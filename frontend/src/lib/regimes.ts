import type { ChamberQuery, ClassifierLabel, Regime } from "./types";

export const COLORS = {
  canvas: "#090A0D",
  panel: "#111318",
  line: "#1E222B",
  lineStrong: "#2A303B",
  fg: "#F3F4F6",
  muted: "#8B949E",
  faint: "#5B636E",
  nominal: "#10B981",
  warning: "#F59E0B",
  critical: "#EF4444",
  uv: "#3B82F6",
} as const;

interface RegimeStyle {
  label: string;
  short: string;
  color: string;
}

export const REGIME_STYLE: Record<Regime | ClassifierLabel, RegimeStyle> = {
  HOT_FLAME: { label: "Hot flame", short: "HOT", color: COLORS.warning },
  RADIATIVE_EXTINCTION: { label: "Radiative extinction", short: "RAD-EXT", color: COLORS.muted },
  INVISIBLE_COOL_FLAME: { label: "Invisible cool flame", short: "COOL", color: COLORS.uv },
  RE_IGNITION_RISK: { label: "Re-ignition risk", short: "RISK", color: COLORS.critical },
  EXTINGUISHED: { label: "Extinguished", short: "OUT", color: COLORS.nominal },
  BURNOUT: { label: "Fuel consumed", short: "BURNOUT", color: COLORS.nominal },
  NO_COMBUSTION: { label: "No combustion", short: "NONE", color: COLORS.nominal },
};

export const STATUS_COLOR: Record<string, string> = {
  NOMINAL: COLORS.nominal,
  ADVISORY: COLORS.muted,
  WARNING: COLORS.warning,
  HOLD: COLORS.warning,
  REQUIRED: COLORS.critical,
  CRITICAL: COLORS.critical,
  NOT_EFFECTIVE: COLORS.faint,
  VERIFIED: COLORS.nominal,
  INTERPOLATED: COLORS.warning,
  BEYOND_FRONTIER: COLORS.critical,
};

export const DEFAULT_QUERY: ChamberQuery = {
  fuel: "n-heptane",
  d0_mm: 3.9,
  x_o2: 0.21,
  pressure_atm: 1.0,
  airflow_cm_s: 0,
  flow_mode: "RESTORE_AFTER_EXTINCTION",
  restore_delay_s: 6,
  diluent: "N2",
  t_max_s: 60,
  dt_s: 0.1,
};

export interface Preset {
  key: string;
  label: string;
  query: Partial<ChamberQuery>;
}

export const PRESETS: Preset[] = [
  { key: "flex", label: "FLEX baseline", query: { ...DEFAULT_QUERY } },
  { key: "backfire", label: "Vent restart", query: { ...DEFAULT_QUERY, airflow_cm_s: 8 } },
  { key: "small", label: "2 mm drop", query: { ...DEFAULT_QUERY, d0_mm: 2.0 } },
  { key: "enriched", label: "30 % O2", query: { ...DEFAULT_QUERY, x_o2: 0.3, pressure_atm: 0.7 } },
];

/** Contiguous runs of equal values, as [startIndex, endIndex, value]. */
export function runs<T>(values: T[]): [number, number, T][] {
  const out: [number, number, T][] = [];
  let start = 0;
  for (let i = 1; i <= values.length; i++) {
    if (i === values.length || values[i] !== values[start]) {
      out.push([start, i - 1, values[start]]);
      start = i;
    }
  }
  return out;
}

export function fmt(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "--";
  return value.toFixed(digits);
}

export function fmtExp(value: number): string {
  if (value === 0) return "0.0e+0";
  return value.toExponential(1);
}
