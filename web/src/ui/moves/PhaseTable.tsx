// Opening, middlegame and endgame in one table: accuracy against the usual
// value, the kinds of moves as one bar, the error rate and the shine moves.
import { type MoveTally, phaseQuality, type PlayerProfile, TALLY_CLASSES, typicalLabel } from "../../domain/profile";
import { MIN_BUCKET_MOVES } from "../../domain/profile/evidence";
import { Foot } from "../kit";
import { CLASS_COLOR, classLabel } from "../labels";
import { Level, SplitBar } from "../viz/Bars";
import { de, plural } from "./shared";
import { t } from "../../i18n";

export function PhaseTable({ profile, t: tk }: { profile: PlayerProfile; t: MoveTally }) {
  const rows = phaseQuality(tk);
  const rc = profile.rating;
  const accuracy = (profile.overview.phase_accuracy ?? {}) as Record<string, number>;
  const errorMax = Math.max(...rows.map((p) => p.serious_per_100), 1) * 1.15;
  if (!rows.length) return null;
  return (
    <>
      <div class="span-12 sec-head" id="s-phasen">
        <div>
          <h2>{t("Partiephasen")}</h2>
          <p>{t("Eröffnung, Mittelspiel und Endspiel im Vergleich.")}</p>
        </div>
      </div>
      <section class="card span-12 mv-phases">
        <div class="mv-ph mv-ph-head">
          <span>{t("Phase")}</span>
          <span>{t("Genauigkeit")}{rc ? <small>  {t("· Strich: {typicalLabel}", { typicalLabel: typicalLabel(rc) })}</small> : null}</span>
          <span>{t("Zugarten")}</span>
          <span>{t("Grobe Fehler je 100 Züge")}</span>
          <span class="num">{t("Glanzzüge")}</span>
        </div>
        {rows.map((p) => {
          const acc = accuracy[p.key];
          const usual = rc?.typical_phase_accuracy[p.key] ?? null;
          return (
            <div key={p.key} class={`mv-ph${p.thin ? " thin" : ""}`}>
              <span class="mv-ph-name">
                <strong>{p.label}</strong>
                <small class="tnum">{plural(p.moves, t("Zug"), t("Züge"))}</small>
              </span>
              <span class="mv-ph-cell" data-label={t("Genauigkeit")}>
                <b class="tnum">{acc !== undefined ? `${de(acc)} %` : "–"}</b>
                <Level value={acc ?? null} reference={usual} faint={p.thin} />
              </span>
              <span class="mv-ph-cell mv-ph-split" data-label={t("Zugarten")}>
                <SplitBar parts={TALLY_CLASSES.map((k) => ({ key: k, label: classLabel(k), value: p.block.counts[k], color: CLASS_COLOR[k] ?? "var(--surface-3)" }))} height={12} />
                <small class="tnum">{t("{n} % beste Züge", { n: de(p.top_pct, 0) })}</small>
              </span>
              <span class="mv-ph-cell" data-label={t("Grobe Fehler je 100 Züge")}>
                <b class="tnum">{de(p.serious_per_100)}</b>
                <Level value={p.serious_per_100} max={errorMax} tone="bad" faint={p.thin} />
              </span>
              <span class="mv-ph-shine num tnum" data-label={t("Glanzzüge")}>
                {p.shine}
              </span>
            </div>
          );
        })}
        <Foot>
          
          {t("Die Genauigkeit einer Phase ist der Durchschnitt über deine analysierten Partien. Grobe Fehler sind Fehler, verpasste Chancen und Patzer je 100 deiner Züge in dieser Phase. Blasse Zeilen beruhen auf weniger als {MIN_BUCKET_MOVES} Zügen und sagen noch wenig.", { MIN_BUCKET_MOVES })}
        </Foot>
      </section>
    </>
  );
}
