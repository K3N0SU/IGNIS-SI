"use client";

import { STATUS_COLOR } from "@/lib/regimes";
import type { Simulation } from "@/lib/types";

import { Panel, Tag } from "./ui";

export function EclssPanel({ sim, highlight }: { sim: Simulation | null; highlight?: boolean }) {
  const protocol = sim?.protocol;
  return (
    <Panel
      title="ECLSS response protocol"
      highlight={highlight}
      right={protocol ? <Tag color={STATUS_COLOR[protocol.hazard_level]}>{protocol.hazard_level}</Tag> : null}
      bodyClassName="thin-scroll overflow-y-auto"
    >
      {protocol ? (
        <div data-testid="eclss">
          <p className="border-b border-line px-3 py-2 text-[12px] font-medium leading-snug text-fg">{protocol.headline}</p>
          <ol>
            {protocol.steps.map((step) => (
              <li key={step.code} className="border-b border-line px-3 py-1.5 last:border-b-0">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-baseline gap-2">
                    <span className="num text-[10px] text-faint">{String(step.order).padStart(2, "0")}</span>
                    <span className="text-[11.5px] font-medium leading-snug text-fg">{step.action}</span>
                  </div>
                  <span
                    className="num shrink-0 pt-px text-[9px] font-semibold tracking-wider"
                    style={{ color: STATUS_COLOR[step.status] }}
                  >
                    {step.status.replace("_", " ")}
                  </span>
                </div>
                <p className="mt-0.5 pl-[22px] text-[10.5px] leading-snug text-muted">{step.rationale}</p>
              </li>
            ))}
          </ol>
        </div>
      ) : (
        <p className="px-3 py-2 text-[11px] text-muted">Waiting for solver.</p>
      )}
    </Panel>
  );
}
