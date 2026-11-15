import { eventLabel } from "./regimes";
import type { SimEvent } from "./types";

const EVENT_PRIORITY = ["HOT_REIGNITION", "HOT_FLAME_EXTINCTION_RADIATIVE", "BURNOUT", "VENTILATION_RESTORED", "IGNITION"];
const LABEL_CHAR_PX = 6.4;

export interface PlacedLabel {
  event: SimEvent;
  text: string;
  left: number;
  anchor: "start" | "end";
}

/** Events worth marking. A fan "restart" at zero airflow changes nothing, so it is dropped. */
export function notableEvents(events: SimEvent[], airflowCmS: number): SimEvent[] {
  return events.filter((e) => e.kind !== "VENTILATION_RESTORED" || airflowCmS > 0);
}

/** Greedy placement: important events first; each label sits right of its tick, or left if that is taken. */
export function placeLabels(events: SimEvent[], duration: number, width: number): PlacedLabel[] {
  if (width <= 0) return [];
  const rank = (e: SimEvent): number => {
    const i = EVENT_PRIORITY.indexOf(e.kind);
    return i === -1 ? EVENT_PRIORITY.length : i;
  };
  const taken: [number, number][] = [];
  const placed: PlacedLabel[] = [];
  for (const event of [...events].sort((a, b) => rank(a) - rank(b))) {
    const text = eventLabel(event.kind);
    const x = (event.t / duration) * width;
    const w = text.length * LABEL_CHAR_PX + 10;
    const options: [PlacedLabel["anchor"], number, number][] = [
      ["start", x, x + w],
      ["end", x - w, x],
    ];
    for (const [anchor, a, b] of options) {
      if (a < -2 || b > width + 2) continue;
      if (taken.some(([ta, tb]) => a < tb + 6 && b > ta - 6)) continue;
      taken.push([a, b]);
      placed.push({ event, text, left: x, anchor });
      break;
    }
  }
  return placed;
}
