export type FuelKey = "n-heptane" | "n-decane" | "n-dodecane" | "methanol";
export type DiluentKey = "N2" | "CO2" | "He";
export type FlowMode = "CONTINUOUS" | "RESTORE_AFTER_EXTINCTION";

export type Regime =
  | "HOT_FLAME"
  | "RADIATIVE_EXTINCTION"
  | "INVISIBLE_COOL_FLAME"
  | "RE_IGNITION_RISK"
  | "EXTINGUISHED"
  | "BURNOUT";

export type ClassifierLabel =
  | "HOT_FLAME"
  | "RADIATIVE_EXTINCTION"
  | "INVISIBLE_COOL_FLAME"
  | "RE_IGNITION_RISK"
  | "NO_COMBUSTION";

export interface ChamberQuery {
  fuel: FuelKey;
  d0_mm: number;
  x_o2: number;
  pressure_atm: number;
  airflow_cm_s: number;
  flow_mode: FlowMode;
  restore_delay_s: number;
  diluent: DiluentKey;
  t_max_s: number;
  dt_s: number;
}

export type SeriesKey =
  | "d_mm"
  | "d2_mm2"
  | "flame_diameter_mm"
  | "flame_temperature_k"
  | "burning_rate_mm2_s"
  | "damkohler_hot"
  | "damkohler_cool"
  | "heat_release_w"
  | "radiative_fraction"
  | "radiometer_w_m2"
  | "uv_intensity"
  | "visible_luminosity"
  | "co_o2_ratio"
  | "airflow_cm_s"
  | "soot_shell_diameter_mm"
  | "soot_mass_ug"
  | "co_released_mg";

export interface SimEvent {
  t: number;
  kind: string;
  detail: string;
}

export interface ProtocolStep {
  order: number;
  code: string;
  action: string;
  status: "REQUIRED" | "ADVISORY" | "HOLD" | "NOT_EFFECTIVE" | "NOMINAL";
  rationale: string;
  parameters: Record<string, number | string | boolean | null>;
}

export interface Protocol {
  hazard_level: "NOMINAL" | "WARNING" | "CRITICAL";
  headline: string;
  steps: ProtocolStep[];
}

export interface Citation {
  key: string;
  authors: string;
  title: string;
  venue: string;
  year: number;
}

export interface Provenance {
  source: string;
  model: string;
  reference_experiment: string;
  reference_experiment_name: string;
  facility: string;
  platform: string;
  period: string;
  fuel_tested_in_reference: boolean;
  within_reference_envelope: Record<string, boolean>;
  citations: Citation[];
  repository: string;
}

export interface SimulationSummary {
  burn_time_s: number;
  hot_flame_duration_s: number;
  cool_flame_duration_s: number;
  first_extinction_s: number | null;
  extinction_mode: string | null;
  reignition_count: number;
  first_reignition_s: number | null;
  final_diameter_mm: number;
  fuel_consumed_fraction: number;
  peak_heat_release_w: number;
  peak_flame_temperature_k: number;
  mean_hot_burning_rate_mm2_s: number | null;
  mean_cool_burning_rate_mm2_s: number | null;
  co_released_mg: number;
  cool_flame_present: boolean;
  final_regime: Regime;
}

export interface Simulation {
  query: ChamberQuery;
  t: number[];
  series: Record<SeriesKey, number[]>;
  regime: Regime[];
  events: SimEvent[];
  summary: SimulationSummary;
  classifier: { labels: ClassifierLabel[]; confidence: number[]; agreement: number };
  protocol: Protocol;
  provenance: Provenance;
  solve_ms: number;
}

export type Verdict = "VERIFIED" | "INTERPOLATED" | "BEYOND_FRONTIER";

export interface DimensionCheck {
  dimension: string;
  label: string;
  value: number;
  tested_low: number;
  tested_high: number;
  unit: string;
  inside: boolean;
  exceedance: number;
}

export interface Assessment {
  verdict: Verdict;
  summary: string;
  frontier_distance: number;
  dimensions: DimensionCheck[];
  campaigns: { campaign: string; fuel_tested: boolean; diluent_tested: boolean; inside_all: boolean; distance: number }[];
  nearest_campaign: string;
  model_disagreement: number | null;
  outcome_distribution: Record<string, number> | null;
  predicted_outcome: string | null;
  ensemble_size: number;
}

export interface RiskEntry {
  rank: number;
  material: string;
  material_name: string;
  atmosphere: string;
  atmosphere_name: string;
  x_o2: number;
  pressure_atm: number;
  limiting_o2_pct: number;
  oxygen_margin_pct: number;
  ignition_propensity: number;
  toxic_co_yield: number;
  suppression_difficulty: number;
  composite: number;
  severity: "NOMINAL" | "WARNING" | "CRITICAL";
}

export interface RiskBoard {
  weights: Record<string, number>;
  entries: RiskEntry[];
  atmospheres: { key: string; name: string; x_o2: number; pressure_atm: number; description: string; ppo2_atm: number }[];
  basis: string;
}

export interface FrontierGrid {
  o2: number[];
  airflow_cm_s: number[];
  verdict: Verdict[][];
}

export interface FlowPoint {
  airflow_cm_s: number;
  hot_sustained: boolean;
  cool_sustained: boolean;
  reignition: boolean;
  heat_release_w: number;
  burning_rate_mm2_s: number;
  flame_temperature_k: number;
  cool_flame_temperature_k: number;
  radiative_fraction: number;
  damkohler_hot: number;
  damkohler_cool: number;
  standoff: number;
}

export interface AerosolRun {
  t: number[];
  count_mean_diameter_nm: number[];
  mass_mean_diameter_nm: number[];
  mass_fraction_above_1um: number[];
  ionization_per_mass: number[];
  photoelectric_per_mass: number[];
  final_count_mean_diameter_nm: number;
  final_mass_fraction_above_1um: number;
}

export interface AerosolComparison {
  normal_gravity: AerosolRun;
  microgravity: AerosolRun;
}

export interface ModelCard {
  accuracy: number;
  macro_f1: number;
  per_class: Record<string, { precision: number; recall: number; "f1-score": number; support: number }>;
  labels: string[];
  features: string[];
  train_rows: number;
  test_rows: number;
  test_scenarios: number;
  training_data: string;
}
