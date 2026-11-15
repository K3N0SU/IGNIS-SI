import type { ChamberQuery, ClassifierLabel, Regime } from "./types";

export const COLORS = {
  canvas: "#090A0D",
  panel: "#111318",
  line: "#1E222B",
  lineStrong: "#2A303B",
  fg: "#F3F4F6",
  muted: "#8B949E",
  faint: "#636B76",
  nominal: "#10B981",
  warning: "#F59E0B",
  critical: "#EF4444",
  uv: "#3B82F6",
} as const;

interface RegimeStyle {
  label: string;
  short: string;
  color: string;
  /** One plain sentence on what is physically happening. */
  plain: string;
}

export const REGIME_STYLE: Record<Regime | ClassifierLabel, RegimeStyle> = {
  HOT_FLAME: {
    label: "Hot flame",
    short: "HOT",
    color: COLORS.warning,
    plain: "A visible flame surrounds the droplet and is burning fuel quickly.",
  },
  RADIATIVE_EXTINCTION: {
    label: "Radiative extinction",
    short: "RAD-EXT",
    color: COLORS.muted,
    plain: "The flame is losing more heat by radiation than it produces and is going out.",
  },
  INVISIBLE_COOL_FLAME: {
    label: "Invisible cool flame",
    short: "COOL",
    color: COLORS.uv,
    plain: "The visible flame is gone, but a cool flame near 700 K is still burning fuel and making carbon monoxide.",
  },
  RE_IGNITION_RISK: {
    label: "Re-ignition risk",
    short: "RISK",
    color: COLORS.critical,
    plain: "Fresh air is reaching the cool flame. It is close to flashing back into a hot flame.",
  },
  EXTINGUISHED: {
    label: "Extinguished",
    short: "OUT",
    color: COLORS.nominal,
    plain: "Both the hot flame and the cool flame are out. Nothing is burning.",
  },
  BURNOUT: {
    label: "Fuel consumed",
    short: "BURNOUT",
    color: COLORS.nominal,
    plain: "The droplet has burned away completely. Nothing is left to burn.",
  },
  NO_COMBUSTION: {
    label: "No combustion",
    short: "NONE",
    color: COLORS.nominal,
    plain: "Nothing is burning.",
  },
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
  /** A few words shown on the card. */
  summary: string;
  description: string;
  query: Partial<ChamberQuery>;
}

export const PRESETS: Preset[] = [
  {
    key: "flex",
    label: "ISS baseline",
    summary: "Still cabin air",
    description: "Still cabin air. The flame goes out, a cool flame stays.",
    query: { ...DEFAULT_QUERY },
  },
  {
    key: "backfire",
    label: "Fan restart",
    summary: "Fans return at 8 cm/s",
    description: "Fans come back at 8 cm/s and re-ignite the cool flame.",
    query: { ...DEFAULT_QUERY, airflow_cm_s: 8 },
  },
  {
    key: "small",
    label: "Small droplet",
    summary: "2 mm of fuel",
    description: "2 mm of fuel. Burns out before it can radiate itself out.",
    query: { ...DEFAULT_QUERY, d0_mm: 2.0 },
  },
  {
    key: "enriched",
    label: "Oxygen-rich cabin",
    summary: "30 % oxygen, 0.7 atm",
    description: "30 % oxygen at 0.7 atm, as planned for exploration.",
    query: { ...DEFAULT_QUERY, x_o2: 0.3, pressure_atm: 0.7 },
  },
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
  if (value === 0) return "0";
  return value.toExponential(1).replace("e+", "e");
}

/** "BEYOND_FRONTIER" -> "Beyond frontier". */
export function sentenceCase(value: string): string {
  const s = value.replace(/_/g, " ").toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const EVENT_LABEL: Record<string, string> = {
  IGNITION: "Ignition",
  HOT_FLAME_EXTINCTION_RADIATIVE: "Flame out",
  COOL_FLAME_ONSET: "Cool flame",
  VENTILATION_RESTORED: "Fans on",
  HOT_REIGNITION: "Re-ignition",
  BURNOUT: "Burnout",
};

export function eventLabel(kind: string): string {
  if (EVENT_LABEL[kind]) return EVENT_LABEL[kind];
  if (kind.includes("EXTINCTION")) return kind.startsWith("COOL") ? "Cool flame out" : "Flame out";
  return sentenceCase(kind);
}
