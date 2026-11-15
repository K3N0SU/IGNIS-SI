import type {
  AerosolComparison,
  Assessment,
  AssistantMessage,
  AssistantReply,
  ChamberQuery,
  FlexValidation,
  FlowPoint,
  FrontierGrid,
  ModelCard,
  PsiDataset,
  RiskBoard,
  SaffireSample,
  Simulation,
} from "./types";

async function request<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    let detail = "";
    try {
      detail = ((await res.json()) as { detail?: string }).detail ?? "";
    } catch {
      detail = "";
    }
    throw new Error(detail || `${path} returned ${res.status}`);
  }
  return (await res.json()) as T;
}

export const api = {
  simulate: (q: ChamberQuery, signal?: AbortSignal) => request<Simulation>("/api/simulate", q, signal),
  uncertainty: (q: ChamberQuery, signal?: AbortSignal) =>
    request<Assessment>("/api/uncertainty?ensemble=12", q, signal),
  frontier: (q: Pick<ChamberQuery, "fuel" | "d0_mm" | "pressure_atm" | "diluent">, signal?: AbortSignal) =>
    request<FrontierGrid>("/api/frontier", q, signal),
  flowSweep: (q: ChamberQuery, diameterMm: number, signal?: AbortSignal) =>
    request<{ points: FlowPoint[] }>(
      "/api/flow-sweep",
      {
        fuel: q.fuel,
        diameter_mm: diameterMm,
        x_o2: q.x_o2,
        pressure_atm: q.pressure_atm,
        diluent: q.diluent,
        max_airflow_cm_s: 300,
        points: 70,
      },
      signal,
    ),
  aerosol: (ventilationCmS: number, pressureAtm: number, signal?: AbortSignal) =>
    request<AerosolComparison>(
      "/api/aerosol",
      { ventilation_cm_s: ventilationCmS, pressure_atm: Math.min(pressureAtm, 1.5) },
      signal,
    ),
  risk: (signal?: AbortSignal) => request<RiskBoard>("/api/risk", undefined, signal),
  modelCard: (signal?: AbortSignal) => request<ModelCard>("/api/model-card", undefined, signal),
  flex: (signal?: AbortSignal) => request<FlexValidation>("/api/flight/flex", undefined, signal),
  datasets: (signal?: AbortSignal) =>
    request<{ retrieved_utc: string; datasets: PsiDataset[] }>("/api/flight/datasets", undefined, signal),
  saffire: (signal?: AbortSignal) => request<{ samples: SaffireSample[] }>("/api/flight/saffire", undefined, signal),
  assistantStatus: (signal?: AbortSignal) =>
    request<{ configured: boolean; model: string; provider: string }>("/api/assistant/status", undefined, signal),
  assistant: (
    messages: AssistantMessage[],
    query: ChamberQuery,
    sensorView: "optical" | "uv",
    playbackTime: number,
    signal?: AbortSignal,
  ) =>
    request<AssistantReply>(
      "/api/assistant",
      { messages, query, sensor_view: sensorView, playback_time_s: playbackTime },
      signal,
    ),
};
