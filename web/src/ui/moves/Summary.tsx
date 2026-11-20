// "Züge & Fehler", the card on top: one sentence, every move as one bar and
// the four figures that sum the tally up.
import { KIND_GROUPS, type MoveTally, sumOf, TALLY_CLASSES, tallySummary } from "../../domain/profile";
import { IconChevron } from "../icons";
import { CountUp } from "../kit";
import { CLASS_COLOR, classLabel } from "../labels";
import { SplitBar, Stat } from "../viz/Bars";
import { de, plural } from "./shared";
import { t, tj } from "../../i18n";

/** Lucena's one sentence on the tally. */
function lead(tk: MoveTally, topPct: number): string {
  const b = tk.counts.Brilliant;
  const g = tk.counts.Great;
  if (b) return t("{plural} und {plural2} in {plural3}. Sie stehen unten noch einmal zum Nachspielen.", { plural: plural(b, t("brillanter Zug"), t("brillante Züge")), plural2: plural(g, t("großartiger"), t("großartige")), plural3: plural(tk.games, t("Partie"), t("Partien")) });
  if (g) return t("Noch kein brillanter Zug, aber schon {plural}. Brillant wird ein Zug, wenn du dafür sauber Material opferst.", { plural: plural(g, t("großartiger Fund"), t("großartige Funde")) });
  return t("{0} % deiner Züge sind schon der beste Zug. Der erste Glanzzug kommt bestimmt.", { 0: Math.round(topPct) });
}

function Versus({ theirs, verdict }: { theirs: string; verdict: -1 | 0 | 1 }) {
  return (
    <>
      
      {t("Gegner {theirs} · ", { theirs })}{verdict === 0 ? t("kein klarer Unterschied") : <b class={verdict > 0 ? "good" : "bad"}>{verdict > 0 ? t("du bist klar besser") : t("du bist klar schwächer")}</b>}
    </>
  );
}

export function MovesSummary({ t: tk, onShine }: { t: MoveTally; onShine: () => void }) {
  const s = tallySummary(tk);
  const o = s.opponents;
  const parts = TALLY_CLASSES.map((k) => ({ key: k, label: classLabel(k), value: tk.counts[k], color: CLASS_COLOR[k] ?? "var(--surface-3)" }));
  return (
    <section class="card span-12 mv-sum" id="s-bilanz">
      <div class="mv-sum-head">
        <span class="eyebrow">
          {t("{n} aus {n2}", { n: plural(tk.moves, t("Zug"), t("Züge")), n2: plural(tk.games, t("analysierter Partie"), t("analysierten Partien")) })}
        </span>
        <h2 class="mv-title">
          <CountUp value={s.top_pct} />  {tj("von 100 Zügen sind {x}", { x: <span>{t("der beste Zug")}</span> })}
        </h2>
        <p class="mv-sub">{lead(tk, s.top_pct)}</p>
      </div>

      <div class="mv-dist">
        <SplitBar parts={parts} height={14} />
        <div class="mv-groups">
          {KIND_GROUPS.map((g) => {
            const n = sumOf(tk.counts, g.classes);
            return (
              <div key={g.key} class={`mv-group g-${g.key}`}>
                <span class="mv-group-name">{g.label}</span>
                <strong class="tnum">{de((n / (tk.moves || 1)) * 100, n / (tk.moves || 1) < 0.1 ? 1 : 0)} %</strong>
                <span class="tnum">{plural(n, t("Zug"), t("Züge"))}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div class="pf-stats mv-stats">
        <Stat
          label={t("Bester Zug oder besser")}
          value={<CountUp value={s.top_pct} format={(v) => `${de(v, 0)} %`} />}
          tone={o?.top_verdict === 1 ? "good" : o?.top_verdict === -1 ? "bad" : undefined}
          sub={o ? <Versus theirs={`${de(o.top_pct, 0)} %`} verdict={o.top_verdict} /> : t("brillant, großartig oder bester Zug")}
          title={t("Anteil deiner Züge, die brillant, großartig oder der beste Zug waren")}
        />
        <Stat
          label={t("Grobe Fehler je 100 Züge")}
          value={<CountUp value={s.serious_per_100} format={(v) => de(v)} />}
          tone={o?.serious_verdict === 1 ? "good" : o?.serious_verdict === -1 ? "bad" : undefined}
          sub={o ? <Versus theirs={de(o.serious_per_100)} verdict={o.serious_verdict} /> : t("Fehler, verpasste Chancen und Patzer")}
          title={t("Fehler, verpasste Chancen und Patzer zusammen, je 100 deiner Züge")}
        />
        <Stat
          label={t("Patzer pro Partie")}
          value={<CountUp value={s.blunders_per_game} format={(v) => de(v, 2)} />}
          sub={t("{plural} · {plural2} ganz ohne", { plural: plural(tk.counts.Blunder, t("Patzer"), t("Patzer")), plural2: plural(tk.records.blunder_free_games, t("Partie"), t("Partien")) })}
        />
        <Stat label={t("Glanzzüge")} value={<CountUp value={s.shine} />} sub={t("{Brilliant} brillant · {Great} großartig", { Brilliant: tk.counts.Brilliant, Great: tk.counts.Great })}>
          {s.shine > 0 && (
            <button class="link-btn mv-jump" onClick={onShine}>
              
              {t("Ansehen")} <IconChevron />
            </button>
          )}
        </Stat>
      </div>
    </section>
  );
}
