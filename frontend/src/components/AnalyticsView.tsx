"use client";

import type { Assessment, ChamberQuery } from "@/lib/types";

import { AerosolPanel } from "./analytics/AerosolPanel";
import { FlowResponse } from "./analytics/FlowResponse";
import { FrontierMap } from "./analytics/FrontierMap";
import { ModelCardPanel } from "./analytics/ModelCardPanel";
import { RiskLeaderboard } from "./analytics/RiskLeaderboard";

export type AnalyticsFocus = "risk" | "frontier" | "flow" | "aerosol" | null;

export function AnalyticsView({
  query,
  assessment,
  focus,
  riskFilter,
}: {
  query: ChamberQuery;
  assessment: Assessment | null;
  focus: AnalyticsFocus;
  riskFilter: string;
}) {
  return (
    <div className="grid h-full min-h-0 grid-cols-12 grid-rows-[minmax(0,1.38fr)_minmax(0,1fr)] gap-2">
      <div className="col-span-7 min-h-0">
        <RiskLeaderboard highlight={focus === "risk"} focus={riskFilter} />
      </div>
      <div className="col-span-5 min-h-0">
        <FrontierMap query={query} assessment={assessment} highlight={focus === "frontier"} />
      </div>
      <div className="col-span-4 min-h-0">
        <FlowResponse query={query} highlight={focus === "flow"} />
      </div>
      <div className="col-span-5 min-h-0">
        <AerosolPanel query={query} highlight={focus === "aerosol"} />
      </div>
      <div className="col-span-3 min-h-0">
        <ModelCardPanel />
      </div>
    </div>
  );
}
