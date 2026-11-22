// Compact depth switch next to a running analysis: the change applies from the
// next position on, the game in analysis keeps going.
import { useEffect, useState } from "preact/hooks";

import { loadDepthChoice, setDepthChoice, type QueueState } from "../app/analysisService";
import { DEPTH_PRESETS, PRESET_ORDER, settingsLabel, type DepthChoice, type DepthPreset } from "../domain/analysisDepth";
import { t } from "../i18n";

const SCOPE_NAME = { own: t("deine Partien"), friends: t("Freunde & Gegner") } as const;

export function LiveDepth({ queue }: { queue: QueueState }) {
  const [choice, setChoice] = useState<DepthChoice | null>(null);
  const scope = queue.scope;

  useEffect(() => {
    if (scope) void loadDepthChoice(scope).then(setChoice);
  }, [scope, queue.settings]);

  if (!queue.current || !queue.settings) return null;
  const engines = queue.engines > 1 ? t(" · {engines} Engines parallel", { engines: queue.engines }) : "";

  // A deeper re-run of one game has fixed limits; nothing to switch.
  if (!scope || !choice) {
    return (
      <p class="live-depth faint small">
        {settingsLabel(queue.settings)}
        {engines}
      </p>
    );
  }

  const change = (value: string) => {
    const next: DepthChoice = value === "custom" ? choice : { preset: value as DepthPreset };
    setChoice(next);
    void setDepthChoice(scope, next);
  };

  return (
    <div class="live-depth">
      <label class="small">
        <span class="muted">{t("Tiefe für {n}", { n: SCOPE_NAME[scope] })}</span>
        <select value={choice.preset} onChange={(e) => change(e.currentTarget.value)} aria-label={t("Analysetiefe während der Analyse ändern")}>
          {PRESET_ORDER.map((p) => (
            <option key={p} value={p}>
              {t("{name} (Tiefe {depth})", { name: DEPTH_PRESETS[p].name, depth: DEPTH_PRESETS[p].settings.depth })}</option>
          ))}
          {choice.preset === "custom" && <option value="custom">{t("Eigene (Tiefe {depth})", { depth: choice.depth })}</option>}
        </select>
      </label>
      <span class="faint small">
        {t("{settingsLabel}{engines} · gilt ab dem nächsten Zug, ohne Neustart", { settingsLabel: settingsLabel(queue.settings), engines })}
      </span>
    </div>
  );
}
