// The span switch of the history charts and the signed change next to a figure.
import type { RangeOption } from "../../domain/profile/history";
import { t } from "../../i18n";

export function RangeChips({ choices, value, onChange }: { choices: RangeOption[]; value: string; onChange: (key: string) => void }) {
  if (choices.length < 2) return null;
  return (
    <div class="segmented small-seg" role="group" aria-label={t("Zeitraum")}>
      {choices.map((c) => (
        <button key={c.key} class={c.key === value ? "active" : ""} aria-pressed={c.key === value} onClick={() => onChange(c.key)}>
          {c.label}
        </button>
      ))}
    </div>
  );
}

export function Delta({ value, unit = "" }: { value: number; unit?: string }) {
  const flat = Math.abs(value) < 0.05;
  const size = Number.isInteger(value) ? String(Math.abs(value)) : Math.abs(value).toFixed(1).replace(".", ",");
  return (
    <span class={`delta ${flat ? "" : value > 0 ? "up" : "down"}`}>
      {flat ? "±0" : `${value > 0 ? "+" : "−"}${size}`}
      {unit}
    </span>
  );
}
