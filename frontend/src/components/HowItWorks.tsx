"use client";

import { type ReactNode, useEffect, useState } from "react";

import { api } from "@/lib/api";
import { STATUS_COLOR, sentenceCase } from "@/lib/regimes";
import type { Assessment, FlexValidation, PsiDataset, Simulation } from "@/lib/types";
import type { View } from "@/lib/views";

import { Tag, Tip } from "./ui";

function Arrow() {
  return (
    <svg width="34" height="14" viewBox="0 0 34 14" aria-hidden="true" className="shrink-0 self-center text-line-strong">
      <path d="M0 7h30M25 2l6 5-6 5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Stage({
  name,
  figure,
  unit,
  children,
  tip,
  accent,
  testId,
}: {
  name: string;
  figure: ReactNode;
  unit: string;
  children: ReactNode;
  tip: string;
  accent: string;
  testId: string;
}) {
  return (
    <Tip text={tip} className="flex min-w-0 flex-1">
      <div
        data-testid={testId}
        className="flex min-w-0 flex-1 flex-col rounded-md border border-line bg-panel px-4 py-3.5 transition-colors hover:border-line-strong"
      >
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-[2px]" style={{ backgroundColor: accent }} />
          <h3 className="text-[13px] font-semibold text-fg">{name}</h3>
        </div>
        <div className="mt-3 flex items-baseline gap-2">
          <span className="num text-[30px] font-medium leading-none text-fg">{figure}</span>
          <span className="text-[12px] text-muted">{unit}</span>
        </div>
        <div className="mt-3 text-[12.5px] leading-relaxed text-muted">{children}</div>
      </div>
    </Tip>
  );
}

const SCREENS: { view: View; name: string; question: string; body: string }[] = [
  {
    view: "workbench",
    name: "Workbench",
    question: "What would this fire do?",
    body: "Set the fuel, the cabin air and the fans on the left. Watch the droplet burn in the middle. Read the sensors and the evidence on the right.",
  },
  {
    view: "analytics",
    name: "Analytics",
    question: "Where are the risks?",
    body: "Cabin materials ranked by fire risk, a map of the conditions NASA has tested, and how airflow and smoke change the picture.",
  },
  {
    view: "flight",
    name: "Flight data",
    question: "Can I trust the model?",
    body: "Every real test from the station, the model plotted against what was measured, and the tests closest to your scenario.",
  },
];

const LIMITS = [
  "Curves on the workbench are model output. Only the Flight data screen and the dashed NASA line show real measurements.",
  "The model burns one fuel droplet. It is a way to study flame behaviour, not a simulation of a whole cabin fire.",
  "Outside the conditions NASA flew, the Evidence panel marks the prediction as beyond the tested range. Treat those as estimates.",
  "This is a research and training tool. It does not replace flight rules or crew procedures.",
];

export function HowItWorks({
  sim,
  assessment,
  onOpen,
  onAssistant,
  onTour,
}: {
  sim: Simulation | null;
  assessment: Assessment | null;
  onOpen: (view: View) => void;
  onAssistant: () => void;
  onTour: () => void;
}) {
  const [flex, setFlex] = useState<FlexValidation | null>(null);
  const [datasets, setDatasets] = useState<PsiDataset[] | null>(null);

  useEffect(() => {
    const ctl = new AbortController();
    api.flex(ctl.signal).then(setFlex).catch(() => undefined);
    api
      .datasets(ctl.signal)
      .then((d) => setDatasets(d.datasets))
      .catch(() => undefined);
    return () => ctl.abort();
  }, []);

  const fit = flex?.calibration ?? null;
  const records = datasets?.reduce((sum, d) => sum + d.rows, 0) ?? null;
  const errorNow = fit?.metrics.fitted_holdout.all.burning_rate_mm2_s.mape_pct ?? null;
  const errorBefore = fit?.metrics.baseline_holdout.all.burning_rate_mm2_s.mape_pct ?? null;
  const dash = "--";

  return (
    <div className="thin-scroll h-full overflow-y-auto" data-testid="how-it-works">
      <div className="mx-auto flex max-w-[1900px] flex-col gap-2">
        <section className="rounded-md border border-line bg-panel px-5 py-4">
          <h1 className="text-[17px] font-semibold text-fg">How IGNIS-SI works</h1>
          <p className="mt-1.5 max-w-[980px] text-[13px] leading-relaxed text-muted">
            Fire behaves differently without gravity. Flames turn into spheres, burn slowly, and can keep burning as a{" "}
            <span className="text-fg">cool flame that no camera can see</span>. NASA has studied this on the space
            station for years. IGNIS-SI turns those experiments into a tool that predicts what a fire would do in a
            spacecraft cabin, and tells you how far each prediction can be trusted.
          </p>
        </section>

        <section aria-label="From flight data to a checked prediction" className="flex items-stretch gap-2">
          <Stage
            testId="how-stage-data"
            name="NASA flight tests"
            accent="#10B981"
            figure={flex ? flex.tests.length : dash}
            unit="droplet burns on the station"
            tip="Public, open-licence data from NASA's Physical Sciences Informatics archive. Nothing here is invented: every record links back to its dataset."
          >
            Real measurements come first.{" "}
            {datasets && records !== null ? (
              <>
                The archive behind the app holds <span className="num text-fg">{datasets.length}</span> NASA
                investigations and <span className="num text-fg">{records.toLocaleString("en-US")}</span> flight records.
              </>
            ) : (
              "The app loads NASA's public record of fire experiments in orbit."
            )}
          </Stage>
          <Arrow />
          <Stage
            testId="how-stage-fit"
            name="Calibrate the model"
            accent="#F3F4F6"
            figure={fit ? fit.train_tests : dash}
            unit="tests used for tuning"
            tip="The model is physics, not a black box: droplet evaporation, heat lost as radiation, and the chemistry that decides when a flame goes out. Tuning adjusts its constants, not its equations."
          >
            A physics model of a burning droplet has{" "}
            <span className="num text-fg">{fit ? Object.keys(fit.parameters).length : "a few"}</span> constants that are
            hard to know exactly. They are tuned until the model reproduces what NASA measured.
          </Stage>
          <Arrow />
          <Stage
            testId="how-stage-sim"
            name="Simulate your scenario"
            accent="#F59E0B"
            figure={sim ? sim.solve_ms.toFixed(0) : dash}
            unit="ms to solve the last one"
            tip="You choose the fuel, droplet size, oxygen, pressure and fan settings. The model plays the fire out second by second, including flames a camera would miss."
          >
            You describe a fire on the workbench. The tuned model plays it out and shows the flame, the sensor
            readings, and the response the life-support system should take.
          </Stage>
          <Arrow />
          <Stage
            testId="how-stage-check"
            name="Check against tests"
            accent="#3B82F6"
            figure={fit ? fit.holdout_tests : dash}
            unit="tests held back for scoring"
            tip="Held-back tests were never used for tuning, so scoring on them is a fair exam. The same idea is applied to your scenario: is it close to something NASA really flew?"
          >
            {errorNow !== null && errorBefore !== null ? (
              <>
                On tests it never saw, the burning-rate error is <span className="num text-fg">{errorNow.toFixed(0)}</span> %,
                down from <span className="num">{errorBefore.toFixed(0)}</span> % before tuning.{" "}
              </>
            ) : null}
            Every prediction is then compared with the range NASA flew.
            {assessment ? (
              <span className="mt-2 flex items-center gap-2">
                <span>Your scenario now</span>
                <Tag color={STATUS_COLOR[assessment.verdict]}>{sentenceCase(assessment.verdict)}</Tag>
              </span>
            ) : null}
          </Stage>
        </section>

        <div className="grid grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] gap-2">
          <section className="rounded-md border border-line bg-panel px-5 py-4">
            <h2 className="text-[13px] font-semibold text-fg">What each screen answers</h2>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {SCREENS.map((s) => (
                <button
                  key={s.view}
                  type="button"
                  data-testid={`how-open-${s.view}`}
                  onClick={() => onOpen(s.view)}
                  className="flex flex-col items-start rounded-md border border-line bg-inset px-3.5 py-3 text-left transition-colors hover:border-line-strong hover:bg-raised"
                >
                  <div className="text-[11.5px] text-muted">{s.name}</div>
                  <div className="mt-0.5 text-[14px] font-medium text-fg">{s.question}</div>
                  <p className="mt-1.5 text-[12px] leading-relaxed text-muted">{s.body}</p>
                  <div className="mt-auto pt-2 text-[12px] font-medium text-uv">Open {s.name.toLowerCase()}</div>
                </button>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line pt-3 text-[12.5px] text-muted">
              <span>Not sure where to start?</span>
              <button type="button" onClick={onTour} className="font-medium text-fg underline decoration-faint underline-offset-[3px] hover:decoration-fg">
                Take the guided tour
              </button>
              <button type="button" onClick={onAssistant} className="font-medium text-fg underline decoration-faint underline-offset-[3px] hover:decoration-fg">
                Ask the assistant a question
              </button>
              <span className="text-faint">Hover any heading or question mark for a short explanation. Click a section heading to fold it away.</span>
            </div>
          </section>

          <section className="rounded-md border border-line bg-panel px-5 py-4">
            <h2 className="text-[13px] font-semibold text-fg">What to keep in mind</h2>
            <ul className="mt-3 space-y-2.5">
              {LIMITS.map((l) => (
                <li key={l} className="flex gap-2.5 text-[12.5px] leading-relaxed text-muted">
                  <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-faint" />
                  {l}
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
