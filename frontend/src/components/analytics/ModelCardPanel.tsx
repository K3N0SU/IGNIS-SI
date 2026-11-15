"use client";

import { api } from "@/lib/api";
import { COLORS, REGIME_STYLE, sentenceCase } from "@/lib/regimes";
import type { ModelCard } from "@/lib/types";

import { Panel, Skeleton, Stat } from "../ui";
import { Explain, LoadFailed, useFetch } from "./shared";

export function ModelCardPanel({ highlight }: { highlight?: boolean }) {
  const { data: card, failed } = useFetch<ModelCard>((signal) => api.modelCard(signal), "model-card");
  const th = "py-2 text-[11px] font-medium text-muted";

  return (
    <Panel
      title="Flame classifier"
      subtitle="Scored on runs it never saw"
      highlight={highlight}
      className="h-full"
      bodyClassName="thin-scroll overflow-y-auto"
    >
      {card ? (
        <div className="text-[12px]" data-testid="model-card">
          <div className="grid grid-cols-3 gap-3 border-b border-line px-3.5 py-3">
            <Stat label="Accuracy" value={(card.accuracy * 100).toFixed(1)} unit="%" />
            <Stat label="Macro F1" value={card.macro_f1.toFixed(3)} />
            <Stat label="Test runs" value={String(card.test_scenarios)} />
          </div>
          <table className="w-full">
            <thead>
              <tr className="border-b border-line text-left">
                <th className={`${th} pl-3.5`}>Flame state</th>
                <th className={`${th} text-right`}>Precision</th>
                <th className={`${th} text-right`}>Recall</th>
                <th className={`${th} pr-3.5 text-right`}>Samples</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(card.per_class).map(([label, m]) => {
                const style = REGIME_STYLE[label as keyof typeof REGIME_STYLE];
                return (
                  <tr key={label} className="border-b border-line/70">
                    <td className="py-[5px] pl-3.5 text-fg">
                      <span
                        className="mr-2 inline-block h-2 w-2 rounded-[2px]"
                        style={{ backgroundColor: style?.color ?? COLORS.muted }}
                      />
                      {style?.label ?? sentenceCase(label)}
                    </td>
                    <td className="num py-[5px] text-right">{m.precision.toFixed(3)}</td>
                    <td className="num py-[5px] text-right">{m.recall.toFixed(3)}</td>
                    <td className="num py-[5px] pr-3.5 text-right text-muted">{m.support.toLocaleString("en-US")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="px-3.5 py-2.5">
            <Explain>
              The classifier reads the radiometer, UV and gas sensors and never the camera, so it can call a cool flame
              the camera misses. It was trained on <span className="num">{card.train_rows.toLocaleString("en-US")}</span>{" "}
              samples of {card.training_data}. These scores measure agreement with the simulator, not with real
              instruments.
            </Explain>
          </div>
        </div>
      ) : failed ? (
        <LoadFailed />
      ) : (
        <Skeleton lines={8} className="px-3.5 py-3" />
      )}
    </Panel>
  );
}
