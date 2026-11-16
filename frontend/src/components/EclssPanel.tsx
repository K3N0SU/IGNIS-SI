"use client";

import { useState } from "react";

import { STATUS_COLOR, sentenceCase } from "@/lib/regimes";
import type { ProtocolStep, Simulation } from "@/lib/types";

import { Panel, Skeleton, Tag } from "./ui";

function Step({ step }: { step: ProtocolStep }) {
  const [open, setOpen] = useState(false);
  const urgent = step.status === "REQUIRED" || step.status === "HOLD";
  const color = STATUS_COLOR[step.status];
  return (
    <li className="border-b border-line last:border-b-0">
      <button
        type="button"
        aria-expanded={open}
        title={open ? "Show less" : "Show the full reasoning"}
        onClick={() => setOpen((v) => !v)}
        className="grid w-full grid-cols-[20px_minmax(0,1fr)] gap-x-2.5 px-3.5 py-1.5 text-left hover:bg-raised"
      >
        <span
          className="num mt-px flex h-5 w-5 items-center justify-center rounded-[4px] border text-[11px]"
          style={{ color, borderColor: `${color}66` }}
        >
          {step.order}
        </span>
        <span className="min-w-0">
          <span className="flex items-start justify-between gap-3">
            <span className="text-[12.5px] font-medium leading-snug text-fg">{step.action}</span>
            <span className="flex shrink-0 items-center gap-1.5 pt-px text-[11px] font-medium" style={{ color }}>
              {sentenceCase(step.status)}
              <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true" className={open ? "rotate-180" : ""}>
                <path d="M1 2.5l3 3 3-3" fill="none" stroke="#8B949E" strokeWidth="1.2" />
              </svg>
            </span>
          </span>
          {open || urgent ? (
            <span className={`mt-1 text-[11.5px] leading-snug text-muted ${open ? "block" : "line-clamp-3"}`}>
              {step.rationale}
            </span>
          ) : null}
        </span>
      </button>
    </li>
  );
}

export function EclssPanel({ sim, highlight }: { sim: Simulation | null; highlight?: boolean }) {
  const protocol = sim?.protocol;
  return (
    <Panel
      title="Response protocol"
      help="What the life-support system should do about this fire, in order, and why. It changes with the scenario."
      subtitle="Life-support actions, in order"
      highlight={highlight}
      right={protocol ? <Tag color={STATUS_COLOR[protocol.hazard_level]}>{sentenceCase(protocol.hazard_level)}</Tag> : null}
      bodyClassName="thin-scroll overflow-y-auto"
    >
      {protocol ? (
        <div data-testid="eclss">
          <p className="border-b border-line px-3.5 py-2.5 text-[13px] font-medium leading-snug text-fg">
            {protocol.headline}
          </p>
          <ol>
            {protocol.steps.map((step) => (
              <Step key={step.code} step={step} />
            ))}
          </ol>
        </div>
      ) : (
        <Skeleton lines={6} className="px-3.5 py-3" />
      )}
    </Panel>
  );
}
