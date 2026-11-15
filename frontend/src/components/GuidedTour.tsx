"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { clock } from "@/lib/playback";
import { DEFAULT_QUERY } from "@/lib/regimes";
import type { ChamberQuery } from "@/lib/types";
import type { View } from "@/lib/views";

import type { AnalyticsFocus } from "./AnalyticsView";
import type { SensorMode } from "./CombustionTwin";

export type WorkbenchFocus = "controls" | "twin" | "telemetry" | "eclss" | "inspector" | null;

export interface TourController {
  setQuery: (patch: Partial<ChamberQuery>) => void;
  setMode: (mode: SensorMode) => void;
  setView: (view: View) => void;
  setFocus: (focus: WorkbenchFocus) => void;
  setAnalyticsFocus: (focus: AnalyticsFocus) => void;
  setRiskFilter: (filter: string) => void;
}

interface Cue {
  at: number;
  chapter: number;
  text: string;
  run: (c: TourController) => void;
}

const CHAPTERS = ["The hidden flame", "Ventilation backfire", "Exploration atmospheres", "What has been tested"];
const TOTAL_S = 90;

const seekAndPlay = (t: number, speed: number): void => {
  clock.pause();
  clock.setSpeed(speed);
  clock.seek(t);
  clock.play();
};

const CUES: Cue[] = [
  {
    at: 0,
    chapter: 0,
    text: "A 3.9 mm droplet of n-heptane ignites in the combustion rack on the ISS. The air is still, 21 % oxygen at 1 atm.",
    run: (c) => {
      c.setView("workbench");
      c.setQuery({ ...DEFAULT_QUERY });
      c.setMode("optical");
      c.setFocus("twin");
      setTimeout(() => seekAndPlay(0, 1), 350);
    },
  },
  {
    at: 7,
    chapter: 0,
    text: "The flame radiates away more heat than it produces and goes out. To the colour camera, the fire is over.",
    run: (c) => c.setFocus("twin"),
  },
  {
    at: 13,
    chapter: 0,
    text: "Now the ultraviolet sensor. A cool flame near 700 K is still burning fuel and producing carbon monoxide.",
    run: (c) => {
      c.setMode("uv");
      c.setFocus("telemetry");
    },
  },
  {
    at: 19,
    chapter: 0,
    text: "The classifier identifies it from the radiometer, UV and gas sensors alone. It never uses the camera image.",
    run: (c) => {
      c.setFocus("twin");
      clock.setSpeed(2);
    },
  },
  {
    at: 24,
    chapter: 1,
    text: "The crew sees no flame and restarts the cabin fans at 8 cm/s, six seconds after the visible flame went out.",
    run: (c) => {
      c.setMode("optical");
      c.setQuery({ ...DEFAULT_QUERY, airflow_cm_s: 8 });
      c.setFocus("controls");
      setTimeout(() => seekAndPlay(3, 1), 400);
    },
  },
  {
    at: 33,
    chapter: 1,
    text: "Fresh air pushes the cool flame past its ignition threshold. The hot flame comes back.",
    run: (c) => c.setFocus("twin"),
  },
  {
    at: 40,
    chapter: 1,
    text: "The response protocol keeps the fans off and works out the nitrogen and pressure targets that stop both kinds of flame.",
    run: (c) => {
      c.setFocus("eclss");
      clock.setSpeed(2);
    },
  },
  {
    at: 47,
    chapter: 2,
    text: "Cabin materials, ranked by how easily they ignite, how much carbon monoxide they give off and how hard they are to put out.",
    run: (c) => {
      c.setView("analytics");
      c.setRiskFilter("ALL");
      c.setAnalyticsFocus("risk");
    },
  },
  {
    at: 54,
    chapter: 2,
    text: "At 34 % oxygen and 8.2 psia, Nomex and silicone rubber become flammable. In the ISS cabin they do not burn.",
    run: (c) => c.setRiskFilter("ARTEMIS"),
  },
  {
    at: 62,
    chapter: 2,
    text: "The slow airflow that revives a cool flame sits in the 1 to 10 cm/s band, where more flow means a stronger fire.",
    run: (c) => c.setAnalyticsFocus("flow"),
  },
  {
    at: 69,
    chapter: 3,
    text: "Green cells were tested on the ISS. Droplet tests never went above 5 cm/s, so the fan-restart case has no flight data.",
    run: (c) => c.setAnalyticsFocus("frontier"),
  },
  {
    at: 77,
    chapter: 3,
    text: "The workbench says so plainly: this prediction is beyond the tested range, and the model runs disagree with each other.",
    run: (c) => {
      c.setView("workbench");
      c.setFocus("inspector");
    },
  },
  {
    at: 84,
    chapter: 3,
    text: "That is IGNIS-SI: see the invisible flame, predict the backfire, and be honest about what has never been tested.",
    run: (c) => {
      c.setFocus(null);
      c.setMode("uv");
    },
  },
];

const CHAPTER_START = CHAPTERS.map((_, i) => CUES.find((c) => c.chapter === i)?.at ?? 0);
const chapterEnd = (i: number): number => CHAPTER_START[i + 1] ?? TOTAL_S;

export function GuidedTour({
  active,
  controller,
  onExit,
}: {
  active: boolean;
  controller: TourController;
  onExit: () => void;
}) {
  const [elapsed, setElapsed] = useState(0);
  const [cue, setCue] = useState(0);
  const controllerRef = useRef(controller);
  controllerRef.current = controller;
  const skipRef = useRef(0);

  useEffect(() => {
    if (!active) return;
    const started = performance.now();
    skipRef.current = 0;
    let fired = -1;
    const id = window.setInterval(() => {
      const t = (performance.now() - started) / 1000 + skipRef.current;
      setElapsed(t);
      while (fired + 1 < CUES.length && CUES[fired + 1].at <= t) {
        fired += 1;
        CUES[fired].run(controllerRef.current);
        setCue(fired);
      }
      if (t >= TOTAL_S) {
        window.clearInterval(id);
        onExit();
      }
    }, 100);
    return () => {
      window.clearInterval(id);
      controllerRef.current.setFocus(null);
      controllerRef.current.setAnalyticsFocus(null);
      setElapsed(0);
      setCue(0);
    };
  }, [active, onExit]);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onExit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, onExit]);

  const skip = useCallback(() => {
    const next = CUES[cue + 1];
    if (next) skipRef.current += Math.max(next.at - elapsed, 0);
  }, [cue, elapsed]);

  if (!active) return null;
  const current = CUES[cue];
  const isLast = cue === CUES.length - 1;

  return (
    <div
      data-testid="tour"
      role="region"
      aria-label="Guided tour"
      className="fixed bottom-5 left-1/2 z-50 w-[720px] max-w-[92vw] -translate-x-1/2 overflow-hidden rounded-md border border-line-strong bg-raised shadow-[0_16px_48px_rgba(0,0,0,0.6)]"
    >
      <div className="flex gap-1 px-4 pt-3" aria-hidden="true">
        {CHAPTERS.map((name, i) => {
          const fill = Math.min(Math.max((elapsed - CHAPTER_START[i]) / (chapterEnd(i) - CHAPTER_START[i]), 0), 1);
          return (
            <div key={name} className="h-[3px] flex-1 overflow-hidden rounded-[2px] bg-line-strong">
              <div className="h-full bg-fg" style={{ width: `${fill * 100}%` }} />
            </div>
          );
        })}
      </div>
      <div className="flex items-start gap-4 px-4 pb-4 pt-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <h2 className="text-[13px] font-semibold text-fg">{CHAPTERS[current.chapter]}</h2>
            <span className="text-[11.5px] text-muted">
              Part <span className="num">{current.chapter + 1}</span> of <span className="num">{CHAPTERS.length}</span>
            </span>
          </div>
          <p className="mt-1.5 min-h-[44px] text-[15px] leading-snug text-fg" aria-live="polite">
            {current.text}
          </p>
        </div>
        <div className="flex shrink-0 gap-2 pt-0.5">
          {isLast ? null : (
            <button
              type="button"
              onClick={skip}
              className="h-7 rounded-md border border-line-strong px-3 text-[12px] font-medium text-fg hover:bg-line"
            >
              Next
            </button>
          )}
          <button
            type="button"
            onClick={onExit}
            className="h-7 rounded-md px-3 text-[12px] font-medium text-muted hover:bg-line hover:text-fg"
          >
            End tour
          </button>
        </div>
      </div>
    </div>
  );
}
