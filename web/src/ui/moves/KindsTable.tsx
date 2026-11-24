// Every kind of move in one table: how often, how often per game, the rate
// per 100 moves as a bar with the opponents' rate as a tick, and a verdict
// where the difference is beyond chance.
import { KIND_GROUPS, type KindRow, kindRows, type MoveTally, sumOf } from "../../domain/profile";
import { IconChevron } from "../icons";
import { Foot } from "../kit";
import { CLASS_COLOR, classLabel } from "../labels";
import { ClassBadge, perGameText } from "../MoveTally";
import { de, plural, rate } from "./shared";
import { t, locale } from "../../i18n";

const VERDICT: Record<string, { text: string; tone: string }> = {
  "1": { text: t("besser"), tone: "good" },
  "-1": { text: t("schwächer"), tone: "bad" },
  "0": { text: t("gleichauf"), tone: "flat" },
};

function Row({ r, games, max, onPick }: { r: KindRow; games: number; max: number; onPick?: () => void }) {
  const width = (v: number) => `${Math.min(100, (v / max) * 100)}%`;
  const v = r.verdict === null ? null : VERDICT[String(r.verdict)];
  const cells = (
    <>
      <span class="mv-kind">
        <ClassBadge c={r.key} size={20} />
        <span>{classLabel(r.key)}</span>
      </span>
      <span class="mv-n tnum">{r.count.toLocaleString(locale())}</span>
      <span class="mv-per">{perGameText(r.count, games, r.games_with)}</span>
      <span class="mv-rate">
        <span class="mv-bar" aria-hidden="true">
          <i class="mv-fill" style={{ width: r.count ? `max(3px, ${width(r.per_100)})` : "0" }} />
          {r.opp_per_100 !== null && <i class="mv-ref" style={{ left: width(r.opp_per_100) }} />}
        </span>
        <b class="tnum">{rate(r.per_100)}</b>
      </span>
      <span class="mv-opp tnum">{r.opp_per_100 !== null ? rate(r.opp_per_100) : "–"}</span>
      <span class={`mv-verdict${v ? ` ${v.tone}` : ""}`}>
        <span>{v?.text ?? ""}</span>
        {onPick && <IconChevron />}
      </span>
    </>
  );
  const shared = { class: "mv-row", style: { "--tone": CLASS_COLOR[r.key] ?? "var(--text-3)" } };
  return onPick ? (
    <button {...shared} onClick={onPick} title={t("Diese Züge ansehen")}>
      {cells}
    </button>
  ) : (
    <div {...shared}>{cells}</div>
  );
}

export function KindsTable({ t: tk, onShine }: { t: MoveTally; onShine: () => void }) {
  const rows = kindRows(tk);
  return (
    <section class="card span-8 mv-kinds">
      <header class="card-head">
        <div>
          <h3>{t("Alle Zugarten")}</h3>
          <p class="card-sub">{tk.opponents ? t("Du und deine Gegner in denselben Partien, je 100 Züge.") : t("Jede Bewertung, gezählt über alle analysierten Partien.")}</p>
        </div>
        {tk.opponents && (
          <span class="mv-key">
            <span>
              <i class="mv-key-bar" />  {t("Du")}
            </span>
            <span>
              <i class="mv-key-ref" />  {t("Gegner")}
            </span>
          </span>
        )}
      </header>

      <div class="mv-table" role="table" aria-label={t("Alle Zugarten")}>
        <div class="mv-row mv-head" role="row">
          <span>{t("Zugart")}</span>
          <span class="num">{t("Anzahl")}</span>
          <span>{t("Pro Partie")}</span>
          <span>{t("Je 100 Züge")}</span>
          <span class="num">{t("Gegner")}</span>
          <span>{t("Vergleich")}</span>
        </div>
        {KIND_GROUPS.map((g) => {
          const mine = rows.filter((r) => r.group === g.key);
          const n = sumOf(tk.counts, g.classes);
          // One scale per group: next to a best-move share of 35 a brilliant rate of 0,7 would be no bar at all.
          const max = Math.max(...mine.flatMap((r) => [r.per_100, r.opp_per_100 ?? 0]), 0.01) * 1.08;
          return (
            <div key={g.key} class={`mv-block g-${g.key}`} role="rowgroup">
              <div class="mv-block-head">
                <span>{g.label}</span>
                <span class="tnum">
                  {t("{n} · {n2} %", { n: plural(n, t("Zug"), t("Züge")), n2: de((n / (tk.moves || 1)) * 100) })}</span>
              </div>
              {mine.map((r) => (
                <Row key={r.key} r={r} games={tk.games} max={max} onPick={g.key === "shine" && r.count ? onShine : undefined} />
              ))}
            </div>
          );
        })}
      </div>

      <Foot label={t("Wie lese ich die Tabelle?")}>
        
        {t("Der Balken ist deine Rate je 100 Züge{n}. Jede der drei Gruppen hat ihren eigenen Maßstab, sonst wären seltene Züge unsichtbar. {n2}Exzellente, gute und Buchzüge bekommen kein Urteil: mehr davon kann genauso gut heißen, dass beste Züge fehlen.", { n: tk.opponents ? t(", der Strich die deiner Gegner in denselben Partien") : "", n2: tk.opponents ? t("„besser“ oder „schwächer“ steht nur da, wenn der Unterschied bei so vielen Zügen kein Zufall mehr sein kann; „gleichauf“ heißt, dass er es sein könnte. ") : "" })}
      </Foot>
    </section>
  );
}
