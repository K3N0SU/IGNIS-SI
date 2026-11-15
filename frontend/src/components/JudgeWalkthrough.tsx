"use client";

import { useEffect, useRef, useState } from "react";

import { clock } from "@/lib/playback";
import { DEFAULT_QUERY } from "@/lib/regimes";
import type { ChamberQuery } from "@/lib/types";

import type { AnalyticsFocus } from "./AnalyticsView";
import type { SensorMode } from "./CombustionTwin";

export type View = "workbench" | "analytics";
export type WorkbenchFocus = "controls" | "twin" | "telemetry" | "eclss" | "inspector" | null;

export interface WalkthroughController {
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
  run: (c: WalkthroughController) => void;
}

const CHAPTERS = ["The hidden danger", "Ventilation backfire", "Artemis atmosphere", "Knowledge frontier"];
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
    text: "A 3.9 mm n-heptane droplet ignites in the ISS Combustion Integrated Rack. Still air, 21 % oxygen, 1 atm.",
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
    text: "The flame radiates more heat than it releases and goes out. The colour camera sees an extinguished fire.",
    run: (c) => c.setFocus("twin"),
  },
  {
    at: 13,
    chapter: 0,
    text: "Switch to the UV channel: a cool flame near 700 K is still consuming fuel and producing CO.",
    run: (c) => {
      c.setMode("uv");
      c.setFocus("telemetry");
    },
  },
  {
    at: 19,
    chapter: 0,
    text: "The classifier flags it from radiometer, UV and CO/O2 alone, with no optical input.",
    run: (c) => {
      c.setFocus("twin");
      clock.setSpeed(2);
    },
  },
  {
    at: 24,
    chapter: 1,
    text: "Crew sees no flame and restarts the cabin fans at 8 cm/s, six seconds after visible flame-out.",
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
    text: "Fresh oxidizer drives the cool flame through its ignition threshold. The hot flame returns.",
    run: (c) => c.setFocus("twin"),
  },
  {
    at: 40,
    chapter: 1,
    text: "The ECLSS protocol holds ventilation off and computes the diluent and pressure targets that end both flame modes.",
    run: (c) => {
      c.setFocus("eclss");
      clock.setSpeed(2);
    },
  },
  {
    at: 47,
    chapter: 2,
    text: "Cabin materials ranked by ignition propensity, CO yield and suppression difficulty across three atmospheres.",
    run: (c) => {
      c.setView("analytics");
      c.setRiskFilter("ALL");
      c.setAnalyticsFocus("risk");
    },
  },
  {
    at: 54,
    chapter: 2,
    text: "At 34 % oxygen and 8.2 psia, Nomex and silicone cross their flammability limit. On ISS they do not burn.",
    run: (c) => c.setRiskFilter("ARTEMIS"),
  },
  {
    at: 62,
    chapter: 2,
    text: "The same slow airflow that revives a cool flame sits inside the 1-10 cm/s band where burn intensity rises with flow.",
    run: (c) => c.setAnalyticsFocus("flow"),
  },
  {
    at: 69,
    chapter: 3,
    text: "Green cells were flown on ISS. Droplet tests never exceeded 3 cm/s; the ventilation-restart case is outside the data.",
    run: (c) => c.setAnalyticsFocus("frontier"),
  },
  {
    at: 77,
    chapter: 3,
    text: "The model says so explicitly: this prediction is beyond the tested frontier and its calibration ensemble disagrees.",
    run: (c) => {
      c.setView("workbench");
      c.setFocus("inspector");
    },
  },
  {
    at: 84,
    chapter: 3,
    text: "IGNIS-SI: see the invisible flame, predict the backfire, and state what has never been tested.",
    run: (c) => {
      c.setFocus(null);
      c.setMode("uv");
    },
  },
];

export function JudgeWalkthrough({
  active,
  controller,
  onExit,
}: {
  active: boolean;
  controller: WalkthroughController;
  onExit: () => void;
}) {
  const [elapsed, setElapsed] = useState(0);
  const [cue, setCue] = useState(0);
  const controllerRef = useRef(controller);
  controllerRef.current = controller;

  useEffect(() => {
    if (!active) return;
    const started = performance.now();
    let fired = -1;
    const id = window.setInterval(() => {
      const t = (performance.now() - started) / 1000;
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

  if (!active) return null;
  const current = CUES[cue];

  return (
    <div
      data-testid="walkthrough"
      className="pointer-events-auto fixed bottom-4 left-1/2 z-50 w-[760px] max-w-[92vw] -translate-x-1/2 rounded-md border border-line-strong bg-panel"
    >
      <div className="flex items-center gap-3 border-b border-line px-3 py-1.5">
        <span className="label text-fg">Judge walkthrough</span>
        <div className="flex flex-1 gap-1">
          {CHAPTERS.map((name, i) => (
            <div key={name} className="flex-1">
              <div className={`h-0.5 ${i <= current.chapter ? "bg-fg" : "bg-line-strong"}`} />
              <div className={`mt-1 truncate text-[10px] ${i === current.chapter ? "text-fg" : "text-faint"}`}>
                <span className="num">{String(i + 1).padStart(2, "0")}</span> {name}
              </div>
            </div>
          ))}
        </div>
        <span className="num text-[11px] text-muted">
          {Math.min(elapsed, TOTAL_S).toFixed(0).padStart(2, "0")} / {TOTAL_S} s
        </span>
        <button
          type="button"
          onClick={onExit}
          className="rounded-md border border-line-strong px-2 py-0.5 text-[10px] font-semibold tracking-wider text-muted hover:text-fg"
        >
          EXIT
        </button>
      </div>
      <p className="px-3 py-2.5 text-[13px] leading-snug text-fg">{current.text}</p>
    </div>
  );
}
