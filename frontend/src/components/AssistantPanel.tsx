"use client";

import { type FormEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react";

import { api } from "@/lib/api";
import { clock } from "@/lib/playback";
import type { AssistantAction, AssistantMessage, AssistantReply, ChamberQuery } from "@/lib/types";

import type { SensorMode } from "./CombustionTwin";

const SUGGESTIONS = [
  "What is happening in the chamber right now?",
  "Is it safe to turn the cabin fans back on?",
  "Has NASA actually tested this, or is it a model prediction?",
  "Show me the fastest way to put this fire out.",
];

const TOOL_LABEL: Record<string, string> = {
  run_simulation: "ran the simulation",
  get_flight_evidence: "checked NASA flight tests",
  get_material_risk: "looked up material risk",
  get_model_validation: "checked model accuracy",
  apply_scenario: "updated the workbench",
};

interface Turn extends AssistantMessage {
  steps?: string[];
  applied?: string;
}

function renderInline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <strong key={i} className="font-semibold text-fg">
        {part.slice(2, -2)}
      </strong>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

function summariseSteps(reply: AssistantReply): string[] {
  const seen = new Set<string>();
  for (const call of reply.tool_calls) {
    const label = TOOL_LABEL[call.name];
    if (label) seen.add(label);
  }
  return [...seen];
}

export function AssistantPanel({
  open,
  onClose,
  query,
  mode,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  query: ChamberQuery;
  mode: SensorMode;
  onApply: (action: AssistantAction) => void;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!open || configured !== null) return;
    const ctl = new AbortController();
    api
      .assistantStatus(ctl.signal)
      .then((s) => setConfigured(s.configured))
      .catch(() => setConfigured(false));
    return () => ctl.abort();
  }, [open, configured]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [turns, busy]);

  const send = useCallback(
    (text: string) => {
      const content = text.trim();
      if (!content || busy) return;
      const next: Turn[] = [...turns, { role: "user", content }];
      setTurns(next);
      setDraft("");
      setError(null);
      setBusy(true);
      const ctl = new AbortController();
      abortRef.current = ctl;
      api
        .assistant(
          next.map(({ role, content: c }) => ({ role, content: c })),
          query,
          mode,
          clock.time,
          ctl.signal,
        )
        .then((reply) => {
          const action = reply.actions[reply.actions.length - 1];
          if (action) onApply(action);
          setTurns((prev) => [
            ...prev,
            { role: "assistant", content: reply.reply, steps: summariseSteps(reply), applied: action ? action.reason || "Scenario loaded into the workbench." : undefined },
          ]);
        })
        .catch((e: unknown) => {
          if (!ctl.signal.aborted) setError(e instanceof Error ? e.message : "The assistant could not answer.");
        })
        .finally(() => setBusy(false));
    },
    [busy, turns, query, mode, onApply],
  );

  const onSubmit = (e: FormEvent): void => {
    e.preventDefault();
    send(draft);
  };

  if (!open) return null;

  return (
    <aside
      aria-label="Assistant"
      data-testid="assistant-panel"
      className="fixed bottom-2 right-2 top-14 z-40 flex w-[456px] max-w-[calc(100vw-16px)] flex-col rounded-md border border-line-strong bg-panel"
    >
      <header className="flex h-11 shrink-0 items-center justify-between border-b border-line px-3.5">
        <div className="flex items-baseline gap-2.5">
          <h2 className="text-[13px] font-semibold text-fg">Assistant</h2>
          <p className="text-[11.5px] text-muted">Runs the model and checks flight data for you</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close assistant"
          className="h-7 rounded-md px-2 text-[12px] text-muted hover:bg-line hover:text-fg"
        >
          Close
        </button>
      </header>

      <div ref={listRef} className="thin-scroll min-h-0 flex-1 overflow-y-auto px-3.5 py-3" aria-live="polite">
        {configured === false ? (
          <div className="rounded-md border border-line bg-inset p-3 text-[12.5px] leading-relaxed text-muted" role="status">
            <p className="font-medium text-fg">The assistant is not set up on this server.</p>
            <p className="mt-1">
              Add <span className="num text-fg">GEMINI_API_KEY</span> to <span className="num text-fg">backend/.env</span> and restart
              the API. Everything else in the workbench works without it.
            </p>
          </div>
        ) : turns.length === 0 ? (
          <div>
            <p className="text-[12.5px] leading-relaxed text-muted">
              Ask about anything on screen. The assistant can run scenarios, compare them with NASA flight tests and set up the
              workbench to show you. Numbers come from the model and the flight tables, never from the language model itself.
            </p>
            <div className="mt-3 space-y-1.5">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => send(s)}
                  disabled={configured === null}
                  className="block w-full rounded-md border border-line px-3 py-2 text-left text-[12.5px] text-fg hover:border-line-strong hover:bg-inset disabled:opacity-50"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {turns.map((turn, i) =>
              turn.role === "user" ? (
                <div key={i} className="ml-8 rounded-md bg-line px-3 py-2 text-[12.5px] leading-relaxed text-fg">
                  {turn.content}
                </div>
              ) : (
                <div key={i} data-testid="assistant-reply">
                  {turn.steps && turn.steps.length ? (
                    <div className="mb-1.5 text-[11px] text-muted">
                      {(() => {
                        const line = turn.steps.join(", then ");
                        return line.charAt(0).toUpperCase() + line.slice(1);
                      })()}
                    </div>
                  ) : null}
                  <div className="space-y-2 text-[12.5px] leading-relaxed text-fg/90">
                    {turn.content.split(/\n{2,}/).map((para, j) => (
                      <p key={j}>{renderInline(para)}</p>
                    ))}
                  </div>
                  {turn.applied ? (
                    <div className="mt-2 flex items-start gap-2 rounded-md border border-uv/40 bg-uv/10 px-3 py-2 text-[12px] text-fg">
                      <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-uv" />
                      <span>Workbench updated. {turn.applied}</span>
                    </div>
                  ) : null}
                </div>
              ),
            )}
            {busy ? <div className="text-[12px] text-muted">Working: running tools and checking the data.</div> : null}
            {error ? (
              <div role="alert" className="rounded-md border border-critical/40 bg-critical/10 px-3 py-2 text-[12px] text-fg">
                {error}
              </div>
            ) : null}
          </div>
        )}
      </div>

      <form onSubmit={onSubmit} className="shrink-0 border-t border-line p-2.5">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            data-testid="assistant-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(draft);
              }
              e.stopPropagation();
            }}
            rows={2}
            maxLength={1500}
            placeholder="Ask a question or describe a scenario to try"
            aria-label="Message to the assistant"
            disabled={configured === false}
            className="thin-scroll min-h-0 flex-1 resize-none rounded-md border border-line bg-inset px-3 py-2 text-[12.5px] text-fg placeholder:text-faint focus:border-line-strong focus:outline-none disabled:opacity-50"
          />
          <button
            type="submit"
            data-testid="assistant-send"
            disabled={busy || !draft.trim() || configured === false}
            className="h-9 rounded-md border border-line-strong px-3.5 text-[12px] font-medium text-fg hover:bg-line disabled:opacity-40"
          >
            Send
          </button>
        </div>
        <p className="mt-1.5 text-[10.5px] text-faint">
          A decision aid for analysis and training. Your question and the current scenario are sent to Google Gemini.
        </p>
      </form>
    </aside>
  );
}
